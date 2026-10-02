import express, { type RequestHandler } from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import PizZip from "pizzip";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerLegalRoutes } from "../server/legal/routes";
import {
  validateLegalTemplate,
} from "../server/legal/templates";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  bindLegalProperty: vi.fn(),
  getLegalPropertyBinding: vi.fn(),
  pinActiveTemplatesAndQueue: vi.fn(),
  requestLegalNotificationResend: vi.fn(),
  convertDocxToPdf: vi.fn(),
  verifyAssigneeSignaturePosition: vi.fn(),
  storeLegalTemplateVersion: vi.fn(),
  readLegalTemplateVersion: vi.fn(),
  streamAuthorizedLegalDocument: vi.fn(),
  dispatchLegalJobs: vi.fn(),
  beginLocalSigning: vi.fn(),
  completeLocalSigning: vi.fn(),
}));

vi.mock("../server/db", () => ({
  get db() {
    return { execute: mocks.execute, transaction: mocks.transaction };
  },
}));
vi.mock("../server/legal/repository", () => ({
  bindLegalProperty: mocks.bindLegalProperty,
  getLegalPropertyBinding: mocks.getLegalPropertyBinding,
  pinActiveTemplatesAndQueue: mocks.pinActiveTemplatesAndQueue,
  requestLegalNotificationResend: mocks.requestLegalNotificationResend,
}));
vi.mock("../server/legal/converter", () => ({
  convertDocxToPdf: mocks.convertDocxToPdf,
  verifyAssigneeSignaturePosition: mocks.verifyAssigneeSignaturePosition,
}));
vi.mock("../server/legal/files", () => ({
  storeLegalTemplateVersion: mocks.storeLegalTemplateVersion,
  readLegalTemplateVersion: mocks.readLegalTemplateVersion,
  streamAuthorizedLegalDocument: mocks.streamAuthorizedLegalDocument,
}));
vi.mock("../server/legal/worker", () => ({
  dispatchLegalJobs: mocks.dispatchLegalJobs,
}));
vi.mock("../server/legal/local-signing", () => ({
  beginLocalSigning: mocks.beginLocalSigning,
  completeLocalSigning: mocks.completeLocalSigning,
}));

const OWNER_ID = 20;
const OTHER_USER_ID = 21;
const ADMIN_ID = 7;
const PAIR_ID = 71;
const DOCUMENT_ID = 51;
const TEMPLATE_ID = 99;
const unsignedPdf = Buffer.from(`%PDF-1.7\n${"legal preview content\n".repeat(12)}`);
const parseBinaryBody = (response: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
};
const transferTemplateV1 = readFileSync(
  new URL("../server/legal/template-assets/transfer_exit_rights_v1.docx", import.meta.url),
);

const pairRow = {
  id: PAIR_ID,
  reservation_id: 901,
  user_id: OWNER_ID,
  property_id: 12,
  property_name: "Lilycrest Garden Estate — Plot SD118",
  user_email: "investor@example.test",
  full_name_snapshot: "Verified Investor",
  property_area_sqm: "5.00",
  approval_source: "admin_full_confirmation",
  approval_source_id: 901,
  approved_at: new Date("2026-01-01T00:00:00.000Z"),
  deed_template_id: 3,
  transfer_template_id: 4,
  status: "documents_ready",
  last_error: null,
  documents_ready_at: new Date("2026-01-01T00:00:00.000Z"),
};

const documentRow = {
  id: DOCUMENT_ID,
  pair_id: PAIR_ID,
  user_id: OWNER_ID,
  source_docx_key: "legal/documents/opaque/source_docx",
  unsigned_pdf_key: "legal/documents/opaque/unsigned_pdf",
  signed_pdf_key: "legal/documents/opaque/signed_pdf",
  signing_certificate_key: "legal/documents/opaque/audit_certificate_pdf",
  document_type: "deed_of_assignment",
  status: "investor_signed",
};

function replaceWordToken(template: Buffer, source: string, target: string): Buffer {
  const zip = new PizZip(template);
  const documentXml = zip.file("word/document.xml")!.asText();
  zip.file("word/document.xml", documentXml.replaceAll(source, target));
  return zip.generate({ type: "nodebuffer" });
}

function useCanonicalDate(template: Buffer): Buffer {
  const zip = new PizZip(template);
  const documentXml = zip.file("word/document.xml")!.asText()
    .replaceAll("{{DOCUMENT_DATE_DAY}}", "{{DOCUMENT_DATE}}")
    .replaceAll("{{DOCUMENT_DATE_MONTH}}", "")
    .replaceAll("{{DOCUMENT_DATE_YEAR}}", "");
  zip.file("word/document.xml", documentXml);
  return zip.generate({ type: "nodebuffer" });
}

