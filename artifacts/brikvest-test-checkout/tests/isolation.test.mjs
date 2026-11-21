import { before, beforeEach, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import request from "supertest";
import { buildLifecycle } from "../server/build-lifecycle.mjs";
import { createSandboxApp } from "../server/app.mjs";
import { assertRuntimeFence, setupStatus } from "../server/config.mjs";

const origin = "https://sandbox-fixture.replit.dev";
const api = "/brikvest-test-checkout/api";
let runtime, pg, app, token, id, calls;
const fixtureKey = "FLWSECK_TEST-offline-regression-only";
const ref = "brk_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const fixture = overrides => ({ id: 101, tx_ref: ref, status: "successful", amount: "1200.10", charged_amount: "1200.10", currency: "NGN", ...overrides });
function ready() {
  delete process.env.BRIKVEST_TEST_PROVIDER_EMAILS_AUTHORIZED;
  delete process.env.BRIKVEST_TEST_PORT_REVIEW_WAIVED;
  delete process.env.BRIKVEST_TEST_CALLBACK_MODE;
  delete process.env.BRIKVEST_TEST_WEBHOOK_ONLY;
  Object.assign(process.env, {
    BRIKVEST_SANDBOX_RUNTIME: "synthetic-only-v1", BRIKVEST_TEST_MODE: "test",
    BRIKVEST_TEST_FLW_SECRET_KEY: fixtureKey, BRIKVEST_TEST_FLW_SECRET_HASH: "offline-fixture-hash",
    BRIKVEST_TEST_RETURN_ORIGIN: origin, REPLIT_DEV_DOMAIN: "sandbox-fixture.replit.dev",
    BRIKVEST_TEST_CALLBACK_APPROVED: "true", BRIKVEST_TEST_PORT_REVIEWED: "true",
    BRIKVEST_TEST_PROVIDER_NOTIFICATIONS_DISABLED: "true",
  });
}
function mockProvider(data) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const result = typeof data === "function" ? data(url, options) : data;
    return { ok: true, status: 200, json: async () => ({ status: "success", data: result }) };
  };
}
const post = (route, body = {}, session = token) => request(app).post(`${api}${route}`).set("Origin", origin).set("Authorization", `Bearer ${session}`).send(body);
const state = async () => (await request(app).get(`${api}/state`).set("Authorization", `Bearer ${token}`)).body;
const link = "https://checkout.flutterwave.com/v3/hosted/pay/offline";
async function terminalAttempt(status = "failed") {
  await seedAttempt();
  await pg.query("UPDATE flutterwave_attempts SET checkout_url=$1,checkout_expires_at=now()-interval '1 minute'", [link]);
  mockProvider(fixture({ status }));
  await runtime.verifyTransaction("101", ref);
}
async function scalar(sql, params = []) { return (await pg.query(sql, params)).rows[0]; }
async function seedAttempt() {
  await pg.query(`INSERT INTO flutterwave_attempts(reservation_id,user_id,tx_ref,expected_amount,expected_currency,mode,checkout_expires_at)
    VALUES($1,(SELECT user_id FROM investment_reservations WHERE id=$1),$2,1200.10,'NGN','test',now()+interval '10 minutes')`, [id, ref]);
}
before(async () => {
  ready();
  runtime = await import(pathToFileURL(await buildLifecycle({ regression: true })).href);
  ({ database: pg } = await runtime.initializeDatabase());
});
beforeEach(async () => {
  ready(); calls = [];
  globalThis.fetch = async () => { throw new Error("Outbound network forbidden in regression tests."); };
  await pg.exec(`TRUNCATE flutterwave_checkout_closures,flutterwave_audit,flutterwave_charges,flutterwave_verification_jobs,
    flutterwave_attempts,investment_reservation_inventory,payment_submissions,investment_reservations,sandbox_sessions,users RESTART IDENTITY CASCADE`);
  app = await createSandboxApp(runtime);
  const session = await request(app).post(`${api}/session`).set("Origin", origin).send({});
  assert.equal(session.status, 200); token = session.body.token;
  id = (await request(app).get(`${api}/state`).set("Authorization", `Bearer ${token}`)).body.reservations[0].id;
});
after(async () => { await pg?.close(); });

