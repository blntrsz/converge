import { DateTime, Effect, Schema } from "effect";
import { createId } from "@paralleldrive/cuid2";
import { Model } from "effect/unstable/schema";

/**
 * @category model
 */
export class TodoModel extends Model.Class<TodoModel>("TodoModel")({
  id: Model.GeneratedByApp(Schema.String),
  title: Schema.String,
  completed: Model.GeneratedByApp(Schema.Boolean),
  createdAt: Model.GeneratedByApp(Schema.String),
}) {}

/**
 * @category type
 */
export type Type = Schema.Schema.Type<typeof TodoModel>;

export type TodoCreatedDetails = Pick<Type, "id" | "title" | "createdAt">;

/**
 * @category model method
 */
export const make = Effect.fn("Todo.make")(function* (input: typeof TodoModel.jsonCreate.Type) {
  const id = createId();
  const now = yield* DateTime.nowAsDate;

  return TodoModel.make({
    id,
    title: input.title,
    completed: false,
    createdAt: now.toISOString(),
  });
});
