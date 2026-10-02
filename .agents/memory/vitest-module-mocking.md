---
name: Vitest module mocking
description: Test-runner behavior to account for when mocking modules across integration and unit test files.
---

Vitest file-level mocks can be bypassed when an earlier test file imports the real module in a shared, non-isolated worker.

**Why:** Earlier shared-fork runs with isolation disabled allowed module cache state and file order to affect whether a later `vi.mock` intercepted an already-loaded dependency.

**How to apply:** Preserve file isolation when running combined suites. If a custom test command disables isolation, run module-mocking tests independently or reset module state and mock setup explicitly.