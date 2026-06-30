import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { Event, EventInstance, type ProjectionKeyValueStorage } from "../src/index.ts";
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

class MemoryStorage implements ProjectionKeyValueStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const sortTodos = (todos: ReadonlyArray<Todo>) =>
  [...todos].sort((left, right) => left.createdAt - right.createdAt);

const makeTodoProjection = (storage: MemoryStorage) =>
  Projection.make({
    name: "todos",
    initialValue: [] as ReadonlyArray<Todo>,
    storage: Projection.localStorage(TodoListSchema, {
      key: "todos",
      storage,
    }),
    reducers: [
      Projection.reducer(todoCreated, (todos: ReadonlyArray<Todo>, event) => {
        if (todos.some((todo) => todo.id === event.eventDetails.id)) {
          return Effect.succeed(todos);
        }

        return Effect.succeed(
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
      Projection.reducer(todoCompletionSet, (todos: ReadonlyArray<Todo>, event) =>
        Effect.succeed(
          todos.map((todo) =>
            todo.id === event.eventDetails.id
              ? { ...todo, completed: event.eventDetails.completed }
              : todo,
          ),
        ),
      ),
    ],
  });

describe("Projection", () => {
  it.effect("applies typed reducers, persists snapshots, and notifies subscribers", () =>
    Effect.gen(function* () {
      const storage = new MemoryStorage();
      const projection = makeTodoProjection(storage);
      let notifications = 0;
      const unsubscribe = projection.subscribe(() => {
        notifications += 1;
      });

      const event = yield* EventInstance.make(todoCreated, {
        id: "1",
        title: "Buy milk",
        createdAt: 1,
      });

      yield* projection.apply(event);

      assert.deepStrictEqual(projection.getSnapshot(), [
        { id: "1", title: "Buy milk", completed: false, createdAt: 1 },
      ]);
      assert.strictEqual(notifications, 1);
      assert.strictEqual(
        storage.getItem("todos"),
        JSON.stringify([{ id: "1", title: "Buy milk", completed: false, createdAt: 1 }]),
      );

      unsubscribe();
    }),
  );

  it.effect("hydrates valid persisted snapshots", () =>
    Effect.sync(() => {
      const storage = new MemoryStorage();
      storage.setItem(
        "todos",
        JSON.stringify([{ id: "1", title: "Stored", completed: true, createdAt: 1 }]),
      );

      const projection = makeTodoProjection(storage);

      assert.deepStrictEqual(projection.getSnapshot(), [
        { id: "1", title: "Stored", completed: true, createdAt: 1 },
      ]);
    }),
  );

  it.effect("falls back to initial snapshot for invalid persisted data", () =>
    Effect.sync(() => {
      const storage = new MemoryStorage();
      storage.setItem("todos", JSON.stringify([{ id: 1, title: "Invalid" }]));

      const projection = makeTodoProjection(storage);

      assert.deepStrictEqual(projection.getSnapshot(), []);
    }),
  );

  it.effect("updates the Effect Atom when the projection changes", () =>
    Effect.gen(function* () {
      const storage = new MemoryStorage();
      const projection = makeTodoProjection(storage);
      const registry = AtomRegistry.make({
        scheduleTask: (run) => {
          run();
          return () => undefined;
        },
      });
      const unsubscribe = registry.subscribe(projection.atom, () => undefined);

      assert.deepStrictEqual(registry.get(projection.atom), []);

      const event = yield* EventInstance.make(todoCreated, {
        id: "1",
        title: "Buy milk",
        createdAt: 1,
      });

      yield* projection.apply(event);

      assert.deepStrictEqual(registry.get(projection.atom), [
        { id: "1", title: "Buy milk", completed: false, createdAt: 1 },
      ]);

      unsubscribe();
      registry.dispose();
    }),
  );
});
