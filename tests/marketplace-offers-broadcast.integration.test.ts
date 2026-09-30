import express from "express";
import { randomUUID } from "crypto";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  investmentReservations,
  properties,
  resaleMarketplaceAlertRetries,
  resaleMarketplaceOfferEvents,
  resaleMarketplaceOffers,
  resaleMarketplaceNotifications,
  users,
} from "@shared/schema";
import { db } from "../server/db";
import { registerMarketplaceOfferRoutes } from "../server/marketplaceOffers";
import { createTestInvestor, uniqueProjectName } from "./test-helpers";

const { sendMarketplaceOfferEmail } = vi.hoisted(() => ({
  sendMarketplaceOfferEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/resaleEmails", () => ({ sendMarketplaceOfferEmail }));

const describeWithIsolatedDatabase = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

type Investor = Awaited<ReturnType<typeof createTestInvestor>>;

describeWithIsolatedDatabase("marketplace offer broadcast integration", () => {
  let fixturePropertyId: number | null = null;
  let fixtureUserIds: number[] = [];

  afterAll(async () => {
    if (fixturePropertyId !== null) {
      const offers = await db.select({ id: resaleMarketplaceOffers.id })
        .from(resaleMarketplaceOffers)
        .where(eq(resaleMarketplaceOffers.propertyId, fixturePropertyId));
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
        .where(eq(investmentReservations.propertyId, fixturePropertyId));
      await db.delete(properties).where(eq(properties.id, fixturePropertyId));
    }

    if (fixtureUserIds.length) {
      await db.delete(users).where(inArray(users.id, fixtureUserIds));
    }
  });

  it("commits offers only for eligible positions and notifies only committed sellers", async () => {
    const propertyName = uniqueProjectName("broadcast");
    const [property] = await db.insert(properties).values({
      name: propertyName,
      location: "Lagos",
      description: "Marketplace broadcast integration fixture",
      totalValue: 100_000,
      minInvestment: 1,
      availableSlots: 100,
      totalSlots: 100,
      imageUrl: "https://example.test/broadcast-fixture.png",
      currency: "NGN",
      totalUnits: 100,
      unitPrecision: "1.00",
      isTransferable: true,
    }).returning();
    fixturePropertyId = property.id;

    const [
      buyer,
      ownOwner,
      eligibleOwner,
      rollbackOwner,
      insufficientOwner,
      currencyMismatchOwner,
      existingOfferOwner,
    ] = await Promise.all([
      createTestInvestor("broadcast-buyer"),
      createTestInvestor("broadcast-own"),
      createTestInvestor("broadcast-eligible"),
      createTestInvestor("broadcast-rollback"),
      createTestInvestor("broadcast-insufficient"),
      createTestInvestor("broadcast-currency"),
      createTestInvestor("broadcast-existing"),
    ]);
    fixtureUserIds = [
      buyer.id,
      ownOwner.id,
      eligibleOwner.id,
      rollbackOwner.id,
      insufficientOwner.id,
      currencyMismatchOwner.id,
      existingOfferOwner.id,
    ];

    const timestamp = Date.now();
    const reservationFor = async (
      owner: Investor,
      units: string,
      currency: string,
      createdAt: Date,
    ) => (await db.insert(investmentReservations).values({
      propertyId: property.id,
      userId: owner.id,
      fullName: "Marketplace Broadcast Test",
      email: owner.email,
      phone: "+2348011111111",
      units,
      amount: "1000.00",
      unitPriceSnapshot: "100.00",
      currency,
      status: "converted_to_investment",
      funnelStage: "confirmed",
      expiresAt: null,
      createdAt,
      updatedAt: createdAt,
    }).returning())[0];

    const ownReservation = await reservationFor(
      buyer,
      "5.00",
      "NGN",
      new Date(timestamp + 5_000),
    );
    const eligibleReservation = await reservationFor(
      eligibleOwner,
      "8.00",
      "NGN",
      new Date(timestamp + 4_000),
    );
    // This position is deliberately last among candidates so the database
    // trigger below fails after the first offer insert has occurred.
    const rollbackReservation = await reservationFor(
      rollbackOwner,
      "8.00",
      "NGN",
      new Date(timestamp + 3_000),
    );
    const insufficientReservation = await reservationFor(
      insufficientOwner,
      "1.00",
      "NGN",
      new Date(timestamp + 2_000),
    );
    const currencyMismatchReservation = await reservationFor(
      currencyMismatchOwner,
      "8.00",
      "USD",
      new Date(timestamp + 1_000),
    );
    const existingOfferReservation = await reservationFor(
      existingOfferOwner,
      "8.00",
      "NGN",
      new Date(timestamp),
    );

    const [existingOffer] = await db.insert(resaleMarketplaceOffers).values({
      reference: `BV-TEST-${randomUUID()}`,
      sellerReservationId: existingOfferReservation.id,
      propertyId: property.id,
      sellerId: existingOfferOwner.id,
      buyerId: buyer.id,
      units: "2.00",
      purchasePrice: "500.00",
      transactionFee: "10.00",
      totalPayment: "510.00",
      currency: "NGN",
      status: "awaiting_seller_response",
    }).returning();

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { id: buyer.id, email: buyer.email };
      next();
    });
    registerMarketplaceOfferRoutes(app, {
      requireApprovedUser: (_req: any, _res: any, next: any) => next(),
      requireAdminAuth: (_req: any, _res: any, next: any) => next(),
    });

    const triggerSuffix = randomUUID().replace(/-/g, "");
    const triggerName = `broadcast_fail_${triggerSuffix}`;
    const functionName = `broadcast_fail_fn_${triggerSuffix}`;
    let triggerCreated = false;

    try {
      await db.execute(sql.raw(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.property_id = ${property.id} AND NEW.seller_id = ${rollbackOwner.id} THEN
            RAISE EXCEPTION 'intentional marketplace broadcast rollback';
          END IF;
          RETURN NEW;
        END;
        $$
      `));
      await db.execute(sql.raw(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON resale_marketplace_offers
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `));
      triggerCreated = true;

      const rolledBack = await request(app)
        .post("/api/marketplace/offers/broadcast")
        .send({ propertyId: property.id, units: "2", purchasePrice: "500.00" });

      expect(rolledBack.status).toBe(500);
      const rollbackOffers = await db.select()
        .from(resaleMarketplaceOffers)
        .where(and(
          eq(resaleMarketplaceOffers.propertyId, property.id),
          eq(resaleMarketplaceOffers.buyerId, buyer.id),
        ));
      expect(rollbackOffers.map(({ id }) => id)).toEqual([existingOffer.id]);
      expect(await db.select().from(resaleMarketplaceNotifications)
        .where(eq(resaleMarketplaceNotifications.offerId, existingOffer.id))).toEqual([]);
      expect(await db.select().from(resaleMarketplaceOfferEvents)
        .where(eq(resaleMarketplaceOfferEvents.offerId, existingOffer.id))).toEqual([]);
      expect(sendMarketplaceOfferEmail).not.toHaveBeenCalled();
    } finally {
      if (triggerCreated) {
        await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON resale_marketplace_offers`));
      }
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
    }

    const notificationTriggerSuffix = randomUUID().replace(/-/g, "");
    const notificationTriggerName = `broadcast_notification_fail_${notificationTriggerSuffix}`;
    const notificationFunctionName = `broadcast_notification_fail_fn_${notificationTriggerSuffix}`;
    let notificationTriggerCreated = false;

    let sent: any;
    try {
      await db.execute(sql.raw(`
        CREATE FUNCTION ${notificationFunctionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.user_id = ${eligibleOwner.id} THEN
            RAISE EXCEPTION 'intentional seller notification failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `));
      await db.execute(sql.raw(`
        CREATE TRIGGER ${notificationTriggerName}
        BEFORE INSERT ON resale_marketplace_notifications
        FOR EACH ROW EXECUTE FUNCTION ${notificationFunctionName}()
      `));
      notificationTriggerCreated = true;

      sent = await request(app)
        .post("/api/marketplace/offers/broadcast")
        .send({ propertyId: property.id, units: "2", purchasePrice: "500.00" });
    } finally {
      if (notificationTriggerCreated) {
        await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${notificationTriggerName} ON resale_marketplace_notifications`));
      }
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${notificationFunctionName}()`));
    }

    expect(sent.status).toBe(201);
    expect(sent.body.sentCount).toBe(2);
    expect(sent.body.skippedCount).toBe(3);
    expect(sent.body.allSellerAlertsDeliveredOrQueued).toBe(true);
    expect(sent.body.sellerAlertsQueuedForRetry).toBe(1);
    expect(sent.body.sellerAlertRecoveryFailures).toBe(0);
    expect(sendMarketplaceOfferEmail).toHaveBeenCalledTimes(2);

    const committedOffers = await db.select()
      .from(resaleMarketplaceOffers)
      .where(and(
        eq(resaleMarketplaceOffers.propertyId, property.id),
        eq(resaleMarketplaceOffers.buyerId, buyer.id),
        inArray(resaleMarketplaceOffers.reference, sent.body.references),
      ));
    expect(committedOffers).toHaveLength(2);
    expect(committedOffers.map(({ sellerReservationId }) => sellerReservationId).sort())
      .toEqual([eligibleReservation.id, rollbackReservation.id].sort());
    expect(committedOffers.map(({ sellerReservationId }) => sellerReservationId))
      .not.toContain(ownReservation.id);
    expect(committedOffers.map(({ sellerReservationId }) => sellerReservationId))
      .not.toContain(insufficientReservation.id);
    expect(committedOffers.map(({ sellerReservationId }) => sellerReservationId))
      .not.toContain(currencyMismatchReservation.id);
    expect(committedOffers.map(({ sellerReservationId }) => sellerReservationId))
      .not.toContain(existingOfferReservation.id);

    const committedOfferIds = committedOffers.map(({ id }) => id);
    const notifications = await db.select()
      .from(resaleMarketplaceNotifications)
      .where(inArray(resaleMarketplaceNotifications.offerId, committedOfferIds));
    expect(notifications).toHaveLength(1);
    expect(notifications.map(({ userId }) => userId))
      .toEqual([rollbackOwner.id]);
    expect(notifications.every(({ offerId }) => committedOfferIds.includes(offerId))).toBe(true);

    const retries = await db.select()
      .from(resaleMarketplaceAlertRetries)
      .where(inArray(resaleMarketplaceAlertRetries.offerId, committedOfferIds));
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({
      sellerId: eligibleOwner.id,
      channel: "in_app",
      status: "pending",
      attempts: 0,
    });
    expect(retries[0].message).toContain("A buyer has submitted offer");

    const events = await db.select()
      .from(resaleMarketplaceOfferEvents)
      .where(inArray(resaleMarketplaceOfferEvents.offerId, committedOfferIds));
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.action === "offer_submitted")).toBe(true);
  });
});