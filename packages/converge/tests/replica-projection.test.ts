import { assert, layer } from "@effect/vitest";
import { Context, Effect, Layer, Schema, Stream } from "effect";
import {
  EventId,
  MemoryProjection,
  PrimaryProjection,
  Projection,
} from "../src/index.ts";

const TodoRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
});

type TodoRow = typeof TodoRow.Type;

class TodoProjection extends Context.Service<
  TodoProjection,
  Projection.IReactiveProjection<ReadonlyArray<TodoRow>, never, TodoRow>
>()("TodoProjection") {}

const PrimaryProjectionLayer = PrimaryProjection.layer({
  projections: [
    {
      key: "todos",
      rowSchema: TodoRow,
      bootstrap: ({ eventId }) =>
        eventId === ("anchor-2" as EventId.EventId)
          ? Stream.make({ id: "todo-2", title: "Second" })
          : Stream.make({ id: "todo-1", title: "First" }),
    },
  ],
});

const TodoProjectionLayer = MemoryProjection.memoryLayer(TodoProjection, {
  initialValue: [] as ReadonlyArray<TodoRow>,
  bootstrap: (rows: Stream.Stream<TodoRow, unknown>) =>
    rows.pipe(
      Stream.runCollect,
      Effect.map((snapshot) => Array.from(snapshot)),
    ),
});

const TestLayer = Layer.mergeAll(PrimaryProjectionLayer, TodoProjectionLayer);

const ProjectionRouterLayer = Projection.routerLayer({
  projections: [
    {
      key: "todos",
      projection: TodoProjection,
    },
  ],
}).pipe(Layer.provideMerge(TodoProjectionLayer));

layer(TestLayer)((it) => {
  it.effect("bootstraps replica projections from primary projection rows", () =>
    Effect.gen(function* () {
      const primaryProjections = yield* PrimaryProjection.PrimaryProjectionRouter;
      const projection = yield* TodoProjection;
      const primaryProjection = primaryProjections.find("todos");
      if (!primaryProjection) {
        assert.fail("expected todos primary projection to be registered");
      }

      yield* projection.bootstrap(
        primaryProjection.bootstrap({
          eventId: Schema.decodeUnknownSync(EventId.EventId)("anchor-2"),
        }),
      );

      const snapshot = yield* projection.query((todos) => todos);

      assert.deepStrictEqual(snapshot, [{ id: "todo-2", title: "Second" }]);
    }),
  );
});

layer(ProjectionRouterLayer)((it) => {
  it.effect("registers bootstrappable projections by key", () =>
    Effect.gen(function* () {
      const router = yield* Projection.ProjectionRouter;
      const projection = router.find("todos");
      if (!projection) {
        assert.fail("expected todos projection to be registered");
      }

      yield* projection.bootstrap(Stream.make({ id: "todo-3", title: "Third" }));

      const todos = yield* (yield* TodoProjection).query((todos) => todos);

      assert.deepStrictEqual(todos, [{ id: "todo-3", title: "Third" }]);
      assert.strictEqual(router.find("missing"), undefined);
    }),
  );
});
