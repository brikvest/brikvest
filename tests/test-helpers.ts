import { inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import {
  users,
  properties,
  investmentReservations,
  paymentSubmissions,
  projectMilestones,
  projectUpdates,
  developerInvestorNotes,
  type InsertUser,
} from "@shared/schema";
import { hashPassword } from "../server/auth";
import { storage } from "../server/storage";
import request from "supertest";
import type { Express } from "express";

export const TEST_PREFIX = "__brikvest_test__";

export function uniqueTestEmail(label: string) {
  return `${TEST_PREFIX}${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@brikvest.test`;
}

export function uniqueProjectName(label: string) {
  return `${TEST_PREFIX}${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export interface TestDeveloper {
  id: number;
  email: string;
  password: string;
}

export async function createTestDeveloper(): Promise<TestDeveloper> {
  const password = "TestDeveloperPass!9";
  const email = uniqueTestEmail("dev");
  const hashed = await hashPassword(password);
  const insert: InsertUser = {
    email,
    password: hashed,
    firstName: "Test",
    lastName: "Developer",
    phone: "+2348010000000",
    role: "developer",
    accountStatus: "approved",
    emailVerified: true,
    companyName: "Test Dev Co Ltd",
    companyRegistration: "RC0000000",
    websiteUrl: null,
  };
  const dev = await storage.createUser(insert);
  return { id: dev.id, email, password };
}

export async function createTestInvestor(label = "investor") {
  const password = "TestInvestorPass!9";
  const email = uniqueTestEmail(label);
  const hashed = await hashPassword(password);
  const insert: InsertUser = {
    email,
    password: hashed,
    firstName: "Test",
    lastName: "Investor",
    phone: "+2348011111111",
    role: "user",
    accountStatus: "approved",
    emailVerified: true,
    kycStatus: "approved",
    country: "NG",
  };
  const user = await storage.createUser(insert);
  return { id: user.id, email, password };
}

export interface DevAgent {
  agent: ReturnType<typeof request.agent>;
  developer: TestDeveloper;
}

export async function loginAsDeveloper(
  app: Express,
  developer: TestDeveloper,
): Promise<DevAgent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/developer/login")
    .send({ email: developer.email, password: developer.password });
  if (res.status !== 200) {
    throw new Error(
      `Failed to log in test developer (${res.status}): ${res.text}`,
    );
  }
  return { agent, developer };
}

export async function createDraftProject(
  agent: ReturnType<typeof request.agent>,
  overrides: Record<string, any> = {},
) {
  const name = uniqueProjectName("project");
  const res = await agent.post("/api/developer/projects").send({
    name,
    location: "Lagos",
    description: "Test project description",
    totalValue: 100_000_000,
    totalUnits: 100,
    unitPrice: 1_000_000,
    minInvestment: 1_000_000,
    imageUrl:
      "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=400&q=80",
    propertyType: "residential",
    currency: "NGN",
    city: "Lagos",
    district: "Lekki",
    spvName: "Test SPV Ltd",
    developerEquityUnits: 0,
    isTransferable: true,
    ...overrides,
  });
  if (res.status !== 201) {
    throw new Error(`Failed to create project (${res.status}): ${res.text}`);
  }
  return res.body;
}

/**
 * Cleanup helper: removes all DB rows that look like test fixtures
 * (email starts with TEST_PREFIX or property name starts with TEST_PREFIX).
 * Safe to call from test teardown.
 */
export async function cleanupAllTestData() {
  // Find all properties with the test prefix
  const testProps = await db
    .select()
    .from(properties)
    .where(like(properties.name, `${TEST_PREFIX}%`));
  const propIds = testProps.map((p) => p.id);

  // Delete child rows for those properties
  if (propIds.length > 0) {
    // Resolve reservations on those properties so we can clean up payment submissions
    const reservations = await db
      .select()
      .from(investmentReservations)
      .where(inArray(investmentReservations.propertyId, propIds));
    const resIds = reservations.map((r) => r.id);

    if (resIds.length > 0) {
      await db
        .delete(paymentSubmissions)
        .where(inArray(paymentSubmissions.reservationId, resIds));
    }
    await db
      .delete(investmentReservations)
      .where(inArray(investmentReservations.propertyId, propIds));
    await db
      .delete(projectMilestones)
      .where(inArray(projectMilestones.propertyId, propIds));
    await db
      .delete(projectUpdates)
      .where(inArray(projectUpdates.propertyId, propIds));
    await db
      .delete(developerInvestorNotes)
      .where(inArray(developerInvestorNotes.propertyId, propIds));
    await db.delete(properties).where(inArray(properties.id, propIds));
  }

  // Delete the test users themselves
  await db.delete(users).where(like(users.email, `${TEST_PREFIX}%`));
}
