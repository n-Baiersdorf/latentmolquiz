# Web-App Anforderungen: MultiMol OOO-Quiz

Kurze Spezifikation für eine interaktive Präsentations-App (Jufo-Stand).

---

## Ziel

Die Jury sieht vier Moleküle und klickt auf den vermeintlichen Ausreißer —
danach wird die Modell-Vorhersage aufgedeckt. Die Reihenfolge der Sets ist
**fest kuratorisch** (kein Random), sodass der Präsentator die Narrative steuert.

---

## Datenquelle

Alle Daten liegen als JSON-Dateien vor:

```
jufo_cards/inference_{strategy}_set{i}.json
```

**Relevante Felder pro Set:**

```json
{
  "set_idx": 5,
  "strategy": "random",
  "ground_truth_ooo_idx": 2,
  "molecules": [
    {
      "smiles": "CC1CC1",
      "iupac": "methylcyclopropane",
      "properties_display": {
        "homo": {"value": -6.12, "unit": "eV"},
        "gap":  {"value":  7.85, "unit": "eV"},
        "mu":   {"value":  0.02, "unit": "D"}
      }
    }
    // × 4
  ],
  "per_seed": {
    "42":  {"ooo_pred_idx": 2, "pea_matrix": [[1.0, 0.82, ...], ...]},
    "123": {"ooo_pred_idx": 2, "pea_matrix": [[1.0, 0.80, ...], ...]},
    "456": {"ooo_pred_idx": 1, "pea_matrix": [[1.0, 0.83, ...], ...]},
    "789": {"ooo_pred_idx": 2, "pea_matrix": [[1.0, 0.79, ...], ...]},
    "2024":{"ooo_pred_idx": 2, "pea_matrix": [[1.0, 0.81, ...], ...]}
  },
  "aggregated": {
    "ooo_accuracy_mean": 0.8,
    "ooo_accuracy_std":  0.4
  },
  "pea_matrix_mean": [[1.0, 0.81, 0.79, 0.03], ...],  // 4×4, Mittel über 5 Seeds
  "pea_matrix_std":  [[0.0, 0.02, 0.01, 0.005], ...]  // 4×4, Std über 5 Seeds
}
```

2D-Strukturbilder: aus SMILES on-the-fly per RDKit (Python-Backend)
oder als vorgerenderte PNGs (bereits vorhanden: `jufo_cards/gallery/`).

---

## Funktionsweise (5 Screens)

### Screen 1 — Frage
- 4 Moleküle nebeneinander (groß, klickbar)
- Fragetext: *"Welches Molekül passt nicht dazu?"*
- Keine Lösung sichtbar
- Optional: 1–2 Eigenschaften unter jedem Molekül (HOMO, gap)

### Screen 2 — Auflösung (nach Klick)
- Ausgewähltes Molekül: blauer Rahmen (Jury-Antwort)
- Richtiges Molekül: grüner Rahmen + „★ Ausreißer"
- Modell-Vorhersage: grüne/rote Ringe (1 Ring pro Seed = n/5-Badge)
- Kurze Stat: „4/5 Seeds korrekt"
- **PEA-Heatmap** (4×4): unterhalb der Moleküle; zeigt die QMMR-Relationsmatrix
  - Daten kommen aus `pea_matrix_mean` im JSON (4×4 floats, Diagonale = 1)
  - Colormap: niedrig (rot) = unähnlich, hoch (grün) = ähnlich
  - Interaktion: Hover über Molekül `#i` → Zeile `i` und Spalte `i` der Matrix blinken auf (CSS highlight)
  - GT-OOO-Zeile/-Spalte dauerhaft grün umrandet
  - Falsch vorhergesagte Spalten gestrichelt rot umrandet
  - Legende: „niedrig = unähnlich | Diagonale = 1 (grau, immer)"
  - Tooltip auf Zelle `[i,j]`: „Mol #j trägt {val:.2f} zu Mol #i bei"

### Screen 3 — Navigation
- Weiter-Taste → nächstes Set
- Fortschrittsbalken: Set X / N
- Optional: Zurück-Taste

### Konfiguration (curator-only, nicht für Jury sichtbar)
```json
{
  "sets": [
    {"strategy": "random", "set_idx": 88},
    {"strategy": "random", "set_idx": 22},
    {"strategy": "scaffold_similar", "set_idx": 5}
  ],
  "show_properties": true,
  "show_iupac": true
}
```

---

## Technischer Stack

| Option | Aufwand | Vorteil |
|---|---|---|
| **Vanilla HTML + JS (empfohlen)** | 2–3h | Kein Server nötig, eine .html-Datei |
| React + Vite | 4–6h | Komponenten, einfacher zu erweitern |
| Streamlit (Python) | 1–2h | RDKit direkt, aber langsamer |

**Empfehlung**: Vanilla HTML/JS, Molekülbilder als eingebettete Base64-PNGs
(vorgerendert aus `jufo_cards/gallery/`). Läuft offline auf jedem Gerät.

---

## PEA-Matrix Semantik (für Entwickler)

Die Matrix `pea_matrix_mean[i][j]` beschreibt, wie stark Molekül `j` zur
Repräsentation von Molekül `i` im Modell beiträgt:

- Diagonal (`i == j`): immer 1.0 (Selbstbeitrag, uninformativ → grau darstellen)
- Off-diagonal: sigmoid-transformierter Q·K-Score; niedrig (nahe 0) = unähnlich
- Der GT-Ausreißer hat typischerweise die niedrigsten Spaltenwerte
  (andere Moleküle „verwenden" ihn wenig)
- **Nicht symmetrisch**: `pea[i][j] ≠ pea[j][i]` im Allgemeinen

Empfohlene Darstellung: `vmin`/`vmax` aus Off-Diagonal-Werten dieses Sets
(nicht global), damit lokale Unterschiede sichtbar werden.

---

## Nicht-Ziele (explizit ausgeschlossen)

- Kein zufälliger Modus (feste Reihenfolge)
- Keine Benutzerverwaltung / Datenbank
- Keine Echtzeit-Inference (nur vorberechnete JSONs)
- Kein Deployment (lokale Nutzung am Stand)

---

## Offene Fragen vor Implementierung

1. Welche Sets sollen angezeigt werden (Indizes)?
2. Sollen Eigenschaften (HOMO/gap) auf der Frageseite sichtbar sein?
3. Soll die Jury-Antwort getrackt werden (Score-Anzeige am Ende)?
4. Bildschirmgröße am Stand (Laptop, Tablet, großer Monitor)?
