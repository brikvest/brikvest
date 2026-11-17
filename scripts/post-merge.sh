#!/bin/bash
set -e
npm install
# Controlled schema-only tasks must not replay legacy migrations/backfills
# against the workspace database, which also contains real user data.
# Read the merged config too: the setup process may have inherited its
# environment before the task's environment settings were merged.
config_skip=$(awk '
  /^\[/ { development = ($0 == "[userenv.development]"); next }
  development && /^SKIP_POST_MERGE_DATABASE_MUTATIONS[[:space:]]*=[[:space:]]*"true"[[:space:]]*$/ { skip = 1 }
  END { print skip ? "true" : "false" }
' .replit)
if [ "${SKIP_POST_MERGE_DATABASE_MUTATIONS:-}" = "true" ] || [ "$config_skip" = "true" ]; then
  echo "Schema-only rollout: skipped post-merge database mutations."
  exit 0
fi
npx tsx scripts/backup-referral-program.ts
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/remove-referral-program.sql
npx tsx scripts/ensure-lister-id-column.ts
npx tsx scripts/ensure-property-cost-breakdown-columns.ts
npx tsx scripts/ensure-property-due-diligence-document-columns.ts
npx tsx scripts/ensure-property-listing-details.ts
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ensure-resale-marketplace-offers.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ensure-investment-reservation-inventory-accounting.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ensure-holding-cost-basis.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ensure-legal-documents.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ensure-legal-local-signing.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ensure-legal-notification-cycles.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ensure-legal-property-templates.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ensure-legal-template-deletion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ensure-legal-historical-rollout.sql
# Idempotent: copies developer_id -> lister_id where lister_id is still NULL
npx tsx scripts/backfill-lister-id.ts
