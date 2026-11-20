import { sql } from "drizzle-orm";

type SqlExecutor = { execute(query: unknown): Promise<unknown> };

export type ConfirmedHoldingIdentity = {
  reservationId: number;
  userId: number;
  propertyId: number;
};

export type UnsignedLegalCancellationResult = {
  reservationId: number;
  pairIds: number[];
  clearedDraftChallenges: number;
  fencedJobs: number;
  policy: "unsigned_signing_suspended";
};

type ReservationRow = {
  id: number;
  user_id: number | string | null;
  property_id: number | string;
  status: string;
  funnel_stage: string | null;
};

type LegalPairRow = {
  id: number | string;
  user_id: number | string;
  property_id: number | string;
};

type LegalDocumentRow = Record<string, any> & {
  id: number | string;
  pair_id: number | string;
  status: string;
};

type LocalOperationRow = Record<string, any> & {
  id: number | string;
  pair_id: number | string;
  document_id: number | string;
  status: string;
};

export class HoldingStateError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = "HoldingStateError";
    this.statusCode = statusCode;
  }
}

function rows<T>(result: unknown): T[] {
  const resultObject = result as { rows?: T[] } | null;
  return Array.isArray(resultObject?.rows) ? resultObject.rows : [];
}

function positiveId(value: unknown, label: string): number {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new HoldingStateError(`${label} is invalid.`, 400);
  }
  return id;
}

async function tableExists(executor: SqlExecutor, tableName: string): Promise<boolean> {
  const result = rows<{ installed: boolean }>(await executor.execute(sql`
    SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS installed
  `))[0];
  return result?.installed === true;
}

async function hasFunnelStageColumn(executor: SqlExecutor): Promise<boolean> {
  const result = rows<{ installed: boolean }>(await executor.execute(sql`
    SELECT EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'investment_reservations'
        AND column_name = 'funnel_stage'
    ) AS installed
  `))[0];
  return result?.installed === true;
}

/**
 * Validate and, by default, row-lock the same confirmed holding that backs an
 * approved legal pair. Both reservation state fields are checked where the
 * existing schema exposes the independent funnel-stage column.
 */
export async function assertActiveConfirmedHolding(
  executor: SqlExecutor,
  identity: ConfirmedHoldingIdentity,
  options: { lock?: boolean } = {},
): Promise<ReservationRow> {
  const reservationId = positiveId(identity.reservationId, "Reservation ID");
  const userId = positiveId(identity.userId, "Investor ID");
  const propertyId = positiveId(identity.propertyId, "Property ID");
  const hasFunnelStage = await hasFunnelStageColumn(executor);
  const reservation = rows<ReservationRow>(await executor.execute(sql`
    SELECT r.id, r.user_id, r.property_id, r.status,
      ${hasFunnelStage ? sql`r.funnel_stage` : sql`NULL::text`} AS funnel_stage
    FROM investment_reservations r
    WHERE r.id = ${reservationId}
    ${options.lock === false ? sql`` : sql`FOR UPDATE OF r`}
  `))[0];

  if (
    !reservation ||
    Number(reservation.user_id) !== userId ||
    Number(reservation.property_id) !== propertyId
  ) {
    throw new HoldingStateError(
      "The legal document no longer matches the investor's current holding.",
    );
  }
  if (
    reservation.status !== "converted_to_investment" ||
    (hasFunnelStage && reservation.funnel_stage !== "confirmed")
  ) {
    throw new HoldingStateError(
      "Local signing is suspended because this holding is not currently confirmed and active.",
    );
  }
  return reservation;
}

function hasDocumentSigningHistory(document: LegalDocumentRow): boolean {
  return Boolean(
    document.signing_provider ||
    document.signing_envelope_id ||
    document.signed_pdf_key ||
    document.signed_pdf_sha256 ||
    document.signing_certificate_key ||
    document.investor_signed_at ||
    document.sent_for_signature_at ||
    ["signing_in_progress", "investor_signed"].includes(document.status),
  );
}

function hasAcceptedLocalHistory(operation: LocalOperationRow): boolean {
  return Boolean(
    operation.status !== "draft" ||
    operation.consent_version ||
    operation.consent_text ||
    operation.accepted_at ||
    operation.reauthenticated_at ||
    operation.evidence_snapshot ||
    operation.evidence_sha256 ||
    operation.signature_png_base64 ||
    operation.signature_sha256 ||
    operation.signed_pdf_sha256 ||
    operation.certificate_sha256 ||
    operation.completed_at ||
    operation.lease_token ||
    operation.lease_until,
  );
}

