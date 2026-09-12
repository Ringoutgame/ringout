// PROTOKOLL v11 - DER BLEIBENDE RAUM (Arena Football FFA), NUR RULES.
//
// Der Unterschied zu v10 in einem Satz: nicht der RAUM haelt die Startbesetzung fest,
// sondern jede GENERATION haelt ihre eigene, unveraenderliche Teilnehmerliste.
//
// Daraus folgt alles Weitere:
//   * `state` darf zurueck von 'playing' nach 'lobby' - der Raum ueberlebt sein Match.
//   * Spieler duerfen zwischen zwei Matches gehen und kommen; die Sitze duerfen Luecken
//     haben (0, 2, 4 ist eine gueltige Besetzung).
//   * Die Protokollbarrieren warten auf GENAU die Sitze aus g/<gen>/pt - nicht auf die
//     Raumkapazitaet, nicht auf die vorige Besetzung, nicht auf das v10-Feld `seats`.
//   * Die Bereitschaft steht unter g/<gen+1>/rd und gehoert damit dem KOMMENDEN Match;
//     eine alte Bereitschaft kann niemanden im naechsten Kreislauf bereit machen.
//   * Der Matchstart ist EIN atomarer Schritt: gen, state und pt zusammen.
//
// v8, v9 und v10 sind Vertraege der Vergangenheit. Ihre Suiten laufen unveraendert
// weiter; diese hier prueft ausschliesslich, was v11 hinzufuegt - und was es verbietet.
//
//   node test_online_v11.js
const { tryWrite, NOW, GRACE } = require('./test_rules.js');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => { if (ok) pass++; else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); } };
const allow = (name, db, path, v, uid, also) => t('[ALLOW] ' + name, tryWrite(db, path, v, uid, also) === true);
const deny = (name, db, path, v, uid, also) => t('[DENY]  ' + name, tryWrite(db, path, v, uid, also) === false);
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 66 - s.length)));

const UID = [0, 1, 2, 3, 4, 5].map(i => 'UID_V11_SEAT' + i + '_XXXXXXXXX');
const TAB = (i) => 'VEFBTAB' + i;
const HEX64 = 'a1b2c3d4e5f6'.repeat(5) + 'abcd';
const SV = NOW;
const CFG = (over) => Object.assign({ game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'private', mode: 'lives', cap: 5 }, over || {});

// Ein v11-Raum. `sitze` ist die Menge der BELEGTEN Raumsitze (darf Luecken haben),
// `gen` die laufende Generation, `pt` die Teilnehmerliste der laufenden Generation,
// `rd` die Bereitschaft fuer die KOMMENDE.
function raum(opt) {
  opt = opt || {};
  const sitze = opt.sitze === undefined ? [0, 1] : opt.sitze;
  const p = {}, players = {};
  for (const i of sitze) {
    const weg = (opt.offline || []).indexOf(i) >= 0;
    p[i] = { s: TAB(i), on: !weg, t: weg ? NOW - GRACE - 1 : NOW };
    players[i] = { id: 'VEFBPID' + i, name: 'P' + i, tab: TAB(i), uid: UID[i] };
  }
  const gen = opt.gen === undefined ? 0 : opt.gen;
  const g = {};
  for (let k = 0; k <= gen + 1; k++) g[k] = {};
  if (opt.pt) g[gen].pt = opt.pt;
  if (opt.rd) g[gen + 1].rd = opt.rd;
  if (opt.rdGen !== undefined) { g[opt.rdGen] = g[opt.rdGen] || {}; g[opt.rdGen].rd = opt.rdWert || { 0: true }; }
  if (opt.s !== false) g[gen].s = { ts: NOW - 60000 };
  if (opt.q) g[gen].q = opt.q;
  if (opt.d) g[gen].d = opt.d;
  if (opt.c) g[gen].c = opt.c;
  if (opt.ro) g[gen].ro = opt.ro;
  if (opt.rr) g[gen].r = opt.rr;
  if (opt.e) g[gen].e = opt.e;
  const r = { v: opt.v === undefined ? 11 : opt.v, hostUid: UID[opt.host === undefined ? 0 : opt.host],
              config: CFG(opt.cfg), gen: gen,
              state: opt.state === undefined ? 'lobby' : opt.state, p, players, created: NOW - 5000, g };
  if (opt.seats !== undefined) r.seats = opt.seats;
  return { rooms: { VEFB: r }, publicRooms: opt.pub || {} };
}
const P = (rest) => 'rooms/VEFB/' + rest;
const ptVon = (sitze) => { const o = {}; for (const s of sitze) o[s] = true; return o; };
const rdVon = (sitze) => { const o = {}; for (const s of sitze) o[s] = true; return o; };

