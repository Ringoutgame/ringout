// Transienten-Scan der freigegebenen CC0-Quellaufnahmen (MP3) fuer die
// Fragment-Schnittliste in build_ring_collapse_sfx.js. Dekodiert wie der Build
// in Chromiums OfflineAudioContext (kein ffmpeg auf dem Zielsystem) und listet
// pro Datei die staerksten kurzen Transienten (10ms-Fenster-Peaks mit
// Mindestabstand) — daraus werden die Schnittpunkte reproduzierbar gewaehlt.
//
// Aufruf: node tools/sfx/scan_ring_collapse_sources.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const FILES = [
  'assets/sfx/source/ring_collapse/neospica_512243_rock_smash.mp3',
  'assets/sfx/source/ring_collapse/sheyvan_569497_stone_impact_rubble_debris_1.mp3',
  'assets/sfx/source/ring_collapse/iwanplays_567249_bricks_stones_gravel_falling.mp3',
  'assets/sfx/source/ring_collapse/sheyvan_569746_gravel_debris_falling_small.mp3',
];

(async () => {
  const PORT = 8811;
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

  for (const f of FILES) {
    const r = await page.evaluate(async (f) => {
      const SR = 48000;
      const off = new OfflineAudioContext(1, SR, SR);
      const res = await fetch(f);
      const buf = await off.decodeAudioData(await res.arrayBuffer());
      const d = buf.getChannelData(0), n = d.length;
      // 10ms-Fenster-Peaks
      const W = Math.round(buf.sampleRate * 0.01), env = [];
      for (let i = 0; i < n; i += W) {
        let m = 0; for (let j = i; j < Math.min(n, i + W); j++) { const a = Math.abs(d[j]); if (a > m) m = a; }
        env.push(m);
      }
      let peak = 0; for (const v of env) if (v > peak) peak = v;
      // Transient = lokales Envelope-Maximum mit deutlichem Anstieg gegenueber 60ms davor
      const cands = [];
      for (let i = 6; i < env.length - 1; i++) {
        const pre = Math.max(env[i - 4], env[i - 5], env[i - 6]);
        if (env[i] >= peak * 0.18 && env[i] >= env[i - 1] && env[i] >= env[i + 1] && env[i] > pre * 2.2)
          cands.push({ t: +(i * 0.01).toFixed(2), a: +(env[i] / peak).toFixed(2) });
      }
      // Mindestabstand 0.25s, staerkste zuerst behalten
      cands.sort((x, y) => y.a - x.a);
      const keep = [];
      for (const c of cands) if (keep.every((k) => Math.abs(k.t - c.t) >= 0.25)) keep.push(c);
      keep.sort((x, y) => x.t - y.t);
      return { dur: +(n / buf.sampleRate).toFixed(2), peak: +peak.toFixed(3), keep: keep.slice(0, 40) };
    }, f);
    console.log('\n' + f.split('/').pop() + '  dur=' + r.dur + 's peak=' + r.peak);
    console.log(r.keep.map((k) => `${k.t}s(${k.a})`).join('  ') || '(keine klaren Transienten)');
  }
  await browser.close(); server.close();
})().catch((e) => { console.error('SCAN-FEHLER:', e); process.exit(1); });
