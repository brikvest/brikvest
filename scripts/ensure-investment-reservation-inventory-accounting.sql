-- Optional side ledger for exact, per-reservation reserved_units provenance.
-- Existing reservations are intentionally not backfilled: attribution cannot
-- be proven from aggregate property counters alone.
CREATE TABLE IF NOT EXISTS investment_reservation_inventory (
  reservation_id integer PRIMARY KEY
    REFERENCES investment_reservations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  property_id integer NOT NULL
    REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reserved_units numeric(15,2) NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  release_pending boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);