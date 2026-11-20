---
name: Separate preview source-file guards
description: Preserve private legal-source protection when the frontend server changes middleware frameworks.
---

Private legal-source guards must be installed on the server that actually
serves frontend source files, using that server's request/response API.

**Why:** Express-only `req.path` and `res.status` are absent in Vite's Connect
middleware. A copied guard can silently miss a path and fall through to the
SPA instead of enforcing its intended denial.

**How to apply:** When separating backend and frontend servers, test plain,
encoded and `/@fs` private-source URLs through the preview proxy. Do not assume
that a protected backend also protects the independent frontend static server.
