# Auto-repair when replica sync consumer tasks fail

When the replica sync engine's background consumer fails while processing a forward or reconcile task, it automatically invokes `repair()` — re-bootstrapping all projections at the active sync mode's version sequence — before continuing. Explicit `repair()` remains available for callers.

**Considered options:** fail silently and retry the task (rejected — broken event chains can leave projections inconsistent), surface error to caller only (rejected — no caller is awaiting the consumer), partial repair of individual projections (rejected — risks cross-projection inconsistency).

**Consequences:** transient network or handler errors may trigger a full re-bootstrap, which is expensive but safe. Logs emit warnings on task failure and errors if repair itself fails.
