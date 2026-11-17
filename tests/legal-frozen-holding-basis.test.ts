import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeHoldingCosts, portfolioLandAmount, summarizeLandPortfolio } from "../shared/holding-costs";
import { holdingValueAtDate } from "../client/src/lib/portfolio-performance";
import type { Property, PropertyValuation } from "../shared/schema";

const databaseRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../server/db", () => ({ get db() { return databaseRef.current; } }));
vi.mock("../server/legal/repository", () => ({
  enqueueLegalApproval: vi.fn(async () => ({ eligible: false, reason: "property_not_in_document_scope" })),
  recordLegalApprovalBlock: vi.fn(async () => {}),
}));

let pg: PGlite;
const migration = await fs.readFile("scripts/ensure-holding-cost-basis.sql", "utf8");
beforeEach(async () => {
  pg = new PGlite();
  databaseRef.current = drizzle(pg);
  await pg.exec(`
    CREATE TABLE users (id integer PRIMARY KEY, kyc_status text);
    CREATE TABLE admin_users (id integer PRIMARY KEY);
    CREATE TABLE properties (
      id integer PRIMARY KEY, currency text, unit_land_cost numeric,
      unit_agent_fees numeric, unit_due_diligence_cost numeric, unit_service_charge numeric,
      reserved_units integer DEFAULT 10, sold_units integer DEFAULT 0,
      total_units integer DEFAULT 100, total_slots integer DEFAULT 0, available_slots integer DEFAULT 100
    );
    CREATE TABLE investment_reservations (
      id serial PRIMARY KEY, property_id integer NOT NULL, user_id integer,
      full_name text DEFAULT 'Test Investor', email text DEFAULT 'test@example.test', phone text DEFAULT 'test',
      units numeric(15,2) NOT NULL DEFAULT 1, amount numeric(20,2) NOT NULL DEFAULT 1000,
      currency text NOT NULL DEFAULT 'NGN', unit_price_snapshot numeric DEFAULT 1000,
      unit_type_label text, status text NOT NULL DEFAULT 'reserved', funnel_stage text,
      last_reminder_sent_at timestamp, payment_method text, payment_reference text,
      payment_evidence_url text, created_by_admin_id integer, notes text, expires_at timestamp,
      kyc_extended_at timestamp, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );
    CREATE TABLE payment_submissions (
      id serial PRIMARY KEY, reservation_id integer, user_id integer DEFAULT 1,
      amount numeric, currency text DEFAULT 'NGN', status text DEFAULT 'pending_admin_review',
      reviewed_at timestamp, reviewed_by_admin_id integer
    );
    INSERT INTO users VALUES (1,'approved');
    INSERT INTO admin_users VALUES (1);
    INSERT INTO properties (id,currency,unit_land_cost,unit_agent_fees,unit_due_diligence_cost,unit_service_charge)
      VALUES (1,'NGN',800,100,50,50);
  `);
  await pg.exec(migration);
});
afterEach(async () => { await pg.close(); });

async function purchase(amount = 1000, status = "reserved", payment = amount) {
  const id = (await pg.query<{ id: number }>(`
    INSERT INTO investment_reservations(property_id,user_id,amount,status)
    VALUES (1,1,${amount},'${status}') RETURNING id
  `)).rows[0].id;
  const submissionId = (await pg.query<{ id: number }>(`
    INSERT INTO payment_submissions(reservation_id,amount) VALUES (${id},${payment}) RETURNING id
  `)).rows[0].id;
  return { id, submissionId };
}

async function readHolding(id: number) {
  const { DatabaseStorage } = await import("../server/storage");
  return new DatabaseStorage().getReservation(id);
}
const attestation = {
  fullPaymentConfirmed: true as const, amountNaira: "1000", currency: "NGN",
  auditNote: "Verified full receipt against the holding",
};

