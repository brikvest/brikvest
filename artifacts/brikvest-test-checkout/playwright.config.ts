import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
export default defineConfig({
  testDir: "./tests",
  testMatch: "sandbox.browser.spec.ts",
  outputDir: "../../generated-artifacts/brikvest-test-checkout-browser",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1",
    launchOptions: { executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(), args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
