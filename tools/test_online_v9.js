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
//   - Reveal, Hashpruefung, WebCrypto, Salt und jede Spielwirkung gehoeren NICHT hierher.
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

console.log('=== V9.1: autoritative Turn-Eroeffnung und Commit-Terminal ===');

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
  allow('ein getrennter Sitz wird uebersprungen',
        raum({ offline: [2], d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_SKIP, UID[1]);
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

console.log('\nOnline-V9.1: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
