import { Effect, Layer, Stream } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { HttpPrimarySyncEngine } from "converge/primary-sync-engine";
import { EventRouter, PostgresEventLog } from "converge/event";
import { PostgresPrimarySyncEngine, PrimaryProjection } from "converge/primary-sync-engine";
import { TodoModel } from "@converge/react-core/todo";
import { todoHandlers } from "./todo/handlers.ts";
import { PgSqlClientWithAllMigrations } from "@converge/react-core/db/migration.ts";

// -- Sync Engine --

const PrimaryEventRouterLayer = EventRouter.layer({
  handlers: [...todoHandlers],
});

const TodoPrimaryProjectionLayer = PrimaryProjection.layer({
  projections: [
    {
      key: "converge-react.todos",
      rowSchema: TodoModel.json,
      bootstrap: () =>
        Stream.unwrap(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;

            return sql<typeof TodoModel.json.Type>`
              SELECT id, title, completed, created_at AS "createdAt"
              FROM todo
            `.stream;
          }),
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
