// V9.1: die additiven Regeln fuer die autoritative Turn-Eroeffnung und das
// Commit-Terminal - geprueft gegen die ECHTE firebase.rules.json.
//
// Der Auswerter kommt aus tools/test_rules.js. Er laedt dieselbe Regeldatei und bildet
// dieselbe Semantik ab (.write-Kaskade, .validate auf geschriebenen Knoten, newData als
// Nachzustand). Eine zweite Nachbildung daneben waere die Sorte Doppelung, die frueher
// oder spaeter auseinanderlaeuft.
//
// WAS DIESE STUFE IST UND WAS NICHT:
//   - v9 ist hier NUR als Regelwerk vorhanden. Der freigegebene Client steht unveraendert
//     auf ONLINE_PROTOCOL_VERSION = 8 und kann keinen v9-Raum anlegen oder betreten.
//   - Die Fixtures unten setzen `v: 9` unmittelbar - so, wie es der Emulator beim
//     Vorbefuellen unter Umgehung der Regeln taete. Geprueft werden ausschliesslich die
//     Kindregeln darunter.
//
// WAS DIE REGELN AUSDRUECKLICH NICHT LEISTEN - damit es niemand ueberschaetzt:
//   - Firebase Rules koennen SHA-256 NICHT berechnen. Sie pruefen die FORM des Hashes
//     und die FORM des Salzes, nie ihren Zusammenhang.
//   - Es kann daher ein formal gueltiges Reveal in r/ stehen, dessen Vorlage NICHT zum
//     Hash seines Commits passt. Die Rules nehmen es an. Erst die Clientlogik in V9.3
//     muss es erkennen und bei ALLEN Teilnehmern gleich verwerfen.
//   - Die Eroeffnung des naechsten Turns ist noch nicht simulationssicher: ist der
//     Vorgaenger protokollarisch fertig, darf sofort geoeffnet werden - auch waehrend
//     ehrliche Clients die Physik der Vorrunde noch rechnen. Das schliesst erst V9.4
//     mit einer Settled/Ready-Barriere je Sitz.
//   - Turn 0 haengt weiterhin nur an state/seats. Eine Ready-Barriere zum
//     Generationsstart fehlt und gehoert ebenfalls zu V9.4.
//   - Was ein ausgebliebenes Reveal SPIELERISCH bedeutet, ist NICHT entschieden. Das
//     Protokoll haelt hier nur fest, dass nichts kam.
//   - WebCrypto, Salzerzeugung, Hashvorlage und jede Spielwirkung gehoeren nicht hierher.
//   node test_online_v9.js
const { tryWrite, NOW, UID_HOST, UID_GUEST, UID_ATTACK, GRACE } = require('./test_rules.js');

let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name); } };
const allow = (name, db, path, v, uid, also) => t('[ALLOW] ' + name, tryWrite(db, path, v, uid, also) === true);
const deny = (name, db, path, v, uid, also) => t('[DENY]  ' + name, tryWrite(db, path, v, uid, also) === false);
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 66 - s.length)));

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Fuenf feste Identitaeten; Sitz i gehoert UID[i]. Der Angreifer sitzt in keinem Raum.
const UID = [0, 1, 2, 3, 4].map(i => 'UID_V9_SEAT' + i + '_XXXXXXXXXX');
const HEX64 = 'a1b2c3d4e5f6'.repeat(5) + 'abcd';   // 64 Zeichen, nur [0-9a-f]
const SV = NOW;                                     // der aufgeloeste Serverzeitstempel

// Ein laufender v9-Raum mit `cap` Sitzen. `offline` nennt Sitze, deren Praesenz auf
// false steht (und lange genug, dass ein Peer sie schliessen duerfte); `evicted` nennt
// Sitze mit gesetztem Austragungsmarker.
function raum(opt) {
  opt = opt || {};
  const cap = opt.cap === undefined ? 3 : opt.cap;
  const offline = opt.offline || [], evicted = opt.evicted || [];
  const p = {}, players = {};
  for (let i = 0; i < cap; i++) {
    const weg = offline.indexOf(i) >= 0;
    p[i] = { s: 'V9TAB0' + i, on: !weg, t: weg ? NOW - GRACE - 1 : NOW };
    players[i] = { id: 'V9PID0' + i, name: 'P' + i, tab: 'V9TAB0' + i, uid: UID[i] };
  }
  const g = { 0: {} };
  if (evicted.length) { g[0].e = {}; for (const s of evicted) g[0].e[s] = true; }
  if (opt.d) g[0].d = opt.d;
  if (opt.c) g[0].c = opt.c;
  if (opt.ro) g[0].ro = opt.ro;
  if (opt.r) g[0].r = opt.r;
  return {
    rooms: {
      V9RM: {
        v: opt.v === undefined ? 9 : opt.v,
        hostUid: UID[0],
        config: { game: 'football', winTarget: 3, fmt: 'elimination',
                  visibility: 'private', mode: 'lives', cap: cap },
        gen: opt.gen === undefined ? 0 : opt.gen,
        state: opt.state === undefined ? 'playing' : opt.state,
        seats: opt.seats === undefined ? cap : opt.seats,
        p, players, created: NOW - 60000, g,
      },
    },
    publicRooms: {},
  };
}
// Ein bereits eroeffneter Turn. `alt` legt den Oeffnungszeitpunkt zurueck - so laesst
// sich die Frist ueberschreiten, ohne die feste Testzeit NOW zu bewegen.
const offen = (turn, alt) => { const d = {}; d[turn] = { n: Number(turn), o: NOW - (alt || 0) }; return d; };
// Vollstaendige Commit-Barriere eines Turns fuer `n` Sitze.
const barriere = (turn, n) => { const c = {}, e = {};
  for (let i = 0; i < n; i++) e[i] = { k: 'pass', ts: NOW - 1000 };
  c[turn] = e; return c; };

const O_MOVE = { k: 'move', h: HEX64, ts: SV };
const O_PASS = { k: 'pass', ts: SV };

console.log('=== V9.1/V9.2: Turn-Eroeffnung, Commit-Terminal, Reveal ===');

