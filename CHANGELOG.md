# CHANGELOG.md — RingOut

Alle abgeschlossenen Änderungen am Projekt, neueste zuerst.

---

## [Unreleased]

### Sicherheit / Kosten
- fix: Room-Cleanup v1 — leere Firebase-Räume werden jetzt automatisch entfernt, statt dauerhaft (inkl. Move-Historie) liegenzubleiben. `firebase.rules.json` erlaubt **additiv** das Löschen eines ganzen Raums, aber **nur** wenn kein Seat `p/0…p/4` mehr präsent ist (`data.exists() && !newData.exists() && …!== true`); Create-Regel, Überschreib-Verbot und das gesamte v2-Schema bleiben unverändert. `leaveOnline()` entfernt nach der eigenen Presence best-effort den ganzen Raum (`remove(rRef())` mit `.catch`) — sind andere Seats besetzt, lehnt die Rule den Delete still ab, sodass **laufende 1v1/2v2/FFA-Matches unberührt** bleiben und der letzte sauber gehende Spieler den Raum abräumt. **Kein Protocol-Bump** (`ONLINE_PROTOCOL_VERSION` bleibt 2, rein additive Berechtigung, abwärtskompatibel), keine Gameplay-/Physikänderung. Verifikation: lokaler Runner 10/10 grün (Rules-Suite 59→70, +11 Delete-Fälle: leer erlaubt, je p/0–p/4 präsent blockiert, „playing" mit Seats blockiert, Overwrite/Non-Existent verboten), Fake-RTDB-Stub in `test_ffa_flow.js` spiegelt die Cleanup-Rule; **Live-REST-Verify nach Publish 67/67 grün** (Delete bei präsenten Seats abgelehnt, Delete bei leerem Raum erlaubt, Test-Räume automatisch abgeräumt). Residual: Crash/Tab-Close des letzten Spielers kann eine winzige leere Hülle hinterlassen (kein Move-Wachstum) — vollautomatischer Sweep bräuchte Cloud Functions/Blaze (bewusst verschoben) (2026-07-09)

### Tests
- test: CI-Extraktion line-ending-robust gemacht — auf Linux/LF (GitHub Actions) schlugen `ValidateRoom` und `FFA-Online-Prep` mit `SyntaxError: Unexpected token ';'` fehl, während lokal auf Windows/CRLF alles grün war. Ursache: aus `index.html` extrahierte Zeilen wie `const GEN_MAX=10000;   // …` enthalten einen Trailing-`//`-Kommentar; beim Zusammenbau mit `;` beendete auf Windows nur das mitgefangene CRLF-`\r` den Kommentar, auf LF fehlte es → der Kommentar verschluckte das folgende `function validateRoom…`. Neuer gemeinsamer Extractor `tools/extract.js` (`loadIndexHtml()` normalisiert alle Zeilenenden auf `\n`, `grab()`); beide betroffenen Suiten nutzen ihn jetzt und fügen Snippets ausschließlich per Zeilenumbruch statt `;` zusammen. Die newline-getrennten Suiten (`test_ffa`, `test_physics_golden`, `test_lockstep`, `test_ffa_flow`) waren nie betroffen und bleiben unverändert. Lokaler Runner nach dem Fix 10/10 grün; da der Loader auf LF normalisiert, testet der lokale Lauf jetzt exakt den CI-Pfad. Keine index.html-/Physik-/Rules-/Asset-Änderung (2026-07-09)
- ci: GitHub-Actions-Workflow `.github/workflows/tests.yml` führt bei jedem `push`, `pull_request` und manuell (`workflow_dispatch`) automatisch `node tools/run_all_tests.js` aus — checkt Repository aus, richtet Node 20 ein und lässt die 10 Offline-Suiten laufen. **Kein `npm install`** (die Suiten nutzen ausschließlich Node-Built-ins `fs`/`path`/`os`/`child_process`, es gibt keine `package.json`/Lockfile). CI ist ein **reiner Sicherheitscheck** — kein Build, kein Deployment, kein Firebase-Zugriff. **Live-REST-Verify bleibt bewusst manuell** und läuft nie in CI (`tools/rest_verify_v2.js` schreibt in die Live-DB, nur mit `--live`). Lokaler Runner vor dem Commit grün (10/10). Keine Code-/Physik-/Rules-/Asset-Änderung (2026-07-09)
- test: vollständige lokale Test-Batterie ins Repo gerettet + zentraler Runner — die zuvor nur im flüchtigen Scratchpad liegenden Suiten sind jetzt versioniert unter `tools/`: `test_syntax.js`, `test_sanitize.js`, `test_validateroom.js`, `test_lockstep.js`, `test_ffa.js`, `test_ffa_online.js`, `test_ffa_flow.js`, `test_rules.js` sowie das Live-Skript `rest_verify_v2.js`. Alle Pfade sind repo-relativ (`path.join(__dirname, '..', …)`, Konvention wie `test_physics_golden.js`), `index.html` wird nur read-only extrahiert; `test_syntax.js` legt seine temporären `.mjs`-Blöcke jetzt in `os.tmpdir()` statt neben sich ab. Neuer **zentraler Runner `tools/run_all_tests.js`** führt alle 10 Offline-Suiten als Kindprozesse aus, druckt pro Suite genau eine kompakte Zeile, gibt bei Fehlschlag die volle Ausgabe der betroffenen Suite aus und liefert Exit-Code 1, sobald eine Suite fehlschlägt (sonst 0). **Live-REST-Verify bleibt bewusst manuell:** `rest_verify_v2.js` läuft nicht im Runner und bricht ohne `--live`-Pflichtflag sofort mit Exit 2 ab, ohne die Datenbank zu berühren. Verifikation: alle Suiten einzeln und über den Runner grün (Syntax OK, Golden 13/13, Mapping 48/48, Sanitize 19/19, ValidateRoom 40/40, Lockstep 24/24, FFA-Kern 18/18, FFA-Online-Prep 40/40, FFA-Flow 46/46, Rules 59/59), Fehlererkennung des Runners mit Wegwerf-Suite bestätigt (FAIL + Exit 1), `--live`-Sperre bestätigt. CI bleibt ein separater Folge-Task. Keine Code-/Physik-/Rules-/Asset-Änderung (2026-07-09)
- test: Online-FFA-Live-Smoke bestanden (M8-T3e, akzeptiert) — auf https://ringoutgame.github.io/ringout/ mit 5 echten Spielern verifiziert: Lobby + Host-Start, alle Joins, Per-Seat-Ansicht (eigene Kugel vorne/unten), Last-Man-Standing, stabiles Match; 1v1/2v2 weiterhin stabil. **RingOut ist bereit für den kleinen privaten Playtest inkl. Online-FFA.** Bekannte v1-Grenzen bleiben: kein Reconnect, Sitzlücken blockieren den Lobby-Start, Rematch-„Geist" bei verlassenen Spielern möglich, noch kein öffentlicher Launch (Auth/App Check/Room-TTL ausstehend). Keine Code-/Firebase-Änderung (2026-07-09)

### Features
- feat: Online-FFA 2–5 Spieler aktiviert (M8-T3c inkl. Nachbesserung, akzeptiert) — die vier Blocker sind durch echte Flows ersetzt: Host erstellt ffa-Räume (`state:'lobby'`), Gäste joinen per Code über `claimSeat` (Write-once-Race, niedrigster freier Seat 1–4), **Live-Lobby** (Presence-Roster mit PCOLS-Kugeln, eigene markiert, n/5, Host-Start ab 2, Gäste „Warte auf Host…"). **Start-Gate statt Auto-Nachrücken:** Start nur bei lückenlos belegten Seats 0..n−1 (sonst „Warte auf freien Sitz / Spieler soll neu beitreten."); Host schreibt sequenziell `state:'playing'` → `seats:n` (kein Multi-Path-Update — die seats-Rule sieht sonst den neuen state nicht); ein einziger `seats`-Listener ist das synchrone Startsignal für Host und Gäste (Rules garantieren seats erst nach state); Claim-Race nach Host-Kopfzählung wird client-seitig sauber ausgeworfen (`myPlayer>=seats`). **Per-Seat-Ansicht `viewAngle()`:** jeder Seat 0–4 sieht die eigene Kugel vorne/unten (Rotation −seat·2π/N konsistent über Input `localPt`, 2D-Canvas, Kugel-/Power-Labels gegenrotiert, 3D-Kamera-Azimut); 1v1/2v2-Spiegelung exakt erhalten (P1 = π, exakter `2*cx-x`-Pfad), lokaler FFA unverändert (offline 0). **Last-Man-Standing online** über den bestehenden N-Spieler-Lockstep (`allAliveCommitted`, Eliminierte zuschauen mit Aim-Sperre „Du bist raus"). **FFA-Leave im Match = Elimination statt Match-Abbruch:** verbleibende Clients füllen den offenen Move-Slot des Verlassenen mit einem Stand-still-Sentinel (`idx!==seat`; Write-once-Rule als Schiedsrichter, echter Commit gewinnt) — alle Clients spielen mit identischen Moves aus der DB (deterministisch, kein Deadlock); am Sentinel erkennen alle den Leave und setzen die Kugel bei `beginReveal` hinter die Ringkante → normaler Ring-Out beendet Runde/Match korrekt (Toast „Spieler X hat das Match verlassen.", 2er-FFA hängt nicht, Host-Leave im Match ok, Rematch ab 2 Verbundenen). **1v1/2v2-Disconnect-Verhalten unverändert** (Leave beendet das Match); Lobby: Gast-Leave aktualisiert Roster, Host-Leave bricht für Gäste sauber ab; `mode`/`ffaN`-Menü-Restore nach Online. Keine Firebase-/Rules-Änderung, kein Protocol-Bump (v2), keine Physikänderung, kein stepSim-Eingriff, Goldens unangetastet. Tests: Golden 13/13 bit-exakt, Mapping 48/48 (localPt-Pin auf viewAngle-Kontrakt + 17 neue Checks „eigene Kugel unten" für N=2–5), Bestand 83/83, FFA 18/18, FFA-Online-Prep 40/40 (+14 Start-Gate), **neue Multi-Client-Flow-Suite 46/46** (Fake-RTDB mit v2-Rule-Verhalten: Lobby/Start/Lockstep mit 2–5 Clients, Leave-Elimination, Disconnects, Rematch, 1v1-Regression), Rules-Suite 59/59. Sichtprüfung Owner bestanden: 3/5 Spieler mit Per-Seat-Ansicht, Leave-Flows, 1v1/2v2-Regression inkl. Gast-Spiegelung, lokaler FFA, 3D-Default, `?r2d=1` (2026-07-09)

### Chore
- chore: Protocol-v2-Cutover für Online-FFA (M8-T3b, akzeptiert) — `ONLINE_PROTOCOL_VERSION` 1 → 2 zusammen mit der passenden `firebase.rules.json`-Erweiterung, **veröffentlicht und live REST-verifiziert (56/56 Checks)**: `config.fmt` erlaubt zusätzlich `'ffa'`; ffa-Räume nur mit `state:'lobby'` erstellbar (single/double weiterhin ohne `state`/`seats`); Einweg-Übergang `lobby→playing` nur mit mindestens einem Gast (`p/1`); `seats` (2–5) write-once nach dem Start; Seat-Claims `p/0`–`p/4` write-once und nur solange die Lobby offen ist (kein Join nach Start, Presence-Delete bleibt erlaubt); Moves für Seats 0–4 und `idx` 4 nur in ffa-Räumen. **Jede neue Bedingung ist auf `fmt==='ffa'` gegated — single/double-Validierung verhaltensidentisch** (neue lokale Rules-Engine-Suite 59/59 wertet die echten Rule-Strings gegen Write-Szenarien aus, Sensitivität per manipulierten Kopien bewiesen; REST-Regression bestätigt u. a. unverschärftes `p/1`). Online-FFA bleibt clientseitig **weiterhin deaktiviert** (vier Blocker aktiv). Live-Smoke auf Protocol v2 bestanden: 1v1, 2v2, Commit/Reveal, Rematch, Leave/Disconnect, 3D-Default, `?r2d=1`. Drei REST-Testräume verbleiben in der DB (7SNX, DDKU, 5CZ4 — Rules erlauben kein Löschen, später manuell in der Console entfernen). Ein späterer Physik-Tuning-Pass (M5-T2) würde auf v3 bumpen. Keine Physikänderung, Goldens unangetastet (2026-07-09)

### Features
- feat: Client-Vorbereitung Online-FFA (M8-T3a, akzeptiert) — Online-FFA bleibt **bewusst deaktiviert** (vier Blocker: FFA-Menü-Button, `createRoom`, `joinRoom`, Lobby-Start → Toast „Online-FFA kommt im nächsten Schritt."), aber der Client ist vorbereitet: `validateRoom` akzeptiert strukturell `fmt:'ffa'` (nur `state:'lobby'` + freier Seat 1–4; single/double-Pfad verhaltensidentisch), versteckte Lobby-UI mit Roster-Renderer (Seats 0–4 als PCOLS-Kugeln, Zähler n/5, Host-Start ab 2, Gäste „Warte auf Host…"), Seat-Claiming vorbereitet (`pickFreeSeat` + `claimSeat` mit Write-once-Race-Retry, noch unbenutzt), N-Spieler-Reveal-Helper `allAliveCommitted()` (Eliminierte zählen nicht) ersetzt beide `aimSet[0]&&aimSet[1]`-Stellen, Presence-/Turn-Listener von `opp=1-myPlayer` auf Seat-Schleifen generalisiert (für 2 Spieler äquivalent). Firebase-Rules, `ONLINE_PROTOCOL_VERSION` (=1, TODO-Kommentar für T3b-Bump) und Physik unverändert; golden_physics.json unangetastet. Neue Suite FFA-Online-Prep 26/26; Online 1v1/2v2 im Zwei-Tab-Test manuell geprüft und funktionsfähig (2026-07-09)
- feat: lokaler Free-for-All-Kern für 2–5 Spieler (M8-T2, akzeptiert) — neuer Hotseat-Modus „👥 FFA" (Spieleranzahl 2/3/4/5 wählbar): jeder Spieler eine Kugel, gleichmäßig im Kreis platziert, verdecktes Zielen reihum über den Cover-Screen, dann gleichzeitiger Schuss. **Last-Man-Standing-Rundenlogik:** Eliminierte bleiben draußen und werden beim Zielen übersprungen, die Runde läuft über mehrere Züge, bis nur ein Spieler übrig ist; Gleichzeitig-Out-Tiebreak deterministisch (am wenigsten weit draußen gewinnt); Matchsieg bei `winTarget` Rundensiegen (Default 3). **Zentrale Spielerfarben-Tabelle `PCOLS`** (Slots 0–4: Blau/Rot/Grün/Gelb/Schwarz; Slots 0/1 exakt die bisherigen Werte, schwarze Kugel mit silbernem Rim/Glow) speist 2D-Kugeln, Partikel, Slingshot/Pfeile, HUD, Cover und die 3D-Materialien (jetzt 5 statt 2). Kompaktes FFA-HUD als Chip-Leiste (Farbpunkt + Score, aktiver Spieler markiert, Eliminierte ausgegraut). `stepSim`-Rundenende verallgemeinert („≤1 Spieler mit lebenden Kugeln") — für 2 Spieler nachweislich bit-identisch (Golden 13/13 ohne `--update`; Harness extrahiert nur zusätzlich die `PCOLS`-Zeile). Der lokale FFA-Kern ist die technische Basis/der Testharness für den späteren Online-FFA (M8-T3+, noch offen). Kein Online-FFA, keine Firebase-Änderung, kein Protocol-Bump, keine Physikwerte geändert. Neue FFA-Logik-Suite 18/18 (3/5 Spieler, Eliminierung über mehrere Züge, Tiebreak, Runden-/Matchsieg, 2-Spieler-Äquivalenz); Regression manuell bestätigt (Bot, PvP 1v1/2v2, Online-Zwei-Tab, 3D + `?r2d=1`) (2026-07-08)

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
