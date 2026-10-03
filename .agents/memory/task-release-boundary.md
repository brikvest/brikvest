---
name: Task release boundary
description: Avoid confusing tested task code with the source used by production publishing.
---

In an isolated project-task workspace, prepared code is not necessarily in the main project, even when the task's working tree is clean. Use the supported task-completion and merge flow to deliver it to main before asking the owner to publish. Do not substitute manual patch transfers for the normal merge flow.

**Why:** Asking the owner to find an unpublished admin action, or to republish main before the task changes have merged, cannot activate the prepared fix and creates a repeated instruction loop.

**How to apply:** Distinguish code preparation, merge, publication and live outcome verification. If publication requires the owner and live recovery requires authenticated admin access, state those boundaries explicitly. Preserve operational work as pending; only split it into a follow-up when the owner authorizes that phase change. Saving production configuration is not evidence that the active deployment has adopted it.

After a task rebase, run the affected tests even for files that were reported as automatically merged.

**Why:** A semantic merge silently damaged a worker test suite without reporting that file as conflicted. Resolving the reported conflicts alone did not establish that the combined code was valid.

**How to apply:** Preserve both branches' intentional behavior and revalidate the combined source before completion. A clean working tree or a successful rebase is not a substitute for compilation and focused tests.