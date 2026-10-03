-- Cutover phase: publish the revision-aware application before running this.
-- No rows, files, payment evidence, or approvals are changed by this script.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='legal_documents_revision_history' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='legal_documents_current_pair_type_uq') THEN
    RAISE EXCEPTION 'Install and verify unsigned revision support before finalizing uniqueness';
  END IF;
END;
$$;
ALTER TABLE legal_documents DROP CONSTRAINT IF EXISTS legal_documents_pair_type_uq;
COMMIT;