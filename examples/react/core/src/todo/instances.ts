import { EventInstance } from "converge/event";
import { Effect } from "effect";
import { todoCompletionSet, todoCreated, todoDeleted } from "./events.ts";
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

/**
 * @category event instance
 */
export const makeCompletionSetEvent = Effect.fn("Todo.makeCompletionSetEvent")(function* (input: {
  readonly id: string;
  readonly completed: boolean;
}) {
  return yield* EventInstance.make(todoCompletionSet, input);
});

/**
 * @category event instance
 */
export const makeDeletedEvent = Effect.fn("Todo.makeDeletedEvent")(function* (input: {
  readonly id: string;
}) {
  return yield* EventInstance.make(todoDeleted, input);
});
