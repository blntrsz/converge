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

## React replica projections

Replica projection services expose `query` over typed snapshots. Replica handlers write through a companion store; the provided store dependency makes `update` optimistic, accepted, or rejected based on the current replica apply phase.

```ts
import { EventHandler } from "converge/event";
import { IndexedDbReplicaProjection, ReplicaProjection } from "converge/projection";

class TodoProjection extends Context.Service<
  TodoProjection,
  ReplicaProjection.IReactiveReplicaProjection<
    ReadonlyArray<Todo>,
    ReplicaProjection.ReplicaProjectionStorageError
  >
>()("TodoProjection") {}

class TodoProjectionStore extends Context.Service<
  TodoProjectionStore,
  ReplicaProjection.IReplicaProjectionStore<
    ReadonlyArray<Todo>,
    ReplicaProjection.ReplicaProjectionStorageError
  >
>()("TodoProjectionStore") {}

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const todos = yield* TodoProjectionStore;
    const apply = (snapshot: ReadonlyArray<Todo>) =>
      [[...snapshot, event.eventDetails], undefined] as const;

    yield* todos.update(apply);
  }),
);

const TodoProjectionLayer = IndexedDbReplicaProjection.indexedDbReplicaLayer(TodoProjection, {
  databaseName: "todo-projections",
  key: "todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
  store: TodoProjectionStore,
});
```

Use the handlers in `EventRouter.layer`, provide `ReplicaApplyContext.layer` to the replica sync engine, and provide the replica projection layer. Framework adapters can read the projection service; React can subscribe directly with `useAtomValue(projection.atom)`.

## React replica event store

```ts
import { EventHandler } from "converge/event";
import { EventStoreProvider, indexeddbProjection, useEventStore } from "converge/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";

const todoProjection = indexeddbProjection({
  key: "todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
});

const todoCreatedHandler = EventHandler.make(todoCreated, Effect.fn(function* (event) {
  const store = yield* todoProjection.store;
  yield* store.update((todos) => [[...todos, event.eventDetails], undefined] as const);
}));

export const eventStoreConfig = {
  syncUrl: "/api/sync",
  handlers: [todoCreatedHandler],
  projections: [todoProjection],
};

function TodoList() {
  const { commit } = useEventStore();
  const commitEvent = useAtomSet(commit, { mode: "promise" });
  const todos = useAtomValue(todoProjection.atom);
  // await commitEvent(EventInstance.make(todoCreated, todo))
  // await commitEvent(Effect.gen(function* () { const todo = yield* TodoModel.make({ title }); return yield* EventInstance.make(todoCreated, todo) }))
}

<EventStoreProvider config={eventStoreConfig}>
  <TodoList />
</EventStoreProvider>
```

`EventStoreProvider` activates projections, pokes on mount, and reconciles when the browser comes back online.
