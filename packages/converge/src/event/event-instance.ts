import { createId } from "@paralleldrive/cuid2";
import { Effect, Schema } from "effect";
import { Model } from "effect/unstable/schema";
import * as Event from "./event";

/**
 * @since 0.0.0
 * @category model
 */
export class EventInstance<
  TEventType extends string = string,
  TEventDetails extends Schema.Struct.Fields = Schema.Struct.Fields,
> extends Model.Class<EventInstance<any, any>>("EventInstance")({
  eventId: Model.GeneratedByApp(Schema.String),
  eventType: Schema.String,
  eventDetails: Schema.Unknown,
}) {
  declare readonly eventType: TEventType;
  declare readonly eventDetails: Schema.Struct.Type<TEventDetails>;
}

/**
 * @since 0.0.0
 * @category constructor
 */
export const make = Effect.fn("EventInstance.make")(function* <
  const TEventType extends string,
  const TEventDetails extends Schema.Struct.Fields,
>(event: Event.Event<TEventType, TEventDetails>, input: Schema.Struct.Encoded<TEventDetails>) {
  const id = createId();
  const eventDetails = yield* Schema.decodeEffect(Schema.Struct(event.eventDetails))(input);

  return new EventInstance<TEventType, TEventDetails>({
    eventId: id,
    eventType: event.eventType,
    eventDetails,
  });
});
