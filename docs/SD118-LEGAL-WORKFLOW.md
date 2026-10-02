# Property-owned legal workflow and local-signing operations runbook

This feature creates an immutable Deed of Assignment and Transfer and Exit
Rights Agreement for an approved land reservation, with a local electronic
signing flow and locally retained completion evidence. The authoritative
approval events are (1) an admin's successful payment-submission approval and
(2) an admin's explicit, audited investment confirmation/reinstatement. A
pending payment, payment upload, or browser callback is not sufficient.
Approval enqueues a durable job; generation and email delivery happen
asynchronously. The database's reservation/document uniqueness constraint,
rather than the admin button, is the idempotency boundary.

Task 141 extends **new eligible approvals across all properties**: each new
legal holding freezes **5 m² per confirmed unit**, with area calculated as
`round(units × 5, 2)`. This is not a LilyCrest-only workflow and does not use a
property binding, fuzzy property-name match, or configurable area multiplier.
Approved KYC identity/address, a confirmed holding, and full NGN payment remain
required. Fractional inventory allocation remains blocked as described below.
There is **no historical approval backfill**: rollout, template assignment, and
activation do not scan old holdings or manufacture approval events.

## Before enabling the workflow

1. Apply the additive, idempotent base schema migration
   `scripts/ensure-legal-documents.sql`, followed by
   `scripts/ensure-legal-local-signing.sql`,
   `scripts/ensure-legal-notification-cycles.sql`, and the **explicit new
   additive migration** `scripts/ensure-legal-property-templates.sql`.
   `scripts/post-merge.sh` lists this sequence. The property-ownership migration
   is a required deployment step, not an implicit runtime schema change.
   These migrations are deliberately not applied via `drizzle-kit push`:
   this project's development database contains live investor data. Obtain
   authorization and review the SQL before applying it; this runbook is not
   permission to mutate a live database.
   The new migration adds `legal_templates.property_id`, ownership/history
   guards, and one-active-version-per-property-and-document-type uniqueness.
   Its one-time provenance adoption assigns a legacy version only when pinned
   pairs and enabled bindings that predate the version identify exactly one
   property. Ambiguous or unsupported versions remain unassigned and are made
   inactive; rerunning the migration does not silently reconsider adoption.
   It preserves historical pair pins, frozen snapshots, files, signatures,
   hashes, and evidence, and does not rewrite existing reservations or backfill
   historical approvals.
2. Run `npx tsx scripts/legal-readiness.ts`. It reports readiness booleans and
   missing **variable names only**; it never prints values or connects to the
   database. Configure the existing authenticated-session secret
   `SESSION_SECRET`, private object storage, SMTP, and `APP_BASE_URL` as an
   HTTPS application origin for email deep links. Local signing does not need
   a signing-provider callback. `LEGAL_DISPATCH_SECRET` is optional and only
   enables bearer authentication for a scheduled dispatcher; administrators
   can dispatch jobs through the admin-authenticated route without it.
   The `document-fonts` check verifies infrastructure only: fontconfig
   (`fc-match`) and the per-template font verification helper must be available.
   It does not inspect bundled forms or certify any uploaded, active, or
   historically pinned template's fonts; the returned `fonts` list is empty.
   Unused legacy forms therefore do not block infrastructure readiness.
   Fontconfig substitution is not a production match. Outside isolated
   `NODE_ENV=test` layout tests, each conversion checks the **actual DOCX input**
   and blocks preview, activation, and live generation before LibreOffice
   unless every declared family is an exact installed match or has valid
   embedded font data. Review each property template's rendered output;
   infrastructure readiness alone does not establish its conversion readiness.
   The local audit-evidence PDF uses a separately resolved DejaVu Sans
   font, embeds it with fontkit, records its SHA-256, and checks that digest
   during finalization/recovery. Keep that helper font available and stable.
   These are production prerequisites; the whole workflow is not automatically
   production-ready.
3. Configure SMTP through the existing `SMTP_USER` and `SMTP_PASS` server
   secrets. Do not copy credentials into source, client settings, template
   files, logs, or this runbook.
