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
