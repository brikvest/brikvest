import { defineConfig } from "vitest/config";
import isolatedConfig from "./vitest.legal.config";

export default defineConfig({
  ...isolatedConfig,
  test: {
    ...isolatedConfig.test,
    include: ["tests/property-sell-date*.test.ts"],
  },
});