// Der Matchstart ist EIN atomarer Schritt ueber drei Pfade. Erlaubt ist er nur, wenn
// ALLE DREI Pfade ihn erlauben - genau das prueft dieser Helfer.
function startOk(db, neuGen, pt, uid) {
  const auch = { ['rooms/VEFB/gen']: neuGen, ['rooms/VEFB/state']: 'playing', ['rooms/VEFB/g/' + neuGen + '/pt']: pt };
  const drei = [
    tryWrite(db, 'rooms/VEFB/gen', neuGen, uid, auch),
    tryWrite(db, 'rooms/VEFB/state', 'playing', uid, auch),
    tryWrite(db, 'rooms/VEFB/g/' + neuGen + '/pt', pt, uid, auch)
  ];
  return { alle: drei.every(Boolean), drei: drei };
}
const startAllow = (name, db, neuGen, pt, uid) => { const r = startOk(db, neuGen, pt, uid); t('[ALLOW] ' + name, r.alle, 'gen/state/pt = ' + r.drei.join('/')); };
const startDeny = (name, db, neuGen, pt, uid) => { const r = startOk(db, neuGen, pt, uid); t('[DENY]  ' + name, !r.alle, 'gen/state/pt = ' + r.drei.join('/')); };

console.log('=== PROTOKOLL v11: der bleibende Raum ===');

// ══ RAUMANLAGE ═══════════════════════════════════════════════════════════════
abschnitt('Raumanlage  (v11 = Lives, Hoechstbesetzung 5, startet als Lobby)');
{
  const frisch = (over) => Object.assign({ v: 11, hostUid: UID[0], config: CFG(), gen: 0, state: 'lobby',
    p: { 0: { s: TAB(0), on: false, t: NOW } }, players: { 0: { id: 'VEFBPID0', name: 'P0', tab: TAB(0), uid: UID[0] } }, created: NOW }, over || {});
  allow('ein v11-Raum mit Hoechstbesetzung 5', { rooms: {} }, 'rooms/VEFB', frisch(), UID[0]);
  allow('... auch oeffentlich', { rooms: {} }, 'rooms/VEFB', frisch({ config: CFG({ visibility: 'public' }) }), UID[0]);
  for (const cap of [2, 3, 4, 6])
    deny('ein v11-Raum mit Hoechstbesetzung ' + cap, { rooms: {} }, 'rooms/VEFB', frisch({ config: CFG({ cap }) }), UID[0]);
  for (const mode of ['classic', 'speed', 'team2v2', 'timedffa'])
    deny('ein v11-Raum im Modus ' + mode, { rooms: {} }, 'rooms/VEFB', frisch({ config: CFG({ mode, cap: mode === 'team2v2' ? 4 : mode === 'timedffa' ? 5 : 2 }) }), UID[0]);
  deny('ein v11-RingOut-Raum', { rooms: {} }, 'rooms/VEFB', frisch({ config: { game: 'ringout', winTarget: 3, fmt: 'ffa', visibility: 'private' } }), UID[0]);
  deny('v11 ohne Hostkennung', { rooms: {} }, 'rooms/VEFB', (() => { const r = frisch(); delete r.hostUid; return r; })(), UID[0]);
  deny('v11 mit fremder Hostkennung', { rooms: {} }, 'rooms/VEFB', frisch({ hostUid: UID[1] }), UID[0]);
  // Die Startbesetzung gehoert nicht mehr dem Raum: `seats` hat in v11 nichts zu suchen.
  deny('ein v11-Raum darf nicht mit dem v10-Feld seats angelegt werden', { rooms: {} }, 'rooms/VEFB', frisch({ seats: 2, state: 'playing' }), UID[0]);
  deny('v12 bleibt jenseits jeder bekannten Fassung', { rooms: {} }, 'rooms/VEFB', frisch({ v: 12 }), UID[0]);
}

