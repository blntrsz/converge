import { Array, Effect, Layer, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import { EventInstance } from "../../event/event-instance.ts";
import { EventRouterService } from "../../event/event-router.ts";
import { PrimarySyncEngine, type IPrimarySyncEngine } from "../services/primary-sync-engine.ts";

const PullPageSize = 100;

class EventRejected {
  readonly _tag = "EventRejected";
}

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
export const layer: Layer.Layer<
  PrimarySyncEngine,
  never,
  SqlClient.SqlClient | EventRouterService
> = Layer.effect(
  PrimarySyncEngine,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventRouter = yield* EventRouterService;

    const pullEvents = SqlSchema.findAll({
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

    const insertEvent = (event: EventInstance) =>
      sql<{ event_id: string }>`
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
    const pull: IPrimarySyncEngine["pull"] = Effect.fn("PrimarySyncEngine.pull")(
      function* (cursor) {
        const rows = yield* pullEvents({
          limit: PullPageSize + 1,
          cursor,
        }).pipe(Effect.orDie);
        const data = Array.take(rows, PullPageSize);
        const cursorOption = Array.last(data).pipe(Option.map((event) => event.eventId));

        if (rows.length > PullPageSize && Option.isSome(cursorOption)) {
          return {
            data,
            hasNext: true,
            cursor: cursorOption.value,
          };
        }

        return {
          data,
          hasNext: false,
        };
      },
    );

    /**
     * @since 0.0.0
     * @category service-method
     */
    const push: IPrimarySyncEngine["push"] = Effect.fn("PrimarySyncEngine.push")(
      function* (...events) {
        return yield* Effect.forEach(
          events,
          (event) => {
            const handler = eventRouter.find(event.eventType);

            if (!handler) {
              return Effect.succeed(Result.fail(event));
            }

            const eventDetailsSchema = Schema.Struct(
              handler.event.eventDetails as Schema.Struct.Fields,
            );
            const decodeEventDetails = Schema.decodeUnknownEffect(eventDetailsSchema)(
              event.eventDetails,
            ) as Effect.Effect<unknown, unknown>;

            return Effect.matchEffect(decodeEventDetails, {
              onFailure: () => Effect.succeed(Result.fail(event)),
              onSuccess: (eventDetails) => {
                const acceptedEvent = new EventInstance({
                  eventId: event.eventId,
                  eventType: event.eventType,
                  eventDetails,
                });

                const acceptEvent = Effect.gen(function* () {
                  const insertedRows = yield* insertEvent(acceptedEvent);
                  if (insertedRows.length === 0) {
                    return acceptedEvent;
                  }

                  yield* handler
                    .run(acceptedEvent)
                    .pipe(Effect.mapError(() => new EventRejected()));

                  return acceptedEvent;
                });

                return sql.withTransaction(acceptEvent).pipe(
                  Effect.map(
                    (acceptedEvent): Result.Result<EventInstance, EventInstance> =>
                      Result.succeed(acceptedEvent),
                  ),
                  Effect.catchTag(
                    "EventRejected",
                    (): Effect.Effect<Result.Result<EventInstance, EventInstance>> =>
                      Effect.succeed(Result.fail(event)),
                  ),
                  Effect.orDie,
                );
              },
            });
          },
          { concurrency: 1 },
        );
      },
    );

    /**
     * @since 0.0.0
     * @category service-method
     */
    const getLatestEvent: IPrimarySyncEngine["getLatestEvent"] = Effect.fn(
      "PrimarySyncEngine.getLatestEvent",
    )(function* () {
      const rows = yield* getLatestEventQuery({}).pipe(Effect.orDie);

      return Array.head(rows);
    });

    /**
     * @since 0.0.0
     * @category service-method
     */
    const getEvent: IPrimarySyncEngine["getEvent"] = Effect.fn("PrimarySyncEngine.getEvent")(
      function* (eventId) {
        const rows = yield* getEventQuery({ eventId }).pipe(Effect.orDie);

        return Array.head(rows);
      },
    );

    return PrimarySyncEngine.of({
      pull,
      push,
      getLatestEvent,
      getEvent,
    });
  }),
);
