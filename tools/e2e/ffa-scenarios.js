// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Online-FFA E2E scenarios
//
// Gameplay-level flows on top of lib/harness.js: five isolated browser clients,
// room setup, three full turns (one non-zero-move turn with an authoritative
// own-commit check, one with simultaneous commits), the leave/sentinel path, and
// a session-staleness smoke. All state changes go through the real production
// code paths (createRoom/joinRoom/startFfaMatch/commit); the test only triggers
// existing actions and reads authoritative state — it never fabricates or writes
// game/Firebase state directly.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const H = require('./lib/harness');

// The PRODUCT specification calls for seat colours Blau/Rot/Grün/Orange/Gelb.
// The shipped production code (PCOLS) currently uses a DIFFERENT palette. This
// harness does NOT change production colours and does NOT hard-code the current
// palette as the authoritative spec — it only verifies that all clients agree on
// one identical five-way-unique seat→colour mapping, and reports the deviation.
const PRODUCT_SPEC_COLORS = ['Blau', 'Rot', 'Grün', 'Orange', 'Gelb'];

// Authoritative fields that MUST agree across clients. Local-only view state
// (camera, hover, selection, pointer) is deliberately excluded. Ball positions/
// velocities/spin are included but only ever compared at rest (aim phase), where
// the deterministic golden physics make them bit-stable across clients.
const AUTH_FIELDS = ['roomCode', 'gen', 'turnNo', 'phase', 'seats', 'seatGone', 'scores', 'aliveCounts', 'winner', 'balls'];

// A small, legal non-zero pull (≈ dx·LAUNCH px/frame → a few-px nudge that never
// ejects a ball, keeping the three-turn advance deterministic) routed through the
// real commit()/sanitizeMove() path.
const NONZERO_DX = 5;
// Realistic upper bound for the spread of five concurrent commit dispatches on one
// machine. Exceeding it fails the run (with all five timestamps + the spread).
const CONCURRENT_MAX_SPREAD_MS = 100;

function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }
const snap = (page) => page.evaluate(() => window.__ringoutE2E.snapshot());
// Read the REAL rendered public-room list (feature/public-lobby-mvp): serialize each
// #onPublicList .proom row exactly as a human sees it — sanitized host name, mode +
// capacity meta, and whether the join button is present. No production/source string
// assertions: this reads the DOM the client actually rendered.
const readPublicRows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#onPublicList .proom')).map((row) => ({
  host: (row.querySelector('.pr-host') || {}).textContent || '',
  meta: (row.querySelector('.pr-meta') || {}).textContent || '',
  hasJoin: !!row.querySelector('.pr-join'),
})));
// Read the discovery index via the ONLY allowed path — the query read the client uses
// (orderByChild('created').limitToLast(30)). A direct per-code read of publicRooms/<code>
// is denied by the rules, so this proves index membership the same way the app does.
const readPublicIndexKeys = (page) => page.evaluate(async () => {
  const FB = window.FB;
  const q = FB.query(FB.ref(FB.db, 'publicRooms'), FB.orderByChild('created'), FB.limitToLast(30));
  const s = await FB.get(q);
  return Object.keys(s.val() || {});
});
const r4 = (n) => (typeof n === 'number' && isFinite(n)) ? Math.round(n * 1e4) / 1e4 : 0;

// ── Client factory: one isolated context = one player ────────────────────────
async function newClient(ctx, id) {
  const context = await ctx.browser.newContext({ serviceWorkers: 'block' });
  await H.armContext(context, 'c' + id, ctx.state); // both HTTP + WS routes active BEFORE any page/navigation
  const page = await context.newPage();
  H.wireDiagnostics(page, 'c' + id, ctx.diag);
  await page.goto(ctx.navUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready,
    null, { timeout: 20000 });
  const emuOk = await page.evaluate(() => window.__E2E_EMULATOR === true && !window.__FB_ERR);
  assert(emuOk, `Client c${id}: Emulator-Injektion nicht aktiv / FB-Init-Fehler`);
  // Per-context storage tag to prove isolation later.
  await page.evaluate((k) => { try { localStorage.setItem('__e2e_client', k); } catch (_) {} }, 'c' + id);
  return { id, context, page, closed: false };
}

// Leave through the real production path inside the benign-warning leave window,
// then close the context. Errors are collected (never silently swallowed) so the
// launcher can fail the run on them.
async function closeClient(c, ctx) {
  if (!c || c.closed) return;
  let code = null;
  try { const s = await snap(c.page); code = s && s.roomCode; } catch (_) {}
  const w = code ? H.beginLeaveWindow(ctx.state, code) : null;
  try { await c.page.evaluate(() => window.__ringoutE2E.leave()); }
  catch (e) { ctx.closeErrors.push(`leave c${c.id}: ${e && e.message || e}`); }
  if (w) H.endLeaveWindow(w);
  try { await c.context.close(); c.closed = true; }
  catch (e) { ctx.closeErrors.push(`close c${c.id}: ${e && e.message || e}`); }
}

