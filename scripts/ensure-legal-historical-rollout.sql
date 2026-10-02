-- Explicit additive rollout provenance only. No holdings, jobs or emails are
-- created by this migration. Existing uniqueness/write-once guards stay intact.
BEGIN;
ALTER TABLE legal_document_pairs
  DROP CONSTRAINT IF EXISTS legal_document_pairs_approval_source_check;
ALTER TABLE legal_document_pairs
  ADD CONSTRAINT legal_document_pairs_approval_source_check CHECK (
    approval_source IN ('payment_submission','admin_full_confirmation','admin_reinstate','historical_rollout')
  );
-- historical_rollout intentionally uses reservation_id as source_id and NULL
-- payment_submission_id, preserving legal_pair_approval_source_consistent.
COMMIT;