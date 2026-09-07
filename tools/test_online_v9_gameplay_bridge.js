// V9.4D1: die Spielbruecke - verifizierte Zugmenge in die Lebensregel.
//
// Geprueft wird der ECHTE Quelltext aus index.html gegen eine Attrappe des Spielteils.
// Die Attrappe bildet genau die Funktionen nach, die die Bruecke benutzt, und fuehrt
// eine SPUR mit - so laesst sich nicht nur pruefen, WAS geschieht, sondern in welcher
// Reihenfolge.
//
// DIE DREI SAETZE, um die es hier geht:
//   1. Der EINZIGE Weg vom Netz ins Spiel ist eine fertige, vollstaendig geprueufte
//      Zugmenge. Keine Schnappschuesse, keine Schreibergebnisse, keine Zuhoerer.
//   2. Wer ausgeschieden ist, kollidiert im verwirkten Abschuss nicht mehr mit: erst
//      ausscheiden, dann starten.
//   3. Eine Zugmenge wirkt GENAU EINMAL. Ein zweiter Rueckruf startet nichts noch
//      einmal und laesst niemanden zweimal ausscheiden.
//   node test_online_v9_gameplay_bridge.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 58 - s.length)));

const SENTINEL = { '.sv': 'timestamp' };
function attrappe(vorbelegt) {
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
        const g = JSON.parse(JSON.stringify(vorschlag, (k, v) => (v && v['.sv'] === 'timestamp') ? 4000000 : v));
        stand[ref.pfad] = g;
        Promise.resolve().then(() => {
          for (const h of log.hoert) if (h.pfad === ref.pfad && h.offen) h.cb({ val: () => g }); });
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
const STILL = { serverNow: () => 4000000, setTimeout: () => 0, clearTimeout: () => {} };
function speicher() { const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i],
           getItem: (k) => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; }

const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-SPIELANBINDUNG ════');
if (START < 0 || ENDE < 0) { console.log('V9-Bereich nicht gefunden'); process.exit(2); }
const BEREICH = HTML.slice(START, ENDE);
const GLOBAL = ['online', 'mode', 'roomCode', 'myPlayer', 'gen', 'turnNo', 'phase',
                'footballWinner', 'onlineSessionId', 'ONLINE_PROTOCOL_VERSION'];
const baue = (a, welt) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
    'FB_ONLINE_BALL_IDX', 'serverNow', 'setTimeout', 'clearTimeout', 'sessionStorage', 'welt', `
  let ${GLOBAL.join(', ')};
  function sync(){ ${GLOBAL.map(n => n + ' = welt.' + n + ';').join(' ')} }
  sync();
  function fbElim4(){ return welt.elim4; }
  function fbElimPlayers(){ return welt.cap; }
  function fbUid(){ return welt.uid; }
  function fbEvicted(s){ return !!(welt.evicted && welt.evicted[s]); }
  // Der Spielteil als Attrappe - genau die Funktionen, die die Bruecke benutzt, mit
  // einer SPUR fuer die Reihenfolge.
  let balls = [], commitIdx = [], commitAim = [], commitSpin = [], aimSet = [];
  function np(){ return welt.cap; }
  function resetCommits(){ aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
    for(let p=0;p<np();p++){aimSet.push(false);commitIdx.push(-1);
                            commitAim.push({dx:0,dy:0});commitSpin.push(0);} }
  function beginReveal(){ welt.spur.push('beginReveal'); phase='reveal'; }
  function applyLaunch(){ welt.spur.push('applyLaunch'); phase='sim';
    welt.starts.push(commitIdx.map((idx,i)=>({seat:i,idx:idx,dx:commitAim[i].dx,
                     dy:commitAim[i].dy,sp:commitSpin[i],an:aimSet[i]}))); }
  // Bildet footballElimEliminate nach: idempotent je Sitz, KEIN Riegel auf phase
  // 'over', und die verbleibende Menge wird bei JEDEM Aufruf neu bestimmt. Genau
  // diese drei Eigenschaften des echten Quelltexts pruefen die Waechter unten.
  // Bildet den ECHTEN footballElimEliminate nach - einschliesslich des additiven
  // Stapelmodus: ist stapel gesetzt, aendert der Aufruf NUR den Zustand und trifft
  // keine Entscheidung. Die Spur haelt jede Entscheidung fest, damit sich zeigen laesst,
  // dass es genau eine gibt.
  let fbElimActive = welt.aktiv;
  function footballElimEliminate(o,stapel){
    if(!fbElimActive[o])return;
    welt.spur.push('raus:'+o); fbElimActive[o]=false;
    for(const b of balls)if(b.owner===o){b.alive=false;b.vx=0;b.vy=0;}
    if(stapel){ welt.spur.push('stapel:'+o); return; }
    const uebrig=[]; for(let i=0;i<welt.cap;i++)if(fbElimActive[i])uebrig.push(i);
    // Wie footballMatchEnd: gameOver spielt SFX.win() - deshalb wird jede Entscheidung
    // festgehalten, auch die siegreiche.
    if(uebrig.length===0){ footballWinner=null; phase='over';
                           welt.spur.push('ohne Sieger'); }
    else if(uebrig.length===1){ footballWinner=uebrig[0]; phase='over';
                                welt.spur.push('SIEGERKLANG'); welt.spur.push('Sieger '+uebrig[0]); } }
  function fbV9WeltAufbauen(){ balls=[];
    for(let i=0;i<welt.cap;i++)balls.push({owner:i,alive:true,vx:0,vy:0,spin:0});
    resetCommits(); }
  fbV9WeltAufbauen();
  ${BEREICH}
  return { sync, fbV9LebenBereit, fbV9LebenNeueRunde, fbV9LebenStop, fbV9LebenAn,
           fbV9ApplyAccepted, fbV9AcceptedOk, leben: () => fbV9Leben,
           sicht: () => ({ commitIdx, commitAim, commitSpin, aimSet, balls, phase,
                           footballWinner }),
           FB_V9_VALID, FB_V9_NO_REVEAL, FB_V9_MISMATCH, FB_V9_MALFORMED };
`)({ FB: a.FB }, globalThis.crypto, 10000, 5, 5,
   STILL.serverNow, STILL.setTimeout, STILL.clearTimeout, speicher(), welt);

