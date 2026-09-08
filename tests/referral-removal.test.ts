import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { closeTestApp, getTestApp } from "./setup-app";
import {
  cleanupAllTestData,
  createDraftProject,
  createTestDeveloper,
  loginAsDeveloper,
  uniqueTestEmail,
} from "./test-helpers";

let app: Express;

beforeAll(async () => {
  ({ app } = await getTestApp());
});

afterAll(async () => {
  await cleanupAllTestData();
  await closeTestApp();
});

describe("retired referral routes", () => {
  it.each([
    ["get", "/api/user/referral"],
    ["get", "/api/validate-referral/BRIK-OLD"],
    ["get", "/api/admin/referral-rewards"],
    ["patch", "/api/admin/referral-rewards/1/payout"],
  ] as const)("%s %s is unavailable", async (method, path) => {
    const response = request(app)[method](path);
    if (method === "patch") response.send({ status: "paid" });
    expect((await response).status).toBe(404);
  });

  it("has no referral tables or attribution columns in the database", async () => {
    const result = await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          table_name IN ('referrals', 'referral_rewards')
          OR (
            table_name = 'users'
            AND column_name IN ('referral_code', 'referred_by_user_id')
          )
          OR (
            table_name = 'investment_reservations'
            AND column_name = 'referral_code'
          )
        )
    `);

    expect(result.rows).toEqual([]);
  });
});

describe("ordinary account and reservation flows", () => {
  it("registers and signs in normally while ignoring an old referral field", async () => {
    const email = uniqueTestEmail("registration");
    const password = "ValidTestPass!9";
    const agent = request.agent(app);

    const registration = await agent.post("/api/register").send({
      email,
      password,
      firstName: "Standard",
      lastName: "Investor",
      phone: "+2348012345678",
      referralCode: "BRIK-RETIRED",
    });

    expect(registration.status).toBe(201);
    expect(registration.body.referralCode).toBeUndefined();
    expect(registration.body.referredByUserId).toBeUndefined();

    const login = await request(app).post("/api/login").send({ email, password });
    expect(login.status).toBe(200);
  });

  it("creates a standard reservation while ignoring an old referral field", async () => {
    const developer = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, developer);
    const property = await createDraftProject(agent);
    await storage.updatePropertyFields(property.id, { projectStatus: "live" });
    const email = uniqueTestEmail("reservation");

    const reservation = await request(app).post("/api/reservations").send({
      propertyId: property.id,
      fullName: "Standard Investor",
      email,
      phone: "+2348012345678",
      units: "1",
      amount: "1000000",
      unitPriceSnapshot: "1000000",
      currency: "NGN",
      status: "reserved",
      referralCode: "BRIK-RETIRED",
    });

    expect(reservation.status).toBe(201);
    expect(reservation.body.referralCode).toBeUndefined();

    const fetched = await request(app)
      .get("/api/reservations")
      .query({ email });
    expect(fetched.status).toBe(200);
    expect(fetched.body).toHaveLength(1);
  });
});