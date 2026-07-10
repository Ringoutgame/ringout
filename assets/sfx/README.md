# SFX-Assets — Lizenzen & Quellen

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