describe("Sandbox environment and import isolation", () => {
  it("builds the existing lifecycle without normal DB, mail, approval, workers or original config", async () => {
    const imports = await fs.readFile("generated-artifacts/brikvest-test-checkout-regression/imports.json", "utf8");
    assert.match(imports, /api-server\/src\/payments\/flutterwave\.ts/);
    assert.doesNotMatch(imports, /(?:\/db\.ts|emailService|notifications|worker|storage|legal\/approval|lib\/db)/);
    const code = await fs.readFile("generated-artifacts/brikvest-test-checkout-regression/lifecycle.mjs", "utf8");
    assert.doesNotMatch(code, /process\.env\.(FLW_|DATABASE_URL|SMTP|NEON)|INSERT INTO ownership_certificates/);
    assert.equal((await scalar("SELECT to_regclass('ownership_certificates') AS t")).t, null);
    assert.equal((await scalar("SELECT to_regclass('flutterwave_confirmation_jobs') AS t")).t, null);
  });
  it("refuses main database settings and live key/mode without any provider request", async () => {
    process.env.DATABASE_URL = "postgres://forbidden.invalid/not-used";
    assert.throws(assertRuntimeFence, /environment rejected/); delete process.env.DATABASE_URL;
    process.env.NEON_DATABASE_URL = "postgres://forbidden.invalid/not-used";
    assert.throws(assertRuntimeFence, /environment rejected/); delete process.env.NEON_DATABASE_URL;
    process.env.SMTP_USER = "not-a-real-user";
    assert.throws(assertRuntimeFence, /environment rejected/); delete process.env.SMTP_USER;
    process.env.BRIKVEST_TEST_FLW_SECRET_KEY = "FLWSECK-live-fixture-refused";
    assert.throws(runtime.gatewayConfig, /not a v3 test key/);
    process.env.BRIKVEST_TEST_FLW_SECRET_KEY = fixtureKey;
    process.env.BRIKVEST_TEST_MODE = "live";
    assert.throws(runtime.gatewayConfig, /Only test mode/);
    assert.equal(calls.length, 0);
  });
  it("has an identity-marked local engine and database constraints for synthetic-only records", async () => {
    assert.equal((await scalar("SELECT purpose FROM sandbox_identity")).purpose, "brikvest-synthetic-checkout-v1");
    await assert.rejects(pg.query("INSERT INTO users(email) VALUES('real@example.com')"), /check constraint/);
    await assert.rejects(pg.query("UPDATE investment_reservations SET amount=1"), /check constraint/);
    await seedAttempt();
    await assert.rejects(pg.query("UPDATE flutterwave_attempts SET expected_amount=1"), /immutable/);
    await assert.rejects(pg.query("UPDATE flutterwave_attempts SET state='approved'"), /check constraint/);
    await assert.rejects(pg.query("UPDATE properties SET sold_units=1"), /check constraint/);
  });
  it("blocks missing credentials and callback/notification readiness without probing provider", async () => {
    delete process.env.BRIKVEST_TEST_FLW_SECRET_KEY;
    mockProvider({ link: "https://checkout.flutterwave.com/never" });
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 503);
    assert.equal(calls.length, 0);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_attempts")).n, 0);
    ready(); delete process.env.BRIKVEST_TEST_CALLBACK_APPROVED;
    assert.equal(setupStatus().available, false);
    ready(); delete process.env.BRIKVEST_TEST_PROVIDER_NOTIFICATIONS_DISABLED;
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 503);
    assert.equal(calls.length, 0);
  });
  it("records the review waiver and private-return scope without claiming a reviewed main site or working webhooks", () => {
    delete process.env.BRIKVEST_TEST_PORT_REVIEWED;
    assert.equal(setupStatus().available, false);
    process.env.BRIKVEST_TEST_PORT_REVIEW_WAIVED = "false";
    assert.equal(setupStatus().available, false);
    process.env.BRIKVEST_TEST_PORT_REVIEW_WAIVED = "true";
    process.env.BRIKVEST_TEST_CALLBACK_MODE = "private-browser-return";
    const setup = setupStatus();
    assert.equal(setup.available, true);
    assert.match(setup.scopeNotice, /waived the main-site migration review/);
    assert.match(setup.scopeNotice, /Webhook delivery must be verified independently/);
    assert.equal(process.env.BRIKVEST_TEST_PORT_REVIEWED, undefined);
    process.env.BRIKVEST_TEST_CALLBACK_MODE = "public";
    assert.equal(setupStatus().available, false);
    process.env.BRIKVEST_TEST_CALLBACK_MODE = "private-browser-return";
    delete process.env.BRIKVEST_TEST_CALLBACK_APPROVED;
    assert.equal(setupStatus().available, false);
    assert.equal(calls.length, 0);
  });
  it("logs only static provider rejection categories, never raw messages or credentials", async () => {
    const warnings = [];
    const warn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      globalThis.fetch = async () => ({
        ok: false, status: 401,
        json: async () => ({ status: "error", message: "Invalid authorization NEVER_LOG_PROVIDER_DETAIL" }),
      });
      assert.equal((await post(`/reservations/${id}/checkout`)).status, 503);
      assert.match(warnings.join(" "), /test_credential_rejected/);
      assert.match(warnings.join(" "), /"httpStatus":401/);
      assert.doesNotMatch(warnings.join(" "), /NEVER_LOG_PROVIDER_DETAIL|FLWSECK|offline-fixture/);
      const attempt = await scalar("SELECT state FROM flutterwave_attempts WHERE reservation_id=$1", [id]);
      assert.equal(attempt.state, "verification_pending");
    } finally { console.warn = warn; }
  });
  it("allows only the exact authenticated-provider test checkout host and v3 path behind the sandbox fence", async () => {
    const link = "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/flwlnk-test-only";
    assert.equal(runtime.safeCheckoutUrl(link), link);
    for (const bad of [
      "http://checkout-v2.dev-flutterwave.com/v3/hosted/pay/a",
      "https://checkout-v2.dev-flutterwave.com.evil.test/v3/hosted/pay/a",
      "https://customer:password@checkout-v2.dev-flutterwave.com/v3/hosted/pay/a",
      "https://checkout-v2.dev-flutterwave.com:444/v3/hosted/pay/a",
      "https://checkout-v2.dev-flutterwave.com/v4/hosted/pay/a",
      "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/a?redirect=elsewhere",
      "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/a#untrusted",
    ]) assert.throws(() => runtime.safeCheckoutUrl(bad));
    mockProvider({ link });
    const checkout = await post(`/reservations/${id}/checkout`);
    assert.equal(checkout.status, 200);
    assert.equal(checkout.body.checkoutUrl, link);
    process.env.BRIKVEST_TEST_MODE = "live";
    assert.throws(() => runtime.safeCheckoutUrl(link), /Only test mode/);
    process.env.BRIKVEST_TEST_MODE = "test";
    delete process.env.BRIKVEST_TEST_FLW_SECRET_KEY;
    assert.throws(() => runtime.safeCheckoutUrl(link), /blocked/);
  });
  it("accepts explicit provider test-email consent without enabling application mail or claiming notifications are disabled", async () => {
    delete process.env.BRIKVEST_TEST_PROVIDER_NOTIFICATIONS_DISABLED;
    assert.equal(setupStatus().available, false);
    process.env.BRIKVEST_TEST_PROVIDER_EMAILS_AUTHORIZED = "false";
    assert.equal(setupStatus().available, false);
    process.env.BRIKVEST_TEST_PROVIDER_EMAILS_AUTHORIZED = "true";
    const setup = setupStatus();
    assert.equal(setup.available, true);
    assert.match(setup.providerEmailPolicy, /Owner authorized Flutterwave test-payment emails to the business address/);
    assert.match(setup.providerEmailPolicy, /Brikvest email and SMS remain disabled/);
    assert.doesNotMatch(setup.providerEmailPolicy, /notifications are confirmed disabled/);
    assert.equal(process.env.BRIKVEST_TEST_PROVIDER_NOTIFICATIONS_DISABLED, undefined);
    assert.equal(process.env.SMTP_USER, undefined);
    assert.equal(process.env.SMTP_PASS, undefined);
    mockProvider({ link: "https://checkout.flutterwave.com/v3/hosted/pay/offline" });
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 200);
    const state = (await request(app).get(`${api}/state`).set("Authorization", `Bearer ${token}`)).body;
    assert.equal(state.setup.providerEmailPolicy, setup.providerEmailPolicy);
    assert.match(state.safety.mail, /Brikvest delivery disabled/);
    assert.equal((await scalar("SELECT to_regclass('flutterwave_confirmation_jobs') AS t")).t, null);
    delete process.env.BRIKVEST_TEST_FLW_SECRET_KEY;
    assert.equal(setupStatus().available, false);
  });
  it("rejects arbitrary redirects, provider routes, real origins and non-synthetic amounts", async () => {
    mockProvider({});
    await assert.rejects(runtime.providerRequest("../refunds"), /not allowed/);
    await assert.rejects(runtime.providerRequest("https://evil.test"), /not allowed/);
    await assert.rejects(runtime.providerRequest("payments", { amount: 1 }), /Non-synthetic/);
    await assert.rejects(runtime.providerRequest("payments/link/disable", { link: "https://evil.test" }), /invalid checkout/);
    for (const bad of ["https://brikvest.net", `${origin}/path`, "http://sandbox-fixture.replit.dev", "https://evil.test", "https://u:p@sandbox-fixture.replit.dev"]) {
      process.env.BRIKVEST_TEST_RETURN_ORIGIN = bad;
      assert.throws(runtime.gatewayConfig, /blocked/);
    }
    assert.equal(calls.length, 0);
  });
});
describe("Synthetic session boundaries and fixed checkout", () => {
  it("ignores real cookies, blocks missing auth and cross-origin writes, never sets a shared cookie", async () => {
    assert.equal((await request(app).get(`${api}/state`).set("Cookie", "connect.sid=real-admin")).status, 401);
    assert.equal((await request(app).post(`${api}/session`).set("Origin", "https://evil.test").send({})).status, 403);
    const response = await request(app).post(`${api}/session`).set("Origin", origin).send({});
    assert.equal(response.headers["set-cookie"], undefined);
    assert.equal((await request(app).post(`${api}/reservations`).set("Authorization", `Bearer ${token}`).set("Origin", "https://evil.test").send({})).status, 403);
    assert.equal((await post("/admin/approve")).status, 404);
  });
  it("prevents another synthetic session accessing or rechecking someone else's reservation", async () => {
    const other = (await request(app).post(`${api}/session`).set("Origin", origin).send({})).body.token;
    mockProvider({ link: "https://checkout.flutterwave.com/v3/hosted/pay/offline" });
    assert.equal((await post(`/reservations/${id}/checkout`, {}, other)).status, 404);
    await seedAttempt();
    assert.equal((await post("/attempts/1/recheck", {}, other)).status, 404);
    assert.equal((await post("/return", { txRef: ref }, other)).status, 404);
    assert.equal(calls.length, 0);
  });
  it("rejects client pricing and identity, then sends only server-owned synthetic payment details", async () => {
    mockProvider({ link: "https://checkout.flutterwave.com/v3/hosted/pay/offline" });
    for (const payload of [{ amount: 1 }, { currency: "USD" }, { redirect_url: "https://evil.test" }, { customer: { email: "real@example.com" } }])
      assert.equal((await post(`/reservations/${id}/checkout`, payload)).status, 400);
    assert.equal(calls.length, 0);
    const checkout = await post(`/reservations/${id}/checkout`);
    assert.equal(checkout.status, 200);
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(calls[0].url, "https://api.flutterwave.com/v3/payments");
    assert.equal(payload.amount, "1200.10"); assert.equal(payload.currency, "NGN");
    assert.equal(payload.redirect_url, `${origin}/brikvest-test-checkout/dashboard?flutterwaveReturn=1`);
    assert.match(payload.customer.email, /^synthetic-[a-f0-9]{32}@example\.test$/);
    assert.equal(payload.customer.name, "Synthetic Checkout Tester");
    assert.match(payload.customizations.title, /TEST ONLY/);
    assert.equal(calls[0].options.redirect, "error");
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 409);
    assert.equal(calls.length, 1);
    const state = (await request(app).get(`${api}/state`).set("Authorization", `Bearer ${token}`)).body;
    assert.equal(state.reservations[0].attempts[0].checkoutUrl, undefined);
    assert.doesNotMatch(JSON.stringify(state), /FLWSECK|offline-fixture-hash/);
  });
});
describe("Existing lifecycle verification, replay and uncertainty", () => {
  it("only server-verified exact receipts reach awaiting admin, with no ownership or delivery", async () => {
    await seedAttempt(); mockProvider(fixture({}));
    await Promise.all([runtime.verifyTransaction("101", ref), runtime.verifyTransaction("101", ref)]);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, "awaiting_admin");
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 1);
    assert.equal((await scalar("SELECT sold_units FROM properties")).sold_units, 0);
    assert.equal((await scalar("SELECT status FROM investment_reservations")).status, "reserved");
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 409);
  });
  it("rejects invalid and unknown webhooks before provider access", async () => {
    await seedAttempt(); mockProvider(fixture({}));
    assert.equal((await post("/webhook", { event: "charge.completed", data: { id: 101, tx_ref: ref } })).status, 401);
    const missing = await request(app).post(`${api}/webhook`).set("verif-hash", "offline-fixture-hash")
      .send({ event: "charge.completed", data: { id: 101, tx_ref: "brk_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" } });
    assert.equal(missing.status, 404); assert.equal(calls.length, 0);
    const valid = () => request(app).post(`${api}/webhook`).set("verif-hash", "offline-fixture-hash").send({ event: "charge.completed", data: { id: 101, tx_ref: ref } });
    assert.equal((await valid()).status, 200); assert.equal((await valid()).status, 200);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 1);
  });
  it("rejects missing, wrong, equal-length and oversized webhook hashes without queuing or changing receipts", async () => {
    await seedAttempt(); mockProvider(fixture({}));
    for (const signature of [undefined, "", "wrong", "x".repeat("offline-fixture-hash".length), "x".repeat(1025)]) {
      const req = request(app).post(`${api}/webhook`);
      if (signature !== undefined) req.set("verif-hash", signature);
      const response = await req.send({ event: "charge.completed", data: { id: 101, tx_ref: ref } });
      assert.equal(response.status, 401);
      assert.doesNotMatch(JSON.stringify(response.body), /offline-fixture-hash/);
    }
    assert.equal(calls.length, 0);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_verification_jobs")).n, 0);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 0);
    assert.equal((await scalar("SELECT state,verified_at FROM flutterwave_attempts")).verified_at, null);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, "initiated");
  });
  it("verifies sessionless webhook deliveries and concurrent replays without a browser return, ownership or mail", async () => {
    await seedAttempt(); mockProvider(fixture({}));
    const deliver = () => request(app).post(`${api}/webhook`)
      .set("verif-hash", "offline-fixture-hash")
      .send({ event: "charge.completed", data: { id: 101, tx_ref: ref } });
    // No bearer session, cookie, Origin, /return or /recheck request is sent.
    const responses = await Promise.all([deliver(), deliver(), deliver()]);
    for (const response of responses) assert.equal(response.status, 200);
    assert.ok(calls.length > 0);
    assert.ok(calls.every(call => call.url === "https://api.flutterwave.com/v3/transactions/101/verify"));
    const attempt = await scalar("SELECT * FROM flutterwave_attempts");
    assert.equal(attempt.state, "awaiting_admin");
    assert.equal(attempt.provider_transaction_id, "101");
    assert.equal(Number(attempt.verified_amount), 1200.10);
    assert.equal(attempt.verified_currency, "NGN");
    assert.ok(attempt.verified_at);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 1);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_verification_jobs")).n, 1);
    assert.equal((await scalar("SELECT status FROM flutterwave_verification_jobs")).status, "done");
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_audit WHERE event='charge_verified'")).n, 1);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_audit WHERE event='sandbox_webhook_received'")).n, 1);
    assert.equal((await scalar("SELECT sold_units FROM properties")).sold_units, 0);
    assert.equal((await scalar("SELECT status FROM investment_reservations")).status, "reserved");
    assert.equal((await scalar("SELECT to_regclass('ownership_certificates') AS t")).t, null);
    assert.equal((await scalar("SELECT to_regclass('flutterwave_confirmation_jobs') AS t")).t, null);
    // A new app instance can read the receipt; the webhook did not rely on UI state.
    const reopened = await createSandboxApp(runtime);
    const state = await request(reopened).get(`${api}/state`).set("Authorization", `Bearer ${token}`);
    assert.equal(state.body.reservations[0].attempts[0].state, "awaiting_admin");
  });
  it("blocks return HTML and all manual verification before side effects during a webhook-only trial", async () => {
    await seedAttempt(); mockProvider(fixture({}));
    process.env.BRIKVEST_TEST_WEBHOOK_ONLY = "true";
    const callback = await request(app).get("/brikvest-test-checkout/dashboard?flutterwaveReturn=1&status=successful");
    assert.equal(callback.status, 409);
    assert.equal(callback.headers["x-brikvest-webhook-only"], "true");
    assert.match(callback.headers["content-type"], /text\/plain/);
    assert.doesNotMatch(callback.text, /<script/);
    assert.equal((await post("/return", { txRef: ref })).status, 409);
    assert.equal((await post("/attempts/1/recheck")).status, 409);
    assert.equal(calls.length, 0);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_verification_jobs")).n, 0);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_audit")).n, 0);
    assert.equal((await request(app).post(`${api}/webhook`).send({})).status, 401);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_audit")).n, 0);
    const delivered = await request(app).post(`${api}/webhook`).set("verif-hash", "offline-fixture-hash")
      .send({ event: "charge.completed", data: { id: 101, tx_ref: ref } });
    assert.equal(delivered.status, 200);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, "awaiting_admin");
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_audit WHERE event='sandbox_webhook_received'")).n, 1);
    assert.equal((await request(app).get(`${api}/state`).set("Authorization", `Bearer ${token}`)).status, 200);
    delete process.env.BRIKVEST_TEST_WEBHOOK_ONLY;
    assert.equal((await post("/return", { txRef: ref })).status, 200);
  });
  it("persists an unavailable-provider webhook job and reconciles a mismatched receipt on redelivery", async () => {
    await seedAttempt();
    const deliver = () => request(app).post(`${api}/webhook`)
      .set("verif-hash", "offline-fixture-hash")
      .send({ event: "charge.completed", data: { id: 101, tx_ref: ref, status: "successful", amount: "1200.10", currency: "NGN" } });
    // runVerification intentionally acknowledges durable queued evidence on
    // provider failure. HTTP 200 must not be mistaken for a verified receipt.
    assert.equal((await deliver()).status, 200);
    assert.equal((await scalar("SELECT status FROM flutterwave_verification_jobs")).status, "queued");
    assert.equal((await scalar("SELECT attempts FROM flutterwave_verification_jobs")).attempts, 1);
    assert.equal((await scalar("SELECT verified_at FROM flutterwave_attempts")).verified_at, null);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 0);
    mockProvider(fixture({ amount: "1200.11" }));
    assert.equal((await deliver()).status, 200);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, "reconciliation");
    assert.equal((await scalar("SELECT sold_units FROM properties")).sold_units, 0);
    assert.equal((await scalar("SELECT status FROM investment_reservations")).status, "reserved");
  });
  it("does not trust redirect success/cancellation and retains uncertain evidence for recheck", async () => {
    await seedAttempt();
    assert.equal((await post("/return", { txRef: ref, status: "successful" })).status, 400);
    const returned = await post("/return", { txRef: ref, transactionId: "99999" });
    assert.equal(returned.status, 503);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, "verification_pending");
    mockProvider(fixture({}));
    assert.equal((await post("/return", { txRef: ref, transactionId: "99999" })).status, 200);
    assert.match(calls[0].url, /verify_by_reference\?tx_ref=brk_/);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, "awaiting_admin");
    assert.equal((await post("/return", { txRef: ref })).status, 200);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 1);
  });
  it("quarantines mismatched amounts and additional actual charges without allocating", async () => {
    await seedAttempt(); mockProvider(fixture({ amount: "1200.11" }));
    await runtime.verifyTransaction("101", ref);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, "reconciliation");
    mockProvider(fixture({ id: 102 }));
    await runtime.verifyTransaction("102", ref);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 2);
    assert.equal((await scalar("SELECT sold_units FROM properties")).sold_units, 0);
  });
  for (const status of ["pending", "failed", "cancelled"]) it(`honestly retains provider ${status}, and blocks unsafe retry/reset`, async () => {
    await seedAttempt(); mockProvider(fixture({ status }));
    await runtime.verifyTransaction("101", ref);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, status === "pending" ? "verification_pending" : status);
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 409);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
    assert.equal((await scalar("SELECT sold_units FROM properties")).sold_units, 0);
  });
  it("retains uncertain checkout creation and rejects untrusted checkout URLs without fake success", async () => {
    mockProvider({ link: "https://evil.test/checkout" });
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 503);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, "verification_pending");
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 409);
  });
  it("creates another fixed reservation and resets only the requesting session's disposable records", async () => {
    const other = (await request(app).post(`${api}/session`).set("Origin", origin).send({})).body.token;
    assert.equal((await post("/reservations", { amount: 1 })).status, 400);
    assert.equal((await post("/reservations")).status, 200);
    assert.equal((await post("/reset")).status, 400);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 200);
    const ownState = (await request(app).get(`${api}/state`).set("Authorization", `Bearer ${token}`)).body;
    const otherState = (await request(app).get(`${api}/state`).set("Authorization", `Bearer ${other}`)).body;
    assert.equal(ownState.reservations.length, 1); assert.equal(otherState.reservations.length, 1);
    assert.notEqual(ownState.reservations[0].id, otherState.reservations[0].id);
  });
});

