import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resaleMarketplaceAlertRetries, resaleMarketplaceOffers } from "@shared/schema";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  db: { select: vi.fn(), update: vi.fn(), execute: vi.fn() },
  storage: { getUser: vi.fn(), getProperty: vi.fn() },
}));
vi.mock("../server/emailService", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("../server/db", () => ({ db: mocks.db }));
vi.mock("../server/storage", () => ({ storage: mocks.storage }));
vi.mock("../server/cloudinary", () => ({
  upload: { single: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  uploadToObjectStorage: vi.fn(),
}));
vi.mock("../server/objectStorage", () => ({ objectStorageClient: {} }));

// Keep both real delivery layers: only the final SMTP transport is mocked.
import { sendMarketplaceOfferEmail } from "../server/resaleEmails";
import { processMarketplaceAlertRetries, registerMarketplaceOfferRoutes } from "../server/marketplaceOffers";

const failureMessage = "Marketplace offer email was not accepted by the mail provider";
const alert = {
  id: 17, offerId: 42, sellerId: 9, channel: "email" as const,
  title: "New land purchase offer", message: "A buyer submitted an offer.",
  attempts: 0, claimToken: "isolated-claim-token", status: "pending",
  offerReference: "BV-TEST-42", currency: "NGN", purchasePrice: "1200.00",
  units: "2.00", propertyName: "Test property",
};
const offer = { id: 42, sellerId: 9, propertyId: 7, reference: "BV-TEST-42" };
const message = {
  to: "seller@example.test", recipientName: "Test Seller", subject: alert.title,
  heading: alert.title, message: alert.message, propertyName: alert.propertyName,
  reference: offer.reference, offerId: offer.id,
};
let adminAttempts = 0;
const dialect = new PgDialect();
const executedQueries = () => mocks.db.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SKIP_STARTUP_DATA_MAINTENANCE", "true");
  adminAttempts = 0;
  mocks.sendEmail.mockResolvedValue(true);
  mocks.storage.getUser.mockResolvedValue({ id: 9, email: message.to, firstName: "Test", lastName: "Seller" });
  mocks.storage.getProperty.mockResolvedValue({ id: 7, name: alert.propertyName });
  mocks.db.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table === resaleMarketplaceAlertRetries) return [{ ...alert, attempts: adminAttempts }];
          if (table === resaleMarketplaceOffers) return [offer];
          throw new Error("Unexpected database read in isolated retry fixture");
        },
      }),
    }),
  }));
  mocks.db.update.mockImplementation(() => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: () => Object.assign(Promise.resolve([]), {
        returning: async () => [{
          ...alert, ...values, attempts: adminAttempts + 1, claimToken: "isolated-admin-claim",
        }],
      }),
    })),
  }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function adminApp() {
  const app = express();
  app.use(express.json());
  registerMarketplaceOfferRoutes(app, {
    requireApprovedUser: (_req, _res, next) => next(),
    requireAdminAuth: (req, res, next) => {
      if (req.headers.authorization !== "Bearer isolated-admin") {
        res.status(401).json({ message: "Authentication required" });
        return;
      }
      next();
    },
  });
  return app;
}

describe("marketplace email transport failure contract (isolated)", () => {
  it("keeps unrelated background claims and expiry work held during publication recovery", () => {
    const intervals = vi.spyOn(globalThis, "setInterval");
    adminApp();
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.execute).not.toHaveBeenCalled();
    expect(intervals).not.toHaveBeenCalled();
  });

  it("propagates sendEmail false rather than resolving as successful delivery", async () => {
    mocks.sendEmail.mockResolvedValue(false);
    await expect(sendMarketplaceOfferEmail(message)).rejects.toThrow(failureMessage);
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });

  it("retains thrown transport failures without converting them into success", async () => {
    const failure = new Error("Transport unavailable");
    mocks.sendEmail.mockRejectedValue(failure);
    await expect(sendMarketplaceOfferEmail(message)).rejects.toBe(failure);
  });

  it.each([{ attempts: 0, status: "pending" }, { attempts: 4, status: "exhausted" }])(
    "automatic recovery retains false-return failure at attempt $attempts",
    async ({ attempts, status }) => {
      mocks.sendEmail.mockResolvedValue(false);
      mocks.db.execute
        .mockResolvedValueOnce({ rows: [{ ...alert, attempts }] })
        .mockResolvedValueOnce({ rows: [{ status }] })
        .mockResolvedValue({ rows: [] });

      const result = await processMarketplaceAlertRetries();

      expect(result).toEqual({
        completed: 0, retrying: status === "pending" ? 1 : 0,
        exhausted: status === "exhausted" ? 1 : 0, lostClaim: 0,
      });
      expect(mocks.sendEmail).toHaveBeenCalledOnce();
      const failure = executedQueries()[1];
      expect(failure.params).toContain(status);
      expect(failure.params).toContain(`Error: ${failureMessage}`);
      expect(failure.sql).toContain("attempts = attempts + 1");
      expect(failure.sql).toContain("next_attempt_at");
      expect(failure.params).toContain(alert.claimToken);
      expect(executedQueries().some(query => query.sql.includes("status = 'completed'"))).toBe(false);
    },
  );

  it.each([{ attempts: 0, status: "pending" }, { attempts: 4, status: "exhausted" }])(
    "authenticated admin recovery does not claim success at attempt $attempts",
    async ({ attempts, status }) => {
      adminAttempts = attempts;
      mocks.sendEmail.mockResolvedValue(false);
      const response = await request(adminApp())
        .post(`/api/admin/marketplace-alert-retries/${alert.id}/retry`)
        .set("Authorization", "Bearer isolated-admin");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        delivered: false, status, attempts: attempts + 1, lastFailure: failureMessage,
      });
      expect(mocks.sendEmail).toHaveBeenCalledOnce();
      const failureUpdate = mocks.db.update.mock.results[1].value;
      // Validate the actual failure write, not just the response or a mocked
      // delivery function; success must never clear retained failure details.
      expect(failureUpdate.set.mock.calls[0][0]).toMatchObject({
        status, lastError: failureMessage, claimedUntil: null, claimToken: null,
      });
      expect(mocks.db.update.mock.results.some(({ value }) =>
        value.set.mock.calls.some(([values]: [Record<string, unknown>]) => values.status === "completed"),
      )).toBe(false);
      expect(mocks.db.update).toHaveBeenCalledTimes(2);
      expect(executedQueries()).toHaveLength(0);
    },
  );

  it("still completes automatic recovery after real wrapper/provider acceptance", async () => {
    mocks.db.execute
      .mockResolvedValueOnce({ rows: [alert] })
      .mockResolvedValueOnce({ rows: [{ id: alert.id }] })
      .mockResolvedValue({ rows: [] });
    expect(await processMarketplaceAlertRetries()).toEqual({ completed: 1, retrying: 0, exhausted: 0, lostClaim: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(executedQueries()[1].sql).toContain("status = 'completed'");
  });

  it("still reports success for authenticated admin recovery after provider acceptance", async () => {
    const response = await request(adminApp())
      .post(`/api/admin/marketplace-alert-retries/${alert.id}/retry`)
      .set("Authorization", "Bearer isolated-admin");
    expect(response.body).toMatchObject({ delivered: true, status: "completed", attempts: 1 });
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });
});