# Handler authoring

Handlers react to accepted EventInstances. Primary and replica handlers are **separate implementations** for the same Event — the library does not enforce equivalence (see [ADR 0006](./adr/0006-handler-equivalence-is-application-owned.md)). Applications share logic via **reduce functions** and prove equivalence in tests.

## 1. Define Events

```typescript
import { Event } from "converge/event";

export const todoCreated = Event.make("todo.created.v1", TodoModel.fields);
```

Event type strings are versioned (`todo.created.v1`). Payload schemas live in shared application code (`examples/react/core`).

## 2. Write reduce functions

Pure functions encoding how one event updates projection state:

```typescript
export const applyCreated = (snapshot: Todos, todo: Todo) =>
  snapshot.some((t) => t.id === todo.id) ? snapshot : [...snapshot, todo];
```

Reduce functions are the unit of handler equivalence. Both sides must call the same reduces for the same event sequence.

## 3. Primary handler — versioned storage

Primary handlers run after the event is appended to the primary event log. Each accept **appends a new row** with `since` set to the accepting event's event history id. Never update rows in place.

```typescript
import { EventHandler } from "converge";
import { EventLog } from "converge/event";

export const todoCreatedHandler = EventHandler.make(todoCreated, (event) =>
  Effect.gen(function* () {
    const since = yield* resolveSince(event); // EventLog.resolveEventHistoryId
    yield* insertVersion(event.eventDetails, since);
  }),
);
```

Use `PostgresPrimaryProjection.versionedTable` for bootstrap queries. Deletes append tombstone rows (`deleted = true`) filtered at bootstrap time.

Handler failures roll back the transaction — the event is rejected.

## 4. Replica handler — flat storage via UpdateFn

Replica handlers write through `projection.store.update`. The update function receives the current snapshot and returns `[nextSnapshot, result]`:

```typescript
export const todoCreatedHandler = EventHandler.make(todoCreated, (event) =>
  Effect.gen(function* () {
    const store = yield* TodoProjection.store;
    yield* store.update((snapshot) => [
      applyCreated(snapshot, event.eventDetails),
      undefined,
    ]);
  }),
);
```

The replica projection atom merges persisted storage with optimistic updates automatically.

### Apply phases

The sync engine sets `ReplicaApplyContext` before running replica handlers:

| Phase | When | Storage effect |
|-------|------|----------------|
| `optimistic` | `push` — before primary verdict | Updates in-memory optimistic state only |
| `accepted` | Primary accepted; pull or forward flush | Writes flat replica storage |
| `rejected` | Primary rejected | Clears optimistic update; no storage write |

Handlers typically call the same reduce in all phases. The projection store routes based on phase — you do not branch on phase in handler code unless behavior must differ.

## 5. Wire handlers

```typescript
EventRouter.layer({ handlers: [createdHandler, ...] })
```

Register the same Event types on both primary and replica, with separate handler implementations.

## 6. Idempotency

Handlers must be safe to re-apply:

- **Primary:** `event_history` uses `ON CONFLICT (event_id) DO NOTHING`; handler skipped on duplicate.
- **Replica:** `applyLocally` no-ops if event already in replica event log.

Reduce functions should no-op when the event is already reflected (e.g. `applyCreated` checks for existing id).

## 7. Prove equivalence

Test both handler paths against shared reduces:

1. Push events through primary handlers; bootstrap projection at head.
2. Apply same events through replica handlers.
3. Assert identical snapshots.

See `packages/converge/tests/` for integration patterns.

## Reference

- `examples/react/core/src/todo/reduces.ts` — reduce functions
- `examples/react/api/src/todo/` — primary handlers + versioned storage
- `examples/react/ui/src/features/todo/handlers.ts` — replica handlers
