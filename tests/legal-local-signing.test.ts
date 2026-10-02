import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginLocalSigning,
  completeLocalSigning,
  LocalSigningError,
  LOCAL_SIGNING_CONSENT_TEXT,
  LOCAL_SIGNING_CONSENT_VERSION,
  reconcileLocalPairSigning,
} from "../server/legal/local-signing";
import { LegalFileAlreadyExistsError, type LegalStorageReference } from "../server/legal/files";
import { recordUnsignedLegalCancellation } from "../server/legal/holding-state";
import { PNG } from "pngjs";
import {
  convertDocxToPdf,
  verifyAssigneeSignaturePosition,
} from "../server/legal/converter";
import {
  normalizeSuppliedLegalTemplate,
  renderLegalTemplate,
  type LegalDocumentType,
} from "../server/legal/templates";
import { buildLegalTemplateValues } from "../server/legal/values";
import {
  renderLocallySignedPdf as renderActualLocallySignedPdf,
  sha256Hex,
} from "../server/legal/local-pdf-signature";

const databaseRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../server/db", () => ({
  get db() {
    return databaseRef.current;
  },
}));

const ownerEmail = "investor@example.test";
const ownerName = "Ọládélé Ajáyí";
const unsignedPdf = Buffer.from(`%PDF-1.7\n${"local signing unsigned PDF fixture\n".repeat(12)}`);
const unsignedPdfSha256 = createHash("sha256").update(unsignedPdf).digest("hex");
const verifiedPosition = {
  templateVersionId: "deed_of_assignment:v1",
  pageNumber: 1,
  x: 60,
  y: 380,
  width: 120,
  height: 20,
  pageWidth: 612,
  pageHeight: 792,
  coordinateSystem: "pdf-points-top-left" as const,
  anchorText: ownerName,
};

let pglite: PGlite;
let testDb: ReturnType<typeof drizzle>;
let ownerId: number;
let pairId: number;
let reservationId: number;
let adminId: number;
let documentIds: number[];
let storage: Map<string, Buffer>;
let challengeCount: number;
let rendererSha: string;

