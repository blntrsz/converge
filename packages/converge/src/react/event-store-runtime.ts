import { IndexedDb } from "@effect/platform-browser";
import { Effect, Layer, ManagedRuntime, type Layer as LayerType } from "effect";
import type { AnyEventHandler } from "../event/event-handler.ts";
import { EventInstance } from "../event/event-instance.ts";
import { layer as eventRouterLayer } from "../event/event-router.ts";
import { emptyLayer as emptyPrimaryProjectionLayer } from "../projection/services/primary-projection.ts";
import { routerLayer as replicaProjectionRouterLayer } from "../projection/services/replica-projection.ts";
import { layer as indexedDbReplicaSyncEngineLayer, databaseLayer as replicaDatabaseLayer } from "../replica-sync-engine/layers/indexeddb-replica-sync-engine.ts";
import { layer as replicaApplyContextLayer } from "../replica-sync-engine/services/apply-context.ts";
import { ReplicaSyncEngine } from "../replica-sync-engine/services/replica-sync-engine.ts";
import type { IndexedDbProjection } from "./indexeddb-projection.ts";

/**
 * @since 0.0.0
 * @category model
 */
export interface EventStoreRuntimeConfig {
  readonly handlers: ReadonlyArray<AnyEventHandler>;
  readonly projections: ReadonlyArray<IndexedDbProjection<any>>;
  readonly replicaDatabaseName?: string;
  readonly primarySyncEngineLayer: LayerType.Layer<any>;
  readonly indexedDbLayer?: LayerType.Layer<IndexedDb.IndexedDb>;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface EventStoreRuntime {
  readonly activate: Effect.Effect<void, unknown, never>;
  readonly commit: (event: EventInstance) => Effect.Effect<void, unknown, never>;
  readonly poke: Effect.Effect<void, unknown, never>;
}

const setProjectionAtom = (projection: IndexedDbProjection<any>, atom: unknown) => {
  (projection as IndexedDbProjection<any> & { _setAtom(atom: unknown): void })._setAtom(atom);
};

const buildLayer = (config: EventStoreRuntimeConfig) => {
  const projectionLayers = config.projections.map((projection) => projection._layer);
  const mergedProjectionLayers =
    projectionLayers.length === 0
      ? Layer.empty
      : projectionLayers.reduce((left, right) => Layer.merge(left, right));
  const projectionsWithContext = mergedProjectionLayers.pipe(
    Layer.provideMerge(replicaApplyContextLayer),
  );
  const eventRouter = eventRouterLayer({ handlers: [...config.handlers] }).pipe(
    Layer.provideMerge(projectionsWithContext),
  );
  const routerLayer = replicaProjectionRouterLayer({
    projections: config.projections.map((projection) => ({
      key: projection.key,
      projection: projection._tags.Projection,
    })),
  }).pipe(Layer.provideMerge(projectionsWithContext));

  const replicaDbLayer = replicaDatabaseLayer(config.replicaDatabaseName);

  return indexedDbReplicaSyncEngineLayer.pipe(
    Layer.provide(eventRouter),
    Layer.provide(replicaDbLayer),
    Layer.provideMerge(replicaApplyContextLayer),
    Layer.provideMerge(routerLayer),
    Layer.provideMerge(emptyPrimaryProjectionLayer),
    Layer.provideMerge(config.primarySyncEngineLayer),
    Layer.provide(config.indexedDbLayer ?? IndexedDb.layerWindow),
  );
};

/**
 * @since 0.0.0
 * @category constructor
 */
export const createEventStoreRuntime = (config: EventStoreRuntimeConfig): EventStoreRuntime => {
  const layer = buildLayer(config);
  const runtime = ManagedRuntime.make(layer);

  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.tryPromise({
      try: () => runtime.runPromise(effect as Effect.Effect<A, E, never>),
      catch: (cause) => cause,
    });

  const activate = run(
    Effect.gen(function* () {
      for (const projection of config.projections) {
        const service = yield* projection._tags.Projection;
        setProjectionAtom(projection, service.atom);
      }

      const replica = yield* ReplicaSyncEngine;
      yield* replica.poke();
    }),
  );

  const commit = (event: EventInstance) =>
    run(
      Effect.gen(function* () {
        const replica = yield* ReplicaSyncEngine;
        yield* replica.push(event);
      }),
    );

  const poke = run(
    Effect.gen(function* () {
      const replica = yield* ReplicaSyncEngine;
      yield* replica.poke();
    }),
  );

  return { activate, commit, poke };
};
