import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import { TestClock } from "effect/testing";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { IndexedDb } from "@effect/platform-browser";
import {
  Event,
  EventHandler,
  EventInstance,
  EventRouter,
  IndexedDbReplicaSyncEngine,
  PostgresPrimarySyncEngine,
  PrimarySyncEngine,
  ReplicaSyncEngine,
} from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  name: Schema.String,
});

let replicaHandlerRuns = 0;

const replicaTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* () {
    yield* Effect.sync(() => {
      replicaHandlerRuns += 1;
    });
  }),
);

const primaryTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO todo ${sql.insert({
        id: event.eventDetails.id,
        name: event.eventDetails.name,
      })}
    `;
  }),
);

const primaryMigrations = Migrator.fromRecord({
  "2_create_todo": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS todo (
        id text PRIMARY KEY,
        name text NOT NULL
      )
    `;
  }),
});

const primaryMigrationsLayer = Layer.effectDiscard(
  Migrator.make({})({ loader: primaryMigrations }),
);

const PgSqlClientWithMigrations = PostgresPrimarySyncEngine.migrationsLayer.pipe(
  Layer.provideMerge(PgliteSqlClient),
);

const PgSqlClientWithAllMigrations = primaryMigrationsLayer.pipe(
  Layer.provideMerge(PgSqlClientWithMigrations),
);

const PrimaryEventRouterLayer = EventRouter.layer({
  handlers: [primaryTodoCreatedHandler],
});

const ReplicaEventRouterLayer = EventRouter.layer({
  handlers: [replicaTodoCreatedHandler],
});

const PrimarySyncEngineLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(PrimaryEventRouterLayer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

const FakeIndexedDbLayer = Layer.succeed(
  IndexedDb.IndexedDb,
  IndexedDb.make({ indexedDB, IDBKeyRange }),
);

const ReplicaDatabaseLayer = IndexedDbReplicaSyncEngine.databaseLayer("test-replica").pipe(
  Layer.provide(FakeIndexedDbLayer),
);

const ReplicaSyncEngineLayer = IndexedDbReplicaSyncEngine.layer.pipe(
  Layer.provide(ReplicaEventRouterLayer),
  Layer.provide(ReplicaDatabaseLayer),
  Layer.provideMerge(PrimarySyncEngineLayer),
);

const resetCounters = () => {
  replicaHandlerRuns = 0;
};

const waitForPrimaryEvent = (eventId: string): Effect.Effect<void, never, PrimarySyncEngine.PrimarySyncEngine> =>
  Effect.gen(function* () {
    const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
    for (let i = 0; i < 200; i++) {
      yield* Effect.sleep("50 millis");
      const page = yield* primary.pull();
      const found = page.data.some((e) => e.eventId === eventId);
      if (found) return;
    }
  });

const waitForReplicaHandler = (target: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i++) {
      yield* Effect.sleep("50 millis");
      if (replicaHandlerRuns >= target) return;
    }
  });

layer(ReplicaSyncEngineLayer)((it) => {
  it.effect(
    "push stores proposed events and forwards to primary, handler runs after confirmation",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
          const sql = yield* SqlClient.SqlClient;

          assert.strictEqual(replicaHandlerRuns, 0);

          const eventInstance = yield* EventInstance.make(todoCreated, {
            id: "1",
            name: "Buy milk",
          });

          yield* replica.push(eventInstance);

          assert.strictEqual(replicaHandlerRuns, 0);

          yield* waitForPrimaryEvent(eventInstance.eventId);
          yield* waitForReplicaHandler(1);

          assert.strictEqual(replicaHandlerRuns, 1);

          const todos = yield* sql<{ id: string; name: string }>`
            SELECT id, name FROM todo WHERE id = ${eventInstance.eventDetails.id}
          `;
          assert.deepStrictEqual(todos, [{ id: "1", name: "Buy milk" }]);
        }),
      ),
    30000,
  );

  it.effect(
    "push is idempotent — pushing the same event twice runs the handler once",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;

          const eventInstance = yield* EventInstance.make(todoCreated, {
            id: "2",
            name: "Buy eggs",
          });

          yield* replica.push(eventInstance);
          yield* replica.push(eventInstance);

          yield* waitForReplicaHandler(1);
          assert.strictEqual(replicaHandlerRuns, 1);
        }),
      ),
    30000,
  );

  it.effect(
    "poke flushes proposed events then pulls accepted events from primary",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;

          const eventInstance = yield* EventInstance.make(todoCreated, {
            id: "3",
            name: "Buy bread",
          });

          yield* replica.push(eventInstance);
          assert.strictEqual(replicaHandlerRuns, 0);

          yield* replica.poke();

          yield* waitForReplicaHandler(1);
          assert.strictEqual(replicaHandlerRuns, 1);

          const eventHistory = yield* primary.pull();
          const found = eventHistory.data.some((e) => e.eventId === eventInstance.eventId);
          assert.isTrue(found);
        }),
      ),
    30000,
  );

  it.effect(
    "poke is idempotent — events already applied locally are skipped",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;

          const eventInstance = yield* EventInstance.make(todoCreated, {
            id: "4",
            name: "Buy butter",
          });

          yield* primary.push(eventInstance);

          yield* replica.poke();
          yield* waitForReplicaHandler(1);
          assert.strictEqual(replicaHandlerRuns, 1);

          yield* replica.poke();
          yield* waitForReplicaHandler(2);
          assert.strictEqual(replicaHandlerRuns, 1);
        }),
      ),
    30000,
  );
});
