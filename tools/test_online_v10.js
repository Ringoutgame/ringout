// PROTOKOLL v10 - DYNAMISCHE BESETZUNG (Arena Football FFA), NUR RULES.
//
// Der Vertrag: config.cap ist die HOECHSTBESETZUNG des Raums (immer 5), seats die beim
// Start EINGEFRORENE Besetzung (2-5). Der Host startet mit zwei bis fuenf lueckenlosen,
// verbundenen Sitzen; oberhalb der Startbesetzung darf kein Sitz belegt sein. Alle
// Sitzmengen des v9-Protokolls (Bereitschaft, Rundenbeginn, Commit, Enthuellung,
// Disqualifikation) zaehlen in einem v10-Raum bis `seats`, nicht bis `config/cap`.
// v9-Raeume behalten ihren Vertrag woertlich (seats === cap, Sitzmengen bis cap).
//   node test_online_v10.js
const { tryWrite, NOW, GRACE } = require('./test_rules.js');

let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name); } };
const allow = (name, db, path, v, uid, also) => t('[ALLOW] ' + name, tryWrite(db, path, v, uid, also) === true);
const deny = (name, db, path, v, uid, also) => t('[DENY]  ' + name, tryWrite(db, path, v, uid, also) === false);
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 66 - s.length)));

const UID = [0, 1, 2, 3, 4, 5].map(i => 'UID_V10_SEAT' + i + '_XXXXXXXXX');
const TAB = (i) => 'VTENTAB' + i;   // 8 Zeichen - die Rules verlangen [A-Za-z0-9_-]{8,24}
const HEX64 = 'a1b2c3d4e5f6'.repeat(5) + 'abcd';
const SV = NOW;
const CFG = (over) => Object.assign({ game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'private', mode: 'lives', cap: 5 }, over || {});

// Ein v10-Raum mit `n` verbundenen Sitzen. state/seats/g nach Wahl.
function raum(opt) {
  opt = opt || {};
  const n = opt.n === undefined ? 5 : opt.n;
  const p = {}, players = {};
  for (let i = 0; i < n; i++) {
    const weg = (opt.offline || []).indexOf(i) >= 0;
    p[i] = { s: TAB(i), on: !weg, t: weg ? NOW - GRACE - 1 : NOW };
    players[i] = { id: 'VTENPID' + i, name: 'P' + i, tab: TAB(i), uid: UID[i] };
  }
  const g = { 0: {} };
  if (opt.s !== false) g[0].s = { ts: NOW - 60000 };
  if (opt.q) g[0].q = opt.q;
  if (opt.d) g[0].d = opt.d;
  if (opt.c) g[0].c = opt.c;
  if (opt.ro) g[0].ro = opt.ro;
  if (opt.r) g[0].r = opt.r;
  if (opt.z) g[0].z = opt.z;
  if (opt.e) g[0].e = opt.e;
  const r = { v: opt.v === undefined ? 10 : opt.v, hostUid: UID[0], config: CFG(opt.cfg), gen: 0,
              state: opt.state === undefined ? 'playing' : opt.state, p, players, created: NOW - 5000, g };
  if (opt.seats !== undefined) r.seats = opt.seats; else if (r.state === 'playing') r.seats = n;
  if (opt.seats === null) delete r.seats;
  return { rooms: { VDYN: r }, publicRooms: opt.pub || {} };
}
const P = (r) => 'rooms/VDYN/' + r;
const bereit = (turn, n) => { const q = {}; q[turn] = {}; for (let i = 0; i < n; i++) q[turn][i] = { k: 'ready', n: Number(turn), ts: NOW - 1000 }; return q; };
const offen = (turn) => { const d = {}; d[turn] = { n: Number(turn), o: NOW - 1000 }; return d; };
const O_MOVE = { k: 'move', h: HEX64, ts: SV };
const O_READY = (n) => ({ k: 'ready', n, ts: SV });
const O_D = (n) => ({ n, o: SV });

console.log('=== PROTOKOLL v10: dynamische Besetzung - Raum, Beitritt, Start, Sitzmengen ===');