// ══ BEREITSCHAFT ═════════════════════════════════════════════════════════════
abschnitt('Bereitschaft  g/<gen+1>/rd/<seat>  (nur der eigene Sitz, nur in der Lobby)');
{
  const db = raum({ sitze: [0, 1, 2] });
  allow('ein Spieler meldet sich fuer das kommende Match bereit', db, P('g/1/rd/0'), true, UID[0]);
  allow('... und ein anderer ebenso', db, P('g/1/rd/2'), true, UID[2]);
  deny('niemand meldet einen FREMDEN Sitz bereit', db, P('g/1/rd/1'), true, UID[0]);
  deny('... auch nicht der Wirt', db, P('g/1/rd/2'), true, UID[0]);
  deny('ein Unbeteiligter meldet gar nichts', db, P('g/1/rd/0'), true, UID[5]);
  deny('ohne Anmeldung geht es nicht', db, P('g/1/rd/0'), true, null);
  deny('ein leerer Sitz kann sich nicht bereit melden', db, P('g/1/rd/3'), true, UID[3]);
  deny('ein getrennter Sitz ebenso wenig', raum({ sitze: [0, 1], offline: [1] }), P('g/1/rd/1'), true, UID[1]);
  deny('Bereitschaft fuer die LAUFENDE Generation ist sinnlos', db, P('g/0/rd/0'), true, UID[0]);
  deny('Bereitschaft fuer eine uebernaechste Generation ebenso', db, P('g/2/rd/0'), true, UID[0]);
  deny('waehrend eines laufenden Matches meldet sich niemand bereit',
    raum({ sitze: [0, 1], state: 'playing', pt: ptVon([0, 1]) }), P('g/1/rd/0'), true, UID[0]);
  deny('ein anderer Wert als true ist keine Bereitschaft', db, P('g/1/rd/0'), false, UID[0]);
  deny('und eine Zahl erst recht nicht', db, P('g/1/rd/0'), 1, UID[0]);
  // Nach einem Match: die Bereitschaft der NEUEN Lobby steht unter der naechsten Generation.
  const nachMatch = raum({ sitze: [0, 1], gen: 3, state: 'lobby' });
  allow('nach dem dritten Match zaehlt die Bereitschaft fuer das vierte', nachMatch, P('g/4/rd/1'), true, UID[1]);
  deny('eine Bereitschaft aus dem vorigen Kreislauf ist wertlos', nachMatch, P('g/3/rd/1'), true, UID[1]);
}

