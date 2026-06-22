# Versioned Event Types

Event type strings are versioned, such as `order.created.v1`, and each version has its own schema and Proposed Event Processor registration. Any Event schema change creates a new Event type version, even when the change appears backward-compatible, so accepted Events are always decoded by the exact schema version named in their Event type.
