# CHANGELOG.md — RingOut

Alle abgeschlossenen Änderungen am Projekt, neueste zuerst.

---

## [Unreleased]

### Dokumentation
- `CLAUDE.md`: Feature Completion Workflow auf 11 Schritte erweitert — automatische Ausführung nach jedem Task, Push-Verifikation (Branch synchron mit origin), Abschlusskriterium „nothing to commit, working tree clean" und exakter Abschlusssatz (2026-07-05)
- `CLAUDE.md` um Abschnitt „AI-Assisted Development Rules" erweitert (2026-06-30)
- `README.md` als Schnellübersicht erstellt (2026-06-30)

---

## [0.1.0] — 2026-06-30

### Initiale Implementierung

**Kern-Spielmechanik**
- Physik-Engine: Steinschleuder-Eingabe, Velocitäts-Integration, 2 Sub-Steps pro Frame
- Elastische Kollisionen zwischen Kugeln (`REST = 0.25`)
- Reibungssystem mit Langsamfahrt-Koeffizient (`FRICTION = 0.992`, `FEND = 0.992`)
- Drall / Magnus-Effekt via zweitem Touch-Finger (`SPIN_K = 0.004`, Decay `SPIN_DECAY = 0.985`)
- Ring-Out-Erkennung: Kugel überschreitet Arena-Radius → Runde endet
- Arenaschrumpfung: −3 % Radius pro Runde, Minimum 80 % des Ausgangswerts
- Phase-Zustandsautomat: `aim → reveal (600 ms) → sim → result (950 ms) → aim`

**Spielmodi**
- vs Bot (Leicht / Mittel / Schwer)
- 2 Spieler lokal (Pass-and-Play mit Sichtschutz-Bildschirm)
- Online 1v1 via Firebase Realtime Database (Lockstep, Raumcode)

**Formate**
- Einzel 1v1: 1 Kugel je Spieler
- Doppel 2v2: 2 Kugeln je Spieler, verdeckte Auswahl pro Runde

**Bot-KI**
- Leicht: Zufallsrichtung mit ±60°-Rauschen, reduzierte Kraft
- Mittel: Heuristik – Angriff auf Gegner oder Rückzug zur Mitte
- Schwer 1v1: Minimax via `simExchange` (650 Schritte), Bewertung durch `evalExchange`
- Schwer 2v2: Minimax via `simSnap` (420 Schritte) + `bestRespN`

**Online-Multiplayer**
- Firebase Realtime Database, Raumcode (4 Zeichen, ohne verwechselbare Zeichen)
- Lockstep: deterministischer Spielfeldkoordinatensatz (`LOGICAL = 1000`)
- Disconnect-Handling (`onDisconnect().remove()`)
- Rematch via Generationszähler (`gen`)
- Spielfeld-Spiegelung für Spieler 2 (Canvas-Rotation um 180°)

**Rendering**
- Goldene Vektor-Arena: radiale Gradienten, konzentrische Ringe, Kompassrose, Innenmedaillon
- Kristallrand: dreischichtiger animierter Goldglow + Kardinal-Kristallmarker
- 4 animierte Fackelhalter außerhalb der Arena (Flammen-Halo, Bodenlicht)
- Optionale Bildintegration (`arena.jpg`) vorbereitet
- Kugeln: 3D-Sphären-Gradient, Rim-Light, Bewegungsspur, Randwarnung bei < 26 % Abstand
- Slingshot-Vorschau: Drall-Trajektorie, gestrichelte Kraftlinie, Kraftanzeige in %
- Enthüllungspfeile nach dem Commit
- Hintergrund-Flash (`bgPulse`) bei Treffer

**Partikel-System**
- Spawn bei Abschuss, Treffer und Ring-Out
- Eigenschaften: Position, Velocity, Lebensdauer, Größe, Farbe

**Replay-System**
- Frame-für-Frame-Aufzeichnung aller Physikzustände (max. 6 000 Frames)
- Wiedergabe: Play/Pause, Vor/Zurück (30-Frame-Sprünge), Geschwindigkeit 1× / ½× / ¼×
- Seek-Balken

**Audio (Web Audio API, prozedural)**
- Ladetonkontinuierlich moduliert mit Zugstärke (kein Stuck-Sound durch saubere Stop-Logik)
- Abschussklang, Trefferlaut, Ring-Out-Klang, Rundensieg-Fanfare, Match-Gewinn-Fanfare
- Lautstärke-Toggle (🔊 / 🔇)

**UI / UX**
- Hauptmenü: Modus-, Schwierigkeits-, Format- und Rundenzahl-Auswahl mit Pill-Buttons
- HUD: Spielerkarten, Punktestand, Rundenanzeige, Phasenstatus
- Toast-Benachrichtigungen (2,2 s)
- Game-Over-Overlay mit Rematch-, Replay- und Menü-Option
- Sichtschutz-Bildschirm für lokales 2-Spieler-Spiel
- Online-Lobby mit Raum erstellen / beitreten

**Projektdokumentation**
- `CLAUDE.md`: Coding Standards, Architektur-Richtlinien, Git-Workflow, Performance-Checkliste
- `PROJECT.md`: Aktueller Projektstand (dieses Release)
- `ROADMAP.md`: Langfristige Ziele in 6 Phasen
- `TODO.md`: Offene Aufgaben nach Priorität (P0–P3)
- `CHANGELOG.md`: Dieses Dokument

---

_Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/)._
