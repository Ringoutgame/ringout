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
function attrappe(vorbelegt, uhr) {
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
        const vorher = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        const vorschlag = fehler[ref.pfad] ? null : fn(vorher);
        // Auch ein abgewiesener Versuch IST ein Versuch - er gehoert ins Protokoll,
        // sonst laesst sich die Begrenzung der Wiederholungen gar nicht zaehlen.
        log.schreib.push({ pfad: ref.pfad, vorschlag: vorschlag });
        if (fehler[ref.pfad]) throw fehler[ref.pfad];
        if (vorschlag === undefined) return { committed: false, snapshot: { val: () => vorher } };
        // Der Serversentinel wird beim Speichern zu einer Zahl - wie in Firebase.
        // Wie der echte Server: der Sentinel wird beim Speichern zu der Zeit, die
        // DIESE Laufzeit fuer die Serverzeit haelt - in den Tests die gestellte Uhr.
        const jetzt = uhr ? uhr.jetzt() : 1788700000000;
        const gespeichert = JSON.parse(JSON.stringify(vorschlag,
          (k, v) => (v && v['.sv'] === 'timestamp') ? jetzt : v));
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

// ── Gestellte Zeit und gestellte Zeitgeber ───────────────────────────────────
// Kein Test wartet sechs echte Sekunden. Die Steuerung bekommt ihre Serverzeit und
// ihre Zeitgeber als Parameter; die Tests ruecken die Uhr vor und loesen die faelligen
// Weckrufe von Hand aus. Damit ist auch pruefbar, WANN sie geplant wurden - was mit
// echten Zeitgebern nur zufaellig sichtbar waere.
// Ohne ausdrueckliche Uhr bekommt ein Bau eine STILLE: Wecker werden gestellt, aber
// nie ausgeloest. So bleiben die Abschnitte, die den guten Fall pruefen, von den
// Fristen unberuehrt - und kein echter Zeitgeber haelt den Prozess am Leben.
function uhrwerk(start) {
  let jetzt = start === undefined ? 1000000 : start, id = 1;
  const offen = new Map();
  return {
    jetzt: () => jetzt,
    anzahl: () => offen.size,
    geplant: () => [...offen.values()].map(e => e.faellig - jetzt).sort((x, y) => x - y),
    serverNow: () => jetzt,
    setTimeout: (fn, ms) => { const k = id++; offen.set(k, { faellig: jetzt + ms, fn: fn }); return k; },
    clearTimeout: (k) => { offen.delete(k); },
    // Die Uhr vorruecken und alles ausloesen, was dabei faellig wird.
    vor: async (ms) => {
      jetzt += ms;
      for (let runde = 0; runde < 40; runde++) {
        const faellig = [...offen.entries()].filter(e => e[1].faellig <= jetzt)
          .sort((x, y) => x[1].faellig - y[1].faellig);
        if (!faellig.length) break;
        for (const e of faellig) { offen.delete(e[0]); e[1].fn(); }
        await settle(6);
      }
      await settle(6);
    },
  };
}
// ── Den echten Quelltext in eine Sandbox holen ───────────────────────────────
const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-SPIELANBINDUNG ════');
if (START < 0 || ENDE < START) throw new Error('der ruhende v9-Bereich fehlt');
const BEREICH = HTML.slice(START, ENDE);
// Seit B2C3C sichert die Steuerung das Geheimnis, BEVOR sie den Commit sendet. Ohne
// Speicher gaebe es also keinen Zug mehr - die Sandbox bekommt deshalb einen einfachen.
function speicher(){
  const m=new Map();
  return { get length(){return m.size;}, key:(i)=>[...m.keys()][i],
           getItem:(k)=>m.has(k)?m.get(k):null,
           setItem:(k,v)=>{m.set(k,String(v));},
           removeItem:(k)=>{m.delete(k);}, inhalt:m };
}
const STILL = uhrwerk(1000);
const baue = (a, uhr, st) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
                                'FB_ONLINE_BALL_IDX', 'serverNow', 'setTimeout',
                                'clearTimeout', 'sessionStorage', `
  ${BEREICH}
  return { fbV9Start, fbV9Resume, fbV9UidOk, fbV9SecretAdopt, fbV9SecretSave,
           fbV9SecretLoad, fbV9SecretDrop, fbV9Hex, fbV9NewSalt,
           fbV9CtxOk, fbV9MakeCommit, fbV9MakeReveal, fbV9SecretFor,
           fbV9Marke,
           fbV9SecretClear, fbV9Hash, fbV9Hex, fbV9AcceptedSet, fbV9EngineCtx,
           FB_V9_IDLE, FB_V9_OPENING, FB_V9_COMMITTING, FB_V9_WAIT_COMMITS,
           FB_V9_OPENING_REVEAL, FB_V9_REVEALING, FB_V9_WAIT_RESULTS,
           FB_V9_COMPLETE, FB_V9_FAILED, FB_V9_STOPPED,
           FB_V9_VALID, FB_V9_MISMATCH, FB_V9_MALFORMED, FB_V9_NO_REVEAL };
`)({ FB: a.FB }, globalThis.crypto, 10000, 5, 5,
   (uhr || STILL).serverNow, (uhr || STILL).setTimeout, (uhr || STILL).clearTimeout,
   st || speicher());

