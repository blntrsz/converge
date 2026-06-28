import { Schema } from "effect";

/**
 * @since 0.0.0
 * @category error
 */
export class EventStoreSaveFailed extends Schema.TaggedErrorClass<EventStoreSaveFailed>()(
  "EventStoreSaveFailed",
  {
    eventId: Schema.UndefinedOr(Schema.String),
    cause: Schema.Unknown,
  },
) {}

/**
 * @since 0.0.0
 * @category error
 */
export class EventStoreScanFailed extends Schema.TaggedErrorClass<EventStoreScanFailed>()(
  "EventStoreScanFailed",
  {
    cursor: Schema.UndefinedOr(Schema.Number),
    limit: Schema.UndefinedOr(Schema.Number),
    cause: Schema.Unknown,
  },
) {}

/**
 * @since 0.0.0
 * @category error
 */
export class EventStoreGetFailed extends Schema.TaggedErrorClass<EventStoreGetFailed>()(
  "EventStoreGetFailed",
  {
    eventId: Schema.String,
    cause: Schema.Unknown,
  },
) {}
