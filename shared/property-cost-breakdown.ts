import type { Property } from "./schema";

export const UNIT_COST_COMPONENTS = [
  { key: "unitLandCost", label: "Land Cost" },
  { key: "unitDueDiligenceCost", label: "Due Diligence" },
  { key: "unitAgentFees", label: "Agent Fees" },
  { key: "unitServiceCharge", label: "Service Charge" },
] as const;

export type UnitCostBreakdown = Pick<
  Property,
  (typeof UNIT_COST_COMPONENTS)[number]["key"]
>;

export function calculateUnitCostTotal(costs: UnitCostBreakdown): number {
  return UNIT_COST_COMPONENTS.reduce((total, { key }) => total + Number(costs[key] ?? 0), 0);
}

export function shouldShowUnitCostBreakdown(
  property: Pick<Property, "showUnitCostBreakdown">,
): boolean {
  return property.showUnitCostBreakdown === true;
}

export function redactHiddenUnitCostBreakdown(property: Property): Property {
  if (shouldShowUnitCostBreakdown(property)) return property;
  const redacted = { ...property };
  for (const { key } of UNIT_COST_COMPONENTS) {
    delete (redacted as Partial<Property>)[key];
  }
  return redacted;
}