import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import type { LegalDocumentType } from "./templates";
import { assertActiveConfirmedHolding } from "./holding-state";
import { hasOutstandingLegalSignature } from "./invitation-state";

export type LegalApprovalSource =
  | "payment_submission"
  | "admin_full_confirmation"
  | "admin_reinstate"
  | "historical_rollout";

export type LegalJobKind = "generation" | "notify" | "reconcile";

export type LegalTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type LegalSchemaExecutor = Pick<LegalTransaction, "execute">;

export interface EnqueueLegalApprovalInput {
  reservationId: number;
  source: LegalApprovalSource;
  sourceId: number;
  adminId: number;
  approvalNote?: string;
  /** Required for audited manual confirmation/reinstatement. Never used as a
   * document value; it must exactly agree with the locked reservation record. */
  confirmedFullPayment?: boolean;
  assertedAmountNaira?: string;
  assertedCurrency?: string;
  historicalEvidence?: Record<string, unknown>;
}

export interface EnqueueLegalApprovalResult {
  eligible: boolean;
  pairId?: number;
  duplicate?: boolean;
  status?: string;
  reason?: string;
}

export interface LegalPropertyBinding {
  propertyId: number;
  documentScope: "SD118";
  enabled: boolean;
  squareMetersPerUnit: string;
  note: string;
  boundByAdminId: number;
  boundAt: Date;
}

export interface LegalPairWithDocuments {
  pair: Record<string, unknown>;
  documents: Record<string, unknown>[];
}

export interface LegalJobClaim {
  id: number;
  pairId: number;
  kind: LegalJobKind;
  leaseToken: string;
  attempts: number;
  notificationCycleId?: number | null;
}

export interface LegalPinnedTemplate {
  id: number;
  propertyId?: number | null;
  documentType: LegalDocumentType;
  version: number;
  storageKey: string;
  sha256: string;
}

export interface LegalNotificationRecipient {
  email: string;
  propertyName: string;
}

export type LegalNotificationAttemptStart =
  | { state: "send"; attempt: number }
  | { state: "already_sent" }
  | { state: "uncertain" }
  | { state: "exhausted" };

export type LegalNotificationResendResult = {
  state: "queued" | "in_progress" | "cooldown" | "blocked_uncertain";
  queued: boolean;
  coalesced: boolean;
  cycleId: number;
  cycleNumber: number;
  message: string;
};

