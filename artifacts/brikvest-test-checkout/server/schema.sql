CREATE TABLE sandbox_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  purpose text NOT NULL CHECK(purpose='brikvest-synthetic-checkout-v1')
);
INSERT INTO sandbox_identity VALUES(true,'brikvest-synthetic-checkout-v1');
CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK(email ~ '^synthetic-[a-f0-9]{32}@example[.]test$'),
  kyc_status text NOT NULL DEFAULT 'approved' CHECK(kyc_status='approved'),
  account_status text NOT NULL DEFAULT 'approved' CHECK(account_status='approved'),
  is_active boolean NOT NULL DEFAULT true CHECK(is_active),
  kyc_full_name text DEFAULT 'Synthetic Checkout Tester'
);
CREATE TABLE sandbox_sessions (
  token_hash text PRIMARY KEY, user_id integer UNIQUE REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_users(id serial PRIMARY KEY, is_active boolean DEFAULT false, role text);
CREATE TABLE properties (
  id serial PRIMARY KEY CHECK(id=1),
  name text NOT NULL CHECK(name='Brikvest Test Plot'),
  location text NOT NULL,
  reserved_units integer NOT NULL DEFAULT 0, sold_units integer NOT NULL DEFAULT 0 CHECK(sold_units=0)
);
INSERT INTO properties(id,name,location)
  VALUES(1,'Brikvest Test Plot','Synthetic location · not a listed property');
CREATE TABLE investment_reservations (
  id serial PRIMARY KEY, property_id integer NOT NULL REFERENCES properties(id) CHECK(property_id=1),
  user_id integer NOT NULL REFERENCES users(id),
  full_name text NOT NULL CHECK(full_name='Synthetic Checkout Tester'),
  email text NOT NULL CHECK(email ~ '^synthetic-[a-f0-9]{32}@example[.]test$'),
  units numeric NOT NULL CHECK(units=1),
  amount numeric(20,2) NOT NULL CHECK(amount=1200.10),
  currency text NOT NULL CHECK(currency='NGN'),
  status text NOT NULL DEFAULT 'reserved' CHECK(status='reserved'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE investment_reservation_inventory (
  reservation_id integer PRIMARY KEY REFERENCES investment_reservations(id),
  property_id integer NOT NULL REFERENCES properties(id),
  reserved_units numeric NOT NULL CHECK(reserved_units=1)
);
CREATE TABLE payment_submissions (
  id serial PRIMARY KEY, reservation_id integer REFERENCES investment_reservations(id), status text
);
