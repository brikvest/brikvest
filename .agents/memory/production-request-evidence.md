---
name: Production request attribution
description: Separate reproducible production prerequisites from historical request attribution.
---

A reproducible read-only production failure does not prove the cause of a
historical HTTP error when logs omit request parameters and response bodies.
Treat missing legal evidence as a prerequisite blocker, not permission to
bypass evidence checks or replay whole older migrations.

**Why:** Mixed successful and failing holdings requests can come from different
properties or searches. Catalog differences establish incompatibility, but
cannot identify the particular failed request or the server release that
handled it.

**How to apply:** Keep incident attribution explicitly unconfirmed until an
authorized, sanitized request/response is available. Obtain separate approval
for prerequisite installation, verify target identity and history guards,
and preserve all financial, signing and notification evidence.