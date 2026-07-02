# Cap replica event history at 100 events

Replicas bootstrap state from a projection snapshot anchored to a specific eventId, then continue syncing incrementally from the event log. To bound local storage, the replica retains only the latest 100 accepted events globally in `event_history` (one rolling window per replica, not per projection). Older events remain on the primary; the replica never replays from genesis.

**Considered options:** unbounded local history (rejected — unbounded IndexedDB growth on long-lived clients), full log sync on every cold start (rejected — too slow for offline-first).

**Consequences:** the replica cannot reconstruct state by replaying its local log alone if the projection is lost — it must re-fetch a snapshot from the primary. Reconciliation logic must tolerate missing local history beyond the window.
