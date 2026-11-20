import { describe, expect, it } from "vitest";
import { confirmedPurchaseAmount, ownedLandGrowth, ownedLandValueAtDate, ownedLandValuationSeries } from "../client/src/lib/portfolio-performance";

const holding = (propertyId = 33, units = "3", totalSlots = 50) => ({
  propertyId, units, status: "converted_to_investment",
  createdAt: new Date("2025-10-15T12:00:00Z"),
  property: { totalSlots, totalUnits: 0, currency: "NGN" },
});
const valuation = (date: string, raw: string | null, currentValue = "99999999") => ({
  valuationDate: new Date(date), rawAssetValue: raw, currentValue,
});
const values = {
  33: [valuation("2026-10-19", "18000000"), valuation("2025-10-01", "12500000")],
  34: [valuation("2025-10-01", "10000000"), valuation("2026-10-19", "15000000")],
};
const identity = (value: number) => value;
const asOf = "2026-10-19";

describe("owned-unit land valuations", () => {
  it("values only 3 of 50 units, using raw land rather than investor or listed values", () => {
    expect(ownedLandValueAtDate([holding()], values, asOf, identity)).toBe(1080000);
  });
  it("combines multiple purchases without counting the whole property repeatedly", () => {
    expect(ownedLandValueAtDate([holding(33, "2"), holding(33, "1")], values, asOf, identity)).toBe(1080000);
  });
  it("aggregates the owned fractions across properties", () => {
    expect(ownedLandValueAtDate([holding(), holding(34, "4", 100)], values, asOf, identity)).toBe(1680000);
  });
  it("scopes dates to ownership, carries forward the latest applicable valuation and sorts input safely", () => {
    const series = ownedLandValuationSeries([holding()], values, identity);
    expect(series).toEqual([
      { date: "2025-10-15", value: 750000 },
      { date: "2026-10-19", value: 1080000 },
    ]);
    expect(values[33][0].rawAssetValue).toBe("18000000");
    expect(ownedLandValueAtDate([holding()], values, "2025-10-01", identity)).toBe(0);
  });
  it("adds later purchases only on their purchase date", () => {
    const later = { ...holding(33, "1"), createdAt: new Date("2026-01-10") };
    expect(ownedLandValueAtDate([holding(33, "2"), later], values, "2025-11-01", identity)).toBe(500000);
    expect(ownedLandValuationSeries([holding(33, "2"), later], values, identity)[1])
      .toEqual({ date: "2026-01-10", value: 750000 });
  });
  it("excludes pending, cancelled and expired reservations", () => {
    for (const status of ["reserved", "payment_pending", "cancelled", "expired"]) {
      expect(ownedLandValueAtDate([holding(), { ...holding(33, "10"), status }], values, asOf, identity)).toBe(1080000);
    }
  });
  it("converts each property's proportional value from its own currency", () => {
    const calls: string[] = [];
    const result = ownedLandValueAtDate([holding(), { ...holding(34, "4", 100), property: { totalSlots: 100, totalUnits: 0, currency: "USD" } }],
      values, asOf, (amount, currency) => { calls.push(currency); return currency === "USD" ? amount * 1500 : amount; });
    expect(result).toBe(901080000);
    expect(calls).toEqual(["NGN", "USD"]);
  });
  it("uses totalUnits only when the legacy totalSlots is not configured", () => {
    expect(ownedLandValueAtDate([{ ...holding(), property: { totalSlots: 0, totalUnits: 50, currency: "NGN" } }], values, asOf, identity)).toBe(1080000);
  });
  it("supports fractional ownership", () => {
    expect(ownedLandValueAtDate([holding(33, "0.5")], values, asOf, identity)).toBe(180000);
  });
  it("does not substitute a whole-property or zero value when ownership totals are invalid", () => {
    for (const total of [0, -1, NaN, 2]) {
      expect(ownedLandValueAtDate([holding(33, "3", total)], values, asOf, identity)).toBeNull();
    }
    expect(ownedLandValueAtDate([holding(33, "30"), holding(33, "30")], values, asOf, identity)).toBeNull();
  });
  it("does not silently omit an owned property with missing valuations", () => {
    expect(ownedLandValueAtDate([holding(), holding(34, "4", 100)], { 33: values[33] }, asOf, identity)).toBeNull();
  });
  it("preserves true zero raw valuations but never substitutes a fee-inclusive reference value", () => {
    expect(ownedLandValueAtDate([holding()], {33: [valuation(asOf, "0")]}, asOf, identity)).toBe(0);
    expect(ownedLandValueAtDate([holding()], {33: [valuation(asOf, null, "18000000")]}, asOf, identity)).toBeNull();
    for (const raw of ["", "NaN", "-1"]) {
      expect(ownedLandValueAtDate([holding()], {33: [valuation(asOf, raw)]}, asOf, identity)).toBeNull();
    }
  });
  it("does not expose valuations for an unowned property", () => {
    expect(ownedLandValuationSeries([], values, identity)).toEqual([]);
    expect(ownedLandValuationSeries([holding()], { ...values, 99: [valuation("2027-01-01", "1")] }, identity)).toHaveLength(2);
  });
});

