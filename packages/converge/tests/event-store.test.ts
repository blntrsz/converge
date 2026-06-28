import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import {
  Event,
  EventInstance,
  EventStore,
  PostgresEventStore,
  PostgresPrimarySyncEngine,
} from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  name: Schema.String,
});

const PgSqlClientWithMigrations = PostgresPrimarySyncEngine.migrationsLayer.pipe(
  Layer.provideMerge(PgliteSqlClient),
);

const EventStoreLayer = PostgresEventStore.layer.pipe(
  Layer.provideMerge(PgSqlClientWithMigrations),
);

layer(EventStoreLayer)((it) => {
  it.effect("scans Event History pages without skipping the lookahead Event", () =>
    Effect.gen(function* () {
      const eventStore = yield* EventStore.EventStore;
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

      yield* eventStore.save(firstEvent);
      yield* eventStore.save(secondEvent);
      yield* eventStore.save(thirdEvent);

      const firstPage = yield* eventStore.scan({ cursor: undefined, limit: 2 });

      assert.deepStrictEqual(
        firstPage.events.map((event) => event.eventId),
        [firstEvent.eventId, secondEvent.eventId],
      );
      if (Option.isNone(firstPage.nextCursor)) {
        assert.fail("expected a cursor for the next Event History page");
      }
      assert.strictEqual(firstPage.nextCursor.value, secondEvent.eventId);

      const secondPage = yield* eventStore.scan({
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
