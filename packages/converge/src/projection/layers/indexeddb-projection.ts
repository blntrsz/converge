import {
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbTable,
  IndexedDbVersion,
} from "@effect/platform-browser";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  make,
  ProjectionStorageError,
  type IReactiveProjection,
  type ProjectionStorage,
} from "../services/projection.ts";

const SnapshotRow = Schema.Struct({
  key: Schema.String,
  snapshot: Schema.Json,
});

type SnapshotRow = typeof SnapshotRow.Type;

const SnapshotTable = IndexedDbTable.make({
  name: "projection_snapshots",
  schema: SnapshotRow,
  keyPath: "key",
  durability: "strict",
});

const ProjectionDatabaseVersion = IndexedDbVersion.make(SnapshotTable);

/**
 * @since 0.0.0
 * @category database
 */
export class ProjectionDatabase extends IndexedDbDatabase.make(
  ProjectionDatabaseVersion,
  Effect.fn(function* (api) {
    yield* api.createObjectStore("projection_snapshots");
  }),
) {}

/**
 * @since 0.0.0
 * @category layer
 */
export const databaseLayer = (databaseName = "converge-projections") =>
  ProjectionDatabase.layer(databaseName);

/**
 * @since 0.0.0
 * @category storage
 */
export function indexedDbStorage<const TSchema extends Schema.Schema<any>>(
  schema: TSchema & {
    readonly DecodingServices: never;
    readonly EncodingServices: never;
  },
  options: {
    readonly key: string;
  },
): Effect.Effect<
  ProjectionStorage<Schema.Schema.Type<TSchema>, ProjectionStorageError>,
  never,
  IndexedDbDatabase.IndexedDbDatabase
> {
  const decodeSnapshot = Schema.decodeUnknownEffect(schema);
  const encodeSnapshot = Schema.encodeUnknownEffect(schema);

  return Effect.gen(function* () {
    const api = yield* ProjectionDatabase.getQueryBuilder;
    const snapshots = api.from("projection_snapshots");

    return {
      load: Effect.gen(function* () {
        const rows = yield* snapshots
          .select()
          .equals(options.key)
          .limit(1)
          .pipe(
            Effect.map((rows) => rows as ReadonlyArray<SnapshotRow>),
            Effect.mapError(
              (cause) =>
                new ProjectionStorageError({
                  operation: "load",
                  key: options.key,
                  cause,
                }),
            ),
          );
        const row = rows[0];
        if (!row) {
          return Option.none<Schema.Schema.Type<TSchema>>();
        }

        return yield* decodeSnapshot(row.snapshot).pipe(
          Effect.map(Option.some),
          Effect.catch(() => Effect.succeed(Option.none<Schema.Schema.Type<TSchema>>())),
        );
      }),
      save: (snapshot) =>
        Effect.gen(function* () {
          const encoded = yield* encodeSnapshot(snapshot).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectionStorageError({
                  operation: "encode",
                  key: options.key,
                  cause,
                }),
            ),
          );

          yield* snapshots
            .upsert({
              key: options.key,
              snapshot: encoded as SnapshotRow["snapshot"],
            })
            .pipe(
              Effect.asVoid,
              Effect.mapError(
                (cause) =>
                  new ProjectionStorageError({
                    operation: "save",
                    key: options.key,
                    cause,
                  }),
              ),
            );
        }),
    };
  });
}

/**
 * @since 0.0.0
 * @category layer
 */
export function indexedDbLayer<TIdentifier, const TSchema extends Schema.Schema<any>>(
  tag: Context.Service<
    TIdentifier,
    IReactiveProjection<Schema.Schema.Type<TSchema>, ProjectionStorageError>
  >,
  options: {
    readonly databaseName?: string;
    readonly key: string;
    readonly schema: TSchema & {
      readonly DecodingServices: never;
      readonly EncodingServices: never;
    };
    readonly initialValue: Schema.Schema.Type<TSchema>;
  },
): Layer.Layer<
  TIdentifier,
  ProjectionStorageError | IndexedDbDatabase.IndexedDbDatabaseError,
  IndexedDb.IndexedDb
> {
  return Layer.effect(
    tag,
    Effect.gen(function* () {
      const storage = yield* indexedDbStorage(options.schema, { key: options.key });
      return yield* make({
        initialValue: options.initialValue,
        storage,
      });
    }),
  ).pipe(Layer.provide(databaseLayer(options.databaseName)));
}
