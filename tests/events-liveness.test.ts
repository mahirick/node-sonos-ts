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

  it('SubscriptionStalled is an EDGE signal: a speaker that stays down emits it once, not once per renew tick', async () => {
    // While a speaker is down, every 150s renew tick re-enters resubscribeFresh (the renew
    // keeps failing and the fresh SUBSCRIBE keeps failing, so the SID never recovers). Stalled
    // must fire ONCE on entry into the stall, not once per tick, or a consumer logging it
    // verbatim sees one line per tick for the whole outage. wasStalled gates that; this test
    // fails (two Stalled emits) if the gate is removed.
    //
    // The renew INTERVAL calls the private renewEventSubscription directly (CheckEventListener
    // short-circuits once the SID is lost), so we drive that same private path here to model
    // two real ticks of a sustained outage.
    const port = 2107;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });
    // Tick 1: SID-A renew rejected -> best-effort UNSUBSCRIBE old SID -> fresh SUBSCRIBE that
    // the down speaker 500s (no new SID -> no recovery, SID stays undefined).
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: sidA, Timeout: 'Second-300' } })
      .reply(412, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidA } })
      .reply(204, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(500, '');
    // Tick 2: SID is now undefined, so the renew skips straight to resubscribeFresh, which has
    // no old SID to UNSUBSCRIBE — only a fresh SUBSCRIBE, again 500'd by the still-down speaker.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(500, '');

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    const stalled: EventsErrorCode[] = [];
    device.AVTransportService.Events.on(ServiceEvents.SubscriptionStalled, (err: EventsError) => stalled.push(err.code));
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    const renewTick = () => (device.AVTransportService as unknown as { renewEventSubscription(): Promise<boolean> }).renewEventSubscription();

    // Tick 1: enters the stall (emits Stalled once) then the recovery subscribe throws No-SID.
    await TestHelpers.expectThrowsAsync(renewTick);
    // Tick 2 while still down: re-enters resubscribeFresh with SID already undefined; must NOT re-emit Stalled.
    await TestHelpers.expectThrowsAsync(renewTick);

    expect(stalled, 'Stalled emitted exactly once across two down-ticks (edge, not level)').to.deep.equal([EventsErrorCode.SubscriptionStalled]);
    expect(scope.isDone(), 'both down-ticks must have fired their renew+subscribe attempts').to.be.true;
  }, 5000);

  it('SubscriptionStalled re-arms after a recovery so a SECOND outage re-emits it', async () => {
    const port = 2108;
    const scope = TestHelpers.getScope(port);
    const sidA = randomUUID();
    const sidB = randomUUID();
    const sidC = randomUUID();

    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidA });
    // Outage 1: SID-A renew rejected -> recover to SID-B.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: sidA, Timeout: 'Second-300' } })
      .reply(412, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidA } })
      .reply(204, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidB });
    // Outage 2: SID-B renew rejected -> recover to SID-C.
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { SID: sidB, Timeout: 'Second-300' } })
      .reply(412, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidB } })
      .reply(204, '');
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'SUBSCRIBE', undefined, { reqheaders: { nt: 'upnp:event' } })
      .reply(200, '', { sid: sidC });

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    const signals: EventsErrorCode[] = [];
    device.AVTransportService.Events.on(ServiceEvents.SubscriptionStalled, (err: EventsError) => signals.push(err.code));
    device.AVTransportService.Events.on(ServiceEvents.SubscriptionRecovered, (err: EventsError) => signals.push(err.code));
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetStatus().currentSubscriptions.some((s) => s.sid === sidA));

    await device.AVTransportService.CheckEventListener();
    await device.AVTransportService.CheckEventListener();

    expect(signals, 'each distinct outage emits its own Stalled (flag re-armed on recovery)').to.deep.equal([
      EventsErrorCode.SubscriptionStalled,
      EventsErrorCode.SubscriptionRecovered,
      EventsErrorCode.SubscriptionStalled,
      EventsErrorCode.SubscriptionRecovered,
    ]);
    expect(scope.isDone(), 'both full stall->recover cycles must have fired end to end').to.be.true;
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

  it('a cancel->resubscribe cycle restarts the renew interval (handle cleared on cancel, re-armed on re-subscribe)', async () => {
    // Latent upstream bug fix: cancelSubscription must null out eventRenewInterval after
    // clearInterval, otherwise subscribeForEvents' `=== undefined` guard stays false on the
    // next subscribe and the renew loop never restarts — renewals silently stop after a
    // remove-last-listener -> re-add-listener cycle. Without the fix the final assertion
    // (a fresh, distinct interval handle is armed on re-subscribe) fails.
    const port = 2109;
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
    scope
      .intercept('/MediaRenderer/AVTransport/Event', 'UNSUBSCRIBE', undefined, { reqheaders: { sid: sidB } })
      .reply(204, '');

    const device = new SonosDevice(TestHelpers.testHost, port, randomUUID());
    const intervalHandle = () => (device.AVTransportService as unknown as { eventRenewInterval?: NodeJS.Timeout }).eventRenewInterval;

    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetSubscriptions().some((s) => s.sid === sidA));
    const firstInterval = intervalHandle();
    expect(firstInterval, 'first subscribe arms a renew interval').to.not.be.undefined;

    // Remove the last real listener -> cancelSubscription -> interval must be cleared AND nulled.
    device.AVTransportService.Events.removeAllListeners('serviceEvent');
    await TestHelpers.waitUntil(() => !SonosEventListener.DefaultInstance.GetSubscriptions().some((s) => s.sid === sidA));
    expect(intervalHandle(), 'cancel must null the interval handle, not just clearInterval it').to.be.undefined;

    // Re-add a listener -> re-subscribe -> a NEW interval must be armed (renew loop restarted).
    device.AVTransportService.Events.on('serviceEvent', () => { });
    await TestHelpers.waitUntil(() => SonosEventListener.DefaultInstance.GetSubscriptions().some((s) => s.sid === sidB));
    const secondInterval = intervalHandle();
    expect(secondInterval, 're-subscribe must arm a fresh renew interval').to.not.be.undefined;
    expect(secondInterval, 'the re-armed interval is a new handle, not the stale cleared one').to.not.equal(firstInterval);

    // Clean up the live timer so jest has no open handle.
    device.AVTransportService.Events.removeAllListeners('serviceEvent');
    await TestHelpers.waitUntil(() => !SonosEventListener.DefaultInstance.GetSubscriptions().some((s) => s.sid === sidB));
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
