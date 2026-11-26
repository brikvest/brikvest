# Flutterwave live launch — owner SQL run sheet

**For the project owner only. Run in Database → Production → SQL console.**
The agent has not run, and cannot run, any of this against production. Publish
does not carry functions or triggers, so these three database safeguards exist
in production only after you run the two blocks below.

The SQL here is reproduced byte-for-byte from the two reviewed documents
([payment guards](flutterwave-production-guards-console.md), section 1, and the
[exact-PDF approval safeguard](pdf-approval-safeguard-review.md)). An automated
check fails if this sheet ever differs from them. Do not edit, merge, reformat
or partially run the blocks.

Until all three safeguards are installed, the application keeps Flutterwave
checkout and gateway approval unavailable in live mode. Bank transfer, payment
verification, webhook intake and recovery are not affected.

## Before you start

1. New collection is off or the safeguards are not yet installed (the app
   refuses live checkout without them), and all Brikvest mail is still paused.
2. Nobody approves investor PDFs or payments for the few seconds each block
   runs: each block briefly locks the tables it protects. Both blocks give up
   after 5 seconds waiting for a lock and 30 seconds overall, changing nothing.
3. In Database → Production → Settings, note the current time as a recovery
   point (point-in-time recovery). No restore is part of this procedure.
4. Run block 1 completely, then block 2 completely, then the check in step 3.

**If anything reports an error:** type `ROLLBACK;` and run it, change nothing
else, do not retry with altered SQL, and report the exact message. An error
such as "A guard already exists" or "differs from the reviewed contract" means
production is not in the reviewed state: stop and ask for it to be inspected.

## Block 1 — payment expectation and frozen purchase-cost guards

Creates two functions and two triggers. It adds no tables or columns and
changes no purchases, holdings or mail.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;
DO $preflight$
BEGIN
  IF current_database() <> 'neondb' OR
     (SELECT count(*) FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN
       ('flutterwave_attempts','flutterwave_charges','flutterwave_verification_jobs',
        'flutterwave_audit','flutterwave_confirmation_jobs','flutterwave_checkout_closures')) <> 6 OR
     NOT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='investment_reservations'
       AND column_name='cost_basis' AND data_type='jsonb' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'Production identity or published prerequisites differ';
  END IF;
  IF to_regprocedure('public.protect_flutterwave_expected()') IS NOT NULL OR
     to_regprocedure('public.guard_holding_cost_basis()') IS NOT NULL OR
     EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgname IN ('flutterwave_expected_immutable','holding_cost_basis_guard')
       AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'A guard already exists: inspect it instead of replacing it';
  END IF;
END
$preflight$;
LOCK TABLE public.investment_reservations, public.flutterwave_attempts
  IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION public.protect_flutterwave_expected() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.reservation_id,NEW.user_id,NEW.tx_ref,NEW.expected_amount,NEW.expected_currency,NEW.mode)
     IS DISTINCT FROM ROW(OLD.reservation_id,OLD.user_id,OLD.tx_ref,OLD.expected_amount,OLD.expected_currency,OLD.mode) THEN
    RAISE EXCEPTION 'Flutterwave checkout expectations are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER flutterwave_expected_immutable
  BEFORE UPDATE ON public.flutterwave_attempts
  FOR EACH ROW EXECUTE FUNCTION public.protect_flutterwave_expected();

