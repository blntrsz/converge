# Accepted and Optimistic Projections

Frontend Projections are represented as an Accepted Projection plus an Optimistic Projection. Accepted Events from backend sync update the Accepted Projection exactly once and advance its Projection Cursor; local Proposed Events update only the Optimistic Projection. When an accepted or rejected Event resolves a local Proposed Event, the frontend rebuilds the Optimistic Projection from the Accepted Projection plus the remaining Proposed Events, avoiding duplicate application while preserving automatic rebase behavior.
