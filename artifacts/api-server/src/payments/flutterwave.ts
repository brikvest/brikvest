import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { confirmInvestmentWithinTransaction } from "../legal/approval";
import { gatewayInstalled, requireLiveSafeguards, resultRows as rows } from "./gateway-guards";
import { exactAmount, GatewayError, gatewayConfig, gatewayVerificationConfig, providerRequest, safeCheckoutUrl, transactionId } from "./flutterwave-provider";
import { closeQueuedCheckouts, enqueueCheckoutClosure } from "./flutterwave-checkout-closure";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function requireGatewaySchema() {
  if (!await gatewayInstalled(db)) throw new GatewayError("Flutterwave database setup has not been authorized. Bank transfer remains available.", 503);
}
export const safeAttempt = (a: any) => ({
  id: a.id, reservationId: a.reservation_id, txRef: a.tx_ref, state: a.state,
  expectedAmount: a.expected_amount, expectedCurrency: a.expected_currency,
  verifiedAmount: a.verified_amount, verifiedCurrency: a.verified_currency,
  verifiedAt: a.verified_at, reason: a.reason, transactionId: a.provider_transaction_id,
  reviewedAt: a.reviewed_at,
  checkoutExpiresAt: a.checkout_expires_at,
});
async function lockHolding(tx: Tx, reservationId: number) {
  const holding = rows(await tx.execute(sql`
    SELECT r.*, p.name AS property_name, p.location AS property_location
    FROM investment_reservations r JOIN properties p ON p.id=r.property_id
    WHERE r.id=${reservationId} FOR UPDATE OF r,p`))[0];
  if (!holding) throw new GatewayError("Reservation not found.", 404);
  return holding;
}
async function audit(tx: Tx, id: number, event: string, reason?: string, adminId?: number) {
  await tx.execute(sql`INSERT INTO flutterwave_audit(attempt_id,event,reason,admin_id)
    VALUES (${id},${event},${reason ?? null},${adminId ?? null})`);
}
export async function initiateCheckout(reservationId: number, userId: number) {
  const config = gatewayConfig();
  await requireGatewaySchema();
  // Live collection never starts without the owner-installed database guards.
  if (config.mode === "live") await requireLiveSafeguards(db, "investor");
  // Commit the unique reference before the external request. If the process
  // dies or times out, retain an uncertain attempt; never blindly create another.
  const attempt = await db.transaction(async tx => {
    const r = await lockHolding(tx, reservationId);
    if (r.user_id !== userId) throw new GatewayError("Reservation not found.", 404);
    const u = rows(await tx.execute(sql`SELECT * FROM users WHERE id=${userId} FOR UPDATE`))[0];
    if (u?.kyc_status !== "approved" || u?.account_status !== "approved" || !u.is_active) throw new GatewayError("An active account and approved KYC are required.", 403);
    if (r.status !== "reserved" || !r.expires_at || new Date(r.expires_at).getTime() <= Date.now()) throw new GatewayError("This reservation is no longer eligible for checkout.");
    if (!config.currencies.includes(r.currency)) throw new GatewayError(`Flutterwave is not configured for ${r.currency}. Use bank transfer; no currency conversion is performed.`);
    const existing = rows(await tx.execute(sql`SELECT id FROM flutterwave_attempts
      WHERE reservation_id=${reservationId} AND (state NOT IN ('failed','cancelled') OR checkout_expires_at>now()) LIMIT 1`))[0];
    const proof = rows(await tx.execute(sql`SELECT id FROM payment_submissions WHERE reservation_id=${reservationId} AND status IN ('pending_admin_review','approved') LIMIT 1`))[0];
    if (existing || proof) throw new GatewayError("A payment or checkout already needs review. Recheck its status; do not pay again.");
    if (!exactAmount(r.amount, r.amount)) throw new GatewayError("Reservation amount is invalid.");
    const expires = new Date(Math.min(Date.now() + 10 * 60_000, new Date(r.expires_at).getTime()));
    if (expires.getTime() - Date.now() < 60_000) throw new GatewayError("Too little reservation time remains to start checkout.");
    const a = rows(await tx.execute(sql`INSERT INTO flutterwave_attempts
      (reservation_id,user_id,tx_ref,expected_amount,expected_currency,mode,checkout_expires_at)
      VALUES (${reservationId},${userId},${`brk_${randomUUID()}`},${r.amount},${r.currency},${config.mode},${expires})
      RETURNING *`))[0];
    await audit(tx, a.id, "checkout_initiated");
    return { ...a, email: u.email, fullName: r.full_name };
  });
  try {
    const data = await providerRequest("payments", {
      tx_ref: attempt.tx_ref, amount: attempt.expected_amount, currency: attempt.expected_currency,
      redirect_url: `${config.origin}/dashboard?flutterwaveReturn=1`,
      customer: { email: attempt.email, name: attempt.fullName },
      configurations: { session_duration: Math.max(1, Math.floor((new Date(attempt.checkout_expires_at).getTime() - Date.now()) / 60_000)), max_retry_attempt: 3 },
      customizations: { title: "Brikvest reservation — subject to admin approval" },
    });
    const checkoutUrl = safeCheckoutUrl(data.link);
    const canReturn = await db.transaction(async tx => {
      const r = await lockHolding(tx,reservationId);
      const current = rows(await tx.execute(sql`SELECT * FROM flutterwave_attempts WHERE id=${attempt.id} FOR UPDATE`))[0];
      await tx.execute(sql`UPDATE flutterwave_attempts SET checkout_url=${checkoutUrl},updated_at=now() WHERE id=${attempt.id}`);
      const received = rows(await tx.execute(sql`SELECT id FROM flutterwave_attempts WHERE reservation_id=${reservationId}
        AND (verified_at IS NOT NULL OR state IN ('awaiting_admin','reconciliation','rejected','approved')) LIMIT 1`))[0];
      if (current.state !== "initiated" || received || r.status !== "reserved" || new Date(r.expires_at).getTime()<=Date.now()) {
        await enqueueCheckoutClosure(tx,current,checkoutUrl);
        if (!current.verified_at) await tx.execute(sql`UPDATE flutterwave_attempts SET state='reconciliation',
          reason='Checkout withheld: reservation or payment state changed while the provider created the link.',updated_at=now() WHERE id=${current.id}`);
        return false;
      }
      return true;
    });
    if (!canReturn) {
      await closeQueuedCheckouts({ attemptId: attempt.id });
      throw new GatewayError("Checkout has been withheld for reconciliation. Do not make another payment.");
    }
    return { checkoutUrl };
  } catch {
    await db.execute(sql`UPDATE flutterwave_attempts SET state='verification_pending', reason='Checkout creation could not be confirmed. Recheck before making another payment.',updated_at=now() WHERE id=${attempt.id} AND state='initiated'`);
    throw new GatewayError("Checkout creation could not be confirmed. Recheck status; do not pay again.", 503);
  }
}

