/** Resolve NEW primary-market purchases only; never reprice existing holdings. */
export function purchaseUnitPrice(
  property: { currentPricePerUnit?: number | null; unitPrice?: number | null; minInvestment?: number | null },
  chosenType?: { price: number } | null,
): number {
  return property.currentPricePerUnit ?? chosenType?.price ?? (property.unitPrice || property.minInvestment || 0);
}
