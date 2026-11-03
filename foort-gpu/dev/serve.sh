#!/bin/sh
# Serve foort-gpu/ locally (no build step). Usage: sh dev/serve.sh [port]
PORT="${1:-8765}"
cd "$(dirname "$0")/.." || exit 1
PY=python3; command -v python3 >/dev/null 2>&1 || PY=python
echo "FOORT-GPU at http://127.0.0.1:$PORT/  (benchmark: http://127.0.0.1:$PORT/bench/)"
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
