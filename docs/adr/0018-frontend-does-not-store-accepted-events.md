# Frontend Does Not Store Accepted Events

The frontend does not retain accepted Event History. It applies accepted Events to Accepted Projections, advances Projection Cursors, removes matching Proposed Events, and keeps unresolved Proposed Events for optimistic state. This keeps frontend persistence focused on current Projection state rather than duplicating the backend Event History.
