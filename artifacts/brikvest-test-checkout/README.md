# Brikvest Test Checkout

**Workspace-only, synthetic data, Flutterwave v3 TEST credentials only.**
This is not the live Brikvest website. No investment, ownership, refund,
Brikvest email, SMS, legal document or production activation is provided here.
The owner separately authorized Flutterwave's test-payment emails to the
business address; this does not enable Brikvest delivery or real payments.
Never import these transactions into the real website.

## Open and run

For the hosted payment test, open the test app in its own browser tab rather
than inside the embedded preview. Complete the provider-hosted page using only
Flutterwave's documented test instruments, then return in that same browser.
The tab shares this preview origin's synthetic session; no real account login
or main-site session is used.

Choose **Brikvest Test Checkout** in the artifact selector, or open
`/brikvest-test-checkout/` in this workspace's preview. Its managed workflow is
`artifacts/brikvest-test-checkout: web`, running
`pnpm --filter @workspace/brikvest-test-checkout run dev`.
Do not run the real API backend for this application.

The app creates a separate synthetic browser session automatically. There is no
Brikvest account login and no real administrator access. Return from hosted
checkout in the same browser/profile so the isolated session is retained.
Clearing browser storage loses access to that session; it does not erase
the durable test payment evidence.

Every reservation is fixed at **1 unit, 10 m², NGN 1,200.10**, using a fictional
property and a server-generated `synthetic-…@example.test` identity. Pricing,
currency, customer identity and callback URL cannot be supplied by the browser.
Use **New synthetic reservation** for another independent test; inspect/recheck
an unresolved earlier reservation rather than paying it again.

## Test setup and scope

The dedicated test credentials, existing private return origin, owner review
waiver and private browser-return scope are now configured. Checkout creation
was accepted by the real provider test API, and its hosted page returned HTTP
200. A genuine provider-hosted test payment was subsequently completed and
server-verified on 2026-11-21 (see the evidence below). Regression fixtures
are not payment evidence. The page reports missing settings without probing
Flutterwave. The existing `FLW_SECRET_KEY` and `FLW_SECRET_HASH` are never used
or overwritten. The configuration details below document how to reproduce this
setup without publishing or changing privacy.

1. Record a completed migrated-main-site review with
   `BRIKVEST_TEST_PORT_REVIEWED=true`, or an explicit owner waiver with
   `BRIKVEST_TEST_PORT_REVIEW_WAIVED=true`. The owner waived this prerequisite
   for private isolated testing on 2026-11-20. A waiver is not a claim that the
   main site was reviewed.
2. Through Replit's secure Secrets settings/form, add dedicated
   `BRIKVEST_TEST_FLW_SECRET_KEY` (v3 `FLWSECK_TEST-…` only) and
   `BRIKVEST_TEST_FLW_SECRET_HASH`. Do not paste credentials into chat.
   Use a separate test-mode merchant configuration, never a live key or the
   real site's webhook hash.
3. Set non-secret `BRIKVEST_TEST_RETURN_ORIGIN` to the **existing preview's exact
   HTTPS origin**, with no path/query/credentials/port. This is not a production
   URL. The service checks the host against the platform's current preview host.
   It will not accept `brikvest.net`, an arbitrary domain, or localhost as a
   provider return origin. If the preview host changes, review/reconfigure it.
4. The return path is `/brikvest-test-checkout/dashboard?flutterwaveReturn=1`.
   The test webhook path is `/brikvest-test-checkout/api/webhook`. Only
   `charge.completed` with the dedicated `verif-hash` and an existing synthetic
   reference can queue a server verification.
5. **Callback access requires owner confirmation.** A private preview may allow
   the owner to return in their browser but block provider webhooks. This task
   has not published anything, changed privacy/access, provisioned another
   origin, or created an access token. Do not assume webhook reachability.
   The owner approved **private browser-return testing with explicit server
   rechecks**, not automatic webhook delivery. Record this scope with
   `BRIKVEST_TEST_CALLBACK_MODE=private-browser-return` and
   `BRIKVEST_TEST_CALLBACK_APPROVED=true`. Use the same browser signed into
   Replit for the return. The flags record agreed scope, not webhook
   reachability. Keep webhook delivery explicitly unverified.
   Do not expose the real app or put a bypass token into logs, redirects or
   source control. Any future external-access setup needs separate approval.
6. **Flutterwave can send mail itself.** Its official testing documentation says
   test receipt emails go to the business email. The owner explicitly authorized
   those **Flutterwave test-payment emails to the business address** on 2026-11-20.
   Record that permission with development-only non-secret
   `BRIKVEST_TEST_PROVIDER_EMAILS_AUTHORIZED=true`. Do not set a
   notifications-disabled flag unless notifications were actually confirmed
   disabled. Alternatively, independently confirm test notifications are disabled
   before setting `BRIKVEST_TEST_PROVIDER_NOTIFICATIONS_DISABLED=true`.
   The page distinguishes these policies. Neither option enables Brikvest mail,
   uses SMTP secrets, authorizes real customer email, or changes production settings.
   If neither policy is established, checkout stays blocked.
