import { todoCompletionSet, todoCreated, todoDeleted } from "@converge/react-core/todo";
import { EventHandler } from "converge";
import { Effect } from "effect";
import { todoProjection } from "./replica";

export const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const store = yield* todoProjection.store;

    yield* store.update((todos) => {
      if (todos.some((todo) => todo.id === event.eventDetails.id)) {
        return [todos, undefined] as const;
      }

      return [[...todos, event.eventDetails], undefined] as const;
    });
  }),
);

export const todoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const store = yield* todoProjection.store;

    yield* store.update((todos) => [
      todos.map((todo) =>
        todo.id === event.eventDetails.id
          ? { ...todo, completed: event.eventDetails.completed }
          : todo,
      ),
      undefined,
    ] as const);
  }),
);

export const todoDeletedHandler = EventHandler.make(
  todoDeleted,
  Effect.fn(function* (event) {
    const store = yield* todoProjection.store;

    yield* store.update(
      (todos) => [todos.filter((todo) => todo.id !== event.eventDetails.id), undefined] as const,
    );
  }),
);

export const todoHandlers = [todoCreatedHandler, todoCompletionSetHandler, todoDeletedHandler];
