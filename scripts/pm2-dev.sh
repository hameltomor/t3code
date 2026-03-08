#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/load-project-node.sh"

cd "$XBECODE_PROJECT_DIR"
exec node scripts/dev-runner.ts dev --no-browser
