import express, { type RequestHandler } from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import PizZip from "pizzip";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerLegalRoutes } from "../server/legal/routes";
import { prepareDocxForPdf } from "../server/legal/converter";
import { readDocxFontRequirements } from "../server/legal/font-validation";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  storeLegalTemplateVersion: vi.fn(),
  readLegalTemplateVersion: vi.fn(),
  streamAuthorizedLegalDocument: vi.fn(),
  bindLegalProperty: vi.fn(),
  getLegalPropertyBinding: vi.fn(),
  pinActiveTemplatesAndQueue: vi.fn(),
  requestLegalNotificationResend: vi.fn(),
  dispatchLegalJobs: vi.fn(),
  beginLocalSigning: vi.fn(),
  completeLocalSigning: vi.fn(),
  resolveFontFamily: vi.fn(),
  failConversion: false,
  failPlacement: false,
}));

vi.mock("../server/db", () => ({
  get db() {
    return { execute: mocks.execute, transaction: mocks.transaction };
  },
}));
vi.mock("../server/legal/files", () => ({
  storeLegalTemplateVersion: mocks.storeLegalTemplateVersion,
  readLegalTemplateVersion: mocks.readLegalTemplateVersion,
  streamAuthorizedLegalDocument: mocks.streamAuthorizedLegalDocument,
}));
vi.mock("../server/legal/repository", () => ({
  bindLegalProperty: mocks.bindLegalProperty,
  getLegalPropertyBinding: mocks.getLegalPropertyBinding,
  pinActiveTemplatesAndQueue: mocks.pinActiveTemplatesAndQueue,
  requestLegalNotificationResend: mocks.requestLegalNotificationResend,
}));
vi.mock("../server/legal/worker", () => ({
  dispatchLegalJobs: mocks.dispatchLegalJobs,
}));
vi.mock("../server/legal/local-signing", () => ({
  beginLocalSigning: mocks.beginLocalSigning,
  completeLocalSigning: mocks.completeLocalSigning,
}));
vi.mock("../server/legal/converter", async () => {
  const actual = await vi.importActual<typeof import("../server/legal/converter")>(
    "../server/legal/converter",
  );
  return {
    ...actual,
    convertDocxToPdf: async (bytes: Buffer, options?: Parameters<typeof actual.convertDocxToPdf>[1]) => {
      if (mocks.failConversion) throw new Error("isolated conversion failure");
      return actual.convertDocxToPdf(bytes, {
        ...options,
        resolveFontFamily: mocks.resolveFontFamily,
      });
    },
    verifyAssigneeSignaturePosition: async (
      bytes: Buffer,
      options: Parameters<typeof actual.verifyAssigneeSignaturePosition>[1],
    ) => {
      if (mocks.failPlacement) throw new Error("isolated signature placement failure");
      return actual.verifyAssigneeSignaturePosition(bytes, options);
    },
  };
});

const PROPERTY_ID = 148;
const TEMPLATE_ID = 1481;
const ADMIN_ID = 7;
const ORIGINAL_FONT = "Task148 Original Unavailable Serif";
const templateAsset = readFileSync(
  new URL("../server/legal/template-assets/transfer_exit_rights_v1.docx", import.meta.url),
);

function compile(query: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query as never);
}

const parseBinaryBody = (
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body?: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer | string) =>
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
  );
  response.on("end", () => callback(null, Buffer.concat(chunks)));
};

