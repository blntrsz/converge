import { PostgresEventLog } from "converge";
import { Effect, Layer } from "effect";
import { Migrator, SqlClient } from "effect/unstable/sql";
import { PgliteSqlClient } from "./pglite-client";

const todoMigrations = Migrator.fromRecord({
  "2_create_todo": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`DROP TABLE IF EXISTS todos`;

    yield* sql`
      CREATE TABLE IF NOT EXISTS todo (
        id text PRIMARY KEY,
        title text NOT NULL,
        completed boolean NOT NULL DEFAULT false,
        created_at text NOT NULL
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
