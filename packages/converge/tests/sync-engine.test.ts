import { assert, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";
import { Event, Projection, SyncEngine, SyncEngineLayer } from "../src/index.ts";

it.effect("a test app can define an Event type and register a Proposed Event Processor", () =>
  Effect.gen(function* () {
    const TodoCreated = Event.make("todo.created.v1", {
      name: Schema.String,
    });

    const engine = yield* SyncEngine;
    const captured = yield* Ref.make<string>("");

    yield* engine.register(TodoCreated, ({ payload }) =>
      Effect.gen(function* () {
        yield* Ref.set(captured, payload.name);
        return { ok: true };
      }),
    );

    yield* engine.process(TodoCreated, { payload: { name: "Buy milk" } });

    const value = yield* Ref.get(captured);
    assert.strictEqual(value, "Buy milk");
  }).pipe(Effect.provide(SyncEngineLayer)),
);

it.effect("recording a Proposed Event updates the Optimistic Projection but not the Accepted Projection", () =>
  Effect.gen(function* () {
    const CounterIncremented = Event.make("counter.incremented.v1", {
      amount: Schema.Number,
    });

    const Counter = Projection.make(
      "counter",
      0,
      (state, payload: { amount: number }) => state + payload.amount,
    );

    const engine = yield* SyncEngine;

    yield* engine.register(CounterIncremented, ({ payload }) =>
      Effect.sync(() => ({ newValue: payload.amount })),
    );

    yield* engine.registerProjection(CounterIncremented, Counter);

    const before = yield* engine.getProjections();
    assert.strictEqual(before.accepted.counter as number, 0);
    assert.strictEqual(before.optimistic.counter as number, 0);

    const proposed = yield* engine.record(CounterIncremented, { amount: 5 });
    assert.ok(proposed.eventId.startsWith("event-"));

    const after = yield* engine.getProjections();
    assert.strictEqual(after.accepted.counter as number, 0);
    assert.strictEqual(after.optimistic.counter as number, 5);
  }).pipe(Effect.provide(SyncEngineLayer)),
);
