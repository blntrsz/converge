# Effect Layers are the public integration API

Converge exposes no imperative setup facade or framework-agnostic entry point. All integration — primary sync engine, replica sync engine, projections, event routing — is composed via Effect `Layer` wiring. Convenience helpers like `IndexedDbReplicaSyncEngine.browserLayer` still return a `Layer` plus an `AtomRuntime`; they do not hide Effect from callers.

**Considered options:** imperative `createReplica({ ... })` facade for non-Effect consumers (deferred — duplicates surface area), hiding Effect behind a custom framework wrapper (rejected — fights how the library is built).

**Consequences:** application authors need basic Effect Layer familiarity. Composition patterns live in `docs/layers.md` and the React example. A future facade may appear for ergonomics but Layers remain canonical.
