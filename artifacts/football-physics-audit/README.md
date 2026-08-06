# Arena Football — Physikaudit, Tuning und Anti-Wedge (Phasen 4A – 4B-3)

Messnotiz zur Football-Physik. **Abschnitte 1–7 sind das Audit aus Phase 4A und
beschreiben den Stand VOR jeder Änderung** — alle Zahlen dort stammen aus
`node tools/test_football_flow.js` gegen den unveränderten Stand von `index.html`
(HEAD `3577ec5`). Was danach tatsächlich umgesetzt wurde, steht in **Abschnitt 8**.

> **Kurzfassung:** Der produktive Football-Physikstandard ist seit Phase 4B-3
> `FOOTBALL_PHYS` in `index.html` mit `friction 0.9968 · fend 0.9935 · stopv 0.035 ·
> restBall 0.40 · restBand 0.52 · restPost 0.47`, dazu
> `FOOTBALL_CONTACT_ITERATIONS = 3` und die Anti-Wedge-Logik. Die in 4B-2
> verglichenen Alternativen CURRENT und ICE sind **nicht produktiv** und existieren
> nur noch als Vergleichsmodelle in `tools/test_football_flow.js`.

Einheiten: `px` = LOGICAL-Pixel (Arena 1000×1000), Geschwindigkeit in
**px pro Micro-Step**. `stepSim()` führt **2 Micro-Steps pro Frame** aus, das Spiel
läuft mit 60 fps → **120 Micro-Steps/s**. 1 Frame = 1/60 s.

---

## 1. Wirksame Konstanten und Formeln

| Größe | Wert | Fundstelle |
|---|---|---|
| `MAXPULL_FRAC` | 0.40 → `maxPull = R0*0.40 = 194 px` | index.html:1931 |
| `LAUNCH` | 0.034 → **vMax = 6.596 px/µStep (791.5 px/s)** | index.html:1931, :2647 |
| `FRICTION` | 0.992 pro µStep | index.html:1931 |
| `FEND` | 0.992 pro µStep | index.html:1931 |
| `SLOWV` | 0.35 (Umschaltschwelle FR↔FE) | index.html:1931 |
| `REST` | **0.25 — gilt gleichzeitig für Ball-Ball, Bande und Pfosten** | index.html:1931 |
| `STOPV` | 0.10 px/µStep (Settlement) | index.html:1931 |
| `SPIN_K` / `SPIN_DECAY` | 0.004 / 0.985 | index.html:1932 |
| Ballradius `BR` | 32 px | index.html:1889 |
| Arenaradius `R` | 485 px, Bandenlinie `flim = R-BR = 453` | index.html:1889 |
| Sockel (kanonischer Quadrant) | X ∈ [388.8, 468.672], Y ∈ [105.6, 180.032] | index.html:2741-2744 |
| Torfenster | \|y-cy\| ≤ 73.6 (= 2.300·BR) | index.html:2746 |
| **Masse** | **nicht modelliert** | siehe unten |
| **Maximalgeschwindigkeit** | **existiert nicht** in `stepSim` | index.html:2889-2961 |

### Integration (pro Micro-Step, index.html:2896)

```
x += vx ; y += vy
f = (|v| < SLOWV) ? FEND : FRICTION      // beide 0.992 → Zweig WIRKUNGSLOS
vx *= f ; vy *= f
if (spin) { v += perp(v)·(SPIN_K·spin·|v|) ; spin *= SPIN_DECAY }
```

### Ball-Ball (index.html:2899-2909)

```
ov  = 2·BR - d
a -= n·ov/2 ; b += n·ov/2                 // Positionskorrektur, hälftig
if (vn < 0) { imp = -(1+REST)·vn/2 ; a.v -= imp·n ; b.v += imp·n }
```

`imp = -(1+e)·vn/2` ist exakt die Zweikörperformel für **m_a = m_b = 1**.
Es gibt also **kein Massenmodell**: Neutralball und Spielerball sind physikalisch
identisch. Auch die Positionskorrektur teilt strikt hälftig.

### Bande (index.html:2931-2939), Pfosten (index.html:2766-2791)

Beide: Position exakt auf Berührabstand geklemmt, danach nur der **Normalanteil**
mit `(1+REST)` reflektiert, Tangentialanteil **unverändert** (keine Wandreibung).

### Reihenfolge pro Micro-Step

1. Integration + Dämpfung + Spin (alle Kugeln)
2. Ball-Ball: Paarschleife `i<j`, **ein einziger Durchgang**, keine Iteration
3. Je Kugel (Football): `footballResolvePost` → bei Treffer `continue`;
   sonst `fbPassed` → Torwertung; sonst Bandenprüfung → Reflexion → **erneut** `footballResolvePost`

