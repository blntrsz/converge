import { Effect, Layer, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { EventInstance } from "../../event/event-instance.ts";
import { EventRouterService } from "../../event/event-router.ts";
import { EventLog } from "../../event/services/event-log.ts";
import { PrimarySyncEngine, type IPrimarySyncEngine } from "../services/primary-sync-engine.ts";

const PullPageSize = 100;

class EventRejected {
  readonly _tag = "EventRejected";
}

/**
 * @since 0.0.0
 * @category layer
 */
export const layer: Layer.Layer<
  PrimarySyncEngine,
  never,
  EventLog | EventRouterService | SqlClient.SqlClient
> = Layer.effect(
  PrimarySyncEngine,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventLog = yield* EventLog;
    const eventRouter = yield* EventRouterService;

    /**
     * @since 0.0.0
     * @category service-method
     */
    const pull: IPrimarySyncEngine["pull"] = Effect.fn("PrimarySyncEngine.pull")(
      function* (cursor) {
        const page = yield* eventLog.scan({
          limit: PullPageSize,
          cursor,
        });

        if (Option.isSome(page.nextCursor)) {
          return {
            data: Array.from(page.events),
            hasNext: true,
            cursor: page.nextCursor.value,
          };
        }

        return {
          data: Array.from(page.events),
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
                  const appendResult = yield* eventLog.append(acceptedEvent);
                  if (!appendResult.inserted) {
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
    )(() => eventLog.getLatestEvent());

    /**
     * @since 0.0.0
     * @category service-method
     */
    const getEvent: IPrimarySyncEngine["getEvent"] = Effect.fn("PrimarySyncEngine.getEvent")(
      (eventId) => eventLog.getEvent(eventId),
    );

    return PrimarySyncEngine.of({
      pull,
      push,
      getLatestEvent,
      getEvent,
    });
  }),
);
