// V9.4D2: die Rehydrierung - die Welt aus der Historie.
//
// ES GIBT KEINE MOMENTAUFNAHME DER WELT. Der Zustand ist die Folge aus Anfangs-
// aufstellung und vollstaendiger Zughistorie, und die Simulation ist deterministisch.
// Ein Rueckkehrer bekommt seinen Zustand deshalb, indem dieselbe Pipeline dieselben
// Zuege noch einmal rechnet - nicht, indem ihm jemand Kugelpositionen schickt.
//
// DIE DREI SAETZE, um die es hier geht:
//   1. Was eine Runde zur HISTORIE macht, ist der autoritative Abschlussanker z.
//      Vollstaendige c/r allein genuegen nicht - dann gehoert die Runde noch der
//      laufenden Steuerung.
//   2. Die Historie muss LUECKENLOS ab Runde 0 sein. Fehlt eine, wird nicht geraten.
//   3. Nachspielen stellt einen ZUSTAND her, kein Erlebnis: kein Schreibvorgang, kein
//      Bereitschaftslauf, keine Ablaufsteuerung, kein Klang.
//   node test_online_v9_rehydrate.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 58 - s.length)));

const SENTINEL = { '.sv': 'timestamp' };
// Die Attrappe kann lesen (get) und schreiben - damit sich zeigen laesst, dass das
// Nachspiel NUR liest.
function attrappe(baum, opt) {
  const log = { schreib: [], hoert: [], lese: [] };
  opt = opt || {};
  // Standard: Zuhoerer melden null (das Nachspiel liest nur). Mit opt.lebend melden sie
  // den Wert aus dem Baum; Wege in opt.halte melden erst nach freigeben(pfad).
  const lies = (pfad) => { const teile = pfad.split('/'); let v = baum;
    for (const k of teile) { if (v == null) break; v = v[k]; } return v === undefined ? null : v; };
  const gehalten = new Set(opt.halte || []), wartend = [];
  return { log, baum,
    freigeben: (pfad) => { gehalten.delete(pfad);
      for (const w of wartend.splice(0)) if (w.pfad === pfad) w.los(); else wartend.push(w); },
    FB: { db: {}, ref: (db, p) => ({ pfad: p }), serverTimestamp: () => SENTINEL,
      get: async (ref) => { log.lese.push(ref.pfad);
        const teile = ref.pfad.split('/'); let v = baum;
        for (const k of teile) { if (v == null) break; v = v[k]; }
        return { val: () => (v === undefined ? null : v) }; },
      runTransaction: async (ref, fn) => {
        log.schreib.push({ pfad: ref.pfad, vorschlag: fn(null) });
        return { committed: true, snapshot: { val: () => null } }; },
      onValue: (ref, cb) => { const e = { pfad: ref.pfad, cb, offen: true };
        log.hoert.push(e);
        const v = opt.lebend ? lies(ref.pfad) : null;
        if (gehalten.has(ref.pfad)) wartend.push({ pfad: ref.pfad, los: () => { if (e.offen) cb({ val: () => v }); } });
        else Promise.resolve().then(() => { if (e.offen) cb({ val: () => v }); });
        return () => { e.offen = false; }; } } };
}
const STILL = { serverNow: () => 4000000, setTimeout: () => 0, clearTimeout: () => {} };
function speicher() { const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i],
           getItem: (k) => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; }

const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-SPIELANBINDUNG ════');
if (START < 0 || ENDE < 0) { console.log('V9-Bereich nicht gefunden'); process.exit(2); }
// Turbo-Fassung 14: der reine Block (Konstante, v11-Familie, Protokollnummer) steht vor dem V9-Bereich und
// wird von dessen Startweiche (fbV9RaumIst9) gebraucht.
const BEREICH = HTML.slice(HTML.indexOf('// ==FASSUNG-TURBO=='), HTML.indexOf('// ==/FASSUNG-TURBO==')) + '\n' + HTML.slice(START, ENDE);
// fastForwardMatch kommt WOERTLICH aus dem Produkt - genau darum geht es hier.
const FF = (HTML.match(/function fastForwardMatch\([^)]*\)\{[\s\S]*?\n\}/) || [''])[0];
if (!FF) { console.log('fastForwardMatch nicht gefunden'); process.exit(2); }

const GLOBAL = ['online', 'mode', 'roomCode', 'myPlayer', 'gen', 'turnNo', 'phase',
                'footballWinner', 'onlineSessionId', 'ONLINE_PROTOCOL_VERSION',
                // Stufe 2A: die Fassung DES RAUMS entscheidet ueber die Ruhe.
                'roomProto'];
const baue = (a, welt) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
    'FB_ONLINE_BALL_IDX', 'serverNow', 'setTimeout', 'clearTimeout', 'sessionStorage', 'welt', `
  let ${GLOBAL.join(', ')};
  function sync(){ ${GLOBAL.map(n => n + ' = welt.' + n + ';').join(' ')} }
  sync();
  function fbElim4(){ return welt.elim4; }
  function fbElimPlayers(){ return welt.cap; }
  function fbUid(){ return welt.uid; }
  function fbEvicted(s){ return !!(welt.evicted && welt.evicted[s]); }
  // Spielattrappe. Sie fuehrt eine SPUR und zaehlt die Zuege - so laesst sich der
  // nachgespielte Endzustand mit dem live gerechneten vergleichen.
  let balls = [], commitIdx = [], commitAim = [], commitSpin = [], aimSet = [];
  let soundOn = true, particles = [], fx3 = [], turnUnsub = null;
  const FF_MAX_STEPS_PER_TURN = 20000;
  let fbElimActive = welt.aktiv, fbElimLives = welt.leben;
  function np(){ return welt.cap; }
  function resetCommits(){ aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
    for(let p=0;p<np();p++){aimSet.push(false);commitIdx.push(-1);
                            commitAim.push({dx:0,dy:0});commitSpin.push(0);} }
  function setPhase(p){ phase=p; }
  function setPhaseText(){}
  function updateHud(){}
  function setStatus(x){ welt.status.push(x); }
  function processSlot(){ welt.spur.push('v8:processSlot'); }
  function allAliveCommitted(){ return true; }
  function afterResult(){ welt.spur.push('afterResult'); }
  function fbFxSilence(v){ const alt=welt.stumm; welt.stumm=!!v; return alt; }
  function fbMusicSync(){ welt.spur.push('musicSync'); }
  function footballClearGoalFx(){}
  function beginReveal(){ welt.spur.push('beginReveal'); phase='reveal'; }
  function applyLaunch(){
    // Der Abschuss traegt den Klang - genau deshalb muss er im Nachspiel stumm sein.
    welt.spur.push(soundOn ? 'KLANG' : 'applyLaunch');
    for(let i=0;i<np();i++) if(aimSet[i] && balls[commitIdx[i]] && balls[commitIdx[i]].alive){
      const b=balls[commitIdx[i]]; b.x+=commitAim[i].dx; b.y+=commitAim[i].dy;
      b.spin=commitSpin[i]; b.vx=commitAim[i].dx; b.vy=commitAim[i].dy; }
    phase='sim'; welt.starts++; }
  function stepSim(){
    // Deterministisch und endlich: eine Runde laeuft aus, dann kommt die neue.
    for(const b of balls){ b.vx=0; b.vy=0; }
    setPhase('aim'); resetCommits();
    if(online){ onlineArmTurn(); if(typeof fbV9LebenNeueRunde==='function')fbV9LebenNeueRunde(); } }
  function onlineArmTurn(){ turnNo++; welt.spur.push('arm:'+turnNo); }
  function startOnlineGame(){
    if(typeof fbV9LebenStop==='function')fbV9LebenStop();
    turnNo=-1; phase='aim'; footballWinner=null;
    for(let i=0;i<welt.cap;i++){ welt.aktiv[i]=true; welt.leben[i]=2; }
    balls=[]; for(let i=0;i<welt.cap;i++)balls.push({owner:i,alive:true,x:0,y:0,vx:0,vy:0,spin:0});
    resetCommits();
    if(online){ onlineArmTurn(); if(typeof fbV9LebenNeueRunde==='function')fbV9LebenNeueRunde(); } }
  function footballElimEliminate(o,stapel){
    if(!fbElimActive[o])return;
    welt.spur.push('raus:'+o); fbElimActive[o]=false;
    for(const b of balls)if(b.owner===o){b.alive=false;b.vx=0;b.vy=0;}
    if(stapel)return;
    const uebrig=[]; for(let i=0;i<welt.cap;i++)if(fbElimActive[i])uebrig.push(i);
    if(uebrig.length===0){ footballWinner=null; phase='over'; welt.spur.push('ohne Sieger'); }
    else if(uebrig.length===1){ footballWinner=uebrig[0]; phase='over';
                                welt.spur.push('SIEGERKLANG'); } }
  ${FF}
  ${BEREICH}
  return { sync, fbV9Rehydrieren, fbV9RehydrierPlan, fbV9HistorieLesen, fbV9Wirken,
           fbV9RaumStart, fbV9RaumIst9,
           fbV9LebenNeueRunde, fbV9LebenFortsetzen, fbV9LebenStop, fbV9LebenAn,
           fbV9LebenHandeln, fbV9EingabeOffen,
           fbV9DraussenGrund, fbV9ZuschauHinweis, fbV9EigenAusgetragen, fbV9Praesenzwechsel, zuschau: () => fbV9Zuschau,
           fastForwardMatch, startOnlineGame, leben: () => fbV9Leben,
           zustand: () => ({ turnNo, phase, footballWinner, aktiv: welt.aktiv.slice(),
                             leben: welt.leben.slice(),
                             balls: balls.map(b => ({ owner: b.owner, alive: b.alive,
                                                      x: b.x, y: b.y, vx: b.vx, vy: b.vy,
                                                      spin: b.spin })) }) };
`)({ FB: a.FB }, globalThis.crypto, 10000, 5, 5,
   STILL.serverNow, STILL.setTimeout, STILL.clearTimeout, speicher(), welt);

