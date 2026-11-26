# Flutterwave primary-reservation payments

For the disabled package ready to merge into main, start with the
[main-project handoff](flutterwave-main-handoff.md). It includes the approved
review documents and explicitly separates preparation from production release.

## Current decision: v3 hosted Standard

The owner explicitly switched back to **v3**, reported updating `FLW_SECRET_KEY`,
and retained the same `FLW_SECRET_HASH`. Use the official
[v3 docs](https://developer.flutterwave.com/docs) and
[API reference](https://developer.flutterwave.com/api). The earlier
[v4 investigation](flutterwave-v4-contract.md) is historical and no longer blocks
the selected v3 flow. No OAuth or v4 webhook migration is required.

The owner reports completed sandbox testing, merchant KYC, and enabled currencies
NGN, USD, GBP and EUR. Intended production settings are
`FLW_RETURN_ORIGIN=https://brikvest.net` and `FLW_CURRENCIES=NGN,USD,GBP,EUR`.
Always charge the reservation currency, never the display currency or an FX conversion.

Read-only rollout checks found a public successful deployment at that origin and
both secret names present in production configuration. Secret contents, provider
acceptance and the active deployment's adoption of the updated key were not
verified. The production query interface reports all six Flutterwave tables
absent; the Flutterwave guard is absent too. Production payment flags, origin and
currency settings were unset. **Do not enable collection yet.** Database target
identity, ownership, backups and the supported schema/guard publication path still
need verification before any authorized schema changes. No schema changes,
publishing, charges, provider probes or email dispatch were performed during
those initial checks.

After separate owner authorization, the six empty Flutterwave tables and their
guards were installed and catalog-verified in **development only**. Production
still has no Flutterwave tables. No existing investor records were changed and
collection remains disabled. The owner confirmed seven-day production PITR.

The [schema rollout preparation](flutterwave-v3-schema-rollout.md) records the
remaining gates and the separately identified missing exact-PDF approval guard.

## Release status and safety boundary

Live-launch status, saved production settings and the remaining owner actions
are recorded in [flutterwave-main-live-readiness.md](flutterwave-main-live-readiness.md).
In live mode, checkout creation and gateway approval additionally require the
three owner-installed database safeguards from the
[owner run sheet](flutterwave-owner-run-sheet.md); verification, webhook
intake, recovery and link closure never depend on them.

This implementation is **disabled by default**, defaults to **test mode**, and does
not create database objects at startup. No migration, live charge, publishing,
historical holding changes, or investor mail is authorized by this implementation.
The development database contains real investors. Do not use it for payment tests.

Bank transfer/proof submission remains the existing alternative. This integration
does not cover resale, payouts, subscriptions or instalments.

Receiving and server-verifying a charge means **Awaiting admin approval**.
Only an explicit authorized action in **Payment Reviews → Flutterwave payments**
confirms an investment. Reconciliation rows cannot be approved. Gateway receipts
are not fabricated uploads in `payment_submissions`.

## Contract selected

Flutterwave v3 Standard, checked against official documentation on 2026-10-31:

- Hosted checkout: `POST https://api.flutterwave.com/v3/payments`, Bearer secret
  key. Send unique `tx_ref`, decimal amount string, explicit currency, customer
  email and server-controlled redirect URL; accept only HTTPS links on
  `checkout.flutterwave.com`.
  <https://developer.flutterwave.com/docs/collections-inflow/flutterwave-standard>
- Transaction verification: `GET /v3/transactions/{id}/verify`.
  <https://developer.flutterwave.com/api/transactions/verify-transaction>
- Missed-event lookup: `GET /v3/transactions/verify_by_reference?tx_ref=...`,
  followed by verification by provider transaction ID.
  <https://developer.flutterwave.com/api/transactions/verify-transaction-with-tx-ref>
- v3 webhook authentication: constant-time comparison of `verif-hash` against the
  merchant's configured secret hash. **Not** the v4 HMAC signature contract; raw
  request bytes are not required for this selected v3 scheme.
  <https://developer.flutterwave.com/docs/webhooks>

`charge.completed` notifications are persisted as verification work **before**
acknowledgement. Only a server-to-server verification result can supply payment
evidence. Redirect `status`, reference, amount, currency and transaction ID are
untrusted hints. Browser authentication/ownership still apply to return/recheck.

Unlike the provider guide's example accepting overpayments, this product requires
exact positive decimal equality of both `amount` and `charged_amount` with the
immutable expected amount, plus matching currency and reference. Provider
overpayments, shortfalls, extra fees, invalid precision or unsafe JSON numeric
amounts are reconciled, not silently converted, allocated or refunded.
Configure the merchant to absorb gateway fees; this app adds no surcharge.

## Merchant and currency prerequisites

Before enabling even a merchant test pilot:

1. Confirm the merchant entity and account can accept this investment use case.
   Obtain any required Flutterwave business approval, transaction limits and
   settlement permissions. The app cannot establish merchant eligibility.
2. Confirm each settlement/collection currency is enabled for that merchant and
   that its payment methods accept the relevant amount limits.
3. Select an explicit currency allowlist. It is empty by default. Never infer it
   from the investor's display preference or silently fall back to NGN.
4. Configure webhook and retry delivery in the **test merchant environment**.
5. Use a separately authorized, isolated staging database and synthetic accounts
   for any provider sandbox exercise. Mocked tests need no credentials.

## Secrets and environment setup

Use **Replit Secrets** for `FLW_SECRET_KEY` (test key initially) and
`FLW_SECRET_HASH` (random webhook hash, also set in Flutterwave). Never paste
credentials into chat, source, shell arguments, screenshots or committed files.
Use the workspace Secrets request flow if credentials are later required.
No public key or card data collection is needed for hosted Standard checkout.

Non-secret settings, configured only in the intended isolated environment:

| Setting | Default | Meaning |
| --- | --- | --- |
| `FLW_ENABLED` | false | Explicitly enable configured checkout/verification |
| `FLW_MODE` | test | `test` requires a `FLWSECK_TEST-` secret; live/test credentials cannot be mixed |
| `FLW_CURRENCIES` | empty | Merchant-approved exact currency codes, e.g. `NGN` after approval |
| `FLW_RETURN_ORIGIN` | absent | Clean HTTPS origin, no path/query/credentials |
| `FLW_LIVE_AUTHORIZED` | false | Separate explicit live-collection authorization; saved for production only, never in development |
| `FLW_WORKER_ENABLED` | false | Recover queued verification and missed events while the server is active |
| `FLW_NOTIFICATION_DISPATCH` | false | Separate authorization to deliver confirmed-investment emails |

With an actual independently verified published/staging origin, configure:

- Flutterwave webhook: `{origin}/api/payments/flutterwave/webhook`
- Checkout return (generated by the server): `{origin}/dashboard?flutterwaveReturn=1`

Do not derive a production URL from a Replit development hostname. Obtain and
verify the published URL separately before release. A saved setting is not proof
that the running release uses it.

## Explicit schema rollout (not run by this task)

`scripts/ensure-flutterwave.sql` is additive and idempotent. It creates attempt,
charge, verification-work, audit, checkout-closure and confirmation-intent tables and an immutable
expected-price trigger. It does not backfill or change investors or holdings.
Shared Drizzle definitions describe the same objects; **do not run generic
`drizzle-kit push`**. This script is deliberately not in post-merge startup.

After separate database-rollout authorization, follow the
[target-specific rollout plan](flutterwave-v3-schema-rollout.md). The SQL file is
an isolated-test/development contract, not permission for direct production DDL.
For a managed production database, use reviewed publication for supported schema
objects and the supported owner-operated SQL-console path for separately reviewed
functions/triggers; do not run this script directly against production.

Required checks:

1. Verify exact target/database identity and backups; establish that old app
   instances and workers cannot race new payment handling.
2. Verify existing reservation inventory-accounting, ownership-certificate,
   legal-generation and exact-PDF review schema prerequisites.
3. Apply only the separately approved development schema changes against the
   verified development target; test idempotence on disposable data.
4. Check the tables, indexes, trigger and permissions. Do not alter existing
   financial rows or generate historical certificates/documents.
5. Release the prepared code with collection, worker and mail flags still off.
   Enable an isolated test pilot only after explicit approval.

## State and concurrency rules

- `initiated` / `verification_pending`: no inventory extension. Uncertain
  creation/returns remain unresolved rather than allowing a second blind charge.
  Use **Check status** or an admin recheck by persisted reference.
- `failed` / `cancelled`: established by provider verification, not URL parameters;
  retry or bank transfer remains possible.
- `awaiting_admin`: server-verified full receipt only; protected from ordinary
  expiry and awaiting explicit admin approval.
- `reconciliation`: late/expired/already-paid/changed-KYC or pricing, duplicate
  actual charge, manual/gateway conflict, unsupported evidence. No allocation,
  refund or automatic correction. All actual charges are retained separately.
  Unmatched provider charges are visible in Payment Reviews too.
  An earlier failed attempt succeeding after a replacement session starts
  reconciles **both** attempts; the replacement link is durably queued for
  provider-side disabling. A link still being created is withheld from the
  investor, captured in the closure queue and disabled after creation. Failed
  disable requests remain queued, with pending/confirmed closure visible to
  admins; never assume an external hosted page is disabled after a network error.
  Link closure uses the documented v3 `POST /payments/link/disable` with the
  saved link; `data:true` or the exact documented already-inactive response
  confirms closure. A failed individual transaction cannot start a replacement
  before its original hosted session expires, since the original page may still
  allow retries. No abandoned checkout extends ordinary reservation expiry.
  Bank instructions, proof uploads and manual approvals are also blocked while a
  hosted session is unresolved or still unexpired, including ambiguous checkout
  creation and failed individual transactions. This rule is enforced under the
  reservation/property lock, not only in the modal. An unsuccessful expired
  session permits the existing bank-proof workflow again.
- `approved`: the reservation conversion, existing inventory-provenance handling,
  audited legal eligibility evaluation, certificate and confirmation outbox are
  committed together.
- `rejected`: reason/admin/time are retained. **No refund was issued**. Do not
  invite another payment. Collected unresolved evidence continues protecting
  inventory pending separately authorized reconciliation.

Verification, expiry and review lock the holding/property before payment evidence.
Manual approvals cannot bypass collected gateway evidence; competing proofs route
gateway money to reconciliation. Unique references, transaction identities,
certificate reservation IDs and confirmation intents prevent repeated effects.
The first successful verified receipt is retained on the attempt; additional
actual charges remain separate and force reconciliation without another allocation.
Administrative cancellation is also serialized against verification. Collected
or unresolved hosted payments block cancellation and inventory release, including
the generic reservation storage path. Ordinary expiry still does not extend a
hold merely because checkout was initiated. Unencumbered bank reservations use
an atomic cancellation/release transition with the existing inventory provenance.

Legal generation reuses the guarded confirmation and full-payment attestation
boundary, with the verified provider reference/transaction and approving admin in
the audit note. Non-NGN purchases remain ineligible for NGN-only legal generation.
No change is made to principal/fees, legacy holdings, or legal signature rules.
Every new signing notification still requires review of both **exact investor
PDFs**, not merely payment or template approval.

## Recovery and delivery operations

Enable the recovery worker only in the approved environment. When enabled it
runs one pass about 15 seconds after the server starts and then every minute
while the instance is awake, logging a count-only completion line. It polls queued work
and unresolved references; provider failures stay durable and retry after five
minutes. Rechecks are also available per attempt in Payment Reviews and from the
investor modal. **Recover pending work** invokes the same bounded recovery batch.
Autoscale may sleep: do not rely on an in-process timer for an operational SLA.
For continuous recovery, use an authorized always-running instance or an external
operator/scheduler invoking the authenticated admin recovery endpoint; never expose
the admin token publicly or put it in source.

Confirmation email uses a durable claim-before-send intent. SMTP does not support
exactly-once delivery. Queued intents recover safely; a crash while `sending` or
uncertain send result is **quarantined**, not automatically resent. Payment Reviews
shows notification state. An operator must inspect provider delivery evidence
before any separately authorized resend. This prioritizes avoiding duplicate
investor confirmations over automatically retrying an ambiguous SMTP send.
Certificate persistence and legal-generation jobs are transactional/idempotent.
No email is sent in test mode or with mail dispatch disabled.

## Isolated validation

```
npx vitest run --config vitest.flutterwave.config.ts
LEGAL_FRONTEND_ONLY_BASE_URL=http://127.0.0.1:5173 npx playwright test --config playwright.flutterwave.config.ts
npm run build
```

Unit/integration tests use disposable in-memory PGlite, mocked provider calls and
blocked email. They never use the live development database. Browser tests launch
only Vite, intercept every API request and abort external origins; neither the
application backend nor real provider/SMTP requests are used. Desktop/mobile
journeys include bank transfer, uncertain checkout, verified return, approval and
rejection. Existing legal suites cover the independent exact-PDF signing gate.
PGlite serializes in-process transactions, so mocked race tests exercise idempotent
outcomes and SQL lock boundaries, not multi-connection PostgreSQL scheduling.

## Separate live go/no-go

Live collection requires a new explicit authorization after merchant approval,
currency/limit verification, target schema installation, a verified published
return origin, live webhook/authentication/retries, recovery operations, matching
live credentials, fee absorption configuration, isolated sandbox evidence and
operator reconciliation procedures. Publishing and real test charges are not part
of this task. Do not turn on live or investor mail in development.
