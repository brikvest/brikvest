# Brikvest structural port safety

This workspace contains the existing Brikvest product, not the separate test
checkout app. The original project context is preserved in
`docs/legacy-project-context.md`. Original `server`, `client` and `shared` paths
remain compatibility symlinks for the retained scripts and tests.

The development database contains real investor data. Never run a generic
schema push, seed, migration, holding repair, document generation, mail dispatch
or provider call as part of structural verification. Saved Flutterwave off
switches and legal dispatch/maintenance holds must remain in place.

The API artifact's **development** workflow runs only the isolated fixture API.
It imports no real backend modules, rejects all writes, and labels responses
`X-Brikvest-Fixture: synthetic-only`. This is for port review only and is not the
queued checkout application. The real backend must not be started for review:
startup registers recurring business-record cleanup independent of the one-shot
maintenance skip. Production build/run still compile and run the real backend,
using the existing custom auth, database connection and legal font wrapper.

Post-merge setup installs dependencies only and retains the saved database skip
fence; the original legacy rollout script is retained for reference, not invoked.
No deployment or new checkout implementation is authorized by this port.

# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
