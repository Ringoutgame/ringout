# PROJECT.md — RingOut

**Zuletzt aktualisiert:** 2026-08-27 (Arena Football: **Elimination startet mit fuenf Spielern** auf dem Broad Rounded Pentagon, Ablauf 5P → 4P → 3P → 2P → Sieger; **zwei Leben** in der Elimination, Classic auf der kanonischen Shouldered-Wide-Arena, **fester 60-Hz-Gameplay-Takt** unabhaengig von der Bildwiederholrate, neu abgestimmte Daempfung und dynamischere Abschusskurve; finale adaptive Elimination-Arenaformen — Rounded Square / Broad Rounded Triangle / Shouldered Wide; **beide** Arenawechsel 4→3 und 3→2 sind animiert und tragen Gold-Kantenfeedback plus Transitionsklang; **drei** sichtbare Modi — Classic 1v1 als Standard, Tactical 1v1, Elimination; Elimination ist jetzt regulaer ueber die Modusauswahl startbar, weiterhin lokal/Hotseat)

- **Aktueller stabiler Projekt-HEAD:** `5a23dc424fb3126c33c29543b7c6571b87a65ec7`
- **Implementierungs-Commit UX-Phase 3:** `babbbe78ee388489321d1f0cb3e032bbaabd0725`

---

## Was ist RingOut?

RingOut ist ein kompetitives, physikbasiertes Browser-Spiel für 1–5 Spieler. Jede Runde ziehen Spieler ihre Kugel wie eine Steinschleuder zurück und lassen sie los – wer den Gegner aus dem goldenen Rundring schleudert, gewinnt die Runde. Das Konzept ähnelt Sumo, gespielt mit Kugeln.

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
| Tests | Lokale Batterie unter `tools/`; der zentrale Runner `tools/run_all_tests.js` fasst **19 Offline-Suiten** zusammen — aktuell **14/19 grün**. Suite-für-Suite-Übersicht im Abschnitt „Teststand" unten. |
| CI | GitHub Actions (`.github/workflows/tests.yml`) führt bei `push`/`pull_request`/`workflow_dispatch` automatisch `node tools/run_all_tests.js` aus (Node 20, kein `npm install`). Reiner Sicherheitscheck — kein Build, kein Deployment, kein Firebase-Zugriff; Live-REST-Verify läuft nie in CI. |
| TypeScript | nein |
| UI-Sprache | Deutsch |

### Teststand

Stand: Arena-Finalisierung (2026-08-08), frisch gemessen mit
`node tools/run_all_tests.js`. Die Spalte „Assertions" nennt die Zahl aus der Suite-Ausgabe
(`N passed, M failed`); der Runner schlägt auch dann fehl, wenn die Zahl von der in
`run_all_tests.js` erwarteten abweicht.

| Suite | Datei | Assertions | Status |
|---|---|---|---|
| Syntax | `test_syntax.js` | kein Zähler (3 Blöcke geparst) | grün |
| Golden-Physik | `test_physics_golden.js` | 13/0 | grün |
| Football-Shell | `test_football_shell.js` | 818/0 | grün |
| Football-Flow | `test_football_flow.js` | 148/0 | grün |
| Football-Arena | `test_football_arena.js` | 61/0 | grün |
| Football-Tactical | `test_football_tactical.js` | 243/0 | grün |
| Football-Elim | `test_football_elimination4.js` | 1229/0 | grün |
| Football-Elim5 | `test_football_elimination5.js` | 285/0 | grün |
| r3d-Mapping | `test_r3d_mapping.js` | 52/0 | grün |
| Sanitize | `test_sanitize.js` | 24/0 | grün |
| Identity | `test_identity.js` | 45/0 | grün |
| ValidateRoom | `test_validateroom.js` | 45/0 | grün |
| Lockstep | `test_lockstep.js` | 24/0 | grün |
| FFA-Kern | `test_ffa.js` | — (Abbruch: `ReferenceError: curRestBall is not defined`) | **rot** |
| FFA-Online-Prep | `test_ffa_online.js` | 53/0 | grün |
| FFA-Online-Flow | `test_ffa_flow.js` | — (Abbruch: `SyntaxError` beim Sandbox-Aufbau) | **rot** |
| FFA-Online-Race | `test_ffa_race.js` | — (Abbruch: `SyntaxError` beim Sandbox-Aufbau) | **rot** |
| Reconnect-B2 | `test_reconnect.js` | 7 Assertion-Fehler, danach `TypeError` | **rot** |
| Rules | `test_rules.js` | 174/0 | grün |
| Public-Lobby | `test_public_lobby.js` | 30/0 | grün |
| Team-Duel | `test_team_duel.js` | — (Abbruch: `ReferenceError: curRestBall is not defined`) | **rot** |

**Gesamt: 14/19 grün.** Die fünf roten Suiten (FFA-Kern, FFA-Online-Flow, FFA-Online-Race,
Reconnect-B2, Team-Duel) sind **bekannte, vorbestehende Altlasten** — Ursachen und Nachweis
siehe „Bekannte Einschränkungen" und `TODO.md` (P0). Die Arena-Football-Arbeit inklusive
UX-Phase 3 hat **keine neue Suite rot gemacht** und keine grüne Suite verschlechtert.

Nicht im Runner registriert, separat auszuführen:

| Suite | Aufruf | Assertions | Status |
|---|---|---|---|
| Ring-Collapse | `node tools/test_collapse.js` | 235/0 | grün |
| E2E FFA (5 Clients) | `npm run test:e2e:ffa` | — | braucht JDK-21-RTDB-Emulator + Playwright |
| E2E Spike | `npm run test:e2e:spike` | — | braucht JDK-21-RTDB-Emulator + Playwright |
| Live-REST-Verify | `node tools/rest_verify_v3.js --live` | — | bewusst manuell, nie in CI; sinnvoll erst nach dem v3-Publish |

Bei den E2E-Harnessen ist die Produktions-Firebase hart geblockt.

---

## Spielmodi

| Modus | Sichtbar im Menü | Beschreibung |
|---|---|---|
| ONLINE FFA | ✅ Flaggschiff (Default-Auswahl) | 2–5 Spieler via Firebase, Raum erstellen/Code teilen, Host startet ab 2 |
| ONLINE VERSUS | ✅ | **2 echte Spieler** via Firebase; CTA öffnet Format-Modal: 1v1 DUEL (`fmt='single'`, 1 Kugel/Spieler) oder 2v2 DUO DUEL (`fmt='double'`, 2 Kugeln/Spieler). Bewusst nicht „Team Battle" — reserviert für einen echten 4-Spieler-Modus |
| BOT TRAINING | ✅ | Spieler gegen Hard-Bot; CTA öffnet Format-Modal: 1v1 VS BOT oder 2v2 DUO VS BOT (`botMove()` routet fmt-abhängig auf `bot1v1`/`bot2v2`) |
| ARENA FOOTBALL | ✅ | **Lokal/Hotseat**, nie online. CTA öffnet die Modusauswahl (`#fbModeOv`, gleiche Modalstruktur wie das Bot-Format-Modal): **Classic 1v1** (Standard, hervorgehoben) oder **Tactical 1v1**. Details unten unter „Arena-Football-Modi" |
| 2 Spieler (Hotseat) | ❌ nur `?dev=1` | Lokales Pass-and-Play mit Sichtschutz-Bildschirm — als Testbasis erhalten |
| FFA lokal | ❌ nur `?dev=1` | 2–5 Spieler Hotseat (M8-T2) inkl. Spieleranzahl-Auswahl — Testbasis für Online-FFA |

**Premium-Hauptmenü (Playtest-UX-Redesign, 2026-07-09/10):** Menü nach Owner-Referenzbild — Titel mit Gold-Ornament, drei Modus-Karten mit SVG-Icons und Gold-Active-State, eine CTA mit modusabhängigem Label. **Hero = die echte 3D-Szene:** `initR3D()` läuft seit jeher beim Seitenladen und `loop()` rendert immer — das Menü ist im 3D-Modus transparent (`body.r3d #menu`, nur Lese-Verläufe), sodass HDRI-Himmel, Marmor-Plattform, Wolken und Goldring live sichtbar sind. Eigener Menü-Framing-Zweig in `frame()` (`menuVisible`-Flag: Plattform-Zentrum ~37 % Bildhöhe, `baseDist×0.87`; Gameplay-Framing/`r3dCamMath` unverändert). **Kugel-Preview je Modus über den echten Spawner:** Kartenwahl setzt `mode/fmt/ffaN` (wie früher die Menü-Pills) + `placeBalls()` — FFA 5 Kugeln, 2v2 2 blaue vs. 2 rote, Bot 1v1; CTA setzt die finalen Werte erneut. Ein Fake-Canvas-Hero wurde nach Owner-Review verworfen; `?r2d=1`/3D-Fehler → ruhiger Verlaufs-Hintergrund ohne Fake-Arena. **Boot-Flow:** HTML/CSS-Boot-Overlay ab dem ersten Paint; das Menü bleibt `visibility:hidden` und faded erst nach dem ersten gerenderten 3D-Frame ein (`finishBoot()` idempotent, ausgelöst von Loop-First-Frame, `?r2d=1`, initR3D-Fehler oder 10-s-Timeout). Alle Legacy-Modi sind **nicht gelöscht**, sondern im `#devPanel` hinter `?dev=1` (inkl. Runden-bis-Sieg- und Format-Auswahl); Regeln-Textbox vom Home entfernt.

**v1-Localization (2026-07-09):** ⚙-Settings-Modal im Hauptmenü mit Sprachwahl **EN (Default) / DE / TR**, persistiert in `localStorage` (`ringout_lang`), Live-Umschaltung via `applyLang()`. Zentrales `I18N`-Dictionary + `T(key)`. Abgedeckt: Hauptmenü, Settings, Online-Dialog-Grundtexte + Statusmeldungen, Leave-Bestätigung, End-Overlay-Buttons. **Bewusst Deutsch (testgebunden/v2):** validateRoom-Reasons, renderLobby-Hints, startFfaMatch-/Leave-Toasts, onLobbyClosed, onOppLeft (von Suiten hart asserted) sowie alle In-Game-Texte. Flow-Suite-Env enthält einen `T`-Identitäts-Stub.

---

## Spielformate

