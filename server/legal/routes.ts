import type { Express, RequestHandler } from "express";
import multer from "multer";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  bindLegalProperty,
  getLegalPropertyBinding,
  pinActiveTemplatesAndQueue,
  requestLegalNotificationResend,
  type LegalNotificationResendResult,
} from "./repository";
import { validateLegalTemplate, renderIllustrativeLegalTemplate, type LegalDocumentType } from "./templates";
import { convertDocxToPdf, verifyAssigneeSignaturePosition } from "./converter";
import { buildIllustrativeTemplateValues } from "./values";
import { storeLegalTemplateVersion, readLegalTemplateVersion, streamAuthorizedLegalDocument, LegalFileAlreadyExistsError } from "./files";
import { getLegalReadiness } from "../../scripts/legal-readiness";
import { dispatchLegalJobs } from "./worker";
import { beginLocalSigning, completeLocalSigning } from "./local-signing";
import { assertActiveConfirmedHolding } from "./holding-state";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2 } });
const safeUpload: RequestHandler = (req, res, next) => upload.single("file")(req, res, (error) => {
  if (error) return res.status(400).json({ error: "Upload one DOCX file no larger than 20 MB." });
  next();
});
const rows = (result: any): any[] => result.rows || [];
const id = (value: string): number => {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid record ID");
  return Number(value);
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
async function saveTemplate(documentType: LegalDocumentType, bytes: Buffer, filename: string, adminId: number, initial = false) {
  const validation = validateLegalTemplate(bytes, documentType, { requireCanonicalDate: !initial });
  // Serializes version allocation and upload; a failed DB commit can leave an
  // orphan object, never an overwritable version or active invalid template.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"legal-template:" + documentType}))`);
    const version = rows(await tx.execute(sql`SELECT COALESCE(MAX(version), 0) + 1 AS version FROM legal_templates WHERE document_type = ${documentType}`))[0].version;
    const sha = createHash("sha256").update(bytes).digest("hex");
    let key: string;
    try { key = await storeLegalTemplateVersion({ documentType, version, docxBuffer: bytes }); }
    catch (error) {
      if (!(error instanceof LegalFileAlreadyExistsError)) throw error;
      key = `legal/templates/${documentType}/v${version}`;
      const retained = await readLegalTemplateVersion(key);
      if (createHash("sha256").update(retained).digest("hex") !== sha) throw new Error("A retained template upload occupies this version. Retry with the original identical DOCX; retained legal files cannot be overwritten.");
    }
    const result = rows(await tx.execute(sql`INSERT INTO legal_templates
      (document_type, version, original_filename, storage_key, sha256, byte_size, required_placeholders, validation_status, created_by_admin_id)
      VALUES (${documentType}, ${version}, ${filename.replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 160)}, ${key}, ${sha}, ${bytes.length},
      ${Object.keys(validation.placeholderCounts)}::text[], 'valid', ${adminId}) RETURNING id`))[0];
    await audit(tx, adminId, "template_version_uploaded", { templateId: result.id, documentType, version, sha256: sha });
    return { id: result.id, version, documentType, validationStatus: "valid" };
  });
}
async function listPairs(userId?: number) {
  const result = rows(await db.execute(sql`SELECT p.*, pr.name AS property_name, u.email AS user_email,
    dt.version AS deed_template_version, tt.version AS transfer_template_version
    FROM legal_document_pairs p JOIN properties pr ON pr.id = p.property_id JOIN users u ON u.id = p.user_id
    LEFT JOIN legal_templates dt ON dt.id = p.deed_template_id
    LEFT JOIN legal_templates tt ON tt.id = p.transfer_template_id
    WHERE ${userId === undefined ? sql`true` : sql`p.user_id = ${userId}`} ORDER BY p.created_at DESC LIMIT 500`));
  if (!result.length) return [];
  const documents = rows(await db.execute(sql`SELECT id,pair_id,document_type,status,unsigned_pdf_key IS NOT NULL AS has_unsigned,
    signed_pdf_key IS NOT NULL AS has_signed,signing_certificate_key IS NOT NULL AS has_certificate
    FROM legal_documents WHERE pair_id IN (${sql.join(result.map((p) => sql`${p.id}`), sql`,`)}) ORDER BY document_type`));
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
  app.get("/api/legal/holdings", auth.requireAuth, handler(async (req, res) => res.json(await listPairs(req.user.id))));
  app.get("/api/admin/legal/documents", auth.requireAdminAuth, handler(async (_req, res) => res.json(await listPairs())));
  app.get("/api/admin/legal/failures", auth.requireAdminAuth, handler(async (_req, res) => res.json(rows(await db.execute(sql`
    SELECT a.id,a.reservation_id AS "reservationId",a.event_type AS "eventType",a.details,a.created_at AS "createdAt"
    FROM legal_audit_events a WHERE a.event_type LIKE '%blocked%' OR a.event_type LIKE '%failed%'
    ORDER BY a.id DESC LIMIT 100`)))));
  app.get("/api/admin/legal/templates", auth.requireAdminAuth, handler(async (_req, res) => res.json(rows(await db.execute(sql`
    SELECT id, document_type AS "documentType", version, validation_status AS "validationStatus",
    is_active AS active, created_at AS "createdAt", activated_at AS "activatedAt", sha256 FROM legal_templates ORDER BY document_type, version DESC`)))));
  app.get("/api/admin/legal/readiness", auth.requireAdminAuth, handler(async (_req, res) => {
    const config = getLegalReadiness();
    const blockers = config.checks.filter((c) => !c.ready).map((c) => c.detail);
    let binding = null;
    try {
      binding = rows(await db.execute(sql`SELECT property_id AS "propertyId",square_meters_per_unit AS "sqmPerUnit" FROM legal_property_bindings WHERE enabled`))[0] || null;
      if (!binding) blockers.push("An administrator must explicitly bind the exact LilyCrest Garden Estate property ID and 5 m²/unit mapping.");
      const active = rows(await db.execute(sql`SELECT id FROM legal_templates WHERE is_active AND validation_status = 'valid'`));
      if (active.length !== 2) blockers.push("Upload, preview and activate one valid version of each template.");
    } catch { blockers.push("Legal-document database migrations have not been applied."); }
    const localSchema = rows(await db.execute(sql`SELECT to_regclass('public.local_legal_signing_operations') IS NOT NULL AS installed`))[0];
    if (!localSchema?.installed) blockers.push("The additive in-app signing migration must be installed.");
    res.json({ ready: blockers.length === 0, configured: config.ready, signingMode: "brikvest_local", checks: config.checks, blockers, binding });
  }));
  app.post("/api/admin/legal/binding", auth.requireAdminAuth, handler(async (req, res) => {
    if (req.body.confirmed !== true) throw new Error("Explicit confirmation of the LilyCrest Garden Estate property identity is required");
    const binding = await db.transaction(async (tx) => {
      const saved = await bindLegalProperty(tx, { propertyId: Number(req.body.propertyId), squareMetersPerUnit: Number(req.body.sqmPerUnit), adminId: req.user.userId, note: "Admin explicitly confirms LilyCrest Garden Estate and 5 sqm per unit." });
      await audit(tx, req.user.userId, "sd118_property_binding_confirmed", { propertyId: saved.propertyId, sqmPerUnit: 5 });
      return saved;
    });
    res.json(binding);
  }));
  app.get("/api/admin/legal/holdings/:id", auth.requireAdminAuth, handler(async (req, res) => {
    const holding = rows(await db.execute(sql`SELECT id,property_id AS "propertyId",status,amount,currency,units,user_id AS "userId" FROM investment_reservations WHERE id = ${id(req.params.id)}`))[0];
    if (!holding) return res.status(404).json({ error: "Holding not found" });
    res.json({ ...holding, binding: await getLegalPropertyBinding(holding.propertyId) });
  }));
  app.get("/api/admin/legal/properties/:id", auth.requireAdminAuth, handler(async (req, res) => {
    const propertyId = id(req.params.id);
    const property = rows(await db.execute(sql`SELECT id,name,location,plot_number AS "plotNumber",currency FROM properties WHERE id=${propertyId}`))[0];
    if (!property) return res.status(404).json({ error: "Property not found" });
    res.json({ ...property, binding: await getLegalPropertyBinding(propertyId) });
  }));
  app.post("/api/admin/legal/templates", auth.requireAdminAuth, safeUpload, handler(async (req, res) => {
    const type = req.body.documentType;
    if (!["deed_of_assignment", "transfer_exit_rights"].includes(type) || !req.file || !/\.docx$/i.test(req.file.originalname)) throw new Error("Choose a document type and a DOCX file");
    res.status(201).json(await saveTemplate(type, req.file.buffer, req.file.originalname, req.user.userId));
  }));
  app.post("/api/admin/legal/templates/import-initial", auth.requireAdminAuth, handler(async (req, res) => {
    const imported = [];
    for (const type of ["deed_of_assignment", "transfer_exit_rights"] as LegalDocumentType[]) {
      const existing = rows(await db.execute(sql`SELECT id FROM legal_templates WHERE document_type=${type} LIMIT 1`));
      if (existing.length) { imported.push({ id: existing[0].id, documentType: type, retained: true }); continue; }
      const bytes = await readFile(`server/legal/template-assets/${type}_v1.docx`);
      imported.push(await saveTemplate(type, bytes, `${type}-v1.docx`, req.user.userId, true));
    }
    res.status(201).json(imported);
  }));
  for (const action of ["download", "preview"] as const) {
    app.get(`/api/admin/legal/templates/:id/${action}`, auth.requireAdminAuth, handler(async (req, res) => {
      const t = rows(await db.execute(sql`SELECT * FROM legal_templates WHERE id = ${id(req.params.id)}`))[0];
      if (!t) return res.status(404).json({ error: "Template not found" });
      const bytes = await readLegalTemplateVersion(t.storage_key);
      if (createHash("sha256").update(bytes).digest("hex") !== t.sha256) throw new Error("Stored template checksum mismatch");
      if (action === "download") return privateResponse(res, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `template-${t.document_type}-v${t.version}.docx`, true);
      const preview = renderIllustrativeLegalTemplate(bytes, t.document_type);
      const pdf = await convertDocxToPdf(preview.renderedDocx);
      await verifyAssigneeSignaturePosition(pdf, { templateVersionId: String(t.id), assigneeFullName: buildIllustrativeTemplateValues(t.document_type).USER_FULL_NAME });
      privateResponse(res, pdf, "application/pdf", "illustrative-template-preview.pdf");
    }));
  }
  app.post("/api/admin/legal/templates/:id/activate", auth.requireAdminAuth, handler(async (req, res) => {
    const templateId = id(req.params.id);
    const t = rows(await db.execute(sql`SELECT * FROM legal_templates WHERE id = ${templateId}`))[0];
    if (!t) return res.status(404).json({ error: "Template not found" });
    const bytes = await readLegalTemplateVersion(t.storage_key);
    if (createHash("sha256").update(bytes).digest("hex") !== t.sha256) throw new Error("Stored template checksum mismatch");
    const preview = renderIllustrativeLegalTemplate(bytes, t.document_type);
    const pdf = await convertDocxToPdf(preview.renderedDocx);
    await verifyAssigneeSignaturePosition(pdf, { templateVersionId: String(t.id), assigneeFullName: buildIllustrativeTemplateValues(t.document_type).USER_FULL_NAME });
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"legal-template:" + t.document_type}))`);
      await tx.execute(sql`UPDATE legal_templates SET is_active = false WHERE document_type = ${t.document_type} AND is_active`);
      await tx.execute(sql`UPDATE legal_templates SET is_active = true,activated_at = now() WHERE id = ${templateId} AND validation_status = 'valid'`);
      await audit(tx, req.user.userId, "template_version_activated", { templateId, version: t.version, signaturePlacementVerified: true });
    });
    res.json({ message: "Template activated; historical documents are unchanged" });
  }));
  for (const action of ["preview", "download"] as const) {
    const serve = (isAdmin: boolean) => handler(async (req, res) => {
      const doc = rows(await db.execute(sql`SELECT d.*,p.user_id FROM legal_documents d JOIN legal_document_pairs p ON p.id=d.pair_id
        WHERE d.id=${id(req.params.id)} AND ${isAdmin ? sql`true` : sql`p.user_id=${req.user.id}`}`))[0];
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
    FROM legal_audit_events WHERE pair_id=${id(req.params.id)} ORDER BY id`)))));
  for (const action of ["retry", "resend"] as const) app.post(`/api/admin/legal/pairs/:id/${action}`, auth.requireAdminAuth, handler(async (req, res) => {
    const pairId = id(req.params.id);
    let resendResult: LegalNotificationResendResult | undefined;
    await db.transaction(async (tx) => {
      const reference = rows(await tx.execute(sql`
        SELECT reservation_id, user_id, property_id
        FROM legal_document_pairs WHERE id = ${pairId}
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
      if (action === "retry" && !await pinActiveTemplatesAndQueue(pairId, req.user.userId, tx)) throw new Error("Both valid active templates are required");
      const kind = p.documents_ready_at ? "reconcile" : "generation";
      await tx.execute(sql`INSERT INTO legal_jobs (pair_id,kind,status) VALUES (${pairId},${kind},'queued')
        ON CONFLICT (pair_id,kind) DO UPDATE SET status='queued',available_at=now(),attempts=0,last_error=NULL
        WHERE legal_jobs.status IN ('dead','blocked','complete') AND (legal_jobs.updated_at < now() - interval '1 minute')`);
      await audit(tx, req.user.userId, "controlled_retry_requested", { kind }, pairId);
    });
    if (action === "resend") {
      if (!resendResult) throw new Error("The notification resend request was not recorded");
      res.status(resendResult.state === "blocked_uncertain" ? 409 : 200).json(resendResult);
      return;
    }
    res.json({ message: "Request queued; the existing pair and in-app signing evidence are retained" });
  }));
  app.post("/api/admin/legal/dispatch", auth.requireAdminAuth, handler(async (_req, res) => res.json(await dispatchLegalJobs(5))));
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