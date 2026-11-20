# Lily Crest Gardens holdings investigation

## Read-only evidence (2026-10-04)

Deployment metadata identifies a successful public autoscale deployment at
https://brikvest.net. The production read-only SQL interface identifies property
34 as Lily Crest Gardens. No workspace database queries were used.

Deployment logs from 2026-10-03 23:56–23:58 UTC contain mixed 200/400 responses
for `GET /api/admin/legal/historical-holdings`. They include neither query
parameters nor response bodies. Those historical requests cannot be attributed
conclusively to a search length, page, property or database exception.

A bounded production read-only aggregate finds five converted holdings for
property 34, two with legal document pairs. The production catalog lacks
`legal_documents.superseded_at`, `consideration_amount_naira` and
`supersedes_document_id`; the PDF review approvals table is also absent.

This read-only query reproduces an immediate prerequisite failure:

```sql
SELECT count(*)::int AS current_documents
FROM legal_documents d
JOIN legal_templates t ON t.id=d.template_id
JOIN legal_document_pairs p ON p.id=d.pair_id
WHERE p.property_id=$1 AND d.superseded_at IS NULL
-- params: [34]
```

Sanitized result: `column d.superseded_at does not exist`.
This is the same current-document predicate used by the workspace holdings
endpoint when a holding has a document pair. It demonstrates a real
production prerequisite failure, **not** the response body of the reported
October 3 request or proof of the deployed server source version.

No authenticated published holdings response has been captured. Existing local
cookie/token files were not read or reused, and admin authentication was not
bypassed. Exact historical request attribution remains blocked on an
authorized, sanitized request/response capture.

## Isolated reproduction and correction boundary

The disposable PGlite regression fixture makes `superseded_at` unavailable,
loads a property with a pair, verifies a safe 503 setup-required response and
no record/job/mail changes, then restores the fixture prerequisite and
verifies a successful reload. A property without any pairs can load under
the same condition, demonstrating why mixed statuses are possible without
proving the original requests' parameters.

The endpoint now classifies direct and Drizzle-wrapped undefined-table
(`42P01`) and undefined-column (`42703`) errors as setup failures; invalid
requests remain 400, unavailable properties 404, unexpected failures 500.
Only fixed messages, a correlation reference and bounded codes enter the
response/log. Search text, SQL, investor identities and raw exceptions are
not logged. Client load failures use fixed status/code-specific explanations,
including for unsafe legacy server responses. Authentication errors stay
normalized; absent local sessions become 401 errors.

Search is capped at the server's existing 150-character limit. Property changes,
search/page changes, failed loads and explicit retry clear action state and
invalidate detail sessions. Search survives tab changes within one property.
No legal eligibility, payment, approval, signing or dispatch rule was changed.

## Production prerequisite — separate authorization required

**Do not run migrations or generic schema pushes as part of this task.**
Do not remove the current-document predicate or pretend unavailable approval
evidence is approved merely to make this list load.

An independently authorized schema-only operation must first verify the actual
deployed database identity and release. At minimum, the current-document query
requires the additive `superseded_at timestamptz` column. Revision-aware code
also expects `consideration_amount_naira numeric(20,2)`,
`supersedes_document_id integer` with retained-document reference restrictions,
the current-document uniqueness index and revision history guards.
PDF review requires its approvals table and exact-PDF append-only guards.

Existing reference definitions are in
`scripts/ensure-legal-document-costs.sql`,
`scripts/ensure-legal-documents.sql` and
`scripts/ensure-legal-pdf-review.sql`. These are reference material, **not**
authorization to replay whole scripts on production. Older schema operations
may adopt provenance or backfill notifications, and existing production
history guards need separate verification. Preserve every payment, legal
document, PDF approval, signature, job and notification cycle. Do not drop old
uniqueness constraints, prepare holdings, approve PDFs, wake workers or send
mail during prerequisite installation.

After authorized prerequisite work and the separately managed release, an
authenticated admin GET for property 34 with `search=`, `page=1`, `pageSize=20`
must be captured and verified, followed by search, pagination and retry.
Retain only status/code and non-personal parameters; never share authorization
headers, cookies, investor response items, raw SQL or credentials.

## Remaining limitation

This task is not fully complete: live loading and the original failing request
cannot be verified from the available evidence. Publishing, production schema
changes and a full development backend restart were not performed.

The subsequently requested approval-only repair plan is in
`docs/lilycrest-schema-repair-approval.md`. A fresh production catalog check
confirms the document history/revision/reference guards are now present and
enabled; the three revision columns and current-document index remain absent.
The plan preserves those guards and the old uniqueness constraint. Its dispatch
pause is mandatory because a notification retry exists. Preparation of the
plan is not authorization to execute it or resume notifications.

Verification: 16 focused disposable-database tests passed. The two new browser
recovery tests and existing desktop/mobile exact-PDF, notification and historical
selection cases passed (9 affected cases after the final client change).
Ten other admin-document browser cases passed in the initial combined run.
The first combined run caught tab search being reset; the final change preserves
search while clearing actions on tab departure, and both affected cases passed.
The screenshot capture reaches the signed-out admin login only; signed-in
behavior was verified with isolated authenticated API fixtures, not live access.
`npm run check` remains blocked by existing project-wide type errors; its output
contains no errors for the changed holdings, authentication or regression files.