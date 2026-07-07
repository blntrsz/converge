import { IndexedDb } from "@effect/platform-browser";
import { Layer } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as EventHandler from "../../event/event-handler.ts";
import { layer as eventRouterLayer } from "../../event/event-router.ts";
import * as HttpPrimarySyncEngine from "../../primary-sync-engine/layers/http-primary-sync-engine.ts";
import * as PrimaryProjection from "../../projection/services/primary-projection.ts";
import {
  type DefinedReplicaProjection,
  routerLayer,
} from "../../projection/services/replica-projection.ts";
import { layer as replicaApplyContextLayer } from "../services/apply-context.ts";
import { databaseLayer, layer as replicaSyncEngineLayer } from "./indexeddb-replica-sync-engine.ts";

/**
 * @since 0.0.0
 * @category constants
 */
export const defaultReplicaDatabaseName = "converge-replica";

/**
 * @since 0.0.0
 * @category options
 */
export interface BrowserLayerPrimaryOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly projections?: Parameters<typeof HttpPrimarySyncEngine.projectionLayer>[0]["projections"];
}

/**
 * @since 0.0.0
 * @category options
 */
export interface BrowserLayerOptions<
  TProjections extends ReadonlyArray<DefinedReplicaProjection<string, any, any>>,
> {
  readonly handlers: ReadonlyArray<EventHandler.AnyEventHandler>;
  readonly projection: TProjections;
  readonly primary: BrowserLayerPrimaryOptions;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface BrowserLayerResult<TSnapshot = any> {
  readonly layer: Layer.Layer<any, any, never>;
  readonly runtime: Atom.AtomRuntime<any, any>;
  readonly atom?: Atom.Atom<TSnapshot>;
  readonly atoms?: Readonly<Record<string, Atom.Atom<any>>>;
}

const projectionRouterLayer = (
  projections: ReadonlyArray<DefinedReplicaProjection<string, any, any>>,
) => {
  let mergedProjectionLayers = Layer.empty as unknown as Layer.Layer<any, any, any>;
  for (const projection of projections) {
    mergedProjectionLayers = mergedProjectionLayers.pipe(
      Layer.provideMerge(projection.projectionLayer),
    );
  }

  return routerLayer({
    projections: projections.map((projection) => ({
      key: projection.key,
      projection: projection.tag,
    })),
  }).pipe(Layer.provideMerge(mergedProjectionLayers));
};

/**
 * @since 0.0.0
 * @category layer
 */
export const browserLayer = (
  options: BrowserLayerOptions<ReadonlyArray<DefinedReplicaProjection<string, any, any>>>,
): BrowserLayerResult => {
  const indexedDbLayer = IndexedDb.layerWindow;
  const replicaDatabaseLayer = databaseLayer(defaultReplicaDatabaseName);
  const primarySyncEngineLayer = HttpPrimarySyncEngine.layer({
    baseUrl: options.primary.baseUrl,
    fetch: options.primary.fetch,
  });
  const primaryProjectionLayer = options.primary.projections
    ? HttpPrimarySyncEngine.projectionLayer({
        baseUrl: options.primary.baseUrl,
        fetch: options.primary.fetch,
        projections: options.primary.projections,
      })
    : PrimaryProjection.emptyLayer;
  const replicaProjectionRouterLayer = projectionRouterLayer(options.projection);

  const layer = replicaSyncEngineLayer.pipe(
    Layer.provide(eventRouterLayer({ handlers: options.handlers })),
    Layer.provide(replicaDatabaseLayer),
    Layer.provideMerge(replicaApplyContextLayer),
    Layer.provideMerge(primaryProjectionLayer),
    Layer.provideMerge(replicaProjectionRouterLayer),
    Layer.provideMerge(primarySyncEngineLayer),
    Layer.provide(indexedDbLayer),
  ) as Layer.Layer<any, any, never>;

  const runtime = Atom.runtime(layer);

  if (options.projection.length === 1) {
    const projection = options.projection[0]!;
    return {
      layer,
      runtime,
      atom: projection.atom(runtime),
    };
  }

  return {
    layer,
    runtime,
    atoms: Object.fromEntries(
      options.projection.map((projection) => [projection.key, projection.atom(runtime)] as const),
    ),
  };
};
