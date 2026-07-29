// Collapse-SFX-Suite (Runtime-Synchronisation): prueft die KAUSALITAET
// "sichtbarer Zustandswechsel -> zugehoeriger Audioaufruf", nicht geplante
// Cue-Zeitstempel untereinander.
//
//  A) Quellen-Kausalitaet: statische Pruefungen gegen index.html (einzige
//     Ausloeserstelle ist der visuelle Adapter; kein Timer, keine gespiegelte
//     Schwellen-/Zeittabelle, kein Offline-Cue-Sheet im Runtime-Pfad).
//  B) ECHTER visueller Adapter (colvStage..colvTick, extrahiert) laeuft frame-
//     weise gegen einen Ereignis-Recorder: jedes Hoerereignis muss im SELBEN
//     Tick entstehen, in dem der zugehoerige sichtbare Zustand umschaltet.
//  C) ECHTE SFX-IIFE (extrahiert) gegen Mock-AudioContext: Vorladen, Zielzeit
//     (keine 0,1-0,3s-Verzoegerung, Latenz-Klemme), kontrollierte Stille,
//     kein Nachholen, Mute, Ladefehler, keine Synthese.
//  D) Reale WAV-Derivate byte-genau: Haupttransient praktisch am Samplebeginn
//     (<=10 ms), Fragmente kurz, Ende leise, Clipping-Worst-Case < 1.0.
'use strict';
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond, info) => {
  cond ? pass++ : (fail++, console.error('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')));
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── Extraktionen ──
const cutHtml = (from, to, label) => {
  const a = HTML.indexOf(from);
  if (a < 0) { console.error('Extraktion fehlgeschlagen (Start): ' + label); process.exit(1); }
  const b = HTML.indexOf(to, a);
  if (b < 0) { console.error('Extraktion fehlgeschlagen (Ende): ' + label); process.exit(1); }
  return HTML.slice(a, b);
};
const sfxStart = HTML.indexOf('const SFX=(()=>{');
const sfxEnd = HTML.indexOf('\n})();', sfxStart);
if (sfxStart < 0 || sfxEnd < 0) { console.error('SFX-Extraktion fehlgeschlagen'); process.exit(1); }
const SFX_SRC = HTML.slice(sfxStart, sfxEnd + '\n})();'.length);
const COLV_CONST_SRC = cutHtml('const COLV_WALK_TOP=', 'const colv={', 'COLV-Konstanten');
const COLV_OBJ_SRC = cutHtml('const colv={', '// Bandtausch-Inventar', 'colv/colvSnd');
const COLV_TICK_SRC = cutHtml('function colvStage(){', '// langsamer Gold-Ring', 'colvStage..colvTick');
const COLV_ALL = COLV_CONST_SRC + COLV_OBJ_SRC + COLV_TICK_SRC;

