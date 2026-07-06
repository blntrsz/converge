import { Context, Effect, HashMap, Layer, Option, Schema, Semaphore, Stream } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRef from "effect/unstable/reactivity/AtomRef";

/**
 * @since 0.0.0
 * @category error
 */
export class ReplicaProjectionStorageError extends Schema.TaggedErrorClass<ReplicaProjectionStorageError>()(
  "ReplicaProjectionStorageError",
  {
    operation: Schema.Literals(["load", "encode", "save"]),
    key: Schema.String,
    cause: Schema.Unknown,
  },
) {}

/**
 * @since 0.0.0
 * @category model
 */
export type UpdateFn<TSnapshot, A, TError = never> = (
  current: TSnapshot,
) => readonly [TSnapshot, A] | Effect.Effect<readonly [TSnapshot, A], TError>;

/**
 * @since 0.0.0
 * @category model
 */
export type BootstrapFn<TSnapshot, TRow, TError = never> = (
  rows: Stream.Stream<TRow, unknown, never>,
) => Effect.Effect<TSnapshot, TError | unknown>;

/**
 * @since 0.0.0
 * @category model
 */
export type UpdatePhase = "optimistic" | "accepted" | "rejected";

/**
 * @since 0.0.0
 * @category model
 */
export interface UpdateContext {
  readonly current: Effect.Effect<{
    readonly phase: UpdatePhase;
    readonly eventId: string;
  }>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReplicaProjection<TSnapshot, TError = never, TBootstrapRow = never> {
  readonly query: <A>(filter: (current: TSnapshot) => A) => Effect.Effect<A>;
  readonly bootstrap: (
    rows: Stream.Stream<TBootstrapRow, unknown, never>,
  ) => Effect.Effect<void, TError | unknown>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReactiveReplicaProjection<
  TSnapshot,
  TError = never,
  TBootstrapRow = never,
> extends IReplicaProjection<TSnapshot, TError, TBootstrapRow> {
  readonly atom: Atom.Atom<TSnapshot>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReplicaProjectionStore<TSnapshot, TError = never> {
  readonly update: <A>(f: UpdateFn<TSnapshot, A, TError>) => Effect.Effect<A, TError>;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface ReplicaProjectionRegistration<
  TKey extends string = string,
  TProjection extends Context.Service.Any = Context.Service.Any,
> {
  readonly key: TKey;
  readonly projection: TProjection;
}

/**
 * @since 0.0.0
 * @category type
 */
export type AnyReplicaProjectionRegistration = ReplicaProjectionRegistration<
  string,
  Context.Service.Any
>;

/**
 * @since 0.0.0
 * @category type
 */
export type ReplicaProjectionRegistrationContext<TRegistration> =
  TRegistration extends ReplicaProjectionRegistration<any, infer TProjection>
    ? Context.Service.Identifier<TProjection>
    : never;

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface RoutedReplicaProjection<TKey extends string = string, TRow = unknown> {
  readonly key: TKey;
  readonly bootstrap: (rows: Stream.Stream<TRow, unknown, never>) => Effect.Effect<void, unknown>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReplicaProjectionRouter {
  readonly find: (key: string) => RoutedReplicaProjection | undefined;
  readonly all: ReadonlyArray<RoutedReplicaProjection>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class ReplicaProjectionRouter extends Context.Service<
  ReplicaProjectionRouter,
  IReplicaProjectionRouter
>()("ReplicaProjectionRouter") {}

/**
 * @since 0.0.0
 * @category model
 */
export interface ReplicaProjectionStorage<TSnapshot, TError = never> {
  readonly load: Effect.Effect<Option.Option<TSnapshot>, TError>;
  readonly save: (snapshot: TSnapshot) => Effect.Effect<void, TError>;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface ReplicaProjectionRuntime<TSnapshot, TError = never, TBootstrapRow = never> {
  readonly projection: IReactiveReplicaProjection<TSnapshot, TError, TBootstrapRow>;
  readonly store: IReplicaProjectionStore<TSnapshot, TError>;
}

type StorageError<TStorage> =
  TStorage extends ReplicaProjectionStorage<any, infer TError> ? TError : never;

type RuntimeError<TStorage, TError> = StorageError<TStorage> | TError;

const runUpdateFn = <TSnapshot, A, TError>(
  f: UpdateFn<TSnapshot, A, TError>,
  current: TSnapshot,
): Effect.Effect<readonly [TSnapshot, A], TError> => {
  const result = f(current);
  return Effect.isEffect(result) ? result : Effect.succeed(result);
};

const reapplyOptimisticUpdates = <TSnapshot, TError>(
  base: TSnapshot,
  updates: ReadonlyArray<UpdateFn<TSnapshot, unknown, TError>>,
): Effect.Effect<TSnapshot, TError> =>
  Effect.gen(function* () {
    let current = base;
    for (const update of updates) {
      const [next] = yield* runUpdateFn(update, current);
      current = next;
    }
    return current;
  });

/**
 * @since 0.0.0
 * @category constructor
 */
export function make<
  TSnapshot,
  TStorage extends ReplicaProjectionStorage<TSnapshot, any> | undefined,
  TBootstrapRow = never,
  TError = never,
>(options: {
  readonly initialValue: TSnapshot;
  readonly storage?: TStorage;
  readonly updateContext?: UpdateContext;
  readonly bootstrap?: BootstrapFn<TSnapshot, TBootstrapRow, TError>;
}): Effect.Effect<
  ReplicaProjectionRuntime<TSnapshot, RuntimeError<TStorage, TError>, TBootstrapRow>,
  StorageError<TStorage>
> {
  return Effect.gen(function* () {
    const storedSnapshot = options.storage ? yield* options.storage.load : Option.none<TSnapshot>();
    const hydrated = Option.getOrElse(storedSnapshot, () => options.initialValue);
    const ref = AtomRef.make(hydrated);
    const lock = yield* Semaphore.make(1);
    let persistedSnapshot = hydrated;
    const optimisticUpdates = new Map<
      string,
      UpdateFn<TSnapshot, unknown, RuntimeError<TStorage, TError>>
    >();

    const loadPersistedSnapshot = (): Effect.Effect<TSnapshot, StorageError<TStorage>> =>
      options.storage
        ? options.storage.load.pipe(
            Effect.map((snapshot) => Option.getOrElse(snapshot, () => persistedSnapshot)),
          )
        : Effect.succeed(persistedSnapshot);

    const persistSnapshot = (snapshot: TSnapshot) =>
      options.storage
        ? options.storage.save(snapshot).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                persistedSnapshot = snapshot;
              }),
            ),
          )
        : Effect.sync(() => {
            persistedSnapshot = snapshot;
          });

    const applyOptimisticUpdate = <A>(
      id: string,
      f: UpdateFn<TSnapshot, A, RuntimeError<TStorage, TError>>,
    ) =>
      Effect.gen(function* () {
        const [next, value] = yield* runUpdateFn(f, ref.value);
        ref.set(next);
        optimisticUpdates.set(id, f);
        return value;
      });

    const removeOptimisticUpdate = (id: string) =>
      Effect.gen(function* () {
        optimisticUpdates.delete(id);
        const visible = yield* reapplyOptimisticUpdates(persistedSnapshot, [
          ...optimisticUpdates.values(),
        ]);
        ref.set(visible);
      });

    const applyAcceptedUpdate = <A>(
      f: UpdateFn<TSnapshot, A, RuntimeError<TStorage, TError>>,
      optimisticId?: string,
    ) =>
      Effect.gen(function* () {
        if (optimisticId) {
          optimisticUpdates.delete(optimisticId);
        }

        if (optimisticUpdates.size === 0) {
          const [next, value] = yield* runUpdateFn(f, persistedSnapshot);
          yield* persistSnapshot(next);
          ref.set(next);
          return value;
        }

        const databaseSnapshot = yield* loadPersistedSnapshot();
        const [next, value] = yield* runUpdateFn(f, databaseSnapshot);
        yield* persistSnapshot(next);
        const merged = yield* reapplyOptimisticUpdates(next, [...optimisticUpdates.values()]);
        ref.set(merged);
        return value;
      });

    const applyBootstrap = (rows: Stream.Stream<TBootstrapRow, unknown, never>) =>
      Effect.gen(function* () {
        if (!options.bootstrap) {
          return yield* Effect.die(new Error("Replica projection bootstrap is not configured"));
        }

        const snapshot = yield* options.bootstrap(rows);
        optimisticUpdates.clear();
        yield* persistSnapshot(snapshot);
        ref.set(snapshot);
      });

    const applyUpdate = <A>(f: UpdateFn<TSnapshot, A, RuntimeError<TStorage, TError>>) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          if (options.updateContext) {
            const { eventId, phase } = yield* options.updateContext.current;
            if (phase === "optimistic") {
              return yield* applyOptimisticUpdate(eventId, f);
            }
            if (phase === "rejected") {
              yield* removeOptimisticUpdate(eventId);
              return undefined as never;
            }
            return yield* applyAcceptedUpdate(f, eventId);
          }

          return yield* applyAcceptedUpdate(f);
        }),
      );

    const atom = Atom.make((get) => {
      const unsubscribe = ref.subscribe((snapshot) => {
        get.setSelf(snapshot);
      });

      get.addFinalizer(unsubscribe);

      return ref.value;
    });

    return {
      projection: {
        atom,
        query: (filter) => Effect.sync(() => filter(ref.value)),
        bootstrap: (rows) => lock.withPermits(1)(applyBootstrap(rows)),
      },
      store: {
        update: applyUpdate,
      },
    };
  });
}

