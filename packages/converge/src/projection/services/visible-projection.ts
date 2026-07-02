import { Effect, Layer } from "effect";
import type { Context } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { IOptimisticOverlay } from "./optimistic-overlay.ts";
import type { IReactiveProjection } from "./projection.ts";

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IVisibleProjection<TSnapshot, TError = never>
  extends IReactiveProjection<TSnapshot, TError> {
  readonly committed: IReactiveProjection<TSnapshot, TError>;
  readonly overlay: IOptimisticOverlay<TSnapshot>;
}

/**
 * @since 0.0.0
 * @category constructor
 */
export function make<TSnapshot, TError>(
  committed: IReactiveProjection<TSnapshot, TError>,
  overlay: IOptimisticOverlay<TSnapshot>,
): IVisibleProjection<TSnapshot, TError> {
  return {
    committed,
    overlay,
    atom: overlay.atom,
    query: (filter) =>
      Effect.sync(() => {
        const registry = AtomRegistry.make({
          scheduleTask: (run) => {
            run();
            return () => undefined;
          },
        });
        const snapshot = registry.get(overlay.atom);
        registry.dispose();
        return filter(snapshot);
      }),
    mutation: committed.mutation,
    optimisticMutation: committed.optimisticMutation,
    removeOptimisticMutation: committed.removeOptimisticMutation,
  };
}

/**
 * @since 0.0.0
 * @category layer
 */
export function layer<TIdentifier, TSnapshot, TError>(
  tag: Context.Service<TIdentifier, IVisibleProjection<TSnapshot, TError>>,
  committed: IReactiveProjection<TSnapshot, TError>,
  overlay: IOptimisticOverlay<TSnapshot>,
): Layer.Layer<TIdentifier> {
  return Layer.succeed(tag, make(committed, overlay));
}
