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

Projection services expose `query`, `mutation`, and keyed `optimisticMutation` over typed snapshots. Accepted mutations persist; optimistic mutations stay in memory and are removed when the replica settles an accepted or rejected event.

```ts
import { EventHandler } from "converge/event";
import { IndexedDbProjection, Projection } from "converge/projection";
import { ReplicaApplyContext } from "converge/replica-sync-engine";

class TodoProjection extends Context.Service<
  TodoProjection,
  Projection.IReactiveProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("TodoProjection") {}

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const todos = yield* TodoProjection;
    const applyContext = yield* ReplicaApplyContext.ReplicaApplyContext;
    const { eventId, phase } = yield* applyContext.current;
    const apply = (snapshot: ReadonlyArray<Todo>) =>
      [[...snapshot, event.eventDetails], undefined] as const;

    if (phase === "optimistic") {
      yield* todos.optimisticMutation(eventId, apply);
    } else if (phase === "accepted") {
      yield* todos.mutation(apply);
      yield* todos.removeOptimisticMutation(eventId);
    } else {
      yield* todos.removeOptimisticMutation(eventId);
    }
  }),
);

const TodoProjectionLayer = IndexedDbProjection.indexedDbLayer(TodoProjection, {
  databaseName: "todo-projections",
  key: "todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
});
```

Use the handlers in `EventRouter.layer`, provide `ReplicaApplyContext.layer` to the replica sync engine, and provide the projection layer. Framework adapters can read the same projection service; React can subscribe directly with `useAtomValue(projection.atom)`.
