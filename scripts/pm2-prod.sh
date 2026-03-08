#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/load-project-node.sh"

export NODE_ENV="${NODE_ENV:-production}"
export XBECODE_PORT="${XBECODE_PORT:-3775}"
export XBECODE_STATE_DIR="${XBECODE_STATE_DIR:-$HOME/.xbe/prod}"
export XBECODE_NO_BROWSER="${XBECODE_NO_BROWSER:-1}"

cd "$XBECODE_PROJECT_DIR"
exec node apps/server/dist/index.mjs
