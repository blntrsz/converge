# Sync protocol

HTTP routes exposed by `converge/primary-sync-engine` (`httpPrimarySyncEngineRoutes`). Mount at a base path (e.g. `/api/sync` in the React example).

All wire events use this shape:

```json
{ "eventId": "...", "eventType": "...", "eventDetails": { } }
```

## `GET /pull`

Pull accepted events after a cursor.

| Query | Type | Description |
|-------|------|-------------|
| `cursor` | eventId (optional) | Resume after this event. Omit for first page. |

Response (has more pages):

```json
{ "data": [ /* WireEvent[] */ ], "hasNext": true, "cursor": "<last eventId in page>" }
```

Response (last page):

```json
{ "data": [ /* WireEvent[] */ ], "hasNext": false }
```

Events are ordered by primary `event_history.id`. The cursor is always an eventId, resolved server-side to an event history id.

## `POST /push`

Submit one or more events for primary acceptance.

Request:

```json
{ "events": [ /* WireEvent[] */ ] }
```

Response — array of results, one per input event:

```json
{ "ok": true, "event": { /* WireEvent */ } }
```

```json
{ "ok": false, "event": { /* WireEvent */ } }
```

`ok: true` means accepted (stored in primary event log, handler ran). `ok: false` means rejected.

## `GET /events/latest`

Returns the latest accepted event, or 404 if the log is empty.

## `GET /events/:eventId`

Returns a single accepted event by eventId, or 404.

## `GET /projection/:projection`

Bootstrap stream for a primary projection at a version sequence.

| Query | Type | Description |
|-------|------|-------------|
| `eventId` | eventId (required) | Sync position — primary resolves to event history id and returns snapshot rows where `since ≤ sequence` |

Response: `application/x-ndjson` — one JSON object per line, encoded by the projection's bootstrap schema.

## Client usage

The replica sync engine's `PrimarySyncEngine` client wraps these endpoints. Replicas never call them directly from application code — use `ReplicaSyncEngine.push`, `poke`, `checkout`, `setLatest`, and `repair`.
