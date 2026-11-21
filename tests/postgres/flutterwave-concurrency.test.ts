import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const ref = vi.hoisted(() => ({ db: null as any }));
vi.mock("../../server/db", () => ({ get db() { return ref.db; } }));
vi.mock("../../server/emailService", () => ({
  sendEmail: vi.fn(() => { throw new Error("Application mail forbidden in concurrency tests"); }),
}));
import { sendEmail } from "../../server/emailService";
import { verifyTransaction, reviewGateway, initiateCheckout } from "../../server/payments/flutterwave";
import { registerFlutterwaveRoutes } from "../../server/payments/flutterwave-routes";
import { closeQueuedCheckouts } from "../../server/payments/flutterwave-checkout-closure";
import {
  approvePaymentSubmissionAtomically, confirmInvestmentAtomically,
  cancelUnconfirmedInvestmentAtomically,
} from "../../server/legal/approval";

const txRef = "brk_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let pool: pg.Pool;
let app: express.Express;
const actors = new AsyncLocalStorage<string>();
const dialect = new PgDialect();
const databaseErrors: string[] = [];
const pids = new Map<string, number>();
type Outcome =
  | { status: "fulfilled"; value: any; reason?: never }
  | { status: "rejected"; reason: any; value?: never };
let firstLocked: (() => void) | undefined;
let releaseFirst: Promise<void> | undefined;

async function query(text: string, values?: any[]) {
  return (await pool.query(text, values)).rows;
}
async function one(text: string) { return (await query(text))[0]; }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function waitFor(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error(`Timed out: ${description}`);
}

// The first actor pauses AFTER acquiring the real holding/property row locks.
// The second must be observed waiting on that backend in pg_blocking_pids().
// No sleep is used as proof that the interleaving happened.
async function race(first: () => Promise<any>, second: () => Promise<any>) {
  const acquired = deferred(), release = deferred();
  firstLocked = acquired.resolve;
  releaseFirst = release.promise;
  pids.clear();
  const a = actors.run("first", () => first());
  // Attach rejection handlers immediately, including failures before the gate.
  const aResult = a.then<Outcome, Outcome>(value => ({ status: "fulfilled", value }),
    reason => ({ status: "rejected", reason }));
  let bResult: typeof aResult | undefined;
  try {
    await Promise.race([acquired.promise, a.then(() => { throw new Error("First actor missed lock gate"); })]);
    const b = actors.run("second", () => second());
    bResult = b.then<Outcome, Outcome>(value => ({ status: "fulfilled", value }),
      reason => ({ status: "rejected", reason }));
    await waitFor(async () => {
      const firstPid = pids.get("first"), secondPid = pids.get("second");
      if (!firstPid || !secondPid) return false;
      expect(secondPid).not.toBe(firstPid);
      const rows = await query("SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [firstPid, secondPid]);
      return rows[0].blocked;
    }, "second real PostgreSQL backend blocked by first holding lock");
  } finally {
    release.resolve();
    firstLocked = undefined;
    releaseFirst = undefined;
    await Promise.all([aResult, bResult]);
  }
  return Promise.all([aResult, bResult!]);
}

function providerMock() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const id = url.match(/^https:\/\/api\.flutterwave\.com\/v3\/transactions\/(101|102)\/verify$/)?.[1];
    if (id) {
      return { ok: true, json: async () => ({ status: "success", data: {
        id: Number(id), tx_ref: txRef, status: "successful", amount: "1200.10",
        charged_amount: "1200.10", currency: "NGN",
      } }) };
    }
    if (url === "https://api.flutterwave.com/v3/payments/link/disable") {
      return { ok: true, json: async () => ({ status: "success", data: true }) };
    }
    throw new Error(`Forbidden network request: ${url}`);
  }));
}
async function seedAttempt(state = "initiated") {
  await query(`INSERT INTO flutterwave_attempts
    (reservation_id,user_id,tx_ref,expected_amount,expected_currency,mode,checkout_expires_at,state)
    VALUES (1,1,$1,1200.10,'NGN','test',now()+interval '10 minutes',$2)`, [txRef, state]);
}
async function seedProof() {
  await query(`INSERT INTO payment_submissions(reservation_id,user_id,amount,currency)
    VALUES(1,1,1200.10,'NGN')`);
}
async function expectInventory(sold: number) {
  expect(await one("SELECT reserved_units,sold_units,available_slots FROM properties WHERE id=1"))
    .toEqual({ reserved_units: 1 - sold, sold_units: sold, available_slots: 9 });
  expect((await one("SELECT reserved_units::text AS n FROM investment_reservation_inventory WHERE reservation_id=1")).n)
    .toBe(sold ? "0.00" : "1.00");
  expect((await one("SELECT status FROM investment_reservations WHERE id=1")).status)
    .toBe(sold ? "converted_to_investment" : "reserved");
}
async function expectGatewayEffects(n: number) {
  for (const table of ["ownership_certificates", "flutterwave_confirmation_jobs"]) {
    expect((await one(`SELECT count(*)::int AS n FROM ${table}`)).n).toBe(n);
  }
  expect((await one("SELECT count(*)::int AS n FROM flutterwave_audit WHERE event='approved'")).n).toBe(n);
}

