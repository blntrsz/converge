# Postgres As MVP Backend Store

The MVP uses Postgres as the authoritative backend store for Event History and backend Projections. This gives Converge a transactional consistency boundary for Acceptance while avoiding a premature abstraction over backend storage engines. Other backend stores may be considered later, but the MVP storage contract is Postgres-first.
