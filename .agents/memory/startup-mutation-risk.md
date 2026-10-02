---
name: Startup mutation risk
description: App startup can mutate real reservation data even when verification itself is isolated.
---

Treat application startup and restart as potentially data-mutating; use a frontend-only test server when browser fixtures intercept all APIs.

**Why:** On 2026-10-01 a restart during isolated legal-workflow verification reported reservation funnel-stage backfill writes against the live development database. Isolated test fixtures alone do not prevent startup side effects.

**How to apply:** Check startup side effects before starting the full backend for tests. Keep any future backfill rollout explicit and audited rather than assuming a server restart is read-only.

Frontend-only verification still needs to allow the proxied development host.

**Why:** A healthy fixture server can return a host-rejection response through the HTTPS preview, causing browser tests to time out before the application loads.

**How to apply:** Distinguish proxy/host rejection from UI failures when configuring isolated browser verification; do not start the full backend as a workaround.