const UID = 'UID_BRIDGE_XXXXXXXXXXXXXXXX';
const P = (r) => 'rooms/RN2K/g/7/' + r;
const welt9 = (x) => Object.assign({
  online: true, mode: 'football', roomCode: 'RN2K', myPlayer: 1, gen: 7, turnNo: 0,
  phase: 'aim', footballWinner: null, onlineSessionId: 3,
  ONLINE_PROTOCOL_VERSION: 9, elim4: true, cap: 3, uid: UID, evicted: {},
  spur: [], starts: [], aktiv: [true, true, true] }, x || {});
const ruhe = () => new Promise(r => setTimeout(r, 0));
const settle = async (n) => { for (let i = 0; i < (n || 10); i++) await ruhe(); };
// Eintraege einer Zugmenge.
const gueltig = (seat, dx, dy, sp) => ({ seat, kind: 'move', status: 'VALID',
                                         move: { idx: seat, dx, dy, sp } });
const raus = (seat, status) => ({ seat, kind: 'move', status, move: null });
const nullzug = (seat, kind) => ({ seat, kind, status: 'VALID', move: null });

// Ein Lebenslauf ohne Netzumweg: die Bruecke wird unmittelbar gerufen.
function lauf(welt) {
  const a = attrappe();
  const M = baue(a, welt);
  const L = { sid: welt.onlineSessionId, room: welt.roomCode, gen: welt.gen,
              turn: welt.turnNo, seat: welt.myPlayer, stufe: 'PROTOKOLL',
              ctx: { v: 9, code: welt.roomCode, gen: welt.gen, turn: welt.turnNo,
                     seat: welt.myPlayer, cap: welt.cap, uid: welt.uid },
              bereit: null, lauf: null, aktion: null, uebergeben: true,
              bereitFertig: true, rausAb: null, rausStand: null, rausLaeuft: false,
              wecker: {}, angewandt: false };
  return { a, M, L };
}

console.log('=== V9.4D1: Spielbruecke (ruhend) ===');

