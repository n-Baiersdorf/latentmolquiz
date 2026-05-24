#!/usr/bin/env bash
# Baut docs/ und pusht nur den statischen Pages-Inhalt in ein öffentliches Repo.
# Usage: ./scripts/deploy-public-pages.sh git@github.com:USER/latentmol-quiz.git
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_REPO="${1:?Usage: $0 <public-repo-git-url>}"

if [[ -x "$ROOT/.venv/bin/python3" ]]; then
  PYTHON="$ROOT/.venv/bin/python3"
else
  PYTHON="python3"
fi

echo "Baue docs/ (ohne Kurator) …"
"$PYTHON" "$ROOT/build.py"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rsync -a --delete "$ROOT/docs/" "$TMP/"

cd "$TMP"
if [[ ! -d .git ]]; then
  git init
  git branch -M main
fi
git add -A
if git diff --cached --quiet; then
  echo "Keine Änderungen in docs/."
else
  git commit -m "Deploy Pages $(date -Iseconds)"
fi
git remote remove origin 2>/dev/null || true
git remote add origin "$PUBLIC_REPO"
git push -f origin main

echo ""
echo "Fertig. GitHub → Settings → Pages → Branch main, Folder / (root)"
echo "URL: https://USER.github.io/REPO-NAME/"