/**
 * Called by the inventory cancellation transaction before changing a confirmed
 * reservation's status. Only a truly unsigned draft can be suspended: source
 * snapshots, unsigned files, legal history and all accepted/signed artifacts
 * remain untouched. Queued/leased jobs are blocked and readiness, artifact
 * persistence, notification, and signing paths recheck the active holding.
 * Pair status is deliberately unchanged so an audited reinstatement does not
 * rewrite approval history; a reinstated investor must obtain a fresh challenge.
 * The reservation lock serializes this policy with signing and worker actions.
 */
export async function recordUnsignedLegalCancellation(
  executor: SqlExecutor,
  reservationIdValue: number,
  adminIdValue: number,
): Promise<UnsignedLegalCancellationResult> {
  const reservationId = positiveId(reservationIdValue, "Reservation ID");
  const adminId = positiveId(adminIdValue, "Administrator ID");
  const reservation = rows<{ id: number; user_id: number | string | null; property_id: number | string }>(
    await executor.execute(sql`
      SELECT id, user_id, property_id
      FROM investment_reservations
      WHERE id = ${reservationId}
      FOR UPDATE
    `),
  )[0];
  if (!reservation) throw new HoldingStateError("Holding not found.", 404);

  if (!await tableExists(executor, "legal_document_pairs")) {
    return {
      reservationId,
      pairIds: [],
      clearedDraftChallenges: 0,
      fencedJobs: 0,
      policy: "unsigned_signing_suspended",
    };
  }

  const pairReferences = rows<LegalPairRow>(await executor.execute(sql`
    SELECT id, user_id, property_id
    FROM legal_document_pairs
    WHERE reservation_id = ${reservationId}
    ORDER BY id
  `));
  if (pairReferences.length === 0) {
    return {
      reservationId,
      pairIds: [],
      clearedDraftChallenges: 0,
      fencedJobs: 0,
      policy: "unsigned_signing_suspended",
    };
  }
  if (!pairReferences.every((pair) =>
    Number(pair.user_id) === Number(reservation.user_id) &&
    Number(pair.property_id) === Number(reservation.property_id)
  )) {
    throw new HoldingStateError(
      "Legal approval history does not match the holding owner and property; ordinary cancellation is blocked.",
    );
  }
  await assertActiveConfirmedHolding(executor, {
    reservationId,
    userId: Number(reservation.user_id),
    propertyId: Number(reservation.property_id),
  });
  if (!await tableExists(executor, "legal_audit_events")) {
    throw new HoldingStateError(
      "Legal cancellation audit history is unavailable; ordinary cancellation is blocked.",
      503,
    );
  }

  const hasDocuments = await tableExists(executor, "legal_documents");
  const hasJobs = await tableExists(executor, "legal_jobs");
  const hasNotificationCycles = await tableExists(executor, "legal_notification_cycles");
  const hasLocalOperations = await tableExists(executor, "local_legal_signing_operations");
  const hasLegacyOperations = await tableExists(executor, "legal_signing_operations");
  let clearedDraftChallenges = 0;
  let fencedJobs = 0;
  const fencedJobsByPair = new Map<number, number>();

  // Fence queued and leased work before taking pair/document locks. The job
  // claim path locks a job before changing its pair; this order avoids a
  // cancellation/claim deadlock. Workers also recheck the holding before they
  // persist an unsigned artifact, mark a pair ready, or start an email send.
  if (hasJobs) {
    for (const pair of pairReferences) {
      const fenced = rows<{ id: number }>(await executor.execute(sql`
        UPDATE legal_jobs
        SET status = 'blocked',
            lease_token = NULL,
            leased_until = NULL,
            last_error = 'Holding cancellation suspended legal work',
            updated_at = now()
        WHERE pair_id = ${Number(pair.id)}
          AND status IN ('queued', 'retry', 'leased')
        RETURNING id
      `));
      fencedJobs += fenced.length;
      fencedJobsByPair.set(Number(pair.id), fenced.length);
    }
  }

  const pairs = rows<LegalPairRow>(await executor.execute(sql`
    SELECT id, user_id, property_id
    FROM legal_document_pairs
    WHERE reservation_id = ${reservationId}
    ORDER BY id
    FOR UPDATE
  `));
  if (!pairs.every((pair) =>
    Number(pair.user_id) === Number(reservation.user_id) &&
    Number(pair.property_id) === Number(reservation.property_id)
  )) {
    throw new HoldingStateError(
      "Legal approval history changed or no longer matches the holding; ordinary cancellation is blocked.",
    );
  }

  for (const pair of pairs) {
    const pairId = Number(pair.id);
    const documents = hasDocuments
      ? rows<LegalDocumentRow>(await executor.execute(sql`
          SELECT * FROM legal_documents
          WHERE pair_id = ${pairId}
          ORDER BY id
          FOR UPDATE
        `))
      : [];
    if (documents.some(hasDocumentSigningHistory)) {
      throw new HoldingStateError(
        "This holding has active or completed legal signing history. Ordinary cancellation is blocked; a separate legal correction process is required.",
      );
    }

    if (hasLegacyOperations) {
      for (const document of documents) {
        const legacyOperationExists = rows<{ exists: boolean }>(await executor.execute(sql`
          SELECT EXISTS(
            SELECT 1 FROM legal_signing_operations WHERE document_id = ${document.id}
          ) AS exists
        `))[0]?.exists;
        if (legacyOperationExists) {
          throw new HoldingStateError(
            "This holding has historical external signing activity. Ordinary cancellation is blocked; a separate legal correction process is required.",
          );
        }
      }
    }

    const acceptedLocalAuditExists = rows<{ exists: boolean }>(await executor.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM legal_audit_events
        WHERE pair_id = ${pairId}
          AND event_type IN ('local_signing_consent_accepted', 'local_signing_completed')
      ) AS exists
    `))[0]?.exists;
    if (acceptedLocalAuditExists) {
      throw new HoldingStateError(
        "This holding has accepted or completed local-signing audit history. Ordinary cancellation is blocked; a separate legal correction process is required.",
      );
    }

    const localOperations = hasLocalOperations
      ? rows<LocalOperationRow>(await executor.execute(sql`
          SELECT * FROM local_legal_signing_operations
          WHERE pair_id = ${pairId}
          ORDER BY id
          FOR UPDATE
        `))
      : [];
    if (localOperations.some(hasAcceptedLocalHistory)) {
      throw new HoldingStateError(
        "This holding has accepted local-signing consent or activity. Ordinary cancellation is blocked; a separate legal correction process is required.",
      );
    }

    if (hasNotificationCycles) {
      const sendingCycle = rows<{ id: number }>(await executor.execute(sql`
        SELECT id
        FROM legal_notification_cycles
        WHERE pair_id = ${pairId} AND status = 'sending'
        ORDER BY id
        FOR UPDATE
      `))[0];
      if (sendingCycle) {
        throw new HoldingStateError(
          "A legal notification is currently being delivered. Retry cancellation after that external action finishes.",
        );
      }
    }

    let pairClearedDraftChallenges = 0;
    if (hasLocalOperations) {
      const cleared = rows<{ id: number }>(await executor.execute(sql`
        UPDATE local_legal_signing_operations
        SET challenge_hash = NULL,
            challenge_expires_at = NULL,
            updated_at = now()
        WHERE pair_id = ${pairId}
          AND status = 'draft'
          AND accepted_at IS NULL
          AND reauthenticated_at IS NULL
          AND evidence_snapshot IS NULL
          AND evidence_sha256 IS NULL
          AND signature_png_base64 IS NULL
          AND signature_sha256 IS NULL
          AND signed_pdf_sha256 IS NULL
          AND certificate_sha256 IS NULL
          AND completed_at IS NULL
        RETURNING id
      `));
      pairClearedDraftChallenges = cleared.length;
      clearedDraftChallenges += pairClearedDraftChallenges;
    }

    await executor.execute(sql`
      INSERT INTO legal_audit_events
        (pair_id, reservation_id, actor_type, actor_id, event_type, details)
      VALUES (
        ${pairId}, ${reservationId}, 'admin', ${adminId},
        'legal_unsigned_signing_suspended_by_holding_cancellation',
        ${JSON.stringify({
          policy: "unsigned_signing_suspended",
          clearedDraftChallenges: pairClearedDraftChallenges,
          fencedJobs: fencedJobsByPair.get(pairId) || 0,
          unsignedSourceSnapshotsPreserved: true,
          unsignedFilesPreserved: true,
          acceptedOrSignedHistoryChanged: false,
        })}::jsonb
      )
    `);
  }

  return {
    reservationId,
    pairIds: pairs.map((pair) => Number(pair.id)),
    clearedDraftChallenges,
    fencedJobs,
    policy: "unsigned_signing_suspended",
  };
}