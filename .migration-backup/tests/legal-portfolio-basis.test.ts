import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { freezeHoldingCosts, portfolioLandAmount, summarizeLandPortfolio } from "../shared/holding-costs";

const property = { currency: "NGN", unitLandCost: 277500, unitAgentFees: 12500,
  unitDueDiligenceCost: 12500, unitServiceCharge: 12500 };
const evidence = { confirmedAt: "2026-10-03T00:00:00Z", confirmedByAdminId: 1,
  source: "payment_submission" as const, sourceId: 1 };
const holding = (units: number, extra = {}) => {
  const input = {
  units: String(units), amount: String(units * 315000), currency: "NGN",
  status: "converted_to_investment", property, ...extra,
  };
  return { ...input, costBasis: freezeHoldingCosts(input, evidence), ...extra };
};

describe("every LilyCrest buyer's land stake", () => {
  it("exposes owned land principal before applying public-property fee redaction", () => {
    const source = readFileSync("server/routes.ts", "utf8");
    const ownedRoute = source.slice(source.indexOf("app.get('/api/user/reservations'"),
      source.indexOf("app.get('/api/user/stats'"));
    expect(ownedRoute).toContain("landPrincipalAmount: portfolioLandAmount");
    expect(ownedRoute.indexOf("landPrincipalAmount:")).toBeLessThan(ownedRoute.indexOf("property: property ? redactHidden"));
    const statistics = source.slice(source.indexOf("app.get('/api/user/stats'"), source.indexOf("app.get('/api/user/stats'") + 2000);
    expect(statistics).not.toContain("32353");
    expect(statistics).toContain("summarizeLandPortfolio(");
  });
  it("retains the server-computed land principal when property fee fields are hidden", () => {
    const paid = "5040000.00";
    const ownedHolding = { units: "16", amount: paid, currency: "NGN",
      status: "converted_to_investment", property: { currency: "NGN" },
      landPrincipalAmount: "4440000.00" };
    expect(portfolioLandAmount(ownedHolding)).toBe(4440000);
    expect(summarizeLandPortfolio([ownedHolding], amount => amount).totalPortfolioValue).toBe(4440000);
    expect(ownedHolding.amount).toBe(paid);
    expect(portfolioLandAmount({ ...ownedHolding, landPrincipalAmount: null })).toBeNull();
    expect(portfolioLandAmount({ ...ownedHolding, landPrincipalAmount: "6000000" })).toBeNull();
    expect(portfolioLandAmount({ ...ownedHolding, landPrincipalAmount: "invalid" })).toBeNull();
  });
  it("prefers frozen evidence over server display values and the legacy compatibility path", () => {
    const frozen = holding(16);
    expect(portfolioLandAmount({ ...frozen, landPrincipalAmount: "100.00", property: undefined })).toBe(4440000);
    expect(portfolioLandAmount({ ...frozen, propertyId: 33, landPrincipalAmount: null })).toBe(4440000);
    expect(portfolioLandAmount({ ...frozen, propertyId: 33, landPrincipalAmount: "4440000.00",
      costBasis: { ...frozen.costBasis!, landAmount: "1.00" } })).toBeNull();
    expect(portfolioLandAmount({ units: "16", amount: "5040000", currency: "NGN",
      status: "converted_to_investment", property })).toBeNull();
  });
  it("preserves Guzape 2's recorded holdings alongside Lily Crest's land-only basis", () => {
    const guzape = { propertyId: 33, units: "9", amount: "2925000.00",
      currency: "NGN", status: "converted_to_investment",
      property: { id: 33, currency: "NGN", unitLandCost: 0 } };
    const holdings = [guzape, holding(16),
      { ...guzape, status: "payment_received", amount: "2600000" },
      { ...guzape, status: "cancelled" }, { ...guzape, status: "expired" }];
    const before = JSON.stringify(holdings);
    expect(portfolioLandAmount(guzape)).toBe(2925000);
    expect(portfolioLandAmount({ ...guzape, property: undefined, landPrincipalAmount: null })).toBe(2925000);
    expect(summarizeLandPortfolio(holdings, amount => amount)).toEqual({
      totalPortfolioValue: 7365000, unclassifiedInvestments: 0,
    });
    expect(JSON.stringify(holdings)).toBe(before);
    expect(portfolioLandAmount({ ...guzape, propertyId: 35, property: undefined })).toBeNull();
    expect(portfolioLandAmount({ ...guzape, amount: "invalid" })).toBeNull();
  });
  it("includes all buyers, whether or not legal documents have been prepared", () => {
    const holdings = [16, 9, 2, 1, 1].map(units => holding(units));
    const before = JSON.stringify(holdings);
    expect(holdings.map(portfolioLandAmount)).toEqual([4440000, 2497500, 555000, 277500, 277500]);
    expect(summarizeLandPortfolio(holdings, amount => amount)).toEqual({
      totalPortfolioValue: 8047500, unclassifiedInvestments: 0,
    });
    expect(holdings.reduce((sum, item) => sum + Number(item.amount), 0)).toBe(9135000);
    expect(JSON.stringify(holdings)).toBe(before);
  });
  it("does not count expired, cancelled, or unconfirmed reservations as ownership", () => {
    const holdings = [holding(16), holding(9, { status: "expired" }),
      holding(2, { status: "cancelled" }), holding(1, { status: "reserved" })];
    expect(summarizeLandPortfolio(holdings, amount => amount).totalPortfolioValue).toBe(4440000);
  });
  it("reports an unknown basis rather than substituting the full payment", () => {
    expect(summarizeLandPortfolio([holding(16), holding(2, { costBasis: null })], amount => amount))
      .toEqual({ totalPortfolioValue: 4440000, unclassifiedInvestments: 1 });
  });
  it("converts land, not acquisition fees, into the portfolio display currency", () => {
    const convert = vi.fn((amount: number, currency: string) => currency === "USD" ? amount * 1500 : amount);
    const holdings = [holding(1), holding(2, { amount: "220", currency: "USD",
      property: { currency: "USD", unitLandCost: 100, unitAgentFees: 10,
        unitDueDiligenceCost: 0, unitServiceCharge: 0 } })];
    expect(summarizeLandPortfolio(holdings, convert).totalPortfolioValue).toBe(577500);
    expect(convert).toHaveBeenCalledWith(200, "USD");
    expect(convert).not.toHaveBeenCalledWith(220, "USD");
    expect(() => summarizeLandPortfolio(holdings, () => NaN)).toThrow("conversion failed");
  });
});
