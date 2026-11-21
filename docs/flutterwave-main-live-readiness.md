# Flutterwave main-project live readiness

## Current release boundary

The owner authorized production prerequisite preparation after confirming the
isolated checkout works. This record supersedes the earlier claim that main's
development database has no Flutterwave objects. It does not claim production
installation, publication, authenticated live-provider delivery or activation.

Do not enable collection until every release gate below is verified.
Do not make a real charge as a configuration test. Keep the separate sandbox
private, synthetic-only and on its dedicated test credentials.

## Completed in main development

- Confirmed separate platform targets: development `heliumdb` (PostgreSQL
  16.10), production `neondb` (16.16). Production access remained read-only.
- Installed only the approved six empty payment tables and the nullable
  `investment_reservations.cost_basis` JSONB column, with the existing reviewed
  payment and holding-cost guards. The transaction checked the development
  identity and first-install assumptions and used bounded lock/statement timeouts.
- Verified six payment tables, 48 columns, eight foreign keys, two attempt
  checks and enabled payment/holding-cost triggers. No cost-basis snapshots were
  adopted. User/reservation/certificate counts remained 75/83/11; zero existing
  holdings acquired a cost-basis classification.
- Main application startup and workers were not used for this installation.
  Development still runs the isolated fixture API. No business record,
  document, mail intent or provider checkout was created by the preparation.
- Separated collection gating from verification/reference recovery and external
  link closure. `FLW_ENABLED=false` now blocks new checkout creation without
  disabling recovery, provided the separately configured provider mode,
  live authorization and recovery switch remain valid.
- Added an explicit application-mail transport fence. A paused send returns
  failure rather than falsely recording successful delivery. Keep queue dispatch
  separately paused; this transport fence is not a maintenance lock or proof
  that pending retries cannot consume attempts.

## Saved production configuration (not proof of running adoption)

```text
FLW_ENABLED=false
FLW_LIVE_AUTHORIZED=false
FLW_WORKER_ENABLED=false
FLW_NOTIFICATION_DISPATCH=false
LEGAL_DISPATCH_PAUSED=true
BRIKVEST_EMAIL_DISPATCH_PAUSED=true
FLW_MODE=live
FLW_RETURN_ORIGIN=https://brikvest.net
FLW_CURRENCIES=NGN,USD,GBP,EUR
```

The live origin came from deployment metadata. Currency availability and
merchant approval were owner-reported, not independently established by a charge.
The existing `FLW_SECRET_KEY` and `FLW_SECRET_HASH` names are present in secure
settings; values were not read. Presence is not key validity.

Do not overwrite the dedicated `BRIKVEST_TEST_*` credentials or change the
sandbox runtime fence. V3 hosted Standard uses the server secret and webhook
hash, not a browser public key.

## Actual managed publication review

After the authorized development changes, the publishing diff contained:

- Six `CREATE TABLE` statements for the approved payment tables, including the
  expected primary/unique/check constraints.
- Eight foreign-key additions to the intended reservation, user, admin and
  payment-attempt relations.
- The partial one-open-checkout unique index.
- One nullable `cost_basis` column addition.
- One **pre-existing extra statement** changing the legal-template
  `required_placeholders` default from `'{}'::text[]` to `ARRAY[]::text[]`.

This is 17 statements. No drops, truncation, column removal, overwrites,
historical updates or backfill were listed. The platform flags possible
backwards incompatibility because it changes a definition on the existing
legal-template table (14 rows). Both inspected defaults are the empty `text[]`,
with unchanged type/nullability; the statement changes the default for future
inserts, not existing template rows. It is outside the payment-table inventory:
the owner must explicitly accept this equivalent normalization in the publish
review, or have it separately aligned before publishing. Do not hide it.

The diff is a reviewed snapshot, not a permanent authorization for future
statements. Recompute immediately before publishing and stop for unexpected
changes. Do not choose data overwrite or approve an inferred rename.

## Unsupported guards: owner-operated production SQL console

Publish does **not** carry functions/triggers. Tables existing after publishing
is insufficient. Keep collection and app mail off, and arrange a maintenance
window for payment confirmations, legal approval writes and background dispatch
before installing guards. A saved pause is not evidence of an effective pause
in an older published release.

Use the supported Database production SQL console for the separately reviewed
guard installation. Do not run CLI scripts against production, use alternate
connection secrets, transfer ownership, or add runtime/build migrations.

