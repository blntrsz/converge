# Converge 1.0 on Effect `4.0.0-beta.85` — Research

**Date:** 2026-07-09  
**Question:** Is it acceptable to ship Converge at **1.0** while depending on Effect **`4.0.0-beta.85`**?

---

## Recommendation

**Do not ship Converge as `1.0.0` on Effect 4 beta.** Effect’s maintainers provide **no GA date**, explicitly warn that **beta releases may include breaking changes**, and Converge’s implementation is **deeply coupled to `effect/unstable/*` modules** (SQL, HTTP, reactivity, schema) whose stability contract explicitly allows breaking changes. A `1.0` semver tag signals a stable API contract that upstream cannot currently support.

**Preferred path:** ship **`1.0.0-beta.x`** (or stay on **`0.x`**) with documented Effect-beta requirements, exact peer pins matching the Effect ecosystem pattern, and reserve plain **`1.0.0`** for Effect 4 GA (or after Converge has decoupled from unstable surfaces). This matches precedent from other Effect-ecosystem libraries (Foldkit at `0.x`, LiteShip/@czap at pre-1.0 with `>=4.0.0-beta.0` peers).

---

## Converge’s Effect usage (repo snapshot)

### Version pinning

Root workspace catalog (`/workspace/package.json`):

| Package | Version |
|---------|---------|
| `effect` | `4.0.0-beta.85` |
| `@effect/platform-browser` | `4.0.0-beta.85` |
| `@effect/sql-pg` | `4.0.0-beta.85` |
| `@effect/sql-pglite` | `4.0.0-beta.85` |
| `@effect/atom-react` | `4.0.0-beta.85` |
| `@effect/vitest` (dev) | `4.0.0-beta.85` |

