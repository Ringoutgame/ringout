// Public-Lobby MVP (feature/public-lobby-mvp): focused suite for the two pure
// decision functions extracted from index.html — validateRoom (visibility + v3)
// and publicListingView (which public rooms may be shown / cleaned up). No globals,
// no Firebase: the real functions are extracted and exercised directly, like the
// other offline suites. Rule-level ALLOW/DENY lives in tools/test_rules.js; the
// live query + rule proofs live in the emulator spike (tools/e2e/spike.js).
const { loadIndexHtml, grab } = require('./extract');
const html = loadIndexHtml();
const verSrc = grab(html, /const ONLINE_PROTOCOL_VERSION=[^\n]*/, 'ONLINE_PROTOCOL_VERSION');
const genSrc = grab(html, /const GEN_MAX=[^\n]*/, 'GEN_MAX');
const ffaSrc = grab(html, /const FFA_MAX_SEATS=[^\n]*/, 'FFA_MAX_SEATS');
const ageSrc = grab(html, /const ROOM_MAX_AGE_MS=[^\n]*/, 'ROOM_MAX_AGE_MS');
// Protokoll v4: Raumtyp, Football-Kontrakt und die kanonischen Zugereignisse. Der
// Block kommt WOERTLICH aus index.html; die Validatoren unten fragen ihn ab.
const protoSrc = grab(html, /const ROOM_GAME_RINGOUT=[\s\S]*?\nfunction validateTurnRecord\(rec,game,seat\)\{[\s\S]*?\n\}/, 'Protokoll v4');
// Stufe 2A: die Raumpruefung fragt, ob eine Fassung BEDIENBAR ist.
const fassungSrc = grab(html, /function fbRaumFassungOk\(v\)\{[^\n]*\}/, 'fbRaumFassungOk');
const vrSrc = grab(html, /function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom');
const plvSrc = grab(html, /function publicListingView\(d,now\)\{[\s\S]*?\n\}/, 'publicListingView');
// Join snippets with newlines (never ';') — an extracted line may end in a // comment.
const mod = new Function([verSrc, genSrc, ffaSrc, ageSrc, protoSrc, fassungSrc, vrSrc, plvSrc,
  'return { validateRoom, publicListingView, ONLINE_PROTOCOL_VERSION, ROOM_MAX_AGE_MS };'].join('\n'))();
const { validateRoom, publicListingView, ONLINE_PROTOCOL_VERSION: VER, ROOM_MAX_AGE_MS } = mod;

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// ── validateRoom: visibility is mandatory and exactly 'private' | 'public' ──
const vroom = (over = {}) => Object.assign(
  { v: VER, hostUid: 'UID_HOST_FIXTURE', config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: 'private' }, gen: 0, state: 'lobby',
    p: { 0: { s: 'hosttoken1', on: true, t: 1 } }, created: 1 }, over);
t('validate: visibility private -> ok', validateRoom(vroom()).ok === true);
t('validate: visibility public -> ok', validateRoom(vroom({ config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: 'public' } })).ok === true);
t('validate: visibility missing -> reject', validateRoom(vroom({ config: { game: 'ringout', winTarget: 3, fmt: 'single' } })).ok === false);
t('validate: visibility null -> reject', validateRoom(vroom({ config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: null } })).ok === false);
t('validate: visibility "secret" -> reject', validateRoom(vroom({ config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: 'secret' } })).ok === false);
t('validate: visibility "Public" (case) -> reject', validateRoom(vroom({ config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: 'Public' } })).ok === false);
// Stufe 2A: bedient werden v8 und v9; abgewiesen wird, was darunter liegt.
t('validate: wrong version still rejected first', validateRoom(vroom({ v: 7 })).ok === false);

// ── publicListingView: which public rooms may be shown / cleaned up ──
const NOW = 1751900000000;
const listRoom = (over = {}) => Object.assign(
  { v: VER, config: { game: 'ringout', winTarget: 3, fmt: 'ffa', visibility: 'public' }, gen: 0, state: 'lobby',
    p: { 0: { s: 'h', on: true, t: 1 } }, players: { 0: { id: 'H', name: 'HostA', tab: 'h' } }, created: NOW - 1000 }, over);
const view = (over) => publicListingView(listRoom(over), NOW);

// shown: a valid public ffa lobby with an online host and a free seat
{ const v = view();
  t('show: valid public ffa lobby', v.show === true && v.remove === false);
  t('show: host name surfaced', v.host === 'HostA');
  t('show: mode + capacity (ffa=5)', v.mode === 'ffa' && v.capacity === 5);
  t('show: active counts the online host only', v.active === 1); }
// single/double capacity is 2 real players
{ const v = publicListingView(listRoom({ config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: 'public' } }), NOW);
  t('show: single capacity is 2', v.show === true && v.capacity === 2 && v.active === 1); }
