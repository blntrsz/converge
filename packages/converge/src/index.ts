export { Event } from "./event.ts";
export { Projection } from "./projection.ts";
export {
  ProcessorRegistry,
  type AnyProcessor,
  type ProcessorRegistryShape,
} from "./processor-registry.ts";
export {
  SyncEngine,
  SyncEngineLayer,
  ProcessorNotRegisteredError,
  type ProcessorInput,
  type ProposedEvent,
  type ProposedEventProcessor,
  type ProjectionsSnapshot,
} from "./sync-engine/index.ts";
