import express from "express";
import { randomUUID } from "crypto";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  investmentReservations,
  properties,
  resaleMarketplaceAlertRetries,
  resaleMarketplaceNotifications,
  resaleMarketplaceOfferEvents,
  resaleMarketplaceOffers,
  users,
} from "@shared/schema";
import { db } from "../server/db";
import { registerMarketplaceOfferRoutes } from "../server/marketplaceOffers";
import { createTestInvestor, uniqueProjectName } from "./test-helpers";

const { sendMarketplaceOfferEmail } = vi.hoisted(() => ({
  sendMarketplaceOfferEmail: vi.fn(),
}));

vi.mock("../server/resaleEmails", () => ({ sendMarketplaceOfferEmail }));

const describeWithIsolatedDatabase = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

function createApp(userId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: userId, userId };
    next();
  });
  registerMarketplaceOfferRoutes(app, {
    requireApprovedUser: (_req: any, _res: any, next: any) => next(),
    requireAdminAuth: (req: any, res: any, next: any) => {
      if (req.headers.authorization !== "Bearer test-admin") {
        return res.status(401).json({ message: "Authentication required" });
      }
      next();
    },
  });
  return app;
}

describe("marketplace seller alert admin access", () => {
  it("rejects requests without admin authentication before loading alert data", async () => {
    const response = await request(createApp()).get("/api/admin/marketplace-alert-retries");
    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty("lastFailure");
  });
});

