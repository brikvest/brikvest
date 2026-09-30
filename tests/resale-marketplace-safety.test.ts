import { describe, expect, it } from "vitest";
import {
  assertResaleTransferPreconditions,
  calculateResalePaymentTerms,
  canAccessResaleReceipt,
  createMarketplacePaymentDeadline,
  getAvailableResaleUnits,
  resaleUnitsToSquareMeters,
} from "../server/resaleMarketplacePolicy";

describe("resale marketplace safety policies", () => {
  it("calculates the 2% fee and total in whole minor currency units", () => {
    expect(calculateResalePaymentTerms("12345.67")).toEqual({
      purchasePrice: "12345.67",
      transactionFee: "246.91",
      totalPayment: "12592.58",
    });
    expect(calculateResalePaymentTerms("0.25")).toEqual({
      purchasePrice: "0.25",
      transactionFee: "0.01",
      totalPayment: "0.26",
    });
  });

  it("rejects invalid resale prices", () => {
    expect(calculateResalePaymentTerms("0")).toBeNull();
    expect(calculateResalePaymentTerms("-1")).toBeNull();
    expect(calculateResalePaymentTerms("not a price")).toBeNull();
  });

  it("starts an exact one-hour payment window from acceptance time", () => {
    const acceptedAt = new Date("2026-09-29T12:00:00.000Z");
    expect(createMarketplacePaymentDeadline(acceptedAt).toISOString()).toBe("2026-09-29T13:00:00.000Z");
  });

  it("allows receipt access only to the buyer or seller", () => {
    expect(canAccessResaleReceipt(10, 10, 20)).toBe(true);
    expect(canAccessResaleReceipt(20, 10, 20)).toBe(true);
    expect(canAccessResaleReceipt(30, 10, 20)).toBe(false);
  });

  it("never reports more units available than remain after listings and offers", () => {
    expect(getAvailableResaleUnits(10, 3, 4)).toBe(3);
    expect(getAvailableResaleUnits(10, 7, 8)).toBe(0);
  });

  it("shows each marketplace ownership unit as five square meters", () => {
    expect(resaleUnitsToSquareMeters(1)).toBe(5);
    expect(resaleUnitsToSquareMeters(2.5)).toBe(12.5);
  });

  it("requires verified payment and approved buyer KYC before transfer", () => {
    expect(() => assertResaleTransferPreconditions(
      "pending_verification",
      "approved",
      "pending_verification",
    )).not.toThrow();
    expect(() => assertResaleTransferPreconditions(
      "pending_verification",
      "pending",
      "pending_verification",
    )).toThrow(/KYC must be approved/i);
    expect(() => assertResaleTransferPreconditions(
      "rejected",
      "approved",
      "pending_verification",
    )).toThrow(/payment proof/i);
  });
});