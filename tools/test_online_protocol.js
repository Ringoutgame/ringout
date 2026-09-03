// ONLINE-PROTOKOLL — reine Schema-/Client-Semantik.
//
// Der Dateiname traegt bewusst KEINE Versionsnummer mehr: die Suite liest die aktuelle
// Version aus index.html und war schon immer versionsneutral geschrieben. Ein Name mit
// fester Nummer waere beim naechsten Sprung wieder falsch.
//
// Diese Suite prueft AUSSCHLIESSLICH die pure Vertragsschicht: Protokollversion, Raumtyp,
// Football-Kontrakt, Sitz-/Koerpertrennung und die drei kanonischen Zugereignisse. Die
// serverseitige Durchsetzung liegt in tools/test_rules.js, die Flussfaelle in den
// Online-Harnessen — hier gibt es keine Datenbank, keinen Browser und keine Physik.
//
// Alle Quellen kommen WOERTLICH aus index.html; nichts wird nachgebaut.
//
//   node tools/test_online_protocol.js
//
const { loadIndexHtml, grab, grabFunction } = require('./extract.js');
const html = loadIndexHtml();

const SRC = [
  grab(html, /const ONLINE_PROTOCOL_VERSION=[^\n]*/, 'ONLINE_PROTOCOL_VERSION'),
  grab(html, /const FFA_MAX_SEATS=[^\n]*/, 'FFA_MAX_SEATS'),
  grab(html, /const GEN_MAX=[^\n]*/, 'GEN_MAX'),
  // Protokollblock: Raumtyp, Football-Kontrakt, kanonische Zugereignisse.
  grab(html, /const ROOM_GAME_RINGOUT=[\s\S]*?\nfunction validateTurnRecord\(rec,game,seat\)\{[\s\S]*?\n\}/, 'Protokoll v4'),
  grabFunction(html, 'validateRoom'),
  grabFunction(html, 'validateRejoinRoom'),
  // Die dritte Raumpruefung: sie entscheidet, was in der oeffentlichen Liste ueberhaupt
  // erscheint — und damit, welchen Raum ein Spieler per Klick betreten kann.
  grab(html, /const ROOM_MAX_AGE_MS=[^\n]*/, 'ROOM_MAX_AGE_MS'),
  grabFunction(html, 'publicListingView'),
  grabFunction(html, 'pickFreeSeat'),
  grabFunction(html, 'seatActive'),
].join('\n');

const P = new Function(`
  ${SRC}
  return {
    VER: ONLINE_PROTOCOL_VERSION, FFA_MAX_SEATS, GEN_MAX,
    RINGOUT: ROOM_GAME_RINGOUT, FOOTBALL: ROOM_GAME_FOOTBALL,
    SEATS: FB_ONLINE_SEATS, BALL: FB_ONLINE_BALL_IDX,
    MOVE: TURN_MOVE, SKIP: TURN_SKIP, REMOVE: TURN_REMOVE,
    roomGame, roomIsFootball, validGamePair, roomSeatCap,
    fbTurnMove, fbTurnSkip, fbTurnRemove, validateTurnRecord,
    validateRoom, validateRejoinRoom, publicListingView
  };
`)();

let pass = 0, fail = 0;
const t = (name, cond, info) => {
  cond ? pass++ : (fail++, console.error('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')));
};

console.log('ONLINE-PROTOKOLL v' + P.VER + ' — Schema und kanonische Zugereignisse\n');

// ── (1) Protokollversion ─────────────────────────────────────────────────────────
// Keine dieser Versionen ist eine Schemaaenderung — alle markieren SIMULATIONSREVISIONEN.
// v5: der Football-Stossimpuls kennt Massen (Action Core 04).
// v6: VERBRANNT. Die Nummer markierte die Sustained-Energy-Abstimmung (Action Core 05),
//     die der Spieltest abgelehnt hat; sie ist vollstaendig aus dem Produktivcode
//     entfernt. Die Nummer wird NICHT wiederverwendet — sie kann bei Testern in
//     Umlauf gewesen sein, und ein v6-Raum darf nie fuer den heutigen Stand gehalten
//     werden. Die Rules bedienen sie waehrend der Umstellung weiter.
// v7: Timed Classic (90 s Bedenkzeit, Golden Goal) aendert den Rundenablauf
//     gegenueber v5. Die zwischenzeitlich unter v7 erprobte breitere Classic-Toroeffnung
//     ist nach dem Spieltest zurueckgenommen; die NUMMER bleibt v7, weil sie oeffentlich
//     im Umlauf war und ein Raum aus dem Zwischenstand nie fuer den heutigen gelten darf.
// Zwei Clients mit unterschiedlichem Stand rechnen ab dem ersten schnellen Ball
// auseinander und duerfen sich nie einen Raum teilen.
t('die Protokollversion ist 7', P.VER === 7, P.VER);
const RULES = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');
// WAEHREND DER UMSTELLUNG akzeptiert der Server beide Versionen — sonst waere jeder noch
// offene v4-Raum sofort tot, obwohl die alten Clients dort legitim weiterspielen. Die
// TRENNUNG leistet der Client, nicht der Server (die drei Raumpruefungen unten).
t('die Rules lassen waehrend der Umstellung v4, v5, v6 UND v7 zu',
  /\(newData\.val\(\) === 4 \|\| newData\.val\(\) === 5 \|\| newData\.val\(\) === 6 \|\| newData\.val\(\) === 7\)/.test(RULES));
