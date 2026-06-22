# No Proposed Event Status Model In MVP

The MVP does not model explicit Proposed Event statuses such as `syncing`, `accepted`, `rejected`, or `conflicted`. An unresolved Proposed Event remains in the local queue, and accepted or rejected Proposed Events are removed when backend sync resolves them. This keeps the frontend state model smaller until richer diagnostics or user-visible conflict handling are needed.
