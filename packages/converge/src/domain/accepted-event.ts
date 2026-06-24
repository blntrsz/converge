import { Schema } from "effect";
import { Model } from "effect/unstable/schema";
import type { AnyEvent } from "./event.ts";

export class AcceptedEvent<EventDefinition extends AnyEvent = AnyEvent>
  extends Model.Class<AcceptedEvent<AnyEvent>>("AcceptedEvent")({
    eventId: Model.GeneratedByApp(Schema.String),
    previousEventId: Schema.UndefinedOr(Schema.String),
    event: Schema.Any,
  }) {
  declare readonly event: EventDefinition;
}
