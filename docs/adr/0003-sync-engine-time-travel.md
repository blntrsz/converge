# Sync engine time travel via sequence checkout

The replica sync engine operates in two modes controlled by the client. **Latest** tracks the primary head — bootstrap and pull use the current version sequence, and the engine incrementally syncs new accepted events. **Checkout** pins a specific version sequence for time travel — bootstrap fetches flat projection snapshots materialized at that sequence, and the engine does not advance until the client returns to Latest or checks out a different sequence.

The client picks the active sequence; there is no dedicated sync-anchor negotiation endpoint. Bootstrap requests pass the checked-out sequence (resolved to an eventId on the wire as needed). Primary storage remains fully versioned by `since` sequence; replicas materialize flat snapshots only at the chosen sequence.

**Considered options:** dedicated `/sync-anchor` endpoint (rejected — couples bootstrap to server-driven head), per-projection anchors (rejected — risks inconsistent replay across projections), replica-side version history (rejected — too much data on the frontend).

**Consequences:** the sync engine gains mode state and a checkout API. Bootstrap, pull cursor, and projection reads must all respect the active sequence. Handler idempotency remains required when reconciling after a mode switch.
