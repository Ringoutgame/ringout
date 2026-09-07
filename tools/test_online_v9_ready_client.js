// V9.4B2A: die ruhenden Bereitschaftsbausteine - dauerhaft, ohne Emulator.
//
// Geprueft wird der ECHTE Quelltext aus index.html gegen dieselbe deterministische
// Firebase-Attrappe wie in tools/test_online_v9_network.js. Wie sich der SERVER
// verhaelt, steht in tools/test_online_v9.js gegen die echte firebase.rules.json;
// hier geht es allein um das Verhalten des CLIENTS: welcher Pfad, welche Nutzlast,
// welches Ergebnis - und was die reinen Auswertungen aus einem autoritativen
// Schnappschuss machen.
//
// DIE ZWEI SAETZE, um die es hier geht:
//   1. Diese Schicht liest KEINE Uhr. Sie stellt keinen Zeitgeber, sie prueft keine
//      Frist. Ob ein Fristschluss zulaessig war, entscheiden allein die Rules; der
//      Client darf zu frueh fragen und bekommt dann ABGEWIESEN.
//   2. Ein Fristschluss ohne Disqualifikation befreit den Sitz NICHT. Sonst waere
//      eine einzelne Zeitueberschreitung eine stille Dauerbefreiung.
//   node test_online_v9_ready_client.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 58 - s.length)));

// ── Firebase-Attrappe ────────────────────────────────────────────────────────
// Genau die vier Bausteine, die der Adapter benutzt. Der Sentinel bleibt ein Objekt:
// so laesst sich zeigen, dass der SERVERzeitstempel unaufgeloest hinausgeht und nie
// eine Clientuhr an seine Stelle tritt.
const SENTINEL = { '.sv': 'timestamp' };
function attrappe(vorbelegt) {
  const log = { schreib: [], hoert: [] };
  const stand = Object.assign({}, vorbelegt || {});
  const fehler = {};
  return { log, stand,
    setzeFehler: (pfad, e) => { fehler[pfad] = e; },
    zustellen: (pfad, wert) => { stand[pfad] = wert;
      for (const h of log.hoert) if (h.pfad === pfad && h.offen) h.cb({ val: () => wert }); },
    FB: { db: {}, ref: (db, pfad) => ({ pfad }), serverTimestamp: () => SENTINEL,
      runTransaction: async (ref, fn, opts) => {
        const vorher = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        const vorschlag = fehler[ref.pfad] ? null : fn(vorher);
        log.schreib.push({ pfad: ref.pfad, vorschlag, opts });
        if (fehler[ref.pfad]) throw fehler[ref.pfad];
        if (vorschlag === undefined) return { committed: false, snapshot: { val: () => vorher } };
        stand[ref.pfad] = vorschlag;
        return { committed: true, snapshot: { val: () => vorschlag } };
      },
      onValue: (ref, cb) => {
        const e = { pfad: ref.pfad, cb, offen: true };
        log.hoert.push(e);
        const v = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        Promise.resolve().then(() => { if (e.offen) cb({ val: () => v }); });
        return () => { e.offen = false; };
      } } };
}

// Der echte Quelltext: Codec bis Ende des Netzadapters.
const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-NETZADAPTER ════');
if (START < 0 || ENDE < 0) { console.log('V9-Bereich nicht gefunden'); process.exit(2); }
const BEREICH = HTML.slice(START, ENDE);
const baue = (a) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
    'FB_ONLINE_BALL_IDX', `
  ${BEREICH}
  return { fbV9CtxOk, fbV9NetOpenStart, fbV9NetMarkComplete, fbV9NetWriteReady,
           fbV9NetWriteReadyTimeout, fbV9NetWriteDisqualify, fbV9NetWatch,
           fbV9NetListenReady, fbV9NetWriteRemove,
           fbV9StartAnchorOk, fbV9CompleteAnchorOk, fbV9ReadyTerminalOk,
           fbV9DisqualifyOk, fbV9ReadySeatState, fbV9ReadyComplete, fbV9ReadyAnchor,
           FB_V9_RS_READY, FB_V9_RS_TIMEOUT, FB_V9_RS_EVICTED, FB_V9_RS_DISQUALIFIED,
           FB_V9_RS_MISSING, FB_V9_RS_MALFORMED,
           FB_V9_COMMITTED, FB_V9_EXISTS, FB_V9_DENIED, FB_V9_INVALID, FB_V9_ERROR };
`)({ FB: a.FB }, globalThis.crypto, 10000, 5, 5);

