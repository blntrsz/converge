import { Context, Effect, Layer, Option, Schema } from "effect";
import type { Event } from "./event.ts";
import { ProcessorRegistry } from "./processor-registry.ts";

export interface ProcessorInput<Payload> {
  readonly payload: Payload;
}

export type ProposedEventProcessor<Payload, Result, Error = never> = (
  input: ProcessorInput<Payload>,
) => Effect.Effect<Result, Error>;

export class ProcessorNotRegisteredError extends Schema.TaggedErrorClass<ProcessorNotRegisteredError>()(
  "ProcessorNotRegisteredError",
  { version: Schema.String },
) {}

export class SyncEngine extends Context.Service<SyncEngine, {
  readonly register: <Version extends string, Payload, Result, Error>(
    event: Event<Version, Payload>,
    processor: ProposedEventProcessor<Payload, Result, Error>,
  ) => Effect.Effect<void>;
  readonly process: <Version extends string, Payload, Result, Error>(
    event: Event<Version, Payload>,
    input: ProcessorInput<Payload>,
  ) => Effect.Effect<Result, ProcessorNotRegisteredError | Error>;
}>()("converge/SyncEngine") {
  static readonly layer = Layer.effect(
    SyncEngine,
    Effect.gen(function* () {
      const registry = yield* ProcessorRegistry;

      const register: SyncEngine["Service"]["register"] = (event, processor) =>
        registry.register(event, processor);

      const process: SyncEngine["Service"]["process"] = <Version extends string, Payload, Result, Error>(
        event: Event<Version, Payload>,
        input: ProcessorInput<Payload>,
      ) =>
        Effect.gen(function* () {
          const maybeProcessor = yield* registry.lookup(event);

          if (Option.isNone(maybeProcessor)) {
            return yield* new ProcessorNotRegisteredError({ version: event.version });
          }

          const processor = maybeProcessor.value as ProposedEventProcessor<
            Payload,
            Result,
            Error
          >;

          return yield* processor(input);
        });

      return SyncEngine.of({ register, process });
    }),
  ).pipe(Layer.provide(ProcessorRegistry.layer));
}
