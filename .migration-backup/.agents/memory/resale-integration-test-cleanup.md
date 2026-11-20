---
name: Resale integration test cleanup
description: Safe teardown ordering for resale integration fixtures in the shared database fallback.
---

# Resale integration test cleanup

Integration tests that create resale listings, payments, or marketplace offers must remove those rows and their dependent records before deleting the referenced reservations.

**Why:** When `TEST_DATABASE_URL` is absent, test runs use the shared database with test-prefixed fixtures. Foreign keys prevent the generic cleanup from deleting reservations while resale records still reference them.

**How to apply:** Scope cleanup to test-prefixed properties, then delete marketplace events/notifications, audit records, payments/bids, listings/offers, and ownership certificates before the generic helper removes reservations and users.