import { sql } from "drizzle-orm";
import { db } from "../db";
import { resultRows as rows } from "./gateway-guards";
import { sendEmail } from "../emailService";
import { emailDispatchPaused } from "../email-dispatch-state";
import { investmentConfirmedEmailTemplate } from "../emailTemplates";

/** Claim-before-send: SMTP has no idempotency key. A crashed/ambiguous delivery
 * is quarantined as 'sending'/'uncertain', never automatically sent twice. */
export async function dispatchGatewayConfirmation(reservationId: number) {
  if (emailDispatchPaused()) return { state: "paused" as const };
  if (process.env.NODE_ENV === "test" || process.env.FLW_NOTIFICATION_DISPATCH !== "true") return;
  const job = rows(await db.execute(sql`UPDATE flutterwave_confirmation_jobs SET state='sending',updated_at=now()
    WHERE reservation_id=${reservationId} AND state='queued' RETURNING reservation_id`))[0];
  if (!job) return;
  try {
    const r = rows(await db.execute(sql`SELECT r.*,p.name AS property_name FROM investment_reservations r
      JOIN properties p ON p.id=r.property_id WHERE r.id=${reservationId} AND r.status='converted_to_investment'`))[0];
    if (!r) throw new Error("Confirmed holding unavailable");
    const email = investmentConfirmedEmailTemplate({
      fullName: r.full_name, propertyName: r.property_name, units: r.units, amount: r.amount, currency: r.currency,
    });
    const sent = await sendEmail({ to: r.email, subject: email.subject, html: email.html });
    if (sent === false) throw new Error("Delivery uncertain");
    await db.execute(sql`UPDATE flutterwave_confirmation_jobs SET state='sent',updated_at=now() WHERE reservation_id=${reservationId}`);
  } catch {
    await db.execute(sql`UPDATE flutterwave_confirmation_jobs SET state='uncertain',updated_at=now() WHERE reservation_id=${reservationId}`);
  }
}
