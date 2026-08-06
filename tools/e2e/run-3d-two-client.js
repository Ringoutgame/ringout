// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Zwei-Client-Online-Gameplay im ECHTEN 3D-Renderer
//
//   node tools/e2e/run-3d-two-client.js        (npm run test:e2e:3d2c)
//
// Schliesst die groesste Testluecke des Projekts: die bestehende Online-E2E
// (tools/e2e/run-ffa-e2e.js) faehrt bewusst mit ?r2d=1 — also OHNE den Renderer,
// den echte Spieler sehen — und der 3D-Waechter (run-r3d-regression.js) faehrt
// nur EINEN Client ohne Firebase. Zwischen beiden lag der gesamte Bereich, in dem
// autoritativer Zustand und gerenderte Kugel auseinanderlaufen koennen.
//
// Aufbau: JDK-21-RTDB-Emulator + lokaler Static-Server + harte Produktions-
// Firebase-Sperre (alles aus lib/harness.js), zwei isolierte Browser-Kontexte im
// echten 3D-Pfad (kein ?r2d=1, WebGL aktiv, Stage-2-Arena geladen), ein privater
// Online-FFA-Raum, und Zuege, die ueber echte Pointer-Events auf dem Canvas
// ausgeloest werden — nicht ueber Firebase-Schreibzugriffe.
//
// Zwischen den Zuegen wird der Renderer DICHT abgetastet (Aufloesung
// SAMPLE_MS): fuer jede Kugel Meshposition, Sichtbarkeit, Fall-Latch und die
// Collapse-Stufe. Genau dort entstehen die Fehlerbilder, die eine reine
// Zustandspruefung nie sieht.
//
// index.html auf Platte wird nie veraendert (Transform nur in-memory).
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const H = require('./lib/harness');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = process.env.R3D2C_OUT || path.join(REPO_ROOT, 'artifacts', 'online_sphere_disappear');
const TURNS = parseInt(process.env.R3D2C_TURNS || '32', 10);
const FMT = process.env.R3D2C_FMT === 'triple_ffa' ? 'triple_ffa' : 'ffa';
const CLIENTS = parseInt(process.env.R3D2C_CLIENTS || (FMT === 'triple_ffa' ? '3' : '2'), 10);
// Zuege, die bewusst Uhrzeit verbrauchen, damit Collapse 1 (30 s) und Collapse 2
// (60 s aktive Planungszeit) im Lauf tatsaechlich erreicht werden. Ohne sie
// committen die Clients in ~1 s pro Zug und ein Collapse faellt nie.
const SLOW_TURN_MS = 6200;
// In diesem Zug laesst EIN Spieler die Zugzeit bewusst komplett verstreichen —
// genau der Fall, der vor dem Fix als "Spieler hat das Match verlassen" gewertet
// wurde. TURN_LIMIT ist 7 s; wir warten sicher darueber hinaus.
const TIMEOUT_TURN = parseInt(process.env.R3D2C_TIMEOUT_TURN || '1', 10);
const TIMEOUT_SEAT = parseInt(process.env.R3D2C_TIMEOUT_SEAT || '1', 10);
const TIMEOUT_WAIT_MS = 11000;
const SAMPLE_MS = 40;               // Renderer-Abtastung waehrend der Zugaufloesung
const VIEWPORT = { width: 1000, height: 820 };
const GLB_R = 10.1;                 // sichtbare Aussenkante der Plattform im GLB (index.html)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (page) => page.evaluate(() => window.__ringoutE2E.snapshot());
// Zustand UND Renderer in EINEM evaluate: zwei getrennte Aufrufe liegen Frames
// auseinander, waehrend der Sim-Phase bewegt sich die Kugel dazwischen — der
// Vergleich "gerenderte Position == autoritative Position" braucht denselben
// Augenblick, sonst meldet er reine Messverschiebung als Fehler.
const sampleOne = (page) => page.evaluate(() => ({
  s: window.__ringoutE2E.snapshot(),
  p: window.__R3D_PROBE ? window.__R3D_PROBE() : null,
}));

// ── Schussplan: schwach/mittel/stark, gerade/diagonal, Richtung Mitte und Kante ──
// frac = Anteil an maxPull(), ang = Zugrichtung in rad. Der Schuss geht ENTGEGEN
// der Zugrichtung (Schleuder), ang zeigt also dorthin, wo der Finger hinzieht.
// R3D2C_POWER=gentle daempft die Zugstaerke: die Runden enden dann nicht bei fast
// jedem Zug, das Match laeuft lange genug fuer Collapse 1/2 und viele Zuege.
const GENTLE = process.env.R3D2C_POWER === 'gentle';
function shotPlan(turn, seat) {
  const fracs = GENTLE ? [0.08, 0.14, 0.20, 0.26] : [0.18, 0.45, 0.72, 0.96];
  const f = fracs[(turn + seat) % fracs.length];
  const ang = ((turn * 2 + seat * 3) % 8) * (Math.PI / 4);   // 8 Richtungen: gerade + diagonal
  return { frac: f, ang };
}