// ── Convergence + assertion helpers ──────────────────────────────────────────
async function waitAllAim(clients, turnNo, timeout, label) {
  await H.poll(async () => {
    for (const c of clients) {
      const s = await snap(c.page);
      if (!(s && s.gameStarted && s.phase === 'aim' && s.turnNo === turnNo)) return null;
    }
    return true;
  }, timeout, label || `alle Clients Aim-Phase turn ${turnNo}`);
}

// Fields that may legitimately be null/absent. `winner` mirrors roundWinner, which
// is a number in practice (−1 when undecided) but is treated as documented-nullable
// here so its absence never fails validation. Every OTHER AUTH_FIELD is mandatory:
// a null there means a read error, and must fail loudly — never compare as equal.
const NULLABLE_AUTH = new Set(['winner']);

// Reject any snapshot whose mandatory comparison fields were lost to a read error
// (would otherwise let two erroring clients falsely "converge" on matching nulls
// or invented defaults/empty arrays). The expected array length is the ROOM's own
// authoritative seat count (snapshot field `seats`, i.e. production np()/ffaN) —
// NOT the number of still-connected test clients: a seat that left stays part of
// the room's seat count (only seatGone flips), so scenarioLeave's 2 SURVIVING
// clients still authoritatively report seats=3/scores.length=3/balls.length=3.
// Using the snapshot's own `seats` field (itself an AUTH_FIELD, cross-client
// compared) is therefore the only correct source — never a hardcoded "5" that
// would misfire on the 2/3-client scenarios. balls in particular must be a
// non-empty, exactly seat-sized array of fully-typed ball objects.
function validateSnap(id, s, label) {
  assert(s && typeof s === 'object', `Snapshot c${id} (${label}) fehlt oder ist kein Objekt`);
  for (const f of AUTH_FIELDS) {
    if (NULLABLE_AUTH.has(f)) continue;
    assert(s[f] !== null && s[f] !== undefined,
      `Pflichtfeld '${f}' bei c${id} (${label}) ist null/undefined — Lesefehler darf nicht als null falsch-grün werden`);
  }
  const seatCount = s.seats;
  assert(Number.isInteger(seatCount) && seatCount >= 2 && seatCount <= 5,
    `seats bei c${id} (${label}) unplausibel: ${seatCount}`);
  assert(typeof s.winner === 'number' && Number.isInteger(s.winner) && (s.winner === -1 || (s.winner >= 0 && s.winner < seatCount)),
    `winner bei c${id} (${label}) ungueltig: ${s.winner} (seats=${seatCount})`);

  assert(Array.isArray(s.scores) && s.scores.length === seatCount,
    `scores bei c${id} (${label}) falsche Laenge: ${JSON.stringify(s.scores)} (erwartet ${seatCount})`);
  for (let i = 0; i < s.scores.length; i++) {
    const v = s.scores[i];
    assert(Number.isFinite(v) && Number.isInteger(v) && v >= 0, `scores[${i}] bei c${id} (${label}) ungueltig: ${v}`);
  }

  assert(Array.isArray(s.seatGone) && s.seatGone.length === seatCount,
    `seatGone bei c${id} (${label}) falsche Laenge: ${JSON.stringify(s.seatGone)} (erwartet ${seatCount})`);
  for (let i = 0; i < s.seatGone.length; i++) assert(typeof s.seatGone[i] === 'boolean', `seatGone[${i}] bei c${id} (${label}) nicht boolean: ${s.seatGone[i]}`);

  assert(Array.isArray(s.aliveCounts) && s.aliveCounts.length === 5,
    `aliveCounts bei c${id} (${label}) falsche Laenge: ${JSON.stringify(s.aliveCounts)} (erwartet 5)`);
  for (let i = 0; i < s.aliveCounts.length; i++) {
    const n = s.aliveCounts[i];
    assert(Number.isInteger(n) && n >= 0, `aliveCounts[${i}] bei c${id} (${label}) ungueltig: ${n}`);
  }

  assert(Array.isArray(s.balls) && s.balls.length === seatCount,
    `balls-Anzahl bei c${id} (${label}) nicht scenario-plausibel: ${s.balls.length} (erwartet ${seatCount})`);
  for (let i = 0; i < s.balls.length; i++) {
    const b = s.balls[i];
    assert(b && typeof b === 'object', `Ball ${i} c${id} (${label}) kein Objekt`);
    assert(typeof b.o === 'number' && Number.isInteger(b.o) && b.o >= 0 && b.o < seatCount,
      `Ball ${i} c${id} (${label}) owner ungueltig: ${b.o} (seats=${seatCount})`);
    assert(typeof b.a === 'boolean', `Ball ${i} c${id} (${label}) alive nicht boolean: ${b.a}`);
    for (const k of ['x', 'y', 'vx', 'vy', 'sp']) {
      assert(Number.isFinite(b[k]), `Ball ${i} c${id} (${label}) Feld ${k} nicht endlich: ${b[k]}`);
    }
  }
}

