# PROJECT.md — RingOut

**Zuletzt aktualisiert:** 2026-07-06

---

## Was ist RingOut?

RingOut ist ein kompetitives, physikbasiertes Browser-Spiel für 1–2 Spieler. Jede Runde ziehen Spieler ihre Kugel wie eine Steinschleuder zurück und lassen sie los – wer den Gegner aus dem goldenen Rundring schleudert, gewinnt die Runde. Das Konzept ähnelt Sumo, gespielt mit Kugeln.

---

## Technischer Stand

| Merkmal | Aktueller Wert |
|---|---|
| Implementierung | Einzelne Datei (`index.html`, ~1 088 Zeilen) |
| Sprache | Vanilla JavaScript (ES2020+), kein Framework |
| Rendering | HTML5 Canvas 2D |
| Audio | Web Audio API (prozedural, kein Asset-Loading) |
| Netzwerk | Firebase Realtime Database (Lockstep) |
| Build-System | keines – direktes Öffnen im Browser |
| Tests | keine |
| TypeScript | nein |
| UI-Sprache | Deutsch |

---

## Spielmodi

| Modus | Beschreibung |
|---|---|
| vs Bot | Spieler gegen KI (Schwierigkeiten: Leicht / Mittel / Schwer) |
| 2 Spieler | Lokales Pass-and-Play mit Sichtschutz-Bildschirm |
| Online 1v1 | Echtzeit-Mehrspieler via Firebase (4-stelliger Raumcode) |

---

## Spielformate

| Format | Beschreibung |
|---|---|
| Einzel 1v1 | 1 Kugel je Spieler |
| Doppel 2v2 | 2 Kugeln je Spieler; jede Runde wird verdeckt eine gewählt |

---

## Implementierte Systeme

### Physik-Engine
- Velocitätsbasierte Integration, 2 Sub-Steps pro Frame
- Reibung (`FRICTION = 0.992`, `FEND = 0.992` bei Langsamfahrt)
- Kreisel/Drall (Magnus-Effekt) via zweitem Touch-Finger
- Elastische Kollisionsauflösung (Koeffizient `REST = 0.25`)
- Deterministische logische Spielfeldgröße (`LOGICAL = 1000`) für Netzwerk-Lockstep

### Bot-KI
- **Leicht:** Zufallswinkel ±60°, Zufallskraft
- **Mittel:** Heuristisch – Angriff oder Rückzug zur Mitte; leichtes Rauschen
- **Schwer (1v1):** Minimax-ähnlich via `simExchange` (650 Schritte), bewertet beste Gegner-Antwort
- **Schwer (2v2):** Minimax via `simSnap` (420 Schritte) + `bestRespN`

### Online-Multiplayer
- Firebase Realtime Database, Raumcode (4 Zeichen, alphanumerisch)
- Lockstep: beide Spieler committen ihre Züge; Physik läuft lokal identisch
- Zug-Validierung: `sanitizeMove()` klemmt deterministisch und idempotent an **beiden** Lockstep-Enden (Sender in `commit()`, Empfänger in `onlineTurnValue()`) — Vektorlänge ≤ `maxPull()`, Drall ∈ [−1, +1], Kugel-Index gegen Besitz validiert. Verhindert Velocity-Injection durch manipulierte Clients.
- Raum-Validierung beim Beitritt: pure Funktion `validateRoom()` prüft vor jeder State-Mutation `v` (Protokollversion), `config.winTarget` (3|5), `config.fmt` (single|double), `gen` (Safe Integer, 0–10 000) und die Präsenz-Map `p` (Host anwesend, Raum nicht voll; Firebase-Array-Form unterstützt). Ungültige Räume werden abgelehnt — keine stillen Defaults.
- Protokollversion: `ONLINE_PROTOCOL_VERSION` (Integer, aktuell 1) wird von `createRoom()` atomar als `v` in den Raum geschrieben; Beitritt nur bei exakter Übereinstimmung. **Bump-Regel:** +1 ausschließlich bei Änderungen an Online-Protokoll, Raum-Schema, Lockstep, Physik, Move-Daten oder simulationsrelevanter Logik — reine UI-/Grafik-/Menü-/Textänderungen bumpen nicht, damit sie Online-Matches nicht unnötig blockieren.
- Server-seitige Sicherheit (aktiv): `firebase.rules.json` (im Repo) erzwingt das Raum-Schema in der Realtime Database — publiziert und live-verifiziert (29/29 REST-Checks + Zwei-Tab-Match). Kernpunkte: Raumcode-Charset `[A-HJKMNP-Z2-9]{4}`; `v`/`config`/`created` nach Erstellung unveränderlich; sauberer Initial-Raum (gen 0, Host präsent, kein vorbefülltes `p/1` oder `g`), per `data.exists()`-Guard nur bei Erstellung geprüft (blockiert keine späteren Child-Writes); Host-Präsenz delete-only (`p/0` nach Verlassen nicht reaktivierbar); Züge write-once mit Wertegrenzen exakt wie `sanitizeMove` (idx 0–3, dx/dy ±195, sp ±1); Move-Writes nur für aktuelles `gen` (`$gen === gen + ''`); `gen` monoton (+1 oder idempotent gleich, 0–10 000); Presence mit 2-h-Join-Fenster; kein Root-Read → keine Raum-Enumeration. `created` nutzt `serverTimestamp()`, Rule `created === now` macht es server-autoritativ.
- **Ehrliche Sicherheitsgrenze:** Ohne Authentifizierung schützen die Rules **nicht** vor Sabotage durch jemanden, der den Raumcode kennt (Gastslot belegen, strukturell gültige Züge schreiben, `gen`+1 auslösen). Sie verhindern nur ungültige Struktur/Werte, Überschreiben committeter Daten, Room-Overwrite und Enumeration. Identitätsschutz erfordert Auth + App Check (nachgelagert, siehe TODO).
- Disconnect-Handling via `onDisconnect().remove()`
- Rematch durch Generationszähler (`gen` in Firebase)

