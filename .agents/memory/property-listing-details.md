---
name: Property listing information boundaries
description: Admin listing information and the current-price rule for new primary-market reservations.
---

Admins manage a month-and-year Listed Date, Listed Price per Unit, and a
separate Current Price per Unit for property cards and listing details.
The requested land-unit reference is 5 sqm. Listed Date is independent of
the previously requested Sell date; neither is a trading deadline.

**Why:** The user requested editable listing information in Edit Property,
including a month/year-only listing date and a distinct current per-unit
price. The user subsequently explicitly required the current price to be
the purchase price when both listed and current prices exist.

**How to apply:** For NEW primary-market reservations, current price takes
precedence; if absent use the existing listed/unit-type price. Resolve price
and total on the server in the property's original currency, not from a client
amount or a converted display value. Preserve existing reservation snapshots,
ownership, fees, historical investment basis and valuation history. P2P asking
prices are independent. Use saved valuation history for performance calculations.
Omit unset optional information rather than inventing dates or values; clearing
an admin field removes its display and restores the listed-price fallback.