function authSig(s) {
  const o = {};
  for (const f of AUTH_FIELDS) o[f] = s[f];
  return JSON.stringify(o);
}

// Compare authoritative snapshot fields across clients; throw on first divergence.
async function assertConverged(clients, label) {
  const snaps = [];
  for (const c of clients) snaps.push({ id: c.id, s: await snap(c.page) });
  for (const { id, s } of snaps) validateSnap(id, s, label); // no null-field false-green
  const base = authSig(snaps[0].s);
  for (let i = 1; i < snaps.length; i++) {
    if (authSig(snaps[i].s) !== base) {
      for (const f of AUTH_FIELDS) {
        const a = JSON.stringify(snaps[0].s[f]), b = JSON.stringify(snaps[i].s[f]);
        if (a !== b) {
          throw new Error(`DESYNC (${label}) Feld='${f}' clientRef=c${snaps[0].id} erwartet=${a} clientAbw=c${snaps[i].id} tatsächlich=${b}\nSnapshots=${JSON.stringify(snaps)}`);
        }
      }
    }
  }
  return snaps;
}

const validSlot = (s) => s && [0, 1, 2, 3, 4].includes(s.idx)
  && s.dx >= -195 && s.dx <= 195 && s.dy >= -195 && s.dy <= 195 && s.sp >= -1 && s.sp <= 1;

// Read authoritative turn slots for a given gen/turn (single source of truth).
async function readSlots(page, code, gen, turn) {
  return H.dbRead(page, `rooms/${code}/g/${gen}/t/${turn}`);
}

// ── Commit drivers (all through the real production commit() path) ────────────
// Host (seat 0) exercises the real DOM #actBtn onclick for zero-power commits;
// other seats mirror the same commit() path via the adapter.
async function commitZeroSeat(client) {
  if (client.id === 0) await client.page.evaluate(() => document.getElementById('actBtn').click());
  else await client.page.evaluate(() => window.__ringoutE2E.commitReady());
}
// A legal small non-zero move for every seat (host included) via the real path.
async function commitNonZeroSeat(client, dx) {
  await client.page.evaluate((v) => window.__ringoutE2E.commitMove(v, 0, 0), dx);
}

// ── Room setup: host creates, guests join, host starts ───────────────────────
async function setupRoom(clients, winTarget) {
  const host = clients[0];
  await host.page.evaluate((w) => window.__ringoutE2E.hostFFA(w), winTarget || 3);
  const code = await H.poll(async () => {
    const s = await snap(host.page);
    return s && s.roomCode && s.roomCode.length === 4 ? s.roomCode : null;
  }, 15000, 'Host erstellt FFA-Raum');

  // Guests join sequentially → deterministic seats 1..n-1 (claimSeat = lowest free).
  for (let i = 1; i < clients.length; i++) {
    await clients[i].page.evaluate((c) => window.__ringoutE2E.joinFFA(c), code);
    await H.poll(async () => {
      const s = await snap(clients[i].page);
      return s && s.online && s.myPlayer === i ? true : null;
    }, 15000, `Client c${i} tritt bei (Seat ${i})`);
  }

  // Colour contract (product-spec-agnostic): every client reports the SAME
  // five-way-unique seat→colour palette, and its own colour is palette[seat].
  const snaps = [];
  for (const c of clients) snaps.push(await snap(c.page));
  const basePalette = JSON.stringify(snaps[0].palette);
  const uniqueColors = new Set(snaps[0].palette).size;
  assert(snaps[0].palette.length === 5 && uniqueColors === 5,
    'Palette hat keine 5 eindeutigen Farben: ' + JSON.stringify(snaps[0].palette));
  const seats = new Set();
  const seatColors = [];
  for (let i = 0; i < clients.length; i++) {
    const s = snaps[i];
    assert(s.myPlayer === clients[i].id, `Seat-Zuordnung c${clients[i].id}: erwartet ${clients[i].id}, war ${s.myPlayer}`);
    seats.add(s.myPlayer);
    assert(JSON.stringify(s.palette) === basePalette, `Palette bei c${clients[i].id} weicht ab: ${JSON.stringify(s.palette)} != ${basePalette}`);
    assert(s.color === s.palette[s.myPlayer], `Eigene Farbe c${clients[i].id} != palette[${s.myPlayer}]`);
    seatColors.push({ seat: s.myPlayer, color: s.color });
  }
  assert(seats.size === clients.length, 'Seats nicht eindeutig: ' + JSON.stringify([...seats]));

  // Host waits until all seats are ACTIVE (v3: p/<seat>.on===true — a merely
  // reserved-but-not-yet-activated seat must not count), then starts.
  await H.poll(async () => {
    const p = await H.dbRead(host.page, `rooms/${code}/p`);
    if (!p) return null;
    for (let i = 0; i < clients.length; i++) if (!(p[i] && p[i].on === true)) return null;
    return true;
  }, 15000, 'Host sieht alle Seats aktiv');
  await H.poll(async () => {
    await host.page.evaluate(() => window.__ringoutE2E.start());
    const st = await H.dbRead(host.page, `rooms/${code}/state`);
    return st === 'playing' ? true : null;
  }, 15000, 'Host startet Match (state=playing)');

  await waitAllAim(clients, 0, 25000, 'alle Clients erreichen Aim (turn 0)');
  return { code, seatColors, palette: snaps[0].palette };
}

