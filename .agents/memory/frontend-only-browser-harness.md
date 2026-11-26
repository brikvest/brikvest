---
name: Frontend-only browser harness
description: State of the port-5173 Playwright harness used for isolated browser checks
---
On 2026-11-26 the frontend-only Playwright harness (root Vite config on port 5173) failed every page with a PostCSS error that the `border-border` class does not exist, before any application code ran. Treat a failure there as a harness problem first, not a regression in the page under test.

**Why:** the harness builds from the repository root, where the Tailwind configuration is not resolved the way the web artifact's own build resolves it.

**How to apply:** do not spend retries on it inside an unrelated task; verify with mocked suites and the artifact build, and say the browser run was not possible. Avoid `pkill -f <pattern>` to stop it: the pattern matches the calling shell and kills the command.