| Format | Beschreibung |
|---|---|
| Einzel 1v1 | 1 Kugel je Spieler |
| Doppel 2v2 | 2 Kugeln je Spieler; jede Runde wird verdeckt eine gewählt |

(FFA lokal hat immer 1 Kugel je Spieler; die Format-Auswahl ist dort ausgeblendet.)

---

## Implementierte Systeme

### Physik-Engine
- Velocitätsbasierte Integration, 2 Sub-Steps pro Frame
- Reibung (`FRICTION = 0.992`, `FEND = 0.992` bei Langsamfahrt)
- Kreisel/Drall (Magnus-Effekt) via zweitem Touch-Finger
- Elastische Kollisionsauflösung (Koeffizient `REST = 0.25`)
- Deterministische logische Spielfeldgröße (`LOGICAL = 1000`) für Netzwerk-Lockstep
- Dämpfung, Settlement und Restitution laufen seit der Arena-Football-Physik über die
  Accessoren `curFR()` / `curFE()` / `curST()` bzw. `curRestBall()` / `curRestBand()` /
  `curRestPost()`. Außerhalb von `mode === 'football'` liefern sie exakt die globalen
  Konstanten — alle Bestandsmodi rechnen unverändert weiter (Golden-Physik 13/13).

### Arena-Football-Modi (Classic 1v1 + Tactical 1v1 + Elimination)

Arena Football hat **drei sichtbare Produktmodi**. Classic und Tactical sind 1v1-Modi und
teilen die Tabelle unten; Elimination ist der Fuenf-Spieler-Modus und hat einen eigenen
Abschnitt. Beide laufen durch dieselbe Commit/Reveal-Pipeline
wie jeder lokale Hotseat-Modus: verdeckte Aim-Phase je Team (`openCover`), beide Seiten
committen, danach Reveal — `applyLaunch()` setzt **alle** Startgeschwindigkeiten vor
`setPhase('sim')`, es gibt also keinen Frame-, Microstep- oder Teamversatz.

| | Classic 1v1 (Standard) | Tactical 1v1 |
|---|---|---|
| Spielerfiguren je Spieler | 1 | 2 (`B1`/`B2` bzw. `R1`/`R2`) |
| Bodies gesamt | 3 | 5 (inkl. neutralem Ball) |
| Zuege je Team und Runde | 1 | 1 — das Team waehlt vorher, **welche** seiner beiden Figuren zieht |
| Nicht gewaehlte Figur | — | erhaelt keinen Startimpuls, bleibt aber vollstaendig kollidierbar |

**Umschaltung:** `fbVariant` (`'classic'`, `'tactical'` oder `'elimination'`) ist die einzige
Weiche; `fbTactical()` und `fbElim4()` sind die einzigen Konsumenten. Jeder andere Wert faellt
auf `'classic'` zurueck. `startFootball(variant)` ist der **einzige** Startpfad und clamped die
Variante zusaetzlich — alle drei Menuebuttons und der Dev-Direktlink laufen durch ihn. Der
vierte zulaessige Wert `'elimination4'` ist ein reiner Dev-Einstieg: `startFootball()` laesst
ihn nur mit aktivem `DEV_MENU` durch, kein Menuebutton verweist darauf.

**Sichtbare Modusauswahl** (`#fbModeOv`, dieselbe Modalstruktur wie das Bot-Format-Modal):
drei `.vopt`-Optionen in fester Reihenfolge — `CLASSIC 1V1` (als einzige mit `.vopt.rec`
hervorgehoben), `TACTICAL 1V1`, `ELIMINATION`. Jede Option startet direkt, ohne
Zwischenbildschirm und ohne zweite Bestaetigung. Dev-Direktlinks `?dev=1&fb=classic|tactical|elimination|elimination4`
ueberspringen das Modal; ein ungueltiger Wert (z. B. `fb=tactical-dual`) zeigt die Auswahl und
startet Classic.

**Tactical-Aufstellung** (`FOOTBALL_TACTICAL_SPAWN`, Einheiten in BR): offensive Figur
(±6.40, −2.80), tiefe Figur (±12.20, +4.60), Rot an der Mittelachse gespiegelt, Ball exakt im
Mittelpunkt. Die tiefe Figur steht ausserhalb der lichten Torbreite (`postInner` 3.560) — keine
Figur startet im Tor. Rollen entstehen ausschliesslich aus der Position, es gibt keine
Figurenklassen. **Auswahl-UX:** dezenter Bodenring in Teamfarbe (`FB_RING_SELECTABLE` 0.34 /
`FB_RING_SELECTED` 0.95, gewaehlte Figur zusaetzlich 1.10× groesser), keine dauerhaften Labels.
Hidden Information: waehrend der Aim-Phase traegt nur das Team am Zug einen Ring; im Reveal
sind die beiden gestarteten Figuren markiert.

**Physik, Arena, Tor, Score, Goal-FX und Goal-Sound sind in Classic und Tactical identisch** —
Tactical aendert ausschliesslich Bodyanzahl und Figurenwahl.

**Online:** Arena Football ist in **allen drei** Modi ein rein lokaler Modus. `mode='football'` wird
an genau zwei Stellen gesetzt: im Startpfad (`online=false`) und in der Menue-Vorschau, die bei
`online` sofort aussteigt. Online-Raeume tragen kein `mode`-Feld — Football ist ueber den
Lockstep-Pfad nicht erreichbar. Eine Online-Unterstuetzung fuer Tactical oder Elimination
(mehr Bodies im Snapshot, Owner-/Index-/Slot-Annahmen, Reconnect) ist **nicht** implementiert
und waere ein eigener Auftrag mit Protokollarbeit.

**Verworfen:** eine dritte Variante „Tactical Dual" (beide Figuren je Team gleichzeitig planbar)
wurde prototypisch gebaut und im Spieltest verworfen — unuebersichtlicher, deutlich defensiver,
weniger Tore. Sie ist vollstaendig aus dem Produktivcode entfernt; lokale Prototyp-Artefakte
liegen untracked unter `artifacts/football-tactical-dual-prototype/`.

---

### Arena-Football · Elimination (sichtbarer Produktmodus, 5 Spieler)

Dritte Football-Variante `fbVariant === 'elimination'`, als `ELIMINATION` regulaer ueber die
Modusauswahl startbar (`#fbElimBtn`). Classic bleibt der Standard und die einzige empfohlene
Option; Elimination wird bewusst **nicht** empfohlen. Der Dev-Direktlink
`?dev=1&fb=elimination` ueberspringt nur das Modal und fuehrt in denselben Startzustand.

Die Startspielerzahl steht an **einer** Stelle (`FOOTBALL_ELIM_START_PLAYERS = 5`); 4, 3 und 2
sind interne **Phasen** desselben Matches, keine eigenen Modi. Fuer Regressionstests der
spaeteren Phasen gibt es einen **Dev-Einstieg** `?dev=1&fb=elimination4`, der dieselbe
Elimination mit vier Startspielern beginnt. Er haengt am `DEV_MENU`-Guard und ist ueber die
sichtbare Modusauswahl nicht erreichbar.

**Regeln**
- 5 Spieler, je **eine** Figur, dazu **ein** neutraler Ball (6 Bodies).
- Verdecktes Commit fuer alle noch aktiven Spieler, danach **ein** gemeinsamer Reveal —
  alle aktiven Figuren starten simultan (derselbe `applyLaunch()`-Pfad wie Classic/Tactical).
- **Zwei Leben.** Jeder Spieler startet mit **2 Leben**. Ein Gegentor kostet **ein** Leben;
  entscheidend ist allein, **wessen Tor** ueberquert wurde (kein Schuetzen-, Vorlagen- oder
  Eigentorbegriff). Kein Timer, keine Gegentor-Punkte, kein Tiebreak.
  - **Erstes Gegentor (2 → 1):** ein normales Tor. Der Spieler bleibt aktiv, die Arena bleibt
    stehen, es gibt kein totes Tor, keinen Umbau, kein Transitions-FX und keinen
    Transitionsklang. Danach faire Neuaufstellung **aller** aktiven Figuren auf ihre
    kanonischen Spawns, Ball zentral, Geschwindigkeiten und Drall auf 0, neue verdeckte Runde.
  - **Zweites Gegentor (1 → 0):** der Spieler scheidet aus, ab hier greift die bestehende
    Eliminierungslogik unveraendert (Umbau 5 → 4, 4 → 3 bzw. 3 → 2, Sieg bei 2 → 1).
  - **Leben gelten fuer das ganze Match.** Ein Phasenwechsel fuellt sie ausdruecklich **nicht**
    auf: wer mit einem Leben ins Halbfinale kommt, spielt dort mit einem Leben. Nur der
    vollstaendige Matchreset (`fbElimReset`) stellt alle wieder auf 2.
  - **Anzeige:** zwei kleine Lebenspunkte im bestehenden Spieler-Chip der Elimination-Leiste —
    vorhandene Leben in der Spielerfarbe, verlorene matt. Keine zweite Tabelle, keine Zahl.
- Das Tor eines ausgeschiedenen Spielers wird physikalisch zur Bande und optisch als totes
  Tor dargestellt.
- Der letzte verbliebene Spieler gewinnt; nach dem entscheidenden Tor faellt kein neuer Ball.

**Adaptive Arena 5 → 4 → 3 → 2 → 1.** Die Arenaform folgt der Spielerzahl. Einzige Quelle sind
`FOOTBALL_ARENA_ELIM5/4/3/2`, ausgewaehlt ueber `fbArena()` aus der Phasentabelle
`FB_ELIM_ARENAS`; Physik, Renderer, Spawns und Kamera lesen dieselben Werte.

| Phase | Form | Ausdehnung | Eckradius | Tore | Spawnabstand |
|---|---|---:|---:|---|---:|
| 5 Spieler | Broad Rounded Pentagon | Apothem `19.50` | `3.50` | 5 × 72° | `12.75` |
| 4 Spieler | Rounded Square | `halfLen/halfWid 17.50` | `3.50` | 4 × 90° | `11.50` |
| 3 Spieler | Broad Rounded Triangle | Apothem `12.50` | `3.50` | 3 × 120° | `8.15` |
| 2 Spieler | Shouldered Wide | `15.60 × 11.60` | `2.60` | 2 gegenueber | `10.15` |

