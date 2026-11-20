import { describe, expect, it } from "vitest";
import { insertPropertySchema } from "@shared/schema";
import {
  calculateUnitCostTotal,
  redactHiddenUnitCostBreakdown,
  shouldShowUnitCostBreakdown,
} from "@shared/property-cost-breakdown";

const baseProperty = {
  name: "Cost transparency test",
  location: "Test City",
  description: "A property used to test transparent costs.",
  totalValue: 10_000_000,
  minInvestment: 1_000_000,
  availableSlots: 10,
  totalSlots: 10,
  imageUrl: "https://example.test/property.jpg",
};

describe("property unit cost breakdown", () => {
  it("keeps existing property payloads valid and hidden by default", () => {
    expect(insertPropertySchema.safeParse(baseProperty).success).toBe(true);
  });

  it("accepts non-negative whole amounts and calculates their total", () => {
    const costs = {
      unitLandCost: 700_000,
      unitDueDiligenceCost: 50_000,
      unitAgentFees: 100_000,
      unitServiceCharge: 150_000,
    };
    expect(insertPropertySchema.safeParse({ ...baseProperty, ...costs }).success).toBe(true);
    expect(calculateUnitCostTotal(costs)).toBe(1_000_000);
  });

  it.each([-1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid monetary amount %s", (unitLandCost) => {
    expect(insertPropertySchema.safeParse({ ...baseProperty, unitLandCost }).success).toBe(false);
  });

  it("removes component values from hidden public properties", () => {
    const hidden = redactHiddenUnitCostBreakdown({
      ...baseProperty,
      id: 1,
      unitLandCost: 700_000,
      unitDueDiligenceCost: 50_000,
      unitAgentFees: 100_000,
      unitServiceCharge: 150_000,
      showUnitCostBreakdown: false,
    } as any);
    expect(hidden).not.toHaveProperty("unitLandCost");
    expect(hidden.showUnitCostBreakdown).toBe(false);
  });

  it("preserves enabled values for customer rendering", () => {
    const visible = redactHiddenUnitCostBreakdown({
      ...baseProperty,
      id: 1,
      unitLandCost: 700_000,
      unitDueDiligenceCost: 50_000,
      unitAgentFees: 100_000,
      unitServiceCharge: 150_000,
      showUnitCostBreakdown: true,
    } as any);
    expect(calculateUnitCostTotal(visible)).toBe(1_000_000);
    expect(shouldShowUnitCostBreakdown(visible)).toBe(true);
  });

  it("suppresses customer rendering while the visibility setting is disabled", () => {
    expect(shouldShowUnitCostBreakdown({
      ...baseProperty,
      showUnitCostBreakdown: false,
      unitLandCost: 700_000,
      unitDueDiligenceCost: 50_000,
      unitAgentFees: 100_000,
      unitServiceCharge: 150_000,
    })).toBe(false);
  });

  it("suppresses and redacts an enabled breakdown that does not match minimum investment", () => {
    const inconsistent = {
      ...baseProperty,
      id: 1,
      unitLandCost: 600_000,
      unitDueDiligenceCost: 50_000,
      unitAgentFees: 100_000,
      unitServiceCharge: 150_000,
      showUnitCostBreakdown: true,
    } as any;
    expect(shouldShowUnitCostBreakdown(inconsistent)).toBe(false);
    expect(redactHiddenUnitCostBreakdown(inconsistent)).not.toHaveProperty("unitLandCost");
  });

  it("rejects customer visibility when the breakdown does not match minimum investment", () => {
    const result = insertPropertySchema.safeParse({
      ...baseProperty,
      unitLandCost: 600_000,
      unitDueDiligenceCost: 50_000,
      unitAgentFees: 100_000,
      unitServiceCharge: 150_000,
      showUnitCostBreakdown: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("keep customer visibility off");
  });

  it("uses source eligibility for a converted public breakdown", () => {
    expect(shouldShowUnitCostBreakdown({
      ...baseProperty,
      minInvestment: 621.3710000000001,
      unitLandCost: 434.9597,
      unitDueDiligenceCost: 31.06855,
      unitAgentFees: 62.1371,
      unitServiceCharge: 93.20565,
      showUnitCostBreakdown: true,
      unitCostBreakdownEligible: true,
    })).toBe(true);
  });

  it("strictly redacts a one-unit mismatch even at large safe integer values", () => {
    const minimumInvestment = 1_000_000_000_000_000;
    const inconsistent = {
      ...baseProperty,
      minInvestment: minimumInvestment,
      unitLandCost: minimumInvestment - 1,
      unitDueDiligenceCost: 0,
      unitAgentFees: 0,
      unitServiceCharge: 0,
      showUnitCostBreakdown: true,
    } as any;
    expect(shouldShowUnitCostBreakdown(inconsistent)).toBe(false);
    expect(redactHiddenUnitCostBreakdown(inconsistent)).not.toHaveProperty("unitLandCost");
  });
});