import { Array, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import { EventInstance } from "../event-instance.ts";
import { EventLog, type IEventLog } from "../services/event-log.ts";

const DefaultScanPageSize = 100;

const EventHistoryIdRow = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number, Schema.BigInt]),
});

/**
 * @since 0.0.0
 * @category migrations
 */
export const migrations = Migrator.fromRecord({
  "1_create_event_history": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE IF NOT EXISTS event_history (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        event_id text NOT NULL UNIQUE,
        event_type text NOT NULL,
        event_details jsonb NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `;
  }),
});

/**
 * @since 0.0.0
 * @category layer
 */
export const migrationsLayer = Layer.effectDiscard(Migrator.make({})({ loader: migrations }));

/**
 * @since 0.0.0
 * @category layer
 */
export const layer: Layer.Layer<EventLog, never, SqlClient.SqlClient> = Layer.effect(
  EventLog,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const scanEvents = SqlSchema.findAll({
      Request: Schema.Struct({
        limit: Schema.Number,
        cursor: Schema.String.pipe(Schema.optional),
      }),
      Result: EventInstance,
      execute: (input) =>
        input.cursor
          ? sql`
            SELECT
              event_id,
              event_type,
              event_details
            FROM event_history
            WHERE id > COALESCE(
              (SELECT id FROM event_history WHERE event_id = ${input.cursor}),
              0
            )
            ORDER BY id ASC
            LIMIT ${input.limit}
          `
          : sql`
            SELECT
              event_id,
              event_type,
              event_details
            FROM event_history
            ORDER BY id ASC
            LIMIT ${input.limit}
          `,
    });

    const resolveEventHistoryIdQuery = SqlSchema.findAll({
      Request: Schema.Struct({
        eventId: Schema.String,
      }),
      Result: EventHistoryIdRow,
      execute: (input) => sql`
        SELECT id
        FROM event_history
        WHERE event_id = ${input.eventId}
      `,
    });

    const getLatestEventQuery = SqlSchema.findAll({
      Request: Schema.Struct({}),
      Result: EventInstance,
      execute: () => sql`
        SELECT
          event_id,
          event_type,
          event_details
        FROM event_history
        ORDER BY id DESC
        LIMIT 1
      `,
    });

    const getEventQuery = SqlSchema.findAll({
      Request: Schema.Struct({
        eventId: Schema.String,
      }),
      Result: EventInstance,
      execute: (input) => sql`
        SELECT
          event_id,
          event_type,
          event_details
        FROM event_history
        WHERE event_id = ${input.eventId}
      `,
    });

    const appendEvent = (event: EventInstance) =>
      sql<{ eventId: string }>`
        INSERT INTO event_history ${sql.insert({
          eventId: event.eventId,
          eventType: event.eventType,
          eventDetails: event.eventDetails,
        })}
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      `;

    /**
     * @since 0.0.0
     * @category service-method
     */
    const append: IEventLog["append"] = Effect.fn("EventLog.append")(function* (event) {
      const insertedRows = yield* appendEvent(event).pipe(Effect.orDie);

      return { inserted: insertedRows.length > 0 };
    });

    /**
     * @since 0.0.0
     * @category service-method
     */
    const scan: IEventLog["scan"] = Effect.fn("EventLog.scan")(function* (options = {}) {
      const limit = options.limit ?? DefaultScanPageSize;
      const rows = yield* scanEvents({
        limit: limit + 1,
        cursor: options.cursor,
      }).pipe(Effect.orDie);
      const events = Array.take(rows, limit);
      const nextCursor =
        rows.length > limit
          ? Array.last(events).pipe(Option.map((event) => event.eventId))
          : Option.none<string>();

      return { events, nextCursor };
    });

    /**
     * @since 0.0.0
     * @category service-method
     */
    const resolveEventHistoryId: IEventLog["resolveEventHistoryId"] = Effect.fn(
      "EventLog.resolveEventHistoryId",
    )(function* (eventId) {
      const rows = yield* resolveEventHistoryIdQuery({ eventId }).pipe(Effect.orDie);

      return Array.head(rows).pipe(Option.map((row) => String(row.id)));
    });

    /**
     * @since 0.0.0
     * @category service-method
     */
    const getLatestEvent: IEventLog["getLatestEvent"] = Effect.fn("EventLog.getLatestEvent")(
      function* () {
        const rows = yield* getLatestEventQuery({}).pipe(Effect.orDie);

        return Array.head(rows);
      },
    );

    /**
     * @since 0.0.0
     * @category service-method
     */
    const getEvent: IEventLog["getEvent"] = Effect.fn("EventLog.getEvent")(function* (eventId) {
      const rows = yield* getEventQuery({ eventId }).pipe(Effect.orDie);

      return Array.head(rows);
    });

    return EventLog.of({
      append,
      scan,
      resolveEventHistoryId,
      getLatestEvent,
      getEvent,
    });
  }),
);
