import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { storage } from "../server/storage";
import { getTestApp, closeTestApp } from "./setup-app";
import {
  cleanupAllTestData,
  createDraftProject,
  createTestDeveloper,
  createTestInvestor,
  loginAsDeveloper,
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

describe("Developer auth", () => {
  it("rejects access to /api/developer/me without a session", async () => {
    const res = await request(app).get("/api/developer/me");
    expect(res.status).toBe(401);
  });

  it("rejects /api/developer/login with bad credentials", async () => {
    const res = await request(app)
      .post("/api/developer/login")
      .send({ email: "noone@nowhere.test", password: "Wrong!Pass1" });
    expect(res.status).toBe(401);
  });

  it("rejects developer login from a regular user account", async () => {
    const investor = await createTestInvestor("non-dev-login");
    const res = await request(app)
      .post("/api/developer/login")
      .send({ email: investor.email, password: investor.password });
    expect(res.status).toBe(403);
  });

  it("allows a developer to log in and reach /api/developer/me", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);
    const me = await agent.get("/api/developer/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(dev.email);
    expect(me.body.role).toBe("developer");
    expect(me.body.password).toBeUndefined();
  });
});

describe("Project CRUD", () => {
  it("creates a project as draft, lists it, updates it, and submits it for approval", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);

    const created = await createDraftProject(agent);
    expect(created.id).toBeTypeOf("number");
    expect(created.projectStatus).toBe("draft");

    const list = await agent.get("/api/developer/projects");
    expect(list.status).toBe(200);
    const found = list.body.find((p: any) => p.id === created.id);
    expect(found).toBeTruthy();
    expect(found.constructionPercent).toBe(0);
    expect(found.investorCount).toBe(0);
    expect(found.totalRaisedEquivalents).toMatchObject({
      NGN: expect.any(Object),
      USD: expect.any(Object),
      GBP: expect.any(Object),
    });

    const patch = await agent
      .patch(`/api/developer/projects/${created.id}`)
      .send({ description: "Updated description", salesStage: "completed" });
    expect(patch.status).toBe(200);
    expect(patch.body.description).toBe("Updated description");
    expect(patch.body.salesStage).toBe("completed");

    const submit = await agent.post(
      `/api/developer/projects/${created.id}/submit`,
    );
    expect(submit.status).toBe(200);
    expect(submit.body.projectStatus).toBe("pending_approval");

    const cantSubmitAgain = await agent.post(
      `/api/developer/projects/${created.id}/submit`,
    );
    expect(cantSubmitAgain.status).toBe(400);
  });

  it("rejects an invalid salesStage value", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);
    const project = await createDraftProject(agent);
    const res = await agent
      .patch(`/api/developer/projects/${project.id}`)
      .send({ salesStage: "bogus_value" });
    expect(res.status).toBe(400);
  });

  it("does not let one developer access another developer's project", async () => {
    const devA = await createTestDeveloper();
    const devB = await createTestDeveloper();
    const { agent: agentA } = await loginAsDeveloper(app, devA);
    const { agent: agentB } = await loginAsDeveloper(app, devB);
    const project = await createDraftProject(agentA);

    const get = await agentB.get(`/api/developer/projects/${project.id}`);
    expect(get.status).toBe(403);

    const patch = await agentB
      .patch(`/api/developer/projects/${project.id}`)
      .send({ description: "hijack" });
    expect(patch.status).toBe(403);
  });

  it("rejects creation when developerEquityUnits exceeds totalUnits", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);
    const res = await agent.post("/api/developer/projects").send({
      name: uniqueProjectName("equity-too-high"),
      location: "Lagos",
      description: "x",
      totalValue: 1000,
      totalUnits: 10,
      unitPrice: 100,
      imageUrl: "https://example.com/x.png",
      developerEquityUnits: 11,
    });
    expect(res.status).toBe(400);
  });
});

