import { IndexedDb } from "@effect/platform-browser";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { EventHandler, EventInstance, EventRouter } from "converge/event";
import { HttpPrimarySyncEngine } from "converge/primary-sync-engine";
import { IndexedDbProjection, Projection } from "converge/projection";
import { IndexedDbReplicaSyncEngine, ReplicaSyncEngine } from "converge/replica-sync-engine";
import {
  todoCompletionSet,
  todoCreated,
  todoDeleted,
  TodoListSchema,
  type Todo,
} from "./todo-events";

const projectionStorageKey = "converge-react.todos";

export class TodoProjection extends Context.Service<
  TodoProjection,
  Projection.IReactiveProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("TodoProjection") {}

const sortTodos = (todos: ReadonlyArray<Todo>) =>
  [...todos].sort((left, right) => left.createdAt - right.createdAt);

const replicaTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const todosProjection = yield* TodoProjection;

    yield* todosProjection.mutation((todos) => {
      if (todos.some((todo) => todo.id === event.eventDetails.id)) {
        return [todos, undefined] as const;
      }

      return [
        sortTodos([
          ...todos,
          {
            id: event.eventDetails.id,
            title: event.eventDetails.title,
            completed: false,
            createdAt: event.eventDetails.createdAt,
          },
        ]),
        undefined,
      ] as const;
    });
  }),
);

const replicaTodoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const todosProjection = yield* TodoProjection;

    yield* todosProjection.mutation((todos) => [
      todos.map((todo) =>
        todo.id === event.eventDetails.id
          ? { ...todo, completed: event.eventDetails.completed }
          : todo,
      ),
      undefined,
    ] as const);
  }),
);

const replicaTodoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* (event) {
    const todosProjection = yield* TodoProjection;

    yield* todosProjection.mutation((todos) => [
      todos.filter((todo) => todo.id !== event.eventDetails.id),
      undefined,
    ] as const);
  }),
);

const HttpPrimarySyncEngineLayer = HttpPrimarySyncEngine.layer({
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

const ReplicaDatabaseLayer = IndexedDbReplicaSyncEngine.databaseLayer(
  "converge-react-todos-replica",
).pipe(Layer.provide(IndexedDb.layerWindow));

const ReplicaTodoLayer = IndexedDbReplicaSyncEngine.layer.pipe(
  Layer.provide(ReplicaEventRouterLayer),
  Layer.provide(ReplicaDatabaseLayer),
  Layer.provideMerge(TodoProjectionLayer),
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
