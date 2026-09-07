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
//   - SEIT V9.4B1 ist die Voreroeffnung geschlossen: d/<turn> verlangt zusaetzlich zur
//     Protokollvollstaendigkeit des Vorgaengers den Abschlussanker z und eine
//     vollstaendige Bereitschaftsbarriere q je Sitz. Turn 0 haengt am Generationsstart s.
//     Was die Regeln weiterhin NICHT wissen: ob ein Client seine Physik wirklich
//     gerechnet hat. Sie wissen nur, dass er es selbst erklaert hat - und genau deshalb
//     ist die Bereitschaft besitzergebunden: ein Sitz kann nur sich selbst melden.
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
  // `flackern` nennt Sitze, deren Praesenz zwar auf false steht, aber NOCH NICHT
  // lange genug fuer eine Austragung. Genau daran scheitert ein Flackern.
  const flackern = opt.flackern || [];
  for (let i = 0; i < cap; i++) {
    const weg = offline.indexOf(i) >= 0, kurz = flackern.indexOf(i) >= 0;
    p[i] = { s: 'V9TAB0' + i, on: !(weg || kurz),
             t: weg ? NOW - GRACE - 1 : (kurz ? NOW - GRACE + 1 : NOW) };
    players[i] = { id: 'V9PID0' + i, name: 'P' + i, tab: 'V9TAB0' + i, uid: UID[i] };
  }
  const g = { 0: {} };
  if (evicted.length) { g[0].e = {}; for (const s of evicted) g[0].e[s] = true; }
  // V9.4: Generationsstart, Protokollabschluesse, Bereitschaft, Disqualifikation.
  // Die drei neuen Tore sind hier STANDARDMAESSIG ERFUELLT. Sonst muesste jeder
  // aeltere Test sie mitschleppen und pruefte am Ende nicht mehr das, wofuer er
  // geschrieben wurde. Jeder neue Test schaltet gezielt genau EIN Tor ab.
  if (opt.s !== false) g[0].s = { ts: opt.sTs === undefined ? NOW - 60000 : opt.sTs };
  const zListe = opt.z === undefined ? [0, 1, 2] : opt.z;
  if (zListe.length) { g[0].z = {}; for (const n of zListe) g[0].z[n] = { ts: opt.zTs === undefined ? NOW - 60000 : opt.zTs }; }
  if (opt.q) g[0].q = opt.q;
  else {
    const bListe = opt.bereit === undefined ? [0, 1, 2] : opt.bereit;
    if (bListe.length) { g[0].q = {};
      for (const n of bListe) { g[0].q[n] = {};
        for (let i = 0; i < cap; i++) g[0].q[n][i] = { k: 'ready', n: Number(n), ts: NOW - 1000 }; } }
  }
  if (opt.x) { g[0].x = {}; for (const k in opt.x) g[0].x[k] = opt.x[k]; }
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
// V9.4-Bausteine.
const O_TS = { ts: SV };
const bereitSatz = (turn, n, aus) => { const q = {}; q[turn] = {};
  for (let i = 0; i < n; i++) if (!aus || aus.indexOf(i) < 0) q[turn][i] = { k: 'ready', n: Number(turn), ts: NOW - 1000 };
  return q; };
