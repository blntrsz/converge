import { IndexedDb } from "@effect/platform-browser";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { Event, EventHandler, EventInstance } from "../src/index.ts";
import { IndexedDbReplicaSyncEngine, ReplicaApplyContext, ReplicaProjection } from "converge";

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

const TodoProjection = ReplicaProjection.define({
  key: "todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
});

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const store = yield* TodoProjection.store;

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

const browserReplica = IndexedDbReplicaSyncEngine.browserLayer({
  handlers: [todoCreatedHandler],
  projection: [TodoProjection],
  primary: { baseUrl: "http://localhost:0/api/sync" },
});

const layer = browserReplica.layer.pipe(Layer.provide(FakeIndexedDbLayer));
const runtime = Atom.runtime(layer);
const atom = TodoProjection.atom(runtime);

describe("IndexedDbReplicaSyncEngine.browserLayer", () => {
  it.effect("wires projection store handlers", () =>
    Effect.gen(function* () {
      const event = yield* EventInstance.make(todoCreated, {
        id: "1",
        title: "Buy milk",
        createdAt: 1,
      });

      yield* todoCreatedHandler.run(event);

      const projection = yield* TodoProjection.tag;
      const snapshot = yield* projection.query((todos) => todos);

      assert.deepStrictEqual(snapshot, [
        { id: "1", title: "Buy milk", completed: false, createdAt: 1 },
      ]);
    }).pipe(
      Effect.provide(
        TodoProjection.projectionLayer.pipe(
          Layer.provideMerge(ReplicaApplyContext.layer),
          Layer.provide(FakeIndexedDbLayer),
        ),
      ),
    ),
  );

  it.effect("exposes a reactive atom for a single projection", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make({
        scheduleTask: (run) => {
          run();
          return () => undefined;
        },
        initialValues: [Atom.initialValue(runtime.layer, layer)],
      });
      const unsubscribe = registry.subscribe(atom, () => undefined);

      assert.deepStrictEqual(registry.get(atom), []);

      unsubscribe();
      registry.dispose();
    }),
  );
});