describe("fee-inclusive purchase reference", () => {
  const purchase = (amount: string, currency = "NGN", status = "converted_to_investment") => ({amount, currency, status});
  it("sums actual full purchase amounts across multiple confirmed purchases, including fees", () => {
    expect(confirmedPurchaseAmount([purchase("650000"), purchase("325000"), purchase("460000")], identity)).toBe(1435000);
  });
  it("ignores reservations that have not become confirmed holdings", () => {
    expect(confirmedPurchaseAmount([purchase("460000"), purchase("999999", "NGN", "reserved"), purchase("999999", "NGN", "expired")], identity)).toBe(460000);
  });
  it("converts each acquisition payment from its recorded currency", () => {
    expect(confirmedPurchaseAmount([purchase("650000"), purchase("100", "USD")],
      (amount, currency) => currency === "USD" ? amount * 1500 : amount)).toBe(800000);
  });
  it("keeps a constant reference across all dates even for purchases on different dates", () => {
    const holdings = [
      { ...holding(33, "2"), ...purchase("650000") },
      { ...holding(33, "1"), ...purchase("325000"), createdAt: new Date("2026-01-10") },
    ];
    const amount = confirmedPurchaseAmount(holdings, identity);
    const series = ownedLandValuationSeries(holdings, values, identity).map(point => ({...point, purchaseAmount: amount}));
    expect(series.map(point => point.purchaseAmount)).toEqual([975000, 975000, 975000]);
    expect(series.map(point => point.value)).toEqual([500000, 750000, 1080000]);
  });
  it("does not silently exclude invalid recorded amounts or invent a zero", () => {
    for (const invalid of ["", "NaN", "-1", "0"]) {
      expect(confirmedPurchaseAmount([purchase("100"), purchase(invalid)], identity)).toBeNull();
    }
    expect(confirmedPurchaseAmount([purchase("100")], () => NaN)).toBeNull();
    expect(confirmedPurchaseAmount([], identity)).toBe(0);
    expect(confirmedPurchaseAmount([purchase("0.10"), purchase("0.20")], identity)).toBe(0.3);
  });
});

describe("raw land growth from each purchase baseline", () => {
  it("shows 2.86% when 17.5 million becomes 18 million, scaled to the owned shares", () => {
    const sample = {33: [valuation("2026-01-01", "17500000"), valuation("2026-07-01", "18000000")]};
    const investor = { ...holding(33, "10", 100), createdAt: new Date("2026-01-01") };
    const result = ownedLandGrowth([investor], sample, identity)!;
    expect(result.purchaseLandValue).toBe(1750000);
    expect(result.currentLandValue).toBe(1800000);
    expect(result.changeAmount).toBe(50000);
    expect(result.changePercent).toBeCloseTo(2.857142857);
    expect(result.firstPurchaseDate).toBe("2026-01-01");
    expect(result.latestValuationDate).toBe("2026-07-01");
  });
  it("does not count a later purchase as appreciation", () => {
    const sample = {33: [valuation("2026-01-01", "10000000"), valuation("2026-04-01", "20000000")]};
    const first = { ...holding(33, "1", 100), createdAt: new Date("2026-01-01") };
    const second = { ...holding(33, "1", 100), createdAt: new Date("2026-04-01") };
    const result = ownedLandGrowth([first, second], sample, identity)!;
    expect(result.purchaseLandValue).toBe(300000);
    expect(result.currentLandValue).toBe(400000);
    expect(result.changePercent).toBeCloseTo(33.3333333);
    expect(result.lastPurchaseDate).toBe("2026-04-01");
    // A same-price additional purchase must produce zero growth, not a deposit-driven increase.
    expect(ownedLandGrowth([first, second], {33: [valuation("2026-01-01", "10000000")]}, identity)?.changePercent).toBe(0);
  });
  it("weights different assets by each owned share's raw entry value, not a simple average", () => {
    const result = ownedLandGrowth([holding(), holding(34, "4", 100)], values, identity)!;
    expect(result.purchaseLandValue).toBe(1150000);
    expect(result.currentLandValue).toBe(1680000);
    expect(result.changePercent).toBeCloseTo(46.0869565);
  });
  it("handles negative, zero and total-loss growth accurately", () => {
    for (const [latest, percent] of [["10000000", -20], ["12500000", 0], ["0", -100]] as const) {
      expect(ownedLandGrowth([holding()], {33: [values[33][1], valuation(asOf, latest)]}, identity)?.changePercent).toBe(percent);
    }
  });
  it("converts both entry and latest values consistently across currencies", () => {
    const holdings = [holding(), { ...holding(34, "4", 100), property: {totalSlots: 100, totalUnits: 0, currency: "USD"} }];
    const result = ownedLandGrowth(holdings, values, (amount, currency) => currency === "USD" ? amount * 1500 : amount)!;
    expect(result.purchaseLandValue).toBe(600750000);
    expect(result.currentLandValue).toBe(901080000);
    expect(result.changePercent).toBeCloseTo(49.99250936);
  });
  it("does not guess a raw entry valuation from a newer valuation, fees, or missing data", () => {
    expect(ownedLandGrowth([holding()], {33: [values[33][0]]}, identity)).toBeNull();
    expect(ownedLandGrowth([holding()], {33: [valuation("2025-10-01", null), values[33][0]]}, identity)).toBeNull();
    expect(ownedLandGrowth([holding()], {33: [valuation("2025-10-01", "bad"), values[33][0]]}, identity)).toBeNull();
    expect(ownedLandGrowth([holding()], {33: [valuation("2025-10-01", "0"), values[33][0]]}, identity)).toBeNull();
    expect(ownedLandGrowth([holding()], {}, identity)).toBeNull();
  });
  it("excludes pending holdings and protects invalid ownership totals", () => {
    const result = ownedLandGrowth([holding(), {...holding(34, "99", 100), status:"reserved"}], values, identity)!;
    expect(result.purchaseLandValue).toBe(750000);
    expect(result.changePercent).toBe(44);
    expect(ownedLandGrowth([holding(33, "99")], values, identity)).toBeNull();
    expect(ownedLandGrowth([], values, identity)).toBeNull();
  });
});