// ── Befundsammlung ───────────────────────────────────────────────────────────
// Bekannter, SEPARAT berichteter und bewusst NICHT behobener Kosmetikbefund:
// Faellt beim Ring-Collapse eine Kugel ausserhalb des neuen Radius, beginnt ihr
// kosmetischer Sturz sofort, waehrend das Segment unter ihr noch die Tremor-Phase
// laeuft — sie sinkt fuer ~0,3 s durch eine noch sichtbar ruhende Flaeche. Der
// Auftrag schliesst Aenderungen an Collapse-Timing und Collapse-Visuals aus, der
// Befund wird deshalb protokolliert, aber nicht als Blocker gewertet.
const KNOWN_COSMETIC = new Set(['dead-ball-sinks-through-visible-floor']);
const findings = [];       // blockierend
const observed = [];       // bekannt, nicht blockierend
const events = [];
// Regulaere Zugdeadline des Produkts (TURN_LIMIT_SECONDS). Reine Messgroesse fuer die
// Auswertung — der Test veraendert die Deadline nirgends.
const DEADLINE_MS = 7000;
// Getrennte Zaehler: ein nicht registrierter Pointer-Schuss ist nicht automatisch ein
// Fehler, darf aber auch nie stillschweigend verschwinden.
const counters = { realShotsRegistered: 0, expectedDeadlineAutoStands: 0,
                   unexpectedShotNotRegistered: 0, desyncFindings: 0 };
const DESYNC_KINDS = new Set(['client-state-divergence', 'client-radius-divergence',
                              'client-collapse-stage-divergence']);
function finding(kind, detail) {
  const f = { kind, ts: Date.now(), ...detail };
  if (DESYNC_KINDS.has(kind)) counters.desyncFindings++;
  if (KNOWN_COSMETIC.has(kind)) { observed.push(f); return f; }
  findings.push(f);
  console.log('  ‼ ' + kind + ' — ' + JSON.stringify(detail).slice(0, 400));
  return f;
}

// Ein Renderer-Sample beider Clients zu einem Zeitpunkt.
async function sampleBoth(clients, tag) {
  const out = { tag, t: Date.now(), c: [] };
  for (const c of clients) {
    let s = null, p = null, err = null;
    try { const r = await sampleOne(c.page); s = r.s; p = r.p; } catch (e) { err = String((e && e.message) || e); }
    out.c.push({ id: c.id, s, p, err });
  }
  return out;
}

// ── Fehlerbedingungen auf EINEM Sample eines Clients ─────────────────────────
// Alles hier ist eine Aussage ueber das, was der Spieler in diesem Frame SIEHT,
// verglichen mit dem autoritativen Zustand desselben Clients.
function checkSample(id, s, p, ctx) {
  const out = [];
  if (!s || !p) { out.push({ kind: 'sample-missing', client: id, ctx }); return out; }
  // Kein Client verlaesst waehrend der Zugschleife den Raum. Ein gesetztes seatGone
  // ist damit IMMER ein Fehlurteil — und genau dieses Fehlurteil wirft die Kugel
  // des Seats per ejectGoneSeats() aus der Arena.
  if (Array.isArray(s.seatGone) && s.seatGone.some(Boolean)) {
    out.push({ kind: 'seat-falsely-marked-gone', client: id, ctx, seatGone: s.seatGone, seatLeft: s.seatLeft });
  }
  if (!Array.isArray(p.meshes) || p.meshes.length !== s.balls.length) {
    out.push({ kind: 'mesh-count-mismatch', client: id, ctx, meshes: p.meshes && p.meshes.length, balls: s.balls.length });
    return out;
  }
  // Bodenebene der Arena in Weltkoordinaten. Die Randweg-Stufe (colvLift) liegt
  // DARUEBER; als Untergrenze zaehlt bewusst die Grundebene — eine Kugel unter
  // p.bob ist zweifelsfrei im Boden und nicht nur auf einer tieferen Stufe.
  const floorTop = p.bob;
  const platOuter = GLB_R * (p.platScale || 0);               // sichtbarer Plattform-Aussenradius (Weltunits)
  for (let i = 0; i < s.balls.length; i++) {
    const b = s.balls[i], m = p.meshes[i];
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) out.push({ kind: 'ball-not-finite', client: id, ctx, i, b });
    if (!m) { out.push({ kind: 'mesh-missing', client: id, ctx, i, alive: b.a }); continue; }
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.z)) {
      out.push({ kind: 'mesh-not-finite', client: id, ctx, i, m });
      continue;
    }
    // Die ENTSCHEIDENDE Kugel einer beendeten Runde bleibt bewusst alive und faellt
    // waehrend 'result'/'over' kosmetisch ueber die Kante (index.html: outBall).
    // Das ist Produktverhalten und darf hier nicht als Fehler zaehlen.
    const cosmeticFall = b.a && (p.phase === 'result' || p.phase === 'over') && i === p.outBall;
    if (b.a && !cosmeticFall) {
      // Lebende Kugel: MUSS sichtbar, in der Szene und auf der Flaeche stehen.
      if (!m.vis) out.push({ kind: 'alive-ball-invisible', client: id, ctx, i, b, m });
      if (!m.inScene) out.push({ kind: 'alive-ball-not-in-scene', client: id, ctx, i, b, m });
      if (Math.abs(m.x - b.x) > 0.75 || Math.abs(m.z - b.y) > 0.75) {
        out.push({ kind: 'alive-ball-render-offset', client: id, ctx, i, b, m });
      }
      if (m.y < p.bob + p.BR * 0.5) {
        out.push({ kind: 'alive-ball-below-floor', client: id, ctx, i, b, m, bob: p.bob, BR: p.BR });
      }
      const rr = Math.hypot(b.x - p.cx, b.y - p.cy);
      if (rr > p.R + p.BR * 0.1 + 0.5) {
        out.push({ kind: 'alive-ball-outside-radius', client: id, ctx, i, b, R: p.R, rr });
      }
    } else if (!b.a && m.vis) {
      // Ausgeschiedene Kugel faellt kosmetisch. Sie darf dabei NICHT durch eine
      // Flaeche sinken, die in genau diesem Frame noch sichtbar unter ihr liegt.
      const rr = Math.hypot(m.x - p.cx, m.z - p.cy);
      if (m.y < floorTop - p.BR && rr < platOuter - p.BR) {
        out.push({ kind: 'dead-ball-sinks-through-visible-floor', client: id, ctx, i,
                   meshY: m.y, floorTop, radius: rr, platOuter, colvCount: p.colvCount,
                   colvState: p.colvState, colv2State: p.colv2State, R: p.R, BR: p.BR });
      }
    }
  }
  return out;
}

