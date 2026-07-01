import { Context, Effect, Layer } from "effect";
import { make, type IProjection } from "../services/projection.ts";

/**
 * @since 0.0.0
 * @category layer
 */
export function memoryLayer<TIdentifier, TSnapshot, TError = never>(
  tag: Context.Service<TIdentifier, IProjection<TSnapshot, TError>>,
  options: {
    readonly initialValue: TSnapshot;
  },
): Layer.Layer<TIdentifier> {
  return Layer.effect(tag, make(options) as Effect.Effect<IProjection<TSnapshot, TError>>);
}
