import { Array, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/unstable/sql";
import { EventStoreSaveFailed } from "../services/errors.ts";
import { EventStore, type IEventStore } from "../services/event-store.ts";
import { EventInstance } from "../event-instance.ts";

/**
 * @since 0.0.0
 * @category layer
 */
export const layer: Layer.Layer<EventStore, never, SqlClient.SqlClient> = Layer.effect(
  EventStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventRepository = yield* SqlModel.makeRepository(EventInstance, {
      tableName: "event_history",
      idColumn: "eventId",
      spanPrefix: "EventStore",
    });

    /**
     * @since 0.0.0
     * @category service-method
     */
    const save: IEventStore["save"] = Effect.fn("EventStore.save")(function* (event) {
      const eventId = event.eventId;

      yield* eventRepository
        .insertVoid(EventInstance.insert.make(event))
        .pipe(Effect.mapError((cause) => new EventStoreSaveFailed({ eventId, cause })));
    });

    /**
     * @since 0.0.0
     * @category service-method
     */
    const scan: IEventStore["scan"] = Effect.fn("EventStore.scan")(function* ({
      cursor,
      limit = 100,
    }) {
      const queryLimit = limit + 1;

      const query = SqlSchema.findAll({
        Request: Schema.Struct({
          limit: Schema.Number,
          cursor: Schema.String.pipe(Schema.optional),
        }),
        Result: EventInstance,
        execute: (input) =>
          input.cursor
            ? sql`
              SELECT event_id, event_type, event_details, created_at
              FROM event_history
              WHERE id > COALESCE(
                (SELECT id FROM event_history WHERE event_id = ${input.cursor}),
                0
              )
              ORDER BY id ASC
              LIMIT ${input.limit}
            `
            : sql`
              SELECT event_id, event_type, event_details, created_at
              FROM event_history
              ORDER BY id ASC
              LIMIT ${input.limit}
            `,
      });

      const rows = yield* query({
        limit: queryLimit,
        cursor,
      }).pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)));

      const events = Array.take(rows, limit);
      const nextCursor =
        rows.length > limit
          ? Array.last(events).pipe(
              Option.match({
                onNone: () => Option.none<string>(),
                onSome: (event) => Option.some(event.eventId),
              }),
            )
          : Option.none<string>();

      return { events, nextCursor };
    });

    /**
     * @since 0.0.0
     * @category service-method
     */
    const get: IEventStore["get"] = Effect.fn("EventStore.get")(function* (eventId) {
      return yield* eventRepository
        .findById(eventId)
        .pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)));
    });

    return EventStore.of({
      save,
      scan,
      get,
    });
  }),
);
