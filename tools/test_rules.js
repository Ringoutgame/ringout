// Local rules verification: loads the REAL firebase.rules.json and evaluates its
// rule strings (a JS-compatible subset of the RTDB rules language) against
// concrete write scenarios — BEFORE publishing.
// Semantics modeled: .write cascade (any true .write on the path grants),
// .validate on the written node and all written children, deletes skip
// .validate, newData = post-write merged tree (supports parent()).
// NOT modeled: multi-location updates (approximated by sequential writes) — the
// ATOMIC p+players coupling, the sentinel-move+e coupling and the two-parallel-
// claim arbiter are proven against the real emulator in tools/e2e/spike.js.
//   node test_rules.js
const fs = require('fs');
const RULES_PATH = process.env.RULES_PATH || require('path').join(__dirname, '..', 'firebase.rules.json');
const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')).rules;

// ── snapshot resolved lazily from a value tree, so parent() works (used for
//    data = pre-write tree and newData = post-write merged tree alike) ──
class NSnap {
  constructor(tree, path) { this._t = tree; this._p = path; }
  _v() {
    let c = this._t;
    for (const k of this._p) { c = (c && typeof c === 'object' && c[k] !== undefined) ? c[k] : null; if (c === null) break; }
    return (c === undefined ? null : c);
  }
  exists() { const v = this._v(); if (v === null) return false; if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false; return true; }
  val() { return this._v(); }
  isNumber() { return typeof this._v() === 'number'; }
  isString() { return typeof this._v() === 'string'; }
  isBoolean() { return typeof this._v() === 'boolean'; }
  child(p) { return new NSnap(this._t, this._p.concat(String(p).split('/'))); }
  parent() { return new NSnap(this._t, this._p.slice(0, -1)); }
  hasChildren(ks) { return this.exists() && ks.every(k => this.child(k).exists()); }
}

// rules language helpers
Object.defineProperty(String.prototype, 'matches', { value: function (re) { return re.test(this); }, configurable: true });
function evalRule(rule, ctx) {
  if (rule === true || rule === false) return rule;
  const names = Object.keys(ctx);
  return !!new Function(...names, 'return (' + rule + ');')(...names.map(n => ctx[n]));
}

const getPath = (tree, segs) => { let c = tree; for (const k of segs) { c = (c && typeof c === 'object' && c[k] !== undefined) ? c[k] : null; if (c === null) break; } return c; };
function setPath(tree, segs, v) {
  let c = tree;
  for (let i = 0; i < segs.length - 1; i++) { if (!c[segs[i]] || typeof c[segs[i]] !== 'object') c[segs[i]] = {}; c = c[segs[i]]; }
  if (v === null) delete c[segs[segs.length - 1]]; else c[segs[segs.length - 1]] = v;
}
function ruleChild(rn, key) {
  if (Object.prototype.hasOwnProperty.call(rn, key)) return { node: rn[key], wild: null };
  const wk = Object.keys(rn).find(k => k.startsWith('$'));
  return wk ? { node: rn[wk], wild: wk } : null;
}

const NOW = 1751900000000;
// attempts a single-path write against the loaded rules; returns true if allowed
function tryWrite(db, path, value) {
  const segs = path.split('/');
  const post = JSON.parse(JSON.stringify(db));
  setPath(post, segs, value);
  const ctxAt = (i, vars) => ({ data: new NSnap(db, segs.slice(0, i)), newData: new NSnap(post, segs.slice(0, i)), root: new NSnap(db, []), now: NOW, ...vars });
  // .write cascade along the path (root .. target)
  let rn = rules, granted = false, vars = {};
  for (let i = 0; i <= segs.length && rn; i++) {
    if (rn['.write'] !== undefined && !granted) granted = evalRule(rn['.write'], ctxAt(i, vars));
    if (i < segs.length) { const r = ruleChild(rn, segs[i]); if (r) { if (r.wild) vars = { ...vars, [r.wild]: segs[i] }; rn = r.node; } else rn = undefined; }
  }
  if (!granted) return false;
  if (value === null) return true;               // deletes skip .validate
  // .validate on the written node and every written descendant
  const validateAt = (node, s, vv) => {
    const val = getPath(post, s);
    if (val === null) return true;
    if (node['.validate'] !== undefined && !evalRule(node['.validate'], { data: new NSnap(db, s), newData: new NSnap(post, s), root: new NSnap(db, []), now: NOW, ...vv })) return false;
    if (val && typeof val === 'object') {
      for (const k of Object.keys(val)) {
        const r = ruleChild(node, k);
        if (!r) continue;
        if (!validateAt(r.node, s.concat(k), r.wild ? { ...vv, [r.wild]: k } : vv)) return false;
      }
    }
    return true;
  };
  return rn ? validateAt(rn, segs, vars) : true;
}

// ── fixtures (Presence & Reconnect v3: p/<seat> = {s, on, t}) ──
const V = 3;
const GRACE = 15000;
const H_TAB = 'HOSTTAB0', G_TAB = 'GTAB0001', G2_TAB = 'GTAB0002';
// Durable roster records; players/<seat>.tab MUST equal p/<seat>.s (coupling).
const HOST = { id: 'HOST0000', name: 'Host', tab: H_TAB };
const REC = (id, tab) => ({ id: id || 'GUEST001', name: 'G', tab: tab || G_TAB });
// Presence object. t must equal `now` on any real write; fixtures may pre-seed
// an older t to model a seat that has been offline for a while.
const P = (s, on, t) => ({ s, on: !!on, t: (t === undefined ? NOW : t) });
// Unified room-state: EVERY mode is created with state:'lobby' and an OFFLINE
// host presence (p/0.on === false) — the host ACTIVATEs right after create.
const mkRoom = (fmt, over = {}) => Object.assign(
  { v: V, config: { winTarget: 3, fmt, visibility: 'private' }, gen: 0, state: 'lobby', p: { 0: P(H_TAB, false) }, players: { 0: HOST }, created: NOW },
  over);
const db1 = (roomOver = {}, fmt = 'single') => ({ rooms: { KX7P: mkRoom(fmt, Object.assign({ created: NOW - 5000 }, roomOver)) } });
const MOVE = { idx: 0, dx: 100, dy: -50, sp: 0.5 };

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const allow = (name, db, path, v) => t('[ALLOW] ' + name, tryWrite(db, path, v) === true);
const deny = (name, db, path, v) => t('[DENY]  ' + name, tryWrite(db, path, v) === false);

