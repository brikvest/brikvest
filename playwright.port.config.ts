// Port verification only: existing fixtures intercept all application API calls.
// No webServer hook is allowed here; only the managed frontend/fixture workflows run.
import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "flutterwave.browser.spec.ts",
    "resale-area.browser.spec.ts",
    "legal-frozen-holding-basis.browser.spec.ts",
    "legal-native-signing.browser.spec.ts",
    "footer-socials.browser.spec.ts",
    "faqs.browser.spec.ts",
    "port-navigation.browser.spec.ts",
  ],
  outputDir: "generated-artifacts/port-browser",
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost",
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      args: ["--no-sandbox"],
    },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 960 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
