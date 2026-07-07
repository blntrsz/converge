import { IndexedDb } from "@effect/platform-browser";
import { Effect, type Layer } from "effect";
import { layer as httpPrimarySyncEngineLayer } from "../primary-sync-engine/layers/http-primary-sync-engine.ts";
import type { AnyEventHandler } from "../event/event-handler.ts";
import { EventInstance } from "../event/event-instance.ts";
import type { IndexedDbProjection } from "./indexeddb-projection.ts";
import { createEventStoreRuntime } from "./event-store-runtime.ts";

/**
 * @since 0.0.0
 * @category model
 */
export interface EventStoreConfig {
  readonly syncUrl: string;
  readonly handlers: ReadonlyArray<AnyEventHandler>;
  readonly projections: ReadonlyArray<IndexedDbProjection<any>>;
  readonly replicaDatabaseName?: string;
  readonly primarySyncEngineLayer?: Layer.Layer<any>;
  readonly indexedDbLayer?: Layer.Layer<IndexedDb.IndexedDb>;
}

/**
 * @since 0.0.0
 * @category model
 */
export interface EventStore {
  readonly commit: (event: EventInstance) => Promise<void>;
}

/**
 * @since 0.0.0
 * @category constructor
 */
export const makeEventStore = (config: EventStoreConfig) => {
  const runtime = createEventStoreRuntime({
    handlers: config.handlers,
    projections: config.projections,
    replicaDatabaseName: config.replicaDatabaseName,
    primarySyncEngineLayer:
      config.primarySyncEngineLayer ??
      httpPrimarySyncEngineLayer({
        baseUrl: config.syncUrl,
      }),
    indexedDbLayer: config.indexedDbLayer,
  });

  return {
    activate: () => runtime.activate.pipe(Effect.runPromise),
    commit: (event: EventInstance) => runtime.commit(event).pipe(Effect.runPromise),
    poke: () => runtime.poke.pipe(Effect.runPromise),
  };
};
