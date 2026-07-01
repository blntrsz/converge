import { Context, Effect, Layer, Ref } from "effect";

/**
 * @since 0.0.0
 * @category model
 */
export type ApplyPhase = "optimistic" | "accepted" | "rejected";

/**
 * @since 0.0.0
 * @category model
 */
export interface ApplyContext {
  readonly phase: ApplyPhase;
  readonly eventId: string;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReplicaApplyContext {
  readonly current: Effect.Effect<ApplyContext>;
  readonly set: (context: ApplyContext) => Effect.Effect<void>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class ReplicaApplyContext extends Context.Service<
  ReplicaApplyContext,
  IReplicaApplyContext
>()("ReplicaApplyContext") {}

const defaultContext: ApplyContext = {
  phase: "accepted",
  eventId: "",
};

/**
 * @since 0.0.0
 * @category layer
 */
export const layer: Layer.Layer<ReplicaApplyContext> = Layer.effect(
  ReplicaApplyContext,
  Effect.gen(function* () {
    const ref = yield* Ref.make(defaultContext);

    return ReplicaApplyContext.of({
      current: Ref.get(ref),
      set: (context) => Ref.set(ref, context),
    });
  }),
);
