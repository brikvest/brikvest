import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";

const suppliedDomain = process.env.REPLIT_DEV_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const baseURL = process.env.DEV_BASE_URL || (suppliedDomain ? `https://${suppliedDomain}` : undefined);

if (!baseURL) {
  throw new Error("Set DEV_BASE_URL or REPLIT_DEV_DOMAIN to the existing HTTPS development UI before running legal browser tests.");
}

const parsedBaseURL = new URL(baseURL);
if (parsedBaseURL.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(parsedBaseURL.hostname)) {
  throw new Error("Legal browser tests must use the existing HTTPS development UI origin, not localhost.");
}

let chromiumPath = process.env.CHROMIUM_PATH;
if (!chromiumPath) {
  try {
    chromiumPath = execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Set CHROMIUM_PATH or install the system chromium executable to run legal browser tests.");
  }
}

if (!chromiumPath) {
  throw new Error("Set CHROMIUM_PATH or install the system chromium executable to run legal browser tests.");
}

export default defineConfig({
  testDir: "./tests",
  testMatch: "legal-*.browser.spec.ts",
  timeout: 90_000,
  expect: {
    timeout: 12_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: parsedBaseURL.origin,
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    launchOptions: {
      executablePath: chromiumPath,
      args: ["--no-sandbox"],
    },
    viewport: { width: 1280, height: 960 },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});