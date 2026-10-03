import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { calculateHoldingCosts } from "../../shared/holding-costs";
import { db } from "../db";
import { enqueueLegalApproval, type LegalTransaction } from "./repository";
import { assertActiveConfirmedHolding } from "./holding-state";
import type { ManualFullPaymentAttestation } from "./approval";
import { hasExactPdfApproval } from "./pdf-review";

const rows = (result: any): any[] => result.rows || [];
type Executor = Pick<LegalTransaction, "execute">;
export const HISTORICAL_BATCH_LIMIT = 20;
const positiveMoney = (value: unknown) => /^\d+(?:\.\d{1,2})?$/.test(String(value)) && new Decimal(String(value)).gt(0);

async function activeTemplates(executor: Executor, propertyId: number, lock = false) {
  return rows(await executor.execute(sql`SELECT id,property_id AS "propertyId",document_type AS "documentType",version,storage_key AS "storageKey",sha256
    FROM legal_templates WHERE property_id=${propertyId} AND is_active AND validation_status='valid' AND deleted_at IS NULL
    ORDER BY document_type ${lock ? sql`FOR SHARE` : sql``}`));
}

function templateBlockers(templates: any[]) {
  return ["deed_of_assignment", "transfer_exit_rights"].flatMap((type) => {
    const matches = templates.filter((t) => t.documentType === type);
    if (matches.length !== 1) return [`Activate exactly one valid ${type.replace(/_/g, " ")} template for this property.`];
    const t = matches[0];
    // The worker accepts retained legacy normalized legal/template keys too.
    const ownedPrefix = `legal/templates/properties/${t.propertyId}/${type}/v${t.version}/`;
    const uploadId = String(t.storageKey).startsWith(ownedPrefix) ? String(t.storageKey).slice(ownedPrefix.length) : "";
    if (!Number.isSafeInteger(Number(t.version)) || Number(t.version) < 1 ||
        !/^[a-f0-9]{64}$/i.test(t.sha256 || "") || !String(t.storageKey).startsWith("legal/templates/") ||
        String(t.storageKey).split("/").some((s) => !s || s === "." || s === "..") || /[\\\0]/.test(t.storageKey) ||
        (t.storageKey !== `legal/templates/${type}/v${t.version}` && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId))) {
      return [`Invalid ${type.replace(/_/g, " ")} template metadata. Upload and activate a corrected version.`];
    }
    return [];
  });
}

