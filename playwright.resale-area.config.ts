import { defineConfig } from "@playwright/test";
import config from "./playwright.sell-date.config";
export default defineConfig({
  ...config,
  testMatch: "resale-area.browser.spec.ts",
  outputDir: "/tmp/brikvest-resale-area",
});
