---
name: Dev DB holds real live user data
description: Caution before running data-mutating scripts/queries — the dev DATABASE_URL is the real users' database.
---

# Dev DB == live user data

There is no separate production Neon database / read-replica for this project.
The `DATABASE_URL` in the dev environment points at the **real, live** user data
(real investors, reservations, admins).

**Why:** A one-off data fix (e.g. reinstating a real user's lapsed reservation)
mutates production data directly — there is no safe staging copy.

**How to apply:** Before running any data-mutating tsx script or SQL against
`DATABASE_URL`, treat it as production. Make changes idempotent, verify the exact
target rows first, and never alter real admins' credentials. Admin auth uses a
custom `adminSessions` map via `POST /api/admin/login` (not passport); admin
identities live in a separate `admin_users` table, distinct from `users.role='admin'`.
