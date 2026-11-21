import { timingSafeEqual } from "node:crypto";
import { approvedOrigin, assertRuntimeFence, setupStatus, BASE, FIXTURE } from "./config.mjs";
// Reuse the original precise amount, URL and transaction-ID validators. The
// sandbox bundler removes its original environment/config/network functions.
export { exactAmount, transactionId } from "@sandbox/provider-primitives";
import { GatewayError, safeCheckoutUrl as originalSafeCheckoutUrl } from "@sandbox/provider-primitives";
export { GatewayError };

// Observed in authenticated api.flutterwave.com/v3/payments TEST responses.
// This exception is local to the sandbox; the main site's validator is unchanged.
export function safeCheckoutUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch {
    throw new GatewayError("The provider returned an invalid checkout address.", 502);
  }
  if (url.hostname !== "checkout-v2.dev-flutterwave.com") return originalSafeCheckoutUrl(value);
  gatewayConfig(); // This host is accepted only with the complete test-only fence.
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.search || url.hash || !/^\/v3\/hosted\/pay\/[a-zA-Z0-9_-]{1,200}$/.test(url.pathname))
    throw new GatewayError("The provider returned an invalid test checkout address.", 502);
  return url.toString();
}

export function gatewayConfig() {
  assertRuntimeFence();
  const setup = setupStatus();
  if (!setup.available) throw new GatewayError(`Test checkout blocked. ${setup.blockers.join(" ")}`, 503);
  return {
    mode: "test", key: process.env.BRIKVEST_TEST_FLW_SECRET_KEY,
    origin: `${approvedOrigin()}${BASE}`, currencies: ["NGN"],
  };
}
// Shared recovery uses this helper too; sandbox verification retains every
// test-only fence instead of adopting the main application's live config.
export { gatewayConfig as gatewayVerificationConfig };
export function webhookAuthenticated(value) {
  const secret = process.env.BRIKVEST_TEST_FLW_SECRET_HASH;
  if (!secret || typeof value !== "string" || value.length > 1024) return false;
  const a = Buffer.from(secret), b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function providerRequest(route, body) {
  // Checked on EVERY call, including verification and link closure.
  const config = gatewayConfig();
  const readRoute = /^(?:transactions\/[1-9]\d{0,19}\/verify|transactions\/verify_by_reference\?tx_ref=brk_[a-f0-9-]{36})$/;
  if (route === "payments") {
    if (!body || String(body.amount) !== FIXTURE.amount || body.currency !== FIXTURE.currency ||
        !/^brk_[a-f0-9-]{36}$/.test(body.tx_ref) ||
        !/^synthetic-[a-f0-9]{32}@example\.test$/.test(body.customer?.email || "") ||
        body.customer?.name !== FIXTURE.fullName ||
        body.redirect_url !== `${config.origin}/dashboard?flutterwaveReturn=1`) {
      console.warn("[sandbox-provider]", JSON.stringify({
        operation: "create_test_checkout", category: "synthetic_payload_refused",
        invalidFields: [
          String(body?.amount) !== FIXTURE.amount ? "amount" : "",
          body?.currency !== FIXTURE.currency ? "currency" : "",
          !/^brk_[a-f0-9-]{36}$/.test(body?.tx_ref || "") ? "reference" : "",
          !/^synthetic-[a-f0-9]{32}@example\.test$/.test(body?.customer?.email || "") ? "synthetic_email" : "",
          body?.customer?.name !== FIXTURE.fullName ? "synthetic_name" : "",
          body?.redirect_url !== `${config.origin}/dashboard?flutterwaveReturn=1` ? "return_url" : "",
        ].filter(Boolean),
      }));
      throw new GatewayError("Non-synthetic checkout refused.", 400);
    }
  } else if (route === "payments/link/disable") {
    if (!body || Object.keys(body).join() !== "link") throw new GatewayError("Invalid closure request.", 400);
    safeCheckoutUrl(body.link);
  } else if (!readRoute.test(route) || body !== undefined) {
    throw new GatewayError("Provider operation is not allowed in this sandbox.", 400);
  }
  const payloadBody = route === "payments" ? {
    ...body,
    customizations: {
      title: "Brikvest TEST ONLY — synthetic reservation",
      description: "No real investment or ownership. Test-mode payment only.",
    },
  } : body;
  const operation = route === "payments" ? "create_test_checkout"
    : route === "payments/link/disable" ? "close_test_checkout" : "verify_test_transaction";
  const diagnostic = (category, httpStatus, checkoutHost) => console.warn("[sandbox-provider]", JSON.stringify({
    operation, category, ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    ...(typeof checkoutHost === "string" && /^[a-z0-9.-]{1,253}$/.test(checkoutHost)
      ? { checkoutHost } : {}),
  }));
  let response;
  try {
    response = await fetch(`https://api.flutterwave.com/v3/${route}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      ...(payloadBody ? { body: JSON.stringify(payloadBody) } : {}),
    });
  } catch {
    diagnostic("transport_uncertain");
    throw new GatewayError("Provider connection is uncertain. Recheck; do not pay again.", 503);
  }
  // No payload logging, raw errors, secret headers or card/customer data storage.
  let payload;
  try { payload = await response.json(); } catch {
    diagnostic("unreadable_response", response.status);
    throw new GatewayError("Provider response is uncertain. Recheck; do not pay again.", 503);
  }
  if (route === "payments/link/disable" && response.status === 400 &&
      payload.status === "error" && payload.message === "This payment link is currently inactive") return true;
  // Only an explicit authenticated disable acknowledgement counts as closure.
  // Missing/not-found, arbitrary truthy data and transport errors never do.
  if (route === "payments/link/disable") {
    if (response.ok && payload.status === "success" && payload.data === true) return true;
    diagnostic("link_closure_uncertain", response.status);
    throw new GatewayError("Provider link closure is uncertain. Keep the evidence; do not pay again.", 503);
  }
  if (!response.ok || payload.status !== "success" || !payload.data) {
    // Static categories only. Never log the raw response, which might echo
    // customer data or authentication material supplied by an upstream service.
    const message = typeof payload.message === "string" ? payload.message.toLowerCase() : "";
    const category = response.status === 401 || /authoriz|secret.?key|api.?key|token/.test(message)
      ? "test_credential_rejected"
      : /email/.test(message) ? "synthetic_email_rejected"
      : /redirect/.test(message) ? "return_url_rejected"
      : /currency/.test(message) ? "test_currency_rejected"
      : /amount/.test(message) ? "synthetic_amount_rejected" : "provider_rejected";
    diagnostic(category, response.status);
    throw new GatewayError("Provider result is uncertain. Recheck; do not pay again.", 503);
  }
  if (route === "payments") {
    let checkoutHost;
    try {
      checkoutHost = new URL(String(payload.data.link)).hostname;
      safeCheckoutUrl(payload.data.link);
    } catch {
      diagnostic("untrusted_checkout_url", response.status, checkoutHost);
      throw new GatewayError("The provider returned an untrusted checkout URL. No checkout was opened.", 503);
    }
    diagnostic("test_checkout_link_received", response.status);
  }
  return payload.data;
}
