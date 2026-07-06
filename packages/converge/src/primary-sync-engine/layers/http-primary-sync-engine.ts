import { Effect, Layer, Option, Result, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as EventId from "../../event/event-id.ts";
import { EventInstance } from "../../event/event-instance.ts";
import {
  layer as primaryProjectionRouterLayer,
  PrimaryProjectionRouter,
  type PrimaryProjectionConfig,
} from "../../projection/services/primary-projection.ts";
import { PrimarySyncEngine, type IPrimarySyncEngine } from "../services/primary-sync-engine.ts";

/**
 * @since 0.0.0
 * @category schema
 */
export const WireEvent = Schema.Struct({
  eventId: Schema.String,
  eventType: Schema.String,
  eventDetails: Schema.Unknown,
});

/**
 * @since 0.0.0
 * @category schema
 */
export type WireEvent = typeof WireEvent.Type;

/**
 * @since 0.0.0
 * @category schema
 */
export const WirePullPage = Schema.Union([
  Schema.Struct({
    data: Schema.Array(WireEvent),
    hasNext: Schema.Literal(true),
    cursor: Schema.String,
  }),
  Schema.Struct({
    data: Schema.Array(WireEvent),
    hasNext: Schema.Literal(false),
  }),
]);

/**
 * @since 0.0.0
 * @category schema
 */
export type WirePullPage = typeof WirePullPage.Type;

/**
 * @since 0.0.0
 * @category schema
 */
export const WirePushBody = Schema.Struct({
  events: Schema.Array(WireEvent),
});

/**
 * @since 0.0.0
 * @category schema
 */
export type WirePushBody = typeof WirePushBody.Type;

/**
 * @since 0.0.0
 * @category schema
 */
export const WirePushResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    event: WireEvent,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    event: WireEvent,
  }),
]);

/**
 * @since 0.0.0
 * @category schema
 */
export type WirePushResult = typeof WirePushResult.Type;

/**
 * @since 0.0.0
 * @category schema
 */
export const WirePushResponse = Schema.Struct({
  results: Schema.Array(WirePushResult),
});

/**
 * @since 0.0.0
 * @category schema
 */
export type WirePushResponse = typeof WirePushResponse.Type;

/**
 * @since 0.0.0
 * @category schema
 */
export const WireEventResponse = Schema.Struct({
  event: Schema.NullOr(WireEvent),
});

/**
 * @since 0.0.0
 * @category schema
 */
export type WireEventResponse = typeof WireEventResponse.Type;

type PrimarySyncPullPage =
  | {
      readonly data: EventInstance[];
      readonly hasNext: true;
      readonly cursor: string;
    }
  | {
      readonly data: EventInstance[];
      readonly hasNext: false;
    };

/**
 * @since 0.0.0
 * @category encoding
 */
export const eventFromWire = (event: WireEvent): EventInstance =>
  new EventInstance({
    eventId: event.eventId,
    eventType: event.eventType,
    eventDetails: event.eventDetails,
  });

/**
 * @since 0.0.0
 * @category encoding
 */
export const eventToWire = (event: EventInstance): WireEvent => ({
  eventId: event.eventId,
  eventType: event.eventType,
  eventDetails: event.eventDetails,
});

/**
 * @since 0.0.0
 * @category encoding
 */
export const pullPageFromWire = (page: WirePullPage): PrimarySyncPullPage => {
  const data = page.data.map(eventFromWire);

  return page.hasNext ? { data, hasNext: true, cursor: page.cursor } : { data, hasNext: false };
};

/**
 * @since 0.0.0
 * @category encoding
 */
export const pullPageToWire = (page: PrimarySyncPullPage): WirePullPage => {
  const data = page.data.map(eventToWire);

  return page.hasNext ? { data, hasNext: true, cursor: page.cursor } : { data, hasNext: false };
};

/**
 * @since 0.0.0
 * @category encoding
 */
