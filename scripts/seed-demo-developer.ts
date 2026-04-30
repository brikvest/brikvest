/**
 * Demo seed script — creates a sample developer account, a live project,
 * milestones, sample investors, and a few project updates.
 *
 * Run with:  npx tsx scripts/seed-demo-developer.ts
 *
 * Idempotent: safe to run multiple times. Re-uses existing demo records.
 */
import { db } from "../server/db";
import { storage } from "../server/storage";
import { hashPassword } from "../server/auth";
import {
  users, properties, investmentReservations,
  projectMilestones, projectUpdates,
} from "../shared/schema";
import { eq, and } from "drizzle-orm";

const DEMO_DEV_EMAIL = "developer.demo@brikvest.net";
const DEMO_DEV_PASSWORD = "DemoDeveloper2026!";
const DEMO_PROJECT_NAME = "Sunrise Heights — Demo Project";

const DEMO_INVESTORS = [
  { email: "demo-investor1@brikvest.net",  firstName: "Adaobi",   lastName: "Okeke",      units: 5 },
  { email: "demo-investor2@brikvest.net",  firstName: "Tunde",    lastName: "Adekunle",   units: 3 },
  { email: "demo-investor3@brikvest.net",  firstName: "Fatima",   lastName: "Ibrahim",    units: 8 },
  { email: "demo-investor4@brikvest.net",  firstName: "Chiamaka", lastName: "Eze",        units: 2 },
];

