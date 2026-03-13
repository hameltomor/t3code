#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use v24.14.0
cd /home/danil.morozov/Workspace/t3code
exec bun run dev
