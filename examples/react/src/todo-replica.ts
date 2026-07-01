import { IndexedDb } from "@effect/platform-browser";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import * as EventHandler from "../../../packages/converge/src/event/event-handler.ts";
import * as EventInstance from "../../../packages/converge/src/event/event-instance.ts";
import * as EventRouter from "../../../packages/converge/src/event/event-router.ts";
import * as HttpPrimarySyncEngine from "../../../packages/converge/src/primary-sync-engine/layers/http-primary-sync-engine.ts";
import * as Projection from "../../../packages/converge/src/projection/index.ts";
import * as IndexedDbReplicaSyncEngine from "../../../packages/converge/src/replica-sync-engine/layers/indexeddb-replica-sync-engine.ts";
import * as ReplicaSyncEngine from "../../../packages/converge/src/replica-sync-engine/services/replica-sync-engine.ts";
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
  Projection.IProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("TodoProjection") {}

const sortTodos = (todos: ReadonlyArray<Todo>) =>
  [...todos].sort((left, right) => left.createdAt - right.createdAt);

const replicaTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const todosProjection = yield* TodoProjection;
    const todos = yield* todosProjection.get;

    if (todos.some((todo) => todo.id === event.eventDetails.id)) {
      return;
    }

    yield* todosProjection.set(
      sortTodos([
        ...todos,
        {
          id: event.eventDetails.id,
          title: event.eventDetails.title,
          completed: false,
          createdAt: event.eventDetails.createdAt,
        },
      ]),
    );
  }),
);

const replicaTodoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const todosProjection = yield* TodoProjection;
    const todos = yield* todosProjection.get;

    yield* todosProjection.set(
      todos.map((todo) =>
        todo.id === event.eventDetails.id
          ? { ...todo, completed: event.eventDetails.completed }
          : todo,
      ),
    );
  }),
);

const replicaTodoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* (event) {
    const todosProjection = yield* TodoProjection;
    const todos = yield* todosProjection.get;

    yield* todosProjection.set(todos.filter((todo) => todo.id !== event.eventDetails.id));
  }),
);

const HttpPrimarySyncEngineLayer = HttpPrimarySyncEngine.layer({
  baseUrl: "/api/sync",
});

const ReplicaEventRouterLayer = EventRouter.layer({
  handlers: [replicaTodoCreatedHandler, replicaTodoCompletionSetHandler, replicaTodoDeletedHandler],
});

const TodoProjectionLayer = Projection.indexedDbLayer(TodoProjection, {
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