function withUnavailableOriginalFonts(input: Buffer): Buffer {
  const zip = new PizZip(input);
  const document = zip.file("word/document.xml")!.asText();
  const body = document.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/);
  if (!body) throw new Error("DOCX fixture is missing its document body");
  const sectionProperties = body[1].match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] ?? "";
  const textParagraph = (text: string) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${ORIGINAL_FONT}" w:hAnsi="${ORIGINAL_FONT}" w:eastAsia="${ORIGINAL_FONT}" w:cs="${ORIGINAL_FONT}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const compactContent = [
    "{{USER_FULL_NAME}}",
    "{{USER_HOME_ADDRESS}}",
    "{{PROPERTY_AREA_SQM}}",
    "{{DOCUMENT_DATE}}",
    "SIGNED SEALED AND DELIVERED",
    "By the within-named ASSIGNEE",
    "{{USER_FULL_NAME}}",
  ].map(textParagraph).join("");
  zip.file(
    "word/document.xml",
    document.replace(body[0], `<w:body>${compactContent}${sectionProperties}</w:body>`),
  );
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/^word\/.*\.xml$/i.test(name)) continue;
    const xml = entry.asText().replace(/<w:rFonts\b([^>]*)\/?>/g, (_tag, attributes: string) => {
      const rewritten = attributes.replace(
        /\b(w:(?:ascii|hAnsi|eastAsia|cs))="[^"]*"/g,
        (_attribute, name: string) => `${name}="${ORIGINAL_FONT}"`,
      );
      return `<w:rFonts${rewritten}/>`;
    });
    zip.file(name, xml);
  }
  return zip.generate({ type: "nodebuffer" });
}

function createApp() {
  const app = express();
  app.use(express.json());
  const requireAdminAuth: RequestHandler = (req: any, res, next) => {
    const userId = Number(req.header("x-admin-user-id"));
    if (!Number.isSafeInteger(userId) || userId <= 0) return res.sendStatus(401);
    req.user = { userId, role: "admin" };
    next();
  };
  const requireAuth: RequestHandler = (_req, _res, next) => next();
  registerLegalRoutes(app, { requireAuth, requireAdminAuth });
  return app;
}