**Broad Rounded Pentagon (Startform).** Fuenf gleichwertige Torseiten im 72-Grad-Raster,
an den fuenf Spitzen gekappt — zehn Kernecken statt fuenf. Gebaut mit demselben
Halbebenenschnitt wie alle anderen Formen (`fbTruncPoly`, Kappfaktor `1.14`), also dieselbe
Konstruktion wie der Broad Rounded Triangle der Drei-Spieler-Phase. Die Kappung ist nicht
kosmetisch: sie senkt im Trajektorientest den Anteil aussen an der Bande kreisender Baelle
von 61.7 % (reines Fuenfeck) auf 52.9 %, bei gleicher Torquote und ohne Klemmstellen.
Flaeche 1 373 922 px² ≈ 274 784 px² je Spieler; Grenze reproduziert sich unter 72-Grad-Drehung
exakt (Abweichung ≤ 3.4e-13 px). Die lichte Torbreite bleibt in **allen** Phasen `227.84`.

**Spielerfarben im Football.** Football hat fuenf Spieler **plus** einen neutralen Ball und
braucht damit einen Farbslot mehr als die globale Tafel `PCOLS` (fuenf Eintraege, Slot 4 ist
das Dunkelgrau des fuenften RingOut-FFA-Spielers). Statt die globale Tafel zu erweitern legt
Football eine **eigene** Tafel darueber: `FB_PCOLS = [PCOLS0..3, Violett #c07bff, PCOLS4]`.
Slot 4 ist damit im Football der fuenfte Spieler, der neutrale Ball liegt auf Slot 5 und
behaelt exakt sein bisheriges dunkles Material. Einzige Abfrage ist `pcol(i)` (bzw. `ncol(i)`
fuer die Namenslabels); ausserhalb `mode === 'football'` liefert sie unveraendert `PCOLS[i]`.
Dieselbe Verschiebung tragen Farbname und Siegerueberschrift (`FB_COL_SLOT`, `colSlot4Name`,
`col5`/`.wt.w5`) — ein siegreicher Spieler 5 heisst VIOLETT, nicht GRAU. **Kein anderer Modus
aendert dadurch seine Farben.**

**Gameplay-Identitaet der drei Formen.** Die Formen sind nicht nur kleinere Varianten
voneinander, jede loest eine andere Spielsituation:

- **4 Spieler — Rounded Square.** Vier Tore im 90-Grad-Raster: Richtungsvielfalt und
  Multiplayer-Chaos. Alle vier Achsen sind gleichwertig, niemand hat eine Vorzugsrichtung.
- **3 Spieler — Broad Rounded Triangle.** Ein gleichseitiges Dreieck mit gekappten Spitzen:
  drei lange Torseiten fuer Bank-Shots, drei kurze Kappflaechen statt spitzer Ecken. Die
  120-Grad-Symmetrie haelt alle drei Spieler exakt gleich weit vom Ball und voneinander
  entfernt; die Kappung nimmt der Form die Ecken, in denen der Ball frueher aussen herumlief,
  ohne dass dafuer der Eckradius erhoeht werden musste.
- **2 Spieler — Shouldered Wide.** Ein breites Achteck: zwei lange Hauptbanden, zwei flache
  Torwaende und vier diagonale Schulterflaechen davor. Die Schultern geben einem aussen
  laufenden Ball eine dritte Wandnormale und damit einen neuen Anschlusswinkel — aus dem
  Aussenlauf entsteht seltener eine geschenkte Abschlussposition, dafuer gibt es mehr
  Single- und Double-Bank-Wege. Ein breites Skill-Duell mit komplexeren Rebounds.

Die Kernpolygone kommen aus zwei Generatoren (`fbTruncTri`, `fbShoulderRect`) ueber einen
gemeinsamen Halbebenenschnitt (`fbHalfPlanePoly`). Die Bandengrenze rechnet fuer sie ueber
`footballPolySD` (Abstand zum konvexen Kernpolygon minus Eckradius); Rechteck und Dreieck
behalten ihre bisherigen SDFs. Der Eckradius des Finales liegt bewusst bei `2.60` statt
`3.50` — bei `3.50` waere die Schulterflaeche kuerzer als die Boegen daneben und damit
wirkungslos.

**Framing:** `fbElimViewR()` waehlt je Phase das Maximum aus Deck-Aussenkante und aeusserstem
Grenzpunkt (746 / 539 / 600). Der erste Umbau macht das Bild deutlich enger; beim zweiten
zieht die Kamera wieder leicht auf, weil beim breiten Finale die Deckkante hinter den Toren
den Wert bestimmt — die Spielflaeche selbst bleibt dabei etwa gleich gross, pro Spieler ist
das Finale die grosszuegigste Phase.

Eine Torgeometrie bedient alle drei Phasen: `footballFold()` dreht einen Punkt in das
kanonische +X-Bezugssystem des naechstliegenden Tores. Ausserhalb von Elimination ist die
Faltung die Identitaet, der Classic-/Tactical-Pfad rechnet bitgenau wie zuvor.

Die Eckrundung ist gegenueber der ersten Prototypfassung deutlich reduziert (`9.00` → `3.50` BR).
Der gekruemmte Konturanteil liegt damit bei 16.4 % / 22.4 % / 16.5 % statt 45.4 % — der Ball
laeuft messbar weniger dauerhaft aussen herum. Es gibt **keine** kuenstliche Zentrumskraft,
keinen Zusatzimpuls und keine Physik-Retunes; die Verbesserung kommt ausschliesslich aus der
Geometrie (M1, Reibung, Restitution, Ballradius 25, Spielerradius 32, fester Zeitschritt,
CCD und lichte Torbreite 227.84 sind unveraendert).

**Arenawechsel 4 → 3 (Transition V3).** Der erste Umbau ist animiert: Start- und Endform
werden ueber ihre **Stuetzfunktion** interpoliert (Minkowski-Summe der Kernpolygone,
`fbEdgesFrom` / `fbMinkowski` / `fbMorphCore(s)` / `fbMorphRing`). Dadurch bewegt sich die
Wand in **jeder** Richtung monoton von ihrem Start- auf ihren Endwert — keine Zwischenform
knickt ein, keine wird groesser als der Start, kein Ueberschwingen. Dramaturgie in vier
Abschnitten (Hold 12, Tore 24, Arena 54, Settle 10 Ticks ≈ 1.67 s): die Tore werden zuerst
getrennt neu gesetzt, danach faehrt die Bande um; die Kamera steht dabei fest auf dem
Phase-4-Framing, Eingaben sind gesperrt und alle Koerper stehen still. Die Tore sitzen ueber
eine Sehnenkonstruktion (`fbRingChord`) auch waehrend des Umbaus vollstaendig auf dem Deck.

**Arenawechsel 3 → 2.** Derselbe Transitionspfad, nur mit anderer Ausgangs- und Zielform.
Er ist der schwierigere Fall, weil die beiden Formen weder dieselbe Eckenzahl noch denselben
Eckradius haben: **sechs Kernecken (rc 3.50) gegen acht (rc 2.60)**. Beides braucht trotzdem
keine Sonderlogik.

- **Eckenzahl 6 → 8:** Die Minkowski-Kombination fuehrt schlicht alle vierzehn Kanten-
  richtungen beider Kerne mit. Die jeweils fremden haben am zugehoerigen Ende Laenge 0 und
  wachsen linear — die vier Schulterflaechen entstehen dadurch stetig aus dem Nichts, und
  die nicht mehr benoetigte dritte Torseite zieht sich ebenso stetig auf 0 zurueck.
- **Eckradius 3.50 → 2.60:** wird im selben Fortschritt linear mitgefuehrt. Weil die
  Stuetzfunktion der abgerundeten Form `h = h_kern + rc` ist und `h_kern` exakt linear
  zwischen beiden Kernen interpoliert, ist `h` selbst exakt linear zwischen Start- und
  Endform. Gemessen ueber 201 Stufen x 720 Richtungen: **0 Gegenbewegungen, 0 Ueberschwingen**,
  beide Endzustaende exakt.

Dieselbe Dramaturgie wie bei 4 → 3: erst die Torneuordnung (die beiden Ueberlebenden fahren
auf dem kuerzesten Winkelweg auf ihre 180-Grad-Achsen, das ausgeschiedene Tor zieht sich
zurueck und die Bande schliesst sich dort), danach der Arenaumbau. Kamera fest, Eingaben
gesperrt, Koerper eingefroren; die Reihenfolge **Arena rastet ein → Figuren auf den
2P-Spawns → Ball faellt zentral → Commit** ist bindend. Der letzte Wechsel **2 → 1** ist der
Sieg und baut nicht mehr um.

**Praesentation der Umbauten.** Beide Transitionen tragen ein rein visuelles Feedback:

- Die vorhandene **Goldstruktur** der Arena ist der einzige Traeger. Sie ist in drei Stufen
  geteilt — Kante der Spielflaeche, Bandenlinie samt Bande, Aussenkante und Gesims — und
  jede Stufe ist EIN dauerhaft gehaltener Materialklon. Waehrend eines Umbaus wandert eine
  weiche Aktivierung von innen nach aussen durch diese drei Stufen; das transparente
  Bandenglas leuchtet nie selbst, Deck und Bande haengen dadurch an einem System.
- Am **exakten Arena-Lock** folgt ein kurzer Impuls (~0.15 s, quadratischer Abfall), der
  dieselben drei Stufen leicht versetzt durchlaeuft. Kein Bounce, kein Scale, kein Flash.
- Das **ausgeschiedene Tor** verliert seine Teamenergie schon waehrend der Torneuordnung —
  dieselbe Kurve, mit der es sich geometrisch zurueckzieht — statt am Ende hart in den
  neutralen Zustand umzuschalten. Die verbleibenden Tore bleiben unberuehrt.

Das Ganze ist **rein visuell**: die Intensitaet wird in jedem Frame aus dem bestehenden
Morph-Fortschritt abgeleitet, es gibt keinen eigenen Zustand und keinen Timer. Ausserhalb
einer Transition ist sie exakt 0, der Renderer schreibt dann die Ruhewerte zurueck und fasst
danach kein Material mehr an. Kein Einfluss auf Physik, Wertung, Eingabe, Ablauf oder Kamera;
Classic und Tactical kennen das Feedback nicht. Kein Partikelsystem.