// ══ DER MATCHSTART ═══════════════════════════════════════════════════════════
abschnitt('Matchstart  (gen + state + Teilnehmerliste in EINEM Schritt)');
{
  const bereit2 = raum({ sitze: [0, 1], rd: rdVon([0, 1]) });
  startAllow('zwei verbundene, beide bereit', bereit2, 1, ptVon([0, 1]), UID[0]);
  startAllow('... und jeder von ihnen darf den Start ausloesen', bereit2, 1, ptVon([0, 1]), UID[1]);
  const bereit5 = raum({ sitze: [0, 1, 2, 3, 4], rd: rdVon([0, 1, 2, 3, 4]) });
  startAllow('fuenf verbundene, alle bereit', bereit5, 1, ptVon([0, 1, 2, 3, 4]), UID[2]);
  // Die entscheidende Neuerung: LUECKEN sind erlaubt.
  const luecke = raum({ sitze: [0, 2, 4], rd: rdVon([0, 2, 4]) });
  startAllow('drei Spieler auf den Sitzen 0, 2 und 4', luecke, 1, ptVon([0, 2, 4]), UID[4]);
  // Und die Gegenproben.
  startDeny('einer allein startet kein Match', raum({ sitze: [0], rd: rdVon([0]) }), 1, ptVon([0]), UID[0]);
  startDeny('nicht, solange einer noch nicht bereit ist', raum({ sitze: [0, 1, 2], rd: rdVon([0, 1]) }), 1, ptVon([0, 1, 2]), UID[0]);
  startDeny('niemand laesst einen anwesenden Spieler einfach weg', raum({ sitze: [0, 1, 2], rd: rdVon([0, 1, 2]) }), 1, ptVon([0, 1]), UID[0]);
  startDeny('niemand nimmt einen abwesenden Spieler mit', raum({ sitze: [0, 1], rd: rdVon([0, 1]) }), 1, ptVon([0, 1, 2]), UID[0]);
  startDeny('niemand nimmt einen getrennten Spieler mit',
    raum({ sitze: [0, 1, 2], offline: [2], rd: rdVon([0, 1]) }), 1, ptVon([0, 1, 2]), UID[0]);
  startDeny('ein getrennter Spieler blockiert die Liste nicht, fehlt aber auch nicht unbemerkt',
    raum({ sitze: [0, 1, 2], offline: [2], rd: rdVon([0, 1, 2]) }), 1, ptVon([0, 1, 2]), UID[0]);
  startDeny('die Generation darf nicht springen', bereit2, 2, ptVon([0, 1]), UID[0]);
  startDeny('und nicht stehenbleiben', bereit2, 0, ptVon([0, 1]), UID[0]);
  startDeny('ein Unbeteiligter startet nichts', bereit2, 1, ptVon([0, 1]), UID[5]);
  startDeny('aus einem laufenden Match heraus startet niemand ein zweites',
    raum({ sitze: [0, 1], state: 'playing', pt: ptVon([0, 1]), rd: rdVon([0, 1]) }), 1, ptVon([0, 1]), UID[0]);
  // Die Liste ist unveraenderlich, sobald sie steht.
  const laeuft = raum({ sitze: [0, 1, 2], state: 'playing', gen: 1, pt: ptVon([0, 1]) });
  deny('die Teilnehmerliste eines laufenden Matches ist unveraenderlich', laeuft, P('g/1/pt'), ptVon([0, 1, 2]), UID[0]);
  deny('... auch nicht einzeln erweiterbar', laeuft, P('g/1/pt/2'), true, UID[2]);
  deny('... und nicht loeschbar', laeuft, P('g/1/pt/1'), null, UID[0]);
}

// ══ DOPPELSTART ══════════════════════════════════════════════════════════════
abschnitt('Doppelstart  (genau ein Uebergang, auch wenn alle gleichzeitig sehen)');
{
  // Der zweite Start scheitert an der Vorbedingung: nach dem ersten steht gen bereits
  // auf 1 und state auf 'playing'. Beides prueft die Regel ausdruecklich.
  const nachStart = raum({ sitze: [0, 1], gen: 1, state: 'playing', pt: ptVon([0, 1]), rd: rdVon([0, 1]) });
  startDeny('ein zweiter Start auf dieselbe Generation', nachStart, 1, ptVon([0, 1]), UID[1]);
  startDeny('ein Start auf die naechste Generation waehrend des Matches', nachStart, 2, ptVon([0, 1]), UID[1]);
  // Und ohne die drei Pfade zusammen geht gar nichts.
  const bereit = raum({ sitze: [0, 1], rd: rdVon([0, 1]) });
  deny('die Generation allein weiterzuschalten reicht nicht', bereit, P('gen'), 1, UID[0]);
  deny('der Zustand allein ebenso wenig', bereit, P('state'), 'playing', UID[0]);
  deny('und die Teilnehmerliste allein auch nicht', bereit, P('g/1/pt'), ptVon([0, 1]), UID[0]);
}