const V_REGEL = (RULES.match(/"v": \{[^}]*\}/) || [''])[0];
t('und keine andere Protokollversion — geprueft am v-Validator selbst',
  /=== 4/.test(V_REGEL) && /=== 5/.test(V_REGEL) && /=== 6/.test(V_REGEL) &&
  /=== 7/.test(V_REGEL) &&
  !/=== 3|=== 8|=== 2|=== 1/.test(V_REGEL), V_REGEL);
// Die Protokollnummer eines bestehenden Raums ist unveraenderlich — ein v4-Raum kann
// nicht zu einem v5-Raum umgeschrieben werden und umgekehrt.
// Der Zugslot ist die Schreibstelle, die den Lockstep-Strom traegt. Er war bisher als
// EINZIGE nicht versionsgebunden — die Trennung lag allein beim Client. Mit v5 bekommt
// auch er den Riegel: ein Bug im Client kann damit keinen fremdversionigen Raum mehr
// mit Zuegen beschreiben.
t('auch der Zugslot ist versionsgebunden',
  /\.child\('v'\)\.val\(\) === 4 \|\| root\.child\('rooms'\)\.child\(\$code\)\.child\('v'\)\.val\(\) === 5 \|\| root\.child\('rooms'\)\.child\(\$code\)\.child\('v'\)\.val\(\) === 6 \|\| root\.child\('rooms'\)\.child\(\$code\)\.child\('v'\)\.val\(\) === 7\) && \(\(!root/.test(RULES));
t('die Rules machen die Raumversion unveraenderlich',
  /\(!data\.exists\(\) \|\| newData\.val\(\) === data\.val\(\)\)/.test(RULES));
// Jede Raumpruefung des Clients vergleicht strikt gegen die eigene Version — es gibt
// keinen Pfad, der eine fremde Version durchliesse.
t('alle Raumpruefungen des Clients vergleichen strikt auf die eigene Version',
  (html.match(/!==ONLINE_PROTOCOL_VERSION/g) || []).length === 4,
  (html.match(/!==ONLINE_PROTOCOL_VERSION/g) || []).length);

// ── (2) Raumtyp und Format ───────────────────────────────────────────────────────
t('RingOut ist der Standardtyp', P.RINGOUT === 'ringout' && P.FOOTBALL === 'football');
for (const f of ['single', 'double', 'ffa', 'triple_ffa', 'team_duel'])
  t('RingOut erlaubt das Format ' + f, P.validGamePair(P.RINGOUT, f) === true);
t('RingOut erlaubt kein Football-Format', P.validGamePair(P.RINGOUT, 'elimination') === false);
t('Football erlaubt Elimination', P.validGamePair(P.FOOTBALL, 'elimination') === true);
for (const f of ['single', 'double', 'ffa', 'triple_ffa', 'team_duel'])
  t('Football erlaubt das RingOut-Format ' + f + ' nicht', P.validGamePair(P.FOOTBALL, f) === false);
t('ein fehlender Raumtyp ist ungueltig', P.validGamePair(undefined, 'single') === false);
t('ein unbekannter Raumtyp ist ungueltig', P.validGamePair('arcade', 'single') === false);
t('roomIsFootball erkennt genau den Football-Typ',
  P.roomIsFootball({ game: 'football' }) === true && P.roomIsFootball({ game: 'ringout' }) === false &&
  P.roomIsFootball({}) === false && P.roomIsFootball(null) === false);
t('roomGame faellt nie still auf Football zurueck',
  P.roomGame({}) === 'ringout' && P.roomGame(null) === 'ringout' && P.roomGame({ game: 'football' }) === 'football');

// ── (3) Sitz- und Koerpervertrag ────────────────────────────────────────────────
t('Football hat fuenf Teilnehmersitze', P.SEATS === 5);
t('der neutrale Ball traegt den Koerperindex 5', P.BALL === 5);
t('der Ball ist KEIN Sitz — Sitzzahl und Ballindex sind verschiedene Groessen',
  P.SEATS === 5 && P.BALL === 5 && P.roomSeatCap({ game: 'football', fmt: 'elimination' }) === 5);
t('RingOut-Sitzzahlen bleiben unveraendert',
  P.roomSeatCap({ game: 'ringout', fmt: 'single' }) === 2 &&
  P.roomSeatCap({ game: 'ringout', fmt: 'double' }) === 2 &&
  P.roomSeatCap({ game: 'ringout', fmt: 'triple_ffa' }) === 3 &&
  P.roomSeatCap({ game: 'ringout', fmt: 'team_duel' }) === 4 &&
  P.roomSeatCap({ game: 'ringout', fmt: 'ffa' }) === 5);

// ── (4) Kanonische Zugereignisse ────────────────────────────────────────────────
t('die drei Ereignisarten sind benannt', P.MOVE === 'move' && P.SKIP === 'skip' && P.REMOVE === 'remove');
{
  const mv = P.fbTurnMove(2, 30, -40, 0.5);
  t('MOVE traegt Art, eigenen Koerper und den Abschussvektor',
    mv.k === 'move' && mv.idx === 2 && mv.dx === 30 && mv.dy === -40 && mv.sp === 0.5);
  const sk = P.fbTurnSkip(3);
  t('SKIP traegt Art, Sitz und den Nullvektor',
    sk.k === 'skip' && sk.idx === 3 && sk.dx === 0 && sk.dy === 0 && sk.sp === 0);
  const rm = P.fbTurnRemove(4);
  t('REMOVE traegt Art, Sitz und den Nullvektor',
    rm.k === 'remove' && rm.idx === 4 && rm.dx === 0 && rm.dy === 0 && rm.sp === 0);
  t('alle drei Bauformen haben genau fuenf Felder',
    Object.keys(mv).length === 5 && Object.keys(sk).length === 5 && Object.keys(rm).length === 5);
}

// ── (5) Validierung der Zugdatensaetze ──────────────────────────────────────────
const FB = P.FOOTBALL, RO = P.RINGOUT;
t('Football: gueltiges MOVE', P.validateTurnRecord(P.fbTurnMove(1, 10, 10, 0), FB, 1) === true);
t('Football: gueltiges SKIP', P.validateTurnRecord(P.fbTurnSkip(1), FB, 1) === true);
t('Football: gueltiges REMOVE', P.validateTurnRecord(P.fbTurnRemove(1), FB, 1) === true);
t('Football: MOVE auf eine FREMDE Figur wird abgelehnt',
  P.validateTurnRecord({ k: 'move', idx: 2, dx: 10, dy: 10, sp: 0 }, FB, 1) === false);
t('Football: MOVE auf den neutralen Ball wird abgelehnt',
  P.validateTurnRecord({ k: 'move', idx: 5, dx: 10, dy: 10, sp: 0 }, FB, 1) === false);
t('Football: idx -1 wird abgelehnt',
  P.validateTurnRecord({ k: 'move', idx: -1, dx: 0, dy: 0, sp: 0 }, FB, -1) === false);
t('Football: idx 6 wird abgelehnt',
  P.validateTurnRecord({ k: 'move', idx: 6, dx: 0, dy: 0, sp: 0 }, FB, 6) === false);
t('Football: SKIP mit Abschussvektor wird abgelehnt (gemischte Bedeutung)',
  P.validateTurnRecord({ k: 'skip', idx: 1, dx: 5, dy: 0, sp: 0 }, FB, 1) === false);
t('Football: REMOVE mit Drall wird abgelehnt',
  P.validateTurnRecord({ k: 'remove', idx: 1, dx: 0, dy: 0, sp: 0.5 }, FB, 1) === false);
t('Football: unbekannte Ereignisart wird abgelehnt',
  P.validateTurnRecord({ k: 'evict', idx: 1, dx: 0, dy: 0, sp: 0 }, FB, 1) === false);
t('Football: fehlendes k wird abgelehnt',
  P.validateTurnRecord({ idx: 1, dx: 0, dy: 0, sp: 0 }, FB, 1) === false);
t('Football: ein Zusatzfeld wird abgelehnt',
  P.validateTurnRecord({ k: 'skip', idx: 1, dx: 0, dy: 0, sp: 0, x: 1 }, FB, 1) === false);
t('Football: Vektor ausserhalb der Grenzen wird abgelehnt',
  P.validateTurnRecord({ k: 'move', idx: 1, dx: 196, dy: 0, sp: 0 }, FB, 1) === false &&
  P.validateTurnRecord({ k: 'move', idx: 1, dx: 0, dy: 0, sp: 1.5 }, FB, 1) === false);
t('Football: ein Sitz ausserhalb 0..4 wird abgelehnt',
  P.validateTurnRecord(P.fbTurnSkip(5), FB, 5) === false);
t('RingOut: unveraenderte Form ohne k bleibt gueltig',
  P.validateTurnRecord({ idx: 0, dx: 10, dy: 10, sp: 0 }, RO, 0) === true);
t('RingOut: ein k-Feld wird abgelehnt (kleine Kompatibilitaetsflaeche)',
  P.validateTurnRecord({ k: 'move', idx: 0, dx: 10, dy: 10, sp: 0 }, RO, 0) === false);
t('RingOut: Vektorgrenzen gelten unveraendert',
  P.validateTurnRecord({ idx: 0, dx: -195, dy: 195, sp: -1 }, RO, 0) === true &&
  P.validateTurnRecord({ idx: 0, dx: -196, dy: 0, sp: 0 }, RO, 0) === false);
t('leere und fremde Werte werden abgelehnt',
  P.validateTurnRecord(null, FB, 0) === false && P.validateTurnRecord('x', FB, 0) === false &&
  P.validateTurnRecord({ k: 'move', idx: '1', dx: 0, dy: 0, sp: 0 }, FB, 1) === false);

// ── (6) Raumvalidierung ─────────────────────────────────────────────────────────
const P_ON = { s: 'HOSTTAB0', on: true, t: 1 };
const room = (over) => Object.assign({
  v: P.VER, config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: 'private' },
  gen: 0, state: 'lobby', p: { 0: P_ON }, players: { 0: { id: 'HOST0000', name: 'H', tab: 'HOSTTAB0' } },
  created: 1,
}, over);
const fbRoom = (over) => room(Object.assign({
  config: { game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'private' },
}, over));

