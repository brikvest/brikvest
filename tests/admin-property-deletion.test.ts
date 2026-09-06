import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { hashPassword } from "../server/auth";
import { storage } from "../server/storage";
import {
  adminUsers,
  constructionStages,
  developerLeads,
  developerInvestorNotes,
  investmentPayments,
  investmentGroups,
  investmentReservations,
  ownershipCertificates,
  paymentSubmissions,
  projectMilestones,
  projectUpdates,
  propertyValuations,
  propertyVerificationChecklists,
  reservationReminders,
  resaleAuditLogs,
  resaleBids,
  resaleListings,
  resalePayments,
  vendorPayments,
  vendors,
  verificationStepCompletions,
  verificationSteps,
  properties,
} from "@shared/schema";
import {
  cleanupAllTestData,
  createDraftProject,
  createTestDeveloper,
  createTestInvestor,
  loginAsDeveloper,
} from "./test-helpers";
import { closeTestApp, getTestApp } from "./setup-app";

const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn().mockResolvedValue(false),
}));

vi.mock("../server/emailService", () => ({
  sendEmail: sendEmailMock,
}));

let app: Express;
let adminToken: string;
let adminUserId: number;

async function loginAsTestAdmin() {
  const username = "__brikvest_test_admin_deletion__";
  const password = "AdminTestPass!9";
  let admin = await storage.getAdminUserByUsername(username);
  if (!admin) {
    admin = await storage.createAdminUser({
      username,
      password: await hashPassword(password),
      email: "admin-deletion@brikvest.test",
      firstName: "Test",
      lastName: "Admin",
      role: "admin",
    });
  } else {
    await db
      .update(adminUsers)
      .set({ password: await hashPassword(password), isActive: true })
      .where(eq(adminUsers.id, admin.id));
  }

  const response = await request(app)
    .post("/api/admin/login")
    .send({ username, password });
  expect(response.status).toBe(200);
  adminUserId = admin.id;
  return response.body.sessionId as string;
}

beforeAll(async () => {
  ({ app } = await getTestApp());
  adminToken = await loginAsTestAdmin();
});

afterAll(async () => {
  await cleanupAllTestData();
  await closeTestApp();
});

