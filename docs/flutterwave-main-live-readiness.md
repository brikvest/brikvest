# Flutterwave main-project live readiness

## Live-launch preparation (2026-11-26) — current state

This section supersedes the older statements below wherever they differ.
**Nothing has been published and no production SQL has been run by the agent.**
Saved settings are not active until the owner publishes.

Observed read-only on 2026-11-26 before any change:

- `https://brikvest.net/api/healthz` answered from the real backend with
  release `flutterwave-live-preparation-2026-11-21`, collection, recovery and
  payment mail off, legal and application mail paused.
- Production database `neondb`: all six payment tables present and empty,
  nullable `investment_reservations.cost_basis` present,
  `legal_guard_pdf_review()` body hash `f237ff6a023253ca2c2088724776c630`,
  `legal_pdf_review_approvals` present. Neither payment guard function and
  none of the three triggers existed, so the reviewed SQL's preflight
  conditions were satisfied.
- `FLW_SECRET_KEY` and `FLW_SECRET_HASH` exist by name. Values were not read;
  whether they are live values is confirmed only by the admin readiness
  summary after publishing (format only).

Prepared in this release (`flutterwave-live-launch-2026-11-26`):

- **Owner SQL run sheet:** [flutterwave-owner-run-sheet.md](flutterwave-owner-run-sheet.md)
  reproduces the two reviewed transactions and the acceptance query
  byte-for-byte; a regression test enforces equality with the reviewed sources.
- **Fail-closed safeguard gate:** in live mode, creating a checkout and
  approving a gateway payment require all three triggers to be present,
  enabled, on the expected table and events, and bound to functions with the
  reviewed body hashes. Verification, webhook intake, recovery, link closure,
  rejection and bank transfer do not depend on the gate, so evidence of money
  received is never dropped. Investors see only "Flutterwave is temporarily
  unavailable. Bank transfer remains available."
- **Admin readiness summary:** Admin → Payment Reviews → Flutterwave payments →
  Live readiness. Shows mode, secret-key format (never the value), whether a
  webhook hash is configured, each safeguard's state, the switches, mail pause
  state and the last completed recovery pass on that server instance.
- **Logs:** `[PAYMENTS] Webhook accepted: authentication passed.`,
  `[PAYMENTS] Webhook rejected: authentication failed.`,
  `[PAYMENTS] Recovery pass completed: …` (counts only) and
  `[PAYMENTS] Recovery pass deferred; durable work retained.`
- **Recovery on start:** when recovery is enabled, one pass runs about 15
  seconds after the server starts, then every minute while the instance is awake.
- **Frontend check:** the web build fails if the bundle contains a Flutterwave
  key prefix or any server-only payment setting name.

Saved production settings (development is unchanged: everything off):

```text
FLW_MODE=live
FLW_RETURN_ORIGIN=https://brikvest.net
FLW_CURRENCIES=NGN,USD,GBP,EUR
FLW_LIVE_AUTHORIZED=true
FLW_WORKER_ENABLED=true
FLW_ENABLED=true
FLW_NOTIFICATION_DISPATCH=false
LEGAL_DISPATCH_PAUSED=true
BRIKVEST_EMAIL_DISPATCH_PAUSED=true
```

### Remaining owner actions, in order

1. Merge this task.
2. In Flutterwave **live** mode set the webhook URL to
   `https://brikvest.net/api/payments/flutterwave/webhook`, enable retries, and
   set the secret hash to the same value entered in Replit Secrets.
3. Confirm the live secret key was entered in Replit Secrets.
4. Note a recovery point, then run the two SQL blocks from the
   [run sheet](flutterwave-owner-run-sheet.md) in Database → Production → SQL
   console, followed by its acceptance query.
5. Review the publish database diff (expect no unexpected statements) and
   publish. **Publishing after merge is the step that activates live
   collection.** If the triggers are not installed, the gate keeps checkout
   unavailable.
6. Check `/api/healthz` shows release `flutterwave-live-launch-2026-11-26` with
   collection and recovery on and all mail still paused; check the admin
   readiness summary shows all three safeguards installed, a live-format key
   and a configured webhook hash.
7. Decide hosting: keep Autoscale (recovery runs on start and while the app is
   awake; an idle app does nothing until its next request) or switch to
   always-running hosting for continuous recovery. Not changed here.
8. Incident pause: set `FLW_ENABLED=false` for production and republish. Leave
   recovery, live authorization and the credentials in place so payments
   already made are still verified.

