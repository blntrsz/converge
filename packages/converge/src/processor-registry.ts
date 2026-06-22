import { Context, Effect, HashMap, Layer, Option, Ref } from "effect";
import type { Event } from "./event.ts";
import type { ProposedEventProcessor } from "./sync-engine.ts";

export type AnyProcessor = ProposedEventProcessor<unknown, unknown, unknown>;

export interface ProcessorRegistryShape {
  readonly register: <Version extends string, Payload, Result, Error>(
    event: Event<Version, Payload>,
    processor: ProposedEventProcessor<Payload, Result, Error>,
  ) => Effect.Effect<void>;
  readonly lookup: <Version extends string, Payload>(
    event: Event<Version, Payload>,
  ) => Effect.Effect<Option.Option<AnyProcessor>>;
}

export class ProcessorRegistry extends Context.Service<
  ProcessorRegistry,
  ProcessorRegistryShape
>()("converge/ProcessorRegistry") {
  static readonly layer = Layer.effect(
    ProcessorRegistry,
    Effect.gen(function* () {
      const registry = yield* Ref.make(
        HashMap.empty<Event<string, unknown>, AnyProcessor>(),
      );

      const register: ProcessorRegistry["Service"]["register"] = (event, processor) =>
        Ref.update(registry, (map) =>
          HashMap.set(map, event as Event<string, unknown>, processor as AnyProcessor),
        );

      const lookup: ProcessorRegistry["Service"]["lookup"] = (event) =>
        Effect.map(
          Ref.get(registry),
          (map) => HashMap.get(map, event as Event<string, unknown>) as Option.Option<AnyProcessor>,
        );

      return ProcessorRegistry.of({ register, lookup });
    }),
  );
}
