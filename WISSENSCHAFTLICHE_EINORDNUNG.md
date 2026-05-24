# LatentMol — Kurz erklärt

## Was passiert in diesem Quiz?

Vier Moleküle werden gezeigt. **Drei passen chemisch zusammen**, eines ist der **Ausreißer**. Deine Aufgabe: Finde es.

Gemeint ist meist: Drei teilen dieselbe dominante **funktionelle Gruppe** (z. B. Ether, Amin, Alkohol) — charakteristische Atomgruppen, die Aufbau und Reaktionsverhalten prägen. Das vierte weicht ab. Die **Ground Truth** im Quiz folgt dieser Regel (erkannt mit RDKit), nicht bloß „sieht ähnlich aus“.

Nach deiner Wahl erklärt die Auflösung den Ausreißer. Unter **Details** siehst du die Gruppen pro Molekül; **ⓘ Begriffe dieses Sets** erklärt die Fachbegriffe nur für dieses Set.

---

## Was macht das KI-Modell?

**LatentMol** kodiert Moleküle **im Set-Kontext** — nicht isoliert, sondern in Wechselwirkung miteinander. Über **Perspective Ensemble Attention (PEA)** tauschen sie Information aus: *Wie wirkt das Set aus Sicht von Molekül 1, 2, …?* Die PEA-Matrix im Quiz zeigt diese Wechselwirkungen (Mittelwert über fünf Modell-Seeds).

Das Netz wurde **ausschließlich selbstüberwacht** trainiert — auf QM9 (kleine organische Moleküle), mit zwei Aufgaben:

- **Masked Sequence Modelling** — vergleichbar mit Lückentexten, nur dass ganze Moleküle maskiert und wiederhergestellt werden
- **Tanimoto-Regression** — das Modell lernt, paarweise strukturelle Ähnlichkeit zwischen Molekülen vorherzusagen

Danach wurde LatentMol **eingefroren**. Für die OOO-Aufgabe kommt nur noch eine **lineare Probe** obendrauf — eine einfache Schicht, die aus den bereits gelernten Einbettungen ausliest, welches Molekül nicht zur Gruppe passt. Das Netz selbst wurde dafür **nicht** nachtrainiert.

---

## Linear Probing — was der Test zeigt

**Linear Probing** ist ein bewusst einfacher Nachtest: Steckt in den Einbettungen schon **relationales Wissen**, obwohl das Netz nie direkt auf „Ausreißer finden“ optimiert wurde?

Die Antwort ist **ja** — LatentMol liegt in diesem Quiz **deutlich über Zufall** (25 %). Die Repräsentationen tragen bereits Struktur über die Gruppe hinweg; die lineare Probe muss sie nur noch zuordnen.

Manchmal wählen **alle fünf Seeds einheitlich ein anderes Molekül** als die definierte Ground Truth. Das zeigt eine **Limitation der festen GT-Regel** — funktionelle Gruppen erlauben oft mehrere sinnvolle Einordnungen. Bemerkenswert ist, dass das Modell dabei häufig **chemisch ebenso gültige oder sogar treffendere** Gruppierungen findet (z. B. Ether statt Amin als Kriterium). Im Quiz erklärt **↗ Sicht des Modells**, warum diese alternative Wahl haltbar ist.

---

## PEA beeinflusst die Gruppierung

In Experimenten wurde die PEA-Matrix absichtlich verändert — etwa die Spalte des Ausreißers verstärkt. Je stärker die Verstärkung, desto besser die OOO-Trefferquote; ohne Umkehr. Wird PEA abgeschaltet, fällt die Leistung wieder ab. Korrelation allein erklärt das nicht: An der Gruppierung hängt PEA mit drin.

---

## Kurz zusammengefasst

| Punkt | Bedeutung |
|---|---|
| **Training** | Selbstüberwacht (Masking + Tanimoto); danach eingefroren |
| **OOO-Test** | Lineare Probe auf gelernten Einbettungen |
| **Ground Truth** | Regelbasiert über funktionelle Gruppen — eine von mehreren möglichen Einordnungen |
| **Seed-Ringe** | Fünf unabhängige Starts; Übereinstimmung zeigt, wie stabil die Modell-Sicht ist |
| **Sicht des Modells** | Erklärt, warum eine alternative Wahl chemisch Sinn ergeben kann |
| **PEA-Manipulation** | Verstärkung der Ausreißer-Spalte verbessert OOO schrittweise |

*Eine ausführliche wissenschaftliche Fassung (Architektur, Ablationen, Statistik) folgt in einem späteren Update.*
