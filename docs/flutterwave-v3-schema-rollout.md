# Flutterwave v3 schema rollout preparation

## Authorization and current status

The owner's current request is to deliver the approved v3 preparation package
ready for main, with collection and emails disabled, and no publishing or real
charges. See [main-project handoff](flutterwave-main-handoff.md). Production
execution remains outside this preparation delivery.

After preparation, the owner explicitly authorized the **development-only
Flutterwave schema**. It has now been installed in one committed transaction,
with a development database identity check, a first-install-only check and
bounded lock/statement timeouts. This plan uses v3 Standard with the updated
secret key and unchanged webhook hash. No production migration has been run.

Read-only post-install verification confirmed all six tables are empty, with
the expected column types/defaults/nullability, primary/foreign/unique keys,
positive-amount and test/live checks, partial one-open-attempt unique index,
and enabled immutable-expectation trigger with its expected function body.
No investor rows were inserted, updated or deleted. A separate production
catalog query still reports zero Flutterwave tables. No settings were changed,
and no payment, publication or email was initiated.

The four Flutterwave collection/live-authorization/worker/notification flags
are explicitly saved as false in both environment configurations for this
handoff. This does not claim the active production release was restarted or
adopted those saved values; unrelated legal/general mail settings are unchanged.

The owner confirmed that production point-in-time recovery is enabled with a
seven-day window. This clears the recovery-availability prerequisite based on
the owner's report; no restore was attempted and no specific restore timestamp
was independently inspected.

Read-only queries through the platform's development and production database
interfaces initially found no Flutterwave tables in either environment. The application
source uses the platform-provided `DATABASE_URL`; this is not independent proof
that the running published revision uses the same target. Do not substitute
`NEON_DATABASE_URL`, infer ownership from a hostname, or print connection strings.
The interfaces report distinct targets: development `heliumdb` on PostgreSQL
16.10 and production `neondb` on PostgreSQL 16.16, with the production query
transaction read-only. This distinguishes the platform query targets but does
not prove the active application revision's connection.

The six new tables are:

- `flutterwave_attempts`
- `flutterwave_charges`
- `flutterwave_verification_jobs`
- `flutterwave_audit`
- `flutterwave_confirmation_jobs`
- `flutterwave_checkout_closures`

Production already has the reservation inventory primary key and a unique
reservation ID on ownership certificates. Legal history/template/artifact guards
were listed as enabled, but their complete function bodies were not compared.
**`legal_pdf_review_approvals` exists without its required
`legal_pdf_review_append_only` trigger.** Stop before activation; that guard needs
its own reviewed, schema-only repair. Do not replay legal data migrations.
The production `legal_guard_pdf_review()` body was read and matches the intended
guard: INSERT only, both exact current ready investor PDFs, matching templates
and hashes, and non-null artifact keys and signature placements. The missing
trigger attachment, rather than a missing function, is the observed defect.
No legal schema or evidence was changed.

## Prepared source

Review documents are now available:

- [Production change inventory](flutterwave-production-change-review.md):
  catalog-based scope, explicitly not the unavailable Publish-generated SQL diff.
- [Exact-PDF safeguard repair](pdf-approval-safeguard-review.md):
  trigger-only SQL-console draft with a checked function fingerprint, timeouts
  and isolated regression tests. No development or production repair was applied.

`shared/schema.ts` describes the six tables. Its attempt definition now also
includes the existing SQL contract's positive amount check, test/live mode check,
and partial unique index allowing only one initiated/verification-pending attempt
per reservation. These definitions now match the authorized development
installation; they have not been applied to production.

The existing `scripts/ensure-flutterwave.sql` defines the corresponding tables,
indexes, foreign keys and immutable-expectation function/trigger. Treat it as
the contract and isolated test fixture. It is **not authorization to run a custom
production migration**. No generic schema push, startup DDL or deploy-build
migration may be introduced. Leave post-merge database mutations skipped.

## Gates before any writes

1. Confirm the deployed revision and its target database using the supported
   publishing/database surfaces. Confirm managed versus external ownership.
2. In Database → Production → Settings → Advanced, confirm point-in-time
   recovery is enabled and note an available pre-change restore time. If managed
   recovery is unavailable, resolve that with the platform before proceeding.
   For a verified external database, use that provider's recovery controls.
   The owner has confirmed a seven-day PITR window. Record the pre-change time
   before any authorized write; no restore point was independently inspected.
   Do not create dump jobs, backup tables, or copy investor data.
3. Review the actual development-to-production publication statements.
   The schema-diff callback is unavailable in this task environment; **no
   publish plan has been inspected**. Development now has the approved
   Flutterwave objects; production does not. The actual publication diff still
   needs review before any production changes.
4. Completed: present the narrowly scoped development DDL for explicit authorization.
   It must create only the six empty Flutterwave tables and their constraints,
   indexes and guards. It must not backfill holdings, adopt inventory, change
   prices, generate PDFs, enqueue mail or alter unrelated tables.
5. Present the PDF-review guard repair separately. Inspect its current function
   body and intended semantics first; adding a trigger without verifying the
   function is not sufficient.

## Rollout sequence after separate authorization

1. Apply only approved development schema changes to the independently verified
   development target. It contains real investor data; never use it for tests.
2. Verify columns, defaults, nullability, all foreign keys/unique constraints,
   positive amount and mode checks, the partial unique index and the immutable
   expectation function/trigger. Verify the PDF approval guard separately.
3. Merge prepared source through the normal task flow. Review the resulting
   managed publication diff: no drops, truncation, data overwrite, historical
   updates, unrelated changes or backfill. A successful merge alone is not
   production schema readiness.
4. Managed table/schema changes use the supported publication flow. PostgreSQL
   functions/triggers are not automatically included: arrange their separately
   reviewed, owner-operated SQL-console deployment through the supported path.
   Do not use an application startup/build hook or a custom production migration.
5. Keep `FLW_ENABLED`, `FLW_LIVE_AUTHORIZED`, `FLW_WORKER_ENABLED` and
   `FLW_NOTIFICATION_DISPATCH` false during staging. Configure the intended
   production-only origin `https://brikvest.net`, allowlist `NGN,USD,GBP,EUR` and
   `FLW_MODE=live` only as part of the approved configuration step.
   Secret presence is not proof of key validity or running-release adoption.
6. Independently recheck the production catalogs, enabled triggers and exact
   function definitions, then the active release and effective configuration.
   The planned webhook is `https://brikvest.net/api/payments/flutterwave/webhook`;
   its authenticated delivery and provider retries have not been tested here.
7. Establish recovery coverage on autoscale before enabling collection. An
   in-process worker cannot guarantee recovery while the service sleeps.
   Keep investor mail separately gated; preserve explicit admin payment approval
   and exact-investor-PDF approval.

## Rollback and stop conditions

Before collection starts, leave feature flags off if any gate fails. Retain new
empty tables rather than dropping schema during an incident. Once any payment is
possible, rollback must preserve verification, reconciliation, durable evidence
and recovery; the current shared enable flag also gates provider verification,
so disabling it is not a safe collection-only rollback. Resolve that operational
limitation before activation. Do not release inventory or invite bank repayment
for unresolved hosted sessions. Do not issue automatic refunds.

## Validation

`npx vitest run --config vitest.flutterwave.config.ts` uses disposable PGlite,
synthetic credentials, mocked provider calls and blocked mail. It checks the
SQL contract's idempotence and immutable evidence as well as declarative
constraint/index coverage. Passing these tests does not establish production
readiness, multi-connection race scheduling, or a real-payment end-to-end result.
