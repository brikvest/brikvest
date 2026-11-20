# Flutterwave v4 collection-contract gate

## Superseded by the owner's v3 decision

The owner subsequently switched back to v3, updated the secret key and retained
the same webhook hash. This document is historical evidence, not the current
integration plan or an outstanding request to contact Flutterwave.
Use [the v3 setup and release guidance](flutterwave-payments.md) instead.
The v4 implementation is not being pursued.

## Outcome

**Blocked before checkout replacement.** The official versioned HTML documentation
and endpoint schemas reviewed on 2026-11-17 establish direct-charge APIs, but do
not establish a suitable hosted initial card collection or hosted tokenization
contract for this integration. This is not a claim that Flutterwave cannot offer
one; provider confirmation and its exact contract are required.

The owner's completed sandbox testing, merchant KYC and enabled live currencies
NGN, USD, GBP and EUR are accepted. Those reports do not identify a replacement
for the existing hosted Standard checkout. No credentials, settings, database
rows, runtime code or published release were changed during this investigation.
No provider API calls, checkout probes, charges or emails were made.

## Concrete provider evidence

- [Collections introduction](https://developer.flutterwave.com/v4/docs/introduction-1)
  identifies General and Orchestrator flows, not a hosted Standard replacement.
- [General flow](https://developer.flutterwave.com/v4/docs/main-payment-flow),
  steps 2–4, creates a payment method from encrypted card number, expiry and CVV
  before creating a charge. Authorization can then require PIN, OTP or redirect.
  A redirect after card collection is not hosted initial card collection.
- [Orchestrator flow](https://developer.flutterwave.com/v4/docs/payment-orchestrator-flow)
  says to collect customer PII and payment information. Its
  [endpoint schema](https://developer.flutterwave.com/v4/api/orchestration/orchestration_direct_charge_post)
  requires a payment method in the charge request. Combining customer, method and
  charge creation does not preserve the previous hosted collection boundary.
- [Card payments](https://developer.flutterwave.com/v4/docs/card), under
  **Tokenization → How Does it Work?**, explicitly starts with the merchant
  collecting card information and creating a payment method. Subsequent reuse
  of that method ID is not evidence of provider-hosted initial tokenization.
- The reviewed contracts do not establish hosted-session expiry or a v4
  replacement for disabling the legacy Standard payment link. Neither an
  internal expiry timestamp nor a failed charge proves external collection ended.
- A wider search found an official
  [Checkout guide](https://developer.flutterwave.com/docs/collections-inflow/flutterwave-standard),
  but its actual examples create and disable links at
  `https://api.flutterwave.com/v3/payments` using a secret key and return a
  `/v3/hosted/pay/` link. Its hosted capabilities are not evidence of v4 OAuth
  compatibility. Search results with a v4-looking documentation hostname do not
  change those request contracts.
- The versioned [SDK directory](https://developer.flutterwave.com/v4/docs/directory)
  links to `flutterwave-node-v3` and `flutterwave-react-v3`; inclusion in that
  directory does not establish a v4 hosted SDK contract. The versioned
  [Quickstart](https://developer.flutterwave.com/v4/docs/quickstart) directs readers
  to charging a card, not to an OAuth-hosted checkout replacement.

## Established v4 contracts for the later implementation

- [Environments](https://developer.flutterwave.com/v4/docs/environments):
  sandbox `https://developersandbox-api.flutterwave.com`;
  live `https://f4bexperience.flutterwave.com`.
  Its example conditional reverses those hosts; use the explicit environment
  descriptions, not that conditional.
- [Authentication](https://developer.flutterwave.com/v4/docs/authentication):
  server-side OAuth `client_credentials`, `client_id`, `client_secret` at
  `https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token`;
  expiring bearer tokens. Never copy sample token logging.
- [Idempotency](https://developer.flutterwave.com/v4/docs/idempotency):
  POST requests use `X-Idempotency-Key`; the same key returns the original response.
  Persist each operation's identity before its first external request.
- [Retrieve charge](https://developer.flutterwave.com/v4/api/charges/charges_get)
  and [list charges](https://developer.flutterwave.com/v4/api/charges/charges_list):
  string charge IDs, authenticated retrieval and paginated reference filtering.
  Schemas use `reference` and statuses `succeeded`, `pending`, `failed`, `voided`.
  References allow alphanumerics and hyphens, not the existing `brk_` prefix.
- [Webhooks](https://developer.flutterwave.com/v4/docs/webhooks):
  base64 HMAC-SHA256 over exact raw bytes using the configured secret hash,
  `flutterwave-signature`, and a `type`/`id`/`timestamp` envelope. Contradictory
  later snippets comparing the header directly to the secret are not acceptable.
  Persist verification work before acknowledgement and verify money via the API.

## Decision required

Preferred: obtain Flutterwave's documented v4-compatible hosted checkout or hosted
tokenization contract, including this merchant's currency/method coverage and
expiry/closure behavior. Otherwise choose a different supported hosted collection
approach. Custom PAN/CVV/PIN/OTP collection requires a separate explicit
product/security decision; it is not authorized by this investigation.

Keep all rollout work pending. Intended settings remain
`FLW_RETURN_ORIGIN=https://brikvest.net` and
`FLW_CURRENCIES=NGN,USD,GBP,EUR`, without display-currency charging or FX.
The planned endpoint `https://brikvest.net/api/payments/flutterwave/webhook` is
**not verified ready for v4**; readiness requires deploying and checking the new
handler. Production schema/guards, secure credentials, matching dashboard hash,
effective settings, publication and activation have not been verified here.
Server-verified receipt must still await admin approval, with bank-transfer
interlocks and independent exact-investor-PDF review preserved.

## Request for Flutterwave

The owner chose to obtain Flutterwave's hosted-flow documentation before changing
the collection approach. Send this request through the merchant's authenticated
Flutterwave support channel; no credentials need to be included:

> We use v4 live OAuth client credentials for Brikvest (https://brikvest.net),
> with merchant KYC and sandbox testing completed and NGN, USD, GBP and EUR
> enabled. Please provide the official contract for provider-hosted checkout or
> hosted initial card tokenization compatible with those v4 credentials. Our app
> must not collect PAN, CVV, PIN or OTP. The public Checkout guide currently uses
> `/v3/payments` and a secret key, while v4 General/Orchestrator flows collect
> payment-method details before charging.
>
> Please confirm the exact sandbox/live endpoints and authentication, supported
> methods and currencies for our merchant, session creation and durable
> idempotency, redirect allowlist, charge verification and reference recovery,
> webhook signature/envelope, and session expiry/cancellation/closure guarantees,
> including whether an already-open page can still collect after closure.
> If v4 has no supported hosted initial collection path, please confirm that
> explicitly and identify your supported hosted alternative and credential model.