/**
 * @since 0.0.0
 * @category layer
 */
export function layer<
  TProjectionIdentifier,
  TSnapshot,
  TStorage extends ReplicaProjectionStorage<TSnapshot, any> | undefined = undefined,
  TBootstrapRow = never,
  TStoreIdentifier = never,
  TError = never,
>(
  tag: Context.Service<
    TProjectionIdentifier,
    IReactiveReplicaProjection<TSnapshot, RuntimeError<TStorage, TError>, TBootstrapRow>
  >,
  options: {
    readonly initialValue: TSnapshot;
    readonly storage?: TStorage;
    readonly store?: Context.Service<
      TStoreIdentifier,
      IReplicaProjectionStore<TSnapshot, RuntimeError<TStorage, TError>>
    >;
    readonly updateContext?: UpdateContext;
    readonly bootstrap?: BootstrapFn<TSnapshot, TBootstrapRow, TError>;
  },
): Layer.Layer<TProjectionIdentifier | TStoreIdentifier, StorageError<TStorage>> {
  return Layer.effectContext(
    make(options).pipe(
      Effect.map((runtime) => {
        const context = Context.make(tag, runtime.projection);
        if (options.store) {
          return Context.add(context, options.store, runtime.store);
        }
        return context as Context.Context<TProjectionIdentifier | TStoreIdentifier>;
      }),
    ),
  );
}

