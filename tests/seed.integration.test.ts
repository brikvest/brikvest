import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { storage } from "../server/storage";

const SEED_SCRIPT = path.resolve(
  process.cwd(),
  "scripts",
  "seed-demo-developer.ts",
);
const DEMO_DEV_EMAIL = "developer.demo@brikvest.net";
const PROJECT_NAMES = [
  "Lekki Heights — Off-Plan",
  "Maitama Garden Villas — Completed",
];

function runSeed() {
  // Run the seed in a child process so its `process.exit` doesn't kill vitest.
  const result = spawnSync("npx", ["tsx", SEED_SCRIPT], {
    stdio: "pipe",
    encoding: "utf-8",
    env: process.env,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `Seed script exited with status ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return result;
}

/**
 * Wipe both seed-managed projects (and all their child rows) so the seed runs
 * against a deterministic state.  Leaves the demo developer + investors alone
 * because the seed already upserts those.
 */
async function clearSeedProjects() {
  const dev = await storage.getUserByEmail(DEMO_DEV_EMAIL);
  if (!dev) return;
  const projs = await storage.getPropertiesByDeveloper(dev.id);
  const targets = projs.filter((p) => PROJECT_NAMES.includes(p.name));
  if (targets.length === 0) return;
  const propIds = targets.map((p) => p.id);

  // Delete every row in every child table that references either the demo
  // properties or their reservations.  The list below mirrors every FK to
  // `properties` / `investment_reservations` in `shared/schema.ts`.  When a
  // new table starts referencing one of those, add the matching DELETE
  // here — or, better, drop this helper entirely once the seed script is
  // taught to self-clean (tracked as a follow-up).
  const idList = propIds.join(",");
  await db.execute(sql.raw(`
    WITH res AS (
      SELECT id FROM investment_reservations WHERE property_id IN (${idList})
    )
    DELETE FROM payment_submissions WHERE reservation_id IN (SELECT id FROM res);
  `));
  await db.execute(sql.raw(`
    WITH res AS (
      SELECT id FROM investment_reservations WHERE property_id IN (${idList})
    )
    DELETE FROM investment_payments WHERE reservation_id IN (SELECT id FROM res);
  `));
  await db.execute(sql.raw(`
    WITH res AS (
      SELECT id FROM investment_reservations WHERE property_id IN (${idList})
    )
    DELETE FROM ownership_certificates WHERE reservation_id IN (SELECT id FROM res);
  `));
  await db.execute(sql.raw(`
    WITH res AS (
      SELECT id FROM investment_reservations WHERE property_id IN (${idList})
    )
    DELETE FROM resale_listings WHERE reservation_id IN (SELECT id FROM res);
  `));
  await db.execute(sql.raw(`
    DELETE FROM investment_reservations WHERE property_id IN (${idList});
  `));
  await db.execute(sql.raw(`
    DELETE FROM project_milestones WHERE property_id IN (${idList});
  `));
  await db.execute(sql.raw(`
    DELETE FROM project_updates WHERE property_id IN (${idList});
  `));
  await db.execute(sql.raw(`
    DELETE FROM developer_investor_notes WHERE property_id IN (${idList});
  `));
  await db.execute(sql.raw(`
    DELETE FROM investment_groups WHERE property_id IN (${idList});
  `));
  await db.execute(sql.raw(`
    DELETE FROM property_verification_checklists WHERE property_id IN (${idList});
  `));
  await db.execute(sql.raw(`
    DELETE FROM verification_step_completions WHERE property_id IN (${idList});
  `));
  await db.execute(sql.raw(`
    DELETE FROM property_valuations WHERE property_id IN (${idList});
  `));
  await db.execute(sql.raw(`
    DELETE FROM resale_audit_logs WHERE property_id IN (${idList});
  `));
  await db.execute(sql.raw(`
    DELETE FROM properties WHERE id IN (${idList});
  `));
}

describe("Demo developer seed (scripts/seed-demo-developer.ts)", () => {
  beforeAll(async () => {
    await clearSeedProjects();
    runSeed();
  }, 120_000);

  it("creates the demo developer with role=developer and approved status", async () => {
    const dev = await storage.getUserByEmail(DEMO_DEV_EMAIL);
    expect(dev, "demo developer should exist after seed").toBeTruthy();
    expect(dev!.role).toBe("developer");
    expect(dev!.accountStatus).toBe("approved");
    expect(dev!.companyName, "companyName should be populated").toBeTruthy();
  });

  it("creates both demo projects with the right configuration", async () => {
    const dev = await storage.getUserByEmail(DEMO_DEV_EMAIL);
    const projects = await storage.getPropertiesByDeveloper(dev!.id);
    const lekki = projects.find((p) => p.name === PROJECT_NAMES[0]);
    const maitama = projects.find((p) => p.name === PROJECT_NAMES[1]);
    expect(lekki, "Lekki Heights project should exist").toBeTruthy();
    expect(maitama, "Maitama Garden Villas project should exist").toBeTruthy();
    expect(lekki!.salesStage).toBe("off_plan");
    expect(maitama!.salesStage).toBe("completed");
    expect(lekki!.projectStatus).toBe("live");
    expect(maitama!.projectStatus).toBe("live");
    expect(Number(lekki!.totalUnits)).toBe(80);
    expect(Number(maitama!.totalUnits)).toBe(100);
  });

  it("creates 6 milestones for each demo project (in sortOrder)", async () => {
    const dev = await storage.getUserByEmail(DEMO_DEV_EMAIL);
    const projects = await storage.getPropertiesByDeveloper(dev!.id);
    for (const projectName of PROJECT_NAMES) {
      const project = projects.find((p) => p.name === projectName)!;
      const milestones = await storage.getMilestonesByProperty(project.id);
      expect(milestones.length, `${projectName} milestone count`).toBe(6);
      const sortOrders = milestones.map((m) => m.sortOrder).sort((a, b) => a - b);
      expect(sortOrders).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it("creates the expected investor reservations and totals", async () => {
    const dev = await storage.getUserByEmail(DEMO_DEV_EMAIL);
    const projects = await storage.getPropertiesByDeveloper(dev!.id);

    const lekki = projects.find((p) => p.name === PROJECT_NAMES[0])!;
    const maitama = projects.find((p) => p.name === PROJECT_NAMES[1])!;

    const lekkiRes = await storage.getReservationsByProperty(lekki.id);
    const maitamaRes = await storage.getReservationsByProperty(maitama.id);

    // 7 confirmed + 1 submitted-payment + 2 reserved + 1 expired = 11
    expect(lekkiRes.length, "Lekki reservation count").toBe(11);
    // 6 confirmed + 2 submitted-payment + 2 reserved = 10
    expect(maitamaRes.length, "Maitama reservation count").toBe(10);

    const lekkiConfirmed = lekkiRes.filter(
      (r) => r.status === "converted_to_investment",
    );
    const maitamaConfirmed = maitamaRes.filter(
      (r) => r.status === "converted_to_investment",
    );
    expect(lekkiConfirmed.length, "Lekki confirmed").toBe(7);
    expect(maitamaConfirmed.length, "Maitama confirmed").toBe(6);

    // ~62% funded = 50 / 80
    const lekkiUnits = lekkiConfirmed.reduce(
      (s, r) => s + Number(r.units || 0),
      0,
    );
    expect(lekkiUnits).toBe(50);
    // ~91% funded = 91 / 100
    const maitamaUnits = maitamaConfirmed.reduce(
      (s, r) => s + Number(r.units || 0),
      0,
    );
    expect(maitamaUnits).toBe(91);
  });

  it("creates 3 project updates for each demo project", async () => {
    const dev = await storage.getUserByEmail(DEMO_DEV_EMAIL);
    const projects = await storage.getPropertiesByDeveloper(dev!.id);
    for (const projectName of PROJECT_NAMES) {
      const project = projects.find((p) => p.name === projectName)!;
      const updates = await storage.getProjectUpdatesByProperty(project.id);
      expect(updates.length, `${projectName} update count`).toBe(3);
    }
  });

  it("seeds payment submission records (approved + pending) for the funnel", async () => {
    const dev = await storage.getUserByEmail(DEMO_DEV_EMAIL);
    const projects = await storage.getPropertiesByDeveloper(dev!.id);

    let approvedTotal = 0;
    let pendingTotal = 0;
    for (const projectName of PROJECT_NAMES) {
      const project = projects.find((p) => p.name === projectName)!;
      const reservations = await storage.getReservationsByProperty(project.id);
      for (const r of reservations) {
        const subs = await storage.getPaymentSubmissionsByReservationId(r.id);
        approvedTotal += subs.filter((s: any) => s.status === "approved").length;
        pendingTotal += subs.filter(
          (s: any) => s.status === "pending_admin_review",
        ).length;
      }
    }
    // 7 + 6 = 13 confirmed investors → 13 approved submissions
    expect(approvedTotal).toBe(13);
    // 1 (Lekki) + 2 (Maitama) = 3 pending payment submissions
    expect(pendingTotal).toBe(3);
  });

  it("is idempotent: re-running the seed does not duplicate seed records", async () => {
    async function snapshot() {
      const dev = await storage.getUserByEmail(DEMO_DEV_EMAIL);
      const projects = (
        await storage.getPropertiesByDeveloper(dev!.id)
      ).filter((p) => PROJECT_NAMES.includes(p.name));
      let reservations = 0,
        milestones = 0,
        updates = 0;
      for (const p of projects) {
        reservations += (await storage.getReservationsByProperty(p.id)).length;
        milestones += (await storage.getMilestonesByProperty(p.id)).length;
        updates += (await storage.getProjectUpdatesByProperty(p.id)).length;
      }
      return { projects: projects.length, reservations, milestones, updates };
    }

    const before = await snapshot();
    runSeed();
    const after = await snapshot();

    expect(after).toEqual(before);
    // Sanity: the seed should leave both projects + their full data set in place.
    expect(after.projects).toBe(2);
    expect(after.milestones).toBe(12);
    expect(after.updates).toBe(6);
    expect(after.reservations).toBe(21);
  }, 120_000);
});
