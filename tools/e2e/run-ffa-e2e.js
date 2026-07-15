// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Online-FFA E2E launcher (single self-contained entry)
//
//   node tools/e2e/run-ffa-e2e.js   (or: npm run test:e2e:ffa)
//
// One command does everything and needs no second terminal: verify ports free →
// unique per-run temp dir (link-checked) → SHA-256 exclusive rules copy → local
// static server → JDK-21 RTDB emulator → launch Chromium → two negative
// production-block probes (HTTP + WebSocket) → run all Online-FFA scenarios (5
// clients, 3 turns incl. non-zero-move + simultaneous commit, leave/sentinel,
// session-staleness smoke) → tear down browser/server/emulator/ports/temp files →
// print a report → exit non-zero on any failure.
//
// index.html and firebase.rules.json on disk are never modified. Production
// Firebase is hard-blocked per context over BOTH HTTP and WebSocket transport.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const { chromium } = require('@playwright/test');
const H = require('./lib/harness');
const { scenarioMatch, scenarioLeave, scenarioStaleness, scenarioPublicLobby, PRODUCT_SPEC_COLORS } = require('./ffa-scenarios');

(async () => {
  const result = { scenarios: [], errors: [] };
  const state = {
    transformedHtml: null,
    prodHits: [], wsProdHits: [], otherBlocked: [], wsOtherBlocked: [], leaveWindows: [],
  };
  const diag = [];
  const closeErrors = [];
  let staticServer = null, emu = null, browser = null, runDir = null;
  const preexistingLogs = H.preexistingRootLogs();
  if (preexistingLogs.length) H.warn('Vorbestehende Root-Debug-Logs (werden NICHT angefasst): ' + preexistingLogs.join(', '));

  try {
    // Deterministic matcher self-test (no emulator needed): the benign
    // permission_denied allowlist must accept only the exact root-room delete and
    // reject every illegal code / sub-path / wrong op / out-of-window case.
    result.matcherSelfTest = H.selfTestBenignMatcher();
    H.ok(`Benign-Matcher-Selbsttest bestanden (${result.matcherSelfTest.total} Fälle)`);

    // Preconditions: our ports must be free (no foreign process is ever killed).
    for (const p of [H.EMU_PORT, ...H.EMU_AUX_PORTS]) {
      if (!(await H.portFree(p))) throw new Error(`Port ${p} belegt — Abbruch (kein Fremdprozess wird beendet).`);
    }
    H.ok(`Ports ${H.EMU_PORT}/${H.EMU_AUX_PORTS.join('/')} frei`);

    // Unique, link-checked run dir + SHA-256-verified exclusive rules copy.
    runDir = H.createRunDir();
    result.runDir = runDir;
    result.rulesHash = H.prepareTempRules(runDir);
    H.ok(`Run-Verzeichnis + Rules-Kopie (exklusiv, SHA-256 ${result.rulesHash.slice(0, 16)}…)`);

    // In-memory, structural, count-checked transform. Disk untouched.
    const t = H.transformHtml(fs.readFileSync(H.INDEX_HTML, 'utf8'));
    state.transformedHtml = t.html;
    result.injection = t.report;
    t.report.forEach((line) => H.ok('Injektion — ' + line));

    // Static server + emulator (JDK 21, process-local, cwd = run dir, no shell).
    staticServer = await H.startStaticServer();
    const navUrl = `http://${H.EMU_HOST}:${staticServer.port}/index.html?r2d=1`;
    H.ok(`Statischer Server auf :${staticServer.port}`);

    emu = H.startEmulator(runDir);
    await H.waitHttp(`http://${H.EMU_HOST}:${H.EMU_PORT}/.json?ns=${H.EMU_NS}`, 60000);
    H.ok('RTDB-Emulator bereit (JDK 21, prozesslokal) auf 127.0.0.1:9000');

    browser = await chromium.launch({ args: H.CHROMIUM_E2E_ARGS });
    H.ok('Chromium gestartet (Loopback-Flags nur test-browserseitig)');

    const ctx = { browser, navUrl, state, diag, closeErrors };

    // Two negative probes MUST be blocked by our own protection (no real connect).
    result.negativeProbes = await H.runNegativeProbes(ctx);
    H.ok('Negative Proben blockiert — HTTP-Fetch + WebSocket zu Produktion abgefangen');

    // Run scenarios in sequence; each isolates its own contexts and cleans up.
    for (const [name, fn] of [['match', scenarioMatch], ['leave', scenarioLeave], ['staleness', scenarioStaleness], ['public-lobby', scenarioPublicLobby]]) {
      H.log(`Szenario '${name}' …`);
      const before = { http: state.prodHits.length, ws: state.wsProdHits.length };
      const sr = await fn(ctx);
      sr.prodHitsDuringScenario = (state.prodHits.length - before.http) + (state.wsProdHits.length - before.ws);
      if (sr.prodHitsDuringScenario !== 0) throw new Error(`Szenario '${name}': ${sr.prodHitsDuringScenario} Produktionskontakt(e).`);
      result.scenarios.push(sr);
      H.ok(`Szenario '${name}' bestanden`);
    }

    // No production Firebase contact anywhere in the run (HTTP or WebSocket).
    if (state.prodHits.length) throw new Error('Produktionskontakte (HTTP): ' + JSON.stringify(state.prodHits));
    if (state.wsProdHits.length) throw new Error('Produktionskontakte (WebSocket): ' + JSON.stringify(state.wsProdHits));
    // Only tightly-scoped known-benign diagnostics are tolerated.
    const badDiag = diag.filter((d) => !H.isBenignDiag(d, state));
    result.benignDiagCount = diag.length - badDiag.length;
    if (badDiag.length) throw new Error('Unerwartete Diagnosen:\n' + JSON.stringify(badDiag, null, 2));

    result.passed = result.scenarios.every((s) => s.passed);
    result.colorNote = `Sitzfarben werden nur auf konsistente, 5-fach-eindeutige Zuordnung über alle Clients geprüft. Produktspezifikation wäre ${PRODUCT_SPEC_COLORS.join('/')}; der Produktionscode (PCOLS) weicht davon ab — separates Produkt/UI-Thema, hier NICHT als Sollzustand festgeschrieben.`;
  } catch (e) {
    result.passed = false;
    result.errors.push(String(e && e.stack || e));
    console.error('\n[e2e][FEHLER]', e && e.message || e);
  } finally {
    const clean = await H.cleanup({ browser, staticServer, emu, runDir, closeErrors, preexistingLogs });
    result.cleanup = clean;
    result.diagnostics = diag;
    result.prodHits = state.prodHits;
    result.wsProdHits = state.wsProdHits;
    result.otherBlocked = state.otherBlocked;
    result.wsOtherBlocked = state.wsOtherBlocked;
    result.preexistingRootLogs = preexistingLogs;

    console.log('\n════════════════ E2E-FFA-BERICHT (JSON) ════════════════');
    console.log(JSON.stringify({
      passed: result.passed,
      rulesHash: result.rulesHash,
      injection: result.injection,
      matcherSelfTest: result.matcherSelfTest,
      negativeProbes: result.negativeProbes,
      colorNote: result.colorNote,
      scenarios: result.scenarios,
      prodHits: result.prodHits,
      wsProdHits: result.wsProdHits,
      otherBlocked: result.otherBlocked,
      wsOtherBlocked: result.wsOtherBlocked,
      benignDiagCount: result.benignDiagCount,
      diagnostics: result.diagnostics,
      preexistingRootLogs: result.preexistingRootLogs,
      cleanup: result.cleanup,
      errors: result.errors,
    }, null, 2));
    console.log('═════════════════════════════════════════════════════════');
    process.exit(result.passed && result.cleanup.cleanupOk ? 0 : 1);
  }
})();
