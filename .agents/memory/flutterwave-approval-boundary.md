---
name: Gateway payment approval boundary
description: Product authorization and release boundaries for primary-reservation Flutterwave payments
---

Server-verified Flutterwave success means payment received awaiting admin approval,
not confirmed ownership. Reuse the existing guarded investment lifecycle; keep
gateway evidence distinct from uploaded bank-transfer proof.

**Why:** The user explicitly requires human approval before allocating units and
retains the separate exact-investor-PDF approval before any signing notification.
Adding a gateway does not authorize automatic investment approval or refunds.

**How to apply:** Preserve this separation in callbacks, reconciliation, expiry,
dashboard prompts, administrative confirmation and downstream notifications.
Collected unresolved payments must not invite repayment, including after rejection.
Apply the same financial-resolution boundary to explicit cancellation, not only
ordinary expiry. A superseded external checkout remains a collection risk until
the provider confirms it disabled; an internal status change alone is insufficient.
An unresolved hosted checkout also blocks switching to bank transfer/proof;
warnings alone do not prevent double payment while an external page can collect.
Live collection, real test charges, schema rollout, publishing and investor mail
require separate authorization; development data is real investor data.

The owner explicitly switched back from v4 to v3, reported updating the secret
key and keeping the same webhook hash. Use the official v3 docs/API and hosted
Standard flow; do not keep pursuing the earlier v4 migration or provider request.
Preserve provider-hosted initial collection; do not collect PAN, CVV, PIN or OTP
in the app.

The owner authorized a separate, isolated v3 test checkout using synthetic
accounts, properties and reservations, test-only credentials and no email.
Test records must never be transferred into actual investor holdings.

**Why:** The owner accepted testing outside the live Brikvest website before
returning the shared integration to the production rollout.

**How to apply:** Keep the test database, credentials, session access and delivery
dependencies isolated. This authorization does not enable real charges, live
collection, production schema changes or publishing the live gateway.

Keep the existing checkout preview private unless the owner explicitly changes
that instruction. Do not expose it, add an access bypass or publish a separate
callback origin merely to make webhooks reachable.

**Why:** On 2026-11-20 the owner selected keeping the current preview private
when asked about callback access.

**How to apply:** Treat external webhook reachability as unestablished and
report it separately from browser-return or mocked regression results. Continue
safe synthetic inspection without relaxing access controls.

The owner subsequently approved private browser-return checkout testing and
explicitly waived the main-site migration-review prerequisite for this isolated
sandbox.

**Why:** The owner chose to proceed with the synthetic checkout without coupling
it to a separate main-site review. They did not authorize a public preview.

**How to apply:** Record a waiver rather than falsely recording that the main
site was reviewed. Permit private browser returns and explicit server rechecks,
but continue reporting automatic webhook delivery as unverified until evidenced.
This does not waive dedicated test credentials or any real-data safety fence.

Flutterwave's authenticated v3 TEST API can return a hosted checkout on
`checkout-v2.dev-flutterwave.com`, even though the public Standard API examples
use `checkout.flutterwave.com`.

**Why:** Genuine test-session creation succeeded but the older URL guard
rejected the provider's sandbox host. Mocked links on the documented host did
not reveal this difference.

**How to apply:** Validate the origin returned by the fixed authenticated
provider API, and use an exact sandbox-only host/path allowlist. Do not broaden
the real site's allowlist or trust arbitrary URLs supplied by the browser.

The owner authorized Flutterwave's test-payment emails to the business address
on 2026-11-20 after being told that the provider can email even in test mode.
This is a narrow exception to the original no-email sandbox requirement:
Brikvest's own email/SMS, real customer notifications and live payments remain
prohibited.

**Why:** Flutterwave's v3 testing documentation says test receipts go to the
business email. The owner explicitly accepted those provider-generated emails,
not activation of the application's delivery infrastructure.

**How to apply:** Record provider test-email consent separately from a claim
that notifications are disabled. Keep application mail disconnected and retain
the private-preview, dedicated-test-key, synthetic-data and live-payment fences.
Do not alter production notification settings to implement this exception.

**Why:** This is an explicit replacement of the earlier v4-only requirement, not
a silent version fallback. It resolves the hosted-flow selection, but does not
establish production schema readiness or authorize real charges.

**How to apply:** Resolve the provider's initial collection and expiry/closure
contract before replacing checkout; inspect versioned HTML/schema when Markdown
or code samples disagree.
