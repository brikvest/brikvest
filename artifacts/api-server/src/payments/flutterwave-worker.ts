import { sql } from "drizzle-orm";
import { db } from "../db";
import { gatewayInstalled, resultRows as rows } from "./gateway-guards";
import { recheckAttempt, runVerification } from "./flutterwave";
import { dispatchGatewayConfirmation } from "./flutterwave-notifications";
import { closeQueuedCheckouts } from "./flutterwave-checkout-closure";

let running = false;
/** Safe on multiple instances: verification locks holdings, certificates are
 * transactional, and notification intents are claimed once before sending. */
export async function recoverGatewayWork() {
  if (running || !await gatewayInstalled(db)) return;
  running = true;
  try {
    await closeQueuedCheckouts({ limit: 5 });
    const jobs = rows(await db.execute(sql`SELECT * FROM flutterwave_verification_jobs
      WHERE status='queued' AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 10`));
    for (const job of jobs) await runVerification(job.transaction_id, job.tx_ref);
    // Discover missed returns/webhooks using persisted references. Failures
    // remain pending and available for an administrator's explicit recheck.
    const attempts = rows(await db.execute(sql`SELECT * FROM flutterwave_attempts
      WHERE state IN ('initiated','verification_pending') AND updated_at<now()-interval '5 minutes'
      ORDER BY updated_at LIMIT 10`));
    for (const a of attempts) {
      await db.execute(sql`UPDATE flutterwave_attempts SET updated_at=now() WHERE id=${a.id}`);
      try { await recheckAttempt(a); } catch { /* Durable unresolved state is retained. */ }
    }
    const notifications = rows(await db.execute(sql`SELECT reservation_id FROM flutterwave_confirmation_jobs WHERE state='queued' LIMIT 10`));
    for (const job of notifications) await dispatchGatewayConfirmation(job.reservation_id);
  } finally { running = false; }
}
export function startGatewayWorker() {
  // Explicitly separate from collecting funds and from enabling mail. Never
  // start against the development/live database as an implementation test.
  if (process.env.FLW_WORKER_ENABLED !== "true" || process.env.NODE_ENV === "test") return;
  const tick = () => void recoverGatewayWork().catch(() => console.error("[PAYMENTS] Recovery deferred; durable work retained."));
  const timer = setInterval(tick, 60_000);
  timer.unref();
}
