#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FONTCONFIG_FILE="${LEGAL_FONTCONFIG_FILE:-$ROOT_DIR/server/legal/fonts/fontconfig.conf}"

if [[ ! -r "$FONTCONFIG_FILE" ]]; then
  echo "Legal font configuration is missing or unreadable." >&2
  exit 1
fi

exec "$@"