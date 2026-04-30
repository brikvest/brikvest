/**
 * Demo seed script — creates a sample developer account, two live projects,
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
const INVESTOR_PASSWORD = "DemoInvestor2026!";

interface ProjectSeed {
  name: string;
  location: string;
  city: string;
  district: string;
  description: string;
  imageUrl: string;
  totalUnits: number;
  unitPrice: number;
  developerEquityUnits: string;
  spvName: string;
  investmentDetails: string;
  currentStage: string;
  expectedCompletionDate: string;
  risksDelays: string;
  latestUpdateText: string;
  milestones: { name: string; status: string; percentComplete: number; description: string }[];
  updates: { type: string; subject: string; body: string }[];
  // status is the lifecycle stage of the reservation; weeksAgo is how long ago it was created/confirmed
  investors: { email: string; firstName: string; lastName: string; units: number; weeksAgo: number; status?: "reserved" | "payment_pending" | "converted_to_investment" | "expired" }[];
}

const PROJECTS: ProjectSeed[] = [
  {
    name: "Lekki Heights",
    location: "Lekki Phase 1, Lagos",
    city: "Lagos",
    district: "Lekki Phase 1",
    description: "A premium 80-unit residential tower in Lekki Phase 1, featuring rooftop pool, private gym, smart-home automation, and 24/7 concierge. Designed for Lagos's growing professional class.",
    imageUrl: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200&q=80",
    totalUnits: 80,
    unitPrice: 5_000_000,
    developerEquityUnits: "8",
    spvName: "Lekki Heights SPV Ltd",
    investmentDetails: "Expected ROI of 20-24% over 30 months. Exit via sale of completed units to retail buyers.",
    currentStage: "Structural frame",
    expectedCompletionDate: "2027-09-30",
    risksDelays: "No active risks. Weather has been favourable through Q1. Steel pricing is being monitored monthly.",
    latestUpdateText: "Floors 1–7 framed; floors 8–10 in progress. On schedule for Q3 2027 handover.",
    milestones: [
      { name: "Land acquisition",       status: "done",        percentComplete: 100, description: "Title transferred and verified by SCUML." },
      { name: "Architectural design",   status: "done",        percentComplete: 100, description: "Approved by Lagos State physical planning." },
      { name: "Foundation works",       status: "done",        percentComplete: 100, description: "Reinforced concrete foundation poured and cured." },
      { name: "Structural frame",       status: "in_progress", percentComplete: 70,  description: "Floors 1-7 complete; floors 8-10 in progress." },
      { name: "Roofing & facade",       status: "not_started", percentComplete: 0,   description: "Pending structural completion." },
      { name: "Handover & sales close", status: "not_started", percentComplete: 0,   description: "Targeted Q3 2027." },
    ],
    updates: [
      {
        type: "general",
        subject: "Welcome to Lekki Heights — groundbreaking ceremony",
        body: "<p>Dear investors,</p><p>We're thrilled to officially break ground on Lekki Heights. Construction is on schedule and we anticipate strong returns over the next 30 months. Stay tuned for monthly progress updates with site photos.</p>",
      },
      {
        type: "construction",
        subject: "Foundation works complete — ahead of schedule",
        body: "<p>Excellent news — our reinforced concrete foundation is fully poured and curing one week ahead of schedule. Quality inspections passed without any issues.</p><p>Next milestone: structural frame across all 10 floors.</p>",
      },
      {
        type: "construction",
        subject: "70% structural frame complete",
        body: "<p>Floors 1 through 7 are now complete; framing crews are working on floors 8-10. Weather has been favourable. We remain on track for our handover target in Q3 2027.</p>",
      },
    ],
    investors: [
      // Confirmed investors backdated for the velocity chart
      { email: "demo-lekki-1@brikvest.net",  firstName: "Adaobi",   lastName: "Okeke",     units: 5, weeksAgo: 0, status: "converted_to_investment" },
      { email: "demo-lekki-2@brikvest.net",  firstName: "Tunde",    lastName: "Adekunle",  units: 3, weeksAgo: 1, status: "converted_to_investment" },
      { email: "demo-lekki-3@brikvest.net",  firstName: "Fatima",   lastName: "Ibrahim",   units: 8, weeksAgo: 1, status: "converted_to_investment" },
      { email: "demo-lekki-4@brikvest.net",  firstName: "Chiamaka", lastName: "Eze",       units: 2, weeksAgo: 2, status: "converted_to_investment" },
      { email: "demo-lekki-5@brikvest.net",  firstName: "Olumide",  lastName: "Bakare",    units: 4, weeksAgo: 2, status: "converted_to_investment" },
      { email: "demo-lekki-6@brikvest.net",  firstName: "Ngozi",    lastName: "Okafor",    units: 6, weeksAgo: 3, status: "converted_to_investment" },
      { email: "demo-lekki-7@brikvest.net",  firstName: "Sani",     lastName: "Mohammed",  units: 3, weeksAgo: 3, status: "converted_to_investment" },
      // Mid-funnel: payment submitted, awaiting admin confirmation
      { email: "demo-lekki-8@brikvest.net",  firstName: "Amaka",    lastName: "Onuoha",    units: 2, weeksAgo: 0, status: "payment_pending" },
      // Open reservations sitting in the funnel
      { email: "demo-lekki-9@brikvest.net",  firstName: "Bolaji",   lastName: "Ade-Lawal", units: 1, weeksAgo: 0, status: "reserved" },
      { email: "demo-lekki-10@brikvest.net", firstName: "Hassan",   lastName: "Garba",     units: 4, weeksAgo: 1, status: "reserved" },
      // Expired (didn't convert)
      { email: "demo-lekki-11@brikvest.net", firstName: "Folake",   lastName: "Ojo",       units: 1, weeksAgo: 4, status: "expired" },
    ],
  },
  {
    name: "Maitama Garden Villas",
    location: "Maitama Extension, Abuja",
    city: "Abuja",
    district: "Maitama",
    description: "An exclusive 24-villa estate in Abuja's premier Maitama district. Each 5-bedroom villa features solar power, 24/7 security, swimming pool, landscaped gardens, and underground parking. Designed by award-winning Nigerian architects.",
    imageUrl: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80",
    totalUnits: 100,
    unitPrice: 8_000_000,
    developerEquityUnits: "10",
    spvName: "Maitama Garden Villas SPV Ltd",
    investmentDetails: "Expected ROI of 18-22% over 24 months. Exit via sale of completed villas to high-net-worth buyers.",
    currentStage: "Structural frame",
    expectedCompletionDate: "2026-12-15",
    risksDelays: "Slight schedule pressure on villas 17–24 due to imported finishes lead time. Mitigation plan in place; remains within contingency.",
    latestUpdateText: "13 of 24 villas now have walls and slabs complete. Tracking on budget at 55% structural completion.",
    milestones: [
      { name: "Land acquisition",       status: "done",        percentComplete: 100, description: "10-acre plot acquired with C of O." },
      { name: "Site clearance",         status: "done",        percentComplete: 100, description: "Site cleared, surveyed and graded." },
      { name: "Foundation works",       status: "done",        percentComplete: 100, description: "Foundations poured for all 24 villas." },
      { name: "Structural frame",       status: "in_progress", percentComplete: 55,  description: "Walls and slabs complete on 13 of 24 villas." },
      { name: "Finishes & landscaping", status: "not_started", percentComplete: 0,   description: "Awaiting structural completion." },
      { name: "Final handover",         status: "not_started", percentComplete: 0,   description: "Targeted Q4 2026." },
    ],
    updates: [
      {
        type: "general",
        subject: "Maitama Garden Villas — kickoff & investor briefing",
        body: "<p>Dear investors,</p><p>Welcome to Maitama Garden Villas. We've completed the SPV formation and the project is officially underway. Expect monthly construction reports and quarterly financial briefings.</p>",
      },
      {
        type: "construction",
        subject: "All 24 foundations poured",
        body: "<p>Major milestone reached: foundations for all 24 villas have been poured and inspected. The site is now fully prepared for vertical construction. Photos are attached to the construction tab.</p>",
      },
      {
        type: "financial",
        subject: "55% construction milestone — on budget",
        body: "<p>We're pleased to report the project is at 55% structural completion, on schedule and within budget. Cash position remains healthy and we anticipate no draw-down adjustments this quarter.</p>",
      },
    ],
    investors: [
      // Confirmed
      { email: "demo-maitama-1@brikvest.net",  firstName: "Ifeoma",  lastName: "Nwankwo",   units: 4, weeksAgo: 0, status: "converted_to_investment" },
      { email: "demo-maitama-2@brikvest.net",  firstName: "Yusuf",   lastName: "Abubakar",  units: 6, weeksAgo: 0, status: "converted_to_investment" },
      { email: "demo-maitama-3@brikvest.net",  firstName: "Halima",  lastName: "Bello",     units: 3, weeksAgo: 1, status: "converted_to_investment" },
      { email: "demo-maitama-4@brikvest.net",  firstName: "Emeka",   lastName: "Okonkwo",   units: 5, weeksAgo: 2, status: "converted_to_investment" },
      { email: "demo-maitama-5@brikvest.net",  firstName: "Bisi",    lastName: "Williams",  units: 2, weeksAgo: 2, status: "converted_to_investment" },
      { email: "demo-maitama-6@brikvest.net",  firstName: "Kunle",   lastName: "Ogundimu",  units: 7, weeksAgo: 3, status: "converted_to_investment" },
      // Mid-funnel
      { email: "demo-maitama-7@brikvest.net",  firstName: "Zainab",  lastName: "Suleiman",  units: 3, weeksAgo: 0, status: "payment_pending" },
      { email: "demo-maitama-8@brikvest.net",  firstName: "Chinedu", lastName: "Anya",      units: 2, weeksAgo: 1, status: "payment_pending" },
      // Open reservations
      { email: "demo-maitama-9@brikvest.net",  firstName: "Aisha",   lastName: "Lawal",     units: 1, weeksAgo: 0, status: "reserved" },
      { email: "demo-maitama-10@brikvest.net", firstName: "Tobi",    lastName: "Adeyemi",   units: 2, weeksAgo: 1, status: "reserved" },
    ],
  },
];

async function ensureDeveloper() {
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
      companyName: "Brikvest Demo Properties Ltd",
      companyRegistration: "RC9876543",
      websiteUrl: "https://demo.brikvest.net",
    } as any);
    console.log(`[SEED] Created developer ${developer.email} (id=${developer.id})`);
  } else {
    console.log(`[SEED] Reusing developer ${developer.email} (id=${developer.id})`);
  }
  return developer;
}

async function ensureProject(developerId: number, seed: ProjectSeed) {
  const existing = await storage.getPropertiesByDeveloper(developerId);
  let project = existing.find((p) => p.name === seed.name || p.name === `${seed.name} — Demo Project`);
  if (!project) {
    const totalValue = seed.totalUnits * seed.unitPrice;
    project = await storage.createProperty({
      name: seed.name,
      location: seed.location,
      description: seed.description,
      totalValue,
      minInvestment: seed.unitPrice,
      availableSlots: seed.totalUnits,
      totalSlots: seed.totalUnits,
      fundingProgress: 0,
      imageUrl: seed.imageUrl,
      status: "active",
      propertyType: "residential",
      currency: "NGN",
      totalUnits: seed.totalUnits,
      reservedUnits: 0,
      soldUnits: 0,
      unitPrice: seed.unitPrice,
      unitPrecision: "1.00",
      isTransferable: true,
      spvName: seed.spvName,
      city: seed.city,
      district: seed.district,
      developerNotes: "Demo project — seeded automatically.",
      investmentDetails: seed.investmentDetails,
      developerId,
      developerEquityUnits: seed.developerEquityUnits,
      projectStatus: "live",
      currentStage: seed.currentStage,
      expectedCompletionDate: new Date(seed.expectedCompletionDate),
      risksDelays: seed.risksDelays,
      latestUpdateText: seed.latestUpdateText,
    } as any);
    console.log(`[SEED]   Created project '${project.name}' (id=${project.id})`);
  } else {
    // Update existing project with the new construction fields and rename if needed
    project = await storage.updateProperty(project.id, {
      ...project,
      name: seed.name,
      currentStage: seed.currentStage,
      expectedCompletionDate: new Date(seed.expectedCompletionDate),
      risksDelays: seed.risksDelays,
      latestUpdateText: seed.latestUpdateText,
    } as any);
    console.log(`[SEED]   Reusing project '${project.name}' (id=${project.id})`);
  }
  return project;
}

async function ensureMilestones(propertyId: number, seeds: ProjectSeed["milestones"]) {
  const existing = await storage.getMilestonesByProperty(propertyId);
  if (existing.length > 0) {
    console.log(`[SEED]   Skipped milestones (${existing.length} already exist)`);
    return;
  }
  for (let i = 0; i < seeds.length; i++) {
    const m = seeds[i];
    await storage.createProjectMilestone({
      propertyId,
      name: m.name,
      description: m.description,
      targetDate: new Date(Date.now() + (i + 1) * 90 * 24 * 60 * 60 * 1000),
      completedDate: m.status === "done" ? new Date(Date.now() - (seeds.length - i) * 30 * 24 * 60 * 60 * 1000) : null,
      status: m.status,
      percentComplete: m.percentComplete,
      mediaUrls: [],
      notes: null,
      sortOrder: i,
    } as any);
  }
  console.log(`[SEED]   Created ${seeds.length} milestones`);
}

async function ensureInvestors(propertyId: number, unitPrice: number, seeds: ProjectSeed["investors"]) {
  let created = 0;
  const counts = { reserved: 0, payment_pending: 0, converted_to_investment: 0, expired: 0 };
  for (let i = 0; i < seeds.length; i++) {
    const inv = seeds[i];
    const status = inv.status ?? "converted_to_investment";
    let user = await storage.getUserByEmail(inv.email);
    if (!user) {
      const hashed = await hashPassword(INVESTOR_PASSWORD);
      user = await storage.createUser({
        email: inv.email,
        password: hashed,
        firstName: inv.firstName,
        lastName: inv.lastName,
        phone: `+23480${String(10000000 + i).padStart(8, "0")}`,
        role: "user",
        accountStatus: "approved",
        emailVerified: true,
        kycStatus: "approved",
        country: "NG",
      } as any);
    }

    const existing = await db
      .select()
      .from(investmentReservations)
      .where(
        and(
          eq(investmentReservations.propertyId, propertyId),
          eq(investmentReservations.email, inv.email),
        ),
      );

    if (existing.length === 0) {
      const amount = inv.units * unitPrice;
      const reservation = await storage.createInvestmentReservation({
        propertyId,
        userId: user.id,
        fullName: `${inv.firstName} ${inv.lastName}`,
        email: inv.email,
        phone: user.phone || "+2348010000000",
        units: String(inv.units),
        unitPriceSnapshot: String(unitPrice),
        amount: String(amount),
        currency: "NGN",
        status,
      } as any);

      // Backdate timestamps so velocity charts and "stuck" detection show meaningful data.
      const t = new Date(Date.now() - inv.weeksAgo * 7 * 24 * 60 * 60 * 1000);
      await db
        .update(investmentReservations)
        .set({ updatedAt: t, createdAt: t })
        .where(eq(investmentReservations.id, reservation.id));
      counts[status as keyof typeof counts]++;
      created++;
    }
  }
  console.log(`[SEED]   Investors → confirmed:${counts.converted_to_investment}  payment-pending:${counts.payment_pending}  reserved:${counts.reserved}  expired:${counts.expired}  (${created} created, ${seeds.length - created} reused)`);
}

async function ensureUpdates(propertyId: number, developerId: number, recipientCount: number, seeds: ProjectSeed["updates"]) {
  const existing = await storage.getProjectUpdatesByProperty(propertyId);
  if (existing.length > 0) {
    console.log(`[SEED]   Skipped updates (${existing.length} already exist)`);
    return;
  }
  for (const u of seeds) {
    await storage.createProjectUpdate(
      {
        propertyId,
        authorUserId: developerId,
        type: u.type,
        subject: u.subject,
        body: u.body,
        mediaUrls: [],
      } as any,
      recipientCount,
    );
  }
  console.log(`[SEED]   Created ${seeds.length} project updates`);
}

async function main() {
  console.log("[SEED] Starting demo developer seed…\n");

  const developer = await ensureDeveloper();

  for (const projectSeed of PROJECTS) {
    console.log(`\n[SEED] Processing project: ${projectSeed.name}`);
    const project = await ensureProject(developer.id, projectSeed);
    await ensureMilestones(project.id, projectSeed.milestones);
    await ensureInvestors(project.id, projectSeed.unitPrice, projectSeed.investors);
    await ensureUpdates(project.id, developer.id, projectSeed.investors.length, projectSeed.updates);
  }

  console.log("\n[SEED] ✅ Demo developer seed complete!\n");
  console.log("─────────────────────────────────────────────────────");
  console.log("  Developer login:");
  console.log(`    Email:    ${DEMO_DEV_EMAIL}`);
  console.log(`    Password: ${DEMO_DEV_PASSWORD}`);
  console.log("    URL:      /developer/login");
  console.log("─────────────────────────────────────────────────────");
  console.log(`  Demo investors (password: ${INVESTOR_PASSWORD}):`);
  for (const p of PROJECTS) {
    console.log(`  • ${p.name}:`);
    for (const inv of p.investors) {
      const label = (inv.status ?? "converted_to_investment").replace(/_/g, " ");
      console.log(`      ${inv.email}  (${inv.units} units, ${label} ${inv.weeksAgo}w ago)`);
    }
  }
  console.log("─────────────────────────────────────────────────────\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("[SEED] Failed:", err);
  process.exit(1);
});
