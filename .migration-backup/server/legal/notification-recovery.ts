import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { assertActiveConfirmedHolding } from "./holding-state";
import { hasOutstandingLegalSignature } from "./invitation-state";
import { requireExactPdfApproval } from "./pdf-review";
import type { LegalJobClaim } from "./repository";

export type NotificationRecoveryInput = {
  pairId: number;
  propertyId: number;
  jobId: number;
  cycleId: number;
  adminId: number;
};
export type NotificationRecoveryResult = {
  state: "accepted" | "waiting_retry" | "retry" | "in_progress" | "blocked_uncertain" | "blocked" | "maintenance";
  message: string;
  availableAt?: string;
  jobId?: number;
  cycleId?: number;
};
type RecoveryRow = {
  jobId: number; cycleId: number; jobStatus: string; cycleStatus: string;
  availableAt: Date | string; eligible: boolean; lastError: string | null;
};
const rows = (result: any): any[] => result.rows || [];
const selectedJob = (input: NotificationRecoveryInput) => sql`
  SELECT j.id AS "jobId", c.id AS "cycleId", j.status AS "jobStatus",
    c.status AS "cycleStatus", j.available_at AS "availableAt",
    j.available_at <= now() AS eligible, j.last_error AS "lastError"
  FROM legal_jobs j
  JOIN legal_notification_cycles c ON c.id=j.notification_cycle_id AND c.pair_id=j.pair_id
  JOIN legal_document_pairs p ON p.id=j.pair_id
  WHERE j.id=${input.jobId} AND j.pair_id=${input.pairId} AND j.kind='notify'
    AND c.id=${input.cycleId} AND p.property_id=${input.propertyId}`;

function validateInput(input: NotificationRecoveryInput) {
  if (![input.pairId, input.propertyId, input.jobId, input.cycleId, input.adminId]
    .every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Exact property, pair, notification job, cycle and administrator IDs are required");
  }
}

function describe(row: RecoveryRow): NotificationRecoveryResult {
  const identity = { jobId: row.jobId, cycleId: row.cycleId };
  if (row.cycleStatus === "sent") return { ...identity, state: "accepted",
    message: "The mail provider accepted this notification. No additional invitation was sent. Inbox delivery is not confirmed." };
  if (["sending", "uncertain"].includes(row.cycleStatus)) return { ...identity, state: "blocked_uncertain",
    message: "A prior send is unresolved or uncertain. No recovery send is permitted; reconcile its recorded outcome first." };
  if (row.jobStatus === "leased") return { ...identity, state: "in_progress",
    message: "This notification has a retained worker lease. No lease was reset or reclaimed; inspect its outcome before recovery." };
  if (!["queued", "retry"].includes(row.jobStatus) || !["queued", "failed"].includes(row.cycleStatus)) {
    return { ...identity, state: "blocked",
      message: `This existing notification cannot be recovered (${row.jobStatus}/${row.cycleStatus}).${row.lastError ? ` Last failure: ${row.lastError}` : ""} No new invitation was created.` };
  }
  const availableAt = new Date(row.availableAt).toISOString();
  if (!row.eligible) return { ...identity, state: "waiting_retry", availableAt,
    message: `Retry is not eligible until ${availableAt}. No backoff was changed.${row.lastError ? ` Last failure: ${row.lastError}` : ""}` };
  return { ...identity, state: "retry", availableAt,
    message: `The existing notification remains eligible for recovery.${row.lastError ? ` Last failure: ${row.lastError}` : ""} Use Recover existing notification; no automatic scheduled recovery is implied.` };
}

export async function getNotificationRecoveryStatus(input: NotificationRecoveryInput): Promise<NotificationRecoveryResult> {
  validateInput(input);
  const row = rows(await db.execute(selectedJob(input)))[0] as RecoveryRow | undefined;
  if (!row) throw Object.assign(new Error("The selected notification no longer matches this property, pair and cycle. Refresh its history."), { statusCode: 404 });
  return describe(row);
}

