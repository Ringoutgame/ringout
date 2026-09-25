# RingOut

Kompetitives, physikbasiertes Browser-Spiel unter der Marke RINGOUT. Das spielbare Hauptspiel ist **Arena Football**: Zieh deine Figur zurück, lass los und schieß den Ball ins gegnerische Tor — FFA, 1 VS 1 (Tactical), Team 2v2 und VS BOTS.

> **Ring Out** (Kugeln aus der Arena stoßen) ist seit 2026-09-25 vorerst nicht im spielbaren Angebot. Der Code bleibt erhalten (Schalter `RINGOUT_SPIELBAR` in `index.html`); laufende Ring-Out-Räume lassen sich über „Wieder beitreten“ zu Ende spielen, neue entstehen nicht. Mit `?dev=1` bleibt Ring Out für Tests erreichbar.

---

## Entwicklungsstand

Spielbares Einzelprojekt (`index.html`). Alle Spielmodi funktionieren. Kein Build-System, keine Tests, kein Framework.

---

## Projekt starten

Datei direkt im Browser öffnen — kein Server erforderlich:

```
index.html → Doppelklick oder per Browser öffnen
```

Online-Modus erfordert Internetverbindung (Firebase).

---

## Wichtige Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Gesamte Spiellogik, UI und CSS |
| `CLAUDE.md` | Coding Standards und Entwicklungsregeln |

---

## Dokumentation

| Datei | Beschreibung |
|---|---|
| [PROJECT.md](PROJECT.md) | Aktueller Projektstand, Systeme, Einschränkungen |
| [ROADMAP.md](ROADMAP.md) | Langfristige Ziele und geplante Features |
| [TODO.md](TODO.md) | Offene Aufgaben nach Priorität |
| [CHANGELOG.md](CHANGELOG.md) | Abgeschlossene Änderungen mit Datum |
