// TEAM DUEL (2v2, fmt 'team_duel') core logic tests — extracts the REAL
// stepSim/afterResult/placeBalls/sanitizeMove/allAliveCommitted from index.html
// (same technique as tools/test_ffa.js) and verifies the team round flow:
//   - 4 balls, symmetric start, teams Blue(0,2)/Red(1,3), team colors
//   - each seat controls ONLY its own ball (sanitizeMove fallback)
//   - all four active players commit; after an elimination only three
//   - one player out -> round continues while the teammate lives
//   - team loses when BOTH of its balls are out; team scoring (score[team])
//   - simultaneous full elimination of both teams -> deterministic draw (-2)
//   - match win at winTarget; rematch/next round restores 4 balls
//   - determinism: identical inputs -> bit-identical simulation
//   node test_team_duel.js
const fs = require('fs');
const HTML = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

function grab(re, name) {
  const m = HTML.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
}
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const afterResultSrc = grab(/function afterResult\(\)\{[\s\S]*?\n\}/, 'afterResult');
const placeBallsSrc = grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls');
const sanitizeSrc = grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove');
const allCommittedSrc = grab(/function allAliveCommitted\(\)\{[^\n]*/, 'allAliveCommitted');
const mkBallSrc = grab(/function mkBall\(x,y,owner\)\{[^\n]*/, 'mkBall');
const npSrc = grab(/function np\(\)\{[^\n]*/, 'np');
const teamCapSrc = grab(/function teamCap\(\)\{[^\n]*/, 'teamCap');
const teamOfSrc = grab(/function teamOf\(s\)\{[^\n]*/, 'teamOf');
const colorSlotSrc = grab(/function colorSlot\(owner\)\{[^\n]*/, 'colorSlot');
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
    let online=false, myPlayer=0, mode='ffa', fmt='team_duel', ffaN=4, score=[];
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},charge:{start(){},stop(){},update(){}}};
    function spawn(){} function popBall(){}
    function winnerRGB(lo){return '';}
    let r3dActive=false; function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    let covered=-1, gameOverW=-1, startRoundCalls=0, drawShown=0;
    function openCover(pi){covered=pi;}
    function updateHud(){} function setPhaseText(){} function onlineArmTurn(){}
    function toast(){} function pName(p){return 'P'+p;}
    function showRoundEnd(){}
    function showTeamDraw(){drawShown++;}
    function gameOver(w){gameOverW=w;}
    function startRound(){startRoundCalls++;}
    ${mkBallSrc}
    ${npSrc}
    ${teamCapSrc}
    ${teamOfSrc}
    ${colorSlotSrc}
    ${placeBallsSrc}
    ${sanitizeSrc}
    ${allCommittedSrc}
    ${stepSimSrc}
    ${afterResultSrc}
    return {
      set(s){ balls=s.balls; phase='sim'; outBall=-1; roundWinner=-1; ffaN=s.ffaN||4; mode='ffa'; fmt=s.fmt||'team_duel';
              score=s.score||[0,0,0,0]; winTarget=s.winTarget||3; roundNo=s.roundNo||1;
              covered=-1; gameOverW=-1; startRoundCalls=0; drawShown=0; R=s.R!=null?s.R:R0; },
      get(){ return { phase, outBall, roundWinner, curAimer, covered, gameOverW, startRoundCalls, drawShown,
                      score:score.slice(), roundNo, aimN:aimSet.length,
                      alive:balls.map(b=>b.alive),
                      pos:balls.map(b=>b.x+':'+b.y+':'+b.vx+':'+b.vy) }; },
      place(){ balls=[]; placeBalls(); return balls.map(b=>({x:b.x,y:b.y,owner:b.owner,alive:b.alive})); },
      sanitize(who,idx,dx,dy,sp){ return sanitizeMove(who,idx,dx,dy,sp); },
      setAim(a){ aimSet=a.slice(); },
      allCommitted(){ return allAliveCommitted(); },
      teamOf:(s)=>teamOf(s), colorSlot:(o)=>colorSlot(o),
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

// T1 — Startaufstellung: 4 Kugeln, Owner 0-3, symmetrisch, Teammitglieder gegenueber,
//      Farbmuster Blau/Rot/Blau/Rot (colorSlot), Team = Seat%2
G.set({ balls: [] });
const placed = G.place();
ok('T1 four balls, owners 0-3', placed.length === 4 && placed.map(b => b.owner).join() === '0,1,2,3', placed);
ok('T1 all on start radius R*0.57', placed.every(b => Math.abs(Math.hypot(b.x - 500, b.y - 500) - 485 * 0.57) < 1e-9), placed);
ok('T1 teammates opposite (0<->2)', Math.abs(placed[0].x + placed[2].x - 1000) < 1e-9 && Math.abs(placed[0].y + placed[2].y - 1000) < 1e-9, placed);
ok('T1 teammates opposite (1<->3)', Math.abs(placed[1].x + placed[3].x - 1000) < 1e-9 && Math.abs(placed[1].y + placed[3].y - 1000) < 1e-9, placed);
ok('T1 color pattern blue/red/blue/red', [0, 1, 2, 3].map(G.colorSlot).join() === '0,1,0,1');
ok('T1 teams blue(0,2)/red(1,3)', G.teamOf(0) === 0 && G.teamOf(2) === 0 && G.teamOf(1) === 1 && G.teamOf(3) === 1);

// T2 — Ownership: sanitizeMove erzwingt die EIGENE Kugel (fremde/Team-Kugel-idx faellt zurueck)
G.set({ balls: [ball(400, 700, 0), ball(500, 300, 1), ball(600, 700, 2), ball(500, 100, 3)] });
ok('T2 own idx accepted', G.sanitize(1, 1, 10, 10, 0).idx === 1);
ok('T2 foreign idx falls back to own ball', G.sanitize(1, 0, 10, 10, 0).idx === 1);
ok('T2 teammate idx falls back to own ball', G.sanitize(2, 0, 10, 10, 0).idx === 2);
ok('T2 seat 3 controls only ball 3', G.sanitize(3, 2, 10, 10, 0).idx === 3);

// T3 — Commit-Gate: alle 4 aktiven Spieler muessen committen; nach einer Elimination nur noch 3
G.set({ balls: [ball(400, 700, 0), ball(500, 300, 1), ball(600, 700, 2), ball(500, 100, 3)] });
G.setAim([true, true, true, false]);
ok('T3 waits for all four commits', G.allCommitted() === false);
G.setAim([true, true, true, true]);
ok('T3 all four committed -> reveal', G.allCommitted() === true);
G.set({ balls: [ball(400, 700, 0), ball(500, 300, 1, 0, 0, false), ball(600, 700, 2), ball(500, 100, 3)] });
G.setAim([true, false, true, true]);
ok('T3 eliminated seat not awaited (3 active)', G.allCommitted() === true);

// T4 — Ein Spieler raus, Teammitglied lebt -> Runde laeuft weiter (kein Rundenende)
let r = run({ balls: [
  ball(400, 700, 0), ball(500, 300, 1, 0, -9), ball(600, 700, 2), ball(300, 300, 3) ] });
ok('T4 red1 out', r.alive.join() === 'true,false,true,true', r);
ok('T4 round continues while teammate lives', r.phase === 'aim', r);
ok('T4 commit arrays sized for 4', r.aimN === 4, r);

// T4b — Auch beim Verlust eines BLAUEN Spielers laeuft die Runde weiter
r = run({ balls: [
  ball(400, 700, 0, 0, 9), ball(500, 300, 1), ball(600, 700, 2), ball(500, 100, 3) ] });
ok('T4b blue1 out, round continues', r.alive[0] === false && r.phase === 'aim', r);

// T5 — Team verliert erst mit BEIDEN Kugeln draussen: Rot komplett raus -> Blau gewinnt die Runde
r = run({ balls: [
  ball(400, 700, 0), ball(500, 300, 1, 0, -9), ball(600, 700, 2), ball(500, 100, 3, 0, -9) ] });
ok('T5 both red out ends round', r.phase === 'result', r);
ok('T5 roundWinner = TEAM blue (0)', r.roundWinner === 0, r);

// T5b — Rot verliert einen frueher, den zweiten spaeter (zweite Kugel als Einzel-Out)
r = run({ balls: [
  ball(400, 700, 0), ball(500, 300, 1, 0, 0, false), ball(600, 700, 2), ball(500, 100, 3, 0, -9) ] });
ok('T5b last red ball out -> blue wins round', r.phase === 'result' && r.roundWinner === 0, r);

// T5c — Blau komplett raus -> Rot gewinnt (Team-Index 1)
r = run({ balls: [
  ball(400, 700, 0, 0, 9), ball(500, 300, 1), ball(600, 700, 2, 0, 0, false), ball(500, 100, 3) ] });
ok('T5c blue out -> red wins round', r.phase === 'result' && r.roundWinner === 1, r);

// T5d — Simultan: Blau komplett raus + EIN Roter raus, ein Roter ueberlebt -> Rot gewinnt
r = run({ balls: [
  ball(986, 500, 0, 10, 0), ball(500, 986, 1, 0, 10), ball(14, 500, 2, -10, 0), ball(500, 300, 3) ] });
ok('T5d partial simultaneous out -> surviving team wins', r.phase === 'result' && r.roundWinner === 1, r);

// T6 — Teamwertung: Rundensieg bucht EINEN Punkt auf das Team (score[team]), kein Matchende
r = run({ score: [1, 0, 0, 0], balls: [
  ball(400, 700, 0), ball(500, 300, 1, 0, 0, false), ball(600, 700, 2), ball(500, 100, 3, 0, -9) ] });
G.afterResult();
r = G.get();
ok('T6 team score booked (blue 2)', r.score.join() === '2,0,0,0', r);
ok('T6 next round started', r.gameOverW === -1 && r.startRoundCalls === 1 && r.roundNo === 2, r);

// T6b — Rot-Punkt landet auf score[1]
r = run({ score: [0, 0, 0, 0], balls: [
  ball(400, 700, 0, 0, 9), ball(500, 300, 1), ball(600, 700, 2, 0, 0, false), ball(500, 100, 3) ] });
G.afterResult();
r = G.get();
ok('T6b red round win -> score[1]', r.score.join() === '0,1,0,0', r);

// T7 — Matchsieg des Teams bei winTarget
r = run({ score: [2, 0, 0, 0], balls: [
  ball(400, 700, 0), ball(500, 300, 1, 0, 0, false), ball(600, 700, 2), ball(500, 100, 3, 0, -9) ] });
G.afterResult();
r = G.get();
ok('T7 team match win at 3', r.gameOverW === 0 && r.score.join() === '3,0,0,0', r);
ok('T7 no extra round started', r.startRoundCalls === 0, r);

// T8 — Simultane Vollelimination BEIDER Teams -> deterministisches Unentschieden:
//      kein Punkt, kein Sieger, neue Runde mit vier Kugeln
r = run({ score: [1, 1, 0, 0], balls: [
  ball(986, 500, 0, 10, 0), ball(500, 986, 1, 0, 10), ball(14, 500, 2, -10, 0), ball(500, 14, 3, 0, -10) ] });
ok('T8 simultaneous full elimination ends round', r.phase === 'result', r);
ok('T8 draw sentinel (-2), no random winner', r.roundWinner === -2, r);
G.afterResult();
r = G.get();
ok('T8 draw: no point booked', r.score.join() === '1,1,0,0', r);
ok('T8 draw overlay + new round with 4 balls', r.drawShown === 1 && r.startRoundCalls === 1 && r.roundNo === 2 && r.gameOverW === -1, r);

// T9 — Rematch/NEUE Runde: placeBalls stellt wieder exakt 4 Kugeln in Teamaufstellung
G.set({ balls: [] });
const placed2 = G.place();
ok('T9 fresh round restores 4 team balls', placed2.length === 4 && placed2.every(b => b.alive) && placed2.map(b => b.owner).join() === '0,1,2,3', placed2);

// T10 — Determinismus: identische Eingaben -> bit-identische Simulation (2 Laeufe)
const mkState = () => ({ balls: [
  ball(400, 700, 0, 3.2, -4.1), ball(500, 300, 1, -2.7, 5.3), ball(600, 700, 2, -3.3, -2.2), ball(500, 100, 3, 1.9, 4.4) ] });
const rA = run(mkState());
const rB = run(mkState());
ok('T10 deterministic: identical end phase/winner', rA.phase === rB.phase && rA.roundWinner === rB.roundWinner && rA.outBall === rB.outBall);
ok('T10 deterministic: bit-identical ball states', JSON.stringify(rA.pos) === JSON.stringify(rB.pos) && rA.alive.join() === rB.alive.join());

// T11 — Bestehende Modi unveraendert: klassisches FFA-Verhalten im selben Env (fmt 'ffa')
r = run({ fmt: 'ffa', ffaN: 4, balls: [
  ball(400, 700, 0), ball(500, 300, 1, 0, -9), ball(600, 700, 2), ball(300, 300, 3) ] });
ok('T11 ffa smoke: one out of four -> round continues', r.phase === 'aim' && r.alive.join() === 'true,false,true,true', r);
r = run({ fmt: 'ffa', ffaN: 4, balls: [
  ball(400, 700, 0), ball(500, 300, 1, 0, -9), ball(600, 700, 2, 0, 9), ball(300, 300, 3, -9, 0) ] });
ok('T11 ffa smoke: last-man-standing wins (owner, not team)', r.phase === 'result' && r.roundWinner === 0, r);

console.log('\nTeam-Duel: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
