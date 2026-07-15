# Fireclanker issue 27: publication concurrency implementation notes

Source issue: <https://github.com/blntrsz/fireclanker/issues/27>

This repository is `converge`, not `fireclanker`, so the Fireclanker runtime could not be changed in-place here. These notes capture the implementation contract needed by issue 27 for the Fireclanker codebase.

## Required publication state

For every repository in a Publication Plan, publication needs a journal entry that records:

- Publication Plan order.
- Target repository.
- Target base branch name.
- Base SHA observed immediately before publication.
- Expected one-commit head SHA after rebasing the prepared change.
- Deterministic Fireclanker branch name.
- Pull request identity, when known.
- Target metadata, including whether the pull request should remain draft or ready.

## Required publication algorithm

For each repository, in Publication Plan order:

1. Read the latest target branch SHA from GitHub immediately before publication.
2. Rebase the prepared one-commit change onto that SHA without rewriting any remote Fireclanker branch.
3. If the rebase is clean, verify that the rebased result is still exactly one commit ahead of the target base.
4. If the rebase conflicts, resume the existing Pi session in the same Job Workspace for one repository-specific resolution pass.
5. Verify the resolution, retry the rebase once, and fail publication if the target branch advanced again or the conflict remains unresolved.
6. Push only to the deterministic Fireclanker branch if doing so does not overwrite a conflicting remote branch.
7. Create or update the intended pull request while preserving target metadata and draft/ready state rules.
8. If push or pull-request writes return ambiguously, read GitHub state and reconcile the deterministic branch, expected head SHA, and pull-request identity before retrying or failing.

## Non-goals and safety rails

- Do not force-push.
- Do not start a replacement Pi runtime for conflict resolution.
- Do not rerun Pi from scratch.
- Do not create a second Fireclanker commit or pull request for the same intended publication.
- Do not overwrite a deterministic branch whose head is not the expected prior Fireclanker state.

## Deterministic test scenarios

The Fireclanker suite should include deterministic tests for:

- Clean movement of a target branch before publication.
- Rebase conflicts resolved by the same Pi session and Job Workspace.
- Rebase conflicts that remain unresolved after one pass.
- A second target-branch advance between rebase and publication.
- Ambiguous successful and failed branch pushes.
- Ambiguous successful and failed pull-request creates or updates.
- Duplicate wake-ups for the same publication.
- Multi-repository partial outcomes where earlier repositories are retained and later repositories are unattempted.
