// Local rules verification: loads the REAL firebase.rules.json and evaluates its
// rule strings (a JS-compatible subset of the RTDB rules language) against
// concrete write scenarios — BEFORE publishing.
// Semantics modeled: .write cascade (any true .write on the path grants),
// .validate on the written node and all written children, deletes skip
// .validate, newData = post-write merged tree (supports parent()).
// Mehrpfad-Updates WERDEN modelliert: tryWrite nimmt die Geschwisterpfade desselben
// update() entgegen, legt sie in den post-Baum (den jede Regel ueber newData sieht,
// nicht aber ueber root/data), und allowMulti/denyMulti verlangen, dass JEDES Bein fuer
// sich erlaubt ist - genau die Semantik von RTDB, wo ein abgelehntes Bein das ganze
// Update verwirft. Der parallele Zwei-Claim-Arbiter bleibt dem echten Emulator in
// tools/e2e/spike.js vorbehalten; er ist eine Nebenlaeufigkeits-, keine Regelfrage.
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
// Angemeldeter Schreiber. Seat-Eigentum haengt an auth.uid, deshalb ist jeder
// Schreibversuch ab jetzt an eine konkrete Identitaet gebunden. `null` modelliert den
// NICHT angemeldeten Client - die Rules lesen dann auth.uid auf einem null-Objekt,
// was in der echten Rules-Sprache schlicht null ergibt und nie einer uid gleicht.
const AUTH = (uid) => (uid ? { uid, provider: 'anonymous' } : { uid: null, provider: null });
const UID_HOST = 'UID_HOST_AAAAAAAAAAAAAAAAAAAA';
const UID_GUEST = 'UID_GUEST_BBBBBBBBBBBBBBBBBB';
const UID_ATTACK = 'UID_ATTACKER_CCCCCCCCCCCCCCC';
// attempts a single-path write against the loaded rules; returns true if allowed
function tryWrite(db, path, value, uid, alsoWrites) {
  const segs = path.split('/');
  const post = JSON.parse(JSON.stringify(db));
  setPath(post, segs, value);
  // Geschwisterpfade DESSELBEN atomaren update(): sie stehen im post-Baum, den jede
  // Regel ueber newData sieht, aber nicht im Vorzustand (root/data).
  if (alsoWrites) for (const k of Object.keys(alsoWrites)) setPath(post, k.split('/'), alsoWrites[k]);
  const auth = AUTH(uid === undefined ? UID_GUEST : uid);
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
const V = 4;   // Protokoll v4
const GRACE = 15000;
const H_TAB = 'HOSTTAB0', G_TAB = 'GTAB0001', G2_TAB = 'GTAB0002';
// Durable roster records; players/<seat>.tab MUST equal p/<seat>.s (coupling).
// v4: jeder Rostereintrag traegt seinen Eigentuemer. Die Basisfixtures benutzen die
// Standardidentitaet des Harness (UID_GUEST), damit die bestehenden Einzelwrites
// weiterhin vom Standardschreiber ausgehen; die Eigentumsgruppen unten setzen ihre
// uids ausdruecklich.
const HOST = { id: 'HOST0000', name: 'Host', tab: H_TAB, uid: UID_GUEST };
const REC = (id, tab) => ({ id: id || 'GUEST001', name: 'G', tab: tab || G_TAB, uid: UID_GUEST });
// Zwei Rostersaetze mit AUSDRUECKLICH verschiedenen Eigentuemern - noetig ueberall dort,
// wo Eigentum die eigentliche Aussage ist (Host gegen Gast gegen Fremden).
const RO_H = { id: 'HOST0000', name: 'Host', tab: H_TAB, uid: UID_HOST };
const RO_G = { id: 'GUEST001', name: 'G', tab: G_TAB, uid: UID_GUEST };
// Ein LAUFENDER Fuenf-Spieler-Football-Raum: Sitz 3 steht lange genug offline, dass ein
// Peer ihn evictieren duerfte. Wird fuer die atomaren Mehrpfadangriffe gebraucht, die
// oberhalb des Football-Blocks stehen.
const FB_UID = [0, 1, 2, 3, 4].map(i => 'UID_FB' + i + '_XXXXXXXXXXXXXXXXX');
const FB_UID0 = FB_UID[0];
const FB_ATTACK = (() => {
  const p = {}, players = {};
  for (let i = 0; i < 5; i++) {
    p[i] = { s: 'FBTAB00' + i, on: i !== 3, t: i === 3 ? NOW - GRACE - 1 : NOW };
    players[i] = { id: 'FBPID00' + i, name: 'P' + i, tab: 'FBTAB00' + i, uid: FB_UID[i] };
  }
  return { v: V, config: { game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'private' },
           gen: 0, state: 'playing', seats: 5, p, players, created: NOW - 5000 };
})();
// Presence object. t must equal `now` on any real write; fixtures may pre-seed
// an older t to model a seat that has been offline for a while.
const P = (s, on, t) => ({ s, on: !!on, t: (t === undefined ? NOW : t) });
// Unified room-state: EVERY mode is created with state:'lobby' and an OFFLINE
// host presence (p/0.on === false) — the host ACTIVATEs right after create.
const mkRoom = (fmt, over = {}) => Object.assign(
  { v: V, config: { game: 'ringout', winTarget: 3, fmt, visibility: 'private' }, gen: 0, state: 'lobby', p: { 0: P(H_TAB, false) }, players: { 0: HOST }, created: NOW },
  over);
const db1 = (roomOver = {}, fmt = 'single') => ({ rooms: { KX7P: mkRoom(fmt, Object.assign({ created: NOW - 5000 }, roomOver)) } });
const MOVE = { idx: 0, dx: 100, dy: -50, sp: 0.5 };

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const allow = (name, db, path, v, uid, also) => t('[ALLOW] ' + name, tryWrite(db, path, v, uid, also) === true);
const deny = (name, db, path, v, uid, also) => t('[DENY]  ' + name, tryWrite(db, path, v, uid, also) === false);
// Ein atomares update() ist erst dann erlaubt, wenn JEDER seiner Pfade fuer sich erlaubt
// ist - jeweils gegen den zusammengefuehrten Ergebnisbaum. deny bedeutet hier: mindestens
// ein Bein wird abgelehnt, das Update scheitert also vollstaendig.
const multi = (db, writes, uid) => Object.keys(writes).every(k => {
  const others = {}; for (const o of Object.keys(writes)) if (o !== k) others[o] = writes[o];
  return tryWrite(db, k, writes[k], uid, others);
});
const allowMulti = (name, db, writes, uid) => t('[ALLOW] ' + name, multi(db, writes, uid) === true);
const denyMulti = (name, db, writes, uid) => t('[DENY]  ' + name, multi(db, writes, uid) === false);

// ── (1) room creation — v3 object presence, offline host, atomic identity ──
allow('create single', { rooms: {} }, 'rooms/KX7P', mkRoom('single'));
allow('create double', { rooms: {} }, 'rooms/KX7P', mkRoom('double', { config: { game: 'ringout', winTarget: 5, fmt: 'double', visibility: 'private' } }));
allow('create ffa', { rooms: {} }, 'rooms/KX7P', mkRoom('ffa'));
deny('create v1 (old protocol)', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { v: 1 }));
deny('create fmt triple', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { config: { game: 'ringout', winTarget: 3, fmt: 'triple' } }));
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
allow('players/1 same-id update (name change)', db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) }, players: { 0: HOST, 1: { id: 'GUEST001', name: 'old', tab: G_TAB, uid: UID_GUEST } } }), 'rooms/KX7P/players/1', { id: 'GUEST001', name: 'Neu', tab: G_TAB, uid: UID_GUEST });
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

