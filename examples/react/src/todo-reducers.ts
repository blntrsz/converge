import { Schema } from "effect";
import type { EventInstance } from "converge/event";
import {
  todoCompletionSet,
  todoCreated,
  todoDeleted,
  type Todo,
} from "./todo-events.ts";

export const sortTodos = (todos: ReadonlyArray<Todo>) =>
  [...todos].sort((left, right) => left.createdAt - right.createdAt);

export const reduceTodoCreated = (
  todos: ReadonlyArray<Todo>,
  event: EventInstance,
): ReadonlyArray<Todo> => {
  const details = event.eventDetails as Schema.Schema.Type<typeof todoCreated.eventDetails>;
  if (todos.some((todo) => todo.id === details.id)) {
    return todos;
  }

  return sortTodos([
    ...todos,
    {
      id: details.id,
      title: details.title,
      completed: false,
      createdAt: details.createdAt,
    },
  ]);
};

export const reduceTodoCompletionSet = (
  todos: ReadonlyArray<Todo>,
  event: EventInstance,
): ReadonlyArray<Todo> => {
  const details = event.eventDetails as Schema.Schema.Type<
    typeof todoCompletionSet.eventDetails
  >;

  return todos.map((todo) =>
    todo.id === details.id ? { ...todo, completed: details.completed } : todo,
  );
};

export const reduceTodoDeleted = (
  todos: ReadonlyArray<Todo>,
  event: EventInstance,
): ReadonlyArray<Todo> => {
  const details = event.eventDetails as Schema.Schema.Type<typeof todoDeleted.eventDetails>;
  return todos.filter((todo) => todo.id !== details.id);
};

export const findTodoReduce = (eventType: string) => {
  if (eventType === todoCreated.eventType) {
    return reduceTodoCreated;
  }
  if (eventType === todoCompletionSet.eventType) {
    return reduceTodoCompletionSet;
  }
  if (eventType === todoDeleted.eventType) {
    return reduceTodoDeleted;
  }
  return undefined;
};
