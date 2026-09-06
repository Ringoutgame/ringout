// V9.3B2A: der ruhende Firebase-Adapter - dauerhaft, ohne Emulator.
//
// Geprueft wird der ECHTE Quelltext aus index.html gegen eine deterministische
// Firebase-Attrappe. Die Attrappe bildet GENAU die vier Bausteine nach, die der
// Adapter benutzt (ref, runTransaction, onValue, serverTimestamp) - sie ist bewusst
// keine Firebase-Nachbildung und erst recht keine zweite Fassung der Rules. Wie sich
// der SERVER verhaelt, steht in tools/test_online_v9.js; hier geht es allein um das
// Verhalten des CLIENTS: welcher Pfad, welche Nutzlast, welches Ergebnis.
//
// Der Gate-Lauf darf weder Java noch einen Emulator noch das npm-Paket `firebase`
// voraussetzen - deshalb diese Suite. Der ergaenzende Beweis mit dem echten SDK gegen
// den Emulator liegt in tools/test_online_v9_sdk.js und wird ausdruecklich von Hand
// angestossen.
//   node test_online_v9_network.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));
function grab(re, was) {
  const m = HTML.match(re);
  if (!m) throw new Error('Region nicht gefunden: ' + was);
  return m[0];
}

// ── Die deterministische Attrappe ────────────────────────────────────────────
// Sie merkt sich jeden Aufruf, damit die Tests den TATSAECHLICH vorgeschlagenen
// Pfad und die TATSAECHLICH vorgeschlagene Nutzlast ansehen koennen - nicht das,
// was am Ende in einer Datenbank landet.
const SENTINEL = { '.sv': 'timestamp' };   // dasselbe Objekt, das Firebase sendet
function attrappe(vorbelegt) {
  const log = { schreib: [], hoert: [] };
  const stand = vorbelegt || {};            // Pfad -> vorhandener Wert (null = leer)
  let fehlerFuer = null;                     // Pfad -> Fehler, den runTransaction wirft
  return {
    log: log,
    setzeFehler: (pfad, e) => { fehlerFuer = { pfad: pfad, e: e }; },
    FB: {
      db: { ATTRAPPE: true },
      ref: (db, pfad) => ({ pfad: pfad, db: db }),
      serverTimestamp: () => SENTINEL,
      runTransaction: async (ref, fn, opts) => {
        if (fehlerFuer && (fehlerFuer.pfad === '*' || fehlerFuer.pfad === ref.pfad))
          throw fehlerFuer.e;
        const vorher = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        const vorschlag = fn(vorher);
        log.schreib.push({ pfad: ref.pfad, vorher: vorher, vorschlag: vorschlag, opts: opts });
        // `undefined` ist der Abbruch: der Knoten war belegt, es wird NICHT geschrieben.
        if (vorschlag === undefined)
          return { committed: false, snapshot: { val: () => vorher } };
        stand[ref.pfad] = vorschlag;
        return { committed: true, snapshot: { val: () => vorschlag } };
      },
      onValue: (ref, cb) => {
        const eintrag = { pfad: ref.pfad, cb: cb, offen: true };
        log.hoert.push(eintrag);
        return () => { eintrag.offen = false; };
      },
    },
  };
}
// Einen Schnappschuss an einen bestimmten Zuhoerer zustellen.
const stelleZu = (a, pfad, wert) => {
  for (const h of a.log.hoert) if (h.pfad === pfad && h.offen) h.cb({ val: () => wert });
};