// ══ DER ZUSTANDSKREISLAUF ════════════════════════════════════════════════════
abschnitt('Zustandskreislauf  (playing -> lobby und wieder zurueck)');
{
  const laeuft = raum({ sitze: [0, 1, 2], state: 'playing', gen: 1, pt: ptVon([0, 1, 2]) });
  allow('nach dem Match wird der Raum wieder Lobby', laeuft, P('state'), 'lobby', UID[1]);
  deny('ein Unbeteiligter beendet kein Match', laeuft, P('state'), 'lobby', UID[5]);
  deny('ohne Anmeldung ebenso wenig', laeuft, P('state'), 'lobby', null);
  // Und der Kreislauf laeuft weiter: aus der zurueckgewonnenen Lobby startet das naechste.
  const zurueck = raum({ sitze: [0, 1, 2], state: 'lobby', gen: 1, pt: ptVon([0, 1, 2]), rd: rdVon([0, 1, 2]) });
  startAllow('aus der zurueckgewonnenen Lobby startet das naechste Match', zurueck, 2, ptVon([0, 1, 2]), UID[0]);
  // v10 bleibt die Einbahnstrasse, die es war.
  const zehn = { rooms: { VEFB: { v: 10, hostUid: UID[0], config: CFG(), gen: 0, state: 'playing', seats: 2,
    p: { 0: { s: TAB(0), on: true, t: NOW }, 1: { s: TAB(1), on: true, t: NOW } },
    players: { 0: { id: 'VEFBPID0', name: 'P0', tab: TAB(0), uid: UID[0] }, 1: { id: 'VEFBPID1', name: 'P1', tab: TAB(1), uid: UID[1] } },
    created: NOW - 5000, g: { 0: {} } } }, publicRooms: {} };
  deny('ein v10-Raum kommt weiterhin NICHT in die Lobby zurueck', zehn, P('state'), 'lobby', UID[0]);
}

// ══ BEITRETEN UND GEHEN ══════════════════════════════════════════════════════
abschnitt('Beitreten und Gehen  (die Lobby lebt zwischen den Matches)');
{
  const nachMatch = raum({ sitze: [0, 2, 4], gen: 1, state: 'lobby', pt: ptVon([0, 1, 2, 3, 4]) });
  const neuP = { s: TAB(1), on: false, t: NOW };
  const neuR = { id: 'VEFBPID1', name: 'P1', tab: TAB(1), uid: UID[1] };
  allow('ein neuer Spieler nimmt den freien Sitz 1', nachMatch, P('p/1'), neuP, UID[1], { [P('players/1')]: neuR });
  allow('... und traegt sich in den Roster ein', nachMatch, P('players/1'), neuR, UID[1], { [P('p/1')]: neuP });
  // In der Lobby darf jeder gehen.
  allow('in der Lobby darf ein Spieler gehen', nachMatch, P('p/2'), null, UID[2], { [P('players/2')]: null });
  allow('... und sein Rostereintrag verschwindet mit', nachMatch, P('players/2'), null, UID[2], { [P('p/2')]: null });
  // Waehrend des Matches nicht - sonst wartete die Runde auf einen leeren Sitz.
  const laeuft = raum({ sitze: [0, 1, 2], state: 'playing', gen: 1, pt: ptVon([0, 1, 2]) });
  deny('mitten im Match verschwindet kein Teilnehmer', laeuft, P('p/1'), null, UID[1], { [P('players/1')]: null });
  const raus = raum({ sitze: [0, 1, 2], state: 'playing', gen: 1, pt: ptVon([0, 1, 2]), e: { 1: true } });
  allow('ein ausgeschiedener Teilnehmer darf gehen', raus, P('p/1'), null, UID[1], { [P('players/1')]: null });
  // Und niemand betritt ein laufendes Match.
  deny('in ein laufendes Match tritt niemand ein', laeuft, P('p/3'), { s: TAB(3), on: false, t: NOW }, UID[3],
    { [P('players/3')]: { id: 'VEFBPID3', name: 'P3', tab: TAB(3), uid: UID[3] } });
  // Der sechste Platz existiert nicht.
  const voll = raum({ sitze: [0, 1, 2, 3, 4], gen: 1, state: 'lobby' });
  deny('einen sechsten Platz gibt es nicht', voll, P('p/5'), { s: TAB(5), on: false, t: NOW }, UID[5],
    { [P('players/5')]: { id: 'VEFBPID5', name: 'P5', tab: TAB(5), uid: UID[5] } });
}

