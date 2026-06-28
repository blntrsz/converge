import { Schema } from "effect";

/**
 * @since 0.0.0
 * @category model
 */
export class Event<
  TEventType extends string,
  TEventDetails extends Schema.Struct.Fields,
> extends Schema.Class<Event<any, any>>("Event")({
  eventType: Schema.String,
  eventDetails: Schema.Unknown,
}) {
  declare readonly eventType: TEventType;
  declare readonly eventDetails: TEventDetails;
}

/**
 * @since 0.0.0
 * @category type
 */
export type AnyEvent = Event<any, any>;

/**
 * @since 0.0.0
 * @category constructor
 */
export function make<
  const TEventType extends string,
  const TEventDetails extends Schema.Struct.Fields,
>(eventType: TEventType, eventDetails: TEventDetails) {
  return new Event<TEventType, TEventDetails>({
    eventType,
    eventDetails,
  });
}
