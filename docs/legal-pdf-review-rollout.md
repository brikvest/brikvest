# Controlled PDF review rollout

Do not run migrations or start the live backend as part of implementation tests.
Use a disposable PostgreSQL/PGlite database with mocked mail and storage.

1. Pause the legal scheduler and drain active workers before deploying. An old
   worker does not know the review gate; never run old and new workers together.
2. Verify the exact target database and existing legal evidence guards using the
   production schema diagnosis procedure. Back up through the established process.
3. Stop for separately scoped authorization if prerequisite legal documents,
   property template, notification cycle or historical rollout schema is missing
   or incompatible. Do not replay those migrations under PDF-review-only
   authorization. Explicitly apply only `scripts/ensure-legal-pdf-review.sql`
   through the controlled SQL rollout path.
   It adds one append-only table and its guard; it does not update holdings,
   templates, PDFs, invitations, financial records or existing audit history.
4. Deploy the new application and scheduler together. Verify the review-table
   readiness check and approval trigger before resuming workers.

## Online maintenance without taking the website down

The release exposing `GET /api/legal/rollout-status` with
`dispatchProtocol: "exact-pdf-review-dispatch-maintenance-v1"` guards every
production dispatch entry point with the session-level shared advisory lock
`(1279608641, 1)`. This includes scheduler calls, admin dispatch and immediate
wakeups after committed application operations. The endpoint is read-only and
reports only the protocol and PDF-review schema presence, not investor data.
Publish this release first and verify the active deployment has replaced all
older app/worker instances; an older worker does not participate in this lock.
For a schema-only publication, set the non-secret production setting
`SKIP_STARTUP_DATA_MAINTENANCE=true` before publishing. The rollout-status endpoint
must also return `startupDataMaintenanceSkipped: true`. This suppresses boot-time
reservation funnel backfill, reservation expiry cleanup and the immediate
resale-expiry pass; normal periodic maintenance remains unchanged. Leaving the
setting enabled only prevents boot-triggered data mutations. Removing it takes
effect on the next publication and must not be used to authorize data repair.
Set `SKIP_STARTUP_DATA_MAINTENANCE=true` and
`SKIP_POST_MERGE_DATABASE_MUTATIONS=true` in development as well before task
completion: merge setup otherwise replays older aggregate migrations and
backfills, and workflow reconciliation restarts the workspace backend. The
workspace also contains real data and is not the verified production target.
The post-merge skip still permits dependency installation; do not run the
unskipped legacy hook as part of this PDF-review operation. The hook also reads
the merged development configuration so an inherited, not-yet-refreshed process
environment cannot accidentally replay older migrations.

On the independently verified target connection, acquire the exclusive
counterpart with a bounded timeout:
`SELECT pg_advisory_lock(1279608641, 1)`. It waits for active participating
dispatches to drain; new dispatches return without claiming jobs while it is
held. The worker retains its shared permit even when its processing timeout
fires, until the underlying SMTP/conversion and failure-recording promises have
actually settled. Use a dedicated permit pool, never the business-query pool.

After acquiring the exclusive lock, stop if any legal job remains leased or
any send intent is unresolved. Inspect the existing schema/evidence protections
and preserve pre-operation fingerprints. Apply only the reviewed PDF-review
migration with fail-on-error transactional execution, bounded lock/statement
timeouts, structural assertions and unchanged-data checks before commit.
The maintenance lock is session-level and must remain held through fresh
post-commit read-only verification and the readiness check. Explicitly unlock
only after successful verification of the current gated deployment. A lost
controller connection releases the lock; it must not be described as a
persistent operational pause, and any interrupted operation requires a new
read-only diagnosis before retrying.

This protocol does not authorize PDF approval, notification creation, data
repair, or migration replay. Do not use the rollout-status endpoint to infer
that older instances or independently deployed workers have been drained.

## Bounded transaction-lock alternative

Publishing while an implementation task is still isolated publishes the main
project, not that task's prepared release. Confirm the actual published code;
a successful publication alone does not prove the pause protocol or startup
skip is deployed.

When the already-published release **does** enforce exact PDF review at the
durable send-attempt boundary, a short schema-only operation can instead use a
transactional table pause. Verify that every scheduler, administrator dispatch
and immediate wakeup claims work through the same `legal_jobs` table.

- Take `LOCK TABLE legal_jobs IN EXCLUSIVE MODE` with a bounded lock timeout.
  Ordinary reads remain available; job claims, writes and `SELECT FOR UPDATE`
  cannot pass this lock. Existing transactions must finish before it is granted.
- Under that lock, reject retained leases, sending/uncertain cycles, unresolved
  audit send intents, or evidence of outstanding external generation/signing
  work. A cleared lease alone does not prove a timed-out operation has stopped.
- Hold share locks on the protected legal/business tables for the short
  transaction when exact unchanged-data comparison is required. Writes may
  briefly wait, but ordinary website reads continue.
- Apply only the reviewed PDF-review SQL inside that same transaction. Run full
  schema, unchanged-evidence, unchanged-row and empty-approval assertions, plus
  the read-only schema-presence query, before commit.
- Commit releases the table locks and resumes claims only after the gated
  published workers and pre-commit assertions are verified safe. Then run fresh
  read-only catalog/data/readiness verification. Unlike the session-level pause
  above, table locks do **not** persist across commit; never claim otherwise.

Use this alternative only for an already-gated, verified release and a bounded
schema transaction. It cannot make an ungated worker safe, replace a persistent
maintenance pause, or reconcile unresolved deliveries.

Without this table, generation can continue, but new notification attempts and
approval fail closed. No payment approval, template validation or historical
mail event counts as PDF review. Already accepted invitations retain their history;
new reminders require explicit PDF approval. Legacy unsent jobs are fenced at the
attempt boundary and can be released by approval. Unresolved send intents remain
quarantined; approval cannot reconcile uncertain mail.

Rollback must not restore an old ungated mail worker. Keep the scheduler paused
if application rollback is necessary. Retain review records and existing guards.