// ══ DIE BARRIEREN ZAEHLEN UEBER DIE TEILNEHMERLISTE ══════════════════════════
abschnitt('Barrieren  (q, d, c, ro, r, z zaehlen ueber pt - auch bei Luecken)');
{
  // Drei Spieler auf 0, 2 und 4. Sitz 1 und 3 sind leer und duerfen NICHT mitzaehlen.
  const sitze = [0, 2, 4];
  const basis = (over) => raum(Object.assign({ sitze, state: 'playing', gen: 1, pt: ptVon(sitze) }, over || {}));
  const O_READY = (n) => ({ k: 'ready', n, ts: SV });
  const O_MOVE = { k: 'move', h: HEX64, ts: SV };
  const bereitQ = (turn, wer) => { const q = {}; q[turn] = {}; for (const s of wer) q[turn][s] = { k: 'ready', n: Number(turn), ts: NOW - 1000 }; return q; };
  const offen = (turn) => { const d = {}; d[turn] = { n: Number(turn), o: NOW - 1000 }; return d; };

  allow('Sitz 4 meldet seine Rundenbereitschaft', basis(), P('g/1/q/0/4'), O_READY(0), UID[4]);
  deny('der leere Sitz 3 meldet nichts', basis(), P('g/1/q/0/3'), O_READY(0), UID[3]);
  // Die Runde wird eroeffnet, wenn ALLE DREI Teilnehmer bereit sind - nicht fuenf.
  allow('die Runde beginnt, sobald die drei Teilnehmer bereit sind',
    basis({ q: bereitQ('0', sitze) }), P('g/1/d/0'), { n: 0, o: SV }, UID[0]);
  deny('... aber nicht, solange einer von ihnen fehlt',
    basis({ q: bereitQ('0', [0, 2]) }), P('g/1/d/0'), { n: 0, o: SV }, UID[0]);
  t('[INFO]  die leeren Sitze 1 und 3 werden dabei nie erwartet', true);
  // Der Zug selbst.
  allow('Sitz 2 legt seinen Zug ab', basis({ d: offen('0') }), P('g/1/c/0/2'), O_MOVE, UID[2]);
  deny('der leere Sitz 1 legt keinen Zug ab', basis({ d: offen('0') }), P('g/1/c/0/1'), O_MOVE, UID[1]);
  // Die Enthuellungsphase wartet auf genau diese drei.
  const alleC = { 0: { 0: O_MOVE, 2: O_MOVE, 4: O_MOVE } };
  allow('die Enthuellung beginnt nach den drei Terminals', basis({ d: offen('0'), c: alleC }), P('g/1/ro/0'), SV, UID[0]);
  deny('... nicht mit nur zweien', basis({ d: offen('0'), c: { 0: { 0: O_MOVE, 2: O_MOVE } } }), P('g/1/ro/0'), SV, UID[0]);
  // Und die Frist ist dieselbe wie in v10: acht Sekunden.
  const spaet = (ms) => { const d = {}; d[0] = { n: 0, o: NOW - ms }; return d; };
  allow('v11 entscheidet ebenfalls acht Sekunden lang', basis({ d: spaet(7000) }), P('g/1/c/0/2'), O_MOVE, UID[2]);
  deny('nach 8,1 s ist auch in v11 Schluss', basis({ d: spaet(8100) }), P('g/1/c/0/2'), O_MOVE, UID[2]);
}

