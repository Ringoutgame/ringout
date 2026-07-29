# SFX-Assets — Lizenzen & Quellen

## Ring-Collapse-Soundset (Verzeichnis `ring_collapse/`)

Vierzehn Laufzeit-Derivate für Warnrisse, Hauptbruch, Segment-Ablösungen und
das Nachbröckeln des Arena-Collapse. Erzeugt ausschließlich aus den vier unten
dokumentierten realen CC0-Aufnahmen — keine Synthese. Die Schnitte sind
vollständig reproduzierbar über `tools/sfx/build_ring_collapse_sfx.js`
(dokumentierte Schnittliste: Quelle, Zeitbereich, Blenden, Gain, Highpass,
Zieldatei; Bearbeitung nur: Schneiden, kurze Blenden, Peak-Normalisierung,
dezenter Highpass, Mono-Downmix, leicht zeitversetzte Kombination).

**Onset-Korrektur (Auto-Trim):** Jeder Schnitt wird im Build nachgelagert exakt
beschnitten, sodass der erste klar hörbare Haupttransient (erstes Sample ≥ 50 %
des Datei-Peaks) bei ~4 ms nach Samplebeginn liegt (Sicherheitsrand 4 ms,
Click-freier 2,5-ms-Fade-in davor, Attack unangetastet; Limit ≤ 10 ms, Build
bricht sonst ab). Damit klingt ein zum sichtbaren Ereignis gestartetes Buffer
SOFORT — kein „technisch pünktlich, aber hörbar verspätet".
Transienten-Analyse der Quellen: `tools/sfx/scan_ring_collapse_sources.js`;
Onset-Prüfung der Derivate: `tools/sfx/analyze_ring_collapse_onsets.js --limit-ms 10`.

Format: WAV PCM16/48 kHz mono — auf allen Ziel-Browsern (inkl. Safari/iPhone)
via `decodeAudioData` dekodierbar und ohne zweite Lossy-Generation über den
MP3-Quellen. Vorgeladen ab Matchstart (`SFX.colPreload`, ~50–60 s vor dem
Warnfenster); fehlende Dateien ⇒ das einzelne Ereignis bleibt bewusst still,
nie verspätetes Nachholen. Abgespielt werden die Derivate ausschließlich
read-only aus den sichtbaren Zustandswechseln des visuellen Collapse-Adapters
(`colvTick` → `SFX.colvEvent`); es gibt keinen separaten Cue-/Timer-Pfad.

| Datei | Inhalt | Quelle(n) |
|---|---|---|
| `crack_1.wav` | trockener Warnriss (0,29 s) | 569497 @ 0,028s |
| `crack_2.wav` | Warnriss-Variante (0,32 s) | 512243 @ 0,345s |
| `crack_3.wav` | Warnriss-Variante (0,32 s) | 512243 @ 2,645s |
| `crack_4.wav` | Warnriss-Variante (0,29 s) | 512243 @ 4,170s |
| `seg_1..3.wav` | Segment-Bruchimpulse (0,67–0,73 s, Attack + kurzer Schwanz) | 512243 @ 0,345/2,645/4,170s |
| `break_main.wav` | Hauptbruch (1,42 s): trockener Erstriss + ~90 ms später breiterer Doppel-Bruch | 569497 @ 0,028s + 512243 @ 6,560s |
| `fragc_1..3.wav` | grobe Trümmerfragmente (0,27–0,31 s): einzelne fallende Steine für Segment-/Sockelablösung | 567249 @ 0,80/1,13/1,53s |
| `fragf_1..3.wav` | feine Trümmerfragmente (0,21–0,23 s): Kies-Bröckeln fürs ausdünnende Nachbröckeln | 569746 @ 0,27/1,44/2,44s |

Der frühere lange `debris.wav`-Trümmer-Track (3,1 s) ist ersetzt: Nachbröckeln
besteht jetzt aus einzelnen kurzen Fragmenten, die die Runtime nur zu sichtbaren
Anlässen (Segment löst sich, Sockel fällt, aktive Fallbewegung) abspielt — der
Build entfernt veraltete Derivate automatisch aus `ring_collapse/`.

### Quellen (Verzeichnis `source/ring_collapse/`, alle CC0)

Alle vier am 2026-07-29 auf den offiziellen Freesound-Seiten geprüft
(Titel, Autor, Sound-ID, Lizenz-Link `creativecommons.org/publicdomain/zero/1.0/`);
geladen wurden die von Freesound öffentlich ausgelieferten HQ-Preview-MP3s
(das Original-WAV ist login-pflichtig). CC0 = Public Domain, keine
Attributionspflicht; kommerzielle Nutzung und Redistribution erlaubt.

| Originaldatei | Titel | Autor | ID | Quelle |
|---|---|---|---|---|
| `iwanplays_567249_bricks_stones_gravel_falling.mp3` | Bricks/Stones/Rocks/Gravel Falling | iwanPlays | 567249 | https://freesound.org/s/567249/ |
| `sheyvan_569497_stone_impact_rubble_debris_1.mp3` | Stone Impact Rubble Debris 1 | Sheyvan | 569497 | https://freesound.org/s/569497/ |
| `neospica_512243_rock_smash.mp3` | Rock Smash | NeoSpica | 512243 | https://freesound.org/s/512243/ |
| `sheyvan_569746_gravel_debris_falling_small.mp3` | Gravel Stone Dirt Debris Falling Small 1 13 | Sheyvan | 569746 | https://freesound.org/s/569746/ |

## marble_roll_loop.m4a

| | |
|---|---|
| **Verwendung im Spiel** | Rollsound der Kugeln (geladen von `rollUpdate` in `index.html`; Format-Präferenz m4a → mp3 → ogg → wav) |
| **Ursprünglicher Titel** | "Bowling Ball Rolling" (Datei `qubodup-bowling_roll-nofadeout.ogg` aus `qubodup-bowling-roll.7z`) |
| **Urheber** | qubodup |
| **Quelle** | OpenGameArt.org |
| **URL** | https://opengameart.org/content/bowling-ball-rolling |
| **Lizenz** | **CC0 (Public Domain)** — „This work is in the public domain with no restrictions." Keine Attributionspflicht; kommerzielle Nutzung und Redistribution (auch in diesem öffentlichen Repository) ausdrücklich erlaubt. |
| **Abgerufen am** | 2026-07-10 |
| **Aufnahme-Herkunft laut Autor** | Aufnahme einer rollenden Murmel (mit Audacity bearbeitet) |

### Vorgenommene Bearbeitungen (ffmpeg, 2026-07-10)

1. Gleichmäßiges Roll-Segment 0,6–2,6 s aus der „nofadeout"-Variante extrahiert (lauterer Anfang verworfen).
2. Downmix auf Mono, Resampling 96 kHz → 44,1 kHz.
3. Bandbegrenzung: Highpass 45 Hz (DC/Tiefst-Rumpeln), Lowpass 10 kHz (Rausch-Anteil).
4. **Nahtloser Loop**: die letzten 150 ms per Dreiecks-Crossfade in die ersten 150 ms überblendet (Loop-Punkt = knackfrei).
5. Peak-Normalisierung auf −3 dBFS.
6. Encoding: AAC (m4a), 96 kbit/s, mono — 1,85 s, 24 KB.
