import { todoCompletionSet, todoCreated, todoDeleted } from "@converge/react-core/todo";
import * as TodoModel from "@converge/react-core/todo/model";
import { EventHandler } from "converge";
import { Effect } from "effect";
import { SqlModel } from "effect/unstable/sql";

const makeRepository = SqlModel.makeRepository(TodoModel.TodoModel, {
  tableName: "todo",
  spanPrefix: "todo",
  idColumn: "id",
});

/**
 * @category event handler
 */
export const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const repository = yield* makeRepository;

    yield* repository.insert(event.eventDetails);
  }),
);

/**
 * @category event handler
 */
export const todoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const repository = yield* makeRepository;

    const todo = yield* repository.findById(event.eventDetails.id);

    yield* repository.update({
      ...todo,
      completed: event.eventDetails.completed,
    });
  }),
);

/**
 * @category event handler
 */
export const todoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* (event) {
    const repository = yield* makeRepository;

    yield* repository.delete(event.eventDetails.id);
  }),
);

export const todoHandlers = [todoCreatedHandler, todoCompletionSetHandler, todoDeletedHandler];
