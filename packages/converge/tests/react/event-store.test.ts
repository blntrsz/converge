import { IndexedDb } from "@effect/platform-browser";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { Event, EventHandler, EventInstance } from "../../src/event/index.ts";
import { PrimarySyncEngine } from "../../src/primary-sync-engine/index.ts";
import { indexeddbProjection } from "../../src/react/indexeddb-projection.ts";
import { createEventStoreRuntime } from "../../src/react/event-store-runtime.ts";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
});

const TodoSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.Number,
});

const TodoListSchema = Schema.Array(TodoSchema);

type Todo = Schema.Schema.Type<typeof TodoSchema>;

const todoProjection = indexeddbProjection({
  key: "todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
  databaseName: "event-store-test",
});

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const store = yield* todoProjection.store;

    yield* store.update((todos) => {
      if (todos.some((todo) => todo.id === event.eventDetails.id)) {
        return [todos, undefined] as const;
      }

      return [
        [
          ...todos,
          {
            id: event.eventDetails.id,
            title: event.eventDetails.title,
            completed: false,
            createdAt: event.eventDetails.createdAt,
          },
        ],
        undefined,
      ] as const;
    });
  }),
);

const FakeIndexedDbLayer = Layer.succeed(
  IndexedDb.IndexedDb,
  IndexedDb.make({ indexedDB, IDBKeyRange }),
);

const MockPrimarySyncEngineLayer = Layer.succeed(
  PrimarySyncEngine.PrimarySyncEngine,
  PrimarySyncEngine.PrimarySyncEngine.of({
    pull: () => Effect.succeed({ data: [], hasNext: false as const }),
    push: (...events) =>
      Effect.succeed(
        events.map((event) => Result.succeed(event) as Result.Result<typeof event, typeof event>),
      ),
    getLatestEvent: () => Effect.succeed(Option.none()),
    getEvent: () => Effect.succeed(Option.none()),
  }),
);

describe("createEventStoreRuntime", () => {
  it.effect("activates projections and exposes their atoms", () =>
    Effect.gen(function* () {
      const runtime = createEventStoreRuntime({
        handlers: [todoCreatedHandler],
        projections: [todoProjection],
        replicaDatabaseName: "event-store-replica-test",
        primarySyncEngineLayer: MockPrimarySyncEngineLayer,
        indexedDbLayer: FakeIndexedDbLayer,
      });

      yield* runtime.activate;

      const registry = AtomRegistry.make({
        scheduleTask: (run) => {
          run();
          return () => undefined;
        },
      });
      const unsubscribe = registry.subscribe(todoProjection.atom, () => undefined);

      assert.deepStrictEqual(registry.get(todoProjection.atom), []);

      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("commit pushes an event and updates the projection atom optimistically", () =>
    Effect.gen(function* () {
      const runtime = createEventStoreRuntime({
        handlers: [todoCreatedHandler],
        projections: [todoProjection],
        replicaDatabaseName: `event-store-replica-${Date.now()}`,
        primarySyncEngineLayer: MockPrimarySyncEngineLayer,
        indexedDbLayer: FakeIndexedDbLayer,
      });

      yield* runtime.activate;

      const registry = AtomRegistry.make({
        scheduleTask: (run) => {
          run();
          return () => undefined;
        },
      });
      const unsubscribe = registry.subscribe(todoProjection.atom, () => undefined);

      const event = yield* EventInstance.make(todoCreated, {
        id: "todo-1",
        title: "Buy milk",
        createdAt: 1,
      });

      yield* runtime.commit(event);

      assert.deepStrictEqual(registry.get(todoProjection.atom), [
        { id: "todo-1", title: "Buy milk", completed: false, createdAt: 1 },
      ]);

      unsubscribe();
      registry.dispose();
    }),
  );
});
