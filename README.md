# JuFo MultiMol OOO-Quiz

Interaktive Präsentations-App für den JuFo-Stand: Vier Moleküle, Jury wählt den Ausreißer, danach Modell-Vorhersage und PEA-Analyse.

## Desktop-App (ThinkPad, empfohlen)

Native PyQt6-Anwendung im Stil trockener Lab-Software: Set-Tabelle, 2×2-Strukturviewer, Ergebnis- und PEA-Panel.

### Installation

```bash
python3 -m venv .venv
.venv/bin/pip install -r desktop/requirements.txt
python3 build.py   # Molekülbilder in gallery/
```

### Start

```bash
./run-desktop.sh
# oder:
.venv/bin/python -m desktop.main
```

**Tastatur:** `1`–`4` Molekül wählen · `Enter` auflösen · `←`/`→` Sets wechseln · `F11` Vollbild

**Kurator:** Sets in der linken Tabelle per ☑ auswählen, Reihenfolge per Drag-and-drop in der Liste darunter. Config über *Datei → Config speichern*.

---

## Web-App (optional, eingefroren)

### Build

```bash
python3 build.py
```

Erzeugt `dist/` und `docs/` mit statischen Dateien, Molekülbildern und JSON-Daten.

### Lokal starten (LAN / iPad / Handy)

```bash
chmod +x serve.sh   # einmalig
./serve.sh
```

`serve.sh` führt **immer zuerst `build.py` aus** (mit `.venv/bin/python3` falls vorhanden), dann den Dev-Server auf Port 8080 mit No-Cache-Headern. Schnellstart ohne Rebuild: `./serve.sh --skip-build`.

URLs (localhost + IPv4/IPv6) werden beim Start ausgegeben — z. B. `http://192.168.x.x:8080` auf dem Tablet im gleichen WLAN.

### GitHub Pages deployen

**Empfohlen:** Dieses Projekt als Git-Repo pushen — **`docs/` ist bereits der fertige Pages-Ordner** (wird von `build.py` befüllt). Kein Extra-Subordner nötig.

| Variante | Bewertung |
|---|---|
| **Git-Repo von hier** | Einfachste Pflege: einmal pushen, Pages aus `/docs` |
| **Zip nur hochladen** | GitHub Pages braucht trotzdem ein Repo; Drag-and-drop für tausende PNGs ist unpraktisch |
| **Neuer Subordner** | Redundant — `docs/` erfüllt genau diesen Zweck |

**Einmalig:**

```bash
python3 build.py
git init
git add .
git commit -m "LatentMol OOO-Quiz"
git remote add origin https://github.com/DEIN-USER/latentmol-quiz.git
git branch -M main
git push -u origin main
```

**Pages aktivieren:** GitHub → Settings → Pages → Branch `main`, Folder **`/docs`**.

URL: `https://DEIN-USER.github.io/latentmol-quiz/` (relative Pfade `./data/` funktionieren unter diesem Unterpfad).

**Updates:** `python3 build.py` → `git add docs/` → commit → push.

**Nicht committen:** `.venv/` (~644 MB). **`docs/` schon** (~16 MB, inkl. Bilder und JSON).

Optional: `latentmol-quiz-pages.zip` enthält nur `docs/` als Backup.

### Kurator-Modus (Web)

Logo 800 ms gedrückt halten oder `?mode=curator` in der URL.