// ══ TURN-EROEFFNUNG ══════════════════════════════════════════════════════════
abschnitt('Turn-Eroeffnung  rooms/<code>/g/<gen>/d/<turn>');
{
  const auf = raum();                       // cap 3, state playing, seats 3
  const O0 = { n: 0, o: SV };

  allow('ein Teilnehmer eroeffnet Turn 0 mit dem Serverzeitstempel',
        auf, 'rooms/V9RM/g/0/d/0', O0, UID[1]);
  deny('write-once: ein bereits eroeffneter Turn wird nicht neu gesetzt',
       raum({ d: offen('0') }), 'rooms/V9RM/g/0/d/0', O0, UID[1]);
  deny('und er laesst sich auch nicht loeschen',
       raum({ d: offen('0') }), 'rooms/V9RM/g/0/d/0', null, UID[1]);
  deny('der Oeffnungszeitpunkt allein, ohne n, ist kein gueltiger Schreibvorgang',
       auf, 'rooms/V9RM/g/0/d/0/o', SV, UID[1]);

  // Der Zeitstempel ist NIE clientbestimmt.
  for (const paar of [['now-1', NOW - 1], ['now+1', NOW + 1], ['0', 0], ['1e15', 1e15]])
    deny('ein gefaelschter Oeffnungszeitpunkt ' + paar[0] + ' wird abgewiesen',
         auf, 'rooms/V9RM/g/0/d/0', { n: 0, o: paar[1] }, UID[1]);

  deny('ohne Anmeldung wird kein Turn eroeffnet', auf, 'rooms/V9RM/g/0/d/0', O0, null);
  deny('ein Fremder ohne Sitz eroeffnet keinen Turn', auf, 'rooms/V9RM/g/0/d/0', O0, UID_ATTACK);
  deny('ein getrennter Teilnehmer eroeffnet keinen Turn',
       raum({ offline: [1] }), 'rooms/V9RM/g/0/d/0', O0, UID[1]);
  deny('ein ausgetragener Teilnehmer eroeffnet keinen Turn',
       raum({ evicted: [1] }), 'rooms/V9RM/g/0/d/0', O0, UID[1]);
  deny('eine fremde Generation wird abgewiesen',
       raum({ gen: 1 }), 'rooms/V9RM/g/0/d/0', O0, UID[1]);

  // Der Schluessel ist die Turnnummer - und n muss ihr entsprechen.
  deny('ein missgebildeter Turnschluessel wird abgewiesen',
       auf, 'rooms/V9RM/g/0/d/abc', { n: 0, o: SV }, UID[1]);
  deny('eine fuehrende Null passt nicht zu ihrer Zahl',
       raum({ c: barriere('0', 3), d: offen('0') }),
       'rooms/V9RM/g/0/d/01', { n: 1, o: SV }, UID[1]);
  deny('n darf die Turnnummer nicht falsch behaupten',
       raum({ c: barriere('0', 3), d: offen('0') }),
       'rooms/V9RM/g/0/d/1', { n: 7, o: SV }, UID[1]);
  deny('n muss ganzzahlig sein',
       auf, 'rooms/V9RM/g/0/d/0', { n: 0.5, o: SV }, UID[1]);
  deny('ein zusaetzliches Feld wird abgewiesen',
       auf, 'rooms/V9RM/g/0/d/0', { n: 0, o: SV, x: 1 }, UID[1]);

  // v8 bleibt aussen vor.
  deny('ein v8-Raum kennt d/ nicht',
       raum({ v: 8 }), 'rooms/V9RM/g/0/d/0', O0, UID[1]);
}

// ══ REIHENFOLGE ══════════════════════════════════════════════════════════════
abschnitt('Reihenfolge: kein Turn oeffnet vor dem Abschluss seines Vorgaengers');
{
  deny('Turn 0 oeffnet nicht, solange der Raum in der Lobby steht',
       raum({ state: 'lobby' }), 'rooms/V9RM/g/0/d/0', { n: 0, o: SV }, UID[1]);
  deny('Turn 0 oeffnet nicht, wenn das Startsignal nicht der Sollbesetzung entspricht',
       raum({ seats: 2 }), 'rooms/V9RM/g/0/d/0', { n: 0, o: SV }, UID[1]);

  // DER ANGRIFF: einen kuenftigen Turn im Voraus eroeffnen, damit dessen Frist
  // bereits abgelaufen ist, wenn die ehrlichen Clients dort ankommen.
  deny('ein kuenftiger Turn laesst sich NICHT im Voraus eroeffnen',
       raum({ d: offen('0') }), 'rooms/V9RM/g/0/d/1', { n: 1, o: SV }, UID[1]);
  deny('auch nicht weit im Voraus',
       raum({ d: offen('0') }), 'rooms/V9RM/g/0/d/9', { n: 9, o: SV }, UID[1]);
  deny('eine unvollstaendige Vorgaengerbarriere reicht nicht (2 von 3 Sitzen)',
       raum({ d: offen('0'), c: barriere('0', 2) }),
       'rooms/V9RM/g/0/d/1', { n: 1, o: SV }, UID[1]);
  allow('mit vollstaendiger Vorgaengerbarriere oeffnet der naechste Turn',
        raum({ d: offen('0'), c: barriere('0', 3) }),
        'rooms/V9RM/g/0/d/1', { n: 1, o: SV }, UID[1]);

  // Die Barriere fragt die UNVERAENDERLICHE Sollbesetzung - nicht die Zahl der Kinder.
  deny('cap 5: vier Terminals reichen nicht',
       raum({ cap: 5, d: offen('0'), c: barriere('0', 4) }),
       'rooms/V9RM/g/0/d/1', { n: 1, o: SV }, UID[1]);
  allow('cap 5: fuenf Terminals reichen',
        raum({ cap: 5, d: offen('0'), c: barriere('0', 5) }),
        'rooms/V9RM/g/0/d/1', { n: 1, o: SV }, UID[1]);
  allow('cap 2: zwei Terminals reichen',
        raum({ cap: 2, d: offen('0'), c: barriere('0', 2) }),
        'rooms/V9RM/g/0/d/1', { n: 1, o: SV }, UID[1]);
  {
    // Ein Eintrag ausserhalb der Sollbesetzung ersetzt keinen fehlenden Sitz.
    const r = raum({ cap: 3, d: offen('0'), c: barriere('0', 2) });
    r.rooms.V9RM.g[0].c['0'][4] = { k: 'pass', ts: NOW - 1000 };
    deny('ein Terminal ausserhalb der Sollbesetzung erfuellt die Barriere nicht',
         r, 'rooms/V9RM/g/0/d/1', { n: 1, o: SV }, UID[1]);
  }
}

