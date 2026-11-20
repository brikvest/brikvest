import { sql } from "drizzle-orm";

/** Explicit array constructor: interpolating a JS array creates a SQL record. */
export function templateUploadInsert(input: {
  propertyId: number; documentType: string; version: number; filename: string;
  key: string; sha: string; byteSize: number; placeholders: string[]; adminId: number;
}) {
  return sql`INSERT INTO legal_templates
    (property_id, document_type, version, original_filename, storage_key, sha256, byte_size, required_placeholders, validation_status, created_by_admin_id)
    VALUES (${input.propertyId}, ${input.documentType}, ${input.version},
      ${input.filename.replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 160)},
      ${input.key}, ${input.sha}, ${input.byteSize},
      ARRAY[${sql.join(input.placeholders.map((token) => sql`${token}`), sql`, `)}]::text[],
      'valid', ${input.adminId}) RETURNING id`;
}