BEGIN;

DROP TABLE IF EXISTS referral_rewards;
DROP TABLE IF EXISTS referrals;

ALTER TABLE users
  DROP COLUMN IF EXISTS referral_code,
  DROP COLUMN IF EXISTS referred_by_user_id;

ALTER TABLE investment_reservations
  DROP COLUMN IF EXISTS referral_code;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('referrals', 'referral_rewards')
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (
        (table_name = 'users' AND column_name IN ('referral_code', 'referred_by_user_id'))
        OR (table_name = 'investment_reservations' AND column_name = 'referral_code')
      )
  ) THEN
    RAISE EXCEPTION 'Referral schema cleanup verification failed';
  END IF;
END
$$;

COMMIT;