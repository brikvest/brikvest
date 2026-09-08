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
    expect(shouldShowUnitCostBreakdown({ showUnitCostBreakdown: false })).toBe(false);
  });
});