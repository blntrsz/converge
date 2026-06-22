# Rejected Events Not Persisted In MVP

Converge does not persist rejected Proposed Events in the MVP. A rejection is returned to the frontend so it can remove the Proposed Event and rebuild Optimistic Projections from Accepted Projections plus remaining Proposed Events. If a rejection response is lost and the frontend retries, the backend may reprocess the Proposed Event.
