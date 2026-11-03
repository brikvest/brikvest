import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  enqueueLegalApproval,
  recordLegalApprovalBlock,
  type EnqueueLegalApprovalResult,
} from "./repository";
import { HoldingStateError, recordUnsignedLegalCancellation } from "./holding-state";
import { hasGatewayPaymentConflict, assertGatewayCancellationSafe } from "../payments/gateway-guards";

interface DbRow {
  [key: string]: any;
}

export class LegalApprovalTransitionError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number = 409,
  ) {
    super(message);
    this.name = "LegalApprovalTransitionError";
  }
}

export interface ManualFullPaymentAttestation {
  fullPaymentConfirmed: true;
  amountNaira: string;
  currency: string;
  auditNote: string;
}

export interface ApprovalTransitionResult {
  reservationId: number;
  userId: number | null;
  propertyId: number;
  units: string;
  legal: EnqueueLegalApprovalResult;
}

export interface ConfirmedCancellationResult {
  reservationId: number;
  userId: number | null;
  propertyId: number;
  units: string;
  legalCancellation: Awaited<ReturnType<typeof recordUnsignedLegalCancellation>>;
}

function rows<T>(result: unknown): T[] {
  const data = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(data) ? data : [];
}

function requireWholeUnitInventoryCount(unitsValue: unknown): void {
  const units = Number(unitsValue);
  if (Number.isFinite(units) && !Number.isInteger(units)) {
    throw new LegalApprovalTransitionError(
      "Fractional units cannot be approved because property inventory counters store whole units. " +
        "No payment, reservation, or inventory changes were made; use a whole-unit reservation " +
        "until fractional inventory accounting is supported.",
      409,
    );
  }
}

async function getReservedInventoryContribution(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    propertyId: number;
    reservationId: number;
    units: string;
    propertyReservedUnits: unknown;
  },
): Promise<{ units: number; sideLedgerInstalled: boolean }> {
  const units = Number(input.units);
  const sideLedgerInstalled = rows<{ installed: boolean }>(await tx.execute(sql`
    SELECT to_regclass('public.investment_reservation_inventory') IS NOT NULL AS installed
  `))[0]?.installed === true;
  if (sideLedgerInstalled) {
    const ownContribution = rows<{ units: string }>(await tx.execute(sql`
      SELECT reserved_units::numeric::text AS units
      FROM investment_reservation_inventory
      WHERE reservation_id = ${input.reservationId}
    `))[0];
    const reservedUnits = Number(ownContribution?.units ?? 0);
    if (!Number.isFinite(reservedUnits) || reservedUnits < 0) {
      throw new LegalApprovalTransitionError("Reservation inventory provenance is invalid", 409);
    }
    if (reservedUnits > 0) {
      if (reservedUnits !== units) {
        throw new LegalApprovalTransitionError(
          "Reservation inventory provenance no longer matches this holding",
          409,
        );
      }
      return { units: reservedUnits, sideLedgerInstalled };
    }
  }

  // Legacy reservations predate per-reservation provenance. Only release their
  // counter contribution when the aggregate untracked counter demonstrably
  // covers every active legacy holding; otherwise leave the counter untouched
  // rather than consuming units reserved for a different reservation.
  const legacyReservations = sideLedgerInstalled
    ? rows<{ units: string }>(await tx.execute(sql`
        SELECT r.units::numeric::text AS units
        FROM investment_reservations r
        WHERE r.property_id = ${input.propertyId}
          AND r.status IN ('reserved', 'payment_pending')
          AND NOT EXISTS (
            SELECT 1 FROM investment_reservation_inventory i
            WHERE i.reservation_id = r.id AND i.reserved_units > 0
          )
        ORDER BY r.id
        FOR UPDATE OF r
      `))
    : rows<{ units: string }>(await tx.execute(sql`
        SELECT r.units::numeric::text AS units
        FROM investment_reservations r
        WHERE r.property_id = ${input.propertyId}
          AND r.status IN ('reserved', 'payment_pending')
        ORDER BY r.id
        FOR UPDATE OF r
      `));
  const tracked = sideLedgerInstalled
    ? rows<{ units: string }>(await tx.execute(sql`
        SELECT COALESCE(sum(i.reserved_units), 0)::numeric::text AS units
        FROM investment_reservation_inventory i
        JOIN investment_reservations r ON r.id = i.reservation_id
        WHERE r.property_id = ${input.propertyId}
          AND r.status IN ('reserved', 'payment_pending')
          AND i.reserved_units > 0
      `))[0]
    : undefined;
  const legacyDemand = legacyReservations.reduce((sum, row) => sum + Number(row.units), 0);
  const untrackedCounter = Number(input.propertyReservedUnits) - Number(tracked?.units ?? 0);
  return {
    units: untrackedCounter >= legacyDemand && untrackedCounter >= units ? units : 0,
    sideLedgerInstalled,
  };
}

