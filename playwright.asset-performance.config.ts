import { defineConfig } from "@playwright/test";
import config from "./playwright.sell-date.config";

// Reuse the isolated frontend-only origin and desktop/tablet/mobile projects.
export default defineConfig({
  ...config,
  testMatch: "asset-performance.browser.spec.ts",
  outputDir: "/tmp/brikvest-asset-performance",
});
