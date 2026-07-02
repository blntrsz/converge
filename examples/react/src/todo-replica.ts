import { IndexedDb } from "@effect/platform-browser";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { EventHandler, EventInstance, EventRouter } from "converge/event";
import {
  HttpPrimarySyncEngine,
} from "converge/primary-sync-engine";
import {
  HttpProjectionBootstrap,
  ReplicaProjectionBootstrap,
} from "converge/projection-bootstrap";
import {
  IndexedDbProjection,
  OptimisticOverlay,
  Projection,
  VisibleProjection,
} from "converge/projection";
import {
  IndexedDbReplicaSyncEngine,
  OptimisticEventApplier,
  ReplicaSyncEngine,
} from "converge/replica-sync-engine";
import { findTodoReduce } from "./todo-reducers.ts";
import {
  todoCompletionSet,
  todoCreated,
  todoDeleted,
  TodoListSchema,
  type Todo,
} from "./todo-events.ts";

const projectionStorageKey = "converge-react.todos";
const todosProjectionKey = "todos";

export class TodoProjection extends Context.Service<
  TodoProjection,
  Projection.IReactiveProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("TodoProjection") {}

export class TodoOverlay extends Context.Service<
  TodoOverlay,
  OptimisticOverlay.IOptimisticOverlay<ReadonlyArray<Todo>>
>()("TodoOverlay") {}

export class TodoVisibleProjection extends Context.Service<
  TodoVisibleProjection,
  VisibleProjection.IVisibleProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("TodoVisibleProjection") {}

const saveTodos = (projection: Projection.IReactiveProjection<ReadonlyArray<Todo>>) =>
  (todos: ReadonlyArray<Todo>) =>
    projection.mutation(() => [todos, undefined] as const);

const replicaTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const projection = yield* TodoProjection;
    const todos = yield* projection.query((snapshot) => snapshot);
    const reduce = findTodoReduce(event.eventType);
    if (!reduce) {
      return;
    }

    yield* saveTodos(projection)(reduce(todos, event));
  }),
);

const replicaTodoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const projection = yield* TodoProjection;
    const todos = yield* projection.query((snapshot) => snapshot);
    const reduce = findTodoReduce(event.eventType);
    if (!reduce) {
      return;
    }

    yield* saveTodos(projection)(reduce(todos, event));
  }),
);

const replicaTodoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* (event) {
    const projection = yield* TodoProjection;
    const todos = yield* projection.query((snapshot) => snapshot);
    const reduce = findTodoReduce(event.eventType);
    if (!reduce) {
      return;
    }

    yield* saveTodos(projection)(reduce(todos, event));
  }),
);

const HttpPrimarySyncEngineLayer = HttpPrimarySyncEngine.layer({
  baseUrl: "/api/sync",
});

const HttpProjectionBootstrapLayer = HttpProjectionBootstrap.clientLayer({
  baseUrl: "/api/sync",
});

const ReplicaEventRouterLayer = EventRouter.layer({
  handlers: [replicaTodoCreatedHandler, replicaTodoCompletionSetHandler, replicaTodoDeletedHandler],
});

const TodoProjectionLayer = IndexedDbProjection.indexedDbLayer(TodoProjection, {
  databaseName: "converge-react-todos-projection",
  key: projectionStorageKey,
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
}).pipe(Layer.provide(IndexedDb.layerWindow));

const TodoOverlayLayer = Layer.effect(
  TodoOverlay,
  Effect.gen(function* () {
    const projection = yield* TodoProjection;
    return yield* OptimisticOverlay.make({
      projection,
      findReduce: findTodoReduce,
    });
  }),
).pipe(Layer.provide(TodoProjectionLayer));

const TodoVisibleProjectionLayer = Layer.effect(
  TodoVisibleProjection,
  Effect.gen(function* () {
    const projection = yield* TodoProjection;
    const overlay = yield* TodoOverlay;
    return VisibleProjection.make(projection, overlay);
  }),
).pipe(Layer.provide(TodoOverlayLayer));

const ReplicaProjectionBootstrapLayer = ReplicaProjectionBootstrap.replicaLayer([
  {
    key: todosProjectionKey,
    importSnapshot: (snapshot) =>
      Effect.gen(function* () {
        const projection = yield* TodoProjection;
        const todos = yield* Schema.decodeUnknown(TodoListSchema)(snapshot);
        yield* saveTodos(projection)(todos);
      }),
  },
]);

const ReplicaDatabaseLayer = IndexedDbReplicaSyncEngine.databaseLayer(
  "converge-react-todos-replica",
).pipe(Layer.provide(IndexedDb.layerWindow));

const ReplicaTodoLayer = IndexedDbReplicaSyncEngine.layer.pipe(
  Layer.provide(ReplicaEventRouterLayer),
  Layer.provide(ReplicaDatabaseLayer),
  Layer.provideMerge(TodoProjectionLayer),
  Layer.provideMerge(TodoOverlayLayer),
  Layer.provideMerge(TodoVisibleProjectionLayer),
  Layer.provideMerge(ReplicaProjectionBootstrapLayer),
  Layer.provideMerge(HttpPrimarySyncEngineLayer),
  Layer.provideMerge(HttpProjectionBootstrapLayer),
  Layer.provide(
    Layer.effect(
      OptimisticEventApplier.OptimisticEventApplier,
      Effect.gen(function* () {
        const overlay = yield* TodoOverlay;
        return OptimisticEventApplier.OptimisticEventApplier.of({
          apply: overlay.apply,
          remove: overlay.remove,
          clear: overlay.clear,
        });
      }),
    ).pipe(Layer.provide(TodoOverlayLayer)),
  ),
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

export const getTodoProjection = () => replicaRuntime.runPromise(TodoVisibleProjection);

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

export const checkoutTodos = (syncAnchor: string) =>
  runReplica(
    Effect.gen(function* () {
      const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;

      yield* replica.checkout(syncAnchor);
    }),
  );

export const returnTodosToLatest = () =>
  runReplica(
    Effect.gen(function* () {
      const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;

      yield* replica.setLatest();
    }),
  );