CREATE FUNCTION public.guard_holding_cost_basis() RETURNS trigger AS $$
DECLARE b jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cost_basis IS NOT NULL THEN
      RAISE EXCEPTION 'Cost basis must be recorded by a payment confirmation transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.cost_basis IS NOT NULL THEN
    IF NEW.cost_basis IS DISTINCT FROM OLD.cost_basis OR
       NEW.units IS DISTINCT FROM OLD.units OR NEW.amount IS DISTINCT FROM OLD.amount OR
       NEW.currency IS DISTINCT FROM OLD.currency OR NEW.property_id IS DISTINCT FROM OLD.property_id THEN
      RAISE EXCEPTION 'Confirmed holding cost basis and purchase amounts are immutable';
    END IF;
  ELSIF NEW.cost_basis IS NOT NULL THEN
    IF OLD.status NOT IN ('reserved','payment_pending','expired','cancelled') OR
       NEW.status <> 'converted_to_investment' OR
       NEW.units IS DISTINCT FROM OLD.units OR NEW.amount IS DISTINCT FROM OLD.amount OR
       NEW.currency IS DISTINCT FROM OLD.currency OR NEW.property_id IS DISTINCT FROM OLD.property_id THEN
      RAISE EXCEPTION 'Historical cost basis adoption requires separate verified authorization';
    END IF;
    b := NEW.cost_basis;
    IF NOT (b ?& ARRAY['version','units','currency','landAmount','agentFees',
        'dueDiligenceFees','serviceCharges','acquisitionAmount','confirmedAt',
        'confirmedByAdminId','source','sourceId']) OR
       (b->>'version') IS DISTINCT FROM '1' OR
       (b->>'currency') IS DISTINCT FROM NEW.currency OR
       (b->>'units')::numeric IS DISTINCT FROM NEW.units OR
       (b->>'acquisitionAmount')::numeric IS DISTINCT FROM NEW.amount OR
       NOT COALESCE(((b->>'landAmount')::numeric > 0 AND (b->>'agentFees')::numeric >= 0 AND
            (b->>'dueDiligenceFees')::numeric >= 0 AND (b->>'serviceCharges')::numeric >= 0 AND
            (b->>'confirmedByAdminId')::integer > 0 AND (b->>'sourceId')::integer > 0 AND
            (b->>'confirmedAt')::timestamptz IS NOT NULL AND
            (b->>'source') IN ('payment_submission','admin_full_confirmation','admin_reinstate') AND
            (b->>'landAmount')::numeric + (b->>'agentFees')::numeric +
            (b->>'dueDiligenceFees')::numeric + (b->>'serviceCharges')::numeric = NEW.amount), false) THEN
      RAISE EXCEPTION 'Holding cost basis must reconcile to the unchanged purchase';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER holding_cost_basis_guard
  BEFORE INSERT OR UPDATE ON public.investment_reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_holding_cost_basis();
COMMIT;
```

## Block 2 — exact-investor-PDF approval guard

Attaches one trigger to the existing, already-verified function. It replaces no
function and changes no approval records.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;
LOCK TABLE public.legal_pdf_review_approvals IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.legal_guard_pdf_review()')
      AND p.prorettype = 'pg_catalog.trigger'::regtype
      AND NOT p.prosecdef
      AND md5(p.prosrc) = 'f237ff6a023253ca2c2088724776c630'
  ) THEN
    RAISE EXCEPTION 'PDF review function differs from the reviewed contract';
  END IF;
END
$guard$;
CREATE TRIGGER legal_pdf_review_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.legal_pdf_review_approvals
  FOR EACH ROW EXECUTE FUNCTION public.legal_guard_pdf_review();
COMMIT;
```

## Step 3 — read-only acceptance check

```sql
SELECT c.relname AS table_name, t.tgname, t.tgenabled, t.tgtype,
       t.tgnargs, t.tgattr::text AS column_filter,
       t.tgqual IS NULL AS unconditional,
       p.proname, p.prosecdef, md5(p.prosrc) AS function_body_hash
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND t.tgname IN ('flutterwave_expected_immutable','holding_cost_basis_guard',
                  'legal_pdf_review_append_only')
ORDER BY t.tgname;
```

The result must be exactly these three rows. In every row `tgenabled` is `O`,
`tgnargs` is `0`, `column_filter` is empty, `unconditional` is true and
`prosecdef` is false.

| Table | Trigger | `tgtype` | Function | Function body hash |
| --- | --- | --- | --- | --- |
| `flutterwave_attempts` | `flutterwave_expected_immutable` | 19 | `protect_flutterwave_expected` | `e6e632dfa8a00362e9d70f45a46b7d02` |
| `investment_reservations` | `holding_cost_basis_guard` | 23 | `guard_holding_cost_basis` | `9639dd1f6a65cf9bff769a4e3bb3eba3` |
| `legal_pdf_review_approvals` | `legal_pdf_review_append_only` | 31 | `legal_guard_pdf_review` | `f237ff6a023253ca2c2088724776c630` |

Fewer rows, extra rows or any different value means stop: leave collection
off and report what you see. Do not test a safeguard by editing or approving a
real investor record.

After publishing, **Admin → Payment Reviews → Flutterwave payments → Live
readiness** shows the same three safeguards as "Installed" when the running
application can see them.
