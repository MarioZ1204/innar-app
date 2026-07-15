#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js no está disponible en este entorno" >&2
  exit 1
fi
node scripts/recuperar-rutas-soportes-historicas.js
