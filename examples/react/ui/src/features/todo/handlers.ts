import { IndexedDbDatabase, IndexedDbTable, IndexedDbVersion } from "@effect/platform-browser";
import { todoCompletionSet, todoCreated, todoDeleted } from "@converge/react-core/todo";
import * as TodoModel from "@converge/react-core/todo/model";
import { EventHandler } from "converge";
import { Effect } from "effect";

export const TodoTable = IndexedDbTable.make({
  name: "todo",
  schema: TodoModel.TodoModel,
  keyPath: "id",
  durability: "strict",
});

const TodoDatabaseVersion = IndexedDbVersion.make(TodoTable);

export class TodoDatabase extends IndexedDbDatabase.make(
  TodoDatabaseVersion,
  Effect.fn(function* (api) {
    yield* api.createObjectStore("todo");
  }),
) {}

export const databaseLayer = (databaseName = "converge-react-todos") =>
  TodoDatabase.layer(databaseName);

/**
 * @category event handler
 */
export const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const db = yield* TodoDatabase.getQueryBuilder;
    const todos = db.from("todo");

    yield* todos.insert(event.eventDetails);
  }),
);

/**
 * @category event handler
 */
export const todoCompletionSetHandler = EventHandler.make(
  todoCompletionSet,
  Effect.fn(function* (event) {
    const db = yield* TodoDatabase.getQueryBuilder;
    const todos = db.from("todo");

    const todo = yield* todos.select().equals(event.eventDetails.id).first();

    yield* todos.upsert({
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
    const db = yield* TodoDatabase.getQueryBuilder;
    const todos = db.from("todo");

    yield* todos.delete().equals(event.eventDetails.id);
  }),
);

export const todoHandlers = [todoCreatedHandler, todoCompletionSetHandler, todoDeletedHandler];
