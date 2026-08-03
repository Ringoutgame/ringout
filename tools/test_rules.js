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
Object.defineProperty(String.prototype, 'contains', { value: function (s) { return this.indexOf(s) >= 0; }, configurable: true });
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
// attempts a single-path write against the loaded rules; returns true if allowed.
// authUid: simulated Firebase-Auth identity (null = unauthenticated, like today's
// v3 clients). Exposed to the rules as `auth` — exactly the RTDB shape {uid}.
function tryWrite(db, path, value, authUid) {
  const auth = authUid == null ? null : { uid: authUid };
  const segs = path.split('/');
  const post = JSON.parse(JSON.stringify(db));
  setPath(post, segs, value);
  const ctxAt = (i, vars) => ({ data: new NSnap(db, segs.slice(0, i)), newData: new NSnap(post, segs.slice(0, i)), root: new NSnap(db, []), now: NOW, auth, ...vars });
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
    if (node['.validate'] !== undefined && !evalRule(node['.validate'], { data: new NSnap(db, s), newData: new NSnap(post, s), root: new NSnap(db, []), now: NOW, auth, ...vv })) return false;
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
// v4: authentifizierte Varianten (auth.uid wird an die Rules durchgereicht)
const allowAs = (name, uid, db, path, v) => t('[ALLOW] ' + name, tryWrite(db, path, v, uid) === true);
const denyAs = (name, uid, db, path, v) => t('[DENY]  ' + name, tryWrite(db, path, v, uid) === false);

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

// ── (17) Protokoll v4 — Identity/Seat-Ownership (Anonymous Auth) + serverseitiger
//        Clock-Arbiter. v4-Raeume binden Seat-Claims, Presence und state/seats an
//        auth.uid; room.gen ist fuer v4-Clients KOMPLETT gesperrt (Gen-Haertung).
//        Der aktive Phasen-State liegt begrenzt unter rooms/<code>/g/<gen>/live
//        ({clock, slots}); live/clock ist fuer Clients vollstaendig schreib-
//        geschuetzt, live/slots/<seat> ist der einzige v4-Client-Schreibpfad
//        (write-once, seatByUid-gebunden, aim-Phase, Server-Deadline, t===turn).
//        Die Turn-Historie t/<turn> archiviert AUSSCHLIESSLICH der Server.
//        seatByUid/<uid> ist der server-owned Ownership-Index (Clients read-only).
//        v3-Raeume bleiben byte-identisch geregelt — alle Abschnitte (1)-(16)
//        oben laufen unveraendert ohne auth.
//        Nicht modelliert (wie gehabt): Multi-Location-Updates — der atomare
//        p+players-Leave wird gegen den echten Emulator bewiesen. ──
const UID_H = 'uid-host-0001', UID_G = 'uid-guest-0001', UID_X = 'uid-fremd-0001';
const HOST4 = { id: 'HOST0000', name: 'Host', tab: H_TAB, uid: UID_H };
const REC4 = (id, tab, uid) => ({ id: id || 'GUEST001', name: 'G', tab: tab || G_TAB, uid: uid || UID_G });
// Server-owned UID->Seat-Index und Session-Register (in Fixtures nur GELESEN;
// Erstellung/Rotation: Phase-IIIB-Callables). Bewusst NICHT Teil des
// Create-Payloads mkRoom4. sess/<seat> ist der AKTUELL gueltige Session-Token:
// jeder v4-Presence-Write muss ihn tragen (Tokenrotation invalidiert alte Tabs
// und deren onDisconnect-Handler sofort).
const SEAT_IDX = { [UID_H]: 0, [UID_G]: 1 };
// Session-Register (Handshake): active = aktuell gueltiger Token; pending
// (Join-Reservierung) ist fuer die Rules irrelevant — sie pruefen NUR active.
const SESS_IDX = { 0: { active: H_TAB }, 1: { active: G_TAB } };
const mkRoom4 = (fmt, over = {}) => Object.assign(
  { v: 4, config: { winTarget: 3, fmt, visibility: 'private' }, gen: 0, state: 'lobby', p: { 0: P(H_TAB, false) }, players: { 0: HOST4 }, created: NOW },
  over);
const db4 = (roomOver = {}, fmt = 'single') => ({ rooms: { KX7P: mkRoom4(fmt, Object.assign({ created: NOW - 5000, seatByUid: SEAT_IDX, sess: SESS_IDX }, roomOver)) } });
// Server-Arbiter-Zustand — der begrenzte aktive Phasen-State liegt unter
// rooms/<code>/g/<gen>/live/clock. In Tests als Fixture NUR gelesen.
const CLOCK = (over = {}) => Object.assign(
  { v: 4, gen: 0, turn: 0, phaseId: '0:0', phase: 'aim', startedAt: NOW - 2000, deadlineAt: NOW + 5000, remainingMs: 30000, stage: 0, eligibleSeats: '0,1', cracked: false, expired: false },
  over);
const match4 = (clockOver, extra) => {
  const over = Object.assign(
    { state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) }, players: { 0: HOST4, 1: REC4() } },
    extra || {});
  if (clockOver !== null) {
    const clock = CLOCK(clockOver);
    over.g = Object.assign({}, over.g);
    over.g[clock.gen] = Object.assign({}, over.g[clock.gen], {
      live: Object.assign({}, (over.g[clock.gen] || {}).live, { clock }),
    });
  }
  return db4(over);
};
// v4-Live-Move: traegt den Turn (t, an live.clock.turn gebunden) UND die
// Session (sid, an sess/<seat>/active gebunden — alte Tabs verlieren nach der
// Rotation jeden Move-Slot).
const MOVE4 = Object.assign({}, MOVE, { t: 0, sid: H_TAB });     // Seat 0 (Host)
const MOVE4G = Object.assign({}, MOVE, { t: 0, sid: G_TAB });    // Seat 1 (Gast)

