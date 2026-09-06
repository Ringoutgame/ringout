// V9.3B2B: die ruhende Ablaufsteuerung - Commit bis geprüfte Zugmenge.
//
// Geprueft wird der ECHTE Quelltext aus index.html: Codec, Protokollmaschine, Netz-
// adapter und Steuerung werden herausgeschnitten und ueber einer deterministischen
// Firebase-Attrappe ausgefuehrt. Kein Emulator, kein Netz, kein npm-Firebase - der
// Gate-Lauf muss auf jeder Maschine ohne Aufbau gruen sein.
//
// AUSDRUECKLICH NUR DER GUTE FALL: keine Fristen, keine Zeitgeber, keine Sentinel-
// Schreiber. Committet ein Sitz nie, wartet die Steuerung - das ist in dieser Stufe
// die richtige Antwort. Und sie endet bei der geprueften Zugmenge: kein applyLaunch,
// kein Spielzustand, keine Folge fuer eine ausgebliebene oder falsche Enthuellung.
//   node test_online_v9_coordinator.js
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

// ── Attrappe: nur die vier benutzten Bausteine ───────────────────────────────
const SENTINEL = { '.sv': 'timestamp' };
function attrappe(vorbelegt) {
  const log = { schreib: [], hoert: [] };
  const stand = Object.assign({}, vorbelegt || {});
  const fehler = {};                       // Pfad -> Fehler, den runTransaction wirft
  const api = {
    log: log, stand: stand,
    setzeFehler: (pfad, e) => { fehler[pfad] = e; },
    // Einen Schnappschuss an alle offenen Zuhoerer dieses Pfads zustellen.
    zustellen: (pfad, wert) => {
      stand[pfad] = wert;
      for (const h of log.hoert) if (h.pfad === pfad && h.offen) h.cb({ val: () => wert });
    },
    FB: {
      db: {},
      ref: (db, pfad) => ({ pfad: pfad }),
      serverTimestamp: () => SENTINEL,
      runTransaction: async (ref, fn, opts) => {
        if (fehler[ref.pfad]) throw fehler[ref.pfad];
        const vorher = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        const vorschlag = fn(vorher);
        log.schreib.push({ pfad: ref.pfad, vorschlag: vorschlag });
        if (vorschlag === undefined) return { committed: false, snapshot: { val: () => vorher } };
        // Der Serversentinel wird beim Speichern zu einer Zahl - wie in Firebase.
        const gespeichert = JSON.parse(JSON.stringify(vorschlag,
          (k, v) => (v && v['.sv'] === 'timestamp') ? 1788700000000 : v));
        stand[ref.pfad] = gespeichert;
        // Wie das echte Firebase: ein erfolgreicher Schreibvorgang erreicht die
        // Zuhoerer. Ohne das waere die Attrappe unehrlich - der Ablauf haengt genau
        // daran, dass der eigene Schreibvorgang als AUTORITATIVER Stand zurueckkommt.
        Promise.resolve().then(() => {
          for (const h of log.hoert) if (h.pfad === ref.pfad && h.offen) h.cb({ val: () => gespeichert });
        });
        return { committed: true, snapshot: { val: () => gespeichert } };
      },
      onValue: (ref, cb) => {
        const e = { pfad: ref.pfad, cb: cb, offen: true };
        log.hoert.push(e);
        // Firebase liefert sofort den aktuellen Stand.
        const v = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        Promise.resolve().then(() => { if (e.offen) cb({ val: () => v }); });
        return () => { e.offen = false; };
      },
    },
  };
  return api;
}

