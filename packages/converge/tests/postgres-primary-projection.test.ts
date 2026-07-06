import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { SqlClient } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import {
  Event,
  EventId,
  EventHandler,
  EventInstance,
  EventLog,
  EventRouter,
  PostgresEventLog,
  PostgresPrimaryProjection,
  PostgresPrimarySyncEngine,
  PrimaryProjection,
  PrimarySyncEngine,
} from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";

const projectionAdvanced = Event.make("projection.advanced.v1", {
  step: Schema.String,
});

const projectionAdvancedHandler = EventHandler.make(
  projectionAdvanced,
  Effect.fn(function* () {
    yield* Effect.void;
  }),
);

const TodoRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const migrations = Migrator.fromRecord({
  "2_create_primary_todo_projection": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE IF NOT EXISTS primary_todo_projection (
        id text NOT NULL,
        name text NOT NULL,
        since bigint NOT NULL,
        PRIMARY KEY (id, since)
      )
    `;
  }),
});

const migrationsLayer = Layer.effectDiscard(Migrator.make({})({ loader: migrations }));

const PgSqlClientWithMigrations = migrationsLayer.pipe(
  Layer.provideMerge(PostgresEventLog.migrationsLayer.pipe(Layer.provideMerge(PgliteSqlClient))),
);

const EventRouterLayer = EventRouter.layer({
  handlers: [projectionAdvancedHandler],
});

const PrimarySyncEngineLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provide(EventRouterLayer),
);

const TodoPrimaryProjectionLayer = PrimaryProjection.layer({
  projections: [
    PostgresPrimaryProjection.versionedTable({
      key: "todos",
      tableName: "primary_todo_projection",
      columns: ["id", "name"],
      rowSchema: TodoRow,
    }),
  ],
});

const TestLayer = Layer.mergeAll(PrimarySyncEngineLayer, TodoPrimaryProjectionLayer).pipe(
  Layer.provideMerge(PostgresEventLog.layer),
  Layer.provideMerge(PgSqlClientWithMigrations),
);

layer(TestLayer)((it) => {
  it.effect("bootstraps a versioned table at the requested eventId", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      const eventLog = yield* EventLog.EventLog;
      const router = yield* PrimaryProjection.PrimaryProjectionRouter;
      const sql = yield* SqlClient.SqlClient;

      const firstEvent = yield* EventInstance.make(projectionAdvanced, {
        step: "first",
      });
      const secondEvent = yield* EventInstance.make(projectionAdvanced, {
        step: "second",
      });
      const thirdEvent = yield* EventInstance.make(projectionAdvanced, {
        step: "third",
      });

      yield* engine.push(firstEvent, secondEvent, thirdEvent);

      const firstEventHistoryId = yield* eventLog.resolveEventHistoryId(firstEvent.eventId);
      const secondEventHistoryId = yield* eventLog.resolveEventHistoryId(secondEvent.eventId);
      const thirdEventHistoryId = yield* eventLog.resolveEventHistoryId(thirdEvent.eventId);

      if (
        Option.isNone(firstEventHistoryId) ||
        Option.isNone(secondEventHistoryId) ||
        Option.isNone(thirdEventHistoryId)
      ) {
        assert.fail("expected pushed Events to resolve to Event history ids");
      }

      yield* sql`
        INSERT INTO primary_todo_projection (id, name, since)
        VALUES
          ('todo-1', 'Draft', CAST(${firstEventHistoryId.value} AS bigint)),
          ('todo-1', 'Published', CAST(${thirdEventHistoryId.value} AS bigint)),
          ('todo-2', 'Between', CAST(${secondEventHistoryId.value} AS bigint))
      `;

      const projection = router.find("todos");
      if (!projection) {
        assert.fail("expected todos projection to be registered");
      }

      const rows = yield* projection
        .bootstrap({ eventId: Schema.decodeUnknownSync(EventId.EventId)(secondEvent.eventId) })
        .pipe(Stream.runCollect);

      assert.deepStrictEqual(Array.from(rows), [
        { id: "todo-1", name: "Draft" },
        { id: "todo-2", name: "Between" },
      ]);
    }),
  );
});
