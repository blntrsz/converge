import { Context, Effect, Schema } from "effect";
import type { EventInstance } from "../../event/event-instance.ts";

/**
 * @since 0.0.0
 * @category error
 */
export class ProjectionBootstrapHttpError extends Schema.TaggedErrorClass<ProjectionBootstrapHttpError>()(
  "ProjectionBootstrapHttpError",
  {
    projectionKey: Schema.String,
    status: Schema.Number,
    message: Schema.String,
  },
) {}

/**
 * @since 0.0.0
 * @category model
 */
export interface BootstrapHttpResult {
  readonly projectionKey: string;
  readonly syncAnchor: string;
  readonly snapshot: unknown;
  readonly anchorEvent: EventInstance;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IProjectionBootstrapClient {
  readonly fetch: (
    projectionKey: string,
    syncAnchor?: string,
  ) => Effect.Effect<BootstrapHttpResult, ProjectionBootstrapHttpError>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class ProjectionBootstrapClient extends Context.Service<
  ProjectionBootstrapClient,
  IProjectionBootstrapClient
>()("ProjectionBootstrapClient") {}