// ── Den echten Quelltext in eine Sandbox holen ───────────────────────────────
const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-ABLAUFSTEUERUNG ════');
if (START < 0 || ENDE < START) throw new Error('der ruhende v9-Bereich fehlt');
const BEREICH = HTML.slice(START, ENDE);
const baue = (a) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
                                'FB_ONLINE_BALL_IDX', `
  ${BEREICH}
  return { fbV9Start, fbV9CtxOk, fbV9MakeCommit, fbV9MakeReveal, fbV9SecretFor,
           fbV9SecretClear, fbV9Hash, fbV9Hex, fbV9AcceptedSet, fbV9EngineCtx,
           FB_V9_IDLE, FB_V9_OPENING, FB_V9_COMMITTING, FB_V9_WAIT_COMMITS,
           FB_V9_OPENING_REVEAL, FB_V9_REVEALING, FB_V9_WAIT_RESULTS,
           FB_V9_COMPLETE, FB_V9_FAILED, FB_V9_STOPPED,
           FB_V9_VALID, FB_V9_MISMATCH, FB_V9_MALFORMED, FB_V9_NO_REVEAL };
`)({ FB: a.FB }, globalThis.crypto, 10000, 5, 5);

const H64 = 'ab12'.repeat(16), H32 = '0123456789abcdef'.repeat(2);
const CTX = { v: 9, code: 'RN2K', gen: 7, turn: 42, seat: 1, cap: 3 };
const mit = (x) => Object.assign({}, CTX, x);
const P = (rest) => 'rooms/RN2K/g/7/' + rest;
const ZUG = { idx: 1, dx: 12.5, dy: -8.25, sp: 0.5 };
const ruhe = () => new Promise(r => setTimeout(r, 0));
// Mehrere Mikroschritte abwarten: die Steuerung arbeitet in Ketten von Zusagen.
const settle = async (n) => { for (let i = 0; i < (n || 12); i++) await ruhe(); };
const NULLT = (k) => ({ k: k, ts: 1 });

console.log('=== V9.3B2B: die ruhende Ablaufsteuerung ===');

(async () => {

// ══ NULLHANDLUNG: DER GANZE WEG ══════════════════════════════════════════════
abschnitt('Nullhandlung - der vollstaendige gute Fall');
{
  const a = attrappe(), M = baue(a);
  const lauf = M.fbV9Start(CTX, { pass: true });
  await settle();
  t('der Rundenbeginn wurde genau einmal versucht',
    a.log.schreib.filter(w => w.pfad === P('d/42')).length === 1);
  t('und steht autoritativ da', a.stand[P('d/42')] && a.stand[P('d/42')].n === 42);
  t('das eigene Terminal wurde genau einmal geschrieben',
    a.log.schreib.filter(w => w.pfad === P('c/42/1')).length === 1);
  t('und zwar als pass', a.stand[P('c/42/1')].k === 'pass');
  t('bei unvollstaendiger Barriere wird gewartet', lauf.stufe === M.FB_V9_WAIT_COMMITS,
    lauf.stufe);
  t('und die Enthuellung noch nicht eroeffnet',
    a.log.schreib.filter(w => w.pfad === P('ro/42')).length === 0);

  // Die uebrigen Sitze committen - erst jetzt darf die Phase oeffnen.
  a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: a.stand[P('c/42/1')], 2: NULLT('late') });
  await settle();
  t('mit voller Barriere wird die Enthuellung eroeffnet',
    a.log.schreib.filter(w => w.pfad === P('ro/42')).length === 1);
  t('der Anker steht autoritativ da', typeof a.stand[P('ro/42')] === 'number');
  await settle();
  t('eine Nullhandlung schreibt KEIN Ergebnis',
    a.log.schreib.filter(w => w.pfad.indexOf('/r/42/') >= 0).length === 0);
  await lauf.fertig;
  t('der Lauf ist COMPLETE', lauf.stufe === M.FB_V9_COMPLETE, lauf.stufe + ' ' + lauf.grund);
  t('die Zugmenge hat einen Eintrag je Sitz', lauf.menge && lauf.menge.length === 3);
  t('und alle drei sind gueltige Nullhandlungen',
    lauf.menge.every(e => e.status === M.FB_V9_VALID && e.move === null));
  t('aufsteigend nach Sitz', lauf.menge.map(e => e.seat).join(',') === '0,1,2');
}

