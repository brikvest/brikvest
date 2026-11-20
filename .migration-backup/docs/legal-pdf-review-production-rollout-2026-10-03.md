# Production PDF-review migration — 2026-10-03 UTC

## Outcome

Applied only `scripts/ensure-legal-pdf-review.sql` to the independently verified
database serving the successful autoscale deployment at **https://brikvest.net**.
The workspace connection is a different target and was not used for migration.

The review schema now has:

- Eight expected columns, with required types, defaults and nullability.
- Nine validated constraints: primary key, four restricted foreign keys, two
  SHA-256 checks, distinct-document check and exact-pair/document/hash uniqueness.
- The exact reviewed `legal_guard_pdf_review()` function.
- Enabled `legal_pdf_review_append_only`, a nondeferrable, unconditional,
  row-level **BEFORE INSERT OR UPDATE OR DELETE** trigger (event mask 31).

The application's actual `reviewSchemaInstalled` helper returned **true** on
the verified production connection inside an explicitly read-only transaction.
Independent read-only production queries confirmed the installed schema,
enabled trigger, zero approvals, zero leased jobs and zero unresolved cycles.
The authenticated administrator UI was not exercised; no approval was used to
test readiness.

## Operational method

The user waived a separate backup/recovery-point requirement for this operation
and required the website to remain running. No backup is claimed.

The user's publication succeeded, but it published the main project without
the still-isolated task's new dispatch-maintenance protocol. No additional
publication or application restart was performed to execute the migration.

The published main release already enforced exact PDF review before a durable
mail attempt. Source verification covered every scheduler, administrator and
immediate dispatch entry point: all use the same worker/repository job-claim
path. No independent notification worker is configured in this project.
Read-only preflight found no active leases, no unresolved send intents/cycles,
no local signing operations, and no outstanding generation/reconciliation job;
the existing generation job was complete and the notification retry had no
recorded runtime timeout.

A disposable native PostgreSQL rehearsal confirmed that an exclusive job-table
lock blocks claims, permits ordinary reads and releases on commit.

The successful controlled transaction:

1. Reverified the independent production database/catalog identity.
2. Took an exclusive lock on `legal_jobs` and share locks on 14 other protected
   legal/business tables. Ordinary reads continued; writes could briefly wait.
3. Rechecked idle work and all existing evidence protections under those locks.
4. Executed only the body of the reviewed PDF-review migration.
5. Checked actual columns, constraint definitions, indexes, function body and
   trigger configuration before commit.
6. Asserted zero approvals, unchanged existing schema, and unchanged counts/
   server-side full-row fingerprints for all 15 protected tables.
7. Committed, releasing the temporary table pause only after those checks.
8. Rechecked schema and unchanged protected data in a fresh read-only transaction.
   Then independently ran the application's actual read-only readiness helper.

Bounds: `lock_timeout=2s`, `statement_timeout=15s`, and
`idle_in_transaction_session_timeout=30s`. Errors stop with rollback.

An initial transaction rolled back **before any migration SQL** when the
fingerprint verifier assumed all protected tables had an `id` column. Read-only
checks confirmed both the review table and function remained absent. Sorting
server-side full-row hashes instead corrected that verification assumption.
The reviewed migration itself was unchanged.

Migration SHA-256:
`3d2a3feff9ef0ca5acb711eb85c60e325f427b084f860f2a23d21d73990b7221`.
Final independent checks completed at approximately **03:16 UTC**.

## Preservation and dispatch

All 131 prerequisite legal columns, 85 constraints, existing indexes and seven
evidence triggers/functions passed compatibility checks. Existing definitions
and protections remained unchanged by the migration.

Protected full-row counts/fingerprints matched before/after the migration and
after commit for all eight prerequisite legal tables, investment reservations,
properties, payment submissions, investment payments, resale listings, users
and administrator records.

No PDF was approved, no invitation was created or resent, no holding was
prepared, no document was generated, and no notification operation was invoked
by this operator. The review table contains zero records. Dispatch is no longer
paused, but the existing exact-PDF-review gate still requires explicit approval
before a new invitation can be sent.

## Separate publication incident — not silently repaired

The publication at **03:04 UTC** started the older main-project backend.
Its logs report that startup backfilled funnel stages on **14 reservations**.
The prepared startup-skip code was still isolated and therefore not included.
This was outside the intended schema-only preservation boundary and was
disclosed to the user during the operation.

The successful migration's fingerprints establish no further changes during
the schema operation; they do not undo or conceal that earlier publication
backfill. No data repair or rollback was attempted. Any investigation or
correction must be separately authorized and start with read-only evidence.

The prepared startup and post-merge skip controls remain in the task changes
to prevent future unrequested boot repair/aggregate migration replay once
applied to the main project. Publishing isolated task code must not again be
assumed to publish those controls.