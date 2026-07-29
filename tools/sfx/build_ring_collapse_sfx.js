// Reproduzierbarer Schnitt der Ring-Collapse-Laufzeitassets aus den vier
// freigegebenen CC0-Originalaufnahmen (assets/sfx/source/ring_collapse/).
//
// Es gibt keinen dekodierfaehigen ffmpeg auf dem Zielsystem — Dekodierung und
// Bearbeitung laufen deshalb in Chromiums OfflineAudioContext (Playwright,
// devDependency); geschrieben wird unkomprimiertes WAV (PCM16). WAV ist auf
// allen Ziel-Browsern (inkl. Safari/iPhone) via decodeAudioData dekodierbar
// und vermeidet eine zweite Lossy-Generation ueber den MP3-Quellen.
//
// Erlaubte Bearbeitungen laut Auftrag, hier verwendet: praezises Schneiden,
// kurze Ein-/Ausblendungen, Lautstaerkeanpassung (inkl. Peak-Normalisierung
// auf -3 dBFS), dezenter Highpass-EQ (nimmt Tritt-/Boden-Anteil, kein Boom),
// Mono-Downmix, leichte zeitversetzte Kombination zweier Quellen.
// NICHT verwendet: Synthese, Pitch-Shift, Time-Stretch, Hall, Kompression,
// Reverse, Granular.
//
// Aufruf:  node tools/sfx/build_ring_collapse_sfx.js
// Ausgabe: assets/sfx/ring_collapse/*.wav + Messprotokoll auf stdout.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = 'assets/sfx/source/ring_collapse/';
const OUT_DIR = path.join(ROOT, 'assets', 'sfx', 'ring_collapse');

const SRC = {
  impact: SRC_DIR + 'sheyvan_569497_stone_impact_rubble_debris_1.mp3',   // 1 trockener Stein-Impact
  smash:  SRC_DIR + 'neospica_512243_rock_smash.mp3',                    // 4 getrennte Bruch-Takes
  bricks: SRC_DIR + 'iwanplays_567249_bricks_stones_gravel_falling.mp3', // Truemmerfahne, klingt natuerlich aus
  gravel: SRC_DIR + 'sheyvan_569746_gravel_debris_falling_small.mp3',    // feines Nachbroeckeln
};

