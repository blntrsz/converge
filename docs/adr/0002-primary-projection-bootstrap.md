# Primary hosts persisted projections for replica bootstrap

Replicas cold-start by pulling a projection snapshot and sync position eventId from the primary, then continue syncing incrementally from the event log. The primary exposes bootstrap queries over versioned storage (e.g. `PostgresPrimaryProjection.versionedTable`) — not separate materialized projection stores like replicas. Primary and replica share the bootstrap stream interface (`PrimaryProjectionConfig`); replicas additionally persist flat snapshots and reactive atoms. Replicas never replay the full event history locally.

**Considered options:** on-demand snapshot materialization from the event log (rejected — too slow at scale), replay-from-genesis on every cold start (rejected — contradicts offline-first goals), separate read service (rejected — unnecessary complexity for now).

**Consequences:** primary handlers write versioned storage; bootstrap materializes flat snapshots at query time. The sync API gains a bootstrap endpoint. Primary and replica may use different storage backends.
