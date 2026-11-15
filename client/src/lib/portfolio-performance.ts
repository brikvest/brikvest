import type { InvestmentReservation, Property, PropertyValuation } from "@shared/schema";
import { portfolioLandAmount } from "@shared/holding-costs";
import Decimal from "decimal.js";

type Holding = InvestmentReservation & { property?: Property };

type LandHolding = Pick<InvestmentReservation, "propertyId" | "units" | "createdAt" | "status"> & {
  property?: Pick<Property, "totalSlots" | "totalUnits" | "currency">;
};
type LandValuation = Pick<PropertyValuation, "valuationDate" | "rawAssetValue" | "currentValue">;
const dayKey = (value: string | Date) => new Date(value).toISOString().slice(0, 10);

export type OwnedLandGrowth = {
  purchaseLandValue: number;
  currentLandValue: number;
  changeAmount: number;
  changePercent: number;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  latestValuationDate: string;
};

/** Compare the SAME currently owned shares against each purchase's raw-land entry valuation. */
export function ownedLandGrowth(
  holdings: LandHolding[],
  valuationsByProperty: Record<number, LandValuation[]>,
  convertAmount: (amount: number, currency: string) => number,
): OwnedLandGrowth | null {
  const confirmed = holdings.filter(holding => holding.status === "converted_to_investment");
  if (!confirmed.length) return null;
  const purchaseDates = confirmed.map(holding => dayKey(holding.createdAt)).sort();
  const valuationDates = confirmed.flatMap(holding =>
    (valuationsByProperty[holding.propertyId] || []).map(valuation => dayKey(valuation.valuationDate)));
  const asOf = [...purchaseDates, ...valuationDates].sort().at(-1)!;
  // Reuse ownership-total, missing-value and currency safeguards for current value.
  const currentLandValue = ownedLandValueAtDate(confirmed, valuationsByProperty, asOf, convertAmount);
  if (currentLandValue === null) return null;
  let purchaseLandValue = new Decimal(0);
  for (const holding of confirmed) {
    const purchaseDate = dayKey(holding.createdAt);
    const entry = [...(valuationsByProperty[holding.propertyId] || [])]
      .filter(valuation => dayKey(valuation.valuationDate) <= purchaseDate)
      .sort((a, b) => new Date(a.valuationDate).getTime() - new Date(b.valuationDate).getTime()).at(-1);
    // Do not substitute fees, today's listing price, or a post-purchase valuation.
    if (entry?.rawAssetValue == null || entry.rawAssetValue === "") return null;
    const rawEntryNumber = Number(entry.rawAssetValue);
    if (!Number.isFinite(rawEntryNumber) || rawEntryNumber <= 0) return null;
    const rawEntry = new Decimal(rawEntryNumber);
    const total = Number(holding.property?.totalSlots) > 0
      ? Number(holding.property?.totalSlots) : Number(holding.property?.totalUnits);
    const entryShare = rawEntry.mul(holding.units).div(total).toNumber();
    const converted = convertAmount(entryShare, holding.property?.currency || "NGN");
    if (!Number.isFinite(converted) || converted <= 0) return null;
    purchaseLandValue = purchaseLandValue.plus(converted);
  }
  const change = new Decimal(currentLandValue).minus(purchaseLandValue);
  return {
    purchaseLandValue: purchaseLandValue.toNumber(),
    currentLandValue,
    changeAmount: change.toNumber(),
    changePercent: change.div(purchaseLandValue).mul(100).toNumber(),
    firstPurchaseDate: purchaseDates[0],
    lastPurchaseDate: purchaseDates.at(-1)!,
    latestValuationDate: valuationDates.sort().at(-1)!,
  };
}

/** Actual acquisition payments INCLUDING fees; never substitute land-only principal. */
export function confirmedPurchaseAmount(
  holdings: Pick<InvestmentReservation, "status" | "amount" | "currency">[],
  convertAmount: (amount: number, currency: string) => number,
): number | null {
  try {
    let total = new Decimal(0);
    for (const holding of holdings) {
      if (holding.status !== "converted_to_investment") continue;
      const paid = new Decimal(holding.amount);
      if (!paid.isFinite() || !paid.gt(0)) return null;
      const converted = convertAmount(paid.toNumber(), holding.currency || "NGN");
      if (!Number.isFinite(converted) || converted < 0) return null;
      total = total.plus(converted);
    }
    return total.isFinite() ? total.toNumber() : null;
  } catch { return null; }
}

