#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Ensure Node 24 is active for the build and native addon compatibility
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24 --silent

echo "==> Rebuilding native addons for Node $(node --version)..."
npx --yes node-gyp rebuild \
  --directory=node_modules/.bun/node-pty@*/node_modules/node-pty 2>/dev/null || true

echo "==> Building project..."
bun run build

echo "==> Restarting PM2 process..."
if pm2 describe xbecode-prod > /dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs
else
  pm2 start ecosystem.config.cjs
fi

pm2 save

echo "==> Done. xbecode-prod running on port 3775"
pm2 status xbecode-prod
