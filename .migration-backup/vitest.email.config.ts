import { defineConfig } from "vitest/config";
import isolatedConfig from "./vitest.legal.config";

// These tests mock transport and/or persistence. Never use the default
// integration-test setup, which can mutate a configured PostgreSQL database.
export default defineConfig({
  ...isolatedConfig,
  test: {
    ...isolatedConfig.test,
    include: [
      "tests/marketplace-email-retry-failure.test.ts",
      "tests/marketplace-alert-retries.test.ts",
      "tests/resaleEmails.test.ts",
    ],
  },
});