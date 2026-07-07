import {
  applyCompletionSet,
  applyCreated,
  applyDeleted,
  todoCompletionSet,
  todoCreated,
  todoDeleted,
} from "@converge/react-core/todo";
import { EventHandler } from "converge";
import { Effect } from "effect";
import { TodoProjection } from "./projection";

/**
 * @category event handler
 */
export const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const store = yield* TodoProjection.store;

    yield* store.update((snapshot) => [applyCreated(snapshot, event.eventDetails), undefined]);
  }),
);

/**
 * @category event handler
 */
export const todoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const store = yield* TodoProjection.store;

    yield* store.update((snapshot) => [
      applyCompletionSet(snapshot, event.eventDetails),
      undefined,
    ]);
  }),
);

/**
 * @category event handler
 */
export const todoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* (event) {
    const store = yield* TodoProjection.store;

    yield* store.update((snapshot) => [applyDeleted(snapshot, event.eventDetails), undefined]);
  }),
);

export const todoHandlers = [todoCreatedHandler, todoCompletionSetHandler, todoDeletedHandler];
