---
name: Converter-owned legal fonts
description: Why fallback font availability must be reproducible in the converter environment, not inferred from the workspace.
---

The authorized legal fallback is Liberation Serif at 12 pt throughout a new
working document. Provision all four licensed faces with the application and
verify exact family/style matches and readable files in the environment
inherited by the actual converter.

**Why:** A production fallback failure could not be traced to a specific
unavailable family from its safe diagnostic, despite the workspace resolving
Liberation Serif and the runtime configuration naming a system-font package.
Host/workspace availability is not evidence of deployment availability.

**How to apply:** Keep the license and provenance with shipped font binaries.
Use the same resolution policy for readiness and conversion; prove it works
without host font directories. Do not conflate missing verification tooling,
corrupt metadata, missing fallback faces and immutable recovery's original-font
failure. Availability never permits bypassing final-PDF signature placement or
reformatting historical evidence.