// v4-Raum-Erstellung: seit Phase IIIB AUSSCHLIESSLICH serverseitig
// (roomCreateV4-Callable, Admin SDK umgeht Rules) — jeder direkte
// Client-Create eines v4-Raums ist verboten, egal wie wohlgeformt.
denyAs('v4 create durch Client komplett verboten (auch wohlgeformt, eigene uid)', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single'));
deny('v4 create OHNE auth', { rooms: {} }, 'rooms/KX7P', mkRoom4('single'));
denyAs('v4 create mit fremder uid auf players/0', UID_X, { rooms: {} }, 'rooms/KX7P', mkRoom4('single'));
denyAs('v4 create ohne uid-Feld (v4 verlangt uid)', UID_H, { rooms: {} }, 'rooms/KX7P',
  mkRoom4('single', { players: { 0: { id: 'HOST0000', name: 'Host', tab: H_TAB } } }));
denyAs('v4 create mit vorbefuelltem clock (alter Raumpfad)', UID_H, { rooms: {} }, 'rooms/KX7P',
  mkRoom4('single', { clock: CLOCK() }));
denyAs('v4 create mit vorbefuelltem g/0/clock (alter Gen-Pfad)', UID_H, { rooms: {} }, 'rooms/KX7P',
  mkRoom4('single', { g: { 0: { clock: CLOCK() } } }));
denyAs('v4 create mit vorbefuelltem g/0/live (Clock-Anker)', UID_H, { rooms: {} }, 'rooms/KX7P',
  mkRoom4('single', { g: { 0: { live: { clock: CLOCK() } } } }));
denyAs('v4 create mit vorbefuelltem seatByUid (server-owned Index)', UID_H, { rooms: {} }, 'rooms/KX7P',
  mkRoom4('single', { seatByUid: { [UID_H]: 0 } }));
// Create-Prefill-Bypass (Review-Blocker): ein SKALARER seatByUid-Wert hat keine
// Kinder, die `$uid`-Kindregel feuert also nie. Deshalb wird das Feld jetzt auf
// PARENT-Ebene der Raum-.validate abgelehnt (`!newData.child('seatByUid').exists()`)
// und zusaetzlich der Knoten selbst per `.validate: false` gesperrt — unabhaengig
// davon, welchen Typ der Client mitschickt und welche Regel den Pfad zugestand.
denyAs('v4 create: seatByUid als Zahl (Skalar-Bypass)', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { seatByUid: 0 }));
denyAs('v4 create: seatByUid als String', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { seatByUid: '0' }));
denyAs('v4 create: seatByUid als Boolean', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { seatByUid: true }));
denyAs('v4 create: seatByUid als Liste', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { seatByUid: [0, 1] }));
// Leerer Container: diese Engine wertet ihn als geschriebenen Knoten und lehnt ab.
// Echtes RTDB verwirft {} / [] schon vor der Regelauswertung — dort geht der Create
// durch, traegt aber kein seatByUid (am Emulator geprueft, s. test_action_clock.js).
// Beide Wege fuehren zum selben Ergebnis: kein vorbefuellter Index.
denyAs('v4 create: seatByUid als leeres Objekt', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { seatByUid: {} }));
denyAs('v4 create: seatByUid mit mehreren Eintraegen', UID_H, { rooms: {} }, 'rooms/KX7P',
  mkRoom4('single', { seatByUid: { [UID_H]: 0, [UID_X]: 1 } }));
deny('v3 create: seatByUid ebenfalls verboten (Knoten ist server-owned)', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { seatByUid: 0 }));
// Dieselbe Kaskade fuer die uebrigen server-owned Felder — auch als Skalar.
denyAs('v4 create: g als Skalar (Prefill-Bypass)', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { g: 1 }));
denyAs('v4 create: vorbefuellte Turn-Historie g/0/t', UID_H, { rooms: {} }, 'rooms/KX7P',
  mkRoom4('single', { g: { 0: { t: { 0: { 0: MOVE } } } } }));
denyAs('v4 create: alter clock-Pfad als Skalar', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { clock: 1 }));
denyAs('v4 create: seats als Skalar bleibt verboten', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { seats: 2 }));
deny('v5 create (unbekannte Protokollversion)', { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { v: 5 }));
allow('v3 create bleibt OHNE auth erlaubt (Bestand)', { rooms: {} }, 'rooms/KX7P', mkRoom('single'));

