# Flutterwave v3 production schema change list — review draft

## Status and limitation

The owner accepted this scope and the separate PDF-safeguard draft. The current
deliverable is a disabled preparation package ready for main, not execution of
production changes. See [main-project handoff](flutterwave-main-handoff.md).

**Prepared only; no production writes or activation.** This is a scoped
catalog-based change inventory, **not the actual SQL diff from Publish**.
The schema-diff callback is unavailable in this task environment. It is not
possible to certify that Publish will contain only this list until its actual
statements are available for review. Do not approve unrelated or destructive
statements on the strength of this document.

Read-only platform catalog checks show the objects below exist in development
and no `flutterwave_*` relations exist in production. The application source uses
`DATABASE_URL`; running-release database identity still needs independent
verification. The owner confirmed production PITR is enabled for seven days.

**Inherited main-release blocker:** production lacks
`investment_reservations.cost_basis`, which the current main branch already
requires for ordinary reservation reads/approval writes. This task did not add
that dependency: `server/legal/approval.ts` and `shared/holding-costs.ts` match
main, and its schema diff against main adds only Flutterwave attempt guards.
Do not publish the combined release without separately resolving the main
holding-cost schema and historical-portfolio rollout. Neither the reservation
column nor classification/backfill of existing holdings is authorized by the
six-table scope below. See the [handoff warning](flutterwave-main-handoff.md).

## A. Managed publication schema scope

| New empty table | Purpose | Required keys and relationships |
| --- | --- | --- |
| `flutterwave_attempts` | Immutable expected payment and review state | Serial primary key; reservation, user and reviewing-admin foreign keys; unique reference and provider transaction ID |
| `flutterwave_charges` | Each authenticated provider receipt | Transaction ID primary key; nullable attempt foreign key for unmatched charges |
| `flutterwave_verification_jobs` | Durable verification retry work | Transaction ID primary key |
| `flutterwave_audit` | Payment decision history | Serial primary key; attempt and optional admin foreign keys |
| `flutterwave_confirmation_jobs` | Separately gated confirmation outbox | Reservation ID primary key and foreign key |
| `flutterwave_checkout_closures` | Durable external checkout closure work | Attempt ID primary key and foreign key |

Expected totals for this scoped addition:

- six tables, **48 columns**, two owned serial sequences;
- six primary keys, eight foreign keys, two additional unique constraints;
- two CHECK constraints on attempts: positive expected amount; mode test/live;
- one partial unique index on reservation ID for states
  `initiated`/`verification_pending` (`flutterwave_one_open_attempt`);
- nine indexes in total, including primary/unique backing indexes.

The detailed column/default/nullability contract is already in
`shared/schema.ts` and `scripts/ensure-flutterwave.sql`, and was verified in
development. The SQL file is a contract/test fixture, not a production script
to run around managed publication.

Expected price/receipt decimals are `numeric(20,2)`; operational timestamps are
timezone-aware. Unmatched charges retain nullable attempt IDs. Defaults start
attempts as initiated and work/outbox rows as queued. There are **no inserts,
backfills or updates to historical investor data** in this change list.

Review the actual publication statements for all of these semantics, not just
table names. Stop for any DROP/TRUNCATE, rename, data overwrite, unrelated alter,
inventory adoption, price rewrite or missing constraint. Existing reservations,
users, admins and certificates must not be recreated.

## B. Flutterwave function and trigger — separate supported deployment

Publish does not automatically copy PostgreSQL functions/triggers.
The payment guard requires its own reviewed owner-operated SQL-console step:

- `public.protect_flutterwave_expected()` returns a trigger and rejects changes
  to reservation ID, user ID, reference, expected amount, expected currency or mode.
- `flutterwave_expected_immutable`: enabled BEFORE UPDATE, FOR EACH ROW on
  `public.flutterwave_attempts`, executing that function.

This is separate from the managed table publication. Its exact definition is
in the already-reviewed development contract. After the tables exist, compare
the proposed definition and the production catalog before approving this step.
Until the function and trigger are installed and verified, collection stays off.
Do not use a deploy-build or application-startup migration.

## C. Exact-PDF approval repair — separate approval

See [the trigger-only repair draft](pdf-approval-safeguard-review.md).
Production already has the approval table and matching function but lacks its
trigger. The draft attaches the guard only; it does not replay legal migrations,
replace the function, rewrite evidence, or grant historical approval.
This step is not implicitly authorized by approving the six payment tables.

## Configuration and release gates

Initial settings inspection found the Flutterwave enable/worker/mail flags
unset. The preparation package now explicitly saves `false` for all four
Flutterwave enable/live-authorization/worker/mail flags in development and
production configuration. None were enabled. This is saved-configuration
evidence, not proof of active-release
settings. Existing general/legal email is outside this payment rollout.
Main's newer `LEGAL_DISPATCH_PAUSED=true` configuration was preserved during
the merge; this package does not unpause it. No mail was dispatched by this
work, and no claim is made that all existing app email is globally paused.

Before any production execution:

1. Independently verify the active release, database target and maintenance pause.
2. Confirm a usable pre-change time within the reported seven-day PITR window.
3. Review the actual publication diff and separately approve unsupported guards.
4. Keep Flutterwave enabled/live-authorized/worker/mail-dispatch flags false
   throughout staging; no credential probes, sessions or real charges.
5. After authorized changes, verify production columns, constraints, indexes,
   enabled triggers and full function definitions using read-only queries.

Activation is a later decision. It also requires webhook delivery/retries,
recovery coverage on autoscale, a collection-only rollback that preserves
verification, and confirmation that the intended release uses the correct
credentials, origin and currency allowlist. Admin payment approval and exact-PDF
approval remain separate mandatory actions.
