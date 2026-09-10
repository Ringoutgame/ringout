// V9.3B2C3C: das gesicherte Geheimnis und die Fortsetzung nach einem Neuladen.
//
// Geprueft wird der ECHTE Quelltext aus index.html gegen deterministische Attrappen
// fuer Firebase, Speicher und Zeit. Kein Emulator, kein Browser, kein Netz, keine
// echten sechs Sekunden.
//
// DIE ZWEI SAETZE, um die es hier geht:
//   1. Gesichert wird VOR dem Senden. Ein Absturz danach hinterlaesst hoechstens ein
//      Geheimnis ohne Commit - harmlos. Umgekehrt bliebe ein unveraenderlicher Commit
//      ohne Salz zurueck, und der Zug waere fuer immer unenthuellbar.
//   2. Ein abgelegtes Geheimnis berechtigt zu NICHTS, solange nicht derselbe Hash
//      unveraenderlich im Raum steht. Lokal einwandfrei heisst nicht: gehoert hierher.
//   node test_online_v9_secret_resume.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));

// ── Attrappen ────────────────────────────────────────────────────────────────
const SENTINEL = { '.sv': 'timestamp' };
function speicher(vorbelegt) {
  const m = new Map(Object.entries(vorbelegt || {}));
  const w = { get: false, set: false, del: false };
  const pruef = (a) => { if (w[a]) throw new Error('Speicher verweigert'); };
  return { inhalt: m, wirf: w,
    get length() { return m.size; }, key: (i) => [...m.keys()][i],
    getItem: (k) => { pruef('get'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { pruef('set'); m.set(k, String(v)); },
    removeItem: (k) => { pruef('del'); m.delete(k); } };
}
function uhrwerk(start) {
  let jetzt = start === undefined ? 5000000 : start, id = 1;
  const offen = new Map();
  return { jetzt: () => jetzt, anzahl: () => offen.size, serverNow: () => jetzt,
    setTimeout: (fn, ms) => { const k = id++; offen.set(k, { faellig: jetzt + ms, fn: fn }); return k; },
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
function attrappe(vorbelegt, uhr, halte) {
  const log = { schreib: [], hoert: [] };
  const stand = Object.assign({}, vorbelegt || {});
  const fehler = {};
  // Zurueckgehaltene Wege: ihre erste Zustellung wartet auf freigeben(pfad). Firebase
  // garantiert keine Reihenfolge zwischen den Zuhoerern - genau das bildet das nach.
  const gehalten = new Set(halte || []), wartend = [];
  return { log: log, stand: stand,
    setzeFehler: (pfad, e) => { fehler[pfad] = e; },
    freigeben: (pfad) => { gehalten.delete(pfad);
      for (const w of wartend.splice(0)) if (w.pfad === pfad) w.los(); else wartend.push(w); },
    zustellen: (pfad, wert) => { stand[pfad] = wert;
      for (const h of log.hoert) if (h.pfad === pfad && h.offen) h.cb({ val: () => wert }); },
    FB: { db: {}, ref: (db, pfad) => ({ pfad: pfad }), serverTimestamp: () => SENTINEL,
      runTransaction: async (ref, fn, opts) => {
        const vorher = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        const vorschlag = fehler[ref.pfad] ? null : fn(vorher);
        log.schreib.push({ pfad: ref.pfad, vorschlag: vorschlag });
        if (fehler[ref.pfad]) throw fehler[ref.pfad];
        if (vorschlag === undefined) return { committed: false, snapshot: { val: () => vorher } };
        const jetzt = uhr ? uhr.jetzt() : 1788700000000;
        const g = JSON.parse(JSON.stringify(vorschlag,
          (k, v) => (v && v['.sv'] === 'timestamp') ? jetzt : v));
        stand[ref.pfad] = g;
        Promise.resolve().then(() => {
          for (const h of log.hoert) if (h.pfad === ref.pfad && h.offen) h.cb({ val: () => g }); });
        return { committed: true, snapshot: { val: () => g } };
      },
      onValue: (ref, cb) => {
        const e = { pfad: ref.pfad, cb: cb, offen: true };
        log.hoert.push(e);
        const v = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        if (gehalten.has(ref.pfad)) wartend.push({ pfad: ref.pfad, los: () => { if (e.offen) cb({ val: () => v }); } });
        else Promise.resolve().then(() => { if (e.offen) cb({ val: () => v }); });
        return () => { e.offen = false; };
      } } };
}

const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-SPIELANBINDUNG ════');
const BEREICH = HTML.slice(START, ENDE);
const STILL = uhrwerk(1000);
const baue = (a, st, uhr) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
    'FB_ONLINE_BALL_IDX', 'serverNow', 'setTimeout', 'clearTimeout', 'sessionStorage', `
  ${BEREICH}
  return { fbV9Start, fbV9Resume, fbV9Action, fbV9UidOk, fbV9SecretAdopt, fbV9SecretFor,
           fbV9SecretClear, fbV9SecretSave, fbV9SecretLoad, fbV9SecretDrop,
           fbV9MakeReveal, fbV9Hex, fbV9Hash, fbV9NewSalt,
           FB_V9_COMPLETE, FB_V9_FAILED, FB_V9_STOPPED, FB_V9_WAIT_COMMITS,
           FB_V9_WAIT_RESULTS, FB_V9_COMMITTING, FB_V9_VALID, FB_V9_NO_REVEAL,
           FB_V9_OK, FB_V9_SAVED, FB_V9_STORE_V, FB_V9_MISMATCH,
           FB_V9_NOT_FOUND, FB_V9_REVEALING };
`)({ FB: a.FB }, globalThis.crypto, 10000, 5, 5,
   (uhr || STILL).serverNow, (uhr || STILL).setTimeout, (uhr || STILL).clearTimeout, st);

const UID = 'UID_RESUME_XXXXXXXXXXXXXXXX', FREMD = 'UID_FREMD_XXXXXXXXXXXXXXXXX';
const H64 = 'ab12'.repeat(16), H32 = '0123456789abcdef'.repeat(2);
const CTX = { v: 9, code: 'RN2K', gen: 7, turn: 42, seat: 1, cap: 3, uid: UID };
const mit = (x) => Object.assign({}, CTX, x);
const P = (r) => 'rooms/RN2K/g/7/' + r;
const KEY = 'ro9:1:RN2K:7:42:1';
const ZUG = { idx: 1, dx: 12.5, dy: -8.25, sp: 0.5 };
const ruhe = () => new Promise(r => setTimeout(r, 0));
const settle = async (n) => { for (let i = 0; i < (n || 14); i++) await ruhe(); };
const NULLT = (k) => ({ k: k, ts: 1 });

console.log('=== V9.3B2C3C: gesichertes Geheimnis und Fortsetzung ===');

(async () => {

// ══ SICHERN VOR DEM SENDEN ═══════════════════════════════════════════════════
abschnitt('Gesichert wird VOR dem Senden');
{
  const st = speicher(), a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M = baue(a, st);
  M.fbV9SecretClear();
  const l = M.fbV9Start(CTX, { move: ZUG });
  await settle();
  t('der Zug wurde gesendet', !!a.stand[P('c/42/1')]);
  t('und das Geheimnis liegt im Speicher', st.inhalt.has(KEY));
  const rec = JSON.parse(st.inhalt.get(KEY));
  t('mit derselben Kennung', rec.uid === UID);
  t('und demselben Hash wie der Commit', rec.h === a.stand[P('c/42/1')].h);
  t('der gespeicherte Vektor ist der kanonische',
    rec.idx === 1 && rec.dx === 12.5 && rec.dy === -8.25 && rec.sp === 0.5);
  l.stop();

  // Und nun der Kern: schlaegt das Sichern fehl, geht der Commit TROTZDEM raus. Das
  // Geheimnis lebt im Arbeitsspeicher; der Speicher ist allein die Absicherung gegen
  // ein Neuladen. (Frueher scheiterte hier der ganze Lauf - ein Client ohne Speicher
  // blieb fuer immer in der Runde stehen: dieselbe Klasse wie der P0-Desync.)
  for (const p of [['ein werfender Speicher', () => { const s2 = speicher(); s2.wirf.set = true; return s2; }],
                   ['gar kein Speicher', () => null]]) {
    const a2 = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M2 = baue(a2, p[1]());
    M2.fbV9SecretClear();
    const l2 = M2.fbV9Start(CTX, { move: ZUG });
    await settle();
    t(p[0] + ': der Lauf scheitert NICHT', l2.stufe !== M2.FB_V9_FAILED, l2.stufe + ' ' + l2.grund);
    t(p[0] + ': das Geheimnis ist als fluechtig vermerkt', l2.geheimnisFluechtig === true);
    const c2 = a2.stand[P('c/42/1')];
    t(p[0] + ': der Commit ging raus', !!c2 && c2.k === 'move');
    t(p[0] + ': es wurde nicht still zu pass',
      !a2.log.schreib.some(w => w.vorschlag && w.vorschlag.k === 'pass'));
    const g2 = M2.fbV9SecretFor('RN2K', 7, 42);
    t(p[0] + ': das Geheimnis lebt im Arbeitsspeicher, mit dem Hash des Commits', !!g2 && g2.h === c2.h);
    l2.stop();
  }
  // Ohne angemeldete Kennung ebenfalls nicht.
  {
    const a3 = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M3 = baue(a3, speicher());
    const l3 = M3.fbV9Start(mit({ uid: '' }), { move: ZUG });
    await l3.fertig;
    t('ohne Kennung: gescheitert', l3.stufe === M3.FB_V9_FAILED, l3.grund);
    t('und nichts gesendet', !a3.log.schreib.some(w => w.pfad === P('c/42/1')));
  }
  // Eine Nullhandlung legt nichts ab - sie hat nichts zu verbergen.
  {
    const s4 = speicher(), a4 = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M4 = baue(a4, s4);
    const l4 = M4.fbV9Start(CTX, { pass: true });
    await settle();
    t('pass legt kein Geheimnis ab', s4.inhalt.size === 0, s4.inhalt.size);
    t('und wird trotzdem gesendet', a4.stand[P('c/42/1')].k === 'pass');
    l4.stop();
  }
}

// ══ WAS NACH DEM SENDEN GERAEUMT WIRD - UND WAS NICHT ════════════════════════
abschnitt('Raeumen nur, wenn es sicher ist');
{
  const bau = async (vorbelegt, fehlerAuf) => {
    const st = speicher(), a = attrappe(Object.assign({ [P('d/42')]: { n: 42, o: 1 } }, vorbelegt || {}));
    if (fehlerAuf) a.setzeFehler(fehlerAuf[0], fehlerAuf[1]);
    const M = baue(a, st); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { move: ZUG });
    await settle();
    return { st: st, a: a, M: M, l: l };
  };
  {
    const g = await bau();
    t('nach COMMITTED bleibt das Geheimnis', g.st.inhalt.has(KEY));
    t('und liegt auch im Arbeitsspeicher', !!g.M.fbV9SecretFor('RN2K', 7, 42));
    g.l.stop();
  }
  {
    // Dort steht schon etwas ANDERES - das gesicherte Geheimnis ist wertlos.
    const g = await bau({ [P('c/42/1')]: { k: 'pass', ts: 1 } });
    await g.l.fertig;
    t('ein unvertraeglicher Fremdeintrag laesst den Lauf scheitern',
      g.l.stufe === g.M.FB_V9_FAILED, g.l.stufe);
    t('und raeumt genau dieses Geheimnis', !g.st.inhalt.has(KEY));
    t('auch aus dem Arbeitsspeicher', g.M.fbV9SecretFor('RN2K', 7, 42) === null);
  }
  {
    const p = ['ein Netzfehler', new Error('network down')];
    const g = await bau({}, [P('c/42/1'), p[1]]);
    await g.l.fertig;
    t(p[0] + ' laesst den Lauf scheitern', g.l.stufe === g.M.FB_V9_FAILED, g.l.stufe);
    // DAS ist der Punkt: bei einem Netzfehler weiss niemand, ob der Server den Commit
    // noch angenommen hat. Das Geheimnis ist dann die einzige Rettung.
    t(p[0] + ': das Geheimnis bleibt erhalten', g.st.inhalt.has(KEY));
    t(p[0] + ': und auch im Arbeitsspeicher', !!g.M.fbV9SecretFor('RN2K', 7, 42));
  }
  {
    // EINE ABWEISUNG ist etwas anderes als ein Netzfehler: die Rules haben den Zug
    // nicht angenommen - im Regelfall, weil die Frist nach Serverzeit vorbei war.
    // Das ist KEIN Scheitern der Runde (P0-Desync-Diagnose 01: ein gescheiterter Lauf
    // liess den Client fuer immer in der Runde stehen, waehrend die Mitspieler ihn
    // disqualifizierten und allein weiterspielten). Der Zug ist verworfen, der Lauf
    // wartet an der Barriere, und das eigene Terminal kommt als `late` aus dem Raum.
    const g = await bau({}, [P('c/42/1'), new Error('permission_denied')]);
    await settle();
    t('eine Abweisung laesst den Lauf NICHT scheitern', g.l.stufe !== g.M.FB_V9_FAILED, g.l.stufe + ' ' + g.l.grund);
    t('er wartet an der Commit-Barriere', g.l.stufe === g.M.FB_V9_WAIT_COMMITS, g.l.stufe);
    t('der Zug ist verworfen', g.l.verworfen === true && g.l.terminal === null);
    t('Abweisung: das Geheimnis bleibt vorerst erhalten', g.st.inhalt.has(KEY));
    const vorher = g.a.log.schreib.filter(w => w.pfad === P('c/42/1')).length;
    await settle();
    t('und der Zug wird nicht erneut gesendet', g.a.log.schreib.filter(w => w.pfad === P('c/42/1')).length === vorher, vorher);
    // Ein Mitspieler schliesst den Slot nach der Frist mit `late` - genau wie bei einem
    // Sitz, der geschwiegen hat.
    g.a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: NULLT('late'), 2: NULLT('pass') });
    await settle();
    t('das autoritative late wird als eigenes Terminal uebernommen',
      g.l.terminal && g.l.terminal.k === 'late' && g.l.commitFertig === true, JSON.stringify(g.l.terminal));
    t('die Barriere ist damit ueberwunden - kein Scheitern', g.l.stufe !== g.M.FB_V9_FAILED && g.l.stufe !== g.M.FB_V9_WAIT_COMMITS, g.l.stufe);
    t('und erst JETZT ist das Geheimnis geraeumt', !g.st.inhalt.has(KEY) && g.M.fbV9SecretFor('RN2K', 7, 42) === null);
    t('immer noch kein zweiter Sendeversuch', g.a.log.schreib.filter(w => w.pfad === P('c/42/1')).length === vorher);
    g.l.stop();
  }
  {
    // Derselbe Ausloeser, anderer Zeitpunkt: ein Mitspieler hat den eigenen Slot nach
    // der Frist schon mit `late` geschlossen, BEVOR das eigene Loslassen ankam. Die
    // Transaktion meldet dann EXISTS mit dem fremden Fristschluss - kein Scheitern.
    const g = await bau({ [P('c/42/1')]: NULLT('late'), [P('c/42')]: { 1: NULLT('late') } });
    await settle();
    t('ein fremdes late im eigenen Slot laesst den Lauf NICHT scheitern', g.l.stufe !== g.M.FB_V9_FAILED, g.l.stufe + ' ' + g.l.grund);
    t('das late wird als eigenes Terminal uebernommen', g.l.terminal && g.l.terminal.k === 'late' && g.l.commitFertig === true, JSON.stringify(g.l.terminal));
    t('und das Geheimnis dazu ist geraeumt', !g.st.inhalt.has(KEY) && g.M.fbV9SecretFor('RN2K', 7, 42) === null);
    t('der eigene Zug wird nicht nachgeschoben', !g.a.log.schreib.some(w => w.pfad === P('c/42/1') && w.vorschlag && w.vorschlag.k === 'move' && g.l.verworfen !== true) || g.l.verworfen === true);
    g.l.stop();
  }
  {
    // Ein ANDERER Zug im eigenen Slot (zweiter Tab derselben Kennung) bleibt ein echter
    // Widerspruch und scheitert wie bisher.
    const g = await bau({ [P('c/42/1')]: { k: 'move', h: H64, ts: 1 }, [P('c/42')]: { 1: { k: 'move', h: H64, ts: 1 } } });
    await g.l.fertig;
    t('ein fremder move im eigenen Slot scheitert weiterhin', g.l.stufe === g.M.FB_V9_FAILED, g.l.stufe);
  }
}

// ══ FORTSETZEN ═══════════════════════════════════════════════════════════════
abschnitt('Fortsetzen nach dem Neuladen');
{
  // Erst eine echte Runde spielen, dann mit demselben Speicher neu beginnen -
  // genau das, was ein F5 tut: neuer Arbeitsspeicher, alter sessionStorage.
  const nachNeuladen = async (opt) => {
    opt = opt || {};
    const st = speicher();
    const a1 = attrappe({ [P('d/42')]: { n: 42, o: 1 } });
    const M1 = baue(a1, st); M1.fbV9SecretClear();
    const l1 = M1.fbV9Start(CTX, { move: ZUG });
    await settle();
    const commit = a1.stand[P('c/42/1')];
    l1.stop();
    if (opt.verfaelsche) st.inhalt.set(KEY, opt.verfaelsche(st.inhalt.get(KEY)));
    if (opt.loesche) st.inhalt.delete(KEY);
    // Der zweite Lauf: neuer Bau (leerer Arbeitsspeicher), gleicher Speicher.
    const raum = Object.assign({ [P('d/42')]: { n: 42, o: 1 } }, opt.raum || {});
    // Der Zuhoerer liest die KARTE c/<turn>; der Einzelpfad allein erreicht ihn nicht.
    if (!opt.ohneCommit) { const k = opt.commit || commit;
      raum[P('c/42/1')] = k; raum[P('c/42')] = { 1: k }; }
    const a2 = attrappe(raum, opt.uhr);
    const M2 = baue(a2, opt.speicher === null ? null : st, opt.uhr);
    M2.fbV9SecretClear();
    const l2 = M2.fbV9Resume(opt.ctx || CTX);
    await settle();
    return { st: st, a: a2, M: M2, l: l2, commit: commit };
  };
  {
    const g = await nachNeuladen();
    t('der Lauf uebernimmt sein eigenes Terminal aus dem Raum',
      g.l.terminal && g.l.terminal.k === 'move', g.l.terminal && g.l.terminal.k);
    t('und ist nicht gescheitert', g.l.stufe !== g.M.FB_V9_FAILED, g.l.stufe + ' ' + g.l.grund);
    t('das Geheimnis ist zurueck im Arbeitsspeicher', !!g.M.fbV9SecretFor('RN2K', 7, 42));
    const s = g.M.fbV9SecretFor('RN2K', 7, 42);
    t('mit exakt demselben Vektor',
      s.idx === 1 && s.dx === 12.5 && s.dy === -8.25 && s.sp === 0.5);
    t('und exakt demselben Hash', s.h === g.commit.h);
    t('das Salz ist unveraendert - kein neues erzeugt',
      g.M.fbV9Hex(s.salt) === JSON.parse(g.st.inhalt.get(KEY)).salt);
    t('kein neuer Commit wurde gesendet',
      !g.a.log.schreib.some(w => w.pfad === P('c/42/1')));
    t('und der Lauf wartet auf die Barriere', g.l.stufe === g.M.FB_V9_WAIT_COMMITS, g.l.stufe);
    // Und die Enthuellung ist bitgleich die, die vor dem Neuladen entstanden waere.
    const rev = g.M.fbV9MakeReveal({ room: 'RN2K', gen: 7, turn: 42, seat: 1 });
    t('die Enthuellung traegt genau die gesicherten Werte',
      rev.idx === 1 && rev.dx === 12.5 && rev.dy === -8.25 && rev.sp === 0.5
      && rev.n === JSON.parse(g.st.inhalt.get(KEY)).salt);
    g.l.stop();
  }
  {
    // Der ganze Weg bis zum Abschluss - nach dem Neuladen.
    const g = await nachNeuladen();
    g.a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: g.commit, 2: NULLT('pass') });
    await settle();
    t('die Enthuellung wird eroeffnet', typeof g.a.stand[P('ro/42')] === 'number');
    await settle();
    const r = g.a.stand[P('r/42/1')];
    t('und das wiederhergestellte Geheimnis wird enthuellt', !!r && r.k === 'reveal');
    t('mit dem gesicherten Salz', r.n === JSON.parse(g.st.inhalt.get(KEY)).salt);
    g.a.zustellen(P('r/42'), { 1: r });
    await g.l.fertig;
    t('der Lauf wird COMPLETE', g.l.stufe === g.M.FB_V9_COMPLETE, g.l.stufe + ' ' + g.l.grund);
    t('der eigene Zug ist geprueft gueltig', g.l.menge[1].status === g.M.FB_V9_VALID);
    t('und das Geheimnis ist geraeumt - im Speicher', !g.st.inhalt.has(KEY));
    t('und im Arbeitsspeicher', g.M.fbV9SecretFor('RN2K', 7, 42) === null);
  }
  {
    // Eine bereits vorhandene eigene Enthuellung ist vertraeglich.
    const st = speicher();
    const a1 = attrappe({ [P('d/42')]: { n: 42, o: 1 } });
    const M1 = baue(a1, st); M1.fbV9SecretClear();
    const l1 = M1.fbV9Start(CTX, { move: ZUG });
    await settle();
    const commit = a1.stand[P('c/42/1')];
    const rev = M1.fbV9MakeReveal({ room: 'RN2K', gen: 7, turn: 42, seat: 1 });
    rev.ts = 1; l1.stop();
    const a2 = attrappe({ [P('d/42')]: { n: 42, o: 1 }, [P('c/42/1')]: commit,
                          [P('c/42')]: { 1: commit },
                          [P('ro/42')]: 5, [P('r/42/1')]: rev, [P('r/42')]: { 1: rev } });
    const M2 = baue(a2, st); M2.fbV9SecretClear();
    const l2 = M2.fbV9Resume(CTX);
    await settle();
    a2.zustellen(P('c/42'), { 0: NULLT('pass'), 1: commit, 2: NULLT('pass') });
    await settle();
    a2.zustellen(P('r/42'), { 1: rev });
    await l2.fertig;
    t('eine schon vorhandene eigene Enthuellung ist vertraeglich',
      l2.stufe === M2.FB_V9_COMPLETE, l2.stufe + ' ' + l2.grund);
    t('und der Zug bleibt gueltig', l2.menge[1].status === M2.FB_V9_VALID);
  }
}

