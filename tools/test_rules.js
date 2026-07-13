// M8-T3b local rules verification: loads the REAL firebase.rules.json and
// evaluates its rule strings (a JS-compatible subset of the RTDB rules
// language) against concrete write scenarios — BEFORE publishing.
// Semantics modeled: .write cascade (any true .write on the path grants),
// .validate on the written node and all written children, deletes skip
// .validate, newData = post-write merged tree (supports parent()).
// NOT modeled: multi-location updates (approximated by sequential writes).
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
  exists() { return this._v() !== null; }
  val() { return this._v(); }
  isNumber() { return typeof this._v() === 'number'; }
  isString() { return typeof this._v() === 'string'; }
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

// ── fixtures ──
const V = 3;
// Valid roster records (id/tab match /^[A-Za-z0-9_-]{8,24}$/, name 1..16 chars).
const HOST = { id: 'HOST0000', name: 'Host', tab: 'HOSTTAB0' };
const REC = (id) => ({ id: id || 'GUEST001', name: 'G', tab: 'GTAB0001' });
// Unified room-state (Paket A): EVERY mode is created with state:'lobby'.
const mkRoom = (fmt, over = {}) => Object.assign(
  { v: V, config: { winTarget: 3, fmt }, gen: 0, state: 'lobby', p: { 0: true }, players: { 0: HOST }, created: NOW },
  over);
const db1 = (roomOver = {}, fmt = 'single') => ({ rooms: { KX7P: mkRoom(fmt, Object.assign({ created: NOW - 5000 }, roomOver)) } });
const MOVE = { idx: 0, dx: 100, dy: -50, sp: 0.5 };

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const allow = (name, db, path, v) => t('[ALLOW] ' + name, tryWrite(db, path, v) === true);
const deny = (name, db, path, v) => t('[DENY]  ' + name, tryWrite(db, path, v) === false);

// ── (1) single/double regression — must behave exactly as before (only v is 2) ──
allow('create single v2', { rooms: {} }, 'rooms/KX7P', mkRoom('single'));
allow('create double v2', { rooms: {} }, 'rooms/KX7P', mkRoom('double', { config: { winTarget: 5, fmt: 'double' } }));
deny('create v1 room', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { v: 1 }));
deny('create fmt triple', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { config: { winTarget: 3, fmt: 'triple' } }));
deny('create single WITHOUT state', { rooms: {} }, 'rooms/KX7P', (() => { const r = mkRoom('single'); delete r.state; return r; })());
deny('create single state=playing at create', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { state: 'playing' }));
deny('create single WITH seats', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { seats: 2 }));
deny('create bad code charset', { rooms: {} }, 'rooms/AAA0', mkRoom('single'));
deny('overwrite existing room', db1(), 'rooms/KX7P', mkRoom('single'));
allow('single: guest join p/1', db1(), 'rooms/KX7P/p/1', true);
deny('single: p/1 overwrite (write-once since v3)', db1({ p: { 0: true, 1: true } }), 'rooms/KX7P/p/1', true);
allow('single: guest delete p/1', db1({ p: { 0: true, 1: true } }), 'rooms/KX7P/p/1', null);
allow('single: host delete p/0', db1(), 'rooms/KX7P/p/0', null);
allow('single: host rejoin re-set p/0 (players/0 present, v3)', db1({ p: {} }), 'rooms/KX7P/p/0', true);
deny('single: seat 2 claim', db1(), 'rooms/KX7P/p/2', true);
deny('single: join after 2h window', db1({ created: NOW - 7200001 }), 'rooms/KX7P/p/1', true);
allow('single: move pl 0', db1(), 'rooms/KX7P/g/0/t/0/0', MOVE);
allow('single: move pl 1', db1(), 'rooms/KX7P/g/0/t/0/1', { idx: 3, dx: -195, dy: 195, sp: -1 });
deny('single: move write-once', db1({ g: { 0: { t: { 0: { 0: MOVE } } } } }), 'rooms/KX7P/g/0/t/0/0', MOVE);
deny('single: move wrong gen', db1(), 'rooms/KX7P/g/5/t/0/0', MOVE);
deny('single: move dx out of bounds', db1(), 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 196, dy: 0, sp: 0 });
deny('single: move extra field', db1(), 'rooms/KX7P/g/0/t/0/0', { idx: 0, dx: 0, dy: 0, sp: 0, hack: 1 });
deny('single: move pl 2', db1(), 'rooms/KX7P/g/0/t/0/2', MOVE);
deny('single: move idx 4', db1(), 'rooms/KX7P/g/0/t/0/0', { idx: 4, dx: 0, dy: 0, sp: 0 });
// Unified room-state: 1v1/2v2 also transition lobby->playing (with p/1 present).
deny('single: re-write lobby over lobby rejected', db1(), 'rooms/KX7P/state', 'lobby');
allow('single: lobby->playing with p/1', db1({ p: { 0: true, 1: true } }), 'rooms/KX7P/state', 'playing');
deny('single: lobby->playing WITHOUT p/1', db1(), 'rooms/KX7P/state', 'playing');
deny('single: playing->lobby rejected', db1({ p: { 0: true, 1: true }, state: 'playing' }), 'rooms/KX7P/state', 'lobby');
deny('single: guest claim p/1 blocked in PLAYING', db1({ state: 'playing' }), 'rooms/KX7P/p/1', true);
deny('double: guest claim p/1 blocked in PLAYING', db1({ state: 'playing' }, 'double'), 'rooms/KX7P/p/1', true);
deny('single: seats write rejected', db1(), 'rooms/KX7P/seats', 2);
allow('single: gen increment', db1(), 'rooms/KX7P/gen', 1);
deny('single: gen jump', db1(), 'rooms/KX7P/gen', 5);

