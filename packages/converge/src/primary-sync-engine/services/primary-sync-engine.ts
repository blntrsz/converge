import { Context, Effect, Option, Result } from "effect";
import type { EventInstance } from "../../event";

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IPrimarySyncEngine {
  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  pull(cursor?: string): Effect.Effect<
    | {
        data: EventInstance.EventInstance[];
        hasNext: true;
        cursor: string;
      }
    | {
        data: EventInstance.EventInstance[];
        hasNext: false;
      }
  >;

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
  getLatestEvent(): Effect.Effect<Option.Option<EventInstance.EventInstance>>;

  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  getEvent(eventId: string): Effect.Effect<Option.Option<EventInstance.EventInstance>>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class PrimarySyncEngine extends Context.Service<PrimarySyncEngine, IPrimarySyncEngine>()(
  "PrimarySyncEngine",
) {}