// Querabgleich ALLER Clients gegen den ersten, auf dem autoritativen Zustand
// (im Ruhezustand). Ein Unterschied hier heisst: die Clients spielen nicht mehr
// dasselbe Match.
function checkCrossClient(entries, ctx) {
  const out = [];
  const pick = (s) => ({ gen: s.gen, turnNo: s.turnNo, phase: s.phase, seats: s.seats,
                         scores: s.scores, aliveCounts: s.aliveCounts, seatGone: s.seatGone, balls: s.balls });
  const a = entries[0];
  for (let i = 1; i < entries.length; i++) {
    const b = entries[i];
    if (!a.s || !b.s) continue;
    if (JSON.stringify(pick(a.s)) !== JSON.stringify(pick(b.s))) {
      out.push({ kind: 'client-state-divergence', ctx, a: pick(a.s), b: pick(b.s), pair: [a.id, b.id] });
    }
    if (a.p && b.p && Math.abs(a.p.R - b.p.R) > 1e-6) {
      out.push({ kind: 'client-radius-divergence', ctx, pair: [a.id, b.id], aR: a.p.R, bR: b.p.R });
    }
    if (a.p && b.p && a.p.colvCount !== b.p.colvCount) {
      out.push({ kind: 'client-collapse-stage-divergence', ctx, pair: [a.id, b.id], a: a.p.colvCount, b: b.p.colvCount });
    }
  }
  return out;
}

// ── Ein echter Schuss ueber den Produktions-Inputpfad ────────────────────────
// Ein Pointer-Schuss, der erst NACH Ablauf der regulaeren Zugdeadline abgesetzt wird,
// kann nicht mehr registriert werden: das Produkt hat den Zug da bereits ueber den
// Auto-Stand geschlossen. Das ist erwartetes Verhalten, kein Treiberfehler.
//
// aimSet allein beweist nichts — es wird von einem echten Schuss GENAUSO gesetzt wie
// vom Auto-Stand. Die Einstufung stuetzt sich deshalb ausschliesslich auf autoritative
// Serverdaten und den beidseitig beobachteten Zustand. Faellt auch nur eine Bedingung
// aus, bleibt es der bisherige blockierende Befund.
function classifyUnregisteredShot(u, ctx) {
  const reasons = [];
  const slot = ctx.slotsA ? ctx.slotsA[u.client] : null;
  const s0 = ctx.slotsA ? ctx.slotsA.s : null;
  const usedMs = (slot && typeof slot.ts === 'number' && typeof s0 === 'number') ? slot.ts - s0 : null;
  const ownIdx = ctx.balls ? ctx.balls.findIndex((b) => b.a && b.o === u.client) : -1;
  if (!ctx.slotsA) reasons.push('autoritative Slots nicht lesbar');
  if (!slot) reasons.push('kein Slot fuer diesen Seat');
  // Die Deadline MUSS nachweislich abgelaufen sein — Serverstempel gegen Phasenstempel.
  if (!(usedMs !== null && usedMs >= DEADLINE_MS)) reasons.push('Deadline nicht abgelaufen (usedMs=' + usedMs + ')');
  // Kanonischer eigener Stand: eigene Kugel und 0/0/0. Das schliesst zugleich den
  // Leave-Sentinel aus, der per Definition eine FREMDE Kugel traegt.
  if (!slot || slot.idx !== ownIdx) reasons.push('Slot traegt nicht die eigene Kugel (Sentinel-Muster)');
  if (!slot || slot.dx !== 0 || slot.dy !== 0 || slot.sp !== 0) reasons.push('kein kanonischer 0/0-Stand');
  if (!ctx.seatGoneAfter || !ctx.seatGoneAfter.every((sg) => sg && sg[u.client] === false)) {
    reasons.push('seatGone nicht auf beiden Clients false');
  }
  if (!ctx.genTurnAgree) reasons.push('gen/turn-Kontext beider Clients verschieden');
  if (!ctx.slotsB || JSON.stringify(ctx.slotsA) !== JSON.stringify(ctx.slotsB)) {
    reasons.push('autoritative Slots der beiden Clients verschieden');
  }
  if (ctx.desyncDelta !== 0) reasons.push('Desync-Befunde in diesem Zug: ' + ctx.desyncDelta);
  if (!ctx.settled) reasons.push('Turn hat nicht regulaer gesettlet');
  return { ok: reasons.length === 0, reasons, usedMs, slot, ownIdx };
}