No real charge, sandbox payment, provider call, fabricated webhook or mail was
used to prepare this. Authenticated live webhook delivery is confirmed only by
the "Webhook accepted" log line after Flutterwave is configured.

## Earlier release boundary (2026-11-21, historical)

The owner authorized production prerequisite preparation after confirming the
isolated checkout works. This record supersedes the earlier claim that main's
development database has no Flutterwave objects. It does not claim production
installation, publication, authenticated live-provider delivery or activation.

Do not enable collection until every release gate below is verified.
Do not make a real charge as a configuration test. Keep the separate sandbox
private, synthetic-only and on its dedicated test credentials.

## Completed in main development

- Confirmed separate platform targets: development `heliumdb` (PostgreSQL
  16.10), production `neondb` (16.16). Production access remained read-only.
- Installed only the approved six empty payment tables and the nullable
  `investment_reservations.cost_basis` JSONB column, with the existing reviewed
  payment and holding-cost guards. The transaction checked the development
  identity and first-install assumptions and used bounded lock/statement timeouts.
- Verified six payment tables, 48 columns, eight foreign keys, two attempt
  checks and enabled payment/holding-cost triggers. No cost-basis snapshots were
  adopted. User/reservation/certificate counts remained 75/83/11; zero existing
  holdings acquired a cost-basis classification.
- Main application startup and workers were not used for this installation.
  Development still runs the isolated fixture API. No business record,
  document, mail intent or provider checkout was created by the preparation.
- Separated collection gating from verification/reference recovery and external
  link closure. `FLW_ENABLED=false` now blocks new checkout creation without
  disabling recovery, provided the separately configured provider mode,
  live authorization and recovery switch remain valid.
- Added an explicit application-mail transport fence. A paused send returns
  failure rather than falsely recording successful delivery.
- The same pause now stops Flutterwave confirmation dispatch, scheduled legal
  work, legal notification recovery and marketplace alert retries **before**
  claiming work. Manual seller-alert retry requests return an authenticated
  maintenance response without changing the alert. While held, queue states,
  leases, retry allowances, failure evidence and delivery timestamps remain
  untouched. The mixed marketplace retry queue holds both email and in-app
  channels to avoid claiming email work just to defer it.
- Explicit mail-free legal draft generation remains available through its
  existing manual-generation permit; it does not resume scheduled notifications.
  Resuming queue processing requires a separately authorized pause release.
- This is not cancellation of an already executing SMTP request, a distributed
  maintenance lock, or permission to reset quarantined/uncertain deliveries.
  Drain or inspect pre-existing in-flight work before maintenance, and require
  every active instance to adopt the updated pause protocol.

## Saved production configuration as of 2026-11-21 (historical; see the top section)

```text
FLW_ENABLED=false
FLW_LIVE_AUTHORIZED=false
FLW_WORKER_ENABLED=false
FLW_NOTIFICATION_DISPATCH=false
LEGAL_DISPATCH_PAUSED=true
BRIKVEST_EMAIL_DISPATCH_PAUSED=true
FLW_MODE=live
FLW_RETURN_ORIGIN=https://brikvest.net
FLW_CURRENCIES=NGN,USD,GBP,EUR
```

The live origin came from deployment metadata. Currency availability and
merchant approval were owner-reported, not independently established by a charge.
The existing `FLW_SECRET_KEY` and `FLW_SECRET_HASH` names are present in secure
settings; values were not read. Presence is not key validity.

Do not overwrite the dedicated `BRIKVEST_TEST_*` credentials or change the
sandbox runtime fence. V3 hosted Standard uses the server secret and webhook
hash, not a browser public key.

## Actual managed publication review

After the authorized development changes and the owner's requested exclusion
of the unrelated template-default change, the publishing diff contains:

- Six `CREATE TABLE` statements for the approved payment tables, including the
  expected primary/unique/check constraints.
- Eight foreign-key additions to the intended reservation, user, admin and
  payment-attempt relations.
- The partial one-open-checkout unique index.
- One nullable `cost_basis` column addition.

This is **16 statements**, with no warnings, structural-data-loss flags or
possible-backwards-incompatibility flags. No drops, truncation, column removal,
overwrites, historical updates or backfill are listed.

The earlier 17-statement plan included a pre-existing change between equivalent
empty-array defaults on `legal_templates.required_placeholders`. The owner
explicitly excluded it. A bounded, identity-checked development-only transaction
aligned that default to production's unchanged `'{}'::text[]` representation.
Both schema declarations now preserve that representation rather than
reintroducing the unrelated change on a later schema synchronization.
No template records or production objects were changed. The fresh publication
plan contains no `legal_templates` statement.

