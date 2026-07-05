import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Option, Result, Schema, Stream } from "effect";
import { SqlClient } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import {
  Event,
  EventId,
  EventHandler,
  EventInstance,
  EventRouter,
  HttpPrimarySyncEngine,
  PostgresPrimarySyncEngine,
  PrimaryProjection,
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

const todoDeleted = Event.make("todo.deleted.v1", {
  id: Schema.String,
  name: Schema.String,
});

const todoRetryCounted = Event.make("todo.retry-counted.v1", {
  id: Schema.String,
});

const TodoProjectionRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const EncodedProjectionRow = Schema.Struct({
  id: Schema.String,
  count: Schema.NumberFromString,
});

let todoRetryCountedHandlerRuns = 0;

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      INSERT INTO todo ${sql.insert({
        id: event.eventDetails.id,
        name: event.eventDetails.name,
      })}
    `;
  }),
);

const todoUpdatedHandler = EventHandler.make(
  todoUpdated,
  Effect.fn(function* () {
    yield* Effect.void;
  }),
);

const todoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* () {
    yield* Effect.void;
  }),
);

const todoRetryCountedHandler = EventHandler.make(
  todoRetryCounted,
  Effect.fn(function* () {
    yield* Effect.sync(() => {
      todoRetryCountedHandlerRuns += 1;
    });
  }),
);

const migrations = Migrator.fromRecord({
  "2_create_todo": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE IF NOT EXISTS todo (
        id text PRIMARY KEY,
        name text NOT NULL
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
  handlers: [todoCreatedHandler, todoUpdatedHandler, todoDeletedHandler, todoRetryCountedHandler],
});

const PrimarySyncEngineLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(EventRouterLayer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

const PrimarySyncEngineOnlyLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provide(EventRouterLayer),
  Layer.provide(PgSqlClientWithAllMigrations),
);

const PrimarySyncEngineWithEmptyProjectionLayer = Layer.mergeAll(
  PrimarySyncEngineOnlyLayer,
  PrimaryProjection.emptyLayer,
);

const TodoPrimaryProjectionLayer = PrimaryProjection.layer({
  projections: [
    {
      key: "todos",
      rowSchema: TodoProjectionRow,
      bootstrap: () =>
        Stream.make({ id: "todo-1", name: "Buy coffee" }, { id: "todo-2", name: "Read docs" }),
    },
    {
      key: "encoded",
      rowSchema: EncodedProjectionRow,
      bootstrap: () => Stream.make({ id: "encoded-1", count: 3 }),
    },
  ],
});

const PrimarySyncEngineWithProjectionLayer = Layer.mergeAll(
  PrimarySyncEngineOnlyLayer,
  TodoPrimaryProjectionLayer,
);

layer(PrimarySyncEngineLayer)((it) => {
  it.effect("getLatestEvent returns none on empty log", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;

      const latest = yield* engine.getLatestEvent();

      assert.isTrue(Option.isNone(latest));
    }),
  );

  it.effect("pushes a todo Event through the primary sync engine", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      const sql = yield* SqlClient.SqlClient;

      const eventInstance = yield* EventInstance.make(todoCreated, {
        id: "1",
        name: "Buy milk",
      });

      const results = yield* engine.push(eventInstance);

      assert.strictEqual(results.length, 1);
      const result = results[0]!;
      if (!Result.isSuccess(result)) {
        assert.fail("expected todo Event to be accepted");
      }
      assert.strictEqual(result.success.eventId, eventInstance.eventId);

      const todos = yield* sql<{ id: string; name: string }>`
        SELECT id, name FROM todo
        ORDER BY id ASC
      `;

      assert.deepStrictEqual(todos, [{ id: "1", name: "Buy milk" }]);

      const eventHistory = yield* engine.pull();
      assert.strictEqual(eventHistory.hasNext, false);
      assert.strictEqual(eventHistory.data.length, 1);
      assert.strictEqual(eventHistory.data[0]?.eventId, eventInstance.eventId);
      assert.strictEqual(eventHistory.data[0]?.eventType, "todo.created.v1");
      assert.deepStrictEqual(eventHistory.data[0]?.eventDetails, {
        id: "1",
        name: "Buy milk",
      });
    }),
  );

  it.effect("treats retrying an accepted Event as idempotent", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      todoRetryCountedHandlerRuns = 0;

      const eventInstance = yield* EventInstance.make(todoRetryCounted, {
        id: "retry-1",
      });

      const firstResults = yield* engine.push(eventInstance);

      assert.strictEqual(firstResults.length, 1);
      const firstResult = firstResults[0]!;
      if (!Result.isSuccess(firstResult)) {
        assert.fail("expected first Push to accept the Event");
      }
      assert.strictEqual(firstResult.success.eventId, eventInstance.eventId);
      assert.strictEqual(todoRetryCountedHandlerRuns, 1);

      const retryResults = yield* engine.push(eventInstance);

      assert.strictEqual(retryResults.length, 1);
      const retryResult = retryResults[0]!;
      if (!Result.isSuccess(retryResult)) {
        assert.fail("expected retrying an accepted Event to succeed");
      }
      assert.strictEqual(retryResult.success.eventId, eventInstance.eventId);
      assert.strictEqual(todoRetryCountedHandlerRuns, 1);
    }),
  );

  it.effect("pushes multiple Events passed as arguments", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      todoRetryCountedHandlerRuns = 0;

      const firstEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "multi-1",
      });
      const secondEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "multi-2",
      });
      const thirdEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "multi-3",
      });

      const results = yield* engine.push(firstEvent, secondEvent, thirdEvent);

      assert.strictEqual(results.length, 3);
      assert.strictEqual(todoRetryCountedHandlerRuns, 3);
      for (const [index, result] of results.entries()) {
        if (!Result.isSuccess(result)) {
          assert.fail("expected pushed Event to be accepted");
        }
        assert.strictEqual(
          result.success.eventId,
          [firstEvent, secondEvent, thirdEvent][index]?.eventId,
        );
      }
    }),
  );

  it.effect("getLatestEvent returns the last accepted event", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      todoRetryCountedHandlerRuns = 0;

      const firstEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "latest-1",
      });
      const secondEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "latest-2",
      });

      yield* engine.push(firstEvent, secondEvent);

      const latest = yield* engine.getLatestEvent();
      if (Option.isNone(latest)) {
        assert.fail("expected getLatestEvent to return the last pushed event");
      }
      assert.strictEqual(latest.value.eventId, secondEvent.eventId);
    }),
  );

  it.effect("getEvent returns the pushed event by id and none for an unknown id", () =>
    Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      todoRetryCountedHandlerRuns = 0;

      const event = yield* EventInstance.make(todoRetryCounted, {
        id: "get-1",
      });

      yield* engine.push(event);

      const found = yield* engine.getEvent(event.eventId);
      if (Option.isNone(found)) {
        assert.fail("expected getEvent to return the pushed event");
      }
      assert.strictEqual(found.value.eventId, event.eventId);

      const missing = yield* engine.getEvent("unknown-event-id");
      assert.isTrue(Option.isNone(missing));
    }),
  );

  it.effect("serves primary sync over HTTP", () => {
    const server = HttpPrimarySyncEngine.makeWebHandler(PrimarySyncEngineWithEmptyProjectionLayer, {
      prefix: "/sync",
      disableLogger: true,
    });
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      server.handler(
        new Request(input instanceof Request ? input.url : String(input), init),
      )) as typeof globalThis.fetch;

    return Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      const acceptedEvent = yield* EventInstance.make(todoCreated, {
        id: "http-1",
        name: "Buy coffee",
      });
      const rejectedEvent = new EventInstance.EventInstance({
        eventId: "http-rejected",
        eventType: "todo.unknown.v1",
        eventDetails: {},
      });

      const results = yield* engine.push(acceptedEvent, rejectedEvent);
      assert.strictEqual(results.length, 2);

      const acceptedResult = results[0]!;
      if (!Result.isSuccess(acceptedResult)) {
        assert.fail("expected HTTP push to accept the known Event");
      }
      assert.strictEqual(acceptedResult.success.eventId, acceptedEvent.eventId);

      const rejectedResult = results[1]!;
      if (Result.isSuccess(rejectedResult)) {
        assert.fail("expected HTTP push to reject the unknown Event");
      }
      assert.strictEqual(rejectedResult.failure.eventId, rejectedEvent.eventId);

      const page = yield* engine.pull();
      assert.strictEqual(page.hasNext, false);
      assert.strictEqual(page.data.length, 1);
      assert.strictEqual(page.data[0]?.eventId, acceptedEvent.eventId);
      assert.deepStrictEqual(page.data[0]?.eventDetails, {
        id: "http-1",
        name: "Buy coffee",
      });
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

  it.effect("serves getLatestEvent and getEvent over HTTP", () => {
    const server = HttpPrimarySyncEngine.makeWebHandler(PrimarySyncEngineWithEmptyProjectionLayer, {
      prefix: "/sync",
      disableLogger: true,
    });
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      server.handler(
        new Request(input instanceof Request ? input.url : String(input), init),
      )) as typeof globalThis.fetch;

    return Effect.gen(function* () {
      const engine = yield* PrimarySyncEngine.PrimarySyncEngine;
      todoRetryCountedHandlerRuns = 0;

      const latestOnEmpty = yield* engine.getLatestEvent();
      assert.isTrue(Option.isNone(latestOnEmpty));

      const firstEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "http-latest-1",
      });
      const secondEvent = yield* EventInstance.make(todoRetryCounted, {
        id: "http-latest-2",
      });

      yield* engine.push(firstEvent, secondEvent);

      const latest = yield* engine.getLatestEvent();
      if (Option.isNone(latest)) {
        assert.fail("expected HTTP getLatestEvent to return the last pushed event");
      }
      assert.strictEqual(latest.value.eventId, secondEvent.eventId);

      const found = yield* engine.getEvent(secondEvent.eventId);
      if (Option.isNone(found)) {
        assert.fail("expected HTTP getEvent to return the pushed event");
      }
      assert.strictEqual(found.value.eventId, secondEvent.eventId);

      const missing = yield* engine.getEvent("http-unknown-event-id");
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

  it.effect("serves primary projection rows over HTTP", () => {
    const server = HttpPrimarySyncEngine.makeWebHandler(PrimarySyncEngineWithProjectionLayer, {
      prefix: "/sync",
      disableLogger: true,
    });
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      server.handler(
        new Request(input instanceof Request ? input.url : String(input), init),
      )) as typeof globalThis.fetch;

    return Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fetch("http://test/sync/projection/todos?eventId=event-1"),
      );
      assert.strictEqual(response.status, 200);

      const body = yield* Effect.promise(() => response.text());
      assert.deepStrictEqual(
        body
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
        [
          { id: "todo-1", name: "Buy coffee" },
          { id: "todo-2", name: "Read docs" },
        ],
      );
    }).pipe(Effect.ensuring(Effect.promise(() => server.dispose())));
  });

  it.effect("rejects primary projection requests without an eventId", () => {
    const server = HttpPrimarySyncEngine.makeWebHandler(PrimarySyncEngineWithProjectionLayer, {
      prefix: "/sync",
      disableLogger: true,
    });
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      server.handler(
        new Request(input instanceof Request ? input.url : String(input), init),
      )) as typeof globalThis.fetch;

    return Effect.gen(function* () {
      const response = yield* Effect.promise(() => fetch("http://test/sync/projection/todos"));

      assert.strictEqual(response.status, 400);
    }).pipe(Effect.ensuring(Effect.promise(() => server.dispose())));
  });

  it.effect("returns not found for unknown primary projections", () => {
    const server = HttpPrimarySyncEngine.makeWebHandler(PrimarySyncEngineWithProjectionLayer, {
      prefix: "/sync",
      disableLogger: true,
    });
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      server.handler(
        new Request(input instanceof Request ? input.url : String(input), init),
      )) as typeof globalThis.fetch;

    return Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fetch("http://test/sync/projection/missing?eventId=event-1"),
      );

      assert.strictEqual(response.status, 404);
    }).pipe(Effect.ensuring(Effect.promise(() => server.dispose())));
  });

  it.effect("encodes primary projection rows with their schema", () => {
    const server = HttpPrimarySyncEngine.makeWebHandler(PrimarySyncEngineWithProjectionLayer, {
      prefix: "/sync",
      disableLogger: true,
    });
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      server.handler(
        new Request(input instanceof Request ? input.url : String(input), init),
      )) as typeof globalThis.fetch;

    return Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fetch("http://test/sync/projection/encoded?eventId=event-1"),
      );

      assert.strictEqual(response.status, 200);

      const body = yield* Effect.promise(() => response.text());
      assert.deepStrictEqual(JSON.parse(body.trim()), {
        id: "encoded-1",
        count: "3",
      });
    }).pipe(Effect.ensuring(Effect.promise(() => server.dispose())));
  });

  it.effect("consumes primary projection rows over HTTP", () => {
    const server = HttpPrimarySyncEngine.makeWebHandler(PrimarySyncEngineWithProjectionLayer, {
      prefix: "/sync",
      disableLogger: true,
    });
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      server.handler(
        new Request(input instanceof Request ? input.url : String(input), init),
      )) as typeof globalThis.fetch;

    return Effect.gen(function* () {
      const router = yield* PrimaryProjection.PrimaryProjectionRouter;
      const projection = router.find("todos");
      if (!projection) {
        assert.fail("expected todos projection to be registered");
      }

      const rows = yield* projection
        .bootstrap({ eventId: Schema.decodeUnknownSync(EventId.EventId)("event-1") })
        .pipe(Stream.runCollect);

      assert.deepStrictEqual(Array.from(rows), [
        { id: "todo-1", name: "Buy coffee" },
        { id: "todo-2", name: "Read docs" },
      ]);
    }).pipe(
      Effect.provide(
        HttpPrimarySyncEngine.projectionLayer({
          baseUrl: "http://test/sync",
          fetch,
          projections: [
            {
              key: "todos",
              rowSchema: TodoProjectionRow,
            },
          ],
        }),
      ),
      Effect.ensuring(Effect.promise(() => server.dispose())),
    );
  });

  it.effect("decodes HTTP primary projection rows with their schema", () => {
    const server = HttpPrimarySyncEngine.makeWebHandler(PrimarySyncEngineWithProjectionLayer, {
      prefix: "/sync",
      disableLogger: true,
    });
    const fetch = ((input: string | URL | Request, init?: RequestInit) =>
      server.handler(
        new Request(input instanceof Request ? input.url : String(input), init),
      )) as typeof globalThis.fetch;

    return Effect.gen(function* () {
      const router = yield* PrimaryProjection.PrimaryProjectionRouter;
      const projection = router.find("encoded");
      if (!projection) {
        assert.fail("expected encoded projection to be registered");
      }

      const rows = yield* projection
        .bootstrap({ eventId: Schema.decodeUnknownSync(EventId.EventId)("event-1") })
        .pipe(Stream.runCollect);

      assert.deepStrictEqual(Array.from(rows), [{ id: "encoded-1", count: 3 }]);
    }).pipe(
      Effect.provide(
        HttpPrimarySyncEngine.projectionLayer({
          baseUrl: "http://test/sync",
          fetch,
          projections: [
            {
              key: "encoded",
              rowSchema: EncodedProjectionRow,
            },
          ],
        }),
      ),
      Effect.ensuring(Effect.promise(() => server.dispose())),
    );
  });
});
