// V9.3B2A: der Beweis mit dem ECHTEN Firebase-JS-SDK gegen den lokalen Emulator.
//
// WARUM DIESE DATEI NICHT IM GATE STEHT: sie braucht drei Dinge, die eine Dauersuite
// nicht voraussetzen darf - eine Java-Laufzeit, einen laufenden Datenbank-Emulator und
// das npm-Paket `firebase`. Der Gate-Lauf muss auf jeder Maschine ohne Aufbau gruen
// sein. Deshalb liegt der Beweis hier als ausdruecklich anzustossender Lauf; die
// reihenfolge- und formbezogenen Zusicherungen des Adapters stehen dauerhaft in
// tools/test_online_v9_network.js.
//
// WAS HIER BEWIESEN WIRD - und was der frueheren REST-Probe fehlte:
// dass `runTransaction` des JS-SDK den Sentinel `serverTimestamp()` auch dann
// unaufgeloest an den Server reicht, wenn die SDK ihre Rueckruffunktion WIEDERHOLT.
// Eine REST- oder ETag-Probe kann das nicht zeigen: dort gibt es diese Schleife nicht.
//
// Aufruf (Emulator muss laufen):
//   cd artifacts/v9-sdk && firebase emulators:start --only database --project demo-v9sdk
//   node tools/test_online_v9_sdk.js
const path = require('path');
const fs = require('fs');

