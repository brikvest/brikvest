# Exact-investor-PDF approval safeguard — review draft

**Prepared only. Not applied. Not authorization to execute.**

## Finding and scope

Development already has `legal_pdf_review_append_only`. Production has no
user-defined trigger on `legal_pdf_review_approvals`, but does have the expected
`public.legal_guard_pdf_review()` function. Its inspected body fingerprint is
`f237ff6a023253ca2c2088724776c630` (MD5 of PostgreSQL `prosrc`, a drift check,
not a security signature).

The proposed repair adds **one trigger attachment**, using the existing function.
It creates/replaces no function or table and rewrites no approvals. The function:

- rejects UPDATE and DELETE of approval evidence;
- permits INSERT only when both exact current investor PDFs are ready;
- checks their types, pair, template IDs, hashes, artifact keys and placements;
- excludes superseded drafts.

This protects future writes. It does not retroactively validate historical
approvals, certify legal execution, or release signing emails.

## Execution prerequisites — not satisfied by this draft

Obtain separate explicit approval for the production trigger change. Confirm
the active application/database target, capture the pre-change time within the
owner-confirmed seven-day recovery window, and arrange a controlled maintenance
window for legal approval writes and dispatch. Main's newer legal-dispatch
pause is preserved; verify its effective state in the active release. Keep Flutterwave
collection and notification dispatch off. Verify any maintenance pause in the
active release, not just saved settings.

Use the supported owner-operated Database SQL console for this unsupported
publication object after approval. Do not install a migration runner, startup
hook or build hook. Re-read the function and trigger catalogs immediately first.
The body check below deliberately rejects drift, including formatting changes.
Do not weaken it to force an unexpected function through.

## Proposed SQL-console transaction

Run the whole transaction together only after separate authorization. It is
bounded by timeouts, takes a table lock, verifies the function body, and creates
the missing trigger without dropping anything. If the trigger already exists,
PostgreSQL aborts rather than replacing it: inspect that existing trigger.
On any error, issue `ROLLBACK` and leave collection disabled.

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

## Post-change acceptance checks

Read-only catalog checks must show exactly the intended enabled row-level BEFORE
INSERT/UPDATE/DELETE trigger bound to the reviewed function, without a WHEN
predicate or column filter. Reconfirm its function body and existing table
constraints. Do not test by updating, deleting or approving a real investor row.
Behavioral tests run only in disposable PGlite using synthetic records.

If verification fails, keep payment activation blocked and investigate. Do not
automatically drop the guard or restore a database: either action needs its own
assessment and authorization. No emails, allocations, refunds or document
generation are part of this repair.
