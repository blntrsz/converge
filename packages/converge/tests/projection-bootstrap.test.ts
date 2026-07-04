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
  PostgresPrimarySyncEngine,
  PrimaryProjectionBootstrap,
  PrimarySyncEngine,
} from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";

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

const todosEncoder = {
  projectionKey: "todos",
  encode: Effect.fn(function* (anchor) {
    const sql = yield* SqlClient.SqlClient;

    return yield* sql<{ id: string; name: string }>`
      SELECT DISTINCT ON (id) id, name
      FROM todo_versions
      WHERE since <= ${anchor.sequence}
      ORDER BY id, since DESC
    `.pipe(Effect.orDie);
  }),
} satisfies PrimaryProjectionBootstrap.PrimaryProjectionBootstrapEncoder<SqlClient.SqlClient>;

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

const PrimaryProjectionBootstrapLayer = PrimaryProjectionBootstrap.layer({
  encoders: [todosEncoder],
});

const PrimarySyncEngineLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(EventRouterLayer),
  Layer.provideMerge(PrimaryProjectionBootstrapLayer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

const PrimarySyncEngineOnlyLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(EventRouterLayer),
  Layer.provideMerge(PrimaryProjectionBootstrapLayer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

layer(PrimarySyncEngineLayer)((it) => {
  it.effect("bootstraps versioned todos at anchored events", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const event1 = yield* EventInstance.make(todoCreated, {
        id: "1",
        name: "A",
      });
      const event2 = yield* EventInstance.make(todoUpdated, {
        id: "1",
        name: "B",
      });
      const event3 = yield* EventInstance.make(todoCreated, {
        id: "2",
        name: "C",
      });

      const results = yield* engine.push(event1, event2, event3);
      assert.strictEqual(results.length, 3);
      for (const result of results) {
        if (!Result.isSuccess(result)) {
          assert.fail("expected all events to be accepted");
        }
      }

      const bootstrap1 = yield* engine.bootstrap("todos", event1.eventId);
      if (Option.isNone(bootstrap1)) {
        assert.fail("expected bootstrap at event1 to return a snapshot");
      }
      assert.deepStrictEqual(bootstrap1.value.snapshot, [{ id: "1", name: "A" }]);
      assert.strictEqual(bootstrap1.value.anchorEvent.eventId, event1.eventId);

      const bootstrap2 = yield* engine.bootstrap("todos", event2.eventId);
      if (Option.isNone(bootstrap2)) {
        assert.fail("expected bootstrap at event2 to return a snapshot");
      }
      assert.deepStrictEqual(bootstrap2.value.snapshot, [{ id: "1", name: "B" }]);

      const bootstrap3 = yield* engine.bootstrap("todos", event3.eventId);
      if (Option.isNone(bootstrap3)) {
        assert.fail("expected bootstrap at event3 to return a snapshot");
      }
      assert.deepStrictEqual(bootstrap3.value.snapshot, [
        { id: "1", name: "B" },
        { id: "2", name: "C" },
      ]);
    }),
  );

  it.effect("returns none for unknown eventId", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const bootstrap = yield* engine.bootstrap("todos", "unknown-event-id");

      assert.isTrue(Option.isNone(bootstrap));
    }),
  );

  it.effect("returns none for unregistered projectionKey", () =>
    Effect.gen(function* () {
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
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const event1 = yield* EventInstance.make(todoCreated, {
        id: "1",
        name: "A",
      });
      const event2 = yield* EventInstance.make(todoUpdated, {
        id: "1",
        name: "B",
      });
      const event3 = yield* EventInstance.make(todoCreated, {
        id: "2",
        name: "C",
      });

      yield* engine.push(event1, event2, event3);

      const bootstrap = yield* engine.bootstrap("todos", event1.eventId);
      if (Option.isNone(bootstrap)) {
        assert.fail("expected HTTP bootstrap at event1 to return a snapshot");
      }
      assert.deepStrictEqual(bootstrap.value.snapshot, [{ id: "1", name: "A" }]);
      assert.strictEqual(bootstrap.value.anchorEvent.eventId, event1.eventId);

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
