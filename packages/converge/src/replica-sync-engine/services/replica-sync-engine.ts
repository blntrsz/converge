import { Context, type Effect } from "effect";
import type { EventInstance } from "../../event";

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReplicaSyncEngine {
  /**
   * Runs the local event handler optimistically and enqueues a remote forward.
   *
   * Returns once the optimistic projection update is complete. The remote
   * verdict happens in a background consumer. The local `event_history` append
   * happens later when the accepted event is pulled from the primary.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  push(...events: EventInstance.EventInstance[]): Effect.Effect<void>;

  /**
   * Enqueues a reconcile task that pulls accepted events from the primary and
   * applies them to the local projection.
   *
   * Returns immediately. The pull and local apply happen in a background
   * consumer.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  poke(): Effect.Effect<void>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class ReplicaSyncEngine extends Context.Service<ReplicaSyncEngine, IReplicaSyncEngine>()(
  "ReplicaSyncEngine",
) {}
