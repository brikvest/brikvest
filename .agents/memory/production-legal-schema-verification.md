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

A secure Neon connection matching production does not establish that the
database is externally managed. Legacy Neon production can still participate
in the platform's managed schema publication flow.

**Why:** The platform's development-to-production diff correctly described a
targeted additive repair despite a Neon production identity and a Helium
development identity. Treating the secure connection as permission for direct
production DDL would bypass that supported flow.

**How to apply:** Confirm database ownership and inspect the publication schema
plan before choosing a migration path. For managed production, apply only the
authorized development prerequisites and publish the reviewed additive diff.
Keep live dispatch fenced until a persistent pause is verified in the active
published release; saved environment settings alone do not establish that pause.

Pin maintenance permits to a physical PostgreSQL backend when a connection may
use a transaction pooler.

**Why:** An advisory lock must protect the same live database continuously;
transaction multiplexing can move subsequent queries to another backend.

**How to apply:** Use a dedicated read-only transaction with a transaction-level
maintenance lock, verify that it remains held, and avoid long-lived reads of
tables whose schema publication must alter.

Do not use the production query interface's lock catalog as authoritative
evidence of the application primary's maintenance pause.

**Why:** It reported no maintenance locks while the independently verified
primary connection denied shared dispatch permits and retained its exclusive
permit. Matching business/catalog fingerprints does not imply shared lock state.

**How to apply:** Verify dispatch denial directly on the verified primary with
a passive shared-permit probe. Never dispatch a real job as a test; immediately
release any unexpectedly acquired probe permit and report an unverified pause.