// ── Schnittliste (alle Zeiten in Sekunden der Originaldatei) ──
// layers: {src, in, dur, at, gain, fadeIn, fadeOut}; hp = Highpass in Hz;
// ch = Zielkanalzahl; norm = Ziel-Peak nach Rendern (-3 dBFS = 0.708).
// Die Schnittpunkte stammen aus der Transienten-Analyse der Quellen
// (tools/sfx/scan_ring_collapse_sources.js, 2026-07-29): smash-Takes bei
// 0.37 / 2.68 / 4.22 / 6.68 (Doppel-Hit); bricks-Einzeltransienten bei
// 0.83 / 1.16 / 1.56 (klingt ab ~2.8 s aus, kein End-Impact); gravel-Einzel-
// transienten bei 0.30 / 1.47 / 2.47 (der letzte Tick bei 3.84 bleibt aussen
// vor). Die in-Punkte liegen bewusst ~20-40 ms VOR dem Transienten — der
// exakte Beschnitt passiert nachgelagert im Auto-Trim (s. u.), nicht von Hand.
const CUTS = [
  // A) Warnriss-Varianten: trockene, kurze Einzelrisse (Attack ohne Geroell)
  { name: 'crack_1', ch: 1, hp: 200, norm: 0.708,
    layers: [{ src: 'impact', in: 0.028, dur: 0.30, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.07 }] },
  { name: 'crack_2', ch: 1, hp: 200, norm: 0.708,
    layers: [{ src: 'smash', in: 0.345, dur: 0.34, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.08 }] },
  { name: 'crack_3', ch: 1, hp: 200, norm: 0.708,
    layers: [{ src: 'smash', in: 2.645, dur: 0.33, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.08 }] },
  { name: 'crack_4', ch: 1, hp: 200, norm: 0.708,
    layers: [{ src: 'smash', in: 4.170, dur: 0.32, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.08 }] },
  // C) Segment-Bruch-Varianten: Attack + kurzer natuerlicher Geroell-Schwanz
  { name: 'seg_1', ch: 1, hp: 130, norm: 0.708,
    layers: [{ src: 'smash', in: 0.345, dur: 0.75, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.14 }] },
  { name: 'seg_2', ch: 1, hp: 130, norm: 0.708,
    layers: [{ src: 'smash', in: 2.645, dur: 0.72, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.14 }] },
  { name: 'seg_3', ch: 1, hp: 130, norm: 0.708,
    layers: [{ src: 'smash', in: 4.170, dur: 0.70, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.14 }] },
  // B) Hauptbruch: trockener Erstriss (impact), 90 ms spaeter der breitere
  //    Doppel-Bruch (smash-Take 4) mit natuerlichem Nachbrechen — zwei ECHTE
  //    Bruecher leicht versetzt, kein Einzel-Impact, kein Boom.
  { name: 'break_main', ch: 1, hp: 110, norm: 0.708,
    layers: [
      { src: 'impact', in: 0.028, dur: 0.55, at: 0.00, gain: 0.75, fadeIn: 0.003, fadeOut: 0.12 },
      { src: 'smash',  in: 6.560, dur: 1.34, at: 0.09, gain: 1.00, fadeIn: 0.004, fadeOut: 0.20 },
    ] },
  // D) Truemmerfragmente fuer das Nachbroeckeln: KEIN langer Debris-Track mehr,
  //    sondern einzelne kurze Fragmente, die die Runtime nur zu sichtbaren
  //    Anlaessen (Segment loest sich, Sockel faellt, aktive Fallbewegung)
  //    abspielt. fragc_* = groebere Einzelsteine (bricks), fragf_* = feines
  //    Kies-Broeckeln (gravel). Jeweils klarer Attack, kurzer Ausklang.
  { name: 'fragc_1', ch: 1, hp: 150, norm: 0.55,
    layers: [{ src: 'bricks', in: 0.800, dur: 0.34, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.10 }] },
  { name: 'fragc_2', ch: 1, hp: 150, norm: 0.55,
    layers: [{ src: 'bricks', in: 1.130, dur: 0.30, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.10 }] },
  { name: 'fragc_3', ch: 1, hp: 150, norm: 0.55,
    layers: [{ src: 'bricks', in: 1.530, dur: 0.32, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.10 }] },
  { name: 'fragf_1', ch: 1, hp: 260, norm: 0.50,
    layers: [{ src: 'gravel', in: 0.270, dur: 0.26, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.09 }] },
  { name: 'fragf_2', ch: 1, hp: 260, norm: 0.50,
    layers: [{ src: 'gravel', in: 1.440, dur: 0.24, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.09 }] },
  { name: 'fragf_3', ch: 1, hp: 260, norm: 0.50,
    layers: [{ src: 'gravel', in: 2.440, dur: 0.26, at: 0, gain: 1, fadeIn: 0.003, fadeOut: 0.09 }] },
];

// ── Auto-Trim (Onset-Korrektur) ──
// Ein Cue kann technisch puenktlich starten und trotzdem verspaetet WIRKEN,
// wenn vor dem hoerbaren Transienten Stille/Anlauf liegt (gemessen am alten
// Stand: 17-63 ms). Deshalb wird JEDER gerenderte Schnitt nachgelagert exakt
// beschnitten: Haupttransient = erstes Sample >= 50 % des Datei-Peaks; davor
// bleiben TRIM_PRE_S Sicherheitsrand, darueber ein kurzer linearer Fade-in
// (TRIM_FADE_S, endet VOR dem Transienten — der Attack bleibt hart). Ergebnis:
// Haupttransient liegt garantiert bei ~TRIM_PRE_S (<= 10 ms) im Sample.
const TRIM_PRE_S = 0.004;    // Sicherheitsrand vor dem Haupttransienten
const TRIM_FADE_S = 0.0025;  // Click-freier Fade-in im Sicherheitsrand

