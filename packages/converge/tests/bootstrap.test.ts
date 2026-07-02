import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import { TestClock } from "effect/testing";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { IndexedDb } from "@effect/platform-browser";
import {
  Event,
  EventHandler,
  EventInstance,
  EventRouter,
  HttpProjectionBootstrap,
  IndexedDbProjection,
  IndexedDbReplicaSyncEngine,
  OptimisticEventApplier,
  PostgresPrimarySyncEngine,
  PrimaryProjectionBootstrap,
  PrimarySyncEngine,
  Projection,
  ReplicaApplyContext,
  ReplicaProjectionBootstrap,
  ReplicaSyncEngine,
} from "../src/index.ts";
import { PgliteSqlClient } from "../src/pglite-client.ts";
import { Context } from "effect";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
});

const TodoSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.Number,
});

const TodoListSchema = Schema.Array(TodoSchema);
type Todo = Schema.Schema.Type<typeof TodoSchema>;

class TodoProjection extends Context.Service<
  TodoProjection,
  Projection.IReactiveProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("BootstrapTodoProjection") {}

const todosProjectionKey = "todos";

const materializeTodosAt = (syncAnchor: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const sequence = yield* PostgresPrimarySyncEngine.versionSequenceAt(syncAnchor);
    if (Option.isNone(sequence)) {
      return [] as ReadonlyArray<Todo>;
    }

    const rows = yield* sql<{
      id: string;
      title: string;
      completed: boolean;
      created_at: number;
      deleted: boolean;
    }>`
      SELECT DISTINCT ON (entity_id)
        entity_id as id,
        title,
        completed,
        created_at,
        deleted
      FROM todos_versions
      WHERE since <= ${sequence.value}
      ORDER BY entity_id, since DESC
    `;

    return rows
      .filter((row) => !row.deleted)
      .map((row) => ({
        id: row.id,
        title: row.title,
        completed: row.completed,
        createdAt: row.created_at,
      }));
  });

const primaryTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ id: number }>`
      SELECT id FROM event_history WHERE event_id = ${event.eventId} LIMIT 1
    `;
    const since = rows[0]?.id;
    if (!since) {
      return;
    }

    yield* sql`
      INSERT INTO todos_versions ${sql.insert({
        entityId: event.eventDetails.id,
        since,
        title: event.eventDetails.title,
        completed: false,
        createdAt: event.eventDetails.createdAt,
        deleted: false,
      })}
    `;
  }),
);

const replicaTodoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const projection = yield* TodoProjection;
    const todos = yield* projection.query((snapshot) => snapshot);

    if (todos.some((todo) => todo.id === event.eventDetails.id)) {
      return;
    }

    yield* projection.mutation(() => [
      [
        ...todos,
        {
          id: event.eventDetails.id,
          title: event.eventDetails.title,
          completed: false,
          createdAt: event.eventDetails.createdAt,
        },
      ],
      undefined,
    ] as const);
  }),
);

const primaryMigrations = Migrator.fromRecord({
  "2_create_todos_versions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS todos_versions (
        entity_id text NOT NULL,
        since bigint NOT NULL,
        title text NOT NULL,
        completed boolean NOT NULL DEFAULT false,
        created_at double precision NOT NULL,
        deleted boolean NOT NULL DEFAULT false,
        PRIMARY KEY (entity_id, since)
      )
    `;
  }),
});

const FakeIndexedDbLayer = Layer.succeed(
  IndexedDb.IndexedDb,
  IndexedDb.make({ indexedDB, IDBKeyRange }),
);

const PgSqlClientWithMigrations = PostgresPrimarySyncEngine.migrationsLayer.pipe(
  Layer.provideMerge(PgliteSqlClient),
);

const PgSqlClientWithAllMigrations = Layer.effectDiscard(
  Migrator.make({})({ loader: primaryMigrations }),
).pipe(Layer.provideMerge(PgSqlClientWithMigrations));

const PrimaryBootstrapLayer = PrimaryProjectionBootstrap.primaryLayer([
  { key: todosProjectionKey, materializeAt: materializeTodosAt },
]);

const PrimaryLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(EventRouter.layer({ handlers: [primaryTodoCreatedHandler] })),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
  Layer.provideMerge(PrimaryBootstrapLayer),
  Layer.provideMerge(
    HttpProjectionBootstrap.serverLayer.pipe(Layer.provide(PrimaryBootstrapLayer)),
  ),
);

const TodoProjectionLayer = IndexedDbProjection.indexedDbLayer(TodoProjection, {
  databaseName: "bootstrap-test-projection",
  key: "todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
}).pipe(Layer.provide(FakeIndexedDbLayer));

const ReplicaBootstrapLayer = ReplicaProjectionBootstrap.replicaLayer([
  {
    key: todosProjectionKey,
    importSnapshot: (snapshot) =>
      Effect.gen(function* () {
        const projection = yield* TodoProjection;
        const todos = yield* Schema.decodeUnknown(TodoListSchema)(snapshot);
        yield* projection.mutation(() => [todos, undefined] as const);
      }),
  },
]);

const ReplicaLayer = IndexedDbReplicaSyncEngine.layer.pipe(
  Layer.provide(EventRouter.layer({ handlers: [replicaTodoCreatedHandler] })),
  Layer.provide(
    IndexedDbReplicaSyncEngine.databaseLayer("bootstrap-test-replica").pipe(
      Layer.provide(FakeIndexedDbLayer),
    ),
  ),
  Layer.provideMerge(ReplicaApplyContext.layer),
  Layer.provideMerge(TodoProjectionLayer),
  Layer.provideMerge(ReplicaBootstrapLayer),
  Layer.provideMerge(PrimaryLayer),
  Layer.provideMerge(OptimisticEventApplier.noopLayer),
);

layer(ReplicaLayer)((it) => {
  it.effect(
    "bootstraps flat replica storage on first poke and seeds the anchor event",
    () =>
      TestClock.withLive(
        Effect.gen(function* () {
          const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
          const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
          const projection = yield* TodoProjection;

          const event = yield* EventInstance.make(todoCreated, {
            id: "todo-1",
            title: "Bootstrapped",
            createdAt: 10,
          });

          yield* primary.push(event);

          const before = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(before, []);

          yield* replica.poke();
          yield* Effect.sleep("300 millis");

          const after = yield* projection.query((todos) => todos);
          assert.deepStrictEqual(after, [
            {
              id: "todo-1",
              title: "Bootstrapped",
              completed: false,
              createdAt: 10,
            },
          ]);
        }),
      ),
    30000,
  );
});
