import { Context, Effect, Layer } from "effect";
import type { EventInstance } from "../../event/event-instance.ts";

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IOptimisticEventApplier {
  readonly apply: (event: EventInstance) => Effect.Effect<void>;
  readonly remove: (eventId: string) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class OptimisticEventApplier extends Context.Service<
  OptimisticEventApplier,
  IOptimisticEventApplier
>()("OptimisticEventApplier") {}

/**
 * @since 0.0.0
 * @category layer
 */
export const noopLayer: Layer.Layer<OptimisticEventApplier> = Layer.succeed(
  OptimisticEventApplier,
  OptimisticEventApplier.of({
    apply: () => Effect.void,
    remove: () => Effect.void,
    clear: Effect.void,
  }),
);

/**
 * @since 0.0.0
 * @category layer
 */
export const fromOverlay = <TSnapshot>(
  overlay: {
    readonly apply: (event: EventInstance) => Effect.Effect<void>;
    readonly remove: (eventId: string) => Effect.Effect<void>;
    readonly clear: Effect.Effect<void>;
  },
): Layer.Layer<OptimisticEventApplier> =>
  Layer.succeed(
    OptimisticEventApplier,
    OptimisticEventApplier.of({
      apply: overlay.apply,
      remove: overlay.remove,
      clear: overlay.clear,
    }),
  );
