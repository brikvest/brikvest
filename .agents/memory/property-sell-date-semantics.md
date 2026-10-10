---
name: Property Sell date semantics
description: Product scope boundary for the admin-managed listing Sell date
---

The user requested Sell date as optional listing information only, managed by
admins. It must not become a reservation deadline or trigger selling, status
changes, notifications, countdowns, or availability changes.

**Why:** The requested date communicates property information without changing
investment behavior; those operational meanings require separate authorization.

**How to apply:** Preserve this boundary when extending property dates. Developer
editing, per-unit-type dates, resale dates, and historical backfills are not
authorized by the original Sell date request.