// ══ ABSCHUSS: DER GANZE WEG ══════════════════════════════════════════════════
abschnitt('Abschuss - der vollstaendige gute Fall');
{
  const a = attrappe(), M = baue(a);
  M.fbV9SecretClear();
  const lauf = M.fbV9Start(CTX, { move: ZUG });
  await settle();
  const c = a.stand[P('c/42/1')];
  t('das Terminal traegt genau k, h und ts', Object.keys(c).sort().join(',') === 'h,k,ts',
    Object.keys(c).join(','));
  for (const f of ['idx', 'dx', 'dy', 'sp', 'n', 'salt'])
    t('kein ' + f + ' im Terminal', c[f] === undefined);
  const geheim = M.fbV9SecretFor('RN2K', 7, 42);
  t('das Geheimnis liegt lokal bereit', !!geheim && geheim.salt.length === 16);
  t('vor voller Barriere wird nicht enthuellt',
    a.log.schreib.filter(w => w.pfad === P('ro/42')).length === 0);

  a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: c, 2: NULLT('skip') });
  await settle();
  t('die Enthuellung wurde eroeffnet', typeof a.stand[P('ro/42')] === 'number');
  await settle();
  const r = a.stand[P('r/42/1')];
  t('das eigene Ergebnis wurde geschrieben', !!r);
  t('es traegt genau sieben Felder', Object.keys(r).sort().join(',') === 'dx,dy,idx,k,n,sp,ts',
    Object.keys(r).join(','));
  t('mit exakt den gehashten Werten',
    r.idx === 1 && r.dx === 12.5 && r.dy === -8.25 && r.sp === 0.5);
  t('und exakt dem gehaltenen Salz', r.n === M.fbV9Hex(geheim.salt));
  t('vor vollstaendiger Ergebnisbarriere bleibt es beim Warten',
    lauf.stufe === M.FB_V9_WAIT_RESULTS, lauf.stufe);

  a.zustellen(P('r/42'), { 1: r });
  await lauf.fertig;
  t('der Lauf ist COMPLETE', lauf.stufe === M.FB_V9_COMPLETE, lauf.stufe + ' ' + lauf.grund);
  t('der eigene Zug ist geprueft gueltig',
    lauf.menge[1].status === M.FB_V9_VALID && lauf.menge[1].move.dx === 12.5,
    lauf.menge[1].status);
  t('und das Geheimnis dieser Runde ist geraeumt',
    M.fbV9SecretFor('RN2K', 7, 42) === null);
}

// ══ GEMISCHT UND REIHENFOLGEUNABHAENGIG ══════════════════════════════════════
abschnitt('Gemischte Besetzung, Reihenfolge ohne Wirkung');
{
  // Zwei fremde Abschuesse plus der eigene, dazu Nullterminals - cap 5.
  const bau = async (reihenfolge) => {
    const a = attrappe(), M = baue(a);
    M.fbV9SecretClear();
    const ctx5 = mit({ cap: 5, seat: 0 });
    // Fremde Zuege vorbereiten (eigene Geheimnisse je Sitz, dann wieder freigeben).
    const fremd = {};
    for (const s of [2, 4]) {
      M.fbV9SecretClear();
      // Die Maschine spricht von `room`, der Netzadapter von `code`.
      const cs = { room: 'RN2K', gen: 7, turn: 42, seat: s };
      fremd[s] = { c: await M.fbV9MakeCommit(cs, { idx: s, dx: s + 1, dy: -s, sp: 0 }),
                   r: M.fbV9MakeReveal(cs) };
      fremd[s].c.ts = 1; fremd[s].r.ts = 1;
    }
    M.fbV9SecretClear();
    const lauf = M.fbV9Start(ctx5, { move: { idx: 0, dx: 3, dy: 4, sp: 0.25 } });
    await settle();
    const eigen = a.stand[P('c/42/0')];
    const commits = { 0: eigen, 1: NULLT('pass'), 2: fremd[2].c, 3: NULLT('remove'), 4: fremd[4].c };
    const results = { 2: fremd[2].r, 4: fremd[4].r };
    for (const schritt of reihenfolge) {
      if (schritt === 'c') a.zustellen(P('c/42'), commits);
      if (schritt === 'r') { const eig = a.stand[P('r/42/0')];
        a.zustellen(P('r/42'), Object.assign({}, results, eig ? { 0: eig } : {})); }
      await settle();
    }
    // Am Ende beide Karten vollstaendig zustellen.
    a.zustellen(P('c/42'), commits);
    await settle();
    const eig = a.stand[P('r/42/0')];
    a.zustellen(P('r/42'), Object.assign({}, results, { 0: eig }));
    await lauf.fertig;
    return { lauf: lauf, M: M };
  };
  const A1 = await bau(['c', 'r']);
  t('cap 5 gemischt wird COMPLETE', A1.lauf.stufe === A1.M.FB_V9_COMPLETE,
    A1.lauf.stufe + ' ' + A1.lauf.grund);
  t('fuenf Eintraege, aufsteigend nach Sitz',
    A1.lauf.menge.map(e => e.seat).join(',') === '0,1,2,3,4');
  t('die drei Abschuesse sind gueltig',
    [0, 2, 4].every(s => A1.lauf.menge[s].status === A1.M.FB_V9_VALID && A1.lauf.menge[s].move));
  t('die beiden Nullterminals tragen ihre Art',
    A1.lauf.menge[1].kind === 'pass' && A1.lauf.menge[3].kind === 'remove');
  const A2 = await bau(['r', 'c', 'r']);
  t('eine andere Zustellreihenfolge ergibt dieselbe Menge',
    JSON.stringify(A2.lauf.menge) === JSON.stringify(A1.lauf.menge));
}

