-- Additive, idempotent persistence for DocuSign investor-signing operations.
-- Keep this separate from ensure-legal-documents.sql so signing deployments do
-- not rewrite or race the legal-document schema owner.
BEGIN;

CREATE TABLE IF NOT EXISTS legal_signing_operations (
  id serial PRIMARY KEY,
  document_id integer NOT NULL UNIQUE
    REFERENCES legal_documents(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  pair_id integer NOT NULL
    REFERENCES legal_document_pairs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  template_id integer NOT NULL
    REFERENCES legal_templates(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  provider text NOT NULL DEFAULT 'docusign' CHECK (provider = 'docusign'),
  transaction_id text NOT NULL UNIQUE
    CHECK (transaction_id ~ '^[A-Za-z0-9._-]{1,100}$'),
  envelope_id text UNIQUE,
  signer_email text NOT NULL,
  signer_name text NOT NULL,
  recipient_id text NOT NULL,
  client_user_id text NOT NULL,
  signature_placement jsonb NOT NULL,
  unsigned_pdf_sha256 text NOT NULL CHECK (unsigned_pdf_sha256 ~ '^[a-f0-9]{64}$'),
  signed_pdf_record_key uuid NOT NULL UNIQUE,
  certificate_record_key uuid NOT NULL UNIQUE,
  certificate_sha256 text CHECK (
    certificate_sha256 IS NULL OR certificate_sha256 ~ '^[a-f0-9]{64}$'
  ),
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'creating', 'ambiguous', 'sent', 'reconciling', 'completed', 'failed')),
  lease_kind text CHECK (lease_kind IN ('create', 'reconcile')),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_signing_operation_lease_consistent CHECK (
    (lease_token IS NULL AND lease_until IS NULL AND lease_kind IS NULL)
    OR
    (lease_token IS NOT NULL AND lease_until IS NOT NULL AND lease_kind IS NOT NULL)
  ),
  CONSTRAINT legal_signing_operation_lease_status CHECK (
    (status = 'creating' AND lease_kind = 'create')
    OR
    (status = 'reconciling' AND lease_kind = 'reconcile')
    OR (status IN ('prepared', 'ambiguous', 'sent', 'completed', 'failed') AND lease_kind IS NULL)
  ),
  CONSTRAINT legal_signing_operation_envelope_consistent CHECK (
    status NOT IN ('sent', 'completed') OR envelope_id IS NOT NULL
  ),
  CONSTRAINT legal_signing_operation_completed_artifacts CHECK (
    status <> 'completed' OR certificate_sha256 IS NOT NULL
  ),
  CONSTRAINT legal_signing_operation_signer_nonempty CHECK (
    length(trim(signer_email)) > 0
    AND length(trim(signer_name)) > 0
    AND length(trim(recipient_id)) > 0
    AND length(trim(client_user_id)) > 0
  )
);

CREATE INDEX IF NOT EXISTS legal_signing_operations_pair_status_idx
  ON legal_signing_operations(pair_id, status, lease_until);
CREATE INDEX IF NOT EXISTS legal_signing_operations_envelope_idx
  ON legal_signing_operations(envelope_id) WHERE envelope_id IS NOT NULL;

-- Only a digest and the minimum routing fields are retained, never a raw
-- webhook payload or HMAC value.
CREATE TABLE IF NOT EXISTS legal_signing_webhook_events (
  event_hash text PRIMARY KEY CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  envelope_id text NOT NULL,
  event_type text NOT NULL,
  operation_id integer
    REFERENCES legal_signing_operations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  pair_id integer
    REFERENCES legal_document_pairs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'processed', 'unmatched')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  leased_until timestamptz,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_signing_webhook_lease_consistent CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND leased_until IS NOT NULL)
    OR
    (status <> 'processing' AND lease_token IS NULL AND leased_until IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS legal_signing_webhook_pending_idx
  ON legal_signing_webhook_events(status, available_at, received_at);
CREATE INDEX IF NOT EXISTS legal_signing_webhook_envelope_idx
  ON legal_signing_webhook_events(envelope_id);

CREATE OR REPLACE FUNCTION legal_guard_signing_operation_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DocuSign signing operations cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY[
        'envelope_id', 'status', 'lease_kind', 'lease_token', 'lease_until',
        'certificate_sha256', 'last_error', 'sent_at', 'completed_at', 'updated_at'
      ]) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
        'envelope_id', 'status', 'lease_kind', 'lease_token', 'lease_until',
        'certificate_sha256', 'last_error', 'sent_at', 'completed_at', 'updated_at'
      ]) THEN
    RAISE EXCEPTION 'DocuSign transaction, investor mapping, and pinned placement are immutable';
  END IF;
  IF OLD.envelope_id IS NOT NULL AND NEW.envelope_id IS DISTINCT FROM OLD.envelope_id THEN
    RAISE EXCEPTION 'A DocuSign envelope mapping cannot be replaced';
  END IF;
  IF OLD.status = 'completed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Completed investor signing operations are immutable';
  END IF;
  IF OLD.certificate_sha256 IS NOT NULL AND
      NEW.certificate_sha256 IS DISTINCT FROM OLD.certificate_sha256 THEN
    RAISE EXCEPTION 'Stored signing certificate digest cannot be replaced';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS legal_signing_operations_immutable ON legal_signing_operations;
CREATE TRIGGER legal_signing_operations_immutable
  BEFORE UPDATE OR DELETE ON legal_signing_operations
  FOR EACH ROW EXECUTE FUNCTION legal_guard_signing_operation_history();

CREATE OR REPLACE FUNCTION legal_guard_signing_webhook_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DocuSign webhook replay records cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY[
        'operation_id', 'pair_id', 'status', 'attempts', 'available_at',
        'lease_token', 'leased_until', 'last_error', 'processed_at', 'updated_at'
      ]) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
        'operation_id', 'pair_id', 'status', 'attempts', 'available_at',
        'lease_token', 'leased_until', 'last_error', 'processed_at', 'updated_at'
      ]) THEN
    RAISE EXCEPTION 'DocuSign webhook replay identity is immutable';
  END IF;
  IF OLD.status = 'processed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Processed DocuSign webhook replay records are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS legal_signing_webhooks_immutable ON legal_signing_webhook_events;
CREATE TRIGGER legal_signing_webhooks_immutable
  BEFORE UPDATE OR DELETE ON legal_signing_webhook_events
  FOR EACH ROW EXECUTE FUNCTION legal_guard_signing_webhook_history();

COMMIT;