**Ton der Umbauten.** Beide Transitionen tragen dieselbe Klangidentität, zusammengesetzt aus
genau zwei kurzen Assets: ein **Bett** für die Umbaubewegung (startet am Ende des Holds) und
ein **Einrastakzent** exakt auf dem Tick, an dem auch der visuelle Gold-Lock-Impuls beginnt —
beide Ticks werden aus denselben Morph-Konstanten abgeleitet, damit Bild und Ton nicht
auseinanderlaufen können. Der **Torsound bleibt der eigenständige Hauptakzent**: er ist
längst verklungen, bevor das Bett einsetzt (0,63 s Abstand), und liegt deutlich lauter.
Der letzte Wechsel 2 → 1 ist der Sieg und klingt nicht.

Technisch hängt das am bestehenden Audiosystem: derselbe AudioContext, dasselbe
`soundOn`-Gate, dieselbe Lade- und Voice-Mechanik wie beim Torsound (einmal laden, Buffer
wiederverwenden, Quellen nach dem Ende freigeben, Stop mit kurzem Fade bei Matchreset,
Menürückkehr, Moduswechsel und Stummschalten). Der Auslöser liest nur den Transitions-
fortschritt — kein eigener Zustand, kein Timer, kein Einfluss auf Physik, Wertung, Eingabe
oder Ablauf.

Beide Transitionen teilen sich **eine** Zeittabelle (Hold 12 / Tore 24 / Arena 54 / Settle 10
Ticks), **einen** Satz Bausteine und **einen** Plan (`fbMorphPlan` haelt Ausgangs- und
Zielphase). Es gibt keine zweite Morph-Engine und keine Sonderbehandlung nach Eckenzahl.

**Faire Startaufstellung nach jeder Eliminierung.** Ueberlebende behalten ihre Positionen
**nicht**. Ablauf: Tor faellt → Spieler scheidet aus → Arena wechselt auf die neue Geometrie →
alle Ueberlebenden stehen auf den symmetrischen Spawns der neuen Phase → alle Velocities 0 →
Ball faellt zentral von oben ein → neuer Hidden-Commit-Zyklus. Arenawechsel und Aufstellung
passieren im selben Anweisungsblock (`fbElimApplyPhase`), der Renderer sieht nie eine neue
Arena mit alten Positionen.

Es gibt **eine** geometrische Spawnregel (`fbElimSpawnX/Y(slot)`): die Figur auf Torslot `s`
steht auf der Achse ihres eigenen Tores im Abstand `spawn * BR` vom Zentrum. `placeBalls()`
benutzt fuer die Startaufstellung dieselben Helfer — Matchstart und Respawn koennen nicht
auseinanderlaufen. Daraus folgen ohne Sonderfaelle gleiche Zentrumsdistanz, gleiche Distanz
zum eigenen Tor und garantierter Abstand zu Ball, Bande, Torkorridor und den anderen Figuren.

**Torzuordnung:** die aktiven Spieler-IDs werden aufsteigend sortiert und in dieser Reihenfolge
auf die Slots `0..n-1` gelegt (`fbElimSlots`) — deterministisch, keine Permutation, kein Zufall.

**Menuetexte:** `ELIMINATION` mit dem Kurztext `4 SPIELER · 1 GEGENTOR = RAUS` (DE),
`4 PLAYERS · CONCEDE ONCE = OUT` (EN), `ELİMİNASYON` / `4 OYUNCU · 1 GOL YE = ELEN` (TR).

**Status:** lokal / Hotseat. **Online ist nicht implementiert** und waere ein eigener Auftrag
(mehr Bodies im Snapshot, Owner-/Slot-Annahmen, Reconnect, Protokollarbeit). Da die
Modusauswahl ausschliesslich aus dem lokalen Football-Pfad geoeffnet wird (`startFootball()`
pinnt `online=false`, Online-Raeume tragen kein `mode`-Feld), kann Elimination nie in einem
Online-Kontext ausgewaehlt werden.

Regressionssuiten: `tools/test_football_elimination5.js` (Produktmodus mit fuenf Startspielern,
im Runner als `Football-Elim5`) und `tools/test_football_elimination4.js` (Dev-Einstieg mit vier
Startspielern, deckt die Phasen 4 → 3 → 2 ab; im Runner als `Football-Elim`).

---

### Arena-Football-Arena · Classic (final: Shouldered Wide)
**Classic 1v1 und das Elimination-Finale sind geometrisch dasselbe Spiel** — zwei Figuren,
zwei gegenueberliegende Tore auf der ±X-Achse, ein neutraler Ball. Sie teilen sich deshalb
**dieselbe Objektinstanz**: `FOOTBALL_ARENA_CLASSIC = FOOTBALL_ARENA_ELIM2`
(`15.60 × 11.60 BR`, Eckradius `2.60`, Spawn `10.15`, achteckiges Kernpolygon mit vier
35°-Schultern). Es gibt keine zweite Beschreibung derselben Form; Bande, Torachse,
Toroeffnung und Spawnabstand koennen damit nicht auseinanderlaufen. **Matchregel bleibt
First to 3** (`FOOTBALL_WIN_SCORE = 3`, genau eine Pruefstelle).

**Tactical 1v1 bleibt unveraendert** auf der aelteren Rounded-Rectangle-Arena
`FOOTBALL_ARENA` (siehe unten) — Arena, Spawns und Regeln sind dort abgestimmt.

### Arena-Football-Arena · Tactical (Rounded Rectangle B)
Die Football-Spielflaeche ist seit 2026-08-07 ein **Rounded Rectangle** (die fruehere
Kreisarena ist kein Produktpfad mehr). Einzige Quelle der Wahrheit fuer Physik,
Rendering, Spawns und Kamera ist `FOOTBALL_ARENA` (Werte in BR = 32 logische Einheiten):

- **Masse:** Innenlaenge **1152** (`halfLen 18.00`), Innenbreite **812.8**
  (`halfWid 12.70`, Verhaeltnis 1.417:1), Eckradius **219.2** (`corner 6.85`,
  27 % der Innenbreite). Spawnabstand `spawn 7.65` (±244.8), Ball exakt im Mittelpunkt.
- **Grenze:** `footballShapeSD` (Signed Distance + Aussennormale; gerade Segmente,
  exakte Eckboegen, C1-stetige Uebergaenge, keine Polygonnaeherung) und
  `footballBoundSD(b)` (um `ballRad(b)` nach innen versetzt). `corner == halfLen ==
  halfWid` reproduziert exakt den alten Kreis — es gibt keine zweite Grenzgeometrie.
- **Tor (buendig):** gerades Torasset `assets/arena_football_goal.glb`
  (1 Blender-Einheit = 2·BR). Sockelkanten tangential 3.560..5.282 BR → lichte
  Torbreite **227.84**; `postFront == halfLen` legt die Sockelvorderkante exakt auf
  die Bandeninnenflaeche → keine Ballfang-Tasche, der Sockel ist aus dem Feld heraus
  unerreichbar (Mindestabstand exakt ein Ballradius). Torlinie bei `postBack 20.368 BR`
  (= 651.776); `goalAnchor` mittig im Sockel. Spieler werden an der Oeffnung von der
  Grenze geblockt (`footballCanPassGoal` nur fuer den neutralen Ball, mit explizitem
  Stirnseiten-Term `|x−cx| > |y−cy|`).
- **Neutraler Ball:** `FOOTBALL_BALL_RADIUS = 25` (Spieler bleiben BR = 32).
  `ballRad(b)` ist die einzige Radiusquelle fuer Physik UND Rendering (Kontaktdistanz,
  Bandengrenze, Pfosten, Toroeffnung, Torlinie, Anti-Wedge, Mesh-/Decal-Scale,
  Bodenhoehe, Rollwinkel). Tor/Durchmesser-Verhaeltnis ≈ 4.56.
- **Rendering:** Spielflaeche, Randweg, Sockel, Bodenmarkierungen und transparente
  Bande entstehen **prozedural** (`fbBuildShape`) aus denselben `FOOTBALL_ARENA`-
  Parametern wie die Physikgrenze; die Materialien (Glas/Gold/Marmor) kommen
  unveraendert aus `assets/arena_football_band.glb`, das nur noch als
  **Materialquelle** geladen wird. Die runde Plattform wird im Football-Modus
  vollstaendig ausgeblendet. Kamera-Framing rechnet mit `fbHalfLen()/fbHalfWid()`.
- Herkunft/Vergleichsdaten der Prototypphasen (Arena A/B/C, Movement M1–M3,
  Ballgroessen B0–B3): lokale, nicht committete Artefakte unter
  `artifacts/rounded-rectangle-prototype/`, `artifacts/football-movement-prototype/`,
  `artifacts/football-ball-size-prototype/`.
- Tests: `tools/test_football_arena.js` (Regressionssuite des finalen Standes).

### Arena-Football-Zeitbasis (fester 60-Hz-Gameplay-Takt)
Gameplay lief frueher **genau einmal pro Renderframe** und haengte damit an der
Bildwiederholrate: auf einem 120-Hz-Display simulierte das Spiel doppelt so schnell wie auf
60 Hz — Geschwindigkeit, Daempfung, Auslauf, Torablauf, Arenaumbau und Commit-Aufloesung.
Die Hauptschleife trennt jetzt sauber:

- **Rendern** weiterhin so oft, wie das Display hergibt (`requestAnimationFrame`).
- **Rechnen** in festen Schritten: `simAdvance(now)` akkumuliert die verstrichene ECHTE Zeit
  und fuehrt daraus 0..N feste Gameplay-Schritte aus. `SIM_HZ = 60`,
  `SIM_DT_MS = 1000/60`. `stepSim()` behaelt seine **zwei** internen Micro-Steps →
  unveraendert **120 Physik-Micro-Steps/s**.
- `simStep(now)` enthaelt alles Zustandsfortschreibende (Physik, Torablauf, Rundenende,
  Replayaufzeichnung, tickgezaehlte Partikel/FX). Reine Ausgabe bleibt im Renderframe.
- **Catch-up-Budget** `SIM_MAX_STEPS = 5` je Renderframe; bleibt danach Rueckstand, wird er
  verworfen statt angehaeuft (kein Aufschaukeln). Eine Luecke groesser `SIM_STALL_MS = 250`
  gilt als **Pause**: genau ein Schritt, kein Zeitraffer. `visibilitychange` loescht
  zusaetzlich den Zeitanker.
- **Keine variable-dt-Physik:** `stepSim()` nimmt keinen Zeitparameter und liest keine Uhr;
  die verstrichene Zeit steuert ausschliesslich, WIE OFT der feste Schritt laeuft.
