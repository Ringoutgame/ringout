# ROADMAP.md — RingOut

**Zuletzt aktualisiert:** 2026-06-30

Diese Roadmap beschreibt langfristige Ziele und geplante Features. Konkrete, sofort umsetzbare Aufgaben stehen in `TODO.md`.

---

## Phase 1 — Codebase-Fundament

Ziel: Den bestehenden Spaghetti-Code in eine wartbare, skalierbare Struktur überführen, ohne die Spiellogik zu verändern.

- [ ] Quellcode in separate Dateien / Module aufteilen (Physik, Rendering, KI, Input, Online, Audio, UI)
- [ ] Build-System einrichten (Vite empfohlen – schnell, Zero-Config für Canvas-Games)
- [ ] TypeScript einführen (schrittweise Migration, beginnend mit den Kerntypen)
- [ ] Lint-Konfiguration (ESLint + Prettier)
- [ ] Firebase API-Key aus dem Quellcode herausziehen (`.env`-Datei + Vite-Variablen)
- [ ] Ordnerstruktur nach CLAUDE.md anlegen (`src/core`, `src/gameplay`, `src/rendering`, …)

---

## Phase 2 — Qualität und Testbarkeit

Ziel: Vertrauen in die Korrektheit der Spielmechanik durch automatisierte Tests.

- [ ] Unit-Tests für die Physik-Engine (Kollision, Reibung, Drall, Ring-Out-Erkennung)
- [ ] Unit-Tests für die Bot-KI (Ausgabe in erwarteten Bereichen, deterministisch)
- [ ] Integrationstests für den Spielphasen-Zustandsautomaten (`aim → reveal → sim → result`)
- [ ] CI-Pipeline (GitHub Actions – Lint + Tests bei jedem Push)
- [ ] Bot-Simulation auf Web Worker auslagern (kein UI-Thread-Stottern mehr)

---

## Phase 3 — Spieler-Erfahrung

Ziel: Das Spiel für alle Zielgruppen zugänglicher und ansprechender machen.

- [ ] Mehrsprachigkeit (i18n) – Deutsch als Standard, Englisch als zweite Sprache
- [ ] PWA-Support: `manifest.json`, Service Worker, Offline-Spielbarkeit (Bot-Modus)
- [ ] Barrierefreiheit: Tastatursteuerung, ARIA-Labels, Kontrastsicherheit
- [ ] Einstellungen persistieren (localStorage: Lautstärke, bevorzugter Modus, Schwierigkeit)
- [ ] Haptisches Feedback auf Mobile (Vibration API bei Ring-Out / Treffer)
- [ ] Animierter Tutorial-Overlay für Erstbesucher

---

## Phase 4 — Online-Lobby und Matchmaking

Ziel: Das Online-Erlebnis professionalisieren.

- [ ] Lobby-Übersicht: offene Räume einsehen und beitreten ohne Code-Eingabe
- [ ] Automatisches Matchmaking (Spieler in Warteschlange zusammenführen)
- [ ] Spectator-Modus: Live-Zuschauer im Raum
- [ ] Rematch-Einladung mit Timeout und Bestätigung beider Spieler
- [ ] Ping-Anzeige / Latenzkompensation für schlechte Verbindungen
- [ ] Raum-Konfiguration durch Host (Format, Rundenzahl, Schwierigkeitsgrad für Bot-Modus)

---

## Phase 5 — Spieltiefe und Content

Ziel: Langzeit-Motivation durch mehr Vielfalt.

- [ ] Arenen-Skins / Themen (Eis-Arena, Vulkan-Arena, Weltraum)
- [ ] Kugel-Skins / Farbanpassung
- [ ] Neue Spielmodi (z. B. Zeitangriff, Last Ball Standing im Team)
- [ ] Handicap-System (Kugel mit unterschiedlicher Masse / Größe)
- [ ] Power-Ups auf der Arena (zufällig platziert, optional aktivierbar)
- [ ] Turnier-Modus (Bracket-System für 4 / 8 Spieler)

---

## Phase 6 — Persistenz und Community

Ziel: Spieler-Daten speichern und Community-Features aufbauen.

- [ ] Benutzerkonten (Firebase Authentication, anonym oder mit E-Mail)
- [ ] Statistiken: gespielte Matches, Siege, Ring-Outs, Win-Rate
- [ ] Globale Rangliste (Elo oder ähnliches System)
- [ ] Replay-Sharing: Replay-Link generieren und teilen
- [ ] Daily Challenge: täglich wechselnde Bot-Konfiguration gegen die Zeit

---

## Technische Schulden (dauerhaft im Blick)

- Physik-Konstanten aus dem Code in eine zentrale Konfigurationsdatei auslagern
- Arena-Shrinking-Logik dokumentieren (warum 3 % / 80 %?)
- Firebase-Datenbankregeln härten (aktuell: unkontrollierter Schreibzugriff möglich)
- Replay-Buffer-Limit überdenken (aktuell 6 000 Frames = ~3 min bei 60 FPS)
