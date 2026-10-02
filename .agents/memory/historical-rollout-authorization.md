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