async function eligibility(executor: Executor, holding: any, templates: any[], lock = false) {
  const blockers = templateBlockers(templates);
  if (holding.status !== "converted_to_investment" || holding.funnelStage !== "confirmed" || !holding.userId) blockers.push("Holding must have an active confirmed owner and confirmed allocation.");
  if (holding.kycStatus !== "approved" || !holding.verifiedName?.trim() || !holding.verifiedAddress?.trim()) blockers.push("Approve KYC with a verified legal name and home address.");
  if (!holding.propertyName?.trim() || !holding.propertyLocation?.trim()) blockers.push("Property name and location must be recorded.");
  if (!holding.userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(holding.userEmail)) blockers.push("Investor requires a valid account email before preparation and notification.");
  if (!positiveMoney(holding.units)) blockers.push("Holding units must be positive with at most two decimal places.");
  if (holding.currency !== "NGN" || !positiveMoney(holding.amount)) blockers.push("A positive full NGN purchase total is required.");
  if (!positiveMoney(holding.unitPrice) || !positiveMoney(holding.units) || !positiveMoney(holding.amount) ||
      new Decimal(holding.unitPrice).mul(holding.units).toDecimalPlaces(2).comparedTo(holding.amount) !== 0) {
    blockers.push("Purchase amount and units × recorded unit price do not agree. Resolve ambiguous allocation evidence separately; do not infer units from property counters.");
  }
  const payments = rows(await executor.execute(sql`SELECT id,user_id AS "userId",amount::numeric::text AS amount,currency,
      reviewed_at AS "reviewedAt",reviewed_by_admin_id AS "reviewedByAdminId"
    FROM payment_submissions WHERE reservation_id=${holding.reservationId} AND status='approved'
    ORDER BY id ${lock ? sql`FOR SHARE` : sql``}`));
  const proven = payments.length === 1 && Number(payments[0].userId) === Number(holding.userId) &&
    payments[0].currency === "NGN" && positiveMoney(payments[0].amount) && positiveMoney(holding.amount) &&
    new Decimal(payments[0].amount).eq(holding.amount) && payments[0].reviewedAt && payments[0].reviewedByAdminId;
  if (payments.length && !proven) blockers.push("Approved payment evidence is ambiguous or does not settle this owner's full NGN holding. Resolve the evidence separately; an attestation cannot override it.");
  // Legacy administrator-recorded payments are not approval submissions.
  // Consistent legacy evidence still requires an explicit attestation; known
  // contradictory/refunded evidence must never be overridden with a checkbox.
  const optional = rows(await executor.execute(sql`SELECT to_regclass('public.investment_payments') IS NOT NULL AS payments,
    to_regclass('public.resale_listings') IS NOT NULL AS resale`))[0];
  if (optional?.payments) {
    const legacy = rows(await executor.execute(sql`SELECT amount::numeric::text AS amount,currency,status FROM investment_payments
      WHERE reservation_id=${holding.reservationId} ORDER BY id ${lock ? sql`FOR SHARE` : sql``}`));
    if (legacy.length && (legacy.length !== 1 || legacy[0].status !== "verified" || legacy[0].currency !== "NGN" ||
        !positiveMoney(legacy[0].amount) || !positiveMoney(holding.amount) || !new Decimal(legacy[0].amount).eq(holding.amount))) {
      blockers.push("Legacy payment records are ambiguous, unverified or refunded. Resolve them separately; attestation cannot override contradictory evidence.");
    }
  }
  if (optional?.resale) {
    const sold = rows(await executor.execute(sql`SELECT id FROM resale_listings WHERE reservation_id=${holding.reservationId} AND status='sold'
      ${lock ? sql`FOR SHARE` : sql``}`));
    if (sold.length) blockers.push("This holding has completed resale allocation history. Resolve current ownership and allocation evidence separately before historical preparation.");
  }
  return { blockers, requiresAttestation: payments.length === 0, provenPayment: proven ? payments[0] : null };
}

function reviewToken(h: any) {
  return createHash("sha256").update(JSON.stringify([h.reservationId,h.userId,h.userEmail,h.verifiedName,
    h.verifiedAddress,h.status,h.funnelStage,h.units,h.amount,h.currency,h.unitPrice,h.propertyName,h.propertyLocation])).digest("hex");
}
const holdingQuery = (propertyId: number) => sql`SELECT r.id AS "reservationId",r.user_id AS "userId",
  r.status,r.funnel_stage AS "funnelStage",r.units::numeric::text AS units,r.amount::numeric::text AS amount,
  r.currency,r.unit_price_snapshot::numeric::text AS "unitPrice",
  COALESCE(NULLIF(trim(u.kyc_full_name),''),r.full_name) AS "userName",u.email AS "userEmail",
  u.kyc_status AS "kycStatus",u.kyc_full_name AS "verifiedName",u.kyc_address AS "verifiedAddress",
  pr.name AS "propertyName",pr.location AS "propertyLocation",
  pr.currency AS "propertyCurrency",pr.unit_land_cost AS "unitLandCost",
  pr.unit_agent_fees AS "unitAgentFees",pr.unit_due_diligence_cost AS "unitDueDiligenceCost",
  pr.unit_service_charge AS "unitServiceCharge",p.id AS "pairId",p.status AS "pairStatus",
  p.documents_ready_at AS "readyAt",p.last_error AS "lastError",p.data_snapshot AS "legalSnapshot"
  FROM investment_reservations r JOIN properties pr ON pr.id=r.property_id
  LEFT JOIN users u ON u.id=r.user_id LEFT JOIN legal_document_pairs p ON p.reservation_id=r.id
  WHERE r.property_id=${propertyId}`;

