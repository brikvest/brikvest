---
name: Investor PDF review release boundary
description: Administrative PDF review is distinct from payment approval and controls every new signing invitation.
---

Require explicit administrator approval of both exact generated investor PDFs
before any new signing notification, including reminders and previously queued
unsent work. Automatic generation, payment approval and template validation are
not PDF-review approval. Preserve accepted invitations, uncertain delivery
quarantine and all retained signing evidence.

**Why:** The user required a review-before-notification workflow for both
historical holdings and future purchases, without live preparation or release
during feature implementation.

**How to apply:** Keep the mail-attempt boundary gated, not just the admin UI.
Approval must identify both immutable document IDs and PDF hashes. Deployment
must pause/drain old workers before enabling the new gate; mixed old/new workers
can otherwise send unreviewed invitations. Schema rollout does not authorize
review approval, live preparation or investor mail.