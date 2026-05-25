# LatentMol — Kurz erklärt

## Was passiert in diesem Quiz?

Vier Moleküle werden gezeigt. **Drei passen chemisch zusammen**, eines ist der **Ausreißer**. Deine Aufgabe: Finde es.

Gemeint ist meist: Drei teilen dieselbe dominante **funktionelle Gruppe** (z. B. Ether, Amin, Alkohol) — charakteristische Atomgruppen, die Aufbau und Reaktionsverhalten prägen. Das vierte weicht ab. Die **Ground Truth** im Quiz folgt dieser Regel (erkannt mit RDKit), nicht bloß „sieht ähnlich aus“.

Nach deiner Wahl erklärt die Auflösung den Ausreißer. Unter **Details** siehst du die Gruppen pro Molekül; **ⓘ Begriffe dieses Sets** erklärt die Fachbegriffe nur für dieses Set.

---

## Was macht das KI-Modell?

**LatentMol** kodiert Moleküle **im Set-Kontext** — nicht isoliert, sondern in Wechselwirkung miteinander. Über **Perspective Ensemble Attention (PEA)** tauschen sie Information aus: *Wie wirkt das Set aus Sicht von Molekül 1, 2, …?* Die PEA-Matrix im Quiz zeigt diese Wechselwirkungen (Mittelwert über fünf Modell-Seeds).

Das Netz wurde **ausschließlich selbstüberwacht** trainiert — auf QM9 (kleine organische Moleküle), mit zwei Aufgaben:

- **Masked Sequence Modelling** — vergleichbar mit Lückentexten: einzelne **Atome** werden maskiert und aus dem Kontext wiederhergestellt
- **Tanimoto-Regression** — das Modell lernt, die **strukturelle Distanz** zwischen Molekülpaaren vorherzusagen (Tanimoto-Ähnlichkeit als Zielgröße)

Danach wurde LatentMol **eingefroren**. Für die OOO-Aufgabe kommt nur noch eine **lineare Probe** obendrauf — eine einfache Schicht, die aus den bereits gelernten Einbettungen ausliest, welches Molekül nicht zur Gruppe passt. Das Netz selbst wurde dafür **nicht** nachtrainiert.

---

## Linear Probing — was der Test zeigt

**Linear Probing** ist ein bewusst einfacher Nachtest: Steckt in den Einbettungen schon **relationales Wissen**, obwohl das Netz nie direkt auf „Ausreißer finden“ optimiert wurde?

Die Antwort ist **ja** — LatentMol liegt in diesem Quiz **deutlich über Zufall** (25 %). Die Repräsentationen tragen bereits Struktur über die Gruppe hinweg; die lineare Probe muss sie nur noch zuordnen.

Manchmal wählen **alle fünf Seeds einheitlich ein anderes Molekül** als die definierte Ground Truth. Das kann eine **Limitation der festen GT-Regel** sein — funktionelle Gruppen erlauben oft mehrere sinnvolle Einordnungen, und das Modell findet dann **chemisch ebenso gültige** Gruppierungen (z. B. Ether statt Amin als Kriterium). Manchmal ist die Modell-Wahl aber auch **einfach falsch** — nicht jede Abweichung ist chemisch haltbar. Im Quiz erklärt **↗ Sicht des Modells**, wann eine alternative Wahl Sinn ergibt.

---

## PEA und kausaler Einfluss auf die Gruppierung

In Experimenten wurde die PEA-Matrix absichtlich verändert. Entscheidend: **Nur die Verstärkung der Spalte der bekannten Ground Truth** verbesserte die OOO-Trefferquote — je stärker die GT-Spalte, desto häufiger wurde das richtige Ausreißer-Molekül gewählt. Wird stattdessen eine **falsche** Spalte verstärkt, fällt die Leistung oft ab. Wird PEA ganz abgeschaltet, sinkt sie ebenfalls. Ein solcher, gezielt steuerbarer Effekt spricht dafür, dass PEA **kausal** an der Gruppierung beteiligt ist — nicht nur zufällig damit korreliert.

---

## Kurz zusammengefasst

| Punkt | Bedeutung |
|---|---|
| **Training** | Selbstüberwacht (Masking + Tanimoto); danach eingefroren |
| **OOO-Test** | Lineare Probe auf gelernten Einbettungen |
| **Ground Truth** | Regelbasiert über funktionelle Gruppen — eine von mehreren möglichen Einordnungen |
| **Seed-Ringe** | Fünf unabhängige Starts; Übereinstimmung zeigt, wie stabil die Modell-Sicht ist |
| **Sicht des Modells** | Erklärt, wann eine alternative Wahl chemisch Sinn ergibt — nicht bei jeder Abweichung |
| **PEA-Manipulation** | GT-Spalte verstärken → bessere OOO-Treffer; falsche Spalte → oft schlechter |