// ══ RUNDENBEGINN: RENNEN UND ABWEISUNG ═══════════════════════════════════════
abschnitt('Rundenbeginn: schon da, abgewiesen, wirklich blockiert');
{
  // Schon vorhanden -> EXISTS, der Ablauf geht weiter.
  const a = attrappe({ [P('d/42')]: { n: 42, o: 111 } }), M = baue(a);
  const l = M.fbV9Start(CTX, { pass: true });
  await settle();
  t('ein bereits eroeffneter Beginn haelt nicht auf',
    a.stand[P('c/42/1')] && a.stand[P('c/42/1')].k === 'pass');

  // Abgewiesen UND nichts da -> deterministisch gescheitert.
  const b = attrappe(), N = baue(b);
  b.setzeFehler(P('d/42'), new Error('permission_denied'));
  const l2 = N.fbV9Start(CTX, { pass: true });
  await l2.fertig;
  t('abgewiesen ohne autoritativen Beginn: FAILED', l2.stufe === N.FB_V9_FAILED, l2.stufe);
  t('mit benanntem Grund', /Rundenbeginn/.test(l2.grund), l2.grund);
  t('und ohne eigenes Terminal', b.stand[P('c/42/1')] === undefined);

  // Abgewiesen, aber ein anderer hat laengst eroeffnet -> zusammenlaufen.
  const c = attrappe({ [P('d/42')]: { n: 42, o: 222 } }), O = baue(c);
  c.setzeFehler(P('d/42'), new Error('permission_denied'));
  const l3 = O.fbV9Start(CTX, { pass: true });
  await settle();
  t('abgewiesen, aber autoritativ vorhanden: der Ablauf laeuft weiter',
    l3.stufe !== O.FB_V9_FAILED && c.stand[P('c/42/1')] !== undefined, l3.stufe);
}

