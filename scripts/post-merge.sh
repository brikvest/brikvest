#!/bin/bash
set -e
npm install
npm run db:push
# Idempotent: copies developer_id -> lister_id where lister_id is still NULL
npx tsx scripts/backfill-lister-id.ts
