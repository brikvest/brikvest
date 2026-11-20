import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { storage } from "../server/storage";
import {
  getCustomerPropertyStatusLabel,
  isPropertySoldOut,
} from "../shared/propertyAvailability";
import { closeTestApp, getTestApp } from "./setup-app";
import {
  cleanupAllTestData,
  createDraftProject,
  createTestDeveloper,
  loginAsDeveloper,
  uniqueTestEmail,
} from "./test-helpers";

const homeSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/home.tsx"),
  "utf8",
);

let app: Express;

beforeAll(async () => {
  ({ app } = await getTestApp());
});

afterAll(async () => {
  await cleanupAllTestData();
  await closeTestApp();

  // Reservation emails append the same local preview during tests. Collapse
  // exact duplicates so test execution does not dirty this tracked fixture.
  const previewPath = path.resolve(process.cwd(), "email-preview.html");
  const preview = fs.readFileSync(previewPath, "utf8");
  const secondDocument = preview.indexOf("<!doctype html>", 1);
  if (secondDocument > 0) {
    const firstDocument = preview.slice(0, secondDocument);
    const copies = preview.length / firstDocument.length;
    if (Number.isInteger(copies) && preview === firstDocument.repeat(copies)) {
      fs.writeFileSync(previewPath, firstDocument);
    }
  }
});

function reservationPayload(propertyId: number, email: string) {
  return {
    propertyId,
    fullName: "Availability Test Investor",
    email,
    phone: "+2348012345678",
    units: "1",
    amount: "1000000",
    unitPriceSnapshot: "1000000",
    currency: "NGN",
    status: "reserved",
  };
}

describe("sold-out property presentation", () => {
  it("normalizes both sold-out signals without changing active eligibility", () => {
    expect(isPropertySoldOut({ status: "sold_out", projectStatus: "live" })).toBe(true);
    expect(isPropertySoldOut({ status: "active", projectStatus: "sold_out" })).toBe(true);
    expect(isPropertySoldOut({ status: "active", projectStatus: "live" })).toBe(false);
    expect(getCustomerPropertyStatusLabel({ status: "sold_out" })).toBe("Sold Out");
    expect(getCustomerPropertyStatusLabel({ status: "active", projectStatus: "live" })).toBe("Active");
  });

  it("shows explicit sold-out badges and suppresses reservation actions", () => {
    expect(homeSource).toContain('data-testid={`sold-out-card-badge-${property.id}`}');
    expect(homeSource).toContain('data-testid="sold-out-detail-badge"');
    expect(homeSource).toContain("getCustomerPropertyStatusLabel(selectedProperty)");
    expect(homeSource).toContain("!isPropertySoldOut(selectedProperty) &&");
    expect(homeSource).toContain("isPropertySoldOut(property) ? (");
  });
});

describe("sold-out reservation guard", () => {
  it("rejects either sold-out lifecycle signal and still accepts active properties", async () => {
    const developer = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, developer);
    const property = await createDraftProject(agent);

    await storage.updatePropertyFields(property.id, {
      status: "sold_out",
      projectStatus: "live",
    });
    const listingStatusResponse = await request(app)
      .post("/api/reservations")
      .send(reservationPayload(property.id, uniqueTestEmail("listing-sold-out")));
    expect(listingStatusResponse.status).toBe(400);
    expect(listingStatusResponse.body.message).toMatch(/sold out.*no longer available/i);

    await storage.updatePropertyFields(property.id, {
      status: "active",
      projectStatus: "sold_out",
    });
    const projectStatusResponse = await request(app)
      .post("/api/reservations")
      .send(reservationPayload(property.id, uniqueTestEmail("project-sold-out")));
    expect(projectStatusResponse.status).toBe(400);
    expect(projectStatusResponse.body.message).toMatch(/sold out.*no longer available/i);

    await storage.updatePropertyFields(property.id, {
      status: "active",
      projectStatus: "live",
    });

    const activeResponse = await request(app)
      .post("/api/reservations")
      .send(reservationPayload(property.id, uniqueTestEmail("active")));
    expect(activeResponse.status).toBe(201);
  });

  it("guides investors to choose fewer units when availability is exceeded", async () => {
    const developer = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, developer);
    const property = await createDraftProject(agent);

    await storage.updatePropertyFields(property.id, {
      status: "active",
      projectStatus: "live",
      availableSlots: 1,
    });

    const response = await request(app)
      .post("/api/reservations")
      .send({
        ...reservationPayload(property.id, uniqueTestEmail("excess-units")),
        units: "2",
        amount: "2000000",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Only 1 unit available. Please select a smaller quantity.",
    });
    expect(homeSource).toContain('title: "Unable to reserve that quantity"');
    expect(homeSource).toContain("getApiErrorMessage(");
    expect(homeSource).not.toContain("description: error.message");
  });
});