// ── (1) room creation — v3 object presence, offline host, atomic identity ──
allow('create single', { rooms: {} }, 'rooms/KX7P', mkRoom('single'));
allow('create double', { rooms: {} }, 'rooms/KX7P', mkRoom('double', { config: { winTarget: 5, fmt: 'double', visibility: 'private' } }));
allow('create ffa', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa'));
deny('create v1 (old protocol)', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { v: 1 }));
deny('create fmt triple', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { config: { winTarget: 3, fmt: 'triple' } }));
deny('create p/0 boolean (old presence schema)', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { p: { 0: true } }));
deny('create p/0 on:true (Empty->on:true forbidden at create)', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { p: { 0: P(H_TAB, true) } }));
deny('create p/0 missing t', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { p: { 0: { s: H_TAB, on: false } } }));
deny('create coupling mismatch (players/0.tab != p/0.s)', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { players: { 0: { id: 'HOST0000', name: 'Host', tab: G_TAB } } }));
deny('create WITHOUT state', { rooms: {} }, 'rooms/KX7P', (() => { const r = mkRoom('single'); delete r.state; return r; })());
deny('create state=playing', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { state: 'playing' }));
deny('create WITH seats', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { seats: 2 }));
deny('create WITH g prefilled', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { g: { 0: { t: { 0: { 0: MOVE } } } } }));
deny('create WITH p/1 prefilled', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa', { p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }));
deny('create WITH players/1 prefilled', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa', { players: { 0: HOST, 1: REC() } }));
deny('create WITHOUT players/0', { rooms: {} }, 'rooms/KX7P', (() => { const r = mkRoom('single'); delete r.players; return r; })());
deny('create bad code charset', { rooms: {} }, 'rooms/AAA0', mkRoom('single'));
deny('overwrite existing room', db1(), 'rooms/KX7P', mkRoom('single'));

// ── (2) RESERVE — join is ATOMIC (p + players together): an isolated p-create
//        WITHOUT the coupled players leg is rejected. The allowed atomic join is a
//        multi-path write, proven in tools/e2e/spike.js. ──
deny('isolated p/1 RESERVE without players leg (atomic coupling)', db1(), 'rooms/KX7P/p/1', P(G_TAB, false));
deny('isolated p/2 RESERVE without players leg (ffa)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }, 'ffa'), 'rooms/KX7P/p/2', P(G2_TAB, false));
deny('RESERVE p/1 with on:true (no Empty->on:true)', db1(), 'rooms/KX7P/p/1', P(G_TAB, true));
deny('RESERVE p/1 in PLAYING (guests locked out)', db1({ state: 'playing', p: { 0: P(H_TAB, true) } }), 'rooms/KX7P/p/1', P(G_TAB, false));
deny('RESERVE seat 2 in single (seat guard)', db1(), 'rooms/KX7P/p/2', P(G2_TAB, false));
deny('RESERVE seat 5 (out of range)', db1({}, 'ffa'), 'rooms/KX7P/p/5', P(G2_TAB, false));
deny('RESERVE bad token charset', db1(), 'rooms/KX7P/p/1', { s: 'bad tok!', on: false, t: NOW });
deny('RESERVE t not now (planted timestamp)', db1(), 'rooms/KX7P/p/1', { s: G_TAB, on: false, t: NOW - 1 });
deny('RESERVE join after 2h window', db1({ created: NOW - 7200001 }), 'rooms/KX7P/p/1', P(G_TAB, false));
deny('RESERVE re-claim occupied seat before grace (write-once)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }), 'rooms/KX7P/p/1', P(G2_TAB, false));

// ── (3) ARM — same token, on:false -> on:false, refreshes t only ──
allow('ARM p/1 (same token, t refresh)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false, NOW - 3000) } }), 'rooms/KX7P/p/1', P(G_TAB, false));
deny('ARM foreign token before grace', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false, NOW - 3000) } }), 'rooms/KX7P/p/1', P(G2_TAB, false));

// ── (4) ACTIVATE — same token, on:false -> on:true. For seat 1 in single/double an
//        isolated ACTIVATE is DENY: on:true may only be reached atomically together
//        with state lobby->playing (Fund 1). The coupled ACTIVATE+start is a
//        multi-path write proven in tools/e2e/spike.js. FFA seats and the host still
//        activate independently, without any state transition. ──
deny('isolated ACTIVATE p/1 single lobby (must couple state:playing)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false) } }), 'rooms/KX7P/p/1', P(G_TAB, true));
deny('isolated ACTIVATE p/1 double lobby (must couple state:playing)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false) } }, 'double'), 'rooms/KX7P/p/1', P(G_TAB, true));
allow('ACTIVATE p/1 ffa lobby (independent, no state coupling)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false) }, players: { 0: HOST, 1: REC('GUEST001', G_TAB) } }, 'ffa'), 'rooms/KX7P/p/1', P(G_TAB, true));
allow('ACTIVATE p/1 during playing (reconnect flip, single)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, false) }, players: { 0: HOST, 1: REC('GUEST001', G_TAB) } }), 'rooms/KX7P/p/1', P(G_TAB, true));
allow('ACTIVATE host p/0 (self, lobby)', db1(), 'rooms/KX7P/p/0', P(H_TAB, true));
deny('ACTIVATE foreign token', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false) } }, 'ffa'), 'rooms/KX7P/p/1', P(G2_TAB, true));
deny('ACTIVATE from already on:true (no-op online write)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, 'ffa'), 'rooms/KX7P/p/1', P(G_TAB, true));
// e is pre-seeded here only to assert the ACTIVATE branch still honours the e-guard;
// no client can actually write e while Fund 2 is deferred (see section 11).
deny('ACTIVATE with e pre-seeded (e-guard, playing)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) }, g: { 0: { e: { 1: true } } } }, 'ffa'), 'rooms/KX7P/p/1', P(G_TAB, true));

// ── (5) DISCONNECT — same token, on:true -> on:false, s frozen ──
allow('DISCONNECT p/1 (same token)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/p/1', P(G_TAB, false));
deny('DISCONNECT foreign token', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/p/1', P(G2_TAB, false));
// isolated on-flip via a leaf write (no fresh t) is rejected — on and t must move
// together (leaf writes bypass the t child validate, so the .write t===now guard
// is what closes it). Seat carries a stale t so the unchanged t !== now.
deny('isolated on flip without fresh t (leaf write)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true, NOW - 3000) } }), 'rooms/KX7P/p/1/on', false);
allow('presence delete p/1 (roster already gone)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/p/1', null);
// leg deletes are atomic: deleting one leg while the other remains is rejected
// (the allowed atomic p+players delete is a multi-path write, proven in the spike).
deny('isolated host p/0 delete while roster present (coupling)', db1(), 'rooms/KX7P/p/0', null);
deny('isolated p/1 delete while players/1 present (coupling)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) }, players: { 0: HOST, 1: REC('GUEST001', G_TAB) } }), 'rooms/KX7P/p/1', null);

// ── (6) players roster — coupling, creation only by presence holder ──
allow('players/1 create by presence holder (lobby)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }), 'rooms/KX7P/players/1', REC('GUEST001', G_TAB));
deny('players/1 create WITHOUT presence (isolated players leg)', db1(), 'rooms/KX7P/players/1', REC('GUEST001', G_TAB));
deny('players/1 create coupling mismatch (tab != p/1.s)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }), 'rooms/KX7P/players/1', REC('GUEST001', G2_TAB));
deny('players/1 create while PLAYING (id steal mid-match)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/players/1', REC('GUEST001', G_TAB));
allow('players/1 same-id update (name change)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) }, players: { 0: HOST, 1: { id: 'GUEST001', name: 'old', tab: G_TAB } } }), 'rooms/KX7P/players/1', { id: 'GUEST001', name: 'Neu', tab: G_TAB });
deny('players/1 id switch before grace (immutable)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) }, players: { 0: HOST, 1: { id: 'GUEST001', name: 'x', tab: G_TAB } } }), 'rooms/KX7P/players/1', REC('EVIL0001', G_TAB));
deny('players/1 delete while presence held', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) }, players: { 0: HOST, 1: REC('GUEST001', G_TAB) } }), 'rooms/KX7P/players/1', null);
allow('players/1 delete after presence gone', db1({ p: { 0: P(H_TAB, false) }, players: { 0: HOST, 1: REC('GUEST001', G_TAB) } }), 'rooms/KX7P/players/1', null);
deny('players/1 name too long (>48)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }), 'rooms/KX7P/players/1', { id: 'GUEST001', name: 'x'.repeat(49), tab: G_TAB });
deny('players/1 extra field', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }), 'rooms/KX7P/players/1', { id: 'GUEST001', name: 'g', tab: G_TAB, hack: 1 });
deny('players seat 2 in single (seat guard)', db1({ p: { 0: P(H_TAB, false), 2: P(G2_TAB, false) } }), 'rooms/KX7P/players/2', REC('GUEST002', G2_TAB));

// ── (7) recycling — lobby only, offline seat, now-t >= 15s; ID mutable only here ──
deny('recycle p/1 before grace (foreign token)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false, NOW - 3000) } }), 'rooms/KX7P/p/1', P(G2_TAB, false));
allow('recycle p/1 after grace (roster already cleared)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false, NOW - 16000) } }), 'rooms/KX7P/p/1', P(G2_TAB, false));
deny('recycle p/1 alone rejected while roster still bound (coupling forces atomic)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false, NOW - 16000) }, players: { 0: HOST, 1: REC('GUEST001', G_TAB) } }), 'rooms/KX7P/p/1', P(G2_TAB, false));
// recycling a seat to a new identity requires a FULL joint token rotation: the new
// players.tab must differ from the old AND must equal the freshly rotated p.s. Neither
// single-leg form is valid on its own (Fund 3) — the atomic both-leg rotation is proven
// in tools/e2e/spike.js. An id switch that keeps the old token, or rotates the token on
// the players leg alone without the coupled p.s rotation, is rejected.
deny('recycle players/1 id switch WITHOUT token rotation (tab unchanged)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false, NOW - 16000) }, players: { 0: HOST, 1: { id: 'GUEST001', name: 'x', tab: G_TAB } } }), 'rooms/KX7P/players/1', REC('NEW00001', G_TAB));
deny('recycle players/1 id+tab switch WITHOUT coupled p.s rotation (single-leg)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false, NOW - 16000) }, players: { 0: HOST, 1: { id: 'GUEST001', name: 'x', tab: G_TAB } } }), 'rooms/KX7P/players/1', REC('NEW00001', 'GTAB0009'));
deny('recycle players/1 id switch while seat still online', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, true, NOW - 16000) }, players: { 0: HOST, 1: { id: 'GUEST001', name: 'x', tab: G_TAB } } }), 'rooms/KX7P/players/1', REC('NEW00001', G_TAB));
deny('recycle players/1 id switch in PLAYING (lobby only)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) }, players: { 0: HOST, 1: { id: 'GUEST001', name: 'x', tab: G_TAB } } }), 'rooms/KX7P/players/1', REC('NEW00001', G_TAB));

// ── (8) state start — 1v1/2v2 ACTIVATE needs an online, unchanged host + p/1 ──
allow('start: lobby->playing (host online + p/1 online)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/state', 'playing');
allow('ffa start: lobby->playing (host online + p/1 online)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, 'ffa'), 'rooms/KX7P/state', 'playing');
deny('start blocked: host offline', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, true) } }), 'rooms/KX7P/state', 'playing');
deny('start blocked: no p/1', db1({ p: { 0: P(H_TAB, true) } }), 'rooms/KX7P/state', 'playing');
deny('start blocked: p/1 offline', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false) } }), 'rooms/KX7P/state', 'playing');
deny('re-write lobby over lobby', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/state', 'lobby');
deny('playing->lobby rollback', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/state', 'lobby');
deny('state garbage value', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/state', 'x');

// ── (8b) match reconnect — new session token rotates p.s + players.tab TOGETHER,
//        same player id, only from on:false in playing, e !== true. The allowed
//        atomic rotation is a multi-path write proven in the spike; here we assert
//        the single-leg rotations that must be rejected. ──
deny('reconnect rotate p/1.s alone without players.tab (coupling)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 3000) }, players: { 0: HOST, 1: REC('GUEST001', G_TAB) } }), 'rooms/KX7P/p/1', { s: 'GTAB0009', on: false, t: NOW });
deny('reconnect p/1 s-rotation while ONLINE (must be on:false)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) }, players: { 0: HOST, 1: REC('GUEST001', G_TAB) } }), 'rooms/KX7P/p/1', { s: 'GTAB0009', on: true, t: NOW });
deny('reconnect p/1 s-rotation in lobby (playing only)', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 3000) }, players: { 0: HOST, 1: REC('GUEST001', G_TAB) } }), 'rooms/KX7P/p/1', { s: 'GTAB0009', on: false, t: NOW });

// ── (9) gen + seats regression ──
allow('gen increment 0->1', db1(), 'rooms/KX7P/gen', 1);
deny('gen jump 0->5', db1(), 'rooms/KX7P/gen', 5);
allow('ffa seats=3 after start', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) } }, 'ffa'), 'rooms/KX7P/seats', 3);
allow('ffa seats=2 (min)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, 'ffa'), 'rooms/KX7P/seats', 2);
allow('ffa seats=5 (max)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, 'ffa'), 'rooms/KX7P/seats', 5);
deny('ffa seats=6', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, 'ffa'), 'rooms/KX7P/seats', 6);
deny('ffa seats=1', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, 'ffa'), 'rooms/KX7P/seats', 1);
deny('seats while still lobby', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, 'ffa'), 'rooms/KX7P/seats', 2);
deny('seats rewrite (write-once)', db1({ state: 'playing', seats: 2, p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, 'ffa'), 'rooms/KX7P/seats', 3);
deny('seats in single (ffa only)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/seats', 2);

// ── (10) moves — only when p/<seat>.on === true and e !== true; write-once ──
const playing = (pOver, fmt) => db1(Object.assign({ state: 'playing' }, pOver), fmt);
allow('move p0 (online)', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/t/0/0', MOVE);
allow('move p1 (online, bounds edge)', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/t/0/1', { idx: 1, dx: -195, dy: 195, sp: -1 });
deny('move p0 while offline (on:false)', playing({ p: { 0: P(H_TAB, false), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/t/0/0', MOVE);
deny('move p0 after elimination (e latched)', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) }, g: { 0: { e: { 0: true } } } }), 'rooms/KX7P/g/0/t/0/0', MOVE);
deny('move write-once', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) }, g: { 0: { t: { 0: { 0: MOVE } } } } }), 'rooms/KX7P/g/0/t/0/0', MOVE);
deny('move wrong gen', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/5/t/0/0', MOVE);
deny('move dx out of bounds', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 196, dy: 0, sp: 0 });
deny('move extra field', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 0, dy: 0, sp: 0, hack: 1 });
deny('move pl 2 in single', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/t/0/2', MOVE);
deny('move idx 4 in single', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/t/0/0', { idx: 4, dx: 0, dy: 0, sp: 0 });
const ffaMatch = playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true), 3: P('GTAB0003', true), 4: P('GTAB0004', true) }, seats: 5 }, 'ffa');
allow('ffa move pl 4', ffaMatch, 'rooms/KX7P/g/0/t/0/4', { idx: 4, dx: 10, dy: 10, sp: 0 });
deny('ffa move pl 5', ffaMatch, 'rooms/KX7P/g/0/t/0/5', MOVE);
deny('ffa move idx 5', ffaMatch, 'rooms/KX7P/g/0/t/0/0', { idx: 5, dx: 0, dy: 0, sp: 0 });
// Disconnect leave-sentinel is DEFERRED (Fund 2): the grace-sentinel branch is
// removed, so an offline seat's slot can no longer be filled by anyone — neither a
// real move (the seat is offline) nor a zero "sentinel". The turn stalls on a
// disconnect by design until the authoritative turn-pointer package lands.
deny('real move for offline seat (grace-sentinel deferred)', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) } }), 'rooms/KX7P/g/0/t/0/1', MOVE);
deny('zero leave-sentinel for offline seat past grace (deferred)', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) } }), 'rooms/KX7P/g/0/t/0/1', { idx: 1, dx: 0, dy: 0, sp: 0 });
deny('zero leave-sentinel for fully-absent seat (deferred, no anchor)', playing({ p: { 0: P(H_TAB, true) } }, 'ffa'), 'rooms/KX7P/g/0/t/0/1', { idx: 1, dx: 0, dy: 0, sp: 0 });
deny('move for eliminated seat (e pre-seeded)', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) }, g: { 0: { e: { 1: true } } } }), 'rooms/KX7P/g/0/t/1/1', MOVE);