4. Open the admin Legal Documents workspace for the **exact property record**.
   Upload that property's legally reviewed Deed of Assignment and Transfer
   and Exit Rights Agreement using `POST /api/admin/legal/templates`, with
   multipart `propertyId`, `documentType`, and `file`. Each uploaded version
   belongs to one property; assigned ownership cannot be changed. Version
   numbers remain sequenced by document type, not restarted for each property.
   There is no bundled import or area-binding setup: both
   `POST /api/admin/legal/templates/import-initial` and
   `POST /api/admin/legal/binding` return **410 Gone**.
   Inspect fields, source DOCX, and rendered PDF with the property scope below.
   Resolve placeholder validation errors and verify legal wording, property
   clauses, font fidelity, and the rendered assignee signing position. Placement
   is verified from the PDF, not supplied by the browser or guessed from a
   director, witness, or notary location. Activate each version separately with
   `POST /api/admin/legal/templates/:id/activate` and JSON `propertyId`.
   Activation replaces only that property's active version of the same type.
5. Use **Unassigned legacy templates** to inspect retained versions with
   `unassigned=true`. An authorized admin must explicitly confirm the exact
   destination using `POST /api/admin/legal/templates/:id/assign` with
   `{"propertyId": <destination id>, "confirmed": true}`. Only inactive,
   unassigned versions qualify. Assignment records ownership and an audit
   event; it does not activate the version or change any pinned investor
   document. Review and activate it separately for that property. Never adopt
   another property's clauses just to clear a setup warning.
6. A new eligible approval freezes trusted user, reservation, property, area,
   payment, and approval provenance. Both valid active property-owned template
   versions are pinned together when available. If either is missing, payment
   approval can still commit, but the pair is `awaiting_templates`, both new
   pins are null, and generation is blocked with an audited failure reason.
   Complete the property setup, then use the authorized admin retry to pin
   missing versions and resume generation. Missing verified KYC, invalid data,
   or unverified placement must not be bypassed with frontend values.
   Existing non-null pins never change; controlled recovery may fill a missing
   historical counterpart without replacing the other pin. Retry is recovery
   of an existing approval, not historical backfill. Activation never
   regenerates old documents. Historical area/unit snapshots are not converted
   to 5 m²; generation/recovery uses their frozen values.
   The original DOCX/PDF and final locally signed PDF/completion evidence remain
   separate private, write-once artifacts.

Both document types accept otherwise-valid property-specific DOCX templates with
pre-existing director, witness or other-party signature images, including in the
execution section. Logos and inline or anchored graphics are preserved as source
content, with their media, relationships, positioning and layout. A missing
recognized execution heading does not itself make images invalid. Required and
unsupported placeholder checks, macro rejection and archive limits still apply;
there is no validation override.

Normalization changes only supported legacy arithmetic/date placeholders. Upload
and Word download retain exact uploaded bytes; illustrative previews and newly
generated DOCX/PDF retain the source graphics. Review the PDF before activation,
including the third-party marks and a clear area near the verified assignee name.
Activation still requires safe investor placement; a missing/ambiguous assignee
block or unsafe placement must be corrected in a **new** template version, never
by stripping signatures or bypassing the placement check.

Embedded images do not sign for the investor, change signing status, establish
authenticity or certify full legal execution. The investor must still review,
explicitly consent, confirm identity and create their own new drawn/typed mark.
Final investor signing adds that mark to the retained unsigned PDF without
replacing other-party content. Witnessing, attestation, notarization and other
external legal requirements remain separate.

Do not regenerate bundled historical template assets or backfill signatures into
versions that already had them removed. Upload a new property-owned version;
historical pins and generated/signed evidence remain immutable. The offline
normalization script requires an explicit fresh output directory and refuses
overwrites: `npx tsx scripts/normalize-legal-templates.ts --output-dir /tmp/legal-template-review`.
Its output is for review and explicit property-specific upload, not automatic
assignment or historical artifact replacement.

## Implemented routes and approval payloads

The approval triggers are wired into the existing payment and investment
routes. Approving a payment submission uses
`PUT /api/admin/payment-submissions/:id/approve`; its payment/reservation
transition and legal-job enqueue are committed together. For an administrator
who explicitly confirms full payment or reinstates an eligible investment,
the existing endpoints are `PUT /api/admin/investments/:id/confirm` and
`POST /api/admin/investments/:id/reinstate`. Both accept the attestation under
`fullPaymentConfirmation`:

```json
{
  "fullPaymentConfirmation": {
    "confirmed": true,
    "amount": "<confirmed amount in naira>",
    "currency": "NGN",
    "reference": "<admin-entered payment reference or audit note>"
  }
}
```

