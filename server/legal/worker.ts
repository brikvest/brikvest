import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { sendEmail as defaultSendEmail } from "../emailService";
import { legalDocumentsReadyEmailTemplate } from "../emailTemplates";
import { buildLegalTemplateValues } from "./values";
import {
  assertLegalTemplateIsRendered,
  renderLegalTemplate,
  validateLegalTemplate,
  type LegalDocumentType,
} from "./templates";
import {
  convertDocxToPdf,
  prepareDocxForPdf,
  verifyAssigneeSignaturePosition,
  type PdfTextPosition,
} from "./converter";
import {
  LegalFileAlreadyExistsError,
  LegalFileNotFoundError,
  readLegalDocument,
  readLegalTemplateVersion,
  storeLegalDocument,
  type LegalDocumentFileKind,
  type LegalStorageReference,
} from "./files";
import {
  beginLegalNotificationAttempt,
  completeLegalJob,
  failLegalJob,
  getLegalNotificationRecipient,
  getPairWithDocuments,
  getPinnedLegalTemplate,
  markPairReady,
  markLegalNotificationUncertain,
  recordLegalNotificationFailed,
  recordLegalNotificationSent,
  recordUnsignedArtifact,
  claimNextLegalJob,
  type LegalJobClaim,
} from "./repository";
import { reconcileLocalPairSigning as reconcilePairSigning } from "./local-signing";
import { withLegalDispatchPermit } from "./dispatch-maintenance";

const MAX_DISPATCH_LIMIT = 10;
const MAX_JOB_RUNTIME_MS = 4 * 60_000;
const MAX_FAILURE_RECORD_RUNTIME_MS = 20_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

type SendEmail = (input: {
  to: string;
  subject: string;
  html: string;
}) => Promise<boolean>;

export interface LegalWorkerDependencies {
  claimNextLegalJob: typeof claimNextLegalJob;
  completeLegalJob: typeof completeLegalJob;
  failLegalJob: typeof failLegalJob;
  getPairWithDocuments: typeof getPairWithDocuments;
  getPinnedLegalTemplate: typeof getPinnedLegalTemplate;
  getLegalNotificationRecipient: typeof getLegalNotificationRecipient;
  beginLegalNotificationAttempt: typeof beginLegalNotificationAttempt;
  recordLegalNotificationSent: typeof recordLegalNotificationSent;
  recordLegalNotificationFailed: typeof recordLegalNotificationFailed;
  markLegalNotificationUncertain: typeof markLegalNotificationUncertain;
  recordUnsignedArtifact: typeof recordUnsignedArtifact;
  markPairReady: typeof markPairReady;
  readLegalDocument: typeof readLegalDocument;
  readLegalTemplateVersion: typeof readLegalTemplateVersion;
  storeLegalDocument: typeof storeLegalDocument;
  convertDocxToPdf: typeof convertDocxToPdf;
  prepareDocxForPdf: typeof prepareDocxForPdf;
  verifyAssigneeSignaturePosition: typeof verifyAssigneeSignaturePosition;
  renderLegalTemplate: typeof renderLegalTemplate;
  validateLegalTemplate: typeof validateLegalTemplate;
  reconcilePairSigning: typeof reconcilePairSigning;
  sendEmail: SendEmail;
}

export interface DispatchLegalJobsResult {
  claimed: number;
  completed: number;
  failed: number;
  quarantined: number;
}

interface GeneratedArtifact {
  documentId: number;
  type: LegalDocumentType;
  docxKey: string;
  pdfKey: string;
  hash: string;
  signaturePlacement: PdfTextPosition;
}

interface ParsedPairSnapshot {
  userFullName: string;
  userHomeAddress: string;
  propertyAreaSqm: string;
  paymentAmountNaira: string;
  paymentCurrency: string;
  effectiveAt: string;
  units: string;
  squareMetersPerUnit: string;
}