function resultRows<T>(result: unknown): T[] {
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

async function hasLegalApprovalSchema(executor: LegalSchemaExecutor): Promise<boolean> {
  const installed = resultRows<{ installed: boolean }>(await executor.execute(sql`
    SELECT
      to_regclass('legal_document_pairs') IS NOT NULL
      AND to_regclass('legal_templates') IS NOT NULL
      AND to_regclass('legal_documents') IS NOT NULL
      AND to_regclass('legal_jobs') IS NOT NULL
      AND to_regclass('legal_audit_events') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'legal_templates' AND column_name = 'property_id'
      ) AS installed
  `))[0]?.installed;
  return installed === true;
}

function requireLegalObjectKey(key: string, field: string): void {
  const segments = key.split("/");
  if (
    !key.startsWith("legal/") ||
    key.length > 1024 ||
    key.includes("\\") ||
    key.includes("\0") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${field} must be a normalized private legal/ object key`);
  }
}

function requireSha256(hash: string, field: string): void {
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error(`${field} must be a SHA-256 hex digest`);
  }
}

/**
 * Exact-ID administrative binding. SD118 is represented by the property ID
 * chosen by an authorized admin; no fuzzy property-name matching is done here.
 * This task's confirmed land mapping is exactly 5 sqm per purchased unit.
 */
export async function bindLegalProperty(
  executor: LegalTransaction | typeof db,
  input: { propertyId: number; adminId: number; note: string; squareMetersPerUnit: number },
): Promise<LegalPropertyBinding> {
  if (executor === db) {
    return db.transaction((tx) => bindLegalProperty(tx, input));
  }
  if (!Number.isInteger(input.propertyId) || input.propertyId < 1) {
    throw new Error("A valid exact property ID is required");
  }
  if (input.squareMetersPerUnit !== 5) {
    throw new Error("LilyCrest Garden Estate legal documents require the confirmed 5 sqm per-unit mapping");
  }
  const note = input.note.trim();
  if (note.length < 8) {
    throw new Error("An audit note explaining the LilyCrest Garden Estate property binding is required");
  }
  const previousBindings = resultRows<{ propertyId: number }>(await executor.execute(sql`
    UPDATE legal_property_bindings
    SET enabled = false, updated_at = now()
    WHERE document_scope = 'SD118' AND enabled = true AND property_id <> ${input.propertyId}
    RETURNING property_id AS "propertyId"
  `));
  for (const previous of previousBindings) {
    await executor.execute(sql`
      INSERT INTO legal_audit_events (actor_type, actor_id, event_type, details)
      VALUES ('admin', ${input.adminId}, 'sd118_property_binding_disabled',
        ${JSON.stringify({
          propertyId: previous.propertyId,
          replacementPropertyId: input.propertyId,
          note,
        })}::jsonb)
    `);
  }
  const result = await executor.execute(sql`
    INSERT INTO legal_property_bindings
      (property_id, document_scope, enabled, square_meters_per_unit, note, bound_by_admin_id, bound_at, updated_at)
    SELECT p.id, 'SD118', true, 5, ${note}, ${input.adminId}, now(), now()
    FROM properties p
    WHERE p.id = ${input.propertyId}
    ON CONFLICT (property_id) DO UPDATE SET
      document_scope = EXCLUDED.document_scope,
      enabled = true,
      square_meters_per_unit = EXCLUDED.square_meters_per_unit,
      note = EXCLUDED.note,
      bound_by_admin_id = EXCLUDED.bound_by_admin_id,
      bound_at = EXCLUDED.bound_at,
      updated_at = EXCLUDED.updated_at
    RETURNING property_id AS "propertyId", document_scope AS "documentScope", enabled,
      square_meters_per_unit::text AS "squareMetersPerUnit",
      note, bound_by_admin_id AS "boundByAdminId", bound_at AS "boundAt"
  `);
  const [binding] = resultRows<LegalPropertyBinding>(result);
  if (!binding) throw new Error("Property not found; legal property binding was not saved");
  await executor.execute(sql`
    INSERT INTO legal_audit_events (actor_type, actor_id, event_type, details)
    VALUES ('admin', ${input.adminId}, 'sd118_property_binding_updated',
      ${JSON.stringify({
        propertyId: binding.propertyId,
        documentScope: binding.documentScope,
        squareMetersPerUnit: binding.squareMetersPerUnit,
        note,
      })}::jsonb)
  `);
  return binding;
}

export async function getLegalPropertyBinding(
  propertyId: number,
  executor: LegalTransaction | typeof db = db,
): Promise<LegalPropertyBinding | undefined> {
  const result = await executor.execute(sql`
    SELECT property_id AS "propertyId", document_scope AS "documentScope", enabled,
      square_meters_per_unit::text AS "squareMetersPerUnit",
      note, bound_by_admin_id AS "boundByAdminId", bound_at AS "boundAt"
    FROM legal_property_bindings
    WHERE property_id = ${propertyId}
  `);
  return resultRows<LegalPropertyBinding>(result)[0];
}

export async function recordLegalApprovalBlock(
  tx: LegalTransaction,
  input: {
    reservationId: number;
    adminId: number;
    source: LegalApprovalSource;
    sourceId: number;
    reason: string;
    details?: Record<string, unknown>;
  },
): Promise<"recorded" | "not_applicable" | "workflow_schema_not_installed"> {
  if (!(await hasLegalApprovalSchema(tx))) return "workflow_schema_not_installed";
  const holding = resultRows<{ propertyId: number }>(await tx.execute(sql`
    SELECT property_id AS "propertyId"
    FROM investment_reservations
    WHERE id = ${input.reservationId}
  `))[0];
  if (!holding) return "not_applicable";
  await tx.execute(sql`
    INSERT INTO legal_audit_events
      (reservation_id, actor_type, actor_id, event_type, details)
    VALUES (
      ${input.reservationId}, 'admin', ${input.adminId}, 'legal_approval_blocked',
      ${JSON.stringify({
        source: input.source,
        sourceId: input.sourceId,
        reason: input.reason,
        ...input.details,
      })}::jsonb
    )
  `);
  return "recorded";
}

/**
 * Call only inside the same transaction as the authoritative approval state
 * transition. Locks the investment holding, checks
 * approved payment/KYC facts, snapshots them, pins active template IDs, and
 * places a unique durable generation job in the transactional outbox.
 */
export async function enqueueLegalApproval(
  tx: LegalTransaction,
  input: EnqueueLegalApprovalInput,
): Promise<EnqueueLegalApprovalResult> {
  if (!(await hasLegalApprovalSchema(tx))) {
    return { eligible: false, reason: "workflow_schema_not_installed" };
  }
  const sourceValid = input.source === "payment_submission"
    ? Number.isInteger(input.sourceId) && input.sourceId > 0
    : input.sourceId === input.reservationId;
  if (!sourceValid) {
    throw new Error("Legal approval provenance does not match the reservation");
  }

  const already = resultRows<{ id: number; status: string }>(await tx.execute(sql`
    SELECT id, status FROM legal_document_pairs WHERE reservation_id = ${input.reservationId}
  `))[0];
  if (already) {
    return { eligible: true, duplicate: true, pairId: already.id, status: already.status };
  }

  const approvalNote = input.approvalNote?.trim() ?? "";
  if (input.source !== "payment_submission") {
    if (!input.confirmedFullPayment || !approvalNote) {
      return { eligible: false, reason: "explicit_full_payment_attestation_required" };
    }
    if (input.assertedCurrency !== "NGN" || !input.assertedAmountNaira) {
      return { eligible: false, reason: "explicit_NGN_amount_required" };
    }
  }

  const sourceId = input.sourceId;
  const rowResult = await tx.execute(sql`
    SELECT
      r.id AS "reservationId",
      r.user_id AS "userId",
      r.property_id AS "propertyId",
      r.units::numeric::text AS units,
      r.amount::numeric::text AS "reservationAmount",
      round(r.units::numeric * 5, 2)::text AS "areaSqm",
      r.currency AS "reservationCurrency",
      r.status AS "reservationStatus",
      u.kyc_status AS "kycStatus",
      NULLIF(trim(u.kyc_full_name), '') AS "verifiedFullName",
      NULLIF(trim(u.kyc_address), '') AS "verifiedHomeAddress",
      p.name AS "propertyName",
      p.location AS "propertyLocation",
      '5'::text AS "squareMetersPerUnit",
      ps.id AS "paymentSubmissionId",
      ps.amount::numeric::text AS "paymentSubmissionAmount",
      ps.currency AS "paymentSubmissionCurrency",
      ps.status AS "paymentSubmissionStatus"
    FROM investment_reservations r
    JOIN users u ON u.id = r.user_id
    JOIN properties p ON p.id = r.property_id
    LEFT JOIN payment_submissions ps
      ON ps.id = ${input.source === "payment_submission" ? sourceId : null}
      AND ps.reservation_id = r.id
      AND ps.user_id = r.user_id
      AND ps.status = 'approved'
    WHERE r.id = ${input.reservationId}
    FOR UPDATE OF r
  `);
  const purchase = resultRows<Record<string, any>>(rowResult)[0];
  if (!purchase) {
    return { eligible: false, reason: "holding_missing" };
  }
  if (
    purchase.reservationStatus !== "converted_to_investment" ||
    purchase.kycStatus !== "approved" ||
    !purchase.verifiedFullName ||
    !purchase.verifiedHomeAddress
  ) {
    return { eligible: false, reason: "approved_KYC_and_confirmed_holding_required" };
  }

  let paymentAmountNaira = purchase.reservationAmount;
  if (input.source === "payment_submission") {
    if (
      Number(purchase.paymentSubmissionId) !== sourceId ||
      purchase.paymentSubmissionStatus !== "approved" ||
      purchase.paymentSubmissionCurrency !== "NGN" ||
      purchase.reservationCurrency !== "NGN" ||
      String(purchase.paymentSubmissionAmount) !== String(purchase.reservationAmount)
    ) {
      return { eligible: false, reason: "approved_submission_must_settle_full_NGN_purchase" };
    }
    paymentAmountNaira = purchase.paymentSubmissionAmount;
  } else {
    if (
      purchase.reservationCurrency !== "NGN" ||
      input.assertedCurrency !== "NGN" ||
      !/^\d+(?:\.\d{1,2})?$/.test(input.assertedAmountNaira ?? "")
    ) {
      return { eligible: false, reason: "manual_confirmation_must_be_full_NGN_payment" };
    }
    const amountMatch = resultRows<{ matches: boolean }>(await tx.execute(sql`
      SELECT (${input.assertedAmountNaira}::numeric = ${purchase.reservationAmount}::numeric) AS matches
    `))[0]?.matches;
    if (!amountMatch) {
      return { eligible: false, reason: "attested_amount_does_not_match_purchase_total" };
    }
  }

  const activeTemplateResult = await tx.execute(sql`
    SELECT id, document_type AS "documentType", version
    FROM legal_templates
    WHERE is_active = true AND validation_status = 'valid' AND deleted_at IS NULL
      AND property_id = ${purchase.propertyId}
      AND document_type IN ('deed_of_assignment', 'transfer_exit_rights')
    ORDER BY document_type
    FOR SHARE
  `);
  const activeTemplates = resultRows<{ id: number; documentType: string; version: number }>(activeTemplateResult);
  let deedTemplate = activeTemplates.find((template) => template.documentType === "deed_of_assignment");
  let transferTemplate = activeTemplates.find((template) => template.documentType === "transfer_exit_rights");
  const templatesReady = !!deedTemplate && !!transferTemplate;
  // New approvals pin an entire pair atomically. The database requires both
  // pins or neither; an incomplete property setup must remain recoverable.
  if (!templatesReady) {
    deedTemplate = undefined;
    transferTemplate = undefined;
  }
  const units = Number(purchase.units);
  const areaSqm = Number(purchase.areaSqm);
  const sqmPerUnit = Number(purchase.squareMetersPerUnit);
  if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(areaSqm) || areaSqm <= 0) {
    return { eligible: false, reason: "invalid_purchase_area" };
  }

  const now = new Date();
  const frozenData = {
    userFullName: purchase.verifiedFullName,
    userHomeAddress: purchase.verifiedHomeAddress,
    propertyName: purchase.propertyName,
    propertyLocation: purchase.propertyLocation,
    reservationId: input.reservationId,
    propertyId: Number(purchase.propertyId),
    units: purchase.units,
    squareMetersPerUnit: purchase.squareMetersPerUnit,
    propertyAreaSqm: purchase.areaSqm,
    paymentAmountNaira,
    paymentCurrency: "NGN",
    approvalSource: input.source,
    approvalSourceId: input.sourceId,
    approvedByAdminId: input.adminId,
    effectiveAt: now.toISOString(),
    deedTemplateId: deedTemplate?.id ?? null,
    transferTemplateId: transferTemplate?.id ?? null,
    ...(input.source === "historical_rollout" ? { historicalEvidence: input.historicalEvidence, preparedAt: now.toISOString(), priorPaymentApprovalFabricated: false } : {}),
  };
  const insertResult = await tx.execute(sql`
    INSERT INTO legal_document_pairs (
      reservation_id, user_id, property_id, payment_submission_id,
      approval_source, approval_source_id, approved_by_admin_id, approved_at,
      effective_at, approval_note, full_name_snapshot, home_address_snapshot,
      property_area_sqm, units_snapshot, square_meters_per_unit,
      payment_amount_naira, payment_currency, deed_template_id, transfer_template_id,
      data_snapshot, status
    ) VALUES (
      ${input.reservationId}, ${Number(purchase.userId)}, ${Number(purchase.propertyId)},
      ${input.source === "payment_submission" ? sourceId : null},
      ${input.source}, ${input.sourceId}, ${input.adminId}, ${now},
      ${now}, ${input.source === "payment_submission" ? `Approved payment submission #${sourceId}` : approvalNote},
      ${purchase.verifiedFullName}, ${purchase.verifiedHomeAddress},
      ${purchase.areaSqm}, ${purchase.units}, ${purchase.squareMetersPerUnit},
      ${paymentAmountNaira}, 'NGN', ${deedTemplate?.id ?? null}, ${transferTemplate?.id ?? null},
      ${JSON.stringify(frozenData)}::jsonb, ${templatesReady ? "queued" : "awaiting_templates"}
    )
    ON CONFLICT (reservation_id) DO NOTHING
    RETURNING id, status
  `);
  const [pair] = resultRows<{ id: number; status: string }>(insertResult);
  if (!pair) {
    const concurrent = resultRows<{ id: number; status: string }>(await tx.execute(sql`
      SELECT id, status FROM legal_document_pairs WHERE reservation_id = ${input.reservationId}
    `))[0];
    return concurrent
      ? { eligible: true, duplicate: true, pairId: concurrent.id, status: concurrent.status }
      : { eligible: false, reason: "legal_pair_insert_conflict" };
  }

  if (deedTemplate && transferTemplate) {
    await tx.execute(sql`
      INSERT INTO legal_documents (pair_id, document_type, template_id)
      VALUES
        (${pair.id}, 'deed_of_assignment', ${deedTemplate.id}),
        (${pair.id}, 'transfer_exit_rights', ${transferTemplate.id})
      ON CONFLICT (pair_id, document_type) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO legal_jobs (pair_id, kind, status)
      VALUES (${pair.id}, 'generation', 'queued')
      ON CONFLICT (pair_id, kind) DO NOTHING
    `);
  } else {
    await tx.execute(sql`
      INSERT INTO legal_jobs (pair_id, kind, status, last_error)
      VALUES (${pair.id}, 'generation', 'blocked', 'Both valid active legal templates are required')
      ON CONFLICT (pair_id, kind) DO NOTHING
    `);
  }
  await tx.execute(sql`
    INSERT INTO legal_audit_events
      (pair_id, reservation_id, actor_type, actor_id, event_type, details)
    VALUES (
      ${pair.id}, ${input.reservationId}, 'admin', ${input.adminId},
      ${input.source === "historical_rollout" ? "historical_rollout_generation_queued" : templatesReady ? "approval_generation_queued" : "approval_blocked_templates_missing"},
      ${JSON.stringify({
        source: input.source,
        sourceId: input.sourceId,
        paymentAmountNaira,
        currency: "NGN",
        sqmPerUnit,
        areaSqm: purchase.areaSqm,
        deedTemplateId: deedTemplate?.id ?? null,
        transferTemplateId: transferTemplate?.id ?? null,
        ...(input.source === "historical_rollout" ? { historicalEvidence: input.historicalEvidence, auditNote: approvalNote } : {}),
      })}::jsonb
    )
  `);
  return {
    eligible: true,
    pairId: pair.id,
    status: pair.status,
    reason: templatesReady ? undefined : "active_templates_missing",
  };
}

export async function pinActiveTemplatesAndQueue(
  pairId: number,
  adminId: number,
  executor: LegalTransaction | typeof db = db,
): Promise<boolean> {
  const existing = resultRows<Record<string, any>>(await executor.execute(sql`
    SELECT id, reservation_id AS "reservationId", deed_template_id AS "deedTemplateId",
      transfer_template_id AS "transferTemplateId", property_id AS "propertyId", status
    FROM legal_document_pairs WHERE id = ${pairId} FOR UPDATE
  `))[0];
  if (!existing) return false;
  if (existing.deedTemplateId && existing.transferTemplateId) {
    const requeued = resultRows<{ id: number }>(await executor.execute(sql`
      UPDATE legal_jobs
      SET status = 'queued', attempts = 0, available_at = now(),
          last_error = NULL, updated_at = now()
      WHERE pair_id = ${pairId} AND kind = 'generation' AND status = 'dead'
      RETURNING id
    `))[0];
    if (requeued) {
      await executor.execute(sql`
        UPDATE legal_document_pairs
        SET status = 'queued', last_error = NULL
        WHERE id = ${pairId} AND status = 'failed'
      `);
      await executor.execute(sql`
        INSERT INTO legal_audit_events
          (pair_id, reservation_id, actor_type, actor_id, event_type, details)
        VALUES (${pairId}, ${existing.reservationId}, 'admin', ${adminId},
          'generation_job_requeued', ${JSON.stringify({ jobId: requeued.id })}::jsonb)
      `);
    }
    return true;
  }
  const templates = resultRows<{ id: number; documentType: string }>(await executor.execute(sql`
    SELECT id, document_type AS "documentType"
    FROM legal_templates
    WHERE is_active = true AND validation_status = 'valid' AND deleted_at IS NULL
      AND property_id = ${existing.propertyId}
      AND document_type IN ('deed_of_assignment', 'transfer_exit_rights')
    FOR SHARE
  `));
  // A partial historical pin is immutable too; fill only the missing side.
  const deedTemplate = existing.deedTemplateId
    ? { id: existing.deedTemplateId }
    : templates.find((template) => template.documentType === "deed_of_assignment");
  const transferTemplate = existing.transferTemplateId
    ? { id: existing.transferTemplateId }
    : templates.find((template) => template.documentType === "transfer_exit_rights");
  if (!deedTemplate || !transferTemplate) return false;

  await executor.execute(sql`
    UPDATE legal_document_pairs
    SET deed_template_id = COALESCE(deed_template_id, ${deedTemplate.id}),
        transfer_template_id = COALESCE(transfer_template_id, ${transferTemplate.id}),
        status = 'queued', last_error = NULL
    WHERE id = ${pairId}
  `);
  await executor.execute(sql`
    INSERT INTO legal_documents (pair_id, document_type, template_id)
    VALUES
      (${pairId}, 'deed_of_assignment', ${deedTemplate.id}),
      (${pairId}, 'transfer_exit_rights', ${transferTemplate.id})
    ON CONFLICT (pair_id, document_type) DO NOTHING
  `);
  await executor.execute(sql`
    UPDATE legal_jobs SET status = 'queued',
      attempts = CASE WHEN status = 'dead' THEN 0 ELSE attempts END,
      available_at = now(),
      last_error = NULL, updated_at = now()
    WHERE pair_id = ${pairId} AND kind = 'generation' AND status IN ('blocked', 'dead')
  `);
  await executor.execute(sql`
    INSERT INTO legal_audit_events
      (pair_id, reservation_id, actor_type, actor_id, event_type, details)
    VALUES (${pairId}, ${existing.reservationId}, 'admin', ${adminId},
      'active_templates_pinned', ${JSON.stringify({
        deedTemplateId: deedTemplate.id,
        transferTemplateId: transferTemplate.id,
      })}::jsonb)
  `);
  return true;
}

export async function getPairWithDocuments(pairId: number): Promise<LegalPairWithDocuments | undefined> {
  const pairResult = await db.execute(sql`
    SELECT * FROM legal_document_pairs WHERE id = ${pairId}
  `);
  const pair = resultRows<Record<string, unknown>>(pairResult)[0];
  if (!pair) return undefined;
  const documentsResult = await db.execute(sql`
    SELECT * FROM legal_documents WHERE pair_id = ${pairId} ORDER BY document_type
  `);
  return { pair, documents: resultRows<Record<string, unknown>>(documentsResult) };
}

export async function getPinnedLegalTemplate(
  templateId: number,
): Promise<LegalPinnedTemplate | undefined> {
  if (!Number.isSafeInteger(templateId) || templateId < 1) return undefined;
  const result = await db.execute(sql`
    SELECT id, property_id AS "propertyId", document_type AS "documentType", version,
      storage_key AS "storageKey", sha256
    FROM legal_templates
    WHERE id = ${templateId} AND deleted_at IS NULL
  `);
  return resultRows<LegalPinnedTemplate>(result)[0];
}

export async function getLegalNotificationRecipient(
  pairId: number,
): Promise<LegalNotificationRecipient | undefined> {
  if (!Number.isSafeInteger(pairId) || pairId < 1) return undefined;
  const result = await db.execute(sql`
    SELECT u.email, pr.name AS "propertyName"
    FROM legal_document_pairs p
    JOIN users u ON u.id = p.user_id
    JOIN properties pr ON pr.id = p.property_id
    WHERE p.id = ${pairId}
  `);
  return resultRows<LegalNotificationRecipient>(result)[0];
}

function requireNotificationLease(
  job: { kind: string; status: string; leaseToken: string | null; leaseLive: boolean } | undefined,
  leaseToken: string,
): asserts job is { kind: string; status: string; leaseToken: string; leaseLive: true } {
  if (
    !job ||
    job.kind !== "notify" ||
    job.status !== "leased" ||
    job.leaseToken !== leaseToken ||
    !job.leaseLive
  ) {
    throw new Error("Legal notification job lease is stale or no longer owned by this worker");
  }
}

async function recordLegalNotificationEvent(
  tx: LegalTransaction,
  pairId: number,
  actorType: string,
  eventType: string,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO legal_audit_events (pair_id, actor_type, event_type, details)
    VALUES (${pairId}, ${actorType}, ${eventType}, ${JSON.stringify(details)}::jsonb)
  `);
}

async function recordAdminNotificationEvent(
  tx: LegalTransaction,
  pairId: number,
  adminId: number,
  eventType: string,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO legal_audit_events (pair_id, actor_type, actor_id, event_type, details)
    VALUES (${pairId}, 'admin', ${adminId}, ${eventType}, ${JSON.stringify(details)}::jsonb)
  `);
}

function notificationCycleAuditFilter(
  jobId: number,
  cycleId: number,
  cycleNumber: number,
) {
  if (cycleNumber === 1) {
    return sql`(
      details->>'notificationCycleId' = ${String(cycleId)}
      OR (
        details->>'notificationCycleId' IS NULL
        AND details->>'jobId' = ${String(jobId)}
      )
    )`;
  }
  return sql`details->>'notificationCycleId' = ${String(cycleId)}`;
}

/**
 * Explicit resend starts a new immutable notification cycle only after the
 * previous cycle is terminal. The caller holds the pair row lock and invokes
 * this in that same transaction, so parallel admin clicks coalesce instead
 * of resetting a worker lease or an ambiguous SMTP send.
 */
export async function requestLegalNotificationResend(
  tx: LegalTransaction,
  pairId: number,
  adminId: number,
): Promise<LegalNotificationResendResult> {
  const pair = resultRows<{ documentsReadyAt: Date | string | null }>(await tx.execute(sql`
    SELECT documents_ready_at AS "documentsReadyAt"
    FROM legal_document_pairs
    WHERE id = ${pairId}
    FOR UPDATE
  `))[0];
  if (!pair) throw new Error("Legal document pair not found");
  if (!pair.documentsReadyAt) throw new Error("Both unsigned PDFs must be ready before notification");
  if (!await hasOutstandingLegalSignature(tx, pairId)) throw new Error("Both documents are already investor-signed. No signing invitation was queued.");

  const job = resultRows<{
    id: number;
    status: string;
    notificationCycleId: number | null;
  }>(await tx.execute(sql`
    SELECT id, status, notification_cycle_id AS "notificationCycleId"
    FROM legal_jobs
    WHERE pair_id = ${pairId} AND kind = 'notify'
    FOR UPDATE
  `))[0];
  if (!job?.notificationCycleId) {
    const error = new Error("Legal notification cycle setup is required before requesting a resend.");
    (error as Error & { statusCode?: number }).statusCode = 503;
    throw error;
  }

  const cycle = resultRows<{
    id: number;
    cycleNumber: number;
    status: string;
    withinCooldown: boolean;
  }>(await tx.execute(sql`
    SELECT id, cycle_number AS "cycleNumber", status,
      updated_at > now() - interval '1 minute' AS "withinCooldown"
    FROM legal_notification_cycles
    WHERE id = ${job.notificationCycleId} AND pair_id = ${pairId}
    FOR UPDATE
  `))[0];
  if (!cycle) {
    const error = new Error("The active legal notification cycle is missing; apply the notification-cycle migration.");
    (error as Error & { statusCode?: number }).statusCode = 503;
    throw error;
  }

  if (cycle.status === "uncertain") {
    await recordAdminNotificationEvent(tx, pairId, adminId, "notification_resend_blocked_uncertain", {
      jobId: job.id,
      notificationCycleId: cycle.id,
      cycleNumber: cycle.cycleNumber,
      reason: "manual_delivery_reconciliation_required",
    });
    return {
      state: "blocked_uncertain",
      queued: false,
      coalesced: true,
      cycleId: cycle.id,
      cycleNumber: cycle.cycleNumber,
      message: "Delivery status is uncertain. No resend was queued; reconcile the prior email delivery before requesting another send.",
    };
  }

  if (job.status === "leased") {
    await recordAdminNotificationEvent(tx, pairId, adminId, "notification_resend_coalesced", {
      jobId: job.id,
      notificationCycleId: cycle.id,
      cycleNumber: cycle.cycleNumber,
      reason: "notification_worker_lease_active",
    });
    return {
      state: "in_progress",
      queued: false,
      coalesced: true,
      cycleId: cycle.id,
      cycleNumber: cycle.cycleNumber,
      message: "A notification worker is already processing this cycle. No additional cycle was queued.",
    };
  }

  if (job.status === "queued" || job.status === "retry") {
    await recordAdminNotificationEvent(tx, pairId, adminId, "notification_resend_coalesced", {
      jobId: job.id,
      notificationCycleId: cycle.id,
      cycleNumber: cycle.cycleNumber,
      reason: "notification_job_already_queued",
    });
    return {
      state: "queued",
      queued: true,
      coalesced: true,
      cycleId: cycle.id,
      cycleNumber: cycle.cycleNumber,
      message: "A notification is already queued for this cycle; no duplicate cycle was created.",
    };
  }

  const terminalCycle = ["sent", "failed", "exhausted"].includes(cycle.status);
  const terminalJob = ["complete", "dead", "blocked"].includes(job.status);
  if (!terminalCycle || !terminalJob) {
    const error = new Error("The legal notification cycle is not in a safely resendable state.");
    (error as Error & { statusCode?: number }).statusCode = 409;
    throw error;
  }
  if (cycle.withinCooldown) {
    await recordAdminNotificationEvent(tx, pairId, adminId, "notification_resend_coalesced", {
      jobId: job.id,
      notificationCycleId: cycle.id,
      cycleNumber: cycle.cycleNumber,
      reason: "notification_resend_cooldown",
    });
    return {
      state: "cooldown",
      queued: false,
      coalesced: true,
      cycleId: cycle.id,
      cycleNumber: cycle.cycleNumber,
      message: "The prior notification cycle ended recently. No new cycle was queued; wait one minute before requesting another resend.",
    };
  }

  const nextCycle = resultRows<{ id: number; cycleNumber: number }>(await tx.execute(sql`
    INSERT INTO legal_notification_cycles
      (pair_id, cycle_number, request_kind, requested_by_admin_id, status)
    VALUES (${pairId}, ${Number(cycle.cycleNumber) + 1}, 'admin_resend', ${adminId}, 'queued')
    RETURNING id, cycle_number AS "cycleNumber"
  `))[0];
  if (!nextCycle) throw new Error("A new legal notification cycle could not be created");

  const queuedJob = resultRows<{ id: number }>(await tx.execute(sql`
    UPDATE legal_jobs
    SET notification_cycle_id = ${nextCycle.id},
        status = 'queued',
        attempts = 0,
        available_at = now(),
        lease_token = NULL,
        leased_until = NULL,
        completed_at = NULL,
        last_error = NULL,
        updated_at = now()
    WHERE id = ${job.id}
      AND kind = 'notify'
      AND status IN ('complete', 'dead', 'blocked')
    RETURNING id
  `))[0];
  if (!queuedJob) throw new Error("The legal notification job changed while a resend was being queued");

  await recordAdminNotificationEvent(tx, pairId, adminId, "notification_resend_requested", {
    jobId: job.id,
    notificationCycleId: nextCycle.id,
    cycleNumber: nextCycle.cycleNumber,
    previousNotificationCycleId: cycle.id,
    previousCycleStatus: cycle.status,
  });
  return {
    state: "queued",
    queued: true,
    coalesced: false,
    cycleId: nextCycle.id,
    cycleNumber: Number(nextCycle.cycleNumber),
    message: `A new notification cycle (#${nextCycle.cycleNumber}) was queued.`,
  };
}

/**
 * Persist an email-send intent before calling SMTP. If a worker dies while an
 * intent is unresolved, the next lease is quarantined rather than blindly
 * sending a duplicate message.
 */
export async function beginLegalNotificationAttempt(
  jobId: number,
  leaseToken: string,
): Promise<LegalNotificationAttemptStart> {
  const maxSendAttempts = 3;
  return db.transaction(async (tx) => {
    const initialJob = resultRows<{ pairId: number; kind: string }>(await tx.execute(sql`
      SELECT pair_id AS "pairId", kind
      FROM legal_jobs WHERE id = ${jobId}
    `))[0];
    if (!initialJob || initialJob.kind !== "notify") {
      throw new Error("Legal notification job was not found while starting a delivery attempt");
    }
    const reference = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT reservation_id, user_id, property_id
      FROM legal_document_pairs WHERE id = ${initialJob.pairId}
    `))[0];
    if (!reference) throw new Error("Legal document pair is missing for its notification job");
    const holdingIdentity = {
      reservationId: Number(reference.reservation_id),
      userId: Number(reference.user_id),
      propertyId: Number(reference.property_id),
    };
    await assertActiveConfirmedHolding(tx, holdingIdentity);

    const job = resultRows<{
      pairId: number;
      kind: string;
      status: string;
      leaseToken: string | null;
      leaseLive: boolean;
      notificationCycleId: number | null;
    }>(await tx.execute(sql`
      SELECT pair_id AS "pairId", kind, status, lease_token AS "leaseToken",
        leased_until > now() AS "leaseLive",
        notification_cycle_id AS "notificationCycleId"
      FROM legal_jobs WHERE id = ${jobId} FOR UPDATE
    `))[0];
    requireNotificationLease(job, leaseToken);
    if (Number(job.pairId) !== initialJob.pairId) {
      throw new Error("Legal notification job changed while starting a delivery attempt");
    }
    const pair = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT reservation_id, user_id, property_id
      FROM legal_document_pairs WHERE id = ${job.pairId}
      FOR UPDATE
    `))[0];
    if (
      !pair ||
      Number(pair.reservation_id) !== holdingIdentity.reservationId ||
      Number(pair.user_id) !== holdingIdentity.userId ||
      Number(pair.property_id) !== holdingIdentity.propertyId
    ) {
      throw new Error("Legal approval changed while starting a notification attempt");
    }
    if (!job.notificationCycleId) {
      throw new Error("Legal notification cycle setup is required before sending email.");
    }
    if (!await hasOutstandingLegalSignature(tx, job.pairId)) {
      await recordLegalNotificationEvent(tx, job.pairId, "system", "notification_suppressed_fully_investor_signed", { jobId });
      return { state: "already_sent" };
    }

    const cycle = resultRows<{ id: number; cycleNumber: number; status: string }>(await tx.execute(sql`
      SELECT id, cycle_number AS "cycleNumber", status
      FROM legal_notification_cycles
      WHERE id = ${job.notificationCycleId} AND pair_id = ${job.pairId}
      FOR UPDATE
    `))[0];
    if (!cycle) throw new Error("The active legal notification cycle is missing.");
    const eventFilter = notificationCycleAuditFilter(jobId, cycle.id, Number(cycle.cycleNumber));

    if (cycle.status === "sent") return { state: "already_sent" };
    if (cycle.status === "uncertain" || cycle.status === "exhausted") {
      await tx.execute(sql`
        UPDATE legal_jobs
        SET status = 'dead', lease_token = NULL, leased_until = NULL,
            last_error = ${cycle.status === "uncertain"
              ? "Email delivery status is uncertain; manual review required"
              : "Legal document email reached its bounded delivery attempts"},
            updated_at = now()
        WHERE id = ${jobId} AND status = 'leased' AND lease_token = ${leaseToken}
      `);
      return { state: cycle.status };
    }

    const events = resultRows<{ eventType: string; attempt: string | number | null }>(
      await tx.execute(sql`
        SELECT event_type AS "eventType", details->>'attempt' AS attempt
        FROM legal_audit_events
        WHERE pair_id = ${job.pairId}
          AND ${eventFilter}
          AND event_type IN (
            'legal_documents_ready_email_attempt_started',
            'legal_documents_ready_email_sent',
            'legal_documents_ready_email_failed'
          )
        ORDER BY id
      `),
    );
    if (events.some((event) => event.eventType === "legal_documents_ready_email_sent")) {
      await tx.execute(sql`
        UPDATE legal_notification_cycles
        SET status = 'sent', sent_at = COALESCE(sent_at, now()), updated_at = now()
        WHERE id = ${cycle.id}
      `);
      return { state: "already_sent" };
    }

    const starts = events.filter(
      (event) => event.eventType === "legal_documents_ready_email_attempt_started",
    );
    for (const started of starts) {
      const attempt = Number(started.attempt);
      const ended = events.some(
        (event) =>
          Number(event.attempt) === attempt &&
          event.eventType === "legal_documents_ready_email_failed",
      );
      if (!ended) {
        await tx.execute(sql`
          UPDATE legal_jobs
          SET status = 'dead', lease_token = NULL, leased_until = NULL,
              last_error = 'Email delivery status is uncertain; manual review required',
              updated_at = now()
          WHERE id = ${jobId} AND status = 'leased' AND lease_token = ${leaseToken}
        `);
        await tx.execute(sql`
          UPDATE legal_notification_cycles
          SET status = 'uncertain', updated_at = now()
          WHERE id = ${cycle.id}
        `);
        await recordLegalNotificationEvent(
          tx,
          job.pairId,
          "worker",
          "legal_documents_ready_email_delivery_uncertain",
          {
            jobId,
            notificationCycleId: cycle.id,
            cycleNumber: cycle.cycleNumber,
            attempt,
            reason: "prior_send_intent_has_no_terminal_result",
          },
        );
        return { state: "uncertain" };
      }
    }

    if (starts.length >= maxSendAttempts) {
      await tx.execute(sql`
        UPDATE legal_jobs
        SET status = 'dead', lease_token = NULL, leased_until = NULL,
            last_error = 'Legal document email reached its bounded delivery attempts',
            updated_at = now()
        WHERE id = ${jobId} AND status = 'leased' AND lease_token = ${leaseToken}
      `);
      await tx.execute(sql`
        UPDATE legal_notification_cycles
        SET status = 'exhausted', updated_at = now()
        WHERE id = ${cycle.id}
      `);
      await recordLegalNotificationEvent(
        tx,
        job.pairId,
        "worker",
        "legal_documents_ready_email_attempts_exhausted",
        {
          jobId,
          notificationCycleId: cycle.id,
          cycleNumber: cycle.cycleNumber,
          attempts: starts.length,
        },
      );
      return { state: "exhausted" };
    }

    const attempt = starts.length + 1;
    await tx.execute(sql`
      UPDATE legal_notification_cycles
      SET status = 'sending', attempt_count = ${attempt}, updated_at = now()
      WHERE id = ${cycle.id}
    `);
    await recordLegalNotificationEvent(
      tx,
      job.pairId,
      "worker",
      "legal_documents_ready_email_attempt_started",
      {
        jobId,
        notificationCycleId: cycle.id,
        cycleNumber: cycle.cycleNumber,
        attempt,
      },
    );
    return { state: "send", attempt };
  });
}

