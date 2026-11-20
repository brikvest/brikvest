---
name: Production module interoperability
description: Test externalized PDF dependencies under native Node ESM, not only the test runner.
---

Verify legal PDF rendering under native Node ESM with the deployment's
external-package bundle settings. A passing test-runner render does not
establish that a dependency's namespace exports work in production.

**Why:** The font library's CommonJS entry exposes its usable API through the
default export in native Node ESM. Test-runner interop made a namespace API
appear available, masking a production-only font-loading failure. The actual
font file was not the cause.

**How to apply:** Use the dependency's compatible default API and keep a
compiled, externalized renderer test that executes in a separate native Node
process. Check both font preflight and Unicode evidence-PDF embedding under
the project's font configuration, without starting servers or touching live
signatures, storage, notifications or databases.