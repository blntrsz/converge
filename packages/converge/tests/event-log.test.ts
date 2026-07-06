import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import { Event, EventInstance, EventLog, PostgresEventLog } from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  name: Schema.String,
});

const PgSqlClientWithMigrations = PostgresEventLog.migrationsLayer.pipe(
  Layer.provideMerge(PgliteSqlClient),
);

const EventLogLayer = PostgresEventLog.layer.pipe(Layer.provideMerge(PgSqlClientWithMigrations));

layer(EventLogLayer)((it) => {
  it.effect("appends Events idempotently and resolves Event history ids", () =>
    Effect.gen(function* () {
      const eventLog = yield* EventLog.EventLog;
      const event = yield* EventInstance.make(todoCreated, {
        id: "append-1",
        name: "First",
      });

      const firstAppend = yield* eventLog.append(event);
      const retryAppend = yield* eventLog.append(event);
      const found = yield* eventLog.getEvent(event.eventId);
      const latest = yield* eventLog.getLatestEvent();
      const eventHistoryId = yield* eventLog.resolveEventHistoryId(event.eventId);

      assert.strictEqual(firstAppend.inserted, true);
      assert.strictEqual(retryAppend.inserted, false);

      if (Option.isNone(found)) {
        assert.fail("expected Event log to return the appended Event");
      }
      assert.strictEqual(found.value.eventId, event.eventId);

      if (Option.isNone(latest)) {
        assert.fail("expected Event log to return the latest Event");
      }
      assert.strictEqual(latest.value.eventId, event.eventId);

      if (Option.isNone(eventHistoryId)) {
        assert.fail("expected Event log to resolve an Event history id");
      }
    }),
  );

  it.effect("scans Event log pages without skipping the lookahead Event", () =>
    Effect.gen(function* () {
      const eventLog = yield* EventLog.EventLog;
      const latestBeforeScan = yield* eventLog.getLatestEvent();
      const cursor = Option.match(latestBeforeScan, {
        onNone: () => undefined,
        onSome: (event) => event.eventId,
      });
      const firstEvent = yield* EventInstance.make(todoCreated, {
        id: "scan-1",
        name: "First",
      });
      const secondEvent = yield* EventInstance.make(todoCreated, {
        id: "scan-2",
        name: "Second",
      });
      const thirdEvent = yield* EventInstance.make(todoCreated, {
        id: "scan-3",
        name: "Third",
      });

      yield* eventLog.append(firstEvent);
      yield* eventLog.append(secondEvent);
      yield* eventLog.append(thirdEvent);

      const firstPage = yield* eventLog.scan({ cursor, limit: 2 });

      assert.deepStrictEqual(
        firstPage.events.map((event) => event.eventId),
        [firstEvent.eventId, secondEvent.eventId],
      );
      if (Option.isNone(firstPage.nextCursor)) {
        assert.fail("expected a cursor for the next Event log page");
      }
      assert.strictEqual(firstPage.nextCursor.value, secondEvent.eventId);

      const secondPage = yield* eventLog.scan({
        cursor: firstPage.nextCursor.value,
        limit: 2,
      });

      assert.deepStrictEqual(
        secondPage.events.map((event) => event.eventId),
        [thirdEvent.eventId],
      );
      assert.strictEqual(Option.isNone(secondPage.nextCursor), true);
    }),
  );
});
