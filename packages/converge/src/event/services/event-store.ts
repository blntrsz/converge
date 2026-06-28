import { Context, type Effect, type Option } from "effect";
import type { EventStoreGetFailed, EventStoreSaveFailed, EventStoreScanFailed } from "./errors.ts";
import type { EventInstance } from "../event-instance.ts";
import type { SchemaError } from "effect/Schema";
import type { NoSuchElementError } from "effect/Cause";

/**
 * @since 0.0.0
 * @category model
 */
export interface EventStoreScanOptions {
  readonly cursor: string | undefined;
  readonly limit?: number | undefined;
}

/**
 * @since 0.0.0
 * @category type
 */
export interface EventStoreScanPage {
  readonly events: ReadonlyArray<EventInstance>;
  readonly nextCursor: Option.Option<string>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IEventStore {
  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  save(event: EventInstance): Effect.Effect<void, EventStoreSaveFailed>;

  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  scan(
    options: EventStoreScanOptions,
  ): Effect.Effect<EventStoreScanPage, EventStoreScanFailed | SchemaError>;

  /**
   * @since 0.0.0
   * @category service-method-interface
   */
  get(
    eventId: string,
  ): Effect.Effect<EventInstance, EventStoreGetFailed | NoSuchElementError | SchemaError>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class EventStore extends Context.Service<EventStore, IEventStore>()("EventStore") {}