beforeAll(async () => {
  const root = process.env.FLW_PG_TEST_ROOT || "";
  const socket = process.env.FLW_PG_TEST_SOCKET || "";
  const token = process.env.FLW_PG_TEST_TOKEN || "";
  if (!root.startsWith(path.join(tmpdir(), "brikvest-pg-race-")) ||
      socket !== path.join(root, "socket") || !token ||
      await fs.readFile(path.join(root, "disposable-test-marker"), "utf8") !== token) {
    throw new Error("Run pnpm test:flutterwave:postgres; existing database connections are forbidden.");
  }
  pool = new pg.Pool({
    host: socket, port: 5432, user: "race_test", database: "brikvest_disposable_concurrency",
    password: "", ssl: false, max: 8, connectionTimeoutMillis: 3000,
    options: "-c statement_timeout=8000 -c lock_timeout=6000 -c idle_in_transaction_session_timeout=10000",
  });
  const identity = await one("SELECT current_database() AS db, inet_server_addr() AS addr, current_setting('data_directory') AS dir");
  expect(identity).toEqual({ db: "brikvest_disposable_concurrency", addr: null, dir: path.join(root, "data") });
  await query(await fs.readFile("tests/postgres/flutterwave-fixture.sql", "utf8"));
  const paymentDDL = await fs.readFile("scripts/ensure-flutterwave.sql", "utf8");
  // Install managed tables, then the exact newly reviewed console guard draft.
  // Only its database-name assertion changes; all guard bodies stay unchanged.
  await query(paymentDDL.split("CREATE OR REPLACE FUNCTION")[0] + "COMMIT;");
  await query(await fs.readFile("scripts/ensure-investment-reservation-inventory-accounting.sql", "utf8"));
  const draft = await fs.readFile("docs/flutterwave-production-guards-console.md", "utf8");
  const guardSQL = draft.match(/```sql\n([\s\S]*?)```/)?.[1];
  if (!guardSQL?.includes("current_database() <> 'neondb'")) throw new Error("Reviewed guard draft changed");
  await query(guardSQL.replace("current_database() <> 'neondb'", "current_database() <> 'brikvest_disposable_concurrency'"));
  expect(await query(`SELECT p.proname,md5(p.prosrc) AS hash,t.tgenabled
    FROM pg_proc p JOIN pg_trigger t ON t.tgfoid=p.oid
    WHERE p.proname IN ('protect_flutterwave_expected','guard_holding_cost_basis')
    ORDER BY p.proname`)).toEqual([
    { proname: "guard_holding_cost_basis", hash: "9639dd1f6a65cf9bff769a4e3bb3eba3", tgenabled: "O" },
    { proname: "protect_flutterwave_expected", hash: "e6e632dfa8a00362e9d70f45a46b7d02", tgenabled: "O" },
  ]);
  const db = drizzle(pool);
  ref.db = {
    execute: db.execute.bind(db),
    transaction: async (callback: any) => {
      const client = await pool.connect();
      const actor = actors.getStore();
      try {
        if (actor) {
          const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          pids.set(actor, result.rows[0].pid);
        }
        return await drizzle(client).transaction(async tx => {
          const execute = tx.execute.bind(tx);
          let gated = false;
          tx.execute = (async (statement: any) => {
            try {
              const result = await execute(statement);
              const text = dialect.sqlToQuery(statement).sql;
              if (actor === "first" && !gated && firstLocked && /FOR UPDATE OF r\s*,\s*p/i.test(text)) {
                gated = true;
                firstLocked();
                await releaseFirst;
              }
              return result;
            } catch (error: any) {
              if (["40P01", "55P03", "57014", "25P02"].includes(error.code)) databaseErrors.push(error.code);
              throw error;
            }
          }) as typeof tx.execute;
          return callback(tx);
        });
      } finally { client.release(); }
    },
  };
  app = express(); app.use(express.json());
  registerFlutterwaveRoutes(app, {
    requireAuth: (req: any, _res, next) => { req.user = { id: 1 }; next(); },
    requireAdminAuth: (req: any, _res, next) => { req.user = { userId: 1 }; next(); },
  });
});
beforeEach(async () => {
  vi.stubEnv("FLW_ENABLED", "false");
  vi.stubEnv("FLW_MODE", "test");
  vi.stubEnv("FLW_SECRET_KEY", "FLWSECK_TEST-synthetic-only");
  vi.stubEnv("FLW_SECRET_HASH", "synthetic-hash");
  vi.stubEnv("FLW_RETURN_ORIGIN", "https://fixture.example.test");
  vi.stubEnv("FLW_CURRENCIES", "NGN");
  vi.stubEnv("FLW_NOTIFICATION_DISPATCH", "false");
  vi.stubEnv("FLW_WORKER_ENABLED", "false");
  vi.stubEnv("BRIKVEST_EMAIL_DISPATCH_PAUSED", "true");
  vi.stubEnv("LEGAL_DISPATCH_PAUSED", "true");
  databaseErrors.length = 0;
  vi.mocked(sendEmail).mockClear();
  providerMock();
  await query(`TRUNCATE flutterwave_checkout_closures,flutterwave_confirmation_jobs,flutterwave_audit,
    flutterwave_verification_jobs,flutterwave_charges,flutterwave_attempts,investment_reservation_inventory,
    payment_submissions,ownership_certificates,investment_reservations,properties,users,admin_users RESTART IDENTITY CASCADE;
    INSERT INTO users VALUES(1,'synthetic@example.test','approved','approved',true,'Synthetic Investor','Synthetic address');
    INSERT INTO admin_users(id) VALUES(1);
    INSERT INTO properties(id,name,location) VALUES(1,'Synthetic Property','Test only');
    INSERT INTO investment_reservations(id,property_id,user_id,full_name,email,units,amount,currency,status,expires_at)
      VALUES(1,1,1,'Synthetic Investor','synthetic@example.test',1,1200.10,'NGN','reserved',now()+interval '1 hour');
    INSERT INTO investment_reservation_inventory(reservation_id,property_id,reserved_units) VALUES(1,1,1)`);
});
afterEach(() => {
  expect(databaseErrors, "No deadlocks, lock timeouts, aborted transactions or hidden verification failures").toEqual([]);
  expect(sendEmail).not.toHaveBeenCalled();
  for (const [url] of vi.mocked(fetch).mock.calls) {
    expect(String(url)).toMatch(/^https:\/\/api\.flutterwave\.com\/v3\/(?:transactions\/10[12]\/verify|payments\/link\/disable)$/);
  }
});
afterAll(async () => { await pool?.end(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("real PostgreSQL payment interleavings with collection paused", () => {
  it("serializes webhook and browser verification without allocating or duplicating receipts", async () => {
    await seedAttempt();
    const outcomes = await race(
      async () => request(app).post("/api/payments/flutterwave/webhook").set("verif-hash", "synthetic-hash")
        .send({ event: "charge.completed", data: { id: 101, tx_ref: txRef } }),
      async () => request(app).post("/api/payments/flutterwave/return").send({ txRef, transactionId: 101 }),
    );
    expect(outcomes.map(o => o.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(outcomes.map(o => o.value.status)).toEqual([200, 200]);
    expect((await one("SELECT count(*)::int AS n FROM flutterwave_charges")).n).toBe(1);
    expect((await one("SELECT count(*)::int AS n FROM flutterwave_audit WHERE event='charge_verified'")).n).toBe(1);
    expect((await one("SELECT status FROM flutterwave_verification_jobs")).status).toBe("done");
    expect((await one("SELECT state FROM flutterwave_attempts")).state).toBe("awaiting_admin");
    await expectInventory(0); await expectGatewayEffects(0);
    await expect(initiateCheckout(1, 1)).rejects.toThrow("not enabled");
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith("/verify"))).toBe(true);
  });

  it("allows exactly one of two administrator approvals, with one certificate and queued notification", async () => {
    await seedAttempt(); await verifyTransaction("101", txRef);
    const outcomes = await race(() => reviewGateway(1, 1, "approve"), () => reviewGateway(1, 1, "approve"));
    expect(outcomes.map(o => o.status)).toEqual(["fulfilled", "rejected"]);
    expect(outcomes[1].reason.message).toContain("not eligible");
    await expectInventory(1); await expectGatewayEffects(1);
    expect((await one("SELECT state FROM flutterwave_attempts")).state).toBe("approved");
    expect((await one("SELECT state FROM flutterwave_confirmation_jobs")).state).toBe("queued");
    expect((await one("SELECT cost_basis->>'acquisitionAmount' AS amount FROM investment_reservations")).amount).toBe("1200.10");
  });

  it.each(["verification", "approval"])("serializes duplicate receipt verification versus admin approval, %s first", async first => {
    await seedAttempt(); await verifyTransaction("101", txRef);
    const verify = () => verifyTransaction("101", txRef), approve = () => reviewGateway(1, 1, "approve");
    const outcomes = await race(first === "verification" ? verify : approve, first === "verification" ? approve : verify);
    expect(outcomes.map(o => o.status)).toEqual(["fulfilled", "fulfilled"]);
    await expectInventory(1); await expectGatewayEffects(1);
    expect((await one("SELECT state FROM flutterwave_attempts")).state).toBe("approved");
    expect((await one("SELECT count(*)::int AS n FROM flutterwave_charges")).n).toBe(1);
  });

  it.each(["receipt", "approval"])("retains a second actual charge racing approval without allocating twice, %s first", async first => {
    await seedAttempt(); await verifyTransaction("101", txRef);
    const receipt = () => verifyTransaction("102", txRef), approve = () => reviewGateway(1, 1, "approve");
    const outcomes = await race(first === "receipt" ? receipt : approve, first === "receipt" ? approve : receipt);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1].status).toBe(first === "receipt" ? "rejected" : "fulfilled");
    if (first === "receipt") expect(outcomes[1].reason.message).toContain("not eligible");
    expect((await one("SELECT count(*)::int AS n FROM flutterwave_charges")).n).toBe(2);
    expect((await one("SELECT state FROM flutterwave_attempts")).state).toBe("reconciliation");
    await expectInventory(first === "receipt" ? 0 : 1);
    await expectGatewayEffects(first === "receipt" ? 0 : 1);
  });

  it.each(["verification", "manual"])("keeps conflicting manual proof and new gateway receipt unallocated, %s first", async first => {
    await seedAttempt(); await seedProof();
    const verify = () => verifyTransaction("101", txRef), manual = () => approvePaymentSubmissionAtomically(1, 1);
    const outcomes = await race(first === "verification" ? verify : manual, first === "verification" ? manual : verify);
    expect(outcomes[first === "verification" ? 0 : 1].status).toBe("fulfilled");
    const rejected = outcomes[first === "verification" ? 1 : 0];
    expect(rejected.status).toBe("rejected");
    expect(rejected.reason.message).toContain("collected gateway");
    expect((await one("SELECT state FROM flutterwave_attempts")).state).toBe("reconciliation");
    expect((await one("SELECT status FROM payment_submissions")).status).toBe("pending_admin_review");
    await expectInventory(0); await expectGatewayEffects(0);
  });

  it.each(["gateway", "manual"])("refuses both approval methods when proof competes with a verified receipt, %s first", async first => {
    await seedAttempt(); await verifyTransaction("101", txRef); await seedProof();
    const gateway = () => reviewGateway(1, 1, "approve"), manual = () => approvePaymentSubmissionAtomically(1, 1);
    const outcomes = await race(first === "gateway" ? gateway : manual, first === "gateway" ? manual : gateway);
    expect(outcomes.map(o => o.status)).toEqual(["rejected", "rejected"]);
    expect(outcomes[first === "gateway" ? 0 : 1].reason.message).toContain("Competing payments");
    expect(outcomes[first === "gateway" ? 1 : 0].reason.message).toContain("collected gateway");
    await expectInventory(0); await expectGatewayEffects(0);
  });

  it("allows only one concurrent manual proof approval when no gateway exists", async () => {
    await seedProof();
    const outcomes = await race(() => approvePaymentSubmissionAtomically(1, 1), () => approvePaymentSubmissionAtomically(1, 1));
    expect(outcomes.map(o => o.status)).toEqual(["fulfilled", "rejected"]);
    expect(outcomes[1].reason.message).toContain("already been processed");
    expect((await one("SELECT status FROM payment_submissions")).status).toBe("approved");
    await expectInventory(1); await expectGatewayEffects(0);
  });

  it.each(["gateway", "manual"])("blocks direct manual confirmation against gateway approval, %s first", async first => {
    await seedAttempt(); await verifyTransaction("101", txRef);
    const gateway = () => reviewGateway(1, 1, "approve"), manual = () => confirmInvestmentAtomically(1, 1);
    const outcomes = await race(first === "gateway" ? gateway : manual, first === "gateway" ? manual : gateway);
    expect(outcomes[first === "gateway" ? 0 : 1].status).toBe("fulfilled");
    const rejected = outcomes[first === "gateway" ? 1 : 0];
    expect(rejected.status).toBe("rejected"); expect(rejected.reason.message).toContain("Payment Reviews");
    await expectInventory(1); await expectGatewayEffects(1);
  });

  it.each(["verification", "cancellation"])("preserves held inventory during cancellation versus verification, %s first", async first => {
    await seedAttempt();
    const verify = () => verifyTransaction("101", txRef), cancel = () => cancelUnconfirmedInvestmentAtomically(1);
    const outcomes = await race(first === "verification" ? verify : cancel, first === "verification" ? cancel : verify);
    expect(outcomes[first === "verification" ? 0 : 1].status).toBe("fulfilled");
    expect(outcomes[first === "verification" ? 1 : 0].reason.message).toContain("reconciled before cancellation");
    await expectInventory(0); await expectGatewayEffects(0);
  });

  it("retains late receipt evidence and closes replacement checkouts during competing verifications while paused", async () => {
    await seedAttempt("failed");
    await query(`INSERT INTO flutterwave_attempts
      (reservation_id,user_id,tx_ref,expected_amount,expected_currency,mode,checkout_expires_at,checkout_url)
      VALUES(1,1,'brk_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',1200.10,'NGN','test',
        now()+interval '10 minutes','https://checkout.flutterwave.com/v3/hosted/pay/synthetic')`);
    const outcomes = await race(() => verifyTransaction("101", txRef), () => verifyTransaction("101", txRef));
    expect(outcomes.map(o => o.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await query("SELECT state FROM flutterwave_attempts ORDER BY id")).map(r => r.state))
      .toEqual(["reconciliation", "reconciliation"]);
    expect(await one("SELECT attempt_id,status FROM flutterwave_checkout_closures"))
      .toEqual({ attempt_id: 2, status: "done" });
    expect((await one("SELECT count(*)::int AS n FROM flutterwave_charges")).n).toBe(1);
    await closeQueuedCheckouts();
    await expect(reviewGateway(1, 1, "approve")).rejects.toThrow("not eligible");
    await expectInventory(0); await expectGatewayEffects(0);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/payments/link/disable"))).toBe(true);
  });

  it("rolls back all approval effects if the certificate insert fails, then permits one clean retry", async () => {
    await seedAttempt(); await verifyTransaction("101", txRef);
    await query(`ALTER TABLE ownership_certificates ADD CONSTRAINT synthetic_failure CHECK (reservation_id<>1)`);
    await expect(reviewGateway(1, 1, "approve")).rejects.toThrow();
    await expectInventory(0); await expectGatewayEffects(0);
    expect((await one("SELECT cost_basis FROM investment_reservations")).cost_basis).toBeNull();
    expect((await one("SELECT state FROM flutterwave_attempts")).state).toBe("awaiting_admin");
    await query("ALTER TABLE ownership_certificates DROP CONSTRAINT synthetic_failure");
    await reviewGateway(1, 1, "approve");
    await expectInventory(1); await expectGatewayEffects(1);
  });

  it("never overwrites confirmed checkout closure with a competing delayed failure while collection is paused", async () => {
    await seedAttempt("reconciliation");
    await query(`INSERT INTO flutterwave_checkout_closures(attempt_id,checkout_url)
      VALUES(1,'https://checkout.flutterwave.com/v3/hosted/pay/synthetic')`);
    const entered = deferred(), release = deferred();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (++calls === 1) {
        entered.resolve();
        await release.promise;
        throw new Error("Synthetic delayed connection failure");
      }
      return { ok: true, json: async () => ({ status: "success", data: true }) };
    }));
    const delayed = closeQueuedCheckouts();
    try {
      await entered.promise;
      await closeQueuedCheckouts();
    } finally { release.resolve(); await delayed; }
    expect(calls).toBe(2);
    expect(await one("SELECT status,attempts FROM flutterwave_checkout_closures"))
      .toEqual({ status: "done", attempts: 0 });
    await expectInventory(0); await expectGatewayEffects(0);
    await expect(initiateCheckout(1, 1)).rejects.toThrow("not enabled");
  });

  it("enforces immutable checkout expectations and confirmed holding costs in PostgreSQL", async () => {
    await seedAttempt();
    await expect(query("UPDATE flutterwave_attempts SET expected_amount=1 WHERE id=1")).rejects.toThrow("immutable");
    await verifyTransaction("101", txRef); await reviewGateway(1, 1, "approve");
    await expect(query("UPDATE investment_reservations SET cost_basis=NULL WHERE id=1")).rejects.toThrow("immutable");
    await expect(query("UPDATE investment_reservations SET amount=1 WHERE id=1")).rejects.toThrow("immutable");
    await expectInventory(1); await expectGatewayEffects(1);
  });
});
