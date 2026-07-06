# CHANGELOG.md — RingOut

Alle abgeschlossenen Änderungen am Projekt, neueste zuerst.

---

## [Unreleased]

### Visual
- feat: isolierter Three.js-Visual-Spike `prototype3d.html` — echter WebGL-3D-Prototyp der Arena (schwebende Marmor-/Stein-Plattform mit zerklüftetem Fels-Unterbau, Gold-Inlays, 8 Kristall-Sockel, zwei Hochglanz-Kugeln, Wolkenmeer + ferne Wolkeninseln, warme Sonnenstimmung, Orbit-Kamera mit geklemmtem Tilt). Drei Polish-Pässe durchlaufen. **Status: technisch erfolgreich, visuell noch nicht final** — für den Premium-Look der Referenzbilder fehlen echte Assets (Marmor-/Stein-Texturen, volumetrischere Wolken). Dependency: three@0.170.0 nur via CDN-Importmap in dieser einen Datei. **Keine Integration ins Hauptspiel** — `index.html`, Spiel-Logik, Physik, Online, Replay und Firebase unberührt (2026-07-06)
- feat: 3D-Arena-Erlebnis + Kamera-Steuerung (M2-T2) — Pseudo-3D/Hybrid auf Canvas 2D: orthografische Kamera (Yaw frei 360°, Pitch geklemmt 0–35°, Default ~20°), Drag auf leerer Fläche dreht die Ansicht (Drag auf eigener Kugel zielt wie bisher, 2. Finger bleibt Drall — jetzt in Screen-Pixeln). Heller Wolkenhimmel mit Sonne und Parallaxe (einmalig gebacken), Marmorboden mit Adern/Gold-Ringlinien/Kompassrose (einmalig gebacken → pro Frame nur drawImage, zugleich Perf-Cache), zweistufige Zylinder-Wand mit Steinbändern (sichtbare Plattform-Dicke), Schlagschatten auf Wolkenebene, 8 Kristall-Sockel am Rand, exakte Rauswurf-Grenze als projizierte Ellipse. Kugeln als Billboards (immer rund, tiefensortiert) mit glossy Spitzlicht, Nebenreflex, Boden-Gegenlicht. Input via exakter Kamera-Inverse — der alte 180°-Spiegel für Online-P2 ist jetzt Kamera-Default Yaw=180°. Kamera ist rein lokal (nie synchronisiert): Lockstep, Replay-Daten und Determinismus unberührt; keine Physik-, Protokoll- oder Firebase-Änderung (2026-07-06)
- feat: arena visual polish (M2-T1a) — kühles eisig-metallisches Material statt Gold-Look: Silber-/Stahlblau-Bodengradient mit metallischem Streiflicht und frostigem Innenleuchten, Eisglow statt Goldglow am Rand, pseudo-3D-Randwand (gestuftes Band für Tiefe), Schlagschatten-Ellipse unter der Plattform (Schwebe-Eindruck), kühl-dunkler Stahlblau-Hintergrund (kein heller Himmel), weicherer/klar definierter Kugel-Bodenschatten. Boden bewusst silbrig-neutral gehalten, damit blaue und rote Kugel klar sichtbar bleiben. Rein visuell — keine Physik, keine Konstanten, kein Determinismus-/Lockstep-/Replay-Einfluss (2026-07-06)

### Features
- feat: add Firebase Realtime Database security rules (`firebase.rules.json`) — enforce room schema server-side as a second line behind client validation: room code charset, immutable `v`/`config`/`created` after creation, write-once moves with value bounds mirroring `sanitizeMove` (idx exactly 0–3, dx/dy ±195, sp ±1), move writes only for the current `gen` (verified via `$gen === gen + ''` coercion), monotonic `gen` (+1 or idempotent equal), clean initial room (gen 0, host present, no guest/moves prefilled) guarded by `data.exists()` so it applies only at creation and never blocks later child writes, host presence delete-only (p/0 cannot be re-set after the host leaves), presence with 2h join window, no room enumeration (root read denied). `created` switched to `serverTimestamp()` so the rule `created === now` makes it server-authoritative. Published manually in the Firebase console and verified against the live DB (29/29 REST checks incl. gen-match in both directions) plus a manual two-tab match (create, join, moves, rematch, disconnect). App Check deferred (see TODO). Honest limit: without auth, anyone who knows a room code can still grief (take the guest slot, write valid moves, trigger gen +1) — rules only block invalid structure/values, overwrites, room-overwrite, and enumeration (2026-07-06)
- feat: add online protocol version check — `ONLINE_PROTOCOL_VERSION` (Integer, Start 1) wird von `createRoom()` atomar in den Raum geschrieben; `validateRoom()` lehnt fehlende oder abweichende Versionen strikt ab („Versionen stimmen nicht überein — bitte beide Seite neu laden."). Bump-Regel: nur bei Änderungen an Online-Protokoll, Raum-Schema, Lockstep, Physik oder Move-Daten — reine UI-/Grafik-/Textänderungen bumpen nicht (2026-07-06)

### Fixes
- fix: validate room data before joining online rooms — new pure `validateRoom()` rejects invalid/manipulated rooms instead of silently defaulting: `winTarget` strictly 3|5, `fmt` strictly single|double, `gen` safe integer 0–10 000, presence map checked (host must be present, room not full; Firebase array form supported). Validation runs before any state mutation in `joinRoom()` (2026-07-06)
- fix: clamp online move data (dx, dy, sp) before applying — prevents velocity injection by cheating clients. Deterministic, idempotent `sanitizeMove()` applied at both lockstep ends (sender in `commit()`, receiver in `onlineTurnValue()`): move vector magnitude clamped to `maxPull()`, spin to [−1, +1], ball index validated against ownership with fallback (2026-07-05)

### Dokumentation
- `CLAUDE.md`: Zusammenfassungs-Regel ergänzt — Antworten über ~15–20 Zeilen beginnen mit einer 2–4-zeiligen „Kurz gesagt:"-Zusammenfassung (2026-07-06)
- `CLAUDE.md`: Kommunikationsregel ergänzt — kompakte, entscheidungsorientierte Owner-Kommunikation: kurze Statuszeilen während der Arbeit, festes 6-Punkte-Briefing (Ziel/Warum jetzt/Änderung/Risiken/Tests/Empfehlung) und 6-Punkte-Abschlusszusammenfassung; technische Details nur auf ausdrückliche Anfrage (2026-07-06)
- `CLAUDE.md`: Sprachregel ergänzt — alle Erklärungen an den Projekt-Owner (Briefings, Abschluss-Zusammenfassungen, Statusmeldungen) immer auf Deutsch; Code, Commits, technische Doku und Dateiinhalte bleiben Englisch (2026-07-05)
- `CLAUDE.md`: Planning Workflow Schritt 5 ersetzt — vor jedem Task (ohne Größen-Ausnahme) ein Briefing aus 5–10 Sätzen (warum jetzt, was kann brechen, wie sieht Erfolg aus, kommerzieller 100 000-Spieler-Test), danach explizite Freigabe abwarten; Freigabe gilt nur pro Task (2026-07-05)
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
