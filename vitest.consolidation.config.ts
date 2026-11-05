import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/account-consolidation*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    env: { NODE_ENV: "test", TEST_DATABASE_URL: "postgresql://isolated:isolated@127.0.0.1:9/isolated" },
  },
});
