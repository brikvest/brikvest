import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { investmentReservations, resaleListings } from "@shared/schema";
import { storage } from "../server/storage";
import { closeTestApp, getTestApp } from "./setup-app";
import {
  cleanupAllTestData,
  createDraftProject,
  createTestDeveloper,
  createTestInvestor,
  loginAsDeveloper,
} from "./test-helpers";

let app: Express;

async function loginInvestor(email: string, password: string) {
  const agent = request.agent(app);
  const response = await agent.post("/api/login").send({ email, password });
  expect(response.status).toBe(200);
  return agent;
}

async function createReservation(propertyId: number, user: { id: number; email: string }) {
  const [reservation] = await db.insert(investmentReservations).values({
    propertyId,
    userId: user.id,
    fullName: "Test Investor",
    email: user.email,
    phone: "+2348011111111",
    units: "1",
    amount: "1000000",
    unitPriceSnapshot: "1000000",
    currency: "NGN",
    status: "reserved",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }).returning();
  return reservation;
}

beforeAll(async () => {
  ({ app } = await getTestApp());
});

afterAll(async () => {
  await cleanupAllTestData();
  await closeTestApp();
});

describe("one-time KYC payment gate", () => {
  it("blocks primary payment details and proof uploads until KYC is approved", async () => {
    const developer = await createTestDeveloper();
    const { agent: developerAgent } = await loginAsDeveloper(app, developer);
    const property = await createDraftProject(developerAgent);
    const investor = await createTestInvestor("unapproved-payment", { kycStatus: "not_started" });
    const reservation = await createReservation(property.id, investor);
    const agent = await loginInvestor(investor.email, investor.password);

    const instructions = await agent.get(`/api/user/reservations/${reservation.id}/payment-instructions`);
    expect(instructions.status).toBe(403);

    const upload = await agent
      .post("/api/user/payment-submission")
      .field("reservationId", String(reservation.id))
      .attach("paymentProof", Buffer.from("proof"), {
        filename: "proof.png",
        contentType: "image/png",
      });
    expect(upload.status).toBe(403);
    expect(upload.body.error).toMatch(/KYC verification must be approved/i);
  });

  it("keeps approval for current and later purchases and rejects attempts to alter it", async () => {
    const developer = await createTestDeveloper();
    const { agent: developerAgent } = await loginAsDeveloper(app, developer);
    const property = await createDraftProject(developerAgent);
    const investor = await createTestInvestor("durable-approval");
    const first = await createReservation(property.id, investor);
    const agent = await loginInvestor(investor.email, investor.password);

    expect((await agent.get(`/api/user/reservations/${first.id}/payment-instructions`)).status).toBe(200);

    const second = await createReservation(property.id, investor);
    expect((await agent.get(`/api/user/reservations/${second.id}/payment-instructions`)).status).toBe(200);

    expect(await storage.updateUserKycStatus(investor.id, "rejected", "stale decision")).toBe(false);
    expect(await storage.submitUserKyc(investor.id, {
      kycFullName: "Delayed stale submission",
      kycSubmittedAt: new Date(),
    })).toBe(false);
    expect((await storage.getUser(investor.id))?.kycStatus).toBe("approved");

    const resubmit = await agent
      .post("/api/kyc/submit")
      .field("fullName", "Test Investor")
      .field("dateOfBirth", "1990-01-01")
      .field("address", "1 Test Street")
      .field("occupation", "Engineer")
      .field("idType", "passport")
      .field("idNumber", "TEST123");
    expect(resubmit.status).toBe(409);
    expect(resubmit.body.status).toBe("approved");
    expect((await storage.getUser(investor.id))?.kycStatus).toBe("approved");
  });

  it("allows rejected users to resubmit without replacing retained documents", async () => {
    const investor = await createTestInvestor("rejected-resubmit", {
      kycStatus: "rejected",
      kycIdDocumentUrl: "https://example.test/id.png",
      kycSignatureUrl: "https://example.test/signature.png",
    });
    const agent = await loginInvestor(investor.email, investor.password);
    const response = await agent
      .post("/api/kyc/submit")
      .field("fullName", "Test Investor")
      .field("dateOfBirth", "1990-01-01")
      .field("address", "1 Test Street")
      .field("occupation", "Engineer")
      .field("idType", "passport")
      .field("idNumber", "TEST123");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("submitted");
    expect((await storage.getUser(investor.id))?.kycStatus).toBe("submitted");
  });

  it("applies fresh KYC and winner ownership checks to resale payment paths", async () => {
    const developer = await createTestDeveloper();
    const { agent: developerAgent } = await loginAsDeveloper(app, developer);
    const property = await createDraftProject(developerAgent);
    const seller = await createTestInvestor("resale-seller");
    const buyer = await createTestInvestor("resale-buyer", { kycStatus: "submitted" });
    const otherBuyer = await createTestInvestor("resale-other");
    const sellerReservation = await createReservation(property.id, seller);
    const [listing] = await db.insert(resaleListings).values({
      sellerId: seller.id,
      propertyId: property.id,
      reservationId: sellerReservation.id,
      units: "1",
      sellingType: "fixed_price",
      askingPrice: "1000000",
      currency: "NGN",
      status: "awaiting_payment",
      winnerId: buyer.id,
      paymentDeadline: new Date(Date.now() + 60 * 60 * 1000),
    }).returning();

    const buyerAgent = await loginInvestor(buyer.email, buyer.password);
    expect((await buyerAgent.get(`/api/resale-listings/${listing.id}/payment-instructions`)).status).toBe(403);
    const blockedUpload = await buyerAgent
      .post("/api/resale-payments")
      .field("listingId", String(listing.id))
      .field("bankReference", "TEST-REF")
      .attach("paymentProof", Buffer.from("proof"), {
        filename: "proof.png",
        contentType: "image/png",
      });
    expect(blockedUpload.status).toBe(403);

    expect(await storage.updateUserKycStatus(buyer.id, "approved")).toBe(true);
    expect((await buyerAgent.get(`/api/resale-listings/${listing.id}/payment-instructions`)).status).toBe(200);

    const otherAgent = await loginInvestor(otherBuyer.email, otherBuyer.password);
    expect((await otherAgent.get(`/api/resale-listings/${listing.id}/payment-instructions`)).status).toBe(403);
    expect((await otherAgent.get(`/api/resale-payments/listing/${listing.id}`)).status).toBe(403);

    await db.delete(resaleListings).where(eq(resaleListings.id, listing.id));
  });
});