// live/clock: fuer Clients vollstaendig schreibgeschuetzt — nur der Server-Arbiter (Admin SDK)
denyAs('clock: Client-Init verboten (auch Host)', UID_H, match4(null), 'rooms/KX7P/g/0/live/clock', CLOCK());
denyAs('clock: phase-Manipulation verboten', UID_H, match4(), 'rooms/KX7P/g/0/live/clock/phase', 'aim');
denyAs('clock: deadlineAt-Verlaengerung verboten', UID_G, match4(), 'rooms/KX7P/g/0/live/clock/deadlineAt', NOW + 60000);
denyAs('clock: remainingMs-Manipulation verboten', UID_G, match4(), 'rooms/KX7P/g/0/live/clock/remainingMs', 60000);
denyAs('clock: cracked/expired-Manipulation verboten', UID_G, match4(), 'rooms/KX7P/g/0/live/clock/expired', true);
denyAs('clock: eligibleSeats-Manipulation verboten', UID_G, match4(), 'rooms/KX7P/g/0/live/clock/eligibleSeats', '0,1');
denyAs('clock: settled-Report faelschen verboten', UID_G, match4({ phase: 'resolving' }), 'rooms/KX7P/g/0/live/clock/settled/0', { hash: 'x', next: '0,1' });
denyAs('clock: archived-Marker faelschen verboten', UID_G, match4({ phase: 'resolving', archived: false }), 'rooms/KX7P/g/0/live/clock/archived', true);
denyAs('clock: Loeschen verboten', UID_H, match4(), 'rooms/KX7P/g/0/live/clock', null);
deny('clock: unauthentifiziert verboten', match4(), 'rooms/KX7P/g/0/live/clock', CLOCK());
// Alte Pfade existieren nicht mehr — sie fallen unter $other bzw. Default-Deny.
denyAs('clock: alter Raumpfad rooms/<code>/clock bleibt verboten', UID_H, match4(), 'rooms/KX7P/clock', CLOCK());
denyAs('clock: alter Gen-Pfad g/<gen>/clock bleibt verboten', UID_H, match4(), 'rooms/KX7P/g/0/clock', CLOCK());

// seatByUid: server-owned Ownership-Index — fuer Clients vollstaendig read-only
denyAs('seatByUid: eigenen Eintrag anlegen verboten', UID_X, match4(), 'rooms/KX7P/seatByUid/' + UID_X, 1);
denyAs('seatByUid: eigenen Eintrag umbiegen verboten', UID_G, match4(), 'rooms/KX7P/seatByUid/' + UID_G, 0);
denyAs('seatByUid: fremden Eintrag loeschen verboten', UID_X, match4(), 'rooms/KX7P/seatByUid/' + UID_G, null);
denyAs('seatByUid: Index komplett ersetzen verboten (auch Host)', UID_H, match4(), 'rooms/KX7P/seatByUid', { [UID_X]: 1 });
denyAs('seatByUid: Index als Skalar ueberschreiben verboten', UID_H, match4(), 'rooms/KX7P/seatByUid', 0);
denyAs('seatByUid: gesamten Index loeschen verboten', UID_H, match4(), 'rooms/KX7P/seatByUid', null);
deny('seatByUid: unauthentifiziert verboten', match4(), 'rooms/KX7P/seatByUid/' + UID_X, 1);

