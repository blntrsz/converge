import { todoCompletionSet, todoCreated, todoDeleted } from "@converge/react-core/todo";
import { TodoModel, type Type } from "@converge/react-core/todo/model";
import { EventHandler } from "converge";
import { Schema } from "effect";
import { Effect } from "effect";
import { indexeddbProjection } from "converge/react";

const projectionStorageKey = "converge-react.todos";
const TodoListSchema = Schema.Array(TodoModel);

export const todoProjection = indexeddbProjection({
  databaseName: "converge-react-todos-projection",
  key: projectionStorageKey,
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Type>,
});

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

export const eventStoreConfig = {
  syncUrl: "/api/sync",
  handlers: todoHandlers,
  projections: [todoProjection],
  replicaDatabaseName: "converge-react-todos-replica",
} as const;
