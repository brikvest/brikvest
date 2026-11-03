import { sql } from "drizzle-orm";
import { db } from "../db";
import { resultRows as rows } from "./gateway-guards";
import { providerRequest, safeCheckoutUrl } from "./flutterwave-provider";

type Executor = { execute(query: any): Promise<any> };
/** Call under holding -> attempt locks. An in-flight link creation fills the
 * nullable URL before it may return any link to the investor. */
export async function enqueueCheckoutClosure(tx: Executor, a: any, checkoutUrl?: string) {
  await tx.execute(sql`INSERT INTO flutterwave_checkout_closures(attempt_id,checkout_url,status)
    VALUES (${a.id},${checkoutUrl || a.checkout_url || null},'queued')
    ON CONFLICT(attempt_id) DO UPDATE SET checkout_url=COALESCE(EXCLUDED.checkout_url,flutterwave_checkout_closures.checkout_url),
      updated_at=now()`);
}
export async function closeQueuedCheckouts(input: { limit?: number; attemptId?: number; reservationId?: number } = {}) {
  const jobs = rows(await db.execute(sql`SELECT * FROM flutterwave_checkout_closures
    WHERE status='queued' AND checkout_url IS NOT NULL AND next_attempt_at<=now()
      AND (${input.attemptId ?? null}::integer IS NULL OR attempt_id=${input.attemptId ?? null})
      AND (${input.reservationId ?? null}::integer IS NULL OR attempt_id IN
        (SELECT id FROM flutterwave_attempts WHERE reservation_id=${input.reservationId ?? null}))
    LIMIT ${input.limit ?? 1}`));
  for (const job of jobs) {
    try {
      const result = await providerRequest("payments/link/disable", { link: safeCheckoutUrl(job.checkout_url) });
      if (result !== true) throw new Error("Checkout closure not confirmed");
      await db.execute(sql`UPDATE flutterwave_checkout_closures SET status='done',updated_at=now() WHERE attempt_id=${job.attempt_id}`);
    } catch {
      // Never represent a network failure as a closed hosted session. Payment
      // stays in reconciliation; retain durable retries and show the admin state.
      await db.execute(sql`UPDATE flutterwave_checkout_closures SET attempts=attempts+1,
        next_attempt_at=now()+interval '5 minutes',updated_at=now()
        WHERE attempt_id=${job.attempt_id} AND status<>'done'`);
    }
  }
}
