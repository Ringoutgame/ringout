// ─────────────────────────────────────────────────────────────────────────────
// RingOut — gemeinsame v4-Fake-Schicht fuer die Offline-Suiten
//
// Der entscheidende Entwurfsentscheid: hier wird KEIN zweiter Arbiter
// nachgebaut. Die Fake-Callables fahren den ECHTEN functions/room-core.js und
// functions/clock-core.js gegen eine In-Memory-Datenbank — beide Kerne sind
// dependency-injiziert ({db, now}) und genau dafuer gebaut. Damit gilt in den
// Offline-Suiten exakt derselbe Vertrag wie am echten Emulator, und es gibt
// keine zweite Wahrheit, die auseinanderlaufen koennte.
//
// Die Fake-DB spricht ZWEI Dialekte auf demselben Datenbestand:
//   · admin-SDK-Form  (db.ref(p).get()/set()/child()/transaction()/on()/off())
//     — das ist die Sicht der beiden Kerne.
//   · Modular-Client-Form (ref(db,p), get(r), set(r,v), onValue(r,cb),
//     runTransaction(r,fn,opts), update(r,obj), remove(r), onDisconnect(r))
//     — das ist die Sicht von index.html.
// Beide sehen denselben Baum, so wie Client und Server im echten System.
//
// Bewusst NICHT nachgebildet werden die Security Rules: deren Beweis liegt in
// tools/test_rules.js (331 Assertions gegen die echte firebase.rules.json) und
// in tools/test_action_clock.js gegen den echten Emulator. Wo eine Suite eine
// Rules-Ablehnung braucht, kann sie sie ueber `denyWrite` gezielt erzwingen.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const path = require('path');
const REPO = path.dirname(path.dirname(__dirname));   // tools/lib -> tools -> Repo-Root
const { createArbiter, ArbiterError } = require(path.join(REPO, 'functions', 'clock-core.js'));
const { createRoomCore } = require(path.join(REPO, 'functions', 'room-core.js'));

// ── Pfad-Helfer ──────────────────────────────────────────────────────────────
const parts = (p) => String(p).split('/').filter(Boolean);
const clone = (v) => (v === undefined || v === null || typeof v !== 'object')
  ? v : JSON.parse(JSON.stringify(v));