// ══ DIE BINDUNG AN DEN ECHTEN COMMIT ═════════════════════════════════════════
abschnitt('Ein Geheimnis berechtigt nur zusammen mit SEINEM Commit');
{
  const vorbereiten = async () => {
    const st = speicher(), a = attrappe({ [P('d/42')]: { n: 42, o: 1 } });
    const M = baue(a, st); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { move: ZUG });
    await settle();
    const commit = a.stand[P('c/42/1')];
    l.stop();
    return { st: st, commit: commit };
  };
  const { st, commit } = await vorbereiten();
  const pruefe = async (ctx, kommit) => {
    const M = baue(attrappe(), st); M.fbV9SecretClear();
    const ok = await M.fbV9SecretAdopt(ctx, kommit);
    return { ok: ok, M: M };
  };
  t('derselbe Hash bindet', (await pruefe(CTX, commit)).ok === 'OK');
  // HASH_MISMATCH ist ausdruecklich NICHT dasselbe wie `nichts gefunden`: dort steht
  // autoritativ ein anderer Zug, das gespeicherte Geheimnis ist beweisbar wertlos.
  t('ein anderer Hash bindet NICHT',
    (await pruefe(CTX, { k: 'move', h: H64, ts: 1 })).ok === 'HASH_MISMATCH');
  for (const k of ['pass', 'late', 'skip', 'remove'])
    t('ein ' + k + '-Terminal bindet kein Geheimnis',
      (await pruefe(CTX, { k: k, ts: 1 })).ok === 'NOT_FOUND');
  t('gar kein Commit bindet nicht', (await pruefe(CTX, null)).ok === 'NOT_FOUND');
  t('eine fremde Kennung bindet nicht', (await pruefe(mit({ uid: FREMD }), commit)).ok === 'NOT_FOUND');
  // players/<seat>/uid ist der Sitzbesitz - nicht das Praesenztoken.
  t('gehoert der Sitz einem anderen Konto, wird nicht gebunden',
    (await pruefe(mit({ seatUid: FREMD }), commit)).ok === 'NOT_FOUND');
  t('gehoert er der eigenen Kennung, schon',
    (await pruefe(mit({ seatUid: UID }), commit)).ok === 'OK');
  for (const p of [['ein anderer Raum', mit({ code: 'ABCD' })], ['eine andere Generation', mit({ gen: 8 })],
                   ['eine andere Runde', mit({ turn: 43 })], ['ein anderer Sitz', mit({ seat: 0 })]])
    t(p[0] + ' findet kein Geheimnis', (await pruefe(p[1], commit)).ok === 'NOT_FOUND');
  {
    // Ein lokal verfaelschter Datensatz faellt schon in der ersten Ebene durch.
    const s2 = speicher(Object.fromEntries(st.inhalt));
    const rec = JSON.parse(s2.inhalt.get(KEY)); rec.dx = 99;
    s2.inhalt.set(KEY, JSON.stringify(rec));
    const M = baue(attrappe(), s2); M.fbV9SecretClear();
    t('ein verfaelschter Vektor bindet nicht',
      (await M.fbV9SecretAdopt(CTX, commit)) === 'NOT_FOUND');
  }
  {
    const M = baue(attrappe(), null); M.fbV9SecretClear();
    t('ohne Speicher bindet nichts', (await M.fbV9SecretAdopt(CTX, commit)) === 'NOT_FOUND');
  }
}

