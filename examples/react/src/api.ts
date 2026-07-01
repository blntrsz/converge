import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpPrimarySyncEngine } from "converge/primary-sync-engine";
import { listPrimaryTodos, PrimaryTodoLayer } from "./todo-primary";

const json = (body: unknown, status?: number) =>
  HttpServerResponse.jsonUnsafe(body, status ? { status } : undefined);

const ApiRoutes = Layer.mergeAll(
  HttpRouter.addAll(
    [
      HttpRouter.route(
        "GET",
        "/",
        json({
          name: "converge-react-api",
          endpoints: [
            "GET /api/health",
            "GET /api/todos",
            "GET /api/sync/pull?cursor=<eventId>",
            "POST /api/sync/push",
          ],
        }),
      ),

      HttpRouter.route("GET", "/health", json({ status: "ok" })),

      HttpRouter.route(
        "GET",
        "/todos",
        Effect.gen(function* () {
          const todos = yield* listPrimaryTodos;

          return json({ todos });
        }),
      ),
    ] as const,
    { prefix: "/api" },
  ),
  HttpPrimarySyncEngine.routesLayer({ prefix: "/api/sync" }),
).pipe(Layer.provideMerge(PrimaryTodoLayer));

const webApi = HttpRouter.toWebHandler(ApiRoutes, { disableLogger: true });
const rawApiHandler = webApi.handler as (
  request: Request,
  context?: unknown,
) => Promise<Response>;

export const apiHandler = (request: Request) => rawApiHandler(request);
export const disposeApi = webApi.dispose;