// ══ EIGENES TERMINAL SCHON DA ════════════════════════════════════════════════
abschnitt('Ein eigenes Terminal liegt schon vor');
{
  const lauf = async (vorhanden, aktion) => {
    const a = attrappe({ [P('d/42')]: { n: 42, o: 1 }, [P('c/42/1')]: vorhanden });
    const M = baue(a); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, aktion);
    await settle();
    return { l: l, M: M, a: a };
  };
  const p1 = await lauf({ k: 'pass', ts: 1 }, { pass: true });
  t('ein passendes pass wird uebernommen', p1.l.stufe !== p1.M.FB_V9_FAILED, p1.l.stufe);
  const p2 = await lauf({ k: 'move', h: H64, ts: 1 }, { pass: true });
  t('ein fremdes move statt des erwarteten pass: FAILED', p2.l.stufe === p2.M.FB_V9_FAILED);
  t('mit benanntem Grund', /Terminal weicht ab/.test(p2.grund || p2.l.grund), p2.l.grund);
  const p3 = await lauf({ k: 'pass', ts: 1 }, { move: ZUG });
  t('ein pass statt des erwarteten move: FAILED', p3.l.stufe === p3.M.FB_V9_FAILED);
  const p4 = await lauf({ k: 'move', h: H64, ts: 1 }, { move: ZUG });
  t('ein move mit FREMDEM Hash: FAILED', p4.l.stufe === p4.M.FB_V9_FAILED, p4.l.grund);
  // Und der Fall, in dem genau der eigene Hash schon dasteht.
  {
    const a0 = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M0 = baue(a0);
    M0.fbV9SecretClear();
    const eigen = await M0.fbV9MakeCommit(M0.fbV9EngineCtx(CTX), ZUG);
    const a = attrappe({ [P('d/42')]: { n: 42, o: 1 },
                         [P('c/42/1')]: { k: 'move', h: eigen.h, ts: 1 } });
    const M = baue(a); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { move: ZUG });
    await settle();
    // Der eigene Hash haengt am frisch erzeugten Salz - er kann gar nicht gleich sein.
    t('ein move mit anderem Salz erzeugt einen anderen Hash und faellt',
      l.stufe === M.FB_V9_FAILED, l.stufe);
  }
}

// ══ REVEAL-ANKER: RENNEN ═════════════════════════════════════════════════════
abschnitt('Reveal-Anker: das Rennen entscheidet der Raum');
{
  const voll = { 0: NULLT('pass'), 2: NULLT('pass') };
  // Abgewiesen, aber ein anderer hat eroeffnet -> weiter.
  const a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M = baue(a);
  a.setzeFehler(P('ro/42'), new Error('permission_denied'));
  const l = M.fbV9Start(CTX, { pass: true });
  await settle();
  a.zustellen(P('c/42'), Object.assign({}, voll, { 1: a.stand[P('c/42/1')] }));
  await settle();
  t('abgewiesener eigener Versuch ohne Anker: FAILED', l.stufe === M.FB_V9_FAILED, l.stufe);
  t('mit benanntem Grund', /Reveal-Anker/.test(l.grund), l.grund);

  const b = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), N = baue(b);
  b.setzeFehler(P('ro/42'), new Error('permission_denied'));
  const l2 = N.fbV9Start(CTX, { pass: true });
  await settle();
  // Der Anker ist schon da, bevor unser Versuch abgewiesen wird.
  b.stand[P('ro/42')] = 555;
  b.zustellen(P('ro/42'), 555);
  b.zustellen(P('c/42'), Object.assign({}, voll, { 1: b.stand[P('c/42/1')] }));
  await settle();
  t('abgewiesen, aber autoritativ eroeffnet: kein Scheitern',
    l2.stufe !== N.FB_V9_FAILED, l2.stufe + ' ' + l2.grund);
  await l2.fertig;
  t('und der Lauf wird fertig', l2.stufe === N.FB_V9_COMPLETE, l2.stufe);
}

