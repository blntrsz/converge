import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import {
  Event,
  EventHandler,
  EventInstance,
  EventRouter,
  HttpPrimarySyncEngine,
  PostgresPrimaryProjection,
  PostgresPrimarySyncEngine,
  PrimaryProjectionRegistry,
  PrimarySyncEngine,
} from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";

const TodoSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

type Todo = Schema.Schema.Type<typeof TodoSchema>;

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  name: Schema.String,
});

const todoUpdated = Event.make("todo.updated.v1", {
  id: Schema.String,
  name: Schema.String,
});

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;
    const sequence = yield* PostgresPrimarySyncEngine.versionSequenceAt(event.eventId);
    if (Option.isNone(sequence)) {
      return;
    }

    yield* sql`
      INSERT INTO todo_versions ${sql.insert({
        id: event.eventDetails.id,
        name: event.eventDetails.name,
        since: sequence.value,
      })}
    `;
  }),
);

const todoUpdatedHandler = EventHandler.make(
  todoUpdated,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;
    const sequence = yield* PostgresPrimarySyncEngine.versionSequenceAt(event.eventId);
    if (Option.isNone(sequence)) {
      return;
    }

    yield* sql`
      INSERT INTO todo_versions ${sql.insert({
        id: event.eventDetails.id,
        name: event.eventDetails.name,
        since: sequence.value,
      })}
    `;
  }),
);

const todosPrimaryProjectionConfig = {
  key: "todos",
  table: "todo_versions",
  entityIdColumn: "id",
  entitySchema: TodoSchema,
  columns: ["name"],
} satisfies PostgresPrimaryProjection.PostgresPrimaryProjectionOptions<Todo>;