export async function queueVerification(id: string, ref: string) {
  transactionId(id);
  if (typeof ref !== "string" || ref.length > 100 || !ref) throw new GatewayError("Invalid transaction reference.", 400);
  await db.execute(sql`INSERT INTO flutterwave_verification_jobs(transaction_id,tx_ref)
    VALUES (${id},${ref}) ON CONFLICT(transaction_id) DO UPDATE SET
    status=CASE WHEN flutterwave_verification_jobs.status='done' THEN 'done' ELSE 'queued' END`);
}

export async function verifyTransaction(id: string, claimedRef: string) {
  transactionId(id);
  const data = await providerRequest(`transactions/${id}/verify`);
  if (String(data.id) !== id || typeof data.tx_ref !== "string" || data.tx_ref.length > 100) throw new GatewayError("Provider identity could not be verified.", 503);
  // Verified provider reference is authoritative; an attacker-supplied return
  // cannot attach someone else's charge to a reservation.
  const preview = rows(await db.execute(sql`SELECT * FROM flutterwave_attempts WHERE tx_ref=${data.tx_ref}`))[0];
  await db.transaction(async tx => {
    const holding = preview ? await lockHolding(tx, preview.reservation_id) : null;
    const a = preview ? rows(await tx.execute(sql`SELECT * FROM flutterwave_attempts WHERE id=${preview.id} FOR UPDATE`))[0] : null;
    if (a && a.mode !== gatewayVerificationConfig().mode) throw new GatewayError("Provider mode does not match this checkout.");
    const oldCharge = rows(await tx.execute(sql`SELECT * FROM flutterwave_charges WHERE transaction_id=${id}`))[0];
    // A pending/failed provider result may later become successful.
    if (oldCharge?.provider_status === "successful") {
      await tx.execute(sql`UPDATE flutterwave_verification_jobs SET status='done',updated_at=now() WHERE transaction_id=${id}`);
      return;
    }
    let state = ["failed", "cancelled"].includes(data.status) ? data.status : "verification_pending";
    let reason = state === "failed" ? "The provider reports payment failed." : state === "cancelled" ? "The provider reports payment cancelled." : "Provider verification is pending. Do not pay again.";
    if (data.status === "successful") {
      const u = holding ? rows(await tx.execute(sql`SELECT * FROM users WHERE id=${holding.user_id} FOR UPDATE`))[0] : null;
      const otherCharge = a ? rows(await tx.execute(sql`SELECT transaction_id FROM flutterwave_charges
        WHERE attempt_id IN (SELECT id FROM flutterwave_attempts WHERE reservation_id=${a.reservation_id})
          AND provider_status='successful' AND transaction_id<>${id} LIMIT 1`))[0] : null;
      const manual = a ? rows(await tx.execute(sql`SELECT id FROM payment_submissions WHERE reservation_id=${a.reservation_id} AND status IN ('pending_admin_review','approved') LIMIT 1`))[0] : null;
      const otherOpen = a ? rows(await tx.execute(sql`SELECT * FROM flutterwave_attempts
        WHERE reservation_id=${a.reservation_id} AND id<>${a.id} AND state IN ('initiated','verification_pending')
        ORDER BY id FOR UPDATE`)) : [];
      reason = !a ? "Unmatched provider charge"
        : !exactAmount(data.amount, a.expected_amount) || data.currency !== a.expected_currency ||
          !exactAmount(data.charged_amount, a.expected_amount) ? "Charge amount or currency mismatch"
        : !exactAmount(holding.amount, a.expected_amount) || holding.currency !== a.expected_currency ? "Reservation pricing changed"
        : holding.status !== "reserved" || new Date(holding.expires_at).getTime() < Date.now() ? "Late or already processed payment"
        : u?.kyc_status !== "approved" || u?.account_status !== "approved" || !u.is_active ? "Investor eligibility changed"
        : otherCharge ? "Additional actual charge requires reconciliation"
        : otherOpen.length ? "Earlier payment succeeded while a replacement checkout was open; reconcile and close the replacement checkout"
        : manual ? "Manual proof and gateway payment require reconciliation"
        : a.state === "rejected" || a.state === "approved" ? "Previously reviewed payment requires reconciliation"
        : "";
      state = reason ? "reconciliation" : "awaiting_admin";
      for (const open of otherOpen) {
        await tx.execute(sql`UPDATE flutterwave_attempts SET state='reconciliation',
          reason='Another payment was received. Do not pay this checkout; provider link closure is required.',updated_at=now() WHERE id=${open.id}`);
        await enqueueCheckoutClosure(tx,open);
        await audit(tx,open.id,"checkout_superseded_by_received_payment","Provider checkout closure queued; no additional payment authorized");
      }
    }
    await tx.execute(sql`INSERT INTO flutterwave_charges(transaction_id,attempt_id,tx_ref,amount,currency,provider_status,disposition)
      VALUES (${id},${a?.id ?? null},${data.tx_ref},${String(data.amount).slice(0,100)},${String(data.currency).slice(0,10)},${String(data.status).slice(0,40)},${reason || state})
      ON CONFLICT(transaction_id) DO UPDATE SET provider_status=EXCLUDED.provider_status,disposition=EXCLUDED.disposition,
        amount=EXCLUDED.amount,currency=EXCLUDED.currency,verified_at=now()`);
    if (a) {
      if (data.status === "successful") {
        // Keep the first receipt identity; every additional charge is retained
        // separately and forces reconciliation, never an additional allocation.
        await tx.execute(sql`UPDATE flutterwave_attempts SET state=${state},reason=${reason || null},
          provider_transaction_id=COALESCE(provider_transaction_id,${id}),
          verified_amount=COALESCE(verified_amount,${exactAmount(data.amount,data.amount) ? String(data.amount) : null}::numeric),
          verified_currency=COALESCE(verified_currency,${String(data.currency).slice(0,10)}),
          verified_at=COALESCE(verified_at,now()),updated_at=now() WHERE id=${a.id}`);
        await audit(tx, a.id, "charge_verified", reason || "Payment received; awaiting explicit administrator approval");
      } else if (!a.verified_at && !["approved","rejected","reconciliation"].includes(a.state)) {
        await tx.execute(sql`UPDATE flutterwave_attempts SET state=${state},reason=${reason},updated_at=now() WHERE id=${a.id}`);
      }
    }
    await tx.execute(sql`UPDATE flutterwave_verification_jobs
      SET status=${["successful","failed","cancelled"].includes(data.status) ? "done" : "queued"},
        next_attempt_at=now()+interval '5 minutes',updated_at=now() WHERE transaction_id=${id}`);
  });
  if (preview) await closeQueuedCheckouts({ reservationId: preview.reservation_id });
  // The claimed reference is never used to assign verified money.
  return claimedRef === data.tx_ref;
}

