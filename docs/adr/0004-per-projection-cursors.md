# Per-Projection Cursors

Each frontend Projection stores its own Projection Cursor because Projections can bootstrap at different Event History positions and may lag independently. During sync, the frontend sends all Projection Cursors and the backend streams accepted Events from the oldest cursor so each Projection can process Events in Event History order and advance independently, including across Events that do not change it. If the frontend detects a broken Event History chain during sync, it re-bootstraps all Projections rather than attempting partial repair in the MVP.