const migrations = Migrator.fromRecord({
  "2_create_todo_versions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE IF NOT EXISTS todo_versions (
        id text NOT NULL,
        name text NOT NULL,
        since bigint NOT NULL,
        PRIMARY KEY (id, since)
      )
    `;
  }),
});

const migrationsLayer = Layer.effectDiscard(Migrator.make({})({ loader: migrations }));

const PgSqlClientWithMigrations = PostgresPrimarySyncEngine.migrationsLayer.pipe(
  Layer.provideMerge(PgliteSqlClient),
);

const PgSqlClientWithAllMigrations = migrationsLayer.pipe(
  Layer.provideMerge(PgSqlClientWithMigrations),
);

const EventRouterLayer = EventRouter.layer({
  handlers: [todoCreatedHandler, todoUpdatedHandler],
});

const PrimaryProjectionRegistryLayer = PostgresPrimaryProjection.registryLayer([
  todosPrimaryProjectionConfig,
]).pipe(Layer.provideMerge(PgSqlClientWithAllMigrations));

const PrimarySyncEngineLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(EventRouterLayer),
  Layer.provideMerge(PrimaryProjectionRegistryLayer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

const PrimarySyncEngineOnlyLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(EventRouterLayer),
  Layer.provideMerge(PrimaryProjectionRegistryLayer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

const resetPrimaryData = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`TRUNCATE todo_versions`;
  yield* sql`TRUNCATE event_history RESTART IDENTITY`;
});

layer(PrimarySyncEngineLayer)((it) => {
  it.effect("lists versioned todos at a sync position eventId", () =>
    Effect.gen(function* () {
      yield* resetPrimaryData;
      const registry = yield* PrimaryProjectionRegistry.PrimaryProjectionRegistry;
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const event1 = yield* EventInstance.make(todoCreated, { id: "1", name: "A" });
      const event2 = yield* EventInstance.make(todoUpdated, { id: "1", name: "B" });
      const event3 = yield* EventInstance.make(todoCreated, { id: "2", name: "C" });

      yield* engine.push(event1, event2, event3);

      const projectionOption = registry.find("todos");
      if (Option.isNone(projectionOption)) {
        assert.fail("expected todos primary projection to be registered");
      }
      const projection = projectionOption.value;

      const page1 = yield* projection.list(event1.eventId);
      assert.deepStrictEqual(page1.data, [{ id: "1", name: "A" }]);
      assert.isFalse(page1.hasNext);

      const page2 = yield* projection.list(event2.eventId);
      assert.deepStrictEqual(page2.data, [{ id: "1", name: "B" }]);

      const page3 = yield* projection.list(event3.eventId);
      assert.deepStrictEqual(page3.data, [
        { id: "1", name: "B" },
        { id: "2", name: "C" },
      ]);
    }),
  );

  it.effect("paginates entities ordered by entity id", () =>
    Effect.gen(function* () {
      yield* resetPrimaryData;
      const registry = yield* PrimaryProjectionRegistry.PrimaryProjectionRegistry;
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const events = [];
      for (let index = 0; index < 5; index++) {
        events.push(
          yield* EventInstance.make(todoCreated, {
            id: `todo-${index}`,
            name: `Todo ${index}`,
          }),
        );
      }
      yield* engine.push(...events);

      const projectionOption = registry.find("todos");
      if (Option.isNone(projectionOption)) {
        assert.fail("expected todos primary projection to be registered");
      }
      const projection = projectionOption.value;

      const anchorEventId = events[events.length - 1]!.eventId;
      const firstPage = yield* projection.list(anchorEventId, { limit: 2 });
      assert.strictEqual(firstPage.data.length, 2);
      assert.isTrue(firstPage.hasNext);
      assert.strictEqual(firstPage.cursor, "todo-1");

      const secondPage = yield* projection.list(anchorEventId, {
        limit: 2,
        cursor: firstPage.cursor,
      });
      assert.strictEqual(secondPage.data.length, 2);
      assert.isTrue(secondPage.hasNext);

      const thirdPage = yield* projection.list(anchorEventId, {
        limit: 2,
        cursor: secondPage.cursor,
      });
      assert.strictEqual(thirdPage.data.length, 1);
      assert.isFalse(thirdPage.hasNext);
    }),
  );

  it.effect("bootstraps via eventId after resolving latest event", () =>
    Effect.gen(function* () {
      yield* resetPrimaryData;
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const event1 = yield* EventInstance.make(todoCreated, { id: "1", name: "A" });
      const event2 = yield* EventInstance.make(todoUpdated, { id: "1", name: "B" });
      const event3 = yield* EventInstance.make(todoCreated, { id: "2", name: "C" });

      yield* engine.push(event1, event2, event3);

      const latest = yield* engine.getLatestEvent();
      if (Option.isNone(latest)) {
        assert.fail("expected latest event after push");
      }

      const bootstrap = yield* engine.bootstrap("todos", latest.value.eventId);
      if (Option.isNone(bootstrap)) {
        assert.fail("expected bootstrap at latest eventId");
      }

      assert.strictEqual(bootstrap.value.eventId, latest.value.eventId);
      assert.strictEqual(bootstrap.value.anchorEvent.eventId, latest.value.eventId);
      assert.deepStrictEqual(bootstrap.value.snapshot, [
        { id: "1", name: "B" },
        { id: "2", name: "C" },
      ]);
    }),
  );

  it.effect("returns none for unknown eventId", () =>
    Effect.gen(function* () {
      yield* resetPrimaryData;
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const bootstrap = yield* engine.bootstrap("todos", "unknown-event-id");

      assert.isTrue(Option.isNone(bootstrap));
    }),
  );

  it.effect("returns none for unregistered projectionKey", () =>
    Effect.gen(function* () {
      yield* resetPrimaryData;
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const event = yield* EventInstance.make(todoCreated, {
        id: "1",
        name: "A",
      });

      yield* engine.push(event);

      const bootstrap = yield* engine.bootstrap("unknown-projection", event.eventId);

      assert.isTrue(Option.isNone(bootstrap));
    }),
  );

  it.effect("serves bootstrap over HTTP", () => {
    const server = HttpPrimarySyncEngine.makeWebHandler(PrimarySyncEngineOnlyLayer, {
      prefix: "/sync",
      disableLogger: true,
    });
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      server.handler(
        new Request(input instanceof Request ? input.url : String(input), init),
      )) as typeof globalThis.fetch;

    return Effect.gen(function* () {
      yield* resetPrimaryData;
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const event1 = yield* EventInstance.make(todoCreated, { id: "1", name: "A" });
      const event2 = yield* EventInstance.make(todoUpdated, { id: "1", name: "B" });
      const event3 = yield* EventInstance.make(todoCreated, { id: "2", name: "C" });

      yield* engine.push(event1, event2, event3);

      const latest = yield* engine.getLatestEvent();
      if (Option.isNone(latest)) {
        assert.fail("expected latest event after HTTP push");
      }

      const bootstrap = yield* engine.bootstrap("todos", latest.value.eventId);
      if (Option.isNone(bootstrap)) {
        assert.fail("expected HTTP bootstrap at latest eventId");
      }

      assert.strictEqual(bootstrap.value.eventId, latest.value.eventId);
      assert.deepStrictEqual(bootstrap.value.snapshot, [
        { id: "1", name: "B" },
        { id: "2", name: "C" },
      ]);

      const missing = yield* engine.bootstrap("todos", "http-unknown-event-id");
      assert.isTrue(Option.isNone(missing));
    }).pipe(
      Effect.provide(
        HttpPrimarySyncEngine.layer({
          baseUrl: "http://test/sync",
          fetch,
        }),
      ),
      Effect.ensuring(Effect.promise(() => server.dispose())),
    );
  });
});
