#!/bin/bash
set -e
pnpm install --frozen-lockfile
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
# The structural port never authorizes migrations, even if the saved flag is
# absent. Legacy rollout steps are retained in post-merge-legacy.sh for review.
echo "Brikvest structural port: skipped database mutations and application startup."
