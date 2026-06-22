import { Context, Effect, HashMap, Layer, Option, Ref, Schema } from "effect";
import type { Event } from "./event.ts";
import type { Projection } from "./projection.ts";
import { ProcessorRegistry } from "./processor-registry.ts";

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
  readonly getProjections: () => Effect.Effect<ProjectionsSnapshot>;
}>()("converge/SyncEngine") {
  static readonly layer = Layer.effect(
    SyncEngine,
    Effect.gen(function* () {
      const registry = yield* ProcessorRegistry;

      const acceptedState = yield* Ref.make<Record<string, unknown>>({});
      const optimisticState = yield* Ref.make<Record<string, unknown>>({});
      const projectionRegistry = yield* Ref.make(
        HashMap.empty<Event<string, unknown>, Projection<unknown, unknown>>(),
      );
      const unresolvedEvents = yield* Ref.make<Array<ProposedEvent>>([]);
      const nextEventId = yield* Ref.make(0);

      const rebuildOptimisticProjections = Effect.gen(function* () {
        const accepted = yield* Ref.get(acceptedState);
        const projections = yield* Ref.get(projectionRegistry);
        const unresolved = yield* Ref.get(unresolvedEvents);

        const optimistic: Record<string, unknown> = { ...accepted };

        for (const [, projection] of projections) {
          if (!(projection.name in optimistic)) {
            optimistic[projection.name] = projection.initial;
          }
        }

        for (const proposed of unresolved) {
          const maybeProjection = HashMap.get(projections, proposed.event);
          if (Option.isSome(maybeProjection)) {
            const projection = maybeProjection.value;
            optimistic[projection.name] = projection.apply(
              optimistic[projection.name],
              proposed.payload,
            );
          }
        }

        yield* Ref.set(optimisticState, optimistic);
      });

      const register: SyncEngine["Service"]["register"] = (event, processor) =>
        registry.register(event, processor);

      const process: SyncEngine["Service"]["process"] = <Version extends string, Payload, Result, Error>(
        event: Event<Version, Payload>,
        input: ProcessorInput<Payload>,
      ) =>
        Effect.gen(function* () {
          const maybeProcessor = yield* registry.lookup(event);

          if (Option.isNone(maybeProcessor)) {
            return yield* new ProcessorNotRegisteredError({ version: event.version });
          }

          const processor = maybeProcessor.value as ProposedEventProcessor<
            Payload,
            Result,
            Error
          >;

          return yield* processor(input);
        });

      const registerProjection: SyncEngine["Service"]["registerProjection"] = (event, projection) =>
        Effect.gen(function* () {
          yield* Ref.update(projectionRegistry, (map) =>
            HashMap.set(map, event as Event<string, unknown>, projection as Projection<unknown, unknown>),
          );

          yield* Ref.update(acceptedState, (state) => ({
            ...state,
            [projection.name]: projection.initial,
          }));

          yield* rebuildOptimisticProjections;
        });

      const record: SyncEngine["Service"]["record"] = (event, payload) =>
        Effect.gen(function* () {
          const eventId = `event-${yield* Ref.getAndUpdate(nextEventId, (n) => n + 1)}`;
          const tailEventId = undefined;

          const proposed: ProposedEvent = {
            eventId,
            tailEventId,
            event: event as Event<string, unknown>,
            payload,
          };

          yield* Ref.update(unresolvedEvents, (events) => [...events, proposed]);
          yield* rebuildOptimisticProjections;

          return proposed;
        });

      const getProjections: SyncEngine["Service"]["getProjections"] = () =>
        Effect.gen(function* () {
          const accepted = yield* Ref.get(acceptedState);
          const optimistic = yield* Ref.get(optimisticState);
          return { accepted, optimistic };
        });

      return SyncEngine.of({
        register,
        process,
        registerProjection,
        record,
        getProjections,
      });
    }),
  ).pipe(Layer.provide(ProcessorRegistry.layer));
}