// ══ OEFFENTLICHE AUFFINDBARKEIT ══════════════════════════════════════════════
abschnitt('Auffindbarkeit  (ein v11-Raum kehrt nach dem Match in die Liste zurueck)');
{
  const lobby = raum({ sitze: [0], cfg: { visibility: 'public' } });
  allow('eine frische v11-Lobby wird gelistet', lobby, 'publicRooms/VEFB', { created: SV }, UID[0]);
  const nachMatch = raum({ sitze: [0, 2, 4], gen: 1, state: 'lobby', cfg: { visibility: 'public' }, pt: ptVon([0, 1, 2, 3, 4]) });
  allow('und NACH einem Match ebenso - das konnte v10 nicht', nachMatch, 'publicRooms/VEFB', { created: SV }, UID[0]);
  const laeuft = raum({ sitze: [0, 1], state: 'playing', gen: 1, pt: ptVon([0, 1]), cfg: { visibility: 'public' } });
  deny('ein laufendes Match wird nicht als offener Raum angeboten', laeuft, 'publicRooms/VEFB', { created: SV }, UID[0]);
  allow('sein Eintrag darf beim Start geraeumt werden',
    raum({ sitze: [0, 1], state: 'playing', gen: 1, pt: ptVon([0, 1]), cfg: { visibility: 'public' }, pub: { VEFB: { created: NOW - 1000 } } }),
    'publicRooms/VEFB', null, UID[1]);
  deny('ein privater v11-Raum wird nicht gelistet', raum({ sitze: [0] }), 'publicRooms/VEFB', { created: SV }, UID[0]);
}

// ══ FASSUNGSGRENZE ═══════════════════════════════════════════════════════════
abschnitt('Fassungsgrenze  (kein v10-Verhalten in einem v11-Raum)');
{
  const elf = raum({ sitze: [0, 1], state: 'playing', gen: 1, pt: ptVon([0, 1]) });
  deny('in einem v11-Raum entsteht kein v10-Feld seats', elf, P('seats'), 2, UID[0]);
  deny('... auch nicht nachtraeglich in der Lobby', raum({ sitze: [0, 1] }), P('seats'), 2, UID[0]);
  deny('die Fassung eines bestehenden Raums ist unveraenderlich', elf, P('v'), 10, UID[0]);
  // Ein v10-Raum bekommt umgekehrt keine v11-Knoten.
  const zehn = { rooms: { VEFB: { v: 10, hostUid: UID[0], config: CFG(), gen: 0, state: 'lobby',
    p: { 0: { s: TAB(0), on: true, t: NOW }, 1: { s: TAB(1), on: true, t: NOW } },
    players: { 0: { id: 'VEFBPID0', name: 'P0', tab: TAB(0), uid: UID[0] }, 1: { id: 'VEFBPID1', name: 'P1', tab: TAB(1), uid: UID[1] } },
    created: NOW - 5000, g: { 0: {}, 1: {} } } }, publicRooms: {} };
  deny('ein v10-Raum kennt keine Bereitschaft', zehn, P('g/1/rd/0'), true, UID[0]);
  deny('ein v10-Raum kennt keine Teilnehmerliste', zehn, P('g/1/pt'), ptVon([0, 1]), UID[0]);
}

console.log('\nOnline-V11: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