// ── (10b) Online-Zeitgeber: Phasenstempel g/<gen>/t/<turn>/s + atomarer Zug-ts ──
// Der Phasenstempel ist die einzige Startzeitquelle der Online-Uhr: write-once und
// exakt Serverzeit (newData.val() === now). Der Commit-Zeitpunkt reist ATOMAR im
// Zugobjekt selbst (Feld ts, ebenfalls === now) — Slot und Serverzeit koennen nie
// getrennt erscheinen. Ein Client kann weder Deadline noch Zugzeit faelschen.
const twoOn = { p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } };
const stamped = (dt, over) => playing(Object.assign({ g: { 0: Object.assign({ t: Object.assign({ 0: { s: NOW - dt } }, (over && over.t) || {}) } ) } }, twoOn));
const stampedWith = (dt, slots) => playing(Object.assign({ g: { 0: { t: Object.assign({ 0: Object.assign({ s: NOW - dt }, slots) }) } } }, twoOn));
allow('clock: Phasenstempel mit Serverzeit', playing(twoOn), 'rooms/KX7P/g/0/t/0/s', NOW);
deny('clock: Phasenstempel vordatiert', playing(twoOn), 'rooms/KX7P/g/0/t/0/s', NOW - 5000);
deny('clock: Phasenstempel in der Zukunft', playing(twoOn), 'rooms/KX7P/g/0/t/0/s', NOW + 5000);
deny('clock: Phasenstempel write-once', stamped(1000), 'rooms/KX7P/g/0/t/0/s', NOW);
deny('clock: Phasenstempel in fremder Generation', playing(twoOn), 'rooms/KX7P/g/5/t/0/s', NOW);
deny('clock: Phasenstempel vor Matchstart (Lobby)', db1(twoOn), 'rooms/KX7P/g/0/t/0/s', NOW);

