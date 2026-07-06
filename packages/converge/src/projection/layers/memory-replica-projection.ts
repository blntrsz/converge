import { Context, Layer } from "effect";
import {
  layer,
  type BootstrapFn,
  type IReactiveReplicaProjection,
  type IReplicaProjectionStore,
} from "../services/replica-projection.ts";

/**
 * @since 0.0.0
 * @category layer
 */
export function memoryLayer<
  TIdentifier,
  TSnapshot,
  TError = never,
  TBootstrapRow = never,
  TStoreIdentifier = never,
>(
  tag: Context.Service<TIdentifier, IReactiveReplicaProjection<TSnapshot, TError, TBootstrapRow>>,
  options: {
    readonly initialValue: TSnapshot;
    readonly store?: Context.Service<TStoreIdentifier, IReplicaProjectionStore<TSnapshot, TError>>;
    readonly bootstrap?: BootstrapFn<TSnapshot, TBootstrapRow, TError>;
  },
): Layer.Layer<TIdentifier | TStoreIdentifier> {
  return layer(tag, options) as Layer.Layer<TIdentifier | TStoreIdentifier>;
}
