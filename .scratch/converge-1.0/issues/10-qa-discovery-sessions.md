# Run QA sessions to discover bugs and expectation mismatches

Status: open
Type: task
GitHub: https://github.com/blntrsz/converge/issues/58

## Question

Execute structured `/qa` sessions before locking Playwright scenarios and cutting stable 1.0.

## Scope

- Owner exercises reference app (offline/online, push, poke, sync, optimistic UI, reload, multi-tab)
- Owner flags anywhere behavior diverges from mental model or `CONTEXT.md`
- Agent files durable GitHub issues per finding (user-focused, domain language)
- Output: triageable bug/expectation backlog for blocker decision ticket

## Blocked by

Nothing — can start immediately. Blocks Playwright scope lock and stable 1.0 cut.
