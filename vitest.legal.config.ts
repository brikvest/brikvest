import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    include: ["tests/legal*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    singleFork: true,
    isolate: true,
    fileParallelism: false,
    reporters: ["default"],
    env: {
      NODE_ENV: "test",
      // Tests use disposable PGlite or explicit mocks. Any accidental default
      // pool access must fail against a non-serving endpoint, never live data.
      TEST_DATABASE_URL: "postgresql://isolated:isolated@127.0.0.1:9/isolated",
    },
  },
});