The diff is a reviewed snapshot, not a permanent authorization for future
statements. Recompute immediately before publishing and stop for unexpected
changes. Do not choose data overwrite or approve an inferred rename.

## Unsupported guards: owner-operated production SQL console

Publish does **not** carry functions/triggers. Tables existing after publishing
is insufficient. Keep collection and app mail off, and arrange a maintenance
window for payment confirmations, legal approval writes and background dispatch
before installing guards. A saved pause is not evidence of an effective pause
in an older published release.

Use the supported Database production SQL console for the separately reviewed
guard installation. Do not run CLI scripts against production, use alternate
connection secrets, transfer ownership, or add runtime/build migrations.

The prepared SQL-console review is in
[flutterwave-production-guards-console.md](flutterwave-production-guards-console.md).
It includes only the payment expectation and holding-cost guards and the
previously approved exact-PDF trigger. Confirm the owner has accepted all three
guard changes before execution.

Expected function-body hashes from the reviewed catalogs:

| Function | MD5 of `pg_proc.prosrc` |
| --- | --- |
| `protect_flutterwave_expected()` | `e6e632dfa8a00362e9d70f45a46b7d02` |
| `guard_holding_cost_basis()` | `9639dd1f6a65cf9bff769a4e3bb3eba3` |
| Existing `legal_guard_pdf_review()` | `f237ff6a023253ca2c2088724776c630` |

Read-only production checks still showed no payment tables or cost-basis column
before publication. The existing PDF-review function matched the reviewed hash,
but its required trigger was absent. No production guards were installed here.

## Publishing and active-release verification (2026-11-21 procedure; the top section's order now applies)

1. Confirm the owner-reported seven-day PITR window and note an available
   pre-change recovery time in the production database settings. No restore or
   database copy is part of this rollout.
2. Review/accept only the fresh managed SQL plan described above, with no
   unrelated template-default change. Publish through the supported
   user-operated flow with collection, recovery and all app mail still fenced.
3. Confirm the real API artifact and main web artifact are in the published
   release. The private sandbox is excluded by `.replitignore`; never publish
   its backend as part of the main product. The API startup health route is
   `/api/healthz`; main web routes and `/api` are handled by their own artifacts.
4. On `https://brikvest.net/api/healthz`, require release
   `flutterwave-live-preparation-2026-11-21`, collection/recovery/payment mail
   false, legal/application mail paused true, and
   `notificationQueuePauseProtocol=preclaim-notification-pause-v1`.
   This response verifies code
   and switch adoption, not database guards, provider validity or global
   maintenance-lock ownership. Do not accept the old `{status:"ok"}` alone.
   The preparation-time public GET returned HTTP 200 but not the expected JSON;
   it did not establish active backend/release adoption.
5. With the approved maintenance controls effective, the owner installs the
   reviewed unsupported guards through the production SQL console. Recheck
   enabled trigger events/functions, body hashes, columns, constraints and
   indexes through read-only production catalogs. Never test a guard by
   approving or altering a real holding.
6. Preserve the explicit historical-data boundary: the new cost-basis column
   does not classify old purchases. Holdings without historical evidence may
   remain unavailable rather than being recalculated from current listing
   costs. Confirm this inherited product behaviour before release; historical
   adoption needs a separately selected, evidence-backed process.
7. Securely confirm/update the v3 live secret and matching live-merchant
   webhook hash. Configure the merchant's webhook at
   `https://brikvest.net/api/payments/flutterwave/webhook` with retries. Public
   deployment visibility makes the route reachable in principle, not proven
   authenticated provider delivery. Do not send a fabricated paid event.
8. Verify merchant eligibility, allowed currencies/limits, gateway-fee
   absorption and recovery coverage. Autoscale timers can sleep; require an
   agreed authenticated recovery schedule/operator procedure or approved
   always-running hosting. Do not create a public admin recovery endpoint.
9. Obtain the explicit collection go-ahead only after these gates pass.
   Enable live authorization/recovery and collection in the intended published
   environment, then verify effective settings. Leave all Brikvest mail paused
   unless separately authorized. No real-payment end-to-end result is claimed.

## Collection-only incident pause

After live collection is authorized, pause **new** checkout creation with
`FLW_ENABLED=false`, while preserving valid live configuration,
`FLW_LIVE_AUTHORIZED=true` and separately authorized recovery. Do not revoke or
replace the verification credentials or turn off recovery while hosted attempts
remain unresolved. Verification and link closure can continue in this state.
Never turn a provider timeout, internal cancellation or disabled link into
permission to pay again, refund, release inventory or erase evidence.