// ══ VERLORENES GEHEIMNIS ═════════════════════════════════════════════════════
abschnitt('Verlorenes Geheimnis - warten, nicht erfinden');
{
  const ohneGeheimnis = async (art) => {
    const st = speicher(), a0 = attrappe({ [P('d/42')]: { n: 42, o: 1 } });
    const M0 = baue(a0, st); M0.fbV9SecretClear();
    const l0 = M0.fbV9Start(CTX, { move: ZUG });
    await settle();
    const commit = a0.stand[P('c/42/1')];
    l0.stop();
    if (art === 'weg') st.inhalt.delete(KEY);
    if (art === 'kaputt') st.inhalt.set(KEY, '{nicht json');
    const u = uhrwerk(6000000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() }, [P('c/42/1')]: commit,
                         [P('c/42')]: { 1: commit } }, u);
    const M = baue(a, art === 'kein Speicher' ? null : st, u);
    M.fbV9SecretClear();
    const l = M.fbV9Resume(CTX);
    await settle();
    return { u: u, a: a, M: M, l: l, commit: commit, st: st };
  };
  for (const art of ['weg', 'kaputt', 'kein Speicher']) {
    const g = await ohneGeheimnis(art);
    t(art + ': der Lauf ist NICHT gescheitert', g.l.stufe !== g.M.FB_V9_FAILED, g.l.stufe);
    t(art + ': er ist als verloren vermerkt', g.l.verloren === true);
    t(art + ': und kein Geheimnis im Arbeitsspeicher',
      g.M.fbV9SecretFor('RN2K', 7, 42) === null);
    // Weiter durch die Barriere - und dann NICHTS enthuellen.
    g.a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: g.commit, 2: NULLT('pass') });
    await settle();
    t(art + ': die Enthuellung wird trotzdem eroeffnet',
      typeof g.a.stand[P('ro/42')] === 'number');
    await settle();
    t(art + ': aber KEINE eigene Enthuellung geschrieben',
      !g.a.log.schreib.some(w => w.pfad === P('r/42/1')));
    t(art + ': der Lauf wartet auf die Ergebnisse',
      g.l.stufe === g.M.FB_V9_WAIT_RESULTS, g.l.stufe);
    // Und nach der Frist schliesst die vorhandene Mechanik den Slot.
    await g.u.vor(6300);
    const nr = g.a.log.schreib.filter(w => w.vorschlag && w.vorschlag.k === 'noreveal');
    t(art + ': nach der Frist schliesst noreveal den Slot', nr.length >= 1, nr.length);
    t(art + ': und zwar auf dem eigenen Ergebnispfad',
      nr.some(w => w.pfad === P('r/42/1')));
    // Kein neues Salz, keine Umdeutung zu pass, keine Spielfolge.
    t(art + ': kein pass untergeschoben',
      !g.a.log.schreib.some(w => w.vorschlag && w.vorschlag.k === 'pass'));
  }
}

