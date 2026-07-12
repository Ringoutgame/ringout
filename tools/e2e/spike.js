// ─────────────────────────────────────────────────────────────────────────────
// RingOut — E2E Feasibility-Spike (Online-FFA) — standalone diagnostic
//
// Proves the minimal building blocks the full harness relies on, using the SAME
// shared infrastructure (lib/harness.js — no duplicated setup): in-memory HTML
// transform, hard production block over HTTP + WebSocket, JDK-21 emulator (per-run
// isolated temp dir), authoritative read, and a commit driven once via DOM (host)
// and once via the test adapter (guest). It builds nothing permanent and cleans up
// every process/port/temp file the run itself created.
//
// Run:  node tools/e2e/spike.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const { chromium } = require('@playwright/test');
const H = require('./lib/harness');

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
    const ctxG = await browser.newContext({ serviceWorkers: 'block' });
    await H.armContext(ctxH, 'host', state);
    await H.armContext(ctxG, 'guest', state);
    const pageH = await ctxH.newPage();
    const pageG = await ctxG.newPage();
    H.wireDiagnostics(pageH, 'host', diag);
    H.wireDiagnostics(pageG, 'guest', diag);

    await pageH.goto(NAV_URL, { waitUntil: 'domcontentloaded' });
    await pageG.goto(NAV_URL, { waitUntil: 'domcontentloaded' });
    for (const pg of [pageH, pageG]) {
      await pg.waitForFunction(() => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 20000 });
    }
    const emuFlagH = await pageH.evaluate(() => window.__E2E_EMULATOR === true);
    const fbErrH = await pageH.evaluate(() => window.__FB_ERR || null);
    if (!emuFlagH || fbErrH) throw new Error('Emulator-Injektion nicht aktiv oder FB-Fehler: ' + fbErrH);
    H.ok('Zwei isolierte Kontexte geladen; Emulator-Injektion aktiv, kein FB-Init-Fehler');

    // Host creates FFA room via adapter; read authoritative room from emulator.
    await pageH.evaluate(() => window.__ringoutE2E.hostFFA(3));
    const code = await H.poll(async () => {
      const s = await pageH.evaluate(() => window.__ringoutE2E.snapshot());
      return s && s.roomCode && s.roomCode.length === 4 ? s.roomCode : null;
    }, 15000, 'Host erstellt FFA-Raum');
    H.ok(`Host hat FFA-Raum erstellt: ${code}`);

    const authRoom = await H.dbRead(pageH, 'rooms/' + code);
    if (!authRoom || authRoom.v !== 2 || authRoom.config.fmt !== 'ffa' || authRoom.p[0] !== true || authRoom.state !== 'lobby') {
      throw new Error('Autoritativer Raumzustand unerwartet: ' + JSON.stringify(authRoom));
    }
    H.ok('Autoritativer Testzustand aus Emulator gelesen (rooms/' + code + ': v2, ffa, lobby, p0=true)');
    result.authRoom = authRoom;

    await pageG.evaluate((c) => window.__ringoutE2E.joinFFA(c), code);
    await H.poll(async () => {
      const s = await pageG.evaluate(() => window.__ringoutE2E.snapshot());
      return s && s.myPlayer === 1 && s.online ? true : null;
    }, 15000, 'Gast tritt bei (Seat 1)');
    H.ok('Gast beigetreten, Seat 1 zugewiesen');

    await H.poll(async () => {
      const p = await H.dbRead(pageH, 'rooms/' + code + '/p');
      return p && p[0] === true && p[1] === true ? true : null;
    }, 15000, 'Host sieht beide Seats');
    await pageH.evaluate(() => window.__ringoutE2E.start());

    for (const [pg, lbl] of [[pageH, 'host'], [pageG, 'guest']]) {
      await H.poll(async () => {
        const s = await pg.evaluate(() => window.__ringoutE2E.snapshot());
        return s && s.gameStarted && s.phase === 'aim' ? true : null;
      }, 20000, `${lbl} erreicht Aim-Phase`);
    }
    H.ok('Match gestartet — beide Clients in Aim-Phase (gen 0, turn 0)');

    await pageH.evaluate(() => document.getElementById('actBtn').click()); // real production onclick → commit()
    await pageG.evaluate(() => window.__ringoutE2E.commitReady());          // adapter mirror of the same path

    const slots = await H.poll(async () => {
      const v = await H.dbRead(pageH, 'rooms/' + code + '/g/0/t/0');
      return v && v[0] && v[1] ? v : null;
    }, 15000, 'Beide Commit-Slots autoritativ in DB');
    const validSlot = (s) => s && [0, 1, 2, 3, 4].includes(s.idx)
      && s.dx >= -195 && s.dx <= 195 && s.dy >= -195 && s.dy <= 195 && s.sp >= -1 && s.sp <= 1;
    if (!validSlot(slots[0]) || !validSlot(slots[1])) throw new Error('Slot-Payload ungültig: ' + JSON.stringify(slots));
    H.ok('Aim/Commit bewiesen — DOM (host) & Adapter (guest): Slots g/0/t/0/0 & /1 gültig, kein Regel-Bypass');
    result.slots = slots;

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
      authRoom: result.authRoom,
      slots: result.slots,
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
