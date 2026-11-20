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
  loginAsDeveloper,
  uniqueProjectName,
} from "./test-helpers";

let app: Express;
let adminToken: string;

async function loginAsTestAdmin(): Promise<string> {
  const username = "__brikvest_test_admin_cost_breakdown__";
  const password = "AdminTestPass!9";
  let admin = await storage.getAdminUserByUsername(username);
  if (!admin) {
    admin = await storage.createAdminUser({
      username,
      password: await hashPassword(password),
      email: "admin-cost-breakdown@brikvest.test",
      firstName: "Cost",
      lastName: "Breakdown",
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
  return response.body.sessionId;
}

beforeAll(async () => {
  ({ app } = await getTestApp());
  adminToken = await loginAsTestAdmin();
});

afterAll(async () => {
  await cleanupAllTestData();
  await closeTestApp();
});

describe("admin property cost breakdown updates", () => {
  it("rejects negative costs and persists valid visibility and component values without changing pricing", async () => {
    const property = await storage.createProperty({
      name: uniqueProjectName("cost-breakdown"),
      location: "Test City",
      description: "A test property for checking persisted cost transparency values.",
      totalValue: 10_000_000,
      minInvestment: 1_000_000,
      availableSlots: 10,
      totalSlots: 10,
      imageUrl: "https://example.test/property.jpg",
      status: "active",
    } as any);

    const editableProperty = {
      name: property.name,
      location: property.location,
      description: property.description,
      totalValue: property.totalValue,
      minInvestment: property.minInvestment,
      availableSlots: property.availableSlots,
      totalSlots: property.totalSlots,
      imageUrl: property.imageUrl,
      status: property.status,
    };

    const invalid = await request(app)
      .put(`/api/properties/${property.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...editableProperty, unitLandCost: -1 });
    expect(invalid.status).toBe(400);

    const mismatchedVisible = await request(app)
      .put(`/api/properties/${property.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ...editableProperty,
        unitLandCost: 600_000,
        unitDueDiligenceCost: 50_000,
        unitAgentFees: 100_000,
        unitServiceCharge: 150_000,
        showUnitCostBreakdown: true,
      });
    expect(mismatchedVisible.status).toBe(400);
    expect(mismatchedVisible.body.details[0].message).toContain("minimum investment");

    const mismatchedHidden = await request(app)
      .put(`/api/properties/${property.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ...editableProperty,
        unitLandCost: 600_000,
        unitDueDiligenceCost: 50_000,
        unitAgentFees: 100_000,
        unitServiceCharge: 150_000,
        showUnitCostBreakdown: false,
      });
    expect(mismatchedHidden.status).toBe(200);

    // Simulate previously saved inconsistent data that bypassed request validation.
    await storage.updateProperty(property.id, { showUnitCostBreakdown: true } as any);
    const publicProperties = await request(app)
      .get("/api/properties-converted")
      .query({ currency: "NGN" });
    expect(publicProperties.status).toBe(200);
    const publicProperty = publicProperties.body.find((candidate: any) => candidate.id === property.id);
    expect(publicProperty).toBeDefined();
    expect(publicProperty.showUnitCostBreakdown).toBe(true);
    expect(publicProperty.unitCostBreakdownEligible).toBe(false);
    expect(publicProperty).not.toHaveProperty("unitLandCost");

    const valid = await request(app)
      .put(`/api/properties/${property.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ...editableProperty,
        unitLandCost: 700_000,
        unitDueDiligenceCost: 50_000,
        unitAgentFees: 100_000,
        unitServiceCharge: 150_000,
        showUnitCostBreakdown: true,
      });
    expect(valid.status).toBe(200);

    const persisted = await storage.getProperty(property.id);
    expect(persisted).toMatchObject({
      unitLandCost: 700_000,
      unitDueDiligenceCost: 50_000,
      unitAgentFees: 100_000,
      unitServiceCharge: 150_000,
      showUnitCostBreakdown: true,
      minInvestment: 1_000_000,
      totalValue: 10_000_000,
    });
  });

  it("rejects a developer update that would invalidate a visible breakdown", async () => {
    const developer = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, developer);
    const property = await storage.createProperty({
      name: uniqueProjectName("developer-cost-breakdown"),
      location: "Test City",
      description: "A developer property with a valid public cost breakdown.",
      totalValue: 10_000_000,
      minInvestment: 1_000_000,
      availableSlots: 10,
      totalSlots: 10,
      totalUnits: 10,
      unitPrice: 1_000_000,
      imageUrl: "https://example.test/property.jpg",
      status: "active",
      developerId: developer.id,
      unitLandCost: 700_000,
      unitDueDiligenceCost: 50_000,
      unitAgentFees: 100_000,
      unitServiceCharge: 150_000,
      showUnitCostBreakdown: true,
    } as any);

    const response = await agent
      .patch(`/api/developer/projects/${property.id}`)
      .send({ minInvestment: 900_000 });

    expect(response.status).toBe(400);
    expect(response.body.details[0].message).toContain("minimum investment");
    expect((await storage.getProperty(property.id))?.minInvestment).toBe(1_000_000);
  });
});