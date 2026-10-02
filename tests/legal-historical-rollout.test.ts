import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";

const reference = vi.hoisted(() => ({ current: null as any }));
vi.mock("../server/db", () => ({ get db() { return reference.current; } }));
vi.mock("../server/emailService", () => ({ sendEmail: vi.fn(() => { throw new Error("No live mail allowed"); }) }));
vi.mock("../server/legal/files", () => ({
  storeLegalTemplateVersion: vi.fn(() => { throw new Error("No storage writes during preparation"); }),
  readLegalTemplateVersion: vi.fn(() => { throw new Error("No storage reads during preparation"); }),
  streamAuthorizedLegalDocument: vi.fn(),
}));
vi.mock("../server/legal/worker", () => ({ dispatchLegalJobs: vi.fn() }));
vi.mock("../server/legal/local-signing", () => ({ beginLocalSigning: vi.fn(), completeLocalSigning: vi.fn() }));

import { prepareHistoricalHoldings, searchHistoricalHoldings } from "../server/legal/historical-rollout";
import { requestLegalNotificationResend, beginLegalNotificationAttempt, enqueueLegalApproval } from "../server/legal/repository";
import { registerLegalRoutes } from "../server/legal/routes";

let pg: PGlite;
let database: ReturnType<typeof drizzle>;
const migrations = ["documents", "local-signing", "notification-cycles", "property-templates", "template-deletion", "historical-rollout"];
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE admin_users(id serial PRIMARY KEY);
    CREATE TABLE users(id serial PRIMARY KEY, email text, first_name text,last_name text,
      kyc_status text,kyc_full_name text,kyc_address text);
    CREATE TABLE properties(id serial PRIMARY KEY,name text,location text,reserved_units int,sold_units int);
    CREATE TABLE investment_reservations(id serial PRIMARY KEY,user_id int,property_id int,full_name text,
      status text,funnel_stage text,units numeric(15,2),amount numeric(20,2),currency text,unit_price_snapshot numeric(15,2));
    CREATE TABLE payment_submissions(id serial PRIMARY KEY,reservation_id int,user_id int,amount numeric(20,2),
      currency text,status text,reviewed_at timestamptz,reviewed_by_admin_id int);
    INSERT INTO admin_users VALUES(1),(2);
    INSERT INTO users VALUES (1,'ada@example.test','Ada','Investor','approved','Ada Verified','1 Test Road'),
      (2,'bea@example.test','Bea','Investor','pending','Bea Verified','2 Test Road');
    INSERT INTO properties VALUES (1,'North Estate','Lagos',12,7),(2,'South Estate','Abuja',4,3);`);
  for (const migration of migrations) await pg.exec(await fs.readFile(`scripts/ensure-legal-${migration}.sql`, "utf8"));
  database = drizzle(pg);
  reference.current = database;
  await pg.exec(`INSERT INTO legal_templates(property_id,document_type,version,original_filename,storage_key,sha256,byte_size,validation_status,is_active,created_by_admin_id)
    VALUES (1,'deed_of_assignment',1,'deed.docx','legal/templates/deed_of_assignment/v1',repeat('a',64),10,'valid',true,1),
      (1,'transfer_exit_rights',1,'transfer.docx','legal/templates/transfer_exit_rights/v1',repeat('b',64),10,'valid',true,1);`);
});
afterAll(() => pg.close());
beforeEach(async () => {
  // Immutable legal evidence is never reused or erased between cases.
  await pg.exec(`INSERT INTO investment_reservations(user_id,property_id,full_name,status,funnel_stage,units,amount,currency,unit_price_snapshot)
    VALUES (1,1,'Ada Original','converted_to_investment','confirmed',2,100000,'NGN',50000);`);
});
async function latest() {
  return Number((await pg.query<{ id: number }>("SELECT max(id) AS id FROM investment_reservations")).rows[0].id);
}
const attestation = { fullPaymentConfirmed: true as const, amountNaira: "100000.00", currency: "NGN", auditNote: "Reviewed retained bank settlement evidence for this full payment." };
const prepare = async (ids: number[], attest = false, extra: any = {}) => {
  const search = await searchHistoricalHoldings({ propertyId: 1, pageSize: 50 });
  const holdings = extra.holdings || ids.map((reservationId) => ({ reservationId, ...(attest ? { attestation } : {}) }));
  return prepareHistoricalHoldings({
  propertyId: 1, adminId: 1, confirmed: true, templateIds: { deed: 1, transfer: 2 },
  ...extra, holdings: holdings.map((h: any) => ({ reviewToken: search.items.find((i) => i.reservationId === h.reservationId)?.reviewToken, ...h })),
  });
};
async function approved(id: number, amount = 100000, userId = 1) {
  await pg.exec(`INSERT INTO payment_submissions(reservation_id,user_id,amount,currency,status,reviewed_at,reviewed_by_admin_id)
    VALUES (${id},${userId},${amount},'NGN','approved',now(),1);`);
}
async function ready(pairId: number, signed = 0) {
  await database.execute(sql`UPDATE legal_document_pairs SET status='documents_ready',documents_ready_at=now() WHERE id=${pairId}`);
  await database.execute(sql`UPDATE legal_documents SET status='awaiting_signature',source_docx_key='legal/documents/test/source_docx',
    unsigned_pdf_key='legal/documents/test/unsigned_pdf',unsigned_pdf_sha256=repeat('a',64),signature_placement='{}'::jsonb WHERE pair_id=${pairId}`);
  if (signed) await database.execute(sql`UPDATE legal_documents SET status='investor_signed',investor_signed_at=now() WHERE pair_id=${pairId}
    AND ${signed === 1 ? sql`document_type='deed_of_assignment'` : sql`true`}`);
  await database.execute(sql`INSERT INTO legal_notification_cycles(pair_id,cycle_number,request_kind,status,updated_at,sent_at)
    VALUES (${pairId},1,'initial','sent',now()-interval '2 minutes',now()-interval '2 minutes')`);
  await database.execute(sql`INSERT INTO legal_jobs(pair_id,kind,status,notification_cycle_id)
    SELECT ${pairId},'notify','complete',id FROM legal_notification_cycles WHERE pair_id=${pairId}`);
}

describe("explicit historical rollout (disposable PostgreSQL, no network)", () => {
  it("searches name/email across holdings without pairs and paginates without creating anything", async () => {
    const before = (await pg.query("SELECT count(*) AS n FROM legal_document_pairs")).rows[0];
    const result = await searchHistoricalHoldings({ propertyId: 1, search: "ADA@EXAMPLE.TEST", pageSize: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ pairId: null, canPrepare: true, requiresAttestation: true });
    expect(result.templates).toHaveLength(2);
    expect((await searchHistoricalHoldings({ propertyId: 1, search: "Ada Original" })).total).toBeGreaterThan(0);
    expect((await pg.query("SELECT count(*) AS n FROM legal_document_pairs")).rows[0]).toEqual(before);
  });
  it("requires explicit bounded confirmation and exact per-holding NGN payment attestation", async () => {
    const id = await latest();
    await expect(prepare([id], true, { confirmed: false })).rejects.toThrow("confirmation");
    await expect(prepare([id, id], true)).rejects.toThrow("distinct");
    await expect(prepare(Array.from({ length: 21 }, (_, i) => i + 1), true)).rejects.toThrow("1–20");
    expect((await prepare([id])).results[0]).toMatchObject({ state: "blocked", reason: expect.stringContaining("attestation") });
    expect((await prepare([id], false, { holdings: [{ reservationId: id, attestation: { ...attestation, amountNaira: "99999" } }] })).results[0].state).toBe("blocked");
    const result = await prepare([id], true);
    expect(result.results[0].state).toBe("queued");
    const pair = (await pg.query<any>(`SELECT * FROM legal_document_pairs WHERE reservation_id=${id}`)).rows[0];
    expect(pair.approval_source).toBe("historical_rollout");
    expect(pair.payment_submission_id).toBeNull();
    expect(pair.property_area_sqm).toBe("10.00");
    expect(pair.data_snapshot.historicalEvidence).toMatchObject({ kind: "explicit_full_payment_attestation", fullPaymentConfirmed: true });
    expect(new Date(pair.effective_at).getTime()).toBeGreaterThan(Date.now() - 10000);
    expect((await pg.query(`SELECT * FROM legal_jobs WHERE pair_id=${pair.id}`)).rows).toHaveLength(1);
    expect((await pg.query(`SELECT * FROM legal_documents WHERE pair_id=${pair.id}`)).rows).toHaveLength(2);
    expect((await pg.query("SELECT reserved_units,sold_units FROM properties WHERE id=1")).rows[0]).toEqual({ reserved_units: 12, sold_units: 7 });
    expect((await pg.query(`SELECT status,funnel_stage,amount FROM investment_reservations WHERE id=${id}`)).rows[0])
      .toEqual({ status: "converted_to_investment", funnel_stage: "confirmed", amount: "100000.00" });
  });
  it("uses approved full payment provenance without inferring an earlier approval or backdating", async () => {
    const id = await latest(); await approved(id);
    const found = (await searchHistoricalHoldings({ propertyId: 1 })).items.find((h) => h.reservationId === id)!;
    expect(found.requiresAttestation).toBe(false);
    const result = await prepare([id]);
    expect(result.results[0].state).toBe("queued");
    const pair = (await pg.query<any>(`SELECT * FROM legal_document_pairs WHERE reservation_id=${id}`)).rows[0];
    expect(pair.data_snapshot.historicalEvidence.kind).toBe("approved_submission");
    expect(pair.data_snapshot.priorPaymentApprovalFabricated).toBe(false);
    expect(pair.approval_source).toBe("historical_rollout");
  });
  it("keeps duplicate/concurrent requests idempotent without resetting jobs or replacing pins", async () => {
    const id = await latest(); await approved(id);
    const results = await Promise.all([prepare([id]), prepare([id], false, { adminId: 2 })]);
    expect(results.flatMap((r) => r.results.map((h) => h.state)).sort()).toEqual(["existing", "queued"]);
    const before = (await pg.query<any>(`SELECT * FROM legal_document_pairs WHERE reservation_id=${id}`)).rows[0];
    await database.execute(sql`UPDATE legal_jobs SET status='leased',lease_token='original-lease',leased_until=now()+interval '5 minutes' WHERE pair_id=${before.id}`);
    expect((await prepare([id])).results[0].state).toBe("existing");
    expect((await pg.query<any>(`SELECT * FROM legal_document_pairs WHERE reservation_id=${id}`)).rows[0]).toEqual(before);
    expect((await pg.query<any>(`SELECT lease_token FROM legal_jobs WHERE pair_id=${before.id}`)).rows[0].lease_token).toBe("original-lease");
  });
  it("returns mixed batch results and cannot attest over partial, duplicate or other-owner payment evidence", async () => {
    const id = await latest(); await approved(id, 50000);
    const earlier = id - 1;
    expect((await prepare([earlier, id], true)).results.map((r) => r.state)).toEqual(["existing", "blocked"]);
    expect((await prepare([id], true)).results[0].reason).toContain("ambiguous");
    await approved(id);
    expect((await prepare([id], true)).results[0].state).toBe("blocked");
    await pg.exec(`INSERT INTO investment_reservations(user_id,property_id,full_name,status,funnel_stage,units,amount,currency,unit_price_snapshot)
      VALUES (1,1,'Ada','converted_to_investment','confirmed',2,100000,'NGN',50000)`);
    const wrong = await latest(); await approved(wrong, 100000, 2);
    expect((await prepare([wrong], true)).results[0].state).toBe("blocked");
  });
  it("blocks KYC, allocation mismatches, inactive holdings, wrong property, missing templates and stale confirmation pins", async () => {
    const id = await latest();
    await pg.exec(`UPDATE investment_reservations SET user_id=2 WHERE id=${id}`);
    expect((await prepare([id], true)).results[0].reason).toContain("KYC");
    await pg.exec(`UPDATE investment_reservations SET user_id=1,amount=120000 WHERE id=${id}`);
    expect((await prepare([id], true)).results[0].reason).toContain("allocation");
    await pg.exec(`UPDATE investment_reservations SET amount=100000,funnel_stage='payment_incomplete' WHERE id=${id}`);
    expect((await prepare([id], true)).results[0].reason).toContain("active");
    await pg.exec(`UPDATE investment_reservations SET funnel_stage='confirmed' WHERE id=${id}`);
    expect((await prepare([id], true, { propertyId: 2 })).results[0].reason).toContain("not found");
    expect((await prepare([id], true, { templateIds: { deed: 99, transfer: 2 } })).results[0].reason).toContain("changed");
    await pg.exec(`UPDATE legal_templates SET is_active=false WHERE id=2`);
    expect((await prepare([id], true)).results[0].reason).toContain("Activate");
    await pg.exec(`UPDATE legal_templates SET is_active=true WHERE id=2`);
  });
  it("offers partial-pair reminders but suppresses fully signed requests and blocks cancellation", async () => {
    const id = await latest();
    const pairId = (await prepare([id], true)).results[0].pairId!;
    await ready(pairId, 1);
    let search = await searchHistoricalHoldings({ propertyId: 1 });
    expect(search.items.find((h) => h.reservationId === id)).toMatchObject({ canNotify: true, signingState: "partially_signed" });
    const resend = await database.transaction((tx) => requestLegalNotificationResend(tx as any, pairId, 1));
    expect(resend.state).toBe("queued");
    await database.execute(sql`UPDATE legal_documents SET status='investor_signed',investor_signed_at=now() WHERE pair_id=${pairId}`);
    await expect(database.transaction((tx) => requestLegalNotificationResend(tx as any, pairId, 1))).rejects.toThrow("already investor-signed");
    const job = (await pg.query<any>(`UPDATE legal_jobs SET status='leased',lease_token='notify-lease',leased_until=now()+interval '5 minutes'
      WHERE pair_id=${pairId} AND kind='notify' RETURNING id`)).rows[0];
    expect(await beginLegalNotificationAttempt(job.id, "notify-lease")).toMatchObject({ state: "already_sent" });
    await pg.exec(`UPDATE investment_reservations SET status='cancelled',funnel_stage='prospective' WHERE id=${id}`);
    expect((await prepare([id], true)).results[0].state).toBe("blocked");
    await expect(beginLegalNotificationAttempt(job.id, "notify-lease")).rejects.toThrow("active");
  });
  it("migration is repeatable and preserves old provenance constraints and frozen artifacts", async () => {
    await pg.exec(await fs.readFile("scripts/ensure-legal-historical-rollout.sql", "utf8"));
    await pg.exec(await fs.readFile("scripts/ensure-legal-historical-rollout.sql", "utf8"));
    const id = await latest(); const pairId = (await prepare([id], true)).results[0].pairId!;
    await expect(pg.exec(`UPDATE legal_document_pairs SET data_snapshot='{}' WHERE id=${pairId}`)).rejects.toThrow(/immutable/);
    await expect(pg.exec(`UPDATE legal_document_pairs SET approval_source='admin_reinstate' WHERE id=${pairId}`)).rejects.toThrow(/immutable/);
    // Invalid provenance on a fresh holding is still rejected.
    await expect(pg.exec(`UPDATE legal_document_pairs SET approval_source_id=99 WHERE id=${pairId}`)).rejects.toThrow(/immutable/);
  });
  it("rejects stale reviewed recipients/values and ignores forged attestation evidence fields", async () => {
    const id = await latest();
    const reviewToken = (await searchHistoricalHoldings({ propertyId: 1 })).items.find((h) => h.reservationId === id)!.reviewToken;
    await pg.exec(`UPDATE investment_reservations SET user_id=2 WHERE id=${id}`);
    const stale = await prepare([id], true, { holdings: [{ reservationId: id, reviewToken, attestation }] });
    expect(stale.results[0]).toMatchObject({ state: "blocked", reason: expect.stringContaining("changed since review") });
    await pg.exec(`UPDATE investment_reservations SET user_id=1 WHERE id=${id}`);
    const forged = await prepare([id], true, { holdings: [{ reservationId: id, attestation: { ...attestation,
      kind: "approved_submission", attestingAdminId: 999, reviewedAt: "2000-01-01", extra: "untrusted" } }] });
    expect(forged.results[0].state).toBe("queued");
    const pair = (await pg.query<any>(`SELECT data_snapshot FROM legal_document_pairs WHERE reservation_id=${id}`)).rows[0];
    expect(pair.data_snapshot.historicalEvidence).toEqual({
      kind: "explicit_full_payment_attestation", fullPaymentConfirmed: true, currency: "NGN",
      amountNaira: "100000.00", auditNote: attestation.auditNote, attestingAdminId: 1,
    });
  });
  it("blocks invalid template metadata, contradictory legacy payments and completed resale allocations", async () => {
    const id = await latest();
    // Storage metadata is write-once, so use a newly versioned invalid active
    // reference to model a bad historical import without editing evidence.
    await pg.exec(`UPDATE legal_templates SET is_active=false WHERE id=1;
      INSERT INTO legal_templates(property_id,document_type,version,original_filename,storage_key,sha256,byte_size,validation_status,is_active,created_by_admin_id)
      VALUES (1,'deed_of_assignment',2,'bad.docx','legal/templates/properties/999/deed_of_assignment/v2/00000000-0000-4000-8000-000000000001',repeat('a',64),10,'valid',true,1)`);
    expect((await prepare([id], true)).results[0].reason).toContain("metadata");
    await pg.exec(`UPDATE legal_templates SET is_active=false WHERE version=2; UPDATE legal_templates SET is_active=true WHERE id=1;
      CREATE TABLE investment_payments(id serial PRIMARY KEY,reservation_id int,amount numeric,currency text,status text);
      CREATE TABLE resale_listings(id serial PRIMARY KEY,reservation_id int,status text);
      INSERT INTO investment_payments(reservation_id,amount,currency,status) VALUES (${id},100000,'NGN','refunded')`);
    expect((await prepare([id], true)).results[0].reason).toContain("Legacy payment");
    await pg.exec(`UPDATE investment_payments SET status='verified' WHERE reservation_id=${id};
      INSERT INTO resale_listings(reservation_id,status) VALUES (${id},'sold')`);
    expect((await prepare([id], true)).results[0].reason).toContain("resale allocation");
    await pg.exec(`UPDATE resale_listings SET status='cancelled' WHERE reservation_id=${id}`);
    expect((await prepare([id], true)).results[0].state).toBe("queued");
  });
  it("future full-payment approvals still queue the original automatic generation path", async () => {
    const id = await latest(); await approved(id);
    const submission = (await pg.query<any>(`SELECT id FROM payment_submissions WHERE reservation_id=${id}`)).rows[0].id;
    const result = await database.transaction((tx) => enqueueLegalApproval(tx as any, { reservationId: id, source: "payment_submission", sourceId: submission, adminId: 1 }));
    expect(result).toMatchObject({ eligible: true, status: "queued" });
    expect((await pg.query<any>(`SELECT approval_source FROM legal_document_pairs WHERE id=${result.pairId}`)).rows[0].approval_source).toBe("payment_submission");
  });
  it("authorizes admin-only property-scoped search/preparation, never investor-accessible", async () => {
    const app = express(); app.use(express.json());
    registerLegalRoutes(app, {
      requireAuth: (req: any, res, next) => { const user = req.get("Authorization"); if (!["Bearer investor1", "Bearer investor2"].includes(user)) return res.status(401).end(); req.user = { id: user.endsWith("1") ? 1 : 2 }; next(); },
      requireAdminAuth: (req: any, res, next) => { if (req.get("Authorization") !== "Bearer fixture") return res.status(401).end(); req.user = { userId: 1 }; next(); },
    });
    await request(app).get("/api/admin/legal/historical-holdings?propertyId=1").expect(401);
    await request(app).post("/api/admin/legal/historical-holdings/prepare").send({}).expect(401);
    await request(app).get("/api/admin/legal/historical-holdings?propertyId=1&search=ada").set("Authorization", "Bearer fixture").expect(200);
    await request(app).get("/api/admin/legal/historical-holdings?propertyId=1&pageSize=500").set("Authorization", "Bearer fixture").expect(400);
    const id = await latest();
    const reviewToken = (await searchHistoricalHoldings({ propertyId: 1 })).items.find((h) => h.reservationId === id)!.reviewToken;
    const response = await request(app).post("/api/admin/legal/historical-holdings/prepare").set("Authorization", "Bearer fixture")
      .send({ propertyId: 1, adminId: 999, confirmed: true, templateIds: { deed: 1, transfer: 2 }, holdings: [{ reservationId: id, reviewToken, attestation }] }).expect(200);
    const pairId = response.body.results[0].pairId;
    expect((await pg.query<any>(`SELECT approved_by_admin_id FROM legal_document_pairs WHERE id=${pairId}`)).rows[0].approved_by_admin_id).toBe(1);
    const owner = await request(app).get("/api/legal/holdings").set("Authorization", "Bearer investor1").expect(200);
    expect(owner.body.find((p: any) => p.id === pairId)).toMatchObject({ reservationId: id, propertyId: 1, documents: expect.any(Array) });
    expect(owner.body.find((p: any) => p.id === pairId).documents).toHaveLength(2);
    const stranger = await request(app).get("/api/legal/holdings").set("Authorization", "Bearer investor2").expect(200);
    expect(stranger.body.some((p: any) => p.id === pairId)).toBe(false);
    await request(app).get("/api/admin/legal/historical-holdings?propertyId=1").set("Authorization", "Bearer investor1").expect(401);
  });
});