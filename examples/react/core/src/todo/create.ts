import { EventInstance } from "converge/event";
import { Effect } from "effect";
import { todoCreated } from "./events.ts";
import { make, TodoModel } from "./model.ts";

/**
 * @category event instance
 */
export const makeCreatedEvent = Effect.fn("Todo.makeCreatedEvent")(function* (
  input: typeof TodoModel.jsonCreate.Type,
) {
  const todo = yield* make(input);

  return yield* EventInstance.make(todoCreated, todo);
});