// ══ RAUMANLAGE ═══════════════════════════════════════════════════════════════
abschnitt('Raumanlage  rooms/<code>  (v10 = Lives, Hoechstbesetzung 5)');
{
  const frisch = (over) => Object.assign({ v: 10, hostUid: UID[0], config: CFG(), gen: 0, state: 'lobby',
    p: { 0: { s: TAB(0), on: false, t: NOW } }, players: { 0: { id: 'VTENPID0', name: 'P0', tab: TAB(0), uid: UID[0] } }, created: NOW }, over || {});
  allow('ein v10-Lives-Raum mit Hoechstbesetzung 5', { rooms: {} }, 'rooms/VDYN', frisch(), UID[0]);
  allow('... auch oeffentlich', { rooms: {} }, 'rooms/VDYN', frisch({ config: CFG({ visibility: 'public' }) }), UID[0]);
  for (const cap of [2, 3, 4, 6])
    deny('ein v10-Raum mit Hoechstbesetzung ' + cap + ' - v10 kennt nur 5', { rooms: {} }, 'rooms/VDYN', frisch({ config: CFG({ cap }) }), UID[0]);
  for (const mode of ['classic', 'speed', 'team2v2', 'timedffa'])
    deny('ein v10-Raum im Modus ' + mode, { rooms: {} }, 'rooms/VDYN', frisch({ config: CFG({ mode, cap: mode === 'team2v2' ? 4 : mode === 'timedffa' ? 5 : 2 }) }), UID[0]);
  deny('ein v10-RingOut-Raum', { rooms: {} }, 'rooms/VDYN', frisch({ config: { game: 'ringout', winTarget: 3, fmt: 'ffa', visibility: 'private' } }), UID[0]);
  deny('v10 ohne Hostkennung', { rooms: {} }, 'rooms/VDYN', (() => { const r = frisch(); delete r.hostUid; return r; })(), UID[0]);
  deny('v10 mit fremder Hostkennung', { rooms: {} }, 'rooms/VDYN', frisch({ hostUid: UID[1] }), UID[0]);
  deny('v11 - jenseits jeder bekannten Fassung', { rooms: {} }, 'rooms/VDYN', frisch({ v: 11 }), UID[0]);
  deny('die Fassung eines v10-Raums laesst sich nicht auf 9 senken', raum({ state: 'lobby', n: 1 }), P('v'), 9, UID[0]);
  deny('... und nicht auf 11 heben', raum({ state: 'lobby', n: 1 }), P('v'), 11, UID[0]);
  allow('das wertgleiche Vergleichsschreiben bleibt erlaubt', raum({ state: 'lobby', n: 1 }), P('v'), 10, UID[0]);
  deny('config.cap ist nach der Anlage unveraenderlich', raum({ state: 'lobby', n: 1 }), P('config/cap'), 3, UID[0]);
}

// ══ BEITRITT ═════════════════════════════════════════════════════════════════
abschnitt('Beitritt  rooms/<code>/p,players  (Sitze 1..4, kein sechster)');
{
  // Ein Gast reserviert seinen Sitz: players/<i> und p/<i> (on:false) im selben Update.
  const reserve = (i) => ({ ['rooms/VDYN/players/' + i]: { id: 'VTENPID' + i, name: 'P' + i, tab: TAB(i), uid: UID[i] } });
  for (let i = 1; i <= 4; i++)
    allow('Spieler ' + (i + 1) + ' reserviert Sitz ' + i, raum({ state: 'lobby', n: i }), 'rooms/VDYN/p/' + i, { s: TAB(i), on: false, t: NOW }, UID[i], reserve(i));
  deny('ein sechster Spieler bekommt keinen Sitz 5', raum({ state: 'lobby', n: 5 }), 'rooms/VDYN/p/5', { s: TAB(5), on: false, t: NOW }, UID[5], reserve(5));
  deny('... und keinen Rosterdatensatz 5', raum({ state: 'lobby', n: 5 }), 'rooms/VDYN/players/5', { id: 'VTENPID5', name: 'P5', tab: TAB(5), uid: UID[5] }, UID[5]);
  deny('nach dem Start reserviert niemand mehr einen Sitz (Besetzung eingefroren)', raum({ n: 3 }), 'rooms/VDYN/p/3', { s: TAB(3), on: false, t: NOW }, UID[3], reserve(3));
  deny('... auch nicht den freien vierten Sitz eines Fuenferraums', raum({ n: 2 }), 'rooms/VDYN/p/2', { s: TAB(2), on: false, t: NOW }, UID[2], reserve(2));
}