// ── (8b) state/seats gehoeren dem Host bzw. dem beitretenden Gast ──
// Beide Knoten sind Startsignale: state oeffnet das Match, seats ist write-once und
// legt die Teilnehmerzahl fest. Ohne Eigentumspruefung koennte ein Fremder ein Match
// vorzeitig und mit falscher Besetzung starten - oder weitere Beitritte aussperren.
{
  const ST = (over) => db1(Object.assign({ players: { 0: RO_H, 1: RO_G },
    p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, over || {}), 'ffa');
  allow('the host may start the match', ST(), 'rooms/KX7P/state', 'playing', UID_HOST);
  deny('an outsider cannot start the match', ST(), 'rooms/KX7P/state', 'playing', UID_ATTACK);
  deny('an unauthenticated client cannot start the match', ST(), 'rooms/KX7P/state', 'playing', null);
  // Die Sitz-1-Freigabe existiert fuer den atomaren 1v1/2v2-Beitritt. In einer
  // mehrsitzigen Lobby waere sie ein Startknopf fuer den Gast: er schliesst die Lobby,
  // und danach kommt niemand mehr herein.
  deny('an FFA guest on seat 1 cannot start the match alone', ST(), 'rooms/KX7P/state', 'playing', UID_GUEST);
  deny('a football guest cannot start the match alone',
    { rooms: { KX7P: Object.assign({}, FB_ATTACK, { state: 'lobby', seats: null }) } },
    'rooms/KX7P/state', 'playing', FB_UID[1]);
  allow('a 1v1 guest still starts the match with its own claim',
    db1({ players: { 0: RO_H, 1: RO_G }, p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }),
    'rooms/KX7P/state', 'playing', UID_GUEST);
  const SE = (over) => db1(Object.assign({ state: 'playing', players: { 0: RO_H, 1: RO_G },
    p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, over || {}), 'ffa');
  allow('the host may write seats', SE(), 'rooms/KX7P/seats', 2, UID_HOST);
  deny('an outsider cannot write seats', SE(), 'rooms/KX7P/seats', 2, UID_ATTACK);
  deny('an unauthenticated client cannot write seats', SE(), 'rooms/KX7P/seats', 2, null);
  deny('a guest cannot write seats', SE(), 'rooms/KX7P/seats', 2, UID_GUEST);
  // Bewusst KEINE Lebendigkeitspruefung: der Startpfad schreibt state und seats
  // nacheinander. Flackerte die Praesenz des Hosts dazwischen, bliebe der Raum in
  // 'playing' ohne Startsignal stehen - state ist einwegig und nicht wiederholbar.
  // Eigentum genuegt; wer schreibt, ist ohnehin verbunden.
  allow('a host whose presence flickers may still write seats',
    SE({ p: { 0: P(H_TAB, false), 1: P(G_TAB, true) } }), 'rooms/KX7P/seats', 2, UID_HOST);
}

// ── (9) gen + seats regression ──
// v4: der Generationswechsel ist ein Rematch und gehoert einem aktiven Teilnehmer des
// Raums. Sonst koennte ein Fremder per gen+1 jede gesetzte Eviction entwerten.
const genDb = db1({ p: { 0: P(H_TAB, true) } });
allow('gen increment 0->1 by an active participant', genDb, 'rooms/KX7P/gen', 1, UID_GUEST);
deny('gen increment by an outsider', genDb, 'rooms/KX7P/gen', 1, UID_ATTACK);
deny('gen increment unauthenticated', genDb, 'rooms/KX7P/gen', 1, null);
deny('gen increment by a participant who is offline',
  db1({ p: { 0: P(H_TAB, false) } }), 'rooms/KX7P/gen', 1, UID_GUEST);
// Defensiv: die Generationsregel haengt ausdruecklich an v===4. Ein Raum niedrigerer
// Version kann zwar gar nicht entstehen (die Erstellungsregel verlangt v===4, und v ist
// danach unveraenderlich) - aber der Vertrag soll auch dann nicht offenstehen, wenn je
// ein Altbestand auftaucht. Vorher stand hier eine wirkungslose Ausnahme, die sich wie
// ein offener Pfad las.
deny('gen in a pre-v4 room, unauthenticated',
  db1({ v: 3, p: { 0: P(H_TAB, true) } }), 'rooms/KX7P/gen', 1, null);
deny('gen in a pre-v4 room, by an active participant',
  db1({ v: 3, p: { 0: P(H_TAB, true) } }), 'rooms/KX7P/gen', 1, UID_GUEST);
// Ohne diese Sperre waere die gesamte Eviction wirkungslos: der Marker haengt an der
// GENERATION - wer sie erhoehen darf, entkommt seiner eigenen Sperre und darf in der
// frischen Generation sofort wieder evictieren.
deny('an evicted participant cannot bump the generation',
  db1({ p: { 0: P(H_TAB, true) }, g: { 0: { e: { 0: true } } } }), 'rooms/KX7P/gen', 1, UID_GUEST);
// ATOMARER Angriff: die Eviction und der Generationswechsel im SELBEN update(). Prueft die
// gen-Regel nur den Vorzustand, ist die Sperre noch nicht gesetzt und der Wechsel gelingt -
// in der frischen Generation gaebe es dann gar keine Eviction mehr.
denyMulti('self-eviction and generation bump in ONE atomic update',
  { rooms: { KX7P: Object.assign({}, FB_ATTACK) } },
  { 'rooms/KX7P/g/0/e/0': true, 'rooms/KX7P/gen': 1 }, FB_UID0);
// Gegenprobe zur Fixture selbst: das Eviction-Bein waere fuer sich GENOMMEN erlaubt.
// Ohne diese Zeile koennte der Test oben auch dann gruen sein, wenn er an etwas ganz
// anderem scheitert als an der Kopplung, die er behauptet zu pruefen.
allow('...but that self-eviction alone is perfectly legal',
  { rooms: { KX7P: Object.assign({}, FB_ATTACK) } }, 'rooms/KX7P/g/0/e/0', true, FB_UID0);
// Dieselbe Masche eine Ebene tiefer: die eigene Eviction im SELBEN Update wie die
// Peer-Handlung. Liest die Peer-Sperre nur den Vorzustand, ist sie dort noch nicht
// gesetzt - und ein Ausscheidender koennte im Abgang noch reihum aufraeumen.
denyMulti('self-eviction and evicting a PEER in one atomic update',
  { rooms: { KX7P: Object.assign({}, FB_ATTACK) } },
  { 'rooms/KX7P/g/0/e/0': true, 'rooms/KX7P/g/0/e/3': true }, FB_UID0);
// Auch der EIGENE Sitz darf sich nicht im selben Write ausscheiden lassen und trotzdem
// noch handeln: der write-once-Slot waere sonst mit einem echten Zug belegt, obwohl der
// Sitz raus ist - REMOVE kaeme nicht mehr hinein und die Runde stuende.
denyMulti('self-eviction and OWN MOVE in one atomic update',
  { rooms: { KX7P: Object.assign({}, FB_ATTACK) } },
  { 'rooms/KX7P/g/0/e/0': true,
    'rooms/KX7P/g/0/t/0/0': { k: 'move', idx: 0, dx: 10, dy: -10, sp: 0 } }, FB_UID0);
// ... und ebensowenig im selben Write die eigene Praesenz erneuern.
denyMulti('self-eviction and OWN presence reactivation in one atomic update',
  { rooms: { KX7P: (() => { const r = JSON.parse(JSON.stringify(FB_ATTACK));
      r.p[0] = { s: 'FBTAB000', on: false, t: NOW - 1000 }; return r; })() } },
  { 'rooms/KX7P/g/0/e/0': true,
    'rooms/KX7P/p/0': { s: 'FBTAB000', on: true, t: NOW } }, FB_UID0);
// SKIP ueberbrueckt eine Runde, REMOVE entfernt endgueltig - beide belegen DENSELBEN
// write-once-Slot. Wer den Sitz im selben Write evictiert und ihn zugleich ueberspringt,
// belegt den Slot mit der falschen Bedeutung: das vorgeschriebene REMOVE kommt nicht mehr
// hinein, Marker und Zughistorie widersprechen sich, und die Runde stuende.
denyMulti('evicting a seat and SKIPPING it in the same atomic update',
  { rooms: { KX7P: Object.assign({}, FB_ATTACK) } },
  { 'rooms/KX7P/g/0/e/3': true,
    'rooms/KX7P/g/0/t/0/3': { k: 'skip', idx: 3, dx: 0, dy: 0, sp: 0 } }, FB_UID0);
denyMulti('self-eviction and SKIPPING a peer in one atomic update',
  { rooms: { KX7P: Object.assign({}, FB_ATTACK) } },
  { 'rooms/KX7P/g/0/e/0': true,
    'rooms/KX7P/g/0/t/0/3': { k: 'skip', idx: 3, dx: 0, dy: 0, sp: 0 } }, FB_UID0);
// Gegenprobe zu allen Kopplungen oben: derselbe Generationswechsel OHNE eine
// Selbst-Eviction im selben Update bleibt selbstverstaendlich erlaubt.
allowMulti('a plain rematch generation bump stays allowed',
  { rooms: { KX7P: Object.assign({}, FB_ATTACK) } }, { 'rooms/KX7P/gen': 1 }, FB_UID0);
deny('gen jump 0->5', db1(), 'rooms/KX7P/gen', 5);
allow('ffa seats=3 after start', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true), 2: P(G2_TAB, true) } }, 'ffa'), 'rooms/KX7P/seats', 3);
allow('ffa seats=2 (min)', db1({ state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }, 'ffa'), 'rooms/KX7P/seats', 2);
// BESTANDSFORMATE: seats bleibt eine reine Zahlenpruefung - genau wie ausgeliefert.
// Eine Praesenzbindung waere hier zwar strenger, wuerde aber ein legitimes Startrennen
// (jemand geht zwischen state und seats kurz offline) neu scheitern lassen; der Raum
// bliebe dann in 'playing' ohne Startsignal stehen. Football bekommt die strenge
// Bindung, weil sein Produktvertrag genau fuenf Sitze verlangt (s. Gruppe 14).
const FFA5 = (n) => { const p = {}; for (let i = 0; i < n; i++) p[i] = P('TAB' + i, true); return db1({ state: 'playing', p }, 'ffa'); };
allow('ffa seats=5 with five active seats', FFA5(5), 'rooms/KX7P/seats', 5);
allow('ffa seats stays a plain range check (unchanged shipped behaviour)', FFA5(2), 'rooms/KX7P/seats', 5);
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
// WICHTIG: jede Fixture hier traegt players/0 UND players/1 mit AUSDRUECKLICH
// VERSCHIEDENEN Eigentuemern. Ohne den Rosterdatensatz des Ziels scheiterte der Write
// bereits an players/<seat>.exists(), und ohne getrennte uids waere der "Peer" in
// Wahrheit der Eigentuemer - der Test bewiese ueber den Raumtyp dann gar nichts.
const RO_EV = (pOver, fmt) => playing({ players: { 0: RO_H, 1: RO_G },
  p: pOver || { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - 16000) } }, fmt);
