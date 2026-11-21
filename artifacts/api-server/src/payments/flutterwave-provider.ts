import { timingSafeEqual } from "node:crypto";
import Decimal from "decimal.js";
import { legalApplicationOrigin } from "../legal/application-origin";

export class GatewayError extends Error {
  constructor(message: string, public httpStatus = 409) { super(message); }
}
export function gatewayConfig() {
  if (process.env.FLW_ENABLED !== "true") throw new GatewayError("Flutterwave is not enabled. Bank transfer remains available.", 503);
  return gatewayVerificationConfig();
}
/** Pausing new collection must not prevent verification or closing existing checkouts. */
export function gatewayVerificationConfig() {
  const mode = process.env.FLW_MODE || "test";
  const key = process.env.FLW_SECRET_KEY || "";
  if (!["test", "live"].includes(mode) || (mode === "test" && !key.startsWith("FLWSECK_TEST-")) ||
      (mode === "live" && (process.env.FLW_LIVE_AUTHORIZED !== "true" || !key.startsWith("FLWSECK-") || key.startsWith("FLWSECK_TEST-")))) {
    throw new GatewayError("Flutterwave merchant configuration is not authorized.", 503);
  }
  if (!process.env.FLW_SECRET_HASH) throw new GatewayError("Flutterwave webhook is not configured.", 503);
  let origin: string;
  try { origin = legalApplicationOrigin(process.env.FLW_RETURN_ORIGIN).origin; }
  catch { throw new GatewayError("Flutterwave return origin is not configured.", 503); }
  const currencies = (process.env.FLW_CURRENCIES || "").split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]{3}$/.test(s));
  return { mode, key, origin, currencies };
}
export function webhookAuthenticated(value: unknown) {
  const secret = process.env.FLW_SECRET_HASH;
  if (!secret || typeof value !== "string" || value.length > 1024) return false;
  const a = Buffer.from(secret), b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function exactAmount(a: unknown, b: unknown) {
  const valid = (v: unknown) => (typeof v === "string" || (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER / 100)) && /^\d{1,18}(?:\.\d{1,2})?$/.test(String(v));
  return valid(a) && valid(b) && new Decimal(String(a)).gt(0) && new Decimal(String(a)).eq(String(b));
}
export function transactionId(value: unknown): string {
  if (!/^[1-9]\d{0,19}$/.test(String(value ?? ""))) throw new GatewayError("A valid provider transaction ID is required.", 400);
  return String(value);
}
export async function providerRequest(path: string, body?: unknown): Promise<any> {
  const config = path === "payments" ? gatewayConfig() : gatewayVerificationConfig();
  const response = await fetch(`https://api.flutterwave.com/v3/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12_000),
    redirect: "error",
  });
  // Never expose provider payloads (card/customer information) or checkout tokens.
  const payload = await response.json();
  // Documented idempotent closure result after e.g. a lost successful response.
  if (path === "payments/link/disable" && response.status === 400 &&
      payload.status === "error" && payload.message === "This payment link is currently inactive") return true;
  if (!response.ok) throw new GatewayError("Provider verification is unavailable. Please recheck; do not pay again.", 503);
  if (payload.status !== "success" || !payload.data) throw new GatewayError("Provider verification is pending. Do not pay again.", 503);
  return payload.data;
}
export function safeCheckoutUrl(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.hostname !== "checkout.flutterwave.com" || url.username || url.password || url.port) {
    throw new GatewayError("The provider returned an invalid checkout address.", 502);
  }
  return url.toString();
}
