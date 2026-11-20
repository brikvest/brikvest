-- Audited logical deletion for property-owned legal template versions.
-- Source files, immutable provenance, historical pins and global version
-- numbering are deliberately retained.
BEGIN;
LOCK TABLE legal_templates IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE legal_document_pairs, legal_documents IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE legal_templates ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE legal_templates ADD COLUMN IF NOT EXISTS deleted_by_admin_id integer
  REFERENCES admin_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX IF NOT EXISTS legal_templates_deleted_at_idx
  ON legal_templates(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION legal_guard_template_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by_admin_id IS NOT NULL THEN
      RAISE EXCEPTION 'New legal template versions cannot be inserted as deleted';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legal template versions are immutable and cannot be deleted';
  END IF;
  IF OLD.property_id IS NOT NULL AND NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    RAISE EXCEPTION 'Legal template property ownership is immutable once assigned';
  END IF;
  IF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at OR
     OLD.deleted_by_admin_id IS DISTINCT FROM NEW.deleted_by_admin_id THEN
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL OR
       OLD.deleted_by_admin_id IS NOT NULL OR NEW.deleted_by_admin_id IS NULL OR
       OLD.is_active OR NEW.is_active THEN
      RAISE EXCEPTION 'Legal template deletion metadata is write-once and cannot be cleared or activated';
    END IF;
    IF EXISTS (SELECT 1 FROM legal_document_pairs
        WHERE deed_template_id = OLD.id OR transfer_template_id = OLD.id)
       OR EXISTS (SELECT 1 FROM legal_documents WHERE template_id = OLD.id) THEN
      RAISE EXCEPTION 'Referenced legal template versions cannot be deleted';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['deleted_at', 'deleted_by_admin_id'])
         IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['deleted_at', 'deleted_by_admin_id']) THEN
      RAISE EXCEPTION 'Logical deletion may change only deletion metadata';
    END IF;
  END IF;
  IF OLD.deleted_at IS NOT NULL AND
     (to_jsonb(NEW) - ARRAY['deleted_at', 'deleted_by_admin_id'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['deleted_at', 'deleted_by_admin_id']) THEN
    RAISE EXCEPTION 'Deleted legal template versions are immutable';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['is_active', 'activated_at', 'property_id', 'deleted_at', 'deleted_by_admin_id'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['is_active', 'activated_at', 'property_id', 'deleted_at', 'deleted_by_admin_id']) THEN
    RAISE EXCEPTION 'Legal template content and provenance are immutable';
  END IF;
  IF NEW.deleted_at IS NOT NULL AND NEW.is_active THEN
    RAISE EXCEPTION 'Deleted legal template versions cannot be activated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS legal_templates_immutable ON legal_templates;
CREATE TRIGGER legal_templates_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON legal_templates
  FOR EACH ROW EXECUTE FUNCTION legal_guard_template_history();

-- A pin writer locks the template row in SHARE mode. The deletion UPDATE's row
-- lock conflicts with that lock, closing both possible orderings of the race:
-- either the reference commits before the deletion check, or it observes the
-- committed tombstone and is rejected.
CREATE OR REPLACE FUNCTION legal_guard_template_references() RETURNS trigger AS $$
DECLARE
  template_deleted_at timestamptz;
  template_id integer;
BEGIN
  IF TG_TABLE_NAME = 'legal_document_pairs' THEN
    FOREACH template_id IN ARRAY ARRAY[NEW.deed_template_id, NEW.transfer_template_id]
    LOOP
      IF template_id IS NOT NULL THEN
        SELECT deleted_at INTO template_deleted_at
        FROM legal_templates WHERE id = template_id FOR SHARE;
        IF template_deleted_at IS NOT NULL THEN
          RAISE EXCEPTION 'Deleted legal template versions cannot be newly pinned';
        END IF;
      END IF;
    END LOOP;
  ELSE
    SELECT deleted_at INTO template_deleted_at
    FROM legal_templates WHERE id = NEW.template_id FOR SHARE;
    IF template_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Deleted legal template versions cannot be newly referenced';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS legal_document_pairs_template_reference ON legal_document_pairs;
CREATE TRIGGER legal_document_pairs_template_reference
  BEFORE INSERT OR UPDATE OF deed_template_id, transfer_template_id ON legal_document_pairs
  FOR EACH ROW EXECUTE FUNCTION legal_guard_template_references();
DROP TRIGGER IF EXISTS legal_documents_template_reference ON legal_documents;
CREATE TRIGGER legal_documents_template_reference
  BEFORE INSERT OR UPDATE OF template_id ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION legal_guard_template_references();

COMMIT;