The amount must match the confirmed payment; the reference is retained for the
audit record. These manual endpoints do not treat an absent or unconfirmed
attestation as full-payment confirmation. A legal pair/job is enqueued only
when the guarded reservation transition succeeds.

## Local signing procedure and limits

Signing is performed by the authenticated investor in the Brikvest application;
there is no external signing provider, callback, or webhook. First request a
fresh owner-authorized signing session:

```http
POST /api/legal/documents/:id/signing-session
```

Both signing requests require the investor's existing authenticated session
and the `X-Brikvest-Signing: 1` JSON request marker. The Brikvest browser
review flow sends same-origin requests; if an `Origin` header is present, the
server requires it to match the request host and rejects cross-site fetches.

The session response supplies a short-lived `challengeToken` and the
`unsignedPdfSha256` digest for the exact unsigned artifact being reviewed,
along with the operation ID, verified signer name, current consent version,
and consent text.
After the investor has reviewed that PDF, submits explicit consent, and
reauthenticates with their account password, complete signing with:

```http
POST /api/legal/documents/:id/sign
Content-Type: application/json
```

```json
{
  "challengeToken": "<short-lived owner-bound token>",
  "password": "<investor's account password>",
  "typedName": "<verified account name>",
  "consent": true,
  "reviewed": true,
  "signaturePng": "data:image/png;base64,<captured signature image>",
  "signatureMethod": "drawn",
  "consentVersion": "<consentVersion returned by the session>",
  "unsignedPdfSha256": "<digest returned by the signing-session route>"
}
```

`signatureMethod` is either `drawn` or `typed`; for a typed mark, the PNG must
still be generated from the verified name and the text must exactly match that
name. A successful response may be `investor_signed` or `processing`. The
processing response contains only a local operation/document status; there is
no redirect or external signing URL.

The challenge is bound to the authenticated owner and document. Signing
requires the current document digest, matching typed identity, explicit
consent/review acknowledgement, and a valid PNG signature image. Passwords
must be verified through the built-in account authentication and must never be
stored in signing records, returned in responses, or logged. The durable
dispatcher invokes `reconcileLocalPairSigning` for queued local signing work
and finalizes private signed artifacts; it does not depend on webhooks or
signing-provider requests.

Signing and finalization also require the original holding to remain actively
confirmed for the same investor and property. Ordinary cancellation of an
unsigned holding suspends its queued legal work and invalidates draft signing
challenges; an investor cannot sign its documents while it is cancelled. Its
files, frozen approval and audit events remain private and unchanged. A
subsequent authorized reinstatement requires a fresh challenge and any
suspended work requires an admin-controlled retry. Ordinary cancellation is
refused after consent has been accepted or a legal signature has been recorded;
it cannot void a signature or bypass a separately defined correction process.

This flow records an investor's native electronic mark plus application
evidence. It is not a certificate-authority-backed digital signature and does
not itself guarantee legal enforceability or execution. Obtain legal review of
the consent text, identity/reauthentication controls, audit evidence, and
document execution requirements before relying on signed forms.

## Fractional-unit allocation blocker

The current property inventory columns (`total_units`, `reserved_units`, and
`sold_units`) are integers, while reservation units can contain decimals.
Payment approval, full confirmation, and reinstatement therefore fail closed
with an actionable conflict before changing payment, reservation, or inventory
state when a holding contains fractional units. Legal templates can represent
decimal areas and amounts, but that does not make fractional inventory
allocation safe.

Until a reviewed fractional-inventory accounting design is approved and
deployed, only whole-unit holdings may be allocated. Do not change the existing
property column types ad hoc, round fractional values, or retry the same
fractional holding through another approval endpoint.
`scripts/legal-readiness.ts` reports this whole-unit supported scope
informationally with `fractional-unit-inventory-accounting.ready: true`; it
does not block infrastructure readiness for supported whole-unit approvals.
That flag does not enable fractional approvals: fractional holdings still fail
closed, and fractional inventory accounting remains outside this workflow.

The legal API currently exposes:

### Property scope and field inspection

Admin document lists, failures, holding detail, pair audit, and admin document
preview/download require query `propertyId=<exact property id>`. Template
list/download/preview/fields require that same query scope, or
`unassigned=true` for retained versions with no owner. A different property
cannot retrieve a scoped template or holding. Upload, activate, assign,
retry, and resend carry `propertyId` in their multipart or JSON body; sending
it only in the URL is not sufficient for those writes. Readiness and dispatch
are infrastructure-wide, not proof that a property's two templates are ready.
Investor routes remain owner-authorized, rather than accepting an admin scope.