export async function searchHistoricalHoldings(input: { propertyId: number; search?: string; page?: number; pageSize?: number }) {
  const page = input.page ?? 1, pageSize = input.pageSize ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error("Use a valid page and page size (maximum 50).");
  const search = (input.search || "").trim();
  if (search.length > 150) throw new Error("Search must be at most 150 characters.");
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const filter = sql`AND r.status='converted_to_investment'
    AND (${search === ""} OR u.email ILIKE ${pattern} OR r.full_name ILIKE ${pattern}
      OR u.kyc_full_name ILIKE ${pattern} OR concat_ws(' ',u.first_name,u.last_name) ILIKE ${pattern}
      OR r.id::text ILIKE ${pattern})`;
  const templates = await activeTemplates(db as Executor, input.propertyId);
  const property = rows(await db.execute(sql`SELECT name FROM properties WHERE id=${input.propertyId}`))[0];
  if (!property) throw Object.assign(new Error("Property not found"), { statusCode: 404 });
  const total = Number(rows(await db.execute(sql`SELECT count(*)::int AS total FROM (${holdingQuery(input.propertyId)} ${filter}) holdings`))[0]?.total || 0);
  const holdings = rows(await db.execute(sql`${holdingQuery(input.propertyId)} ${filter} ORDER BY r.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`));
  const items = [];
  for (const h of holdings) {
    const docs = h.pairId ? rows(await db.execute(sql`SELECT d.*,t.version AS template_version FROM legal_documents d
      JOIN legal_templates t ON t.id=d.template_id WHERE d.pair_id=${h.pairId} AND d.superseded_at IS NULL`)) : [];
    const jobs = h.pairId ? rows(await db.execute(sql`SELECT id,kind,status,notification_cycle_id AS "cycleId",
      available_at AS "availableAt",available_at<=now() AS "retryEligible",last_error AS "lastError"
      FROM legal_jobs WHERE pair_id=${h.pairId}`)) : [];
    const history = h.pairId ? rows(await db.execute(sql`SELECT c.id,c.cycle_number AS "cycleNumber",c.status,j.last_error AS "lastError",c.created_at AS "createdAt",c.sent_at AS "sentAt"
      FROM legal_notification_cycles c LEFT JOIN legal_jobs j ON j.notification_cycle_id=c.id AND j.kind='notify'
      WHERE c.pair_id=${h.pairId} ORDER BY c.cycle_number DESC LIMIT 20`)) : [];
    const auditHistory = rows(await db.execute(sql`SELECT id,event_type AS "eventType",actor_id AS "actorId",created_at AS "createdAt",details
      FROM legal_audit_events WHERE reservation_id=${h.reservationId} OR (pair_id=${h.pairId ?? null})
      ORDER BY id DESC LIMIT 30`));
    const ready = !!h.readyAt && docs.length === 2 && new Set(docs.map((d) => d.document_type)).size === 2 &&
      docs.every((d) => d.unsigned_pdf_key && /^[a-f0-9]{64}$/i.test(d.unsigned_pdf_sha256 || "") && d.signature_placement);
    const signed = docs.filter((d) => d.status === "investor_signed").length;
    const landCosts = calculateHoldingCosts({ units: h.units, amount: h.amount, currency: h.currency,
      property: { currency: h.propertyCurrency, unitLandCost: h.unitLandCost, unitAgentFees: h.unitAgentFees,
        unitDueDiligenceCost: h.unitDueDiligenceCost, unitServiceCharge: h.unitServiceCharge } });
    const check = h.pairId ? { blockers: [] as string[], requiresAttestation: false } : await eligibility(db as Executor, h, templates);
    const active = h.status === "converted_to_investment" && h.funnelStage === "confirmed";
    const safe = docs.every((d) => ["awaiting_signature", "signing_in_progress", "investor_signed"].includes(d.status));
    const reviewApproved = h.pairId ? await hasExactPdfApproval(db, h.pairId) : false;
    const latestNotification = history[0]?.status || "not_queued";
    const notificationState = h.pairId && ready && !reviewApproved && signed < 2 &&
      !["sent", "uncertain", "sending"].includes(latestNotification)
      ? "awaiting_review" : latestNotification;
    items.push({
      reservationId: h.reservationId, userName: h.userName, userEmail: h.userEmail, units: h.units, amount: h.amount, currency: h.currency,
      landConsiderationNaira: landCosts?.landAmount ?? null,
      needsConsiderationCorrection: !!landCosts && !!h.pairId && signed === 0 && docs.some(d =>
        Number(d.consideration_amount_naira ?? h.legalSnapshot?.landConsiderationNaira ?? 0) !== Number(landCosts.landAmount)),
      reviewToken: reviewToken(h), auditHistory,
      pairId: h.pairId, preparationState: h.pairStatus || "unprepared", signingState: signed === 2 ? "investor_signed" : signed ? "partially_signed" : "unsigned",
      notificationState, notificationHistory: history, jobs, lastError: h.lastError,
      blockers: !active ? ["Signing and notification are suspended: holding is not confirmed and active."] : check.blockers,
      requiresAttestation: check.requiresAttestation, canPrepare: !h.pairId && !check.blockers.length,
      reviewApproved, canReview: active && ready && safe && signed < 2 && h.pairStatus !== "investor_signed",
      documents: docs.map(d => ({ id: d.id, type: d.document_type, status: d.status, sha256: d.unsigned_pdf_sha256,
        templateId: d.template_id, templateVersion: d.template_version,
        hasUnsignedPdf: !!d.unsigned_pdf_key, hasSignedPdf: !!d.signed_pdf_key, hasCertificate: !!d.signing_certificate_key })),
      canNotify: reviewApproved && active && ready && safe && signed < 2 && h.pairStatus !== "investor_signed" && latestNotification !== "uncertain",
    });
  }
  return { items, total, page, pageSize, propertyName: property.name, templates: templates.map(({ id, documentType, version }) => ({ id, documentType, version })) };
}

