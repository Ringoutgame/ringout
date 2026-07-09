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
const V = 2;
const mkRoom = (fmt, over = {}) => Object.assign(
  { v: V, config: { winTarget: 3, fmt }, gen: 0, p: { 0: true }, created: NOW },
  fmt === 'ffa' ? { state: 'lobby' } : {}, over);
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
deny('create single WITH state', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { state: 'lobby' }));
deny('create single WITH seats', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { seats: 2 }));
deny('create bad code charset', { rooms: {} }, 'rooms/AAA0', mkRoom('single'));
deny('overwrite existing room', db1(), 'rooms/KX7P', mkRoom('single'));
allow('single: guest join p/1', db1(), 'rooms/KX7P/p/1', true);
allow('single: p/1 overwrite allowed (NOT tightened)', db1({ p: { 0: true, 1: true } }), 'rooms/KX7P/p/1', true);
allow('single: guest delete p/1', db1({ p: { 0: true, 1: true } }), 'rooms/KX7P/p/1', null);
allow('single: host delete p/0', db1(), 'rooms/KX7P/p/0', null);
deny('single: re-set p/0', db1({ p: {} }), 'rooms/KX7P/p/0', true);
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
deny('single: state write rejected', db1(), 'rooms/KX7P/state', 'lobby');
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

console.log('\nRules-Suite (lokal, echte firebase.rules.json): ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
