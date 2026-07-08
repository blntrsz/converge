# How do Changesets power unstable and stable release channels?

Status: open
Type: grilling
GitHub: https://github.com/blntrsz/converge/issues/55

## Question

Sharpen the Changesets release workflow:

- RC published on every merge to main — what triggers the release PR?
- **Cut** release: who acts, what promotes RC → stable?
- Channel naming on npm (`@rc`, `@next`, dist-tags)?
- Which packages are versioned together (monorepo changeset groups)?
- How does the first stable `1.0.0` cut relate to prior RCs?
