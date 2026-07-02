import type { EventInstance } from "../../event/event-instance.ts";

/**
 * @since 0.0.0
 * @category model
 */
export type ReduceFunction<TSnapshot> = (
  snapshot: TSnapshot,
  event: EventInstance,
) => TSnapshot;

/**
 * @since 0.0.0
 * @category constructor
 */
export const applyReduce = <TSnapshot>(
  snapshot: TSnapshot,
  event: EventInstance,
  reduce: ReduceFunction<TSnapshot>,
): TSnapshot => reduce(snapshot, event);

/**
 * @since 0.0.0
 * @category constructor
 */
export const applyReduces = <TSnapshot>(
  snapshot: TSnapshot,
  events: ReadonlyArray<EventInstance>,
  findReduce: (eventType: string) => ReduceFunction<TSnapshot> | undefined,
): TSnapshot => {
  let current = snapshot;
  for (const event of events) {
    const reduce = findReduce(event.eventType);
    if (reduce) {
      current = reduce(current, event);
    }
  }
  return current;
};
