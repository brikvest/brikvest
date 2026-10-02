import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import PizZip from "pizzip";
import { PNG } from "pngjs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LegalFileAlreadyExistsError,
  LegalFileNotFoundError,
  storeLegalTemplateVersion,
  type LegalDocumentFileKind,
  type LegalStorageReference,
  type StoreLegalDocumentOptions,
} from "../server/legal/files";
import type { ConvertDocxToPdfOptions } from "../server/legal/converter";

const databaseRef = vi.hoisted(() => ({ current: null as unknown }));
const templateObjects = vi.hoisted(() => ({
  contents: new Map<string, Buffer>(),
  reads: [] as string[],
}));
// Model exact object paths, not the template-reader boundary: a wrong reader
// path must fail instead of returning whichever fixture matches a document type.
vi.mock("../server/objectStorage", () => ({
  objectStorageClient: {
    bucket: (bucket: string) => {
      if (bucket !== "isolated-legal-e2e") throw new Error("Unexpected test bucket");
      return {
        file: (objectPath: string) => {
          const key = `${bucket}/${objectPath}`;
          return {
            save: async (bytes: Buffer, options: { preconditionOpts?: { ifGenerationMatch?: number } }) => {
              if (options.preconditionOpts?.ifGenerationMatch !== 0) throw new Error("Immutable write required");
              if (templateObjects.contents.has(key)) throw Object.assign(new Error("Object exists"), { code: 412 });
              templateObjects.contents.set(key, Buffer.from(bytes));
            },
            exists: async () => [templateObjects.contents.has(key)],
            download: async () => {
              templateObjects.reads.push(objectPath);
              const bytes = templateObjects.contents.get(key);
              if (!bytes) throw Object.assign(new Error("Object missing"), { code: 404 });
              return [Buffer.from(bytes)];
            },
          };
        },
      };
    },
  },
}));
vi.mock("../server/db", () => ({
  get db() {
    return databaseRef.current;
  },
}));

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deedTemplate = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/deed_of_assignment_v1.docx"),
);
const transferTemplate = readFileSync(
  path.join(projectRoot, "server/legal/template-assets/transfer_exit_rights_v1.docx"),
);
const verifiedInvestorName =
  "Alexandria Beatrice Catherine Delilah Elizabeth Florence Genevieve Isabella Josephine Montgomery Fitzwilliam";
const verifiedInvestorAddress =
  "Apartment 1, Building 2, Example Boulevard, Example District, Abuja, " +
  "Additional Address Detail, Example District, Abuja";
const verifiedInvestorPassword = "Native-signing-e2e-password#8";

let pglite: PGlite;
let testDb: ReturnType<typeof drizzle>;
let storage: Map<string, Buffer>;
let ownerId: number;
let reservationId: number;
let submissionId: number;
let adminId: number;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function resultRows<T>(result: unknown): T[] {
  return (result as { rows?: T[] } | null)?.rows ?? [];
}