const H64 = 'ab12'.repeat(16), H32 = '0123456789abcdef'.repeat(2);
const UID = 'UID_KOORD_XXXXXXXXXXXXXXXXX';
// Seit B2C3C gehoert die angemeldete Kennung in den Zusammenhang - ohne sie wird
// kein Geheimnis gesichert und folglich kein Zug gesendet.
const CTX = { v: 9, code: 'RN2K', gen: 7, turn: 42, seat: 1, cap: 3, uid: UID };
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

// ══ WECKRUFE AN DEN FRISTEN ══════════════════════════════════════════════════
abschnitt('Weckrufe: einer je Frist, hoechstens drei Versuche');
{
  // Aufbau: Runde offen, eigener pass geschrieben, ein Sitz fehlt. Die Uhr steht
  // dicht hinter der Oeffnung - der Wecker muss also fast die volle Frist warten.
  const aufbau = async (opt) => {
    opt = opt || {};
    const u = uhrwerk(2000000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() } }, u);
    const M = baue(a, u);
    M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { pass: true });
    await settle();
    if (opt.commits) { a.zustellen(P('c/42'), opt.commits(a)); await settle(); }
    return { u: u, a: a, M: M, l: l };
  };

  // (1) Genau ein Wecker, und zwar auf die Frist.
  {
    const g = await aufbau();
    t('ein Wecker ist gestellt', g.u.anzahl() === 1, g.u.anzahl());
    const p = g.u.geplant()[0];
    t('er liegt bei Frist plus Sicherheitsabstand', p === 6000 + 250, p);
    // Fuenf identische Schnappschuesse duerfen keinen zweiten Wecker erzeugen.
    for (let i = 0; i < 5; i++) { g.a.zustellen(P('c/42'), { 1: g.a.stand[P('c/42/1')] }); await settle(4); }
    t('fuenf gleiche Schnappschuesse ergeben trotzdem EINEN Wecker',
      g.u.anzahl() === 1, g.u.anzahl());
    // Vor der Frist wird nichts geschrieben.
    const vorher = g.a.log.schreib.length;
    await g.u.vor(3000);
    t('vor der Frist wird kein Terminal geschlossen',
      g.a.log.schreib.length === vorher, g.a.log.schreib.length - vorher);
  }

  // (2) Nach der Frist: die fehlenden Sitze werden aufsteigend geschlossen.
  {
    const g = await aufbau();
    await g.u.vor(6300);
    const spaet = g.a.log.schreib.filter(w => w.vorschlag && w.vorschlag.k === 'late');
    t('die beiden fehlenden Sitze bekommen late', spaet.length === 2, spaet.length);
    t('und zwar aufsteigend nach Sitz',
      spaet.map(w => w.pfad.slice(-1)).join(',') === '0,2',
      spaet.map(w => w.pfad).join(' '));
    t('der eigene, bereits belegte Slot wird nicht angefasst',
      spaet.every(w => w.pfad !== P('c/42/1')));
    // Der Schreibvorgang allein bewegt die Barriere NICHT.
    t('die Stufe bleibt WAIT_COMMITS, bis der Raum es bestaetigt',
      g.l.stufe === g.M.FB_V9_WAIT_COMMITS, g.l.stufe);
    // Erst der autoritative Schnappschuss traegt weiter.
    g.a.zustellen(P('c/42'), { 0: { k: 'late', ts: 1 }, 1: g.a.stand[P('c/42/1')],
                               2: { k: 'late', ts: 1 } });
    await settle();
    t('dann erst wird die Enthuellung eroeffnet',
      g.a.log.schreib.filter(w => w.pfad === P('ro/42')).length === 1);
    t('und der Wecker ist geraeumt', g.u.geplant().every(ms => ms !== 6250));
  }

  // (3) Nichts fehlt: kein Schreibvorgang.
  {
    const g = await aufbau({ commits: (a) => ({ 0: NULLT('pass'), 1: a.stand[P('c/42/1')],
                                                2: NULLT('pass') }) });
    const vorher = g.a.log.schreib.length;
    await g.u.vor(9000);
    t('bei vollstaendiger Barriere weckt nichts einen Sentinel',
      !g.a.log.schreib.slice(vorher).some(w => w.vorschlag && w.vorschlag.k === 'late'));
  }

  // (4) Ein belegter Slot wird nie ueberschrieben.
  {
    const g = await aufbau({ commits: (a) => ({ 0: NULLT('pass'), 1: a.stand[P('c/42/1')] }) });
    await g.u.vor(6300);
    const spaet = g.a.log.schreib.filter(w => w.vorschlag && w.vorschlag.k === 'late');
    t('nur der wirklich fehlende Sitz bekommt late',
      spaet.length === 1 && spaet[0].pfad === P('c/42/2'), spaet.map(w => w.pfad).join(' '));
  }
}

