import { Context, Schema, Stream } from "effect";
import type { EventId } from "../../event/event-id.ts";

/**
 * @since 0.0.0
 * @category model
 */
export interface PrimaryProjectionBootstrapOptions {
  readonly eventId: EventId;
}

/**
 * A primary projection streams rows for one projection key at a requested
 * EventInstance identity. Implementations infer private ordering state from
 * the eventId; callers never pass event history ids.
 *
 * @since 0.0.0
 * @category service-interface
 */
export interface PrimaryProjectionConfig<
  TKey extends string = string,
  TRow = unknown,
  TError = never,
  TContext = never,
> {
  readonly key: TKey;
  readonly rowSchema: Schema.Schema<TRow>;
  readonly bootstrap: (
    options: PrimaryProjectionBootstrapOptions,
  ) => Stream.Stream<TRow, TError, TContext>;
}

/**
 * @since 0.0.0
 * @category type
 */
export type AnyPrimaryProjectionConfig = PrimaryProjectionConfig<string, any, any, any>;

/**
 * @since 0.0.0
 * @category type
 */
export type PrimaryProjectionContext<TProjection> =
  TProjection extends PrimaryProjectionConfig<any, any, any, infer TContext> ? TContext : never;

/**
 * @since 0.0.0
 * @category type
 */
export type PrimaryProjectionError<TProjection> =
  TProjection extends PrimaryProjectionConfig<any, any, infer TError, any> ? TError : never;

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IPrimaryProjectionRouter {
  readonly find: (key: string) => AnyPrimaryProjectionConfig | undefined;
}

/**
 * @since 0.0.0
 * @category service
 */
export class PrimaryProjectionRouter extends Context.Service<
  PrimaryProjectionRouter,
  IPrimaryProjectionRouter
>()("PrimaryProjectionRouter") {}
