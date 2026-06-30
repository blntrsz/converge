import { IndexedDb } from "@effect/platform-browser";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as EventHandler from "../../../packages/converge/src/event/event-handler.ts";
import * as EventInstance from "../../../packages/converge/src/event/event-instance.ts";
import * as EventRouter from "../../../packages/converge/src/event/event-router.ts";
import * as HttpPrimarySyncEngine from "../../../packages/converge/src/primary-sync-engine/layers/http-primary-sync-engine.ts";
import * as IndexedDbReplicaSyncEngine from "../../../packages/converge/src/replica-sync-engine/layers/indexeddb-replica-sync-engine.ts";
import * as ReplicaSyncEngine from "../../../packages/converge/src/replica-sync-engine/services/replica-sync-engine.ts";
import {
  todoCompletionSet,
  todoCreated,
  todoDeleted,
  type Todo,
} from "./todo-events";

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

const HttpPrimarySyncEngineLayer = HttpPrimarySyncEngine.layer({
  baseUrl: "/api/sync",
});

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