describe("Guided abandoned-checkout recovery", () => {
  it("preserves an old saved link with no transaction, receipt or charge despite repeated not-found responses", async () => {
    await seedAttempt();
    await pg.query("UPDATE flutterwave_attempts SET state='verification_pending',checkout_url=$1,checkout_expires_at=now()-interval '1 day'", [link]);
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: false, status: 404, json: async () => ({ status: "error", message: "Transaction not found" }) };
    };
    for (let i = 0; i < 2; i++) assert.equal((await post("/attempts/1/recheck")).status, 503);
    assert.equal((await post("/attempts/1/close")).status, 503);
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 409);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
    const a = await scalar("SELECT * FROM flutterwave_attempts");
    assert.equal(a.checkout_url, link);
    assert.equal(a.tx_ref, ref);
    assert.equal(a.state, "verification_pending");
    assert.equal(a.provider_transaction_id, null);
    assert.equal(a.verified_at, null);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 0);
    const safe = (await state()).reservations[0].attempts[0];
    assert.equal(safe.recovery.hasSavedLink, true);
    assert.equal(safe.recovery.chargeCount, 0);
    assert.equal(safe.recovery.canClose, false);
    assert.equal(safe.recovery.resetEligible, false);
    assert.equal(safe.recovery.resumeAllowed, false);
    assert.match(safe.recovery.explanation, /not-found/);
    assert.equal(safe.checkoutUrl, undefined);
    assert.ok(calls.every(c => c.options.method === "GET"));
  });
  for (const status of ["failed", "cancelled"]) it(`allows provider closure but retains verified ${status} evidence against late settlement`, async () => {
    await terminalAttempt(status);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 409);
    assert.equal((await state()).reservations[0].attempts[0].recovery.canClose, true);
    mockProvider(url => url.endsWith("/payments/link/disable") ? true : fixture({ status }));
    assert.equal((await post("/attempts/1/close")).status, 200);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 1);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_audit WHERE event='sandbox_terminal_link_closed'")).n, 1);
    assert.equal((await state()).reservations[0].attempts[0].recovery.resetEligible, false);
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 409);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_attempts")).n, 1);
    assert.equal((await state()).reservations.length, 1);
  });
  it("does not trust an elapsed timer or a locally assigned terminal state without charge evidence", async () => {
    await seedAttempt();
    await pg.query("UPDATE flutterwave_attempts SET state='failed',checkout_url=$1,checkout_expires_at=now()-interval '1 day'", [link]);
    assert.equal((await state()).reservations[0].attempts[0].recovery.canClose, false);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
    assert.equal((await post(`/reservations/${id}/checkout`)).status, 409);
    assert.equal(calls.length, 0);
  });
  for (const amount of [1200.1, "1200.1", "1200.11", 1200.11]) it(`uses exact monetary equality for terminal recovery amount ${JSON.stringify(amount)}`, async () => {
    await terminalAttempt();
    const eligible = Number(amount) === 1200.1;
    mockProvider(fixture({ status: "failed", amount }));
    await runtime.verifyTransaction("101", ref);
    assert.equal((await state()).reservations[0].attempts[0].recovery.canClose, eligible);
    mockProvider(url => url.endsWith("/payments/link/disable") ? true : fixture({ status: "failed", amount }));
    assert.equal((await post("/attempts/1/close")).status, eligible ? 200 : 409);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_checkout_closures")).n, eligible ? 1 : 0);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
  });
  for (const data of [{ closed: true }, "true", null]) it(`does not record closure for non-explicit acknowledgement ${JSON.stringify(data)}`, async () => {
    await terminalAttempt();
    mockProvider(url => url.endsWith("/payments/link/disable") ? data : fixture({ status: "failed" }));
    assert.equal((await post("/attempts/1/close")).status, 503);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_checkout_closures")).n, 0);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
  });
  it("accepts only the exact authenticated already-inactive provider error as closure", async () => {
    await terminalAttempt();
    const inactive = "This payment link is currently inactive";
    for (const message of ["Payment link not found", inactive]) {
      globalThis.fetch = async url => url.endsWith("/payments/link/disable")
        ? { ok: false, status: 400, json: async () => ({ status: "error", message }) }
        : { ok: true, status: 200, json: async () => ({ status: "success", data: fixture({ status: "failed" }) }) };
      assert.equal((await post("/attempts/1/close")).status, message === inactive ? 200 : 503);
    }
  });
  it("keeps terminal evidence locked until the original deadline even after closure", async () => {
    await terminalAttempt();
    await pg.query("UPDATE flutterwave_attempts SET checkout_expires_at=now()+interval '10 minutes'");
    mockProvider(url => url.endsWith("/payments/link/disable") ? true : fixture({ status: "failed" }));
    assert.equal((await post("/attempts/1/close")).status, 200);
    assert.equal((await state()).reservations[0].attempts[0].recovery.resetEligible, false);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
  });
  it("rechecks before closure and preserves a late successful receipt instead of disabling or resetting", async () => {
    await terminalAttempt();
    mockProvider(fixture({}));
    assert.equal((await post("/attempts/1/close")).status, 409);
    assert.equal((await scalar("SELECT state FROM flutterwave_attempts")).state, "awaiting_admin");
    assert.ok(calls.every(c => !c.url.endsWith("/payments/link/disable")));
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
  });
  it("does not reuse old terminal evidence when the fresh transaction verification times out", async () => {
    await terminalAttempt(); calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.includes("verify_by_reference")) return {
        ok: true, status: 200, json: async () => ({ status: "success", data: fixture({ status: "failed" }) }),
      };
      throw new Error("Offline timeout");
    };
    assert.equal((await post("/attempts/1/close")).status, 503);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_checkout_closures")).n, 0);
    assert.ok(calls.every(c => c.options.method === "GET"));
  });
  it("rejects a reference lookup that identifies a different checkout", async () => {
    await terminalAttempt(); calls = [];
    mockProvider(fixture({ tx_ref: "brk_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", status: "failed" }));
    assert.equal((await post("/attempts/1/close")).status, 503);
    assert.equal(calls.length, 1);
  });
  it("blocks reset if a success arrives after terminal closure", async () => {
    await terminalAttempt();
    mockProvider(url => url.endsWith("/payments/link/disable") ? true : fixture({ status: "failed" }));
    assert.equal((await post("/attempts/1/close")).status, 200);
    mockProvider(fixture({}));
    await runtime.verifyTransaction("101", ref);
    assert.equal((await post("/reset", { confirmation: "RESET SYNTHETIC RECORDS" })).status, 409);
    assert.equal((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n, 1);
  });
  it("rejects closure from other sessions, forged input and cross-origin callers before provider access", async () => {
    await terminalAttempt(); calls = [];
    const other = (await request(app).post(`${api}/session`).set("Origin", origin).send({})).body.token;
    assert.equal((await post("/attempts/1/close", {}, other)).status, 404);
    assert.equal((await post("/attempts/1/close", { link, status: "failed" })).status, 400);
    assert.equal((await request(app).post(`${api}/attempts/1/close`).set("Origin", "https://evil.test").set("Authorization", `Bearer ${token}`).send({})).status, 403);
    delete process.env.BRIKVEST_TEST_FLW_SECRET_KEY;
    assert.equal((await post("/attempts/1/close")).status, 503);
    assert.equal(calls.length, 0);
  });
});
