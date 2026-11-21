import { defineConfig } from "vitest/config";
import base from "./vitest.legal.config";

// No legacy global setup: never schema-push or clean the real investor DB.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      "tests/notification-queue-pause.test.ts",
      "tests/marketplace-alert-retries.test.ts",
      "tests/marketplace-email-retry-failure.test.ts",
      "tests/legal-dispatch-maintenance.test.ts",
      "tests/legal-worker.test.ts",
      "tests/flutterwave*.test.ts",
    ],
  },
});
