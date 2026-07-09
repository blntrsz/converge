# Converge

A library for building offline-first, event-sourced applications with primary/replica sync. The replica applies events optimistically locally; the primary is the source of truth for acceptance and rejection.

## Language

**Converge**:
An Effect-based library that composes event storage, sync engines, and projections into offline-first applications.
_Avoid_: Framework, platform

**Primary**:
The authoritative node that owns the event log and decides which events are accepted. One primary per sync domain.
_Avoid_: Server, backend, leader

**Replica**:
A local node that optimistically applies events and syncs with the primary. Many replicas can exist per primary.
_Avoid_: Client, frontend, follower

**Event**:
A named, versioned fact type — a schema defining what can happen, not a specific occurrence.
_Avoid_: Event type, message schema

**EventInstance**:
One recorded occurrence of an Event, identified by a unique **eventId** (CUID2, client-generatable, stable across primary and replica) and carrying a specific payload.
_Avoid_: Event record, message instance

**Replica projection**:
The replica's read surface — a reactive atom over replica storage that also merges in-memory optimistic state for Proposed Events. EventHandlers write storage on accept; the atom reflects persisted snapshot plus any pending optimistic updates. Used to bootstrap from a primary snapshot so the full event log need not be replayed. After bootstrap, the replica continues syncing from the pinned eventId onward.
_Avoid_: Read model, visible projection, cache, write model

**Event history id**:
The monotonic `event_history.id` assigned when the primary accepts an EventInstance. Defines acceptance order in the event log. Resolved from an eventId on the primary; not used as a wire reference.
_Avoid_: eventId, sync anchor, cursor, checkpoint, offset

**Sync position**:
The eventId shared across all projections on a replica. Marks where incremental event-log sync begins after bootstrap. One per replica. Always an eventId — the primary resolves it to an event history id for versioned reads.
_Avoid_: Per-projection cursor, eventHistoryId as wire id

**Sync mode**:
How the replica sync engine positions itself against the primary. **Latest** tracks the primary head and incrementally pulls new accepted events. **Checkout** pins a specific version sequence for time travel — bootstrap and reads reflect that sequence until the mode changes. Checkout is read-only: no push, poke is a no-op, optimistic updates are disabled. Returning to Latest re-bootstraps all projections to head, re-seeds `event_history` at the sync position eventId, and resumes normal sync.
_Avoid_: Live mode, replay mode, follow mode

**Primary storage**:
Versioned record storage on the primary. Each handler accept appends a new row with a `since` sequence. Bootstrap reads are anchored queries over this history.
_Avoid_: Write model, source table

**Version sequence**:
The monotonic position of an accepted EventInstance in the event log. Primary storage records are versioned with a `since` sequence; an anchored bootstrap read returns the latest record version per entity where `since` ≤ anchor sequence.
_Avoid_: Revision, generation, lamport clock

**Replica storage**:
Flat materialized storage on the replica. Bootstrap writes a decoded snapshot once; subsequent handler accepts overwrite in place. Keeps local data bounded — version history stays on the primary only.
_Avoid_: Client database, local cache, IndexedDB mirror

**Replica event log**:
The replica's local `event_history` of accepted EventInstances. Retains only the latest 100 events globally per replica; older events live on the primary only.
_Avoid_: Event store, full history, archive

**Verdict**:
The primary's accept or reject decision on a pushed EventInstance. On the wire: `{ ok: true }` is accepted, `{ ok: false }` is rejected.
_Avoid_: Validation result, success/failure, admission

**Accepted**:
A verdict where the primary stored the EventInstance. The replica persists it to the replica event log, runs the handler to write storage, and clears the optimistic update for that event from the replica projection atom.
_Avoid_: Committed, succeeded

**Rejected**:
A verdict where the primary refused the EventInstance. The replica clears the optimistic update for that event from the replica projection atom without writing storage.
_Avoid_: Failed, denied

**Optimistic update**:
In-memory tentative state for a Proposed Event, held inside the replica projection atom. On push, pure reduce functions (shared with replica handlers) apply the event optimistically. Never persisted; discarded on accept (after storage write) or reject.
_Avoid_: Optimistic overlay, pending state, draft projection

