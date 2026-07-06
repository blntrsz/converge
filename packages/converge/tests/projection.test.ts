import { IndexedDb } from "@effect/platform-browser";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema, Stream } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { Event, EventHandler, EventInstance, ReplicaApplyContext } from "../src/index.ts";
import {
  IndexedDbReplicaProjection,
  MemoryReplicaProjection,
  ReplicaProjection,
} from "converge/projection";

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
  ReplicaProjection.IReactiveReplicaProjection<
    ReadonlyArray<Todo>,
    ReplicaProjection.ReplicaProjectionStorageError,
    Todo
  >
>()("TodoProjection") {}

class TodoProjectionStore extends Context.Service<
  TodoProjectionStore,
  ReplicaProjection.IReplicaProjectionStore<
    ReadonlyArray<Todo>,
    ReplicaProjection.ReplicaProjectionStorageError
  >
>()("TodoProjectionStore") {}

const sortTodos = (todos: ReadonlyArray<Todo>) =>
  [...todos].sort((left, right) => left.createdAt - right.createdAt);

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const store = yield* TodoProjectionStore;

    yield* store.update((todos) => {
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
    const store = yield* TodoProjectionStore;

    yield* store.update(
      (todos) =>
        [
          todos.map((todo) =>
            todo.id === event.eventDetails.id
              ? { ...todo, completed: event.eventDetails.completed }
              : todo,
          ),
          undefined,
        ] as const,
    );
  }),
);

const FakeIndexedDbLayer = Layer.succeed(
  IndexedDb.IndexedDb,
  IndexedDb.make({ indexedDB, IDBKeyRange }),
);

const memoryProjectionLayer = MemoryReplicaProjection.memoryLayer(TodoProjection, {
  initialValue: [] as ReadonlyArray<Todo>,
  store: TodoProjectionStore,
});

const indexedDbProjectionLayer = (databaseName: string) =>
  IndexedDbReplicaProjection.indexedDbLayer(TodoProjection, {
    databaseName,
    key: "todos",
    schema: TodoListSchema,
    initialValue: [] as ReadonlyArray<Todo>,
    store: TodoProjectionStore,
  }).pipe(Layer.provide(FakeIndexedDbLayer));

const indexedDbReplicaProjectionLayer = (databaseName: string) =>
  IndexedDbReplicaProjection.indexedDbReplicaLayer(TodoProjection, {
    databaseName,
    key: "todos",
    schema: TodoListSchema,
    initialValue: [] as ReadonlyArray<Todo>,
    store: TodoProjectionStore,
  }).pipe(Layer.provideMerge(ReplicaApplyContext.layer), Layer.provide(FakeIndexedDbLayer));

const bootstrappingIndexedDbProjectionLayer = (databaseName: string) =>
  IndexedDbReplicaProjection.indexedDbLayer(TodoProjection, {
    databaseName,
    key: "todos",
    schema: TodoListSchema,
    initialValue: [] as ReadonlyArray<Todo>,
    store: TodoProjectionStore,
    bootstrap: (rows: Stream.Stream<Todo, unknown>) =>
      rows.pipe(
        Stream.runCollect,
        Effect.map((snapshot) => Array.from(snapshot)),
      ),
  }).pipe(Layer.provide(FakeIndexedDbLayer));

