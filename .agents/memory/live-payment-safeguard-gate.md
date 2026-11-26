---
name: Live payment safeguard gate
description: Where the database-safeguard requirement may and may not be enforced for Flutterwave live mode
---
In live mode only two actions require the three owner-installed database triggers: creating a new checkout and approving a gateway payment. Never add the requirement to receipt verification, webhook intake, recovery, checkout-link closure, rejection or bank transfer.

**Why:** money can arrive on an already-issued checkout whatever the database state; dropping that evidence is worse than a closed checkout. Triggers are not carried by Publish and the agent cannot install them, so the application must fail closed itself.

**How to apply:** investor-facing refusals stay generic ("temporarily unavailable, bank transfer remains available") with no schema detail. Shared payment helpers used by the checkout path must live in files the private test-checkout sandbox build already allows, or its isolation build refuses the import.