// Atomarer Zug: bei aktiver Uhr (Stempel vorhanden) ist ts PFLICHT und exakt now;
// ohne Stempel gilt unveraendert das v3-Schema (und ts ist dort verboten).
const MOVETS = Object.assign({ ts: NOW }, MOVE);
allow('clock: Zug mit atomarem Serverzeit-ts', stamped(3000), 'rooms/KX7P/g/0/t/0/0', MOVETS);
deny('clock: Zug OHNE ts bei aktiver Uhr abgewiesen', stamped(3000), 'rooms/KX7P/g/0/t/0/0', MOVE);
deny('clock: ts vordatiert (gefaelschte Zugzeit)', stamped(3000), 'rooms/KX7P/g/0/t/0/0', Object.assign({}, MOVE, { ts: NOW - 2000 }));
deny('clock: ts in der Zukunft', stamped(3000), 'rooms/KX7P/g/0/t/0/0', Object.assign({}, MOVE, { ts: NOW + 2000 }));
deny('clock: ts kein Zahlenwert', stamped(3000), 'rooms/KX7P/g/0/t/0/0', Object.assign({}, MOVE, { ts: 'x' }));
deny('clock: ts ohne aktive Uhr verboten (v3-Schema)', playing(twoOn), 'rooms/KX7P/g/0/t/0/0', MOVETS);
allow('clock: ohne Phasenstempel bleibt v3-Verhalten unveraendert', playing(twoOn), 'rooms/KX7P/g/0/t/0/0', MOVE);

