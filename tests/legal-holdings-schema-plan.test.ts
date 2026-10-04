import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("the approval-only additive DDL restores reads without changing rows, guards or original uniqueness", async () => {
  const pg = new PGlite();
  try {
    const plan = await fs.readFile("docs/lilycrest-schema-repair-approval.md", "utf8");
    const ddl = plan.match(/```sql proposed-repair\n([\s\S]*?)\n```/)?.[1];
    expect(ddl).toBeTruthy();
    expect(ddl).not.toMatch(/\b(?:INSERT|UPDATE\s+public|DELETE\s+FROM|DROP|TRUNCATE)\b/i);
    await pg.exec(`
      CREATE TABLE legal_documents (
        id integer PRIMARY KEY, pair_id integer, document_type text, status text,
        source_docx_key text, unsigned_pdf_key text, unsigned_pdf_sha256 text,
        signed_pdf_key text, signed_pdf_sha256 text, signing_certificate_key text,
        CONSTRAINT legal_documents_pair_type_uq UNIQUE(pair_id,document_type)
      );
      INSERT INTO legal_documents VALUES
        (1,10,'deed_of_assignment','investor_signed','retained-docx','retained-unsigned','hash',
          'retained-signed','signed-hash','retained-certificate'),
        (2,10,'transfer_exit_rights','awaiting_signature','retained-docx-2','retained-unsigned-2','hash-2',NULL,NULL,NULL);
      CREATE TABLE investment_reservations(id integer PRIMARY KEY, amount numeric);
      CREATE TABLE payment_submissions(id integer PRIMARY KEY, amount numeric);
      CREATE TABLE legal_jobs(id integer PRIMARY KEY, kind text, status text);
      CREATE TABLE legal_notification_cycles(id integer PRIMARY KEY, status text);
      INSERT INTO investment_reservations VALUES(1,100000);
      INSERT INTO payment_submissions VALUES(1,100000);
      INSERT INTO legal_jobs VALUES(1,'notify','retry');
      INSERT INTO legal_notification_cycles VALUES(1,'queued');
    `);
    // Use the retained artifact guard's real definition, not a weakened mock.
    const documentsSql = await fs.readFile("scripts/ensure-legal-documents.sql", "utf8");
    const artifactGuard = documentsSql.match(/CREATE OR REPLACE FUNCTION legal_guard_document_artifacts\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/)?.[0];
    const costsSql = await fs.readFile("scripts/ensure-legal-document-costs.sql", "utf8");
    const revisionGuard = costsSql.match(/CREATE OR REPLACE FUNCTION legal_guard_document_revision\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/)?.[0];
    expect(artifactGuard).toBeTruthy(); expect(revisionGuard).toBeTruthy();
    await pg.exec(`${artifactGuard}
      CREATE TRIGGER legal_documents_immutable_artifacts BEFORE UPDATE OR DELETE ON legal_documents
        FOR EACH ROW EXECUTE FUNCTION legal_guard_document_artifacts();
      ${revisionGuard}
      CREATE TRIGGER legal_documents_revision_history BEFORE INSERT OR UPDATE ON legal_documents
        FOR EACH ROW EXECUTE FUNCTION legal_guard_document_revision();`);
    const rows = async () => (await pg.query(`SELECT to_jsonb(d)
      - 'consideration_amount_naira' - 'supersedes_document_id' - 'superseded_at' AS original
      FROM legal_documents d ORDER BY id`)).rows;
    const records = async () => (await pg.query(`SELECT
      (SELECT jsonb_agg(r ORDER BY id) FROM investment_reservations r) AS holdings,
      (SELECT jsonb_agg(p ORDER BY id) FROM payment_submissions p) AS payments,
      (SELECT jsonb_agg(j ORDER BY id) FROM legal_jobs j) AS jobs,
      (SELECT jsonb_agg(c ORDER BY id) FROM legal_notification_cycles c) AS cycles`)).rows;
    const guards = async () => (await pg.query(`SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid),p.prosrc
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid='legal_documents'::regclass AND NOT t.tgisinternal ORDER BY t.tgname`)).rows;
    const beforeRows = await rows(), beforeRecords = await records(), beforeGuards = await guards();
    await expect(pg.query("SELECT id FROM legal_documents WHERE superseded_at IS NULL")).rejects.toThrow(/superseded_at/);
    await pg.exec(ddl!);
    expect((await pg.query("SELECT id FROM legal_documents WHERE superseded_at IS NULL ORDER BY id")).rows)
      .toEqual([{ id: 1 }, { id: 2 }]);
    expect(await rows()).toEqual(beforeRows);
    expect(await records()).toEqual(beforeRecords);
    expect(await guards()).toEqual(beforeGuards);
    expect((await pg.query(`SELECT count(*)::int AS changed FROM legal_documents
      WHERE consideration_amount_naira IS NOT NULL OR supersedes_document_id IS NOT NULL OR superseded_at IS NOT NULL`)).rows)
      .toEqual([{ changed: 0 }]);
    const fk = (await pg.query(`SELECT confupdtype,confdeltype FROM pg_constraint
      WHERE conrelid='legal_documents'::regclass AND contype='f'`)).rows;
    expect(fk).toEqual([{ confupdtype: "r", confdeltype: "r" }]);
    expect((await pg.query(`SELECT indexdef FROM pg_indexes WHERE indexname='legal_documents_current_pair_type_uq'`)).rows[0].indexdef)
      .toMatch(/UNIQUE.*pair_id, document_type.*WHERE \(superseded_at IS NULL\)/);
    await expect(pg.exec("UPDATE legal_documents SET signed_pdf_key='replacement' WHERE id=1"))
      .rejects.toThrow(/immutable/);
    await expect(pg.exec("DELETE FROM legal_documents WHERE id=1")).rejects.toThrow(/cannot be deleted/);
    await expect(pg.exec("INSERT INTO legal_documents(id,pair_id,document_type) VALUES(3,10,'deed_of_assignment')"))
      .rejects.toThrow(/duplicate key/);
    await pg.exec(ddl!);
    expect(await rows()).toEqual(beforeRows);
    expect(await records()).toEqual(beforeRecords);
    expect(await guards()).toEqual(beforeGuards);
    expect((await pg.query(`SELECT count(*)::int AS original_unique FROM pg_constraint
      WHERE conrelid='legal_documents'::regclass AND conname='legal_documents_pair_type_uq'`)).rows)
      .toEqual([{ original_unique: 1 }]);
    expect((await pg.query("SELECT to_regclass('public.legal_pdf_review_approvals') AS approvals")).rows)
      .toEqual([{ approvals: null }]);
  } finally {
    await pg.close();
  }
});