// RingOut kennt kein REMOVE: eine dort gesetzte Eviction waere eine Sperre, die kein
// RingOut-Pfad je aufloest - sie wuerde Praesenz-Reaktivierung und weitere Zuege des
// Sitzes dauerhaft blockieren. Der Marker gehoert deshalb ausschliesslich Football.
deny('RingOut 1v1: a peer cannot evict a stale offline seat', RO_EV(), 'rooms/KX7P/g/0/e/1', true, UID_HOST);
deny('RingOut 1v1: a seat cannot evict ITSELF', RO_EV(), 'rooms/KX7P/g/0/e/1', true, UID_GUEST);
deny('RingOut 1v1: the host cannot evict itself either',
  RO_EV({ 0: P(H_TAB, true), 1: P(G_TAB, true) }), 'rooms/KX7P/g/0/e/0', true, UID_HOST);
deny('RingOut FFA: a peer cannot evict a stale offline seat', RO_EV(null, 'ffa'), 'rooms/KX7P/g/0/e/1', true, UID_HOST);
// Der wichtigste RingOut-Fall: ein LAUFENDES FFA mit fuenf Sitzen. Es traegt seats===5 wie
// ein Football-Match und erfuellt damit das Startsignal-Gate - abgelehnt wird es allein,
// weil der Eviction-Pfad ausschliesslich Football-Raeumen gehoert. Ohne diesen Test bliebe
// die Raumtyp-Bedingung unbewiesen.
const FFA_FULL = (() => { const p = {}, players = {};
  for (let i = 0; i < 5; i++) {
    p[i] = { s: 'FFATAB0' + i, on: i !== 1, t: i === 1 ? NOW - GRACE - 1 : NOW };
    players[i] = { id: 'FFAPID0' + i, name: 'P' + i, tab: 'FFATAB0' + i, uid: 'UID_FFA' + i + '_YYYYYYYYYYYYYYYY' };
  }
  return db1({ state: 'playing', seats: 5, p, players }, 'ffa'); })();
deny('RingOut FFA with five seats: a peer still cannot evict',
  FFA_FULL, 'rooms/KX7P/g/0/e/1', true, 'UID_FFA0_YYYYYYYYYYYYYYYY');
deny('RingOut FFA with five seats: a seat cannot evict itself',
  FFA_FULL, 'rooms/KX7P/g/0/e/0', true, 'UID_FFA0_YYYYYYYYYYYYYYYY');
// Die uebrigen Bedingungen des Pfades stehen im Football-Block (Gruppe 14) - nur
// dort ist er ueberhaupt erreichbar.

// ── (12) room delete — only when NO p and NO players anchor remains ──
deny('room delete blocked: p anchor present', db1(), 'rooms/KX7P', null);
deny('room delete blocked: players anchor present (p empty)', db1({ p: {} }), 'rooms/KX7P', null);
allow('room delete when fully empty (no p, no players)', db1({ p: {}, players: {} }), 'rooms/KX7P', null);
deny('room delete non-existent', { rooms: {} }, 'rooms/KX7P', null);

// ── (13) config.visibility — mandatory, exactly 'private' | 'public' ──
deny('create room WITHOUT visibility', { rooms: {} }, 'rooms/KX7P', (() => { const r = mkRoom('single'); r.config = { winTarget: 3, fmt: 'single' }; return r; })());
deny('create room bad visibility value', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: 'secret' } }));
allow('create room visibility public', { rooms: {} }, 'rooms/KX7P', mkRoom('single', { config: { game: 'ringout', winTarget: 3, fmt: 'single', visibility: 'public' } }));

// ── (14) publicRooms discovery index — write-once create, stale-only delete ──
// A listable public room: v3, config.visibility 'public', state 'lobby', host online,
// younger than 2h. The listing itself is exactly { created: now } — nothing else.
const PUB_ROOM = (over = {}) => mkRoom('ffa', Object.assign({ created: NOW - 5000, config: { game: 'ringout', winTarget: 3, fmt: 'ffa', visibility: 'public' }, p: { 0: P(H_TAB, true) } }, over));
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

