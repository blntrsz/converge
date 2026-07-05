import { Schema } from "effect";

/**
 * EventInstance identity shared across primary and replica.
 *
 * @since 0.0.0
 * @category schema
 */
export const EventId = Schema.String.pipe(Schema.brand("EventId"));

/**
 * @since 0.0.0
 * @category type
 */
export type EventId = typeof EventId.Type;
