// V9.5B: der ECHTE Eingabeweg des Spielers -> V9-Handlung. Dauerhaft, ohne Emulator
// und ohne Browser.
//
// Bis V9.5 hatte fbV9LebenHandeln KEINE Aufrufstelle im Spiel. Ein Zug ging vom
// Fingerloslassen ueber commit() und applyCommit() in onlineSendCommit() und damit in
// den v8-Zugslot t/ - den ein Raum mit v===9 abweist. Damit erreichte kein einziger
// echter Zug das Protokoll.
//
// Geprueft wird der ECHTE Quelltext aus index.html: aimVectorFromDrag, commit,
// canCommitInput, sanitizeMove, applyCommit und onlineSendCommit im Original, dazu der
// vollstaendige ruhende V9-Bereich. Attrappe ist nur, was drumherum liegt - Renderer,
// Physik und Netz.
//
// DIE VIER SAETZE, um die es hier geht:
//   1. Der Weg ist EINER. Derselbe applyCommit, den Zeigerloslassen und Stand-Taste
//      benutzen, waehlt am Ende die Strecke - es gibt keinen zweiten Eingang.
//   2. Der Zug wird NICHT neu gerechnet. Was der Spieler gewaehlt hat, geht bitgenau
//      so in die Hashschicht, wie sanitizeMove es einmal bereinigt hat.
//   3. Ein v9-Raum faellt NIE auf v8 zurueck. Wird die Handlung abgewiesen, entsteht
//      kein t-Slot, kein zweites Salz und kein zweiter Commit.
//   4. Die Eingabe startet KEIN Spiel. Abschuss, Enthuellung und Rundennummer bleiben
//      allein bei der gepruesten Zugmenge.
//   node test_online_v9_input_bridge.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 58 - s.length)));

// ── Der echte Quelltext ──────────────────────────────────────────────────────
function grab(re, was) {
  const m = HTML.match(re);
  if (!m) { console.log('Quelltext nicht gefunden: ' + was); process.exit(2); }
  return m[0];
}
// Die Eingabekette im Original. Jede Signatur wird MIT geprueft: aendert sie sich,
// bricht dieser Zugriff und niemand testet weiter gegen eine Attrappe.
const AIMVEC   = grab(/function aimVectorFromDrag\(\)\{[\s\S]*?\n\}/, 'aimVectorFromDrag');
const SANITIZE = grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove');
const CANINPUT = grab(/function canCommitInput\(who\)\{[\s\S]*?\n\}/, 'canCommitInput');
const COMMIT   = grab(/function commit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'commit');
const APPLY    = grab(/function applyCommit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'applyCommit');
const SEND     = grab(/function onlineSendCommit\(idx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'onlineSendCommit');
const MAXPULL  = grab(/function maxPull\(\)\{[^\n]*\}/, 'maxPull');
// Die v8-Sentinelschreiber im Original. Sie sind der zweite Weg zum Zugslot t - der
// erste ist die Spielereingabe. Beide muessen in einem v9-Raum schweigen.
const SENTINEL_SRC = [
  grab(/function fbOnlineRoom\(\)\{[^\n]*\}/, 'fbOnlineRoom'),
  grab(/function seatActive\(p,s\)\{[^\n]*\}/, 'seatActive'),
  grab(/function isCurrentCtx\(ctx\)\{[^\n]*\}/, 'isCurrentCtx'),
  grab(/function isOnlineTerminated\(\)\{[^\n]*\}/, 'isOnlineTerminated'),
  grab(/function fbTurnSkip\(seat\)\{[^\n]*\}/, 'fbTurnSkip'),
  grab(/function fbTurnRemove\(seat\)\{[^\n]*\}/, 'fbTurnRemove'),
  grab(/function writeTurnSlot\(s,payload,opts\)\{[\s\S]*?\n\}/, 'writeTurnSlot'),
  grab(/function fbSkipBoundary\(\)\{[\s\S]*?\n\}/, 'fbSkipBoundary'),
  grab(/function fbWriteSkip\(s,attempt\)\{[\s\S]*?\n\}/, 'fbWriteSkip'),
  grab(/function fbMaybeSkipOffline\(\)\{[\s\S]*?\n\}/, 'fbMaybeSkipOffline'),
  grab(/function fbWriteRemoveFor\(s,attempt\)\{[\s\S]*?\n\}/, 'fbWriteRemoveFor'),
  grab(/function fbMaybeWriteRemoves\(\)\{[\s\S]*?\n\}/, 'fbMaybeWriteRemoves'),
  grab(/function writeLeaveSentinel\(s,attempt\)\{[\s\S]*?\n\}/, 'writeLeaveSentinel'),
  grab(/function onlineArmTurn\(\)\{[\s\S]*?\n\}/, 'onlineArmTurn')].join('\n');
// Echte Konstanten statt geratener Werte - der t-Slot wird gegen SEINE eigene Form geprueft.
const KONST = [grab(/const LOGICAL=\d+/, 'LOGICAL'),
               grab(/let W=LOGICAL[^\n]*/, 'Weltmasse'),
               grab(/const MAXPULL_FRAC=[^\n]*/, 'MAXPULL_FRAC'),
               grab(/const FOOTBALL_FMTS=\[[^\]]*\];/, 'FOOTBALL_FMTS'),
               grab(/const FB_ONLINE_FMT=FOOTBALL_FMTS\[0\];/, 'FB_ONLINE_FMT'),
               grab(/const TURN_MOVE='move'[^\n]*/, 'TURN_MOVE')].join('\n');

const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-SPIELANBINDUNG ════');
if (START < 0 || ENDE < 0) { console.log('V9-Bereich nicht gefunden'); process.exit(2); }
const BEREICH = HTML.slice(START, ENDE);

