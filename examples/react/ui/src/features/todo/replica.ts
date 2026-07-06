import { IndexedDb } from "@effect/platform-browser";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { EventHandler, EventInstance, EventRouter } from "converge/event";
import { HttpPrimarySyncEngine } from "converge/primary-sync-engine";
import {
  IndexedDbReplicaProjection,
  PrimaryProjection,
  ReplicaProjection,
} from "converge/projection";
import {
  IndexedDbReplicaSyncEngine,
  ReplicaApplyContext,
  ReplicaSyncEngine,
} from "converge/replica-sync-engine";
import {
  addTodo,
  removeTodo,
  setTodoCompletion,
  todoCompletionSet,
  todoCreated,
  todoDeleted,
  TodoListSchema,
  type Type,
} from "@converge/react-core/features/todos";

const projectionStorageKey = "converge-react.todos";

export class TodoProjection extends Context.Service<
  TodoProjection,
  ReplicaProjection.IReactiveReplicaProjection<
    ReadonlyArray<Type>,
    ReplicaProjection.ReplicaProjectionStorageError
  >
>()("TodoProjection") {}

class TodoProjectionStore extends Context.Service<
  TodoProjectionStore,
  ReplicaProjection.IReplicaProjectionStore<
    ReadonlyArray<Type>,
    ReplicaProjection.ReplicaProjectionStorageError
  >
>()("TodoProjectionStore") {}

const HttpPrimarySyncEngineLayer = HttpPrimarySyncEngine.layer({
  baseUrl: "/api/sync",
});

const ReplicaEventRouterLayer = EventRouter.layer({
  handlers: [replicaTodoCreatedHandler, replicaTodoCompletionSetHandler, replicaTodoDeletedHandler],
});

const ReplicaApplyContextLayer = ReplicaApplyContext.layer;

const TodoProjectionLayer = IndexedDbReplicaProjection.indexedDbReplicaLayer(TodoProjection, {
  databaseName: "converge-react-todos-projection",
  key: projectionStorageKey,
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Type>,
  store: TodoProjectionStore,
}).pipe(Layer.provide(ReplicaApplyContextLayer), Layer.provide(IndexedDb.layerWindow));

const ReplicaProjectionRouterLayer = ReplicaProjection.routerLayer({
  projections: [
    {
      key: projectionStorageKey,
      projection: TodoProjection,
    },
  ],
}).pipe(Layer.provideMerge(TodoProjectionLayer));

const ReplicaDatabaseLayer = IndexedDbReplicaSyncEngine.databaseLayer(
  "converge-react-todos-replica",
).pipe(Layer.provide(IndexedDb.layerWindow));

const ReplicaTodoLayer = IndexedDbReplicaSyncEngine.layer.pipe(
  Layer.provide(ReplicaEventRouterLayer),
  Layer.provide(ReplicaDatabaseLayer),
  Layer.provideMerge(ReplicaApplyContextLayer),
  Layer.provideMerge(PrimaryProjection.emptyLayer),
  Layer.provideMerge(ReplicaProjectionRouterLayer),
  Layer.provideMerge(HttpPrimarySyncEngineLayer),
);

const replicaRuntime = ManagedRuntime.make(ReplicaTodoLayer, {
  memoMap: Layer.makeMemoMapUnsafe(),
});

const makeTodoId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `todo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const runReplica = <A, E>(effect: Effect.Effect<A, E, ReplicaSyncEngine.ReplicaSyncEngine>) =>
  replicaRuntime.runPromise(effect);

export const getTodoProjection = () => replicaRuntime.runPromise(TodoProjection);

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