export async function recordLegalNotificationSent(
  jobId: number,
  leaseToken: string,
  attempt: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const job = resultRows<{
      pairId: number;
      kind: string;
      status: string;
      leaseToken: string | null;
      notificationCycleId: number | null;
    }>(await tx.execute(sql`
      SELECT pair_id AS "pairId", kind, status, lease_token AS "leaseToken",
        notification_cycle_id AS "notificationCycleId"
      FROM legal_jobs WHERE id = ${jobId} FOR UPDATE
    `))[0];
    if (!job || job.kind !== "notify" || !job.notificationCycleId) {
      throw new Error("Legal notification job was not found while recording delivery success");
    }
    const cycle = resultRows<{ id: number; cycleNumber: number }>(await tx.execute(sql`
      SELECT id, cycle_number AS "cycleNumber"
      FROM legal_notification_cycles
      WHERE id = ${job.notificationCycleId} AND pair_id = ${job.pairId}
      FOR UPDATE
    `))[0];
    if (!cycle) throw new Error("The active legal notification cycle is missing while recording success");
    const eventFilter = notificationCycleAuditFilter(jobId, cycle.id, Number(cycle.cycleNumber));
    const attemptEvents = resultRows<{ eventType: string }>(await tx.execute(sql`
      SELECT event_type AS "eventType"
      FROM legal_audit_events
      WHERE pair_id = ${job.pairId}
        AND ${eventFilter}
        AND details->>'attempt' = ${String(attempt)}
        AND event_type IN (
          'legal_documents_ready_email_attempt_started',
          'legal_documents_ready_email_sent',
          'legal_documents_ready_email_failed'
        )
    `));
    const eventTypes = attemptEvents.map((event) => event.eventType);
    if (!eventTypes.includes("legal_documents_ready_email_attempt_started")) {
      throw new Error("Legal notification success has no matching durable send intent");
    }
    if (eventTypes.includes("legal_documents_ready_email_failed")) {
      throw new Error("Legal notification send attempt was already recorded as failed");
    }
    if (eventTypes.includes("legal_documents_ready_email_sent")) return;

    // The SMTP call may outlive its five-minute job lease. Its successful
    // result is still audit-worthy; the unresolved-intent fence prevents any
    // subsequent worker from sending a duplicate while this call is pending.
    await recordLegalNotificationEvent(
      tx,
      job.pairId,
      "worker",
      "legal_documents_ready_email_sent",
      {
        jobId,
        notificationCycleId: cycle.id,
        cycleNumber: cycle.cycleNumber,
        attempt,
        leaseStillOwned: job.status === "leased" && job.leaseToken === leaseToken,
      },
    );
    await tx.execute(sql`
      UPDATE legal_notification_cycles
      SET status = 'sent', sent_at = now(), updated_at = now()
      WHERE id = ${cycle.id}
    `);
  });
}