- Gemessen bei 30/60/90/120/144 Hz: identischer Zustandshash, identische Streckenlaenge,
  identischer Settlement-Schritt, identischer Abschussimpuls. Test:
  `tools/test_fixed_timestep.js`.
- Die Online-Rehydrierung rechnet einen Zug weiterhin am Stueck zu Ende
  (`while(phase==='sim')stepSim()`) und braucht dafuer weder Akkumulator noch Uhr.

### Arena-Football-Abschusskurve
Der Zug wurde frueher **streng linear** in Geschwindigkeit umgesetzt (`v = Zuglaenge·LAUNCH`):
ein 55-%-Zug lieferte exakt 55 % Tempo und war spielerisch fast wertlos — der Ball erreichte
die gegnerische Gefahrenzone gar nicht mehr. Die Kurve hat deshalb zwei Formparameter:

```
v = Zuglaenge · LAUNCH · FB_LAUNCH_SCALE · t^(FB_LAUNCH_CURVE − 1),  t = Zuglaenge / maxPull
FB_LAUNCH_SCALE = 1.26      FB_LAUNCH_CURVE = 0.98      LAUNCH = 0.034 (unveraendert)
```

`FB_LAUNCH_SCALE` hebt die Kurve als Ganzes, `FB_LAUNCH_CURVE < 1` hebt zusaetzlich die
**Mitte** staerker als die Spitze — genau die Zone, die sich zu zaeh anfuehlte. Gegenueber der
linearen Kurve: 100 % +26.0 %, 75 % +26.7 %, 55 % +27.5 %, 50 % +27.7 %. Die Reihenfolge
bleibt streng monoton, ein voller Zug bleibt mit Faktor 1.80 klar staerker als ein 55-%-Zug,
kleine Zuege bleiben moeglich. Zugklemmung (`maxPull = R0·0.40`) und Totzone (`BR·0.4`) sind
unveraendert. **Eine** Stelle rechnet Zug in Tempo um (`fbLaunchMul`) — Maus und Touch laufen
beide dort durch; ausserhalb Football bleibt es bei der linearen Basis.

### Arena-Football-Physik
Football-spezifische Physik, **ausschließlich** in `mode === 'football'` wirksam.
Einziger Zugriffspunkt ist `footballPhys()`; liefert die Funktion `null`, gilt das
bisherige Verhalten. Es gibt bewusst **keine Preset-Auswahl, keinen Debug-Schalter und
keinen URL-Parameter** — Produktionsphysik hängt nicht von der Adresszeile ab.

- **Wertesatz** `FOOTBALL_PHYS`: Spieler `friction 0.9958`, neutraler Ball
  `frictionBall 0.9964` (**getrennte** Spieler-/Ball-Daempfung), Auslauf `slowv 0.70` /
  `fend 0.9760` · `fendBall 0.9790`, Settlement `stopv 0.075`, Restitution
  `restBall 0.44` · `restBand 0.60` · `restPost 0.50`. Die Stellschrauben laufen bewusst
  gegenlaeufig: lebendige schnelle Gleitphase, aber frueh und hart beendeter Kriechauslauf.
  Gemessen (freies Ausrollen, Maximalschuss): Spielerfigur **5.7 s**, neutraler Ball
  **4.9 s** bis zum Stillstand, davon nur rund **0.8 s** unterhalb `slowv`. Accessoren:
  `curFRBall()` / `curFEBall()` / `curSLOWV()` zusaetzlich zu den bestehenden.
- **Settlement setzt exakt auf 0.** Sobald alle Kugeln unter `stopv` liegen, werden im
  Football Geschwindigkeit **und** Drall auf exakt 0 gesetzt. Ohne diesen Schritt bliebe eine
  Restgeschwindigkeit stehen — die Football-Kugeln ueberleben den Rundenwechsel als dieselben
  Objekte, das Mikrokriechen liefe also in der naechsten Runde weiter, und die Ruhelage waere
  nur asymptotisch. Ausserhalb Football ist der Pfad bitgenau der bisherige.
- **Iterative Kontaktauflösung** `FOOTBALL_CONTACT_ITERATIONS = 3`: dieselben Formeln in
  derselben Reihenfolge, nur mehrfach. Integration, Dämpfung und Spin laufen weiterhin
  genau einmal pro Micro-Step; Treffer-Feedback nur im ersten Durchgang.
- **Getrennte Restitution nach Kontaktart** statt einer gemeinsamen Konstante;
  `restBand > restPost > restBall`.
- **Deterministische Wedge-Erkennung + Anti-Wedge-Escape** gegen tote Mehrfachkontakte:
  feste benannte Schwellen, feste Kandidatenliste für die Fluchtrichtung, reine
  Umlenkung der vorhandenen Geschwindigkeit; nur im Stillstand ein eng begrenzter
  Mindest-Escape (`FOOTBALL_ESCAPE_MIN_V = 0.12` px/Micro-Step). Kein Zufall, keine
  Zeitabhängigkeit → lockstep-tauglich.
- **Kein Massenmodell**, keine Maximalgeschwindigkeit, `LAUNCH` unverändert.
- Messnotiz mit allen Zahlen und der Herleitung:
  `artifacts/football-physics-audit/README.md`.
- Tests: `tools/test_football_shell.js` (Struktur, Werte, Abgrenzung, Auslauffenster,
  Abschusskurve) und `tools/test_football_flow.js` (Wirkungsmessung gegen die
  Vergleichsmodelle CURRENT und ICE, die **nicht produktiv** sind).

### Arena-Football-UX (Phasen 1 bis 3, im Browser freigegeben)
Implementierungs-Stand: HEAD `babbbe78ee388489321d1f0cb3e032bbaabd0725`
(UX-Phase 1 `e162c51`, UX-Phase 2 `c4c9135`, UX-Phase 3 `babbbe7`).

**Spielfeld**
- Keine Namenslabels über den Football-Kugeln. Der neutrale Ball ist damit auch
  semantisch klar: `pName(owner 4)` hatte ihn als „Spieler 5" beschriftet, obwohl er
  keinem Spieler gehört.
- Die Tore sind farblich zugeordnet — jedes trägt die Farbe der Mannschaft, die es
  **verteidigt**: **blaues Tor bei −X**, **rotes Tor bei +X**. Das ist spiegelbildlich zur
  Wertung (`footballGoalSide`: Durchtritt bei +X = Punkt für Blau) und passt zur
  Startaufstellung (Blau links, Rot rechts).
- Getragen wird die Zuordnung von drei Akzenten aus Bauteilen, die bereits im Asset
  stecken: farbige Torlinie im Randweg (Breite und Bogen aus `footballGoalClearHalf()`
  abgeleitet), Emblem-Inset `AF_Goal_Emblem` und ein dezenter Schimmer auf der vorderen
  Gold-Keyline. Adressiert über den **Objektnamen**, weil alle Goldteile dasselbe Material
  teilen. Marmor, Glas, Torform und GLBs sind unverändert.

**Match-HUD**
- Kompaktes Score-Panel: **BLAU links · Score zentral · ROT rechts**, darunter der
  Untertitel **`ERSTER BIS 3`**.
- Score-Reaktion beim Tor ist **rein visuell** (460 ms Skalierung der geänderten Ziffer),
  ohne Rückwirkung auf die Wertung. In UX-Phase 3 wurde daraus ein Gold-Impuls, der in die
  Teamfarbe zurückfällt, ergänzt um den Panel-Schimmer — siehe „Goal-Feedback" unten.
- Bewusst nicht vorhanden: sekundäre Statuswörter („zielt…"/„bereit" sind im Football
  ausgeblendet), Matchstart-Hinweis (gebaut und nach dem Browsertest wieder zurückgebaut)
  und die alte Statuszeile der Integrations-Shell. Die echte Fehlermeldung
  „3D-Szene nicht verfügbar" bleibt erhalten — sie meldet einen nicht spielbaren Zustand.

**Architektur und Abgrenzung**
- Das HUD liest ausschließlich das bestehende `score[]` und nutzt die bestehende
  Statusleiste (`#card0` | `.scorebox` | `#card1`) — **keine zweite Score-Engine**.
- Die First-to-N-Anzeige nimmt die Zahl ausschließlich aus `FOOTBALL_WIN_SCORE`; die
  i18n-Einträge `fbFirstTo` (de/en/tr) enthalten nur den Platzhalter `{n}`. Angezeigt wird
  die deutsche Fassung, weil die gesamte In-Game-Ebene deutsch ist und `LANG` ohne
  gespeicherte Auswahl auf `'en'` fällt — die globale Sprachlogik ist unangetastet.
- CSS und Verhalten sind vollständig football-gescoped: jede HUD-Regel hängt an
  `#game.fb`, die Kugellabels sind über `mode!=='football'` übersprungen. Eine Assertion
  prüft das Scoping maschinell über den gesamten CSS-Block.
- Andere Modi und das Result-Overlay sind unverändert. Keine Änderung an Physik,
  Gameplay, Kamera, Beleuchtung, GLBs oder Netzwerk.

**Goal-Feedback (UX-Phase 3)**
- Beim bestätigten Tor wird der **getroffene** Torbereich kurz aktiviert. Beteiligt sind
  genau die drei bereits farbig gefassten Bauteile aus Phase 1: **Emblem**, **vordere
  Gold-Keyline** und **Torlinie** — letztere trägt zugleich den Öffnungs-/Walkway-Akzent.
- **Gold ist der Premium-Trefferimpuls** (`GOAL_FX_GOLD = 0xffd79a`, Spitzenanteil
  `GOAL_FX_MIX = 0.72` über der Ruhefarbe), die **Teamfarbe bleibt die Orientierungsfarbe**
  und damit lesbar: Gold sagt „Treffer", die Teamfarbe sagt „welches Tor".
- Das In-World-FX ist **rein visuell** — es liest und schreibt keinen Spielzustand, fasst
  kein DOM an und läuft auf der Renderuhr (`performance.now`), nicht im Physik-Tick. Der
  Renderer hält Ruhefarbe und Ruheintensität je Bauteil als Kopie und schreibt nur bei
  Pegeländerung; Pegel 0 stellt exakt den Ruhezustand her.
- Im **HUD reagiert nur die punktende Seite** — die andere bleibt unangetastet. Genau eine
  Seitenklasse ist gleichzeitig aktiv, ein schnelles Gegentor kann nie beide zeigen.

