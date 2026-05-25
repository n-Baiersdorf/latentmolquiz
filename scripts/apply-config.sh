#!/usr/bin/env bash
# Kuratierte config.json ins Projekt übernehmen und für Pages vorbereiten.
# Usage:
#   ./scripts/apply-config.sh ~/Downloads/config.json
#   ./scripts/apply-config.sh ~/Downloads/config.json --quick   # nur docs/config.json, kein build.py
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?Usage: $0 <pfad/zur/config.json> [--quick]}"

if [[ ! -f "$SRC" ]]; then
  echo "Datei nicht gefunden: $SRC" >&2
  exit 1
fi

python3 - <<'PY' "$SRC"
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
data = json.loads(p.read_text(encoding="utf-8"))
if not isinstance(data.get("sets"), list) or not data["sets"]:
    raise SystemExit("config.json: \"sets\" muss eine nicht-leere Liste sein.")
for i, entry in enumerate(data["sets"]):
    if "strategy" not in entry or "set_idx" not in entry:
        raise SystemExit(f"Set {i}: strategy und set_idx erforderlich.")
print(f"OK — {len(data['sets'])} Sets")
PY

cp "$SRC" "$ROOT/config.json"
echo "→ config.json aktualisiert"

if [[ "${2:-}" == "--quick" ]]; then
  cp "$SRC" "$ROOT/docs/config.json"
  echo "→ docs/config.json aktualisiert (--quick, kein build.py)"
else
  if [[ -x "$ROOT/.venv/bin/python3" ]]; then
    "$ROOT/.venv/bin/python3" "$ROOT/build.py"
  else
    python3 "$ROOT/build.py"
  fi
  echo "→ build.py fertig (dist/ + docs/)"
fi

echo ""
echo "Nächster Schritt: committen & deployen"
echo "  git add config.json docs/config.json"
echo "  git commit -m \"Quiz-Sets aktualisiert\""
echo "  ./scripts/deploy-public-pages.sh …   # oder git push"
