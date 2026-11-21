import { describe, expect, it, vi } from "vitest";
import {
  getMarketplaceAlertRetryFailure,
  getMarketplaceAlertRetryDelayMs,
  MARKETPLACE_ALERT_MAX_ATTEMPTS,
  processMarketplaceAlertRetries,
  type MarketplaceAlertRetryDependencies,
} from "../server/marketplaceOffers";

const alert = {
  id: 17,
  offerId: 42,
  sellerId: 9,
  channel: "email" as const,
  title: "New land purchase offer",
  message: "A buyer submitted an offer.",
  attempts: 0,
  claimToken: "claim-token",
  offerReference: "BV-TEST-42",
  currency: "NGN",
  purchasePrice: "1200.00",
  units: "2.00",
  propertyName: "Test property",
};

function createDependencies(overrides: Partial<MarketplaceAlertRetryDependencies> = {}) {
  const claimNext = vi.fn()
    .mockResolvedValueOnce(alert)
    .mockResolvedValue(null);
  const dependencies: MarketplaceAlertRetryDependencies = {
    claimNext,
    deliverInApp: vi.fn().mockResolvedValue(undefined),
    deliverEmail: vi.fn().mockResolvedValue(undefined),
    markCompleted: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue("pending"),
    ...overrides,
  };
  return dependencies;
}

describe("marketplace offer alert retries", () => {
  it("leaves queued claims and retries untouched across paused ticks and resumes normally", async () => {
    const dependencies = createDependencies();
    try {
      vi.stubEnv("BRIKVEST_EMAIL_DISPATCH_PAUSED", "true");
      for (let tick = 0; tick < 3; tick++) {
        expect(await processMarketplaceAlertRetries(dependencies)).toEqual({
          completed: 0, retrying: 0, exhausted: 0, lostClaim: 0, paused: true,
        });
      }
      for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
      vi.stubEnv("BRIKVEST_EMAIL_DISPATCH_PAUSED", "false");
      expect(await processMarketplaceAlertRetries(dependencies)).toEqual({
        completed: 1, retrying: 0, exhausted: 0, lostClaim: 0,
      });
      expect(dependencies.deliverEmail).toHaveBeenCalledExactlyOnceWith(alert);
      expect(dependencies.markFailed).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it("marks a successfully delivered alert complete", async () => {
    const dependencies = createDependencies();

    const result = await processMarketplaceAlertRetries(dependencies);

    expect(dependencies.deliverEmail).toHaveBeenCalledWith(alert);
    expect(dependencies.markCompleted).toHaveBeenCalledWith(alert);
    expect(dependencies.markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ completed: 1, retrying: 0, exhausted: 0, lostClaim: 0 });
  });

  it("schedules a failed delivery for another attempt", async () => {
    const error = new Error("Mail service temporarily unavailable");
    const dependencies = createDependencies({
      deliverEmail: vi.fn().mockRejectedValue(error),
    });

    const result = await processMarketplaceAlertRetries(dependencies);

    expect(dependencies.markCompleted).not.toHaveBeenCalled();
    expect(dependencies.markFailed).toHaveBeenCalledWith(alert, error);
    expect(result).toEqual({ completed: 0, retrying: 1, exhausted: 0, lostClaim: 0 });
  });

  it("retries a failed in-app notification through the in-app channel", async () => {
    const inAppAlert = { ...alert, channel: "in_app" as const };
    const dependencies = createDependencies({
      claimNext: vi.fn().mockResolvedValueOnce(inAppAlert).mockResolvedValue(null),
    });

    const result = await processMarketplaceAlertRetries(dependencies);

    expect(dependencies.deliverInApp).toHaveBeenCalledWith(inAppAlert);
    expect(dependencies.deliverEmail).not.toHaveBeenCalled();
    expect(dependencies.markCompleted).toHaveBeenCalledWith(inAppAlert);
    expect(result.completed).toBe(1);
  });

  it("marks an alert exhausted after the final allowed attempt", async () => {
    const finalAttempt = { ...alert, attempts: MARKETPLACE_ALERT_MAX_ATTEMPTS - 1 };
    const dependencies = createDependencies({
      claimNext: vi.fn().mockResolvedValueOnce(finalAttempt).mockResolvedValue(null),
      deliverEmail: vi.fn().mockRejectedValue(new Error("Permanent delivery failure")),
      markFailed: vi.fn().mockResolvedValue("exhausted"),
    });

    const result = await processMarketplaceAlertRetries(dependencies);

    expect(dependencies.markFailed).toHaveBeenCalledWith(finalAttempt, expect.any(Error));
    expect(result).toEqual({ completed: 0, retrying: 0, exhausted: 1, lostClaim: 0 });
  });

  it("updates attempt metadata and stops retrying when the limit is reached", () => {
    expect(getMarketplaceAlertRetryFailure(0, new Error("temporary outage"))).toEqual({
      attempts: 1,
      status: "pending",
      delayMs: 60_000,
      lastError: "Error: temporary outage",
    });
    expect(getMarketplaceAlertRetryFailure(MARKETPLACE_ALERT_MAX_ATTEMPTS - 1, "permanent failure"))
      .toMatchObject({
        attempts: MARKETPLACE_ALERT_MAX_ATTEMPTS,
        status: "exhausted",
        delayMs: 6 * 60 * 60_000,
        lastError: "permanent failure",
      });
  });

  it("uses bounded exponential delays", () => {
    expect(getMarketplaceAlertRetryDelayMs(1)).toBe(60_000);
    expect(getMarketplaceAlertRetryDelayMs(2)).toBe(5 * 60_000);
    expect(getMarketplaceAlertRetryDelayMs(MARKETPLACE_ALERT_MAX_ATTEMPTS))
      .toBe(6 * 60 * 60_000);
    expect(getMarketplaceAlertRetryDelayMs(MARKETPLACE_ALERT_MAX_ATTEMPTS + 20))
      .toBe(6 * 60 * 60_000);
  });
});