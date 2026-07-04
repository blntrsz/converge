import { Context, Effect, Layer, Option } from "effect";
import { collectAll, type IPrimaryProjection } from "./primary-projection.ts";

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IPrimaryProjectionRegistry {
  readonly find: (key: string) => Option.Option<IPrimaryProjection<unknown>>;
  readonly keys: Effect.Effect<ReadonlyArray<string>>;
  readonly bootstrap: (
    key: string,
    eventId: string,
  ) => Effect.Effect<Option.Option<ReadonlyArray<unknown>>>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class PrimaryProjectionRegistry extends Context.Service<
  PrimaryProjectionRegistry,
  IPrimaryProjectionRegistry
>()("PrimaryProjectionRegistry") {}

/**
 * @since 0.0.0
 * @category constructor
 */
export function make(
  projections: ReadonlyArray<IPrimaryProjection<unknown>>,
): IPrimaryProjectionRegistry {
  const projectionsByKey = new Map(
    projections.map((projection) => [projection.key, projection] as const),
  );

  return {
    find: (key) => Option.fromUndefinedOr(projectionsByKey.get(key)),
    keys: Effect.succeed([...projectionsByKey.keys()]),
    bootstrap: (key, eventId) =>
      Effect.gen(function* () {
        const projection = projectionsByKey.get(key);
        if (!projection) {
          return Option.none();
        }

        return Option.some(yield* collectAll(projection, eventId));
      }),
  };
}

/**
 * @since 0.0.0
 * @category layer
 */
export function layer(
  projections: ReadonlyArray<IPrimaryProjection<unknown>>,
): Layer.Layer<PrimaryProjectionRegistry> {
  return Layer.succeed(PrimaryProjectionRegistry, make(projections));
}
