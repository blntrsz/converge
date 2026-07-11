import { Context, type Effect } from "effect";
import type { EventInstance } from "../../event";

/**
 * @since 0.0.0
 * @category model
 */
export type SyncMode =
  | {
      readonly _tag: "Latest";
    }
  | {
      readonly _tag: "Checkout";
      readonly eventId: string;
    };

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReplicaSyncEngine {
  /**
   * The active replica sync mode.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  readonly mode: Effect.Effect<SyncMode>;

  /**
   * Runs the local event handler optimistically and enqueues a remote forward.
   *
   * Returns once the optimistic projection update is complete. The remote
   * verdict happens in a background consumer. On accept, the forward task
   * appends to `event_history` immediately; events accepted elsewhere are
   * appended when pulled.
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

  /**
   * Pins the replica to a historical eventId. Checkout mode is read-only:
   * push and poke are no-ops until the replica returns to Latest.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  checkout(eventId: string): Effect.Effect<void>;

  /**
   * Returns the replica to Latest mode.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  setLatest(): Effect.Effect<void>;

  /**
   * Re-bootstraps all projections at the active sync mode's sequence without
   * changing the mode. Used to recover from a broken event chain.
   *
   * @since 0.0.0
   * @category service-method-interface
   */
  repair(): Effect.Effect<void>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class ReplicaSyncEngine extends Context.Service<ReplicaSyncEngine, IReplicaSyncEngine>()(
  "ReplicaSyncEngine",
) {}
