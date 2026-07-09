// Central local test runner for RingOut.
// Runs every offline suite as a child process, prints one compact line per
// suite, and dumps the full output only for suites that fail. Exit code is 1
// as soon as any suite fails, 0 when all pass.
//
// Deliberately NOT included: tools/rest_verify_v2.js writes to the LIVE
// database and must be run manually with --live. See docs/SYSTEM-ANALYSE.
//
// Usage: node tools/run_all_tests.js
const path = require('path'), { spawnSync } = require('child_process');

// name = display label, file = suite in tools/, expect = expected summary hint.
const SUITES = [
  { name: 'Syntax',           file: 'test_syntax.js',         expect: 'SYNTAX OK' },
  { name: 'Golden-Physik',    file: 'test_physics_golden.js', expect: '13/13' },
  { name: 'r3d-Mapping',      file: 'test_r3d_mapping.js',    expect: '48/48' },
  { name: 'Sanitize',         file: 'test_sanitize.js',       expect: '19/19' },
  { name: 'ValidateRoom',     file: 'test_validateroom.js',   expect: '40/40' },
  { name: 'Lockstep',         file: 'test_lockstep.js',       expect: '24/24' },
  { name: 'FFA-Kern',         file: 'test_ffa.js',            expect: '18/18' },
  { name: 'FFA-Online-Prep',  file: 'test_ffa_online.js',     expect: '40/40' },
  { name: 'FFA-Online-Flow',  file: 'test_ffa_flow.js',       expect: '46/46' },
  { name: 'Rules',            file: 'test_rules.js',          expect: '59/59' },
];

const lastLine = (s) => {
  const lines = String(s).split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '(keine Ausgabe)';
};

let failed = 0;
const failures = [];
console.log('RingOut Test-Runner — ' + SUITES.length + ' Suiten\n');

for (const s of SUITES) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, s.file)], { encoding: 'utf8' });
  const ms = Date.now() - started;
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  const tag = ok ? 'OK  ' : 'FAIL';
  const summary = ok ? lastLine(r.stdout) : ('exit ' + r.status);
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
