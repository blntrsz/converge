import { Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpPrimarySyncEngine } from "converge/primary-sync-engine";
import { EventRouter, PostgresEventLog } from "converge/event";
import { PostgresPrimarySyncEngine, PostgresPrimaryProjection, PrimaryProjection } from "converge/primary-sync-engine";
import { TodoModel } from "@converge/react-core/todo";
import { todoHandlers } from "./todo/handlers.ts";
import { PgSqlClientWithAllMigrations } from "@converge/react-core/db/migration.ts";

const TodoBootstrapRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.String,
  deleted: Schema.Boolean,
});

// -- Sync Engine --

const PrimaryEventRouterLayer = EventRouter.layer({
  handlers: [...todoHandlers],
});

const versionedTodos = PostgresPrimaryProjection.versionedTable({
  key: "converge-react.todos",
  tableName: "todo",
  columns: ["id", "title", "completed", "createdAt", "deleted"],
  rowSchema: TodoBootstrapRow,
});

const TodoPrimaryProjectionLayer = PrimaryProjection.layer({
  projections: [
    {
      ...versionedTodos,
      rowSchema: TodoModel.json,
      bootstrap: ({ eventId }) =>
        versionedTodos.bootstrap({ eventId }).pipe(
          Stream.filterMap((row) =>
            row.deleted
              ? Option.none()
              : Option.some({
                  id: row.id,
                  title: row.title,
                  completed: row.completed,
                  createdAt: row.createdAt,
                }),
          ),
        ),
    },
  ],
});

export const PrimaryTodoLayer = Layer.mergeAll(
  PostgresPrimarySyncEngine.layer.pipe(
    Layer.provideMerge(PrimaryEventRouterLayer),
    Layer.provideMerge(PostgresEventLog.layer),
    Layer.provideMerge(PgSqlClientWithAllMigrations),
  ),
  TodoPrimaryProjectionLayer,
);

// -- HTTP API --

const ApiRoutes = Layer.mergeAll(HttpPrimarySyncEngine.routesLayer({ prefix: "/api/sync" })).pipe(
  Layer.provideMerge(PrimaryTodoLayer),
);

const webApi = HttpRouter.toWebHandler(ApiRoutes, { disableLogger: true });
const rawApiHandler = webApi.handler;

export const apiHandler = (request: Request) => rawApiHandler(request, {} as never);
export const disposeApi = webApi.dispose;
