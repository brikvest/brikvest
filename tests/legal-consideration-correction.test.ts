import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";

const context = vi.hoisted(() => ({ database: null as any }));
vi.mock("../server/db", () => ({
  db: { transaction: (fn: any) => context.database.transaction(async (tx: any) => fn({
    execute: (statement: any) => {
      const query = new PgDialect().sqlToQuery(statement);
      return tx.query(query.sql, query.params);
    },
  })) },
}));
vi.mock("../server/legal/holding-state", () => ({ assertActiveConfirmedHolding: vi.fn() }));
import { correctUnsignedConsideration } from "../server/legal/consideration-correction";
import { hasExactPdfApproval } from "../server/legal/pdf-review";

beforeEach(async () => {
  context.database = new PGlite();
  await context.database.exec(`
    CREATE TABLE properties(id int PRIMARY KEY,currency text,unit_land_cost numeric,
      unit_agent_fees numeric,unit_due_diligence_cost numeric,unit_service_charge numeric);
    INSERT INTO properties VALUES(34,'NGN',277500,12500,12500,12500);
    CREATE TABLE legal_document_pairs(id int PRIMARY KEY,reservation_id int,user_id int,property_id int,
      units_snapshot numeric,payment_amount_naira numeric,payment_currency text,status text,
      documents_ready_at timestamptz,investor_signed_at timestamptz,last_error text);
    INSERT INTO legal_document_pairs VALUES(2,82,40,34,16,5040000,'NGN','documents_ready',now(),NULL,NULL);
    CREATE TABLE legal_documents(id serial PRIMARY KEY,pair_id int,document_type text,template_id int,
      status text DEFAULT 'generated',source_docx_key text,unsigned_pdf_key text,unsigned_pdf_sha256 text,
      signature_placement jsonb,signing_envelope_id text,signed_pdf_key text,signed_pdf_sha256 text,
      signing_certificate_key text,investor_signed_at timestamptz,
      CONSTRAINT legal_documents_pair_type_uq UNIQUE(pair_id,document_type));
    INSERT INTO legal_documents(pair_id,document_type,template_id,status,source_docx_key,unsigned_pdf_key,
      unsigned_pdf_sha256,signature_placement)
      VALUES(2,'deed_of_assignment',101,'awaiting_signature','original-deed.docx','original-deed.pdf',repeat('a',64),'{}'),
      (2,'transfer_exit_rights',202,'awaiting_signature','original-transfer.docx','original-transfer.pdf',repeat('b',64),'{}');
    CREATE TABLE legal_jobs(id serial PRIMARY KEY,pair_id int,kind text,status text,attempts int DEFAULT 0,
      available_at timestamptz DEFAULT now(),lease_token text,leased_until timestamptz,last_error text,
      updated_at timestamptz DEFAULT now(),UNIQUE(pair_id,kind));
    INSERT INTO legal_jobs(pair_id,kind,status) VALUES(2,'generation','complete'),(2,'notify','retry');
    CREATE TABLE local_legal_signing_operations(id serial PRIMARY KEY,pair_id int);
    CREATE TABLE legal_notification_cycles(id serial PRIMARY KEY,pair_id int,status text);
    INSERT INTO legal_notification_cycles(pair_id,status) VALUES(2,'queued');
    CREATE TABLE legal_audit_events(id serial PRIMARY KEY,pair_id int,reservation_id int,
      actor_type text,actor_id int,event_type text,details jsonb);
  `);
  const original = readFileSync("scripts/ensure-legal-documents.sql", "utf8");
  const guard = original.match(/CREATE OR REPLACE FUNCTION legal_guard_document_artifacts\(\)[\s\S]*?FOR EACH ROW EXECUTE FUNCTION legal_guard_document_artifacts\(\);/)![0];
  await context.database.exec(guard);
  await context.database.exec(readFileSync("scripts/ensure-legal-document-costs.sql", "utf8"));
  await context.database.exec(readFileSync("scripts/finalize-legal-document-costs.sql", "utf8"));
});
afterEach(async () => { await context.database.close(); });