const HOST = '127.0.0.1', PORT = 9020, PROJEKT = 'demo-v9sdk';
let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; console.log('  [ok  ] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));

let SDK;
try {
  SDK = {
    app: require('firebase/app'),
    db: require('firebase/database'),
  };
} catch (e) {
  console.log('SDK fehlt: npm install --no-save firebase');
  process.exit(3);
}

const { initializeApp } = SDK.app;
const { getDatabase, connectDatabaseEmulator, ref, get, set, onValue,
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
// selbst, statt dass ein Testlauf sich seine Berechtigungen selbst ausstellt.
const zugaenge = {};
function alsUid(uid) {
  if (zugaenge[uid]) return zugaenge[uid];
  const app = initializeApp({ projectId: PROJEKT,
    databaseURL: 'http://' + HOST + ':' + PORT + '?ns=' + PROJEKT + '-default-rtdb' }, 'app_' + uid);
  const d = getDatabase(app);
  connectDatabaseEmulator(d, HOST, PORT, { mockUserToken: token(uid) });
  zugaenge[uid] = d;
  return d;
}
// Vorbefuellen laeuft unter Umgehung der Regeln - genau das, was ein Admin-Aufbau tut.
const REST = 'http://' + HOST + ':' + PORT;
const NS = PROJEKT + '-default-rtdb';
// Der Emulator erkennt Verwaltungszugriff am Bearer-Token `owner` - damit umgeht das
// Vorbefuellen die Regeln, genau wie ein Admin-Aufbau es taete. Alle SPIELENDEN
// Zugriffe weiter unten laufen dagegen als echte Nutzer durch die Regeln.
const ADMIN = { Authorization: 'Bearer owner' };
async function seed(pfad, wert) {
  const r = await fetch(REST + '/' + pfad + '.json?ns=' + NS,
    { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ADMIN),
      body: JSON.stringify(wert) });
  if (!r.ok) throw new Error('Seeding fehlgeschlagen: ' + r.status + ' ' + (await r.text()).slice(0, 120));
}
const lies = async (pfad) => {
  const r = await fetch(REST + '/' + pfad + '.json?ns=' + NS, { headers: ADMIN });
  return JSON.parse((await r.text()) || 'null');
};

// Der Adapter aus index.html - der ECHTE Quelltext, nicht nachgebaut.
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const g = (re, was) => { const m = HTML.match(re); if (!m) throw new Error('fehlt: ' + was); return m[0]; };
const ADAPTER = [
  /const FB_V9_CODE_RE=[^\n]*/, /const FB_V9_HEX_SALT_RE=[^\n]*/,
  /const FB_V9_RESULTS=[^\n]*/,
  /function fbV9ResultOk\(rec\)\{[\s\S]*?\n\}/,
  /const FB_V9_COMMITTED='COMMITTED'[\s\S]*?FB_V9_ERROR='ERROR';/,
  /function fbV9CtxOk\(ctx\)\{[\s\S]*?\n\}/, /function fbV9Path\(ctx,rest\)\{[\s\S]*?\n\}/,
  /function fbV9Ref\(ctx,rest\)\{[\s\S]*?\n\}/,
  /async function fbV9WriteOnce\(ref,wert\)\{[\s\S]*?\n\}/,
  /async function fbV9NetOpenTurn\(ctx\)\{[\s\S]*?\n\}/,
  /async function fbV9NetWriteCommit\(ctx,terminal\)\{[\s\S]*?\n\}/,
  /async function fbV9NetOpenReveal\(ctx\)\{[\s\S]*?\n\}/,
  /async function fbV9NetWriteReveal\(ctx,reveal\)\{[\s\S]*?\n\}/,
  /function fbV9NetListen\(ctx,rueckruf\)\{[\s\S]*?\n\}/,
];
const baueAdapter = (uid) => new Function('window', 'GEN_MAX', 'FB_ONLINE_SEATS', `
  ${ADAPTER.map((r, i) => g(r, 'Adapter ' + i)).join('\n')}
  return { fbV9CtxOk, fbV9NetOpenTurn, fbV9NetWriteCommit, fbV9NetOpenReveal,
           fbV9NetWriteReveal, fbV9NetListen, FB_V9_COMMITTED, FB_V9_EXISTS,
           FB_V9_DENIED, FB_V9_INVALID, FB_V9_ERROR };
`)({ FB: { db: alsUid(uid), ref, runTransaction, onValue, serverTimestamp } }, 10000, 5);

const H64 = 'ab12'.repeat(16), H32 = '0123456789abcdef'.repeat(2);
const UID = [0, 1, 2].map(i => 'UID_SDK' + i + '_XXXXXXXXXXXXXXXX');
const warte = (ms) => new Promise(r => setTimeout(r, ms));

// Ein laufender v9-Raum mit cap Sitzen, direkt vorbefuellt.
async function raum(code, cap) {
  const p = {}, players = {};
  for (let i = 0; i < cap; i++) {
    p[i] = { s: 'SDKTAB' + i, on: true, t: Date.now() };
    players[i] = { id: 'SDKPID' + i, name: 'P' + i, tab: 'SDKTAB' + i, uid: UID[i] };
  }
  await seed('rooms/' + code, {
    v: 9, hostUid: UID[0],
    config: { game: 'football', winTarget: 3, fmt: 'elimination',
              visibility: 'private', mode: 'lives', cap: cap },
    gen: 0, state: 'playing', seats: cap, p: p, players: players, created: Date.now() - 60000,
  });
}
const ctx = (code, cap, seat, turn) => ({ v: 9, code: code, gen: 0, turn: turn || 0, seat: seat, cap: cap });

(async () => {
  console.log('=== V9.3B2A: echtes Firebase-JS-SDK gegen den lokalen Emulator ===');
  console.log('    Regeln: die unveraenderte firebase.rules.json des Projekts\n');

  const A = baueAdapter(UID[0]), B = baueAdapter(UID[1]), C = baueAdapter(UID[2]);

  // ══ ZUSAMMENHANG ═══════════════════════════════════════════════════════════
  abschnitt('Der Zusammenhang wird streng geprueft');
  {
    t('ein v9-Zusammenhang wird angenommen', A.fbV9CtxOk(ctx('RN2K', 3, 0)) === true);
    t('ein v8-Zusammenhang wird abgewiesen',
      A.fbV9CtxOk(Object.assign(ctx('RN2K', 3, 0), { v: 8 })) === false);
    t('ein missgebildeter Raumcode wird abgewiesen',
      A.fbV9CtxOk(Object.assign(ctx('rn2k', 3, 0), {})) === false);
    t('ein Sitz jenseits der Sollbesetzung wird abgewiesen',
      A.fbV9CtxOk(ctx('RN2K', 3, 3)) === false);
    t('und eine unsinnige Sollbesetzung ebenso',
      A.fbV9CtxOk(ctx('RN2K', 6, 0)) === false && A.fbV9CtxOk(ctx('RN2K', 1, 0)) === false);
    const r = await A.fbV9NetOpenTurn(Object.assign(ctx('RN2K', 3, 0), { v: 8 }));
    t('und der Adapter schreibt in so einem Fall gar nicht erst', r.status === A.FB_V9_INVALID);
  }

  // ══ RUNDE EROEFFNEN ════════════════════════════════════════════════════════
  abschnitt('Die Runde eroeffnen: d/<turn> = {n,o}');
  await raum('SDKA', 3);
  {
    const c0 = ctx('SDKA', 3, 0);
    const r = await A.fbV9NetOpenTurn(c0);
    t('das SDK legt den Knoten an', r.status === A.FB_V9_COMMITTED, r.status + ' ' + (r.fehler || ''));
    const d = await lies('rooms/SDKA/g/0/d/0');
    t('n entspricht dem Pfadschluessel', d && d.n === 0, d && d.n);
    t('o ist eine SERVERaufgeloeste Zahl', typeof d.o === 'number' && Math.abs(d.o - Date.now()) < 120000, d.o);
    t('und KEIN unaufgeloester Sentinel', JSON.stringify(d).indexOf('.sv') < 0, JSON.stringify(d));
    const zweit = await B.fbV9NetOpenTurn(ctx('SDKA', 3, 1));
    t('ein zweiter Versuch ueberschreibt nichts', zweit.status === A.FB_V9_EXISTS, zweit.status);
    const d2 = await lies('rooms/SDKA/g/0/d/0');
    t('und der Wert bleibt unveraendert', d2.o === d.o);
    // Gleichzeitige Eroeffnung: genau ein Wert setzt sich durch.
    await raum('SDKB', 3);
    const gleich = await Promise.all([A.fbV9NetOpenTurn(ctx('SDKB', 3, 0)),
                                      B.fbV9NetOpenTurn(ctx('SDKB', 3, 1)),
                                      C.fbV9NetOpenTurn(ctx('SDKB', 3, 2))]);
    const dB = await lies('rooms/SDKB/g/0/d/0');
    t('bei drei gleichzeitigen Eroeffnungen steht genau ein Wert',
      typeof dB.o === 'number' && dB.n === 0, JSON.stringify(dB));
    t('und genau einer meldet COMMITTED',
      gleich.filter(x => x.status === A.FB_V9_COMMITTED).length === 1,
      gleich.map(x => x.status).join(','));
  }

  // ══ COMMIT ═════════════════════════════════════════════════════════════════
  abschnitt('Das eigene Terminal: c/<turn>/<seat>');
  {
    const c0 = ctx('SDKA', 3, 0);
    const r = await A.fbV9NetWriteCommit(c0, { k: 'move', h: H64 });
    t('ein move wird geschrieben', r.status === A.FB_V9_COMMITTED, r.status + ' ' + (r.fehler || ''));
    const w = await lies('rooms/SDKA/g/0/c/0/0');
    t('gespeichert sind GENAU k, h und ts',
      Object.keys(w).sort().join(',') === 'h,k,ts', Object.keys(w).join(','));
    t('ts ist serveraufgeloest', typeof w.ts === 'number' && Math.abs(w.ts - Date.now()) < 120000, w.ts);
    // DER KERN DER SACHE: nichts vom Geheimnis darf hier stehen.
    for (const f of ['idx', 'dx', 'dy', 'sp', 'n', 'salt'])
      t('kein ' + f + ' im gespeicherten Commit', w[f] === undefined);
    t('und im ganzen Datensatz kein Sentinel', JSON.stringify(w).indexOf('.sv') < 0);

    const p = await B.fbV9NetWriteCommit(ctx('SDKA', 3, 1), { k: 'pass' });
    t('ein pass wird geschrieben', p.status === A.FB_V9_COMMITTED, p.status + ' ' + (p.fehler || ''));
    const wp = await lies('rooms/SDKA/g/0/c/0/1');
    t('gespeichert sind GENAU k und ts', Object.keys(wp).sort().join(',') === 'k,ts', Object.keys(wp).join(','));

    const nochmal = await A.fbV9NetWriteCommit(c0, { k: 'move', h: H64 });
    t('ein zweites eigenes Terminal ueberschreibt nichts', nochmal.status === A.FB_V9_EXISTS, nochmal.status);
    // Fremdes Sitz-Terminal: die Rules weisen es ab - der Adapter macht daraus keinen Erfolg.
    const fremd = await C.fbV9NetWriteCommit(ctx('SDKA', 3, 2), { k: 'move', h: H64 });
    t('der eigene dritte Sitz darf', fremd.status === A.FB_V9_COMMITTED, fremd.status + ' ' + (fremd.fehler || ''));
    await raum('SDKC', 3);
    await A.fbV9NetOpenTurn(ctx('SDKC', 3, 0));
    const falsch = await B.fbV9NetWriteCommit(ctx('SDKC', 3, 0), { k: 'move', h: H64 });
    t('ein fremder Sitz wird von den Rules abgewiesen', falsch.status === A.FB_V9_DENIED,
      falsch.status + ' ' + (falsch.fehler || ''));
    // Missgebildete Bauformen erreichen Firebase gar nicht.
    for (const paar of [['unbekannte Zugart', { k: 'late' }], ['move ohne Hash', { k: 'move' }],
                        ['Hash in Grossschreibung', { k: 'move', h: H64.toUpperCase() }],
                        ['kein Objekt', 'move']])
      t('eine Bauform mit ' + paar[0] + ' wird gar nicht erst gesendet',
        (await A.fbV9NetWriteCommit(ctx('SDKC', 3, 1), paar[1])).status === A.FB_V9_INVALID);
  }

  // ══ ENTHUELLUNGSPHASE ══════════════════════════════════════════════════════
  abschnitt('Enthuellung eroeffnen und schreiben');
  {
    const vorBarriere = await A.fbV9NetOpenReveal(ctx('SDKC', 3, 0));
    t('vor vollstaendiger Commit-Barriere weisen die Rules ab',
      vorBarriere.status === A.FB_V9_DENIED, vorBarriere.status + ' ' + (vorBarriere.fehler || ''));

    const ro = await A.fbV9NetOpenReveal(ctx('SDKA', 3, 0));
    t('nach vollstaendiger Barriere wird eroeffnet', ro.status === A.FB_V9_COMMITTED,
      ro.status + ' ' + (ro.fehler || ''));
    const rov = await lies('rooms/SDKA/g/0/ro/0');
    t('der Anker ist eine serveraufgeloeste Zahl',
      typeof rov === 'number' && Math.abs(rov - Date.now()) < 120000, rov);
    const ro2 = await B.fbV9NetOpenReveal(ctx('SDKA', 3, 1));
    t('und laesst sich nicht ueberschreiben', ro2.status === A.FB_V9_EXISTS, ro2.status);

    const rev = { k: 'reveal', idx: 0, dx: 12.5, dy: -8.25, sp: 0.5, n: H32 };
    const w = await A.fbV9NetWriteReveal(ctx('SDKA', 3, 0), rev);
    t('der Sitzinhaber enthuellt', w.status === A.FB_V9_COMMITTED, w.status + ' ' + (w.fehler || ''));
    const gw = await lies('rooms/SDKA/g/0/r/0/0');
    t('gespeichert sind genau die sieben Felder',
      Object.keys(gw).sort().join(',') === 'dx,dy,idx,k,n,sp,ts', Object.keys(gw).join(','));
    t('ts ist serveraufgeloest', typeof gw.ts === 'number' && Math.abs(gw.ts - Date.now()) < 120000);
    t('und der Vektor kam unveraendert an',
      gw.idx === 0 && gw.dx === 12.5 && gw.dy === -8.25 && gw.sp === 0.5 && gw.n === H32);
    const nochmal = await A.fbV9NetWriteReveal(ctx('SDKA', 3, 0), rev);
    t('ein zweites Ergebnis ueberschreibt nichts', nochmal.status === A.FB_V9_EXISTS, nochmal.status);
    // Sitz 2 hat ebenfalls ein move committet und noch NICHT enthuellt - sein Slot ist
    // frei. Genau dort muss ein fremder Schreiber an den Rules scheitern (auf einem
    // schon belegten Slot gewaenne ohnehin write-once, das waere kein Eigentumsbeweis).
    const fremd = await B.fbV9NetWriteReveal(
      Object.assign(ctx('SDKA', 3, 2), {}), { k: 'reveal', idx: 2, dx: 1, dy: 1, sp: 0, n: H32 });
    t('ein fremder Sitz kann nicht enthuellen', fremd.status === A.FB_V9_DENIED,
      fremd.status + ' ' + (fremd.fehler || ''));
    // Sitz 1 hat pass committet - dort gibt es nichts zu enthuellen.
    const kein = await B.fbV9NetWriteReveal(ctx('SDKA', 3, 1),
      { k: 'reveal', idx: 1, dx: 1, dy: 1, sp: 0, n: H32 });
    t('nach einem pass weisen die Rules die Enthuellung ab', kein.status === A.FB_V9_DENIED,
      kein.status + ' ' + (kein.fehler || ''));
  }

  // ══ ZUHOEREN ═══════════════════════════════════════════════════════════════
  abschnitt('Zuhoeren und sauber abmelden');
  {
    let letzter = null, zaehler = 0;
    const ab = A.fbV9NetListen(ctx('SDKA', 3, 0), (st) => { letzter = st; zaehler++; });
    t('der Zuhoerer wird angelegt', typeof ab === 'function');
    await warte(700);
    t('er liefert den Rundenbeginn', letzter && letzter.turnOpen && letzter.turnOpen.n === 0);
    t('die Terminalkarte', letzter && letzter.commits && letzter.commits['0'] && letzter.commits['0'].k === 'move');
    t('den Enthuellungsanker', typeof (letzter && letzter.revealOpen) === 'number');
    t('und die Ergebniskarte', letzter && letzter.results && letzter.results['0'] && letzter.results['0'].k === 'reveal');
    const vorher = zaehler;
    ab();
    await seed('rooms/SDKA/g/0/c/0/9', { k: 'pass', ts: Date.now() });
    await warte(700);
    t('nach dem Abmelden kommt nichts mehr', zaehler === vorher, vorher + ' -> ' + zaehler);
    let zweitesMal = true;
    try { ab(); } catch (e) { zweitesMal = false; }
    t('ein zweites Abmelden ist gefahrlos', zweitesMal === true);
    t('ein ungueltiger Zusammenhang liefert keinen Zuhoerer',
      A.fbV9NetListen(Object.assign(ctx('SDKA', 3, 0), { v: 8 }), () => {}) === null);
  }

  // ══ WIEDERHOLUNG EINER SDK-TRANSAKTION - OFFEN ═════════════════════════════
  abschnitt('SDK-Wiederholung: was belegt ist und was nicht');
  {
    // BELEGT ist durch die Abschnitte oben, gegen die UNVERAENDERTEN Regeln:
    //   - runTransaction des JS-SDK reicht serverTimestamp() so weiter, dass der
    //     SERVER ihn aufloest: d/<turn>.o, c/<turn>/<seat>.ts, ro/<turn> und
    //     r/<turn>/<seat>.ts sind allesamt Zahlen, und in keinem Datensatz bleibt
    //     ein unaufgeloestes Sentinelobjekt stehen.
    //   - Bei DREI GLEICHZEITIGEN Transaktionen auf denselben Knoten setzt sich genau
    //     eine durch; die uebrigen durchlaufen die Konfliktbehandlung der SDK und
    //     melden EXISTS statt zu ueberschreiben.
    //
    // NICHT BELEGT, und ausdruecklich so benannt: eine Wiederholung, die DANACH NOCH
    // SCHREIBT und dabei einen Sentinel traegt. Der Grund ist strukturell - jeder
    // v9-Pfad ist write-once (cur==null?wert:undefined), eine Wiederholung bricht dort
    // also planmaessig ab, statt zu schreiben. Zwei Anlaeufe auf anderen Pfaden
    // scheiterten an den Regeln: ein beliebiger Hilfspfad ist unter rooms/<code> nicht
    // schreibbar ($other mit .validate false), und die Praesenz p/<seat> verlangt den
    // Reservieren/Armieren/Aktivieren-Ablauf mit passendem Token. Damit ist das
    // Sonderlimit von zwei Anlaeufen erreicht; ein dritter wird NICHT begonnen.
    //
    // Folge: fuer die vier v9-Schreibvorgaenge ist die Frage gegenstandslos, weil eine
    // Wiederholung dort nie schreibt. Fuer einen kuenftigen NICHT write-once-Pfad
    // bliebe sie offen und muesste dort eigens beantwortet werden.
    console.log('  [OFFEN] eine SCHREIBENDE SDK-Wiederholung mit Sentinel ist hier nicht');
    console.log('          herstellbar - alle v9-Pfade sind write-once. Siehe Kommentar.');
  }

  console.log('\nOnline-V9-SDK: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('AUSNAHME: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