t('gueltiger RingOut-v4-Raum wird angenommen', P.validateRoom(room({})).ok === true);
t('gueltiger Football-v4-Raum wird angenommen (Schema, nicht Produktweg)',
  P.validateRoom(fbRoom({})).ok === true);
t('ein Football-Raum ist ein FUENFsitzer, kein Zweispielerraum',
  P.validateRoom(fbRoom({ p: { 0: { s: 'HOSTTAB0', on: true, t: 1 }, 1: { s: 'B', on: true, t: 1 } } })).freeSeat === 2);
t('ein voller Football-Raum meldet erst bei fuenf belegten Sitzen voll',
  P.validateRoom(fbRoom({ p: { 0: { s: 'a', on: true, t: 1 }, 1: { s: 'b', on: true, t: 1 },
    2: { s: 'c', on: true, t: 1 }, 3: { s: 'd', on: true, t: 1 }, 4: { s: 'e', on: true, t: 1 } } })).ok === false);
t('RingOut 1v1 bleibt ein Zweispielerraum',
  P.validateRoom(room({ p: { 0: { s: 'a', on: true, t: 1 }, 1: { s: 'b', on: true, t: 1 } } })).ok === false);
t('ein v3-Raum wird abgelehnt', P.validateRoom(room({ v: 3 })).ok === false);
t('ein v4-Raum wird abgelehnt — kein gemischter Lockstep',
  P.validateRoom(room({ v: 4 })).ok === false);
