---
name: Historical rollout authorization
description: Limits of authorization for preparing old investor holdings and legal invitations
---

Historical legal preparation is authorized only through an explicit
property-scoped admin selection and confirmation. This authorization does not
permit correcting live financial/ownership records, inferring historical
payment approvals or automatically preparing/notifying investors on startup,
deployment or template activation.

**Why:** The user authorized a controlled historical legal-signing rollout
while explicitly excluding live rollout during implementation, financial
history changes and replacement of retained legal evidence.

**How to apply:** Keep operational rollout separate from feature implementation
and schema deployment. Resolve ambiguous legacy payment/allocation evidence
outside the rollout, with separate authorization; never turn legal preparation
into financial confirmation or treat an audited attestation as an earlier
payment approval.

Background updates must preserve an in-progress preparation form and its
payment-attestation entries, without automatically adopting changed reviewed
records. Block submission and require explicit review of updated identities
when records or templates change.

**Why:** Background polling closed the preparation form while the user was
entering an attestation. Keeping the form usable must not weaken the explicit
review boundary or silently authorize a different payment/template snapshot.

**How to apply:** Keep drafts during background refreshes and transient load
errors. Fence submission while freshness is unknown or identities differ.
Clear scope-specific state when the administrator changes property or query
scope, not merely because the same records are being fetched again.