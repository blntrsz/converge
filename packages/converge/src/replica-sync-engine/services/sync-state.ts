import { Context, Data, Effect, Layer, Ref } from "effect";

/**
 * @since 0.0.0
 * @category model
 */
export type SyncMode = Data.TaggedEnum<{
  Latest: {};
  Checkout: { readonly syncAnchor: string };
}>;

/**
 * @since 0.0.0
 * @category model
 */
export const SyncMode = Data.taggedEnum<SyncMode>();

/**
 * @since 0.0.0
 * @category model
 */
export interface SyncStateSnapshot {
  readonly mode: SyncMode;
  readonly bootstrapped: boolean;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface ISyncState {
  readonly current: Effect.Effect<SyncStateSnapshot>;
  readonly set: (snapshot: SyncStateSnapshot) => Effect.Effect<void>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class SyncState extends Context.Service<SyncState, ISyncState>()("SyncState") {}

const defaultSnapshot: SyncStateSnapshot = {
  mode: SyncMode.Latest(),
  bootstrapped: false,
};

/**
 * @since 0.0.0
 * @category layer
 */
export const memoryLayer: Layer.Layer<SyncState> = Layer.effect(
  SyncState,
  Effect.gen(function* () {
    const ref = yield* Ref.make(defaultSnapshot);

    return SyncState.of({
      current: Ref.get(ref),
      set: Ref.set(ref),
    });
  }),
);
