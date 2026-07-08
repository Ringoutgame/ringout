// Golden physics tests (M4-T1) — safety net before any index.html surgery.
//
// Extracts the REAL simulation code from index.html (stepSim, simExchange,
// simSnap + the physics constants), runs fixed deterministic scenarios and
// compares every float BIT-EXACTLY against tools/golden_physics.json.
// Any unintended change to physics/simulation behavior fails this suite.
//
//   node tools/test_physics_golden.js            -> compare against goldens
//   node tools/test_physics_golden.js --update   -> (re)generate goldens (deliberate physics changes only!)
//   node tools/test_physics_golden.js --selftest -> prove sensitivity: perturbed FRICTION must FAIL
//
// No side effects on the game: index.html is only read.

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const GOLDEN_PATH = path.join(__dirname, 'golden_physics.json');

function grab(re, name) {
  const m = HTML.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
}
// top-level functions in index.html close with "}" at column 0
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const simExchangeSrc = grab(/function simExchange\(pA,pB,aA,aB\)\{[\s\S]*?\n\}/, 'simExchange');
const simSnapSrc = grab(/function simSnap\(a,horizon\)\{[\s\S]*?\n\}/, 'simSnap');
const constSrc1 = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const constSrc2 = grab(/const SPIN_K=[^\n]*/, 'spin constants');

