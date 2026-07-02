import { Context, type Effect } from "effect";
import type { EventInstance } from "../../event";

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReplicaSyncEngine {
  /**
   * Runs an optimistic overlay update and enqueues a remote forward.
   *
   * Returns once the optimistic overlay update is complete. The remote
   * verdict happens in a background consumer. The local `event_history` append
   * happens later when the accepted event is pulled from the primary.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  push(...events: EventInstance.EventInstance[]): Effect.Effect<void>;

  /**
   * Bootstraps if needed, then enqueues a reconcile task that pulls accepted
   * events from the primary and applies them locally.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  poke(): Effect.Effect<void>;

  /**
   * Pins a historical sync anchor and bootstraps all projections at that
   * sequence. Checkout mode is read-only.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  checkout(syncAnchor: string): Effect.Effect<void>;

  /**
   * Returns to Latest mode and re-bootstraps all projections at the primary
   * head before resuming sync.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  setLatest(): Effect.Effect<void>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class ReplicaSyncEngine extends Context.Service<ReplicaSyncEngine, IReplicaSyncEngine>()(
  "ReplicaSyncEngine",
) {}
