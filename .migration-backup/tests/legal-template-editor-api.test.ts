import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import PizZip from "pizzip";
import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), transaction: vi.fn(), read: vi.fn(), store: vi.fn(), dispatch: vi.fn(),
}));
vi.mock("../server/db", () => ({ db: { execute: mocks.execute, transaction: mocks.transaction } }));
vi.mock("../server/legal/worker", () => ({ dispatchLegalJobs: mocks.dispatch }));
vi.mock("../server/legal/files", () => ({
  readLegalTemplateVersion: mocks.read, storeLegalTemplateVersion: mocks.store,
  streamAuthorizedLegalDocument: vi.fn(() => { throw new Error("Unexpected investor-document operation"); }),
}));
import { registerLegalRoutes } from "../server/legal/routes";
import { readTemplateEditor } from "../server/legal/template-editor";

const dialect = new PgDialect();
let queries: { sql: string; params: unknown[] }[] = [];
let sourceDeleted: boolean;
let databaseSourceGone: boolean;
let bytes: Buffer;
let sha: string;
const app = express();
app.use(express.json());
const admin = (req: any, res: any, next: any) => {
  if (req.get("Authorization") !== "Bearer editor-admin-fixture") return res.status(401).json({ error: "Administrator authentication required" });
  req.user = { userId: 9, role: "admin" };
  next();
};
registerLegalRoutes(app, { requireAdminAuth: admin, requireAuth: admin });
const endpoint = "/api/admin/legal/templates/73/editor";
const post = (overrides = {}) => request(app).post(endpoint).set("Authorization", "Bearer editor-admin-fixture")
  .send({ propertyId: 34, sourceSha256: sha, changes: [{ id: "word/document.xml:0", text: "Edited legal wording." }], ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  sourceDeleted = false;
  databaseSourceGone = false;
  queries = [];
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:r><w:t>Original legal wording.</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{USER_FULL_NAME}} {{USER_HOME_ADDRESS}} {{PROPERTY_AREA_SQM}} {{PAYMENT_AMOUNT_NAIRA_NUMERIC}} {{PAYMENT_AMOUNT_NAIRA_WORDS}} {{DOCUMENT_DATE}}</w:t></w:r></w:p>
    <w:sectPr/></w:body></w:document>`);
  bytes = zip.generate({ type: "nodebuffer" });
  sha = createHash("sha256").update(bytes).digest("hex");
  mocks.read.mockResolvedValue(bytes);
  mocks.store.mockResolvedValue("new-private-draft");
  mocks.transaction.mockImplementation((callback: any) => callback({ execute: mocks.execute }));
  mocks.execute.mockImplementation(async (query: any) => {
    const parsed = dialect.sqlToQuery(query);
    queries.push(parsed);
    if (/SELECT \* FROM legal_templates/.test(parsed.sql)) return {
      rows: !sourceDeleted && parsed.params[0] === 73 && parsed.params[1] === 34 ? [{
        id: 73, property_id: 34, document_type: "deed_of_assignment", version: 1,
        storage_key: "original-private-source", sha256: sha, is_active: true,
      }] : [],
    };
    if (/FROM legal_templates[\s\S]*FOR SHARE/.test(parsed.sql)) return { rows: databaseSourceGone ? [] : [{ id: 73 }] };
    if (/SELECT id FROM properties/.test(parsed.sql)) return { rows: [{ id: 34 }] };
    if (/MAX\(version\)/.test(parsed.sql)) return { rows: [{ version: 2 }] };
    if (/INSERT INTO legal_templates/.test(parsed.sql)) return { rows: [{ id: 74 }] };
    return { rows: [] };
  });
});

describe("administrator legal wording routes", () => {
  it("requires admin authentication for both read and save", async () => {
    expect((await request(app).get(`${endpoint}?propertyId=34`)).status).toBe(401);
    expect((await request(app).post(endpoint).send({ propertyId: 34 })).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("reads the immutable, checksum-verified source inside its property scope without writes", async () => {
    const response = await request(app).get(`${endpoint}?propertyId=34`).set("Authorization", "Bearer editor-admin-fixture");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({ templateId: 73, propertyId: 34, version: 1, sourceSha256: sha });
    expect(response.body.sections[0].paragraphs[0].text).toBe("Original legal wording.");
    expect(queries.every(query => query.sql.trim().startsWith("SELECT"))).toBe(true);
  });
  it("saves a validated NEW inactive version, recording original provenance, without investor writes or worker dispatch", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: 74, propertyId: 34, version: 2, documentType: "deed_of_assignment", validationStatus: "valid" });
    expect(mocks.store).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    const saved = mocks.store.mock.calls[0][0];
    expect(saved.propertyId).toBe(34);
    expect(readTemplateEditor(saved.docxBuffer)[0].paragraphs[0].text).toBe("Edited legal wording.");
    expect(readTemplateEditor(bytes)[0].paragraphs[0].text).toBe("Original legal wording.");
    const writes = queries.filter(query => /^(?:INSERT|UPDATE|DELETE)/i.test(query.sql.trim()));
    expect(writes.every(query => /INSERT INTO legal_(?:templates|audit_events)/.test(query.sql))).toBe(true);
    const insert = writes.find(query => /INSERT INTO legal_templates/.test(query.sql))!;
    // The shared upload insert uses the schema's inactive default, never activation.
    expect(insert.sql).not.toContain("is_active");
    const provenance = writes.find(query => query.params.includes("template_version_edited"))!;
    expect(provenance.params).toContain(9);
    expect(JSON.parse(provenance.params[3] as string)).toMatchObject({ sourceTemplateId: 73, sourceSha256: sha, changedParagraphs: 1 });
  });
  it("refuses cross-property, deleted and unassigned source access", async () => {
    expect((await post({ propertyId: 209 })).status).toBe(404);
    expect((await request(app).get(`${endpoint}?unassigned=true`).set("Authorization", "Bearer editor-admin-fixture")).status).toBe(400);
    sourceDeleted = true;
    expect((await post()).status).toBe(404);
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("refuses a stale source hash and a source deleted during the save transaction", async () => {
    expect((await post({ sourceSha256: "stale" })).status).toBe(409);
    databaseSourceGone = true;
    expect((await post()).status).toBe(409);
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("rejects invalid field edits and non-JSON submissions before writing", async () => {
    const response = await post({ changes: [{ id: "word/document.xml:1", text: "Remove all fields." }] });
    expect(response.status).toBe(422);
    expect(response.body.failure.code).toBe("EDITOR_PROTECTED_FIELDS");
    expect((await request(app).post(endpoint).set("Authorization", "Bearer editor-admin-fixture").type("form").send("propertyId=34")).status).toBe(415);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  });
});