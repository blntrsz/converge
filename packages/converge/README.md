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

`Projection.make` lets apps provide typed Converge event reducers while the library owns snapshot storage, validation, subscriptions, and React reads.

```ts
const todos = Projection.make({
  initialValue: [] as ReadonlyArray<Todo>,
  storage: Projection.localStorage(TodoListSchema, { key: "todos" }),
  reducers: [
    Projection.reducer(todoCreated, (snapshot, event) =>
      Effect.succeed([...snapshot, event.eventDetails]),
    ),
  ],
});
```

Use `todos.handlers` in an `EventRouter.layer`. In React, wrap the app with `ProjectionRegistryProvider` and read with `useProjection(todos)`. Internally the projection snapshot is an Effect `AtomRef` exposed as an Effect Atom, so React subscribes through `@effect/atom-react` while reducers remain Effect programs.