**Genau ein Impuls pro Kugel und Micro-Step** an Bande/Pfosten. Zwischen Kugeln
kann pro Micro-Step nur ein Durchgang aufgelöst werden.

---

## 2. Gemessene Baseline

Vollständige Ausgabe: `node tools/test_football_flow.js` (39 Szenarien, 13 Assertions).

### 2.1 Zentrale Impulsübertragung

| Launch | v0 | Eindringtiefe | Anteil Spieler | Anteil Ball | E-Wirkungsgrad | Impulsfehler |
|---|---|---|---|---|---|---|
| 25 % | 1.649 | 1.149 px | 0.375 | 0.625 | 0.5313 | 0 |
| 50 % | 3.298 | 2.798 px | 0.375 | 0.625 | 0.5313 | 0 |
| 75 % | 4.947 | 4.447 px | 0.375 | 0.625 | 0.5312 | 0 |
| 100 % | 6.596 | 6.096 px | 0.375 | 0.625 | 0.5313 | 0 |

Deckt sich exakt mit der Theorie für gleiche Massen: (1−e)/2 = 0.375, (1+e)/2 = 0.625.
**Impulserhaltung ist exakt** (Fehler 0.0e+0). **47 % der Energie gehen in EINEM
zentralen Stoß verloren.** Der Schütze behält 37.5 % und läuft seinem eigenen Pass
hinterher → sofortiger Zweitkontakt.

### 2.2 Schräger Treffer (v0 = 4.0)

| Soll | reale Verbindungslinie | Abgang Ball | Fehler | vBall/vRef | vSpieler/vRef |
|---|---|---|---|---|---|
| 15° | 15.68° | 15.68° | 0.68° | 0.602 | 0.451 |
| 30° | 31.44° | 31.44° | 1.44° | 0.533 | 0.612 |
| 45° | 46.79° | 46.79° | 1.79° | 0.428 | 0.773 |
| 60° | 61.74° | 61.74° | 1.74° | 0.296 | 0.899 |

Der Abgang folgt **exakt** der Verbindungslinie (Fehler gegen die *reale* Linie = 0).
Die Abweichung 0.7–1.8° gegen den *geplanten* Winkel kommt allein aus der diskreten
Zeitschrittweite: der Kontakt wird erst *nach* der Integration erkannt, es gibt keinen
Swept-Test. Reproduzierbar, aber **geschwindigkeitsabhängig**.

### 2.3 Ausrollen (v0 = 3.0, kontaktfrei)

| Kugel | 75 % v0 | 50 % v0 | 25 % v0 | Settlement |
|---|---|---|---|---|
| Neutralball | 18 Fr / 94.2 px | 44 Fr / 190.1 px | 87 Fr / 282.3 px | 212 Fr (3.53 s), 362.6 px |
| Spielerball | 18 Fr / 94.2 px | 44 Fr / 190.1 px | 87 Fr / 282.3 px | 212 Fr (3.53 s), 362.6 px |

**Bitidentisch** — direkte Bestätigung, dass kein Massen-/Rollunterschied existiert.

### 2.4 Banden- und Pfostenabprall

| Kontakt | Normal-Verhältnis | Tangential | |v|-Verhältnis |
|---|---|---|---|
| Bande zentral (v = 1 … 6.6) | **0.25** | — | 0.25 |
| Bande schräg 26° (v = 2, 4) | **0.25** | **1.00** | 0.49 |
| Sockel frontal / Innenkante / Innenecke | **0.25** | 1.00 | 0.25 |
| Sockel frontal 30° | 0.25 | 1.00 | 0.54 |

Normal bleiben **25 % der Geschwindigkeit → 6.25 % der Normalenergie**. Bande und
Pfosten sind damit die stärkste Energiesenke des Systems. Keine Wandreibung
(Tangential exakt 1.00). Keine Restpenetration (0 px), keine Grenzüberschreitung (0 px).

### 2.5 Klemm- und Mehrfachkontaktszenarien

| Szenario | Verlagerung Subjekt | Settlement | Restüberlappung | Pinning |
|---|---|---|---|---|
| A1 Spieler an Bande, Treffer v = 4.0 | **0.00 px** | 2 Frames | 1.434 px | 1 Fr |
| A2 Spieler an Bande, Treffer v = VMAX | **0.00 px** | 2 Frames | 2.365 px | 1 Fr |
| A4 Spieler an Bande, **4 Volltreffer** | **0.00 px** | 2,4,6,8 Frames | 2.501 px | 4 Fr |
| B1 Neutralball an Sockel, Treffer v = 4.0 | **0.00 px** | 2 Frames | 1.434 px | 1 Fr |
| B4 Neutralball an Sockel, **4 Volltreffer** | **0.00 px** | 2,4,6,8 Frames | 2.501 px | 4 Fr |
| C1 Ball symmetrisch zwischen Rot/Blau | 10.52 px | 71 Frames | 0.528 px | 2 Fr |
| C4 Ball, langsamer Dauerdruck | 0.12 px | 3 Frames | 0.176 px | 3 Fr |
| D1 Bande + zwei Spieler symmetrisch | 2.83 px | 131 Frames | 1.301 px | 4 Fr |
| D3 Bande + zwei Spieler, Dauerdruck | 0.47 px | 60 Frames | 0.440 px | **14 Fr → GEPINNT** |
| D4 Bande + zwei Spieler, 4 Nachschüsse | 126.6 px | 131…599 Frames | 1.366 px | 4 Fr |

