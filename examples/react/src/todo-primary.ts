import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import { EventHandler, EventRouter, PostgresEventLog } from "converge/event";
import { PostgresPrimarySyncEngine } from "converge/primary-sync-engine";
import { PgliteSqlClient } from "../../../packages/converge/src/pglite-client.ts";
import {
  todoCompletionSet,
  todoCreated,
  todoDeleted,
  type Todo,
} from "./todo-events";

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      INSERT INTO todos ${sql.insert({
        id: event.eventDetails.id,
        title: event.eventDetails.title,
        completed: false,
        createdAt: event.eventDetails.createdAt,
      })}
      ON CONFLICT (id) DO NOTHING
    `;
  }),
);

const todoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      UPDATE todos
      SET completed = ${event.eventDetails.completed}
      WHERE id = ${event.eventDetails.id}
    `;
  }),
);

const todoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      DELETE FROM todos
      WHERE id = ${event.eventDetails.id}
    `;
  }),
);

const todoMigrations = Migrator.fromRecord({
  "2_create_todos": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE IF NOT EXISTS todos (
        id text PRIMARY KEY,
        title text NOT NULL,
        completed boolean NOT NULL DEFAULT false,
        created_at double precision NOT NULL
      )
    `;
  }),
});

const todoMigrationsLayer = Layer.effectDiscard(
  Migrator.make({})({ loader: todoMigrations }),
);

const PgSqlClientWithSyncMigrations = PostgresEventLog.migrationsLayer.pipe(
  Layer.provideMerge(PgliteSqlClient),
);

const PgSqlClientWithAllMigrations = todoMigrationsLayer.pipe(
  Layer.provideMerge(PgSqlClientWithSyncMigrations),
);

const PrimaryEventRouterLayer = EventRouter.layer({
  handlers: [todoCreatedHandler, todoCompletionSetHandler, todoDeletedHandler],
});

export const PrimaryTodoLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(PrimaryEventRouterLayer),
  Layer.provideMerge(PostgresEventLog.layer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

export const listPrimaryTodos = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return yield* sql<Todo>`
    SELECT id, title, completed, created_at
    FROM todos
    ORDER BY created_at ASC
  `;
});