// Live-Slots v4 (einziger v4-Client-Schreibpfad): eigener Seat via seatByUid,
// aim-Phase, gen-Bindung, t===clock.turn, Server-Deadline, write-once
allowAs('v4 slot: eigener Commit Seat 0 vor Deadline', UID_H, match4(), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
allowAs('v4 slot: eigener Commit Seat 1 vor Deadline', UID_G, match4(), 'rooms/KX7P/g/0/live/slots/1', MOVE4G);
allowAs('v4 slot: eigener No-Shot (Impuls 0) vor Deadline', UID_H, match4(), 'rooms/KX7P/g/0/live/slots/0', { idx: 0, dx: 0, dy: 0, sp: 0, t: 0, sid: H_TAB });
denyAs('v4 slot: fremder Seat (Client-Sentinel/No-Shot ist Server-Aufgabe)', UID_G, match4(), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
deny('v4 slot: unauthentifiziert', match4(), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
denyAs('v4 slot: NACH Server-Deadline (verspaeteter Move)', UID_H, match4({ deadlineAt: NOW - 1 }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
denyAs('v4 slot: waehrend resolving (Physik)', UID_H, match4({ phase: 'resolving' }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
denyAs('v4 slot: Turn-Mismatch (clock.turn=1, Move traegt t=0)', UID_H, match4({ turn: 1, phaseId: '0:1' }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
denyAs('v4 slot: Move ohne t-Feld (Turn-Bindung fehlt)', UID_H, match4(), 'rooms/KX7P/g/0/live/slots/0', MOVE);
denyAs('v4 slot: Extra-Feld im Move-Schema', UID_H, match4(), 'rooms/KX7P/g/0/live/slots/0', Object.assign({}, MOVE4, { hack: 1 }));
denyAs('v4 slot: ohne Server-Clock kein Commit', UID_H, match4(null), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
// Generationsbindung STRUKTURELL: der Anker der Generation 1 liegt unter g/1/live
// und deckt g/0 nicht; und g/1-Slots verlangen room.gen === 1.
denyAs('v4 slot: Anker liegt in fremder Generation (g/1)', UID_H, match4({ gen: 1, phaseId: '1:0' }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
denyAs('v4 slot: Write in fremde Generation (room.gen=0, Write g/1)', UID_H, match4({ gen: 1, phaseId: '1:0' }), 'rooms/KX7P/g/1/live/slots/0', MOVE4);
// eligibleSeats: der Server bestimmt je Phase, wer ueberhaupt ziehen darf.
denyAs('v4 slot: Seat nicht in eligibleSeats (eliminiert)', UID_G, match4({ eligibleSeats: '0' }), 'rooms/KX7P/g/0/live/slots/1', MOVE4G);
allowAs('v4 slot: verbleibender Seat in eligibleSeats zieht weiter', UID_H, match4({ eligibleSeats: '0' }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
denyAs('v4 slot: leere eligibleSeats sperren alle Seats', UID_H, match4({ eligibleSeats: '' }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
denyAs('v4 slot: eligibleSeats gilt auch in der ungetimten Phase (nach Expiry)', UID_G,
  match4({ eligibleSeats: '0', deadlineAt: null, remainingMs: 0, expired: true }), 'rooms/KX7P/g/0/live/slots/1', MOVE4G);
allowAs('v4 slot: untimed Phase (nach Expiry, keine deadlineAt)', UID_H,
  match4({ deadlineAt: null, remainingMs: 0, expired: true }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
denyAs('v4 slot: write-once auch fuer den Eigentuemer', UID_H,
  match4({}, { g: { 0: { live: { slots: { 0: { idx: 0, dx: 0, dy: 0, sp: 0, t: 0 } } } } } }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);

// Session-Bindung der Moves: sid muss der AKTIVEN Session entsprechen — ein
// alter Tab (rotierter Token) verliert den Move-Slot, ein Move ohne sid ist
// schematisch ungueltig.
denyAs('v4 slot: Move ohne sid abgelehnt (Schema)', UID_H, match4(), 'rooms/KX7P/g/0/live/slots/0', Object.assign({}, MOVE, { t: 0 }));
denyAs('v4 slot: Move mit altem sid nach Rotation abgelehnt', UID_H,
  match4({}, { sess: { 0: { active: 'ROTATED0TOKEN001' }, 1: { active: G_TAB } } }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
allowAs('v4 slot: Move mit rotierter aktiver Session erlaubt', UID_H,
  match4({}, { sess: { 0: { active: 'ROTATED0TOKEN001' }, 1: { active: G_TAB } } }), 'rooms/KX7P/g/0/live/slots/0',
  Object.assign({}, MOVE4, { sid: 'ROTATED0TOKEN001' }));

// UID-/Seat-Eindeutigkeit in den Rules: der Index UND players/<seat>/uid muessen
// exakt auf den Schreiber zeigen — jeder inkonsistente Zustand ist fail-closed.
denyAs('v4 slot: seatByUid-Eintrag fehlt (kein Besitz)', UID_G, match4({}, { seatByUid: { [UID_H]: 0 } }), 'rooms/KX7P/g/0/live/slots/1', MOVE4G);
denyAs('v4 slot: seatByUid zeigt auf fremden Seat', UID_G, match4({}, { seatByUid: { [UID_H]: 0, [UID_G]: 0 } }), 'rooms/KX7P/g/0/live/slots/1', MOVE4G);
denyAs('v4 slot: seatByUid-Ziel gehoert lt. players einem anderen (Widerspruch)', UID_G,
  match4({}, { seatByUid: { [UID_H]: 0, [UID_G]: 0 } }), 'rooms/KX7P/g/0/live/slots/0', MOVE4);
denyAs('v4 slot: players.uid passt, aber Index widerspricht (fail-closed)', UID_G,
  match4({}, { seatByUid: { [UID_H]: 0, [UID_G]: 3 } }), 'rooms/KX7P/g/0/live/slots/1', MOVE4G);
denyAs('v4 slot: fremde UID ohne jeden Sitz', UID_X, match4(), 'rooms/KX7P/g/0/live/slots/0', MOVE4);

// Turn-Historie t/<turn>: bei v4 archiviert AUSSCHLIESSLICH der Server-Arbiter —
// jeder Client-Write ist verboten (auch der eigene Seat, auch vor der Deadline).
denyAs('v4 Historie: Client-Write in t/<turn> verboten (eigener Seat)', UID_H, match4(), 'rooms/KX7P/g/0/t/0/0', MOVE);
denyAs('v4 Historie: Client-Write in t/<turn> verboten (Gast)', UID_G, match4(), 'rooms/KX7P/g/0/t/0/1', MOVE);
deny('v4 Historie: Client-Write unauthentifiziert verboten', match4(), 'rooms/KX7P/g/0/t/0/0', MOVE);
denyAs('v4 Historie: archivierten Turn ueberschreiben verboten', UID_H,
  match4({ phase: 'resolving' }, { g: { 0: { t: { 0: { 0: MOVE, 1: { ns: 'stand' } } } } } }), 'rooms/KX7P/g/0/t/0/1', MOVE);
denyAs('v4 Historie: Loeschen eines Turns verboten', UID_H,
  match4({}, { g: { 0: { t: { 0: { 0: MOVE } } } } }), 'rooms/KX7P/g/0/t/0/0', null);

// Seat-Ownership v4 (Phase IIIB): Seats vergibt AUSSCHLIESSLICH der Server
// (roomJoinV4). Clients koennen players-Records weder erstellen noch loeschen —
// erlaubt bleibt nur das Update des EIGENEN Records mit identischer id/tab/uid
// (Namensaenderung). Presence darf nur nach serverseitiger Seat-Zuweisung
// (bestehender p-Knoten) geflippt werden — kein Client-Create, kein Delete.
denyAs('v4 players: Client-Claim verboten (Seat vergibt der Server)', UID_G,
  db4({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }), 'rooms/KX7P/players/1', REC4());
denyAs('v4 players: Claim mit fremder uid im Record', UID_G,
  db4({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }), 'rooms/KX7P/players/1', REC4('GUEST001', G_TAB, UID_X));
deny('v4 players: Claim unauthentifiziert', db4({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }), 'rooms/KX7P/players/1', REC4());
denyAs('v4 players: eigenen Record loeschen verboten (Leave ist Server-Sache)', UID_G,
  db4({ p: { 0: P(H_TAB, false) }, players: { 0: HOST4, 1: REC4() } }), 'rooms/KX7P/players/1', null);
denyAs('v4 players: tab-Rotation ohne Server verboten', UID_G,
  db4({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) }, players: { 0: HOST4, 1: REC4() } }),
  'rooms/KX7P/players/1', REC4('GUEST001', 'GTAB0009', UID_G));

// ── Live-Umbenennung: der EINZIGE erlaubte Client-Write auf players/<seat> ──
// Der Client aktualisiert ausschliesslich das Feld `name` (partieller Write auf
// players/<seat>/name). uid, id und tab bleiben dabei unangetastet — genau das
// verlangen die v4-Rules. Ein Voll-Record-Write (set) waere abgelehnt, weil er
// uid loeschen bzw. tab rotieren wuerde; der partielle Weg ist deshalb nicht
// Bequemlichkeit, sondern der einzige rules-konforme.
const rename4 = db4({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) }, players: { 0: HOST4, 1: REC4() } });
allowAs('v4 rename: eigener Name partiell aenderbar', UID_G, rename4, 'rooms/KX7P/players/1/name', 'Neuer Name');
allowAs('v4 rename: Host kann seinen eigenen Namen aendern', UID_H, rename4, 'rooms/KX7P/players/0/name', 'Host Neu');
allowAs('v4 rename: auch im laufenden Match erlaubt', UID_G,
  db4({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) }, players: { 0: HOST4, 1: REC4() } }),
  'rooms/KX7P/players/1/name', 'Im Match');
denyAs('v4 rename: fremden Namen aendern verboten', UID_X, rename4, 'rooms/KX7P/players/1/name', 'Gekapert');
denyAs('v4 rename: Nachbar-Seat aendern verboten', UID_H, rename4, 'rooms/KX7P/players/1/name', 'Fremd');
deny('v4 rename: unauthentifiziert verboten', rename4, 'rooms/KX7P/players/1/name', 'Anonym');
denyAs('v4 rename: leerer Name verboten', UID_G, rename4, 'rooms/KX7P/players/1/name', '');
denyAs('v4 rename: Name > 48 Zeichen verboten', UID_G, rename4, 'rooms/KX7P/players/1/name', 'x'.repeat(49));
denyAs('v4 rename: Name muss ein String sein', UID_G, rename4, 'rooms/KX7P/players/1/name', 42);
// uid/tab/id sind ueber denselben Pfad nicht manipulierbar.
denyAs('v4 rename: uid-Manipulation abgelehnt', UID_G, rename4, 'rooms/KX7P/players/1/uid', UID_X);
denyAs('v4 rename: fremde uid auf fremden Seat abgelehnt', UID_X, rename4, 'rooms/KX7P/players/1/uid', UID_X);
// Ehrliche Abgrenzung: die EIGENE uid auf ihren IDENTISCHEN Wert zu schreiben
// ist ein No-op und daher erlaubt (Rules verlangen newData.uid === data.uid und
// newData.uid === auth.uid — beides trifft zu). Es kann per Definition nichts
// veraendern; die sicherheitsrelevanten Faelle stehen darueber.
allowAs('v4 rename: eigene uid auf denselben Wert ist ein No-op', UID_G, rename4, 'rooms/KX7P/players/1/uid', UID_G);
denyAs('v4 rename: tab-Manipulation abgelehnt', UID_G, rename4, 'rooms/KX7P/players/1/tab', 'GTAB0009');
denyAs('v4 rename: id-Manipulation abgelehnt', UID_G, rename4, 'rooms/KX7P/players/1/id', 'NEW00001');
// Voll-Record-Writes bleiben abgelehnt — genau der Fehler, den der partielle
// Write ersetzt: playerRecord() ohne uid bzw. mit frischem tab.
denyAs('v4 rename: Voll-Record ohne uid abgelehnt (Regressionsschutz)', UID_G, rename4,
  'rooms/KX7P/players/1', { id: 'GUEST001', name: 'Neu', tab: G_TAB });
denyAs('v4 rename: Voll-Record mit frischem tab abgelehnt (Regressionsschutz)', UID_G, rename4,
  'rooms/KX7P/players/1', { id: 'GUEST001', name: 'Neu', tab: 'GTAB0009', uid: UID_G });
// v3 bleibt unveraendert: dort ist der Voll-Record-Weg weiterhin der richtige.
allow('v3 rename: Voll-Record mit gleicher id bleibt erlaubt',
  db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) }, players: { 0: HOST, 1: { id: 'GUEST001', name: 'alt', tab: G_TAB } } }),
  'rooms/KX7P/players/1', { id: 'GUEST001', name: 'Neu', tab: G_TAB });

const recon4 = db4({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, false) }, players: { 0: HOST4, 1: REC4() } });
allowAs('v4 presence: eigener Seat aktivieren (Reconnect-Flip)', UID_G, recon4, 'rooms/KX7P/p/1', P(G_TAB, true));
denyAs('v4 presence: fremden Seat aktivieren', UID_X, recon4, 'rooms/KX7P/p/1', P(G_TAB, true));
deny('v4 presence: unauthentifiziert', recon4, 'rooms/KX7P/p/1', P(G_TAB, true));
denyAs('v4 presence: Create ohne serverseitige Seat-Zuweisung verboten', UID_G,
  db4({ p: { 0: P(H_TAB, false) }, players: { 0: HOST4 } }), 'rooms/KX7P/p/1', P(G_TAB, false));
denyAs('v4 presence: Delete verboten (Leave ist Server-Sache)', UID_G,
  db4({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) }, players: { 0: HOST4 } }), 'rooms/KX7P/p/1', null);

// Session-Tokenrotation (Haertung): sess/<seat> ist das server-owned Register
// des aktuell gueltigen Tokens. Nach einer Rotation ist der ALTE Token sofort
// wertlos — der onDisconnect-Handler des alten Tabs kann die neue Presence
// nicht mehr offline setzen; der neue Token schreibt normal weiter.
const ROT = 'ROTATED0TOKEN001';
const rotated4 = db4({
  state: 'playing',
  p: { 0: P(H_TAB, true), 1: { s: ROT, on: true, t: NOW - 1000 } },
  players: { 0: HOST4, 1: REC4() },
  sess: { 0: { active: H_TAB }, 1: { active: ROT } },
});
denyAs('v4 sess: alter onDisconnect (alter Token) nach Rotation wirkungslos', UID_G,
  rotated4, 'rooms/KX7P/p/1', { s: G_TAB, on: false, t: NOW });
allowAs('v4 sess: aktueller Token schreibt Presence normal weiter', UID_G,
  rotated4, 'rooms/KX7P/p/1', { s: ROT, on: false, t: NOW });
denyAs('v4 sess: Token-Selbstrotation durch Client verboten (nur Server rotiert)', UID_G,
  db4({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 3000) }, players: { 0: HOST4, 1: REC4() } }),
  'rooms/KX7P/p/1', { s: 'GTAB0009', on: false, t: NOW });
allowAs('v4 players: Namensaenderung trotz rotiertem p.s erlaubt (Kopplung ist v3-Sache)', UID_G,
  rotated4, 'rooms/KX7P/players/1', { id: 'GUEST001', name: 'Neu', tab: G_TAB, uid: UID_G });
denyAs('v4 sess: Client-Write auf eigenen Eintrag verboten', UID_G, db4(), 'rooms/KX7P/sess/1', 'HACKTOK00001');
denyAs('v4 sess: Register komplett ersetzen verboten', UID_H, db4(), 'rooms/KX7P/sess', { 0: 'HACKTOK00001' });
denyAs('v4 sess: Eintrag loeschen verboten', UID_H, db4(), 'rooms/KX7P/sess/1', null);
denyAs('v4 create: sess-Prefill verboten', UID_H, { rooms: {} }, 'rooms/KX7P', mkRoom4('single', { sess: { 0: H_TAB } }));

// Public-Listing v4: das Listing muss die iid seines Raums tragen (Cleanup ist
// dadurch instanzgebunden) und ein provisionaler Raum ist nie listbar.
const IID4 = 'IIDRULES00000001';
const pub4 = (roomOver = {}, listing = undefined) => {
  const db = { rooms: { KX7P: mkRoom4('ffa', Object.assign({ created: NOW - 5000, iid: IID4, seatByUid: SEAT_IDX, sess: SESS_IDX, config: { winTarget: 3, fmt: 'ffa', visibility: 'public' }, p: { 0: P(H_TAB, true) } }, roomOver)) }, publicRooms: {} };
  if (listing !== undefined) db.publicRooms.KX7P = listing;
  return db;
};
allowAs('pub v4: Listing mit korrekter iid erlaubt', UID_H, pub4(), 'publicRooms/KX7P', { created: NOW, iid: IID4 });
denyAs('pub v4: Listing OHNE iid abgelehnt', UID_H, pub4(), 'publicRooms/KX7P', { created: NOW });
denyAs('pub v4: Listing mit fremder iid abgelehnt', UID_H, pub4(), 'publicRooms/KX7P', { created: NOW, iid: 'IIDFREMD00000001' });
denyAs('pub v4: provisionaler Raum ist nicht listbar', UID_H, pub4({ provisional: true }), 'publicRooms/KX7P', { created: NOW, iid: IID4 });
allow('pub v3: Listing bleibt ohne iid erlaubt (Bestand)', pubDb(), 'publicRooms/KX7P', LISTING);

// Matchsteuerung v4 (Phase IIIB): state UND seats sind fuer Clients komplett
// gesperrt — der Matchstart laeuft ausschliesslich ueber roomStartV4 bzw. den
// atomaren Server-Join (1v1/2v2). room.gen bleibt gesperrt (Gen-Haertung IIIA);
// der legitime Rematch-Uebergang ist roomRematchV4.
const lobby4 = db4({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) }, players: { 0: HOST4, 1: REC4() } });
denyAs('v4 state: Client-Start verboten (auch Host — roomStartV4 ist der Weg)', UID_H, lobby4, 'rooms/KX7P/state', 'playing');
denyAs('v4 state: Start durch Gast verboten', UID_G, lobby4, 'rooms/KX7P/state', 'playing');
deny('v4 state: Start unauthentifiziert verboten', lobby4, 'rooms/KX7P/state', 'playing');
const started4 = db4({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) }, players: { 0: HOST4, 1: REC4() } }, 'ffa');
denyAs('v4 seats: Client-Write verboten (auch Host — der Server schreibt seats)', UID_H, started4, 'rooms/KX7P/seats', 2);
denyAs('v4 seats: Gast darf nicht', UID_G, started4, 'rooms/KX7P/seats', 2);
// Server-owned Lifecycle-State: der Create-Idempotency-Marker ist fuer Clients
// weder les- noch schreibbar (reqs faellt unter Root-Default-Deny + explizite Sperre).
denyAs('v4 reqs: Idempotency-Marker nicht schreibbar', UID_H, { rooms: {}, reqs: {} }, 'reqs/' + UID_H + '/req-0001-aaaa', { sig: 'x', room: 'KX7P' });
deny('v4 reqs: unauthentifiziert nicht schreibbar', { rooms: {}, reqs: {} }, 'reqs/' + UID_H + '/req-0001-aaaa', { sig: 'x' });
denyAs('v4 gen: Gen-Bump durch Mitspieler verboten (gesperrt)', UID_G, match4(), 'rooms/KX7P/gen', 1);
denyAs('v4 gen: Gen-Bump durch Host verboten (gesperrt)', UID_H, match4(), 'rooms/KX7P/gen', 1);
denyAs('v4 gen: Gen-Bump durch Fremden verboten', UID_X, match4(), 'rooms/KX7P/gen', 1);
deny('v4 gen: Gen-Bump unauthentifiziert verboten', match4(), 'rooms/KX7P/gen', 1);
denyAs('v4 gen: auch Same-Value-Write verboten (kein Refresh)', UID_H, match4(), 'rooms/KX7P/gen', 0);
denyAs('v4 gen: Gen-Bump auch in der Lobby verboten', UID_H, lobby4, 'rooms/KX7P/gen', 1);

// ── (18) Regression zu zwei Review-Befunden (P0/P1) ──
// P0: players/<seat> war ohne v4-Auth-Gate — jeder authentifizierte Client konnte
//     den Record eines FREMDEN Seats (inkl. uid) ueberschreiben und damit Seat-
//     bzw. Host-Rolle uebernehmen, auch gegenueber dem Server-Arbiter
//     (clock-core.seatOfUid loest Seats ueber players/<seat>/uid auf).
// P1: die Room-.write-Kaskade galt fuer JEDEN Kindpfad eines noch nicht
//     existierenden Raumcodes und umging damit die Raum-.validate — inklusive
//     eines vorbefuellten clock-Ankers, den der Arbiter danach nie ueberschreibt.
const UID_A = 'uid-angreifer-01';
const seated4 = db4({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) }, players: { 0: HOST4, 1: REC4() } });
denyAs('P0 v4: fremdes players/1/uid ueberschreiben (Seat-Uebernahme)', UID_A, seated4, 'rooms/KX7P/players/1/uid', UID_A);
denyAs('P0 v4: players/0/uid ueberschreiben (Host-Uebernahme)', UID_A, seated4, 'rooms/KX7P/players/0/uid', UID_A);
denyAs('P0 v4: fremden players/1-Record komplett ersetzen', UID_A, seated4, 'rooms/KX7P/players/1',
  { id: 'GUEST001', name: 'G', tab: G_TAB, uid: UID_A });
