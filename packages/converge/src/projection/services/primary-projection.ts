import { Context, Effect, HashMap, Layer, Option, Schema, Stream } from "effect";
import type { EventId } from "../../event/event-id.ts";

/**
 * @since 0.0.0
 * @category model
 */
export interface PrimaryProjectionBootstrapOptions {
  readonly eventId: EventId;
}

/**
 * A primary projection streams rows for one projection key at a requested
 * EventInstance identity. Implementations infer private ordering state from
 * the eventId; callers never pass event history ids.
 *
 * @since 0.0.0
 * @category service-interface
 */
export interface PrimaryProjectionConfig<
  TKey extends string = string,
  TRow = unknown,
  TError = never,
  TContext = never,
> {
  readonly key: TKey;
  readonly rowSchema: Schema.Schema<TRow>;
  readonly bootstrap: (
    options: PrimaryProjectionBootstrapOptions,
  ) => Stream.Stream<TRow, TError, TContext>;
}

/**
 * @since 0.0.0
 * @category type
 */
export type AnyPrimaryProjectionConfig = PrimaryProjectionConfig<string, any, any, any>;

/**
 * @since 0.0.0
 * @category type
 */
export type AnyRoutedPrimaryProjectionConfig = PrimaryProjectionConfig<string, any, any, never>;

/**
 * @since 0.0.0
 * @category type
 */
export type PrimaryProjectionContext<TProjection> =
  TProjection extends PrimaryProjectionConfig<any, any, any, infer TContext> ? TContext : never;

/**
 * @since 0.0.0
 * @category type
 */
export type PrimaryProjectionError<TProjection> =
  TProjection extends PrimaryProjectionConfig<any, any, infer TError, any> ? TError : never;

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IPrimaryProjectionRouter {
  readonly find: (key: string) => AnyRoutedPrimaryProjectionConfig | undefined;
}

/**
 * @since 0.0.0
 * @category service
 */
export class PrimaryProjectionRouter extends Context.Service<
  PrimaryProjectionRouter,
  IPrimaryProjectionRouter
>()("PrimaryProjectionRouter") {}

const provideProjectionContext = <const TProjection extends AnyPrimaryProjectionConfig>(
  projection: TProjection,
  context: Context.Context<PrimaryProjectionContext<TProjection>>,
): PrimaryProjectionConfig<string, any, PrimaryProjectionError<TProjection>, never> => ({
  key: projection.key,
  rowSchema: projection.rowSchema,
  bootstrap: (options) =>
    projection
      .bootstrap(options)
      .pipe(
        Stream.provideContext(
          context as Context.Context<PrimaryProjectionContext<typeof projection>>,
        ),
      ) as Stream.Stream<any, PrimaryProjectionError<TProjection>, never>,
});

/**
 * @since 0.0.0
 * @category layer
 */
export function layer<const TProjections extends ReadonlyArray<AnyPrimaryProjectionConfig>>(input: {
  readonly projections: TProjections;
}): Layer.Layer<PrimaryProjectionRouter, never, PrimaryProjectionContext<TProjections[number]>> {
  return Layer.effect(
    PrimaryProjectionRouter,
    Effect.gen(function* () {
      const context = yield* Effect.context<PrimaryProjectionContext<TProjections[number]>>();
      const projections = input.projections.map((projection) =>
        provideProjectionContext(
          projection,
          context as Context.Context<PrimaryProjectionContext<typeof projection>>,
        ),
      );
      const projectionsByKey = HashMap.fromIterable(
        projections.map((projection) => [projection.key, projection] as const),
      );

      return PrimaryProjectionRouter.of({
        find: (key) => Option.getOrUndefined(HashMap.get(projectionsByKey, key)),
      });
    }),
  );
}

/**
 * @since 0.0.0
 * @category layer
 */
export const emptyLayer: Layer.Layer<PrimaryProjectionRouter> = Layer.succeed(
  PrimaryProjectionRouter,
  PrimaryProjectionRouter.of({
    find: () => undefined,
  }),
);