const routeReplicaProjection = <const TRegistration extends AnyReplicaProjectionRegistration>(
  registration: TRegistration,
  context: Context.Context<ReplicaProjectionRegistrationContext<TRegistration>>,
): RoutedReplicaProjection => {
  const projection = Context.get(context, registration.projection) as IReplicaProjection<
    any,
    unknown,
    any
  >;

  return {
    key: registration.key,
    bootstrap: (rows) => projection.bootstrap(rows),
  };
};

/**
 * @since 0.0.0
 * @category layer
 */
export function routerLayer<
  const TRegistrations extends ReadonlyArray<AnyReplicaProjectionRegistration>,
>(input: {
  readonly projections: TRegistrations;
}): Layer.Layer<
  ReplicaProjectionRouter,
  never,
  ReplicaProjectionRegistrationContext<TRegistrations[number]>
> {
  return Layer.effect(
    ReplicaProjectionRouter,
    Effect.gen(function* () {
      const context =
        yield* Effect.context<ReplicaProjectionRegistrationContext<TRegistrations[number]>>();
      const projections = input.projections.map((projection) =>
        routeReplicaProjection(
          projection,
          context as Context.Context<ReplicaProjectionRegistrationContext<typeof projection>>,
        ),
      );
      const projectionsByKey = HashMap.fromIterable(
        projections.map((projection) => [projection.key, projection] as const),
      );

      return ReplicaProjectionRouter.of({
        all: projections,
        find: (key) => Option.getOrUndefined(HashMap.get(projectionsByKey, key)),
      });
    }),
  );
}

/**
 * @since 0.0.0
 * @category layer
 */
export const emptyLayer: Layer.Layer<ReplicaProjectionRouter> = Layer.succeed(
  ReplicaProjectionRouter,
  ReplicaProjectionRouter.of({
    all: [],
    find: () => undefined,
  }),
);
