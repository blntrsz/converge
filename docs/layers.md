# Layer composition

Converge integrates exclusively through Effect `Layer` wiring. See [ADR 0008](./adr/0008-effect-layers-as-public-api.md).

## Primary (server)

Minimal stack from `examples/react/api`:

```typescript
import { EventRouter, PostgresEventLog } from "converge/event";
import {
  HttpPrimarySyncEngine,
  PostgresPrimaryProjection,
  PostgresPrimarySyncEngine,
  PrimaryProjection,
} from "converge/primary-sync-engine";

const PrimaryLayer = Layer.mergeAll(
  PostgresPrimarySyncEngine.layer,
  PrimaryProjection.layer({ projections: [versionedTodos] }),
).pipe(
  Layer.provideMerge(EventRouter.layer({ handlers })),
  Layer.provideMerge(PostgresEventLog.layer),
  Layer.provideMerge(sqlMigrationsLayer),
);

const routes = HttpPrimarySyncEngine.routesLayer({ prefix: "/api/sync" }).pipe(
  Layer.provideMerge(PrimaryLayer),
);
```

Primary handlers append versioned storage rows. Projections use `PostgresPrimaryProjection.versionedTable` for anchored bootstrap.

## Replica (browser)

One-liner from `examples/react/ui`:

```typescript
import { IndexedDbReplicaSyncEngine } from "converge/replica-sync-engine";

const { layer, runtime, atom } = IndexedDbReplicaSyncEngine.browserLayer({
  handlers: replicaHandlers,
  projection: [TodoProjection],
  primary: {
    baseUrl: "/api/sync",
    projections: [{ key: TodoProjection.key, rowSchema: TodoModel.json }],
  },
});
```

`browserLayer` wires IndexedDB replica storage, HTTP primary client, projection router, event router, and background sync consumer. Subscribe to `atom` for UI state.

## Tests

Integration tests compose layers directly without `browserLayer`. See `packages/converge/tests/` for PGlite primary stacks and fake-indexeddb replica stacks.

## Further reading

- [Architecture](./architecture.md)
- [Sync protocol](./sync-protocol.md)
- `examples/react/` — end-to-end reference app
