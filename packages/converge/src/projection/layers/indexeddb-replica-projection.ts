import {
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbTable,
  IndexedDbVersion,
} from "@effect/platform-browser";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { ReplicaApplyContext } from "../../replica-sync-engine/services/apply-context.ts";
import {
  make,
  type BootstrapFn,
  type IReactiveReplicaProjection,
  type IReplicaProjectionStore,
  type ReplicaProjectionStorage,
  ReplicaProjectionStorageError,
  type UpdateContext,
} from "../services/replica-projection.ts";

const SnapshotRow = Schema.Struct({
  key: Schema.String,
  snapshot: Schema.Json,
});

type SnapshotRow = typeof SnapshotRow.Type;

const DEFAULT_TABLE_NAME = "projection_snapshots";

type ProjectionTable = string | { readonly name: string };

const resolveTableName = (table?: ProjectionTable) =>
  typeof table === "string" ? table : (table?.name ?? DEFAULT_TABLE_NAME);

const projectionDatabaseCache = new Map<string, ReturnType<typeof IndexedDbDatabase.make>>();

const createReplicaProjectionDatabase = (tableName: string) => {
  const cached = projectionDatabaseCache.get(tableName);
  if (cached) {
    return cached;
  }

  const table = IndexedDbTable.make({
    name: tableName,
    schema: SnapshotRow,
    keyPath: "key",
    durability: "strict",
  });
  const version = IndexedDbVersion.make(table);
  const database = IndexedDbDatabase.make(
    version,
    Effect.fn(function* (api) {
      yield* api.createObjectStore(tableName);
    }),
  );
  projectionDatabaseCache.set(tableName, database);
  return database;
};

/**
 * @since 0.0.0
 * @category database
 */
export const ReplicaProjectionDatabase = createReplicaProjectionDatabase(DEFAULT_TABLE_NAME);

/**
 * @since 0.0.0
 * @category layer
 */
export const databaseLayer = (
  databaseName = "converge-replica-projections",
  table: ProjectionTable = DEFAULT_TABLE_NAME,
) => createReplicaProjectionDatabase(resolveTableName(table)).layer(databaseName);

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
    readonly table?: ProjectionTable;
  },
): Effect.Effect<
  ReplicaProjectionStorage<Schema.Schema.Type<TSchema>, ReplicaProjectionStorageError>,
  never,
  IndexedDbDatabase.IndexedDbDatabase
> {
  const decodeSnapshot = Schema.decodeUnknownEffect(schema);
  const encodeSnapshot = Schema.encodeUnknownEffect(schema);
  const tableName = resolveTableName(options.table);

  return Effect.gen(function* () {
    const database = createReplicaProjectionDatabase(tableName);
    const api = yield* database.getQueryBuilder;
    const snapshots = api.from(tableName);

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
                new ReplicaProjectionStorageError({
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
                new ReplicaProjectionStorageError({
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
                  new ReplicaProjectionStorageError({
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

const makeContext = <
  TIdentifier,
  TStoreIdentifier,
  const TSchema extends Schema.Schema<any>,
  TBootstrapRow,
>(
  tag: Context.Service<
    TIdentifier,
    IReactiveReplicaProjection<
      Schema.Schema.Type<TSchema>,
      ReplicaProjectionStorageError,
      TBootstrapRow
    >
  >,
  options: {
    readonly key: string;
    readonly table?: ProjectionTable;
    readonly schema: TSchema & {
      readonly DecodingServices: never;
      readonly EncodingServices: never;
    };
    readonly initialValue: Schema.Schema.Type<TSchema>;
    readonly store?: Context.Service<
      TStoreIdentifier,
      IReplicaProjectionStore<Schema.Schema.Type<TSchema>, ReplicaProjectionStorageError>
    >;
    readonly bootstrap?: BootstrapFn<
      Schema.Schema.Type<TSchema>,
      TBootstrapRow,
      ReplicaProjectionStorageError
    >;
  },
  updateContext?: UpdateContext,
) =>
  Effect.gen(function* () {
    const storage = yield* indexedDbStorage(options.schema, {
      key: options.key,
      table: options.table,
    });
    const runtime = yield* make({
      initialValue: options.initialValue,
      storage,
      updateContext,
      bootstrap: options.bootstrap,
    });

    const context = Context.make(tag, runtime.projection);
    if (options.store) {
      return Context.add(context, options.store, runtime.store);
    }
    return context as Context.Context<TIdentifier | TStoreIdentifier>;
  });

/**
 * @since 0.0.0
 * @category layer
 */
export function indexedDbLayer<
  TIdentifier,
  const TSchema extends Schema.Schema<any>,
  TBootstrapRow = never,
  TStoreIdentifier = never,
>(
  tag: Context.Service<
    TIdentifier,
    IReactiveReplicaProjection<
      Schema.Schema.Type<TSchema>,
      ReplicaProjectionStorageError,
      TBootstrapRow
    >
  >,
  options: {
    readonly databaseName?: string;
    readonly table?: ProjectionTable;
    readonly key: string;
    readonly schema: TSchema & {
      readonly DecodingServices: never;
      readonly EncodingServices: never;
    };
    readonly initialValue: Schema.Schema.Type<TSchema>;
    readonly store?: Context.Service<
      TStoreIdentifier,
      IReplicaProjectionStore<Schema.Schema.Type<TSchema>, ReplicaProjectionStorageError>
    >;
    readonly bootstrap?: BootstrapFn<
      Schema.Schema.Type<TSchema>,
      TBootstrapRow,
      ReplicaProjectionStorageError
    >;
  },
): Layer.Layer<
  TIdentifier | TStoreIdentifier,
  ReplicaProjectionStorageError | IndexedDbDatabase.IndexedDbDatabaseError,
  IndexedDb.IndexedDb
> {
  return Layer.effectContext(makeContext(tag, options)).pipe(
    Layer.provide(databaseLayer(options.databaseName, options.table)),
  );
}

/**
 * @since 0.0.0
 * @category layer
 */
export function indexedDbReplicaLayer<
  TIdentifier,
  const TSchema extends Schema.Schema<any>,
  TBootstrapRow = never,
  TStoreIdentifier = never,
>(
  tag: Context.Service<
    TIdentifier,
    IReactiveReplicaProjection<
      Schema.Schema.Type<TSchema>,
      ReplicaProjectionStorageError,
      TBootstrapRow
    >
  >,
  options: {
    readonly databaseName?: string;
    readonly table?: ProjectionTable;
    readonly key: string;
    readonly schema: TSchema & {
      readonly DecodingServices: never;
      readonly EncodingServices: never;
    };
    readonly initialValue: Schema.Schema.Type<TSchema>;
    readonly store?: Context.Service<
      TStoreIdentifier,
      IReplicaProjectionStore<Schema.Schema.Type<TSchema>, ReplicaProjectionStorageError>
    >;
    readonly bootstrap?: BootstrapFn<
      Schema.Schema.Type<TSchema>,
      TBootstrapRow,
      ReplicaProjectionStorageError
    >;
  },
): Layer.Layer<
  TIdentifier | TStoreIdentifier,
  ReplicaProjectionStorageError | IndexedDbDatabase.IndexedDbDatabaseError,
  IndexedDb.IndexedDb | ReplicaApplyContext
> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const updateContext = yield* ReplicaApplyContext;
      return yield* makeContext(tag, options, updateContext);
    }),
  ).pipe(Layer.provide(databaseLayer(options.databaseName, options.table)));
}