### 2.6 Globale Kennzahlen

| Metrik | Wert | Bewertung |
|---|---|---|
| Szenarien gesamt | 39 | — |
| Szenarien mit Pinning (≥ 6 Frames) | 1 (D3) | **auffällig** |
| Max. zusammenhängende Pinning-Dauer | 14 Frames (0.23 s) | akzeptabel |
| **Verlagerung nach 4 Volltreffern (A4/B4)** | **0.00 px** | **kritisch** |
| Max. Eindringtiefe während eines µSteps | 7.19 px (11.2 % von 2·BR) | akzeptabel |
| **Max. Ball-Ball-Restüberlappung (bleibend)** | **2.50 px (3.9 % von 2·BR)** | **auffällig** |
| Max. Sockel-Restpenetration | 0 px | **gut** |
| Max. Überschreitung der Bandenlinie | 0 px | **gut** |
| Max. Energiezunahme | 1.0 (keine) | **gut** |
| Größter Energieverlust je Kontaktframe | 0.0037 (99.6 %) | **kritisch** |
| Settlement nach Wandtreffer | 2 Frames (0.03 s) | **kritisch** |
| Szenarien ohne Settlement | 0 | **gut** |

**Begründung der Einstufungen**

* *gut* — Invarianten sind hart erfüllt: kein Ball steckt je im Marmor, keiner liegt je
  jenseits der Bandenlinie, und **kein einziger Frame erzeugt Energie**. Impulserhaltung
  ist bitgenau. Determinismus ist bestätigt.
* *akzeptabel* — Die Eindringtiefe von 7.19 px bleibt weit unter der Tunneling-Grenze
  2·BR = 64 px (Faktor 8.9 Reserve); sie kostet nur Winkelgenauigkeit, keine Korrektheit.
  Die 14 Frames Pinning in D3 sind kurz genug, um nicht als Hänger sichtbar zu werden.
* *auffällig* — 2.50 px bleibende Überlappung sind bei BR = 32 sichtbar (Kugeln stecken
  ineinander) und werden **nie mehr aufgelöst**, weil es keinen zweiten Auflösungsdurchgang
  gibt und die Simulation direkt danach settled.
* *kritisch* — Die drei Werte hängen zusammen und sind gemeinsam die Ursache des
  Spielgefühls „der Ball klebt an der Wand“: ein Kontaktframe kann 99.6 % der Energie
  vernichten, die Restgeschwindigkeit fällt dadurch unter STOPV, und 2 Frames später
  erklärt die Engine Ruhe — **bei einer Verlagerung von exakt 0 px, auch nach vier
  Volltreffern mit maximaler Kraft.**

---

## 3. Identifizierte Ursachen für Pinning

**U1 — Kein Massenmodell.** `imp = -(1+REST)·vn/2` ist auf m = 1 festverdrahtet. Der
Schütze behält 37.5 % seiner Geschwindigkeit in Passrichtung und trifft den Ball sofort
erneut. Es gibt kein „leichter Ball fliegt weg, schwerer Spieler bleibt“.

**U2 — `REST = 0.25` für ALLES.** Ein zentraler Stoß vernichtet 47 % der Energie, ein
Bandenkontakt 93.75 % der Normalenergie. Die Kette Ball→Bande→Ball, die in jeder
Wandsituation auftritt, lässt rechnerisch ~0.02 % übrig. Die Bande ist keine Bande,
sondern ein Dämpfer.

**U3 — `STOPV = 0.10` trifft genau in dieses Loch.** Nach einem Volltreffer gegen einen
wandgestützten Ball hat der Schütze noch 0.044 px/µStep — **unter** STOPV. Die Engine
settled nach 2 Frames. Der Spieler sieht keinen Hänger und kein Zittern, sondern einen
Zug, der sofort vorbei ist und nichts bewegt hat.

**U4 — Positionskorrektur ohne zweiten Durchgang.** Die Ball-Ball-Trennung schiebt die
Kugel nach außen, die Bandenklemmung schiebt sie zurück auf `flim` — die Überlappung
wird im selben Micro-Step wieder eingeführt und **nie** aufgelöst (gemessen: 2.50 px
bleibend).

