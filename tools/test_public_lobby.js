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
const vrSrc = grab(html, /function validateRoom\(d,jetzt\)\{[\s\S]*?\n\}/, 'validateRoom');
const plvSrc = grab(html, /function publicListingView\(d,now\)\{[\s\S]*?\n\}/, 'publicListingView');
// 01B: welche Fassungen der Auffindbarkeits-Index ueberhaupt fuehren darf. Das
// Modusregister (FB_ONLINE_MODES, fbModeDef, fbModeReleased) steckt bereits im
// Protokollblock darueber - ein zweites Mal deklariert waere es ein Fehler.
const listbarSrc = grab(html, /function roomListable\(v\)\{[^\n]*}/, 'roomListable');
// Join snippets with newlines (never ';') — an extracted line may end in a // comment.
const mod = new Function([verSrc, genSrc, ffaSrc, ageSrc, protoSrc, fassungSrc,
  listbarSrc, vrSrc, plvSrc,
  'return { validateRoom, publicListingView, roomListable, ONLINE_PROTOCOL_VERSION, ROOM_MAX_AGE_MS };'].join('\n'))();
const { validateRoom, publicListingView, roomListable, ONLINE_PROTOCOL_VERSION: VER, ROOM_MAX_AGE_MS } = mod;

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

// 01B: ein Arena-Raum erscheint, wenn sein MODUS spielbar ist - nicht, wenn seine
// Protokollfassung zufaellig eine bestimmte Zahl traegt. Daneben steht, was der Index
// ueberhaupt fuehren darf: v9 gehoert nicht dazu (so sagen es auch die Rules).
{
  const fbCfg = (over) => Object.assign({ game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'public', mode: 'lives', cap: 5 }, over || {});
  const fb = (v, over) => publicListingView(listRoom(Object.assign({ v, config: fbCfg() }, over || {})), NOW);
  const fbM = (v, cfgOver, over) => publicListingView(listRoom(Object.assign({ v, config: fbCfg(cfgOver) }, over || {})), NOW);
  // Welche Fassungen der Index fuehren darf - dieselbe Menge wie in den Rules.
  for (const v of [4, 5, 6, 7, 8, 10, 11]) t('listbar: Fassung ' + v, roomListable(v) === true);
  for (const v of [0, 3, 9, 12, null, undefined, '10']) t('nicht listbar: Fassung ' + JSON.stringify(v), roomListable(v) === false);
  const v10 = fb(10);
  t('show: v10 arena lives lobby is listed', v10.show === true && v10.remove === false);
  const v11 = fb(11);
  t('show: der bleibende v11-Arena-Raum ist ebenso auffindbar', v11.show === true && v11.remove === false);
  t('show: die Zeile traegt den MODUS des Raums, nicht das Spiel',
    v11.mode === 'lives' && v11.football === true && v10.mode === 'lives');
  t('show: capacity is the room maximum (5)', v10.capacity === 5 && v10.active === 1 && v11.capacity === 5);
  const v9 = fb(9, { config: fbCfg({ cap: 3 }) });
  t('hide (keep): v9 football room stays unlisted', v9.show === false && v9.remove === false);
  // Ein GESPERRTER Modus bleibt unsichtbar - in jeder Fassung.
  const gesperrt8 = fbM(8, { mode: 'classic', cap: 2 });
  t('hide (keep): ein gesperrter Modus bleibt unsichtbar (v8)', gesperrt8.show === false && gesperrt8.remove === false);
  const gesperrt11 = fbM(11, { mode: 'team2v2', cap: 4 });
  t('hide (keep): ... und auch in v11', gesperrt11.show === false && gesperrt11.remove === false);
  const unbekannt = fbM(11, { mode: 'zirkus', cap: 5 });
  t('hide (keep): ein unbekannter Modus erst recht', unbekannt.show === false && unbekannt.remove === false);
  const p5 = {}; for (let i = 0; i < 5; i++) p5[i] = { s: 'h' + i, on: true, t: 1 };
  const voll = fb(10, { p: p5 });
  t('hide (keep): full arena lobby', voll.show === false && voll.remove === false);
  const drei = fb(10, { p: { 0: p5[0], 1: p5[1], 2: p5[2] } });
  t('show: arena lobby with 3/5', drei.show === true && drei.active === 3 && drei.capacity === 5);
  const laeuft = fb(10, { state: 'playing', seats: 3 });
  t('remove: started arena room', laeuft.show === false && laeuft.remove === true);
  const laeuft11 = fb(11, { state: 'playing' });
  t('remove: ein laufendes v11-Match wird nicht als offener Raum angeboten',
    laeuft11.show === false && laeuft11.remove === true);
  // v11: der Raum ueberlebt seinen Gruender. Sitz 0 darf dauerhaft leer sein.
  const ohneNull = fb(11, { p: { 2: { s: 'h2', on: true, t: 1 }, 4: { s: 'h4', on: true, t: 1 } },
                            players: { 2: { id: 'P2', name: 'Memo', tab: 'h2', uid: 'U2' }, 4: { id: 'P4', name: 'Ali', tab: 'h4', uid: 'U4' } },
                            hostUid: 'U2' });
  t('show: ein v11-Raum ohne Sitz 0 bleibt auffindbar', ohneNull.show === true && ohneNull.active === 2);
  t('show: ... und nennt den AKTUELLEN Wirt', ohneNull.host === 'Memo');
  const nachWechsel = fb(11, { p: { 2: { s: 'h2', on: true, t: 1 }, 4: { s: 'h4', on: true, t: 1 } },
                               players: { 2: { id: 'P2', name: 'Memo', tab: 'h2', uid: 'U2' }, 4: { id: 'P4', name: 'Ali', tab: 'h4', uid: 'U4' } },
                               hostUid: 'U4' });
  t('show: wandert die Rolle, wandert der Name mit', nachWechsel.host === 'Ali');
  // Bis v10 bleibt es dabei: ohne Sitz 0 gibt es den Raum nicht mehr.
  const zehnOhneNull = fb(10, { p: { 1: { s: 'h1', on: true, t: 1 } } });
  t('hide (keep): ein v10-Raum ohne Sitz 0 verschwindet wie bisher',
    zehnOhneNull.show === false && zehnOhneNull.remove === false);
}
// 01B: die kuenftigen Modi. Sie sind gesperrt und duerfen deshalb NICHT erscheinen -
// aber die Normalisierung darunter muss sie schon heute richtig behandeln, sonst waere
// die Seite doch wieder auf FFA gebaut. Geprueft wird mit einer Kopie des Registers,
// in der sie freigegeben sind: die Belegung kommt aus der Konfiguration des Raums, die
// Beschriftung aus dem Sprachregister des Modus.
{
  const fs3 = require('fs'), path3 = require('path');
  const H3 = fs3.readFileSync(path3.join(__dirname, '..', 'index.html'), 'utf8');
  const g = (re, n) => grab(H3, re, n);
  // Die Freigabe wird IM Protokollblock gesetzt - dort steht das Register, und zwei
  // Register nebeneinander gaebe es im Produkt auch nicht.
  const protoFrei = protoSrc.replace(/released:false/g, 'released:true');
  const mod2 = new Function([verSrc, genSrc, ffaSrc, ageSrc, protoFrei, fassungSrc,
    listbarSrc, plvSrc,
    'return { publicListingView };'].join('\n'))();
  const cfgVon = (mode, cap) => ({ game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'public', mode: mode, cap: cap });
  const sitze = (n) => { const p = {}; for (let i = 0; i < n; i++) p[i] = { s: 'h' + i, on: true, t: 1 }; return p; };
  const fall = (mode, cap, da) => mod2.publicListingView(listRoom({ v: 11, config: cfgVon(mode, cap), p: sitze(da) }), NOW);
  const ffa = fall('lives', 5, 3);
  t('generisch: ein FFA-Raum meldet 3/5 und den Modus lives', ffa.show === true && ffa.active === 3 && ffa.capacity === 5 && ffa.mode === 'lives');
  const tac = fall('classic', 2, 1);
  t('generisch: ein 1v1-Raum meldet 1/2 - die Kapazitaet kommt aus dem Raum', tac.show === true && tac.active === 1 && tac.capacity === 2 && tac.mode === 'classic');
  const tacVoll = fall('classic', 2, 2);
  t('generisch: ... und bei 2/2 ist er nicht mehr beitretbar', tacVoll.show === false && tacVoll.remove === false);
  const team = fall('team2v2', 4, 3);
  t('generisch: ein Team-Raum meldet 3/4', team.show === true && team.active === 3 && team.capacity === 4 && team.mode === 'team2v2');
  const teamVoll = fall('team2v2', 4, 4);
  t('generisch: ... und bei 4/4 nicht mehr', teamVoll.show === false && teamVoll.remove === false);
  // Und die Gegenprobe: mit dem ECHTEN Register bleiben genau diese Raeume unsichtbar.
  t('gesperrt: derselbe 1v1-Raum erscheint im Produkt nicht',
    publicListingView(listRoom({ v: 11, config: cfgVon('classic', 2), p: sitze(1) }), NOW).show === false);
  t('gesperrt: derselbe Team-Raum ebenso wenig',
    publicListingView(listRoom({ v: 11, config: cfgVon('team2v2', 4), p: sitze(3) }), NOW).show === false);
}
// ── PASS 02: eine gemeinsame oeffentliche Lobby fuer beide Spiele ──
{
  const fs2 = require('fs'), path2 = require('path');
  const H = fs2.readFileSync(path2.join(__dirname, '..', 'index.html'), 'utf8');
  // Jede Zeile weiss, welchem Spiel sie gehoert.
  t('view: ringout row carries game=ringout', view().game === 'ringout');
  const fbCfg = { game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'public', mode: 'lives', cap: 5 };
  t('view: v10 arena row carries game=football', publicListingView(listRoom({ v: 10, config: fbCfg }), NOW).game === 'football');
  // 01B: die Arena-Startseite ist das dritte Ziel derselben Quelle.
  t('die Arena-Startseite hat einen Abschnitt fuer offene Raeume',
    /id="fbRooms" class="fbOnly"/.test(H) && /id="fbRoomsList"/.test(H) && /id="fbRoomsState"/.test(H));
  t('er traegt die vorhandene Ueberschrift, keine zweite Zeichenkette',
    /\$\('secFbRoomsT'\)\.textContent=T\('pubTitle'\);/.test(H));
  t('er ist nur im Arena-Kontext sichtbar',
    /\.fbOnly{display:none}/.test(H) && /body\.fbctx \.fbOnly{display:block}/.test(H));
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
  t('die Arena-Startseite zeigt alle Arena-Raeume - gefiltert wird nach dem SPIEL',
    /const fuerFb=shown\.filter\(r=>r\.view\.game===ROOM_GAME_FOOTBALL\);/.test(rows));
  t('… und sie bekommt ihren eigenen Leerzustand',
    /const fs=\$\('fbRoomsState'\); if\(fs\)fs\.textContent=fuerFb\.length\?'':T\('pubEmpty'\);/.test(rows));
  t('EINE Quelle, drei Ziele - kein zweiter Listener',
    (H.match(/window\.FB\.onValue\(q,/g) || []).length === 1
    && /for\(const id of \['onPublicList','homeRoomsList','fbRoomsList'\]\)/.test(H));
  t('each row names its game', /game\.textContent=roomGameLabel\(view\.game\);/.test(H) && /function roomGameLabel\(game\)\{ return game===ROOM_GAME_FOOTBALL\?'ARENA FOOTBALL':'RING OUT'; \}/.test(H));
  t('der Beitritt aus einer Vorschau oeffnet den Bildschirm des RAUMS',
    /if\(ausDemMenue\)openOnlineForRoom\(view\);\n    joinPublicRoom\(code\);/.test(H)
    && /if\(view\.game===ROOM_GAME_FOOTBALL&&!\(await r3dSichern\(\)\)\)\{toast\(T\('fbNo3d'\)\);return;\}/.test(H));
  t('… und behaelt dabei den Modus des Raums, nicht FFA',
    /fbOnlineMode=\(typeof fbModeValid==='function'&&fbModeValid\(view\.mode\){2}\?view\.mode:FB_ONLINE_MODE_LIVES;/.test(H));
  t('die Beschriftung kommt aus EINER Stelle',
    /function roomModeLabel\(view\)\{/.test(H)
    && /meta\.textContent=roomModeLabel\(view\)\+' · '\+view\.active\+'\/'\+view\.capacity;/.test(H));
  t('der Beitrittsknopf nennt, wohin er fuehrt', /btn\.setAttribute\('aria-label',/.test(H));
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
