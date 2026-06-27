import { expect }  from 'chai'
import SonosDevice from '../src/sonos-device'
import { TestHelpers } from './test-helpers';
import SonosEventListener from '../src/sonos-event-listener';
import { randomUUID } from 'crypto';

describe('SonosDevice - Events', () => {
  beforeAll(() => {
    process.env.SONOS_DISABLE_LISTENER = 'true'
  })
  afterEach(async () => {
    await SonosEventListener.DefaultInstance.StopListener();
  });
  afterAll(() => {
    delete process.env.SONOS_DISABLE_LISTENER;
  })

  it('automatically creates event subscription', async () => {
    const port = 1402;
    const scope = TestHelpers.getScope(port);

    // Required to catch event subscription
    //process.env.SONOS_LISTENER_HOST = 'localhost-events'
    const renderingControlSid = randomUUID();
    scope
      .intercept('/MediaRenderer/RenderingControl/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' }})
      .reply(200, '', {
        sid: renderingControlSid
      });

    const avtransportSid = randomUUID();
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' }})
      .reply(200, '', {
        sid: avtransportSid
      });

    const randomUuid = randomUUID();
    const device = new SonosDevice(TestHelpers.testHost, port, randomUuid);
    const statusBefore = SonosEventListener.DefaultInstance.GetStatus();
    expect(statusBefore.isListening).to.be.false;
    device.Events.on('currentTrack', (track) => {});
    // Subscriptions are registered out-of-band; poll until both have landed instead of guessing a delay.
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.length === 2);

    const statusAfter = SonosEventListener.DefaultInstance.GetStatus();
    expect(statusAfter.isListening).to.be.true;
    expect(statusAfter.currentSubscriptions).to.be.an('array').that.has.lengthOf(2);

    const avSubscription = statusAfter.currentSubscriptions.find((s) => s.sid === avtransportSid);
    expect(avSubscription).to.be.not.undefined;
    expect(avSubscription?.uuid).to.be.equal(randomUuid);
    expect(avSubscription?.service).to.be.equal('AVTransport');  });

  it('automatically unsubscribes event subscription', async () => {
    const port = 1403;
    const scope = TestHelpers.getScope(port);

    // Required to catch event subscription
    //process.env.SONOS_LISTENER_HOST = 'localhost-events'
    const renderingControlSid = randomUUID();
    scope
      .intercept('/MediaRenderer/RenderingControl/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' }})
      .reply(200, '', {
        sid: renderingControlSid
      });

    const avtransportSid = randomUUID();
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' }})
      .reply(200, '', {
        sid: avtransportSid
      });
    
    scope
      .intercept('/MediaRenderer/RenderingControl/Event', 'UNSUBSCRIBE', undefined , { reqheaders: { sid: renderingControlSid }})
      .reply(204, '');

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: avtransportSid }})
      .reply(204, '');

    const randomUuid = randomUUID();
    const device = new SonosDevice(TestHelpers.testHost, port, randomUuid);
    device.Events.on('currentTrack', (track) => {});
    // Subscriptions are registered out-of-band; poll until both have landed instead of guessing a delay.
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.length === 2);

    const statusBefore = SonosEventListener.DefaultInstance.GetStatus();
    expect(statusBefore.currentSubscriptions).to.be.an('array').that.has.lengthOf(2);

    device.Events.removeAllListeners('currentTrack');
    // Unsubscribe is also out-of-band; poll until both have been removed.
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.length === 0);

    const statusAfter = SonosEventListener.DefaultInstance.GetStatus();
    expect(statusAfter.currentSubscriptions).to.be.an('array').that.has.lengthOf(0);
  });

  it('refreshes some subscriptions', async () => {
    process.env.DEBUG = 'sonos:*';
    const port = 2000;
    const scope = TestHelpers.getScope(port);
    const renderingControlSid = randomUUID();
    const avtransportSid = randomUUID();

    scope
    .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' }})
    .reply(200, '', {
      sid: avtransportSid
    });

    scope
      .intercept('/MediaRenderer/RenderingControl/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' }})
      .reply(200, '', {
        sid: renderingControlSid
      });

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: avtransportSid, Timeout: 'Second-300' }})
      .reply(200, '');

    scope
      .intercept('/MediaRenderer/RenderingControl/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: renderingControlSid, Timeout: 'Second-300' }})
      .reply(200, '');

    const device = new SonosDevice(TestHelpers.testHost, port);
    device.Events.on('currentTrack', (track) => { });
    // Wait for both out-of-band subscriptions before refreshing them.
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.length === 2);

    const result = await device.RefreshEventSubscriptions();
    expect(result).to.be.true;
  }, 3000);

  it('refreshes AVTransport events', async () => {
    const port = 2001;
    const scope = TestHelpers.getScope(port);

    const avtransportSid = randomUUID();
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' }})
      .reply(200, '', {
        sid: avtransportSid
      });
    
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: avtransportSid, Timeout: 'Second-300' }})
      .reply(200, '');

    const device = new SonosDevice(TestHelpers.testHost, port);
    device.AVTransportService.Events.on('serviceEvent', (data) => { })
    // Wait for the out-of-band AVTransport subscription before checking/renewing it.
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.service === 'AVTransport'));

    const result = await device.AVTransportService.CheckEventListener();
    expect(result).to.be.true;
    scope.isDone();  }, 3000);
});

describe('SonosEventListener', () => {
  // beforeAll(() => {
  //   process.env.SONOS_DISABLE_LISTENER = 'true'
  // })

  afterEach(async () => {
    await SonosEventListener.DefaultInstance.StopListener().catch(err => {});
    //delete process.env.SONOS_DISABLE_LISTENER;
  });

  it.skip('allows updating host and port', () => {
    const result = SonosEventListener.DefaultInstance.UpdateSettings({ host: 'fake-host' , port: 10000 });
    expect(result).to.be.true;
    const endpoint = SonosEventListener.DefaultInstance.GetEndpoint('fake-uuid', 'test-service');
    expect(endpoint).to.be.equal('http://fake-host:10000/sonos/fake-uuid/test-service');
  });

  it('disallows updating host and port', () => {
    SonosEventListener.DefaultInstance.StartListener();
    const result = SonosEventListener.DefaultInstance.UpdateSettings({ host: 'fake-host' , port: 10000 });
    expect(result).to.be.false;
  });
});

describe('SonosEventListener - HTTP', () => {
  beforeAll((done) => {
    SonosEventListener.DefaultInstance.StartListener(() => {
      setTimeout(done, 500);
    });
  });

  afterAll(async () => {
    await SonosEventListener.DefaultInstance.StopListener();
  }, 1000)

  it('/status works', async () => {
    const response = await fetch('http://localhost:6329/status');
    expect(response.ok).to.be.true;  }, 10000);

  it('/health works', async () => {
    const response = await fetch('http://localhost:6329/health');
    expect(response.ok).to.be.true;  }, 1000);

  it('/nonexisting returns 404', async () => {
    const response = await fetch('http://localhost:6329/nonexisting');
    
    expect(response.ok).to.be.false;
    expect(response.status).to.be.eq(404, 'Status code should be 404');  }, 1000);

});
  