async function realShot(c, turn) {
  const plan = shotPlan(turn, c.id);
  const geom = await c.page.evaluate((pl) => window.__ringoutE2E.aimPoints(pl.frac, pl.ang), plan);
  if (!geom) return { ok: false, reason: 'aimPoints null (kein 3D / keine lebende Kugel)' };
  if (geom.blocked) return { ok: false, reason: 'Kugelpunkt von HUD verdeckt: ' + geom.blockedBy, geom };
  if (!geom.inViewport) return { ok: false, reason: 'Zielpunkte ausserhalb des Viewports', geom };
  const m = c.page.mouse;
  await m.move(geom.down.x, geom.down.y);
  await m.down();
  // In mehreren Schritten ziehen — wie ein echter Finger, damit pointermove-Handler
  // (Ladeton, Live-Pull) denselben Verlauf sehen wie im Spiel.
  const STEPS = 6;
  for (let k = 1; k <= STEPS; k++) {
    await m.move(geom.down.x + (geom.up.x - geom.down.x) * k / STEPS,
                 geom.down.y + (geom.up.y - geom.down.y) * k / STEPS);
    await sleep(12);
  }
  await m.up();
  // Ist der Zug wirklich ueber den Canvas-Pfad angekommen? Ohne diese Kontrolle
  // wuerde ein verfehlter Griff still bleiben und der Zug erst durch die Uhr
  // schliessen — der Lauf haette dann etwas anderes geprueft als beabsichtigt.
  // Der Commit laeuft ueber eine Write-once-Transaction; aimSet setzt erst das
  // DB-Echo. Kurz nachfassen statt einmal zu raten — aber deutlich unter der
  // 7-s-Deadline, damit ein echter Timeout hier nie faelschlich als Erfolg zaehlt.
  let state = null, took = false;
  for (let k = 0; k < 12 && !took; k++) {
    state = await c.page.evaluate(() => {
      const s = window.__ringoutE2E.snapshot();
      return { aimSet: s.aimSet, myPlayer: s.myPlayer, phase: s.phase };
    }).catch(() => null);
    took = !!(state && (state.aimSet[state.myPlayer] || state.phase !== 'aim'));
    if (!took) await sleep(120);
  }
  return { ok: true, plan, geom, registered: took, state };
}

// ── Client-Fabrik: echter 3D-Pfad, kein ?r2d=1 ───────────────────────────────
async function newClient(ctx, id) {
  const context = await ctx.browser.newContext({ serviceWorkers: 'block', viewport: VIEWPORT });
  await H.armContext(context, 'c' + id, ctx.state);
  const page = await context.newPage();
  const diag = { pageErrors: [], consoleErrors: [], badResponses: [], failed: [] };
  page.on('pageerror', (e) => diag.pageErrors.push(String((e && e.message) || e)));
  page.on('console', (msg) => { if (msg.type() === 'error') diag.consoleErrors.push(msg.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) diag.badResponses.push(r.status() + ' ' + r.url()); });
  page.on('requestfailed', (r) => { const u = r.url(); if (!/favicon/.test(u)) diag.failed.push(u + ' :: ' + (r.failure() && r.failure().errorText)); });
  H.wireDiagnostics(page, 'c' + id, ctx.diag);
  await page.goto(ctx.navUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 30000 });
  // Der 3D-Pfad ist Pflicht: ein stiller 2D-Fallback wuerde diesen Test bedeutungslos machen.
  await page.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.body.classList.contains('r3d') && typeof window.__R3D_PROBE === 'function', null, { timeout: 30000 });
  const gl = await page.evaluate(() => { const c3 = document.getElementById('cv3d'); try { return !!c3 && !!(c3.getContext('webgl2') || c3.getContext('webgl')); } catch (_) { return false; } });
  if (!gl) throw new Error(`Client c${id}: kein WebGL-Kontext auf #cv3d`);
  return { id, context, page, diag, closed: false };
}

