---
name: Playwright output isolation
description: Parallel browser verification requires separate output directories, even when tests use separate pages.
---

When independent Playwright commands run concurrently, give each a distinct
`--output` directory. Do not share the default test-results directory.

**Why:** One runner clears the shared output directory while the other is still
writing traces. This caused ENOENT trace/network-copy and browser-context cleanup
failures that looked like application failures.

**How to apply:** Prefer one coherent browser run. If independently running a
targeted check alongside another browser run, assign unique temporary output
directories and evaluate its own results rather than the shared last-run file.