export async function runVerification(id: string, ref: string) {
  try { return await verifyTransaction(id, ref); }
  catch {
    await db.execute(sql`UPDATE flutterwave_verification_jobs SET attempts=attempts+1,
      status='queued',next_attempt_at=now()+interval '5 minutes',updated_at=now() WHERE transaction_id=${id}`);
    return false;
  }
}
export async function recheckAttempt(a: any, suppliedId?: unknown) {
  await db.execute(sql`UPDATE flutterwave_attempts SET state='verification_pending',updated_at=now(),
    reason='Provider verification is pending. Do not pay again.' WHERE id=${a.id} AND state='initiated'`);
  let id: string;
  try {
    id = suppliedId ? transactionId(suppliedId) : a.provider_transaction_id ||
      transactionId((await providerRequest(`transactions/verify_by_reference?tx_ref=${encodeURIComponent(a.tx_ref)}`)).id);
  } catch {
    // An ambiguous creation/return stays unresolved. A "not found" response
    // alone does not authorize creating another charge.
    throw new GatewayError("No final transaction could be verified yet. Do not pay again; contact support if this continues.", 503);
  }
  await queueVerification(id, a.tx_ref);
  await runVerification(id, a.tx_ref);
}
export async function reviewGateway(id: number, adminId: number, decision: "approve" | "reject", reason?: string) {
  return db.transaction(async tx => {
    const preview = rows(await tx.execute(sql`SELECT * FROM flutterwave_attempts WHERE id=${id}`))[0];
    if (!preview) throw new GatewayError("Checkout not found.", 404);
    const r = await lockHolding(tx, preview.reservation_id);
    const a = rows(await tx.execute(sql`SELECT * FROM flutterwave_attempts WHERE id=${id} FOR UPDATE`))[0];
    const admin = rows(await tx.execute(sql`SELECT id FROM admin_users WHERE id=${adminId} AND is_active=true AND role IN ('admin','super_admin')`))[0];
    if (!admin) throw new GatewayError("Active administrator required.", 403);
    if (decision === "reject") {
      if (!["awaiting_admin","reconciliation"].includes(a.state) || !a.verified_at) throw new GatewayError("Only collected, unreviewed payments may be rejected.");
      if (!reason?.trim() || reason.trim().length > 1000) throw new GatewayError("A rejection reason of 1–1000 characters is required.", 400);
      await tx.execute(sql`UPDATE flutterwave_attempts SET state='rejected',reason=${reason.trim()},reviewed_by_admin_id=${adminId},reviewed_at=now(),updated_at=now() WHERE id=${id}`);
      await audit(tx, id, "rejected_no_refund_issued", reason.trim(), adminId);
      return { reservationId: r.id };
    }
    // Allocation in live mode requires the frozen-cost and exact-PDF guards.
    // Rejection, verification and recovery above/elsewhere stay available.
    if (a.mode === "live") await requireLiveSafeguards(tx, "admin");
    if (a.state !== "awaiting_admin" || !a.verified_at || !exactAmount(a.verified_amount, a.expected_amount) ||
        a.verified_currency !== a.expected_currency || !exactAmount(r.amount,a.expected_amount) ||
        r.currency !== a.expected_currency || r.status !== "reserved") throw new GatewayError("Verified evidence is not eligible for approval. Reconcile manually.");
    const charges = rows(await tx.execute(sql`SELECT transaction_id FROM flutterwave_charges WHERE attempt_id IN
      (SELECT id FROM flutterwave_attempts WHERE reservation_id=${r.id}) AND provider_status='successful'`));
    const proof = rows(await tx.execute(sql`SELECT id FROM payment_submissions WHERE reservation_id=${r.id} AND status IN ('pending_admin_review','approved') LIMIT 1`))[0];
    if (charges.length !== 1 || proof) throw new GatewayError("Competing payments require manual reconciliation; no allocation made.");
    const eligibleOwner = rows(await tx.execute(sql`SELECT id FROM users WHERE id=${r.user_id}
      AND kyc_status='approved' AND account_status='approved' AND is_active=true FOR UPDATE`))[0];
    if (!eligibleOwner) throw new GatewayError("Investor eligibility changed; reconcile before approval.");
    const approval = await confirmInvestmentWithinTransaction(tx, r.id, adminId, {
      fullPaymentConfirmed: true, amountNaira: a.verified_amount, currency: a.verified_currency,
      auditNote: `Administrator approved server-verified Flutterwave receipt ${a.tx_ref}; transaction ${a.provider_transaction_id}`,
    }, id);
    await tx.execute(sql`UPDATE investment_reservations SET payment_method='flutterwave',payment_reference=${a.tx_ref} WHERE id=${r.id}`);
    await tx.execute(sql`UPDATE flutterwave_attempts SET state='approved',reviewed_by_admin_id=${adminId},reviewed_at=now(),updated_at=now() WHERE id=${id}`);
    await audit(tx, id, "approved", "Explicit approval of verified payment; investment confirmed", adminId);
    const owner = rows(await tx.execute(sql`SELECT kyc_full_name FROM users WHERE id=${r.user_id}`))[0];
    // Certificate and durable notification intent share the approval commit.
    await tx.execute(sql`INSERT INTO ownership_certificates
      (reservation_id,certificate_number,verification_token,owner_name,property_name,property_location,units,amount,currency,issued_by_admin_id)
      VALUES (${r.id},${`CERT-FLW-${randomUUID()}`},${randomUUID()},${owner?.kyc_full_name || r.full_name},${r.property_name},${r.property_location},
        ${r.units},${r.amount},${r.currency},${adminId}) ON CONFLICT(reservation_id) DO NOTHING`);
    await tx.execute(sql`INSERT INTO flutterwave_confirmation_jobs(reservation_id) VALUES (${r.id}) ON CONFLICT DO NOTHING`);
    return approval;
  });
}