// Capture, during reveal (before the local commit arrays reset), each client's own
// locally-processed move and prove it equals the authoritative Firebase slot.
// commitIdx === -1 is NOT accepted as proof of authoritative take-over.
async function assertOwnCommitMatchesAuthority(clients, code, turn) {
  const per = await H.poll(async () => {
    const out = [];
    for (const c of clients) {
      const s = await snap(c.page);
      if (!(s.phase === 'reveal' && s.commitIdx[c.id] !== -1)) return null; // still not processed → keep polling
      out.push({ id: c.id, s });
    }
    return out;
  }, 25000, `Own-Commit vor Reset (reveal) turn ${turn}`);

  const proof = [];
  for (const { id, s } of per) {
    const slot = (await readSlots(clients[0].page, code, 0, turn))[id];
    assert(slot, `Kein autoritativer Slot für Seat ${id} turn ${turn}`);
    assert(s.commitIdx[id] === slot.idx, `Own-Commit c${id}: commitIdx=${s.commitIdx[id]} != slot.idx=${slot.idx}`);
    assert(s.commitAim[id] && r4(s.commitAim[id].dx) === r4(slot.dx) && r4(s.commitAim[id].dy) === r4(slot.dy),
      `Own-Commit c${id}: commitAim=${JSON.stringify(s.commitAim[id])} != slot dx/dy=${slot.dx}/${slot.dy}`);
    assert(r4(s.commitSpin[id]) === r4(slot.sp), `Own-Commit c${id}: commitSpin=${s.commitSpin[id]} != slot.sp=${slot.sp}`);
    proof.push({ seat: id, commitIdx: s.commitIdx[id], slotIdx: slot.idx });
  }
  return proof;
}