deny('P0 v4: players/1/uid loeschen ohne auth (Seat-DoS)', seated4, 'rooms/KX7P/players/1/uid', null);
denyAs('P0 v4: fremdes players/1 loeschen', UID_A, seated4, 'rooms/KX7P/players/1', null);
denyAs('P0 v4: eigene uid im eigenen Record aendern (uid unveraenderlich)', UID_G, seated4, 'rooms/KX7P/players/1/uid', UID_A);
allowAs('P0 v4: eigenen Namen aendern bleibt erlaubt', UID_G, seated4, 'rooms/KX7P/players/1',
  { id: 'GUEST001', name: 'Neu', tab: G_TAB, uid: UID_G });
denyAs('P0 v4: fremden Namen aendern', UID_A, seated4, 'rooms/KX7P/players/1',
  { id: 'GUEST001', name: 'Hacked', tab: G_TAB, uid: UID_G });
denyAs('P1: live/clock auf freien Raumcode schreiben (Kaskade)', UID_A, { rooms: {} }, 'rooms/QQQQ/g/0/live/clock', CLOCK());
denyAs('P1: live-Slot auf freien Raumcode schreiben (Kaskade)', UID_A, { rooms: {} }, 'rooms/QQQQ/g/0/live/slots/0', MOVE4);
denyAs('P1: seatByUid auf freien Raumcode schreiben (Kaskade)', UID_A, { rooms: {} }, 'rooms/QQQQ/seatByUid/' + UID_A, 0);
denyAs('P1: Turn-Slot auf freien Raumcode schreiben (Kaskade)', UID_A, { rooms: {} }, 'rooms/QQQQ/g/0/t/0/0', MOVE);
denyAs('P1: Teil-Raum (nur config) auf freien Code schreiben', UID_A, { rooms: {} }, 'rooms/QQQQ/config',
  { winTarget: 3, fmt: 'single', visibility: 'private' });
