# Brikvest workspace port review

## Scope and review boundary

This is the existing Brikvest application moved into the multi-app workspace.
It is **not** the isolated checkout app and does not authorize production
Flutterwave activation, schema rollout, publishing, or investor mail.
The owner must review this port before the separate checkout work begins.

## What was retained

- Existing frontend, appearance, CSS, fonts, favicon, logos, image assets and
  URLs; the original query client and API request layer remain in use.
- Custom investor/developer/contractor authentication and separate admin
  sessions; no authentication replacement.
- Existing routes, payment/manual-transfer interlocks, explicit admin approval,
  legal exact-PDF review boundaries and portfolio calculations.
- The original database module and connection selection, with no replacement
  or migration. Runtime schemas retain the existing Zod 3/Drizzle versions.
- All schema source files, rollout scripts, prepared review documents, tests
  and project memory. Prior project context is in `legacy-project-context.md`.
- Saved production/development Flutterwave off switches, legal dispatch pause,
  and startup/post-merge maintenance fences.
- LibreOffice, PDF text utilities, Liberation/DejaVu fonts and Chromium runtime
  requirements. The current Nix package name is `poppler-utils` rather than the
  original channel's `poppler_utils`; no document conversion was run.

The frontend is `artifacts/brikvest`; the backend is
`artifacts/api-server/src`. Shared browser-safe code is in
`lib/brikvest-shared/src`, separately from database connection code.
Compatibility symlinks preserve the original root `client`, `server` and
`shared` paths, plus backend-relative `shared` and `scripts` imports.

The app is large (189 directly registered routes, plus separately registered
route modules). Its existing fetch/query layer was deliberately retained
instead of rewriting every caller to generated hooks.

## Startup safety

**The real backend was not started.** Inspection found one-shot reservation
repairs, recurring reservation/resale cleanup and worker registration.
The saved startup-maintenance skip is not a general timer/worker pause.

For owner review, the API artifact's **development** command runs a deliberately
minimal fixture backend. It imports no real application modules, has no database
connection, rejects every non-read request with 503, marks responses
`X-Brikvest-Fixture: synthetic-only`, and explicitly rejects unconfigured reads.
Property lists are empty synthetic fixtures, not a view of live inventory.
Real sign-in and account actions are intentionally unavailable in this preview.
Browser tests replace API responses with synthetic investors, properties and
holdings. This temporary review support is not a checkout product.

Production build/run still compile and run the actual backend with the
existing legal-font wrapper. The API retains `/api`, `/objects` and the
server-rendered `/guzape.html` path. No build or startup DDL was introduced.
Post-merge setup installs dependencies only; the former rollout script is
preserved as `scripts/post-merge-legacy.sh` and is never called automatically.

Vite now owns the development static server, so the original private legal
source-file boundary is also applied there, using Connect-compatible requests.
Private source URLs, encoded paths and workspace `/@fs` paths were checked.

## Verification performed

All checks below used local synthetic data, mocked services or source-only
comparison. No real database queries, provider API calls or mail dispatches
were used.

- 107 isolated checks passed across the existing payment, schema/off-switch,
  exact-PDF, PDF-safeguard, recorded holding-basis, portfolio and resale-area
  suites, plus migration-specific checks.
- Byte/hash comparisons verified every original frontend source file except
  three targeted router/import adaptations; every backend file except its
  startup/static-serving adapters; all shared/schema sources, assets, prepared
  documents and rollout scripts except the intentionally install-only
  post-merge hook; and all original tests except its adapted hook assertion.
- The complete real backend import graph compiled in memory without executing
  application code. This verifies module resolution, **not safe live startup**.
- 56 browser cases passed on desktop/mobile: payment-proof submission,
  unresolved checkout/repayment interlocks, explicit admin review, native
  legal signing with synthetic responses, offered land area, FAQs, footer and
  navigation. Public and sign-in URLs rendered without application exceptions.
- Desktop/mobile screenshots showed the existing branded home page.
- Four private legal-source URL variants returned 404. The fixture API's
  write guard returned 503.

Commands used:

```sh
pnpm exec vitest run --config vitest.port.config.ts
pnpm exec vitest run --config vitest.flutterwave.config.ts
pnpm exec vitest run --config vitest.legal.config.ts tests/legal-pdf-review.test.ts tests/legal-pdf-safeguard-plan.test.ts tests/legal-portfolio-basis.test.ts
pnpm exec vitest run --config vitest.portfolio.config.ts
pnpm exec vitest run --config vitest.resale-area.config.ts
pnpm exec playwright test --config playwright.port.config.ts
```

### Known browser-test limitation

The existing `legal-frozen-holding-basis.browser.spec.ts` failed in both viewport
projects: its `getByText("Recorded Basis Estate", { exact: true })` selector
matches three visible elements before the holding-card assertion can run.
That test and the dashboard/portfolio components it exercises were copied
unchanged. The 25 portfolio calculation checks and eight recorded land-basis
checks passed. This unrelated selector issue was not changed by the port.
The complete combined browser run therefore reports **54 passed, 2 failed**;
the added public/sign-in navigation run reports **2 passed**.

## Deliberately not verified

Real-backend startup, live sign-in, real account mutations, actual checkout,
mail delivery and real document/converter output were not exercised. These
would cross the task's data/payment/legal safety boundary. No generic DB push,
schema modification, seeding, holding change or deployment was performed.
Type-check cleanup and pre-existing product bugs remain out of scope.

The scaffold's pinned Vite download was blocked by the package firewall.
The available current Vite and compatible React plugin were installed without
bypassing the firewall; the existing React 18, Tailwind 3 and validation runtime
families were retained.
