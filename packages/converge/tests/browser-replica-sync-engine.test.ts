import { IndexedDb } from "@effect/platform-browser";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Result, Schema, Stream } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  Event,
  EventHandler,
  EventInstance,
  EventRouter,
  IndexedDbReplicaSyncEngine,
  PrimaryProjection,
  PrimarySyncEngine,
  ReplicaApplyContext,
  ReplicaProjection,
  ReplicaSyncEngine,
} from "../src/index.ts";

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

const SyncedTodoProjection = ReplicaProjection.define({
  key: "synced-todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
  bootstrap: (rows: Stream.Stream<Todo, unknown>) =>
    rows.pipe(
      Stream.runCollect,
      Effect.map((snapshot) => Array.from(snapshot)),
    ),
});

const syncedTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const store = yield* SyncedTodoProjection.store;

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

const waitForEventHistory = (eventId: string) =>
  Effect.gen(function* () {
    const api = yield* IndexedDbReplicaSyncEngine.ReplicaSyncEngineDatabase.getQueryBuilder;
    const eventHistory = api.from("event_history");

    for (let i = 0; i < 50; i++) {
      const rows = yield* eventHistory.select("eventId").equals(eventId).pipe(Effect.orDie);
      if (rows.length > 0) return;
      yield* Effect.sleep("20 millis");
    }

    assert.fail(`expected replica event_history to contain ${eventId}`);
  });

const waitForPullCursor = (cursors: ReadonlyArray<string>, cursor: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i++) {
      if (cursors.includes(cursor)) return;
      yield* Effect.sleep("20 millis");
    }

    assert.fail(
      `expected primary.pull to be called with cursor ${cursor}; actual cursors: ${JSON.stringify(
        cursors,
      )}`,
    );
  });

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

  it.effect(
    "persists pulled accepted events as the next replica cursor",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          const localEvent = yield* EventInstance.make(todoCreated, {
            id: "local",
            title: "Local",
            createdAt: 1,
          });
          const remoteEvent = yield* EventInstance.make(todoCreated, {
            id: "remote",
            title: "Remote",
            createdAt: 2,
          });
          const pullCursors: string[] = [];

          const PrimaryLayer = Layer.succeed(
            PrimarySyncEngine.PrimarySyncEngine,
            PrimarySyncEngine.PrimarySyncEngine.of({
              pull: (cursor) =>
                Effect.sync(() => {
                  pullCursors.push(cursor ?? "");
                  return cursor === localEvent.eventId
                    ? { data: [remoteEvent], hasNext: false as const }
                    : { data: [], hasNext: false as const };
                }),
              push: (...events) => Effect.succeed(events.map((event) => Result.succeed(event))),
              getLatestEvent: () => Effect.succeed(Option.none()),
              getEvent: () => Effect.succeed(Option.none()),
            }),
          );

          const ReplicaDatabaseLayer = IndexedDbReplicaSyncEngine.databaseLayer(
            "browser-replica-sync-cursor-test",
          ).pipe(Layer.provide(FakeIndexedDbLayer));
          const ReplicaProjectionRouterLayer = ReplicaProjection.routerLayer({
            projections: [{ key: SyncedTodoProjection.key, projection: SyncedTodoProjection.tag }],
          }).pipe(Layer.provideMerge(SyncedTodoProjection.projectionLayer));
          const ReplicaLayer = IndexedDbReplicaSyncEngine.makeLayer({
            pullInterval: "1 hour",
          }).pipe(
            Layer.provide(EventRouter.layer({ handlers: [syncedTodoCreatedHandler] })),
            Layer.provideMerge(ReplicaDatabaseLayer),
            Layer.provideMerge(ReplicaApplyContext.layer),
            Layer.provideMerge(PrimaryLayer),
            Layer.provideMerge(PrimaryProjection.emptyLayer),
            Layer.provideMerge(ReplicaProjectionRouterLayer),
            Layer.provide(FakeIndexedDbLayer),
          );

          yield* Effect.gen(function* () {
            const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;

            yield* replica.push(localEvent);
            yield* waitForEventHistory(localEvent.eventId);

            yield* replica.poke();
            yield* waitForEventHistory(remoteEvent.eventId);
            yield* replica.poke();
            yield* waitForPullCursor(pullCursors, remoteEvent.eventId);

            const projection = yield* SyncedTodoProjection.tag;
            const snapshot = yield* projection.query((todos) => todos);

            assert.isTrue(pullCursors.includes(localEvent.eventId));
            assert.deepStrictEqual(
              snapshot.map((todo) => todo.id),
              ["local", "remote"],
            );
          }).pipe(Effect.provide(ReplicaLayer));
        }),
      ),
    30000,
  );
});
