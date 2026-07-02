# Primary hosts persisted projections for replica bootstrap

Replicas cold-start by pulling a projection snapshot and sync anchor from the primary, then continue syncing incrementally from the event log. The primary maintains its own persisted projections (same abstraction as replicas) and exposes them over the sync API. Replicas never replay the full event history locally.

**Considered options:** on-demand snapshot materialization from the event log (rejected — too slow at scale), replay-from-genesis on every cold start (rejected — contradicts offline-first goals), separate read service (rejected — unnecessary complexity for now).

**Consequences:** the primary must run projection handlers alongside (or instead of) direct write-model mutations. The sync API gains a bootstrap endpoint. Primary and replica share the projection abstraction but may use different storage backends.
