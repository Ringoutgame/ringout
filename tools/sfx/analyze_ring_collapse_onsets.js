// Onset-Analyse der Ring-Collapse-Laufzeitderivate (assets/sfx/ring_collapse/).
//
// Misst pro WAV, wie viel "Vorlauf" (Stille / weicher Anlauf) vor dem ersten
// klar hoerbaren Transienten liegt. Genau dieser Vorlauf laesst einen technisch
// puenktlich gestarteten Cue verspaetet WIRKEN — er ist Teil der Ursachenanalyse
// und zugleich das Abnahmekriterium fuer den Neuschnitt (Haupttransient praktisch
// am Samplebeginn, Ziel <= 10 ms).
//
// Definitionen (rein auf den PCM-Daten, keine Heuristik zur Abspielzeit):
//   start10  = erster Sample-Index mit |x| >= 10 % des Datei-Peaks (hoerbarer Beginn)
//   attack50 = erster Sample-Index mit |x| >= 50 % des Datei-Peaks (Haupttransient)
//
// Aufruf: node tools/sfx/analyze_ring_collapse_onsets.js [--limit-ms 10]
// Exit 1, wenn --limit-ms gesetzt ist und ein attack50 darueber liegt.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'assets', 'sfx', 'ring_collapse');
const limIdx = process.argv.indexOf('--limit-ms');
const LIMIT_MS = limIdx > 0 ? parseFloat(process.argv[limIdx + 1]) : null;

function readWav(file) {
  const b = fs.readFileSync(file);
  const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24), n = b.readUInt32LE(40) / 2 / ch;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += b.readInt16LE(44 + (i * ch + c) * 2) / 32768;
    mono[i] = s / ch;
  }
  return { sr, mono, n };
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.wav')).sort();
if (!files.length) { console.error('keine WAV-Dateien unter ' + DIR); process.exit(1); }
let bad = 0;
console.log('Datei          Dauer   Peak   start10   attack50  (Vorlauf bis Haupttransient)');
for (const f of files) {
  const w = readWav(path.join(DIR, f));
  let peak = 0;
  for (let i = 0; i < w.n; i++) { const a = Math.abs(w.mono[i]); if (a > peak) peak = a; }
  const firstAbove = (k) => { for (let i = 0; i < w.n; i++) if (Math.abs(w.mono[i]) >= peak * k) return i; return -1; };
  const s10 = firstAbove(0.10) / w.sr * 1000, a50 = firstAbove(0.50) / w.sr * 1000;
  const over = LIMIT_MS != null && a50 > LIMIT_MS;
  if (over) bad++;
  console.log(
    f.replace('.wav', '').padEnd(14) +
    (w.n / w.sr).toFixed(3) + 's  ' + peak.toFixed(3) + '  ' +
    s10.toFixed(1).padStart(6) + 'ms  ' + a50.toFixed(1).padStart(7) + 'ms' +
    (over ? '  <-- UEBER LIMIT ' + LIMIT_MS + 'ms' : ''));
}
if (LIMIT_MS != null) {
  console.log(bad ? `\n${bad} Datei(en) ueber ${LIMIT_MS} ms` : `\nalle Haupttransienten <= ${LIMIT_MS} ms`);
  process.exit(bad ? 1 : 0);
}