interface PairForWorker {
  id: number;
  propertyId: number;
  reservationId: number;
  userId: number;
  status: string;
  fullNameSnapshot: string;
  homeAddressSnapshot: string;
  propertyAreaSqm: string;
  unitsSnapshot: string;
  squareMetersPerUnit: string;
  paymentAmountNaira: string;
  paymentCurrency: string;
  effectiveAt: Date;
  dataSnapshot: ParsedPairSnapshot;
  deedTemplateId: number;
  transferTemplateId: number;
  documents: Array<Record<string, unknown>>;
}

function rowsAsArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Legal pair is missing trusted ${fieldName}`);
  }
  return value.trim();
}

function requiredPositiveInteger(value: unknown, fieldName: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Legal pair has an invalid ${fieldName}`);
  }
  return parsed;
}

function parseSnapshot(value: unknown): Record<string, unknown> {
  let snapshot = value;
  if (typeof snapshot === "string") {
    try {
      snapshot = JSON.parse(snapshot);
    } catch {
      throw new Error("Legal pair frozen data snapshot is invalid JSON");
    }
  }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Legal pair frozen data snapshot is missing");
  }
  return snapshot as Record<string, unknown>;
}

function normalizeDecimal(value: unknown, fieldName: string): string {
  const text = typeof value === "number" ? String(value) : requiredString(value, fieldName);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`Legal pair has an invalid ${fieldName}`);
  }
  const [wholeText, fractionalText = ""] = text.split(".");
  const whole = wholeText.replace(/^0+(?=\d)/, "");
  const fraction = fractionalText.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function decimalToHundredths(value: string, fieldName: string): bigint {
  const normalized = normalizeDecimal(value, fieldName);
  const [whole, fractional = ""] = normalized.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fractional.padEnd(2, "0") || "0");
}