export const pushResultFromWire = (
  result: WirePushResult,
): Result.Result<EventInstance, EventInstance> =>
  result.ok
    ? Result.succeed(eventFromWire(result.event))
    : Result.fail(eventFromWire(result.event));

/**
 * @since 0.0.0
 * @category encoding
 */
export const pushResultToWire = (
  result: Result.Result<EventInstance, EventInstance>,
): WirePushResult =>
  Result.isSuccess(result)
    ? { ok: true, event: eventToWire(result.success) }
    : { ok: false, event: eventToWire(result.failure) };

/**
 * @since 0.0.0
 * @category encoding
 */
export const eventResponseFromWire = (response: WireEventResponse): Option.Option<EventInstance> =>
  response.event === null ? Option.none() : Option.some(eventFromWire(response.event));

/**
 * @since 0.0.0
 * @category encoding
 */
export const eventResponseToWire = (event: Option.Option<EventInstance>): WireEventResponse => ({
  event: Option.match(event, {
    onNone: () => null,
    onSome: eventToWire,
  }),
});

const pullPrimary = (cursor?: string) =>
  Effect.gen(function* () {
    const primary = yield* PrimarySyncEngine;

    return yield* primary.pull(cursor);
  });

const pushPrimary = (events: EventInstance[]) =>
  Effect.gen(function* () {
    const primary = yield* PrimarySyncEngine;

    return yield* primary.push(...events);
  });

const getLatestEventPrimary = () =>
  Effect.gen(function* () {
    const primary = yield* PrimarySyncEngine;

    return yield* primary.getLatestEvent();
  });

const getEventPrimary = (eventId: string) =>
  Effect.gen(function* () {
    const primary = yield* PrimarySyncEngine;

    return yield* primary.getEvent(eventId);
  });

const projectionRowsPrimary = (projectionKey: string, eventId: EventId.EventId) =>
  Effect.gen(function* () {
    const projections = yield* PrimaryProjectionRouter;
    const projection = projections.find(projectionKey);

    return projection
      ? Option.some(
          projection.bootstrap({ eventId }).pipe(
            Stream.mapEffect((row) =>
              Schema.encodeUnknownEffect(projection.rowSchema)(row).pipe(
                Effect.map((encoded) => `${JSON.stringify(encoded)}\n`),
              ),
            ),
            Stream.encodeText,
          ) as Stream.Stream<Uint8Array, unknown, never>,
        )
      : Option.none<Stream.Stream<Uint8Array, unknown>>();
  });

const json = (body: unknown, status?: number) =>
  HttpServerResponse.jsonUnsafe(body, status ? { status } : undefined);

const badRequest = (message: string) => json({ message }, 400);

const notFound = (message: string) => json({ message }, 404);

/**
 * @since 0.0.0
 * @category options
 */
export interface RoutesLayerOptions {
  readonly prefix?: string;
}

/**
 * @since 0.0.0
 * @category layer
 */