async function clearReservedInventoryContribution(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  reservationId: number,
  sideLedgerInstalled: boolean,
): Promise<void> {
  if (!sideLedgerInstalled) return;
  await tx.execute(sql`
    UPDATE investment_reservation_inventory
    SET reserved_units = 0, updated_at = now()
    WHERE reservation_id = ${reservationId}
  `);
}

async function enqueueManualLegalApproval(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  reservationId: number,
  adminId: number,
  source: "admin_full_confirmation" | "admin_reinstate",
  attestation?: ManualFullPaymentAttestation,
): Promise<EnqueueLegalApprovalResult> {
  const legal = await enqueueLegalApproval(tx, {
    reservationId,
    source,
    sourceId: reservationId,
    adminId,
    confirmedFullPayment: attestation?.fullPaymentConfirmed,
    assertedAmountNaira: attestation?.amountNaira,
    assertedCurrency: attestation?.currency,
    approvalNote: attestation?.auditNote,
  });
  if (!legal.eligible) {
    await recordLegalApprovalBlock(tx, {
      reservationId,
      adminId,
      source,
      sourceId: reservationId,
      reason: legal.reason || "not_eligible",
      details: {
        fullPaymentConfirmed: attestation?.fullPaymentConfirmed ?? false,
        assertedAmountNaira: attestation?.amountNaira ?? null,
        assertedCurrency: attestation?.currency ?? null,
        auditNote: attestation?.auditNote ?? null,
      },
    });
  }
  return legal;
}

/**
 * Atomically approves a user-submitted payment, converts its reservation,
 * updates unit counters, and records a legal generation outbox job if the
 * approved submission is a full NGN purchase.
 */