async function closeClient(c, ctx) {
  if (!c || c.closed) return;
  let code = null;
  try { const s = await snap(c.page); code = s && s.roomCode; } catch (_) {}
  const w = code ? H.beginLeaveWindow(ctx.state, code) : null;
  try { await c.page.evaluate(() => window.__ringoutE2E.leave()); } catch (_) {}
  if (w) H.endLeaveWindow(w);
  try { await c.context.close(); c.closed = true; } catch (_) {}
}

// ── Privater Online-Raum der FFA-Familie ─────────────────────────────────────
async function setupRoom(clients) {
  const host = clients[0];
  await host.page.evaluate((f) => window.__ringoutE2E.hostFFA(5, f), FMT);   // winTarget 5 -> mehr Runden
  const code = await H.poll(async () => {
    const s = await snap(host.page);
    return s && s.roomCode && s.roomCode.length === 4 ? s.roomCode : null;
  }, 20000, 'Host erstellt privaten ' + FMT + '-Raum');
  for (let i = 1; i < clients.length; i++) {
    await clients[i].page.evaluate((cd) => window.__ringoutE2E.joinFFA(cd), code);
    await H.poll(async () => {
      const s = await snap(clients[i].page);
      return s && s.online && s.myPlayer === i ? true : null;
    }, 20000, `Gast tritt bei (Seat ${i})`);
  }
  await H.poll(async () => {
    const p = await H.dbRead(host.page, `rooms/${code}/p`);
    if (!p) return null;
    for (let i = 0; i < clients.length; i++) if (!(p[i] && p[i].on === true)) return null;
    return true;
  }, 20000, 'alle Seats aktiv');
  await H.poll(async () => {
    await host.page.evaluate(() => window.__ringoutE2E.start());
    const st = await H.dbRead(host.page, `rooms/${code}/state`);
    return st === 'playing' ? true : null;
  }, 20000, 'Host startet Match');
  return code;
}

async function waitAllAim(clients, timeout, label) {
  return H.poll(async () => {
    const st = [];
    for (const c of clients) {
      const s = await snap(c.page);
      if (!(s && s.gameStarted && s.phase === 'aim')) return null;
      st.push(s);
    }
    return st;
  }, timeout, label);
}