const O_READY = (n) => ({ k: 'ready', n: n, ts: SV });
const O_TIMEOUT = (n) => ({ k: 'timeout', n: n, ts: SV });
const O_X = (n) => ({ k: 'ready_timeout', n: n, ts: SV });
const ergSatz = (turn, m) => { const r = {}; r[turn] = m; return r; };

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

  // Die Protokollvollstaendigkeit allein oeffnet den naechsten Turn NICHT mehr: seit
  // V9.4B1 muessen Abschlussanker und Bereitschaftsbarriere dazukommen. Dieser Test
  // haelt nur noch fest, dass die Vorgaengerbedingung fuer sich genommen erfuellt ist -
  // die Fixture stellt die beiden neuen Tore bereit (s. raum()).
  OK('ANMERKUNG: die Vorgaengerbedingung allein ist erfuellt - die Voreroeffnung'
     + ' verhindern jetzt zusaetzlich z und die Bereitschaftsbarriere',
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
    // Der Marker gehoert der Austragungsmaschinerie und verlangt die volle
    // Abwesenheitsfrist. Ein blosses Flackern setzt ihn nicht - erst danach.
    deny('ein Schreiber kann den Austragungsmarker nicht nebenbei setzen',
         raum({ flackern: [2], d: offen('0', 6001) }), 'rooms/V9RM/g/0/e/2', true, UID[1]);
    allow('erst nach der vollen Abwesenheitsfrist traegt er',
          raum({ offline: [2], d: offen('0', 6001) }), 'rooms/V9RM/g/0/e/2', true, UID[1]);
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

// ══ V9.4B1: GENERATIONSSTART, PROTOKOLLABSCHLUSS, BEREITSCHAFT ══════════
abschnitt('Generationsstart  g/<gen>/s');
{
  allow('ein Teilnehmer legt den Generationsstart an',
        raum({ s: false }), 'rooms/V9RM/g/0/s', O_TS, UID[1]);
  deny('write-once: ein zweites Mal geht nicht',
       raum(), 'rooms/V9RM/g/0/s', O_TS, UID[1]);
  for (const paar of [['now-1', NOW - 1], ['now+1', NOW + 1], ['0', 0]])
    deny('ein selbstgesetzter Zeitstempel (' + paar[0] + ') wird abgewiesen',
         raum({ s: false }), 'rooms/V9RM/g/0/s', { ts: paar[1] }, UID[1]);
  deny('ein Fremder ohne Sitz legt ihn nicht an',
       raum({ s: false }), 'rooms/V9RM/g/0/s', O_TS, UID_ATTACK);
  deny('eine fremde Generation wird abgewiesen',
       raum({ s: false }), 'rooms/V9RM/g/1/s', O_TS, UID[1]);
  deny('ein zusaetzliches Feld macht ihn ungueltig',
       raum({ s: false }), 'rooms/V9RM/g/0/s', { ts: SV, x: 1 }, UID[1]);
}

abschnitt('Protokollabschluss  g/<gen>/z/<turn>');
{
  const zAuf = (opt) => tryWrite(raum(Object.assign({ z: [] }, opt)), 'rooms/V9RM/g/0/z/0', O_TS, UID[1]);
  const OKz = (n, b) => t('[ALLOW] ' + n, b === true);
  const NEINz = (n, b) => t('[DENY]  ' + n, b === false);
  NEINz('vor der Commit-Barriere gibt es keinen Abschluss',
        zAuf({ d: offen('0'), c: barriere('0', 2) }));
  NEINz('ein committeter, aber unenthuellter Zug haelt ihn auf',
        zAuf({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']) }));
  OKz('nach vollstaendiger Ergebnisbarriere darf er entstehen',
      zAuf({ d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
             ro: revOffen('0'), r: ergSatz('0', { 0: REVEAL }) }));
  OKz('lauter Nullterminals brauchen kein Ergebnis',
      zAuf({ d: offen('0'), c: terminals('0', ['pass', 'skip', 'late']) }));
  deny('write-once: ein zweiter Abschluss derselben Runde',
       raum({ z: [0], d: offen('0'), c: barriere('0', 3) }), 'rooms/V9RM/g/0/z/0', O_TS, UID[1]);
  deny('ein selbstgesetzter Zeitstempel wird abgewiesen',
       raum({ z: [], d: offen('0'), c: barriere('0', 3) }), 'rooms/V9RM/g/0/z/0', { ts: NOW - 1 }, UID[1]);
  deny('ein Fremder ohne Sitz schliesst nichts ab',
       raum({ z: [], d: offen('0'), c: barriere('0', 3) }), 'rooms/V9RM/g/0/z/0', O_TS, UID_ATTACK);
}

abschnitt('Bereitschaft  g/<gen>/q/<turn>/<seat>');
{
  deny('ohne Generationsstart gibt es keine Bereitschaft fuer Runde 0',
       raum({ s: false, q: {} }), 'rooms/V9RM/g/0/q/0/1', O_READY(0), UID[1]);
  allow('mit Generationsstart meldet sich der Sitz selbst bereit',
        raum({ q: {} }), 'rooms/V9RM/g/0/q/0/1', O_READY(0), UID[1]);
  deny('ein Mitspieler kann einen fremden Sitz NICHT bereitmelden',
       raum({ q: {} }), 'rooms/V9RM/g/0/q/0/1', O_READY(0), UID[2]);
  deny('und ein Fremder ohne Sitz erst recht nicht',
       raum({ q: {} }), 'rooms/V9RM/g/0/q/0/1', O_READY(0), UID_ATTACK);
  deny('write-once: eine zweite Bereitschaft desselben Sitzes',
       raum({ q: bereitSatz('0', 3) }), 'rooms/V9RM/g/0/q/0/1', O_READY(0), UID[1]);
  deny('ohne Protokollabschluss der Vorrunde gibt es keine Bereitschaft fuer Runde 1',
       raum({ z: [], q: {} }), 'rooms/V9RM/g/0/q/1/1', O_READY(1), UID[1]);
  allow('mit Abschluss der Vorrunde schon',
        raum({ z: [0], q: {} }), 'rooms/V9RM/g/0/q/1/1', O_READY(1), UID[1]);
  deny('die Rundenzahl muss zum Pfad passen',
       raum({ q: {} }), 'rooms/V9RM/g/0/q/0/1', O_READY(1), UID[1]);
  deny('ein Sitz jenseits der Sollbesetzung meldet nichts',
       raum({ cap: 2, q: {} }), 'rooms/V9RM/g/0/q/0/2', O_READY(0), UID[2]);
  deny('ein selbstgesetzter Zeitstempel wird abgewiesen',
       raum({ q: {} }), 'rooms/V9RM/g/0/q/0/1', { k: 'ready', n: 0, ts: NOW - 1 }, UID[1]);
  deny('ein unbekanntes k wird abgewiesen',
       raum({ q: {} }), 'rooms/V9RM/g/0/q/0/1', { k: 'settled', n: 0, ts: SV }, UID[1]);
}

abschnitt('Zeitueberschreitung der Bereitschaft - 30 Sekunden');
{
  const beiAlter = (ms, uid) => tryWrite(raum({ sTs: NOW - ms, q: {} }),
                                         'rooms/V9RM/g/0/q/0/2', O_TIMEOUT(0), uid || UID[1]);
  t('[DENY]  vor der Frist ist die Zeitueberschreitung unzulaessig', beiAlter(29999) === false);
  t('[DENY]  genau AUF der Frist ebenso - erst danach', beiAlter(30000) === false);
  t('[ALLOW] eine Millisekunde danach traegt sie', beiAlter(30001) === true);
  t('[DENY]  ein Fremder ohne Sitz schliesst nichts', beiAlter(30001, UID_ATTACK) === false);
  t('[ALLOW] auch der Sitz selbst darf seinen Slot nach der Frist schliessen',
    tryWrite(raum({ sTs: NOW - 30001, q: {} }), 'rooms/V9RM/g/0/q/0/2', O_TIMEOUT(0), UID[2]) === true);
  t('[DENY]  auch der Sitz selbst nicht VOR der Frist',
    tryWrite(raum({ sTs: NOW - 29999, q: {} }), 'rooms/V9RM/g/0/q/0/2', O_TIMEOUT(0), UID[2]) === false);
  deny('eine Zeitueberschreitung ueberschreibt keine Bereitschaft',
       raum({ sTs: NOW - 30001, q: bereitSatz('0', 3) }), 'rooms/V9RM/g/0/q/0/2', O_TIMEOUT(0), UID[1]);
  {
    const r = raum({ sTs: NOW - 30001, q: { 0: { 2: { k: 'timeout', n: 0, ts: NOW - 500 } } } });
    deny('und eine Bereitschaft ueberschreibt keine Zeitueberschreitung',
         r, 'rooms/V9RM/g/0/q/0/2', O_READY(0), UID[2]);
  }
  deny('ein missgebildetes Terminal wird abgewiesen',
       raum({ sTs: NOW - 30001, q: {} }), 'rooms/V9RM/g/0/q/0/2', { k: 'timeout', ts: SV }, UID[1]);
  deny('ein bereits ausgetragener Sitz bekommt keine Zeitueberschreitung',
       raum({ sTs: NOW - 30001, q: {}, evicted: [2], offline: [2] }),
       'rooms/V9RM/g/0/q/0/2', O_TIMEOUT(0), UID[1]);
  deny('ein bereits disqualifizierter Sitz ebenso wenig',
       raum({ sTs: NOW - 30001, q: {}, x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 100 } } }),
       'rooms/V9RM/g/0/q/0/2', O_TIMEOUT(0), UID[1]);
  // Fuer Runde 1 haengt die Frist am Abschluss der Vorrunde, NICHT am Generationsstart.
  deny('Runde 1: am Abschluss der Vorrunde gemessen - vorher nein',
       raum({ zTs: NOW - 29999, q: {} }), 'rooms/V9RM/g/0/q/1/2', O_TIMEOUT(1), UID[1]);
  allow('Runde 1: danach ja',
        raum({ zTs: NOW - 30001, q: {} }), 'rooms/V9RM/g/0/q/1/2', O_TIMEOUT(1), UID[1]);
}

abschnitt('Dauerhafte Protokoll-Disqualifikation  g/<gen>/x/<seat>');
{
  const mitTimeout = (opt) => raum(Object.assign({ sTs: NOW - 30001,
    q: { 0: { 2: { k: 'timeout', n: 0, ts: NOW - 500 } } } }, opt || {}));
  deny('ohne vorausgegangene Zeitueberschreitung gibt es keine Disqualifikation',
       raum({ q: bereitSatz('0', 3) }), 'rooms/V9RM/g/0/x/2', O_X(0), UID[1]);
  allow('nach der Zeitueberschreitung darf sie geschrieben werden',
        mitTimeout(), 'rooms/V9RM/g/0/x/2', O_X(0), UID[1]);
  deny('mit falscher Rundenzahl nicht',
       mitTimeout(), 'rooms/V9RM/g/0/x/2', O_X(1), UID[1]);
  deny('und nicht fuer einen anderen Sitz',
       mitTimeout(), 'rooms/V9RM/g/0/x/1', O_X(0), UID[1]);
  deny('write-once: ein zweites Mal geht nicht',
       mitTimeout({ x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 100 } } }),
       'rooms/V9RM/g/0/x/2', O_X(0), UID[1]);
  deny('ein missgebildeter Datensatz wird abgewiesen',
       mitTimeout(), 'rooms/V9RM/g/0/x/2', { k: 'raus', n: 0, ts: SV }, UID[1]);
  deny('ein zusaetzliches Feld ebenso',
       mitTimeout(), 'rooms/V9RM/g/0/x/2', { k: 'ready_timeout', n: 0, ts: SV, w: 1 }, UID[1]);
  deny('ein selbstgesetzter Zeitstempel ebenso',
       mitTimeout(), 'rooms/V9RM/g/0/x/2', { k: 'ready_timeout', n: 0, ts: NOW - 1 }, UID[1]);
  deny('ein Fremder ohne Sitz schreibt sie nicht',
       mitTimeout(), 'rooms/V9RM/g/0/x/2', O_X(0), UID_ATTACK);
  // DIE TRENNSCHAERFE: eine BEREITSCHAFT ist keine Zeitueberschreitung.
  deny('aus einer gemeldeten Bereitschaft laesst sich keine Disqualifikation bauen',
       raum({ q: bereitSatz('0', 3) }), 'rooms/V9RM/g/0/x/2', O_X(0), UID[1]);
  // Und ein blosses Praesenzflackern ebenso wenig: ohne q-timeout kein x.
  deny('ein kurzzeitig abwesender Sitz allein ergibt keine Disqualifikation',
       raum({ offline: [2], q: bereitSatz('0', 3, [2]) }), 'rooms/V9RM/g/0/x/2', O_X(0), UID[1]);
}

