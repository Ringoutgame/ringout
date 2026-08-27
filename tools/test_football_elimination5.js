// Arena Football - ELIMINATION MIT FUENF SPIELERN (Prototyp)
//
// Die Elimination startet in diesem Prototyp mit FUENF Spielern: 5 -> 4 -> 3 -> 2 -> Sieg.
// Geprueft wird, dass die bestehende Architektur das traegt - dieselbe Zwei-Leben-Regel,
// dieselbe Morph-Maschine, dieselbe Torwertung, dieselben Endformen der Phasen 4/3/2 -
// und dass die Vier-Spieler-Variante davon voellig unberuehrt bleibt.
//
// Wie alle Football-Suiten extrahiert diese hier die ECHTEN Quellen aus index.html und
// fuehrt sie in einer Sandbox aus; DOM, Audio und Renderer sind Zaehler-Stubs.
//
//   node tools/test_football_elimination5.js
//
const { loadIndexHtml, grab: grabIn } = require('./extract.js');
const HTML = loadIndexHtml();
const grab = (re, name) => grabIn(HTML, re, name);

let pass = 0, fail = 0;
let FB_R = null, FB_SANDBOX = null;   // Sandbox mit den echten Rendererquellen (Block N)
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }
// Stille Variante fuer Schleifen ueber viele Ticks: sie meldet einen Fehlschlag nur einmal
// und zaehlt im Erfolgsfall gar nicht - sonst wuerde eine einzige Invariante die
// Assertionzahl um Hunderte aufblaehen.
const ok0Seen = new Set();
function ok0(cond, msg) { if (cond) return; if (ok0Seen.has(msg)) return; ok0Seen.add(msg); fail++; console.error('FAIL: ' + msg); }
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
const speed = (b) => Math.hypot(b.vx, b.vy);
const COS30 = 0.8660254037844387;   // sqrt(3)/2 - identisch zu FB_TRI_COS30 in index.html

