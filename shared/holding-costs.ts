import Decimal from "decimal.js";

export interface HoldingCostInput {
  units: string | number;
  amount: string | number;
  currency?: string;
  property?: {
    currency?: string;
    unitLandCost?: string | number;
    unitAgentFees?: string | number;
    unitDueDiligenceCost?: string | number;
    unitServiceCharge?: string | number;
  };
}

/** Never treat fees or an unclassified payment as land principal. */
export function calculateHoldingCosts(input: HoldingCostInput) {
  try {
    const property = input.property;
    if (!property || (input.currency || "NGN") !== (property.currency || "NGN")) return null;
    const units = new Decimal(input.units);
    const paid = new Decimal(input.amount);
    const land = new Decimal(property.unitLandCost ?? 0);
    const fees = [
      property.unitAgentFees ?? 0,
      property.unitDueDiligenceCost ?? 0,
      property.unitServiceCharge ?? 0,
    ].map(value => new Decimal(value));
    if (!units.isFinite() || !units.gt(0) || !paid.isFinite() || !paid.gt(0) ||
        !land.isFinite() || !land.gt(0) || fees.some(fee => !fee.isFinite() || fee.lt(0))) return null;
    const unitTotal = fees.reduce((sum, fee) => sum.plus(fee), land);
    if (!unitTotal.mul(units).toDecimalPlaces(2).eq(paid)) return null;
    return {
      landAmount: land.mul(units).toDecimalPlaces(2).toFixed(2),
      agentFees: fees[0].mul(units).toDecimalPlaces(2).toFixed(2),
      dueDiligenceFees: fees[1].mul(units).toDecimalPlaces(2).toFixed(2),
      serviceCharges: fees[2].mul(units).toDecimalPlaces(2).toFixed(2),
      acquisitionAmount: paid.toFixed(2),
    };
  } catch {
    return null;
  }
}

export function portfolioLandAmount(input: HoldingCostInput): number | null {
  const costs = calculateHoldingCosts(input);
  return costs ? Number(costs.landAmount) : null;
}

/** Covers every confirmed holding, independently of legal-document preparation. */
export function summarizeLandPortfolio(
  holdings: Array<HoldingCostInput & { status: string }>,
  convertAmount: (amount: number, currency: string) => number,
) {
  let total = new Decimal(0);
  let unclassifiedInvestments = 0;
  for (const holding of holdings) {
    if (holding.status !== "converted_to_investment") continue;
    const landAmount = portfolioLandAmount(holding);
    if (landAmount === null) {
      unclassifiedInvestments++;
      continue;
    }
    const converted = new Decimal(convertAmount(landAmount, holding.currency || "NGN"));
    if (!converted.isFinite() || converted.lt(0)) throw new Error("Portfolio currency conversion failed.");
    total = total.plus(converted);
  }
  return { totalPortfolioValue: total.toDecimalPlaces(2).toNumber(), unclassifiedInvestments };
}