export async function approvePaymentSubmissionAtomically(
  submissionId: number,
  adminId: number,
): Promise<ApprovalTransitionResult> {
  return db.transaction(async (tx) => {
    // Reservation/property precede evidence locks in expiry, gateway verification
    // and every review, avoiding the inverse evidence -> holding lock order.
    await tx.execute(sql`
      SELECT r.id FROM investment_reservations r JOIN properties p ON p.id=r.property_id
      WHERE r.id=(SELECT reservation_id FROM payment_submissions WHERE id=${submissionId})
      FOR UPDATE OF r,p
    `);
    const submission = rows<DbRow>(await tx.execute(sql`
      SELECT id, reservation_id AS "reservationId", user_id AS "userId",
        amount::numeric::text AS amount, currency, status
      FROM payment_submissions
      WHERE id = ${submissionId}
      FOR UPDATE
    `))[0];
    if (!submission) throw new LegalApprovalTransitionError("Payment submission not found", 404);
    if (submission.status !== "pending_admin_review") {
      throw new LegalApprovalTransitionError("This submission has already been processed", 400);
    }

    const holding = rows<DbRow>(await tx.execute(sql`
      SELECT r.id, r.user_id AS "userId", r.property_id AS "propertyId",
        r.units::numeric::text AS units, r.amount::numeric::text AS amount,
        r.currency, r.status, p.id AS "lockedPropertyId",
        p.reserved_units AS "reservedUnits",
        u.kyc_status AS "kycStatus"
      FROM investment_reservations r
      JOIN properties p ON p.id = r.property_id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = ${submission.reservationId}
      FOR UPDATE OF r, p
    `))[0];
    if (!holding) throw new LegalApprovalTransitionError("Associated reservation not found", 404);
    if (await hasGatewayPaymentConflict(tx, Number(holding.id))) {
      throw new LegalApprovalTransitionError("A collected gateway payment requires review in Payment Reviews; manual proof cannot approve it.");
    }
    if (Number(holding.userId) !== Number(submission.userId)) {
      throw new LegalApprovalTransitionError("Payment submission does not belong to the reservation owner", 400);
    }
    if (holding.status !== "reserved") {
      throw new LegalApprovalTransitionError(
        `Reservation is in '${holding.status}' state, cannot approve payment.`,
        400,
      );
    }
    const verifiedUser = holding.userId
      ? rows<DbRow>(await tx.execute(sql`
          SELECT id FROM users
          WHERE id = ${holding.userId} AND kyc_status = 'approved'
          FOR UPDATE
        `))[0]
      : undefined;
    if (!verifiedUser) {
      throw new LegalApprovalTransitionError(
        "KYC must be approved before we can validate and allocate units. Please approve user's KYC first.",
        400,
      );
    }
    requireWholeUnitInventoryCount(holding.units);
    const reservedContribution = await getReservedInventoryContribution(tx, {
      reservationId: Number(holding.id),
      propertyId: Number(holding.propertyId),
      units: String(holding.units),
      propertyReservedUnits: holding.reservedUnits,
    });

    const claimedSubmission = rows<DbRow>(await tx.execute(sql`
      UPDATE payment_submissions
      SET status = 'approved', reviewed_at = now(), reviewed_by_admin_id = ${adminId}
      WHERE id = ${submissionId} AND status = 'pending_admin_review'
      RETURNING id
    `))[0];
    if (!claimedSubmission) {
      throw new LegalApprovalTransitionError("This submission was just processed by another administrator", 409);
    }
    const converted = rows<DbRow>(await tx.execute(sql`
      UPDATE investment_reservations
      SET status = 'converted_to_investment', funnel_stage = 'confirmed',
          updated_at = now()
      WHERE id = ${submission.reservationId} AND status = 'reserved'
        AND user_id = ${submission.userId}
      RETURNING id
    `))[0];
    if (!converted) {
      throw new LegalApprovalTransitionError("Reservation was just processed by another administrator", 409);
    }
    const inventoryUpdate = reservedContribution.units > 0
      ? rows<DbRow>(await tx.execute(sql`
          UPDATE properties
          SET reserved_units = reserved_units - ${reservedContribution.units}::numeric,
              sold_units = sold_units + ${holding.units}::numeric
          WHERE id = ${holding.propertyId}
            AND reserved_units >= ${reservedContribution.units}::numeric
          RETURNING id
        `))[0]
      : rows<DbRow>(await tx.execute(sql`
          UPDATE properties
          SET sold_units = sold_units + ${holding.units}::numeric
          WHERE id = ${holding.propertyId}
          RETURNING id
        `))[0];
    if (!inventoryUpdate) {
      throw new LegalApprovalTransitionError("Reserved unit counts no longer match this holding", 409);
    }
    await clearReservedInventoryContribution(
      tx,
      Number(holding.id),
      reservedContribution.sideLedgerInstalled,
    );

    const legal = await enqueueLegalApproval(tx, {
      reservationId: Number(submission.reservationId),
      source: "payment_submission",
      sourceId: submissionId,
      adminId,
    });
    if (!legal.eligible) {
      await recordLegalApprovalBlock(tx, {
        reservationId: Number(submission.reservationId),
        adminId,
        source: "payment_submission",
        sourceId: submissionId,
        reason: legal.reason || "not_eligible",
        details: {
          paymentAmount: submission.amount,
          paymentCurrency: submission.currency,
        },
      });
    }
    return {
      reservationId: Number(submission.reservationId),
      userId: Number(submission.userId),
      propertyId: Number(holding.propertyId),
      units: String(holding.units),
      legal,
    };
  });
}

/** Unconfirmed cancellation shares holding/property locks with verification.
 * All inventory release is in this transaction, never a follow-on delta call. */