// Rebuild the exact runtime environment; all side-effect surfaces are inert stubs.
function buildEnv(frictionOverride) {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${constSrc1}
    ${constSrc2}
    ${frictionOverride ? 'const __FR=' + frictionOverride + ';' : ''}
    function curFR(){return ${frictionOverride ? '__FR' : 'FRICTION'};}
    function curFE(){return ${frictionOverride ? '__FR' : 'FEND'};}
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', outBall=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='';
    let online=false, myPlayer=0, mode='bot', fmt='single';
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},charge:{start(){},stop(){},update(){}}};
    function spawn(){} function popBall(){} function winnerRGB(){return '';}
    let r3dActive=false; function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;}
    function updateHud(){} function setPhaseText(){} function onlineArmTurn(){} function openCover(){}
    ${stepSimSrc}
    ${simExchangeSrc}
    ${simSnapSrc}
    return {
      MP: maxPull(), BR, R0,
      set(state){ balls=state.balls; phase='sim'; outBall=-1; fmt=state.fmt||'single'; R=state.R!=null?state.R:R0; },
      get(){ return { phase, outBall, balls: balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,alive:b.alive,owner:b.owner,spin:b.spin||0})) }; },
      stepSim: ()=>stepSim(),
      simExchange: (pA,pB,aA,aB)=>simExchange(pA,pB,aA,aB),
      simSnap: (a,h)=>{ simSnap(a,h); return a; }
    };
  `;
  return new Function(env)();
}

const ball = (x, y, o, vx = 0, vy = 0, spin = 0) => ({ x, y, vx, vy, sx: x, sy: y, owner: o, alive: true, spin });

// Runs the REAL game-loop physics until the sim settles (phase leaves 'sim')
// and captures a mid-trajectory checkpoint so silent drift cannot hide.
function runStepSim(G, state, checkpointFrame = 30, maxFrames = 3000) {
  G.set(state);
  let frames = 0, checkpoint = null;
  while (frames < maxFrames) {
    G.stepSim(); frames++;
    if (frames === checkpointFrame) checkpoint = G.get();
    const p = G.get().phase;
    if (p !== 'sim') break;
  }
  return { frames, checkpoint, final: G.get() };
}

function buildCases(G) {
  const MP = G.MP, R0 = G.R0, BR = G.BR;
  const L = 0.034; // LAUNCH (velocity = pull * LAUNCH), mirrors applyLaunch()
  const cases = {};

  // ── stepSim (der ECHTE Spiel-Loop inkl. Ring-Out-/Decisive-Logik) ──
  cases.S1_headon_max_vs_static = runStepSim(G, { balls: [
    ball(500, 776.45, 0, 0, -MP * L), ball(500, 223.55, 1) ] });
  cases.S2_both_max_headon = runStepSim(G, { balls: [
    ball(500, 776.45, 0, 0, -MP * L), ball(500, 223.55, 1, 0, MP * L) ] });
  cases.S3_spin_curve = runStepSim(G, { balls: [
    ball(500, 776.45, 0, 0, -MP * L, 0.8), ball(200, 223.55, 1) ] });
  cases.S4_gentle_nudge_slow_regime = runStepSim(G, { balls: [
    ball(500, 776.45, 0, 0, -12 * L), ball(500, 223.55, 1) ] });
  cases.S5_boundary_graze = runStepSim(G, { balls: [
    ball(500, 500 - (R0 - BR * 1.5), 1, 0, -30 * L), ball(500, 776.45, 0) ] });
  cases.S6_double_pileup = runStepSim(G, { fmt: 'double', balls: [
    ball(354.5, 766.75, 0, 40 * L, -MP * L), ball(645.5, 766.75, 0),
    ball(354.5, 233.25, 1), ball(645.5, 233.25, 1) ] });
  cases.S7_double_out_same_substep = runStepSim(G, { fmt: 'double', balls: [
    ball(430, 300, 1, -60 * L, -MP * L), ball(570, 300, 1, 60 * L, -MP * L),
    ball(354.5, 766.75, 0), ball(645.5, 766.75, 0) ] });
  cases.S8_shrunken_arena = runStepSim(G, { R: R0 * 0.85, balls: [
    ball(500, 735, 0, 0, -MP * L * 0.8), ball(500, 265, 1) ] });

  // ── simExchange (Hard-Bot 1v1 Vorausberechnung) ──
  cases.E1_exchange_headon = G.simExchange(
    { x: 500, y: 776.45 }, { x: 500, y: 223.55 }, { dx: 0, dy: -MP }, { dx: 0, dy: MP });
  cases.E2_exchange_glancing = G.simExchange(
    { x: 450, y: 776.45 }, { x: 500, y: 223.55 }, { dx: 30, dy: -MP * 0.9 }, { dx: -20, dy: MP * 0.6 });
  cases.E3_exchange_stay_near_edge = G.simExchange(
    { x: 500, y: 776.45 }, { x: 500, y: 120 }, { dx: 0, dy: -MP }, { dx: 0, dy: 0 });

  // ── simSnap (Bot 2v2 Vorausberechnung, 420 Frames wie im Bot) ──
  cases.N1_snap_pileup = G.simSnap([
    { x: 354.5, y: 766.75, vx: 30 * L, vy: -MP * L, alive: true, owner: 0 },
    { x: 645.5, y: 766.75, vx: 0, vy: 0, alive: true, owner: 0 },
    { x: 500, y: 233.25, vx: 0, vy: 0, alive: true, owner: 1 },
    { x: 560, y: 300, vx: 0, vy: 0, alive: true, owner: 1 } ], 420);
  cases.N2_snap_crossfire = G.simSnap([
    { x: 300, y: 700, vx: MP * L * 0.7, vy: -MP * L * 0.7, alive: true, owner: 0 },
    { x: 700, y: 700, vx: -MP * L * 0.7, vy: -MP * L * 0.7, alive: true, owner: 0 },
    { x: 300, y: 300, vx: 0, vy: 0, alive: true, owner: 1 },
    { x: 700, y: 300, vx: 0, vy: 0, alive: true, owner: 1 } ], 420);

  return cases;
}

// exact deep comparison (numbers must be bit-identical after JSON round-trip)
function diff(a, b, p = '') {
  if (typeof a !== typeof b) return p + ': type ' + typeof a + ' != ' + typeof b;
  if (a === null || typeof a !== 'object') return Object.is(a, b) ? null : p + ': ' + a + ' != ' + b;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return p + ': keys ' + ka.length + ' != ' + kb.length;
  for (const k of ka) { const d = diff(a[k], b[k], p + '.' + k); if (d) return d; }
  return null;
}

const mode = process.argv[2] || '';
const G = buildEnv(null);
const actual = JSON.parse(JSON.stringify(buildCases(G)));   // JSON round-trip = exakt fuer Doubles

if (mode === '--update') {
  fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 1));
  console.log('GOLDEN geschrieben:', GOLDEN_PATH, '(' + Object.keys(actual).length + ' Faelle)');
  process.exit(0);
}

if (!fs.existsSync(GOLDEN_PATH)) { console.error('FAIL: golden_physics.json fehlt — einmalig mit --update erzeugen.'); process.exit(2); }
const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

let pass = 0, fail = 0;
for (const name of Object.keys(golden)) {
  const d = diff(golden[name], actual[name], name);
  if (d) { fail++; console.error('FAIL ' + name + ' -> ' + d); }
  else pass++;
}
for (const name of Object.keys(actual)) if (!(name in golden)) { fail++; console.error('FAIL: Fall ' + name + ' fehlt im Golden'); }

if (mode === '--selftest') {
  // Empfindlichkeits-Beweis: minimal veraenderte Reibung MUSS abweichen
  const P = buildEnv('0.9920001');
  const perturbed = JSON.parse(JSON.stringify(buildCases(P)));
  let diffs = 0;
  for (const name of Object.keys(golden)) if (diff(golden[name], perturbed[name])) diffs++;
  console.log('Selftest: ' + diffs + '/' + Object.keys(golden).length + ' Faelle weichen bei FRICTION+1e-7 ab ' + (diffs > 0 ? '(OK — Suite ist empfindlich)' : '(FEHLER — Suite blind!)'));
  if (diffs === 0) fail++;
}

console.log('\nGolden-Physik: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
