#!/bin/bash
cd "$(dirname "$0")"
export PATH="/Users/bryanvargas/.nvm/versions/node/v24.12.0/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
exec node src/index.js
