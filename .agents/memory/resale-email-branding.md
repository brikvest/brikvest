---
name: Brikvest email branding
description: Branding decisions for resale and investor legal-document notification emails.
---

P2P resale notification emails should use the existing hosted Brikvest logo asset as the header brand and show only Brikvest; price labels must be computed as “Asking Price” for fixed-price listings or “Starting Price” for auctions.

**Why:** The live notification showed an old text header with an unwanted tagline and exposed a template interpolation regression in the price label.

**How to apply:** Keep the hosted logo URL usable by email clients, and cover both listing types with template tests whenever resale email markup changes.

Legal-document notifications must match the existing Brikvest transactional-email branding and structure, rather than introducing an unbranded message or a separate legal-email visual style.

**Why:** On 2026-10-01 the user explicitly corrected the plain documents-ready email and requested consistency with other Brikvest emails.

**How to apply:** Preserve this consistency when adding or changing investor legal notifications; reuse the existing brand layout rather than creating a competing design.