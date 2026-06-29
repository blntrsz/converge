import { Schema } from "effect";
import * as Event from "../../../packages/converge/src/event/event.ts";

export const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
});

export const todoCompletionSet = Event.make("todo.completion-set.v1", {
  id: Schema.String,
  completed: Schema.Boolean,
});

export const todoDeleted = Event.make("todo.deleted.v1", {
  id: Schema.String,
});

export type Todo = {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly createdAt: number;
};
