import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const ref = vi.hoisted(() => ({ db: null as any }));
vi.mock("../server/db", () => ({ get db() { return ref.db; } }));
vi.mock("../server/emailService", () => ({ sendEmail: vi.fn(() => { throw new Error("No mail allowed"); }) }));
import { exactAmount, gatewayConfig, providerRequest, webhookAuthenticated } from "../server/payments/flutterwave-provider";
import { initiateCheckout, queueVerification, runVerification, verifyTransaction, reviewGateway } from "../server/payments/flutterwave";
import { registerFlutterwaveRoutes } from "../server/payments/flutterwave-routes";
import { confirmInvestmentAtomically, approvePaymentSubmissionAtomically, cancelUnconfirmedInvestmentAtomically, cancelConfirmedInvestmentAtomically } from "../server/legal/approval";
import { DatabaseStorage } from "../server/storage";
import { dispatchGatewayConfirmation } from "../server/payments/flutterwave-notifications";
import { sendEmail } from "../server/emailService";

let pg: PGlite;
let app: express.Express;
const txRef = "brk_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const provider = (id = 101, overrides: any = {}) => ({
  id, tx_ref: txRef, status: "successful", amount: "1200.10", charged_amount: "1200.10", currency: "NGN", ...overrides,
});
const mockResponse = (data: any) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "success", data }) })));
async function scalar(query: string) { return (await pg.query<any>(query)).rows[0]; }
async function seedAttempt() {
  await pg.exec(`INSERT INTO flutterwave_attempts(reservation_id,user_id,tx_ref,expected_amount,expected_currency,mode,checkout_expires_at)
    VALUES (1,1,'${txRef}',1200.10,'NGN','test',now()+interval '10 minutes')`);
}
beforeAll(async () => {
  pg = new PGlite();
  ref.db = drizzle(pg);
  await pg.exec(`
    CREATE TABLE users(id serial PRIMARY KEY,email text,kyc_status text,account_status text,is_active boolean,kyc_full_name text,kyc_address text);
    CREATE TABLE admin_users(id serial PRIMARY KEY,is_active boolean DEFAULT true,role text DEFAULT 'admin');
    CREATE TABLE properties(id serial PRIMARY KEY,name text,location text,total_slots integer DEFAULT 10,available_slots integer DEFAULT 9,
      total_units integer DEFAULT 10,reserved_units integer DEFAULT 1,sold_units integer DEFAULT 0);
    CREATE TABLE investment_reservations(id serial PRIMARY KEY,property_id integer REFERENCES properties(id),user_id integer REFERENCES users(id),
      full_name text,email text,phone text DEFAULT '',units numeric(15,2),amount numeric(20,2),currency text,unit_price_snapshot numeric(15,2) DEFAULT 1200.10,
      unit_type_label text,funnel_stage text,status text,cost_basis jsonb,expires_at timestamptz,updated_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),
      payment_method text,payment_reference text,notes text,created_by_admin_id integer,last_reminder_sent_at timestamptz,payment_evidence_url text,kyc_extended_at timestamptz);
    CREATE TABLE payment_submissions(id serial PRIMARY KEY,reservation_id integer,user_id integer,amount numeric(20,2),currency text,
      status text DEFAULT 'pending_admin_review',reviewed_at timestamptz,reviewed_by_admin_id integer,
      proof_url text,proof_type text DEFAULT 'image',payment_method text DEFAULT 'bank_transfer',
      bank_reference text,rejection_reason text,uploaded_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now());
    CREATE TABLE ownership_certificates(id serial PRIMARY KEY,reservation_id integer UNIQUE,certificate_number text UNIQUE,verification_token text UNIQUE,
      owner_name text,property_name text,property_location text,units numeric,amount numeric,currency text,issued_by_admin_id integer);
  `);
  await pg.exec(await fs.readFile("scripts/ensure-flutterwave.sql", "utf8"));
  await pg.exec(await fs.readFile("scripts/ensure-investment-reservation-inventory-accounting.sql", "utf8"));
  app = express(); app.use(express.json());
  registerFlutterwaveRoutes(app, {
    requireAuth: (req: any, res, next) => { if (req.headers["x-user"] === "none") return res.sendStatus(401); req.user = { id: Number(req.headers["x-user"] || 1) }; next(); },
    requireAdminAuth: (req: any, res, next) => { if (req.headers["x-admin"] !== "yes") return res.sendStatus(401); req.user = { userId: 1 }; next(); },
  });
});
beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.stubEnv("NODE_ENV","test");
  vi.mocked(sendEmail).mockClear();
  vi.stubEnv("FLW_ENABLED", "true"); vi.stubEnv("FLW_MODE", "test");
  vi.stubEnv("FLW_SECRET_KEY", "FLWSECK_TEST-fixture-only"); vi.stubEnv("FLW_SECRET_HASH", "fixture-hash");
  vi.stubEnv("FLW_RETURN_ORIGIN", "https://fixture.example.test"); vi.stubEnv("FLW_CURRENCIES", "NGN,USD");
  await pg.exec(`TRUNCATE flutterwave_checkout_closures,flutterwave_confirmation_jobs,flutterwave_audit,flutterwave_verification_jobs,flutterwave_charges,
    flutterwave_attempts,investment_reservation_inventory,payment_submissions,ownership_certificates,investment_reservations,properties,users,admin_users RESTART IDENTITY CASCADE;
    INSERT INTO users VALUES(1,'fixture@example.test','approved','approved',true,'Fixture Investor','Fixture address');
    INSERT INTO admin_users(id) VALUES(1);
    INSERT INTO properties(id,name,location) VALUES(1,'Fixture Property','Test');
    INSERT INTO investment_reservations(id,property_id,user_id,full_name,email,units,amount,currency,status,expires_at)
      VALUES(1,1,1,'Fixture Investor','fixture@example.test',1,1200.10,'NGN','reserved',now()+interval '1 hour');
    INSERT INTO investment_reservation_inventory(reservation_id,property_id,reserved_units) VALUES(1,1,1);
  `);
});
afterAll(async () => { await pg.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Flutterwave configuration and trust boundaries", () => {
  it("pauses new checkouts without blocking verification, reference recovery or link closure", async () => {
    await seedAttempt();
    mockResponse(provider());
    vi.stubEnv("FLW_ENABLED", "false");
    const checkout = await request(app).post("/api/payments/flutterwave/reservations/1/checkout").send({});
    expect(checkout.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    await expect(providerRequest("payments", {})).rejects.toThrow("not enabled");
    expect(fetch).not.toHaveBeenCalled();
    await verifyTransaction("101", txRef);
    expect((await scalar("SELECT state FROM flutterwave_attempts WHERE id=1")).state).toBe("awaiting_admin");
    await providerRequest(`transactions/verify_by_reference?tx_ref=${txRef}`);
    mockResponse(true);
    await expect(providerRequest("payments/link/disable", {link:"https://checkout.flutterwave.com/v3/hosted/pay/fixture"})).resolves.toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it("still refuses unauthorized live verification even when collection is paused", async () => {
    mockResponse(provider());
    vi.stubEnv("FLW_ENABLED", "false");
    vi.stubEnv("FLW_MODE", "live");
    vi.stubEnv("FLW_LIVE_AUTHORIZED", "false");
    await expect(providerRequest("transactions/101/verify")).rejects.toThrow("not authorized");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("is disabled by default, gates live keys and validates origin", () => {
    vi.stubEnv("FLW_ENABLED", "false"); expect(() => gatewayConfig()).toThrow("not enabled");
    vi.stubEnv("FLW_ENABLED", "true"); vi.stubEnv("FLW_MODE", "live"); expect(() => gatewayConfig()).toThrow("not authorized");
    vi.stubEnv("FLW_MODE", "test"); vi.stubEnv("FLW_RETURN_ORIGIN", "https://bad.example/path"); expect(() => gatewayConfig()).toThrow("origin");
  });
  it("uses precise decimal equality and rejects extra precision", () => {
    expect(exactAmount("1200.10", 1200.1)).toBe(true);
    expect(exactAmount("9007199254740993.01","9007199254740993.02")).toBe(false);
    expect(exactAmount("1.001","1.00")).toBe(false);
    expect(exactAmount("NaN","0")).toBe(false);
    expect(webhookAuthenticated("fixture-hash")).toBe(true);
    expect(webhookAuthenticated("forged")).toBe(false);
  });
  it("accepts authorized v3 live configuration for the owner's currencies without enabling by default", () => {
    vi.stubEnv("FLW_SECRET_KEY", "FLWSECK-fixture-live-only");
    vi.stubEnv("FLW_MODE", "live");
    vi.stubEnv("FLW_LIVE_AUTHORIZED", "false");
    expect(() => gatewayConfig()).toThrow("not authorized");
    vi.stubEnv("FLW_LIVE_AUTHORIZED", "true");
    vi.stubEnv("FLW_RETURN_ORIGIN", "https://brikvest.net");
    vi.stubEnv("FLW_CURRENCIES", "NGN,USD,GBP,EUR");
    expect(gatewayConfig()).toMatchObject({
      mode: "live", origin: "https://brikvest.net", currencies: ["NGN", "USD", "GBP", "EUR"],
    });
    expect(webhookAuthenticated("fixture-hash")).toBe(true);
    vi.stubEnv("FLW_SECRET_KEY", "FLWSECK_TEST-fixture-only");
    expect(() => gatewayConfig()).toThrow("not authorized");
    vi.stubEnv("FLW_ENABLED", "false");
    expect(() => gatewayConfig()).toThrow("not enabled");
    vi.stubEnv("FLW_LIVE_AUTHORIZED", "false");
  });
  it("charges persisted pricing, never request amounts or preferred currency", async () => {
    mockResponse({ link: "https://checkout.flutterwave.com/v3/hosted/pay/fixture" });
    const response = await request(app).post("/api/payments/flutterwave/reservations/1/checkout").send({ amount: 1, currency: "USD", redirect_url: "https://evil.test" });
    expect(response.status).toBe(200);
    const payload = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(payload).toMatchObject({ amount: "1200.10", currency: "NGN", redirect_url: "https://fixture.example.test/dashboard?flutterwaveReturn=1" });
    await expect(initiateCheckout(1,1)).rejects.toThrow("already");
  });
  it("rejects other owners, missing auth, KYC, expired reservations and unsupported currencies", async () => {
    expect((await request(app).post("/api/payments/flutterwave/reservations/1/checkout").set("x-user","none")).status).toBe(401);
    await expect(initiateCheckout(1,2)).rejects.toThrow("not found");
    await pg.exec(`UPDATE users SET kyc_status='submitted'`); await expect(initiateCheckout(1,1)).rejects.toThrow("KYC");
    await pg.exec(`UPDATE users SET kyc_status='approved'; UPDATE investment_reservations SET currency='GBP'`); await expect(initiateCheckout(1,1)).rejects.toThrow("GBP");
    await pg.exec(`UPDATE investment_reservations SET currency='NGN',expires_at=now()-interval '1 hour'`); await expect(initiateCheckout(1,1)).rejects.toThrow("eligible");
  });
  it("preserves a queued confirmation across mail-paused ticks and sends once after resuming", async () => {
    await seedAttempt(); mockResponse(provider());
    await verifyTransaction("101",txRef); await reviewGateway(1,1,"approve");
    const before = await scalar("SELECT row_to_json(j) AS job FROM flutterwave_confirmation_jobs j");
    expect(before.job.state).toBe("queued");
    vi.stubEnv("NODE_ENV","production");
    vi.stubEnv("FLW_NOTIFICATION_DISPATCH","true");
    vi.stubEnv("BRIKVEST_EMAIL_DISPATCH_PAUSED","true");
    for(let tick=0;tick<3;tick++) {
      expect(await dispatchGatewayConfirmation(1)).toEqual({state:"paused"});
    }
    expect(await scalar("SELECT row_to_json(j) AS job FROM flutterwave_confirmation_jobs j")).toEqual(before);
    expect(sendEmail).not.toHaveBeenCalled();
    vi.stubEnv("BRIKVEST_EMAIL_DISPATCH_PAUSED","false");
    vi.mocked(sendEmail).mockResolvedValueOnce(true);
    await dispatchGatewayConfirmation(1);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect((await scalar("SELECT state FROM flutterwave_confirmation_jobs")).state).toBe("sent");
    await dispatchGatewayConfirmation(1);
    expect(sendEmail).toHaveBeenCalledOnce();
  });
  it("does not trust forged webhook or browser success", async () => {
    await seedAttempt(); vi.stubGlobal("fetch",vi.fn(() => Promise.reject(new Error("offline"))));
    expect((await request(app).post("/api/payments/flutterwave/webhook").set("verif-hash","forged").send({event:"charge.completed", data:{id:101,tx_ref:txRef}})).status).toBe(401);
    await request(app).post("/api/payments/flutterwave/return").send({txRef,transactionId:101,status:"successful"});
    expect((await scalar("SELECT state FROM flutterwave_attempts")).state).toBe("verification_pending");
    expect((await scalar("SELECT status FROM investment_reservations")).status).toBe("reserved");
    expect((await scalar("SELECT status FROM flutterwave_verification_jobs")).status).toBe("queued");
  });
});
describe("Verification, reconciliation and explicit review", () => {
  it("successful verification only queues admin review; duplicate callbacks allocate nothing", async () => {
    await seedAttempt(); mockResponse(provider());
    await Promise.all([verifyTransaction("101",txRef),verifyTransaction("101",txRef)]);
    expect((await scalar("SELECT state FROM flutterwave_attempts")).state).toBe("awaiting_admin");
    expect((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n).toBe(1);
    expect((await scalar("SELECT sold_units FROM properties")).sold_units).toBe(0);
    expect((await scalar("SELECT count(*)::int AS n FROM ownership_certificates")).n).toBe(0);
  });
  it("only one concurrent review confirms, certificates and notifications are durable and unique", async () => {
    await seedAttempt(); mockResponse(provider()); await verifyTransaction("101",txRef);
    const outcomes = await Promise.allSettled([reviewGateway(1,1,"approve"),reviewGateway(1,1,"approve")]);
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    expect((await scalar("SELECT status FROM investment_reservations")).status).toBe("converted_to_investment");
    expect(await scalar("SELECT reserved_units,sold_units FROM properties")).toMatchObject({reserved_units:0,sold_units:1});
    expect((await scalar("SELECT count(*)::int AS n FROM ownership_certificates")).n).toBe(1);
    expect((await scalar("SELECT count(*)::int AS n FROM flutterwave_confirmation_jobs")).n).toBe(1);
    expect((await scalar("SELECT event FROM flutterwave_audit WHERE event='approved'")).event).toBe("approved");
  });
  it("keeps ambiguous SMTP delivery quarantined, never automatically sending twice", async () => {
    await seedAttempt(); mockResponse(provider()); await verifyTransaction("101",txRef); await reviewGateway(1,1,"approve");
    vi.stubEnv("NODE_ENV","production"); vi.stubEnv("FLW_NOTIFICATION_DISPATCH","true");
    await Promise.all([dispatchGatewayConfirmation(1),dispatchGatewayConfirmation(1)]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await scalar("SELECT state FROM flutterwave_confirmation_jobs")).state).toBe("uncertain");
    await dispatchGatewayConfirmation(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{amount:"1200.11",charged_amount:"1200.11"},"mismatch"],
    [{currency:"USD"},"mismatch"],
    [{charged_amount:"1210.10"},"mismatch"],
  ])("quarantines exact amount, currency and surcharge mismatches %o", async (overrides, reason) => {
    await seedAttempt(); mockResponse(provider(101,overrides)); await verifyTransaction("101",txRef);
    expect(await scalar("SELECT state,reason FROM flutterwave_attempts")).toMatchObject({state:"reconciliation",reason:expect.stringContaining(reason)});
    await expect(reviewGateway(1,1,"approve")).rejects.toThrow("not eligible");
  });
  it("preserves verified inventory after ordinary expiry but not abandoned checkouts", async () => {
    await seedAttempt(); mockResponse(provider()); await verifyTransaction("101",txRef);
    await pg.exec(`UPDATE investment_reservations SET expires_at=now()-interval '1 hour'`);
    expect((await new DatabaseStorage().cleanupExpiredReservations()).cancelled).toBe(0);
    await pg.exec(`UPDATE flutterwave_attempts SET state='initiated',verified_at=NULL`);
    expect((await new DatabaseStorage().cleanupExpiredReservations()).cancelled).toBe(1);
  });
  it("routes late, changed KYC and already allocated charges to reconciliation", async () => {
    await seedAttempt(); await pg.exec(`UPDATE investment_reservations SET expires_at=now()-interval '1 hour'`);
    mockResponse(provider()); await verifyTransaction("101",txRef);
    expect((await scalar("SELECT state FROM flutterwave_attempts")).state).toBe("reconciliation");
    expect((await scalar("SELECT sold_units FROM properties")).sold_units).toBe(0);
  });
  it("quarantines changed KYC and rejects changed account eligibility at approval", async () => {
    await seedAttempt(); await pg.exec(`UPDATE users SET kyc_status='submitted'`);
    mockResponse(provider()); await verifyTransaction("101",txRef);
    expect(await scalar("SELECT state,reason FROM flutterwave_attempts")).toMatchObject({state:"reconciliation",reason:"Investor eligibility changed"});
    await pg.exec(`UPDATE users SET kyc_status='approved'; UPDATE flutterwave_attempts SET state='awaiting_admin'; UPDATE users SET is_active=false`);
    await expect(reviewGateway(1,1,"approve")).rejects.toThrow("eligibility changed");
  });
  it("serializes manual versus gateway approvals without duplicate inventory or certificate effects", async () => {
    await seedAttempt();
    await pg.exec(`INSERT INTO payment_submissions(reservation_id,user_id,amount,currency,status) VALUES(1,1,1200.10,'NGN','pending_admin_review')`);
    mockResponse(provider());
    await Promise.allSettled([verifyTransaction("101",txRef),approvePaymentSubmissionAtomically(1,1)]);
    expect((await scalar("SELECT state FROM flutterwave_attempts")).state).toBe("reconciliation");
    await expect(reviewGateway(1,1,"approve")).rejects.toThrow();
    expect((await scalar("SELECT sold_units FROM properties")).sold_units).toBeLessThanOrEqual(1);
    expect((await scalar("SELECT count(*)::int AS n FROM ownership_certificates")).n).toBe(0);
  });
  it("serializes expiry versus verification and never allocates late funds", async () => {
    await seedAttempt(); await pg.exec(`UPDATE investment_reservations SET expires_at=now()-interval '1 hour'`);
    mockResponse(provider());
    await Promise.all([new DatabaseStorage().cleanupExpiredReservations(),verifyTransaction("101",txRef)]);
    expect((await scalar("SELECT state FROM flutterwave_attempts")).state).toBe("reconciliation");
    expect((await scalar("SELECT sold_units FROM properties")).sold_units).toBe(0);
  });
  it("retains late success from a failed checkout even after a replacement checkout exists", async () => {
    await seedAttempt(); mockResponse(provider(101,{status:"failed"})); await verifyTransaction("101",txRef);
    await pg.exec(`INSERT INTO flutterwave_attempts(reservation_id,user_id,tx_ref,expected_amount,expected_currency,mode,checkout_expires_at,checkout_url)
      VALUES(1,1,'brk_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',1200.10,'NGN','test',now()+interval '10 minutes','https://checkout.flutterwave.com/v3/hosted/pay/replacement')`);
    vi.stubGlobal("fetch",vi.fn(async (url: string) => ({ok:true,json:async () => ({status:"success",data:url.endsWith("/payments/link/disable") ? true : provider()})})));
    await verifyTransaction("101",txRef);
    expect((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges WHERE provider_status='successful'")).n).toBe(1);
    expect((await scalar("SELECT sold_units FROM properties")).sold_units).toBe(0);
    expect(await scalar("SELECT state,reason FROM flutterwave_attempts WHERE id=1")).toMatchObject({state:"reconciliation",reason:expect.stringContaining("replacement checkout")});
    expect((await scalar("SELECT state FROM flutterwave_attempts WHERE id=2")).state).toBe("reconciliation");
    expect((await scalar("SELECT status FROM flutterwave_checkout_closures WHERE attempt_id=2")).status).toBe("done");
    expect((fetch as any).mock.calls.find((c: any) => c[0].endsWith("/payments/link/disable"))[1].body).toContain("replacement");
    await expect(initiateCheckout(1,1)).rejects.toThrow("already");
    await expect(reviewGateway(1,1,"approve")).rejects.toThrow("not eligible");
    const investor = await request(app).get("/api/payments/flutterwave/reservations/1");
    expect(investor.body.attempts.map((a:any)=>a.state)).toEqual(["reconciliation","reconciliation"]);
    const admin = await request(app).get("/api/admin/payments/flutterwave").set("x-admin","yes");
    expect(admin.body.find((a:any)=>a.id===2).checkoutClosure.status).toBe("done");
    expect(admin.body.every((a:any)=>a.state!=="awaiting_admin")).toBe(true);
  });
  it("forbids a replacement while the failed hosted session can still collect retries", async () => {
    await seedAttempt(); mockResponse(provider(101,{status:"failed"})); await verifyTransaction("101",txRef);
    await expect(initiateCheckout(1,1)).rejects.toThrow("already");
    await expect(cancelUnconfirmedInvestmentAtomically(1)).rejects.toThrow("reconciled before cancellation");
    await pg.exec(`UPDATE flutterwave_attempts SET checkout_expires_at=now()-interval '1 minute'`);
    mockResponse({link:"https://checkout.flutterwave.com/v3/hosted/pay/replacement"});
    expect((await initiateCheckout(1,1)).checkoutUrl).toContain("replacement");
  });
  it("retains failed link closures for retry and accepts the documented already-inactive result", async () => {
    await seedAttempt(); await pg.exec(`UPDATE flutterwave_attempts SET state='failed'`);
    await pg.exec(`INSERT INTO flutterwave_attempts(reservation_id,user_id,tx_ref,expected_amount,expected_currency,mode,checkout_expires_at,checkout_url)
      VALUES(1,1,'brk_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',1200.10,'NGN','test',now()+interval '10 minutes','https://checkout.flutterwave.com/v3/hosted/pay/replacement')`);
    vi.stubGlobal("fetch",vi.fn(async (url:string) => url.endsWith("/link/disable")
      ? {ok:false,status:503,json:async()=>({status:"error"})}
      : {ok:true,json:async()=>({status:"success",data:provider()})}));
    await verifyTransaction("101",txRef);
    expect(await scalar("SELECT status,attempts FROM flutterwave_checkout_closures")).toMatchObject({status:"queued",attempts:1});
    expect((await scalar("SELECT state FROM flutterwave_attempts WHERE id=1")).state).toBe("reconciliation");
    await pg.exec(`UPDATE flutterwave_checkout_closures SET next_attempt_at=now()`);
    vi.stubGlobal("fetch",vi.fn(async (url:string) => url.endsWith("/link/disable")
      ? {ok:false,status:400,json:async()=>({status:"error",message:"This payment link is currently inactive",data:null})}
      : {ok:true,json:async()=>({status:"success",data:provider()})}));
    await verifyTransaction("101",txRef);
    expect((await scalar("SELECT status FROM flutterwave_checkout_closures")).status).toBe("done");
  });
  it.each(["initiated","verification_pending","awaiting_admin","reconciliation","rejected"])("blocks and serializes cancellation with %s gateway evidence", async state => {
    await seedAttempt();
    await pg.exec(`UPDATE flutterwave_attempts SET state='${state}'`);
    await expect(cancelUnconfirmedInvestmentAtomically(1)).rejects.toThrow("reconciled before cancellation");
    await expect(new DatabaseStorage().updateReservation(1,{status:"cancelled"})).rejects.toThrow("reconciled before cancellation");
    expect((await scalar("SELECT status FROM investment_reservations")).status).toBe("reserved");
    expect(await scalar("SELECT reserved_units,available_slots FROM properties")).toMatchObject({reserved_units:1,available_slots:9});
  });
  it("cancellation and verification races preserve paid inventory; unencumbered bank reservations cancel once", async () => {
    await seedAttempt(); mockResponse(provider());
    const outcomes = await Promise.allSettled([cancelUnconfirmedInvestmentAtomically(1),verifyTransaction("101",txRef)]);
    expect(outcomes[0].status).toBe("rejected");
    expect((await scalar("SELECT status FROM investment_reservations")).status).toBe("reserved");
    expect((await scalar("SELECT reserved_units FROM properties")).reserved_units).toBe(1);
    await pg.exec(`DELETE FROM flutterwave_audit; DELETE FROM flutterwave_charges; DELETE FROM flutterwave_attempts;`);
    await cancelUnconfirmedInvestmentAtomically(1);
    await expect(cancelUnconfirmedInvestmentAtomically(1)).rejects.toThrow("Only active");
    expect(await scalar("SELECT reserved_units,available_slots FROM properties")).toMatchObject({reserved_units:0,available_slots:10});
    const source = await fs.readFile("server/routes.ts","utf8");
    const handler = source.slice(source.indexOf("app.put('/api/admin/investments/:id/cancel'"),source.indexOf("// Password reset routes"));
    expect(handler).toContain("cancelUnconfirmedInvestmentAtomically");
    expect(handler).not.toContain("storage.updatePropertyUnitCounts");
  });
  it("blocks cancellation of a confirmed gateway holding without financial reconciliation", async () => {
    await seedAttempt(); mockResponse(provider()); await verifyTransaction("101",txRef); await reviewGateway(1,1,"approve");
    await expect(cancelConfirmedInvestmentAtomically(1,1)).rejects.toThrow("reconciled before cancellation");
    expect((await scalar("SELECT sold_units FROM properties")).sold_units).toBe(1);
  });
  it("withholds an in-flight replacement link when the earlier payment succeeds", async () => {
    await seedAttempt(); mockResponse(provider(101,{status:"failed"})); await verifyTransaction("101",txRef);
    await pg.exec(`UPDATE flutterwave_attempts SET checkout_expires_at=now()-interval '1 minute'`);
    let release: (value:any)=>void = () => {};
    let created: ()=>void = () => {};
    const creating = new Promise<void>(r=>created=r);
    const held = new Promise<any>(r=>release=r);
    vi.stubGlobal("fetch",vi.fn(async (url:string) => {
      if (url.endsWith("/payments")) { created(); return held; }
      return {ok:true,json:async()=>({status:"success",data:url.endsWith("/link/disable") ? true : provider()})};
    }));
    const checkout = initiateCheckout(1,1);
    await creating;
    await verifyTransaction("101",txRef);
    release({ok:true,json:async()=>({status:"success",data:{link:"https://checkout.flutterwave.com/v3/hosted/pay/inflight"}})});
    await expect(checkout).rejects.toThrow("do not pay again");
    expect((await scalar("SELECT state FROM flutterwave_attempts WHERE id=2")).state).toBe("reconciliation");
    expect((await scalar("SELECT status FROM flutterwave_checkout_closures WHERE attempt_id=2")).status).toBe("done");
  });
  it("authenticates webhooks, owner status and admin reviews without exposing checkout tokens", async () => {
    await seedAttempt(); mockResponse(provider());
    const webhook = await request(app).post("/api/payments/flutterwave/webhook").set("verif-hash","fixture-hash").send({event:"charge.completed",data:{id:101,tx_ref:txRef}});
    expect(webhook.status).toBe(200);
    expect((await request(app).get("/api/payments/flutterwave/reservations/1").set("x-user","2")).status).toBe(404);
    const own = await request(app).get("/api/payments/flutterwave/attempts");
    expect(own.body[0].checkoutUrl).toBeUndefined();
    expect(own.body[0].state).toBe("awaiting_admin");
    expect((await request(app).put("/api/admin/payments/flutterwave/1/approve")).status).toBe(401);
    expect((await request(app).put("/api/admin/payments/flutterwave/1/approve").set("x-admin","yes")).status).toBe(200);
  });
  it("records duplicate actual charges without duplicate allocation", async () => {
    await seedAttempt(); mockResponse(provider()); await verifyTransaction("101",txRef); await reviewGateway(1,1,"approve");
    mockResponse(provider(102)); await verifyTransaction("102",txRef);
    expect((await scalar("SELECT state FROM flutterwave_attempts")).state).toBe("reconciliation");
    expect((await scalar("SELECT count(*)::int AS n FROM flutterwave_charges")).n).toBe(2);
    expect((await scalar("SELECT sold_units FROM properties")).sold_units).toBe(1);
  });
  it("blocks manual approval and proof submission against collected gateway evidence", async () => {
    await seedAttempt(); mockResponse(provider()); await verifyTransaction("101",txRef);
    await expect(confirmInvestmentAtomically(1,1)).rejects.toThrow("Payment Reviews");
    await pg.exec(`INSERT INTO payment_submissions(reservation_id,user_id,amount,currency,status) VALUES(1,1,1200.10,'NGN','pending_admin_review')`);
    await expect(approvePaymentSubmissionAtomically(1,1)).rejects.toThrow("collected gateway");
    await expect(new DatabaseStorage().createPaymentSubmission({reservationId:1,userId:1,proofUrl:"/fixture",amount:"1200.10",currency:"NGN"})).rejects.toThrow("collected");
  });
  it.each(["initiated","verification_pending","failed","cancelled"])("blocks a second payment method while a %s hosted checkout remains unresolved or unexpired", async state => {
    await seedAttempt(); await pg.exec(`UPDATE flutterwave_attempts SET state='${state}'`);
    await expect(new DatabaseStorage().createPaymentSubmission({reservationId:1,userId:1,proofUrl:"/fixture",amount:"1200.10",currency:"NGN"})).rejects.toThrow("collected or unresolved");
    await expect(confirmInvestmentAtomically(1,1)).rejects.toThrow("Payment Reviews");
    expect((await scalar("SELECT count(*)::int AS n FROM payment_submissions")).n).toBe(0);
    expect((await scalar("SELECT sold_units FROM properties")).sold_units).toBe(0);
  });
  it("allows unchanged bank proof after an unsuccessful session safely expires", async () => {
    await seedAttempt(); await pg.exec(`UPDATE flutterwave_attempts SET state='failed',checkout_expires_at=now()-interval '1 minute'`);
    await new DatabaseStorage().createPaymentSubmission({reservationId:1,userId:1,proofUrl:"/fixture",amount:"1200.10",currency:"NGN"});
    expect((await scalar("SELECT count(*)::int AS n FROM payment_submissions")).n).toBe(1);
  });
  it("rejection preserves charge evidence, protects inventory and forbids repayment", async () => {
    await seedAttempt(); mockResponse(provider()); await verifyTransaction("101",txRef);
    await reviewGateway(1,1,"reject","Receipt needs investigation");
    await expect(initiateCheckout(1,1)).rejects.toThrow("already");
    expect((await scalar("SELECT event FROM flutterwave_audit WHERE event='rejected_no_refund_issued'")).event).toBe("rejected_no_refund_issued");
    expect((await scalar("SELECT status FROM investment_reservations")).status).toBe("reserved");
  });
  it("retains retryable work and recovers from provider failures", async () => {
    await seedAttempt(); await queueVerification("101",txRef);
    vi.stubGlobal("fetch",vi.fn(() => Promise.reject(new Error("offline")))); await runVerification("101",txRef);
    expect(await scalar("SELECT status,attempts FROM flutterwave_verification_jobs")).toMatchObject({status:"queued",attempts:1});
    mockResponse(provider()); await runVerification("101",txRef);
    expect((await scalar("SELECT status FROM flutterwave_verification_jobs")).status).toBe("done");
  });
  it("retains failed and provider-cancelled states without allocating", async () => {
    await seedAttempt(); mockResponse(provider(101,{status:"cancelled"})); await verifyTransaction("101",txRef);
    expect((await scalar("SELECT state FROM flutterwave_attempts")).state).toBe("cancelled");
    mockResponse(provider(101,{status:"failed"})); await verifyTransaction("101",txRef);
    expect((await scalar("SELECT state FROM flutterwave_attempts")).state).toBe("failed");
  });
  it("preserves successful unmatched charges and forbids forged ID/reference attribution", async () => {
    await seedAttempt(); mockResponse(provider(101,{tx_ref:"unknown-provider-ref"})); await verifyTransaction("101",txRef);
    expect((await scalar("SELECT attempt_id FROM flutterwave_charges")).attempt_id).toBeNull();
    expect((await scalar("SELECT state FROM flutterwave_attempts")).state).toBe("initiated");
  });
  it("immutable pricing cannot be rewritten and schema rollout is idempotent", async () => {
    await seedAttempt();
    await expect(pg.exec("UPDATE flutterwave_attempts SET expected_amount=1")).rejects.toThrow("immutable");
    await pg.exec(await fs.readFile("scripts/ensure-flutterwave.sql","utf8"));
    expect((await scalar("SELECT expected_amount FROM flutterwave_attempts")).expected_amount).toBe("1200.10");
  });
});
