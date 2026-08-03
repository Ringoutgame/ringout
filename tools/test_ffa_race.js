// Race-Tests (v4) — konkurrierende Callables, Retries und Write-once-Arbitrage
// gegen die ECHTEN Kerne (functions/room-core.js + functions/clock-core.js) ueber
// die gemeinsame Fake-Schicht aus tools/lib/fake-v4.js.
//
// Die frueheren v3-Races (zwei Clients claimen denselben p/<seat>, Presence-
// Write-once, Sentinel-Retry, Client-gen-Bump) existieren nicht mehr: der Client
// waehlt weder Raum noch Seat, und die Generation gehoert dem Server. Geprueft
// wird deshalb der Vertrag, der an ihre Stelle getreten ist —
//   · konkurrierende Create-/Join-/Activate-Aufrufe
//   · doppelte Callables und Retries (Idempotenz ueber requestId)
//   · genau eine Seat-Zuweisung, keine UID auf zwei Seats
//   · live/slots write-once
//   · Deadline- und phaseId-Races
//   · clockClose/clockSettle idempotent
//   · keine Wiederbelebung geloeschter Raeume
//   node tools/test_ffa_race.js
'use strict';
const { makeDb, makeClient } = require('./lib/v4-client-harness.js');

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 2));
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
};
// Fehler eines Callables als Code einsammeln, statt zu werfen.
const attempt = async (fn) => {
  try { return { ok: true, val: await fn() }; }
  catch (e) { return { ok: false, code: String((e && e.code) || ''), msg: String((e && e.message) || e) }; }
};
const CFG = (fmt) => ({ winTarget: 3, fmt: fmt || 'ffa', visibility: 'private' });
// Jede UID sitzt auf genau EINEM Seat, und der Index deckt sich mit players.
function uniqueSeats(room) {
  if (!room || !room.seatByUid) return false;
  const seats = Object.values(room.seatByUid);
  if (new Set(seats).size !== seats.length) return false;
  for (const uid of Object.keys(room.seatByUid)) {
    const s = room.seatByUid[uid];
    if (!room.players || !room.players[s] || room.players[s].uid !== uid) return false;
  }
  return true;
}