`packages/converge/package.json` pulls `effect` and `@effect/*` via `catalog:` as **direct dependencies**. It currently declares **no `effect` peer dependency** — only `typescript: ^5`. For a published library, Effect should be a peer (see [Peer dependency policy](#peer-dependency-policy)).

### Import surface

**Stable `effect` imports** (core runtime): `Effect`, `Layer`, `Context`, `Schema`, `Stream`, `Option`, `Result`, `Ref`, `HashMap`, `Semaphore`, `Config`, `String`, `Duration`, etc.

**`effect/unstable/*` imports in production `src/`** (highest breakage risk):

| Module | Used in | Role |
|--------|---------|------|
| `effect/unstable/sql` | `postgres-event-log`, `postgres-primary-sync-engine`, `postgres-primary-projection` | Postgres event log, migrations, queries |
| `effect/unstable/http` | `http-primary-sync-engine` | HTTP router, request/response |
| `effect/unstable/reactivity` | `replica-projection`, `browser-replica-sync-engine` | Atoms, AsyncResult, AtomRef for UI reactivity |
| `effect/unstable/schema` | `event-instance`, `event-router` | `Model` for event definitions |

**`@effect/platform-browser`**: IndexedDB layers for browser replica sync and projections.

Converge is not a thin wrapper around stable Effect primitives — sync engines, projections, and HTTP primary endpoints are built on **explicitly unstable** Effect APIs.

---

## 1. Effect 4 GA timeline / roadmap

### Official position: beta, no GA date

| Source | Finding |
|--------|---------|
| [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/) (2026-02-18) | “**This is a beta.** We'll iterate quickly, and beta releases may include breaking changes.” No calendar date for GA. |
| Same post | “Once v4 does stabilize, it will be a **long-term stable (LTS) release**… we'll take the time we need to get there.” |
| Same post | “We'll publish a maintenance schedule **as v4 approaches its stable release**” (schedule not yet published). |
| [Effect v4 Beta: February–May Recap](https://effect.website/blog/effect-v4beta-launch-to-may-recap/) (2026-05-28) | Beta launched 2026-02-18; “Effect v4 is **still in beta**, so breaking changes may occur.” |
| [Effect v4 Beta: June Updates](https://effect.website/blog/effect-v4beta-june-recap/) (2026-06-30) | Continued beta shipping; no GA mention. |
| [MIGRATION.md](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md) | “Effect v4 is currently in beta. **APIs may change between beta releases.**” |

### Development velocity (npm / GitHub)

| Metric | Value | Source |
|--------|-------|--------|
| Beta launch | 2026-02-18 | [40-beta post](https://effect.website/blog/releases/effect/40-beta/) |
| Latest beta (as of research) | `4.0.0-beta.94` | [npm `effect` dist-tags](https://www.npmjs.com/package/effect?activeTab=versions) (`beta` tag) |
| Converge pin | `4.0.0-beta.85` | `/workspace/package.json` catalog |
| Betas shipped | ~95 (`beta.0` → `beta.94`) in ~4.5 months | npm version history |
| `latest` dist-tag | `3.21.4` (Effect 3) | npm registry |

**Implication:** Effect 4 is actively evolving. There is no public signal that GA is imminent.

### v3 maintenance

The [40-beta post](https://effect.website/blog/releases/effect/40-beta/) states v3 continues maintenance after v4 stabilizes. The [Feb 2026 launch livestream](https://www.youtube.com/watch?v=eHVmHyo7ut0) (Effect team) notes v3 is on **feature freeze** (bug fixes / security only) while v4 is in beta, and that v4 will remain in beta “**however long we think it needs to be**” with no fixed timeline.

---

## 2. Breaking-change risk: beta.85 → GA

### Effect’s semver policy for v4

| Layer | Policy | Source |
|-------|--------|--------|
| **Entire beta phase** | “Beta releases **may include breaking changes**”; “do not assume stability between different beta versions.” | [40-beta post](https://effect.website/blog/releases/effect/40-beta/), [MIGRATION.md](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md), [launch stream](https://www.youtube.com/watch?v=eHVmHyo7ut0) |
| **`effect/unstable/*`** | “May receive breaking changes in **minor releases**” (even post-GA for unstable paths). | [40-beta post](https://effect.website/blog/releases/effect/40-beta/), [MIGRATION.md](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md) |
| **Non-unstable `effect/*`** | “Follow **strict semver** — no breaking changes until the next major version” (once GA). | [40-beta post](https://effect.website/blog/releases/effect/40-beta/) |
| **Ecosystem versioning** | All `@effect/*` packages share one version number; bump in lockstep. | [MIGRATION.md](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md) |

### Observed changes beta.85 → beta.94 (9 releases, ~3 weeks)

From [effect CHANGELOG](https://github.com/Effect-TS/effect-smol/blob/effect%404.0.0-beta.94/packages/effect/CHANGELOG.md) entries since beta.85:

| Version | Change relevant to Converge |
|---------|----------------------------|
| beta.93 | **`UrlParams.makeUrl` → `Url.make`**; returns `Url.UrlError` — HTTP API move |
| beta.94 | **`HttpApi.make` shape change** (stores identifier; starts with `{}` not `Map`) |
| beta.84 (just before pin) | **Config API overhaul** (`Config.make` no longer exported; `nested`/`orElse` behavior changes); **Schema error normalization** (`SchemaError` extends `TaggedError`; adapter behavior changes) |
| beta.86–92 | Schema, SQL, RPC, Cron fixes — mostly patch-level but behavior changes in Schema/Config |

Most beta.86–94 entries are labeled “Patch Changes” in the changelog, but **unstable modules are not bound by strict semver during beta**, and several changes are API moves (Url, HttpApi, Config) that would break consumers on those paths.

### npm semver note for peer ranges

Effect ecosystem packages publish peers like `"effect": "^4.0.0-beta.85"` (verified on [@effect/sql-pg@4.0.0-beta.85](https://registry.npmjs.org/@effect/sql-pg/4.0.0-beta.85)).

`^4.0.0-beta.85` **includes** `4.0.0-beta.94` and future `4.0.0` / `4.1.0`, but **excludes** older betas like `4.0.0-beta.84`. Libraries pinning `^4.0.0-beta.85` accept any newer beta until 4.0.0 stable — meaning consumers can float into API changes without a Converge release.

### GA transition risk

When `4.0.0` stable ships:

- Unstable modules may still break on minor releases.
- Converge would need a semver-major or explicit migration if unstable APIs change at graduation to `effect/sql`, `effect/http`, etc.
- Peer range should be updated from `^4.0.0-beta.N` to `^4.0.0` (pattern used by [@czap](https://libraries.io/npm/@czap%2Fcore) planning docs).

---

## 3. Peer dependency policy

### How Effect’s own packages declare peers

| Package | Peer on `effect` | Notes |
|---------|------------------|-------|
| `@effect/sql-pg@4.0.0-beta.85` | `^4.0.0-beta.85` | npm registry |
| `@effect/platform-browser@4.0.0-beta.96` | `workspace:^` in monorepo; published as matching beta caret | [effect-smol](https://github.com/Effect-TS/effect-smol) |

**Rule:** pin the **same beta minor** across `effect` and all `@effect/*` packages. Mismatched betas cause peer warnings and, worse, **duplicate `effect` installs** with runtime crashes (`TypeError: state.value.asEffect is not a function`). See [foldkit create-foldkit-app fix](https://github.com/foldkit/foldkit/commit/7354f7fc8a4b1bd348536382ba65807f68c9aa77).

### How other libraries handle Effect 4 beta

| Library | Version | Effect peer strategy | Implication for Converge |
|---------|---------|---------------------|--------------------------|
| [foldkit](https://github.com/foldkit/foldkit/blob/main/packages/foldkit/package.json) | `0.127.0` | **Exact pin:** `"effect": "4.0.0-beta.88"`, same for `@effect/platform-browser` | Stays pre-1.0; treats beta bumps as breaking (`chore!: bump Effect`) |
| [@czap/core / LiteShip](https://libraries.io/npm/@czap%2Fcore) | pre-1.0 | **Broad:** `>=4.0.0-beta.0`; docs require `effect@beta` install | Documents beta caveat; plans `^4.0.0` after GA |
| [adamantite](https://github.com/adelrodriguez/adamantite/issues/250) | app | Dependabot flagged **18 beta versions** of peer mismatch as P1 | Illustrates cost of drift |

### Recommended Converge peer declaration (if publishing on beta)

```json
{
  "peerDependencies": {
    "effect": "^4.0.0-beta.85",
    "@effect/platform-browser": "^4.0.0-beta.85",
    "@effect/sql-pg": "^4.0.0-beta.85"
  },
  "peerDependenciesMeta": {
    "@effect/sql-pg": { "optional": true },
    "@effect/platform-browser": { "optional": true }
  }
}
```

Move `effect` from `dependencies` to `peerDependencies`. Document that consumers must `npm install effect@beta` (not bare `effect`, which resolves to 3.x `latest`).

---

## 4. Alternatives

| Option | Pros | Cons | Fit for Converge |
|--------|------|------|------------------|
| **A. Wait for Effect 4 GA** | True `1.0` semver honesty; stable peer `^4.0.0`; aligns with [@czap stabilization plan](https://libraries.io/npm/@czap%2Fcore) | Unknown wait (no timeline); delays Converge release | Best if procurement requires non-beta runtime |
| **B. Ship `1.0.0-beta.x`** | Signals “feature-complete but upstream-unstable”; semver pre-release convention | Consumers must understand beta chain; still tied to Effect beta churn | **Recommended compromise** |
| **C. Ship `0.x` (e.g. `0.1.0`)** | Industry-standard “not stable yet”; matches [Foldkit](https://github.com/foldkit/foldkit) | Doesn’t communicate “ready” as strongly as 1.0-beta | Good if API still evolving |
| **D. Ship `1.0.0` on beta.85** | Marketing simplicity | **Misleading semver**; contradicts Effect’s beta disclaimer; unstable deps; forced Converge majors on Effect beta bumps | **Not recommended** |
| **E. Document beta caveat only** | Low friction | Insufficient without semver signal; doesn’t fix missing peer deps | Necessary but not sufficient |

### Suggested release messaging (options B or C)

1. README “Requirements”: `effect@4.0.0-beta.85` (or `effect@beta` with tested baseline).
2. Install snippet: `npm install converge effect@beta @effect/platform-browser@4.0.0-beta.85` (not bare `effect`).
3. Stability note: Converge API is stable; **Effect 4 beta and `effect/unstable/*` are not**.
4. Roadmap: Converge `1.0.0` (stable tag) when Effect `4.0.0` GA ships and Converge is verified against it.

---

## Risks summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| Effect beta breaking changes between releases | **High** | Pre-release semver; pin + test against specific beta; CI on `effect@beta` |
| `effect/unstable/*` API churn (Converge’s core deps) | **High** | Abstract unstable imports behind Converge-owned interfaces where possible; document unstable leakage |
| No GA timeline | **Medium** | Don’t promise 1.0 stability date; track Effect weekly recaps |
| npm `latest` = Effect 3.x | **Medium** | Peer + docs: `effect@beta`; validate in postinstall or CLI doctor |
| Duplicate `effect` installs from version skew | **High** | Exact peer alignment; lockfile guidance; optional `@effect/platform-node-shared` pin ([foldkit](https://github.com/foldkit/foldkit/commit/7354f7fc8a4b1bd348536382ba65807f68c9aa77)) |
| `1.0` semver mismatch with upstream beta | **High** | Use `1.0.0-beta.x` or `0.x` instead |

---

## Key facts (quick reference)

1. Effect 4 beta launched **2026-02-18**; **no GA date** published ([source](https://effect.website/blog/releases/effect/40-beta/)).
2. npm `latest` = **3.21.4**; `beta` = **4.0.0-beta.94** ([npm](https://www.npmjs.com/package/effect?activeTab=versions)).
3. Effect officially: beta releases **may break**; don’t assume stability between betas ([source](https://effect.website/blog/releases/effect/40-beta/)).
4. `effect/unstable/*` may break on **minors** even after GA ([source](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)).
5. Converge pins **beta.85** and uses unstable **sql, http, reactivity, schema** in production code.
6. Ecosystem peers use **`^4.0.0-beta.N`** with **lockstep** `@effect/*` versions ([npm @effect/sql-pg](https://registry.npmjs.org/@effect/sql-pg/4.0.0-beta.85)).
7. Peer precedent: Foldkit **0.x** + exact beta pin; @czap **pre-1.0** + `>=4.0.0-beta.0` + `effect@beta` docs.
8. Converge `package.json` lacks **`effect` peerDependency** today — should add before publish.

---

## Sources

- [Effect v4 Beta announcement](https://effect.website/blog/releases/effect/40-beta/)
- [Effect v4 Beta: February–May Recap](https://effect.website/blog/effect-v4beta-launch-to-may-recap/)
- [Effect v4 Beta: June Updates](https://effect.website/blog/effect-v4beta-june-recap/)
- [effect-smol MIGRATION.md](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)
- [effect CHANGELOG @ beta.94](https://github.com/Effect-TS/effect-smol/blob/effect%404.0.0-beta.94/packages/effect/CHANGELOG.md)
- [effect-smol GitHub releases](https://github.com/Effect-TS/effect-smol/releases)
- [npm effect package](https://www.npmjs.com/package/effect?activeTab=versions)
- [npm @effect/sql-pg@4.0.0-beta.85](https://registry.npmjs.org/@effect/sql-pg/4.0.0-beta.85)
- [Foldkit package.json](https://github.com/foldkit/foldkit/blob/main/packages/foldkit/package.json)
- [Foldkit duplicate effect install fix](https://github.com/foldkit/foldkit/commit/7354f7fc8a4b1bd348536382ba65807f68c9aa77)
- [Foldkit beta bump commit](https://github.com/foldkit/foldkit/commit/fcc7a94dfa4744a8766ca15db44d1210a2d18310)
- [@czap/core on npm (LiteShip)](https://libraries.io/npm/@czap%2Fcore)
- [LiteShip effect@beta docs commit](https://github.com/heyoub/LiteShip/commit/5ec11c5948e1cbf42eb8ea3bc0ca41927c368374)
- [Effect v4 beta launch stream](https://www.youtube.com/watch?v=eHVmHyo7ut0)
- Converge repo: `/workspace/package.json`, `/workspace/packages/converge/package.json`, `/workspace/packages/converge/src/**`
