import { defineConfig } from "@playwright/test";
import config from "./playwright.legal.config";

if (process.env.LEGAL_FRONTEND_ONLY_BASE_URL !== "http://127.0.0.1:5173") {
  throw new Error("Sell date browser tests require the isolated frontend-only server at http://127.0.0.1:5173.");
}

// Reuse the explicit frontend-only origin safety rules. Start Vite, never the backend.
export default defineConfig({
  ...config,
  testMatch: "property-sell-date.browser.spec.ts",
  outputDir: "test-results/sell-date",
  projects: [
    { name: "desktop-west", use: { viewport: { width: 1280, height: 960 }, timezoneId: "Pacific/Honolulu" } },
    { name: "tablet-utc", use: { viewport: { width: 820, height: 1180 }, timezoneId: "UTC" } },
    { name: "mobile-east", use: { viewport: { width: 390, height: 844 }, timezoneId: "Pacific/Kiritimati" } },
  ],
});
