// M8-T2 FFA core logic tests — extracts the REAL stepSim + afterResult from
// index.html (same technique as tools/test_physics_golden.js) and verifies the
// free-for-all round flow: elimination across turns, last-man-standing,
// simultaneous-out tiebreak, round win, match win at 3.
//   node test_ffa.js
const fs = require('fs');
const HTML = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

function grab(re, name) {
  const m = HTML.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
}
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const afterResultSrc = grab(/function afterResult\(\)\{[\s\S]*?\n\}/, 'afterResult');
const constSrc1 = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const constSrc2 = grab(/const SPIN_K=[^\n]*/, 'spin constants');
const pcolsSrc = grab(/const PCOLS=[^\n]*/, 'PCOLS');

function buildEnv() {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${constSrc1}
    ${constSrc2}
    ${pcolsSrc}
    function curFR(){return FRICTION;} function curFE(){return FEND;} function curST(){return STOPV;}
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', outBall=-1, roundWinner=-1, roundNo=1, winTarget=3;
    let aimSet=[], commitIdx=[], commitAim=[], commitSpin=[];
    let curAimer=0, bgPulse=0, bgPulseRGB='';
    let online=false, myPlayer=0, mode='ffa', fmt='single', ffaN=3, score=[];
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},charge:{start(){},stop(){},update(){}}};
    function spawn(){} function popBall(){}
    function winnerRGB(lo){const w=roundWinner>=0?roundWinner:1-lo;return PCOLS[w].rgb;}
    let r3dActive=false; function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    let covered=-1, gameOverW=-1, startRoundCalls=0;
    function openCover(pi){covered=pi;}
    function updateHud(){} function setPhaseText(){} function onlineArmTurn(){}
    function toast(){} function pName(p){return 'P'+p;}
    function gameOver(w){gameOverW=w;}
    function startRound(){startRoundCalls++;}
    ${stepSimSrc}
    ${afterResultSrc}
    return {
      set(s){ balls=s.balls; phase='sim'; outBall=-1; roundWinner=-1; ffaN=s.ffaN; mode='ffa';
              score=s.score||new Array(s.ffaN).fill(0); winTarget=s.winTarget||3; roundNo=s.roundNo||1;
              covered=-1; gameOverW=-1; startRoundCalls=0; R=R0; },
      get(){ return { phase, outBall, roundWinner, curAimer, covered, gameOverW, startRoundCalls,
                      score:score.slice(), roundNo, aimN:aimSet.length,
                      alive:balls.map(b=>b.alive) }; },
      stepSim:()=>stepSim(), afterResult:()=>afterResult()
    };
  `;
  return new Function(env)();
}

const G = buildEnv();
const ball = (x, y, o, vx = 0, vy = 0, alive = true) => ({ x, y, vx, vy, sx: x, sy: y, owner: o, alive, spin: 0 });
function run(state, maxFrames = 4000) {
  G.set(state);
  let f = 0;
  while (f++ < maxFrames) { G.stepSim(); const p = G.get().phase; if (p !== 'sim') break; }
  return G.get();
}
let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL ' + name + (info ? ' -> ' + JSON.stringify(info) : '')); }
}

// T1 — 3 Spieler: einer fliegt raus, Runde laeuft weiter (2 Owner uebrig)
let r = run({ ffaN: 3, balls: [
  ball(500, 700, 0), ball(500, 300, 1, 0, -9), ball(300, 500, 2) ] });
ok('T1 elimination mid-round: ball out', r.alive[1] === false, r);
ok('T1 round continues (no result)', r.phase === 'aim', r);
ok('T1 commit arrays sized for 3', r.aimN === 3, r);
ok('T1 next cover = first alive (P0)', r.covered === 0 && r.curAimer === 0, r);

// T2 — Rundensieg: letzter Gegner fliegt, Ueberlebender gewinnt
r = run({ ffaN: 3, balls: [
  ball(500, 700, 0), ball(500, 300, 1, 0, 0, false), ball(300, 500, 2, -9, 0) ] });
ok('T2 last-man-standing ends round', r.phase === 'result', r);
ok('T2 outBall = eliminated ball', r.outBall === 2, r);
ok('T2 roundWinner = survivor P0', r.roundWinner === 0, r);

// T3 — 5 Spieler: drei fliegen gleichzeitig, zwei Owner bleiben -> weiter
r = run({ ffaN: 5, balls: [
  ball(500, 700, 0), ball(500, 300, 1, 0, -9), ball(300, 500, 2),
  ball(700, 500, 3, 9, 0), ball(500, 100, 4, 0, -9) ] });
ok('T3 5p: three out, round continues', r.phase === 'aim' && r.alive.join() === 'true,false,true,false,false', r);
ok('T3 commit arrays sized for 5', r.aimN === 5, r);

// T3b — Cover ueberspringt Eliminierte: P0 tot -> naechster Zug beginnt bei P1
r = run({ ffaN: 3, balls: [
  ball(500, 700, 0, 0, 0, false), ball(500, 300, 1, 0, 0.5), ball(300, 500, 2) ] });
ok('T3b dead P0 skipped for cover', r.phase === 'aim' && r.covered === 1 && r.curAimer === 1, r);

// T4 — Gleichzeitig-Out-Tiebreak: beide Verbliebenen im selben Sub-Step raus;
// weiter draussen = decisive/Verlierer, weniger weit = Rundensieger
r = run({ ffaN: 3, balls: [
  ball(986, 500, 0, 10, 0), ball(14, 500, 1, -6, 0), ball(300, 500, 2, 0, 0, false) ] });
ok('T4 simultaneous out ends round', r.phase === 'result', r);
ok('T4 decisive = farther ball (P0)', r.outBall === 0, r);
ok('T4 tiebreak winner = nearer ball (P1)', r.roundWinner === 1, r);

// T5 — Rundensieg-Verbuchung ohne Matchende (stepSim setzt outBall/roundWinner, dann afterResult)
r = run({ ffaN: 3, score: [1, 0, 0], balls: [
  ball(500, 700, 0), ball(500, 300, 1, 0, 0, false), ball(300, 500, 2, -9, 0) ] });
G.afterResult();
r = G.get();
ok('T5 round win booked (score 2)', r.score.join() === '2,0,0', r);
ok('T5 no game over yet', r.gameOverW === -1 && r.startRoundCalls === 1 && r.roundNo === 2, r);

// T6 — Matchsieg bei 3 Rundensiegen
r = run({ ffaN: 3, score: [2, 0, 0], balls: [
  ball(500, 700, 0), ball(500, 300, 1, 0, 0, false), ball(300, 500, 2, -9, 0) ] });
G.afterResult();
r = G.get();
ok('T6 match win at 3', r.gameOverW === 0 && r.score.join() === '3,0,0', r);
ok('T6 no extra round started', r.startRoundCalls === 0, r);

// T7 — 2-Spieler-Aequivalenz: FFA-Pfad mit ffaN=2 verhaelt sich wie 1v1 (Sieger=Ueberlebender)
r = run({ ffaN: 2, balls: [ ball(500, 700, 0), ball(500, 300, 1, 0, -9) ] });
ok('T7 ffaN=2 behaves like 1v1', r.phase === 'result' && r.outBall === 1 && r.roundWinner === 0, r);

console.log('\nFFA-Kern: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
