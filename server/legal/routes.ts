import type { Express, RequestHandler } from "express";
import multer from "multer";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  pinActiveTemplatesAndQueue,
  requestLegalNotificationResend,
  type LegalNotificationResendResult,
} from "./repository";
import { validateLegalTemplate, renderIllustrativeLegalTemplate, getLegalTemplateFieldMetadata, type LegalDocumentType } from "./templates";
import { convertDocxToPdf, verifyAssigneeSignaturePosition } from "./converter";
import { buildIllustrativeTemplateValues } from "./values";
import { storeLegalTemplateVersion, readLegalTemplateVersion, streamAuthorizedLegalDocument } from "./files";
import { getLegalReadiness } from "../../scripts/legal-readiness";
import { correctUnsignedConsideration } from "./consideration-correction";
import { beginLocalSigning, completeLocalSigning } from "./local-signing";
import { assertActiveConfirmedHolding } from "./holding-state";
import { templateUploadInsert } from "./template-query";
import { AdminLegalInputError, adminLegalFailure } from "./admin-errors";
import type { LegalFailureStage } from "../../shared/legal-errors";
import { deleteLegalTemplateVersion, LegalTemplateDeletionError } from "./template-deletion";
import { searchHistoricalHoldings, prepareHistoricalHoldings } from "./historical-rollout";
import { hasExactPdfApproval, recordPdfApproval, reviewedDocuments, reviewSchemaInstalled } from "./pdf-review";
import { hasOutstandingLegalSignature } from "./invitation-state";
import { LEGAL_DISPATCH_PROTOCOL } from "./dispatch-maintenance";
import { readTemplateEditor, editTemplateWording } from "./template-editor";
import { dispatchLegalJobs, recoverLegalNotification } from "./worker";
import { legalApplicationOrigin } from "./application-origin";
import { HistoricalLoadInputError, historicalLoadError } from "./historical-load-errors";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 3 } });
const safeUpload: RequestHandler = (req, res, next) => upload.single("file")(req, res, (error) => {
  if (error) {
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    const result = adminLegalFailure(new AdminLegalInputError(
      tooLarge ? "UPLOAD_TOO_LARGE" : "UPLOAD_MULTIPART_REJECTED",
      tooLarge ? "The upload exceeds 20 MB." : "The upload could not be accepted.",
      tooLarge ? "Reduce the file size to 20 MB or less (for example, compress images in Word), save as .docx and upload again. Do not remove required fields." : "Choose one .docx file and the property and document type, then try again.",
      tooLarge ? 413 : 400,
    ), "upload");
    return res.status(result.status).json({ error: result.failure.summary, failure: result.failure });
  }
  next();
});
const rows = (result: any): any[] => result.rows || [];
function wakeLegalWorker() {
  if (process.env.NODE_ENV !== "test") void dispatchLegalJobs(3)
    .catch(() => console.error("[LEGAL] Work remains queued for the durable scheduler."));
}
const id = (value: unknown): number => {
  if ((typeof value !== "string" && typeof value !== "number") || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid record ID");
  return Number(value);
};
const templateHandler = (stage: LegalFailureStage, fn: (req: any, res: any) => Promise<unknown>): RequestHandler => (req: any, res) => {
  req.legalStage = stage;
  Promise.resolve(fn(req, res)).catch((error) => {
    if (res.headersSent) return;
    const result = adminLegalFailure(error, req.legalStage);
    if (req.legalInAppEditor && result.failure.code === "DOCUMENT_VALIDATION_REJECTED") {
      result.failure.nextAction = "Correct the listed wording issues in the editor and save again. No draft was saved or activated; existing investor documents are unchanged.";
    }
    res.status(result.status).json({ error: result.failure.summary, failure: result.failure });
  });
};
const templateId = (value: unknown): number => {
  try { return id(value); } catch {
    throw new AdminLegalInputError("INVALID_TEMPLATE_CONTEXT", "Choose a valid property and template.", "Select the property again and refresh its template list.");
  }
};
const handler = (fn: (req: any, res: any) => Promise<unknown>): RequestHandler => (req, res) => {
  Promise.resolve(fn(req, res)).catch((error) => {
    if (res.headersSent) return;
    const missing = (error as any)?.code === "42P01";
    const status = Number((error as any)?.statusCode || (error as any)?.status);
    res.status(missing ? 503 : status >= 400 && status <= 599 ? status : 400).json({
      error: missing ? "Legal-document database setup is required. Run the documented additive migrations." : error instanceof Error ? error.message : "Legal document operation failed",
    });
  });
};
function privateResponse(res: any, bytes: Buffer, contentType: string, filename: string, download = false) {
  res.set({ "Content-Type": contentType, "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  res.send(bytes);
}
const requireSameOriginSigning: RequestHandler = (req, res, next) => {
  if (!req.is("application/json") || req.get("X-Brikvest-Signing") !== "1") {
    return res.status(403).json({ error: "Signing must be started from the authenticated Brikvest review screen." });
  }
  const origin = req.get("origin");
  if (origin) {
    try {
      const source = new URL(origin);
      if (!["https:", "http:"].includes(source.protocol) || source.host !== req.get("host")) {
        return res.status(403).json({ error: "Cross-origin signing requests are not allowed." });
      }
    } catch { return res.status(403).json({ error: "Invalid signing origin." }); }
  }
  if (req.get("sec-fetch-site") === "cross-site") {
    return res.status(403).json({ error: "Cross-site signing requests are not allowed." });
  }
  next();
};
async function audit(tx: any, adminId: number, event: string, details: any, pairId: number | null = null) {
  await tx.execute(sql`INSERT INTO legal_audit_events (pair_id, actor_type, actor_id, event_type, details)
    VALUES (${pairId}, 'admin', ${adminId}, ${event}, ${JSON.stringify(details)}::jsonb)`);
}
async function saveTemplate(documentType: LegalDocumentType, bytes: Buffer, filename: string, adminId: number, propertyId: number, setStage: (stage: LegalFailureStage) => void, editSource?: { id: number; sha256: string; changedParagraphs: number }) {
  setStage("validation");
  const validation = validateLegalTemplate(bytes, documentType);
  // Serializes version allocation and upload; a failed DB commit can leave an
  // orphan object, never an overwritable version or active invalid template.
  setStage("save");
  return db.transaction(async (tx) => {
    if (!rows(await tx.execute(sql`SELECT id FROM properties WHERE id=${propertyId}`)).length) throw new AdminLegalInputError("PROPERTY_NOT_FOUND", "This property is no longer available.", "Refresh the property list and choose an available property.", 404);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"legal-template:" + documentType}))`);
    if (editSource && !rows(await tx.execute(sql`SELECT id FROM legal_templates
      WHERE id=${editSource.id} AND property_id=${propertyId} AND document_type=${documentType}
        AND sha256=${editSource.sha256} AND deleted_at IS NULL FOR SHARE`)).length) {
      throw new AdminLegalInputError("EDITOR_SOURCE_UNAVAILABLE", "The source version is no longer available.", "Reload the template list and reopen the editor. No draft was saved.", 409);
    }
    const version = rows(await tx.execute(sql`SELECT COALESCE(MAX(version), 0) + 1 AS version FROM legal_templates WHERE document_type = ${documentType}`))[0].version;
    const sha = createHash("sha256").update(bytes).digest("hex");
    setStage("storage");
    const key = await storeLegalTemplateVersion({ documentType, version, docxBuffer: bytes, propertyId, uploadId: randomUUID() });
    setStage("save");
    const result = rows(await tx.execute(templateUploadInsert({ propertyId, documentType, version, filename, key, sha, byteSize: bytes.length, placeholders: Object.keys(validation.placeholderCounts), adminId })))[0];
    await audit(tx, adminId, "template_version_uploaded", { templateId: result.id, propertyId, documentType, version, sha256: sha });
    if (editSource) await audit(tx, adminId, "template_version_edited", {
      templateId: result.id, propertyId, documentType, version, sha256: sha,
      sourceTemplateId: editSource.id, sourceSha256: editSource.sha256, changedParagraphs: editSource.changedParagraphs,
    });
    return { id: result.id, propertyId, version, documentType, validationStatus: "valid" };
  });
}
async function listPairs(userId?: number, propertyId?: number) {
  const result = rows(await db.execute(sql`SELECT p.*, pr.name AS property_name, u.email AS user_email,
    dt.version AS deed_template_version, tt.version AS transfer_template_version
    FROM legal_document_pairs p JOIN properties pr ON pr.id = p.property_id JOIN users u ON u.id = p.user_id
    LEFT JOIN legal_templates dt ON dt.id = p.deed_template_id
    LEFT JOIN legal_templates tt ON tt.id = p.transfer_template_id
     WHERE ${userId === undefined ? sql`true` : sql`p.user_id = ${userId}`}
     AND ${propertyId === undefined ? sql`true` : sql`p.property_id = ${propertyId}`} ORDER BY p.created_at DESC LIMIT 500`));
  if (!result.length) return [];
  const documents = rows(await db.execute(sql`SELECT id,pair_id,document_type,status,unsigned_pdf_key IS NOT NULL AS has_unsigned,
    signed_pdf_key IS NOT NULL AS has_signed,signing_certificate_key IS NOT NULL AS has_certificate
    FROM legal_documents WHERE pair_id IN (${sql.join(result.map((p) => sql`${p.id}`), sql`,`)}) AND superseded_at IS NULL ORDER BY document_type`));
  const signingSchema = rows(await db.execute(sql`SELECT to_regclass('public.local_legal_signing_operations') IS NOT NULL AS installed`))[0];
  const operations = signingSchema?.installed ? rows(await db.execute(sql`SELECT document_id,pair_id,status,last_error
    FROM local_legal_signing_operations WHERE pair_id IN (${sql.join(result.map((p) => sql`${p.id}`), sql`,`)})`)) : [];
  return result.map((p) => ({
    id: p.id, reservationId: p.reservation_id, propertyId: p.property_id,
    propertyName: /\bSD118\b/i.test(p.property_name || "") ? "LilyCrest Garden Estate" : p.property_name,
    area: p.property_area_sqm, status: p.status, userEmail: userId === undefined ? p.user_email : undefined,
    userName: userId === undefined ? p.full_name_snapshot : undefined, approvalSource: p.approval_source,
    approvalSourceId: p.approval_source_id, approvedAt: p.approved_at, deedTemplateId: p.deed_template_id,
    transferTemplateId: p.transfer_template_id, deedTemplateVersion: p.deed_template_version,
    transferTemplateVersion: p.transfer_template_version, error: p.last_error || operations.find((o) => o.pair_id === p.id && o.last_error)?.last_error,
    signingStatus: operations.find((o) => o.pair_id === p.id && o.status !== "completed")?.status || (operations.some((o) => o.pair_id === p.id) ? "completed" : undefined),
    documents: documents.filter((d) => d.pair_id === p.id).map((d) => ({
      id: d.id, type: d.document_type, status: d.status, hasUnsignedPdf: d.has_unsigned,
      hasSignedPdf: d.has_signed, hasCertificate: d.has_certificate,
      signingStatus: operations.find((o) => o.document_id === d.id)?.status,
    })),
  }));
}
export function registerLegalRoutes(app: Express, auth: { requireAuth: RequestHandler; requireAdminAuth: RequestHandler }) {
  app.use("/api/legal", (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  app.use("/api/admin/legal", (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  // Read-only, non-personal rollout verification; never claims a job or sends
  // mail. The protocol identifies the release that guards every dispatch path.
  app.get("/api/legal/rollout-status", handler(async (_req, res) => {
    let applicationOrigin: string | null = null;
    try { applicationOrigin = legalApplicationOrigin(process.env.APP_BASE_URL).origin; } catch { /* No configuration values on failure. */ }
    res.json({
      dispatchProtocol: LEGAL_DISPATCH_PROTOCOL,
      notificationRecoveryProtocol: "exact-existing-notification-v1",
      applicationOrigin,
      notificationEmailConfigured: Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()),
      pdfReviewSchemaInstalled: await reviewSchemaInstalled(db),
      startupDataMaintenanceSkipped: process.env.SKIP_STARTUP_DATA_MAINTENANCE === "true",
    });
  }));
  app.get("/api/legal/holdings", auth.requireAuth, handler(async (req, res) => res.json(await listPairs(req.user.id))));
  app.get("/api/admin/legal/documents", auth.requireAdminAuth, handler(async (req, res) => res.json(await listPairs(undefined, id(req.query.propertyId)))));
  app.get("/api/admin/legal/historical-holdings", auth.requireAdminAuth, async (req, res) => {
    let propertyId: number | undefined;
    try {
      try { propertyId = id(req.query.propertyId); } catch { throw new HistoricalLoadInputError("HOLDINGS_INVALID_REQUEST"); }
      if (["search", "page", "pageSize"].some(key => req.query[key] !== undefined && typeof req.query[key] !== "string")) {
        throw new HistoricalLoadInputError("HOLDINGS_INVALID_REQUEST");
      }
      res.json(await searchHistoricalHoldings({
        propertyId, search: String(req.query.search || ""),
        page: req.query.page === undefined ? 1 : Number(req.query.page),
        pageSize: req.query.pageSize === undefined ? 20 : Number(req.query.pageSize),
      }));
    } catch (error) {
      const failure = historicalLoadError(error);
      const reference = randomUUID();
      // No SQL, search text, investor data, credentials or raw exceptions.
      console.error("[LEGAL_HOLDINGS_LOAD]", JSON.stringify({
        reference, propertyId, code: failure.code, sqlState: failure.sqlState,
      }));
      res.status(failure.status).json({ code: failure.code, error: failure.summary, nextAction: failure.nextAction, reference });
    }
  });
  app.post("/api/admin/legal/historical-holdings/prepare", auth.requireAdminAuth, handler(async (req, res) => {
    const result = await prepareHistoricalHoldings({ ...req.body, propertyId: id(req.body.propertyId), adminId: req.user.userId });
    if (result.results.some(r => r.state === "queued")) wakeLegalWorker();
    res.json(result);
  }));
  app.get("/api/admin/legal/failures", auth.requireAdminAuth, handler(async (req, res) => res.json(rows(await db.execute(sql`
    SELECT a.id,a.reservation_id AS "reservationId",a.event_type AS "eventType",a.details,a.created_at AS "createdAt"
     FROM legal_audit_events a
     LEFT JOIN legal_document_pairs p ON p.id=a.pair_id
     LEFT JOIN investment_reservations r ON r.id=a.reservation_id
     WHERE (a.event_type LIKE '%blocked%' OR a.event_type LIKE '%failed%')
       AND COALESCE(p.property_id::text,r.property_id::text,a.details->>'propertyId')=${String(id(req.query.propertyId))}
    ORDER BY a.id DESC LIMIT 100`)))));
  app.get("/api/admin/legal/templates", auth.requireAdminAuth, handler(async (req, res) => res.json(rows(await db.execute(sql`
      SELECT t.id, t.property_id AS "propertyId", t.document_type AS "documentType", t.version, t.validation_status AS "validationStatus",
      t.is_active AS active, t.created_at AS "createdAt", t.activated_at AS "activatedAt", t.sha256,
      CASE WHEN t.is_active THEN 'active'
        WHEN EXISTS (SELECT 1 FROM legal_document_pairs p
          WHERE p.deed_template_id = t.id OR p.transfer_template_id = t.id)
          OR EXISTS (SELECT 1 FROM legal_documents d WHERE d.template_id = t.id)
        THEN 'referenced' ELSE NULL END AS "deletionBlockedReason"
      FROM legal_templates t
      WHERE t.deleted_at IS NULL
        AND ${req.query.unassigned === "true" ? sql`t.property_id IS NULL` : sql`t.property_id=${id(req.query.propertyId)}`}
      ORDER BY t.document_type, t.version DESC`)))));
  app.get("/api/admin/legal/readiness", auth.requireAdminAuth, handler(async (_req, res) => {
    const config = getLegalReadiness();
    const checks = [...config.checks];
    try {
      await db.execute(sql`SELECT property_id, deleted_at, deleted_by_admin_id FROM legal_templates LIMIT 0`);
      checks.push({ id: "legal-schema", ready: true, detail: "Property-owned legal schema installed." });
    } catch { checks.push({ id: "legal-schema", ready: false, detail: "Legal-document database migrations have not been applied." }); }
    const localSchema = rows(await db.execute(sql`SELECT to_regclass('public.local_legal_signing_operations') IS NOT NULL AS installed`))[0];
    checks.push({ id: "local-signing-schema", ready: !!localSchema?.installed, detail: localSchema?.installed ? "In-app signing schema installed." : "The additive in-app signing migration must be installed." });
    const reviewReady = await reviewSchemaInstalled(db);
    checks.push({ id: "pdf-review-schema", ready: reviewReady, detail: reviewReady ? "PDF review approvals installed." : "Apply the additive PDF review migration before approving or sending invitations." });
    const blockers = checks.filter((check) => !check.ready).map((check) => check.detail);
    res.json({ ready: blockers.length === 0, configured: config.ready, signingMode: "brikvest_local", checks, blockers });
  }));
  app.post("/api/admin/legal/binding", auth.requireAdminAuth, (_req, res) => res.status(410).json({ error: "Area binding is retired. Every new legal holding uses 5 m² per unit." }));
  app.get("/api/admin/legal/holdings/:id", auth.requireAdminAuth, handler(async (req, res) => {
    const holding = rows(await db.execute(sql`SELECT id,property_id AS "propertyId",status,amount,currency,units,user_id AS "userId" FROM investment_reservations WHERE id = ${id(req.params.id)}`))[0];
    if (!holding) return res.status(404).json({ error: "Holding not found" });
    if (Number(holding.propertyId) !== id(req.query.propertyId)) return res.status(404).json({ error: "Holding not found" });
    res.json(holding);
  }));
  app.get("/api/admin/legal/properties/:id", auth.requireAdminAuth, handler(async (req, res) => {
    const propertyId = id(req.params.id);
    const property = rows(await db.execute(sql`SELECT id,name,location,plot_number AS "plotNumber",currency FROM properties WHERE id=${propertyId}`))[0];
    if (!property) return res.status(404).json({ error: "Property not found" });
    res.json(property);
  }));
  app.post("/api/admin/legal/templates", auth.requireAdminAuth, safeUpload, templateHandler("upload", async (req, res) => {
    const type = req.body.documentType;
    if (!["deed_of_assignment", "transfer_exit_rights"].includes(type)) throw new AdminLegalInputError("DOCUMENT_TYPE_REQUIRED", "Choose a supported legal document type.", "Select Deed of Assignment or Transfer and Exit Rights Agreement, then upload.");
    if (!req.file || !/\.docx$/i.test(req.file.originalname)) throw new AdminLegalInputError("WRONG_FILE_FORMAT", "A Microsoft Word .docx file is required.", "Open the source in Word and use Save As → Word Document (.docx). Renaming a PDF or .doc file is not enough.");
    res.status(201).json(await saveTemplate(type, req.file.buffer, req.file.originalname, req.user.userId, templateId(req.body.propertyId), (stage) => { req.legalStage = stage; }));
  }));
  app.post("/api/admin/legal/templates/import-initial", auth.requireAdminAuth, (_req, res) => res.status(410).json({ error: "Upload property-specific legal forms. Bundled forms cannot be automatically assigned." }));
  app.post("/api/admin/legal/templates/:id/assign", auth.requireAdminAuth, handler(async (req, res) => {
    const templateId = id(req.params.id);
    const propertyId = id(String(req.body.propertyId));
    if (req.body.confirmed !== true) throw new Error("Explicit confirmation of the template destination is required");
    await db.transaction(async (tx) => {
      if (!rows(await tx.execute(sql`SELECT id FROM properties WHERE id=${propertyId}`)).length) throw new Error("Property not found");
      const assigned = rows(await tx.execute(sql`UPDATE legal_templates SET property_id=${propertyId}
        WHERE id=${templateId} AND property_id IS NULL AND NOT is_active AND deleted_at IS NULL RETURNING id`))[0];
      if (!assigned) throw new Error("Only an unassigned, inactive legacy template may be assigned. Ownership cannot be changed.");
      await audit(tx, req.user.userId, "template_property_explicitly_assigned", { templateId, propertyId });
    });
    res.json({ message: "Template assigned. Review and activate it separately.", templateId, propertyId });
  }));
  app.delete("/api/admin/legal/templates/:id", auth.requireAdminAuth, templateHandler("deletion", async (req, res) => {
    const selectedTemplateId = templateId(req.params.id);
    const propertyId = templateId(req.body?.propertyId ?? req.query.propertyId);
    if (req.body?.confirmed !== true) throw new AdminLegalInputError(
      "TEMPLATE_DELETE_CONFIRMATION_REQUIRED",
      "Confirm deletion of this exact property template version.",
      "Review the property, document type and version, then confirm the deletion explicitly.",
      400,
    );
    try {
      const result = await deleteLegalTemplateVersion({
        templateId: selectedTemplateId,
        propertyId,
        adminId: req.user.userId,
      });
      if (!result.deleted) throw new AdminLegalInputError(
        "TEMPLATE_NOT_FOUND",
        "The template is not available in this property workspace.",
        "Refresh this property’s template list and select a version again.",
        404,
      );
      res.json({ message: "Template version logically deleted; its source and audit provenance are retained.", templateId: selectedTemplateId });
    } catch (error) {
      if (error instanceof LegalTemplateDeletionError) {
        throw new AdminLegalInputError(
          error.reason === "active" ? "TEMPLATE_DELETE_ACTIVE" : "TEMPLATE_DELETE_REFERENCED",
          error.message,
          error.reason === "active"
            ? "Activate another valid version for this property and document type before deleting this version."
            : "This version is retained because a current or historical legal document pair or generated document references it.",
          409,
        );
      }
      throw error;
    }
  }));
  for (const action of ["download", "preview", "fields"] as const) {
    app.get(`/api/admin/legal/templates/:id/${action}`, auth.requireAdminAuth, templateHandler(action === "preview" ? "preview" : "inspection", async (req, res) => {
      const t = rows(await db.execute(sql`SELECT * FROM legal_templates WHERE id = ${templateId(req.params.id)}
        AND deleted_at IS NULL
        AND ${req.query.unassigned === "true" ? sql`property_id IS NULL` : sql`property_id=${templateId(req.query.propertyId)}`}`))[0];
      if (!t) throw new AdminLegalInputError("TEMPLATE_NOT_FOUND", "The template is not available in this property workspace.", "Refresh this property’s template list and select a version again.", 404);
      req.legalStage = "storage";
      const bytes = await readLegalTemplateVersion(t.storage_key);
      if (createHash("sha256").update(bytes).digest("hex") !== t.sha256) throw new Error("Stored template checksum mismatch");
      req.legalStage = "inspection";
      if (action === "fields") return res.json({
        templateId: t.id, propertyId: t.property_id, documentType: t.document_type, version: t.version,
        active: t.is_active, ...getLegalTemplateFieldMetadata(bytes, t.document_type),
      });
      if (action === "download") return privateResponse(res, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `template-${t.document_type}-v${t.version}.docx`, true);
      req.legalStage = "render";
      const preview = renderIllustrativeLegalTemplate(bytes, t.document_type);
      req.legalStage = "conversion";
      const pdf = await convertDocxToPdf(preview.renderedDocx);
      req.legalStage = "placement";
      await verifyAssigneeSignaturePosition(pdf, { templateVersionId: String(t.id), assigneeFullName: buildIllustrativeTemplateValues(t.document_type).USER_FULL_NAME });
      privateResponse(res, pdf, "application/pdf", "illustrative-template-preview.pdf");
    }));
  }
  const editorSource = async (req: any, propertyId: number) => {
    const template = rows(await db.execute(sql`SELECT * FROM legal_templates
      WHERE id=${templateId(req.params.id)} AND property_id=${propertyId} AND deleted_at IS NULL`))[0];
    if (!template) throw new AdminLegalInputError("TEMPLATE_NOT_FOUND", "The template is not available in this property workspace.", "Refresh the property’s template list and select a version again.", 404);
    req.legalStage = "storage";
    const bytes = await readLegalTemplateVersion(template.storage_key);
    if (createHash("sha256").update(bytes).digest("hex") !== template.sha256) throw new Error("Stored template checksum mismatch");
    req.legalStage = "inspection";
    return { template, bytes };
  };
  app.get("/api/admin/legal/templates/:id/editor", auth.requireAdminAuth, templateHandler("inspection", async (req, res) => {
    const { template, bytes } = await editorSource(req, templateId(req.query.propertyId));
    res.set("Cache-Control", "private, no-store").json({
      templateId: template.id, propertyId: template.property_id, documentType: template.document_type,
      version: template.version, sourceSha256: template.sha256, sections: readTemplateEditor(bytes),
    });
  }));
  app.post("/api/admin/legal/templates/:id/editor", auth.requireAdminAuth, templateHandler("save", async (req, res) => {
    req.legalInAppEditor = true;
    if (!req.is("application/json")) throw new AdminLegalInputError("EDITOR_JSON_REQUIRED", "Save wording changes from the in-app editor.", "Reopen Edit wording and try again.", 415);
    const propertyId = templateId(req.body.propertyId);
    const { template, bytes } = await editorSource(req, propertyId);
    if (req.body.sourceSha256 !== template.sha256) throw new AdminLegalInputError(
      "EDITOR_SOURCE_CHANGED", "The editor’s source does not match this template version.", "Reload the source version before saving. No template was changed.", 409,
    );
    req.legalStage = "validation";
    const edited = editTemplateWording(bytes, req.body.changes);
    const saved = await saveTemplate(template.document_type, edited.bytes,
      `edited-${template.document_type}-from-v${template.version}.docx`, req.user.userId, propertyId,
      (stage) => { req.legalStage = stage; },
      { id: template.id, sha256: template.sha256, changedParagraphs: edited.changedParagraphs });
    res.status(201).json(saved);
  }));
  app.post("/api/admin/legal/templates/:id/activate", auth.requireAdminAuth, templateHandler("activation", async (req, res) => {
    const selectedTemplateId = templateId(req.params.id);
    const propertyId = templateId(req.body.propertyId);
    const t = rows(await db.execute(sql`SELECT * FROM legal_templates WHERE id = ${selectedTemplateId} AND property_id=${propertyId} AND deleted_at IS NULL`))[0];
    if (!t) throw new AdminLegalInputError("TEMPLATE_NOT_FOUND", "The template is not available in this property workspace.", "Refresh this property’s template list and select a version again.", 404);
    req.legalStage = "storage";
    const bytes = await readLegalTemplateVersion(t.storage_key);
    if (createHash("sha256").update(bytes).digest("hex") !== t.sha256) throw new Error("Stored template checksum mismatch");
    req.legalStage = "render";
    const preview = renderIllustrativeLegalTemplate(bytes, t.document_type);
    req.legalStage = "conversion";
    const pdf = await convertDocxToPdf(preview.renderedDocx);
    req.legalStage = "placement";
    await verifyAssigneeSignaturePosition(pdf, { templateVersionId: String(t.id), assigneeFullName: buildIllustrativeTemplateValues(t.document_type).USER_FULL_NAME });
    req.legalStage = "activation";
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"legal-template:" + propertyId + ":" + t.document_type}))`);
      if (t.validation_status !== "valid") throw new AdminLegalInputError("TEMPLATE_NOT_VALIDATED", "This version is not validated and cannot be activated.", "Inspect its fields and upload a corrected, valid Word version.", 422);
      await tx.execute(sql`UPDATE legal_templates SET is_active = false WHERE property_id=${propertyId} AND document_type = ${t.document_type} AND is_active`);
      const activation = rows(await tx.execute(sql`UPDATE legal_templates SET is_active = true,activated_at = now()
        WHERE id = ${selectedTemplateId} AND property_id=${propertyId}
          AND validation_status = 'valid' AND deleted_at IS NULL RETURNING id`))[0];
      if (!activation) throw new AdminLegalInputError(
        "TEMPLATE_NOT_FOUND",
        "The template is no longer available for activation.",
        "Refresh the property template list and select an undeleted version again.",
        404,
      );
      await audit(tx, req.user.userId, "template_version_activated", { templateId: selectedTemplateId, propertyId, version: t.version, signaturePlacementVerified: true });
    });
    res.json({ message: "Template activated; historical documents are unchanged" });
  }));
  for (const action of ["preview", "download"] as const) {
    const serve = (isAdmin: boolean) => handler(async (req, res) => {
      const doc = rows(await db.execute(sql`SELECT d.*,p.user_id FROM legal_documents d JOIN legal_document_pairs p ON p.id=d.pair_id
          WHERE d.id=${id(req.params.id)} AND ${isAdmin ? sql`p.property_id=${id(req.query.propertyId)}` : sql`p.user_id=${req.user.id} AND d.superseded_at IS NULL`}`))[0];
      if (!doc) return res.status(404).json({ error: "Legal document not found" });
      const version = req.query.version || "unsigned";
      const key = version === "signed" ? doc.signed_pdf_key : version === "certificate" ? doc.signing_certificate_key : version === "docx" ? doc.source_docx_key : version === "unsigned" ? doc.unsigned_pdf_key : null;
      if (!key) return res.status(404).json({ error: "The requested artifact is not ready" });
      await streamAuthorizedLegalDocument(res, { requesterUserId: isAdmin ? req.user.userId : req.user.id, requesterIsAdmin: isAdmin, documentOwnerUserId: doc.user_id, storageReference: key, disposition: action === "download" ? "attachment" : "inline" });
    });
    app.get(`/api/legal/documents/:id/${action}`, auth.requireAuth, serve(false));
    app.get(`/api/admin/legal/documents/:id/${action}`, auth.requireAdminAuth, serve(true));
  }
  app.post("/api/legal/documents/:id/signing-session", auth.requireAuth, requireSameOriginSigning, handler(async (req, res) => {
    res.json(await beginLocalSigning(id(req.params.id), req.user.id));
  }));
  app.post("/api/legal/documents/:id/sign", auth.requireAuth, requireSameOriginSigning, handler(async (req, res) => {
    const signing = await completeLocalSigning(id(req.params.id), req.user.id, req.body, {
      ip: String(req.ip || req.socket?.remoteAddress || "").slice(0, 100),
      userAgent: String(req.get("user-agent") || "").slice(0, 500),
    });
    if (signing.status === "processing" && process.env.NODE_ENV !== "test") {
      void dispatchLegalJobs(3).catch(() => console.error("[LEGAL] Signing finalization deferred to the durable scheduler."));
    }
    res.json(signing);
  }));
  app.get("/api/admin/legal/pairs/:id/audit", auth.requireAdminAuth, handler(async (req, res) => res.json(rows(await db.execute(sql`
    SELECT id,actor_type AS "actorType",actor_id AS "actorId",event_type AS "eventType",details,created_at AS "createdAt"
     FROM legal_audit_events WHERE pair_id=${id(req.params.id)}
       AND EXISTS (SELECT 1 FROM legal_document_pairs p WHERE p.id=pair_id AND p.property_id=${id(req.query.propertyId)})
     ORDER BY id`)))));
  app.get("/api/admin/legal/pairs/:id/review", auth.requireAdminAuth, handler(async (req, res) => {
    const pairId = id(req.params.id), propertyId = id(req.query.propertyId);
    const result = await db.transaction(async tx => {
      const pair = rows(await tx.execute(sql`SELECT p.*,pr.name AS property_name FROM legal_document_pairs p
        JOIN properties pr ON pr.id=p.property_id WHERE p.id=${pairId} AND p.property_id=${propertyId}`))[0];
      if (!pair) throw Object.assign(new Error("Legal document pair not found"), { statusCode: 404 });
      const documents = await reviewedDocuments(tx, pairId);
      return { pairId, propertyId, reservationId: pair.reservation_id, investorName: pair.full_name_snapshot,
        propertyName: pair.property_name, approved: await hasExactPdfApproval(tx, pairId),
        documents: documents.map(d => ({ id: d.id, type: d.document_type, sha256: d.unsigned_pdf_sha256,
          templateId: d.template_id, templateVersion: d.template_version })) };
    });
    res.json(result);
  }));
  app.post("/api/admin/legal/pairs/:id/correct-consideration", auth.requireAdminAuth, handler(async (req, res) => {
    if (req.body.confirmed !== true) throw new Error("Explicit confirmation of unsigned draft correction is required.");
    const pairId = id(req.params.id), propertyId = id(req.body.propertyId);
    const result = await correctUnsignedConsideration(pairId, propertyId, req.user.userId);
    if (result.changed && process.env.NODE_ENV !== "test") {
      void dispatchLegalJobs(3).catch(() => console.error("[LEGAL] Corrected draft generation remains queued."));
    }
    res.json({ ...result, message: result.changed
      ? "Corrected land-only drafts queued. Originals and payment history are retained. Review both new PDFs before approving any email."
      : "These drafts already use the corrected land-only consideration." });
  }));
  app.post("/api/admin/legal/pairs/:id/approve-send", auth.requireAdminAuth, handler(async (req, res) => {
    const pairId = id(req.params.id), propertyId = id(req.body.propertyId);
    const result = await db.transaction(async tx => {
      const reference = rows(await tx.execute(sql`SELECT reservation_id,user_id,property_id FROM legal_document_pairs
        WHERE id=${pairId} AND property_id=${propertyId}`))[0];
      if (!reference) throw Object.assign(new Error("Legal document pair not found"), { statusCode: 404 });
      await assertActiveConfirmedHolding(tx, { reservationId: Number(reference.reservation_id), userId: Number(reference.user_id), propertyId });
      const pair = rows(await tx.execute(sql`SELECT * FROM legal_document_pairs WHERE id=${pairId} AND property_id=${propertyId} FOR UPDATE`))[0];
      if (!pair || Number(pair.user_id) !== Number(reference.user_id) || Number(pair.reservation_id) !== Number(reference.reservation_id)) throw new Error("Holding identity changed. Refresh and review again.");
      if (!pair.documents_ready_at || !await hasOutstandingLegalSignature(tx, pairId)) throw new Error("No outstanding signing invitation is permitted for this pair.");
      const created = await recordPdfApproval(tx, pairId, req.user.userId, req.body);
      if (!created) {
        const cycle = rows(await tx.execute(sql`SELECT c.*,j.status AS job_status FROM legal_notification_cycles c
          LEFT JOIN legal_jobs j ON j.notification_cycle_id=c.id AND j.kind='notify'
          WHERE c.pair_id=${pairId} ORDER BY c.cycle_number DESC LIMIT 1`))[0];
        if (cycle) return { queued: ["queued","retry"].includes(cycle.job_status), coalesced: true,
          state: cycle.status === "uncertain" ? "blocked_uncertain" : cycle.status, cycleId: cycle.id,
          cycleNumber: cycle.cycle_number, message: "This PDF review was already approved. No additional invitation was created; use the separate resend action if needed." };
      }
      return requestLegalNotificationResend(tx, pairId, req.user.userId);
    });
    if (result.queued) wakeLegalWorker();
    res.status(result.state === "blocked_uncertain" ? 409 : 200).json(result);
  }));
  for (const action of ["retry", "resend"] as const) app.post(`/api/admin/legal/pairs/:id/${action}`, auth.requireAdminAuth, handler(async (req, res) => {
    const pairId = id(req.params.id);
    const propertyId = id(req.body.propertyId);
    let resendResult: LegalNotificationResendResult | undefined;
    await db.transaction(async (tx) => {
      const reference = rows(await tx.execute(sql`
        SELECT reservation_id, user_id, property_id
        FROM legal_document_pairs WHERE id = ${pairId} AND property_id=${propertyId}
      `))[0];
      if (!reference) throw new Error("Legal document pair not found");
      const holdingIdentity = {
        reservationId: Number(reference.reservation_id),
        userId: Number(reference.user_id),
        propertyId: Number(reference.property_id),
      };
      await assertActiveConfirmedHolding(tx, holdingIdentity);
      const p = rows(await tx.execute(sql`SELECT * FROM legal_document_pairs WHERE id=${pairId} FOR UPDATE`))[0];
      if (!p) throw new Error("Legal document pair not found");
      if (
        Number(p.reservation_id) !== holdingIdentity.reservationId ||
        Number(p.user_id) !== holdingIdentity.userId ||
        Number(p.property_id) !== holdingIdentity.propertyId
      ) {
        throw new Error("The legal approval no longer matches its confirmed investor holding");
      }
      if (action === "retry" && p.status === "investor_signed") throw new Error("Investor-signed documents are permanently locked");
      if (action === "resend") {
        resendResult = await requestLegalNotificationResend(tx, pairId, req.user.userId);
        return;
      }
      if (action === "retry" && !await pinActiveTemplatesAndQueue(pairId, req.user.userId, tx)) throw new Error("Both valid active templates for this property are required");
      const kind = p.documents_ready_at ? "reconcile" : "generation";
      await tx.execute(sql`INSERT INTO legal_jobs (pair_id,kind,status) VALUES (${pairId},${kind},'queued')
        ON CONFLICT (pair_id,kind) DO UPDATE SET status='queued',available_at=now(),attempts=0,last_error=NULL
        WHERE legal_jobs.status IN ('dead','blocked','complete') AND (legal_jobs.updated_at < now() - interval '1 minute')`);
      await audit(tx, req.user.userId, "controlled_retry_requested", { kind }, pairId);
    });
    if (action === "resend") {
      if (!resendResult) throw new Error("The notification resend request was not recorded");
      if (resendResult.queued) wakeLegalWorker();
      res.status(resendResult.state === "blocked_uncertain" ? 409 : 200).json(resendResult);
      return;
    }
    wakeLegalWorker();
    res.json({ message: "Request queued; the existing pair and in-app signing evidence are retained" });
  }));
  app.post("/api/admin/legal/dispatch", auth.requireAdminAuth, handler(async (_req, res) => res.json(await dispatchLegalJobs(5))));
  app.post("/api/admin/legal/pairs/:id/recover-notification", auth.requireAdminAuth, handler(async (req, res) => {
    if (req.body.confirmed !== true) throw new Error("Confirm recovery of only this existing notification.");
    // No wakeLegalWorker: this action must never dispatch any other legal job.
    res.json(await recoverLegalNotification({
      pairId: id(req.params.id), propertyId: id(req.body.propertyId),
      jobId: id(req.body.jobId), cycleId: id(req.body.cycleId), adminId: req.user.userId,
    }));
  }));
  app.post("/api/legal/dispatch", handler(async (req, res) => {
    const expected = process.env.LEGAL_DISPATCH_SECRET;
    const supplied = String(req.headers.authorization || "").replace(/^Bearer /, "");
    if (!expected || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(401).json({ error: "Dispatcher authentication required" });
    res.json(await dispatchLegalJobs(5));
  }));
  // Closed explicitly rather than falling through to the SPA. No signing
  // redirects, provider calls or externally supplied completion events exist.
  app.all("/api/legal/docusign/connect", (_req, res) => res.status(410).json({ error: "External signing is disabled. Use Brikvest's authenticated in-app review and signing workflow." }));
}
