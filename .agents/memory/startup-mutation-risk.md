---
name: Startup mutation risk
description: App startup can mutate real reservation data even when verification itself is isolated.
---

Treat application startup and restart as potentially data-mutating; use a frontend-only test server when browser fixtures intercept all APIs.

**Why:** On 2026-10-01 a restart during isolated legal-workflow verification reported reservation funnel-stage backfill writes against the live development database. Isolated test fixtures alone do not prevent startup side effects.

**How to apply:** Check startup side effects before starting the full backend for tests. Keep any future backfill rollout explicit and audited rather than assuming a server restart is read-only.