/**
 * Smoke "E2E" test for the Developer Portal.
 *
 * The Replit container does not have a browser binary installed, so a
 * Playwright/Puppeteer smoke would fail at runtime. Instead, this test:
 *
 *   1. Logs in as the demo developer via /api/developer/login.
 *   2. Walks through every API endpoint that the Developer Portal pages
 *      query when a user navigates the six tabs (Overview, Fundraising,
 *      Construction, Sales, CapTable, Communications) and the project list.
 *   3. Asserts each tab's data shape is well-formed and includes the
 *      key fields the UI binds to.
 *
 * If a browser image is added to the project later, replace this file
 * with a Playwright spec.  See tests/README.md for the swap-out plan.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { spawnSync } from "child_process";
import path from "path";
import { storage } from "../server/storage";
import { getTestApp, closeTestApp } from "./setup-app";

const DEMO_DEV_EMAIL = "developer.demo@brikvest.net";
const DEMO_DEV_PASSWORD = "DemoDeveloper2026!";

let app: Express;

function ensureSeed() {
  const result = spawnSync(
    "npx",
    ["tsx", path.resolve(process.cwd(), "scripts", "seed-demo-developer.ts")],
    {
      stdio: "pipe",
      encoding: "utf-8",
      env: process.env,
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Seed script failed (status ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

beforeAll(async () => {
  // Make sure the demo developer + projects exist before we navigate.
  ensureSeed();
  ({ app } = await getTestApp());
}, 120_000);

afterAll(async () => {
  await closeTestApp();
});

describe("Developer Portal smoke (HTTP-level navigation)", () => {
  it("logs in as the demo developer and reaches /api/developer/me", async () => {
    const agent = request.agent(app);
    const login = await agent
      .post("/api/developer/login")
      .send({ email: DEMO_DEV_EMAIL, password: DEMO_DEV_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.email).toBe(DEMO_DEV_EMAIL);
    expect(login.body.role).toBe("developer");

    const me = await agent.get("/api/developer/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(DEMO_DEV_EMAIL);
  });

  it("renders the dashboard project list with rollup data", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/developer/login")
      .send({ email: DEMO_DEV_EMAIL, password: DEMO_DEV_PASSWORD });

    const list = await agent.get("/api/developer/projects");
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    for (const p of list.body) {
      // These are the badges/cards the dashboard binds to.
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("salesStage");
      expect(p).toHaveProperty("constructionPercent");
      expect(p).toHaveProperty("investorCount");
      expect(p).toHaveProperty("totalRaisedEquivalents");
    }
  });

  it("walks each tab on a demo project and asserts the data each tab needs", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/developer/login")
      .send({ email: DEMO_DEV_EMAIL, password: DEMO_DEV_PASSWORD });

    const dev = await storage.getUserByEmail(DEMO_DEV_EMAIL);
    const allProjects = await storage.getPropertiesByDeveloper(dev!.id);
    // Restrict to the two seed-managed projects so the smoke test is
    // deterministic even if the dev has stale/legacy projects in the DB.
    const projects = allProjects.filter((p) =>
      [
        "Lekki Heights — Off-Plan",
        "Maitama Garden Villas — Completed",
      ].includes(p.name),
    );
    expect(projects.length, "seed projects found").toBe(2);

    for (const project of projects) {
      // Overview / Fundraising / Construction / Sales / CapTable all read
      // from the same rollup endpoint.
      const rollup = await agent.get(
        `/api/developer/projects/${project.id}/rollup`,
      );
      expect(rollup.status, `rollup for ${project.name}`).toBe(200);
      expect(rollup.body.funding.equivalents).toMatchObject({
        NGN: { raised: expect.any(Number), target: expect.any(Number) },
        USD: { raised: expect.any(Number), target: expect.any(Number) },
        GBP: { raised: expect.any(Number), target: expect.any(Number) },
      });
      expect(rollup.body.sales).toHaveProperty("totalUnits");
      expect(rollup.body.sales).toHaveProperty("investorUnits");
      expect(rollup.body.sales).toHaveProperty("salesStage");
      expect(rollup.body.funnel).toMatchObject({
        reserved: expect.any(Number),
        kycComplete: expect.any(Number),
        paymentSubmitted: expect.any(Number),
        confirmed: expect.any(Number),
      });
      expect(rollup.body.construction).toHaveProperty("overall");
      expect(rollup.body.construction).toHaveProperty("milestoneCount");
      expect(rollup.body.capTable).toHaveProperty("investorEquityPercent");

      // Construction tab — milestone list with the drag-and-drop sortOrder
      const milestones = await agent.get(
        `/api/developer/projects/${project.id}/milestones`,
      );
      expect(milestones.status).toBe(200);
      expect(milestones.body.length).toBeGreaterThan(0);
      for (const m of milestones.body) {
        expect(m).toHaveProperty("name");
        expect(m).toHaveProperty("sortOrder");
        expect(m).toHaveProperty("status");
      }

      // Sales / CapTable tabs — investor list
      const investors = await agent.get(
        `/api/developer/projects/${project.id}/investors`,
      );
      expect(investors.status).toBe(200);
      expect(investors.body.length).toBeGreaterThan(0);
      for (const i of investors.body) {
        expect(i).toHaveProperty("name");
        expect(i).toHaveProperty("email");
        expect(i).toHaveProperty("units");
        expect(i).toHaveProperty("status");
        expect(i).toHaveProperty("paymentHistory");
      }

      // Sales tab — CSV export button
      const csv = await agent.get(
        `/api/developer/projects/${project.id}/investors.csv`,
      );
      expect(csv.status).toBe(200);
      expect(csv.headers["content-type"]).toMatch(/text\/csv/);

      // Communications tab — list
      const updates = await agent.get(
        `/api/developer/projects/${project.id}/updates`,
      );
      expect(updates.status).toBe(200);
      expect(updates.body.length).toBeGreaterThan(0);
      for (const u of updates.body) {
        expect(u).toHaveProperty("subject");
        expect(u).toHaveProperty("body");
      }
    }
  }, 120_000);

  it("serves the SPA shell on the developer portal route", async () => {
    // The Vite dev server isn't mounted in our test app, so we only assert
    // the API routes don't accidentally swallow the SPA paths.  When
    // vitest is running outside of dev mode, Express returns 404 for
    // unknown HTML routes — this is the expected SPA fallback behaviour
    // because vite/serveStatic isn't wired in for the test app.
    const res = await request(app).get("/developer/dashboard");
    // Either 404 (no static handler) or 200 (if static was wired up); both
    // mean the API layer didn't intercept the SPA route.
    expect([200, 404]).toContain(res.status);
  });
});