export async function cancelUnconfirmedInvestmentAtomically(reservationId: number): Promise<void> {
  await db.transaction(async tx => {
    const holding = rows<DbRow>(await tx.execute(sql`
      SELECT r.id,r.property_id AS "propertyId",r.units::numeric::text AS units,r.status,
        p.reserved_units AS "reservedUnits"
      FROM investment_reservations r JOIN properties p ON p.id=r.property_id
      WHERE r.id=${reservationId} FOR UPDATE OF r,p`))[0];
    if (!holding) throw new LegalApprovalTransitionError("Reservation not found",404);
    if (!["reserved","payment_pending"].includes(holding.status)) {
      throw new LegalApprovalTransitionError("Only active unconfirmed reservations can use this cancellation path.");
    }
    await assertGatewayCancellationSafe(tx,reservationId);
    requireWholeUnitInventoryCount(holding.units);
    const contribution = await getReservedInventoryContribution(tx, {
      reservationId,propertyId:Number(holding.propertyId),units:String(holding.units),propertyReservedUnits:holding.reservedUnits,
    });
    await tx.execute(sql`UPDATE investment_reservations SET status='cancelled',funnel_stage=NULL,updated_at=now() WHERE id=${reservationId}`);
    await tx.execute(sql`UPDATE properties SET
      reserved_units=reserved_units-${contribution.units}::numeric,
      available_slots=CASE WHEN total_slots>0 THEN available_slots+${holding.units}::numeric ELSE available_slots END
      WHERE id=${holding.propertyId}`);
    await clearReservedInventoryContribution(tx,reservationId,contribution.sideLedgerInstalled);
  });
}

/** Admin full confirmation requires an independently submitted, audited
 * full-NGN-payment attestation for legal generation, checked against the holding. */
export async function confirmInvestmentAtomically(
  reservationId: number,
  adminId: number,
  attestation?: ManualFullPaymentAttestation,
): Promise<ApprovalTransitionResult> {
  return db.transaction(tx => confirmInvestmentWithinTransaction(tx, reservationId, adminId, attestation));
}

/** Internal gateway review calls this only after locking and claiming verified evidence. */
export async function confirmInvestmentWithinTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  reservationId: number,
  adminId: number,
  attestation?: ManualFullPaymentAttestation,
  gatewayAttemptId?: number,
): Promise<ApprovalTransitionResult> {
    const holding = rows<DbRow>(await tx.execute(sql`
      SELECT r.id, r.user_id AS "userId", r.property_id AS "propertyId",
        r.units::numeric::text AS units, r.amount::numeric::text AS amount,
        r.currency, r.status, p.reserved_units AS "reservedUnits",
        u.kyc_status AS "kycStatus"
      FROM investment_reservations r
      JOIN properties p ON p.id = r.property_id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = ${reservationId}
      FOR UPDATE OF r, p
    `))[0];
    if (!holding) throw new LegalApprovalTransitionError("Reservation not found", 404);
    if (!gatewayAttemptId && await hasGatewayPaymentConflict(tx, reservationId)) {
      throw new LegalApprovalTransitionError("Review the collected gateway payment in Payment Reviews instead of manual confirmation.");
    }
    if (holding.status === "converted_to_investment") {
      throw new LegalApprovalTransitionError("This reservation is already a confirmed investment.", 400);
    }
    if (holding.status === "expired" || holding.status === "cancelled") {
      throw new LegalApprovalTransitionError("Expired or cancelled reservations must be reinstated.", 400);
    }
    if (holding.userId) {
      const verifiedUser = rows<DbRow>(await tx.execute(sql`
        SELECT id FROM users
        WHERE id = ${holding.userId} AND kyc_status = 'approved'
        FOR UPDATE
      `))[0];
      if (!verifiedUser) {
        throw new LegalApprovalTransitionError("Cannot confirm investment. User KYC must be approved first.", 400);
      }
    }
    requireWholeUnitInventoryCount(holding.units);
    const reservedContribution = await getReservedInventoryContribution(tx, {
      reservationId: Number(holding.id),
      propertyId: Number(holding.propertyId),
      units: String(holding.units),
      propertyReservedUnits: holding.reservedUnits,
    });
    const converted = rows<DbRow>(await tx.execute(sql`
      UPDATE investment_reservations
      SET status = 'converted_to_investment', funnel_stage = 'confirmed',
          updated_at = now()
      WHERE id = ${reservationId} AND status IN ('reserved', 'payment_pending')
      RETURNING id
    `))[0];
    if (!converted) {
      throw new LegalApprovalTransitionError("Reservation was just confirmed by another administrator", 409);
    }
    const inventoryUpdate = reservedContribution.units > 0
      ? rows<DbRow>(await tx.execute(sql`
          UPDATE properties
          SET reserved_units = reserved_units - ${reservedContribution.units}::numeric,
              sold_units = sold_units + ${holding.units}::numeric
          WHERE id = ${holding.propertyId}
            AND reserved_units >= ${reservedContribution.units}::numeric
          RETURNING id
        `))[0]
      : rows<DbRow>(await tx.execute(sql`
          UPDATE properties
          SET sold_units = sold_units + ${holding.units}::numeric
          WHERE id = ${holding.propertyId}
          RETURNING id
        `))[0];
    if (!inventoryUpdate) {
      throw new LegalApprovalTransitionError("Reserved unit counts no longer match this holding", 409);
    }
    await clearReservedInventoryContribution(
      tx,
      Number(holding.id),
      reservedContribution.sideLedgerInstalled,
    );
    const legal = await enqueueManualLegalApproval(
      tx,
      reservationId,
      adminId,
      "admin_full_confirmation",
      attestation,
    );
    return {
      reservationId,
      userId: holding.userId == null ? null : Number(holding.userId),
      propertyId: Number(holding.propertyId),
      units: String(holding.units),
      legal,
    };
}

