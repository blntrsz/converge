import { Effect, Schema, Stream } from "effect";
import { SqlClient, SqlError } from "effect/unstable/sql";
import type { PrimaryProjectionConfig } from "../services/primary-projection.ts";

type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/**
 * @since 0.0.0
 * @category options
 */
export interface VersionedTableOptions<TKey extends string, TRow extends object> {
  readonly key: TKey;
  readonly rowSchema: Schema.Schema<TRow>;
  readonly tableName: string;
  readonly columns: NonEmptyReadonlyArray<keyof TRow & string>;
  readonly idColumns?: NonEmptyReadonlyArray<string>;
  readonly sinceColumn?: string;
}

/**
 * @since 0.0.0
 * @category constructor
 */
export const versionedTable = <const TKey extends string, TRow extends object>(
  options: VersionedTableOptions<TKey, TRow>,
): PrimaryProjectionConfig<TKey, TRow, SqlError.SqlError, SqlClient.SqlClient> => ({
  key: options.key,
  rowSchema: options.rowSchema,
  bootstrap: ({ eventId }) =>
    Stream.unwrap(
      Effect.map(SqlClient.SqlClient, (sql) => {
        const idColumns = options.idColumns ?? (["id"] as const);
        const sinceColumn = options.sinceColumn ?? "since";
        const identifier = (column: string) => sql`${sql(column)}`;
        const distinctColumns = sql.csv(idColumns.map(identifier));
        const selectedColumns = sql.csv(options.columns.map(identifier));
        const orderColumns = sql.csv([
          ...idColumns.map(identifier),
          sql`${sql(sinceColumn)} DESC`,
        ]);

        return sql<TRow>`
          SELECT DISTINCT ON (${distinctColumns})
            ${selectedColumns}
          FROM ${sql(options.tableName)}
          WHERE ${sql(sinceColumn)} <= (
            SELECT id FROM event_history WHERE event_id = ${eventId}
          )
          ORDER BY ${orderColumns}
        `.stream;
      }),
    ),
});