// ══ TERMINAL: MOVE ═══════════════════════════════════════════════════════════
abschnitt('Terminal move  rooms/<code>/g/<gen>/c/<turn>/<seat>');
{
  const auf = raum({ d: offen('0') });                       // Turn 0 gerade eroeffnet
  const spaet = raum({ d: offen('0', 6001) });               // Frist gerade verstrichen

  allow('der Sitzinhaber committet vor der Frist',
        auf, 'rooms/V9RM/g/0/c/0/1', O_MOVE, UID[1]);
  deny('ein fremder Sitz wird nicht committet',
       auf, 'rooms/V9RM/g/0/c/0/1', O_MOVE, UID[2]);
  deny('ein Fremder ohne Sitz committet nichts',
       auf, 'rooms/V9RM/g/0/c/0/1', O_MOVE, UID_ATTACK);
  deny('nach der Frist wird nicht mehr committet',
       spaet, 'rooms/V9RM/g/0/c/0/1', O_MOVE, UID[1]);
  deny('ohne eroeffneten Turn gibt es kein Terminal',
       raum(), 'rooms/V9RM/g/0/c/0/1', O_MOVE, UID[1]);

  // Hashform.
  for (const paar of [['grossgeschrieben', HEX64.toUpperCase()], ['zu kurz', HEX64.slice(0, 63)],
                      ['zu lang', HEX64 + 'a'], ['nicht hexadezimal', 'z'.repeat(64)],
                      ['leer', ''], ['keine Zeichenkette', 12345]])
    deny('ein Hash ' + paar[0] + ' wird abgewiesen',
         auf, 'rooms/V9RM/g/0/c/0/1', { k: 'move', h: paar[1], ts: SV }, UID[1]);
  deny('ein move ohne Hash wird abgewiesen',
       auf, 'rooms/V9RM/g/0/c/0/1', { k: 'move', ts: SV }, UID[1]);

  deny('ein gefaelschtes ts wird abgewiesen',
       auf, 'rooms/V9RM/g/0/c/0/1', { k: 'move', h: HEX64, ts: NOW - 1 }, UID[1]);
  deny('ein zusaetzliches Feld wird abgewiesen',
       auf, 'rooms/V9RM/g/0/c/0/1', { k: 'move', h: HEX64, ts: SV, dx: 1 }, UID[1]);
  deny('eine unbekannte Zugart wird abgewiesen',
       auf, 'rooms/V9RM/g/0/c/0/1', { k: 'out', ts: SV }, UID[1]);
  deny('ein Terminal, das kein Objekt ist, wird abgewiesen',
       auf, 'rooms/V9RM/g/0/c/0/1', 'move', UID[1]);

  // Write-once.
  const belegt = raum({ d: offen('0'), c: { 0: { 1: O_PASS } } });
  deny('ein belegtes Terminal wird nicht ueberschrieben',
       belegt, 'rooms/V9RM/g/0/c/0/1', O_MOVE, UID[1]);
  deny('und nicht geloescht',
       belegt, 'rooms/V9RM/g/0/c/0/1', null, UID[1]);

  // Sitzgrenzen gegen die unveraenderliche Sollbesetzung.
  allow('Sitz 0 liegt in der Sollbesetzung',
        auf, 'rooms/V9RM/g/0/c/0/0', O_MOVE, UID[0]);
  allow('Sitz cap-1 ebenso',
        auf, 'rooms/V9RM/g/0/c/0/2', O_MOVE, UID[2]);
  deny('Sitz cap liegt ausserhalb',
       raum({ cap: 3, d: offen('0') }), 'rooms/V9RM/g/0/c/0/3',
       { k: 'move', h: HEX64, ts: SV }, UID[3]);
  deny('ein missgebildeter Sitzschluessel wird abgewiesen',
       auf, 'rooms/V9RM/g/0/c/0/x', O_MOVE, UID[1]);
  deny('ein negativer Sitzschluessel ebenso',
       auf, 'rooms/V9RM/g/0/c/0/-1', O_MOVE, UID[1]);
}

