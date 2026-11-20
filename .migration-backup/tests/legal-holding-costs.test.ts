import { describe, expect, it } from "vitest";
import { calculateHoldingCosts, freezeHoldingCosts, portfolioLandAmount } from "../shared/holding-costs";
import { buildLegalTemplateValues } from "../server/legal/values";

const property = { currency: "NGN", unitLandCost: 277500, unitAgentFees: 12500,
  unitDueDiligenceCost: 12500, unitServiceCharge: 12500 };
const evidence = { confirmedAt: "2026-10-03T00:00:00Z", confirmedByAdminId: 1,
  source: "payment_submission" as const, sourceId: 1 };

describe("land principal excludes acquisition fees", () => {
  it("separates 16 five-square-metre units from the full payment", () => {
    const holding = { units: "16", amount: "5040000", currency: "NGN", property };
    expect(calculateHoldingCosts(holding)).toEqual({
      landAmount: "4440000.00", agentFees: "200000.00", dueDiligenceFees: "200000.00",
      serviceCharges: "200000.00", acquisitionAmount: "5040000.00",
    });
    expect(portfolioLandAmount({ ...holding, costBasis: freezeHoldingCosts(holding, evidence) })).toBe(4440000);
    const values = buildLegalTemplateValues("deed_of_assignment", {
      verifiedFullName: "Sample Investor", verifiedHomeAddress: "Verified address",
      propertyAreaSqm: "80", approvedPaymentAmountNaira: "4440000.00",
      documentDate: new Date("2026-10-03T00:00:00Z"),
    });
    expect(values.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBe("4,440,000");
    expect(values.PAYMENT_AMOUNT_NAIRA_WORDS).toContain("Four Million Four Hundred");
  });
  it("supports fractional units and other configured properties", () => {
    expect(calculateHoldingCosts({ units: "3.2", amount: "1008000", property })?.landAmount).toBe("888000.00");
    expect(calculateHoldingCosts({ units: 2, amount: 220, property: { unitLandCost: 100, unitAgentFees: 10 } })?.landAmount).toBe("200.00");
  });
  it("uses explicit land consideration even when the full payment is also supplied", () => {
    const values = buildLegalTemplateValues("deed_of_assignment", {
      verifiedFullName: "Sample Investor", verifiedHomeAddress: "Verified address",
      propertyAreaSqm: "80", approvedPaymentAmountNaira: "5040000.00",
      approvedLandConsiderationNaira: "4440000.00",
      documentDate: new Date("2026-10-03T00:00:00Z"),
    });
    expect(values.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBe("4,440,000");
    expect(values.PAYMENT_AMOUNT_NAIRA_WORDS).toBe("Four Million Four Hundred Forty Thousand Naira");
  });
  it("does not silently fall back to acquisition cost", () => {
    expect(portfolioLandAmount({ units: 16, amount: 5040000 })).toBeNull();
    expect(portfolioLandAmount({ units: 16, amount: 5000000, property })).toBeNull();
    expect(portfolioLandAmount({ units: 16, amount: 5040000, currency: "USD", property })).toBeNull();
  });
});
