import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db as defaultDb } from "../db";
import { comparePasswords as defaultComparePasswords } from "../auth";
import {
  LegalFileAlreadyExistsError,
  readLegalDocument,
  storeLegalDocument,
  type LegalDocumentFileKind,
  type LegalStorageReference,
  type StoreLegalDocumentOptions,
} from "./files";
import {
  verifyAssigneeSignaturePosition as defaultVerifyAssigneeSignaturePosition,
  type PdfTextPosition,
} from "./converter";
import {
  renderLocalSigningEvidencePdf,
  renderLocallySignedPdf,
  getLocalSigningFontSha256,
  sha256Hex,
  validateSignaturePng,
  type LocalSignaturePlacement,
} from "./local-pdf-signature";
import { assertActiveConfirmedHolding } from "./holding-state";

export const LOCAL_SIGNING_CONSENT_VERSION = "brikvest-local-signing-v1";
export const LOCAL_SIGNING_CONSENT_TEXT =
  "I have reviewed this document and agree to sign it electronically by applying the signature image I selected. " +
  "I understand this records my Brikvest in-app acknowledgment only; it is not a qualified digital " +
  "signature or an independently verified identity certificate. Any external execution, witness, " +
  "attestation, notarization, registration, or other statutory requirement remains separate and " +
  "must be completed where applicable.";

export const LOCAL_SIGNING_CHALLENGE_TTL_MS = 15 * 60_000;
export const LOCAL_SIGNING_REAUTH_WINDOW_MS = 15 * 60_000;
export const LOCAL_SIGNING_MAX_REAUTH_ATTEMPTS = 5;
export const MAX_LOCAL_SIGNING_PASSWORD_LENGTH = 1024;
export const MAX_LOCAL_SIGNING_REQUEST_BYTES = 750 * 1024;
const LOCAL_SIGNING_OPERATION_LEASE_MS = 5 * 60_000;
const BASE64_PNG_PREFIX = "data:image/png;base64,";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SqlExecutor = { execute(query: unknown): Promise<unknown> };
type LocalSigningDatabase = SqlExecutor & {
  transaction<T>(callback: (transaction: SqlExecutor) => Promise<T>): Promise<T>;
};
type VerifySignaturePosition = typeof defaultVerifyAssigneeSignaturePosition;

export interface LocalSigningDependencies {
  db: LocalSigningDatabase;
  comparePasswords: (supplied: string, stored: string) => Promise<boolean>;
  readLegalDocument: typeof readLegalDocument;
  storeLegalDocument: (options: StoreLegalDocumentOptions) => Promise<LegalStorageReference>;
  verifyAssigneeSignaturePosition: VerifySignaturePosition;
  renderLocallySignedPdf: typeof renderLocallySignedPdf;
  renderLocalSigningEvidencePdf: typeof renderLocalSigningEvidencePdf;
  getLocalSigningFontSha256: typeof getLocalSigningFontSha256;
  randomChallengeToken: () => string;
  randomUUID: () => string;
  now: () => Date;
}

export type LocalSigningActorEvidence = {
  ip?: string;
  userAgent?: string;
};

export type BeginLocalSigningResult = {
  documentId: number;
  operationId: number;
  challengeToken: string;
  expiresAt: string;
  unsignedPdfSha256: string;
  signerName: string;
  consentVersion: string;
  consentText: string;
};

export type CompleteLocalSigningResult =
  | {
      status: "processing";
      documentId: number;
      operationId: number;
    }
  | {
      status: "investor_signed";
      documentId: number;
      operationId: number;
      signedPdfSha256: string;
      certificateSha256: string;
    };

export type ReconcileLocalSigningResult = {
  pending: boolean;
  completed: number;
};

export class LocalSigningError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalSigningError";
    this.statusCode = statusCode;
  }
}

type SigningDocumentContext = Record<string, any> & {
  id: number;
  pair_id: number;
  user_id: number;
  full_name_snapshot: string;
  password: string;
  email: string;
  document_type: string;
  template_id: number;
  unsigned_pdf_key: string;
  unsigned_pdf_sha256: string;
  signature_placement: unknown;
  property_name: string;
  property_location: string;
};

type SigningOperation = Record<string, any> & {
  id: number;
  document_id: number;
  pair_id: number;
  user_id: number;
  template_id: number;
  signer_name: string;
  signer_email: string;
  unsigned_pdf_sha256: string;
  signature_placement: unknown;
  signed_pdf_record_key: string;
  certificate_record_key: string;
  status: "draft" | "accepted" | "signing" | "completed";
  challenge_hash: string | null;
  challenge_expires_at: Date | string | null;
};

type OperationWork = {
  operation: SigningOperation;
  document: SigningDocumentContext;
  pair: Record<string, any>;
  token: string;
};

function resultRows<T>(result: unknown): T[] {
  const resultObject = result as { rows?: T[] } | null;
  if (Array.isArray(resultObject?.rows)) return resultObject.rows;
  return [];
}

function defaultDependencies(): LocalSigningDependencies {
  return {
    db: defaultDb as unknown as LocalSigningDatabase,
    comparePasswords: defaultComparePasswords,
    readLegalDocument,
    storeLegalDocument,
    verifyAssigneeSignaturePosition: defaultVerifyAssigneeSignaturePosition,
    renderLocallySignedPdf,
    renderLocalSigningEvidencePdf,
    getLocalSigningFontSha256,
    randomChallengeToken: () => randomBytes(32).toString("base64url"),
    randomUUID,
    now: () => new Date(),
  };
}

function makeDependencies(
  overrides: Partial<LocalSigningDependencies> = {},
): LocalSigningDependencies {
  return { ...defaultDependencies(), ...overrides };
}

function sha256HexText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(object[key])}`,
  ).join(",")}}`;
}

function parseJsonObject(value: unknown, label: string): Record<string, any> {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new LocalSigningError(`${label} is invalid JSON.`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalSigningError(`${label} is invalid.`);
  }
  return parsed as Record<string, any>;
}

