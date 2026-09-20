// ARENA FOOTBALL v11 - das Entscheidungsfenster des Clients muss dem der Rules entsprechen.
//
// Befund (SHOT RELIABILITY P1, 2026-09-20): fbV9FristMs gab nur fuer Protokoll 10 die
// acht Sekunden zurueck; ein v11-Raum bekam die alten sechs. Die Rules erzwingen fuer v10
// UND v11 acht. Folge: der Fristwecker jedes Clients feuerte bei ~6,25 s, seine drei
// Versuche (6,25 / 6,75 / 8,25 s) wurden bis zur echten Frist abgewiesen - sichtbar als
// permission_denied in jeder Runde -, und lief die Client-Uhr nur eine Viertelsekunde vor,
// waren ALLE DREI zu frueh: danach schloss niemand mehr einen offenen Slot, die Runde stand.
// Das HUD zeigte zudem "Zeit abgelaufen" bei sechs Sekunden.
//
// Geprueft werden die ECHTEN Funktionen aus index.html (fbV9FristMs, fbV9WakePlan,
// fbV9WakeDelay, fbV9WakeArm, fbV9WakeStop, Konstanten) gegen eine virtuelle Uhr und
// einen Server, der `late` genau wie die Rules erst nach dem Fenster annimmt.
const { loadIndexHtml, grab } = require('./extract');
const fs = require('fs'), path = require('path');
const html = loadIndexHtml();
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.rules.json'), 'utf8')).rules;

let pass = 0, fail = 0;
const t = (name, ok, info) => { if (ok) { pass++; console.log('  [OK]   ' + name); } else { fail++; console.log('  [FAIL] ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); } };

const src = [
  grab(html, /const FB_V9_DEADLINE_MS=\d+;/, 'FB_V9_DEADLINE_MS'),
  grab(html, /const FB_V10_DEADLINE_MS=\d+;/, 'FB_V10_DEADLINE_MS'),
  grab(html, /function fbV9FristMs\(ctx\)\{[^\n]*\}/, 'fbV9FristMs'),
  grab(html, /const FB_V9_WAKE_MARGIN_MS=\d+;/, 'FB_V9_WAKE_MARGIN_MS'),
  grab(html, /const FB_V9_RETRY_MS=\[[^\]]*\];/, 'FB_V9_RETRY_MS'),
  grab(html, /function fbV9WakeStop\(lauf,art\)\{[\s\S]*?\n\}/, 'fbV9WakeStop'),
  grab(html, /function fbV9WakePlan\(lauf,art,frist,marke,tun,fenster\)\{[\s\S]*?\n\}/, 'fbV9WakePlan'),
  grab(html, /function fbV9WakeDelay\(frist,fenster\)\{[\s\S]*?\n\}/, 'fbV9WakeDelay'),
  grab(html, /function fbV9WakeArm\(lauf,art,ms,tun\)\{[\s\S]*?\n\}/, 'fbV9WakeArm'),
].join('\n');

// Die Rules: welches Fenster gilt fuer `late` je Protokollfassung?
const cRule = JSON.stringify(rules.rooms['$code'].g['$gen'].c);
const fensterRules = (v) => {
  const m = cRule.match(/\('v'\)\.val\(\) === 10 \|\| root\.child\('rooms'\)\.child\(\$code\)\.child\('v'\)\.val\(\) === 11\) \? (\d+) : (\d+)\)/);
  if (!m) return null;
  return (v === 10 || v === 11) ? Number(m[1]) : Number(m[2]);
};

// ── 1. Der Vertrag: Client-Fenster == Rules-Fenster je Fassung ──────────────────
{
  const M = new Function(src + '\nreturn { frist: fbV9FristMs, v9: FB_V9_DEADLINE_MS, v10: FB_V10_DEADLINE_MS };')();
  t('Rules kennen das Fenster je Fassung', fensterRules(11) !== null, cRule.slice(0, 80));
  for (const v of [9, 10, 11])
    t('Fassung ' + v + ': Client-Fenster (' + M.frist({ proto: v }) + ') == Rules-Fenster (' + fensterRules(v) + ')', M.frist({ proto: v }) === fensterRules(v));
  t('v11 rechnet mit acht Sekunden', M.frist({ proto: 11 }) === M.v10 && M.v10 === 8000);
  t('v9 behaelt seine sechs Sekunden', M.frist({ proto: 9 }) === M.v9 && M.v9 === 6000);
}

