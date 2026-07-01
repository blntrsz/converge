import { IndexedDb } from "@effect/platform-browser";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { Event, EventHandler, EventInstance } from "../src/index.ts";
import * as IndexedDbProjection from "../src/projection/layers/indexeddb-projection.ts";
import * as MemoryProjection from "../src/projection/layers/memory-projection.ts";
import * as Projection from "../src/projection/services/projection.ts";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
});

const todoCompletionSet = Event.make("todo.completion-set.v1", {
  id: Schema.String,
  completed: Schema.Boolean,
});

const TodoSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.Number,
});

const TodoListSchema = Schema.Array(TodoSchema);

type Todo = Schema.Schema.Type<typeof TodoSchema>;

class TodoProjection extends Context.Service<
  TodoProjection,
  Projection.IReactiveProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("TodoProjection") {}

const sortTodos = (todos: ReadonlyArray<Todo>) =>
  [...todos].sort((left, right) => left.createdAt - right.createdAt);

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const projection = yield* TodoProjection;

    yield* projection.mutation((todos) => {
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

const todoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const projection = yield* TodoProjection;

    yield* projection.mutation((todos) => [
      todos.map((todo) =>
        todo.id === event.eventDetails.id
          ? { ...todo, completed: event.eventDetails.completed }
          : todo,
      ),
      undefined,
    ] as const);
  }),
);

const FakeIndexedDbLayer = Layer.succeed(
  IndexedDb.IndexedDb,
  IndexedDb.make({ indexedDB, IDBKeyRange }),
);

const memoryProjectionLayer = MemoryProjection.memoryLayer(TodoProjection, {
  initialValue: [] as ReadonlyArray<Todo>,
});

const indexedDbProjectionLayer = (databaseName: string) =>
  IndexedDbProjection.indexedDbLayer(TodoProjection, {
    databaseName,
    key: "todos",
    schema: TodoListSchema,
    initialValue: [] as ReadonlyArray<Todo>,
  }).pipe(Layer.provide(FakeIndexedDbLayer));

