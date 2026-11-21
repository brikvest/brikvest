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
Provider-confirmed link disable is not, by itself, transaction finality: earlier
submissions can still settle. Do not erase attempted-payment evidence or enable
same-link resume without a provider-backed guarantee covering those submissions.

**Why:** Transaction verification describes known transactions; it does not
establish that a hosted link has no other in-flight collections. The sandbox's
guided recovery must not turn missing evidence into permission to pay or delete.

**How to apply:** Retain unresolved and terminal checkout evidence unless a
separately established provider finality contract explicitly permits retirement.
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

On 2026-11-21 the owner separately approved preparing a sandbox-only private
webhook access arrangement, including investigation of a separate private
development workspace. This does not authorize publishing, exposing the main
site, a public relay, or tokens in redirects or logs.

**Why:** Approval was explicitly requested because the existing browser-return
scope did not cover external webhook access. Project-level access tokens in
the shared project would also grant access to the main site.

**How to apply:** Keep that preparation separate from activation and proof of
delivery. Establish provider-compatible private access without broadening
main-site access before claiming closed-tab webhook verification. A new
sandbox artifact in the same project does not isolate a project-level token.

Probe the actual sandbox webhook externally without cookies or bypass tokens
before deciding private-preview access requires a new project, relay or custom
provider header.

**Why:** An access restriction had been assumed from the owner's private-preview
choice, but an actual unauthenticated external POST reached the sandbox's own
signature rejection. Documentation about private access alone did not establish
the active route's behavior.

**How to apply:** Distinguish platform access rejection from application-level
HTTP 401. Never infer genuine provider delivery or the privacy of other routes
from that probe; still require an authentic provider event and server-verified
receipt. Recheck the configured return origin against the current preview host
when the workspace preview changes.

For webhook-only payment proof, explicitly block automatic browser verification
on the server when browser tooling cannot intercept the return navigation.
Restore normal return/recheck behavior after the trial.

**Why:** The hosted provider can auto-redirect immediately after OTP success,
before the tester can close the tab. Merely avoiding a Return button does not
exclude browser-triggered verification as the receipt source.

**How to apply:** Reject callback HTML before application scripts load and
reject the return/recheck APIs before side effects. Correlate authenticated
webhook evidence, provider delivery logs and the persisted receipt. Describe
auto-return to a blocked page honestly rather than claiming the tab closed
before webhook delivery.

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

For staged payment releases, application-wide mail suppression and queue
maintenance are separate controls. A transport refusing delivery must not be
described as having paused every notification queue.

**Why:** Payment and legal dispatch switches do not cover unrelated application
mail, while a transport-level failure can still consume an existing worker's
retry allowance or mark delivery uncertain.

**How to apply:** Keep the application-mail fence in place during preparation
and require every scheduled and manual queue-claim path to honor it before
changing leases, attempts or delivery evidence. Verify the pre-claim protocol in
every active release instance; do not reset ambiguous in-flight deliveries or
confuse mail-free manual document generation with permission to send mail.

Changes to the shared payment/provider interface must be checked against both
the main integration and the isolated checkout's compiled bundle.

**Why:** The sandbox substitutes its own provider adapter, so a main-side
regression suite can pass while the sandbox lacks a newly required export.

**How to apply:** Validate both implementations with isolated, mocked-network
checks. New sandbox adapter methods must retain the complete test-key,
synthetic-data and environment fences, even when main-side recovery has
different collection-pause semantics.
