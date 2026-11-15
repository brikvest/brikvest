---
name: Portfolio performance scope
description: Overall and individual-asset performance views must coexist without changing financial basis.
---

Keep overall portfolio land-appreciation and investor-performance graphs, and
also let investors inspect those two graphs separately for each owned property.
An asset is a property, not a single purchase: multiple confirmed purchases of
the same property belong together.

**Why:** The user explicitly requested individual asset graphs in addition to,
not instead of, the overall portfolio graphs.

**How to apply:** Scope both series to the selected property without
reclassifying payments, fees, historical investment basis or legal evidence.
Use saved valuation history, not invented appreciation or a new valuation.

Land Valuation must show only the user's owned share, in both overall and
individual-property graphs: recorded raw land value × owned units / total
property units. It must not show the entire property's value.

**Why:** The user explicitly corrected the previous whole-land graph and asked
for a small info button explaining Land Valuation versus Current Value.

**How to apply:** Group confirmed purchases by property; include a purchase
only from its date onward; use total slots for legacy slot properties and
total units otherwise. Convert from each property's currency before summing.
Missing ownership totals or valuation evidence are unavailable, not a full-land
fallback or a fabricated zero. Preserve the independent Current Value formula;
explain that it adjusts purchase basis using investor-basis valuation changes
and is not a guaranteed selling price.

Show both current portfolio value and amount invested at the top of the
portfolio page, as distinct totals.

**Why:** The user requested both values and clearer wording; the previous
single portfolio-value label did not distinguish principal from performance.

**How to apply:** Keep the current-value summary consistent with the overall
investor-performance graph and preserve the existing principal basis.

Use the investor-facing labels **Purchase Amount**, **Land Valuation**, and
**Current Value** instead of Amount Invested, Land Appreciation, and Investment
Performance on the portfolio page, including each property's graphs.

**Why:** The user explicitly requested these terms to avoid describing the
holdings as investments. This was a wording request, not a financial calculation
change.

**How to apply:** Keep headings, explanatory text and chart tooltips consistent
without changing the stored purchase basis or valuation formulas.

Keep **View Valuation Report** on individual-property graphs only, not on the
overall portfolio graphs.

**Why:** The user explicitly requested removing the report action from overall
portfolio performance; a property's report is not a combined portfolio report.

**How to apply:** Preserve access to individual reports when changing the shared
chart component, without adding a report action to the aggregate view.