describeWithIsolatedDatabase("marketplace seller alert recovery integration", () => {
  let propertyId: number | null = null;
  let fixtureUserIds: number[] = [];

  afterAll(async () => {
    if (propertyId !== null) {
      const offers = await db.select({ id: resaleMarketplaceOffers.id })
        .from(resaleMarketplaceOffers)
        .where(eq(resaleMarketplaceOffers.propertyId, propertyId));
      const offerIds = offers.map(({ id }) => id);
      if (offerIds.length) {
        await db.delete(resaleMarketplaceAlertRetries)
          .where(inArray(resaleMarketplaceAlertRetries.offerId, offerIds));
        await db.delete(resaleMarketplaceNotifications)
          .where(inArray(resaleMarketplaceNotifications.offerId, offerIds));
        await db.delete(resaleMarketplaceOfferEvents)
          .where(inArray(resaleMarketplaceOfferEvents.offerId, offerIds));
        await db.delete(resaleMarketplaceOffers)
          .where(inArray(resaleMarketplaceOffers.id, offerIds));
      }
      await db.delete(investmentReservations)
        .where(eq(investmentReservations.propertyId, propertyId));
      await db.delete(properties).where(eq(properties.id, propertyId));
    }
    if (fixtureUserIds.length) {
      await db.delete(users).where(inArray(users.id, fixtureUserIds));
    }
  });

  it("lists failed alerts and reports delivered, failed, and in-app retry outcomes", async () => {
    sendMarketplaceOfferEmail.mockReset().mockResolvedValue(undefined);
    const [property] = await db.insert(properties).values({
      name: uniqueProjectName("alert-recovery"),
      location: "Lagos",
      description: "Seller alert recovery test fixture",
      totalValue: 100_000,
      minInvestment: 1,
      availableSlots: 100,
      totalSlots: 100,
      imageUrl: "https://example.test/alert-recovery.png",
      currency: "NGN",
      totalUnits: 100,
      unitPrecision: "1.00",
      isTransferable: true,
    }).returning();
    propertyId = property.id;

    const seller = await createTestInvestor("alert-recovery-seller");
    const buyer = await createTestInvestor("alert-recovery-buyer");
    fixtureUserIds = [seller.id, buyer.id];
    const [reservation] = await db.insert(investmentReservations).values({
      propertyId: property.id,
      userId: seller.id,
      fullName: "Seller Alert Recovery Test",
      email: seller.email,
      phone: "+2348011111111",
      units: "10.00",
      amount: "1000.00",
      unitPriceSnapshot: "100.00",
      currency: "NGN",
      status: "converted_to_investment",
      funnelStage: "confirmed",
      expiresAt: null,
    }).returning();

    const createAlert = async (channel: "email" | "in_app", attempts: number) => {
      const [offer] = await db.insert(resaleMarketplaceOffers).values({
        reference: `BV-TEST-${randomUUID()}`,
        sellerReservationId: reservation.id,
        propertyId: property.id,
        sellerId: seller.id,
        buyerId: buyer.id,
        units: "2.00",
        purchasePrice: "500.00",
        transactionFee: "10.00",
        totalPayment: "510.00",
        currency: "NGN",
        status: "awaiting_seller_response",
      }).returning();
      const [retry] = await db.insert(resaleMarketplaceAlertRetries).values({
        offerId: offer.id,
        sellerId: seller.id,
        channel,
        title: "New land purchase offer",
        message: `Offer ${offer.reference} needs a seller alert.`,
        status: "pending",
        attempts,
        lastError: "Previous delivery attempt failed",
      }).returning();
      return { offer, retry };
    };

    const deliveredEmail = await createAlert("email", 0);
    const failedEmail = await createAlert("email", 4);
    const deliveredInApp = await createAlert("in_app", 0);
    const [unqueueableOffer] = await db.insert(resaleMarketplaceOffers).values({
      reference: `BV-TEST-${randomUUID()}`,
      sellerReservationId: reservation.id,
      propertyId: property.id,
      sellerId: seller.id,
      buyerId: buyer.id,
      units: "2.00",
      purchasePrice: "500.00",
      transactionFee: "10.00",
      totalPayment: "510.00",
      currency: "NGN",
      status: "awaiting_seller_response",
    }).returning();
    await db.insert(resaleMarketplaceOfferEvents).values({
      offerId: unqueueableOffer.id,
      actorType: "system",
      action: "seller_alert_queue_failed",
      details: JSON.stringify({
        channel: "email",
        title: "New land purchase offer",
        message: `Offer ${unqueueableOffer.reference} needs a seller alert.`,
        lastFailure: "Private queue persistence error",
      }),
    });
    const app = createApp(seller.id);

    const denied = await request(app).get("/api/admin/marketplace-alert-retries");
    expect(denied.status).toBe(401);

    const listed = await request(app)
      .get("/api/admin/marketplace-alert-retries")
      .set("Authorization", "Bearer test-admin");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reference: deliveredEmail.offer.reference,
        propertyName: property.name,
        channel: "email",
        lastFailure: "Previous delivery attempt failed",
      }),
      expect.objectContaining({ reference: failedEmail.offer.reference }),
      expect.objectContaining({
        reference: unqueueableOffer.reference,
        lastFailure: "Private queue persistence error",
      }),
    ]));
    expect(JSON.stringify(listed.body)).not.toContain(seller.email);
    expect(JSON.stringify(listed.body)).not.toContain("password");

    const delivered = await request(app)
      .post(`/api/admin/marketplace-alert-retries/${deliveredEmail.retry.id}/retry`)
      .set("Authorization", "Bearer test-admin");
    expect(delivered.status).toBe(200);
    expect(delivered.body).toMatchObject({ delivered: true, status: "completed", attempts: 1 });

    sendMarketplaceOfferEmail.mockRejectedValueOnce(new Error("mail provider rejected request"));
    const failed = await request(app)
      .post(`/api/admin/marketplace-alert-retries/${failedEmail.retry.id}/retry`)
      .set("Authorization", "Bearer test-admin");
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({
      delivered: false,
      status: "exhausted",
      attempts: 5,
      lastFailure: "mail provider rejected request",
    });

    const inApp = await request(app)
      .post(`/api/admin/marketplace-alert-retries/${deliveredInApp.retry.id}/retry`)
      .set("Authorization", "Bearer test-admin");
    expect(inApp.status).toBe(200);
    expect(inApp.body).toMatchObject({ delivered: true, status: "completed", attempts: 1 });
    expect(await db.select().from(resaleMarketplaceNotifications)
      .where(eq(resaleMarketplaceNotifications.offerId, deliveredInApp.offer.id))).toHaveLength(1);

    const recoveredRow = listed.body.find((alert: any) => alert.reference === unqueueableOffer.reference);
    expect(recoveredRow).toBeTruthy();
    const recovered = await request(app)
      .post(`/api/admin/marketplace-alert-retries/${recoveredRow.id}/retry`)
      .set("Authorization", "Bearer test-admin");
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ delivered: true, status: "completed", attempts: 1 });

    const sellerOffers = await request(app).get("/api/marketplace/offers/mine");
    expect(sellerOffers.status).toBe(200);
    expect(JSON.stringify(sellerOffers.body)).not.toContain("mail provider rejected request");
    expect(JSON.stringify(sellerOffers.body)).not.toContain("Private queue persistence error");

    const completedRow = await db.select().from(resaleMarketplaceAlertRetries)
      .where(eq(resaleMarketplaceAlertRetries.id, deliveredEmail.retry.id));
    expect(completedRow[0]).toMatchObject({ status: "completed", attempts: 1, lastError: null });
    const exhaustedRow = await db.select().from(resaleMarketplaceAlertRetries)
      .where(eq(resaleMarketplaceAlertRetries.id, failedEmail.retry.id));
    expect(exhaustedRow[0]).toMatchObject({ status: "exhausted", attempts: 5 });
  });
});