// ── Den echten Adapter in eine Sandbox holen ─────────────────────────────────
const REGIONEN = [
  /const FB_V9_CODE_RE=[^\n]*/, /const FB_V9_HEX_SALT_RE=[^\n]*/,
  /const FB_V9_RESULTS=[^\n]*/, /function fbV9ResultOk\(rec\)\{[\s\S]*?\n\}/,
  /const FB_V9_COMMITTED='COMMITTED'[\s\S]*?FB_V9_ERROR='ERROR';/,
  /function fbV9CtxOk\(ctx\)\{[\s\S]*?\n\}/, /function fbV9Path\(ctx,rest\)\{[\s\S]*?\n\}/,
  /function fbV9Ref\(ctx,rest\)\{[\s\S]*?\n\}/,
  /async function fbV9WriteOnce\(ref,wert\)\{[\s\S]*?\n\}/,
  /async function fbV9NetOpenTurn\(ctx\)\{[\s\S]*?\n\}/,
  /async function fbV9NetWriteCommit\(ctx,terminal\)\{[\s\S]*?\n\}/,
  /async function fbV9NetOpenReveal\(ctx\)\{[\s\S]*?\n\}/,
  /async function fbV9NetWriteReveal\(ctx,reveal\)\{[\s\S]*?\n\}/,
  /function fbV9ZielOk\(ctx,ziel\)\{[\s\S]*?\n\}/,
  /async function fbV9NetWriteTerminal\(ctx,ziel,art\)\{[\s\S]*?\n\}/,
  /function fbV9NetWriteLate\(ctx,ziel\)\{[^\n]*/,
  /function fbV9NetWriteSkip\(ctx,ziel\)\{[^\n]*/,
  /function fbV9NetWriteRemove\(ctx,ziel\)\{[^\n]*/,
  /async function fbV9NetWriteNoReveal\(ctx,ziel\)\{[\s\S]*?\n\}/,
  /function fbV9NetListen\(ctx,rueckruf\)\{[\s\S]*?\n\}/,
];
const baue = (a) => new Function('window', 'GEN_MAX', 'FB_ONLINE_SEATS', `
  ${REGIONEN.map((r, i) => grab(r, 'Adapter ' + i)).join('\n')}
  return { fbV9CtxOk, fbV9NetOpenTurn, fbV9NetWriteCommit, fbV9NetOpenReveal,
           fbV9NetWriteReveal, fbV9NetListen, fbV9NetWriteLate,
           fbV9NetWriteSkip, fbV9NetWriteRemove, fbV9NetWriteNoReveal,
           FB_V9_COMMITTED, FB_V9_EXISTS, FB_V9_DENIED, FB_V9_INVALID, FB_V9_ERROR };
`)({ FB: a.FB }, 10000, 5);

const H64 = 'ab12'.repeat(16), H32 = '0123456789abcdef'.repeat(2);
const CTX = { v: 9, code: 'RN2K', gen: 7, turn: 42, seat: 1, cap: 3 };
const mit = (x) => Object.assign({}, CTX, x);
const REVEAL = { k: 'reveal', idx: 1, dx: 12.5, dy: -8.25, sp: 0.5, n: H32 };
const schluessel = (o) => Object.keys(o).sort().join(',');

console.log('=== V9.3B2A: der ruhende Firebase-Adapter (ohne Emulator) ===');

(async () => {

// ══ ZUSAMMENHANG ═════════════════════════════════════════════════════════════
abschnitt('Der Zusammenhang wird streng geprueft');
{
  const a = attrappe(), A = baue(a);
  t('ein gueltiger v9-Zusammenhang wird angenommen', A.fbV9CtxOk(CTX) === true);
  const schlecht = [
    ['v8 statt v9', { v: 8 }], ['ohne v', { v: undefined }],
    ['Raumcode kleingeschrieben', { code: 'rn2k' }], ['Raumcode zu kurz', { code: 'RN2' }],
    ['Raumcode mit Verwechslungszeichen', { code: 'RIN2' }], ['Raumcode keine Zeichenkette', { code: 7 }],
    ['negative Generation', { gen: -1 }], ['gebrochene Generation', { gen: 1.5 }],
    ['Generation ueber der Grenze', { gen: 10001 }],
    ['negativer Turn', { turn: -1 }], ['Turn ueber der Grenze', { turn: 10000 }],
    ['gebrochener Turn', { turn: 1.5 }],
    ['Sollbesetzung zu klein', { cap: 1 }], ['Sollbesetzung zu gross', { cap: 6 }],
    ['Sitz gleich der Sollbesetzung', { seat: 3 }], ['Sitz darueber', { seat: 4 }],
    ['negativer Sitz', { seat: -1 }], ['gebrochener Sitz', { seat: 1.5 }],
  ];
  for (const p of schlecht)
    t('abgewiesen: ' + p[0], A.fbV9CtxOk(mit(p[1])) === false);
  t('und gar kein Zusammenhang ebenso',
    A.fbV9CtxOk(null) === false && A.fbV9CtxOk('x') === false);
  // Ein ungueltiger Zusammenhang erreicht Firebase gar nicht erst.
  for (const fn of ['fbV9NetOpenTurn', 'fbV9NetOpenReveal'])
    t(fn + '() schreibt bei ungueltigem Zusammenhang nichts',
      (await A[fn](mit({ v: 8 }))).status === A.FB_V9_INVALID);
  t('und die Attrappe hat keinen einzigen Schreibvorgang gesehen', a.log.schreib.length === 0,
    a.log.schreib.length);
}

// ══ RUNDE EROEFFNEN ══════════════════════════════════════════════════════════
abschnitt('Runde eroeffnen: d/<turn>');
{
  const a = attrappe(), A = baue(a);
  const r = await A.fbV9NetOpenTurn(CTX);
  t('das Ergebnis ist COMMITTED', r.status === A.FB_V9_COMMITTED, r.status);
  const w = a.log.schreib[0];
  t('der Pfad ist rooms/<code>/g/<gen>/d/<turn>',
    w.pfad === 'rooms/RN2K/g/7/d/42', w.pfad);
  t('vorgeschlagen werden genau n und o', schluessel(w.vorschlag) === 'n,o', schluessel(w.vorschlag));
  t('n ist die Turnnummer', w.vorschlag.n === 42, w.vorschlag.n);
  t('o ist der Sentinel aus serverTimestamp()', w.vorschlag.o === SENTINEL);
  // Der springende Punkt: nirgends eine Clientuhr.
  t('und KEINE Zahl - also keine Clientuhr', typeof w.vorschlag.o !== 'number');
  t('die Transaktion laeuft mit applyLocally:false',
    w.opts && w.opts.applyLocally === false, JSON.stringify(w.opts));

  // Write-once: ist der Knoten belegt, wird NICHT geschrieben.
  const b = attrappe({ 'rooms/RN2K/g/7/d/42': { n: 42, o: 123 } }), B = baue(b);
  const r2 = await B.fbV9NetOpenTurn(CTX);
  t('ein belegter Knoten ergibt EXISTS', r2.status === B.FB_V9_EXISTS, r2.status);
  t('und der Vorschlag war der Abbruch', b.log.schreib[0].vorschlag === undefined);
  t('der bestehende Wert kommt zurueck', r2.wert && r2.wert.o === 123);
}

// ══ DAS ERGEBNISMODELL ═══════════════════════════════════════════════════════
abschnitt('Das Ergebnismodell - eine Abweisung ist nie ein Erfolg');
{
  for (const p of [['PERMISSION_DENIED', { code: 'PERMISSION_DENIED' }, 'DENIED'],
                   ['permission_denied', new Error('permission_denied'), 'DENIED'],
                   ['ein Netzfehler', new Error('network unreachable'), 'ERROR'],
                   ['etwas Unbenanntes', new Error(''), 'ERROR']]) {
    const a = attrappe(), A = baue(a);
    a.setzeFehler('*', p[1]);
    const r = await A.fbV9NetOpenTurn(CTX);
    t(p[0] + ' wird zu ' + p[2], r.status === p[2], r.status);
    t('und liefert keinen Wert', r.wert === null);
  }
  const a = attrappe(), A = baue(a);
  a.setzeFehler('*', new Error('permission_denied'));
  const r = await A.fbV9NetWriteCommit(CTX, { k: 'move', h: H64 });
  t('auch ein abgewiesener Commit ist DENIED, nicht COMMITTED',
    r.status === A.FB_V9_DENIED, r.status);
}

// ══ COMMIT ═══════════════════════════════════════════════════════════════════
abschnitt('Das eigene Terminal: c/<turn>/<seat>');
{
  const a = attrappe(), A = baue(a);
  const r = await A.fbV9NetWriteCommit(CTX, { k: 'move', h: H64 });
  t('COMMITTED', r.status === A.FB_V9_COMMITTED, r.status);
  const w = a.log.schreib[0];
  t('der Pfad ist rooms/<code>/g/<gen>/c/<turn>/<seat>',
    w.pfad === 'rooms/RN2K/g/7/c/42/1', w.pfad);
  t('vorgeschlagen werden genau k, h und ts', schluessel(w.vorschlag) === 'h,k,ts', schluessel(w.vorschlag));
  t('k ist move', w.vorschlag.k === 'move');
  t('h ist der uebergebene Hash', w.vorschlag.h === H64);
  t('ts ist der Sentinel', w.vorschlag.ts === SENTINEL);
  // DAS IST DER KERN: nichts vom Geheimnis darf den Client verlassen.
  for (const f of ['idx', 'dx', 'dy', 'sp', 'n', 'salt', 'secret'])
    t('kein ' + f + ' im Vorschlag', w.vorschlag[f] === undefined);
  t('der Vorschlag hat GENAU drei Felder', Object.keys(w.vorschlag).length === 3);

  const p = await baue(attrappe()).fbV9NetWriteCommit(CTX, { k: 'pass' });
  t('pass ist COMMITTED', p.status === A.FB_V9_COMMITTED, p.status);
  const a2 = attrappe(), A2 = baue(a2);
  await A2.fbV9NetWriteCommit(CTX, { k: 'pass' });
  const wp = a2.log.schreib[0];
  t('pass schlaegt genau k und ts vor', schluessel(wp.vorschlag) === 'k,ts', schluessel(wp.vorschlag));
  t('ohne Hash', wp.vorschlag.h === undefined);
  t('ohne Vektor', wp.vorschlag.dx === undefined && wp.vorschlag.idx === undefined);
  t('ohne Salz', wp.vorschlag.n === undefined);

  // Missgebildetes und die noch nicht zustaendigen Arten erreichen Firebase nie.
  const abgelehnt = [
    ['move ohne Hash', { k: 'move' }], ['Hash zu kurz', { k: 'move', h: H64.slice(0, 63) }],
    ['Hash grossgeschrieben', { k: 'move', h: H64.toUpperCase() }],
    ['Hash nicht hexadezimal', { k: 'move', h: 'z'.repeat(64) }],
    ['Hash keine Zeichenkette', { k: 'move', h: 123 }],
    ['skip - gehoert B2B', { k: 'skip' }], ['remove - gehoert B2B', { k: 'remove' }],
    ['late - gehoert B2B', { k: 'late' }], ['unbekannte Art', { k: 'was' }],
    ['ohne Art', { h: H64 }], ['kein Objekt', 'move'], ['null', null],
  ];
  for (const q of abgelehnt) {
    const ax = attrappe(), AX = baue(ax);
    const rx = await AX.fbV9NetWriteCommit(CTX, q[1]);
    t(q[0] + ' wird als INVALID abgewiesen', rx.status === AX.FB_V9_INVALID, rx.status);
    t('und gar nicht erst gesendet', ax.log.schreib.length === 0);
  }
  const b = attrappe({ 'rooms/RN2K/g/7/c/42/1': { k: 'pass', ts: 1 } }), B = baue(b);
  t('ein belegter Slot ergibt EXISTS',
    (await B.fbV9NetWriteCommit(CTX, { k: 'move', h: H64 })).status === B.FB_V9_EXISTS);
}

// ══ ENTHUELLUNG EROEFFNEN ════════════════════════════════════════════════════
abschnitt('Enthuellung eroeffnen: ro/<turn>');
{
  const a = attrappe(), A = baue(a);
  const r = await A.fbV9NetOpenReveal(CTX);
  t('COMMITTED', r.status === A.FB_V9_COMMITTED, r.status);
  const w = a.log.schreib[0];
  t('der Pfad ist rooms/<code>/g/<gen>/ro/<turn>', w.pfad === 'rooms/RN2K/g/7/ro/42', w.pfad);
  t('vorgeschlagen wird der blanke Sentinel', w.vorschlag === SENTINEL);
  t('also KEINE Clientuhr', typeof w.vorschlag !== 'number');
  t('und applyLocally:false', w.opts && w.opts.applyLocally === false);
  // Der Adapter prueft die Barriere NICHT selbst - massgeblich sind die Rules. Er
  // schreibt und meldet, was der Server sagt; ein lokales Vorurteil waere eine zweite
  // Wahrheit neben der einzigen, die zaehlt.
  const q = grab(/async function fbV9NetOpenReveal\(ctx\)\{[\s\S]*?\n\}/, 'fbV9NetOpenReveal');
  t('er enthaelt keine eigene Barrierenpruefung', q.indexOf('fbV9CommitsComplete') < 0);
  const b = attrappe({ 'rooms/RN2K/g/7/ro/42': 999 }), B = baue(b);
  t('ein belegter Anker ergibt EXISTS',
    (await B.fbV9NetOpenReveal(CTX)).status === B.FB_V9_EXISTS);
  t('ein ungueltiger Zusammenhang ergibt INVALID',
    (await A.fbV9NetOpenReveal(mit({ seat: 9 }))).status === A.FB_V9_INVALID);
}

// ══ ENTHUELLUNG SCHREIBEN ════════════════════════════════════════════════════
abschnitt('Enthuellung schreiben: r/<turn>/<seat>');
{
  const a = attrappe(), A = baue(a);
  const r = await A.fbV9NetWriteReveal(CTX, REVEAL);
  t('COMMITTED', r.status === A.FB_V9_COMMITTED, r.status);
  const w = a.log.schreib[0];
  t('der Pfad ist rooms/<code>/g/<gen>/r/<turn>/<seat>',
    w.pfad === 'rooms/RN2K/g/7/r/42/1', w.pfad);
  t('vorgeschlagen werden genau sieben Felder',
    schluessel(w.vorschlag) === 'dx,dy,idx,k,n,sp,ts', schluessel(w.vorschlag));
  t('der Vektor kommt unveraendert durch',
    w.vorschlag.idx === 1 && w.vorschlag.dx === 12.5 && w.vorschlag.dy === -8.25
    && w.vorschlag.sp === 0.5 && w.vorschlag.n === H32);
  t('ts ist der Sentinel', w.vorschlag.ts === SENTINEL);
  t('und kein zusaetzliches Feld schleicht sich ein',
    Object.keys(w.vorschlag).length === 7 && w.vorschlag.h === undefined);

  const abgelehnt = [
    ['noreveal - gehoert B2B', { k: 'noreveal' }],
    ['fremde Figur', Object.assign({}, REVEAL, { idx: 2 })],
    ['Salz zu kurz', Object.assign({}, REVEAL, { n: H32.slice(0, 31) })],
    ['Salz grossgeschrieben', Object.assign({}, REVEAL, { n: H32.toUpperCase() })],
    ['NaN im Vektor', Object.assign({}, REVEAL, { dx: NaN })],
    ['gebrochener Koerperindex', Object.assign({}, REVEAL, { idx: 1.5 })],
    ['unbekannte Art', Object.assign({}, REVEAL, { k: 'was' })],
    ['kein Objekt', 'reveal'], ['null', null],
  ];
  for (const q of abgelehnt) {
    const ax = attrappe(), AX = baue(ax);
    const rx = await AX.fbV9NetWriteReveal(CTX, q[1]);
    t(q[0] + ' wird als INVALID abgewiesen', rx.status === AX.FB_V9_INVALID, rx.status);
    t('und gar nicht erst gesendet', ax.log.schreib.length === 0);
  }
  const b = attrappe({ 'rooms/RN2K/g/7/r/42/1': { k: 'reveal' } }), B = baue(b);
  t('ein belegtes Ergebnis ergibt EXISTS',
    (await B.fbV9NetWriteReveal(CTX, REVEAL)).status === B.FB_V9_EXISTS);
}

// ══ ZUHOEREN ═════════════════════════════════════════════════════════════════
abschnitt('Zuhoeren und sauber abmelden');
{
  const a = attrappe(), A = baue(a);
  let letzter = null, zaehler = 0;
  const ab = A.fbV9NetListen(CTX, (st) => { letzter = st; zaehler++; });
  t('der Abmelder ist eine Funktion', typeof ab === 'function');
  t('es werden genau vier Knoten belauscht', a.log.hoert.length === 4, a.log.hoert.length);
  t('und zwar d, c, ro und r der laufenden Runde',
    a.log.hoert.map(h => h.pfad).sort().join(' ') ===
    'rooms/RN2K/g/7/c/42 rooms/RN2K/g/7/d/42 rooms/RN2K/g/7/r/42 rooms/RN2K/g/7/ro/42',
    a.log.hoert.map(h => h.pfad).join(' '));

  stelleZu(a, 'rooms/RN2K/g/7/d/42', { n: 42, o: 111 });
  t('der Rueckruf traegt turnOpen', letzter && letzter.turnOpen && letzter.turnOpen.o === 111);
  t('und die vier Felder der Projektion',
    schluessel(letzter) === 'commits,results,revealOpen,turnOpen', schluessel(letzter));
  stelleZu(a, 'rooms/RN2K/g/7/c/42', { 0: { k: 'move', h: H64, ts: 1 } });
  t('die Terminalkarte kommt an', letzter.commits && letzter.commits[0].k === 'move');
  t('und der vorige Stand bleibt erhalten', letzter.turnOpen.o === 111);
  stelleZu(a, 'rooms/RN2K/g/7/ro/42', 222);
  t('der Enthuellungsanker kommt an', letzter.revealOpen === 222);
  stelleZu(a, 'rooms/RN2K/g/7/r/42', { 0: { k: 'noreveal', ts: 2 } });
  t('die Ergebniskarte kommt an', letzter.results && letzter.results[0].k === 'noreveal');
  t('vier Zustellungen, vier Rueckrufe', zaehler === 4, zaehler);
  // Missgebildetes wird DURCHGEREICHT, nicht repariert - deuten tut die Maschine.
  stelleZu(a, 'rooms/RN2K/g/7/c/42', { 0: { k: 'quatsch' } });
  t('missgebildete Schnappschuesse werden unveraendert durchgereicht',
    letzter.commits[0].k === 'quatsch');

  const vorher = zaehler;
  ab();
  stelleZu(a, 'rooms/RN2K/g/7/d/42', { n: 42, o: 333 });
  t('nach dem Abmelden kommt kein Rueckruf mehr', zaehler === vorher, vorher + ' -> ' + zaehler);
  t('und alle vier Zuhoerer sind geschlossen', a.log.hoert.every(h => !h.offen));
  let heil = true; try { ab(); ab(); } catch (e) { heil = false; }
  t('mehrfaches Abmelden ist gefahrlos', heil === true);
  t('ein ungueltiger Zusammenhang liefert keinen Zuhoerer',
    A.fbV9NetListen(mit({ v: 8 }), () => {}) === null);
  t('und ohne Rueckruf ebenso', A.fbV9NetListen(CTX, null) === null);
  t('dabei entsteht kein zusaetzlicher Zuhoerer', a.log.hoert.length === 4, a.log.hoert.length);
}

// ══ DIE FRISTSCHLIESSER ══════════════════════════════════════════════════════
abschnitt('Die vier Fristschliesser');
{
  // Sie schliessen den Slot eines ANDEREN Sitzes - oder den eigenen. Deshalb nehmen
  // sie das Ziel getrennt entgegen: ctx.seat ist, WER schreibt, ziel ist, WESSEN
  // Slot geschlossen wird. Ueber die Frist entscheidet keiner von ihnen.
  for (const paar of [['fbV9NetWriteLate', 'late'], ['fbV9NetWriteSkip', 'skip'],
                      ['fbV9NetWriteRemove', 'remove']]) {
    const a = attrappe(), A2 = baue(a);
    const r = await A2[paar[0]](CTX, 2);
    t(paar[0] + ' meldet COMMITTED', r.status === A2.FB_V9_COMMITTED, r.status);
    const w = a.log.schreib[0];
    t(paar[1] + ': der Pfad nennt den ZIELsitz', w.pfad === 'rooms/RN2K/g/7/c/42/2', w.pfad);
    t(paar[1] + ': vorgeschlagen werden genau k und ts',
      schluessel(w.vorschlag) === 'k,ts', schluessel(w.vorschlag));
    t(paar[1] + ': mit der richtigen Zugart', w.vorschlag.k === paar[1]);
    t(paar[1] + ': ts ist der Sentinel', w.vorschlag.ts === SENTINEL);
    t(paar[1] + ': und KEINE Clientuhr', typeof w.vorschlag.ts !== 'number');
    t(paar[1] + ': applyLocally:false', w.opts && w.opts.applyLocally === false);
    t(paar[1] + ': kein Vektor, kein Salz, kein Hash',
      w.vorschlag.idx === undefined && w.vorschlag.dx === undefined
      && w.vorschlag.n === undefined && w.vorschlag.h === undefined);
  }
  {
    const a = attrappe(), A2 = baue(a);
    const r = await A2.fbV9NetWriteNoReveal(CTX, 2);
    t('fbV9NetWriteNoReveal meldet COMMITTED', r.status === A2.FB_V9_COMMITTED, r.status);
    const w = a.log.schreib[0];
    t('noreveal geht auf den ERGEBNISpfad', w.pfad === 'rooms/RN2K/g/7/r/42/2', w.pfad);
    t('noreveal: genau k und ts', schluessel(w.vorschlag) === 'k,ts');
    t('noreveal: die richtige Art', w.vorschlag.k === 'noreveal');
    t('noreveal: ts ist der Sentinel', w.vorschlag.ts === SENTINEL);
    t('noreveal: kein Vektor, kein Salz',
      w.vorschlag.idx === undefined && w.vorschlag.n === undefined);
  }
  {
    // Der eigene Slot laesst sich schliessen - kehrt ein allein verbliebener Client
    // nach der Frist zurueck, gaebe es sonst niemanden, der ihn schliesst.
    const a = attrappe(), A2 = baue(a);
    t('der eigene Slot laesst sich schliessen',
      (await A2.fbV9NetWriteLate(CTX, CTX.seat)).status === A2.FB_V9_COMMITTED);
    t('und der Pfad zeigt auf den eigenen Sitz',
      a.log.schreib[0].pfad === 'rooms/RN2K/g/7/c/42/1', a.log.schreib[0].pfad);
  }
  for (const fn of ['fbV9NetWriteLate', 'fbV9NetWriteSkip', 'fbV9NetWriteRemove',
                    'fbV9NetWriteNoReveal']) {
    const a = attrappe(), A2 = baue(a);
    for (const ziel of [3, 5, -1, 1.5, 'x', null, undefined])
      t(fn + ' weist das Ziel ' + ziel + ' ab',
        (await A2[fn](CTX, ziel)).status === A2.FB_V9_INVALID);
    t(fn + ' weist einen v8-Zusammenhang ab',
      (await A2[fn](mit({ v: 8 }), 2)).status === A2.FB_V9_INVALID);
    t(fn + ': dabei wird nichts gesendet', a.log.schreib.length === 0, a.log.schreib.length);
  }
  {
    const b = attrappe({ 'rooms/RN2K/g/7/c/42/2': { k: 'pass', ts: 1 } }), B2 = baue(b);
    t('ein belegter Slot ergibt EXISTS',
      (await B2.fbV9NetWriteLate(CTX, 2)).status === B2.FB_V9_EXISTS);
    const c = attrappe(), C2 = baue(c);
    c.setzeFehler('*', new Error('permission_denied'));
    t('eine Abweisung ergibt DENIED - nie Erfolg',
      (await C2.fbV9NetWriteSkip(CTX, 2)).status === C2.FB_V9_DENIED);
    const d = attrappe(), D2 = baue(d);
    d.setzeFehler('*', new Error('network down'));
    t('ein Netzfehler ergibt ERROR',
      (await D2.fbV9NetWriteNoReveal(CTX, 2)).status === D2.FB_V9_ERROR);
  }
  // Was die Schreiber ausdruecklich NICHT tun.
  const term = grab(/async function fbV9NetWriteTerminal\(ctx,ziel,art\)\{[\s\S]*?\n\}/, 'fbV9NetWriteTerminal');
  t('kein Schreiber setzt den Austragungsmarker', term.indexOf('/e/') < 0);
  t('und keiner prueft die Frist selbst - das tun die Rules',
    term.indexOf('6000') < 0 && term.indexOf('Date.now') < 0);
  t('move und pass gehoeren nicht zu den Fristschliessern',
    term.indexOf("'move'") < 0 && term.indexOf("'pass'") < 0);
  const nr = grab(/async function fbV9NetWriteNoReveal\(ctx,ziel\)\{[\s\S]*?\n\}/, 'noreveal');
  t('auch der noreveal-Schreiber prueft die Frist nicht selbst',
    nr.indexOf('6000') < 0 && nr.indexOf('Date.now') < 0 && nr.indexOf('/e/') < 0);
}
// ══ QUELLTEXT-WAECHTER ═══════════════════════════════════════════════════════
abschnitt('Waechter: der Adapter ruht');
{
  t('der freigegebene Client steht auf Protokoll 8',
    /const ONLINE_PROTOCOL_VERSION=8;/.test(HTML));
  const start = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
  // Der ruhende v9-Bereich endet seit V9.3B2B hinter der Ablaufsteuerung.
  const ende = HTML.indexOf('// ════ ENDE V9-ABLAUFSTEUERUNG ════');
  t('der ruhende v9-Bereich ist abgegrenzt', start > 0 && ende > start);
  const bereich = HTML.slice(start, ende);
  t('er enthaelt den Netzadapter', bereich.indexOf('function fbV9NetOpenTurn') > 0);
  t('ausserhalb nennt keine Zeile eine v9-Funktion',
    HTML.split(bereich).join('').indexOf('fbV9') < 0);
  // Die freigegebenen Netzfunktionen sind unveraendert v8.
  const NL = String.fromCharCode(10);
  for (const fn of ['onlineSendCommit', 'writeTurnSlot', 'onlineArmTurn', 'maybeReveal',
                    'processSlot', 'applyLaunch', 'allAliveCommitted'])
    t(fn + '() ruft keinen v9-Helfer',
      grab(new RegExp('function ' + fn + '\\([^)]*\\)\\{[\\s\\S]*?' + NL + '\\}'), fn)
        .indexOf('fbV9') < 0);
  const wts = grab(/function writeTurnSlot\(s,payload,opts\)\{[\s\S]*?\n\}/, 'writeTurnSlot');
  t('writeTurnSlot() schreibt weiterhin in den v8-Pfad t/',
    /'\/g\/'\+ctx\.gen\+'\/t\/'\+ctx\.turnNo\+'\/'\+s/.test(wts));
  t('und kennt keinen v9-Pfad',
    wts.indexOf("/c/'") < 0 && wts.indexOf("/ro/'") < 0 && wts.indexOf("/r/'") < 0);
  // Kein Produktweg legt einen v9-Raum an oder betritt einen.
  t('die Raumanlage schreibt weiterhin die Protokollkonstante',
    /v:ONLINE_PROTOCOL_VERSION/.test(HTML) || /v: *ONLINE_PROTOCOL_VERSION/.test(HTML));
  t('und nirgends eine feste 9 als Raumversion',
    HTML.indexOf('v:9') < 0 && HTML.indexOf('v: 9') < 0);
  for (const fn of ['validateRoom', 'validateRejoinRoom'])
    t(fn + '() prueft weiterhin gegen ONLINE_PROTOCOL_VERSION',
      grab(new RegExp('function ' + fn + '\\(d\\)\\{[\\s\\S]*?' + NL + '\\}'), fn)
        .indexOf('ONLINE_PROTOCOL_VERSION') > 0);
  // Der Adapter beruehrt keinen Spielzustand.
  const ohneText = bereich.split(NL).map(zl => { const k = zl.indexOf('//');
    return k >= 0 ? zl.slice(0, k) : zl; }).join(NL);
  for (const w of ['commitIdx', 'commitAim', 'commitSpin', 'aimSet', 'applyLaunch(',
                   'beginReveal', 'setPhase', 'turnNo', 'fbElimLives', 'gameOver'])
    t('der Bereich beruehrt ' + w + ' nicht', ohneText.indexOf(w) < 0);
  // B2C1 bringt die Schreiber - aber keinen Zeitgeber, keine Speicherung und keine
  // Spielfolge. Das kommt mit B2C2, B2C3 und der Aktivierung.
  // Der ADAPTER traegt weder Zeitgeber noch Speicherung. Die Weckrufe liegen seit
  // B2C2 in der Steuerung darueber - dort schaetzen sie, wann ein Versuch Aussicht
  // hat, und entscheiden nichts. Geprueft wird deshalb der Adapter fuer sich.
  const adapterEnde = HTML.indexOf('// ════ ENDE V9-NETZADAPTER ════');
  t('der Adapter ist fuer sich abgegrenzt', adapterEnde > start);
  // Erst am ROHTEXT schneiden, dann die Kommentare entfernen - die Endemarke ist
  // selbst ein Kommentar und waere sonst mit weggefallen.
  const adapterRoh = HTML.slice(start, adapterEnde);
  const adapter = adapterRoh.split(NL).map(zl => { const k = zl.indexOf('//');
    return k >= 0 ? zl.slice(0, k) : zl; }).join(NL);
  for (const w of ['setTimeout', 'setInterval', 'Date.now', 'serverNow',
                   'sessionStorage', 'localStorage', 'indexedDB'])
    t('kein ' + w + ' im Adapter', adapter.indexOf(w) < 0);
  for (const fn of ['fbV9NetWriteLate', 'fbV9NetWriteSkip', 'fbV9NetWriteRemove',
                    'fbV9NetWriteNoReveal'])
    t('der Schreiber ' + fn + ' liegt im ruhenden Bereich', bereich.indexOf(fn) > 0);
  // Und er wird noch von nirgendwo gerufen - auch nicht von der B2B-Steuerung.
  const steuerung = HTML.slice(HTML.indexOf('function fbV9Start(ctx,aktion)'), ende);
  for (const fn of ['fbV9NetWriteLate', 'fbV9NetWriteSkip', 'fbV9NetWriteRemove',
                    'fbV9NetWriteNoReveal'])
    t('die Steuerung ruft ' + fn + ' noch nicht - das ist B2C2',
      steuerung.indexOf(fn) < 0);
}

console.log('\nOnline-V9-Netz: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.log('AUSNAHME: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
