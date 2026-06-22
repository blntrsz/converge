import { describe, expect, test } from "bun:test";
import { Effect, Ref, Schema } from "effect";
import { Event, Projection, SyncEngine, SyncEngineLayer } from "../src/index.ts";

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
    }).pipe(Effect.provide(SyncEngineLayer));

    const value = await Effect.runPromise(program);
    expect(value).toBe("Buy milk");
  });

  test("recording a Proposed Event updates the Optimistic Projection but not the Accepted Projection", async () => {
    const CounterIncremented = Event.make("counter.incremented.v1", {
      amount: Schema.Number,
    });

    const Counter = Projection.make(
      "counter",
      0,
      (state, payload: { amount: number }) => state + payload.amount,
    );

    const program = Effect.gen(function* () {
      const engine = yield* SyncEngine;

      yield* engine.register(CounterIncremented, ({ payload }) =>
        Effect.sync(() => ({ newValue: payload.amount })),
      );

      yield* engine.registerProjection(CounterIncremented, Counter);

      const before = yield* engine.getProjections();
      expect(before.accepted.counter).toBe(0);
      expect(before.optimistic.counter).toBe(0);

      const proposed = yield* engine.record(CounterIncremented, { amount: 5 });
      expect(proposed.eventId).toMatch(/^event-\d+$/);

      const after = yield* engine.getProjections();
      expect(after.accepted.counter).toBe(0);
      expect(after.optimistic.counter).toBe(5);
    }).pipe(Effect.provide(SyncEngineLayer));

    await Effect.runPromise(program);
  });
});
