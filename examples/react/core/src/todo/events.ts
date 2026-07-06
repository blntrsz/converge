import { Event } from "converge/event";
import { TodoModel } from "./model.ts";

export const todoCreated = Event.make("todo.created.v1", TodoModel.fields);

export const todoCompletionSet = Event.make("todo.completion-set.v1", {
  id: TodoModel.fields.id,
  completed: TodoModel.fields.completed,
});

export const todoDeleted = Event.make("todo.deleted.v1", {
  id: TodoModel.fields.id,
});
