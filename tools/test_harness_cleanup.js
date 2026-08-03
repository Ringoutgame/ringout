// HARNESS-CLEANUP — beweist, dass die Emulator-Suiten auch bei einem
// erzwungenen Testfehler KEINE Reste hinterlassen (Phase IIIB, Punkt 9/10).
//
// Die beiden Emulator-Suiten (tools/test_action_clock.js, tools/test_room_
// lifecycle.js) raeumen in einem finally-Block auf: Admin-Apps schliessen,
// Emulator-Prozessbaum beenden (taskkill /T), Kindprozess-Exit pruefen,
// Temp-Verzeichnis loeschen — und melden jeden Cleanup-Fehler sichtbar.
// Dieser Test erzwingt in einer Kopie der Arbiter-Suite einen Assertion-
// Fehlschlag direkt nach dem Emulator-Start und prueft danach:
//   - Exit-Code != 0 (der Fehler wird NICHT verschluckt)
//   - das Temp-Verzeichnis der Suite existiert nicht mehr
//   - der Emulator-Port ist wieder frei (Prozessbaum wirklich beendet)
//   - es wurden keine Cleanup-Fehler gemeldet
//
// Braucht wie die Suiten JDK 21 + globales firebase-tools und laeuft deshalb
// NICHT im Standard-Runner. Aufruf: node tools/test_harness_cleanup.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');

const REPO = path.dirname(__dirname);
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// Port-Probe: frei = keine Verbindung moeglich.
const portFree = (host, port) => new Promise((resolve) => {
  const sock = net.connect({ host, port });
  const done = (free) => { sock.destroy(); resolve(free); };
  sock.once('connect', () => done(false));
  sock.once('error', () => done(true));
  setTimeout(() => done(true), 3000);
});

(async function main() {
  // Kopie der Arbiter-Suite mit erzwungenem Fehlschlag direkt nach dem Start.
  const src = fs.readFileSync(path.join(REPO, 'tools', 'test_action_clock.js'), 'utf8');
  const anchor = "    // ── 1) clockStart: Ownership, exakter Anker, begrenzter live-Pfad ──";
  if (src.indexOf(anchor) < 0) {
    console.error('FAIL: Anker fuer die Fehlerinjektion nicht gefunden.');
    process.exit(2);
  }
  const injected = src.replace(anchor,
    "    t('ERZWUNGENER TESTFEHLER (Harness-Selbsttest)', false);\n"
    + "    throw new Error('erzwungener Abbruch fuer den Harness-Cleanup-Test');\n"
    + anchor);
  // Eigene Ports, damit ein paralleler Suitenlauf nicht kollidiert.
  const tuned = injected
    .replace("EMU_PORT = 9700, HUB_PORT = 4701, LOG_PORT = 4702", "EMU_PORT = 9760, HUB_PORT = 4761, LOG_PORT = 4762")
    .replace("'ringout-clock-arbiter-' + process.pid", "'ringout-harness-selftest-' + process.pid");
  const tmpSuite = path.join(REPO, 'tools', '.harness_selftest_tmp.js');
  fs.writeFileSync(tmpSuite, tuned);
  let runDirs = [];
  try {
    const r = spawnSync(process.execPath, [tmpSuite], { encoding: 'utf8', timeout: 300000 });
    const out = (r.stdout || '') + (r.stderr || '');
    t('harness: erzwungener Testfehler endet mit Exit != 0', r.status !== 0);
    t('harness: der erzwungene Fehler wird sichtbar gemeldet', /ERZWUNGENER TESTFEHLER/.test(out));
    t('harness: der Abbruchgrund wird berichtet', /erzwungener Abbruch fuer den Harness-Cleanup-Test/.test(out));
    t('harness: keine Cleanup-Fehler gemeldet', !/Cleanup:/.test(out));
    // Temp-Verzeichnisse dieses Selbsttests muessen verschwunden sein.
    runDirs = fs.readdirSync(os.tmpdir()).filter((d) => d.indexOf('ringout-harness-selftest-') === 0);
    t('harness: Temp-Verzeichnis auch bei Testfehler entfernt', runDirs.length === 0);
    t('harness: Emulator-Port wieder frei (Prozessbaum beendet)', await portFree('127.0.0.1', 9760));
  } finally {
    try { fs.unlinkSync(tmpSuite); }
    catch (e) { console.error('Cleanup: temporaere Suite nicht entfernt: ' + (e && e.message)); }
    for (const d of runDirs) {
      try { fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true }); }
      catch (e) { console.error('Cleanup: Restverzeichnis nicht entfernt: ' + (e && e.message)); }
    }
  }
  console.log('\nHarness-Cleanup: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
