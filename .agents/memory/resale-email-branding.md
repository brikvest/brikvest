---
name: Resale email branding
description: P2P resale notification emails use the hosted copy of the home-page Brikvest logo and no “Real Estate Investment Club” tagline.
---

P2P resale notification emails should use the existing hosted Brikvest logo asset as the header brand and show only Brikvest; price labels must be computed as “Asking Price” for fixed-price listings or “Starting Price” for auctions.

**Why:** The live notification showed an old text header with an unwanted tagline and exposed a template interpolation regression in the price label.

**How to apply:** Keep the hosted logo URL usable by email clients, and cover both listing types with template tests whenever resale email markup changes.