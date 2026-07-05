import { Context, Effect, HashMap, Layer, Option, Schema, Semaphore, Stream } from "effect";
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
 * @category model
 */
export type MutationFn<TSnapshot, A, TError = never> = (
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
export type MutationPhase = "optimistic" | "accepted" | "rejected";

/**
 * @since 0.0.0
 * @category model
 */
export interface MutationContext {
  readonly current: Effect.Effect<{
    readonly phase: MutationPhase;
    readonly eventId: string;
  }>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IProjection<TSnapshot, TError = never, TBootstrapRow = never> {
  readonly query: <A>(filter: (current: TSnapshot) => A) => Effect.Effect<A>;
  readonly mutation: <A>(
    f: MutationFn<TSnapshot, A, TError>,
  ) => Effect.Effect<A, TError>;
  readonly optimisticMutation: <A>(
    id: string,
    f: MutationFn<TSnapshot, A, TError>,
  ) => Effect.Effect<A, TError>;
  readonly removeOptimisticMutation: (id: string) => Effect.Effect<void, TError>;
  readonly bootstrap: (
    rows: Stream.Stream<TBootstrapRow, unknown, never>,
  ) => Effect.Effect<void, TError | unknown>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReactiveProjection<TSnapshot, TError = never, TBootstrapRow = never>
  extends IProjection<TSnapshot, TError, TBootstrapRow> {
  readonly atom: Atom.Atom<TSnapshot>;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface ProjectionRegistration<
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
export type AnyProjectionRegistration = ProjectionRegistration<string, Context.Service.Any>;

/**
 * @since 0.0.0
 * @category type
 */
export type ProjectionRegistrationContext<TRegistration> =
  TRegistration extends ProjectionRegistration<any, infer TProjection>
    ? Context.Service.Identifier<TProjection>
    : never;

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface RoutedProjection<TKey extends string = string, TRow = unknown> {
  readonly key: TKey;
  readonly bootstrap: (
    rows: Stream.Stream<TRow, unknown, never>,
  ) => Effect.Effect<void, unknown>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IProjectionRouter {
  readonly find: (key: string) => RoutedProjection | undefined;
  readonly all: ReadonlyArray<RoutedProjection>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class ProjectionRouter extends Context.Service<ProjectionRouter, IProjectionRouter>()(
  "ProjectionRouter",
) {}

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

const runMutationFn = <TSnapshot, A, TError>(
  f: MutationFn<TSnapshot, A, TError>,
  current: TSnapshot,
): Effect.Effect<readonly [TSnapshot, A], TError> => {
  const result = f(current);
  return Effect.isEffect(result) ? result : Effect.succeed(result);
};

const reapplyOptimisticMutations = <TSnapshot, TError>(
  base: TSnapshot,
  mutations: ReadonlyArray<MutationFn<TSnapshot, unknown, TError>>,
): Effect.Effect<TSnapshot, TError> =>
  Effect.gen(function* () {
    let current = base;
    for (const mutation of mutations) {
      const [next] = yield* runMutationFn(mutation, current);
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
  TStorage extends ProjectionStorage<TSnapshot, any> | undefined,
  TBootstrapRow = never,
>(options: {
  readonly initialValue: TSnapshot;
  readonly storage?: TStorage;
  readonly mutationContext?: MutationContext;
  readonly bootstrap?: BootstrapFn<TSnapshot, TBootstrapRow, StorageError<TStorage>>;
}): Effect.Effect<
  IReactiveProjection<TSnapshot, StorageError<TStorage>, TBootstrapRow>,
  StorageError<TStorage>
> {
  return Effect.gen(function* () {
    const storedSnapshot = options.storage ? yield* options.storage.load : Option.none<TSnapshot>();
    const hydrated = Option.getOrElse(storedSnapshot, () => options.initialValue);
    const ref = AtomRef.make(hydrated);
    const lock = yield* Semaphore.make(1);
    let persistedSnapshot = hydrated;
    const optimisticMutations = new Map<
      string,
      MutationFn<TSnapshot, unknown, StorageError<TStorage>>
    >();

    const loadPersistedSnapshot = (): Effect.Effect<
      TSnapshot,
      StorageError<TStorage>
    > =>
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

    const applyOptimisticMutation = <A>(
      id: string,
      f: MutationFn<TSnapshot, A, StorageError<TStorage>>,
    ) =>
      Effect.gen(function* () {
        const [next, value] = yield* runMutationFn(f, ref.value);
        ref.set(next);
        optimisticMutations.set(id, f);
        return value;
      });

    const removeOptimisticMutation = (id: string) =>
      Effect.gen(function* () {
        optimisticMutations.delete(id);
        const visible = yield* reapplyOptimisticMutations(
          persistedSnapshot,
          [...optimisticMutations.values()],
        );
        ref.set(visible);
      });

    const applyAcceptedMutation = <A>(
      f: MutationFn<TSnapshot, A, StorageError<TStorage>>,
      optimisticId?: string,
    ) =>
      Effect.gen(function* () {
        if (optimisticId) {
          optimisticMutations.delete(optimisticId);
        }

        if (optimisticMutations.size === 0) {
          const [next, value] = yield* runMutationFn(f, persistedSnapshot);
          yield* persistSnapshot(next);
          ref.set(next);
          return value;
        }

        const databaseSnapshot = yield* loadPersistedSnapshot();
        const [next, value] = yield* runMutationFn(f, databaseSnapshot);
        yield* persistSnapshot(next);
        const merged = yield* reapplyOptimisticMutations(
          next,
          [...optimisticMutations.values()],
        );
        ref.set(merged);
        return value;
      });

    const applyBootstrap = (rows: Stream.Stream<TBootstrapRow, unknown, never>) =>
      Effect.gen(function* () {
        if (!options.bootstrap) {
          return yield* Effect.die(new Error("Projection bootstrap is not configured"));
        }

        const snapshot = yield* options.bootstrap(rows);
        optimisticMutations.clear();
        yield* persistSnapshot(snapshot);
        ref.set(snapshot);
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
      query: (filter) => Effect.sync(() => filter(ref.value)),
      optimisticMutation: (id, f) =>
        lock.withPermits(1)(applyOptimisticMutation(id, f)),
      removeOptimisticMutation: (id) =>
        lock.withPermits(1)(removeOptimisticMutation(id)),
      bootstrap: (rows) => lock.withPermits(1)(applyBootstrap(rows)),
      mutation: (f) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (options.mutationContext) {
              const { eventId, phase } = yield* options.mutationContext.current;
              if (phase === "optimistic") {
                return yield* applyOptimisticMutation(eventId, f);
              }
              if (phase === "rejected") {
                yield* removeOptimisticMutation(eventId);
                return undefined as never;
              }
              return yield* applyAcceptedMutation(f, eventId);
            }

            return yield* applyAcceptedMutation(f);
          }),
        ),
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
  TBootstrapRow = never,
>(
  tag: Context.Service<
    TIdentifier,
    IReactiveProjection<TSnapshot, StorageError<TStorage>, TBootstrapRow>
  >,
  options: {
    readonly initialValue: TSnapshot;
    readonly storage?: TStorage;
    readonly mutationContext?: MutationContext;
    readonly bootstrap?: BootstrapFn<TSnapshot, TBootstrapRow, StorageError<TStorage>>;
  },
): Layer.Layer<TIdentifier, StorageError<TStorage>> {
  return Layer.effect(tag, make(options));
}

const routeProjection = <const TRegistration extends AnyProjectionRegistration>(
  registration: TRegistration,
  context: Context.Context<ProjectionRegistrationContext<TRegistration>>,
): RoutedProjection => {
  const projection = Context.get(context, registration.projection) as IProjection<any, unknown, any>;

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
  const TRegistrations extends ReadonlyArray<AnyProjectionRegistration>,
>(input: {
  readonly projections: TRegistrations;
}): Layer.Layer<ProjectionRouter, never, ProjectionRegistrationContext<TRegistrations[number]>> {
  return Layer.effect(
    ProjectionRouter,
    Effect.gen(function* () {
      const context = yield* Effect.context<ProjectionRegistrationContext<TRegistrations[number]>>();
      const projections = input.projections.map((projection) =>
        routeProjection(
          projection,
          context as Context.Context<ProjectionRegistrationContext<typeof projection>>,
        ),
      );
      const projectionsByKey = HashMap.fromIterable(
        projections.map((projection) => [projection.key, projection] as const),
      );

      return ProjectionRouter.of({
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
export const emptyLayer: Layer.Layer<ProjectionRouter> = Layer.succeed(
  ProjectionRouter,
  ProjectionRouter.of({
    all: [],
    find: () => undefined,
  }),
);
