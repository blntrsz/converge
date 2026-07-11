# Persisted forward/reconcile task queue on the replica

Replica `push` and `poke` return immediately after optimistic apply and task enqueue — they do not block on primary verdict or pull completion. Work is durably stored in IndexedDB `pending_tasks` and drained by a scoped background consumer fiber. The consumer always flushes proposed events before pulling. Two task kinds exist: **forward** (flush, then pull since the pre-flush cursor) and **reconcile** (flush, bootstrap at head if uninitialized, then pull all events since last known position). Tasks survive page reload via recovery on startup.

**Considered options:** inline synchronous push/pull (rejected — blocks UI and loses crash safety mid-flight), in-memory queue only (rejected — work lost on reload), single undifferentiated sync task (rejected — forward needs a narrower pull scope to reconcile events accepted before local proposals).

**Consequences:** `push` contract is optimistic-only from the caller's perspective. Ordering between local proposals and remote acceptance is handled by forward-task cursor semantics (see replica-sync-engine tests). Consumer failures trigger automatic repair (see ADR 0005). A periodic poll enqueues reconcile tasks in Latest mode.
