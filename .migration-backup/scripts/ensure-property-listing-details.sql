-- Nullable listing information only. Preserve all existing property and financial data.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS listed_date text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS current_price_per_unit bigint;