**Reduce function**:
A pure function `apply(snapshot, event) → snapshot` encoding how one EventInstance updates projection state. Shared by primary handlers (via versioned storage writes), replica handlers (flat storage on accept), and optimistic updates (on push). The unit of handler equivalence.
_Avoid_: Reducer, projector, event applier

**Proposed Event**:
An EventInstance the replica has applied optimistically but the primary has not yet accepted or rejected. Stored locally until the verdict arrives.
_Avoid_: Pending event, draft event, uncommitted event

**Push**:
Replica originates an EventInstance — applies it optimistically in memory, stores it as a Proposed Event, and enqueues a forward task to send it to the primary for verdict. Storage is not written until the event is accepted. Returns immediately after optimistic apply.
_Avoid_: Submit, send, publish

**Poke**:
Replica requests reconcile — enqueues a reconcile task that pulls accepted events from the primary since the last known position and applies them locally. On the first poke, bootstraps if not yet initialized. Returns immediately; pull happens in the background consumer.
_Avoid_: Sync, refresh, pull

**Repair**:
Recovery from a broken event chain (missing or out-of-order accepted events). Sync halts, then re-bootstraps all projections at the active sync mode's sequence and resumes. No partial repair.
_Avoid_: Resync, heal, rebuild

**Primary projection**:
A read-only projection on the primary, derived from primary storage updated by primary handlers. Replicas pull its snapshot on cold start to bootstrap local state without replaying history.
_Avoid_: Server read model, materialized view, cache

**Bootstrap**:
Hydrating a replica's projections from primary flat snapshots at the sync engine's active version sequence. Triggered on the first `poke`, when checking out an older version sequence, or when returning from Checkout to Latest. Each projection is fetched separately: `GET /projection/{projectionKey}?eventId=<eventId>`. Seeds `event_history` with the EventInstance at the sync position eventId so pull can resume from `lastEventId()` — handlers are not re-run for the seeded event; the imported snapshot already reflects it.
_Avoid_: Initial sync, full replay, migration

**Versioned projection**:
Primary storage keeps every version of each record keyed by `since` sequence. Bootstrap encodes a flat snapshot per projection at a sync position eventId: `GET /projection/{projectionKey}?eventId=<eventId>`. The primary resolves eventId to an event history id, queries `since ≤ sequence`, and returns a materialized snapshot for replica storage. New events between fetches do not affect a pinned read.
_Avoid_: Point-in-time read, historical snapshot

**Event log**:
The primary's append-only store of accepted EventInstances. The source of truth; projections and replicas are derived from it.
_Avoid_: Event store, database, table

**Primary handler**:
An EventHandler that runs on the primary, writing primary storage (e.g. Postgres). Separate from the replica handler for the same Event — different runtime, different storage backend.
_Avoid_: Server handler, backend handler

**Replica handler**:
An EventHandler that runs on the replica, writing replica storage (e.g. IndexedDB). Separate from the primary handler for the same Event — different runtime, different storage backend.
_Avoid_: Client handler, frontend handler

**Handler equivalence**:
Primary and replica handlers are separate implementations with different storage shapes (versioned vs flat), but the same event sequence must produce the same projection snapshot on both sides. Handlers must be idempotent — re-applying an event already reflected in storage is a no-op.
_Avoid_: Shared handler, identical handler

A replica hosts one or more replica projections. All replica projections share one replica event log and one sync position eventId.

## Sync engine

**Forward task**:
A persisted background task enqueued by `push`. Flushes all Proposed Events to the primary, applies verdicts locally, then pulls accepted events since the cursor held before the flush.
_Avoid_: Push callback, sync job, upload task

**Reconcile task**:
A persisted background task enqueued by `poke` or the periodic poll. Bootstraps at primary head if the replica has no event history yet, then pulls all accepted events since the last known position.
_Avoid_: Pull task, refresh job, sync-all

**Pending task**:
A durable row in replica storage (`pending_tasks`) representing work for the background consumer. Survives page reload.
_Avoid_: Job queue entry, sync queue item

**Pull cursor**:
The eventId query parameter on `GET /pull?cursor=`. Marks where paginated pull resumes — the last eventId the replica had applied when starting that pull. Distinct from sync position (which anchors bootstrap).
_Avoid_: Sync position, event history id, offset