// ── Attrappen ────────────────────────────────────────────────────────────────
const SENTINEL = { '.sv': 'timestamp' };
const ruhe = () => new Promise(r => setTimeout(r, 0));
const settle = async (n) => { for (let i = 0; i < (n || 14); i++) await ruhe(); };

function uhrwerk(start) {
  let jetzt = start === undefined ? 5000000 : start, id = 1;
  const offen = new Map();
  return { jetzt: () => jetzt, anzahl: () => offen.size, serverNow: () => jetzt,
    setTimeout: (fn, ms) => { const k = id++; offen.set(k, { faellig: jetzt + ms, fn }); return k; },
    clearTimeout: (k) => { offen.delete(k); },
    vor: async (ms) => { jetzt += ms;
      for (let r = 0; r < 40; r++) {
        const f = [...offen.entries()].filter(e => e[1].faellig <= jetzt);
        if (!f.length) break;
        for (const e of f) { offen.delete(e[0]); e[1].fn(); }
        await settle(6);
      }
      await settle(6); } };
}
function attrappe(vorbelegt, uhr) {
  const log = { schreib: [], hoert: [] };
  const stand = Object.assign({}, vorbelegt || {});
  return { log, stand,
    zustellen: (p, wert) => { stand[p] = wert;
      for (const h of log.hoert) if (h.pfad === p && h.offen) h.cb({ val: () => wert }); },
    FB: { db: {}, ref: (db, p) => ({ pfad: p }), serverTimestamp: () => SENTINEL,
      runTransaction: async (ref, fn) => {
        const vorher = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        const vorschlag = fn(vorher);
        log.schreib.push({ pfad: ref.pfad, vorschlag });
        if (vorschlag === undefined) return { committed: false, snapshot: { val: () => vorher } };
        const jetzt = uhr ? uhr.jetzt() : 1788700000000;
        const g = JSON.parse(JSON.stringify(vorschlag, (k, v) => (v && v['.sv'] === 'timestamp') ? jetzt : v));
        stand[ref.pfad] = g;
        Promise.resolve().then(() => {
          for (const h of log.hoert) {
            if (!h.offen) continue;
            if (h.pfad === ref.pfad) { h.cb({ val: () => g }); continue; }
            if (ref.pfad.indexOf(h.pfad + '/') !== 0) continue;
            const karte = {}; let leer = true;
            for (const k in stand) {
              if (k.indexOf(h.pfad + '/') !== 0 || stand[k] === null) continue;
              const rest = k.slice(h.pfad.length + 1);
              if (rest.indexOf('/') >= 0) continue;
              karte[rest] = stand[k]; leer = false;
            }
            const da = Object.prototype.hasOwnProperty.call(stand, h.pfad) ? stand[h.pfad] : null;
            if (da && typeof da === 'object')
              for (const k in da) if (!(k in karte)) { karte[k] = da[k]; leer = false; }
            h.cb({ val: () => (leer ? null : karte) });
          }
        });
        return { committed: true, snapshot: { val: () => g } };
      },
      onValue: (ref, cb) => {
        const e = { pfad: ref.pfad, cb, offen: true };
        log.hoert.push(e);
        const v = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        Promise.resolve().then(() => { if (e.offen) cb({ val: () => v }); });
        return () => { e.offen = false; };
      } } };
}
function speicher() { const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i],
           getItem: (k) => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
           alles: () => [...m.values()] }; }

const STILL = uhrwerk(1000);
const GLOBAL = ['online', 'mode', 'fmt', 'roomCode', 'myPlayer', 'gen', 'turnNo', 'phase',
                'footballWinner', 'onlineSessionId', 'ONLINE_PROTOCOL_VERSION', 'curAimer',
                // Stufe 2A: die Fassung DES RAUMS - sie entscheidet ueber die Ruhe.
                'roomProto'];