// ══ SPEICHER NICHT VERFUEGBAR - KEIN EINFRIEREN ══════════════════════════
abschnitt('Speicher nicht verfuegbar - kein Einfrieren');
{
  // Fuenf Arten, auf die der sessionStorage im Feld ausfaellt (Privatmodus, Richtlinie,
  // Kontingent, Sandkasten). Keine davon darf den Lauf einer lebenden Seite scheitern
  // lassen, und die Verdeckung bleibt in jeder dieselbe: 128-Bit-Salz, SHA-256, ein
  // Commit, eine Enthuellung mit genau diesem Salz.
  const wirft = (was) => { const s = speicher(); s.wirf[was] = true; return s; };
  const zugriffWirft = () => new Proxy({}, { get: () => { throw new Error('SecurityError: storage access denied'); } });
  const ARTEN = [
    ['A Zugriff wirft', zugriffWirft, false],
    ['B setItem wirft', () => wirft('set'), false],
    ['C getItem wirft', () => wirft('get'), false],
    ['D removeItem wirft', () => wirft('del'), true],
    ['E von Anfang an kein Speicher', () => null, false],
  ];
  // (i) Die lebende Seite: eine volle Runde, unveraendertes Protokoll.
  for (const [art, mach] of ARTEN) {
    const st = mach(), a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M = baue(a, st);
    M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { move: ZUG });
    await settle();
    const c = a.stand[P('c/42/1')];
    t(art + ': der Lauf scheitert nicht', l.stufe !== M.FB_V9_FAILED, l.stufe + ' ' + l.grund);
    t(art + ': genau EIN Commit ging raus',
      !!c && c.k === 'move' && a.log.schreib.filter(w => w.pfad === P('c/42/1')).length === 1);
    t(art + ': und er traegt keinen Klartext', !!c && !('dx' in c) && !('dy' in c) && !('n' in c) && /^[0-9a-f]{64}$/.test(c.h));
    const g = M.fbV9SecretFor('RN2K', 7, 42);
    t(art + ': das Geheimnis lebt im Arbeitsspeicher mit dem Hash des Commits', !!g && g.h === c.h);
    const salz = M.fbV9Hex(g.salt);
    a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: c, 2: NULLT('pass') });
    await settle();
    const r = a.stand[P('r/42/1')];
    t(art + ': die Enthuellung kommt mit GENAU diesem Salz und Vektor',
      !!r && r.k === 'reveal' && r.n === salz && r.idx === 1 && r.dx === 12.5 && r.dy === -8.25 && r.sp === 0.5,
      JSON.stringify(r));
    t(art + ': kein zweites Salz, kein zweiter Commit',
      a.log.schreib.filter(w => w.pfad === P('c/42/1')).length === 1 && a.log.schreib.filter(w => w.pfad === P('r/42/1')).length === 1);
    a.zustellen(P('r/42'), { 1: r });
    await settle();
    t(art + ': die Runde wird fertig', l.stufe === M.FB_V9_COMPLETE, l.stufe + ' ' + l.grund);
    t(art + ': danach ist das Geheimnis geraeumt', M.fbV9SecretFor('RN2K', 7, 42) === null);
    l.stop();
  }
  // (ii) Fortsetzen INNERHALB derselben Seite (kein Neuladen, z. B. Rehydrierung bei
  //      offener Runde): der Arbeitsspeicher berechtigt, weil sein Hash der des
  //      unveraenderlichen Commits ist - und nur dann.
  {
    const a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M = baue(a, null);
    M.fbV9SecretClear();
    const l1 = M.fbV9Start(CTX, { move: ZUG });
    await settle();
    const c = a.stand[P('c/42/1')];
    l1.stop();
    const g = M.fbV9SecretFor('RN2K', 7, 42);
    t('gleiche Seite ohne Speicher: das Geheimnis ist noch da', !!g);
    const salz = M.fbV9Hex(g.salt);
    t('es bindet an den eigenen Commit', (await M.fbV9SecretAdopt(CTX, c)) === M.FB_V9_OK);
    t('aber NICHT an einen fremden Hash', (await M.fbV9SecretAdopt(CTX, { k: 'move', h: H64, ts: 1 })) === M.FB_V9_NOT_FOUND);
    a.zustellen(P('c/42'), { 1: c });
    const l2 = M.fbV9Resume(CTX);
    await settle();
    t('der Fortsetzer scheitert nicht', l2.stufe !== M.FB_V9_FAILED, l2.stufe + ' ' + l2.grund);
    t('und uebernimmt sein Terminal aus dem Raum', l2.terminal && l2.terminal.h === c.h);
    a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: c, 2: NULLT('pass') });
    await settle();
    const r = a.stand[P('r/42/1')];
    t('er enthuellt mit demselben Salz - kein neues', !!r && r.n === salz && r.dx === 12.5, JSON.stringify(r));
    t('und hat den Commit nie erneut gesendet', a.log.schreib.filter(w => w.pfad === P('c/42/1')).length === 1);
    a.zustellen(P('r/42'), { 1: r });
    await settle();
    t('die Runde wird fertig', l2.stufe === M.FB_V9_COMPLETE, l2.stufe);
    l2.stop();
  }
  // (iii) NEULADEN: neuer Arbeitsspeicher, derselbe (ausgefallene) Speicher. Ohne
  //       wiederherstellbares Geheimnis wird NICHTS erfunden - keine Enthuellung, kein
  //       zweites Salz, kein Scheitern; nach der Frist schliesst noreveal den Slot und
  //       die Folge (NO_REVEAL) tragen alle gleich. Nur D (removeItem wirft) hat einen
  //       lesbaren Datensatz und kehrt voll zurueck.
  for (const [art, mach, lesbar] of ARTEN) {
    const st = mach();
    const a0 = attrappe({ [P('d/42')]: { n: 42, o: 1 } }), M0 = baue(a0, st);
    M0.fbV9SecretClear();
    const l0 = M0.fbV9Start(CTX, { move: ZUG });
    await settle();
    const c = a0.stand[P('c/42/1')];
    l0.stop();
    const u = uhrwerk(6000000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: u.jetzt() }, [P('c/42/1')]: c, [P('c/42')]: { 1: c } }, u);
    const M = baue(a, st, u);
    M.fbV9SecretClear();   // das Neuladen: leerer Arbeitsspeicher
    const l = M.fbV9Resume(CTX);
    await settle();
    t(art + ' nach Neuladen: der Lauf scheitert nicht', l.stufe !== M.FB_V9_FAILED, l.stufe + ' ' + l.grund);
    t(art + ' nach Neuladen: kein neuer Commit', !a.log.schreib.some(w => w.pfad === P('c/42/1')));
    if (lesbar) {
      t(art + ' nach Neuladen: das Geheimnis ist zurueck', !!M.fbV9SecretFor('RN2K', 7, 42) && M.fbV9SecretFor('RN2K', 7, 42).h === c.h);
      t(art + ' nach Neuladen: nicht als verloren vermerkt', l.verloren !== true);
    } else {
      t(art + ' nach Neuladen: als verloren vermerkt', l.verloren === true);
      t(art + ' nach Neuladen: kein Geheimnis im Arbeitsspeicher', M.fbV9SecretFor('RN2K', 7, 42) === null);
    }
    a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: c, 2: NULLT('pass') });
    await settle();
    t(art + ' nach Neuladen: die Enthuellung wird eroeffnet', typeof a.stand[P('ro/42')] === 'number');
    await settle();
    if (lesbar) {
      const r = a.stand[P('r/42/1')];
      t(art + ' nach Neuladen: enthuellt mit dem gesicherten Salz', !!r && r.n === JSON.parse(st.inhalt.get(KEY)).salt);
    } else {
      t(art + ' nach Neuladen: KEINE eigene Enthuellung', !a.log.schreib.some(w => w.pfad === P('r/42/1')));
      await u.vor(6300);
      const nr = a.log.schreib.filter(w => w.vorschlag && w.vorschlag.k === 'noreveal');
      t(art + ' nach Neuladen: noreveal schliesst den eigenen Slot nach der Frist', nr.some(w => w.pfad === P('r/42/1')), nr.length);
      t(art + ' nach Neuladen: kein pass untergeschoben, kein neues Salz',
        !a.log.schreib.some(w => w.vorschlag && (w.vorschlag.k === 'pass' || w.vorschlag.k === 'reveal')));
    }
    l.stop();
  }
}

