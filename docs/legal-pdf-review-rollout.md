# Controlled PDF review rollout

Do not run migrations or start the live backend as part of implementation tests.
Use a disposable PostgreSQL/PGlite database with mocked mail and storage.

1. Pause the legal scheduler and drain active workers before deploying. An old
   worker does not know the review gate; never run old and new workers together.
2. Verify the exact target database and existing legal evidence guards using the
   production schema diagnosis procedure. Back up through the established process.
3. Apply existing legal documents, property template, notification cycle and
   historical rollout migrations as needed, then explicitly apply
   `scripts/ensure-legal-pdf-review.sql` through the controlled SQL rollout path.
   It adds one append-only table and its guard; it does not update holdings,
   templates, PDFs, invitations, financial records or existing audit history.
4. Deploy the new application and scheduler together. Verify the review-table
   readiness check and approval trigger before resuming workers.

Without this table, generation can continue, but new notification attempts and
approval fail closed. No payment approval, template validation or historical
mail event counts as PDF review. Already accepted invitations retain their history;
new reminders require explicit PDF approval. Legacy unsent jobs are fenced at the
attempt boundary and can be released by approval. Unresolved send intents remain
quarantined; approval cannot reconcile uncertain mail.

Rollback must not restore an old ungated mail worker. Keep the scheduler paused
if application rollback is necessary. Retain review records and existing guards.