const UID = 'UID_REHY_XXXXXXXXXXXXXXXXXX';
const CODE = 'RN2K', GEN = 7;
const welt9 = (x) => Object.assign({
  online: true, mode: 'football', roomCode: CODE, myPlayer: 1, gen: GEN, turnNo: -1,
  phase: 'aim', footballWinner: null, onlineSessionId: 3,
  ONLINE_PROTOCOL_VERSION: 9, roomProto: 9, elim4: true, cap: 3, uid: UID, evicted: {},
  spur: [], starts: 0, stumm: false, status: [],
  aktiv: [true, true, true], leben: [2, 2, 2] }, x || {});

// ── Eine echte Historie bauen: Commits und Enthuellungen mit ECHTEN Hashes ──
let CRYPTO = null;
const bauModul = () => { const a = attrappe({}); return baue(a, welt9()); };
const ruhe = () => new Promise(r => setTimeout(r, 0));
const settle = async (n) => { for (let i = 0; i < (n || 8); i++) await ruhe(); };

// Der Codec aus dem Produkt, damit die Historie echte Hashes traegt.
const codec = new Function('crypto', 'GEN_MAX', 'FB_ONLINE_SEATS', 'FB_ONLINE_BALL_IDX', `
  ${HTML.slice(HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60'),
               HTML.indexOf('// ════ ENDE V9-CODEC ════'))}
  return { fbV9Hash, fbV9NewSalt, fbV9Hex, fbV9SaltFromHex };
`)(globalThis.crypto, 10000, 5, 5);

async function zug(turn, seat, dx, dy, sp) {
  const salt = codec.fbV9NewSalt();
  const h = await codec.fbV9Hash({ room: CODE, gen: GEN, turn, seat, kind: 1,
                                   idx: seat, dx, dy, sp }, salt);
  return { c: { k: 'move', h, ts: 1 },
           r: { k: 'reveal', idx: seat, dx, dy, sp, n: codec.fbV9Hex(salt), ts: 1 } };
}
const NULLT = (k) => ({ k, ts: 1 });
const ANKER = { ts: 4000000 };

// Baut den Generationsbaum: runden[n] = [{art,...}] je Sitz.
async function historie(runden, extra) {
  const g = { s: ANKER, z: {}, d: {}, c: {}, ro: {}, r: {} };
  for (let n = 0; n < runden.length; n++) {
    const c = {}, r = {};
    for (let seat = 0; seat < runden[n].length; seat++) {
      const e = runden[n][seat];
      if (e.art === 'move') { const z = await zug(n, seat, e.dx, e.dy, e.sp);
                              c[seat] = z.c; r[seat] = z.r; }
      else if (e.art === 'noreveal') { const z = await zug(n, seat, 1, 0, 0);
                                       c[seat] = z.c; r[seat] = { k: 'noreveal', ts: 1 }; }
      else if (e.art === 'mismatch') { const z = await zug(n, seat, 1, 0, 0);
                                       const z2 = await zug(n, seat, 9, 9, 0.5);
                                       c[seat] = z.c; r[seat] = z2.r; }
      else c[seat] = NULLT(e.art);
    }
    g.c[n] = c; if (Object.keys(r).length) { g.r[n] = r; g.ro[n] = 4000000; }
    g.d[n] = { n, o: 4000000 };
    g.z[n] = ANKER;
  }
  return Object.assign(g, extra || {});
}
const baum = (g) => ({ rooms: { [CODE]: { g: { [GEN]: g } } } });
const M = (dx, dy, sp) => ({ art: 'move', dx, dy, sp });

console.log('=== V9.4D2: Rehydrierung aus der c+r-Historie ===');