### Rendering
- Goldene Arena: radiale Gradienten, konzentrische Ringe, Kompassrose, Innenmedaillon
- Kristallrand mit animiertem Goldglühen (3 Lagen, Puls)
- 4 animierte Fackelhalter außerhalb der Arena
- Optional: externes Bild `arena.jpg` statt Vektor-Arena (aktuell auskommentiert)
- Kugeln: 3D-Sphären-Gradient, Rim-Light, Bewegungsspur, Randwarnung
- Slingshot-Vorschau: gestrichelte Linie, Drall-Trajektorie (70 Schritte), Kraftanzeige in %
- Enthüllungspfeile nach dem Commit

### Partikel-System
- Spawn bei Start, Treffer und Ring-Out
- Hintergrund-Flash bei Treffer (`bgPulse`)

### Replay-System
- Frame-für-Frame-Aufzeichnung aller Physikzustände (max. 6 000 Frames)
- Wiedergabe mit Pause / Vor / Zurück (30-Frame-Sprünge), Geschwindigkeit 1× / ½× / ¼×
- Seek-Balken

### Sound (prozedural, Web Audio API)
- Ladeton (kontinuierlich, wächst mit Zugstärke)
- Abschuss, Treffer, Ring-Out, Rundensieg, Matchgewinn

---

## Spielfeld-Mechaniken

- **Arenaschrumpfung:** Nach jeder Runde schrumpft der Ring um 3 %, maximal auf 80 % der Ausgangsgröße
- **Verdecktes Zielen (2-Spieler / Doppel):** Sichtschutz-Bildschirm zwischen den Zügen
- **Stehen bleiben:** Aktions-Button um ohne Schuss zu passen
- **Rundenanzahl:** Best-of-3 oder Best-of-5 (wählbar)

---

## Dateistruktur

```
Ringout/
  index.html     # Gesamte Spiellogik, UI, CSS, JS (~1 088 Zeilen)
  CLAUDE.md      # Contributor-Richtlinien und Coding Standards
  PROJECT.md     # Dieses Dokument – aktueller Projektstand
  ROADMAP.md     # Langfristige Ziele und geplante Features
  TODO.md        # Offene Aufgaben nach Priorität
  CHANGELOG.md   # Abgeschlossene Änderungen mit Datum
```

---

## Bekannte Einschränkungen

- Firebase API-Key liegt im Klartext im Quellcode (kein Build-System für Env-Variablen)
- Gesamter Code in einer einzigen HTML-Datei – kein Modul-Split
- Keine automatisierten Tests
- Synchrone Bot-Simulation im UI-Thread (Hard-Bot kann auf schwachen Geräten kurz stocken)
- Kein PWA-Manifest / kein Offline-Support
- UI ausschließlich auf Deutsch – keine Lokalisierung vorhanden