export async function markLegalNotificationUncertain(
  jobId: number,
  leaseToken: string,
  attempt: number,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const job = resultRows<{
      pairId: number;
      kind: string;
      status: string;
      leaseToken: string | null;
      leaseLive: boolean;
      notificationCycleId: number | null;
    }>(await tx.execute(sql`
      SELECT pair_id AS "pairId", kind, status, lease_token AS "leaseToken",
        leased_until > now() AS "leaseLive",
        notification_cycle_id AS "notificationCycleId"
      FROM legal_jobs WHERE id = ${jobId} FOR UPDATE
    `))[0];
    requireNotificationLease(job, leaseToken);
    if (!job.notificationCycleId) {
      throw new Error("Legal notification cycle setup is required before recording uncertain delivery.");
    }
    const cycle = resultRows<{ id: number; cycleNumber: number }>(await tx.execute(sql`
      SELECT id, cycle_number AS "cycleNumber"
      FROM legal_notification_cycles
      WHERE id = ${job.notificationCycleId} AND pair_id = ${job.pairId}
      FOR UPDATE
    `))[0];
    if (!cycle) throw new Error("The active legal notification cycle is missing while recording uncertainty");
    const eventFilter = notificationCycleAuditFilter(jobId, cycle.id, Number(cycle.cycleNumber));
    const attemptEvents = resultRows<{ eventType: string }>(await tx.execute(sql`
      SELECT event_type AS "eventType"
      FROM legal_audit_events
      WHERE pair_id = ${job.pairId}
        AND ${eventFilter}
        AND details->>'attempt' = ${String(attempt)}
        AND event_type IN (
          'legal_documents_ready_email_attempt_started',
          'legal_documents_ready_email_sent',
          'legal_documents_ready_email_failed'
        )
    `));
    const eventTypes = attemptEvents.map((event) => event.eventType);
    if (!eventTypes.includes("legal_documents_ready_email_attempt_started")) {
      throw new Error("Legal notification uncertainty has no matching durable send intent");
    }
    if (eventTypes.includes("legal_documents_ready_email_sent")) return;
    if (eventTypes.includes("legal_documents_ready_email_failed")) {
      throw new Error("Legal notification send attempt was already recorded as failed");
    }

    await tx.execute(sql`
      UPDATE legal_jobs
      SET status = 'dead', lease_token = NULL, leased_until = NULL,
          last_error = 'Email delivery status is uncertain; manual review required',
          updated_at = now()
      WHERE id = ${jobId} AND status = 'leased' AND lease_token = ${leaseToken}
    `);
    await tx.execute(sql`
      UPDATE legal_notification_cycles
      SET status = 'uncertain', updated_at = now()
      WHERE id = ${cycle.id}
    `);
    await recordLegalNotificationEvent(tx, job.pairId, "worker",
      "legal_documents_ready_email_delivery_uncertain", {
        jobId,
        notificationCycleId: cycle.id,
        cycleNumber: cycle.cycleNumber,
        attempt,
        reason: reason.trim().slice(0, 500),
      });
  });
}

