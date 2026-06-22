---
name: prime-issue
description: Prepare an issue for implementation.
disable-model-invocation: true
---

# Prime Issue

The input is one issue reference: a GitHub issue URL, tracker key, issue number, or pasted issue text.

Prime the issue, then stop. Do not implement, edit product code, or write tests during this skill.

## Workflow

1. **Read the issue.** Fetch or read the full issue body, title, comments needed for acceptance criteria, labels, and linked references. Completion criterion: the issue ID, title, acceptance criteria, explicit constraints, and unresolved questions are captured.
2. **Create the branch.** Check the current git status, preserve unrelated work, and check out a new branch named `<issue-id>-<title-in-kebab-case>`. Completion criterion: `git branch --show-current` returns the new branch name, or you have asked the user before reusing an existing branch or proceeding from an unsafe worktree.
3. **Read the parent context.** Read the PRD, parent issue, linked design doc, or epic referenced by the issue. If none is referenced, state that none was found. Completion criterion: every parent reference in the issue has been read or is listed as inaccessible.
4. **Load project context.** Read `CONTEXT.md` and the ADRs that govern the area named by the issue or parent context. Completion criterion: the plan uses project vocabulary and lists every ADR that constrains the work, or states that no relevant ADR was found.
5. **Explore the codebase.** Search for relevant public interfaces, tests, domain models, endpoints, commands, and package boundaries. Prefer `Glob`, `Grep`, and targeted reads. Completion criterion: the relevant existing files and contracts are mapped well enough to place the first red test.
6. **Load `/tdd`.** Apply its red-green-refactor guidance while planning. Completion criterion: each phase below is one vertical red-green-refactor cycle, not a horizontal batch of tests followed by implementation.
7. **Propose the plan and stop.** Present a multi-phase plan and ask for approval before implementation. Completion criterion: the user can approve, reject, or reorder phases without needing implementation detail.

## Plan Format

Use this shape:

```md
## Issue

- ID: <issue-id>
- Branch: <issue-id>-<title-in-kebab-case>
- Source: <issue URL or tracker key>
- Parent context: <PRD, parent issue, or none found>
- ADRs: <relevant ADRs or none found>

## Open Questions

- <questions that block or affect the first test>

## Relevant Map

- Existing tests: <files>
- Existing contracts: <public APIs, commands, endpoints, schemas, storage, events>
- Likely touchpoints: <files or directories>

## Phases

### Phase 1: <behavior name>

- RED: <the observable behavior test to write, including test file path>
- Expected failure: <high-level failure or stack trace shape proving the test is red>
- GREEN: <minimal capability that must exist, without implementation detail>
- REFACTOR: <cleanup or module-boundary check after green>
- File stack: <test file -> public contract -> likely implementation touchpoints>
- Contracts: <interfaces, schemas, events, CLI/API shapes, or projection behavior affected>

### Phase 2: <behavior name>

- RED: ...
- Expected failure: ...
- GREEN: ...
- REFACTOR: ...
- File stack: ...
- Contracts: ...
```

## Guardrails

- Keep each phase to one red-green-refactor cycle.
- Show the test to write, not the implementation.
- Show expected failure shape, not a fabricated exact stack trace unless the red test was actually run.
- Keep GREEN high level: describe the capability needed to pass, not how to build it.
- If the issue is too large, split the plan into the smallest approval-worthy vertical slices.
- If a blocker prevents branch creation or parent-context reading, stop and ask one concrete question.
