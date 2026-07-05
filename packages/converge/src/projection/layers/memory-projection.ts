import { Context, Effect, Layer } from "effect";
import { make, type BootstrapFn, type IReactiveProjection } from "../services/projection.ts";

/**
 * @since 0.0.0
 * @category layer
 */
export function memoryLayer<TIdentifier, TSnapshot, TError = never, TBootstrapRow = never>(
  tag: Context.Service<TIdentifier, IReactiveProjection<TSnapshot, TError, TBootstrapRow>>,
  options: {
    readonly initialValue: TSnapshot;
    readonly bootstrap?: BootstrapFn<TSnapshot, TBootstrapRow, TError>;
  },
): Layer.Layer<TIdentifier> {
  return Layer.effect(
    tag,
    make(options) as Effect.Effect<IReactiveProjection<TSnapshot, TError, TBootstrapRow>>,
  );
}