t('ein v5-Raum wird ebenso abgelehnt', P.validateRoom(room({ v: 5 })).ok === false);
t('ein v8-Raum wird abgelehnt', P.validateRoom(room({ v: 8 })).ok === false);
t('und ein v6-Raum ebenso — die verbrannte Nummer teilt sich keinen Raum mit v7',
  P.validateRoom(room({ v: 6 })).ok === false);
t('ein Raum ohne Typ wird abgelehnt',
  P.validateRoom(room({ config: { winTarget: 3, fmt: 'single', visibility: 'private' } })).ok === false);
t('Football mit RingOut-Format wird abgelehnt',
  P.validateRoom(room({ config: { game: 'football', winTarget: 3, fmt: 'ffa', visibility: 'private' } })).ok === false);
t('RingOut mit Football-Format wird abgelehnt',
  P.validateRoom(room({ config: { game: 'ringout', winTarget: 3, fmt: 'elimination', visibility: 'private' } })).ok === false);
t('ein unbekannter Typ wird abgelehnt',
  P.validateRoom(room({ config: { game: 'arcade', winTarget: 3, fmt: 'single', visibility: 'private' } })).ok === false);

t('Rejoin: gueltiger Raum der eigenen Version', P.validateRejoinRoom(room({ state: 'playing' })).ok === true);
// Ein LAUFENDER mehrsitziger Raum traegt seine Teilnehmerzahl im seats-Startsignal.
// Ohne sie waere beim Rejoin unbekannt, welche Sitze zum Match gehoeren - der
// Rueckkehrer wuerde als "ausserhalb der Besetzung" abgewiesen.
t('Rejoin: gueltiger Football-v4-Raum', P.validateRejoinRoom(fbRoom({ state: 'playing', seats: 5 })).ok === true);
t('Rejoin: der Football-Raum meldet fuenf Sitze',
  P.validateRejoinRoom(fbRoom({ state: 'playing', seats: 5 })).seats === 5);
