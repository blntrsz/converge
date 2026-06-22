# Append-at-Tail Rebase

Converge accepts Proposed Events by appending them after the current Event History tail, even when the Proposed Event was recorded against an older Tail Event ID. The Proposed Event Processor receives both the Proposed Event's Tail Event ID and the current latest accepted Event ID, so application code can reject stale proposals when an Event type requires strict concurrency. This favors offline-first sync progress by default while preserving an application-level escape hatch for stricter invariants.
