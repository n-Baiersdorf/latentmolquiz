#!/usr/bin/env bash
# LAN-Dev-Server: baut dist/ neu und serviert mit No-Cache-Headern
set -euo pipefail
cd "$(dirname "$0")"

SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build|-s) SKIP_BUILD=1 ;;
    --help|-h)
      echo "Usage: ./serve.sh [--skip-build]"
      echo "  Standard: build.py ausführen, dann dist/ auf Port 8080 (0.0.0.0)"
      echo "  --skip-build: vorhandenes dist/ ohne Rebuild servieren"
      exit 0
      ;;
  esac
done

if [[ -x .venv/bin/python3 ]]; then
  PYTHON=".venv/bin/python3"
else
  PYTHON="python3"
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "Baue dist/ …"
  "$PYTHON" build.py
else
  if [[ ! -f dist/index.html ]]; then
    echo "dist/ fehlt — starte build.py …"
    "$PYTHON" build.py
  fi
fi

PORT=8080

echo ""
echo "MultiMol OOO-Quiz — LAN-Server"
echo "================================"
echo "  http://localhost:${PORT}"

print_ips() {
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' || true
  fi
  if command -v ip >/dev/null 2>&1; then
    ip -4 addr show scope global 2>/dev/null \
      | awk '/inet / {print $2}' | cut -d/ -f1 || true
  fi
}

while read -r ip; do
  [[ -z "$ip" ]] && continue
  if [[ "$ip" == *:* ]]; then
    echo "  http://[${ip}]:${PORT}"
  else
    echo "  http://${ip}:${PORT}"
  fi
done < <(print_ips | sort -u)

echo ""
echo "Hinweis: Hard-Refresh (Strg+Shift+R) falls noch alte Version angezeigt wird."
echo "Strg+C zum Beenden."
echo ""

exec "$PYTHON" scripts/dev_server.py --port "$PORT" --bind 0.0.0.0 --directory dist
