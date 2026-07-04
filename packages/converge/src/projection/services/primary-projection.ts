import { Effect, Stream } from "effect";

/**
 * Read-only primary projection over versioned storage. Bootstrap and historical
 * reads are anchored with `eventId`; ordering and `since` use event history id
 * internally.
 *
 * @since 0.0.0
 * @category service-interface
 */
export interface IPrimaryProjection<TEntity> {
  readonly key: string;
  readonly stream: (eventId: string) => Stream.Stream<TEntity>;
}

/**
 * Collects every entity emitted by `stream` at the given sync position `eventId`.
 *
 * @since 0.0.0
 * @category helpers
 */
export const collectAll = <TEntity>(
  projection: IPrimaryProjection<TEntity>,
  eventId: string,
): Effect.Effect<ReadonlyArray<TEntity>> =>
  Stream.runCollect(projection.stream(eventId));
