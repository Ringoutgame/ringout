// ONLINE-PROTOKOLL v4 — reine Schema-/Client-Semantik.
//
// Diese Suite prueft AUSSCHLIESSLICH die pure Vertragsschicht: Protokollversion, Raumtyp,
// Football-Kontrakt, Sitz-/Koerpertrennung und die drei kanonischen Zugereignisse. Die
// serverseitige Durchsetzung liegt in tools/test_rules.js, die Flussfaelle in den
// Online-Harnessen — hier gibt es keine Datenbank, keinen Browser und keine Physik.
//
// Alle Quellen kommen WOERTLICH aus index.html; nichts wird nachgebaut.
//
//   node tools/test_online_protocol_v4.js
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
    validateRoom, validateRejoinRoom
  };
`)();

let pass = 0, fail = 0;
const t = (name, cond, info) => {
  cond ? pass++ : (fail++, console.error('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')));
};

console.log('ONLINE-PROTOKOLL v4 — Schema und kanonische Zugereignisse\n');

// ── (1) Protokollversion ─────────────────────────────────────────────────────────
t('die Protokollversion ist 4', P.VER === 4, P.VER);
t('die Rules verlangen dieselbe Version', /"newData\.val\(\) === 4"/.test(
  require('fs').readFileSync(require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8')));

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
t('ein v5-Raum wird abgelehnt', P.validateRoom(room({ v: 5 })).ok === false);
t('ein Raum ohne Typ wird abgelehnt',
  P.validateRoom(room({ config: { winTarget: 3, fmt: 'single', visibility: 'private' } })).ok === false);
t('Football mit RingOut-Format wird abgelehnt',
  P.validateRoom(room({ config: { game: 'football', winTarget: 3, fmt: 'ffa', visibility: 'private' } })).ok === false);
t('RingOut mit Football-Format wird abgelehnt',
  P.validateRoom(room({ config: { game: 'ringout', winTarget: 3, fmt: 'elimination', visibility: 'private' } })).ok === false);
t('ein unbekannter Typ wird abgelehnt',
  P.validateRoom(room({ config: { game: 'arcade', winTarget: 3, fmt: 'single', visibility: 'private' } })).ok === false);

t('Rejoin: gueltiger RingOut-v4-Raum', P.validateRejoinRoom(room({ state: 'playing' })).ok === true);
// Ein LAUFENDER mehrsitziger Raum traegt seine Teilnehmerzahl im seats-Startsignal.
// Ohne sie waere beim Rejoin unbekannt, welche Sitze zum Match gehoeren - der
// Rueckkehrer wuerde als "ausserhalb der Besetzung" abgewiesen.
t('Rejoin: gueltiger Football-v4-Raum', P.validateRejoinRoom(fbRoom({ state: 'playing', seats: 5 })).ok === true);
t('Rejoin: der Football-Raum meldet fuenf Sitze',
  P.validateRejoinRoom(fbRoom({ state: 'playing', seats: 5 })).seats === 5);
t('Rejoin: laufender Football-Raum OHNE Startsignal wird abgelehnt',
  P.validateRejoinRoom(fbRoom({ state: 'playing' })).ok === false);
t('Rejoin: laufender Football-Raum mit falscher Sitzzahl wird abgelehnt',
  P.validateRejoinRoom(fbRoom({ state: 'playing', seats: 4 })).ok === false);
t('Rejoin: die Football-LOBBY braucht kein Startsignal',
  P.validateRejoinRoom(fbRoom({ state: 'lobby' })).ok === true);
t('Rejoin: v3 wird abgelehnt', P.validateRejoinRoom(room({ v: 3 })).ok === false);
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

// ── (9) Online-Football ist ein DEV-PROTOTYP, kein Produktweg ───────────────────
// Der Raumtyp existiert jetzt auch im Client - aber ausschliesslich hinter ?dev=1.
// Der sichtbare Produktweg in Arena Football bleibt unveraendert lokal.
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  t('der Produktweg pinnt Arena Football weiterhin auf online=false',
    src.indexOf("mode=menuMode='football';fmt='single';online=false;") >= 0);
  // Der Football-Raumtyp haengt an EINER Bedingung im Erstellungspfad, und die haengt
  // am Dev-Kontext. Ohne ihn entsteht wie bisher ein RingOut-Raum.
  t('createRoom entscheidet den Raumtyp an genau einer Stelle',
    (src.match(/game:fbo\?ROOM_GAME_FOOTBALL:ROOM_GAME_RINGOUT/g) || []).length === 1);
  // Ohne ?dev=1 bricht die Raumanlage aus dem Football-Kontext GANZ ab. Ein Rueckfall
  // auf einen RingOut-Raum waere ein Mischzustand: online=true bei mode==='football'.
  t('ohne ?dev=1 bricht createRoom im Football-Kontext ab',
    src.indexOf("if(mode==='football'&&!DEV_MENU){ setStatus(T('err')); return; }") >= 0);
  t('der Football-Raumtyp haengt an mode und fmt',
    src.indexOf("const fbo=mode==='football'&&fmt===FB_ONLINE_FMT;") >= 0);
  // Die Grenze steht an JEDEM Weg in einen Football-Raum, nicht nur am Einstieg:
  // anlegen, beitreten und zurueckkehren.
  t('der Beitritt zu einem Football-Raum verlangt ?dev=1',
    src.indexOf("if(joinFb&&!DEV_MENU){ setStatus(T('noRoom')); return; }") >= 0);
  t('die Rueckkehr in einen Football-Raum verlangt ?dev=1',
    src.indexOf("if(rjFb&&!DEV_MENU){ forgetRoom(); setStatus(T('noRoom')); return false; }") >= 0);
  // Es gibt genau EINEN Einstieg, und er ist zweifach an ?dev=1 gebunden: die
  // Schaltflaeche wird sonst nicht eingeblendet UND der Handler steigt aus.
  t('genau eine Schaltflaeche fuehrt in den Online-Football-Kontext',
    (src.match(/devFbOnlineBtn/g) || []).length === 2);
  t('der Handler prueft ?dev=1 selbst',
    /\$\('devFbOnlineBtn'\)\.onclick=\(\)=>\{\s*if\(!DEV_MENU\)return;/.test(src));
  t('ohne ?dev=1 wird der Einstieg nicht eingeblendet',
    src.indexOf("if(DEV_MENU){$('devPanel').style.display='';$('devFbOnlineSec').style.display='';}") >= 0);
  // Die sichtbare Modusauswahl (Classic/Tactical/Elimination) bleibt frei davon.
  const mm = src.match(/<div class="ov" id="fbModeOv">[\s\S]*?<button class="wbtn" id="fbModeBack">/);
  t('die sichtbare Football-Modusauswahl kennt keinen Online-Eintrag',
    !!mm && mm[0].indexOf('devFbOnlineBtn') < 0 && !/online/i.test(mm[0]));
  t('kein Aufrufer verbindet startFootball mit dem Online-Einstieg',
    !/startFootball\([^)]*\)[^\n]{0,40}openOnline/.test(src));
}

console.log('\nOnline-Protokoll-v4: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
