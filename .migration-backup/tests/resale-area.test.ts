import { describe, expect, it } from "vitest";
import { resaleAreaSqm, formatResaleArea } from "../shared/resale-area";

describe("P2P offered land area", () => {
  const property = {totalSquareMeters: "350", totalSlots: 70, totalUnits: 0};
  it("shows 50 sqm for 10 units and 100 sqm for 20 units at 5 sqm per unit", () => {
    expect(formatResaleArea(resaleAreaSqm("10.00", property))).toBe("50 sqm");
    expect(formatResaleArea(resaleAreaSqm("20.00", property))).toBe("100 sqm");
  });
  it("uses each property's configured size instead of assuming 5 sqm", () => {
    expect(resaleAreaSqm(10, {...property, totalSquareMeters: "700"})).toBe(100);
    expect(resaleAreaSqm("0.50", property)).toBe(2.5);
    expect(resaleAreaSqm(10, {totalSquareMeters: "350", totalSlots: 0, totalUnits: 70})).toBe(50);
  });
  it("never invents a size when area, units or ownership totals are missing or invalid", () => {
    for (const value of [null, undefined, "bad", "0", "-1", "Infinity"]) {
      expect(resaleAreaSqm(10, {...property, totalSquareMeters: value})).toBeNull();
    }
    expect(resaleAreaSqm(10, null)).toBeNull();
    expect(resaleAreaSqm(10, {...property, totalSlots: 0})).toBeNull();
    expect(resaleAreaSqm("bad", property)).toBeNull();
    expect(resaleAreaSqm(71, property)).toBeNull();
    expect(formatResaleArea(null)).toBe("Area not recorded");
  });
});