**U5 — Einpass-Auflösung, reihenfolgeabhängig.** Paarschleife `i<j`, ein Durchgang,
Positionskorrektur auch bei `vn ≥ 0` (außerhalb der Impulsbedingung), Bande/Pfosten erst
danach. Im Dreikörperkeil (D) entscheidet die Indexreihenfolge über das Ergebnis.
Gemessen: bis zu 5 gleichzeitige ruhende Kontakte.

**U6 — `FRICTION === FEND`.** Die vorhandene `SLOWV`-Verzweigung ist wirkungslos. Ein
bereits eingebauter Hebel für „langsame Kugeln sterben schneller ab als rollende“ liegt
ungenutzt brach.

**U7 — Diskrete Kollisionserkennung.** Kein Swept-Test; der Kontakt wird bis zu
6.6 px zu tief erkannt. Kein Tunneling (Reserve Faktor 8.9), aber der Abgangswinkel ist
geschwindigkeitsabhängig (0.7–1.8° Abweichung).

**U8 — Sockelgeometrie ragt über die Bandenlinie** (`BACK = 468.672 > flim = 453`). Das
ist bewusst so und wird von `continue` korrekt behandelt; es ist die einzige Stelle, an
der eine Kugel legitim bei r > flim ruht. **Kein Defekt**, aber jede Anti-Pinning-Lösung
muss diesen Fall kennen.

**Nicht-Ursache (geprüft):** Spin erzeugt rechnerisch Energie
(`|v|² → |v|²·(1 + (SPIN_K·spin)²)`), aber der Effekt ist mit ≈ +0.03 % über einen
gesamten Zug materiell irrelevant. Kein Handlungsbedarf.

---

## 4. Pinning-Definition (Vorschlag, noch nicht produktiv)

### 4a — Dynamic Pin (pro Frame)

Eine Kugel gilt als gepinnt, wenn über **≥ 6 aufeinanderfolgende Frames** (= 12 Micro-Steps
= 0.10 s) gleichzeitig gilt:

| Kriterium | Vorschlag |
|---|---|
| Anzahl unabhängiger Kontakt-Normalen | ≥ 2 |
| geometrische Einklemmung | ∃ Paar mit `n1·n2 ≤ -0.5` (Öffnungswinkel ≥ 120°) |
| Geschwindigkeitsschwelle | `\|v\| < 0.25` px/µStep (= 2.5 × STOPV) |
| Positionsfortschritt | `< 0.40` px pro Frame |
| äußerer Druck | ∃ berührender Ball mit `v·(-n) > 0.01` px/µStep |
| Kontakttoleranz | 0.5 px (1.6 % von BR) |

Normalenkonvention: `n` zeigt **vom Hindernis zum Ball**.

### 4b — Static Pin (pro Zug) — **der für diese Engine aussagekräftigere Test**

Die Messung zeigt: das Problem äußert sich **nicht** als langes Zittern, sondern als
sofortiges Settlement ohne Wirkung. Deshalb zusätzlich:

> Eine Kugel gilt als statisch gepinnt, wenn sie bei ≥ 2 einklemmenden Kontakten einen
> **direkten Treffer mit ≥ 50 % Launch** erhält und ihre Verlagerung vom Schuss bis zum
> Settlement **< 1 px** beträgt.

Gemessen (A4/B4): **0.00 px nach vier Treffern mit 100 % Launch.**

Beide Definitionen sind im Harness implementiert und deterministisch. Die endgültige
Festlegung ist bewusst offen gelassen — die Parameter oben sind Vorschläge.

---

## 5. Bewertung der Anti-Pinning-Optionen

| | Vorteil | Risiko | Determinismus | Spielgefühl | Aufwand | Boost-Gefahr | RingOut-Eignung |
|---|---|---|---|---|---|---|---|
| **A** Trennkorrektur entlang der Fluchtrichtung | löst den Keil gezielt | „Fluchtrichtung“ ist heuristisch; als Geschwindigkeit implementiert = versteckter Impuls | gegeben, wenn Richtung rein geometrisch | gut, wenn klein | mittel | **hoch**, falls v-basiert | mittel — degeneriert als reine Position zu F |
| **B** tangentiale Escape-Komponente | löst jeden Keil sicher | erzeugt Energie aus dem Nichts | gegeben | wirkt „magisch“, Kugeln rutschen weg | gering | **sehr hoch** | **schlecht** — verletzt die heute erfüllte Nullenergie-Invariante |
| **C** reduzierte Reibung/Dämpfung im Mehrfachkontakt | einfach, keine Geometrie | behebt die Ursache nicht; koppelt an STOPV | gegeben | schwer dosierbar | gering | mittel | schwach — Symptomkur |
| **D** Contact Manifold / iterativer Solver | physikalisch korrekt | Neuschreiben von `stepSim`, gefährdet Lockstep-Hash und Golden-Physik | gegeben | sehr gut | **hoch** | keine | langfristig ja, für 4B zu groß |
| **E** Reihenfolge-/Iterationsverbesserung der bestehenden Auflösung | behebt U4 + U5 direkt, **gleiche Formeln**, keine neue Physik | Golden-/Collapse-Hashes müssen neu verifiziert werden | gegeben bei fester Iterationszahl und fester Reihenfolge | unverändert bei Einzelkontakt, spürbar besser im Gedränge | **gering–mittel** | **keine** | **sehr gut** |
| **F** reine Positionskorrektur ohne Impuls | trennt steckende Kugeln, garantiert energiefrei | löst nur die Überlappung, nicht die Geschwindigkeitsstarre | gegeben | neutral | gering | keine | gut |

