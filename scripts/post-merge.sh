#!/bin/bash
set -e
npm install
npx tsx scripts/backup-referral-program.ts
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/remove-referral-program.sql
npx tsx scripts/ensure-lister-id-column.ts
npx tsx scripts/ensure-property-cost-breakdown-columns.ts
# Idempotent: copies developer_id -> lister_id where lister_id is still NULL
npx tsx scripts/backfill-lister-id.ts
