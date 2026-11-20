import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { resultRows as rows, gatewayInstalled } from "./gateway-guards";
import { GatewayError, gatewayConfig, transactionId, webhookAuthenticated } from "./flutterwave-provider";
import { initiateCheckout, queueVerification, recheckAttempt, requireGatewaySchema, reviewGateway, runVerification, safeAttempt } from "./flutterwave";
import { dispatchGatewayConfirmation } from "./flutterwave-notifications";
import { LegalApprovalTransitionError } from "../legal/approval";
import { recoverGatewayWork } from "./flutterwave-worker";

type Middleware = (req: any, res: any, next: any) => any;
const positiveId = (value: any) => {
  if (!/^[1-9]\d{0,9}$/.test(String(value))) throw new GatewayError("Invalid ID.", 400);
  return Number(value);
};
const reference = (value: any) => {
  if (typeof value !== "string" || !/^brk_[a-f0-9-]{36}$/.test(value)) throw new GatewayError("Invalid checkout reference.", 400);
  return value;
};
export function registerFlutterwaveRoutes(app: Express, auth: { requireAuth: Middleware; requireAdminAuth: Middleware }) {
  // Limits apply only to authenticated investor operations. Provider evidence
  // still requires authenticated webhook + server-to-server verification.
  const buckets = new Map<number, { count: number; until: number }>();
  const boundedInvestorRequest: Middleware = (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 1000) buckets.forEach((value, key) => { if (value.until < now) buckets.delete(key); });
    const key = Number(req.user.id);
    const old = buckets.get(key);
    const bucket = old && old.until > now ? old : { count: 0, until: now + 60_000 };
    buckets.set(key, bucket);
    if (++bucket.count > 12) return res.status(429).json({ error: "Too many payment requests. Wait a minute and recheck; do not pay again." });
    next();
  };
  const wrap = (fn: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    res.setHeader("Cache-Control", "no-store");
    try { await fn(req, res); }
    catch (error) {
      const known = error instanceof GatewayError || error instanceof LegalApprovalTransitionError;
      res.status(known ? error.httpStatus : 503).json({ error: known ? error.message : "Payment service unavailable. Bank transfer is unchanged. Recheck any outstanding payment before paying again." });
    }
  };
  const ownAttempt = async (id: number, userId: number) => {
    await requireGatewaySchema();
    const a = rows(await db.execute(sql`SELECT * FROM flutterwave_attempts WHERE id=${id} AND user_id=${userId}`))[0];
    if (!a) throw new GatewayError("Checkout not found.", 404);
    return a;
  };
  app.get("/api/payments/flutterwave/attempts", auth.requireAuth, wrap(async (req, res) => {
    if (!await gatewayInstalled(db)) return res.json([]);
    res.json(rows(await db.execute(sql`SELECT * FROM flutterwave_attempts WHERE user_id=${req.user.id} ORDER BY id DESC`)).map(safeAttempt));
  }));
  app.get("/api/payments/flutterwave/reservations/:id", auth.requireAuth, wrap(async (req, res) => {
    const id = positiveId(req.params.id);
    const r = rows(await db.execute(sql`SELECT * FROM investment_reservations WHERE id=${id} AND user_id=${req.user.id}`))[0];
    if (!r) throw new GatewayError("Reservation not found.", 404);
    let available = true, reason = "";
    try {
      const config = gatewayConfig();
      if (!config.currencies.includes(r.currency)) throw new GatewayError(`Flutterwave is not configured for ${r.currency}. Bank transfer remains available; no conversion is performed.`);
      await requireGatewaySchema();
    } catch (e) { available = false; reason = e instanceof GatewayError ? e.message : "Flutterwave is unavailable."; }
    const attempts = await gatewayInstalled(db) ? rows(await db.execute(sql`SELECT * FROM flutterwave_attempts WHERE reservation_id=${id} AND user_id=${req.user.id} ORDER BY id DESC`)).map(safeAttempt) : [];
    res.json({ available, reason, amount: r.amount, currency: r.currency, attempts });
  }));
  app.post("/api/payments/flutterwave/reservations/:id/checkout", auth.requireAuth, boundedInvestorRequest, wrap(async (req, res) => {
    // No client-supplied amount, currency or origin is ever consumed.
    res.json(await initiateCheckout(positiveId(req.params.id), req.user.id));
  }));
  app.post("/api/payments/flutterwave/attempts/:id/recheck", auth.requireAuth, boundedInvestorRequest, wrap(async (req, res) => {
    const a = await ownAttempt(positiveId(req.params.id), req.user.id);
    await recheckAttempt(a, req.body?.transactionId);
    res.json({ message: "Payment status checked. Ownership still requires administrator approval." });
  }));
  app.post("/api/payments/flutterwave/return", auth.requireAuth, boundedInvestorRequest, wrap(async (req, res) => {
    await requireGatewaySchema();
    const ref = reference(req.body?.txRef);
    const a = rows(await db.execute(sql`SELECT * FROM flutterwave_attempts WHERE tx_ref=${ref} AND user_id=${req.user.id}`))[0];
    if (!a) throw new GatewayError("Checkout not found.", 404);
    // Even cancellation query parameters are untrusted. Recheck the provider;
    // never mark received/cancelled based solely on the browser redirect.
    await recheckAttempt(a, req.body?.transactionId);
    res.json({ message: "Return received. Payment is subject to server verification and administrator approval." });
  }));
  app.post("/api/payments/flutterwave/webhook", wrap(async (req, res) => {
    if (!webhookAuthenticated(req.get("verif-hash"))) throw new GatewayError("Invalid webhook authentication.", 401);
    await requireGatewaySchema();
    if (req.body?.event !== "charge.completed") return res.sendStatus(200);
    const id = transactionId(req.body?.data?.id);
    const ref = String(req.body?.data?.tx_ref || "").slice(0,100);
    await queueVerification(id, ref);
    // Persist work before acknowledgement. Bounded verification usually completes
    // now; retries survive process loss and are recovered by the maintenance endpoint.
    await runVerification(id, ref);
    res.sendStatus(200);
  }));
  app.get("/api/admin/payments/flutterwave", auth.requireAdminAuth, wrap(async (_req, res) => {
    if (!await gatewayInstalled(db)) return res.json([]);
    const attempts = rows(await db.execute(sql`SELECT a.*, row_to_json(r) AS reservation,row_to_json(p) AS property,
      json_build_object('email',u.email,'kycFullName',u.kyc_full_name) AS "user"
      FROM flutterwave_attempts a JOIN investment_reservations r ON r.id=a.reservation_id
      JOIN properties p ON p.id=r.property_id JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200`));
    const enriched = await Promise.all(attempts.map(async a => ({
      ...safeAttempt(a), reservation: a.reservation, property: a.property, user: a.user,
      audit: rows(await db.execute(sql`SELECT event AS action,reason,created_at AS "createdAt",admin_id::text AS actor FROM flutterwave_audit WHERE attempt_id=${a.id} ORDER BY id`)),
      charges: rows(await db.execute(sql`SELECT * FROM flutterwave_charges WHERE attempt_id=${a.id} ORDER BY verified_at`)),
      notification: rows(await db.execute(sql`SELECT state,updated_at FROM flutterwave_confirmation_jobs WHERE reservation_id=${a.reservation_id}`))[0] || null,
      checkoutClosure: rows(await db.execute(sql`SELECT status,attempts,updated_at FROM flutterwave_checkout_closures WHERE attempt_id=${a.id}`))[0] || null,
    })));
    const unmatched = rows(await db.execute(sql`SELECT * FROM flutterwave_charges WHERE attempt_id IS NULL ORDER BY verified_at DESC LIMIT 100`));
    // Keep array contract while making unmatched actual charges visible.
    res.json([...enriched, ...unmatched.map(c => ({
      id: `unmatched-${c.transaction_id}`, state: "reconciliation", reason: "Unmatched provider charge — no allocation or refund",
      txRef: c.tx_ref, transactionId: c.transaction_id, verifiedAmount: c.amount, verifiedCurrency: c.currency,
      verifiedAt: c.verified_at, charges: [c], audit: [], unmatched: true,
    }))]);
  }));
  app.post("/api/admin/payments/flutterwave/recover", auth.requireAdminAuth, wrap(async (_req, res) => {
    await requireGatewaySchema();
    await recoverGatewayWork();
    res.json({ message: "Queued verification and confirmation work checked." });
  }));
  app.post("/api/admin/payments/flutterwave/:id/recheck", auth.requireAdminAuth, wrap(async (req, res) => {
    await requireGatewaySchema();
    const a = rows(await db.execute(sql`SELECT * FROM flutterwave_attempts WHERE id=${positiveId(req.params.id)}`))[0];
    if (!a) throw new GatewayError("Checkout not found.", 404);
    await db.execute(sql`INSERT INTO flutterwave_audit(attempt_id,admin_id,event) VALUES (${a.id},${req.user.userId},'admin_recheck_requested')`);
    await recheckAttempt(a, req.body?.transactionId);
    res.json({ message: "Verification checked." });
  }));
  for (const decision of ["approve","reject"] as const) {
    app.put(`/api/admin/payments/flutterwave/:id/${decision}`, auth.requireAdminAuth, wrap(async (req, res) => {
      await requireGatewaySchema();
      const approval = await reviewGateway(positiveId(req.params.id), req.user.userId, decision, req.body?.reason);
      if (decision === "approve") {
        await dispatchGatewayConfirmation(approval.reservationId);
        if ("legal" in approval && approval.legal.pairId && process.env.NODE_ENV !== "test") {
          void import("../legal/worker").then(w => w.dispatchLegalJobs(3)).catch(() => {});
        }
      }
      res.json({ message: decision === "approve" ? "Payment approved and investment confirmed." : "Payment rejected. No refund was issued. Contact support; do not pay again." });
    }));
  }
}