The prepared SQL-console review is in
[flutterwave-production-guards-console.md](flutterwave-production-guards-console.md).
It includes only the payment expectation and holding-cost guards and the
previously approved exact-PDF trigger. Confirm the owner has accepted all three
guard changes before execution.

Expected function-body hashes from the reviewed catalogs:

| Function | MD5 of `pg_proc.prosrc` |
| --- | --- |
| `protect_flutterwave_expected()` | `e6e632dfa8a00362e9d70f45a46b7d02` |
| `guard_holding_cost_basis()` | `9639dd1f6a65cf9bff769a4e3bb3eba3` |
| Existing `legal_guard_pdf_review()` | `f237ff6a023253ca2c2088724776c630` |

Read-only production checks still showed no payment tables or cost-basis column
before publication. The existing PDF-review function matched the reviewed hash,
but its required trigger was absent. No production guards were installed here.

## Publishing and active-release verification

1. Confirm the owner-reported seven-day PITR window and note an available
   pre-change recovery time in the production database settings. No restore or
   database copy is part of this rollout.
2. Review/accept only the fresh managed SQL plan described above, including the
   separately identified default normalization. Publish through the supported
   user-operated flow with collection, recovery and all app mail still fenced.
3. Confirm the real API artifact and main web artifact are in the published
   release. The private sandbox is excluded by `.replitignore`; never publish
   its backend as part of the main product. The API startup health route is
   `/api/healthz`; main web routes and `/api` are handled by their own artifacts.
4. On `https://brikvest.net/api/healthz`, require release
   `flutterwave-live-preparation-2026-11-21`, collection/recovery/payment mail
   false and legal/application mail paused true. This response verifies code
   and switch adoption, not database guards, provider validity or global
   maintenance-lock ownership. Do not accept the old `{status:"ok"}` alone.
   The preparation-time public GET returned HTTP 200 but not the expected JSON;
   it did not establish active backend/release adoption.
5. With the approved maintenance controls effective, the owner installs the
   reviewed unsupported guards through the production SQL console. Recheck
   enabled trigger events/functions, body hashes, columns, constraints and
   indexes through read-only production catalogs. Never test a guard by
   approving or altering a real holding.
6. Preserve the explicit historical-data boundary: the new cost-basis column
   does not classify old purchases. Holdings without historical evidence may
   remain unavailable rather than being recalculated from current listing
   costs. Confirm this inherited product behaviour before release; historical
   adoption needs a separately selected, evidence-backed process.
7. Securely confirm/update the v3 live secret and matching live-merchant
   webhook hash. Configure the merchant's webhook at
   `https://brikvest.net/api/payments/flutterwave/webhook` with retries. Public
   deployment visibility makes the route reachable in principle, not proven
   authenticated provider delivery. Do not send a fabricated paid event.
8. Verify merchant eligibility, allowed currencies/limits, gateway-fee
   absorption and recovery coverage. Autoscale timers can sleep; require an
   agreed authenticated recovery schedule/operator procedure or approved
   always-running hosting. Do not create a public admin recovery endpoint.
9. Obtain the explicit collection go-ahead only after these gates pass.
   Enable live authorization/recovery and collection in the intended published
   environment, then verify effective settings. Leave all Brikvest mail paused
   unless separately authorized. No real-payment end-to-end result is claimed.

## Collection-only incident pause

After live collection is authorized, pause **new** checkout creation with
`FLW_ENABLED=false`, while preserving valid live configuration,
`FLW_LIVE_AUTHORIZED=true` and separately authorized recovery. Do not revoke or
replace the verification credentials or turn off recovery while hosted attempts
remain unresolved. Verification and link closure can continue in this state.
Never turn a provider timeout, internal cancellation or disabled link into
permission to pay again, refund, release inventory or erase evidence.

## Isolated verification

Payment/preparation regression tests and the holding-cost/exact-PDF suites run
with disposable PGlite and mocked provider/mail dependencies. The live
preparation checks cover collection-off recovery, unauthorized live mode and
SMTP suppression. The production API and main frontend compile independently
with the artifact build environment; no backend startup or provider call is
needed for a compile.

These checks do not replace authenticated production webhook evidence, real
PostgreSQL multi-connection concurrency tests or an authorized live transaction.
