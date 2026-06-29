import { IndexedDb } from "@effect/platform-browser";
import { Effect, Layer, ManagedRuntime, Result } from "effect";
import * as EventHandler from "../../../packages/converge/src/event/event-handler.ts";
import * as EventInstance from "../../../packages/converge/src/event/event-instance.ts";
import * as EventRouter from "../../../packages/converge/src/event/event-router.ts";
import * as IndexedDbReplicaSyncEngine from "../../../packages/converge/src/replica-sync-engine/layers/indexeddb-replica-sync-engine.ts";
import * as ReplicaSyncEngine from "../../../packages/converge/src/replica-sync-engine/services/replica-sync-engine.ts";
import * as PrimarySyncEngine from "../../../packages/converge/src/primary-sync-engine/services/primary-sync-engine.ts";
import {
  todoCompletionSet,
  todoCreated,
  todoDeleted,
  type Todo,
} from "./todo-events";

type WireEvent = {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventDetails: unknown;
};

type PullResponse =
  | {
      readonly data: WireEvent[];
      readonly hasNext: true;
      readonly cursor: string;
    }
  | {
      readonly data: WireEvent[];
      readonly hasNext: false;
    };

type PushResponse = {
  readonly results: ReadonlyArray<
    | { readonly ok: true; readonly event: WireEvent }
    | { readonly ok: false; readonly event: WireEvent }
  >;
};

const projectionStorageKey = "converge-react.todos";

class TodoProjectionStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: Todo[];
  private todos = new Map<string, Todo>();

  constructor() {
    this.todos = new Map(this.readStoredTodos().map((todo) => [todo.id, todo]));
    this.snapshot = this.sortedTodos();
  }

  readonly getSnapshot = () => this.snapshot;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  applyCreated(todo: Todo) {
    if (this.todos.has(todo.id)) return;

    this.todos.set(todo.id, todo);
    this.commit();
  }

  setCompleted(id: string, completed: boolean) {
    const todo = this.todos.get(id);
    if (!todo) return;

    this.todos.set(id, { ...todo, completed });
    this.commit();
  }

  delete(id: string) {
    if (!this.todos.delete(id)) return;

    this.commit();
  }

  private readStoredTodos() {
    try {
      const stored = window.localStorage.getItem(projectionStorageKey);
      if (!stored) return [];
      const parsed = JSON.parse(stored);

      if (!Array.isArray(parsed)) return [];

      return parsed.filter(isTodo);
    } catch {
      return [];
    }
  }

  private commit() {
    this.snapshot = this.sortedTodos();
    window.localStorage.setItem(projectionStorageKey, JSON.stringify(this.snapshot));
    for (const listener of this.listeners) {
      listener();
    }
  }

  private sortedTodos() {
    return Array.from(this.todos.values()).sort((left, right) => left.createdAt - right.createdAt);
  }
}

const isTodo = (input: unknown): input is Todo => {
  if (typeof input !== "object" || input === null) return false;
  const todo = input as Record<string, unknown>;

  return (
    typeof todo.id === "string" &&
    typeof todo.title === "string" &&
    typeof todo.completed === "boolean" &&
    typeof todo.createdAt === "number"
  );
};

export const todoProjection = new TodoProjectionStore();

const replicaTodoCreatedHandler = EventHandler.make(
  todoCreated,
  (event) =>
    Effect.sync(() => {
      todoProjection.applyCreated({
        id: event.eventDetails.id,
        title: event.eventDetails.title,
        completed: false,
        createdAt: event.eventDetails.createdAt,
      });
    }),
);

const replicaTodoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  (event) =>
    Effect.sync(() => {
      todoProjection.setCompleted(event.eventDetails.id, event.eventDetails.completed);
    }),
);

const replicaTodoDeletedHandler = EventHandler.make(
  todoDeleted,
  (event) =>
    Effect.sync(() => {
      todoProjection.delete(event.eventDetails.id);
    }),
);

const eventFromWire = (event: WireEvent) =>
  new EventInstance.EventInstance({
    eventId: event.eventId,
    eventType: event.eventType,
    eventDetails: event.eventDetails,
  });

const eventToWire = (event: EventInstance.EventInstance): WireEvent => ({
  eventId: event.eventId,
  eventType: event.eventType,
  eventDetails: event.eventDetails,
});

const pull: PrimarySyncEngine.IPrimarySyncEngine["pull"] = (cursor) =>
  Effect.tryPromise({
    async try() {
      const url = new URL("/api/sync/pull", window.location.origin);
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Pull failed with ${response.status}`);
      }

      const page = (await response.json()) as PullResponse;
      const data = page.data.map(eventFromWire);

      return page.hasNext
        ? { data, hasNext: true as const, cursor: page.cursor }
        : { data, hasNext: false as const };
    },
    catch: (error) => error,
  }).pipe(Effect.orDie);

const push: PrimarySyncEngine.IPrimarySyncEngine["push"] = (...events) =>
  Effect.tryPromise({
    async try() {
      const response = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: events.map(eventToWire) }),
      });

      if (!response.ok) {
        throw new Error(`Push failed with ${response.status}`);
      }

      return (await response.json()) as PushResponse;
    },
    catch: (error) => error,
  }).pipe(
    Effect.map((response) =>
      response.results.map((result) =>
        result.ok
          ? Result.succeed(eventFromWire(result.event))
          : Result.fail(eventFromWire(result.event)),
      ),
    ),
    Effect.orDie,
  );

const HttpPrimarySyncEngineLayer = Layer.succeed(
  PrimarySyncEngine.PrimarySyncEngine,
  PrimarySyncEngine.PrimarySyncEngine.of({ pull, push }),
);

const ReplicaEventRouterLayer = EventRouter.layer({
  handlers: [
    replicaTodoCreatedHandler,
    replicaTodoCompletionSetHandler,
    replicaTodoDeletedHandler,
  ],
});

const ReplicaDatabaseLayer = IndexedDbReplicaSyncEngine.databaseLayer(
  "converge-react-todos-replica",
).pipe(Layer.provide(IndexedDb.layerWindow));

const ReplicaTodoLayer = IndexedDbReplicaSyncEngine.layer.pipe(
  Layer.provide(ReplicaEventRouterLayer),
  Layer.provide(ReplicaDatabaseLayer),
  Layer.provideMerge(HttpPrimarySyncEngineLayer),
);

const replicaRuntime = ManagedRuntime.make(ReplicaTodoLayer, {
  memoMap: Layer.makeMemoMapUnsafe(),
});

const makeTodoId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `todo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const runReplica = <A, E>(
  effect: Effect.Effect<A, E, ReplicaSyncEngine.ReplicaSyncEngine>,
) => replicaRuntime.runPromise(effect);

export const createTodo = (title: string) => {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return Promise.resolve();

  return runReplica(
    Effect.gen(function* () {
      const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
      const event = yield* EventInstance.make(todoCreated, {
        id: makeTodoId(),
        title: trimmedTitle,
        createdAt: Date.now(),
      });

      yield* replica.push(event);
    }),
  );
};

export const setTodoCompleted = (id: string, completed: boolean) =>
  runReplica(
    Effect.gen(function* () {
      const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
      const event = yield* EventInstance.make(todoCompletionSet, { id, completed });

      yield* replica.push(event);
    }),
  );

export const deleteTodo = (id: string) =>
  runReplica(
    Effect.gen(function* () {
      const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
      const event = yield* EventInstance.make(todoDeleted, { id });

      yield* replica.push(event);
    }),
  );

export const syncTodos = () =>
  runReplica(
    Effect.gen(function* () {
      const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;

      yield* replica.poke();
    }),
  );