### Empfehlung

**Primär: E — mehrfache Auflösungsdurchgänge mit unveränderten Formeln.**

Konkret für 4B: die Paarschleife und die Bande-/Pfostenauflösung in eine gemeinsame
Schleife mit **fester Iterationszahl (Vorschlag 3)** legen, statt Ball-Ball einmal und
Bande/Pfosten danach. Begründung aus den Messwerten:

* Es ist die einzige Option, die die **gemessenen** Defekte adressiert: 2.50 px bleibende
  Überlappung (U4) und Reihenfolgeabhängigkeit im Dreikörperkeil (U5).
* Sie fügt **keine Energie** hinzu — die Nullenergie-Invariante des Harness bleibt hart
  prüfbar. Bei einem einzigen Kontaktpaar konvergiert der zweite Durchgang sofort
  (`vn ≥ 0`, keine Überlappung), d. h. Einzelkollisionen bleiben unverändert.
* Sie bleibt deterministisch: feste Iterationszahl, feste Indexreihenfolge, kein Zufall.

**Fallback: F — reine Positionskorrektur ohne zusätzlichen Impuls,** falls E die
Golden-Physik-Hashes bricht. F kann auf den Football-Modus begrenzt werden und lässt die
Bestandsmodi bitgenau unberührt.

**Ausdrücklich nicht empfohlen: B.** Ein tangentialer Escape-Impuls erzeugt Energie und
würde genau die Invariante zerstören, die heute als einzige hart erfüllt ist.

---

## 6. Tuning-Empfehlung für Phase 4B (priorisiert)

Keine dieser Änderungen wurde vorgenommen.

| # | Thema | aktuell | empfohlener Testbereich | erwartete Wirkung | Risiko | Bewertungsmetrik |
|---|---|---|---|---|---|---|
| 1 | **Anti-Pinning** | 1 Durchgang | 3 Iterationen (Option E) | Restüberlappung 2.50 px → < 0.05 px; Keil löst sich | Golden-Physik-/Collapse-Hashes | Baseline 2.5 + 2.6, Ziel A4/B4-Verlagerung > 2·BR |
| 2 | **Bande-Restitution** | 0.25 (via `REST`) | **`REST_BAND` 0.45 – 0.60** | Normalverhältnis 0.25 → 0.45–0.60; Ball stirbt nicht mehr an der Wand | zu hoch = Flipper-Gefühl | Tabelle 4, Normal-Verhältnis |
| 3 | **Pfosten-Restitution** | 0.25 (via `REST`) | **`REST_POST` 0.35 – 0.50** | Pfosten fühlt sich hart, aber nicht federnd an | > 0.55 = Abpraller unkontrollierbar | Tabelle 5, Normal-Verhältnis |
| 4 | **Neutralball-Masse** | nicht modelliert (= 1.0) | **0.55 – 0.75** (Spieler = 1.0) | Anteil Ball 0.625 → 0.75–0.85; Schütze folgt seinem Pass nicht mehr | Ball zu schnell → Tore aus dem Mittelfeld | Tabelle 1, `Anteil Ball` |
| 5 | **Spielerball-Masse** | nicht modelliert (= 1.0) | **1.0 als Referenz belassen** | — | nur ändern, wenn #4 zu wenig differenziert | Tabelle 1 |
| 6 | **Ball-Ball-Restitution** | 0.25 (via `REST`) | **`REST_BALL` 0.35 – 0.50** | E-Wirkungsgrad 0.531 → 0.61–0.72 | mit #4 gemeinsam abstimmen (Rückstoß) | Tabelle 1, `E-Wirkungsgrad` |
| 7 | **Settlement-Schwelle** | `STOPV` 0.10 | **0.04 – 0.07** | kein Settlement mehr 2 Frames nach dem Wandtreffer | längere Züge, wenn #8 nicht mitgeht | Settlement-Frames in A/B/D |
| 8 | **Endphasen-Dämpfung** | `FEND` 0.992 (= `FRICTION`, wirkungslos) | **`FEND` 0.985 – 0.990** | reaktiviert den vorhandenen Zwei-Regime-Entwurf; langsame Kugeln kriechen nicht | zu niedrig = abruptes Stoppen | Tabelle 3, Settlement |
| 9 | **Lineare Dämpfung** | `FRICTION` 0.992/µStep | **0.9935 – 0.9955** | Ausrollen 3.53 s → 4.5–7.0 s; Pässe tragen | Züge werden länger | Tabelle 3, Weg und Settlement |
| 10 | **Maximalgeschwindigkeit** | keine; vMax(Launch) = 6.596 | **keine einführen** | — | — | Harness-Assertion `vMax < 2·BR` (Reserve Faktor 8.9); nach #4 zusätzlich `vNeutral < 32` prüfen |
| 11 | **Impulsstärke / Launch** | `LAUNCH` 0.034 | **0.030 – 0.040**, erst nach #4/#6 | Feinabgleich der Gesamtwucht | zu hoch mit #9 kombiniert = unkontrollierbar | Tabelle 1 |

