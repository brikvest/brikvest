---
name: Valuation report source of truth
description: The investor-facing valuation report must come from a valuation-history entry, not legacy property-level document fields.
---

Valuation reports shown to users must be selected from the property's valuation-history records, using only entries that contain a report URL. Legacy property-level report fields may contain stale or unrelated documents and must not be used as a fallback.

**Why:** A legacy property-level link for Lily Crest Gardens pointed to an unrelated former CTO resume even though the property had no valuation-history records.

**How to apply:** When adding or changing valuation-report endpoints, require a matching valuation-history report and return a clear not-found response when none exists.