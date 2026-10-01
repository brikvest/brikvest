import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite;
let migration: string;
let notificationCycleMigration: string;
let reservationId: number;
let userId: number;
let propertyId: number;
let adminId: number;
let deedTemplateId: number;
let transferTemplateId: number;
let pairId: number;

beforeAll(async () => {
  database = new PGlite();
  migration = await fs.readFile("scripts/ensure-legal-documents.sql", "utf8");
  notificationCycleMigration = await fs.readFile(
    "scripts/ensure-legal-notification-cycles.sql",
    "utf8",
  );
  await database.exec(`
    CREATE TABLE admin_users (id serial PRIMARY KEY);
    CREATE TABLE users (id serial PRIMARY KEY);
    CREATE TABLE properties (id serial PRIMARY KEY);
    CREATE TABLE investment_reservations (id serial PRIMARY KEY);
    CREATE TABLE payment_submissions (id serial PRIMARY KEY);

    INSERT INTO admin_users DEFAULT VALUES;
    INSERT INTO users DEFAULT VALUES;
    INSERT INTO properties DEFAULT VALUES;
  `);
  const parents = await database.query<{ id: number }>(`
    SELECT
      (SELECT id FROM admin_users LIMIT 1) AS admin_id,
      (SELECT id FROM users LIMIT 1) AS user_id,
      (SELECT id FROM properties LIMIT 1) AS property_id
  `);
  adminId = parents.rows[0].admin_id;
  userId = parents.rows[0].user_id;
  propertyId = parents.rows[0].property_id;
});

afterAll(async () => {
  await database?.close();
});

describe("legal persistence migration (isolated PGlite)", () => {
  it("is additive and repeatable", async () => {
    await database.exec(migration);
    await database.exec(migration);
    await database.exec(notificationCycleMigration);
    await database.exec(notificationCycleMigration);
    const result = await database.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'legal_property_bindings', 'legal_templates', 'legal_document_pairs',
          'legal_documents', 'legal_jobs', 'legal_audit_events',
          'legal_notification_cycles'
        )
      ORDER BY table_name
    `);
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "legal_audit_events",
      "legal_document_pairs",
      "legal_documents",
      "legal_jobs",
      "legal_notification_cycles",
      "legal_property_bindings",
      "legal_templates",
    ]);
    const preserved = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM users
    `);
    expect(preserved.rows[0].count).toBe(1);
  });

  it("allows only one document pair for a purchase under concurrent inserts", async () => {
    const holding = await database.query<{ id: number }>(`
      INSERT INTO investment_reservations DEFAULT VALUES RETURNING id
    `);
    reservationId = holding.rows[0].id;
    const templateResult = await database.query<{ id: number }>(`
      INSERT INTO legal_templates
        (document_type, version, original_filename, storage_key, sha256, byte_size,
         validation_status, created_by_admin_id)
      VALUES
        ('deed_of_assignment', 1, 'deed.docx', 'legal/templates/deed/v1.docx',
         repeat('a', 64), 10, 'valid', ${adminId}),
        ('transfer_exit_rights', 1, 'transfer.docx', 'legal/templates/transfer/v1.docx',
         repeat('b', 64), 10, 'valid', ${adminId})
      RETURNING id
    `);
    deedTemplateId = templateResult.rows[0].id;
    transferTemplateId = templateResult.rows[1].id;
    await expect(database.query(`
      UPDATE legal_templates
      SET original_filename = 'rewritten.docx'
      WHERE id = ${deedTemplateId}
    `)).rejects.toThrow(/immutable/i);

    await database.query(`
      INSERT INTO legal_property_bindings
        (property_id, document_scope, square_meters_per_unit, note, bound_by_admin_id)
      VALUES (${propertyId}, 'SD118', 5, 'Exact selected SD118 property', ${adminId})
    `);
    const secondProperty = await database.query<{ id: number }>(`
      INSERT INTO properties DEFAULT VALUES RETURNING id
    `);
    await expect(database.query(`
      INSERT INTO legal_property_bindings
        (property_id, document_scope, square_meters_per_unit, note, bound_by_admin_id)
      VALUES (${secondProperty.rows[0].id}, 'SD118', 5, 'Second active binding', ${adminId})
    `)).rejects.toThrow();

    const insertPair = () => database.query<{ id: number }>(`
      INSERT INTO legal_document_pairs (
        reservation_id, user_id, property_id, approval_source, approval_source_id,
        approved_by_admin_id, approved_at, effective_at, approval_note,
        full_name_snapshot, home_address_snapshot, property_area_sqm, units_snapshot,
        square_meters_per_unit, payment_amount_naira, payment_currency,
        deed_template_id, transfer_template_id, data_snapshot
      ) VALUES (
        ${reservationId}, ${userId}, ${propertyId}, 'admin_full_confirmation',
        ${reservationId}, ${adminId}, now(), now(), 'Admin confirmed full payment',
        'Test Investor', '1 Test Street', 5, 1, 5, 1000000, 'NGN',
        ${deedTemplateId}, ${transferTemplateId}, '{"test":true}'::jsonb
      )
      RETURNING id
    `);
    const outcomes = await Promise.allSettled([insertPair(), insertPair()]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const pair = await database.query<{ id: number }>(`
      SELECT id FROM legal_document_pairs WHERE reservation_id = ${reservationId}
    `);
    pairId = pair.rows[0].id;
  });

  it("locks final artifacts and keeps audit events append-only", async () => {
    await database.query(`
      INSERT INTO legal_documents (pair_id, document_type, template_id, status)
      VALUES
        (${pairId}, 'deed_of_assignment', ${deedTemplateId}, 'generated'),
        (${pairId}, 'transfer_exit_rights', ${transferTemplateId}, 'generated')
    `);
    const document = await database.query<{ id: number }>(`
      SELECT id FROM legal_documents
      WHERE pair_id = ${pairId} AND document_type = 'deed_of_assignment'
    `);
    const documentId = document.rows[0].id;
    await database.query(`
      UPDATE legal_documents
      SET status = 'investor_signed', signed_pdf_key = 'legal/signed/deed.pdf',
          signed_pdf_sha256 = repeat('c', 64),
          signing_certificate_key = 'legal/signed/certificate.p7m'
      WHERE id = ${documentId}
    `);
    await expect(database.query(`
      UPDATE legal_documents
      SET signed_pdf_key = 'legal/signed/replacement.pdf'
      WHERE id = ${documentId}
    `)).rejects.toThrow(/immutable/i);
    await expect(database.query(`
      DELETE FROM legal_documents WHERE id = ${documentId}
    `)).rejects.toThrow(/cannot be deleted/i);
    const audit = await database.query<{ id: number }>(`
      INSERT INTO legal_audit_events
        (pair_id, reservation_id, actor_type, event_type)
      VALUES (${pairId}, ${reservationId}, 'admin', 'test_event')
      RETURNING id
    `);
    await expect(database.query(`
      UPDATE legal_audit_events SET event_type = 'rewritten'
      WHERE id = ${audit.rows[0].id}
    `)).rejects.toThrow(/append-only/i);
    await expect(database.query(`
      DELETE FROM users WHERE id = ${userId}
    `)).rejects.toThrow();
  });
});