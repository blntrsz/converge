import { Schema } from "effect";
import { Model } from "effect/unstable/schema";
import type { AnyEvent } from "./event.ts";

export class ProposedEvent<EventDefinition extends AnyEvent = AnyEvent>
  extends Model.Class<ProposedEvent<AnyEvent>>("ProposedEvent")({
    eventId: Model.GeneratedByApp(Schema.String),
    tailEventId: Schema.UndefinedOr(Schema.String),
    event: Schema.Any,
  }) {
  declare readonly event: EventDefinition;
}
