import { Context, Effect, Schema } from "effect";
import type { Event } from "../../event.ts";
import type { Projection } from "../../projection.ts";

export interface ProcessorInput<Payload> {
  readonly payload: Payload;
}

export type ProposedEventProcessor<Payload, Result, Error = never> = (
  input: ProcessorInput<Payload>,
) => Effect.Effect<Result, Error>;

export interface ProposedEvent {
  readonly eventId: string;
  readonly tailEventId: string | undefined;
  readonly event: Event<string, unknown>;
  readonly payload: unknown;
}

export class ProcessorNotRegisteredError extends Schema.TaggedErrorClass<ProcessorNotRegisteredError>()(
  "ProcessorNotRegisteredError",
  { version: Schema.String },
) {}

export interface AcceptedEvent {
  readonly eventId: string;
  readonly previousEventId: string | undefined;
  readonly event: Event<string, unknown>;
  readonly payload: unknown;
}

export interface ProjectionsSnapshot {
  readonly accepted: Record<string, unknown>;
  readonly optimistic: Record<string, unknown>;
}

export class SyncEngine extends Context.Service<SyncEngine, {
  readonly register: <Version extends string, Payload, Result, Error>(
    event: Event<Version, Payload>,
    processor: ProposedEventProcessor<Payload, Result, Error>,
  ) => Effect.Effect<void>;
  readonly process: <Version extends string, Payload, Result, Error>(
    event: Event<Version, Payload>,
    input: ProcessorInput<Payload>,
  ) => Effect.Effect<Result, ProcessorNotRegisteredError | Error>;
  readonly registerProjection: <State, Payload>(
    event: Event<string, Payload>,
    projection: Projection<State, Payload>,
  ) => Effect.Effect<void>;
  readonly record: <Version extends string, Payload>(
    event: Event<Version, Payload>,
    payload: Payload,
  ) => Effect.Effect<ProposedEvent>;
  readonly accept: (
    proposed: ProposedEvent,
  ) => Effect.Effect<AcceptedEvent, ProcessorNotRegisteredError | unknown>;
  readonly sync: () => Effect.Effect<void>;
  readonly getEventHistory: () => Effect.Effect<Array<AcceptedEvent>>;
  readonly getProjections: () => Effect.Effect<ProjectionsSnapshot>;
}>()("converge/SyncEngine") {}
