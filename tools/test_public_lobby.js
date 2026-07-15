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
const vrSrc = grab(html, /function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom');
const plvSrc = grab(html, /function publicListingView\(d,now\)\{[\s\S]*?\n\}/, 'publicListingView');
// Join snippets with newlines (never ';') — an extracted line may end in a // comment.
const mod = new Function([verSrc, genSrc, ffaSrc, ageSrc, vrSrc, plvSrc,
  'return { validateRoom, publicListingView, ONLINE_PROTOCOL_VERSION, ROOM_MAX_AGE_MS };'].join('\n'))();
const { validateRoom, publicListingView, ONLINE_PROTOCOL_VERSION: VER, ROOM_MAX_AGE_MS } = mod;

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// ── validateRoom: visibility is mandatory and exactly 'private' | 'public' ──
const vroom = (over = {}) => Object.assign(
  { v: VER, config: { winTarget: 3, fmt: 'single', visibility: 'private' }, gen: 0, state: 'lobby',
    p: { 0: { s: 'hosttoken1', on: true, t: 1 } }, created: 1 }, over);
t('validate: visibility private -> ok', validateRoom(vroom()).ok === true);
t('validate: visibility public -> ok', validateRoom(vroom({ config: { winTarget: 3, fmt: 'single', visibility: 'public' } })).ok === true);
t('validate: visibility missing -> reject', validateRoom(vroom({ config: { winTarget: 3, fmt: 'single' } })).ok === false);
t('validate: visibility null -> reject', validateRoom(vroom({ config: { winTarget: 3, fmt: 'single', visibility: null } })).ok === false);
t('validate: visibility "secret" -> reject', validateRoom(vroom({ config: { winTarget: 3, fmt: 'single', visibility: 'secret' } })).ok === false);
t('validate: visibility "Public" (case) -> reject', validateRoom(vroom({ config: { winTarget: 3, fmt: 'single', visibility: 'Public' } })).ok === false);
t('validate: wrong version still rejected first', validateRoom(vroom({ v: VER - 1 })).ok === false);

// ── publicListingView: which public rooms may be shown / cleaned up ──
const NOW = 1751900000000;
const listRoom = (over = {}) => Object.assign(
  { v: VER, config: { winTarget: 3, fmt: 'ffa', visibility: 'public' }, gen: 0, state: 'lobby',
    p: { 0: { s: 'h', on: true, t: 1 } }, players: { 0: { id: 'H', name: 'HostA', tab: 'h' } }, created: NOW - 1000 }, over);
const view = (over) => publicListingView(listRoom(over), NOW);

// shown: a valid public ffa lobby with an online host and a free seat
{ const v = view();
  t('show: valid public ffa lobby', v.show === true && v.remove === false);
  t('show: host name surfaced', v.host === 'HostA');
  t('show: mode + capacity (ffa=5)', v.mode === 'ffa' && v.capacity === 5);
  t('show: active counts the online host only', v.active === 1); }
// single/double capacity is 2 real players
{ const v = publicListingView(listRoom({ config: { winTarget: 3, fmt: 'single', visibility: 'public' } }), NOW);
  t('show: single capacity is 2', v.show === true && v.capacity === 2 && v.active === 1); }
// active counts only on===true (a reserved on:false seat does not count)
{ const v = view({ p: { 0: { s: 'h', on: true, t: 1 }, 1: { s: 'g', on: false, t: 1 } } });
  t('show: reserved (on:false) seat not counted as active', v.show === true && v.active === 1); }
{ const v = view({ p: { 0: { s: 'h', on: true, t: 1 }, 1: { s: 'g', on: true, t: 1 } } });
  t('show: two online seats -> active 2', v.show === true && v.active === 2); }

// remove:true (objectively stale/invalid -> listing may be cleaned up)
t('remove: null room', publicListingView(null, NOW).remove === true);
t('remove: non-object room', publicListingView('x', NOW).remove === true);
t('remove: wrong protocol version', view({ v: VER - 1 }).remove === true && view({ v: VER - 1 }).show === false);
t('remove: private room never listed', view({ config: { winTarget: 3, fmt: 'ffa', visibility: 'private' } }).remove === true);
t('remove: missing config', view({ config: undefined }).remove === true);
t('remove: invalid fmt', view({ config: { winTarget: 3, fmt: 'triple', visibility: 'public' } }).remove === true);
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
{ const v = publicListingView(listRoom({ config: { winTarget: 3, fmt: 'single', visibility: 'public' }, p: { 0: { s: 'a', on: true, t: 1 }, 1: { s: 'b', on: true, t: 1 } } }), NOW);
  t('hide: full single (2 active) -> not shown, not removed', v.show === false && v.remove === false); }

// missing host name falls back to empty string (renderer substitutes a label)
{ const v = view({ players: { 0: { id: 'H', name: 42, tab: 'h' } } });
  t('show: non-string host name -> empty (renderer handles fallback)', v.show === true && v.host === ''); }

// purity: frozen input, stable result, no throw
{ const input = listRoom(); Object.freeze(input); Object.freeze(input.config); Object.freeze(input.p);
  const a = publicListingView(input, NOW), b = publicListingView(input, NOW);
  t('pure: frozen input, stable result', JSON.stringify(a) === JSON.stringify(b) && a.show === true); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
