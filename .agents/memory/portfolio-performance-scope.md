---
name: Portfolio performance scope
description: One owned-share land valuation graph per scope, with a fee-inclusive purchase reference.
---

Keep an overall portfolio graph and a separate graph for each owned property.
An asset is a property, not a single purchase: multiple confirmed purchases of
the same property belong together.

**Why:** The user requested individual assets in addition to the overall view,
then explicitly replaced the separate Current Value graph with a straight
Purchase Amount line on the Land Valuation graph.

**How to apply:** Display one combined graph per scope, not a second Current
Value graph. Scope both series to the selected property without
reclassifying payments, fees, historical investment basis or legal evidence.
Use saved valuation history, not invented appreciation or a new valuation.

Land Valuation must show only the user's owned share, in both overall and
individual-property graphs: recorded raw land value × owned units / total
property units. It must not show the entire property's value.

**Why:** The user explicitly corrected the previous whole-land graph and defines
Land Valuation as "raw cost of land excluding any fees."

**How to apply:** Group confirmed purchases by property; include a purchase
only from its date onward; use total slots for legacy slot properties and
total units otherwise. Convert from each property's currency before summing.
Missing ownership totals or valuation evidence are unavailable, not a full-land
fallback or a fabricated zero. Do not treat a generic investor-basis/reference
valuation as evidence of raw land value when the raw-land field is absent.

Purchase Amount means the recorded price INCLUDING fees. Use the full amounts
of confirmed currently owned holdings, not their land-only principal, for the
purchase summary and straight comparison line. Keep it constant across the
graph's dates, summing multiple purchases of the same asset.

**Why:** The user explicitly said "purchase amount the price including fees"
and requested a straight reference line rather than another performance graph.

**How to apply:** Explain both metrics with small accessible info buttons.
Convert each payment from its recorded currency before summing. This is a
display comparison, not permission to reclassify land principal, alter legal
consideration, change payments, or rewrite historical records.

Show both current portfolio value and amount invested at the top of the
portfolio page, as distinct totals.

**Why:** The user requested both values and clearer wording; the previous
single portfolio-value label did not distinguish principal from performance.

**How to apply:** Preserve the existing Current Portfolio Value summary formula
unless the user separately requests changing it; Purchase Amount now includes
fees as explicitly defined above.

Use the investor-facing labels **Purchase Amount** and **Land Valuation** on
the combined portfolio graph and individual-property graphs.

**Why:** The user requested clearer terms and found the separate Current Value
graph confusing.

**How to apply:** Keep headings, info explanations, legends and tooltips
consistent with the fee boundaries above.

Keep **View Valuation Report** on individual-property graphs only, not on the
overall portfolio graphs.

**Why:** The user explicitly requested removing the report action from overall
portfolio performance; a property's report is not a combined portfolio report.

**How to apply:** Preserve access to individual reports when changing the shared
chart component, without adding a report action to the aggregate view.