// ── (12) SEAT-OWNERSHIP: auth.uid ist der einzige Eigentumsbeweis ─────────────────
// Der Angreifer kennt ALLES, was oeffentlich lesbar ist: Raumcode, Sitznummer, die
// dauerhafte players.id des Opfers, dessen Namen und dessen Tab-Token. Er hat nur
// eine andere auth.uid. Genau das muss reichen, um ihn auszusperren.
{
  const OWNED = (uid, id, tab) => ({ id: id || 'GUEST001', name: 'G', tab: tab || G_TAB, uid });
  const HOST_OWNED = { id: 'HOST0000', name: 'Host', tab: H_TAB, uid: UID_HOST };
  // Raum, dessen beide Sitze echten Eigentuemern gehoeren.
  const owned = (over, fmt) => db1(Object.assign({
    players: { 0: HOST_OWNED, 1: OWNED(UID_GUEST) },
    p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - GRACE - 1) },
  }, over), fmt);
  const ownedPlaying = (over, fmt) => owned(Object.assign({ state: 'playing' }, over), fmt);

  // -- Raumanlage bindet den Hostsitz an die eigene uid --------------------------
  allow('create binds host seat to own uid', { rooms: {} }, 'rooms/KX7P',
    mkRoom('single', { players: { 0: HOST_OWNED } }), UID_HOST);
  deny('create with FOREIGN uid on the host seat', { rooms: {} }, 'rooms/KX7P',
    mkRoom('single', { players: { 0: HOST_OWNED } }), UID_ATTACK);
  deny('create with uid while NOT signed in', { rooms: {} }, 'rooms/KX7P',
    mkRoom('single', { players: { 0: HOST_OWNED } }), null);

  // -- players/<seat>: Eigentum ist unveraenderlich ------------------------------
  deny('attacker rewrites victim roster record (knows id, name, tab)',
    owned(), 'rooms/KX7P/players/1', OWNED(UID_ATTACK), UID_ATTACK);
  deny('attacker rewrites victim roster record KEEPING the victim uid',
    owned(), 'rooms/KX7P/players/1', OWNED(UID_GUEST), UID_ATTACK);
  deny('owner cannot swap the uid of an owned seat',
    owned(), 'rooms/KX7P/players/1', OWNED(UID_ATTACK), UID_GUEST);
  deny('uid field must equal the writer auth.uid',
    owned({ players: { 0: HOST_OWNED } }), 'rooms/KX7P/players/1',
    OWNED(UID_ATTACK, 'GUEST001', G2_TAB), UID_GUEST);
  // v4 kennt keinen uid-losen Rostereintrag mehr: er ist schon strukturell unzulaessig.
  // Damit entfaellt die gesamte Klasse "Sitz ohne Eigentuemer, den jeder bedienen darf".
  deny('a v4 roster record WITHOUT an owner is structurally invalid',
    db1({ p: { 0: P(H_TAB, false), 1: P(G_TAB, false) } }),
    'rooms/KX7P/players/1', { id: 'GUEST001', name: 'G', tab: G_TAB }, UID_GUEST);

  // -- p/<seat>: Praesenz gehoert dem Sitzeigentuemer ----------------------------
  deny('attacker ACTIVATES the victim presence',
    owned({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false) } }), 'rooms/KX7P/p/1',
    P(G_TAB, true), UID_ATTACK);
  allow('owner ACTIVATES its own presence',
    owned({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false) } }, 'ffa'), 'rooms/KX7P/p/1',
    P(G_TAB, true), UID_GUEST);
  deny('attacker RECLAIMS the victim seat mid-match (new tab token)',
    ownedPlaying(), 'rooms/KX7P/p/1', P(G2_TAB, false), UID_ATTACK);
  deny('attacker RECLAIMS the victim seat in the lobby after the stale window',
    owned(), 'rooms/KX7P/p/1', P(G2_TAB, false), UID_ATTACK);
  deny('presence write while NOT signed in',
    owned({ p: { 0: P(H_TAB, true), 1: P(G_TAB, false) } }, 'ffa'), 'rooms/KX7P/p/1',
    P(G_TAB, true), null);

  // -- Zugdaten: nur der Sitzeigentuemer schreibt seinen Slot --------------------
  const live = ownedPlaying({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } });
  allow('owner writes its own turn slot', live, 'rooms/KX7P/g/0/t/0/1', MOVE, UID_GUEST);
  deny('attacker writes the victim turn slot', live, 'rooms/KX7P/g/0/t/0/1', MOVE, UID_ATTACK);
  deny('host cannot write the guest turn slot', live, 'rooms/KX7P/g/0/t/0/1', MOVE, UID_HOST);
  deny('turn slot write while NOT signed in', live, 'rooms/KX7P/g/0/t/0/1', MOVE, null);
  allow('host writes its OWN turn slot', live, 'rooms/KX7P/g/0/t/0/0', MOVE, UID_HOST);

  // -- In v4 traegt JEDER Sitz seinen Eigentuemer -------------------------------
  // Der Zugslot eines uid-losen Sitzes waere fuer jeden Angemeldeten offen. In v4 kann ein
  // solcher Sitz nicht mehr entstehen; die Regel bleibt als Rueckfall nur fuer den Fall
  // stehen, dass ein Bestandsraum niedrigerer Version noch gelesen wird.
  const owned2 = db1({ state: 'playing', players: { 0: HOST, 1: OWNED(UID_GUEST) },
                       p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } });
  allow('the seat owner writes its own turn', owned2, 'rooms/KX7P/g/0/t/0/1', MOVE, UID_GUEST);
  deny('a foreign uid cannot write that turn', owned2, 'rooms/KX7P/g/0/t/0/1', MOVE, UID_ATTACK);

  // -- Grenze des Same-uid-Modells: ein AKTIVER Sitz ist auch fuer den Eigentuemer
  //    nicht uebernehmbar. Zwei Tabs derselben Person teilen sich zwar die uid, aber
  //    der Reclaim verlangt data.on === false - ein laufender Tab wird nie verdraengt.
  deny('same uid cannot take over its OWN seat while it is active (on:true)',
    ownedPlaying({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } }), 'rooms/KX7P/p/1',
    P(G2_TAB, false), UID_GUEST);
  deny('same uid cannot take over an active seat in the lobby either',
    owned({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true, NOW - GRACE - 1) } }), 'rooms/KX7P/p/1',
    P(G2_TAB, false), UID_GUEST);
  // Offline ist der Reclaim erlaubt - genau das ist der Reconnect-Pfad. Er ist ein
  // ATOMARER p+players-Write; hier steht der Roster-Teil bereits auf dem neuen Token,
  // so wie ihn derselbe Write mitbringt.
  allow('same uid reclaims its OWN offline seat mid-match',
    ownedPlaying({ players: { 0: HOST_OWNED, 1: OWNED(UID_GUEST, 'GUEST001', G2_TAB) } }),
    'rooms/KX7P/p/1', P(G2_TAB, false), UID_GUEST);
  deny('a FOREIGN uid cannot do the same reclaim even with a matching roster leg',
    ownedPlaying({ players: { 0: HOST_OWNED, 1: OWNED(UID_GUEST, 'GUEST001', G2_TAB) } }),
    'rooms/KX7P/p/1', P(G2_TAB, false), UID_ATTACK);

  // -- Der 15-s-Lobby-Recycle darf Eigentum UEBERTRAGEN, nie ENTFERNEN ------------
  // Ein abgelaufener Lobbysitz darf neu vergeben werden - das ist die Ausnahme, die eine
  // verwaiste Lobby nicht dauerhaft blockiert. Sie ist aber nur fuer einen ANGEMELDETEN
  // Uebernehmer gedacht, der sein eigenes Eigentum eintraegt. Wird die uid dabei einfach
  // weggelassen, waere sie fuer einen unangemeldeten Client wahr (auth.uid und eine
  // fehlende uid sind beide null) - der Sitz verloere sein Eigentum und stuende danach
  // ueber den Legacy-Pfad jedem offen.
  // Diese Gruppe stellt den atomaren Write ueber die Fixture nach: p/1 traegt bereits das
  // NEUE Token, aber noch den ALTEN Zeitstempel - genau die Sicht, die die Regel im
  // atomaren Write hat. ALLE
  // Faelle hier benutzen dieselbe Paarung, damit ueber sie ausschliesslich das EIGENTUM
  // entscheidet und nicht schon die p.s/players.tab-Kopplung.
  const stalePaired = owned({ p: { 0: P(H_TAB, true), 1: { s: G2_TAB, on: false, t: NOW - GRACE - 1 } } });
  const claimNoUid = { id: 'NEWPID01', name: 'n', tab: G2_TAB };
  const claimOwn = { id: 'NEWPID01', name: 'n', tab: G2_TAB, uid: UID_ATTACK };
  deny('UNAUTH strips ownership off a stale lobby seat (uid dropped)',
    stalePaired, 'rooms/KX7P/players/1', claimNoUid, null);
  deny('signed-in stranger strips ownership off a stale lobby seat (uid dropped)',
    stalePaired, 'rooms/KX7P/players/1', claimNoUid, UID_ATTACK);
  allow('signed-in stranger MAY take a stale lobby seat with its OWN uid',
    stalePaired, 'rooms/KX7P/players/1', claimOwn, UID_ATTACK);
  deny('...but not while the seat is still active',
    owned({ p: { 0: P(H_TAB, true), 1: { s: G2_TAB, on: true, t: NOW - GRACE - 1 } } }),
    'rooms/KX7P/players/1', claimOwn, UID_ATTACK);
  deny('...and not before the stale window has passed',
    owned({ p: { 0: P(H_TAB, true), 1: { s: G2_TAB, on: false, t: NOW - 1000 } } }),
    'rooms/KX7P/players/1', claimOwn, UID_ATTACK);
  // Das PRAESENZBEIN derselben Uebernahme laesst sich hier nicht ehrlich pruefen: es
  // haengt daran, dass players/<seat> im SELBEN Mehrpfad-Write bereits uid-los ist,
  // waehrend root noch das Eigentum des Opfers zeigt. Der Harness bildet Mehrpfad-Writes
  // als Einzelwrites ab (s. Kopf der Datei) und kann diese Sicht nicht herstellen. Die
  // Regel traegt die Bedingung (p/$i verlangt eine GESETZTE eigene uid im Roster-Bein);
  // der atomare Fall gehoert in tools/e2e/spike.js gegen den echten Emulator.

  // -- Verlassen: der Eigentuemer darf seinen Sitz raeumen ------------------------
  // Ein isolierter Praesenz-Delete bleibt auch fuer den Eigentuemer verboten: p und
  // players muessen im SELBEN Write verschwinden (bestehende atomare Kopplung, im
  // Emulator-Spike bewiesen). Eigentum lockert diese Regel nicht.
  deny('owner cannot delete presence alone (atomic p+players coupling holds)',
    owned(), 'rooms/KX7P/p/1', null, UID_GUEST);
  allow('owner deletes its own presence once the roster leg is gone',
    owned({ players: { 0: HOST_OWNED } }), 'rooms/KX7P/p/1', null, UID_GUEST);
  allow('owner deletes its own roster record',
    owned({ p: { 0: P(H_TAB, true) } }), 'rooms/KX7P/players/1', null, UID_GUEST);
  deny('attacker deletes the victim roster record',
    owned({ p: { 0: P(H_TAB, true) } }), 'rooms/KX7P/players/1', null, UID_ATTACK);
}

