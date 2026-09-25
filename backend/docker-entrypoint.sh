#!/bin/sh
set -eu
echo "Aplicando esquema MySQL..."
node dist/scripts/init-db.js
exec node dist/server.js