const CTX = { v: 9, code: 'RN2K', gen: 7, turn: 42, seat: 1, cap: 3 };
const mit = (x) => Object.assign({}, CTX, x);
const P = (r) => 'rooms/RN2K/g/7/' + r;
const TS = 1788700000000;
const A_OK = { ts: TS };
const Q_READY = (n) => ({ k: 'ready', n, ts: TS });
const Q_TIME = (n) => ({ k: 'timeout', n, ts: TS });
const X_OK = (n) => ({ k: 'ready_timeout', n, ts: TS });
const ruhe = () => new Promise(r => setTimeout(r, 0));
const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await ruhe(); };

console.log('=== V9.4B2A: Bereitschaftsbausteine (ruhend) ===');

(async () => {

// ══ GENERATIONSSTART ═════════════════════════════════════════════════════════
abschnitt('Generationsstart  g/<gen>/s');
{
  const a = attrappe(), M = baue(a);
  const r = await M.fbV9NetOpenStart(CTX);
  const w = a.log.schreib[0];
  t('der Pfad ist g/<gen>/s', w.pfad === P('s'), w.pfad);
  t('die Nutzlast ist genau {ts}',
    JSON.stringify(Object.keys(w.vorschlag)) === '["ts"]', JSON.stringify(w.vorschlag));
  t('und der Zeitstempel ist der SERVERwert - keine Clientuhr',
    w.vorschlag.ts === SENTINEL, JSON.stringify(w.vorschlag.ts));
  t('geschrieben wird ohne lokale Vorwegnahme',
    w.opts && w.opts.applyLocally === false, JSON.stringify(w.opts));
  t('ein freier Knoten ergibt COMMITTED', r.status === M.FB_V9_COMMITTED, r.status);

  const b = attrappe({ [P('s')]: { ts: TS } }), M2 = baue(b);
  const r2 = await M2.fbV9NetOpenStart(CTX);
  t('ein belegter Knoten ergibt EXISTS', r2.status === M2.FB_V9_EXISTS, r2.status);
  t('und traegt den autoritativen Wert zurueck', r2.wert && r2.wert.ts === TS);

  const c = attrappe(); c.setzeFehler(P('s'), new Error('permission_denied'));
  const M3 = baue(c);
  t('eine Abweisung wird als ABGEWIESEN gemeldet',
    (await M3.fbV9NetOpenStart(CTX)).status === M3.FB_V9_DENIED);
  const d = attrappe(); d.setzeFehler(P('s'), new Error('network unreachable'));
  const M4 = baue(d);
  t('ein Netzfehler bleibt FEHLER', (await M4.fbV9NetOpenStart(CTX)).status === M4.FB_V9_ERROR);

  const M5 = baue(attrappe());
  for (const [name, c2] of [['v8', mit({ v: 8 })], ['Raumcode', mit({ code: 'rn2k' })],
                            ['Sitz jenseits der Sollbesetzung', mit({ seat: 3 })],
                            ['Sollbesetzung', mit({ cap: 9 })]])
    t('ein ungueltiger Zusammenhang (' + name + ') wird abgewiesen',
      (await M5.fbV9NetOpenStart(c2)).status === M5.FB_V9_INVALID);
  t('und dabei wird gar nicht erst geschrieben',
    baue(attrappe()) && (await (async () => { const z = attrappe(), Mz = baue(z);
      await Mz.fbV9NetOpenStart(mit({ v: 8 })); return z.log.schreib.length; })()) === 0);
}

// ══ PROTOKOLLABSCHLUSS ═══════════════════════════════════════════════════════
abschnitt('Protokollabschluss  g/<gen>/z/<turn>');
{
  const a = attrappe(), M = baue(a);
  const r = await M.fbV9NetMarkComplete(CTX);
  const w = a.log.schreib[0];
  t('der Pfad traegt die Runde', w.pfad === P('z/42'), w.pfad);
  t('die Nutzlast ist genau {ts}', JSON.stringify(Object.keys(w.vorschlag)) === '["ts"]');
  t('mit dem SERVERzeitstempel', w.vorschlag.ts === SENTINEL);
  t('ein freier Knoten ergibt COMMITTED', r.status === M.FB_V9_COMMITTED);
  const b = attrappe({ [P('z/42')]: { ts: TS } }), M2 = baue(b);
  t('ein belegter Knoten ergibt EXISTS',
    (await M2.fbV9NetMarkComplete(CTX)).status === M2.FB_V9_EXISTS);
  const M3 = baue(attrappe());
  t('eine unsinnige Runde wird abgewiesen',
    (await M3.fbV9NetMarkComplete(mit({ turn: -1 }))).status === M3.FB_V9_INVALID);
  // Die Vollstaendigkeit der Vorrunde prueft der SERVER. Der Client bildet sie nicht nach.
  const c = attrappe(), M4 = baue(c);
  await M4.fbV9NetMarkComplete(CTX);
  t('der Client prueft die Barriere NICHT selbst - er schreibt und laesst entscheiden',
    c.log.schreib.length === 1);
}

// ══ EIGENE BEREITSCHAFT ══════════════════════════════════════════════════════
abschnitt('Eigene Bereitschaft  g/<gen>/q/<turn>/<seat>');
{
  const a = attrappe(), M = baue(a);
  const r = await M.fbV9NetWriteReady(CTX);
  const w = a.log.schreib[0];
  t('der Pfad ist der EIGENE Sitz', w.pfad === P('q/42/1'), w.pfad);
  t('die Nutzlast ist genau {k,n,ts}',
    JSON.stringify(Object.keys(w.vorschlag).sort()) === '["k","n","ts"]', JSON.stringify(w.vorschlag));
  t('k ist ready', w.vorschlag.k === 'ready');
  t('n ist die Runde des Zusammenhangs', w.vorschlag.n === 42, w.vorschlag.n);
  t('ts ist der SERVERwert', w.vorschlag.ts === SENTINEL);
  t('COMMITTED wird durchgereicht', r.status === M.FB_V9_COMMITTED);
  // DIE ENTSCHEIDENDE EIGENSCHAFT: es GIBT kein Zielargument.
  t('die Schnittstelle nimmt kein Zielargument entgegen',
    M.fbV9NetWriteReady.length === 1, M.fbV9NetWriteReady.length);
  const b = attrappe(), M2 = baue(b);
  await M2.fbV9NetWriteReady(CTX, 2);       // ein zweites Argument bleibt wirkungslos
  t('ein untergeschobenes zweites Argument aendert den Pfad nicht',
    b.log.schreib[0].pfad === P('q/42/1'), b.log.schreib[0].pfad);
  const M3 = baue(attrappe());
  t('ein ungueltiger Zusammenhang wird abgewiesen',
    (await M3.fbV9NetWriteReady(mit({ v: 8 }))).status === M3.FB_V9_INVALID);
  const c = attrappe({ [P('q/42/1')]: Q_READY(42) }), M4 = baue(c);
  t('ein belegter Slot ergibt EXISTS',
    (await M4.fbV9NetWriteReady(CTX)).status === M4.FB_V9_EXISTS);
}

// ══ FRISTSCHLUSS ═════════════════════════════════════════════════════════════
abschnitt('Fristschluss  q/<turn>/<target>');
{
  const a = attrappe(), M = baue(a);
  const r = await M.fbV9NetWriteReadyTimeout(CTX, 2);
  const w = a.log.schreib[0];
  t('der Pfad traegt den ZIELsitz', w.pfad === P('q/42/2'), w.pfad);
  t('die Nutzlast ist genau {k,n,ts}',
    JSON.stringify(Object.keys(w.vorschlag).sort()) === '["k","n","ts"]');
  t('k ist timeout', w.vorschlag.k === 'timeout');
  t('n bleibt die Runde des Zusammenhangs', w.vorschlag.n === 42);
  t('ts ist der SERVERwert', w.vorschlag.ts === SENTINEL);
  t('COMMITTED wird durchgereicht', r.status === M.FB_V9_COMMITTED);
  const M2 = baue(attrappe());
  t('Sitz 0 ist ein gueltiges Ziel',
    (await M2.fbV9NetWriteReadyTimeout(CTX, 0)).status === M2.FB_V9_COMMITTED);
  const M3 = baue(attrappe());
  t('der letzte Sitz der Sollbesetzung ebenso',
    (await M3.fbV9NetWriteReadyTimeout(CTX, 2)).status === M3.FB_V9_COMMITTED);
  const M4 = baue(attrappe());
  for (const [name, ziel] of [['negativ', -1], ['jenseits der Sollbesetzung', 3],
                              ['weit daneben', 99], ['gebrochen', 1.5],
                              ['Zeichenkette', '1'], ['fehlend', undefined]])
    t('ein ungueltiges Ziel (' + name + ') wird abgewiesen',
      (await M4.fbV9NetWriteReadyTimeout(CTX, ziel)).status === M4.FB_V9_INVALID);
  // KEINE lokale Fristpruefung: der Baustein schreibt sofort und laesst den Server
  // entscheiden. Eine Abweisung kommt unveraendert zurueck.
  const b = attrappe(); b.setzeFehler(P('q/42/2'), new Error('permission_denied'));
  const M5 = baue(b);
  const r5 = await M5.fbV9NetWriteReadyTimeout(CTX, 2);
  t('zu frueh gerufen wird NICHT lokal abgefangen, sondern geschrieben',
    b.log.schreib.length === 1);
  t('und die Abweisung des Servers kommt unveraendert zurueck',
    r5.status === M5.FB_V9_DENIED, r5.status);
}

// ══ DISQUALIFIKATION ═════════════════════════════════════════════════════════
abschnitt('Disqualifikation  g/<gen>/x/<target>');
{
  const a = attrappe(), M = baue(a);
  const r = await M.fbV9NetWriteDisqualify(CTX, 2);
  const w = a.log.schreib[0];
  t('der Pfad ist x/<target> - ohne Runde', w.pfad === P('x/2'), w.pfad);
  t('die Nutzlast ist genau {k,n,ts}',
    JSON.stringify(Object.keys(w.vorschlag).sort()) === '["k","n","ts"]');
  t('k ist ready_timeout', w.vorschlag.k === 'ready_timeout');
  t('n ist die Runde, in der die Frist verstrich', w.vorschlag.n === 42);
  t('ts ist der SERVERwert', w.vorschlag.ts === SENTINEL);
  t('COMMITTED wird durchgereicht', r.status === M.FB_V9_COMMITTED);
  const M2 = baue(attrappe());
  for (const ziel of [-1, 3, 1.5, '2'])
    t('ein ungueltiges Ziel (' + ziel + ') wird abgewiesen',
      (await M2.fbV9NetWriteDisqualify(CTX, ziel)).status === M2.FB_V9_INVALID);
  // Der Client setzt NICHT voraus, den Fristschluss selbst gesehen zu haben.
  const b = attrappe(), M3 = baue(b);
  await M3.fbV9NetWriteDisqualify(CTX, 2);
  t('ohne lokalen Fristschluss wird trotzdem geschrieben - der Server entscheidet',
    b.log.schreib.length === 1 && b.log.schreib[0].pfad === P('x/2'));
  const c = attrappe({ [P('x/2')]: X_OK(42) }), M4 = baue(c);
  t('ein belegter Knoten ergibt EXISTS',
    (await M4.fbV9NetWriteDisqualify(CTX, 2)).status === M4.FB_V9_EXISTS);
}

// ══ PRUEFUNGEN ═══════════════════════════════════════════════════════════════
abschnitt('Reine Pruefungen der autoritativen Formen');
{
  const M = baue(attrappe());
  t('ein gueltiger Startanker', M.fbV9StartAnchorOk(A_OK) === true);
  for (const [name, v] of [['null', null], ['Zahl', 5], ['leer', {}],
                           ['ts fehlt', { x: 1 }], ['ts keine Zahl', { ts: 'x' }],
                           ['Zusatzfeld', { ts: TS, k: 'a' }]])
    t('ein missgebildeter Startanker (' + name + ')', M.fbV9StartAnchorOk(v) === false);
  t('ein gueltiger Abschlussanker', M.fbV9CompleteAnchorOk(A_OK) === true);
  t('ein missgebildeter Abschlussanker', M.fbV9CompleteAnchorOk({ ts: TS, n: 1 }) === false);

  t('eine gueltige Bereitschaft', M.fbV9ReadyTerminalOk(Q_READY(42), 42) === true);
  t('ein gueltiger Fristschluss', M.fbV9ReadyTerminalOk(Q_TIME(42), 42) === true);
  t('eine Meldung mit falscher Rundenzahl zaehlt nicht',
    M.fbV9ReadyTerminalOk(Q_READY(41), 42) === false);
  for (const [name, v] of [['null', null], ['unbekanntes k', { k: 'settled', n: 42, ts: TS }],
                           ['n fehlt', { k: 'ready', ts: TS }],
                           ['n gebrochen', { k: 'ready', n: 42.5, ts: TS }],
                           ['ts fehlt', { k: 'ready', n: 42 }],
                           ['Zusatzfeld', { k: 'ready', n: 42, ts: TS, w: 1 }]])
    t('eine missgebildete Meldung (' + name + ')', M.fbV9ReadyTerminalOk(v, 42) === false);

  t('eine gueltige Disqualifikation', M.fbV9DisqualifyOk(X_OK(0)) === true);
  t('auch aus einer spaeteren Runde', M.fbV9DisqualifyOk(X_OK(9999)) === true);
  for (const [name, v] of [['null', null], ['falsches k', { k: 'timeout', n: 0, ts: TS }],
                           ['n negativ', { k: 'ready_timeout', n: -1, ts: TS }],
                           ['n gebrochen', { k: 'ready_timeout', n: 1.5, ts: TS }],
                           ['ts fehlt', { k: 'ready_timeout', n: 0 }],
                           ['Zusatzfeld', { k: 'ready_timeout', n: 0, ts: TS, s: 1 }]])
    t('eine missgebildete Disqualifikation (' + name + ')', M.fbV9DisqualifyOk(v) === false);
}

// ══ EINSTUFUNG UND BARRIERE ══════════════════════════════════════════════════
abschnitt('Einstufung je Sitz und die Barriere');
{
  const M = baue(attrappe());
  const S = (q, e, x) => M.fbV9ReadySeatState(42, q, e, x);
  t('gemeldet', S(Q_READY(42), undefined, undefined) === M.FB_V9_RS_READY);
  t('Frist verstrichen, aber noch nicht disqualifiziert',
    S(Q_TIME(42), undefined, undefined) === M.FB_V9_RS_TIMEOUT);
  t('ausgetragen', S(undefined, true, undefined) === M.FB_V9_RS_EVICTED);
  t('disqualifiziert', S(undefined, undefined, X_OK(0)) === M.FB_V9_RS_DISQUALIFIED);
  t('nichts da', S(undefined, undefined, undefined) === M.FB_V9_RS_MISSING);
  t('missgebildet', S({ k: 'ready' }, undefined, undefined) === M.FB_V9_RS_MALFORMED);
  t('eine Meldung der falschen Runde ist missgebildet',
    S(Q_READY(41), undefined, undefined) === M.FB_V9_RS_MALFORMED);
  t('eine gueltige Disqualifikation schlaegt alles andere',
    S(Q_TIME(42), undefined, X_OK(0)) === M.FB_V9_RS_DISQUALIFIED);
  t('ein Austragungsmarker ebenso - auch neben einem unbrauchbaren x',
    S(undefined, true, { k: 'quatsch' }) === M.FB_V9_RS_EVICTED);
  t('ein unbrauchbares x allein ist missgebildet',
    S(Q_READY(42), undefined, { k: 'quatsch' }) === M.FB_V9_RS_MALFORMED);

  const B = (cap, q, e, x) => M.fbV9ReadyComplete(cap, 42, q, e, x);
  const alle = (n, w) => { const o = {}; for (let i = 0; i < n; i++) o[i] = w(i); return o; };
  t('alle gemeldet', B(3, alle(3, () => Q_READY(42))) === true);
  t('einer fehlt', B(3, alle(2, () => Q_READY(42))) === false);
  t('ein Ausgetragener braucht keine Meldung',
    B(3, alle(2, () => Q_READY(42)), { 2: true }) === true);
  t('ein Disqualifizierter ebenso',
    B(3, alle(2, () => Q_READY(42)), null, { 2: X_OK(0) }) === true);
  // DER KERN: ein Fristschluss allein befreit NICHT.
  const mitFrist = Object.assign(alle(2, () => Q_READY(42)), { 2: Q_TIME(42) });
  t('ein Fristschluss OHNE Disqualifikation befreit nicht', B(3, mitFrist) === false);
  t('erst zusammen mit der Disqualifikation', B(3, mitFrist, null, { 2: X_OK(42) }) === true);
  t('eine missgebildete Disqualifikation befreit nicht',
    B(3, mitFrist, null, { 2: { k: 'ready_timeout' } }) === false);
  t('eine Meldung der falschen Runde zaehlt nicht',
    B(3, Object.assign(alle(2, () => Q_READY(42)), { 2: Q_READY(41) })) === false);
  t('cap 2: zwei Meldungen reichen', B(2, alle(2, () => Q_READY(42))) === true);
  t('cap 5: vier reichen nicht', B(5, alle(4, () => Q_READY(42))) === false);
  t('cap 5: fuenf reichen', B(5, alle(5, () => Q_READY(42))) === true);
  // Gezaehlt wird ueber die Sollbesetzung, NIE ueber die Zahl der Kinder.
  t('ein Eintrag ausserhalb der Sollbesetzung ersetzt keinen fehlenden Sitz',
    B(3, Object.assign(alle(2, () => Q_READY(42)), { 4: Q_READY(42), foo: Q_READY(42) })) === false);
  t('eine unsinnige Sollbesetzung ergibt false',
    B(1, alle(1, () => Q_READY(42))) === false && B(9, alle(9, () => Q_READY(42))) === false);
  t('eine unsinnige Runde ebenso',
    M.fbV9ReadyComplete(3, -1, alle(3, () => Q_READY(-1))) === false);
}

// ══ FRISTANKER ═══════════════════════════════════════════════════════════════
abschnitt('Fristanker - welcher SERVERwert gilt');
{
  const M = baue(attrappe());
  t('Runde 0 haengt am Generationsstart', M.fbV9ReadyAnchor(0, A_OK, null) === TS);
  t('ohne Generationsstart gibt es keinen Anker', M.fbV9ReadyAnchor(0, null, A_OK) === null);
  t('ein missgebildeter Generationsstart ergibt keinen Anker',
    M.fbV9ReadyAnchor(0, { ts: 'x' }, null) === null);
  t('spaetere Runden haengen am Abschluss der Vorrunde',
    M.fbV9ReadyAnchor(5, A_OK, { ts: TS + 1000 }) === TS + 1000);
  t('ohne diesen Abschluss gibt es keinen Anker', M.fbV9ReadyAnchor(5, A_OK, null) === null);
  t('ein missgebildeter Abschluss ebenso',
    M.fbV9ReadyAnchor(5, A_OK, { ts: TS, n: 4 }) === null);
  t('eine unsinnige Runde ergibt keinen Anker',
    M.fbV9ReadyAnchor(-1, A_OK, A_OK) === null && M.fbV9ReadyAnchor(1.5, A_OK, A_OK) === null);
  // Der Anker ist ein SERVERwert, kein gerechneter. Die Funktion addiert nichts.
  t('der Anker wird unveraendert durchgereicht - nichts wird addiert',
    M.fbV9ReadyAnchor(0, { ts: 12345 }, null) === 12345);
}

// ══ ZUHOEREN ═════════════════════════════════════════════════════════════════
abschnitt('Zuhoeren auf der Bereitschaftslage');
{
  const a = attrappe({ [P('s')]: { ts: TS } }), M = baue(a);
  let letzter = null, rufe = 0;
  const ab = M.fbV9NetListenReady(CTX, st => { letzter = st; rufe++; });
  await settle();
  const pfade = a.log.hoert.map(h => h.pfad).sort();
  t('es wird auf dem Generationsstart gehoert', pfade.indexOf(P('s')) >= 0);
  t('auf der Bereitschaft dieser Runde', pfade.indexOf(P('q/42')) >= 0);
  t('auf den Disqualifikationen', pfade.indexOf(P('x')) >= 0);
  t('auf den Austragungen', pfade.indexOf(P('e')) >= 0);
  t('und auf dem Abschluss der VORRUNDE', pfade.indexOf(P('z/41')) >= 0, pfade.join(','));
  t('genau fuenf Zuhoerer, kein sechster', a.log.hoert.length === 5, a.log.hoert.length);
  t('der Stand traegt den autoritativen Generationsstart',
    letzter && letzter.start && letzter.start.ts === TS, JSON.stringify(letzter));
  a.zustellen(P('q/42'), { 0: Q_READY(42) });
  await settle();
  t('ein Schnappschuss auf der Bereitschaft erreicht den Rueckruf',
    letzter.bereit && letzter.bereit[0] && letzter.bereit[0].k === 'ready');
  const vorher = rufe;
  ab();
  a.zustellen(P('q/42'), { 0: Q_READY(42), 1: Q_READY(42) });
  await settle();
  t('nach dem Abmelden schweigt er', rufe === vorher, rufe + '/' + vorher);
  ab(); ab();
  t('mehrfaches Abmelden ist gefahrlos', rufe === vorher);
  // Runde 0 hat keine Vorrunde - also auch keinen Zuhoerer darauf.
  const b = attrappe(), M2 = baue(b);
  const ab2 = M2.fbV9NetListenReady(mit({ turn: 0 }), () => {});
  await settle();
  t('in Runde 0 gibt es keinen Vorrunden-Zuhoerer',
    b.log.hoert.length === 4 && !b.log.hoert.some(h => h.pfad.indexOf('/z/') >= 0),
    b.log.hoert.map(h => h.pfad).join(','));
  ab2();
  const M3 = baue(attrappe());
  t('ein ungueltiger Zusammenhang ergibt keinen Zuhoerer',
    M3.fbV9NetListenReady(mit({ v: 8 }), () => {}) === null);
  t('und ein fehlender Rueckruf ebenso',
    M3.fbV9NetWatch(CTX, [['s', 'start']], null) === null);
  t('eine leere Wegeliste ebenso', M3.fbV9NetWatch(CTX, [], () => {}) === null);
}

// ══ WAECHTER AM QUELLTEXT ════════════════════════════════════════════════════
abschnitt('Waechter');
{
  const AB_ROH = HTML.slice(HTML.indexOf('// ── V9.4 BEREITSCHAFT'),
                            HTML.indexOf('// ════ ENDE V9-NETZADAPTER ════'));
  // Geprueft wird der CODE, nicht die Prosa: die Kommentare dieser Schicht benennen
  // ausdruecklich, was sie NICHT benutzt - eine Suche ueber den Rohtext faende genau
  // diese Verneinungen und meldete sie als Fund.
  const AB = AB_ROH.split(/\r?\n/).filter(z => !/^\s*\/\//.test(z)).join('\n');
  t('der ausgelieferte Client steht auf 9',
    HTML.indexOf('const ONLINE_PROTOCOL_VERSION=9;') >= 0);
  t('die Bereitschaftsschicht liest KEINE Uhr',
    AB.indexOf('Date.now') < 0 && AB.indexOf('serverNow') < 0, 'Uhr gefunden');
  t('sie stellt keinen Zeitgeber',
    AB.indexOf('setTimeout') < 0 && AB.indexOf('setInterval') < 0);
  t('sie bindet nichts an onlineTab oder onlinePid',
    AB.indexOf('onlineTab') < 0 && AB.indexOf('onlinePid') < 0);
  t('sie bindet nichts an das Praesenztoken',
    AB.indexOf("p/'+") < 0 && AB.indexOf("'p/'") < 0);
  t('sie benutzt keinen dauerhaften Speicher',
    AB.indexOf('sessionStorage') < 0 && AB.indexOf('localStorage') < 0);
  t('sie ruehrt kein Spiel an',
    AB.indexOf('applyLaunch') < 0 && AB.indexOf('stepSim') < 0 &&
    AB.indexOf('onlineArmTurn') < 0 && AB.indexOf('fbElim') < 0);
  t('jeder Zeitstempel geht als SERVERwert hinaus',
    (AB.match(/serverTimestamp\(\)/g) || []).length === 5,
    (AB.match(/serverTimestamp\(\)/g) || []).length);
  t('es gibt genau einen remove-Baustein im ganzen Produkt',
    (HTML.match(/function fbV9NetWriteRemove/g) || []).length === 1);
  t('die Bereitschaftsschicht schreibt selbst kein remove',
    AB.indexOf("'remove'") < 0);
  // Die Ablaufsteuerung ist von dieser Stufe NICHT angefasst worden.
  const STEUER = HTML.slice(HTML.indexOf('// ════ V9-ABLAUFSTEUERUNG'),
                            HTML.indexOf('// ════ ENDE V9-ABLAUFSTEUERUNG ════'));
  t('keine Ablaufsteuerung fuer die Bereitschaft',
    STEUER.indexOf('fbV9NetWriteReady') < 0 && STEUER.indexOf('fbV9ReadyComplete') < 0);
  // Und das Produkt selbst hat v9 nirgends begonnen.
  const REST = HTML.slice(HTML.indexOf('// ════ ENDE V9-SPIELANBINDUNG ════'));
  t('das Produkt ruft keinen Bereitschaftsbaustein auf',
    REST.indexOf('fbV9NetWriteReady') < 0 && REST.indexOf('fbV9NetOpenStart') < 0 &&
    REST.indexOf('fbV9NetListenReady') < 0);
}

console.log('\nOnline-V9-Bereitschaft: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})().catch(e => { console.log('ABBRUCH: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