describe("Milestones — create, update, reorder, delete", () => {
  it("supports the full milestone lifecycle including reorder via sortOrder", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);
    const project = await createDraftProject(agent);

    // Create 3 milestones
    const m1 = await agent
      .post(`/api/developer/projects/${project.id}/milestones`)
      .send({ name: "Land", status: "done", percentComplete: 100 });
    expect(m1.status).toBe(201);
    expect(m1.body.sortOrder).toBe(0);

    const m2 = await agent
      .post(`/api/developer/projects/${project.id}/milestones`)
      .send({ name: "Foundation", status: "in_progress", percentComplete: 50 });
    expect(m2.body.sortOrder).toBe(1);

    const m3 = await agent
      .post(`/api/developer/projects/${project.id}/milestones`)
      .send({ name: "Roof", status: "not_started", percentComplete: 0 });
    expect(m3.body.sortOrder).toBe(2);

    // List
    const list = await agent.get(
      `/api/developer/projects/${project.id}/milestones`,
    );
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(3);

    // Update — change status + percent
    const patch = await agent
      .patch(`/api/developer/milestones/${m2.body.id}`)
      .send({
        status: "done",
        percentComplete: 100,
        notes: "Completed ahead of schedule",
      });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("done");
    expect(patch.body.percentComplete).toBe(100);
    expect(patch.body.notes).toBe("Completed ahead of schedule");

    // Reorder via sortOrder PATCH (which is what the drag-and-drop UI does):
    // swap m1 (0) and m3 (2)
    const reorder1 = await agent
      .patch(`/api/developer/milestones/${m1.body.id}`)
      .send({ sortOrder: 2 });
    expect(reorder1.status).toBe(200);
    const reorder2 = await agent
      .patch(`/api/developer/milestones/${m3.body.id}`)
      .send({ sortOrder: 0 });
    expect(reorder2.status).toBe(200);

    const reordered = await agent.get(
      `/api/developer/projects/${project.id}/milestones`,
    );
    const idsBySortOrder = [...reordered.body]
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
      .map((m: any) => m.id);
    expect(idsBySortOrder[0]).toBe(m3.body.id);
    expect(idsBySortOrder[2]).toBe(m1.body.id);

    // Delete
    const del = await agent.delete(
      `/api/developer/milestones/${m3.body.id}`,
    );
    expect(del.status).toBe(200);
    const after = await agent.get(
      `/api/developer/projects/${project.id}/milestones`,
    );
    expect(after.body.length).toBe(2);
    expect(after.body.find((m: any) => m.id === m3.body.id)).toBeUndefined();
  });

  it("does not let a developer mutate another developer's milestone", async () => {
    const devA = await createTestDeveloper();
    const devB = await createTestDeveloper();
    const { agent: agentA } = await loginAsDeveloper(app, devA);
    const { agent: agentB } = await loginAsDeveloper(app, devB);
    const project = await createDraftProject(agentA);
    const m = await agentA
      .post(`/api/developer/projects/${project.id}/milestones`)
      .send({ name: "Land", status: "done", percentComplete: 100 });

    const patch = await agentB
      .patch(`/api/developer/milestones/${m.body.id}`)
      .send({ status: "in_progress" });
    expect(patch.status).toBe(403);

    const del = await agentB.delete(`/api/developer/milestones/${m.body.id}`);
    expect(del.status).toBe(403);
  });
});

describe("Investor list, rollup, and CSV export", () => {
  it("returns an investor list with funnel/rollup data after seeding a confirmed reservation", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);
    const project = await createDraftProject(agent, {
      totalValue: 10_000_000,
      totalUnits: 10,
      unitPrice: 1_000_000,
    });
    const investor = await createTestInvestor("investor-rollup");

    // Inject a confirmed reservation directly (mirrors what the seed does).
    const reservation = await storage.createInvestmentReservation({
      propertyId: project.id,
      userId: investor.id,
      fullName: "Test Investor",
      email: investor.email,
      phone: "+2348019999999",
      units: "3",
      unitPriceSnapshot: "1000000",
      amount: "3000000",
      currency: "NGN",
      status: "converted_to_investment",
    });

    const investors = await agent.get(
      `/api/developer/projects/${project.id}/investors`,
    );
    expect(investors.status).toBe(200);
    expect(investors.body.length).toBe(1);
    const row = investors.body[0];
    expect(row.email).toBe(investor.email);
    expect(Number(row.units)).toBe(3);
    expect(row.status).toBe("converted_to_investment");
    expect(row.kycStatus).toBe("approved");

    const rollup = await agent.get(
      `/api/developer/projects/${project.id}/rollup`,
    );
    expect(rollup.status).toBe(200);
    expect(rollup.body.funding.totalRaised).toBe(3_000_000);
    expect(rollup.body.sales.investorUnits).toBe(3);
    expect(rollup.body.capTable.shareholderCount).toBe(1);
    expect(rollup.body.funding.equivalents).toMatchObject({
      NGN: expect.any(Object),
      USD: expect.any(Object),
      GBP: expect.any(Object),
    });

    // Save a developer note on the investor
    const note = await agent
      .post(`/api/developer/projects/${project.id}/notes`)
      .send({ investorUserId: investor.id, notes: "VIP — fast follow-up" });
    expect(note.status).toBe(200);
    expect(note.body.notes).toContain("VIP");

    // Note shows up in the investor list
    const investorsAfterNote = await agent.get(
      `/api/developer/projects/${project.id}/investors`,
    );
    expect(investorsAfterNote.body[0].notes).toContain("VIP");
  });

  it("exports investors as CSV with headers and rows", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);
    const project = await createDraftProject(agent);
    const investor = await createTestInvestor("csv-investor");
    await storage.createInvestmentReservation({
      propertyId: project.id,
      userId: investor.id,
      fullName: "CSV Investor",
      email: investor.email,
      phone: "+2348018888888",
      units: "2",
      unitPriceSnapshot: "1000000",
      amount: "2000000",
      currency: "NGN",
      status: "converted_to_investment",
    });

    const csv = await agent.get(
      `/api/developer/projects/${project.id}/investors.csv`,
    );
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.headers["content-disposition"]).toMatch(/_investors\.csv/);
    const lines = csv.text.split("\n");
    expect(lines[0]).toContain('"Name"');
    expect(lines[0]).toContain('"Email"');
    expect(lines[0]).toContain('"Status"');
    // header + 1 investor row = 2 lines
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('"CSV Investor"');
    expect(lines[1]).toContain(investor.email);
  });
});