// ══ START ════════════════════════════════════════════════════════════════════
abschnitt('Start  state+seats  (2..5 erlaubt, 0/1 nicht, alle gezaehlten Sitze verbunden)');
{
  const start = (n, seats, over) => { const db = raum(Object.assign({ state: 'lobby', n, seats: null }, over || {}));
    return { db, also: { 'rooms/VDYN/state': 'playing', 'rooms/VDYN/seats': seats } }; };
  for (const n of [2, 3, 4, 5]) {
    const s = start(n, n);
    t('[ALLOW] der Host startet mit ' + n + ' von 5', tryWrite(s.db, 'rooms/VDYN/seats', n, UID[0], { 'rooms/VDYN/state': 'playing' }) === true);
    t('[DENY]  ein Gast startet nicht (' + n + ')', tryWrite(s.db, 'rooms/VDYN/seats', n, UID[1], { 'rooms/VDYN/state': 'playing' }) === false);
  }
  t('[DENY]  allein startet niemand (seats 1)', tryWrite(start(1, 1).db, 'rooms/VDYN/seats', 1, UID[0], { 'rooms/VDYN/state': 'playing' }) === false);
  t('[DENY]  seats 0', tryWrite(start(2, 0).db, 'rooms/VDYN/seats', 0, UID[0], { 'rooms/VDYN/state': 'playing' }) === false);
  t('[DENY]  seats 6 - mehr als der Raum fasst', tryWrite(start(5, 6).db, 'rooms/VDYN/seats', 6, UID[0], { 'rooms/VDYN/state': 'playing' }) === false);
  t('[DENY]  ein Startsignal, das einen beigetretenen Spieler auslaesst (4 da, seats 3)', tryWrite(start(4, 3).db, 'rooms/VDYN/seats', 3, UID[0], { 'rooms/VDYN/state': 'playing' }) === false);
  t('[DENY]  ein Startsignal ueber die Besetzung hinaus (3 da, seats 4)', tryWrite(start(3, 4).db, 'rooms/VDYN/seats', 4, UID[0], { 'rooms/VDYN/state': 'playing' }) === false);
  for (const n of [2, 3, 5]) for (let s = 0; s < n; s++)
    t('[DENY]  Start mit ' + n + ', Sitz ' + s + ' getrennt', tryWrite(start(n, n, { offline: [s] }).db, 'rooms/VDYN/seats', n, UID[0], { 'rooms/VDYN/state': 'playing' }) === false);
  t('[DENY]  seats ohne state', tryWrite(start(3, 3).db, 'rooms/VDYN/seats', 3, UID[0]) === false);
  deny('die eingefrorene Besetzung ist unveraenderlich', raum({ n: 3 }), P('seats'), 4, UID[0]);
  deny('... auch nach unten', raum({ n: 3 }), P('seats'), 2, UID[0]);
  // v9 bleibt exakt: seats muss cap sein.
  const v9 = (n, seats, cap) => { const db = raum({ v: 9, state: 'lobby', n, seats: null, cfg: { cap } });
    return tryWrite(db, 'rooms/VDYN/seats', seats, UID[0], { 'rooms/VDYN/state': 'playing' }); };
  t('[ALLOW] v9: Start 5 in einem 5er-Raum', v9(5, 5, 5) === true);
  t('[DENY]  v9: Start 3 in einem 5er-Raum bleibt abgelehnt', v9(3, 3, 5) === false);
  t('[DENY]  v9: Start 2 in einem 3er-Raum ebenso', v9(2, 2, 3) === false);
}

