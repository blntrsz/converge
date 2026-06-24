import type { Effect } from "effect";
import type { AnyEventType, EventData } from "./event.ts";

export type EventHandlerInput<EventDefinition extends AnyEventType> =
  EventData<EventDefinition>;

export interface EventHandler<
  EventDefinition extends AnyEventType = AnyEventType,
  Error = never,
> {
  readonly event: EventDefinition;
  readonly handle: (
    input: EventHandlerInput<EventDefinition>,
  ) => Effect.Effect<void, Error>;
}

export function make<EventDefinition extends AnyEventType, Error = never>(
  event: EventDefinition,
  handle: (
    input: EventHandlerInput<EventDefinition>,
  ) => Effect.Effect<void, Error>,
): EventHandler<EventDefinition, Error> {
  return { event, handle };
}
