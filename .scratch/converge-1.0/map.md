# Wayfinder map: Converge 1.0

GitHub map: https://github.com/blntrsz/converge/issues/45

## Destination

A mature Converge 1.0 that adopters can rely on: publishable library with stable public API, enforced quality gates (CI, Playwright E2E, unit/integration tests), complete documentation, and a reference application where primary/replica offline-first sync works reliably end-to-end — shipped through continuous CI/CD with unstable (RC) and stable release channels.

## Notes

- **Domain:** Converge offline-first event-sourced sync library — see [`CONTEXT.md`](../../CONTEXT.md)
- **Skills per session:** `/grilling`, `/domain-modeling`; `/research` for Effect ecosystem; `/prototype` for API ergonomics
- **Planning mode:** tickets produce **decisions**, not deliverables
- **Existing work:** open issues [#27](https://github.com/blntrsz/converge/issues/27), [#28](https://github.com/blntrsz/converge/issues/28), [#29](https://github.com/blntrsz/converge/issues/29) — reconcile after API-surface ticket
- **Release tooling:** Changesets; RC on merge; cut release to promote to stable channel
- **Delivery:** feature flags for safe iteration under continuous delivery

## Decisions so far

- [What is the 1.0 product boundary?](issues/01-product-boundary.md) — Library + React integration + reference example ship at 1.0 (different maturity bars). Playwright E2E, real CI/CD, Changesets with RC-on-merge and cut-to-stable, unstable + stable npm channels, and feature flags are all in scope for the 1.0 foundation.
- [What does "everything works as expected" mean for 1.0?](issues/02-acceptance-criteria.md) — Behavior must match domain model and owner-validated expectations, not just pass today's tests. QA discovery before locking Playwright; stable cut blocked until blocker bugs fixed and core flows reconciled.

## Not yet specified

- Playwright E2E coverage scope (locked after QA discovery)
- Bug severity taxonomy and stable-cut blocker bar
- Feature-flag mechanism and what gets flagged at launch
- Changesets channel naming, cut-release workflow, and RC promotion rules
- Test coverage targets beyond E2E; real Postgres vs PgLite for production story
- Documentation beyond README (CHANGELOG, migration guide, API reference)
- Example app completeness: rejection UX, checkout/repair/time-travel demo
- Build/compile strategy for published artifacts
- LICENSE and contribution guidelines
- Semantic versioning policy post-1.0
- Performance or load testing requirements
- How implementation issues #27–29 gate 1.0 vs run in parallel

## Out of scope