abschnitt('Bereitschaftsbarriere vor d/<turn>');
{
  const D0 = { n: 0, o: SV };
  deny('ohne Generationsstart oeffnet Runde 0 nicht',
       raum({ s: false }), 'rooms/V9RM/g/0/d/0', D0, UID[1]);
  deny('mit unvollstaendiger Bereitschaft ebenso wenig',
       raum({ q: bereitSatz('0', 2) }), 'rooms/V9RM/g/0/d/0', D0, UID[1]);
  allow('sind alle Sitze bereit, oeffnet sie',
        raum({ q: bereitSatz('0', 3) }), 'rooms/V9RM/g/0/d/0', D0, UID[1]);
  allow('ein disqualifizierter Sitz ist befreit',
        raum({ q: bereitSatz('0', 3, [2]), x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 100 } } }),
        'rooms/V9RM/g/0/d/0', D0, UID[1]);
  allow('und ein ausgetragener Sitz ebenfalls',
        raum({ q: bereitSatz('0', 3, [2]), evicted: [2], offline: [2] }),
        'rooms/V9RM/g/0/d/0', D0, UID[1]);
  // Eine blosse Zeitueberschreitung befreit NICHT - erst die Disqualifikation.
  {
    const q = bereitSatz('0', 3, [2]); q['0'][2] = { k: 'timeout', n: 0, ts: NOW - 100 };
    deny('eine Zeitueberschreitung allein befreit den Sitz nicht',
         raum({ q: q }), 'rooms/V9RM/g/0/d/0', D0, UID[1]);
    const r2 = raum({ q: q, x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 50 } } });
    allow('erst zusammen mit der Disqualifikation',
          r2, 'rooms/V9RM/g/0/d/0', D0, UID[1]);
  }
  const D1 = { n: 1, o: SV };
  const fertig = { d: offen('0'), c: terminals('0', ['move', 'pass', 'pass']),
                   ro: revOffen('0'), r: ergSatz('0', { 0: REVEAL }) };
  deny('Runde 1: vollstaendige Bereitschaft ersetzt keinen unfertigen Vorgaenger',
       raum(Object.assign({}, fertig, { c: terminals('0', ['move', 'pass', 'pass']), r: {} })),
       'rooms/V9RM/g/0/d/1', D1, UID[1]);
  deny('Runde 1: ein fertiger Vorgaenger ohne Abschlussanker reicht nicht',
       raum(Object.assign({}, fertig, { z: [] })), 'rooms/V9RM/g/0/d/1', D1, UID[1]);
  deny('Runde 1: Abschlussanker ohne vollstaendige Bereitschaft reicht nicht',
       raum(Object.assign({}, fertig, { q: bereitSatz('1', 2) })), 'rooms/V9RM/g/0/d/1', D1, UID[1]);
  allow('Runde 1: Vorgaenger fertig, Anker da, alle bereit',
        raum(Object.assign({}, fertig, { q: bereitSatz('1', 3) })), 'rooms/V9RM/g/0/d/1', D1, UID[1]);
  // Die Disqualifikation wirkt DAUERHAFT: in spaeteren Runden verlangt sie keine
  // Bereitschaft mehr. Ein normal ausgeschiedener Sitz (Leben auf 0) hat kein x -
  // er bleibt Synchronisationsteilnehmer und meldet weiter.
  allow('ein frueher disqualifizierter Sitz braucht spaeter keine Bereitschaft',
        raum(Object.assign({}, fertig, { q: bereitSatz('1', 3, [2]),
          x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 100 } } })),
        'rooms/V9RM/g/0/d/1', D1, UID[1]);
  deny('ein aktiver Sitz ohne x dagegen sehr wohl',
       raum(Object.assign({}, fertig, { q: bereitSatz('1', 3, [2]) })),
       'rooms/V9RM/g/0/d/1', D1, UID[1]);
}