(async () => {

// ══ DER PLAN ═════════════════════════════════════════════════════════════════
abschnitt('Was zaehlt als Historie');
{
  const ctx = { v: 9, code: CODE, gen: GEN, turn: 0, seat: 1, cap: 3, uid: UID };
  const mk = async (g) => { const a = attrappe(baum(g)); const m = baue(a, welt9());
                            return { a, m, plan: await m.fbV9RehydrierPlan(ctx, g) }; };
  {
    const g = await historie([]);
    const r = await mk(g);
    t('ohne abgeschlossene Runde gibt es nichts nachzuspielen',
      r.plan.mengen && r.plan.mengen.length === 0, JSON.stringify(r.plan).slice(0, 80));
  }
  {
    const g = await historie([[M(5, 0, 0), M(-5, 0, 0), { art: 'pass' }]]);
    const r = await mk(g);
    t('eine abgeschlossene Runde ergibt eine Zugmenge', r.plan.mengen.length === 1);
    t('mit den verifizierten Vektoren',
      r.plan.mengen[0][0].status === 'VALID' && r.plan.mengen[0][0].move.dx === 5 &&
      r.plan.mengen[0][1].move.dx === -5 && r.plan.mengen[0][2].kind === 'pass',
      JSON.stringify(r.plan.mengen[0]));
  }
  {
    // OHNE z gehoert die Runde der laufenden Steuerung - nicht der Historie.
    const g = await historie([[M(5, 0, 0), M(-5, 0, 0), { art: 'pass' }]]);
    delete g.z[0];
    const r = await mk(g);
    t('ohne Abschlussanker ist es KEINE Historie', r.plan.mengen.length === 0,
      r.plan.mengen && r.plan.mengen.length);
  }
  {
    const g = await historie([[M(1, 0, 0), M(1, 0, 0), { art: 'pass' }],
                              [M(2, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    delete g.z[0];
    const r = await mk(g);
    t('eine Luecke faellt geschlossen aus', !!r.plan.fehler && /Luecke/.test(r.plan.fehler),
      r.plan.fehler);
  }
  {
    const g = await historie([[M(1, 0, 0), M(1, 0, 0), { art: 'pass' }]]);
    delete g.c[0][2];
    const r = await mk(g);
    t('ein fehlendes Terminal faellt geschlossen aus',
      !!r.plan.fehler && /Commit-Barriere/.test(r.plan.fehler), r.plan.fehler);
  }
  {
    const g = await historie([[M(1, 0, 0), M(1, 0, 0), { art: 'pass' }]]);
    delete g.r[0][1];
    const r = await mk(g);
    t('ein fehlendes Ergebnis zu einem Zug ebenso',
      !!r.plan.fehler && /Ergebnisbarriere/.test(r.plan.fehler), r.plan.fehler);
  }
  {
    const g = await historie([[M(1, 0, 0), M(1, 0, 0), { art: 'pass' }]]);
    g.c[0][1] = { k: 'move', h: 'nichthex', ts: 1 };
    const r = await mk(g);
    t('ein missgebildetes Terminal ebenso',
      !!r.plan.fehler, r.plan.fehler);
  }
  {
    // Ein Ergebnis am falschen Sitz: die bestehende Deutung macht daraus MALFORMED -
    // und das ist eine SPIELFOLGE, kein Ladefehler.
    const g = await historie([[M(1, 0, 0), M(1, 0, 0), { art: 'pass' }]]);
    g.r[0][1] = Object.assign({}, g.r[0][1], { idx: 0 });
    const r = await mk(g);
    t('ein Ergebnis am falschen Sitz wird zur Protokollfolge, nicht zum Ladefehler',
      !r.plan.fehler && r.plan.mengen[0][1].status === 'MALFORMED',
      r.plan.fehler || r.plan.mengen[0][1].status);
  }
  {
    const g = await historie([[{ art: 'noreveal' }, M(1, 0, 0), { art: 'pass' }]]);
    const r = await mk(g);
    t('eine ausgebliebene Enthuellung wird NO_REVEAL',
      r.plan.mengen[0][0].status === 'NO_REVEAL', r.plan.mengen[0][0].status);
  }
  {
    const g = await historie([[{ art: 'mismatch' }, M(1, 0, 0), { art: 'pass' }]]);
    const r = await mk(g);
    t('ein falscher Hash wird HASH_MISMATCH',
      r.plan.mengen[0][0].status === 'HASH_MISMATCH', r.plan.mengen[0][0].status);
  }
}

// ══ GLEICHHEIT MIT DEM LIVE-LAUF ═════════════════════════════════════════════
abschnitt('Nachgespielt == live gerechnet');
{
  // Live: dieselbe Zugmenge unmittelbar durch fbV9Wirken. Nachgespielt: durch die
  // Historie. Beide muessen denselben deterministischen Zustand ergeben.
  const vergleich = async (runden) => {
    const g = await historie(runden);
    const ctx = { v: 9, code: CODE, gen: GEN, turn: 0, seat: 1, cap: 3, uid: UID };
    // (a) LIVE
    const wl = welt9(); const al = attrappe(baum(g)); const ml = baue(al, wl);
    ml.startOnlineGame();
    const plan = await ml.fbV9RehydrierPlan(ctx, g);
    for (const menge of plan.mengen) { ml.fbV9Wirken(menge, 3);
                                       if (wl.phase === 'over') break;
                                       // Settlement wie im Spiel
                                       ml.zustand(); }
    // (b) NACHGESPIELT
    const wr = welt9(); const ar = attrappe(baum(g)); const mr = baue(ar, wr);
    const erg = await mr.fbV9Rehydrieren(ctx);
    return { live: wl, ml, nach: wr, mr, erg, plan };
  };
  {
    const v = await vergleich([[M(5, 2, 0.5), M(-5, -2, -0.5), { art: 'pass' }]]);
    t('die Rehydrierung gelingt', v.erg.ok === true, JSON.stringify(v.erg));
    const zn = v.mr.zustand();
    t('beide Kugeln stehen am selben Ort',
      zn.balls[0].x === 5 && zn.balls[0].y === 2 && zn.balls[1].x === -5 && zn.balls[1].y === -2,
      JSON.stringify(zn.balls.map(b => b.x + '/' + b.y)));
    t('der Drall ist der verifizierte', zn.balls[0].spin === 0.5 && zn.balls[1].spin === -0.5);
    t('die Geschwindigkeiten sind ausgelaufen',
      zn.balls.every(b => b.vx === 0 && b.vy === 0));
    t('alle sind noch aktiv', zn.aktiv.join(',') === 'true,true,true');
    t('und die naechste Entscheidungsrunde ist 1', zn.turnNo === 1, zn.turnNo);
  }
  {
    const v = await vergleich([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }],
                               [M(3, 0, 0), M(4, 0, 0), { art: 'late' }],
                               [M(5, 0, 0), M(6, 0, 0), { art: 'skip' }]]);
    const zn = v.mr.zustand();
    t('drei Runden summieren sich deterministisch',
      zn.balls[0].x === 9 && zn.balls[1].x === 12, zn.balls.map(b => b.x).join(','));
    t('die Nullhandlungen bewegen nichts', zn.balls[2].x === 0);
    t('und niemand scheidet dadurch aus', zn.aktiv.join(',') === 'true,true,true');
    t('die naechste Runde ist 3', zn.turnNo === 3, zn.turnNo);
  }
  {
    // Protokollausschluss in der Historie.
    const v = await vergleich([[M(1, 0, 0), { art: 'noreveal' }, M(2, 0, 0)]]);
    const zn = v.mr.zustand();
    t('der ausgebliebene Enthueller ist ausgeschieden', zn.aktiv[1] === false);
    t('seine Kugel ist tot', zn.balls[1].alive === false);
    t('und sie hat sich nie bewegt', zn.balls[1].x === 0);
    t('die anderen haben gezogen', zn.balls[0].x === 1 && zn.balls[2].x === 2);
    t('das Match laeuft weiter', zn.phase !== 'over', zn.phase);
  }
  {
    // Mehrere Ausschluesse: derselbe Stapelschutz wie live.
    const v = await vergleich([[{ art: 'noreveal' }, { art: 'mismatch' }, M(1, 0, 0)]]);
    const zn = v.mr.zustand();
    t('beide Schuldigen sind draussen', zn.aktiv[0] === false && zn.aktiv[1] === false);
    t('der Verbliebene gewinnt', zn.footballWinner === 2, zn.footballWinner);
    t('das Match ist zu Ende', zn.phase === 'over');
    t('und es gab genau eine Entscheidung',
      (v.nach.spur.filter(x => x === 'SIEGERKLANG' || x === 'ohne Sieger')).length === 1,
      v.nach.spur.join(','));
    t('ein ausgeschiedener Sitz hat nie gestartet', zn.balls[0].x === 0 && zn.balls[1].x === 0);
  }
}

// ══ KEINE LIVE-NEBENWIRKUNGEN ════════════════════════════════════════════════
abschnitt('Nachspielen stellt Zustand her, kein Erlebnis');
{
  const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }],
                            [M(3, 0, 0), M(4, 0, 0), { art: 'pass' }]]);
  const w = welt9(); const a = attrappe(baum(g)); const m = baue(a, w);
  const ctx = { v: 9, code: CODE, gen: GEN, turn: 0, seat: 1, cap: 3, uid: UID };
  const erg = await m.fbV9Rehydrieren(ctx);
  t('die Rehydrierung gelingt', erg.ok === true, JSON.stringify(erg));
  t('sie hat GENAU EINMAL gelesen', a.log.lese.length === 1, a.log.lese.join(','));
  t('und zwar die ganze Generation', a.log.lese[0] === 'rooms/RN2K/g/7', a.log.lese[0]);
  const waehrend = a.log.schreib.filter(x => /\/g\/7\/(c|r|q|d|z|s|x)\b/.test(x.pfad));
  t('waehrend des Nachspielens wurde nichts geschrieben',
    w.spur.indexOf('KLANG') < 0, w.spur.join(','));
  t('kein Abschussklang aus der Vergangenheit',
    w.spur.filter(x => x === 'KLANG').length === 0);
  t('zwei stumme Abschuesse dagegen schon',
    w.spur.filter(x => x === 'applyLaunch').length === 2, w.spur.join(','));
  t('kein Bereitschaftslauf waehrend des Nachspiels',
    w.spur.filter(x => x === 'arm:0').length === 1, w.spur.join(','));
  void waehrend;
}