// ══ EIGENES ERGEBNIS SCHON DA ════════════════════════════════════════════════
abschnitt('Ein eigenes Ergebnis liegt schon vor');
{
  // Der Fremdwert muss VOR der Barriere liegen - sonst schreibt die Steuerung ihr
  // Ergebnis zuerst und der EXISTS-Zweig kaeme nie zum Zug.
  const vorbereiten = async (bauErgebnis) => {
    const a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M = baue(a);
    M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { move: ZUG });
    await settle();
    // Jetzt steht das Geheimnis - daraus laesst sich das ERWARTETE Ergebnis bauen.
    a.stand[P('r/42/1')] = bauErgebnis(M);
    a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: a.stand[P('c/42/1')], 2: NULLT('pass') });
    await settle();
    return { l: l, M: M, a: a };
  };
  const gut = await vorbereiten((M) => {
    const r = M.fbV9MakeReveal(M.fbV9EngineCtx(CTX)); r.ts = 1; return r;
  });
  t('ein passendes eigenes Ergebnis wird uebernommen',
    gut.l.stufe !== gut.M.FB_V9_FAILED, gut.l.stufe + ' ' + gut.l.grund);
  t('und es wurde NICHT ueberschrieben',
    gut.a.stand[P('r/42/1')].ts === 1, gut.a.stand[P('r/42/1')].ts);
  const schlecht = await vorbereiten(() =>
    ({ k: 'reveal', idx: 1, dx: 99, dy: 1, sp: 0, n: H32, ts: 1 }));
  t('ein abweichendes eigenes Ergebnis: FAILED',
    schlecht.l.stufe === schlecht.M.FB_V9_FAILED, schlecht.l.stufe);
  t('mit benanntem Grund', /Ergebnis weicht ab/.test(schlecht.l.grund), schlecht.l.grund);
}

abschnitt('Barrieren halten - und Stoerfaelle brechen nichts ab');
{
  const a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M = baue(a);
  const l = M.fbV9Start(CTX, { pass: true });
  await settle();
  a.zustellen(P('c/42'), { 0: { k: 'quatsch' }, 1: a.stand[P('c/42/1')], 2: NULLT('pass') });
  await settle();
  t('ein missgebildetes Terminal schliesst die Barriere nicht',
    a.log.schreib.filter(w => w.pfad === P('ro/42')).length === 0);
  t('und der Lauf wartet weiter', l.stufe === M.FB_V9_WAIT_COMMITS, l.stufe);

  // Fehlendes Ergebnis eines Abschusses: weiter warten, nicht scheitern.
  const b = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), N = baue(b);
  N.fbV9SecretClear();
  const l2 = N.fbV9Start(CTX, { move: ZUG });
  await settle();
  b.zustellen(P('c/42'), { 0: { k: 'move', h: H64, ts: 1 }, 1: b.stand[P('c/42/1')], 2: NULLT('pass') });
  await settle();
  b.zustellen(P('r/42'), { 1: b.stand[P('r/42/1')] });
  await settle();
  t('ein fehlendes fremdes Ergebnis laesst den Lauf warten',
    l2.stufe === N.FB_V9_WAIT_RESULTS, l2.stufe);
  t('und er ist NICHT gescheitert', l2.stufe !== N.FB_V9_FAILED);
  // Eine ausgebliebene Enthuellung schliesst die Barriere - ohne jede Spielfolge.
  b.zustellen(P('r/42'), { 0: { k: 'noreveal', ts: 1 }, 1: b.stand[P('r/42/1')] });
  await l2.fertig;
  t('eine festgehaltene Nicht-Enthuellung schliesst die Barriere',
    l2.stufe === N.FB_V9_COMPLETE, l2.stufe + ' ' + l2.grund);
  t('und steht als NO_REVEAL in der Menge', l2.menge[0].status === N.FB_V9_NO_REVEAL,
    l2.menge[0].status);
  t('ohne Zug und ohne Strafe', l2.menge[0].move === null);
}

// ══ FALSCHER HASH ════════════════════════════════════════════════════════════
abschnitt('Ein falscher fremder Hash haelt das Protokoll nicht auf');
{
  const a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M = baue(a);
  M.fbV9SecretClear();
  const l = M.fbV9Start(CTX, { move: ZUG });
  await settle();
  a.zustellen(P('c/42'), { 0: { k: 'move', h: H64, ts: 1 }, 1: a.stand[P('c/42/1')],
                           2: NULLT('pass') });
  await settle();
  a.zustellen(P('r/42'), { 0: { k: 'reveal', idx: 0, dx: 1, dy: 1, sp: 0, n: H32, ts: 1 },
                           1: a.stand[P('r/42/1')] });
  await l.fertig;
  t('der Lauf wird trotzdem COMPLETE', l.stufe === M.FB_V9_COMPLETE, l.stufe + ' ' + l.grund);
  t('der fremde Sitz steht als HASH_MISMATCH da', l.menge[0].status === M.FB_V9_MISMATCH,
    l.menge[0].status);
  t('ohne Zug', l.menge[0].move === null);
  t('und der eigene Zug bleibt gueltig', l.menge[1].status === M.FB_V9_VALID);
}

