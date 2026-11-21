import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/postgres/flutterwave-concurrency.test.ts"],
    environment: "node",
    fileParallelism: false,
    isolate: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      TEST_DATABASE_URL: "postgresql://invalid@127.0.0.1:9/invalid",
      DATABASE_URL: "postgresql://invalid@127.0.0.1:9/invalid",
    },
  },
});