describe("unsigned land consideration revisions", () => {
  it("keeps payment and original artifacts, creates new IDs and holds notification", async () => {
    expect(await correctUnsignedConsideration(2, 34, 5)).toEqual({ changed: true, considerationAmountNaira: "4440000.00" });
    const all = (await context.database.query("SELECT * FROM legal_documents ORDER BY id")).rows;
    expect(all).toHaveLength(4);
    expect(all[0].source_docx_key).toBe("original-deed.docx");
    expect(all[0].unsigned_pdf_key).toBe("original-deed.pdf");
    expect(all[0].superseded_at).not.toBeNull();
    expect(all.slice(2).map((d: any) => d.supersedes_document_id)).toEqual([1, 2]);
    expect(all.slice(2).map((d: any) => d.consideration_amount_naira)).toEqual(["4440000.00", "4440000.00"]);
    const pair = (await context.database.query("SELECT * FROM legal_document_pairs")).rows[0];
    expect(Number(pair.payment_amount_naira)).toBe(5040000);
    expect(pair.documents_ready_at).toBeNull();
    expect(pair.status).toBe("queued");
    expect((await context.database.query("SELECT status FROM legal_jobs WHERE kind='notify'")).rows[0].status).toBe("blocked");
    expect((await context.database.query("SELECT details FROM legal_audit_events")).rows[0].details.freshPdfReviewRequired).toBe(true);
    expect((await correctUnsignedConsideration(2, 34, 5)).changed).toBe(false);
    await expect(context.database.exec("UPDATE legal_documents SET source_docx_key='changed' WHERE id=1")).rejects.toThrow();
    await expect(context.database.exec("UPDATE legal_documents SET consideration_amount_naira=1 WHERE id=3")).rejects.toThrow();
  });
  it.each(["sent", "sending", "uncertain"])("does not correct %s mail activity", async status => {
    await context.database.query("UPDATE legal_notification_cycles SET status=$1", [status]);
    await expect(correctUnsignedConsideration(2, 34, 5)).rejects.toThrow("prevents unsigned correction");
    expect((await context.database.query("SELECT count(*)::int AS n FROM legal_documents")).rows[0].n).toBe(2);
  });
  it("does not correct any existing signing session or active worker", async () => {
    await context.database.exec("INSERT INTO local_legal_signing_operations(pair_id) VALUES(2)");
    await expect(correctUnsignedConsideration(2, 34, 5)).rejects.toThrow("prevents unsigned correction");
    await context.database.exec("DELETE FROM local_legal_signing_operations; UPDATE legal_jobs SET status='leased' WHERE kind='notify'");
    await expect(correctUnsignedConsideration(2, 34, 5)).rejects.toThrow("prevents unsigned correction");
  });
  it("fails closed when the property breakdown does not reconcile", async () => {
    await context.database.exec("UPDATE properties SET unit_land_cost=1");
    await expect(correctUnsignedConsideration(2, 34, 5)).rejects.toThrow("reconcile exactly");
  });
  it("retains an old PDF approval but requires approval of both new document IDs", async () => {
    await context.database.exec(`CREATE TABLE admin_users(id int PRIMARY KEY); INSERT INTO admin_users VALUES(5);
      ALTER TABLE legal_document_pairs ADD COLUMN deed_template_id int DEFAULT 101,
        ADD COLUMN transfer_template_id int DEFAULT 202;`);
    await context.database.exec(readFileSync("scripts/ensure-legal-pdf-review.sql", "utf8"));
    await context.database.exec(`INSERT INTO legal_pdf_review_approvals(pair_id,approved_by_admin_id,
      deed_document_id,deed_sha256,transfer_document_id,transfer_sha256)
      VALUES(2,5,1,repeat('a',64),2,repeat('b',64))`);
    const executor = { execute: (statement: any) => {
      const query = new PgDialect().sqlToQuery(statement);
      return context.database.query(query.sql, query.params);
    } };
    expect(await hasExactPdfApproval(executor, 2)).toBe(true);
    await correctUnsignedConsideration(2, 34, 5);
    await context.database.exec(`UPDATE legal_document_pairs SET documents_ready_at=now(),status='documents_ready';
      UPDATE legal_documents SET source_docx_key='corrected-'||id||'.docx',unsigned_pdf_key='corrected-'||id||'.pdf',
        unsigned_pdf_sha256=repeat(CASE WHEN document_type='deed_of_assignment' THEN 'c' ELSE 'd' END,64),
        signature_placement='{}',status='awaiting_signature' WHERE superseded_at IS NULL;`);
    expect(await hasExactPdfApproval(executor, 2)).toBe(false);
    expect((await context.database.query("SELECT count(*)::int AS n FROM legal_pdf_review_approvals")).rows[0].n).toBe(1);
    await expect(context.database.exec(`INSERT INTO legal_pdf_review_approvals(pair_id,approved_by_admin_id,
      deed_document_id,deed_sha256,transfer_document_id,transfer_sha256)
      VALUES(2,5,1,repeat('a',64),2,repeat('b',64))`)).rejects.toThrow("exact ready investor PDFs");
    await context.database.exec(`INSERT INTO legal_pdf_review_approvals(pair_id,approved_by_admin_id,
      deed_document_id,deed_sha256,transfer_document_id,transfer_sha256)
      VALUES(2,5,3,repeat('c',64),4,repeat('d',64))`);
    expect(await hasExactPdfApproval(executor, 2)).toBe(true);
  });
});