// ── Scenario 1: five clients, three full turns ───────────────────────────────
// turn 0: small NON-zero moves + authoritative own-commit-before-reset check.
// turn 1: five SIMULTANEOUS commits with a hard spread assertion.
// turn 2: zero-power commits. Every turn: slot validity + full convergence.
async function scenarioMatch(ctx) {
  const r = { name: 'match-5-clients', turns: [], concurrent: null };
  const clients = [];
  try {
    for (let i = 0; i < 5; i++) clients.push(await newClient(ctx, i));

    // Storage isolation: each context sees only its own tag.
    const tags = [];
    for (const c of clients) tags.push(await c.page.evaluate(() => localStorage.getItem('__e2e_client')));
    assert(new Set(tags).size === 5 && tags.every((t, i) => t === 'c' + i),
      'Storage-Isolation verletzt: ' + JSON.stringify(tags));
    r.storageIsolated = true;

    const { code, seatColors, palette } = await setupRoom(clients, 3);
    r.roomCode = code; r.seatColors = seatColors; r.palette = palette;

    for (let turn = 0; turn <= 2; turn++) {
      await waitAllAim(clients, turn, 25000);
      await assertConverged(clients, `vor Commit turn ${turn}`);
      for (const c of clients) {
        const s = await snap(c.page);
        assert(!s.reveal, `Vorzeitiges Reveal bei c${c.id} vor turn ${turn}`);
      }

      const nonZero = (turn === 0);
      const concurrent = (turn === 1);

      if (concurrent) {
        const dispatch = Date.now();
        const stamps = await Promise.all(clients.map((c) =>
          c.page.evaluate((isHost) => {
            const t0 = Date.now(); // measured AT the real commit call, not during any serial prep
            if (isHost) document.getElementById('actBtn').click();
            else window.__ringoutE2E.commitReady();
            return { t0, t1: Date.now() };
          }, c.id === 0)));
        const spreadMs = Math.max(...stamps.map((s) => s.t1)) - Math.min(...stamps.map((s) => s.t0));
        r.concurrent = { dispatch, stamps, spreadMs, threshold: CONCURRENT_MAX_SPREAD_MS };
        assert(spreadMs <= CONCURRENT_MAX_SPREAD_MS,
          `Commit-Spread ${spreadMs}ms > ${CONCURRENT_MAX_SPREAD_MS}ms — Starts=${JSON.stringify(stamps)}`);
      } else if (nonZero) {
        for (const c of clients) await commitNonZeroSeat(c, NONZERO_DX);
      } else {
        for (const c of clients) await commitZeroSeat(c);
      }

      // For the non-zero turn, prove each client's own processed move == authority
      // BEFORE the local commit arrays are reset for the next turn.
      if (nonZero) r.ownCommitProof = await assertOwnCommitMatchesAuthority(clients, code, turn);

      // Authoritative slots: all five present and valid.
      const slots = await H.poll(async () => {
        const v = await readSlots(clients[0].page, code, 0, turn);
        if (!v) return null;
        for (let s = 0; s < 5; s++) if (!v[s]) return null;
        return v;
      }, 20000, `alle 5 Commit-Slots turn ${turn}`);
      for (let s = 0; s < 5; s++) assert(validSlot(slots[s]), `Slot ${s} turn ${turn} ungültig: ${JSON.stringify(slots[s])}`);

      // Every client sees identical authoritative slots (read via each own FB).
      for (const c of clients) {
        const v = await readSlots(c.page, code, 0, turn);
        assert(JSON.stringify(v) === JSON.stringify(slots),
          `Slot-Divergenz turn ${turn} bei c${c.id}: ${JSON.stringify(v)} != ${JSON.stringify(slots)}`);
      }

      // Turn resolves for everyone → next aim (no client stuck). The moves used
      // never eject a ball, so the match always advances exactly one turn.
      await waitAllAim(clients, turn + 1, 25000, `alle Clients erreichen Aim (turn ${turn + 1})`);
      // Full authoritative convergence (incl. ball rest state) after the turn.
      await assertConverged(clients, `nach turn ${turn}`);
      r.turns.push({ turn, mode: concurrent ? 'concurrent' : (nonZero ? 'nonzero' : 'zero'), slotsValid: true, converged: true });
    }
    r.passed = true;
  } finally {
    for (const c of clients) await closeClient(c, ctx);
  }
  return r;
}

