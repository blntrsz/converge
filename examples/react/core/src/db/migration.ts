import { PostgresEventLog } from "converge";
import { Effect, Layer } from "effect";
import { Migrator, SqlClient } from "effect/unstable/sql";
import { PgliteSqlClient } from "./pglite-client";

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

const todoMigrationsLayer = Layer.effectDiscard(Migrator.make({})({ loader: todoMigrations }));

const PgSqlClientWithSyncMigrations = PostgresEventLog.migrationsLayer.pipe(
  Layer.provideMerge(PgliteSqlClient),
);

export const PgSqlClientWithAllMigrations = todoMigrationsLayer.pipe(
  Layer.provideMerge(PgSqlClientWithSyncMigrations),
);
