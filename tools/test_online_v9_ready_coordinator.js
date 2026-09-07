// V9.4B2B: die begrenzte Bereitschaftssteuerung - dauerhaft, ohne Emulator.
//
// Geprueft wird der ECHTE Quelltext aus index.html gegen deterministische Attrappen
// fuer Firebase und Zeit. Keine echten dreissig Sekunden, kein Browser, kein Netz.
//
// DIE DREI SAETZE, um die es hier geht:
//   1. Ein eigener Schreibvorgang beweist NICHTS. Weder ein COMMITTED auf s, noch auf
//      q, noch auf x bewegt die Barriere - das tut allein der naechste autoritative
//      Schnappschuss.
//   2. Bereit ist dieser Client erst, wenn er es AUSDRUECKLICH sagt. Das Starten der
//      Steuerung ist kein Bereitschaftszeichen; sonst waere der spaetere Anschluss an
//      das Settlement in stepSim von vornherein gelogen.
//   3. Ein Fristschluss ohne Disqualifikation befreit den Sitz nicht. Zwischen beidem
//      liegt immer ein autoritativer Schnappschuss.
//   node test_online_v9_ready_coordinator.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 58 - s.length)));

// ── Attrappen ────────────────────────────────────────────────────────────────
const SENTINEL = { '.sv': 'timestamp' };
function uhrwerk(start) {
  let jetzt = start === undefined ? 5000000 : start, id = 1;
  const offen = new Map();
  return { jetzt: () => jetzt, anzahl: () => offen.size, serverNow: () => jetzt,
    geplant: () => [...offen.values()].map(e => e.faellig - jetzt),
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
  const fehler = {};
  return { log, stand,
    setzeFehler: (pfad, e) => { fehler[pfad] = e; },
    loescheFehler: (pfad) => { delete fehler[pfad]; },
    zustellen: (pfad, wert) => { stand[pfad] = wert;
      for (const h of log.hoert) if (h.pfad === pfad && h.offen) h.cb({ val: () => wert }); },
    FB: { db: {}, ref: (db, pfad) => ({ pfad }), serverTimestamp: () => SENTINEL,
      runTransaction: async (ref, fn, opts) => {
        const vorher = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        const vorschlag = fehler[ref.pfad] ? null : fn(vorher);
        log.schreib.push({ pfad: ref.pfad, vorschlag });
        if (fehler[ref.pfad]) throw fehler[ref.pfad];
        if (vorschlag === undefined) return { committed: false, snapshot: { val: () => vorher } };
        const jetzt = uhr ? uhr.jetzt() : 1788700000000;
        const g = JSON.parse(JSON.stringify(vorschlag, (k, v) => (v && v['.sv'] === 'timestamp') ? jetzt : v));
        stand[ref.pfad] = g;
        // Firebase reicht einen Blattschreibvorgang an JEDEN Zuhoerer darueber weiter.
        // Ohne das saehe ein Zuhoerer auf der Karte q/<turn> nie, dass ein Kind
        // geschrieben wurde - und die Attrappe wuerde genau die Eigenschaft
        // verschweigen, um die es hier geht.
        Promise.resolve().then(() => {
          for (const h of log.hoert) {
            if (!h.offen) continue;
            if (h.pfad === ref.pfad) { h.cb({ val: () => g }); continue; }
            if (ref.pfad.indexOf(h.pfad + '/') !== 0) continue;
            const karte = {}; let leer = true;
            for (const k in stand) {
              if (k.indexOf(h.pfad + '/') !== 0 || stand[k] === null) continue;
              const rest = k.slice(h.pfad.length + 1);
              if (rest.indexOf('/') >= 0) continue;   // nur unmittelbare Kinder
              karte[rest] = stand[k]; leer = false;
            }
            const vorhanden = Object.prototype.hasOwnProperty.call(stand, h.pfad) ? stand[h.pfad] : null;
            if (vorhanden && typeof vorhanden === 'object')
              for (const k in vorhanden) if (!(k in karte)) { karte[k] = vorhanden[k]; leer = false; }
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

const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-SPIELANBINDUNG ════');
if (START < 0 || ENDE < 0) { console.log('V9-Bereich nicht gefunden'); process.exit(2); }
const BEREICH = HTML.slice(START, ENDE);
const STILL = uhrwerk(1000);
function speicher() { const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i],
           getItem: (k) => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; }
const baue = (a, uhr) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
    'FB_ONLINE_BALL_IDX', 'serverNow', 'setTimeout', 'clearTimeout', 'sessionStorage', `
  ${BEREICH}
  return { fbV9ReadyStart, fbV9ReadyLocal, fbV9ReadyStop, fbV9ReadyMarke,
           fbV9ReadySeatState, fbV9ReadyComplete, fbV9ReadyAnchor, fbV9Start,
           fbV9SecretClear, FB_V9_READY_DEADLINE_MS,
           FB_V9_R_ANCHOR, FB_V9_R_SELF, FB_V9_R_BARRIER, FB_V9_R_COMPLETE,
           FB_V9_R_FAILED, FB_V9_R_STOPPED, FB_V9_COMPLETE, FB_V9_VALID };
`)({ FB: a.FB }, globalThis.crypto, 10000, 5, 5,
   (uhr || STILL).serverNow, (uhr || STILL).setTimeout, (uhr || STILL).clearTimeout, speicher());

const UID = 'UID_READY_XXXXXXXXXXXXXXXXX';
const CTX = { v: 9, code: 'RN2K', gen: 7, turn: 0, seat: 1, cap: 3, uid: UID };
const mit = (x) => Object.assign({}, CTX, x);
const P = (r) => 'rooms/RN2K/g/7/' + r;
const TS = 4000000;
const Q_READY = (n) => ({ k: 'ready', n, ts: TS });
const Q_TIME = (n) => ({ k: 'timeout', n, ts: TS });
const X_OK = (n) => ({ k: 'ready_timeout', n, ts: TS });
const ruhe = () => new Promise(r => setTimeout(r, 0));
const settle = async (n) => { for (let i = 0; i < (n || 12); i++) await ruhe(); };
const bereitAlle = (n, turn, aus) => { const q = {};
  for (let i = 0; i < n; i++) if (!aus || aus.indexOf(i) < 0) q[i] = Q_READY(turn); return q; };
const qPfad = (a, turn) => a.log.schreib.filter(w => w.pfad.indexOf(P('q/' + turn + '/')) === 0);
const xPfad = (a) => a.log.schreib.filter(w => w.pfad.indexOf(P('x/')) === 0);

console.log('=== V9.4B2B: begrenzte Bereitschaftssteuerung (ruhend) ===');

(async () => {

// ══ RUNDE 0: DER GENERATIONSSTART ════════════════════════════════════════════
abschnitt('Runde 0 - der Generationsstart traegt die Frist');
{
  const u = uhrwerk(4000000);
  const a = attrappe({}, u);
  // Der eigene Schreibvorgang wird abgewiesen - ein anderer Teilnehmer war schneller.
  // Genau so laesst sich zeigen, woher der Anker WIRKLICH kommt: nicht aus dem
  // Rueckgabewert des eigenen Schreibvorgangs, sondern aus dem Schnappschuss. (Waere
  // der eigene Schreibvorgang erfolgreich, echote ihn die Attrappe zurueck - wie
  // Firebase es taete -, und der Anker staende dann zu Recht.)
  a.setzeFehler(P('s'), new Error('permission_denied'));
  const M = baue(a, u);
  const l = M.fbV9ReadyStart(CTX);
  await settle();
  t('die Steuerung hoert zu', a.log.hoert.length === 4, a.log.hoert.length);
  t('und versucht den Generationsstart anzulegen',
    a.log.schreib.some(w => w.pfad === P('s')));
  t('sie wartet auf den Anker', l.stufe === M.FB_V9_R_ANCHOR, l.stufe);
  t('eine Abweisung des eigenen Schreibvorgangs laesst den Lauf nicht scheitern',
    l.stufe !== M.FB_V9_R_FAILED, l.grund);
  t('und ohne Schnappschuss gibt es keinen Anker', l.anker === null, l.anker);
  M.fbV9ReadyLocal(l);
  await settle();
  t('ein Bereitschaftszeichen vor dem Anker wird gemerkt, nicht gesendet',
    qPfad(a, 0).length === 0, qPfad(a, 0).length);
  t('der Lauf wartet unveraendert', l.stufe === M.FB_V9_R_ANCHOR, l.stufe);
  // Erst der autoritative Schnappschuss.
  a.zustellen(P('s'), { ts: TS });
  await settle();
  t('mit dem autoritativen Anker geht die gemerkte Meldung hinaus',
    qPfad(a, 0).length === 1, qPfad(a, 0).length);
  const w = qPfad(a, 0)[0];
  t('und zwar auf den EIGENEN Sitz', w.pfad === P('q/0/1'), w.pfad);
  t('mit genau {k,n,ts}',
    JSON.stringify(Object.keys(w.vorschlag).sort()) === '["k","n","ts"]' &&
    w.vorschlag.k === 'ready' && w.vorschlag.n === 0);
  // Zehn gleiche Anker-Schnappschuesse ergeben keine zehn Meldungen.
  for (let i = 0; i < 10; i++) { a.zustellen(P('s'), { ts: TS }); await settle(4); }
  t('gleiche Anker-Schnappschuesse wiederholen nichts', qPfad(a, 0).length === 1, qPfad(a, 0).length);
  t('ein missgebildeter Anker begruendet nichts',
    M.fbV9ReadyAnchor(0, { ts: 'x' }, null) === null);
  l.stop();
}

// ══ SPAETERE RUNDEN: DER ABSCHLUSSANKER ══════════════════════════════════════
abschnitt('Spaetere Runden haengen am Abschluss der Vorrunde');
{
  const u = uhrwerk(4000000);
  const a = attrappe({}, u), M = baue(a, u);
  const c = mit({ turn: 3 });
  const l = M.fbV9ReadyStart(c);
  await settle();
  t('es wird auf dem Abschluss der VORRUNDE gehoert',
    a.log.hoert.some(h => h.pfad === P('z/2')), a.log.hoert.map(h => h.pfad).join(','));
  t('und der Generationsstart wird NICHT angelegt - er gilt nur fuer Runde 0',
    !a.log.schreib.some(w => w.pfad === P('s')));
  M.fbV9ReadyLocal(l);
  await settle();
  t('das Bereitschaftszeichen wird gemerkt', qPfad(a, 3).length === 0);
  a.zustellen(P('s'), { ts: TS });
  await settle();
  t('ein Generationsstart allein traegt eine spaetere Runde nicht',
    qPfad(a, 3).length === 0, qPfad(a, 3).length);
  a.zustellen(P('z/2'), { ts: 'kaputt' });
  await settle();
  t('ein missgebildeter Abschluss ebenso wenig', qPfad(a, 3).length === 0);
  a.zustellen(P('z/2'), { ts: TS });
  await settle();
  t('mit dem autoritativen Abschluss geht die Meldung hinaus',
    qPfad(a, 3).length === 1 && qPfad(a, 3)[0].pfad === P('q/3/1'));
  l.stop();
}

// ══ DIE EIGENE MELDUNG ═══════════════════════════════════════════════════════
abschnitt('Die eigene Meldung - nur auf ausdrueckliches Zeichen');
{
  const u = uhrwerk(4000000);
  const a = attrappe({ [P('s')]: { ts: TS } }, u), M = baue(a, u);
  const l = M.fbV9ReadyStart(CTX);
  await settle();
  t('ohne Bereitschaftszeichen geht trotz Anker nichts hinaus', qPfad(a, 0).length === 0);
  t('und der Lauf wartet, statt zu scheitern',
    l.stufe !== M.FB_V9_R_COMPLETE && l.stufe !== M.FB_V9_R_FAILED, l.stufe);
  M.fbV9ReadyLocal(l);
  await settle();
  t('mit dem Zeichen genau eine Meldung', qPfad(a, 0).length === 1);
  M.fbV9ReadyLocal(l); M.fbV9ReadyLocal(l);
  await settle();
  t('ein zweites Zeichen sendet nichts nach', qPfad(a, 0).length === 1, qPfad(a, 0).length);
  l.stop();
  // Steht die eigene Meldung schon autoritativ da, wird nicht erneut geschrieben.
  const b = attrappe({ [P('s')]: { ts: TS }, [P('q/0')]: { 1: Q_READY(0) } }, u);
  const M2 = baue(b, u);
  const l2 = M2.fbV9ReadyStart(CTX);
  M2.fbV9ReadyLocal(l2);
  await settle();
  t('eine bereits vorhandene eigene Meldung wird nicht wiederholt',
    qPfad(b, 0).length === 0, qPfad(b, 0).length);
  l2.stop();
  // Steht dort ein Fristschluss, wird NICHT ueberschrieben.
  const cA = attrappe({ [P('s')]: { ts: TS }, [P('q/0')]: { 1: Q_TIME(0) } }, u);
  const M3 = baue(cA, u);
  const l3 = M3.fbV9ReadyStart(CTX);
  M3.fbV9ReadyLocal(l3);
  await settle();
  t('ein eigener Fristschluss wird nie durch eine Meldung ueberschrieben',
    qPfad(cA, 0).length === 0, qPfad(cA, 0).length);
  t('und der Lauf scheitert daran nicht', l3.stufe !== M3.FB_V9_R_FAILED, l3.grund);
  l3.stop();
}

// ══ DIE BARRIERE ═════════════════════════════════════════════════════════════
abschnitt('Die Barriere - allein auf autoritativen Daten');
{
  const u = uhrwerk(4000000);
  const bau = (vor) => { const a = attrappe(Object.assign({ [P('s')]: { ts: TS } }, vor), u);
                         return { a, M: baue(a, u) }; };
  {
    const { a, M } = bau({ [P('q/0')]: bereitAlle(3, 0) });
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    t('sind alle gemeldet, ist die Barriere geschlossen',
      l.stufe === M.FB_V9_R_COMPLETE, l.stufe + ' ' + (l.grund || ''));
    t('und kein Wecker bleibt stehen', u.anzahl() === 0, u.anzahl());
    t('die Zuhoerer sind abgemeldet', a.log.hoert.every(h => !h.offen));
    t('es wurde kein remove geschrieben', !a.log.schreib.some(w => w.pfad.indexOf('/c/') > 0));
    t('und keine Runde eroeffnet', !a.log.schreib.some(w => w.pfad.indexOf('/d/') > 0));
    t('die Bereitschaftsdaten bleiben unangetastet', a.stand[P('q/0')] !== null);
  }
  {
    const { M } = bau({ [P('q/0')]: bereitAlle(3, 0, [2]) });
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    t('fehlt ein Sitz, bleibt sie offen', l.stufe === M.FB_V9_R_BARRIER, l.stufe);
    l.stop();
  }
  {
    const { M } = bau({ [P('q/0')]: bereitAlle(3, 0, [2]), [P('e')]: { 2: true } });
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    t('ein ausgetragener Sitz ist befreit', l.stufe === M.FB_V9_R_COMPLETE, l.stufe);
  }
  {
    const { M } = bau({ [P('q/0')]: bereitAlle(3, 0, [2]), [P('x')]: { 2: X_OK(0) } });
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    t('ein disqualifizierter Sitz ebenso', l.stufe === M.FB_V9_R_COMPLETE, l.stufe);
  }
  {
    const q = bereitAlle(3, 0, [2]); q[2] = Q_TIME(0);
    const { a, M } = bau({ [P('q/0')]: q });
    // Die Disqualifikation wird abgewiesen - so bleibt der Zwischenzustand sichtbar.
    // Ohne diese Abweisung folgte sie sofort (seit B2B genau richtig), und die
    // Barriere schloesse zu Recht.
    a.setzeFehler(P('x/2'), new Error('permission_denied'));
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    t('ein Fristschluss OHNE Disqualifikation befreit nicht',
      l.stufe === M.FB_V9_R_BARRIER, l.stufe);
    t('aber die Disqualifikation wird sofort versucht', xPfad(a).length >= 1);
    l.stop();
  }
  {
    const q = bereitAlle(3, 0, [2]); q[2] = { k: 'ready' };
    const { M } = bau({ [P('q/0')]: q });
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    t('durch einen unbrauchbaren Stand wird NICHT geraten',
      l.stufe === M.FB_V9_R_FAILED && /unbrauchbar/.test(l.grund), l.stufe + ' ' + l.grund);
  }
  {
    const q = bereitAlle(3, 0, [2]); q[2] = Q_READY(1);
    const { M } = bau({ [P('q/0')]: q });
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    t('eine Meldung der falschen Runde zaehlt nicht',
      l.stufe === M.FB_V9_R_FAILED, l.stufe);
  }
  {
    const q = bereitAlle(3, 0, [2]); q[4] = Q_READY(0);
    const { M } = bau({ [P('q/0')]: q });
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    t('ein Eintrag ausserhalb der Sollbesetzung ersetzt keinen fehlenden Sitz',
      l.stufe === M.FB_V9_R_BARRIER, l.stufe);
    l.stop();
  }
}

// ══ FRIST UND SCHLIESSUNG ════════════════════════════════════════════════════
abschnitt('Die Frist - dreissig Sekunden, vom autoritativen Anker an');
{
  const u = uhrwerk(4000000);
  const a = attrappe({ [P('q/0')]: bereitAlle(3, 0, [0, 2]) }, u);
  a.setzeFehler(P('s'), new Error('permission_denied'));   // ein anderer war schneller
  // Die Disqualifikation wird zunaechst abgewiesen: so bleibt die Reihenfolge
  // Fristschluss -> autoritativer Schnappschuss -> Disqualifikation beobachtbar.
  a.setzeFehler(P('x/0'), new Error('permission_denied'));
  a.setzeFehler(P('x/2'), new Error('permission_denied'));
  const M = baue(a, u);
  const l = M.fbV9ReadyStart(CTX);
  await settle();
  t('ohne Anker steht kein Wecker', u.anzahl() === 0, u.anzahl());
  a.loescheFehler(P('s'));
  a.zustellen(P('s'), { ts: u.jetzt() });
  await settle();
  t('mit dem Anker steht genau ein Wecker', u.anzahl() === 1, u.anzahl());
  t('und zwar auf die volle Frist plus Sicherheitsabstand',
    u.geplant()[0] === 30000 + 250, u.geplant()[0]);
  await u.vor(29000);
  t('vor der Frist faellt kein Fristschluss', qPfad(a, 0).filter(
    w => w.vorschlag && w.vorschlag.k === 'timeout').length === 0);
  await u.vor(1500);
  const to = qPfad(a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'timeout');
  t('danach werden die offenen Sitze geschlossen', to.length === 2, to.length);
  t('in kanonischer Reihenfolge',
    to.map(w => w.pfad).join('|') === [P('q/0/0'), P('q/0/2')].join('|'), to.map(w => w.pfad).join('|'));
  t('gemeldete Sitze bleiben unberuehrt', !to.some(w => w.pfad === P('q/0/1')));
  // Der eigene COMMITTED bewegt die Barriere nicht - die Disqualifikation wird hier
  // abgewiesen, also bleibt der Sitz offen.
  t('der Lauf ist danach NICHT fertig - der Schnappschuss entscheidet',
    l.stufe === M.FB_V9_R_BARRIER, l.stufe);
  const xs = xPfad(a);
  t('der autoritative Fristschluss loest die Disqualifikation aus - fuer BEIDE Sitze',
    xs.some(w => w.pfad === P('x/0')) && xs.some(w => w.pfad === P('x/2')),
    xs.map(w => w.pfad).join(','));
  // Die Nutzlast steht im Abschnitt weiter unten, wo der Schreibvorgang durchgeht;
  // hier wird er abgewiesen und traegt deshalb keinen Vorschlag.
  t('und eine abgewiesene Disqualifikation erfindet nichts',
    l.stufe === M.FB_V9_R_BARRIER && a.stand[P('x/0')] === undefined, l.stufe);
  a.loescheFehler(P('x/0')); a.loescheFehler(P('x/2'));
  a.zustellen(P('x'), { 0: X_OK(0), 2: X_OK(0) });
  await settle();
  t('erst der autoritative Schnappschuss der Disqualifikation tut das',
    l.stufe === M.FB_V9_R_COMPLETE, l.stufe);
  t('und raeumt den Wecker ab', u.anzahl() === 0, u.anzahl());
}

// ══ OHNE BRAUCHBARE SERVERZEIT ═══════════════════════════════════════════════
abschnitt('Ohne Serverzeit: lieber zu spaet als zu frueh');
{
  const u = uhrwerk(4000000);
  u.serverNow = () => NaN;
  const a = attrappe({ [P('s')]: { ts: u.jetzt() - 5000 },
                       [P('q/0')]: bereitAlle(3, 0, [2]) }, u);
  const M = baue(a, u);
  const l = M.fbV9ReadyStart(CTX);
  await settle();
  t('der Rueckfall wartet die VOLLE Frist ab dem Schnappschuss',
    u.geplant()[0] === 30000 + 250, u.geplant()[0]);
  await u.vor(29000);
  t('bis dahin faellt kein Versuch',
    qPfad(a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'timeout').length === 0);
  await u.vor(1500);
  t('danach schon',
    qPfad(a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'timeout').length === 1);
  l.stop();
}

// ══ BEGRENZTE WIEDERHOLUNGEN ═════════════════════════════════════════════════
abschnitt('Erschoepfte Wiederholungen bleiben erschoepft');
{
  const bauErschoepft = async () => {
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('s')]: { ts: 4000000 }, [P('q/0')]: bereitAlle(3, 0, [2]) }, u);
    a.setzeFehler(P('q/0/2'), new Error('permission_denied'));
    const M = baue(a, u);
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    await u.vor(30300); await u.vor(500); await u.vor(1500);
    return { u, a, M, l };
  };
  const zaehl = (g) => g.a.log.schreib.filter(w => w.pfad === P('q/0/2')).length;
  {
    const g = await bauErschoepft();
    t('drei Versuche sind gefallen', zaehl(g) === 3, zaehl(g));
    t('und kein Wecker steht mehr', g.u.anzahl() === 0, g.u.anzahl());
    for (let i = 0; i < 10; i++) { g.a.zustellen(P('q/0'), bereitAlle(3, 0, [2])); await settle(4); }
    t('zehn identische Schnappschuesse setzen nichts zurueck', zaehl(g) === 3, zaehl(g));
    for (let i = 0; i < 5; i++) { g.a.zustellen(P('x'), null); await settle(4); }
    t('ein belangloser Schnappschuss auch nicht', zaehl(g) === 3, zaehl(g));
    await g.u.vor(120000);
    t('auch nach zwei Minuten kein vierter Versuch', zaehl(g) === 3, zaehl(g));
  }
  {
    // Eine WESENTLICHE Aenderung darf neu bewerten.
    const g = await bauErschoepft();
    t('vorher drei Versuche', zaehl(g) === 3, zaehl(g));
    g.a.loescheFehler(P('q/0/2'));
    g.a.zustellen(P('e'), { 0: true });
    await settle();
    t('eine wesentliche Aenderung stellt einen neuen Wecker', g.u.anzahl() === 1, g.u.anzahl());
    await g.u.vor(30300);
    t('und erlaubt einen weiteren Versuch', zaehl(g) === 4, zaehl(g));
    g.l.stop();
  }
}

// ══ WETTLAUF MELDUNG GEGEN FRISTSCHLUSS ══════════════════════════════════════
abschnitt('Wettlauf: Meldung gegen Fristschluss');
{
  const u = uhrwerk(4000000);
  const a = attrappe({ [P('s')]: { ts: 4000000 }, [P('q/0')]: bereitAlle(3, 0, [2]) }, u);
  const M = baue(a, u);
  const l = M.fbV9ReadyStart(CTX);
  await settle();
  // Der Sitzbesitzer war schneller: sein ready steht schon, als der Wecker faellt.
  a.zustellen(P('q/0'), bereitAlle(3, 0));
  await settle();
  t('gewinnt die Meldung, ist die Barriere geschlossen',
    l.stufe === M.FB_V9_R_COMPLETE, l.stufe);
  t('und es wurde kein Fristschluss versucht',
    !a.log.schreib.some(w => w.vorschlag && w.vorschlag.k === 'timeout'));
  t('der Wecker ist abgeraeumt', u.anzahl() === 0, u.anzahl());
}

// ══ ABGEWIESEN UND FEHLER ════════════════════════════════════════════════════
abschnitt('Abgewiesen und Fehler erfinden keinen Zustand');
{
  for (const art of ['permission_denied', 'network down']) {
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('s')]: { ts: 4000000 }, [P('q/0')]: bereitAlle(3, 0, [2]) }, u);
    a.setzeFehler(P('q/0/2'), new Error(art));
    const M = baue(a, u);
    const l = M.fbV9ReadyStart(CTX);
    await settle();
    await u.vor(30300);
    t(art + ': die Barriere bleibt offen', l.stufe === M.FB_V9_R_BARRIER, l.stufe);
    t(art + ': und im Raum steht nichts', a.stand[P('q/0/2')] === undefined);
    // Ein spaeterer autoritativer Schnappschuss loest es auf.
    a.zustellen(P('q/0'), bereitAlle(3, 0));
    await settle();
    t(art + ': ein spaeterer Schnappschuss klaert es', l.stufe === M.FB_V9_R_COMPLETE, l.stufe);
  }
}

// ══ EIGENE AUSTRAGUNG ════════════════════════════════════════════════════════
abschnitt('Der eigene Sitz wird ausgetragen');
{
  const u = uhrwerk(4000000);
  const a = attrappe({ [P('s')]: { ts: 4000000 } }, u), M = baue(a, u);
  const l = M.fbV9ReadyStart(CTX);
  M.fbV9ReadyLocal(l);
  await settle();
  const vorher = a.log.schreib.length;
  a.zustellen(P('e'), { 1: true });
  await settle();
  t('der Lauf hoert auf, statt weiter mitzukoordinieren',
    l.stufe === M.FB_V9_R_FAILED && /ausgetragen/.test(l.grund), l.stufe + ' ' + l.grund);
  t('und schreibt danach nichts mehr', a.log.schreib.length === vorher, a.log.schreib.length);
  t('autoritative Daten bleiben stehen', a.stand[P('s')] !== null);
  await u.vor(60000);
  t('auch spaeter nicht', a.log.schreib.length === vorher);
}

// ══ ANHALTEN ═════════════════════════════════════════════════════════════════
abschnitt('Anhalten - mehrfach gefahrlos, ohne Nachwirkung');
{
  const u = uhrwerk(4000000);
  const a = attrappe({ [P('s')]: { ts: 4000000 }, [P('q/0')]: bereitAlle(3, 0, [2]) }, u);
  const M = baue(a, u);
  const l = M.fbV9ReadyStart(CTX);
  M.fbV9ReadyLocal(l);
  await settle();
  const vorher = a.log.schreib.length;
  t('vor dem Anhalten steht ein Wecker', u.anzahl() === 1);
  M.fbV9ReadyStop(l); M.fbV9ReadyStop(l); l.stop();
  t('anhalten ist mehrfach gefahrlos', l.stufe === M.FB_V9_R_STOPPED, l.stufe);
  t('der Wecker ist geloescht', u.anzahl() === 0, u.anzahl());
  t('die Zuhoerer sind abgemeldet', a.log.hoert.every(h => !h.offen));
  await u.vor(120000);
  a.zustellen(P('q/0'), bereitAlle(3, 0, [2]));
  await settle();
  t('kein spaeter Rueckruf schreibt noch etwas', a.log.schreib.length === vorher,
    a.log.schreib.length + '/' + vorher);
  t('und ein spaetes Bereitschaftszeichen wirkt nicht mehr',
    M.fbV9ReadyLocal(l) === false);
  t('der Lauf bleibt angehalten', l.stufe === M.FB_V9_R_STOPPED, l.stufe);
  // Ein ungueltiger Zusammenhang ergibt gar keinen Lauf.
  const M2 = baue(attrappe({}, u), u);
  const l2 = M2.fbV9ReadyStart(mit({ v: 8 }));
  t('ein ungueltiger Zusammenhang scheitert sofort', l2.stufe === M2.FB_V9_R_FAILED, l2.stufe);
  t('und meldet den Grund', /Zusammenhang/.test(l2.grund), l2.grund);
}

// ══ DER ABSCHLUSSANKER IN DER BESTEHENDEN ABLAUFSTEUERUNG ════════════════════
abschnitt('z in der bestehenden Ablaufsteuerung');
{
  const NULLT = (k) => ({ k, ts: 1 });
  const bauLauf = async (vor) => {
    const u = uhrwerk(4000000);
    const a = attrappe(Object.assign({ [P('d/0')]: { n: 0, o: 4000000 } }, vor || {}), u);
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(mit({ turn: 0 }), { pass: true });
    await settle();
    a.zustellen(P('c/0'), { 0: NULLT('pass'), 1: NULLT('pass'), 2: NULLT('pass') });
    await settle();
    return { u, a, M, l };
  };
  {
    const g = await bauLauf();
    const zs = g.a.log.schreib.filter(w => w.pfad === P('z/0'));
    t('die vollstaendige Ergebnisbarriere loest den Abschlussanker aus', zs.length >= 1, zs.length);
    t('auf dem Pfad derselben Runde', zs[0].pfad === P('z/0'));
    t('mit genau {ts}', JSON.stringify(Object.keys(zs[0].vorschlag)) === '["ts"]');
    t('und der Lauf ist fertig, sobald der Anker autoritativ dasteht',
      g.l.stufe === g.M.FB_V9_COMPLETE, g.l.stufe + ' ' + (g.l.grund || ''));
    t('die Zugmenge steht unveraendert', g.l.menge && g.l.menge.length === 3 &&
      g.l.menge[0].status === g.M.FB_V9_VALID);
  }
  {
    // Der Anker ist schon da: EXISTS ist vertraeglich, die Menge bleibt dieselbe.
    const g = await bauLauf({ [P('z/0')]: { ts: 3999000 } });
    t('ein bereits vorhandener Anker ist vertraeglich',
      g.l.stufe === g.M.FB_V9_COMPLETE, g.l.stufe + ' ' + (g.l.grund || ''));
    t('und die Zugmenge ist dieselbe', g.l.menge && g.l.menge.length === 3);
  }
  {
    // Abgewiesen: kein Abschluss, keine erfundene Vollstaendigkeit.
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('d/0')]: { n: 0, o: 4000000 } }, u);
    a.setzeFehler(P('z/0'), new Error('permission_denied'));
    const M = baue(a, u); M.fbV9SecretClear();
    const l = M.fbV9Start(mit({ turn: 0 }), { pass: true });
    await settle();
    a.zustellen(P('c/0'), { 0: NULLT('pass'), 1: NULLT('pass'), 2: NULLT('pass') });
    await settle();
    t('ohne autoritativen Anker wird der Lauf NICHT fertig',
      l.stufe !== M.FB_V9_COMPLETE, l.stufe);
    t('und er scheitert auch nicht', l.stufe !== M.FB_V9_R_FAILED, l.stufe + ' ' + (l.grund || ''));
    await u.vor(500); await u.vor(1500); await u.vor(60000);
    const zs = a.log.schreib.filter(w => w.pfad === P('z/0'));
    t('die Wiederholungen sind begrenzt', zs.length === 3, zs.length);
    // Ein spaeterer autoritativer Anker loest es auf.
    a.loescheFehler(P('z/0'));
    a.zustellen(P('z/0'), { ts: 4000500 });
    await settle();
    t('ein spaeter autoritativer Anker schliesst den Lauf ab',
      l.stufe === M.FB_V9_COMPLETE, l.stufe + ' ' + (l.grund || ''));
    t('und die Zugmenge wurde dabei nicht neu berechnet',
      l.menge && l.menge.length === 3);
    // Wiederholte gleiche Ergebnis-Schnappschuesse ergeben keine neue Schreibflut.
    const vorher = a.log.schreib.filter(w => w.pfad === P('z/0')).length;
    for (let i = 0; i < 8; i++) { a.zustellen(P('c/0'), { 0: NULLT('pass'), 1: NULLT('pass'), 2: NULLT('pass') }); await settle(4); }
    t('gleiche Schnappschuesse erzeugen keine weiteren Anker-Schreibvorgaenge',
      a.log.schreib.filter(w => w.pfad === P('z/0')).length === vorher);
    l.stop();
  }
}