// ── Scenario 2 (B1-revised): lobby leave + seat reuse ─────────────────────────
// Mid-match leave/disconnect handling (Disconnect-Sentinel, Eliminierungs-Latch)
// is explicitly OUT of B1 scope. The v3 rules foundation from B0 defers it
// ("Fund 2", see tools/e2e/spike.js): a move-slot write for seat $pl requires
// root.p($pl).on===true, so no OTHER client can ever write a leave-sentinel for
// a seat that has gone offline under the current rules — that gap is tracked
// for Paket B, not exercised here. This scenario instead proves the path that
// IS in B1 scope: a deliberate LOBBY leave atomically frees p/<seat> AND
// players/<seat> together (leaveOnline), and the freed seat — genuinely absent,
// not merely stale — is claimable again by a fresh joiner (pickFreeSeat treats
// only a non-existent p/<seat> as free; no recycling of a stale reservation).
async function scenarioLeave(ctx) {
  const r = { name: 'lobby-leave-seat-reuse' };
  const clients = [];
  try {
    for (let i = 0; i < 3; i++) clients.push(await newClient(ctx, i));
    const host = clients[0], g1 = clients[1], leaver = clients[2];

    await host.page.evaluate((w) => window.__ringoutE2E.hostFFA(w), 3);
    const code = await H.poll(async () => {
      const s = await snap(host.page);
      return s && s.roomCode && s.roomCode.length === 4 ? s.roomCode : null;
    }, 15000, 'Host erstellt FFA-Raum');
    r.roomCode = code;

    // Sequential + polled joins (like setupRoom): joinFFA() only KICKS OFF the
    // async claim (page.evaluate resolves once the call returns, not once the
    // claim settles) — joining two guests back-to-back without waiting would let
    // them race for the SAME lowest-free-seat and land non-deterministically.
    for (let i = 1; i < clients.length; i++) {
      await clients[i].page.evaluate((cc) => window.__ringoutE2E.joinFFA(cc), code);
      await H.poll(async () => {
        const s = await snap(clients[i].page);
        return s && s.online && s.myPlayer === i ? true : null;
      }, 15000, `Client c${i} tritt bei (Seat ${i})`);
    }
    await H.poll(async () => {
      const p = await H.dbRead(host.page, `rooms/${code}/p`);
      return p && p[0] && p[0].on === true && p[1] && p[1].on === true && p[2] && p[2].on === true ? true : null;
    }, 15000, 'alle drei Seats aktiv in der Lobby');

    // Deliberate lobby leave (seat 2): real leaveOnline() path, atomic p+players delete.
    const w = H.beginLeaveWindow(ctx.state, code);
    await leaver.page.evaluate(() => window.__ringoutE2E.leave());
    H.endLeaveWindow(w);
    leaver.closed = true;

    await H.poll(async () => {
      const p = await H.dbRead(host.page, `rooms/${code}/p`);
      const pl = await H.dbRead(host.page, `rooms/${code}/players`);
      return (!p || p[2] == null) && (!pl || pl[2] == null) ? true : null;
    }, 15000, 'Seat 2 vollständig freigegeben (p UND players)');

    // A fresh joiner claims the now-genuinely-free seat 2 (no recycling involved —
    // the seat has no p/<seat> node left at all after the atomic leave-delete).
    const newcomer = await newClient(ctx, 2);
    clients[2] = newcomer;
    await newcomer.page.evaluate((cc) => window.__ringoutE2E.joinFFA(cc), code);
    await H.poll(async () => {
      const s = await snap(newcomer.page);
      return s && s.online && s.myPlayer === 2 ? true : null;
    }, 15000, 'Neuer Client belegt den freigegebenen Seat 2');

    // Host starts and the match proceeds normally with all three (now-active) seats.
    await H.poll(async () => {
      const p = await H.dbRead(host.page, `rooms/${code}/p`);
      return p && p[0] && p[0].on === true && p[1] && p[1].on === true && p[2] && p[2].on === true ? true : null;
    }, 15000, 'Host sieht alle drei Seats aktiv');
    await H.poll(async () => {
      await host.page.evaluate(() => window.__ringoutE2E.start());
      const st = await H.dbRead(host.page, `rooms/${code}/state`);
      return st === 'playing' ? true : null;
    }, 15000, 'Host startet Match (state=playing)');
    await waitAllAim(clients, 0, 25000, 'alle drei Clients erreichen Aim (turn 0)');
    for (const c of clients) await commitZeroSeat(c);
    await waitAllAim(clients, 1, 25000, 'alle drei Clients erreichen Aim (turn 1) nach normalem Turn');
    await assertConverged(clients, 'nach Lobby-Leave + Seat-Reuse');

    r.passed = true;
    r.note = 'Mid-Match-Leave/Disconnect (Disconnect-Sentinel, Eliminierungs-Latch) ist in B1 bewusst nicht umgesetzt — das v3-Rules-Fundament aus B0 verlangt für einen fremden Move-Slot-Write p/$seat.on===true ("Fund 2", verschoben auf Paket B). Dieses Szenario deckt stattdessen den tatsächlich in B1 umgesetzten Pfad ab: atomarer p+players-Delete beim bewussten Lobby-Leave und Wiederverwendung des dadurch echt freien Sitzes.';
  } finally {
    for (const c of clients) await closeClient(c, ctx);
  }
  return r;
}