**Zeitwerte**

| Konstante | Wert | Wirkung |
|---|---|---|
| `FB_GOAL_FX_MS` | 1500 ms | Gesamtdauer des In-World-Torimpulses |
| `FB_GOAL_FX_ATTACK` | 0.075 | Anstieg ≈ 112 ms bis zur Spitze, danach quadratischer Ausklang |
| `FB_GOAL_HUD_MS` | 1200 ms | Panel-Schimmer und Kanten-Glow der punktenden Seite |
| `FB_POP_MS` | 460 ms | Pop der geänderten Score-Ziffer |
| `FOOTBALL_GOAL_CELEBRATE_TICKS` | 51 | normales Celebration Window ≈ 850 ms bei 60 fps |
| `FOOTBALL_GOAL_WIN_CELEBRATE_TICKS` | 66 | Matchpunkt-Celebration ≈ 1100 ms |

Daraus ergibt sich: neuer Ball **≈ 2050 ms** nach dem Tor sichtbar (also erst nach dem
vollständigen Ablauf des Impulses), nächste Runde **≈ 2550 ms** nach dem Tor spielbar.
Die CSS-Dauern sind maschinell an `FB_GOAL_HUD_MS` und `FB_POP_MS` gekoppelt.

**Zustandsfolge**
- Normales Tor: `play → fall → celebrate → spawn → play`
- Matchpunkt: `play → fall → celebrate → result`

**Architektur und Abgrenzung (Phase 3)**
- Die **bestehende** Goal-State-Maschine wurde um die Wartephase erweitert — **keine zweite
  Gameplay-State-Maschine**, **kein `setTimeout` für Gameplay-Timing**. Die Länge wählt
  `footballCelebrateTicks()` am kanonischen `footballWinner`, nicht an einem zweiten Flag.
- Das Goal-FX startet **sofort** bei der bestehenden Torbestätigung (`footballTryGoal`,
  eine hinzugefügte Zeile hinter der vorhandenen Einmal-Sperre) — genau einmal pro Tor.
- Der Score bleibt die bestehende Source of Truth; das HUD vergleicht nur den zuletzt
  angezeigten Wert. Keine zweite Score-Engine.
- **`footballResetRound()` läuft erst nach der Celebration**, nicht mehr am Fallende —
  dadurch existiert der neue Ball während der Feier gar nicht. Der Renderer hält den
  gefallenen Ball auch in `celebrate` unten, damit er nicht hinter der Bande auftaucht.
- Eingaben und Spieler bleiben über die **vorhandenen** Goal-State-Sperren neutralisiert
  (`footballGoalBusy()` für jeden Zustand ≠ `play`, `footballFreezePlayers()` unverändert)
  — keine neue Sperre, keine globale Pausefunktion.
- Cleanup ist über `footballResetMatchState()` (neues Match **und** Menüwechsel),
  `footballMatchEnd()` und `fbClearHudFx()` abgesichert; getestet aus jeder Phase heraus.
- **Scope:** keine Physikänderung, keine Goal-Detection-Änderung, keine Scorelogik- oder
  First-to-3-Änderung, keine Kamera-, GLB- oder Netzwerkänderung, keine Änderung an
  Spawnposition oder Spawnbewegung — **und kein Sound in dieser Phase** (Audiofeedback
  für Football ist bewusst offen, siehe `TODO.md`). Bewusst nicht umgesetzt: Confetti,
  generische Partikelexplosion, „GOAL"-Textbanner, Kamera-Shake, Kameraflug.

