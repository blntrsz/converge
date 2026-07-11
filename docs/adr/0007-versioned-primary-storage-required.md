# Versioned primary storage is required

All Converge applications must use versioned primary storage — each handler accept appends a new row keyed by entity id with a `since` column set to the accepting event's event history id. Bootstrap queries use `DISTINCT ON` at an anchored sequence so Checkout and time travel return correct snapshots. Flat primary tables without version history are not supported.

**Considered options:** optional versioned storage for Latest-only apps (rejected — bootstrap anchoring is core to the sync model; flat tables break Checkout), on-demand snapshot materialization from the event log (rejected — too slow; see ADR 0002).

**Consequences:** primary handlers append version rows rather than updating in place. Applications use `PostgresPrimaryProjection.versionedTable` or equivalent anchored bootstrap queries. The React example must use versioned storage.
