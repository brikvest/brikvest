import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// No app imports, credentials, network requests or real database connections.
let pg: PGlite;
let repair: string;
let originalFunction: string;
const insertApproval = `INSERT INTO legal_pdf_review_approvals
  (pair_id,approved_by_admin_id,deed_document_id,deed_sha256,transfer_document_id,transfer_sha256)
  VALUES (1,1,1,repeat('a',64),2,repeat('b',64))`;

async function applyDraft() {
  try { await pg.exec(repair); }
  catch (error) { await pg.exec("ROLLBACK"); throw error; }
}

beforeAll(async () => {
  const draft = await fs.readFile("docs/pdf-approval-safeguard-review.md", "utf8");
  repair = draft.match(/```sql\n([\s\S]*?)\n```/)![1];
  const source = await fs.readFile("scripts/ensure-legal-pdf-review.sql", "utf8");
  originalFunction = source.match(/CREATE OR REPLACE FUNCTION legal_guard_pdf_review\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/)![0];
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE admin_users(id integer PRIMARY KEY);
    CREATE TABLE legal_document_pairs(id integer PRIMARY KEY,documents_ready_at timestamptz,
      deed_template_id integer,transfer_template_id integer);
    CREATE TABLE legal_documents(id integer PRIMARY KEY,pair_id integer,document_type text,
      template_id integer,unsigned_pdf_sha256 text,unsigned_pdf_key text,
      signature_placement jsonb,superseded_at timestamptz);
    INSERT INTO admin_users VALUES(1);
    INSERT INTO legal_document_pairs VALUES(1,now(),10,20);
    INSERT INTO legal_documents VALUES
      (1,1,'deed_of_assignment',10,repeat('a',64),'synthetic-deed','{}',NULL),
      (2,1,'transfer_exit_rights',20,repeat('b',64),'synthetic-transfer','{}',NULL);
  `);
  await pg.exec(source);
});
beforeEach(async () => {
  await pg.exec(`DROP TRIGGER IF EXISTS legal_pdf_review_append_only ON legal_pdf_review_approvals;
    TRUNCATE legal_pdf_review_approvals;
    UPDATE legal_documents SET superseded_at=NULL;
    UPDATE legal_document_pairs SET documents_ready_at=now();`);
  await pg.exec(originalFunction);
});
afterAll(async () => { await pg.close(); });

describe("Reviewed trigger-only PDF approval repair", () => {
  it("attaches the reviewed function without changing existing approval evidence", async () => {
    await pg.exec(insertApproval);
    const before = (await pg.query("SELECT * FROM legal_pdf_review_approvals")).rows;
    await applyDraft();
    expect((await pg.query("SELECT * FROM legal_pdf_review_approvals")).rows).toEqual(before);
    const trigger = (await pg.query<{ tgtype: number; tgenabled: string }>(`
      SELECT tgtype,tgenabled FROM pg_trigger
      WHERE tgname='legal_pdf_review_append_only' AND NOT tgisinternal`)).rows[0];
    expect(trigger).toEqual({ tgtype: 31, tgenabled: "O" });
    await expect(pg.exec("UPDATE legal_pdf_review_approvals SET approved_at=now()")).rejects.toThrow("append-only");
    await expect(pg.exec("DELETE FROM legal_pdf_review_approvals")).rejects.toThrow("append-only");
  });

  it("accepts both exact current ready PDFs", async () => {
    await applyDraft();
    await expect(pg.exec(insertApproval)).resolves.toBeDefined();
  });

  it("rejects mismatched PDF hashes", async () => {
    await applyDraft();
    await expect(pg.exec(insertApproval.replace("repeat('a',64)", "repeat('c',64)")))
      .rejects.toThrow("both exact ready investor PDFs");
  });

  it("rejects superseded or unready PDFs", async () => {
    await applyDraft();
    await pg.exec("UPDATE legal_documents SET superseded_at=now() WHERE id=1");
    await expect(pg.exec(insertApproval)).rejects.toThrow("both exact ready investor PDFs");
    await pg.exec("UPDATE legal_documents SET superseded_at=NULL; UPDATE legal_document_pairs SET documents_ready_at=NULL");
    await expect(pg.exec(insertApproval)).rejects.toThrow("both exact ready investor PDFs");
  });

  it("stops if the function body differs rather than replacing it", async () => {
    await pg.exec(`CREATE OR REPLACE FUNCTION legal_guard_pdf_review() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
    await expect(applyDraft()).rejects.toThrow("differs from the reviewed contract");
    expect((await pg.query("SELECT 1 FROM pg_trigger WHERE tgname='legal_pdf_review_append_only'")).rows).toHaveLength(0);
  });

  it("stops if the function is missing", async () => {
    await pg.exec("DROP FUNCTION legal_guard_pdf_review()");
    await expect(applyDraft()).rejects.toThrow("differs from the reviewed contract");
  });

  it("does not replace an existing trigger on a repeated execution", async () => {
    await applyDraft();
    await expect(applyDraft()).rejects.toThrow("already exists");
    await pg.exec(insertApproval);
    await expect(pg.exec("DELETE FROM legal_pdf_review_approvals")).rejects.toThrow("append-only");
  });
});
