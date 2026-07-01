import {
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbTable,
  IndexedDbVersion,
} from "@effect/platform-browser";
import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRef from "effect/unstable/reactivity/AtomRef";

/**
 * @since 0.0.0
 * @category error
 */
export class ProjectionStorageError extends Schema.TaggedErrorClass<ProjectionStorageError>()(
  "ProjectionStorageError",
  {
    operation: Schema.Literals(["load", "encode", "save"]),
    key: Schema.String,
    cause: Schema.Unknown,
  },
) {}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IProjection<TSnapshot, TError = never> {
  readonly atom: Atom.Atom<TSnapshot>;
  readonly get: Effect.Effect<TSnapshot>;
  readonly set: (snapshot: TSnapshot) => Effect.Effect<void, TError>;
  readonly subscribe: (listener: () => void) => Effect.Effect<() => void>;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface ProjectionStorage<TSnapshot, TError = never> {
  readonly load: Effect.Effect<Option.Option<TSnapshot>, TError>;
  readonly save: (snapshot: TSnapshot) => Effect.Effect<void, TError>;
}

type StorageError<TStorage> =
  TStorage extends ProjectionStorage<any, infer TError> ? TError : never;

/**
 * @since 0.0.0
 * @category constructor
 */
export function make<
  TSnapshot,
  TStorage extends ProjectionStorage<TSnapshot, any> | undefined,
>(options: {
  readonly initialValue: TSnapshot;
  readonly storage?: TStorage;
}): Effect.Effect<IProjection<TSnapshot, StorageError<TStorage>>, StorageError<TStorage>> {
  return Effect.gen(function* () {
    const storedSnapshot = options.storage ? yield* options.storage.load : Option.none<TSnapshot>();
    const ref = AtomRef.make(Option.getOrElse(storedSnapshot, () => options.initialValue));
    const lock = yield* Semaphore.make(1);

    const commit = (snapshot: TSnapshot) =>
      Effect.gen(function* () {
        if (options.storage) {
          yield* options.storage.save(snapshot);
        }

        yield* Effect.sync(() => {
          ref.set(snapshot);
        });
      });

    const atom = Atom.make((get) => {
      const unsubscribe = ref.subscribe((snapshot) => {
        get.setSelf(snapshot);
      });

      get.addFinalizer(unsubscribe);

      return ref.value;
    });

    return {
      atom,
      get: Effect.sync(() => ref.value),
      set: (snapshot) => lock.withPermits(1)(commit(snapshot)),
      subscribe: (listener) => Effect.sync(() => ref.subscribe(() => listener())),
    };
  });
}

/**
 * @since 0.0.0
 * @category layer
 */
export function layer<
  TIdentifier,
  TSnapshot,
  TStorage extends ProjectionStorage<TSnapshot, any> | undefined = undefined,
>(
  tag: Context.Service<TIdentifier, IProjection<TSnapshot, StorageError<TStorage>>>,
  options: {
    readonly initialValue: TSnapshot;
    readonly storage?: TStorage;
  },
): Layer.Layer<TIdentifier, StorageError<TStorage>> {
  return Layer.effect(tag, make(options));
}

/**
 * @since 0.0.0
 * @category layer
 */
export function memoryLayer<TIdentifier, TSnapshot, TError = never>(
  tag: Context.Service<TIdentifier, IProjection<TSnapshot, TError>>,
  options: {
    readonly initialValue: TSnapshot;
  },
): Layer.Layer<TIdentifier> {
  return Layer.effect(tag, make(options) as Effect.Effect<IProjection<TSnapshot, TError>>);
}

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
    IProjection<Schema.Schema.Type<TSchema>, ProjectionStorageError>
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
