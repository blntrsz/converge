import { describe, expect, test } from "bun:test";
import { Effect, Ref, Schema } from "effect";
import { Event, SyncEngine } from "../src/index.ts";

describe("sync engine", () => {
  test("a test app can define an Event type and register a Proposed Event Processor", async () => {
    const TodoCreated = Event.make("todo.created.v1", {
      name: Schema.String,
    });

    const program = Effect.gen(function* () {
      const engine = yield* SyncEngine;
      const captured = yield* Ref.make<string>("");

      yield* engine.register(TodoCreated, ({ payload }) =>
        Effect.gen(function* () {
          yield* Ref.set(captured, payload.name);
          return { ok: true };
        }),
      );

      yield* engine.process(TodoCreated, { payload: { name: "Buy milk" } });

      return yield* Ref.get(captured);
    }).pipe(Effect.provide(SyncEngine.layer));

    const value = await Effect.runPromise(program);
    expect(value).toBe("Buy milk");
  });
});
