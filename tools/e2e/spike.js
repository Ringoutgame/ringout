// ─────────────────────────────────────────────────────────────────────────────
// RingOut — E2E Feasibility-Spike (Online) — standalone diagnostic
//
// Proves the minimal building blocks the full harness relies on, using the SAME
// shared infrastructure (lib/harness.js — no duplicated setup): in-memory HTML
// transform, hard production block over HTTP + WebSocket, JDK-21 emulator (per-run
// isolated temp dir), and authoritative reads/writes via the page's own window.FB.
//
// Presence & Reconnect v3 (Paket B0 rules foundation + B1 client cutover): this
// spike still drives the presence/room lifecycle directly via raw window.FB
// writes rather than through index.html's client functions (createRoom/joinRoom/
// etc., now on the v3 p/<seat>={s,on,t} schema since B1) — that's the ONLY way to
// prove the atomic p+players coupling, the parallel write-once arbiter, the
// coupled 1v1/2v2 start, the joint-token recycling and the fact that the
// disconnect leave-sentinel + elimination latch are currently DENY (Fund 2
// deferred) — none of which the local single-path model in tools/test_rules.js
// can. B1 deliberately does NOT implement recycling/Fund-2-dependent client
// behavior either (see tools/e2e/ffa-scenarios.js), so these rule-level proofs
// stay independently useful; the full FFA runner (tools/e2e/run-ffa-e2e.js)
// exercises the real client paths that ARE in B1 scope.
//
// Run:  node tools/e2e/spike.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const { chromium } = require('@playwright/test');
const H = require('./lib/harness');

