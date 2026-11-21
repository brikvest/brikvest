import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { BASE, FIXTURE, setupStatus } from "./config.mjs";
import { recoveryStatus } from "./recovery.mjs";

const hash = token => createHash("sha256").update(token).digest("hex");
const emptyBody = body => body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
const validId = value => /^[1-9]\d{0,9}$/.test(String(value)) && Number.isSafeInteger(Number(value));
const validRef = value => typeof value === "string" && /^brk_[a-f0-9-]{36}$/.test(value);

export async function createSandboxApp(runtime) {
  const { database: pg } = await runtime.initializeDatabase();
  const { GatewayError } = runtime;
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store", "X-Brikvest-Sandbox": "synthetic-only",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    });
    if (!req.path.startsWith(`${BASE}/`)) return res.status(404).json({ error: "Not a sandbox route." });
    // An operator-only trial guard proves a receipt did not come from the
    // browser. Stop callback HTML before Vite/React can run, and stop both
    // verification APIs before any session lookup or provider operation.
    if (process.env.BRIKVEST_TEST_WEBHOOK_ONLY === "true") {
      res.set("X-Brikvest-Webhook-Only", "true");
      if (req.path === `${BASE}/dashboard`)
        return res.status(409).type("text/plain").send("Webhook-only test: browser-return verification is disabled. Close this tab. Do not pay again.");
      if (req.path === `${BASE}/api/return` || new RegExp(`^${BASE}/api/attempts/[^/]+/recheck$`).test(req.path))
        return res.status(409).json({ error: "Webhook-only test: browser returns and manual rechecks are disabled. Do not pay again." });
    }
    next();
  });
  app.use(express.json({ limit: "4kb", strict: true }));
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      res.status(error instanceof GatewayError ? error.httpStatus : 503)
        .json({ error: error instanceof GatewayError ? error.message : "Sandbox operation unavailable. Recheck outstanding payments; do not pay again." });
    }
  };
  const originAllowed = req => {
    const origin = req.get("origin");
    // Browser writes must originate on this existing preview. No CORS or
    // cross-artifact cookies, real-session middleware or administrator access.
    if (origin === `https://${process.env.REPLIT_DEV_DOMAIN}`) return true;
    // The platform's screenshot/browser checks use its loopback shared proxy.
    // This does NOT authorize a provider callback to localhost, or any CORS.
    return ["127.0.0.1", "localhost"].includes(req.hostname) &&
      [`http://${req.hostname}`, `http://${req.hostname}:80`].includes(origin);
  };
  const buckets = new Map();
  function bounded(key, limit) {
    const now = Date.now();
    if (buckets.size > 1000) for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
    const old = buckets.get(key);
    const bucket = old?.until > now ? old : { count: 0, until: now + 60_000 };
    buckets.set(key, bucket);
    if (++bucket.count > limit) throw new GatewayError("Too many requests. Wait a minute; do not pay again.", 429);
  }
  const api = `${BASE}/api`;
  app.post(`${api}/session`, wrap(async (req, res) => {
    if (!originAllowed(req)) throw new GatewayError("Same-origin sandbox request required.", 403);
    bounded(`bootstrap:${req.ip}`, 8);
    if (!emptyBody(req.body)) throw new GatewayError("No customer data is accepted.", 400);
    const token = randomBytes(32).toString("hex");
    const email = `synthetic-${randomBytes(16).toString("hex")}@example.test`;
    await pg.transaction(async tx => {
      const user = (await tx.query("INSERT INTO users(email) VALUES($1) RETURNING id", [email])).rows[0];
      await tx.query("INSERT INTO sandbox_sessions(token_hash,user_id) VALUES($1,$2)", [hash(token), user.id]);
      await insertReservation(tx, user.id);
    });
    res.json({ token, synthetic: true });
  }));
  app.post(`${api}/webhook`, wrap(async (req, res) => {
    if (!runtime.webhookAuthenticated(req.get("verif-hash"))) throw new GatewayError("Invalid webhook authentication.", 401);
    // Even an authenticated webhook must target a known synthetic checkout.
    if (req.body?.event !== "charge.completed") return res.json({ accepted: true });
    const ref = req.body?.data?.tx_ref;
    if (!validRef(ref) || !/^[1-9]\d{0,19}$/.test(String(req.body?.data?.id || ""))) throw new GatewayError("Invalid synthetic webhook.", 400);
    const a = (await pg.query("SELECT id FROM flutterwave_attempts WHERE tx_ref=$1 AND mode='test'", [ref])).rows[0];
    if (!a) throw new GatewayError("Synthetic checkout not found.", 404);
    runtime.gatewayConfig(); // blocked setup cannot acknowledge fake verification
    // Keep only bounded, validated evidence of this authenticated delivery.
    // Never persist raw payloads, signature headers, customer or card data.
    const receiptIdentity = `transaction:${String(req.body.data.id)}`;
    await pg.query(`INSERT INTO flutterwave_audit(attempt_id,event,reason)
      SELECT $1,'sandbox_webhook_received',$2 WHERE NOT EXISTS (
        SELECT 1 FROM flutterwave_audit WHERE attempt_id=$1
          AND event='sandbox_webhook_received' AND reason=$2)`, [a.id, receiptIdentity]);
    await runtime.queueVerification(String(req.body.data.id), ref);
    await runtime.runVerification(String(req.body.data.id), ref);
    res.json({ accepted: true, message: "Evidence queued for provider verification, not ownership." });
  }));
  app.use(api, wrapMiddleware(async (req, _res) => {
    const auth = req.get("authorization") || "";
    if (!/^Bearer [a-f0-9]{64}$/.test(auth)) throw new GatewayError("A separate synthetic session is required.", 401);
    const session = (await pg.query("SELECT user_id FROM sandbox_sessions WHERE token_hash=$1", [hash(auth.slice(7))])).rows[0];
    if (!session) throw new GatewayError("Synthetic session expired. Retry to create a fresh one.", 401);
    req.syntheticUserId = session.user_id;
    if (req.method !== "GET") {
      if (!originAllowed(req)) throw new GatewayError("Same-origin sandbox request required.", 403);
      bounded(`session:${session.user_id}`, 12);
    }
  }, GatewayError));
  async function ownAttempt(id, userId, byRef = false) {
    if (byRef ? !validRef(id) : !validId(id)) throw new GatewayError("Invalid checkout identifier.", 400);
    const a = (await pg.query(`SELECT * FROM flutterwave_attempts WHERE ${byRef ? "tx_ref" : "id"}=$1 AND user_id=$2`, [id, userId])).rows[0];
    if (!a) throw new GatewayError("Synthetic checkout not found.", 404);
    return a;
  }
  app.get(`${api}/state`, wrap(async (req, res) => {
    const reservations = (await pg.query("SELECT * FROM investment_reservations WHERE user_id=$1 ORDER BY id DESC", [req.syntheticUserId])).rows;
    const attempts = (await pg.query("SELECT * FROM flutterwave_attempts WHERE user_id=$1 ORDER BY id DESC", [req.syntheticUserId])).rows;
    const safeAttempts = await Promise.all(attempts.map(async a => ({
      ...runtime.safeAttempt(a), recovery: await recoveryStatus(pg, a, runtime.exactAmount),
    })));
    res.json({
      synthetic: true, setup: setupStatus(),
      property: { name: FIXTURE.name, location: FIXTURE.location, units: FIXTURE.units, area: FIXTURE.area, unitPrice: FIXTURE.amount },
      reservations: reservations.map(r => ({
        id: r.id, amount: r.amount, currency: r.currency, status: r.status, createdAt: r.created_at,
        attempts: safeAttempts.filter(a => a.reservationId === r.id),
      })),
      safety: { database: "Isolated disposable local PGlite only", mail: "Brikvest delivery disabled — no mail transport or SMS. Flutterwave's separate test-email policy is shown above.", ownership: "Disabled — no holdings, legal documents or refunds" },
    });
  }));
  app.post(`${api}/reservations`, wrap(async (req, res) => {
    if (!emptyBody(req.body)) throw new GatewayError("Pricing and identity are server-owned. No input is accepted.", 400);
    const count = (await pg.query("SELECT count(*)::int AS n FROM investment_reservations WHERE user_id=$1", [req.syntheticUserId])).rows[0].n;
    if (count >= 20) throw new GatewayError("Twenty synthetic reservations exist. Resolve outstanding checkouts before resetting.");
    const id = await pg.transaction(tx => insertReservation(tx, req.syntheticUserId));
    res.json({ id });
  }));
  app.post(`${api}/reservations/:id/checkout`, wrap(async (req, res) => {
    if (!validId(req.params.id) || !emptyBody(req.body)) throw new GatewayError("Checkout accepts only a reservation ID, not amounts, currencies, redirects or customer data.", 400);
    // Never replace an existing sandbox attempt, even after terminal recovery.
    // The shared lifecycle retains its own lock/unique-index concurrency guards.
    const existing = (await pg.query("SELECT id FROM flutterwave_attempts WHERE reservation_id=$1 AND user_id=$2 LIMIT 1",
      [req.params.id, req.syntheticUserId])).rows[0];
    if (existing) throw new GatewayError("This synthetic reservation already has checkout evidence. Recheck it; no replacement payment is allowed. Use a separate reservation only for an independent test.");
    res.json(await runtime.initiateCheckout(Number(req.params.id), req.syntheticUserId));
  }));
  app.post(`${api}/attempts/:id/close`, wrap(async (req, res) => {
    if (!emptyBody(req.body)) throw new GatewayError("Link closure accepts no provider URL or status.", 400);
    const a = await ownAttempt(req.params.id, req.syntheticUserId);
    // Recheck first. An uncertain result must never reach the disable request.
    const candidate = await runtime.providerRequest(`transactions/verify_by_reference?tx_ref=${encodeURIComponent(a.tx_ref)}`);
    if (!candidate || candidate.tx_ref !== a.tx_ref || !/^[1-9]\d{0,19}$/.test(String(candidate.id)))
      throw new GatewayError("Provider transaction identity is uncertain. Evidence retained; do not pay again.", 503);
    // Unlike queued best-effort rechecks, terminal recovery must propagate any
    // verification failure rather than rely on an older stored terminal result.
    if (!await runtime.verifyTransaction(String(candidate.id), a.tx_ref))
      throw new GatewayError("Provider reference did not match. Evidence retained; do not pay again.", 503);
    await pg.transaction(async tx => {
      await tx.query("SELECT id FROM investment_reservations WHERE id=$1 FOR UPDATE", [a.reservation_id]);
      const current = (await tx.query("SELECT * FROM flutterwave_attempts WHERE id=$1 FOR UPDATE", [a.id])).rows[0];
      const recovery = await recoveryStatus(tx, current, runtime.exactAmount);
      if (!recovery.canClose) throw new GatewayError("Provider-backed terminal eligibility is not established, or the link is already closed. Evidence retained; do not pay again.");
      // Hold the same reservation/attempt locks as receipt verification. A late
      // success is still accepted afterwards and will block destructive reset.
      const closed = await runtime.providerRequest("payments/link/disable", { link: runtime.safeCheckoutUrl(current.checkout_url) });
      if (closed !== true) throw new GatewayError("Provider link closure is uncertain. Evidence retained; do not pay again.", 503);
      await tx.query(`INSERT INTO flutterwave_checkout_closures(attempt_id,checkout_url,status)
        VALUES($1,$2,'done') ON CONFLICT(attempt_id) DO UPDATE SET
        checkout_url=EXCLUDED.checkout_url,status='done',updated_at=now()`, [a.id, current.checkout_url]);
      await tx.query("INSERT INTO flutterwave_audit(attempt_id,event,reason) VALUES($1,'sandbox_terminal_link_closed',$2)",
        [a.id, "Provider confirmed hosted link disabled after terminal verification; no replacement checkout authorized."]);
    });
    res.json({ message: "Provider confirmed the test link is disabled. Evidence is preserved because prior submissions could still settle. Reset and another payment for this reservation remain blocked." });
  }));
  app.post(`${api}/attempts/:id/recheck`, wrap(async (req, res) => {
    if (!emptyBody(req.body)) throw new GatewayError("Recheck accepts no provider operation or customer input.", 400);
    const a = await ownAttempt(req.params.id, req.syntheticUserId);
    await runtime.recheckAttempt(a);
    await runtime.closeQueuedCheckouts({ reservationId: a.reservation_id });
    res.json({ message: "Status rechecked. Read the verified state; no ownership was granted." });
  }));
  app.post(`${api}/return`, wrap(async (req, res) => {
    if (!req.body || Object.keys(req.body).some(k => !["txRef", "transactionId"].includes(k)) ||
        (req.body.transactionId !== undefined && !/^[1-9]\d{0,19}$/.test(String(req.body.transactionId))))
      throw new GatewayError("Invalid provider return. Redirect status is never evidence.", 400);
    const a = await ownAttempt(req.body.txRef, req.syntheticUserId, true);
    // The browser ID is only a hint. Resolve the owning server reference instead,
    // so a forged transaction ID cannot even trigger another session's recheck.
    await runtime.recheckAttempt(a);
    res.json({ message: "Server verification was attempted. Read the stored state below; pending is not a receipt and payment does not grant ownership." });
  }));
  app.post(`${api}/reset`, wrap(async (req, res) => {
    if (req.body?.confirmation !== "RESET SYNTHETIC RECORDS" || Object.keys(req.body).length !== 1)
      throw new GatewayError("Explicit synthetic-record reset confirmation required.", 400);
    await pg.transaction(async tx => {
      // Never erase evidence while a hosted link could still collect, or a
      // verification result is uncertain. No main database is involved.
      await tx.query("SELECT id FROM investment_reservations WHERE user_id=$1 FOR UPDATE", [req.syntheticUserId]);
      const attempts = (await tx.query("SELECT * FROM flutterwave_attempts WHERE user_id=$1 ORDER BY id FOR UPDATE", [req.syntheticUserId])).rows;
      for (const a of attempts) {
        if (!(await recoveryStatus(tx, a, runtime.exactAmount)).resetEligible)
          throw new GatewayError("Reset blocked: checkout evidence must be retained. Missing/not-found results, terminal transaction status, link closure and elapsed deadlines do not prove prior submissions cannot settle. Only reservations with no checkout attempts can reset.");
      }
      await tx.query(`DELETE FROM flutterwave_verification_jobs WHERE tx_ref IN
        (SELECT tx_ref FROM flutterwave_attempts WHERE user_id=$1)`, [req.syntheticUserId]);
      for (const table of ["flutterwave_audit", "flutterwave_charges", "flutterwave_checkout_closures"])
        await tx.query(`DELETE FROM ${table} WHERE attempt_id IN (SELECT id FROM flutterwave_attempts WHERE user_id=$1)`, [req.syntheticUserId]);
      await tx.query("DELETE FROM flutterwave_attempts WHERE user_id=$1", [req.syntheticUserId]);
      await tx.query("DELETE FROM investment_reservation_inventory WHERE reservation_id IN (SELECT id FROM investment_reservations WHERE user_id=$1)", [req.syntheticUserId]);
      await tx.query("DELETE FROM investment_reservations WHERE user_id=$1", [req.syntheticUserId]);
      await insertReservation(tx, req.syntheticUserId);
    });
    res.json({ message: "Only this session's disposable records were reset. A fresh synthetic reservation is ready." });
  }));
  app.use(api, (_req, res) => res.status(404).json({ error: "No such sandbox operation. No administrator, refund or delivery routes exist." }));
  app.use((error, _req, res, _next) => res.status(error?.type === "entity.parse.failed" ? 400 : 503).json({ error: "Invalid or unavailable sandbox request." }));
  return app;
}
function wrapMiddleware(fn, GatewayError) {
  return async (req, res, next) => {
    try { await fn(req, res); next(); }
    catch (error) { res.status(error instanceof GatewayError ? error.httpStatus : 503).json({ error: error instanceof GatewayError ? error.message : "Synthetic session unavailable." }); }
  };
}
async function insertReservation(tx, userId) {
  const u = (await tx.query("SELECT email FROM users WHERE id=$1", [userId])).rows[0];
  const r = (await tx.query(`INSERT INTO investment_reservations(property_id,user_id,full_name,email,units,amount,currency,expires_at)
    VALUES(1,$1,$2,$3,1,1200.10,'NGN',now()+interval '24 hours') RETURNING id`, [userId, FIXTURE.fullName, u.email])).rows[0];
  await tx.query("INSERT INTO investment_reservation_inventory VALUES($1,1,1)", [r.id]);
  return r.id;
}
