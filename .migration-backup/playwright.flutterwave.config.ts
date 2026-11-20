import { defineConfig } from "@playwright/test";
import base from "./playwright.footer-socials.config";
export default defineConfig({
  ...base, testMatch: "flutterwave.browser.spec.ts", outputDir: "test-results/flutterwave",
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 960 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