abschnitt('remove schliesst auch den dauerhaft disqualifizierten Sitz');
{
  const O_REM = { k: 'remove', ts: SV };
  deny('ohne Marker und ohne Disqualifikation kein remove',
       raum({ offline: [2], d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_REM, UID[1]);
  allow('mit Austragungsmarker wie bisher',
        raum({ offline: [2], evicted: [2], d: offen('0') }),
        'rooms/V9RM/g/0/c/0/2', O_REM, UID[1]);
  allow('und jetzt auch mit gueltiger Disqualifikation',
        raum({ d: offen('0'), x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 100 } } }),
        'rooms/V9RM/g/0/c/0/2', O_REM, UID[1]);
  deny('ein Fremder ohne Sitz schliesst ihn auch dann nicht',
       raum({ d: offen('0'), x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 100 } } }),
       'rooms/V9RM/g/0/c/0/2', O_REM, UID_ATTACK);
}
// ══ PRAESENZ-AUSTRAGUNG e UNTER v9 ═══════════════════════════════
abschnitt('Austragungsmarker e - derselbe Vertrag, jetzt auch fuer v9');
{
  // WAS HIER BEHOBEN IST: der e-Zweig galt nur fuer v4..v8. In einem v9-Raum
  // konnte der Marker gar nicht entstehen - damit waren die Befreiung eines
  // getrennten Sitzes von der Bereitschaftsbarriere UND der bestehende
  // e-gestuetzte remove-Pfad unerreichbar. Geaendert wurde AUSSCHLIESSLICH die
  // Fassungsliste; jede andere Bedingung steht unveraendert.
  allow('ein anwesender Mitspieler traegt einen lange abwesenden Sitz aus',
        raum({ offline: [2] }), 'rooms/V9RM/g/0/e/2', true, UID[1]);
  deny('vor Ablauf der Abwesenheitsfrist nicht',
       raum({ flackern: [2] }), 'rooms/V9RM/g/0/e/2', true, UID[1]);
  deny('und gegen einen anwesenden Sitz erst recht nicht',
       raum(), 'rooms/V9RM/g/0/e/2', true, UID[1]);
  deny('ein anderer Wert als true ist kein Marker',
       raum({ offline: [2] }), 'rooms/V9RM/g/0/e/2', false, UID[1]);
  deny('und ein Datensatz ebenso wenig',
       raum({ offline: [2] }), 'rooms/V9RM/g/0/e/2', { k: 'evicted', ts: SV }, UID[1]);
  deny('write-once: ein gesetzter Marker wird nicht neu geschrieben',
       raum({ offline: [2], evicted: [2] }), 'rooms/V9RM/g/0/e/2', true, UID[1]);
  deny('eine fremde Generation wird abgewiesen',
       raum({ offline: [2] }), 'rooms/V9RM/g/1/e/2', true, UID[1]);
  deny('ein Fremder ohne Sitz traegt niemanden aus',
       raum({ offline: [2] }), 'rooms/V9RM/g/0/e/2', true, UID_ATTACK);
  deny('ein selbst bereits ausgetragener Sitz traegt niemanden mehr aus',
       raum({ offline: [1, 2], evicted: [1] }), 'rooms/V9RM/g/0/e/2', true, UID[1]);
  // Unveraendert gilt auch fuer v8 - dieselbe Regel, dieselbe Antwort.
  allow('v8: derselbe Vorgang bleibt erlaubt',
        raum({ v: 8, offline: [2] }), 'rooms/V9RM/g/0/e/2', true, UID[1]);
  deny('v8: und vor der Frist bleibt er verboten',
       raum({ v: 8, flackern: [2] }), 'rooms/V9RM/g/0/e/2', true, UID[1]);

  // ── DIE TRENNSCHAERFE ZWISCHEN e UND x ───────────────────────
  deny('eine Austragung erzeugt KEINE Protokoll-Disqualifikation',
       raum({ offline: [2], evicted: [2], q: bereitSatz('0', 3, [2]) }),
       'rooms/V9RM/g/0/x/2', O_X(0), UID[1]);
  deny('und eine Disqualifikation erzeugt keine Austragung',
       raum({ x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 100 } } }),
       'rooms/V9RM/g/0/e/2', true, UID[1]);

  // ── BEREITSCHAFTSBARRIERE: WAS BEFREIT WIRKLICH ────────────────
  const D0 = { n: 0, o: SV };
  deny('A: ein aktiver Sitz ohne Bereitschaft, ohne e und ohne x haelt die Runde auf',
       raum({ q: bereitSatz('0', 3, [2]) }), 'rooms/V9RM/g/0/d/0', D0, UID[1]);
  allow('B: eine gueltige Bereitschaft erfuellt ihn',
        raum({ q: bereitSatz('0', 3) }), 'rooms/V9RM/g/0/d/0', D0, UID[1]);
  allow('C: ein autoritativ ausgetragener Sitz braucht keine Bereitschaft',
        raum({ offline: [2], evicted: [2], q: bereitSatz('0', 3, [2]) }),
        'rooms/V9RM/g/0/d/0', D0, UID[1]);
  allow('D: ein disqualifizierter Sitz ebenso wenig',
        raum({ q: bereitSatz('0', 3, [2]), x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 100 } } }),
        'rooms/V9RM/g/0/d/0', D0, UID[1]);
  deny('E: blosse Abwesenheit OHNE den autoritativen Marker befreit nicht',
       raum({ offline: [2], q: bereitSatz('0', 3, [2]) }), 'rooms/V9RM/g/0/d/0', D0, UID[1]);
  {
    const q = bereitSatz('0', 3, [2]); q['0'][2] = { k: 'timeout', n: 0, ts: NOW - 100 };
    deny('F: eine Zeitueberschreitung ohne x befreit nicht',
         raum({ q: q }), 'rooms/V9RM/g/0/d/0', D0, UID[1]);
  }

  // ── remove: BEIDE Berechtigungen, und nur diese ────────────────
  const O_REM2 = { k: 'remove', ts: SV };
  allow('remove gegen einen ausgetragenen Sitz',
        raum({ offline: [2], evicted: [2], d: offen('0') }),
        'rooms/V9RM/g/0/c/0/2', O_REM2, UID[1]);
  allow('remove gegen einen disqualifizierten Sitz',
        raum({ d: offen('0'), x: { 2: { k: 'ready_timeout', n: 0, ts: NOW - 100 } } }),
        'rooms/V9RM/g/0/c/0/2', O_REM2, UID[1]);
  deny('und gegen keinen von beiden gar nicht',
       raum({ offline: [2], d: offen('0') }), 'rooms/V9RM/g/0/c/0/2', O_REM2, UID[1]);
}
// ══ V9.5C: DIE AUFNAHME DES RAUMS SELBST ═════════════════════════════════════
// Bis hierher haben alle Tests ihren v9-Raum VORGESETZT - so, wie der Emulator ihn
// unter Umgehung der Regeln vorbefuellt. Genau das verdeckte den Befund aus der
// Browser-QA: die Fassung 9 stand in keiner Liste, die einen Raum zulaesst. Die
// v9-Zweige darunter waren vollstaendig und unerreichbar.
//
// Dieser Abschnitt legt den Raum deshalb ueber die Regeln AN und prueft danach, dass
// genau die eingefrorene v9-Flaeche entsteht: Football, Lebensregel, drei bis fuenf
// Sitze. Nichts darueber hinaus.
abschnitt('V9.5C: ein v9-Raum entsteht - und zwar nur die eingefrorene Flaeche');
{
  const LEER = { rooms: {} };
  const WIRT = UID[0];
  // Genau die Form, die createRoom() schreibt: Reservierung auf Sitz 0 (on:false),
  // Rosteranker daneben, Generation 0, Zustand lobby.
  const neuerRaum = (over) => {
    const r = { v: 9, hostUid: WIRT,
                config: { game: 'football', winTarget: 3, fmt: 'elimination',
                          visibility: 'private', mode: 'lives', cap: 3 },
                gen: 0, state: 'lobby',
                p: { 0: { s: 'V9NRTAB00', on: false, t: NOW } },
                players: { 0: { id: 'V9NRPID00', name: 'P0', tab: 'V9NRTAB00', uid: WIRT } },
                created: NOW };
    if (over) { for (const k in over) {
      if (k === 'config') r.config = Object.assign({}, r.config, over.config);
      else r[k] = over[k]; } }
    return r;
  };
  const anlegen = (name, over, erlaubt) =>
    (erlaubt ? allow : deny)(name, LEER, 'rooms/V9NR', neuerRaum(over), WIRT);

  // (1-3) Die drei kanonischen Besetzungen der Lebensregel.
  for (const cap of [3, 4, 5])
    anlegen('ein v9-Football-Lives-Raum mit ' + cap + ' Sitzen', { config: { cap: cap } }, true);

  // (4-7) Die Fassung selbst.
  anlegen('die Fassung 9 ist zugelassen', null, true);
  anlegen('die Fassung 10 nicht', { v: 10 }, false);
  anlegen('und eine erfundene Fassung erst recht nicht', { v: 42 }, false);
  {
    const db = { rooms: { V9NR: neuerRaum() } };
    deny('eine bestehende Fassung laesst sich nicht auf 8 zuruecksetzen',
         db, 'rooms/V9NR/v', 8, WIRT);
    deny('und auch nicht auf 10 heben', db, 'rooms/V9NR/v', 10, WIRT);
  }

  // (8-14) Der Modus. v9 traegt GENAU EINEN - fuer die uebrigen gibt es kein Produkt.
  anlegen('v9 traegt die Lebensregel', { config: { mode: 'lives' } }, true);
  for (const m of ['classic', 'speed', 'team2v2', 'timedffa'])
    anlegen('und NICHT ' + m + ' - dafuer gibt es kein v9-Produkt',
            { config: { mode: m, cap: m === 'team2v2' ? 4 : (m === 'classic' || m === 'speed' ? 2 : 3) } }, false);
  anlegen('ein unbekannter Modus wird abgewiesen', { config: { mode: 'irgendwas' } }, false);
  {
    const r = neuerRaum(); delete r.config.mode;
    deny('ohne Modus entsteht kein v9-Football-Raum', LEER, 'rooms/V9NR', r, WIRT);
  }

  // (15-20) Die Sollbesetzung.
  for (const cap of [3, 4, 5])
    anlegen('Sollbesetzung ' + cap + ' ist kanonisch', { config: { cap: cap } }, true);
  for (const cap of [2, 6, 0, -1])
    anlegen('Sollbesetzung ' + cap + ' nicht', { config: { cap: cap } }, false);
  anlegen('eine gebrochene Sollbesetzung nicht', { config: { cap: 3.5 } }, false);
  anlegen('und eine als Text geschriebene auch nicht', { config: { cap: '4' } }, false);
  {
    const r = neuerRaum(); delete r.config.cap;
    deny('ohne Sollbesetzung entsteht kein v9-Football-Raum', LEER, 'rooms/V9NR', r, WIRT);
  }

  // (21-24) Der Zusammenhang von Modus, Besetzung und Spiel.
  anlegen('v9 ist ausschliesslich Football',
          { config: { game: 'ringout', fmt: 'single' } }, false);
  anlegen('und ausschliesslich die Eliminationsform',
          { config: { fmt: 'ffa' } }, false);
  {
    const r = neuerRaum(); delete r.config.visibility;
    deny('eine unvollstaendige Konfiguration wird abgewiesen', LEER, 'rooms/V9NR', r, WIRT);
  }
  {
    const db = { rooms: { V9NR: neuerRaum() } };
    deny('der Modus eines bestehenden Raums ist unveraenderlich',
         db, 'rooms/V9NR/config/mode', 'timedffa', WIRT);
    deny('und seine Sollbesetzung ebenfalls', db, 'rooms/V9NR/config/cap', 5, WIRT);
  }

  // (25-29) Was v8 immer konnte, kann v8 weiterhin.
  {
    const v8 = neuerRaum({ v: 8 });
    allow('ein v8-Football-Lives-Raum entsteht unveraendert', LEER, 'rooms/V9NR', v8, WIRT);
    const v8t = neuerRaum({ v: 8, config: { mode: 'timedffa' } });
    allow('und v8 kennt weiterhin seine uebrigen Modi', LEER, 'rooms/V9NR', v8t, WIRT);
    const v8c = neuerRaum({ v: 8, config: { mode: 'classic', cap: 2 } });
    allow('einschliesslich der Zweierbesetzung von classic', LEER, 'rooms/V9NR', v8c, WIRT);
  }
  // Die oeffentliche Liste bleibt v9 verschlossen - sie kennt nur v4 bis v8.
  {
    const R = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');
    const pub = JSON.parse(R).rules.publicRooms.$code['.write'];
    t('die oeffentliche Raumliste nimmt keinen v9-Raum auf',
      pub.indexOf("child('v').val() === 9") < 0);
  }

  // (30-37) ERREICHBARKEIT: aus einem regelkonform ENTSTANDENEN Raum heraus.
  // Das ist der Kern des Befundes - die Zweige darunter waren nie das Problem.
  {
    const cap = 3;
    const p = {}, players = {};
    for (let i = 0; i < cap; i++) {
      p[i] = { s: 'V9NRTAB0' + i, on: true, t: NOW };
      players[i] = { id: 'V9NRPID0' + i, name: 'P' + i, tab: 'V9NRTAB0' + i, uid: UID[i] };
    }
    const gestartet = { rooms: { V9NR: Object.assign(neuerRaum(), {
      state: 'playing', seats: cap, p: p, players: players, g: { 0: {} } }) } };
    allow('aus diesem Raum heraus laesst sich der Generationsstart schreiben',
          gestartet, 'rooms/V9NR/g/0/s', { ts: SV }, UID[0]);
    const mitS = JSON.parse(JSON.stringify(gestartet));
    mitS.rooms.V9NR.g[0].s = { ts: NOW - 60000 };
    allow('die eigene Bereitschaft ebenfalls',
          mitS, 'rooms/V9NR/g/0/q/0/1', { k: 'ready', n: 0, ts: SV }, UID[1]);
    const bereit = JSON.parse(JSON.stringify(mitS));
    bereit.rooms.V9NR.g[0].q = { 0: {} };
    for (let i = 0; i < cap; i++) bereit.rooms.V9NR.g[0].q[0][i] = { k: 'ready', n: 0, ts: NOW - 1000 };
    allow('und danach eroeffnet die Runde',
          bereit, 'rooms/V9NR/g/0/d/0', { n: 0, o: SV }, UID[1]);
    const offenR = JSON.parse(JSON.stringify(bereit));
    offenR.rooms.V9NR.g[0].d = { 0: { n: 0, o: NOW - 100 } };
    allow('das eigene Commit-Terminal steht offen',
          offenR, 'rooms/V9NR/g/0/c/0/1', { k: 'move', h: HEX64, ts: SV }, UID[1]);
    // Die Austragung setzt eine wirklich abgelaufene Praesenz voraus. Der Sitz wird
    // deshalb erst offline gesetzt - sonst waere die Abweisung richtig und der Test
    // pruefte etwas anderes, als er behauptet.
    const weg = JSON.parse(JSON.stringify(offenR));
    weg.rooms.V9NR.p[2] = { s: 'V9NRTAB02', on: false, t: NOW - GRACE - 1 };
    allow('und die Austragung ueber e bleibt erreichbar',
          weg, 'rooms/V9NR/g/0/e/2', true, UID[1]);
  }

  // (38-40) Sicherheit: die Aufnahme oeffnet nichts anderes.
  {
    const db = { rooms: { V9NR: neuerRaum() } };
    deny('ein Fremder kann den Raum nicht ueberschreiben',
         db, 'rooms/V9NR', neuerRaum(), UID_ATTACK);
    deny('und keinen zweiten Raum an dieselbe Stelle legen',
         db, 'rooms/V9NR', neuerRaum({ config: { cap: 5 } }), WIRT);
    const fremd = neuerRaum({ hostUid: UID_ATTACK });
    deny('der Wirtsnachweis muss die eigene Kennung sein', LEER, 'rooms/V9NR', fremd, WIRT);
    // Und die Fassung bleibt das Tor: derselbe Schreibvorgang, derselbe Sitz, nur ein
    // v8-Raum darunter - abgewiesen. Ein unzulaessiger v9-Raum entsteht gar nicht erst,
    // und was nicht entsteht, traegt auch keine Protokollknoten.
    const alsV8 = { rooms: { V9NR: Object.assign(neuerRaum({ v: 8 }), {
      state: 'playing', seats: 3, g: { 0: {} } }) } };
    deny('ein v8-Raum erreicht den Generationsstart nicht',
         alsV8, 'rooms/V9NR/g/0/s', { ts: SV }, WIRT);
  }
}