/**
 * Admin reinstatement of an expired/cancelled holding. Reclaims the reservation
 * under a row lock, checks current inventory, adjusts counters, then writes the
 * manual-payment provenance and legal job in the same commit.
 */
export async function reinstateInvestmentAtomically(
  reservationId: number,
  adminId: number,
  paymentReference: string,
  paymentMethod: string,
  reinstateNote: string,
  attestation?: ManualFullPaymentAttestation,
): Promise<ApprovalTransitionResult> {
  return db.transaction(async (tx) => {
    const holding = rows<DbRow>(await tx.execute(sql`
      SELECT r.id, r.user_id AS "userId", r.property_id AS "propertyId",
        r.units::numeric::text AS units, r.amount::numeric::text AS amount,
        r.currency, r.status, r.notes, r.payment_reference AS "paymentReference",
        r.payment_method AS "paymentMethod", u.kyc_status AS "kycStatus",
        p.total_slots AS "totalSlots", p.available_slots AS "availableSlots",
        p.total_units AS "totalUnits", p.reserved_units AS "reservedUnits",
        p.sold_units AS "soldUnits"
      FROM investment_reservations r
      JOIN properties p ON p.id = r.property_id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = ${reservationId}
      FOR UPDATE OF r, p
    `))[0];
    if (!holding) throw new LegalApprovalTransitionError("Reservation not found", 404);
    if (await hasGatewayPaymentConflict(tx, reservationId)) {
      throw new LegalApprovalTransitionError("A collected gateway payment must be reconciled before reinstatement.");
    }
    if (holding.status === "converted_to_investment") {
      throw new LegalApprovalTransitionError("This reservation is already a confirmed investment.", 400);
    }
    if (holding.status !== "expired" && holding.status !== "cancelled") {
      throw new LegalApprovalTransitionError(
        "Only expired or cancelled reservations can be reinstated. Use Confirm for active reservations.",
        400,
      );
    }
    if (holding.userId) {
      const verifiedUser = rows<DbRow>(await tx.execute(sql`
        SELECT id FROM users
        WHERE id = ${holding.userId} AND kyc_status = 'approved'
        FOR UPDATE
      `))[0];
      if (!verifiedUser) {
        throw new LegalApprovalTransitionError("Cannot reinstate. User KYC must be approved first.", 400);
      }
    }
    const units = Number(holding.units);
    const available = Number(holding.totalSlots) > 0
      ? Number(holding.availableSlots || 0)
      : Number(holding.totalUnits || 0) - Number(holding.reservedUnits || 0) - Number(holding.soldUnits || 0);
    if (!Number.isFinite(units) || units <= 0) {
      throw new LegalApprovalTransitionError("Reservation has an invalid unit count", 400);
    }
    requireWholeUnitInventoryCount(holding.units);
    if (units > available) {
      throw new LegalApprovalTransitionError(
        `Not enough units available to reinstate. Only ${available} unit(s) remain.`,
        400,
      );
    }
    const claimed = rows<DbRow>(await tx.execute(sql`
      UPDATE investment_reservations
      SET status = 'converted_to_investment', funnel_stage = 'confirmed',
          expires_at = NULL, payment_reference = ${paymentReference},
          payment_method = ${paymentMethod}, notes = ${reinstateNote},
          updated_at = now()
      WHERE id = ${reservationId} AND status IN ('expired', 'cancelled')
      RETURNING id
    `))[0];
    if (!claimed) {
      throw new LegalApprovalTransitionError("This reservation was just reinstated by another request.", 409);
    }
    const inventoryUpdate = rows<DbRow>(await tx.execute(sql`
      UPDATE properties
      SET sold_units = sold_units + ${holding.units}::numeric,
          available_slots = CASE WHEN total_slots > 0
            THEN available_slots - ${holding.units}::numeric ELSE available_slots END
      WHERE id = ${holding.propertyId}
        AND (
          (total_slots > 0 AND available_slots >= ${holding.units}::numeric)
          OR
          (COALESCE(total_slots, 0) <= 0
            AND total_units - reserved_units - sold_units >= ${holding.units}::numeric)
        )
      RETURNING id
    `))[0];
    if (!inventoryUpdate) {
      throw new LegalApprovalTransitionError("Property inventory changed before the reservation could be reinstated", 409);
    }
    const sideLedgerInstalled = rows<{ installed: boolean }>(await tx.execute(sql`
      SELECT to_regclass('public.investment_reservation_inventory') IS NOT NULL AS installed
    `))[0]?.installed === true;
    await clearReservedInventoryContribution(tx, reservationId, sideLedgerInstalled);
    const legal = await enqueueManualLegalApproval(
      tx,
      reservationId,
      adminId,
      "admin_reinstate",
      attestation,
    );
    return {
      reservationId,
      userId: holding.userId == null ? null : Number(holding.userId),
      propertyId: Number(holding.propertyId),
      units: String(holding.units),
      legal,
    };
  });
}

