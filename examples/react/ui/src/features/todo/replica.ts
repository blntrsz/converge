import { TodoModel, type Type } from "@converge/react-core/todo/model";
import { Schema } from "effect";
import { indexeddbProjection } from "converge/react";
import { todoHandlers } from "./handlers";

const projectionStorageKey = "converge-react.todos";
const TodoListSchema = Schema.Array(TodoModel);

export const todoProjection = indexeddbProjection({
  databaseName: "converge-react-todos-projection",
  key: projectionStorageKey,
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Type>,
});

export const eventStoreConfig = {
  syncUrl: "/api/sync",
  handlers: todoHandlers,
  projections: [todoProjection],
  replicaDatabaseName: "converge-react-todos-replica",
} as const;
