// Offline tuning comparison (M5-T1) — runs fixed scenarios through the REAL
// simulation code (extracted from index.html like the golden suite) once with
// the current constants and once with tuned values, then prints the metrics
// side by side. Read-only: never touches index.html, goldens or the protocol.
//
//   node tools/tune_compare.js br:28,fend:0.9895,stopv:0.12
//
// Accepted keys/ranges mirror the in-game ?tune= flag:
//   br 20-40 (permille of LOGICAL), fend 0.980-0.992, stopv 0.05-0.20

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function grab(re, name) {
  const m = HTML.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
}
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const constSrc1 = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const constSrc2 = grab(/const SPIN_K=[^\n]*/, 'spin constants');

function parseTune(arg) {
  const t = {};
  for (const kv of (arg || '').split(',')) {
    const [k, v] = kv.split(':'), n = parseFloat(v);
    if (!isFinite(n)) continue;
    if (k === 'br' && n >= 20 && n <= 40) t.br = n;
    else if (k === 'fend' && n >= 0.980 && n <= 0.992) t.fend = n;
    else if (k === 'stopv' && n >= 0.05 && n <= 0.20) t.stopv = n;
  }
  return t;
}

// Same inert-stub environment as the golden suite, but BR/FEND/STOPV parametrizable.
function buildEnv(t) {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*${t.br != null ? t.br / 1000 : 0.032}; let R=R0;
    ${constSrc1}
    ${constSrc2}
    function curFR(){return FRICTION;}
    function curFE(){return ${t.fend != null ? t.fend : 'FEND'};}
    function curST(){return ${t.stopv != null ? t.stopv : 'STOPV'};}
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
    return {
      MP: maxPull(),
      set(state){ balls=state.balls; phase='sim'; outBall=-1; fmt=state.fmt||'single'; R=R0; },
      get(){ return { phase, outBall, balls: balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,alive:b.alive})) }; },
      stepSim: ()=>stepSim()
    };
  `;
  return new Function(env)();
}

const ball = (x, y, o, vx = 0, vy = 0) => ({ x, y, vx, vy, sx: x, sy: y, owner: o, alive: true, spin: 0 });
const L = 0.034; // LAUNCH
const SLOWV = 0.35;

// Runs a scenario and collects feel metrics for ball 0 (the "shooter").
function run(G, state) {
  G.set({ fmt: state.fmt, balls: state.balls.map(b => ({ ...b })) });
  const start = { x: state.balls[0].x, y: state.balls[0].y };
  let frames = 0, slowPt = null;
  while (frames < 4000) {
    G.stepSim(); frames++;
    const s = G.get(), b0 = s.balls[0];
    const sp = Math.hypot(b0.vx, b0.vy);
    if (slowPt === null && sp > 0 && sp < SLOWV && b0.alive) slowPt = { x: b0.x, y: b0.y };
    if (s.phase !== 'sim') {
      return {
        frames,
        out: s.outBall,
        travel: Math.hypot(b0.x - start.x, b0.y - start.y),
        tail: slowPt && b0.alive ? Math.hypot(b0.x - slowPt.x, b0.y - slowPt.y) : 0,
        alive: s.balls.map(b => (b.alive ? '1' : '0')).join('')
      };
    }
  }
  return { frames, out: -9, travel: 0, tail: 0, alive: '?' };
}

function scenarios(G) {
  const MP = G.MP;
  return [
    ['gentle_nudge', { balls: [ball(500, 776.45, 0, 0, -12 * L), ball(500, 223.55, 1)] }],
    ['half_shot_headon', { balls: [ball(500, 776.45, 0, 0, -MP * L * 0.55), ball(500, 223.55, 1)] }],
    ['full_shot_headon', { balls: [ball(500, 776.45, 0, 0, -MP * L), ball(500, 223.55, 1)] }],
    ['graze_near_edge', { balls: [ball(500, 500 - (485 - 32 * 1.5), 0, 0, -30 * L), ball(500, 776.45, 1)] }],
    ['double_pileup', { fmt: 'double', balls: [
      ball(354.5, 766.75, 0, 40 * L, -MP * L), ball(645.5, 766.75, 0),
      ball(354.5, 233.25, 1), ball(645.5, 233.25, 1)] }]
  ];
}

const tune = parseTune(process.argv[2]);
if (!Object.keys(tune).length) {
  console.error('Usage: node tools/tune_compare.js br:28,fend:0.9895,stopv:0.12  (at least one valid key)');
  process.exit(2);
}

const A = buildEnv({});      // current constants
const B = buildEnv(tune);    // tuned
console.log('Tune:', JSON.stringify(tune));
console.log('');
const head = ['scenario', 'frames I/T', 'travel I/T', 'tail I/T', 'out I/T', 'alive I/T'];
const rows = [head];
for (const [name, st] of scenarios(A)) {
  const a = run(A, st), b = run(B, st);
  const f = n => (Math.round(n * 10) / 10).toString();
  rows.push([name,
    a.frames + ' / ' + b.frames,
    f(a.travel) + ' / ' + f(b.travel),
    f(a.tail) + ' / ' + f(b.tail),
    a.out + ' / ' + b.out,
    a.alive + ' / ' + b.alive]);
}
const w = head.map((_, i) => Math.max(...rows.map(r => r[i].length)) + 2);
for (const r of rows) console.log(r.map((c, i) => c.padEnd(w[i])).join(''));
console.log('\ntravel = Weg der Schuss-Kugel bis Stillstand (LOGICAL); tail = Auslaufweg nach Unterschreiten von SLOWV;');
console.log('out = outBall am Sim-Ende (-1 = keiner); I = Ist-Konstanten, T = Tune-Werte.');
