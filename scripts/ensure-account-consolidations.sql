-- Additive only. Apply explicitly after merge; never run against live data as a test.
CREATE TABLE IF NOT EXISTS account_consolidations (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  admin_id integer NOT NULL REFERENCES admin_users(id),
  source_id integer NOT NULL REFERENCES users(id),
  destination_id integer NOT NULL REFERENCES users(id),
  request_hash text NOT NULL,
  verification_note text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_id <> destination_id),
  UNIQUE(source_id)
);
CREATE OR REPLACE FUNCTION protect_account_consolidation_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Account consolidation audit is immutable';
END;
$$;
DROP TRIGGER IF EXISTS account_consolidation_audit_immutable ON account_consolidations;
CREATE TRIGGER account_consolidation_audit_immutable
BEFORE UPDATE OR DELETE ON account_consolidations
FOR EACH ROW EXECUTE FUNCTION protect_account_consolidation_audit();
