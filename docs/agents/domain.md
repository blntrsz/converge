# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repository root.
- **`docs/adr/`** for decisions touching the area being explored.

If either location does not exist, proceed silently. The domain-modeling skill creates domain artifacts lazily when terms or decisions are resolved.

## File structure

Converge is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── packages/
```

## Use the glossary's vocabulary

When output names a domain concept in an issue title, design, hypothesis, or test, use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent, reconsider whether it belongs to the domain or note the gap for domain modeling.

## Flag ADR conflicts

Surface any conflict with an existing ADR explicitly rather than silently overriding it.
