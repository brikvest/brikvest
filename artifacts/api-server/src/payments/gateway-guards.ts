import { sql } from "drizzle-orm";
import { GatewayError } from "./flutterwave-provider";

type Executor = { execute(query: any): Promise<any> };
export const resultRows = (result: any): any[] => result.rows || [];
export async function gatewayInstalled(tx: Executor) {
  return resultRows(await tx.execute(sql`SELECT to_regclass('public.flutterwave_attempts') IS NOT NULL AS installed`))[0]?.installed === true;
}
/** Caller must first lock the reservation, as do verification and expiry. */
export async function hasCollectedGatewayPayment(tx: Executor, reservationId: number) {
  if (!await gatewayInstalled(tx)) return false;
  return resultRows(await tx.execute(sql`
    SELECT id FROM flutterwave_attempts WHERE reservation_id=${reservationId}
      AND (verified_at IS NOT NULL OR state IN ('awaiting_admin','reconciliation','rejected'))
    LIMIT 1`)).length > 0;
}
/** Cancellation is stricter than ordinary expiry: an unresolved hosted session
 * must be reconciled/closed, not released while it can still collect funds. */
export async function hasGatewayPaymentConflict(tx: Executor, reservationId: number) {
  if (!await gatewayInstalled(tx)) return false;
  const blocked = resultRows(await tx.execute(sql`SELECT id FROM flutterwave_attempts
    WHERE reservation_id=${reservationId} AND (verified_at IS NOT NULL OR checkout_expires_at>now() OR
      state IN ('initiated','verification_pending','awaiting_admin','reconciliation','rejected','approved'))
    LIMIT 1`))[0];
  return !!blocked;
}
export async function assertGatewayCancellationSafe(tx: Executor, reservationId: number) {
  if (await hasGatewayPaymentConflict(tx,reservationId)) throw new GatewayError("A collected or unresolved Flutterwave payment must be reconciled before cancellation. No inventory was released and no refund was issued.");
}

export type SafeguardState = "present" | "absent" | "mismatch";

/** The three owner-installed production triggers. Publish does not carry
 * functions or triggers, so their presence is checked from the catalogs and is
 * never installed, repaired or replaced by the application. Values mirror the
 * reviewed acceptance table in docs/flutterwave-production-guards-console.md. */
export const REQUIRED_SAFEGUARDS = [
  { trigger: "flutterwave_expected_immutable", table: "flutterwave_attempts", tgtype: 19,
    fn: "protect_flutterwave_expected", bodyHash: "e6e632dfa8a00362e9d70f45a46b7d02",
    label: "Checkout amount cannot be rewritten" },
  { trigger: "holding_cost_basis_guard", table: "investment_reservations", tgtype: 23,
    fn: "guard_holding_cost_basis", bodyHash: "9639dd1f6a65cf9bff769a4e3bb3eba3",
    label: "Confirmed purchase cost is frozen" },
  { trigger: "legal_pdf_review_append_only", table: "legal_pdf_review_approvals", tgtype: 31,
    fn: "legal_guard_pdf_review", bodyHash: "f237ff6a023253ca2c2088724776c630",
    label: "Exact investor PDF approvals are append-only" },
] as const;

/** Read-only catalog inspection. A trigger that exists but is disabled, on
 * another table, for other events, conditional, column-filtered, parameterised,
 * security-definer or bound to a different function body is a mismatch. */
export async function safeguardStatus(executor: Executor) {
  const result = await executor.execute(sql`
    SELECT t.tgname::text AS trigger, c.relname::text AS table_name, t.tgenabled::text AS enabled,
           t.tgtype::int AS tgtype, t.tgnargs::int AS nargs, t.tgattr::text AS column_filter,
           t.tgqual IS NULL AS unconditional, p.proname::text AS fn, pn.nspname::text AS fn_schema,
           p.prosecdef AS security_definer, md5(p.prosrc) AS body_hash
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal
      AND t.tgname IN ('flutterwave_expected_immutable','holding_cost_basis_guard','legal_pdf_review_append_only')`);
  const found: any[] = result.rows || [];
  return REQUIRED_SAFEGUARDS.map(expected => {
    const matches = found.filter(row => row.trigger === expected.trigger);
    let state: SafeguardState = "absent";
    if (matches.length) {
      const row = matches[0];
      state = matches.length === 1 && row.table_name === expected.table && row.enabled === "O" &&
        Number(row.tgtype) === expected.tgtype && Number(row.nargs) === 0 && row.column_filter === "" &&
        row.unconditional === true && row.fn === expected.fn && row.fn_schema === "public" &&
        row.security_definer === false && row.body_hash === expected.bodyHash ? "present" : "mismatch";
    }
    return { name: expected.trigger, label: expected.label, state };
  });
}

/** Fail closed for the two operations that create new financial obligations in
 * live mode: starting a checkout and approving a gateway payment. Verification,
 * webhook intake, recovery and link closure deliberately do not call this, so
 * evidence of money already received is never dropped. No schema detail is
 * included in the message. */
export async function requireLiveSafeguards(executor: Executor, audience: "investor" | "admin") {
  let ready = false;
  try { ready = (await safeguardStatus(executor)).every(s => s.state === "present"); }
  catch { ready = false; }
  if (ready) return;
  throw new GatewayError(audience === "admin"
    ? "Approval is unavailable until the database safeguards are verified. The payment evidence is retained; nothing was allocated or refunded."
    : "Flutterwave is temporarily unavailable. Bank transfer remains available.", 503);
}
