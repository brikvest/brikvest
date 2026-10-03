import { describe, expect, it } from "vitest";
import { calculateHoldingCosts, portfolioLandAmount } from "../shared/holding-costs";
import { buildLegalTemplateValues } from "../server/legal/values";

const property = { currency: "NGN", unitLandCost: 277500, unitAgentFees: 12500,
  unitDueDiligenceCost: 12500, unitServiceCharge: 12500 };

describe("land principal excludes acquisition fees", () => {
  it("separates 16 five-square-metre units from the full payment", () => {
    const holding = { units: "16", amount: "5040000", currency: "NGN", property };
    expect(calculateHoldingCosts(holding)).toEqual({
      landAmount: "4440000.00", agentFees: "200000.00", dueDiligenceFees: "200000.00",
      serviceCharges: "200000.00", acquisitionAmount: "5040000.00",
    });
    expect(portfolioLandAmount(holding)).toBe(4440000);
    const values = buildLegalTemplateValues("deed_of_assignment", {
      verifiedFullName: "Sample Investor", verifiedHomeAddress: "Verified address",
      propertyAreaSqm: "80", approvedPaymentAmountNaira: "4440000.00",
      documentDate: new Date("2026-10-03T00:00:00Z"),
    });
    expect(values.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBe("4,440,000");
    expect(values.PAYMENT_AMOUNT_NAIRA_WORDS).toContain("Four Million Four Hundred");
  });
  it("supports fractional units and other configured properties", () => {
    expect(portfolioLandAmount({ units: "3.2", amount: "1008000", property })).toBe(888000);
    expect(portfolioLandAmount({ units: 2, amount: 220, property: { unitLandCost: 100, unitAgentFees: 10 } })).toBe(200);
  });
  it("does not silently fall back to acquisition cost", () => {
    expect(portfolioLandAmount({ units: 16, amount: 5040000 })).toBeNull();
    expect(portfolioLandAmount({ units: 16, amount: 5000000, property })).toBeNull();
    expect(portfolioLandAmount({ units: 16, amount: 5040000, currency: "USD", property })).toBeNull();
  });
});