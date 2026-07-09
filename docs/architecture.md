# Architecture

Converge is an Effect-based library for offline-first, event-sourced applications with primary/replica sync. See [CONTEXT.md](../CONTEXT.md) for ubiquitous language.

## Components

```
┌─────────────────────────────────────────────────────────────────┐
│ Primary                                                         │
│  Event log (append-only) ──► Primary handlers ──► Primary       │
│  storage (versioned)              │                    projections│
│                                   │                    (bootstrap)│
│  Primary sync engine ◄──────────┘                             │
│    GET /pull, POST /push, GET /projection/:key                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP
┌───────────────────────────────▼─────────────────────────────────┐
│ Replica                                                         │
│  Replica sync engine                                            │
│    push ──► proposed_events + optimistic handler                │
│    poke ──► pending_tasks (reconcile)                           │
│    background consumer ──► forward / reconcile tasks            │
│                                                                 │
│  Replica event log (capped) ◄── accepted events from pull       │
│  Replica handlers ──► Replica storage (flat)                    │
│  Replica projections (atom = storage + optimistic updates)    │
└─────────────────────────────────────────────────────────────────┘
```

## Package layout

| Export | Role |
|--------|------|
| `converge/event` | Event schemas, handlers, router, Postgres event log |
| `converge/projection` | Primary and replica projection services |
| `converge/primary-sync-engine` | Primary sync API, versioned tables, HTTP routes |
| `converge/replica-sync-engine` | Push/poke/checkout/repair, IndexedDB replica engine |

All integration is via Effect `Layer` composition.

## Replica sync lifecycle

1. **Cold start** — consumer recovers persisted `pending_tasks`, enqueues an initial reconcile, starts polling.
2. **Push** — handler runs optimistically; event stored in `proposed_events`; a `forward` task is enqueued. Returns before primary verdict.
3. **Forward task** — flush proposed events to primary; on accept apply locally and append to replica event log; on reject run handler in rejected phase; pull events since cursor before flush.
4. **Poke / poll** — enqueue `reconcile` task. Reconcile bootstraps at head if uninitialized, then pulls all events since last known position.
5. **Checkout** — pin to a version sequence; push and poke are no-ops; projections bootstrap at the pinned eventId.
6. **Repair** — re-bootstrap all projections at the active sync mode sequence. Triggered explicitly or automatically when a consumer task fails.

## Handler equivalence

Primary and replica handlers are separate implementations wired through `EventRouter`. They must produce the same projection snapshot for the same event sequence — but the library does not enforce this. Applications own equivalence via shared reduce functions (see `examples/react/core`) and their own tests.

Replica handlers receive an apply phase (`optimistic`, `accepted`, `rejected`) via `ReplicaApplyContext`. Primary handlers write versioned storage; replica handlers write flat storage on accept only.

## Further reading

- [Sync protocol](./sync-protocol.md) — HTTP wire API
- [ADRs](./adr/) — architectural decisions
- [CONTEXT.md](../CONTEXT.md) — glossary
