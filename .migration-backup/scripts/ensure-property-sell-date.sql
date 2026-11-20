-- Additive, nullable, display-only calendar date. No backfill or default.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS sell_date date;
