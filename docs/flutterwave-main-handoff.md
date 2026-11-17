# Flutterwave v3 — disabled main-project handoff

## Delivery scope

The owner selected **v3 hosted Standard** and approved the schema inventory and
PDF-safeguard review. The final delivery request is preparation ready to apply
to main, **not production activation**. Do not publish, create a real checkout,
probe live credentials, charge an investor or send rollout emails.

## What to apply through the normal task merge

- `shared/schema.ts`: six payment tables with the positive amount/mode checks
  and partial one-open-checkout unique index.
- `.replit`: explicit `false` values in development and production for
  `FLW_ENABLED`, `FLW_LIVE_AUTHORIZED`, `FLW_WORKER_ENABLED` and
  `FLW_NOTIFICATION_DISPATCH`.
- The approved review documents below, their isolated regression tests and the
  setup documentation selecting v3 rather than the superseded v4 investigation.

These are committed project files; no manual patch transfer is needed. Merging
does not publish or prove that the active production release adopted settings.
Existing unrelated email behavior is unchanged: the payment email switch is not
a global mail pause. This package must not dispatch legal or investor email.

## Approved documents

1. [Production schema inventory](flutterwave-production-change-review.md):
   six tables, 48 columns, two sequences, keys/checks/indexes, plus the required
   Flutterwave immutable-expectation guard. The owner accepted this scope.
   **This is not the unavailable Publish-generated SQL diff.**
2. [PDF-approval safeguard review](pdf-approval-safeguard-review.md):
   the approved trigger-only repair draft, checking the reviewed function body
   before attaching the existing function. Prepared, tested, not applied.
3. [Rollout preparation record](flutterwave-v3-schema-rollout.md):
   verified development installation and remaining operational gates.
4. [Integration setup](flutterwave-payments.md):
   v3 contract, server verification, review lifecycle and recovery requirements.

## Database handoff is not automatic

### Stop: inherited main-project prerequisites are not part of this scope

The main branch already includes frozen holding-cost behavior and
`investment_reservations.cost_basis`. After syncing, comparison against
`main-repl/main` showed **no task changes** to `shared/holding-costs.ts` or
`server/legal/approval.ts`; the task's `shared/schema.ts` changes are limited to
Flutterwave attempt checks and its partial unique index. Do not remove or
silently republish those unrelated main changes as part of this handoff.

A read-only production check found `investment_reservations.cost_basis`
**absent**. The current main source reads/writes that field, independently of the
Flutterwave switches. Therefore **do not publish the combined main release**
until the owner-approved holding-cost rollout has resolved its schema dependency.
Also separately verify historical non-Guzape portfolio principal behavior where
no frozen snapshot exists; this task has not migrated historical holdings or
certified that product change. Do not fabricate snapshots to clear the gate.

The six-table inventory is not approval for adding the reservation column or
changing historical portfolio classification. The actual publication diff may
include this pre-existing main work; it requires its own reviewed authorization
and sequencing. Keeping Flutterwave off does not make missing main prerequisites
safe to deploy. This package is ready to **merge for preparation**, not publish.

Six empty Flutterwave tables and their guards were installed and verified only
in this task's development target under the owner's separate authorization.
Do not assume those database objects are transferred by merging source.
Main's development database may be a different target: verify it first.

The existing post-merge script deliberately skips database mutations when
`SKIP_POST_MERGE_DATABASE_MUTATIONS=true`; keep that setting. Do not remove this
fence, run `db:push`, add startup/build DDL, or replay unrelated legacy migrations
to make a publication diff appear.

After merge, the main-project Agent should:

1. Recheck the four Flutterwave off switches in saved development/production
   configuration. Do not enable them or alter existing obligations blindly.
2. Compare main development catalogs with the prepared contract, including
   triggers/functions. If missing, confirm database identity and the scope of
   owner authorization before applying only the reviewed development schema
   through the supported flow. No real investor test data or backfill.
3. Confirm that production still matches the assumptions in the review:
   no Flutterwave objects and the expected PDF-review function but no attachment.
   Stop and reassess if anything changed. Read-only queries only at this stage.
4. Obtain the actual managed publication change list. Check the six-table scope
   for exact column/default/key/index semantics and stop for unrelated changes,
   drops, truncation or overwrite. Never mistake “nothing pending” for schema
   installation, and do not ask for publication before main has the changes.
5. Keep publication, unsupported function/trigger deployment and activation
   explicitly outside this preparation handoff. No direct production migration
   runner. Use the supported owner-operated path for approved unsupported guards
   only at the separately scheduled production stage.

## Evidence and remaining boundaries

- The owner reported seven-day production point-in-time recovery. No restore
  was attempted or specific restore timestamp independently verified.
- Both secret names were present; values were never read or logged. Key
  acceptance, active-release adoption and authenticated webhook delivery remain
  unverified. Do not substitute OAuth/v4 contracts.
- Intended later live configuration: `FLW_MODE=live`,
  `FLW_RETURN_ORIGIN=https://brikvest.net`,
  `FLW_CURRENCIES=NGN,USD,GBP,EUR`; no FX or display-currency charging.
  These are not enablement instructions for this package.
- Production publication, schema/guards, active configuration, recovery coverage
  on autoscale, collection-only rollback and any real-payment validation remain
  unperformed. Verified receipt must await explicit admin approval; exact-PDF
  approval remains independent.

## Isolated verification

```sh
npm run test:flutterwave:preparation
npm run build
```

The preparation command uses disposable PGlite, synthetic provider fixtures and
mocked/blocked mail. It includes payment behavior, schema guards, the actual
review-draft SQL, the exact-PDF approval boundary and disabled handoff settings.
It does not connect to development/production data or live Flutterwave.
