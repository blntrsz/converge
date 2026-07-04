import { Effect } from "effect";

/**
 * A page of entities materialized from primary versioned storage at a sync
 * position. The sync position is always a wire `eventId`.
 *
 * @since 0.0.0
 * @category model
 */
export interface PrimaryProjectionPage<TEntity> {
  readonly data: ReadonlyArray<TEntity>;
  readonly hasNext: boolean;
  readonly cursor?: string;
}

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
  readonly list: (
    eventId: string,
    options?: {
      readonly cursor?: string;
      readonly limit?: number;
    },
  ) => Effect.Effect<PrimaryProjectionPage<TEntity>>;
}

/**
 * Collects every page from `list` at the given sync position `eventId`.
 *
 * @since 0.0.0
 * @category helpers
 */
export const listAll = <TEntity>(
  projection: IPrimaryProjection<TEntity>,
  eventId: string,
  pageSize = 100,
): Effect.Effect<ReadonlyArray<TEntity>> =>
  Effect.gen(function* () {
    const entities: Array<TEntity> = [];
    let cursor: string | undefined;

    while (true) {
      const page = yield* projection.list(eventId, { cursor, limit: pageSize });
      entities.push(...page.data);

      if (!page.hasNext) {
        return entities;
      }

      if (!page.cursor) {
        return entities;
      }

      cursor = page.cursor;
    }
  });