function readPairForWorker(pairValue: Record<string, unknown>, documents: unknown[]): PairForWorker {
  const snapshot = parseSnapshot(pairValue.data_snapshot);
  const fullNameSnapshot = requiredString(pairValue.full_name_snapshot, "full-name snapshot");
  const homeAddressSnapshot = requiredString(pairValue.home_address_snapshot, "home-address snapshot");
  const areaSnapshot = normalizeDecimal(pairValue.property_area_sqm, "property area");
  const unitsSnapshot = normalizeDecimal(pairValue.units_snapshot, "units snapshot");
  const sqmPerUnit = normalizeDecimal(pairValue.square_meters_per_unit, "square-metres-per-unit snapshot");
  const paymentSnapshot = normalizeDecimal(pairValue.payment_amount_naira, "approved Naira payment");
  const effectiveAt = pairValue.effective_at instanceof Date
    ? pairValue.effective_at
    : new Date(String(pairValue.effective_at));

  const frozen: ParsedPairSnapshot = {
    userFullName: requiredString(snapshot.userFullName, "frozen user name"),
    userHomeAddress: requiredString(snapshot.userHomeAddress, "frozen user address"),
    propertyAreaSqm: normalizeDecimal(snapshot.propertyAreaSqm, "frozen property area"),
    paymentAmountNaira: normalizeDecimal(snapshot.paymentAmountNaira, "frozen approved Naira payment"),
    paymentCurrency: requiredString(snapshot.paymentCurrency, "frozen payment currency"),
    effectiveAt: requiredString(snapshot.effectiveAt, "frozen effective date"),
    units: normalizeDecimal(snapshot.units, "frozen units"),
    squareMetersPerUnit: normalizeDecimal(
      snapshot.squareMetersPerUnit,
      "frozen square-metres-per-unit value",
    ),
  };
  if (
    fullNameSnapshot !== frozen.userFullName ||
    homeAddressSnapshot !== frozen.userHomeAddress ||
    areaSnapshot !== frozen.propertyAreaSqm ||
    paymentSnapshot !== frozen.paymentAmountNaira ||
    frozen.paymentCurrency !== "NGN" ||
    pairValue.payment_currency !== "NGN"
  ) {
    throw new Error("Legal pair snapshot does not match its frozen trusted fields");
  }
  if (unitsSnapshot !== frozen.units || sqmPerUnit !== frozen.squareMetersPerUnit) {
    throw new Error("Legal pair property-area inputs do not match the frozen approval snapshot");
  }
  const areaFromUnits = new Decimal(unitsSnapshot).mul(sqmPerUnit).toDecimalPlaces(
    2,
    Decimal.ROUND_HALF_UP,
  );
  if (areaFromUnits.comparedTo(areaSnapshot) !== 0) {
    throw new Error("Frozen LilyCrest Garden Estate property area does not match its unit allocation");
  }
  if (!Number.isFinite(effectiveAt.getTime())) {
    throw new Error("Legal pair has an invalid effective date");
  }
  const frozenDate = new Date(frozen.effectiveAt);
  if (!Number.isFinite(frozenDate.getTime()) || frozenDate.getTime() !== effectiveAt.getTime()) {
    throw new Error("Legal pair effective date does not match its frozen snapshot");
  }

  return {
    id: requiredPositiveInteger(pairValue.id, "pair ID"),
    propertyId: requiredPositiveInteger(pairValue.property_id, "property ID"),
    reservationId: requiredPositiveInteger(pairValue.reservation_id, "holding ID"),
    userId: requiredPositiveInteger(pairValue.user_id, "investor ID"),
    status: requiredString(pairValue.status, "pair status"),
    fullNameSnapshot,
    homeAddressSnapshot,
    propertyAreaSqm: areaSnapshot,
    unitsSnapshot,
    squareMetersPerUnit: sqmPerUnit,
    paymentAmountNaira: paymentSnapshot,
    paymentCurrency: "NGN",
    effectiveAt,
    dataSnapshot: frozen,
    deedTemplateId: requiredPositiveInteger(pairValue.deed_template_id, "deed template ID"),
    transferTemplateId: requiredPositiveInteger(pairValue.transfer_template_id, "transfer template ID"),
    documents: rowsAsArray(documents) as Array<Record<string, unknown>>,
  };
}

function parseDocumentType(value: unknown): LegalDocumentType {
  if (value === "deed_of_assignment" || value === "transfer_exit_rights") return value;
  throw new Error("Legal pair contains an unsupported document type");
}

