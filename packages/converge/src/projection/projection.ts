import { Effect, Option, Schema } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRef from "effect/unstable/reactivity/AtomRef";
import * as Event from "../event/event";
import * as EventHandler from "../event/event-handler";
import * as EventInstance from "../event/event-instance";

/**
 * @since 0.0.0
 * @category error
 */
export class ProjectionStorageError {
  readonly _tag = "ProjectionStorageError";

  constructor(
    readonly input: {
      readonly operation: "resolve" | "encode" | "save";
      readonly key: string;
      readonly cause: unknown;
    },
  ) {}
}

/**
 * @since 0.0.0
 * @category model
 */
export interface ProjectionStorage<TSnapshot, TError = never> {
  readonly load: Effect.Effect<Option.Option<TSnapshot>, TError>;
  readonly save: (snapshot: TSnapshot) => Effect.Effect<void, TError>;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface ProjectionKeyValueStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface ProjectionReducer<
  TSnapshot,
  TProjectionEvent extends Event.AnyEvent,
  TError,
  TContext,
> {
  readonly event: TProjectionEvent;
  readonly reduce: (
    snapshot: TSnapshot,
    event: EventInstance.EventInstance<EventType<TProjectionEvent>, EventDetails<TProjectionEvent>>,
  ) => Effect.Effect<TSnapshot, TError, TContext>;
}

type AnyProjectionReducer<TSnapshot> = ProjectionReducer<TSnapshot, Event.AnyEvent, any, any>;

type EventType<TProjectionEvent> =
  TProjectionEvent extends Event.Event<infer TEventType, any> ? TEventType : never;

type EventDetails<TProjectionEvent> =
  TProjectionEvent extends Event.Event<any, infer TEventDetails> ? TEventDetails : never;

type ReducerError<TReducer> =
  TReducer extends ProjectionReducer<any, any, infer TError, any> ? TError : never;

type ReducerContext<TReducer> =
  TReducer extends ProjectionReducer<any, any, any, infer TContext> ? TContext : never;

type StorageError<TStorage> =
  TStorage extends ProjectionStorage<any, infer TError> ? TError : never;

type EffectError<TEffect> = TEffect extends Effect.Effect<any, infer TError, any> ? TError : never;

type EffectContext<TEffect> =
  TEffect extends Effect.Effect<any, any, infer TContext> ? TContext : never;

type ProjectionHandlers<
  TSnapshot,
  TReducers extends ReadonlyArray<AnyProjectionReducer<TSnapshot>>,
  TStorage,
> = {
  readonly [TKey in keyof TReducers]: TReducers[TKey] extends ProjectionReducer<
    TSnapshot,
    Event.Event<infer TEventType, infer TEventDetails>,
    infer TError,
    infer TContext
  >
    ? EventHandler.EventHandler<
        TEventType,
        TEventDetails,
        TError | StorageError<TStorage>,
        TContext
      >
    : never;
};

/**
 * @since 0.0.0
 * @category model
 */
export interface Projection<
  TSnapshot,
  TReducers extends ReadonlyArray<AnyProjectionReducer<TSnapshot>>,
  TStorage,
> {
  readonly name?: string;
  readonly ref: AtomRef.AtomRef<TSnapshot>;
  readonly atom: Atom.Atom<TSnapshot>;
  readonly handlers: ProjectionHandlers<TSnapshot, TReducers, TStorage>;
  readonly getSnapshot: () => TSnapshot;
  readonly setSnapshot: (snapshot: TSnapshot) => Effect.Effect<void, StorageError<TStorage>>;
  readonly apply: (
    event: EventInstance.EventInstance,
  ) => Effect.Effect<
    void,
    ReducerError<TReducers[number]> | StorageError<TStorage>,
    ReducerContext<TReducers[number]>
  >;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * @since 0.0.0
 * @category constructor
 */
export function reducer<
  const TEventType extends string,
  const TEventDetails extends Schema.Struct.Fields,
  TSnapshot,
  TEffect extends Effect.Effect<TSnapshot, any, any>,
>(
  event: Event.Event<TEventType, TEventDetails>,
  reduce: (
    snapshot: TSnapshot,
    event: EventInstance.EventInstance<TEventType, TEventDetails>,
  ) => TEffect,
): ProjectionReducer<
  TSnapshot,
  Event.Event<TEventType, TEventDetails>,
  EffectError<TEffect>,
  EffectContext<TEffect>
> {
  return { event, reduce };
}

/**
 * @since 0.0.0
 * @category constructor
 */
export function make<
  const TSnapshot,
  const TReducers extends ReadonlyArray<AnyProjectionReducer<TSnapshot>>,
  const TStorage extends ProjectionStorage<TSnapshot, any> | undefined = undefined,
>(options: {
  readonly name?: string;
  readonly initialValue: TSnapshot;
  readonly reducers: TReducers;
  readonly storage?: TStorage;
}): Projection<TSnapshot, TReducers, TStorage> {
  const initialValue: TSnapshot = loadInitialSnapshot<TSnapshot>(
    options.initialValue,
    options.storage,
  );
  const ref = AtomRef.make(initialValue);
  const reducerByEventType = new Map(
    options.reducers.map((projectionReducer) => [
      projectionReducer.event.eventType,
      projectionReducer,
    ]),
  );

  const setSnapshot = (snapshot: TSnapshot) =>
    Effect.gen(function* () {
      if (options.storage) {
        yield* options.storage.save(snapshot);
      }

      yield* Effect.sync(() => {
        ref.set(snapshot);
      });
    });

  const applyReducer = (
    projectionReducer: AnyProjectionReducer<TSnapshot>,
    event: EventInstance.EventInstance,
  ) =>
    Effect.gen(function* () {
      const nextSnapshot = yield* projectionReducer.reduce(
        ref.value,
        event as EventInstance.EventInstance<any, any>,
      );

      yield* setSnapshot(nextSnapshot);
    });

  const atom = Atom.make((get) => {
    const unsubscribe = ref.subscribe((snapshot) => {
      get.setSelf(snapshot);
    });

    get.addFinalizer(unsubscribe);

    return ref.value;
  });

  return {
    name: options.name,
    ref,
    atom,
    handlers: options.reducers.map((projectionReducer) =>
      EventHandler.make(projectionReducer.event, (event) => applyReducer(projectionReducer, event)),
    ) as ProjectionHandlers<TSnapshot, TReducers, TStorage>,
    getSnapshot: () => ref.value,
    setSnapshot,
    apply: (event) => {
      const projectionReducer = reducerByEventType.get(event.eventType);

      return projectionReducer ? applyReducer(projectionReducer, event) : Effect.void;
    },
    subscribe: (listener) => ref.subscribe(() => listener()),
  };
}

/**
 * @since 0.0.0
 * @category storage
 */
export function localStorage<const TSchema extends Schema.Schema<any>>(
  schema: TSchema & {
    readonly DecodingServices: never;
    readonly EncodingServices: never;
  },
  options: {
    readonly key: string;
    readonly storage?: ProjectionKeyValueStorage;
  },
): ProjectionStorage<Schema.Schema.Type<TSchema>, ProjectionStorageError> {
  const decodeSnapshot = Schema.decodeUnknownEffect(schema);
  const encodeSnapshot = Schema.encodeUnknownEffect(schema);

  return {
    load: Effect.gen(function* () {
      const storage = yield* resolveStorage(options.key, options.storage);
      const stored = storage.getItem(options.key);
      if (stored === null) {
        return Option.none<Schema.Schema.Type<TSchema>>();
      }

      const parsed = yield* Effect.try({
        try: () => JSON.parse(stored) as unknown,
        catch: () => undefined,
      });
      if (parsed === undefined) {
        return Option.none<Schema.Schema.Type<TSchema>>();
      }

      const decoded = yield* decodeSnapshot(parsed).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );

      return decoded === undefined
        ? Option.none<Schema.Schema.Type<TSchema>>()
        : Option.some(decoded);
    }).pipe(Effect.catch(() => Effect.succeed(Option.none<Schema.Schema.Type<TSchema>>()))),
    save: (snapshot) =>
      Effect.gen(function* () {
        const storage = yield* resolveStorage(options.key, options.storage);
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

        yield* Effect.try({
          try: () => {
            storage.setItem(options.key, JSON.stringify(encoded));
          },
          catch: (cause) =>
            new ProjectionStorageError({
              operation: "save",
              key: options.key,
              cause,
            }),
        });
      }),
  };
}

const loadInitialSnapshot = <TSnapshot>(
  initialValue: TSnapshot,
  storage: ProjectionStorage<TSnapshot, any> | undefined,
) => {
  if (!storage) return initialValue;

  const stored = Effect.runSync(
    storage.load.pipe(Effect.catch(() => Effect.succeed(Option.none<TSnapshot>()))),
  );

  return Option.getOrElse(stored, () => initialValue);
};

const resolveStorage = (key: string, storage: ProjectionKeyValueStorage | undefined) =>
  Effect.try({
    try: () => {
      const resolved =
        storage ??
        (globalThis as unknown as { readonly localStorage?: ProjectionKeyValueStorage })
          .localStorage;

      if (!resolved) {
        throw new Error("localStorage is not available");
      }

      return resolved;
    },
    catch: (cause) =>
      new ProjectionStorageError({
        operation: "resolve",
        key,
        cause,
      }),
  });