export async function recordLegalNotificationFailed(
  jobId: number,
  leaseToken: string,
  attempt: number,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const job = resultRows<{
      pairId: number;
      kind: string;
      status: string;
      leaseToken: string | null;
      leaseLive: boolean;
      notificationCycleId: number | null;
    }>(await tx.execute(sql`
      SELECT pair_id AS "pairId", kind, status, lease_token AS "leaseToken",
        leased_until > now() AS "leaseLive",
        notification_cycle_id AS "notificationCycleId"
      FROM legal_jobs WHERE id = ${jobId} FOR UPDATE
    `))[0];
    requireNotificationLease(job, leaseToken);
    if (!job.notificationCycleId) {
      throw new Error("Legal notification cycle setup is required before recording an email failure.");
    }
    const cycle = resultRows<{ id: number; cycleNumber: number }>(await tx.execute(sql`
      SELECT id, cycle_number AS "cycleNumber"
      FROM legal_notification_cycles
      WHERE id = ${job.notificationCycleId} AND pair_id = ${job.pairId}
      FOR UPDATE
    `))[0];
    if (!cycle) throw new Error("The active legal notification cycle is missing while recording failure");
    const safeReason = reason.trim().slice(0, 500);
    await recordLegalNotificationEvent(
      tx,
      job.pairId,
      "worker",
      "legal_documents_ready_email_failed",
      {
        jobId,
        notificationCycleId: cycle.id,
        cycleNumber: cycle.cycleNumber,
        attempt,
        reason: safeReason,
      },
    );
    await tx.execute(sql`
      UPDATE legal_notification_cycles
      SET status = 'failed', attempt_count = GREATEST(attempt_count, ${attempt}), updated_at = now()
      WHERE id = ${cycle.id}
    `);
  });
}

