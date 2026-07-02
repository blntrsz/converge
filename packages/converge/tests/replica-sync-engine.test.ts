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
  PrimaryProjectionBootstrap,
  PrimarySyncEngine,
  ReplicaApplyContext,
  ReplicaSyncEngine,
} from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  name: Schema.String,
});

let replicaHandlerRuns = 0;
let optimisticHandlerRuns = 0;
let acceptedHandlerRuns = 0;
let rejectedHandlerRuns = 0;

const replicaTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* () {
    const applyContext = yield* ReplicaApplyContext.ReplicaApplyContext;
    const { phase } = yield* applyContext.current;

    yield* Effect.sync(() => {
      replicaHandlerRuns += 1;
      if (phase === "optimistic") {
        optimisticHandlerRuns += 1;
      } else if (phase === "accepted") {
        acceptedHandlerRuns += 1;
      } else {
        rejectedHandlerRuns += 1;
      }
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

const PrimaryProjectionBootstrapLayer = PrimaryProjectionBootstrap.layer({
  encoders: [],
});

const ReplicaEventRouterLayer = EventRouter.layer({
  handlers: [replicaTodoCreatedHandler],
});

const PrimarySyncEngineLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(PrimaryEventRouterLayer),
  Layer.provideMerge(PrimaryProjectionBootstrapLayer),
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
  Layer.provideMerge(ReplicaDatabaseLayer),
  Layer.provideMerge(ReplicaApplyContext.layer),
  Layer.provideMerge(PrimarySyncEngineLayer),
);

const resetCounters = () => {
  replicaHandlerRuns = 0;
  optimisticHandlerRuns = 0;
  acceptedHandlerRuns = 0;
  rejectedHandlerRuns = 0;
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
    "push runs the handler optimistically and forwards to primary in the background",
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

          assert.strictEqual(replicaHandlerRuns, 1);
          assert.strictEqual(optimisticHandlerRuns, 1);
          assert.strictEqual(acceptedHandlerRuns, 0);

          yield* waitForPrimaryEvent(eventInstance.eventId);
          assert.strictEqual(replicaHandlerRuns, 2);
          assert.strictEqual(optimisticHandlerRuns, 1);
          assert.strictEqual(acceptedHandlerRuns, 1);

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

          yield* waitForReplicaHandler(2);
          assert.strictEqual(optimisticHandlerRuns, 1);
          assert.strictEqual(acceptedHandlerRuns, 1);
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
          assert.strictEqual(replicaHandlerRuns, 1);
          assert.strictEqual(optimisticHandlerRuns, 1);

          yield* replica.poke();

          yield* waitForPrimaryEvent(eventInstance.eventId);
          assert.strictEqual(replicaHandlerRuns, 2);
          assert.strictEqual(acceptedHandlerRuns, 1);

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
          assert.strictEqual(optimisticHandlerRuns, 0);
          assert.strictEqual(acceptedHandlerRuns, 1);

          yield* replica.poke();
          yield* waitForReplicaHandler(2);
          assert.strictEqual(replicaHandlerRuns, 1);
        }),
      ),
    30000,
  );

  it.effect(
    "accepted local proposals do not skip earlier primary events",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;

          const remoteEvent = yield* EventInstance.make(todoCreated, {
            id: "5-remote",
            name: "Buy apples",
          });

          const localEvent = yield* EventInstance.make(todoCreated, {
            id: "5-local",
            name: "Buy oranges",
          });

          yield* primary.push(remoteEvent);
          yield* replica.push(localEvent);
          assert.strictEqual(replicaHandlerRuns, 1);
          assert.strictEqual(optimisticHandlerRuns, 1);

          yield* waitForPrimaryEvent(localEvent.eventId);
          yield* replica.poke();
          yield* waitForReplicaHandler(3);

          assert.strictEqual(replicaHandlerRuns, 3);
          assert.strictEqual(optimisticHandlerRuns, 1);
          assert.strictEqual(acceptedHandlerRuns, 2);
        }),
      ),
    30000,
  );

  it.effect(
    "checkout is read-only until returning to Latest",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;

          const remoteEvent = yield* EventInstance.make(todoCreated, {
            id: "6-remote",
            name: "Buy tea",
          });
          const localEvent = yield* EventInstance.make(todoCreated, {
            id: "6-local",
            name: "Buy sugar",
          });

          yield* primary.push(remoteEvent);
          yield* replica.checkout(remoteEvent.eventId);

          assert.deepStrictEqual(yield* replica.mode, {
            _tag: "Checkout",
            eventId: remoteEvent.eventId,
          });

          yield* replica.push(localEvent);
          yield* replica.poke();

          assert.strictEqual(replicaHandlerRuns, 0);
          assert.strictEqual(optimisticHandlerRuns, 0);

          const checkoutPage = yield* primary.pull();
          assert.isFalse(checkoutPage.data.some((event) => event.eventId === localEvent.eventId));

          yield* replica.setLatest();
          assert.deepStrictEqual(yield* replica.mode, { _tag: "Latest" });

          yield* replica.poke();
          yield* waitForReplicaHandler(1);

          assert.strictEqual(replicaHandlerRuns, 1);
          assert.strictEqual(acceptedHandlerRuns, 1);
        }),
      ),
    30000,
  );

  it.effect(
    "replica event log retains only the latest 100 accepted events",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
          const api = yield* IndexedDbReplicaSyncEngine.ReplicaSyncEngineDatabase.getQueryBuilder;

          const total = IndexedDbReplicaSyncEngine.ReplicaEventHistoryCap + 5;
          const events: EventInstance.EventInstance[] = [];
          for (let i = 0; i < total; i++) {
            events.push(
              yield* EventInstance.make(todoCreated, {
                id: `cap-${i}`,
                name: `Todo ${i}`,
              }),
            );
          }
          yield* primary.push(...events);

          yield* replica.poke();
          yield* waitForReplicaHandler(total);
          assert.strictEqual(acceptedHandlerRuns, total);

          const rows = yield* api.from("event_history").select();
          assert.strictEqual(rows.length, IndexedDbReplicaSyncEngine.ReplicaEventHistoryCap);

          const eventIds = rows.map((row) => row.eventId);
          assert.isTrue(eventIds.includes(events[total - 1]!.eventId));
          assert.isFalse(eventIds.includes(events[0]!.eventId));
        }),
      ),
    60000,
  );
});