// ── Scenario 3: session-staleness SMOKE — same context, room A → room B ───────
// This is a SMOKE check, not a full race proof: it verifies that reusing one
// browser context across rooms yields a fresh, playable room B and that ordinary
// old room-A activity has no visible effect on room B. The deep callback/retry/
// transaction races are covered by the FFA-Online-Race regression suite.
async function scenarioStaleness(ctx) {
  const r = { name: 'session-staleness-smoke' };
  let hostA = null, reuse = null, hostB = null;
  try {
    hostA = await newClient(ctx, 0);
    reuse = await newClient(ctx, 1); // seat 1 in room A
    const a = await setupRoom([hostA, reuse], 3);
    r.roomA = a.code;
    await waitAllAim([hostA, reuse], 0, 25000);

    // Reuse context leaves room A (leaveOnline: session++, listeners unsubscribed),
    // inside a benign-warning leave window for room A.
    await H.registerLeave(ctx.state, a.code, () => reuse.page.evaluate(() => window.__ringoutE2E.leave()));
    await H.poll(async () => {
      const s = await snap(reuse.page);
      return s && !s.online ? true : null;
    }, 10000, 'Reuse-Client hat Raum A verlassen');

    // Room B: fresh host (gen 0). Reuse context joins → same seat 1, turn/gen reset.
    hostB = await newClient(ctx, 0);
    await hostB.page.evaluate(() => window.__ringoutE2E.hostFFA(3));
    const codeB = await H.poll(async () => {
      const s = await snap(hostB.page);
      return s && s.roomCode && s.roomCode.length === 4 ? s.roomCode : null;
    }, 15000, 'Host erstellt Raum B');
    r.roomB = codeB;
    assert(codeB !== a.code, 'Raum B hat denselben Code wie Raum A');

    reuse.id = 1; // rejoin as seat 1
    await reuse.page.evaluate((c) => window.__ringoutE2E.joinFFA(c), codeB);
    await H.poll(async () => {
      const s = await snap(reuse.page);
      return s && s.online && s.roomCode === codeB && s.myPlayer === 1 ? true : null;
    }, 15000, 'Reuse-Client tritt Raum B bei (Seat 1)');

    await H.poll(async () => {
      const p = await H.dbRead(hostB.page, `rooms/${codeB}/p`);
      return p && p[0] && p[0].on === true && p[1] && p[1].on === true ? true : null;
    }, 15000, 'Host B sieht beide Seats aktiv');
    await H.poll(async () => {
      await hostB.page.evaluate(() => window.__ringoutE2E.start());
      const st = await H.dbRead(hostB.page, `rooms/${codeB}/state`);
      return st === 'playing' ? true : null;
    }, 15000, 'Host B startet Match');
    await waitAllAim([hostB, reuse], 0, 25000, 'Raum B erreicht Aim (turn 0)');

    // Room B is fresh: gen 0, turn 0, reuse context not terminated, no stale seatGone.
    const sB = await snap(reuse.page);
    assert(sB.gen === 0 && sB.turnNo === 0, `Raum B nicht frisch: gen=${sB.gen} turn=${sB.turnNo}`);
    assert(sB.terminated === false, 'Reuse-Client fälschlich terminiert in Raum B');
    assert(sB.seatGone.every((v) => v === false), 'Stale seatGone in Raum B: ' + JSON.stringify(sB.seatGone));

    // Ordinary old room-A activity must not touch room B: host A commits in room A;
    // the reuse context's room-B authoritative state must stay stable.
    const before = authSig(await snap(reuse.page));
    await hostA.page.evaluate(() => document.getElementById('actBtn').click());
    await H.sleep(1200);
    const after = authSig(await snap(reuse.page));
    assert(before === after, `Raum-A-Aktivität hat Raum B verändert:\nvor=${before}\nnach=${after}`);

    // Room B stays playable: both commit, converge to next turn.
    await commitZeroSeat(hostB);
    await reuse.page.evaluate(() => window.__ringoutE2E.commitReady());
    await waitAllAim([hostB, reuse], 1, 25000, 'Raum B spielbar (turn 1)');
    r.passed = true;
    r.note = 'Smoke: tiefe verspätete Transactions/Callback-Auslieferungen/Retry-Timer werden NICHT künstlich provoziert — abgedeckt durch FFA-Online-Race-Regression.';
  } finally {
    for (const c of [hostA, reuse, hostB]) await closeClient(c, ctx);
  }
  return r;
}

