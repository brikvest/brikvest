-- Additive, idempotent legal-document storage schema.
-- This script intentionally never alters or deletes existing application data.
-- Run only through the controlled post-merge migration path.

CREATE TABLE IF NOT EXISTS legal_property_bindings (
  property_id integer PRIMARY KEY REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  document_scope text NOT NULL DEFAULT 'SD118' CHECK (document_scope = 'SD118'),
  enabled boolean NOT NULL DEFAULT true,
  square_meters_per_unit numeric(12,2) NOT NULL CHECK (square_meters_per_unit > 0),
  note text NOT NULL,
  bound_by_admin_id integer NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  bound_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_property_bindings_one_active_scope_uq
  ON legal_property_bindings(document_scope) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS legal_templates (
  id serial PRIMARY KEY,
  document_type text NOT NULL CHECK (document_type IN ('deed_of_assignment', 'transfer_exit_rights')),
  version integer NOT NULL CHECK (version > 0),
  original_filename text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  required_placeholders text[] NOT NULL DEFAULT ARRAY[]::text[],
  validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  is_active boolean NOT NULL DEFAULT false,
  created_by_admin_id integer NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  CONSTRAINT legal_templates_type_version_uq UNIQUE (document_type, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_templates_one_active_per_type_uq
  ON legal_templates(document_type) WHERE is_active;

CREATE TABLE IF NOT EXISTS legal_document_pairs (
  id serial PRIMARY KEY,
  reservation_id integer NOT NULL UNIQUE REFERENCES investment_reservations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  property_id integer NOT NULL REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  payment_submission_id integer REFERENCES payment_submissions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approval_source text NOT NULL
    CHECK (approval_source IN ('payment_submission', 'admin_full_confirmation', 'admin_reinstate')),
  approval_source_id integer NOT NULL,
  approved_by_admin_id integer NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approved_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  approval_note text NOT NULL,
  full_name_snapshot text NOT NULL,
  home_address_snapshot text NOT NULL,
  property_area_sqm numeric(14,2) NOT NULL CHECK (property_area_sqm > 0),
  units_snapshot numeric(15,2) NOT NULL CHECK (units_snapshot > 0),
  square_meters_per_unit numeric(12,2) NOT NULL CHECK (square_meters_per_unit > 0),
  payment_amount_naira numeric(20,2) NOT NULL CHECK (payment_amount_naira > 0),
  payment_currency text NOT NULL CHECK (payment_currency = 'NGN'),
  deed_template_id integer REFERENCES legal_templates(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  transfer_template_id integer REFERENCES legal_templates(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  data_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('awaiting_templates', 'queued', 'generating', 'documents_ready',
                      'signing', 'investor_signed', 'failed')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  documents_ready_at timestamptz,
  investor_signed_at timestamptz,
  CONSTRAINT legal_pair_templates_both_or_neither
    CHECK ((deed_template_id IS NULL) = (transfer_template_id IS NULL)),
  CONSTRAINT legal_pair_approval_source_consistent CHECK (
    (approval_source = 'payment_submission' AND payment_submission_id IS NOT NULL
       AND approval_source_id = payment_submission_id)
    OR
    (approval_source <> 'payment_submission' AND payment_submission_id IS NULL
       AND approval_source_id = reservation_id)
  )
);
CREATE INDEX IF NOT EXISTS legal_document_pairs_user_idx
  ON legal_document_pairs(user_id, created_at);
CREATE INDEX IF NOT EXISTS legal_document_pairs_property_idx
  ON legal_document_pairs(property_id, created_at);

CREATE TABLE IF NOT EXISTS legal_documents (
  id serial PRIMARY KEY,
  pair_id integer NOT NULL REFERENCES legal_document_pairs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN ('deed_of_assignment', 'transfer_exit_rights')),
  template_id integer NOT NULL REFERENCES legal_templates(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status text NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'awaiting_signature', 'signing_in_progress',
                      'investor_signed')),
  source_docx_key text,
  unsigned_pdf_key text,
  unsigned_pdf_sha256 text,
  signature_placement jsonb,
  signing_provider text,
  signing_envelope_id text,
  signed_pdf_key text,
  signed_pdf_sha256 text,
  signing_certificate_key text,
  generated_at timestamptz,
  sent_for_signature_at timestamptz,
  investor_signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_documents_pair_type_uq UNIQUE(pair_id, document_type),
  CONSTRAINT legal_documents_final_metadata CHECK (
    (signed_pdf_key IS NULL AND signed_pdf_sha256 IS NULL AND signing_certificate_key IS NULL)
    OR
    (signed_pdf_key IS NOT NULL AND signed_pdf_sha256 IS NOT NULL AND signing_certificate_key IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS legal_documents_envelope_idx
  ON legal_documents(signing_provider, signing_envelope_id);

CREATE TABLE IF NOT EXISTS legal_jobs (
  id serial PRIMARY KEY,
  pair_id integer NOT NULL REFERENCES legal_document_pairs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('generation', 'notify', 'reconcile')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'retry', 'blocked', 'complete', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  leased_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT legal_jobs_pair_kind_uq UNIQUE(pair_id, kind),
  CONSTRAINT legal_jobs_lease_consistent CHECK (
    (status = 'leased' AND lease_token IS NOT NULL AND leased_until IS NOT NULL)
    OR
    (status <> 'leased' AND lease_token IS NULL AND leased_until IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS legal_jobs_claim_idx ON legal_jobs(status, available_at);

CREATE TABLE IF NOT EXISTS legal_audit_events (
  id serial PRIMARY KEY,
  pair_id integer REFERENCES legal_document_pairs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reservation_id integer REFERENCES investment_reservations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('admin', 'system', 'worker', 'provider')),
  actor_id integer,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_audit_events_pair_idx
  ON legal_audit_events(pair_id, created_at);
CREATE INDEX IF NOT EXISTS legal_audit_events_reservation_idx
  ON legal_audit_events(reservation_id, created_at);

-- A template version's content and provenance can never be rewritten/deleted.
-- Only its active flag and activation timestamp may change.
CREATE OR REPLACE FUNCTION legal_guard_template_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legal template versions are immutable and cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['is_active', 'activated_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['is_active', 'activated_at']) THEN
    RAISE EXCEPTION 'Legal template content and provenance are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS legal_templates_immutable ON legal_templates;
CREATE TRIGGER legal_templates_immutable
  BEFORE UPDATE OR DELETE ON legal_templates
  FOR EACH ROW EXECUTE FUNCTION legal_guard_template_history();

-- Approved values and provenance are frozen. Templates may only be pinned once
-- when an initially blocked approval is explicitly resumed by an administrator.
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
  IF OLD.deed_template_id IS NOT NULL AND (
      NEW.deed_template_id IS DISTINCT FROM OLD.deed_template_id OR
      NEW.transfer_template_id IS DISTINCT FROM OLD.transfer_template_id
  ) THEN
    RAISE EXCEPTION 'Pinned legal template versions cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS legal_document_pairs_immutable ON legal_document_pairs;
CREATE TRIGGER legal_document_pairs_immutable
  BEFORE UPDATE OR DELETE ON legal_document_pairs
  FOR EACH ROW EXECUTE FUNCTION legal_guard_pair_history();

-- Final artifacts are write-once; legal documents cannot be deleted.
CREATE OR REPLACE FUNCTION legal_guard_document_artifacts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legal document history cannot be deleted';
  END IF;
  IF (OLD.signed_pdf_key IS NOT NULL AND (
        NEW.signed_pdf_key IS DISTINCT FROM OLD.signed_pdf_key OR
        NEW.signed_pdf_sha256 IS DISTINCT FROM OLD.signed_pdf_sha256 OR
        NEW.signing_certificate_key IS DISTINCT FROM OLD.signing_certificate_key
      )) THEN
    RAISE EXCEPTION 'Investor-signed legal artifacts are immutable';
  END IF;
  IF OLD.source_docx_key IS NOT NULL AND
      NEW.source_docx_key IS DISTINCT FROM OLD.source_docx_key THEN
    RAISE EXCEPTION 'Generated legal DOCX files are write-once';
  END IF;
  IF OLD.unsigned_pdf_key IS NOT NULL AND (
      NEW.unsigned_pdf_key IS DISTINCT FROM OLD.unsigned_pdf_key OR
      NEW.unsigned_pdf_sha256 IS DISTINCT FROM OLD.unsigned_pdf_sha256 OR
      NEW.source_docx_key IS DISTINCT FROM OLD.source_docx_key
  ) THEN
    RAISE EXCEPTION 'Generated legal artifacts are write-once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS legal_documents_immutable_artifacts ON legal_documents;
CREATE TRIGGER legal_documents_immutable_artifacts
  BEFORE UPDATE OR DELETE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION legal_guard_document_artifacts();

-- Audit records are append-only, including against direct SQL updates.
CREATE OR REPLACE FUNCTION legal_guard_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Legal audit events are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS legal_audit_events_append_only ON legal_audit_events;
CREATE TRIGGER legal_audit_events_append_only
  BEFORE UPDATE OR DELETE ON legal_audit_events
  FOR EACH ROW EXECUTE FUNCTION legal_guard_audit_append_only();