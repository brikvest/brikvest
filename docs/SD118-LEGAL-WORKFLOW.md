# LilyCrest Garden Estate legal workflow and local-signing operations runbook

This feature creates an immutable Deed of Assignment and Transfer and Exit
Rights Agreement for an approved land reservation, with a local electronic
signing flow and locally retained completion evidence. The authoritative
approval events are (1) an admin's successful payment-submission approval and
(2) an admin's explicit, audited investment confirmation/reinstatement. A
pending payment, payment upload, or browser callback is not sufficient.
Approval enqueues a durable job; generation and email delivery happen
asynchronously. The database's reservation/document uniqueness constraint,
rather than the admin button, is the idempotency boundary.

## Before enabling the workflow

1. Apply the additive, idempotent base schema migration
   `scripts/ensure-legal-documents.sql`, followed by the first-party local
   signing migration `scripts/ensure-legal-local-signing.sql`. The
   `scripts/post-merge.sh` workflow applies the local migration after the base
   legal schema. They are deliberately not applied via `drizzle-kit push`:
   this project's development database contains live investor data. Review
   both migrations before applying them; they add legal tables, indexes, and
   triggers without rewriting existing reservations.
2. Run `npx tsx scripts/legal-readiness.ts`. It reports readiness booleans and
   missing **variable names only**; it never prints values or connects to the
   database. Configure the existing authenticated-session secret
   `SESSION_SECRET`, private object storage, SMTP, and `APP_BASE_URL` as an
   HTTPS application origin for email deep links. Local signing does not need
   a signing-provider callback. `LEGAL_DISPATCH_SECRET` is optional and only
   enables bearer authentication for a scheduled dispatcher; administrators
   can dispatch jobs through the admin-authenticated route without it.
   Readiness inspects each pinned template's declared fonts and real embedded
   font-file relationships. A family must be an exact installed match or have
   valid, embedded font files. The supplied DOCX files use Cambria, Georgia,
   and Palatino Linotype: Palatino Linotype has embedded font data, but Cambria
   and Georgia do not. Those two exact font families must therefore be
   installed in the DOCX conversion environment; fontconfig substitution is
    not a production match. Outside isolated `NODE_ENV=test` layout tests,
    each conversion checks the actual DOCX input and blocks preview, activation,
    and live generation before LibreOffice unless every declared family is an
    exact installed match or has valid embedded font data. Review the
    `document-fonts` result and rendered output. The local audit-evidence PDF
    uses a separately resolved DejaVu Sans
   font, embeds it with fontkit, records its SHA-256, and checks that digest
   during finalization/recovery. Keep that helper font available and stable.
   These are production prerequisites; the whole workflow is not automatically
   production-ready.
3. Configure SMTP through the existing `SMTP_USER` and `SMTP_PASS` server
   secrets. Do not copy credentials into source, client settings, template
   files, logs, or this runbook.
4. In the admin Legal Documents area, explicitly bind only the exact LilyCrest Garden Estate
   property record and confirm its 5 m²-per-unit mapping against the actual
   legal/title records. No fuzzy name matching or other property is supported.
   The admin-only
   `POST /api/admin/legal/templates/import-initial` endpoint imports the
   bundled `server/legal/template-assets/deed_of_assignment_v1.docx` and
   `server/legal/template-assets/transfer_exit_rights_v1.docx` files
   idempotently: it retains an existing version for either document type and
   imports only a missing type. Use the admin-only
   `POST /api/admin/legal/templates` multipart upload route for subsequent
   versions. Resolve placeholder validation errors. Assignee placement is
   verified from the rendered PDF, not supplied by the browser or guessed from
   a director, witness or notary location. Preview the
   `GET /api/admin/legal/templates/:id/preview` rendered/conversion output
   before activating it with `POST /api/admin/legal/templates/:id/activate`.
   An unbound property, absent active template, missing verified user name or
   address, unverified assignee placement, or invalid document data must
   prevent generation/signing; do not work around these gates with frontend
   values.
5. The generated document pins the exact template version and trusted user,
   reservation, property, and approved amount snapshot at creation. Replacing
   a template affects future approvals only. The original DOCX/PDF and final
   locally signed PDF/completion evidence are separate private, write-once
   artifacts.

The supplied deed contains a pre-inserted witness-signature image. The original
upload is retained unchanged. Its normalized copy removes execution-region
graphics and their unused media while retaining legal text, fields, paragraph
formatting and reserved inline height. New templates containing pre-inserted
director, witness, notary or other execution-region graphics are rejected;
logos outside the execution region remain allowed. This workflow must never
copy a third party's signature into a newly generated investor document.

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
fractional holding through another approval endpoint. This is a readiness
blocker for fractional holdings and is reported by
`scripts/legal-readiness.ts`; the legal workflow remains incomplete for any
business requirement that needs fractional-unit approvals.

The legal API currently exposes:

| Method and path | Access / purpose |
| --- | --- |
| `GET /api/legal/holdings` | Authenticated investor's legal-document pairs and statuses |
| `GET /api/legal/documents/:id/preview?version=unsigned` | Owner-only private preview; versions are `unsigned`, `signed`, `certificate`, or `docx` |
| `GET /api/legal/documents/:id/download?version=unsigned` | Owner-only private download; supports the same versions |
| `POST /api/legal/documents/:id/signing-session` | Owner-only short-lived signing challenge and unsigned-PDF digest |
| `POST /api/legal/documents/:id/sign` | Owner-only completion with password reauthentication, explicit consent/review, typed name, challenge, digest, and PNG signature |
| `GET /api/admin/legal/documents` | Admin document-pair overview |
| `GET /api/admin/legal/holdings/:id` | Admin holding detail and property binding |
| `POST /api/admin/legal/binding` | Admin-only explicit property binding; requires `confirmed: true`, `propertyId`, and `sqmPerUnit` |
| `GET /api/admin/legal/readiness` | Admin operational readiness blockers |
| `GET /api/admin/legal/templates` | Admin template-version list |
| `POST /api/admin/legal/templates` | Admin DOCX version upload (`documentType` and multipart `file`) |
| `POST /api/admin/legal/templates/import-initial` | Idempotent import of missing bundled v1 templates |
| `GET /api/admin/legal/templates/:id/download` | Admin source DOCX download |
| `GET /api/admin/legal/templates/:id/preview` | Admin illustrative PDF preview |
| `POST /api/admin/legal/templates/:id/activate` | Admin validation/conversion/signature-position gate and activation |
| `GET /api/admin/legal/pairs/:id/audit` | Admin audit history |
| `POST /api/admin/legal/pairs/:id/retry` | Admin audited retry; permanently blocked after investor signature |
| `POST /api/admin/legal/pairs/:id/resend` | Admin audited notification resend after both unsigned PDFs are ready |
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
template changes, property binding, retry/resend, and administrative review to
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

`vitest.legal.config.ts` intentionally omits the repository-wide
`tests/global-setup.ts` and uses an isolated process context. Run legal-only
unit tests with `npm run test:legal` (or the direct command below). The
first-party signing UI also has mocked native-browser coverage for drawn and
typed signatures, consent/password gates, request headers, local processing,
and external-request blocking:

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
fractional-inventory blocker and does not certify that the workflow is generally
production-ready.

## Review prerequisites and limits

The source templates supply legal wording, but field mapping, the
per-property area/unit binding, font fidelity, signature-field coordinates,
the exact signing-consent version, and the legal suitability and execution
requirements of the completed forms require authorized human review. The
local electronic mark and application evidence must not be described as a
certificate-authority digital signature or a guarantee of legal execution.