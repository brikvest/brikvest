import { randomUUID } from "crypto";
import { Readable } from "stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  adminUsers,
  investmentReservations,
  ownershipCertificates,
  properties,
  resaleAuditLogs,
  resaleBids,
  resaleListings,
  resaleMarketplaceOfferEvents,
  resaleMarketplaceOffers,
  resaleMarketplaceNotifications,
  resalePayments,
  users,
} from "@shared/schema";
import { db } from "../server/db";
import { hashPassword } from "../server/auth";
import { objectStorageClient } from "../server/objectStorage";
import { storage } from "../server/storage";
import {
  calculateResalePaymentTerms,
  completeListedResaleTransfer,
  createResaleListingSafely,
  processExpiredMarketplaceOffers,
} from "../server/marketplaceOffers";
import { closeTestApp, getTestApp } from "./setup-app";
import {
  createDraftProject,
  createTestDeveloper,
  createTestInvestor,
  loginAsDeveloper,
  uniqueProjectName,
} from "./test-helpers";

const TEST_PREFIX = "__brikvest_test__";
const PAYMENT_WINDOW_MS = 60 * 60 * 1000;

let app: Express;
let adminToken: string;
let adminId: number;

async function loginInvestor(email: string, password: string) {
  const agent = request.agent(app);
  const response = await agent.post("/api/login").send({ email, password });
  expect(response.status).toBe(200);
  return agent;
}

async function loginAsMarketplaceTestAdmin() {
  const username = "__brikvest_test_admin_marketplace_transfer__";
  const password = "MarketplaceAdminTestPass!9";
  let admin = await storage.getAdminUserByUsername(username);
  if (!admin) {
    admin = await storage.createAdminUser({
      username,
      password: await hashPassword(password),
      email: "admin-marketplace-transfer@brikvest.test",
      firstName: "Marketplace",
      lastName: "Admin",
      role: "admin",
    });
  } else {
    await db.update(adminUsers)
      .set({ password: await hashPassword(password), isActive: true })
      .where(eq(adminUsers.id, admin.id));
  }

  const response = await request(app).post("/api/admin/login").send({ username, password });
  expect(response.status).toBe(200);
  return { token: response.body.sessionId as string, id: admin.id };
}

async function createFixture(label: string, options: {
  sellerUnits?: string;
  buyerKycStatus?: string;
} = {}) {
  const developer = await createTestDeveloper();
  const { agent: developerAgent } = await loginAsDeveloper(app, developer);
  const property = await createDraftProject(developerAgent, {
    name: uniqueProjectName(`marketplace-${label}`),
    isTransferable: true,
  });

  const seller = await createTestInvestor(`marketplace-${label}-seller`);
  const buyer = await createTestInvestor(`marketplace-${label}-buyer`, {
    kycStatus: options.buyerKycStatus || "approved",
  });
  const outsider = await createTestInvestor(`marketplace-${label}-outsider`);
  const sellerReservation = (await db.insert(investmentReservations).values({
    propertyId: property.id,
    userId: seller.id,
    fullName: "Marketplace Test Seller",
    email: seller.email,
    phone: "+2348011111111",
    units: options.sellerUnits || "10.00",
    amount: "1000.00",
    unitPriceSnapshot: "100.00",
    currency: "NGN",
    status: "converted_to_investment",
    funnelStage: "confirmed",
    expiresAt: null,
  }).returning())[0];
  const sellerCertificate = (await db.insert(ownershipCertificates).values({
    reservationId: sellerReservation.id,
    certificateNumber: `CERT-TEST-${randomUUID()}`,
    verificationToken: randomUUID(),
    ownerName: "Marketplace Test Seller",
    propertyName: property.name,
    propertyLocation: property.location,
    units: options.sellerUnits || "10.00",
    amount: "1000.00",
    currency: "NGN",
    issuedByAdminId: adminId,
  }).returning())[0];

  return {
    property,
    seller,
    buyer,
    outsider,
    sellerReservation,
    sellerCertificate,
    sellerAgent: await loginInvestor(seller.email, seller.password),
    buyerAgent: await loginInvestor(buyer.email, buyer.password),
    outsiderAgent: await loginInvestor(outsider.email, outsider.password),
  };
}