// active counts only on===true (a reserved on:false seat does not count)
{ const v = view({ p: { 0: { s: 'h', on: true, t: 1 }, 1: { s: 'g', on: false, t: 1 } } });
  t('show: reserved (on:false) seat not counted as active', v.show === true && v.active === 1); }
{ const v = view({ p: { 0: { s: 'h', on: true, t: 1 }, 1: { s: 'g', on: true, t: 1 } } });
  t('show: two online seats -> active 2', v.show === true && v.active === 2); }

// remove:true (objectively stale/invalid -> listing may be cleaned up)
t('remove: null room', publicListingView(null, NOW).remove === true);
t('remove: non-object room', publicListingView('x', NOW).remove === true);
t('remove: wrong protocol version', view({ v: 7 }).remove === true && view({ v: 7 }).show === false);
t('remove: private room never listed', view({ config: { game: 'ringout', winTarget: 3, fmt: 'ffa', visibility: 'private' } }).remove === true);
t('remove: missing config', view({ config: undefined }).remove === true);
t('remove: invalid fmt', view({ config: { game: 'ringout', winTarget: 3, fmt: 'triple', visibility: 'public' } }).remove === true);
t('remove: state playing (match running)', view({ state: 'playing' }).remove === true && view({ state: 'playing' }).show === false);
t('remove: created older than 2h', view({ created: NOW - ROOM_MAX_AGE_MS }).remove === true);
t('remove: created just under 2h -> not stale', view({ created: NOW - (ROOM_MAX_AGE_MS - 1000) }).show === true);
t('remove: created not finite', view({ created: undefined }).remove === true);
t('remove: created NaN', view({ created: NaN }).remove === true);

// hidden but NOT removed (transient: may recover)
{ const v = view({ p: { 0: { s: 'h', on: false, t: 1 } } });
  t('hide: host offline -> not shown, not removed (may be reloading)', v.show === false && v.remove === false); }
{ const full = { 0: { s: 'a', on: true, t: 1 }, 1: { s: 'b', on: true, t: 1 }, 2: { s: 'c', on: true, t: 1 }, 3: { s: 'd', on: true, t: 1 }, 4: { s: 'e', on: true, t: 1 } };
  const v = view({ p: full });
  t('hide: full ffa (5 active) -> not shown, not removed', v.show === false && v.remove === false); }
{ const v = publicListingView(listRoom({ config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: 'public' }, p: { 0: { s: 'a', on: true, t: 1 }, 1: { s: 'b', on: true, t: 1 } } }), NOW);
  t('hide: full single (2 active) -> not shown, not removed', v.show === false && v.remove === false); }

// missing host name falls back to empty string (renderer substitutes a label)
{ const v = view({ players: { 0: { id: 'H', name: 42, tab: 'h' } } });
  t('show: non-string host name -> empty (renderer handles fallback)', v.show === true && v.host === ''); }

// purity: frozen input, stable result, no throw
{ const input = listRoom(); Object.freeze(input); Object.freeze(input.config); Object.freeze(input.p);
  const a = publicListingView(input, NOW), b = publicListingView(input, NOW);
  t('pure: frozen input, stable result', JSON.stringify(a) === JSON.stringify(b) && a.show === true); }