// RTDB-Semantik: leere Objekte existieren nicht. Nach jedem Schreiben werden
// leere Zweige entfernt, damit exists()/null sich genau wie im Original verhaelt.
function prune(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node;
  const out = {};
  for (const k of Object.keys(node)) {
    const v = prune(node[k]);
    if (v !== null && v !== undefined && !(typeof v === 'object' && Object.keys(v).length === 0)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

class FakeDatabase {
  constructor(opts) {
    this.data = {};
    this.listeners = [];            // {path, cb}
    this.now = (opts && opts.now) || (() => Date.now());
    // Jeder Schreibvorgang: {path, value, actor}. actor unterscheidet, WER
    // geschrieben hat — 'client' (ueber die Modular-SDK-Sicht von index.html)
    // oder 'server' (der Arbiter ueber die Admin-Sicht). Genau darauf beruht der
    // Nachweis "der Client schreibt nichts mehr auf server-owned Pfade".
    this.writeLog = [];
    this.actor = 'server';
    this.denied = [];               // Praefixe, die wie eine Rules-Ablehnung scheitern
    this._pushSeq = 0;
  }
  // ── Kern-Zugriff ──
  read(p) {
    let n = this.data;
    for (const k of parts(p)) {
      if (n === null || n === undefined || typeof n !== 'object') return null;
      n = n[k];
    }
    return n === undefined ? null : clone(n);
  }
  write(p, value) {
    const ps = parts(p);
    if (this.denied.some((d) => p === d || p.startsWith(d + '/') || d.startsWith(p + '/'))) {
      const e = new Error('permission_denied'); e.code = 'PERMISSION_DENIED'; throw e;
    }
    this.writeLog.push({ path: p, value: clone(value), actor: this.actor });
    if (!ps.length) { this.data = clone(value) || {}; this._fire(''); return; }
    let n = this.data;
    for (let i = 0; i < ps.length - 1; i++) {
      if (n[ps[i]] === null || n[ps[i]] === undefined || typeof n[ps[i]] !== 'object') n[ps[i]] = {};
      n = n[ps[i]];
    }
    const last = ps[ps.length - 1];
    if (value === null || value === undefined) delete n[last];
    else n[last] = clone(value);
    this.data = prune(this.data) || {};
    this._fire(p);
  }
  // Multi-Path-Update wie update(ref, {relPath: value})
  updatePaths(base, obj) {
    for (const k of Object.keys(obj)) this.write(base ? base + '/' + k : k, obj[k]);
  }
  // ── Listener ──
  _fire(changed) {
    // Ein Listener feuert, wenn sein Pfad den geaenderten Pfad enthaelt ODER
    // darunter liegt — dieselbe Zustellsemantik wie bei onValue.
    for (const l of this.listeners.slice()) {
      if (changed === '' || l.path === changed
        || changed.startsWith(l.path + '/') || l.path.startsWith(changed + '/')) {
        try { l.cb(this.snap(l.path)); } catch (e) { /* Listener-Fehler nie eskalieren */ }
      }
    }
  }
  snap(p) {
    const v = this.read(p);
    return { val: () => v, exists: () => v !== null && v !== undefined, key: parts(p).pop() || null };
  }
  subscribe(p, cb) {
    const l = { path: p, cb };
    this.listeners.push(l);
    try { cb(this.snap(p)); } catch (e) { /* s. o. */ }
    return () => { const i = this.listeners.indexOf(l); if (i >= 0) this.listeners.splice(i, 1); };
  }
  // ── Rules-Ablehnung gezielt simulieren ──
  deny(prefix) { this.denied.push(prefix); }
  allow(prefix) { this.denied = this.denied.filter((d) => d !== prefix); }
  // ── admin-SDK-Sicht (room-core / clock-core) ──
  ref(p) { return new FakeRef(this, p || ''); }
}

class FakeRef {
  constructor(db, p) { this.db = db; this.path = p; }
  child(sub) { return new FakeRef(this.db, this.path ? this.path + '/' + sub : String(sub)); }
  async get() { return this.db.snap(this.path); }
  async set(v) { this.db.write(this.path, v); }
  async remove() { this.db.write(this.path, null); }
  push() {
    // Nur der Schluessel wird gebraucht (room-core erzeugt damit iid/Token).
    const key = 'k' + (++this.db._pushSeq).toString(36).padStart(6, '0') + 'abcdefgh';
    return { key };
  }
  on(evt, cb) { this._unsub = this.db.subscribe(this.path, cb); return cb; }
  off() { if (this._unsub) { this._unsub(); this._unsub = null; } }
  // Transaction: der Update-Callback bekommt den AKTUELLEN Wert; gibt er
  // undefined zurueck, wird abgebrochen (kein Write) — exakt wie im SDK.
  async transaction(update) {
    const cur = this.db.read(this.path);
    let next;
    try { next = update(cur === undefined ? null : cur); }
    catch (e) { throw e; }
    if (next === undefined) return { committed: false, snapshot: this.db.snap(this.path) };
    this.db.write(this.path, next);
    return { committed: true, snapshot: this.db.snap(this.path) };
  }
}

// ── Callable-Schicht ─────────────────────────────────────────────────────────
// Exakt die Allowlist aus functions/index.js: der Client kann keine
// server-owned Werte einschleusen. Fehler werden wie beim echten Wrapper auf
// FirebaseError-artige Objekte mit .code abgebildet.
const ERR_MAP = {
  invalid: 'invalid-argument',
  permission: 'permission-denied',
  'not-found': 'not-found',
  'too-early': 'failed-precondition',
  failed: 'failed-precondition',
  unavailable: 'unavailable',
};
function mapError(e) {
  if (e instanceof ArbiterError) {
    const err = new Error(e.message);
    err.code = 'functions/' + (ERR_MAP[e.code] || 'internal');
    return err;
  }
  const err = new Error((e && e.message) || String(e));
  err.code = 'functions/internal';
  return err;
}

function createFakeV4(opts) {
  opts = opts || {};
  const db = new FakeDatabase({ now: opts.now });
  const nowFn = () => db.now();
  const arbiter = createArbiter({ db, now: nowFn });
  const rooms = createRoomCore({ db, now: nowFn });
  const impl = {
    roomCreateV4: rooms.roomCreateV4, roomJoinV4: rooms.roomJoinV4,
    roomActivateV4: rooms.roomActivateV4, roomLeaveV4: rooms.roomLeaveV4,
    roomStartV4: rooms.roomStartV4, roomRematchV4: rooms.roomRematchV4,
    clockStart: arbiter.clockStart, clockClose: arbiter.clockClose, clockSettle: arbiter.clockSettle,
  };
  const calls = [];   // Aufrufprotokoll fuer die Assertions

  // uid wird pro Client gesetzt (wie req.auth.uid im echten Wrapper).
  function callableFor(uid) {
    return (name) => async (data) => {
      data = data || {};
      calls.push({ name, uid, data: clone(data) });
      const fn = impl[name];
      if (!fn) throw mapError(new Error('unknown callable ' + name));
      // Ein Callable ist SERVERARBEIT, auch wenn ein Client ihn ausloest. Die
      // Markierung wird hier hart gesetzt und erst am Ende zurueckgenommen:
      // ein Callable kann synchron aus einem Listener heraus starten, der
      // seinerseits waehrend eines Client-Writes feuert — ohne diese Klammer
      // wuerden Arbiter-Writes faelschlich als Client-Writes gezaehlt.
      const prevActor = db.actor;
      db.actor = 'server';
      try {
        const res = await fn({
          room: data.room, phaseId: data.phaseId, hash: data.hash, next: data.next, gen: data.gen,
          requestId: data.requestId, config: data.config,
          name: data.name, pid: data.pid, tab: data.tab,
          expectedGen: data.expectedGen, iid: data.iid,
          session: data.session, token: data.token, leaseId: data.leaseId,
          uid,
        });
        return { data: res };
      } catch (e) { throw mapError(e); }
      finally { db.actor = prevActor; }
    };
  }

  // ── Modular-Client-Sicht (index.html) ──
  // Jeder Schreibweg dieser Sicht wird als 'client' markiert, damit die Suiten
  // beweisen koennen, dass der Client server-owned Pfade nicht mehr anfasst.
  // Die Callables laufen bewusst NICHT ueber diese Markierung: sie sind
  // Serverarbeit, auch wenn der Client sie ausloest.
  const asClient = async (fn) => {
    const prev = db.actor; db.actor = 'client';
    try { return await fn(); } finally { db.actor = prev; }
  };
  const FB = {
    db,
    ref: (_db, p) => new FakeRef(db, p),
    get: (r) => r.get(),
    set: (r, v) => asClient(() => r.set(v)),
    remove: (r) => asClient(() => r.remove()),
    update: (r, obj) => asClient(async () => { db.updatePaths(r.path, obj); }),
    onValue: (r, cb) => db.subscribe(r.path, cb),
    onDisconnect: () => ({ set: async () => {}, cancel: async () => {} }),
    serverTimestamp: () => db.now(),
    runTransaction: (r, fn) => asClient(() => r.transaction(fn)),
    query: (r) => r, orderByChild: () => null, limitToLast: () => null,
  };

  return {
    db, FB, calls, callableFor, impl,
    // Bequeme Direktaufrufe fuer Suiten, die keinen Client fahren.
    call: (name, data, uid) => callableFor(uid)(name)(data),
    reset() { db.data = {}; db.listeners.length = 0; db.writeLog.length = 0; db.denied.length = 0; calls.length = 0; },
    room: (code) => db.read('rooms/' + code),
    clock: (code, gen) => db.read('rooms/' + code + '/g/' + gen + '/live/clock'),
    slots: (code, gen) => db.read('rooms/' + code + '/g/' + gen + '/live/slots'),
    turn: (code, gen, t) => db.read('rooms/' + code + '/g/' + gen + '/t/' + t),
  };
}

module.exports = { createFakeV4, FakeDatabase, FakeRef, clone, prune };
