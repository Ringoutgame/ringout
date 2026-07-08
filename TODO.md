# TODO.md — RingOut

**Zuletzt aktualisiert:** 2026-07-09

Offene Aufgaben nach Priorität. Abgeschlossene Aufgaben werden nach `CHANGELOG.md` verschoben.

---

## P0 — Kritisch (Sicherheit / Stabilität)

- [x] ~~**Online-Züge validieren (M1-T1)**~~ → erledigt, siehe CHANGELOG (2026-07-05)
- [x] ~~**Raum-Konfiguration beim Beitritt validieren (M1-T2)**~~ → erledigt, siehe CHANGELOG (2026-07-06)
- [x] ~~**Client-Versionscheck für Online-Räume (M1-T3)**~~ → erledigt als `ONLINE_PROTOCOL_VERSION`, siehe CHANGELOG (2026-07-06)
- [x] ~~**Firebase Datenbankregeln härten (M1-T4)**~~ → erledigt: `firebase.rules.json` publiziert, REST-Verifikation (29/29, inkl. Gen-Match) und manueller Zwei-Tab-Test bestanden, siehe CHANGELOG (2026-07-06)
- [ ] **Firebase App Check aktivieren (nachgelagert):** Braucht registrierte http(s)-Origin (reCAPTCHA) — erst nach Hosting/Build (M4-T2) sinnvoll; per `file://` geöffnete Clients könnten sich sonst nicht attestieren.
- [ ] **API-Key aus Quellcode ziehen (nachgelagert, M4-T2):** `.env` + Build-System; aktuell öffentlich (durch Rules + späteren App Check abgesichert).
- [ ] **Room-TTL / Cleanup (nachgelagert):** Neue Rules blockieren Client-Deletes; Test-/Alträume bleiben liegen. TTL via Cloud Function später.
- [x] ~~**Manueller Browser-Smoke M1 (T1–T4)**~~ → **abgeschlossen (2026-07-08)**: Online-Kernfluss via M6-T1 (2v2-Zwei-Tab) bestätigt, Rematch/Disconnect via M6-T1b (1v1 + 2v2: Rematch beidseitig, Format/Score-Reset sauber, Gast- und Host-Disconnect, neuer Raum danach ohne Alt-Zustand); Bot-/PvP-Runden durch die M4/M5-Abnahmen abgedeckt. Keine Codeänderung, kein Protocol-Bump, keine Firebase-Änderung.
- [x] ~~**Live-URL-Smoke / Playtest-Readiness (M7-T1)**~~ → **bestanden (2026-07-08)**: https://ringoutgame.github.io/ringout/ — 3D-Default, Online über echte Geräte/Netze, 1v1, 2v2, Rematch, Leave/Disconnect-Flow, `?r2d=1`. **Bereit für kleinen privaten Playtest**; nur private Tester, noch kein öffentlicher Launch (Auth/App Check, Room-TTL, API-Key-Härtung stehen aus, siehe nachgelagerte P0-Punkte).
- [x] ~~**Online 2v2 verifizieren (M6-T1)**~~ → **manuell bestätigt (2026-07-08)**: Feature war bereits seit M1 vollständig implementiert (Lockstep-Move mit `idx`, Rules idx 0–3, `fmt:'double'` in Raum-Config). Zwei-Tab-Test bestanden: Create/Join, je 2 Kugeln, Kugelwahl, Reveal, synchrone Simulation, Ringout, Rundensieg, 3D-Default. Keine Codeänderung, kein Protocol-Bump, keine Firebase-Änderung.

---

## P1 — Hoch (Codequalität / Architektur)

- [x] ~~**Offline-Tuning-Harness (M5-T1)**~~ → **abgeschlossen & akzeptiert**: `?tune=br/fend/stopv` nur lokal (Online hart blockiert), `tools/tune_compare.js`, Default bit-identisch; inkl. 3D-Aim-Fix (Screen-Space-Zone, viewport-großes Overlay), siehe CHANGELOG (2026-07-08)
- [ ] **M5-T2 — Physics-Tuning-Pass (Sizing + Ice-Feel, gebündelt; ersetzt M2-T1b):** Zielwerte per `?tune=`-Playtest fixieren (BR/FEND/STOPV), dann in **einem** Commit: Konstanten einbauen, Goldens `--update`, `ONLINE_PROTOCOL_VERSION` 1→2, `firebase.rules.json` `v===2` publizieren, Online-Zwei-Tab-Test. Kandidaten: `FEND` 0.992→0.989–0.990, `STOPV` 0.10→0.12, `BR` 0.032→0.028–0.029; `R0`/`MAXPULL_FRAC`/`FRICTION`/`REST` unverändert.