export async function recordUnsignedArtifact(
  docId: number,
  artifact: {
    docxKey: string;
    pdfKey: string;
    hash: string;
    signaturePlacement: Record<string, unknown>;
  },
): Promise<void> {
  requireLegalObjectKey(artifact.docxKey, "DOCX object key");
  requireLegalObjectKey(artifact.pdfKey, "PDF object key");
  requireSha256(artifact.hash, "PDF hash");
  const placement = JSON.stringify(artifact.signaturePlacement);
  await db.transaction(async (tx) => {
    const reference = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT p.id AS pair_id, p.reservation_id, p.user_id, p.property_id
      FROM legal_documents d
      JOIN legal_document_pairs p ON p.id = d.pair_id
      WHERE d.id = ${docId}
    `))[0];
    if (!reference) throw new Error("Legal document not found while recording its unsigned artifact");
    await assertActiveConfirmedHolding(tx, {
      reservationId: Number(reference.reservation_id),
      userId: Number(reference.user_id),
      propertyId: Number(reference.property_id),
    });
    const pair = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT reservation_id, user_id, property_id
      FROM legal_document_pairs WHERE id = ${reference.pair_id}
      FOR UPDATE
    `))[0];
    if (
      !pair ||
      Number(pair.reservation_id) !== Number(reference.reservation_id) ||
      Number(pair.user_id) !== Number(reference.user_id) ||
      Number(pair.property_id) !== Number(reference.property_id)
    ) {
      throw new Error("Legal approval changed while recording its unsigned artifact");
    }
    const result = await tx.execute(sql`
      UPDATE legal_documents
      SET source_docx_key = ${artifact.docxKey},
          unsigned_pdf_key = ${artifact.pdfKey},
          unsigned_pdf_sha256 = ${artifact.hash.toLowerCase()},
          signature_placement = ${placement}::jsonb,
          generated_at = COALESCE(generated_at, now())
      WHERE id = ${docId}
        AND (source_docx_key IS NULL OR source_docx_key = ${artifact.docxKey})
        AND (unsigned_pdf_key IS NULL OR unsigned_pdf_key = ${artifact.pdfKey})
        AND (unsigned_pdf_sha256 IS NULL OR unsigned_pdf_sha256 = ${artifact.hash.toLowerCase()})
    `);
    if (Number((result as any).rowCount ?? (resultRows(result) as unknown[]).length) === 0) {
      throw new Error("Document not found or a previously stored unsigned artifact cannot be replaced");
    }
  });
}

