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

Projection services expose typed read/write snapshots. Event handlers update projections through Effect DI, so one handler can write one or more projections and the sync engine receives ordinary Converge handlers.

```ts
class TodoProjection extends Context.Service<
  TodoProjection,
  Projection.IProjection<ReadonlyArray<Todo>, Projection.ProjectionStorageError>
>()("TodoProjection") {}

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const todos = yield* TodoProjection;
    const snapshot = yield* todos.get;
    yield* todos.set([...snapshot, event.eventDetails]);
  }),
);

const TodoProjectionLayer = Projection.indexedDbLayer(TodoProjection, {
  databaseName: "todo-projections",
  key: "todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
});
```

Use the handlers in `EventRouter.layer` and provide the projection layer to the sync engine. Framework adapters can read the same projection service; React uses `useProjection(projection)` over the service's Effect Atom.
