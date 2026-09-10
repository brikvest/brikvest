import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getInvestorScrollDestination } from "../client/src/lib/investorNavigation";

const readSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const homeSource = readSource("client/src/pages/home.tsx");
const insightsSource = readSource("client/src/pages/insights.tsx");
const aboutSource = readSource("client/src/pages/about.tsx");
const investorHeaderSource = readSource("client/src/components/InvestorHeader.tsx");
const appSource = readSource("client/src/App.tsx");
const developerLoginSource = readSource("client/src/pages/developer/login.tsx");
const developerSignupSource = readSource("client/src/pages/developer/signup.tsx");
const developerPricingSource = readSource("client/src/pages/developer/pricing.tsx");

describe("investor and developer navigation boundaries", () => {
  it("keeps developer signup and pricing entry points out of the investor home", () => {
    expect(homeSource).toContain("<InvestorHeader />");
    expect(investorHeaderSource).toContain("Properties");
    expect(investorHeaderSource).toContain('href="/insights"');
    expect(investorHeaderSource).toContain('href="/about"');
    expect(investorHeaderSource).toContain("My Portfolio");
    expect(investorHeaderSource).toContain("Sign in");
    expect(homeSource).toContain('href="/developer/login"');

    expect(homeSource).not.toContain("List your project");
    expect(homeSource).not.toContain("Developer pricing");
    expect(homeSource).not.toContain("Pricing & free trial");
    expect(homeSource).not.toContain('href="/developer/signup"');
    expect(homeSource).not.toContain('href="/developer/pricing"');
  });

  it("uses the complete shared investor header in every covered render state", () => {
    expect(homeSource.match(/<InvestorHeader \/>/g)).toHaveLength(1);
    expect(insightsSource.match(/<InvestorHeader \/>/g)).toHaveLength(3);
    expect(aboutSource.match(/<InvestorHeader \/>/g)).toHaveLength(1);
    expect(investorHeaderSource).toContain("<CurrencySelector compact />");
    expect(investorHeaderSource).toContain("button-mobile-menu");
    expect(investorHeaderSource).toContain("button-mobile-signin");
    expect(investorHeaderSource).toContain("button-mobile-logout");
  });

  it("targets Properties on Home and limits route scroll handling to investor pages", () => {
    expect(investorHeaderSource.match(/href="\/\?section=properties"/g)).toHaveLength(2);
    expect(homeSource).toContain('id="properties"');
    expect(appSource).toContain("const search = useSearch()");
    expect(appSource).toContain("getInvestorScrollDestination(location, search)");
    expect(appSource).toContain("window.setTimeout");
    expect(appSource).toContain('document.getElementById("properties")?.scrollIntoView');
    expect(appSource).toContain('window.scrollTo({ top: 0, left: 0, behavior: "auto" })');
    expect(investorHeaderSource).toContain("onClick={handlePropertiesClick}");
  });

  it("returns scroll behavior only for covered investor destinations", () => {
    expect(getInvestorScrollDestination("/", "")).toBe("top");
    expect(getInvestorScrollDestination("/insights", "")).toBe("top");
    expect(getInvestorScrollDestination("/about", "?from=home")).toBe("top");
    expect(getInvestorScrollDestination("/", "?section=properties")).toBe("properties");
    expect(getInvestorScrollDestination("/developer", "")).toBeNull();
    expect(getInvestorScrollDestination("/developer/projects/12", "?section=properties")).toBeNull();
    expect(getInvestorScrollDestination("/marketplace", "")).toBeNull();
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