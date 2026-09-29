-- Additive, idempotent schema for negotiated marketplace sales.
-- This intentionally does not rewrite or delete existing marketplace data.

ALTER TABLE resale_listings
  ADD COLUMN IF NOT EXISTS payment_reference text;

ALTER TABLE resale_payments
  ADD COLUMN IF NOT EXISTS transaction_fee numeric(20, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_payment numeric(20, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS resale_marketplace_offers (
  id serial PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  seller_reservation_id integer NOT NULL REFERENCES investment_reservations(id),
  property_id integer NOT NULL REFERENCES properties(id),
  seller_id integer NOT NULL REFERENCES users(id),
  buyer_id integer NOT NULL REFERENCES users(id),
  units numeric(15, 2) NOT NULL,
  purchase_price numeric(20, 2) NOT NULL,
  transaction_fee numeric(20, 2) NOT NULL,
  total_payment numeric(20, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'awaiting_seller_response',
  payment_deadline timestamp,
  bank_reference text,
  proof_url text,
  proof_type text,
  payment_submitted_at timestamp,
  rejection_reason text,
  payment_reviewed_by_admin_id integer REFERENCES admin_users(id),
  payment_reviewed_at timestamp,
  transfer_completed_by_admin_id integer REFERENCES admin_users(id),
  transfer_completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_resale_offer_seller"
  ON resale_marketplace_offers (seller_id, status);
CREATE INDEX IF NOT EXISTS "IDX_resale_offer_buyer"
  ON resale_marketplace_offers (buyer_id, status);
CREATE INDEX IF NOT EXISTS "IDX_resale_offer_reservation"
  ON resale_marketplace_offers (seller_reservation_id, status);
CREATE INDEX IF NOT EXISTS "IDX_resale_offer_deadline"
  ON resale_marketplace_offers (status, payment_deadline);

CREATE TABLE IF NOT EXISTS resale_marketplace_offer_events (
  id serial PRIMARY KEY,
  offer_id integer NOT NULL REFERENCES resale_marketplace_offers(id) ON DELETE CASCADE,
  actor_type text NOT NULL,
  actor_id integer,
  action text NOT NULL,
  units numeric(15, 2),
  purchase_price numeric(20, 2),
  transaction_fee numeric(20, 2),
  total_payment numeric(20, 2),
  details text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_resale_offer_event_offer"
  ON resale_marketplace_offer_events (offer_id, created_at);

CREATE TABLE IF NOT EXISTS resale_marketplace_notifications (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id integer NOT NULL REFERENCES resale_marketplace_offers(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_resale_marketplace_notification_user"
  ON resale_marketplace_notifications (user_id, read_at, created_at);