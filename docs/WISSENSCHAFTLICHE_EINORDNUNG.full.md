# LatentMol — Set-basiertes Repräsentationslernen

**Projekt:** LatentMol mit LatentMolBERT-Encoding und MultiMol (Perspective Ensemble Attention, PEA) auf QM9  
**Quiz-Evaluationsstrategie:** `scaffold_similar` (100 visualisierte 4er-Sets, 5 Modell-Seeds)

---

## Im Quiz — was bedeutet das?

**Funktionelle Gruppen** sind charakteristische Atomgruppen in einem Molekül — zum Beispiel Alkohol (−OH), Ether, Amin oder Carbonyl. Sie bestimmen maßgeblich, wie ein Molekül aufgebaut ist und wie es reagiert.

Vier Moleküle sehen oft ähnlich aus, aber **drei gehören chemisch zusammen**, weil sie dieselbe dominante funktionelle Gruppe tragen. Das **vierte ist der Ausreißer**. Die **Ground Truth** für Odd-One-Out (OOO) kommt aus dieser funktionellen Einordnung — nicht aus Tanimoto-Ähnlichkeit allein.

Nach deiner Wahl zeigt die Auflösung **warum** der Ausreißer abweicht. Unter **Details** findest du die Gruppen pro Molekül; **ⓘ Begriffe dieses Sets** erklärt die Begriffe nur für dieses Set. Die **PEA-Matrix** (Perspective Ensemble Attention) zeigt, wie das Modell die vier Moleküle untereinander „vermischt“.

---

## 1. Forschungsfrage

Maschinelles Lernen betrachtet Moleküle meist isoliert. In der realen Chemie wirken sie jedoch in **Gruppen** — Reaktionsgemische, Lösungen, Wirkstoffkombinationen.

> *Verbessert relationales Lernen über Molekülsets die Qualität molekularer Repräsentationen?*

Die Arbeit folgt einer klaren Hierarchie:

- **StructureMol** — kompaktes, interpretierbares Atom-Encoding (27D statt 44D One-Hot)
- **LatentMol / MultiMol + PEA** — MultiMol ist der Set-Encoder innerhalb von LatentMol; PEA tauscht Information zwischen Molekülen aus
- **OOO, Property-MAE, Gap-Kompatibilität** — Evaluationsrahmen für relationale vs. lokale Repräsentationsqualität

**Kernaussage:** Relationales Set-Lernen verbessert relationale Aufgaben deutlich, kann die reine Einzelmolekül-Genauigkeit je nach Konfiguration leicht verschieben — ein reproduzierbarer **Tradeoff**.

---

## 2. Architektur: LatentMol & PEA

LatentMol kodiert jedes Molekül in einem parallelen Transformer-Strom (MultiMol). **Perspective Ensemble Attention (PEA)** tauscht Information **zwischen** den Molekülen aus — in drei Schritten:

1. **Summarize** — jedes Molekül wird zu einem Vektor gepoolt  
2. **Interact** — Attention zwischen den Molekülen (Relationsmatrix α)  
3. **Perspectives** — gewichtete Mischung: „Wie sieht das Set aus aus Sicht von Molekül *i*?“

Die Diagonale der Matrix bleibt auf 1 — jedes Molekül behält seine Identität, nimmt aber Kontext von den anderen auf.

![Gesamtarchitektur LatentMol|compact](info-figures/architecture.png)

![PEA-Konzept: Summarize → Interact → Perspectives|compact](info-figures/pea_concept.png)

**Im Quiz:** Jede Zelle der PEA-Matrix ist der Mittelwert über 5 Modell-Seeds. Zeile = Ziel-Molekül, Spalte = Quellen-Molekül. Rahmen markiert den Ausreißer (definierte Ground Truth).

---

## 3. Odd-One-Out — die Quiz-Aufgabe

OOO ist eine **relationale Probe**: Das Modell muss erkennen, welches von vier Molekülen nicht zur Gruppe passt — nicht nur Einzeleigenschaften vorhersagen.

| Aspekt | Details |
|---|---|
| **Set-Größe** | 4 Moleküle (k = 4) |
| **Ground Truth** | Funktionelle Gruppen via RDKit — 3 teilen die Mehrheitsgruppe, 1 weicht ab |
| **Zufallsbaseline** | 25 % (1 von 4) |
| **Modell-Output** | 5 Seeds mit gleicher Architektur, verschiedenen Initialisierungen |

**Leistung (StructureMol, Baseline):** OOO-Accuracy **44,2 %** — deutlich über Zufall. In ~30 % der Viz-Sets wählen alle fünf Seeds dasselbe Molekül, aber nicht die definierte Ground Truth. Oft ist diese Wahl **chemisch nachvollziehbar** — eine alternative, ebenso verteidigbare Ausreißer-Definition, keine reine Modellschwäche.

