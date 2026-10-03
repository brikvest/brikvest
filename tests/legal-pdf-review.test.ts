import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import express from "express";
import request from "supertest";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: null as any, read: vi.fn(), dispatch: vi.fn() }));
vi.mock("../server/db", () => ({ get db() { return mocks.db; } }));
vi.mock("../server/legal/files", () => ({
  readLegalDocument: mocks.read, readLegalTemplateVersion: vi.fn(), storeLegalTemplateVersion: vi.fn(),
  streamAuthorizedLegalDocument: vi.fn(),
}));
vi.mock("../server/legal/worker", () => ({ dispatchLegalJobs: mocks.dispatch }));
vi.mock("../server/legal/local-signing", () => ({ beginLocalSigning: vi.fn(), completeLocalSigning: vi.fn() }));
import { registerLegalRoutes } from "../server/legal/routes";
import { markPairReady, beginLegalNotificationAttempt, claimNextLegalJob } from "../server/legal/repository";
import { hasExactPdfApproval, requireExactPdfApproval } from "../server/legal/pdf-review";

const bytes = Buffer.from(`%PDF-1.7\n${"isolated investor PDF\n".repeat(15)}`);
const hash = createHash("sha256").update(bytes).digest("hex");
let pg: PGlite, app: express.Express, pairId: number, reservationId: number;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE admin_users(id serial PRIMARY KEY);
    CREATE TABLE users(id serial PRIMARY KEY);
    CREATE TABLE properties(id serial PRIMARY KEY,name text);
    CREATE TABLE investment_reservations(id serial PRIMARY KEY,user_id int,property_id int,status text,funnel_stage text);
    CREATE TABLE payment_submissions(id serial PRIMARY KEY);
    INSERT INTO admin_users VALUES(1); INSERT INTO users VALUES(1); INSERT INTO properties VALUES(1,'Fixture estate'),(2,'Other estate');`);
  for (const file of ["documents","notification-cycles","pdf-review"]) {
    await pg.exec(await fs.readFile(`scripts/ensure-legal-${file}.sql`, "utf8"));
  }
  await pg.exec(`INSERT INTO legal_templates(document_type,version,original_filename,storage_key,sha256,byte_size,created_by_admin_id)
    VALUES ('deed_of_assignment',1,'d.docx','legal/templates/deed/v1',repeat('a',64),10,1),
      ('transfer_exit_rights',1,'t.docx','legal/templates/transfer/v1',repeat('b',64),10,1);`);
  mocks.db = drizzle(pg);
  app = express(); app.use(express.json());
  registerLegalRoutes(app, {
    requireAuth: (_req, res) => { res.sendStatus(401); },
    requireAdminAuth: (req: any, res, next) => {
      if (req.get("Authorization") !== "Bearer fixture-admin") return res.sendStatus(401);
      req.user = { userId: 1 }; next();
    },
  });
});
afterAll(() => pg.close());
beforeEach(async () => {
  mocks.read.mockReset().mockResolvedValue(bytes);
  reservationId = (await pg.query<any>(`INSERT INTO investment_reservations(user_id,property_id,status,funnel_stage)
    VALUES(1,1,'converted_to_investment','confirmed') RETURNING id`)).rows[0].id;
  pairId = (await pg.query<any>(`INSERT INTO legal_document_pairs(reservation_id,user_id,property_id,approval_source,approval_source_id,
    approved_by_admin_id,approved_at,effective_at,approval_note,full_name_snapshot,home_address_snapshot,property_area_sqm,
    units_snapshot,square_meters_per_unit,payment_amount_naira,payment_currency,deed_template_id,transfer_template_id,data_snapshot,status)
    VALUES(${reservationId},1,1,'admin_full_confirmation',${reservationId},1,now(),now(),'Fixture only','Fixture Investor','Fixture address',
      5,1,5,100,'NGN',1,2,'{}','queued') RETURNING id`)).rows[0].id;
  await pg.query(`INSERT INTO legal_documents(pair_id,document_type,template_id,source_docx_key,unsigned_pdf_key,unsigned_pdf_sha256,signature_placement)
    VALUES($1,'deed_of_assignment',1,'legal/documents/d/source_docx','legal/documents/d/unsigned_pdf',$2,'{}'),
      ($1,'transfer_exit_rights',2,'legal/documents/t/source_docx','legal/documents/t/unsigned_pdf',$2,'{}')`, [pairId, hash]);
  await markPairReady(pairId);
});
const admin = (r: request.Test) => r.set("Authorization", "Bearer fixture-admin");
async function review() {
  return (await admin(request(app).get(`/api/admin/legal/pairs/${pairId}/review?propertyId=1`)).expect(200)).body;
}
async function approve(body?: any) {
  const data = body || { propertyId: 1, confirmed: true, documents: (await review()).documents.map((d: any) => ({ id: d.id, sha256: d.sha256 })) };
  return admin(request(app).post(`/api/admin/legal/pairs/${pairId}/approve-send`)).send(data);
}

describe("exact PDF review gate (isolated PostgreSQL and mocked storage)", () => {
  it("fails closed when the additive review schema is not installed", async () => {
    const missingSchema = { execute: vi.fn(async () => ({ rows: [{ installed: false }] })) };
    expect(await hasExactPdfApproval(missingSchema, pairId)).toBe(false);
    await expect(requireExactPdfApproval(missingSchema, pairId)).rejects.toThrow("Administrator review");
  });
  it("keeps automatic generation ready without releasing any signing email", async () => {
    expect((await pg.query<any>(`SELECT count(*)::int AS n FROM legal_jobs WHERE pair_id=${pairId} AND kind='notify'`)).rows[0].n).toBe(0);
    expect(await hasExactPdfApproval(mocks.db, pairId)).toBe(false);
    expect(await review()).toMatchObject({ approved: false, reservationId, propertyName: "Fixture estate", investorName: "Fixture Investor" });
  });
  it("rejects partial and stale reviews, forged document IDs and storage corruption", async () => {
    const { documents } = await review();
    for (const invalid of [documents.slice(0,1), documents.map((d: any) => ({ ...d, sha256: "a".repeat(64) })),
      documents.map((d: any) => ({ ...d, id: d.id + 10000 }))]) {
      expect((await approve({ propertyId: 1, confirmed: true, documents: invalid })).status).toBe(409);
    }
    mocks.read.mockResolvedValue(Buffer.from("changed PDF bytes"));
    expect((await approve()).status).toBe(409);
    expect(await hasExactPdfApproval(mocks.db, pairId)).toBe(false);
  });
  it("coalesces concurrent approval requests and records exact immutable review attribution", async () => {
    const documents = (await review()).documents;
    const body = { propertyId: 1, confirmed: true, documents };
    const responses = await Promise.all([approve(body), approve(body)]);
    expect(responses.map(r => r.status)).toEqual([200,200]);
    expect(new Set(responses.map(r => r.body.cycleId)).size).toBe(1);
    const approval = (await pg.query<any>(`SELECT * FROM legal_pdf_review_approvals WHERE pair_id=${pairId}`)).rows;
    expect(approval).toHaveLength(1);
    expect(approval[0]).toMatchObject({ approved_by_admin_id: 1, deed_sha256: hash, transfer_sha256: hash });
    const claim = await claimNextLegalJob();
    expect(await beginLegalNotificationAttempt(claim!.id, claim!.leaseToken)).toEqual({ state: "send", attempt: 1 });
    await expect(pg.exec(`DELETE FROM legal_pdf_review_approvals WHERE pair_id=${pairId}`)).rejects.toThrow("append-only");
    await expect(pg.exec(`UPDATE legal_pdf_review_approvals SET deed_sha256=repeat('a',64) WHERE pair_id=${pairId}`)).rejects.toThrow("append-only");
  });
  it("does not create another invitation on a repeated approval after mail acceptance", async () => {
    const first = await approve(); expect(first.status).toBe(200);
    await pg.exec(`UPDATE legal_notification_cycles SET status='sent',sent_at=now() WHERE id=${first.body.cycleId};
      UPDATE legal_jobs SET status='complete' WHERE notification_cycle_id=${first.body.cycleId};`);
    const repeated = await approve();
    expect(repeated.body).toMatchObject({ queued: false, coalesced: true, state: "sent", cycleId: first.body.cycleId });
  });
  it("wakes the durable worker only after review approval and its notification commit", async () => {
    const environment = process.env.NODE_ENV;
    mocks.dispatch.mockReset().mockImplementation(async () => {
      const cycles = (await pg.query<any>(`SELECT count(*)::int AS n FROM legal_notification_cycles WHERE pair_id=${pairId}`)).rows[0].n;
      expect(cycles).toBe(1);
      expect(await hasExactPdfApproval(mocks.db, pairId)).toBe(true);
      return {};
    });
    try {
      process.env.NODE_ENV = "development";
      expect((await approve()).status).toBe(200);
      expect(mocks.dispatch).toHaveBeenCalledWith(3);
    } finally { process.env.NODE_ENV = environment; }
  });
  it("retains uncertain delivery quarantine even when exact PDFs are approved", async () => {
    const first = await approve(); expect(first.status).toBe(200);
    await pg.exec(`UPDATE legal_notification_cycles SET status='uncertain' WHERE id=${first.body.cycleId};
      UPDATE legal_jobs SET status='dead' WHERE notification_cycle_id=${first.body.cycleId};`);
    expect((await approve()).status).toBe(409);
    expect((await admin(request(app).post(`/api/admin/legal/pairs/${pairId}/resend`)).send({ propertyId: 1 })).status).toBe(409);
  });
  it("preserves a previously accepted unreviewed invitation without retroactive approval or resend", async () => {
    const cycle = (await pg.query<any>(`INSERT INTO legal_notification_cycles(pair_id,cycle_number,request_kind,status,sent_at)
      VALUES(${pairId},1,'initial','sent',now()) RETURNING id`)).rows[0];
    const job = (await pg.query<any>(`INSERT INTO legal_jobs(pair_id,kind,status,notification_cycle_id,lease_token,leased_until)
      VALUES(${pairId},'notify','leased',${cycle.id},'legacy-lease',now()+interval '5 minutes') RETURNING id`)).rows[0];
    expect(await beginLegalNotificationAttempt(job.id, "legacy-lease")).toEqual({ state: "already_sent" });
    expect(await hasExactPdfApproval(mocks.db, pairId)).toBe(false);
    expect((await pg.query<any>(`SELECT status FROM legal_notification_cycles WHERE id=${cycle.id}`)).rows[0].status).toBe("sent");
  });
  it("rejects unauthorized and cross-property review/release and inactive or signed holdings", async () => {
    await request(app).get(`/api/admin/legal/pairs/${pairId}/review?propertyId=1`).expect(401);
    await request(app).post(`/api/admin/legal/pairs/${pairId}/approve-send`).send({ propertyId: 1 }).expect(401);
    await admin(request(app).get(`/api/admin/legal/pairs/${pairId}/review?propertyId=2`)).expect(404);
    expect((await approve({ propertyId: 2, confirmed: true, documents: [] })).status).toBe(404);
    await pg.exec(`UPDATE investment_reservations SET status='cancelled' WHERE id=${reservationId}`);
    expect((await approve()).status).toBe(409);
    await pg.exec(`UPDATE investment_reservations SET status='converted_to_investment' WHERE id=${reservationId};
      UPDATE legal_documents SET status='investor_signed' WHERE pair_id=${pairId};`);
    expect((await approve()).status).toBe(400);
    expect((await pg.query<any>(`SELECT count(*)::int AS n FROM legal_documents WHERE pair_id=${pairId} AND status='investor_signed'`)).rows[0].n).toBe(2);
  });
  it("reapplies the additive migration without backfilling approvals or weakening evidence guards", async () => {
    await pg.exec(await fs.readFile("scripts/ensure-legal-pdf-review.sql", "utf8"));
    expect(await hasExactPdfApproval(mocks.db, pairId)).toBe(false);
    await expect(pg.exec(`UPDATE legal_documents SET unsigned_pdf_sha256=repeat('f',64) WHERE pair_id=${pairId}`)).rejects.toThrow("write-once");
  });
});