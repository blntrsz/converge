import { Context, Option, Result, type Effect } from "effect";
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
  getEvent(eventId: string): Effect.Effect<Option.Option<StoredEvent>>;

  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  bootstrap(
    projectionKey: string,
    eventId: string,
  ): Effect.Effect<Option.Option<ProjectionBootstrapSnapshot>>;
}

/**
 * An accepted EventInstance with its monotonic event history id.
 *
 * @since 0.0.0
 * @category type
 */
export interface StoredEvent {
  readonly event: EventInstance.EventInstance;
  readonly sequence: number;
}

/**
 * @since 0.0.0
 * @category type
 */
export interface ProjectionBootstrapSnapshot {
  readonly projectionKey: string;
  readonly snapshot: unknown;
  readonly anchorEvent: EventInstance.EventInstance;
}

/**
 * @since 0.0.0
 * @category service
 */
export class PrimarySyncEngine extends Context.Service<PrimarySyncEngine, IPrimarySyncEngine>()(
  "PrimarySyncEngine",
) {}
