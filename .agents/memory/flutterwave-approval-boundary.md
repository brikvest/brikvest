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

**Why:** This is an explicit replacement of the earlier v4-only requirement, not
a silent version fallback. It resolves the hosted-flow selection, but does not
establish production schema readiness or authorize real charges.

**How to apply:** Resolve the provider's initial collection and expiry/closure
contract before replacing checkout; inspect versioned HTML/schema when Markdown
or code samples disagree.