// One in-page v3 rules driver, injected into the host page. Uses window.FB
// (exposed by index.html) to run labelled ALLOW/DENY writes against the emulator.
// Returns collected checks + the room codes seeded for the post-grace second pass.
const V3_PART1 = async () => {
  const FB = window.FB;
  const ref = (p) => FB.ref(FB.db, 'rooms/' + p);
  const TS = () => FB.serverTimestamp();
  const P = (s, on) => ({ s, on, t: TS() });
  const rec = (id, tab) => ({ id, name: 'G', tab });
  const errc = (e) => String((e && (e.code || e.message)) || e);
  const set = async (p, v) => { try { await FB.set(ref(p), v); return { ok: true }; } catch (e) { return { ok: false, err: errc(e) }; } };
  const upd = async (p, o) => { try { await FB.update(ref(p), o); return { ok: true }; } catch (e) { return { ok: false, err: errc(e) }; } };
  const del = async (p) => { try { await FB.remove(ref(p)); return { ok: true }; } catch (e) { return { ok: false, err: errc(e) }; } };
  const read = async (p) => { const s = await FB.get(ref(p)); return s.exists() ? s.val() : null; };
  const CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const rcode = () => Array.from({ length: 4 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');
  const fresh = async () => { for (let i = 0; i < 12; i++) { const c = rcode(); if ((await read(c)) == null) return c; } throw new Error('no free code'); };
  const mkRoom = (fmt, visibility) => ({ v: 3, config: { winTarget: 3, fmt, visibility: visibility || 'private' }, gen: 0, state: 'lobby', p: { 0: P('HOSTTAB0', false) }, players: { 0: { id: 'HOST0000', name: 'H', tab: 'HOSTTAB0' } }, created: TS() });
  const checks = [];
  const c = (kind, name, res) => { checks.push({ kind, name, ok: kind === 'ALLOW' ? res.ok === true : res.ok === false, err: res && res.err || null }); return res; };
  const state = (name, ok) => checks.push({ kind: 'STATE', name, ok: !!ok, err: null });

  // ── Scenario A — 1v1 presence lifecycle (RESERVE→ARM→ACTIVATE→start→DISCONNECT) ──
  const A = await fresh();
  c('ALLOW', 'create 1v1 v3 (offline host)', await set(A, mkRoom('single')));
  c('DENY', 'create 1v1 boolean presence (old schema rejected)', await set(await fresh(), Object.assign(mkRoom('single'), { p: { 0: true } })));
  c('ALLOW', 'host ACTIVATE p/0', await upd(A, { 'p/0/on': true, 'p/0/t': TS() }));
  c('DENY', 'isolated players/1 without presence', await set(A + '/players/1', rec('GUEST001', 'GTAB0001')));
  state('isolated players/1 left no partial state', (await read(A + '/players/1')) === null);
  c('DENY', 'isolated p/1 RESERVE without players leg', await set(A + '/p/1', P('GTAB0001', false)));
  state('isolated p/1 RESERVE left no partial state', (await read(A + '/p/1')) === null);
  c('ALLOW', 'atomic RESERVE p/1 + players/1 (join)', await upd(A, { 'p/1': P('GTAB0001', false), 'players/1': rec('GUEST001', 'GTAB0001') }));
  c('ALLOW', 'ARM p/1 (t refresh only)', await upd(A, { 'p/1/t': TS() }));
  c('DENY', 'ARM p/1 foreign token', await upd(A, { 'p/1/s': 'EVILTAB0', 'p/1/t': TS() }));
  // Fund 1 — in single/double seat 1 may reach on:true ONLY atomically with the match
  //          start. An isolated ACTIVATE and a later separate state write are both DENY;
  //          only the coupled p/1.on + p/1.t + state:'playing' multi-path write succeeds.
  c('DENY', 'isolated ACTIVATE p/1 single lobby (must couple state)', await upd(A, { 'p/1/on': true, 'p/1/t': TS() }));
  state('isolated ACTIVATE left p/1 offline', (await read(A + '/p/1/on')) === false);
  c('DENY', 'separate start while p/1 offline (coupling)', await upd(A, { 'state': 'playing' }));
  state('separate start left state=lobby', (await read(A + '/state')) === 'lobby');
  c('DENY', 'isolated on flip without fresh t (host p/0 leaf)', await set(A + '/p/0/on', false));
  c('ALLOW', 'coupled ACTIVATE p/1 + start 1v1 (atomic)', await upd(A, { 'p/1/on': true, 'p/1/t': TS(), 'state': 'playing' }));
  c('ALLOW', 'move p0 (online)', await set(A + '/g/0/t/0/0', { idx: 0, dx: 10, dy: 10, sp: 0 }));
  c('ALLOW', 'DISCONNECT p/1 (same token)', await upd(A, { 'p/1/on': false, 'p/1/t': TS() }));
  // Fund 4 — a reconnect/ACTIVATE that also latches e in the SAME write is rejected as a
  //          whole; e is deferred (Fund 2), so the e leg alone already sinks the update.
  c('DENY', 'ACTIVATE p/1 + e latch in one write (Fund 4)', await upd(A, { 'p/1/on': true, 'p/1/t': TS(), 'g/0/e/1': true }));
  c('DENY', 'reconnect p/1 + e latch in one write (Fund 4)', await upd(A, { 'p/1/s': 'GTAB0011', 'p/1/t': TS(), 'players/1/tab': 'GTAB0011', 'g/0/e/1': true }));
  const a4p = await read(A + '/p/1');
  state('rejected ACTIVATE/reconnect+e left seat offline, no e, token intact', a4p !== null && a4p.on === false && a4p.s === 'GTAB0001' && (await read(A + '/g/0/e/1')) === null);
  // ── match reconnect: rotate the session token in p.s + players.tab TOGETHER,
  //    keep the player id; only from on:false in playing, only while e !== true ──
  c('DENY', 'reconnect rotate p/1.s WITHOUT players.tab (coupling)', await upd(A, { 'p/1/s': 'GTAB0009', 'p/1/t': TS() }));
  c('DENY', 'reconnect p/1 with player-id change (id frozen)', await upd(A, { 'p/1/s': 'GTAB0009', 'p/1/t': TS(), 'players/1/tab': 'GTAB0009', 'players/1/id': 'EVIL0001' }));
  c('ALLOW', 'match reconnect p/1 (new token, same id, atomic p.s+players.tab)', await upd(A, { 'p/1/s': 'GTAB0009', 'p/1/t': TS(), 'players/1/tab': 'GTAB0009' }));
  const arp = await read(A + '/p/1'), arr = await read(A + '/players/1');
  state('reconnect rotated token in both legs, kept player id', !!(arp && arr && arp.s === 'GTAB0009' && arr.tab === 'GTAB0009' && arr.id === 'GUEST001'));
  c('ALLOW', 'ACTIVATE p/1 after reconnect (new token)', await upd(A, { 'p/1/on': true, 'p/1/t': TS() }));
  c('DENY', 'reconnect p/1 while ONLINE (must be on:false)', await upd(A, { 'p/1/s': 'GTAB0010', 'p/1/t': TS(), 'players/1/tab': 'GTAB0010' }));
  c('ALLOW', 'DISCONNECT p/1 again (new token)', await upd(A, { 'p/1/on': false, 'p/1/t': TS() }));
  c('DENY', 'DISCONNECT p/0 foreign token', await upd(A, { 'p/0/s': 'EVILTAB0', 'p/0/on': false, 'p/0/t': TS() }));
  c('DENY', 'move p1 offline (no e coupling)', await set(A + '/g/0/t/0/1', { idx: 1, dx: 10, dy: 10, sp: 0 }));
  c('DENY', 'e latch p1 before grace', await set(A + '/g/0/e/1', true));
  c('DENY', 'room delete with p/players anchors', await del(A));

  // ── Scenario B — atomic reject leaves no partial + parallel write-once arbiter ──
  const B = await fresh();
  await set(B, mkRoom('ffa')); await upd(B, { 'p/0/on': true, 'p/0/t': TS() });
  c('DENY', 'atomic claim with invalid players leg', await upd(B, { 'p/1': P('GTAB0001', false), 'players/1': { id: 'x', name: 'g', tab: 'GTAB0001' } }));
  state('rejected atomic claim left no partial p/players', (await read(B + '/p/1')) === null && (await read(B + '/players/1')) === null);
  const par = await Promise.all([
    upd(B, { 'p/2': P('GTAB0002', false), 'players/2': rec('GUESTAAA', 'GTAB0002') }),
    upd(B, { 'p/2': P('GTAB0003', false), 'players/2': rec('GUESTBBB', 'GTAB0003') }),
  ]);
  state('parallel same-seat claim: exactly one winner', par.filter((r) => r.ok).length === 1);
  const bp2 = await read(B + '/p/2'), br2 = await read(B + '/players/2');
  state('seat 2 holds a consistent winner (tab === s)', !!(bp2 && br2 && bp2.s === br2.tab));
  c('DENY', 'atomic claim coupling mismatch (tab != s)', await upd(B, { 'p/3': P('GTAB0004', false), 'players/3': rec('GUEST003', 'WRONGTB0') }));
  state('coupling-mismatch claim left no partial p/players', (await read(B + '/p/3')) === null && (await read(B + '/players/3')) === null);

  // ── Scenario C — coupled 1v1 ACTIVATE+start requires an ONLINE host ──
  const C = await fresh();
  await set(C, mkRoom('single')); await upd(C, { 'p/0/on': true, 'p/0/t': TS() });
  await upd(C, { 'p/1': P('GTAB0001', false), 'players/1': rec('GUEST001', 'GTAB0001') });
  await upd(C, { 'p/0/on': false, 'p/0/t': TS() });                       // host goes offline
  c('DENY', 'coupled ACTIVATE+start with OFFLINE host', await upd(C, { 'p/1/on': true, 'p/1/t': TS(), 'state': 'playing' }));
  state('offline-host start left state=lobby', (await read(C + '/state')) === 'lobby');
  await upd(C, { 'p/0/on': true, 'p/0/t': TS() });                        // host back online
  c('ALLOW', 'coupled ACTIVATE+start with ONLINE host', await upd(C, { 'p/1/on': true, 'p/1/t': TS(), 'state': 'playing' }));

  // ── Scenario D2 — leg deletes are atomic (both legs together, or neither) ──
  const Del = await fresh();
  await set(Del, mkRoom('single')); await upd(Del, { 'p/0/on': true, 'p/0/t': TS() });
  await upd(Del, { 'p/1': P('GTAB0001', false), 'players/1': rec('GUEST001', 'GTAB0001') });
  c('DENY', 'isolated p/1 delete while players/1 present', await del(Del + '/p/1'));
  c('DENY', 'isolated players/1 delete while p/1 present', await del(Del + '/players/1'));
  c('ALLOW', 'atomic p/1 + players/1 lobby delete', await upd(Del, { 'p/1': null, 'players/1': null }));
  state('atomic leg delete removed both legs', (await read(Del + '/p/1')) === null && (await read(Del + '/players/1')) === null);

  // ── Scenario HR — a simultaneous host reactivation + match start is rejected. Uses
  //    ffa so the guest can go online independently in the lobby (in single/double that
  //    step would itself require the coupled start), isolating the host-offline guard. ──
  const HR = await fresh();
  await set(HR, mkRoom('ffa')); await upd(HR, { 'p/0/on': true, 'p/0/t': TS() });
  await upd(HR, { 'p/1': P('GTAB0001', false), 'players/1': rec('GUEST001', 'GTAB0001') });
  await upd(HR, { 'p/1/on': true, 'p/1/t': TS() });                       // guest online (ffa: independent)
  await upd(HR, { 'p/0/on': false, 'p/0/t': TS() });                      // host drops offline
  c('DENY', 'simultaneous host reactivation + match start', await upd(HR, { 'p/0/on': true, 'p/0/t': TS(), 'state': 'playing' }));
  state('host-reactivation start left state=lobby', (await read(HR + '/state')) === 'lobby');

  // ── Scenario PUB — public discovery index (feature/public-lobby-mvp) ──────────
  // Proves against the REAL rules what the local single-path model cannot: the
  // query-gated parent read, write-once listing create bound to a live public room,
  // private rooms never indexable, timestamp/extra-field validation, update reject,
  // and stale-only delete. Listings live at publicRooms/<code> = { created }.
  const pref = (p) => FB.ref(FB.db, 'publicRooms/' + p);
  const pset = async (p, v) => { try { await FB.set(pref(p), v); return { ok: true }; } catch (e) { return { ok: false, err: errc(e) }; } };
  const pdel = async (p) => { try { await FB.remove(pref(p)); return { ok: true }; } catch (e) { return { ok: false, err: errc(e) }; } };
  const PUB = await fresh();
  await set(PUB, mkRoom('ffa', 'public')); await upd(PUB, { 'p/0/on': true, 'p/0/t': TS() });   // public room, host online
  c('DENY', 'pub listing created != now (planted timestamp)', await pset(PUB, { created: 1 }));
  c('DENY', 'pub listing extra field beyond created', await pset(PUB, { created: TS(), name: 'x' }));
  c('ALLOW', 'pub listing create for a valid public lobby room', await pset(PUB, { created: TS() }));
  c('DENY', 'pub listing update rejected (write-once)', await pset(PUB, { created: TS() }));
  c('DENY', 'pub listing delete blocked while room open (public lobby, host online)', await pdel(PUB));
  // Parent read is allowed ONLY with orderByChild('created') + limitToLast(<=30).
  let pubQueryOk = false, pubIdx = null;
  try { const q = FB.query(FB.ref(FB.db, 'publicRooms'), FB.orderByChild('created'), FB.limitToLast(30)); const s = await FB.get(q); pubIdx = s.val() || {}; pubQueryOk = true; } catch (e) { pubQueryOk = false; }
  state('pub query (orderByChild created, limitToLast 30) allowed + lists the code', pubQueryOk && !!pubIdx && Object.prototype.hasOwnProperty.call(pubIdx, PUB));
  let pubPlainDenied = false;
  try { await FB.get(FB.ref(FB.db, 'publicRooms')); } catch (e) { pubPlainDenied = /permission/i.test(errc(e)); }
  state('pub plain read without a query denied', pubPlainDenied);
  let pubOverDenied = false;
  try { const q = FB.query(FB.ref(FB.db, 'publicRooms'), FB.orderByChild('created'), FB.limitToLast(31)); await FB.get(q); } catch (e) { pubOverDenied = /permission/i.test(errc(e)); }
  state('pub query with limitToLast 31 (over cap) denied', pubOverDenied);
  let pubNoLimitDenied = false;
  try { const q = FB.query(FB.ref(FB.db, 'publicRooms'), FB.orderByChild('created')); await FB.get(q); } catch (e) { pubNoLimitDenied = /permission/i.test(errc(e)); }
  state('pub query with orderByChild but NO limitToLast denied', pubNoLimitDenied);
  // A private room's listing is never accepted.
  const PUBP = await fresh();
  await set(PUBP, mkRoom('single', 'private')); await upd(PUBP, { 'p/0/on': true, 'p/0/t': TS() });
  c('DENY', 'pub listing for a PRIVATE room rejected (never indexable)', await pset(PUBP, { created: TS() }));
  // stale delete: once the match starts (state playing), the listing is removable.
  await upd(PUB, { 'p/1': P('GTAB0001', false), 'players/1': rec('GUEST001', 'GTAB0001') });
  await upd(PUB, { 'p/1/on': true, 'p/1/t': TS() });   // ffa: independent activate
  await upd(PUB, { 'state': 'playing' });               // ffa host-start (host + p/1 online)
  c('ALLOW', 'pub listing stale delete after match start (state playing)', await pdel(PUB));

  // ── Seed rooms whose offline seats must age past the grace window (second pass) ──
  const D = await fresh();                                                // recycle (lobby)
  await set(D, mkRoom('ffa')); await upd(D, { 'p/0/on': true, 'p/0/t': TS() });
  await upd(D, { 'p/1': P('GTAB0001', false), 'players/1': rec('GUEST001', 'GTAB0001') });
  c('DENY', 'recycle p/1+players/1 before grace', await upd(D, { 'p/1': P('GTAB0009', false), 'players/1': rec('NEW00001', 'GTAB0009') }));

  const E1 = await fresh();                                               // empty slot (playing)
  await set(E1, mkRoom('single')); await upd(E1, { 'p/0/on': true, 'p/0/t': TS() });
  await upd(E1, { 'p/1': P('GTAB0001', false), 'players/1': rec('GUEST001', 'GTAB0001') });
  await upd(E1, { 'p/1/on': true, 'p/1/t': TS(), 'state': 'playing' });   // coupled ACTIVATE+start
  await upd(E1, { 'p/1/on': false, 'p/1/t': TS() });                      // guest disconnects mid-match
  c('DENY', 'empty-slot sentinel+e before grace — deferred (Fund 2)', await upd(E1 + '/g/0', { 't/0/1': { idx: 1, dx: 0, dy: 0, sp: 0 }, 'e/1': true }));

  const E2 = await fresh();                                               // occupied slot (playing, move committed)
  await set(E2, mkRoom('single')); await upd(E2, { 'p/0/on': true, 'p/0/t': TS() });
  await upd(E2, { 'p/1': P('GTAB0001', false), 'players/1': rec('GUEST001', 'GTAB0001') });
  await upd(E2, { 'p/1/on': true, 'p/1/t': TS(), 'state': 'playing' });   // coupled ACTIVATE+start
  await set(E2 + '/g/0/t/0/1', { idx: 1, dx: 7, dy: 7, sp: 0 });          // guest commits a real move
  await upd(E2, { 'p/1/on': false, 'p/1/t': TS() });                      // then disconnects

  // best-effort purge of the finished lobby/match rooms. Leg deletes are atomic
  // (p + players together), so each seat is cleared in a single coupled update.
  const purge = async (code) => { for (let s = 0; s < 5; s++) { await upd(code, { ['p/' + s]: null, ['players/' + s]: null }); } await del(code); };
  for (const code of [A, B, C, Del, HR, PUB, PUBP]) await purge(code);

  return { checks, seeds: { D, E1, E2 } };
};

// Second pass: after the real grace window has elapsed, prove joint-token recycling (and
// that the old token is dead afterwards) and that the disconnect leave-sentinel + the
// elimination latch are currently DENY for both empty and occupied slots (Fund 2 deferred).
const V3_PART2 = async ({ D, E1, E2 }) => {
  const FB = window.FB;
  const ref = (p) => FB.ref(FB.db, 'rooms/' + p);
  const TS = () => FB.serverTimestamp();
  const P = (s, on) => ({ s, on, t: TS() });
  const rec = (id, tab) => ({ id, name: 'G', tab });
  const errc = (e) => String((e && (e.code || e.message)) || e);
  const set = async (p, v) => { try { await FB.set(ref(p), v); return { ok: true }; } catch (e) { return { ok: false, err: errc(e) }; } };
  const upd = async (p, o) => { try { await FB.update(ref(p), o); return { ok: true }; } catch (e) { return { ok: false, err: errc(e) }; } };
  const del = async (p) => { try { await FB.remove(ref(p)); return { ok: true }; } catch (e) { return { ok: false, err: errc(e) }; } };
  const read = async (p) => { const s = await FB.get(ref(p)); return s.exists() ? s.val() : null; };
  const checks = [];
  const c = (kind, name, res) => { checks.push({ kind, name, ok: kind === 'ALLOW' ? res.ok === true : res.ok === false, err: res && res.err || null }); return res; };
  const state = (name, ok) => checks.push({ kind: 'STATE', name, ok: !!ok, err: null });

  // D — recycle now allowed (offline seat aged past grace, lobby). Fund 3: recycling to a
  //     new identity requires the FULL joint token rotation. Neither single-leg form — an
  //     id change that keeps the old token, or a p.s rotation without the players leg — is
  //     accepted; only the atomic both-leg rotation succeeds. The old token is dead after.
  c('DENY', 'recycle id change WITHOUT token rotation (tab unchanged, Fund 3)', await upd(D, { 'players/1/id': 'HACK0001' }));
  c('DENY', 'recycle p.s rotation WITHOUT players leg (single-leg, Fund 3)', await upd(D, { 'p/1/s': 'GTAB0009', 'p/1/t': TS() }));
  const dOrig = await read(D + '/p/1');
  state('rejected single-leg recycles left the original token bound', !!(dOrig && dOrig.s === 'GTAB0001'));
  c('ALLOW', 'recycle p/1+players/1 after grace (full joint token rotation)', await upd(D, { 'p/1': P('GTAB0009', false), 'players/1': rec('NEW00001', 'GTAB0009') }));
  const dr = await read(D + '/players/1'), dp = await read(D + '/p/1');
  state('recycled roster carries the new id and rotated token', !!(dr && dr.id === 'NEW00001' && dr.tab === 'GTAB0009' && dp && dp.s === 'GTAB0009'));
  c('DENY', 'old token ARM after recycling (stale token rejected)', await upd(D, { 'p/1/s': 'GTAB0001', 'p/1/t': TS() }));
  c('DENY', 'old token DISCONNECT after recycling (stale token rejected)', await upd(D, { 'p/1/s': 'GTAB0001', 'p/1/on': false, 'p/1/t': TS() }));

  // E1 / E2 — Fund 2 DEFERRED: the disconnect leave-sentinel and the elimination latch are
  //           fully shut until the authoritative turn-pointer package lands. A seat that
  //           dropped mid-match cannot be eliminated by anyone, and its open slot cannot be
  //           filled — the turn stalls by design. E1 (empty slot) and E2 (a move already
  //           committed) prove every one of these transitions is currently locked.
  c('DENY', 'E1 empty slot: zero sentinel + e in one write — deferred', await upd(E1 + '/g/0', { 't/0/1': { idx: 1, dx: 0, dy: 0, sp: 0 }, 'e/1': true }));
  c('DENY', 'E1 empty slot: e-only latch — deferred', await set(E1 + '/g/0/e/1', true));
  c('DENY', 'E1 empty slot: bare leave-sentinel move (offline seat) — deferred', await set(E1 + '/g/0/t/0/1', { idx: 1, dx: 0, dy: 0, sp: 0 }));
  state('E1 left no e latch and an empty move slot', (await read(E1 + '/g/0/e/1')) === null && (await read(E1 + '/g/0/t/0/1')) === null);
  c('DENY', 'E2 occupied slot: e-only latch — deferred', await set(E2 + '/g/0/e/1', true));
  const e2move = await read(E2 + '/g/0/t/0/1');
  state('E2 committed move untouched and no e latch exists', (await read(E2 + '/g/0/e/1')) === null && !!(e2move && e2move.dx === 7));

  const purge = async (code) => { for (let s = 0; s < 5; s++) { await upd(code, { ['p/' + s]: null, ['players/' + s]: null }); } await del(code); };
  for (const code of [D, E1, E2]) await purge(code);

  return { checks };
};

(async () => {
  const result = { errors: [] };
  const state = {
    transformedHtml: null,
    prodHits: [], wsProdHits: [], otherBlocked: [], wsOtherBlocked: [], leaveWindows: [],
  };
  const diag = [];
  let staticServer = null, emu = null, browser = null, runDir = null;
  const preexistingLogs = H.preexistingRootLogs();

  try {
    result.matcherSelfTest = H.selfTestBenignMatcher();
    H.ok(`Benign-Matcher-Selbsttest bestanden (${result.matcherSelfTest.total} Fälle)`);

    for (const p of [H.EMU_PORT, ...H.EMU_AUX_PORTS]) {
      if (!(await H.portFree(p))) throw new Error(`Port ${p} belegt — Abbruch (kein Fremdprozess wird beendet).`);
    }
    H.ok(`Ports ${H.EMU_PORT}/${H.EMU_AUX_PORTS.join('/')} frei`);

    runDir = H.createRunDir();
    result.rulesHash = H.prepareTempRules(runDir);
    H.ok(`Run-Verzeichnis + Rules-Kopie (exklusiv, SHA-256 ${result.rulesHash.slice(0, 16)}…)`);

    const t = H.transformHtml(fs.readFileSync(H.INDEX_HTML, 'utf8'));
    state.transformedHtml = t.html;
    result.injection = t.report;
    t.report.forEach((r) => H.ok('Injektion — ' + r));

    staticServer = await H.startStaticServer();
    const NAV_URL = `http://${H.EMU_HOST}:${staticServer.port}/index.html?r2d=1`;
    H.ok(`Statischer Server auf :${staticServer.port}`);

    emu = H.startEmulator(runDir);
    await H.waitHttp(`http://${H.EMU_HOST}:${H.EMU_PORT}/.json?ns=${H.EMU_NS}`, 60000);
    H.ok('RTDB-Emulator bereit (JDK 21, prozesslokal) auf 127.0.0.1:9000');

    browser = await chromium.launch({ args: H.CHROMIUM_E2E_ARGS });

    // Two negative production-block probes (HTTP + WebSocket) via a throwaway ctx.
    result.negativeProbes = await H.runNegativeProbes({ browser, navUrl: NAV_URL, state, diag });
    H.ok('Produktions-Block bewiesen — HTTP-Fetch + WebSocket zu Produktion abgefangen (kein realer Connect)');

    const ctxH = await browser.newContext({ serviceWorkers: 'block' });
    await H.armContext(ctxH, 'host', state);
    const pageH = await ctxH.newPage();
    H.wireDiagnostics(pageH, 'host', diag);

    await pageH.goto(NAV_URL, { waitUntil: 'domcontentloaded' });
    await pageH.waitForFunction(() => window.__FB_READY === true, null, { timeout: 20000 });
    const emuFlagH = await pageH.evaluate(() => window.__E2E_EMULATOR === true);
    const fbErrH = await pageH.evaluate(() => window.__FB_ERR || null);
    if (!emuFlagH || fbErrH) throw new Error('Emulator-Injektion nicht aktiv oder FB-Fehler: ' + fbErrH);
    H.ok('Isolierter Kontext geladen; Emulator-Injektion aktiv, kein FB-Init-Fehler (window.FB verfügbar)');

    // ── v3 presence rules proof (raw window.FB writes vs. the real emulator) ──
    // NB: index.html is untouched and still on the boolean schema — one create with
    // the old p/0=true is written here purely to assert the new rules reject it.
    const part1 = await pageH.evaluate(V3_PART1);
    H.ok(`v3 Teil 1 — ${part1.checks.length} Presence-Checks (RESERVE/ARM/DISCONNECT/ACTIVATE, atomare Kopplung, Parallel-Arbiter, 1v1-Start online/offline Host, Grace-vor-15s)`);

    H.ok('Warte 16s, bis die Offline-Seats das 15s-Grace-Fenster überschreiten (Recycling/Grace/Sentinel)…');
    await H.sleep(16000);

    const part2 = await pageH.evaluate(V3_PART2, part1.seeds);
    H.ok(`v3 Teil 2 — ${part2.checks.length} Grace-Checks (Recycling nach 15s nur mit vollständiger Tokenrotation, alter Token danach tot, Disconnect-Sentinel/e-Latch bei leerem UND belegtem Slot gesperrt — Fund 2 verschoben)`);

    const allChecks = [...part1.checks, ...part2.checks];
    const failedChecks = allChecks.filter((k) => !k.ok);
    if (failedChecks.length) throw new Error('v3-Rules-Checks fehlgeschlagen:\n' + JSON.stringify(failedChecks, null, 2));
    result.v3 = { total: allChecks.length, passed: allChecks.length - failedChecks.length, seeds: part1.seeds, checks: allChecks };
    H.ok(`v3-Presence-Rules-Fundament bewiesen (Emulator, echte firebase.rules.json): ${allChecks.length} Checks grün`);

    if (state.prodHits.length || state.wsProdHits.length) {
      throw new Error('Unerwartete Produktionskontakte: ' + JSON.stringify({ http: state.prodHits, ws: state.wsProdHits }));
    }
    H.ok('Keine (unbeabsichtigten) Produktionskontakte während des Laufs');

    result.passed = true;
  } catch (e) {
    result.passed = false;
    result.errors.push(String(e && e.stack || e));
    console.error('\n[spike][FEHLER]', e && e.message || e);
  } finally {
    const clean = await H.cleanup({ browser, staticServer, emu, runDir, preexistingLogs });
    result.cleanup = clean;

    console.log('\n════════════════ SPIKE-BERICHT (JSON) ════════════════');
    console.log(JSON.stringify({
      passed: result.passed,
      injection: result.injection,
      rulesHash: result.rulesHash,
      matcherSelfTest: result.matcherSelfTest,
      negativeProbes: result.negativeProbes,
      v3: result.v3,
      prodHits: state.prodHits,
      wsProdHits: state.wsProdHits,
      otherBlocked: state.otherBlocked,
      wsOtherBlocked: state.wsOtherBlocked,
      diagnostics: diag,
      portsFree: clean.portsFree,
      cleanupOk: clean.cleanupOk,
      errors: result.errors,
    }, null, 2));
    console.log('═══════════════════════════════════════════════════════');
    process.exit(result.passed && result.cleanup.cleanupOk ? 0 : 1);
  }
})();
