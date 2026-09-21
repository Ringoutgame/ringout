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
//   * Ein Match beginnt, weil der HOST es startet - nicht weil die Besetzung voll ist
//     und nicht, weil sich alle bereit gemeldet haben. Es gibt keine Bereitschaft.
//   * Damit es diesen einen Host immer gibt, wandert die Rolle: sie geht an den
//     niedrigsten verbundenen Sitz, sobald der bisherige Host kein verbundenes
//     Mitglied mehr ist. Solange er da ist, kann ihn niemand verdraengen.
//   * Der Matchstart ist EIN atomarer Schritt: gen, state und pt zusammen - und pt ist
//     GENAU die Menge der verbundenen Sitze in diesem Augenblick.
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
// `gen` die laufende Generation, `pt` die Teilnehmerliste der laufenden Generation.
// `host` ist der SITZ, dessen Kennung als Wirt eingetragen ist - er muss nicht besetzt
// sein, denn genau daran haengt die Nachfolge.
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
  for (const mode of ['classic', 'speed', 'timedffa'])
    deny('ein v11-Raum im Modus ' + mode, { rooms: {} }, 'rooms/VEFB', frisch({ config: CFG({ mode, cap: mode === 'timedffa' ? 5 : 2 }) }), UID[0]);
  // Seit 2026-09-21: Team 2v2 ist ein v11-Raum mit genau vier Sitzen (Wirt auf Sitz 0 oder 2).
  allow('ein v11-Raum im Modus team2v2 mit vier Sitzen', { rooms: {} }, 'rooms/VEFB', frisch({ config: CFG({ mode: 'team2v2', cap: 4 }) }), UID[0]);
  deny('ein v11-Raum im Modus team2v2 mit fuenf Sitzen', { rooms: {} }, 'rooms/VEFB', frisch({ config: CFG({ mode: 'team2v2', cap: 5 }) }), UID[0]);
  deny('ein v11-RingOut-Raum', { rooms: {} }, 'rooms/VEFB', frisch({ config: { game: 'ringout', winTarget: 3, fmt: 'ffa', visibility: 'private' } }), UID[0]);
  deny('v11 ohne Hostkennung', { rooms: {} }, 'rooms/VEFB', (() => { const r = frisch(); delete r.hostUid; return r; })(), UID[0]);
  deny('v11 mit fremder Hostkennung', { rooms: {} }, 'rooms/VEFB', frisch({ hostUid: UID[1] }), UID[0]);
  // Die Startbesetzung gehoert nicht mehr dem Raum: `seats` hat in v11 nichts zu suchen.
  deny('ein v11-Raum darf nicht mit dem v10-Feld seats angelegt werden', { rooms: {} }, 'rooms/VEFB', frisch({ seats: 2, state: 'playing' }), UID[0]);
  deny('v12 bleibt jenseits jeder bekannten Fassung', { rooms: {} }, 'rooms/VEFB', frisch({ v: 12 }), UID[0]);
}

// ══ WER DARF STARTEN ═════════════════════════════════════════════════════════
abschnitt('Startbefugnis  (genau einer: der eingetragene Wirt)');
{
  // Drei Menschen sitzen im Raum, der Wirt ist Sitz 0. Nur er startet.
  const db = raum({ sitze: [0, 1, 2], host: 0 });
  startAllow('der Wirt startet das Match', db, 1, ptVon([0, 1, 2]), UID[0]);
  startDeny('ein gewoehnliches Mitglied nicht', db, 1, ptVon([0, 1, 2]), UID[1]);
  startDeny('... und auch nicht der letzte Sitz', db, 1, ptVon([0, 1, 2]), UID[2]);
  startDeny('ein Unbeteiligter erst recht nicht', db, 1, ptVon([0, 1, 2]), UID[5]);
  // Der Wirt muss selbst im Raum sitzen. Eine Wirtskennung ohne Sitz ist eine
  // Karteileiche - sie darf nichts ausloesen.
  const wirtWeg = raum({ sitze: [1, 2], host: 0 });
  startDeny('eine Wirtskennung ohne Sitz startet nichts', wirtWeg, 1, ptVon([1, 2]), UID[0]);
  const wirtOffline = raum({ sitze: [0, 1, 2], offline: [0], host: 0 });
  startDeny('ein getrennter Wirt ebenso wenig', wirtOffline, 1, ptVon([1, 2]), UID[0]);
  // Der Wirt muss nicht Sitz 0 sein - er ist, wer eingetragen ist.
  const wirt4 = raum({ sitze: [0, 2, 4], host: 4 });
  startAllow('ein Wirt auf Sitz 4 startet genauso', wirt4, 1, ptVon([0, 2, 4]), UID[4]);
  startDeny('... und Sitz 0 darf es dort nicht', wirt4, 1, ptVon([0, 2, 4]), UID[0]);
}