// ══ SITZMENGEN DES PROTOKOLLS ════════════════════════════════════════════════
abschnitt('Protokoll-Sitzmengen zaehlen bis seats, nicht bis cap  (g/<gen>/q,d,c,r,x)');
{
  // Ein Dreierstart in einem Fuenferraum: Bereitschaft von 0..2 genuegt fuer d/0.
  const drei = (over) => raum(Object.assign({ n: 3 }, over || {}));
  allow('Sitz 2 meldet sich bereit (seats 3)', drei(), P('g/0/q/0/2'), O_READY(0), UID[2]);
  deny('Sitz 3 gibt es in diesem Match nicht - keine Bereitschaft', raum({ n: 4, seats: 3 }), P('g/0/q/0/3'), O_READY(0), UID[3]);
  allow('d/0 oeffnet mit drei Bereitmeldungen (seats 3, cap 5)', drei({ q: bereit('0', 3) }), P('g/0/d/0'), O_D(0), UID[0]);
  deny('d/0 nicht mit nur zwei von drei', drei({ q: bereit('0', 2) }), P('g/0/d/0'), O_D(0), UID[0]);
  allow('d/0 im Zweierstart mit zwei Bereitmeldungen', raum({ n: 2, q: bereit('0', 2) }), P('g/0/d/0'), O_D(0), UID[0]);
  allow('d/0 im Fuenferstart mit fuenf Bereitmeldungen', raum({ n: 5, q: bereit('0', 5) }), P('g/0/d/0'), O_D(0), UID[0]);
  deny('d/0 im Fuenferstart nicht mit vier', raum({ n: 5, q: bereit('0', 4) }), P('g/0/d/0'), O_D(0), UID[0]);
  deny('d/0 ohne eingefrorene Besetzung (seats fehlt)', raum({ n: 3, seats: null, q: bereit('0', 3) }), P('g/0/d/0'), O_D(0), UID[0]);
  // v9-Gegenprobe: dort verlangt d/0 weiterhin seats === cap.
  deny('v9: d/0 in einem 5er-Raum mit seats 3 bleibt zu', raum({ v: 9, n: 3, seats: 3, q: bereit('0', 3) }), P('g/0/d/0'), O_D(0), UID[0]);
  allow('v9: d/0 in einem 3er-Raum mit seats 3', raum({ v: 9, n: 3, seats: 3, cfg: { cap: 3 }, q: bereit('0', 3) }), P('g/0/d/0'), O_D(0), UID[0]);
  // Commit: nur Sitze < seats.
  allow('Sitz 2 legt seinen Zug ab (seats 3)', drei({ d: offen('0') }), P('g/0/c/0/2'), O_MOVE, UID[2]);
  deny('Sitz 3 kann in einem Dreierstart keinen Zug ablegen', raum({ n: 4, seats: 3, d: offen('0') }), P('g/0/c/0/3'), O_MOVE, UID[3]);
  deny('ein Sitz ausserhalb der Besetzung bekommt auch kein late', raum({ n: 3, seats: 3, d: (() => { const d = {}; d[0] = { n: 0, o: NOW - 7000 }; return d; })() }), P('g/0/c/0/3'), { k: 'late', ts: SV }, UID[0]);
  // Disqualifikation ebenso.
  deny('x fuer einen Sitz ausserhalb der Besetzung', raum({ n: 3, seats: 3 }), P('g/0/x/3'), { k: 'ready_timeout', n: 0, ts: SV }, UID[0]);
  // Der Zugslot t bleibt v8 vorbehalten.
  deny('der v8-Zugslot ist in einem v10-Raum verschlossen', drei({ d: offen('0') }), P('g/0/t/0/0'), { k: 'move', idx: 0, dx: 1, dy: 1, sp: 0 }, UID[0]);
}

