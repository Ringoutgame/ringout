// Central local test runner for RingOut.
// Runs every offline suite as a child process, prints one compact line per
// suite, and dumps the full output only for suites that fail. Exit code is 1
// as soon as any suite fails, 0 when all pass.
//
// Deliberately NOT included: tools/rest_verify_v3.js writes to the LIVE
// database and must be run manually with --live. See docs/SYSTEM-ANALYSE.
//
// Usage: node tools/run_all_tests.js
const path = require('path'), { spawnSync } = require('child_process');

// name = display label, file = suite in tools/, expectPassed = erwartete Anzahl
// bestandener Assertions (aus dem letzten "N passed, M failed" der Suite geparst),
// null = Suite hat keinen Assertion-Zaehler (nur Exit-Code zaehlt, z.B. Syntax-Check).
const SUITES = [
  { name: 'Syntax',           file: 'test_syntax.js',         expectPassed: null },
  { name: 'Golden-Physik',    file: 'test_physics_golden.js', expectPassed: 13 },
  { name: 'r3d-Mapping',      file: 'test_r3d_mapping.js',    expectPassed: 48 },
  { name: 'Sanitize',         file: 'test_sanitize.js',       expectPassed: 19 },
  { name: 'Identity',         file: 'test_identity.js',       expectPassed: 45 },
  { name: 'ValidateRoom',     file: 'test_validateroom.js',   expectPassed: 44 },
  { name: 'Lockstep',         file: 'test_lockstep.js',       expectPassed: 24 },
  { name: 'FFA-Kern',         file: 'test_ffa.js',            expectPassed: 18 },
  { name: 'FFA-Online-Prep',  file: 'test_ffa_online.js',     expectPassed: 41 },
  { name: 'FFA-Online-Flow',  file: 'test_ffa_flow.js',       expectPassed: 116 },
  { name: 'FFA-Online-Race',  file: 'test_ffa_race.js',       expectPassed: 115 },
  { name: 'Rules',            file: 'test_rules.js',          expectPassed: 106 },
];

const lastLine = (s) => {
  const lines = String(s).split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '(keine Ausgabe)';
};
// Parst "N passed, M failed" aus der Suite-Ausgabe — alle Suiten enden mit dieser
// Zeile (bzw. lassen expectPassed=null, wenn sie keinen Zaehler ausgeben).
const parsePassed = (s) => {
  const m = String(s).match(/(\d+)\s+passed/);
  return m ? parseInt(m[1], 10) : null;
};

let failed = 0;
const failures = [];
console.log('RingOut Test-Runner — ' + SUITES.length + ' Suiten\n');

for (const s of SUITES) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, s.file)], { encoding: 'utf8' });
  const ms = Date.now() - started;
  const out = (r.stdout || '') + (r.stderr || '');
  const exitOk = r.status === 0;
  const actualPassed = parsePassed(r.stdout);
  // Weniger ODER mehr bestandene Assertions als erwartet gilt als Fehlschlag —
  // eine veraltete/gesunkene Testabdeckung faellt so sofort auf, nicht erst wenn
  // jemand zufaellig die letzte Zeile manuell liest.
  const countOk = s.expectPassed == null || actualPassed === s.expectPassed;
  const ok = exitOk && countOk;
  const tag = ok ? 'OK  ' : 'FAIL';
  let summary;
  if (!exitOk) summary = 'exit ' + r.status;
  else if (!countOk) summary = 'Assertion-Zahl weicht ab: erwartet ' + s.expectPassed + ', erhalten ' + actualPassed;
  else summary = lastLine(r.stdout);
  console.log(
    '[' + tag + '] ' + s.name.padEnd(16) + ' ' + summary.padEnd(40) + ' (' + ms + ' ms)'
  );
  if (!ok) { failed++; failures.push({ name: s.name, out }); }
}

if (failures.length) {
  for (const f of failures) {
    console.log('\n=== Volle Ausgabe: ' + f.name + ' ===');
    console.log(f.out.trimEnd());
  }
}

console.log(
  '\nGesamt: ' + (SUITES.length - failed) + '/' + SUITES.length + ' Suiten bestanden' +
  (failed ? ' — ' + failed + ' fehlgeschlagen' : ' — alles grün')
);
process.exit(failed ? 1 : 0);
