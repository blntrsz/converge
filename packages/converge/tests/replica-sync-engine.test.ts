import { assert, layer } from "@effect/vitest";
import { Context, Effect, Layer, Schema, Stream } from "effect";
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
  MemoryReplicaProjection,
  PostgresEventLog,
  PostgresPrimarySyncEngine,
  PrimaryProjection,
  PrimarySyncEngine,
  ReplicaProjection,
  ReplicaApplyContext,
  ReplicaSyncEngine,
} from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  name: Schema.String,
});

const TodoBootstrapRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

type TodoBootstrapRow = typeof TodoBootstrapRow.Type;

class BootstrapTodoProjection extends Context.Service<
  BootstrapTodoProjection,
  ReplicaProjection.IReactiveReplicaProjection<
    ReadonlyArray<TodoBootstrapRow>,
    never,
    TodoBootstrapRow
  >
>()("BootstrapTodoProjection") {}

let replicaHandlerRuns = 0;
let optimisticHandlerRuns = 0;
let acceptedHandlerRuns = 0;
let rejectedHandlerRuns = 0;
let shouldThrow = false;

const replicaTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* () {
    const applyContext = yield* ReplicaApplyContext.ReplicaApplyContext;
    const { phase } = yield* applyContext.current;

    if (shouldThrow && phase === "accepted") {
      yield* Effect.die(new Error("Simulated broken event chain"));
    }

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

const PgSqlClientWithMigrations = PostgresEventLog.migrationsLayer.pipe(
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
  Layer.provideMerge(PostgresEventLog.layer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

const BootstrapPrimaryProjectionLayer = PrimaryProjection.layer({
  projections: [
    {
      key: "todos",
      rowSchema: TodoBootstrapRow,
      bootstrap: ({ eventId }) =>
        Stream.make({
          id: "bootstrapped-head",
          name: eventId,
        }),
    },
  ],
});

const BootstrapTodoProjectionLayer = MemoryReplicaProjection.memoryLayer(BootstrapTodoProjection, {
  initialValue: [] as ReadonlyArray<TodoBootstrapRow>,
  bootstrap: (rows: Stream.Stream<TodoBootstrapRow, unknown>) =>
    rows.pipe(
      Stream.runCollect,
      Effect.map((snapshot) => Array.from(snapshot)),
    ),
});

const BootstrapReplicaProjectionRouterLayer = ReplicaProjection.routerLayer({
  projections: [
    {
      key: "todos",
      projection: BootstrapTodoProjection,
    },
  ],
}).pipe(Layer.provideMerge(BootstrapTodoProjectionLayer));

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
  Layer.provideMerge(PrimaryProjection.emptyLayer),
  Layer.provideMerge(ReplicaProjection.emptyLayer),
);

const BootstrapReplicaDatabaseLayer = IndexedDbReplicaSyncEngine.databaseLayer(
  "test-replica-bootstrap",
).pipe(Layer.provide(FakeIndexedDbLayer));

const ReplicaSyncEngineWithBootstrapLayer = IndexedDbReplicaSyncEngine.layer.pipe(
  Layer.provide(ReplicaEventRouterLayer),
  Layer.provideMerge(BootstrapReplicaDatabaseLayer),
  Layer.provideMerge(ReplicaApplyContext.layer),
  Layer.provideMerge(PrimarySyncEngineLayer),
  Layer.provideMerge(BootstrapPrimaryProjectionLayer),
  Layer.provideMerge(BootstrapReplicaProjectionRouterLayer),
);

const resetCounters = () => {
  replicaHandlerRuns = 0;
  optimisticHandlerRuns = 0;
  acceptedHandlerRuns = 0;
  rejectedHandlerRuns = 0;
  shouldThrow = false;
};

const waitForPrimaryEvent = (
  eventId: string,
): Effect.Effect<void, never, PrimarySyncEngine.PrimarySyncEngine> =>
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

const waitForBootstrappedTodos = (
  target: number,
): Effect.Effect<void, never, BootstrapTodoProjection> =>
  Effect.gen(function* () {
    const projection = yield* BootstrapTodoProjection;
    for (let i = 0; i < 200; i++) {
      yield* Effect.sleep("50 millis");
      const todos = yield* projection.query((todos) => todos);
      if (todos.length >= target) return;
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

layer(ReplicaSyncEngineWithBootstrapLayer)((it) => {
  it.effect(
    "first poke bootstraps registered projections at the primary head",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
          const projection = yield* BootstrapTodoProjection;

          const firstEvent = yield* EventInstance.make(todoCreated, {
            id: "bootstrap-1",
            name: "Old todo",
          });
          const secondEvent = yield* EventInstance.make(todoCreated, {
            id: "bootstrap-2",
            name: "Latest todo",
          });

          yield* primary.push(firstEvent, secondEvent);

          yield* replica.poke();
          yield* waitForBootstrappedTodos(1);

          const bootstrapped = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(bootstrapped, [
            {
              id: "bootstrapped-head",
              name: secondEvent.eventId,
            },
          ]);
          assert.strictEqual(acceptedHandlerRuns, 0);

          const thirdEvent = yield* EventInstance.make(todoCreated, {
            id: "bootstrap-3",
            name: "After bootstrap",
          });
          yield* primary.push(thirdEvent);
          yield* replica.poke();
          yield* waitForReplicaHandler(1);

          assert.strictEqual(acceptedHandlerRuns, 1);
        }),
      ),
    30000,
  );

  it.effect(
    "checkout bootstraps registered projections at the requested eventId",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
          const projection = yield* BootstrapTodoProjection;
          yield* projection.bootstrap(Stream.empty);

          const firstEvent = yield* EventInstance.make(todoCreated, {
            id: "checkout-1",
            name: "Older todo",
          });
          const secondEvent = yield* EventInstance.make(todoCreated, {
            id: "checkout-2",
            name: "Newer todo",
          });

          yield* primary.push(firstEvent, secondEvent);

          yield* replica.checkout(firstEvent.eventId);

          assert.deepStrictEqual(yield* replica.mode, {
            _tag: "Checkout",
            eventId: firstEvent.eventId,
          });
          const bootstrapped = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(bootstrapped, [
            {
              id: "bootstrapped-head",
              name: firstEvent.eventId,
            },
          ]);
          assert.strictEqual(acceptedHandlerRuns, 0);
        }),
      ),
    30000,
  );

  it.effect(
    "setLatest re-bootstraps projections to head and resumes sync",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
          const projection = yield* BootstrapTodoProjection;
          yield* projection.bootstrap(Stream.empty);

          const olderEvent = yield* EventInstance.make(todoCreated, {
            id: "setlatest-older",
            name: "Older todo",
          });
          const newerEvent = yield* EventInstance.make(todoCreated, {
            id: "setlatest-newer",
            name: "Newer todo",
          });

          yield* primary.push(olderEvent, newerEvent);

          yield* replica.checkout(olderEvent.eventId);
          let bootstrapped = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(bootstrapped, [
            {
              id: "bootstrapped-head",
              name: olderEvent.eventId,
            },
          ]);

          yield* replica.setLatest();
          assert.deepStrictEqual(yield* replica.mode, { _tag: "Latest" });

          bootstrapped = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(bootstrapped, [
            {
              id: "bootstrapped-head",
              name: newerEvent.eventId,
            },
          ]);

          const afterEvent = yield* EventInstance.make(todoCreated, {
            id: "setlatest-after",
            name: "After setLatest",
          });
          yield* primary.push(afterEvent);
          yield* replica.poke();
          yield* waitForReplicaHandler(1);

          assert.strictEqual(acceptedHandlerRuns, 1);
        }),
      ),
    30000,
  );

  it.effect(
    "repair re-bootstraps projections at the active sync mode sequence",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
          const projection = yield* BootstrapTodoProjection;
          yield* projection.bootstrap(Stream.empty);

          const olderEvent = yield* EventInstance.make(todoCreated, {
            id: "repair-older",
            name: "Older todo",
          });
          const newerEvent = yield* EventInstance.make(todoCreated, {
            id: "repair-newer",
            name: "Newer todo",
          });

          yield* primary.push(olderEvent, newerEvent);

          yield* replica.checkout(olderEvent.eventId);
          let bootstrapped = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(bootstrapped, [
            {
              id: "bootstrapped-head",
              name: olderEvent.eventId,
            },
          ]);

          yield* projection.bootstrap(Stream.empty);
          assert.deepStrictEqual(yield* projection.query((todos) => todos), []);

          yield* replica.repair();

          assert.deepStrictEqual(yield* replica.mode, {
            _tag: "Checkout",
            eventId: olderEvent.eventId,
          });

          bootstrapped = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(bootstrapped, [
            {
              id: "bootstrapped-head",
              name: olderEvent.eventId,
            },
          ]);
        }),
      ),
    30000,
  );

  it.effect(
    "repair in Latest mode re-bootstraps projections at primary head",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
          const projection = yield* BootstrapTodoProjection;
          yield* replica.setLatest();
          yield* projection.bootstrap(Stream.empty);

          const headEvent = yield* EventInstance.make(todoCreated, {
            id: "repair-latest-head",
            name: "Head todo",
          });

          yield* primary.push(headEvent);

          yield* replica.repair();

          assert.deepStrictEqual(yield* replica.mode, { _tag: "Latest" });

          const bootstrapped = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(bootstrapped, [
            {
              id: "bootstrapped-head",
              name: headEvent.eventId,
            },
          ]);
        }),
      ),
    30000,
  );

  it.effect(
    "consumer auto-repairs after a broken event chain failure",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          resetCounters();
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
          const projection = yield* BootstrapTodoProjection;
          yield* replica.setLatest();
          yield* projection.bootstrap(Stream.empty);

          const headEvent = yield* EventInstance.make(todoCreated, {
            id: "repair-auto-head",
            name: "Head todo",
          });
          yield* primary.push(headEvent);
          yield* replica.poke();
          yield* waitForBootstrappedTodos(1);

          yield* projection.bootstrap(Stream.empty);
          assert.deepStrictEqual(yield* projection.query((todos) => todos), []);

          shouldThrow = true;
          const failingEvent = yield* EventInstance.make(todoCreated, {
            id: "repair-auto-fail",
            name: "Failing todo",
          });
          yield* primary.push(failingEvent);
          yield* replica.poke();
          yield* waitForBootstrappedTodos(1);
          shouldThrow = false;

          const bootstrapped = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(bootstrapped, [
            {
              id: "bootstrapped-head",
              name: failingEvent.eventId,
            },
          ]);
        }),
      ),
    30000,
  );
});