function createInkPng(width = 320, height = 100): Buffer {
  const png = new PNG({ width, height });
  for (let step = 0; step < 100; step += 1) {
    const x = 20 + step * 2;
    const y = 68 - Math.round(Math.sin(step / 7) * 22);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const index = ((y + dy) * width + (x + dx)) * 4;
        png.data[index] = 28;
        png.data[index + 1] = 38;
        png.data[index + 2] = 52;
        png.data[index + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

const signaturePng = createInkPng();
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const visualFixtureDirectory = path.join(
  process.env.TMPDIR || "/tmp",
  "legal-task-143-image-regression",
);
const sourceFixtures: Record<LegalDocumentType, string> = {
  deed_of_assignment: "attached_assets/DEED_OF_ASSIGNMENT_BRIKVEST_1790828516010.docx",
  transfer_exit_rights: "attached_assets/TRANSFER_AND_EXIT_RIGHT_AGREEMENT_1790828516011.docx",
};

function commandOutput(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed`);
  }
  return result.stdout;
}

function imageCountInPdf(pdfPath: string): number {
  const listing = commandOutput(process.env.PDFIMAGES_PATH || "pdfimages", ["-list", pdfPath]);
  return listing.split(/\r?\n/).filter((line) => /^\s*\d+\s+\d+\s+image\s/.test(line)).length;
}

function imagePageNumbers(pdfPath: string): number[] {
  const listing = commandOutput(process.env.PDFIMAGES_PATH || "pdfimages", ["-list", pdfPath]);
  return Array.from(new Set(
    listing.split(/\r?\n/)
      .filter((line) => /^\s*\d+\s+\d+\s+image\s/.test(line))
      .map((line) => Number(line.trim().split(/\s+/)[0])),
  )).sort((left, right) => left - right);
}

function rasterizePage(pdfPath: string, pageNumber: number, pngPath: string): void {
  commandOutput(process.env.PDFTOPPM_PATH || "pdftoppm", [
    "-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-png", "-r", "36", pdfPath,
    pngPath.replace(/\.png$/i, ""),
  ]);
}

async function assertRasterPreservedOutsideSignature(
  unsignedPath: string,
  signedPath: string,
  placement: {
    pageNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
    pageWidth: number;
    pageHeight: number;
  },
  outputDirectory: string,
): void {
  const pagesToCompare = Array.from(new Set([
    placement.pageNumber,
    ...imagePageNumbers(unsignedPath),
  ])).sort((left, right) => left - right);
  for (const pageNumber of pagesToCompare) {
    const label = pageNumber === placement.pageNumber ? "page" : `image-page-${pageNumber}`;
    const unsignedPngPath = path.join(outputDirectory, `unsigned-${label}.png`);
    const signedPngPath = path.join(outputDirectory, `signed-${label}.png`);
    rasterizePage(unsignedPath, pageNumber, unsignedPngPath);
    rasterizePage(signedPath, pageNumber, signedPngPath);
    const unsigned = PNG.sync.read(await fs.readFile(unsignedPngPath));
    const signed = PNG.sync.read(await fs.readFile(signedPngPath));
    expect(signed.width).toBe(unsigned.width);
    expect(signed.height).toBe(unsigned.height);

    const scaleX = unsigned.width / placement.pageWidth;
    const scaleY = unsigned.height / placement.pageHeight;
    const protectedBox = pageNumber === placement.pageNumber ? {
      left: Math.floor((placement.x - 200) * scaleX),
      right: Math.ceil((placement.x + 200) * scaleX),
      top: Math.floor((placement.y - 38) * scaleY),
      bottom: Math.ceil((placement.y + placement.height + 38) * scaleY),
    } : null;
    let compared = 0;
    let changed = 0;
    for (let y = 0; y < unsigned.height; y += 1) {
      for (let x = 0; x < unsigned.width; x += 1) {
        if (
          protectedBox &&
          x >= protectedBox.left && x <= protectedBox.right &&
          y >= protectedBox.top && y <= protectedBox.bottom
        ) continue;
        const pixel = (y * unsigned.width + x) * 4;
        compared += 1;
        if (!unsigned.data.subarray(pixel, pixel + 4).equals(signed.data.subarray(pixel, pixel + 4))) {
          changed += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(100_000);
    expect(changed).toBe(0);
  }
}

async function seedLegalPair(
  includeLegacyProviderSchema = false,
  sourceDocuments: Partial<Record<LegalDocumentType, {
    pdf: Buffer;
    placement: Awaited<ReturnType<typeof verifyAssigneeSignaturePosition>>;
  }>> = {},
): Promise<void> {
  await pglite.exec(`
    CREATE TABLE admin_users (id serial PRIMARY KEY);
    CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL, password text NOT NULL);
    CREATE TABLE properties (id serial PRIMARY KEY, name text NOT NULL, location text NOT NULL);
    CREATE TABLE investment_reservations (
      id serial PRIMARY KEY,
      user_id integer REFERENCES users(id),
      property_id integer REFERENCES properties(id),
      status text NOT NULL DEFAULT 'reserved',
      funnel_stage text
    );
    CREATE TABLE payment_submissions (id serial PRIMARY KEY);
    INSERT INTO admin_users DEFAULT VALUES;
    INSERT INTO users (email,password) VALUES ('${ownerEmail}','current-password-hash');
    INSERT INTO properties (name,location) VALUES ('Ọjà Heights','Ṣàngótè, Lagos');
    INSERT INTO investment_reservations (user_id,property_id,status,funnel_stage)
    VALUES (1,1,'converted_to_investment','confirmed');
  `);
  await pglite.exec(await fs.readFile("scripts/ensure-legal-documents.sql", "utf8"));
  if (includeLegacyProviderSchema) {
    await pglite.exec(`
      CREATE TABLE legal_signing_operations (
        id serial PRIMARY KEY,
        document_id integer NOT NULL
      );
    `);
  }
  await pglite.exec(await fs.readFile("scripts/ensure-legal-local-signing.sql", "utf8"));

  const ids = await pglite.query<{
    user_id: number;
    property_id: number;
    reservation_id: number;
    admin_id: number;
  }>(`
    SELECT (SELECT id FROM users LIMIT 1) AS user_id,
      (SELECT id FROM properties LIMIT 1) AS property_id,
      (SELECT id FROM investment_reservations LIMIT 1) AS reservation_id,
      (SELECT id FROM admin_users LIMIT 1) AS admin_id
  `);
  const parent = ids.rows[0];
  ownerId = parent.user_id;
  reservationId = parent.reservation_id;
  adminId = parent.admin_id;
  const templates = await pglite.query<{ id: number }>(`
    INSERT INTO legal_templates
      (document_type,version,original_filename,storage_key,sha256,byte_size,
       validation_status,created_by_admin_id)
    VALUES
      ('deed_of_assignment',1,'deed.docx','legal/templates/deed/v1',repeat('a',64),100,'valid',${parent.admin_id}),
      ('transfer_exit_rights',1,'transfer.docx','legal/templates/transfer/v1',repeat('b',64),100,'valid',${parent.admin_id})
    RETURNING id
  `);
  const pair = await pglite.query<{ id: number }>(`
    INSERT INTO legal_document_pairs (
      reservation_id,user_id,property_id,approval_source,approval_source_id,
      approved_by_admin_id,approved_at,effective_at,approval_note,
      full_name_snapshot,home_address_snapshot,property_area_sqm,units_snapshot,
      square_meters_per_unit,payment_amount_naira,payment_currency,
      deed_template_id,transfer_template_id,data_snapshot,status,documents_ready_at
    ) VALUES (
      ${parent.reservation_id},${parent.user_id},${parent.property_id},
      'admin_full_confirmation',${parent.reservation_id},${parent.admin_id},
      now(),now(),'Test approval','${ownerName}','1 Verified Street',10,2,
      5,1000000,'NGN',${templates.rows[0].id},${templates.rows[1].id},
      '{"propertyName":"Ọjà Heights","propertyLocation":"Ṣàngótè, Lagos","units":"2","propertyAreaSqm":"10"}'::jsonb,
      'documents_ready',now()
    ) RETURNING id
  `);
  pairId = pair.rows[0].id;
  const documentValues = ([
    "deed_of_assignment",
    "transfer_exit_rights",
  ] as const).map((documentType, index) => {
    const source = sourceDocuments[documentType];
    const key = `legal/documents/00000000-0000-4000-8000-00000000000${index + 1}/unsigned_pdf`;
    const hash = source ? sha256Hex(source.pdf) : unsignedPdfSha256;
    const placement = source?.placement ?? {
      ...verifiedPosition,
      templateVersionId: `${documentType}:v1`,
      anchorText: ownerName,
    };
    const encodedPlacement = JSON.stringify(placement).replace(/'/g, "''");
    return `(${pairId},'${documentType}',${templates.rows[index].id},'awaiting_signature',
      '${key}','${hash}','${encodedPlacement}'::jsonb)`;
  });
  const docs = await pglite.query<{ id: number }>(`
    INSERT INTO legal_documents (
      pair_id,document_type,template_id,status,unsigned_pdf_key,unsigned_pdf_sha256,
      signature_placement
    ) VALUES ${documentValues.join(",")}
    RETURNING id
  `);
  documentIds = docs.rows.map((row) => row.id);
  if (includeLegacyProviderSchema) {
    await pglite.query(`INSERT INTO legal_signing_operations (document_id) VALUES (${documentIds[0]})`);
  }
}

beforeEach(async () => {
  await pglite?.close();
  pglite = new PGlite();
  testDb = drizzle(pglite);
  databaseRef.current = testDb;
  storage = new Map();
  challengeCount = 0;
  rendererSha = "f".repeat(64);
  await seedLegalPair();
  for (let index = 0; index < 2; index += 1) {
    storage.set(
      `legal/documents/00000000-0000-4000-8000-00000000000${index + 1}/unsigned_pdf`,
      Buffer.from(unsignedPdf),
    );
  }
});

afterAll(async () => {
  await pglite?.close();
});

function createDependencies(options?: {
  correctPassword?: boolean;
  beforeStore?: (key: string, contents: Buffer) => Promise<void>;
}) {
  const comparePasswords = vi.fn(async (supplied: string, stored: string) =>
    options?.correctPassword === false
      ? false
      : supplied === "correct-password" && stored === "current-password-hash",
  );
  const storeLegalDocument = vi.fn(async (input: {
    recordKey: string;
    kind: string;
    contents: Buffer;
  }) => {
    const key = `legal/documents/${input.recordKey}/${input.kind}`;
    await options?.beforeStore?.(key, input.contents);
    if (storage.has(key)) throw new LegalFileAlreadyExistsError();
    storage.set(key, Buffer.from(input.contents));
    return key as LegalStorageReference;
  });
  const readLegalDocument = vi.fn(async (key: string) => {
    const contents = storage.get(key);
    if (!contents) throw new Error("Missing fixture legal file");
    return Buffer.from(contents);
  });
  const renderLocallySignedPdf = vi.fn(async () =>
    Buffer.from(`%PDF-1.7\n${"deterministic locally signed fixture\n".repeat(12)}`),
  );
  const renderLocalSigningEvidencePdf = vi.fn(async () =>
    Buffer.from(`%PDF-1.7\n${"deterministic in-app signing evidence\n".repeat(12)}`),
  );
  return {
    db: testDb as never,
    comparePasswords,
    storeLegalDocument,
    readLegalDocument: readLegalDocument as never,
    verifyAssigneeSignaturePosition: vi.fn(async (
      _pdf: Buffer,
      input: { templateVersionId: string; assigneeFullName: string },
    ) => ({
      ...verifiedPosition,
      templateVersionId: input.templateVersionId,
      anchorText: input.assigneeFullName,
    })),
    renderLocallySignedPdf,
    renderLocalSigningEvidencePdf,
    getLocalSigningFontSha256: vi.fn(async () => rendererSha),
    randomChallengeToken: () => Buffer.alloc(32, ++challengeCount).toString("base64url"),
    now: () => new Date(),
  };
}

function signingBody(session: {
  challengeToken: string;
  unsignedPdfSha256: string;
}) {
  return {
    challengeToken: session.challengeToken,
    password: "correct-password",
    typedName: ownerName,
    consent: true,
    reviewed: true,
    consentVersion: LOCAL_SIGNING_CONSENT_VERSION,
    unsignedPdfSha256: session.unsignedPdfSha256,
    signaturePng: `data:image/png;base64,${signaturePng.toString("base64")}`,
    signatureMethod: "typed",
  };
}

async function cancelUnsignedHolding() {
  return testDb.transaction(async (tx) => {
    const result = await recordUnsignedLegalCancellation(tx as never, reservationId, adminId);
    await tx.execute(sql`
      UPDATE investment_reservations
      SET status = 'cancelled', funnel_stage = NULL
      WHERE id = ${reservationId}
    `);
    return result;
  });
}

async function query<T>(queryText: string): Promise<T[]> {
  return (await pglite.query<T>(queryText)).rows;
}

describe("local legal signing (isolated PGlite)", () => {
  it("tolerates an unrelated holding when optional legal tables are not installed", async () => {
    const isolated = new PGlite();
    try {
      const isolatedDb = drizzle(isolated);
      await isolated.exec(`
        CREATE TABLE investment_reservations (
          id serial PRIMARY KEY,
          user_id integer,
          property_id integer,
          status text NOT NULL DEFAULT 'reserved',
          funnel_stage text
        );
        INSERT INTO investment_reservations DEFAULT VALUES;
      `);

      const result = await isolatedDb.transaction((tx) =>
        recordUnsignedLegalCancellation(tx as never, 1, 1),
      );
      expect(result).toMatchObject({
        reservationId: 1,
        pairIds: [],
        clearedDraftChallenges: 0,
        fencedJobs: 0,
        policy: "unsigned_signing_suspended",
      });
    } finally {
      await isolated.close();
    }
  });

  it("creates a hashed challenge and atomically completes one investor signature with durable Unicode evidence", async () => {
    const dependencies = createDependencies();
    const session = await beginLocalSigning(documentIds[0], ownerId, dependencies);
    expect(session).toMatchObject({
      documentId: documentIds[0],
      unsignedPdfSha256,
      signerName: ownerName,
      consentVersion: LOCAL_SIGNING_CONSENT_VERSION,
      consentText: LOCAL_SIGNING_CONSENT_TEXT,
    });
    expect(session.challengeToken).not.toMatch(/^[a-f0-9]{64}$/i);
    const storedChallenge = (await query<{ challenge_hash: string; challenge_expires_at: Date }>(`
      SELECT challenge_hash,challenge_expires_at FROM local_legal_signing_operations
      WHERE document_id=${documentIds[0]}
    `))[0];
    expect(storedChallenge.challenge_hash).toBe(createHash("sha256").update(session.challengeToken).digest("hex"));
    expect(Date.parse(String(storedChallenge.challenge_expires_at))).toBeGreaterThan(Date.now());

    const result = await completeLocalSigning(
      documentIds[0],
      ownerId,
      signingBody(session),
      { ip: "192.0.2.1", userAgent: "Local signing test browser" },
      dependencies,
    );
    expect(result.status).toBe("investor_signed");
    if (result.status !== "investor_signed") throw new Error("Expected completed signing.");
    expect(result.signedPdfSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.certificateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(dependencies.comparePasswords).toHaveBeenCalledTimes(1);
    expect(dependencies.renderLocallySignedPdf).toHaveBeenCalledWith(expect.objectContaining({
      signerName: ownerName,
      signatureMethod: "typed",
      unsignedPdfSha256,
    }));
    expect(dependencies.renderLocalSigningEvidencePdf).toHaveBeenCalledWith(expect.objectContaining({
      signerName: ownerName,
      signatureMethod: "typed",
      consentText: LOCAL_SIGNING_CONSENT_TEXT,
      renderFontSha256: rendererSha,
    }));

    const stored = (await query<Record<string, any>>(`
      SELECT * FROM local_legal_signing_operations WHERE document_id=${documentIds[0]}
    `))[0];
    expect(stored.status).toBe("completed");
    expect(stored.challenge_hash).toBe(createHash("sha256").update(session.challengeToken).digest("hex"));
    expect(stored.signature_png_base64).toBe(signaturePng.toString("base64"));
    expect(stored.signature_sha256).toBe(createHash("sha256").update(signaturePng).digest("hex"));
    expect(stored.consent_version).toBe(LOCAL_SIGNING_CONSENT_VERSION);
    expect(stored.consent_text).toBe(LOCAL_SIGNING_CONSENT_TEXT);
    expect(stored.evidence_snapshot.signatureMethod).toBe("typed");
    expect(stored.evidence_snapshot.signerName).toBe(ownerName);
    expect(stored.evidence_snapshot.renderFontSha256).toBe(rendererSha);
    expect(stored.evidence_snapshot.propertyName).toBe("Ọjà Heights");
    expect(stored.evidence_snapshot.ip).toBe("192.0.2.1");
    expect(stored.signed_pdf_sha256).toBe(result.signedPdfSha256);
    expect(stored.certificate_sha256).toBe(result.certificateSha256);
    expect(stored.evidence_sha256).toMatch(/^[a-f0-9]{64}$/);

    const finalDocument = (await query<Record<string, any>>(`
      SELECT * FROM legal_documents WHERE id=${documentIds[0]}
    `))[0];
    expect(finalDocument).toMatchObject({
      status: "investor_signed",
      signing_provider: "brikvest_local",
      signing_envelope_id: null,
      signed_pdf_sha256: result.signedPdfSha256,
      signed_pdf_key: `legal/documents/${stored.signed_pdf_record_key}/signed_pdf`,
      signing_certificate_key: `legal/documents/${stored.certificate_record_key}/audit_certificate_pdf`,
    });
    expect((await query<{ status: string }>(`SELECT status FROM legal_document_pairs WHERE id=${pairId}`))[0].status).toBe("signing");

    const audit = await query<{ details: Record<string, unknown> }>(`
      SELECT details FROM legal_audit_events
      WHERE pair_id=${pairId} AND event_type='local_signing_completed'
    `);
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toMatchObject({
      externalExecutionSeparatelyRequired: true,
      qualifiedDigitalSignature: false,
      identityCertificate: false,
    });
    const persistedTexts = await query<{ details: Record<string, unknown> }>(`
      SELECT details FROM legal_audit_events WHERE pair_id=${pairId}
    `);
    expect(JSON.stringify(persistedTexts)).not.toContain("correct-password");
  });

  it("completes both documents, replays a completed result without rendering again, and forbids re-signing", async () => {
    const dependencies = createDependencies();
    const firstSession = await beginLocalSigning(documentIds[0], ownerId, dependencies);
    const firstResult = await completeLocalSigning(documentIds[0], ownerId, signingBody(firstSession), {}, dependencies);
    expect(firstResult.status).toBe("investor_signed");
    const secondSession = await beginLocalSigning(documentIds[1], ownerId, dependencies);
    const secondResult = await completeLocalSigning(documentIds[1], ownerId, signingBody(secondSession), {}, dependencies);
    expect(secondResult.status).toBe("investor_signed");
    expect((await query<{ status: string; investor_signed_at: Date }>(`
      SELECT status,investor_signed_at FROM legal_document_pairs WHERE id=${pairId}
    `))[0].status).toBe("investor_signed");

    const rendererCount = dependencies.renderLocallySignedPdf.mock.calls.length;
    const replay = await completeLocalSigning(documentIds[1], ownerId, signingBody(secondSession), {}, dependencies);
    expect(replay).toMatchObject({ status: "investor_signed", documentId: documentIds[1] });
    expect(dependencies.renderLocallySignedPdf).toHaveBeenCalledTimes(rendererCount);
    await expect(beginLocalSigning(documentIds[1], ownerId, dependencies))
      .rejects.toThrow(/already signed|must be ready/i);
  });

  it("preserves converter-rendered source images through both investor-signed PDFs", async () => {
    await fs.mkdir(visualFixtureDirectory, { recursive: true });
    const sourceDocuments: Partial<Record<LegalDocumentType, {
      pdf: Buffer;
      placement: Awaited<ReturnType<typeof verifyAssigneeSignaturePosition>>;
    }>> = {};
    for (const documentType of ["deed_of_assignment", "transfer_exit_rights"] as const) {
      const outputDirectory = path.join(visualFixtureDirectory, documentType);
      await fs.mkdir(outputDirectory, { recursive: true });
      const source = await fs.readFile(path.join(projectRoot, sourceFixtures[documentType]));
      const normalized = normalizeSuppliedLegalTemplate(source);
      const rendered = renderLegalTemplate(
        normalized,
        documentType,
        buildLegalTemplateValues(documentType, {
          verifiedFullName: ownerName,
          verifiedHomeAddress: "1 Verified Street, Lagos",
          propertyAreaSqm: 10,
          approvedPaymentAmountNaira: "1,000,000",
          documentDate: new Date("2026-09-30T12:00:00.000Z"),
        }),
      );
      const unsignedPdf = await convertDocxToPdf(rendered);
      const unsignedPath = path.join(outputDirectory, "unsigned-source.pdf");
      await fs.writeFile(unsignedPath, unsignedPdf, { mode: 0o600 });
      expect(imageCountInPdf(unsignedPath)).toBeGreaterThan(0);
      const placement = await verifyAssigneeSignaturePosition(unsignedPdf, {
        templateVersionId: `${documentType}:v1`,
        assigneeFullName: ownerName,
      });
      sourceDocuments[documentType] = { pdf: unsignedPdf, placement };
    }

    // Seed these as brand-new immutable fixture records: no stored PDF/hash/asset
    // is ever rewritten to stage the integration test.
    await pglite.close();
    pglite = new PGlite();
    testDb = drizzle(pglite);
    databaseRef.current = testDb;
    storage = new Map();
    await seedLegalPair(false, sourceDocuments);
    const documents = await query<{
      id: number;
      document_type: LegalDocumentType;
      unsigned_pdf_key: string;
    }>(`
      SELECT id,document_type,unsigned_pdf_key FROM legal_documents
      WHERE pair_id=${pairId} ORDER BY document_type
    `);
    for (const document of documents) {
      storage.set(document.unsigned_pdf_key, Buffer.from(sourceDocuments[document.document_type]!.pdf));
    }
    const dependencies = createDependencies();
    dependencies.verifyAssigneeSignaturePosition = (pdf, input) =>
      verifyAssigneeSignaturePosition(pdf, input);
    dependencies.renderLocallySignedPdf = renderActualLocallySignedPdf;

    for (const document of documents) {
      const outputDirectory = path.join(visualFixtureDirectory, document.document_type);
      const unsignedPath = path.join(outputDirectory, "unsigned-source.pdf");
      const placement = sourceDocuments[document.document_type]!.placement;
      const session = await beginLocalSigning(document.id, ownerId, dependencies);
      const result = await completeLocalSigning(
        document.id,
        ownerId,
        signingBody(session),
        { ip: "192.0.2.143", userAgent: "Task 143 PDF preservation regression" },
        dependencies,
      );
      expect(result.status).toBe("investor_signed");

      const finalDocument = (await query<{ signed_pdf_key: string }>(`
        SELECT signed_pdf_key FROM legal_documents WHERE id=${document.id}
      `))[0];
      const finalPdf = storage.get(finalDocument.signed_pdf_key);
      expect(finalPdf).toBeDefined();
      const signedPath = path.join(outputDirectory, "investor-signed.pdf");
      await fs.writeFile(signedPath, finalPdf!, { mode: 0o600 });
      expect(imageCountInPdf(signedPath)).toBeGreaterThanOrEqual(imageCountInPdf(unsignedPath));
      for (const sourcePage of imagePageNumbers(unsignedPath)) {
        expect(imagePageNumbers(signedPath)).toContain(sourcePage);
      }
      await assertRasterPreservedOutsideSignature(
        unsignedPath,
        signedPath,
        placement,
        outputDirectory,
      );
      await fs.writeFile(path.join(outputDirectory, "signature.png"), signaturePng, { mode: 0o600 });
    }
  });

  it("recovers immutable storage conflicts only when existing bytes match, and rejects conflicting bytes", async () => {
    const dependencies = createDependencies();
    const session = await beginLocalSigning(documentIds[0], ownerId, dependencies);
    const body = signingBody(session);
    const beforeStore = async (key: string, contents: Buffer) => {
      if (key.endsWith("/signed_pdf")) {
        storage.set(key, Buffer.from(contents));
      }
    };
    const conflictDependencies = createDependencies({ beforeStore });
    const result = await completeLocalSigning(documentIds[0], ownerId, body, {}, conflictDependencies);
    expect(result.status).toBe("investor_signed");

    const nextSession = await beginLocalSigning(documentIds[1], ownerId, dependencies);
    const conflicting = createDependencies({
      beforeStore: async (key) => {
        if (key.endsWith("/signed_pdf")) storage.set(key, Buffer.from("%PDF-1.7\nwrong immutable bytes"));
      },
    });
    await expect(completeLocalSigning(documentIds[1], ownerId, signingBody(nextSession), {}, conflicting))
      .rejects.toThrow(/different immutable signed document/i);
    const retained = (await query<{ status: string; signature_png_base64: string }>(`
      SELECT status,signature_png_base64 FROM local_legal_signing_operations
      WHERE document_id=${documentIds[1]}
    `))[0];
    expect(retained.status).toBe("accepted");
    expect(retained.signature_png_base64).toBe(signaturePng.toString("base64"));
  });

  it("leaves accepted evidence recoverable after a renderer crash and reconciles the same operation", async () => {
    const dependencies = createDependencies();
    dependencies.renderLocallySignedPdf.mockRejectedValueOnce(new Error("simulated renderer interruption"));
    const session = await beginLocalSigning(documentIds[0], ownerId, dependencies);
    await expect(completeLocalSigning(
      documentIds[0],
      ownerId,
      signingBody(session),
      {},
      dependencies,
    )).rejects.toThrow(/renderer interruption/i);
    expect((await query<{ status: string; signature_png_base64: string }>(`
      SELECT status,signature_png_base64 FROM local_legal_signing_operations
      WHERE document_id=${documentIds[0]}
    `))[0]).toMatchObject({
      status: "accepted",
      signature_png_base64: signaturePng.toString("base64"),
    });

    const recovered = await reconcileLocalPairSigning(pairId, dependencies);
    expect(recovered).toEqual({ pending: false, completed: 1 });
    expect((await query<{ status: string }>(`
      SELECT status FROM local_legal_signing_operations WHERE document_id=${documentIds[0]}
    `))[0].status).toBe("completed");
  });

  it("rejects wrong owners and prevents starting over an external history row/provider", async () => {
    await pglite.close();
    pglite = new PGlite();
    testDb = drizzle(pglite);
    databaseRef.current = testDb;
    storage = new Map();
    await seedLegalPair(true);
    for (let index = 0; index < 2; index += 1) {
      storage.set(
        `legal/documents/00000000-0000-4000-8000-00000000000${index + 1}/unsigned_pdf`,
        Buffer.from(unsignedPdf),
      );
    }
    const dependencies = createDependencies();
    await expect(beginLocalSigning(documentIds[0], ownerId + 1, dependencies)).rejects.toThrow(/not found/i);

    await expect(beginLocalSigning(documentIds[0], ownerId, dependencies)).rejects.toThrow(/external signing activity/i);

    await pglite.exec(`DELETE FROM legal_signing_operations`);
    await pglite.exec(`
      UPDATE legal_documents SET signing_provider='another_provider'
      WHERE id=${documentIds[1]}
    `);
    await expect(beginLocalSigning(documentIds[1], ownerId, dependencies)).rejects.toThrow(/signing history/i);
  });

  it("commits user-wide reauthentication rate limits before password checks and locks after five failures", async () => {
    const dependencies = createDependencies({ correctPassword: false });
    const session = await beginLocalSigning(documentIds[0], ownerId, dependencies);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(completeLocalSigning(
        documentIds[0],
        ownerId,
        signingBody(session),
        {},
        dependencies,
      )).rejects.toMatchObject({
        statusCode: attempt === 4 ? 429 : 401,
      });
    }
    expect(dependencies.comparePasswords).toHaveBeenCalledTimes(5);
    const operation = (await query<{ failed_auth_attempts: number; auth_locked_until: Date | null }>(`
      SELECT failed_auth_attempts,auth_locked_until FROM local_legal_signing_operations
      WHERE document_id=${documentIds[0]}
    `))[0];
    expect(operation.failed_auth_attempts).toBe(5);
    expect(operation.auth_locked_until).not.toBeNull();

    const otherDocumentSession = await beginLocalSigning(documentIds[1], ownerId, dependencies)
      .catch((error) => error);
    expect(otherDocumentSession).toBeInstanceOf(LocalSigningError);
    expect((otherDocumentSession as LocalSigningError).statusCode).toBe(429);
  });

  it("rejects hash/consent/name changes and blank signature pixels before accepting", async () => {
    const dependencies = createDependencies();
    const session = await beginLocalSigning(documentIds[0], ownerId, dependencies);
    await expect(completeLocalSigning(documentIds[0], ownerId, {
      ...signingBody(session),
      consentVersion: "old-consent",
    }, {}, dependencies)).rejects.toThrow(/consent version/i);
    await expect(completeLocalSigning(documentIds[0], ownerId, {
      ...signingBody(session),
      typedName: "Oladele Ajayi",
    }, {}, dependencies)).rejects.toThrow(/exactly match/i);
    await expect(completeLocalSigning(documentIds[0], ownerId, {
      ...signingBody(session),
      unsignedPdfSha256: "0".repeat(64),
    }, {}, dependencies)).rejects.toThrow(/hash/i);
    await expect(completeLocalSigning(documentIds[0], ownerId, {
      ...signingBody(session),
      signatureMethod: "unchecked",
    }, {}, dependencies)).rejects.toThrow(/signature image method/i);

    const blankPng = PNG.sync.write(new PNG({ width: 100, height: 40 }));
    await expect(completeLocalSigning(documentIds[0], ownerId, {
      ...signingBody(session),
      signaturePng: `data:image/png;base64,${blankPng.toString("base64")}`,
    }, {}, dependencies)).rejects.toThrow(/blank/i);
    const operation = (await query<{ status: string }>(`
      SELECT status FROM local_legal_signing_operations WHERE document_id=${documentIds[0]}
    `))[0];
    expect(operation.status).toBe("draft");
  });

  it("suspends unsigned legal work on cancellation and requires a new session after reinstatement", async () => {
    const dependencies = createDependencies();
    const session = await beginLocalSigning(documentIds[0], ownerId, dependencies);
    await pglite.query(`
      INSERT INTO legal_jobs (pair_id,kind,status)
      VALUES (${pairId},'generation','queued'),(${pairId},'notify','queued')
    `);
    const originalDocuments = await query<{
      id: number;
      unsigned_pdf_key: string;
      unsigned_pdf_sha256: string;
    }>(`
      SELECT id,unsigned_pdf_key,unsigned_pdf_sha256
      FROM legal_documents WHERE pair_id=${pairId} ORDER BY id
    `);

    const result = await cancelUnsignedHolding();
    expect(result).toMatchObject({
      reservationId,
      pairIds: [pairId],
      clearedDraftChallenges: 1,
      fencedJobs: 2,
      policy: "unsigned_signing_suspended",
    });
    expect((await query<{ challenge_hash: string | null; challenge_expires_at: Date | null }>(`
      SELECT challenge_hash,challenge_expires_at FROM local_legal_signing_operations
      WHERE document_id=${documentIds[0]}
    `))[0]).toEqual({ challenge_hash: null, challenge_expires_at: null });
    expect((await query<{ status: string }>(`
      SELECT status FROM legal_jobs ORDER BY id
    `)).map(({ status }) => status)).toEqual(["blocked", "blocked"]);
    expect(await query(`
      SELECT id,unsigned_pdf_key,unsigned_pdf_sha256
      FROM legal_documents WHERE pair_id=${pairId} ORDER BY id
    `)).toEqual(originalDocuments);
    expect((await query<{ event_type: string; details: Record<string, unknown> }>(`
      SELECT event_type,details FROM legal_audit_events
      WHERE reservation_id=${reservationId}
    `))[0]).toMatchObject({
      event_type: "legal_unsigned_signing_suspended_by_holding_cancellation",
      details: {
        unsignedSourceSnapshotsPreserved: true,
        unsignedFilesPreserved: true,
        acceptedOrSignedHistoryChanged: false,
        fencedJobs: 2,
      },
    });

    await expect(completeLocalSigning(
      documentIds[0],
      ownerId,
      signingBody(session),
      {},
      dependencies,
    )).rejects.toMatchObject({ statusCode: 409 });
    await expect(beginLocalSigning(documentIds[0], ownerId, dependencies))
      .rejects.toThrow(/not currently confirmed and active/i);

    await pglite.query(`
      UPDATE investment_reservations
      SET status='converted_to_investment',funnel_stage='confirmed'
      WHERE id=${reservationId}
    `);
    const reinstatedSession = await beginLocalSigning(documentIds[0], ownerId, dependencies);
    expect(reinstatedSession.challengeToken).not.toBe(session.challengeToken);
    await expect(completeLocalSigning(
      documentIds[0],
      ownerId,
      signingBody(session),
      {},
      dependencies,
    )).rejects.toThrow(/challenge/i);
    await expect(completeLocalSigning(
      documentIds[0],
      ownerId,
      signingBody(reinstatedSession),
      {},
      dependencies,
    )).resolves.toMatchObject({ status: "investor_signed" });
  });

  it("does not let cancellation win while accepted signing is finalizing", async () => {
    const dependencies = createDependencies();
    const session = await beginLocalSigning(documentIds[0], ownerId, dependencies);
    let notifyRendererStarted!: () => void;
    let releaseRenderer!: () => void;
    const rendererStarted = new Promise<void>((resolve) => {
      notifyRendererStarted = resolve;
    });
    const rendererGate = new Promise<void>((resolve) => {
      releaseRenderer = resolve;
    });
    dependencies.renderLocallySignedPdf = vi.fn(async () => {
      notifyRendererStarted();
      await rendererGate;
      return Buffer.from(`%PDF-1.7\n${"held signed fixture\n".repeat(12)}`);
    });

    const signing = completeLocalSigning(
      documentIds[0],
      ownerId,
      signingBody(session),
      {},
      dependencies,
    );
    await rendererStarted;
    await expect(cancelUnsignedHolding()).rejects.toMatchObject({ statusCode: 409 });
    expect((await query<{ status: string }>(`
      SELECT status FROM investment_reservations WHERE id=${reservationId}
    `))[0].status).toBe("converted_to_investment");

    releaseRenderer();
    await expect(signing).resolves.toMatchObject({ status: "investor_signed" });
    await expect(cancelUnsignedHolding()).rejects.toThrow(/signing history/i);
    expect((await query<{ status: string }>(`
      SELECT status FROM investment_reservations WHERE id=${reservationId}
    `))[0].status).toBe("converted_to_investment");
  });

  it("blocks ordinary cancellation when legal provider history already exists", async () => {
    await pglite.exec(`
      CREATE TABLE legal_signing_operations (id serial PRIMARY KEY, document_id integer NOT NULL);
      INSERT INTO legal_signing_operations (document_id) VALUES (${documentIds[0]});
    `);
    await expect(cancelUnsignedHolding()).rejects.toThrow(/historical external signing activity/i);
    expect((await query<{ status: string }>(`
      SELECT status FROM investment_reservations WHERE id=${reservationId}
    `))[0].status).toBe("converted_to_investment");

    await pglite.exec(`DELETE FROM legal_signing_operations`);
    await pglite.exec(`
      UPDATE legal_documents SET signing_provider='brikvest_local'
      WHERE id=${documentIds[0]}
    `);
    await expect(cancelUnsignedHolding()).rejects.toThrow(/active or completed legal signing history/i);
    expect((await query<{ status: string }>(`
      SELECT status FROM investment_reservations WHERE id=${reservationId}
    `))[0].status).toBe("converted_to_investment");
  });

  it("rejects signing-session creation for cancelled, expired, and unconfirmed holdings", async () => {
    const dependencies = createDependencies();
    for (const state of [
      { status: "cancelled", funnelStage: null },
      { status: "expired", funnelStage: null },
      { status: "reserved", funnelStage: "confirmed" },
      { status: "converted_to_investment", funnelStage: "documentation" },
    ]) {
      await pglite.query(`
        UPDATE investment_reservations
        SET status='${state.status}',funnel_stage=${state.funnelStage === null ? "NULL" : `'${state.funnelStage}'`}
        WHERE id=${reservationId}
      `);
      await expect(beginLocalSigning(documentIds[0], ownerId, dependencies))
        .rejects.toThrow(/not currently confirmed and active/i);
    }
  });

});