// Die Werkbank. Alles Echte kommt aus index.html; Attrappe ist nur, was Bild, Physik und
// Netz betrifft. `welt.spur` haelt jede Wirkung fest, damit sich die REIHENFOLGE und die
// ABWESENHEIT von Wirkungen zeigen laesst.
const baue = (a, uhr, welt, lager) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
    'FB_ONLINE_BALL_IDX', 'serverNow', 'setTimeout', 'clearTimeout', 'sessionStorage', 'welt', `
  let ${GLOBAL.join(', ')};
  function sync(){ ${GLOBAL.map(n => n + ' = welt.' + n + ';').join(' ')} }
  sync();
  ${KONST}
  ${MAXPULL}
  function fbElim4(){ return welt.elim4; }
  function fbElimPlayers(){ return welt.cap; }
  function fbUid(){ return welt.uid; }
  function fbEvicted(s){ return !!(welt.evicted && welt.evicted[s]); }
  function fbShared(){ return true; }
  function fbTactical(){ return false; }
  function np(){ return welt.cap; }
  function inputLocked(){ return !!welt.gesperrt; }
  function collapseActive(){ return false; }
  // Bild und Ton: nur festhalten, dass sie liefen.
  function setPhaseText(){ welt.spur.push('setPhaseText'); }
  function updateHud(){ welt.spur.push('updateHud'); }
  function openCover(n){ welt.spur.push('openCover:'+n); }
  function setStatus(s){ welt.spur.push('status'); }
  // Spielwirkungen, die die Eingabe NICHT ausloesen darf.
  function beginReveal(){ welt.spur.push('beginReveal'); phase='reveal'; }
  function applyLaunch(){ welt.spur.push('applyLaunch'); phase='sim';
    welt.starts.push(commitIdx.map((idx,i)=>({seat:i,idx:idx,dx:commitAim[i].dx,
                     dy:commitAim[i].dy,sp:commitSpin[i],an:aimSet[i]}))); }
  function botMove(){ welt.spur.push('botMove'); return {idx:1,dx:0,dy:0}; }
  // Die Umgebung der v8-Sentinelschreiber. Was der Zugslot bekaeme, landet in welt.t -
  // aufgezeichnet IN writeTurnSlot selbst waere zu spaet: gemessen wird der echte
  // Schreibvorgang, also die Transaktion auf dem t-Pfad.
  const FFA_MAX_SEATS=5;
  let pendingSlot={}, seatLeft=[], turnUnsub=null, roomP={}, fbGoalState='play';
  let gameStarted=true, onlineTerminatedSession=null;
  function fbMorphActive(){ return false; }
  function fbApplyPendingRemovals(){ welt.spur.push('pendingRemovals'); }
  function clearAllSentinelRetries(){ welt.spur.push('clearRetries'); }
  function fbMaybeEvictExpired(){ welt.evictLaeufe++; return 0; }
  function scheduleSentinelRetry(s,ctx){ welt.spur.push('retry:'+s); }
  function onlineTurnValue(v){ welt.spur.push('turnValue'); }
  function settleSlot(s,ctx,result,err){ delete pendingSlot[s]; }
  // Die Spielwelt: ein Ball je Sitz in Sitzreihenfolge, danach der neutrale Ball -
  // genau die Anordnung, die newGame() fuer die Elimination baut.
  let balls = [], commitIdx = [], commitAim = [], commitSpin = [], aimSet = [];
  let fbElimActive = welt.aktiv;
  let dragPull = {x:0,y:0}, dragSpin = 0;
  function aliveBalls(owner){ return balls.filter(b=>b.alive&&b.owner===owner); }
  function aliveCount(owner){ return aliveBalls(owner).length; }
  function fbElimActiveOwners(){ const o=[]; for(let i=0;i<welt.cap;i++)if(fbElimActive[i])o.push(i); return o; }
  function fbOffen(){ const o=[]; for(const i of fbElimActiveOwners())if(!aimSet[i])o.push(i); return o; }
  function resetCommits(){ aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
    for(let p=0;p<np();p++){aimSet.push(false);commitIdx.push(-1);
                            commitAim.push({dx:0,dy:0});commitSpin.push(0);} }
  function footballElimEliminate(o,stapel){
    if(!fbElimActive[o])return; fbElimActive[o]=false;
    for(const b of balls)if(b.owner===o){b.alive=false;b.vx=0;b.vy=0;b.spin=0;}
    if(stapel)return;
    const uebrig=fbElimActiveOwners();
    if(uebrig.length===1){ footballWinner=uebrig[0]; phase='over'; } }
  function weltAufbauen(){ balls=[];
    for(let i=0;i<welt.cap;i++)balls.push({x:100*i,y:0,vx:0,vy:0,owner:i,alive:true,spin:0});
    balls.push({x:500,y:500,vx:0,vy:0,owner:welt.cap,alive:true,spin:0});
    resetCommits(); }
  weltAufbauen();
  ${AIMVEC}
  ${SANITIZE}
  ${CANINPUT}
  ${COMMIT}
  ${APPLY}
  ${SEND}
  ${SENTINEL_SRC}
  ${BEREICH}
  // Horchposten AUF den echten Funktionen: der Aufruf geht weiter, wird aber gezaehlt.
  // So laesst sich beweisen, welcher Weg genommen wurde - ohne den Weg zu veraendern.
  const echtHandeln = fbV9LebenHandeln;
  fbV9LebenHandeln = function(aktion){
    welt.handeln.push(JSON.parse(JSON.stringify(aktion)));
    const r = echtHandeln(aktion); welt.handelnErg.push(r); return r; };
  const echtSenden = onlineSendCommit;
  onlineSendCommit = function(idx,fx,fy,spin){
    welt.senden.push({idx:idx,dx:fx,dy:fy,sp:spin}); return echtSenden(idx,fx,fy,spin); };
  // welt.t haelt die ABSICHT fest (writeTurnSlot wurde gerufen), a.log.schreib den
  // tatsaechlichen Schreibvorgang. Beides getrennt zu messen ist der Kern dieses
  // Beweises: ein Weg, der laeuft aber nichts schreibt, ist etwas anderes als ein Weg,
  // der gar nicht erst laeuft - und nur das Zweite ist echte Isolierung.
  const echtSlot = writeTurnSlot;
  writeTurnSlot = function(s,payload,opts){
    welt.t.push({seat:s,payload:payload}); return echtSlot(s,payload,opts); };
  return { sync, commit, applyCommit, sanitizeMove, canCommitInput, maxPull,
           zielen: (px,py,spin) => { dragPull={x:px,y:py}; dragSpin=spin||0;
                                     return aimVectorFromDrag(); },
           losLassen: (who,sh,px,py,spin) => {   // GENAU der Rumpf des echten pointerup
             dragPull={x:px,y:py}; dragSpin=spin||0;
             const v=aimVectorFromDrag();
             if(v.weak&&fbTactical())return null;
             commit(who,sh,v.fx,v.fy,v.spin); return v; },
           standTaste: (who) => {                // GENAU der Rumpf des echten actBtn
             if(phase!=='aim')return false;
             if(aimSet[who]||!aliveCount(who))return false;
             const own=aliveBalls(who); const idx=own.length?balls.indexOf(own[0]):-1;
             commit(who,idx,0,0); return true; },
           // Die v8-Sentinelwege, jeder einzeln ansteuerbar - und onlineArmTurn, das sie
           // in der echten Runde alle drei anstoesst.
           onlineArmTurn: () => onlineArmTurn(),
           fbMaybeSkipOffline: () => fbMaybeSkipOffline(),
           fbMaybeWriteRemoves: () => fbMaybeWriteRemoves(),
           writeLeaveSentinel: (s) => writeLeaveSentinel(s),
           fbSkipBoundary: () => fbSkipBoundary(),
           lage: (o) => { if('gameStarted' in o)gameStarted=o.gameStarted;
                          if('roomP' in o)roomP=o.roomP; if('seatLeft' in o)seatLeft=o.seatLeft;
                          if('goal' in o)fbGoalState=o.goal; },
           fbV9LebenAn, fbV9LebenBereit, fbV9LebenNeueRunde, fbV9LebenHandeln,
           fbV9LebenStop, leben: () => fbV9Leben, fbV9ApplyAccepted,
           sicht: () => ({ commitIdx: commitIdx.slice(), commitAim: JSON.parse(JSON.stringify(commitAim)),
                           commitSpin: commitSpin.slice(), aimSet: aimSet.slice(),
                           balls: JSON.parse(JSON.stringify(balls)), phase, turnNo }),
           FB_V9_R_COMPLETE, FB_V9_COMPLETE, FB_ONLINE_FMT, TURN_MOVE };
`)({ FB: a.FB }, globalThis.crypto, 10000, 5, 5,
   (uhr || STILL).serverNow, (uhr || STILL).setTimeout, (uhr || STILL).clearTimeout,
   lager || speicher(), welt);

