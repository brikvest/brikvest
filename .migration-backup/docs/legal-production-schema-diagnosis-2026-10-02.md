# Production legal schema diagnosis — 2026-10-02

## Outcome

**Completed after separate user authorization to restore safeguards and update
provenance.** Production now accepts `historical_rollout`, retaining all three
previous accepted provenance values. Six missing guard functions and seven
missing legal history/reference triggers were restored using the existing
reviewed migration definitions. All restored triggers are enabled.

The initial diagnosis stopped without database mutation when the missing guards
were discovered. The user subsequently explicitly authorized their schema-only
restoration alongside the provenance update.

No preparation, document generation, invitation, backfill, aggregate migration,
application deployment, or server restart was performed. Holding #82 still has
no legal pair, and its existing failure audit event is retained.

## Target verification

- Deployment metadata confirms an active successful production deployment.
- Read-only production access and the existing secure `NEON_DATABASE_URL`
  connection match on database identity, the existing provenance constraint's
  catalog identity/definition, and a server-side fingerprint of Holding #82.
- Holding #82 belongs to Property #34. Its recorded historical-preparation
  failure reports the schema-setup error. It currently has no legal pair.
- The workspace `DATABASE_URL` is a **different target**. Its provenance check
  already includes `historical_rollout`; its legal guards exist. It must not be
  mistaken for production. Both targets must still be treated as containing
  real user data.
- No credentials, endpoint details, personal data, legal document contents,
  storage paths, or raw exceptions are included in this record.

## Exact discrepancies before the operation

Production's validated `legal_document_pairs_approval_source_check` is:

```sql
CHECK ((approval_source = ANY (ARRAY[
  'payment_submission'::text,
  'admin_full_confirmation'::text,
  'admin_reinstate'::text
])))
```

This rejects `historical_rollout`. There are no additional live accepted values
or extra clauses in that check to preserve beyond these three sources.
The dedicated `scripts/ensure-legal-historical-rollout.sql` would add the fourth
source, without changing `legal_pair_approval_source_consistent`.

Direct read-only production catalog queries established the initial absence of
the following objects, all of which have now been restored:

| Expected trigger | Backing function |
| --- | --- |
| `legal_templates_immutable` | `legal_guard_template_history` |
| `legal_document_pairs_immutable` | `legal_guard_pair_history` |
| `legal_document_pairs_template_reference` | `legal_guard_template_references` |
| `legal_documents_template_reference` | `legal_guard_template_references` |
| `legal_documents_immutable_artifacts` | `legal_guard_document_artifacts` |
| `legal_audit_events_append_only` | `legal_guard_audit_append_only` |
| `local_legal_signing_operations_immutable` | `legal_guard_local_signing_operation_history` |

The initial absence and subsequent restoration were checked directly through
the secure production connection and through the read-only production query
interface. The initial absence was therefore not merely a discrepancy in the
query interface's catalog visibility. The reason these objects were absent
was not established.

## Prerequisites that are present

Read-only catalog inspection confirms:

- All eight legal/property-binding/local-signing tables and their expected
  columns, including property ownership/deletion fields, notification-cycle
  references, and local-signing evidence/artifact fields.
- The legal-pair reservation uniqueness constraint, all seven pair foreign
  keys with `ON UPDATE RESTRICT ON DELETE RESTRICT`, payment/source consistency,
  both-or-neither template pins, and financial snapshot checks are validated.
- Property-scoped active-template uniqueness, global template type/version
  uniqueness, and active-template property requirements.
- Document pair/type uniqueness and complete final-artifact metadata checks.
- Notification cycle uniqueness, requester consistency, and job/cycle
  same-pair foreign key; generation/job uniqueness and lease consistency.
- Local-signing identity/artifact foreign keys, document/artifact-key uniqueness,
  evidence/acceptance/completion constraints, and hash/lease checks.

Constraint presence does not replace trigger-based protections. Schema checks
do not certify successful preparation, conversion readiness, template legal
validity, or notification readiness.

## Applied operation and verification

- Production identity and Holding #82's unchanged server-side fingerprint were
  reverified before writing. The workspace database was not modified.
- One committed transaction ran 15 schema statements: six `CREATE FUNCTION`
  statements, seven `CREATE TRIGGER` statements, and the two constraint DDL
  statements equivalent to the dedicated historical-rollout migration.
- Only the named function/trigger definitions were extracted from the existing
  migrations: template history/references from the deletion migration, pair
  history from the property-template migration, artifact/audit protections
  from the base migration, and signing history from the local-signing migration.
  No original migration file was executed wholesale.
- Existing functions/triggers would be skipped only if structurally compatible;
  unexpected live definitions, additional provenance values/clauses, target
  mismatches, or failed verification would abort the transaction.
- Local bounds were `lock_timeout = 2s`, `statement_timeout = 15s`, and
  `idle_in_transaction_session_timeout = 30s`. Every failed SQL statement or
  verification assertion stopped the operation with transaction rollback.
- The first attempt rolled back when a catalog verifier encountered the
  driver's string decoding of PostgreSQL `name[]`. Read-only checks confirmed
  rollback. Casting catalog column names to `text[]` corrected verification;
  the reviewed DDL was unchanged.
- The successful operation and immediate verification ran from
  **2026-10-02 22:53:03 UTC to 22:53:11 UTC**.
- Reviewed DDL SHA-256:
  `dd655779865dc5e08696179ce9b4f2c65c2031f331570eb8ed25a53cdbb6fc94`.
  Apply was gated on this read-only-plan hash.
- All **131 expected legal columns**, **85 validated legal constraints**, and
  **37 supporting application columns** were checked. No required column was
  missing. All constraints other than the named provenance check, and all legal
  indexes, matched their pre-operation definitions.
- The resulting provenance check includes exactly `payment_submission`,
  `admin_full_confirmation`, `admin_reinstate`, and `historical_rollout`.
  Reservation uniqueness, restricted foreign keys, payment/source consistency,
  template pins, and snapshot validation remain intact.
- All six function bodies match their reviewed definitions. All seven restored
  triggers have the expected enabled state, event types, referenced functions,
  column lists, and lack of conditional/deferrable execution.
- Counts and server-side full-row fingerprints matched before/after both
  inside the transaction and in a fresh read-only transaction after commit for
  all eight legal tables, all investment reservations, properties, payment
  submissions, investment payments, resale listings, and Holding #82's owner
  record. Only equality results were surfaced; private row contents were not.
- The read-only repeat plan required **zero DDL statements**.
- Independent production read-only queries confirmed the updated provenance
  definition, six functions, seven enabled triggers, no pair for Holding #82,
  and its one retained failure event.

## Recovery approach

The prior provenance definition above and the initial function/trigger absence
are the pre-operation schema reference. Before commit, any error rolls back
both guard restoration and the constraint change together.

After commit, retain the restored protections. If a rollback of provenance is
separately authorized, first check read-only whether historical-source pairs
exist; never delete or rewrite pairs to force the old check to validate.
Removing restored history guards is not an acceptable routine rollback.
Unexpected live definitions or new prerequisites require review and separate
authorization rather than replaying the old aggregate migrations.

## Administrator next step

The diagnosed schema blocker is resolved. Preparation remains an **explicit
administrator retry** of the selected holding after reviewing its eligibility.
This operation did not test or perform that retry. Any investor notification
remains a separately confirmed administrator action.