// ── Hauptlauf ────────────────────────────────────────────────────────────────
(async () => {
  const state = { transformedHtml: null, prodHits: [], wsProdHits: [], otherBlocked: [], wsOtherBlocked: [], leaveWindows: [] };
  const diag = [];
  const report = { turns: [], findings, events, passed: false };
  let staticServer = null, emu = null, browser = null, runDir = null;
  const clients = [];
  fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    for (const p of [H.EMU_PORT, ...H.EMU_AUX_PORTS]) {
      if (!(await H.portFree(p))) throw new Error(`Port ${p} belegt — Abbruch.`);
    }
    runDir = H.createRunDir();
    report.rulesHash = H.prepareTempRules(runDir);
    const t = H.transformHtml(fs.readFileSync(H.INDEX_HTML, 'utf8'));
    state.transformedHtml = t.html;
    report.injection = t.report;
    t.report.forEach((l) => console.log('  ✓ Injektion — ' + l));

    staticServer = await H.startStaticServer();
    const navUrl = `http://${H.EMU_HOST}:${staticServer.port}/index.html`;   // BEWUSST ohne ?r2d=1
    emu = H.startEmulator(runDir);
    await H.waitHttp(`http://${H.EMU_HOST}:${H.EMU_PORT}/.json?ns=${H.EMU_NS}`, 90000);
    console.log('  ✓ Emulator + Static-Server bereit — ' + navUrl);

    // HEADED: der headless-SwiftShader-Chromium verliert beim ersten Launch
    // requestAnimationFrame (PROJECT.md) — ohne rAF rendert sync() nie.
    browser = await chromium.launch({ headless: false, args: [...H.CHROMIUM_E2E_ARGS, '--mute-audio', '--window-size=1010,880'] });
    const ctx = { browser, navUrl, state, diag };

    for (let i = 0; i < CLIENTS; i++) clients.push(await newClient(ctx, i));
    console.log('  ✓ ' + CLIENTS + ' Clients im echten 3D-Pfad (body.r3d, WebGL, Probe aktiv) — Format ' + FMT);

    const code = await setupRoom(clients);
    report.roomCode = code;
    console.log('  ✓ Privater Online-FFA-Raum ' + code + ' laeuft');

    let prevAlive = null;
    let prevR = null;

    for (let turn = 0; turn < TURNS; turn++) {
      const st = await waitAllAim(clients, 40000, `Aim-Phase vor Zug ${turn}`);
      const rest = await sampleBoth(clients, `aim-${turn}`);
      const restFindings = [];
      for (const e of rest.c) restFindings.push(...checkSample(e.id, e.s, e.p, `aim-${turn}`));
      restFindings.push(...checkCrossClient(rest.c, `aim-${turn}`));
      restFindings.forEach((f) => finding(f.kind, f));

      const p0 = rest.c[0].p;
      const row = { turn, gen: st[0].gen, turnNo: st[0].turnNo, phase: st[0].phase,
                    R: p0 && p0.R, collapseCount: p0 && p0.colvCount, colvStage: p0 && p0.colvStage,
                    scores: st[0].scores, aliveCounts: st[0].aliveCounts,
                    balls: st[0].balls, shots: [] };

      // Eliminierungen des VORHERIGEN Zuges gegen den damals gueltigen Radius pruefen.
      if (prevAlive) {
        for (let i = 0; i < st[0].balls.length; i++) {
          if (prevAlive[i] && !st[0].balls[i].a) {
            const b = st[0].balls[i];
            const rr = Math.hypot(b.x - 500, b.y - 500);
            row.eliminated = row.eliminated || [];
            row.eliminated.push({ i, rr, prevR, curR: p0 && p0.R });
            if (rr <= Math.min(prevR, p0 ? p0.R : prevR)) {
              finding('elimination-inside-arena', { turn, i, rr, prevR, curR: p0 && p0.R, ball: b });
            }
          }
        }
      }
      prevAlive = st[0].balls.map((b) => b.a);
      prevR = p0 ? p0.R : prevR;

      // Absichtliche Zeitueberschreitung: EIN Seat schiesst in diesem Zug gar nicht.
      // Die Online-Uhr fuellt seinen Slot nach Ablauf der 7-s-Deadline selbst — genau
      // der Ablauf, der vor dem Fix zur dauerhaften Ejection dieses Spielers fuehrte.
      const desyncBefore = counters.desyncFindings;
      const isTimeoutTurn = (turn === TIMEOUT_TURN);
      // Sonst verbrauchen einzelne langsame Zuege Uhrzeit, damit Collapse 1/2 fallen.
      if (!isTimeoutTurn && turn % 4 === 1) { row.slow = true; await sleep(SLOW_TURN_MS); }

      row.timeoutTurn = isTimeoutTurn;
      for (const c of clients) {
        if (isTimeoutTurn && c.id === TIMEOUT_SEAT) { row.shots.push({ client: c.id, skipped: 'absichtlicher Timeout' }); continue; }
        // Ein ausgeschiedener Seat hat keine Kugel mehr — dass er nicht schiesst,
        // ist der korrekte Spielzustand und kein Treiberfehler.
        if (!st[0].aliveCounts[c.id]) { row.shots.push({ client: c.id, skipped: 'Seat ausgeschieden' }); continue; }
        const r = await realShot(c, turn);
        row.shots.push({ client: c.id, ...r });
        if (!r.ok) finding('shot-not-dispatched', { turn, client: c.id, reason: r.reason });
        else if (!r.registered) {
          // Noch KEIN Befund: die Beweise (autoritative Slots, Settlement, seatGone,
          // Uebereinstimmung beider Clients) liegen erst nach Aufloesung des Zuges vor.
          (row.pendingUnregistered = row.pendingUnregistered || []).push(
            { turn, client: c.id, geom: r.geom, state: r.state });
        } else counters.realShotsRegistered++;
      }
      if (isTimeoutTurn) await sleep(TIMEOUT_WAIT_MS);   // Deadline sicher ueberschreiten

      // Dichte Renderer-Abtastung waehrend Reveal/Sim/Result — hier entsteht das Fehlerbild.
      const deadline = Date.now() + 26000;
      let settled = false, samples = 0, worst = null;
      while (Date.now() < deadline) {
        const smp = await sampleBoth(clients, `res-${turn}`);
        samples++;
        for (const e of smp.c) {
          const fs2 = checkSample(e.id, e.s, e.p, `res-${turn}`);
          for (const f of fs2) {
            if (!worst) worst = { smp, f };
            finding(f.kind, f);
          }
        }
        const phases = smp.c.map((e) => e.s && e.s.phase);
        const turns = smp.c.map((e) => e.s && e.s.turnNo);
        if (phases.every((ph) => ph === 'aim') && turns[0] === turns[1] && turns[0] > st[0].turnNo) { settled = true; break; }
        if (phases.every((ph) => ph === 'over')) { settled = true; row.over = true; break; }
        await sleep(SAMPLE_MS);
      }
      // Autoritative Rohwerte des soeben aufgeloesten Turns: NUR hier ist sichtbar,
      // mit welchem idx ein Slot belegt wurde (der Client sanitisiert ihn danach weg).
      try { row.dbSlots = await H.dbRead(clients[0].page, `rooms/${code}/g/${row.gen}/t/${row.turnNo}`); } catch (_) {}
      // Zweite Lesung aus dem ANDEREN Client: belegt, dass beide dieselben autoritativen
      // Slots sehen — Voraussetzung fuer die Deadline-Einstufung.
      let dbSlotsB = null;
      try { dbSlotsB = await H.dbRead(clients[1].page, `rooms/${code}/g/${row.gen}/t/${row.turnNo}`); } catch (_) {}
      if (row.timeoutTurn && row.dbSlots) {
        const slot = row.dbSlots[TIMEOUT_SEAT], s0 = row.dbSlots.s;
        const usedMs = (slot && typeof slot.ts === 'number' && typeof s0 === 'number') ? slot.ts - s0 : null;
        row.timeoutProof = { slot, phaseStart: s0, usedMs };
        if (!slot) finding('timeout-slot-missing', { turn, seat: TIMEOUT_SEAT });
        else {
          // Die Uhr MUSS wirklich abgelaufen sein — sonst beweist der Lauf nichts.
          if (!(usedMs !== null && usedMs >= 7000)) finding('timeout-not-actually-reached', { turn, usedMs, slot });
          // Und der No-Shot MUSS ein eigener Stand-Zug sein (0/0 auf eigener Kugel).
          const ownIdx = row.balls.findIndex((b) => b.a && b.o === TIMEOUT_SEAT);
          if (slot.idx !== ownIdx || slot.dx !== 0 || slot.dy !== 0 || slot.sp !== 0) {
            finding('timeout-noshot-not-own-stand', { turn, slot, expectedIdx: ownIdx });
          }
        }
      }
      let after = null;
      try {
        after = await sampleBoth(clients, `post-${turn}`);
        row.seatGoneAfter = after.c.map((e) => e.s && e.s.seatGone);
        row.seatLeftAfter = after.c.map((e) => e.s && e.s.seatLeft);
      } catch (_) {}

      // Jetzt erst entscheiden: erwartete Deadline-Zeitflanke oder echter Befund.
      if (row.pendingUnregistered && row.pendingUnregistered.length) {
        const gt = after ? after.c.map((e) => e.s && (e.s.gen + ':' + e.s.turnNo)) : [];
        const ctx = { slotsA: row.dbSlots, slotsB: dbSlotsB, balls: row.balls,
                      settled, seatGoneAfter: row.seatGoneAfter,
                      genTurnAgree: gt.length > 1 && gt.every((v) => v && v === gt[0]),
                      desyncDelta: counters.desyncFindings - desyncBefore };
        for (const u of row.pendingUnregistered) {
          const cls = classifyUnregisteredShot(u, ctx);
          if (cls.ok) {
            counters.expectedDeadlineAutoStands++;
            const rec = { kind: 'expected-deadline-autostand', ts: Date.now(),
              turn: u.turn, gen: row.gen, turnNo: row.turnNo, seat: u.client,
              deadlineOverrunMs: cls.usedMs - DEADLINE_MS, usedMs: cls.usedMs,
              canonicalSlot: cls.slot, ownIdx: cls.ownIdx,
              seatGone: row.seatGoneAfter, settled: !!settled,
              nextTurnContext: gt.length ? gt[0] : null };
            (row.expectedDeadlineAutoStands = row.expectedDeadlineAutoStands || []).push(rec);
            observed.push(rec);
            console.log('  o expected-deadline-autostand — ' + JSON.stringify(
              { turn: rec.turn, seat: rec.seat, usedMs: rec.usedMs, overrunMs: rec.deadlineOverrunMs }));
          } else {
            counters.unexpectedShotNotRegistered++;
            finding('shot-not-registered', { turn: u.turn, client: u.client,
              geom: u.geom, state: u.state, reasons: cls.reasons,
              usedMs: cls.usedMs, slot: cls.slot });
          }
        }
      }
      row.samples = samples;
      row.settled = settled;
      if (!settled) {
        // Vollbild des Zustands: nur so laesst sich unterscheiden, ob das Spiel
        // haengt oder der Testtreiber die Kugel verfehlt/das Menue getroffen hat.
        const deep = [];
        for (const c of clients) {
          try {
            deep.push(await c.page.evaluate(() => ({
              snap: window.__ringoutE2E.snapshot(),
              menuShown: !!document.getElementById('menu') && getComputedStyle(document.getElementById('menu')).display !== 'none',
              overlayShown: !!document.querySelector('#ov.show'),
              onlineShown: !!document.querySelector('#online.show'),
              coverShown: !!document.querySelector('#cover.show'),
              bodyClass: document.body.className,
              toast: (document.getElementById('toast') || {}).textContent || '',
            })));
          } catch (e) { deep.push({ error: String((e && e.message) || e) }); }
        }
        row.deepState = deep;
        const dir = path.join(OUT_DIR, `stall_turn_${turn}`);
        fs.mkdirSync(dir, { recursive: true });
        for (const c of clients) { try { await c.page.screenshot({ path: path.join(dir, `c${c.id}.png`) }); } catch (_) {} }
        fs.writeFileSync(path.join(dir, 'deep.json'), JSON.stringify(deep, null, 2));
        finding('turn-did-not-settle', { turn, deep });
      }
      if (worst) {
        const dir = path.join(OUT_DIR, `finding_turn_${turn}`);
        fs.mkdirSync(dir, { recursive: true });
        for (const c of clients) { try { await c.page.screenshot({ path: path.join(dir, `c${c.id}.png`) }); } catch (_) {} }
        fs.writeFileSync(path.join(dir, 'sample.json'), JSON.stringify(worst, null, 2));
        row.evidenceDir = dir;
      }
      report.turns.push(row);
      console.log(`  Zug ${turn}: turnNo=${row.turnNo} R=${row.R} collapse=${row.collapseCount} alive=${JSON.stringify(row.aliveCounts.slice(0, CLIENTS))} scores=${JSON.stringify(row.scores)} samples=${samples}${row.over ? ' [MATCHENDE]' : ''}`);

      // Matchende -> Rematch ueber den echten Produktionspfad. Danach MUSS die neue
      // Generation mit vollstaendig zurueckgesetztem seatGone und lauter aktiven
      // Kugeln starten (Vertrag von startOnlineGame).
      if (row.over) {
        const prevGen = row.gen;
        // Wie ein echter Spieler: erst erscheint das Siegoverlay (gameOver blendet es
        // 500 ms verzoegert ein), dann wird der ECHTE Rematch-Button geklickt. Ein
        // Rematch VOR dem Erscheinen laesst das nachlaufende setTimeout das Overlay
        // ueber das bereits gestartete Match legen — siehe Bericht (separater Befund).
        await H.poll(async () => (await clients[0].page.evaluate(() => !!document.querySelector('#ov.show'))) ? true : null,
          15000, 'Siegoverlay erscheint');
        await sleep(400);
        await clients[0].page.click('#rematchBtn');
        const fresh = await H.poll(async () => {
          const st2 = [];
          for (const c of clients) {
            const s = await snap(c.page);
            if (!(s && s.gameStarted && s.phase === 'aim' && s.gen > prevGen)) return null;
            st2.push(s);
          }
          return st2;
        }, 30000, 'Rematch: neue Generation erreicht Aim-Phase').catch((e) => { finding('rematch-failed', { turn, error: String(e && e.message || e) }); return null; });
        if (fresh) {
          report.rematches = (report.rematches || 0) + 1;
          // Das Siegoverlay MUSS nach dem Rematch weg sein — sonst liegt eine
          // unsichtbare Klickflaeche ueber der Arena und schluckt jede Eingabe.
          for (const c of clients) {
            const still = await c.page.evaluate(() => !!document.querySelector('#ov.show'));
            if (still) finding('overlay-blocks-arena-after-rematch', { turn, client: c.id });
          }
          for (const s of fresh) {
            if (s.seatGone.some(Boolean)) finding('rematch-seatgone-not-reset', { turn, seatGone: s.seatGone });
            if (!s.balls.every((b) => b.a)) finding('rematch-ball-not-active', { turn, balls: s.balls });
            if (!s.scores.every((v) => v === 0)) finding('rematch-score-not-reset', { turn, scores: s.scores });
          }
          console.log(`  ↻ Rematch nach Zug ${turn}: neue Generation ${fresh[0].gen}, seatGone=${JSON.stringify(fresh[0].seatGone)}, alle Kugeln aktiv`);
          continue;
        }
        break;
      }
    }

    for (const c of clients) {
      if (c.diag.pageErrors.length) finding('page-exception', { client: c.id, errors: c.diag.pageErrors });
      if (c.diag.badResponses.length) finding('asset-error', { client: c.id, responses: c.diag.badResponses });
    }
    report.clientDiag = clients.map((c) => ({ id: c.id, ...c.diag }));
    report.prodHits = state.prodHits;
    report.wsProdHits = state.wsProdHits;
    report.observed = observed;
    report.passed = findings.length === 0 && state.prodHits.length === 0 && state.wsProdHits.length === 0;
  } catch (e) {
    finding('run-aborted', { error: String((e && e.stack) || e) });
  } finally {
    for (const c of clients) await closeClient(c, { state, closeErrors: [] });
    const clean = await H.cleanup({ browser, staticServer, emu, runDir, closeErrors: [], preexistingLogs: [] });
    report.counters = counters;
    report.cleanup = clean;
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    const byKind = {};
    for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    console.log('\n════════ 3D-Zwei-Client-Bericht ════════');
    const obsKind = {};
    for (const f of observed) obsKind[f.kind] = (obsKind[f.kind] || 0) + 1;
    console.log('Zuege gespielt: ' + report.turns.length + '  ·  Blockierende Befunde: ' + findings.length);
    console.log('Schuesse registriert: ' + counters.realShotsRegistered
      + '  ·  erwartete Deadline-Auto-Stands: ' + counters.expectedDeadlineAutoStands
      + '  ·  unerwartet nicht registriert: ' + counters.unexpectedShotNotRegistered
      + '  ·  Desyncs: ' + counters.desyncFindings);
    console.log('Befundarten: ' + (Object.keys(byKind).length ? JSON.stringify(byKind, null, 2) : '(keine)'));
    console.log('Bekannt/nicht blockierend: ' + (Object.keys(obsKind).length ? JSON.stringify(obsKind) : '(keine)'));
    console.log('Bericht: ' + path.join(OUT_DIR, 'report.json'));
    console.log('════════════════════════════════════════');
    process.exit(report.passed && report.cleanup && report.cleanup.cleanupOk ? 0 : 1);
  }
})();
