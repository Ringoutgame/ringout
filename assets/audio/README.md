# Audio-Assets — Lizenzen & Quellen

## arena_football_goal.ogg / arena_football_goal.mp3

| | |
|---|---|
| **Verwendung im Spiel** | Torsound in Arena Football (geladen von `SFX.footballGoal` in `index.html`; Format-Präferenz ogg → mp3) |
| **Ursprünglicher Titel** | „Cinematic Designed Sci-Fi Whoosh - Transition - NexaWave" |
| **Urheber** | RescopicSound |
| **Quelle** | Pixabay Sound Effects |
| **URL** | https://pixabay.com/sound-effects/film-special-effects-cinematic-designed-sci-fi-whoosh-transition-nexawave-228295/ |
| **Lizenz** | **Pixabay Content License** — kommerzielle Nutzung im eigenen Spielprojekt erlaubt, Bearbeitung/Schneiden erlaubt, Attribution nicht verpflichtend. |
| **Attribution** | Freiwillig. Dieser Eintrag dient als freiwillige Nennung. |

## arena_football_transition_reconfigure.wav / arena_football_transition_lock.wav

| | |
|---|---|
| **Verwendung im Spiel** | Arena-Umbauten der Elimination (4→3 und 3→2). Geladen von `SFX.fbTransitionBed` / `SFX.fbTransitionLock` in `index.html` |
| **Quelle** | **dieselbe Datei wie der Torsound** — „Cinematic Designed Sci-Fi Whoosh - Transition - NexaWave", RescopicSound, Pixabay Sound Effects |
| **Lizenz** | **Pixabay Content License** — identisch zum Torsound, kein neuer Lizenzgeber |

Die Quelldatei enthält **drei durch Stille getrennte Klangvarianten**. Der Torsound benutzt
ausschließlich Variante 2. Die beiden Transitionsklänge stammen aus den bis dahin
**ungenutzten** Varianten 1 und 3 — die Arena bleibt dadurch akustisch ein System, ohne dass
eine zweite Quelle oder ein fremdes Timbre dazukommt.

| Variante | Bereich in der Quelle | Verwendung |
|---|---|---|
| 1 | 0,17 – 3,59 s | **Transition Reconfigure** |
| 2 | 4,75 – 7,27 s | Torsound (unverändert) |
| 3 | 8,46 – 14,24 s | **Transition Lock** |

### Vorgenommene Bearbeitungen (2026-08-27)

Erlaubt sind Schnitt, Fades, Gain, leichte Tonhöhenänderung und EQ. Jede Datei benutzt
**genau eine** Quelle — kein Layering, kein zusätzlicher Hall, keine Kompression.

**`arena_football_transition_reconfigure.wav`** — 1,300 s, 48 kHz Stereo, 244 kB
- Variante 1 ab 0,170 s · Wiedergaberate **0,92** (tiefer, langsamer)
- Hochpass 60 Hz · Peaking 320 Hz **+3,0 dB** · Tiefpass 6,5 kHz
- Fades 30 ms ein / 180 ms aus (Raised-Cosine) · Peak −1,6 dBFS · RMS −16,6 dBFS
- Der Ausschnitt endet 67 ms **vor** der Spitze der Quelle: er baut auf und überlässt den
  Akzent dem Einrastmoment.

**`arena_football_transition_lock.wav`** — 0,190 s, 48 kHz Stereo, 36 kB
- Variante 3 ab 10,575 s (12 ms Vorlauf vor der gemessenen Spitze) · Rate **0,85**
- Hochpass 90 Hz · Peaking 1,6 kHz **+5,0 dB** · Tiefpass 9 kHz
- Fades 4 ms ein / 150 ms aus · Peak −1,6 dBFS · RMS −14,2 dBFS

### Format: WAV statt Ogg/MP3

Im Projekt ist **kein** Audio-Encoder vorhanden (`ffmpeg`, `sox`, `lame`, `oggenc`,
`opusenc` — alle nicht installiert) und es gibt keine Konvertierungspipeline im Repository.
Für zwei kurze Klänge eine Encoder-Toolchain aufzubauen wäre unverhältnismäßig, deshalb
liegen sie als 16-Bit-PCM-WAV vor (zusammen 280 kB). `decodeAudioData` liest WAV in allen
Zielbrowsern; der Dev-Server liefert den passenden MIME-Typ. Die spätere Kompression nach
Ogg/MP3 steht als P2 in `TODO.md`.