let app: ReturnType<typeof createApp>;
let originalBytes: Buffer;
let template: Record<string, unknown>;
let sourceSha: string;
let draftActive: boolean;
let liveActive: boolean;
let activationUpdates: number;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.failConversion = false;
  mocks.failPlacement = false;
  originalBytes = withUnavailableOriginalFonts(Buffer.from(templateAsset));
  sourceSha = createHash("sha256").update(originalBytes).digest("hex");
  draftActive = false;
  liveActive = true;
  activationUpdates = 0;
  template = {
    id: TEMPLATE_ID,
    property_id: PROPERTY_ID,
    document_type: "transfer_exit_rights",
    version: 2,
    storage_key: "isolated/legal/template-v2",
    sha256: sourceSha,
    validation_status: "valid",
    is_active: false,
  };
  mocks.resolveFontFamily.mockImplementation((family: string) =>
    family === "Liberation Serif" ? "Liberation Serif" : "DejaVu Sans",
  );
  mocks.execute.mockImplementation(async (query: unknown) => {
    const { sql } = compile(query);
    if (sql.includes("SELECT * FROM legal_templates")) return { rows: [{ ...template }] };
    if (sql.includes("UPDATE legal_templates")) {
      activationUpdates += 1;
      if (sql.includes("SET is_active = false")) liveActive = false;
      if (sql.includes("SET is_active = true")) draftActive = true;
    }
    return { rows: [] };
  });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({ execute: mocks.execute }),
  );
  mocks.readLegalTemplateVersion.mockImplementation(async () => Buffer.from(originalBytes));
  mocks.storeLegalTemplateVersion.mockResolvedValue("isolated/legal/template");
  mocks.dispatchLegalJobs.mockResolvedValue({ processed: 0 });
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("legal template fallback-serif routes", () => {
  it.each(["development", "production"])(
    "previews and activates a valid immutable draft with real conversion and placement in %s",
    async (mode) => {
      const previousMode = process.env.NODE_ENV;
      process.env.NODE_ENV = mode;
      try {
        const fontRequirements = readDocxFontRequirements([originalBytes]);
        expect(fontRequirements.families).toContain(ORIGINAL_FONT);
        expect(fontRequirements.families).not.toContain("Liberation Serif");

        const workingCopy = prepareDocxForPdf(originalBytes, mocks.resolveFontFamily);
        expect(workingCopy).not.toEqual(originalBytes);
        expect(createHash("sha256").update(originalBytes).digest("hex")).toBe(sourceSha);
        const workingRequirements = readDocxFontRequirements([workingCopy]);
        expect(workingRequirements.families).toEqual(["Liberation Serif"]);
        const workingZip = new PizZip(workingCopy);
        const workingXml = Object.entries(workingZip.files)
          .filter(([name, entry]) => !entry.dir && /^word\/.*\.xml$/i.test(name))
          .map(([, entry]) => entry.asText()).join("\n");
        const fontSizes = Array.from(
          workingXml.matchAll(/<w:sz(?:Cs)?\b[^>]*w:val="([^"]+)"/g),
          (match) => match[1],
        );
        expect(fontSizes.length).toBeGreaterThan(0);
        expect(fontSizes.every((size) => size === "24")).toBe(true);

        const download = await request(app)
          .get(`/api/admin/legal/templates/${TEMPLATE_ID}/download?propertyId=${PROPERTY_ID}`)
          .set("x-admin-user-id", String(ADMIN_ID))
          .buffer(true)
          .parse(parseBinaryBody)
          .expect(200);
        expect(download.body).toEqual(originalBytes);
        expect(createHash("sha256").update(download.body).digest("hex")).toBe(sourceSha);

        const preview = await request(app)
          .get(`/api/admin/legal/templates/${TEMPLATE_ID}/preview?propertyId=${PROPERTY_ID}`)
          .set("x-admin-user-id", String(ADMIN_ID))
          .buffer(true)
          .parse(parseBinaryBody);
        expect(preview.status).toBe(200);
        expect(preview.headers["content-type"]).toContain("application/pdf");
        expect(preview.body.subarray(0, 5).toString()).toBe("%PDF-");
        expect(mocks.resolveFontFamily).toHaveBeenCalledWith(ORIGINAL_FONT);
        expect(mocks.resolveFontFamily).toHaveBeenCalledWith("Liberation Serif");
        expect(activationUpdates).toBe(0);
        expect(draftActive).toBe(false);
        expect(liveActive).toBe(true);

        await request(app)
          .post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
          .set("x-admin-user-id", String(ADMIN_ID))
          .send({ propertyId: PROPERTY_ID })
          .expect(200);
        expect(activationUpdates).toBe(2);
        expect(draftActive).toBe(true);
        expect(liveActive).toBe(false);
        expect(createHash("sha256").update(originalBytes).digest("hex")).toBe(sourceSha);
      } finally {
        if (previousMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousMode;
      }
    },
  );

  it("fails closed when the authorized Liberation Serif fallback is unavailable", async () => {
    mocks.resolveFontFamily.mockImplementation(() => "DejaVu Sans");
    const response = await request(app)
      .post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
      .set("x-admin-user-id", String(ADMIN_ID))
      .send({ propertyId: PROPERTY_ID })
      .expect(503);
    expect(response.body.failure.stage).toBe("conversion");
    expect(activationUpdates).toBe(0);
    expect(draftActive).toBe(false);
    expect(liveActive).toBe(true);
    expect(createHash("sha256").update(originalBytes).digest("hex")).toBe(sourceSha);
  });

  it("keeps the saved draft and live version when font verification infrastructure is unavailable", async () => {
    mocks.resolveFontFamily.mockImplementation(() => { throw new Error("isolated verification outage"); });
    const response = await request(app)
      .post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
      .set("x-admin-user-id", String(ADMIN_ID))
      .send({ propertyId: PROPERTY_ID })
      .expect(503);
    expect(response.body.failure.code).toBe("FONT_SERVICE_UNAVAILABLE");
    expect(response.body.failure.nextAction).toContain("saved draft");
    expect(activationUpdates).toBe(0);
    expect(draftActive).toBe(false);
    expect(liveActive).toBe(true);
  });

  it.each([
    ["stored checksum verification", "storage"],
    ["conversion", "conversion"],
    ["signature placement", "placement"],
  ])("does not write activation state after %s failure", async (_label, stage) => {
    if (stage === "storage") template.sha256 = "invalid-checksum";
    if (stage === "conversion") mocks.failConversion = true;
    if (stage === "placement") mocks.failPlacement = true;

    const response = await request(app)
      .post(`/api/admin/legal/templates/${TEMPLATE_ID}/activate`)
      .set("x-admin-user-id", String(ADMIN_ID))
      .send({ propertyId: PROPERTY_ID })
      .expect(503);
    expect(response.body.failure.stage).toBe(stage);
    expect(activationUpdates).toBe(0);
    expect(draftActive).toBe(false);
    expect(liveActive).toBe(true);
  });
});