/** Claim only the exact existing job/cycle. Never resets backoff, leases or creates a cycle. */
export async function claimExistingLegalNotification(input: NotificationRecoveryInput): Promise<
  NotificationRecoveryResult | { state: "claimed"; claim: LegalJobClaim }
> {
  validateInput(input);
  return db.transaction(async tx => {
    const reference = rows(await tx.execute(sql`SELECT reservation_id,user_id,property_id
      FROM legal_document_pairs WHERE id=${input.pairId} AND property_id=${input.propertyId}`))[0];
    if (!reference) throw Object.assign(new Error("Legal document pair not found in this property"), { statusCode: 404 });
    await assertActiveConfirmedHolding(tx, { reservationId: Number(reference.reservation_id),
      userId: Number(reference.user_id), propertyId: input.propertyId });
    const pair = rows(await tx.execute(sql`SELECT reservation_id,user_id,property_id,status,documents_ready_at,data_snapshot
      FROM legal_document_pairs WHERE id=${input.pairId} AND property_id=${input.propertyId} FOR UPDATE`))[0];
    if (!pair || pair.reservation_id !== reference.reservation_id || pair.user_id !== reference.user_id) {
      throw new Error("Holding identity changed. Refresh this holding before recovery.");
    }
    const row = rows(await tx.execute(sql`${selectedJob(input)} FOR UPDATE OF j,c`))[0] as RecoveryRow | undefined;
    if (!row) throw Object.assign(new Error("The selected notification no longer matches this property, pair and cycle. Refresh its history."), { statusCode: 404 });
    const status = describe(row);
    if (status.state !== "retry") return status;
    if (!pair.documents_ready_at || pair.status === "investor_signed" ||
        !await hasOutstandingLegalSignature(tx, input.pairId)) {
      throw new Error("Both PDFs must be ready with an outstanding investor signature before notification recovery.");
    }
    await requireExactPdfApproval(tx, input.pairId);
    // Preserve the current legal consideration safety gate before consuming a
    // recovery retry. Corrected, reviewed document revisions may carry the
    // recorded amount even when the retained original snapshot does not.
    const documents = rows(await tx.execute(sql`SELECT d.* FROM legal_documents d
      WHERE pair_id=${input.pairId} FOR UPDATE`)).filter(document => document.superseded_at == null);
    if (!pair.data_snapshot?.landConsiderationNaira &&
        !(documents.length === 2 && documents.every(document => document.consideration_amount_naira != null))) {
      return { state: "blocked" as const, jobId: input.jobId, cycleId: input.cycleId,
        message: "These existing PDFs have no recorded land-only consideration. Legal signing is held until historical purchase costs are verified and any required document correction is separately authorized and reviewed. No recovery job was claimed, retry changed or invitation sent." };
    }
    const leaseToken = randomUUID();
    const claim = rows(await tx.execute(sql`UPDATE legal_jobs
      SET status='leased',attempts=attempts+1,lease_token=${leaseToken},
        leased_until=now()+interval '5 minutes',updated_at=now()
      WHERE id=${input.jobId} AND pair_id=${input.pairId} AND kind='notify'
        AND notification_cycle_id=${input.cycleId}
        AND status IN ('queued','retry') AND available_at<=now()
      RETURNING id,pair_id AS "pairId",kind,lease_token AS "leaseToken",attempts,
        notification_cycle_id AS "notificationCycleId"`))[0] as LegalJobClaim | undefined;
    if (!claim) throw new Error("Notification eligibility changed. No job was claimed.");
    await tx.execute(sql`INSERT INTO legal_audit_events(pair_id,reservation_id,actor_type,actor_id,event_type,details)
      VALUES (${input.pairId},${Number(reference.reservation_id)},'admin',${input.adminId},
        'notification_bounded_recovery_requested',
        ${JSON.stringify({ jobId: input.jobId, notificationCycleId: input.cycleId })}::jsonb)`);
    return { state: "claimed" as const, claim };
  });
}