- [ ] **Build-System einrichten:** Vite initialisieren, `index.html` als Einstiegspunkt. Ermöglicht ES-Module, Env-Variablen und Tree-Shaking.
- [ ] **Code aufteilen:** Spiellogik aus `index.html` in separate Module extrahieren:
  - `src/core/gameLoop.js` – Haupt-Loop, Phase-Management
  - `src/gameplay/physics.js` – Physik-Engine, Kollision, Drall
  - `src/gameplay/bot.js` – KI-Logik (1v1 + 2v2)
  - `src/rendering/draw.js` – Canvas-Rendering, Arena, Kugeln
  - `src/systems/audio.js` – Web Audio SFX
  - `src/systems/replay.js` – Replay-Aufzeichnung und Wiedergabe
  - `src/services/firebase.js` – Online-Multiplayer-Logik
  - `src/ui/hud.js` – HUD-Updates, Toast, Cover-Screen

---

## P2 — Mittel (Spieler-Erfahrung)

- [x] ~~**3D-Prototyp zum Premium-Look weiterentwickeln**~~ → erledigt und **visuell akzeptiert** (PBR/HDRI/Blender-GLB-Pipeline), siehe CHANGELOG (2026-07-07)
- [x] ~~**3D-Prototyp: Mobile-Performance messen**~~ → **bestanden**: Handy 60 FPS (Min 60), GLB ~1,96 s, HDRI ~0,96 s; PC >150 FPS. Monitor via `?perf=1` (2026-07-07)
- [x] ~~**Golden-Physik-Tests (M4-T1)**~~ → erledigt: 13 bit-exakte Referenzfälle in `tools/`, Selftest bestanden, siehe CHANGELOG (2026-07-07)
- [x] ~~**3D-Integration Schritt 1 (M4-T2)**~~ → **abgeschlossen & akzeptiert**: 3D-Render-Adapter hinter `?r3d=1` (bewegbare Kamera, Raycasting-Input, projizierte Overlays, Kante=Out-Grenze, Fall-Animation), 2D bleibt Standard/Fallback, siehe CHANGELOG (2026-07-07)
- [x] ~~**3D-Mobile-Test (M4-T2b)**~~ → **bestanden**: `?perf=1`-Monitor ins Hauptspiel portiert, Mobile-Portrait-Framing-Bug (`#cv3d` ohne CSS-Größe auf DPR>1) behoben; Handy 60 FPS (Min 60), GLB ~1 555 ms, HDRI ~118 ms, siehe CHANGELOG (2026-07-08)
- [x] ~~**Sound-Pass (M4-T3)**~~ → **abgeschlossen & akzeptiert**: Murmel-Kollision (Modal-Synthese), Roll-Sound, Strain-Charge, Wind-Ringout, Spam-Schutz, Mobile-Unlock + dezente 3D-Kontakt-FX und luxury-minimal Aim-Overlay, siehe CHANGELOG (2026-07-08)
- [x] ~~**3D als Default (M4-T4)**~~ → **abgeschlossen & akzeptiert**: 3D lädt standardmäßig, `?r2d=1` erzwingt 2D, `?r3d=1` kompatibel, Fallback unverändert, siehe CHANGELOG (2026-07-08)
- [x] ~~**Lokaler FFA-Kern 2–5 Spieler (M8-T2)**~~ → **abgeschlossen & akzeptiert (2026-07-08)**: Hotseat-Modus „👥 FFA" mit Last-Man-Standing, zentraler Spielerfarben-Tabelle `PCOLS` (Slots 0–4) und Chip-HUD; dient als technische Basis/Testharness für den Online-FFA. Golden 13/13 bit-exakt, FFA-Suite 18/18; kein Online-FFA, keine Firebase-Änderung, kein Protocol-Bump. Siehe CHANGELOG.
- [ ] **Online-FFA 2–5 Spieler (M8-T3+):** Restschritte — **T3c:** Aktivierung (claimSeat/Lobby-Listener/Host-Start live), **T3d:** Disconnect-Matrix, **T3e:** Abnahme. Bump-Frage entschieden: Online-FFA = v2 (aktiv seit M8-T3b), M5-T2 würde später v3.
  - [x] ~~**M8-T3b Protocol-Bump + Rules-Erweiterung**~~ → **abgeschlossen & akzeptiert (2026-07-09)**: Protocol v2 aktiv, Firebase Rules v2 veröffentlicht und REST-verifiziert (56/56; lokale Rules-Engine-Suite 59/59, alle neuen Bedingungen ffa-gegated). Online-FFA serverseitig vorbereitet, clientseitig weiterhin deaktiviert (4 Blocker). Live-Smoke 1v1/2v2 auf v2 bestanden. Siehe CHANGELOG.
  - [x] ~~**M8-T3a Client-Vorbereitung**~~ → **abgeschlossen & akzeptiert (2026-07-09)**: validateRoom (ffa-Schema vorbereitet, single/double identisch), versteckte Lobby-UI + Roster-Renderer, Seat-Claiming mit Retry (unbenutzt), `allAliveCommitted()`-Reveal, Seat-Schleifen statt `opp=1-myPlayer`. Online-FFA bewusst deaktiviert (4 Blocker); Firebase/Rules/Protocol unverändert; Online 1v1/2v2 zwei-Tab-geprüft. Siehe CHANGELOG.