function deterministicRecordKey(documentId: number): string {
  const bytes = createHash("sha256")
    .update(`brikvest:legal-document:${documentId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function expectedStorageReference(
  recordKey: string,
  kind: LegalDocumentFileKind,
): LegalStorageReference {
  return `legal/documents/${recordKey}/${kind}` as LegalStorageReference;
}

function expectedTemplateReference(
  type: LegalDocumentType,
  version: number,
  reference: string,
  propertyId: number,
): void {
  const propertyPrefix = `legal/templates/properties/${propertyId}/${type}/v${version}/`;
  const uploadId = reference.startsWith(propertyPrefix) ? reference.slice(propertyPrefix.length) : "";
  if (reference !== `legal/templates/${type}/v${version}` &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    throw new Error("Pinned legal template storage key does not match its document version");
  }
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown legal worker error";
  return message.trim().replace(/[\r\n\t]+/g, " ").slice(0, 1_000) ||
    "Unknown legal worker error";
}

function recordField(row: Record<string, unknown>, field: string): unknown {
  return row[field];
}

function assertStoredDocumentKeys(
  document: Record<string, unknown>,
  docxKey: string,
  pdfKey: string,
): void {
  const storedDocxKey = document.source_docx_key;
  const storedPdfKey = document.unsigned_pdf_key;
  if (storedDocxKey && storedDocxKey !== docxKey) {
    throw new Error("Stored DOCX key differs from the deterministic legal document key");
  }
  if (storedPdfKey && storedPdfKey !== pdfKey) {
    throw new Error("Stored PDF key differs from the deterministic legal document key");
  }
}

function positionFromStoredPdf(
  placement: PdfTextPosition,
  storedValue: unknown,
): PdfTextPosition {
  if (storedValue == null) return placement;
  let stored = storedValue;
  if (typeof stored === "string") {
    try {
      stored = JSON.parse(stored);
    } catch {
      throw new Error("Stored signature placement is invalid JSON");
    }
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error("Stored signature placement is invalid");
  }
  const expected = stored as Record<string, unknown>;
  const numericFields = [
    "signatureHeadingPageNumber", "pageNumber", "x", "y", "width", "height", "pageWidth", "pageHeight",
  ] as const;
  if (
    numericFields.some((field) =>
      expected[field] !== undefined && Number(expected[field]) !== placement[field],
    ) ||
    (expected.templateVersionId !== undefined &&
      expected.templateVersionId !== placement.templateVersionId)
  ) {
    throw new Error("Stored signature placement does not match the stored unsigned PDF");
  }
  return placement;
}

async function readIfPresent(
  readDocument: LegalWorkerDependencies["readLegalDocument"],
  reference: string,
  kind: LegalDocumentFileKind,
): Promise<Buffer | null> {
  try {
    return await readDocument(reference, kind);
  } catch (error) {
    if (error instanceof LegalFileNotFoundError) return null;
    throw error;
  }
}

async function getPinnedTemplateMetadata(
  dependencies: LegalWorkerDependencies,
  type: LegalDocumentType,
  templateId: number,
  propertyId: number,
) {
  const template = await dependencies.getPinnedLegalTemplate(templateId);
  if (
    !template ||
    template.id !== templateId ||
    template.documentType !== type ||
    !Number.isSafeInteger(template.version) ||
    template.version < 1 ||
    !HASH_PATTERN.test(template.sha256)
  ) {
    throw new Error(`Pinned ${type} template metadata is unavailable or invalid`);
  }
  if (template.propertyId != null && Number(template.propertyId) !== propertyId) {
    throw new Error("Pinned legal template belongs to a different property");
  }
  expectedTemplateReference(type, template.version, template.storageKey, propertyId);
  return {
    template,
    templateVersionId: `${type}:v${template.version}`,
  };
}

async function readPinnedTemplateBuffer(
  dependencies: LegalWorkerDependencies,
  template: NonNullable<Awaited<ReturnType<LegalWorkerDependencies["getPinnedLegalTemplate"]>>>,
  type: LegalDocumentType,
): Promise<Buffer> {
  const templateBuffer = await dependencies.readLegalTemplateVersion(template.storageKey);
  if (sha256(templateBuffer) !== template.sha256.toLowerCase()) {
    throw new Error(`Pinned ${type} template content does not match its stored SHA-256`);
  }
  dependencies.validateLegalTemplate(templateBuffer, type);
  return templateBuffer;
}

async function generateOrRecoverDocument(
  dependencies: LegalWorkerDependencies,
  pair: PairForWorker,
  document: Record<string, unknown>,
  values: ReturnType<typeof buildLegalTemplateValues>,
): Promise<GeneratedArtifact> {
  const documentId = requiredPositiveInteger(recordField(document, "id"), "document ID");
  const type = parseDocumentType(recordField(document, "document_type"));
  const templateId = requiredPositiveInteger(recordField(document, "template_id"), "document template ID");
  const pairPinnedTemplateId = type === "deed_of_assignment"
    ? pair.deedTemplateId
    : pair.transferTemplateId;
  if (templateId !== pairPinnedTemplateId) {
    throw new Error(`The ${type} document is not pinned to the approved template version`);
  }

  const { template, templateVersionId } = await getPinnedTemplateMetadata(
    dependencies,
    type,
    templateId,
    pair.propertyId,
  );
  const recordKey = deterministicRecordKey(documentId);
  const docxKey = expectedStorageReference(recordKey, "source_docx");
  const pdfKey = expectedStorageReference(recordKey, "unsigned_pdf");
  assertStoredDocumentKeys(document, docxKey, pdfKey);

  let storedDocx = await readIfPresent(
    dependencies.readLegalDocument,
    docxKey,
    "source_docx",
  );
  let storedPdf = await readIfPresent(
    dependencies.readLegalDocument,
    pdfKey,
    "unsigned_pdf",
  );
  if (storedPdf && !storedDocx) {
    throw new Error("Unsigned PDF exists without its immutable source DOCX");
  }
  if ((!storedDocx || !storedPdf) &&
      (pair.status === "investor_signed" || document.status === "investor_signed" || document.signed_pdf_key)) {
    throw new Error("Investor-signed documents are permanently locked; missing historical artifacts require investigation, not regeneration");
  }

  if (!storedDocx) {
    const templateBuffer = await readPinnedTemplateBuffer(
      dependencies,
      template,
      type,
    );
    const rendered = dependencies.prepareDocxForPdf(
      dependencies.renderLegalTemplate(templateBuffer, type, values),
    );
    assertLegalTemplateIsRendered(rendered);
    try {
      await dependencies.storeLegalDocument({
        recordKey,
        kind: "source_docx",
        contents: rendered,
      });
    } catch (error) {
      if (!(error instanceof LegalFileAlreadyExistsError)) throw error;
    }
    storedDocx = await readIfPresent(
      dependencies.readLegalDocument,
      docxKey,
      "source_docx",
    );
    if (!storedDocx) throw new Error("Stored source DOCX could not be recovered after upload");
  }

  const verifiedPdf = async (pdf: Buffer): Promise<GeneratedArtifact> => {
    const hash = sha256(pdf);
    const recordedHash = document.unsigned_pdf_sha256;
    if (
      recordedHash != null &&
      (typeof recordedHash !== "string" || recordedHash.toLowerCase() !== hash)
    ) {
      throw new Error("Immutable unsigned PDF hash differs from the legal document record");
    }
    const position = await dependencies.verifyAssigneeSignaturePosition(pdf, {
      assigneeFullName: pair.fullNameSnapshot,
      templateVersionId,
    });
    const signaturePlacement = positionFromStoredPdf(
      position,
      document.signature_placement,
    );
    return {
      documentId,
      type,
      docxKey,
      pdfKey,
      hash,
      signaturePlacement,
    };
  };

  if (!storedPdf) {
    const newlyConverted = await dependencies.convertDocxToPdf(storedDocx, { preserveTypography: true });
    // Recovery may clean a disposable DOCX, but cannot publish different bytes
    // under an already recorded unsigned-PDF digest.
    if (document.unsigned_pdf_sha256 != null &&
        (typeof document.unsigned_pdf_sha256 !== "string" ||
         document.unsigned_pdf_sha256.toLowerCase() !== sha256(newlyConverted))) {
      throw new Error("Recovered unsigned PDF differs from the immutable recorded SHA-256; historical artifacts require investigation, not replacement");
    }
    await dependencies.verifyAssigneeSignaturePosition(newlyConverted, {
      assigneeFullName: pair.fullNameSnapshot,
      templateVersionId,
    });
    try {
      await dependencies.storeLegalDocument({
        recordKey,
        kind: "unsigned_pdf",
        contents: newlyConverted,
      });
    } catch (error) {
      if (!(error instanceof LegalFileAlreadyExistsError)) throw error;
    }
    storedPdf = await readIfPresent(
      dependencies.readLegalDocument,
      pdfKey,
      "unsigned_pdf",
    );
    if (!storedPdf) throw new Error("Stored unsigned PDF could not be recovered after upload");
  }

  return verifiedPdf(storedPdf);
}

async function processGeneration(
  dependencies: LegalWorkerDependencies,
  pairId: number,
): Promise<void> {
  const pairResult = await dependencies.getPairWithDocuments(pairId);
  if (!pairResult) throw new Error("Legal document pair was not found");
  const pair = readPairForWorker(pairResult.pair, pairResult.documents);
  const documents = pair.documents;
  if (documents.length !== 2) {
    throw new Error("Generation requires exactly the pinned deed and transfer documents");
  }

  const values = buildLegalTemplateValues("deed_of_assignment", {
    verifiedFullName: pair.dataSnapshot.userFullName,
    verifiedHomeAddress: pair.dataSnapshot.userHomeAddress,
    propertyAreaSqm: pair.dataSnapshot.propertyAreaSqm,
    approvedPaymentAmountNaira: pair.dataSnapshot.paymentAmountNaira,
    documentDate: new Date(pair.dataSnapshot.effectiveAt),
  });
  const types = documents.map((document) => parseDocumentType(document.document_type));
  if (
    types.filter((type) => type === "deed_of_assignment").length !== 1 ||
    types.filter((type) => type === "transfer_exit_rights").length !== 1
  ) {
    throw new Error("Generation pair must contain one deed and one transfer document");
  }

  const artifacts: GeneratedArtifact[] = [];
  for (const type of ["deed_of_assignment", "transfer_exit_rights"] as const) {
    const document = documents.find((item) => item.document_type === type);
    if (!document) throw new Error(`The pinned ${type} document is missing`);
    artifacts.push(await generateOrRecoverDocument(dependencies, pair, document, values));
  }

  // Commit DB references only after both immutable file pairs have been stored
  // and both PDFs have passed their assignee-specific position checks.
  for (const artifact of artifacts) {
    await dependencies.recordUnsignedArtifact(artifact.documentId, {
      docxKey: artifact.docxKey,
      pdfKey: artifact.pdfKey,
      hash: artifact.hash,
      signaturePlacement: artifact.signaturePlacement as unknown as Record<string, unknown>,
    });
  }
  await dependencies.markPairReady(pairId);
}

function validateAppBaseUrl(): URL {
  const configured = process.env.APP_BASE_URL;
  let base: URL;
  try {
    base = new URL(configured || "");
  } catch {
    throw new Error("APP_BASE_URL must be configured as an HTTPS application origin");
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("APP_BASE_URL must be a clean HTTPS origin without credentials or path");
  }
  return base;
}

function buildHoldingDashboardUrl(reservationId: number): string {
  const base = validateAppBaseUrl();
  const url = new URL("/dashboard", base.origin);
  url.searchParams.set("holding", String(reservationId));
  return url.toString();
}

function assertReadyPairForNotification(
  pairValue: Record<string, unknown>,
  documents: Array<Record<string, unknown>>,
): { reservationId: number; fullName: string } {
  if (!pairValue.documents_ready_at) {
    throw new Error("Legal pair has not reached document-ready state");
  }
  const reservationId = requiredPositiveInteger(pairValue.reservation_id, "holding ID");
  const fullName = requiredString(pairValue.full_name_snapshot, "full-name snapshot");
  if (documents.length !== 2) throw new Error("Legal pair does not have exactly two documents");
  const types = documents.map((document) => parseDocumentType(document.document_type));
  if (
    types.filter((type) => type === "deed_of_assignment").length !== 1 ||
    types.filter((type) => type === "transfer_exit_rights").length !== 1
  ) {
    throw new Error("Legal pair is missing its complete document set");
  }
  return { reservationId, fullName };
}

async function processNotification(
  dependencies: LegalWorkerDependencies,
  claim: LegalJobClaim,
): Promise<"ready" | "quarantined"> {
  const pairResult = await dependencies.getPairWithDocuments(claim.pairId);
  if (!pairResult) throw new Error("Legal document pair was not found");
  const { reservationId, fullName } = assertReadyPairForNotification(
    pairResult.pair,
    pairResult.documents,
  );
  if (pairResult.pair.status === "investor_signed" || pairResult.documents.every((d) => d.status === "investor_signed")) return "ready";
  const pdfs: Buffer[] = [];
  for (const document of pairResult.documents) {
    const pdfKey = requiredString(document.unsigned_pdf_key, "stored unsigned PDF key");
    const expectedHash = requiredString(document.unsigned_pdf_sha256, "stored unsigned PDF hash");
    if (!HASH_PATTERN.test(expectedHash)) {
      throw new Error("Stored unsigned PDF hash is invalid");
    }
    const pdf = await dependencies.readLegalDocument(pdfKey, "unsigned_pdf");
    if (sha256(pdf) !== expectedHash.toLowerCase()) {
      throw new Error("Stored unsigned PDF does not match its recorded SHA-256");
    }
    // Recheck placement against the retained PDF, never regenerate or update
    // artifacts during a reminder. Both PDFs must pass before any mail starts.
    const type = parseDocumentType(document.document_type);
    const template = await getPinnedTemplateMetadata(dependencies, type,
      requiredPositiveInteger(document.template_id, "document template ID"),
      requiredPositiveInteger(pairResult.pair.property_id, "property ID"));
    const placement = await dependencies.verifyAssigneeSignaturePosition(pdf, {
      assigneeFullName: fullName, templateVersionId: template.templateVersionId,
    });
    if (!document.signature_placement) throw new Error("Stored signature placement is missing");
    positionFromStoredPdf(placement, document.signature_placement);
    pdfs.push(pdf);
  }
  if (pdfs.length !== 2) throw new Error("Both unsigned PDFs must be privately available before notification");

  const recipient = await dependencies.getLegalNotificationRecipient(claim.pairId);
  const email = requiredString(recipient?.email, "investor email");
  const propertyName = requiredString(recipient?.propertyName, "property name");
  const dashboardUrl = buildHoldingDashboardUrl(reservationId);
  const attemptState = await dependencies.beginLegalNotificationAttempt(
    claim.id,
    claim.leaseToken,
  );
  if (attemptState.state === "already_sent") return "ready";
  if (attemptState.state === "uncertain" || attemptState.state === "exhausted" || attemptState.state === "review_required") {
    return "quarantined";
  }

  let result: boolean;
  try {
    result = await dependencies.sendEmail({
      to: email,
      ...legalDocumentsReadyEmailTemplate({ fullName, dashboardUrl, propertyName }),
    });
  } catch {
    await dependencies.markLegalNotificationUncertain(
      claim.id,
      claim.leaseToken,
      attemptState.attempt,
      "sendEmail threw before returning a definitive delivery result",
    );
    return "quarantined";
  }
  if (result !== true) {
    await dependencies.recordLegalNotificationFailed(
      claim.id,
      claim.leaseToken,
      attemptState.attempt,
      "sendEmail returned false",
    );
    throw new Error("Legal documents are ready, but investor notification failed");
  }
  await dependencies.recordLegalNotificationSent(
    claim.id,
    claim.leaseToken,
    attemptState.attempt,
  );
  return "ready";
}

function timeoutAfter<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`Legal job exceeded its ${timeoutMs} ms lease-safe processing limit`)),
        timeoutMs,
      );
      timeout.unref?.();
    }),
  ]).finally(() => clearTimeout(timeout!));
}

export function createLegalWorker(
  overrides: Partial<LegalWorkerDependencies> = {},
) {
  const dependencies: LegalWorkerDependencies = {
    claimNextLegalJob,
    completeLegalJob,
    failLegalJob,
    getPairWithDocuments,
    getPinnedLegalTemplate,
    getLegalNotificationRecipient,
    beginLegalNotificationAttempt,
    recordLegalNotificationSent,
    recordLegalNotificationFailed,
    markLegalNotificationUncertain,
    recordUnsignedArtifact,
    markPairReady,
    readLegalDocument,
    readLegalTemplateVersion,
    storeLegalDocument,
    convertDocxToPdf,
    prepareDocxForPdf,
    verifyAssigneeSignaturePosition,
    renderLegalTemplate,
    validateLegalTemplate,
    reconcilePairSigning,
    sendEmail: defaultSendEmail,
    ...overrides,
  };

  function trackOperation<T>(pending: Set<Promise<unknown>>, operation: Promise<T>): Promise<T> {
    pending.add(operation);
    void operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  }

  async function processClaim(claim: LegalJobClaim, pending: Set<Promise<unknown>>): Promise<"completed" | "failed" | "quarantined"> {
    try {
      const operation = async () => {
        if (claim.kind === "generation") {
          await processGeneration(dependencies, claim.pairId);
          return "ready" as const;
        }
        if (claim.kind === "notify") {
          return processNotification(dependencies, claim);
        }
        if (claim.kind === "reconcile") {
          const reconciliation = await dependencies.reconcilePairSigning(claim.pairId);
          if (reconciliation.pending) {
            throw new Error("Signing reconciliation remains pending and will be retried by the outbox");
          }
          return "ready" as const;
        }
        throw new Error(`Unsupported legal job kind: ${String(claim.kind)}`);
      };
      const completeOperation = async () => {
        const result = await operation();
        if (result !== "quarantined") {
          await dependencies.completeLegalJob(claim.id, claim.leaseToken);
        }
        return result;
      };
      const result = await timeoutAfter(trackOperation(pending, completeOperation()), MAX_JOB_RUNTIME_MS);
      if (result === "quarantined") return result;
      return "completed";
    } catch (error) {
      try {
        await timeoutAfter(
          trackOperation(pending, dependencies.failLegalJob(
            claim.id,
            claim.leaseToken,
            safeErrorMessage(error),
          )),
          MAX_FAILURE_RECORD_RUNTIME_MS,
        );
      } catch {
        // A lease may have expired while an external converter/provider was
        // running. Never replace or reclaim that lease from this worker.
      }
      return "failed";
    }
  }

  async function dispatchLegalJobs(
    limit = MAX_DISPATCH_LIMIT,
    drainBeforeReturning = false,
    isPermitLive: () => boolean = () => true,
  ): Promise<DispatchLegalJobsResult> {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error("Legal job dispatch limit must be a non-negative integer");
    }
    const boundedLimit = Math.min(limit, MAX_DISPATCH_LIMIT);
    const result: DispatchLegalJobsResult = {
      claimed: 0,
      completed: 0,
      failed: 0,
      quarantined: 0,
    };
    const pending = new Set<Promise<unknown>>();
    try {
      for (let index = 0; index < boundedLimit; index += 1) {
        if (!isPermitLive()) throw new Error("Legal dispatch maintenance permit was lost.");
        const claim = await dependencies.claimNextLegalJob();
        if (!claim) break;
        if (!isPermitLive()) throw new Error("Legal dispatch maintenance permit was lost.");
        result.claimed += 1;
        const state = await processClaim(claim, pending);
        if (state === "completed") result.completed += 1;
        else if (state === "quarantined") result.quarantined += 1;
        else result.failed += 1;
      }
      return result;
    } finally {
      // A Promise.race timeout does not cancel SMTP/conversion work. Retain the
      // production maintenance permit until that underlying work truly settles.
      if (drainBeforeReturning) await Promise.allSettled(Array.from(pending));
    }
  }

  return { dispatchLegalJobs };
}

const defaultWorker = createLegalWorker();

export async function dispatchLegalJobs(
  limit = MAX_DISPATCH_LIMIT,
): Promise<DispatchLegalJobsResult> {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error("Legal job dispatch limit must be a non-negative integer");
  }
  return await withLegalDispatchPermit((isPermitLive) => defaultWorker.dispatchLegalJobs(limit, true, isPermitLive))
    ?? { claimed: 0, completed: 0, failed: 0, quarantined: 0 };
}