(async () => {
  // ── R1: parallele Creates verschiedener Clients kollidieren nicht ─────────
  {
    const db = makeDb();
    const cs = [0, 1, 2, 3, 4].map(() => makeClient(db, 'X'));
    const res = await Promise.all(cs.map((c, i) => c.callV4('roomCreateV4',
      { config: CFG(), pid: 'PIDPAR' + i + '001', tab: 'TABPAR' + i + '001', name: 'P' + i })));
    const codes = res.map((r) => r.room);
    t('R1 jeder Create liefert einen Raumcode', codes.every((c) => typeof c === 'string' && c.length === 4));
    t('R1 alle Raumcodes sind verschieden', new Set(codes).size === codes.length);
    t('R1 jede Rauminstanz ist eindeutig', new Set(res.map((r) => r.iid)).size === res.length);
    t('R1 jeder Ersteller sitzt auf Seat 0 seines Raums', res.every((r) => r.seat === 0));
    t('R1 es entstanden genau fuenf Raeume', Object.keys(db.data.rooms).length === 5);
  }

  // ── R2: parallele Joins in DENSELBEN Raum -> genau eine Seatvergabe je UID ─
  {
    const db = makeDb();
    const host = makeClient(db, 'X');
    const hc = await host.callV4('roomCreateV4', { config: CFG(), pid: 'PIDHOST001', tab: 'TABHOST001', name: 'H' });
    await host.callV4('roomActivateV4', { room: hc.room, iid: hc.iid, token: hc.token, leaseId: hc.leaseId });
    const gs = [1, 2, 3, 4].map(() => makeClient(db, 'X'));
    const joins = await Promise.all(gs.map((g, i) => attempt(() => g.callV4('roomJoinV4',
      { room: hc.room, iid: hc.iid, pid: 'PIDJOIN' + i + '01', tab: 'TABJOIN' + i + '01', name: 'G' + i }))));
    const seats = joins.filter((j) => j.ok).map((j) => j.val.seat);
    t('R2 alle vier Joins gelingen', joins.every((j) => j.ok));
    t('R2 jeder bekommt einen anderen Seat', new Set(seats).size === seats.length);
    t('R2 die Seats liegen lueckenlos bei 1..4', seats.slice().sort().join(',') === '1,2,3,4');
    for (let i = 0; i < gs.length; i++) {
      const j = joins[i].val;
      await gs[i].callV4('roomActivateV4', { room: hc.room, iid: hc.iid, token: j.token, leaseId: j.leaseId });
    }
    const room = db.room(hc.room);
    t('R2 seatByUid ist eindeutig und deckt sich mit players', uniqueSeats(room));
    t('R2 keine UID auf zwei Seats', new Set(Object.values(room.seatByUid)).size === 5);
    t('R2 fuenf aktive Sessions', Object.keys(room.sess).length === 5
      && [0, 1, 2, 3, 4].every((s) => typeof room.sess[s].active === 'string'));
  }

  // ── R3: derselbe Client joint parallel mehrfach -> nur EIN Seat ───────────
  {
    const db = makeDb();
    const host = makeClient(db, 'X');
    const hc = await host.callV4('roomCreateV4', { config: CFG(), pid: 'PIDHOST002', tab: 'TABHOST002', name: 'H' });
    await host.callV4('roomActivateV4', { room: hc.room, iid: hc.iid, token: hc.token, leaseId: hc.leaseId });
    const g = makeClient(db, 'X');
    const rs = await Promise.all([1, 2, 3].map(() => attempt(() => g.callV4('roomJoinV4',
      { room: hc.room, iid: hc.iid, pid: 'PIDMULTI01', tab: 'TABMULTI01', name: 'M' }))));
    const okSeats = rs.filter((r) => r.ok).map((r) => r.val.seat);
    t('R3 mehrfacher Join derselben UID belegt genau einen Seat', new Set(okSeats).size === 1);
    t('R3 dieser Seat ist 1', okSeats[0] === 1);
    const room = db.room(hc.room);
    t('R3 der Raum fuehrt genau zwei Belegungen', Object.keys(room.seatByUid).length === 2);
    t('R3 der Index bleibt widerspruchsfrei', uniqueSeats(room));
  }

  // ── R4: Retry mit STABILER requestId ist idempotent ──────────────────────
  {
    const db = makeDb();
    const h = makeClient(db, 'X');
    const [a, b] = await h.callTwice('roomCreateV4', { config: CFG(), pid: 'PIDIDEM001', tab: 'TABIDEM001', name: 'I' });
    t('R4 doppelter Create liefert denselben Raum', a.room === b.room);
    t('R4 doppelter Create liefert dieselbe Instanz', a.iid === b.iid);
    t('R4 es entsteht genau ein Raum', Object.keys(db.data.rooms).length === 1);
    t('R4 genau eine Belegung', Object.keys(db.room(a.room).seatByUid).length === 1);
    // Dieselbe requestId mit ANDERER Nutzlast muss fail-closed abgelehnt werden.
    const first = await attempt(() => h.callV4('roomCreateV4',
      { requestId: 'req-fixed-000001', config: CFG('single'), pid: 'PIDIDEM001', tab: 'TABIDEM001' }));
    const other = await attempt(() => h.callV4('roomCreateV4',
      { requestId: 'req-fixed-000001', config: CFG('ffa'), pid: 'PIDOTHER01', tab: 'TABOTHER01' }));
    t('R4 erster Aufruf mit fester requestId gelingt', first.ok);
    t('R4 dieselbe requestId mit anderer Nutzlast wird abgelehnt',
      !other.ok && other.code === 'functions/invalid-argument');
  }

  // ── R5: parallele Aktivierung — genau eine aktive Session ────────────────
  {
    const db = makeDb();
    const h = makeClient(db, 'X');
    const c = await h.callV4('roomCreateV4', { config: CFG(), pid: 'PIDACT0001', tab: 'TABACT0001', name: 'A' });
    const rs = await Promise.all([1, 2, 3].map(() => attempt(() => h.callV4('roomActivateV4',
      { room: c.room, iid: c.iid, token: c.token, leaseId: c.leaseId }))));
    t('R5 mindestens eine Aktivierung gelingt', rs.some((r) => r.ok));
    const room = db.room(c.room);
    t('R5 der Seat traegt genau EIN aktives Token', typeof room.sess[0].active === 'string');
    t('R5 keine pending Reservierung bleibt zurueck', room.sess[0].pending == null);
    t('R5 alle erfolgreichen Aktivierungen melden dasselbe Token',
      new Set(rs.filter((r) => r.ok).map((r) => r.val.token)).size === 1);
    // Ein fremder Client darf mit demselben Token NICHT aktivieren.
    const x = makeClient(db, 'X');
    const foreign = await attempt(() => x.callV4('roomActivateV4',
      { room: c.room, iid: c.iid, token: room.sess[0].active, leaseId: c.leaseId }));
    t('R5 fremde UID kann die Session nicht uebernehmen',
      !foreign.ok && foreign.code === 'functions/permission-denied');
  }

  // ── R6: live/slots ist write-once ───────────────────────────────────────
  {
    const db = makeDb();
    const [h, g] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('online'); h.setFmt('single');
    h.create(); await tick();
    const code = h.st().roomCode;
    g.setMenu('online'); g.join(code); await tick();
    t('R6 Match laeuft', db.room(code).state === 'playing');
    t('R6 erster Zug wird angenommen', h.commitMove() === true);
    await tick();
    const first = JSON.stringify(db.slots(code, 0)[0]);
    const ref = db.F.FB.ref(null, 'rooms/' + code + '/g/0/live/slots/0');
    const res = await db.F.FB.runTransaction(ref, (cur) => (cur == null ? { idx: 9, dx: 1, dy: 1, sp: 0, t: 0, sid: 'X' } : undefined));
    t('R6 zweiter Write auf denselben Slot committet nicht', res.committed === false);
    t('R6 der erste Zug bleibt unveraendert', JSON.stringify(db.slots(code, 0)[0]) === first);
    t('R6 der Client sendet keinen zweiten Zug', h.commitMove() === false);
  }

  // ── R7: clockClose idempotent, Deadline- und phaseId-Races ──────────────
  {
    const db = makeDb();
    const [h, g] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('online'); h.setFmt('single');
    h.create(); await tick();
    const code = h.st().roomCode;
    g.setMenu('online'); g.join(code); await tick();
    const iid = db.room(code).iid;
    const ck = db.clock(code, 0);
    const early = await attempt(() => h.callV4('clockClose',
      { room: code, iid, session: h.session(), phaseId: ck.phaseId }));
    t('R7 clockClose vor der Deadline wird abgelehnt',
      !early.ok && early.code === 'functions/failed-precondition');
    t('R7 die Phase bleibt offen', db.clock(code, 0).phase === 'aim');
    db.advance(8000);
    const wrong = await attempt(() => h.callV4('clockClose',
      { room: code, iid, session: h.session(), phaseId: '0:99' }));
    t('R7 clockClose mit fremder phaseId ist ein No-op', wrong.ok && wrong.val.status === 'stale');
    t('R7 die Phase ist dadurch nicht geschlossen', db.clock(code, 0).phase === 'aim');
    const par = await Promise.all([
      attempt(() => h.callV4('clockClose', { room: code, iid, session: h.session(), phaseId: ck.phaseId })),
      attempt(() => g.callV4('clockClose', { room: code, iid, session: g.session(), phaseId: ck.phaseId })),
    ]);
    const closed = par.filter((r) => r.ok && r.val.status === 'closed').length;
    const stale = par.filter((r) => r.ok && r.val.status === 'stale').length;
    t('R7 genau ein clockClose schliesst die Phase', closed === 1 && stale === 1);
    t('R7 die Phase steht danach auf resolving', db.clock(code, 0).phase === 'resolving');
    t('R7 die Uhr wurde nur EINMAL belastet', db.clock(code, 0).remainingMs === 30000 - 7000);
    const hist = db.turn(code, 0, 0);
    t('R7 die Historie ist genau einmal archiviert', !!hist && !!hist.c);
    t('R7 offene Slots wurden als No-Shot gebucht',
      hist[0] && hist[0].ns === 'stand' && hist[1] && hist[1].ns === 'stand');
    const again = await attempt(() => h.callV4('clockClose', { room: code, iid, session: h.session(), phaseId: ck.phaseId }));
    t('R7 wiederholter clockClose bleibt wirkungslos',
      again.ok && again.val.status === 'stale' && db.clock(code, 0).remainingMs === 23000);
  }

  // ── R8: clockSettle idempotent, Quorum entscheidet genau einmal ─────────
  {
    const db = makeDb();
    const [h, g] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('online'); h.setFmt('single');
    h.create(); await tick();
    const code = h.st().roomCode;
    g.setMenu('online'); g.join(code); await tick();
    const iid = db.room(code).iid;
    const pid0 = db.clock(code, 0).phaseId;
    db.advance(8000);
    await h.callV4('clockClose', { room: code, iid, session: h.session(), phaseId: pid0 });
    const rep = (c) => c.callV4('clockSettle',
      { room: code, iid, session: c.session(), phaseId: pid0, hash: 'h1', next: [0, 1] });
    const first = await rep(h);
    t('R8 der erste Report ist pending (Quorum offen)', first.status === 'pending');
    const dup = await rep(h);
    t('R8 identische Wiederholung ist idempotent',
      dup.status === 'pending' && db.clock(code, 0).phase === 'resolving');
    const second = await rep(g);
    t('R8 das vollstaendige Quorum oeffnet die Folgephase', second.status === 'settled');
    t('R8 Turn 1 ist offen', db.clock(code, 0).turn === 1 && db.clock(code, 0).phase === 'aim');
    t('R8 kein Pre-Arming: t/1 existiert noch nicht', db.turn(code, 0, 1) == null);
    const late = await attempt(() => rep(h));
    t('R8 ein Nachzuegler auf die alte Phase ist stale',
      late.ok && late.val.status === 'stale' && db.clock(code, 0).turn === 1);
  }

  // ── R9: abweichender Hash -> kontrollierter Desync, keine Folgephase ────
  {
    const db = makeDb();
    const [h, g] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('online'); h.setFmt('single');
    h.create(); await tick();
    const code = h.st().roomCode;
    g.setMenu('online'); g.join(code); await tick();
    const iid = db.room(code).iid;
    const pid0 = db.clock(code, 0).phaseId;
    db.advance(8000);
    await h.callV4('clockClose', { room: code, iid, session: h.session(), phaseId: pid0 });
    await h.callV4('clockSettle', { room: code, iid, session: h.session(), phaseId: pid0, hash: 'hA', next: [0, 1] });
    await g.callV4('clockSettle', { room: code, iid, session: g.session(), phaseId: pid0, hash: 'hB', next: [0, 1] });
    const ck = db.clock(code, 0);
    t('R9 abweichende Hashes beenden die Phase kontrolliert',
      ck.phase === 'finished' && ck.reason === 'desync');
    t('R9 es wird KEINE Folgephase geoeffnet', ck.turn === 0);
  }

  // ── R10: keine Wiederbelebung geloeschter Raeume ────────────────────────
  {
    const db = makeDb();
    const [h, g] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('online'); h.setFmt('single');
    h.create(); await tick();
    const code = h.st().roomCode;
    g.setMenu('online'); g.join(code); await tick();
    const iid = db.room(code).iid, sess = h.session();
    const pid0 = db.clock(code, 0).phaseId;
    db.advance(8000);
    db.F.db.write('rooms/' + code, null);              // Cleanup/TTL
    t('R10 der Raum ist weg', db.room(code) == null);
    const close = await attempt(() => h.callV4('clockClose', { room: code, iid, session: sess, phaseId: pid0 }));
    t('R10 clockClose belebt den Raum nicht wieder', db.room(code) == null);
    t('R10 clockClose meldet den fehlenden Raum', !close.ok && close.code === 'functions/not-found');
    const settle = await attempt(() => h.callV4('clockSettle',
      { room: code, iid, session: sess, phaseId: pid0, hash: 'h', next: [0, 1] }));
    t('R10 clockSettle belebt den Raum nicht wieder', db.room(code) == null);
    t('R10 clockSettle meldet den fehlenden Raum', !settle.ok && settle.code === 'functions/not-found');
    const join = await attempt(() => g.callV4('roomJoinV4',
      { room: code, iid, pid: 'PIDGHOST01', tab: 'TABGHOST01', name: 'Ghost' }));
    t('R10 ein Join legt den geloeschten Raum nicht neu an', db.room(code) == null && !join.ok);
  }

  // ── R11: fremde Rauminstanz / veraltete Session sind fail-closed ────────
  {
    const db = makeDb();
    const h = makeClient(db, 'X');
    const c = await h.callV4('roomCreateV4', { config: CFG(), pid: 'PIDIID0001', tab: 'TABIID0001', name: 'I' });
    await h.callV4('roomActivateV4', { room: c.room, iid: c.iid, token: c.token, leaseId: c.leaseId });
    const wrong = await attempt(() => h.callV4('roomStartV4',
      { room: c.room, iid: 'IIDFREMD0001', session: db.room(c.room).sess[0].active }));
    t('R11 falsche iid wird abgelehnt', !wrong.ok && wrong.code === 'functions/failed-precondition');
    t('R11 der Raum bleibt in der Lobby', db.room(c.room).state === 'lobby');
    const stale = await attempt(() => h.callV4('roomLeaveV4',
      { room: c.room, iid: c.iid, session: 'ALTETOKEN000001' }));
    t('R11 veraltete Session wird abgelehnt', !stale.ok);
    t('R11 die aktive Session bleibt bestehen', typeof db.room(c.room).sess[0].active === 'string');
  }

  console.log('\nFFA-Online-Race: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
