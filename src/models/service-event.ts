import { EventsError } from './event-errors';

export interface ServiceEvent<TEventType> {
  serviceEvent: (eventData: TEventType) => void;
  subscriptionError: (error: EventsError) => void;
  subscriptionStalled: (error: EventsError) => void;
  subscriptionRecovered: (error: EventsError) => void;
  rawEvent: (eventData: unknown) => void;
  removeListener: (eventName: string | symbol) => void;
  newListener: (eventName: string | symbol) => void;
}

export enum ServiceEvents {
  /**
   * @deprecated switch to ServiceEvent
   */
  Data = 'serviceEvent',
  /**
   * @deprecated switch to ServiceEvent
   */
  LastChange = 'serviceEvent',
  ServiceEvent = 'serviceEvent',
  SubscriptionError = 'subscriptionError',
  /**
   * A renew failed: the speaker rejected/forgot the SID, so the lib is rotating to a
   * fresh SID. Distinct from SubscriptionError (a one-off operation failure) and opt-in,
   * so a caller's error handler is not forced to treat recovery as a dead subscription.
   */
  SubscriptionStalled = 'subscriptionStalled',
  /**
   * A stalled subscription was healed by landing a brand-new SID. Emitted only on actual
   * SID rotation. Distinct channel so a caller never mistakes a recovery for a failure.
   */
  SubscriptionRecovered = 'subscriptionRecovered',
  Unprocessed = 'rawEvent'
}
