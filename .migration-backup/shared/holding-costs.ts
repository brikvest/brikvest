import Decimal from "decimal.js";

export interface HoldingCostBasis {
  version: 1;
  units: string;
  currency: string;
  landAmount: string;
  agentFees: string;
  dueDiligenceFees: string;
  serviceCharges: string;
  acquisitionAmount: string;
  confirmedAt: string;
  confirmedByAdminId: number;
  source: "payment_submission" | "admin_full_confirmation" | "admin_reinstate";
  sourceId: number;
}

export interface HoldingCostInput {
  propertyId?: number;
  units: string | number;
  amount: string | number;
  currency?: string;
  /** Server-computed principal for owned holdings, independent of fee visibility. */
  landPrincipalAmount?: string | number | null;
  status?: string;
  costBasis?: HoldingCostBasis | null;
  property?: {
    id?: number;
    currency?: string;
    unitLandCost?: string | number | null;
    unitAgentFees?: string | number | null;
    unitDueDiligenceCost?: string | number | null;
    unitServiceCharge?: string | number | null;
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

/** Confirmation requires every component to be explicit, including zero fees. */
export function freezeHoldingCosts(
  input: HoldingCostInput,
  evidence: Pick<HoldingCostBasis, "confirmedAt" | "confirmedByAdminId" | "source" | "sourceId">,
): HoldingCostBasis | null {
  const property = input.property;
  if (!property || !input.currency || !property.currency ||
      [property.unitLandCost, property.unitAgentFees, property.unitDueDiligenceCost,
        property.unitServiceCharge].some(value => value == null)) return null;
  const costs = calculateHoldingCosts(input);
  const basis: HoldingCostBasis | null = costs ? { ...costs, version: 1, units: new Decimal(input.units).toFixed(),
    currency: input.currency, ...evidence } : null;
  return basis && recordedHoldingCosts({ ...input, costBasis: basis }) ? basis : null;
}

/** Fail closed on missing or inconsistent frozen evidence; never use today's fees. */
export function recordedHoldingCosts(input: HoldingCostInput) {
  try {
    const basis = input.costBasis;
    if (!basis || basis.version !== 1 || basis.currency !== (input.currency || "NGN") ||
        !new Decimal(basis.units).eq(input.units) || !new Decimal(basis.units).gt(0) ||
        !Number.isFinite(Date.parse(basis.confirmedAt)) ||
        !Number.isInteger(basis.confirmedByAdminId) || basis.confirmedByAdminId <= 0 ||
        !Number.isInteger(basis.sourceId) || basis.sourceId <= 0 ||
        !["payment_submission", "admin_full_confirmation", "admin_reinstate"].includes(basis.source)) return null;
    const amounts = [basis.landAmount, basis.agentFees, basis.dueDiligenceFees,
      basis.serviceCharges, basis.acquisitionAmount].map(value => new Decimal(value));
    if (amounts.some(value => !value.isFinite() || value.lt(0) || value.decimalPlaces() > 2) ||
        !amounts[0].gt(0) || !amounts[4].eq(input.amount) ||
        !amounts.slice(0, 4).reduce((sum, value) => sum.plus(value), new Decimal(0)).eq(amounts[4])) return null;
    return basis;
  } catch {
    return null;
  }
}

export function portfolioLandAmount(input: HoldingCostInput): number | null {
  // Frozen evidence takes precedence over all display and legacy compatibility
  // paths. An invalid snapshot must never fall back to mutable pricing.
  if (input.costBasis != null) {
    const costs = recordedHoldingCosts(input);
    return costs ? Number(costs.landAmount) : null;
  }
  // Gilmore Land, Guzape 2 predates the Lily Crest land-only rollout.
  // Preserve its recorded investment basis; missing historical fee fields do
  // not authorize excluding or repricing these holdings. Use identity, not a
  // mutable property name, and do not extend this exception to future sales.
  if ((input.propertyId ?? input.property?.id) === 33) {
    try {
      const recorded = new Decimal(input.amount);
      return recorded.isFinite() && recorded.gt(0) ? recorded.toNumber() : null;
    } catch { return null; }
  }
  if (Object.prototype.hasOwnProperty.call(input, "landPrincipalAmount")) {
    // A present null is an explicit unverified basis; never substitute payment.
    if (input.landPrincipalAmount == null) return null;
    try {
      const land = new Decimal(input.landPrincipalAmount);
      const paid = new Decimal(input.amount);
      return land.isFinite() && land.gt(0) && paid.isFinite() && land.lte(paid)
        ? land.toNumber() : null;
    } catch { return null; }
  }
  // No adoption from current property prices, including when the total matches.
  return null;
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