// ══ V9.5C: DIE HOHEIT UEBER DEN RAUM GEHOERT DEM WIRT ════════════════════════
// hostUid und Sitz 0 sind ZWEI DINGE. Ein Wirt darf auf jedem Sitz sitzen - v8 laesst
// ihn schon heute auf Sitz 2 anfangen (Team 2v2, rote Seite), und ein Sitzwechsel im
// Wartezimmer aendert daran nichts.
//
// Die Hoheitsregel von state und seats hiess frueher "v8 fragt den Wirt, alles andere
// den Sitz 0" - fuer v4 bis v7 richtig, denn dort GAB es kein hostUid. Mit der Aufnahme
// von v9 fiel dieser Raum in den alten Zweig: der eingetragene Wirt kam nicht an seinen
// eigenen Raum, und ein beliebiger Sitz-0-Inhaber konnte ihn starten. Genau das prueft
// dieser Abschnitt - in beide Richtungen.
abschnitt('V9.5C: die Hoheit ueber den Raum haengt am Wirt, nicht am Sitz 0');
{
  const WIRT = 'UID_V9_WIRT_XXXXXXXXXXXXXX';
  const A = UID[0], B = UID[1];       // A sitzt auf 0, B auf 1, der Wirt auf 2
  // Genau der Fall aus dem Auftrag: hostUid ist WIRT, players/0 gehoert A,
  // players/2 gehoert WIRT.
  const wirtsRaum = (v, over) => {
    const r = { v: v, hostUid: WIRT,
      config: { game: 'football', winTarget: 3, fmt: 'elimination',
                visibility: 'private', mode: 'lives', cap: 3 },
      gen: 0, state: 'lobby',
      p: { 0: { s: 'WIRTTAB00', on: true, t: NOW },
           1: { s: 'WIRTTAB01', on: true, t: NOW },
           2: { s: 'WIRTTAB02', on: true, t: NOW } },
      players: { 0: { id: 'WIRTPID00', name: 'A', tab: 'WIRTTAB00', uid: A },
                 1: { id: 'WIRTPID01', name: 'B', tab: 'WIRTTAB01', uid: B },
                 2: { id: 'WIRTPID02', name: 'W', tab: 'WIRTTAB02', uid: WIRT } },
      created: NOW - 60000 };
    if (over) for (const k in over) r[k] = over[k];
    return { rooms: { WRTM: r } };
  };

  // (1) Der Wirt sitzt NICHT auf Sitz 0 - und startet trotzdem seinen Raum.
  const lobby9 = wirtsRaum(9);
  allow('der Wirt auf Sitz 2 startet seinen v9-Raum',
        lobby9, 'rooms/WRTM/state', 'playing', WIRT);
  // (2) Und niemand sonst.
  deny('der Inhaber von Sitz 0 kann es nicht - Sitz 0 ist kein Wirt',
       lobby9, 'rooms/WRTM/state', 'playing', A);
  deny('ein unbeteiligter Mitspieler erst recht nicht',
       lobby9, 'rooms/WRTM/state', 'playing', B);
  deny('und ein Fremder ohne Sitz auch nicht',
       lobby9, 'rooms/WRTM/state', 'playing', UID_ATTACK);

  const spielt9 = wirtsRaum(9, { state: 'playing' });
  allow('das kanonische Startsignal seats setzt ebenfalls der Wirt',
        spielt9, 'rooms/WRTM/seats', 3, WIRT);
  deny('nicht der Inhaber von Sitz 0', spielt9, 'rooms/WRTM/seats', 3, A);
  deny('und nicht ein anderer Sitz', spielt9, 'rooms/WRTM/seats', 3, B);

  // (3) Von dort aus laeuft das Protokoll - ohne dass Sitz 0 je Wirt spielen muesste.
  {
    const gestartet = wirtsRaum(9, { state: 'playing', seats: 3, g: { 0: {} } });
    allow('aus diesem Raum heraus steht der Generationsstart offen',
          gestartet, 'rooms/WRTM/g/0/s', { ts: SV }, WIRT);
    const mitS = JSON.parse(JSON.stringify(gestartet));
    mitS.rooms.WRTM.g[0].s = { ts: NOW - 60000 };
    for (const [i, wer] of [[0, A], [1, B], [2, WIRT]])
      allow('Sitz ' + i + ' meldet seine Bereitschaft selbst',
            mitS, 'rooms/WRTM/g/0/q/0/' + i, { k: 'ready', n: 0, ts: SV }, wer);
    const bereit = JSON.parse(JSON.stringify(mitS));
    bereit.rooms.WRTM.g[0].q = { 0: {} };
    for (let i = 0; i < 3; i++) bereit.rooms.WRTM.g[0].q[0][i] = { k: 'ready', n: 0, ts: NOW - 1000 };
    allow('und die Entscheidungsrunde eroeffnet - von einem beliebigen Sitz',
          bereit, 'rooms/WRTM/g/0/d/0', { n: 0, o: SV }, A);
    deny('der v8-Zugslot bleibt diesem Raum verschlossen',
         bereit, 'rooms/WRTM/g/0/t/0/1', { k: 'move', idx: 1, dx: 1, dy: 2, sp: 0 }, B);
  }

  // (4) v8 verhaelt sich genau gleich - das war schon vorher richtig und bleibt es.
  {
    const lobby8 = wirtsRaum(8);
    allow('v8: der Wirt auf Sitz 2 startet seinen Raum',
          lobby8, 'rooms/WRTM/state', 'playing', WIRT);
    deny('v8: der Inhaber von Sitz 0 nicht', lobby8, 'rooms/WRTM/state', 'playing', A);
    const spielt8 = wirtsRaum(8, { state: 'playing' });
    allow('v8: und seats setzt ebenfalls der Wirt', spielt8, 'rooms/WRTM/seats', 3, WIRT);
    deny('v8: nicht Sitz 0', spielt8, 'rooms/WRTM/seats', 3, A);
  }

  // (5) v4 bis v7 kannten kein hostUid. Dort bleibt Sitz 0 die Hoheit - sonst waere ein
  //     alter, noch laufender Raum ploetzlich unstartbar.
  {
    const alt = (v) => ({ rooms: { WRTM: {
      v: v, config: { game: 'ringout', winTarget: 3, fmt: 'ffa', visibility: 'private' },
      gen: 0, state: 'lobby',
      p: { 0: { s: 'WIRTTAB00', on: true, t: NOW }, 1: { s: 'WIRTTAB01', on: true, t: NOW } },
      players: { 0: { id: 'WIRTPID00', name: 'A', tab: 'WIRTTAB00', uid: A },
                 1: { id: 'WIRTPID01', name: 'B', tab: 'WIRTTAB01', uid: B } },
      created: NOW - 60000 } } });
    for (const v of [4, 5, 6, 7]) {
      allow('v' + v + ': Sitz 0 bleibt die Hoheit', alt(v), 'rooms/WRTM/state', 'playing', A);
      deny('v' + v + ': ein anderer Sitz nicht', alt(v), 'rooms/WRTM/state', 'playing', B);
    }
  }

  // (6) Ein v9-Raum ohne Wirt entstuende sonst - und niemand koennte ihn je starten.
  {
    const ohne = { v: 9,
      config: { game: 'football', winTarget: 3, fmt: 'elimination',
                visibility: 'private', mode: 'lives', cap: 3 },
      gen: 0, state: 'lobby',
      p: { 0: { s: 'WIRTTAB00', on: false, t: NOW } },
      players: { 0: { id: 'WIRTPID00', name: 'A', tab: 'WIRTTAB00', uid: A } },
      created: NOW };
    deny('ein v9-Raum ohne Wirt entsteht gar nicht erst',
         { rooms: {} }, 'rooms/WRTM', ohne, A);
  }

  // (7) Das Rematch haengt an keiner Wirtsrolle - es genuegt ein verbundener Sitz.
  //     Das ist die BESTEHENDE Bedeutung, versionsunabhaengig, und bleibt unangetastet.
  {
    const fertig = wirtsRaum(9, { state: 'playing', seats: 3 });
    allow('ein Rematch darf der Wirt beginnen', fertig, 'rooms/WRTM/gen', 1, WIRT);
    allow('und ebenso jeder andere verbundene Sitz', fertig, 'rooms/WRTM/gen', 1, B);
    deny('ein Fremder ohne Sitz nicht', fertig, 'rooms/WRTM/gen', 1, UID_ATTACK);
  }
}

console.log('\nOnline-V9: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
