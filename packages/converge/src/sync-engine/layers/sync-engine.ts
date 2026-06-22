import { Effect, HashMap, Layer, Option, Ref } from "effect";
import type { Event } from "../../event.ts";
import type { Projection } from "../../projection.ts";
import { ProcessorRegistry } from "../../processor-registry.ts";
import {
  ProcessorNotRegisteredError,
  SyncEngine,
  type AcceptedEvent,
  type ProcessorInput,
  type ProposedEvent,
  type ProposedEventProcessor,
  type ProjectionsSnapshot,
} from "../services/sync-engine.ts";

const applyProjection = (
  state: Record<string, unknown>,
  projections: HashMap.HashMap<Event<string, unknown>, Projection<unknown, unknown>>,
  event: Event<string, unknown>,
  payload: unknown,
): Record<string, unknown> => {
  const maybeProjection = HashMap.get(projections, event);
  if (Option.isNone(maybeProjection)) {
    return state;
  }

  const projection = maybeProjection.value;
  const current = projection.name in state ? state[projection.name] : projection.initial;

  return {
    ...state,
    [projection.name]: projection.apply(current, payload),
  };
};

export const SyncEngineLayer = Layer.effect(
  SyncEngine,
  Effect.gen(function* () {
    const registry = yield* ProcessorRegistry;

    const acceptedState = yield* Ref.make<Record<string, unknown>>({});
    const optimisticState = yield* Ref.make<Record<string, unknown>>({});
    const projectionRegistry = yield* Ref.make(
      HashMap.empty<Event<string, unknown>, Projection<unknown, unknown>>(),
    );
    const unresolvedEvents = yield* Ref.make<Array<ProposedEvent>>([]);
    const eventHistory = yield* Ref.make<Array<AcceptedEvent>>([]);
    const nextEventId = yield* Ref.make(0);

    const rebuildOptimisticProjections = Effect.gen(function* () {
      const accepted = yield* Ref.get(acceptedState);
      const projections = yield* Ref.get(projectionRegistry);
      const unresolved = yield* Ref.get(unresolvedEvents);

      let optimistic: Record<string, unknown> = { ...accepted };

      for (const [, projection] of projections) {
        if (!(projection.name in optimistic)) {
          optimistic[projection.name] = projection.initial;
        }
      }

      for (const proposed of unresolved) {
        optimistic = applyProjection(optimistic, projections, proposed.event, proposed.payload);
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
        const history = yield* Ref.get(eventHistory);
        const tailEventId = history.at(-1)?.eventId;

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

    const accept: SyncEngine["Service"]["accept"] = (proposed) =>
      Effect.gen(function* () {
        const maybeProcessor = yield* registry.lookup(proposed.event);

        if (Option.isNone(maybeProcessor)) {
          return yield* new ProcessorNotRegisteredError({ version: proposed.event.version });
        }

        const processor = maybeProcessor.value as ProposedEventProcessor<
          unknown,
          unknown,
          unknown
        >;

        yield* processor({ payload: proposed.payload });

        const history = yield* Ref.get(eventHistory);
        const previousEventId = history.at(-1)?.eventId;

        const accepted: AcceptedEvent = {
          eventId: proposed.eventId,
          previousEventId,
          event: proposed.event,
          payload: proposed.payload,
        };

        yield* Ref.update(eventHistory, (events) => [...events, accepted]);

        return accepted;
      });

    const sync: SyncEngine["Service"]["sync"] = () =>
      Effect.gen(function* () {
        const history = yield* Ref.get(eventHistory);
        const projections = yield* Ref.get(projectionRegistry);

        let accepted: Record<string, unknown> = {};
        for (const [, projection] of projections) {
          accepted[projection.name] = projection.initial;
        }

        for (const event of history) {
          accepted = applyProjection(accepted, projections, event.event, event.payload);
        }

        yield* Ref.set(acceptedState, accepted);

        yield* Ref.update(unresolvedEvents, (events) =>
          events.filter((proposed) => !history.some((accepted) => accepted.eventId === proposed.eventId)),
        );

        yield* rebuildOptimisticProjections;
      });

    const getEventHistory: SyncEngine["Service"]["getEventHistory"] = () => Ref.get(eventHistory);

    const getProjections: SyncEngine["Service"]["getProjections"] = () =>
      Effect.gen(function* () {
        const accepted = yield* Ref.get(acceptedState);
        const optimistic = yield* Ref.get(optimisticState);
        return { accepted, optimistic } as ProjectionsSnapshot;
      });

    return SyncEngine.of({
      register,
      process,
      registerProjection,
      record,
      accept,
      sync,
      getEventHistory,
      getProjections,
    });
  }),
).pipe(Layer.provide(ProcessorRegistry.layer));
