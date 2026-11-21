export const BASE = "/brikvest-test-checkout";
export const FIXTURE = Object.freeze({
  amount: "1200.10", currency: "NGN", units: 1, area: 10,
  name: "Brikvest Test Plot", location: "Synthetic location · not a listed property",
  fullName: "Synthetic Checkout Tester",
});

// This service must be launched through launch.mjs, with a fresh allowlisted env.
export function assertRuntimeFence() {
  if (process.env.BRIKVEST_SANDBOX_RUNTIME !== "synthetic-only-v1")
    throw new Error("Use the isolated sandbox launcher.");
  if (Object.keys(process.env).some(key =>
    /^(?:DATABASE_URL|TEST_DATABASE_URL|NEON_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|SMTP_.*|FLW_.*|SESSION_SECRET|.*PRODUCTION.*)$/.test(key)))
    throw new Error("Non-sandbox environment rejected. No database or payment connection was opened.");
  if (process.env.BRIKVEST_TEST_MODE && process.env.BRIKVEST_TEST_MODE !== "test")
    throw new Error("Only test mode is permitted.");
  const key = process.env.BRIKVEST_TEST_FLW_SECRET_KEY;
  if (key && !/^FLWSECK_TEST-[A-Za-z0-9_-]{8,200}$/.test(key))
    throw new Error("Dedicated credential is not a v3 test key. Startup refused.");
}

export function approvedOrigin() {
  const value = process.env.BRIKVEST_TEST_RETURN_ORIGIN || "";
  let url;
  try { url = new URL(value); } catch { throw new Error("Set BRIKVEST_TEST_RETURN_ORIGIN to the approved HTTPS preview origin."); }
  // Only this existing preview origin is supported. A separate public origin is
  // intentionally not enabled here; it requires a new owner-approved setup.
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.pathname !== "/" || url.search || url.hash ||
      !process.env.REPLIT_DEV_DOMAIN ||
      url.hostname !== process.env.REPLIT_DEV_DOMAIN ||
      /(^|\.)brikvest\.net$/i.test(url.hostname))
    throw new Error("Return origin must exactly match this sandbox's existing HTTPS preview origin, without a path.");
  return url.origin;
}

export function setupStatus() {
  assertRuntimeFence();
  const blockers = [];
  if (!process.env.BRIKVEST_TEST_FLW_SECRET_KEY) blockers.push("Add dedicated BRIKVEST_TEST_FLW_SECRET_KEY in secure settings. Existing gateway keys are never used.");
  if (!process.env.BRIKVEST_TEST_FLW_SECRET_HASH) blockers.push("Add dedicated BRIKVEST_TEST_FLW_SECRET_HASH in secure settings.");
  const reviewWaived = process.env.BRIKVEST_TEST_PORT_REVIEW_WAIVED === "true";
  if (process.env.BRIKVEST_TEST_PORT_REVIEWED !== "true" && !reviewWaived)
    blockers.push("Owner confirmation that the migrated Brikvest app was reviewed, or an explicit review waiver for isolated testing, is required.");
  try { approvedOrigin(); } catch (error) { blockers.push(error.message); }
  if (process.env.BRIKVEST_TEST_CALLBACK_APPROVED !== "true")
    blockers.push("Owner-approved callback access is required. Private previews may not receive provider webhooks; no access settings have been changed.");
  if (process.env.BRIKVEST_TEST_CALLBACK_MODE && process.env.BRIKVEST_TEST_CALLBACK_MODE !== "private-browser-return")
    blockers.push("Unsupported callback mode. No public callback origin or access bypass is enabled.");
  const providerEmailsAuthorized = process.env.BRIKVEST_TEST_PROVIDER_EMAILS_AUTHORIZED === "true";
  const providerNotificationsDisabled = process.env.BRIKVEST_TEST_PROVIDER_NOTIFICATIONS_DISABLED === "true";
  if (!providerEmailsAuthorized && !providerNotificationsDisabled)
    blockers.push("Disable Flutterwave test notifications or obtain explicit owner authorization for Flutterwave test-payment emails to the business address. Brikvest mail remains disabled.");
  return {
    available: blockers.length === 0, blockers,
    scopeNotice: [
      process.env.BRIKVEST_TEST_WEBHOOK_ONLY === "true"
        ? "Webhook-only verification trial: browser returns and manual receipt rechecks are blocked by the server."
        : "",
      reviewWaived ? "Owner waived the main-site migration review for isolated testing." : "",
      process.env.BRIKVEST_TEST_CALLBACK_MODE === "private-browser-return"
        ? "Existing preview with browser returns and explicit server rechecks. Webhook delivery must be verified independently; setup readiness is not delivery evidence."
        : "Webhook delivery requires independent evidence; setup readiness does not establish it.",
    ].filter(Boolean).join(" "),
    providerEmailPolicy: providerEmailsAuthorized
      ? "Owner authorized Flutterwave test-payment emails to the business address. Brikvest email and SMS remain disabled."
      : providerNotificationsDisabled
        ? "Flutterwave test notifications are confirmed disabled. Brikvest email and SMS remain disabled."
        : "Flutterwave test notifications require owner authorization or confirmation they are disabled. Brikvest email and SMS remain disabled.",
    providerEvidence: "No provider result is implied by setup readiness. Only server-verified receipts are payment evidence.",
  };
}
