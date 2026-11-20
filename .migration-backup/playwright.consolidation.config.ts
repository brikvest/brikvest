import { defineConfig } from "@playwright/test";
import config from "./playwright.legal.config";
if (process.env.LEGAL_FRONTEND_ONLY_BASE_URL !== "http://127.0.0.1:5173") {
  throw new Error("Consolidation browser tests require the isolated frontend-only server.");
}
export default defineConfig({
  ...config,
  timeout: 30000,
  testMatch: "account-consolidation.browser.spec.ts",
  outputDir: "test-results/consolidation",
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 960 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