// ══ A) Quellen-Kausalitaet (statisch) ══
{
  // Einzige Ausloeserstelle: der visuelle Adapter meldet via colvSnd -> SFX.colvEvent.
  const evCalls = HTML.match(/SFX\.colvEvent\(/g) || [];
  t('A: SFX.colvEvent hat genau EINE Aufrufstelle (colvSnd im visuellen Adapter)',
    evCalls.length === 1 && /function colvSnd\(ev\)\{try\{SFX\.colvEvent\(ev\);\}catch\(e\)\{\}\}/.test(HTML), evCalls.length);
  t('A: alle Hoerereignisse entstehen im Adapter (colvSnd-Aufrufe nur dort)',
    (COLV_ALL.match(/colvSnd\(\{k:/g) || []).length === (HTML.match(/colvSnd\(\{k:/g) || []).length);
  // Kein unabhaengiger Timer / keine Wahrscheinlichkeits-Cues mehr:
  t('A: SFX.strain (Zufalls-Timer der Warnrisse) existiert nicht mehr', !/strain/.test(HTML));
  t('A: keine exportierte Loesezeit-Tabelle (colvSegAudio) mehr', !/colvSegAudio/.test(HTML));
  t('A: SFX.collapse() (vorgeplante Sequenz) existiert nicht mehr', !/SFX\.collapse\(\)/.test(HTML));
  // Riss-Kopplung: dieselbe crackAt-Wahrheit, die colvCracks sichtbar schaltet.
  t('A: Warnriss-Ereignis nutzt DIESELBE crackAt-Schwelle wie die Sichtbarkeit',
    /colvCracks\(prog\)/.test(COLV_TICK_SRC) && /prog>=pr\.crackAt&&!\(colv\.crackMask&\(1<<i\)\)/.test(COLV_TICK_SRC) &&
    /colvSnd\(\{k:'crack'/.test(COLV_TICK_SRC));
  t('A: SFX enthaelt KEINE eigene Schwellen-/Restzeitliste (kein COLLAPSE_WARNING, kein crackAt)',
    !/COLLAPSE_WARNING_SECONDS/.test(SFX_SRC) && !/crackAt/.test(SFX_SRC) && !/remainMs|remSec/.test(SFX_SRC));
  // Segment-Kopplung: exakt der Uebergang Tremor -> sichtbare Abloese-/Fallbewegung.
  t('A: Segmentbruch feuert im Uebergang zur Fallbewegung (fellSnd-Latch im else-Zweig von ts<COLV_TREMOR_S)',
    /if\(ts<COLV_TREMOR_S\)\{[\s\S]*?\}else\{[\s\S]*?if\(!h\.fellSnd\)\{h\.fellSnd=true;[\s\S]*?colvSnd\(\{k:'seg'/.test(COLV_TICK_SRC));
  t('A: verpasste Segmentabloesung (Frame-Luecke) bleibt dauerhaft still (Toleranzfenster)',
    /if\(tf<=\.25\)colvSnd\(\{k:'seg'/.test(COLV_TICK_SRC));
  // Hauptbruch: exakt der sichtbare Stufenwechsel, einmal, Replay stumm.
  t('A: Hauptbruch haengt am Stufen-Latch colv.state!==2 und ist bei instant (Replay/Rehydration) stumm',
    /if\(colv\.state!==2\)\{[\s\S]*?colv\.state=2;[\s\S]*?if\(!colv\.instant\)colvSnd\(\{k:'break'\}\)/.test(COLV_TICK_SRC));
  t('A: applyCollapseRadius/applyOnlineCollapseRadius rufen keinen Sound mehr direkt',
    !/collapseFlash=performance\.now\(\);SFX\./.test(HTML));
  // Nachbroeckeln: nur bei sichtbarer aktiver Fallbewegung dieses Frames.
  t('A: Fragmente sind an sichtbare Fallbewegung gebunden (fragW>0-Gate)',
    /if\(!colv\.instant&&fragW>0&&nowS>=colv\.fragNext\)/.test(COLV_TICK_SRC));
  t('A: Sockel-Materialverlust feuert einmalig ueber pedSnd-Latch mit Toleranz',
    /!colv\.pedSnd\)\{colv\.pedSnd=true;[\s\S]*?if\(td<=\.25\)colvSnd\(\{k:'frag'/.test(COLV_TICK_SRC));
  // Vorladen & kein Nachholen:
  t('A: Audio-Vorladen haengt am Matchstart des Adapters (clockMatch -> SFX.colPreload)',
    /if\(clockMatch&&colv\.load!==3\)SFX\.colPreload\(\);/.test(COLV_TICK_SRC));
  t('A: nicht geladene Buffer werden nie nachgeholt (colvEvent bricht bei colLoad!==2 ab)',
    /colvEvent\(ev\)\{[\s\S]*?if\(colLoad!==2\)return;/.test(SFX_SRC));
  // Keine setTimeout-Cue-Liste im Collapse-Pfad (colvEvent + colvTick):
  const evSrc = SFX_SRC.slice(SFX_SRC.indexOf('colvEvent(ev){'), SFX_SRC.indexOf('collapseStop,'));
  t('A: keine setTimeout-Cues im Ereignispfad (colvEvent)', !/setTimeout/.test(evSrc));
  t('A: keine setTimeout-Cues im visuellen Adapter (colvTick)', !/setTimeout/.test(COLV_TICK_SRC));
  t('A: kein Offline-Cue-Sheet im Runtime-Pfad referenziert', !/collapse_sound_cues|artifacts\//.test(HTML));
  // Frame-Praesentation/Latenz: zentrale, dokumentierte Kalibrierung.
  t('A: gemeinsame Zielzeit colWhen = currentTime + max(0, Frame - outputLatency)',
    /const COL_FRAME_S=1\/60;/.test(SFX_SRC) && /Math\.max\(0,COL_FRAME_S-lat\)/.test(SFX_SRC));
  t('A: Replay/Rehydration stumm (fastForwardMatch schaltet soundOn ab)',
    /const snd=soundOn; soundOn=false;/.test(HTML) && /finally \{ soundOn=snd;/.test(HTML));
  // Nach der Abnahme: alle nur fuer die lokale Hoerprobe eingebauten Preview-/
  // Diagnoseschalter (URL-Parameter, Overlay, Debug-Hook) sind restlos entfernt —
  // das Produkt kennt nur noch das feste 60s-Matchverhalten.
  t('A: kein colfast-URL-Parameter mehr im Code', !/colfast/i.test(HTML));
  t('A: kein sfxdebug-URL-Parameter mehr im Code', !/sfxdebug/i.test(HTML));
  t('A: kein Diagnose-Hook/Overlay mehr im Code (setColDiag/colDiagFn/__colSfxLog)',
    !/setColDiag|colDiagFn|__colSfxLog/.test(HTML));
  t('A: keine "NICHT COMMITTEN"-Markierungen mehr (Preview-Schalter sind entfernt, nicht nur markiert)',
    !/NICHT[ -]COMMITTEN/.test(HTML));
  t('A: MATCH_COLLAPSE_SECONDS ist eine feste Konstante (kein Preview-Ternary, exakt 60s)',
    /const MATCH_COLLAPSE_SECONDS=60, COLLAPSE_WARNING_SECONDS=10/.test(HTML));
}

// ══ B) ECHTER visueller Adapter frameweise (Kausalitaets-Simulation) ══
function makeColv(opts) {
  const o = Object.assign({ load: 2, seed: 4711 }, opts);
  const events = [], pre = { n: 0 };
  const SFXmock = { colvEvent: (ev) => events.push(Object.assign({ tick: CUR.tick, nowS: CUR.nowS }, ev)), colPreload: () => pre.n++ };
  const CUR = { tick: 0, nowS: 0 };
  let seed = o.seed >>> 0;   // deterministischer Jitter (Fragment-Abstaende/-Art) wie in makeEnv
  const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let z = Math.imul(seed ^ (seed >>> 15), 1 | seed); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const M = Object.create(Math); M.random = rand;
  const THREE = {
    Vector3: function () { this.set = () => {}; },
    Quaternion: function () { this.set = () => {}; this.setFromAxisAngle = () => {}; this.copy = () => {}; },
  };
  const mesh = () => ({ visible: false, position: { set() {} }, quaternion: { copy() {}, identity() {} }, userData: {} });
  const ORD = [3, 0, 4, 1, 5, 2];   // Fixture: gleiche Ordnung wie colvLoad (Testerwartung, keine Runtime-Kopie)
  const pairs = ORD.map((ord, i) => {
    const a = i / 6 * Math.PI, ux = Math.cos(a), uz = Math.sin(a);   // 0..150 Grad -> ux paarweise verschieden (eindeutiges Pan je Segment)
    const cracked = mesh();
    cracked.userData.colv = { hx: ux * 8, hy: 0, hz: uz * 8, ux, uz, tx: -uz, tz: ux, delay: ord * .16, tumble: 1, fellSnd: false };
    const intact = mesh(); intact.visible = true; intact.userData.colv = { hx: ux * 8, hy: 0, hz: uz * 8 };
    return { intact, cracked, crackAt: ord * .16 };
  });
  const body = `
    const GLB_R=10.1, COLLAPSE_WARNING_SECONDS=10;
    let menuVisible=false, online=false, gameStarted=false, onlineHasClock=false, onlineRemainMs=0, onCollapsedGen=-1, gen=0;
    let collapseEnabled=true, collapseState='running', remainMs=60000;
    const collapseActive=()=>collapseEnabled&&!online;
    const collapseRemainMs=()=>remainMs;
    const colvBandParts=[],colvPed=[{visible:true,position:{y:0},userData:{colv:{hy:0}}}];
    ${COLV_CONST_SRC}
    ${COLV_OBJ_SRC}
    ${COLV_TICK_SRC}
    return { colv, colvTick,
      set:(k,v)=>{eval(k+'=(v)');},
      get:(k)=>eval('('+k+')'),
      ped:()=>colvPed[0] };
  `;
  const env = new Function('THREE', 'SFX', 'Math', body)(THREE, SFXmock, M);
  env.colv.pairs = pairs; env.colv.load = o.load;
  // Frame-Treiber: 60fps; remainMs folgt nowS (wie die echte Matchuhr in der Planungsphase)
  const step = (dt) => { CUR.tick++; CUR.nowS += dt; env.set('remainMs', Math.max(0, env.get('remainMs') - dt * 1000)); env.colvTick(CUR.nowS); };
  return { env, events, pre, pairs, CUR, step };
}
{
  // ── Warnfenster: Riss-Sound exakt im Tick des sichtbaren Rissstufenwechsels ──
  const { env, events, pre, pairs, step } = makeColv();
  env.set('remainMs', 60000);
  step(1 / 60);
  t('B: Vorladen wird ab Matchstart angestossen (volle Restzeit, lange vor dem Warnfenster)', pre.n > 0);
  env.set('remainMs', 10000 + 17);   // knapp vor dem Warnfenster einsteigen
  let mismatch = 0, crackTicks = {};
  for (let i = 0; i < 60 * 11; i++) {
    const before = pairs.map((p) => p.cracked.visible);
    const n0 = events.length;
    step(1 / 60);
    const flipped = pairs.map((p, j) => !before[j] && p.cracked.visible ? j : -1).filter((j) => j >= 0);
    const fired = events.slice(n0).filter((e) => e.k === 'crack');
    // Jeder neue sichtbare Riss dieses Ticks muss GENAU dieses Ticks Hoerereignis sein
    if (flipped.length !== fired.length) mismatch++;
    for (const j of flipped) crackTicks[j] = true;
    if (env.get('remainMs') <= 0) break;
  }
  const cracks = events.filter((e) => e.k === 'crack');
  t('B: JEDER Warnriss-Sound faellt in den Tick seines sichtbaren Rissstufenwechsels (0 Abweichungen)', mismatch === 0, mismatch);
  t('B: genau 6 Warnrisse — einer pro sichtbar gewordenem Segment-Riss', cracks.length === 6 && Object.keys(crackTicks).length === 6, cracks.length);
  const pans = cracks.map((e) => +e.pan.toFixed(3));
  t('B: Riss-Panorama kommt aus der tatsaechlichen Ringposition (ux) des jeweiligen Segments',
    pans.every((p) => pairs.some((pr) => Math.abs(pr.cracked.userData.colv.ux - p) < 1e-3)) && new Set(pans).size >= 4, pans);
  // ── Abriss: Hauptbruch im Tick des sichtbaren Stufenwechsels, exakt einmal ──
  env.set('collapseState', 'collapsed');
  const n0 = events.length;
  step(1 / 60);
  const gotBreak = events.slice(n0).filter((e) => e.k === 'break');
  t('B: Hauptbruch faellt in den Tick, in dem die Abrissstufe sichtbar wird', gotBreak.length === 1);
  // ── Segmentbrueche: exakt im Tick des sichtbaren Bewegungsbeginns (Tremor -> Fall) ──
  const segChecks = [];
  for (let i = 0; i < 60 * 8; i++) {
    const before = pairs.map((p) => p.cracked.userData.colv.fellSnd);
    const n1 = events.length;
    step(1 / 60);
    const fired = events.slice(n1).filter((e) => e.k === 'seg');
    for (const e of fired) {
      // Der Ausloeser-Tick muss der erste Frame der Fallbewegung dieses Segments sein
      const pr = pairs.find((p) => Math.abs(p.cracked.userData.colv.ux - e.pan) < 1e-6);
      const ts = (e.nowS - env.colv.t0) - pr.cracked.userData.colv.delay;
      segChecks.push({ ok: !before[pairs.indexOf(pr)] && ts >= .3 && ts <= .3 + .05, ts: +ts.toFixed(3) });
    }
  }
  const segs = events.filter((e) => e.k === 'seg');
  t('B: genau 6 Segmentbrueche, je einer pro Segment', segs.length === 6, segs.length);
  t('B: JEDER Segmentbruch liegt im ersten Frame der sichtbaren Abloese-/Fallbewegung (Tremorende +<=1 Frame)',
    segChecks.length === 6 && segChecks.every((c) => c.ok), segChecks);
  t('B: Hauptbruch bleibt exakt EINMAL (kein zweiter im gesamten Ablauf)', events.filter((e) => e.k === 'break').length === 1);
  // ── Nachbroeckeln: beginnt mit der ersten sichtbaren Materialabloesung, endet vor der Ruhe ──
  const frags = events.filter((e) => e.k === 'frag');
  const t0c = env.colv.t0;
  const firstSeg = Math.min(...segs.map((e) => e.nowS));
  t('B: Nachbroeckeln beginnt mit der ersten sichtbaren Materialabloesung (erstes Fragment <=0.25s nach Segment 1)',
    frags.length > 0 && Math.min(...frags.map((e) => e.nowS)) >= firstSeg - 1 / 60 && Math.min(...frags.map((e) => e.nowS)) <= firstSeg + .25,
    { first: +(Math.min(...frags.map((e) => e.nowS)) - t0c).toFixed(2), seg1: +(firstSeg - t0c).toFixed(2) });
  const lastMove = 0.3 + 0.8 + Math.sqrt(60 / 15);   // letztes Segment: Tremorende + max. Delay + Fall bis unsichtbar (-60)
  t('B: LETZTES Fragment faellt waehrend sichtbarer Bewegung (vor deren Ende), nicht danach',
    Math.max(...frags.map((e) => e.nowS)) - t0c < lastMove, { last: +(Math.max(...frags.map((e) => e.nowS)) - t0c).toFixed(2), ende: +lastMove.toFixed(2) });
  t('B: Dichte nimmt ab — erste Haelfte der Broeckelphase enthaelt mehr Fragmente als die zweite',
    (() => { const ts2 = frags.map((e) => e.nowS - t0c), mid = (Math.min(...ts2) + Math.max(...ts2)) / 2;
      return ts2.filter((x) => x < mid).length >= ts2.filter((x) => x >= mid).length; })());
  // ── Nach der Ruhe: lange weiterticken -> absolut nichts mehr ──
  const nQuiet = events.length;
  for (let i = 0; i < 60 * 5; i++) step(1 / 60);
  t('B: nach dem ruhigen Endzustand entsteht KEIN weiteres Hoerereignis (5 s Stille geprueft)', events.length === nQuiet);
}
{
  // ── Rehydration/Replay (instant): alles stumm ──
  const { env, events, step } = makeColv();
  env.set('collapseState', 'collapsed');   // Einstieg direkt im Endzustand (colv.state===0 -> instant)
  for (let i = 0; i < 120; i++) step(1 / 60);
  t('B: Rehydration/Replay (instant): kein Hauptbruch, keine Segmente, keine Fragmente',
    events.filter((e) => e.k !== undefined).length === 0, events.length);
}
{
  // ── Spaeter Einstieg ins Warnfenster (Online-Beitritt/Menue-Rueckkehr): Bestand stumm ──
  const { env, events, step } = makeColv();
  env.set('remainMs', 5000);   // Einstieg bei Restzeit 5 s: 3 Risse sind laengst sichtbar
  step(1 / 60); step(1 / 60);
  t('B: Einstieg mitten im Warnfenster uebernimmt vorhandene Risse STUMM (kein Nachholen)',
    events.filter((e) => e.k === 'crack').length === 0, events.length);
  // danach neue Risse hoeren sich normal an
  env.set('remainMs', 3600); let n0 = events.length;
  for (let i = 0; i < 60; i++) step(1 / 60);
  t('B: NEUE Risse nach dem Einstieg klingen wieder (nur der Bestand war stumm)',
    events.slice(n0).filter((e) => e.k === 'crack').length >= 1);
}
{
  // ── Frame-Luecke (Hintergrund-Tab) im Warnfenster: kein Stau, kein Nachholen ──
  const { env, events, step, CUR } = makeColv();
  env.set('remainMs', 9800); step(1 / 60); step(1 / 60);
  const n0 = events.length;
  CUR.nowS += 3; env.set('remainMs', env.get('remainMs') - 3000); step(1 / 60);   // 3 s Luecke in einem Schritt
  t('B: 3s-Frame-Luecke im Warnfenster vertont die uebersprungenen Risse NICHT', events.slice(n0).filter((e) => e.k === 'crack').length === 0);
}
{
  // ── GLB-Fallback (load=3): keine sichtbaren Segmente -> kontrollierte Stille ──
  const { env, events, step } = makeColv({ load: 3 });
  env.set('remainMs', 9000); step(1 / 60);
  env.set('collapseState', 'collapsed');
  for (let i = 0; i < 120; i++) step(1 / 60);
  t('B: ohne 3D-Adapter (Ladefehler) gibt es keine Hoerereignisse (kontrollierte Stille)', events.length === 0);
}

// ══ C) ECHTE SFX-IIFE gegen Mock-AudioContext ══
function makeEnv(opts) {
  const o = Object.assign({ fetchOk: true, seed: 1234, outLat: undefined }, opts);
  const log = { osc: 0, synthBuf: 0, started: [], gains: [], panners: [], fetches: [] };
  const P = { t: 0 };
  let seed = o.seed >>> 0;
  const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let z = Math.imul(seed ^ (seed >>> 15), 1 | seed); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const M = Object.create(Math); M.random = rand;
  function param(rec) {
    return { _ev: [], setValueAtTime(v, tt) { this._ev.push({ k: 'set', v, t: tt }); if (rec) rec.push({ k: 'set', v, t: tt }); return this; },
      linearRampToValueAtTime(v, tt) { this._ev.push({ k: 'lin', v, t: tt }); return this; },
      exponentialRampToValueAtTime(v, tt) { this._ev.push({ k: 'exp', v, t: tt }); return this; },
      setTargetAtTime(v, tt) { this._ev.push({ k: 'tgt', v, t: tt }); if (rec) rec.push({ k: 'tgt', v, t: tt }); return this; },
      cancelScheduledValues() { return this; }, value: 0 };
  }
  class Ctx {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = { kind: 'dest', connect() {} };
      if (o.outLat !== undefined) this.outputLatency = o.outLat; }
    get currentTime() { return P.t / 1000; }
    resume() {}
    createOscillator() { log.osc++; const n = { frequency: param(), type: '', connect() {}, start() {}, stop() {} }; return n; }
    createBuffer(ch, len, sr) { log.synthBuf++; return { getChannelData: () => new Float32Array(len || 4) }; }
    createGain() { const ev = []; const n = { kind: 'gain', gain: param(ev), _ev: ev, connect(d) { n._dst = d; } }; log.gains.push(n); return n; }
    createBiquadFilter() { return { kind: 'biquad', type: '', frequency: param(), Q: param(), connect() {} }; }
    createStereoPanner() { const n = { kind: 'pan', pan: { value: 0 }, connect(d) { n._dst = d; } }; log.panners.push(n); return n; }
    createBufferSource() {
      const n = { kind: 'src', buffer: null, loop: false, playbackRate: { value: 1, setTargetAtTime() {} },
        connect(dst) { n._dst = dst; },
        start(when) { log.started.push({ name: n.buffer && n.buffer.__name, when: when != null ? when : P.t / 1000, node: n }); },
        stop() {} };
      return n;
    }
    decodeAudioData(ab) { return Promise.resolve({ __name: ab.__url.replace(/^.*\//, '').replace(/\.\w+$/, ''), duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array(4) }); }
  }
  const fetchMock = async (url) => { log.fetches.push(url); return { ok: o.fetchOk, arrayBuffer: async () => ({ __url: url }) }; };
  const body = `
    let soundOn=true, menuVisible=false;
    const SLOWV=0.1;
    ${SFX_SRC}
    return { SFX,
      setSound(v){soundOn=v;},
      setMenu(v){menuVisible=v;} };
  `;
  const env = new Function('window', 'performance', 'fetch', 'Math', 'setTimeout', body)(
    { AudioContext: Ctx }, { now: () => P.t }, fetchMock, M, setTimeout);
  return { env, log, P };
}
const PRODUCT_FILES = ['crack_1', 'crack_2', 'crack_3', 'crack_4', 'seg_1', 'seg_2', 'seg_3', 'break_main',
  'fragc_1', 'fragc_2', 'fragc_3', 'fragf_1', 'fragf_2', 'fragf_3'];
(async () => {
  {
    const { env, log, P } = makeEnv();
    env.SFX.colvEvent({ k: 'break' });
    t('C: Ereignis vor dem Laden bleibt still (0 Quellen)', log.started.length === 0, log.started.length);
    await tick(); await tick(); await tick();
    t('C: ein stilles Ereignis stoesst KEIN Laden an (Vorladen ist explizit)', log.fetches.length === 0);
    env.SFX.colPreload();
    await tick(); await tick(); await tick();
    t('C: Vorladen holt genau die 14 Produktdateien', log.fetches.length === 14 &&
      PRODUCT_FILES.every((n) => log.fetches.includes('assets/sfx/ring_collapse/' + n + '.wav')), log.fetches.length);
    t('C: das VOR dem Laden stille Ereignis wird auch nach dem Laden nicht nachgeholt', log.started.length === 0);
    // Zielzeit: Mock ohne outputLatency -> when = now + 1 Frame (16.7 ms); nie 0,1-0,3 s.
    P.t = 20000;
    env.SFX.colvEvent({ k: 'crack', pan: -1, n: .2 });
    t('C: Warnriss startet im naechsten Praesentationsframe (Abstand <= 20 ms, keine 0,1-0,3s-Verzoegerung)',
      log.started.length === 1 && log.started[0].when - 20 >= 0 && log.started[0].when - 20 <= .02,
      log.started[0] && +(log.started[0].when - 20).toFixed(4));
    env.SFX.colvEvent({ k: 'break' });
    const mains = log.started.filter((x) => x.name === 'break_main');
    t('C: Hauptbruch-Ereignis spielt genau break_main', mains.length === 1);
    // Segmentereignisse: Impuls + kleiner Steinabgang, Pan aus Ringposition, Varianten ohne Wiederholung
    for (let i = 0; i < 6; i++) { P.t += 200; env.SFX.colvEvent({ k: 'seg', pan: [(-1) ** i * .8, .3, -.5, .9, -.9, .1][i], n: i }); }
    const segs = log.started.filter((x) => /^seg_/.test(x.name));
    const segFragc = log.started.filter((x) => /^fragc_/.test(x.name));
    t('C: 6 Segmentereignisse -> 6 Segmentbrueche + 6 kleine Steinabgaenge', segs.length === 6 && segFragc.length === 6, { s: segs.length, f: segFragc.length });
    t('C: Segment-Varianten ohne direkte Wiederholung', segs.every((x, i) => i === 0 || x.name !== segs[i - 1].name), segs.map((x) => x.name));
    t('C: mindestens zwei verschiedene Segment-Varianten', new Set(segs.map((x) => x.name)).size >= 2);
    t('C: Stereo-Position aktiv (Panner aus der Ringposition)', log.panners.length >= 6);
    // Fragmente: kind c/f, Spam-Backstop
    P.t += 500; env.SFX.colvEvent({ k: 'frag', kind: 'f', pan: .2, g: 1 });
    P.t += 10; env.SFX.colvEvent({ k: 'frag', kind: 'f', pan: .2, g: 1 });   // 10 ms spaeter -> Backstop
    P.t += 200; env.SFX.colvEvent({ k: 'frag', kind: 'c', pan: -.2, g: .5 });
    const fr = log.started.filter((x) => /^frag/.test(x.name));
    t('C: Fragment-Backstop verhindert Spam (2 Anfragen in 10 ms -> 1 Wiedergabe)', fr.length === segFragc.length + 2, fr.length - segFragc.length);
    t('C: keine Oszillatoren im gesamten Collapse-Pfad', log.osc === 0, log.osc);
    t('C: keine synthetischen Rausch-Buffer im Collapse-Pfad', log.synthBuf === 0, log.synthBuf);
    // Gain-Hierarchie: Hauptbruch > Segment > Fragment
    const gainAt = (src) => { const g = log.gains.find((x) => x._ev.length && src.node._dst === x); return g ? g._ev[0].v : null; };
    const gMain = gainAt(mains[0]), gSeg = Math.max(...segs.map((x) => gainAt(x) || 0)), gFrag = Math.max(...fr.map((x) => gainAt(x) || 0));
    t('C: Mix-Hierarchie Hauptbruch > Segment > Fragment', gMain > gSeg && gSeg > gFrag, { gMain, gSeg, gFrag });
    // Menue & zweiter Hauptbruch
    const master = log.gains.filter((g) => g._ev.some((e) => e.k === 'set' && e.v === 1 && g._dst && g._dst.kind === 'dest'));
    env.SFX.colvEvent({ k: 'break' });
    t('C: zweiter Hauptbruch beendet die vorige Sequenz (Master-Gain -> 0)',
      master.length >= 1 && master[0]._ev.some((e) => e.k === 'tgt' && e.v === 0));
    const nM = log.started.length;
    env.setMenu(true); env.SFX.colvEvent({ k: 'frag', kind: 'f', pan: 0, g: 1 });
    t('C: im Menue werden keine Collapse-Ereignisse vertont', log.started.length === nM);
    env.setMenu(false);
    env.SFX.collapseStop(); env.SFX.collapseStop();
    t('C: collapseStop ist mehrfach/leer aufrufbar (kein Fehler)', true);
  }
  {
    // Latenz-Klemme: gemessene Ausgabelatenz >= 1 Frame -> Start SOFORT (when === now)
    const { env, log, P } = makeEnv({ outLat: 0.05 });
    env.SFX.colPreload(); await tick(); await tick(); await tick();
    P.t = 5000;
    env.SFX.colvEvent({ k: 'crack', pan: 0, n: 0 });
    t('C: bei outputLatency >= 1 Frame startet der Ton fruehestmoeglich (when === currentTime, Klemme)',
      log.started.length === 1 && Math.abs(log.started[0].when - 5) < 1e-9, log.started[0] && log.started[0].when);
  }
  {
    const { env, log } = makeEnv();
    env.setSound(false);
    env.SFX.colPreload(); await tick(); await tick();
    t('C: Mute — Vorladen wird nicht einmal angestossen', log.fetches.length === 0);
    env.SFX.colvEvent({ k: 'break' }); env.SFX.colvEvent({ k: 'crack', pan: 0, n: 0 });
    await tick();
    t('C: Mute — keinerlei Quellen', log.started.length === 0);
  }
  {
    const { env, log, P } = makeEnv({ fetchOk: false });
    env.SFX.colPreload(); await tick(); await tick(); await tick();
    P.t += 2000; env.SFX.colvEvent({ k: 'break' }); P.t += 500; env.SFX.colvEvent({ k: 'seg', pan: 0, n: 0 });
    t('C: Ladefehler — alles bleibt kontrolliert still (kein Ersatz, kein Fehler)', log.started.length === 0);
    t('C: Ladefehler — genau ein Ladeversuch (14 Dateien, keine Retry-Schleife)', log.fetches.length === 14, log.fetches.length);
  }

  // ══ D) Reale WAV-Derivate byte-genau ══
  const DIR = path.join(__dirname, '..', 'assets', 'sfx', 'ring_collapse');
  function readWav(name) {
    const b = fs.readFileSync(path.join(DIR, name + '.wav'));
    const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24), bits = b.readUInt16LE(34), n = b.readUInt32LE(40) / 2 / ch;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += b.readInt16LE(44 + (i * ch + c) * 2) / 32768; mono[i] = s / ch; }
    let peak = 0; for (let i = 0; i < n; i++) { const a = Math.abs(mono[i]); if (a > peak) peak = a; }
    return { ch, sr, bits, dur: n / sr, mono, peak, n };
  }
  const SPECS = [
    ['crack_1', .15, .45], ['crack_2', .15, .45], ['crack_3', .15, .45], ['crack_4', .15, .45],
    ['seg_1', .3, .8], ['seg_2', .3, .8], ['seg_3', .3, .8], ['break_main', .8, 1.5],
    ['fragc_1', .1, .32], ['fragc_2', .1, .32], ['fragc_3', .1, .32],
    ['fragf_1', .1, .32], ['fragf_2', .1, .32], ['fragf_3', .1, .32],
  ];
  t('D: Dateibestand entspricht exakt den 14 Produktdateien (kein alter debris-Track)',
    JSON.stringify(fs.readdirSync(DIR).filter((f) => f.endsWith('.wav')).sort()) === JSON.stringify(PRODUCT_FILES.slice().sort().map((n) => n + '.wav')));
  for (const [name, dMin, dMax] of SPECS) {
    let w = null;
    try { w = readWav(name); } catch (e) {}
    t(`D: Asset ${name}: vorhanden, PCM16/48k mono, ${dMin}-${dMax}s, Peak <= -3dBFS`,
      !!w && w.bits === 16 && w.sr === 48000 && w.ch === 1 && w.dur >= dMin && w.dur <= dMax && w.peak <= 0.72,
      w && { ch: w.ch, dur: +w.dur.toFixed(2), peak: +w.peak.toFixed(3) });
    if (!w) continue;
    // Onset: Haupttransient (>=50 % Peak) praktisch am Samplebeginn — genau das
    // verhindert, dass ein puenktlich gestarteter Cue verspaetet WIRKT.
    let a50 = -1; for (let i = 0; i < w.n; i++) if (Math.abs(w.mono[i]) >= w.peak * .5) { a50 = i; break; }
    t(`D: Asset ${name}: Haupttransient <= 10 ms nach Samplebeginn`, a50 >= 0 && a50 / w.sr <= .010, +(a50 / w.sr * 1000).toFixed(1) + 'ms');
    // Ende: sauber ausgeblendet (letzte 8 ms praktisch still -> kein Klick/Plumps)
    const tl = w.mono.slice(w.n - Math.round(w.sr * .008));
    let tp = 0; for (const v of tl) { const a = Math.abs(v); if (a > tp) tp = a; }
    t(`D: Asset ${name}: endet still (letzte 8 ms < 3 % FS)`, tp < .03, +tp.toFixed(4));
  }
  {
    const w = readWav('break_main');
    let arg = 0, pk = 0; for (let i = 0; i < w.n; i++) { const a = Math.abs(w.mono[i]); if (a > pk) { pk = a; arg = i; } }
    t('D: break_main: Hauptmoment vorn (Peak in den ersten 250 ms)', arg / w.sr < .25, +(arg / w.sr).toFixed(3));
    const tail = w.mono.slice(w.n - Math.round(w.sr * .25));
    let tp = 0; for (const v of tail) { const a = Math.abs(v); if (a > tp) tp = a; }
    t('D: break_main: klingt aus statt zu enden (kein End-Impact)', tp < .15, +tp.toFixed(3));
  }
  {
    // Clipping-Worst-Case mit ECHTEN Amplituden auf dem im Abriss moeglichen Zeitplan
    // (Hauptbruch bei 0; Segmente + Steinabgang zu den sichtbaren Loesezeiten 0.3+ord*.16;
    // Sockelfragment bei 0.45; dichtes Nachbroeckeln alle 120 ms): Momentansumme < 1.0.
    const BIN = .005, envs = {};
    const envOf = (name) => {
      if (!envs[name]) { const w = readWav(name); const e = [];
        for (let i = 0; i < w.n; i += Math.round(w.sr * BIN)) {
          let m = 0; for (let j = i; j < Math.min(w.n, i + Math.round(w.sr * BIN)); j++) { const a = Math.abs(w.mono[j]); if (a > m) m = a; }
          e.push(m);
        } envs[name] = e; }
      return envs[name];
    };
    const sched = [{ name: 'break_main', when: 0, gain: .5 }];
    [0, 1, 2, 3, 4, 5].forEach((ord, i) => {
      sched.push({ name: 'seg_' + (1 + (i % 3)), when: .3 + ord * .16, gain: Math.max(.10, .22 - .02 * i) });
      sched.push({ name: 'fragc_' + (1 + (i % 3)), when: .35 + ord * .16, gain: .09 });
    });
    sched.push({ name: 'fragc_1', when: .45, gain: .13 });
    for (let x = .3; x < 2.5; x += .12) sched.push({ name: 'fragf_' + (1 + (Math.round(x * 100) % 3)), when: x, gain: .08 });
    let worst = 0, worstAt = 0;
    for (let T = 0; T <= 4; T += BIN) {
      let s2 = 0;
      for (const ev of sched) { const e = envOf(ev.name); const idx = Math.floor((T - ev.when) / BIN); if (idx >= 0 && idx < e.length) s2 += e[idx] * ev.gain; }
      if (s2 > worst) { worst = s2; worstAt = T; }
    }
    t('D: Clipping-Worst-Case mit echten Amplituden: Momentansumme < 1.0', worst < 1.0, { worst: +worst.toFixed(3), beiSekunde: +worstAt.toFixed(2) });
    // Ruhe-Arithmetik: letzter moeglicher Fragment-Ausloeser + laengstes Fragment
    // endet VOR dem ruhigen Endzustand (letztes Segment unsichtbar).
    const fragMax = Math.max(...['fragc_1', 'fragc_2', 'fragc_3', 'fragf_1', 'fragf_2', 'fragf_3'].map((n) => readWav(n).dur));
    const lastTrigger = .3 + .8 + 1.4;               // Tremorende + max. Segment-Delay + Ende des Ausloese-Fensters (tf<1.4)
    const calm = .3 + .8 + Math.sqrt(60 / 15);       // letztes Segment faellt bei -60 aus dem Bild
    t('D: letztes moegliche Fragment (+Sampledauer) endet vor dem ruhigen Endzustand',
      lastTrigger + fragMax < calm, { spaetestesEnde: +(lastTrigger + fragMax).toFixed(2), ruhe: +calm.toFixed(2) });
  }

  console.log(`\nCollapse-SFX: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e); process.exit(1); });