abschnitt('Begrenzte Wiederholung - und kein vierter Versuch');
{
  // Der Server weist ab, weil wir eine Spur zu frueh geklopft haben. Dann zweimal
  // nachfassen - und dann Ruhe, bis neue Daten kommen. Das ist ausdruecklich keine
  // Abfrageschleife: ohne neuen Schnappschuss passiert nichts mehr.
  const bauAbweisend = async (fehler) => {
    const u = uhrwerk(3000000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() } }, u);
    a.setzeFehler(P('c/42/0'), fehler);
    a.setzeFehler(P('c/42/2'), fehler);
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { pass: true });
    await settle();
    return { u: u, a: a, M: M, l: l };
  };
  const zaehl = (g) => g.a.log.schreib.filter(w => w.pfad === P('c/42/0')).length;
  {
    const g = await bauAbweisend(new Error('permission_denied'));
    await g.u.vor(6300);
    t('erster Versuch nach der Frist', zaehl(g) === 1, zaehl(g));
    await g.u.vor(500);
    t('nach 500 ms die erste Wiederholung', zaehl(g) === 2, zaehl(g));
    await g.u.vor(1500);
    t('nach weiteren 1500 ms die zweite', zaehl(g) === 3, zaehl(g));
    await g.u.vor(60000);
    t('danach KEIN weiterer Versuch - auch nicht nach einer Minute',
      zaehl(g) === 3, zaehl(g));
    t('und kein Wecker bleibt haengen', g.u.anzahl() === 0, g.u.anzahl());
    t('eine Abweisung wird nie zum Erfolg',
      g.l.stufe === g.M.FB_V9_WAIT_COMMITS, g.l.stufe);
  }
  {
    // Ein Netzfehler wird genauso begrenzt behandelt.
    const g = await bauAbweisend(new Error('network down'));
    await g.u.vor(6300); await g.u.vor(500); await g.u.vor(1500); await g.u.vor(60000);
    t('auch ein Netzfehler ergibt hoechstens drei Versuche', zaehl(g) === 3, zaehl(g));
  }
}

abschnitt('Der Reveal-Wecker');
{
  // Aufbau bis zur Enthuellungsphase: eigener Zug committet und enthuellt, ein
  // fremder Zug bleibt ohne Ergebnis.
  const bauReveal = async () => {
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() - 100 } }, u);
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { move: ZUG });
    await settle();
    a.zustellen(P('c/42'), { 0: { k: 'move', h: H64, ts: 1 }, 1: a.stand[P('c/42/1')],
                             2: NULLT('pass') });
    await settle();
    return { u: u, a: a, M: M, l: l };
  };
  {
    const g = await bauReveal();
    t('die Enthuellung ist eroeffnet', typeof g.a.stand[P('ro/42')] === 'number');
    t('genau ein Reveal-Wecker steht', g.u.anzahl() === 1, g.u.anzahl());
    // Fuenf gleiche Anker-Schnappschuesse ergeben keinen zweiten.
    for (let i = 0; i < 5; i++) { g.a.zustellen(P('ro/42'), g.a.stand[P('ro/42')]); await settle(4); }
    t('und fuenf gleiche Anker aendern daran nichts', g.u.anzahl() === 1, g.u.anzahl());
    const vorher = g.a.log.schreib.length;
    await g.u.vor(3000);
    t('vor der Reveal-Frist kein noreveal',
      !g.a.log.schreib.slice(vorher).some(w => w.vorschlag && w.vorschlag.k === 'noreveal'));
    await g.u.vor(3500);
    const nr = g.a.log.schreib.filter(w => w.vorschlag && w.vorschlag.k === 'noreveal');
    t('danach genau ein noreveal - fuer den einen offenen Zug',
      nr.length === 1, nr.length);
    t('und zwar auf dem Ergebnispfad des fremden Sitzes',
      nr[0].pfad === P('r/42/0'), nr[0].pfad);
    t('fuer pass wird KEIN Ergebnis erzwungen',
      !nr.some(w => w.pfad === P('r/42/2')));
    t('und fuer den eigenen, laengst enthuellten Zug auch nicht',
      !nr.some(w => w.pfad === P('r/42/1')));
    t('der Lauf wartet weiter auf den Raum',
      g.l.stufe === g.M.FB_V9_WAIT_RESULTS, g.l.stufe);
    // Erst der autoritative Schnappschuss schliesst die Runde ab.
    g.a.zustellen(P('r/42'), { 0: { k: 'noreveal', ts: 1 }, 1: g.a.stand[P('r/42/1')] });
    await g.l.fertig;
    t('dann wird der Lauf COMPLETE', g.l.stufe === g.M.FB_V9_COMPLETE, g.l.stufe);
    t('und die Menge nennt NO_REVEAL', g.l.menge[0].status === g.M.FB_V9_NO_REVEAL,
      g.l.menge[0].status);
    t('ohne Zug und ohne Strafe', g.l.menge[0].move === null);
    t('alle Wecker sind geraeumt', g.u.anzahl() === 0, g.u.anzahl());
  }
  {
    // Nullterminals brauchen kein Ergebnis - dann weckt auch nichts.
    const u = uhrwerk(5000000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() - 100 } }, u);
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { pass: true });
    await settle();
    a.zustellen(P('c/42'), { 0: NULLT('skip'), 1: a.stand[P('c/42/1')], 2: NULLT('remove') });
    await settle();
    await l.fertig;
    t('lauter Nullterminals: der Lauf endet ohne jeden Wecker',
      l.stufe === M.FB_V9_COMPLETE, l.stufe + ' ' + l.grund);
    t('und ohne ein einziges noreveal',
      !a.log.schreib.some(w => w.vorschlag && w.vorschlag.k === 'noreveal'));
  }
}

