# converge

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.13. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## React projections

Projection services expose `query` and `mutation` over typed snapshots. In replica handlers, the provided projection dependency makes `mutation` optimistic, accepted, or rejected based on the current replica apply phase.

```ts
import { EventHandler } from "converge/event";
import { IndexedDbProjection, Projection } from "converge/projection";

class TodoProjection extends Context.Service<
  TodoProjection,
  Projection.IReactiveProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("TodoProjection") {}

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const todos = yield* TodoProjection;
    const apply = (snapshot: ReadonlyArray<Todo>) =>
      [[...snapshot, event.eventDetails], undefined] as const;

    yield* todos.mutation(apply);
  }),
);

const TodoProjectionLayer = IndexedDbProjection.indexedDbReplicaLayer(TodoProjection, {
  databaseName: "todo-projections",
  key: "todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
});
```

Use the handlers in `EventRouter.layer`, provide `ReplicaApplyContext.layer` to the replica sync engine, and provide the projection layer. Framework adapters can read the same projection service; React can subscribe directly with `useAtomValue(projection.atom)`.
