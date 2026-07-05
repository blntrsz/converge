import { assert, layer } from "@effect/vitest";
import { Context, Effect, Layer, Schema, Stream } from "effect";
import { EventId, PrimaryProjection } from "../src/index.ts";

const TodoRow = Schema.Struct({
  id: Schema.String,
});

const NoteRow = Schema.Struct({
  id: Schema.String,
});

const todoProjection: PrimaryProjection.PrimaryProjectionConfig<"todos", typeof TodoRow.Type> = {
  key: "todos",
  rowSchema: TodoRow,
  bootstrap: () => Stream.empty,
};

const noteProjection: PrimaryProjection.PrimaryProjectionConfig<"notes", typeof NoteRow.Type> = {
  key: "notes",
  rowSchema: NoteRow,
  bootstrap: () => Stream.empty,
};

layer(
  PrimaryProjection.layer({
    projections: [todoProjection, noteProjection],
  }),
)((it) => {
  it.effect("finds registered primary projections by key", () =>
    Effect.gen(function* () {
      const router = yield* PrimaryProjection.PrimaryProjectionRouter;

      assert.strictEqual(router.find("todos")?.key, "todos");
      assert.strictEqual(router.find("notes")?.key, "notes");
      assert.strictEqual(router.find("missing"), undefined);
    }),
  );
});

class ProjectionPrefix extends Context.Service<ProjectionPrefix, { readonly value: string }>()(
  "ProjectionPrefix",
) {}

const contextualProjection: PrimaryProjection.PrimaryProjectionConfig<
  "contextual",
  typeof TodoRow.Type,
  never,
  ProjectionPrefix
> = {
  key: "contextual",
  rowSchema: TodoRow,
  bootstrap: () =>
    Stream.fromEffect(
      Effect.gen(function* () {
        const prefix = yield* ProjectionPrefix;

        return { id: prefix.value };
      }),
    ),
};

layer(
  PrimaryProjection.layer({
    projections: [contextualProjection],
  }).pipe(
    Layer.provide(
      Layer.succeed(ProjectionPrefix, {
        value: "from-context",
      }),
    ),
  ),
)((it) => {
  it.effect("provides projection dependencies to registered bootstraps", () =>
    Effect.gen(function* () {
      const router = yield* PrimaryProjection.PrimaryProjectionRouter;
      const projection = router.find("contextual");
      if (!projection) {
        assert.fail("expected contextual projection to be registered");
      }

      const rows = yield* projection
        .bootstrap({ eventId: "event-1" as EventId.EventId })
        .pipe(Stream.runCollect);

      assert.deepStrictEqual(rows, [{ id: "from-context" }]);
    }),
  );
});