// ══ LIEGEN GEBLIEBENE RESERVIERUNG UND REMATCH ═══════════════════════════════
abschnitt('Start trotz verwaister Reservierung; Rematch (gen) in v10');
{
  // Ein Gast hat den Tab geschlossen: p/2 (on:false) und players/2 bleiben stehen.
  const verwaist = (v) => { const db = raum({ v, state: 'lobby', n: 3, seats: null, cfg: v === 9 ? { cap: 5 } : {} });
    db.rooms.VDYN.p[2].on = false; return db; };
  t('[ALLOW] v10: der Host startet zu zweit, obwohl Sitz 2 verwaist reserviert ist',
    tryWrite(verwaist(10), 'rooms/VDYN/seats', 2, UID[0], { 'rooms/VDYN/state': 'playing' }) === true);
  t('[DENY]  v9: dieselbe Lage bleibt ein Warten (seats !== cap)',
    tryWrite(verwaist(9), 'rooms/VDYN/seats', 2, UID[0], { 'rooms/VDYN/state': 'playing' }) === false);
  t('[DENY]  v10: ein VERBUNDENER dritter Sitz darf nicht ausgelassen werden',
    tryWrite(raum({ state: 'lobby', n: 3, seats: null }), 'rooms/VDYN/seats', 2, UID[0], { 'rooms/VDYN/state': 'playing' }) === false);
  t('[DENY]  v10: der verwaiste Sitz kann nicht mitgezaehlt werden',
    tryWrite(verwaist(10), 'rooms/VDYN/seats', 3, UID[0], { 'rooms/VDYN/state': 'playing' }) === false);
  // Rematch: die Generation zaehlt weiter - wie in v9.
  allow('v10: der Host zaehlt die Generation fuer ein Rematch weiter', raum({ n: 3 }), P('gen'), 1, UID[0]);
  // Wie in v8/v9 darf jeder gesetzte Spieler das Rematch anstossen - nicht nur der Host.
  allow('v10: ein Mitspieler ebenso (wie in v8/v9)', raum({ n: 3 }), P('gen'), 1, UID[1]);
  deny('v10: ein Fremder nicht', raum({ n: 3 }), P('gen'), 1, UID[5]);
  deny('v10: nicht nach einer Austragung', raum({ n: 3, e: { 2: true } }), P('gen'), 1, UID[0]);
}

// ══ OEFFENTLICHE AUFFINDBARKEIT ══════════════════════════════════════════════
abschnitt('publicRooms  (v10 darf gelistet werden, v9 weiterhin nicht)');
{
  const lobby = (v) => raum({ v, state: 'lobby', n: 1, seats: null, cfg: { visibility: 'public' } });
  allow('ein oeffentlicher v10-Raum wird gelistet', lobby(10), 'publicRooms/VDYN', { created: SV }, UID[0]);
  deny('ein v9-Raum weiterhin nicht', lobby(9), 'publicRooms/VDYN', { created: SV }, UID[0]);
  deny('ein privater v10-Raum nicht', raum({ state: 'lobby', n: 1, seats: null }), 'publicRooms/VDYN', { created: SV }, UID[0]);
  deny('ein laufender v10-Raum nicht', raum({ n: 3, cfg: { visibility: 'public' } }), 'publicRooms/VDYN', { created: SV }, UID[0]);
  allow('der Eintrag eines gestarteten v10-Raums darf geraeumt werden', raum({ n: 3, cfg: { visibility: 'public' }, pub: { VDYN: { created: NOW - 1000 } } }), 'publicRooms/VDYN', null, UID[3]);
  deny('der Eintrag einer offenen v10-Lobby bleibt stehen', raum({ state: 'lobby', n: 1, seats: null, cfg: { visibility: 'public' }, pub: { VDYN: { created: NOW - 1000 } } }), 'publicRooms/VDYN', null, UID[3]);
}