// ══ VERWAISTES / MEHRDEUTIGES GEHEIMNIS ══════════════════════════
abschnitt('Geheimnis da, eigener Commit nicht zu sehen');
{
  // DER FEHLER, der hier behoben ist: die Fortsetzung kehrte in COMMITTING zurueck,
  // wenn das eigene Terminal nicht im Raum stand. COMMITTING stellt keinen Wecker -
  // der wird erst in WAIT_COMMITS geplant. Ein Client, dessen Commit vor dem
  // Neuladen vielleicht angekommen war und vielleicht nicht, waere damit endlos
  // haengengeblieben: kein Wecker, keine Frist, kein `late`, kein Fortschritt.
  // Jetzt faellt er bis zur Barriere durch - ohne den alten Zug erneut zu senden.
  const verwaist = async (u, vorbelegt) => {
    const st = speicher(), a0 = attrappe({ [P('d/42')]: { n: 42, o: 1 } });
    const M0 = baue(a0, st); M0.fbV9SecretClear();
    const l0 = M0.fbV9Start(CTX, { move: ZUG });
    await settle();
    const commit = a0.stand[P('c/42/1')];
    l0.stop();
    // Neu geladen. Der Raum zeigt unser Terminal NICHT - ob der Commit nie ankam
    // oder ob wir ihn nur noch nicht sehen, ist von hier aus nicht zu unterscheiden.
    const a = attrappe(Object.assign({ [P('d/42')]: { n: 42, o: u.jetzt() } },
                                     vorbelegt || {}), u);
    const M = baue(a, st, u); M.fbV9SecretClear();
    const l = M.fbV9Resume(CTX);
    await settle();
    return { st: st, a: a, M: M, l: l, commit: commit, u: u };
  };
  const spaet = (g) => g.a.log.schreib.filter(w => w.vorschlag && w.vorschlag.k === 'late');
  const eigeneZuege = (g) => g.a.log.schreib.filter(
    w => w.pfad === P('c/42/1') && w.vorschlag && w.vorschlag.k === 'move');

  // ────────── Lebendigkeit: die Frist greift auch ohne eigenes Terminal ──────────
  {
    const g = await verwaist(uhrwerk(7000000));
    t('der Lauf steht an der Barriere, nicht in COMMITTING',
      g.l.stufe === g.M.FB_V9_WAIT_COMMITS, g.l.stufe);
    t('und ist nicht gescheitert', g.l.stufe !== g.M.FB_V9_FAILED, g.l.grund);
    t('der alte Zug wird NICHT erneut gesendet', eigeneZuege(g).length === 0);
    t('das Geheimnis wird nicht uebernommen', g.M.fbV9SecretFor('RN2K', 7, 42) === null);
    t('ein Wecker ist gestellt', g.u.anzahl() === 1, g.u.anzahl());
    t('das Geheimnis bleibt liegen, obwohl c/42/1 gerade leer ist',
      g.st.inhalt.has(KEY));
    await g.u.vor(5000);
    t('vor der Frist faellt kein late', spaet(g).length === 0, spaet(g).length);
    await g.u.vor(1300);
    t('nach der Frist wird geschlossen', spaet(g).length === 3, spaet(g).length);
    t('auch der EIGENE Sitz wird geschlossen - genau das war der Stillstand',
      spaet(g).some(w => w.pfad === P('c/42/1')));
    t('und zwar aufsteigend ueber alle Sitze',
      spaet(g).map(w => w.pfad).join('|') ===
      [P('c/42/0'), P('c/42/1'), P('c/42/2')].join('|'));
    t('bis hierher wurde das Geheimnis nicht angeruehrt', g.st.inhalt.has(KEY));
    // Erst der autoritative Schnappschuss bewegt die Barriere.
    g.a.zustellen(P('c/42'), { 0: NULLT('late'), 1: NULLT('late'), 2: NULLT('late') });
    await settle();
    t('jetzt gilt late als eigenes Terminal',
      g.l.stufe !== g.M.FB_V9_WAIT_COMMITS, g.l.stufe);
    t('und das verwaiste Geheimnis wird verworfen', !g.st.inhalt.has(KEY));
    t('ohne Enthuellung', !g.a.log.schreib.some(w => w.pfad === P('r/42/1')));
    t('der alte Zug wurde nie gesendet', eigeneZuege(g).length === 0);
    g.l.stop();
  }

  // ────────── Mehrdeutig: der Commit war doch angekommen ──────────
  {
    const g = await verwaist(uhrwerk(7100000));
    t('zunaechst wartend', g.l.stufe === g.M.FB_V9_WAIT_COMMITS, g.l.stufe);
    g.a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: g.commit, 2: NULLT('pass') });
    await settle();
    const rev = g.a.log.schreib.filter(w => w.pfad === P('r/42/1'));
    t('der spaet sichtbare eigene Commit bindet das aufbewahrte Geheimnis',
      rev.length === 1, rev.length);
    t('und enthuellt GENAU den gespeicherten Zug',
      rev.length === 1 && rev[0].vorschlag.k === 'reveal' && rev[0].vorschlag.idx === 1 &&
      rev[0].vorschlag.dx === 12.5 && rev[0].vorschlag.dy === -8.25 &&
      rev[0].vorschlag.sp === 0.5,
      rev.length ? JSON.stringify(rev[0].vorschlag) : 'keine');
    t('kein noreveal', !g.a.log.schreib.some(w => w.vorschlag && w.vorschlag.k === 'noreveal'));
    t('und noch immer kein zweiter Zug', eigeneZuege(g).length === 0);
    g.l.stop();
  }

  // ────────── Ein FREMDER Zug steht im eigenen Slot ──────────
  {
    const g = await verwaist(uhrwerk(7200000));
    g.a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: { k: 'move', h: H64, ts: 1 },
                               2: NULLT('pass') });
    await settle();
    t('ein anderer Hash bindet das Geheimnis nicht',
      !g.a.log.schreib.some(w => w.pfad === P('r/42/1') && w.vorschlag &&
                                 w.vorschlag.k === 'reveal'));
    t('genau dieser eine Datensatz wird verworfen', !g.st.inhalt.has(KEY));
    t('aber der Lauf scheitert nicht', g.l.stufe !== g.M.FB_V9_FAILED, g.l.grund);
    await g.u.vor(20000);
    t('nach der Frist schliesst noreveal den Slot',
      g.a.log.schreib.some(w => w.pfad === P('r/42/1') && w.vorschlag &&
                                w.vorschlag.k === 'noreveal'));
    g.l.stop();
  }

  // ────────── Ein Nullterminal steht im eigenen Slot ──────────
  for (const k of ['pass', 'skip', 'remove', 'late']) {
    const g = await verwaist(uhrwerk(7300000));
    g.a.zustellen(P('c/42'), { 0: NULLT('pass'), 1: NULLT(k), 2: NULLT('pass') });
    await settle();
    t(k + ': das Geheimnis ist erwiesen verwaist und wird verworfen', !g.st.inhalt.has(KEY));
    t(k + ': keine Enthuellung', !g.a.log.schreib.some(w => w.pfad === P('r/42/1')));
    t(k + ': kein Zug nachgeschoben', eigeneZuege(g).length === 0);
    g.l.stop();
  }

  // ────────── Rauschen erzeugt weder Zuege noch unbegrenzt Wecker ──────────
  {
    const g = await verwaist(uhrwerk(7400000));
    const karte = { 0: NULLT('pass') };
    for (let i = 0; i < 12; i++) { g.a.zustellen(P('c/42'), karte); await settle(4); }
    t('zwoelf gleiche Schnappschuesse ergeben einen Wecker, nicht zwoelf',
      g.u.anzahl() === 1, g.u.anzahl());
    t('und keinen einzigen erneuten Zug', eigeneZuege(g).length === 0);
    t('das Geheimnis liegt weiter bereit', g.st.inhalt.has(KEY));
    t('der Lauf wartet unveraendert an der Barriere',
      g.l.stufe === g.M.FB_V9_WAIT_COMMITS, g.l.stufe);
    g.l.stop();
  }

  // ────────── Erschoepftes Budget: kein Zug, kein Verlust des Geheimnisses ──────────
  {
    const u = uhrwerk(7500000);
    const g = await verwaist(u);
    g.a.setzeFehler(P('c/42/1'), new Error('permission_denied'));
    await u.vor(6300); await u.vor(500); await u.vor(1500); await u.vor(120000);
    const versuche = g.a.log.schreib.filter(w => w.pfad === P('c/42/1'));
    t('der abgewiesene eigene Abschluss wird genau dreimal versucht',
      versuche.length === 3, versuche.length);
    t('und danach steht kein Wecker mehr', g.u.anzahl() === 0, g.u.anzahl());
    t('das Geheimnis wurde bei einem NETZFEHLER nicht weggeworfen', g.st.inhalt.has(KEY));
    t('und kein Zug wurde nachgeschoben', eigeneZuege(g).length === 0);
    g.l.stop();
  }
}
// ══ UNBEKANNT IST NICHT LEER ══════════════════════════════════════════════════
abschnitt('Der eigene Slot ist UNBEKANNT, nicht leer - bis der Raum ihn gemeldet hat');
{
  // Der Einstieg in eine OFFENE Runde nach dem Neuladen (fbV9LebenFortsetzen ruft
  // fbV9Start mit {hydrieren:true}). Firebase liefert d, c, ro und r als getrennte
  // Zuhoerer ohne Reihenfolgegarantie. Bis der c-Knoten gemeldet UND eingeordnet ist,
  // darf dieser Sitz nichts bauen: kein Salz, kein Hash, kein Commit - auch wenn der
  // Spieler in diesem Fenster zieht oder "Stehen bleiben" drueckt.
  const ZUG2 = { idx: 1, dx: -3, dy: 4, sp: 0 };
  const vorspiel = async () => {
    const st = speicher();
    const a1 = attrappe({ [P('d/42')]: { n: 42, o: 1 } });
    const M1 = baue(a1, st); M1.fbV9SecretClear();
    const l1 = M1.fbV9Start(CTX, { move: ZUG });
    await settle();
    const commit = a1.stand[P('c/42/1')];
    l1.stop();
    return { st, commit, salz: JSON.parse(st.inhalt.get(KEY)).salt };
  };
  const eigeneSchreib = (a) => a.log.schreib.filter(w => w.pfad === P('c/42/1'));
  const neueCommits = (a) => eigeneSchreib(a).filter(w => w.vorschlag && w.vorschlag.k === 'move');
  {
    // FALL A: d kommt vor c. Der Slot traegt den Commit von vor dem Neuladen.
    const v = await vorspiel();
    const a = attrappe({ [P('d/42')]: { n: 42, o: 1 }, [P('c/42/1')]: v.commit, [P('c/42')]: { 1: v.commit } },
                       null, [P('c/42')]);
    const M = baue(a, v.st); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { hydrieren: true });
    await settle();
    t('A: d ist da, c noch nicht - der eigene Slot ist UNBEKANNT', l.eigenUnbekannt === true && !!l.stand.turnOpen);
    t('A: der Lauf ist nicht gescheitert', l.stufe !== M.FB_V9_FAILED, l.stufe + ' ' + l.grund);
    t('A: ein Zug in diesem Fenster wird ABGEWIESEN, nicht gemerkt',
      M.fbV9Action(l, { move: ZUG2 }) === false && l.aktionGesetzt === false && l.offeneAktion === null);
    t('A: "Stehen bleiben" ebenso', M.fbV9Action(l, { pass: true }) === false && l.terminal === null);
    await settle();
    t('A: kein Salz, kein Hash - der Arbeitsspeicher bleibt leer', M.fbV9SecretFor('RN2K', 7, 42) === null);
    t('A: der gesicherte Datensatz ist unveraendert', JSON.parse(v.st.inhalt.get(KEY)).salt === v.salz);
    t('A: kein Schreibvorgang in den eigenen Slot', eigeneSchreib(a).length === 0);
    a.freigeben(P('c/42'));
    await settle();
    t('A: nach dem gemeldeten c ist der Slot BEKANNT', l.eigenUnbekannt === false);
    t('A: und das vorhandene Terminal ist uebernommen - derselbe Hash',
      !!l.terminal && l.terminal.h === v.commit.h && l.commitFertig === true);
    const g = M.fbV9SecretFor('RN2K', 7, 42);
    t('A: das Geheimnis kommt aus dem Speicher - dasselbe Salz', !!g && M.fbV9Hex(g.salt) === v.salz);
    t('A: immer noch kein Schreibvorgang in den eigenen Slot', eigeneSchreib(a).length === 0);
    t('A: ein spaeter Zug wird weiter abgewiesen', M.fbV9Action(l, { move: ZUG2 }) === false);
    t('A: der Lauf wartet auf die Barriere', l.stufe === M.FB_V9_WAIT_COMMITS, l.stufe);
    l.stop();
  }
  {
    // FALL B: c kommt vor d. Gemeldet ist nicht eingeordnet - ohne d gibt es kein (2a).
    const v = await vorspiel();
    const a = attrappe({ [P('d/42')]: { n: 42, o: 1 }, [P('c/42/1')]: v.commit, [P('c/42')]: { 1: v.commit } },
                       null, [P('d/42')]);
    const M = baue(a, v.st); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { hydrieren: true });
    await settle();
    t('B: c ist gemeldet, d noch nicht - der Slot bleibt UNBEKANNT',
      l.commitsGemeldet === true && l.eigenUnbekannt === true && !l.stand.turnOpen);
    t('B: ein Zug wird abgewiesen', M.fbV9Action(l, { move: ZUG2 }) === false && l.offeneAktion === null);
    t('B: kein Salz', M.fbV9SecretFor('RN2K', 7, 42) === null);
    a.freigeben(P('d/42'));
    await settle();
    t('B: mit d wird eingeordnet - dasselbe Terminal, derselbe Hash',
      l.eigenUnbekannt === false && !!l.terminal && l.terminal.h === v.commit.h);
    t('B: dasselbe Salz', M.fbV9Hex(M.fbV9SecretFor('RN2K', 7, 42).salt) === v.salz);
    t('B: kein zweiter Commit', eigeneSchreib(a).length === 0);
    t('B: kein FAILED', l.stufe === M.FB_V9_WAIT_COMMITS, l.stufe);
    l.stop();
  }
  {
    // FALL C: leerer Slot (Neuladen VOR dem eigenen Commit), d vor c. Waehrend UNBEKANNT
    // gesperrt; sobald c den leeren Slot BEWEIST, darf genau einmal gehandelt werden.
    const st = speicher();
    const a = attrappe({ [P('d/42')]: { n: 42, o: 1 } }, null, [P('c/42')]);
    const M = baue(a, st); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { hydrieren: true });
    await settle();
    t('C: UNBEKANNT - gesperrt', l.eigenUnbekannt === true && M.fbV9Action(l, { move: ZUG2 }) === false);
    a.freigeben(P('c/42'));
    await settle();
    t('C: der leere Slot ist bewiesen - BEKANNT, kein Terminal', l.eigenUnbekannt === false && l.terminal === null);
    t('C: jetzt wird der Zug angenommen', M.fbV9Action(l, { move: ZUG2 }) === true);
    await settle();
    t('C: genau EIN Commit', neueCommits(a).length === 1 && !!a.stand[P('c/42/1')]);
    t('C: mit genau einem Salz', !!M.fbV9SecretFor('RN2K', 7, 42) && st.inhalt.has(KEY));
    t('C: ein zweiter Zug wird abgewiesen', M.fbV9Action(l, { move: ZUG }) === false && neueCommits(a).length === 1);
    l.stop();
  }
  {
    // FALL D: die Frist laeuft ab, waehrend c noch UNBEKANNT ist. Die Fristmechanik darf
    // keinen eigenen Commit erfinden - hoechstens ein late (write-once, kein Salz).
    const v = await vorspiel();
    const uhr = uhrwerk(1000);
    const a = attrappe({ [P('d/42')]: { n: 42, o: 1 }, [P('c/42/1')]: v.commit, [P('c/42')]: { 1: v.commit } },
                       uhr, [P('c/42')]);
    const M = baue(a, v.st, uhr); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, { hydrieren: true });
    await settle();
    await uhr.vor(9000);
    t('D: nach der Frist immer noch UNBEKANNT und nicht gescheitert',
      l.eigenUnbekannt === true && l.stufe !== M.FB_V9_FAILED, l.stufe + ' ' + l.grund);
    t('D: kein erfundener eigener Commit', neueCommits(a).length === 0);
    t('D: kein Salz', M.fbV9SecretFor('RN2K', 7, 42) === null);
    t('D: der Slot im Raum traegt weiter den alten Commit', a.stand[P('c/42/1')].h === v.commit.h);
    a.freigeben(P('c/42'));
    await settle();
    t('D: eingeordnet - dasselbe Terminal', !!l.terminal && l.terminal.h === v.commit.h && l.stufe !== M.FB_V9_FAILED);
    l.stop();
  }
  {
    // Ein FRISCHER Lauf (ohne hydrieren) ist unveraendert: er kennt UNBEKANNT nicht, weil
    // er in dieser Sitzung der erste Lauf dieser Runde ist und dieser Sitz darin noch nie
    // gezogen haben kann. Eine Handlung vor d wird wie bisher gemerkt und dann gesendet.
    const st = speicher();
    const a = attrappe({}, null, [P('d/42')]);
    const M = baue(a, st); M.fbV9SecretClear();
    const l = M.fbV9Start(CTX, null);
    await settle();
    t('frisch: kein UNBEKANNT', l.eigenUnbekannt === false);
    t('frisch: eine Handlung wird angenommen', M.fbV9Action(l, { move: ZUG }) === true);
    a.freigeben(P('d/42'));
    await settle();
    t('frisch: und nach d gesendet - genau einmal', neueCommits(a).length === 1);
    l.stop();
  }
  // Waechter: hydrieren wird GENAU an einer Stelle benutzt - beim Einstieg in die offene Runde.
  t('hydrieren wird genau einmal benutzt: in fbV9LebenFortsetzen',
    (HTML.match(/fbV9Start\(ctx,\{hydrieren:true\}\)/g) || []).length === 1
    && (HTML.match(/hydrieren:true/g) || []).length === 1);
  t('und fbV9LebenFortsetzen startet den Lauf nicht mehr ohne diese Auskunft',
    HTML.indexOf('L.lauf=fbV9Start(ctx,null);') < 0);
  t('UNBEKANNT endet nur in Schritt (2a), nach dem gemeldeten c-Knoten',
    (HTML.match(/lauf\.eigenUnbekannt=false/g) || []).length === 1
    && /if\(lauf\.eigenUnbekannt&&lauf\.commitsGemeldet\)lauf\.eigenUnbekannt=false;/.test(HTML));
  t('fbV9Action weist waehrend UNBEKANNT ab - vor jedem anderen Riegel',
    /function fbV9Action\(lauf,aktion\)\{\s*if\(!lauf\|\|fbV9Aus\(lauf\)\)return false;\s*(\/\/[^\n]*\n\s*)*if\(lauf\.eigenUnbekannt\)return false;/.test(HTML));
  t('und Schritt (2) baut waehrend UNBEKANNT nichts',
    /!lauf\.verworfen&&!lauf\.eigenUnbekannt\s*&&\(lauf\.terminal\|\|lauf\.offeneAktion\)/.test(HTML));
}

