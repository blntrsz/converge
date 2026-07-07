import { Effect, Stream } from "effect";
import { ReplicaProjection } from "converge/projection";
import { TodoListSchema, type Type } from "@converge/react-core/todo/model";

const sortTodos = (todos: ReadonlyArray<Type>) =>
  [...todos].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

export const TodoProjection = ReplicaProjection.define({
  key: "converge-react.todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Type>,
  bootstrap: (rows) =>
    rows.pipe(
      Stream.runCollect,
      Effect.map((snapshot) => sortTodos(Array.from(snapshot))),
    ),
});
