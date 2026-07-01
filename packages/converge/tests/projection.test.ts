import { IndexedDb } from "@effect/platform-browser";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { Event, EventHandler, EventInstance } from "../src/index.ts";
import * as Projection from "../src/projection/index.ts";

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
  Projection.IProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("TodoProjection") {}

const sortTodos = (todos: ReadonlyArray<Todo>) =>
  [...todos].sort((left, right) => left.createdAt - right.createdAt);

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const projection = yield* TodoProjection;
    const todos = yield* projection.get;

    if (todos.some((todo) => todo.id === event.eventDetails.id)) {
      return;
    }

    yield* projection.set(
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

const todoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const projection = yield* TodoProjection;
    const todos = yield* projection.get;

    yield* projection.set(
      todos.map((todo) =>
        todo.id === event.eventDetails.id
          ? { ...todo, completed: event.eventDetails.completed }
          : todo,
      ),
    );
  }),
);

const FakeIndexedDbLayer = Layer.succeed(
  IndexedDb.IndexedDb,
  IndexedDb.make({ indexedDB, IDBKeyRange }),
);

const memoryProjectionLayer = Projection.memoryLayer(TodoProjection, {
  initialValue: [] as ReadonlyArray<Todo>,
});

const indexedDbProjectionLayer = (databaseName: string) =>
  Projection.indexedDbLayer(TodoProjection, {
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
      const snapshot = yield* projection.get;

      assert.deepStrictEqual(snapshot, [
        { id: "1", title: "Buy milk", completed: false, createdAt: 1 },
      ]);
    }).pipe(Effect.provide(memoryProjectionLayer)),
  );

  it.effect("notifies subscribers and updates the Effect Atom", () =>
    Effect.gen(function* () {
      const projection = yield* TodoProjection;
      let notifications = 0;
      const unsubscribeProjection = yield* projection.subscribe(() => {
        notifications += 1;
      });
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

      assert.strictEqual(notifications, 1);
      assert.deepStrictEqual(registry.get(projection.atom), [
        { id: "1", title: "Buy milk", completed: false, createdAt: 1 },
      ]);

      unsubscribeProjection();
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
        return yield* projection.get;
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
        const api = yield* Projection.ProjectionDatabase.getQueryBuilder;
        yield* api.from("projection_snapshots").upsert({
          key: "todos",
          snapshot: [{ id: 1, title: "Invalid" }],
        });
      }).pipe(
        Effect.provide(Projection.databaseLayer(databaseName)),
        Effect.provide(FakeIndexedDbLayer),
      );

      const snapshot = yield* Effect.gen(function* () {
        const projection = yield* TodoProjection;
        return yield* projection.get;
      }).pipe(Effect.provide(layer));

      assert.deepStrictEqual(snapshot, []);
    }),
  );
});