// ── Scenario 4: PUBLIC LOBBY — real UI create → discover → list-join → start ──
// A production-near flow entirely through the real UI and the real joinRoom() path:
//   • host creates a PUBLIC room via the visibility toggle + create button,
//   • a second client creates a PRIVATE room the same way,
//   • an observer opens the dialog and sees ONLY the public room in the rendered list,
//     with the host name, mode and player count visible,
//   • a joiner joins by clicking the list's own join button (joinPublicRoom only hands
//     the code to the existing joinRoom() — no second join path),
//   • the host starts the match and the listing disappears from the observer's list.
// Private room never appears; production Firebase is hard-blocked (checked by launcher).
async function scenarioPublicLobby(ctx) {
  const r = { name: 'public-lobby-ui' };
  const clients = [];
  try {
    const host = await newClient(ctx, 0); clients.push(host);
    const priv = await newClient(ctx, 1); clients.push(priv);
    const obs = await newClient(ctx, 2); clients.push(obs);
    const joiner = await newClient(ctx, 3); clients.push(joiner);

    // ── Host creates a PUBLIC room through the real UI: open dialog → click the public
    //    visibility toggle → click the create button. ──
    await host.page.evaluate(() => window.__ringoutE2E.openOnlineFFA());
    await host.page.evaluate(() => document.getElementById('onVisPub').click());   // real toggle handler → createVisibility='public'
    await host.page.evaluate(() => document.getElementById('onCreate').click());   // real onCreate handler → createRoom()
    const pubCode = await H.poll(async () => {
      const s = await snap(host.page); return s && s.roomCode && s.roomCode.length === 4 ? s.roomCode : null;
    }, 15000, 'Host erstellt öffentlichen Raum über die UI');
    r.publicCode = pubCode;

    // ── Second client creates a PRIVATE room (visibility toggle left at its private
    //    default) the same way. ──
    await priv.page.evaluate(() => window.__ringoutE2E.openOnlineFFA());
    await priv.page.evaluate(() => document.getElementById('onCreate').click());
    const privCode = await H.poll(async () => {
      const s = await snap(priv.page); return s && s.roomCode && s.roomCode.length === 4 ? s.roomCode : null;
    }, 15000, 'zweiter Client erstellt privaten Raum über die UI');
    r.privateCode = privCode;
    assert(privCode !== pubCode, 'privater und öffentlicher Raumcode müssen verschieden sein');

    // Discovery index (via the allowed query read): public code present, private NEVER.
    await H.poll(async () => {
      const keys = await readPublicIndexKeys(host.page);
      return keys.indexOf(pubCode) >= 0 && keys.indexOf(privCode) < 0 ? true : null;
    }, 15000, 'Index enthält den öffentlichen, NICHT den privaten Raum');

    // ── Observer opens the dialog and sees the public room in the REAL rendered list;
    //    exactly one row, private room absent, host name / mode / count visible. ──
    await obs.page.evaluate(() => window.__ringoutE2E.openOnlineFFA());
    const rows0 = await H.poll(async () => {
      const rows = await readPublicRows(obs.page);
      return rows.length === 1 ? rows : null;
    }, 15000, 'Observer sieht genau EINEN öffentlichen Raum in der Liste');
    const expName = await H.dbRead(host.page, 'rooms/' + pubCode + '/players/0/name');
    assert(typeof expName === 'string' && expName.length >= 1, 'Host-Roster-Name vorhanden: ' + expName);
    assert(rows0[0].host === String(expName), 'Listen-Hostname == players/0.name: ' + rows0[0].host + ' vs ' + expName);
    assert(/FFA/.test(rows0[0].meta), 'Listen-Modus FFA sichtbar: ' + rows0[0].meta);
    assert(/(^|\D)1\/5(\D|$)/.test(rows0[0].meta), 'Listen-Spielerzahl 1/5 (nur Host aktiv) sichtbar: ' + rows0[0].meta);
    assert(rows0[0].hasJoin === true, 'Beitreten-Button in der Zeile vorhanden');

    // ── Joiner opens the dialog, sees the room, and JOINS by clicking the list's own
    //    join button — the same existing joinRoom() path. ──
    await joiner.page.evaluate(() => window.__ringoutE2E.openOnlineFFA());
    await H.poll(async () => { const rows = await readPublicRows(joiner.page); return rows.length === 1 && rows[0].hasJoin ? true : null; }, 15000, 'Joiner sieht den öffentlichen Raum in der Liste');
    await joiner.page.evaluate(() => { const b = document.querySelector('#onPublicList .proom .pr-join'); if (b) b.click(); });
    await H.poll(async () => {
      const s = await snap(joiner.page); return s && s.online && s.roomCode === pubCode && s.myPlayer === 1 ? true : null;
    }, 15000, 'Joiner tritt über den Listenbutton bei (Seat 1, echter joinRoom-Pfad)');
    await H.poll(async () => {
      const p = await H.dbRead(host.page, 'rooms/' + pubCode + '/p');
      return p && p[0] && p[0].on === true && p[1] && p[1].on === true ? true : null;
    }, 15000, 'Host + Joiner beide aktiv in der öffentlichen Lobby');

    // ── Host starts the match; the listing must disappear from the observer's list.
    //    (Presence-driven live count updates are deliberately NOT required in the MVP —
    //    the row refreshes on index change, and the index change on start is exactly
    //    the removal we assert here.) ──
    await H.poll(async () => {
      await host.page.evaluate(() => window.__ringoutE2E.start());
      const st = await H.dbRead(host.page, 'rooms/' + pubCode + '/state');
      return st === 'playing' ? true : null;
    }, 15000, 'Host startet Match (state=playing)');
    await H.poll(async () => { const keys = await readPublicIndexKeys(obs.page); return keys.indexOf(pubCode) < 0 ? true : null; }, 15000, 'Listing nach Matchstart aus dem Index entfernt');
    await H.poll(async () => { const rows = await readPublicRows(obs.page); return rows.length === 0 ? true : null; }, 15000, 'Observer-Liste ist nach Matchstart leer');

    r.passed = true;
    r.note = 'Voller UI-Pfad: Sichtbarkeits-Toggle + Erstellen-Button, echte Listendarstellung, Beitritt über den Listen-Button (joinPublicRoom → bestehender joinRoom), Listing verschwindet bei Matchstart. Live-Aktualisierung der Spielerzahl pro Presence-Änderung ist im MVP bewusst nicht Teil des Umfangs.';
  } finally {
    for (const c of clients) await closeClient(c, ctx);
  }
  return r;
}

module.exports = { scenarioMatch, scenarioLeave, scenarioStaleness, scenarioPublicLobby, PRODUCT_SPEC_COLORS };
