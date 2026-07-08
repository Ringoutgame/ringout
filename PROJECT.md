# PROJECT.md — RingOut

**Zuletzt aktualisiert:** 2026-07-08

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
| Tests | Golden-Physik-Regressionssuite (`tools/test_physics_golden.js`, 13 bit-exakte Fälle) + Logik-Suiten (sanitize/validateRoom/lockstep) |
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
- **Online 2v2 (M6-T1, manuell verifiziert 2026-07-08):** Doppel-Format läuft über denselben Lockstep — Move trägt `idx` seit M1, Rules erlauben idx 0–3 und `config.fmt` `'double'`. Zwei-Tab-Test bestanden (Create/Join, je 2 Kugeln, verdeckte Kugelwahl, Reveal, synchrone Simulation, Ringout, Rundensieg, 3D-Default). Keine Codeänderung, kein Protocol-Bump, keine Firebase-Änderung nötig.
- Zug-Validierung: `sanitizeMove()` klemmt deterministisch und idempotent an **beiden** Lockstep-Enden (Sender in `commit()`, Empfänger in `onlineTurnValue()`) — Vektorlänge ≤ `maxPull()`, Drall ∈ [−1, +1], Kugel-Index gegen Besitz validiert. Verhindert Velocity-Injection durch manipulierte Clients.
- Raum-Validierung beim Beitritt: pure Funktion `validateRoom()` prüft vor jeder State-Mutation `v` (Protokollversion), `config.winTarget` (3|5), `config.fmt` (single|double), `gen` (Safe Integer, 0–10 000) und die Präsenz-Map `p` (Host anwesend, Raum nicht voll; Firebase-Array-Form unterstützt). Ungültige Räume werden abgelehnt — keine stillen Defaults.
- Protokollversion: `ONLINE_PROTOCOL_VERSION` (Integer, aktuell 1) wird von `createRoom()` atomar als `v` in den Raum geschrieben; Beitritt nur bei exakter Übereinstimmung. **Bump-Regel:** +1 ausschließlich bei Änderungen an Online-Protokoll, Raum-Schema, Lockstep, Physik, Move-Daten oder simulationsrelevanter Logik — reine UI-/Grafik-/Menü-/Textänderungen bumpen nicht, damit sie Online-Matches nicht unnötig blockieren.
- Server-seitige Sicherheit (aktiv): `firebase.rules.json` (im Repo) erzwingt das Raum-Schema in der Realtime Database — publiziert und live-verifiziert (29/29 REST-Checks + Zwei-Tab-Match). Kernpunkte: Raumcode-Charset `[A-HJKMNP-Z2-9]{4}`; `v`/`config`/`created` nach Erstellung unveränderlich; sauberer Initial-Raum (gen 0, Host präsent, kein vorbefülltes `p/1` oder `g`), per `data.exists()`-Guard nur bei Erstellung geprüft (blockiert keine späteren Child-Writes); Host-Präsenz delete-only (`p/0` nach Verlassen nicht reaktivierbar); Züge write-once mit Wertegrenzen exakt wie `sanitizeMove` (idx 0–3, dx/dy ±195, sp ±1); Move-Writes nur für aktuelles `gen` (`$gen === gen + ''`); `gen` monoton (+1 oder idempotent gleich, 0–10 000); Presence mit 2-h-Join-Fenster; kein Root-Read → keine Raum-Enumeration. `created` nutzt `serverTimestamp()`, Rule `created === now` macht es server-autoritativ.
- **Ehrliche Sicherheitsgrenze:** Ohne Authentifizierung schützen die Rules **nicht** vor Sabotage durch jemanden, der den Raumcode kennt (Gastslot belegen, strukturell gültige Züge schreiben, `gen`+1 auslösen). Sie verhindern nur ungültige Struktur/Werte, Überschreiben committeter Daten, Room-Overwrite und Enumeration. Identitätsschutz erfordert Auth + App Check (nachgelagert, siehe TODO).
- Disconnect-Handling via `onDisconnect().remove()`
- **Leave-/Disconnect-UX (M7-T1a, 2026-07-08):** Gegner-Weggang (Tab zu, ☰-Leave, End-Overlay-Menü) zeigt dem verbleibenden Spieler ein Overlay „Gegner hat den Raum verlassen." mit ↩-Menü-Rückweg; ☰ verlässt ein laufendes Online-Match nur nach Bestätigungs-Overlay („Abbrechen"/„Match verlassen") und nimmt denselben Leave-Pfad wie ein Disconnect (Presence-Remove). Kein stiller Exit, kein Protocol-Bump, keine Firebase-Änderung.
- Rematch durch Generationszähler (`gen` in Firebase)
- **Rematch/Disconnect-Smoke (M6-T1b, manuell verifiziert 2026-07-08):** Rematch in 1v1 und 2v2 beidseitig synchron (Format bleibt erhalten, Score/Runde resetten sauber), Gast- und Host-Disconnect mit korrektem Verhalten des verbleibenden Spielers, neuer Raum danach ohne Alt-Zustand. Keine Codeänderung, kein Protocol-Bump, keine Firebase-Änderung.

### Rendering (Pseudo-3D mit Kamera)
- **Kameramodell (rein lokal, nie synchronisiert):** orthografische Projektion — Ebene um `camYaw` rotiert, y mit `cos(camPitch)` gestaucht, Höhe hebt um `h·sin(camPitch)`. Yaw frei (Drag auf leerer Fläche), Pitch geklemmt 0–0.61 rad. Input über exakte Inverse (`camUnproj`) → Zielen unter jedem Winkel fair. Alter Online-P2-Spiegel = Kamera-Default Yaw=π.
- **Render-Pipeline:** Himmel (gebackene Textur, Parallaxe) → Plattform (Schlagschatten auf Wolken, zweistufige Zylinder-Wand, gebackene Marmor-Bodentextur unter Kameratransform, Eisglow-Rand, exakte Grenz-Ellipse, 8 Kristall-Sockel) → Ebenen-Overlays unter einer Kameratransform (Partikel, Auswahl, Kugel-Schatten/Trail/Randwarnung, Drall-Vorschau) → Screen-Space (Pfeile, Sling, Kugel-Billboards tiefensortiert).
- **Texturen einmalig gebacken** (`bakeSky`, `bakeFloor`) → pro Frame nur `drawImage`; zugleich der geplante Rendering-Perf-Cache.
- Kugeln: Billboards (immer rund), satter Sphären-Gradient, glossy Spitzlicht + Nebenreflex, Boden-Gegenlicht, Rim-Light, aufrechtes Label
- 4 animierte Fackelhalter außerhalb der Arena
- Optional: externes Bild `arena.jpg` statt Vektor-Arena (aktuell auskommentiert)
- Kugeln: 3D-Sphären-Gradient, Rim-Light, Bewegungsspur, Randwarnung, weicherer/klar definierter Bodenschatten (Kern + weicher Rand)
- Slingshot-Vorschau: gestrichelte Linie, Drall-Trajektorie (70 Schritte), Kraftanzeige in %
- Enthüllungspfeile nach dem Commit

### Partikel-System
- Spawn bei Start, Treffer und Ring-Out
- Hintergrund-Flash bei Treffer (`bgPulse`)

### Replay-System
- Frame-für-Frame-Aufzeichnung aller Physikzustände (max. 6 000 Frames)
- Wiedergabe mit Pause / Vor / Zurück (30-Frame-Sprünge), Geschwindigkeit 1× / ½× / ¼×
- Seek-Balken

### Sound (prozedural, Web Audio API — M4-T3)
- **Murmel-Kollision via Modal-Synthese:** Kontakt-Transient + inharmonische Teiltöne + tiefer Körper; Aufprallstärke koppelt Lautstärke/Helligkeit/Tonhöhe, leichte Zufalls-Verstimmung pro Hit
- **Roll-Sound:** eine wiederverwendete Loop-Rausch-Voice pro Ball (Lowpass + Gain folgen der Geschwindigkeit, pro Frame nur `setTargetAtTime`, keine Allokationen); nur in Phase `sim`, still bei Stillstand/Mute/Replay
- Laden/Ziehen als dezentes tiefes „Strain"-Rauschen (bewusst kein Ton-Sweep), Abschuss, Ringout (Kanten-Kontakt + Wind, ohne Gliss), Wind-Drop (nicht-entscheidender Fall), Rundensieg, Matchgewinn
- **Spam-Schutz:** 70 ms Cooldown pro Kugelpaar, 30 ms global, max. 8 Hit-Voices, Minimal-Stärke stumm; geteiltes 1-s-Rausch-Buffer für alle Effekte
- **Mobile-Unlock:** AudioContext lazy + `resume()`, zusätzlich Unlock am Start-Button und beim ersten `pointerdown`

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
  index.html         # Gesamte Spiellogik, UI, CSS, JS
  prototype3d.html   # Isolierter Three.js-Visual-Spike (KEINE Integration, keine Spiel-Logik)
  firebase.rules.json# Server-seitige RTDB-Regeln (publiziert)
  CLAUDE.md          # Contributor-Richtlinien und Coding Standards
  PROJECT.md         # Dieses Dokument – aktueller Projektstand
  ROADMAP.md         # Langfristige Ziele und geplante Features
  TODO.md            # Offene Aufgaben nach Priorität
  CHANGELOG.md       # Abgeschlossene Änderungen mit Datum
```

### 3D-Render-Adapter im Hauptspiel — Standard-Renderer (M4-T2, seit M4-T4 Default)
- **Aktivierung:** 3D ist Standard (seit M4-T4); `?r2d=1` erzwingt den unveränderten 2D-Pfad, `?r3d=1` bleibt kompatibel (nicht mehr nötig). Jeder Fehler (CDN/three, WebGL, HDRI, GLB) → sauberer Fallback auf 2D mit Toast. `?orbit=1` = Showcase (Zielen deaktiviert). Kein Protocol-Bump, keine Firebase-/Physikänderung — der Renderer bleibt rein lesend.
- **Architektur:** three.js (CDN-Importmap, dynamischer Import nur bei Flag) rendert Vollbild hinter der UI; das 2D-Canvas bleibt transparentes Overlay + Input-Fläche. Szene in LOGICAL-Einheiten; Renderer **liest** Spielzustand (`balls`, `R`, `phase`, `outBall`), schreibt nie.
- **Kamera:** feste geneigte Basis (Prototyp-Richtung 0,19,27), Spieler-steuerbar mit Damping: Drag außerhalb der Aim-Zone dreht (Yaw frei, Polar 0.3–1.15), Pinch/Mausrad zoomt (0.75–1.5×), Doppeltipp = Reset; Online-P2 blickt von der Gegenseite. Aim-Zone (Greifradius um eigene Kugel) hat immer Vorrang; während Zielen keine Kamera, während Kamera kein Aim.
- **Mapping:** pure Funktionen `r3dCamMath` (`w2s` Projektion / `s2w` Ray-Ebene-Schnitt) inkl. Principal-Point-Shift (Arena über dem Spielbereich) und Schwebe-Bob (`py`); Node-Suite `tools/test_r3d_mapping.js` (31 Fälle, Round-Trip <1e-6, P2-Spiegelung, freie Kamera, `#cv3d`-CSS-Check); `localPt`-2D-Zweig byte-identisch.
- **Mobile (M4-T2b, bestanden):** `#cv3d` braucht zwingend `width:100%;height:100%` im CSS — `renderer.setSize(…, false)` setzt nur die Backing-Auflösung (×DPR); ohne CSS-Größe rendert das Canvas auf DPR>1-Geräten größer als der Viewport (Arena abgeschnitten). Statischer Regressions-Check in der Mapping-Suite. Performance-Monitor `?perf=1` jetzt auch im Hauptspiel (FPS, Min-FPS 10 s, bei `?r3d=1` GLB-/HDRI-Ladezeit; ohne Flag inert). Gemessen (Handy, Portrait): 60 FPS (Min 60), GLB ~1 555 ms, HDRI ~118 ms.
- **FX & Aim-Overlay (M4-T3, akzeptiert):** Im 3D-Modus keine 2D-Konfetti/Farb-Flashes — stattdessen dezente Kontakt-FX (`fx3`: Licht-Glint + perspektivisch auf die Bodenebene projizierter Impuls-Ring bei Kollisionen, Staub-Puffs beim Ringout/Fall). Aim-Overlay „luxury minimal": nur der eigene Aim sichtbar (keine Reveal-/Gegner-Pfeile), dünner Anthrazit-Strahl mit feiner Chevron-Spitze und hellem Saum, freistehende Prozentzahl mit Doppel-Pass-Halo — kein Chip, kein Power-Ring. 2D ohne Flag pixel-identisch.
- **Input & Overlay (M5-T1-Fix):** Aim-Start über Screen-Space-Zone am projizierten Kugelmittelpunkt (mind. 52 CSS-px bzw. Silhouette×1.4, nächste eigene Kugel; Zug relativ zum Griffpunkt — kein Phantom-Offset). `#cv`-Overlay ist im 3D-Modus viewport-groß (`body.r3d #cv{position:fixed;inset:0}` + Resize-Zweig), damit Aim-Pfeil/Prozentzahl am Arena-Rand nicht geclippt werden; Principal Point bleibt am Wrap-Zentrum, Header/Status/Botbar liegen per z-index über dem Canvas, Drall bleibt am Wrap-Quadrat kalibriert.
- **Ringout-Wahrheit:** GLB-Skalierung `R/10.1` legt die Simulationsgrenze exakt auf die sichtbare Randweg-Außenkante (Leuchtring + Warnzone + Goldrahmen dort); Kristalle/obere Sockel werden im Spiel-Renderer beim Laden entfernt (Lesbarkeit; Asset/Prototyp unverändert); Kugeln = polierte Murmeln ohne Labels; kosmetische Fall-Animation (Schwung-Drift über die Kante, Gravity, Roll-Rotation, verschwindet in den Wolken — rein lesend).

### Golden-Physik-Suite (Sicherheitsnetz vor der 3D-Integration)
- `tools/test_physics_golden.js` + `tools/golden_physics.json`: 13 deterministische Referenzfälle über die **echten** Simulationsfunktionen (`stepSim`, `simExchange`, `simSnap`, per Extraktion aus `index.html`), bit-exakter Vergleich inkl. Frame-30-Checkpoints. Läuft via `node tools/test_physics_golden.js`; `--selftest` beweist Empfindlichkeit (FRICTION+1e-7 → 13/13 rot). **Regel:** Vor und nach jedem Eingriff in `index.html` (insb. 3D-Render-Adapter) muss die Suite grün sein; `--update` ausschließlich bei beabsichtigten Physikänderungen zusammen mit `ONLINE_PROTOCOL_VERSION`-Bump.

### Offline-Tuning-Harness (M5-T1)
- URL-Flag `?tune=br:28,fend:0.9895,stopv:0.12` (validiert & geklemmt: br 20–40 ‰, fend 0.980–0.992, stopv 0.05–0.20) für lokale Sizing-/Ice-Feel-Playtests; sichtbares TUNE-Badge; wirkt über `curFE()`/`curST()`/BR-Override.
- **Online hart blockiert** bei aktivem Tune (`openOnline`/`createRoom`/`joinRoom`) — getunte Werte erreichen Lockstep/Firebase nie; Default ohne Flag bit-identisch (Golden 13/13 ohne Update).
- `tools/tune_compare.js`: feste Szenarien Ist- vs. Tune-Werte über die echte extrahierte Sim (Frames, Weg, Auslauf nach SLOWV, Ringout). Finale Werte werden erst in M5-T2 fest eingebaut (dann Goldens `--update` + Protocol-Bump v2 + Rules-Republish).

### 3D-Visual-Prototyp (`prototype3d.html`) — Stand AKZEPTIERT
- **Pipeline:** `tools/build_arena_platform.py` generiert headless (Blender 4.4, `D:\Blender\blender.exe`) das eigenständige `assets/arena_platform.glb` (36 MB, alle PBR-Maps eingebettet). CC0-Quellen: ambientCG (Marble012, Rock030), Poly Haven (stone_brick_wall_001, 2 Puresky-HDRIs). Roh-Texturen/`.blend` nicht im Repo (`.gitignore`) — regenerierbar per Skript + Spec-Downloads (`BLENDER_ASSET_SPEC.md`).
- **Look:** helle Marmor-Tempelplattform im Golden-Hour-HDRI-Himmel, versenkte Gold-Inlays, Kristall-Sockel mit Marmor-Fassung, gestufter Unterbau mit Pfeilern, ruhiges Wolkenmeer; bewusst keine Partikel-Effekte (Gameplay-Klarheit).
- **Gameplay-Sizing:** Spielfläche +44 % via `PLAY_SCALE = 1.2` (Einzeiler-Tuning), Kugeln r 0,58; dreiteilige Grenze (Randzone + Leuchtring + Goldrahmen); Kamera-Tilt geklemmt (~62°) für faire Lesbarkeit; ausgelegt auf 4–5 Spieler (Playtest mit echter Physik steht aus).
- **Fallbacks:** Ohne Server/Internet (file://) läuft die prozedurale Arena; HDRI-Kette kloofendal → qwantani → prozedural. Lokaler Test: `python -m http.server 8000`.
- **Performance (gemessen, bestanden):** Handy 60 FPS (Min 60 über 10 s), GLB-Ladezeit ~1,96 s, HDRI ~0,96 s; PC >150 FPS. Eingebauter Monitor nur über `?perf=1` (FPS, Min-FPS, Ladezeiten) — ohne Flag inert.
- **Abgrenzung:** Keine Integration ins Hauptspiel. `index.html`, Physik, Lockstep, Online, Replay, Firebase vollständig unberührt. Spätere Integration = reiner Render-Adapter über der unveränderten 2D-`LOGICAL`-Physik.

---

## Bekannte Einschränkungen

- Firebase API-Key liegt im Klartext im Quellcode (kein Build-System für Env-Variablen)
- Gesamter Code in einer einzigen HTML-Datei – kein Modul-Split
- Keine automatisierten Tests
- Synchrone Bot-Simulation im UI-Thread (Hard-Bot kann auf schwachen Geräten kurz stocken)
- Kein PWA-Manifest / kein Offline-Support
- UI ausschließlich auf Deutsch – keine Lokalisierung vorhanden