export const routesLayer = (options?: RoutesLayerOptions) =>
  HttpRouter.addAll(
    [
      HttpRouter.route("GET", "/pull", (request) =>
        Effect.gen(function* () {
          const url = new URL(request.originalUrl, "http://localhost");
          const cursor = url.searchParams.get("cursor") ?? undefined;
          const page = yield* pullPrimary(cursor);

          return json(pullPageToWire(page));
        }),
      ),

      HttpRouter.route("POST", "/push", (request) =>
        Effect.gen(function* () {
          const body = yield* HttpServerRequest.schemaBodyJson(WirePushBody).pipe(
            Effect.provideService(HttpServerRequest.HttpServerRequest, request),
            Effect.catch(() => Effect.succeed(null)),
          );
          if (!body) {
            return badRequest("Expected { events: WireEvent[] }");
          }

          const events = body.events.map(eventFromWire);
          const results = yield* pushPrimary(events);

          return json({
            results: results.map(pushResultToWire),
          });
        }),
      ),

      HttpRouter.route("GET", "/events/latest", () =>
        Effect.gen(function* () {
          const event = yield* getLatestEventPrimary();

          return json(eventResponseToWire(event));
        }),
      ),

      HttpRouter.route("GET", "/events/:eventId", () =>
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          const eventId = params.eventId;
          if (!eventId) {
            return badRequest("Expected eventId path parameter");
          }

          const event = yield* getEventPrimary(eventId);

          return json(eventResponseToWire(event));
        }),
      ),

      HttpRouter.route("GET", "/projection/:projection", (request) =>
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          const projectionKey = params.projection;
          if (!projectionKey) {
            return badRequest("Expected projection path parameter");
          }

          const url = new URL(request.originalUrl, "http://localhost");
          const eventIdParam = url.searchParams.get("eventId");
          if (!eventIdParam) {
            return badRequest("Expected eventId query parameter");
          }

          const rows = yield* projectionRowsPrimary(
            projectionKey,
            Schema.decodeUnknownSync(EventId.EventId)(eventIdParam),
          );
          if (Option.isNone(rows)) {
            return notFound(`Unknown projection ${projectionKey}`);
          }

          return HttpServerResponse.stream(rows.value, {
            contentType: "application/x-ndjson",
          });
        }),
      ),
    ] as const,
    options?.prefix ? { prefix: options.prefix } : undefined,
  );

/**
 * @since 0.0.0
 * @category options
 */
export interface WebHandlerOptions extends RoutesLayerOptions {
  readonly memoMap?: Layer.MemoMap;
  readonly disableLogger?: boolean;
}

/**
 * @since 0.0.0
 * @category constructor
 */
export const makeWebHandler = <ROut, E>(
  primaryLayer: Layer.Layer<PrimarySyncEngine | ROut, E, never>,
  options?: WebHandlerOptions,
) =>
  HttpRouter.toWebHandler(
    routesLayer({ prefix: options?.prefix }).pipe(Layer.provideMerge(primaryLayer)),
    {
      memoMap: options?.memoMap,
      disableLogger: options?.disableLogger,
    },
  );

/**
 * @since 0.0.0
 * @category options
 */
export interface LayerOptions {
  readonly baseUrl: string | URL;
  readonly fetch?: typeof globalThis.fetch;
}

const endpointUrl = (
  baseUrl: string | URL,
  endpoint: "/pull" | "/push" | "/events/latest" | `/events/${string}` | `/projection/${string}`,
  search?: Record<string, string>,
) => {
  const url = `${baseUrl}`.replace(/\/+$/, "") + endpoint;
  if (!search) return url;

  const params = new URLSearchParams(search);
  const query = params.toString();

  return query ? `${url}?${query}` : url;
};

const decodePullPage = Schema.decodeUnknownEffect(WirePullPage);
const decodePushResponse = Schema.decodeUnknownEffect(WirePushResponse);
const decodeEventResponse = Schema.decodeUnknownEffect(WireEventResponse);

/**
 * @since 0.0.0
 * @category layer
 */