// ══ PASS 04: DIE ENTSCHEIDUNGSFRIST GEHOERT DEM RAUM ═════════════════════════
// v10 gibt dem Entscheidungsfenster ACHT Sekunden, v9 behaelt seine SECHS. Die Frist
// steht in den Rules, nicht im Client - ein neuer Client kann einem laufenden v9-Raum
// seine Zeitregel also nicht aufdraengen, und ein alter Client kann in einem v10-Raum
// nicht frueher schliessen, als der Server es zulaesst.
abschnitt('PASS 04  Entscheidungsfrist  v10 = 8 s, v9 = 6 s');
{
  // Eine Runde, die vor `ms` Millisekunden autoritativ eroeffnet wurde.
  const alt = (ms) => { const d = {}; d[0] = { n: 0, o: NOW - ms }; return d; };
  const v10 = (ms) => raum({ n: 3, seats: 3, d: alt(ms) });
  const v9  = (ms) => raum({ v: 9, n: 3, seats: 3, cfg: { cap: 3 }, d: alt(ms) });

  // ── der eigene Zug ──
  allow('v10: der eigene Zug nach 5,0 s', v10(5000), P('g/0/c/0/1'), O_MOVE, UID[1]);
  allow('v10: ... auch nach 7,0 s - das Fenster ist acht Sekunden lang', v10(7000), P('g/0/c/0/1'), O_MOVE, UID[1]);
  allow('v10: ... und in der letzten Zehntelsekunde', v10(7900), P('g/0/c/0/1'), O_MOVE, UID[1]);
  deny('v10: aber nicht nach 8,1 s', v10(8100), P('g/0/c/0/1'), O_MOVE, UID[1]);
  allow('v9: der eigene Zug nach 5,0 s', v9(5000), P('g/0/c/0/1'), O_MOVE, UID[1]);
  deny('v9: aber nicht nach 7,0 s - dort bleibt es bei sechs Sekunden', v9(7000), P('g/0/c/0/1'), O_MOVE, UID[1]);
  deny('v9: und erst recht nicht nach 8,1 s', v9(8100), P('g/0/c/0/1'), O_MOVE, UID[1]);

  // ── der Fristschluss durch einen Mitspieler ──
  // Er ist das Gegenstueck und darf GENAU DANN, wenn der eigene Zug nicht mehr darf.
  deny('v10: kein Fristschluss nach 7,0 s - da darf der Sitz noch ziehen', v10(7000), P('g/0/c/0/2'), { k: 'late', ts: SV }, UID[1]);
  allow('v10: Fristschluss nach 8,1 s', v10(8100), P('g/0/c/0/2'), { k: 'late', ts: SV }, UID[1]);
  allow('v9: Fristschluss schon nach 7,0 s', v9(7000), P('g/0/c/0/2'), { k: 'late', ts: SV }, UID[1]);

  // ── kein Zeitfenster ohne autoritative Eroeffnung ──
  deny('v10: ohne eroeffnete Runde gilt keine Frist und kein Zug', raum({ n: 3, seats: 3 }), P('g/0/c/0/1'), O_MOVE, UID[1]);

  // ── die Enthuellungsfrist bleibt woertlich ──
  // Sie ist keine Spielerentscheidung: dort wird nichts ueberlegt, sondern ein bereits
  // festgelegter Zug offengelegt. PASS 04 fasst sie deshalb ausdruecklich nicht an.
  const HEXN = '0'.repeat(32);
  const enthuellung = (v, ms) => raum({ v: v, n: 2, seats: 2, cfg: v === 9 ? { cap: 2 } : undefined,
    d: alt(20000), c: { 0: { 0: O_MOVE, 1: O_MOVE } }, ro: { 0: NOW - ms } });
  // idx MUSS der eigene Sitz sein, sp liegt zwischen -1 und 1 - die Enthuellung wird
  // hier nicht erfunden, sondern so gebaut, wie die Rules sie ohnehin verlangen.
  const REVEAL = { k: 'reveal', idx: 1, dx: 10, dy: 10, sp: 0.5, n: HEXN, ts: SV };
  allow('v10: eine Enthuellung nach 5,0 s', enthuellung(10, 5000), P('g/0/r/0/1'), REVEAL, UID[1]);
  deny('v10: keine Enthuellung nach 7,0 s - die Enthuellungsfrist bleibt bei sechs Sekunden', enthuellung(10, 7000), P('g/0/r/0/1'), REVEAL, UID[1]);
  deny('v9: ebenso wenig nach 7,0 s', enthuellung(9, 7000), P('g/0/r/0/1'), REVEAL, UID[1]);
}