export async function markPairReady(pairId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const reference = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT reservation_id, user_id, property_id
      FROM legal_document_pairs WHERE id = ${pairId}
    `))[0];
    if (!reference) throw new Error("Legal document pair not found while marking documents ready");
    await assertActiveConfirmedHolding(tx, {
      reservationId: Number(reference.reservation_id),
      userId: Number(reference.user_id),
      propertyId: Number(reference.property_id),
    });
    const lockedPair = resultRows<Record<string, any>>(await tx.execute(sql`
      SELECT reservation_id, user_id, property_id
      FROM legal_document_pairs WHERE id = ${pairId}
      FOR UPDATE
    `))[0];
    if (
      !lockedPair ||
      Number(lockedPair.reservation_id) !== Number(reference.reservation_id) ||
      Number(lockedPair.user_id) !== Number(reference.user_id) ||
      Number(lockedPair.property_id) !== Number(reference.property_id)
    ) {
      throw new Error("Legal approval changed while marking documents ready");
    }
    const documents = resultRows<{ id: number }>(await tx.execute(sql`
      SELECT id FROM legal_documents
      WHERE pair_id = ${pairId} AND unsigned_pdf_key IS NOT NULL
        AND unsigned_pdf_sha256 IS NOT NULL AND source_docx_key IS NOT NULL
    `));
    if (documents.length !== 2) {
      throw new Error("Both unsigned PDFs must be privately stored before the pair is ready");
    }
    const updated = resultRows<{ status: string }>(await tx.execute(sql`
      UPDATE legal_document_pairs
      SET status = 'documents_ready', documents_ready_at = COALESCE(documents_ready_at, now()),
          last_error = NULL
      WHERE id = ${pairId} AND status IN ('queued', 'generating', 'failed', 'documents_ready')
      RETURNING status
    `))[0];
    if (!updated) throw new Error("Legal pair is not in a state that can become ready");
    await tx.execute(sql`
      UPDATE legal_documents
      SET status = 'awaiting_signature'
      WHERE pair_id = ${pairId} AND status = 'generated'
    `);
    const insertedCycle = resultRows<{ id: number }>(await tx.execute(sql`
      INSERT INTO legal_notification_cycles
        (pair_id, cycle_number, request_kind, status)
      VALUES (${pairId}, 1, 'initial', 'queued')
      ON CONFLICT (pair_id, cycle_number) DO NOTHING
      RETURNING id
    `))[0];
    const initialCycleId = insertedCycle?.id ?? resultRows<{ id: number }>(await tx.execute(sql`
      SELECT id FROM legal_notification_cycles
      WHERE pair_id = ${pairId} AND cycle_number = 1
      FOR UPDATE
    `))[0]?.id;
    if (!initialCycleId) throw new Error("Initial legal notification cycle could not be initialized");
    await tx.execute(sql`
      INSERT INTO legal_jobs (pair_id, kind, status, notification_cycle_id)
      VALUES (${pairId}, 'notify', 'queued', ${initialCycleId})
      ON CONFLICT (pair_id, kind) DO NOTHING
    `);
    await tx.execute(sql`
      UPDATE legal_jobs
      SET notification_cycle_id = ${initialCycleId}
      WHERE pair_id = ${pairId} AND kind = 'notify' AND notification_cycle_id IS NULL
    `);
    await tx.execute(sql`
      INSERT INTO legal_audit_events (pair_id, actor_type, event_type, details)
      VALUES (${pairId}, 'worker', 'both_unsigned_documents_ready',
        ${JSON.stringify({ documentCount: documents.length })}::jsonb)
    `);
  });
}

export async function claimNextLegalJob(): Promise<LegalJobClaim | null> {
  const leaseToken = randomUUID();
  return db.transaction(async (tx) => {
    const rows = resultRows<LegalJobClaim>(await tx.execute(sql`
      WITH candidate AS (
        SELECT id FROM legal_jobs
        WHERE (
          (status IN ('queued', 'retry') AND available_at <= now())
          OR (status = 'leased' AND leased_until <= now())
        )
        ORDER BY available_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE legal_jobs j
      SET status = 'leased', attempts = j.attempts + 1,
          lease_token = ${leaseToken}, leased_until = now() + interval '5 minutes',
          updated_at = now()
      FROM candidate c
      WHERE j.id = c.id
      RETURNING j.id, j.pair_id AS "pairId", j.kind, j.lease_token AS "leaseToken",
        j.attempts, j.notification_cycle_id AS "notificationCycleId"
    `));
    const claim = rows[0];
    if (claim?.kind === "generation") {
      await tx.execute(sql`
        UPDATE legal_document_pairs SET status = 'generating', last_error = NULL
        WHERE id = ${claim.pairId} AND status IN ('queued', 'failed')
      `);
    }
    return claim ?? null;
  });
}

export async function completeLegalJob(id: number, leaseToken: string): Promise<void> {
  const result = await db.execute(sql`
    UPDATE legal_jobs
    SET status = 'complete', completed_at = now(), lease_token = NULL,
        leased_until = NULL, last_error = NULL, updated_at = now()
    WHERE id = ${id} AND status = 'leased' AND lease_token = ${leaseToken}
      AND leased_until > now()
  `);
  if (Number((result as any).rowCount ?? 0) !== 1) {
    throw new Error("Legal job lease is stale or no longer owned by this worker");
  }
}

export async function failLegalJob(id: number, leaseToken: string, error: string): Promise<void> {
  const safeError = error.trim().slice(0, 4000) || "Unknown legal-document worker error";
  await db.transaction(async (tx) => {
    const job = resultRows<{
      pairId: number;
      kind: LegalJobKind;
      attempts: number;
      status: string;
      notificationCycleId: number | null;
    }>(await tx.execute(sql`
      UPDATE legal_jobs
      -- Signing reconciliation is a durable provider-read retry, never an
      -- envelope-create retry. Keep it retryable indefinitely: webhook events
      -- and ambiguous transaction IDs must not be abandoned after a finite
      -- worker-attempt budget.
      SET status = CASE
            WHEN kind = 'reconcile' THEN 'retry'
            WHEN kind = 'notify' AND EXISTS (
              SELECT 1 FROM legal_notification_cycles c
              WHERE c.id = legal_jobs.notification_cycle_id
                AND c.status IN ('sending', 'uncertain', 'exhausted')
            ) THEN 'dead'
            WHEN attempts >= 8 THEN 'dead'
            ELSE 'retry'
          END,
          available_at = now() + make_interval(secs => LEAST(21600, 30 * power(2, LEAST(attempts, 9))::integer)),
          lease_token = NULL, leased_until = NULL, last_error = ${safeError},
          updated_at = now()
      WHERE id = ${id} AND status = 'leased' AND lease_token = ${leaseToken}
        AND leased_until > now()
      RETURNING pair_id AS "pairId", kind, attempts, status,
        notification_cycle_id AS "notificationCycleId"
    `))[0];
    if (!job) throw new Error("Legal job lease is stale or no longer owned by this worker");
    if (job.kind === "generation") {
      await tx.execute(sql`
        UPDATE legal_document_pairs
        SET status = CASE WHEN ${job.status} = 'dead' THEN 'failed' ELSE 'queued' END,
            last_error = ${safeError}
        WHERE id = ${job.pairId} AND status <> 'investor_signed'
      `);
    }
    if (job.kind === "notify" && job.notificationCycleId) {
      const cycle = resultRows<{ id: number; cycleNumber: number; status: string; attemptCount: number }>(
        await tx.execute(sql`
          SELECT id, cycle_number AS "cycleNumber", status,
            attempt_count AS "attemptCount"
          FROM legal_notification_cycles
          WHERE id = ${job.notificationCycleId} AND pair_id = ${job.pairId}
          FOR UPDATE
        `),
      )[0];
      if (cycle?.status === "sending") {
        await tx.execute(sql`
          UPDATE legal_notification_cycles
          SET status = 'uncertain', updated_at = now()
          WHERE id = ${cycle.id}
        `);
        await recordLegalNotificationEvent(tx, job.pairId, "worker",
          "legal_documents_ready_email_delivery_uncertain", {
            jobId: id,
            notificationCycleId: cycle.id,
            cycleNumber: cycle.cycleNumber,
            attempt: cycle.attemptCount,
            reason: "worker_failed_while_delivery_result_was_unresolved",
          });
      } else if (job.status === "dead" && cycle &&
          !["sent", "uncertain", "exhausted"].includes(cycle.status)) {
        await tx.execute(sql`
          UPDATE legal_notification_cycles
          SET status = 'failed', updated_at = now()
          WHERE id = ${cycle.id}
        `);
      }
    }
    await tx.execute(sql`
      INSERT INTO legal_audit_events
        (pair_id, actor_type, event_type, details)
      VALUES (${job.pairId}, 'worker', 'legal_job_failed',
        ${JSON.stringify({ jobId: id, kind: job.kind, attempts: job.attempts, error: safeError })}::jsonb)
    `);
  });
}

export async function getLegalDocumentsByUser(userId: number): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    SELECT p.id AS "pairId", p.reservation_id AS "reservationId",
      p.user_id AS "userId", p.property_id AS "propertyId",
      p.status AS "pairStatus", p.property_area_sqm::text AS "propertyAreaSqm",
      p.payment_amount_naira::text AS "paymentAmountNaira",
      p.payment_currency AS "paymentCurrency", p.documents_ready_at AS "documentsReadyAt",
      p.investor_signed_at AS "investorSignedAt", d.id AS "documentId",
      d.document_type AS "documentType", d.status AS "documentStatus"
    FROM legal_document_pairs p
    LEFT JOIN legal_documents d ON d.pair_id = p.id
    WHERE p.user_id = ${userId}
    ORDER BY p.created_at DESC, d.document_type
  `);
  return resultRows<Record<string, unknown>>(result);
}
