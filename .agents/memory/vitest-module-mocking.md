---
name: Vitest module mocking
description: Test-runner behavior to account for when mocking modules across integration and unit test files.
---

Vitest file-level mocks can be bypassed when an earlier test file imports the real module in a shared, non-isolated worker.

**Why:** The repository runs tests in a single fork with isolation disabled, so module cache state and file order affect whether a later `vi.mock` intercepts an already-loaded dependency.

**How to apply:** Run module-mocking unit tests independently when validating them, or reset module state and mock setup explicitly before relying on a combined-suite result.