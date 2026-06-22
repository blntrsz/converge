# Event Sourcing As Shared Sync Model

Converge uses event sourcing as the shared model for changes that move between frontend and backend. Frontends record Proposed Events, the backend accepts Events into Event History, and Projections are derived from Events rather than from direct state writes. This keeps offline-first writes, backend Acceptance, and frontend sync centered on one durable change model.
