-- Explicitly authorized rollout only. Never run at startup or via schema push.
BEGIN;
CREATE TABLE IF NOT EXISTS flutterwave_attempts (
  id serial PRIMARY KEY,
  reservation_id integer NOT NULL REFERENCES investment_reservations(id),
  user_id integer NOT NULL REFERENCES users(id),
  tx_ref text NOT NULL UNIQUE,
  expected_amount numeric(20,2) NOT NULL CHECK (expected_amount > 0),
  expected_currency text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('test','live')),
  state text NOT NULL DEFAULT 'initiated',
  checkout_url text,
  checkout_expires_at timestamptz NOT NULL,
  reason text,
  verified_amount numeric(20,2),
  verified_currency text,
  verified_at timestamptz,
  provider_transaction_id text UNIQUE,
  reviewed_by_admin_id integer REFERENCES admin_users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS flutterwave_one_open_attempt
  ON flutterwave_attempts(reservation_id)
  WHERE state IN ('initiated','verification_pending');
CREATE TABLE IF NOT EXISTS flutterwave_charges (
  transaction_id text PRIMARY KEY,
  attempt_id integer REFERENCES flutterwave_attempts(id),
  tx_ref text NOT NULL,
  amount text,
  currency text,
  provider_status text NOT NULL,
  disposition text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flutterwave_verification_jobs (
  transaction_id text PRIMARY KEY,
  tx_ref text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flutterwave_audit (
  id serial PRIMARY KEY,
  attempt_id integer NOT NULL REFERENCES flutterwave_attempts(id),
  admin_id integer REFERENCES admin_users(id),
  event text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flutterwave_confirmation_jobs (
  reservation_id integer PRIMARY KEY REFERENCES investment_reservations(id),
  state text NOT NULL DEFAULT 'queued',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flutterwave_checkout_closures (
  attempt_id integer PRIMARY KEY REFERENCES flutterwave_attempts(id),
  checkout_url text,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION protect_flutterwave_expected() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.reservation_id,NEW.user_id,NEW.tx_ref,NEW.expected_amount,NEW.expected_currency,NEW.mode)
     IS DISTINCT FROM ROW(OLD.reservation_id,OLD.user_id,OLD.tx_ref,OLD.expected_amount,OLD.expected_currency,OLD.mode) THEN
    RAISE EXCEPTION 'Flutterwave checkout expectations are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS flutterwave_expected_immutable ON flutterwave_attempts;
CREATE TRIGGER flutterwave_expected_immutable BEFORE UPDATE ON flutterwave_attempts
  FOR EACH ROW EXECUTE FUNCTION protect_flutterwave_expected();
COMMIT;
