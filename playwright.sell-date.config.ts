import { defineConfig } from "@playwright/test";
import config from "./playwright.legal.config";

// Reuse the explicit frontend-only origin safety rules. Start Vite, never the backend.
export default defineConfig({
  ...config,
  testMatch: "property-sell-date.browser.spec.ts",
  outputDir: "test-results/sell-date",
  projects: [
    { name: "desktop-west", use: { viewport: { width: 1280, height: 960 }, timezoneId: "Pacific/Honolulu" } },
    { name: "mobile-east", use: { viewport: { width: 390, height: 844 }, timezoneId: "Pacific/Kiritimati" } },
  ],
});
