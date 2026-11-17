# Holding cost basis rollout

Apply `ensure-holding-cost-basis.sql` before publishing the application that reads
the new reservation column. The migration is additive, idempotent, and contains
no historical backfill or payment/document edits. It is included in the usual
post-merge schema setup; the existing `SKIP_POST_MERGE_DATABASE_MUTATIONS` guard
continues to skip it during controlled rollouts. In that mode it requires an
explicit, authorized schema-only deployment to the verified target database.

Do not start the backend to test this migration against the workspace database:
it contains live user data. The regression suite installs it into disposable
PGlite databases, with database imports redirected to those isolated instances.

Confirmed holdings with no recorded basis remain unavailable, even if today's
property costs happen to reconcile to their payment. Missing fee components are
not treated as zero. Partial receipts and unsupported manual confirmations do
not classify principal. Full manual confirmation needs the separately supplied,
audited full-payment attestation; classification is independent of legal scope
and document readiness.

Historical classification needs a separately designed, explicitly selected
adoption process with verified historical cost evidence. Do not use current
property prices, legal-document preparation, startup, or reapplying this
migration as authorization to adopt existing holdings.