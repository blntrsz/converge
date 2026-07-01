import { Effect, Layer, Option, Schema, Semaphore } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRef from "effect/unstable/reactivity/AtomRef";
import type { Context } from "effect";

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
 * @category service-interface
 */
export interface IProjection<TSnapshot, TError = never> {
  readonly query: <A>(filter: (current: TSnapshot) => A) => Effect.Effect<A>;
  readonly mutation: <A>(
    f: MutationFn<TSnapshot, A, TError>,
  ) => Effect.Effect<A, TError>;
  readonly optimisticMutation: <A>(
    id: string,
    f: MutationFn<TSnapshot, A, TError>,
  ) => Effect.Effect<A, TError>;
  readonly removeOptimisticMutation: (id: string) => Effect.Effect<void, TError>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReactiveProjection<TSnapshot, TError = never>
  extends IProjection<TSnapshot, TError> {
  readonly atom: Atom.Atom<TSnapshot>;
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
>(options: {
  readonly initialValue: TSnapshot;
  readonly storage?: TStorage;
}): Effect.Effect<
  IReactiveProjection<TSnapshot, StorageError<TStorage>>,
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
        lock.withPermits(1)(
          Effect.gen(function* () {
            const [next, value] = yield* runMutationFn(f, ref.value);
            ref.set(next);
            optimisticMutations.set(id, f);
            return value;
          }),
        ),
      removeOptimisticMutation: (id) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            optimisticMutations.delete(id);
            const visible = yield* reapplyOptimisticMutations(
              persistedSnapshot,
              [...optimisticMutations.values()],
            );
            ref.set(visible);
          }),
        ),
      mutation: (f) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (optimisticMutations.size === 0) {
              const [next, value] = yield* runMutationFn(f, ref.value);
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
>(
  tag: Context.Service<
    TIdentifier,
    IReactiveProjection<TSnapshot, StorageError<TStorage>>
  >,
  options: {
    readonly initialValue: TSnapshot;
    readonly storage?: TStorage;
  },
): Layer.Layer<TIdentifier, StorageError<TStorage>> {
  return Layer.effect(tag, make(options));
}