describe("ReplicaProjection", () => {
  it.effect("lets event handlers update an injected projection store", () =>
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

  it.effect("updates the Effect Atom on store update", () =>
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

  it.effect("bootstraps and persists snapshots with IndexedDB", () =>
    Effect.gen(function* () {
      const databaseName = `projection-bootstrap-${Date.now()}-${Math.random()}`;
      const writeLayer = bootstrappingIndexedDbProjectionLayer(databaseName);
      const readLayer = indexedDbProjectionLayer(databaseName);

      yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;

        yield* projection.bootstrap(
          Stream.make({
            id: "bootstrapped-1",
            title: "Bootstrapped",
            completed: false,
            createdAt: 1,
          }),
        );
      }).pipe(Effect.provide(writeLayer));

      const hydrated = yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;
        return yield* projection.query((todos) => todos);
      }).pipe(Effect.provide(readLayer));

      assert.deepStrictEqual(hydrated, [
        {
          id: "bootstrapped-1",
          title: "Bootstrapped",
          completed: false,
          createdAt: 1,
        },
      ]);
    }),
  );

  it.effect("falls back to initial snapshot for invalid IndexedDB data", () =>
    Effect.gen(function* () {
      const databaseName = `projection-invalid-${Date.now()}-${Math.random()}`;
      const layer = indexedDbProjectionLayer(databaseName);

      yield* Effect.gen(function* () {
        const api = yield* IndexedDbReplicaProjection.ReplicaProjectionDatabase.getQueryBuilder;
        yield* api.from("projection_snapshots").upsert({
          key: "todos",
          snapshot: [{ id: 1, title: "Invalid" }],
        });
      }).pipe(
        Effect.provide(IndexedDbReplicaProjection.databaseLayer(databaseName)),
        Effect.provide(FakeIndexedDbLayer),
      );

      const snapshot = yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;
        return yield* projection.query((todos) => todos);
      }).pipe(Effect.provide(layer));

      assert.deepStrictEqual(snapshot, []);
    }),
  );

  it.effect("keeps optimistic updates in memory without persisting them", () =>
    Effect.gen(function* () {
      const databaseName = `projection-optimistic-${Date.now()}-${Math.random()}`;
      const writeLayer = indexedDbReplicaProjectionLayer(databaseName);
      const readLayer = indexedDbProjectionLayer(databaseName);

      yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;
        const store = yield* TodoProjectionStore;
        const applyContext = yield* ReplicaApplyContext.ReplicaApplyContext;

        yield* applyContext.set({ phase: "accepted", eventId: "event-1" });
        yield* store.update(
          () =>
            [[{ id: "1", title: "Persisted", completed: false, createdAt: 1 }], undefined] as const,
        );

        yield* applyContext.set({ phase: "optimistic", eventId: "event-2" });
        yield* store.update(
          () =>
            [
              [
                { id: "1", title: "Persisted", completed: false, createdAt: 1 },
                { id: "2", title: "Optimistic", completed: false, createdAt: 2 },
              ],
              undefined,
            ] as const,
        );

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

  it.effect("reconciles optimistic updates after an accepted update", () =>
    Effect.gen(function* () {
      const databaseName = `projection-reconcile-${Date.now()}-${Math.random()}`;
      const layer = indexedDbReplicaProjectionLayer(databaseName);

      yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;
        const store = yield* TodoProjectionStore;
        const applyContext = yield* ReplicaApplyContext.ReplicaApplyContext;

        yield* applyContext.set({ phase: "accepted", eventId: "event-1" });
        yield* store.update(
          () =>
            [[{ id: "1", title: "Persisted", completed: false, createdAt: 1 }], undefined] as const,
        );

        const addOptimisticTodo = (todos: ReadonlyArray<Todo>) =>
          [
            [...todos, { id: "2", title: "Optimistic", completed: false, createdAt: 2 }],
            undefined,
          ] as const;

        yield* applyContext.set({ phase: "optimistic", eventId: "event-2" });
        yield* store.update(addOptimisticTodo);

        yield* applyContext.set({ phase: "accepted", eventId: "event-3" });
        yield* store.update(
          () =>
            [
              [
                { id: "1", title: "Persisted", completed: false, createdAt: 1 },
                { id: "3", title: "Server", completed: false, createdAt: 3 },
              ],
              undefined,
            ] as const,
        );

        const visible = yield* projection.query((todos) => todos);
        assert.deepStrictEqual(visible, [
          { id: "1", title: "Persisted", completed: false, createdAt: 1 },
          { id: "3", title: "Server", completed: false, createdAt: 3 },
          { id: "2", title: "Optimistic", completed: false, createdAt: 2 },
        ]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("removes an optimistic update from the visible snapshot", () =>
    Effect.gen(function* () {
      const databaseName = `projection-remove-optimistic-${Date.now()}-${Math.random()}`;
      const layer = indexedDbReplicaProjectionLayer(databaseName);

      yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;
        const store = yield* TodoProjectionStore;
        const applyContext = yield* ReplicaApplyContext.ReplicaApplyContext;

        yield* applyContext.set({ phase: "accepted", eventId: "event-1" });
        yield* store.update(
          () =>
            [[{ id: "1", title: "Persisted", completed: false, createdAt: 1 }], undefined] as const,
        );

        yield* applyContext.set({ phase: "optimistic", eventId: "event-2" });
        yield* store.update(
          (todos) =>
            [
              [...todos, { id: "2", title: "Optimistic", completed: false, createdAt: 2 }],
              undefined,
            ] as const,
        );

        yield* applyContext.set({ phase: "rejected", eventId: "event-2" });
        yield* store.update((todos) => [todos, undefined] as const);

        const visible = yield* projection.query((todos) => todos);
        assert.deepStrictEqual(visible, [
          { id: "1", title: "Persisted", completed: false, createdAt: 1 },
        ]);
      }).pipe(Effect.provide(layer));
    }),
  );
});
