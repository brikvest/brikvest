---
name: Startup mutation risk
description: App startup can mutate real reservation data even when verification itself is isolated.
---

Treat application startup and restart as potentially data-mutating; use a frontend-only test server when browser fixtures intercept all APIs.

**Why:** On 2026-10-01 a restart during isolated legal-workflow verification reported reservation funnel-stage backfill writes against the live development database. Isolated test fixtures alone do not prevent startup side effects.

**How to apply:** Check startup side effects before starting the full backend for tests. Keep any future backfill rollout explicit and audited rather than assuming a server restart is read-only.

Adding an auto-started fixture workflow can also start the existing grouped
workflows; a frontend-only command does not make workflow configuration safe.

**Why:** During isolated legal verification, adding a fixture workflow
automatically started the existing backend, whose startup log reported a
reservation backfill before it failed on the occupied port.

**How to apply:** Inspect the grouped run configuration before adding or
auto-starting workflows. For isolated verification, prefer a standalone
frontend-only shell process when configuring a workflow would also start the
backend. Do not assume an already stopped backend will remain stopped.

Frontend-only verification still needs to allow the proxied development host.

**Why:** A healthy fixture server can return a host-rejection response through the HTTPS preview, causing browser tests to time out before the application loads.

**How to apply:** Distinguish proxy/host rejection from UI failures when configuring isolated browser verification; do not start the full backend as a workaround.