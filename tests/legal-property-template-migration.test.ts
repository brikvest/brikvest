import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = readFileSync("scripts/ensure-legal-property-templates.sql", "utf8");

it("adopts only unambiguous provenance, repeats safely, and preserves ownership and per-property activation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE properties(id integer PRIMARY KEY);
      INSERT INTO properties VALUES(1),(2);
      CREATE TABLE legal_templates(id integer PRIMARY KEY, document_type text, version integer,
        is_active boolean DEFAULT false, activated_at timestamptz, created_at timestamptz DEFAULT now(),
        storage_key text);
      CREATE UNIQUE INDEX legal_templates_one_active_per_type_uq ON legal_templates(document_type) WHERE is_active;
      CREATE TABLE legal_document_pairs(id integer,property_id integer,deed_template_id integer,transfer_template_id integer);
      CREATE TABLE legal_property_bindings(property_id integer, enabled boolean, bound_at timestamptz);
      CREATE TABLE legal_audit_events(actor_type text,event_type text,details jsonb);
      INSERT INTO legal_templates(id,document_type,version,is_active,storage_key) VALUES
        (1,'deed_of_assignment',1,true,'legacy/one'),(2,'deed_of_assignment',2,false,'legacy/two'),
        (3,'transfer_exit_rights',1,true,'legacy/three'),(4,'transfer_exit_rights',2,false,'legacy/four');
      INSERT INTO legal_document_pairs VALUES(1,1,1,3),(2,2,2,3);
    `);
    await db.exec(migration);
    // Install the normal trigger for a minimal isolated schema.
    await db.exec(`CREATE TRIGGER legal_templates_immutable BEFORE UPDATE OR DELETE ON legal_templates
      FOR EACH ROW EXECUTE FUNCTION legal_guard_template_history()`);
    const first = await db.query("SELECT * FROM legal_templates ORDER BY id");
    expect(first.rows).toMatchObject([
      { id: 1, property_id: 1, is_active: true, storage_key: "legacy/one" },
      { id: 2, property_id: 2, is_active: false },
      { id: 3, property_id: null, is_active: false },
      { id: 4, property_id: null, is_active: false },
    ]);
    await db.exec(migration);
    expect((await db.query("SELECT * FROM legal_templates ORDER BY id")).rows).toEqual(first.rows);
    expect((await db.query("SELECT * FROM legal_audit_events")).rows).toHaveLength(2);
    await db.exec("UPDATE legal_templates SET is_active=true WHERE id=2");
    await expect(db.exec(`INSERT INTO legal_templates(id,property_id,document_type,version,is_active)
      VALUES(5,1,'deed_of_assignment',5,true)`)).rejects.toThrow();
    await expect(db.exec("UPDATE legal_templates SET property_id=2 WHERE id=1")).rejects.toThrow("ownership is immutable");
    await expect(db.exec("UPDATE legal_templates SET storage_key='replacement' WHERE id=1")).rejects.toThrow("provenance are immutable");
    await expect(db.exec("UPDATE legal_templates SET is_active=true WHERE id=3")).rejects.toThrow();
    await db.exec("UPDATE legal_templates SET property_id=1 WHERE id=4");
    await expect(db.exec("UPDATE legal_templates SET property_id=2 WHERE id=4")).rejects.toThrow("ownership is immutable");
    expect((await db.query("SELECT * FROM legal_document_pairs ORDER BY id")).rows).toEqual([
      { id: 1, property_id: 1, deed_template_id: 1, transfer_template_id: 3 },
      { id: 2, property_id: 2, deed_template_id: 2, transfer_template_id: 3 },
    ]);
    await db.exec(`CREATE TRIGGER legal_document_pairs_immutable
      BEFORE UPDATE OR DELETE ON legal_document_pairs
      FOR EACH ROW EXECUTE FUNCTION legal_guard_pair_history();
      INSERT INTO legal_document_pairs VALUES(3,1,1,NULL),(4,2,NULL,3)`);
    await db.exec("UPDATE legal_document_pairs SET transfer_template_id=4 WHERE id=3");
    await db.exec("UPDATE legal_document_pairs SET deed_template_id=2 WHERE id=4");
    for (const statement of [
      "UPDATE legal_document_pairs SET deed_template_id=2 WHERE id=3",
      "UPDATE legal_document_pairs SET transfer_template_id=3 WHERE id=3",
      "UPDATE legal_document_pairs SET deed_template_id=NULL WHERE id=4",
      "UPDATE legal_document_pairs SET transfer_template_id=NULL WHERE id=4",
    ]) await expect(db.exec(statement)).rejects.toThrow("Pinned legal template versions cannot be changed");
    await expect(db.exec("UPDATE legal_document_pairs SET property_id=2 WHERE id=3"))
      .rejects.toThrow("provenance and snapshots are immutable");
    await expect(db.exec("DELETE FROM legal_document_pairs WHERE id=3"))
      .rejects.toThrow("history cannot be deleted");
  } finally {
    await db.close();
  }
});