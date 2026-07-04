import { Array, Effect, Layer, Option, Schema, Stream } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { identifier, literal } from "effect/unstable/sql/Statement";
import { make as makeRegistry, PrimaryProjectionRegistry } from "../services/primary-projection-registry.ts";
import type { IPrimaryProjection } from "../services/primary-projection.ts";

const DefaultSinceColumn = "since";
const DefaultStreamPageSize = 100;

type ProjectionPage<TEntity> = {
  readonly data: ReadonlyArray<TEntity>;
  readonly hasNext: boolean;
  readonly cursor?: string;
};

/**
 * @since 0.0.0
 * @category model
 */
export interface PostgresPrimaryProjectionOptions<TEntity> {
  readonly key: string;
  readonly table: string;
  readonly entityIdColumn: string;
  readonly sinceColumn?: string;
  readonly entitySchema: Schema.Schema<TEntity> & {
    readonly DecodingServices: never;
    readonly EncodingServices: never;
  };
  readonly columns: ReadonlyArray<string>;
  readonly deletedColumn?: string;
  readonly streamPageSize?: number;
}

const assertIdentifier = (identifier: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    return Effect.die(`Invalid SQL identifier: ${identifier}`);
  }

  return Effect.void;
};

/**
 * Creates a type-safe primary projection backed by a versioned Postgres table.
 *
 * @since 0.0.0
 * @category constructor
 */
export const make = <TEntity>(
  options: PostgresPrimaryProjectionOptions<TEntity>,
): Effect.Effect<IPrimaryProjection<TEntity>, never, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const sinceColumn = options.sinceColumn ?? DefaultSinceColumn;
    const streamPageSize = options.streamPageSize ?? DefaultStreamPageSize;
    const decodeEntity = Schema.decodeUnknownEffect(options.entitySchema);

    yield* assertIdentifier(options.table);
    yield* assertIdentifier(options.entityIdColumn);
    yield* assertIdentifier(sinceColumn);
    yield* Effect.forEach(options.columns, assertIdentifier);
    if (options.deletedColumn) {
      yield* assertIdentifier(options.deletedColumn);
    }

    const sequenceAt = (eventId: string) =>
      sql<{ id: string }>`
        SELECT id::text AS id
        FROM event_history
        WHERE event_id = ${eventId}
        LIMIT 1
      `.pipe(
        Effect.map((rows) => {
          const row = rows[0];
          return row === undefined ? undefined : Number(row.id);
        }),
        Effect.orDie,
      );

    const table = identifier(options.table);
    const entityId = identifier(options.entityIdColumn);
    const since = identifier(sinceColumn);
    const deleted = options.deletedColumn ? identifier(options.deletedColumn) : undefined;
    const selectColumns = literal([options.entityIdColumn, ...options.columns].join(", "));

    const fetchPage = (
      sequence: number,
      cursor?: string,
    ): Effect.Effect<ProjectionPage<TEntity>> =>
      Effect.gen(function* () {
        const limit = streamPageSize;

        const rows = cursor
          ? deleted
            ? yield* sql<Record<string, unknown>>`
                WITH latest AS (
                  SELECT DISTINCT ON (${entityId})
                    ${selectColumns}
                  FROM ${table}
                  WHERE ${since} <= ${sequence}
                  ORDER BY ${entityId}, ${since} DESC
                )
                SELECT ${selectColumns}
                FROM latest
                WHERE ${entityId} > ${cursor}
                  AND ${deleted} = false
                ORDER BY ${entityId} ASC
                LIMIT ${limit + 1}
              `.pipe(Effect.orDie)
            : yield* sql<Record<string, unknown>>`
                WITH latest AS (
                  SELECT DISTINCT ON (${entityId})
                    ${selectColumns}
                  FROM ${table}
                  WHERE ${since} <= ${sequence}
                  ORDER BY ${entityId}, ${since} DESC
                )
                SELECT ${selectColumns}
                FROM latest
                WHERE ${entityId} > ${cursor}
                ORDER BY ${entityId} ASC
                LIMIT ${limit + 1}
              `.pipe(Effect.orDie)
          : deleted
            ? yield* sql<Record<string, unknown>>`
                WITH latest AS (
                  SELECT DISTINCT ON (${entityId})
                    ${selectColumns}
                  FROM ${table}
                  WHERE ${since} <= ${sequence}
                  ORDER BY ${entityId}, ${since} DESC
                )
                SELECT ${selectColumns}
                FROM latest
                WHERE ${deleted} = false
                ORDER BY ${entityId} ASC
                LIMIT ${limit + 1}
              `.pipe(Effect.orDie)
            : yield* sql<Record<string, unknown>>`
                WITH latest AS (
                  SELECT DISTINCT ON (${entityId})
                    ${selectColumns}
                  FROM ${table}
                  WHERE ${since} <= ${sequence}
                  ORDER BY ${entityId}, ${since} DESC
                )
                SELECT ${selectColumns}
                FROM latest
                ORDER BY ${entityId} ASC
                LIMIT ${limit + 1}
              `.pipe(Effect.orDie);

        const pageRows = Array.take(rows, limit);
        const entities = yield* Effect.forEach(pageRows, (row) =>
          decodeEntity(row).pipe(Effect.orDie),
        );
        const lastEntity = entities.at(-1);
        const lastEntityId =
          lastEntity === undefined
            ? undefined
            : String((lastEntity as Record<string, unknown>)[options.entityIdColumn]);

        return {
          data: entities,
          hasNext: rows.length > limit,
          cursor: rows.length > limit ? lastEntityId : undefined,
        };
      });

    const stream = (eventId: string): Stream.Stream<TEntity> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const sequence = yield* sequenceAt(eventId);
          if (sequence === undefined) {
            return Stream.empty;
          }

          return Stream.paginate<string | undefined, TEntity>(undefined, (cursor) =>
            Effect.gen(function* () {
              const page = yield* fetchPage(sequence, cursor);
              const next =
                page.hasNext && page.cursor !== undefined
                  ? Option.some(page.cursor)
                  : Option.none<string>();

              return [page.data, next] as const;
            }),
          );
        }),
      );

    return {
      key: options.key,
      stream,
    };
  });

/**
 * Provides a typed `IPrimaryProjection` service tag for one versioned table.
 *
 * @since 0.0.0
 * @category layer
 */
export const serviceLayer = <TIdentifier, TEntity>(
  tag: import("effect").Context.Service<TIdentifier, IPrimaryProjection<TEntity>>,
  options: PostgresPrimaryProjectionOptions<TEntity>,
): Layer.Layer<TIdentifier, never, SqlClient.SqlClient> => Layer.effect(tag, make(options));

/**
 * @since 0.0.0
 * @category layer
 */
export const projectionsLayer = <TEntity>(
  configs: ReadonlyArray<PostgresPrimaryProjectionOptions<TEntity>>,
) =>
  Effect.gen(function* () {
    return yield* Effect.forEach(configs, (config) =>
      make(config).pipe(Effect.map((projection) => projection as IPrimaryProjection<unknown>)),
    );
  });

/**
 * Builds Postgres primary projections and registers them for bootstrap.
 *
 * @since 0.0.0
 * @category layer
 */
export const registryLayer = <TEntity>(
  configs: ReadonlyArray<PostgresPrimaryProjectionOptions<TEntity>>,
): Layer.Layer<PrimaryProjectionRegistry, never, SqlClient.SqlClient> =>
  Layer.effect(
    PrimaryProjectionRegistry,
    projectionsLayer(configs).pipe(Effect.map((projections) => makeRegistry(projections))),
  );
