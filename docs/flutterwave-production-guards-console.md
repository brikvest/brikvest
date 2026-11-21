# Reviewed production guard installation

**Owner-operated SQL-console draft; not executed in production.**

These functions/triggers are not copied by Publish. Apply them manually through
Database → Production → SQL console only after explicit approval, the reviewed
table/column publication, recovery confirmation and effective maintenance
controls for confirmations/legal writes/dispatch. Do not run this document from
an application, CLI production connection, build hook or startup hook.

Keep `neondb_owner` ownership unchanged. Never copy test data into production.
If a guard already exists, this draft refuses to replace it: inspect its exact
definition instead. On any error, roll back and keep collection disabled.

## 1. Payment expectation and frozen purchase-cost guards

This transaction creates only two functions and two triggers. It does not add
tables/columns, classify old holdings, update purchases or release mail.
Timeouts are deliberate; retry only in an appropriate maintenance window.

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

## 2. Exact-investor-PDF review guard

Use the already approved, bounded transaction in
[pdf-approval-safeguard-review.md](pdf-approval-safeguard-review.md).
It verifies the existing function body and attaches
`legal_pdf_review_append_only` without replacing the function or changing any
approval evidence. Its expected function-body hash remains
`f237ff6a023253ca2c2088724776c630`.

Do not certify completion of all guards after executing only section 1.

## 3. Read-only acceptance query

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

Require exactly the following three enabled, unconditional triggers with zero
arguments, empty column filters and non-security-definer functions:

| Table | Trigger | `tgtype` | Function body hash |
| --- | --- | --- | --- |
| `flutterwave_attempts` | `flutterwave_expected_immutable` | 19 | `e6e632dfa8a00362e9d70f45a46b7d02` |
| `investment_reservations` | `holding_cost_basis_guard` | 23 | `9639dd1f6a65cf9bff769a4e3bb3eba3` |
| `legal_pdf_review_approvals` | `legal_pdf_review_append_only` | 31 | `f237ff6a023253ca2c2088724776c630` |

Production remains unverified until these catalogs and all supported table
constraints/indexes are independently checked. Do not exercise guards on real
investor rows. Unexpected definitions mean stop and investigate, not remove
evidence, replace guards blindly, change ownership or suppress verification.
