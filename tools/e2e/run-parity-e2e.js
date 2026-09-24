// ─────────────────────────────────────────────────────────────────────────────
// RINGOUT ONLINE FEATURE PARITY - E2E-Starter (Fassung 13)
//
//   node tools/e2e/run-parity-e2e.js
//
// Ein Befehl, kein zweites Terminal: Ports pruefen -> eigenes Laufverzeichnis mit
// SHA-256-gepruefter Rules-Kopie -> statischer Server -> RTDB-Emulator (JDK 21) ->
// Chromium -> zwei Negativproben gegen Produktion -> die fuenf Paritaets-Szenarien
// (Collapse, Rescue Wall, Rules, Rueckkehr, Rematch) -> Abbau -> Bericht.
//
// index.html und firebase.rules.json auf der Platte werden NIE veraendert; die
// Produktion ist ueber HTTP UND WebSocket hart blockiert.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const { chromium } = require('@playwright/test');
const H = require('./lib/harness');
const S = require('./parity-scenarios');

(async () => {
  const result = { scenarios: [], errors: [] };
  const state = { transformedHtml: null, prodHits: [], wsProdHits: [], otherBlocked: [], wsOtherBlocked: [], leaveWindows: [] };
  const diag = [], closeErrors = [];
  let staticServer = null, emu = null, browser = null, runDir = null;
  const preexistingLogs = H.preexistingRootLogs();
  if (preexistingLogs.length) H.warn('Vorbestehende Root-Debug-Logs (werden NICHT angefasst): ' + preexistingLogs.join(', '));

  try {
    result.matcherSelfTest = H.selfTestBenignMatcher();
    H.ok('Benign-Matcher-Selbsttest bestanden (' + result.matcherSelfTest.total + ' Faelle)');
    for (const p of [H.EMU_PORT, H.EMU_AUTH_PORT, ...H.EMU_AUX_PORTS]) {
      if (!(await H.portFree(p))) throw new Error('Port ' + p + ' belegt - Abbruch (kein Fremdprozess wird beendet).');
    }
    H.ok('Ports ' + H.EMU_PORT + '/' + H.EMU_AUX_PORTS.join('/') + ' frei');

    runDir = H.createRunDir();
    result.runDir = runDir;
    result.rulesHash = H.prepareTempRules(runDir);
    H.ok('Run-Verzeichnis + Rules-Kopie (exklusiv, SHA-256 ' + result.rulesHash.slice(0, 16) + ')');

    const t = H.transformHtml(fs.readFileSync(H.INDEX_HTML, 'utf8'));
    state.transformedHtml = t.html;
    result.injection = t.report;
    t.report.forEach((line) => H.ok('Injektion - ' + line));

    staticServer = await H.startStaticServer();
    const navUrl = 'http://' + H.EMU_HOST + ':' + staticServer.port + '/index.html?r2d=1';
    H.ok('Statischer Server auf :' + staticServer.port);

    emu = H.startEmulator(runDir);
    await H.waitHttp('http://' + H.EMU_HOST + ':' + H.EMU_PORT + '/.json?ns=' + H.EMU_NS, 60000);
    H.ok('RTDB-Emulator bereit (JDK 21, prozesslokal) auf 127.0.0.1:' + H.EMU_PORT);
    // Ohne Anmeldung legt das Produkt keinen Raum an - also wird auch der
    // Auth-Emulator abgewartet, nicht nur die Datenbank.
    try { await H.waitHttp('http://' + H.EMU_HOST + ':' + H.EMU_AUTH_PORT + '/', 60000); }
    catch (e) { throw new Error('Auth-Emulator nicht erreichbar auf :' + H.EMU_AUTH_PORT
      + ' - Emulatorausgabe: ' + emu.getOutput().slice(-3000)); }
    H.ok('Auth-Emulator bereit auf 127.0.0.1:' + H.EMU_AUTH_PORT);

    browser = await chromium.launch({ args: H.CHROMIUM_E2E_ARGS });
    H.ok('Chromium gestartet');

    const ctx = { browser, navUrl, state, diag, closeErrors };
    result.negativeProbes = await H.runNegativeProbes(ctx);
    H.ok('Negative Proben blockiert - HTTP-Fetch + WebSocket zu Produktion abgefangen');

    // Die Szenarien teilen sich BEWUSST dasselbe Match: der Collapse braucht seine
    // Zeit, und Wand, Rules, Rueckkehr und Rematch gehoeren in dieselbe Partie.
    for (const [name, fn] of [['collapse', S.scenarioCollapse], ['wall', S.scenarioWall],
                              ['rules', S.scenarioRules], ['rejoin', S.scenarioRejoin],
                              ['rematch', S.scenarioRematch]]) {
      H.log("Szenario '" + name + "' ...");
      const before = { http: state.prodHits.length, ws: state.wsProdHits.length };
      const sr = await fn(ctx);
      sr.prodHitsDuringScenario = (state.prodHits.length - before.http) + (state.wsProdHits.length - before.ws);
      if (sr.prodHitsDuringScenario !== 0) throw new Error("Szenario '" + name + "': " + sr.prodHitsDuringScenario + ' Produktionskontakt(e).');
      result.scenarios.push(sr);
      H.ok("Szenario '" + name + "' bestanden (" + sr.pruefungen.length + ' Pruefungen)');
    }

    if (state.prodHits.length) throw new Error('Produktionskontakte (HTTP): ' + JSON.stringify(state.prodHits));
    if (state.wsProdHits.length) throw new Error('Produktionskontakte (WebSocket): ' + JSON.stringify(state.wsProdHits));
    const rest = diag.filter((d) => !H.isBenignDiag(d, state));
    const vorzustand = rest.filter((d) => H.isVorzustandDiag(d));
    const badDiag = rest.filter((d) => !H.isVorzustandDiag(d));
    result.benignDiagCount = diag.length - rest.length;
    result.vorzustandDiag = { anzahl: vorzustand.length, beispiel: vorzustand.length ? vorzustand[0].text.slice(0, 200) : null };
    if (vorzustand.length) H.warn('Vorzustand (2D-Pfad, ausgewiesen, nicht verschwiegen): ' + vorzustand.length + ' x Renderfehler in drawBall');
    if (badDiag.length) throw new Error('Unerwartete Diagnosen:\n' + JSON.stringify(badDiag, null, 2));
    result.passed = result.scenarios.every((s) => s.passed);
  } catch (e) {
    result.passed = false;
    result.errors.push(String((e && e.stack) || e));
    console.error('\n[e2e][FEHLER]', (e && e.message) || e);
  } finally {
    const clean = await H.cleanup({ browser, staticServer, emu, runDir, closeErrors, preexistingLogs });
    result.cleanup = clean;
    result.diagnostics = diag;
    result.prodHits = state.prodHits;
    result.wsProdHits = state.wsProdHits;
    console.log('\n════════ E2E-PARITAETS-BERICHT (JSON) ════════');
    console.log(JSON.stringify(result, null, 1));
    const zahl = result.scenarios.reduce((n, s) => n + (s.pruefungen ? s.pruefungen.length : 0), 0);
    console.log('\n' + (result.passed ? 'PARITAET BESTANDEN' : 'PARITAET FEHLGESCHLAGEN')
      + ' - ' + result.scenarios.length + ' Szenarien, ' + zahl + ' Pruefungen');
    process.exit(result.passed ? 0 : 1);
  }
})();
