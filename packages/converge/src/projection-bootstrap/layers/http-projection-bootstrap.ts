import { Effect, Layer, Option, Schema } from "effect";
import { EventInstance } from "../../event/event-instance.ts";
import {
  PrimaryProjectionBootstrap,
  ProjectionBootstrapNotFound,
} from "./projection-bootstrap.ts";
import { PrimarySyncEngine } from "../../primary-sync-engine/services/primary-sync-engine.ts";
import {
  eventFromWire,
  eventToWire,
  type WireEvent,
} from "../../primary-sync-engine/layers/http-primary-sync-engine.ts";
import {
  ProjectionBootstrapClient,
  type BootstrapHttpResult,
  ProjectionBootstrapHttpError,
  type IProjectionBootstrapClient,
} from "./projection-bootstrap-client.ts";

/**
 * @since 0.0.0
 * @category schema
 */
export const WireBootstrapResponse = Schema.Struct({
  projectionKey: Schema.String,
  syncAnchor: Schema.String,
  snapshot: Schema.Unknown,
  anchorEvent: Schema.Struct({
    eventId: Schema.String,
    eventType: Schema.String,
    eventDetails: Schema.Unknown,
  }),
});

/**
 * @since 0.0.0
 * @category schema
 */
export type WireBootstrapResponse = typeof WireBootstrapResponse.Type;

const decodeBootstrapResponse = Schema.decodeUnknownEffect(WireBootstrapResponse);

const notFound = (projectionKey: string) =>
  Effect.fail(
    new ProjectionBootstrapHttpError({
      projectionKey,
      status: 404,
      message: `Projection bootstrap not found for ${projectionKey}`,
    }),
  );

/**
 * @since 0.0.0
 * @category layer
 */
export const serverLayer = Layer.effect(
  ProjectionBootstrapClient,
  Effect.gen(function* () {
    const bootstrap = yield* PrimaryProjectionBootstrap;
    const primary = yield* PrimarySyncEngine;

    const fetchBootstrap: IProjectionBootstrapClient["fetch"] = (
      projectionKey,
      syncAnchor,
    ) =>
      Effect.gen(function* () {
        const resolvedAnchor = syncAnchor
          ? syncAnchor
          : yield* primary.getLatestEvent().pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      new ProjectionBootstrapHttpError({
                        projectionKey,
                        status: 404,
                        message: "No accepted events available for bootstrap",
                      }),
                    ),
                  onSome: (event) => Effect.succeed(event.eventId),
                }),
              ),
            );

        const result = yield* bootstrap.bootstrap(projectionKey, resolvedAnchor).pipe(
          Effect.mapError(() => new ProjectionBootstrapNotFound({ projectionKey })),
        );

        const anchorEvent = yield* primary.getEvent(resolvedAnchor).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new ProjectionBootstrapHttpError({
                    projectionKey,
                    status: 404,
                    message: `Anchor event ${resolvedAnchor} not found`,
                  }),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );

        return {
          projectionKey: result.projectionKey,
          syncAnchor: result.syncAnchor,
          snapshot: result.snapshot,
          anchorEvent,
        } satisfies BootstrapHttpResult;
      }).pipe(
        Effect.catchTag("ProjectionBootstrapNotFound", () => notFound(projectionKey)),
      );

    return ProjectionBootstrapClient.of({ fetch: fetchBootstrap });
  }),
);

/**
 * @since 0.0.0
 * @category encoding
 */
export const bootstrapToWire = (result: BootstrapHttpResult): WireBootstrapResponse => ({
  projectionKey: result.projectionKey,
  syncAnchor: result.syncAnchor,
  snapshot: result.snapshot,
  anchorEvent: eventToWire(result.anchorEvent),
});

/**
 * @since 0.0.0
 * @category encoding
 */
export const bootstrapFromWire = (wire: WireBootstrapResponse): BootstrapHttpResult => ({
  projectionKey: wire.projectionKey,
  syncAnchor: wire.syncAnchor,
  snapshot: wire.snapshot,
  anchorEvent: eventFromWire(wire.anchorEvent),
});

/**
 * @since 0.0.0
 * @category options
 */
export interface ClientLayerOptions {
  readonly baseUrl: string | URL;
  readonly fetch?: typeof globalThis.fetch;
}

const bootstrapUrl = (
  baseUrl: string | URL,
  projectionKey: string,
  syncAnchor?: string,
) => {
  const url = new URL(`${baseUrl}`.replace(/\/+$/, "") + "/bootstrap");
  url.searchParams.set("projectionKey", projectionKey);
  if (syncAnchor) {
    url.searchParams.set("syncAnchor", syncAnchor);
  }
  return url.toString();
};

/**
 * @since 0.0.0
 * @category layer
 */
export const clientLayer = (
  options: ClientLayerOptions,
): Layer.Layer<ProjectionBootstrapClient> => {
  const fetch = options.fetch ?? globalThis.fetch;

  return Layer.succeed(
    ProjectionBootstrapClient,
    ProjectionBootstrapClient.of({
      fetch: (projectionKey, syncAnchor) =>
        Effect.tryPromise({
          async try() {
            const response = await fetch(
              bootstrapUrl(options.baseUrl, projectionKey, syncAnchor),
            );
            if (!response.ok) {
              throw new ProjectionBootstrapHttpError({
                projectionKey,
                status: response.status,
                message: `Bootstrap failed with ${response.status}`,
              });
            }

            return await response.json();
          },
          catch: (error) =>
            error instanceof ProjectionBootstrapHttpError
              ? error
              : new ProjectionBootstrapHttpError({
                  projectionKey,
                  status: 500,
                  message: String(error),
                }),
        }).pipe(
          Effect.flatMap((body) => decodeBootstrapResponse(body)),
          Effect.map(bootstrapFromWire),
        ),
    }),
  );
};