7. Optional `BRIKVEST_TEST_MODE` may only equal `test`. Restart **only the sandbox
   workflow** after changing settings. All requirements are checked again before
   every provider operation. Settings readiness does not prove that a payment
   or webhook was tested.

No public key is required for the server-created v3 hosted Standard flow.
No credential is returned to the browser. No live merchant settings are changed.

## Hosted test journey once setup is established

Open the app in its own preview tab, inspect the synthetic reservation, then
choose **Continue to Flutterwave test checkout**. All payment data is entered
on `https://checkout.flutterwave.com`, never in Brikvest. Use only the
[official v3 test instruments](https://developer.flutterwave.com/docs/testing)
and the provider's test mode; never enter a real card, real account, phone
number, PAN/CVV/PIN/OTP or customer identity into this app.

After returning, the server ignores browser `status` and resolves the persisted
reference with Flutterwave, then verifies the transaction server-to-server.
The returned transaction ID is not used to attach evidence to another session.
Use **Recheck receipt** when a result is unresolved. Reload/Refresh reads the
persisted state; it is not a provider verification by itself. No recovery/mail
background workers run. Authenticated webhooks and explicit rechecks perform
bounded verification; queued work stays stored when the provider is unavailable.

### Status meanings

| State | Meaning/action |
| --- | --- |
| Payment started | A server reference exists. Do not start another payment for it. |
| Verification pending | Provider creation or outcome is uncertain. Recheck; never assume failure means safe repayment. |
| Payment failed/cancelled | Only a verified provider response can set this. The existing hosted session must expire before a replacement is allowed. |
| Payment received — awaiting admin approval | Exact amount/currency was server-verified. It is **not ownership**. This sandbox has no approval action. |
| Reconciliation | Mismatched/late/competing evidence needs investigation; no allocation or refund. Do not pay again. |

Duplicate returns/webhooks retain one charge identity. Additional actual
transactions are separate evidence and follow the existing reconciliation
rules. The database prohibits approval, sold units and real customer identities.

## Reset disposable records

The **Reset** button requires typing `RESET SYNTHETIC RECORDS`.
It removes only this browser session's synthetic reservations and related
evidence, then makes one fresh fixed reservation. It never affects another
session or any real database. Reset refuses unexpired hosted links, unresolved
verification and reconciliation. Reset is not a refund or provider cancellation.

Embedded data persists across workflow restarts under
`generated-artifacts/brikvest-test-checkout/database/`. This path is fixed at
build time and is excluded from Git/deployment. Startup validates the disk
marker, database purpose and synthetic records and rejects symlink paths or
unknown stores; it never accepts a database URL.

Do not delete the store just to clear an unresolved checkout. For an exceptional
full disposable-store reset, first have the operator resolve/disable **all**
test checkout links in the separate provider test configuration and retain
whatever test evidence they need. Stop the sandbox workflow, verify the
`sandbox-identity.json` marker identifies `brikvest-synthetic-checkout-v1`,
then remove **only that exact sandbox database directory** and restart the
sandbox workflow. This loses all test sessions, and is intentionally not an
HTTP operation. Never substitute a connection string, a main data directory,
a production database, or a generic database reset/migration command.

## Isolation design

- The launcher creates a child process with an explicit environment allowlist:
  only platform runtime essentials and dedicated `BRIKVEST_TEST_*` settings.
  No dotenv, normal DB/alternate DB, main gateway, SMTP or shared session secrets.
- An esbuild sandbox-only adapter reuses the **current, unchanged**
  `artifacts/api-server/src/payments/flutterwave.ts`, gateway guards and checkout
  closure service. It replaces the DB and provider boundaries explicitly.
  The legal approval dependency is a throwing stub; unreachable review code
  is removed. A build import allowlist and output checks refuse normal DB pools,
  storage, notifications, workers and application startup.
- Precise amount/transaction/host validators are reused from the original
  provider module, with its real configuration/network functions tree-shaken out.
  There is no copied or independently implemented receipt lifecycle.
- PGlite is embedded local storage, with synthetic-only schema constraints and
  immutable attempt expectations. There is no network database driver/fallback.
  Only the existing gateway schema is initialized in this embedded store.
- The provider adapter allows only the exact v3 payments, transaction verification,
  verify-by-reference and hosted-link-disable operations over the fixed HTTPS API
  host, with redirects refused and bounded timeouts. No refunds, arbitrary URLs,
  arbitrary operation paths, currencies, customer details or real prices.
- A separate random bearer capability is hashed in the embedded database.
  The browser uses `credentials: omit`. No cookie or real admin middleware is
  read, issued or shared. Same-origin checks/rate limits guard browser mutations.
- No main API routes were added. The service owns only
  `/brikvest-test-checkout/`. It is excluded from publishing via `.replitignore`;
  neither the sandbox nor its database ships with the real site.

## Verification record

Run from the workspace root:

```sh
pnpm --filter @workspace/brikvest-test-checkout run test:isolation
pnpm --filter @workspace/brikvest-test-checkout run typecheck
pnpm run test:flutterwave
# With the managed sandbox workflow already running:
pnpm --filter @workspace/brikvest-test-checkout run test:browser
```

Verified 2026-11-20:
- 21 sandbox isolation/lifecycle regression tests passed. Provider responses in
  these tests are **mocked**, with real outbound networking refused.
- 46 existing isolated Flutterwave regression tests passed unchanged.
- Sandbox TypeScript check passed.
- Four desktop/mobile browser journeys passed against the actual managed
  sandbox service and its embedded database, with **no API mocks**: inspect,
  create, reload, reset, and reject forged successful returns.
- Desktop/mobile screenshots inspected; setup blockers and the persistent test
  banner rendered correctly.
- **Genuine provider API requests were made** with the dedicated test key.
  Flutterwave accepted checkout creation with HTTP 200 but returned
  `checkout-v2.dev-flutterwave.com`, which the shared main-site URL validator
  correctly refused because its allowlist contains only `checkout.flutterwave.com`.
  The sandbox adapter alone now accepts that exact additional HTTPS host,
  only behind the complete test-only fence and only its `/v3/hosted/pay/<id>`
  path without credentials, query, fragment or custom port. Main-site behavior
  is unchanged. No wildcard domains are allowed.
  After the sandbox-only adjustment, a fresh synthetic checkout returned HTTP
  200, its provider-hosted HTML loaded with HTTP 200, and the stored attempt
  remained `initiated`, not paid. These checks did not submit a test card or
  establish a verified payment receipt.
- The initial API-only checks above created sessions, not payment receipts.
  They did not submit card details. The subsequent genuine hosted-payment
  journey below is recorded separately.

### Genuine provider payment verified on 2026-11-21

- One fresh browser-only synthetic session completed one provider-hosted
  Flutterwave v3 TEST payment for **NGN 1,200.10**. Only Flutterwave's
  documented Mastercard test instrument was entered, on the provider page,
  including its test PIN and OTP. One Pay submission and one OTP confirmation
  were made. No real card was used.
- Synthetic reservation: **331**. Reference:
  `brk_dd3764b1-e592-45d4-90ef-add6b9f19733`.
- Server-verified provider transaction: **10629930**.
- Stored provider status: `successful`; amount/currency: `1200.10 NGN`.
  The attempt is `awaiting_admin`, with verified time
  `2026-11-21T21:14:05.861Z`. The UI displayed
  **Payment received — awaiting admin approval**, persisted after refresh.
  A separate identity-checked, read-only inspection of the embedded sandbox
  database confirmed the verified receipt and audit event. No ownership was
  granted, and no real account, database or Brikvest delivery service was used.
- The first browser load returned 502 because the sandbox workflow was
  stopped. Restarting only its managed workflow restored HTTP 200. No privacy
  or access controls were changed.
- Automatic provider webhook delivery remains **unverified**, as explicitly
  accepted for this private browser-return scope. Genuine cancelled/failed/
  pending-charge and replay scenarios were not separately charged through the
  provider; their lifecycle protections are covered by the isolated mocked
  regressions, not claimed as genuine provider test results.
- The owner's earlier reference beginning `brk_4d04bc40` was preserved. Its
  embedded record had a checkout URL but no provider transaction ID, verified
  receipt or recorded charge. It remains `verification_pending`, not falsely
  failed or paid. This does not establish where the original hosted interaction
  stopped or authorize another payment for that reservation.

Creating/opening a hosted session or pressing **Recheck receipt** does not
submit a payment. Complete the provider's test-card, PIN and OTP steps on its
page, then return to the same browser session. Never retry an already-submitted
payment merely because a dashboard entry or verification result is missing.

## Later production work

This sandbox does not authorize enabling or publishing payments on Brikvest.
Only after a separately approved rollout may the shared main integration be
enabled with its real schema, immutable reservation/inventory prerequisites,
approved live configuration, explicit administrator review and existing legal/
notification release gates. See the existing `docs/flutterwave-main-handoff.md`
and `docs/flutterwave-v3-schema-rollout.md`; do not execute their rollout steps
from this sandbox. Never transfer the disposable store into real holdings.

Provider references:
- [Hosted Checkout / v3 Standard](https://developer.flutterwave.com/docs/collections-inflow/flutterwave-standard)
- [Testing, including business receipt delivery](https://developer.flutterwave.com/docs/testing)
