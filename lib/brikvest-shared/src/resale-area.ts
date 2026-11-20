/** Land represented by the offered units, using the property's configured unit size. */
export function resaleAreaSqm(
  units: string | number,
  property?: { totalSquareMeters?: string | number | null; totalSlots?: number | null; totalUnits?: number | null } | null,
): number | null {
  const quantity = Number(units);
  const area = Number(property?.totalSquareMeters);
  const totalUnits = Number(property?.totalSlots) > 0 ? Number(property?.totalSlots) : Number(property?.totalUnits);
  if (![quantity, area, totalUnits].every(value => Number.isFinite(value) && value > 0) || quantity > totalUnits) return null;
  const offeredArea = quantity * area / totalUnits;
  return Number.isFinite(offeredArea) && offeredArea > 0 ? offeredArea : null;
}

export function formatResaleArea(area: unknown): string {
  const value = typeof area === "number" ? area : NaN;
  return Number.isFinite(value) && value > 0
    ? `${value.toLocaleString("en-NG", { maximumSignificantDigits: 10 })} sqm`
    : "Area not recorded";
}