function visibleDocxText(document: Buffer): string {
  const zip = new PizZip(document);
  return Object.entries(zip.files)
    .filter(([name, file]) => name.startsWith("word/") && name.endsWith(".xml") && !file.dir)
    .flatMap(([, file]) => [
      ...file.asText().matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),
    ].map((match) => match[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")))
    .join("");
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const checksumInput = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(checksumInput), 8 + data.length);
  return chunk;
}

function createNonblankSignaturePng(): Buffer {
  const width = 320;
  const height = 100;
  const pixels = Buffer.alloc(width * height * 4);
  const points = [
    [10, 70], [20, 42], [29, 68], [40, 48], [51, 58], [64, 35],
    [78, 65], [91, 44], [106, 57], [121, 34], [137, 67], [153, 47],
    [171, 55], [188, 33], [205, 69], [223, 43], [242, 54], [260, 38],
    [286, 64],
  ];
  const drawInk = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= width || py < 0 || py >= height || dx * dx + dy * dy > 4) continue;
        const offset = (py * width + px) * 4;
        pixels[offset] = 28;
        pixels[offset + 1] = 38;
        pixels[offset + 2] = 52;
        pixels[offset + 3] = 255;
      }
    }
  };
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= steps; step += 1) {
      drawInk(
        Math.round(x0 + (x1 - x0) * step / steps),
        Math.round(y0 + (y1 - y0) * step / steps),
      );
    }
  }
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    pixels.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function rasterizePdfPages(pdfBytes: Buffer): Promise<Buffer[]> {
  const directory = await fs.mkdtemp(path.join("/tmp", "brikvest-native-signing-pages-"));
  const pdfPath = path.join(directory, "artifact.pdf");
  const outputPrefix = path.join(directory, "page");
  try {
    await fs.writeFile(pdfPath, pdfBytes, { mode: 0o600, flag: "wx" });
    const result = spawnSync(
      process.env.PDFTOPPM_PATH || "pdftoppm",
      ["-png", "-r", "72", pdfPath, outputPrefix],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (result.status !== 0) throw new Error(result.stderr || "pdftoppm failed");
    const pages = (await fs.readdir(directory))
      .filter((filename) => /^page-\d+\.png$/.test(filename))
      .sort((left, right) =>
        Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]),
      );
    return await Promise.all(pages.map((filename) =>
      fs.readFile(path.join(directory, filename)),
    ));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function pagePixelsDiffer(before: Buffer, after: Buffer): boolean {
  const original = PNG.sync.read(before);
  const signed = PNG.sync.read(after);
  if (original.width !== signed.width || original.height !== signed.height) {
    throw new Error("The signed PDF changed an unsigned page's rendered geometry.");
  }
  return original.data.some((pixel, index) => pixel !== signed.data[index]);
}

async function extractPdfText(pdfBytes: Buffer): Promise<string> {
  const directory = await fs.mkdtemp(path.join("/tmp", "brikvest-native-signing-text-"));
  const pdfPath = path.join(directory, "artifact.pdf");
  try {
    await fs.writeFile(pdfPath, pdfBytes, { mode: 0o600, flag: "wx" });
    const result = spawnSync(
      process.env.PDFTOTEXT_PATH || "pdftotext",
      ["-enc", "UTF-8", pdfPath, "-"],
      { encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (result.status !== 0) throw new Error(result.stderr || "pdftotext failed");
    return result.stdout;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function seedIsolatedDatabase(installLegalSchema = true): Promise<void> {
  const passwordHash = await (await import("../server/auth")).hashPassword(verifiedInvestorPassword);
  await pglite.exec(`
    CREATE TABLE admin_users (id serial PRIMARY KEY);
    CREATE TABLE users (
      id serial PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password text,
      kyc_status text NOT NULL,
      kyc_full_name text,
      kyc_address text
    );
    CREATE TABLE properties (
      id serial PRIMARY KEY,
      name text NOT NULL,
      location text NOT NULL,
      total_slots integer NOT NULL DEFAULT 0,
      available_slots integer NOT NULL DEFAULT 0,
      total_units integer NOT NULL DEFAULT 100,
      reserved_units integer NOT NULL DEFAULT 0,
      sold_units integer NOT NULL DEFAULT 0
    );
    CREATE TABLE investment_reservations (
      id serial PRIMARY KEY,
      user_id integer REFERENCES users(id),
      property_id integer NOT NULL REFERENCES properties(id),
      units numeric(15,2) NOT NULL,
      amount numeric(20,2) NOT NULL,
      currency text NOT NULL,
      status text NOT NULL,
      funnel_stage text,
      payment_reference text,
      payment_method text,
      notes text,
      expires_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payment_submissions (
      id serial PRIMARY KEY,
      reservation_id integer NOT NULL REFERENCES investment_reservations(id),
      user_id integer NOT NULL REFERENCES users(id),
      amount numeric(20,2) NOT NULL,
      currency text NOT NULL,
      status text NOT NULL,
      reviewed_at timestamptz,
      reviewed_by_admin_id integer REFERENCES admin_users(id)
    );

    INSERT INTO admin_users DEFAULT VALUES;
    INSERT INTO users (email, password, kyc_status, kyc_full_name, kyc_address)
      VALUES ('verified.investor@example.test', '${passwordHash}', 'approved',
              '${verifiedInvestorName.replace(/'/g, "''")}',
              '${verifiedInvestorAddress.replace(/'/g, "''")}');
    INSERT INTO properties (
      name, location, total_units, reserved_units, sold_units
    ) VALUES ('SD118', 'Abuja', 100, 1, 0);
  `);

  const ids = await pglite.query<{
    user_id: number;
    property_id: number;
    admin_id: number;
  }>(`
    SELECT
      (SELECT id FROM users WHERE email = 'verified.investor@example.test') AS user_id,
      (SELECT id FROM properties WHERE name = 'SD118') AS property_id,
      (SELECT id FROM admin_users LIMIT 1) AS admin_id
  `);
  ownerId = ids.rows[0].user_id;
  adminId = ids.rows[0].admin_id;

  const reservation = await pglite.query<{ id: number }>(`
    INSERT INTO investment_reservations
      (user_id, property_id, units, amount, currency, status)
    VALUES (${ownerId}, ${ids.rows[0].property_id}, 1, 1000000.50, 'NGN', 'reserved')
    RETURNING id
  `);
  reservationId = reservation.rows[0].id;
  const submission = await pglite.query<{ id: number }>(`
    INSERT INTO payment_submissions
      (reservation_id, user_id, amount, currency, status)
    VALUES (${reservationId}, ${ownerId}, 1000000.50, 'NGN', 'pending_admin_review')
    RETURNING id
  `);
  submissionId = submission.rows[0].id;

  if (!installLegalSchema) return;

  await pglite.exec(await fs.readFile(
    "scripts/ensure-investment-reservation-inventory-accounting.sql",
    "utf8",
  ));
  await pglite.exec(await fs.readFile("scripts/ensure-legal-documents.sql", "utf8"));
  await pglite.exec(await fs.readFile("scripts/ensure-legal-local-signing.sql", "utf8"));
  await pglite.exec(await fs.readFile("scripts/ensure-legal-notification-cycles.sql", "utf8"));

  await pglite.query(`
    INSERT INTO legal_property_bindings
      (property_id, document_scope, enabled, square_meters_per_unit, note, bound_by_admin_id)
    VALUES (${ids.rows[0].property_id}, 'SD118', true, 5, 'E2E exact SD118 property binding', ${adminId})
  `);
  await pglite.query(`
    INSERT INTO legal_templates (
      document_type, version, original_filename, storage_key, sha256, byte_size,
      validation_status, is_active, created_by_admin_id, activated_at
    ) VALUES
      ('deed_of_assignment', 1, 'deed.docx', 'legal/templates/deed_of_assignment/v1',
       '${sha256(deedTemplate)}', ${deedTemplate.length}, 'valid', true, ${adminId}, now()),
      ('transfer_exit_rights', 1, 'transfer.docx', 'legal/templates/transfer_exit_rights/v1',
       '${sha256(transferTemplate)}', ${transferTemplate.length}, 'valid', true, ${adminId}, now())
  `);
  await pglite.exec(await fs.readFile("scripts/ensure-legal-property-templates.sql", "utf8"));
}

beforeEach(async () => {
  await pglite?.close();
  pglite = new PGlite();
  testDb = drizzle(pglite);
  databaseRef.current = testDb;
  storage = new Map();
  templateObjects.contents.clear();
  templateObjects.reads.length = 0;
  process.env.PRIVATE_OBJECT_DIR = "/isolated-legal-e2e/.private";
  process.env.APP_BASE_URL = "https://brikvest.example";
  await seedIsolatedDatabase();
});

afterAll(async () => {
  await pglite?.close();
});

describe("isolated legal approval-to-signing E2E (PGlite)", () => {
  it("keeps legacy payment approval working before legal migrations and returns a schema notice", async () => {
    await pglite.close();
    pglite = new PGlite();
    testDb = drizzle(pglite);
    databaseRef.current = testDb;
    await seedIsolatedDatabase(false);

    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const result = await approvePaymentSubmissionAtomically(submissionId, adminId);
    expect(result.legal).toMatchObject({
      eligible: false,
      reason: "workflow_schema_not_installed",
    });
    const legacyState = await pglite.query<{
      payment_status: string;
      reservation_status: string;
      reserved_units: string;
      sold_units: string;
    }>(`
      SELECT ps.status AS payment_status, r.status AS reservation_status,
        p.reserved_units::text, p.sold_units::text
      FROM payment_submissions ps
      JOIN investment_reservations r ON r.id = ps.reservation_id
      JOIN properties p ON p.id = r.property_id
      WHERE ps.id = ${submissionId}
    `);
    expect(legacyState.rows[0]).toEqual({
      payment_status: "approved",
      reservation_status: "converted_to_investment",
      reserved_units: "0",
      sold_units: "1",
    });

    const { recordLegalApprovalBlock } = await import("../server/legal/repository");
    const blockNotice = await testDb.transaction((tx) => recordLegalApprovalBlock(tx as never, {
      reservationId,
      adminId,
      source: "payment_submission",
      sourceId: submissionId,
      reason: "workflow_schema_not_installed",
    }));
    expect(blockNotice).toBe("workflow_schema_not_installed");
  });

  it("never borrows another property's active templates and recovers only with its own pair", async () => {
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const firstApproval = await approvePaymentSubmissionAtomically(submissionId, adminId);
    expect(firstApproval.legal.status).toBe("queued");
    const other = await pglite.query<{ id: number }>(`
      INSERT INTO properties (name, location) VALUES ('Other property', 'Abuja') RETURNING id
    `);
    const otherId = other.rows[0].id;
    for (const [documentType, docxBuffer] of [
      ["deed_of_assignment", deedTemplate],
      ["transfer_exit_rights", transferTemplate],
    ] as const) {
      expect(await storeLegalTemplateVersion({ documentType, docxBuffer, version: 1 }))
        .toBe(`legal/templates/${documentType}/v1`);
      expect(await storeLegalTemplateVersion({
        documentType, docxBuffer, version: 2, propertyId: otherId,
        uploadId: "00000000-0000-4000-8000-000000000001",
      })).toBe(`legal/templates/properties/${otherId}/${documentType}/v2/00000000-0000-4000-8000-000000000001`);
    }
    const holding = await pglite.query<{ id: number }>(`
      INSERT INTO investment_reservations (user_id, property_id, units, amount, currency, status)
      VALUES (${ownerId}, ${otherId}, 1, 1000000.50, 'NGN', 'reserved') RETURNING id
    `);
    const payment = await pglite.query<{ id: number }>(`
      INSERT INTO payment_submissions (reservation_id, user_id, amount, currency, status)
      VALUES (${holding.rows[0].id}, ${ownerId}, 1000000.50, 'NGN', 'pending_admin_review') RETURNING id
    `);
    const { pinActiveTemplatesAndQueue } = await import("../server/legal/repository");
    const approval = await approvePaymentSubmissionAtomically(payment.rows[0].id, adminId);
    expect(approval.legal).toMatchObject({ eligible: true, status: "awaiting_templates" });
    const pairId = approval.legal.pairId!;
    expect(await testDb.transaction((tx) => pinActiveTemplatesAndQueue(pairId, adminId, tx))).toBe(false);
    const frozen = await pglite.query<{ property_area_sqm: string; data_snapshot: unknown }>(
      `SELECT property_area_sqm, data_snapshot FROM legal_document_pairs WHERE id = ${pairId}`,
    );
    expect(Number(frozen.rows[0].property_area_sqm)).toBe(5);
    await pglite.query(`
      INSERT INTO legal_templates
        (property_id, document_type, version, original_filename, storage_key, sha256, byte_size,
         validation_status, is_active, created_by_admin_id)
      SELECT ${otherId}, document_type, 2, original_filename,
        'legal/templates/properties/${otherId}/' || document_type || '/v2/00000000-0000-4000-8000-000000000001',
        sha256, byte_size, 'valid', true, ${adminId} FROM legal_templates WHERE version = 1
    `);
    expect(await testDb.transaction((tx) => pinActiveTemplatesAndQueue(pairId, adminId, tx))).toBe(true);
    const recovered = await pglite.query<{ property_id: number; data_snapshot: unknown }>(`
      SELECT t.property_id, p.data_snapshot FROM legal_document_pairs p
      JOIN legal_templates t ON t.id IN (p.deed_template_id, p.transfer_template_id)
      WHERE p.id = ${pairId}
    `);
    expect(recovered.rows).toHaveLength(2);
    expect(recovered.rows.every((row) => row.property_id === otherId)).toBe(true);
    expect(recovered.rows[0].data_snapshot).toEqual(frozen.rows[0].data_snapshot);
    // Exercise real repository selection, rendering and PDF conversion for both
    // properties, using test-only template bytes and entirely in-memory files.
    const { createLegalWorker } = await import("../server/legal/worker");
    const { prepareDocxForPdf, convertDocxToPdf } = await import("../server/legal/converter");
    const worker = createLegalWorker({
      // This existing E2E exercises original-layout signing and crash recovery.
      // Controlled available-font resolution retains that branch; dedicated
      // serif tests exercise unavailable fonts under normal environment policy.
      prepareDocxForPdf: (bytes) => prepareDocxForPdf(bytes, (family) => family),
      convertDocxToPdf: (bytes, options) => convertDocxToPdf(bytes, { ...options, resolveFontFamily: (family) => family }),
      readLegalDocument: async (key) => {
        const bytes = storage.get(key);
        if (!bytes) throw new LegalFileNotFoundError();
        return bytes;
      },
      storeLegalDocument: async (input) => {
        const key = `legal/documents/${input.recordKey}/${input.kind}` as LegalStorageReference;
        if (storage.has(key)) throw new LegalFileAlreadyExistsError();
        storage.set(key, input.contents);
        return key;
      },
      sendEmail: async () => { throw new Error("This generation test must not send mail"); },
    });
    expect(await worker.dispatchLegalJobs(2)).toMatchObject({ claimed: 2, completed: 2, failed: 0 });
    expect(templateObjects.reads).toEqual([
      ".private/legal/templates/deed_of_assignment/v1.docx",
      ".private/legal/templates/transfer_exit_rights/v1.docx",
      `.private/legal/templates/properties/${otherId}/deed_of_assignment/v2/00000000-0000-4000-8000-000000000001.docx`,
      `.private/legal/templates/properties/${otherId}/transfer_exit_rights/v2/00000000-0000-4000-8000-000000000001.docx`,
    ]);
  }, 120_000);

  it("fills a missing template pin without replacing the historical pinned side", async () => {
    // Simulate a legacy partial record from a schema without the newer pair
    // constraint; new approvals deliberately pin both templates or neither.
    await pglite.query(`ALTER TABLE legal_document_pairs DROP CONSTRAINT legal_pair_templates_both_or_neither`);
    await pglite.query(`UPDATE legal_templates SET is_active = false WHERE document_type = 'transfer_exit_rights'`);
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const { pinActiveTemplatesAndQueue } = await import("../server/legal/repository");
    const approval = await approvePaymentSubmissionAtomically(submissionId, adminId);
    const pairId = approval.legal.pairId!;
    expect(approval.legal.status).toBe("awaiting_templates");
    await pglite.query(`UPDATE legal_document_pairs SET deed_template_id =
      (SELECT id FROM legal_templates WHERE document_type = 'deed_of_assignment' AND version = 1)
      WHERE id = ${pairId}`);
    const before = await pglite.query<{ deed_template_id: number }>(`SELECT deed_template_id FROM legal_document_pairs WHERE id = ${pairId}`);
    await pglite.query(`UPDATE legal_templates SET is_active = (document_type = 'transfer_exit_rights')`);
    expect(await testDb.transaction((tx) => pinActiveTemplatesAndQueue(pairId, adminId, tx))).toBe(true);
    const after = await pglite.query<{ deed_template_id: number; transfer_template_id: number }>(
      `SELECT deed_template_id, transfer_template_id FROM legal_document_pairs WHERE id = ${pairId}`,
    );
    expect(after.rows[0].deed_template_id).toBe(before.rows[0].deed_template_id);
    expect(after.rows[0].transfer_template_id).toBeTruthy();
  });

  it("leaves both pins empty when a property has only one active template", async () => {
    await pglite.query(`UPDATE legal_templates SET is_active = false WHERE document_type = 'transfer_exit_rights'`);
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const approval = await approvePaymentSubmissionAtomically(submissionId, adminId);
    expect(approval.legal).toMatchObject({ eligible: true, status: "awaiting_templates" });
    const pins = await pglite.query(`SELECT deed_template_id, transfer_template_id FROM legal_document_pairs WHERE id = ${approval.legal.pairId}`);
    expect(pins.rows[0]).toEqual({ deed_template_id: null, transfer_template_id: null });
  });

  it("approves a property without any area binding", async () => {
    await pglite.query("DELETE FROM legal_property_bindings");
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const result = await approvePaymentSubmissionAtomically(submissionId, adminId);
    expect(result.legal).toMatchObject({
      eligible: true,
      status: "queued",
    });
    const status = await pglite.query<{ status: string }>(`
      SELECT status FROM payment_submissions WHERE id = ${submissionId}
    `);
    expect(status.rows[0].status).toBe("approved");
  });

  it("installs local signing persistence without requiring historical provider tables", async () => {
    await pglite.exec(await fs.readFile("scripts/ensure-legal-local-signing.sql", "utf8"));
    const tables = await pglite.query<{
      historical_table: string | null;
      local_table: string | null;
    }>(`
      SELECT to_regclass('public.legal_signing_operations')::text AS historical_table,
        to_regclass('public.local_legal_signing_operations')::text AS local_table
    `);
    expect(tables.rows[0]).toEqual({
      historical_table: null,
      local_table: "local_legal_signing_operations",
    });
    const triggers = await pglite.query<{ trigger_name: string }>(`
      SELECT tgname AS trigger_name
      FROM pg_trigger
      WHERE tgrelid = 'local_legal_signing_operations'::regclass
        AND NOT tgisinternal
      ORDER BY tgname
    `);
    expect(triggers.rows.map((row) => row.trigger_name)).toContain(
      "local_legal_signing_operations_immutable",
    );

    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const approval = await approvePaymentSubmissionAtomically(submissionId, adminId);
    const document = resultRows<Record<string, number>>(await testDb.execute(sql`
      SELECT id, template_id FROM legal_documents WHERE pair_id = ${approval.legal.pairId}
      ORDER BY id LIMIT 1
    `))[0];
    const operation = await pglite.query<{ id: number }>(`
      INSERT INTO local_legal_signing_operations (
        document_id, pair_id, user_id, template_id, signer_name, signer_email,
        unsigned_pdf_sha256, signature_placement, signed_pdf_record_key,
        certificate_record_key
      ) VALUES (
        ${document.id}, ${approval.legal.pairId}, ${ownerId}, ${document.template_id},
        '${verifiedInvestorName.replace(/'/g, "''")}', 'verified.investor@example.test',
        '${"a".repeat(64)}', '{"pageNumber": 1}', '${randomUUID()}', '${randomUUID()}'
      ) RETURNING id
    `);
    const operationId = operation.rows[0].id;
    await pglite.query(`
      UPDATE local_legal_signing_operations
      SET challenge_hash = '${"b".repeat(64)}',
          challenge_expires_at = now() + interval '5 minutes',
          failed_auth_attempts = 1
      WHERE id = ${operationId}
    `);
    const png = Buffer.from("fixture signature png");
    await pglite.query(`
      UPDATE local_legal_signing_operations SET
        status = 'accepted',
        consent_version = 'legal-signing-v1',
        consent_text = 'I agree to sign this document electronically.',
        accepted_at = now(),
        reauthenticated_at = now(),
        evidence_snapshot = '{"typedName":"${verifiedInvestorName.replace(/'/g, "''")}"}',
        evidence_sha256 = '${sha256(Buffer.from(`{"typedName":"${verifiedInvestorName}"}`))}',
        signature_png_base64 = '${png.toString("base64")}',
        signature_sha256 = '${sha256(png)}'
      WHERE id = ${operationId}
    `);
    await expect(pglite.query(`
      UPDATE local_legal_signing_operations
      SET consent_text = 'rewritten consent' WHERE id = ${operationId}
    `)).rejects.toThrow(/consent, authentication, and evidence are immutable/i);
    await pglite.query(`
      UPDATE local_legal_signing_operations
      SET status = 'signing', lease_token = '${randomUUID()}',
          lease_until = now() + interval '1 minute'
      WHERE id = ${operationId}
    `);
    await pglite.query(`
      UPDATE local_legal_signing_operations
      SET status = 'completed', lease_token = NULL, lease_until = NULL,
          signed_pdf_sha256 = '${"c".repeat(64)}',
          certificate_sha256 = '${"d".repeat(64)}', completed_at = now()
      WHERE id = ${operationId}
    `);
    await expect(pglite.query(`
      UPDATE local_legal_signing_operations
      SET last_error = 'rewritten' WHERE id = ${operationId}
    `)).rejects.toThrow(/completed local legal signing operations are immutable/i);
    await expect(pglite.query(`
      DELETE FROM local_legal_signing_operations WHERE id = ${operationId}
    `)).rejects.toThrow(/cannot be deleted/i);
  });

  it("preserves historical provider signing guards when the optional migration is present", async () => {
    await pglite.exec(await fs.readFile("scripts/ensure-legal-signing.sql", "utf8"));
    await pglite.exec(await fs.readFile("scripts/ensure-legal-local-signing.sql", "utf8"));
    const tables = await pglite.query<{
      historical_table: string | null;
      local_table: string | null;
    }>(`
      SELECT to_regclass('public.legal_signing_operations')::text AS historical_table,
        to_regclass('public.local_legal_signing_operations')::text AS local_table
    `);
    expect(tables.rows[0]).toEqual({
      historical_table: "legal_signing_operations",
      local_table: "local_legal_signing_operations",
    });
    const triggers = await pglite.query<{ trigger_name: string }>(`
      SELECT tgname AS trigger_name
      FROM pg_trigger
      WHERE tgrelid = 'legal_signing_operations'::regclass
        AND NOT tgisinternal
    `);
    expect(triggers.rows.map((row) => row.trigger_name)).toContain(
      "legal_signing_operations_immutable",
    );
    const localTriggers = await pglite.query<{ trigger_name: string }>(`
      SELECT tgname AS trigger_name
      FROM pg_trigger
      WHERE tgrelid = 'local_legal_signing_operations'::regclass
        AND NOT tgisinternal
    `);
    expect(localTriggers.rows.map((row) => row.trigger_name)).toContain(
      "local_legal_signing_operations_immutable",
    );
  });

  it("fails closed on fractional units in every atomic approval path without changing payment or counters", async () => {
    await pglite.query(`
      UPDATE investment_reservations SET units = 0.25 WHERE id = ${reservationId}
    `);
    const {
      approvePaymentSubmissionAtomically,
      confirmInvestmentAtomically,
      reinstateInvestmentAtomically,
    } = await import("../server/legal/approval");
    const fractionalUnitsError = /fractional units cannot be approved.*whole units/i;

    await expect(approvePaymentSubmissionAtomically(submissionId, adminId))
      .rejects.toThrow(fractionalUnitsError);
    const afterPaymentAttempt = await pglite.query<{
      payment_status: string;
      reservation_status: string;
      reservation_units: string;
      reserved_units: number;
      sold_units: number;
    }>(`
      SELECT ps.status AS payment_status, r.status AS reservation_status,
        r.units::text AS reservation_units, p.reserved_units, p.sold_units
      FROM payment_submissions ps
      JOIN investment_reservations r ON r.id = ps.reservation_id
      JOIN properties p ON p.id = r.property_id
      WHERE ps.id = ${submissionId}
    `);
    expect(afterPaymentAttempt.rows[0]).toEqual({
      payment_status: "pending_admin_review",
      reservation_status: "reserved",
      reservation_units: "0.25",
      reserved_units: 1,
      sold_units: 0,
    });

    await expect(confirmInvestmentAtomically(reservationId, adminId))
      .rejects.toThrow(fractionalUnitsError);
    const afterConfirmAttempt = await pglite.query<{
      reservation_status: string;
      reservation_units: string;
      reserved_units: number;
      sold_units: number;
    }>(`
      SELECT r.status AS reservation_status, r.units::text AS reservation_units,
        p.reserved_units, p.sold_units
      FROM investment_reservations r
      JOIN properties p ON p.id = r.property_id
      WHERE r.id = ${reservationId}
    `);
    expect(afterConfirmAttempt.rows[0]).toEqual({
      reservation_status: "reserved",
      reservation_units: "0.25",
      reserved_units: 1,
      sold_units: 0,
    });

    await pglite.query(`
      UPDATE investment_reservations SET status = 'expired' WHERE id = ${reservationId}
    `);
    await expect(reinstateInvestmentAtomically(
      reservationId,
      adminId,
      "E2E-FRACTIONAL-REFERENCE",
      "bank_transfer",
      "Do not allocate a fractional holding into integer inventory counters",
    )).rejects.toThrow(fractionalUnitsError);
    const afterReinstateAttempt = await pglite.query<{
      payment_status: string;
      reservation_status: string;
      reservation_units: string;
      reserved_units: number;
      sold_units: number;
    }>(`
      SELECT ps.status AS payment_status, r.status AS reservation_status,
        r.units::text AS reservation_units, p.reserved_units, p.sold_units
      FROM payment_submissions ps
      JOIN investment_reservations r ON r.id = ps.reservation_id
      JOIN properties p ON p.id = r.property_id
      WHERE ps.id = ${submissionId}
    `);
    expect(afterReinstateAttempt.rows[0]).toEqual({
      payment_status: "pending_admin_review",
      reservation_status: "expired",
      reservation_units: "0.25",
      reserved_units: 1,
      sold_units: 0,
    });
  });

  it("approves exactly once, freezes kobo values, retries a partial real conversion, and completes signing", async () => {
    const { approvePaymentSubmissionAtomically } = await import("../server/legal/approval");
    const approvals = await Promise.allSettled([
      approvePaymentSubmissionAtomically(submissionId, adminId),
      approvePaymentSubmissionAtomically(submissionId, adminId),
    ]);
    const committed = approvals.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof approvePaymentSubmissionAtomically>>> =>
        result.status === "fulfilled",
    );
    expect(committed).toHaveLength(1);
    expect(approvals.filter((result) => result.status === "rejected")).toHaveLength(1);
    const approval = committed[0].value;
    expect(approval.legal).toMatchObject({
      eligible: true,
      status: "queued",
    });
    const pairId = approval.legal.pairId!;

    const pair = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT * FROM legal_document_pairs WHERE id = ${pairId}
    `))[0];
    expect(pair).toMatchObject({
      reservation_id: reservationId,
      user_id: ownerId,
      full_name_snapshot: verifiedInvestorName,
      home_address_snapshot: verifiedInvestorAddress,
      units_snapshot: "1.00",
      square_meters_per_unit: "5.00",
      property_area_sqm: "5.00",
      payment_amount_naira: "1000000.50",
      payment_currency: "NGN",
      approval_source: "payment_submission",
      approval_source_id: submissionId,
    });
    const propertyCounts = await pglite.query<{
      reserved_units: string;
      sold_units: string;
    }>(`
      SELECT reserved_units::text, sold_units::text FROM properties WHERE name = 'SD118'
    `);
    expect(propertyCounts.rows[0]).toEqual({ reserved_units: "0", sold_units: "1" });
    const outbox = await pglite.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM legal_jobs
      WHERE pair_id = ${pairId} AND kind = 'generation' AND status = 'queued'
    `);
    expect(outbox.rows[0].count).toBe(1);
    const documents = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT * FROM legal_documents WHERE pair_id = ${pairId} ORDER BY document_type
    `));
    expect(documents).toHaveLength(2);

    // Active templates may advance after payment approval; the durable pair
    // must continue to render the exact versions pinned at approval time.
    await pglite.query(`
      UPDATE legal_templates SET is_active = false WHERE is_active = true
    `);
    await pglite.query(`
      INSERT INTO legal_templates (
        property_id, document_type, version, original_filename, storage_key, sha256, byte_size,
        validation_status, is_active, created_by_admin_id, activated_at
      ) VALUES
        ((SELECT property_id FROM investment_reservations WHERE id = ${reservationId}), 'deed_of_assignment', 2, 'deed-v2.docx', 'legal/templates/deed_of_assignment/v2',
         '${sha256(deedTemplate)}', ${deedTemplate.length}, 'valid', true, ${adminId}, now()),
        ((SELECT property_id FROM investment_reservations WHERE id = ${reservationId}), 'transfer_exit_rights', 2, 'transfer-v2.docx', 'legal/templates/transfer_exit_rights/v2',
         '${sha256(transferTemplate)}', ${transferTemplate.length}, 'valid', true, ${adminId}, now())
    `);
    const pinnedIds = await pglite.query<{
      deed_template_id: number;
      transfer_template_id: number;
    }>(`
      SELECT deed_template_id, transfer_template_id
      FROM legal_document_pairs WHERE id = ${pairId}
    `);
    const oldTemplateIds = documents.map((document) => document.template_id).sort();
    expect([
      pinnedIds.rows[0].deed_template_id,
      pinnedIds.rows[0].transfer_template_id,
    ].sort()).toEqual(oldTemplateIds);

    const { createLegalWorker } = await import("../server/legal/worker");
    const { convertDocxToPdf, prepareDocxForPdf, verifyAssigneeSignaturePosition } =
      await import("../server/legal/converter");
    const { renderLegalTemplate, validateLegalTemplate } =
      await import("../server/legal/templates");
    const templateBytes = new Map<string, Buffer>([
      ["legal/templates/deed_of_assignment/v1", deedTemplate],
      ["legal/templates/transfer_exit_rights/v1", transferTemplate],
      ["legal/templates/deed_of_assignment/v2", deedTemplate],
      ["legal/templates/transfer_exit_rights/v2", transferTemplate],
    ]);
    const templateReads: string[] = [];
    let conversionCount = 0;
    const failingConversion = async (
      docx: Buffer,
      options?: ConvertDocxToPdfOptions,
    ): Promise<Buffer> => {
      conversionCount += 1;
      if (conversionCount === 2) {
        throw new Error("simulated worker crash after persisting the first document");
      }
      return convertDocxToPdf(docx, { ...options, resolveFontFamily: (family) => family });
    };
    const readLegalDocument = async (
      reference: string,
      kind: LegalDocumentFileKind,
    ): Promise<Buffer> => {
      if (kind === "source_docx" || kind === "unsigned_pdf") {
        const contents = storage.get(reference);
        if (!contents) throw new LegalFileNotFoundError();
        return contents;
      }
      const contents = storage.get(reference);
      if (!contents) throw new LegalFileNotFoundError();
      return contents;
    };
    const storeLegalDocument = async (
      options: StoreLegalDocumentOptions,
    ): Promise<LegalStorageReference> => {
      const reference =
        `legal/documents/${options.recordKey}/${options.kind}` as LegalStorageReference;
      if (storage.has(reference)) throw new LegalFileAlreadyExistsError();
      storage.set(reference, options.contents);
      return reference;
    };
    const worker = createLegalWorker({
      prepareDocxForPdf: (bytes) => prepareDocxForPdf(bytes, (family) => family),
      readLegalTemplateVersion: async (key) => {
        templateReads.push(key);
        const bytes = templateBytes.get(key);
        if (!bytes) throw new Error(`Missing in-memory pinned template ${key}`);
        return bytes;
      },
      readLegalDocument,
      storeLegalDocument,
      convertDocxToPdf: failingConversion,
      verifyAssigneeSignaturePosition,
      renderLegalTemplate,
      validateLegalTemplate,
      sendEmail: async () => true,
    });

    const firstAttempt = await worker.dispatchLegalJobs(1);
    expect(firstAttempt).toMatchObject({ claimed: 1, completed: 0, failed: 1 });
    const firstFailure = await pglite.query<{ last_error: string | null }>(`
      SELECT last_error FROM legal_jobs WHERE pair_id = ${pairId} AND kind = 'generation'
    `);
    expect(storage.size, firstFailure.rows[0].last_error ?? "no persisted worker error").toBe(3);
    expect(templateReads).toEqual([
      "legal/templates/deed_of_assignment/v1",
      "legal/templates/transfer_exit_rights/v1",
    ]);
    const partialRows = resultRows<Record<string, unknown>>(await testDb.execute(sql`
      SELECT source_docx_key, unsigned_pdf_key
      FROM legal_documents WHERE pair_id = ${pairId}
    `));
    expect(partialRows).toHaveLength(2);
    expect(partialRows.every((document) =>
      document.source_docx_key == null && document.unsigned_pdf_key == null,
    )).toBe(true);

    await pglite.query(`
      UPDATE legal_jobs SET available_at = now()
      WHERE pair_id = ${pairId} AND kind = 'generation' AND status = 'retry'
    `);
    const recoveredWorker = createLegalWorker({
      prepareDocxForPdf: (bytes) => prepareDocxForPdf(bytes, (family) => family),
      readLegalTemplateVersion: async (key) => {
        templateReads.push(key);
        const bytes = templateBytes.get(key);
        if (!bytes) throw new Error(`Missing in-memory pinned template ${key}`);
        return bytes;
      },
      readLegalDocument,
      storeLegalDocument,
      convertDocxToPdf: (bytes, options) => convertDocxToPdf(bytes, { ...options, resolveFontFamily: (family) => family }),
      verifyAssigneeSignaturePosition,
      renderLegalTemplate,
      validateLegalTemplate,
      sendEmail: async () => true,
    });
    const retry = await recoveredWorker.dispatchLegalJobs(1);
    expect(retry).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(storage.size).toBe(4);
    const readyPair = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT status, documents_ready_at FROM legal_document_pairs WHERE id = ${pairId}
    `))[0];
    expect(readyPair.status).toBe("documents_ready");
    expect(readyPair.documents_ready_at).toBeTruthy();
    const readyDocuments = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT * FROM legal_documents WHERE pair_id = ${pairId} ORDER BY document_type
    `));
    expect(readyDocuments).toHaveLength(2);
    expect(readyDocuments.every((document) =>
      document.source_docx_key?.startsWith("legal/documents/") &&
      document.unsigned_pdf_key?.startsWith("legal/documents/") &&
      /^[a-f0-9]{64}$/.test(document.unsigned_pdf_sha256),
    )).toBe(true);
    const deedPlacement = readyDocuments.find(
      (document) => document.document_type === "deed_of_assignment",
    )?.signature_placement as Record<string, unknown>;
    expect(deedPlacement.signatureHeadingPageNumber).toBe(
      Number(deedPlacement.pageNumber) - 1,
    );

    const deedDocx = storage.get(readyDocuments.find(
      (document) => document.document_type === "deed_of_assignment",
    )!.source_docx_key)!;
    const deedText = visibleDocxText(deedDocx);
    expect(deedText).toContain(verifiedInvestorName);
    expect(deedText).toContain("MEASURING 5 (m²)");
    expect(deedText).toContain("1,000,000.50");
    expect(deedText).toContain("One Million and Fifty Hundredths of a Naira");

    const localSigning = await import("../server/legal/local-signing");
    const { comparePasswords } = await import("../server/auth");
    const signingDependencies = {
      db: testDb as never,
      comparePasswords,
      readLegalDocument,
      storeLegalDocument,
      verifyAssigneeSignaturePosition,
    };
    const signingWorker = createLegalWorker({
      readLegalDocument,
      storeLegalDocument,
      sendEmail: async () => true,
      reconcilePairSigning: (id) =>
        localSigning.reconcileLocalPairSigning(id, signingDependencies),
    });
    const otherUser = await pglite.query<{ id: number }>(`
      INSERT INTO users (email, kyc_status)
      VALUES ('other.user@example.test', 'approved') RETURNING id
    `);
    const deedDocumentId = Number(readyDocuments.find(
      (document) => document.document_type === "deed_of_assignment",
    )!.id);
    await expect(localSigning.beginLocalSigning(
      deedDocumentId,
      otherUser.rows[0].id,
      signingDependencies,
    )).rejects.toMatchObject({ statusCode: 404 });
    expect((await pglite.query<{ installed: boolean }>(`
      SELECT to_regclass('public.legal_signing_operations') IS NOT NULL AS installed
    `)).rows[0].installed).toBe(false);

    const signaturePng = createNonblankSignaturePng();
    const signatureDataUrl = `data:image/png;base64,${signaturePng.toString("base64")}`;
    const deedSession = await localSigning.beginLocalSigning(
      deedDocumentId,
      ownerId,
      signingDependencies,
    );
    expect(deedSession).toMatchObject({
      documentId: deedDocumentId,
      signerName: verifiedInvestorName,
    });
    await pglite.query(`
      UPDATE local_legal_signing_operations
      SET challenge_expires_at = now() - interval '1 second'
      WHERE id = ${deedSession.operationId}
    `);
    const bodyFor = (session: typeof deedSession, password = verifiedInvestorPassword) => ({
      challengeToken: session.challengeToken,
      password,
      typedName: session.signerName,
      consent: true,
      reviewed: true,
      consentVersion: session.consentVersion,
      unsignedPdfSha256: session.unsignedPdfSha256,
      signaturePng: signatureDataUrl,
      signatureMethod: "drawn",
    });
    await expect(localSigning.completeLocalSigning(
      deedDocumentId,
      ownerId,
      bodyFor(deedSession),
      { ip: "192.0.2.24", userAgent: "Fictional investor signing E2E" },
      signingDependencies,
    )).rejects.toMatchObject({ statusCode: 409 });

    const freshDeedSession = await localSigning.beginLocalSigning(
      deedDocumentId,
      ownerId,
      signingDependencies,
    );
    await expect(localSigning.completeLocalSigning(
      deedDocumentId,
      ownerId,
      bodyFor(freshDeedSession, "incorrect-native-signing-password"),
      { ip: "192.0.2.24", userAgent: "Fictional investor signing E2E" },
      signingDependencies,
    )).rejects.toMatchObject({ statusCode: 401 });
    const failedAuthDraft = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT status, failed_auth_attempts FROM local_legal_signing_operations
      WHERE id = ${freshDeedSession.operationId}
    `))[0];
    expect(failedAuthDraft).toEqual({ status: "draft", failed_auth_attempts: 1 });

    const storedReferences = new Map<string, number>();
    let failCertificateOnce = true;
    const storeWithOneCrash = async (options: StoreLegalDocumentOptions): Promise<LegalStorageReference> => {
      const reference = `legal/documents/${options.recordKey}/${options.kind}`;
      storedReferences.set(reference, (storedReferences.get(reference) || 0) + 1);
      if (options.kind === "audit_certificate_pdf" && failCertificateOnce) {
        failCertificateOnce = false;
        throw new Error("simulated signing worker crash after persisting the signed PDF");
      }
      return storeLegalDocument(options);
    };
    signingDependencies.storeLegalDocument = storeWithOneCrash;
    await expect(localSigning.completeLocalSigning(
      deedDocumentId,
      ownerId,
      bodyFor(freshDeedSession),
      { ip: "192.0.2.24", userAgent: "Fictional investor signing E2E" },
      signingDependencies,
    )).rejects.toThrow(/simulated signing worker crash/i);
    const acceptedOperation = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT * FROM local_legal_signing_operations WHERE id = ${freshDeedSession.operationId}
    `))[0];
    expect(acceptedOperation).toMatchObject({
      status: "accepted",
      challenge_hash: sha256(Buffer.from(freshDeedSession.challengeToken)),
      consent_version: freshDeedSession.consentVersion,
      consent_text: localSigning.LOCAL_SIGNING_CONSENT_TEXT,
    });
    expect(acceptedOperation.signature_png_base64).toBe(signaturePng.toString("base64"));
    expect(acceptedOperation.signature_sha256).toBe(sha256(signaturePng));
    expect(acceptedOperation.evidence_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(acceptedOperation.accepted_at).toBeTruthy();
    expect(acceptedOperation.reauthenticated_at).toBeTruthy();
    expect(acceptedOperation.evidence_snapshot).toMatchObject({
      signerName: verifiedInvestorName,
      consented: true,
      reviewed: true,
      signatureMethod: "drawn",
    });
    expect(JSON.stringify(acceptedOperation.evidence_snapshot))
      .not.toContain(verifiedInvestorPassword);
    await expect(testDb.execute(sql`
      UPDATE local_legal_signing_operations
      SET signature_png_base64 = 'rewritten'
      WHERE id = ${freshDeedSession.operationId}
    `)).rejects.toThrow(/consent, authentication, and evidence are immutable/i);
    const deedSignedReference =
      `legal/documents/${acceptedOperation.signed_pdf_record_key}/signed_pdf`;
    const signedPdfBeforeRecovery = storage.get(deedSignedReference);
    expect(signedPdfBeforeRecovery?.subarray(0, 5).toString()).toBe("%PDF-");

    const recovery = await signingWorker.dispatchLegalJobs(10);
    expect(recovery.failed).toBe(0);
    const deedOperationAfterRecovery = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT * FROM local_legal_signing_operations WHERE id = ${freshDeedSession.operationId}
    `))[0];
    expect(deedOperationAfterRecovery.status).toBe("completed");
    expect(storage.get(deedSignedReference)).toEqual(signedPdfBeforeRecovery);
    expect(storedReferences.get(deedSignedReference)).toBe(2);
    const certificateReference =
      `legal/documents/${deedOperationAfterRecovery.certificate_record_key}/audit_certificate_pdf`;
    const certificatePdf = storage.get(certificateReference)!;
    expect(certificatePdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sha256(signedPdfBeforeRecovery!)).toBe(deedOperationAfterRecovery.signed_pdf_sha256);
    expect(sha256(certificatePdf)).toBe(deedOperationAfterRecovery.certificate_sha256);
    expect(storedReferences.get(certificateReference)).toBe(2);
    await fs.writeFile("/tmp/legal-native-signed-example.pdf", signedPdfBeforeRecovery!, { mode: 0o600 });
    await fs.writeFile("/tmp/legal-native-audit-example.pdf", certificatePdf, { mode: 0o600 });

    const deedSource = readyDocuments.find((document) => Number(document.id) === deedDocumentId)!;
    const originalUnsignedPdf = storage.get(deedSource.unsigned_pdf_key)!;
    const signedDeedPdf = storage.get(deedSignedReference)!;
    const [unsignedPageImages, signedPageImages] = await Promise.all([
      rasterizePdfPages(originalUnsignedPdf),
      rasterizePdfPages(signedDeedPdf),
    ]);
    expect(signedPageImages).toHaveLength(unsignedPageImages.length);
    const signaturePage = Number(deedSource.signature_placement.pageNumber) - 1;
    expect(signedPageImages.map((page, pageIndex) =>
      pagePixelsDiffer(unsignedPageImages[pageIndex], page),
    )).toEqual(unsignedPageImages.map((_, pageIndex) =>
      pageIndex === signaturePage,
    ));
    const visibleSignedText = (await extractPdfText(signedDeedPdf)).replace(/\s+/g, " ");
    expect(visibleSignedText).toContain(verifiedInvestorName);
    const visibleCertificateText = (await extractPdfText(certificatePdf))
      .replace(/\s+/g, " ");
    expect(visibleCertificateText).toContain(verifiedInvestorName);
    expect(visibleCertificateText).toContain("external execution");

    const replay = await localSigning.completeLocalSigning(
      deedDocumentId,
      ownerId,
      bodyFor(freshDeedSession),
      { ip: "192.0.2.24", userAgent: "Fictional investor signing E2E" },
      signingDependencies,
    );
    expect(replay).toMatchObject({
      status: "investor_signed",
      documentId: deedDocumentId,
      signedPdfSha256: deedOperationAfterRecovery.signed_pdf_sha256,
      certificateSha256: deedOperationAfterRecovery.certificate_sha256,
    });

    const transferDocumentId = Number(readyDocuments.find(
      (document) => document.document_type === "transfer_exit_rights",
    )!.id);
    const transferSession = await localSigning.beginLocalSigning(
      transferDocumentId,
      ownerId,
      signingDependencies,
    );
    const transferBody = bodyFor(transferSession);
    const concurrentResults = await Promise.all([
      localSigning.completeLocalSigning(
        transferDocumentId,
        ownerId,
        transferBody,
        { ip: "192.0.2.24", userAgent: "Fictional investor signing E2E" },
        signingDependencies,
      ),
      localSigning.completeLocalSigning(
        transferDocumentId,
        ownerId,
        transferBody,
        { ip: "192.0.2.24", userAgent: "Fictional investor signing E2E" },
        signingDependencies,
      ),
    ]);
    expect(concurrentResults.every((result) =>
      result.status === "processing" || result.status === "investor_signed",
    )).toBe(true);
    const transferOperation = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT * FROM local_legal_signing_operations WHERE document_id = ${transferDocumentId}
    `))[0];
    expect(transferOperation.status).toBe("completed");
    expect(await pglite.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM local_legal_signing_operations
      WHERE pair_id = ${pairId}
    `).then((result) => result.rows[0].count)).toBe(2);
    const transferPdf = storage.get(
      `legal/documents/${transferOperation.signed_pdf_record_key}/signed_pdf`,
    )!;
    const transferCertificate = storage.get(
      `legal/documents/${transferOperation.certificate_record_key}/audit_certificate_pdf`,
    )!;
    expect(sha256(transferPdf)).toBe(transferOperation.signed_pdf_sha256);
    expect(sha256(transferCertificate)).toBe(transferOperation.certificate_sha256);
    expect((await extractPdfText(transferPdf)).replace(/\s+/g, " "))
      .toContain(verifiedInvestorName);

    const finalPair = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT status, investor_signed_at FROM legal_document_pairs WHERE id = ${pairId}
    `))[0];
    expect(finalPair.status).toBe("investor_signed");
    expect(finalPair.investor_signed_at).toBeTruthy();
    const finalDocuments = resultRows<Record<string, any>>(await testDb.execute(sql`
      SELECT status, signing_provider, signed_pdf_key, signed_pdf_sha256, signing_certificate_key
      FROM legal_documents WHERE pair_id = ${pairId}
    `));
    expect(finalDocuments).toHaveLength(2);
    expect(finalDocuments.every((document) =>
      document.status === "investor_signed" &&
      document.signing_provider === "brikvest_local" &&
      document.signed_pdf_key?.startsWith("legal/documents/") &&
      /^[a-f0-9]{64}$/.test(document.signed_pdf_sha256) &&
      document.signing_certificate_key?.startsWith("legal/documents/"),
    )).toBe(true);

    const finalDocId = Number(readyDocuments[0].id);
    await expect(testDb.execute(sql`
      UPDATE legal_documents SET signed_pdf_key = 'legal/documents/replaced/signed_pdf'
      WHERE id = ${finalDocId}
    `)).rejects.toThrow(/immutable/i);
    await expect(testDb.execute(sql`
      UPDATE legal_document_pairs SET full_name_snapshot = 'Rewritten Investor'
      WHERE id = ${pairId}
    `)).rejects.toThrow(/immutable/i);
    await expect(testDb.execute(sql`
      UPDATE legal_templates SET sha256 = repeat('f', 64)
      WHERE id = ${pinnedIds.rows[0].deed_template_id}
    `)).rejects.toThrow(/immutable/i);
    await expect(testDb.execute(sql`
      UPDATE local_legal_signing_operations SET evidence_snapshot = '{}'::jsonb
      WHERE document_id = ${finalDocId}
    `)).rejects.toThrow(/completed local legal signing operations are immutable/i);
    await expect(testDb.execute(sql`
      DELETE FROM local_legal_signing_operations WHERE document_id = ${finalDocId}
    `)).rejects.toThrow(/cannot be deleted/i);
  }, 120_000);
});