async function createListedPayment(fixture: Awaited<ReturnType<typeof createFixture>>, opts: {
  units?: string;
  reference?: string;
} = {}) {
  const reference = opts.reference || `TEST-${randomUUID()}`;
  const [listing] = await db.insert(resaleListings).values({
    sellerId: fixture.seller.id,
    propertyId: fixture.property.id,
    reservationId: fixture.sellerReservation.id,
    units: opts.units || "2.00",
    sellingType: "fixed_price",
    askingPrice: "100.00",
    currency: "NGN",
    status: "awaiting_payment",
    winnerId: fixture.buyer.id,
    paymentDeadline: new Date(Date.now() + PAYMENT_WINDOW_MS),
    paymentReference: reference,
  }).returning();
  const [payment] = await db.insert(resalePayments).values({
    listingId: listing.id,
    buyerId: fixture.buyer.id,
    amount: "100.00",
    transactionFee: "2.00",
    totalPayment: "102.00",
    currency: "NGN",
    paymentMethod: "bank_transfer",
    bankReference: "TEST-BANK-REF",
    proofUrl: "/api/documents/resale-payment-proofs/test-proof.pdf",
    proofType: "pdf",
    status: "pending_verification",
    attemptNumber: 1,
  }).returning();
  return { listing, payment };
}

async function insertMarketplaceOffer(fixture: Awaited<ReturnType<typeof createFixture>>, opts: {
  buyerId?: number;
  units?: string;
  reference?: string;
  status?: string;
  proofUrl?: string | null;
  paymentDeadline?: Date | null;
} = {}) {
  const [offer] = await db.insert(resaleMarketplaceOffers).values({
    reference: opts.reference || `BV-TEST-${randomUUID()}`,
    sellerReservationId: fixture.sellerReservation.id,
    propertyId: fixture.property.id,
    sellerId: fixture.seller.id,
    buyerId: opts.buyerId || fixture.buyer.id,
    units: opts.units || "2.00",
    purchasePrice: "100.00",
    transactionFee: "2.00",
    totalPayment: "102.00",
    currency: "NGN",
    status: opts.status || "payment_verified",
    paymentDeadline: opts.paymentDeadline ?? null,
    proofUrl: opts.proofUrl || null,
    proofType: opts.proofUrl ? "pdf" : null,
  }).returning();
  return offer;
}

async function cleanupMarketplaceFixtures() {
  const fixtures = await db.select({ id: properties.id })
    .from(properties)
    .where(like(properties.name, `${TEST_PREFIX}%`));
  const propertyIds = fixtures.map(({ id }) => id);
  if (propertyIds.length) {
    const reservations = await db.select({ id: investmentReservations.id })
      .from(investmentReservations)
      .where(inArray(investmentReservations.propertyId, propertyIds));
    const reservationIds = reservations.map(({ id }) => id);
    const listings = await db.select({ id: resaleListings.id })
      .from(resaleListings)
      .where(inArray(resaleListings.propertyId, propertyIds));
    const listingIds = listings.map(({ id }) => id);
    const offers = await db.select({ id: resaleMarketplaceOffers.id })
      .from(resaleMarketplaceOffers)
      .where(inArray(resaleMarketplaceOffers.propertyId, propertyIds));
    const offerIds = offers.map(({ id }) => id);

    if (offerIds.length) {
      await db.delete(resaleMarketplaceOfferEvents)
        .where(inArray(resaleMarketplaceOfferEvents.offerId, offerIds));
      await db.delete(resaleMarketplaceNotifications)
        .where(inArray(resaleMarketplaceNotifications.offerId, offerIds));
      await db.delete(resaleMarketplaceOffers)
        .where(inArray(resaleMarketplaceOffers.id, offerIds));
    }
    if (listingIds.length) {
      await db.delete(resaleAuditLogs).where(inArray(resaleAuditLogs.listingId, listingIds));
      await db.delete(resaleBids).where(inArray(resaleBids.listingId, listingIds));
      await db.delete(resalePayments).where(inArray(resalePayments.listingId, listingIds));
      await db.delete(resaleListings).where(inArray(resaleListings.id, listingIds));
    }
    if (reservationIds.length) {
      await db.delete(ownershipCertificates)
        .where(inArray(ownershipCertificates.reservationId, reservationIds));
    }
  }
  // The helper only removes test-prefixed users and properties; the marketplace
  // children above are removed first because they reference those rows.
  await import("./test-helpers").then(({ cleanupAllTestData }) => cleanupAllTestData());
}