### Pegel gegenüber dem Torsound

Der Torsound bleibt der lauteste Moment (RMS −11,8 dBFS × Gain 0,80 = −13,7 dBFS effektiv).
Das Bett liegt mit Gain **0,77** bei ~56 %, der Akzent mit Gain **0,69** bei ~66 % seiner
wahrgenommenen Lautheit. Eine Überlagerung ist strukturell ausgeschlossen: zwischen dem Ende
des Torsounds und dem Beginn des Bettes liegen **0,63 s** (Ballfall 72 + Celebration 51 +
Hold 12 Ticks).

---

### Weitergabe im Repository — wichtige Einschränkung

Die Pixabay Content License untersagt die Weitergabe des Materials auf **Standalone-Basis**, also
unbearbeitet und in praktisch unveränderter Form.

Daraus folgt für dieses Repository:

- ✅ **Im Repository:** `arena_football_goal.ogg` und `arena_football_goal.mp3`. Beide sind ein
  substanziell bearbeiteter Ausschnitt (1,618 s aus einer 14,808 s langen Quelle, geschnitten,
  gefadet, pegelangepasst) und werden ausschließlich als funktionaler Bestandteil des Spiels
  ausgeliefert — kein eigenständiges Soundpaket.
- ❌ **Nicht im Repository:** die unbearbeitete Quelldatei. Sie bleibt lokale Entwicklungsvorlage.
  Ein Commit der Rohdatei wäre eine Standalone-Weitergabe und damit ein Lizenzverstoß.
- ❌ **Nicht erlaubt:** die Assets als separates Soundpaket oder als praktisch unveränderte
  Einzeldatei weiterzuvertreiben.

Wer den Schnitt reproduzieren will, benötigt die Quelldatei über die oben genannte URL.

### Vorgenommene Bearbeitungen (2026-08-06)

Die Quelldatei enthält drei durch Stille getrennte Klangvarianten (0,18–3,57 s / 4,75–7,23 s /
8,50–14,14 s). Verwendet wird **ausschließlich Variante 2**; Variante 1 und 3 sind nicht Teil des
Assets.

1. **Grobschnitt (Audio-Phase 2):** Variante 2 ab dem gemessenen Signalbeginn 4,7354 s, Länge
   2,050 s — die Rohgrenzen wurden per RMS-Hüllkurve gegen die tatsächliche digitale Stille
   bestimmt, nicht geschätzt.
2. **Feinschnitt des Anfangs (Audio-Phase 2B):** Die Quelle beginnt mit einem ~467 ms langen
   Crescendo-Aufbau, wodurch der akustische Impact deutlich nach der Torwertung lag. Der
   wahrgenommene Hauptimpact wurde per Spectral Flux, High-Frequency-Content, RMS-Anstiegsrate
   und Peak-Trajektorie auf 5,2026 s bestimmt (erster Schlag auf Vollpegel, +10 dB Energiesprung
   über 4 ms — bewusst **nicht** der ~110 ms später liegende absolute Spitzenpegel). Neuer
   Schnittanfang 5,1676 s, also **35 ms Vorlauf**. Der Endpunkt blieb unverändert.
3. **Fades:** Fade-in 6 ms, Fade-out 130 ms, beide Raised-Cosine — klickfrei am Anfang, weicher
   Ausklang am Ende.
4. **Pegel:** Peak-Absenkung um 0,68 dB auf −1,6 dBFS vor dem Encoding (Headroom, kein Clipping).
   Keine Normalisierung nach oben, keine Kompression — die Originaldynamik bleibt erhalten.
5. **Nicht verändert:** kein Pitch-Shift, kein Time-Stretch, kein zusätzlicher Hall, kein
   zusätzlicher Bass, keine Layer-Mischung.
6. **Encoding:** Ogg/Vorbis (VBR q0.75) und MP3 als Safari-Fallback, beide 48 kHz Stereo,
   1,6178 s (77656 Samples, in beiden Formaten identisch), Peak −1,32 / −1,35 dBFS, 0 geclippte
   Samples.