// ══ DIE HOSTNACHFOLGE ════════════════════════════════════════════════════════
abschnitt('Hostnachfolge  (nur wenn der Wirt weg ist, und nur an den niedrigsten Sitz)');
{
  // Solange der Wirt verbunden im Raum sitzt, ist die Rolle unantastbar.
  const wirtDa = raum({ sitze: [0, 1, 2], host: 0 });
  deny('niemand nimmt dem anwesenden Wirt die Rolle', wirtDa, P('hostUid'), UID[1], UID[1]);
  deny('... auch nicht der niedrigste andere Sitz', wirtDa, P('hostUid'), UID[1], UID[1]);
  deny('... und der Wirt schenkt sie auch nicht weiter', wirtDa, P('hostUid'), UID[0], UID[1]);
  // Ein nur GETRENNTER Wirt ist ebenfalls kein verbundenes Mitglied mehr - dann darf
  // die Rolle wandern, sonst haette ein Absturz den Raum stillgelegt.
  const wirtOffline = raum({ sitze: [0, 1, 2], offline: [0], host: 0 });
  allow('ist der Wirt getrennt, uebernimmt der niedrigste verbundene Sitz', wirtOffline, P('hostUid'), UID[1], UID[1]);
  deny('... aber nicht ein hoeherer', wirtOffline, P('hostUid'), UID[2], UID[2]);
  // Und nach einem Austritt.
  const wirtFort = raum({ sitze: [1, 2, 4], host: 0 });
  allow('ist der Wirt gegangen, uebernimmt Sitz 1', wirtFort, P('hostUid'), UID[1], UID[1]);
  deny('... nicht Sitz 2', wirtFort, P('hostUid'), UID[2], UID[2]);
  deny('... und nicht Sitz 4', wirtFort, P('hostUid'), UID[4], UID[4]);
  // Mit Luecken gilt dasselbe: der NIEDRIGSTE verbundene Sitz, nicht der Sitz 1.
  const luecke = raum({ sitze: [2, 4], host: 0 });
  allow('bei den Sitzen 2 und 4 uebernimmt Sitz 2', luecke, P('hostUid'), UID[2], UID[2]);
  deny('... nicht Sitz 4', luecke, P('hostUid'), UID[4], UID[4]);
  // Und die zweite Nachfolge danach.
  const nurVier = raum({ sitze: [4], host: 2 });
  allow('geht auch der Nachfolger, uebernimmt der letzte Verbliebene', nurVier, P('hostUid'), UID[4], UID[4]);
  // Niemand traegt einen anderen ein - auch nicht den richtigen Nachfolger.
  deny('niemand traegt einen FREMDEN als Wirt ein', wirtFort, P('hostUid'), UID[2], UID[1]);
  deny('ein Unbeteiligter uebernimmt nichts', wirtFort, P('hostUid'), UID[5], UID[5]);
  // PASS 01C: nach einer rechtmaessigen Nachfolge kehrt der alte Wirt zurueck. Seine
  // Rolle ist weg - und er holt sie sich nicht zurueck, solange der neue Wirt verbunden
  // dasitzt. Dieselbe Regel, nur aus der anderen Richtung gelesen.
  const nachNachfolge = raum({ sitze: [0, 1, 2], host: 1 });
  deny('der alte Wirt holt sich die Rolle nicht zurueck', nachNachfolge, P('hostUid'), UID[0], UID[0]);
  deny('... und niemand traegt sie ihm zurueck', nachNachfolge, P('hostUid'), UID[0], UID[2]);
  // Faellt AUCH der neue Wirt aus, geht sie regulaer weiter - an den niedrigsten
  // verbundenen Sitz, und das kann der frueher Zurueckgekehrte sein.
  const neuerWeg = raum({ sitze: [0, 1, 2], offline: [1], host: 1 });
  allow('faellt der neue Wirt aus, rueckt der niedrigste Verbundene nach', neuerWeg, P('hostUid'), UID[0], UID[0]);
  deny('ohne Anmeldung ebenso wenig', wirtFort, P('hostUid'), UID[1], null);
  // Die Rolle laesst sich nicht loeschen - ein Raum ohne Wirt koennte nie wieder starten.
  deny('die Wirtsmarke laesst sich nicht entfernen', wirtFort, P('hostUid'), null, UID[1]);
  // Und ein alter Wirt, der den Raum verlassen hat, startet nichts mehr - auch nicht,
  // bevor die Nachfolge geschrieben ist.
  startDeny('ein ausgetretener Wirt startet kein Match mehr', wirtFort, 1, ptVon([1, 2, 4]), UID[0]);
  // Die aeltere Fassungen behalten ihre unveraenderliche Wirtsmarke.
  const zehnOhneWirt = { rooms: { VEFB: { v: 10, hostUid: UID[0], config: CFG(), gen: 1, state: 'lobby',
    p: { 1: { s: TAB(1), on: true, t: NOW } },
    players: { 1: { id: 'VEFBPID1', name: 'P1', tab: TAB(1), uid: UID[1] } },
    created: NOW - 5000, g: { 0: {}, 1: {} } } }, publicRooms: {} };
  deny('in einem v10-Raum wandert die Wirtsmarke NICHT', zehnOhneWirt, P('hostUid'), UID[1], UID[1]);
}

