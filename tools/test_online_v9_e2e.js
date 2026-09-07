// V9.3B2C4: der vollstaendige V9-Ablauf gegen den ECHTEN lokalen Firebase-Emulator.
//
// MANUELL / EMULATORABHAENGIG - ausdruecklich NICHT Teil von tools/run_all_tests.js.
// Der Dauergate muss auf jeder Maschine ohne Aufbau gruen sein; dieser Beweis braucht
// eine Java-Laufzeit, einen laufenden Datenbank-Emulator und das npm-Paket `firebase`.
//
// WAS HIER BEWIESEN WIRD, und was keine Attrappe zeigen kann:
// Der ruhende V9-Quelltext aus index.html - Codec, Protokollmaschine, Netzadapter,
// Geheimnisspeicher und Ablaufsteuerung - treibt einen kompletten Zug durch die
// UNVERAENDERTEN firebase.rules.json. Jeder spielende Schreibvorgang laeuft als echter
// angemeldeter Nutzer durch die Regeln; Verwaltungsrechte gibt es nur beim Vorbefuellen,
// Lesen und Aufraeumen.
//
// Aufruf (Emulator muss laufen):
//   cd artifacts/v9-e2e && firebase emulators:start --only database --project ringout-87fbb
//   node tools/test_online_v9_e2e.js
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const HOST = '127.0.0.1', PORT = 9021, PROJEKT = 'ringout-87fbb';
const GLOBALE_GRENZE_MS = 180000;     // harte Obergrenze fuer den GESAMTEN Beweis
const WARTE_GRENZE_MS = 12000;        // harte Obergrenze je erwarteter Bedingung

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; console.log('  [ok  ] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n== ' + s + ' ' + '='.repeat(Math.max(0, 62 - s.length)));

// ── 1. NUR DER LOKALE EMULATOR ───────────────────────────────────────────────
// Die Produktionsdatenbank wird nicht nur gemieden, sondern ausgeschlossen: die
// Adresse wird geprueft, bevor irgendein SDK aufgebaut wird.
const DB_URL = 'http://' + HOST + ':' + PORT + '?ns=' + PROJEKT + '-default-rtdb';
// Die Projektkennung ist die echte - der Emulator laeuft aber ausschliesslich lokal.
// Geprueft wird deshalb die ADRESSE: alles, was nicht auf 127.0.0.1 zeigt, ist ein
// sofortiger Abbruch, und `firebaseio.com` (die Produktionsdomaene) erst recht.
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(DB_URL) || /firebaseio/.test(DB_URL)) {
  console.log('ABBRUCH: Datenbankadresse ist nicht lokal -> ' + DB_URL);
  process.exit(2);
}

let SDK;
try { SDK = { app: require('firebase/app'), db: require('firebase/database') }; }
catch (e) { console.log('SDK fehlt: npm install --no-save firebase'); process.exit(3); }
const { initializeApp } = SDK.app;
const { getDatabase, connectDatabaseEmulator, ref, onValue, get,
        runTransaction, serverTimestamp } = SDK.db;

// Der Emulator akzeptiert ein unsigniertes JWT; entscheidend ist allein die Nutzlast.
function token(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jetzt = Math.floor(Date.now() / 1000);
  return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
    sub: uid, user_id: uid, iat: jetzt, exp: jetzt + 3600,
    aud: PROJEKT, iss: 'https://securetoken.google.com/' + PROJEKT,
    firebase: { sign_in_provider: 'anonymous', identities: {} } }) + '.';
}
// Ein eigener Datenbankzugang je Identitaet - so schreibt jeder Sitz wirklich als er
// selbst, statt dass der Testlauf sich seine Berechtigungen selbst ausstellt.
const zugaenge = {};
function alsUid(uid) {
  if (zugaenge[uid]) return zugaenge[uid];
  const app = initializeApp({ projectId: PROJEKT, databaseURL: DB_URL }, 'app_' + uid);
  const d = getDatabase(app);
  connectDatabaseEmulator(d, HOST, PORT, { mockUserToken: token(uid) });
  zugaenge[uid] = d;
  return d;
}

// Verwaltungszugriff: NUR Vorbefuellen, Lesen und Aufraeumen. Kein einziger der
// bewiesenen Protokollschritte laeuft hierueber.
const REST = 'http://' + HOST + ':' + PORT, NS = PROJEKT + '-default-rtdb';
const ADMIN = { Authorization: 'Bearer owner' };
async function seed(pfad, wert) {
  const r = await fetch(REST + '/' + pfad + '.json?ns=' + NS,
    { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ADMIN),
      body: JSON.stringify(wert) });
  if (!r.ok) throw new Error('Seeding fehlgeschlagen: ' + r.status);
}
const lies = async (pfad) => {
  const r = await fetch(REST + '/' + pfad + '.json?ns=' + NS, { headers: ADMIN });
  return JSON.parse((await r.text()) || 'null');
};

// ── 2. DIE EXAKTEN REGELN ────────────────────────────────────────────────────
const RULES_QUELLE = path.join(__dirname, '..', 'firebase.rules.json');
const RULES_KOPIE = path.join(__dirname, '..', 'artifacts', 'v9-e2e', 'rules-copy.json');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

// ── 4. DER ECHTE RUHENDE V9-QUELLTEXT AUS index.html ─────────────────────────
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-SPIELANBINDUNG ════');
if (START < 0 || ENDE < 0) { console.log('ABBRUCH: V9-Bereich nicht gefunden'); process.exit(5); }
const BEREICH = HTML.slice(START, ENDE);
// fastForwardMatch kommt WOERTLICH aus dem Produkt - die Rehydrierung laeuft durch es.
const FASTFF = (HTML.match(/function fastForwardMatch\([^)]*\)\{[\s\S]*?\n\}/) || [''])[0];
if (!FASTFF) { console.log('ABBRUCH: fastForwardMatch nicht gefunden'); process.exit(5); }

