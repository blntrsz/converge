# Issue tracker: Linear

Issues and PRDs for this repo live in the **Converge** project on Linear. Use the [Linear GraphQL API](https://linear.app/developers/graphql) for all operations.

## Authentication

Set `LINEAR_API_KEY` (personal API key from Linear → Settings → Security & access). All requests:

```bash
curl -sS -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  --data '{"query":"..."}'
```

Issue identifiers like `CON-42` work anywhere the API accepts an issue `id`.

## Scope

All skill operations target the **Converge** project. Resolve its id once per session:

```graphql
query {
  projects(filter: { name: { eq: "Converge" } }) {
    nodes {
      id
      name
      teams { nodes { id name key } }
    }
  }
}
```

Cache `projectId` and the team's `id` / `key` for the session. New issues need `teamId` (from the project team above) and `projectId`.

## Conventions

- **Create an issue**: `issueCreate` with `teamId`, `projectId`, `title`, `description` (markdown). Add triage labels via `labelIds`.
- **Read an issue**: `issue(id: "CON-42")` — fetch `identifier`, `title`, `description`, `labels`, `comments`, `children`, `relations`, `assignee`, `state`.
- **List issues**: filter by `project: { id: { eq: "<projectId>" } }` and optionally `labels: { name: { eq: "needs-triage" } }`.
- **Comment**: `commentCreate(input: { issueId, body })`.
- **Apply / remove labels**: `issueUpdate` with `labelIds` — **replaces** all labels, so read current labels first and merge.
- **Close / cancel**: `issueUpdate` with the team's `canceled` or `completed` `stateId` (resolve via `workflowStates` on the team).

### Read an issue (with comments)

```graphql
query Issue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    url
    createdAt
    updatedAt
    state { id name type }
    assignee { id name }
    labels { nodes { id name } }
    comments { nodes { body createdAt user { name } } }
    children { nodes { id identifier title state { type } assignee { id } } }
    relations {
      nodes {
        type
        relatedIssue { id identifier state { type } }
      }
    }
  }
}
```

### List open issues in Converge

```graphql
query($projectId: ID!) {
  issues(
    filter: {
      project: { id: { eq: $projectId } }
      state: { type: { nin: ["completed", "canceled"] } }
    }
    first: 50
    orderBy: createdAt
  ) {
    nodes {
      id
      identifier
      title
      labels { nodes { name } }
      createdAt
    }
  }
}
```

### Create an issue

```graphql
mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier title url }
  }
}
```

Variables: `{ "input": { "teamId": "...", "projectId": "...", "title": "...", "description": "...", "labelIds": ["..."] } }`

### Comment on an issue

```graphql
mutation($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id body }
  }
}
```

### Update labels (merge-safe pattern)

1. Read `issue.labels.nodes[].id`
2. Append or remove ids as needed
3. `issueUpdate(id: $id, input: { labelIds: $allIds })`

### Resolve label id by name

```graphql
query($name: String!) {
  issueLabels(filter: { name: { eq: $name } }) {
    nodes { id name }
  }
}
```

Create missing triage labels with `issueLabelCreate` on first use.

## Pull requests as a triage surface

Not applicable — work is tracked in Linear, not GitHub Issues. GitHub PRs remain for code review only.

## When a skill says "publish to the issue tracker"

Create a Linear issue in the **Converge** project.

## When a skill says "fetch the relevant ticket"

Run the issue query above for the given identifier (e.g. `CON-42`).

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a Linear issue in **Converge** labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body in its description.
- **Child ticket**: create with `parentId` set to the map's id. Add label `wayfinder:<type>` (`research` / `prototype` / `grilling` / `task`). Once claimed, set `assigneeId` to the driving dev.
- **Blocking**: `issueRelationCreate(input: { issueId: <child>, relatedIssueId: <blocker>, type: blocks })`. A ticket is unblocked when every blocking issue's `state.type` is `completed` or `canceled`. Fall back to a `Blocked by: CON-12, CON-34` line at the top of the description if relations aren't available.
- **Frontier query**: list the map's open children (`issue.children`), drop any with an open blocker (`relations` where `type` is `blocks` and related issue is not done) or an assignee; first in creation order wins.
- **Claim**: `issueUpdate` with `assigneeId` — the session's first write.
- **Resolve**: `commentCreate` with the answer, move to a completed/canceled state, then append a context pointer to the map description's Decisions-so-far section.