deny('P1: live/clock auf freien Raumcode ohne auth', { rooms: {} }, 'rooms/QQQQ/g/0/live/clock', CLOCK());
denyAs('P1: alter Raumpfad clock auf freien Raumcode', UID_A, { rooms: {} }, 'rooms/QQQQ/clock', CLOCK());
denyAs('P1: v4-Raumerstellung durch Client seit Phase IIIB verboten', UID_H, { rooms: {} }, 'rooms/QQQQ', mkRoom4('single'));
allow('P1: vollstaendige v3-Raumerstellung bleibt erlaubt', { rooms: {} }, 'rooms/QQQQ', mkRoom('single'));

// v3-Bestand: unveraendert OHNE auth spielbar (Regression neben den Abschnitten oben)
allow('v3 slot: Move weiterhin ohne auth', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/g/0/t/0/0', MOVE);
allow('v3 gen: Rematch weiterhin ohne auth', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/gen', 1);
allow('v3 players: Namensaenderung weiterhin ohne auth', playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) }, players: { 0: HOST, 1: REC() } }),
  'rooms/KX7P/players/1', { id: 'GUEST001', name: 'Neu', tab: G_TAB });
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

// Deadline-Gate: bis zur Deadline zaehlt jeder Zug, danach NUR noch der No-Shot.
// Damit kann kein Client einen Timeout verfruehen — der Server entscheidet anhand
// seiner eigenen Uhr (now), nicht der Client.
const NOSHOT = { idx: 1, dx: 0, dy: 0, sp: 0, ts: NOW };
allow('clock: echter Zug vor der Deadline', stamped(3000), 'rooms/KX7P/g/0/t/0/0', MOVETS);
allow('clock: echter Zug exakt auf der Deadline', stamped(7000), 'rooms/KX7P/g/0/t/0/0', MOVETS);
deny('clock: echter Zug nach der Deadline abgewiesen', stamped(7001), 'rooms/KX7P/g/0/t/0/0', MOVETS);
allow('clock: No-Shot nach der Deadline erlaubt', stamped(7001), 'rooms/KX7P/g/0/t/0/1', NOSHOT);
// BESTANDSGRENZE (unveraendert, nicht durch diesen Timer verursacht): v3 kennt keine
// Authentifizierung, die Rules koennen einen fremden Stand-Zug vor der Deadline nicht
// vom eigenen Stand-Button unterscheiden. Genau darauf beruht schon der bestehende
// Leave-Sentinel. Der Timer verschaerft das NICHT — er verbietet nach der Deadline
// zusaetzlich jeden echten Zug und macht die Deadline selbst faelschungssicher.
allow('clock: Stand vor der Deadline bleibt erlaubt (v3-Bestand, Stand-Button)', stamped(3000), 'rooms/KX7P/g/0/t/0/1', NOSHOT);
allow('clock: No-Shot bleibt write-once geschuetzt (erster gewinnt)', stamped(7001), 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 0, dy: 0, sp: 0, ts: NOW });
deny('clock: bestaetigter Zug wird auch nach der Deadline nicht ueberschrieben',
  stampedWith(7001, { 0: MOVETS }), 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 0, dy: 0, sp: 0, ts: NOW });