// ══ SITZWECHSEL ══════════════════════════════════════════════════════════════
abschnitt('Sitzwechsel  (ein neuer Inhaber erbt keinerlei Lobbyzustand)');
{
  // Frueher stand hier eine Bereitschaft, die ein Nachfolger haette erben koennen.
  // Die gibt es nicht mehr - und damit gibt es ueberhaupt keinen Lobbyzustand am
  // Sitz ausser Praesenz und Rostereintrag. Beide gehoeren dem, der JETZT dort
  // sitzt. Das wird hier nachgewiesen, statt es zu behaupten.
  const nachWechsel = raum({ sitze: [0, 2], host: 0 });
  deny('unter g/<gen+1> gibt es keinen Bereitschaftsknoten mehr', nachWechsel, P('g/1/rd/2'), UID[2], UID[2]);
  deny('... auch nicht als nackte Zusage', nachWechsel, P('g/1/rd/2'), true, UID[2]);
  deny('... und auch nicht fuer die laufende Generation', nachWechsel, P('g/0/rd/0'), UID[0], UID[0]);
  // Der neue Inhaber ist schlicht ein Mitglied - er zaehlt mit, sobald er da ist.
  startAllow('der neue Inhaber zaehlt beim naechsten Start mit', nachWechsel, 1, ptVon([0, 2]), UID[0]);
  startDeny('... und laesst sich nicht uebergehen', nachWechsel, 1, ptVon([0]), UID[0]);
}

// ══ DER MATCHSTART ═══════════════════════════════════════════════════════════
abschnitt('Matchstart  (gen + state + Teilnehmerliste in EINEM Schritt)');
{
  const zwei = raum({ sitze: [0, 1], host: 0 });
  startAllow('zwei verbundene Spieler', zwei, 1, ptVon([0, 1]), UID[0]);
  const fuenf = raum({ sitze: [0, 1, 2, 3, 4], host: 2 });
  startAllow('fuenf verbundene Spieler', fuenf, 1, ptVon([0, 1, 2, 3, 4]), UID[2]);
  // Der Wirt darf mit ZWEI bis FUENF starten - er muss nicht warten, bis der Raum voll ist.
  for (const n of [2, 3, 4, 5]) {
    const sitze = [0, 1, 2, 3, 4].slice(0, n);
    startAllow('der Wirt startet mit ' + n + ' Spielern', raum({ sitze, host: 0 }), 1, ptVon(sitze), UID[0]);
  }
  // Die entscheidende Neuerung: LUECKEN sind erlaubt.
  const luecke = raum({ sitze: [0, 2, 4], host: 4 });
  startAllow('drei Spieler auf den Sitzen 0, 2 und 4', luecke, 1, ptVon([0, 2, 4]), UID[4]);
  // Und die Gegenproben.
  startDeny('einer allein startet kein Match', raum({ sitze: [0], host: 0 }), 1, ptVon([0]), UID[0]);
  startDeny('der Wirt laesst keinen anwesenden Spieler weg', raum({ sitze: [0, 1, 2], host: 0 }), 1, ptVon([0, 1]), UID[0]);
  startDeny('... auch nicht sich selbst', raum({ sitze: [0, 1, 2], host: 0 }), 1, ptVon([1, 2]), UID[0]);
  startDeny('niemand nimmt einen abwesenden Spieler mit', zwei, 1, ptVon([0, 1, 2]), UID[0]);
  startDeny('niemand nimmt einen getrennten Spieler mit',
    raum({ sitze: [0, 1, 2], offline: [2], host: 0 }), 1, ptVon([0, 1, 2]), UID[0]);
  startAllow('ein getrennter Spieler zaehlt einfach nicht mit',
    raum({ sitze: [0, 1, 2], offline: [2], host: 0 }), 1, ptVon([0, 1]), UID[0]);
  startDeny('die Generation darf nicht springen', zwei, 2, ptVon([0, 1]), UID[0]);
  startDeny('und nicht stehenbleiben', zwei, 0, ptVon([0, 1]), UID[0]);
  startDeny('aus einem laufenden Match heraus startet niemand ein zweites',
    raum({ sitze: [0, 1], state: 'playing', pt: ptVon([0, 1]), host: 0 }), 1, ptVon([0, 1]), UID[0]);
  // Die Liste ist unveraenderlich, sobald sie steht.
  const laeuft = raum({ sitze: [0, 1, 2], state: 'playing', gen: 1, pt: ptVon([0, 1]), host: 0 });
  deny('die Teilnehmerliste eines laufenden Matches ist unveraenderlich', laeuft, P('g/1/pt'), ptVon([0, 1, 2]), UID[0]);
  deny('... auch nicht einzeln erweiterbar', laeuft, P('g/1/pt/2'), true, UID[2]);
  deny('... und nicht loeschbar', laeuft, P('g/1/pt/1'), null, UID[0]);
}

