---
name: Startup mutation risk
description: App startup can mutate real reservation data even when verification itself is isolated.
---

Treat application startup and restart as potentially data-mutating; use a frontend-only test server when browser fixtures intercept all APIs.

**Why:** On 2026-10-01 a restart during isolated legal-workflow verification reported reservation funnel-stage backfill writes against the live development database. Isolated test fixtures alone do not prevent startup side effects.

**How to apply:** Check startup side effects before starting the full backend for tests. Keep any future backfill rollout explicit and audited rather than assuming a server restart is read-only.

Do not ask the user to publish startup safeguards from an in-progress isolated
task as if they were already part of the main project. Publication can start
the older main backend and its data repairs before the safeguards are applied.

**Why:** A production publication during controlled schema work ran an older
startup backfill because the prepared skip code remained task-isolated. A
successful publication did not establish that the safety release was deployed.

**How to apply:** Apply safety code to the main project before relying on
publication, then verify the running release. When staging is blocked, prefer
independently verified database-side controls for a narrow schema operation,
or report the blocker instead of promising that publication will activate
unmerged safeguards.

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

A startup-repair skip is not a general worker pause, and development run-command
flags do not automatically protect a published release.

**Why:** A guarded backend reload still started a separately registered
marketplace alert worker. Suppressing wrapped business-record repairs does not
establish that all background activity is stopped or has its database prerequisites.

**How to apply:** Review worker startup hooks and schema prerequisites independently
before reloading the backend. Do not treat a development maintenance flag as a
production notification lock or as authorization to apply live migrations.