`GET /api/admin/legal/templates/:id/fields` returns `templateId`, `propertyId`,
`documentType`, `version`, `active`, `fields`, and `issues`. Each detected field
includes its token, label, meaning, trusted source, format, and occurrence
count, including tokens split across Word runs. It is inspection metadata,
not an API for setting investor values. Supported fields are
`USER_FULL_NAME`, `USER_HOME_ADDRESS`, `PROPERTY_AREA_SQM`, `DOCUMENT_DATE`,
and the deed's `PAYMENT_AMOUNT_NAIRA_NUMERIC` and
`PAYMENT_AMOUNT_NAIRA_WORDS`. A complete legacy date trio
(`DOCUMENT_DATE_DAY`, `DOCUMENT_DATE_MONTH`, `DOCUMENT_DATE_YEAR`) is also
accepted. Identity/address come from frozen approved KYC, payment from the
frozen approved full NGN amount, and the date from the frozen approval effective
timestamp in UTC. New area snapshots use units × 5; historical snapshots keep
their original multiplier even if generic field metadata describes a
property's confirmed square metres per unit.

| Method and path | Access / purpose |
| --- | --- |
| `GET /api/legal/holdings` | Authenticated investor's legal-document pairs and statuses |
| `GET /api/legal/documents/:id/preview?version=unsigned` | Owner-only private preview; versions are `unsigned`, `signed`, `certificate`, or `docx` |
| `GET /api/legal/documents/:id/download?version=unsigned` | Owner-only private download; supports the same versions |
| `POST /api/legal/documents/:id/signing-session` | Owner-only short-lived signing challenge and unsigned-PDF digest |
| `POST /api/legal/documents/:id/sign` | Owner-only completion with password reauthentication, explicit consent/review, typed name, challenge, digest, and PNG signature |
| `GET /api/admin/legal/properties/:id` | Admin exact-property identity, location, plot number, and currency |
| `GET /api/admin/legal/documents` | Admin property-scoped document-pair overview |
| `GET /api/admin/legal/failures` | Admin property-scoped blocked/failed audit events |
| `GET /api/admin/legal/holdings/:id` | Admin property-scoped holding detail; no binding setup |
| `POST /api/admin/legal/binding` | Retired; returns 410 Gone |
| `GET /api/admin/legal/readiness` | Admin operational readiness blockers |
| `GET /api/admin/legal/templates` | Admin property-scoped versions, or `unassigned=true` legacy list |
| `POST /api/admin/legal/templates` | Admin property-owned DOCX version upload (multipart `propertyId`, `documentType`, `file`) |
| `POST /api/admin/legal/templates/import-initial` | Retired; returns 410 Gone |
| `POST /api/admin/legal/templates/:id/assign` | Admin explicit legacy destination (`propertyId`, `confirmed: true`); no activation |
| `GET /api/admin/legal/templates/:id/download` | Admin scoped source DOCX download |
| `GET /api/admin/legal/templates/:id/preview` | Admin scoped illustrative PDF preview |
| `GET /api/admin/legal/templates/:id/fields` | Admin scoped detected-token metadata and validation issues |
| `POST /api/admin/legal/templates/:id/activate` | Admin validation/conversion/signature-position gate and property-only activation (JSON `propertyId`) |
| `GET /api/admin/legal/documents/:id/preview` | Admin property-scoped private document preview; same versions as owner routes |
| `GET /api/admin/legal/documents/:id/download` | Admin property-scoped private document download |
| `GET /api/admin/legal/pairs/:id/audit` | Admin property-scoped audit history |
| `POST /api/admin/legal/pairs/:id/retry` | Admin audited recovery (JSON `propertyId`); permanently blocked after investor signature |
| `POST /api/admin/legal/pairs/:id/resend` | Admin audited notification resend (JSON `propertyId`) after both unsigned PDFs are ready |
| `POST /api/admin/legal/dispatch` | Admin-authenticated bounded legal-job dispatch |
| `POST /api/legal/dispatch` | Optional scheduled bounded dispatch; requires `Authorization: Bearer <LEGAL_DISPATCH_SECRET>` when enabled |

The dispatcher secret is server-only. Admin routes require existing admin
authentication, and investor document and signing routes authorize the
persisted document owner before streaming files or creating signing evidence.