deny('clock: getarnter Fremdzug nach der Deadline (dx!=0) abgewiesen', stamped(7001), 'rooms/KX7P/g/0/t/0/1', Object.assign({}, MOVETS, { idx: 1, dx: 100, dy: 0 }));
// Ein isolierter Kind-Write auf t/<turn>/<seat>/ts (Vorstempeln ohne Zug) scheitert an
// der $pl-.validate (hasChildren idx/dx/dy/sp/ts). Die lokale Mock-Engine wertet
// Ancestor-Validates bei Kind-Writes nicht aus — dieser Fall wird deshalb gegen den
// ECHTEN RTDB-Emulator geprueft (siehe Emulator-Protokoll im Abschlussbericht).

// ── (v4-Zugfluss) Der Server besitzt die Uhr ────────────────────────────
// Bei v4 gibt es keinen client-beschreibbaren Turn-Knoten mehr: Zuege laufen
// ausschliesslich ueber live/slots/<seat>, und live/clock gehört allein dem
// Arbiter. Damit ist Future-Turn-Pre-Arming konstruktiv unmöglich — es gibt
// keinen Pfad, den ein Client für einen späteren Turn vorbereiten könnte.
denyAs('v4: live/clock ist für Clients unbeschreibbar', UID_H, match4({}), 'rooms/KX7P/g/0/live/clock', CLOCK());
denyAs('v4: einzelnes clock-Feld ebenfalls unbeschreibbar', UID_H, match4({}), 'rooms/KX7P/g/0/live/clock/deadlineAt', NOW + 99999);
denyAs('v4: Phasenstempel t/<turn>/s existiert nicht mehr', UID_H, match4({}), 'rooms/KX7P/g/0/t/0/s', NOW);
denyAs('v4: Turn-Historie ist für Clients gesperrt', UID_H, match4({}), 'rooms/KX7P/g/0/t/0/0', MOVE4);
denyAs('v4: auch ein zukünftiger Turn der Historie bleibt gesperrt', UID_H, match4({}), 'rooms/KX7P/g/0/t/9/0', MOVE4);
denyAs('v4: kein Vorbereiten eines zukünftigen Phasenstempels', UID_H, match4({}), 'rooms/KX7P/g/0/t/9/s', NOW);
// v3 bleibt additiv unberührt: derselbe Pfad ist dort weiterhin erlaubt.
allow('v3: Turn-Historie bleibt für Clients schreibbar (Bestand)', playing(twoOn), 'rooms/KX7P/g/0/t/0/0', MOVE);
allow('v3: Phasenstempel bleibt schreibbar (produktiver Bestand)', playing(twoOn), 'rooms/KX7P/g/0/t/0/s', NOW);

console.log('\nRules-Suite (lokal, echte firebase.rules.json): ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