// Ein Sitzungsspeicher wie im Browser - eine einfache Karte, mehr braucht der echte
// Quelltext nicht. Die KARTE ueberlebt einen Neuladevorgang, die Laufzeit nicht.
function speicher(unterbau) {
  const m = unterbau || new Map();
  return { unterbau: m, get length() { return m.size; }, key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
// Buchfuehrung ueber alles, was dieser Lauf selbst geoeffnet oder angelegt hat. Ein
// Beweis, der fremde Reste mitzaehlt, beweist nichts - und einer, der seine eigenen
// nicht sieht, ebenso wenig.
let offeneHoerer = 0;
const alleLaufzeiten = [];
const eigeneRaeume = new Set();

// Eine Laufzeit = ein Tab. Eigene Modulinstanz, eigener Arbeitsspeicher, eigene Wecker.
// Das Zerstoeren einer Laufzeit ist damit genau das, was ein Neuladen tut.
function laufzeit(uid, unterbau) {
  const timer = new Set();
  const st = speicher(unterbau);
  // Jeder Zuhoerer wird mitgezaehlt, und das Abmelden ist mehrfach gefahrlos - so
  // laesst sich am Ende sagen, dass wirklich keiner mehr offen ist.
  let eigene = 0;
  const zaehlendesOnValue = (r, cb) => {
    offeneHoerer++; eigene++;
    const ab = onValue(r, cb);
    let zu = false;
    return () => { if (zu) return; zu = true; offeneHoerer--; eigene--; ab(); };
  };
  const setT = (fn, ms) => { const id = setTimeout(() => { timer.delete(id); fn(); }, ms);
                             timer.add(id); return id; };
  const clrT = (id) => { timer.delete(id); clearTimeout(id); };
  // Die Spielwelt als Attrappe - genau so viel, wie der ruhende Bereich beruehrt.
  // Physik und Bild sind ersetzt, das PROTOKOLL nicht: Bereitschaft, Ablaufsteuerung,
  // Bruecke und Rehydrierung sind der echte Quelltext.
  const welt = { cap: 3, uid: uid, seat: 0, spur: [], starts: [], status: [],
                 aktiv: [true, true, true], leben: [2, 2, 2], evicted: {},
                 online: true, mode: 'football', roomCode: '', myPlayer: 0, gen: 0,
                 turnNo: -1, phase: 'aim', footballWinner: null, onlineSessionId: 1,
                 ONLINE_PROTOCOL_VERSION: 9 };
  const GLOBAL = ['online', 'mode', 'roomCode', 'myPlayer', 'gen', 'turnNo', 'phase',
                  'footballWinner', 'onlineSessionId', 'ONLINE_PROTOCOL_VERSION'];
  const M = new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
      'FB_ONLINE_BALL_IDX', 'serverNow', 'setTimeout', 'clearTimeout', 'sessionStorage',
      'welt', `
    let ${GLOBAL.join(', ')};
    function sync(){ ${GLOBAL.map(n => n + ' = welt.' + n + ';').join(' ')} }
    sync();
    function fbElim4(){ return true; }
    function fbElimPlayers(){ return welt.cap; }
    function fbUid(){ return welt.uid; }
    function fbEvicted(s){ return !!welt.evicted[s]; }
    function setStatus(x){ welt.status.push(String(x)); }
    let balls = [], commitIdx = [], commitAim = [], commitSpin = [], aimSet = [];
    let soundOn = true, particles = [], fx3 = [], turnUnsub = null;
    let fbElimActive = welt.aktiv, fbElimLives = welt.leben;
    const FF_MAX_STEPS_PER_TURN = 20000;
    function np(){ return welt.cap; }
    function resetCommits(){ aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
      for(let p=0;p<np();p++){aimSet.push(false);commitIdx.push(-1);
                              commitAim.push({dx:0,dy:0});commitSpin.push(0);} }
    function setPhase(p){ phase=p; }
    function setPhaseText(){}
    function updateHud(){}
    function processSlot(){ welt.spur.push('v8:processSlot'); }
    function allAliveCommitted(){ return true; }
    function afterResult(){}
    function fbFxSilence(v){ const a=welt.stumm; welt.stumm=!!v; return a; }
    function fbMusicSync(){}
    function footballClearGoalFx(){}
    function beginReveal(){ welt.spur.push('beginReveal'); phase='reveal'; }
    function applyLaunch(){
      welt.spur.push(soundOn ? 'KLANG' : 'applyLaunch');
      const stapel=[];
      for(let i=0;i<np();i++){
        if(!aimSet[i]||!balls[commitIdx[i]]||!balls[commitIdx[i]].alive)continue;
        const b=balls[commitIdx[i]];
        b.x+=commitAim[i].dx; b.y+=commitAim[i].dy; b.spin=commitSpin[i];
        stapel.push({seat:i,idx:commitIdx[i],dx:commitAim[i].dx,dy:commitAim[i].dy,
                     sp:commitSpin[i]});
      }
      phase='sim'; welt.starts.push(stapel); }
    function stepSim(){
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
                                  welt.spur.push('SIEGER:'+uebrig[0]); } }
    ${FASTFF}
    ${BEREICH}
    return { sync, fbV9Start, fbV9Resume, fbV9Action, fbV9SecretFor, fbV9SecretClear,
             fbV9SecretLoad, fbV9SecretDrop, fbV9MakeCommit, fbV9MakeReveal, fbV9Hash,
             fbV9Hex, fbV9SaltFromHex, fbV9AcceptedSet, fbV9CommitsComplete,
             fbV9ResultsComplete, fbV9NetOpenTurn, fbV9NetWriteCommit, fbV9NetOpenReveal,
             fbV9NetWriteReveal, fbV9NetWriteLate, fbV9NetWriteNoReveal, fbV9EngineCtx,
             fbV9NetOpenStart, fbV9NetMarkComplete, fbV9NetWriteReady,
             fbV9NetWriteReadyTimeout, fbV9NetWriteDisqualify, fbV9NetWriteRemove,
             fbV9ReadyStart, fbV9ReadyLocal, fbV9ReadyStop, fbV9ReadyComplete,
             fbV9LebenNeueRunde, fbV9LebenFortsetzen, fbV9LebenHandeln, fbV9LebenStop,
             fbV9RaumStart, fbV9RaumIst9, fbV9Rehydrieren, fbV9RehydrierPlan,
             fbV9Wirken, fbV9AcceptedOk, leben: () => fbV9Leben,
             zustand: () => ({ turnNo, phase, footballWinner,
                               aktiv: welt.aktiv.slice(), leben: welt.leben.slice(),
                               balls: balls.map(b => ({ owner: b.owner, alive: b.alive,
                                 x: b.x, y: b.y, vx: b.vx, vy: b.vy, spin: b.spin })) }),
             FB_V9_COMMITTED, FB_V9_EXISTS, FB_V9_DENIED, FB_V9_INVALID, FB_V9_ERROR,
             FB_V9_VALID, FB_V9_NO_REVEAL, FB_V9_MISMATCH, FB_V9_OK, FB_V9_COMPLETE,
             FB_V9_FAILED, FB_V9_WAIT_COMMITS, FB_V9_WAIT_RESULTS,
             FB_V9_R_COMPLETE, FB_V9_R_BARRIER };
  `)({ FB: { db: alsUid(uid), ref, runTransaction, onValue: zaehlendesOnValue,
             serverTimestamp, get } },
     globalThis.crypto, 10000, 5, 5, () => Date.now(), setT, clrT, st, welt);
  M.fbV9SecretClear();
  const r = { uid: uid, M: M, st: st, timer: timer, welt: welt,
              offen: () => timer.size, hoerer: () => eigene };
  alleLaufzeiten.push(r);
  return r;
}

// ZWEITE ABSICHERUNG des Aufraeumens: `stop()` schneidet jede kuenftige Wirkung ab,
// bricht aber keinen Schreibvorgang ab, der bereits beim Server liegt. Wird das
// Fixture direkt danach geloescht, kann eine noch fliegende Transaktion den Raum
// teilweise NEU anlegen - `rooms/$code` erlaubt das Anlegen eines nicht vorhandenen
// Raums ausdruecklich. Deshalb wird gewartet, bis der Lauf beendet ist UND nichts
// mehr unterwegs ist; die Merker dafuer fuehrt die Ablaufsteuerung ohnehin.
// (Der beobachtete Fehlschlag hatte eine einfachere Ursache: die Schlusszusicherung
// prueft jetzt ausschliesslich Raeume, die DIESER Lauf selbst angelegt hat.)
// Bewusst NICHT dabei: finaleLaeuft und roVersucht. Das sind Einmal-Waechter gegen
// doppelte Ausfuehrung, keine Merker fuer einen laufenden Schreibvorgang - sie bleiben
// nach dem Abschluss gesetzt und wuerden hier ewig `unterwegs` melden.
const inFlug = (l) => !!(l.beschaeftigt || l.commitLaeuft || l.revealLaeuft ||
  ['commits', 'results'].some(a => l.wecker[a] && (l.wecker[a].laeuft || l.wecker[a].timer !== null)));

// Ein Szenario sauber beenden: anhalten, auslaufen lassen, Zuhoerer und Wecker
// pruefen, Fixture loeschen und die Loeschung bestaetigen. Ohne Schlafbefehle.
async function beenden(code, laeufe, laufzeiten) {
  for (const l of laeufe) l.stop();
  await Promise.all(laeufe.map(l => l.fertig));
  await warteAuf(code + ': kein Schreibvorgang mehr unterwegs', () => laeufe.every(l => !inFlug(l)));
  for (const r of (laufzeiten || [])) {
    t(code + ': keine Wecker offen', r.offen() === 0, r.offen());
    t(code + ': keine Zuhoerer offen', r.hoerer() === 0, r.hoerer());
  }
  await entferne(code);
}
// Ein Fixture loeschen und die Loeschung BESTAETIGEN - nicht nur anstossen.
async function entferne(code) {
  await raeumen(code);
  await warteAuf(code + ': Fixture ist geloescht',
    async () => (await lies('rooms/' + code)) === null);
  eigeneRaeume.delete(code);
  t(code + ': Fixture entfernt und als null bestaetigt', true);
}

const UID = [0, 1, 2].map(i => 'UID_E2E' + i + '_XXXXXXXXXXXXXXXX');
const warte = (ms) => new Promise(r => setTimeout(r, ms));
// Jede Erwartung hat eine harte Grenze - kein Lauf darf haengenbleiben.
async function warteAuf(label, pred, ms) {
  const bis = Date.now() + (ms || WARTE_GRENZE_MS);
  for (;;) {
    if (await pred()) return true;
    if (Date.now() > bis) throw new Error('ZEITUEBERSCHREITUNG bei: ' + label);
    await warte(120);
  }
}
async function raum(code, cap, opt) {
  if (!/^[A-HJKMNP-Z2-9]{4}$/.test(code)) throw new Error('Raumcode ausserhalb des Alphabets: ' + code);
  eigeneRaeume.add(code);
  if (ANGELEGT.indexOf(code) < 0) ANGELEGT.push(code);
  const p = {}, players = {};
  // `offline` nennt Sitze, deren Praesenz auf false steht - und zwar lange genug,
  // dass ein Mitspieler sie nach den Regeln austragen darf (fuenfzehn Sekunden).
  const weg = (opt && opt.offline) || [];
  for (let i = 0; i < cap; i++) {
    const ab = weg.indexOf(i) >= 0;
    p[i] = { s: 'E2ETAB' + i, on: !ab, t: ab ? Date.now() - 20000 : Date.now() };
    players[i] = { id: 'E2EPID' + i, name: 'P' + i, tab: 'E2ETAB' + i, uid: UID[i] };
  }
  // SEIT V9.4B1 haengt d/<turn> zusaetzlich am Generationsstart s und an einer
  // vollstaendigen Bereitschaftsbarriere q. Szenarien, die einen SPAETEREN Abschnitt
  // pruefen, bekommen beides als Fixture vorbefuellt - genau wie Raum und Sitze, und
  // ueber denselben Verwaltungsweg. Der Bereitschaftsablauf selbst wird in seinem
  // eigenen Szenario mit dem ECHTEN Client bewiesen.
  const g0 = {};
  if (!opt || opt.bereit !== false) {
    g0.s = { ts: Date.now() - 30000 };
    const q0 = {};
    for (let i = 0; i < cap; i++) q0[i] = { k: 'ready', n: 0, ts: Date.now() - 20000 };
    g0.q = { 0: q0 };
  }
  if (opt && opt.g) Object.assign(g0, opt.g);
  await seed('rooms/' + code, {
    v: 9, hostUid: UID[0],
    config: { game: 'football', winTarget: 3, fmt: 'elimination',
              visibility: 'private', mode: 'lives', cap: cap },
    gen: 0, state: 'playing', seats: cap, p: p, players: players,
    created: Date.now() - 60000, g: { 0: g0 } });
}
const raeumen = (code) => seed('rooms/' + code, null);
// cap ist ausdruecklich ein Argument: die Szenarien fahren zwei UND drei Sitze.
const ctx = (code, seat, cap) => ({ v: 9, code: code, gen: 0, turn: 0, seat: seat,
                                    cap: cap === undefined ? 2 : cap,
                               uid: UID[seat], seatUid: UID[seat] });
const ZUG = [{ idx: 0, dx: 12.5, dy: -8.25, sp: 0.5 }, { idx: 1, dx: -3.75, dy: 6.5, sp: 0.875 }];
const KEY = (code, seat) => 'ro9:1:' + code + ':0:0:' + seat;

const notbremse = setTimeout(() => {
  console.log('\nGLOBALE ZEITUEBERSCHREITUNG nach ' + (GLOBALE_GRENZE_MS / 1000) + ' s - Abbruch.');
  process.exit(4);
}, GLOBALE_GRENZE_MS);

const T0 = Date.now();
const ANGELEGT = [];      // jeder Raumcode, den dieser Lauf je angelegt hat
const laufende = [];      // Notbremse: alles, was im Abbruchfall gestoppt werden muss
const spur = (l) => { laufende.push(l); return l; };

(async () => {
console.log('=== V9.3B2C4: kompletter V9-Ablauf gegen den lokalen Emulator ===');

// ══ VORAUSSETZUNGEN ════════════════════════════════════════════════════════════
abschnitt('Voraussetzungen: lokal, unveraenderte Regeln');
{
  t('die Datenbankadresse ist lokal (' + DB_URL + ')',
    DB_URL.indexOf('127.0.0.1') > 0 && DB_URL.indexOf('firebaseio') < 0);
  t('die Adresse zeigt nirgends auf die Produktionsdomaene',
    DB_URL.indexOf('firebaseio') < 0 && DB_URL.indexOf('https') < 0);
  const a = md5(RULES_QUELLE), b = md5(RULES_KOPIE);
  t('die Regelkopie ist byte-identisch mit der verfolgten firebase.rules.json (' + a + ')',
    a === b && Buffer.compare(fs.readFileSync(RULES_QUELLE), fs.readFileSync(RULES_KOPIE)) === 0,
    a + ' / ' + b);
  const probe = await lies('.info');   // erreichbar?
  t('der Emulator antwortet', probe !== undefined);
  // ENTSCHEIDEND: nicht die Kopie auf der Platte zaehlt, sondern was der laufende
  // Emulator wirklich geladen hat. Er gibt seine aktiven Regeln selbst heraus.
  const aktivRoh = await (await fetch(REST + '/.settings/rules.json?ns=' + NS,
                                      { headers: ADMIN })).text();
  const norm = (x) => x.replace(/\r\n/g, '\n').trim();
  t('die AKTIVEN Regeln des Emulators sind die verfolgte firebase.rules.json',
    norm(aktivRoh) === norm(fs.readFileSync(RULES_QUELLE, 'utf8')),
    norm(aktivRoh).length + ' vs ' + norm(fs.readFileSync(RULES_QUELLE, 'utf8')).length);
}

// ══ SZENARIO A ═════════════════════════════════════════════════════════════════
abschnitt('A - normaler Ablauf: Zug gegen Zug');
{
  const code = 'EEAA';
  await raum(code, 2);
  const A = spur(laufzeit(UID[0])), B = spur(laufzeit(UID[1]));
  const lA = A.M.fbV9Start(ctx(code, 0), { move: ZUG[0] });
  const lB = B.M.fbV9Start(ctx(code, 1), { move: ZUG[1] });
  laufende.push({ stop: () => { lA.stop(); lB.stop(); } });

  await warteAuf('beide Laeufe erreichen COMPLETE',
    () => lA.stufe === A.M.FB_V9_COMPLETE && lB.stufe === B.M.FB_V9_COMPLETE);
  t('Sitz 0 ist fertig', lA.stufe === A.M.FB_V9_COMPLETE, lA.stufe + ' ' + (lA.grund || ''));
  t('Sitz 1 ist fertig', lB.stufe === B.M.FB_V9_COMPLETE, lB.stufe + ' ' + (lB.grund || ''));

  const d = await lies('rooms/' + code + '/g/0/d/0');
  t('der Rundenbeginn steht mit aufgeloester Serverzeit',
    d && d.n === 0 && typeof d.o === 'number' && JSON.stringify(d).indexOf('.sv') < 0,
    JSON.stringify(d));
  const ro = await lies('rooms/' + code + '/g/0/ro/0');
  t('der Enthuellungsanker steht als blosse Serverzeit', typeof ro === 'number', ro);

  // 12/13: beide Hashes pruefen, Menge deterministisch und sitzsortiert
  const menge = lA.menge;
  t('die Zugmenge hat genau zwei Eintraege', menge && menge.length === 2, menge && menge.length);
  t('sie ist nach Sitz sortiert', menge[0].seat === 0 && menge[1].seat === 1);
  t('Sitz 0: VALID', menge[0].status === A.M.FB_V9_VALID, menge[0].status);
  t('Sitz 1: VALID', menge[1].status === A.M.FB_V9_VALID, menge[1].status);
  t('und traegt genau die abgeschickten Vektoren',
    menge[0].move.dx === 12.5 && menge[0].move.dy === -8.25 && menge[0].move.sp === 0.5 &&
    menge[1].move.dx === -3.75 && menge[1].move.dy === 6.5 && menge[1].move.sp === 0.875,
    JSON.stringify(menge.map(m => m.move)));
  t('beide Laeufe kommen unabhaengig zur selben Menge',
    JSON.stringify(lA.menge) === JSON.stringify(lB.menge));

  // ── 12. KEIN KLARTEXT IM COMMIT ────────────────────────────────────────────
  const c = await lies('rooms/' + code + '/g/0/c/0');
  for (const s of [0, 1]) {
    const keys = Object.keys(c[s]).sort().join(',');
    t('c/0/' + s + ' traegt genau k,h,ts', keys === 'h,k,ts', keys);
  }
  const roh = JSON.stringify(c);
  t('im Commit-Zweig steht kein idx, dx, dy, sp oder Salz',
    !/"(idx|dx|dy|sp|n|salt)"/.test(roh), roh.slice(0, 200));
  t('und keine der abgeschickten Zahlen taucht dort auf',
    roh.indexOf('12.5') < 0 && roh.indexOf('-8.25') < 0 && roh.indexOf('0.875') < 0);

  // 14: beide Geheimnisse bei COMPLETE geraeumt
  t('Sitz 0: das Geheimnis ist aus dem Arbeitsspeicher',
    A.M.fbV9SecretFor(code, 0, 0) === null);
  t('Sitz 1: das Geheimnis ist aus dem Arbeitsspeicher',
    B.M.fbV9SecretFor(code, 0, 0) === null);
  t('Sitz 0: und aus dem Sitzungsspeicher', !A.st.unterbau.has(KEY(code, 0)), [...A.st.unterbau.keys()].join(','));
  t('Sitz 1: und aus dem Sitzungsspeicher', !B.st.unterbau.has(KEY(code, 1)), [...B.st.unterbau.keys()].join(','));

  // ── 13. WRITE-ONCE, durch die echten Regeln ────────────────────────────────
  const w1 = await A.M.fbV9NetOpenTurn(ctx(code, 0));
  t('ein zweiter Rundenbeginn ueberschreibt nichts', w1.status === A.M.FB_V9_EXISTS, w1.status);
  const w2 = await A.M.fbV9NetOpenReveal(ctx(code, 0));
  t('ein zweiter Enthuellungsanker ueberschreibt nichts', w2.status === A.M.FB_V9_EXISTS, w2.status);
  const w3 = await A.M.fbV9NetWriteCommit(ctx(code, 0), { k: 'pass' });
  t('ein zweites Terminal ueberschreibt nichts', w3.status === A.M.FB_V9_EXISTS, w3.status);
  const w4 = await A.M.fbV9NetWriteReveal(ctx(code, 0),
    { k: 'reveal', idx: 0, dx: 1, dy: 2, sp: 0.25, n: '0'.repeat(32) });
  t('ein zweites Ergebnis ueberschreibt nichts', w4.status === A.M.FB_V9_EXISTS, w4.status);
  const cNach = await lies('rooms/' + code + '/g/0/c/0/0');
  t('und der urspruengliche Commit steht unveraendert da',
    cNach.k === 'move' && cNach.h === c[0].h);

  // ── 12. FREMDE KENNUNG ─────────────────────────────────────────────────────
  // Sitz 0 versucht, in den Slot von Sitz 1 zu schreiben - die Regeln binden an
  // players/<seat>/uid, nicht an das Praesenztoken.
  const codeX = 'EEAX';
  await raum(codeX, 2);
  await A.M.fbV9NetOpenTurn(ctx(codeX, 0));
  const f1 = await A.M.fbV9NetWriteCommit(Object.assign(ctx(codeX, 0), { seat: 1 }),
                                          { k: 'move', h: 'ab12'.repeat(16) });
  t('eine fremde Kennung kann keinen fremden Zug schreiben', f1.status === A.M.FB_V9_DENIED, f1.status);
  await B.M.fbV9NetWriteCommit(ctx(codeX, 1), { k: 'move', h: 'cd34'.repeat(16) });
  await A.M.fbV9NetWriteCommit(ctx(codeX, 0), { k: 'pass' });
  await A.M.fbV9NetOpenReveal(ctx(codeX, 0));
  const f2 = await A.M.fbV9NetWriteReveal(Object.assign(ctx(codeX, 0), { seat: 1 }),
    { k: 'reveal', idx: 1, dx: 1, dy: 2, sp: 0.25, n: '0'.repeat(32) });
  t('und keine fremde Enthuellung', f2.status === A.M.FB_V9_DENIED, f2.status);
  await entferne(codeX);

  await beenden(code, [lA, lB], [A, B]);
}

// ══ SZENARIO B ═════════════════════════════════════════════════════════════════
abschnitt('B - echtes Neuladen: Arbeitsspeicher weg, Sitzungsspeicher da');
{
  const code = 'EEBB';
  await raum(code, 2);
  const unterbau = new Map();          // DAS ueberlebt das Neuladen - sonst nichts
  let A1 = spur(laufzeit(UID[0], unterbau));
  const l1 = A1.M.fbV9Start(ctx(code, 0), { move: ZUG[0] });
  laufende.push({ stop: () => l1.stop() });
  await warteAuf('Sitz 0 hat seinen Commit geschrieben',
    async () => !!(await lies('rooms/' + code + '/g/0/c/0/0')));
  const commit = await lies('rooms/' + code + '/g/0/c/0/0');
  const salzVorher = JSON.parse(unterbau.get(KEY(code, 0))).salt;
  t('der Commit steht autoritativ im Raum', commit.k === 'move' && typeof commit.h === 'string');
  t('das Geheimnis liegt im Sitzungsspeicher', typeof salzVorher === 'string' && salzVorher.length === 32);
  t('und der alte Arbeitsspeicher kennt es noch', A1.M.fbV9SecretFor(code, 0, 0) !== null);

  // ── DAS NEULADEN ───────────────────────────────────────────────────────────
  // Der Lauf wird gestoppt, alle Zuhoerer abgemeldet, alle Wecker geloescht, und die
  // ganze Modulinstanz wird fallengelassen. Der neue Tab bekommt eine FRISCHE
  // Instanz des echten Quelltexts - nur die Speicherkarte wird weitergereicht.
  l1.stop();
  await l1.fertig;
  const alteTimer = A1.offen(), alteHoerer = A1.hoerer();
  const alteInstanz = A1.M;
  A1 = null;                            // die Laufzeit ist weg
  t('der alte Lauf hat alle Wecker abgeraeumt', alteTimer === 0, alteTimer);

  const A2 = spur(laufzeit(UID[0], unterbau));
  t('die NEUE Laufzeit ist eine andere Modulinstanz', A2.M !== alteInstanz);
  t('und ihr Arbeitsspeicher kennt kein Geheimnis - genau das ist der Beweis',
    A2.M.fbV9SecretFor(code, 0, 0) === null);
  t('der Sitzungsspeicher traegt es dagegen weiter', unterbau.has(KEY(code, 0)));

  const g = await A2.M.fbV9SecretLoad(ctx(code, 0), UID[0]);
  t('fbV9SecretLoad findet es', g.status === A2.M.FB_V9_OK, g.status);
  t('die lokale Hash-Nachrechnung stimmt (sonst waere der Status nicht OK)',
    g.secret && typeof g.secret.h === 'string');
  t('und der Hash ist derselbe wie im autoritativen Commit', g.secret.h === commit.h);
  const spieler = await lies('rooms/' + code + '/players/0/uid');
  t('players/0/uid entspricht der angemeldeten Kennung', spieler === UID[0], spieler);

  const B = spur(laufzeit(UID[1]));
  const l2 = A2.M.fbV9Resume(ctx(code, 0));
  const lB = B.M.fbV9Start(ctx(code, 1), { move: ZUG[1] });
  laufende.push({ stop: () => { l2.stop(); lB.stop(); } });
  await warteAuf('der fortgesetzte Lauf erreicht COMPLETE',
    () => l2.stufe === A2.M.FB_V9_COMPLETE && lB.stufe === B.M.FB_V9_COMPLETE);
  t('der fortgesetzte Lauf ist fertig', l2.stufe === A2.M.FB_V9_COMPLETE,
    l2.stufe + ' ' + (l2.grund || ''));

  const rev = await lies('rooms/' + code + '/g/0/r/0/0');
  t('das Ergebnis traegt GENAU das gespeicherte Salz - kein neues wurde erzeugt',
    rev.n === salzVorher, rev.n + ' / ' + salzVorher);
  t('und genau den urspruenglichen Vektor',
    rev.idx === 0 && rev.dx === 12.5 && rev.dy === -8.25 && rev.sp === 0.5,
    JSON.stringify(rev));
  const nach = await A2.M.fbV9Hash({ room: code, gen: 0, turn: 0, seat: 0, kind: 1,
                                     idx: rev.idx, dx: rev.dx, dy: rev.dy, sp: rev.sp },
                                   A2.M.fbV9SaltFromHex(rev.n));
  t('der nachgerechnete Hash ist bitgleich dem Commit-Hash', nach === commit.h, nach);
  t('die Regeln haben die Enthuellung angenommen', l2.menge[0].status === A2.M.FB_V9_VALID,
    l2.menge[0].status);
  t('Sitz 1 ebenfalls VALID', l2.menge[1].status === A2.M.FB_V9_VALID, l2.menge[1].status);
  t('und das Geheimnis ist danach geraeumt', !unterbau.has(KEY(code, 0)));

  t('die weggeworfene erste Laufzeit hat auch ihren Zuhoerer abgemeldet',
    alteHoerer === 0, alteHoerer);
  await beenden(code, [l1, l2, lB], [A2, B]);
}

// ══ SZENARIO C ═════════════════════════════════════════════════════════════════
abschnitt('C - kein Commit: die echte Frist schliesst mit late');
{
  const code = 'EECC';
  await raum(code, 2);
  const A = spur(laufzeit(UID[0]));
  const lA = A.M.fbV9Start(ctx(code, 0), { move: ZUG[0] });
  laufende.push({ stop: () => lA.stop() });
  await warteAuf('der Rundenbeginn steht', async () => !!(await lies('rooms/' + code + '/g/0/d/0')));

  // ── 12. VORZEITIGES late WIRD ABGEWIESEN ───────────────────────────────────
  const frueh = await A.M.fbV9NetWriteLate(ctx(code, 0), 1);
  t('vor der Frist weisen die Regeln late ab', frueh.status === A.M.FB_V9_DENIED, frueh.status);
  t('und im Raum steht nichts', (await lies('rooms/' + code + '/g/0/c/0/1')) === null);
  t('der Lauf wartet an der Commit-Barriere', lA.stufe === A.M.FB_V9_WAIT_COMMITS, lA.stufe);

  // Sitz 1 tut NICHTS. Einmal die echten ~6,25 s abwarten.
  const tC = Date.now();
  await warteAuf('nach der echten Frist steht late', async () => {
    const v = await lies('rooms/' + code + '/g/0/c/0/1');
    return v && v.k === 'late';
  }, WARTE_GRENZE_MS);
  const spaet = await lies('rooms/' + code + '/g/0/c/0/1');
  t('die Schliessung kam nicht vor der Frist', Date.now() - tC >= 5500, Date.now() - tC);
  t('c/0/1 ist {k:late, ts:<Serverzeit>}',
    spaet.k === 'late' && typeof spaet.ts === 'number' && Object.keys(spaet).sort().join(',') === 'k,ts',
    JSON.stringify(spaet));
  await warteAuf('der Lauf schliesst ab', () => lA.stufe === A.M.FB_V9_COMPLETE);
  t('das Protokoll ist abgeschlossen', lA.stufe === A.M.FB_V9_COMPLETE, lA.stufe + ' ' + (lA.grund || ''));
  t('Sitz 0 bleibt VALID', lA.menge[0].status === A.M.FB_V9_VALID, lA.menge[0].status);
  t('Sitz 1 gilt als late und braucht kein Ergebnis',
    lA.menge[1].kind === 'late' && lA.menge[1].status === A.M.FB_V9_VALID,
    JSON.stringify(lA.menge[1]));
  t('und im Ergebniszweig steht fuer Sitz 1 nichts',
    (await lies('rooms/' + code + '/g/0/r/0/1')) === null);
  await beenden(code, [lA], [A]);
}

// ══ SZENARIO D ═════════════════════════════════════════════════════════════════
abschnitt('D - Zug ohne Enthuellung: die echte Frist schliesst mit noreveal');
{
  const code = 'EEDD';
  await raum(code, 2);
  const A = spur(laufzeit(UID[0])), B = spur(laufzeit(UID[1]));
  const lA = A.M.fbV9Start(ctx(code, 0), { move: ZUG[0] });
  laufende.push({ stop: () => lA.stop() });
  await warteAuf('der Rundenbeginn steht', async () => !!(await lies('rooms/' + code + '/g/0/d/0')));
  // Sitz 1 committet mit dem ECHTEN Quelltext, enthuellt aber nie.
  const terminal = await B.M.fbV9MakeCommit(B.M.fbV9EngineCtx(ctx(code, 1)), ZUG[1]);
  const rB = await B.M.fbV9NetWriteCommit(ctx(code, 1), terminal);
  t('Sitz 1 setzt einen echten Zug-Commit', rB.status === B.M.FB_V9_COMMITTED, rB.status);

  await warteAuf('der Enthuellungsanker steht', async () => !!(await lies('rooms/' + code + '/g/0/ro/0')));
  const frueh = await B.M.fbV9NetWriteNoReveal(ctx(code, 1), 1);
  t('vor der Frist weisen die Regeln noreveal ab', frueh.status === B.M.FB_V9_DENIED, frueh.status);
  t('und im Raum steht nichts', (await lies('rooms/' + code + '/g/0/r/0/1')) === null);

  const tD = Date.now();
  await warteAuf('nach der echten Frist steht noreveal', async () => {
    const v = await lies('rooms/' + code + '/g/0/r/0/1');
    return v && v.k === 'noreveal';
  }, WARTE_GRENZE_MS);
  const nr = await lies('rooms/' + code + '/g/0/r/0/1');
  t('die Schliessung kam nicht vor der Frist', Date.now() - tD >= 5500, Date.now() - tD);
  t('r/0/1 ist {k:noreveal, ts:<Serverzeit>}',
    nr.k === 'noreveal' && typeof nr.ts === 'number' && Object.keys(nr).sort().join(',') === 'k,ts',
    JSON.stringify(nr));
  await warteAuf('der Lauf schliesst ab', () => lA.stufe === A.M.FB_V9_COMPLETE);
  t('das Protokoll ist abgeschlossen', lA.stufe === A.M.FB_V9_COMPLETE, lA.stufe + ' ' + (lA.grund || ''));
  t('Sitz 0: VALID', lA.menge[0].status === A.M.FB_V9_VALID, lA.menge[0].status);
  t('Sitz 1: NO_REVEAL', lA.menge[1].status === A.M.FB_V9_NO_REVEAL, lA.menge[1].status);
  t('und kein Zug wird fuer Sitz 1 angenommen', lA.menge[1].move === null);
  await beenden(code, [lA], [A, B]);
}

// ══ OPTIONAL: VERLORENES GEHEIMNIS ═════════════════════════════════════════════
abschnitt('Optional - verlorenes Geheimnis: kein erfundener Reveal');
{
  const code = 'EEZZ';
  await raum(code, 2);
  const unterbau = new Map();
  const A1 = spur(laufzeit(UID[0], unterbau));
  const l1 = A1.M.fbV9Start(ctx(code, 0), { move: ZUG[0] });
  laufende.push({ stop: () => l1.stop() });
  await warteAuf('Sitz 0 hat seinen Commit geschrieben', async () => {
    if (l1.stufe === A1.M.FB_V9_FAILED) throw new Error('Lauf gescheitert: ' + l1.grund);
    return !!(await lies('rooms/' + code + '/g/0/c/0/0'));
  });
  l1.stop();
  unterbau.clear();                    // Arbeitsspeicher UND Sitzungsspeicher weg
  const A2 = spur(laufzeit(UID[0], unterbau));
  t('weder im Arbeits- noch im Sitzungsspeicher liegt noch etwas',
    A2.M.fbV9SecretFor(code, 0, 0) === null && unterbau.size === 0);
  const B = spur(laufzeit(UID[1]));
  const l2 = A2.M.fbV9Resume(ctx(code, 0));
  const lB = B.M.fbV9Start(ctx(code, 1), { move: ZUG[1] });
  laufende.push({ stop: () => { l2.stop(); lB.stop(); } });
  // Auch Sitz 1 wird zu Ende gefuehrt. Genau dieses Abwarten fehlte: sein Ergebnis
  // war noch unterwegs, als das Fixture geloescht wurde.
  await warteAuf('beide Laeufe schliessen trotz verlorenem Geheimnis ab',
    () => l2.stufe === A2.M.FB_V9_COMPLETE && lB.stufe === B.M.FB_V9_COMPLETE, 20000);
  const rev0 = await lies('rooms/' + code + '/g/0/r/0/0');
  t('kein Reveal wurde erfunden', rev0.k === 'noreveal', JSON.stringify(rev0));
  t('und der eigene Commit blieb ein move',
    (await lies('rooms/' + code + '/g/0/c/0/0')).k === 'move');
  t('Sitz 0: NO_REVEAL', l2.menge[0].status === A2.M.FB_V9_NO_REVEAL, l2.menge[0].status);
  t('Sitz 1: VALID', l2.menge[1].status === A2.M.FB_V9_VALID, l2.menge[1].status);
  await beenden(code, [l1, l2, lB], [A1, A2, B]);
}

// ══ E - BEREITSCHAFT MIT DEM ECHTEN CLIENT ═══════════════════════════════════
abschnitt('E - die Bereitschaftsbarriere, echt gefahren');
{
  const code = 'EEEE';
  await raum(code, 3, { bereit: false });          // KEIN vorbefuelltes s/q
  const K = [0, 1, 2].map(i => spur(laufzeit(UID[i])));
  K.forEach((k, i) => { k.welt.cap = 3; k.welt.seat = i; k.welt.myPlayer = i;
                        k.welt.roomCode = code; k.welt.gen = 0; k.welt.turnNo = 0;
                        k.M.sync(); });
  const laeufe = K.map((k, i) => k.M.fbV9ReadyStart(ctx(code, i, 3)));
  laufende.push({ stop: () => laeufe.forEach(l => l.stop()) });
  await warteAuf('der Generationsstart entsteht',
    async () => !!(await lies('rooms/' + code + '/g/0/s')));
  const sAnk = await lies('rooms/' + code + '/g/0/s');
  t('E: s traegt einen SERVERzeitstempel',
    sAnk && typeof sAnk.ts === 'number' && Object.keys(sAnk).join(',') === 'ts',
    JSON.stringify(sAnk));
  t('E: ohne Bereitschaftszeichen meldet niemand',
    (await lies('rooms/' + code + '/g/0/q')) === null);
  laeufe.forEach((l, i) => K[i].M.fbV9ReadyLocal(l));
  await warteAuf('alle drei sind bereit',
    () => laeufe.every(l => l.stufe === K[0].M.FB_V9_R_COMPLETE));
  const q0 = await lies('rooms/' + code + '/g/0/q/0');
  t('E: drei Bereitschaften stehen', q0 && Object.keys(q0).length === 3, JSON.stringify(q0));
  t('E: jede traegt genau k,n,ts',
    [0, 1, 2].every(i => Object.keys(q0[i]).sort().join(',') === 'k,n,ts' &&
                         q0[i].k === 'ready' && q0[i].n === 0));
  t('E: die Barriere ist bei allen geschlossen',
    laeufe.every(l => l.stufe === K[0].M.FB_V9_R_COMPLETE));
  // Und ERST JETZT darf die Runde entstehen.
  const auf = await K[0].M.fbV9NetOpenTurn(ctx(code, 0, 3));
  t('E: mit geschlossener Barriere oeffnet die Runde',
    auf.status === K[0].M.FB_V9_COMMITTED, auf.status);
  laeufe.forEach(l => l.stop());
  await entferne(code);
}

// ══ F - DREI SPIELER, VOLLER ZUG, EINIGKEIT ══════════════════════════════════
abschnitt('F - drei Spieler: ein vollstaendiger Zug, drei gleiche Zugmengen');
{
  const code = 'FFFF';
  await raum(code, 3);
  const K = [0, 1, 2].map(i => spur(laufzeit(UID[i])));
  const ZUEGE = [{ idx: 0, dx: 12.5, dy: -8.25, sp: 0.5 },
                 { idx: 1, dx: -3.75, dy: 6.5, sp: 0.875 },
                 { idx: 2, dx: 7.25, dy: 1.5, sp: -0.25 }];
  const L = K.map((k, i) => k.M.fbV9Start(ctx(code, i, 3), { move: ZUEGE[i] }));
  laufende.push({ stop: () => L.forEach(l => l.stop()) });
  await warteAuf('alle drei erreichen COMPLETE',
    () => L.every(l => l.stufe === K[0].M.FB_V9_COMPLETE), 20000);
  t('F: alle drei sind fertig', L.every(l => l.stufe === K[0].M.FB_V9_COMPLETE),
    L.map(l => l.stufe + '/' + (l.grund || '')).join(' '));
  // EINIGKEIT: dieselbe Zugmenge, Zeichen fuer Zeichen.
  const mengen = L.map(l => JSON.stringify(l.menge));
  t('F: alle drei kommen zur GLEICHEN Zugmenge',
    new Set(mengen).size === 1, mengen.map(m => m.length).join('/'));
  const m0 = L[0].menge;
  t('F: sie ist sitzsortiert', m0.every((e, i) => e.seat === i));
  t('F: alle drei sind VALID', m0.every(e => e.status === K[0].M.FB_V9_VALID));
  t('F: mit genau den abgeschickten Vektoren',
    m0.every((e, i) => e.move.dx === ZUEGE[i].dx && e.move.dy === ZUEGE[i].dy &&
                       e.move.sp === ZUEGE[i].sp),
    JSON.stringify(m0.map(e => e.move)));
  const d0 = await lies('rooms/' + code + '/g/0/d/0');
  t('F: genau EIN Rundenanker mit Serverzeit',
    d0 && d0.n === 0 && typeof d0.o === 'number');
  const c0 = await lies('rooms/' + code + '/g/0/c/0');
  t('F: kein Klartext im Commit-Zweig',
    !/"(idx|dx|dy|sp|n|salt)"/.test(JSON.stringify(c0)) &&
    JSON.stringify(c0).indexOf('12.5') < 0, JSON.stringify(c0).slice(0, 120));
  t('F: jeder Commit traegt genau k,h,ts',
    [0, 1, 2].every(i => Object.keys(c0[i]).sort().join(',') === 'h,k,ts'));
  const z0 = await lies('rooms/' + code + '/g/0/z/0');
  t('F: genau ein Abschlussanker', z0 && typeof z0.ts === 'number' &&
    Object.keys(z0).join(',') === 'ts', JSON.stringify(z0));
  L.forEach(l => l.stop());
  await beenden(code, L, K);
}

// ══ G - DIE RUNDE OEFFNET SICH VOR DER HANDLUNG ══════════════════════════════
abschnitt('G - die gemeinsame Uhr haengt an d, nicht am ersten Zug');
{
  const code = 'GGGG';
  await raum(code, 3);
  const K = [0, 1, 2].map(i => spur(laufzeit(UID[i])));
  // A startet OHNE Handlung - die Runde muss trotzdem entstehen.
  const lA = K[0].M.fbV9Start(ctx(code, 0, 3), null);
  laufende.push({ stop: () => lA.stop() });
  await warteAuf('die Runde entsteht ohne jede Handlung',
    async () => !!(await lies('rooms/' + code + '/g/0/d/0')));
  const d0 = await lies('rooms/' + code + '/g/0/d/0');
  t('G: der Rundenanker steht - ohne dass jemand gezogen hat',
    d0 && typeof d0.o === 'number');
  t('G: und kein Terminal im Raum', (await lies('rooms/' + code + '/g/0/c')) === null);
  // Jetzt reicht A seinen Zug nach.
  t('G: der nachgereichte Zug wird angenommen',
    K[0].M.fbV9Action(lA, { move: { idx: 0, dx: 4, dy: 0, sp: 0 } }) === true);
  await warteAuf('er steht im Raum',
    async () => !!(await lies('rooms/' + code + '/g/0/c/0/0')));
  const c00 = await lies('rooms/' + code + '/g/0/c/0/0');
  t('G: als echter Commit mit Hash', c00.k === 'move' && c00.h.length === 64);
  t('G: ein zweiter Zug wird abgewiesen',
    K[0].M.fbV9Action(lA, { move: { idx: 0, dx: 9, dy: 0, sp: 0 } }) === false);
  t('G: die gemeinsame Frist kommt aus DEMSELBEN Serverzeitstempel',
    (await lies('rooms/' + code + '/g/0/d/0')).o === d0.o);
  lA.stop();
  await beenden(code, [lA], [K[0]]);
}

// ══ H - BEREITSCHAFTSFRIST, DISQUALIFIKATION, SOFORTIGES REMOVE ══════════════
abschnitt('H - Fristschluss, x und der sofort geschlossene Slot');
{
  const code = 'HHHH';
  // Der Generationsstart liegt NACHWEISLICH mehr als dreissig Sekunden zurueck -
  // als Fixture, ueber den Verwaltungsweg. Keine gefaelschte Uhr, keine
  // aufgeweichte Regel: die Rules rechnen weiter mit ihrer eigenen Zeit.
  await raum(code, 3, { bereit: false,
    g: { s: { ts: Date.now() - 45000 }, q: { 0: { 0: { k: 'ready', n: 0, ts: Date.now() - 40000 } } } } });
  const A0 = spur(laufzeit(UID[0]));
  // Zu frueh geht nichts: ein FRISCHER Anker in einem anderen Raum wird abgewiesen.
  const frisch = 'HHJK';
  await raum(frisch, 3, { bereit: false, g: { s: { ts: Date.now() } } });
  const zuFrueh = await A0.M.fbV9NetWriteReadyTimeout(ctx(frisch, 0, 3), 1);
  t('H: vor der Frist weisen die Regeln den Fristschluss ab',
    zuFrueh.status === A0.M.FB_V9_DENIED, zuFrueh.status);
  await entferne(frisch);
  // Nach der Frist: Fristschluss, dann Disqualifikation.
  const to1 = await A0.M.fbV9NetWriteReadyTimeout(ctx(code, 0, 3), 1);
  const to2 = await A0.M.fbV9NetWriteReadyTimeout(ctx(code, 0, 3), 2);
  t('H: nach der Frist traegt der Fristschluss',
    to1.status === A0.M.FB_V9_COMMITTED && to2.status === A0.M.FB_V9_COMMITTED,
    to1.status + '/' + to2.status);
  const q1 = await lies('rooms/' + code + '/g/0/q/0/1');
  t('H: er steht als {k,n,ts}', q1.k === 'timeout' && q1.n === 0 &&
    Object.keys(q1).sort().join(',') === 'k,n,ts', JSON.stringify(q1));
  const x1 = await A0.M.fbV9NetWriteDisqualify(ctx(code, 0, 3), 1);
  const x2 = await A0.M.fbV9NetWriteDisqualify(ctx(code, 0, 3), 2);
  t('H: die Disqualifikation folgt', x1.status === A0.M.FB_V9_COMMITTED &&
    x2.status === A0.M.FB_V9_COMMITTED, x1.status + '/' + x2.status);
  const xs = await lies('rooms/' + code + '/g/0/x/1');
  t('H: sie steht als {k,n,ts}', xs.k === 'ready_timeout' && xs.n === 0);
  // Mit zwei disqualifizierten Sitzen darf die Runde oeffnen.
  const auf = await A0.M.fbV9NetOpenTurn(ctx(code, 0, 3));
  t('H: die Runde oeffnet ohne die disqualifizierten Sitze',
    auf.status === A0.M.FB_V9_COMMITTED, auf.status);
  // Und ihre Slots lassen sich SOFORT schliessen - ohne sechs Sekunden zu warten.
  const t0 = Date.now();
  const r1 = await A0.M.fbV9NetWriteRemove(ctx(code, 0, 3), 1);
  const r2 = await A0.M.fbV9NetWriteRemove(ctx(code, 0, 3), 2);
  t('H: remove gegen einen disqualifizierten Sitz traegt sofort',
    r1.status === A0.M.FB_V9_COMMITTED && r2.status === A0.M.FB_V9_COMMITTED,
    r1.status + '/' + r2.status);
  t('H: und zwar ohne die Sechs-Sekunden-Frist', Date.now() - t0 < 3000, Date.now() - t0);
  const c1 = await lies('rooms/' + code + '/g/0/c/0/1');
  t('H: der Slot traegt {k:remove, ts}', c1.k === 'remove' &&
    Object.keys(c1).sort().join(',') === 'k,ts', JSON.stringify(c1));
  await entferne(code);
}

// ══ I - PRAESENZ-AUSTRAGUNG SCHLIESST EBENFALLS SOFORT ═══════════════════════
abschnitt('I - e und remove');
{
  const code = 'JKMN';
  await raum(code, 3, { offline: [2] });
  const A0 = spur(laufzeit(UID[0]));
  // e entsteht ueber den ECHTEN Regelweg: ein anwesender Mitspieler traegt einen
  // lange abwesenden Sitz aus.
  const ev = await A0.M.fbV9NetOpenTurn(ctx(code, 0, 3));   // Runde zuerst
  t('I: die Runde oeffnet', ev.status === A0.M.FB_V9_COMMITTED, ev.status);
  const eOk = await (async () => { try {
    const r = await runTransaction(ref(alsUid(UID[0]),
      'rooms/' + code + '/g/0/e/2'), cur => cur == null ? true : undefined,
      { applyLocally: false });
    return r.committed; } catch (e) { return false; } })();
  t('I: ein anwesender Mitspieler traegt den abwesenden Sitz aus', eOk === true);
  const rr = await A0.M.fbV9NetWriteRemove(ctx(code, 0, 3), 2);
  t('I: sein Slot wird sofort geschlossen', rr.status === A0.M.FB_V9_COMMITTED, rr.status);
  t('I: mit einem remove-Terminal',
    (await lies('rooms/' + code + '/g/0/c/0/2')).k === 'remove');
  await entferne(code);
}

// ══ J - HASH-ABWEICHUNG ══════════════════════════════════════════════════════
abschnitt('J - eine Enthuellung, die nicht zu ihrem Commit passt');
{
  const code = 'JJKM';
  await raum(code, 2);
  const A0 = spur(laufzeit(UID[0])), B0 = spur(laufzeit(UID[1]));
  await A0.M.fbV9NetOpenTurn(ctx(code, 0, 2));
  // Beide committen ehrlich; B enthuellt danach ANDERE Werte. Die Regeln koennen
  // das nicht bemerken - sie rechnen keinen Hash. Der Client muss es bemerken.
  const tA = await A0.M.fbV9MakeCommit(A0.M.fbV9EngineCtx(ctx(code, 0, 2)),
                                       { idx: 0, dx: 5, dy: 0, sp: 0 });
  const tB = await B0.M.fbV9MakeCommit(B0.M.fbV9EngineCtx(ctx(code, 1, 2)),
                                       { idx: 1, dx: -5, dy: 0, sp: 0 });
  await A0.M.fbV9NetWriteCommit(ctx(code, 0, 2), tA);
  await B0.M.fbV9NetWriteCommit(ctx(code, 1, 2), tB);
  await A0.M.fbV9NetOpenReveal(ctx(code, 0, 2));
  const revA = A0.M.fbV9MakeReveal({ room: code, gen: 0, turn: 0, seat: 0 });
  const revB = B0.M.fbV9MakeReveal({ room: code, gen: 0, turn: 0, seat: 1 });
  await A0.M.fbV9NetWriteReveal(ctx(code, 0, 2), revA);
  const gelogen = Object.assign({}, revB, { dx: 99 });   // andere Werte, gleiches Salz
  const wB = await B0.M.fbV9NetWriteReveal(ctx(code, 1, 2), gelogen);
  t('J: die Regeln nehmen die formal gueltige Enthuellung an',
    wB.status === B0.M.FB_V9_COMMITTED, wB.status);
  const c = await lies('rooms/' + code + '/g/0/c/0');
  const r = await lies('rooms/' + code + '/g/0/r/0');
  const mengen = await Promise.all([A0, B0].map(k =>
    k.M.fbV9AcceptedSet({ room: code, gen: 0, turn: 0 }, 2, c, r)));
  t('J: beide Clients erkennen die Abweichung',
    mengen.every(m => m[1].status === A0.M.FB_V9_MISMATCH),
    mengen.map(m => m[1].status).join('/'));
  t('J: und sind sich vollstaendig einig',
    JSON.stringify(mengen[0]) === JSON.stringify(mengen[1]));
  t('J: der ehrliche Zug bleibt gueltig', mengen[0][0].status === A0.M.FB_V9_VALID);
  t('J: fuer den Abweichler gibt es keinen Zug', mengen[0][1].move === null);
  await entferne(code);
}

// ══ K - REHYDRIERUNG UEBER DEN ECHTEN EINSTIEG ═══════════════════════════════
abschnitt('K - zwei Runden Historie, dann ein frischer Client');
{
  const code = 'KKMN';
  await raum(code, 2);
  const A0 = spur(laufzeit(UID[0])), B0 = spur(laufzeit(UID[1]));
  const ZUG = [[{ idx: 0, dx: 3, dy: 1, sp: 0.25 }, { idx: 1, dx: -3, dy: -1, sp: 0 }],
               [{ idx: 0, dx: 2, dy: 0, sp: 0 }, { idx: 1, dx: -2, dy: 0, sp: 0.5 }]];
  for (let n = 0; n < 2; n++) {
    if (n > 0) await seed('rooms/' + code + '/g/0/q/' + n,
      { 0: { k: 'ready', n: n, ts: Date.now() }, 1: { k: 'ready', n: n, ts: Date.now() } });
    const l0 = A0.M.fbV9Start(Object.assign(ctx(code, 0, 2), { turn: n }), { move: ZUG[n][0] });
    const l1 = B0.M.fbV9Start(Object.assign(ctx(code, 1, 2), { turn: n }), { move: ZUG[n][1] });
    laufende.push({ stop: () => { l0.stop(); l1.stop(); } });
    await warteAuf('Runde ' + n + ' wird abgeschlossen',
      () => l0.stufe === A0.M.FB_V9_COMPLETE && l1.stufe === B0.M.FB_V9_COMPLETE, 20000);
    l0.stop(); l1.stop();
  }
  t('K: zwei Abschlussanker stehen',
    !!(await lies('rooms/' + code + '/g/0/z/0')) && !!(await lies('rooms/' + code + '/g/0/z/1')));
  // Ein FRISCHER Client betritt ueber den echten Einstieg.
  const N = spur(laufzeit(UID[0]));
  N.welt.cap = 2; N.welt.seat = 0; N.welt.myPlayer = 0; N.welt.roomCode = code;
  N.welt.gen = 0; N.welt.turnNo = -1; N.M.sync();
  t('K: der Einstieg uebernimmt', N.M.fbV9RaumStart() === true);
  await warteAuf('die Welt ist wiederhergestellt',
    () => N.M.zustand().turnNo === 2, 15000);
  const zu = N.M.zustand();
  t('K: beide Runden sind nachgespielt', zu.turnNo === 2, zu.turnNo);
  t('K: die Kugeln stehen an der Summe beider Zuege',
    zu.balls[0].x === 5 && zu.balls[0].y === 1 && zu.balls[1].x === -5,
    zu.balls.map(b => b.x + '/' + b.y).join(' '));
  t('K: der Drall ist der des LETZTEN Zuges',
    zu.balls[0].spin === 0 && zu.balls[1].spin === 0.5,
    zu.balls.map(b => b.spin).join('/'));
  t('K: niemand ist ausgeschieden', zu.aktiv.slice(0, 2).join(',') === 'true,true',
    zu.aktiv.join(','));
  t('K: das Match laeuft', zu.phase !== 'over' && zu.footballWinner === null);
  t('K: nachgespielt wurde STUMM', N.welt.spur.indexOf('KLANG') < 0,
    N.welt.spur.join(',').slice(0, 120));
  t('K: und die Wiederherstellung schrieb nichts in die Historie',
    (await lies('rooms/' + code + '/g/0/c/2')) === null);
  N.M.fbV9LebenStop();
  await entferne(code);
}

// ══ L - AKTUELLE RUNDE OHNE ABSCHLUSSANKER ═══════════════════════════════════
abschnitt('L - c und r vollstaendig, z fehlt: das ist die LAUFENDE Runde');
{
  const code = 'MNPQ';
  await raum(code, 2);
  const A0 = spur(laufzeit(UID[0])), B0 = spur(laufzeit(UID[1]));
  // Ein vollstaendiger Zug OHNE z: beide Laeufe werden vor dem Abschluss gestoppt.
  await A0.M.fbV9NetOpenTurn(ctx(code, 0, 2));
  for (const [k, seat] of [[A0, 0], [B0, 1]]) {
    const term = await k.M.fbV9MakeCommit(k.M.fbV9EngineCtx(ctx(code, seat, 2)),
                                          { idx: seat, dx: seat ? -4 : 4, dy: 0, sp: 0 });
    await k.M.fbV9NetWriteCommit(ctx(code, seat, 2), term);
  }
  await A0.M.fbV9NetOpenReveal(ctx(code, 0, 2));
  for (const [k, seat] of [[A0, 0], [B0, 1]])
    await k.M.fbV9NetWriteReveal(ctx(code, seat, 2),
      k.M.fbV9MakeReveal({ room: code, gen: 0, turn: 0, seat: seat }));
  t('L: c und r sind vollstaendig',
    Object.keys(await lies('rooms/' + code + '/g/0/c/0')).length === 2 &&
    Object.keys(await lies('rooms/' + code + '/g/0/r/0')).length === 2);
  t('L: aber es gibt keinen Abschlussanker',
    (await lies('rooms/' + code + '/g/0/z/0')) === null);
  // Ein frischer Client: diese Runde ist NICHT Historie.
  const N = spur(laufzeit(UID[0]));
  N.welt.cap = 2; N.welt.seat = 0; N.welt.myPlayer = 0; N.welt.roomCode = code;
  N.welt.gen = 0; N.welt.turnNo = -1; N.M.sync();
  const hist = await N.M.fbV9RehydrierPlan(ctx(code, 0, 2),
    await (await fetch(REST + '/rooms/' + code + '/g/0.json?ns=' + NS,
                       { headers: ADMIN })).json());
  t('L: die Wiederherstellung sieht KEINE abgeschlossene Runde',
    hist.mengen && hist.mengen.length === 0, JSON.stringify(hist).slice(0, 90));
  t('L: die Runde bleibt der laufenden Steuerung',
    (await lies('rooms/' + code + '/g/0/d/0')) !== null);
  N.M.fbV9LebenStop();
  await entferne(code);
}

// ══ M - v8 BLEIBT UNBERUEHRT ═════════════════════════════════════════════════
abschnitt('M - ein v8-Raum auf demselben Emulator');
{
  const code = 'MMNP';
  const p = {}, players = {};
  for (let i = 0; i < 2; i++) {
    p[i] = { s: 'V8TAB' + i, on: true, t: Date.now() };
    players[i] = { id: 'V8PID' + i, name: 'P' + i, tab: 'V8TAB' + i, uid: UID[i] };
  }
  await seed('rooms/' + code, { v: 8, hostUid: UID[0],
    config: { game: 'football', winTarget: 3, fmt: 'elimination',
              visibility: 'private', mode: 'lives', cap: 2 },
    gen: 0, state: 'playing', seats: 2, p: p, players: players,
    created: Date.now() - 60000 });
  eigeneRaeume.add(code); ANGELEGT.push(code);
  const A0 = spur(laufzeit(UID[0]));
  // Der v8-Zugslot traegt Klartext - das ist sein Datenmodell und bleibt so.
  const ok = await (async () => { try {
    const r = await runTransaction(ref(alsUid(UID[0]), 'rooms/' + code + '/g/0/t/0/0'),
      // Der v8-Football-Slot verlangt genau k,idx,dx,dy,sp - und nichts sonst.
      cur => cur == null ? { k: 'move', idx: 0, dx: 5, dy: 0, sp: 0 } : undefined,
      { applyLocally: false });
    return r.committed; } catch (e) { return false; } })();
  t('M: der v8-Zugslot t nimmt weiterhin an', ok === true);
  // Und JEDER v9-Knoten ist in einem v8-Raum unerreichbar.
  const v9c = ctx(code, 0, 2);
  const versuche = await Promise.all([
    A0.M.fbV9NetOpenStart(v9c), A0.M.fbV9NetOpenTurn(v9c),
    A0.M.fbV9NetWriteReady(v9c), A0.M.fbV9NetMarkComplete(v9c),
    A0.M.fbV9NetWriteDisqualify(v9c, 1)]);
  t('M: kein v9-Knoten laesst sich in einem v8-Raum anlegen',
    versuche.every(r => r.status === A0.M.FB_V9_DENIED),
    versuche.map(r => r.status).join(','));
  t('M: und im Raum steht auch nichts davon',
    (await lies('rooms/' + code + '/g/0/s')) === null &&
    (await lies('rooms/' + code + '/g/0/q')) === null &&
    (await lies('rooms/' + code + '/g/0/z')) === null);
  t('M: die Zughistorie steht dagegen unter t',
    (await lies('rooms/' + code + '/g/0/t/0/0')) !== null);
  await entferne(code);
}
// ══ AUFRAEUMEN ═════════════════════════════════════════════════════════════════
abschnitt('Aufraeumen');
// Jedes Szenario hat sich selbst abgeraeumt; was hier noch steht, waere ein Fehler.
// Geprueft und geloescht wird AUSSCHLIESSLICH, was dieser Lauf selbst angelegt hat -
// fremde oder aeltere Raeume im Emulator gehen ihn nichts an.
for (const c of [...eigeneRaeume]) await entferne(c);
t('kein eigenes Fixture ist uebrig', eigeneRaeume.size === 0, [...eigeneRaeume].join(','));
t('kein Zuhoerer ist mehr offen', offeneHoerer === 0, offeneHoerer);
const restWecker = alleLaufzeiten.reduce((n, r) => n + r.offen(), 0);
t('kein Wecker laeuft mehr', restWecker === 0, restWecker);
for (const c of ANGELEGT) {
  t(c + ': am Ende bestaetigt null', (await lies('rooms/' + c)) === null);
}

const dauer = ((Date.now() - T0) / 1000).toFixed(1);
console.log('\nV9-E2E gegen den Emulator: ' + pass + ' passed, ' + fail + ' failed  (' + dauer + ' s)');
clearTimeout(notbremse);
for (const uid of Object.keys(zugaenge)) { try { SDK.db.goOffline(zugaenge[uid]); } catch (e) {} }
process.exit(fail ? 1 : 0);

})().catch(e => {
  console.log('\nABBRUCH: ' + (e && e.message ? e.message : e));
  for (const l of laufende) { try { l.stop(); } catch (x) {} }
  clearTimeout(notbremse);
  process.exit(1);
});