async function main() {
  console.log("[SEED] Starting demo developer seed…");

  // 1. Developer account
  let developer = await storage.getUserByEmail(DEMO_DEV_EMAIL);
  if (!developer) {
    const hashed = await hashPassword(DEMO_DEV_PASSWORD);
    developer = await storage.createUser({
      email: DEMO_DEV_EMAIL,
      password: hashed,
      firstName: "Demo",
      lastName: "Developer",
      phone: "+2348012345678",
      role: "developer",
      accountStatus: "approved",
      emailVerified: true,
      companyName: "Sunrise Properties Ltd",
      companyRegistration: "RC9876543",
      websiteUrl: "https://sunrise-demo.brikvest.net",
    } as any);
    console.log(`[SEED] Created developer ${developer.email} (id=${developer.id})`);
  } else {
    console.log(`[SEED] Reusing developer ${developer.email} (id=${developer.id})`);
  }

  // 2. Project
  const existingProjects = await storage.getPropertiesByDeveloper(developer.id);
  let project = existingProjects.find((p) => p.name === DEMO_PROJECT_NAME);
  if (!project) {
    project = await storage.createProperty({
      name: DEMO_PROJECT_NAME,
      location: "Maitama Extension, Abuja",
      description: "A modern 24-unit residential development in the heart of Abuja's premier district. Features include solar power, 24/7 security, swimming pool, and underground parking. Designed by award-winning Nigerian architects.",
      totalValue: 600_000_000,
      minInvestment: 5_000_000,
      availableSlots: 100,
      totalSlots: 100,
      fundingProgress: 0,
      imageUrl: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200&q=80",
      status: "active",
      propertyType: "residential",
      currency: "NGN",
      totalUnits: 100,
      reservedUnits: 0,
      soldUnits: 0,
      unitPrice: 5_000_000,
      unitPrecision: "1.00",
      isTransferable: true,
      spvName: "Sunrise Heights SPV Ltd",
      city: "Abuja",
      district: "Maitama",
      developerNotes: "Demo project — seeded automatically.",
      investmentDetails: "Expected ROI of 18-22% over 24 months. Exit via sale of completed units.",
      developerId: developer.id,
      developerEquityUnits: "10",
      projectStatus: "live",
    } as any);
    console.log(`[SEED] Created project '${project.name}' (id=${project.id})`);
  } else {
    console.log(`[SEED] Reusing project '${project.name}' (id=${project.id})`);
  }

  // 3. Milestones
  const existingMilestones = await storage.getMilestonesByProperty(project.id);
  if (existingMilestones.length === 0) {
    const milestoneSeeds = [
      { name: "Land acquisition",  status: "done",        percentComplete: 100, description: "Title transferred and verified." },
      { name: "Foundation works",  status: "done",        percentComplete: 100, description: "Reinforced concrete foundation poured." },
      { name: "Structural frame",  status: "in_progress", percentComplete: 65,  description: "Floors 1-3 complete; floor 4 in progress." },
      { name: "Roofing & finishes", status: "not_started", percentComplete: 0,   description: "Pending structural completion." },
      { name: "Handover",          status: "not_started", percentComplete: 0,   description: "Targeted Q4 2026." },
    ];
    for (let i = 0; i < milestoneSeeds.length; i++) {
      const m = milestoneSeeds[i];
      await storage.createProjectMilestone({
        propertyId: project.id,
        name: m.name,
        description: m.description,
        targetDate: new Date(Date.now() + (i + 1) * 90 * 24 * 60 * 60 * 1000),
        completedDate: m.status === "done" ? new Date(Date.now() - (5 - i) * 30 * 24 * 60 * 60 * 1000) : null,
        status: m.status,
        percentComplete: m.percentComplete,
        mediaUrls: [],
        notes: null,
        sortOrder: i,
      } as any);
    }
    console.log(`[SEED] Created ${milestoneSeeds.length} milestones`);
  } else {
    console.log(`[SEED] Skipped milestones (${existingMilestones.length} already exist)`);
  }

  // 4. Demo investors + confirmed reservations
  for (const inv of DEMO_INVESTORS) {
    let user = await storage.getUserByEmail(inv.email);
    if (!user) {
      const hashed = await hashPassword("DemoInvestor2026!");
      user = await storage.createUser({
        email: inv.email,
        password: hashed,
        firstName: inv.firstName,
        lastName: inv.lastName,
        phone: "+234801000000" + DEMO_INVESTORS.indexOf(inv),
        role: "user",
        accountStatus: "approved",
        emailVerified: true,
        kycStatus: "approved",
        country: "NG",
      } as any);
    }
    // Check existing reservation
    const existing = await db.select().from(investmentReservations)
      .where(and(
        eq(investmentReservations.propertyId, project.id),
        eq(investmentReservations.email, inv.email),
      ));
    if (existing.length === 0) {
      const amount = inv.units * 5_000_000;
      await storage.createInvestmentReservation({
        propertyId: project.id,
        userId: user.id,
        fullName: `${inv.firstName} ${inv.lastName}`,
        email: inv.email,
        phone: "+2348010000000",
        units: String(inv.units),
        unitPriceSnapshot: "5000000",
        amount: String(amount),
        currency: "NGN",
        status: "converted_to_investment",
        confirmedAt: new Date(),
        confirmedBy: developer.id,
      } as any);
      console.log(`[SEED] Created confirmed investment for ${inv.email} (${inv.units} units)`);
    } else {
      console.log(`[SEED] Skipped existing reservation for ${inv.email}`);
    }
  }

  // 5. Sample project updates
  const existingUpdates = await storage.getProjectUpdatesByProperty(project.id);
  if (existingUpdates.length === 0) {
    const updateSeeds = [
      {
        type: "general",
        subject: "Welcome to Sunrise Heights — Phase 1 underway",
        body: "<p>Dear investors,</p><p>We're excited to officially break ground on Sunrise Heights. Construction has started on schedule and we anticipate strong returns over the next 24 months.</p><p>Stay tuned for monthly progress updates.</p>",
      },
      {
        type: "construction",
        subject: "Foundation works complete",
        body: "<p>Excellent news — our reinforced concrete foundation is fully poured and curing. Quality inspections passed without issues.</p><p>Next up: structural frame.</p>",
      },
      {
        type: "construction",
        subject: "65% structural frame complete",
        body: "<p>Floors 1 through 3 are complete; floor 4 is currently being framed. We remain on track for our handover target in Q4 2026.</p>",
      },
    ];
    for (const u of updateSeeds) {
      await storage.createProjectUpdate({
        propertyId: project.id,
        authorUserId: developer.id,
        type: u.type,
        subject: u.subject,
        body: u.body,
        mediaUrls: [],
      } as any, DEMO_INVESTORS.length);
    }
    console.log(`[SEED] Created ${updateSeeds.length} sample project updates`);
  } else {
    console.log(`[SEED] Skipped project updates (${existingUpdates.length} already exist)`);
  }

  console.log("\n[SEED] ✅ Demo developer seed complete!\n");
  console.log("─────────────────────────────────────────────────────");
  console.log("  Developer login:");
  console.log(`    Email:    ${DEMO_DEV_EMAIL}`);
  console.log(`    Password: ${DEMO_DEV_PASSWORD}`);
  console.log("    URL:      /developer/login");
  console.log("─────────────────────────────────────────────────────");
  console.log("  Demo investors (password: DemoInvestor2026!):");
  for (const inv of DEMO_INVESTORS) console.log(`    ${inv.email}  (${inv.units} units)`);
  console.log("─────────────────────────────────────────────────────\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("[SEED] Failed:", err);
  process.exit(1);
});
