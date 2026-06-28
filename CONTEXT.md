# Converge

Converge is a general-purpose sync engine for offline-first applications. Applications describe changes as Event Types, create Event Instances, and synchronize accepted Events through a Primary Event History.

## Language

**Converge**:
A general-purpose sync engine for offline-first applications that uses event sourcing as the shared model for changes between replicas and a Primary.
_Avoid_: Coverage

**Primary**:
The authoritative sync role that accepts or rejects pushed Event Instances and serves the accepted Event History.
_Avoid_: backend, server, leader

**Replica**:
A non-authoritative sync role that can create local Event Instances, push them to the Primary, and pull accepted Events from Event History.
_Avoid_: secondary, client, frontend

**Event**:
The application change model that Converge syncs. Use Event Type for a declared kind of change and Event Instance for a concrete occurrence of that change.
_Avoid_: operation, mutation, action

**Event Type**:
A versioned name and details schema for one kind of application change, such as `todo.created.v1`.
_Avoid_: topic, operation type, mutation name

**Event Details**:
The application-owned data carried by an Event Instance and interpreted using its Event Type's schema.
_Avoid_: payload, body, arguments

**Event Instance**:
A concrete occurrence of an Event Type with an Event ID and Event Details. Event Instances are pushed to the Primary and are either accepted into Event History or rejected.
_Avoid_: event object, message, command

**Event ID**:
A globally unique identifier for one Event Instance. The Event ID is created before the Event Instance is pushed and is preserved if the Primary accepts it.
_Avoid_: correlation ID, database ID

**Event History**:
The authoritative ordered sequence of accepted Event Instances for an application scope.
_Avoid_: event log

**Event Cursor**:
An Event ID that marks a position in Event History for pulling accepted Events after that point.
_Avoid_: offset, page token, sequence number

**Proposed Event**:
A local Event Instance that has been created by a Replica but has not yet been accepted or rejected by the Primary.
_Avoid_: pending event, unconfirmed event, tentative event

**Accepted Event**:
An Event Instance that the Primary has appended to Event History.
_Avoid_: confirmed event, committed event

**Rejected Event**:
An Event Instance that the Primary does not append to Event History.
_Avoid_: failed event, invalid event

**Event Handler**:
Application-owned logic for one Event Type that validates or applies a pushed Event Instance during Acceptance. A handler failure rejects the Event Instance.
_Avoid_: listener, callback, reducer

**Event Router**:
The collection of Event Handlers used to choose the application-owned logic for each pushed Event Instance.
_Avoid_: dispatcher, registry

**Acceptance**:
The Primary outcome that records a pushed Event Instance in Event History after its Event Handler succeeds.
_Avoid_: confirmation, approval, commit

**Rejection**:
The Primary outcome that leaves a pushed Event Instance out of Event History because it cannot be accepted.
_Avoid_: failure, rollback

**Push**:
A sync request that sends Event Instances to the Primary for validation and possible Acceptance.
_Avoid_: upload, submit, commit

**Pull**:
A sync request that asks the Primary for accepted Events after an Event Cursor.
_Avoid_: download, fetch, sync

**Event Store**:
The storage boundary that holds Event History and retrieves accepted Event Instances.
_Avoid_: database, event log

**Projection**:
Application state derived from accepted Event Instances. Applications own their Projections; Converge syncs Events rather than arbitrary state.
_Avoid_: real state, view state, read model
