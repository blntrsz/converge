import { EventLog } from "converge/event";
import type { EventInstance } from "converge";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { Type } from "@converge/react-core/todo/model";

const resolveSince = (event: EventInstance) =>
  Effect.gen(function* () {
    const eventLog = yield* EventLog;
    const since = yield* eventLog.resolveEventHistoryId(event.eventId);

    if (Option.isNone(since)) {
      return yield* Effect.die(
        new Error(`Missing event history id for accepted event ${event.eventId}`),
      );
    }

    return since.value;
  });

const findLatestTodo = (id: string, beforeSince: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const rows = yield* sql<
      Type & { readonly since: string; readonly deleted: boolean }
    >`
      SELECT DISTINCT ON (id)
        id,
        title,
        completed,
        "createdAt",
        since,
        deleted
      FROM todo
      WHERE id = ${id}
        AND since <= CAST(${beforeSince} AS bigint)
      ORDER BY id, since DESC
      LIMIT 1
    `;

    const row = rows[0];
    if (!row || row.deleted) {
      return Option.none<Type>();
    }

    return Option.some({
      id: row.id,
      title: row.title,
      completed: row.completed,
      createdAt: row.createdAt,
    });
  });

const insertVersion = (todo: Type, since: string, deleted = false) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      INSERT INTO todo (id, title, completed, "createdAt", since, deleted)
      VALUES (
        ${todo.id},
        ${todo.title},
        ${todo.completed},
        ${todo.createdAt},
        CAST(${since} AS bigint),
        ${deleted}
      )
      ON CONFLICT (id, since) DO NOTHING
    `;
  });

/**
 * @category primary storage
 */
export const appendCreated = (event: EventInstance) =>
  Effect.gen(function* () {
    const since = yield* resolveSince(event);
    const details = event.eventDetails as Type;

    yield* insertVersion(details, since);
  });

/**
 * @category primary storage
 */
export const appendCompletionSet = (event: EventInstance) =>
  Effect.gen(function* () {
    const since = yield* resolveSince(event);
    const details = event.eventDetails as { readonly id: string; readonly completed: boolean };
    const existing = yield* findLatestTodo(details.id, since);

    if (Option.isNone(existing)) return;

    yield* insertVersion({ ...existing.value, completed: details.completed }, since);
  });

/**
 * @category primary storage
 */
export const appendDeleted = (event: EventInstance) =>
  Effect.gen(function* () {
    const since = yield* resolveSince(event);
    const details = event.eventDetails as { readonly id: string };
    const existing = yield* findLatestTodo(details.id, since);

    if (Option.isNone(existing)) return;

    yield* insertVersion(existing.value, since, true);
  });
