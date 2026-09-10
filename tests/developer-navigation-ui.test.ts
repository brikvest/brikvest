import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const homeSource = readSource("client/src/pages/home.tsx");
const developerLoginSource = readSource("client/src/pages/developer/login.tsx");
const developerSignupSource = readSource("client/src/pages/developer/signup.tsx");
const developerPricingSource = readSource("client/src/pages/developer/pricing.tsx");

describe("investor and developer navigation boundaries", () => {
  it("keeps developer signup and pricing entry points out of the investor home", () => {
    expect(homeSource).toContain("Properties");
    expect(homeSource).toContain('href="/insights"');
    expect(homeSource).toContain('href="/about"');
    expect(homeSource).toContain("My Portfolio");
    expect(homeSource).toContain("Sign in");
    expect(homeSource).toContain('href="/developer/login"');

    expect(homeSource).not.toContain("List your project");
    expect(homeSource).not.toContain("Developer pricing");
    expect(homeSource).not.toContain("Pricing & free trial");
    expect(homeSource).not.toContain('href="/developer/signup"');
    expect(homeSource).not.toContain('href="/developer/pricing"');
  });

  it("keeps the dedicated developer pages linked to their intended flows", () => {
    expect(developerLoginSource).toContain('href="/developer/signup"');
    expect(developerLoginSource).toContain('href="/developer/pricing"');
    expect(developerSignupSource).toContain('href="/developer/login"');
    expect(developerSignupSource).toContain('href="/developer/pricing"');
    expect(developerPricingSource).toContain('href="/developer/login"');
    expect(developerPricingSource).toContain('href="/developer/signup"');
  });
});