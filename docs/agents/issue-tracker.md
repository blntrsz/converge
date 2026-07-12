# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`, also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate label and state filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

External pull requests do not enter the issue triage queue. Pull requests remain normal code-review work.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: create one issue labelled `wayfinder:map`, holding Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child ticket**: create an issue and link it to the map as a GitHub sub-issue using the sub-issues API. If sub-issues are unavailable, add it to a task list in the map body and put `Part of #<map>` at the top of the child body. Apply one `wayfinder:<type>` label: `research`, `prototype`, `grilling`, or `task`.
- **Blocking**: use GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/blntrsz/converge/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-database-id>`, where the database id comes from `gh api repos/blntrsz/converge/issues/<number> --jq .id`. If dependencies are unavailable, use a `Blocked by: #<number>` line in the child body.
- **Frontier query**: list the map's open children, then exclude tickets with an open blocker or an assignee. The first remaining child in map order is the frontier.
- **Claim**: `gh issue edit <number> --add-assignee @me` is the session's first write.
- **Resolve**: post the answer as a resolution comment, close the ticket, and append a one-line gist with a named link to the map's Decisions-so-far.