// 9A: Die fruehere 7-Sekunden-Schreibdeadline ("bis zur Deadline jeder Zug,
// danach NUR No-Shot") ist ENTFERNT. Sie stammte aus der Online-Zugzeit-Aera;
// seit 6d6dffc gilt TURN_TIMER_ENABLED=false fuer alle Modi, es gibt keinen
// 7s-Autostand mehr — die Klausel haette ansonsten gueltige spaete Zuege
// abgelehnt. Der Phasenstempel s und der atomare Serverzeit-ts bleiben als
// Schema-/Zeitwahrheit vollstaendig erhalten (oben geprueft); entfernt ist
// AUSSCHLIESSLICH das zeitbasierte Schreibverbot echter Zuege.
const NOSHOT = { idx: 1, dx: 0, dy: 0, sp: 0, ts: NOW };
allow('clock: echter Zug frueh im Zug', stamped(3000), 'rooms/KX7P/g/0/t/0/0', MOVETS);
allow('clock: echter Zug bei 7s', stamped(7000), 'rooms/KX7P/g/0/t/0/0', MOVETS);
allow('9A: echter Zug NACH 7s wird nicht mehr allein wegen der Zeit abgelehnt', stamped(7001), 'rooms/KX7P/g/0/t/0/0', MOVETS);
allow('9A: echter Zug auch sehr spaet gueltig (keine Zeitklausel mehr)', stamped(600000), 'rooms/KX7P/g/0/t/0/0', MOVETS);
allow('clock: No-Shot spaet weiterhin erlaubt', stamped(7001), 'rooms/KX7P/g/0/t/0/1', NOSHOT);
// BESTANDSGRENZE (unveraendert): v3 kennt keine Authentifizierung — die Rules
// konnten einen fremden Zug in einen LEEREN Slot noch nie vom eigenen
// unterscheiden (darauf beruht der Leave-Sentinel). Mit dem Wegfall der
// Deadline gilt fuer spaete Zuege wieder exakt dieselbe Grenze wie fuer
// fruehe — es entsteht keine NEUE Faehigkeitsklasse; die Schutzwirkung
// "nach 7s nur No-Shot" entfaellt ersatzlos, weil es die 7s-Deadline im
// Produkt nicht mehr gibt.
allow('clock: Stand frueh bleibt erlaubt (v3-Bestand, Stand-Button)', stamped(3000), 'rooms/KX7P/g/0/t/0/1', NOSHOT);
allow('clock: Slot bleibt write-once geschuetzt (erster gewinnt)', stamped(7001), 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 0, dy: 0, sp: 0, ts: NOW });
deny('clock: bestaetigter Zug wird nie ueberschrieben (write-once, zeitunabhaengig)',
  stampedWith(7001, { 0: MOVETS }), 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 0, dy: 0, sp: 0, ts: NOW });
// Ein isolierter Kind-Write auf t/<turn>/<seat>/ts (Vorstempeln ohne Zug) scheitert an
// der $pl-.validate (hasChildren idx/dx/dy/sp/ts). Die lokale Mock-Engine wertet
// Ancestor-Validates bei Kind-Writes nicht aus — dieser Fall wird deshalb gegen den
// ECHTEN RTDB-Emulator geprueft (siehe Emulator-Protokoll im Abschlussbericht).

// ── (11) elimination latch g/<gen>/e/<seat> — DEFERRED (Fund 2). Until the
//        authoritative turn-pointer lands (later match-reconnect package), EVERY
//        write to e is rejected: no grace path, no Slot-belegt e-only, nothing. The
//        turn-agnostic rule cannot distinguish an empty from an occupied move slot,
//        so the whole latch is kept shut rather than shipped half-safe. ──
deny('e latch after grace (offline seat) — deferred', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) } }), 'rooms/KX7P/g/0/e/1', true);
deny('e latch for fully-absent seat — deferred (no anchor)', playing({ p: { 0: P(H_TAB, true) } }, 'ffa'), 'rooms/KX7P/g/0/e/1', true);
deny('e latch with occupied move slot — deferred', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) }, g: { 0: { t: { 0: { 1: MOVE } } } } }), 'rooms/KX7P/g/0/e/1', true);
deny('e latch while seat online — deferred', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/e/1', true);
deny('e latch before grace — deferred', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 3000) } }), 'rooms/KX7P/g/0/e/1', true);
deny('e latch in lobby — deferred', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) } }), 'rooms/KX7P/g/0/e/1', true);
deny('e latch value not true — deferred', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) } }), 'rooms/KX7P/g/0/e/1', false);

// ── (12) room delete — only when NO p and NO players anchor remains ──
deny('room delete blocked: p anchor present', db1(), 'rooms/KX7P', null);
deny('room delete blocked: players anchor present (p empty)', db1({ p: {} }), 'rooms/KX7P', null);
allow('room delete when fully empty (no p, no players)', db1({ p: {}, players: {} }), 'rooms/KX7P', null);
deny('room delete non-existent', { rooms: {} }, 'rooms/KX7P', null);

// ── (13) config.visibility — mandatory, exactly 'private' | 'public' ──
deny('create room WITHOUT visibility', { rooms: {} }, 'rooms/KX7P', (() => { const r = mkRoom('single'); r.config = { winTarget: 3, fmt: 'single' }; return r; })());
deny('create room bad visibility value', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { config: { winTarget: 3, fmt: 'single', visibility: 'secret' } }));
allow('create room visibility public', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { config: { winTarget: 3, fmt: 'single', visibility: 'public' } }));

// ── (14) publicRooms discovery index — write-once create, stale-only delete ──
// A listable public room: v3, config.visibility 'public', state 'lobby', host online,
// younger than 2h. The listing itself is exactly { created: now } — nothing else.
const PUB_ROOM = (over = {}) => mkRoom('ffa', Object.assign({ created: NOW - 5000, config: { winTarget: 3, fmt: 'ffa', visibility: 'public' }, p: { 0: P(H_TAB, true) } }, over));
const pubDb = (roomOver = {}, listing = undefined) => { const db = { rooms: { KX7P: PUB_ROOM(roomOver) }, publicRooms: {} }; if (listing !== undefined) db.publicRooms.KX7P = listing; return db; };
const LISTING = { created: NOW };

// create (write-once) — only for a valid, live, public lobby room
allow('pub create: valid public lobby room', pubDb(), 'publicRooms/KX7P', LISTING);
deny('pub create: private room never indexable', pubDb({ config: { winTarget: 3, fmt: 'ffa', visibility: 'private' } }), 'publicRooms/KX7P', LISTING);
deny('pub create: wrong protocol version', pubDb({ v: 2 }), 'publicRooms/KX7P', LISTING);
deny('pub create: match already running (state playing)', pubDb({ state: 'playing' }), 'publicRooms/KX7P', LISTING);
deny('pub create: host offline', pubDb({ p: { 0: P(H_TAB, false) } }), 'publicRooms/KX7P', LISTING);
deny('pub create: room older than 2h', pubDb({ created: NOW - 7200001 }), 'publicRooms/KX7P', LISTING);
deny('pub create: no backing room', { rooms: {}, publicRooms: {} }, 'publicRooms/KX7P', LISTING);
deny('pub create: created not now (planted timestamp)', pubDb(), 'publicRooms/KX7P', { created: NOW - 1 });
deny('pub create: extra field beyond created', pubDb(), 'publicRooms/KX7P', { created: NOW, name: 'x' });
deny('pub create: bad code charset', pubDb(), 'publicRooms/AAA0', LISTING);

// update existing listing (write-once — every update rejected)
deny('pub update rejected (write-once)', pubDb({}, LISTING), 'publicRooms/KX7P', { created: NOW });