abschnitt('Wecker enden mit dem Lauf');
{
  const bauOffen = async () => {
    const u = uhrwerk(6000000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() } }, u);
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { pass: true });
    await settle();
    return { u: u, a: a, M: M, l: l };
  };
  {
    const g = await bauOffen();
    t('ein Wecker steht', g.u.anzahl() === 1);
    g.l.stop();
    t('nach stop() ist keiner mehr da', g.u.anzahl() === 0, g.u.anzahl());
    const vorher = g.a.log.schreib.length;
    await g.u.vor(60000);
    t('und es wird nichts mehr geschrieben',
      g.a.log.schreib.length === vorher, g.a.log.schreib.length - vorher);
    let heil = true; try { g.l.stop(); g.l.stop(); } catch (e) { heil = false; }
    t('mehrfaches Anhalten bleibt gefahrlos', heil === true);
  }
  {
    // Auch mitten in der Wiederholungskette.
    const u = uhrwerk(7000000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() } }, u);
    a.setzeFehler(P('c/42/0'), new Error('permission_denied'));
    a.setzeFehler(P('c/42/2'), new Error('permission_denied'));
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { pass: true });
    await settle();
    await u.vor(6300);
    const nach1 = a.log.schreib.filter(w => w.pfad === P('c/42/0')).length;
    l.stop();
    await u.vor(60000);
    t('ein Anhalten mitten in der Wiederholung beendet sie',
      a.log.schreib.filter(w => w.pfad === P('c/42/0')).length === nach1, nach1);
    t('und laesst keinen Wecker zurueck', u.anzahl() === 0, u.anzahl());
  }
  {
    // Ein gescheiterter Lauf raeumt ebenfalls.
    const u = uhrwerk(8000000);
    const a = attrappe(null, u);
    a.setzeFehler(P('d/42'), new Error('permission_denied'));
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { pass: true });
    await l.fertig;
    t('ein gescheiterter Lauf hinterlaesst keinen Wecker',
      l.stufe === M.FB_V9_FAILED && u.anzahl() === 0, l.stufe + ' / ' + u.anzahl());
  }
}
// ══ LEBENDIGKEIT OHNE BRAUCHBARE SERVERZEIT ══════════════════════════════════
abschnitt('Ohne Serverzeit: lieber zu spaet als zu frueh');
{
  // DER FEHLER, der hier behoben ist: der Rueckfall war 250 ms. Damit lagen alle
  // drei Versuche - 250, 750, 2250 ms - VOR der echten Frist bei 6000 ms. Das
  // Budget war verbraucht, bevor der Server die Frist ueberhaupt erreichte, und
  // ohne neuen Schnappschuss haette danach nie wieder etwas angeklopft: die Runde
  // waere stehengeblieben. Jetzt wird vom BEOBACHTUNGSZEITPUNKT an die volle Frist
  // gewartet - die Eroeffnung lag zwangslaeufig davor, also kann der Wecker nie zu
  // frueh kommen.
  const ohneUhr = (start) => {
    const u = uhrwerk(start === undefined ? 9000000 : start);
    u.serverNow = () => NaN;          // unbrauchbar - genau der Pruefungsfall
    return u;
  };
  {
    const u = ohneUhr();
    // Die Runde wurde VOR unserer Beobachtung eroeffnet - hier eine Sekunde vorher.
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() - 1000 } }, u);
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { pass: true });
    await settle();
    t('ein Wecker ist gestellt', u.anzahl() === 1, u.anzahl());
    t('und zwar auf die VOLLE Frist ab jetzt, nicht auf 250 ms',
      u.geplant()[0] === 6000 + 250, u.geplant()[0]);
    // Der springende Punkt: bis zur echten Frist - hier noch 5000 ms - darf kein
    // einziger Versuch fallen, sonst waere das Budget zu frueh verbraucht.
    await u.vor(5000);
    const frueh = a.log.schreib.filter(w => w.vorschlag && w.vorschlag.k === 'late');
    t('bis zur echten Frist faellt KEIN Versuch', frueh.length === 0, frueh.length);
    await u.vor(1300);
    const spaet = a.log.schreib.filter(w => w.vorschlag && w.vorschlag.k === 'late');
    t('danach wird geschlossen - ohne dass ein neuer Schnappschuss noetig war',
      spaet.length === 2, spaet.length);
    t('die Stufe bleibt WAIT_COMMITS - der Wecker traegt die Barriere nicht',
      l.stufe === M.FB_V9_WAIT_COMMITS, l.stufe);
  }
  {
    // Dasselbe fuer die Enthuellung.
    const u = ohneUhr(9500000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() - 1000 } }, u);
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { move: ZUG });
    await settle();
    a.zustellen(P('c/42'), { 0: { k: 'move', h: H64, ts: 1 }, 1: a.stand[P('c/42/1')],
                             2: NULLT('pass') });
    await settle();
    t('der Reveal-Wecker steht ebenfalls auf die volle Frist',
      u.geplant().indexOf(6000 + 250) >= 0, u.geplant().join(','));
    await u.vor(5000);
    t('vorher kein noreveal',
      !a.log.schreib.some(w => w.vorschlag && w.vorschlag.k === 'noreveal'));
    await u.vor(1300);
    t('danach genau eines - ohne neuen Schnappschuss',
      a.log.schreib.filter(w => w.vorschlag && w.vorschlag.k === 'noreveal').length === 1);
  }
}

