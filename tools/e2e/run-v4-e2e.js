// ─────────────────────────────────────────────────────────────────────────────
// RingOut — v4-E2E-Launcher (RTDB + Auth + Functions Emulator, echter Browser)
//
//   node tools/e2e/run-v4-e2e.js            alle Szenarien
//   node tools/e2e/run-v4-e2e.js --fast     ohne die beiden Zwei-Zyklen-Laeufe
//   node tools/e2e/run-v4-e2e.js --only=S1,S2
//
// Diese Suite ist das unabhaengige Orakel der v4-Integration (s. v4-scenarios.js).
// Sie startet alle drei Emulatoren, serviert index.html unveraendert von Platte
// (nur in-memory transformiert), meldet den Browser anonym am Auth-Emulator an
// und prueft danach ausschliesslich den echten Datenbestand.
//
// Exit-Codes: 0 = alle Szenarien gruen · 1 = Assertions rot · 2 = Infrastruktur
// (Emulator/Browser/Transform) nicht startbar. Ein roter Lauf mit Exit 1 ist vor
// der Client-Migration der ERWARTETE Zustand und wird als solcher ausgewiesen.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const H = require('./lib/harness');
const V = require('./lib/harness-v4');
const S = require('./v4-scenarios');

const ARGV = process.argv.slice(2);
const FAST = ARGV.includes('--fast');
const ONLY = (ARGV.find((a) => a.startsWith('--only=')) || '').replace('--only=', '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Reihenfolge ist bewusst: die billigen Struktur-Szenarien zuerst, die beiden
// zeitverbrauchenden Zyklen-Laeufe zuletzt — ein Strukturfehler faellt so nach
// Sekunden auf und nicht erst nach Minuten.
const SUITE = [
  { id: 'S1',  name: 'Lifecycle: erstellen/aktivieren/beitreten/starten', fn: S.scenarioLifecycle,          slow: false },
  { id: 'S2',  name: 'live/slots als einziger Zugpfad + live/clock',      fn: S.scenarioSlotsAndClock,      slow: false },
  { id: 'S7',  name: 'Late Join und Reconnect',                           fn: S.scenarioLateJoinReconnect,  slow: false },
  { id: 'S9',  name: 'Formate: FFA 3, FFA 5, 2v2',                        fn: S.scenarioFormats,            slow: false },
  { id: 'S10', name: 'Disconnect waehrend Aim -> genau ein No-Shot',      fn: S.scenarioDisconnectNoShot,   slow: false },
  { id: 'S11', name: 'Keine v3-Uhrreste im v4-Pfad',                      fn: S.scenarioNoLegacyClock,      slow: false },
  { id: 'S12', name: 'Live-Umbenennung erhaelt uid/id/tab',               fn: S.scenarioRename,             slow: false },
  { id: 'S4',  name: 'Zwei exakte 30-s-Zyklen + Collapse 2 terminal',     fn: S.scenarioTwoCycles,          slow: true  },
  { id: 'S8',  name: 'Rematch setzt stage=0 / remainingMs=30000',         fn: S.scenarioRematch,            slow: true  },
];

(async function main() {
  const started = Date.now();
  H.log('RingOut v4-E2E — echte Emulatoren (RTDB + Auth + Functions), echter Browser');

  // ── 0) Vorbedingungen ──────────────────────────────────────────────────────
  if (!fs.existsSync(path.join(H.REPO_ROOT, 'functions', 'node_modules'))) {
    H.warn('functions/node_modules fehlt — der Functions-Emulator kann die Wrapper nicht laden.');
    process.exit(2);
  }
  if (!H.resolveFirebaseEntry()) {
    H.warn('firebase-tools nicht gefunden (npm i -g firebase-tools).');
    process.exit(2);
  }
  for (const p of V.ALL_PORTS) {
    if (!(await H.portFree(p))) { H.warn('Port belegt: ' + p + ' — Abbruch (kein fremder Prozess wird angefasst).'); process.exit(2); }
  }

  const runDir = H.createRunDir();
  const rulesHash = H.prepareTempRules(runDir);
  H.log('Run-Verzeichnis: ' + runDir);
  H.log('Rules-Kopie SHA-256: ' + rulesHash);

  // ── 1) HTML-Transform (nur im Speicher) ────────────────────────────────────
  let transformed;
  try {
    transformed = V.transformHtmlV4(fs.readFileSync(H.INDEX_HTML, 'utf8'));
  } catch (e) {
    H.warn('HTML-Transform fehlgeschlagen: ' + e.message);
    process.exit(2);
  }
  for (const line of transformed.report) H.log('  transform · ' + line);
  const v4Wired = transformed.present.functionsImport && transformed.present.functionsConnect;
  if (!v4Wired) {
    H.warn('Der ausgelieferte Client bindet KEINE v4-Callables ein (kein firebase-functions-Import).');
    H.warn('Das ist der erwartete Zustand VOR der Client-Migration — die Szenarien laufen trotzdem und dokumentieren den roten Ausgangszustand.');
  }

  // ── 2) Emulatoren + statischer Server + Browser ────────────────────────────
  let emu = null, staticServer = null, browser = null;
  const closeErrors = [];
  const preexistingLogs = H.preexistingRootLogs();
  const diag = [];
  // Dieselbe state-Form wie im v3-Launcher: armContext liefert das Dokument aus
  // transformedHtml aus und protokolliert jeden Block in die vier Trefferlisten.
  const state = {
    transformedHtml: transformed.html,
    leaveWindows: [], prodHits: [], otherBlocked: [], wsProdHits: [], wsOtherBlocked: [],
  };
  const rooms = [];
  let exitCode = 0;

  try {
    emu = V.startEmulatorV4(runDir);
    H.log('Emulator startet (database, auth, functions) …');
    const ready = await V.waitReadyV4(emu, 180000);
    if (!ready.ok) {
      H.warn('Emulator nicht bereit: ' + ready.why);
      H.warn(emu.getOutput().split('\n').slice(-25).join('\n'));
      exitCode = 2;
      return;
    }
    H.ok('Emulatoren bereit — Rules geladen, alle ' + V.CALLABLES.length + ' Callables erreichbar und auth-pflichtig.');

    staticServer = await H.startStaticServer();
    // ?r2d=1 erzwingt den 2D-Renderer: der 3D-Pfad wuerde three.js/HDRI/GLB
    // nachladen und den Lauf ohne jeden Erkenntnisgewinn verlangsamen. Das
    // Dokument selbst liefert armContext aus state.transformedHtml aus —
    // index.html auf Platte bleibt unveraendert.
    const navUrl = `http://${H.EMU_HOST}:${staticServer.port}/index.html?r2d=1`;
    H.log('Statischer Server auf :' + staticServer.port);

    browser = await chromium.launch({ args: H.CHROMIUM_E2E_ARGS });
    const env = { browser, navUrl, state, diag, rooms };

    // Beweis, dass der Produktions-Block wirklich scharf ist, BEVOR ein Szenario
    // laeuft: zwei absichtliche Zugriffe auf Produktions-Firebase (HTTP + WS)
    // muessen abgefangen werden.
    await H.runNegativeProbes({ browser, navUrl, state, diag });
    H.ok('Negative Proben blockiert — HTTP-Fetch und WebSocket zu Produktion abgefangen.');

    // ── 3) Szenarien ─────────────────────────────────────────────────────────
    const results = [];
    for (const sc of SUITE) {
      if (ONLY.length && !ONLY.includes(sc.id)) continue;
      if (FAST && sc.slow) { H.log('[skip] ' + sc.id + ' ' + sc.name + ' (--fast)'); continue; }
      H.log('');
      H.log('── ' + sc.id + ' · ' + sc.name + ' ' + '─'.repeat(Math.max(0, 50 - sc.name.length)));
      const t0 = Date.now();
      let t;
      try {
        t = await sc.fn(env);
      } catch (e) {
        t = { rows: [{ name: sc.id + ': Szenario ist abgestuerzt', ok: false, detail: String(e && e.stack || e) }],
              passed: () => 0, failed: () => 1 };
      }
      for (const r of t.rows) {
        if (r.ok) H.ok('  ' + r.name);
        else H.warn('  ' + r.name + (r.detail ? '  [' + r.detail + ']' : ''));
      }
      results.push({ id: sc.id, name: sc.name, passed: t.passed(), failed: t.failed(), ms: Date.now() - t0 });
    }

    // ── 4) Bilanz ────────────────────────────────────────────────────────────
    H.log('');
    H.log('══ Bilanz ══');
    let pass = 0, fail = 0;
    for (const r of results) {
      pass += r.passed; fail += r.failed;
      H.log(`  ${(r.failed ? 'ROT ' : 'GRUEN')}  ${r.id.padEnd(4)} ${r.name.padEnd(52)} ${r.passed} passed, ${r.failed} failed  (${(r.ms / 1000).toFixed(1)} s)`);
    }
    H.log('');
    H.log(`v4-E2E: ${pass} passed, ${fail} failed — ${results.filter((r) => !r.failed).length}/${results.length} Szenarien gruen`);

    // Diagnosen: im v4-Lauf gilt KEINE Sentinel-Ausnahme mehr (die Maschinerie
    // ist entfernt). Es bleibt die eine bekannte Chromium-Inspector-Meldung.
    const badDiag = diag.filter((d) => !H.isBenignDiag(d, state));
    if (badDiag.length) {
      H.warn('Nicht klassifizierte Browser-Diagnosen: ' + badDiag.length);
      for (const d of badDiag.slice(0, 25)) H.warn('  [' + d.ctx + '/' + d.kind + '] ' + d.text.slice(0, 300));
      fail += badDiag.length;
    }

    if (fail) {
      exitCode = 1;
      if (!v4Wired) {
        H.log('');
        H.warn('ROTER AUSGANGSZUSTAND (erwartet): der ausgelieferte Client spricht noch nicht v4.');
        H.warn('Diese Suite ist als Orakel fuer die Migration geschrieben — sie wird erst nach Etappe C2 gruen.');
      }
    }
  } catch (e) {
    H.warn('Lauf abgebrochen: ' + (e && e.stack || e));
    exitCode = exitCode || 2;
  } finally {
    await H.cleanup({ browser, staticServer, emu, runDir, closeErrors, preexistingLogs });
    H.log('Laufzeit: ' + ((Date.now() - started) / 1000).toFixed(1) + ' s');
  }
  process.exit(exitCode);
})();
