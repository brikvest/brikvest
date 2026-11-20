import { defineConfig } from "@playwright/test";
import config from "./playwright.footer-socials.config";

export default defineConfig({
  ...config,
  testMatch: ["faqs.browser.spec.ts", "footer-socials.browser.spec.ts"],
  outputDir: "test-results/faqs",
  projects: [
    ...config.projects!,
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
  ],
});