const embeddedImage = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082",
  "hex",
);

function addBodyImage(template: Buffer): Buffer {
  const zip = new PizZip(template);
  let documentXml = zip.file("word/document.xml")!.asText();
  const namespaces: Record<string, string> = {
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  };
  documentXml = documentXml.replace(/<w:document\b[^>]*>/, (root) => {
    const missing = Object.entries(namespaces)
      .filter(([prefix]) => !new RegExp(`\\bxmlns:${prefix}=`).test(root))
      .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
      .join("");
    return root.slice(0, -1) + missing + ">";
  });
  const drawing = '<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="143" name="Task143 body image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdTask143Image"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  documentXml = documentXml.replace(/<\/w:p>/, `${drawing}</w:p>`);
  zip.file("word/document.xml", documentXml);
  const relationships = zip.file("word/_rels/document.xml.rels")!.asText();
  zip.file(
    "word/_rels/document.xml.rels",
    relationships.replace(
      "</Relationships>",
      '<Relationship Id="rIdTask143Image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/task143.png"/></Relationships>',
    ),
  );
  const contentTypes = zip.file("[Content_Types].xml")!.asText();
  if (!/Extension="png"/i.test(contentTypes)) {
    zip.file(
      "[Content_Types].xml",
      contentTypes.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>'),
    );
  }
  zip.file("word/media/task143.png", embeddedImage);
  return zip.generate({ type: "nodebuffer" });
}

function expectImagePreserved(docx: Buffer): void {
  const zip = new PizZip(docx);
  expect(zip.file("word/media/task143.png")?.asNodeBuffer()).toEqual(embeddedImage);
  expect(zip.file("word/_rels/document.xml.rels")!.asText()).toContain(
    'Id="rIdTask143Image"',
  );
  expect(zip.file("word/document.xml")!.asText()).toContain(
    'r:embed="rIdTask143Image"',
  );
}

function compile(query: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query as never);
}

function createApp() {
  const app = express();
  app.use(express.json());

  const requireAuth: RequestHandler = vi.fn((req: any, res, next) => {
    const userId = Number(req.header("x-user-id"));
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Authentication required" });
    }
    req.user = { id: userId };
    next();
  });
  const requireAdminAuth: RequestHandler = vi.fn((req: any, res, next) => {
    const userId = Number(req.header("x-admin-user-id"));
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Admin authentication required" });
    }
    req.user = { userId, role: "admin" };
    next();
  });

  registerLegalRoutes(app, { requireAuth, requireAdminAuth });
  return { app, requireAuth, requireAdminAuth };
}

