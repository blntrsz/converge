import { Effect, HashMap, Option } from "effect";
import type {
  AnyEvent,
  AnyEventType,
  EventData,
} from "./domain/event.ts";
import type { EventHandler } from "./domain/event-handler.ts";
import { AcceptedEvent } from "./domain/accepted-event.ts";
import type { Projection } from "./domain/projection.ts";
import { ProposedEvent } from "./domain/proposed-event.ts";
import { ProjectionsSnapshot } from "./domain/projections-snapshot.ts";

export type { AcceptedEvent, ProposedEvent, ProjectionsSnapshot };

const applyProjection = (
  state: Record<string, unknown>,
  projections: HashMap.HashMap<string, Projection<unknown, any>>,
  event: AnyEvent,
): Record<string, unknown> => {
  const maybeProjection = HashMap.get(projections, event.type);
  if (Option.isNone(maybeProjection)) {
    return state;
  }

  const projection = maybeProjection.value;
  const current = projection.name in state ? state[projection.name] : projection.initial;

  return {
    ...state,
    [projection.name]: projection.apply(current, event.data),
  };
};

/**
 * @since 0.0.0
 * @category sync-engine
 */
export class SyncEngine {
  private acceptedState: Record<string, unknown> = {};
  private optimisticState: Record<string, unknown> = {};
  private eventHandlerRegistry = HashMap.empty<string, EventHandler<any, any>>();
  private projectionRegistry = HashMap.empty<string, Projection<unknown, any>>();
  private unresolvedEvents: Array<ProposedEvent> = [];
  private eventHistory: Array<AcceptedEvent> = [];
  private nextEventId = 0;

  constructor(...handlers: Array<EventHandler<any, any>>) {
    for (const handler of handlers) {
      this.add(handler);
    }
  }

  add<EventDefinition extends AnyEventType, Error = never>(
    handler: EventHandler<EventDefinition, Error>,
  ): this {
    this.eventHandlerRegistry = HashMap.set(
      this.eventHandlerRegistry,
      handler.event.type,
      handler,
    );

    return this;
  }

  process<EventDefinition extends AnyEvent>(
    event: EventDefinition,
  ): Effect.Effect<void, unknown> {
    const maybeHandler = HashMap.get(this.eventHandlerRegistry, event.type);
    if (Option.isNone(maybeHandler)) {
      return Effect.fail(new Error(`No EventHandler registered for ${event.type}`));
    }

    return maybeHandler.value.handle(event.data);
  }

  registerProjection<EventDefinition extends AnyEventType, State>(
    eventType: EventDefinition,
    projection: Projection<State, EventData<EventDefinition>>,
  ): Effect.Effect<void> {
    return Effect.sync(() => {
      this.projectionRegistry = HashMap.set(
        this.projectionRegistry,
        eventType.type,
        projection as Projection<unknown, any>,
      );

      this.acceptedState = {
        ...this.acceptedState,
        [projection.name]: projection.initial,
      };

      this.rebuildOptimisticProjections();
    });
  }

  record<EventDefinition extends AnyEvent>(
    event: EventDefinition,
  ): Effect.Effect<ProposedEvent<EventDefinition>> {
    return Effect.sync(() => {
      const eventId = `event-${this.nextEventId++}`;
      const tailEventId = this.eventHistory.at(-1)?.eventId;

      const proposed = new ProposedEvent<typeof event>({
        eventId,
        tailEventId,
        event,
      });

      this.unresolvedEvents = [...this.unresolvedEvents, proposed];
      this.rebuildOptimisticProjections();

      return proposed;
    });
  }

  accept<EventDefinition extends AnyEvent>(
    proposed: ProposedEvent<EventDefinition>,
  ): Effect.Effect<AcceptedEvent<EventDefinition>, unknown> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.process(proposed.event);

      const previousEventId = self.eventHistory.at(-1)?.eventId;

      const accepted = new AcceptedEvent<typeof proposed.event>({
        eventId: proposed.eventId,
        previousEventId,
        event: proposed.event,
      });

      self.eventHistory = [...self.eventHistory, accepted];

      return accepted;
    });
  }

  sync(): Effect.Effect<void> {
    return Effect.sync(() => {
      let accepted: Record<string, unknown> = {};
      for (const [, projection] of this.projectionRegistry) {
        accepted[projection.name] = projection.initial;
      }

      for (const event of this.eventHistory) {
        accepted = applyProjection(accepted, this.projectionRegistry, event.event);
      }

      this.acceptedState = accepted;

      this.unresolvedEvents = this.unresolvedEvents.filter((proposed) =>
        !this.eventHistory.some((accepted) => accepted.eventId === proposed.eventId)
      );

      this.rebuildOptimisticProjections();
    });
  }

  getEventHistory(): Effect.Effect<Array<AcceptedEvent>> {
    return Effect.sync(() => this.eventHistory);
  }

  getProjections(): Effect.Effect<ProjectionsSnapshot> {
    return Effect.sync(() =>
      new ProjectionsSnapshot({
        accepted: this.acceptedState,
        optimistic: this.optimisticState,
      }),
    );
  }

  private rebuildOptimisticProjections(): void {
    let optimistic: Record<string, unknown> = { ...this.acceptedState };

    for (const [, projection] of this.projectionRegistry) {
      if (!(projection.name in optimistic)) {
        optimistic[projection.name] = projection.initial;
      }
    }

    for (const proposed of this.unresolvedEvents) {
      optimistic = applyProjection(
        optimistic,
        this.projectionRegistry,
        proposed.event,
      );
    }

    this.optimisticState = optimistic;
  }
}

export function make(...handlers: Array<EventHandler<any, any>>): SyncEngine {
  return new SyncEngine(...handlers);
}