t('Rejoin: laufender Football-Raum OHNE Startsignal wird abgelehnt',
  P.validateRejoinRoom(fbRoom({ state: 'playing' })).ok === false);
// Ein Football-Match startet mit zwei bis fuenf Teilnehmern; die Zahl steht im
// Startsignal und ist damit auch fuer den Rueckkehrer eindeutig.
t('Rejoin: laufender Football-Raum mit zwei bis fuenf Sitzen wird angenommen',
  [2, 3, 4, 5].every(n => P.validateRejoinRoom(fbRoom({ state: 'playing', seats: n })).ok === true));
t('Rejoin: die gemeldete Sitzzahl ist die des Startsignals',
  [2, 3, 4, 5].every(n => P.validateRejoinRoom(fbRoom({ state: 'playing', seats: n })).seats === n));
t('Rejoin: ein Football-Raum mit nur einem Sitz wird abgelehnt',
  P.validateRejoinRoom(fbRoom({ state: 'playing', seats: 1 })).ok === false);
t('Rejoin: mehr Sitze als der Raum fasst wird abgelehnt',
  P.validateRejoinRoom(fbRoom({ state: 'playing', seats: 6 })).ok === false);
t('Rejoin: die Football-LOBBY braucht kein Startsignal',
  P.validateRejoinRoom(fbRoom({ state: 'lobby' })).ok === true);
t('Rejoin: v3 wird abgelehnt', P.validateRejoinRoom(room({ v: 3 })).ok === false);
// Der gemerkte Raum aus einer frueheren Sitzung kann ein v4-Raum sein. Auch er wird
// abgewiesen — sonst haenge sich der neue Client an eine fremde Simulation.
t('Rejoin: ein gemerkter v4-Raum wird abgelehnt',
  P.validateRejoinRoom(room({ v: 4, state: 'playing' })).ok === false);
t('Rejoin: ein gemerkter v5-Raum ebenso',
  P.validateRejoinRoom(room({ v: 5, state: 'playing' })).ok === false);
t('Rejoin: und meldet das als noRoom, nicht als Fehler',
  P.validateRejoinRoom(room({ v: 4, state: 'playing' })).reason === 'noRoom' &&
  P.validateRejoinRoom(room({ v: 5, state: 'playing' })).reason === 'noRoom');
t('Rejoin: fehlender Typ wird abgelehnt',
  P.validateRejoinRoom(room({ config: { winTarget: 3, fmt: 'single', visibility: 'private' } })).ok === false);
t('Rejoin: die Ablehnung ist lokalisierbar (Schluessel statt Rohtext)',
  P.validateRejoinRoom(room({ v: 3 })).reason === 'noRoom');
t('Beitritt: die Ablehnung nennt die Versionsunvertraeglichkeit',
  /Version/i.test(P.validateRoom(room({ v: 3 })).reason || ''));

