import { IndexedDbTable } from "@effect/platform-browser";
import { TodoModel, type Type } from "@converge/react-core/todo/model";
import { Schema } from "effect";
import { indexeddbProjection } from "converge/react";
import { todoHandlers } from "./handlers";

const projectionStorageKey = "converge-react.todos";
const TodoListSchema = Schema.Array(TodoModel);

const TodoProjectionSnapshotRow = Schema.Struct({
  key: Schema.String,
  snapshot: Schema.Json,
});

export const TodoProjectionTable = IndexedDbTable.make({
  name: "todo",
  schema: TodoProjectionSnapshotRow,
  keyPath: "key",
  durability: "strict",
});

export const todoProjection = indexeddbProjection({
  databaseName: "converge-react-todos-projection",
  table: TodoProjectionTable,
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
