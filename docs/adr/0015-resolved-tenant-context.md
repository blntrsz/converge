# Resolved Tenant Context

In multi-tenant mode, Converge receives Proposed Events inside a tenant context already resolved by the application and auth layer. Converge does not infer tenant routing from Event payload fields, and payload tenant-like fields are application data rather than authoritative routing metadata.
