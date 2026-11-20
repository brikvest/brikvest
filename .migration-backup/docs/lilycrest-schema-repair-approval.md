# Lily Crest Gardens: schema-only repair approval plan

**Status: prepared for approval, not authorized or executed.**

## Requested approval

Approve only an additive production schema repair for the confirmed legal
document revision prerequisites. Keep existing documents, purchase values,
payments, signatures, approvals, jobs and notification cycles unchanged.
No publishing, full-backend restart, historical preparation, financial
correction, backfill, PDF approval or investor email is included.

The user authorized preparation of this plan on 2026-10-04, not execution.

## Current read-only observations

The production query interface still reports all three revision columns absent
from `public.legal_documents`:

| Column | Proposed type | Existing rows |
| --- | --- | --- |
| `consideration_amount_naira` | `numeric(20,2)`, nullable, no default | Remain unclassified; NULL |
| `supersedes_document_id` | `integer`, nullable, no default | No predecessor inferred; NULL |
| `superseded_at` | `timestamptz`, nullable, no default | No document archived; NULL |

The existing `legal_documents_pair_type_uq` enforces unique
`(pair_id, document_type)` and will be retained. The partial current-document
index is absent. The retained-document reference must enforce
`ON DELETE RESTRICT ON UPDATE RESTRICT`.

The following document guards exist and are enabled:

- `legal_documents_immutable_artifacts` → `legal_guard_document_artifacts`
- `legal_documents_revision_history` → `legal_guard_document_revision`
- `legal_documents_template_reference` → `legal_guard_template_references`

The revision guard references the three absent columns. Its production
definition includes protection for signed/signing documents, retained revisions,
signing operations, leased jobs and sent/sending/uncertain notifications.
**Keep all these functions and triggers unchanged.**

The PDF-review guard function exists, but the approvals table is absent.
`hasExactPdfApproval` returns false in that situation. This is a separate,
fail-closed approval prerequisite—not a reason to create approvals or release
invitations in this repair. This plan does not create the approvals table.

One notification job was in `retry` at the time of inspection. That count is
only a snapshot and must be checked again before execution.

## Hard prerequisites — stop unless all pass

1. **Target and release:** verify the actual published application's database
   binding and release with authorized access. Match a non-personal database
   identity/catalog fingerprint between the production read-only interface and
   the proposed writable target. Do not assume the workspace database is the
   target, or use a secret's name as proof. Determine whether the deployed target
   is Replit-managed or external before choosing the execution mechanism.
2. **Dispatch pause:** an operator must confirm that all production legal job
   claim/dispatch paths and scheduler replicas are paused, including direct
   admin-triggered dispatch. Do not change job statuses to manufacture a pause,
   rely on `SKIP_STARTUP_DATA_MAINTENANCE`, or change SMTP credentials. No leased
   legal jobs may remain; if any exist, stop for an operator decision without
   reclaiming them. Do not start or restart the full development backend.
3. **Pause release is separate:** pause/resume commands are not part of the
   proposed SQL. Keep dispatch paused after the schema operation. Resuming it
   requires separate operational approval because existing retries could send
   investor mail without any explicit new send request.
4. **Catalog match:** recheck the three column types/nullability/defaults, the
   document foreign keys/uniqueness constraints, enabled trigger definitions
   and function bodies, and the partial index definition. Missing expected
   existing guards, disabled guards or any unexpected object definition are
   blockers—not permission to overwrite them. Existing same-name proposed
   columns/indexes must exactly match, or stop without changing them.
5. **Data prerequisites:** a read-only aggregate must confirm no duplicate
   current pair/type rows, no invalid existing predecessor reference and no
   incompatible pre-existing revision values if any columns have since been
   installed. Confirm the signing-operation, job and notification-cycle tables
   needed by the retained guard exist. Use aggregates only; do not expose rows.
6. **Baseline and recovery:** securely record non-personal fingerprints of the
   protected business records, existing document JSON, function/trigger
   definitions and constraints under the same dispatch pause. Arrange an
   authorized recovery point. No signed PDFs or credentials may enter this
   document or logs.