describe("Projection", () => {
  it.effect("lets event handlers update an injected projection service", () =>
    Effect.gen(function* () {
      const event = yield* EventInstance.make(todoCreated, {
        id: "1",
        title: "Buy milk",
        createdAt: 1,
      });

      yield* todoCreatedHandler.run(event);

      const projection = yield* TodoProjection;
      const snapshot = yield* projection.query((todos) => todos);

      assert.deepStrictEqual(snapshot, [
        { id: "1", title: "Buy milk", completed: false, createdAt: 1 },
      ]);
    }).pipe(Effect.provide(memoryProjectionLayer)),
  );

  it.effect("updates the Effect Atom on mutation", () =>
    Effect.gen(function* () {
      const projection = yield* TodoProjection;
      const registry = AtomRegistry.make({
        scheduleTask: (run) => {
          run();
          return () => undefined;
        },
      });
      const unsubscribeAtom = registry.subscribe(projection.atom, () => undefined);

      assert.deepStrictEqual(registry.get(projection.atom), []);

      const event = yield* EventInstance.make(todoCreated, {
        id: "1",
        title: "Buy milk",
        createdAt: 1,
      });

      yield* todoCreatedHandler.run(event);

      assert.deepStrictEqual(registry.get(projection.atom), [
        { id: "1", title: "Buy milk", completed: false, createdAt: 1 },
      ]);

      unsubscribeAtom();
      registry.dispose();
    }).pipe(Effect.provide(memoryProjectionLayer)),
  );

  it.effect("persists and hydrates snapshots with IndexedDB", () =>
    Effect.gen(function* () {
      const databaseName = `projection-${Date.now()}-${Math.random()}`;
      const writeLayer = indexedDbProjectionLayer(databaseName);
      const readLayer = indexedDbProjectionLayer(databaseName);

      yield* Effect.gen(function* () {
        const event = yield* EventInstance.make(todoCreated, {
          id: "1",
          title: "Stored",
          createdAt: 1,
        });
        yield* todoCreatedHandler.run(event);
        yield* todoCompletionSetHandler.run(
          yield* EventInstance.make(todoCompletionSet, {
            id: "1",
            completed: true,
          }),
        );
      }).pipe(Effect.provide(writeLayer));

      const hydrated = yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;
        return yield* projection.query((todos) => todos);
      }).pipe(Effect.provide(readLayer));

      assert.deepStrictEqual(hydrated, [
        { id: "1", title: "Stored", completed: true, createdAt: 1 },
      ]);
    }),
  );

  it.effect("falls back to initial snapshot for invalid IndexedDB data", () =>
    Effect.gen(function* () {
      const databaseName = `projection-invalid-${Date.now()}-${Math.random()}`;
      const layer = indexedDbProjectionLayer(databaseName);

      yield* Effect.gen(function* () {
        const api = yield* IndexedDbProjection.ProjectionDatabase.getQueryBuilder;
        yield* api.from("projection_snapshots").upsert({
          key: "todos",
          snapshot: [{ id: 1, title: "Invalid" }],
        });
      }).pipe(
        Effect.provide(IndexedDbProjection.databaseLayer(databaseName)),
        Effect.provide(FakeIndexedDbLayer),
      );

      const snapshot = yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;
        return yield* projection.query((todos) => todos);
      }).pipe(Effect.provide(layer));

      assert.deepStrictEqual(snapshot, []);
    }),
  );

  it.effect("keeps optimistic mutations in memory without persisting them", () =>
    Effect.gen(function* () {
      const databaseName = `projection-optimistic-${Date.now()}-${Math.random()}`;
      const writeLayer = indexedDbProjectionLayer(databaseName);
      const readLayer = indexedDbProjectionLayer(databaseName);

      yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;

        yield* projection.mutation(() => [
          [{ id: "1", title: "Persisted", completed: false, createdAt: 1 }],
          undefined,
        ] as const);

        yield* projection.optimisticMutation(() => [
          [
            { id: "1", title: "Persisted", completed: false, createdAt: 1 },
            { id: "2", title: "Optimistic", completed: false, createdAt: 2 },
          ],
          undefined,
        ] as const);

        const visible = yield* projection.query((todos) => todos);
        assert.deepStrictEqual(visible, [
          { id: "1", title: "Persisted", completed: false, createdAt: 1 },
          { id: "2", title: "Optimistic", completed: false, createdAt: 2 },
        ]);
      }).pipe(Effect.provide(writeLayer));

      const hydrated = yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;
        return yield* projection.query((todos) => todos);
      }).pipe(Effect.provide(readLayer));

      assert.deepStrictEqual(hydrated, [
        { id: "1", title: "Persisted", completed: false, createdAt: 1 },
      ]);
    }),
  );

  it.effect("reconciles optimistic mutations after a normal mutation", () =>
    Effect.gen(function* () {
      const projection = yield* TodoProjection;

      yield* projection.mutation(() => [
        [{ id: "1", title: "Persisted", completed: false, createdAt: 1 }],
        undefined,
      ] as const);

      const addOptimisticTodo = (todos: ReadonlyArray<Todo>) =>
        [
          [
            ...todos,
            { id: "2", title: "Optimistic", completed: false, createdAt: 2 },
          ],
          undefined,
        ] as const;

      yield* projection.optimisticMutation(addOptimisticTodo);

      yield* projection.mutation(() => [
        [
          { id: "1", title: "Persisted", completed: false, createdAt: 1 },
          { id: "3", title: "Server", completed: false, createdAt: 3 },
        ],
        undefined,
      ] as const);

      const visible = yield* projection.query((todos) => todos);
      assert.deepStrictEqual(visible, [
        { id: "1", title: "Persisted", completed: false, createdAt: 1 },
        { id: "3", title: "Server", completed: false, createdAt: 3 },
        { id: "2", title: "Optimistic", completed: false, createdAt: 2 },
      ]);
    }).pipe(Effect.provide(memoryProjectionLayer)),
  );
});