function wavEncode(chans, sr) {
  const ch = chans.length, len = chans[0].length, data = new Int16Array(len * ch);
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    data[i * ch + c] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + bytes.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(ch, 22);
  hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * ch * 2, 28); hdr.writeUInt16LE(ch * 2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([hdr, bytes]);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 8809;
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const p = path.join(ROOT, rel);
    if (path.relative(ROOT, p).startsWith('..') || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });

  for (const cut of CUTS) {
    const r = await page.evaluate(async ({ cut, SRC, TRIM_PRE_S, TRIM_FADE_S }) => {
      const SR = 48000;
      const total = Math.max(...cut.layers.map((l) => l.at + l.dur));
      const off = new OfflineAudioContext(cut.ch, Math.ceil(total * SR), SR);
      const cache = {};
      for (const l of cut.layers) {
        if (!cache[l.src]) {
          const res = await fetch(SRC[l.src]);
          if (!res.ok) throw new Error('fetch ' + l.src);
          cache[l.src] = await off.decodeAudioData(await res.arrayBuffer());
        }
        const s = off.createBufferSource(); s.buffer = cache[l.src];
        const g = off.createGain();
        // Blenden: linear rein/raus, dazwischen konstante Layer-Lautstaerke
        g.gain.setValueAtTime(0, l.at);
        g.gain.linearRampToValueAtTime(l.gain, l.at + l.fadeIn);
        g.gain.setValueAtTime(l.gain, l.at + l.dur - l.fadeOut);
        g.gain.linearRampToValueAtTime(0, l.at + l.dur);
        const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = cut.hp; hp.Q.value = 0.7;
        s.connect(g); g.connect(hp); hp.connect(off.destination);
        s.start(l.at, l.in, l.dur);
      }
      const buf = await off.startRendering();
      // Peak-Normalisierung auf das Ziel (dezente Lautstaerkeanpassung)
      let peak = 0;
      for (let c = 0; c < cut.ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
      const k = peak > 0 ? cut.norm / peak : 1;
      let chans = [];
      for (let c = 0; c < cut.ch; c++) { const d = buf.getChannelData(c); const o = new Array(d.length); for (let i = 0; i < d.length; i++) o[i] = d[i] * k; chans.push(o); }
      // Auto-Trim: Haupttransient (erstes Sample >= 50 % Peak, kanalgemittelt)
      // an den Samplebeginn ziehen — TRIM_PRE_S Rand, TRIM_FADE_S Fade-in.
      const monoOf = (cs) => cs[0].map((v, i) => cut.ch === 2 ? (v + cs[1][i]) / 2 : v);
      let m0 = monoOf(chans), onsetRaw = 0;
      for (let i = 0; i < m0.length; i++) if (Math.abs(m0[i]) >= cut.norm * 0.5) { onsetRaw = i; break; }
      const cutFrom = Math.max(0, onsetRaw - Math.round(TRIM_PRE_S * SR));
      const fadeN = Math.round(TRIM_FADE_S * SR);
      chans = chans.map((ch) => {
        const o = ch.slice(cutFrom);
        for (let i = 0; i < fadeN && i < o.length; i++) o[i] *= i / fadeN;
        return o;
      });
      // Messwerte fuer das Protokoll (nach Trim)
      const mono = monoOf(chans);
      let sum = 0, p2 = 0; for (const v of mono) { sum += v * v; const a = Math.abs(v); if (a > p2) p2 = a; }
      let onset = 0; for (let i = 0; i < mono.length; i++) if (Math.abs(mono[i]) >= p2 * 0.5) { onset = i; break; }
      const n = mono.length, tail = mono.slice(Math.max(0, n - Math.round(SR * 0.25)));
      let ts = 0, tp = 0; for (const v of tail) { ts += v * v; const a = Math.abs(v); if (a > tp) tp = a; }
      return { chans, sr: SR, dur: +(n / SR).toFixed(3), peak: +p2.toFixed(3),
        trimmedMs: +(cutFrom / SR * 1000).toFixed(1), onsetMs: +(onset / SR * 1000).toFixed(1),
        rms: +Math.sqrt(sum / n).toFixed(4), tailRms: +Math.sqrt(ts / tail.length).toFixed(4), tailPeak: +tp.toFixed(3) };
    }, { cut, SRC, TRIM_PRE_S, TRIM_FADE_S });
    if (r.onsetMs > 10) throw new Error(`${cut.name}: Haupttransient ${r.onsetMs} ms > 10 ms trotz Auto-Trim`);
    const wav = wavEncode(r.chans.map((a) => Float32Array.from(a)), r.sr);
    fs.writeFileSync(path.join(OUT_DIR, cut.name + '.wav'), wav);
    console.log(`${cut.name.padEnd(11)} ${String(r.dur).padStart(5)}s  peak=${r.peak}  rms=${r.rms}  vorlaufWeg=${r.trimmedMs}ms  transient=${r.onsetMs}ms  tailPeak=${r.tailPeak}  ${(wav.length / 1024).toFixed(0)} KB`);
  }
  // Veraltete Derivate entfernen, die nicht mehr in der Schnittliste stehen
  // (z. B. der fruehere lange debris-Track) — das Zielverzeichnis spiegelt
  // exakt die Schnittliste, Reste koennen nicht versehentlich geladen werden.
  const want = new Set(CUTS.map((c) => c.name + '.wav'));
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.wav') && !want.has(f)) { fs.unlinkSync(path.join(OUT_DIR, f)); console.log('entfernt (veraltet): ' + f); }
  }
  await browser.close(); server.close();
  console.log('Ziel:', OUT_DIR);
})().catch((e) => { console.error('BUILD-FEHLER:', e); process.exit(1); });
