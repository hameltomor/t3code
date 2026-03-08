#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "source scripts/load-project-node.sh instead of executing it" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NODE_VERSION="$(<"$PROJECT_DIR/.nvmrc")"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "NVM is required. Expected to find $NVM_DIR/nvm.sh" >&2
  return 1
fi

# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"

if ! nvm use --silent "$NODE_VERSION" > /dev/null; then
  echo "Node $NODE_VERSION is not installed in NVM. Run: nvm install $NODE_VERSION" >&2
  return 1
fi

export PATH="$PROJECT_DIR/node_modules/.bin:$HOME/.bun/bin:$PATH"
export XBECODE_PROJECT_DIR="$PROJECT_DIR"