describe("Project update broadcast", () => {
  it("creates an update with sanitized HTML and counts confirmed investors as recipients", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);
    const project = await createDraftProject(agent);
    const investor1 = await createTestInvestor("update-recip1");
    const investor2 = await createTestInvestor("update-recip2");
    // Confirmed: counts as recipient
    await storage.createInvestmentReservation({
      propertyId: project.id,
      userId: investor1.id,
      fullName: "Recipient One",
      email: investor1.email,
      phone: "+2348017777771",
      units: "1",
      unitPriceSnapshot: "1000000",
      amount: "1000000",
      currency: "NGN",
      status: "converted_to_investment",
    });
    // Reserved (NOT confirmed): does NOT count as recipient
    await storage.createInvestmentReservation({
      propertyId: project.id,
      userId: investor2.id,
      fullName: "Reserved Two",
      email: investor2.email,
      phone: "+2348017777772",
      units: "1",
      unitPriceSnapshot: "1000000",
      amount: "1000000",
      currency: "NGN",
      status: "reserved",
    });

    const dirtySubject = "Quarterly update";
    const dirtyBody =
      '<p>Hello <script>alert("xss")</script>investors</p><p>Stay safe.</p>';
    const post = await agent
      .post(`/api/developer/projects/${project.id}/updates`)
      .send({
        type: "general",
        subject: dirtySubject,
        body: dirtyBody,
        mediaUrls: [],
      });
    expect(post.status).toBe(201);
    expect(post.body.subject).toBe(dirtySubject);
    expect(post.body.body).not.toContain("<script>");
    expect(post.body.recipientCount).toBe(1);

    const list = await agent.get(
      `/api/developer/projects/${project.id}/updates`,
    );
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    // Cross-project update history
    const all = await agent.get("/api/developer/updates");
    expect(all.status).toBe(200);
    const ours = all.body.find((u: any) => u.id === post.body.id);
    expect(ours).toBeTruthy();
    expect(ours.propertyName).toBeTruthy();
  });

  it("rejects updates with no subject or body", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);
    const project = await createDraftProject(agent);
    const res = await agent
      .post(`/api/developer/projects/${project.id}/updates`)
      .send({ type: "general", subject: "", body: "" });
    expect(res.status).toBe(400);
  });
});

describe("Admin take-over flow", () => {
  async function getAdminToken(): Promise<string> {
    const { hashPassword } = await import("../server/auth");
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
      // Make sure the password is what we expect (in case of an older run).
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
      throw new Error(
        `Admin login failed (${adminLogin.status}): ${adminLogin.text}`,
      );
    }
    return adminLogin.body.sessionId;
  }

  it("lists developer-managed projects from the admin endpoint", async () => {
    const token = await getAdminToken();
    const adminList = await request(app)
      .get("/api/admin/developer-projects")
      .set("Authorization", `Bearer ${token}`);
    expect(adminList.status).toBe(200);
    expect(Array.isArray(adminList.body)).toBe(true);
  });

  it("clears developerId on take-over and locks out the original developer", async () => {
    const dev = await createTestDeveloper();
    const { agent } = await loginAsDeveloper(app, dev);
    const project = await createDraftProject(agent);

    const token = await getAdminToken();
    const takeOver = await request(app)
      .post(`/api/admin/developer-projects/${project.id}/take-over`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(takeOver.status).toBe(200);
    expect(takeOver.body.developerId).toBeNull();
    expect(takeOver.body.projectStatus).toBe("live");

    // The original developer should no longer see this project as theirs.
    const reAccess = await agent.get(
      `/api/developer/projects/${project.id}`,
    );
    expect(reAccess.status).toBe(403);
  });
});