// v10: der dynamische Arena-Raum (Lives, Hoechstbesetzung 5) ist auffindbar; aeltere
// Football-Raeume (v8/v9) bleiben unsichtbar, ohne dass ihr Eintrag geraeumt wuerde.
{
  const fbCfg = (over) => Object.assign({ game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'public', mode: 'lives', cap: 5 }, over || {});
  const fb = (v, over) => publicListingView(listRoom(Object.assign({ v, config: fbCfg() }, over || {})), NOW);
  const v10 = fb(10);
  t('show: v10 arena lives lobby is listed', v10.show === true && v10.remove === false);
  t('show: v10 arena capacity is the room maximum (5), mode football', v10.capacity === 5 && v10.active === 1 && v10.mode === 'football');
  const v9 = fb(9, { config: fbCfg({ cap: 3 }) });
  t('hide (keep): v9 football room stays unlisted', v9.show === false && v9.remove === false);
  const v8 = fb(8, { config: fbCfg({ mode: 'classic', cap: 2 }) });
  t('hide (keep): v8 football room stays unlisted', v8.show === false && v8.remove === false);
  const p5 = {}; for (let i = 0; i < 5; i++) p5[i] = { s: 'h' + i, on: true, t: 1 };
  const voll = fb(10, { p: p5 });
  t('hide (keep): full v10 arena lobby', voll.show === false && voll.remove === false);
  const drei = fb(10, { p: { 0: p5[0], 1: p5[1], 2: p5[2] } });
  t('show: v10 arena lobby with 3/5', drei.show === true && drei.active === 3 && drei.capacity === 5);
  const laeuft = fb(10, { state: 'playing', seats: 3 });
  t('remove: started v10 arena room', laeuft.show === false && laeuft.remove === true);
}
// ── PASS 02: eine gemeinsame oeffentliche Lobby fuer beide Spiele ──
{
  const fs2 = require('fs'), path2 = require('path');
  const H = fs2.readFileSync(path2.join(__dirname, '..', 'index.html'), 'utf8');
  // Jede Zeile weiss, welchem Spiel sie gehoert.
  t('view: ringout row carries game=ringout', view().game === 'ringout');
  const fbCfg = { game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'public', mode: 'lives', cap: 5 };
  t('view: v10 arena row carries game=football', publicListingView(listRoom({ v: 10, config: fbCfg }), NOW).game === 'football');
  // Kein Public/Private mehr: der Bildschirm oeffnet oeffentlich, der Schalter ist weg.
  const oo = (H.match(/function openOnline\(\)\{[\s\S]*?\n\}/) || [''])[0];
  t('openOnline defaults createVisibility to public', /createVisibility='public';/.test(oo) && !/createVisibility='private'/.test(oo));
  t('no visibility toggle markup remains', !/id="onVisRow"|id="onVisPub"|id="onVisPriv"|id="onVisGrp"/.test(H));
  t('no visibility toggle handlers remain', !/onVisPriv'\)\.onclick|onVisPub'\)\.onclick/.test(H));
  t('createRoom still snapshots the visibility once (private stays possible internally)', /const visibility = createVisibility==='public' \? 'public' : 'private';/.test(H));
  // Der Bildschirm kennt sein Spiel und filtert danach.
  t('openOnline records the game context', /function openOnline\(\)\{[\s\S]{0,80}onlineKontextMerken\(\);/.test(H));
  const rows = (H.match(/function renderPublicRows\(shown\)\{[\s\S]*?\n\}/) || [''])[0];
  t('the online list is filtered by the current game context', /const spiel=onlineKontextSpiel\(\);/.test(rows) && /shown\.filter\(r=>r\.view\.game===spiel\)/.test(rows));
  t('the home preview shows RingOut rooms only', /shown\.filter\(r=>r\.view\.game===ROOM_GAME_RINGOUT\)/.test(rows));
  t('each row names its game', /game\.textContent=roomGameLabel\(view\.game\);/.test(H) && /function roomGameLabel\(game\)\{ return game===ROOM_GAME_FOOTBALL\?'ARENA FOOTBALL':'RING OUT'; \}/.test(H));
  t('home join opens the online screen of the row\'s own game', /btn\.onclick=fromHome\?\(\)=>\{openOnlineForGame\(view\.game\);joinPublicRoom\(code\);\}/.test(H));
  // Rueckwege in den Bildschirm behalten das Spiel.
  const olc = (H.match(/function onLobbyClosed\(\)\{[\s\S]*?\n\}/) || [''])[0];
  t('onLobbyClosed returns to the same game context', /const k=onlineKontext;[\s\S]*leaveOnline\(\);[\s\S]*onlineZurueckInKontext\(k\);/.test(olc) && !/openOnline\(\);/.test(olc));
  t('"match started without you" returns to the same game context', /const k=onlineKontext; leaveOnline\(\); onlineZurueckInKontext\(k\); setStatus\('Das Match ist ohne dich gestartet/.test(H));
  const zk = (H.match(/function onlineZurueckInKontext\(k\)\{[\s\S]*?\n\}/) || [''])[0];
  t('the context restore never assigns the game literal itself', zk.length > 0 && zk.indexOf("mode='football'") < 0);
  // Texte: jeder neue Schluessel steht in allen drei Sprachtabellen.
  for (const k of ['hostTag', 'fbLobbyHow1', 'fbLobbyHow2', 'createSub', 'joinTitle', 'joinSub', 'pubTitle'])
    t('i18n key ' + k + ' exists in EN/DE/TR', (H.match(new RegExp('\\b' + k + ":'", 'g')) || []).length === 3);
  t('the list is titled OPEN ROOMS', /pubTitle:'OPEN ROOMS'/.test(H) && /pubTitle:'OFFENE RÄUME'/.test(H));
  // Lobby: Hostkennzeichnung und Arena-Hinweis.
  const lob = (H.match(/function renderLobby\(p\)\{[\s\S]*?\n\}/) || [''])[0];
  t('the roster marks the host', /nameForSeat\(s\)\+\(s===hostSeat\(\)\?' · '\+T\('hostTag'\):''\)/.test(lob));
  t('the Arena hint shows only for Football Lives', /infoEl\.style\.display=\(fmt===FB_ONLINE_FMT&&fbLobbyMode\(\)===FB_ONLINE_MODE_LIVES\)\?'':'none';/.test(lob));
  t('the lobby names the 2-5 span for the dynamic room', /fbRaumDynamisch\(\)\?\(FB_DYN_MIN_START\+'–'\+cap\):cap/.test(lob));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