![OOO-Ergebnisse über Set-Strategien und Encodings|compact](info-figures/probe_ooo.png)

---

## 4. Kernergebnisse — Encoding & Ablationen

### StructureMol vs. One-Hot (Set-Kontext)

| Encoding | Property MAE ↓ | OOO Acc ↑ |
|---|---|---|
| StructureMol | 19,12 ± 0,77 | **0,442 ± 0,038** |
| OneHot | 22,08 ± 0,87 | 0,392 ± 0,135 |

StructureMol ist kompakter und erreicht bessere relationale Leistung bei niedrigerem MAE.

### PEA-Ablationen (StructureMol)

| Konfiguration | MAE | OOO Acc | Interpretation |
|---|---|---|---|
| Baseline | 19,12 | **0,442** | Referenz |
| no_pea_init | 25,24 (+32 %) | **0,253** | OOO kollabiert nahe Zufall |
| no_residual_pea | 18,66 | 0,342 | MAE leicht besser, OOO schlechter |
| no_posenc | 19,75 | 0,425 | Positions-Encoding wenig relevant |

**PEA-Initialisierung ist kritisch:** Ohne gelernte Relationsmatrix bricht das Set-Verständnis zusammen. Residual-PEA steuert den **lokal-vs-globalen Tradeoff**.

![Relative Veränderung durch Ablationen](info-figures/ablation_impact.png)

### LatentMol (MultiMol) vs. Deep Sets

Deep Sets kodiert Moleküle unabhängig und aggregiert erst danach. LatentMol gewinnt bei StructureMol **OOO in allen 20 gepaarten Vergleichen** (+290 % zufallsbereinigte OOO-Skill), bei nur ~2 % MAE-Nachteil.

---

## 5. Tradeoff: lokale Präzision vs. relationales Verständnis

Architekturentscheidungen verschieben den Embedding-Raum systematisch:

- **scaffold_diverse** — niedrigster MAE, niedrigste OOO  
- **scaffold_similar** — höchste OOO (0,486), höchster MAE — **diese Strategie nutzt das Quiz**

Set-Größe k = 8 ist der MAE-Sweet-Spot; OOO-Lift steigt mit k, ist aber encoding-abhängig.

![Skalierung mit Set-Größe k](info-figures/scaling_analysis.png)

---

## 6. PEA ↔ OOO — Korrelation & Kausalität

Auf n = 100 `scaffold_similar`-Sets korreliert PEA-Struktur signifikant mit OOO-Erfolg:

| PEA-Merkmal | r | Richtung |
|---|---|---|
| GT-Spaltenstärke | **+0,53** | stärkere GT-Quelle → bessere OOO |
| GT-Isolation | **−0,61** | isolierteres GT → schlechtere OOO |
| Tanimoto ↔ OOO | +0,35 | moderat, deckt nur 58 % der FG-GT |

**Kausalität (Interventions-Experiment):** Gezielte PEA-Manipulation verschiebt OOO-Vorhersagen monoton:

| Bedingung | OOO-Accuracy | Δ vs. Natural |
|---|---|---|
| natural | 47,0 % | — |
| identity (PEA ab) | 35,0 % | **−12 pp** |
| boost_gt (GT-Spalte ×1,5) | 66,0 % | **+19 pp** |
| boost ×2,0 | 90,0 % | +43 pp |

Ablation senkt Leistung signifikant; Boost der GT-Spalte korrigiert 19 von 53 natürlich falschen Sets — **ohne** Regression bei zuvor korrekten Fällen. Der Boost erfordert jedoch Oracle-Kenntnis der Ausreißer-Spalte.

**PEA ↔ Property-MAE:** Praktisch keine Korrelation (r ≈ 0) — OOO und Eigenschaftsvorhersage nutzen die Repräsentation unterschiedlich.

---

## 7. Limitationen

| Limitation | Details |
|---|---|
| **Datensatz** | QM9 — kleine organische Moleküle; Generalisierung offen |
| **Lineare Probes** | Untere Schranke; nonlinear könnte anders aussehen |
| **Oracle-Boost** | +19 pp durch GT-Spalten-Boost nicht ohne GT-Kenntnis nutzbar |
| **Ground-Truth-Mehrdeutigkeit** | ~30 % der Sets: alle Seeds einig auf ein anderes Molekül als die definierte Ground Truth — oft chemisch plausibel |
| **Strategie-Umfang** | Hauptbefunde auf `scaffold_similar`, n = 100 |

---

*Zusammenfassung der JuFo-Arbeit „Set-basiertes Repräsentationslernen für molekulare Systeme“ (LatentMol).*