// delete — allowed ONLY for an objectively stale/invalid room
allow('pub stale delete: backing room gone', { rooms: {}, publicRooms: { KX7P: LISTING } }, 'publicRooms/KX7P', null);
allow('pub stale delete: match running', pubDb({ state: 'playing' }, LISTING), 'publicRooms/KX7P', null);
allow('pub stale delete: room older than 2h', pubDb({ created: NOW - 7200001 }, LISTING), 'publicRooms/KX7P', null);
allow('pub stale delete: room no longer public', pubDb({ config: { winTarget: 3, fmt: 'ffa', visibility: 'private' } }, LISTING), 'publicRooms/KX7P', null);
deny('pub delete blocked: room still open (public lobby, host online)', pubDb({}, LISTING), 'publicRooms/KX7P', null);
deny('pub delete blocked: host offline is transient (not stale)', pubDb({ p: { 0: P(H_TAB, false) } }, LISTING), 'publicRooms/KX7P', null);
// deliberate host leave: BOTH host anchors (p/0 AND players/0) gone -> stale -> deletable
allow('pub stale delete: both host anchors gone (deliberate host leave)', pubDb({ p: {}, players: {} }, LISTING), 'publicRooms/KX7P', null);
deny('pub delete blocked: only p/0 gone (players/0 remains -> not a leave)', pubDb({ p: {} }, LISTING), 'publicRooms/KX7P', null);
deny('pub delete blocked: only players/0 gone (p/0 remains -> not a leave)', pubDb({ players: {} }, LISTING), 'publicRooms/KX7P', null);

// ── (15) triple_ffa — additive v3 format: seats 0-2 only, seats === 3, idx 0-5.
//        Ball OWNERSHIP (idx belongs to the committing seat) is deliberately NOT a
//        rules concern (same as ffa, where a foreign idx is the leave-sentinel) —
//        it is enforced client-side by sanitizeMove (tools/test_sanitize.js). ──
const G3_TAB = 'GTAB0003';
allow('triple create room', { rooms: {} }, 'rooms/KX7P', mkRoom('triple_ffa'));
allow('triple players/2 create by presence holder (lobby)', db1({ p: { 0: P(H_TAB, false), 2: P(G2_TAB, false) } }, 'triple_ffa'), 'rooms/KX7P/players/2', REC('GUEST002', G2_TAB));
allow('triple ACTIVATE p/2 (lobby, independent)', db1({ p: { 0: P(H_TAB, true), 2: P(G2_TAB, false) }, players: { 0: HOST, 2: REC('GUEST002', G2_TAB) } }, 'triple_ffa'), 'rooms/KX7P/p/2', P(G2_TAB, true));
allow('triple start: lobby->playing', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) } }, 'triple_ffa'), 'rooms/KX7P/state', 'playing');
allow('triple seats=3 after start', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) } }, 'triple_ffa'), 'rooms/KX7P/seats', 3);
deny('triple seats=2', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) } }, 'triple_ffa'), 'rooms/KX7P/seats', 2);
deny('triple seats=4', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) } }, 'triple_ffa'), 'rooms/KX7P/seats', 4);
deny('triple seats while still lobby', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) } }, 'triple_ffa'), 'rooms/KX7P/seats', 3);
const tripleMatch = playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) }, seats: 3 }, 'triple_ffa');
allow('triple move pl 0 idx 0', tripleMatch, 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 10, dy: 10, sp: 0 });
allow('triple move pl 0 idx 3 (own second ball)', tripleMatch, 'rooms/KX7P/g/0/t/0/0', { idx: 3, dx: 10, dy: 10, sp: 0 });
allow('triple move pl 1 idx 4', tripleMatch, 'rooms/KX7P/g/0/t/0/1', { idx: 4, dx: 10, dy: 10, sp: 0 });
allow('triple move pl 2 idx 5', tripleMatch, 'rooms/KX7P/g/0/t/0/2', { idx: 5, dx: 10, dy: 10, sp: 0 });
deny('triple move idx 6 (out of range)', tripleMatch, 'rooms/KX7P/g/0/t/0/0', { idx: 6, dx: 0, dy: 0, sp: 0 });
deny('triple move pl 3 (seat gate, presence pre-seeded)', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true), 3: P(G3_TAB, true) }, seats: 3 }, 'triple_ffa'), 'rooms/KX7P/g/0/t/0/3', MOVE);
deny('triple RESERVE seat 3 (seat gate)', db1({}, 'triple_ffa'), 'rooms/KX7P/p/3', P(G3_TAB, false));
deny('triple ACTIVATE p/3 (seat gate, pre-seeded)', db1({ p: { 0: P(H_TAB, true), 3: P(G3_TAB, false) }, players: { 0: HOST, 3: REC('GUEST003', G3_TAB) } }, 'triple_ffa'), 'rooms/KX7P/p/3', P(G3_TAB, true));
deny('triple players/3 create (seat gate)', db1({ p: { 0: P(H_TAB, false), 3: P(G3_TAB, false) } }, 'triple_ffa'), 'rooms/KX7P/players/3', REC('GUEST003', G3_TAB));
deny('triple players/4 create (seat gate)', db1({ p: { 0: P(H_TAB, false), 4: P('GTAB0004', false) } }, 'triple_ffa'), 'rooms/KX7P/players/4', REC('GUEST004', 'GTAB0004'));
deny('idx 5 in single', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/t/0/0', { idx: 5, dx: 0, dy: 0, sp: 0 });
deny('idx 5 in ffa (unchanged)', ffaMatch, 'rooms/KX7P/g/0/t/0/1', { idx: 5, dx: 0, dy: 0, sp: 0 });

// ── (16) team_duel — additive v3 format: seats 0-3 only, seats === 4, idx 0-3.
//        Ball OWNERSHIP (idx belongs to the committing seat) is deliberately NOT a
//        rules concern (same as ffa — a foreign idx is the leave-sentinel);
//        determinism is enforced client-side via sanitizeMove + processSlot. ──
const G4_TAB = 'GTAB0004';
allow('team create room', { rooms: {} }, 'rooms/KX7P', mkRoom('team_duel'));
allow('team seats=4 after start', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true), 3: P(G3_TAB, true) } }, 'team_duel'), 'rooms/KX7P/seats', 4);
deny('team seats=2', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true), 3: P(G3_TAB, true) } }, 'team_duel'), 'rooms/KX7P/seats', 2);
deny('team seats=3', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true), 3: P(G3_TAB, true) } }, 'team_duel'), 'rooms/KX7P/seats', 3);
deny('team seats=5', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true), 3: P(G3_TAB, true) } }, 'team_duel'), 'rooms/KX7P/seats', 5);
deny('team seats while still lobby', db1({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true), 3: P(G3_TAB, true) } }, 'team_duel'), 'rooms/KX7P/seats', 4);
allow('team ACTIVATE p/2 in lobby (pre-seeded)', db1({ p: { 0: P(H_TAB, true), 2: P(G2_TAB, false) }, players: { 0: HOST, 2: REC('GUEST002', G2_TAB) } }, 'team_duel'), 'rooms/KX7P/p/2', P(G2_TAB, true));
allow('team ACTIVATE p/3 in lobby (pre-seeded)', db1({ p: { 0: P(H_TAB, true), 3: P(G3_TAB, false) }, players: { 0: HOST, 3: REC('GUEST003', G3_TAB) } }, 'team_duel'), 'rooms/KX7P/p/3', P(G3_TAB, true));
deny('team RESERVE seat 4 (seat gate)', db1({}, 'team_duel'), 'rooms/KX7P/p/4', P(G4_TAB, false));
deny('team ACTIVATE p/4 (seat gate, pre-seeded)', db1({ p: { 0: P(H_TAB, true), 4: P(G4_TAB, false) }, players: { 0: HOST, 4: REC('GUEST004', G4_TAB) } }, 'team_duel'), 'rooms/KX7P/p/4', P(G4_TAB, true));
deny('team players/4 create (seat gate)', db1({ p: { 0: P(H_TAB, false), 4: P(G4_TAB, false) } }, 'team_duel'), 'rooms/KX7P/players/4', REC('GUEST004', G4_TAB));
deny('team isolated p/3 RESERVE without players leg (atomic coupling)', db1({}, 'team_duel'), 'rooms/KX7P/p/3', P(G3_TAB, false));
const teamMatch = playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true), 3: P(G3_TAB, true) }, seats: 4 }, 'team_duel');
allow('team move pl 0 idx 0', teamMatch, 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 10, dy: 10, sp: 0 });
allow('team move pl 1 idx 1', teamMatch, 'rooms/KX7P/g/0/t/0/1', { idx: 1, dx: -10, dy: 10, sp: 0.5 });
allow('team move pl 2 idx 2', teamMatch, 'rooms/KX7P/g/0/t/0/2', { idx: 2, dx: 10, dy: -10, sp: -0.5 });
allow('team move pl 3 idx 3', teamMatch, 'rooms/KX7P/g/0/t/0/3', { idx: 3, dx: 0, dy: 0, sp: 0 });
allow('team leave-sentinel pl 3 idx 0 (foreign idx)', teamMatch, 'rooms/KX7P/g/0/t/0/3', { idx: 0, dx: 0, dy: 0, sp: 0 });
deny('team move idx 4', teamMatch, 'rooms/KX7P/g/0/t/0/0', { idx: 4, dx: 0, dy: 0, sp: 0 });
deny('team move idx 5', teamMatch, 'rooms/KX7P/g/0/t/0/0', { idx: 5, dx: 0, dy: 0, sp: 0 });
deny('team move pl 4 (seat gate, presence pre-seeded)', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true), 3: P(G3_TAB, true), 4: P(G4_TAB, true) }, seats: 4 }, 'team_duel'), 'rooms/KX7P/g/0/t/0/4', MOVE);

