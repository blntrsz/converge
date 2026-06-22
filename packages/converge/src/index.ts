export { Event } from "./event.ts";
export { Projection } from "./projection.ts";
export {
  ProcessorRegistry,
  type AnyProcessor,
  type ProcessorRegistryShape,
} from "./processor-registry.ts";
export {
  SyncEngine,
  ProcessorNotRegisteredError,
  type ProcessorInput,
  type ProposedEventProcessor,
  type ProposedEvent,
  type ProjectionsSnapshot,
} from "./sync-engine.ts";
