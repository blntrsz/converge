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

### Define a projection

`ReplicaProjection.define` returns a self-describing token with projection service, auto-generated store, and reactive atom helper:

```ts
import { Schema } from "effect";
import { ReplicaProjection } from "converge/projection";

const TodoListSchema = Schema.Array(TodoModel);

export const TodoProjection = ReplicaProjection.define({
  key: "converge-react.todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
});
```

Handlers use `TodoProjection.store`; React subscribes via `todosAtom` from `browserLayer`.

### Browser replica stack

`IndexedDbReplicaSyncEngine.browserLayer` wires event router, IndexedDB projection, replica sync engine, and HTTP primary client:

```ts
import { IndexedDbReplicaSyncEngine } from "converge/replica-sync-engine";

export const { layer, runtime, atom: todosAtom } = IndexedDbReplicaSyncEngine.browserLayer({
  handlers: todoHandlers,
  projection: [TodoProjection],
  primary: { baseUrl: "/api/sync" },
});
```

Database names are derived from projection keys; no manual layer composition needed.
