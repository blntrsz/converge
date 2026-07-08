# What is the 1.0 product boundary?

Status: resolved
Type: grilling
GitHub: https://github.com/blntrsz/converge/issues/46

## Question

What exactly ships at Converge 1.0?

## Answer

**Three deliverables, different maturity bars:**

| Piece | 1.0 bar |
|-------|---------|
| **`converge` npm library** | Published, stable public API, semver `1.0.0` on the stable channel |
| **React integration** | Documented stable entrypoints (`browserLayer`, atoms, projection hooks) — likely absorbing #28–#29 |
| **Reference todo example** | Reliable happy-path demonstrator (offline push/poke/sync, optimistic UI) — not a full feature showcase |

**Foundation capabilities in scope for 1.0:**

- **Playwright E2E tests** against the reference app
- **Real continuous CI/CD** — not ad-hoc scripts; gates on every merge
- **Feature flags** — iterate in production-like CD without shipping half-baked API surface
- **Changesets release flow:**
  - Every merge to main triggers an RC version and opens a release PR
  - Maintainer can **cut** a release from that PR to promote to the **stable** channel
  - Two npm channels: **unstable** (RC) and **stable** (cut releases)

**Maturity framing:** 1.0 is a solid, continuously-deliverable base — not a one-shot tag. The unstable channel carries iteration; stable channel is what adopters pin for production.

## Comments

- Resolved 2026-07-08 from grilling session with project owner.
