import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    singleFork: true,
    isolate: false,
    fileParallelism: false,
    reporters: ["default"],
    // Set NODE_ENV=test BEFORE any test imports run so server/db.ts picks
    // up TEST_DATABASE_URL when an isolated test database has been provided.
    env: {
      NODE_ENV: "test",
    },
    globalSetup: ["./tests/global-setup.ts"],
  },
});
