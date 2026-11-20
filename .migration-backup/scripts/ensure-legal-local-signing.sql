-- Additive, idempotent persistence for first-party in-app legal signing.
-- Historical legal_signing_operations rows and their guards remain untouched.
BEGIN;

CREATE TABLE IF NOT EXISTS local_legal_signing_operations (
  id serial PRIMARY KEY,
  document_id integer NOT NULL UNIQUE
    REFERENCES legal_documents(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  pair_id integer NOT NULL
    REFERENCES legal_document_pairs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  user_id integer NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  template_id integer NOT NULL
    REFERENCES legal_templates(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  signer_name text NOT NULL CHECK (length(trim(signer_name)) > 0),
  signer_email text NOT NULL CHECK (length(trim(signer_email)) > 0),
  unsigned_pdf_sha256 text NOT NULL CHECK (unsigned_pdf_sha256 ~ '^[a-f0-9]{64}$'),
  signature_placement jsonb NOT NULL,
  signed_pdf_record_key uuid NOT NULL UNIQUE,
  certificate_record_key uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'accepted', 'signing', 'completed')),
  challenge_hash text,
  challenge_expires_at timestamptz,
  failed_auth_attempts integer NOT NULL DEFAULT 0 CHECK (failed_auth_attempts >= 0),
  auth_locked_until timestamptz,
  consent_version text,
  consent_text text,
  accepted_at timestamptz,
  reauthenticated_at timestamptz,
  evidence_snapshot jsonb,
  evidence_sha256 text CHECK (
    evidence_sha256 IS NULL OR evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  signature_png_base64 text,
  signature_sha256 text CHECK (
    signature_sha256 IS NULL OR signature_sha256 ~ '^[a-f0-9]{64}$'
  ),
  lease_token uuid,
  lease_until timestamptz,
  signed_pdf_sha256 text CHECK (
    signed_pdf_sha256 IS NULL OR signed_pdf_sha256 ~ '^[a-f0-9]{64}$'
  ),
  certificate_sha256 text CHECK (
    certificate_sha256 IS NULL OR certificate_sha256 ~ '^[a-f0-9]{64}$'
  ),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_legal_signing_lease_consistent CHECK (
    (lease_token IS NULL AND lease_until IS NULL)
    OR
    (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  ),
  CONSTRAINT local_legal_signing_draft_has_no_acceptance CHECK (
    status <> 'draft' OR (
      consent_version IS NULL
      AND consent_text IS NULL
      AND accepted_at IS NULL
      AND reauthenticated_at IS NULL
      AND evidence_snapshot IS NULL
      AND evidence_sha256 IS NULL
      AND signature_png_base64 IS NULL
      AND signature_sha256 IS NULL
    )
  ),
  CONSTRAINT local_legal_signing_accepted_has_evidence CHECK (
    status = 'draft' OR (
      consent_version IS NOT NULL
      AND length(trim(consent_version)) > 0
      AND consent_text IS NOT NULL
      AND length(trim(consent_text)) > 0
      AND accepted_at IS NOT NULL
      AND reauthenticated_at IS NOT NULL
      AND evidence_snapshot IS NOT NULL
      AND evidence_sha256 IS NOT NULL
      AND signature_png_base64 IS NOT NULL
      AND length(signature_png_base64) > 0
      AND signature_sha256 IS NOT NULL
    )
  ),
  CONSTRAINT local_legal_signing_completed_has_artifacts CHECK (
    (status = 'completed'
      AND completed_at IS NOT NULL
      AND signed_pdf_sha256 IS NOT NULL
      AND certificate_sha256 IS NOT NULL
      AND lease_token IS NULL
      AND lease_until IS NULL)
    OR
    (status <> 'completed'
      AND completed_at IS NULL
      AND signed_pdf_sha256 IS NULL
      AND certificate_sha256 IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS local_legal_signing_operations_pair_status_idx
  ON local_legal_signing_operations(pair_id, status, lease_until);
CREATE INDEX IF NOT EXISTS local_legal_signing_operations_owner_idx
  ON local_legal_signing_operations(user_id, created_at);

CREATE OR REPLACE FUNCTION legal_guard_local_signing_operation_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Local legal signing operation history cannot be deleted';
  END IF;

  IF (to_jsonb(NEW) - ARRAY[
        'status', 'challenge_hash', 'challenge_expires_at',
        'failed_auth_attempts', 'auth_locked_until', 'consent_version',
        'consent_text', 'accepted_at', 'reauthenticated_at',
        'evidence_snapshot', 'evidence_sha256', 'signature_png_base64',
        'signature_sha256', 'lease_token', 'lease_until',
        'signed_pdf_sha256', 'certificate_sha256', 'last_error',
        'completed_at', 'updated_at'
      ]) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
        'status', 'challenge_hash', 'challenge_expires_at',
        'failed_auth_attempts', 'auth_locked_until', 'consent_version',
        'consent_text', 'accepted_at', 'reauthenticated_at',
        'evidence_snapshot', 'evidence_sha256', 'signature_png_base64',
        'signature_sha256', 'lease_token', 'lease_until',
        'signed_pdf_sha256', 'certificate_sha256', 'last_error',
        'completed_at', 'updated_at'
      ]) THEN
    RAISE EXCEPTION 'Local signing identity, source hash, placement, and artifact keys are immutable';
  END IF;

  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Completed local legal signing operations are immutable';
  END IF;

  IF OLD.status <> 'draft' AND (
       NEW.challenge_hash IS DISTINCT FROM OLD.challenge_hash
    OR NEW.challenge_expires_at IS DISTINCT FROM OLD.challenge_expires_at
    OR NEW.failed_auth_attempts IS DISTINCT FROM OLD.failed_auth_attempts
    OR NEW.auth_locked_until IS DISTINCT FROM OLD.auth_locked_until
    OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
    OR NEW.consent_text IS DISTINCT FROM OLD.consent_text
    OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    OR NEW.reauthenticated_at IS DISTINCT FROM OLD.reauthenticated_at
    OR NEW.evidence_snapshot IS DISTINCT FROM OLD.evidence_snapshot
    OR NEW.evidence_sha256 IS DISTINCT FROM OLD.evidence_sha256
    OR NEW.signature_png_base64 IS DISTINCT FROM OLD.signature_png_base64
    OR NEW.signature_sha256 IS DISTINCT FROM OLD.signature_sha256
  ) THEN
    RAISE EXCEPTION 'Accepted local signing consent, authentication, and evidence are immutable';
  END IF;

  IF OLD.signed_pdf_sha256 IS NOT NULL
     AND NEW.signed_pdf_sha256 IS DISTINCT FROM OLD.signed_pdf_sha256 THEN
    RAISE EXCEPTION 'Stored local signed PDF digest cannot be replaced';
  END IF;
  IF OLD.certificate_sha256 IS NOT NULL
     AND NEW.certificate_sha256 IS DISTINCT FROM OLD.certificate_sha256 THEN
    RAISE EXCEPTION 'Stored local certificate digest cannot be replaced';
  END IF;

  IF NOT (
       NEW.status = OLD.status
    OR (OLD.status = 'draft' AND NEW.status = 'accepted')
    OR (OLD.status = 'accepted' AND NEW.status IN ('signing', 'completed'))
    OR (OLD.status = 'signing' AND NEW.status IN ('accepted', 'completed'))
  ) THEN
    RAISE EXCEPTION 'Invalid local legal signing status transition: % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS local_legal_signing_operations_immutable
  ON local_legal_signing_operations;
CREATE TRIGGER local_legal_signing_operations_immutable
  BEFORE UPDATE OR DELETE ON local_legal_signing_operations
  FOR EACH ROW EXECUTE FUNCTION legal_guard_local_signing_operation_history();

COMMIT;