// ══ DER DOPPELTE TAB ═════════════════════════════════════════════════════════
abschnitt('Der doppelte Tab - dieselbe Enthuellung, kein Schaden');
{
  const st = speicher(), a0 = attrappe({ [P('d/42')]: { n: 42, o: 1 } });
  const M0 = baue(a0, st); M0.fbV9SecretClear();
  const l0 = M0.fbV9Start(CTX, { move: ZUG });
  await settle();
  const commit = a0.stand[P('c/42/1')];
  const revA = M0.fbV9MakeReveal({ room: 'RN2K', gen: 7, turn: 42, seat: 1 });
  l0.stop();
  // Ein zweiter Tab mit KOPIERTEM Speicher.
  const kopie = speicher(Object.fromEntries(st.inhalt));
  const a2 = attrappe({ [P('d/42')]: { n: 42, o: 1 }, [P('c/42/1')]: commit,
                        [P('c/42')]: { 1: commit } }, null);
  const M2 = baue(a2, kopie); M2.fbV9SecretClear();
  const l2 = M2.fbV9Resume(CTX);
  await settle();
  t('die Kopie wird uebernommen - so ist es gemeint', !!M2.fbV9SecretFor('RN2K', 7, 42));
  const revB = M2.fbV9MakeReveal({ room: 'RN2K', gen: 7, turn: 42, seat: 1 });
  t('und ergibt bitgleich dieselbe Enthuellung',
    JSON.stringify(revA) === JSON.stringify(revB));
  l2.stop();
  // Es gibt bewusst keine Tab-Pruefung.
  const q = HTML.slice(HTML.indexOf('function fbV9UidOk(ctx)'), ENDE);
  for (const w of ['onlineTab', 'onlinePid'])
    t('die Fortsetzung kennt kein ' + w, q.indexOf(w) < 0);
}

