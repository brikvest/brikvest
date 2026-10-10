import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("../server/storage", () => ({
  storage: {
    getAdminUserByUsername: async (username: string) => ({ id: 1, username, password: "fixture", role: username === "not-admin" ? "investor" : "admin", isActive: true }),
    updateAdminUserLastLogin: async () => {},
    createProperty: async (data: any) => { const row = { id: fixture.rows.length + 1, sellDate: null, currency: "NGN", ...data }; fixture.rows.push(row); return row; },
    updateProperty: async (id: number, data: any) => {
      const row = fixture.rows.find(r => r.id === id);
      for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
      return row;
    },
    getProperty: async (id: number) => fixture.rows.find(r => r.id === id),
    getProperties: async () => fixture.rows,
    getPublicProperties: async () => fixture.rows,
    getUser: async (id: number) => ({ id, role: "developer", subscriptionStatus: "active", plan: "starter" }),
    getReservationsByProperty: async () => [],
  },
}));
vi.mock("../server/db", () => ({ db: {}, pool: {} }));
vi.mock("../server/auth", () => ({
  setupAuth: (app: any) => app.use((req: any, _res: any, next: any) => {
    req.isAuthenticated = () => !!req.headers["x-fixture-role"];
    req.user = req.headers["x-fixture-role"] ? { id: 2, role: req.headers["x-fixture-role"], teamRole: "owner", accountStatus: "approved" } : undefined;
    next();
  }),
  comparePasswords: async () => true,
  hashPassword: async () => "fixture",
}));
vi.mock("../server/startup-maintenance", () => ({ runStartupDataMaintenance: async () => {} }));
vi.mock("../server/legal/routes", () => ({ registerLegalRoutes: () => {} }));
vi.mock("../server/legal/approval", () => ({}));
vi.mock("../server/marketplaceOffers", () => ({ registerMarketplaceOfferRoutes: () => {} }));
vi.mock("../server/cloudinary", () => ({
  upload: { single: () => (_req: any, _res: any, next: any) => next(), fields: () => (_req: any, _res: any, next: any) => next() },
  documentUpload: { single: () => (_req: any, _res: any, next: any) => next() },
}));
vi.mock("../server/emailService", () => ({ sendEmail: vi.fn() }));
vi.mock("../server/resaleEmails", () => ({}));
vi.mock("../server/emailTemplates", () => ({}));
vi.mock("../server/currencyService", () => ({
  getExchangeRates: async () => ({ NGN: 1500, USD: 1 }),
  convertCurrency: (value: number) => value / 1500,
  detectUserCurrency: () => "NGN",
}));

let app: ReturnType<typeof express>;
let token: string;
beforeAll(async () => {
  // Suppress route-registration timers; no backend entrypoint or workers start.
  const interval = vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref() {} } as any);
  try {
    const { registerRoutes } = await import("../server/routes");
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  } finally { interval.mockRestore(); }
  const response = await request(app).post("/api/admin/login").send({ username: "fixture-admin", password: "fixture-password" });
  expect(response.status).toBe(200);
  token = response.body.sessionId;
});
afterAll(() => vi.restoreAllMocks());
const base = { name: "Fixture", location: "Abuja", description: "Fixture property",
  totalValue: 10000, minInvestment: 1000, totalSlots: 10, availableSlots: 10, imageUrl: "/fixture.svg", currency: "NGN" };
const admin = (method: "post" | "put", url: string, data: any) =>
  request(app)[method](url).set("Authorization", `Bearer ${token}`).send(data);

describe("actual property routes with isolated persistence", () => {
  it("supports create, update, omission, reads, conversion and clear without affecting availability", async () => {
    const legacy = await admin("post", "/api/properties", base);
    expect(legacy.status).toBe(201);
    expect(legacy.body.sellDate).toBeNull();
    const created = await admin("post", "/api/properties", { ...base, sellDate: "2028-02-29" });
    expect(created.status).toBe(201);
    const id = created.body.id;
    for (const currency of ["NGN", "USD"]) {
      const listing = await request(app).get("/api/properties-converted").query({ currency });
      expect(listing.status).toBe(200);
      expect(listing.body.find((r: any) => r.id === id).sellDate).toBe("2028-02-29");
    }
    expect((await request(app).get(`/api/properties/${id}`).set("x-fixture-role", "investor")).body.sellDate).toBe("2028-02-29");
    expect((await request(app).get("/api/properties").set("x-fixture-role", "investor")).body.find((r: any) => r.id === id).sellDate).toBe("2028-02-29");
    expect((await request(app).get("/api/admin/properties").set("Authorization", `Bearer ${token}`)).body.find((r: any) => r.id === id).sellDate).toBe("2028-02-29");
    expect((await admin("put", `/api/properties/${id}`, { ...base, name: "Edited" })).body.sellDate).toBe("2028-02-29");
    expect((await admin("put", `/api/properties/${id}`, { ...base, sellDate: "2029-01-01" })).body.sellDate).toBe("2029-01-01");
    const cleared = await admin("put", `/api/properties/${id}`, { ...base, sellDate: null });
    expect(cleared.body).toMatchObject({ sellDate: null, availableSlots: 10, totalSlots: 10, minInvestment: 1000 });
  });
  it.each(["2026-02-29", "", "2026-10-10T00:00:00Z"])("rejects invalid admin create and update: %s", async sellDate => {
    expect((await admin("post", "/api/properties", { ...base, sellDate })).status).toBe(400);
    expect((await admin("put", "/api/properties/1", { ...base, sellDate })).status).toBe(400);
  });
  it("requires admin authentication and prevents developer setting/clearing", async () => {
    expect((await request(app).post("/api/properties").send({ ...base, sellDate: "2028-02-29" })).status).toBe(401);
    expect((await request(app).put("/api/properties/1").set("Authorization", "Bearer invalid").send({ ...base, sellDate: null })).status).toBe(401);
    expect((await request(app).put("/api/properties/1").set("x-fixture-role", "investor").send({ ...base, sellDate: null })).status).toBe(401);
    for (const sellDate of ["2028-02-29", null]) {
      expect((await request(app).post("/api/developer/projects").set("x-fixture-role", "developer").send({ ...base, sellDate })).status).toBe(403);
      expect((await request(app).patch("/api/developer/projects/1").set("x-fixture-role", "developer").send({ sellDate })).status).toBe(403);
    }
  });
  it("preserves an admin-set date when a developer updates an unrelated allowed field", async () => {
    const created = await admin("post", "/api/properties", { ...base, developerId: 2, sellDate: "2028-02-29" });
    const response = await request(app).patch(`/api/developer/projects/${created.body.id}`)
      .set("x-fixture-role", "developer").send({ name: "Developer unrelated edit" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: "Developer unrelated edit", sellDate: "2028-02-29" });
  });
});
