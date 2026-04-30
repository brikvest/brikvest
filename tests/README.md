# Brikvest test suite

Automated coverage for the demo seed and the Developer Portal API.

## Stack

- **Test runner:** [Vitest](https://vitest.dev/) (configured in `vitest.config.ts` at the repo root).
- **HTTP testing:** [`supertest`](https://github.com/ladjs/supertest) talking
  to an in-process Express app built by `tests/setup-app.ts`.
- **Database:** the same Postgres pointed to by `DATABASE_URL`.  Tests that
  create scratch data namespace it with the prefix `__brikvest_test__`
  (emails, project names, admin username) and clean it up in `afterAll`.

## Running

```bash
npx vitest run                          # the whole suite
npx vitest run tests/seed.integration.test.ts
npx vitest run tests/developer-api.test.ts
npx vitest run tests/developer-smoke.test.ts
```

The suite uses forks with `singleFork: true` so the in-process Express
app (built by `tests/setup-app.ts` via `registerRoutes`) is shared across
files.

### Database isolation (recommended)

`vitest.config.ts` sets `NODE_ENV=test` for every test process.  When
that is true, `server/db.ts` reads `TEST_DATABASE_URL` instead of
`DATABASE_URL`, giving you a fully isolated test database.

```bash
# Provision a second Postgres database (e.g. on Neon / Replit DB) and
# point the suite at it:
export TEST_DATABASE_URL="postgres://user:pass@host:5432/brikvest_test"
npx vitest run
```

When `TEST_DATABASE_URL` is set, `tests/global-setup.ts`:

1. runs `drizzle-kit push --config=drizzle.config.ts` against
   `TEST_DATABASE_URL` so the schema is up to date,
2. truncates every `public.*` table with `TRUNCATE … RESTART IDENTITY
   CASCADE` so the suite starts from a known-empty state.

### Fallback (shared `DATABASE_URL`)

If `TEST_DATABASE_URL` is not set, the suite falls back to
`DATABASE_URL` and prints a warning.  In this mode each suite scopes its
own cleanup:

- API/smoke tests namespace their fixtures with the `__brikvest_test__`
  prefix (emails, project names, admin username) and remove them in
  `afterAll` via `cleanupAllTestData()`.
- The seed test wipes the two demo projects (and their child rows)
  before re-running the seed so counts are deterministic.

> **Expected residue in fallback mode:** the admin take-over test
> reuses a single fixture row (`__brikvest_test_admin__`) in
> `admin_users` because that row is not visible to
> `cleanupAllTestData()` (it lives outside the `users` table).
> This is intentional and the test re-uses or refreshes its password on
> each run.  Use `TEST_DATABASE_URL` for a fully clean run.

## What is covered

### `tests/seed.integration.test.ts`

Spawns `npx tsx scripts/seed-demo-developer.ts` in a child process (so its
`process.exit(0)` doesn't kill vitest) and asserts the resulting database
state:

- demo developer exists with `role=developer`, `accountStatus=approved`,
  and a populated `companyName`,
- both demo projects exist, with the right `salesStage` and unit counts,
- 6 milestones per project with sortOrder `0..5`,
- expected reservation totals (50 units confirmed for Lekki, 91 units for
  Maitama; matching funnel breakdown),
- 3 project updates per project,
- 13 approved + 3 pending payment submissions,
- the seed is **idempotent**: re-running it doesn't change any of the
  counts above.

> Before running the seed, the test wipes the two demo projects (and
> their child rows) so assertions are deterministic even if a stale or
> partial seed already exists in the shared dev database.  The demo
> developer + investor users are left in place because the seed already
> upserts them.

### `tests/developer-api.test.ts`

Hits every `/api/developer/*` route through `supertest`:

- **Auth** — anonymous access is 401, regular users are 403, real
  developers can log in and reach `/api/developer/me` (with the password
  scrubbed from the response).
- **Project CRUD** — create draft → list (with rollup fields) → patch →
  submit-for-approval state machine.  Validates `salesStage` enum and
  `developerEquityUnits` <= `totalUnits`.  Cross-developer isolation
  (developer B cannot read or mutate developer A's project).
- **Milestones** — full create / update / reorder (via `PATCH sortOrder`,
  which is what the drag-and-drop UI sends) / delete lifecycle.  Cross
  developer isolation on update + delete.
- **Investors / rollup / CSV** — confirmed reservation flows into
  `/investors`, `/rollup` (with NGN/USD/GBP equivalents) and `/notes`;
  CSV export carries the right `Content-Type`, `Content-Disposition`,
  header row and one data row per investor.
- **Project updates** — broadcast endpoint sanitises HTML (strips
  `<script>`), `recipientCount` reflects only confirmed investors,
  cross-project listing endpoint enriches each update with `propertyName`,
  empty subject/body returns 400.
- **Admin take-over** — provisions an admin user, logs into
  `/api/admin/login`, lists `/api/admin/developer-projects`, takes over
  a developer's project and asserts the original developer is locked out
  (403) afterwards.

### `tests/developer-smoke.test.ts`

A smoke test that walks each tab of the Developer Portal at the API
level — the same set of endpoints that the React tabs query — and
asserts the data shapes the UI binds to.

The Replit container has no browser binary installed, so a real
Playwright/Puppeteer smoke would fail at runtime.  When a browser image
is added later, swap this file for a Playwright spec along these lines:

```ts
import { test, expect } from "@playwright/test";

test("developer can navigate every tab", async ({ page }) => {
  await page.goto("/developer/login");
  await page.fill('input[name="email"]', "developer.demo@brikvest.net");
  await page.fill('input[name="password"]', "DemoDeveloper2026!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/developer\/dashboard/);
  for (const tab of [
    "Overview",
    "Fundraising",
    "Construction",
    "Sales",
    "CapTable",
    "Communications",
  ]) {
    await page.click(`text=${tab}`);
    await expect(page.getByTestId(`tab-${tab.toLowerCase()}`)).toBeVisible();
  }
});
```

## Test data hygiene

- All scratch records are namespaced with `__brikvest_test__` (emails,
  project names, admin username).
- `cleanupAllTestData()` in `tests/test-helpers.ts` deletes those rows
  and their related milestones, reservations, payment submissions,
  updates and notes in `afterAll`.
- The demo seed is **never deleted** by tests — re-running the seed test
  is idempotent and verifies that property.
