import type { InvestmentReservation, Property, PropertyValuation } from "@shared/schema";
import { portfolioLandAmount } from "@shared/holding-costs";

type Holding = InvestmentReservation & { property?: Property };

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