// ══ PASS 04: DER FRUEHE ABSCHLUSS IST AUTORITATIV, NICHT LOKAL ══════════════
// Sind alle bereit, soll die Runde sofort weitergehen - aber NIEMAND darf sie im
// Alleingang weiterschieben. Die Befugnis dafuer ist der Reveal-Anker ro/<turn>: er
// verlangt fuer JEDEN Sitz der Startbesetzung ein Terminal in c/<turn> und kennt
// bewusst KEINE Fristbedingung. Genau das ist die gemeinsame, deterministische
// Weiche - erst danach wird ueberhaupt enthuellt, also kann nichts durchsickern.
abschnitt('PASS 04  frueher Abschluss  nur bei vollstaendiger Barriere');
{
  const jetzt = (ms) => { const d = {}; d[0] = { n: 0, o: NOW - ms }; return d; };
  // Drei Sitze, die Runde laeuft seit einer Sekunde - also LANGE vor jeder Frist.
  const mitCommits = (n, wie) => { const c = {}; c[0] = {}; for (let i = 0; i < n; i++) if (wie[i]) c[0][i] = wie[i]; return c; };
  const M = { k: "move", h: HEX64, ts: NOW - 500 };
  const NULLZUG = { k: "pass", ts: NOW - 500 };

  // Vollstaendig: der Anker darf - eine Sekunde nach Rundenbeginn, sieben Sekunden
  // vor Fristende. Das IST die zugesagte sofortige Aufloesung.
  allow("vollstaendige Barriere: der Reveal-Anker darf sofort - ohne auf die Frist zu warten",
    raum({ n: 3, seats: 3, d: jetzt(1000), c: mitCommits(3, [M, M, M]) }),
    P("g/0/ro/0"), SV, UID[1]);
  // Auch mit verdeckten Nullzuegen - eine Nullhandlung ist ein Terminal wie jedes andere.
  allow("... auch wenn Nullzuege dabei sind",
    raum({ n: 3, seats: 3, d: jetzt(1000), c: mitCommits(3, [M, NULLZUG, M]) }),
    P("g/0/ro/0"), SV, UID[2]);

  // Unvollstaendig: NIEMAND kann die Runde vorziehen - auch der Wirt nicht.
  for (const wer of [0, 1, 2])
    deny("ein fehlendes Terminal: Sitz " + wer + " kann den Anker nicht erzwingen",
      raum({ n: 3, seats: 3, d: jetzt(1000), c: mitCommits(3, [M, M, null]) }),
      P("g/0/ro/0"), SV, UID[wer]);
  deny("zwei fehlende Terminals ebenso wenig",
    raum({ n: 3, seats: 3, d: jetzt(1000), c: mitCommits(3, [M, null, null]) }),
    P("g/0/ro/0"), SV, UID[0]);
  // Und auch nicht, wenn die Frist laengst vorbei ist: offen ist offen.
  deny("auch nach Fristende bleibt eine offene Barriere offen",
    raum({ n: 3, seats: 3, d: jetzt(20000), c: mitCommits(3, [M, M, null]) }),
    P("g/0/ro/0"), SV, UID[0]);

  // Die Barriere zaehlt bis seats, nicht bis cap: ein Fuenferraum mit Dreierstart ist
  // mit drei Terminals vollstaendig - sonst waere der frueheste Abschluss unerreichbar.
  allow("die Barriere zaehlt bis seats, nicht bis config.cap",
    raum({ n: 3, seats: 3, d: jetzt(1000), c: mitCommits(3, [M, M, M]) }),
    P("g/0/ro/0"), SV, UID[0]);
  deny("in einem Fuenferstart reichen drei Terminals nicht",
    raum({ n: 5, seats: 5, d: jetzt(1000), c: mitCommits(5, [M, M, M, null, null]) }),
    P("g/0/ro/0"), SV, UID[0]);
  allow("... fuenf dagegen schon",
    raum({ n: 5, seats: 5, d: jetzt(1000), c: mitCommits(5, [M, M, M, M, M]) }),
    P("g/0/ro/0"), SV, UID[0]);

  // Ein Aussenstehender kann den Anker nicht setzen - der Schreiber muss ein
  // verbundener, nicht ausgeschiedener Sitz des Raums sein.
  deny("ein Fremder kann den Anker nicht setzen",
    raum({ n: 3, seats: 3, d: jetzt(1000), c: mitCommits(3, [M, M, M]) }),
    P("g/0/ro/0"), SV, UID[5]);

  // VOR dem Anker gibt es keine Enthuellung - deshalb kann der frueheste Abschluss
  // keinen fremden Zug verraten.
  const REV = { k: "reveal", idx: 1, dx: 10, dy: 10, sp: 0.5, n: "0".repeat(32), ts: SV };
  deny("ohne Anker ist keine Enthuellung moeglich",
    raum({ n: 3, seats: 3, d: jetzt(1000), c: mitCommits(3, [M, M, M]) }),
    P("g/0/r/0/1"), REV, UID[1]);
  allow("mit Anker schon",
    raum({ n: 3, seats: 3, d: jetzt(1000), c: mitCommits(3, [M, M, M]), ro: { 0: NOW - 200 } }),
    P("g/0/r/0/1"), REV, UID[1]);
}

console.log('\nOnline-V10: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
