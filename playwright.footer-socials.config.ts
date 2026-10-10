import { defineConfig } from "@playwright/test";
import config from "./playwright.legal.config";

if (process.env.LEGAL_FRONTEND_ONLY_BASE_URL !== "http://127.0.0.1:5173") {
  throw new Error("Footer tests require LEGAL_FRONTEND_ONLY_BASE_URL=http://127.0.0.1:5173; never start the backend.");
}

export default defineConfig({
  ...config,
  testMatch: "footer-socials.browser.spec.ts",
  outputDir: "test-results/footer-socials",
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 960 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "narrow-mobile", use: { viewport: { width: 320, height: 740 } } },
  ],
  webServer: {
    command: "npx vite --config vite.footer-socials.config.ts",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