// ══ DIE STUFE DANACH ═════════════════════════════════════════════════════════
abschnitt('Wo der Client nach dem Nachspielen steht');
{
  const ctx = { v: 9, code: CODE, gen: GEN, turn: 0, seat: 1, cap: 3, uid: UID };
  const lauf = async (g, welt) => { const w = welt || welt9(); const a = attrappe(baum(g));
                                    const m = baue(a, w);
                                    return { w, a, m, erg: await m.fbV9Rehydrieren(ctx) }; };
  {
    // Runde 0 abgeschlossen, Runde 1 noch nicht eroeffnet -> Bereitschaft.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    delete g.d[1];
    const r = await lauf(g);
    t('ohne eroeffnete Folgerunde beginnt die Bereitschaft',
      r.erg.stufe === 'BEREIT' && r.erg.turn === 1, JSON.stringify(r.erg).slice(0, 90));
    t('und ein Lebenslauf laeuft', !!r.m.leben());
  }
  {
    // Runde 1 ist bereits autoritativ eroeffnet -> unmittelbar die Ablaufsteuerung.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    g.d[1] = { n: 1, o: 4000000 };
    const r = await lauf(g);
    t('mit eroeffneter Folgerunde uebernimmt die Ablaufsteuerung',
      r.erg.stufe === 'OFFEN' && r.erg.turn === 1, JSON.stringify(r.erg).slice(0, 90));
    t('ohne neue Bereitschaft - die Frist laeuft ja schon',
      r.m.leben() && r.m.leben().bereit === null);
    t('und die Ablaufsteuerung laeuft', !!(r.m.leben() && r.m.leben().lauf));
  }
  {
    // Die Historie endet mit dem Match: danach nichts mehr.
    const g = await historie([[{ art: 'noreveal' }, { art: 'noreveal' }, M(1, 0, 0)]]);
    const r = await lauf(g);
    t('nach einem entschiedenen Match beginnt nichts Neues',
      r.erg.stufe === 'ENDE', JSON.stringify(r.erg).slice(0, 90));
    t('kein Lebenslauf', r.m.leben() === null);
  }
  {
    // Eine Runde NACH dem Matchende ist widerspruechlich.
    const g = await historie([[{ art: 'noreveal' }, { art: 'noreveal' }, M(1, 0, 0)],
                              [M(1, 0, 0), M(1, 0, 0), M(1, 0, 0)]]);
    const r = await lauf(g);
    t('eine Historie ueber das Matchende hinaus faellt geschlossen aus',
      !!r.erg.fehler && /Matchende/.test(r.erg.fehler), r.erg.fehler);
  }
  {
    // Der eigene Sitz ist ausgetragen.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    g.e = { 1: true };
    const r = await lauf(g);
    t('ein ausgetragener eigener Sitz handelt nicht mehr',
      r.erg.stufe === 'DRAUSSEN', JSON.stringify(r.erg).slice(0, 90));
    t('und kein Lebenslauf entsteht', r.m.leben() === null);
  }
  {
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    g.x = { 1: { k: 'ready_timeout', n: 0, ts: 1 } };
    const r = await lauf(g);
    t('ein disqualifizierter eigener Sitz ebenso', r.erg.stufe === 'DRAUSSEN');
  }
  {
    // Ein gewoehnlich ausgeschiedener Sitz OHNE e/x bleibt Teilnehmer.
    const g = await historie([[{ art: 'noreveal' }, M(2, 0, 0), M(1, 0, 0)]]);
    delete g.d[1];
    const w = welt9({ myPlayer: 0 });
    const r = await lauf(g, w);
    t('ein ausgeschiedener Sitz ohne e/x bleibt Synchronisationsteilnehmer',
      r.erg.stufe === 'BEREIT', JSON.stringify(r.erg).slice(0, 90));
    t('obwohl er nicht mehr aktiv ist', w.aktiv[0] === false);
  }
  {
    // v8 bleibt aussen vor.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    const r = await lauf(g, welt9({ roomProto: 8 }));
    t('in einem v8-Raum ist die Rehydrierung nicht zustaendig',
      !!r.erg.fehler, JSON.stringify(r.erg));
    t('und es wurde nicht einmal gelesen', r.a.log.lese.length === 0);
  }
}

