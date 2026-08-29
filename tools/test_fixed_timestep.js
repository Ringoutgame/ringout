// Arena Football - FIXED-TIMESTEP-SUITE
//
// Die Simulation lief frueher GENAU EINMAL pro Renderframe und haengte damit an der
// Bildwiederholrate: auf 120 Hz doppelt so schnell wie auf 60 Hz. Diese Suite haelt fest,
// dass Gameplay jetzt ausschliesslich in festen Schritten laeuft und dass dasselbe Spiel
// bei 30, 60, 90, 120 und 144 Hz denselben Verlauf nimmt.
//
// Gefahren wird die ECHTE Schleifenlogik aus index.html (simStep + simAdvance) samt der
// echten Physik - nichts wird nachgebaut, nichts injiziert.
//
//   node tools/test_fixed_timestep.js
//
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(re, name) {
  const m = HTML.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
}
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }

const footballBlock = grab(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nfunction stepSim\(\)\{)/, 'Football-Block');
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const consts = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const spin = grab(/const SPIN_K=[^\n]*/, 'spin constants');
const timing = grab(/const REVEAL_MS=[^\n]*/, 'REVEAL_MS/RESULT_MS');
const drift = grab(/const RESULT_SLOWMUL=[^\n]*/, 'RESULT_SLOWMUL');
const pcols = grab(/const PCOLS=[^\n]*/, 'PCOLS');
const mkBallSrc = grab(/function mkBall\([^\n]*/, 'mkBall');
const placeBallsSrc = grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls');
const teamCapSrc = grab(/function teamCap\([^\n]*/, 'teamCap');
const ballsOutsideSrc = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const npSrc = grab(/function np\([^\n]*/, 'np');
const resetCommitsSrc = grab(/function resetCommits\(\)\{[\s\S]*?\n\}/, 'resetCommits');
const startRoundSrc = grab(/function startRound\(\)\{[\s\S]*?\n\}/, 'startRound');
const curFRSrc = grab(/function curFR\(\)[^\n]*/, 'curFR');
const curFESrc = grab(/function curFE\(\)[^\n]*/, 'curFE');
const curSTSrc = grab(/function curST\(\)[^\n]*/, 'curST');
const recordFrameSrc = grab(/function recordFrame\(\)\{[\s\S]*?\n\}/, 'recordFrame');
const updParticlesSrc = grab(/function updParticles\(\)\{[\s\S]*?bgPulse=0;\}/, 'updParticles');
const resultDriftSrc = grab(/function resultDrift\(\)[^\n]*/, 'resultDrift');
const applyLaunchSrc = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
// Abschusskurve: der Zug muss auf jeder Bildwiederholrate denselben Impuls erzeugen.
const tempoSrc = grab(/const FB_LAUNCH_SCALE=[\s\S]*?\nfunction fbLaunchMul\(len\)\{[\s\S]*?\n\}/, 'Abschusskurve');
const simConstSrc = grab(/const SIM_HZ=[\s\S]*?let simAcc=0,simPrev=0;/, 'Fixed-Timestep-Konstanten');
const simResetSrc = grab(/function simResetClock\(\)[^\n]*/, 'simResetClock');
const simStepSrc = grab(/function simStep\(now\)\{[\s\S]*?\n\}/, 'simStep');
const simAdvanceSrc = grab(/function simAdvance\(now\)\{[\s\S]*?\n\}/, 'simAdvance');
const loopSrc = grab(/function loop\(now\)\{[\s\S]*?\n\}/, 'Main Loop');

function buildEnv() {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${consts}
    ${spin}
    ${timing}
    ${drift}
    ${pcols}
    const TUNE=null;
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', phaseStart=0, outBall=-1, roundWinner=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false;
    let mode='football', fmt='single';
    let score=[0,0], roundNo=1, r3dActive=false, particles=[], fx3=[], recFrames=[];
    let replaying=false; function repTick(){}
    let taBed=0, taLock=0, launchCalls=0;
    const SFX={hit(){},drop(){},ringout(){},launch(){launchCalls++;},round(){},win(){},rollUpdate(){},unlock(){},
               footballGoal(){},footballGoalPreload(){},footballGoalStop(){},
               fbTransitionBed(){taBed++;},fbTransitionLock(){taLock++;},fbTransitionStop(){}};
    function spawn(){} function popBall(){} function winnerRGB(){return '';}
    function fx3Hit(){} function fx3Dust(){}
    const NOWREF={t:0};
    function setPhase(p){phase=p;phaseStart=NOWREF.t;} function updateHud(){} function setPhaseText(){}
    function onlineArmTurn(){} function openCover(){} function cancelAimDrag(){}
    function colorSlot(o){return o;}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    function gameOver(){phase='over';}
    function afterResult(){phase='aim';}
    function renderFfaBar(){}
    function devSync(){}
    let seatGone=[false,false,false,false];
    ${mkBallSrc}
    ${teamCapSrc}
    ${placeBallsSrc}
    ${ballsOutsideSrc}
    ${resolveRingOutsSrc}
    ${npSrc}
    ${resetCommitsSrc}
    ${startRoundSrc}
    ${footballBlock}
    ${curFRSrc}
    ${curFESrc}
    ${curSTSrc}
    ${stepSimSrc}
    ${recordFrameSrc}
    ${updParticlesSrc}
    ${resultDriftSrc}
    ${tempoSrc}
    ${applyLaunchSrc}
    ${simConstSrc}
    ${simResetSrc}
    ${simStepSrc}
    ${simAdvanceSrc}
    // Der Wrapper zaehlt Schritte und summiert die Strecke des beobachteten Koerpers
    // JE SIMULATIONSSCHRITT - damit ist die Messung von der Abtastrate des Renderers
    // vollstaendig unabhaengig.
    let simSteps=0, stepPath=0, pathIdx=-1, pathPrev=null, settleAt=-1;
    let launchSnap=null, seenLaunch=0;
    const __simStep=simStep;
    simStep=function(now){
      simSteps++;NOWREF.t=now;
      const r=__simStep(now);
      // Der Abschussschritt setzt nur die Geschwindigkeit; gedaempft wird erst im NAECHSTEN
      // Schritt. Genau hier ist der Impuls also unverfaelscht ablesbar.
      if(launchCalls!==seenLaunch){seenLaunch=launchCalls;
        if(!launchSnap)launchSnap=balls.map(b=>({vx:b.vx,vy:b.vy}));}
      if(pathIdx>=0&&balls[pathIdx]){
        const b=balls[pathIdx];
        if(pathPrev)stepPath+=Math.hypot(b.x-pathPrev.x,b.y-pathPrev.y);
        pathPrev={x:b.x,y:b.y};
      }
      if(settleAt<0&&phase!=='sim')settleAt=simSteps;
      return r;
    };
    return {
      sim(){ return {hz:SIM_HZ, dt:SIM_DT_MS, maxSteps:SIM_MAX_STEPS, stall:SIM_STALL_MS,
                     catchMax:SIM_CATCHUP_MAX_MS, catchSteps:SIM_CATCHUP_STEPS}; },
      setOnline(v){ online=!!v; },
      resetClock(){ simResetClock(); },
      acc(){ return simAcc; },
      steps(){ return simSteps; },
      advance(now){ NOWREF.t=now; return simAdvance(now); },
      legacyFrame(now){ NOWREF.t=now; simStep(now); },
      setPhys(o){ Object.assign(FOOTBALL_PHYS, o); },
      launchV(){ return maxPull()*LAUNCH; },
      launchAt(frac){ const len=maxPull()*frac; return len*fbLaunchMul(len); },
      neutral(){ return FOOTBALL_NEUTRAL_OWNER; },
      setVariant(v){ fbVariant=v; }, elimReset(){ fbElimReset(); },
      players(){ return fbElimPlayers(); },
      setLives(o,n){ fbElimLives[o]=n; },
      lives(){ return fbElimLives.slice(); }, phaseN(){ return fbElimPhaseN; },
      reset(){ balls=[]; phase='sim'; phaseStart=0; fbGoalState='play'; fbGoalTick=0;
               footballWinner=null; score=[0,0]; particles=[]; fx3=[]; recFrames=[];
               taBed=0; taLock=0; launchCalls=0; simSteps=0; stepPath=0;
               launchSnap=null; seenLaunch=0; simResetClock(); },
      setBalls(list){ balls=list.map(b=>({x:b.x,y:b.y,vx:b.vx||0,vy:b.vy||0,sx:b.x,sy:b.y,
                       owner:b.owner,alive:true,spin:b.spin||0})); phase='sim'; },
      // Strecke je SIMULATIONSSCHRITT - unabhaengig von der Abtastrate des Renderers.
      track(i){ pathIdx=i; stepPath=0; settleAt=-1; pathPrev=balls[i]?{x:balls[i].x,y:balls[i].y}:null; },
      launchSnap(i){ return launchSnap?launchSnap[i]:null; },
      path(){ return stepPath; },
      settleAt(){ return settleAt; },
      phase(){ return phase; },
      goalState(){ return fbGoalState; },
      score(){ return score.slice(); },
      taudio(){ return {bed:taBed, lock:taLock}; },
      launchCalls(){ return launchCalls; },
      setCommit(idx,dx,dy){ commitIdx=[idx,-1]; commitAim=[{dx,dy},{dx:0,dy:0}]; commitSpin=[0,0];
                            phase='reveal'; phaseStart=NOWREF.t; },
      vel(i){ return {vx:balls[i].vx, vy:balls[i].vy}; },
      finite(){ return balls.every(b=>Number.isFinite(b.x)&&Number.isFinite(b.y)&&
                                      Number.isFinite(b.vx)&&Number.isFinite(b.vy)); },
      get(){ return balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,owner:b.owner,alive:b.alive})); },
      hash(){ let h=2166136261>>>0;
        const mix=s=>{for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}};
        for(const b of balls)mix(b.owner+':'+(b.alive?1:0)+':'+b.x+':'+b.y+':'+b.vx+':'+b.vy+';');
        mix('|'+phase+'|'+fbGoalState+'|'+fbGoalTick+'|'+score.join(',')+'|'+fbElimPhaseN+
            '|'+fbElimLives.join(',')+'|'+fbElimActive.map(v=>v?1:0).join('')+'|'+footballWinner);
        return ('0000000'+h.toString(16)).slice(-8); }
    };
  `;
  return new Function(env)();
}

// Owner des NEUTRALEN Balls (Slot 4 ist seit der Fuenf-Spieler-Phase eine Spielerfarbe).
const NEU = 5;
const HZ = [30, 60, 90, 120, 144];
// Die freigegebenen Produktivwerte. Sie stehen hier nur als Erwartung - gerechnet wird
// mit dem echten FOOTBALL_PHYS aus index.html.
const PROD = { friction: 0.9958, frictionBall: 0.9964, fend: 0.9760, fendBall: 0.9790,
               slowv: 0.70, stopv: 0.075 };

console.log('ARENA FOOTBALL - FIXED TIMESTEP: gleiche Simulation auf jeder Bildwiederholrate\n');

// =================================================================================
// A0 - ARCHITEKTUR
// =================================================================================
{
  const E = buildEnv();
  const S = E.sim();
  ok(S.hz === 60, 'kanonischer Gameplay-Takt: 60 Schritte/s');
  ok(Math.abs(S.dt - 1000 / 60) < 1e-12, 'ein Schritt dauert exakt 1/60 s');
  ok(S.maxSteps >= 2 && S.maxSteps <= 8, 'Catch-up-Budget ist begrenzt (' + S.maxSteps + ' Schritte/Frame)');
  ok(S.stall > 0 && S.stall <= 1000, 'es gibt eine Pausenschwelle (' + S.stall + ' ms)');

  // L) KEINE VARIABLE-DT-PHYSIK. stepSim nimmt kein dt entgegen und liest keine Uhr;
  //    die verstrichene Zeit steuert ausschliesslich, WIE OFT der feste Schritt laeuft.
  ok(/^function stepSim\(\)\{/.test(stepSimSrc), 'stepSim nimmt keinen Zeitparameter');
  const stepBody = stepSimSrc.replace(/\/\/[^\n]*/g, '');
  ok(!/performance\.now|Date\.now|\bdt\b/.test(stepBody), 'stepSim liest keine Uhr und kennt kein dt');
  ok(!/\bdt\b/.test(simStepSrc.replace(/\/\/[^\n]*/g, '')), 'simStep skaliert nichts mit einem dt');
  // Die Physik wird NUR aus dem festen Schritt heraus getrieben.
  ok((HTML.match(/stepSim\(\);/g) || []).length === 2, 'stepSim() hat genau zwei Aufrufer');
  ok(/else if\(phase==='sim'\)stepSim\(\);/.test(simStepSrc),
     'der ZEITGETRIEBENE Aufrufer ist der feste Schritt (simStep)');
  ok(/while\(phase==='sim'&&g\+\+<FF_MAX_STEPS_PER_TURN\)stepSim\(\);/.test(HTML),
     'der zweite Aufrufer ist die Online-Rehydrierung - sie rechnet einen Zug am Stueck ' +
     'zu Ende und haengt schon deshalb an keiner Bildwiederholrate');
  // Die Grenze ist eine reine Schrittzahl. Waere sie eine Zeit- oder Wanduhrgroesse,
  // haenge die Rehydrierung doch wieder an der Maschine, auf der sie laeuft.
  ok(/const FF_MAX_STEPS_PER_TURN=\d+;/.test(HTML),
     'die Reissleine der Rehydrierung ist eine feste Schrittzahl, keine Zeit');
  ok(!/stepSim\(\)/.test(loopSrc), 'die Renderschleife ruft die Physik nicht mehr direkt');
  ok(/simAdvance\(now\);/.test(loopSrc), 'die Renderschleife treibt ausschliesslich den Akkumulator');
  // Der Akkumulator benutzt die Wanduhr NUR zum Zaehlen der Schritte.
  ok(/simAcc\+=dt;/.test(simAdvanceSrc) && /simAcc-=SIM_DT_MS;/.test(simAdvanceSrc),
     'der Akkumulator rechnet in ganzen SIM_DT_MS-Schritten');
}

// Ein Lauf ueber `seconds` reale Sekunden bei `hz`. mode 'fixed' = Akkumulator,
// 'legacy' = die alte Architektur (ein Gameplay-Schritt je Renderframe).
function run(hz, seconds, setup, mode) {
  const E = buildEnv();
  if (setup.phys) E.setPhys(setup.phys);
  if (setup.variant) { E.setVariant(setup.variant); E.elimReset(); }
  E.reset();
  E.setBalls(setup.balls);
  if (setup.lives) for (let o = 0; o < 4; o++) E.setLives(o, setup.lives[o]);
  const frameMs = 1000 / hz, frames = Math.round(seconds * hz);
  E.track(0);
  let t = 0;
  for (let i = 1; i <= frames; i++) {
    t += frameMs;
    if (mode === 'legacy') E.legacyFrame(t); else E.advance(t);
  }
  return { hz, steps: E.steps(), settleStep: E.settleAt(), path: E.path(), hash: E.hash(),
           score: E.score(), finite: E.finite(), audio: E.taudio(),
           lives: E.lives(), phaseN: E.phaseN(), goalState: E.goalState() };
}

const V = buildEnv().launchV();

// Den Abschussimpuls GENAU im Abschussschritt lesen. Danach laeuft die Daempfung weiter;
// ein einzelner Schritt Unterschied an der Fenstergrenze wuerde die MESSUNG verfaelschen,
// nicht die Simulation.
function launchImpulse(hz, frac) {
  const E = buildEnv();
  E.reset();
  E.setBalls([{ x: 500, y: 500, vx: 0, vy: 0, owner: NEU }, { x: 400, y: 500, vx: 0, vy: 0, owner: 0 }]);
  E.setCommit(1, 194 * frac, 0);
  const frameMs = 1000 / hz;
  let t = 0;
  for (let i = 0; i < Math.round(3 * hz) && E.launchCalls() === 0; i++) { t += frameMs; E.advance(t); }
  return { v: E.launchSnap(1), calls: E.launchCalls() };
}
const SHOT = { balls: [{ x: 500, y: 500, vx: V * 0.6, vy: V * 0.8, owner: NEU }] };

// =================================================================================
// A/B/C - GLEICHER VERLAUF BEI 30 / 60 / 90 / 120 / 144 Hz
// =================================================================================
{
  const R = {};
  for (const hz of HZ) R[hz] = run(hz, 12, SHOT, 'fixed');
  const ref = R[60];
  for (const hz of HZ) {
    // A) 60 vs 120, B) 60 vs 144, C) 30 vs 60 - alle gegen dieselbe Referenz.
    ok(R[hz].hash === ref.hash,
       hz + ' Hz liefert denselben Endzustand wie 60 Hz (' + R[hz].hash + ')');
    ok(Math.abs(R[hz].steps - ref.steps) <= 1,
       hz + ' Hz laeuft ueber dieselbe Zahl Gameplay-Schritte (' + R[hz].steps + ' vs ' + ref.steps + ')');
    // F) Settlement nach derselben Anzahl Schritte -> dieselbe REALE Zeit.
    ok(R[hz].settleStep === ref.settleStep,
       hz + ' Hz: Settlement nach Schritt ' + R[hz].settleStep + ' (60 Hz: ' + ref.settleStep + ')');
    // G) Streckenlaenge je Simulationsschritt gemessen - nicht je Renderframe.
    ok(Math.abs(R[hz].path - ref.path) < 1e-6,
       hz + ' Hz: identische Streckenlaenge (' + R[hz].path.toFixed(3) + ' px)');
    // K) keine NaN/Infinity.
    ok(R[hz].finite, hz + ' Hz: keine NaN- oder Infinity-Werte');
  }
  // GEGENPROBE: in der alten Architektur war genau das kaputt.
  const L = {};
  for (const hz of HZ) L[hz] = run(hz, 12, SHOT, 'legacy');
  ok(L[120].steps === 2 * L[60].steps,
     'Gegenprobe alte Architektur: 120 Hz rechnete doppelt so viele Schritte wie 60 Hz');
  ok(L[144].settleStep === L[60].settleStep && L[144].steps > L[60].steps,
     'Gegenprobe: gleicher Verlauf in Schritten, aber in deutlich kuerzerer REALER Zeit');
}

// =================================================================================
// D - EINGABE: derselbe Zug erzeugt denselben Impuls, unabhaengig von der Framerate
// =================================================================================
{
  // Es gibt genau EINEN Eingabepfad: Pointer Events. Maus und Touch laufen darueber
  // durch dieselben Handler und erzeugen denselben Commit-Vektor.
  ok(!/addEventListener\('touchstart'|addEventListener\('mousedown'/.test(HTML),
     'kein separater Touch- oder Maus-Pfad - die Eingabe laeuft ueber Pointer Events');
  // Der Commit wird beim Loslassen gespeichert; wirksam wird er erst im FESTEN Schritt.
  ok(/if\(phase==='reveal'&&now-phaseStart>REVEAL_MS\)applyLaunch\(\);/.test(simStepSrc),
     'der Abschuss wird im festen Schritt ausgeloest, nicht im Renderframe');
  ok(!/applyLaunch\(\)/.test(loopSrc), 'die Renderschleife loest keinen Abschuss aus');

  const V2 = buildEnv().launchV();
  const res = {};
  for (const hz of HZ) res[hz] = launchImpulse(hz, 1);   // voller Zug nach +x (maxPull)
  for (const hz of HZ) {
    ok(res[hz].calls === 1, hz + ' Hz: der Abschuss wird GENAU EINMAL verarbeitet');
    ok(Math.abs(res[hz].v.vx - res[60].v.vx) < 1e-12 && Math.abs(res[hz].v.vy - res[60].v.vy) < 1e-12,
       hz + ' Hz: identischer Impuls nach dem Abschuss');
  }
  ok(Math.abs(V2 - V) < 1e-12, 'die maximale Abschussgeschwindigkeit haengt nicht an der Framerate');
}

// =================================================================================
// E - TORWERTUNG: genau einmal, auf jeder Bildwiederholrate
// =================================================================================
{
  const G = {};
  for (const hz of HZ) {
    G[hz] = run(hz, 10, { balls: [{ x: 500, y: 500, vx: V * 0.9, vy: 0, owner: NEU }] }, 'fixed');
  }
  for (const hz of HZ) {
    ok(JSON.stringify(G[hz].score) === '[1,0]',
       hz + ' Hz: das Tor zaehlt genau einmal (' + G[hz].score.join(':') + ')');
    ok(G[hz].hash === G[60].hash, hz + ' Hz: identischer Zustand nach dem Tor');
  }
}

// =================================================================================
// H/I - ARENAUMBAU: gleiche Dauer in REALER Zeit, Audio genau einmal
// =================================================================================
{
  const M = {};
  for (const hz of HZ) {
    const E = buildEnv();
    E.setVariant('elimination4'); E.elimReset(); E.reset();
    for (let o = 0; o < 4; o++) E.setLives(o, 1);   // jeder auf seinem letzten Leben
    E.setBalls([{ x: 500, y: 500, vx: 0, vy: V, owner: NEU }]);
    const frameMs = 1000 / hz;
    let t = 0, mStart = null, mEnd = null;
    for (let i = 0; i < Math.round(20 * hz); i++) {
      t += frameMs;
      E.advance(t);
      const gs = E.goalState();
      if (gs === 'morph' && mStart === null) mStart = t;
      if (mStart !== null && mEnd === null && gs !== 'morph') mEnd = t;
      if (mEnd !== null) break;
    }
    M[hz] = { ms: mEnd - mStart, audio: E.taudio(), phaseN: E.phaseN() };
  }
  for (const hz of HZ) {
    // H) Der Umbau dauert 100 Ticks = 1.667 s. Toleranz: ein Renderframe bei 30 Hz.
    ok(M[hz].ms !== null && Math.abs(M[hz].ms - 100 * (1000 / 60)) <= 1000 / 30 + 1e-9,
       hz + ' Hz: der Umbau dauert ' + Math.round(M[hz].ms) + ' ms (Ziel 1667 ms)');
    // I) Bett und Einrastakzent genau einmal - keine Doppeltrigger durch schnelle Frames.
    ok(M[hz].audio.bed === 1 && M[hz].audio.lock === 1,
       hz + ' Hz: genau ein Bett und ein Einrastakzent');
    ok(M[hz].phaseN === 3, hz + ' Hz: die Arena steht danach auf drei Spielern');
  }
}

// =================================================================================
// J - PAUSE UND UEBERLAST: kein Aufhol-Turbo
// =================================================================================
{
  const S = buildEnv().sim();
  const E = buildEnv();
  E.reset();
  E.setBalls([{ x: 500, y: 500, vx: V, vy: 0, owner: NEU }]);
  let t = 0;
  for (let i = 0; i < 30; i++) { t += 1000 / 60; E.advance(t); }
  const before = E.steps();
  t += 3000;                                        // 3 Sekunden Tab im Hintergrund
  const burst = E.advance(t);
  ok(burst === 1, 'nach 3 s Pause laeuft genau EIN Schritt (' + burst + ')');
  ok(E.steps() === before + 1, 'die Pause erzeugt keine nachgeholten Sekunden');
  let after = 0;
  for (let i = 0; i < 60; i++) { t += 1000 / 60; after += E.advance(t); }
  ok(after >= 59 && after <= 61,
     'danach laeuft es sofort wieder im regulaeren Takt (' + after + ' Schritte in 60 Frames)');

  // Dauerlast weit unterhalb der Simulationsrate: das Budget deckelt jeden Frame.
  const O = buildEnv();
  O.reset();
  O.setBalls([{ x: 500, y: 500, vx: V, vy: 0, owner: NEU }]);
  let t2 = 0, worst = 0;
  for (let i = 0; i < 60; i++) { t2 += 200; worst = Math.max(worst, O.advance(t2)); }
  ok(worst <= S.maxSteps, 'bei 5 fps laeuft nie mehr als das Budget (' + worst + ' <= ' + S.maxSteps + ')');
  ok(O.finite(), 'auch unter Dauerlast entstehen keine NaN-Werte');
}

// =================================================================================
// F/G - SETTLEMENT-MATRIX: alle drei Roll-Kandidaten, alle Bildwiederholraten
// =================================================================================
{
  for (const name of ['PRODUKTIV']) {
    for (const who of ['player', 'ball']) {
      const setup = { phys: PROD,
        balls: [{ x: 500, y: 500, vx: V * 0.6, vy: V * 0.8, owner: who === 'player' ? 0 : 4 }] };
      const R = {};
      for (const hz of HZ) R[hz] = run(hz, 20, setup, 'fixed');
      for (const hz of HZ) {
        ok(R[hz].settleStep === R[60].settleStep,
           name + '/' + who + ' bei ' + hz + ' Hz: Settlement nach Schritt ' + R[hz].settleStep);
        ok(Math.abs(R[hz].path - R[60].path) < 1e-6,
           name + '/' + who + ' bei ' + hz + ' Hz: identische Streckenlaenge');
        ok(R[hz].hash === R[60].hash, name + '/' + who + ' bei ' + hz + ' Hz: identischer Endzustand');
      }
    }
  }
}


// =================================================================================
// ABSCHUSS - die Kurve bleibt auf jeder Bildwiederholrate identisch
// =================================================================================
// Die Abschusskurve erhoeht die Anfangsgeschwindigkeit deutlich. Genau dann ist wichtig,
// dass die Zeitbasis haelt: ein schnellerer Zug darf auf 144 Hz nicht anders ausgehen als
// auf 60 Hz - und der Impuls selbst darf nicht von der Framerate abhaengen.
{
  // 55 % ist die Zone, die im Spieltest als zu langsam gemeldet wurde.
  for (const frac of [0.55, 1.00]) {
    const imp = {};
    for (const hz of HZ) imp[hz] = launchImpulse(hz, frac);
    for (const hz of HZ) {
      ok(imp[hz].calls === 1,
         Math.round(frac * 100) + ' % bei ' + hz + ' Hz: der Abschuss laeuft genau einmal');
      ok(imp[hz].v && Math.abs(imp[hz].v.vx - imp[60].v.vx) < 1e-12 &&
         Math.abs(imp[hz].v.vy - imp[60].v.vy) < 1e-12,
         Math.round(frac * 100) + ' % bei ' + hz + ' Hz: identischer Abschussimpuls');
    }
  }
  // Der gesamte Zug mit voller Abschussgeschwindigkeit: gleicher Verlauf auf jeder Rate.
  const E0 = buildEnv();
  const v = E0.launchAt(1);
  const shot = { balls: [{ x: 500, y: 500, vx: v * 0.6, vy: v * 0.8, owner: NEU }] };
  const R = {};
  for (const hz of HZ) R[hz] = run(hz, 15, shot, 'fixed');
  for (const hz of HZ) {
    ok(R[hz].hash === R[60].hash, 'voller Zug bei ' + hz + ' Hz: identischer Endzustand');
    ok(R[hz].settleStep === R[60].settleStep,
       'voller Zug bei ' + hz + ' Hz: Settlement nach Schritt ' + R[hz].settleStep);
    ok(Math.abs(R[hz].path - R[60].path) < 1e-6, 'voller Zug bei ' + hz + ' Hz: identische Streckenlaenge');
    ok(R[hz].finite, 'voller Zug bei ' + hz + ' Hz: keine NaN- oder Infinity-Werte');
  }
}


// =================================================================================
// FUENF SPIELER - auch der Produktmodus haengt an derselben Zeitbasis
// =================================================================================
// Die Fuenf-Spieler-Elimination bringt eine weitere Arenaphase und eine weitere Figur
// mit. Beides darf die Zeitbasis nicht beruehren: derselbe Zug muss auf jeder
// Bildwiederholrate denselben Verlauf nehmen.
{
  const mk = () => { const E = buildEnv(); E.setVariant('elimination'); E.elimReset(); return E; };
  const P = mk();
  ok(P.players() === 5, 'der Produktmodus Elimination startet mit fuenf Spielern');
  const v = P.launchAt(1);
  // Ein Schuss quer durch die Fuenfeck-Arena, mit allen fuenf Figuren auf dem Feld.
  const setup = () => {
    const E = mk();
    E.reset();
    const B = [];
    for (let o = 0; o < 5; o++) {
      const a = -Math.PI / 2 + o * 2 * Math.PI / 5, r = 12.75 * 32;
      B.push({ x: 500 + Math.cos(a) * r, y: 500 + Math.sin(a) * r, vx: 0, vy: 0, owner: o });
    }
    B.push({ x: 500, y: 500, vx: v * 0.6, vy: v * 0.8, owner: 5 });
    E.setBalls(B);
    E.track(B.length - 1);
    return E;
  };
  const R = {};
  for (const hz of HZ) {
    const E = setup();
    const frameMs = 1000 / hz;
    let t = 0;
    for (let i = 1; i <= Math.round(15 * hz); i++) { t += frameMs; E.advance(t); }
    R[hz] = { hash: E.hash(), steps: E.steps(), settle: E.settleAt(), path: E.path(), finite: E.finite() };
  }
  for (const hz of HZ) {
    ok(R[hz].hash === R[60].hash, '5P bei ' + hz + ' Hz: identischer Endzustand (' + R[hz].hash + ')');
    ok(R[hz].settleAt === R[60].settleAt || R[hz].settle === R[60].settle,
       '5P bei ' + hz + ' Hz: Settlement nach Schritt ' + R[hz].settle);
    ok(Math.abs(R[hz].path - R[60].path) < 1e-6, '5P bei ' + hz + ' Hz: identische Streckenlaenge');
    ok(Math.abs(R[hz].steps - R[60].steps) <= 1, '5P bei ' + hz + ' Hz: dieselbe Zahl Gameplay-Schritte');
    ok(R[hz].finite, '5P bei ' + hz + ' Hz: keine NaN- oder Infinity-Werte');
  }
}


// ── HINTERGRUNDDROSSELUNG: der Online-Client muss aufholen koennen ───────────────
// Gemessen mit fuenf offenen Seiten: requestAnimationFrame laeuft dort mit etwa 1 Hz
// statt 60. Eine Runde aus einigen hundert festen Schritten braeuchte damit Minuten -
// und solange steht phase auf 'sim', der Spieler kann nicht zielen. Genau das war der
// Live-Befund nach dem Arenaumbau 5->4.
{
  const R = buildEnv();
  const S = R.sim();
  ok(S.hz === 60 && Math.abs(S.dt - 1000 / 60) < 1e-9, 'der Zeitschritt bleibt 60 Hz');

  // OFFLINE: unveraendert. Eine lange Luecke ergibt GENAU einen Schritt - kein Turbo.
  R.setOnline(false); R.resetClock();
  R.advance(1000);
  const off = R.advance(1000 + S.stall * 20);
  ok(off === 1, 'offline ergibt eine lange Pause genau einen Schritt (erhalten: ' + off + ')');
  ok(R.acc() === 0 || R.acc() < S.dt, 'offline bleibt kein Rueckstand stehen');

  // ONLINE: derselbe Sprung wird aufgeholt, in denselben festen Schritten.
  R.setOnline(true); R.resetClock();
  R.advance(1000);
  const on = R.advance(1000 + 3000);          // drei Sekunden Rueckstand
  ok(on > 150, 'online werden drei Sekunden Rueckstand in einem Frame aufgeholt (erhalten: ' + on + ')');
  ok(on === Math.floor(3000 / S.dt) || on === Math.floor(3000 / S.dt) + 1,
     'aufgeholt wird exakt die verstrichene Zeit in festen Schritten (erhalten: ' + on + ')');

  // Der Rueckstand ist gedeckelt: ein sehr langer Ausfall fuehrt nicht zu beliebig
  // vielen Schritten in einem Frame.
  R.setOnline(true); R.resetClock();
  R.advance(1000);
  const huge = R.advance(1000 + 10 * 60 * 1000);   // zehn Minuten weg
  ok(huge <= S.catchSteps, 'der Nachlauf bleibt im Budget (erhalten: ' + huge + ', Budget ' + S.catchSteps + ')');
  ok(huge <= Math.ceil(S.catchMax / S.dt) + 1,
     'gehalten wird hoechstens SIM_CATCHUP_MAX_MS Rueckstand (erhalten: ' + huge + ')');

  // Wieviel Spielzeit ein aufholender Frame wirklich deckt, begrenzt der KLEINERE der
  // beiden Werte: das Schrittbudget und der gehaltene Rueckstand. Bindend ist hier der
  // Rueckstandsdeckel - eine ganze Football-Runde passt hinein, und genau das entscheidet
  // darueber, ob der Spieler nach dem Umbau wieder zielen kann.
  const deckung = Math.min(S.catchSteps * S.dt, S.catchMax);
  ok(deckung === S.catchMax, 'bindend ist der Rueckstandsdeckel, nicht das Schrittbudget');
  ok(deckung >= 6000, 'ein aufholender Frame deckt mindestens sechs Sekunden Spielzeit (erhalten: ' + Math.round(deckung) + ' ms)');

  // Und der Zeitanker: offline wird der Rueckstand beim Sichtbarkeitswechsel verworfen,
  // online bleibt er erhalten - er ist dort die noch zu rechnende Strecke.
  R.setOnline(false); R.resetClock(); R.advance(1000); R.advance(1000 + 100);
  R.resetClock();
  ok(R.acc() === 0, 'offline loescht der Sichtbarkeitswechsel den Rueckstand');
  // Damit die Gleichheitspruefung etwas aussagt, muss ueberhaupt ein Rueckstand da sein -
  // sonst waere sie mit 0 === 0 auch dann gruen, wenn online nichts gehalten wuerde.
  R.setOnline(true); R.resetClock(); R.advance(2000);
  R.advance(2000 + 2000);
  R.setOnline(true);
  R.advance(4000 + 2000);   // zweiter Sprung: das Budget laesst Rest stehen
  const accBefore = R.acc();
  ok(accBefore > 0, 'online steht nach einem Sprung ueberhaupt ein Rueckstand (erhalten: ' + Math.round(accBefore) + ' ms)');
  R.resetClock();
  ok(R.acc() === accBefore && R.acc() > 0,
     'online bleibt dieser Rueckstand ueber den Sichtbarkeitswechsel erhalten');
}


// ── ECHTE HINTERGRUND-AUSSETZUNG: rAF setzt AUS, nicht nur gedrosselt ───────────
// Anders als bei der Drosselung laufen hier GAR KEINE Frames. Der Sichtbarkeitswechsel
// ist das einzige Ereignis, das die Seite waehrenddessen sieht. Online muss das
// verborgene Intervall danach in festen Schritten aufgeholt werden - sonst haengt der
// Client in phase 'sim' fest und kann nicht mehr zielen.
{
  const R = buildEnv();
  const S = R.sim();
  const hide = () => R.resetClock();     // visibilitychange -> hidden
  const show = () => R.resetClock();     // visibilitychange -> visible

  // (A) OFFLINE: unveraendert. Die verborgene Zeit wird NICHT nachgeholt.
  R.setOnline(false); R.resetClock();
  R.advance(1000); R.advance(1016);
  hide(); show();
  const offN = R.advance(1016 + 3000);
  ok(offN === 1, 'offline ergibt eine verborgene Pause genau einen Schritt (erhalten: ' + offN + ')');
  ok(R.acc() < S.dt, 'offline bleibt danach kein Rueckstand stehen');

  // (B) ONLINE: das verborgene Intervall wird zum Rueckstand und in festen Schritten
  // abgearbeitet.
  R.setOnline(true); R.resetClock();
  R.advance(2000); R.advance(2016);
  hide(); show();
  const onN = R.advance(2016 + 3000);
  const want = Math.floor(3000 / S.dt);
  ok(onN === want || onN === want + 1,
     'online wird das verborgene Intervall exakt in festen Schritten aufgeholt (erhalten: ' +
     onN + ', erwartet ' + want + ')');
  // (E) Aufgeholt wird in FESTEN Schritten - die Summe deckt das Intervall, es gibt
  // keinen einzelnen grossen Zeitsprung.
  ok(Math.abs(onN * S.dt - 3000) < S.dt,
     'die aufgeholte Zeit entspricht dem Intervall (kein variabler Zeitschritt)');

  // (D) Kein Doppelzaehlen: der naechste Frame holt dasselbe Intervall NICHT erneut.
  const again = R.advance(2016 + 3000 + 16);
  ok(again <= 1, 'die verborgene Zeit wird genau einmal aufgeholt (naechster Frame: ' + again + ')');

  // (C) Der Deckel gilt auch hier: ein sehr langer verborgener Zeitraum fuehrt nicht zu
  // beliebig vielen Schritten.
  R.setOnline(true); R.resetClock();
  R.advance(5000); R.advance(5016);
  hide(); show();
  const longN = R.advance(5016 + 10 * 60 * 1000);
  ok(longN <= S.catchSteps, 'verborgener Zeitraum bleibt im Schrittbudget (erhalten: ' + longN + ')');
  ok(longN <= Math.ceil(S.catchMax / S.dt) + 1,
     'verborgener Zeitraum wird durch SIM_CATCHUP_MAX_MS begrenzt (erhalten: ' + longN + ')');

  // Das Schrittbudget muss den Rueckstandsdeckel VOLLSTAENDIG abdecken. Sonst schneidet
  // das Budget den bereits gedeckelten Rueckstand ab, und der Client bliebe trotz
  // Aufholstrecke zurueck. (Ohne diese Aussage waere das Budget nicht pruefbar: der
  // Deckel greift in jedem Ablauf zuerst.)
  ok(S.catchSteps * S.dt >= S.catchMax,
     'das Schrittbudget deckt den Rueckstandsdeckel ab (' + Math.round(S.catchSteps * S.dt) +
     ' ms Budget gegen ' + S.catchMax + ' ms Deckel)');

  // Und der Zeitschritt selbst bleibt, was er war.
  ok(S.hz === 60 && Math.abs(S.dt - 1000 / 60) < 1e-9, 'der Zeitschritt bleibt 60 Hz');
}

console.log('\nFixed-Timestep: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
