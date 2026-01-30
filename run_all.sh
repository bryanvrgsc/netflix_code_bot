#!/bin/bash
cd "$(dirname "$0")"

# Cargar variables de entorno si es necesario
export PATH="/Users/bryanvargas/.nvm/versions/node/v24.12.0/bin:$PATH"

# Iniciar Dashboard en segundo plano
echo "Starting Dashboard..."
node src/dashboard.js > dashboard.log 2>&1 &
DASHBOARD_PID=$!

# Iniciar Bot (proceso principal)
echo "Starting Bot..."
node src/index.js

# Cuando el bot se cierre, matar también el dashboard
kill $DASHBOARD_PID
