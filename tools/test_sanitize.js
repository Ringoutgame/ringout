// M1-T1 verification: tests the REAL sanitizeMove extracted from index.html.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const fnMatch = html.match(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/);
if (!fnMatch) { console.error('FAIL: sanitizeMove not found in index.html'); process.exit(1); }

// Stub the two globals the function reads: maxPull() and balls.
const LOGICAL = 1000, R0 = LOGICAL * 0.485, MAXPULL_FRAC = 0.40;
const MP = R0 * MAXPULL_FRAC; // = 194
const ctxSrc = `
  const maxPull = () => ${MP};
  let balls = [];
  ${fnMatch[0]}
  return { sanitizeMove, setBalls: b => { balls = b; } };
`;
const { sanitizeMove, setBalls } = new Function(ctxSrc)();

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// Standard 1v1 ball set: idx0 owner0 alive, idx1 owner1 alive.
setBalls([{ alive: true, owner: 0 }, { alive: true, owner: 1 }]);

// 1. Legal move is a no-op (honest play unaffected)
{
  const m = sanitizeMove(1, 1, 100, -50, 0.5);
  t('legal move untouched', m.idx === 1 && m.dx === 100 && m.dy === -50 && m.sp === 0.5);
}
// 2. Oversized magnitude clamped to MP, direction preserved
{
  const m = sanitizeMove(1, 1, 99999, 0, 0);
  t('magnitude clamped', Math.abs(Math.hypot(m.dx, m.dy) - MP) < 1e-6);
  t('direction preserved', m.dx > 0 && m.dy === 0);
}
{
  const m = sanitizeMove(1, 1, 3000, -4000, 0);
  const len = Math.hypot(m.dx, m.dy);
  t('diagonal clamped to MP', Math.abs(len - MP) < 1e-6);
  t('diagonal direction preserved', Math.abs(m.dx / m.dy - 3000 / -4000) < 1e-12);
}
// 3. EXACT idempotence (the lockstep-critical property):
//    sender sanitizes once and transmits; receiver sanitizes again — must be bit-identical.
{
  const cases = [[99999, 12345], [3000, -4000], [194.0000001, 0], [MP, MP], [-1e308, 1e308], [100, 50]];
  let ok = true;
  for (const [dx, dy] of cases) {
    const a = sanitizeMove(1, 1, dx, dy, 0.7);
    const b = sanitizeMove(1, a.idx, a.dx, a.dy, a.sp);
    if (a.dx !== b.dx || a.dy !== b.dy || a.sp !== b.sp || a.idx !== b.idx) { ok = false; console.error('  not idempotent for', dx, dy, '->', a.dx - b.dx, a.dy - b.dy); }
  }
  t('exact idempotence (===) across cases', ok);
}
// 4. Non-finite inputs -> 0
{
  const m1 = sanitizeMove(1, 1, NaN, Infinity, NaN);
  t('NaN/Infinity -> 0', m1.dx === 0 && m1.dy === 0 && m1.sp === 0);
  const m2 = sanitizeMove(1, 1, '500', {}, undefined); // strings/objects are NOT coerced
  t('string/object -> 0', m2.dx === 0 && m2.dy === 0 && m2.sp === 0);
}
// 5. Spin clamp
{
  t('sp clamped high', sanitizeMove(1, 1, 0, 0, 50).sp === 1);
  t('sp clamped low', sanitizeMove(1, 1, 0, 0, -50).sp === -1);
  t('sp legal untouched', sanitizeMove(1, 1, 0, 0, -0.3).sp === -0.3);
}
// 6. idx validation and fallback
{
  t('wrong owner -> fallback', sanitizeMove(1, 0, 0, 0, 0).idx === 1);         // idx0 belongs to owner 0
  t('out of range -> fallback', sanitizeMove(1, 99, 0, 0, 0).idx === 1);
  t('negative -> fallback', sanitizeMove(1, -1, 0, 0, 0).idx === 1);
  t('null -> fallback', sanitizeMove(1, null, 0, 0, 0).idx === 1);
  t('float -> fallback', sanitizeMove(1, 1.5, 0, 0, 0).idx === 1);
  setBalls([{ alive: true, owner: 0 }, { alive: false, owner: 1 }]);
  t('dead ball -> fallback -1 (none alive)', sanitizeMove(1, 1, 0, 0, 0).idx === -1);
  // 2v2: fallback picks FIRST alive ball of owner (matches old onlineTurnValue behavior)
  setBalls([{ alive: true, owner: 0 }, { alive: true, owner: 0 }, { alive: false, owner: 1 }, { alive: true, owner: 1 }]);
  t('2v2 fallback = first alive of owner', sanitizeMove(1, 2, 0, 0, 0).idx === 3);
  t('2v2 valid second ball accepted', sanitizeMove(0, 1, 0, 0, 0).idx === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