// ── (2) ffa creation ──
allow('ffa: create with state lobby', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa'));
deny('ffa: create WITHOUT state', { rooms: {} }, 'rooms/KX7P', (() => { const r = mkRoom('ffa'); delete r.state; return r; })());
deny('ffa: create with state playing', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa', { state: 'playing' }));
deny('ffa: create with p/2 prefilled', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa', { p: { 0: true, 2: true } }));
deny('ffa: create with seats prefilled', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa', { seats: 3 }));

// ── (3) ffa seat claiming (lobby only, write-once, seats 1-4) ──
const ffaLobby = (p) => db1({ p }, 'ffa');
allow('ffa: claim seat 1', ffaLobby({ 0: true }), 'rooms/KX7P/p/1', true);
allow('ffa: claim seat 2', ffaLobby({ 0: true, 1: true }), 'rooms/KX7P/p/2', true);
allow('ffa: claim seat 4', ffaLobby({ 0: true, 1: true, 2: true, 3: true }), 'rooms/KX7P/p/4', true);
deny('ffa: claim seat 5', ffaLobby({ 0: true }), 'rooms/KX7P/p/5', true);
deny('ffa: re-claim occupied seat 1 (write-once)', ffaLobby({ 0: true, 1: true }), 'rooms/KX7P/p/1', true);
deny('ffa: re-claim occupied seat 3 (write-once)', ffaLobby({ 0: true, 1: true, 2: true, 3: true }), 'rooms/KX7P/p/3', true);
allow('ffa: presence delete seat 2', ffaLobby({ 0: true, 1: true, 2: true }), 'rooms/KX7P/p/2', null);
deny('ffa: claim after start (state playing)', db1({ p: { 0: true, 1: true }, state: 'playing', seats: 2 }, 'ffa'), 'rooms/KX7P/p/2', true);
deny('ffa: join after 2h window', db1({ created: NOW - 7200001 }, 'ffa'), 'rooms/KX7P/p/1', true);

// ── (4) ffa state transition (host start) ──
allow('ffa: lobby->playing with p/1', ffaLobby({ 0: true, 1: true }), 'rooms/KX7P/state', 'playing');
deny('ffa: lobby->playing WITHOUT p/1', ffaLobby({ 0: true }), 'rooms/KX7P/state', 'playing');
deny('ffa: playing->lobby', db1({ p: { 0: true, 1: true }, state: 'playing', seats: 2 }, 'ffa'), 'rooms/KX7P/state', 'lobby');
deny('ffa: re-write lobby over lobby', ffaLobby({ 0: true }), 'rooms/KX7P/state', 'lobby');
deny('ffa: state garbage value', ffaLobby({ 0: true, 1: true }), 'rooms/KX7P/state', 'x');

// ── (5) ffa seats (write-once, 2-5, only when playing) ──
const ffaPlaying = db1({ p: { 0: true, 1: true, 2: true }, state: 'playing' }, 'ffa');
allow('ffa: seats 3 after start', ffaPlaying, 'rooms/KX7P/seats', 3);
allow('ffa: seats 2 (min)', ffaPlaying, 'rooms/KX7P/seats', 2);
allow('ffa: seats 5 (max)', ffaPlaying, 'rooms/KX7P/seats', 5);
deny('ffa: seats 6', ffaPlaying, 'rooms/KX7P/seats', 6);
deny('ffa: seats 1', ffaPlaying, 'rooms/KX7P/seats', 1);
deny('ffa: seats while still lobby', ffaLobby({ 0: true, 1: true }), 'rooms/KX7P/seats', 2);
deny('ffa: seats rewrite (write-once)', db1({ p: { 0: true, 1: true }, state: 'playing', seats: 2 }, 'ffa'), 'rooms/KX7P/seats', 3);

// ── (6) ffa moves seats 0-4, idx 0-4 ──
const ffaMatch = db1({ p: { 0: true, 1: true, 2: true, 3: true, 4: true }, state: 'playing', seats: 5 }, 'ffa');
allow('ffa: move pl 4', ffaMatch, 'rooms/KX7P/g/0/t/0/4', { idx: 4, dx: 10, dy: 10, sp: 0 });
allow('ffa: move pl 2 idx 2', ffaMatch, 'rooms/KX7P/g/0/t/0/2', { idx: 2, dx: 10, dy: 10, sp: 0 });
deny('ffa: move pl 5', ffaMatch, 'rooms/KX7P/g/0/t/0/5', MOVE);
deny('ffa: move idx 5', ffaMatch, 'rooms/KX7P/g/0/t/0/0', { idx: 5, dx: 0, dy: 0, sp: 0 });
deny('ffa: move write-once', db1({ p: { 0: true, 1: true }, state: 'playing', seats: 2, g: { 0: { t: { 0: { 4: MOVE } } } } }, 'ffa'), 'rooms/KX7P/g/0/t/0/4', MOVE);
deny('ffa: move dx out of bounds', ffaMatch, 'rooms/KX7P/g/0/t/0/4', { idx: 4, dx: -196, dy: 0, sp: 0 });

// ── (7) room cleanup delete (v1): whole room removable ONLY when no seat present ──
allow('cleanup: delete empty single room', db1({ p: {} }), 'rooms/KX7P', null);
allow('cleanup: delete empty ffa room', db1({ p: {} }, 'ffa'), 'rooms/KX7P', null);
allow('cleanup: delete playing room after all left', db1({ p: {}, state: 'playing', seats: 2 }, 'ffa'), 'rooms/KX7P', null);
deny('cleanup: delete blocked, p/0 present', db1({ p: { 0: true } }), 'rooms/KX7P', null);
deny('cleanup: delete blocked, p/1 present', db1({ p: { 0: false, 1: true } }), 'rooms/KX7P', null);
deny('cleanup: delete blocked, p/2 present', db1({ p: { 2: true } }, 'ffa'), 'rooms/KX7P', null);
deny('cleanup: delete blocked, p/3 present', db1({ p: { 3: true } }, 'ffa'), 'rooms/KX7P', null);
deny('cleanup: delete blocked, p/4 present', db1({ p: { 4: true } }, 'ffa'), 'rooms/KX7P', null);
deny('cleanup: delete blocked, playing with seats present', db1({ p: { 0: true, 1: true }, state: 'playing', seats: 2 }, 'ffa'), 'rooms/KX7P', null);
deny('cleanup: still cannot overwrite existing room', db1(), 'rooms/KX7P', mkRoom('single'));
deny('cleanup: still cannot delete non-existent room', { rooms: {} }, 'rooms/KX7P', null);

// ── (8) v3 identity: room creation requires players/0, forbids prefilled 1-4 ──
deny('create WITHOUT players/0', { rooms: {} }, 'rooms/KX7P', (() => { const r = mkRoom('single'); delete r.players; return r; })());
deny('create with players/0 missing name', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { players: { 0: { id: 'HOST0000', tab: 'HOSTTAB0' } } }));
deny('create with players/1 prefilled', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa', { players: { 0: HOST, 1: REC() } }));
allow('create v3 ffa with players/0', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa'));

// ── (9) players node: creation only by the presence holder, id immutable,
//        delete only on free presence, recycle = delete+create (lobby only) ──
const ffaLob = (p, players) => db1(Object.assign({ p }, players ? { players } : {}), 'ffa');
allow('players: presence holder creates own record', ffaLob({ 0: true, 1: true }), 'rooms/KX7P/players/1', REC('GUEST001'));
allow('players: same-id update (rejoin / name change)', db1({ players: { 0: HOST, 1: { id: 'GUEST001', name: 'old', tab: 'T0000000' } } }), 'rooms/KX7P/players/1', REC('GUEST001'));
deny('players: id switch on existing record (presence held)', ffaLob({ 0: true, 1: true }, { 0: HOST, 1: { id: 'GUEST001', name: 'g', tab: 'T0000000' } }), 'rooms/KX7P/players/1', REC('EVIL0001'));
deny('players: id switch on existing record (presence free)', ffaLob({ 0: true }, { 0: HOST, 2: { id: 'OLD00001', name: 'x', tab: 'T0000000' } }), 'rooms/KX7P/players/2', REC('NEW00001'));
deny('players: delete while presence held', ffaLob({ 0: true, 1: true }, { 0: HOST, 1: REC('GUEST001') }), 'rooms/KX7P/players/1', null);
allow('players: delete own record after presence removal (leave)', ffaLob({ 0: true }, { 0: HOST, 1: REC('GUEST001') }), 'rooms/KX7P/players/1', null);
allow('players: recycle step 1 — delete stale record (lobby, presence free)', ffaLob({ 0: true }, { 0: HOST, 2: { id: 'OLD00001', name: 'x', tab: 'T0000000' } }), 'rooms/KX7P/players/2', null);
allow('players: recycle step 2 — create after own presence win', ffaLob({ 0: true, 2: true }, { 0: HOST }), 'rooms/KX7P/players/2', REC('NEW00001'));
deny('players: create without presence (even in lobby)', ffaLob({ 0: true }), 'rooms/KX7P/players/1', REC('GUEST001'));
deny('players: create while playing (missing record mid-match)', db1({ p: { 0: true, 1: true, 2: true }, state: 'playing', seats: 3, players: { 0: HOST, 1: REC('GUEST001') } }, 'ffa'), 'rooms/KX7P/players/2', REC('NEW00001'));
deny('players: id charset invalid', ffaLob({ 0: true, 1: true }), 'rooms/KX7P/players/1', { id: 'bad id!!', name: 'g', tab: 'T0000000' });
allow('players: name up to 48 UTF-16 units (16-grapheme cap is client-side)', ffaLob({ 0: true, 1: true }), 'rooms/KX7P/players/1', { id: 'GUEST001', name: 'x'.repeat(48), tab: 'T0000000' });
deny('players: name too long (>48 units)', ffaLob({ 0: true, 1: true }), 'rooms/KX7P/players/1', { id: 'GUEST001', name: 'x'.repeat(49), tab: 'T0000000' });
deny('players: name empty', ffaLob({ 0: true, 1: true }), 'rooms/KX7P/players/1', { id: 'GUEST001', name: '', tab: 'T0000000' });
deny('players: missing tab', ffaLob({ 0: true, 1: true }), 'rooms/KX7P/players/1', { id: 'GUEST001', name: 'g' });
deny('players: extra field rejected', ffaLob({ 0: true, 1: true }), 'rooms/KX7P/players/1', { id: 'GUEST001', name: 'g', tab: 'T0000000', hack: 1 });
deny('players: seat 5 out of range', ffaLob({ 0: true }), 'rooms/KX7P/players/5', REC('GUEST001'));
deny('players: seat 2 in single (non-ffa)', db1({ p: { 0: true, 2: true } }), 'rooms/KX7P/players/2', REC('GUEST001'));

// ── (10) host presence rejoin: p/0 re-add only with players/0 AND only while the
//        room is really in its lobby/waiting state ──
allow('host rejoin: p/0 re-add in ffa LOBBY', db1({ p: {} }, 'ffa'), 'rooms/KX7P/p/0', true);
deny('host rejoin: p/0 re-add blocked in ffa PLAYING', db1({ p: { 1: true }, state: 'playing', seats: 2 }, 'ffa'), 'rooms/KX7P/p/0', true);
allow('host rejoin: p/0 re-add (single) while still in lobby', db1({ p: {} }), 'rooms/KX7P/p/0', true);
deny('host rejoin: p/0 blocked (single) in PLAYING', db1({ p: { 1: true }, state: 'playing' }), 'rooms/KX7P/p/0', true);
deny('host rejoin: p/0 blocked (double) in PLAYING', db1({ p: { 1: true }, state: 'playing' }, 'double'), 'rooms/KX7P/p/0', true);
deny('players: 1v1 create while playing (no record steal mid-match)', db1({ p: { 0: true, 1: true }, state: 'playing', players: { 0: HOST } }), 'rooms/KX7P/players/1', REC('GUEST001'));
deny('host rejoin: p/0 re-add blocked without players/0', { rooms: { KX7P: { v: V, config: { winTarget: 3, fmt: 'ffa' }, gen: 0, state: 'lobby', p: {}, created: NOW - 5000 } } }, 'rooms/KX7P/p/0', true);
allow('host: p/0 delete still allowed', db1(), 'rooms/KX7P/p/0', null);

console.log('\nRules-Suite (lokal, echte firebase.rules.json): ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
