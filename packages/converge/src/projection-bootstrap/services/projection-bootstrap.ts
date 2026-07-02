import { Context, Effect, Layer, Schema } from "effect";
import type { EventInstance } from "../event/event-instance.ts";

/**
 * @since 0.0.0
 * @category error
 */
export class ProjectionBootstrapNotFound extends Schema.TaggedErrorClass<ProjectionBootstrapNotFound>()(
  "ProjectionBootstrapNotFound",
  {
    projectionKey: Schema.String,
  },
) {}

/**
 * @since 0.0.0
 * @category model
 */
export interface PrimaryProjectionBootstrapDefinition {
  readonly key: string;
  readonly materializeAt: (
    syncAnchor: string,
  ) => Effect.Effect<unknown>;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface BootstrapProjectionResult {
  readonly projectionKey: string;
  readonly syncAnchor: string;
  readonly snapshot: unknown;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface BootstrapBundle {
  readonly syncAnchor: string;
  readonly anchorEvent: EventInstance;
  readonly projections: ReadonlyArray<BootstrapProjectionResult>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IPrimaryProjectionBootstrap {
  readonly bootstrap: (
    projectionKey: string,
    syncAnchor: string,
  ) => Effect.Effect<BootstrapProjectionResult, ProjectionBootstrapNotFound>;
  readonly listKeys: Effect.Effect<ReadonlyArray<string>>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class PrimaryProjectionBootstrap extends Context.Service<
  PrimaryProjectionBootstrap,
  IPrimaryProjectionBootstrap
>()("PrimaryProjectionBootstrap") {}

/**
 * @since 0.0.0
 * @category model
 */
export interface ReplicaProjectionBootstrapDefinition {
  readonly key: string;
  readonly importSnapshot: (snapshot: unknown) => Effect.Effect<void>;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IReplicaProjectionBootstrap {
  readonly importProjection: (
    result: BootstrapProjectionResult,
  ) => Effect.Effect<void, ProjectionBootstrapNotFound>;
  readonly listKeys: Effect.Effect<ReadonlyArray<string>>;
}

/**
 * @since 0.0.0
 * @category service
 */
export class ReplicaProjectionBootstrap extends Context.Service<
  ReplicaProjectionBootstrap,
  IReplicaProjectionBootstrap
>()("ReplicaProjectionBootstrap") {}

/**
 * @since 0.0.0
 * @category layer
 */
export const primaryLayer = (
  definitions: ReadonlyArray<PrimaryProjectionBootstrapDefinition>,
): Layer.Layer<PrimaryProjectionBootstrap> => {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  return Layer.succeed(
    PrimaryProjectionBootstrap,
    PrimaryProjectionBootstrap.of({
      bootstrap: (projectionKey, syncAnchor) =>
        Effect.gen(function* () {
          const definition = byKey.get(projectionKey);
          if (!definition) {
            return yield* Effect.fail(new ProjectionBootstrapNotFound({ projectionKey }));
          }

          const snapshot = yield* definition.materializeAt(syncAnchor);

          return {
            projectionKey,
            syncAnchor,
            snapshot,
          };
        }),
      listKeys: Effect.succeed([...byKey.keys()]),
    }),
  );
};

/**
 * @since 0.0.0
 * @category layer
 */
export const replicaLayer = (
  definitions: ReadonlyArray<ReplicaProjectionBootstrapDefinition>,
): Layer.Layer<ReplicaProjectionBootstrap> => {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  return Layer.succeed(
    ReplicaProjectionBootstrap,
    ReplicaProjectionBootstrap.of({
      importProjection: (result) =>
        Effect.gen(function* () {
          const definition = byKey.get(result.projectionKey);
          if (!definition) {
            return yield* Effect.fail(
              new ProjectionBootstrapNotFound({ projectionKey: result.projectionKey }),
            );
          }

          yield* definition.importSnapshot(result.snapshot);
        }),
      listKeys: Effect.succeed([...byKey.keys()]),
    }),
  );
};
