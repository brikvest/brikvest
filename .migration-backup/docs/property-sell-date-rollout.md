# Property Sell date rollout

Sell date is informational only. It is a nullable PostgreSQL `date`, exposed as
`YYYY-MM-DD` (not a timestamp). Admin requests may omit it (preserve on update),
send a real date, or send `null` to clear it. Developer requests cannot set or clear it.

## Required ordering

1. Merge the prepared changes into the release branch.
2. Before starting/publishing the new server, have the database operator run
   `scripts/ensure-property-sell-date.sql` on the intended database, or explicitly
   run `npx tsx scripts/ensure-property-sell-date.ts` with that target configured.
   Do not run generic schema push. Verify target identity before executing.
3. Confirm `public.properties.sell_date` is nullable and of type `date`.
4. Publish/restart the new code only after that prerequisite is present.

The existing development database holds live user data: do not use it for tests.
This task does not apply the migration to it. The migration adds one nullable
column with no default and no backfill. Rerunning it is safe; old server releases
can ignore the column. Code rollback should leave the additive column intact.

Isolated regression checks use disposable in-memory PostgreSQL (PGlite) and
mocked API/browser fixtures. They never start the application's backend or workers.

## Verification commands

- `npm run test:sell-date` — isolated schema, persistence, and actual-route tests.
- `npm run build` — production client/server bundles.
- Start the frontend only with
  `npx vite --config vite.legal.config.ts --host 0.0.0.0 --port 5173 --strictPort`.
  Then run
  `LEGAL_FRONTEND_ONLY_BASE_URL=http://127.0.0.1:5173 npm run test:sell-date:browser`.
  Every browser API request is intercepted; external origins are blocked.
  Do not use the grouped application workflow for this isolated check.
