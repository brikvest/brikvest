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

A release-status response proves which code answered that request, not that
every older autoscale instance or independently deployed worker has stopped.
Database maintenance locks coordinate only workers that participate in their
protocol; lock acquisition alone cannot establish deployment-wide quiescence.

**Why:** Online PDF-review rollout requires keeping the site available without
letting an old, nonparticipating mail worker bypass the review gate or the pause.

**How to apply:** Verify the completed deployment rollout and every notification
worker before relying on a coordinated database pause. Check retained leases
and unresolved send intents as well; a processing timeout does not cancel an
external mail operation or prove that it has drained.

The user's subsequent request to restore deed/transfer email delivery permits
restoring production dispatch for explicitly approved PDFs. It does not permit
automatic PDF approval, sending incorrect legacy drafts, or enabling development
mail against real holdings.

**Why:** The user reported that the temporary pause and missing review setup
were preventing receipt of signing emails after document corrections.

**How to apply:** Keep exact-PDF review mandatory and verify land consideration
before approving unsigned drafts. Keep development dispatch paused. Treat a
saved production setting as pending until publishing activates it.