import { defineConfig } from "vitest/config";
import base from "./vitest.legal.config";
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["tests/flutterwave*.test.ts"] },
});