/**
 * Atomically cancels a confirmed holding and protects any related local legal
 * documents before inventory changes. The holding lock is acquired first and
 * remains held throughout the legal-history gate and counter transition.
 */
export async function cancelConfirmedInvestmentAtomically(
  reservationId: number,
  adminId: number,
): Promise<ConfirmedCancellationResult> {
  return db.transaction(async (tx) => {
    const holding = rows<DbRow>(await tx.execute(sql`
      SELECT r.id, r.user_id AS "userId", r.property_id AS "propertyId",
        r.units::numeric::text AS units, r.status,
        p.total_slots AS "totalSlots"
      FROM investment_reservations r
      JOIN properties p ON p.id = r.property_id
      WHERE r.id = ${reservationId}
      FOR UPDATE OF r, p
    `))[0];
    if (!holding) throw new LegalApprovalTransitionError("Reservation not found", 404);
    await assertGatewayCancellationSafe(tx, reservationId);
    if (holding.status !== "converted_to_investment") {
      throw new LegalApprovalTransitionError(
        "Only a confirmed investment can use this cancellation path.",
        409,
      );
    }

    const units = Number(holding.units);
    if (!Number.isFinite(units) || units <= 0) {
      throw new LegalApprovalTransitionError("Reservation has an invalid unit count", 409);
    }
    if (!Number.isInteger(units)) {
      throw new LegalApprovalTransitionError(
        "Fractional confirmed holdings cannot be safely cancelled against whole-unit property counters.",
        409,
      );
    }

    let legalCancellation: Awaited<ReturnType<typeof recordUnsignedLegalCancellation>>;
    try {
      legalCancellation = await recordUnsignedLegalCancellation(tx, reservationId, adminId);
    } catch (error) {
      if (error instanceof HoldingStateError) {
        throw new LegalApprovalTransitionError(error.message, error.statusCode);
      }
      throw error;
    }
    const cancelled = rows<DbRow>(await tx.execute(sql`
      UPDATE investment_reservations
      SET status = 'cancelled', funnel_stage = NULL, updated_at = now()
      WHERE id = ${reservationId}
        AND status = 'converted_to_investment'
      RETURNING id
    `))[0];
    if (!cancelled) {
      throw new LegalApprovalTransitionError("This confirmed holding changed before it could be cancelled.", 409);
    }

    const inventoryUpdate = rows<DbRow>(await tx.execute(sql`
      UPDATE properties
      SET sold_units = GREATEST(0, sold_units - ${units}),
          available_slots = CASE WHEN total_slots > 0
            THEN available_slots + ${units} ELSE available_slots END
      WHERE id = ${holding.propertyId}
      RETURNING id
    `))[0];
    if (!inventoryUpdate) {
      throw new LegalApprovalTransitionError("Property inventory could not be updated for cancellation.", 409);
    }

    return {
      reservationId,
      userId: holding.userId == null ? null : Number(holding.userId),
      propertyId: Number(holding.propertyId),
      units: String(holding.units),
      legalCancellation,
    };
  });
}