// ══ QUELLTEXT-WAECHTER ═══════════════════════════════════════════════════════
abschnitt('Waechter');
{
  const NL = String.fromCharCode(10);
  const code = BEREICH.split(NL).map(z => { const k = z.indexOf('//');
    return k >= 0 ? z.slice(0, k) : z; }).join(NL);
  t('Protokoll 9', /const ONLINE_PROTOCOL_VERSION=9;/.test(HTML));
  // Die Reihenfolge gilt IM EINSTIEG, nicht im ganzen Block: fbV9NetWriteCommit ist
  // weiter oben im Adapter definiert. Massgeblich ist, dass der Einstieg zuerst
  // sichert und erst der Schritt danach sendet - und dass ein Fehlschlag beim
  // Sichern den Lauf beendet, BEVOR irgendetwas an Firebase geht.
  // SEIT V9.4C liegt das Bauen und Sichern in fbV9Vorbereiten - EIN Weg dorthin, egal
  // ob die Handlung beim Start schon vorlag oder nachgereicht wurde. Die Reihenfolge
  // gilt dort: erst sichern, dann darf ueberhaupt gesendet werden.
  const vorb = HTML.slice(HTML.indexOf('async function fbV9Vorbereiten(lauf,aktion)'),
                          HTML.indexOf('function fbV9Action(lauf,aktion)'));
  t('die Vorbereitung sichert das Geheimnis', vorb.indexOf('fbV9SecretSave') > 0);
  // SEIT DER SPEICHER-HAERTUNG: ein Fehlschlag beim Sichern beendet den Lauf NICHT mehr
  // (das liess einen Client ohne Speicher fuer immer stehen). Er wird als fluechtig
  // vermerkt; das Geheimnis lebt im Arbeitsspeicher, gesendet wird dasselbe Terminal.
  t('und vermerkt einen Fehlschlag nur als fluechtig - kein Abbruch',
    /if\(abgelegt!==FB_V9_SAVED\)lauf\.geheimnisFluechtig=true;/.test(vorb)
    && vorb.indexOf("fbV9Scheitern(lauf,'Geheimnis nicht gesichert") < 0);
  t('sie sendet dabei selbst keinen Commit', vorb.indexOf('fbV9NetWriteCommit') < 0);
  t('und sie ist der EINZIGE Weg zum Sichern',
    (HTML.match(/fbV9SecretSave\(/g) || []).length === 2,
    (HTML.match(/fbV9SecretSave\(/g) || []).length);
  const einstieg = HTML.slice(HTML.indexOf('function fbV9Start(ctx,aktion)'), ENDE);
  t('der Einstieg selbst sendet keinen Commit',
    einstieg.slice(0, einstieg.indexOf('lauf.abmelden=')).indexOf('fbV9NetWriteCommit') < 0);
  t('kein localStorage fuer das v9-Geheimnis', code.indexOf('localStorage') < 0);
  t('kein IndexedDB', code.indexOf('indexedDB') < 0);
  t('keine Bindung an onlineTab oder das Praesenztoken',
    code.indexOf('onlineTab') < 0 && code.indexOf('onlinePid') < 0);
  // Die PROTOKOLLSCHICHTEN ziehen keine Spielfolge. Seit V9.4D1 gibt es dafuer genau
  // eine Stelle - die Spielbruecke ganz am Ende des ruhenden Bereichs -, und sie hat
  // ihre eigenen Waechter in tools/test_online_v9_gameplay_bridge.js.
  const vorBruecke = code.slice(0, code.indexOf('const FB_V9_RAUS='));
  t('keine Spielfolge in den Protokollschichten',
    ['fbElimLives', 'gameOver', 'footballElimEliminate', 'applyLaunch(']
      .every(w => vorBruecke.indexOf(w) < 0));
  t('nichts wird protokolliert', code.indexOf('console.') < 0);
  // SEIT V9.4C ruft das Spiel an genau zwei benannten Stellen in den ruhenden
  // Bereich hinein - beim Rundenbeginn und am Settlement - und raeumt an den
  // bestehenden Grenzen ab. Diese Haken sind gewollt; alles andere bleibt verboten.
  // Seit V9.4D2 nennt fastForwardMatch zusaetzlich die gemeinsame Wirkung - der
  // dritte und letzte benannte Beruehrungspunkt zwischen Spiel und v9.
  // Seit V9.4D2 kommen die ECHTEN Einstiege dazu: der Rejoin ruft die Rehydrierung,
  // der frische Start delegiert an sie. Mehr Namen darf das Produkt nicht nennen.
  // Seit V9.5B nennt auch der Eingabeweg in applyCommit zwei v9-Namen. Gezaehlt wird er
  // dort, wo die Beruehrungspunkte gezaehlt werden - in test_online_v9_coordinator.js.
  const HAKEN = ['fbV9LebenNeueRunde', 'fbV9LebenStop', 'fbV9Wirken',
                 'fbV9RaumStart', 'fbV9RaumIst9', 'fbV9Rehydrieren', 'fbV9LebenCtx',
                 'fbV9LebenAn', 'fbV9LebenHandeln', 'fbV9RaumHier',
                 // Hydrations-Barriere: das Eingabetor - whoCanAim und die Stand-Taste fragen,
                 // ob der eigene Slot der laufenden Runde schon bekannt ist. Gezaehlt in
                 // test_online_v9_coordinator.js.
                 'fbV9EingabeOffen'];
  const ohneHaken = (txt) => txt.split(/\r?\n/)
    .filter(zl => !HAKEN.some(h => zl.indexOf(h) >= 0)).join('\n');
  t('ausserhalb des ruhenden Bereichs nennt keine Zeile eine v9-Funktion',
    ohneHaken(HTML.split(BEREICH).join('')).indexOf('fbV9') < 0);
  t('keine zweite Zustandsmaschine - fbV9Resume benutzt fbV9Start',
    /function fbV9Resume\(ctx\)\{ return fbV9Start\(ctx,\{resume:true\}\); \}/.test(HTML));
  const regeln = fs.readFileSync(path.join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('die Regeln tragen weiterhin die v9-Zweige', regeln.indexOf("child('v').val() === 9") > 0);
}

console.log('\nOnline-V9-Fortsetzung: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.log('AUSNAHME: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