// ── (7) Kein Spielzustand im Netzschema ─────────────────────────────────────────
{
  const fs = require('fs');
  const rules = fs.readFileSync(require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  for (const forbidden of ['fbElimLives', 'fbElimActive', 'lives', 'phase', 'morph', 'arena'])
    t('das Netzschema serialisiert kein "' + forbidden + '"', rules.indexOf(forbidden) < 0);
  // Der Raum kennt genau diese Aeste - Spielzustand entsteht ausschliesslich aus der Historie.
  const room$ = JSON.parse(rules).rules.rooms.$code;
  const keys = Object.keys(room$).filter(k => !k.startsWith('.') && k !== '$other').sort();
  t('der Raum traegt nur Version, Identitaet, Praesenz, Konfiguration, Historie und Eviction',
    JSON.stringify(keys) === JSON.stringify(['config', 'created', 'g', 'gen', 'p', 'players', 'seats', 'state', 'v']), keys);
  const g$ = JSON.parse(rules).rules.rooms.$code.g.$gen;
  t('eine Generation traegt nur Zughistorie und Eviction',
    JSON.stringify(Object.keys(g$).sort()) === JSON.stringify(['e', 't']), Object.keys(g$));
}

// ── (8) Generationstrennung der Eviction ────────────────────────────────────────
{
  const rules = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8'));
  const ev = rules.rules.rooms.$code.g.$gen.e.$seat;
  t('die Eviction haengt am Generationsknoten g/<gen>/e/<seat>', !!ev && !!ev['.write']);
  t('die Eviction ist write-once', /!data\.exists\(\)/.test(ev['.write']));
  t('die Eviction kennt nur den Wert true', ev['.validate'] === 'newData.val() === true');
  t('die Eviction prueft die AKTUELLE Generation', /\$gen === /.test(ev['.write']));
  t('die Eviction verlangt einen angemeldeten Schreiber', /auth\.uid !== null/.test(ev['.write']));
  t('der Peer-Weg verlangt einen offline stehenden Sitz', /child\('on'\)\.val\(\) === false/.test(ev['.write']));
  t('der Peer-Weg verlangt eine abgelaufene Serverzeit', /\(now - .*\) >= 15000/.test(ev['.write']));
}

// ── (9) Online-Football ist ein PRODUKTWEG - mit genau EINEM Netzweg ────────────
// Der Raumtyp ist ab jetzt ohne ?dev=1 erreichbar. Was dabei NICHT entstehen darf, ist
// ein zweiter Netzweg: dieselbe Raumanlage, derselbe Beitritt, dieselbe Rueckkehr,
// dieselbe Lobby. Die beiden Einstiege setzen nur den Kontext davor.
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  t('der lokale Produktweg pinnt Arena Football weiterhin auf online=false',
    src.indexOf("mode=menuMode='football';fmt='single';online=false;") >= 0);
  // Der Football-Raumtyp haengt an EINER Bedingung im Erstellungspfad.
  t('createRoom entscheidet den Raumtyp an genau einer Stelle',
    (src.match(/game:fbo\?ROOM_GAME_FOOTBALL:ROOM_GAME_RINGOUT/g) || []).length === 1);
  t('der Football-Raumtyp haengt an mode und fmt',
    src.indexOf("const fbo=mode==='football'&&fmt===FB_ONLINE_FMT;") >= 0);
  // Die drei frueheren ?dev=1-Sperren sind GEFALLEN - das ist der Zweck dieses Passes.
  // Geprueft wird ihr Verschwinden woertlich, damit eine Rueckkehr auffaellt.
  t('die Raumanlage verlangt kein ?dev=1 mehr',
    src.indexOf("if(mode==='football'&&!DEV_MENU){ setStatus(T('err')); return; }") < 0);
  t('der Beitritt verlangt kein ?dev=1 mehr',
    src.indexOf("if(joinFb&&!DEV_MENU){ setStatus(T('noRoom')); return; }") < 0);
  t('die Rueckkehr verlangt kein ?dev=1 mehr',
    src.indexOf("if(rjFb&&!DEV_MENU){ forgetRoom(); setStatus(T('noRoom')); return false; }") < 0);
  // Aber der Raumtyp selbst bleibt die Weiche: joinRoom und attemptRejoin lesen ihn
  // weiterhin aus der KANONISCHEN Raumkonfiguration, nicht aus dem lokalen Zustand.
  t('der Beitritt erkennt den Football-Raum an der Raumkonfiguration',
    src.indexOf("const joinFb=v.game===ROOM_GAME_FOOTBALL;") >= 0);
  t('die Rueckkehr ebenfalls',
    src.indexOf("const rjFb=roomIsFootball(d.config);") >= 0);
  // ZWEI Einstiege, EIN Kontext, EIN Bildschirm. Der Dev-Einstieg bleibt vollstaendig
  // erhalten und bleibt an ?dev=1 gebunden.
  const KONTEXT = "mode='football'; fbVariant=FOOTBALL_VARIANT_ELIM; fmt=FB_ONLINE_FMT; fbElimStartN=0;";
  t('beide Einstiege setzen woertlich denselben Kontext',
    (src.match(new RegExp(KONTEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 2);
  t('und beide rufen denselben Onlinebildschirm',
    (src.match(/openOnline\(\);/g) || []).length >= 2);
  t('der Dev-Einstieg prueft ?dev=1 weiterhin selbst',
    /\$\('devFbOnlineBtn'\)\.onclick=\(\)=>\{\s*if\(!DEV_MENU\)return;/.test(src));
  t('und das Dev-Panel wird ohne ?dev=1 weiterhin nicht eingeblendet',
    src.indexOf("if(DEV_MENU){$('devPanel').style.display='';$('devFbOnlineSec').style.display='';}") >= 0);
  t('die Dev-Schaltflaeche existiert unveraendert genau einmal',
    (src.match(/devFbOnlineBtn/g) || []).length === 2);
  // Der sichtbare Einstieg liegt jetzt in der Modusauswahl - ohne Entwicklerbegriffe.
  const mm = src.match(/<div class="ov" id="fbModeOv">[\s\S]*?<button class="wbtn" id="fbModeBack">/);
  t('die Modusauswahl fuehrt selbst nach Online',
    !!mm && mm[0].indexOf('fbOnlineBtn') >= 0);
  t('und nennt dabei keinen Entwicklerbegriff',
    !!mm && mm[0].indexOf('devFbOnlineBtn') < 0 && !/DEV|\?dev=1/.test(mm[0]));
  t('der Onlineeinstieg startet kein lokales Match',
    !/startFootball\([^)]*\)[^\n]{0,40}openOnline/.test(src));
  // Und es entsteht KEIN zweites Raumformat, kein zweiter Firebase-Pfad, keine zweite
  // Lobby: die Konstanten des Football-Raums bleiben die bisherigen und stehen je einmal.
  t('es gibt genau ein Football-Raumformat',
    (src.match(/const FB_ONLINE_FMT=/g) || []).length === 1);
  t('und genau eine Sitzzahl dafuer',
    (src.match(/const FB_ONLINE_SEATS=/g) || []).length === 1);
  t('die Lobby ist dieselbe wie fuer die FFA-Familie',
    (src.match(/function renderLobby\(/g) || []).length === 1);
  // Der Auftrag muss VOR dem Warten auf Firebase entstehen. whenFB() verschiebt den
  // Rueckruf; wer in dieser Zeit den Rueckweg nimmt, erhoeht zwar joinOpSeq, kann einen
  // noch nicht erzeugten Auftrag aber nicht entwerten. Der Rueckruf holte sich dann eine
  // frische, "aktuelle" Nummer - und Raum, Praesenz, onDisconnect, Listener und
  // gespeicherte Rueckkehr entstuenden hinter dem Ruecken des Spielers.
  for (const fn of ['createRoom', 'joinRoom']) {
    const body = src.slice(src.indexOf('function ' + fn + '()'));
    const iOp = body.indexOf('const op=newJoinOp();'), iWait = body.indexOf('whenFB(');
    t(fn + ': der Auftrag entsteht VOR dem Warten auf Firebase',
      iOp >= 0 && iWait >= 0 && iOp < iWait);
    t(fn + ': und der Rueckruf prueft ihn als erstes',
      /whenFB\(\(\)=>\{ if\(!joinOpCurrent\(op\)\)return;/.test(body.slice(iWait, iWait + 120)));
  }
  t('es gibt keinen zweiten Auftrag im Rueckruf',
    (src.match(/const op=newJoinOp\(\);/g) || []).length === 3);   // createRoom, joinRoom, attemptRejoin
  // Arena Football verlangt die echte 3D-Szene - an JEDEM Weg in einen Sitz.
  t('der Beitritt lehnt einen Client ohne 3D-Szene ab',
    src.indexOf("if(joinFb&&!r3dActive){ setStatus(T('fbNo3d')); return; }") >= 0);
  t('die Rueckkehr ebenfalls',
    src.indexOf("if(rjFb&&!r3dActive){ setStatus(T('fbNo3d')); return false; }") >= 0);
  t('und der Einstieg benutzt dieselbe Meldung',
    (src.match(/T\('fbNo3d'\)/g) || []).length >= 3);
  t('die es dreisprachig gibt', (src.match(/fbNo3d:'/g) || []).length === 3);
  t('und der Host-Start ebenfalls',
    (src.match(/function startFfaMatch\(/g) || []).length === 1);
}


// ── (9) KEIN GEMISCHTER LOCKSTEP — alle Wege in einen Raum ────────────────────
// Es gibt genau vier Stellen, an denen dieser Client sich an einen fremden Raum bindet,
// und jede prueft die Protokollversion strikt gegen die eigene:
//   validateRoom          Beitritt ueber Raumcode und ueber die oeffentliche Liste
//   validateRejoinRoom    sichtbarer Wiedereintritt und das Angebot beim Seitenstart
//   publicListingView     die oeffentliche Raumliste selbst
//   restorePresencePass   die Wiederverbindung nach einem Verbindungsabriss
// Die ersten drei sind oben an ihren Rueckgabewerten geprueft. Die vierte ist eine
// asynchrone Firebase-Funktion und wird deshalb an ihrer Quelle geprueft.
{
  const restore = html.slice(html.indexOf('async function restorePresencePass'),
                            html.indexOf('async function restorePresencePass') + 1200);
  t('die Wiederverbindung prueft die Version, bevor sie irgendetwas schreibt',
    /if\(v\.v!==ONLINE_PROTOCOL_VERSION\)return 'version';/.test(restore));
  t('und tut das VOR der Eigentumspruefung des Sitzes',
    restore.indexOf("!==ONLINE_PROTOCOL_VERSION") < restore.indexOf('rec.uid!==uid'));

  // Das Vergleichsschreiben: der Sitzclaim traegt die eigene Version mit, damit ein
  // zwischen Pruefung und Claim neu angelegter Raum fremder Version das ganze Update
  // abweist. Beide Claimwege — erster Sitz und Wiedereintritt — muessen es fuehren.
  t('der Sitzclaim traegt die eigene Protokollversion mit',
    (html.match(/upd\['v'\]=ONLINE_PROTOCOL_VERSION;/g) || []).length === 2,
    (html.match(/upd\['v'\]=ONLINE_PROTOCOL_VERSION;/g) || []).length);
  t('und die Rules lassen auf der Raumversion nur ein wertgleiches Schreiben zu',
    /"v": \{ "\.write": "data\.exists\(\) && newData\.exists\(\) && newData\.val\(\) === data\.val\(\)"/.test(RULES));

  // Es gibt genau EINE Stelle, die einen Raum anlegt — beide Produktwege (oeffentlicher
  // Football-Einstieg und Dev-Einstieg) laufen durch sie. Ein zweiter Anlageort koennte
  // eine andere Version schreiben.
  t('genau eine Stelle legt einen Raum an, und sie schreibt die eigene Version',
    (html.match(/v:ONLINE_PROTOCOL_VERSION/g) || []).length === 1);
  t('und keine Stelle schreibt eine feste Versionsnummer',
    !/\bv: ?[0-9]+,/.test(html.slice(html.indexOf('const room={v:ONLINE_PROTOCOL_VERSION'),
                                    html.indexOf('const room={v:ONLINE_PROTOCOL_VERSION') + 400)));

  // Und die Gegenprobe fuer den Beitritt ueber die oeffentliche Liste: ein v4-Raum
  // erscheint dort gar nicht erst.
  const pub = (ver) => ({ v: ver, config: { game: 'ringout', winTarget: 3, fmt: 'ffa',
    visibility: 'public' }, gen: 0, state: 'lobby',
    p: { 0: { s: 'HOSTTAB0', on: true, t: 1 } },
    players: { 0: { id: 'H', name: 'H', tab: 'HOSTTAB0' } }, created: Date.now() });
  t('die oeffentliche Liste zeigt einen Raum der eigenen Version',
    P.publicListingView(pub(P.VER), Date.now()).show === true);
  t('die oeffentliche Liste zeigt keinen v4-Raum',
    P.publicListingView(pub(4), Date.now()).show === false);
  t('und keinen v5-Raum', P.publicListingView(pub(5), Date.now()).show === false);
  t('und raeumt deren Eintraege weg',
    P.publicListingView(pub(4), Date.now()).remove === true &&
    P.publicListingView(pub(5), Date.now()).remove === true);
}

console.log('\nOnline-Protokoll: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