// -- Extraktion der echten Quellen ------------------------------------------------
const consts             = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const spin               = grab(/const SPIN_K=[^\n]*/, 'spin constants');
const pcols              = grab(/const PCOLS=[^\n]*/, 'PCOLS');
const mkBallSrc          = grab(/function mkBall\([^\n]*/, 'mkBall');
const aliveBallsSrc      = grab(/function aliveBalls\([^\n]*/, 'aliveBalls');
const teamCapSrc         = grab(/function teamCap\(\)\{[^\n]*/, 'teamCap');
const teamOfSrc          = grab(/function teamOf\(s\)\{[^\n]*/, 'teamOf');
const colorSlotSrc       = grab(/function colorSlot\(owner\)\{[^\n]*/, 'colorSlot');
const placeBallsSrc      = grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls');
const pickOwnBallSrc     = grab(/function pickOwnBall\([^\n]*/, 'pickOwnBall');
const ballsOutsideSrc    = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const npSrc              = grab(/function np\([^\n]*/, 'np');
const resetCommitsSrc    = grab(/function resetCommits\(\)\{[\s\S]*?\n  for\(let p=0;p<np\(\);p\+\+\)[^\n]*/, 'resetCommits');
const startRoundSrc      = grab(/function startRound\(\)\{[\s\S]*?\n  setPhaseText\(\);\}/, 'startRound');
const inputLockedSrc     = grab(/function inputLocked\([^\n]*/, 'inputLocked');
const canCommitSrc       = grab(/function canCommitInput\(who\)\{[\s\S]*?\n\}/, 'canCommitInput');
const sanitizeMoveSrc    = grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove');
const allCommittedSrc    = grab(/function allAliveCommitted\(\)\{[^\n]*/, 'allAliveCommitted');
const commitSrc          = grab(/function commit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'commit');
const applyCommitSrc     = grab(/function applyCommit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'applyCommit');
const applyLaunchSrc     = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
const beginRevealSrc     = grab(/function beginReveal\(\)\{[^\n]*/, 'beginReveal');
const footballBlockSrc   = grab(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nfunction stepSim\(\)\{)/, 'Football-Block');
const curFRSrc           = grab(/function curFR\(\)[^\n]*/, 'curFR');
const curFESrc           = grab(/function curFE\(\)[^\n]*/, 'curFE');
const curSTSrc           = grab(/function curST\(\)[^\n]*/, 'curST');
const stepSimSrc         = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
// Der Elimination4-Abschnitt als Ganzes - Grundlage der Struktur-Assertions weiter unten.
const elimBlockSrc       = grab(/ARENA FOOTBALL ELIMINATION [\s\S]*?\nfunction footballElimResetBall\(\)\{[\s\S]*?\n\}/, 'Elimination-Block');
const renderBarSrc       = grab(/function renderElimBar\(\)\{[\s\S]*?\n\}/, 'renderElimBar');
const startFootballSrc   = grab(/function startFootball\(variant\)\{[\s\S]*?\n\}/, 'startFootball');
const ctaSrc             = grab(/\$\('ctaBtn'\)\.onclick=\(\)=>\{[\s\S]*?\n\};/, 'CTA-Handler');
const foldSrc            = grab(/const fbFold=\{[\s\S]*?\nfunction footballCanPassGoal\(b\)\{[\s\S]*?\n\}/, 'Seitenfaltung');
const fxRenderSrc        = grab(/const goalFxParts=\[\];[\s\S]*?\n    \};/, 'Renderer-Goal-FX-Block');
const loopSrc            = grab(/function loop\(now\)\{[\s\S]*?\n\}/, 'Main Loop');
const triSDSrc           = grab(/function footballTriSD\(dx,dz,ap,rc\)\{[\s\S]*?\n\}/, 'footballTriSD');

// -- Sandbox ----------------------------------------------------------------------
// Exakt das Muster von tools/test_football_tactical.js: DOM-, Audio- und Renderer-Aufrufe
// sind Zaehler-Stubs, alles Spielrelevante kommt unveraendert aus index.html.
function buildEnv(devFbVariant) {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${consts}
    ${spin}
    ${pcols}
    const TUNE=null;
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='aim', outBall=-1, roundWinner=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false;
    let mode='football', fmt='single';
    let score=[0,0], roundNo=1, seatGone=[false,false];
    let coverCalls=[], goalSounds=0, matchPointSounds=0;
    let soundOn=true;
    let taBed=0,taLock=0,taStop=0;
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},
               footballGoal(mp){goalSounds++;if(mp)matchPointSounds++;},footballGoalPreload(){},footballGoalStop(){},
               fbTransitionBed(){taBed++;},fbTransitionLock(){taLock++;},fbTransitionStop(){taStop++;}};
    function spawn(){} function popBall(){} function winnerRGB(){return '';}
    let r3dActive=false; function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;} function updateHud(){} function setPhaseText(){}
    function onlineArmTurn(){} function openCover(pi){coverCalls.push(pi);}
    function cancelAimDrag(){}
    function devSync(){} function ejectGoneSeats(){} function onlineSendCommit(){}
    function botMove(){return {idx:-1,dx:0,dy:0};}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    let collapseEnabled=false, collapseState='running';
    function collapseActive(){return false;}
    let gameOverCalls=[];
    function gameOver(w){gameOverCalls.push(w);phase='over';}
    ${mkBallSrc}
    ${aliveBallsSrc}
    ${teamOfSrc}
    ${colorSlotSrc}
    ${teamCapSrc}
    ${placeBallsSrc}
    ${pickOwnBallSrc}
    ${ballsOutsideSrc}
    ${resolveRingOutsSrc}
    ${npSrc}
    ${resetCommitsSrc}
    ${startRoundSrc}
    ${beginRevealSrc}
    // Der ECHTE Dev-Parameterwert. Der Initialisierer von fbVariant im Football-Block liest
    // ihn ueber denselben typeof-Guard wie im Browser - der Fallback ist damit echt getestet.
    ${devFbVariant === undefined ? '' : 'const DEV_FB_VARIANT=' + JSON.stringify(devFbVariant) + ';'}
    ${footballBlockSrc}
    ${curFRSrc}
    ${curFESrc}
    ${curSTSrc}
    ${inputLockedSrc}
    ${canCommitSrc}
    ${sanitizeMoveSrc}
    ${allCommittedSrc}
    ${commitSrc}
    ${applyCommitSrc}
    ${applyLaunchSrc}
    ${stepSimSrc}
    return {
      cx, cy, BR, neutral: FOOTBALL_NEUTRAL_OWNER,
      dirs(){ return fbElimDirs().map(d=>d.slice()); },
      dirs4(){ return FOOTBALL_ELIM4_DIRS.map(d=>d.slice()); },
      // -- V3: adaptive Arena --
      phaseN(){ return fbElimPhaseN; },
      slots(){ return fbElimSlots.slice(0,fbElimPlayers()); },
      slotOwner(s){ return fbElimSlotOwner(s); },
      applyPhase(){ return fbElimApplyPhase(); },
      spawnAt(slot){ return {x:fbElimSpawnX(slot),y:fbElimSpawnY(slot)}; },
      viewR(){ return fbElimViewR(); },
      // Reiner Geometrie-Hook fuer die Formvermessung: setzt die Phase OHNE Spielablauf.
      forcePhase(n){ fbElimPhaseN=n; },
      // owner 0 = Spielerradius (32), neutral = Ballradius (25).
      boundSDAt(x,y,neutral){ const b={x,y,owner:neutral?FOOTBALL_NEUTRAL_OWNER:0,alive:true};
                              const s=footballBoundSD(b); return {sd:s.sd,nx:s.nx,nz:s.nz}; },
      // Einen Koerper mit Startlage und Geschwindigkeit gegen die Bande schiessen und
      // beobachten, ob er die Arena in IRGENDEINEM Schritt verlaesst.
      slam(idx,x0,y0,vx,vy,steps){
        phase='sim';
        balls[idx].x=x0;balls[idx].y=y0;balls[idx].vx=vx;balls[idx].vy=vy;
        balls[idx].fbPassed=false;
        let worst=-Infinity,fin=true;
        for(let k=0;k<steps;k++){
          stepSim();
          if(fbGoalState!=='play')break;
          const b=balls[idx];
          if(!Number.isFinite(b.x)||!Number.isFinite(b.y)){fin=false;break;}
          // Ein durch eine Toroeffnung ausgetretener Ball ist regulaer draussen - ab da
          // beschreibt die Grenze ihn nicht mehr.
          if(b.fbPassed)break;
          const s=footballBoundSD(b).sd;
          if(s>worst)worst=s;
        }
        return {worst,fin,passed:!!balls[idx].fbPassed,
                d:Math.hypot(balls[idx].x-cx,balls[idx].y-cy)};
      },
      postClear(i){ const p=footballPostProbe(balls[i]); return !p||p.d>=ballRad(balls[i])-1e-6; },
      arenaCfg(){ const a=fbArena(); return {poly:a.poly?a.poly.map(v=>v.slice()):null,
                     halfLen:a.halfLen,halfWid:a.halfWid,corner:a.corner,
                     spawn:a.spawn,sides:a.sides,tri:!!a.tri,postInner:a.postInner,postOuter:a.postOuter,
                     postFront:a.postFront,postBack:a.postBack,goalAnchor:a.goalAnchor}; },
      arena(){ return {halfLen:fbHalfLen(), halfWid:fbHalfWid(), corner:fbCorner(),
                       clearHalf:footballGoalClearHalf(), centerHalf:footballGoalCenterHalf()}; },
      setVariant(v){ fbVariant=v; }, variant(){ return fbVariant; },
      setMode(m){ mode=m; },
      elim(){ return fbElim4(); }, tactical(){ return fbTactical(); },
      np(){ return np(); }, teamCap(){ return teamCap(); },
      // -- Aufstellung --
      place(){ placeBalls(); return this.snapshot(); },
      snapshot(){ return balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,owner:b.owner,alive:b.alive,passed:!!b.fbPassed})); },
      rad(i){ return ballRad(balls[i]); },
      boundSD(i){ return footballBoundSD(balls[i]).sd; },
      ringLevel(i){ return fbTacticalRingLevel(i); },
      sel(){ return fbSel.slice(); },
      // -- Faltung / Torgeometrie --
      fold(dx,dy){ const f=footballFold(dx,dy); return {x:f.x,y:f.y,cs:f.cs,sn:f.sn,side:f.side}; },
      goalOpen(s){ return footballGoalOpen(s); },
      canPass(i){ return footballCanPassGoal(balls[i]); },
      crossed(i){ return footballGoalCrossed(balls[i]); },
      goalSide(i){ return footballGoalSide(balls[i]); },
      // -- Commit / Reveal --
      curAimer(){ return curAimer; },
      phase(){ return phase; },
      aimSet(){ return aimSet.slice(); },
      commitIdx(){ return commitIdx.slice(); },
      coverCalls(){ return coverCalls.slice(); },
      resetCoverCalls(){ coverCalls=[]; },
      canCommit(who){ return canCommitInput(who); },
      newMatch(){ footballResetMatchState(); startRound(); coverCalls=[]; },
      lives(){ return fbElimLives.slice(0,fbElimPlayers()); },
      setLives(o,n){ fbElimLives[o]=n; },
      playerCount(){ return fbElimPlayers(); },
      matchPoint(){ for(let o=0;o<fbElimPlayers();o++)if(fbElimActive[o])fbElimLives[o]=1; },
      startRound(){ startRound(); },
      commit(who,idx,fx,fy){ commit(who,idx,fx,fy,0); },
      launch(){ applyLaunch(); },
      step(){ stepSim(); },
      settle(maxFrames){ let n=0; const lim=maxFrames||6000;
        while(phase!=='aim'&&phase!=='over'&&n<lim){ stepSim(); n++; }
        return n; },
      stepUntilGoal(maxFrames){ let n=0; const lim=maxFrames||1200;
        while(fbGoalState==='play'&&phase==='sim'&&n<lim){ stepSim(); n++; }
        return n; },
      finishGoal(maxFrames){ let n=0; const lim=maxFrames||600;
        while(fbGoalState!=='play'&&fbGoalState!=='result'&&n<lim){ stepSim(); n++; }
        return n; },
      // -- Elimination-Zustand --
      active(){ return fbElimActive.slice(0,fbElimPlayers()); },
      activeOwners(){ return fbElimActiveOwners(); },
      headText(){ return fbElimHeadText(); },
      firstAimer(){ return fbElimFirstAimer(); },
      eliminate(o){ footballElimEliminate(o); },
      concede(o){ footballElimConcede(o); },
      resetBall(){ footballElimResetBall(); },
      // -- Tor / Match --
      goalState(){ return fbGoalState; },
      goalTick(){ return fbGoalTick; },
      goalBusy(){ return footballGoalBusy(); },
      // -- Arena-Transition 4 -> 3 (rein visuell) --
      morphActive(){ return fbMorphActive(); },
      morphE(){ return fbMorphE(); },
      goalE(){ return fbMorphGoalE(); },
      arenaE(){ return fbMorphArenaE(); },
      viewR(){ return fbElimViewR(); },
      morphPlan(){ return fbMorphPlan?fbMorphPlan.goals.map(g=>({owner:g.owner,slot:g.slot,target:g.target,dead:g.dead})):null; },
      morphPhases(){ return fbMorphPlan?{from:fbMorphPlan.from,to:fbMorphPlan.to}:null; },
      morphSpawn(){ return fbMorphSpawn; },
      // Transition-Audio: Ausloeserzaehler der Sandbox (die Wiedergabe selbst ist gestubbt).
      taudio(){ return {bed:taBed,lock:taLock,stop:taStop}; },
      taudioReset(){ taBed=0;taLock=0;taStop=0; },
      // Stummschalten wie im Spiel: der Ausloeser laeuft weiter, nur die Wiedergabe faellt weg.
      muteAudio(){ soundOn=false; },
      // Transition-FX: rein visuelle Pegel, nirgends im Spielzustand.
      fxOn(){ return !!FB_FX_PRESET; },
      fxEdge(t){ return fbFxEdge(t); },
      fxDrain(slot){ return fbFxDrain(slot); },
      morphWanted(){ return fbMorphWanted(); },
      bodyLevel(){ return fbMorphBodyLevel(); },
      morphTicks(){ return {hold:FB_MORPH_HOLD_TICKS,goals:FB_MORPH_GOAL_TICKS,
                            arena:FB_MORPH_ARENA_TICKS,settle:FB_MORPH_SETTLE_TICKS,
                            total:FB_MORPH_TICKS,body:FB_MORPH_BODY_TICKS,
                            overshoot:FB_MORPH_OVERSHOOT}; },
      winner(){ return footballWinner; },
      overCalls(){ return gameOverCalls.slice(); },
      goalSounds(){ return goalSounds; },
      matchPointSounds(){ return matchPointSounds; },
      fxSide(){ return fbGoalFxSide; },
      fxKey(){ return footballGoalFxKey(); },
      score(){ return score.slice(); },
      resetMatchState(){ footballResetMatchState(); },
      // -- Direkte Zustandsmanipulation fuer Szenarien --
      setVel(i,vx,vy){ balls[i].vx=vx; balls[i].vy=vy; },
      setPos(i,x,y){ balls[i].x=x; balls[i].y=y; },
      setPhaseRaw(p){ phase=p; },
      hash(){ let h=2166136261>>>0;
        const mix=s=>{for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}};
        for(const b of balls)mix(b.owner+':'+(b.alive?1:0)+':'+b.x+':'+b.y+':'+b.vx+':'+b.vy+';');
        mix('|'+fbElimActive.map(v=>v?1:0).join('')+'|'+fbElimSlots.join(',')+'|'+fbElimPhaseN+'|'+phase+'|'+fbGoalState+'|'+footballWinner);
        return ('0000000'+h.toString(16)).slice(-8); },
      finite(){ for(const b of balls){ if(!Number.isFinite(b.x)||!Number.isFinite(b.y)||
                  !Number.isFinite(b.vx)||!Number.isFinite(b.vy))return false; } return true; },
    };
  `;
  return new Function(env)();
}

// Aktive Figuren ZWISCHEN die Torachsen der aktiven Phase stellen - dort steht keine im
// Torkorridor und keine im Weg eines Schusses entlang einer Torachse. Bei zwei exakt
// gegenueberliegenden Toren gibt es keine Winkelhalbierende; dort wird quer zur Achse geparkt.
function parkPlayers(E) {
  // ZWEI LEBEN: ein Gegentor kostet nur ein Leben. Alle folgenden Bloecke pruefen die
  // ELIMINIERUNGSmechanik (Umbau, Torslots, Sieg, FX, Audio) und brauchen dafuer den
  // Zustand, in dem das naechste Gegentor ausscheidet. Deshalb stellt dieser Helfer
  // nicht nur die Figuren neutral auf, sondern setzt jeden aktiven Spieler zugleich auf
  // sein LETZTES Leben - fuer die Mechanik dahinter ist das exakt der alte Zustand
  // 'ein Gegentor = raus'. Die Zwei-Leben-Regel selbst prueft Block W ohne diesen Helfer.
  E.matchPoint();
  const act = E.active(), D = E.dirs(), n = D.length, r = E.BR * 7;
  let i = 0;
  // Ueber ALLE Spieler des Matches, nicht ueber eine feste Vier: sonst bliebe ein
  // fuenfter Spieler auf seinem Spawn stehen - mitten im Schusskanal seines Tores.
  for (let o = 0; o < E.playerCount(); o++) {
    if (!act[o]) continue;
    const a = D[i % n], b = D[(i + 1) % n];
    let vx = a[0] + b[0], vy = a[1] + b[1];
    if (Math.hypot(vx, vy) < 1e-9) { vx = -a[1]; vy = a[0]; }
    const l = Math.hypot(vx, vy) || 1;
    E.setPos(o, E.cx + (vx / l) * r, E.cy + (vy / l) * r);
    E.setVel(o, 0, 0);
    i++;
  }
}
// Neutralen Ball vom Zentrum entlang der Torachse von `slot` schiessen und bis zur
// Torentscheidung simulieren. Rueckgabe: Anzahl der Frames.
function shootAt(E, slot, sp) {
  const d = E.dirs()[slot], v = sp == null ? 22 : sp;
  // Der neutrale Ball wird ueber seinen OWNER gesucht, nicht ueber einen festen Index:
  // mit fuenf Spielern liegt er an Position 5 statt 4.
  const n = E.snapshot().findIndex((b) => b.owner === E.neutral);
  E.setPos(n, E.cx, E.cy);
  E.setVel(n, d[0] * v, d[1] * v);
  E.setPhaseRaw('sim');
  return E.stepUntilGoal();
}
// Ein vollstaendiges Tor inklusive Torablauf: schiessen, werten, Arena umbauen, Ball zurueck
// ins Zentrum, neue verdeckte Runde. Rueckgabe: true, wenn danach wieder geplant wird.
function scoreOn(E, slot) {
  parkPlayers(E);
  shootAt(E, slot);
  E.finishGoal();
  if (E.winner() !== null) return false;
  E.step();   // regulaeres Settlement oeffnet die naechste verdeckte Runde
  return E.phase() === 'aim';
}
// Die Bloecke, die die ELIMINIERUNG pruefen, brauchen den Zustand "letztes Leben" -
// parkPlayers stellt ihn her. Wo die ZWEI-LEBEN-Regel selbst geprueft wird, setzt
// parkFull die Leben danach ausdruecklich wieder auf den Produktstand.
const parkFull = (E) => {
  parkPlayers(E);
  for (let o = 0; o < E.playerCount(); o++) if (E.active()[o]) E.setLives(o, 2);
};

console.log('ARENA FOOTBALL - ELIMINATION MIT FUENF SPIELERN\n');

const E5 = () => buildEnv('elimination');
const E4 = () => buildEnv('elimination4');
const DEG = (d) => (d[0] === 0 && d[1] === -1) ? -90 : Math.atan2(d[1], d[0]) * 180 / Math.PI;
// Bis zum Beginn des Umbaus ticken - dort steht der Plan, bevor er wieder verworfen wird.
const untilMorph = (E) => { for (let i = 0; i < 600 && E.goalState() !== 'morph'; i++) E.step(); };

// =================================================================================
// A - AUSGANGSZUSTAND: FUENF SPIELER, FUENF TORE, FUENF SPAWNS
// =================================================================================
{
  const E = E5();
  E.newMatch();
  ok(E.variant() === 'elimination', 'die Variante ist der Produktmodus elimination');
  ok(E.elim() === true, 'die Elimination-Regeln gelten');
  ok(E.np() === 5, 'np() liefert fuenf Spieler');
  ok(E.phaseN() === 5, 'die Fuenf-Spieler-Arena steht');
  ok(JSON.stringify(E.active()) === '[true,true,true,true,true]', 'alle fuenf Spieler sind aktiv');
  ok(JSON.stringify(E.lives()) === '[2,2,2,2,2]', 'jeder Spieler startet mit zwei Leben');
  ok(JSON.stringify(E.slots()) === '[0,1,2,3,4]', 'jeder Spieler besitzt genau ein Tor');

  const D = E.dirs();
  ok(D.length === 5, 'die Arena hat fuenf Torrichtungen');
  // Exakt 72 Grad Abstand, Slot 0 im Norden wie in allen anderen Phasen.
  ok(Math.abs(D[0][0]) < 1e-15 && Math.abs(D[0][1] + 1) < 1e-15, 'Slot 0 zeigt exakt nach Norden');
  for (let k = 0; k < 5; k++) {
    const a = DEG(D[k]), b = DEG(D[(k + 1) % 5]);
    let d = b - a; while (d <= -180) d += 360; while (d > 180) d -= 360;
    ok(Math.abs(Math.abs(d) - 72) < 1e-9,
       'Torachse ' + k + ' -> ' + ((k + 1) % 5) + ' steht exakt 72 Grad weiter (' + d.toFixed(9) + ')');
    ok(Math.abs(Math.hypot(D[k][0], D[k][1]) - 1) < 1e-15, 'Torrichtung ' + k + ' ist ein Einheitsvektor');
  }
  // Spiegelsymmetrie der Richtungspaare - Folge der exakten Literale.
  ok(D[1][0] === -D[4][0] && D[1][1] === D[4][1], 'die Torachsen 1 und 4 sind exakt gespiegelt');
  ok(D[2][0] === -D[3][0] && D[2][1] === D[3][1], 'die Torachsen 2 und 3 sind exakt gespiegelt');

  // Aufstellung: fuenf Figuren plus neutraler Ball.
  const bodies = E.snapshot();
  ok(bodies.length === 6, 'fuenf Figuren und ein neutraler Ball');
  ok(bodies[5].owner === E.neutral && near(bodies[5].x, E.cx) && near(bodies[5].y, E.cy),
     'der neutrale Ball liegt exakt im Zentrum');
  ok(E.neutral === 5, 'der neutrale Ball hat einen eigenen Owner-Index (nicht die fuenfte Spielerfarbe)');
  const r0 = Math.hypot(bodies[0].x - E.cx, bodies[0].y - E.cy);
  for (let o = 0; o < 5; o++) {
    const b = bodies[o];
    ok(b.owner === o, 'Figur ' + o + ' gehoert Spieler P' + (o + 1));
    const sp = E.spawnAt(o);
    ok(near(b.x, sp.x) && near(b.y, sp.y), 'P' + (o + 1) + ' steht auf dem kanonischen Spawn');
    ok(near(Math.hypot(b.x - E.cx, b.y - E.cy), r0, 1e-9),
       'P' + (o + 1) + ' hat denselben Abstand zum Zentrum');
    ok(E.boundSD(o) < 0, 'P' + (o + 1) + ' steht innerhalb der Bande');
    const f = E.fold(b.x - E.cx, b.y - E.cy);
    ok(f.side === o, 'P' + (o + 1) + ' steht vor dem eigenen Tor (Slot ' + f.side + ')');
    ok(E.goalOpen(o) === true, 'das Tor von P' + (o + 1) + ' ist offen');
  }
  // Keine Ueberlappung - weder untereinander noch mit dem Ball.
  for (let i = 0; i < 6; i++)
    for (let j = i + 1; j < 6; j++) {
      const d = Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y);
      ok(d > E.rad(i) + E.rad(j), 'Koerper ' + i + ' und ' + j + ' beruehren sich beim Start nicht');
    }
  // Verdeckte Zugkette ueber alle fuenf Spieler.
  ok(JSON.stringify(E.aimSet()) === '[false,false,false,false,false]', 'fuenf offene Commits');
  ok(E.firstAimer() === 0, 'die verdeckte Runde beginnt bei P1');
}

// =================================================================================
// B - GEOMETRIE DER FUENF-SPIELER-ARENA
// =================================================================================
{
  const E = E5();
  E.newMatch();
  const a = E.arenaCfg();
  ok(a.sides === 5, 'die Arena ist als Fuenf-Tore-Form gekennzeichnet');
  ok(Array.isArray(a.poly), 'die Grenze ist ein konvexes Kernpolygon');
  ok(a.poly.length === 10,
     'der Kern des Broad Rounded Pentagon hat zehn Ecken: ' + a.poly.length);
  ok(a.halfLen === 19.50 && a.halfWid === 19.50 && a.corner === 3.50 && a.spawn === 12.75,
     'Basismass 19.50 BR, Eckradius 3.50 BR, Spawnradius 12.75 BR');
  ok(a.postInner === 3.560 && a.postOuter === 5.282, 'die Torwerte sind unveraendert uebernommen');
  ok(a.postFront === a.halfLen, 'das Tor sitzt buendig auf der Bandeninnenflaeche');
  ok(Math.abs(E.arena().clearHalf * 2 - 227.84) < 1e-9, 'die lichte Torbreite bleibt 227.84');
  // Das gerade Seitensegment muss ueber die Sockelaussenkante hinausreichen, sonst raegt
  // das Tor in eine Ecke.
  const D = E.dirs(), flat = (dir) => {
    const nx = dir[0], nz = dir[1], tx = -nz, tz = nx;
    const wall = (t) => { let lo = 0, hi = 1400;
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2;
        if (E.boundSDAt(E.cx + nx * m + tx * t, E.cy + nz * m + tz * t, true).sd <= 0) lo = m; else hi = m; }
      return lo; };
    const d0 = wall(0); let t = 0;
    while (t < 900 && Math.abs(wall(t) - d0) < 0.05) t += 1;
    return t;
  };
  const f0 = flat(D[0]);
  ok(f0 > a.postOuter * E.BR,
     'das gerade Seitensegment (' + Math.round(f0) + ' px) reicht ueber die Sockelaussenkante (' +
     Math.round(a.postOuter * E.BR) + ' px) hinaus');
  // 72-Grad-Symmetrie der GRENZE, nicht nur der Richtungen.
  let worst = 0;
  for (let k = 0; k < 360; k++) {
    const th = (k / 360) * 2 * Math.PI, ray = (t) => {
      let lo = 0, hi = 1400;
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2;
        if (E.boundSDAt(E.cx + Math.cos(t) * m, E.cy + Math.sin(t) * m, true).sd <= 0) lo = m; else hi = m; }
      return lo; };
    worst = Math.max(worst, Math.abs(ray(th) - ray(th + 2 * Math.PI / 5)));
  }
  ok(worst < 1e-6, 'die Grenze reproduziert sich unter 72-Grad-Drehung exakt (' + worst.toExponential(2) + ' px)');
}

// =================================================================================
// C - ERSTER STRIKE: 2 -> 1, DIE ARENA BLEIBT
// =================================================================================
{
  const E = E5();
  E.newMatch();
  parkFull(E);
  E.taudioReset();
  const g0 = E.goalSounds();
  shootAt(E, 2);                                    // Slot 2 == P3
  ok(E.goalState() === 'fall', 'der regulaere Torablauf startet');
  ok(E.lives()[2] === 1, 'P3 verliert genau ein Leben (2 -> 1)');
  ok(JSON.stringify(E.lives()) === '[2,2,1,2,2]', 'kein anderer Spieler verliert ein Leben');
  ok(E.active()[2] === true, 'P3 bleibt aktiv');
  ok(E.activeOwners().length === 5, 'es sind weiterhin fuenf Spieler aktiv');
  ok(E.goalOpen(2) === true, 'das getroffene Tor bleibt offen - kein totes Tor');
  ok(E.morphWanted() === false, 'kein Arenaumbau nach dem ersten Gegentor');
  ok(E.goalSounds() === g0 + 1, 'der normale Torsound laeuft genau einmal');

  E.finishGoal();
  ok(E.phaseN() === 5, 'die Arena bleibt die Fuenf-Spieler-Arena');
  ok(JSON.stringify(E.taudio()) === JSON.stringify({ bed: 0, lock: 0, stop: 0 }),
     'kein Transitions-Audio');
  ok([0, 1, 2, 3, 4].every((k) => E.fxDrain(k) === 0), 'kein Transitions-FX an irgendeinem Tor');
  ok(E.morphPlan() === null, 'es gibt keinen Umbauplan');
  // Fairer Reset ALLER fuenf Figuren.
  const after = E.snapshot();
  for (let s = 0; s < 5; s++) {
    const o = E.slotOwner(s), sp = E.spawnAt(s);
    ok(near(after[o].x, sp.x) && near(after[o].y, sp.y),
       'P' + (o + 1) + ' steht nach dem ersten Gegentor auf dem fairen Spawn');
  }
  ok(after.every((b) => b.vx === 0 && b.vy === 0), 'alle Geschwindigkeiten sind null');
  ok(near(after[5].x, E.cx) && near(after[5].y, E.cy) && after[5].passed === false,
     'der neutrale Ball steht wieder zentral');
  E.step();
  ok(E.phase() === 'aim', 'die naechste verdeckte Runde oeffnet regulaer');
  ok(JSON.stringify(E.aimSet()) === '[false,false,false,false,false]', 'wieder fuenf offene Commits');
}

// =================================================================================
// D - ERSTE ELIMINIERUNG UND DER UMBAU 5 -> 4
// =================================================================================
{
  const E = E5();
  E.newMatch();
  parkPlayers(E);                                   // alle auf ihrem letzten Leben
  E.setLives(1, 2); E.setLives(3, 2);               // P2 und P4 mit zwei Leben
  E.taudioReset();
  shootAt(E, 2);                                    // P3 kassiert das entscheidende Tor
  ok(E.lives()[2] === 0 && E.active()[2] === false, 'P3 ist ausgeschieden');
  ok(E.snapshot()[2].alive === false, 'die Figur von P3 ist deaktiviert');
  ok(E.goalOpen(2) === false, 'das Tor von P3 ist ab sofort geschlossen');
  ok(E.morphWanted() === true, 'der Arenaumbau wird gewollt');

  // Der Umbauplan traegt alle fuenf Tore und genau ein totes.
  untilMorph(E);
  const plan = E.morphPlan();
  ok(plan && plan.length === 5, 'der Plan kennt alle fuenf Tore der alten Arena');
  ok(plan.filter((g) => g.dead).length === 1, 'genau ein Tor ist tot');
  ok(plan.find((g) => g.owner === 2).dead === true, 'das tote Tor gehoert P3');
  const ph = E.morphPhases();
  ok(ph.from === 5 && ph.to === 4, 'der Umbau laeuft von Phase 5 auf Phase 4');

  E.finishGoal();
  ok(E.phaseN() === 4, 'danach steht die Vier-Spieler-Arena');
  ok(E.taudio().bed === 1 && E.taudio().lock === 1, 'genau ein Bett und ein Einrastakzent');
  ok(E.lives()[1] === 2 && E.lives()[3] === 2 && E.lives()[0] === 1 && E.lives()[4] === 1,
     'die Lebensstaende der Ueberlebenden bleiben ueber den Umbau erhalten (' + E.lives().join(',') + ')');
  ok(E.lives()[2] === 0, 'der Ausgeschiedene bleibt bei null Leben');
  ok(JSON.stringify(E.active()) === '[true,true,false,true,true]', 'nur P3 ist ausgeschieden');
  // Endform EXAKT die bestehende Vier-Spieler-Arena.
  const a4 = E.arenaCfg(), R4 = E4(); R4.newMatch();
  const b4 = R4.arenaCfg();
  ok(a4.halfLen === b4.halfLen && a4.halfWid === b4.halfWid && a4.corner === b4.corner &&
     a4.spawn === b4.spawn && a4.sides === b4.sides,
     'die Endform ist exakt die bestehende Vier-Spieler-Arena');
  // Spawns EXAKT die kanonischen Vier-Spieler-Spawns.
  const after = E.snapshot();
  for (let s = 0; s < 4; s++) {
    const o = E.slotOwner(s), sp = E.spawnAt(s);
    ok(o >= 0 && near(after[o].x, sp.x) && near(after[o].y, sp.y),
       'P' + (o + 1) + ' steht auf dem kanonischen Vier-Spieler-Spawn');
  }
  ok(after.every((b) => !b.alive || (b.vx === 0 && b.vy === 0)),
     'kein Ueberlebender behaelt Geschwindigkeit aus der Fuenf-Spieler-Phase');
  ok(near(after[5].x, E.cx) && near(after[5].y, E.cy), 'der Ball faellt zentral');
  E.step();
  ok(E.phase() === 'aim', 'die naechste Runde oeffnet mit vier Spielern');
  ok(E.aimSet().filter((v) => !v).length === 5, 'die Commitliste behaelt die Startlaenge des Matches');
  ok(E.coverCalls().length > 0 && E.coverCalls()[0] === E.firstAimer(),
     'die verdeckte Runde beginnt beim ersten noch aktiven Spieler');
}

// =================================================================================
// E - ALLE FUENF ELIMINIERUNGSFAELLE
// =================================================================================
{
  const R4 = E4(); R4.newMatch();
  const A4 = R4.arenaCfg(), D4 = R4.dirs();
  const R5 = E5(); R5.newMatch();
  const FIVE_DIRS = R5.dirs();
  for (let victim = 0; victim < 5; victim++) {
    const E = E5();
    E.newMatch();
    parkPlayers(E);
    shootAt(E, victim);
    ok(E.active()[victim] === false, 'Fall P' + (victim + 1) + ': der Getroffene scheidet aus');
    untilMorph(E);
    const plan = E.morphPlan(), from = FIVE_DIRS, to = D4;
    // Jedes ueberlebende Tor bekommt genau ein Ziel, kein Ziel doppelt.
    const targets = plan.filter((g) => !g.dead).map((g) => g.target);
    ok(targets.length === 4, 'Fall P' + (victim + 1) + ': vier Tore ueberleben');
    ok(new Set(targets).size === 4, 'Fall P' + (victim + 1) + ': kein Zielslot doppelt belegt');
    // Die Identitaet bleibt: aufsteigend sortierte Ueberlebende auf die Slots 0..3.
    const surv = [0, 1, 2, 3, 4].filter((o) => o !== victim);
    for (const g of plan.filter((x) => !x.dead))
      ok(surv[g.target] === g.owner,
         'Fall P' + (victim + 1) + ': P' + (g.owner + 1) + ' behaelt seine Toridentitaet');
    // KEIN TOR UEBERHOLT EIN ANDERES. Jedes Tor laeuft auf der kuerzesten Winkelroute von
    // seiner Ausgangs- zu seiner Zielachse. Die Tore duerfen ihre zyklische Reihenfolge
    // dabei nicht vertauschen. Geprueft wird auf der ABGEWICKELTEN Winkelfolge: die
    // Startwinkel werden in zyklischer Reihenfolge streng steigend aufgerollt, dieselbe
    // Verschiebung wird angewandt, und die Folge muss zu JEDEM Zeitpunkt steigend bleiben.
    // (Eine Pruefung auf die auf +-PI normierte Differenz waere falsch - dort springt das
    // Vorzeichen allein durch den Umlauf, ohne dass sich zwei Tore ueberholen.)
    const live = plan.filter((g) => !g.dead)
      .sort((a, b) => a.slot - b.slot)
      .map((g) => {
        const a0 = Math.atan2(from[g.slot][1], from[g.slot][0]);
        let d = Math.atan2(to[g.target][1], to[g.target][0]) - a0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return { a0, d, owner: g.owner };
      });
    // Startwinkel streng steigend abwickeln (die Slots liegen bereits in zyklischer Ordnung).
    for (let i = 1; i < live.length; i++)
      while (live[i].a0 <= live[i - 1].a0) live[i].a0 += 2 * Math.PI;
    let crossed = false, minGap = Infinity;
    for (let k = 0; k <= 60; k++) {
      const t = k / 60;
      for (let i = 1; i < live.length; i++) {
        const gap = (live[i].a0 + live[i].d * t) - (live[i - 1].a0 + live[i - 1].d * t);
        minGap = Math.min(minGap, gap);
        if (gap <= 1e-12) crossed = true;
      }
    }
    ok(!crossed, 'Fall P' + (victim + 1) + ': kein Tor ueberholt ein anderes (kleinster Abstand ' +
       (minGap * 180 / Math.PI).toFixed(1) + ' Grad)');
    // Jede Route bleibt eine echte Kurzstrecke - kein Tor laeuft ueber eine halbe Umdrehung.
    for (const l of live)
      ok(Math.abs(l.d) <= Math.PI + 1e-9,
         'Fall P' + (victim + 1) + ': P' + (l.owner + 1) + ' laeuft die kuerzeste Route (' +
         (l.d * 180 / Math.PI).toFixed(1) + ' Grad)');
    E.finishGoal();
    const a = E.arenaCfg();
    ok(a.halfLen === A4.halfLen && a.halfWid === A4.halfWid && a.corner === A4.corner &&
       a.spawn === A4.spawn, 'Fall P' + (victim + 1) + ': Endform exakt die Vier-Spieler-Arena');
    ok(E.phaseN() === 4 && E.activeOwners().length === 4,
       'Fall P' + (victim + 1) + ': vier Spieler in Phase 4');
    for (let s = 0; s < 4; s++)
      ok(E.slotOwner(s) === surv[s], 'Fall P' + (victim + 1) + ': Slot ' + s + ' gehoert P' + (surv[s] + 1));
  }
}

// =================================================================================
// F - VOLLES MATCH 5 -> 4 -> 3 -> 2 -> SIEGER
// =================================================================================
{
  const E = E5();
  E.newMatch();
  ok(E.phaseN() === 5, 'Start: fuenf Spieler');
  // Erster Strike, dann Eliminierung.
  parkFull(E);
  shootAt(E, 1); E.finishGoal(); E.step();
  ok(E.phaseN() === 5 && E.lives()[1] === 1, 'nach dem Strike bleibt es bei fuenf Spielern');
  parkFull(E); E.setLives(1, 1);
  shootAt(E, 1); E.finishGoal(); E.step();
  ok(E.phaseN() === 4, '5 -> 4 nach der ersten Eliminierung');
  const livesAfter5 = E.lives().slice();
  parkPlayers(E);
  E.setLives(3, 2);
  const slot4 = E.slots().indexOf(0);
  shootAt(E, slot4); E.finishGoal(); E.step();
  ok(E.phaseN() === 3, '4 -> 3 laeuft unveraendert');
  ok(E.lives()[3] === 2, 'ein Ueberlebender behaelt seine zwei Leben ueber zwei Umbauten');
  parkPlayers(E);
  const slotAny = E.slots().findIndex((o) => o >= 0 && E.lives()[o] === 1);
  shootAt(E, Math.max(0, slotAny)); E.finishGoal(); E.step();
  ok(E.phaseN() === 2, '3 -> 2 laeuft unveraendert');
  ok(E.winner() === null, 'im Finale steht noch kein Sieger fest');
  parkPlayers(E);
  shootAt(E, 0); E.finishGoal();
  ok(E.winner() !== null, 'der letzte verbliebene Spieler gewinnt');
  ok(E.activeOwners().length === 1, 'genau ein Spieler ist noch aktiv');
  ok(E.overCalls().length === 1, 'das Matchende laeuft ueber die bestehende Result-Struktur');
  void livesAfter5;
}

// =================================================================================
// G - MATCHRESET UND ABGRENZUNG ZU DEN ANDEREN MODI
// =================================================================================
{
  const E = E5();
  E.newMatch();
  parkFull(E);
  shootAt(E, 0); E.finishGoal(); E.step();
  ok(E.lives()[0] === 1, 'Vorbedingung: P1 steht auf einem Leben');
  E.resetMatchState();
  ok(JSON.stringify(E.lives()) === '[2,2,2,2,2]', 'der Matchreset stellt alle fuenf Leben wieder her');
  ok(JSON.stringify(E.active()) === '[true,true,true,true,true]', 'alle fuenf Spieler sind wieder aktiv');
  ok(E.phaseN() === 5, 'die Arena steht wieder auf fuenf Spielern');

  // Die Vier-Spieler-Variante ist voellig unberuehrt.
  const F = E4();
  F.newMatch();
  ok(F.np() === 4 && F.phaseN() === 4, 'Elimination4 startet unveraendert mit vier Spielern');
  ok(JSON.stringify(F.lives()) === '[2,2,2,2]', 'Elimination4 hat weiterhin vier Lebenseintraege');
  ok(JSON.stringify(F.active()) === '[true,true,true,true]', 'Elimination4 hat vier aktive Spieler');
  ok(F.dirs().length === 4, 'Elimination4 hat vier Torrichtungen');
  // Classic und Tactical kennen die Elimination gar nicht.
  for (const v of [undefined, 'tactical']) {
    const C = buildEnv(v);
    C.newMatch();
    ok(C.elim() === false, (v || 'classic') + ': die Elimination-Regeln gelten nicht');
    ok(C.np() === 2, (v || 'classic') + ': zwei Spieler');
  }
}

// =================================================================================
// H - QUELLENSTRUKTUR: EINE ARCHITEKTUR, KEINE FUENF-SPIELER-SONDERENGINE
// =================================================================================
{
  ok(/const FOOTBALL_VARIANT_ELIM='elimination';/.test(HTML), 'der Produktmodus ist benannt definiert');
  ok(/const FOOTBALL_ELIM_START_PLAYERS=5;/.test(HTML), 'die Elimination startet mit fuenf Spielern');
  ok(/function fbElimPlayers\(\)\{return fbVariant===FOOTBALL_VARIANT_ELIM4\?FOOTBALL_ELIM4_PLAYERS:FOOTBALL_ELIM_START_PLAYERS;\}/.test(HTML),
     'die Startspielerzahl kommt aus genau einer Funktion');
  // Es gibt genau EINE Fuenf-Spieler-Arena - kein Kandidatenvergleich mehr im Produktcode.
  ok(!/DEV_S5|ELIM5_REGULAR|ELIM5_BROAD|fbRegularPoly/.test(HTML),
     'kein Rest der Kandidatenauswahl (s5 / REGULAR / BROAD) im Produktcode');
  ok(/const FOOTBALL_ARENA_ELIM5=Object\.assign\(\s*\n\s*fbShape\(19\.50,19\.50,3\.50,12\.75,5,false,FOOTBALL_ELIM5_DIRS\),\s*\n\s*\{poly:fbTruncPoly\(FOOTBALL_ELIM5_DIRS,FB_P5_VERT,19\.50,3\.50,1\.14\)\}\);/.test(HTML),
     'die Fuenf-Spieler-Arena ist genau der gekappte Pentagon mit Faktor 1.14');
  ok(/const FB_ELIM_ARENAS=\{5:FOOTBALL_ARENA_ELIM5,4:/.test(HTML),
     'die Fuenf-Spieler-Arena haengt in derselben Phasentabelle wie alle anderen');
  ok(/const FB_ELIM_DIRS=\{5:FOOTBALL_ELIM5_DIRS,4:/.test(HTML),
     'die Torrichtungen haengen in derselben Phasentabelle');
  // Der Umbau kennt KEINE Tabelle erlaubter Phasenpaare mehr.
  ok(/return fbElimPhaseN>2&&n===fbElimPhaseN-1&&!!FB_ELIM_ARENAS\[n\];/.test(HTML),
     'der Umbau wird generisch ausgeloest, nicht ueber feste Phasenpaare');
  ok(!/if\s*\(\s*5\s*(===|==)\s*fbElimPhaseN/.test(HTML), 'es gibt keine Fuenf-Spieler-Sonderweiche');
  // Die Morph-Maschine ist unveraendert generisch.
  ok(/const A=\(plan&&FB_ELIM_ARENAS\[plan\.from\]\)\|\|FOOTBALL_ARENA_ELIM4;/.test(HTML),
     'der Morph schlaegt Start- und Zielform generisch nach');
  // Fuenfte Spielerfarbe und eigener Owner fuer den Ball.
  ok(/const FOOTBALL_NEUTRAL_OWNER=5;/.test(HTML), 'der neutrale Ball hat einen eigenen Owner-Index');
}

// =================================================================================
// I - FARBEN: FUENFTER FOOTBALL-SPIELER OHNE NEBENWIRKUNG AUF DIE UEBRIGEN MODI
// =================================================================================
// Der fuenfte Football-Spieler braucht einen Farbslot mehr, als die globale Tafel hat.
// Er darf sich diesen Slot NICHT von den uebrigen Modi nehmen: der fuenfte RingOut-FFA-
// Spieler behaelt sein Dunkelgrau, und der neutrale Football-Ball bleibt schwarz.
{
  const pcolsLine = (HTML.match(/const PCOLS=\[[^\n]*/) || [''])[0];
  const nameLine  = (HTML.match(/const NAME_COL=\[[^\n]*/) || [''])[0];
  // 1. Die globale Tafel hat weiterhin genau fuenf Eintraege in unveraenderter Reihenfolge.
  ok((pcolsLine.match(/\{ui:'#/g) || []).length === 5,
     'die globale Farbtafel hat unveraendert fuenf Eintraege');
  ok((nameLine.match(/'#/g) || []).length === 5,
     'die globale Namenstafel hat unveraendert fuenf Eintraege');
  for (const [i, ui] of [[0, '#00d4ff'], [1, '#ff4d4d'], [2, '#39e07a'], [3, '#ffc940'], [4, '#aab4c8']])
    ok(pcolsLine.includes("{ui:'" + ui + "'"),
       'globaler Farbslot ' + i + ' ist unveraendert ' + ui);
  // 2. Der fuenfte RingOut-FFA-Spieler behaelt exakt sein Dunkelgrau.
  ok(/\{ui:'#aab4c8',rgb:'170,180,200',c:'#20242e',lt:'#9fb0c8',dk:'#05070c',gl:'150,165,190',m3:0x14161c\}\];/.test(pcolsLine),
     'RingOut-FFA-Spieler 5 behaelt seinen bisherigen Farbeintrag vollstaendig');
  ok(/const NAME_COL=\['#6cc9ff','#ff6a58','#57e695','#ffd166','#f2f5fa'\];/.test(nameLine),
     'die Namenslabels sind unveraendert');
  // 3. Football legt eine EIGENE Tafel darueber: P5 violett, neutraler Ball auf Slot 5.
  ok(/const FB_COL_P5=\{ui:'#c07bff',/.test(HTML), 'Football-Spieler 5 ist violett (#c07bff)');
  ok(/const FB_PCOLS=\[PCOLS\[0\],PCOLS\[1\],PCOLS\[2\],PCOLS\[3\],FB_COL_P5,PCOLS\[4\]\];/.test(HTML),
     'die Football-Tafel uebernimmt P1-P4 unveraendert und haengt Violett vor den Ballslot');
  ok(/function pcol\(i\)\{return mode==='football'\?\(FB_PCOLS\[i\]\|\|PCOLS\[i\]\):PCOLS\[i\];\}/.test(HTML),
     'ausserhalb Football liefert die Farbabfrage exakt die globale Tafel');
  // 4. Das 3D-Kugelmaterial folgt derselben Trennung: genau EIN zusaetzliches Material.
  ok(/const ballMatFB=\[ballMat\[0\],ballMat\[1\],ballMat\[2\],ballMat\[3\],p5Mat,ballMat\[4\]\];/.test(HTML),
     'der Football-Materialsatz legt genau ein zusaetzliches Material an');
  ok(/const ballMatFor=slot=>\(mode==='football'\?ballMatFB:ballMat\)\[slot\]\|\|ballMat\[0\];/.test(HTML),
     'ausserhalb Football wird unveraendert der bisherige Materialsatz benutzt');
  // 5. Der Siegername und die Siegerfarbe folgen derselben Verschiebung - ein siegreicher
  //    Spieler 5 heisst VIOLETT, nicht GRAU (Grau bezeichnet den neutralen Ball).
  ok(/const FB_COL_SLOT=\[0,1,2,3,5,4\];/.test(HTML),
     'die Namens- und Siegerfarbverschiebung ist dieselbe wie in der Farbtafel');
  ok(/function colName\(p\)\{return T\('col'\+colSlot4Name\(p\)\);\}/.test(HTML),
     'der Farbname geht ueber die Football-Verschiebung');
  for (const key of ["col5:'VIOLET'", "col5:'VIOLETT'", "col5:'MOR'"])
    ok(HTML.includes(key), 'der Farbname fuer Spieler 5 existiert (' + key + ')');
  ok(/\.wt\.w5\{color:#c07bff\}/.test(HTML), 'die Siegerueberschrift von Spieler 5 ist violett');
  ok(/\$\('wt'\)\.className='wt w'\+colSlot4Name\(winner\);/.test(HTML),
     'die Siegerueberschrift nutzt dieselbe Verschiebung');
  // Ausserhalb Football bleibt der Farbname unveraendert (Slot 4 = GRAU).
  ok(/col0:'BLUE',col1:'RED',col2:'GREEN',col3:'YELLOW',col4:'GRAY',/.test(HTML),
     'die bestehenden Farbnamen sind unveraendert');
}

// =================================================================================
// J - OWNER-SICHERHEIT: DER NEUTRALE BALL IST KEIN SPIELER
// =================================================================================
{
  const E = E5();
  E.newMatch();
  const NEU = E.neutral;
  ok(NEU === 5, 'der neutrale Owner liegt hinter allen fuenf Spielern');
  ok(NEU >= E.playerCount(), 'der neutrale Owner liegt ausserhalb des Spielerbereichs');
  ok(E.lives().length === 5 && E.active().length === 5,
     'die Zustandslisten fuehren genau fuenf Spieler - der Ball kommt darin nicht vor');
  ok(E.slots().indexOf(NEU) === -1, 'der neutrale Owner besitzt kein Tor');
  ok(E.activeOwners().indexOf(NEU) === -1, 'der neutrale Owner zaehlt nicht als Ueberlebender');
  ok(E.aimSet().length === 5, 'der neutrale Owner bekommt keinen verdeckten Zug');
  // Ein Lebensabzug auf den neutralen Owner muss wirkungslos verpuffen.
  const before = JSON.stringify(E.lives());
  E.concede(NEU); E.concede(NEU); E.concede(NEU);
  ok(JSON.stringify(E.lives()) === before, 'der neutrale Owner verliert keine Leben');
  ok(JSON.stringify(E.active()) === '[true,true,true,true,true]',
     'der neutrale Owner scheidet nicht aus und reisst niemanden mit');
  ok(E.np() === 5, 'die Spielerzahl bleibt bei fuenf');
}

{
  // Zwei Leben unveraendert.
  ok(/const FB_ELIM_LIVES=2;/.test(HTML), 'die Lebenszahl ist unveraendert zwei');
  // Physik, Abschusskurve und Zeitbasis unveraendert.
  ok(/const FOOTBALL_PHYS=\{friction:0\.9958,frictionBall:0\.9964,fend:0\.9760,fendBall:0\.9790,/.test(HTML),
     'die Physik ist unveraendert');
  ok(/const FB_LAUNCH_SCALE=1\.26;/.test(HTML) && /const FB_LAUNCH_CURVE=0\.98;/.test(HTML),
     'die Abschusskurve ist unveraendert');
  ok(/const SIM_HZ=60;/.test(HTML), 'die Zeitbasis ist unveraendert');
  // Die bestehenden Endformen sind unangetastet.
  ok(/fbShape\(12\.50,12\.50,3\.50,8\.15,3,false,FOOTBALL_ELIM3_DIRS\)/.test(HTML), '3P-Form unveraendert');
  ok(/fbShape\(15\.60,11\.60,2\.60,10\.15,2,false,FOOTBALL_ELIM2_DIRS\)/.test(HTML), '2P-Form unveraendert');
  ok(/halfLen:17\.50,halfWid:17\.50,corner:3\.50,spawn:11\.50,sides:4/.test(HTML), '4P-Form unveraendert');
}

console.log('\nFootball-Elimination5: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