describe("admin property deletion", () => {
  it("deletes an eligible property and all direct and indirect dependent records", async () => {
    const developer = await createTestDeveloper();
    const investor = await createTestInvestor("property-delete");
    const { agent } = await loginAsDeveloper(app, developer);
    const property = await createDraftProject(agent);

    const [reservation] = await db
      .insert(investmentReservations)
      .values({
        propertyId: property.id,
        userId: investor.id,
        fullName: "Deletion Test Investor",
        email: investor.email,
        phone: "+2348011111111",
        units: "1",
        amount: "1000000",
        unitPriceSnapshot: "1000000",
        status: "reserved",
      })
      .returning();
    await db.insert(reservationReminders).values({
      reservationId: reservation.id,
      sentByUserId: developer.id,
      recipientEmail: investor.email,
    });
    await db.insert(investmentPayments).values({
      reservationId: reservation.id,
      amount: 1000000,
      paymentMethod: "bank_transfer",
      recordedByAdminId: adminUserId,
    });
    await db.insert(paymentSubmissions).values({
      reservationId: reservation.id,
      userId: investor.id,
      proofUrl: "https://example.test/payment-proof.jpg",
      amount: "1000000",
      paymentMethod: "bank_transfer",
    });
    await db.insert(ownershipCertificates).values({
      reservationId: reservation.id,
      certificateNumber: `DELETE-CERT-${property.id}`,
      verificationToken: `delete-verification-${property.id}-${Date.now()}`,
      ownerName: "Deletion Test Investor",
      propertyName: property.name,
      propertyLocation: property.location,
      units: "1",
      amount: "1000000",
      issuedByAdminId: adminUserId,
    });
    await db.insert(developerLeads).values({
      propertyId: property.id,
      developerUserId: developer.id,
      fullName: "Deletion Lead",
      email: investor.email,
      convertedReservationId: reservation.id,
      stage: "converted",
    });
    await db.insert(projectUpdates).values({
      propertyId: property.id,
      authorUserId: developer.id,
      subject: "Deletion update",
      body: "This update should be removed.",
    });
    await db.insert(projectMilestones).values({
      propertyId: property.id,
      name: "Deletion milestone",
    });
    await db.insert(developerInvestorNotes).values({
      propertyId: property.id,
      developerUserId: developer.id,
      investorUserId: investor.id,
      notes: "This note should be removed.",
    });
    await db.insert(propertyValuations).values({
      propertyId: property.id,
      valuationDate: new Date(),
      currentValue: "110000000",
    });

    let [step] = await db.select().from(verificationSteps).limit(1);
    if (!step) {
      [step] = await db
        .insert(verificationSteps)
        .values({
          name: `Deletion verification ${Date.now()}`,
          description: "Deletion test",
          order: 999,
        })
        .returning();
    }
    await db.insert(propertyVerificationChecklists).values({
      propertyId: property.id,
      verificationStepId: step.id,
    });
    await db.insert(verificationStepCompletions).values({
      propertyId: property.id,
      verificationStepId: step.id,
      isCompleted: true,
    });

    const [stage] = await db
      .select()
      .from(constructionStages)
      .where(eq(constructionStages.propertyId, property.id))
      .limit(1);
    const [vendor] = await db
      .insert(vendors)
      .values({
        propertyId: property.id,
        stageId: stage.id,
        name: "Deletion Vendor",
      })
      .returning();
    await db.insert(vendorPayments).values({
      vendorId: vendor.id,
      propertyId: property.id,
      amount: "50000",
      paidAt: new Date(),
      createdByUserId: developer.id,
    });

    const [listing] = await db
      .insert(resaleListings)
      .values({
        sellerId: investor.id,
        propertyId: property.id,
        reservationId: reservation.id,
        units: "1",
        sellingType: "fixed_price",
        askingPrice: "1100000",
      })
      .returning();
    const [bid] = await db
      .insert(resaleBids)
      .values({
        listingId: listing.id,
        bidderId: developer.id,
        amount: "1050000",
      })
      .returning();
    const [resalePayment] = await db
      .insert(resalePayments)
      .values({
        listingId: listing.id,
        buyerId: developer.id,
        amount: "1050000",
      })
      .returning();
    await db.insert(resaleAuditLogs).values({
      listingId: listing.id,
      bidId: bid.id,
      paymentId: resalePayment.id,
      propertyId: property.id,
      action: "deletion_test",
      actorType: "system",
    });
    const [group] = await db
      .insert(investmentGroups)
      .values({
        name: "Deletion Group",
        description: "Deletion test",
        creatorEmail: investor.email,
        targetAmount: 1000000,
        currentAmount: 0,
        maxMembers: 2,
        currentMembers: 1,
        propertyId: property.id,
        inviteCode: `delete-${Date.now()}-${property.id}`,
      })
      .returning();

    const response = await request(app)
      .delete(`/api/properties/${property.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Property deleted successfully");
    expect(response.body.cancelledReservations).toBe(1);
    expect(response.body.notifiedUsers).toEqual([investor.email]);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: investor.email,
        subject: "Property Removed - Brikvest",
      }),
    );
    expect(await storage.getProperty(property.id)).toBeUndefined();
    expect(
      await db
        .select()
        .from(reservationReminders)
        .where(eq(reservationReminders.reservationId, reservation.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(investmentPayments)
        .where(eq(investmentPayments.reservationId, reservation.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(paymentSubmissions)
        .where(eq(paymentSubmissions.reservationId, reservation.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(ownershipCertificates)
        .where(eq(ownershipCertificates.reservationId, reservation.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(projectMilestones)
        .where(eq(projectMilestones.propertyId, property.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(developerInvestorNotes)
        .where(eq(developerInvestorNotes.propertyId, property.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(resaleListings).where(eq(resaleListings.id, listing.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(vendors).where(eq(vendors.id, vendor.id)),
    ).toHaveLength(0);
    const [detachedGroup] = await db
      .select()
      .from(investmentGroups)
      .where(eq(investmentGroups.id, group.id));
    expect(detachedGroup.propertyId).toBeNull();
  });

  it("rejects deletion when the property has a confirmed investment", async () => {
    const developer = await createTestDeveloper();
    const investor = await createTestInvestor("confirmed-delete");
    const { agent } = await loginAsDeveloper(app, developer);
    const property = await createDraftProject(agent);
    const [reservation] = await db
      .insert(investmentReservations)
      .values({
        propertyId: property.id,
        userId: investor.id,
        fullName: "Confirmed Investor",
        email: investor.email,
        phone: "+2348011111111",
        units: "1",
        amount: "1000000",
        unitPriceSnapshot: "1000000",
        status: "converted_to_investment",
      })
      .returning();

    const response = await request(app)
      .delete(`/api/properties/${property.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("has_confirmed_investors");
    expect(response.body.message).toContain("confirmed investment");
    expect(await storage.getProperty(property.id)).toBeDefined();

    await db
      .update(investmentReservations)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(investmentReservations.id, reservation.id),
          eq(investmentReservations.propertyId, property.id),
        ),
      );
    await storage.deleteDeveloperProject(property.id);
  });
});