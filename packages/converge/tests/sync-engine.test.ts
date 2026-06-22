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

it.effect("accepting a Proposed Event appends it to Event History with a Previous Event ID", () =>
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

    const first = yield* engine.record(CounterIncremented, { amount: 5 });
    assert.strictEqual(first.tailEventId, undefined);

    const acceptedFirst = yield* engine.accept(first);
    assert.strictEqual(acceptedFirst.eventId, first.eventId);
    assert.strictEqual(acceptedFirst.previousEventId, undefined);

    const second = yield* engine.record(CounterIncremented, { amount: 3 });
    assert.strictEqual(second.tailEventId, first.eventId);

    const acceptedSecond = yield* engine.accept(second);

    assert.strictEqual(acceptedSecond.eventId, second.eventId);
    assert.strictEqual(acceptedSecond.previousEventId, first.eventId);

    const history = yield* engine.getEventHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0]!.eventId, first.eventId);
    assert.strictEqual(history[0]!.previousEventId, undefined);
    assert.strictEqual(history[1]!.eventId, second.eventId);
    assert.strictEqual(history[1]!.previousEventId, first.eventId);
  }).pipe(Effect.provide(SyncEngineLayer)),
);

it.effect("syncing accepted Events updates the Accepted Projection, removes Proposed Events, and rebuilds the Optimistic Projection", () =>
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

    const first = yield* engine.record(CounterIncremented, { amount: 5 });
    const second = yield* engine.record(CounterIncremented, { amount: 3 });

    yield* engine.accept(first);
    yield* engine.accept(second);

    const before = yield* engine.getProjections();
    assert.strictEqual(before.accepted.counter as number, 0);
    assert.strictEqual(before.optimistic.counter as number, 8);

    yield* engine.sync();

    const after = yield* engine.getProjections();
    assert.strictEqual(after.accepted.counter as number, 8);
    assert.strictEqual(after.optimistic.counter as number, 8);

    const history = yield* engine.getEventHistory();
    assert.strictEqual(history.length, 2);
  }).pipe(Effect.provide(SyncEngineLayer)),
);

it.effect("the full in-memory sync flow is observable through the public API", () =>
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

    const proposed = yield* engine.record(CounterIncremented, { amount: 5 });
    const accepted = yield* engine.accept(proposed);

    assert.strictEqual(accepted.eventId, proposed.eventId);
    assert.strictEqual(accepted.previousEventId, undefined);

    yield* engine.sync();

    const projections = yield* engine.getProjections();
    assert.strictEqual(projections.accepted.counter as number, 5);
    assert.strictEqual(projections.optimistic.counter as number, 5);

    const history = yield* engine.getEventHistory();
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0]!.eventId, proposed.eventId);
  }).pipe(Effect.provide(SyncEngineLayer)),
);
