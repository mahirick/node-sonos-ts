import { expect } from 'chai'
import { randomUUID } from 'crypto';
import SonosDevice from '../src/sonos-device'
import { TestHelpers } from './test-helpers';
import SonosEventListener from '../src/sonos-event-listener';
import { EventsError, EventsErrorCode } from '../src/models/event-errors';
import { ServiceEvents } from '../src/models/service-event';

/**
 * Liveness-aware re-subscribe tests.
 *
 * The genuine dead-channel signal a Sonos speaker gives the lib is a renew FAILURE: it
 * rejects/forgets the SID (e.g. 412), so a SUBSCRIBE-by-SID renew stops returning 200. The
 * lib heals THAT by rotating the SID (UNSUBSCRIBE old -> SUBSCRIBE new).
 *
 * NOTIFY-silence is NOT a dead-channel signal: Sonos emits NOTIFYs only on actual state
 * change, never as a keepalive, so a paused/stopped/idle zone is silent indefinitely after
 * its on-subscribe dump. A quiet-but-healthy zone (renews succeeding) must therefore do a
 * plain blind renew and keep its SID — never a resubscribe — or every idle zone storms a
 * teardown+resubscribe loop. Transport-state-aware liveness lives in the caller (the proxy),
 * which corroborates silence against a coordinator known to be PLAYING.
 */

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

  it('renew the speaker REJECTS (412) triggers a FRESH subscribe, not a silent give-up', async () => {
    const port = 2100;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();
    const sidB = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });

    // The SID-A renew is rejected by the speaker (it forgot the SID): the dead-channel signal.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: sidA, Timeout: 'Second-300' } })
      .reply(412, '');
    // Recovery: old SID is UNSUBSCRIBEd, then a brand-new nt:'upnp:event' SUBSCRIBE lands SID-B.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidA } })
      .reply(204, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidB });

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    const result = await device.AVTransportService.CheckEventListener();
    expect(result, 'a live subscription (new SID) is in place afterwards').to.be.true;

    const subs = SonosEventListener.DefaultInstance.GetSubscriptions();
    expect(subs.some((s) => s.sid === sidB), 'new SID-B should be registered').to.be.true;
    expect(subs.some((s) => s.sid === sidA), 'old SID-A should be gone').to.be.false;
    expect(scope.isDone(), 'rejected renew + UNSUBSCRIBE old + fresh SUBSCRIBE must all have fired').to.be.true;
  }, 5000);

  it('idle-but-healthy zone (renew succeeds, NO NOTIFY ever) is NOT resubscribed — only a blind renew', async () => {
    // The resubscribe-storm guard: an AVTransport that emitted one initial NOTIFY then went
    // silent (paused/stopped) must keep its SID across renews. This would fail (a fresh
    // UNSUBSCRIBE/SUBSCRIBE would be attempted with no interceptor for it) if isStalled()
    // resurrected its NOTIFY-silence heuristic.
    const port = 2105;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });

    // Only the SID-A renew is intercepted. NO UNSUBSCRIBE, NO fresh SUBSCRIBE registered:
    // if the code resubscribed an idle zone, the request would 500 (no interceptor) and fail.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: sidA, Timeout: 'Second-300' } })
      .reply(200, '');

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    // One initial on-subscribe NOTIFY, then perpetual silence. (Even with NO NOTIFY at all the
    // result is identical — silence never drives a resubscribe.)
    device.AVTransportService.NotifyReceived();
    const lastNotify = device.AVTransportService.LastNotifyAt;

    // Simulate the 2nd renew tick after the zone has gone quiet: no further NotifyReceived().
    const result = await device.AVTransportService.CheckEventListener();
    expect(result, 'the existing subscription is healthy').to.be.true;

    const subs = SonosEventListener.DefaultInstance.GetSubscriptions();
    expect(subs.some((s) => s.sid === sidA), 'idle-but-healthy SID-A must be unchanged').to.be.true;
    expect(device.AVTransportService.LastNotifyAt, 'a blind renew must not stamp a NOTIFY').to.equal(lastNotify);
    expect(scope.isDone(), 'only the blind SID-A renew should have fired — no resubscribe').to.be.true;
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

    device.AVTransportService.NotifyReceived();

    const result = await device.AVTransportService.CheckEventListener();
    expect(result).to.be.true;

    const subs = SonosEventListener.DefaultInstance.GetSubscriptions();
    expect(subs.some((s) => s.sid === sidA), 'SID-A should be unchanged').to.be.true;
    expect(scope.isDone(), 'only the SID-A renew should have fired').to.be.true;
  }, 5000);

  it('a rejected renew emits SubscriptionStalled then SubscriptionRecovered on DEDICATED channels, not SubscriptionError', async () => {
    const port = 2103;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();
    const sidB = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: sidA, Timeout: 'Second-300' } })
      .reply(412, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidA } })
      .reply(204, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidB });

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    const stalledRecovered: EventsErrorCode[] = [];
    const errorChannel: EventsErrorCode[] = [];
    device.AVTransportService.Events.on(ServiceEvents.SubscriptionStalled, (err: EventsError) => stalledRecovered.push(err.code));
    device.AVTransportService.Events.on(ServiceEvents.SubscriptionRecovered, (err: EventsError) => stalledRecovered.push(err.code));
    device.AVTransportService.Events.on(ServiceEvents.SubscriptionError, (err: EventsError) => errorChannel.push(err.code));
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    await device.AVTransportService.CheckEventListener();

    expect(stalledRecovered).to.deep.equal([EventsErrorCode.SubscriptionStalled, EventsErrorCode.SubscriptionRecovered]);
    expect(errorChannel, 'recovery must NOT ride the SubscriptionError channel (proxy maps that to deadUids)').to.deep.equal([]);
  }, 5000);

  it('listening only to SubscriptionStalled does not auto-subscribe and does not keep a sub alive', async () => {
    const port = 2106;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();

    // Only a single SUBSCRIBE is allowed: the one triggered by the real serviceEvent listener.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidA } })
      .reply(204, '');

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());

    // A control-channel-only listener must NOT cause a subscribe.
    device.AVTransportService.Events.on(ServiceEvents.SubscriptionStalled, () => { });
    expect(SonosEventListener.DefaultInstance.GetSubscriptions().some((s) => s.sid === sidA), 'no subscribe from a control-only listener').to.be.false;

    // Adding a real listener subscribes...
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetSubscriptions().some((s) => s.sid === sidA));
    expect(SonosEventListener.DefaultInstance.GetSubscriptions().some((s) => s.sid === sidA)).to.be.true;

    // ...and removing only the real listener tears it down, even though the stall listener remains.
    device.AVTransportService.Events.removeAllListeners('serviceEvent');
    await TestHelpers.waitUntil(() => !SonosEventListener.DefaultInstance.GetSubscriptions().some((s) => s.sid === sidA));
    expect(SonosEventListener.DefaultInstance.GetSubscriptions().some((s) => s.sid === sidA), 'sub torn down when last real listener leaves').to.be.false;
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
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: sidA, Timeout: 'Second-300' } })
      .reply(412, '');
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
