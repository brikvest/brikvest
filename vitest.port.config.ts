import { defineConfig } from "vitest/config";
import isolated from "./vitest.legal.config";
export default defineConfig({
  ...isolated,
  test: { ...isolated.test, include: ["tests/port-workspace.test.ts"] },
});
