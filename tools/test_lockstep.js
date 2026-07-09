// M1-T1 integration verification (no installs, pure Node):
// A) Full wire round-trip: sender-side sanitize -> JSON (Firebase) -> receiver-side
//    sanitize must be bit-identical on both lockstep ends, incl. malicious payloads.
// B) Physics impact: the REAL simExchange from index.html proves a sanitized
//    injected move behaves exactly like a legal max-power shot, while the
//    unsanitized value would ring out the target within one step.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(1); }
  return m[0];
};
const sanitizeSrc = grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove');
const simSrc      = grab(/function simExchange\(pA,pB,aA,aB\)\{[\s\S]*?\n\}/, 'simExchange');
const constSrc    = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');

// Rebuild the exact runtime environment the functions expect.
const env = `
  const LOGICAL=1000, cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
  ${constSrc}
  function curFR(){return FRICTION;} function curFE(){return FEND;} function curST(){return STOPV;}
  function maxPull(){return R0*MAXPULL_FRAC;}
  let balls=[{alive:true,owner:0},{alive:true,owner:1}];
  ${sanitizeSrc}
  ${simSrc}
  return {sanitizeMove, simExchange, maxPull, LAUNCH};
`;
const G = new Function(env)();
const MP = G.maxPull();

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// ── A) Wire round-trip: both lockstep ends see identical values ──
// Sender path: commit() sanitizes, then onlineSendCommit() JSON-serializes to Firebase.
// Receiver path: onlineTurnValue() sanitizes what arrives.
const wire = (m) => JSON.parse(JSON.stringify({ idx: m.idx, dx: m.dx, dy: m.dy, sp: m.sp }));
const payloads = [
  { name: 'legal drag',        idx: 1, dx: 120.5, dy: -90.25, sp: 0.33 },
  { name: 'velocity inject',   idx: 1, dx: 99999, dy: 0,      sp: 0 },
  { name: 'diagonal inject',   idx: 1, dx: 3000,  dy: -4000,  sp: 0 },
  { name: 'spin inject',       idx: 1, dx: 50,    dy: 50,     sp: 500 },
  { name: 'string attack',     idx: 1, dx: '1e9', dy: 'abc',  sp: '9' },
  { name: 'null fields',       idx: null, dx: null, dy: null, sp: null },
  { name: 'boundary exact MP', idx: 1, dx: MP,    dy: 0,      sp: 1 },
];
for (const p of payloads) {
  const sent = G.sanitizeMove(1, p.idx, p.dx, p.dy, p.sp);   // sender end (commit)
  const rcvd = wire(sent);                                    // Firebase JSON hop
  const applied = G.sanitizeMove(1, rcvd.idx, rcvd.dx, rcvd.dy, rcvd.sp); // receiver end
  t(`round-trip identical [${p.name}]`,
    sent.idx === applied.idx && sent.dx === applied.dx &&
    sent.dy === applied.dy && sent.sp === applied.sp);
  t(`magnitude bounded [${p.name}]`, Math.hypot(applied.dx, applied.dy) <= MP * (1 + 1e-9));
  t(`spin bounded [${p.name}]`, applied.sp >= -1 && applied.sp <= 1);
}

// ── B) Physics impact via the REAL simExchange ──
// Setup mirrors placeBalls() single format: P0 bottom (500,776.45), P1 top (500,223.55).
const P0 = { x: 500, y: 500 + 485 * 0.57 }, P1 = { x: 500, y: 500 - 485 * 0.57 };
const stay = { dx: 0, dy: 0 };

// B1: sanitized injected move === legal max-power shot (identical outcome, step for step)
const legalMax = { dx: 0, dy: MP };                                  // straight down, full power
const injected = G.sanitizeMove(1, 1, 0, 99999, 0);                  // cheater tries dy=99999
const rLegal = G.simExchange(P0, P1, stay, { dx: legalMax.dx, dy: legalMax.dy });
const rInj   = G.simExchange(P0, P1, stay, { dx: injected.dx, dy: injected.dy });
t('sanitized inject == legal max shot (same end positions)',
  rLegal.B.x === rInj.B.x && rLegal.B.y === rInj.B.y &&
  rLegal.A.x === rInj.A.x && rLegal.A.y === rInj.A.y &&
  rLegal.outA === rInj.outA && rLegal.outB === rInj.outB);

// B2: WITHOUT sanitize, the injected value is physics-breaking (target out almost instantly)
const rRaw = G.simExchange(P0, P1, stay, { dx: 0, dy: 99999 });
t('unsanitized inject would break physics (shooter flies out immediately)',
  rRaw.outB === true || rRaw.outA === true);
// velocity check: 99999*LAUNCH = ~3400 px/step vs clamped ~6.6 px/step
t('raw velocity absurd vs clamped sane', 99999 * G.LAUNCH > 3000 && MP * G.LAUNCH < 10);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
