# LatentMol — Kurz erklärt

## Was passiert in diesem Quiz?

Vier Moleküle werden gezeigt. **Drei passen chemisch zusammen**, eines ist der **Ausreißer**. Deine Aufgabe: Finde es.

Gemeint ist: Drei teilen ein **grobes Bindungsmuster** (z. B. Stickstoff im aromatischen Ring, Ether, –NH₂) — am Strukturbild ablesbar. Das vierte weicht ab. Die **Ground Truth** im Quiz folgt dieser regelbasierten Einordnung (RDKit), nicht bloß „sieht ähnlich aus“.

Nach deiner Wahl erklärt die Auflösung den Ausreißer — zuerst **grob** (z. B. „N im Ring“), darunter in **Details** die Muster pro Molekül (höchstens drei Merkmale). **Klick auf einen Begriff** öffnet Erklärung und eine kleine Beispielstruktur (RDKit).

---

## Was macht das KI-Modell?

**LatentMol** kodiert Moleküle **im Set-Kontext** — nicht isoliert, sondern in Wechselwirkung miteinander. Über **Perspective Ensemble Attention (PEA)** tauschen sie Information aus: *Wie wirkt das Set aus Sicht von Molekül 1, 2, …?* Die PEA-Matrix im Quiz zeigt diese Wechselwirkungen (Mittelwert über fünf Modell-Seeds).

Das Netz wurde **selbstüberwacht** trainiert — auf QM9 (kleine organische Moleküle) mit zwei domäneninformierten Zielen:

- **Masked Sequence Modelling** — einzelne **Atome** werden maskiert und aus dem Kontext wiederhergestellt
- **Tanimoto-Regression** — das Modell lernt im Pretraining, **Fingerprint-Ähnlichkeit** zwischen Molekülpaaren vorherzusagen (Morgan/ECFP)

Das sind **Trainingsziele**, keine Anleitung für die Ausreißer-Frage im Quiz. Danach wurde LatentMol **eingefroren**. Für die OOO-Aufgabe kommt nur noch eine **lineare Probe** obendrauf — sie liest aus den gelernten Einbettungen, welches Molekül nicht zur Gruppe passt.

In internen Auswertungen hängt die OOO-Trefferquote **stärker mit der PEA-Matrix** zusammen (z. B. Isolation der Ground-Truth-Spalte) als mit einzelnen Funktionsgruppen-Labels. Die PEA-Matrix (Tabelle) ist deshalb die zentrale Modell-Erklärung: **relationale Nutzung im Set**, nicht „das Netz rechnet Tanimoto nach“.

---

## Linear Probing — was der Test zeigt

**Linear Probing** ist ein bewusst einfacher Nachtest: Steckt in den Einbettungen schon **relationales Wissen**, obwohl das Netz nie direkt auf „Ausreißer finden“ optimiert wurde?

Die Antwort ist **ja** — LatentMol liegt in diesem Quiz **deutlich über Zufall** (25 %). Die Repräsentationen tragen bereits Struktur über die Gruppe hinweg; die lineare Probe muss sie nur noch zuordnen.

Manchmal wählen **alle fünf Seeds einheitlich ein anderes Molekül** als die definierte Ground Truth. Das kann eine **Limitation der festen GT-Regel** sein — Bindungsmuster erlauben oft mehrere sinnvolle Einordnungen, und das Modell findet dann **chemisch ebenso gültige** Gruppierungen. Manchmal ist die Modell-Wahl aber auch **einfach falsch**. Im Quiz erklärt **↗ Sicht des Modells**, wann eine alternative Wahl Sinn ergibt.

---

## PEA und kausaler Einfluss auf die Gruppierung

In Experimenten wurde die PEA-Matrix gezielt verändert. Zuerst Korrelation (hohe PEA-Werte stimmen mit OOO-Vorhersagen), danach Intervention: einzelne PEA-Spalten wurden verstärkt/geschwächt und die OOO-Trefferquote ändert sich monoton mit. Das ist ein Interventions-Effekt im Modell und stützt den kausalen Einfluss der PEA-Signale innerhalb des Modells.

---

## Kurz zusammengefasst

| Punkt | Bedeutung |
|---|---|
| **Training** | Selbstüberwacht (Masking + Tanimoto als domäneninformiertes Ziel); danach eingefroren |
| **OOO-Test** | Lineare Probe auf relationalen Einbettungen; PEA zeigt Set-Wechselwirkung |
| **Ground Truth** | Regelbasiert über Bindungsmuster (grob + Details in der Tabelle) |
| **Seed-Ringe** | Fünf unabhängige Starts; Übereinstimmung zeigt stabile Modell-Sicht |
| **Sicht des Modells** | Erklärt chemisch plausible Alternativen — nicht bei jeder Abweichung |
| **PEA-Manipulation** | Einzelne PEA-Spalten verstärken → monotone OOO-Änderung; falsche Spalte → oft schlechter |
