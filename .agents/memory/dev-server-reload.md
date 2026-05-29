---
name: Dev server backend reload
description: The Express backend does not hot-reload on file edits; restart the workflow before testing server changes.
---

The `Start application` workflow runs `NODE_ENV=development tsx server/index.ts` (tsx WITHOUT watch). Only the Vite frontend hot-reloads. Backend edits to `server/**` are NOT picked up until the workflow is restarted.

**Why:** A security test once "failed" (admin got converted to developer) purely because curl hit a stale server still running the pre-fix code.

**How to apply:** After editing any `server/*.ts` file, call `restart_workflow("Start application")` before testing endpoints with curl, or you'll be testing old code.