(async () => {

// ══ GUELTIGE ZUEGE ═══════════════════════════════════════════════════════════
abschnitt('Gueltige Zuege - exakt die verifizierten Werte');
{
  const welt = welt9();
  const g = lauf(welt);
  // Der Lebenslauf muss der aktuelle sein - sonst weist die Bruecke ab.
  const L = g.M.fbV9LebenBereit(0) || g.L;
  g.M.fbV9LebenStop();
  const w2 = welt9();
  const h = lauf(w2);
  // Direkter Weg: die Bruecke bekommt einen Lebenslauf, den sie als aktuell ansieht.
  const M = h.M;
  const echt = M.fbV9LebenBereit(0);
  t('ein Lebenslauf ist da', !!echt);
  const menge = [gueltig(0, 12.5, -8.25, 0.5), gueltig(1, -3.75, 6.5, 0.875),
                 nullzug(2, 'pass')];
  t('die Zugmenge wird angenommen', M.fbV9ApplyAccepted(echt, menge) === true);
  const s = M.sicht();
  t('Sitz 0 traegt genau seinen Index', s.commitIdx[0] === 0);
  t('und genau seinen Vektor',
    s.commitAim[0].dx === 12.5 && s.commitAim[0].dy === -8.25 && s.commitSpin[0] === 0.5,
    JSON.stringify(s.commitAim[0]) + '/' + s.commitSpin[0]);
  t('Sitz 1 ebenso',
    s.commitIdx[1] === 1 && s.commitAim[1].dx === -3.75 && s.commitAim[1].dy === 6.5 &&
    s.commitSpin[1] === 0.875);
  t('beide gelten als bestaetigt', s.aimSet[0] === true && s.aimSet[1] === true);
  t('der Nullzug traegt keinen Index', s.commitIdx[2] === -1 && s.aimSet[2] === false);
  t('der BESTEHENDE Abschussweg wurde benutzt',
    w2.spur.join(',') === 'beginReveal,applyLaunch', w2.spur.join(','));
  t('und genau einmal', w2.starts.length === 1, w2.starts.length);
  t('die Phase steht auf sim', s.phase === 'sim', s.phase);
  M.fbV9LebenStop();
  void L; void g;
}

// ══ NULLHANDLUNGEN ═══════════════════════════════════════════════════════════
abschnitt('Nullhandlungen - kein Abschuss, kein Lebensabzug');
{
  for (const art of ['pass', 'late', 'skip', 'remove']) {
    const welt = welt9();
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    const menge = [gueltig(0, 4, 0, 0), nullzug(1, art), nullzug(2, art)];
    t(art + ': die Menge wird angenommen', g.M.fbV9ApplyAccepted(L, menge) === true);
    const s = g.M.sicht();
    t(art + ': kein Abschuss fuer diesen Sitz', s.commitIdx[1] === -1 && s.aimSet[1] === false);
    t(art + ': niemand scheidet dadurch aus',
      welt.spur.filter(x => x.indexOf('raus:') === 0).length === 0, welt.spur.join(','));
    t(art + ': und der gueltige Zug laeuft trotzdem', s.commitIdx[0] === 0);
    g.M.fbV9LebenStop();
  }
}

// ══ PROTOKOLLAUSSCHLUESSE ════════════════════════════════════════════════════
abschnitt('Protokollausschluesse - sofort, und VOR dem Abschuss');
{
  for (const st of ['NO_REVEAL', 'HASH_MISMATCH', 'MALFORMED']) {
    const welt = welt9({ cap: 4, aktiv: [true, true, true, true] });
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    const menge = [gueltig(0, 4, 0, 0), raus(1, st), gueltig(2, -4, 0, 0),
                   nullzug(3, 'late')];
    t(st + ': die Menge wird angenommen', g.M.fbV9ApplyAccepted(L, menge) === true);
    t(st + ': der Sitz scheidet aus', welt.aktiv[1] === false);
    t(st + ': und zwar VOR dem Abschuss',
      welt.spur.indexOf('raus:1') >= 0 &&
      welt.spur.indexOf('raus:1') < welt.spur.indexOf('applyLaunch'), welt.spur.join(','));
    const s = g.M.sicht();
    t(st + ': er startet nicht', s.commitIdx[1] === -1 && s.aimSet[1] === false);
    t(st + ': seine Kugel ist tot', s.balls[1].alive === false);
    t(st + ': die anderen starten', s.commitIdx[0] === 0 && s.commitIdx[2] === 2);
    t(st + ': der Nullzug bleibt leer', s.commitIdx[3] === -1);
    t(st + ': genau ein Abschussstapel', welt.starts.length === 1);
    g.M.fbV9LebenStop();
  }
  {
    // Mehrere Ausschluesse: aufsteigend.
    const welt = welt9({ cap: 5, aktiv: [true, true, true, true, true] });
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    const menge = [gueltig(0, 4, 0, 0), raus(1, 'NO_REVEAL'), gueltig(2, 1, 1, 0),
                   raus(3, 'HASH_MISMATCH'), nullzug(4, 'pass')];
    g.M.fbV9ApplyAccepted(L, menge);
    const rausFolge = welt.spur.filter(x => x.indexOf('raus:') === 0);
    t('die Ausschluesse fallen aufsteigend', rausFolge.join(',') === 'raus:1,raus:3',
      rausFolge.join(','));
    t('und beide vor dem Abschuss',
      welt.spur.indexOf('applyLaunch') > welt.spur.lastIndexOf('raus:3'));
    g.M.fbV9LebenStop();
  }
  {
    // Kein neuer Firebase-Marker: die Bruecke schreibt gar nicht.
    const welt = welt9();
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    const vorher = g.a.log.schreib.length;
    g.M.fbV9ApplyAccepted(L, [gueltig(0, 4, 0, 0), raus(1, 'NO_REVEAL'), nullzug(2, 'pass')]);
    t('ein Ausschluss erzeugt kein e, kein x und kein remove',
      !g.a.log.schreib.slice(vorher).some(w => /\/(e|x)\b/.test(w.pfad) ||
        (w.vorschlag && w.vorschlag.k === 'remove')),
      g.a.log.schreib.slice(vorher).map(w => w.pfad).join(','));
    g.M.fbV9LebenStop();
  }
}

// ══ GEMISCHTE MENGE ══════════════════════════════════════════════════════════
abschnitt('Die gemischte Menge aus dem Vertrag');
{
  const welt = welt9({ cap: 4, aktiv: [true, true, true, true] });
  const g = lauf(welt);
  const L = g.M.fbV9LebenBereit(0);
  const menge = [gueltig(0, 10, -2, 0.25), raus(1, 'NO_REVEAL'),
                 gueltig(2, -6, 3, -0.5), nullzug(3, 'late')];
  t('sie wird angenommen', g.M.fbV9ApplyAccepted(L, menge) === true);
  const s = g.M.sicht();
  t('Sitz 1 ist vor dem Abschuss tot', s.balls[1].alive === false &&
    welt.spur.indexOf('raus:1') < welt.spur.indexOf('applyLaunch'));
  t('Sitz 0 startet mit seinem Vektor',
    s.commitIdx[0] === 0 && s.commitAim[0].dx === 10 && s.commitSpin[0] === 0.25);
  t('Sitz 2 ebenso',
    s.commitIdx[2] === 2 && s.commitAim[2].dy === 3 && s.commitSpin[2] === -0.5);
  t('Sitz 3 bleibt leer', s.commitIdx[3] === -1);
  t('und es gibt genau EINEN Abschussstapel', welt.starts.length === 1);
}

// ══ MATCHENDE DURCH AUSSCHLUSS ═══════════════════════════════════════════════
abschnitt('Ein Ausschluss kann das Match beenden');
{
  {
    const welt = welt9({ cap: 2, aktiv: [true, true] });
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    t('die Menge wird angenommen',
      g.M.fbV9ApplyAccepted(L, [gueltig(0, 4, 0, 0), raus(1, 'NO_REVEAL')]) === true);
    t('der letzte Verbliebene ist Sieger', welt.spur.indexOf('Sieger 0') >= 0, welt.spur.join(','));
    t('und es wird NICHT mehr gestartet', welt.starts.length === 0, welt.starts.length);
    t('die Phase steht auf over', g.M.sicht().phase === 'over');
    g.M.fbV9LebenStop();
  }
  {
    const welt = welt9({ cap: 2, aktiv: [true, true] });
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    g.M.fbV9ApplyAccepted(L, [raus(0, 'HASH_MISMATCH'), raus(1, 'NO_REVEAL')]);
    t('scheiden alle aus, endet es ohne Sieger', welt.spur.indexOf('ohne Sieger') >= 0,
      welt.spur.join(','));
    t('auch dann wird nichts gestartet', welt.starts.length === 0);
    g.M.fbV9LebenStop();
  }
}

// ══ GENAU EINMAL ═════════════════════════════════════════════════════════════
abschnitt('Eine Zugmenge wirkt genau einmal');
{
  const welt = welt9();
  const g = lauf(welt);
  const L = g.M.fbV9LebenBereit(0);
  const menge = [gueltig(0, 4, 0, 0), raus(1, 'NO_REVEAL'), nullzug(2, 'pass')];
  t('der erste Aufruf wirkt', g.M.fbV9ApplyAccepted(L, menge) === true);
  const spur1 = welt.spur.join(','), starts1 = welt.starts.length;
  t('der zweite wird abgewiesen', g.M.fbV9ApplyAccepted(L, menge) === false);
  t('und dritte auch', g.M.fbV9ApplyAccepted(L, menge) === false);
  t('nichts ist zweimal geschehen',
    welt.spur.join(',') === spur1 && welt.starts.length === starts1,
    welt.spur.join(','));
  t('niemand ist zweimal ausgeschieden',
    welt.spur.filter(x => x === 'raus:1').length === 1);
  t('die Rundennummer hat sich nicht bewegt', welt.turnNo === 0);
  g.M.fbV9LebenStop();
}

// ══ FAIL CLOSED ══════════════════════════════════════════════════════════════
abschnitt('Im Zweifel geschieht nichts');
{
  const bau = () => { const welt = welt9(); const g = lauf(welt);
                      return { welt, g, L: g.M.fbV9LebenBereit(0) }; };
  const schlecht = [
    ['kein Feld', null],
    ['keine Liste', { 0: gueltig(0, 1, 0, 0) }],
    ['zu kurz', [gueltig(0, 1, 0, 0), nullzug(1, 'pass')]],
    ['zu lang', [gueltig(0, 1, 0, 0), nullzug(1, 'pass'), nullzug(2, 'pass'), nullzug(3, 'pass')]],
    ['Sitz verrutscht', [gueltig(0, 1, 0, 0), { seat: 2, kind: 'pass', status: 'VALID', move: null }, nullzug(2, 'pass')]],
    ['unbekannte Art', [gueltig(0, 1, 0, 0), { seat: 1, kind: 'quatsch', status: 'VALID', move: null }, nullzug(2, 'pass')]],
    ['unbekannter Status', [gueltig(0, 1, 0, 0), { seat: 1, kind: 'move', status: 'HUH', move: null }, nullzug(2, 'pass')]],
    ['Zug ohne Vektor', [gueltig(0, 1, 0, 0), { seat: 1, kind: 'move', status: 'VALID', move: null }, nullzug(2, 'pass')]],
    ['dx keine Zahl', [gueltig(0, 1, 0, 0), { seat: 1, kind: 'move', status: 'VALID', move: { idx: 1, dx: 'x', dy: 0, sp: 0 } }, nullzug(2, 'pass')]],
  ];
  for (const [name, menge] of schlecht) {
    const { welt, g, L } = bau();
    t(name + ': wird abgewiesen', g.M.fbV9ApplyAccepted(L, menge) === false);
    t(name + ': und nichts geschieht', welt.spur.length === 0 && welt.starts.length === 0,
      welt.spur.join(','));
    g.M.fbV9LebenStop();
  }
  {
    // DER WICHTIGSTE: ein fremder Index darf nie eine fremde Kugel starten.
    const { welt, g, L } = bau();
    const menge = [gueltig(0, 1, 0, 0),
                   { seat: 1, kind: 'move', status: 'VALID', move: { idx: 0, dx: 9, dy: 0, sp: 0 } },
                   nullzug(2, 'pass')];
    t('ein fremder Index wird abgewiesen', g.M.fbV9ApplyAccepted(L, menge) === false);
    t('und es wird gar nichts gestartet', welt.starts.length === 0);
    g.M.fbV9LebenStop();
  }
  {
    // Veraltete Runde.
    const welt = welt9();
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    welt.turnNo = 5; g.M.sync();
    t('eine veraltete Runde wird abgewiesen',
      g.M.fbV9ApplyAccepted(L, [gueltig(0, 1, 0, 0), gueltig(1, 1, 0, 0), nullzug(2, 'pass')]) === false);
    t('und nichts geschieht', welt.starts.length === 0);
    g.M.fbV9LebenStop();
  }
  {
    // Veralteter Raum bzw. Generation.
    const welt = welt9();
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    welt.gen = 8; g.M.sync();
    t('eine fremde Generation wird abgewiesen',
      g.M.fbV9ApplyAccepted(L, [gueltig(0, 1, 0, 0), gueltig(1, 1, 0, 0), nullzug(2, 'pass')]) === false);
    g.M.fbV9LebenStop();
  }
  {
    // Angehaltener Lebenslauf.
    const welt = welt9();
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    g.M.fbV9LebenStop();
    t('ein angehaltener Lebenslauf wendet nichts an',
      g.M.fbV9ApplyAccepted(L, [gueltig(0, 1, 0, 0), gueltig(1, 1, 0, 0), nullzug(2, 'pass')]) === false);
    t('und nichts geschieht', welt.starts.length === 0);
  }
}

// ══ V8 BLEIBT AUSSEN VOR ═════════════════════════════════════════════════════
abschnitt('Der freigegebene v8-Weg ruft die Bruecke nie');
{
  const welt = welt9({ ONLINE_PROTOCOL_VERSION: 8 });
  const g = lauf(welt);
  t('in einem v8-Raum entsteht kein Lebenslauf', g.M.fbV9LebenNeueRunde() === null);
  t('und die Bruecke weist ab',
    g.M.fbV9ApplyAccepted(g.L, [gueltig(0, 1, 0, 0), gueltig(1, 1, 0, 0), nullzug(2, 'pass')]) === false);
  t('nichts geschieht', welt.spur.length === 0 && welt.starts.length === 0);
}

// ══ GLEICHZEITIGE AUSSCHLUESSE ═══════════════════════════════════════════════
abschnitt('Mehrere Ausschluesse derselben Runde sind gleichzeitig');
{
  // DIE FRAGE: die Bruecke arbeitet die Ausschluesse in kanonischer Sitzreihenfolge
  // ab, und die bestehende Eliminierung beendet das Match, sobald hoechstens einer
  // uebrig ist. Kann die REIHENFOLGE damit den Sieger bestimmen?
  //
  // NEIN - und der Grund steht im Quelltext: footballElimEliminate hat keinen Riegel
  // auf phase 'over', jeder Aufruf wird also ausgefuehrt, und jeder bestimmt die
  // verbleibende Menge NEU. Der letzte Aufruf des Stapels entscheidet damit aus dem
  // ENDzustand. Welche Sitze im Stapel liegen, haengt nicht von der Reihenfolge ab -
  // also auch das Ergebnis nicht.
  const spielen = (cap, menge) => {
    const welt = welt9({ cap: cap, aktiv: Array(cap).fill(true) });
    const g = lauf(welt);
    const L = g.M.fbV9LebenBereit(0);
    const ok = g.M.fbV9ApplyAccepted(L, menge);
    const s = g.M.sicht();
    g.M.fbV9LebenStop();
    return { ok, welt, phase: s.phase, sieger: s.footballWinner,
             aktiv: welt.aktiv.slice(), starts: welt.starts.length,
             spur: welt.spur.join(',') };
  };
  const NR = 'NO_REVEAL', HM = 'HASH_MISMATCH', MF = 'MALFORMED';

  // 1/2: die letzten zwei, beide schuldig - in beiden Statusvarianten.
  {
    const a = spielen(2, [raus(0, NR), raus(1, HM)]);
    const b = spielen(2, [raus(0, HM), raus(1, NR)]);
    t('beide letzten scheiden aus', a.aktiv.join(',') === 'false,false', a.aktiv.join(','));
    t('es gibt keinen Sieger', a.sieger === null, a.sieger);
    t('das Match ist beendet', a.phase === 'over', a.phase);
    t('und nichts wird gestartet', a.starts === 0, a.starts);
    t('die Statusvariante aendert daran nichts',
      b.sieger === a.sieger && b.phase === a.phase && b.starts === a.starts,
      b.sieger + '/' + b.phase + '/' + b.starts);
    // DIE EIGENSCHAFT, um die es hier geht: es faellt UEBERHAUPT KEINE
    // Zwischenentscheidung. Frueher sah der erste Ausschluss noch einen Verbliebenen,
    // rief footballMatchEnd() und damit gameOver() - und das spielt SFX.win(). Der
    // zweite Ausschluss korrigierte Zustand und Anzeige vollstaendig, aber der
    // Siegerklang war hoerbar und nicht zuruecknehmbar.
    t('es faellt KEINE Zwischenentscheidung mit Sieger',
      a.spur.indexOf('Sieger 0') < 0 && a.spur.indexOf('Sieger 1') < 0, a.spur);
    t('und damit kein Siegerklang fuer einen Sieger, den es nie gab',
      a.spur.indexOf('SIEGERKLANG') < 0, a.spur);
    t('der erste Ausschluss aendert nur den Zustand',
      a.spur.indexOf('stapel:0') >= 0, a.spur);
    t('genau eine Entscheidung faellt - am Ende des Stapels',
      (a.spur.match(/ohne Sieger|SIEGERKLANG/g) || []).length === 1, a.spur);
    t('dasselbe bei getauschten Statusarten',
      b.spur.indexOf('SIEGERKLANG') < 0 &&
      (b.spur.match(/ohne Sieger/g) || []).length === 1, b.spur);
  }

  // 3: drei Sitze, die beiden ersten schuldig - der dritte gewinnt.
  {
    const g = spielen(3, [raus(0, NR), raus(1, HM), gueltig(2, 5, 0, 0)]);
    t('der einzige Verbliebene gewinnt', g.sieger === 2, g.sieger);
    t('und startet NICHT mehr - das Match ist entschieden', g.starts === 0, g.starts);
    t('die beiden anderen sind draussen', g.aktiv.join(',') === 'false,false,true');
  }
  // 4: derselbe Fall, nur liegt der Ueberlebende VORNE.
  {
    const g = spielen(3, [gueltig(0, 5, 0, 0), raus(1, HM), raus(2, MF)]);
    t('auch der vordere Sitz gewinnt', g.sieger === 0, g.sieger);
    t('ohne Abschuss', g.starts === 0, g.starts);
  }
  // 5: alle schuldig.
  {
    const g = spielen(3, [raus(0, NR), raus(1, HM), raus(2, MF)]);
    t('scheiden alle aus, gibt es keinen Sieger', g.sieger === null, g.sieger);
    t('das Match endet', g.phase === 'over');
    t('und niemand startet', g.starts === 0);
  }
  // 6: das Ergebnis haengt nur daran, WER schuldig ist - nicht WORAN.
  {
    const paare = [[NR, HM], [HM, NR], [NR, MF], [MF, NR], [HM, MF], [MF, HM],
                   [NR, NR], [HM, HM], [MF, MF]];
    const ergebnisse = paare.map(p =>
      JSON.stringify(spielen(3, [raus(0, p[0]), raus(1, p[1]), gueltig(2, 1, 0, 0)])
        .sieger));
    t('neun Statuskombinationen, ein Ergebnis',
      new Set(ergebnisse).size === 1 && ergebnisse[0] === '2', ergebnisse.join('|'));
  }
  // 7/8: KEINE Bevorzugung durch die Sitzreihenfolge. Dieselben schuldigen Sitze,
  //      verschieden ueber die Menge verteilt - dasselbe Endergebnis.
  {
    const varianten = [
      [raus(0, NR), raus(1, HM), gueltig(2, 1, 0, 0), gueltig(3, 1, 0, 0)],
      [raus(0, HM), raus(1, NR), gueltig(2, 1, 0, 0), gueltig(3, 1, 0, 0)],
      [gueltig(0, 1, 0, 0), raus(1, NR), raus(2, HM), gueltig(3, 1, 0, 0)],
      [gueltig(0, 1, 0, 0), gueltig(1, 1, 0, 0), raus(2, NR), raus(3, HM)]];
    const erg = varianten.map(m => spielen(4, m));
    t('bei vier Sitzen und zwei Ausschluessen bleiben immer zwei uebrig',
      erg.every(e => e.aktiv.filter(Boolean).length === 2),
      erg.map(e => e.aktiv.filter(Boolean).length).join(','));
    t('es gibt in keiner Variante einen Sieger',
      erg.every(e => e.sieger === null), erg.map(e => e.sieger).join(','));
    t('und in jeder wird genau einmal gestartet',
      erg.every(e => e.starts === 1), erg.map(e => e.starts).join(','));
    t('kein Sitz gewinnt dadurch, dass er spaeter drankam',
      new Set(erg.map(e => e.sieger + '/' + e.phase)).size === 1);
  }
  {
    // Und der Gegenbeweis zur Reihenfolge: bleiben zwei uebrig, laeuft das Spiel
    // weiter - unabhaengig davon, ob die Schuldigen vorne oder hinten lagen.
    const vorne = spielen(4, [raus(0, NR), raus(1, NR), gueltig(2, 1, 0, 0), gueltig(3, 2, 0, 0)]);
    const hinten = spielen(4, [gueltig(0, 1, 0, 0), gueltig(1, 2, 0, 0), raus(2, NR), raus(3, NR)]);
    t('vorne wie hinten wird gestartet', vorne.starts === 1 && hinten.starts === 1);
    t('und in beiden Faellen ohne Sieger', vorne.sieger === null && hinten.sieger === null);
  }
}
// ══ WAECHTER AM QUELLTEXT ════════════════════════════════════════════════════
abschnitt('Waechter');
{
  // AUSDRUECKLICH nur die Bruecke: die beiden Spielhaken dahinter gehoeren zur
  // Spielanbindung und haben ihre Waechter in tools/test_online_v9_lifecycle.js.
  // AUSDRUECKLICH nur die Bruecke: dahinter liegen die Rehydrierung und die beiden
  // Spielhaken, und beide haben ihre eigenen Waechter.
  const roh = HTML.slice(HTML.indexOf('// ── DIE SPIELBRUECKE'),
                         HTML.indexOf('// ── V9-REHYDRIERUNG'));
  const bruecke = roh.split(/\r?\n/).filter(z => !/^\s*\/\//.test(z)).join('\n');
  t('das Protokoll des Produkts steht weiterhin auf 8',
    /const ONLINE_PROTOCOL_VERSION=8;/.test(HTML));
  t('die Bruecke rechnet keinen Hash nach',
    bruecke.indexOf('fbV9Hash') < 0 && bruecke.indexOf('crypto') < 0 &&
    bruecke.indexOf('subtle') < 0);
  t('sie liest und schreibt kein Firebase',
    bruecke.indexOf('window.FB') < 0 && bruecke.indexOf('fbV9Net') < 0);
  // Die Rehydrierung liest EINMAL - das ist ihr Zweck - und schreibt nie.
  const rehy = HTML.slice(HTML.indexOf('// ── V9-REHYDRIERUNG'),
                          HTML.indexOf('// ── DIE BEIDEN HAKEN AUS DEM SPIEL'));
  t('die Rehydrierung liest genau einmal und schreibt nie',
    (rehy.match(/window\.FB\.get\(/g) || []).length === 1 &&
    rehy.indexOf('runTransaction') < 0 && rehy.indexOf('fbV9NetWrite') < 0 &&
    rehy.indexOf('fbV9NetOpen') < 0);
  t('sie benutzt den BESTEHENDEN Abschussweg',
    bruecke.indexOf('beginReveal();') > 0 && bruecke.indexOf('applyLaunch();') > 0);
  t('und baut keinen eigenen',
    bruecke.indexOf('LAUNCH') < 0 && bruecke.indexOf('.vx=') < 0 && bruecke.indexOf('.vy=') < 0);
  t('sie benutzt die BESTEHENDE Eliminierung',
    bruecke.indexOf('footballElimEliminate(i,i!==entscheider)') > 0);
  t('und laesst nur den LETZTEN wirksamen Ausschluss entscheiden',
    bruecke.indexOf('wirksam[wirksam.length-1]') > 0 &&
    bruecke.indexOf('stapel.filter(i=>fbElimActive[i])') > 0);
  t('und zieht kein Leben ab', bruecke.indexOf('fbElimLives') < 0 &&
    bruecke.indexOf('footballElimConcede') < 0);
  t('sie erhoeht keine Rundennummer',
    bruecke.indexOf('turnNo++') < 0 && bruecke.indexOf('turnNo=') < 0);
  t('und startet keine naechste Bereitschaft',
    bruecke.indexOf('fbV9ReadyStart') < 0 && bruecke.indexOf('fbV9LebenBereit') < 0);
  t('applyLaunch selbst ist unveraendert',
    (HTML.match(/function applyLaunch\([^)]*\)\{[\s\S]*?\n\}/) || [''])[0].indexOf('fbV9') < 0);
  // fastForwardMatch traegt seit V9.4D2 zwei Eingaenge. Der v8-Zweig ist unveraendert -
  // dieselbe Zughistorie, dieselben Aufrufe -, der v9-Zweig kommt additiv daneben und
  // wird nur mit einer fertigen Zugmengenliste betreten.
  const ff = HTML.match(/function fastForwardMatch\([^)]*\)\{[\s\S]*?\n\}/);
  t('fastForwardMatch liest im v8-Zweig weiterhin die t-Historie',
    ff && ff[0].indexOf('turns[turnNo]') > 0 && ff[0].indexOf('processSlot(s,slots[s])') > 0 &&
    ff[0].indexOf('allAliveCommitted()') > 0);
  t('und der v9-Zweig benutzt AUSSCHLIESSLICH die gemeinsame Wirkung',
    ff && ff[0].indexOf('fbV9Wirken(menge,np())') > 0 &&
    (ff[0].match(/fbV9[A-Za-z]*/g) || []).join(',') === 'fbV9Wirken');
  t('die v9-Rehydrierung ist vorhanden und ruhend',
    /async function fbV9Rehydrieren\(ctx\)\{/.test(HTML));
  t('genau EINE Stelle im Produkt wendet eine Zugmenge an',
    (HTML.match(/function fbV9ApplyAccepted/g) || []).length === 1);
  // Zweimal im Quelltext: die Definition und die EINE Verdrahtung im Lebenslauf.
  // Drei Treffer: die Definition und die ZWEI Verdrahtungen - der gewoehnliche Weg
  // ueber die Bereitschaft und der Weg nach einer Rehydrierung in eine offene Runde.
  t('sie wird genau in den beiden Lebenslauf-Einstiegen verdrahtet',
    (HTML.match(/fbV9ApplyAccepted\(L,/g) || []).length === 3,
    (HTML.match(/fbV9ApplyAccepted\(L,/g) || []).length);
  // DIE DREI EIGENSCHAFTEN, auf denen die Gleichzeitigkeit beruht - im ECHTEN
  // Quelltext, nicht in der Attrappe.
  const elim = (HTML.match(/function footballElimEliminate\([^)]*\)\{[\s\S]*?\n\}/) || [''])[0];
  // Der Stapelmodus ist AUSSCHLIESSLICH additiv: ohne zweites Argument bleibt jeder
  // bestehende Aufrufer beim heutigen Verhalten.
  t('die Eliminierung kennt einen Stapelmodus',
    /function footballElimEliminate\(o,stapel\)\{/.test(HTML));
  t('er aendert im Stapel NUR den Zustand',
    /if\(stapel\)\{ updateHud\(\); return; \}/.test(elim));
  t('und alle bestehenden Aufrufer geben ihn nicht mit',
    (HTML.match(/footballElimEliminate\(o\);/g) || []).length === 2,
    (HTML.match(/footballElimEliminate\(o\);/g) || []).length);
  // Zwei Treffer, und beide gehoeren dazu: die Definition und der EINE Aufruf aus der
  // Bruecke. Sonst nennt niemand im Produkt ein zweites Argument.
  t('genau eine Stelle im Produkt benutzt den Stapelmodus',
    (HTML.match(/footballElimEliminate\([^)]*,[^)]*\)/g) || []).length === 2 &&
    (HTML.match(/function footballElimEliminate\(o,stapel\)/g) || []).length === 1,
    (HTML.match(/footballElimEliminate\([^)]*,[^)]*\)/g) || []).join(' | '));
  t('die echte Eliminierung ist je Sitz idempotent',
    elim.indexOf('!fbElimActive[o])return;') > 0);
  t('sie hat KEINEN Riegel auf phase over - jeder Aufruf des Stapels wird ausgefuehrt',
    !/phase===.over./.test(elim), 'Riegel gefunden');
  t('und sie bestimmt die verbleibende Menge bei JEDEM Aufruf neu',
    /const act=fbOn\?fbEligibleOwners\(\):fbElimActiveOwners\(\);/.test(elim));
  t('der siegerlose Ausgang ist im Onlineraum vorgesehen',
    /if\(act\.length===0&&fbOn\)/.test(elim));
  t('und genau ein Verbliebener gewinnt', /else if\(act\.length===1\)/.test(elim));
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('die Regeldatei traegt weiterhin die v9-Zweige',
    rules.indexOf("child('v').val() === 9") > 0);
}

console.log('\nOnline-V9-Spielbruecke: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})().catch(e => { console.log('ABBRUCH: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