// ── 2. Der Wecker gegen einen Rules-treuen Server, mit Uhrversatz ──────────────
// versatz > 0: die Client-Uhr laeuft dem Server voraus. Der Server nimmt `late` an, sobald
// SEINE Zeit ueber o + Fenster liegt - genau die Rules-Bedingung.
function weckerLauf(proto, versatzMs, dauerMs) {
  const o = 1000000;   // Serverzeit der Rundenoeffnung
  let server = o;      // virtuelle Serverzeit
  const timer = []; let naechsteId = 1;
  const setTimeout = (fn, ms) => { const id = naechsteId++; timer.push({ id, due: server + ms, fn }); return id; };
  const clearTimeout = (id) => { const i = timer.findIndex(x => x.id === id); if (i >= 0) timer.splice(i, 1); };
  const serverNow = () => server + versatzMs;
  const versuche = [];
  const M = new Function('setTimeout', 'clearTimeout', 'serverNow', src +
    '\nfunction fbV9Aus(l){ return !l || l.stufe === "AUS"; }' +
    '\nreturn { plan: fbV9WakePlan, frist: fbV9FristMs };')(setTimeout, clearTimeout, serverNow);
  const lauf = { stufe: 'OFFEN', wecker: {} };
  const ctx = { proto };
  const fenster = M.frist(ctx);
  const rulesFenster = fensterRules(proto);
  let angenommen = null;
  const tun = () => { const zuFrueh = !(server > o + rulesFenster); versuche.push({ bei: server - o, abgewiesen: zuFrueh });
    if (!zuFrueh && angenommen === null) { angenommen = server - o; lauf.stufe = 'AUS'; } return Promise.resolve(zuFrueh); };
  M.plan(lauf, 'commits', o + fenster, 'marke', tun, fenster);
  // Virtuelle Zeit laufen lassen: faellige Timer feuern, Promises abarbeiten.
  return (async () => {
    const ende = o + dauerMs;
    for (;;) {
      timer.sort((a, b) => a.due - b.due);
      const n = timer[0];
      if (!n || n.due > ende) break;
      timer.shift(); server = n.due; n.fn();
      for (let k = 0; k < 4; k++) await new Promise(r => setImmediate(r));
    }
    server = ende;
    return { versuche, angenommen };
  })();
}

(async () => {
  // A: ohne Uhrversatz - der erste Versuch muss sitzen (8,25 s), keine Abweisung.
  { const r = await weckerLauf(11, 0, 30000);
    t('A v11 ohne Versatz: der erste Versuch wird angenommen', r.versuche.length === 1 && r.versuche[0].abgewiesen === false, r.versuche);
    t('A ... bei ~8,25 s', r.angenommen !== null && r.angenommen >= 8000 && r.angenommen <= 8500, r.angenommen); }
  // B: die Client-Uhr laeuft 300 ms vor - das war der Stillstand: alle drei Versuche zu frueh.
  { const r = await weckerLauf(11, 300, 30000);
    t('B v11, Uhr 300 ms voraus: die Runde wird trotzdem geschlossen', r.angenommen !== null, r.versuche);
    t('B ... spaetestens mit dem zweiten Versuch', r.versuche.length <= 2, r.versuche); }
  // C: die Client-Uhr haengt 800 ms nach (wie im Live-Mitschnitt) - erster Versuch sitzt.
  { const r = await weckerLauf(11, -800, 30000);
    t('C v11, Uhr 800 ms nach: angenommen, keine Abweisung', r.angenommen !== null && r.versuche.every(v => !v.abgewiesen), r.versuche); }
  // D: v10 verhaelt sich unveraendert wie v11.
  { const a = await weckerLauf(10, 0, 30000), b = await weckerLauf(11, 0, 30000);
    t('D v10 und v11 schliessen zum selben Zeitpunkt', a.angenommen === b.angenommen, [a.angenommen, b.angenommen]); }
  // E: v9 bleibt bei sechs Sekunden - und wird vom Rules-Fenster 6000 sofort angenommen.
  { const r = await weckerLauf(9, 0, 30000);
    t('E v9: erster Versuch bei ~6,25 s angenommen', r.versuche.length === 1 && r.angenommen >= 6000 && r.angenommen <= 6500, r); }
  // F: das Budget bleibt begrenzt - kein vierter Versuch ohne neuen Schnappschuss.
  { const r = await weckerLauf(11, 2600, 60000);   // absurder Versatz: alle Versuche zu frueh
    t('F absurder Versatz (2,6 s): hoechstens drei Versuche, dann Ruhe', r.versuche.length === 3 && r.angenommen === null, r.versuche); }

  // ── 3. Das HUD rechnet mit demselben Fenster ────────────────────────────────
  t('HUD-Restzeit nutzt fbV9FristMs (kein zweites Fenster)', /const fenster=fbV9FristMs\(L\.ctx\);/.test(html));
  t('Der Commit-Wecker nutzt fbV9FristMs (kein zweites Fenster)', /const frist=fbV9FristMs\(lauf\.ctx\);\s*\n\s*fbV9WakePlan\(lauf,'commits',st\.turnOpen\.o\+frist,/.test(html));

  console.log(`\nFootball-Frist-v11: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
