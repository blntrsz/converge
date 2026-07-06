# Converge React Example

This example is a small Bun workspace with three packages:

- `core`: shared vertical slices. The todo slice owns event definitions, schemas, and pure projection updates.
- `api`: the Effect HTTP primary. It owns API routes and primary-side todo storage/handlers.
- `ui`: the React replica. It owns the React screen, IndexedDB replica runtime, and development proxy.

To install dependencies:

```bash
bun install
```

To start local development from this folder:

```bash
bun dev
```

`bun dev` starts both packages:

- UI: `http://localhost:3000`
- API: `http://localhost:3001`

The UI server proxies `/api/*` to the API server, so browser code uses same-origin URLs
such as `/api/sync`.

To typecheck:

```bash
npm run typecheck
```

To run the production-style servers:

```bash
bun start
```
