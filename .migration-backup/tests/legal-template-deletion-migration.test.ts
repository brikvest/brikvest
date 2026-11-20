import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";

const migration = readFileSync("scripts/ensure-legal-template-deletion.sql", "utf8");

let database: PGlite | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

it("installs idempotently and protects active and historically referenced templates in either serialized lock ordering", async () => {
  database = new PGlite();
  await database.exec(`
    CREATE TABLE admin_users(id integer PRIMARY KEY);
    INSERT INTO admin_users VALUES (7);
    CREATE TABLE legal_templates(
      id integer PRIMARY KEY, property_id integer, document_type text, version integer,
      is_active boolean NOT NULL DEFAULT false, activated_at timestamptz,
      storage_key text NOT NULL, sha256 text NOT NULL, created_by_admin_id integer
    );
    CREATE TABLE legal_document_pairs(
      id integer PRIMARY KEY, deed_template_id integer, transfer_template_id integer
    );
    CREATE TABLE legal_documents(id integer PRIMARY KEY, template_id integer NOT NULL);
    INSERT INTO legal_templates(id,property_id,document_type,version,is_active,storage_key,sha256)
      VALUES (1,10,'deed_of_assignment',1,true,'legal/a','a'),
             (2,10,'deed_of_assignment',2,false,'legal/b','b'),
             (3,10,'transfer_exit_rights',1,false,'legal/c','c');
    INSERT INTO legal_document_pairs VALUES (1,10,3);
    INSERT INTO legal_documents VALUES (1,3);
  `);
  await database.exec(migration);
  await database.exec(migration);

  // PGlite is serialized and does not model independent PostgreSQL sessions;
  // these statement orderings verify each side of the row-lock protocol.
  await expect(database!.exec(
    "UPDATE legal_templates SET is_active=false,deleted_at=now(),deleted_by_admin_id=7 WHERE id=1",
  )).rejects.toThrow("activated");
  await expect(database!.exec(
    "UPDATE legal_templates SET deleted_at=now(),deleted_by_admin_id=7 WHERE id=3",
  )).rejects.toThrow("Referenced legal template versions cannot be deleted");
  await expect(database!.exec(`
    INSERT INTO legal_templates(id,property_id,document_type,version,storage_key,sha256,deleted_at,deleted_by_admin_id)
    VALUES (4,10,'deed_of_assignment',4,'legal/d','d',now(),7)
  `)).rejects.toThrow("cannot be inserted as deleted");
  await expect(database!.exec(
    "UPDATE legal_templates SET deleted_at=now(),deleted_by_admin_id=7,activated_at=now() WHERE id=2",
  )).rejects.toThrow("Logical deletion may change only deletion metadata");

  await database.exec("UPDATE legal_templates SET deleted_at=now(),deleted_by_admin_id=7 WHERE id=2");
  await expect(database.exec("UPDATE legal_templates SET deleted_at=NULL,deleted_by_admin_id=NULL WHERE id=2"))
    .rejects.toThrow("write-once");
  await expect(database.exec("UPDATE legal_templates SET storage_key='replacement' WHERE id=2"))
    .rejects.toThrow("Deleted legal template versions are immutable");
  await expect(database.exec("UPDATE legal_templates SET activated_at=now() WHERE id=2"))
    .rejects.toThrow("Deleted legal template versions are immutable");
  await expect(database.exec("INSERT INTO legal_document_pairs VALUES (2,2,NULL)"))
    .rejects.toThrow("cannot be newly pinned");
  await expect(database.exec("INSERT INTO legal_documents VALUES (2,2)"))
    .rejects.toThrow("cannot be newly referenced");
  await expect(database.exec("DELETE FROM legal_templates WHERE id=2"))
    .rejects.toThrow("cannot be deleted");

  const retained = await database.query(
    "SELECT id,version,storage_key,deleted_by_admin_id FROM legal_templates WHERE id=2",
  );
  expect(retained.rows).toEqual([{ id: 2, version: 2, storage_key: "legal/b", deleted_by_admin_id: 7 }]);
});