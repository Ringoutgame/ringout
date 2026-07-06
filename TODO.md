# TODO.md — RingOut

**Zuletzt aktualisiert:** 2026-07-06

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
- [ ] **Manueller Browser-Smoke M1 (T1–T4):** Bot-/PvP-Runde + Online-Zwei-Tab (Create, Join, Commit, Rematch, Disconnect) nach Rules-Publish. Automatisierte Logik-/REST-Tests grün, interaktiver Check steht aus.

---

## P1 — Hoch (Codequalität / Architektur)

- [ ] **M2-T1b — Ice-Feel-Physik-Tuning (freigegeben, ausstehend):** Auslauf minimal früher abbremsen (Kandidat: `FEND` von 0.992 leicht senken, ggf. `STOPV` leicht anheben; schnelle Gleitphase unverändert). **Zwingend:** `ONLINE_PROTOCOL_VERSION` 1→2 **und** `firebase.rules.json` `v===2` neu publizieren (sonst Desync/blockierte Online-Räume). Deterministik-relevant.

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

- [ ] **3D-Prototyp zum Premium-Look weiterentwickeln:** `prototype3d.html` (Three.js-Visual-Spike, technisch erfolgreich) braucht für den Referenz-Look echte Assets — hochwertige Marmor-/Stein-Texturen (PBR-Maps), volumetrischere Wolken, ggf. HDRI-Environment. Erst danach Go/No-Go-Entscheidung zur Integration ins Hauptspiel (Render-Adapter, Input-Raycasting; Physik/Lockstep bleiben 2D-`LOGICAL`).
- [ ] **Entscheidung Pseudo-3D-Stand in `index.html`:** Der M2-T2-Arbeitsstand (Kamera + Pseudo-3D, unkommittet im Working Tree) ist funktional und getestet, aber optisch nicht final. Owner-Entscheidung: als Zwischenstand committen, verwerfen oder bis zur 3D-Entscheidung halten.

- [ ] **Bot-KI auf Web Worker auslagern:** Verhindert UI-Ruckeln bei Hard-Bot-Berechnung (bis zu 650 × N Simulations-Schritte synchron im UI-Thread).
- [ ] **Einstellungen in localStorage speichern:** Zuletzt gewählter Modus, Schwierigkeitsgrad, Lautstärke und Format sollen nach Seiten-Reload erhalten bleiben.
- [ ] **Fehlerbehandlung Online-Modus verbessern:** Verbindungsabbrüche während einer Runde führen aktuell nur zu einem Toast ohne Rückkehr zum Menü. Reconnect-Logik oder sauberer Abbruch implementieren.
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
