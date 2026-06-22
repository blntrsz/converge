# Converge

Converge is a general-purpose sync engine for offline-first applications. It uses event sourcing as the shared model for changes that move between frontend and backend.

## Language

**Converge**:
A general-purpose sync engine for offline-first applications that uses event sourcing as the shared model for changes between frontend and backend.
_Avoid_: Coverage

**Event**:
An immutable record of an application change that Converge persists locally, syncs between frontend and backend, and uses to build projections.
_Avoid_: operation, mutation, action

**Event ID**:
A globally unique identifier for one Event. The Event ID is created when a Proposed Event is recorded on the frontend and is preserved if the backend accepts the Event.
_Avoid_: correlation ID

**Previous Event ID**:
The Event ID of the accepted Event that immediately precedes an Event in the same Event History. The first accepted Event in an Event History has no Previous Event ID.
_Avoid_: parent event ID

**Tail Event ID**:
The latest accepted Event ID known to the frontend when a Proposed Event is recorded. During Acceptance, the accepted Event's Previous Event ID may differ from the Proposed Event's Tail Event ID if other Events were accepted first.
_Avoid_: base event ID

**Event History**:
The authoritative sequence of backend-accepted Events for an application scope. In single-tenant applications there is one Event History; in multi-tenant applications there is one Event History per tenant.
_Avoid_: event log

**Proposed Event**:
An Event recorded on the frontend that has affected local state but has not yet been accepted or rejected by the backend.
_Avoid_: pending event, unconfirmed event, tentative event

**Proposed Event Processor**:
Application-owned logic for one Event type that validates a Proposed Event, may consult external state, updates the backend Projection, and either succeeds so Converge accepts the Event or fails so Converge rejects it.
_Avoid_: acceptance handler, event handler

**Acceptance**:
The backend process that validates a Proposed Event, applies it to the backend Projection, and makes it part of the Event History if that process succeeds.
_Avoid_: confirmation, approval, commit

**Projection**:
Syncable application state derived from Events. A frontend Projection may include Proposed Events, while a backend Projection includes only accepted Events.
_Avoid_: real state, view state

**Accepted Projection**:
Frontend Projection state derived only from accepted Events received from the backend. A Projection Cursor belongs to the Accepted Projection.
_Avoid_: confirmed state

**Optimistic Projection**:
Frontend Projection state derived from an Accepted Projection plus current local Proposed Events. The UI reads from Optimistic Projections.
_Avoid_: local state

**Projection Cursor**:
The latest accepted Event ID that a specific frontend Projection has processed. Each Projection advances its own Projection Cursor as it processes accepted Events from Event History, including Events that do not change that Projection.
_Avoid_: sync cursor

**Projection Bootstrap**:
The initial frontend state for a Projection at a known Projection Cursor. After applying a Projection Bootstrap, the frontend receives accepted Events after that Projection Cursor and updates its Projection by applying them in Event History order.
_Avoid_: snapshot
