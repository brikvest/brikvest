import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { storage } from "../server/storage";
import { hashPassword } from "../server/auth";
import { getTestApp, closeTestApp } from "./setup-app";
import {
  cleanupAllTestData,
  createTestDeveloper,
  uniqueProjectName,
} from "./test-helpers";

let app: Express;

beforeAll(async () => {
  ({ app } = await getTestApp());
});

afterAll(async () => {
  await cleanupAllTestData();
  await closeTestApp();
});

async function getAdminToken(): Promise<string> {
  const username = `__brikvest_test_admin__`;
  const password = "AdminTestPass!9";
  let admin = await storage.getAdminUserByUsername(username);
  if (!admin) {
    admin = await storage.createAdminUser({
      username,
      password: await hashPassword(password),
      email: "admin@brikvest.test",
      firstName: "Test",
      lastName: "Admin",
      role: "admin",
    });
  } else {
    const { db } = await import("../server/db");
    const { adminUsers } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(adminUsers)
      .set({ password: await hashPassword(password) })
      .where(eq(adminUsers.id, admin.id));
  }
  const adminLogin = await request(app)
    .post("/api/admin/login")
    .send({ username, password });
  if (adminLogin.status !== 200) {
    throw new Error(`Admin login failed (${adminLogin.status}): ${adminLogin.text}`);
  }
  return adminLogin.body.sessionId;
}

describe("Listed-by attribution vs ownership", () => {
  it("generic admin edit can change listerId but never developerId", async () => {
    const owner = await createTestDeveloper();
    const lister = await createTestDeveloper();

    const property = await storage.createProperty({
      name: uniqueProjectName("lister-attr"),
      location: "Test City",
      description: "Attribution decoupling test property",
      totalValue: 1_000_000,
      minInvestment: 10_000,
      availableSlots: 10,
      totalSlots: 10,
      imageUrl: "https://example.com/test.jpg",
      status: "active",
      developerId: owner.id,
      listerId: owner.id,
    } as any);

    const token = await getAdminToken();
    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: property.name,
        location: property.location,
        description: property.description,
        totalValue: property.totalValue,
        minInvestment: property.minInvestment,
        availableSlots: property.availableSlots,
        totalSlots: property.totalSlots,
        imageUrl: property.imageUrl,
        status: property.status,
        // Attribution change: allowed.
        listerId: lister.id,
        // Ownership change attempt: must be silently stripped by the route.
        developerId: lister.id,
      });

    expect(res.status).toBe(200);

    const updated = await storage.getProperty(property.id);
    expect(updated).toBeTruthy();
    // "Listed by" attribution follows the dedicated field...
    expect((updated as any).listerId).toBe(lister.id);
    // ...while ownership/portal control is untouched by the generic edit.
    expect(updated!.developerId).toBe(owner.id);
  });
});