## Private files, authentication, and operations

Legal documents belong in the private Object Storage namespace. Serve them
only through authenticated, ownership-checked user routes or admin-authorized
routes. Do not share an object path or public bucket URL, even in email. User
email links should return to the Brikvest sign-in/dashboard flow. The general
document-serving route must not be used to bypass legal-record authorization.

Keep the existing Brikvest account/admin authentication; do not introduce a
second user identity or accept legal field values from the browser. Restrict
template changes, explicit legacy ownership assignment, retry/resend, and administrative review to
authorized admins. A signed/final record and its signed file are immutable:
there is no user delete, edit, replace, void, or second-sign action. Keep
generation/signing failures visible and retry only through the audited,
idempotent admin job controls. Email failure does not undo successful
generation, but must be recorded and explicitly retryable.

The existing payment submission approval route is
`PUT /api/admin/payment-submissions/:id/approve`; its `pending_admin_review` →
`approved` transition must be committed with the legal-job enqueue. Explicit
full confirmation and reinstatement routes must independently record the
admin-confirmed payment amount/currency/reference and enqueue only after their
eligible status transition succeeds. Repeated requests must not create a
second document pair or local signing record.

`APP_BASE_URL` is the Brikvest HTTPS origin used to construct application email
deep links, not a signing callback. `SESSION_SECRET` remains private server
configuration for the application's built-in authenticated sessions. Local
signing makes no outbound signing-provider request and uses no provider
credentials, webhook, or third-party signing account. Never add signing
passwords to secrets, logs, test output, or audit rows.

## Isolated checks

Investor stamping uses Poppler `pdftotext` for text bounds and `pdftohtml` for
existing image bounds, in PDF-point coordinates. Keep `poppler_utils` installed
(or configure `PDFTOTEXT_PATH` / `PDFTOHTML_PATH` to those executables). Signing
fails closed if extraction is unavailable or no candidate area near the verified
investor name is clear of text and images; it never covers a source signature to
make room. Readiness reports missing image-position tooling.

`vitest.legal.config.ts` intentionally omits the repository-wide
`tests/global-setup.ts` and uses an isolated process context. Run legal-only
unit tests with `npm run test:legal` (or the direct command below). The
first-party signing UI also has mocked native-browser coverage for drawn and
typed signatures, consent/password gates, request headers, local processing,
and external-request blocking:

Pre-signed-template regressions use repository DOCX fixtures, mocked admin and
worker persistence, and an isolated in-memory PGlite signing database. Real
LibreOffice and Poppler checks cover illustrative previews and final signing for
both types, including their source inline/anchored drawings; raster comparisons
require existing image pages to remain unchanged outside the investor stamp.
These checks neither restart the application nor access the live development
database. Test-mode conversion allows host-font substitution, so it does not
certify production font fidelity; the normal per-template font gate remains in
place outside tests.

```sh
npx vitest run --config vitest.legal.config.ts
npm run test:legal:browser
npx tsx scripts/legal-readiness.ts
```

The browser command requires an existing HTTPS development UI origin and
Chromium. Set `DEV_BASE_URL` or `REPLIT_DEV_DOMAIN`; set `CHROMIUM_PATH` if
Chromium is not on `PATH`. For example:

```sh
DEV_BASE_URL=https://<existing-https-development-domain> \
CHROMIUM_PATH=/path/to/chromium \
npm run test:legal:browser
```

The native-browser suite intercepts legal/API requests and uses fixture
responses and a fake password; it does not submit a real signature, access the
database, send email, or call a third-party signing service. The HTTPS origin
is used only to load the existing application UI.

These checks must not import the general application test setup or make
requests/mutations against `DATABASE_URL`. The live development database is not
a test fixture. Test template/data/format validation, queue idempotency,
ownership authorization, private document access, failed conversion and email
paths, template version pinning, and immutable finalization using unit tests or
an explicitly provisioned isolated test database. Readiness reports the
whole-unit supported scope and font-checking infrastructure availability; it
does not certify individual property templates or that the workflow is generally
production-ready.

## Review prerequisites and limits

The property-owned templates supply legal wording, but field mapping, the
universal 5 m² rule's legal suitability for new approvals, font fidelity, signature-field coordinates,
the exact signing-consent version, and the legal suitability and execution
requirements of the completed forms require authorized human review. The
local electronic mark and application evidence must not be described as a
certificate-authority digital signature or a guarantee of legal execution.