-- Additive unsigned-document revision support. Never rewrites existing files,
-- approvals, payment records, or signing evidence; no automatic corrections.
BEGIN;
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS consideration_amount_naira numeric(20,2);
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS supersedes_document_id integer REFERENCES legal_documents(id) ON DELETE RESTRICT;
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
-- Expand phase: preserve the original uniqueness constraint while the old
-- application is running. Finalize only after publishing the revision-aware code.
CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_current_pair_type_uq
  ON legal_documents(pair_id,document_type) WHERE superseded_at IS NULL;

CREATE OR REPLACE FUNCTION legal_guard_document_revision() RETURNS trigger AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.consideration_amount_naira IS DISTINCT FROM OLD.consideration_amount_naira
      OR NEW.supersedes_document_id IS DISTINCT FROM OLD.supersedes_document_id THEN
      RAISE EXCEPTION 'Document consideration and revision provenance are immutable';
    END IF;
    IF OLD.superseded_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'Superseded legal document history is immutable';
    END IF;
    IF NEW.superseded_at IS DISTINCT FROM OLD.superseded_at AND (
      OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL OR OLD.signed_pdf_key IS NOT NULL
      OR OLD.signing_envelope_id IS NOT NULL OR OLD.investor_signed_at IS NOT NULL
      OR OLD.status IN ('investor_signed','signing_in_progress')
      OR EXISTS (SELECT 1 FROM local_legal_signing_operations s WHERE s.pair_id=OLD.pair_id)
      OR EXISTS (SELECT 1 FROM legal_jobs j WHERE j.pair_id=OLD.pair_id AND j.status='leased')
      OR EXISTS (SELECT 1 FROM legal_notification_cycles c WHERE c.pair_id=OLD.pair_id AND c.status IN ('sent','sending','uncertain'))
    ) THEN RAISE EXCEPTION 'Only safely unsigned, unsent documents may be superseded'; END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.supersedes_document_id IS NOT NULL THEN
    IF NEW.consideration_amount_naira IS NULL OR NEW.consideration_amount_naira <= 0 OR NOT EXISTS (
      SELECT 1 FROM legal_documents d JOIN legal_document_pairs p ON p.id=d.pair_id
      WHERE d.id=NEW.supersedes_document_id AND d.pair_id=NEW.pair_id
        AND d.document_type=NEW.document_type AND d.template_id=NEW.template_id
        AND d.superseded_at IS NOT NULL AND d.signed_pdf_key IS NULL
        AND NEW.consideration_amount_naira <= p.payment_amount_naira
        AND p.documents_ready_at IS NULL AND p.status='queued'
    ) THEN RAISE EXCEPTION 'A corrected draft must preserve its unsigned predecessor and payment history'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS legal_documents_revision_history ON legal_documents;
CREATE TRIGGER legal_documents_revision_history BEFORE INSERT OR UPDATE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION legal_guard_document_revision();

-- Existing approvals remain immutable evidence, but cannot approve archived PDFs.
-- This replaces only the guard function; it neither creates nor backfills reviews.
CREATE OR REPLACE FUNCTION legal_guard_pdf_review() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'PDF review approvals are append-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM legal_documents d JOIN legal_documents t ON t.pair_id=d.pair_id
    JOIN legal_document_pairs p ON p.id=d.pair_id
    WHERE p.id=NEW.pair_id AND p.documents_ready_at IS NOT NULL
      AND d.superseded_at IS NULL AND t.superseded_at IS NULL
      AND d.id=NEW.deed_document_id AND t.id=NEW.transfer_document_id
      AND d.document_type='deed_of_assignment' AND t.document_type='transfer_exit_rights'
      AND d.template_id=p.deed_template_id AND t.template_id=p.transfer_template_id
      AND d.unsigned_pdf_sha256=NEW.deed_sha256 AND t.unsigned_pdf_sha256=NEW.transfer_sha256
      AND d.unsigned_pdf_key IS NOT NULL AND t.unsigned_pdf_key IS NOT NULL
      AND d.signature_placement IS NOT NULL AND t.signature_placement IS NOT NULL) THEN
    RAISE EXCEPTION 'Approval must identify both exact ready investor PDFs';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMIT;