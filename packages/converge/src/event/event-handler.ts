import { EventInstance } from "./event-instance.ts";
import * as Event from "./event";
import { Effect, Schema } from "effect";

/**
 * @since 0.0.0
 * @category entity
 */
export class EventHandler<
  const TEventType extends string,
  const TEventDetails extends Schema.Struct.Fields,
  TError = never,
  TContext = never,
> {
  constructor(
    readonly event: Event.Event<TEventType, TEventDetails>,
    readonly handler: (
      event: EventInstance<TEventType, TEventDetails>,
    ) => Effect.Effect<unknown, TError, TContext>,
  ) {}

  run(event: EventInstance<TEventType, TEventDetails>) {
    return this.handler(event).pipe(Effect.asVoid);
  }
}

/**
 * A handler for one specific Event type, with the Event type intentionally erased.
 *
 * @since 0.0.0
 * @category type
 */
export type AnyEventHandler = EventHandler<any, any, any, any>;

/**
 * @since 0.0.0
 * @category type
 */
export type EventHandlerError<TEventHandler> =
  TEventHandler extends EventHandler<any, any, infer TError, any> ? TError : never;

/**
 * @since 0.0.0
 * @category type
 */
export type EventHandlerContext<TEventHandler> =
  TEventHandler extends EventHandler<any, any, any, infer TContext> ? TContext : never;

/**
 * @since 0.0.0
 * @category constructuor
 */
export function make<
  const TEventType extends string,
  const TEventDetails extends Schema.Struct.Fields,
  TError,
  TContext,
>(
  event: Event.Event<TEventType, TEventDetails>,
  handler: (
    event: EventInstance<TEventType, TEventDetails>,
  ) => Effect.Effect<unknown, TError, TContext>,
) {
  return new EventHandler(event, handler);
}