const UID = 'UID_INPUT_XXXXXXXXXXXXXXXX';
const P = (r) => 'rooms/RN2K/g/7/' + r;
const TS = 4000000;
const Q_READY = (n) => ({ k: 'ready', n, ts: TS });
const bereitAlle = (n, turn) => { const q = {}; for (let i = 0; i < n; i++) q[i] = Q_READY(turn); return q; };
// Eine v9-Spielwelt. `ONLINE_PROTOCOL_VERSION` entscheidet ueber die Ruhe.
const welt9 = (x) => Object.assign({
  online: true, mode: 'football', fmt: 'elimination', roomCode: 'RN2K', myPlayer: 1,
  gen: 7, turnNo: 0, phase: 'aim', footballWinner: null, onlineSessionId: 3,
  ONLINE_PROTOCOL_VERSION: 9, roomProto: 9, curAimer: 1, elim4: true, cap: 3, uid: UID, evicted: {},
  gesperrt: false, spur: [], starts: [], t: [], handeln: [], handelnErg: [], senden: [],
  evictLaeufe: 0, aktiv: [true, true, true] }, x || {});
const cEigen = (a, turn) => a.log.schreib.filter(w => w.pfad === P('c/' + turn + '/1'));
// JEDER tatsaechliche Schreibvorgang in den v8-Zugslot - ueber alle Raeume und Runden.
const tSchreib = (a) => a.log.schreib.filter(w => /\/g\/\d+\/t\//.test(w.pfad));

// Eine laufende v9-Runde mit geschlossener Barriere und eroeffneter Entscheidung.
async function runde(uhr, welt, lager) {
  const a = attrappe({}, uhr), M = baue(a, uhr, welt, lager);
  const L = M.fbV9LebenNeueRunde();
  await settle();
  a.zustellen(P('q/' + welt.turnNo), bereitAlle(welt.cap, welt.turnNo));
  await settle();
  return { a, M, L };
}

console.log('=== V9.5B: der echte Eingabeweg -> V9-Handlung ===');

(async () => {

// ══ V8 BLEIBT AUF SEINEM WEG ═════════════════════════════════════════════════
abschnitt('V8: der Zug geht unveraendert in den t-Slot');
{
  const u = uhrwerk(4000000);
  const welt = welt9({ roomProto: 8 });
  const a = attrappe({}, u), M = baue(a, u, welt);
  t('die Anbindung ist aus', M.fbV9LebenAn() === false);
  const v = M.losLassen(1, 1, 60, -80, 0.5);          // echtes Zeigerloslassen
  t('der Drag ergibt einen echten Schuss', v.weak === false && v.fx === -60 && v.fy === 80);
  t('1. applyCommit ruft onlineSendCommit', welt.senden.length === 1, welt.senden.length);
  t('2. und schreibt durch den t-Pfad', welt.t.length === 1, welt.t.length);
  t('   der Slot traegt die kanonische v4-Form MIT Zugart',
    welt.t[0].seat === 1 && welt.t[0].payload.k === M.TURN_MOVE && welt.t[0].payload.idx === 1
    && welt.t[0].payload.dx === -60 && welt.t[0].payload.dy === 80 && welt.t[0].payload.sp === 0.5,
    JSON.stringify(welt.t[0]));
  t('3. und fbV9LebenHandeln wird NIE gerufen', welt.handeln.length === 0, welt.handeln.length);
  t('   auch die Stand-Taste geht nach v8', (M.standTaste(1), welt.t.length === 2 && welt.handeln.length === 0));
  // Zwei Absichten, ein Schreibvorgang: der zweite wird von pendingSlot zurueckgehalten,
  // solange der erste noch unterwegs ist. Unveraendertes v8-Verhalten.
  t('   geschrieben wird ausschliesslich in den Zugslot',
    a.log.schreib.length === tSchreib(a).length && tSchreib(a).length === 1,
    a.log.schreib.map(w => w.pfad).join(','));
  t('   und kein einziger v9-Knoten', !a.log.schreib.some(w => /\/(c|d|q|r|ro|x|z|s)(\/|$)/.test(w.pfad)),
    a.log.schreib.map(w => w.pfad).join(','));
}

// ══ V9 NIMMT DEN ZUG ═════════════════════════════════════════════════════════
abschnitt('V9: derselbe applyCommit gibt den Zug an die Ablaufsteuerung');
{
  const u = uhrwerk(4000000);
  const welt = welt9();
  const lager = speicher();
  const { a, M, L } = await runde(u, welt, lager);
  t('die Runde ist eroeffnet', a.log.schreib.some(w => w.pfad === P('d/0')));
  t('und noch kein eigenes Terminal geschrieben', cEigen(a, 0).length === 0);
  // Ein Schuss, der ueber maxPull hinausgeht: sanitizeMove klemmt ihn EINMAL.
  const roh = { fx: -300, fy: 400, spin: 0.5 };
  const erwartet = M.sanitizeMove(1, 1, roh.fx, roh.fy, roh.spin);
  M.losLassen(1, 1, -roh.fx, -roh.fy, roh.spin);
  await settle();
  t('4. der ruhende V9-Zusammenhang leitet auf fbV9LebenHandeln', welt.handeln.length === 1, welt.handeln.length);
  t('   und die Handlung wurde angenommen', welt.handelnErg[0] === true);
  t('5. onlineSendCommit wird NICHT gerufen', welt.senden.length === 0, welt.senden.length);
  t('6. und es entsteht kein t-Slot', welt.t.length === 0, welt.t.length);
  const zug = welt.handeln[0].move;
  t('7. der Abschuss ist der bereinigte idx', zug.idx === erwartet.idx && zug.idx === 1, zug.idx);
  t('8. dx bitgenau wie bereinigt', zug.dx === erwartet.dx, zug.dx + ' vs ' + erwartet.dx);
  t('9. dy bitgenau wie bereinigt', zug.dy === erwartet.dy, zug.dy + ' vs ' + erwartet.dy);
  t('10. sp bitgenau wie bereinigt', zug.sp === erwartet.sp, zug.sp + ' vs ' + erwartet.sp);
  t('   die Klemmung fand genau einmal statt - der Betrag steht auf maxPull',
    Math.abs(Math.hypot(zug.dx, zug.dy) - M.maxPull()) < 1e-9, Math.hypot(zug.dx, zug.dy));
  t('   das eigene Terminal ist hinausgegangen', cEigen(a, 0).length === 1);
  t('   und es ist ein verborgener move - kein Klartext',
    cEigen(a, 0)[0].vorschlag.k === 'move' && typeof cEigen(a, 0)[0].vorschlag.h === 'string'
    && !('dx' in cEigen(a, 0)[0].vorschlag), JSON.stringify(cEigen(a, 0)[0].vorschlag));
  // Das Geheimnis ist die Bruecke zur Hashschicht: genau die Werte des Spielers.
  const g = lager.alles().map(s => JSON.parse(s)).filter(o => o && o.h);
  t('   und die Hashschicht bekam GENAU diese Werte', g.length === 1
    && g[0].idx === erwartet.idx && g[0].dx === erwartet.dx
    && g[0].dy === erwartet.dy && g[0].sp === erwartet.sp, JSON.stringify(g));
  M.fbV9LebenStop();
}

// ══ DIE STAND-TASTE ══════════════════════════════════════════════════════════
abschnitt('Der Nullzug geht als verborgener move, nicht als offenes pass');
{
  const u = uhrwerk(4000000);
  const welt = welt9();
  const { a, M } = await runde(u, welt, welt9.lager);
  t('die Stand-Taste loest aus', M.standTaste(1) === true);
  await settle();
  t('sie geht ueber dieselbe Weiche', welt.handeln.length === 1 && welt.senden.length === 0);
  t('und zwar als move mit Nullvektor - nicht als pass',
    !!welt.handeln[0].move && !welt.handeln[0].pass
    && welt.handeln[0].move.dx === 0 && welt.handeln[0].move.dy === 0 && welt.handeln[0].move.sp === 0,
    JSON.stringify(welt.handeln[0]));
  t('denn ein pass stuende offen in der Datenbank',
    cEigen(a, 0)[0].vorschlag.k === 'move', cEigen(a, 0)[0].vorschlag.k);
  M.fbV9LebenStop();
}

// ══ DAS ENTSCHEIDUNGSFENSTER ═════════════════════════════════════════════════
abschnitt('Handlung vor und nach der eroeffneten Runde');
{
  const u = uhrwerk(4000000);
  const welt = welt9();
  const a = attrappe({}, u), M = baue(a, u, welt);
  const L = M.fbV9LebenNeueRunde();
  await settle();
  t('die Barriere steht noch offen', L.bereit.stufe !== M.FB_V9_R_COMPLETE);
  t('und es laeuft noch keine Ablaufsteuerung', L.lauf === null);
  M.losLassen(1, 1, 40, -40, 0);
  await settle();
  t('11. die echte Eingabe VOR der Runde wird angenommen',
    welt.handeln.length === 1 && welt.handelnErg[0] === true);
  t('    und in der Anbindung gehalten', !!L.aktion && !!L.aktion.move);
  t('12. sie wird nicht vorzeitig festgeschrieben', cEigen(a, 0).length === 0, cEigen(a, 0).length);
  t('    und kein Geheimnis vorzeitig gebaut', !a.log.schreib.some(w => w.pfad === P('d/0')));
  a.zustellen(P('q/0'), bereitAlle(3, 0));
  await settle();
  t('13. nach dem Schluss der Barriere schreibt sie durch die bestehende Steuerung',
    cEigen(a, 0).length === 1, cEigen(a, 0).length);
  t('    und die Runde wurde von der Steuerung eroeffnet, nicht von der Eingabe',
    a.log.schreib.some(w => w.pfad === P('d/0')));
  M.fbV9LebenStop();
}
{
  const u = uhrwerk(4000000);
  const welt = welt9();
  const { a, M } = await runde(u, welt);
  M.losLassen(1, 1, 40, -40, 0);
  await settle();
  t('14. eine Eingabe NACH der eroeffneten Runde schreibt normal',
    cEigen(a, 0).length === 1 && welt.handelnErg[0] === true, cEigen(a, 0).length);
  M.fbV9LebenStop();
}
{
  // Kein Zug - die gemeinsame Uhr laeuft trotzdem, und die Frist schliesst den Slot.
  const u = uhrwerk(4000000);
  const welt = welt9();
  const { a, M } = await runde(u, welt);
  t('15. ohne jede Eingabe ist die Runde dennoch eroeffnet',
    a.log.schreib.some(w => w.pfad === P('d/0')) && welt.handeln.length === 0);
  a.zustellen(P('d/0'), { n: 1, o: TS });
  await settle();
  await u.vor(7000);
  const spaet = cEigen(a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'late');
  t('16. nach der Frist schliesst die bestehende Mechanik den offenen Slot mit late',
    spaet.length >= 1, cEigen(a, 0).map(w => w.vorschlag && w.vorschlag.k).join(','));
  t('    und es entstand nie ein t-Slot', welt.t.length === 0);
  M.fbV9LebenStop();
}

// ══ GENAU EIN ZUG JE RUNDE ═══════════════════════════════════════════════════
abschnitt('Ein Zug je Runde - auch bei doppeltem Loslassen');
{
  const u = uhrwerk(4000000);
  const welt = welt9();
  const lager = speicher();
  const { a, M } = await runde(u, welt, lager);
  M.losLassen(1, 1, 40, -40, 0.25);
  await settle();
  const salz1 = lager.alles().map(s => JSON.parse(s)).filter(o => o && o.salt).map(o => o.salt);
  t('17. die erste echte Abgabe wird angenommen', welt.handelnErg[0] === true);
  M.losLassen(1, 1, 40, -40, 0.25);                 // identische Wiederholung
  await settle();
  t('18. eine identische Wiederholung erzeugt keine zweite Handlung',
    welt.handelnErg[1] === false, welt.handelnErg.join(','));
  M.losLassen(1, 1, -90, 120, -0.75);               // widersprechender zweiter Zug
  M.standTaste(1);
  await settle();
  t('19. auch ein widersprechender zweiter Zug wird abgewiesen',
    welt.handelnErg.slice(1).every(r => r === false), welt.handelnErg.join(','));
  const salz2 = lager.alles().map(s => JSON.parse(s)).filter(o => o && o.salt).map(o => o.salt);
  t('20. es entstand kein zweites Salz',
    salz1.length === 1 && salz2.length === 1 && salz1[0] === salz2[0], salz2.length);
  t('21. und kein zweites Geheimnis',
    JSON.stringify(lager.alles()) === JSON.stringify(lager.alles()) && salz2.length === 1);
  t('22. das Terminal steht genau einmal', cEigen(a, 0).length === 1, cEigen(a, 0).length);
  t('    und der festgeschriebene Zug ist der ERSTE des Spielers',
    lager.alles().map(s => JSON.parse(s)).filter(o => o && o.salt)[0].sp === 0.25);
  M.fbV9LebenStop();
}

// ══ GESCHLOSSEN SCHEITERN ════════════════════════════════════════════════════
abschnitt('Ein v9-Raum faellt nie auf v8 zurueck');
{
  const u = uhrwerk(4000000);
  const welt = welt9();
  const { a, M } = await runde(u, welt);
  M.losLassen(1, 1, 40, -40, 0);
  await settle();
  const vorher = welt.t.length;
  M.losLassen(1, 1, 70, 20, 0);
  await settle();
  t('23. eine abgewiesene Handlung faellt NICHT auf onlineSendCommit zurueck',
    welt.senden.length === 0, welt.senden.length);
  t('24. und schreibt keinen t-Slot', welt.t.length === vorher && welt.t.length === 0, welt.t.length);
  M.fbV9LebenStop();
}
{
  // Veralteter Lauf: das Spiel ist eine Runde weiter, die Eingabe kommt aus der alten.
  const u = uhrwerk(4000000);
  const welt = welt9();
  const { a, M } = await runde(u, welt);
  welt.turnNo = 1; M.sync();
  M.fbV9LebenNeueRunde();
  await settle();
  const vorherC = cEigen(a, 0).length;
  M.losLassen(1, 1, 40, -40, 0);
  await settle();
  t('25. eine Handlung in einen veralteten Lauf schreibt nicht in die alte Runde',
    cEigen(a, 0).length === vorherC, cEigen(a, 0).length + ' vs ' + vorherC);
  t('    und niemals in den t-Pfad', welt.t.length === 0, welt.t.length);
  M.fbV9LebenStop();
}
{
  const u = uhrwerk(4000000);
  const welt = welt9();
  const { a, M } = await runde(u, welt);
  M.fbV9LebenStop();
  await settle();
  M.losLassen(1, 1, 40, -40, 0);
  await settle();
  t('26. eine Handlung an eine angehaltene Anbindung wird abgewiesen',
    welt.handelnErg[0] === false, welt.handelnErg.join(','));
  t('    und faellt nicht auf v8 zurueck', welt.t.length === 0 && welt.senden.length === 0);
}
{
  // Der Zusammenhang hat gewechselt: anderer Raum. Der alte Lauf darf nichts mehr abgeben.
  const u = uhrwerk(4000000);
  const welt = welt9();
  const { a, M } = await runde(u, welt);
  welt.roomCode = 'PQ7X'; M.sync();
  M.losLassen(1, 1, 40, -40, 0);
  await settle();
  t('27. ein gewechselter Raum kann nicht in den laufenden Zyklus abgeben',
    cEigen(a, 0).length === 0 && !a.log.schreib.some(w => w.pfad.indexOf('rooms/PQ7X') === 0),
    cEigen(a, 0).length);
  t('    und erzeugt keinen t-Slot', welt.t.length === 0);
  M.fbV9LebenStop();
}

// ══ DIE SPIELHOHEIT BLEIBT BEI DER ZUGMENGE ══════════════════════════════════
abschnitt('Die Eingabe startet kein Spiel');
{
  const u = uhrwerk(4000000);
  const welt = welt9();
  const { a, M } = await runde(u, welt);
  const vor = M.sicht();
  M.losLassen(1, 1, 40, -40, 0.5);
  await settle();
  const nach = M.sicht();
  t('28. kein applyLaunch', welt.spur.indexOf('applyLaunch') < 0, welt.spur.join(','));
  t('29. kein beginReveal', welt.spur.indexOf('beginReveal') < 0, welt.spur.join(','));
  t('30. die Rundennummer bleibt unberuehrt', nach.turnNo === vor.turnNo && nach.turnNo === 0);
  t('    die Phase bleibt aim', nach.phase === 'aim', nach.phase);
  t('31. und die Spielfelder bleiben leer - die Zugmenge ist der einzige Weg dorthin',
    JSON.stringify(nach.commitIdx) === JSON.stringify(vor.commitIdx)
    && JSON.stringify(nach.commitAim) === JSON.stringify(vor.commitAim)
    && JSON.stringify(nach.aimSet) === JSON.stringify(vor.aimSet)
    && nach.aimSet.every(v => v === false),
    JSON.stringify(nach.commitIdx) + '/' + JSON.stringify(nach.aimSet));
  // Erst die gepruefte Zugmenge fuellt sie - unveraendert aus V9.4D1.
  M.fbV9ApplyAccepted(M.leben(), [
    { seat: 0, kind: 'pass', status: 'VALID', move: null },
    { seat: 1, kind: 'move', status: 'VALID', move: { idx: 1, dx: 5, dy: 6, sp: 0.1 } },
    { seat: 2, kind: 'pass', status: 'VALID', move: null }]);
  const danach = M.sicht();
  t('    die Zugmenge dagegen wirkt', danach.aimSet[1] === true && danach.commitAim[1].dx === 5,
    JSON.stringify(danach.commitAim[1]));
  M.fbV9LebenStop();
}

// ══ OFFLINE BLEIBT OFFLINE ═══════════════════════════════════════════════════
abschnitt('Lokales Spiel unveraendert');
{
  const u = uhrwerk(4000000);
  const welt = welt9({ online: false, roomProto: 9 });
  const a = attrappe({}, u), M = baue(a, u, welt);
  t('die Anbindung ist aus', M.fbV9LebenAn() === false);
  M.losLassen(1, 1, 40, -40, 0.5);
  const s = M.sicht();
  t('32. der lokale Zug wird lokal eingetragen',
    s.aimSet[1] === true && s.commitIdx[1] === 1 && s.commitAim[1].dx === -40 && s.commitSpin[1] === 0.5,
    JSON.stringify({ a: s.aimSet, i: s.commitIdx, m: s.commitAim[1], sp: s.commitSpin[1] }));
  t('    ohne Netzweg', welt.t.length === 0 && welt.senden.length === 0 && welt.handeln.length === 0);
  t('    und ohne Protokollschreibvorgang', a.log.schreib.length === 0, a.log.schreib.length);
  const offen = M.sicht().aimSet.filter(v => !v).length;
  t('    das gemeinsame Fenster bleibt offen, solange jemand fehlt', offen === 2, offen);
}

// ══ DIE ALTEN SENTINELWEGE ═══════════════════════════════════════════════════
// Der Zugslot t hat vier Schreiber: die Spielereingabe und drei Sentinelwege aus v8.
// Die Eingabe ist oben umgeleitet. Hier geht es um die anderen drei - sie kennen die
// Protokollfassung nicht und laufen an genau der Grenze, die in v9 das
// Entscheidungsfenster IST: phase==='aim'.
abschnitt('In einem v9-Raum schreibt kein alter Sentinelweg mehr');
{
  const u = uhrwerk(4000000);
  // Sitz 0 ist getrennt (Praesenz aus, Gnadenfrist abgelaufen), Sitz 2 dauerhaft
  // ausgetragen. In v8 wuerde der eine einen SKIP und der andere einen REMOVE bekommen.
  const welt = welt9({ evicted: { 2: true } });
  const { a, M } = await runde(u, welt);
  M.lage({ roomP: { 1: { on: true } } });
  const vorher = tSchreib(a).length;
  t('   die sichere Grenze ist offen - das Entscheidungsfenster ist genau sie',
    M.fbSkipBoundary() === true);
  M.fbMaybeSkipOffline();
  M.fbMaybeWriteRemoves();
  M.writeLeaveSentinel(0);
  await settle();
  t('2. der Fristweg ohne Handlung schreibt kein t', tSchreib(a).length === vorher);
  t('3. ein getrennter Sitz bekommt keinen SKIP im Zugslot',
    !tSchreib(a).some(w => w.vorschlag && w.vorschlag.k === 'skip'),
    JSON.stringify(tSchreib(a)));
  t('5. ein ausgetragener Sitz bekommt keinen REMOVE im Zugslot',
    !tSchreib(a).some(w => w.vorschlag && w.vorschlag.k === 'remove'));
  t('10. und kein automatischer Stand-Sentinel', tSchreib(a).length === 0, tSchreib(a).length);
  // Die ganze echte Runde: onlineArmTurn stoesst alle drei Wege auf einmal an.
  const evVor = welt.evictLaeufe;
  M.onlineArmTurn();
  await settle();
  t('9. auch die naechste Runde als Ganzes schreibt kein t',
    tSchreib(a).length === 0, JSON.stringify(tSchreib(a).map(w => w.pfad)));
  t('   die Austragung ueber e laeuft dagegen weiter - v9 liest sie',
    welt.evictLaeufe === evVor + 1, welt.evictLaeufe);
  // Der Unterschied, auf den es ankommt: die alten Wege LAUFEN noch - sie sind nicht
  // entfernt worden - aber am Engpass schreiben sie nichts mehr. Genau das ist
  // Isolierung, und genau das haelt kuenftige Sentinelwege ohne weiteres Zutun mit ab.
  t('   die alten Wege laufen weiterhin bis an den Engpass', welt.t.length > 0, welt.t.length);
  t('   und werden dort geschlossen', tSchreib(a).length === 0);
  t('1. und die Spielereingabe schreibt weiterhin kein t',
    (M.losLassen(1, 1, 40, -40, 0), tSchreib(a).length === 0), tSchreib(a).length);
  M.fbV9LebenStop();
}
{
  // Ausgetragen ueber e und ueber x: beide sind v9-Begriffe. Die alten Wege duerfen
  // auf keinen von beiden reagieren.
  const u = uhrwerk(4000000);
  const welt = welt9({ evicted: { 0: true, 2: true } });
  const a = attrappe({ [P('e')]: { 0: true }, [P('x')]: { 2: { k: 'ready_timeout', n: 0, ts: TS } } }, u);
  const M = baue(a, u, welt);
  M.fbV9LebenNeueRunde();
  await settle();
  M.lage({ roomP: {} });
  M.onlineArmTurn();
  await settle();
  t('4. ein per x disqualifizierter Sitz erzeugt keinen t-Schreibvorgang',
    !tSchreib(a).length, JSON.stringify(tSchreib(a).map(w => w.pfad)));
  t('6. ein getrennter Gegenspieler ebenfalls nicht', tSchreib(a).length === 0);
  t('8. und die laufende Runde wird nicht ueber t fortgesetzt',
    !a.log.schreib.some(w => /\/t\//.test(w.pfad)));
  M.fbV9LebenStop();
}
{
  // Wiedereintritt: die Historie eines v9-Raums steht in c und r. Der v8-Lesevorgang
  // auf t ist im Produkt schon seit V9.4D2 hinter der Protokollweiche - hier wird
  // geprueft, dass die Weiche steht und der Wiedereintritt nichts in t schreibt.
  t('7. der Wiedereintritt liest t nur, wenn der Raum KEIN v9-Raum ist',
    /const v9=fbV9RaumIst9\(v\);[\s\S]{0,400}?if\(!v9\)\{[\s\S]{0,300}?'\/t'\)\)/.test(HTML));
  t('   und der frische Start geht in einem v9-Raum ueber die Rehydrierung',
    /if\(typeof fbV9RaumStart!=='function'\|\|!fbV9RaumStart\(\)\)startOnlineGame\(\);/.test(HTML));
}

// ══ V8 BEHAELT SEINE SENTINEL ════════════════════════════════════════════════
abschnitt('V8: die alten Sentinelwege arbeiten unveraendert');
{
  const u = uhrwerk(4000000);
  const welt = welt9({ roomProto: 8, evicted: { 2: true } });
  const a = attrappe({}, u), M = baue(a, u, welt);
  M.lage({ roomP: { 1: { on: true } } });      // 0 und 2 sind nicht verbunden
  M.fbMaybeSkipOffline();
  await settle();
  const skips = tSchreib(a).filter(w => w.vorschlag && w.vorschlag.k === 'skip');
  t('12. der SKIP eines getrennten Sitzes wird weiterhin geschrieben',
    skips.length === 1 && skips[0].pfad.indexOf('/t/0/0') > 0,
    JSON.stringify(tSchreib(a).map(w => w.pfad)));
  t('    mit unveraenderter Nutzlast',
    skips[0].vorschlag.idx === 0 && skips[0].vorschlag.dx === 0
    && skips[0].vorschlag.dy === 0 && skips[0].vorschlag.sp === 0,
    JSON.stringify(skips[0].vorschlag));
  t('    und ein ausgetragener Sitz bekommt KEINEN SKIP - er wartet auf den REMOVE',
    !skips.some(w => w.pfad.indexOf('/t/0/2') > 0));
  M.fbMaybeWriteRemoves();
  await settle();
  const rem = tSchreib(a).filter(w => w.vorschlag && w.vorschlag.k === 'remove');
  t('13. der REMOVE des ausgetragenen Sitzes wird weiterhin geschrieben',
    rem.length === 1 && rem[0].pfad.indexOf('/t/0/2') > 0,
    JSON.stringify(tSchreib(a).map(w => w.pfad)));
}
{
  const u = uhrwerk(4000000);
  const welt = welt9({ roomProto: 8, mode: 'ffa', fmt: 'ffa', elim4: false });
  const a = attrappe({}, u), M = baue(a, u, welt);
  M.lage({ seatLeft: [true, false, false] });
  M.writeLeaveSentinel(0);
  await settle();
  t('14. der automatische Stand-Sentinel im FFA schreibt weiterhin',
    tSchreib(a).length === 1 && tSchreib(a)[0].vorschlag.idx === 1,
    JSON.stringify(tSchreib(a).map(w => w.vorschlag)));
}
{
  const u = uhrwerk(4000000);
  const welt = welt9({ roomProto: 8 });
  const a = attrappe({}, u), M = baue(a, u, welt);
  M.lage({ roomP: { 0: { on: true }, 1: { on: true }, 2: { on: true } } });
  M.fbMaybeSkipOffline();
  await settle();
  t('15. ein wieder verbundener Sitz bekommt keinen Sentinel - er zieht selbst',
    tSchreib(a).length === 0, tSchreib(a).length);
}

// ══ DIE RUHE ═════════════════════════════════════════════════════════════════
abschnitt('Der ausgelieferte Client bleibt auf Protokoll 8');
{
  t('37. ONLINE_PROTOCOL_VERSION ist 9', /const ONLINE_PROTOCOL_VERSION=9;/.test(HTML));
  // Genau zwei Vorkommen: die Definition und der EINE Aufruf in applyCommit. Faende sich
  // ein dritter, gaebe es einen zweiten v8-Transportweg, den diese Weiche nicht abdeckt.
  t('    onlineSendCommit hat genau EINEN Aufrufer - applyCommit',
    HTML.split('onlineSendCommit(').length - 1 === 2,
    HTML.split('onlineSendCommit(').length - 1);
  t('    und fbV9LebenHandeln hat jetzt eine echte Aufrufstelle',
    /if\(typeof fbV9LebenAn==='function'&&fbV9LebenAn\(\)\)\{ if\(fbV9LebenHandeln\(\{move:/.test(HTML));
}

console.log('\n════════════════════════════════════════════════════════════');
console.log('Online-V9-Eingabebruecke: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

})();
