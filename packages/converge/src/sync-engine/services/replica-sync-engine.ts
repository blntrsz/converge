import { Context, Result, type Effect } from "effect";
import type { EventInstance } from "../../event";

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReplicaSyncEngine {
  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  push(
    ...events: EventInstance.EventInstance[]
  ): Effect.Effect<Result.Result<EventInstance.EventInstance, EventInstance.EventInstance>[]>;

  /**
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