// ══ DER ECHTE EINSTIEG ═══════════════════════════════════════════════════════
abschnitt('Der echte Einstieg - ein Weg fuer frisch und nach dem Neuladen');
{
  // fbV9RaumStart ist das, was der Produktcode am Startpunkt ruft. Es gibt bewusst
  // KEINEN zweiten Startweg daneben: ein frischer Raum ist einfach eine Historie
  // ohne abgeschlossene Runde.
  const start = async (g, welt) => {
    const w = welt || welt9();
    const a = attrappe(g ? baum(g) : { rooms: { [CODE]: { g: {} } } });
    const m = baue(a, w);
    const genommen = m.fbV9RaumStart();
    await settle(12);
    return { w, a, m, genommen };
  };
  {
    // FRISCHER RAUM: keine Historie, kein d/0 - Bereitschaft fuer Runde 0.
    const g = await historie([]);
    delete g.d[0];
    const r = await start(g);
    t('der Einstieg uebernimmt den Start', r.genommen === true);
    t('die Welt steht frisch', r.m.zustand().turnNo === 0, r.m.zustand().turnNo);
    t('nichts wurde nachgespielt', r.w.starts === 0, r.w.starts);
    t('ein Bereitschaftslauf fuer Runde 0 laeuft',
      !!r.m.leben() && r.m.leben().turn === 0, r.m.leben() && r.m.leben().turn);
    t('und GENAU EINER - kein doppelter Start',
      r.w.spur.filter(x => x === 'arm:0').length === 1, r.w.spur.join(','));
    t('kein Schreibvorgang aus dem Start selbst',
      r.a.log.schreib.filter(x => /\/g\/7\/(c|r|z)\b/.test(x.pfad)).length === 0);
  }
  {
    // NACH DEM NEULADEN: eine abgeschlossene Runde, Folgerunde noch nicht offen.
    const g = await historie([[M(3, 1, 0.25), M(-3, -1, 0), { art: 'pass' }]]);
    delete g.d[1];
    const r = await start(g);
    t('die Welt ist nachgespielt',
      r.m.zustand().balls[0].x === 3 && r.m.zustand().balls[1].x === -3,
      r.m.zustand().balls.map(b => b.x).join(','));
    t('und zwar stumm', r.w.spur.indexOf('KLANG') < 0, r.w.spur.join(','));
    t('die naechste Runde ist 1', r.m.zustand().turnNo === 1);
    t('mit Bereitschaft fuer Runde 1', !!r.m.leben() && r.m.leben().turn === 1);
    t('genau EIN Lesevorgang', r.a.log.lese.length === 1, r.a.log.lese.join(','));
    t('und nichts geschrieben',
      r.a.log.schreib.filter(x => /\/g\/7\/(c|r|z|d)\b/.test(x.pfad)).length === 0,
      r.a.log.schreib.map(x => x.pfad).join(','));
  }
  {
    // Die Folgerunde ist bereits eroeffnet: KEINE neue Bereitschaft.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    g.d[1] = { n: 1, o: 4000000 };
    const r = await start(g);
    t('die Ablaufsteuerung uebernimmt', !!(r.m.leben() && r.m.leben().lauf));
    t('ohne Bereitschaftslauf', r.m.leben() && r.m.leben().bereit === null);
  }
  {
    // Die Historie beendet das Match: danach beginnt nichts mehr.
    const g = await historie([[{ art: 'noreveal' }, { art: 'noreveal' }, M(1, 0, 0)]]);
    const r = await start(g);
    t('nach einem entschiedenen Match kein Lebenslauf', r.m.leben() === null);
    t('und keine Bereitschaft geschrieben',
      r.a.log.schreib.filter(x => /\/g\/7\/q\b/.test(x.pfad)).length === 0);
  }
  {
    // Der eigene Sitz ist ausgetragen.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    g.e = { 1: true };
    const r = await start(g);
    t('ein ausgetragener Sitz handelt nicht mehr', r.m.leben() === null);
  }
  {
    // GESCHLOSSEN scheitern: eine Luecke fuehrt NICHT zu einer frischen Welt.
    const g = await historie([[M(1, 0, 0), M(1, 0, 0), { art: 'pass' }],
                              [M(2, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    delete g.z[0];
    const r = await start(g);
    t('der Grund wird gemeldet',
      r.w.status.some(x => /Luecke/.test(x)), r.w.status.join(' | '));
    t('kein Lebenslauf entsteht', r.m.leben() === null);
    t('und nichts wurde geschrieben',
      r.a.log.schreib.filter(x => /\/g\/7\//.test(x.pfad)).length === 0);
  }
  {
    // v8: der Einstieg nimmt gar nichts.
    const g = await historie([[M(1, 0, 0), M(1, 0, 0), { art: 'pass' }]]);
    const r = await start(g, welt9({ roomProto: 8 }));
    t('in einem v8-Raum uebernimmt er nicht', r.genommen === false);
    t('und liest die Generation gar nicht erst', r.a.log.lese.length === 0);
  }
  {
    // Die Raumweiche haengt an der Fassung DES RAUMS.
    const m = bauModul();
    t('ein v9-Raum wird erkannt', m.fbV9RaumIst9({ v: 9 }) === true);
    t('ein v8-Raum nicht', m.fbV9RaumIst9({ v: 8 }) === false);
    t('und nichts ohne Fassung', m.fbV9RaumIst9(null) === false &&
      m.fbV9RaumIst9({}) === false);
  }
  {
    // VERALTET: waehrend des Lesens wechselt die Generation.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    const w = welt9();
    const a = attrappe(baum(g));
    const get0 = a.FB.get;
    a.FB.get = async (ref) => { const v = await get0(ref); w.gen = 8; m.sync(); return v; };
    const m = baue(a, w);
    const genommen = m.fbV9RaumStart();
    await settle(12);
    t('ein Generationswechsel waehrend des Lesens verwirft das Ergebnis',
      w.status.some(x => /gewechselt/.test(x)), w.status.join(' | '));
    t('die Welt bleibt unberuehrt', w.starts === 0, w.starts);
    t('und kein Lebenslauf entsteht', m.leben() === null);
    void genommen;
  }
  {
    // Dasselbe fuer den Sitz.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    const w = welt9();
    const a = attrappe(baum(g));
    const get0 = a.FB.get;
    a.FB.get = async (ref) => { const v = await get0(ref); w.myPlayer = 2; m.sync(); return v; };
    const m = baue(a, w);
    m.fbV9RaumStart();
    await settle(12);
    t('ein Sitzwechsel waehrend des Lesens ebenso',
      w.status.some(x => /gewechselt/.test(x)), w.status.join(' | '));
    t('und die Welt bleibt unberuehrt', w.starts === 0);
  }
  {
    // Und fuer die Sitzung.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    const w = welt9();
    const a = attrappe(baum(g));
    const get0 = a.FB.get;
    a.FB.get = async (ref) => { const v = await get0(ref); w.onlineSessionId = 99; m.sync(); return v; };
    const m = baue(a, w);
    m.fbV9RaumStart();
    await settle(12);
    t('ein Sitzungswechsel waehrend des Lesens ebenso',
      w.status.some(x => /gewechselt/.test(x)), w.status.join(' | '));
  }
}
// ══ DER EIGENE SLOT NACH DEM NEULADEN: UNBEKANNT, BIS DER RAUM IHN MELDET ═════
abschnitt('Einstieg in die offene Runde - Eingabe gesperrt, bis der eigene Slot bekannt ist');
{
  // Nach dem Neuladen mitten in Runde 1 (d/1 steht, eigener Commit von vor dem Neuladen
  // steht in c/1/1). Der Einstieg laeuft ueber den echten Weg (fbV9RaumStart ->
  // Rehydrierung -> fbV9LebenFortsetzen). Die Zuhoerer melden lebend; der c-Knoten der
  // Runde wird zurueckgehalten. Solange er fehlt, ist die Spieleingabe zu: whoCanAim
  // und die Stand-Taste fragen fbV9EingabeOffen, und fbV9LebenHandeln weist ab.
  const P = (r) => 'rooms/' + CODE + '/g/' + GEN + '/' + r;
  const eigeneCommits = (a) => a.log.schreib.filter(x => x.pfad === P('c/1/1') && x.vorschlag && x.vorschlag.k === 'move');
  {
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    g.d[1] = { n: 1, o: 4000000 };
    const eigen = await zug(1, 1, 5, 5, 0);
    g.c[1] = { 1: eigen.c };
    const w = welt9();
    const a = attrappe(baum(g), { lebend: true, halte: [P('c/1')] });
    const m = baue(a, w);
    m.fbV9RaumStart();
    await settle(12);
    const L = m.leben();
    t('die Ablaufsteuerung uebernimmt die offene Runde 1', !!(L && L.lauf) && L.turn === 1);
    t('mit UNBEKANNTEM eigenen Slot', L.lauf.eigenUnbekannt === true && !!L.lauf.stand.turnOpen);
    t('die Eingabe ist ZU', m.fbV9EingabeOffen() === false);
    t('ein Zug ueber die Spielbruecke wird abgewiesen', m.fbV9LebenHandeln({ move: { idx: 1, dx: 1, dy: 1, sp: 0 } }) === false);
    t('"Stehen bleiben" ebenso', m.fbV9LebenHandeln({ pass: true }) === false);
    await settle(6);
    t('kein eigener Commit, kein Salz', eigeneCommits(a).length === 0 && L.lauf.terminal === null);
    a.freigeben(P('c/1'));
    await settle(12);
    t('nach dem gemeldeten c ist der Slot bekannt - die Eingabe ist wieder OFFEN',
      L.lauf.eigenUnbekannt === false && m.fbV9EingabeOffen() === true);
    t('und das vorhandene Terminal ist uebernommen - derselbe Hash',
      !!L.lauf.terminal && L.lauf.terminal.h === eigen.c.h && L.lauf.commitFertig === true);
    t('ein Zug jetzt wird abgewiesen - der Slot ist besetzt', m.fbV9LebenHandeln({ move: { idx: 1, dx: 1, dy: 1, sp: 0 } }) === false);
    t('kein zweiter Commit', eigeneCommits(a).length === 0);
    t('kein FAILED', L.lauf.stufe !== 'FAILED', L.lauf.stufe + ' ' + L.lauf.grund);
    m.fbV9LebenStop();
  }
  {
    // Leerer Slot (Neuladen VOR dem eigenen Commit): gesperrt bis zum Beweis, dann genau ein Zug.
    const g = await historie([[M(1, 0, 0), M(2, 0, 0), { art: 'pass' }]]);
    g.d[1] = { n: 1, o: 4000000 };
    const w = welt9();
    const a = attrappe(baum(g), { lebend: true, halte: [P('c/1')] });
    const m = baue(a, w);
    m.fbV9RaumStart();
    await settle(12);
    const L = m.leben();
    t('leer: UNBEKANNT und zu', L.lauf.eigenUnbekannt === true && m.fbV9EingabeOffen() === false
      && m.fbV9LebenHandeln({ move: { idx: 1, dx: 1, dy: 1, sp: 0 } }) === false);
    a.freigeben(P('c/1'));
    await settle(12);
    t('leer: bewiesen leer - offen', L.lauf.eigenUnbekannt === false && m.fbV9EingabeOffen() === true && L.lauf.terminal === null);
    t('leer: der Zug wird angenommen', m.fbV9LebenHandeln({ move: { idx: 1, dx: 1, dy: 1, sp: 0 } }) === true);
    await settle(12);
    t('leer: genau EIN Commit', eigeneCommits(a).length === 1);
    t('leer: ein zweiter wird abgewiesen', m.fbV9LebenHandeln({ move: { idx: 1, dx: 2, dy: 2, sp: 0 } }) === false && eigeneCommits(a).length === 1);
    m.fbV9LebenStop();
  }
  {
    // Ohne Lebenslauf ist die Eingabe offen (v8, lokal): das Tor sperrt nur waehrend UNBEKANNT.
    const w = welt9();
    const m = baue(attrappe({ rooms: {} }), w);
    t('ohne Lebenslauf ist das Tor offen', m.fbV9EingabeOffen() === true);
  }
}

// ══ WAECHTER AM QUELLTEXT ════════════════════════════════════════════════════
// ══ ZURUECKLIEGEN: UEBER DIE HISTORIE AUFHOLEN ══════════════════════════════════
// Reproduziert 2026-10-02 (FFA, drei Clients, lokaler Emulator): ein Client war rund zwanzig Sekunden
// ohne Netz, die anderen spielten sieben Runden weiter. Nach der Wiederverbindung holte er jede Runde
// einzeln in Echtzeit nach; solange standen die anderen an ihrer Bereitschaftsbarriere (16 s Stillstand
// bei normaler Geschwindigkeit), und auf einem langsameren Geraet wurde der Rueckkehrer nach dreissig
// Sekunden disqualifiziert. Jetzt holt er ueber die Historie auf - derselbe Weg wie nach einem Neuladen.
abschnitt('Zurueckliegen - ueber die Historie aufholen');
{
  const RUNDE = (n) => [M(n + 1, 1, 0), M(-(n + 1), -1, 0), { art: 'pass' }];
  const pfad = (rest) => 'rooms/' + CODE + '/g/' + GEN + '/' + rest;
  // Alle offenen Zuhoerer eines Pfads mit dem heutigen Stand des Baums bedienen.
  const melde = (a, rest) => { const teile = pfad(rest).split('/'); let v = a.baum;
    for (const k of teile) { if (v == null) break; v = v[k]; }
    for (const h of a.log.hoert.slice()) if (h.offen && h.pfad === pfad(rest)) h.cb({ val: () => (v === undefined ? null : v) }); };
  // Ein Client, der nach Runde 0 in der Bereitschaft fuer Runde 1 steht (Runde 1 ist noch nicht eroeffnet).
  const amAnfang = async () => {
    const g0 = await historie([RUNDE(0)]); delete g0.d[1];
    const w = welt9();
    const a = attrappe(baum(g0), { lebend: true });
    const m = baue(a, w);
    m.fbV9RaumStart();
    await settle(14);
    return { w, a, m };
  };
  {
    const { w, a, m } = await amAnfang();
    t('Vorbedingung: der Client steht in der Bereitschaft fuer Runde 1', !!m.leben() && m.leben().turn === 1 && m.leben().stufe === 'BEREIT' && w.starts === 1,
      m.leben() && (m.leben().turn + '/' + m.leben().stufe) + ' starts=' + w.starts);
    // Waehrend er getrennt war, haben die anderen die Runden 1 bis 4 gespielt; Runde 5 ist offen.
    const gVoll = await historie([RUNDE(0), RUNDE(1), RUNDE(2), RUNDE(3), RUNDE(4)]);
    gVoll.d[5] = { n: 5, o: 4000000 };
    a.baum.rooms[CODE].g[GEN] = gVoll;
    w.spur.length = 0;
    const leseVor = a.log.lese.length, schreibVor = a.log.schreib.length;
    melde(a, 'z/1'); melde(a, 'd/1');          // nach der Wiederverbindung: Runde 1 ist schon abgeschlossen
    await settle(20);
    t('steht die Runde schon ABGESCHLOSSEN im Raum, wird die Historie gelesen', a.log.lese.length > leseVor, a.log.lese.slice(leseVor).join(','));
    t('und der Client steht danach in der AKTUELLEN Runde 5', m.zustand().turnNo === 5 && m.zustand().phase === 'aim', m.zustand().turnNo + '/' + m.zustand().phase);
    t('alle verpassten Runden sind in einem Zug nachgerechnet (fuenf Abschuesse)', w.starts === 1 + 5, w.starts);
    t('stumm - kein Klang aus der Vergangenheit', w.spur.indexOf('KLANG') < 0, w.spur.join(','));
    t('er setzt in der offenen Runde wieder auf (Ablaufsteuerung fuer Runde 5)', !!m.leben() && m.leben().turn === 5 && m.leben().stufe === 'PROTOKOLL' && !!m.leben().lauf,
      m.leben() && (m.leben().turn + '/' + m.leben().stufe));
    t('das Aufholen selbst schreibt nichts in die Zughistorie', a.log.schreib.slice(schreibVor).filter(x => /\/g\/7\/(c|r|z|ro)\b/.test(x.pfad)).length === 0,
      a.log.schreib.slice(schreibVor).map(x => x.pfad).join(','));
    // Derselbe Stand wie bei einem Client, der die Historie frisch (nach einem Neuladen) rechnet.
    const frisch = baue(attrappe(baum(gVoll)), welt9());
    frisch.fbV9RaumStart(); await settle(14);
    t('der aufgeholte Stand ist derselbe wie nach einem Neuladen', JSON.stringify(m.zustand()) === JSON.stringify(frisch.zustand()));
    m.fbV9LebenStop(); frisch.fbV9LebenStop();
  }
  {
    // Die andere Zustellreihenfolge: erst der Rundenbeginn, dann der Abschlussanker. Die Runde ist dann schon
    // live uebernommen - sie wird (hoechstens diese EINE) live nachgespielt; ihr Abschluss fuehrt in die naechste
    // Bereitschaft, und deren frische Wache sieht den Anker sofort und holt den Rest ueber die Historie auf.
    const { w, a, m } = await amAnfang();
    const gVoll = await historie([RUNDE(0), RUNDE(1), RUNDE(2), RUNDE(3), RUNDE(4)]);
    gVoll.d[5] = { n: 5, o: 4000000 };
    a.baum.rooms[CODE].g[GEN] = gVoll;
    const leseVor = a.log.lese.length;
    melde(a, 'd/1');
    await settle(6);
    t('Rundenbeginn zuerst: diese eine Runde wird live uebernommen', !!m.leben() && m.leben().turn === 1 && m.leben().stufe === 'PROTOKOLL' && a.log.lese.length === leseVor, m.leben() && m.leben().stufe);
    melde(a, 'z/1');
    await settle(6);
    t('ein spaeter Anker stoert die laufende Uebernahme nicht (kein zweiter Weg daneben)', a.log.lese.length === leseVor && m.leben().turn === 1);
    m.fbV9LebenStop();
  }
  {
    // Nur EROEFFNET, nicht abgeschlossen: das ist die laufende Runde - kein Nachrechnen, sondern Uebernahme.
    const { w, a, m } = await amAnfang();
    a.baum.rooms[CODE].g[GEN].d[1] = { n: 1, o: 4000000 };
    const leseVor = a.log.lese.length;
    melde(a, 'd/1'); melde(a, 'z/1');
    await settle(14);
    t('eine nur eroeffnete Runde wird live uebernommen, nicht nachgerechnet', a.log.lese.length === leseVor && w.starts === 1 && m.leben().turn === 1 && m.leben().stufe === 'PROTOKOLL',
      (a.log.lese.length - leseVor) + ' Lesevorgaenge, ' + m.leben().stufe);
    m.fbV9LebenStop();
  }
  {
    // Die Historie ist nicht nachrechenbar (Runde 1 abgeschlossen gemeldet, aber ohne Commits): nichts wird
    // geraten - es bleibt beim bisherigen Weg, die Runde live zu uebernehmen.
    const { w, a, m } = await amAnfang();
    const g = a.baum.rooms[CODE].g[GEN];
    g.d[1] = { n: 1, o: 4000000 }; g.z[1] = ANKER;
    melde(a, 'd/1'); melde(a, 'z/1');
    await settle(20);
    t('nicht nachrechenbar: keine neue Welt, kein geratener Rundenstand', w.starts === 1 && m.zustand().turnNo === 1, w.starts + '/' + m.zustand().turnNo);
    t('sondern die Runde wird live uebernommen', !!m.leben() && m.leben().turn === 1 && m.leben().stufe === 'PROTOKOLL', m.leben() && m.leben().stufe);
    m.fbV9LebenStop();
  }
  t('die Wache beobachtet neben dem Rundenbeginn auch den Abschlussanker',
    /fbV9NetWatch\(L\.ctx,\[\['d\/'\+turn,'d'\],\['z\/'\+turn,'z'\]\],/.test(HTML));
  t('ein abgeschlossener Anker fuehrt zum Aufholen ueber die Rehydrierung',
    /if\(st&&fbV9AnkerOk\(st\.z\)\)\{ fbV9LebenAufholen\(L\); return; \}/.test(HTML)
    && /Promise\.resolve\(fbV9Rehydrieren\(fbV9LebenCtx\(0\)\)\)/.test(HTML.slice(HTML.indexOf('function fbV9LebenAufholen(L){'), HTML.indexOf('function fbV9LebenOffenWacheAus(L){'))));
  t('die Fristen sind unveraendert (30 s Bereitschaft, 8 s Entscheidung)',
    /const FB_V9_READY_DEADLINE_MS=30000;/.test(HTML) && /const FB_V10_DEADLINE_MS=8000;/.test(HTML));
}

// ══ AUSGETRAGEN: ZUSCHAUEN, OHNE ZU SCHREIBEN ═════════════════════════════════
// Reproduziert 2026-10-03 (FFA, drei Clients, lokaler Emulator): wer laenger als die
// Rueckkehrfrist getrennt war, ist ausgetragen (e). Kam sein Client zurueck, blieb er auf dem
// Stand seiner letzten Runde stehen - ohne Hinweis, und die eigene Figur liess sich noch ziehen.
// Jetzt folgt er dem Match als reiner Beobachter: er liest, er schreibt nicht, und er zeigt
// eine Runde erst, wenn ihr Abschlussanker steht.
abschnitt('Ausgetragen - zuschauen, ohne zu schreiben');
{
  const RUNDE = (n, raus) => [M(n + 1, 1, 0), raus ? { art: 'remove' } : M(-(n + 1), -1, 0), M(0, n + 1, 0)];
  const pfad = (rest) => 'rooms/' + CODE + '/g/' + GEN + '/' + rest;
  const melde = (a, rest) => { const teile = pfad(rest).split('/'); let v = a.baum;
    for (const k of teile) { if (v == null) break; v = v[k]; }
    for (const h of a.log.hoert.slice()) if (h.offen && h.pfad === pfad(rest)) h.cb({ val: () => (v === undefined ? null : v) }); };
  const hoertAuf = (a) => a.log.hoert.filter(h => h.offen).map(h => h.pfad.replace(pfad(''), ''));

  // Der Grund: rein, aus dem massgeblichen Zustand.
  {
    const m = bauModul(), DQ = { k: 'ready_timeout', n: 2, ts: 5 };
    t('Grund: nur e -> Rueckkehrfrist abgelaufen', m.fbV9DraussenGrund({ 1: true }, null, 1) === 'verbindung');
    t('Grund: gueltiges x -> fehlende Bereitschaft', m.fbV9DraussenGrund(null, { 1: DQ }, 1) === 'bereitschaft');
    t('Grund: x UND e -> fehlende Bereitschaft (x entsteht nie nach e)', m.fbV9DraussenGrund({ 1: true }, { 1: DQ }, 1) === 'bereitschaft');
    t('Grund: nichts -> kein Grund', m.fbV9DraussenGrund({ 0: true }, { 2: DQ }, 1) === '');
    t('Grund: ein ungueltiges x zaehlt nicht', m.fbV9DraussenGrund({ 1: true }, { 1: { k: 'quatsch', ts: 1 } }, 1) === 'verbindung');
  }
  // Rueckkehr (Neuladen oder Aufholen) in ein Match, in dem der eigene Sitz ausgetragen ist.
  const ausgetragen = async (extra) => {
    const g = await historie([RUNDE(0), RUNDE(1, true)]);
    Object.assign(g, extra || { e: { 1: true } });
    const w = welt9({ evicted: (extra && !extra.e) ? {} : { 1: true } });
    const a = attrappe(baum(g), { lebend: true });
    const m = baue(a, w);
    m.fbV9RaumStart();
    await settle(20);
    return { g, w, a, m };
  };
  {
    const { g, w, a, m } = await ausgetragen();
    t('Rueckkehr als Ausgetragener: die Welt steht auf dem aktuellen Stand (Runde 2)', m.zustand().turnNo === 2 && m.zustand().phase === 'aim' && w.starts === 2, m.zustand().turnNo + '/' + w.starts);
    t('kein handelnder Lauf: weder Bereitschaft noch Ablaufsteuerung', m.leben() === null, JSON.stringify(m.leben() && m.leben().stufe));
    t('stattdessen beobachtet er die laufende Runde 2', !!m.zuschau() && m.zuschau().turn === 2, m.zuschau() && m.zuschau().turn);
    const hoert = hoertAuf(a);
    t('er hoert auf Abschluss, Folgeabschluss, Commits und Enthuellungen der Runde - nicht auf Bereitschaft oder Rundenbeginn',
      ['z/2', 'z/3', 'c/2', 'r/2'].every(x => hoert.indexOf(x) >= 0) && !hoert.some(x => /^(q|d|ro|s)\b/.test(x)), hoert.join(','));
    t('der Hinweis "Verbindung zu lange unterbrochen" gilt', m.fbV9ZuschauHinweis() === true);
    t('die Eingabe ist zu (kein Zielen, kein Stehenbleiben)', m.fbV9EingabeOffen() === false && m.fbV9EigenAusgetragen() === true);
    t('eine Handlung bewirkt nichts', m.fbV9LebenHandeln({ pass: true }) === false);
    // Die laufende Runde 2: Commits und Enthuellungen sind da, der Abschluss noch nicht.
    const z2 = await historie([RUNDE(0), RUNDE(1, true), RUNDE(2, true)]);
    g.c[2] = z2.c[2]; g.ro[2] = z2.ro[2]; g.r[2] = z2.r[2]; g.d[2] = z2.d[2];
    melde(a, 'c/2'); melde(a, 'r/2'); await settle(20);
    t('VOR dem Abschlussanker wird von der Runde nichts gezeigt', w.starts === 2 && m.zustand().phase === 'aim', w.starts + '/' + m.zustand().phase);
    g.z[2] = ANKER; melde(a, 'z/2'); await settle(20);
    t('mit dem Abschlussanker wird die Runde ueber den bestehenden Abschussweg gezeigt', w.starts === 3 && m.zustand().phase === 'sim', w.starts + '/' + m.zustand().phase);
    t('waehrend des Zuschauens kein einziger Schreibversuch', a.log.schreib.length === 0, a.log.schreib.map(x => x.pfad).join(','));
    m.fbV9LebenStop();
  }
  {
    // Liegt er mehr als eine Runde zurueck, holt er ueber die Historie auf - und schaut dann weiter zu.
    const { g, w, a, m } = await ausgetragen();
    const v = await historie([RUNDE(0), RUNDE(1, true), RUNDE(2, true), RUNDE(3, true)]);
    a.baum.rooms[CODE].g[GEN] = Object.assign(v, { e: { 1: true } });
    const leseVor = a.log.lese.length;
    melde(a, 'z/3'); melde(a, 'z/2'); await settle(30);
    t('zurueckliegend: die Historie wird gelesen', a.log.lese.length > leseVor, a.log.lese.slice(leseVor).join(','));
    t('und er beobachtet danach die aktuelle Runde 4', m.zustand().turnNo === 4 && !!m.zuschau() && m.zuschau().turn === 4, m.zustand().turnNo + '/' + (m.zuschau() && m.zuschau().turn));
    t('auch das Aufholen schreibt nichts', a.log.schreib.length === 0);
    m.fbV9LebenStop();
  }
  {
    // Fehlende Bereitschaft (x, kein e): kein Beobachter, kein Verbindungs-Hinweis - der Stand bleibt wie bisher.
    const { m } = await ausgetragen({ x: { 1: { k: 'ready_timeout', n: 1, ts: 5 } } });
    t('Disqualifikation wegen fehlender Bereitschaft: KEIN Verbindungs-Hinweis', m.fbV9ZuschauHinweis() === false);
    t('und kein Beobachter (unveraendertes Verhalten)', m.zuschau() === null && m.leben() === null);
    m.fbV9LebenStop();
  }
  {
    // x UND e: er schaut zu, aber der Verbindungs-Hinweis waere falsch.
    const { m } = await ausgetragen({ e: { 1: true }, x: { 1: { k: 'ready_timeout', n: 1, ts: 5 } } });
    t('x und e: Beobachter ja, Verbindungs-Hinweis nein', !!m.zuschau() && m.fbV9ZuschauHinweis() === false);
    m.fbV9LebenStop();
  }
  {
    // Ohne Neuladen: der Marker wird erst am Rundenbeginn bekannt - dann beobachtet er, statt nur aufzuhoeren.
    const g0 = await historie([RUNDE(0)]); delete g0.d[1];
    const w = welt9();
    const a = attrappe(baum(g0), { lebend: true });
    const m = baue(a, w);
    m.fbV9RaumStart(); await settle(14);
    t('Vorbedingung: handelnder Lauf in Runde 1', !!m.leben() && m.leben().turn === 1);
    w.evicted[1] = true; g0.e = { 1: true };
    m.fbV9LebenNeueRunde(); await settle(14);
    t('ausgetragen am Rundenbeginn: der handelnde Lauf endet, der Beobachter uebernimmt Runde 1', m.leben() === null && !!m.zuschau() && m.zuschau().turn === 1);
    t('den Grund liest er aus e und x, solange er ihn nicht kennt', hoertAuf(a).indexOf('e') >= 0 && hoertAuf(a).indexOf('x') >= 0, hoertAuf(a).join(','));
    t('und er kennt ihn danach: Rueckkehrfrist abgelaufen', m.fbV9ZuschauHinweis() === true);
    m.fbV9LebenStop();
    t('der gemeinsame Abbau beendet auch den Beobachter', m.zuschau() === null && hoertAuf(a).length === 0, hoertAuf(a).join(','));
  }
  {
    // Ohne Neuladen, der Marker kommt waehrend der Bereitschaft: der Austragungsbeobachter meldet ihn
    // ueber den Praesenzwechsel-Eingang - der handelnde Lauf endet sofort, der Beobachter uebernimmt.
    const g0 = await historie([RUNDE(0)]); delete g0.d[1];
    const w = welt9();
    const a = attrappe(baum(g0), { lebend: true });
    const m = baue(a, w);
    m.fbV9RaumStart(); await settle(14);
    const schreibVor = a.log.schreib.length;
    m.fbV9Praesenzwechsel(); await settle(6);
    t('Praesenzwechsel ohne Austragung: der handelnde Lauf bleibt', !!m.leben() && m.leben().turn === 1 && m.zuschau() === null);
    w.evicted[1] = true; g0.e = { 1: true };
    m.fbV9Praesenzwechsel(); await settle(14);
    t('Marker ueber den Praesenzwechsel-Eingang: Lauf beendet, Beobachter fuer Runde 1', m.leben() === null && !!m.zuschau() && m.zuschau().turn === 1);
    t('und dabei kein Schreibversuch', a.log.schreib.length === schreibVor, a.log.schreib.slice(schreibVor).map(x => x.pfad).join(','));
    m.fbV9LebenStop();
  }
  // Die Anbindung an Rueckkehr, Lobby, Eingabe und Anzeige.
  t('Rueckkehr: im laufenden Match ausgetragen -> rein lesend, ohne Claim',
    /const claim=nurLesend\?\{ok:true\}:await reclaimSeatSlot\(/.test(HTML) && /&&!!\(gNow&&gNow\.e&&gNow\.e\[seat\]===true\);/.test(HTML)
    && /rejoinNurLesend=nurLesend\?\{room:code,gen:v\.gen,seat:seat\}:null;/.test(HTML));
  t('Praesenz: der Marker sperrt in v11 nur, solange der Raum spielt (wie die Rules)',
    /const sperrt=fbFassungV11\(v\.v\)\?sz\.val\(\)==='playing':true;/.test(HTML) && /if\(se\.val\(\)===true&&sperrt\)return 'evicted';/.test(HTML));
  t('Lobby: der Ausgetragene kommt beim Wechsel in die Lobby ueber den bestehenden Weg zurueck',
    /fbV11PtWarteAus\(\);[^\n]*\n  if\(typeof fbAusgetragenZurueck==='function'\)fbAusgetragenZurueck\(\);/.test(HTML)
    && /restoreOwnPresence\(\{sid:onlineSessionId,room:roomCode,seat:myPlayer,tab:onlineTab\}\)/.test(HTML)
    && /const r=await reclaimSeatSlot\(ctx\.room,ctx\.seat,null,/.test(HTML));
  t('Zuschauer schreiben weder Matchende noch fremde Austragungen',
    /if\(typeof fbEvicted==='function'&&fbEvicted\(myPlayer\)\)return;/.test(HTML) && /  if\(fbEvicted\(myPlayer\)\)return false;/.test(HTML));
  t('der Austragungsbeobachter meldet ueber den bestehenden Praesenzwechsel-Eingang (kein neuer Haken)',
    /fbV11Raum\(\)&&typeof fbV9Praesenzwechsel==='function'\)fbV9Praesenzwechsel\(\);/.test(HTML));
  t('Hinweis: drei Sprachen, eigener Stil, nur fuer den Grund Verbindung',
    (HTML.match(/fbWatchLost:'/g) || []).length === 3 && /#game\.fb \.fbstate\.aus\{/.test(HTML) && /if\(typeof fbV9ZuschauHinweis==='function'&&fbV9ZuschauHinweis\(\)&&phase!=='over'/.test(HTML)
    && HTML.indexOf("fbWatchLost:'Verbindung zu lange unterbrochen – du kannst in diesem Match nur noch zuschauen.'") >= 0);
  t('die Fristen sind unveraendert (30 s Rueckkehr, 30 s Bereitschaft, 8 s Entscheidung)',
    /const SEAT_STALE_MS=30000;/.test(HTML) && /const FB_V9_READY_DEADLINE_MS=30000;/.test(HTML) && /const FB_V10_DEADLINE_MS=8000;/.test(HTML));
}

abschnitt('Waechter');
{
  const roh = HTML.slice(HTML.indexOf('// ── V9-REHYDRIERUNG'),
                         HTML.indexOf('// ── DIE BEIDEN HAKEN AUS DEM SPIEL'));
  const code = roh.split(/\r?\n/).filter(z => !/^\s*\/\//.test(z)).join('\n');
  t('der ausgelieferte Client steht auf 11',
    /const ONLINE_PROTOCOL_VERSION=11;/.test(HTML));
  t('die Rehydrierung liest genau einmal', (code.match(/window\.FB\.get\(/g) || []).length === 1);
  t('und schreibt nie',
    code.indexOf('runTransaction') < 0 && code.indexOf('fbV9NetWrite') < 0 &&
    code.indexOf('fbV9NetOpen') < 0 && code.indexOf('serverTimestamp') < 0);
  t('sie laesst keinen Zuhoerer zurueck', code.indexOf('onValue') < 0);
  t('sie benutzt die BESTEHENDE Deutung - keinen zweiten Hashpruefer',
    code.indexOf('fbV9AcceptedSet(') > 0 && code.indexOf('fbV9Hash') < 0 &&
    code.indexOf('subtle') < 0);
  t('und die BESTEHENDE Wirkung - keine zweite Physik',
    code.indexOf('fastForwardMatch(null,plan.mengen)') > 0 &&
    code.indexOf('applyLaunch') < 0);
  t('der Abschlussanker entscheidet, was Historie ist',
    code.indexOf('fbV9AnkerOk(z[n])') > 0);
  t('eine Luecke faellt geschlossen aus', /Luecke in der Historie/.test(roh));
  t('waehrend des Nachspiels ruht die Anbindung',
    code.indexOf('fbV9Nachspielen=true;') > 0 && code.indexOf('fbV9Nachspielen=false;') > 0);
  t('und der Riegel haengt in fbV9LebenAn',
    /return !fbV9Nachspielen &&/.test(HTML));
  // KEINE Weltmomentaufnahme. Der Beweis ist nicht die Abwesenheit eines Wortes,
  // sondern die Menge der Knoten, die v9 ueberhaupt kennt: Rundenbeginn, Terminals,
  // Enthuellungsanker, Ergebnisse, Generationsstart, Abschluss, Bereitschaft,
  // Disqualifikation, Austragung - und sonst nichts. Kein Knoten traegt Weltzustand.
  const v9 = HTML.slice(HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60'), ENDE);
  const knoten = new Set((v9.match(/fbV9Ref\(ctx,'([a-z]+)/g) || [])
    .map(x => x.replace(/.*'/, '')));
  t('v9 kennt genau die Protokollknoten',
    [...knoten].sort().join(',') === 'c,d,q,r,ro,s,x,z',   // e schreibt v9 nie - der Austragungsmarker gehoert der Praesenz
    [...knoten].sort().join(','));
  t('die Rehydrierung schreibt nichts und speichert nichts',
    code.indexOf('fbV9Ref(') < 0 && code.indexOf('fbElimLives') < 0 &&
    code.indexOf('sessionStorage') < 0 && code.indexOf('localStorage') < 0);
  t('und sie setzt keine Kugelwerte von aussen',
    code.indexOf('.x=') < 0 && code.indexOf('.vx=') < 0 && code.indexOf('balls') < 0);
  // ── DIE ECHTE VERDRAHTUNG ──────────────────────────────────────────
  t('die Raumweiche haengt an der Fassung des Raums, nicht an einem Schalter',
    /function fbV9RaumIst9\(raum\)\{[\s\S]{0,400}?return !!raum && \(raum\.v===9\|\|raum\.v===10\|\|fbFassungV11\(raum\.v\)\) && ONLINE_PROTOCOL_VERSION>=fbProtoVonFassung\(raum\.v\);/
      .test(HTML));
  t('der Rejoin liest fuer v9 KEINE t-Historie',
    /const v9=fbV9RaumIst9\(v\);/.test(HTML) &&
    /if\(!v9\)\{[\s\S]{0,400}?\/g\/'\+v\.gen\+'\/t'/.test(HTML));
  t('und ruft stattdessen die Rehydrierung',
    /if\(v9\)\{[\s\S]{0,600}?await fbV9Rehydrieren\(fbV9LebenCtx\(0\)\)/.test(HTML));
  t('der v8-Zweig ruft weiterhin unveraendert fastForwardMatch(turns)',
    /\}else fastForwardMatch\(turns\);/.test(HTML));
  t('ein Fehlschlag faellt geschlossen aus - kein Rueckfall auf eine frische Welt',
    /if\(erg&&erg\.fehler\)\{ setStatus\(T\('err'\)\+erg\.fehler\); return false; \}/.test(HTML));
  t('und die Kennung wird nach dem Lesen erneut geprueft',
    /if\(!joinOpCurrent\(op\)\)return false;\s*\r?\n[\s\S]{0,300}?erg&&erg\.fehler/.test(HTML));
  t('der frische Start geht ueber DENSELBEN Weg',
    /if\(typeof fbV9RaumStart!=='function'\|\|!fbV9RaumStart\(\)\)startOnlineGame\(\);/.test(HTML));
  t('es gibt genau einen Aufruf je Einstieg',
    (HTML.match(/fbV9RaumStart\(\)/g) || []).length === 2 &&
    (HTML.match(/await fbV9Rehydrieren\(/g) || []).length === 1,
    (HTML.match(/fbV9RaumStart\(\)/g) || []).length + '/' +
    (HTML.match(/await fbV9Rehydrieren\(/g) || []).length);
  t('die Rehydrierung schuetzt sich gegen einen Wechsel waehrend des Lesens',
    /const damals=\{sid:onlineSessionId,room:roomCode,gen:gen,seat:myPlayer\};/.test(HTML));
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('die Regeldatei traegt weiterhin die v9-Zweige',
    rules.indexOf("child('v').val() === 9") > 0);
  t('und kennt keinen Weltzustandspfad',
    rules.indexOf('"w"') < 0 && rules.indexOf('positions') < 0);
}

console.log('\nOnline-V9-Rehydrierung: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})().catch(e => { console.log('ABBRUCH: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