function requiredString(value: unknown, label: string, maxLength = 500): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new LocalSigningError(`${label} is required and must be no longer than ${maxLength} characters.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new LocalSigningError(`${label} is invalid.`);
  }
  return number;
}

function safeBoundedEvidence(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseDate(value: unknown, label: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) throw new LocalSigningError(`${label} is invalid.`);
  return date;
}

function randomChallenge(dependencies: LocalSigningDependencies): string {
  const token = dependencies.randomChallengeToken();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    throw new Error("Signing challenge generator returned an invalid cryptographic token.");
  }
  return token;
}

function challengeDigest(token: string): string {
  return sha256HexText(token);
}

function tokenMatches(token: string, storedHash: unknown): boolean {
  if (typeof storedHash !== "string" || !SHA256_PATTERN.test(storedHash)) return false;
  const suppliedHash = Buffer.from(challengeDigest(token), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");
  return suppliedHash.length === expectedHash.length && timingSafeEqual(suppliedHash, expectedHash);
}

function legalPdfReference(recordKey: string, kind: "signed_pdf" | "audit_certificate_pdf"): string {
  if (!UUID_PATTERN.test(recordKey)) throw new LocalSigningError("Stored local-signing object key is invalid.");
  return `legal/documents/${recordKey}/${kind}`;
}

function validateSignaturePngData(value: unknown): { bytes: Buffer; sha256: string } {
  if (typeof value !== "string" || value.length > MAX_LOCAL_SIGNING_REQUEST_BYTES) {
    throw new LocalSigningError("Draw a signature and submit it as a PNG no larger than 512 KB.");
  }
  const base64 = value.startsWith(BASE64_PNG_PREFIX)
    ? value.slice(BASE64_PNG_PREFIX.length)
    : value;
  if (
    base64.length === 0 ||
    base64.length > Math.ceil(512 * 1024 / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
    base64.length % 4 !== 0
  ) {
    throw new LocalSigningError("Draw a signature and submit it as a valid PNG no larger than 512 KB.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64) {
    throw new LocalSigningError("The signature PNG is not valid canonical base64 data.");
  }
  validateSignaturePng(bytes);
  return { bytes, sha256: sha256Hex(bytes) };
}

function verifyPlacementMatches(
  storedValue: unknown,
  actual: PdfTextPosition,
  expectedName: string,
  expectedTemplateVersionId: string,
): LocalSignaturePlacement {
  const stored = parseJsonObject(storedValue, "Stored signature placement");
  const requiredFields = [
    "pageNumber", "x", "y", "width", "height", "pageWidth", "pageHeight",
  ] as const;
  const mismatches = requiredFields
    .filter((field) => Number(stored[field]) !== actual[field])
    .map((field) => `coordinate ${field}`);
  if (stored.anchorText !== expectedName || actual.anchorText !== expectedName) {
    mismatches.push("verified signer-name anchor");
  }
  if (
    String(stored.templateVersionId) !== expectedTemplateVersionId ||
    String(actual.templateVersionId) !== expectedTemplateVersionId
  ) {
    mismatches.push("pinned template version");
  }
  if (
    stored.coordinateSystem !== "pdf-points-top-left" ||
    actual.coordinateSystem !== "pdf-points-top-left"
  ) {
    mismatches.push("coordinate system");
  }
  if (mismatches.length > 0) {
    throw new LocalSigningError(
      `The stored assignee signature location does not match the verified name in the unsigned PDF (${mismatches.join(", ")}).`,
    );
  }
  const position = {
    ...actual,
    templateVersionId: expectedTemplateVersionId,
    anchorText: expectedName,
  };
  if (
    position.x < 0 || position.y < 0 ||
    position.width <= 0 || position.height <= 0 ||
    position.x + position.width > position.pageWidth + 1 ||
    position.y + position.height > position.pageHeight + 1
  ) {
    throw new LocalSigningError("The verified assignee signature area is outside its PDF page.");
  }
  return position;
}

async function loadOwnedDocument(
  executor: SqlExecutor,
  documentId: number,
  userId: number,
  lock = false,
): Promise<SigningDocumentContext> {
  const query = sql`
    SELECT d.id, d.pair_id, d.document_type, d.template_id, d.status AS document_status,
      d.unsigned_pdf_key, d.unsigned_pdf_sha256, d.signature_placement,
      d.signing_provider, d.signing_envelope_id, d.signed_pdf_key, d.signed_pdf_sha256,
      d.signing_certificate_key, p.user_id, p.status AS pair_status,
      p.reservation_id, p.property_id, p.full_name_snapshot, p.units_snapshot,
      p.property_area_sqm, p.data_snapshot, p.documents_ready_at, u.email, u.password,
      pr.name AS property_name, pr.location AS property_location
    FROM legal_documents d
    JOIN legal_document_pairs p ON p.id = d.pair_id
    JOIN users u ON u.id = p.user_id
    JOIN properties pr ON pr.id = p.property_id
    WHERE d.id = ${documentId} AND p.user_id = ${userId}
    ${lock ? sql`FOR UPDATE OF p, d` : sql``}
  `;
  const document = resultRows<SigningDocumentContext>(await executor.execute(query))[0];
  if (!document) throw new LocalSigningError("Legal document not found.", 404);
  return document;
}

async function assertPairReady(
  executor: SqlExecutor,
  document: SigningDocumentContext,
): Promise<void> {
  if (!["documents_ready", "signing"].includes(document.pair_status)) {
    throw new LocalSigningError("Both legal documents must be ready before local signing can begin.", 409);
  }
  if (!document.documents_ready_at) {
    throw new LocalSigningError("The legal document pair is not marked ready for signing.", 409);
  }
  const docs = resultRows<Record<string, any>>(await executor.execute(sql`
    SELECT id, status, unsigned_pdf_key, unsigned_pdf_sha256, signature_placement,
      signing_provider, signed_pdf_key, signed_pdf_sha256, signing_certificate_key
    FROM legal_documents
    WHERE pair_id = ${document.pair_id}
    ORDER BY id
    ${sql`FOR UPDATE`}
  `));
  if (
    docs.length !== 2 ||
    docs.some((candidate) =>
      !candidate.unsigned_pdf_key ||
      !SHA256_PATTERN.test(String(candidate.unsigned_pdf_sha256 || "")) ||
      !candidate.signature_placement
    )
  ) {
    throw new LocalSigningError("Both immutable unsigned legal PDFs must be stored before signing.", 409);
  }
}

async function hasLegacyProviderSigningHistory(
  executor: SqlExecutor,
  documentId: number,
): Promise<boolean> {
  // The legacy provider table is optional in a clean local-only installation.
  // When present, its document history remains authoritative and immutable.
  const legacySchema = resultRows<{ installed: boolean }>(await executor.execute(sql`
    SELECT to_regclass('public.legal_signing_operations') IS NOT NULL AS installed
  `))[0]?.installed;
  if (!legacySchema) return false;
  return resultRows<{ exists: boolean }>(await executor.execute(sql`
    SELECT EXISTS(
      SELECT 1 FROM legal_signing_operations WHERE document_id = ${documentId}
    ) AS exists
  `))[0]?.exists === true;
}

async function assertNoPriorSigning(
  executor: SqlExecutor,
  document: SigningDocumentContext,
): Promise<void> {
  if (
    (document.signing_provider && document.signing_provider !== "brikvest_local") ||
    document.signing_envelope_id ||
    document.signed_pdf_key ||
    document.signed_pdf_sha256 ||
    document.signing_certificate_key ||
    document.document_status === "investor_signed"
  ) {
    throw new LocalSigningError("This document already has signing history and cannot be locally signed again.", 409);
  }
  if (await hasLegacyProviderSigningHistory(executor, document.id)) {
    throw new LocalSigningError("This document has historical external signing activity and is locked against local re-signing.", 409);
  }
}

async function checkPerUserReauthCapacity(
  executor: SqlExecutor,
  userId: number,
): Promise<{ blocked: boolean; retryAt?: Date }> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(${"local-legal-signing-reauth:" + userId}))
  `);
  const totals = resultRows<{ failed: number | string; active: number | string; locked_until: Date | string | null }>(
    await executor.execute(sql`
      SELECT
        (SELECT COUNT(*)::integer
          FROM legal_audit_events
          WHERE actor_type = 'system' AND actor_id = ${userId}
            AND event_type = 'local_signing_reauth_failed'
            AND created_at > now() - interval '15 minutes') AS failed,
        (SELECT COUNT(*)::integer
          FROM legal_audit_events started
          WHERE started.actor_type = 'system' AND started.actor_id = ${userId}
            AND started.event_type = 'local_signing_reauth_attempt_started'
            AND started.created_at > now() - interval '15 minutes'
            AND NOT EXISTS (
              SELECT 1 FROM legal_audit_events finished
              WHERE finished.actor_type = 'system' AND finished.actor_id = ${userId}
                AND finished.event_type IN (
                  'local_signing_reauth_failed',
                  'local_signing_reauth_succeeded',
                  'local_signing_reauth_challenge_expired'
                )
                AND finished.details->>'attemptId' = started.details->>'attemptId'
            )) AS active,
        (SELECT MAX(auth_locked_until)
          FROM local_legal_signing_operations
          WHERE user_id = ${userId} AND auth_locked_until > now()) AS locked_until
    `),
  )[0];
  const failed = Number(totals?.failed || 0);
  const active = Number(totals?.active || 0);
  const lockedUntil = totals?.locked_until ? parseDate(totals.locked_until, "Authentication lock time") : null;
  const blocked = !!lockedUntil || failed + active >= LOCAL_SIGNING_MAX_REAUTH_ATTEMPTS;
  return { blocked, retryAt: lockedUntil || undefined };
}

async function lockUserAfterRepeatedFailures(
  executor: SqlExecutor,
  userId: number,
  retryAt?: Date,
): Promise<void> {
  await executor.execute(sql`
    UPDATE local_legal_signing_operations
    SET auth_locked_until = GREATEST(COALESCE(auth_locked_until, now()), ${retryAt || new Date(0)}),
        updated_at = now()
    WHERE user_id = ${userId} AND status = 'draft'
  `);
}

