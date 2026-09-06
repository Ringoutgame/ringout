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
//   cd artifacts/v9-sdk && firebase emulators:start --only database --project demo-v9sdk
//   node tools/test_online_v9_e2e.js
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const HOST = '127.0.0.1', PORT = 9020, PROJEKT = 'demo-v9sdk';
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
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(DB_URL) || /firebaseio|ringout-87fbb/.test(DB_URL)) {
  console.log('ABBRUCH: Datenbankadresse ist nicht lokal -> ' + DB_URL);
  process.exit(2);
}

let SDK;
try { SDK = { app: require('firebase/app'), db: require('firebase/database') }; }
catch (e) { console.log('SDK fehlt: npm install --no-save firebase'); process.exit(3); }
const { initializeApp } = SDK.app;
const { getDatabase, connectDatabaseEmulator, ref, onValue,
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
const RULES_KOPIE = path.join(__dirname, '..', 'artifacts', 'v9-sdk', 'rules-copy.json');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

// ── 4. DER ECHTE RUHENDE V9-QUELLTEXT AUS index.html ─────────────────────────
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-ABLAUFSTEUERUNG ════');
if (START < 0 || ENDE < 0) { console.log('ABBRUCH: V9-Bereich nicht gefunden'); process.exit(5); }
const BEREICH = HTML.slice(START, ENDE);

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
  const M = new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
      'FB_ONLINE_BALL_IDX', 'serverNow', 'setTimeout', 'clearTimeout', 'sessionStorage', `
    ${BEREICH}
    return { fbV9Start, fbV9Resume, fbV9SecretFor, fbV9SecretClear, fbV9SecretLoad,
             fbV9SecretDrop, fbV9MakeCommit, fbV9MakeReveal, fbV9Hash, fbV9Hex,
             fbV9SaltFromHex, fbV9AcceptedSet, fbV9CommitsComplete, fbV9ResultsComplete,
             fbV9NetOpenTurn, fbV9NetWriteCommit, fbV9NetOpenReveal, fbV9NetWriteReveal,
             fbV9NetWriteLate, fbV9NetWriteNoReveal, fbV9EngineCtx,
             FB_V9_COMMITTED, FB_V9_EXISTS, FB_V9_DENIED, FB_V9_INVALID, FB_V9_ERROR,
             FB_V9_VALID, FB_V9_NO_REVEAL, FB_V9_OK, FB_V9_COMPLETE, FB_V9_FAILED,
             FB_V9_WAIT_COMMITS, FB_V9_WAIT_RESULTS };
  `)({ FB: { db: alsUid(uid), ref, runTransaction, onValue: zaehlendesOnValue,
             serverTimestamp } },
     globalThis.crypto, 10000, 5, 5, () => Date.now(), setT, clrT, st);
  M.fbV9SecretClear();
  const r = { uid: uid, M: M, st: st, timer: timer,
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

const UID = [0, 1].map(i => 'UID_E2E' + i + '_XXXXXXXXXXXXXXXX');
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
async function raum(code, cap) {
  if (!/^[A-HJKMNP-Z2-9]{4}$/.test(code)) throw new Error('Raumcode ausserhalb des Alphabets: ' + code);
  eigeneRaeume.add(code);
  if (ANGELEGT.indexOf(code) < 0) ANGELEGT.push(code);
  const p = {}, players = {};
  for (let i = 0; i < cap; i++) {
    p[i] = { s: 'E2ETAB' + i, on: true, t: Date.now() };
    players[i] = { id: 'E2EPID' + i, name: 'P' + i, tab: 'E2ETAB' + i, uid: UID[i] };
  }
  await seed('rooms/' + code, {
    v: 9, hostUid: UID[0],
    config: { game: 'football', winTarget: 3, fmt: 'elimination',
              visibility: 'private', mode: 'lives', cap: cap },
    gen: 0, state: 'playing', seats: cap, p: p, players: players, created: Date.now() - 60000 });
}
const raeumen = (code) => seed('rooms/' + code, null);
const ctx = (code, seat) => ({ v: 9, code: code, gen: 0, turn: 0, seat: seat, cap: 2,
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
  t('das Projekt ist eine Demo-Kennung (' + PROJEKT + ')', /^demo-/.test(PROJEKT));
  const a = md5(RULES_QUELLE), b = md5(RULES_KOPIE);
  t('die Regelkopie ist byte-identisch mit der verfolgten firebase.rules.json (' + a + ')',
    a === b && Buffer.compare(fs.readFileSync(RULES_QUELLE), fs.readFileSync(RULES_KOPIE)) === 0,
    a + ' / ' + b);
  const probe = await lies('.info');   // erreichbar?
  t('der Emulator antwortet', probe !== undefined);
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