// ══ ANHALTEN ═════════════════════════════════════════════════════════════════
abschnitt('Anhalten: einmal, zweimal, mittendrin');
{
  const a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M = baue(a);
  const l = M.fbV9Start(CTX, { pass: true });
  await settle();
  l.stop();
  t('der Lauf ist STOPPED', l.stufe === M.FB_V9_STOPPED, l.stufe);
  t('alle Zuhoerer sind abgemeldet', a.log.hoert.every(h => !h.offen));
  const vorher = a.log.schreib.length;
  a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: NULLT('pass'), 2: NULLT('pass') });
  await settle();
  t('ein spaeterer Schnappschuss belebt nichts wieder',
    a.log.schreib.length === vorher && l.stufe === M.FB_V9_STOPPED, l.stufe);
  let heil = true; try { l.stop(); l.stop(); } catch (e) { heil = false; }
  t('mehrfaches Anhalten ist gefahrlos', heil === true);
  await l.fertig;
  t('die Zusage auf das Ende ist erfuellt', true);

  // Anhalten, WAEHREND ein Schreibvorgang laeuft.
  for (const stelle of ['d/42', 'c/42/1', 'ro/42']) {
    const b = attrappe(stelle === 'd/42' ? {} : { [P('d/42')]: { n: 42, o: 1 } });
    const N = baue(b);
    const l2 = N.fbV9Start(CTX, { pass: true });
    l2.stop();                                  // sofort, ohne auf irgendetwas zu warten
    await settle();
    t('Anhalten waehrend ' + stelle + ' bleibt STOPPED', l2.stufe === N.FB_V9_STOPPED, l2.stufe);
    t('und es entsteht keine Zugmenge', l2.menge === null);
  }
  // Anhalten waehrend des eigenen Ergebnisses.
  const c = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), O = baue(c);
  O.fbV9SecretClear();
  const l3 = O.fbV9Start(CTX, { move: ZUG });
  await settle();
  c.zustellen(P('c/42'), { 0: NULLT('pass'), 1: c.stand[P('c/42/1')], 2: NULLT('pass') });
  l3.stop();
  await settle();
  t('Anhalten waehrend der Enthuellung bleibt STOPPED', l3.stufe === O.FB_V9_STOPPED, l3.stufe);
}

// ══ EINMALIGKEIT ═════════════════════════════════════════════════════════════
abschnitt('Jede Nebenwirkung hoechstens einmal');
{
  const a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M = baue(a);
  M.fbV9SecretClear();
  const l = M.fbV9Start(CTX, { move: ZUG });
  await settle();
  const voll = { 0: NULLT('pass'), 1: a.stand[P('c/42/1')], 2: NULLT('pass') };
  // Denselben vollstaendigen Stand FUENFMAL zustellen.
  for (let i = 0; i < 5; i++) { a.zustellen(P('c/42'), voll); await settle(3); }
  t('die Enthuellung wird trotz fuenf gleicher Schnappschuesse nur EINMAL eroeffnet',
    a.log.schreib.filter(w => w.pfad === P('ro/42')).length === 1,
    a.log.schreib.filter(w => w.pfad === P('ro/42')).length);
  for (let i = 0; i < 5; i++) { a.zustellen(P('ro/42'), a.stand[P('ro/42')]); await settle(3); }
  t('und das eigene Ergebnis nur EINMAL geschrieben',
    a.log.schreib.filter(w => w.pfad === P('r/42/1')).length === 1,
    a.log.schreib.filter(w => w.pfad === P('r/42/1')).length);
  const fertig = { 0: NULLT('pass'), 1: a.stand[P('c/42/1')], 2: NULLT('pass') };
  for (let i = 0; i < 5; i++) { a.zustellen(P('r/42'), { 1: a.stand[P('r/42/1')] }); await settle(3); }
  await l.fertig;
  t('der Abschluss faellt genau einmal', l.stufe === M.FB_V9_COMPLETE, l.stufe);
  t('das eigene Terminal wurde nur einmal geschrieben',
    a.log.schreib.filter(w => w.pfad === P('c/42/1')).length === 1);
}

