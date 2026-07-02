import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import * as Migrator from "effect/unstable/sql/Migrator";
import { EventHandler, EventRouter } from "converge/event";
import {
  HttpProjectionBootstrap,
  PrimaryProjectionBootstrap,
} from "converge/projection-bootstrap";
import {
  PostgresPrimarySyncEngine,
  PrimarySyncEngine,
} from "converge/primary-sync-engine";
import { PgliteSqlClient } from "../../../packages/converge/src/pglite-client.ts";
import { sortTodos } from "./todo-reducers.ts";
import {
  todoCompletionSet,
  todoCreated,
  todoDeleted,
  type Todo,
} from "./todo-events.ts";

const todosProjectionKey = "todos";

const versionSequenceForEvent = (eventId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ id: number }>`
      SELECT id
      FROM event_history
      WHERE event_id = ${eventId}
      LIMIT 1
    `;

    return Option.fromNullable(rows[0]?.id);
  });

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

    return sortTodos(
      rows
        .filter((row) => !row.deleted)
        .map((row) => ({
          id: row.id,
          title: row.title,
          completed: row.completed,
          createdAt: row.created_at,
        })),
    );
  });

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;
    const since = yield* versionSequenceForEvent(event.eventId);
    if (Option.isNone(since)) {
      return;
    }

    yield* sql`
      INSERT INTO todos_versions ${sql.insert({
        entityId: event.eventDetails.id,
        since: since.value,
        title: event.eventDetails.title,
        completed: false,
        createdAt: event.eventDetails.createdAt,
        deleted: false,
      })}
    `;
  }),
);

const todoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;
    const since = yield* versionSequenceForEvent(event.eventId);
    if (Option.isNone(since)) {
      return;
    }

    const rows = yield* sql<{
      title: string;
      created_at: number;
    }>`
      SELECT title, created_at
      FROM todos_versions
      WHERE entity_id = ${event.eventDetails.id}
      ORDER BY since DESC
      LIMIT 1
    `;
    const current = rows[0];
    if (!current) {
      return;
    }

    yield* sql`
      INSERT INTO todos_versions ${sql.insert({
        entityId: event.eventDetails.id,
        since: since.value,
        title: current.title,
        completed: event.eventDetails.completed,
        createdAt: current.created_at,
        deleted: false,
      })}
    `;
  }),
);

const todoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* (event) {
    const sql = yield* SqlClient.SqlClient;
    const since = yield* versionSequenceForEvent(event.eventId);
    if (Option.isNone(since)) {
      return;
    }

    const rows = yield* sql<{
      title: string;
      completed: boolean;
      created_at: number;
    }>`
      SELECT title, completed, created_at
      FROM todos_versions
      WHERE entity_id = ${event.eventDetails.id}
      ORDER BY since DESC
      LIMIT 1
    `;
    const current = rows[0];
    if (!current) {
      return;
    }

    yield* sql`
      INSERT INTO todos_versions ${sql.insert({
        entityId: event.eventDetails.id,
        since: since.value,
        title: current.title,
        completed: current.completed,
        createdAt: current.created_at,
        deleted: true,
      })}
    `;
  }),
);

const todoMigrations = Migrator.fromRecord({
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

const todoMigrationsLayer = Layer.effectDiscard(
  Migrator.make({})({ loader: todoMigrations }),
);

const PgSqlClientWithSyncMigrations = PostgresPrimarySyncEngine.migrationsLayer.pipe(
  Layer.provideMerge(PgliteSqlClient),
);

const PgSqlClientWithAllMigrations = todoMigrationsLayer.pipe(
  Layer.provideMerge(PgSqlClientWithSyncMigrations),
);

const PrimaryEventRouterLayer = EventRouter.layer({
  handlers: [todoCreatedHandler, todoCompletionSetHandler, todoDeletedHandler],
});

const PrimaryProjectionBootstrapLayer = PrimaryProjectionBootstrap.primaryLayer([
  {
    key: todosProjectionKey,
    materializeAt: materializeTodosAt,
  },
]);

const BootstrapServerLayer = HttpProjectionBootstrap.serverLayer.pipe(
  Layer.provide(PrimaryProjectionBootstrapLayer),
);

export const PrimaryTodoLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(PrimaryEventRouterLayer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
  Layer.provideMerge(PrimaryProjectionBootstrapLayer),
  Layer.provideMerge(BootstrapServerLayer),
);

export const listPrimaryTodos = (syncAnchor?: string) =>
  Effect.gen(function* () {
    if (syncAnchor) {
      return yield* materializeTodosAt(syncAnchor);
    }

    const primary = yield* PrimarySyncEngine.PrimarySyncEngine;
    const latest = yield* primary.getLatestEvent();
    if (Option.isNone(latest)) {
      return [] as ReadonlyArray<Todo>;
    }

    return yield* materializeTodosAt(latest.value.eventId);
  });