// ── (17) Temporary Barrier — Commit-Reveal-Vertrag bc/br (9A) ─────────────────
//        Exakt der seit 6B2A implementierte und in den Emulator-E2E-Laeufen
//        getestete Contract (2-Seat-Gate): bc/<seat> = {v:1, seat, turn,
//        hash(64-hex)} write-once vom Online-Seat; br/<seat> = {v:1, seat,
//        turn, nonce(64-hex) [, seg 0..11]} write-once erst wenn bc/0 UND
//        bc/1 existieren. Keine Wildcard-Freigaben: bc/br sind benannte
//        Knoten, $pl greift fuer sie nicht mehr; $other bleibt ueberall false.
const HEX64 = 'a'.repeat(64);
const BCV = (seat, turn) => ({ v: 1, seat, turn, hash: HEX64 });
const BRV = (seat, turn, seg) => { const r = { v: 1, seat, turn, nonce: HEX64 }; if (seg !== undefined) r.seg = seg; return r; };
const barrierBase = (turnOver, pOver) => playing({ p: pOver || { 0: P(H_TAB, true), 1: P(G_TAB, true) }, g: { 0: { t: { 0: turnOver || {} } } } });
const bothBc = { bc: { 0: BCV(0, 0), 1: BCV(1, 0) } };

// (T1/T13) barrier-freier Bestand: normale Zuege unveraendert gueltig
allow('barrier T1: normaler Move ohne bc/br bleibt erlaubt', barrierBase(), 'rooms/KX7P/g/0/t/0/0', MOVE);
// (T2) gueltige Commits
allow('barrier T2: gueltiges bc/0', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', BCV(0, 0));
allow('barrier T2: gueltiges bc/1', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/1', BCV(1, 0));
// (T3) gueltige Reveals — erst nach BEIDEN Commits; seg optional (0..11)
allow('barrier T3: gueltiges br/0 mit seg', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 7));
allow('barrier T3: gueltiges br/1 ohne seg (kein Wandeinsatz)', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/1', BRV(1, 0));
deny('barrier T3: br vor beiden Commits (nur bc/0)', barrierBase({ bc: { 0: BCV(0, 0) } }), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 7));
deny('barrier T3: br ganz ohne Commits', barrierBase(), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 7));
// (T5) unbekannte Zusatzfelder bleiben verboten
deny('barrier T5: bc mit Zusatzfeld', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', Object.assign({}, BCV(0, 0), { hack: 1 }));
deny('barrier T5: br mit Zusatzfeld', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', Object.assign({}, BRV(0, 0, 7), { hack: 1 }));
deny('barrier T5: fremder Turn-Kindknoten (weder Slot noch bc/br)', barrierBase(), 'rooms/KX7P/g/0/t/0/xx/0', BCV(0, 0));
// (T6) falsche bc-Typen/-Werte
deny('barrier T6: bc hash als Zahl', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', { v: 1, seat: 0, turn: 0, hash: 123 });
deny('barrier T6: bc hash falsches Format (kein 64-hex)', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', { v: 1, seat: 0, turn: 0, hash: 'XYZ' });
deny('barrier T6: bc falsche Protokollversion v=2', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', Object.assign({}, BCV(0, 0), { v: 2 }));
// (T7) falsche br-Typen
deny('barrier T7: br nonce als Zahl', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', { v: 1, seat: 0, turn: 0, nonce: 7 });
deny('barrier T7: br nonce falsches Format', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', { v: 1, seat: 0, turn: 0, nonce: 'GG'.repeat(32) });
// (T8) ungueltiges Commit-Format
deny('barrier T8: bc ohne hash', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', { v: 1, seat: 0, turn: 0 });
deny('barrier T8: bc seat-Feld passt nicht zum Slot', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', BCV(1, 0));
deny('barrier T8: bc turn-Feld passt nicht zum Turn-Pfad', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', BCV(0, 3));
// (T9) ungueltiges Reveal-Format
deny('barrier T9: br ohne nonce', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', { v: 1, seat: 0, turn: 0, seg: 7 });
deny('barrier T9: br seg=12 (ausserhalb 0..11)', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 12));
deny('barrier T9: br seg=-1', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, -1));
deny('barrier T9: br seat-Feld passt nicht zum Slot', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(1, 0, 7));
// (T10) Seat-Gate: nur Seats 0/1 (2-Seat-Barrier-Gate); offline-Seat gesperrt
deny('barrier T10: bc/2 ausserhalb des 2-Seat-Gates', barrierBase(undefined, { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) }), 'rooms/KX7P/g/0/t/0/bc/2', { v: 1, seat: 2, turn: 0, hash: HEX64 });
deny('barrier T10: br/2 ausserhalb des 2-Seat-Gates', barrierBase(Object.assign({}, bothBc), { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) }), 'rooms/KX7P/g/0/t/0/br/2', { v: 1, seat: 2, turn: 0, nonce: HEX64 });
deny('barrier T10: bc fuer offline-Seat', barrierBase(undefined, { 0: P(H_TAB, true), 1: P(G_TAB, false) }), 'rooms/KX7P/g/0/t/0/bc/1', BCV(1, 0));
// (T11) ungueltiger Turn/Generation
deny('barrier T11: bc in fremder Generation', barrierBase(), 'rooms/KX7P/g/5/t/0/bc/0', BCV(0, 0));
deny('barrier T11: bc unter nicht-numerischem Turn-Schluessel', barrierBase(), 'rooms/KX7P/g/0/t/x/bc/0', BCV(0, 0));
deny('barrier T11: bc Turn-Schluessel zu lang (5 Ziffern)', barrierBase(), 'rooms/KX7P/g/0/t/12345/bc/0', { v: 1, seat: 0, turn: 12345, hash: HEX64 });
// (T12) nachtraegliche Mutation bleibt verboten (write-once)
deny('barrier T12: bc-Ueberschreiben verboten', barrierBase({ bc: { 0: BCV(0, 0) } }), 'rooms/KX7P/g/0/t/0/bc/0', Object.assign({}, BCV(0, 0), { hash: 'b'.repeat(64) }));
deny('barrier T12: br-Ueberschreiben verboten', barrierBase(Object.assign({ br: { 0: BRV(0, 0, 7) } }, bothBc)), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 3));
// ── (17b) 9A.1 — P1-Fixes und weitere Review-Luecken ────────────────────────
//        P1 #2: br.seg muss GANZZAHL sein. br ist write-once — ein akzeptierter
//        Dezimalwert wuerde den Turn dauerhaft blockieren, weil der Client
//        Number.isInteger(seg) verlangt und den Reveal verwirft.
allow('9A.1 seg: 0 (untere Grenze)', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 0));
allow('9A.1 seg: 11 (obere Grenze)', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 11));
allow('9A.1 seg: 7 (Mitte)', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 7));
deny('9A.1 seg: 7.5 (Dezimalwert)', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 7.5));
deny('9A.1 seg: 0.5', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 0.5));
deny('9A.1 seg: 10.999', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 10.999));
deny('9A.1 seg: -1', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, -1));
deny('9A.1 seg: 12', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 12));
deny('9A.1 seg: String statt Zahl', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, '7'));

// P1 #1 (Einzelpfad-Sicht): die Schemaentscheidung liest jetzt den
// RESULTIERENDEN Turn-Zustand (newData.parent()). Bei Einzelpfad-Writes ist das
// deckungsgleich mit der frueheren root-Sicht — hier abgesichert; der
// Multi-Path-Fall (s + Move in EINEM Update) ist mit dieser Mock-Engine
// grundsaetzlich nicht darstellbar und wird gegen den ECHTEN Emulator bewiesen
// (artifacts/temporary_barrier_step9a_rules/rules_security_emu.js, Faelle A2/A3).
allow('9A.1 s/ts: ungestempelter Turn + Move ohne ts', playing(twoOn), 'rooms/KX7P/g/0/t/0/0', MOVE);
deny('9A.1 s/ts: ungestempelter Turn + Move MIT ts', playing(twoOn), 'rooms/KX7P/g/0/t/0/0', MOVETS);
deny('9A.1 s/ts: gestempelter Turn + Move OHNE ts', stamped(1000), 'rooms/KX7P/g/0/t/0/0', MOVE);
allow('9A.1 s/ts: gestempelter Turn + Move MIT korrektem ts', stamped(1000), 'rooms/KX7P/g/0/t/0/0', MOVETS);
deny('9A.1 s/ts: gestempelter Turn + falsches ts', stamped(1000), 'rooms/KX7P/g/0/t/0/0', Object.assign({}, MOVE, { ts: NOW - 500 }));

// Hex-Randfaelle (Commit-Hash und Reveal-Nonce, je 64 lowercase Hex)
deny('9A.1 hex: bc hash 63 Stellen', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', { v: 1, seat: 0, turn: 0, hash: 'a'.repeat(63) });
deny('9A.1 hex: bc hash 65 Stellen', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', { v: 1, seat: 0, turn: 0, hash: 'a'.repeat(65) });
deny('9A.1 hex: bc hash uppercase', barrierBase(), 'rooms/KX7P/g/0/t/0/bc/0', { v: 1, seat: 0, turn: 0, hash: 'A'.repeat(64) });
deny('9A.1 hex: br nonce 63 Stellen', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', { v: 1, seat: 0, turn: 0, nonce: 'a'.repeat(63) });
deny('9A.1 hex: br nonce 65 Stellen', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', { v: 1, seat: 0, turn: 0, nonce: 'a'.repeat(65) });
deny('9A.1 hex: br nonce uppercase', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', { v: 1, seat: 0, turn: 0, nonce: 'A'.repeat(64) });

// br-Bindungen: Turn-Pfad, Generation, unvollstaendige Commit-Lage
deny('9A.1 br: turn-Feld passt nicht zum Turn-Pfad', barrierBase(bothBc), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 3, 7));
deny('9A.1 br: fremde Generation', barrierBase(bothBc), 'rooms/KX7P/g/5/t/0/br/0', BRV(0, 0, 7));
deny('9A.1 br: nur bc/1 vorhanden (bc/0 fehlt)', barrierBase({ bc: { 1: BCV(1, 0) } }), 'rooms/KX7P/g/0/t/0/br/0', BRV(0, 0, 7));
deny('9A.1 br: Loeschen verboten', barrierBase(Object.assign({ br: { 0: BRV(0, 0, 7) } }, bothBc)), 'rooms/KX7P/g/0/t/0/br/0', null);
deny('9A.1 bc: Loeschen verboten', barrierBase({ bc: { 0: BCV(0, 0) } }), 'rooms/KX7P/g/0/t/0/bc/0', null);

// (T13) Kompatibilitaet: Moves neben vorhandenen bc/br unveraendert gueltig
allow('barrier T13: normaler Move im Turn mit bc/br-Knoten', barrierBase(Object.assign({ br: { 0: BRV(0, 0, 7) } }, bothBc)), 'rooms/KX7P/g/0/t/0/1', { idx: 1, dx: 20, dy: 20, sp: 0 });

console.log('\nRules-Suite (lokal, echte firebase.rules.json): ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
