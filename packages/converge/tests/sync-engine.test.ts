import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Result, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import {
  Event,
  EventHandler,
  EventInstance,
  EventRouter,
  PostgresPrimarySyncEngine,
  PrimarySyncEngine,
} from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  name: Schema.String,
});

const todoUpdated = Event.make("todo.updated.v1", {
  id: Schema.String,
  name: Schema.String,
});

const todoDeleted = Event.make("todo.deleted.v1", {
  id: Schema.String,
  name: Schema.String,
});

const todoRetryCounted = Event.make("todo.retry-counted.v1", {
  id: Schema.String,
});

let todoRetryCountedHandlerRuns = 0;

const todoCreatedHandler = EventHandler.make(
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

const todoUpdatedHandler = EventHandler.make(
  todoUpdated,
  Effect.fn(function* () {
    yield* Effect.void;
  }),
);

const todoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* () {
    yield* Effect.void;
  }),
);

const todoRetryCountedHandler = EventHandler.make(
  todoRetryCounted,
  Effect.fn(function* () {
    yield* Effect.sync(() => {
      todoRetryCountedHandlerRuns += 1;
    });
  }),
);

const migrations = Migrator.fromRecord({
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

const migrationsLayer = Layer.effectDiscard(Migrator.make({})({ loader: migrations }));

const PgSqlClientWithMigrations = PostgresPrimarySyncEngine.migrationsLayer.pipe(
  Layer.provideMerge(PgliteSqlClient),
);

const PgSqlClientWithAllMigrations = migrationsLayer.pipe(
  Layer.provideMerge(PgSqlClientWithMigrations),
);

const EventRouterLayer = EventRouter.layer({
  handlers: [
    todoCreatedHandler,
    todoUpdatedHandler,
    todoDeletedHandler,
    todoRetryCountedHandler,
  ],
});

const PrimarySyncEngineLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(EventRouterLayer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

layer(PrimarySyncEngineLayer)((it) => {
  it.effect("pushes a todo Event through the primary sync engine", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      const sql = yield* SqlClient.SqlClient;

      const eventInstance = yield* EventInstance.make(todoCreated, {
        id: "1",
        name: "Buy milk",
      });

      const results = yield* engine.push(eventInstance);

      assert.strictEqual(results.length, 1);
      const result = results[0]!;
      if (!Result.isSuccess(result)) {
        assert.fail("expected todo Event to be accepted");
      }
      assert.strictEqual(result.success.eventId, eventInstance.eventId);

      const todos = yield* sql<{ id: string; name: string }>`
        SELECT id, name FROM todo
        ORDER BY id ASC
      `;

      assert.deepStrictEqual(todos, [{ id: "1", name: "Buy milk" }]);

      const eventHistory = yield* engine.pull();
      assert.strictEqual(eventHistory.hasNext, false);
      assert.strictEqual(eventHistory.data.length, 1);
      assert.strictEqual(eventHistory.data[0]?.eventId, eventInstance.eventId);
      assert.strictEqual(eventHistory.data[0]?.eventType, "todo.created.v1");
      assert.deepStrictEqual(eventHistory.data[0]?.eventDetails, {
        id: "1",
        name: "Buy milk",
      });
    }),
  );

  it.effect("treats retrying an accepted Event as idempotent", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      todoRetryCountedHandlerRuns = 0;

      const eventInstance = yield* EventInstance.make(todoRetryCounted, {
        id: "retry-1",
      });

      const firstResults = yield* engine.push(eventInstance);

      assert.strictEqual(firstResults.length, 1);
      const firstResult = firstResults[0]!;
      if (!Result.isSuccess(firstResult)) {
        assert.fail("expected first Push to accept the Event");
      }
      assert.strictEqual(firstResult.success.eventId, eventInstance.eventId);
      assert.strictEqual(todoRetryCountedHandlerRuns, 1);

      const retryResults = yield* engine.push(eventInstance);

      assert.strictEqual(retryResults.length, 1);
      const retryResult = retryResults[0]!;
      if (!Result.isSuccess(retryResult)) {
        assert.fail("expected retrying an accepted Event to succeed");
      }
      assert.strictEqual(retryResult.success.eventId, eventInstance.eventId);
      assert.strictEqual(todoRetryCountedHandlerRuns, 1);
    }),
  );

  it.effect("pushes multiple Events passed as arguments", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      todoRetryCountedHandlerRuns = 0;

      const firstEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "multi-1",
      });
      const secondEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "multi-2",
      });
      const thirdEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "multi-3",
      });

      const results = yield* engine.push(firstEvent, secondEvent, thirdEvent);

      assert.strictEqual(results.length, 3);
      assert.strictEqual(todoRetryCountedHandlerRuns, 3);
      for (const [index, result] of results.entries()) {
        if (!Result.isSuccess(result)) {
          assert.fail("expected pushed Event to be accepted");
        }
        assert.strictEqual(
          result.success.eventId,
          [firstEvent, secondEvent, thirdEvent][index]?.eventId,
        );
      }
    }),
  );
});
