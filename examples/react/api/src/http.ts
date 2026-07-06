import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpPrimarySyncEngine } from "converge/primary-sync-engine";
import { EventRouter, PostgresEventLog } from "converge/event";
import { PostgresPrimarySyncEngine } from "converge/primary-sync-engine";
import { todoHandlers } from "./todo/handlers.ts";
import { PgSqlClientWithAllMigrations } from "@converge/react-core/db/migration.ts";

// -- Sync Engine --

const PrimaryEventRouterLayer = EventRouter.layer({
  handlers: [...todoHandlers],
});

export const PrimaryTodoLayer = PostgresPrimarySyncEngine.layer.pipe(
  Layer.provideMerge(PrimaryEventRouterLayer),
  Layer.provideMerge(PostgresEventLog.layer),
  Layer.provideMerge(PgSqlClientWithAllMigrations),
);

// -- HTTP API --

const ApiRoutes = Layer.mergeAll(HttpPrimarySyncEngine.routesLayer({ prefix: "/api/sync" })).pipe(
  Layer.provideMerge(PrimaryTodoLayer),
);

const webApi = HttpRouter.toWebHandler(ApiRoutes, { disableLogger: true });
const rawApiHandler = webApi.handler;

export const apiHandler = (request: Request) => rawApiHandler(request, {} as never);
export const disposeApi = webApi.dispose;
