Use npm run typecheck for type checking.

Check ./CONTEXT.md for terminology questions.

# Packages to explore

You can explore dependencies that is added as git submodules in .agents/. (e.g. effect library in @.agents/effect-smol)

## Cursor Cloud specific instructions

- Runtime/package manager is **Bun** (installed at `~/.bun/bin`, on PATH via `~/.bashrc`). The root uses Bun workspaces; there is no npm/pnpm lockfile despite `npm run typecheck` being the canonical typecheck command.
- Root scripts (`package.json`): `npm run typecheck` (tsc over `packages/` only) and `bun run fmt` (oxfmt).
- Library tests: `packages/converge` uses vitest — `cd packages/converge && bun run test`. The suite spins up in-process Postgres (PGLite) + HTTP; it takes ~25s and is normal.
- Example app lives in `examples/react` (see its README for `bun dev`/`bun start`/build). `bun dev` runs the API (`http://localhost:3001`) and UI (`http://localhost:3000`) together; the UI proxies `/api/*` to the API. HTTP sync routes live under `/api/sync` (e.g. `GET /api/sync/pull`, `GET /api/sync/events/latest`).
- The primary uses **embedded PGLite** (no external database). Its data persists in `examples/react/.pglite` (gitignored). Delete that directory to reset primary/event-log state; the browser replica also keeps state in IndexedDB, so clear site data to fully reset a demo.
- Known pre-existing issue: `examples/react` per-workspace typecheck (`bun run typecheck` in `examples/react`) reports a type error in `api/src/http.ts`; this is unrelated to environment setup and does not block running the app (Bun executes TS directly).