**Teststand nach allen drei Phasen:** Football-Shell 738/0 · Football-Flow 118/0 ·
Golden-Physik 13/0 · Ring-Collapse 235/0. Die fünf bekannten Legacy-Suiten bleiben rot
(siehe „Bekannte Einschränkungen"), keine neue Suite rot.

### Bot-KI
- **Leicht:** Zufallswinkel ±60°, Zufallskraft *(nur `?dev=1`)*
- **Mittel:** Heuristisch – Angriff oder Rückzug zur Mitte; leichtes Rauschen *(nur `?dev=1`)*
- **Schwer (1v1):** Minimax-ähnlich via `simExchange` (650 Schritte), bewertet beste Gegner-Antwort. Verstärkt 2026-07-09: feinere Winkel-Kandidaten (±0.08 zusätzlich, 30 statt 22 Kandidaten) und enge Auswahl-Toleranz (0.2 statt 0.6 — spielt fast immer den besten gefundenen Zug). Kein Cheat, keine Physikänderung.
- **Schwer (2v2):** Minimax via `simSnap` (420 Schritte) + `bestRespN` (unverändert)
- Spieler-Menü ist hard-only („Training gegen Bot"); alle drei Stufen bleiben im Code und sind über `?dev=1` testbar.

### Lokaler FFA-Kern (M8-T2, akzeptiert 2026-07-08)
- 2–5 Spieler Hotseat: jeder 1 Kugel, gleichmäßig im Kreis platziert; verdecktes Zielen reihum über den Cover-Screen, dann gleichzeitiger Schuss.
- **Last-Man-Standing:** Rundenende in `stepSim` verallgemeinert auf „≤1 Spieler mit lebenden Kugeln" (für 2 Spieler bit-identisch, Golden-verifiziert); Eliminierte bleiben draußen und werden beim Zielen übersprungen; `roundWinner` deterministisch (Überlebender; Gleichzeitig-Out-Tiebreak: am wenigsten weit draußen gewinnt). Matchsieg bei `winTarget` Rundensiegen (Default 3).
- **Zentrale Spielerfarben `PCOLS`** (Slots 0–4: Blau/Rot/Grün/Gelb/Schwarz; 0/1 unverändert, Schwarz mit silbernem Rim/Glow): eine Quelle für 2D-Kugeln, Partikel, Slingshot/Pfeile, HUD, Cover, 3D-Materialien. Kompaktes FFA-HUD als Chip-Leiste.
- **Zweck:** technische Basis/Testharness für den Online-FFA — der ist seit M8-T3c **aktiviert** (siehe Online-Multiplayer). Testabdeckung: FFA-Logik-Suite 18/18 (Scratchpad-Harness auf echtem `stepSim`/`afterResult`).

### Online-Multiplayer
- Firebase Realtime Database, Raumcode (4 Zeichen, alphanumerisch)
- Lockstep: beide Spieler committen ihre Züge; Physik läuft lokal identisch
- **Online-FFA-Client-Vorbereitung (M8-T3a, akzeptiert 2026-07-09):** Online-FFA ist **bewusst deaktiviert** (vier Blocker, Toast „Online-FFA kommt im nächsten Schritt."), aber clientseitig vorbereitet: `validateRoom` kennt das ffa-Schema (`state:'lobby'`, Seats 0–4, `freeSeat`; single/double verhaltensidentisch), versteckte Lobby-UI (`renderLobby`: PCOLS-Kugeln, n/5, Host-Start ab 2), Seat-Claiming `pickFreeSeat`/`claimSeat` (Write-once-Race-Retry, noch unbenutzt), Reveal über `allAliveCommitted()` (Eliminierte zählen nicht), Presence-/Turn-Listener als Seat-Schleifen. Aktiviert in M8-T3c.
- **Protocol-v2-Cutover (M8-T3b, akzeptiert 2026-07-09):** `ONLINE_PROTOCOL_VERSION` = 2, `firebase.rules.json` erweitert, **veröffentlicht und live REST-verifiziert (56/56)**: `fmt` zusätzlich `'ffa'`; ffa-Creation nur mit `state:'lobby'`; Einweg-Übergang `lobby→playing` nur mit `p/1`; `seats` (2–5) write-once nach Start; Seat-Claims `p/0`–`p/4` write-once, nur solange Lobby offen (Presence-Delete erlaubt); Moves Seats 0–4 / `idx` 4 nur ffa. Alle neuen Bedingungen auf `fmt==='ffa'` gegated — single/double verhaltensidentisch (lokale Rules-Engine-Suite 59/59 im Scratchpad-Harness). Online-FFA serverseitig bereit; clientseitig aktiviert in M8-T3c. Live-Smoke 1v1/2v2 auf v2 bestanden. Drei REST-Testräume (7SNX, DDKU, 5CZ4) verbleiben in der DB (siehe TODO).
- **Online-FFA aktiv (M8-T3c inkl. Nachbesserung, akzeptiert 2026-07-09):** Host erstellt ffa-Räume (`state:'lobby'`), Gäste joinen per `claimSeat` (Write-once-Race, niedrigster freier Seat 1–4), Live-Lobby über den Presence-Listener (Roster, Host-Start ab 2). **Start:** Gate gegen Sitzlücken (Seats müssen lückenlos 0..n−1 belegt sein; bewusst kein Auto-Nachrücken), dann sequenziell `state:'playing'` → `seats:n` (kein Multi-Path-Update — RTDB validiert pro Pfad, die seats-Rule sähe den neuen state nicht); ein einziger `seats`-Listener ist das synchrone Startsignal (Rules garantieren seats erst nach state); Claim nach Host-Kopfzählung wird per `myPlayer>=seats` sauber ausgeworfen. **Per-Seat-Ansicht `viewAngle()`:** nur Ansicht/Input rotieren (−seat·2π/N; Input `localPt` invers, 2D-Canvas-Rotation, Labels gegenrotiert, 3D-Kamera-Azimut `curVA`) — eigene Kugel vorne/unten für Seat 0–4; 1v1/2v2 exakt 0/π (P1-Spiegel `2*cx-x` byte-gleich), lokaler FFA unverändert (offline 0). **FFA-Leave im Match = Elimination (deterministisch):** verbleibende Clients füllen den offenen Move-Slot des Verlassenen mit einem Stand-still-Sentinel (`idx!==seat`, Write-once-Rule als Schiedsrichter — echter Commit gewinnt); alle Clients spielen mit identischen Moves aus der DB; am Sentinel erkennen alle den Leave (`seatGone`) und setzen die Kugel bei `beginReveal` hinter die Ringkante → normaler Ring-Out-Pfad in `stepSim` eliminiert und beendet Runde/Match (kein stepSim-Eingriff, kein Deadlock, 2er-FFA inklusive). 1v1/2v2: Leave beendet weiterhin das Match (`onOppLeft` unverändert); Lobby: Gast-Leave aktualisiert Roster, Host-Leave bricht für Gäste ab. Menü-Restore (`mode`/`ffaN`) nach Online. Testabdeckung: Multi-Client-Flow-Suite 46/46 (Fake-RTDB mit v2-Rule-Verhalten), Mapping 48/48 (viewAngle-Kontrakt), FFA-Online-Prep 40/40.
- **Online-FFA-Live-Smoke (M8-T3e, bestanden 2026-07-09):** Auf https://ringoutgame.github.io/ringout/ mit 5 echten Spielern verifiziert — Lobby, Host-Start, alle Joins, Per-Seat-Ansicht, Last-Man-Standing, stabiles Match; 1v1/2v2 weiterhin stabil. **RingOut ist bereit für den kleinen privaten Playtest inkl. Online-FFA.** Bekannte v1-Grenzen: kein Reconnect, Sitzlücken blockieren den Lobby-Start (kein Auto-Nachrücken), Rematch-„Geist" bei verlassenen Spielern möglich, noch kein öffentlicher Launch (Auth/App Check/Room-TTL ausstehend).
- **Player Identity, Namen & Lobby-Reconnect (Paket A, lokal fertig 2026-07-13 — noch kein Cutover/Deploy):** Fundament für Reconnect. **Identität ohne Auth:** `onlinePid` (16-Zeichen-Token aus `crypto.getRandomValues`, `localStorage['ringout_pid']`) identifiziert denselben Browser über Reload/Tab-Wechsel; per-Tab `onlineTab` (Grundlage Zwei-Tab-Schutz, voll in Paket B); `onlineName` (sanitisiert via `sanitizeName()`: trim/Kollaps, C0/C1-Controls, Bidi-Steuerzeichen und unsichtbare Formatzeichen entfernt, max. 16 sichtbare Grapheme via `Intl.Segmenter` + 48-Unit-Hard-Cap, `localStorage['ringout_name']`). **Roster-Knoten `players/<seat>={id,name,tab}`** neben dem flüchtigen Presence-`p/<seat>`: `p` bleibt der Write-once-Arbiter, der Record wird vom Seat-Gewinner geschrieben (createRoom/claimSeat/joinRoom), ein `players`-Listener speist Lobby-/HUD-Namen. **Namen ausschließlich per `textContent`** (Lobby-Roster `lobbyName0..4`, 1v1-HUD-Cards `n0`/`n1`, Overlays via `pName`) — nie `innerHTML` (kein XSS). **Lobby-Rejoin auf denselben Seat** (`attemptRejoin()`, Host-Seat 0 + Gast-Seats) nur nach sichtbarer Bestätigung (Join-Tap bei erkannter eigener Identität via `findOwnSeat`, oder Rejoin-Button aus `ringout_room` <2 h) und **strikt nur im Lobby-Zustand** (`roomRejoinableState()` = `state==='lobby'` für ALLE Modi; da der 1v1/2v2-Gastclaim den Raum atomar auf `playing` schaltet, kann eine Lobby nur den Host halten — ein Gast ist nie in einer Lobby gesetzt; Match-Reconnect = Paket B). **Atomarer Claim-Lifecycle (`claimSeatSlot`, letzte Blocker-Korrektur 2026-07-14):** onDisconnect wird VOR dem Write armiert, dann werden `p/<seat>` + `players/<seat>` [+ bei 1v1/2v2 `state:'playing'`] in EINEM Multi-Path-`update()` geschrieben (all-or-nothing); die Write-once-Presence ist der alleinige Arbiter (parallele Claims → genau ein Gewinner). **Kein Vorab-Löschen fremder Records** — ein stale Fremd-Record wird nur INNERHALB desselben atomaren Claims recycelt (Rules: nur bei pre-freier Presence + Lobby). onDisconnect bleibt nach Erfolg aktiv, wird nach Ablehnung abgebrochen; Op-Token wird VOR **und NACH** dem Write geprüft; ein abgelehnter/fehlgeschlagener Claim hinterlässt keinen Teilzustand, ein Transportfehler wird sichtbar gemeldet (nicht verschluckt). **Op-Token-Guards (`joinOpSeq`):** jeder Create/Join/Rejoin prüft sein Token nach jedem `await`; `leaveOnline()` oder ein neuerer Vorgang entwertet alte sofort, Globals werden erst nach vollständigem Remote-Erfolg übernommen — ein verspäteter Vorgang aus Raum A kann Raum B nie berühren. **Host-Reload-Grace** (`LOBBY_HOST_GRACE_MS=12000`): eine Reload-Lücke bei `p/0` schließt die Lobby nicht mehr sofort (`players/0` bleibt → `evalLobbyHostPresence` hält offen), ein *bewusstes* Host-Leave entfernt zusätzlich `players/0` und schließt sofort (deterministische Unterscheidung). Bewusstes Leave bleibt sofortig, entfernt `players/<seat>` + `ringout_room`. **Match-Reconnect, In-Match-Grace, Fast-Forward-Replay, Zwei-Tab-Takeover = Paket B.** Verifikation (letzte Blocker-Korrektur): Runner 12/12 (Identity 45, Rules 106, Flow 116, Race 115, ValidateRoom 44, Prep 41), `test:e2e:spike` (inkl. Emulator-Atomclaim-Beweis: Reject ohne Teilzustand · Parallel-Claim genau ein Gewinner · Claim bei `state==='playing'` abgelehnt) + `test:e2e:ffa` gegen den echten JDK-21-RTDB-Emulator mit v3-Rules, `git diff --check` sauber. Physik/Lockstep/Move-Daten byte-unverändert (Goldens 13/13).
- **Online 2v2 (M6-T1, manuell verifiziert 2026-07-08):** Doppel-Format läuft über denselben Lockstep — Move trägt `idx` seit M1, Rules erlauben idx 0–3 und `config.fmt` `'double'`. Zwei-Tab-Test bestanden (Create/Join, je 2 Kugeln, verdeckte Kugelwahl, Reveal, synchrone Simulation, Ringout, Rundensieg, 3D-Default). Keine Codeänderung, kein Protocol-Bump, keine Firebase-Änderung nötig.
- Zug-Validierung: `sanitizeMove()` klemmt deterministisch und idempotent an **beiden** Lockstep-Enden (Sender in `commit()`, Empfänger in `onlineTurnValue()`) — Vektorlänge ≤ `maxPull()`, Drall ∈ [−1, +1], Kugel-Index gegen Besitz validiert. Verhindert Velocity-Injection durch manipulierte Clients.
- Raum-Validierung beim Beitritt: pure Funktion `validateRoom()` prüft vor jeder State-Mutation `v` (Protokollversion), `config.winTarget` (3|5), `config.fmt` (single|double|ffa), `gen` (Safe Integer, 0–10 000) und die Präsenz-Map `p` (Host anwesend, Raum nicht voll; Firebase-Array-Form unterstützt). **Einheitlicher Room-State (Paket A, letzte Blocker-Korrektur 2026-07-14):** ALLE Modi verlangen `state:'lobby'` beim Beitritt (`Match läuft bereits.` sonst); für `fmt:'ffa'` zusätzlich freier Seat 1–4. Ungültige Räume werden abgelehnt — keine stillen Defaults.
- Protokollversion: `ONLINE_PROTOCOL_VERSION` (Integer, **lokal aktuell 3** — v2 = Online-FFA-Raum-Schema seit M8-T3b; **v3 = Player-Identity/`players`-Roster/Lobby-Rejoin, Paket A, lokal vorbereitet, noch nicht deployt**; ein späterer Physik-Tuning-Pass M5-T2 wäre damit v4) wird von `createRoom()` atomar als `v` in den Raum geschrieben; Beitritt nur bei exakter Übereinstimmung. **Der v3-Cutover (Rules-Publish + Deploy zusammen) erfolgt gebündelt erst nach Paket B — live ist weiterhin v2.** **Bump-Regel:** +1 ausschließlich bei Änderungen an Online-Protokoll, Raum-Schema, Lockstep, Physik, Move-Daten oder simulationsrelevanter Logik — reine UI-/Grafik-/Menü-/Textänderungen bumpen nicht, damit sie Online-Matches nicht unnötig blockieren.
- Server-seitige Sicherheit (aktiv): `firebase.rules.json` (im Repo) erzwingt das Raum-Schema in der Realtime Database — publiziert und live-verifiziert (v2 seit M8-T3b: 56/56 REST-Checks + Zwei-Tab-Match). Kernpunkte: Raumcode-Charset `[A-HJKMNP-Z2-9]{4}`; `v`/`config`/`created` nach Erstellung unveränderlich; sauberer Initial-Raum (gen 0, Host präsent, kein vorbefülltes `p/1`–`p/4`, `g` oder `seats`; ffa nur mit `state:'lobby'`), per `data.exists()`-Guard nur bei Erstellung geprüft (blockiert keine späteren Child-Writes); Host-Präsenz delete-only (`p/0` nach Verlassen nicht reaktivierbar); Züge write-once mit Wertegrenzen exakt wie `sanitizeMove` (idx 0–3, dx/dy ±195, sp ±1; Seats 2–4 und idx 4 nur in ffa-Räumen); Move-Writes nur für aktuelles `gen` (`$gen === gen + ''`); `gen` monoton (+1 oder idempotent gleich, 0–10 000); Presence mit 2-h-Join-Fenster; kein Root-Read → keine Raum-Enumeration. `created` nutzt `serverTimestamp()`, Rule `created === now` macht es server-autoritativ. **v3-Ergänzungen (lokal, noch nicht publiziert; einheitlicher Room-State + atomarer Claim seit der letzten Blocker-Korrektur 2026-07-14):** einheitlicher `state` (`lobby`→`playing`) für ALLE Modi; neuer `players/$i`-Knoten (`id` `/^[A-Za-z0-9_-]{8,24}$/`, `name` 1–48 UTF-16-Units — der 16-Grapheme-Cap ist Client-Sache, `tab`, `$other:false`). Garantien: (a) **id unveränderlich** bei besetztem/gehaltenem Sitz — nur Same-id-Updates; ein Fremd-Record ändert die id ausschließlich beim Recycling (s. d); (b) **Record-Erstellung/-Ersatz nur mit im selben Multi-Path-Write gesetzter bzw. bereits gehaltener Presence** (`newData` merged `p/$i===true`) und **nur in `state==='lobby'`** — nie während `playing`; (c) **Record-Delete nur bei freier Presence** (`p/$i!==true`) — dadurch kann kein später Rollback/Cleanup einen inzwischen fremd übernommenen Record löschen; (d) **Seat-Recycling = atomarer Replace** (Fremd-Record im selben Claim ersetzt) nur bei **pre-freier** Presence + Lobby — ein gehaltener Sitz ist unstehlbar; (e) **Claim/Recycling/Rejoin für ALLE Modi nur in Lobby**, `p/1` write-once, parallele Claims → genau ein Gewinner via Write-once-Presence; (f) **Host-`p/0`-Rejoin nur bei `state==='lobby'`** (und `players/0/id` existiert) — einheitlich für alle Modi; (g) `state` `lobby→playing` nur mit `p/1` present; Raum-Erstellung verlangt `state:'lobby'` + `players/0` und verbietet vorbefüllte `players/1..4`.
  **Identity-/Rejoin-Negativmatrix (rule-seitig erzwungen, getestet in `test_rules.js`/Flow-R3–R10/RP1/RD1/RN1/`rest_verify_v3.js`/Emulator-`spike.js`):**
  | Angriff/Fehlerfall | Ergebnis |
  |---|---|
  | id-Wechsel per Einzel-Write (ohne Presence im selben Claim) | DENY (id immutable) |
  | Recycle-Replace eines Fremd-Records im atomaren Claim bei pre-freier Presence + Lobby | ALLOW (genau ein Gewinner) |
  | Record-Delete während `p/$i===true` | DENY |
  | Record-Neuanlage ohne (merged) Presence | DENY |
  | Record-Neuanlage/-Ersatz während `state==='playing'` | DENY |
  | Gast-/Seat-Claim oder Recycling außerhalb der Lobby | DENY (alle Modi) |
  | Host-`p/0`-Restore während `state==='playing'` (ffa/1v1/2v2) | DENY |
  | Zwei parallele Claims auf denselben Seat | genau EIN Gewinner (write-once) |
  | Atomarer Claim mit ungültigem Teil-Pfad | DENY komplett (kein Teilzustand) |
  | `p/1`-Overwrite (alle Formate) | DENY (write-once) |
  | Zusatzfelder / ungültige id-, tab-, name-Werte | DENY |
  **Bekannte Grenze (ohne Auth, prinzipbedingt):** Rules können pid-Eigentum nicht verifizieren — Presence-Deletes bleiben offen (Cleanup-Pfad), und wer id+Raumcode kennt (Raum ist lesbar), kann per Same-id-Write den Namen eines Sitzes ändern. Schutz vor Unfällen, nicht vor Sabotage; `players/<seat>/id` ist so gewählt, dass `auth.uid` (Anonymous Auth) später ohne Schema-Bruch einrastet.
- **Ehrliche Sicherheitsgrenze:** Ohne Authentifizierung schützen die Rules **nicht** vor Sabotage durch jemanden, der den Raumcode kennt (Gastslot belegen, strukturell gültige Züge schreiben, `gen`+1 auslösen). Sie verhindern nur ungültige Struktur/Werte, Überschreiben committeter Daten, Room-Overwrite und Enumeration. Identitätsschutz erfordert Auth + App Check (nachgelagert, siehe TODO).
- Disconnect-Handling via `onDisconnect().remove()`
- **Room-Cleanup v1 (2026-07-09, live-verifiziert):** `firebase.rules.json` erlaubt **additiv** das Löschen eines ganzen Raums, aber nur wenn kein Seat `p/0…p/4` mehr präsent ist — laufende Matches (immer mit präsenten Seats) sind so absolut geschützt. `leaveOnline()` entfernt nach der eigenen Presence best-effort den ganzen Raum (`remove(rRef())` mit `.catch`); der letzte sauber gehende Spieler räumt Raum + Move-Historie ab, bei noch besetzten Seats verwirft die Rule den Delete still. Kein Protocol-Bump (rein additive Berechtigung, abwärtskompatibel). Verifikation: Rules-Suite 70/70 (Fake-RTDB-Stub in `test_ffa_flow.js` spiegelt die Regel), Live-REST-Verify 67/67 nach Publish (`rest_verify_v2.js` legt Test-Räume an und räumt sie via Cleanup-Rule selbst wieder ab). Residual: Crash/Tab-Close des letzten Spielers kann eine leere Hülle hinterlassen (kein Move-Wachstum) — vollautomatischer Sweep via Cloud Function/Blaze bewusst verschoben.
- **Leave-/Disconnect-UX (M7-T1a, 2026-07-08):** Gegner-Weggang (Tab zu, ☰-Leave, End-Overlay-Menü) zeigt dem verbleibenden Spieler ein Overlay „Gegner hat den Raum verlassen." mit ↩-Menü-Rückweg; ☰ verlässt ein laufendes Online-Match nur nach Bestätigungs-Overlay („Abbrechen"/„Match verlassen") und nimmt denselben Leave-Pfad wie ein Disconnect (Presence-Remove). Kein stiller Exit, kein Protocol-Bump, keine Firebase-Änderung.
- Rematch durch Generationszähler (`gen` in Firebase)
- **Live-URL-Smoke (M7-T1, manuell verifiziert 2026-07-08):** Produktions-Smoke über https://ringoutgame.github.io/ringout/ bestanden — 3D-Default, Online über echte Geräte/Netze, 1v1, 2v2, Rematch, Leave/Disconnect-Flow, `?r2d=1`-Fallback. **RingOut ist bereit für einen kleinen privaten Playtest.** Einschränkung: nur private Tester, noch kein öffentlicher Launch (kein Auth/App Check, keine Room-TTL, API-Key nur durch Rules begrenzt).
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
- `tools/tune_compare.js`: feste Szenarien Ist- vs. Tune-Werte über die echte extrahierte Sim (Frames, Weg, Auslauf nach SLOWV, Ringout). Finale Werte werden erst in M5-T2 fest eingebaut (dann Goldens `--update` + Protocol-Bump — **v4**, da v3 lokal bereits von Paket A/Player-Identity belegt ist — + Rules-Republish; v2 ist seit M8-T3b der Online-FFA-Bump).

### 3D-Visual-Prototyp (`prototype3d.html`) — Stand AKZEPTIERT
- **Pipeline:** `tools/build_arena_platform.py` generiert headless (Blender 4.4, `D:\Blender\blender.exe`) das eigenständige `assets/arena_platform.glb` (36 MB, alle PBR-Maps eingebettet). CC0-Quellen: ambientCG (Marble012, Rock030), Poly Haven (stone_brick_wall_001, 2 Puresky-HDRIs). Roh-Texturen/`.blend` nicht im Repo (`.gitignore`) — regenerierbar per Skript + Spec-Downloads (`BLENDER_ASSET_SPEC.md`).
- **Look:** helle Marmor-Tempelplattform im Golden-Hour-HDRI-Himmel, versenkte Gold-Inlays, Kristall-Sockel mit Marmor-Fassung, gestufter Unterbau mit Pfeilern, ruhiges Wolkenmeer; bewusst keine Partikel-Effekte (Gameplay-Klarheit).
- **Gameplay-Sizing:** Spielfläche +44 % via `PLAY_SCALE = 1.2` (Einzeiler-Tuning), Kugeln r 0,58; dreiteilige Grenze (Randzone + Leuchtring + Goldrahmen); Kamera-Tilt geklemmt (~62°) für faire Lesbarkeit; ausgelegt auf 4–5 Spieler (Playtest mit echter Physik steht aus).
- **Fallbacks:** Ohne Server/Internet (file://) läuft die prozedurale Arena; HDRI-Kette kloofendal → qwantani → prozedural. Lokaler Test: `python -m http.server 8000`.
- **Performance (gemessen, bestanden):** Handy 60 FPS (Min 60 über 10 s), GLB-Ladezeit ~1,96 s, HDRI ~0,96 s; PC >150 FPS. Eingebauter Monitor nur über `?perf=1` (FPS, Min-FPS, Ladezeiten) — ohne Flag inert.
- **Abgrenzung:** Keine Integration ins Hauptspiel. `index.html`, Physik, Lockstep, Online, Replay, Firebase vollständig unberührt. Spätere Integration = reiner Render-Adapter über der unveränderten 2D-`LOGICAL`-Physik.

---

## Systemanalyse

- Systemanalyse vom 2026-07-09 liegt unter `docs/SYSTEM-ANALYSE-2026-07-09.md` (Bewertung, Schwachstellen, Regel-/Workflow-Vorschläge, Token-Sparsystem).
- Umsetzung erfolgt später in separaten Infra-/Workflow-Tasks (eigene Briefings/Freigaben).

## Bekannte Einschränkungen

- Firebase API-Key liegt im Klartext im Quellcode (kein Build-System für Env-Variablen)
- Gesamter Code in einer einzigen HTML-Datei – kein Modul-Split
- CI prüft nur die Offline-Suiten (`tools/run_all_tests.js`); die Live-REST-Verifikation (`tools/rest_verify_v3.js`, `--live`, ersetzt `rest_verify_v2.js`; sinnvoll erst nach dem v3-Publish) läuft weiterhin bewusst manuell und nie in CI
- Synchrone Bot-Simulation im UI-Thread (Hard-Bot kann auf schwachen Geräten kurz stocken)
- Kein PWA-Manifest / kein Offline-Support
- Lokalisierung nur v1 (Hauptmenü/Online-Dialog EN/DE/TR): In-Game-Texte und testgebundene Status-/Fehlertexte sind weiterhin nur Deutsch
- Arena Football: exakt frontales 1D-Pinning bleibt bestehen — liegen Bande, Ball und Stoßender auf einer Radiallinie, gibt es keine geometrische Fluchtrichtung; 0 px Verlagerung ist dort physikalisch korrekt und nur über ein Massenmodell lösbar (bewusst nicht umgesetzt)
- Arena Football: der Mindest-Escape bei bestätigtem Static Wedge erzeugt minimal Energie (≤ ½·0.12² = 0.0072 je Kugel). Die Nullenergie-Invariante gilt damit außerhalb dieser Frames, nicht mehr absolut; der Harness prüft beide Fälle getrennt
- Fünf Offline-Suiten sind vorbestehend rot (FFA-Kern, FFA-Online-Flow, FFA-Online-Race, Reconnect-B2, Team-Duel) — nachweislich schon an HEAD `3577ec5`, unabhängig von der Arena-Football-Arbeit