let app: ReturnType<typeof createApp>["app"];
let templateBytes: Buffer;
let activeTemplate: Record<string, any>;
let pairStatus: string;
let dispatcherSecretBefore: string | undefined;
let appBaseUrlBefore: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  dispatcherSecretBefore = process.env.LEGAL_DISPATCH_SECRET;
  appBaseUrlBefore = process.env.APP_BASE_URL;
  process.env.LEGAL_DISPATCH_SECRET = "route-test-dispatch-secret";
  process.env.APP_BASE_URL = "https://brikvest.example.test";

  pairStatus = "documents_ready";
  templateBytes = Buffer.from(transferTemplateV1);
  activeTemplate = {
    id: TEMPLATE_ID,
    property_id: 12,
    document_type: "transfer_exit_rights",
    version: 1,
    storage_key: "legal/templates/transfer_exit_rights/v1",
    sha256: "",
    validation_status: "valid",
    is_active: false,
  };
  activeTemplate.sha256 = createHash("sha256").update(templateBytes).digest("hex");

  mocks.execute.mockImplementation(async (query: unknown) => {
    const { sql: text, params } = compile(query);
    if (text.includes("SELECT id FROM properties")) return { rows: params[0] === 12 ? [{ id: 12 }] : [] };
    if (text.includes("information_schema.columns")) {
      return { rows: [{ installed: true }] };
    }
    if (text.includes("FROM investment_reservations r")) {
      return {
        rows: [{
          id: pairRow.reservation_id,
          user_id: pairRow.user_id,
          property_id: pairRow.property_id,
          status: "converted_to_investment",
          funnel_stage: "confirmed",
        }],
      };
    }
    if (text.includes("FROM legal_document_pairs p JOIN properties")) {
      const authorized = text.includes("p.property_id =") ? params[0] === 12 : params[0] === OWNER_ID;
      return { rows: authorized ? [{ ...pairRow, status: pairStatus }] : [] };
    }
    if (text.includes("FROM legal_documents WHERE pair_id IN")) {
      return {
        rows: [{
          id: DOCUMENT_ID,
          pair_id: PAIR_ID,
          document_type: "deed_of_assignment",
          status: "investor_signed",
          has_unsigned: true,
          has_signed: true,
          has_certificate: true,
        }],
      };
    }
    if (text.includes("FROM legal_documents d JOIN legal_document_pairs p")) {
      const authorized = text.includes("p.property_id=") ? params[1] === 12 : params[1] === OWNER_ID;
      return {
        rows: params[0] === DOCUMENT_ID && authorized ? [documentRow] : [],
      };
    }
    if (text.includes("FROM legal_document_pairs WHERE id")) {
      return {
        rows: params[0] === PAIR_ID && (params.length === 1 || params[1] === 12)
          ? [{ ...pairRow, status: pairStatus }]
          : [],
      };
    }
    if (text.includes("SELECT * FROM legal_templates WHERE id")) {
      return { rows: params[0] === TEMPLATE_ID && params[1] === 12 ? [activeTemplate] : [] };
    }
    if (text.includes("COALESCE(MAX(version), 0) + 1")) {
      return { rows: [{ version: 1 }] };
    }
    if (text.includes("INSERT INTO legal_templates")) {
      return { rows: [{ id: TEMPLATE_ID }] };
    }
    if (text.includes("SELECT id FROM legal_templates LIMIT 1")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({ execute: mocks.execute }),
  );
  mocks.storeLegalTemplateVersion.mockImplementation(async ({ documentType, version }) =>
    `legal/templates/${documentType}/v${version}`,
  );
  mocks.readLegalTemplateVersion.mockImplementation(async () => templateBytes);
  mocks.streamAuthorizedLegalDocument.mockImplementation(async (res, options) => {
    res.status(200).send(`private artifact: ${options.storageReference}`);
  });
  mocks.convertDocxToPdf.mockResolvedValue(unsignedPdf);
  mocks.verifyAssigneeSignaturePosition.mockResolvedValue(undefined);
  mocks.getLegalPropertyBinding.mockResolvedValue({ propertyId: 12, squareMetersPerUnit: 5 });
  mocks.pinActiveTemplatesAndQueue.mockResolvedValue(true);
  mocks.requestLegalNotificationResend.mockResolvedValue({
    state: "queued",
    queued: true,
    coalesced: false,
    cycleId: 1,
    cycleNumber: 1,
    message: "A new notification cycle (#1) was queued.",
  });
  mocks.dispatchLegalJobs.mockResolvedValue({ processed: 0 });
  mocks.beginLocalSigning.mockImplementation(async (_documentId, userId) => {
    if (userId !== OWNER_ID) {
      throw Object.assign(new Error("Legal document not found"), { statusCode: 404 });
    }
    return {
      documentId: DOCUMENT_ID,
      operationId: 91007,
      challengeToken: "local-signing-challenge",
      unsignedPdfSha256: "a".repeat(64),
      expiresAt: "2026-01-02T00:00:00.000Z",
      signerName: "Verified Investor",
      consentVersion: "brikvest-local-signing-v1",
      consentText: "I have reviewed this document and agree to sign it electronically.",
    };
  });
  mocks.completeLocalSigning.mockImplementation(async (_documentId, userId) => {
    if (userId !== OWNER_ID) {
      throw Object.assign(new Error("Legal document not found"), { statusCode: 404 });
    }
    return {
      status: "investor_signed",
      documentId: DOCUMENT_ID,
      operationId: 91007,
      signedPdfSha256: "b".repeat(64),
      certificateSha256: "c".repeat(64),
    };
  });

  app = createApp().app;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (dispatcherSecretBefore === undefined) delete process.env.LEGAL_DISPATCH_SECRET;
  else process.env.LEGAL_DISPATCH_SECRET = dispatcherSecretBefore;
  if (appBaseUrlBefore === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = appBaseUrlBefore;
});

describe("legal document routes", () => {
  it("requires a selected property for administrator lists and artifact actions", async () => {
    for (const path of ["templates", "documents", "failures", `templates/${TEMPLATE_ID}/fields`, `documents/${DOCUMENT_ID}/preview`]) {
      await request(app).get(`/api/admin/legal/${path}`).set("x-admin-user-id", String(ADMIN_ID)).expect(400);
    }
  });

  it("rejects cross-property template activation, inspection, document access and pair retry", async () => {
    await request(app).post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
      .set("x-admin-user-id", String(ADMIN_ID)).send({ propertyId: 13 }).expect(404);
    await request(app).get(`/api/admin/legal/templates/${TEMPLATE_ID}/fields?propertyId=13`)
      .set("x-admin-user-id", String(ADMIN_ID)).expect(404);
    await request(app).get(`/api/admin/legal/documents/${DOCUMENT_ID}/preview?propertyId=13`)
      .set("x-admin-user-id", String(ADMIN_ID)).expect(404);
    await request(app).post(`/api/admin/legal/pairs/${PAIR_ID}/retry`)
      .set("x-admin-user-id", String(ADMIN_ID)).send({ propertyId: 13 }).expect(400);
    expect(mocks.convertDocxToPdf).not.toHaveBeenCalled();
    expect(mocks.pinActiveTemplatesAndQueue).not.toHaveBeenCalled();
  });

  it("returns checksum-verified fields for the selected template and rejects corrupt bytes", async () => {
    const response = await request(app).get(`/api/admin/legal/templates/${TEMPLATE_ID}/fields?propertyId=12`)
      .set("x-admin-user-id", String(ADMIN_ID)).expect(200);
    expect(response.body).toMatchObject({ templateId: TEMPLATE_ID, propertyId: 12, active: false });
    expect(response.body.fields.length).toBeGreaterThan(0);
    activeTemplate.sha256 = "invalid";
    await request(app).get(`/api/admin/legal/templates/${TEMPLATE_ID}/fields?propertyId=12`)
      .set("x-admin-user-id", String(ADMIN_ID)).expect(400);
  });

  it("scopes activation updates to the selected property without changing other properties", async () => {
    await request(app).post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
      .set("x-admin-user-id", String(ADMIN_ID)).send({ propertyId: 12 }).expect(200);
    const updates = mocks.execute.mock.calls.map(([query]) => compile(query))
      .filter((query) => query.sql.includes("UPDATE legal_templates"));
    expect(updates).toHaveLength(2);
    for (const query of updates) {
      expect(query.sql).toContain("property_id=");
      expect(query.params).toContain(12);
    }
  });

  it("requires login, scopes holdings to their owner, and exposes full holding metadata only to admins", async () => {
    await request(app).get("/api/legal/holdings").expect(401);

    const owner = await request(app)
      .get("/api/legal/holdings")
      .set("x-user-id", String(OWNER_ID))
      .expect(200);
    expect(owner.body).toHaveLength(1);
    expect(owner.body[0]).toMatchObject({
      id: PAIR_ID,
      reservationId: 901,
      propertyName: "LilyCrest Garden Estate",
      documents: [{ id: DOCUMENT_ID, type: "deed_of_assignment", hasUnsignedPdf: true }],
    });

    const otherOwner = await request(app)
      .get("/api/legal/holdings")
      .set("x-user-id", String(OTHER_USER_ID))
      .expect(200);
    expect(otherOwner.body).toEqual([]);

    await request(app).get("/api/admin/legal/documents").expect(401);
    const admin = await request(app)
      .get("/api/admin/legal/documents?propertyId=12")
      .set("x-admin-user-id", String(ADMIN_ID))
      .expect(200);
    expect(admin.body[0]).toMatchObject({
      userEmail: "investor@example.test",
      userName: "Verified Investor",
      approvalSource: "admin_full_confirmation",
    });
  });

  it.each([
    ["signed", "legal/documents/opaque/signed_pdf"],
    ["certificate", "legal/documents/opaque/audit_certificate_pdf"],
    ["docx", "legal/documents/opaque/source_docx"],
  ])("serves the authorized %s artifact without exposing the object key", async (version, storageReference) => {
    await request(app)
      .get(`/api/legal/documents/${DOCUMENT_ID}/download?version=${version}`)
      .expect(401);

    const owner = await request(app)
      .get(`/api/legal/documents/${DOCUMENT_ID}/download?version=${version}`)
      .set("x-user-id", String(OWNER_ID))
      .expect(200);
    expect(owner.text).toBe(`private artifact: ${storageReference}`);
    expect(owner.headers["cache-control"]).toContain("no-store");
    expect(mocks.streamAuthorizedLegalDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storageReference, documentOwnerUserId: OWNER_ID }),
    );
  });

  it("does not allow another investor to fetch a document by changing its ID", async () => {
    await request(app)
      .get(`/api/legal/documents/${DOCUMENT_ID}/preview?version=signed`)
      .set("x-user-id", String(OTHER_USER_ID))
      .expect(404);
    expect(mocks.streamAuthorizedLegalDocument).not.toHaveBeenCalled();
  });

  it("lets admins retrieve sensitive artifacts only through the admin-authenticated route", async () => {
    await request(app)
      .get(`/api/admin/legal/documents/${DOCUMENT_ID}/download?version=certificate&propertyId=12`)
      .expect(401);
    await request(app)
      .get(`/api/admin/legal/documents/${DOCUMENT_ID}/download?version=certificate&propertyId=12`)
      .set("x-admin-user-id", String(ADMIN_ID))
      .expect(200);
    expect(mocks.streamAuthorizedLegalDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        requesterIsAdmin: true,
        storageReference: "legal/documents/opaque/audit_certificate_pdf",
      }),
    );
  });

  it("starts a local signing session only for the authenticated document owner", async () => {
    await request(app)
      .post(`/api/legal/documents/${DOCUMENT_ID}/signing-session`)
      .expect(401);

    await request(app)
      .post(`/api/legal/documents/${DOCUMENT_ID}/signing-session`)
      .set("x-user-id", String(OTHER_USER_ID))
      .set("X-Brikvest-Signing", "1")
      .send({})
      .expect(404);
    expect(mocks.beginLocalSigning).toHaveBeenCalledWith(DOCUMENT_ID, OTHER_USER_ID);

    const owner = await request(app)
      .post(`/api/legal/documents/${DOCUMENT_ID}/signing-session`)
      .set("x-user-id", String(OWNER_ID))
      .set("X-Brikvest-Signing", "1")
      .set("Host", "brikvest.example.test")
      .set("Origin", "https://brikvest.example.test")
      .send({})
      .expect(200);
    expect(mocks.beginLocalSigning).toHaveBeenCalledTimes(2);
    expect(owner.body).toMatchObject({
      challengeToken: "local-signing-challenge",
      unsignedPdfSha256: "a".repeat(64),
      documentId: DOCUMENT_ID,
      operationId: 91007,
      signerName: "Verified Investor",
      consentVersion: "brikvest-local-signing-v1",
      consentText: expect.any(String),
    });
    expect(mocks.beginLocalSigning).toHaveBeenCalledWith(DOCUMENT_ID, OWNER_ID);
  });

  it.each([
    ["signing session", `/api/legal/documents/${DOCUMENT_ID}/signing-session`],
    ["signing completion", `/api/legal/documents/${DOCUMENT_ID}/sign`],
  ])("rejects %s without the signing request marker before calling a helper", async (_label, path) => {
    await request(app)
      .post(path)
      .set("x-user-id", String(OWNER_ID))
      .send({})
      .expect(403, {
        error: "Signing must be started from the authenticated Brikvest review screen.",
      });

    expect(mocks.beginLocalSigning).not.toHaveBeenCalled();
    expect(mocks.completeLocalSigning).not.toHaveBeenCalled();
  });

  it.each([
    ["signing session", `/api/legal/documents/${DOCUMENT_ID}/signing-session`],
    ["signing completion", `/api/legal/documents/${DOCUMENT_ID}/sign`],
  ])("rejects cross-origin %s before calling a helper", async (_label, path) => {
    await request(app)
      .post(path)
      .set("x-user-id", String(OWNER_ID))
      .set("X-Brikvest-Signing", "1")
      .set("Origin", "https://attacker.example.test")
      .send({})
      .expect(403, { error: "Cross-origin signing requests are not allowed." });

    expect(mocks.beginLocalSigning).not.toHaveBeenCalled();
    expect(mocks.completeLocalSigning).not.toHaveBeenCalled();
  });

  it("completes local signing with explicit consent, review, reauthentication, typed name, and PNG evidence", async () => {
    const password = "not-a-real-account-password";
    const body = {
      challengeToken: "local-signing-challenge",
      password,
      typedName: "Verified Investor",
      consent: true,
      reviewed: true,
      signaturePng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      signatureMethod: "drawn",
      consentVersion: "brikvest-local-signing-v1",
      unsignedPdfSha256: "a".repeat(64),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.spyOn(globalThis, "fetch");

    await request(app)
      .post(`/api/legal/documents/${DOCUMENT_ID}/sign`)
      .set("x-user-id", String(OTHER_USER_ID))
      .set("X-Brikvest-Signing", "1")
      .send(body)
      .expect(404);
    expect(mocks.completeLocalSigning).toHaveBeenCalledWith(
      DOCUMENT_ID,
      OTHER_USER_ID,
      body,
      expect.objectContaining({ ip: expect.any(String), userAgent: expect.any(String) }),
    );

    const owner = await request(app)
      .post(`/api/legal/documents/${DOCUMENT_ID}/sign`)
      .set("x-user-id", String(OWNER_ID))
      .set("X-Brikvest-Signing", "1")
      .send(body)
      .expect(200);

    expect(owner.body).toMatchObject({
      status: "investor_signed",
      documentId: DOCUMENT_ID,
      operationId: 91007,
      signedPdfSha256: "b".repeat(64),
      certificateSha256: "c".repeat(64),
    });
    expect(owner.text).not.toContain(password);
    expect(log.mock.calls.flat().join(" ")).not.toContain(password);
    expect(error.mock.calls.flat().join(" ")).not.toContain(password);
    expect(mocks.completeLocalSigning).toHaveBeenCalledTimes(2);
    expect(mocks.completeLocalSigning).toHaveBeenCalledWith(
      DOCUMENT_ID,
      OWNER_ID,
      body,
      expect.objectContaining({ ip: expect.any(String), userAgent: expect.any(String) }),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).not.toContain(password);
  });

  it.each([
    ["invalid challenge", { challengeToken: "expired" }, "The signing challenge is invalid or expired.", 409],
    ["missing PNG signature", { signaturePng: undefined }, "Draw a signature and submit it as a PNG no larger than 512 KB.", 400],
    ["invalid PNG signature", { signaturePng: "data:image/jpeg;base64,/9j/4AAQ" }, "Draw a signature and submit it as a valid PNG no larger than 512 KB.", 400],
    ["missing consent", { consent: false }, "Document review confirmation and electronic-signature consent are required.", 400],
  ])("rejects a local signing attempt with %s", async (_description, overrides, message, status) => {
    const body = {
      challengeToken: "local-signing-challenge",
      password: "not-a-real-account-password",
      typedName: "Verified Investor",
      consent: true,
      reviewed: true,
      signaturePng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      signatureMethod: "drawn",
      consentVersion: "brikvest-local-signing-v1",
      unsignedPdfSha256: "a".repeat(64),
      ...overrides,
    };
    mocks.completeLocalSigning.mockRejectedValueOnce(
      Object.assign(new Error(message), {
        statusCode: status,
      }),
    );

    const response = await request(app)
      .post(`/api/legal/documents/${DOCUMENT_ID}/sign`)
      .set("x-user-id", String(OWNER_ID))
      .set("X-Brikvest-Signing", "1")
      .send(body);
    expect(response.status).toBe(status);
    expect(response.body.error).toContain(message);
  });

  it("returns a local processing result without an external signing URL", async () => {
    const body = {
      challengeToken: "local-signing-challenge",
      password: "not-a-real-account-password",
      typedName: "Verified Investor",
      consent: true,
      reviewed: true,
      signaturePng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      signatureMethod: "drawn",
      consentVersion: "brikvest-local-signing-v1",
      unsignedPdfSha256: "a".repeat(64),
    };
    mocks.completeLocalSigning.mockResolvedValueOnce({
      status: "processing",
      documentId: DOCUMENT_ID,
      operationId: 91007,
    });

    const response = await request(app)
      .post(`/api/legal/documents/${DOCUMENT_ID}/sign`)
      .set("x-user-id", String(OWNER_ID))
      .set("X-Brikvest-Signing", "1")
      .send(body)
      .expect(200);

    expect(response.body).toEqual({
      status: "processing",
      documentId: DOCUMENT_ID,
      operationId: 91007,
    });
    expect(response.text).not.toMatch(/https?:\/\/|signingUrl|redirectUrl|provider/i);
    expect(mocks.completeLocalSigning).toHaveBeenCalledWith(
      DOCUMENT_ID,
      OWNER_ID,
      body,
      expect.objectContaining({ ip: expect.any(String), userAgent: expect.any(String) }),
    );
    expect(mocks.dispatchLegalJobs).not.toHaveBeenCalled();
  });

  it("rejects the retired external webhook endpoint", async () => {
    await request(app)
      .post("/api/legal/docusign/connect")
      .send({ event: "envelope-completed" })
      .expect(410);
  });

  it("requires admin authentication or the dedicated bearer secret to dispatch legal jobs", async () => {
    await request(app).post("/api/admin/legal/dispatch").expect(401);
    await request(app)
      .post("/api/admin/legal/dispatch")
      .set("x-admin-user-id", String(ADMIN_ID))
      .expect(200);

    await request(app).post("/api/legal/dispatch").expect(401);
    await request(app)
      .post("/api/legal/dispatch")
      .set("authorization", "Bearer wrong-secret")
      .expect(401);
    await request(app)
      .post("/api/legal/dispatch")
      .set("authorization", "Bearer route-test-dispatch-secret")
      .expect(200);
    expect(mocks.dispatchLegalJobs).toHaveBeenCalledTimes(2);
  });

  it("blocks retries for permanently investor-signed documents", async () => {
    pairStatus = "investor_signed";
    await request(app)
      .post(`/api/admin/legal/pairs/${PAIR_ID}/retry`)
      .send({ propertyId: 12 })
      .set("x-admin-user-id", String(ADMIN_ID))
      .expect(400, { error: "Investor-signed documents are permanently locked" });

    expect(mocks.pinActiveTemplatesAndQueue).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.some(([query]) =>
      compile(query).sql.includes("INSERT INTO legal_jobs"),
    )).toBe(false);
  });

  it("returns the actual notification-resend queue state instead of claiming every request queued", async () => {
    const response = await request(app)
      .post(`/api/admin/legal/pairs/${PAIR_ID}/resend`)
      .send({ propertyId: 12 })
      .set("x-admin-user-id", String(ADMIN_ID))
      .expect(200);

    expect(response.body).toMatchObject({
      state: "queued",
      queued: true,
      coalesced: false,
      cycleNumber: 1,
    });
    expect(mocks.requestLegalNotificationResend).toHaveBeenCalledWith(
      expect.anything(),
      PAIR_ID,
      ADMIN_ID,
    );
  });

  it("reports cooldown coalescing without saying an email was resent", async () => {
    mocks.requestLegalNotificationResend.mockResolvedValueOnce({
      state: "cooldown",
      queued: false,
      coalesced: true,
      cycleId: 1,
      cycleNumber: 1,
      message: "No new cycle was queued; wait one minute before requesting another resend.",
    });

    const response = await request(app)
      .post(`/api/admin/legal/pairs/${PAIR_ID}/resend`)
      .send({ propertyId: 12 })
      .set("x-admin-user-id", String(ADMIN_ID))
      .expect(200);

    expect(response.body).toMatchObject({
      state: "cooldown",
      queued: false,
      coalesced: true,
      message: expect.stringContaining("No new cycle was queued"),
    });
  });

  it("blocks an uncertain notification resend until delivery is reconciled", async () => {
    mocks.requestLegalNotificationResend.mockResolvedValueOnce({
      state: "blocked_uncertain",
      queued: false,
      coalesced: true,
      cycleId: 3,
      cycleNumber: 3,
      message: "Delivery status is uncertain. No resend was queued; reconcile the prior email delivery before requesting another send.",
    });

    const response = await request(app)
      .post(`/api/admin/legal/pairs/${PAIR_ID}/resend`)
      .send({ propertyId: 12 })
      .set("x-admin-user-id", String(ADMIN_ID))
      .expect(409);

    expect(response.body).toMatchObject({
      state: "blocked_uncertain",
      queued: false,
      message: expect.stringContaining("Delivery status is uncertain"),
    });
  });

  it("accepts transfer templates without deed payment fields and rejects missing required transfer fields", async () => {
    const validTransfer = useCanonicalDate(transferTemplateV1);
    const validation = validateLegalTemplate(validTransfer, "transfer_exit_rights");
    expect(validation.placeholderCounts.PAYMENT_AMOUNT_NAIRA_NUMERIC).toBeUndefined();
    expect(validation.placeholderCounts.PAYMENT_AMOUNT_NAIRA_WORDS).toBeUndefined();

    const uploaded = await request(app)
      .post("/api/admin/legal/templates")
      .set("x-admin-user-id", String(ADMIN_ID))
      .field("documentType", "transfer_exit_rights")
      .field("propertyId", "12")
      .attach("file", validTransfer, "transfer.docx");
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    expect(uploaded.body).toMatchObject({
      id: TEMPLATE_ID,
      version: 1,
      documentType: "transfer_exit_rights",
      validationStatus: "valid",
    });
    expect(mocks.storeLegalTemplateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "transfer_exit_rights", version: 1 }),
    );

    const malformedTransfer = replaceWordToken(
      validTransfer,
      "{{USER_HOME_ADDRESS}}",
      "{{MISSING_ADDRESS}}",
    );
    const invalid = await request(app)
      .post("/api/admin/legal/templates")
      .set("x-admin-user-id", String(ADMIN_ID))
      .field("documentType", "transfer_exit_rights")
      .field("propertyId", "12")
      .attach("file", malformedTransfer, "missing-address.docx")
      .expect(400);
    expect(invalid.body.error).toContain("Required placeholder is missing: {{USER_HOME_ADDRESS}}");
    expect(mocks.storeLegalTemplateVersion).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["deed_of_assignment", readFileSync(new URL("../server/legal/template-assets/deed_of_assignment_v1.docx", import.meta.url))],
    ["transfer_exit_rights", transferTemplateV1],
  ] as const)("preserves uploaded %s media through private download, preview, and activation", async (documentType, baseTemplate) => {
    templateBytes = addBodyImage(baseTemplate);
    activeTemplate = {
      ...activeTemplate,
      document_type: documentType,
      storage_key: `legal/templates/${documentType}/v1`,
      sha256: createHash("sha256").update(templateBytes).digest("hex"),
    };

    const uploaded = await request(app)
      .post("/api/admin/legal/templates")
      .set("x-admin-user-id", String(ADMIN_ID))
      .field("documentType", documentType)
      .field("propertyId", "12")
      .attach("file", templateBytes, `${documentType}.docx`)
      .expect(201);
    expect(uploaded.body).toMatchObject({ documentType, validationStatus: "valid" });
    expect(mocks.storeLegalTemplateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ documentType, docxBuffer: templateBytes }),
    );

    const download = await request(app)
      .get(`/api/admin/legal/templates/${TEMPLATE_ID}/download?propertyId=12`)
      .set("x-admin-user-id", String(ADMIN_ID))
      .buffer(true)
      .parse(parseBinaryBody)
      .expect(200);
    expect(download.body).toEqual(templateBytes);
    expectImagePreserved(download.body);

    const preview = await request(app)
      .get(`/api/admin/legal/templates/${TEMPLATE_ID}/preview?propertyId=12`)
      .set("x-admin-user-id", String(ADMIN_ID))
      .expect(200);
    expect(preview.headers["content-type"]).toContain("application/pdf");
    expect(mocks.convertDocxToPdf).toHaveBeenCalledTimes(1);
    const previewDocx = mocks.convertDocxToPdf.mock.calls[0][0] as Buffer;
    expectImagePreserved(previewDocx);

    await request(app)
      .post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
      .set("x-admin-user-id", String(ADMIN_ID))
      .send({ propertyId: 12 })
      .expect(200);
    expect(mocks.convertDocxToPdf).toHaveBeenCalledTimes(2);
    expectImagePreserved(mocks.convertDocxToPdf.mock.calls[1][0] as Buffer);
    expect(mocks.verifyAssigneeSignaturePosition).toHaveBeenCalledTimes(2);
  });

  it("rejects corrupt template bytes on admin download, preview, and activation without conversion", async () => {
    activeTemplate.sha256 = "0".repeat(64);
    for (const action of ["download", "preview"] as const) {
      await request(app)
        .get(`/api/admin/legal/templates/${TEMPLATE_ID}/${action}?propertyId=12`)
        .set("x-admin-user-id", String(ADMIN_ID))
        .expect(400, { error: "Stored template checksum mismatch" });
    }
    await request(app)
      .post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
      .set("x-admin-user-id", String(ADMIN_ID))
      .send({ propertyId: 12 })
      .expect(400, { error: "Stored template checksum mismatch" });
    expect(mocks.convertDocxToPdf).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("activates a validated template only after rendered PDF conversion and signature-position checks", async () => {
    const response = await request(app)
      .post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
      .send({ propertyId: 12 })
      .set("x-admin-user-id", String(ADMIN_ID));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.message).toContain("historical documents are unchanged");
    expect(mocks.convertDocxToPdf).toHaveBeenCalledTimes(1);
    expect(mocks.verifyAssigneeSignaturePosition).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const writesToHistoricalDocuments = mocks.execute.mock.calls
      .map(([query]) => compile(query).sql)
      .filter((query) => /UPDATE\s+legal_documents/i.test(query));
    expect(writesToHistoricalDocuments).toEqual([]);
  });

  it("refuses to activate a template whose required fields are invalid", async () => {
    templateBytes = replaceWordToken(
      transferTemplateV1,
      "{{PROPERTY_AREA_SQM}}",
      "",
    );
    activeTemplate.sha256 = createHash("sha256").update(templateBytes).digest("hex");

    const response = await request(app)
      .post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
      .send({ propertyId: 12 })
      .set("x-admin-user-id", String(ADMIN_ID));
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body.error).toContain("Required placeholder is missing: {{PROPERTY_AREA_SQM}}");
    expect(mocks.convertDocxToPdf).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});