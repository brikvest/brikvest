import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { adminUsers } from "@shared/schema";
import { db } from "../server/db";
import { hashPassword } from "../server/auth";
import { storage } from "../server/storage";
import { closeTestApp, getTestApp } from "./setup-app";
import {
  cleanupAllTestData,
  createTestDeveloper,
  createTestInvestor,
  loginAsDeveloper,
  uniqueProjectName,
} from "./test-helpers";

let app: Express;
let adminToken: string;
let propertyId: number;
let developerAgent: ReturnType<typeof request.agent>;
let investorAgent: ReturnType<typeof request.agent>;

async function loginAsTestAdmin() {
  const username = "__brikvest_test_admin_due_diligence__";
  const password = "AdminTestPass!14";
  let admin = await storage.getAdminUserByUsername(username);
  if (!admin) {
    admin = await storage.createAdminUser({
      username,
      password: await hashPassword(password),
      email: "admin-due-diligence@brikvest.test",
      firstName: "Due",
      lastName: "Diligence",
      role: "admin",
    });
  } else {
    await db
      .update(adminUsers)
      .set({ password: await hashPassword(password), isActive: true })
      .where(eq(adminUsers.id, admin.id));
  }
  const response = await request(app).post("/api/admin/login").send({ username, password });
  expect(response.status).toBe(200);
  return response.body.sessionId as string;
}

beforeAll(async () => {
  ({ app } = await getTestApp());
  adminToken = await loginAsTestAdmin();
  const developer = await createTestDeveloper();
  ({ agent: developerAgent } = await loginAsDeveloper(app, developer));
  const investor = await createTestInvestor("document-upload");
  investorAgent = request.agent(app);
  const investorLogin = await investorAgent
    .post("/api/login")
    .send({ email: investor.email, password: investor.password });
  expect(investorLogin.status).toBe(200);
  const property = await storage.createProperty({
    name: uniqueProjectName("due-diligence-document"),
    location: "Test City",
    description: "A property used to verify due diligence document persistence and exposure.",
    totalValue: 10_000_000,
    minInvestment: 1_000_000,
    availableSlots: 10,
    totalSlots: 10,
    imageUrl: "https://example.test/property.jpg",
    status: "active",
  } as any);
  propertyId = property.id;
});

afterAll(async () => {
  await cleanupAllTestData();
  await closeTestApp();
});

describe("property due diligence document API", () => {
  const editableFields = async () => {
    const property = await storage.getProperty(propertyId);
    return {
      name: property!.name,
      location: property!.location,
      description: property!.description,
      totalValue: property!.totalValue,
      minInvestment: property!.minInvestment,
      availableSlots: property!.availableSlots,
      totalSlots: property!.totalSlots,
      imageUrl: property!.imageUrl,
      status: property!.status,
    };
  };

  it("allows only admins to persist and remove paired document metadata", async () => {
    const fields = await editableFields();
    const metadata = {
      dueDiligenceDocumentName: "Property due diligence.pdf",
      dueDiligenceDocumentUrl: "/api/documents/documents/property-due-diligence.pdf",
    };

    expect((await request(app).put(`/api/properties/${propertyId}`).send({ ...fields, ...metadata })).status).toBe(401);

    const invalid = await request(app)
      .put(`/api/properties/${propertyId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...fields, dueDiligenceDocumentName: metadata.dueDiligenceDocumentName });
    expect(invalid.status).toBe(400);

    const update = await request(app)
      .put(`/api/properties/${propertyId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...fields, ...metadata });
    expect(update.status).toBe(200);
    expect(await storage.getProperty(propertyId)).toMatchObject(metadata);

    const remove = await request(app)
      .put(`/api/properties/${propertyId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...fields, dueDiligenceDocumentName: null, dueDiligenceDocumentUrl: null });
    expect(remove.status).toBe(200);
    expect(await storage.getProperty(propertyId)).toMatchObject({
      dueDiligenceDocumentName: null,
      dueDiligenceDocumentUrl: null,
    });
  });

  it("rejects anonymous document uploads while preserving admin and developer access", async () => {
    const anonymous = await request(app)
      .post("/api/upload/document")
      .attach("document", Buffer.from("%PDF-1.4"), {
        filename: "due-diligence.pdf",
        contentType: "application/pdf",
      });
    expect(anonymous.status).toBe(401);

    const admin = await request(app)
      .post("/api/upload/document")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(admin.status).toBe(400);
    expect(admin.body.error).toBe("No file provided");

    const developer = await developerAgent.post("/api/upload/document");
    expect(developer.status).toBe(400);
    expect(developer.body.error).toBe("No file provided");

    const investor = await investorAgent
      .post("/api/upload/document")
      .attach("document", Buffer.from("%PDF-1.4"), {
        filename: "investor-upload.pdf",
        contentType: "application/pdf",
      });
    expect(investor.status).toBe(403);
  });

  it("exposes document metadata in customer property responses", async () => {
    const fields = await editableFields();
    const metadata = {
      dueDiligenceDocumentName: "Customer due diligence.pdf",
      dueDiligenceDocumentUrl: "/api/documents/documents/customer-due-diligence.pdf",
    };
    await request(app)
      .put(`/api/properties/${propertyId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...fields, ...metadata });

    const response = await request(app).get("/api/properties-converted").query({ currency: "NGN" });
    expect(response.status).toBe(200);
    expect(response.body.find((property: any) => property.id === propertyId)).toMatchObject(metadata);
  });

  it("retires checklist and proof-photo application endpoints", async () => {
    expect((await request(app).get("/api/verification-steps")).status).toBe(404);
    expect((await request(app).get(`/api/properties/${propertyId}/verification`)).status).toBe(404);
    expect((await request(app).post("/api/verification/upload-url")).status).toBe(404);
    expect((await request(app).get("/verification-photos/old-proof.jpg")).status).toBe(404);
  });
});