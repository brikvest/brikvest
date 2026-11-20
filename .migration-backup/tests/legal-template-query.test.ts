import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  validateLegalTemplate,
  type LegalDocumentType,
} from "../server/legal/templates";
import { templateUploadInsert } from "../server/legal/template-query";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedPlaceholders: Record<LegalDocumentType, string[]> = {
  deed_of_assignment: [
    "USER_FULL_NAME",
    "PROPERTY_AREA_SQM",
    "DOCUMENT_DATE_DAY",
    "DOCUMENT_DATE_MONTH",
    "DOCUMENT_DATE_YEAR",
    "USER_HOME_ADDRESS",
    "PAYMENT_AMOUNT_NAIRA_NUMERIC",
    "PAYMENT_AMOUNT_NAIRA_WORDS",
  ],
  transfer_exit_rights: [
    "USER_FULL_NAME",
    "PROPERTY_AREA_SQM",
    "DOCUMENT_DATE_DAY",
    "DOCUMENT_DATE_MONTH",
    "DOCUMENT_DATE_YEAR",
    "USER_HOME_ADDRESS",
  ],
};

let database: PGlite;

function compile(query: ReturnType<typeof templateUploadInsert>) {
  return new PgDialect().sqlToQuery(query as never);
}

async function insertTemplate(input: Parameters<typeof templateUploadInsert>[0]) {
  const query = compile(templateUploadInsert(input));
  return database.query<{ id: number }>(query.sql, query.params as never[]);
}

describe("legal template upload query (isolated PGlite)", () => {
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      CREATE TABLE properties (id serial PRIMARY KEY);
      CREATE TABLE admin_users (id serial PRIMARY KEY);
      INSERT INTO properties DEFAULT VALUES;
      INSERT INTO admin_users DEFAULT VALUES;

      CREATE TABLE legal_templates (
        id serial PRIMARY KEY,
        property_id integer NOT NULL REFERENCES properties(id),
        document_type text NOT NULL,
        version integer NOT NULL,
        original_filename text NOT NULL,
        storage_key text NOT NULL UNIQUE,
        sha256 text NOT NULL,
        byte_size integer NOT NULL,
        required_placeholders text[] NOT NULL DEFAULT ARRAY[]::text[],
        validation_status text NOT NULL,
        is_active boolean NOT NULL DEFAULT false,
        created_by_admin_id integer NOT NULL REFERENCES admin_users(id)
      );
    `);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("inserts validated bundled documents with complete placeholders and inactive status", async () => {
    const fixtures = await Promise.all(
      (["deed_of_assignment", "transfer_exit_rights"] as const).map(async (documentType) => {
        const bytes = await fs.readFile(
          path.join(projectRoot, "server/legal/template-assets", `${documentType}_v1.docx`),
        );
        const validation = validateLegalTemplate(bytes, documentType);
        return {
          documentType,
          bytes,
          placeholders: Object.keys(validation.placeholderCounts),
        };
      }),
    );

    expect(fixtures.map(({ documentType, placeholders }) => [documentType, placeholders])).toEqual([
      ["deed_of_assignment", expectedPlaceholders.deed_of_assignment],
      ["transfer_exit_rights", expectedPlaceholders.transfer_exit_rights],
    ]);

    for (const fixture of fixtures) {
      const query = compile(templateUploadInsert({
        propertyId: 1,
        documentType: fixture.documentType,
        version: 1,
        filename: `${fixture.documentType}_v1.docx`,
        key: `legal/templates/${fixture.documentType}/v1.docx`,
        sha: createHash("sha256").update(fixture.bytes).digest("hex"),
        byteSize: fixture.bytes.byteLength,
        placeholders: fixture.placeholders,
        adminId: 1,
      }));
      expect(query.sql).toContain("ARRAY[");
      expect(query.params).toContain(fixture.placeholders[0]);
      await database.query(query.sql, query.params as never[]);
    }

    const rows = await database.query<{
      document_type: LegalDocumentType;
      required_placeholders: string[];
      is_active: boolean;
    }>(`
      SELECT document_type, required_placeholders, is_active
      FROM legal_templates
      ORDER BY document_type
    `);
    expect(rows.rows).toEqual([
      {
        document_type: "deed_of_assignment",
        required_placeholders: expectedPlaceholders.deed_of_assignment,
        is_active: false,
      },
      {
        document_type: "transfer_exit_rights",
        required_placeholders: expectedPlaceholders.transfer_exit_rights,
        is_active: false,
      },
    ]);
  });

  it("reproduces the old JS-array record cast failure and safely stores empty and special values", async () => {
    const priorArrayInterpolation = compile(
      sql`SELECT ${["TOKEN_ONE", "TOKEN_TWO"]}::text[]`,
    );
    expect(priorArrayInterpolation.sql).toContain("::text[]");
    await expect(
      database.query(priorArrayInterpolation.sql, priorArrayInterpolation.params as never[]),
    ).rejects.toThrow(/cannot cast type record to text\[\]/i);

    await insertTemplate({
      propertyId: 1,
      documentType: "deed_of_assignment",
      version: 2,
      filename: "empty.docx",
      key: "legal/templates/test/empty.docx",
      sha: "empty-fixture",
      byteSize: 1,
      placeholders: [],
      adminId: 1,
    });
    await insertTemplate({
      propertyId: 1,
      documentType: "transfer_exit_rights",
      version: 2,
      filename: "special.docx",
      key: "legal/templates/test/special.docx",
      sha: "special-fixture",
      byteSize: 1,
      placeholders: ["quote' value", "comma,value", "back\\slash"],
      adminId: 1,
    });

    const rows = await database.query<{
      version: number;
      required_placeholders: string[];
    }>(`
      SELECT version, required_placeholders
      FROM legal_templates
      WHERE version = 2
      ORDER BY document_type
    `);
    expect(rows.rows).toEqual([
      { version: 2, required_placeholders: [] },
      { version: 2, required_placeholders: ["quote' value", "comma,value", "back\\slash"] },
    ]);
  });
});