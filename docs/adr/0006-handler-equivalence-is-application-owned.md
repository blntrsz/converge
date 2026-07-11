# Handler equivalence is application-owned, not library-enforced

Primary and replica handlers are separate implementations with different storage backends and shapes (versioned on primary, flat on replica). The library wires them through `EventRouter` and `ReplicaApplyContext` phases but does not verify that both sides produce the same projection snapshot for the same event sequence. Applications share reduce functions and prove equivalence in their own tests.

**Considered options:** shared `Reduce` type both handlers must implement (rejected — fights different storage adapters), runtime replay diff between primary and replica (deferred — useful dev tooling, not a library contract), single shared handler (rejected — primary and replica storage shapes differ).

**Consequences:** handler bugs surface as replica/primary drift, not compile errors. Application code must extract shared logic into pure reduce functions and test both handler paths. The React example (`examples/react/core`) demonstrates the pattern.
