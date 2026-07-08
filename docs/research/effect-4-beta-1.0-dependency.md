# Effect 4 beta as a Converge 1.0 dependency

**Question:** Is it acceptable to ship Converge `1.0.0` on `effect@4.0.0-beta.85`?

**Recommendation:** **No — do not ship Converge as semver `1.0.0` on Effect 4 beta.** Effect’s own guidance treats v4 as pre-production, explicitly warns that beta releases may break APIs, and has not announced a GA date. Converge’s surface area sits heavily on `effect/unstable/*` modules (SQL, Schema/Model, HTTP, Reactivity/Atom), which carry additional breaking-change risk even after Effect 4 GA. If Converge must publish before Effect 4 GA, ship **`1.0.0-beta.0`** (or stay on `0.x`) with `peerDependencies` on `effect@^4.0.0-beta.85` and a prominent Effect-beta caveat in the README.

---

## 1. Effect 4 GA timeline / roadmap

| Fact | Source |
|------|--------|
| Effect v4 entered **public beta on 2026-02-18**. | [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/) |
| **No GA date or milestone is published.** The team says they will “take the time we need” and will publish a v3 maintenance schedule “as v4 approaches its stable release.” | [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/) |
| v4 development lives in **Effect-TS/effect-smol**; issues/PRs for v4 go there. | [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/), [effect-smol repo](https://github.com/Effect-TS/effect-smol) |
| Beta cadence remains high: `effect@4.0.0-beta.94` shipped **2026-07-07** (~4.5 months after launch). | [effect@4.0.0-beta.94 release](https://github.com/Effect-TS/effect-smol/releases/tag/effect%404.0.0-beta.94) |
| Once v4 stabilizes, it is intended to be a **long-term stable (LTS)** major. | [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/) |
| **For production today, Effect recommends v3.** | [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/) |

**Implication for Converge:** There is no primary-source signal that GA is imminent. Planning a “stable” Converge 1.0 on Effect beta is a bet against official guidance, with no timeline to resolve the dependency risk.

---

## 2. Breaking-change risk: beta.85 → GA (and beyond)

### Official beta contract

- “**This is a beta. We'll iterate quickly, and beta releases may include breaking changes.**” — [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/)
- “**APIs may change between beta releases.**” — [MIGRATION.md](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)
- “**Effect v4 is still in beta, so breaking changes may occur.**” — [Feb–May recap](https://effect.website/blog/effect-v4beta-launch-to-may-recap/)

### Observed churn (primary evidence)

Recent beta history shows non-trivial API movement, not just bug fixes:

| Change | When (approx.) | Source |
|--------|----------------|--------|
| `ServiceMap` renamed back to `Context` | April 2026 | [TWIE 2026-04-10](https://effect.website/blog/this-week-in-effect/2026/04/10/), [changelog #1961](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/CHANGELOG.md) |
| Many Schema/HTTP/RPC renames and removals (`makeUnsafe`↔`make`, `Schema.Codec.ToAsserts` removed, etc.) | Feb–May 2026 | [Feb–May recap](https://effect.website/blog/effect-v4beta-launch-to-may-recap/) |
| `Config.make` no longer exported; `Config.nested` path semantics changed | beta.84 | [CHANGELOG](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/CHANGELOG.md) |
| `SchemaError` / adapter failure behavior normalized | beta.84 | [CHANGELOG](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/CHANGELOG.md) |
| `UrlParams.makeUrl` → `Url.make` | beta.93 | [CHANGELOG](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/CHANGELOG.md) |
| `Schema.Void` semantics changed | beta.89 | [CHANGELOG](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/CHANGELOG.md) |

Between **beta.85 and beta.94** (9 releases in ~3 weeks), changelog entries are mostly labeled “Patch Changes,” but they still include API moves and behavior changes that can force consumer updates.

### Converge-specific exposure

Converge imports from unstable namespaces that Effect documents as higher-churn:

- `effect/unstable/sql`, `effect/unstable/sql/Migrator`
- `effect/unstable/schema` (`Model`)
- `effect/unstable/http`
- `effect/unstable/reactivity/*` (`Atom`, `AtomRegistry`, `AtomRef`, `AsyncResult`)

Effect’s unstable contract: “**Modules under `effect/unstable/*` may receive breaking changes in minor releases**” (even after GA). — [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/), [MIGRATION.md](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)

**Implication:** Pinning Converge 1.0 to `beta.85` does not freeze Effect’s API. Users on `^4.0.0-beta.85` can resolve newer betas automatically and may hit churn without a Converge semver signal.

---

## 3. Peer dependency / semver policy for beta releases

### Effect ecosystem pattern (published packages)

`@effect/platform-browser@4.0.0-beta.85` publishes:

```json
"peerDependencies": { "effect": "^4.0.0-beta.85" }
```

— verified from [npm registry](https://www.npmjs.com/package/@effect/platform-browser/v/4.0.0-beta.85) (package manifest).

Effect enforces **unified versioning**: all ecosystem packages share one version and must be bumped together. — [MIGRATION.md](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md), [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/)

### npm semver behavior for prereleases

Per [npm/node-semver](https://github.com/npm/node-semver#prerelease-tags):

- Prerelease versions are excluded from ranges **unless** the range itself includes a prerelease tag.
- `^4.0.0-beta.85` resolves to `>=4.0.0-beta.85 <5.0.0-0` **within the beta prerelease line** (e.g. beta.86–beta.94 satisfy; verified with `semver -r "^4.0.0-beta.85"`).
- **`4.0.0` stable does not satisfy `^4.0.0-beta.85`.** Consumers must explicitly bump off the beta line at GA.

**Implication for Converge 1.0:**

| Approach | Semver honesty | Upgrade path at Effect GA |
|----------|----------------|---------------------------|
| `peerDependencies: { "effect": "^4.0.0-beta.85" }` | Signals beta coupling | Requires deliberate peer bump + likely Converge release |
| `peerDependencies: { "effect": "^4.0.0" }` | Misleading while Effect is beta-only | Would not install any current Effect 4 package |
| Pin exact `4.0.0-beta.85` | Maximum lock-in | Maximum migration pain at GA |

Converge should mirror Effect’s pattern (`^4.0.0-beta.N`) if staying on beta, and add `@effect/sql-pg`, `@effect/platform-browser`, etc. at the **same** beta version.

---

## 4. Alternatives

### A. Wait for Effect 4 GA (preferred for true `1.0.0`)

**Pros:** Aligns with Effect’s production recommendation; semver `1.0.0` honestly means “stable platform + stable Converge API.”

**Cons:** No published ETA; Converge release blocked on upstream.

**When to choose:** Converge’s goal is a production-grade, semver-stable library for general adopters.

### B. Ship `1.0.0-beta.0` on Effect beta (preferred if publishing now)

**Pros:** Semver communicates that Converge’s *own* API may be stable while the **platform is not**; matches Effect’s beta posture.

**Cons:** Adopters must accept beta churn; still need to track Effect releases.

**When to choose:** Converge API is ready to commit, but Effect 4 is not.

### C. Ship `1.0.0` with beta caveat only (not recommended)

**Pros:** Marketing simplicity.

**Cons:** Violates semver expectations and Effect’s own production guidance; downstream users may install `^4.0.0-beta.85` and auto-resolve newer breaking betas; at GA, peer range won’t resolve to stable without a breaking Converge release anyway.

### D. Stay on `0.x` until Effect GA

**Pros:** Strongest semver signal for pre-stable platform.

**Cons:** Delays “1.0” narrative.

---

## Decision matrix

| Criterion | Ship `1.0.0` on beta.85 | Ship `1.0.0-beta` on beta.85 | Wait for Effect GA |
|-----------|-------------------------|------------------------------|--------------------|
| Matches Effect production guidance | No | Partial (explicit beta) | Yes |
| Honest semver for adopters | No | Yes | Yes |
| Effect API freeze assumed | Yes (incorrectly) | No | Yes (at GA) |
| Unstable-module risk acknowledged | No | Yes (document) | Partial (unstable remains) |
| Time to publish | Now | Now | Unknown |

---

## What Converge 1.0 should do

1. **Do not release Converge `1.0.0` while `effect` is `4.0.0-beta.*`.** Effect has not declared GA, recommends v3 for production, and reserves the right to break beta APIs.
2. **If shipping before Effect GA:** release **`1.0.0-beta.0`** (or `0.x`) with:
   - `peerDependencies`: `effect@^4.0.0-beta.85` (and matching beta peers for `@effect/sql-pg`, `@effect/platform-browser`, etc.)
   - README callout linking [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/) and unstable-module policy
   - CI pinned to the same beta line; plan a GA follow-up release that bumps peers to `^4.0.0`
3. **If Converge API is not yet frozen:** stay on `0.x` until both Converge API and Effect GA are ready.
4. **At Effect 4 GA:** cut Converge `1.0.0` (or `1.0.0` if already on beta train), bump peers to `^4.0.0`, re-verify unstable imports, and document any remaining `effect/unstable/*` usage as explicitly unstable for consumers.

---

## Sources

- [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/) — beta status, production guidance, unstable modules, LTS intent
- [Effect v4 Beta: February–May Recap](https://effect.website/blog/effect-v4beta-launch-to-may-recap/) — ongoing breaking changes, ecosystem velocity
- [This Week in Effect — 2026-04-10](https://effect.website/blog/this-week-in-effect/2026/04/10/) — `ServiceMap` → `Context` breaking rename
- [MIGRATION.md (effect-smol)](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md) — beta API churn warning, unified versioning, unstable modules
- [packages/effect/CHANGELOG.md](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/CHANGELOG.md) — per-release changes (beta.84–beta.94)
- [effect@4.0.0-beta.94 release](https://github.com/Effect-TS/effect-smol/releases/tag/effect%404.0.0-beta.94) — latest beta at research time (2026-07-07)
- [@effect/platform-browser@4.0.0-beta.85 (npm)](https://www.npmjs.com/package/@effect/platform-browser/v/4.0.0-beta.85) — published peer dependency pattern
- [npm/node-semver — Prerelease tags](https://github.com/npm/node-semver#prerelease-tags) — how `^4.0.0-beta.N` ranges resolve