7. **Approval:** obtain explicit approval of these exact objects and the
   dispatch-pause/release boundary. Approval to prepare this plan is insufficient.

If the target is Replit-managed PostgreSQL, use the supported Publish schema
workflow; this document is not a custom migration runner. Because publishing is
outside the current authorization, stop for separately approved release work.
If the target is the documented external database, a separately authorized
operator may apply only the reviewed transaction below to the verified target.
Never attach it to startup, build, post-merge setup or an automatic schema push.

## Proposed transaction for a verified external target

This SQL is approval material, **not an instruction to execute now**. Preflight
checks above are mandatory: `IF NOT EXISTS` does not verify object definitions.

```sql proposed-repair
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.legal_documents
  ADD COLUMN IF NOT EXISTS consideration_amount_naira numeric(20,2),
  ADD COLUMN IF NOT EXISTS supersedes_document_id integer
    REFERENCES public.legal_documents(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_current_pair_type_uq
  ON public.legal_documents(pair_id,document_type) WHERE superseded_at IS NULL;
COMMIT;
```

The table locks can briefly block legal-document reads/writes. Lock or statement
timeouts must abort/roll back the transaction; do not increase limits or retry
blindly under load. The retained old unique constraint prevents creation of
replacement document pairs/types even though the new index exists. Do not drop
that constraint here. New columns add NULL fields without inferring
consideration, signing state, predecessor identity or approval.

Before committing an authorized external operation, verify on the same
connection and within the same transaction that the three columns, foreign key
actions and partial unique index match the proposed definitions; all previously
recorded function/trigger definitions and old constraints remain unchanged;
and baseline business-record fingerprints match. Existing-document comparison
must strip only these three newly introduced NULL fields.
Any mismatch must cause rollback, not a commit followed by a repair.
The SQL block states the reviewed DDL; the operator must interpose these checks
before its COMMIT. No standalone production execution script is delivered.

## Verification and recovery after approval

- Read-only catalog checks establish exact object definitions, enabled guards,
  unchanged existing uniqueness and retained predecessor reference restrictions.
- Confirm original document contents (excluding added NULL fields) and all
  payment/holding/signing/approval/job/cycle fingerprints are unchanged.
- While dispatch remains paused, use the authenticated admin UI to capture a
  GET for property 34, empty search, page 1, page size 20, then search,
  pagination, deliberate retry and property switching. Never click Prepare,
  Approve/send, Retry processing, Resend or Recover notification.
- Retain only HTTP status, safe code, property ID, page, page size and search
  length. Do not retain cookies, tokens, investor response items, search text or
  raw exceptions. The original October 3 cause remains unconfirmed without an
  authorized failed-request capture.
- The approvals table remains missing and notification approval must stay
  fail-closed. Installing that table and its exact-PDF guard is a separate scope.
- If verification fails before commit, roll back. After a successful commit,
  do not drop columns/indexes or undo guards automatically; leave the additive
  structure and dispatch pause intact for operator investigation. Dropping a
  newly used column could destroy evidence. Any recovery-point restoration
  requires separate authorization.
- A separately approved release must make the prepared client/endpoint safety
  changes live before promising their improved error handling. This plan neither
  publishes the code nor resumes notifications.

## Isolated verification

`tests/legal-holdings-schema-plan.test.ts` exercises the exact proposed DDL only
against disposable PGlite. It models the existing guards with the three fields
absent, checks successful read recovery, repeatability, NULL-only additions,
retained old uniqueness, immutable signed artifacts and unchanged record and
guard definitions. It imports no application backend, live database or mail code.
The focused isolated test passed on 2026-10-04. Production execution, lock
availability, target identity and dispatcher pause are not established by it.

## Approval does not claim restoration

Preparing this plan does not restore the published holdings list. Execution,
release and an authenticated production read check remain separately gated.
The prior isolated holdings endpoint/browser checks are described in
`docs/lilycrest-holdings-investigation.md`.