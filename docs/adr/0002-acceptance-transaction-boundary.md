# Acceptance Transaction Boundary

For the MVP Postgres backend, Converge runs the Proposed Event Processor and the Event History write inside one Acceptance transaction. The application-owned processor may validate the Proposed Event and update the backend Projection, but the Event is written to Event History in the same transaction so Acceptance persists atomically: either the backend Projection update and Event History write both persist, or neither does.