// ══ DOPPELSTART ══════════════════════════════════════════════════════════════
abschnitt('Doppelstart  (genau ein Uebergang, auch wenn alle gleichzeitig sehen)');
{
  // Der zweite Start scheitert an der Vorbedingung: nach dem ersten steht gen bereits
  // auf 1 und state auf 'playing'. Beides prueft die Regel ausdruecklich.
  const nachStart = raum({ sitze: [0, 1], gen: 1, state: 'playing', pt: ptVon([0, 1]), host: 0 });
  startDeny('ein zweiter Start auf dieselbe Generation', nachStart, 1, ptVon([0, 1]), UID[1]);
  startDeny('ein Start auf die naechste Generation waehrend des Matches', nachStart, 2, ptVon([0, 1]), UID[1]);
  // Und ohne die drei Pfade zusammen geht gar nichts.
  const lobby = raum({ sitze: [0, 1], host: 0 });
  deny('die Generation allein weiterzuschalten reicht nicht', lobby, P('gen'), 1, UID[0]);
  deny('der Zustand allein ebenso wenig', lobby, P('state'), 'playing', UID[0]);
  deny('und die Teilnehmerliste allein auch nicht', lobby, P('g/1/pt'), ptVon([0, 1]), UID[0]);
}

// ══ DER ZUSTANDSKREISLAUF ════════════════════════════════════════════════════
abschnitt('Zustandskreislauf  (playing -> lobby und wieder zurueck)');
{
  const laeuft = raum({ sitze: [0, 1, 2], state: 'playing', gen: 1, pt: ptVon([0, 1, 2]) });
  allow('nach dem Match wird der Raum wieder Lobby', laeuft, P('state'), 'lobby', UID[1]);
  deny('ein Unbeteiligter beendet kein Match', laeuft, P('state'), 'lobby', UID[5]);
  deny('ohne Anmeldung ebenso wenig', laeuft, P('state'), 'lobby', null);
  // Und der Kreislauf laeuft weiter: aus der zurueckgewonnenen Lobby startet das naechste.
  const zurueck = raum({ sitze: [0, 1, 2], state: 'lobby', gen: 1, pt: ptVon([0, 1, 2]), host: 0 });
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

// ══ GETRENNT IST NICHT STUMM ═════════════════════════════════════════════════
// Ein Sitz, den der AUTORITATIVE Praesenzstand als getrennt ausweist, darf sofort mit
// dem kanonischen Nullterminal geschlossen werden - ohne die Achtsekundenfrist. Sein
// Platz bleibt ihm trotzdem: das ist die Rueckkehrfrist, eine ganz andere Groesse.
// Ebenso wenig haelt er die naechste Runde auf.
//
// Wer VERBUNDEN ist und einfach nichts tut, ist NICHT getrennt - fuer ihn bleibt alles,
// wie es war: acht Sekunden, dann `late`.
abschnitt('Getrennt ist nicht stumm  (v11: sofort schliessen, aber nur den Getrennten)');
{
  const sitze = [0, 1, 2];
  const O_MOVE = { k: 'move', h: HEX64, ts: SV };
  const SKIP = { k: 'skip', ts: SV };
  const LATE = { k: 'late', ts: SV };
  // Frisch getrennt: on=false, aber der Zeitstempel ist SEKUNDEN alt - die
  // Rueckkehrfrist laeuft noch. Genau darum geht es: das eine hat mit dem anderen
  // nichts zu tun.
  const frischWeg = (db, seat) => { db.rooms.VEFB.p[seat].t = NOW - 2000; return db; };
  const basis = (over, weg) => {
    const db = raum(Object.assign({ sitze, state: 'playing', gen: 1, pt: ptVon(sitze),
                                    offline: weg === undefined ? [2] : weg }, over || {}));
    for (const i of (weg === undefined ? [2] : weg)) frischWeg(db, i);
    return db;
  };
  const offen = (ms) => { const d = {}; d[0] = { n: 0, o: NOW - (ms === undefined ? 1000 : ms) }; return d; };

  allow('der offene Slot eines frisch Getrennten schliesst SOFORT',
    basis({ d: offen(1000) }), P('g/1/c/0/2'), SKIP, UID[0]);
  deny('ein VERBUNDENER Sitz wird nicht geschlossen - auch nicht frueh',
    basis({ d: offen(1000) }, []), P('g/1/c/0/2'), SKIP, UID[0]);
  deny('... und auch nach der Frist nicht mit skip',
    basis({ d: offen(9000) }, []), P('g/1/c/0/2'), SKIP, UID[0]);
  allow('fuer den Stummen bleibt es beim late nach acht Sekunden',
    basis({ d: offen(9000) }, []), P('g/1/c/0/2'), LATE, UID[0]);
  deny('late bleibt an die Frist gebunden - auch fuer einen Getrennten',
    basis({ d: offen(1000) }), P('g/1/c/0/2'), LATE, UID[0]);
  deny('ein bereits abgegebener Zug wird nicht ueberschrieben',
    basis({ d: offen(1000), c: { 0: { 2: O_MOVE } } }), P('g/1/c/0/2'), SKIP, UID[0]);
  deny('niemand zieht fuer einen anderen',
    basis({ d: offen(1000) }), P('g/1/c/0/2'), O_MOVE, UID[0]);
  deny('ein selbst getrennter Schreiber schliesst nichts',
    basis({ d: offen(1000) }, [0, 2]), P('g/1/c/0/2'), SKIP, UID[0]);
  deny('ein Nichtteilnehmer wird nicht geschlossen',
    raum({ sitze: [0, 1, 2, 3], state: 'playing', gen: 1, pt: ptVon([0, 1, 2]),
           offline: [3], d: { 0: { n: 0, o: NOW - 1000 } } }), P('g/1/c/0/3'), SKIP, UID[0]);
  deny('ein bereits ausgetragener Sitz bekommt kein skip',
    basis({ d: offen(1000), e: { 2: true } }), P('g/1/c/0/2'), SKIP, UID[0]);
  deny('die Fassungen davor behalten ihre Frist',
    raum({ v: 10, seats: 3, sitze, state: 'playing', gen: 1, offline: [2],
           d: { 0: { n: 0, o: NOW - 1000 } } }), P('g/1/c/0/2'), SKIP, UID[0]);

  // Und die Runde davor: ein Getrennter haelt sie nicht auf.
  const bereitQ = (turn, wer) => { const q = {}; q[turn] = {}; for (const x of wer) q[turn][x] = { k: 'ready', n: Number(turn), ts: NOW - 1000 }; return q; };
  allow('die naechste Runde beginnt ohne die Bereitschaft eines Getrennten',
    basis({ q: bereitQ('0', [0, 1]) }), P('g/1/d/0'), { n: 0, o: SV }, UID[0]);
  deny('... aber nicht ohne die eines VERBUNDENEN',
    basis({ q: bereitQ('0', [0, 1]) }, []), P('g/1/d/0'), { n: 0, o: SV }, UID[0]);
  // Eine spaetere Runde haengt zusaetzlich am vollstaendigen Abschluss ihrer
  // Vorgaengerin: deren Terminals UND ihr Abschlussanker.
  const spaeter = (() => { const db = basis({ q: bereitQ('3', [0, 1]) });
    const NULLZUG = { k: 'skip', ts: NOW - 600 };
    db.rooms.VEFB.g[1].c = { 2: { 0: NULLZUG, 1: NULLZUG, 2: NULLZUG } };
    db.rooms.VEFB.g[1].z = { 2: { ts: NOW - 500 } }; return db; })();
  allow('dasselbe gilt fuer eine spaetere Runde',
    spaeter, P('g/1/d/3'), { n: 3, o: SV }, UID[0]);
  deny('in v10 wartet die Runde weiterhin auf jeden Sitz',
    raum({ v: 10, seats: 3, sitze, state: 'playing', gen: 1, offline: [2],
           q: bereitQ('0', [0, 1]) }), P('g/1/d/0'), { n: 0, o: SV }, UID[0]);
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
  // Der Eintrag haengt NICHT am Sitz 0: in v11 darf auch der Erste gehen, und ein Raum
  // mit den Sitzen 2 und 4 ist eine vollwertige offene Lobby.
  const ohneNull = raum({ sitze: [2, 4], gen: 1, state: 'lobby', cfg: { visibility: 'public' }, pt: ptVon([0, 1, 2, 3, 4]) });
  allow('auch ein Raum ohne Sitz 0 wird gelistet', ohneNull, 'publicRooms/VEFB', { created: SV }, UID[2]);
  // Und der Eintrag einer gesunden Lobby ist geschuetzt - sonst koennte ihn jeder
  // jederzeit entfernen und den Raum unauffindbar machen.
  deny('der Eintrag einer gesunden v11-Lobby bleibt stehen',
    raum({ sitze: [2, 4], gen: 1, state: 'lobby', cfg: { visibility: 'public' }, pub: { VEFB: { created: NOW - 1000 } } }),
    'publicRooms/VEFB', null, UID[4]);
  allow('... und verschwindet, sobald niemand mehr da ist',
    raum({ sitze: [2, 4], offline: [2, 4], gen: 1, state: 'lobby', cfg: { visibility: 'public' }, pub: { VEFB: { created: NOW - 1000 } } }),
    'publicRooms/VEFB', null, UID[2]);
}

// ══ DER WIRT GEHT ════════════════════════════════════════════════════════════
abschnitt('Der Wirt geht  (der Raum lebt weiter - aber erst mit einem neuen Wirt)');
{
  // Der Wirt hat den Raum verlassen. Der Raum ist damit vollstaendig benutzbar -
  // aber starten kann erst wieder jemand, wenn die Nachfolge geschrieben ist. Das
  // ist der Preis dafuer, dass es GENAU EINEN gibt, der startet.
  const ohneWirt = raum({ sitze: [2, 4], gen: 1, state: 'lobby', host: 0 });
  t('[INFO]  der Wirt (Sitz 0) hat den Raum verlassen', true);
  startDeny('vor der Nachfolge startet niemand', ohneWirt, 2, ptVon([2, 4]), UID[2]);
  allow('der niedrigste verbliebene Sitz uebernimmt die Wirtsrolle', ohneWirt, P('hostUid'), UID[2], UID[2]);
  const neuerWirt = raum({ sitze: [2, 4], gen: 1, state: 'lobby', host: 2 });
  startAllow('und startet danach das naechste Match', neuerWirt, 2, ptVon([2, 4]), UID[2]);
  startDeny('der andere weiterhin nicht', neuerWirt, 2, ptVon([2, 4]), UID[4]);
  // Das Matchende gehoert dagegen JEDEM verbundenen Mitglied: waehrend eines Matches
  // kann der Wirt verschwinden, und dann muss der Raum trotzdem in seine Lobby
  // zurueckfallen koennen.
  const laeuftOhneWirt = raum({ sitze: [2, 4], gen: 2, state: 'playing', host: 0, pt: ptVon([2, 4]) });
  allow('das Matchende meldet jedes verbundene Mitglied', laeuftOhneWirt, P('state'), 'lobby', UID[4]);
  deny('ein Unbeteiligter nicht', laeuftOhneWirt, P('state'), 'lobby', UID[5]);
  // Und waehrend das Match laeuft, darf die Nachfolge bereits geschrieben werden -
  // so steht sie, wenn der Raum in die Lobby zurueckfaellt.
  allow('die Nachfolge darf schon waehrend des Matches geschrieben werden',
    laeuftOhneWirt, P('hostUid'), UID[2], UID[2]);
}

// ══ DER AUSTRITT AUS DEM LAUFENDEN MATCH ═════════════════════════════════════
abschnitt('Austritt aus dem laufenden Match  (Anker und Marker in EINEM Schritt)');
{
  // Der kanonische Austritt ist EIN atomares update: beide Anker zurueck - und, wenn
  // der Sitz am laufenden Match teilnimmt, der Austragungsmarker DIESER Generation
  // dazu. Der Server verlangt genau diese Kopplung. Wer sie nicht herstellt, kann ein
  // laufendes Match ueberhaupt nicht mehr verlassen: die Ruecknahme wird abgewiesen,
  // der Sitz bleibt stehen, und die Uebrigen warten auf einen, der schon fort ist.
  const austritt = (db, g, sitz, uid, mitMarker) => {
    const auch = { ['rooms/VEFB/p/' + sitz]: null, ['rooms/VEFB/players/' + sitz]: null };
    if (mitMarker) auch['rooms/VEFB/g/' + g + '/e/' + sitz] = true;
    const teile = Object.keys(auch).map(pf => tryWrite(db, pf, auch[pf], uid, auch));
    return { alle: teile.every(Boolean), teile: teile.join('/') };
  };
  const austrittAllow = (n, db, g, sitz, uid, mit) => { const r = austritt(db, g, sitz, uid, mit); t('[ALLOW] ' + n, r.alle, r.teile); };
  const austrittDeny = (n, db, g, sitz, uid, mit) => { const r = austritt(db, g, sitz, uid, mit); t('[DENY]  ' + n, !r.alle, r.teile); };

  // Zwei Teilnehmer, das Match laeuft, der Gast geht.
  const zwei = raum({ sitze: [0, 1], gen: 1, state: 'playing', pt: ptVon([0, 1]) });
  austrittDeny('ohne Austragungsmarker weist der Server den Austritt ab', zwei, 1, 1, UID[1], false);
  austrittAllow('mit dem Marker der laufenden Generation geht er durch', zwei, 1, 1, UID[1], true);
  // Der Wirt ist kein Sonderfall: auch er verlaesst sein eigenes Match.
  austrittDeny('der Wirt ebenfalls nicht ohne Marker', zwei, 1, 0, UID[0], false);
  austrittAllow('… und mit Marker ebenso wie jeder andere', zwei, 1, 0, UID[0], true);
  // Der Marker gehoert in die LAUFENDE Generation - nicht in die vorige, nicht in die
  // naechste.
  austrittDeny('ein Marker in der vorigen Generation traegt nichts aus', zwei, 0, 1, UID[1], true);
  austrittDeny('… und einer in der naechsten ebenso wenig', zwei, 2, 1, UID[1], true);
  // Drei und fuenf Teilnehmer: derselbe Vorgang, unabhaengig von der Groesse.
  const drei = raum({ sitze: [0, 1, 2], gen: 1, state: 'playing', pt: ptVon([0, 1, 2]) });
  austrittAllow('aus einem Dreier-Match tritt der mittlere Sitz aus', drei, 1, 1, UID[1], true);
  austrittDeny('… ohne Marker auch hier nicht', drei, 1, 1, UID[1], false);
  const fuenf = raum({ sitze: [0, 1, 2, 3, 4], gen: 1, state: 'playing', pt: ptVon([0, 1, 2, 3, 4]) });
  for (const s of [0, 1, 2, 3, 4])
    austrittAllow('aus einem Fuenfer-Match tritt Sitz ' + s + ' aus', fuenf, 1, s, UID[s], true);
  // Luecken: der Marker trifft den Sitz, nicht seine Position in einer Reihe.
  const luecke = raum({ sitze: [0, 2, 4], gen: 1, state: 'playing', pt: ptVon([0, 2, 4]) });
  austrittAllow('aus einer lueckenhaften Besetzung tritt Sitz 2 aus', luecke, 1, 2, UID[2], true);
  austrittDeny('… ohne Marker nicht', luecke, 1, 2, UID[2], false);
  austrittAllow('… und Sitz 4 ebenso', luecke, 1, 4, UID[4], true);
  // Ein Raummitglied, das beim laufenden Match NICHT dabei ist, traegt sich aus nichts
  // aus - und darf es auch nicht.
  const zuschauer = raum({ sitze: [0, 1, 2], gen: 1, state: 'playing', pt: ptVon([0, 1]) });
  austrittAllow('ein Nichtteilnehmer geht ohne Marker', zuschauer, 1, 2, UID[2], false);
  austrittDeny('… und kann sich gar nicht erst austragen', zuschauer, 1, 2, UID[2], true);
  // Und in der Lobby gibt es nichts auszutragen.
  const lobby = raum({ sitze: [0, 1], gen: 1, state: 'lobby' });
  austrittAllow('aus einer Lobby geht man ohne Marker', lobby, 1, 1, UID[1], false);
  austrittDeny('… ein Marker waere dort eine Falschaussage', lobby, 1, 1, UID[1], true);
  // Write-once: ein bereits gesetzter Marker bleibt stehen; die Anker muessen trotzdem
  // zurueckgenommen werden koennen.
  const schonAus = raum({ sitze: [0, 1], gen: 1, state: 'playing', pt: ptVon([0, 1]), e: { 1: true } });
  austrittAllow('ist der Sitz bereits ausgetragen, genuegen die Anker', schonAus, 1, 1, UID[1], false);
  austrittDeny('… und der Marker wird kein zweites Mal geschrieben', schonAus, 1, 1, UID[1], true);
  // Und niemand traegt einen FREMDEN Sitz ueber diesen Weg aus.
  austrittDeny('ein Mitspieler nimmt niemandem die Anker weg', zwei, 1, 1, UID[0], true);
}

// ══ DER FREI GEWORDENE SITZ ══════════════════════════════════════════════════
abschnitt('Der frei gewordene Sitz  (der Marker gehoert seiner Generation)');
{
  // Ein Austragungsmarker sagt: DIESER Sitz nimmt an DIESEM Match nicht mehr teil.
  // Solange das Match laeuft, sperrt er die Rueckkehr - das ist der ganze Sinn. Faellt
  // der Raum danach in seine Lobby zurueck, ist das Match vorbei; der Marker bleibt als
  // Geschichte seiner Generation stehen, sperrt aber nichts mehr. Sonst waere ein
  // bleibender Raum nach dem ersten Austritt unbrauchbar: niemand koennte nachruecken,
  // und ohne zweiten Spieler startet auch keine neue Generation, die den Marker
  // hinter sich liesse.
  const belegt = (state, over) => {
    const db = raum(Object.assign({ sitze: [0, 1], gen: 1, state: state, pt: ptVon([0, 1]), e: { 1: true } }, over || {}));
    // Sitz 1 ist reserviert (on:false) - der neue Mitspieler hat ihn sich genommen.
    db.rooms.VEFB.p[1] = { s: TAB(9), on: false, t: NOW };
    db.rooms.VEFB.players[1] = { id: 'VEFBPID9', name: 'P9', tab: TAB(9), uid: UID[3] };
    return db;
  };
  const anmelden = (db, sitz, uid, tab) => tryWrite(db, P('p/' + sitz), { s: tab === undefined ? TAB(9) : tab, on: true, t: NOW }, uid);

  // A. Waehrend das Match laeuft, bleibt die Sperre.
  t('[DENY]  ein ausgetragener Sitz kehrt im LAUFENDEN Match nicht zurueck',
    anmelden(belegt('playing'), 1, UID[3]) === false);
  t('[DENY]  auch nicht unter der urspruenglichen Kennung',
    (() => { const db = belegt('playing'); db.rooms.VEFB.players[1].uid = UID[1];
             return anmelden(db, 1, UID[1]) === false; })());
  // B. In der Lobby ist das Match vorbei - der Sitz ist wieder ein Sitz.
  t('[ALLOW] in der LOBBY darf der frei gewordene Sitz wieder besetzt werden',
    anmelden(belegt('lobby'), 1, UID[3]) === true);
  t('[ALLOW] auch die frische Reservierung geht wie immer',
    tryWrite(raum({ sitze: [0], gen: 1, state: 'lobby', pt: ptVon([0, 1]), e: { 1: true } }),
      P('p/1'), { s: TAB(9), on: false, t: NOW }, UID[3],
      { [P('players/1')]: { id: 'VEFBPID9', name: 'P9', tab: TAB(9), uid: UID[3] } }) === true);
  // C. Was NICHT gelockert wird: ein besetzter Sitz bleibt besetzt.
  const wirtDa = raum({ sitze: [0, 1], gen: 1, state: 'lobby', pt: ptVon([0, 1]), e: { 1: true } });
  t('[DENY]  ein belegter, verbundener Sitz laesst sich nicht uebernehmen',
    anmelden(wirtDa, 0, UID[3], TAB(0)) === false);
  t('[DENY]  ... auch der frei gewordene nicht, wenn er inzwischen einem anderen gehoert',
    (() => { const db = belegt('lobby'); return anmelden(db, 1, UID[4]) === false; })());
  // D. Eigentum bleibt Eigentum: der Anmeldung liegt derselbe Token zugrunde wie der
  //    Reservierung - ein fremder Token wird abgewiesen.
  t('[DENY]  ein fremder Token meldet den Sitz nicht an',
    anmelden(belegt('lobby'), 1, UID[3], TAB(4)) === false);
  // Ein Altsitz ohne Kennung ist seit jeher uebernehmbar - aber nur von dem, der ihn
  // reserviert hat. An diesem Token aendert die Lockerung nichts.
  t('[DENY]  auch ein kennungsloser Altsitz bleibt an seinen Token gebunden',
    (() => { const db = belegt('lobby'); delete db.rooms.VEFB.players[1].uid;
             return anmelden(db, 1, UID[5], TAB(4)) === false; })());
  // E./F. Die alten Fassungen bleiben, wie sie sind: dort sperrt der Marker weiter.
  const alt = (v) => {
    const db = raum({ sitze: [0, 1], gen: 1, state: 'lobby', v: v, seats: 2, pt: null, e: { 1: true } });
    db.rooms.VEFB.p[1] = { s: TAB(9), on: false, t: NOW };
    db.rooms.VEFB.players[1] = { id: 'VEFBPID9', name: 'P9', tab: TAB(9), uid: UID[3] };
    return db;
  };
  t('[DENY]  v10 kennt diese Lockerung nicht', anmelden(alt(10), 1, UID[3]) === false);
  t('[DENY]  v9 ebenso wenig', anmelden(alt(9), 1, UID[3]) === false);
  t('[DENY]  und v8 auch nicht', anmelden(alt(8), 1, UID[3]) === false);
  // G. Der Marker selbst ist und bleibt unveraenderlich.
  const mitMarker = raum({ sitze: [0, 1], gen: 1, state: 'playing', pt: ptVon([0, 1]), e: { 1: true } });
  deny('ein gesetzter Marker laesst sich nicht zuruecknehmen', mitMarker, P('g/1/e/1'), null, UID[1]);
  deny('... und nicht ueberschreiben', mitMarker, P('g/1/e/1'), true, UID[1]);
  const lobbyMarker = raum({ sitze: [0, 1], gen: 1, state: 'lobby', pt: ptVon([0, 1]), e: { 1: true } });
  deny('auch in der Lobby bleibt er stehen', lobbyMarker, P('g/1/e/1'), null, UID[1]);
  deny('und es entsteht dort auch kein neuer', lobbyMarker, P('g/1/e/0'), true, UID[0]);
  // Und die naechste Generation beginnt unbelastet: der alte Marker sagt ueber sie nichts.
  const zurueck = raum({ sitze: [0, 1], gen: 1, state: 'lobby', pt: ptVon([0, 1]), e: { 1: true } });
  startAllow('die naechste Generation startet mit der jetzigen Besetzung', zurueck, 2, ptVon([0, 1]), UID[0]);
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
  deny('den Bereitschaftsknoten gibt es in KEINER Fassung mehr', zehn, P('g/1/rd/0'), UID[0], UID[0]);
  deny('ein v10-Raum kennt keine Teilnehmerliste', zehn, P('g/1/pt'), ptVon([0, 1]), UID[0]);
}

console.log('\nOnline-V11: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