// ══ UNGUELTIGER START ════════════════════════════════════════════════════════
abschnitt('Ungueltiger Start');
{
  const a = attrappe(), M = baue(a);
  const l = M.fbV9Start(mit({ v: 8 }), { pass: true });
  await l.fertig;
  t('ein v8-Zusammenhang scheitert sofort', l.stufe === M.FB_V9_FAILED, l.stufe);
  t('ohne einen einzigen Schreibvorgang', a.log.schreib.length === 0);
  t('und ohne Zuhoerer', a.log.hoert.length === 0);
  const l2 = M.fbV9Start(CTX, {});
  await l2.fertig;
  t('ohne Handlung ebenso', l2.stufe === M.FB_V9_FAILED, l2.stufe);
  const l3 = M.fbV9Start(CTX, { move: { idx: 1, dx: NaN, dy: 0, sp: 0 } });
  await l3.fertig;
  t('ein unbaubarer Zug ebenso', l3.stufe === M.FB_V9_FAILED, l3.grund);
}

// ══ QUELLTEXT-WAECHTER ═══════════════════════════════════════════════════════
abschnitt('Waechter: die Steuerung ruht');
{
  const NL = String.fromCharCode(10);
  t('der freigegebene Client steht auf Protokoll 8',
    /const ONLINE_PROTOCOL_VERSION=8;/.test(HTML));
  t('ausserhalb des ruhenden Bereichs nennt keine Zeile eine v9-Funktion',
    HTML.split(BEREICH).join('').indexOf('fbV9') < 0);
  for (const fn of ['onlineSendCommit', 'writeTurnSlot', 'onlineArmTurn', 'maybeReveal',
                    'processSlot', 'applyLaunch', 'allAliveCommitted', 'beginReveal'])
    t(fn + '() ruft die Steuerung nicht',
      grab(new RegExp('function ' + fn + '\\([^)]*\\)\\{[\\s\\S]*?' + NL + '\\}'), fn)
        .indexOf('fbV9') < 0);
  const ohneText = BEREICH.split(NL).map(zl => { const k = zl.indexOf('//');
    return k >= 0 ? zl.slice(0, k) : zl; }).join(NL);
  for (const w of ['applyLaunch(', 'beginReveal', 'setPhase', 'commitIdx', 'commitAim',
                   'commitSpin', 'aimSet', 'turnNo', 'fbElimLives', 'gameOver', 'balls['])
    t('die Steuerung beruehrt ' + w + ' nicht', ohneText.indexOf(w) < 0);
  // Keine Fristen, keine Zeitgeber, keine Sentinel-Schreiber in dieser Stufe.
  for (const w of ['setTimeout', 'setInterval', 'Date.now', '6000'])
    t('kein ' + w + ' im ruhenden Bereich', ohneText.indexOf(w) < 0);
  for (const w of ["'late'", "'skip'", "'remove'", "'noreveal'"])
    t('kein Schreiber fuer ' + w, ohneText.indexOf('k:' + w) < 0);
  t('kein Produktweg legt einen v9-Raum an', HTML.indexOf('v:9') < 0 && HTML.indexOf('v: 9') < 0);
  const regeln = fs.readFileSync(path.join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('die Regeldatei traegt weiterhin die v9-Zweige aus V9.1/V9.2',
    regeln.indexOf("child('v').val() === 9") > 0);
}

console.log('\nOnline-V9-Ablauf: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.log('AUSNAHME: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
