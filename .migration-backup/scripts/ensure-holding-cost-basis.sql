-- Additive schema only. No historical classification or payment/evidence edits.
-- Apply explicitly before publishing the confirmation-aware application.
BEGIN;
ALTER TABLE investment_reservations ADD COLUMN IF NOT EXISTS cost_basis jsonb;

CREATE OR REPLACE FUNCTION guard_holding_cost_basis() RETURNS trigger AS $$
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
DROP TRIGGER IF EXISTS holding_cost_basis_guard ON investment_reservations;
CREATE TRIGGER holding_cost_basis_guard BEFORE INSERT OR UPDATE ON investment_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_holding_cost_basis();
COMMIT;