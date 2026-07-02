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
One recorded occurrence of an Event, identified by a unique eventId and carrying a specific payload.
_Avoid_: Event record, message instance

**Projection**:
A derived, queryable view of state built by applying EventInstances. Used to bootstrap a replica from a snapshot so the full event log need not be replayed. After bootstrap, the replica continues syncing from an anchor eventId onward.
_Avoid_: Read model, cache, database

**Sync anchor**:
The eventId marking where incremental event-log sync begins for a specific projection after its snapshot is applied. Each projection has its own sync anchor; a replica may host multiple projections sharing one replica event log.
_Avoid_: Cursor, checkpoint, offset

**Replica event log**:
The replica's local `event_history` of accepted EventInstances. Retains only the latest 100 events globally per replica; older events live on the primary only.
_Avoid_: Event store, full history, archive

**Verdict**:
The primary's accept or reject decision on a pushed EventInstance.
_Avoid_: Validation result, success/failure, admission

**Accepted**:
A verdict where the primary stored the EventInstance. The replica persists it to the replica event log and commits the projection mutation.
_Avoid_: Committed, succeeded

**Rejected**:
A verdict where the primary refused the EventInstance. The replica rolls back the optimistic projection mutation.
_Avoid_: Failed, denied

**Proposed Event**:
An EventInstance the replica has applied optimistically but the primary has not yet accepted or rejected. Stored locally until the verdict arrives.
_Avoid_: Pending event, draft event, uncommitted event

**Push**:
Replica originates an EventInstance — applies it optimistically, stores it as a Proposed Event, and forwards it to the primary for verdict.
_Avoid_: Submit, send, publish

**Poke**:
Replica requests reconcile — pulls accepted events from the primary since the last known position and applies them locally.
_Avoid_: Sync, refresh, pull

**Primary projection**:
A projection persisted on the primary, built from the full event log. Replicas pull it on cold start to bootstrap local state without replaying history.
_Avoid_: Server read model, materialized view, cache

**Bootstrap**:
Hydrating a replica's local projection from a primary projection snapshot plus sync anchor, then continuing incremental sync from the event log.
_Avoid_: Initial sync, full replay, migration

**Event log**:
The primary's append-only store of accepted EventInstances. The source of truth; projections and replicas are derived from it.
_Avoid_: Event store, database, table

**Primary handler**:
An EventHandler that runs on the primary, updating a server-side projection (e.g. SQL). Separate from the replica handler for the same Event — different runtime, different storage.
_Avoid_: Server handler, backend handler

**Replica handler**:
An EventHandler that runs on the replica, updating a client-side projection (e.g. IndexedDB). Separate from the primary handler for the same Event — different runtime, different storage.
_Avoid_: Client handler, frontend handler

**Handler equivalence**:
Primary and replica handlers are separate implementations, but the same event sequence must produce the same projection snapshot on both sides.
_Avoid_: Shared handler, identical handler

Each projection has its own sync anchor. A replica may host multiple projections, but all share one replica event log.