export const layer = (options: LayerOptions): Layer.Layer<PrimarySyncEngine> => {
  const fetch = options.fetch ?? globalThis.fetch;

  const pull: IPrimarySyncEngine["pull"] = (cursor) =>
    Effect.tryPromise({
      async try() {
        const response = await fetch(
          endpointUrl(options.baseUrl, "/pull", cursor ? { cursor } : undefined),
        );
        if (!response.ok) {
          throw new Error(`Pull failed with ${response.status}`);
        }

        return await response.json();
      },
      catch: (error) => error,
    }).pipe(
      Effect.flatMap((body) => decodePullPage(body)),
      Effect.map(pullPageFromWire),
      Effect.orDie,
    );

  const push: IPrimarySyncEngine["push"] = (...events) =>
    Effect.tryPromise({
      async try() {
        const body: WirePushBody = { events: events.map(eventToWire) };
        const response = await fetch(endpointUrl(options.baseUrl, "/push"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`Push failed with ${response.status}`);
        }

        return await response.json();
      },
      catch: (error) => error,
    }).pipe(
      Effect.flatMap((body) => decodePushResponse(body)),
      Effect.map((response) => response.results.map(pushResultFromWire)),
      Effect.orDie,
    );

  const getLatestEvent: IPrimarySyncEngine["getLatestEvent"] = () =>
    Effect.tryPromise({
      async try() {
        const response = await fetch(endpointUrl(options.baseUrl, "/events/latest"));
        if (!response.ok) {
          throw new Error(`GetLatestEvent failed with ${response.status}`);
        }

        return await response.json();
      },
      catch: (error) => error,
    }).pipe(
      Effect.flatMap((body) => decodeEventResponse(body)),
      Effect.map(eventResponseFromWire),
      Effect.orDie,
    );

  const getEvent: IPrimarySyncEngine["getEvent"] = (eventId) =>
    Effect.tryPromise({
      async try() {
        const response = await fetch(
          endpointUrl(options.baseUrl, `/events/${encodeURIComponent(eventId)}`),
        );
        if (!response.ok) {
          throw new Error(`GetEvent failed with ${response.status}`);
        }

        return await response.json();
      },
      catch: (error) => error,
    }).pipe(
      Effect.flatMap((body) => decodeEventResponse(body)),
      Effect.map(eventResponseFromWire),
      Effect.orDie,
    );

  return Layer.succeed(
    PrimarySyncEngine,
    PrimarySyncEngine.of({
      pull,
      push,
      getLatestEvent,
      getEvent,
    }),
  );
};

/**
 * @since 0.0.0
 * @category options
 */
export interface ProjectionClientConfig<TKey extends string = string, TRow = unknown> {
  readonly key: TKey;
  readonly rowSchema: Schema.Codec<TRow, unknown, never, unknown>;
}

/**
 * @since 0.0.0
 * @category options
 */
export interface ProjectionLayerOptions<
  TProjections extends ReadonlyArray<ProjectionClientConfig<string, any>>,
> extends LayerOptions {
  readonly projections: TProjections;
}

const projectionStream = <TRow>(
  options: LayerOptions,
  projection: ProjectionClientConfig<string, TRow>,
  eventId: EventId.EventId,
) => {
  const fetch = options.fetch ?? globalThis.fetch;

  return Stream.unwrap(
    Effect.tryPromise({
      async try() {
        const response = await fetch(
          endpointUrl(options.baseUrl, `/projection/${encodeURIComponent(projection.key)}`, {
            eventId,
          }),
        );
        if (!response.ok) {
          throw new Error(`Projection ${projection.key} failed with ${response.status}`);
        }
        if (!response.body) {
          throw new Error(`Projection ${projection.key} response had no body`);
        }

        return response.body;
      },
      catch: (error) => error,
    }).pipe(
      Effect.map((body) =>
        Stream.fromReadableStream({
          evaluate: () => body,
          onError: (error) => error,
        }).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => line.length > 0),
          Stream.mapEffect((line) =>
            Effect.try({
              try: () => Schema.decodeUnknownSync(projection.rowSchema)(JSON.parse(line)),
              catch: (error) => error,
            }),
          ),
        ),
      ),
    ),
  );
};

/**
 * @since 0.0.0
 * @category layer
 */
export const projectionLayer = <
  const TProjections extends ReadonlyArray<ProjectionClientConfig<string, any>>,
>(
  options: ProjectionLayerOptions<TProjections>,
): Layer.Layer<PrimaryProjectionRouter> => {
  const projections = options.projections.map(
    (projection): PrimaryProjectionConfig<string, any, unknown, never> => ({
      key: projection.key,
      rowSchema: projection.rowSchema,
      bootstrap: ({ eventId }) => projectionStream(options, projection, eventId),
    }),
  );

  return primaryProjectionRouterLayer({ projections });
};
