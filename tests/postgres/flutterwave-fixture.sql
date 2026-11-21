-- Synthetic minimal holding/payment schema, installed only by the owned-cluster
-- test runner. Production payment/inventory/cost guard SQL is applied afterward.
CREATE TABLE users (
  id serial PRIMARY KEY, email text, kyc_status text, account_status text,
  is_active boolean, kyc_full_name text, kyc_address text
);
CREATE TABLE admin_users (
  id serial PRIMARY KEY, is_active boolean DEFAULT true, role text DEFAULT 'admin'
);
CREATE TABLE properties (
  id serial PRIMARY KEY, name text, location text,
  total_slots integer DEFAULT 10, available_slots integer DEFAULT 9,
  total_units integer DEFAULT 10, reserved_units integer DEFAULT 1,
  sold_units integer DEFAULT 0, currency text DEFAULT 'NGN',
  unit_land_cost numeric DEFAULT 1000, unit_agent_fees numeric DEFAULT 100,
  unit_due_diligence_cost numeric DEFAULT 50, unit_service_charge numeric DEFAULT 50.10
);
CREATE TABLE investment_reservations (
  id serial PRIMARY KEY, property_id integer REFERENCES properties(id),
  user_id integer REFERENCES users(id), full_name text, email text,
  units numeric(15,2), amount numeric(20,2), currency text,
  status text, funnel_stage text, expires_at timestamptz, cost_basis jsonb,
  payment_method text, payment_reference text, updated_at timestamptz DEFAULT now()
);
CREATE TABLE payment_submissions (
  id serial PRIMARY KEY, reservation_id integer REFERENCES investment_reservations(id),
  user_id integer REFERENCES users(id), amount numeric(20,2), currency text,
  status text DEFAULT 'pending_admin_review', reviewed_at timestamptz,
  reviewed_by_admin_id integer
);
CREATE TABLE ownership_certificates (
  id serial PRIMARY KEY, reservation_id integer UNIQUE,
  certificate_number text UNIQUE, verification_token text UNIQUE,
  owner_name text, property_name text, property_location text, units numeric,
  amount numeric, currency text, issued_by_admin_id integer
);