**Reihenfolge der Bearbeitung:** #1 → #2/#3 → #4 → #6 → #7/#8 → #9 → #11.
Zuerst die beiden Korrektheitsthemen (Auflösung, Wandenergie), danach erst Spielgefühl.

**Wichtig:** #2, #3 und #6 setzen voraus, dass die heute **eine** Konstante `REST` in drei
getrennte Konstanten aufgeteilt wird. Das ist eine Strukturänderung, keine Wertänderung,
und sollte als eigener Schritt vor dem Tuning erfolgen.

---

## 7. Testharness

`tools/test_football_flow.js` — extrahiert die echten Physikfunktionen aus `index.html`
(gleiches Verfahren wie `test_football_shell.js` / `test_physics_golden.js`), schreibt
keine Dateien, nutzt kein Netzwerk, keinen Renderer, kein DOM und keinen Zufall.

Beobachtung erfolgt ausschließlich von außen. Zusätzlich rekonstruiert der Harness die
beiden Micro-Step-Positionen exakt aus dem Vorzustand (Integration → Dämpfung, spin = 0),
solange im ersten Micro-Step nichts kollidiert ist. Dadurch sind Kontaktzeitpunkt,
Kontaktnormale und die **echte Eindringtiefe vor der Korrektur** messbar — nicht nur der
Restwert danach.

Harte Invarianten (Suite schlägt bei Verletzung fehl):

1. kein Frame mit Energiezunahme über die reine Dämpfung hinaus
2. keine Restpenetration im Sockel
3. keine Überschreitung der Bandenlinie (außer bei Sockelkontakt / regulärem Tordurchtritt)
4. exakte Impulserhaltung bei reiner Ball-Ball-Kollision
5. `vMax(Launch) < 2·BR` (Tunneling-Reserve)
6. `FRICTION === FEND` als Audit-Fixpunkt — die **globalen** Konstanten sind unverändert;
   die Football-Physik bringt seit 4B-2 eigene Werte mit (siehe Abschnitt 8)

---

## 8. Umsetzung: Phasen 4B-1 bis 4B-3

Ab hier wurde produktiv geändert. Alles gilt **ausschließlich für `mode === 'football'`**;
alle anderen RingOut-Modi laufen unverändert über die globalen Konstanten.

### 8.1 Phase 4B-1 — iterative Kontaktauflösung