// ══ DAS BUDGET WIRD NICHT VON RAUSCHEN ZURUECKGESETZT ════════════════════════
abschnitt('Erschoepfte Wiederholungen bleiben erschoepft');
{
  // Die Marke sagt, was an einem Schnappschuss WESENTLICH ist: welche Sitze ein
  // erkanntes Terminal tragen - und, wo gefragt, ein erkanntes Ergebnis. Gleiche
  // Marke heisst gleicher Zustand, egal wie oft er eintrifft.
  {
    const M0 = baue(attrappe());
    const c1 = { 0: { k: 'move', h: H64, ts: 1 }, 1: { k: 'pass', ts: 1 } };
    t('zwei gleiche Karten ergeben dieselbe Marke',
      M0.fbV9Marke(3, c1) === M0.fbV9Marke(3, JSON.parse(JSON.stringify(c1))));
    t('ein gefuellter Sitz aendert sie',
      M0.fbV9Marke(3, c1) !== M0.fbV9Marke(3, Object.assign({}, c1, { 2: { k: 'late', ts: 1 } })));
    t('ein missgebildeter Eintrag zaehlt nicht als gefuellt',
      M0.fbV9Marke(3, c1) === M0.fbV9Marke(3, Object.assign({}, c1, { 2: { k: 'quatsch' } })));
    t('und ein Ergebnis aendert die Marke der zweiten Barriere',
      M0.fbV9Marke(3, c1, {}) !== M0.fbV9Marke(3, c1, { 0: { k: 'noreveal', ts: 1 } }));
  }
  const bauErschoepft = async () => {
    const u = uhrwerk(11000000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() } }, u);
    a.setzeFehler(P('c/42/0'), new Error('permission_denied'));
    a.setzeFehler(P('c/42/2'), new Error('permission_denied'));
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { pass: true });
    await settle();
    // Die Karte EINMAL zustellen, bevor das Budget verbraucht wird - erst danach sind
    // weitere Zustellungen derselben Karte wirklich identisch. Die erste Zustellung
    // ist selbst eine wesentliche Aenderung und darf neu bewerten.
    a.zustellen(P('c/42'), { 1: a.stand[P('c/42/1')] });
    await settle();
    await u.vor(6300); await u.vor(500); await u.vor(1500);
    return { u: u, a: a, M: M, l: l };
  };
  const zaehl = (g) => g.a.log.schreib.filter(w => w.pfad === P('c/42/0')).length;
  {
    const g = await bauErschoepft();
    t('drei Versuche sind gefallen', zaehl(g) === 3, zaehl(g));
    t('und kein Wecker steht mehr', g.u.anzahl() === 0, g.u.anzahl());
    // Zehn identische Schnappschuesse - das Budget bleibt erschoepft.
    for (let i = 0; i < 10; i++) {
      g.a.zustellen(P('c/42'), { 1: g.a.stand[P('c/42/1')] });
      await settle(4);
    }
    t('zehn identische Schnappschuesse setzen nichts zurueck', zaehl(g) === 3, zaehl(g));
    t('und stellen keinen Wecker', g.u.anzahl() === 0, g.u.anzahl());
    await g.u.vor(120000);
    t('auch nach zwei Minuten kein vierter Versuch', zaehl(g) === 3, zaehl(g));
    // Ein Schnappschuss auf einem ANDEREN Knoten ist ebenfalls kein Anlass.
    for (let i = 0; i < 5; i++) { g.a.zustellen(P('ro/42'), null); await settle(4); }
    t('ein belangloser Schnappschuss auf einem anderen Knoten auch nicht',
      zaehl(g) === 3, zaehl(g));
  }
  {
    // Eine WESENTLICHE Aenderung darf neu bewerten - hier fuellt ein Mitspieler
    // einen der beiden offenen Sitze.
    const g = await bauErschoepft();
    t('vorher drei Versuche', zaehl(g) === 3, zaehl(g));
    g.a.zustellen(P('c/42'), { 1: g.a.stand[P('c/42/1')], 2: { k: 'late', ts: 1 } });
    await settle();
    t('eine wesentliche Aenderung stellt einen neuen Wecker',
      g.u.anzahl() === 1, g.u.anzahl());
    await g.u.vor(6300);
    t('und erlaubt einen weiteren Versuch fuer den noch offenen Sitz',
      zaehl(g) === 4, zaehl(g));
    // Aber wieder begrenzt: hoechstens drei ab dieser Marke.
    await g.u.vor(500); await g.u.vor(1500); await g.u.vor(120000);
    t('auch der neue Durchgang endet nach drei Versuchen', zaehl(g) === 6, zaehl(g));
    t('und laesst keinen Wecker zurueck', g.u.anzahl() === 0, g.u.anzahl());
  }
}
// ══ QUELLTEXT-WAECHTER ═══════════════════════════════════════════════════════
abschnitt('Waechter: die Steuerung ruht');
{
  const NL = String.fromCharCode(10);
  t('der ausgelieferte Client steht auf Protokoll 10',
    /const ONLINE_PROTOCOL_VERSION=10;/.test(HTML));
  // SEIT V9.4C ruft das Spiel an genau zwei Stellen in den ruhenden Bereich hinein:
  // beim Rundenbeginn und am Settlement. Dazu kommt das Abraeumen an den bestehenden
  // Grenzen. Mehr darf es nicht sein - und genau das wird hier gezaehlt, statt jede
  // Nennung zu verbieten.
  // Seit V9.4D2 nennt fastForwardMatch zusaetzlich die gemeinsame Wirkung - das ist
  // der dritte und letzte benannte Beruehrungspunkt zwischen Spiel und v9.
  // Seit V9.4D2 kommen die ECHTEN Einstiege dazu: der Rejoin ruft die Rehydrierung,
  // der frische Start delegiert an sie. Mehr Namen darf das Produkt nicht nennen.
  // Seit V9.5B kommt der Eingabeweg dazu: applyCommit gibt den bereits bereinigten Zug
  // in einem v9-Raum an die Ablaufsteuerung statt in den v8-Zugslot. Das ist der sechste
  // und vorerst letzte benannte Beruehrungspunkt - er wird unten EINZELN gezaehlt, damit
  // die Aufnahme in diese Liste den Waechter nicht aufweicht.
  const HAKEN = ['fbV9LebenNeueRunde', 'fbV9LebenStop', 'fbV9Wirken',
                 'fbV9RaumStart', 'fbV9RaumIst9', 'fbV9Rehydrieren', 'fbV9LebenCtx',
                 'fbV9LebenAn', 'fbV9LebenHandeln', 'fbV9RaumHier',
                 // Hydrations-Barriere: das Eingabetor - whoCanAim und die Stand-Taste fragen,
                 // ob der eigene Slot der laufenden Runde schon bekannt ist. Unten gezaehlt.
                 'fbV9EingabeOffen'];
  const ohneHaken = (txt) => txt.split(/\r?\n/)
    .filter(zl => !HAKEN.some(h => zl.indexOf(h) >= 0)).join('\n');
  t('ausserhalb des ruhenden Bereichs nennt keine Zeile eine v9-Funktion',
    ohneHaken(HTML.split(BEREICH).join('')).indexOf('fbV9') < 0);
  t('die Haken bleiben zaehlbar',
    (HTML.match(/fbV9LebenNeueRunde\(\)/g) || []).length === 4 &&
    (HTML.match(/fbV9LebenStop\(\)/g) || []).length === 8 &&
    (HTML.match(/fbV9Wirken\(/g) || []).length === 3,
    (HTML.match(/fbV9LebenNeueRunde\(\)/g) || []).length + '/' +
    (HTML.match(/fbV9LebenStop\(\)/g) || []).length + '/' +
    (HTML.match(/fbV9Wirken\(/g) || []).length);
  // Der Eingabeweg steht GENAU EINMAL, und zwar mit seiner Bedingung: ohne die Pruefung
  // auf einen aktiven v9-Zusammenhang wuerde ein v8-Raum seinen Zug nicht mehr los.
  t('der Eingabeweg steht genau einmal - mit seiner Bedingung',
    (HTML.match(/if\(typeof fbV9LebenAn==='function'&&fbV9LebenAn\(\)\)\{ if\(fbV9LebenHandeln\(\{move:/g) || []).length === 1,
    (HTML.match(/fbV9LebenHandeln\(/g) || []).length);
  // Das EINGABETOR der Hydrations-Barriere steht GENAU ZWEIMAL ausserhalb des Bereichs:
  // in whoCanAim (Zeiger) und in der Stand-Taste - jeweils mit typeof-Bedingung, damit
  // ein Spiel ohne v9-Bereich unveraendert laeuft. Ein drittes Vorkommen waere ein
  // neuer, ungezaehlter Beruehrungspunkt.
  const AUSSEN = HTML.split(BEREICH).join('');
  t('das Eingabetor steht genau zweimal ausserhalb - Zeiger und Stand-Taste',
    (AUSSEN.match(/typeof fbV9EingabeOffen==='function'&&!fbV9EingabeOffen\(\)/g) || []).length === 2
    && (AUSSEN.match(/fbV9EingabeOffen/g) || []).length === 4,
    (AUSSEN.match(/fbV9EingabeOffen/g) || []).length);
  t('... in whoCanAim nur fuer online, vor der Freigabe des eigenen Sitzes',
    /if\(online\)return \(aimSet\[myPlayer\]\|\|!aliveCount\(myPlayer\)\|\|\(typeof fbV9EingabeOffen==='function'&&!fbV9EingabeOffen\(\)\)\)\?-1:myPlayer;/.test(AUSSEN));
  t('... und in der Stand-Taste nur fuer online, vor dem Nullzug',
    /if\(online&&typeof fbV9EingabeOffen==='function'&&!fbV9EingabeOffen\(\)\)return;/.test(AUSSEN));
  // writeTurnSlot steht seit V9.5B bewusst NICHT mehr in dieser Liste: es ist der einzige
  // Schreibpfad in den v8-Zugslot und traegt deshalb die Sperre, die ihn in einem
  // v9-Raum schweigen laesst. Geprueft wird stattdessen genau diese eine Nennung.
  const wts = grab(/function writeTurnSlot\(s,payload,opts\)\{[\s\S]*?\n\}/, 'writeTurnSlot');
  t('writeTurnSlot() nennt v9 nur fuer die Sperre',
    (wts.match(/fbV9[A-Za-z]*/g) || []).join(',') === 'fbV9RaumHier,fbV9RaumHier',
    (wts.match(/fbV9[A-Za-z]*/g) || []).join(','));
  t('und zwar als erste Anweisung, vor jedem Schreibvorgang',
    /\{\s*(\/\/[^\n]*\n\s*)*if\(typeof fbV9RaumHier==='function'&&fbV9RaumHier\(\)\)return;/.test(wts));
  t('der v8-Pfad selbst bleibt unveraendert',
    /'\/g\/'\+ctx\.gen\+'\/t\/'\+ctx\.turnNo\+'\/'\+s/.test(wts)
    && /runTransaction\(slotRef, current=>current==null\?payload:undefined, \{applyLocally:false\}\)/.test(wts));
  for (const fn of ['onlineSendCommit', 'onlineArmTurn', 'maybeReveal',
                    'processSlot', 'applyLaunch', 'allAliveCommitted', 'beginReveal'])
    t(fn + '() ruft die Steuerung nicht',
      grab(new RegExp('function ' + fn + '\\([^)]*\\)\\{[\\s\\S]*?' + NL + '\\}'), fn)
        .indexOf('fbV9') < 0);
  // onlineArmTurn selbst bleibt unberuehrt: der Haken steht bei seinen AUFRUFERN,
  // damit die Rundennummer weiterhin genau einen Eigentuemer hat.
  // Die SPIELANBINDUNG ist die einzige Schicht, die das Spiel ueberhaupt kennen
  // darf - sie liest die Rundennummer und schliesst dauerhaft abwesende Sitze.
  // Die Protokollschichten darunter duerfen davon nichts wissen, und genau das
  // pruefen die folgenden Schleifen.
  const PROTO = BEREICH.slice(0, BEREICH.indexOf('// ════ V9-SPIELANBINDUNG'));
  const ohneText = PROTO.split(NL).map(zl => { const k = zl.indexOf('//');
    return k >= 0 ? zl.slice(0, k) : zl; }).join(NL);
  for (const w of ['applyLaunch(', 'beginReveal', 'setPhase', 'commitIdx', 'commitAim',
                   'commitSpin', 'aimSet', 'turnNo', 'fbElimLives', 'gameOver', 'balls['])
    t('die Steuerung beruehrt ' + w + ' nicht', ohneText.indexOf(w) < 0);
  // Die STEUERUNG selbst - abgegrenzt ab fbV9EngineCtx - traegt weder Zeitgeber
  // noch Sentinel-Schreiber. Die vier Schreiber liegen seit B2C1 im Adapter
  // darueber; sie zu haben ist etwas anderes, als sie zu benutzen. Gerufen
  // werden sie erst in B2C2.
  const stStart = BEREICH.indexOf('function fbV9EngineCtx(ctx)');
  const stCode = ohneText.slice(ohneText.indexOf('function fbV9EngineCtx(ctx)'));
  t('die Steuerung ist abgegrenzt', stStart > 0);
  // B2C2 bringt Weckrufe - und genau dort verlaeuft die Grenze: setTimeout und
  // serverNow SCHAETZEN, wann ein Versuch Aussicht hat. Sie entscheiden nichts.
  // Verboten bleibt, was eine Abfrageschleife oder eine Clientbefugnis waere.
  for (const w of ['setInterval', 'Date.now'])
    t('kein ' + w + ' in der Steuerung', stCode.indexOf(w) < 0);
  t('setTimeout wird benutzt - einmalig, nicht wiederholend',
    stCode.indexOf('setTimeout') > 0 && stCode.indexOf('setInterval') < 0);
  t('und serverNow nur zur Schaetzung der Wartezeit',
    /frist-jetzt\+FB_V9_WAKE_MARGIN_MS/.test(stCode));
  t('die Frist selbst ist eine benannte Konstante, keine gestreute Zahl',
    /const FB_V9_DEADLINE_MS=6000;/.test(BEREICH));
  // Die Wiederholung ist ENDLICH - das ist der Kern der Zusage.
  t('die Wiederholungen sind auf zwei begrenzt',
    /const FB_V9_RETRY_MS=\[500,1500\];/.test(BEREICH));
  t('und werden gegen diese Grenze geprueft',
    /w\.versuche>=FB_V9_RETRY_MS\.length/.test(stCode));
  // Die Steuerung schliesst offene Slots jetzt selbst - aber nur mit late und
  // noreveal. skip verlangte zusaetzlich die Abwesenheit und braeuchte dafuer einen
  // Praesenzlauscher; remove setzt einen Austragungsmarker voraus, den sie nicht
  // liest. Beide bleiben der Maschinerie, der sie gehoeren.
  for (const w of ['fbV9NetWriteLate', 'fbV9NetWriteNoReveal'])
    t('die Steuerung benutzt ' + w, stCode.indexOf(w) > 0);
  for (const w of ['fbV9NetWriteSkip', 'fbV9NetWriteRemove'])
    t('die Steuerung benutzt ' + w + ' ausdruecklich NICHT', stCode.indexOf(w) < 0);
  // Und sie erzwingt keine Barriere aus einem eigenen Schreibergebnis.
  t('nur der autoritative Schnappschuss traegt die Barriere',
    stCode.indexOf('FB_V9_OPENING_REVEAL;') < 0
    || /fbV9CommitsComplete\(lauf\.ctx\.cap,st\.commits\)/.test(stCode));
  // Ausserhalb des ruhenden Bereichs steht nirgends eine feste Raumversion 9; drinnen
  // baut sie nur den Zusammenhang der Steuerungen, nie einen Raumdatensatz.
  t('kein Produktweg legt einen v9-Raum an',
    HTML.split(BEREICH).join('').indexOf('v:9') < 0 && HTML.indexOf('v: 9') < 0);
  const regeln = fs.readFileSync(path.join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('die Regeldatei traegt weiterhin die v9-Zweige aus V9.1/V9.2',
    regeln.indexOf("child('v').val() === 9") > 0);
}

console.log('\nOnline-V9-Ablauf: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.log('AUSNAHME: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