// ── (14) PROTOKOLL v4 · FOOTBALL-RAUM, TYPISIERTE ZUEGE, EVICTION ────────────────
// Football ist serverseitig ein EIGENER Raumtyp. Die Gruppe prueft, dass er genau die
// Rechte bekommt, die er braucht - und dass kein bestehender RingOut-Raum dadurch
// breiter wird. Angreifermodell wie oben: der Fremde kennt alles Oeffentliche und hat
// nur eine andere auth.uid.
{
  const UID = { 0: 'UID_S0_AAAAAAAAAAAAAAAAAAA', 1: 'UID_S1_BBBBBBBBBBBBBBBBBBB',
                2: 'UID_S2_CCCCCCCCCCCCCCCCCCC', 3: 'UID_S3_DDDDDDDDDDDDDDDDDDD',
                4: 'UID_S4_EEEEEEEEEEEEEEEEEEE' };
  const TAB = { 0: 'FTAB0000', 1: 'FTAB0001', 2: 'FTAB0002', 3: 'FTAB0003', 4: 'FTAB0004' };
  const REC5 = (i) => ({ id: 'FPID000' + i, name: 'P' + i, tab: TAB[i], uid: UID[i] });
  // Football-Raum: fuenf Sitze, alle online, laufendes Match.
  const fbRoom = (over = {}) => ({
    rooms: { KX7P: Object.assign({
      v: V, config: { game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'private' },
      gen: 0, state: 'playing', seats: 5,
      p: { 0: P(TAB[0], true), 1: P(TAB[1], true), 2: P(TAB[2], true), 3: P(TAB[3], true), 4: P(TAB[4], true) },
      players: { 0: REC5(0), 1: REC5(1), 2: REC5(2), 3: REC5(3), 4: REC5(4) },
      created: NOW - 5000,
    }, over) } });
  const OFFLINE = (seat, age) => { const p = {}; for (let i = 0; i < 5; i++) p[i] = P(TAB[i], i !== seat);
    p[seat] = { s: TAB[seat], on: false, t: NOW - (age === undefined ? GRACE + 1 : age) }; return { p }; };
  const MV = (seat) => ({ k: 'move', idx: seat, dx: 100, dy: -50, sp: 0.5 });
  const SK = (seat) => ({ k: 'skip', idx: seat, dx: 0, dy: 0, sp: 0 });
  const RM = (seat) => ({ k: 'remove', idx: seat, dx: 0, dy: 0, sp: 0 });

  // -- Raumanlage --------------------------------------------------------------
  const fbNew = { v: V, config: { game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'private' },
    gen: 0, state: 'lobby', p: { 0: P(TAB[0], false) }, players: { 0: REC5(0) }, created: NOW };
  allow('v4 Football room create', { rooms: {} }, 'rooms/KX7P', fbNew, UID[0]);
  deny('Football room with a RingOut fmt', { rooms: {} }, 'rooms/KX7P',
    Object.assign({}, fbNew, { config: { game: 'football', winTarget: 3, fmt: 'ffa', visibility: 'private' } }), UID[0]);
  deny('RingOut room with the Football fmt', { rooms: {} }, 'rooms/KX7P',
    Object.assign({}, fbNew, { config: { game: 'ringout', winTarget: 3, fmt: 'elimination', visibility: 'private' } }), UID[0]);
  deny('room without a game type', { rooms: {} }, 'rooms/KX7P',
    Object.assign({}, fbNew, { config: { winTarget: 3, fmt: 'elimination', visibility: 'private' } }), UID[0]);
  deny('room with an unknown game type', { rooms: {} }, 'rooms/KX7P',
    Object.assign({}, fbNew, { config: { game: 'arcade', winTarget: 3, fmt: 'single', visibility: 'private' } }), UID[0]);

  // -- Fuenf Sitze, aber KEIN sechster -----------------------------------------
  // Der Beitritt ist ein ATOMARER p+players-Write; die Praesenz traegt hier bereits das
  // Token dieses Sitzes, so wie es derselbe Write mitbringt (s. Kopf der Datei).
  for (let i = 1; i < 5; i++)
    allow('Football seat ' + i + ' may be reserved', { rooms: { KX7P: Object.assign({}, fbNew, {
        p: { 0: P(TAB[0], true), [i]: P(TAB[i], false) }, players: { 0: REC5(0) } }) } },
      'rooms/KX7P/players/' + i, REC5(i), UID[i]);
  // Entscheidend ist die PRAESENZ: p/$i traegt die eigentliche Sitzbereichspruefung.
  // Ohne sie waere der Fuenf-Sitz-Vertrag bei einem echten Beitritt gar nicht erreichbar.
  for (let i = 1; i < 5; i++)
    allow('Football presence for seat ' + i + ' is reachable', { rooms: { KX7P: Object.assign({}, fbNew, {
        players: { 0: REC5(0), [i]: REC5(i) }, p: { 0: P(TAB[0], true) } }) } },
      'rooms/KX7P/p/' + i, P(TAB[i], false), UID[i]);
  deny('RingOut single keeps its presence seat range', db1(), 'rooms/KX7P/p/2',
    P(G2_TAB, false), UID_GUEST);
  deny('Football seat 5 is not a participant', fbRoom(), 'rooms/KX7P/players/5',
    { id: 'FPID0005', name: 'X', tab: 'FTAB0005', uid: 'UID_X' }, 'UID_X');
  deny('Football seat 5 has no presence', fbRoom(), 'rooms/KX7P/p/5', P('FTAB0005', false), 'UID_X');
  deny('Football seat 5 has no turn slot', fbRoom(), 'rooms/KX7P/g/0/t/0/5', MV(5), 'UID_X');
  deny('RingOut single stays a two-seat room', db1(), 'rooms/KX7P/players/2',
    { id: 'GUEST002', name: 'g', tab: G2_TAB, uid: 'UID_G2' }, 'UID_G2');

  // -- MOVE ---------------------------------------------------------------------
  allow('Football MOVE by the seat owner', fbRoom(), 'rooms/KX7P/g/0/t/0/2', MV(2), UID[2]);
  deny('Football MOVE by a foreign uid', fbRoom(), 'rooms/KX7P/g/0/t/0/2', MV(2), UID[3]);
  deny('Football MOVE by an outsider', fbRoom(), 'rooms/KX7P/g/0/t/0/2', MV(2), 'UID_OUT');
  deny('Football MOVE unauthenticated', fbRoom(), 'rooms/KX7P/g/0/t/0/2', MV(2), null);
  deny('Football MOVE claiming a FOREIGN figure', fbRoom(), 'rooms/KX7P/g/0/t/0/2',
    { k: 'move', idx: 3, dx: 10, dy: 10, sp: 0 }, UID[2]);
  deny('Football MOVE claiming the NEUTRAL BALL', fbRoom(), 'rooms/KX7P/g/0/t/0/2',
    { k: 'move', idx: 5, dx: 10, dy: 10, sp: 0 }, UID[2]);
  deny('Football MOVE with idx 6', fbRoom(), 'rooms/KX7P/g/0/t/0/2',
    { k: 'move', idx: 6, dx: 10, dy: 10, sp: 0 }, UID[2]);
  deny('Football MOVE without a kind', fbRoom(), 'rooms/KX7P/g/0/t/0/2',
    { idx: 2, dx: 10, dy: 10, sp: 0 }, UID[2]);
  deny('Football MOVE with an unknown kind', fbRoom(), 'rooms/KX7P/g/0/t/0/2',
    { k: 'evict', idx: 2, dx: 0, dy: 0, sp: 0 }, UID[2]);
  deny('Football MOVE with an extra field', fbRoom(), 'rooms/KX7P/g/0/t/0/2',
    { k: 'move', idx: 2, dx: 10, dy: 10, sp: 0, hack: 1 }, UID[2]);
  deny('Football MOVE out of bounds', fbRoom(), 'rooms/KX7P/g/0/t/0/2',
    { k: 'move', idx: 2, dx: 196, dy: 0, sp: 0 }, UID[2]);
  deny('Football turn slot is write-once',
    fbRoom({ g: { 0: { t: { 0: { 2: MV(2) } } } } }), 'rooms/KX7P/g/0/t/0/2', MV(2), UID[2]);
  // RingOut bleibt bei seiner Form OHNE k.
  const roLive = playing({ p: { 0: P(H_TAB, true), 1: P(G_TAB, true) } });
  allow('RingOut MOVE keeps its shape (no kind)', roLive, 'rooms/KX7P/g/0/t/0/0', MOVE);
  deny('RingOut MOVE with a kind field', roLive, 'rooms/KX7P/g/0/t/0/0',
    { k: 'move', idx: 0, dx: 100, dy: -50, sp: 0.5 });

  // -- SKIP ---------------------------------------------------------------------
  const off3 = fbRoom(OFFLINE(3, 1000));   // erst 1 s offline: SKIP braucht KEIN Warten
  allow('SKIP for an offline participant, written by a peer', off3, 'rooms/KX7P/g/0/t/0/3', SK(3), UID[1]);
  deny('SKIP for an ONLINE participant', fbRoom(), 'rooms/KX7P/g/0/t/0/3', SK(3), UID[1]);
  deny('SKIP written by an outsider', off3, 'rooms/KX7P/g/0/t/0/3', SK(3), 'UID_OUT');
  deny('SKIP written unauthenticated', off3, 'rooms/KX7P/g/0/t/0/3', SK(3), null);
  deny('SKIP carrying a launch vector', off3, 'rooms/KX7P/g/0/t/0/3',
    { k: 'skip', idx: 3, dx: 10, dy: 0, sp: 0 }, UID[1]);
  deny('SKIP carrying spin', off3, 'rooms/KX7P/g/0/t/0/3',
    { k: 'skip', idx: 3, dx: 0, dy: 0, sp: 0.5 }, UID[1]);
  deny('SKIP pointing at a foreign seat', off3, 'rooms/KX7P/g/0/t/0/3',
    { k: 'skip', idx: 1, dx: 0, dy: 0, sp: 0 }, UID[1]);
  deny('SKIP is write-once',
    fbRoom(Object.assign(OFFLINE(3, 1000), { g: { 0: { t: { 0: { 3: SK(3) } } } } })),
    'rooms/KX7P/g/0/t/0/3', SK(3), UID[1]);
  deny('SKIP for an already evicted seat',
    fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 3: true } } } })),
    'rooms/KX7P/g/0/t/0/3', SK(3), UID[1]);
  deny('SKIP in a RingOut room (no typed turns there)', roLive, 'rooms/KX7P/g/0/t/0/1',
    { k: 'skip', idx: 1, dx: 0, dy: 0, sp: 0 });

  // -- Der Eigentuemerzweig taugt NUR fuer move --------------------------------
  // Sonst koennte ein online stehender Spieler sich selbst ueberspringen oder sich ohne
  // Eviction als entfernt eintragen - beides waere eine Ersatzbedeutung im eigenen Slot,
  // und die verbliebenen Clients wuerden ueber die aktive Teilnehmermenge auseinanderlaufen.
  deny('an online owner cannot SKIP itself', fbRoom(), 'rooms/KX7P/g/0/t/0/2', SK(2), UID[2]);
  deny('an online owner cannot REMOVE itself without an eviction',
    fbRoom(), 'rooms/KX7P/g/0/t/0/2', RM(2), UID[2]);
  deny('an OFFLINE owner cannot SKIP itself either',
    fbRoom(OFFLINE(2, 1000)), 'rooms/KX7P/g/0/t/0/2', SK(2), UID[2]);
  // idx muss serverseitig eine ganze Zahl sein - sonst entstuende ein Zug, den der
  // Server annimmt und jeder protokollkonforme Client verwirft.
  deny('Football MOVE with a STRING idx', fbRoom(), 'rooms/KX7P/g/0/t/0/2',
    { k: 'move', idx: '2', dx: 10, dy: 10, sp: 0 }, UID[2]);
  deny('Football MOVE with a fractional idx', fbRoom(), 'rooms/KX7P/g/0/t/0/2',
    { k: 'move', idx: 2.5, dx: 10, dy: 10, sp: 0 }, UID[2]);

  // -- Ein evicteter Schreiber verliert JEDE Peer-Befugnis ----------------------
  // Selbstaustritt setzt nur e/<self>; die Praesenz bleibt zunaechst online. Ohne diese
  // Pruefung koennte ein bereits Ausgeschiedener weiter fremde Sitze ueberspringen,
  // entfernen und nach 15 s weitere Teilnehmer evicten.
  {
    const gone1 = fbRoom(Object.assign(OFFLINE(3, 1000), { g: { 0: { e: { 1: true } } } }));
    deny('an evicted participant cannot SKIP anyone', gone1, 'rooms/KX7P/g/0/t/0/3', SK(3), UID[1]);
    const gone1b = fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 1: true, 3: true } } } }));
    deny('an evicted participant cannot write REMOVE', gone1b, 'rooms/KX7P/g/0/t/0/3', RM(3), UID[1]);
    // ... und ein NICHT evicteter Peer darf beides weiterhin.
    const ok1 = fbRoom(Object.assign(OFFLINE(3, 1000), { g: { 0: { e: { 0: true } } } }));
    allow('a non-evicted peer may still SKIP', ok1, 'rooms/KX7P/g/0/t/0/3', SK(3), UID[1]);
    // ... und vor allem: er darf auch NIEMANDEN EVICTIEREN. Ein Ausgeschiedener steht bis
    // zum naechsten Rundenwechsel noch auf on:true - ohne diese Sperre koennte er reihum
    // jeden kurz offline stehenden Teilnehmer dauerhaft aus dem Match entfernen.
    const gone1c = fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 1: true } } } }));
    deny('an evicted participant cannot EVICT anyone', gone1c, 'rooms/KX7P/g/0/e/3', true, UID[1]);
    // Zweiter Sitz als Taeter: die Bedingung haengt am Schreiber, nicht an einer
    // einzelnen Sitznummer - die Regel zaehlt die Sitze einzeln auf.
    const gone0c = fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 0: true } } } }));
    deny('the evicted HOST cannot evict anyone either', gone0c, 'rooms/KX7P/g/0/e/3', true, UID[0]);
    deny('the evicted host cannot SKIP anyone either',
      fbRoom(Object.assign(OFFLINE(3, 1000), { g: { 0: { e: { 0: true } } } })),
      'rooms/KX7P/g/0/t/0/3', SK(3), UID[0]);
    const ok1c = fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 0: true } } } }));
    allow('a non-evicted peer may still evict', ok1c, 'rooms/KX7P/g/0/e/3', true, UID[1]);
    // Ein NICHT evicteter Teilnehmer kann weiterhin selbst austreten - die uid-weite
    // Sperre trifft nur Identitaeten, die bereits einen ausgeschiedenen Sitz halten.
    allow('an untouched participant may still leave voluntarily',
      fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 1: true } } } })),
      'rooms/KX7P/g/0/e/2', true, UID[2]);
    // ... und ein bereits evicteter Sitz kann sich nicht ein zweites Mal eintragen.
    deny('an evicted seat cannot re-write its own eviction',
      fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 1: true } } } })),
      'rooms/KX7P/g/0/e/1', true, UID[1]);
  }

  // -- EVICTION -----------------------------------------------------------------
  allow('a participant may evict ITSELF (voluntary leave)', fbRoom(), 'rooms/KX7P/g/0/e/2', true, UID[2]);
  deny('a peer cannot evict an ONLINE participant', fbRoom(), 'rooms/KX7P/g/0/e/3', true, UID[1]);
  deny('a peer cannot evict a FRESHLY offline participant',
    fbRoom(OFFLINE(3, 1000)), 'rooms/KX7P/g/0/e/3', true, UID[1]);
  allow('a peer may evict a STALE offline participant',
    fbRoom(OFFLINE(3)), 'rooms/KX7P/g/0/e/3', true, UID[1]);
  deny('an outsider cannot evict', fbRoom(OFFLINE(3)), 'rooms/KX7P/g/0/e/3', true, 'UID_OUT');
  deny('an eviction value other than true', fbRoom(OFFLINE(3)), 'rooms/KX7P/g/0/e/3', false, UID[1]);

  // -- seats ist das Startsignal, nicht eine Zahl -------------------------------
  // Es ist write-once und gibt die Teilnehmerzahl vor; der seats-Listener startet das
  // Match daraufhin bei ALLEN Clients. Es darf deshalb erst existieren, wenn der Raum
  // bereits laeuft - sonst startete ein Football-Match aus der offenen Lobby heraus,
  // mit unbesetzten Sitzen.
  {
    const fbLobby = { rooms: { KX7P: Object.assign({}, fbNew, {
      p: { 0: P(TAB[0], true), 1: P(TAB[1], true), 2: P(TAB[2], true), 3: P(TAB[3], true), 4: P(TAB[4], true) },
      players: { 0: REC5(0), 1: REC5(1), 2: REC5(2), 3: REC5(3), 4: REC5(4) } }) } };
    deny('Football seats in the OPEN lobby', fbLobby, 'rooms/KX7P/seats', 5, UID[0]);
    const fbPlaying = { rooms: { KX7P: Object.assign({}, fbLobby.rooms.KX7P, { state: 'playing' }) } };
    allow('Football seats once the match is running', fbPlaying, 'rooms/KX7P/seats', 5, UID[0]);
    deny('Football seats with a wrong count', fbPlaying, 'rooms/KX7P/seats', 4, UID[0]);
    deny('Football seats written by a non-host', fbPlaying, 'rooms/KX7P/seats', 5, UID[2]);
    // Der Fuenf-Spieler-Vertrag ist serverseitig gebunden: seats=5 verlangt fuenf
    // AKTIVE Sitze. Sonst startete ein Football-Match in einer Fuenf-Spieler-Arena,
    // in der drei Figuren niemandem gehoeren - der Lockstep wartete ewig auf sie.
    const fbPartial = (n) => { const p = {}, pl = {};
      for (let i = 0; i < 5; i++) { p[i] = P(TAB[i], i < n); pl[i] = REC5(i); }
      return { rooms: { KX7P: Object.assign({}, fbNew, { state: 'playing', p, players: pl }) } }; };
    for (let n = 1; n < 5; n++)
      deny('Football seats=5 with only ' + n + ' active seats', fbPartial(n), 'rooms/KX7P/seats', 5, UID[0]);
    allow('Football seats=5 with all five active', fbPartial(5), 'rooms/KX7P/seats', 5, UID[0]);
  }
  deny('an eviction in the football LOBBY (no match running yet)',
    { rooms: { KX7P: Object.assign({}, fbNew, { players: { 0: REC5(0), 1: REC5(1) },
        p: { 0: P(TAB[0], true), 1: P(TAB[1], false, NOW - GRACE - 1) } }) } },
    'rooms/KX7P/g/0/e/1', true, UID[0]);
  deny('an unauthenticated client cannot evict', fbRoom(OFFLINE(3)), 'rooms/KX7P/g/0/e/3', true, null);
  deny('eviction cannot be cleared',
    fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 3: true } } } })), 'rooms/KX7P/g/0/e/3', false, UID[1]);
  deny('eviction cannot be re-written',
    fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 3: true } } } })), 'rooms/KX7P/g/0/e/3', true, UID[1]);
  // Ein Sitz, den es im Raum gar nicht gibt, ist nicht evictierbar - sonst koennte man
  // einen spaeter beitretenden Spieler im Voraus sperren.
  // Ein Sitz OHNE Rosterdatensatz ist kein Teilnehmer - auch wenn eine (verwaiste)
  // Praesenz alt und offline aussieht. Sonst liesse sich ein spaeter beitretender
  // Spieler im Voraus sperren.
  deny('eviction of a seat that never belonged to the room',
    { rooms: { KX7P: Object.assign({}, fbNew, {
        state: 'playing', seats: 5,
        p: { 0: P(TAB[0], true), 1: P(TAB[1], true),
             4: { s: TAB[4], on: false, t: NOW - GRACE - 1 } },
        players: { 0: REC5(0), 1: REC5(1) } }) } },
    'rooms/KX7P/g/0/e/4', true, UID[1]);
  deny('a peer cannot evict a seat that is online in ANOTHER room state',
    fbRoom(OFFLINE(3)), 'rooms/KX7P/g/0/e/4', true, UID[1]);
  deny('eviction in a FOREIGN generation', fbRoom(OFFLINE(3)), 'rooms/KX7P/g/1/e/3', true, UID[1]);
  // Der Eviction-Pfad ist NEU in v4. Ein noch laufender Raum niedrigerer Version kennt
  // weder das typisierte remove noch die Sperre - dort wuerde eine Eviction das Match
  // dauerhaft blockieren. Deshalb gilt der Pfad ausschliesslich fuer v4.
  deny('eviction in a pre-v4 room', fbRoom(Object.assign(OFFLINE(3), { v: 3 })),
    'rooms/KX7P/g/0/e/3', true, UID[1]);
  deny('eviction in a pre-v4 RingOut room',
    db1({ v: 3, state: 'playing', p: { 0: P(H_TAB, true), 1: P(G_TAB, false, NOW - GRACE - 1) },
          players: { 0: HOST, 1: REC() } }),
    'rooms/KX7P/g/0/e/1', true, UID_GUEST);

  // -- Zwischen state und seats ist das Match noch NICHT eroeffnet ---------------
  // state='playing' schliesst nur die Lobby; erst seats===5 legt die Teilnehmermenge
  // fest, die alle Clients gemeinsam kennen. Dazwischen darf nichts Spielrelevantes
  // entstehen - sonst liessen sich write-once-Slots kuenftiger Runden vorab belegen
  // oder Sitze entfernen, bevor ueberhaupt jemand angestossen hat.
  {
    const noStart = (over) => ({ rooms: { KX7P: (() => {
      const r = JSON.parse(JSON.stringify(FB_ATTACK)); delete r.seats;
      return Object.assign(r, over || {}); })() } });
    // Fuenf aktive Sitze, aber noch kein Startsignal: genau das Fenster zwischen den
    // beiden sequenziellen Writes des Hosts. Dieselbe Fixture traegt auch die Kopplung
    // weiter unten, denn nur mit fuenf aktiven Sitzen ist das seats-Bein fuer sich legal.
    const noStartAllOn = noStart({ p: (() => { const p = {}; for (let i = 0; i < 5; i++)
      p[i] = { s: 'FBTAB00' + i, on: true, t: NOW }; return p; })() });
    deny('a MOVE before the start signal', noStartAllOn, 'rooms/KX7P/g/0/t/0/0',
      { k: 'move', idx: 0, dx: 10, dy: 0, sp: 0 }, FB_UID[0]);
    deny('a SKIP before the start signal', noStart(), 'rooms/KX7P/g/0/t/0/3',
      { k: 'skip', idx: 3, dx: 0, dy: 0, sp: 0 }, FB_UID[0]);
    deny('an eviction before the start signal', noStart(), 'rooms/KX7P/g/0/e/3', true, FB_UID[0]);
    deny('a self-eviction before the start signal', noStart(), 'rooms/KX7P/g/0/e/0', true, FB_UID[0]);
    // ... auch nicht, indem der Angreifer das Startsignal im SELBEN Update mitliefert:
    // der Slot-/Marker-Write sieht seats ueber den Vorzustand, und dort fehlt es noch.
    allow('...the start signal alone is legal on that fixture', noStartAllOn, 'rooms/KX7P/seats', 5, FB_UID[0]);
    // Eine PEER-Eviction laesst sich hier nicht mitliefern - sie verlangt ein offline
    // stehendes Ziel, das Startsignal dagegen fuenf aktive Sitze. Der aussagekraeftige
    // Fall ist deshalb der Selbstaustritt: er braucht nur Eigentum, waere auf dieser
    // Fixture also fuer sich erlaubt - und darf trotzdem nicht mit dem Startsignal
    // zusammen durchgehen, sonst waere das Match im selben Atemzug eroeffnet und schon
    // um einen Teilnehmer aermer.
    denyMulti('a self-eviction that carries the start signal along',
      noStartAllOn, { 'rooms/KX7P/seats': 5, 'rooms/KX7P/g/0/e/0': true }, FB_UID[0]);
    const started = { rooms: { KX7P: Object.assign({}, JSON.parse(JSON.stringify(noStartAllOn.rooms.KX7P)), { seats: 5 }) } };
    allow('...while the same self-eviction is legal once the match is open',
      started, 'rooms/KX7P/g/0/e/0', true, FB_UID[0]);
    // In der Lobby erst recht nicht.
    deny('a MOVE in the open football lobby',
      noStart({ state: 'lobby' }), 'rooms/KX7P/g/0/t/0/0',
      { k: 'move', idx: 0, dx: 10, dy: 0, sp: 0 }, FB_UID[0]);
  }

  // -- ERREICHBARKEIT: der vollstaendige Weg vom leeren Raum bis zum Anstoss ------
  // Einzelne Positivtests koennen an einer Fixture haengen, die es unter den Regeln gar
  // nicht geben kann - dann beweisen sie nichts. Dieser Block baut den Raum deshalb
  // SCHRITTWEISE auf: jeder Schritt wird gegen die echten Regeln geprueft UND, wenn er
  // erlaubt ist, wirklich angewendet. Der naechste Schritt sieht also nur Zustaende,
  // die auf diesem Weg tatsaechlich entstehen koennen.
  {
    const live = { rooms: {} };
    const step = (name, path, val, uid, also) => {
      allow('reachable: ' + name, live, path, val, uid, also);
      if (tryWrite(live, path, val, uid, also)) {
        setPath(live, path.split('/'), val);
        if (also) for (const k of Object.keys(also)) setPath(live, k.split('/'), also[k]);
      }
    };
    step('a football room is created', 'rooms/FBQ7', Object.assign({}, fbNew, { created: NOW }), UID[0]);
    step('the host activates its own seat', 'rooms/FBQ7/p/0', P(TAB[0], true), UID[0]);
    for (let i = 1; i < 5; i++) {
      // Beitritt: Praesenz-Reservierung und Rosterdatensatz sind EIN atomarer Write.
      step('seat ' + i + ' joins (atomic reserve + roster)', 'rooms/FBQ7/p/' + i, P(TAB[i], false), UID[i],
        { ['rooms/FBQ7/players/' + i]: REC5(i) });
      // ... und genau hier scheiterte es vorher: die Aktivierungsklausel kannte Football
      // nicht, der Gast blieb fuer immer auf on:false und das Match konnte nie starten.
      step('seat ' + i + ' activates in the lobby', 'rooms/FBQ7/p/' + i, P(TAB[i], true), UID[i]);
    }
    step('the host opens the match', 'rooms/FBQ7/state', 'playing', UID[0]);
    step('the host writes the five-seat start signal', 'rooms/FBQ7/seats', 5, UID[0]);
    // Und der erste Zug jedes Sitzes laeuft auf diesem echt gewachsenen Raum.
    for (let i = 0; i < 5; i++)
      step('seat ' + i + ' commits its first MOVE', 'rooms/FBQ7/g/0/t/0/' + i,
        { k: 'move', idx: i, dx: 10, dy: -10, sp: 0 }, UID[i]);
    t('[STATE] the reachable room really holds five active seats',
      [0, 1, 2, 3, 4].every(i => live.rooms.FBQ7.p[i].on === true && live.rooms.FBQ7.players[i].uid === UID[i]));
    t('[STATE] the reachable room really carries seats=5 and five turn records',
      live.rooms.FBQ7.seats === 5 && Object.keys(live.rooms.FBQ7.g[0].t[0]).length === 5);
    // Ein sechster Sitz entsteht auf diesem Weg nicht - auch nicht der neutrale Ball.
    deny('reachable room: no sixth seat', live, 'rooms/FBQ7/p/5', P('FTAB0005', false), 'UID_SIXTH');
    deny('reachable room: the neutral ball cannot claim a turn slot', live, 'rooms/FBQ7/g/0/t/1/5',
      { k: 'move', idx: 5, dx: 0, dy: 0, sp: 0 }, UID[0]);
  }

  // -- REMOVE --------------------------------------------------------------------
  const evicted = fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 3: true } } } }));
  allow('REMOVE after a real eviction, written by a peer', evicted, 'rooms/KX7P/g/0/t/0/3', RM(3), UID[1]);
  deny('REMOVE before the eviction exists', fbRoom(OFFLINE(3)), 'rooms/KX7P/g/0/t/0/3', RM(3), UID[1]);
  deny('REMOVE written by an outsider', evicted, 'rooms/KX7P/g/0/t/0/3', RM(3), 'UID_OUT');
  deny('REMOVE written unauthenticated', evicted, 'rooms/KX7P/g/0/t/0/3', RM(3), null);
  deny('REMOVE carrying a launch vector', evicted, 'rooms/KX7P/g/0/t/0/3',
    { k: 'remove', idx: 3, dx: 10, dy: 0, sp: 0 }, UID[1]);
  deny('REMOVE pointing at a foreign seat', evicted, 'rooms/KX7P/g/0/t/0/3',
    { k: 'remove', idx: 1, dx: 0, dy: 0, sp: 0 }, UID[1]);
  deny('REMOVE is write-once',
    fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 3: true }, t: { 0: { 3: RM(3) } } } } })),
    'rooms/KX7P/g/0/t/0/3', RM(3), UID[1]);

  // -- Rueckkehr nach Eviction ----------------------------------------------------
  deny('an evicted seat cannot reactivate its presence',
    fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 3: true } } } })),
    'rooms/KX7P/p/3', P(TAB[3], true), UID[3]);
  deny('an evicted seat cannot write a MOVE',
    fbRoom(Object.assign({ p: { 0: P(TAB[0], true), 1: P(TAB[1], true), 2: P(TAB[2], true),
                               3: P(TAB[3], true), 4: P(TAB[4], true) } },
                         { g: { 0: { e: { 3: true } } } })),
    'rooms/KX7P/g/0/t/0/3', MV(3), UID[3]);

  // -- Generationstrennung ---------------------------------------------------------
  allow('a new generation starts without an inherited eviction',
    fbRoom(Object.assign(OFFLINE(3), { gen: 1, g: { 0: { e: { 3: true } } } })),
    'rooms/KX7P/g/1/t/0/3', SK(3), UID[1]);
  deny('the old generation keeps its eviction',
    fbRoom(Object.assign(OFFLINE(3), { g: { 0: { e: { 3: true } } } })),
    'rooms/KX7P/g/0/t/0/3', SK(3), UID[1]);
}

console.log('\nRules-Suite (lokal, echte firebase.rules.json): ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
