---
name: Post-merge database safety
description: Why automatic merge setup must use explicit, idempotent database changes instead of a generic schema push.
---

Automatic post-merge setup must not run a generic Drizzle schema push. Every schema change included in merge setup should use a narrowly scoped, idempotent script that states exactly what it creates or changes.

**Why:** The development database contains live user data. A generic push prompted to reinterpret a new column as a rename, and later proposed deleting several unrelated live columns. Closed stdin can also cause a prompt to abort while still returning success, creating a false impression that the schema was synchronized.

**How to apply:** For merged schema changes, add a dedicated script using safe operations such as `ADD COLUMN IF NOT EXISTS`, idempotent constraint checks, and guarded backfills. Run that script from post-merge setup, and verify rerunning it changes zero rows or objects.