---
name: Legacy reservation inventory
description: Why historical reservations cannot be assumed to contribute to reserved-unit counters
---

Do not infer an individual historical holding's reserved-unit contribution from a property's aggregate counter. Preserve other holdings' known allocations when approving, cancelling, expiring or reinstating an older reservation.

**Why:** Before 2026-10-01, public reservation creation updated legacy slot availability but not reserved-unit counts, while other creation paths could update units. Historical records therefore do not have uniform inventory provenance. Guessing a backfill can consume units allocated to a different holding.

**How to apply:** Preserve explicit per-holding attribution for new reservations. Treat historical attribution as unknown unless the aggregate demonstrably covers all untracked active holdings; otherwise retain those counts rather than borrowing another holding's allocation. Never run a blanket historical backfill against the live investor database.