export async function prepareHistoricalHoldings(input: {
  propertyId: number; adminId: number; confirmed: boolean;
  templateIds: { deed: number; transfer: number };
  holdings: { reservationId: number; reviewToken: string; attestation?: ManualFullPaymentAttestation }[];
}) {
  if (input.confirmed !== true) throw new Error("Explicit preparation confirmation is required.");
  if (!Array.isArray(input.holdings) || !input.holdings.length || input.holdings.length > HISTORICAL_BATCH_LIMIT ||
      input.holdings.some((h) => !Number.isSafeInteger(h?.reservationId) || h.reservationId < 1) ||
      new Set(input.holdings.map((h) => h.reservationId)).size !== input.holdings.length) throw new Error("Select 1–20 distinct valid holdings.");
  if (!input.templateIds || !Number.isSafeInteger(input.templateIds.deed) || !Number.isSafeInteger(input.templateIds.transfer)) throw new Error("Review both active template versions before confirming.");
  const results = [];
  for (const selected of input.holdings) {
    try {
      const result = await db.transaction(async (tx) => {
        // Follow the same holding-first lock order as cancellation and signing.
        await tx.execute(sql`SELECT id FROM investment_reservations WHERE id=${selected.reservationId} AND property_id=${input.propertyId} FOR UPDATE`);
        const h = rows(await tx.execute(sql`${holdingQuery(input.propertyId)} AND r.id=${selected.reservationId}`))[0];
        if (!h) throw new Error("Holding not found in this property.");
        await assertActiveConfirmedHolding(tx, { reservationId: h.reservationId, propertyId: input.propertyId, userId: Number(h.userId) });
        if (h.pairId) return { reservationId: selected.reservationId, state: "existing", pairId: h.pairId };
        // Lock KYC and property metadata through snapshot creation.
        await tx.execute(sql`SELECT id FROM users WHERE id=${h.userId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM properties WHERE id=${input.propertyId} FOR SHARE`);
        const locked = rows(await tx.execute(sql`${holdingQuery(input.propertyId)} AND r.id=${selected.reservationId}`))[0];
        if (selected.reviewToken !== reviewToken(locked)) throw new Error("Holding ownership, KYC or purchase values changed since review. Refresh and confirm the current recipient and holding again.");
        const templates = await activeTemplates(tx, input.propertyId, true);
        const check = await eligibility(tx, locked, templates, true);
        if (check.blockers.length) throw new Error(check.blockers.join(" "));
        if (templates.find((t) => t.documentType === "deed_of_assignment")?.id !== input.templateIds.deed ||
            templates.find((t) => t.documentType === "transfer_exit_rights")?.id !== input.templateIds.transfer) throw new Error("Active template versions changed. Refresh and review the confirmation again.");
        const a = selected.attestation;
        if (check.requiresAttestation && (a?.fullPaymentConfirmed !== true || a.currency !== "NGN" || !positiveMoney(a.amountNaira) ||
            !new Decimal(a.amountNaira).eq(locked.amount) || typeof a.auditNote !== "string" || !a.auditNote.trim() || a.auditNote.length > 2000)) {
          throw new Error("Explicit audited full-payment attestation is required: confirm full payment, enter the exact persisted NGN total and an audit note.");
        }
        const evidence = check.provenPayment ? { kind: "approved_submission", submissionId: check.provenPayment.id,
          reviewedAt: check.provenPayment.reviewedAt, reviewedByAdminId: check.provenPayment.reviewedByAdminId } :
          { kind: "explicit_full_payment_attestation", fullPaymentConfirmed: true, currency: "NGN",
            amountNaira: new Decimal(locked.amount).toFixed(2), auditNote: a!.auditNote.trim(), attestingAdminId: input.adminId };
        const legal = await enqueueLegalApproval(tx, { reservationId: h.reservationId, source: "historical_rollout", sourceId: h.reservationId,
          adminId: input.adminId, confirmedFullPayment: true, assertedCurrency: "NGN", assertedAmountNaira: locked.amount,
          approvalNote: check.provenPayment ? `Historical preparation using approved full-payment submission #${check.provenPayment.id}; no financial approval transition.` : a!.auditNote,
          historicalEvidence: evidence });
        if (!legal.eligible || legal.status === "awaiting_templates") throw new Error(legal.reason || "Holding is no longer eligible.");
        return { reservationId: h.reservationId, state: legal.duplicate ? "existing" : "queued", pairId: legal.pairId };
      });
      results.push(result);
    } catch (error: any) {
      const reason = error.code === "42P01" || error.code === "42703" || error.code === "23514"
        ? "Legal rollout schema setup is required. Apply the documented additive migrations." :
        error instanceof Error && !(error as any).code ? error.message : "Preparation failed. Check legal schema setup and retry this holding; no financial changes were made.";
      const state = error.code ? "failed" : "blocked";
      // A failed transaction cannot leave a half-pair. Keep a separate bounded
      // admin-attributed failure record without exposing cross-property holdings.
      let auditWarning: string | undefined;
      await db.execute(sql`INSERT INTO legal_audit_events(reservation_id,actor_type,actor_id,event_type,details)
        SELECT id,'admin',${input.adminId},'historical_rollout_preparation_blocked',
          ${JSON.stringify({ propertyId: input.propertyId, reason })}::jsonb
        FROM investment_reservations WHERE id=${selected.reservationId} AND property_id=${input.propertyId}`)
        .catch(() => { auditWarning = "Failure audit could not be saved. Apply the legal schema setup before retrying."; });
      results.push({ reservationId: selected.reservationId, state, reason, ...(auditWarning ? { auditWarning } : {}) });
    }
  }
  return { results };
}