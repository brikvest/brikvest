import { describe, expect, it, vi } from "vitest";
import { portfolioLandAmount, summarizeLandPortfolio } from "../shared/holding-costs";

const property = { currency: "NGN", unitLandCost: 277500, unitAgentFees: 12500,
  unitDueDiligenceCost: 12500, unitServiceCharge: 12500 };
const holding = (units: number, extra = {}) => ({
  units: String(units), amount: String(units * 315000), currency: "NGN",
  status: "converted_to_investment", property, ...extra,
});

describe("every LilyCrest buyer's land stake", () => {
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
    expect(summarizeLandPortfolio([holding(16), holding(2, { property: undefined })], amount => amount))
      .toEqual({ totalPortfolioValue: 4440000, unclassifiedInvestments: 1 });
  });
  it("converts land, not acquisition fees, into the portfolio display currency", () => {
    const convert = vi.fn((amount: number, currency: string) => currency === "USD" ? amount * 1500 : amount);
    const holdings = [holding(1), holding(2, { amount: "220", currency: "USD",
      property: { currency: "USD", unitLandCost: 100, unitAgentFees: 10 } })];
    expect(summarizeLandPortfolio(holdings, convert).totalPortfolioValue).toBe(577500);
    expect(convert).toHaveBeenCalledWith(200, "USD");
    expect(convert).not.toHaveBeenCalledWith(220, "USD");
    expect(() => summarizeLandPortfolio(holdings, () => NaN)).toThrow("conversion failed");
  });
});