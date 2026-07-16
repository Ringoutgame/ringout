// M8-T3a/T3c client tests — extracts the REAL validateRoom/pickFreeSeat/
// allAliveCommitted/seatCount/seatsContiguous/startFfaMatch from index.html:
//   (1) single/double validation now shares the unified room-state (join only
//       while state==='lobby'),
//   (2) the ffa schema validation (state/lobby, seats, full),
//   (3) seat picking 0-4 incl. gaps,
//   (4) the N-player reveal helper (eliminated players don't count),
//   (5) start gate: >=2 players, no seat gaps (no auto-compacting in v1),
//   (6) host start writes state='playing' THEN seats=n (sequential order).
//   node test_ffa_online.js
const { loadIndexHtml, grab } = require('./extract');
const html = loadIndexHtml();
const verSrc = grab(html, /const ONLINE_PROTOCOL_VERSION=[^\n]*/, 'ONLINE_PROTOCOL_VERSION');
const seatsSrc = grab(html, /const FFA_MAX_SEATS=[^\n]*/, 'FFA_MAX_SEATS');
const genSrc = grab(html, /const GEN_MAX=[^\n]*/, 'GEN_MAX');
const vrSrc = grab(html, /function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom');
const pfsSrc = grab(html, /function pickFreeSeat\(p,max\)\{[^\n]*/, 'pickFreeSeat');
const aacSrc = grab(html, /function allAliveCommitted\(\)\{[^\n]*/, 'allAliveCommitted');
const saSrc = grab(html, /function seatActive\(p,s\)\{[^\n]*/, 'seatActive');
const scSrc = grab(html, /function seatCount\(p\)\{[^\n]*/, 'seatCount');
const sgSrc = grab(html, /function seatsContiguous\(p,n\)\{[^\n]*/, 'seatsContiguous');
const sfmSrc = grab(html, /function startFfaMatch\(\)\{[\s\S]*?\n\}/, 'startFfaMatch');

// Each snippet on its own line: an extracted const may end in a // comment,
// which only a line break (absent on Linux/LF) terminates — never chain with ';'.
const VER = new Function(`${verSrc}\nreturn ONLINE_PROTOCOL_VERSION;`)();   // fixtures follow the real protocol version
const env = new Function(`
  ${verSrc}
  ${seatsSrc}
  ${genSrc}
  ${vrSrc}
  ${pfsSrc}
  let mode='ffa', ffaN=3, fmt='ffa', balls=[], aimSet=[];   // fmt: startFfaMatch-Gate (triple_ffa braucht exakt 3)
  function np(){return mode==='ffa'?ffaN:2;}
  function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
  ${aacSrc}
  ${saSrc}
  ${scSrc}
  ${sgSrc}
  // startFfaMatch runs against stubbed lobby UI + a write-recording fake FB
  let lobbyP={};
  // Public-Lobby: startFfaMatch best-effort removes the discovery listing on start.
  // Private rooms (roomPublic=false) skip it entirely — stub keeps the branch inert.
  let roomPublic=false, roomCode='';
  function removePublicListing(){}
  const writes=[], toasts=[];
  const btn={disabled:false};
  const $=()=>btn;                                   // touches only lobbyStart
  const toast=m=>toasts.push(m);
  const setStatus=m=>toasts.push('status:'+m);
  const rRef=p=>p;
  const window={FB:{set:async(p,v)=>{writes.push(p+'='+v);}}};
  ${sfmSrc}
  return { validateRoom, pickFreeSeat, seatCount, seatsContiguous,
    aac(m,n,bs,as){mode=m;ffaN=n;balls=bs;aimSet=as;return allAliveCommitted();},
    async start(p,f){writes.length=0;toasts.length=0;btn.disabled=false;lobbyP=p;fmt=f||'ffa';
      startFfaMatch();await new Promise(r=>setTimeout(r,0));
      return {writes:writes.slice(),toasts:toasts.slice(),disabled:btn.disabled};} };
`)();

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
// v3: p/<seat> = {s,on,t}. These pure-function unit tests only need the field
// seatActive()/validateRoom() actually read (on); s/t are irrelevant here (the
// rules — not the client — enforce their shape, see test_rules.js).
const room = (over = {}) => Object.assign(
  { v: VER, config: { winTarget: 3, fmt: 'single', visibility: 'private' }, gen: 0, state: 'lobby', p: { 0: { on: true } }, created: 1 }, over);
const ffaRoom = (over = {}) => Object.assign(
  { v: VER, config: { winTarget: 3, fmt: 'ffa', visibility: 'private' }, gen: 0, state: 'lobby', p: { 0: { on: true } }, created: 1 }, over);

// ── (1) single/double: unified room-state, join only while state==='lobby' ──
t('single valid', env.validateRoom(room()).ok === true);
t('double valid', env.validateRoom(room({ config: { winTarget: 5, fmt: 'double', visibility: 'private' } })).ok === true);
t('single full rejected', env.validateRoom(room({ p: { 0: { on: true }, 1: true } })).reason === 'Raum ist schon voll.');
t('orphan rejected', env.validateRoom(room({ p: {} })).reason === 'Raum ist verwaist.');
t('host reserved but not active rejected', env.validateRoom(room({ p: { 0: { on: false } } })).reason === 'Raum ist verwaist.');
t('fmt triple rejected', env.validateRoom(room({ config: { winTarget: 3, fmt: 'triple' } })).ok === false);
t('single state=playing rejected (match läuft)', env.validateRoom(room({ state: 'playing' })).reason === 'Match läuft bereits.');
t('single state missing rejected', (() => { const r = room(); delete r.state; return env.validateRoom(r).reason === 'Match läuft bereits.'; })());
t('single has no freeSeat', env.validateRoom(room()).freeSeat === undefined);

// ── (2) ffa vorbereitet ──
t('ffa lobby valid -> seat 1', (() => { const v = env.validateRoom(ffaRoom()); return v.ok === true && v.freeSeat === 1 && v.fmt === 'ffa'; })());
t('ffa state playing rejected', env.validateRoom(ffaRoom({ state: 'playing' })).reason === 'Match läuft bereits.');
t('ffa state missing rejected', (() => { const r = ffaRoom(); delete r.state; return env.validateRoom(r).reason === 'Match läuft bereits.'; })());
t('ffa full (5 seats) rejected', env.validateRoom(ffaRoom({ p: { 0: { on: true }, 1: true, 2: true, 3: true, 4: true } })).reason === 'Raum ist schon voll.');
t('ffa gap -> lowest free seat 2', env.validateRoom(ffaRoom({ p: { 0: { on: true }, 1: true, 3: true } })).freeSeat === 2);
t('ffa orphan rejected', env.validateRoom(ffaRoom({ p: { 1: true } })).reason === 'Raum ist verwaist.');
t('ffa wrong version rejected', env.validateRoom(ffaRoom({ v: 99 })).ok === false);

// ── (3) pickFreeSeat 0-4 ──
t('pfs host only -> 1', env.pickFreeSeat({ 0: true }, 5) === 1);
t('pfs gap -> 2', env.pickFreeSeat({ 0: true, 1: true, 3: true, 4: true }, 5) === 2);
t('pfs full -> -1', env.pickFreeSeat({ 0: true, 1: true, 2: true, 3: true, 4: true }, 5) === -1);
t('pfs null map -> 1', env.pickFreeSeat(null, 5) === 1);
t('pfs firebase array form', env.pickFreeSeat([true, true], 5) === 2);

// ── (4) allAliveCommitted ──
const B = (o, alive = true) => ({ owner: o, alive });
t('aac all alive committed', env.aac('ffa', 3, [B(0), B(1), B(2)], [true, true, true]) === true);
t('aac one alive missing', env.aac('ffa', 3, [B(0), B(1), B(2)], [true, false, true]) === false);
t('aac eliminated not counted', env.aac('ffa', 3, [B(0), B(1, false), B(2)], [true, false, true]) === true);
t('aac 5p two eliminated', env.aac('ffa', 5, [B(0), B(1, false), B(2), B(3, false), B(4)], [true, false, true, false, true]) === true);
t('aac 5p alive seat missing', env.aac('ffa', 5, [B(0), B(1, false), B(2), B(3), B(4)], [true, false, true, false, true]) === false);
t('aac 2p mode like 1v1 both', env.aac('online', 2, [B(0), B(1)], [true, true]) === true);
t('aac 2p mode like 1v1 waiting', env.aac('online', 2, [B(0), B(1)], [true, false]) === false);

// ── (5) seatCount / seatsContiguous (Start-Gate, kein Auto-Nachruecken) ──
// v3: "belegt" = on===true; ein reserviertes aber nicht aktives Presence-Objekt
// (on:false) zaehlt bewusst nicht mit.
const A = { on: true };   // minimal active-seat fixture
t('sc host only', env.seatCount({ 0: A }) === 1);
t('sc three', env.seatCount({ 0: A, 1: A, 2: A }) === 3);
t('sc gap counts occupied', env.seatCount({ 0: A, 2: A }) === 2);
t('sc reserved-not-active does not count', env.seatCount({ 0: A, 1: { on: false } }) === 1);
t('sc firebase array form', env.seatCount([A, A]) === 2);
t('sc null', env.seatCount(null) === 0);
t('sg 0..1 contiguous', env.seatsContiguous({ 0: A, 1: A }, 2) === true);
t('sg gap at 1', env.seatsContiguous({ 0: A, 2: A }, 2) === false);
t('sg full 5', env.seatsContiguous({ 0: A, 1: A, 2: A, 3: A, 4: A }, 5) === true);
t('sg gap at 3 of 4', env.seatsContiguous({ 0: A, 1: A, 2: A, 4: A }, 4) === false);
t('sg firebase array form', env.seatsContiguous([A, A, A], 3) === true);
t('sg reserved-not-active is a gap', env.seatsContiguous({ 0: A, 1: { on: false } }, 2) === false);

// ── (6) startFfaMatch: Gates + sequenzielle state->seats Schreibfolge ──
(async () => {
  let r = await env.start({ 0: A });
  t('start alone blocked', r.writes.length === 0 && r.toasts[0] === 'Mindestens 2 Spieler nötig.');
  r = await env.start({ 0: A, 2: A });
  t('start with gap blocked', r.writes.length === 0 && r.toasts[0] === 'Warte auf freien Sitz / Spieler soll neu beitreten.');
  r = await env.start({ 0: A, 1: A });
  t('start 2p writes state then seats', r.writes.join('|') === 'state=playing|seats=2' && r.disabled === true);
  r = await env.start({ 0: A, 1: A, 2: A, 3: A, 4: A });
  t('start 5p seats=5', r.writes.join('|') === 'state=playing|seats=5');

  // ── (7) triple_ffa: validateRoom-Schema + Start-Gate exakt 3 Spieler ──
  const tripleRoom = (over = {}) => Object.assign(
    { v: VER, config: { winTarget: 3, fmt: 'triple_ffa', visibility: 'private' }, gen: 0, state: 'lobby', p: { 0: { on: true } }, created: 1 }, over);
  t('triple lobby valid -> seat 1', (() => { const v = env.validateRoom(tripleRoom()); return v.ok === true && v.freeSeat === 1 && v.fmt === 'triple_ffa'; })());
  t('triple full (3 seats) rejected', env.validateRoom(tripleRoom({ p: { 0: { on: true }, 1: true, 2: true } })).reason === 'Raum ist schon voll.');
  t('triple state playing rejected', env.validateRoom(tripleRoom({ state: 'playing' })).reason === 'Match läuft bereits.');
  t('triple gap -> lowest free seat 2', env.validateRoom(tripleRoom({ p: { 0: { on: true }, 1: true } })).freeSeat === 2);
  r = await env.start({ 0: A, 1: A }, 'triple_ffa');
  t('triple start with 2 blocked', r.writes.length === 0 && r.toasts[0] === 'TRIPLE FFA braucht genau 3 Spieler.');
  r = await env.start({ 0: A, 1: A, 2: A }, 'triple_ffa');
  t('triple start 3p writes state then seats=3', r.writes.join('|') === 'state=playing|seats=3' && r.disabled === true);
  // aac mit 2 Kugeln pro Owner: Seat mit 1 Restkugel zaehlt weiter, Seat ohne Kugeln nicht
  t('aac triple all committed', env.aac('ffa', 3, [B(0), B(1), B(2), B(0), B(1), B(2)], [true, true, true]) === true);
  t('aac triple one-ball seat still counts', env.aac('ffa', 3, [B(0), B(1), B(2), B(0, false), B(1), B(2)], [false, true, true]) === false);
  t('aac triple eliminated (both balls) not counted', env.aac('ffa', 3, [B(0, false), B(1), B(2), B(0, false), B(1), B(2)], [false, true, true]) === true);

  console.log('\nFFA-Online-Prep: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
