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

  // Host waits until all seats are present, then starts (retry until state=playing).
  await H.poll(async () => {
    const p = await H.dbRead(host.page, `rooms/${code}/p`);
    if (!p) return null;
    for (let i = 0; i < clients.length; i++) if (!p[i]) return null;
    return true;
  }, 15000, 'Host sieht alle Seats präsent');
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

// ── Scenario 2: leave / sentinel during an active aim phase ──────────────────
async function scenarioLeave(ctx) {
  const r = { name: 'leave-sentinel' };
  const clients = [];
  try {
    for (let i = 0; i < 3; i++) clients.push(await newClient(ctx, i));
    const { code } = await setupRoom(clients, 3);
    r.roomCode = code;

    await waitAllAim(clients, 0, 25000);
    const remaining = [clients[0], clients[1]];
    const leaver = clients[2];

    // Close the leaver mid-aim (before it commits) → onDisconnect drops p/2.
    await leaver.context.close();
    leaver.closed = true;

    await H.poll(async () => {
      const p = await H.dbRead(remaining[0].page, `rooms/${code}/p`);
      return p && !p[2] ? true : null;
    }, 20000, 'verbleibende Clients sehen Seat 2 weg');

    // Remaining seats commit; seat 2's open slot is filled by the leave-sentinel.
    for (const c of remaining) await commitZeroSeat(c);

    // Authoritative slot 2 must be EXACTLY the production sentinel contract
    // {idx:(2+1)%5=3, dx:0, dy:0, sp:0} — not merely idx !== 2.
    const slots = await H.poll(async () => {
      const v = await readSlots(remaining[0].page, code, 0, 0);
      return v && v[0] && v[1] && v[2] ? v : null;
    }, 20000, 'alle Slots inkl. Sentinel für Seat 2');
    const sen = slots[2];
    assert(sen.idx === 3 && sen.dx === 0 && sen.dy === 0 && sen.sp === 0,
      `Sentinel Seat 2 nicht exakt {idx:3,dx:0,dy:0,sp:0}: ${JSON.stringify(sen)}`);
    r.sentinelSlot = sen;

    // Both remaining clients converge on the processed sentinel: seatGone[2] true
    // and identical locally-processed slot-2 idx across clients.
    await H.poll(async () => {
      for (const c of remaining) { const s = await snap(c.page); if (s.seatGone[2] !== true) return null; }
      return true;
    }, 20000, 'seatGone[2] bei allen verbleibenden Clients');
    const rs = [];
    for (const c of remaining) rs.push(await snap(c.page));
    assert(rs.every((s) => s.seatGone[2] === true), 'seatGone[2] nicht bei allen true');
    assert(new Set(rs.map((s) => s.commitIdx[2])).size === 1,
      'Verbleibende Clients uneinig über verarbeiteten Sentinel-Slot 2: ' + JSON.stringify(rs.map((s) => s.commitIdx[2])));

    // Slot value is stable (no double-sentinel overwrite). NOTE: stability proves
    // the authoritative value did not change — it does NOT by itself prove how many
    // sentinel transactions were attempted (write-once arbiter absorbs re-tries).
    const slot2a = await readSlots(remaining[0].page, code, 0, 0);
    await H.sleep(500);
    const slot2b = await readSlots(remaining[0].page, code, 0, 0);
    assert(JSON.stringify(slot2a[2]) === JSON.stringify(slot2b[2]), 'Doppelter Sentinel: Slot 2 hat sich verändert');

    // No endless turn: remaining clients reach the next aim; seat 2 stays gone.
    await waitAllAim(remaining, 1, 25000, 'verbleibende Clients erreichen Aim (turn 1)');
    await assertConverged(remaining, 'nach Leave-Sentinel');
    const s0 = await snap(remaining[0].page);
    assert(s0.seatGone[2] === true, 'Seat 2 nicht mehr als gone markiert nach Turn-Wechsel');
    r.passed = true;
    r.note = 'Retry-Limit-Fehlerpfad (SENTINEL_RETRY_MAX_ATTEMPTS→onlineConnectionLost) nicht erzwungen — nur über künstliche Transaction-Fehler simulierbar; abgedeckt durch bestehende FFA-Online-Race-Regressionstests. Slot-Stabilität beweist nicht die Anzahl versuchter Sentinel-Transactions.';
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
      return p && p[0] && p[1] ? true : null;
    }, 15000, 'Host B sieht beide Seats');
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

module.exports = { scenarioMatch, scenarioLeave, scenarioStaleness, PRODUCT_SPEC_COLORS };
