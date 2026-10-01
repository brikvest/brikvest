-- Explicit property ownership migration. Never changes pins, files or evidence.
BEGIN;
LOCK TABLE legal_templates IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE legal_templates ADD COLUMN IF NOT EXISTS property_id integer
  REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION legal_guard_template_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legal template versions are immutable and cannot be deleted';
  END IF;
  IF OLD.property_id IS NOT NULL AND NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    RAISE EXCEPTION 'Legal template property ownership is immutable once assigned';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['is_active', 'activated_at', 'property_id'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['is_active', 'activated_at', 'property_id']) THEN
    RAISE EXCEPTION 'Legal template content and provenance are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Run provenance adoption exactly once. Subsequent runs must not silently assign
-- previously ambiguous versions after provenance/bindings have changed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_templates_active_requires_property') THEN
    WITH candidates AS (
      SELECT t.id, p.property_id
      FROM legal_templates t JOIN legal_document_pairs p
        ON p.deed_template_id = t.id OR p.transfer_template_id = t.id
      UNION
      SELECT t.id, b.property_id FROM legal_templates t
      CROSS JOIN legal_property_bindings b
      WHERE b.enabled AND b.bound_at <= t.created_at
    ), unambiguous AS (
      SELECT id, min(property_id) AS property_id FROM candidates
      GROUP BY id HAVING count(DISTINCT property_id) = 1
    ), assigned AS (
      UPDATE legal_templates t SET property_id = u.property_id
      FROM unambiguous u WHERE t.id = u.id AND t.property_id IS NULL
      RETURNING t.id, t.property_id
    )
    INSERT INTO legal_audit_events(actor_type,event_type,details)
      SELECT 'system','template_property_provenance_assigned',
        jsonb_build_object('templateId',id,'propertyId',property_id) FROM assigned;
    UPDATE legal_templates SET is_active = false WHERE property_id IS NULL AND is_active;
    ALTER TABLE legal_templates ADD CONSTRAINT legal_templates_active_requires_property
      CHECK (NOT is_active OR property_id IS NOT NULL);
  END IF;
END;
$$;
DROP INDEX IF EXISTS legal_templates_one_active_per_type_uq;
CREATE UNIQUE INDEX IF NOT EXISTS legal_templates_one_active_per_property_type_uq
  ON legal_templates(property_id,document_type) WHERE is_active;

-- Each historical pin is independently immutable. A missing counterpart may
-- be filled by controlled recovery without changing the existing version.
CREATE OR REPLACE FUNCTION legal_guard_pair_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legal document approval history cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY[
        'deed_template_id', 'transfer_template_id', 'status', 'last_error',
        'documents_ready_at', 'investor_signed_at'
      ]) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
        'deed_template_id', 'transfer_template_id', 'status', 'last_error',
        'documents_ready_at', 'investor_signed_at'
      ]) THEN
    RAISE EXCEPTION 'Legal approval provenance and snapshots are immutable';
  END IF;
  IF (OLD.deed_template_id IS NOT NULL AND
      NEW.deed_template_id IS DISTINCT FROM OLD.deed_template_id) OR
     (OLD.transfer_template_id IS NOT NULL AND
      NEW.transfer_template_id IS DISTINCT FROM OLD.transfer_template_id) THEN
    RAISE EXCEPTION 'Pinned legal template versions cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMIT;