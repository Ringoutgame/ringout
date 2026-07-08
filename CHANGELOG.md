# CHANGELOG.md — RingOut

Alle abgeschlossenen Änderungen am Projekt, neueste zuerst.

---

## [Unreleased]

### Fixes
- fix: Online-Leave-/Disconnect-UX verbessert (M7-T1a, akzeptiert) — Vorbereitung auf den privaten Playtest: (1) Gegner-Disconnect zeigt beim verbleibenden Spieler jetzt ein Overlay „Gegner hat den Raum verlassen." mit ↩-Menü-Rückweg (Rematch/Replay ausgeblendet, 🔌 statt 🏆) statt nur eines 2,2-s-Toasts — kein Hängenbleiben in der Sackgasse; `gameOver()` stellt das normale Sieg-Overlay wieder her. (2) ☰-Button fragt bei laufendem Online-Match jetzt per Bestätigungs-Overlay „Online-Match verlassen?" (Abbrechen/Match verlassen) nach, statt still den Raum zu verlassen; „Match verlassen" nimmt denselben sauberen Leave-Pfad wie ein Disconnect (`leaveOnline()`: Presence-Remove → Gegner-Overlay), „Abbrechen" berührt Firebase nicht. Alle Exit-Pfade (Tab schließen, ☰, End-Overlay-Menü) laufen einheitlich über Presence-Remove. Kein Protocol-Bump, keine Firebase-Änderung, keine Physik-/Sound-/Grafikänderung; 3D und `?r2d=1` verifiziert (2026-07-08)

### Features
- feat: Offline-Physics-Tuning-Harness (M5-T1, akzeptiert) — URL-Flag `?tune=br:28,fend:0.9895,stopv:0.12` (validiert & geklemmt: br 20–40 ‰, fend 0.980–0.992, stopv 0.05–0.20) für lokale Sizing-/Ice-Feel-Playtests mit sichtbarem TUNE-Badge; wirkt über `curFE()`/neuen `curST()`-Wrapper/BR-Override. Online hart blockiert bei aktivem Tune (`openOnline`/`createRoom`/`joinRoom` → Toast „Tuning aktiv — Online deaktiviert") — getunte Werte erreichen Lockstep/Firebase nie. Default ohne Flag bit-identisch (Golden 13/13 ohne `--update`, nur `curST`-Stub in der Test-Env). Neu `tools/tune_compare.js`: 5 Szenarien Ist- vs. Tune-Werte über die echte extrahierte Sim (Frames, Weg, Auslauf nach SLOWV, Ringout). Keine finalen Physikwerte, kein Protocol-Bump, keine Firebase-Änderung (2026-07-08)

### Fixes
- fix: 3D-Aim-Zuverlässigkeit + Overlay-Clipping — Aim-Start prüft jetzt eine Screen-Space-Zone am projizierten Kugelmittelpunkt (mind. 52 CSS-px bzw. Silhouette×1.4, nächste eigene Kugel gewinnt) statt Welt-Distanz am Ray-Bodenpunkt, der bei flacher Kamera/Zoom/Randlage die sichtbare Kugel verfehlte; Zug jetzt relativ zum Griffpunkt (kein Phantom-Offset beim Antippen). `#cv`-Overlay ist im 3D-Modus viewport-groß — Aim-Pfeil und Prozentzahl werden an der Arena-Außenkante nicht mehr abgeschnitten; Principal Point bleibt am Wrap-Zentrum verankert, UI-Buttons behalten per z-index Vorrang, Drall-Empfindlichkeit unverändert am Wrap-Quadrat kalibriert, Kamera-Drag funktioniert jetzt auch außerhalb des Arena-Quadrats. 2D ohne Flag pixel-identisch (2026-07-08)

### Features
- feat: 3D-Renderer ist jetzt Standard (M4-T4, akzeptiert) — `R3D_WANTED` invertiert: ohne URL-Flag lädt der 3D-Modus; `?r2d=1` erzwingt den unveränderten 2D-Pfad; `?r3d=1` bleibt kompatibel (No-Op, alte Links funktionieren). Fallback unverändert: jeder 3D-Fehler (CDN/three, WebGL, HDRI, GLB) → Toast + 2D-Modus. `?perf=1` funktioniert in beiden Modi (in 2D ohne GLB-/HDRI-Zeilen). Einzeiler-Änderung + Kommentar-Updates; kein Protocol-Bump, keine Firebase-/Physik-/Sound-/Designänderung (Golden 13/13, Mapping 31/31, Bestand 82/82). Sichtprüfung bestanden: Default 3D, `?r2d=1` 2D, Handy Portrait, Bot-Runde, Kamera/Zielen/Ringout (2026-07-08)
- feat: Audio & Ball Feel Polish (M4-T3, akzeptiert) — WebAudio-Sound-Pass ohne Assets: Murmel-Kollisions-Klick via Modal-Synthese (Kontakt-Transient + inharmonische Teiltöne + tiefer Körper; Aufprallstärke koppelt Lautstärke/Helligkeit/Tonhöhe, leichte Zufalls-Verstimmung pro Hit), Roll-Sound pro Ball (wiederverwendete Loop-Rausch-Voices, Geschwindigkeit steuert Gain/Filter, keine Allokationen pro Frame, still bei Stillstand/Mute/Replay), Lade-/Zieh-Sound als dezentes tiefes „Strain"-Rauschen statt Sirenen-Ton, Ringout = Kanten-Kontakt + leiser Wind (Gliss-„Plopp" entfernt), dezenter Wind-Drop für nicht-entscheidende Falls. Spam-Schutz (70 ms Paar-Cooldown, 30 ms global, max. 8 Hit-Voices, Minimal-Stärke stumm) und sicherer Mobile-Unlock (Start-Button + erster `pointerdown`). **3D-Visuals (`?r3d=1`):** 2D-Konfetti/Farb-Flash ersetzt durch dezente Kontakt-FX (Licht-Glint + perspektivisch projizierter Impuls-Ring bei Kollisionen, Staub-Puffs beim Ringout/Fall); Aim-Overlay „luxury minimal" — nur der eigene Aim sichtbar (keine Reveal-/Gegner-Pfeile), dünner Anthrazit-Strahl mit feiner Chevron-Spitze und hellem Saum, freistehende editorial Prozentzahl mit Doppel-Pass-Halo (kein Chip, kein Power-Ring). 2D ohne Flag pixel-identisch; keine Physik-/Firebase-/Protokoll-Änderung (Golden 13/13 unverändert grün) (2026-07-08)

### Fixes
- fix: Mobile-Portrait-Framing-Bug im 3D-Modus (`?r3d=1`) behoben (M4-T2b, akzeptiert) — `#cv3d` hatte keine CSS-Größe; `renderer.setSize(…, false)` setzt nur die Backing-Auflösung (Viewport × DPR), wodurch das Canvas auf Geräten mit DPR > 1 (Handys) in intrinsischer Größe größer als der Bildschirm renderte → Arena nur als Ausschnitt sichtbar, Zielen verschoben. Fix: `width:100%;height:100%` in der `#cv3d`-CSS-Regel; Desktop (DPR 1) pixelidentisch. Kamera-Mathematik war korrekt (Portrait-Fit für 360×800/390×844/412×915 numerisch verifiziert). Mapping-Suite um statischen Regressions-Check erweitert (31 Fälle). Sichtprüfung Handy bestanden: Arena vollständig sichtbar, 60 FPS (Min 60), GLB ~1 555 ms, HDRI ~118 ms (2026-07-08)

### Tooling
- chore: Performance-Monitor `?perf=1` im Hauptspiel (M4-T2b) — FPS (500-ms-Mittel), Min-FPS über 10 s, bei `?r3d=1` zusätzlich GLB-/HDRI-Ladezeit; ohne Flag komplett inert (kein DOM-Element, kein Overhead). Portiert vom Prototyp-Monitor (2026-07-08)

### Features
- feat: 3D-Render-Adapter fürs Hauptspiel hinter `?r3d=1` (M4-T2, akzeptiert) — three.js-Layer im Prototyp-Look (GLB-Arena, HDRI-Himmel, Wolkenmeer, ferne Insel, Vignette) als Vollbild hinter der UI; **2D bleibt Standard/Fallback** (ohne Flag unverändert, jeder Lade-/WebGL-Fehler fällt sauber auf 2D zurück). Feste geneigte Basiskamera mit **bewegbarer Spieler-Kamera** (Drag außerhalb der Aim-Zone = drehen, Pinch/Mausrad = Zoom, Doppeltipp = Reset, Damping; Aim-Zone hat Vorrang, während Zielen keine Kamera und umgekehrt); `?r3d=1&orbit=1` = reiner Showcase-Modus mit deaktiviertem Zielen. Input via Raycasting/`s2w` (Ray-Ebene-Schnitt), Overlays punktweise per `w2s` projiziert — beides über pure, Node-getestete Mathematik (`tools/test_r3d_mapping.js`, 30 Fälle: Round-Trip <1e-6, P2-Spiegelung, Shift/Bob, freie Kamera; `localPt`-2D byte-identisch). **Ringout-Kante = sichtbare Außenkante** (Skalierung `R/10.1` auf die GLB-Randweg-Kante, Leuchtring/Warnzone/Goldrahmen dort); Kristalle/Sockel im Spiel-Renderer entfernt (Gameplay-Lesbarkeit, Asset unverändert); Kugeln als polierte Murmeln ohne Labels (Erkennung über Farbe/HUD); kosmetische Fall-Animation: Kugel driftet mit letztem Schwung über die Kante, fällt mit Gravity, rollt und verschwindet in den Wolken (rein lesend). Renderer schreibt nie Spielzustand; keine Physik-/Größen-/Protokoll-/Firebase-Änderung (2026-07-07)

### Tests
- test: Golden-Physik-Regressionssuite (M4-T1) — `tools/test_physics_golden.js` extrahiert die echten Simulationsfunktionen (`stepSim`, `simExchange`, `simSnap` + Konstanten) aus `index.html` und vergleicht 13 deterministische Referenzfälle bit-exakt gegen `tools/golden_physics.json` (inkl. Frame-30-Checkpoints, Ring-Out-Toleranz, Decisive-Ball-Logik, Spin/Magnus, Langsamfahrt-Regime, 2v2-Pile-ups, geschrumpfte Arena). Empfindlichkeit bewiesen: FRICTION+1e-7 lässt 13/13 Fälle fehlschlagen. Sicherheitsnetz vor der 3D-Render-Integration; `--update` nur für beabsichtigte Physikänderungen (dann mit Protocol-Bump) (2026-07-07)

### Tooling
- chore: Performance-Monitor für den 3D-Arena-Prototyp — FPS (500-ms-Mittel), Min-FPS über 10 s, GLB-/HDRI-Ladezeit; nur über URL-Parameter `?perf=1` sichtbar, ohne Flag komplett inert; keine Design-/Asset-Änderung. **Mobile-Performance-Test bestanden:** Handy 60 FPS (Min 60), GLB ~1 964 ms, HDRI ~957 ms; PC >150 FPS (2026-07-07)

### Visual
- feat: akzeptierter 3D-Arena-Visual-Prototyp (Stand final) — `prototype3d.html` mit Blender-/GLB-Asset-Pipeline: `assets/arena_platform.glb` (36 MB, vollständig eigenständig, 9 eingebettete PBR-Maps, Clearcoat/Transmission/Texture-Transform-Extensions) wird per Skript `tools/build_arena_platform.py` headless aus Blender 4.4 generiert; CC0-Assets (ambientCG Marble012/Rock030, Poly Haven stone_brick_wall_001 + 2 Puresky-HDRIs). Look: helle Marmor-Tempelplattform im Golden-Hour-Himmel, versenkte Gold-Inlays, Kristall-Sockel mit Marmor-Fassung, gestufter Tempel-Unterbau, dreiteilige Gameplay-Grenze (Randzone + Leuchtring + Goldrahmen). Gameplay-Sizing für 4–5 Spieler: Spielfläche +44 % (Radius ×1,2 via `PLAY_SCALE`), Kugeln −6,5 %; Kamera-Tilt auf faire ~62° geklemmt; alle Partikel-/Staub-Effekte entfernt. Roh-Texturen (66 MB) und `.blend`-Master bewusst nicht im Repo (`.gitignore`), re-generierbar per Skript + dokumentierten CC0-Downloads. Keine Integration ins Hauptspiel (2026-07-07)
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