Umsetzung der Audit-Empfehlung **E** (Ursachen **U4**/**U5**): dieselben Formeln, dieselbe
Reihenfolge, nur mehrfach ausgeführt. `FOOTBALL_CONTACT_ITERATIONS = 3`.

- Integration, Dämpfung und Spin laufen weiterhin **genau einmal** pro Micro-Step;
  wiederholt wird ausschließlich die Kontaktauflösung.
- Außerhalb Football ist die Iterationszahl hart 1 — der Codepfad ist dort bit-identisch.
- Treffer-Feedback (Sound, Partikel, Hintergrundpuls) hängt am ersten Durchgang
  (`if(it===0)`), damit ein Kontakt nicht mehrfach knallt.

Messung (Szenariensatz ohne die später ergänzte W-Klasse):

| Metrik | 1 Durchgang | 3 Durchgänge |
|---|---|---|
| Ball-Ball-Überlappung, transienter Peak | 2.5009 px | **0.0929 px** |
| Ball-Ball-Überlappung, bleibend | 0.5785 px | **0.0929 px** |
| D4-Bandenkeil, Verlagerung | 127.86 px | **276.34 px** |
| Energiezunahme | keine | **keine** |

Die im Audit genannte Zielmarke `< 0.05 px` wird mit `ci = 3` **nicht** erreicht
(gemessen 0.0929 px, erreicht ab `ci = 4`). Der Wert bleibt bewusst bei 3: 0.0929 px sind
0.15 % von 2·BR und optisch nicht sichtbar, `ci = 4` bringt bei der Keillösung nur noch
+4 %. Der Harness weist die Lücke als WARN aus.

### 8.2 Phase 4B-2 — Presetvergleich

Drei Kandidaten wurden vermessen und im Browser gegeneinander gespielt: **CURRENT**
(unveränderter Stand), **GLIDE** und **ICE**. Gemessen mit dem produktiven
`FOOTBALL_CONTACT_ITERATIONS` und identischem Szenariensatz (43 Szenarien):

| Metrik | CURRENT | **GLIDE** | ICE |
|---|---|---|---|
| `friction` (pro Micro-Step) | 0.992 | **0.9968** | 0.9985 |
| → Restgeschwindigkeit pro Sekunde | 0.381 | **0.681** | 0.835 |
| `fend` (unter `SLOWV = 0.35`) | 0.992 | **0.9935** | 0.9955 |
| `stopv` | 0.10 | **0.035** | 0.018 |
| `restBall` / `restBand` / `restPost` | 0.25 / 0.25 / 0.25 | **0.40 / 0.52 / 0.47** | 0.48 / 0.62 / 0.52 |
| Neutralball: Ausrollzeit (v₀ = 3.0) | 3.53 s | **6.83 s** | 14.77 s |
| Neutralball: Ausrollstrecke | 362.6 px | **768.9 px** | 1351.1 px |
| Banden-Rückprall (Normalanteil) | 0.25 | **0.52** | 0.62 |
| Pfosten-Rückprall (Normalanteil) | 0.25 | **0.47** | 0.52 |
| Drei-Kugel-Keil W2: Lösung | **nie** | **411 Frames (6.85 s)** | 498 Frames (8.30 s) |
| Max. Pinning-Dauer | 15 Frames | **10 Frames** | 6 Frames |
| Spitzengeschwindigkeit | 6.4909 | **6.5539** | 6.5762 (vMax = 6.596) |
| Szenarien ohne Settlement in 40 s | 0 | **0** | 5 |

Spieler- und Neutralball rollen in jedem Modell bitidentisch — **es wurde kein
Massenmodell eingeführt** (Audit-Empfehlung #4 bleibt offen).

### 8.3 Manuelle Auswahl (Browserfreigabe)

Der Projektinhaber hat die drei Varianten im Browser verglichen und **GLIDE freigegeben**.
CURRENT wurde als *zu stumpf* verworfen, ICE als *zu rutschig / zu lange Züge*.
Die Freigabe gilt ausschließlich für GLIDE; für CURRENT und ICE existiert keine Freigabe.

### 8.4 Phase 4B-3 — finaler Produktivstandard

`index.html` enthält seither **einen** Wertesatz, ohne Auswahl, ohne Debug-Schalter und
ohne URL-Parameter:

```js
const FOOTBALL_PHYS = { friction: 0.9968, fend: 0.9935, stopv: 0.035,
                        restBall: 0.40, restBand: 0.52, restPost: 0.47 };
function footballPhys(){ return mode==='football' ? FOOTBALL_PHYS : null; }
```

`footballPhys()` ist die einzige Weiche: Dämpfung (`curFR`/`curFE`), Settlement (`curST`),
Restitution (`curRestBall`/`curRestBand`/`curRestPost`) und der Anti-Wedge-Block fragen
alle dort an. Liefert sie `null`, gilt exakt das bisherige Verhalten — deshalb sind alle
Nicht-Football-Modi unberührt. `FEND` ist jetzt **härter** als `FRICTION` und reaktiviert
damit den vorhandenen, bis dahin wirkungslosen Zwei-Regime-Entwurf (Audit **U6**).

### 8.5 Wedge-Definition und Anti-Wedge-Verhalten

Eine Kugel gilt als verkeilt, wenn über `FOOTBALL_WEDGE_STEPS` aufeinanderfolgende
Micro-Steps **gleichzeitig** gilt:

| Konstante | Wert | Bedeutung |
|---|---|---|
| `FOOTBALL_WEDGE_MIN_CONTACTS` | 2 | unabhängige Kontakt-Normalen |
| `FOOTBALL_WEDGE_DOT` | −0.45 | ein Normalenpaar schließt den Ball ein (≥ 117°) |
| `FOOTBALL_WEDGE_V` | 0.25 px/Micro-Step | Geschwindigkeitsschwelle |
| `FOOTBALL_WEDGE_PROGRESS` | 0.40 px/Frame | Positionsfortschritt |
| `FOOTBALL_WEDGE_STEPS` | 8 Micro-Steps (4 Frames, 0.067 s) | Mindestdauer |
| `FOOTBALL_WEDGE_PRESS` | 0.01 px/Micro-Step | äußerer Druck eines Nachbarballs |
| `FOOTBALL_WEDGE_EPS` | 0.5 px | Kontakttoleranz |
| `FOOTBALL_ESCAPE_MIN_V` | 0.12 px/Micro-Step (14.4 px/s) | Mindest-Escape im Stillstand |

Die erste verletzte Bedingung setzt den Zähler auf 0 — es gibt keine Erinnerung an alte
Keile. Zur Dauer: 12 Micro-Steps wären nie erreicht worden, der reale Keil hält 5–7
Micro-Steps am Stück, bevor ein Drücker kurz den Kontakt verliert. 8 ist der kleinste
Wert des zulässigen Bereichs, der die reale Klemmdauer noch trifft.

**Reaktion.** Aus einer festen Kandidatenliste (normierte Summe aller Normalen, danach je
Kontakt beide Tangenten in Kontaktreihenfolge) wird die Richtung mit dem größten
*minimalen* Skalarprodukt gegen alle Normalen gewählt; zeigt sie noch in ein Hindernis,
wird der Anteil entlang der am stärksten verletzten Normalen in bis zu drei festen
Durchgängen herausprojiziert. Die vorhandene Geschwindigkeit wird nur **umgelenkt** — der
Betrag bleibt exakt erhalten, es entsteht keine kinetische Energie. Nur bei praktischem
Stillstand greift der Mindest-Escape. Nach jedem Escape läuft die Mindestdauer neu.
Kein Zufall, keine Zeitabhängigkeit, keine Toleranzschleife → deterministisch.

**Reproduktionsszenario W2** (`tools/test_football_flow.js`): neutraler Ball in der Ecke
aus Bandenlinie und Sockel-Außenflanke, beide Spielerkugeln besetzen die tangentiale und
die radiale Fluchtrichtung, danach drei **gezielte** Volltreffer auf die aktuelle
Ballposition.

| | CURRENT (Referenz) | Produktivstand |
|---|---|---|
| Verlagerung des Balls | 0.10 px | 275.45 px |
| Frames bis Lösung (> 2·BR) | nie | 411 (6.85 s) |
| Escape-Reaktionen | 0 | 4 |
| Sockel-/Bandenpenetration | 0 / 0 px | 0 / 0 px |
| Spitzengeschwindigkeit | 6.4909 | 6.5539 (< vMax 6.596) |

### 8.6 Verbleibende Grenzen

- **Exakt frontales 1D-Pinning bleibt bestehen.** Liegen Bande, Ball und Stoßender auf
  einer Radiallinie, gibt es keine geometrische Fluchtrichtung; eine Verlagerung von 0 px
  ist dort das physikalisch korrekte Ergebnis und kein Solverdefekt. Lösbar wäre das nur
  über ein Massenmodell — bewusst nicht umgesetzt.
- **Der Mindest-Escape erzeugt minimal Energie.** Höchstens ½·0.12² = 0.0072 je Kugel und
  nur in einem bestätigten Static Wedge. Die Nullenergie-Invariante gilt damit außerhalb
  dieser Frames, nicht mehr absolut. Der Harness prüft beides getrennt: außerhalb der
  Escape-Frames ≤ 1.000001, innerhalb gegen die genannte Obergrenze.
- **Kein Massenmodell.** Neutral- und Spielerball sind weiterhin physikalisch identisch
  (Audit-Empfehlung #4 offen).
- **Fünf vorbestehende Legacy-Suiten sind rot** (FFA-Kern, FFA-Online-Flow,
  FFA-Online-Race, Reconnect-B2, Team-Duel). Nachweislich schon an HEAD `3577ec5` rot,
  unabhängig von dieser Arbeit.
- **CURRENT und ICE sind nicht produktiv** und existieren nur als Vergleichsmodelle im
  Flow-Harness.

### 8.7 Testabdeckung

| Suite | Umfang |
|---|---|
| `tools/test_football_shell.js` | 523 Assertions — Produktivwerte, keine Preset-Auswahl, kein URL-Parameter, Wedge-Konstanten, Escape-Bedingungen, Tor-/Score-/Reset-/First-to-3-Regression |
| `tools/test_football_flow.js` | 118 Assertions, 43 Szenarien × 3 Vergleichsmodelle, Konvergenz-Sweep, Determinismus-Fingerprints |
| `tools/test_physics_golden.js` | 13 — unverändert |
| `tools/test_collapse.js` | 235 — unverändert |

Zwei aufeinanderfolgende Läufe von `test_football_flow.js` liefern byteidentische
Ausgabe; die Endzustands-Fingerprints aller drei Vergleichsmodelle sind je Lauf
reproduzierbar und unterscheiden sich voneinander.