function retryAfterMessage(date?: Date): string {
  if (!date) return "Too many password-verification attempts are in progress. Wait 15 minutes before trying again.";
  const minutes = Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60_000));
  return `Too many password attempts. Wait approximately ${minutes} minute${minutes === 1 ? "" : "s"} before trying again.`;
}

async function finishAuthAttempt(
  dependencies: LocalSigningDependencies,
  input: {
    userId: number;
    pairId: number;
    documentId: number;
    operationId: number;
    attemptId: string;
    result: "failed" | "succeeded" | "challenge_expired";
  },
): Promise<{ locked: boolean; retryAt?: Date }> {
  return dependencies.db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${"local-legal-signing-reauth:" + input.userId}))
    `);
    const nowRow = resultRows<{ now: Date | string }>(await tx.execute(sql`SELECT now() AS now`))[0];
    const now = parseDate(nowRow?.now, "Database time");
    await tx.execute(sql`
      INSERT INTO legal_audit_events
        (pair_id, actor_type, actor_id, event_type, details)
      VALUES (
        ${input.pairId}, 'system', ${input.userId},
        ${input.result === "failed"
          ? "local_signing_reauth_failed"
          : input.result === "succeeded"
            ? "local_signing_reauth_succeeded"
            : "local_signing_reauth_challenge_expired"},
        ${JSON.stringify({ attemptId: input.attemptId, documentId: input.documentId, operationId: input.operationId })}::jsonb
      )
    `);
    if (input.result !== "failed") return { locked: false };

    const operation = resultRows<{ status: string; failed_auth_attempts: number }>(
      await tx.execute(sql`
        UPDATE local_legal_signing_operations
        SET failed_auth_attempts = failed_auth_attempts + 1,
            updated_at = now()
        WHERE id = ${input.operationId} AND status = 'draft'
        RETURNING status, failed_auth_attempts
      `),
    )[0];
    const failures = resultRows<{ count: number | string }>(await tx.execute(sql`
      SELECT COUNT(*)::integer AS count
      FROM legal_audit_events
      WHERE actor_type = 'system' AND actor_id = ${input.userId}
        AND event_type = 'local_signing_reauth_failed'
        AND created_at > now() - interval '15 minutes'
    `))[0]?.count;
    if (Number(failures || 0) < LOCAL_SIGNING_MAX_REAUTH_ATTEMPTS) {
      return { locked: false };
    }
    const retryAt = new Date(now.getTime() + LOCAL_SIGNING_REAUTH_WINDOW_MS);
    await lockUserAfterRepeatedFailures(tx, input.userId, retryAt);
    return { locked: true, retryAt };
  });
}

function validateRequestSize(body: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    throw new LocalSigningError("Signing request body is invalid.");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_LOCAL_SIGNING_REQUEST_BYTES) {
    throw new LocalSigningError("Signing request must not exceed 750 KB.");
  }
}

async function verifyUnsignedPdf(
  dependencies: LocalSigningDependencies,
  document: SigningDocumentContext,
  executor: SqlExecutor = dependencies.db,
): Promise<{ unsignedPdf: Buffer; placement: LocalSignaturePlacement }> {
  const unsignedPdf = await dependencies.readLegalDocument(
    document.unsigned_pdf_key,
    "unsigned_pdf" as LegalDocumentFileKind,
  );
  const actualHash = sha256Hex(unsignedPdf);
  if (
    !SHA256_PATTERN.test(document.unsigned_pdf_sha256) ||
    actualHash !== document.unsigned_pdf_sha256.toLowerCase()
  ) {
    throw new LocalSigningError("The protected unsigned PDF does not match its immutable SHA-256 digest.", 409);
  }
  let actual: PdfTextPosition;
  const templateVersion = resultRows<{ version: number | string }>(await executor.execute(sql`
    SELECT version FROM legal_templates WHERE id = ${document.template_id}
  `))[0]?.version;
  if (!Number.isSafeInteger(Number(templateVersion)) || Number(templateVersion) < 1) {
    throw new LocalSigningError("The pinned legal template version cannot be verified.", 409);
  }
  const expectedTemplateVersionId = `${document.document_type}:v${Number(templateVersion)}`;
  try {
    actual = await dependencies.verifyAssigneeSignaturePosition(unsignedPdf, {
      assigneeFullName: document.full_name_snapshot,
      templateVersionId: expectedTemplateVersionId,
    });
  } catch (error) {
    throw new LocalSigningError(
      `The approved investor signature position could not be safely verified: ${
        error instanceof Error ? error.message : "PDF text-position validation failed."
      }`,
      409,
      { cause: error },
    );
  }
  const placement = verifyPlacementMatches(
    document.signature_placement,
    actual,
    document.full_name_snapshot,
    expectedTemplateVersionId,
  );
  return { unsignedPdf, placement };
}

/**
 * Start or refresh one durable challenge for the document. Only a draft can be
 * restarted; accepted, in-flight, and completed operations can never re-sign.
 */
export async function beginLocalSigning(
  documentIdValue: number,
  userIdValue: number,
  overrides: Partial<LocalSigningDependencies> = {},
): Promise<BeginLocalSigningResult> {
  const documentId = positiveInteger(documentIdValue, "Document ID");
  const userId = positiveInteger(userIdValue, "Investor ID");
  const dependencies = makeDependencies(overrides);

  const snapshot = await loadOwnedDocument(dependencies.db, documentId, userId);
  const holdingIdentity = {
    reservationId: Number(snapshot.reservation_id),
    userId,
    propertyId: Number(snapshot.property_id),
  };
  await assertActiveConfirmedHolding(dependencies.db, holdingIdentity, { lock: false });
  await assertPairReady(dependencies.db, snapshot);
  await assertNoPriorSigning(dependencies.db, snapshot);
  if (
    !snapshot.unsigned_pdf_key ||
    !snapshot.unsigned_pdf_sha256 ||
    !snapshot.signature_placement ||
    !snapshot.full_name_snapshot ||
    !snapshot.email
  ) {
    throw new LocalSigningError("This legal document is missing verified signer or unsigned PDF data.", 409);
  }
  const { placement } = await verifyUnsignedPdf(dependencies, snapshot);
  const challengeToken = randomChallenge(dependencies);
  const challengeHash = challengeDigest(challengeToken);
  const challengeExpiresAt = new Date(dependencies.now().getTime() + LOCAL_SIGNING_CHALLENGE_TTL_MS);
  if (!Number.isFinite(challengeExpiresAt.getTime())) throw new Error("Signing challenge clock is invalid.");

  const result = await dependencies.db.transaction(async (tx) => {
    const rate = await checkPerUserReauthCapacity(tx, userId);
    if (rate.blocked) {
      throw new LocalSigningError(retryAfterMessage(rate.retryAt), 429);
    }
    await assertActiveConfirmedHolding(tx, holdingIdentity);
    const current = await loadOwnedDocument(tx, documentId, userId, true);
    if (
      Number(current.reservation_id) !== holdingIdentity.reservationId ||
      Number(current.property_id) !== holdingIdentity.propertyId ||
      Number(current.user_id) !== holdingIdentity.userId
    ) {
      throw new LocalSigningError("The legal approval no longer matches its confirmed investor holding.", 409);
    }
    await assertPairReady(tx, current);
    await assertNoPriorSigning(tx, current);
    if (
      current.unsigned_pdf_sha256?.toLowerCase() !== snapshot.unsigned_pdf_sha256.toLowerCase() ||
      current.unsigned_pdf_key !== snapshot.unsigned_pdf_key ||
      Number(current.template_id) !== Number(snapshot.template_id) ||
      current.full_name_snapshot !== snapshot.full_name_snapshot
    ) {
      throw new LocalSigningError("The legal document changed while preparing the signing session. Restart review.", 409);
    }

    const existing = resultRows<SigningOperation>(await tx.execute(sql`
      SELECT * FROM local_legal_signing_operations
      WHERE document_id = ${documentId}
      FOR UPDATE
    `))[0];
    if (existing && existing.status !== "draft") {
      throw new LocalSigningError(
        existing.status === "completed"
          ? "This document is already signed and cannot be signed again."
          : "This document already has an accepted signing operation. Its existing result is being finalized.",
        409,
      );
    }

    const expiry = existing?.auth_locked_until
      ? parseDate(existing.auth_locked_until, "Authentication lock time")
      : null;
    if (expiry && expiry.getTime() > dependencies.now().getTime()) {
      throw new LocalSigningError(retryAfterMessage(expiry), 429);
    }
    if (existing) {
      if (
        existing.signer_name !== current.full_name_snapshot ||
        existing.signer_email !== current.email ||
        existing.unsigned_pdf_sha256 !== current.unsigned_pdf_sha256.toLowerCase()
      ) {
        throw new LocalSigningError("The saved signing operation does not match the approved investor or document.", 409);
      }
      const updated = resultRows<SigningOperation>(await tx.execute(sql`
        UPDATE local_legal_signing_operations
        SET challenge_hash = ${challengeHash},
            challenge_expires_at = ${challengeExpiresAt},
            auth_locked_until = NULL,
            failed_auth_attempts = CASE
              WHEN auth_locked_until IS NOT NULL AND auth_locked_until <= now() THEN 0
              ELSE failed_auth_attempts
            END,
            last_error = NULL,
            updated_at = now()
        WHERE id = ${existing.id} AND status = 'draft'
        RETURNING *
      `))[0];
      if (!updated) throw new LocalSigningError("The signing session could not be refreshed.", 409);
      return { operation: updated, created: false };
    }

    const signedKey = dependencies.randomUUID();
    const certificateKey = dependencies.randomUUID();
    if (!UUID_PATTERN.test(signedKey) || !UUID_PATTERN.test(certificateKey) || signedKey === certificateKey) {
      throw new Error("Local-signing artifact key generator returned an invalid UUID.");
    }
    const inserted = resultRows<SigningOperation>(await tx.execute(sql`
      INSERT INTO local_legal_signing_operations (
        document_id, pair_id, user_id, template_id, signer_name, signer_email,
        unsigned_pdf_sha256, signature_placement, signed_pdf_record_key,
        certificate_record_key, status, challenge_hash, challenge_expires_at
      ) VALUES (
        ${documentId}, ${current.pair_id}, ${userId}, ${current.template_id},
        ${current.full_name_snapshot}, ${current.email},
        ${current.unsigned_pdf_sha256.toLowerCase()},
        ${JSON.stringify(placement)}::jsonb, ${signedKey}::uuid, ${certificateKey}::uuid,
        'draft', ${challengeHash}, ${challengeExpiresAt}
      )
      RETURNING *
    `))[0];
    if (!inserted) throw new LocalSigningError("Could not create a local signing session.", 500);
    return { operation: inserted, created: true };
  });

  return {
    documentId,
    operationId: Number(result.operation.id),
    challengeToken,
    expiresAt: parseDate(result.operation.challenge_expires_at, "Signing challenge expiry").toISOString(),
    unsignedPdfSha256: snapshot.unsigned_pdf_sha256.toLowerCase(),
    signerName: snapshot.full_name_snapshot,
    consentVersion: LOCAL_SIGNING_CONSENT_VERSION,
    consentText: LOCAL_SIGNING_CONSENT_TEXT,
  };
}

function requireChallengeInput(body: Record<string, any>, operation: SigningOperation): string {
  const token = requiredString(body.challengeToken, "Signing challenge", 100);
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    throw new LocalSigningError("The signing challenge is invalid or expired.", 409);
  }
  if (!tokenMatches(token, operation.challenge_hash)) {
    throw new LocalSigningError("The signing challenge is invalid or expired.", 409);
  }
  return token;
}

async function getDocumentAndOperation(
  executor: SqlExecutor,
  documentId: number,
  userId: number,
  lock: boolean,
): Promise<{ document: SigningDocumentContext; operation: SigningOperation }> {
  const document = await loadOwnedDocument(executor, documentId, userId, lock);
  const operation = resultRows<SigningOperation>(await executor.execute(sql`
    SELECT * FROM local_legal_signing_operations
    WHERE document_id = ${documentId} AND user_id = ${userId}
    ${lock ? sql`FOR UPDATE` : sql``}
  `))[0];
  if (!operation) throw new LocalSigningError("A valid signing session is required.", 409);
  return { document, operation };
}

async function reserveReauthAttempt(
  dependencies: LocalSigningDependencies,
  documentId: number,
  userId: number,
  body: Record<string, any>,
): Promise<
  | { state: "completed"; result: CompleteLocalSigningResult }
  | { state: "pending"; result: CompleteLocalSigningResult }
  | {
      state: "reserved";
      attemptId: string;
      passwordHash: string;
      operationId: number;
      pairId: number;
      signatureMethod: "drawn" | "typed";
    }
> {
  return dependencies.db.transaction(async (tx) => {
    const rate = await checkPerUserReauthCapacity(tx, userId);
    if (rate.blocked) throw new LocalSigningError(retryAfterMessage(rate.retryAt), 429);
    const initial = await getDocumentAndOperation(tx, documentId, userId, false);
    const holdingIdentity = {
      reservationId: Number(initial.document.reservation_id),
      userId,
      propertyId: Number(initial.document.property_id),
    };
    await assertActiveConfirmedHolding(tx, holdingIdentity);
    const { document, operation } = await getDocumentAndOperation(tx, documentId, userId, true);
    if (
      Number(document.reservation_id) !== holdingIdentity.reservationId ||
      Number(document.property_id) !== holdingIdentity.propertyId ||
      Number(document.user_id) !== holdingIdentity.userId
    ) {
      throw new LocalSigningError("The legal approval no longer matches its confirmed investor holding.", 409);
    }
    requireChallengeInput(body, operation);
    if (operation.status === "completed") {
      return {
        state: "completed",
        result: {
          status: "investor_signed",
          documentId,
          operationId: Number(operation.id),
          signedPdfSha256: operation.signed_pdf_sha256,
          certificateSha256: operation.certificate_sha256,
        },
      };
    }
    if (operation.status === "accepted" || operation.status === "signing") {
      return {
        state: "pending",
        result: { status: "processing", documentId, operationId: Number(operation.id) },
      };
    }
    if (operation.status !== "draft") {
      throw new LocalSigningError("The local signing operation is in an invalid state.", 409);
    }
    const expiresAt = parseDate(operation.challenge_expires_at, "Signing challenge expiry");
    if (expiresAt.getTime() <= dependencies.now().getTime()) {
      throw new LocalSigningError("The signing challenge expired. Start a new review session.", 409);
    }
    if (body.consent !== true || body.reviewed !== true) {
      throw new LocalSigningError("Document review confirmation and electronic-signature consent are required.");
    }
    if (body.consentVersion !== LOCAL_SIGNING_CONSENT_VERSION) {
      throw new LocalSigningError("The displayed consent version is no longer current. Restart the signing session.", 409);
    }
    if (
      typeof body.unsignedPdfSha256 !== "string" ||
      body.unsignedPdfSha256.toLowerCase() !== operation.unsigned_pdf_sha256.toLowerCase()
    ) {
      throw new LocalSigningError("The reviewed PDF hash does not match the current signing session.", 409);
    }
    if (
      typeof body.typedName !== "string" ||
      body.typedName.length > 200 ||
      body.typedName !== operation.signer_name ||
      operation.signer_name !== document.full_name_snapshot
    ) {
      throw new LocalSigningError("The typed name must exactly match the approved investor name.");
    }
    const signatureMethod = body.signatureMethod === undefined ? "drawn" : body.signatureMethod;
    if (signatureMethod !== "drawn" && signatureMethod !== "typed") {
      throw new LocalSigningError("Signature image method must be drawn or typed.");
    }
    if (
      typeof body.password !== "string" ||
      body.password.length < 1 ||
      body.password.length > MAX_LOCAL_SIGNING_PASSWORD_LENGTH
    ) {
      throw new LocalSigningError(`Re-enter your current password (maximum ${MAX_LOCAL_SIGNING_PASSWORD_LENGTH} characters).`);
    }
    const signature = validateSignaturePngData(body.signaturePng);
    if (
      operation.signed_pdf_record_key === operation.certificate_record_key ||
      !UUID_PATTERN.test(operation.signed_pdf_record_key) ||
      !UUID_PATTERN.test(operation.certificate_record_key)
    ) {
      throw new LocalSigningError("Stored local-signing artifact keys are invalid.", 409);
    }
    if (operation.auth_locked_until) {
      const lockedUntil = parseDate(operation.auth_locked_until, "Authentication lock time");
      if (lockedUntil.getTime() > dependencies.now().getTime()) {
        throw new LocalSigningError(retryAfterMessage(lockedUntil), 429);
      }
    }

    // Validate the exact object bytes and template-derived assignee anchor
    // before consuming a costly password comparison.
    const verified = await verifyUnsignedPdf(dependencies, document, tx);
    if (sha256Hex(verified.unsignedPdf) !== operation.unsigned_pdf_sha256.toLowerCase()) {
      throw new LocalSigningError("The unsigned PDF changed after the signing session was issued.", 409);
    }
    const attemptId = dependencies.randomUUID();
    if (!UUID_PATTERN.test(attemptId)) throw new Error("Reauthentication attempt ID generator returned an invalid UUID.");
    const password = resultRows<{ password: string }>(await tx.execute(sql`
      SELECT password FROM users WHERE id = ${userId}
    `))[0]?.password;
    if (typeof password !== "string" || password.length === 0) {
      throw new LocalSigningError("Current-password reauthentication is unavailable for this account.", 409);
    }
    await tx.execute(sql`
      INSERT INTO legal_audit_events
        (pair_id, actor_type, actor_id, event_type, details)
      VALUES (
        ${document.pair_id}, 'system', ${userId},
        'local_signing_reauth_attempt_started',
        ${JSON.stringify({ attemptId, documentId, operationId: Number(operation.id) })}::jsonb
      )
    `);
    return {
      state: "reserved",
      attemptId,
      passwordHash: password,
      operationId: Number(operation.id),
      pairId: Number(document.pair_id),
      signatureMethod,
    };
  });
}

function resultFromOperation(
  documentId: number,
  operation: SigningOperation,
): CompleteLocalSigningResult {
  if (operation.status === "completed") {
    return {
      status: "investor_signed",
      documentId,
      operationId: Number(operation.id),
      signedPdfSha256: String(operation.signed_pdf_sha256),
      certificateSha256: String(operation.certificate_sha256),
    };
  }
  return {
    status: "processing",
    documentId,
    operationId: Number(operation.id),
  };
}

async function acceptSignature(
  dependencies: LocalSigningDependencies,
  input: {
    documentId: number;
    userId: number;
    operationId: number;
    attemptId: string;
    signaturePng: Buffer;
    signatureSha256: string;
    signatureMethod: "drawn" | "typed";
    typedName: string;
    evidence: LocalSigningActorEvidence;
  },
): Promise<SigningOperation> {
  return dependencies.db.transaction(async (tx) => {
    const initialDocument = await loadOwnedDocument(tx, input.documentId, input.userId, false);
    const holdingIdentity = {
      reservationId: Number(initialDocument.reservation_id),
      userId: input.userId,
      propertyId: Number(initialDocument.property_id),
    };
    await assertActiveConfirmedHolding(tx, holdingIdentity);
    const document = await loadOwnedDocument(tx, input.documentId, input.userId, true);
    if (
      Number(document.reservation_id) !== holdingIdentity.reservationId ||
      Number(document.property_id) !== holdingIdentity.propertyId ||
      Number(document.user_id) !== holdingIdentity.userId
    ) {
      throw new LocalSigningError("The legal approval no longer matches its confirmed investor holding.", 409);
    }
    const operation = resultRows<SigningOperation>(await tx.execute(sql`
      SELECT * FROM local_legal_signing_operations
      WHERE id = ${input.operationId} AND document_id = ${input.documentId}
        AND user_id = ${input.userId}
      FOR UPDATE
    `))[0];
    if (!operation) throw new LocalSigningError("Signing operation not found.", 404);
    if (operation.status !== "draft") return operation;
    await assertPairReady(tx, document);
    await assertNoPriorSigning(tx, document);
    if (!["awaiting_signature", "signing_in_progress"].includes(document.document_status)) {
      throw new LocalSigningError("This document is no longer waiting for its investor signature.", 409);
    }
    const expiry = parseDate(operation.challenge_expires_at, "Signing challenge expiry");
    if (expiry.getTime() <= dependencies.now().getTime()) {
      throw new LocalSigningError("The signing challenge expired during password verification. Start a new review session.", 409);
    }
    if (
      operation.signer_name !== document.full_name_snapshot ||
      operation.unsigned_pdf_sha256?.toLowerCase() !== document.unsigned_pdf_sha256?.toLowerCase()
    ) {
      throw new LocalSigningError("The investor identity or unsigned PDF changed during signing.", 409);
    }
    if (sha256Hex(input.signaturePng) !== input.signatureSha256) {
      throw new LocalSigningError("The signature image changed during signing.", 409);
    }
    const nowValue = resultRows<{ now: Date | string }>(await tx.execute(sql`SELECT now() AS now`))[0]?.now;
    const acceptedAt = parseDate(nowValue, "Server acceptance time");
    const propertyData = parseJsonObject(document.data_snapshot, "Holding evidence snapshot");
    const propertyName = safeBoundedEvidence(propertyData.propertyName ?? document.property_name, 300);
    const propertyLocation = safeBoundedEvidence(propertyData.propertyLocation ?? document.property_location, 500);
    const units = String(propertyData.units ?? document.units_snapshot ?? "");
    const areaSqm = String(propertyData.propertyAreaSqm ?? document.property_area_sqm ?? "");
    const signerName = document.full_name_snapshot;
    const renderFontSha256 = await dependencies.getLocalSigningFontSha256([
      signerName,
      propertyName,
      propertyLocation,
      units,
      areaSqm,
      document.document_type,
      LOCAL_SIGNING_CONSENT_VERSION,
      LOCAL_SIGNING_CONSENT_TEXT,
    ].join(" "));
    const evidenceSnapshot = {
      kind: "local-in-app-acknowledgment",
      documentId: input.documentId,
      pairId: Number(document.pair_id),
      operationId: input.operationId,
      documentType: document.document_type,
      templateId: Number(document.template_id),
      reservationId: Number(document.reservation_id),
      propertyId: Number(document.property_id),
      propertyName,
      propertyLocation,
      units,
      areaSqm,
      signerName,
      unsignedPdfSha256: operation.unsigned_pdf_sha256.toLowerCase(),
      signatureSha256: input.signatureSha256,
      signatureMethod: input.signatureMethod,
      renderFontSha256,
      signaturePlacement: parseJsonObject(operation.signature_placement, "Stored signature placement"),
      consentVersion: LOCAL_SIGNING_CONSENT_VERSION,
      consentText: LOCAL_SIGNING_CONSENT_TEXT,
      reviewed: true,
      consented: true,
      separateExecutionAcknowledged: true,
      reviewedAt: acceptedAt.toISOString(),
      acceptedAt: acceptedAt.toISOString(),
      reauthenticatedAt: acceptedAt.toISOString(),
      ip: safeBoundedEvidence(input.evidence.ip, 100),
      userAgent: safeBoundedEvidence(input.evidence.userAgent, 500),
    };
    const evidenceSha256 = sha256HexText(stableStringify(evidenceSnapshot));
    const updated = resultRows<SigningOperation>(await tx.execute(sql`
      UPDATE local_legal_signing_operations
      SET status = 'accepted',
          consent_version = ${LOCAL_SIGNING_CONSENT_VERSION},
          consent_text = ${LOCAL_SIGNING_CONSENT_TEXT},
          accepted_at = ${acceptedAt},
          reauthenticated_at = ${acceptedAt},
          evidence_snapshot = ${JSON.stringify(evidenceSnapshot)}::jsonb,
          evidence_sha256 = ${evidenceSha256},
          signature_png_base64 = ${input.signaturePng.toString("base64")},
          signature_sha256 = ${input.signatureSha256},
          failed_auth_attempts = 0,
          auth_locked_until = NULL,
          last_error = NULL,
          updated_at = now()
      WHERE id = ${input.operationId} AND status = 'draft'
      RETURNING *
    `))[0];
    if (!updated) throw new LocalSigningError("The signing operation was already accepted by another request.", 409);
    await tx.execute(sql`
      INSERT INTO legal_audit_events
        (pair_id, actor_type, actor_id, event_type, details)
      VALUES (
        ${document.pair_id}, 'system', ${input.userId},
        'local_signing_consent_accepted',
        ${JSON.stringify({
          operationId: input.operationId,
          documentId: input.documentId,
          consentVersion: LOCAL_SIGNING_CONSENT_VERSION,
          unsignedPdfSha256: operation.unsigned_pdf_sha256.toLowerCase(),
          signatureSha256: input.signatureSha256,
          evidenceSha256,
        })}::jsonb
      )
    `);
    await tx.execute(sql`
      UPDATE legal_documents
      SET status = 'signing_in_progress'
      WHERE id = ${input.documentId}
        AND status IN ('awaiting_signature', 'signing_in_progress')
        AND signed_pdf_key IS NULL
        AND signing_provider IS NULL
    `);
    await tx.execute(sql`
      UPDATE legal_document_pairs
      SET status = 'signing', last_error = NULL
      WHERE id = ${document.pair_id} AND status IN ('documents_ready', 'signing')
    `);
    await tx.execute(sql`
      INSERT INTO legal_jobs (pair_id, kind, status)
      VALUES (${document.pair_id}, 'reconcile', 'queued')
      ON CONFLICT (pair_id, kind) DO UPDATE
      SET status = 'queued', available_at = now(), attempts = 0,
          last_error = NULL, updated_at = now()
      WHERE legal_jobs.status IN ('dead', 'blocked', 'complete')
    `);
    return updated;
  });
}

async function releaseOperationLease(
  dependencies: LocalSigningDependencies,
  operationId: number,
  leaseToken: string,
  error: unknown,
): Promise<void> {
  const message = (error instanceof Error ? error.message : "Local signing finalization failed")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 1_000);
  await dependencies.db.execute(sql`
    UPDATE local_legal_signing_operations
    SET status = 'accepted',
        lease_token = NULL,
        lease_until = NULL,
        last_error = ${message || "Local signing finalization failed"},
        updated_at = now()
    WHERE id = ${operationId} AND status = 'signing' AND lease_token = ${leaseToken}::uuid
  `);
}

async function writeOnceAndVerify(
  dependencies: LocalSigningDependencies,
  recordKey: string,
  kind: "signed_pdf" | "audit_certificate_pdf",
  bytes: Buffer,
): Promise<{ key: string; bytes: Buffer; sha256: string }> {
  const expectedSha256 = sha256Hex(bytes);
  try {
    const key = await dependencies.storeLegalDocument({ recordKey, kind, contents: bytes });
    return { key, bytes, sha256: expectedSha256 };
  } catch (error) {
    if (!(error instanceof LegalFileAlreadyExistsError)) throw error;
    const key = legalPdfReference(recordKey, kind);
    const existing = await dependencies.readLegalDocument(key, kind);
    const actualSha256 = sha256Hex(existing);
    if (actualSha256 !== expectedSha256) {
      throw new LocalSigningError(
        `A different immutable ${kind === "signed_pdf" ? "signed document" : "evidence certificate"} already occupies its recovery key.`,
        409,
        { cause: error },
      );
    }
    return { key, bytes: existing, sha256: actualSha256 };
  }
}

async function completeClaimedOperation(
  dependencies: LocalSigningDependencies,
  work: OperationWork,
): Promise<CompleteLocalSigningResult> {
  const { operation, document, pair, token } = work;
  const signaturePngBase64 = operation.signature_png_base64;
  if (typeof signaturePngBase64 !== "string") {
    throw new LocalSigningError("Accepted local-signing evidence is missing its saved signature image.", 409);
  }
  const signaturePng = Buffer.from(signaturePngBase64, "base64");
  validateSignaturePng(signaturePng);
  if (
    signaturePng.toString("base64") !== signaturePngBase64 ||
    sha256Hex(signaturePng) !== operation.signature_sha256
  ) {
    throw new LocalSigningError("Saved signature image failed its immutable integrity check.", 409);
  }
  if (
    !SHA256_PATTERN.test(operation.evidence_sha256 || "") ||
    !SHA256_PATTERN.test(operation.unsigned_pdf_sha256 || "") ||
    !operation.accepted_at ||
    !operation.reauthenticated_at ||
    operation.consent_version !== LOCAL_SIGNING_CONSENT_VERSION ||
    operation.consent_text !== LOCAL_SIGNING_CONSENT_TEXT
  ) {
    throw new LocalSigningError("Accepted local-signing consent or evidence is incomplete.", 409);
  }
  const evidenceSnapshot = parseJsonObject(operation.evidence_snapshot, "Accepted signing evidence");
  if (sha256HexText(stableStringify(evidenceSnapshot)) !== operation.evidence_sha256) {
    throw new LocalSigningError("Accepted local-signing evidence failed its immutable integrity check.", 409);
  }
  if (!SHA256_PATTERN.test(evidenceSnapshot.renderFontSha256 || "")) {
    throw new LocalSigningError("The accepted evidence is missing its pinned Unicode renderer font.", 409);
  }
  const currentFontSha256 = await dependencies.getLocalSigningFontSha256([
    evidenceSnapshot.signerName,
    evidenceSnapshot.propertyName,
    evidenceSnapshot.propertyLocation,
    evidenceSnapshot.units,
    evidenceSnapshot.areaSqm,
    evidenceSnapshot.documentType,
    evidenceSnapshot.consentVersion,
    evidenceSnapshot.consentText,
  ].join(" "));
  if (currentFontSha256.toLowerCase() !== evidenceSnapshot.renderFontSha256.toLowerCase()) {
    throw new LocalSigningError(
      "The Unicode PDF renderer font changed after consent was accepted. Restore the pinned DejaVu Sans font before recovery.",
      409,
    );
  }
  const { unsignedPdf, placement } = await verifyUnsignedPdf(dependencies, document);
  if (
    sha256Hex(unsignedPdf) !== operation.unsigned_pdf_sha256.toLowerCase() ||
    document.unsigned_pdf_sha256?.toLowerCase() !== operation.unsigned_pdf_sha256.toLowerCase()
  ) {
    throw new LocalSigningError("The original unsigned PDF no longer matches the consented file.", 409);
  }

  const signedAt = parseDate(operation.accepted_at, "Persisted signature timestamp");
  const signedPdf = await dependencies.renderLocallySignedPdf({
    unsignedPdf,
    signaturePng,
    placement,
    signerName: operation.signer_name,
    signatureMethod: evidenceSnapshot.signatureMethod,
    documentType: document.document_type,
    operationId: Number(operation.id),
    unsignedPdfSha256: operation.unsigned_pdf_sha256.toLowerCase(),
    signaturePngSha256: operation.signature_sha256,
    signedAt,
  });
  const signedArtifact = await writeOnceAndVerify(
    dependencies,
    operation.signed_pdf_record_key,
    "signed_pdf",
    signedPdf,
  );
  const certificatePdf = await dependencies.renderLocalSigningEvidencePdf({
    documentType: document.document_type,
    documentId: Number(document.id),
    pairId: Number(document.pair_id),
    operationId: Number(operation.id),
    reservationId: Number(document.reservation_id),
    propertyName: String(evidenceSnapshot.propertyName || ""),
    propertyLocation: String(evidenceSnapshot.propertyLocation || ""),
    units: String(evidenceSnapshot.units || ""),
    areaSqm: String(evidenceSnapshot.areaSqm || ""),
    signerName: operation.signer_name,
    signatureMethod: evidenceSnapshot.signatureMethod,
    renderFontSha256: evidenceSnapshot.renderFontSha256,
    unsignedPdfSha256: operation.unsigned_pdf_sha256.toLowerCase(),
    signedPdfSha256: signedArtifact.sha256,
    signaturePngSha256: operation.signature_sha256,
    consentVersion: operation.consent_version,
    consentText: operation.consent_text,
    consentedAt: parseDate(operation.accepted_at, "Persisted consent timestamp"),
    reauthenticatedAt: parseDate(operation.reauthenticated_at, "Persisted reauthentication timestamp"),
    reviewedAt: parseDate(evidenceSnapshot.reviewedAt, "Persisted review timestamp"),
    signedAt,
  });
  const certificateArtifact = await writeOnceAndVerify(
    dependencies,
    operation.certificate_record_key,
    "audit_certificate_pdf",
    certificatePdf,
  );

  await dependencies.db.transaction(async (tx) => {
    await assertActiveConfirmedHolding(tx, {
      reservationId: Number(document.reservation_id),
      userId: Number(document.user_id),
      propertyId: Number(document.property_id),
    });
    const lockedPair = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT * FROM legal_document_pairs WHERE id = ${document.pair_id} FOR UPDATE
    `))[0];
    if (!lockedPair) throw new LocalSigningError("Legal document pair not found during finalization.", 409);
    const lockedDocument = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT * FROM legal_documents WHERE id = ${document.id} FOR UPDATE
    `))[0];
    const lockedOperation = resultRows<SigningOperation>(await tx.execute(sql`
      SELECT * FROM local_legal_signing_operations WHERE id = ${operation.id} FOR UPDATE
    `))[0];
    if (!lockedDocument || !lockedOperation) {
      throw new LocalSigningError("Local signing records disappeared during finalization.", 409);
    }
    if (lockedOperation.status === "completed") {
      if (
        lockedOperation.signed_pdf_sha256 !== signedArtifact.sha256 ||
        lockedOperation.certificate_sha256 !== certificateArtifact.sha256
      ) {
        throw new LocalSigningError("Completed local-signing digests differ from the stored recovery artifacts.", 409);
      }
      return;
    }
    if (
      lockedOperation.status !== "signing" ||
      lockedOperation.lease_token !== token ||
      (lockedOperation.lease_until && parseDate(lockedOperation.lease_until, "Operation lease").getTime() <= dependencies.now().getTime())
    ) {
      throw new LocalSigningError("Local signing ownership changed before finalization; a recovery worker will retry.", 409);
    }
    if (
      (lockedDocument.signing_provider && lockedDocument.signing_provider !== "brikvest_local") ||
      lockedDocument.signing_envelope_id ||
      (lockedDocument.signed_pdf_key && lockedDocument.signed_pdf_key !== signedArtifact.key) ||
      (lockedDocument.signed_pdf_sha256 && lockedDocument.signed_pdf_sha256 !== signedArtifact.sha256) ||
      (lockedDocument.signing_certificate_key && lockedDocument.signing_certificate_key !== certificateArtifact.key)
    ) {
      throw new LocalSigningError("Existing signing history or final artifacts cannot be overwritten.", 409);
    }
    if (await hasLegacyProviderSigningHistory(tx, Number(document.id))) {
      throw new LocalSigningError("External signing history appeared before local finalization. No artifact was attached.", 409);
    }
    const finalDocument = resultRows<{ id: number }>(await tx.execute(sql`
      UPDATE legal_documents
      SET status = 'investor_signed',
          signing_provider = 'brikvest_local',
          signed_pdf_key = ${signedArtifact.key},
          signed_pdf_sha256 = ${signedArtifact.sha256},
          signing_certificate_key = ${certificateArtifact.key},
          investor_signed_at = ${signedAt}
      WHERE id = ${document.id}
        AND status IN ('awaiting_signature', 'signing_in_progress')
        AND signed_pdf_key IS NULL
        AND signed_pdf_sha256 IS NULL
        AND signing_certificate_key IS NULL
        AND (signing_provider IS NULL OR signing_provider = 'brikvest_local')
        AND signing_envelope_id IS NULL
      RETURNING id
    `))[0];
    if (!finalDocument) {
      if (
        lockedDocument.signing_provider !== "brikvest_local" ||
        lockedDocument.signed_pdf_key !== signedArtifact.key ||
        lockedDocument.signed_pdf_sha256 !== signedArtifact.sha256 ||
        lockedDocument.signing_certificate_key !== certificateArtifact.key
      ) {
        throw new LocalSigningError("The document is no longer in a state that permits local-signing finalization.", 409);
      }
    }
    const completed = resultRows<SigningOperation>(await tx.execute(sql`
      UPDATE local_legal_signing_operations
      SET status = 'completed',
          lease_token = NULL,
          lease_until = NULL,
          signed_pdf_sha256 = ${signedArtifact.sha256},
          certificate_sha256 = ${certificateArtifact.sha256},
          last_error = NULL,
          completed_at = now(),
          updated_at = now()
      WHERE id = ${operation.id} AND status = 'signing' AND lease_token = ${token}::uuid
      RETURNING id
    `))[0];
    if (!completed) {
      throw new LocalSigningError("The local-signing operation changed before its results could be recorded.", 409);
    }
    const signedDocuments = Number(resultRows<{ count: number | string }>(await tx.execute(sql`
      SELECT COUNT(*)::integer AS count
      FROM legal_documents
      WHERE pair_id = ${document.pair_id}
        AND status = 'investor_signed'
        AND signed_pdf_key IS NOT NULL
        AND signed_pdf_sha256 IS NOT NULL
        AND signing_certificate_key IS NOT NULL
    `))[0]?.count || 0);
    if (signedDocuments === 2) {
      await tx.execute(sql`
        UPDATE legal_document_pairs
        SET status = 'investor_signed',
            investor_signed_at = COALESCE(investor_signed_at, now()),
            last_error = NULL
        WHERE id = ${document.pair_id}
          AND status IN ('documents_ready', 'signing', 'investor_signed')
      `);
    } else {
      await tx.execute(sql`
        UPDATE legal_document_pairs
        SET status = 'signing', last_error = NULL
        WHERE id = ${document.pair_id} AND status IN ('documents_ready', 'signing')
      `);
    }
    await tx.execute(sql`
      INSERT INTO legal_audit_events
        (pair_id, reservation_id, actor_type, actor_id, event_type, details)
      VALUES (
        ${document.pair_id}, ${document.reservation_id}, 'system', ${document.user_id},
        'local_signing_completed',
        ${JSON.stringify({
          documentId: document.id,
          operationId: operation.id,
          unsignedPdfSha256: operation.unsigned_pdf_sha256.toLowerCase(),
          signedPdfSha256: signedArtifact.sha256,
          certificateSha256: certificateArtifact.sha256,
          signatureSha256: operation.signature_sha256,
          consentVersion: operation.consent_version,
          externalExecutionSeparatelyRequired: true,
          qualifiedDigitalSignature: false,
          identityCertificate: false,
        })}::jsonb
      )
    `);
  });

  return {
    status: "investor_signed",
    documentId: Number(document.id),
    operationId: Number(operation.id),
    signedPdfSha256: signedArtifact.sha256,
    certificateSha256: certificateArtifact.sha256,
  };
}

async function claimOperation(
  dependencies: LocalSigningDependencies,
  operationId: number,
): Promise<OperationWork | { state: "completed"; operation: SigningOperation } | { state: "busy"; operation: SigningOperation } | null> {
  return dependencies.db.transaction(async (tx) => {
    const initial = resultRows<SigningOperation>(await tx.execute(sql`
      SELECT * FROM local_legal_signing_operations WHERE id = ${operationId}
    `))[0];
    if (!initial) return null;
    const initialPair = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT reservation_id, user_id, property_id
      FROM legal_document_pairs WHERE id = ${initial.pair_id}
    `))[0];
    if (!initialPair) throw new LocalSigningError("Legal document pair not found.", 404);
    const holdingIdentity = {
      reservationId: Number(initialPair.reservation_id),
      userId: Number(initialPair.user_id),
      propertyId: Number(initialPair.property_id),
    };
    await assertActiveConfirmedHolding(tx, holdingIdentity);
    const pair = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT * FROM legal_document_pairs WHERE id = ${initial.pair_id} FOR UPDATE
    `))[0];
    if (!pair) throw new LocalSigningError("Legal document pair not found.", 404);
    if (
      Number(pair.reservation_id) !== holdingIdentity.reservationId ||
      Number(pair.user_id) !== holdingIdentity.userId ||
      Number(pair.property_id) !== holdingIdentity.propertyId
    ) {
      throw new LocalSigningError("The legal approval no longer matches its confirmed investor holding.", 409);
    }
    const document = resultRows<SigningDocumentContext>(await tx.execute(sql`
      SELECT d.*, p.user_id, p.reservation_id, p.property_id, p.full_name_snapshot,
        p.units_snapshot, p.property_area_sqm, p.data_snapshot, p.status AS pair_status,
        p.documents_ready_at, u.email, u.password, pr.name AS property_name,
        pr.location AS property_location
      FROM legal_documents d
      JOIN legal_document_pairs p ON p.id = d.pair_id
      JOIN users u ON u.id = p.user_id
      JOIN properties pr ON pr.id = p.property_id
      WHERE d.id = ${initial.document_id} AND p.id = ${initial.pair_id}
      FOR UPDATE OF d
    `))[0];
    if (!document) throw new LocalSigningError("Local signing document not found.", 404);
    const operation = resultRows<SigningOperation>(await tx.execute(sql`
      SELECT * FROM local_legal_signing_operations WHERE id = ${operationId} FOR UPDATE
    `))[0];
    if (!operation) throw new LocalSigningError("Local signing operation not found.", 404);
    if (operation.status === "completed") return { state: "completed", operation };
    if (operation.status === "draft") return null;
    if (operation.status === "signing" && operation.lease_until) {
      const leaseUntil = parseDate(operation.lease_until, "Operation lease");
      if (leaseUntil.getTime() > dependencies.now().getTime()) {
        return { state: "busy", operation };
      }
    }
    const token = dependencies.randomUUID();
    if (!UUID_PATTERN.test(token)) throw new Error("Local-signing lease token generator returned an invalid UUID.");
    const leaseUntil = new Date(dependencies.now().getTime() + LOCAL_SIGNING_OPERATION_LEASE_MS);
    const claimed = resultRows<SigningOperation>(await tx.execute(sql`
      UPDATE local_legal_signing_operations
      SET status = 'signing',
          lease_token = ${token}::uuid,
          lease_until = ${leaseUntil},
          last_error = NULL,
          updated_at = now()
      WHERE id = ${operationId}
        AND status IN ('accepted', 'signing')
        AND (lease_until IS NULL OR lease_until <= now() OR lease_token IS NULL)
      RETURNING *
    `))[0];
    if (!claimed) return { state: "busy", operation };
    return { operation: claimed, document, pair, token };
  });
}

async function runOperation(
  dependencies: LocalSigningDependencies,
  operationId: number,
): Promise<CompleteLocalSigningResult | null> {
  const claimed = await claimOperation(dependencies, operationId);
  if (!claimed) return null;
  if ("state" in claimed) {
    return claimed.state === "completed"
      ? resultFromOperation(Number(claimed.operation.document_id), claimed.operation)
      : {
          status: "processing",
          documentId: Number(claimed.operation.document_id),
          operationId: Number(claimed.operation.id),
        };
  }
  try {
    return await completeClaimedOperation(dependencies, claimed);
  } catch (error) {
    await releaseOperationLease(dependencies, operationId, claimed.token, error);
    throw error;
  }
}

export async function completeLocalSigning(
  documentIdValue: number,
  userIdValue: number,
  bodyValue: unknown,
  actorEvidence: LocalSigningActorEvidence = {},
  overrides: Partial<LocalSigningDependencies> = {},
): Promise<CompleteLocalSigningResult> {
  validateRequestSize(bodyValue);
  const body = bodyValue && typeof bodyValue === "object" && !Array.isArray(bodyValue)
    ? bodyValue as Record<string, any>
    : {};
  const documentId = positiveInteger(documentIdValue, "Document ID");
  const userId = positiveInteger(userIdValue, "Investor ID");
  const dependencies = makeDependencies(overrides);
  const reserved = await reserveReauthAttempt(dependencies, documentId, userId, body);
  if (reserved.state === "completed" || reserved.state === "pending") return reserved.result;

  let passwordMatches = false;
  try {
    passwordMatches = await dependencies.comparePasswords(body.password, reserved.passwordHash);
  } catch {
    passwordMatches = false;
  }
  if (!passwordMatches) {
    const result = await finishAuthAttempt(dependencies, {
      userId,
      pairId: reserved.pairId,
      documentId,
      operationId: reserved.operationId,
      attemptId: reserved.attemptId,
      result: "failed",
    });
    if (result.locked) throw new LocalSigningError(retryAfterMessage(result.retryAt), 429);
    throw new LocalSigningError("The current password could not be verified.", 401);
  }

  const signature = validateSignaturePngData(body.signaturePng);
  let operation: SigningOperation;
  try {
    operation = await acceptSignature(dependencies, {
      documentId,
      userId,
      operationId: reserved.operationId,
      attemptId: reserved.attemptId,
      signaturePng: signature.bytes,
      signatureSha256: signature.sha256,
      signatureMethod: reserved.signatureMethod,
      typedName: body.typedName,
      evidence: actorEvidence,
    });
  } catch (error) {
    await finishAuthAttempt(dependencies, {
      userId,
      pairId: reserved.pairId,
      documentId,
      operationId: reserved.operationId,
      attemptId: reserved.attemptId,
      result: "challenge_expired",
    });
    throw error;
  }
  if (operation.status === "completed") return resultFromOperation(documentId, operation);
  if (operation.status === "draft") {
    await finishAuthAttempt(dependencies, {
      userId,
      pairId: reserved.pairId,
      documentId,
      operationId: reserved.operationId,
      attemptId: reserved.attemptId,
      result: "challenge_expired",
    });
    throw new LocalSigningError("The signing operation was not accepted. Start a new review session.", 409);
  }

  await finishAuthAttempt(dependencies, {
    userId,
    pairId: reserved.pairId,
    documentId,
    operationId: reserved.operationId,
    attemptId: reserved.attemptId,
    result: "succeeded",
  });
  const completed = await runOperation(dependencies, reserved.operationId);
  return completed || {
    status: "processing",
    documentId,
    operationId: reserved.operationId,
  };
}

/**
 * Reconcile accepted operations from the legal-job outbox. A persisted
 * acceptance is never replaced; leases and deterministic record keys make a
 * retry recover exactly the same two PDF objects.
 */
export async function reconcileLocalPairSigning(
  pairIdValue: number,
  overrides: Partial<LocalSigningDependencies> = {},
): Promise<ReconcileLocalSigningResult> {
  const pairId = positiveInteger(pairIdValue, "Legal pair ID");
  const dependencies = makeDependencies(overrides);
  const operations = resultRows<{ id: number; status: string }>(await dependencies.db.execute(sql`
    SELECT id, status FROM local_legal_signing_operations
    WHERE pair_id = ${pairId} AND status IN ('accepted', 'signing')
    ORDER BY id
  `));
  let completed = 0;
  for (const operation of operations) {
    const result = await runOperation(dependencies, Number(operation.id));
    if (result?.status === "investor_signed") completed += 1;
  }
  const remaining = resultRows<{ count: number | string }>(await dependencies.db.execute(sql`
    SELECT COUNT(*)::integer AS count
    FROM local_legal_signing_operations
    WHERE pair_id = ${pairId} AND status IN ('accepted', 'signing')
  `))[0]?.count;
  return { pending: Number(remaining || 0) > 0, completed };
}