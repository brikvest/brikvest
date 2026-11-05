---
name: Property listing information boundaries
description: Listed month and current per-unit display price are admin-managed information, separate from checkout and valuation history.
---

Admins manage a month-and-year Listed Date, Listed Price per Unit, and a
separate Current Price per Unit for property cards and listing details.
The requested land-unit reference is 5 sqm. Listed Date is independent of
the previously requested Sell date; neither is a trading deadline.

**Why:** The user requested editable listing information in Edit Property,
including a month/year-only listing date and a distinct current per-unit
price. This did not authorize repricing purchases or rewriting valuation
history, ownership, fees, or historical investment basis.

**How to apply:** Preserve the existing listed/purchase-price calculation.
Treat the separate current price as display information, not a new input
to checkout or portfolio performance. Use saved valuation history for
performance calculations. Omit unset optional information rather than
inventing dates or values; clearing an admin field must remove its display.