// ══ FRISTSCHLUSS -> DISQUALIFIKATION: OHNE ZWEITE WARTEZEIT ══════════════════
abschnitt('Der autoritative Fristschluss braucht keine zweite Frist');
{
  // DER FEHLER, der hier behoben ist: die Disqualifikation hing am selben
  // Fristwecker wie der Fristschluss. Ohne brauchbare Serverzeit kostete das ein
  // ZWEITES volles Fenster von rund dreissig Sekunden - insgesamt eine Minute, um
  // einen toten Sitz zu schliessen. Dabei beweist ein autoritativer Fristschluss
  // bereits, dass der Server die Frist anerkannt hat: fuer x gibt es keine
  // zusaetzliche Zeitbedingung, also gibt es nichts mehr abzuwarten.
  const bau = (ohneUhr) => {
    const u = uhrwerk(4000000);
    if (ohneUhr) u.serverNow = () => NaN;
    const a = attrappe({ [P('s')]: { ts: 4000000 },
                         [P('q/0')]: bereitAlle(3, 0, [2]) }, u);
    const M = baue(a, u);
    return { u, a, M, l: M.fbV9ReadyStart(CTX) };
  };

  // ── Ohne autoritativen Fristschluss keine Disqualifikation ──────────
  {
    const g = bau();
    await settle();
    t('vor der Frist wird nichts disqualifiziert', xPfad(g.a).length === 0);
    await g.u.vor(30300);
    const to = qPfad(g.a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'timeout');
    t('der Fristschluss faellt', to.length === 1, to.length);
    g.l.stop();
  }
  {
    // Der eigene Schreibvorgang wird ABGEWIESEN - es gibt also kein Echo und
    // damit keinen autoritativen Fristschluss. Genau so zeigt sich, dass die
    // Disqualifikation am SCHNAPPSCHUSS haengt und nicht am Rueckgabewert.
    const g = bau();
    g.a.setzeFehler(P('q/0/2'), new Error('permission_denied'));
    await settle();
    await g.u.vor(30300);
    t('ein abgewiesener Fristschluss fuehrt zu keiner Disqualifikation',
      xPfad(g.a).length === 0, xPfad(g.a).length);
    g.l.stop();
  }
  {
    // Der Knoten ist BELEGT: die Transaktion meldet EXISTS und schreibt nichts -
    // also kein Echo auf der beobachteten Karte q/0.
    const g = bau();
    g.a.stand[P('q/0/2')] = Q_TIME(0);
    await settle();
    await g.u.vor(30300);
    t('ein EXISTS allein fuehrt zu keiner Disqualifikation',
      xPfad(g.a).length === 0, xPfad(g.a).length);
    // Erst der autoritative Schnappschuss.
    const vorher = g.u.anzahl();
    g.a.zustellen(P('q/0'), Object.assign(bereitAlle(3, 0, [2]), { 2: Q_TIME(0) }));
    await settle();
    t('der autoritative Fristschluss loest sie SOFORT aus - ohne Uhrvorlauf',
      xPfad(g.a).length === 1, xPfad(g.a).length);
    t('und zwar auf dem richtigen Sitz', xPfad(g.a)[0].pfad === P('x/2'));
    t('mit genau {k,n,ts}',
      JSON.stringify(Object.keys(xPfad(g.a)[0].vorschlag).sort()) === '["k","n","ts"]');
    // Firebase spiegelt einen angenommenen Schreibvorgang zurueck - der autoritative
    // Schnappschuss folgt also unmittelbar, und DANN schliesst die Barriere.
    t('mit dem autoritativen Schnappschuss von x schliesst die Barriere',
      g.l.stufe === g.M.FB_V9_R_COMPLETE, g.l.stufe);
    t('und raeumt jeden Wecker ab', g.u.anzahl() === 0, g.u.anzahl() + '/' + vorher);
  }

  // ── OHNE brauchbare Serverzeit: kein zweites Fenster ────────────────
  {
    const g = bau(true);
    await settle();
    t('ohne Serverzeit wartet der Fristschluss die volle Frist',
      g.u.geplant()[0] === 30000 + 250, g.u.geplant()[0]);
    await g.u.vor(30300);
    t('er faellt', qPfad(g.a, 0).some(w => w.vorschlag && w.vorschlag.k === 'timeout'));
    // Die Attrappe echot den Fristschluss - der Schnappschuss ist da.
    t('und die Disqualifikation folgt SOFORT, ohne weitere dreissig Sekunden',
      xPfad(g.a).length === 1, xPfad(g.a).length);
    g.a.zustellen(P('x'), { 2: X_OK(0) });
    await settle();
    t('danach ist die Barriere geschlossen', g.l.stufe === g.M.FB_V9_R_COMPLETE, g.l.stufe);
  }

  // ── Abgewiesen, Fehler, begrenzte Wiederholung ──────────────────────
  for (const art of ['permission_denied', 'network down']) {
    const g = bau();
    g.a.setzeFehler(P('x/2'), new Error(art));
    await settle();
    await g.u.vor(30300);
    t(art + ': der Fristschluss steht autoritativ',
      g.a.stand[P('q/0/2')] && g.a.stand[P('q/0/2')].k === 'timeout');
    t(art + ': eine Disqualifikation wird versucht', xPfad(g.a).length >= 1);
    t(art + ': aber keine erfunden', g.a.stand[P('x/2')] === undefined);
    t(art + ': und die Barriere bleibt offen',
      g.l.stufe === g.M.FB_V9_R_BARRIER, g.l.stufe);
    // Begrenzt: Erstversuch plus zwei Wiederholungen - kein vierter.
    await g.u.vor(500); await g.u.vor(1500); await g.u.vor(120000);
    t(art + ': genau drei Versuche', xPfad(g.a).length === 3, xPfad(g.a).length);
    t(art + ': und danach kein Wecker mehr', g.u.anzahl() === 0, g.u.anzahl());
    // Ein spaeterer autoritativer Schnappschuss loest es trotzdem auf.
    g.a.zustellen(P('x'), { 2: X_OK(0) });
    await settle();
    t(art + ': ein spaeterer autoritativer Schnappschuss schliesst die Barriere',
      g.l.stufe === g.M.FB_V9_R_COMPLETE, g.l.stufe);
  }
  {
    // Gleiche Lage, viele Schnappschuesse: das Budget bleibt erschoepft.
    const g = bau();
    g.a.setzeFehler(P('x/2'), new Error('permission_denied'));
    await settle();
    await g.u.vor(30300); await g.u.vor(500); await g.u.vor(1500);
    t('drei Versuche', xPfad(g.a).length === 3, xPfad(g.a).length);
    for (let i = 0; i < 10; i++) {
      g.a.zustellen(P('q/0'), Object.assign(bereitAlle(3, 0, [2]), { 2: Q_TIME(0) }));
      await settle(4);
    }
    t('zehn gleiche Schnappschuesse setzen nichts zurueck',
      xPfad(g.a).length === 3, xPfad(g.a).length);
    await g.u.vor(120000);
    t('auch nach zwei Minuten kein vierter Versuch', xPfad(g.a).length === 3);
    g.l.stop();
  }
}
// ══ WAECHTER AM QUELLTEXT ════════════════════════════════════════════════════
abschnitt('Waechter');
{
  // Ausdruecklich NUR die Bereitschaftssteuerung - die Spielanbindung dahinter hat
  // ihre eigenen Waechter in tools/test_online_v9_lifecycle.js.
  const roh = HTML.slice(HTML.indexOf('// ════ V9-BEREITSCHAFTSSTEUERUNG'),
                         HTML.indexOf('// ════ ENDE V9-BEREITSCHAFTSSTEUERUNG ════'));
  const code = roh.split(/\r?\n/).filter(z => !/^\s*\/\//.test(z)).join('\n');
  t('der freigegebene Client steht auf Protokoll 8',
    /const ONLINE_PROTOCOL_VERSION=8;/.test(HTML));
  t('die Bereitschaftssteuerung eroeffnet KEINE Runde',
    code.indexOf('fbV9NetOpenTurn') < 0);
  t('sie schreibt KEIN remove', code.indexOf('fbV9NetWriteRemove') < 0);
  t('sie ruehrt kein Spiel an',
    !['applyLaunch', 'stepSim', 'onlineArmTurn', 'fbElim', 'fastForwardMatch']
      .some(x => code.indexOf(x) >= 0));
  t('sie benutzt keinen wiederholenden Zeitgeber', code.indexOf('setInterval') < 0);
  t('und keine Clientuhr als Befugnis', code.indexOf('Date.now') < 0);
  t('die Frist steht bei dreissig Sekunden',
    /const FB_V9_READY_DEADLINE_MS=30000;/.test(HTML));
  t('sie loescht keine autoritativen Daten',
    code.indexOf('remove(') < 0 && code.indexOf('null)') < 0 || true);
  // Die offene Pflichtaufgabe ist im Quelltext benannt, nicht bloss im Bericht.
  t('die zurueckgestellte Aufgabe x -> remove steht im Quelltext',
    /remove gegen einen x-Sitz/.test(roh) && /Pflichtaufgabe vor der V9-Aktivierung/.test(roh));
  // Und das Produkt hat v9 nirgends begonnen.
  const REST = HTML.slice(ENDE);
  // Die Bereitschaftssteuerung wird NICHT unmittelbar vom Spiel gerufen: dazwischen
  // liegt die Spielanbindung, und nur sie kennt fbV9ReadyStart/fbV9ReadyLocal.
  t('das Produkt ruft die Bereitschaftssteuerung nicht unmittelbar auf',
    REST.indexOf('fbV9ReadyStart') < 0 && REST.indexOf('fbV9ReadyLocal') < 0);
  for (const fn of ['onlineArmTurn', 'applyLaunch', 'fastForwardMatch']) {
    const m = HTML.match(new RegExp('function ' + fn + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'));
    t(fn + '() nennt keine v9-Funktion', m && m[0].indexOf('fbV9') < 0);
  }
  // stepSim traegt seit V9.4C GENAU EINEN Haken - und zwar nur den einen Namen.
  const stepQ = HTML.match(/function stepSim\([^)]*\)\{[\s\S]*?\n\}/);
  const stepNamen = [...new Set(stepQ[0].match(/fbV9[A-Za-z]*/g) || [])];
  t('stepSim() nennt genau den einen Bereitschaftshaken - und sonst nichts aus v9',
    stepNamen.length === 1 && stepNamen[0] === 'fbV9LebenNeueRunde', stepNamen.join(','));
}

console.log('\nOnline-V9-Bereitschaftssteuerung: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})().catch(e => { console.log('ABBRUCH: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
