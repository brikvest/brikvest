---
name: Production legal schema verification
description: Verify production connection identity and database history guards independently of workspace schema.
---

Verify the workspace and production database identities independently before
operational schema work; a workspace containing real data need not be the
current deployed target. Check trigger/function catalogs as well as columns,
indexes, and constraints before declaring legal-schema readiness.

**Why:** A read-only production investigation found that the workspace's legal
schema was newer than production and that production had legal columns and
constraints but lacked all expected history/reference guard functions and
triggers. The secure Neon connection matched the production query interface;
the workspace connection did not. The cause of the absent guards was not
established.

**How to apply:** Compare non-sensitive database/catalog identities and bounded
server-side record fingerprints through the production query interface and the
candidate secure connection. Never print connection strings or personal data.
If required guards are absent, stop for separate schema-only authorization;
do not replay older migrations containing provenance adoption or notification
backfill, and never test readiness by preparing a real holding.

For structural catalog comparisons with the Neon serverless driver, cast
arrays of PostgreSQL catalog `name` values to `text[]` explicitly.

**Why:** The driver decodes `name[]` as a string while `text[]` is decoded as a
JavaScript array. Comparing the former to an expected array can falsely reject
an otherwise correct schema operation.

**How to apply:** Normalize catalog types before comparing trigger column lists
or other name-valued arrays; keep fail-closed verification and transaction
rollback rather than suppressing a mismatch.

Compare disposable-reference and production catalogs with PostgreSQL version
differences accounted for, while preserving semantic checks.

**Why:** Current PGlite exposes not-null constraints as catalog rows that
PostgreSQL 16 represents through column nullability, and equivalent empty-array
defaults can deparse differently. Raw catalog-text equality can falsely reject
a compatible schema.

**How to apply:** Verify nullability independently of constraint-row counts and
normalize only specifically understood equivalent expressions. Never broadly
ignore constraint, trigger or function differences to make rollout pass.