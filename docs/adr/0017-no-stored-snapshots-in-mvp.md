# No Stored Snapshots In MVP

The MVP does not model stored snapshots as separate artifacts. Initial frontend state is represented as a Projection Bootstrap at a Projection Cursor, and later sync proceeds through accepted Events. This avoids introducing snapshot storage, snapshot identity, and snapshot lifecycle concerns before the Projection Bootstrap model needs them.
