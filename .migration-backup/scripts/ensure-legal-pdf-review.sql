-- Controlled additive rollout only. No historical approvals are inferred.
BEGIN;
CREATE TABLE IF NOT EXISTS legal_pdf_review_approvals (
  id serial PRIMARY KEY,
  pair_id integer NOT NULL REFERENCES legal_document_pairs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_by_admin_id integer NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now(),
  deed_document_id integer NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  deed_sha256 text NOT NULL CHECK (deed_sha256 ~ '^[a-f0-9]{64}$'),
  transfer_document_id integer NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transfer_sha256 text NOT NULL CHECK (transfer_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (deed_document_id <> transfer_document_id),
  UNIQUE(pair_id,deed_document_id,deed_sha256,transfer_document_id,transfer_sha256)
);
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
DROP TRIGGER IF EXISTS legal_pdf_review_append_only ON legal_pdf_review_approvals;
CREATE TRIGGER legal_pdf_review_append_only BEFORE INSERT OR UPDATE OR DELETE
  ON legal_pdf_review_approvals FOR EACH ROW EXECUTE FUNCTION legal_guard_pdf_review();
COMMIT;