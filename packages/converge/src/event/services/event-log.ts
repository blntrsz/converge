import { Context, type Effect, type Option } from "effect";
import type { EventInstance } from "../event-instance.ts";

/**
 * @since 0.0.0
 * @category model
 */
export type EventHistoryId = string;

/**
 * @since 0.0.0
 * @category model
 */
export interface EventLogAppendResult {
  readonly inserted: boolean;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface EventLogScanOptions {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface EventLogScanPage {
  readonly events: ReadonlyArray<EventInstance>;
  readonly nextCursor: Option.Option<string>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IEventLog {
  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  append(event: EventInstance): Effect.Effect<EventLogAppendResult>;

  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  scan(options?: EventLogScanOptions): Effect.Effect<EventLogScanPage>;

  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  resolveEventHistoryId(eventId: string): Effect.Effect<Option.Option<EventHistoryId>>;

  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  getLatestEvent(): Effect.Effect<Option.Option<EventInstance>>;

  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  getEvent(eventId: string): Effect.Effect<Option.Option<EventInstance>>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class EventLog extends Context.Service<EventLog, IEventLog>()("EventLog") {}