beforeAll(async () => {
  ({ app } = await getTestApp());
  ({ token: adminToken, id: adminId } = await loginAsMarketplaceTestAdmin());
});

afterAll(async () => {
  await cleanupMarketplaceFixtures();
  await closeTestApp();
});

describe("resale marketplace transfer guards", () => {
  it("rounds the 2% fee in minor units and returns the exact total", () => {
    expect(calculateResalePaymentTerms("0.24")).toEqual({
      purchasePrice: "0.24",
      transactionFee: "0.00",
      totalPayment: "0.24",
    });
    expect(calculateResalePaymentTerms("0.25")).toEqual({
      purchasePrice: "0.25",
      transactionFee: "0.01",
      totalPayment: "0.26",
    });
    expect(calculateResalePaymentTerms("12.34")).toEqual({
      purchasePrice: "12.34",
      transactionFee: "0.25",
      totalPayment: "12.59",
    });
    expect(calculateResalePaymentTerms("100.01")).toEqual({
      purchasePrice: "100.01",
      transactionFee: "2.00",
      totalPayment: "102.01",
    });
  });

  it("requires the exact listed-resale total and approved buyer KYC before transferring units", async () => {
    const fixture = await createFixture("listed-guards", { buyerKycStatus: "submitted" });
    const { listing, payment } = await createListedPayment(fixture);
    expect(await storage.updateUserKycStatus(fixture.buyer.id, "approved")).toBe(true);
    const wrongAmount = await request(app)
      .post(`/api/admin/resale-payments/${payment.id}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "approve", amountReceived: "100.00" });
    expect(wrongAmount.status).toBe(400);
    expect(wrongAmount.body.message).toContain("NGN 102.00");

    await db.update(users)
      .set({ kycStatus: "submitted" })
      .where(eq(users.id, fixture.buyer.id));
    const exactButUnapproved = await request(app)
      .post(`/api/admin/resale-payments/${payment.id}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "approve", amountReceived: "102.00" });
    expect(exactButUnapproved.status).toBe(400);
    expect(exactButUnapproved.body.message).toMatch(/KYC must be approved/i);
    expect((await db.select().from(resalePayments).where(eq(resalePayments.id, payment.id)))[0].status)
      .toBe("pending_verification");

    expect(await storage.updateUserKycStatus(fixture.buyer.id, "approved")).toBe(true);
    const completed = await request(app)
      .post(`/api/admin/resale-payments/${payment.id}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "approve", amountReceived: "102.00" });
    expect(completed.status).toBe(200);

    const sellerAfter = (await db.select().from(investmentReservations)
      .where(eq(investmentReservations.id, fixture.sellerReservation.id)))[0];
    const buyerHoldings = await db.select().from(investmentReservations).where(and(
      eq(investmentReservations.propertyId, fixture.property.id),
      eq(investmentReservations.userId, fixture.buyer.id),
    ));
    const certificateAfter = (await db.select().from(ownershipCertificates)
      .where(eq(ownershipCertificates.reservationId, fixture.sellerReservation.id)))[0];
    expect(sellerAfter.units).toBe("8.00");
    expect(buyerHoldings).toHaveLength(1);
    expect(buyerHoldings[0].units).toBe("2.00");
    expect(certificateAfter.units).toBe("8.00");
    expect((await db.select().from(resaleListings).where(eq(resaleListings.id, listing.id)))[0].status)
      .toBe("sold");
  });

  it("rolls back listed resale holdings and certificates when certificate issuance fails", async () => {
    const fixture = await createFixture("listed-rollback");
    const reference = `ROLLBACK-${randomUUID()}`;
    const { listing, payment } = await createListedPayment(fixture, { reference });
    const duplicateCertificateNumber = `CERT-RESALE-${reference}`;
    await db.update(ownershipCertificates)
      .set({ certificateNumber: duplicateCertificateNumber })
      .where(eq(ownershipCertificates.id, fixture.sellerCertificate.id));

    await expect(completeListedResaleTransfer(payment.id, adminId, "102.00")).rejects.toThrow();

    const sellerAfter = (await db.select().from(investmentReservations)
      .where(eq(investmentReservations.id, fixture.sellerReservation.id)))[0];
    const sellerCertificateAfter = (await db.select().from(ownershipCertificates)
      .where(eq(ownershipCertificates.id, fixture.sellerCertificate.id)))[0];
    const buyerHoldings = await db.select().from(investmentReservations).where(and(
      eq(investmentReservations.propertyId, fixture.property.id),
      eq(investmentReservations.userId, fixture.buyer.id),
    ));
    expect(sellerAfter.units).toBe("10.00");
    expect(sellerCertificateAfter.units).toBe("10.00");
    expect(sellerCertificateAfter.amount).toBe("1000.00");
    expect(buyerHoldings).toHaveLength(0);
    expect((await db.select().from(resalePayments).where(eq(resalePayments.id, payment.id)))[0].status)
      .toBe("pending_verification");
    expect((await db.select().from(resaleListings).where(eq(resaleListings.id, listing.id)))[0].status)
      .toBe("awaiting_payment");
  });

  it("requires the exact marketplace fee total and approved KYC, and rolls back failed offer transfers", async () => {
    const fixture = await createFixture("offer-guards", { buyerKycStatus: "submitted" });
    const offer = await insertMarketplaceOffer(fixture, {
      status: "payment_under_review",
      reference: `OFFER-ROLLBACK-${randomUUID()}`,
    });

    const shortPayment = await request(app)
      .post(`/api/admin/marketplace-offers/${offer.id}/review-payment`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "approve", amountReceived: "100.00" });
    expect(shortPayment.status).toBe(400);
    expect(shortPayment.body.message).toContain("NGN 102.00");
    expect((await db.select().from(resaleMarketplaceOffers)
      .where(eq(resaleMarketplaceOffers.id, offer.id)))[0].status).toBe("payment_under_review");

    const verified = await request(app)
      .post(`/api/admin/marketplace-offers/${offer.id}/review-payment`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "approve", amountReceived: "102.00" });
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe("payment_verified");

    const beforeKyc = await request(app)
      .post(`/api/admin/marketplace-offers/${offer.id}/complete-transfer`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(beforeKyc.status).toBe(409);
    expect(beforeKyc.body.message).toMatch(/KYC must be approved/i);

    expect(await storage.updateUserKycStatus(fixture.buyer.id, "approved")).toBe(true);
    await db.update(ownershipCertificates)
      .set({ certificateNumber: `CERT-RESALE-${offer.reference}` })
      .where(eq(ownershipCertificates.id, fixture.sellerCertificate.id));
    const failedTransfer = await request(app)
      .post(`/api/admin/marketplace-offers/${offer.id}/complete-transfer`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(failedTransfer.status).toBe(500);

    const sellerAfterFailure = (await db.select().from(investmentReservations)
      .where(eq(investmentReservations.id, fixture.sellerReservation.id)))[0];
    const certificateAfterFailure = (await db.select().from(ownershipCertificates)
      .where(eq(ownershipCertificates.id, fixture.sellerCertificate.id)))[0];
    const buyerHoldingsAfterFailure = await db.select().from(investmentReservations).where(and(
      eq(investmentReservations.propertyId, fixture.property.id),
      eq(investmentReservations.userId, fixture.buyer.id),
    ));
    expect(sellerAfterFailure.units).toBe("10.00");
    expect(certificateAfterFailure.units).toBe("10.00");
    expect(certificateAfterFailure.amount).toBe("1000.00");
    expect(buyerHoldingsAfterFailure).toHaveLength(0);
    expect((await db.select().from(resaleMarketplaceOffers)
      .where(eq(resaleMarketplaceOffers.id, offer.id)))[0].status).toBe("payment_verified");
    expect(await db.select().from(resaleMarketplaceOfferEvents).where(and(
      eq(resaleMarketplaceOfferEvents.offerId, offer.id),
      eq(resaleMarketplaceOfferEvents.action, "ownership_transfer_completed"),
    ))).toHaveLength(0);

    await db.update(ownershipCertificates)
      .set({ certificateNumber: `CERT-TEST-${randomUUID()}` })
      .where(eq(ownershipCertificates.id, fixture.sellerCertificate.id));
    const completed = await request(app)
      .post(`/api/admin/marketplace-offers/${offer.id}/complete-transfer`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("completed");

    const sellerAfter = (await db.select().from(investmentReservations)
      .where(eq(investmentReservations.id, fixture.sellerReservation.id)))[0];
    expect(sellerAfter.units).toBe("8.00");
    expect((await db.select().from(ownershipCertificates)
      .where(eq(ownershipCertificates.reservationId, fixture.sellerReservation.id)))[0].units).toBe("8.00");
    expect(await db.select().from(investmentReservations).where(and(
      eq(investmentReservations.propertyId, fixture.property.id),
      eq(investmentReservations.userId, fixture.buyer.id),
    ))).toHaveLength(1);
  });

  it("serves resale receipts only to buyers, sellers, and administrators", async () => {
    const fixture = await createFixture("receipt-access");
    const { payment } = await createListedPayment(fixture);
    const offer = await insertMarketplaceOffer(fixture, {
      status: "payment_under_review",
      proofUrl: "/api/documents/resale-payment-proofs/test-marketplace-receipt.pdf",
    });
    const file = {
      exists: vi.fn().mockResolvedValue([true]),
      getMetadata: vi.fn().mockResolvedValue([{ contentType: "application/pdf" }]),
      createReadStream: vi.fn(() => Readable.from(["private receipt content"])),
    };
    const bucketStub = vi.spyOn(objectStorageClient, "bucket")
      .mockReturnValue({ file: vi.fn(() => file) } as any);
    const previousPrivateDir = process.env.PRIVATE_OBJECT_DIR;
    process.env.PRIVATE_OBJECT_DIR = "marketplace-receipt-test/.private";

    try {
      for (const participant of [fixture.buyerAgent, fixture.sellerAgent]) {
        const listedReceipt = await participant.get(`/api/resale-payments/${payment.id}/receipt`);
        expect(listedReceipt.status).toBe(200);
        expect(listedReceipt.body.toString()).toContain("private receipt content");
        expect(listedReceipt.headers["cache-control"]).toBe("private, no-store");

        const offerReceipt = await participant.get(`/api/marketplace/offers/${offer.id}/receipt`);
        expect(offerReceipt.status).toBe(200);
        expect(offerReceipt.body.toString()).toContain("private receipt content");
      }
      expect((await fixture.outsiderAgent.get(`/api/resale-payments/${payment.id}/receipt`)).status).toBe(403);
      expect((await fixture.outsiderAgent.get(`/api/marketplace/offers/${offer.id}/receipt`)).status).toBe(403);
      expect((await request(app)
        .get(`/api/admin/resale-payments/${payment.id}/receipt`)
        .set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
      expect((await request(app)
        .get(`/api/admin/marketplace-offers/${offer.id}/receipt`)
        .set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
      expect((await request(app).get("/api/documents/resale-payment-proofs/test-marketplace-receipt.pdf")).status).toBe(404);
    } finally {
      bucketStub.mockRestore();
      if (previousPrivateDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
      else process.env.PRIVATE_OBJECT_DIR = previousPrivateDir;
    }
  });

  it("serializes competing listings and accepted offers so combined reservations stay within ownership", async () => {
    const fixture = await createFixture("concurrent-sales");
    const listingAttempts = await Promise.allSettled([
      createResaleListingSafely({
        sellerId: fixture.seller.id,
        propertyId: fixture.property.id,
        reservationId: fixture.sellerReservation.id,
        units: "6.00",
        sellingType: "fixed_price",
        askingPrice: "100.00",
        currency: "NGN",
      }),
      createResaleListingSafely({
        sellerId: fixture.seller.id,
        propertyId: fixture.property.id,
        reservationId: fixture.sellerReservation.id,
        units: "6.00",
        sellingType: "fixed_price",
        askingPrice: "100.00",
        currency: "NGN",
      }),
    ]);
    expect(listingAttempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const secondBuyer = await createTestInvestor("marketplace-concurrent-second-buyer");
    const [firstOffer, secondOffer] = await Promise.all([
      insertMarketplaceOffer(fixture, {
        buyerId: fixture.buyer.id,
        units: "3.00",
        status: "awaiting_seller_response",
      }),
      insertMarketplaceOffer(fixture, {
        buyerId: secondBuyer.id,
        units: "3.00",
        status: "awaiting_seller_response",
      }),
    ]);
    const sellerResponses = await Promise.all([
      fixture.sellerAgent.post(`/api/marketplace/offers/${firstOffer.id}/respond`).send({ action: "accept" }),
      fixture.sellerAgent.post(`/api/marketplace/offers/${secondOffer.id}/respond`).send({ action: "accept" }),
    ]);
    expect(sellerResponses.map(({ status }) => status).sort()).toEqual([200, 409]);

    const activeListings = await db.select().from(resaleListings).where(and(
      eq(resaleListings.reservationId, fixture.sellerReservation.id),
      inArray(resaleListings.status, ["pending_review", "approved", "awaiting_payment"]),
    ));
    const reservedOffers = await db.select().from(resaleMarketplaceOffers).where(and(
      eq(resaleMarketplaceOffers.sellerReservationId, fixture.sellerReservation.id),
      inArray(resaleMarketplaceOffers.status, [
        "payment_pending",
        "payment_rejected",
        "payment_under_review",
        "payment_verified",
        "transfer_pending",
      ]),
    ));
    const reservedUnits = activeListings.reduce((sum, listing) => sum + Number(listing.units), 0)
      + reservedOffers.reduce((sum, offer) => sum + Number(offer.units), 0);
    expect(activeListings.reduce((sum, listing) => sum + Number(listing.units), 0)).toBe(6);
    expect(reservedOffers.reduce((sum, offer) => sum + Number(offer.units), 0)).toBe(3);
    expect(reservedUnits).toBeLessThanOrEqual(Number(fixture.sellerReservation.units));
  });

  it("starts the one-hour payment window after both parties agree and expires missed offers", async () => {
    const fixture = await createFixture("payment-window");
    const positions = await fixture.buyerAgent.get(
      `/api/marketplace/unlisted-land/${fixture.property.id}/owners`,
    );
    expect(positions.status).toBe(200);
    const offerResponse = await fixture.buyerAgent.post("/api/marketplace/offers").send({
      positionToken: positions.body[0].positionToken,
      units: "1.00",
      purchasePrice: "100.00",
    });
    expect(offerResponse.status).toBe(201);
    const offerId = offerResponse.body.id as number;
    let offer = (await db.select().from(resaleMarketplaceOffers)
      .where(eq(resaleMarketplaceOffers.id, offerId)))[0];
    expect(offer.status).toBe("awaiting_seller_response");
    expect(offer.paymentDeadline).toBeNull();

    const counter = await fixture.sellerAgent.post(`/api/marketplace/offers/${offerId}/respond`).send({
      action: "counter",
      units: "2.00",
      purchasePrice: "200.00",
    });
    expect(counter.status).toBe(200);
    offer = (await db.select().from(resaleMarketplaceOffers)
      .where(eq(resaleMarketplaceOffers.id, offerId)))[0];
    expect(offer.status).toBe("awaiting_buyer_response");
    expect(offer.paymentDeadline).toBeNull();

    const acceptedAt = Date.now();
    const acceptance = await fixture.buyerAgent.post(`/api/marketplace/offers/${offerId}/respond`)
      .send({ action: "accept" });
    expect(acceptance.status).toBe(200);
    offer = (await db.select().from(resaleMarketplaceOffers)
      .where(eq(resaleMarketplaceOffers.id, offerId)))[0];
    expect(offer.status).toBe("payment_pending");
    expect(offer.paymentDeadline).toBeInstanceOf(Date);
    expect(offer.paymentDeadline!.getTime() - acceptedAt).toBeGreaterThanOrEqual(PAYMENT_WINDOW_MS - 1000);
    expect(offer.paymentDeadline!.getTime() - acceptedAt).toBeLessThanOrEqual(PAYMENT_WINDOW_MS + 1000);

    await db.update(resaleMarketplaceOffers)
      .set({ paymentDeadline: new Date(Date.now() - 1000) })
      .where(eq(resaleMarketplaceOffers.id, offerId));
    await processExpiredMarketplaceOffers();
    offer = (await db.select().from(resaleMarketplaceOffers)
      .where(eq(resaleMarketplaceOffers.id, offerId)))[0];
    expect(offer.status).toBe("expired");
  });
});