## Isolated verification

Payment/preparation regression tests and the holding-cost/exact-PDF suites run
with disposable PGlite and mocked provider/mail dependencies. The live
preparation checks cover collection-off recovery, unauthorized live mode and
SMTP suppression. The production API and main frontend compile independently
with the artifact build environment; no backend startup or provider call is
needed for a compile.

### Real PostgreSQL concurrency evidence (2026-11-21)

Run from the workspace root:

```sh
pnpm test:flutterwave:postgres
```

Requires PostgreSQL's `initdb`, `pg_ctl` and `createdb` on `PATH`, Node and pnpm.
The runner creates its **own fresh disposable PostgreSQL cluster** in a private
temporary directory, disables TCP listening and connects only through that
cluster's Unix socket. It never accepts a database URL. Child processes receive
an allowlisted environment, invalid application database URLs and no inherited
provider, SMTP or database secrets. Before any fixture DDL, tests verify the
runner's marker, database name, Unix-socket connection and exact server data
directory. The runner stops and deletes its cluster on completion or test failure.
Do not run these fixtures against an existing development, sandbox or production
database. A missing PostgreSQL binary fails the command; it never falls back to
PGlite or a configured investor database.

`tests/postgres/flutterwave-concurrency.test.ts` exercises the actual payment,
route, checkout-closure and approval functions through a real `pg` pool and
Drizzle transactions. Only the database binding, provider HTTP and mail transport
are replaced. Synthetic schema comes from `flutterwave-fixture.sql`, the actual
payment table/index DDL and inventory-ledger DDL. The two payment/cost guards
come directly from the reviewed SQL-console draft; only its database identity
assertion is changed. Both enabled trigger body hashes must match the reviewed
values above.

For holding races, the first transaction pauses **after** taking real
reservation/property row locks. The contender runs on a distinct PostgreSQL
backend; `pg_blocking_pids()` must show it waiting on the first before release.
Both lock-acquisition orders are exercised where the order changes the result.
Assertions reject deadlocks, lock timeouts and hidden verification failures.

Verified on PostgreSQL 16.10: **19 tests passed**:

| Interleaving / failure | Required result |
| --- | --- |
| Authenticated synthetic webhook vs browser return | One receipt and verification audit; no allocation; recovery job completed |
| Two admin approvals | One succeeds; exactly one inventory conversion, certificate, approval audit and queued confirmation |
| Duplicate receipt verification vs approval, both orders | Approval remains final; no duplicate receipt or allocation |
| A second actual charge vs approval, both orders | Both charges retained in reconciliation; at most one allocation, never silently erased evidence |
| Manual proof vs new receipt, both orders | Proof remains pending; gateway reconciles; neither allocates |
| Manual proof vs gateway approval, both orders | Competing evidence blocks both approvals |
| Two manual proof approvals without a gateway | Only one submission approval and inventory conversion |
| Direct manual confirmation vs gateway approval, both orders | Manual bypass refused; gateway allocates only once |
| Cancellation vs verification, both orders | Unresolved/received payment prevents releasing held inventory |
| Late receipt with replacement checkout and duplicate verification | Replacement quarantined and closure completed while collection stays off |
| Concurrent link closure success vs delayed failure | Confirmed `done` is not overwritten or counted as a failed retry |
| Certificate insertion failure | Receipt remains reviewable; inventory, cost basis, approval audit and confirmation job all roll back; retry succeeds once |
| Guard enforcement | Checkout expectations and confirmed purchase costs cannot be rewritten |

All cases keep `FLW_ENABLED=false`, payment workers and notification dispatch off,
and legal/application mail paused. HTTP is mocked with an exact endpoint
allowlist: no charge or external provider request occurs; application mail is
forbidden and asserted unused. Successful approval creates only a synthetic
queued notification intent, never sends it. The existing
`pnpm test:flutterwave` suite also passed (51 tests).

Scope: the minimal fixture deliberately leaves the legal document workflow
uninstalled, so this suite checks payment/inventory/cost atomicity, not PDF
generation or exact-PDF review interleavings. Existing exact-PDF safeguard tests
remain separate. This is not evidence that production has these guards or that
a real webhook, provider link disable or live transaction works. Main's payment
implementation did not need changing for these tested schedules.

These checks do not replace authenticated production webhook evidence or an
authorized live transaction. All collection and publication release gates above
remain unchanged.
