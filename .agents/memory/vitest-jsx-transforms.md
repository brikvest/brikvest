---
name: Vitest JSX transforms
description: JSX test transforms can differ from the application's Vite build toolchain.
---

Configure JSX using the installed test runner's transform options rather than assuming the application's Vite configuration applies.

**Why:** Vitest 4 uses its own newer Vite/Oxc toolchain alongside this application's Vite 5/Esbuild toolchain. Esbuild JSX options were ignored in component-rendering tests, leaving JSX untransformed despite a successful application build.

**How to apply:** When adding server-rendered React component tests, use the test runner's supported automatic JSX transform (Oxc for the observed Vitest version). Check the current installed versions before changing shared test configuration.
