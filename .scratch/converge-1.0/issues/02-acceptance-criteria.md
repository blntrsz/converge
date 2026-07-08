# What does "everything works as expected" mean for 1.0?

Status: resolved
Type: grilling
GitHub: https://github.com/blntrsz/converge/issues/47

## Question

What acceptance criteria define "everything works as expected" for 1.0?

## Answer

**1.0 means behavior matches expectations — not merely that today's tests pass.**

The product currently has bugs and may not match the owner's mental model of how Converge should work. Green CI on the current codebase is necessary but not sufficient. Tests and Playwright scenarios must encode *correct* expected behavior, not regress existing bugs.

### Three layers of "works"

| Layer | What it means |
|-------|---------------|
| **Domain correctness** | Behavior aligns with [`CONTEXT.md`](../../CONTEXT.md) terminology and documented sync/projection semantics |
| **Owner-validated expectations** | Core flows manually verified; expectation mismatches discovered and resolved (fix or document as known limit) |
| **Automated gates** | CI enforces the above once expectations are locked |

### Discovery before lock-in

Before Playwright scenarios and stable `1.0.0` cut are finalized:

1. **Structured QA sessions** (`/qa`) — owner exercises the reference app and library; bugs and "I expected X but got Y" gaps filed as issues
2. **Triage** — classify findings: blocker for stable cut vs deferrable vs doc-only
3. **Reconcile** — fix blockers, update tests to match corrected behavior, document accepted limits

### Automated green bar (once expectations are locked)

**Playwright (reference app):**
- Create todo offline → appears in UI → poke/sync → persists after reload
- Go online → primary accepts → second tab sees update

**Vitest (library):**
- Existing integration suite stays green
- Add real-Postgres integration test for primary path
- Reject path: primary rejects → replica clears optimistic overlay

**CI gates on every PR:**
- typecheck (packages + examples), vitest, playwright, fmt

### Stable 1.0 cut gate

A **stable** channel release is blocked until:

- QA discovery phase complete
- All **blocker** bugs fixed (blocker list is its own ticket)
- Playwright suite covers the locked happy-path expectations
- No open expectation mismatches on core sync flows without an explicit known-limit note

### Explicitly post-1.0 (not blockers)

- Checkout/repair/time-travel UI demo
- Multi-projection example
- Load/performance testing

## Comments

- Resolved 2026-07-08. Owner flagged that product has bugs and may mismatch expectations — incorporated as first-class acceptance concern.