- [ ] **3D-Folgethemen (gesammelt):** Sizing-Task (+Fläche/Kugeln, Physik + Protocol-Bump), 4–5-Spieler-Konzept; three.js später selbst hosten statt CDN (→ Build-System-Task); optionaler FPS-Wächter mit `?r2d=1`-Hinweis auf schwachen Geräten.
- [ ] **4–5-Spieler-Playtest mit echter Physik:** `PLAY_SCALE`/Kugelgröße final tunen (aktuell geometrisch ausgelegt, spielerisch ungetestet — seit M8-T2 lokal im FFA-Modus testbar).
- [ ] **Entscheidung Pseudo-3D-Stand in `index.html`:** Der M2-T2-Arbeitsstand (Kamera + Pseudo-3D, unkommittet im Working Tree) ist funktional und getestet, aber optisch nicht final. Owner-Entscheidung: als Zwischenstand committen, verwerfen oder bis zur 3D-Entscheidung halten.

- [ ] **Bot-KI auf Web Worker auslagern:** Verhindert UI-Ruckeln bei Hard-Bot-Berechnung (bis zu 650 × N Simulations-Schritte synchron im UI-Thread).
- [ ] **Einstellungen in localStorage speichern:** Zuletzt gewählter Modus, Schwierigkeitsgrad, Lautstärke und Format sollen nach Seiten-Reload erhalten bleiben.
- [x] ~~**Fehlerbehandlung Online-Modus: sauberer Abbruch (M7-T1a)**~~ → **erledigt & akzeptiert (2026-07-08)**: Gegner-Disconnect zeigt Overlay mit ↩-Menü-Rückweg; ☰ fragt im Online-Match per Bestätigung nach und nutzt denselben Leave-Pfad. Kein Protocol-Bump, keine Firebase-Änderung, keine Physik-/Sound-/Grafikänderung. Siehe CHANGELOG.
- [ ] **Online-Reconnect-Logik (Rest von „Fehlerbehandlung Online-Modus"):** Wiedereinstieg in ein laufendes Match nach kurzem Verbindungsabbruch — aktuell endet das Match für beide sauber (Overlay), aber ohne Fortsetzungsmöglichkeit.
- [ ] **REST-Testräume manuell löschen (P3):** 7SNX, DDKU, 5CZ4 aus der M8-T3b-Verifikation verbleiben in der Live-DB (Rules erlauben clientseitig kein Löschen) — bei Gelegenheit in der Firebase Console entfernen.
- [ ] **Replay-Buffer-Limit überprüfen:** Aktuell werden bei langen Matches ältere Frames gelöscht (`recFrames.shift()`). Das Replay ist dann unvollständig. Entweder Limit erhöhen oder Nutzer informieren.

---

## P3 — Niedrig (Nice to have)

- [ ] **Mehrsprachigkeit vorbereiten:** Alle deutschen Strings in ein Übersetzungs-Objekt auslagern (`de`, `en`), um i18n später ohne Refaktorierung des Markups zu ermöglichen.
- [ ] **PWA-Manifest hinzufügen:** `manifest.json` mit App-Name, Icon, Themenfarbe, damit das Spiel auf Mobile als App installierbar ist.
- [ ] **Tastatursteuerung (Bot-Modus):** Einfache Keyboard-Shortcuts für Desktop-Spieler (z. B. Pfeiltasten für Richtung, Leertaste für Abschuss).
- [ ] **Barrierefreiheit:** ARIA-Rollen auf interaktive Elemente, sichtbarer Fokus-Ring auf Buttons.
- [ ] **`arena.jpg`-Unterstützung dokumentieren:** Die Bildpfad-Integration ist vorbereitet aber auskommentiert. Klarer Hinweis in der README, wie ein eigenes Arenabild eingebunden wird.

---

## Dauerhaft (Wartung)

- [ ] Physik-Konstanten (`FRICTION`, `LAUNCH`, `SPIN_K`, …) in eine zentrale `src/config/physics.js` auslagern
- [ ] Linting-Regeln definieren (ESLint) und bei jedem Commit prüfen
- [ ] TypeScript schrittweise einführen, beginnend mit den Physik- und Zustandstypen