describe("immutable confirmed holding basis (isolated PGlite, no live data)", () => {
  it("freezes full payment independently of legal scope and serves it with reservation API data", async () => {
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const old = await purchase();
    const result = await approvePaymentSubmissionAtomically(old.submissionId, 1);
    expect(result.legal.eligible).toBe(false);
    const confirmed = (await readHolding(old.id))!;
    expect(confirmed.costBasis).toMatchObject({
      landAmount: "800.00", agentFees: "100.00", dueDiligenceFees: "50.00",
      serviceCharges: "50.00", acquisitionAmount: "1000.00", units: "1",
      currency: "NGN", source: "payment_submission", sourceId: old.submissionId, confirmedByAdminId: 1,
    });
    const before = JSON.stringify(confirmed.costBasis);
    const later = new Date(confirmed.createdAt.getTime() + 86_400_000);
    const futureValuation = { valuationDate: later, currentValue: "200000",
      investorBasisValue: "200000" } as PropertyValuation;
    // Main's current-value summary must not use today's property total as a
    // guessed purchase-date valuation when historical entry evidence is absent.
    for (const totalValue of [1000, 1000000]) {
      expect(holdingValueAtDate({ ...confirmed, property: { totalValue } as Property },
        [futureValuation], later.toISOString().slice(0, 10), amount => amount)).toBe(800);
    }
    // Even a fee/land redistribution that keeps the payment total identical
    // must not silently reclassify an older holding.
    await pg.exec("UPDATE properties SET unit_land_cost=700,unit_agent_fees=200 WHERE id=1");
    expect(portfolioLandAmount((await readHolding(old.id))!)).toBe(800);
    const redistributed = await purchase();
    await approvePaymentSubmissionAtomically(redistributed.submissionId, 1);
    expect(portfolioLandAmount((await readHolding(redistributed.id))!)).toBe(700);
    await pg.exec("UPDATE properties SET unit_land_cost=900,unit_agent_fees=150,unit_service_charge=100 WHERE id=1");
    const fresh = await purchase(1200);
    await approvePaymentSubmissionAtomically(fresh.submissionId, 1);
    expect(portfolioLandAmount((await readHolding(fresh.id))!)).toBe(900);
    expect(JSON.stringify((await readHolding(old.id))!.costBasis)).toBe(before);
    expect((await readHolding(old.id))!.amount).toBe("1000.00");
    const { DatabaseStorage } = await import("../server/storage");
    const reservations = await new DatabaseStorage().getReservationsByEmail("test@example.test");
    expect(summarizeLandPortfolio(reservations, amount => amount)).toEqual({
      totalPortfolioValue: 2400, unclassifiedInvestments: 0,
    });
    expect((await new DatabaseStorage().getReservationsByUserId(1))[0].costBasis).not.toBeNull();
    await expect(approvePaymentSubmissionAtomically(old.submissionId, 1)).rejects.toThrow("already");
    expect(JSON.stringify((await readHolding(old.id))!.costBasis)).toBe(before);
  });

  it("never classifies missing historical evidence, partial receipts, or missing fee components", async () => {
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const historical = await purchase(1000, "converted_to_investment");
    const partial = await purchase(1000, "reserved", 500);
    await approvePaymentSubmissionAtomically(partial.submissionId, 1);
    await pg.exec("UPDATE properties SET unit_agent_fees=NULL WHERE id=1");
    const unknownFees = await purchase();
    await approvePaymentSubmissionAtomically(unknownFees.submissionId, 1);
    await pg.exec(migration); // Reapplication is schema-only, never a backfill.
    for (const id of [historical.id, partial.id, unknownFees.id]) {
      const holding = (await readHolding(id))!;
      expect(holding.costBasis).toBeNull();
      expect(portfolioLandAmount({ ...holding, property: {
        currency: "NGN", unitLandCost: 800, unitAgentFees: 100,
        unitDueDiligenceCost: 50, unitServiceCharge: 50,
      } })).toBeNull();
    }
    const { DatabaseStorage } = await import("../server/storage");
    expect(summarizeLandPortfolio(await new DatabaseStorage().getReservationsByEmail("test@example.test"),
      amount => amount)).toEqual({ totalPortfolioValue: 0, unclassifiedInvestments: 3 });
  });

  it("freezes attested manual confirmations and reinstatements but not an unsupported assertion", async () => {
    const { confirmInvestmentAtomically, reinstateInvestmentAtomically } = await import("../server/legal/approval");
    const confirmed = await purchase();
    await confirmInvestmentAtomically(confirmed.id, 1, attestation);
    expect((await readHolding(confirmed.id))!.costBasis?.source).toBe("admin_full_confirmation");
    const reinstated = await purchase(1000, "expired");
    await reinstateInvestmentAtomically(reinstated.id, 1, "receipt", "bank_transfer", "Verified", attestation);
    expect((await readHolding(reinstated.id))!.costBasis?.source).toBe("admin_reinstate");
    const noEvidence = await purchase();
    await confirmInvestmentAtomically(noEvidence.id, 1);
    expect((await readHolding(noEvidence.id))!.costBasis).toBeNull();
    const mismatch = await purchase();
    await confirmInvestmentAtomically(mismatch.id, 1, { ...attestation, amountNaira: "999" });
    expect((await readHolding(mismatch.id))!.costBasis).toBeNull();
  });

  it("protects the frozen record and payment amount at the database and storage boundaries", async () => {
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const holding = await purchase();
    await approvePaymentSubmissionAtomically(holding.submissionId, 1);
    for (const assignment of ["cost_basis=NULL", "amount=1100", "units=2", "currency='USD'",
      "cost_basis=jsonb_set(cost_basis,'{landAmount}','\"900.00\"')"]) {
      await expect(pg.exec(`UPDATE investment_reservations SET ${assignment} WHERE id=${holding.id}`))
        .rejects.toThrow("immutable");
    }
    const { DatabaseStorage } = await import("../server/storage");
    await expect(new DatabaseStorage().updateReservation(holding.id, { costBasis: null }))
      .rejects.toThrow("immutable");
    const historical = await purchase(1000, "converted_to_investment");
    const basis = (await readHolding(holding.id))!.costBasis!;
    await expect(pg.query("UPDATE investment_reservations SET cost_basis=$1 WHERE id=$2",
      [JSON.stringify(basis), historical.id])).rejects.toThrow("Historical");
    const submission = (await pg.query<{ amount: string; status: string }>(
      `SELECT amount::text,status FROM payment_submissions WHERE id=${holding.submissionId}`)).rows[0];
    expect(submission).toEqual({ amount: "1000", status: "approved" });
  });

  it("rolls classification back with payment confirmation if the transaction fails", async () => {
    const { enqueueLegalApproval } = await import("../server/legal/repository");
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    vi.mocked(enqueueLegalApproval).mockRejectedValueOnce(new Error("Isolated transaction failure"));
    const holding = await purchase();
    await expect(approvePaymentSubmissionAtomically(holding.submissionId, 1))
      .rejects.toThrow("Isolated transaction failure");
    expect((await readHolding(holding.id))!).toMatchObject({ status: "reserved", costBasis: null, amount: "1000.00" });
    expect((await pg.query<{ status: string }>(`SELECT status FROM payment_submissions
      WHERE id=${holding.submissionId}`)).rows[0].status).toBe("pending_admin_review");
    expect((await pg.query<{ reserved_units: number; sold_units: number }>(
      "SELECT reserved_units,sold_units FROM properties WHERE id=1")).rows[0])
      .toEqual({ reserved_units: 10, sold_units: 0 });
  });

  it("rejects malformed snapshot evidence rather than falling back to today's property costs", () => {
    const input = { units: 1, amount: 1000, currency: "NGN", property: {
      currency: "NGN", unitLandCost: 800, unitAgentFees: 100,
      unitDueDiligenceCost: 50, unitServiceCharge: 50,
    } };
    const basis = freezeHoldingCosts(input, { confirmedAt: "2026-10-03T00:00:00Z",
      confirmedByAdminId: 1, source: "payment_submission", sourceId: 1 })!;
    for (const changed of [{ landAmount: "900.00" }, { currency: "USD" },
      { units: "2" }, { confirmedAt: "invalid" }, { serviceCharges: "-50.00" }]) {
      expect(portfolioLandAmount({ ...input, costBasis: { ...basis, ...changed } })).toBeNull();
    }
    expect(portfolioLandAmount({ ...input, costBasis: basis, property: undefined })).toBe(800);
  });
});