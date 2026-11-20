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
