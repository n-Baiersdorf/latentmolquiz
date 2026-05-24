# LatentMol — Odd-One-Out-Quiz

Interaktive Web-App: Vier Moleküle, du findest den Ausreißer — danach Modell-Vorhersage, funktionelle Gruppen und PEA-Matrix.

## Lokal entwickeln

```bash
python3 -m venv .venv
.venv/bin/pip install rdkit-pypi pillow   # optional, für echte Strukturbilder
python3 build.py                          # dist/ + docs/
chmod +x serve.sh
./serve.sh                                # http://localhost:8080 (dist/, mit Kurator)
```

**Kurator (nur lokal in `dist/`):** Titel „Odd-One-Out-Quiz“ 800 ms gedrückt halten, oder `?mode=curator`. Set-Auswahl und `config.json` exportieren. In `docs/` (GitHub Pages) ist der Kurator absichtlich deaktiviert.

---

## GitHub Pages — privates Repo, öffentliche Website

Auf dem **kostenlosen GitHub-Plan** geht Pages **nur aus öffentlichen Repos**. Empfohlenes Setup:

| Repo | Sichtbarkeit | Inhalt |
|---|---|---|
| **latentmol-dev** (dieses Projekt) | **Privat** | Quellcode, `build.py`, `Daten/inference_*.json`, `src/` |
| **latentmol-quiz** (Pages) | **Öffentlich** | Nur der statische Inhalt aus `docs/` — kein Kurator, kein Quellcode |

### Einmalig

1. **Privates Repo** für dieses Projekt anlegen und pushen.
2. **Leeres öffentliches Repo** `latentmol-quiz` anlegen.
3. Deploy-Skript:

```bash
chmod +x scripts/deploy-public-pages.sh
./scripts/deploy-public-pages.sh git@github.com:DEIN-USER/latentmol-quiz.git
```

4. Im **öffentlichen** Repo: Settings → Pages → Branch **`main`**, Folder **`/ (root)`**.

→ `https://DEIN-USER.github.io/latentmol-quiz/`

### Updates

```bash
python3 build.py
git add -A && git commit -m "…" && git push          # privates Dev-Repo
./scripts/deploy-public-pages.sh git@github.com:…     # öffentliche Website
```

---

## Was ins Git-Repo gehört (~20 MB)

- `src/`, `docs/`, `build.py`, `config.json`, `scripts/`, `serve.sh`, `README.md`, `WISSENSCHAFTLICHE_EINORDNUNG.md`
- `Daten/inference_*.json` (für Rebuilds)

**Nicht committen** (steht in `.gitignore`): `.venv/`, `cards/`, `catalog_assets/`, `desktop/`, Embeddings (`.npy`), PDFs/LaTeX, `gallery/`-Cache.

---

*Desktop-App, Druck-Kataloge und Karten liegen nur lokal — nicht Teil dieses Repos.*