/** Whole-property raw land valuation multiplied by the user's actual unit share. */
export function ownedLandValueAtDate(
  holdings: LandHolding[],
  valuationsByProperty: Record<number, LandValuation[]>,
  date: string,
  convertAmount: (amount: number, currency: string) => number,
): number | null {
  const groups = new Map<number, { units: number; total: number; currency: string }>();
  for (const holding of holdings) {
    if (holding.status !== "converted_to_investment" || dayKey(holding.createdAt) > date) continue;
    const units = Number(holding.units);
    const total = Number(holding.property?.totalSlots) > 0
      ? Number(holding.property?.totalSlots) : Number(holding.property?.totalUnits);
    if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(total) || total <= 0) return null;
    const previous = groups.get(holding.propertyId);
    if (previous && previous.total !== total) return null;
    const owned = units + (previous?.units ?? 0);
    if (owned > total) return null;
    groups.set(holding.propertyId, { units: owned, total, currency: holding.property?.currency || "NGN" });
  }
  let sum = 0;
  for (const [propertyId, group] of Array.from(groups)) {
    const latest = [...(valuationsByProperty[propertyId] || [])]
      .filter(value => dayKey(value.valuationDate) <= date)
      .sort((a, b) => new Date(a.valuationDate).getTime() - new Date(b.valuationDate).getTime()).at(-1);
    if (!latest) return null;
    // A generic reference/investor value is not evidence of a fee-exclusive land valuation.
    const rawInput = latest.rawAssetValue;
    if (rawInput == null || rawInput === "") return null;
    const raw = Number(rawInput);
    if (!Number.isFinite(raw) || raw < 0) return null;
    const value = convertAmount(raw * group.units / group.total, group.currency);
    if (!Number.isFinite(value) || value < 0) return null;
    sum += value;
  }
  return sum;
}

export function ownedLandValuationSeries(
  holdings: LandHolding[],
  valuationsByProperty: Record<number, LandValuation[]>,
  convertAmount: (amount: number, currency: string) => number,
) {
  const confirmed = holdings.filter(holding => holding.status === "converted_to_investment");
  if (!confirmed.length) return [];
  const purchases = confirmed.map(holding => dayKey(holding.createdAt));
  const firstPurchase = [...purchases].sort()[0];
  const dates = new Set(purchases);
  for (const propertyId of Array.from(new Set(confirmed.map(holding => holding.propertyId)))) {
    for (const valuation of valuationsByProperty[propertyId] || []) dates.add(dayKey(valuation.valuationDate));
  }
  return Array.from(dates).filter(date => date >= firstPurchase).sort().map(date => ({
    date,
    value: ownedLandValueAtDate(confirmed, valuationsByProperty, date, convertAmount),
  }));
}

/** The same investor-basis growth calculation for the summary and graph. */
export function holdingValueAtDate(
  holding: Holding,
  valuations: PropertyValuation[],
  date: string,
  convertAmount: (amount: number, currency: string) => number,
): number {
  const land = portfolioLandAmount(holding);
  if (land === null) return 0;
  const principal = convertAmount(land, holding.currency || "NGN");
  const purchaseDate = new Date(holding.createdAt).toISOString().split("T")[0];
  if (purchaseDate > date) return 0;
  const sorted = [...valuations].sort((a, b) =>
    new Date(a.valuationDate).getTime() - new Date(b.valuationDate).getTime());
  const entry = sorted.filter(v => new Date(v.valuationDate).toISOString().split("T")[0] <= purchaseDate).at(-1);
  const latest = sorted.filter(v => new Date(v.valuationDate).toISOString().split("T")[0] <= date).at(-1);
  const entryValue = entry
    ? Number(entry.investorBasisValue || entry.currentValue)
    : Number(holding.property?.totalValue || 0);
  const currentValue = latest ? Number(latest.investorBasisValue || latest.currentValue) : entryValue;
  return entryValue > 0 ? principal * currentValue / entryValue : principal;
}

export function propertyValuationQuery(propertyId: number) {
  return {
    queryKey: ["/api/properties", propertyId, "valuations"],
    queryFn: async (): Promise<PropertyValuation[]> => {
      const response = await fetch(`/api/properties/${propertyId}/valuations`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load property valuations.");
      return response.json();
    },
  };
}