// ══ TERMINAL: PASS ═══════════════════════════════════════════════════════════
abschnitt('Terminal pass - die Nullhandlung des Sitzes SELBST');
{
  const auf = raum({ d: offen('0') });
  allow('der Sitzinhaber setzt seine Nullhandlung vor der Frist',
        auf, 'rooms/V9RM/g/0/c/0/1', O_PASS, UID[1]);
  deny('ein anderer Spieler setzt sie NICHT an seiner Stelle',
       auf, 'rooms/V9RM/g/0/c/0/1', O_PASS, UID[2]);
  deny('pass mit Hash ist keine gueltige Form',
       auf, 'rooms/V9RM/g/0/c/0/1', { k: 'pass', h: HEX64, ts: SV }, UID[1]);
  deny('nach der Frist wird pass nicht mehr angenommen',
       raum({ d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/1', O_PASS, UID[1]);
  // Genau hierin liegt die Korrektur gegenueber dem ersten Entwurf: es gibt KEIN
  // fremdschreibbares Terminal, das behauptet, ein Sitz sei ausgeschieden.
  deny('niemand kann einen verbundenen Mitspieler als handlungslos erklaeren',
       auf, 'rooms/V9RM/g/0/c/0/2', { k: 'pass', ts: SV }, UID[1]);
}

// ══ TERMINAL: SKIP ═══════════════════════════════════════════════════════════
abschnitt('Terminal skip - nur gegen einen NACHWEISLICH getrennten Sitz');
{
  const O_SKIP = { k: 'skip', ts: SV };
  deny('ein verbundener Sitz wird nicht uebersprungen',
       raum({ d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  // Seit der Fristkorrektur reicht die fehlende Praesenz allein NICHT mehr - der
  // Sitz wird erst nach Ablauf des Entscheidungsfensters uebersprungen. Die alte
  // Fassung dieses Falls hielt genau das Verhalten fest, das die Luecke ausmachte.
  allow('ein getrennter Sitz wird NACH der Frist uebersprungen',
        raum({ offline: [2], d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  deny('ein Fremder ohne Sitz ueberspringt niemanden',
       raum({ offline: [2], d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID_ATTACK);
  deny('ein selbst getrennter Schreiber ueberspringt niemanden',
       raum({ offline: [1, 2], d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  deny('ein ausgetragener Sitz bekommt keinen skip - er bekommt remove',
       raum({ offline: [2], evicted: [2], d: offen('0') }),
       'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  deny('skip mit zusaetzlichem Feld wird abgewiesen',
       raum({ offline: [2], d: offen('0') }), 'rooms/V9RM/g/0/c/0/2',
       { k: 'skip', ts: SV, h: HEX64 }, UID[1]);
}

// ══ TERMINAL: REMOVE ═════════════════════════════════════════════════════════
abschnitt('Terminal remove - nur gegen einen bereits ausgetragenen Sitz');
{
  const O_REM = { k: 'remove', ts: SV };
  deny('ohne Austragungsmarker gibt es kein remove',
       raum({ offline: [2], d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_REM, UID[1]);
  allow('mit Austragungsmarker wird der Slot geschlossen',
        raum({ offline: [2], evicted: [2], d: offen('0') }),
        'rooms/V9RM/g/0/c/0/2', O_REM, UID[1]);
  deny('ein Fremder ohne Sitz schliesst ihn nicht',
       raum({ offline: [2], evicted: [2], d: offen('0') }),
       'rooms/V9RM/g/0/c/0/2', O_REM, UID_ATTACK);
}

// ══ TERMINAL: LATE ═══════════════════════════════════════════════════════════
abschnitt('Terminal late - erst hinter der autoritativen Frist');
{
  const O_LATE = { k: 'late', ts: SV };
  deny('vor der Frist ist late unzulaessig',
       raum({ d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_LATE, UID[1]);
  deny('genau AUF der Frist ebenso - erst danach',
       raum({ d: offen('0', 6000) }), 'rooms/V9RM/g/0/c/0/2', O_LATE, UID[1]);
  allow('eine Millisekunde danach schliesst ein Mitspieler den Slot',
        raum({ d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2', O_LATE, UID[1]);
  // Kehrt ein allein verbliebener Client nach der Frist zurueck, gaebe es sonst
  // niemanden, der seinen Slot schliessen koennte - die Runde stuende fuer immer.
  allow('auch der Sitzinhaber selbst darf seinen abgelaufenen Slot schliessen',
        raum({ d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2', O_LATE, UID[2]);
  deny('ein Fremder ohne Sitz schliesst ihn nicht',
       raum({ d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2', O_LATE, UID_ATTACK);
  deny('ein bereits geschlossener Slot wird nicht erneut geschlossen',
       raum({ d: offen('0', 6001), c: { 0: { 2: O_PASS } } }),
       'rooms/V9RM/g/0/c/0/2', O_LATE, UID[1]);
  // Das Rennen zwischen Eigner und Sentinel loest write-once - nicht die Reihenfolge.
  deny('ein bereits committeter Slot bleibt beim Commit',
       raum({ d: offen('0', 6001), c: { 0: { 2: O_MOVE } } }),
       'rooms/V9RM/g/0/c/0/2', O_LATE, UID[1]);
}

// ══ REGRESSION v4-v8 ═════════════════════════════════════════════════════════
abschnitt('Regression: v8 bleibt unberuehrt');
{
  const v8 = raum({ v: 8, d: offen('0') });
  deny('ein v8-Raum schreibt kein v9-Terminal',
       v8, 'rooms/V9RM/g/0/c/0/1', O_MOVE, UID[1]);
  deny('und keinen v9-Turnbeginn',
       raum({ v: 8 }), 'rooms/V9RM/g/0/d/0', { n: 0, o: SV }, UID[1]);
  // Der bestehende v8-Zugpfad bleibt genau der, der er war.
  allow('der v8-Zugpfad t/ steht unveraendert offen',
        raum({ v: 8 }), 'rooms/V9RM/g/0/t/0/1',
        { k: 'move', idx: 1, dx: 10, dy: -10, sp: 0 }, UID[1]);
  // Umgekehrt bleibt der Klartextpfad einem v9-Raum verschlossen: die v8-Regel verlangt
  // v zwischen 4 und 8. Das ist keine Einschraenkung, sondern der Zweck - ein v9-Raum,
  // in dem der Zug weiterhin im Klartext liegen koennte, waere Commit/Reveal umsonst.
  deny('ein v9-Raum kann den Klartextpfad t/ NICHT mehr benutzen',
       raum(), 'rooms/V9RM/g/0/t/0/1',
       { k: 'move', idx: 1, dx: 10, dy: -10, sp: 0 }, UID[1]);
}


// ═════════════════════════════════════════════════════════════════════════════
// V9.2: DER REVEAL
// ═════════════════════════════════════════════════════════════════════════════
// Die Enthuellung ist der zweite Halbschritt eines Zuges. Ihr Anker liegt in einem
// EIGENEN Namensraum (ro/<turn>), nicht als drittes Kind unter d/<turn>: dort traegt
// `!data.exists()` die Write-once-Zusage von V9.1 fuer n und o, und `$other: false`
// sperrt jedes weitere Kind. Ein eigener Pfad ist ausserdem ein Blatt - eine Zahl,
// write-once, `=== now` - und haelt die beiden Zeitanker sprachlich auseinander.
const HEX32 = '0123456789abcdef'.repeat(2);          // 32 Zeichen, kleingeschrieben
const REVEAL_MS = 6000;
// Terminals eines Turns in gewuenschter Zusammensetzung.
const terminals = (turn, arten) => { const c = {}, e = {};
  arten.forEach((k, i) => { e[i] = k === 'move' ? { k: 'move', h: HEX64, ts: NOW - 2000 }
                                                : { k: k, ts: NOW - 2000 }; });
  c[turn] = e; return c; };
// Der Reveal-Anker. `alt` legt ihn zurueck, um die Frist zu ueberschreiten.
const revOffen = (turn, alt) => { const o = {}; o[turn] = NOW - (alt || 0); return o; };
const ergebnisse = (turn, obj) => { const r = {}; r[turn] = obj; return r; };
const REVEAL = { k: 'reveal', idx: 1, dx: 12, dy: -8, sp: 0.5, n: HEX32, ts: SV };
const NOREVEAL = { k: 'noreveal', ts: SV };

// ══ REVEAL-ANKER ═════════════════════════════════════════════════════════════
abschnitt('Reveal-Anker  rooms/<code>/g/<gen>/ro/<turn>');
{
  const offenOhne = { d: offen('0') };
  deny('vor vollstaendiger Commit-Barriere oeffnet die Enthuellung nicht',
       raum(offenOhne), 'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  deny('auch nicht bei zwei von drei Terminals',
       raum({ d: offen('0'), c: terminals('0', ['move', 'pass']) }),
       'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  allow('mit allen drei Terminals oeffnet sie',
        raum({ d: offen('0'), c: terminals('0', ['move', 'pass', 'late']) }),
        'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  allow('cap 2: zwei Terminals genuegen',
        raum({ cap: 2, d: offen('0'), c: terminals('0', ['move', 'pass']) }),
        'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  deny('cap 5: vier Terminals genuegen nicht',
       raum({ cap: 5, d: offen('0'), c: terminals('0', ['move', 'pass', 'pass', 'pass']) }),
       'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  allow('cap 5: fuenf Terminals genuegen',
        raum({ cap: 5, d: offen('0'), c: terminals('0', ['move', 'pass', 'pass', 'pass', 'late']) }),
        'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  {
    // Ein Eintrag ausserhalb der Sollbesetzung ersetzt keinen fehlenden Sitz.
    const r = raum({ cap: 3, d: offen('0'), c: terminals('0', ['move', 'pass']) });
    r.rooms.V9RM.g[0].c['0'][4] = { k: 'pass', ts: NOW - 2000 };
    deny('ein Terminal ausserhalb der Sollbesetzung erfuellt die Barriere nicht',
         r, 'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  }
  const voll = { d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']) };
  for (const paar of [['now-1', NOW - 1], ['now+1', NOW + 1], ['0', 0], ['1e15', 1e15]])
    deny('ein gefaelschter Reveal-Anker ' + paar[0] + ' wird abgewiesen',
         raum(voll), 'rooms/V9RM/g/0/ro/0', paar[1], UID[1]);
  deny('ein Anker, der keine Zahl ist, wird abgewiesen',
       raum(voll), 'rooms/V9RM/g/0/ro/0', { o: SV }, UID[1]);
  deny('write-once: ein gesetzter Anker wird nicht neu gesetzt',
       raum({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']), ro: revOffen('0') }),
       'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  deny('und er laesst sich nicht loeschen',
       raum({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']), ro: revOffen('0') }),
       'rooms/V9RM/g/0/ro/0', null, UID[1]);
  deny('ohne Anmeldung wird kein Anker gesetzt', raum(voll), 'rooms/V9RM/g/0/ro/0', SV, null);
  deny('ein Fremder ohne Sitz setzt keinen Anker', raum(voll), 'rooms/V9RM/g/0/ro/0', SV, UID_ATTACK);
  deny('ein getrennter Teilnehmer setzt keinen Anker',
       raum({ offline: [1], d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']) }),
       'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  deny('ohne eroeffneten Turn gibt es keinen Reveal-Anker',
       raum({ c: terminals('0', ['move', 'pass', 'pass']) }), 'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  deny('eine fremde Generation wird abgewiesen',
       raum({ gen: 1, d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']) }),
       'rooms/V9RM/g/0/ro/0', SV, UID[1]);
  deny('ein v8-Raum kennt ro/ nicht',
       raum({ v: 8, d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']) }),
       'rooms/V9RM/g/0/ro/0', SV, UID[1]);
}

// ══ REVEAL ═══════════════════════════════════════════════════════════════════
abschnitt('Reveal-Ergebnis  rooms/<code>/g/<gen>/r/<turn>/<seat>');
{
  // Sitz 1 hat committet, die Barriere steht, die Enthuellung laeuft.
  const basis = (arten, alt) => raum({
    d: offen('0'), c: terminals('0', arten || ['move', 'move', 'pass']),
    ro: revOffen('0', alt) });
  const laeuft = basis();

  allow('der Sitzinhaber enthuellt seinen Zug',
        laeuft, 'rooms/V9RM/g/0/r/0/1', REVEAL, UID[1]);
  deny('ein anderer Spieler enthuellt ihn NICHT an seiner Stelle',
       laeuft, 'rooms/V9RM/g/0/r/0/1', REVEAL, UID[2]);
  deny('ein Fremder ohne Sitz enthuellt nichts',
       laeuft, 'rooms/V9RM/g/0/r/0/1', REVEAL, UID_ATTACK);

  // Nur ein verborgener Zug wird enthuellt - die vier Nullterminals nie.
  for (const art of ['pass', 'skip', 'remove', 'late'])
    deny('nach einem ' + art + ' gibt es nichts zu enthuellen',
         basis(['move', art, 'pass']), 'rooms/V9RM/g/0/r/0/1',
         { k: 'reveal', idx: 1, dx: 12, dy: -8, sp: 0.5, n: HEX32, ts: SV }, UID[1]);
  deny('ohne Commit erst recht nicht',
       raum({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']), ro: revOffen('0') }),
       'rooms/V9RM/g/0/r/0/2', { k: 'reveal', idx: 2, dx: 1, dy: 1, sp: 0, n: HEX32, ts: SV }, UID[2]);
  deny('vor dem Reveal-Anker wird nicht enthuellt',
       raum({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']) }),
       'rooms/V9RM/g/0/r/0/1', REVEAL, UID[1]);

  // Das Salz: 128 Bit, kleingeschrieben hexadezimal.
  for (const paar of [['grossgeschrieben', HEX32.toUpperCase()], ['zu kurz', HEX32.slice(0, 31)],
                      ['zu lang', HEX32 + 'a'], ['nicht hexadezimal', 'z'.repeat(32)],
                      ['leer', ''], ['keine Zeichenkette', 12345]])
    deny('ein Salz ' + paar[0] + ' wird abgewiesen',
         laeuft, 'rooms/V9RM/g/0/r/0/1',
         { k: 'reveal', idx: 1, dx: 12, dy: -8, sp: 0.5, n: paar[1], ts: SV }, UID[1]);

  // Der Vektor traegt dieselben Grenzen wie im v8-Zugslot.
  for (const paar of [['dx zu gross', { dx: 196 }], ['dx zu klein', { dx: -196 }],
                      ['dy zu gross', { dy: 196 }], ['sp zu gross', { sp: 1.5 }],
                      ['sp zu klein', { sp: -1.5 }], ['idx nicht ganzzahlig', { idx: 1.5 }],
                      ['idx fremde Figur', { idx: 2 }], ['idx ausserhalb', { idx: 6 }]])
    deny('ein Reveal mit ' + paar[0] + ' wird abgewiesen',
         laeuft, 'rooms/V9RM/g/0/r/0/1', Object.assign({}, REVEAL, paar[1]), UID[1]);

  deny('ein gefaelschtes ts wird abgewiesen',
       laeuft, 'rooms/V9RM/g/0/r/0/1', Object.assign({}, REVEAL, { ts: NOW - 1 }), UID[1]);
  deny('ein zusaetzliches Feld wird abgewiesen',
       laeuft, 'rooms/V9RM/g/0/r/0/1', Object.assign({}, REVEAL, { h: HEX64 }), UID[1]);
  for (const feld of ['idx', 'dx', 'dy', 'sp', 'n', 'ts']) {
    const unvollstaendig = Object.assign({}, REVEAL); delete unvollstaendig[feld];
    deny('ein Reveal ohne ' + feld + ' wird abgewiesen',
         laeuft, 'rooms/V9RM/g/0/r/0/1', unvollstaendig, UID[1]);
  }
  deny('eine unbekannte Ergebnisart wird abgewiesen',
       laeuft, 'rooms/V9RM/g/0/r/0/1', { k: 'maybe', ts: SV }, UID[1]);
  deny('ein Ergebnis, das kein Objekt ist, wird abgewiesen',
       laeuft, 'rooms/V9RM/g/0/r/0/1', 'reveal', UID[1]);

  // Die Frist der Enthuellung - auf die Millisekunde.
  allow('genau AUF der Reveal-Frist wird noch enthuellt',
        basis(null, REVEAL_MS), 'rooms/V9RM/g/0/r/0/1', REVEAL, UID[1]);
  deny('eine Millisekunde danach nicht mehr',
       basis(null, REVEAL_MS + 1), 'rooms/V9RM/g/0/r/0/1', REVEAL, UID[1]);

  // Write-once.
  const belegt = raum({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']),
                        ro: revOffen('0'), r: ergebnisse('0', { 1: REVEAL }) });
  deny('ein belegtes Ergebnis wird nicht ueberschrieben',
       belegt, 'rooms/V9RM/g/0/r/0/1', REVEAL, UID[1]);
  deny('und nicht geloescht', belegt, 'rooms/V9RM/g/0/r/0/1', null, UID[1]);
  deny('ein Sitz ausserhalb der Sollbesetzung hat kein Ergebnis',
       raum({ cap: 3, d: offen('0'), c: terminals('0', ['move', 'move', 'pass']), ro: revOffen('0') }),
       'rooms/V9RM/g/0/r/0/3', Object.assign({}, REVEAL, { idx: 3 }), UID[3]);
}

// ══ NOREVEAL ═════════════════════════════════════════════════════════════════
abschnitt('Ausbleibende Enthuellung - das Protokoll haelt sie fest, mehr nicht');
{
  const mitAnker = (alt) => raum({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']),
                                   ro: revOffen('0', alt) });
  deny('vor der Reveal-Frist ist noreveal unzulaessig',
       mitAnker(0), 'rooms/V9RM/g/0/r/0/1', NOREVEAL, UID[2]);
  deny('genau AUF der Frist ebenso - erst danach',
       mitAnker(REVEAL_MS), 'rooms/V9RM/g/0/r/0/1', NOREVEAL, UID[2]);
  allow('eine Millisekunde danach schliesst ein Mitspieler den Slot',
        mitAnker(REVEAL_MS + 1), 'rooms/V9RM/g/0/r/0/1', NOREVEAL, UID[2]);
  allow('auch der Sitzinhaber selbst darf ihn schliessen',
        mitAnker(REVEAL_MS + 1), 'rooms/V9RM/g/0/r/0/1', NOREVEAL, UID[1]);
  deny('ein Fremder ohne Sitz schliesst ihn nicht',
       mitAnker(REVEAL_MS + 1), 'rooms/V9RM/g/0/r/0/1', NOREVEAL, UID_ATTACK);
  deny('ohne verborgenen Zug gibt es kein noreveal',
       raum({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
              ro: revOffen('0', REVEAL_MS + 1) }),
       'rooms/V9RM/g/0/r/0/1', NOREVEAL, UID[2]);
  deny('noreveal mit Vektor ist keine gueltige Form',
       mitAnker(REVEAL_MS + 1), 'rooms/V9RM/g/0/r/0/1',
       { k: 'noreveal', idx: 1, dx: 1, dy: 1, sp: 0, ts: SV }, UID[2]);
  deny('noreveal mit Salz ebenso',
       mitAnker(REVEAL_MS + 1), 'rooms/V9RM/g/0/r/0/1',
       { k: 'noreveal', n: HEX32, ts: SV }, UID[2]);
  deny('ein gefaelschtes ts wird abgewiesen',
       mitAnker(REVEAL_MS + 1), 'rooms/V9RM/g/0/r/0/1', { k: 'noreveal', ts: NOW - 1 }, UID[2]);

  // Das Rennen zwischen Enthuellung und Fristschluss loest write-once.
  const mitReveal = raum({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']),
                           ro: revOffen('0', REVEAL_MS + 1), r: ergebnisse('0', { 1: REVEAL }) });
  deny('noreveal ueberschreibt keine gueltige Enthuellung',
       mitReveal, 'rooms/V9RM/g/0/r/0/1', NOREVEAL, UID[2]);
  const mitNoreveal = raum({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']),
                             ro: revOffen('0'), r: ergebnisse('0', { 1: NOREVEAL }) });
  deny('und eine Enthuellung ueberschreibt kein noreveal',
       mitNoreveal, 'rooms/V9RM/g/0/r/0/1', REVEAL, UID[1]);
  deny('ein zweites noreveal auf denselben Slot wird abgewiesen',
       raum({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']),
              ro: revOffen('0', REVEAL_MS + 1), r: ergebnisse('0', { 1: NOREVEAL }) }),
       'rooms/V9RM/g/0/r/0/1', NOREVEAL, UID[2]);
}

// ══ VERSCHAERFTE VORGAENGERBEDINGUNG ═════════════════════════════════════════
abschnitt('Vollstaendigkeit des Vorgaengers: zu jedem move gehoert ein Ergebnis');
{
  // V9.1 verlangte nur die Commit-Barriere. Das reichte nicht: ein Turn mit einem
  // committeten, aber nie enthuellten Zug war protokollarisch offen - und der naechste
  // Turn durfte trotzdem starten.
  const naechster = (opt) => tryWrite(raum(opt), 'rooms/V9RM/g/0/d/1', { n: 1, o: SV }, UID[1]);
  const OK = (n, b) => t('[ALLOW] ' + n, b === true);
  const NEIN = (n, b) => t('[DENY]  ' + n, b === false);

  NEIN('ein committeter, aber unenthuellter Zug haelt den naechsten Turn auf',
       naechster({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']) }));
  OK('lauter Nullterminals brauchen kein Ergebnis',
     naechster({ d: offen('0'), c: terminals('0', ['pass', 'skip', 'late']) }));
  OK('mit Enthuellung geht es weiter',
     naechster({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
                 ro: revOffen('0'), r: ergebnisse('0', { 0: REVEAL }) }));
  OK('und mit festgehaltener Nicht-Enthuellung ebenso',
     naechster({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
                 ro: revOffen('0'), r: ergebnisse('0', { 0: NOREVEAL }) }));
  NEIN('zwei Zuege, nur einer enthuellt - noch nicht',
       naechster({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']),
                   ro: revOffen('0'), r: ergebnisse('0', { 0: REVEAL }) }));
  OK('beide enthuellt - jetzt',
     naechster({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']),
                 ro: revOffen('0'), r: ergebnisse('0', { 0: REVEAL, 1: REVEAL }) }));
  NEIN('cap 5: vier von fuenf Zuegen enthuellt reicht nicht',
       naechster({ cap: 5, d: offen('0'), c: terminals('0', ['move', 'move', 'move', 'move', 'move']),
                   ro: revOffen('0'), r: ergebnisse('0', { 0: REVEAL, 1: REVEAL, 2: REVEAL, 3: REVEAL }) }));
  OK('cap 5: gemischt - drei Zuege enthuellt, zwei Nullterminals',
     naechster({ cap: 5, d: offen('0'), c: terminals('0', ['move', 'pass', 'move', 'late', 'move']),
                 ro: revOffen('0'), r: ergebnisse('0', { 0: REVEAL, 2: REVEAL, 4: REVEAL }) }));
  NEIN('ein Ergebnis fuer einen Sitz ausserhalb der Sollbesetzung hilft nicht',
       naechster({ cap: 3, d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
                   ro: revOffen('0'), r: ergebnisse('0', { 4: REVEAL }) }));
  NEIN('und ein Ergebnis am falschen Sitz ebenso wenig',
       naechster({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
                   ro: revOffen('0'), r: ergebnisse('0', { 1: REVEAL }) }));

  // OFFEN UND AUSDRUECKLICH SO BENANNT: das loest die Voreroeffnung NICHT vollstaendig.
  // Ist der Vorgaenger protokollarisch fertig, darf der naechste Turn sofort oeffnen -
  // auch waehrend die ehrlichen Clients die Physik der Vorrunde noch rechnen. Dieses
  // Fenster schliesst erst V9.4 mit einer Settled/Ready-Barriere je Sitz.
  OK('ANMERKUNG: unmittelbar nach der Vollstaendigkeit darf sofort geoeffnet werden -'
     + ' das Simulationsfenster bleibt bis V9.4 offen',
     naechster({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
                 ro: revOffen('0'), r: ergebnisse('0', { 0: REVEAL }) }));
}

// ══ FRISTSCHLUSS: SKIP TRAEGT JETZT DIE FRIST ════════════════════════════════
abschnitt('skip schliesst kein Fenster vorzeitig');
{
  // DIE LUECKE, die hier geschlossen ist: skip verlangte frueher nur `on === false`.
  // Damit konnte ein Mitspieler das Entscheidungsfenster eines anderen beenden,
  // sobald dessen Praesenz kurz flackerte - Tunnel, WLAN-Wechsel, Bildschirmsperre -,
  // obwohl von den sechs Sekunden noch fuenf uebrig waren. Write-once machte das
  // endgueltig. Jetzt verlangt skip BEIDES: getrennt UND Frist verstrichen.
  const O_SKIP = { k: 'skip', ts: SV };
  deny('vor der Frist wird ein getrennter Sitz NICHT uebersprungen',
       raum({ offline: [2], d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  deny('genau AUF der Frist ebenso',
       raum({ offline: [2], d: offen('0', 6000) }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  allow('eine Millisekunde danach schon',
        raum({ offline: [2], d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  deny('ein VERBUNDENER Sitz wird auch nach der Frist nicht uebersprungen',
       raum({ d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  deny('und vor der Frist erst recht nicht',
       raum({ d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  deny('write-once: ein belegter Slot bleibt belegt',
       raum({ offline: [2], d: offen('0', 6001), c: { 0: { 2: { k: 'pass', ts: NOW - 1 } } } }),
       'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  deny('ein zusaetzliches Feld wird abgewiesen',
       raum({ offline: [2], d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2',
       { k: 'skip', ts: SV, h: HEX64 }, UID[1]);
  deny('ein gefaelschtes ts wird abgewiesen',
       raum({ offline: [2], d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2',
       { k: 'skip', ts: NOW - 1 }, UID[1]);
  deny('ein Ziel ausserhalb der Sollbesetzung wird abgewiesen',
       raum({ cap: 3, offline: [2], d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/3',
       O_SKIP, UID[1]);
  deny('ein ausgetragener Sitz bekommt weiterhin kein skip',
       raum({ offline: [2], evicted: [2], d: offen('0', 6001) }),
       'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  deny('ohne eroeffnete Runde gibt es kein skip',
       raum({ offline: [2] }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
  // Der v8-Zugslot ist von alledem unberuehrt - dort gibt es diese Frist nicht.
  allow('der v8-Sentinel bleibt unveraendert ohne Fristbedingung',
        raum({ v: 8, offline: [2] }), 'rooms/V9RM/g/0/t/0/2',
        { k: 'skip', idx: 2, dx: 0, dy: 0, sp: 0 }, UID[1]);
}

// ══ FRISTSCHLUSS: LATE, REMOVE UND NOREVEAL IM ZUSAMMENSPIEL ════════════════
abschnitt('Die uebrigen Fristschliesser');
{
  const O_LATE = { k: 'late', ts: SV };
  deny('late vor der Frist', raum({ d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_LATE, UID[1]);
  deny('late genau AUF der Frist',
       raum({ d: offen('0', 6000) }), 'rooms/V9RM/g/0/c/0/2', O_LATE, UID[1]);
  allow('late danach durch einen Mitspieler',
        raum({ d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2', O_LATE, UID[1]);
  allow('und durch den Sitzinhaber selbst',
        raum({ d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2', O_LATE, UID[2]);
  deny('ein belegter Slot bleibt belegt',
       raum({ d: offen('0', 6001), c: { 0: { 2: { k: 'pass', ts: NOW - 1 } } } }),
       'rooms/V9RM/g/0/c/0/2', O_LATE, UID[1]);
  // remove haengt allein am Austragungsmarker - nicht an der Frist.
  const O_REM = { k: 'remove', ts: SV };
  deny('ohne Marker kein remove',
       raum({ offline: [2], d: offen('0', 6001) }), 'rooms/V9RM/g/0/c/0/2', O_REM, UID[1]);
  allow('mit Marker schon',
        raum({ offline: [2], evicted: [2], d: offen('0', 6001) }),
        'rooms/V9RM/g/0/c/0/2', O_REM, UID[1]);
  {
    // Der Marker selbst wird von diesem Weg NIE gesetzt - er gehoert der
    // Austragungsmaschinerie und verlangt fuenfzehn Sekunden Abwesenheit.
    const r = raum({ offline: [2], d: offen('0', 6001) });
    deny('ein Schreiber kann den Austragungsmarker nicht nebenbei setzen',
         r, 'rooms/V9RM/g/0/e/2', true, UID[1]);
  }
  // noreveal: nur nach der Reveal-Frist, nur zu einem verborgenen Zug.
  const mitAnker = (alt) => raum({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']),
                                   ro: revOffen('0', alt) });
  const O_NR = { k: 'noreveal', ts: SV };
  deny('noreveal vor der Frist', mitAnker(0), 'rooms/V9RM/g/0/r/0/1', O_NR, UID[2]);
  deny('noreveal genau AUF der Frist', mitAnker(6000), 'rooms/V9RM/g/0/r/0/1', O_NR, UID[2]);
  allow('danach durch einen Mitspieler', mitAnker(6001), 'rooms/V9RM/g/0/r/0/1', O_NR, UID[2]);
  allow('und durch den Sitzinhaber selbst', mitAnker(6001), 'rooms/V9RM/g/0/r/0/1', O_NR, UID[1]);
  deny('ohne verborgenen Zug gibt es kein noreveal',
       raum({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
              ro: revOffen('0', 6001) }), 'rooms/V9RM/g/0/r/0/1', O_NR, UID[2]);
  deny('und ein belegtes Ergebnis bleibt belegt',
       raum({ d: offen('0'), c: terminals('0', ['move', 'move', 'pass']),
              ro: revOffen('0', 6001), r: ergebnisse('0', { 1: { k: 'noreveal', ts: NOW - 1 } }) }),
       'rooms/V9RM/g/0/r/0/1', O_NR, UID[2]);
}
// ══ REGRESSION ═══════════════════════════════════════════════════════════════
abschnitt('Regression: v8 kennt auch die Reveal-Pfade nicht');
{
  const v8voll = { v: 8, d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
                   ro: revOffen('0') };
  deny('ein v8-Raum schreibt kein Reveal-Ergebnis',
       raum(v8voll), 'rooms/V9RM/g/0/r/0/1', REVEAL, UID[1]);
  deny('und kein noreveal',
       raum({ v: 8, d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
              ro: revOffen('0', REVEAL_MS + 1) }),
       'rooms/V9RM/g/0/r/0/1', NOREVEAL, UID[2]);
  allow('der v8-Zugpfad t/ bleibt unveraendert offen',
        raum({ v: 8 }), 'rooms/V9RM/g/0/t/0/1',
        { k: 'move', idx: 1, dx: 10, dy: -10, sp: 0 }, UID[1]);
}

console.log('\nOnline-V9: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
