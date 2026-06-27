import { expect } from 'chai'
import { randomUUID } from 'crypto';
import SonosDevice from '../src/sonos-device'
import { TestHelpers } from './test-helpers';
import SonosEventListener from '../src/sonos-event-listener';
import { EventsError, EventsErrorCode } from '../src/models/event-errors';
import { ServiceEvents } from '../src/models/service-event';
import { AVTransportService } from '../src/services/av-transport.service';

/**
 * Liveness-aware re-subscribe tests. A Sonos speaker is known to accept a SUBSCRIBE-by-SID
 * renew (200 OK) yet silently stop POSTing NOTIFYs (dead delivery channel). These tests
 * prove the lib detects "SID accepted but no NOTIFY in the liveness window" and recovers by
 * rotating the SID (UNSUBSCRIBE old -> SUBSCRIBE new) instead of doing a blind renew, while
 * leaving the healthy renew path byte-identical.
 */

// Backdate the private subscribedAt so isStalled() can fire deterministically without
// waiting out the real grace/liveness windows. This is a test seam, not production wiring.
function backdateSubscribe(service: AVTransportService, msAgo: number): void {
  (service as unknown as { subscribedAt?: number }).subscribedAt = Date.now() - msAgo;
}

const STALLED_AGE_MS = 11 * 60 * 1000; // older than grace + liveness window

describe('SonosDevice - Events liveness', () => {
  beforeAll(() => {
    process.env.SONOS_DISABLE_LISTENER = 'true'
  })
  afterEach(async () => {
    await SonosEventListener.DefaultInstance.StopListener();
  });
  afterAll(() => {
    delete process.env.SONOS_DISABLE_LISTENER;
  })

  it('stalled subscription triggers a FRESH subscribe, not a blind renew', async () => {
    const port = 2100;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();
    const sidB = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });

    // Stalled recovery: old SID is UNSUBSCRIBEd, then a brand-new nt:'upnp:event' SUBSCRIBE lands SID-B.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidA } })
      .reply(204, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidB });

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    // No NOTIFY delivered, and the subscribe is well past the liveness window => stalled.
    backdateSubscribe(device.AVTransportService, STALLED_AGE_MS);

    const result = await device.AVTransportService.CheckEventListener();
    expect(result).to.be.true;

    const subs = SonosEventListener.DefaultInstance.GetSubscriptions();
    expect(subs.some((s) => s.sid === sidB), 'new SID-B should be registered').to.be.true;
    expect(subs.some((s) => s.sid === sidA), 'old SID-A should be gone').to.be.false;
    expect(scope.isDone(), 'UNSUBSCRIBE old + fresh SUBSCRIBE must both have fired').to.be.true;
  }, 5000);

  it('healthy subscription (recent NOTIFY) renews by SID, no fresh subscribe', async () => {
    const port = 2101;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });

    // Only the SID-A renew is intercepted. No UNSUBSCRIBE, no fresh SUBSCRIBE.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: sidA, Timeout: 'Second-300' } })
      .reply(200, '');

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    // Backdate the subscribe past the windows, but a fresh NOTIFY keeps it alive.
    backdateSubscribe(device.AVTransportService, STALLED_AGE_MS);
    device.AVTransportService.NotifyReceived();

    const result = await device.AVTransportService.CheckEventListener();
    expect(result).to.be.true;

    const subs = SonosEventListener.DefaultInstance.GetSubscriptions();
    expect(subs.some((s) => s.sid === sidA), 'SID-A should be unchanged').to.be.true;
    expect(scope.isDone(), 'only the SID-A renew should have fired').to.be.true;
  }, 5000);

  it('freshly-subscribed quiet service within grace window is NOT flagged stalled', async () => {
    const port = 2102;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });

    // Within grace window: a blind SID-A renew is expected, never a fresh subscribe.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: sidA, Timeout: 'Second-300' } })
      .reply(200, '');

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    // No NOTIFY, but subscribed only 5s ago (inside the 90s grace) => not stalled.
    backdateSubscribe(device.AVTransportService, 5 * 1000);

    const result = await device.AVTransportService.CheckEventListener();
    expect(result).to.be.true;

    const subs = SonosEventListener.DefaultInstance.GetSubscriptions();
    expect(subs.some((s) => s.sid === sidA), 'SID-A should be unchanged within grace').to.be.true;
    expect(scope.isDone(), 'only the blind SID-A renew should have fired').to.be.true;
  }, 5000);

  it('stall emits SubscriptionStalled then SubscriptionRecovered on the SubscriptionError channel', async () => {
    const port = 2103;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();
    const sidB = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidA } })
      .reply(204, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidB });

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    const codes: EventsErrorCode[] = [];
    device.AVTransportService.Events.on(ServiceEvents.SubscriptionError, (err: EventsError) => {
      codes.push(err.code);
    });
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    backdateSubscribe(device.AVTransportService, STALLED_AGE_MS);
    await device.AVTransportService.CheckEventListener();

    expect(codes).to.deep.equal([EventsErrorCode.SubscriptionStalled, EventsErrorCode.SubscriptionRecovered]);
  }, 5000);

  it('recovered subscription resumes delivering NOTIFYs to the new SID', async () => {
    const port = 2104;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();
    const sidB = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidA } })
      .reply(204, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidB });

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    let lastTransportState: string | undefined;
    device.AVTransportService.Events.on('serviceEvent', (data) => {
      if (data.TransportState !== undefined) lastTransportState = data.TransportState as string;
    });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    backdateSubscribe(device.AVTransportService, STALLED_AGE_MS);
    await device.AVTransportService.CheckEventListener();

    // Deliver a NOTIFY through the recovered service and confirm it parses + stamps liveness.
    device.AVTransportService.ParseEvent('<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"><e:property><LastChange>&lt;Event xmlns=&quot;urn:schemas-upnp-org:metadata-1-0/AVT/&quot;&gt;&lt;InstanceID val=&quot;0&quot;&gt;&lt;TransportState val=&quot;PLAYING&quot;/&gt;&lt;/InstanceID&gt;&lt;/Event&gt;</LastChange></e:property></e:propertyset>');
    device.AVTransportService.NotifyReceived();

    expect(lastTransportState).to.be.equal('PLAYING');
    const recovered = SonosEventListener.DefaultInstance.GetSubscriptions().find((s) => s.sid === sidB);
    expect(recovered, 'recovered SID-B should be registered').to.not.be.undefined;
    expect(recovered?.lastEventAt, 'lastEventAt should be stamped after the post-recovery NOTIFY').to.be.a('number');
  }, 5000);
});
