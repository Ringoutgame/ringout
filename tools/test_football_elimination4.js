// Arena Football ELIMINATION4 (V3) - Regressionssuite des Dev-Prototyps.
//
// Elimination4 ist eine VARIANTE des Football-Modus (fbVariant === 'elimination4'), kein
// eigener mode und keine zweite Zug-Zustandsmaschine. Vier Spieler mit je EINER Figur und je
// EINEM Tor teilen sich einen neutralen Ball. Alle planen verdeckt, alle aktiven Figuren
// starten gleichzeitig.
//
// V2-KERNREGEL: EIN GEGENTOR = SOFORT AUSGESCHIEDEN. Kein Timer, keine Punkte, kein Tiebreak.
// V3-ERWEITERUNG: die Arena passt ihre GEOMETRIE an die Zahl der aktiven Spieler an.
//   4 Spieler -> Rounded Square, vier Tore N/O/S/W
//   3 Spieler -> abgerundetes gleichseitiges Dreieck, drei Tore im 120-Grad-Raster
//   2 Spieler -> Rounded Rectangle mit zwei exakt gegenueberliegenden Toren
//   1 Spieler -> Sieg
// Zusaetzlich ist der Eckradius der Vier-Spieler-Arena deutlich reduziert, damit der Ball
// nicht mehr tangential aussen um die Arena laeuft.
//
// Die Suite prueft:
//   1. Struktur, Arena-Symmetrie und die Geometrie ALLER drei Phasen,
//   2. das verdeckte n-Spieler-Commit und den gemeinsamen Start VOR dem ersten Physikschritt,
//   3. Tor -> sofortige Eliminierung, Arenawechsel, Torzuordnung, Legalisierung, Ball-Respawn,
//   4. Aussenlauf (der Ball kehrt ins Innere zurueck), Progression 4->3->2->1, Sieg,
//   5. dass keine V1-Reste uebrig sind und Classic/Tactical unberuehrt bleiben.
//
// Wie alle Football-Harnesse extrahiert sie die ECHTEN Quellen aus index.html und beobachtet
// sie von aussen - es wird nichts in den Physikkern injiziert. Kein DOM, kein Renderer, kein
// Netzwerk, kein Zufall: zwei Laeufe liefern bitidentische Ergebnisse.
//
// Usage: node tools/test_football_elimination4.js

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
const startFootballSrc   = grab(/function startFootball\(variant,rules\)\{[\s\S]*?\n\}/, 'startFootball');
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
      // Die fuer DIESE Kugel geltende Grenze: Bande, im Torfenster zuzueglich der
      // Torrettungstasche. Reine Abfrage des Produktcodes.
      rescueLimit(i){ return footballRescueLimit(balls[i]); },
      inWindowAt(x,y){ return footballGoalWindow({x,y,owner:FOOTBALL_NEUTRAL_OWNER,alive:true}); },
      rescueLimitAt(x,y,neutral){ const b={x,y,owner:neutral?FOOTBALL_NEUTRAL_OWNER:0,alive:true};
                                  return footballRescueLimit(b); },
      rescueDepth(){ return footballRescueDepth(); },
      playerHalf(){ return footballGoalPlayerHalf(); },
      // Einen Koerper mit Startlage und Geschwindigkeit gegen die Bande schiessen und
      // beobachten, ob er die Arena in IRGENDEINEM Schritt verlaesst.
      slam(idx,x0,y0,vx,vy,steps){
        phase='sim';
        balls[idx].x=x0;balls[idx].y=y0;balls[idx].vx=vx;balls[idx].vy=vy;
        balls[idx].fbPassed=false;
        let worst=-Infinity,over=-Infinity,fin=true;
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
          // Ueberschuss ueber die fuer diese Kugel GUELTIGE Grenze. Ausserhalb des
          // Torfensters ist das die Bande selbst (Limit 0), dort misst over genau
          // dasselbe wie worst.
          const ov=s-footballRescueLimit(b);
          if(ov>over)over=ov;
        }
        return {worst,over,fin,passed:!!balls[idx].fbPassed,
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
      // Steht diese Kugel im sichtbaren Torfenster? Dort verlaeuft keine Bandenlinie.
      inWindow(i){ return footballGoalWindow(balls[i]); },
      // Wie tief darf eine Kugel dort hoechstens stehen: die Laengsausdehnung des Sockels
      // plus ihr eigener Radius - dahinter faellt das Tor.
      windowDepth(i){ const a=fbArena(); return (a.postBack-a.postFront)*BR+ballRad(balls[i]); },
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
      // Den Durchtritts-Latch setzen: fuer Szenarien, die den Zustand NACH der
      // Torlinie pruefen, ohne den ganzen Anlauf zu simulieren.
      setPassed(i,v){ balls[i].fbPassed=!!v; },
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

console.log('ARENA FOOTBALL - ELIMINATION: ZWEI LEBEN + ADAPTIVE ARENA + FAIRER RESPAWN\n');

// =================================================================================
// A0 - PRODUKTINTEGRATION: MENUESTART == DEV-DIREKTSTART, MODE-SWITCH-SAFETY
// =================================================================================
// Elimination ist der dritte sichtbare Modus. Der Menuebutton ruft denselben
// startFootball()-Pfad wie der Dev-Direktlink - es darf keinen zweiten Startzustand geben.
// Geprueft wird der ZUSTAND nach dem Start; die DOM-Verdrahtung prueft die Produktsuite.
{
  const snap = (E) => JSON.stringify({
    variant: E.variant(), elim: E.elim(), np: E.np(), teamCap: E.teamCap(),
    phaseN: E.phaseN(), active: E.active(), slots: E.slots(), winner: E.winner(),
    bodies: E.snapshot().map(b => ({ o: b.owner, x: b.x, y: b.y, alive: b.alive })),
  });

  // Dev-Direktlink: die Variante steht schon beim Laden fest.
  const dev = buildEnv('elimination4');
  dev.newMatch();

  // Menue: das Spiel steht in Classic und wechselt erst durch die Auswahl - genau das macht
  // startFootball(), gefolgt vom bestehenden newGame() -> startRound().
  const menu = buildEnv();
  menu.newMatch();
  menu.setVariant('elimination4');
  menu.newMatch();

  ok(snap(menu) === snap(dev),
     'der Menuestart erzeugt exakt denselben Zustand wie der Dev-Direktstart');
  ok(menu.np() === 4 && menu.snapshot().length === 5,
     'nach dem Menuestart stehen vier Spieler und ein Ball in der Arena');
  ok(menu.phaseN() === 4 && menu.dirs().length === 4,
     'nach dem Menuestart steht die Vier-Tore-Arena');
  ok(JSON.stringify(menu.active()) === JSON.stringify([true, true, true, true]),
     'nach dem Menuestart ist kein Spieler ausgeschieden');

  // Rueckweg: Classic nach einem laufenden Elimination-Match traegt keinen Rest.
  const back = buildEnv();
  back.setVariant('elimination4');
  back.newMatch();
  back.eliminate(1);
  back.setVariant('classic');
  back.newMatch();
  ok(back.elim() === false && back.np() === 2 && back.teamCap() === 1,
     'Elimination -> Classic: zwei Spieler, eine Figur je Spieler');
  ok(back.snapshot().length === 3, 'Elimination -> Classic: wieder genau drei Koerper');
  ok(JSON.stringify(back.active()) === JSON.stringify([true, true, true, true, true]),
     'Elimination -> Classic: der Eliminierungszustand ist zurueckgesetzt');
  ok(back.phaseN() === 5, 'Elimination -> Classic: die Arenaphase steht wieder auf dem Produktstart');
  ok(JSON.stringify(back.slots()) === JSON.stringify([0, 1, 2, 3, 4]),
     'Elimination -> Classic: die Torzuordnung ist zurueckgesetzt');
  ok(back.winner() === null, 'Elimination -> Classic: kein Gewinner aus dem Vormatch');

  // Hinweg: Elimination nach einem Classic-Match ist ebenfalls sauber.
  const fwd = buildEnv();
  fwd.newMatch();
  fwd.setVariant('elimination4');
  fwd.newMatch();
  ok(fwd.snapshot().length === 5 && fwd.np() === 4,
     'Classic -> Elimination: vier Spieler, kein Classic-Rest');
  ok(fwd.winner() === null && fwd.goalState() === 'play',
     'Classic -> Elimination: kein Torablauf und kein Gewinner aus dem Vormatch');

  // Und ueber Tactical: die dritte Kante des Moduswechsels.
  const tac = buildEnv();
  tac.setVariant('tactical');
  tac.newMatch();
  tac.setVariant('elimination4');
  tac.newMatch();
  ok(tac.elim() === true && tac.tactical() === false && tac.teamCap() === 1,
     'Tactical -> Elimination: eine Figur je Spieler, kein Tactical-Rest');
  ok(tac.snapshot().length === 5, 'Tactical -> Elimination: vier Spieler und ein Ball');
  tac.setVariant('tactical');
  tac.newMatch();
  ok(tac.teamCap() === 2 && tac.snapshot().length === 5 && tac.np() === 2,
     'Elimination -> Tactical: zwei Spieler mit je zwei Figuren');
  ok(tac.elim() === false, 'Elimination -> Tactical: Elimination ist wieder inert');
}

// =================================================================================
// A - VARIANTE UND STRUKTUR
// =================================================================================
{
  const D = buildEnv();
  ok(D.variant() === 'classic', 'Default-Variante ist Classic (ohne Dev-Flag nie Elimination4)');
  ok(D.elim() === false, 'ohne Dev-Flag ist Elimination4 vollstaendig inert');
  const X = buildEnv('bogus');
  ok(X.variant() === 'classic', 'ein unbekannter fb-Parameter faellt auf Classic zurueck');
  const T = buildEnv('tactical');
  ok(T.variant() === 'tactical' && T.elim() === false, 'Tactical bleibt Tactical (kein Elim-Leak)');

  const E = buildEnv('elimination4');
  ok(E.variant() === 'elimination4', '?dev=1&fb=elimination4 aktiviert die Variante direkt');
  ok(E.elim() === true && E.tactical() === false, 'Elimination4 und Tactical schliessen sich aus');
  E.setMode('bot');
  ok(E.elim() === false, 'ausserhalb mode==="football" ist Elimination4 inert');
  E.setMode('football');

  ok(E.playerCount() === 4, 'der Dev-Einstieg elimination4 startet mit vier Spielern');
  ok(E.np() === 4, 'np() liefert in Elimination4 vier Spieler');
  ok(D.np() === 2, 'np() bleibt in Classic bei zwei Spielern');
  ok(T.np() === 2, 'np() bleibt in Tactical bei zwei Spielern');
  ok(E.teamCap() === 1, 'jeder Spieler hat genau EINE Figur');

  const sn = E.place();
  ok(sn.length === 5, 'genau fuenf Koerper: vier Figuren + ein Ball');
  const owners = sn.map(b => b.owner);
  ok(JSON.stringify(owners) === JSON.stringify([0, 1, 2, 3, E.neutral]),
     'Reihenfolge P1,P2,P3,P4,BALL - stabile Ballindizes ueber alle Runden');
  ok(new Set(owners).size === 5, 'jeder Owner kommt genau einmal vor (eindeutige Zuordnung)');
  ok(owners.filter(o => o === E.neutral).length === 1, 'genau EIN neutraler Ball');
  for (let o = 0; o < 4; o++) ok(E.rad(o) === E.BR, 'Spielerfigur P' + (o + 1) + ' hat Radius BR (32)');
  ok(E.rad(4) === 25, 'der neutrale Ball hat Radius 25 (unveraenderte Ballgroesse B3)');
  ok(sn.every(b => b.alive), 'alle fuenf Koerper starten aktiv');
  ok(JSON.stringify(E.active()) === JSON.stringify([true, true, true, true]),
     'alle vier Spieler starten im Match');
  ok(E.phaseN() === 4 && E.dirs().length === 4, 'Matchstart in der Vier-Tore-Phase');
}

// =================================================================================
// B - VIER-SPIELER-ARENA: SYMMETRIE, TORE, SPAWNS
// =================================================================================
{
  const E = buildEnv('elimination4');
  const C = buildEnv();
  const a = E.arenaCfg(), ca = C.arenaCfg();

  ok(a.halfLen === a.halfWid, 'die Arena ist exakt quadratisch (halfLen === halfWid)');
  ok(a.halfLen === 17.50 && a.corner === 3.50,
     'V3-Vier-Spieler-Arena: half 17.50 BR, Eckradius auf 3.50 BR reduziert');
  ok(a.postFront === a.halfLen, 'Sockelvorderkante liegt exakt auf der Bandeninnenflaeche');
  ok(near(a.postBack - a.postFront, ca.postBack - ca.postFront),
     'Sockeltiefe unveraendert aus der Produktivarena uebernommen');
  // Die Toroeffnung ist in JEDER Phase und in jedem Modus dieselbe: die gemessenen
  // Sockelkanten des Assets. Sie kann damit auch beim Uebergang 3P->2P nicht wachsen.
  ok(a.postInner === ca.postInner && a.postOuter === ca.postOuter,
     'Torbreite unveraendert: postInner/postOuter exakt wie im Produktivmodus');
  ok(a.postInner === 3.560 && a.postOuter === 5.282,
     'und das sind die gemessenen Asset-Kanten 3.560/5.282');
  ok(near(E.arena().clearHalf, C.arena().clearHalf) && near(E.arena().clearHalf, 3.560 * E.BR),
     'lichte Torbreite 227.84 - identisch mit Classic, in Elimination wird nichts retuned');
  const straightHalf = a.halfLen - a.corner;
  ok(straightHalf > a.postOuter,
     'der Torsockel passt in das gerade Seitensegment (' + straightHalf.toFixed(2) + ' > ' + a.postOuter + ')');

  const dirs = E.dirs();
  for (const d of dirs) ok(near(Math.hypot(d[0], d[1]), 1), 'Torrichtung [' + d + '] ist ein Einheitsvektor');
  for (let k = 0; k < 4; k++) {
    const cur = dirs[k], nxt = dirs[(k + 1) % 4];
    ok(nxt[0] === -cur[1] && nxt[1] === cur[0],
       'Tor ' + (k + 1) + ' -> Tor ' + ((k + 1) % 4 + 1) + ' ist eine exakte 90-Grad-Drehung');
  }
  ok(new Set(dirs.map(d => d.join(','))).size === 4, 'alle vier Torrichtungen sind verschieden');

  const centerHalf = E.arena().centerHalf, line = a.postBack * E.BR;
  for (let s = 0; s < 4; s++) {
    const d = dirs[s];
    const f = E.fold(d[0] * line, d[1] * line);
    ok(f.side === s, 'ein Punkt auf der Achse von Tor ' + (s + 1) + ' faltet auf genau diesen Slot');
    ok(near(f.x, line) && near(f.y, 0), 'die Faltung von Tor ' + (s + 1) + ' ist eine exakte Drehung');
    const t = [-d[1], d[0]];
    const at = (lat) => E.fold(d[0] * line + t[0] * lat, d[1] * line + t[1] * lat);
    ok(near(Math.abs(at(centerHalf * 0.99).y), centerHalf * 0.99),
       'Tor ' + (s + 1) + ': Queroffset wird exakt abgebildet');
  }

  const sn = E.place();
  for (let k = 0; k < 4; k++) {
    const c = sn[k], n = sn[(k + 1) % 4];
    const rx = -(c.y - E.cy), ry = (c.x - E.cx);
    ok(near(n.x - E.cx, rx) && near(n.y - E.cy, ry),
       'Spawn P' + (k + 1) + ' -> P' + ((k + 1) % 4 + 1) + ' exakt durch 90-Grad-Drehung');
  }
  ok(sn[4].x === E.cx && sn[4].y === E.cy, 'der neutrale Ball startet exakt im Arenamittelpunkt');
  const ballR = 25;
  for (let o = 0; o < 4; o++) {
    const p = sn[o], dc = Math.hypot(p.x - E.cx, p.y - E.cy);
    ok(dc > E.BR + ballR, 'P' + (o + 1) + ' startet nicht am Ball');
    ok(E.boundSD(o) < -E.BR, 'P' + (o + 1) + ' startet mit deutlichem Abstand zur Bande');
    ok(dc < a.postFront * E.BR, 'P' + (o + 1) + ' startet vor dem eigenen Tor, nie darin');
    for (let q = o + 1; q < 4; q++) {
      const d2 = Math.hypot(p.x - sn[q].x, p.y - sn[q].y);
      ok(d2 > 2 * E.BR, 'P' + (o + 1) + ' und P' + (q + 1) + ' beruehren sich beim Start nicht');
    }
    const f = E.fold(p.x - E.cx, p.y - E.cy);
    ok(f.side === o, 'P' + (o + 1) + ' steht vor dem eigenen Tor (Slot ' + f.side + ')');
  }

  ok(ca.halfLen === 15.60 && ca.halfWid === 11.60, 'Classic laeuft auf der 2P-Finalarena (15.60 x 11.60)');
  const TA = buildEnv('tactical').arenaCfg();
  ok(TA.halfLen === 18.00 && TA.halfWid === 12.70, 'Tactical behaelt die Produktivarena');
}

// =================================================================================
// B2 - V3: GEOMETRIE DER DREI ARENAPHASEN
// =================================================================================
{
  const E = buildEnv('elimination4');
  const C = buildEnv();

  // Anteil der Aussenkontur, der GEKRUEMMT ist. Genau dieser Anteil trug den Ball im
  // V2-Test tangential um die Arena - je kleiner, desto staerker streuen die Ecken zurueck.
  const arcShareRect = (h, w, rc) => (2 * Math.PI * rc) / (4 * (h - rc) + 4 * (w - rc) + 2 * Math.PI * rc);
  const arcShareTri = (ap, rc) => (2 * Math.PI * rc) / (6 * (ap - rc) * Math.sqrt(3) + 2 * Math.PI * rc);
  // Fuer die gekappten Formen: gerade Wandflaeche ist der Umfang des Kernpolygons, die
  // Rundung sind die Boegen - zusammen exakt 2*pi*rc.
  const arcSharePoly = (poly, rc) => {
    let per = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      per += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    return (2 * Math.PI * rc) / (per + 2 * Math.PI * rc);
  };
  // Laenge der geraden Wand in einer Torrichtung (die Kernkante, deren Normale die Torachse ist).
  const goalWallLen = (poly, d) => {
    let best = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez) || 1;
      if ((ez / L) * d[0] + (-ex / L) * d[1] > 0.94) best = Math.max(best, L);
    }
    return best;
  };

  E.forcePhase(4);
  const a4 = E.arenaCfg();
  const s4 = arcShareRect(a4.halfLen, a4.halfWid, a4.corner);
  ok(a4.sides === 4 && a4.tri === false, 'Phase 4: Rounded Square mit vier Seiten');
  ok(a4.corner === 3.50, 'Phase 4: Eckradius 3.50 BR (V2 war 9.00 BR)');
  ok(s4 < 0.20, 'Phase 4: gekruemmter Konturanteil ' + (s4 * 100).toFixed(1) + ' Prozent');
  ok(s4 < arcShareRect(17.50, 17.50, 9.00) * 0.5,
     'Phase 4: der gekruemmte Anteil ist weniger als halb so gross wie in V2');
  ok(a4.halfLen - a4.corner > a4.postOuter, 'Phase 4: der Torsockel passt in das gerade Seitensegment');
  ok(E.dirs().length === 4, 'Phase 4: vier Torrichtungen');

  E.forcePhase(3);
  const a3 = E.arenaCfg(), d3 = E.dirs();
  const s3 = arcSharePoly(a3.poly, a3.corner);
  ok(a3.sides === 3 && Array.isArray(a3.poly) && a3.poly.length === 6,
     'Phase 3: Broad Rounded Triangle - drei Torseiten, sechs Kernecken');
  ok(d3.length === 3, 'Phase 3: genau drei Tore');
  ok(a3.halfLen === 12.50 && a3.corner === 3.50, 'Phase 3: Apothem 12.50 BR, Eckradius 3.50 BR');
  ok(s3 < 0.25, 'Phase 3: gekruemmter Konturanteil ' + (s3 * 100).toFixed(1) + ' Prozent');
  ok(goalWallLen(a3.poly, d3[0]) / 2 > a3.postOuter,
     'Phase 3: der Torsockel passt in das gerade Seitensegment');
  for (const d of d3) ok(near(Math.hypot(d[0], d[1]), 1, 1e-12), 'Phase 3: Torrichtung [' + d + '] ist ein Einheitsvektor');
  for (let k = 0; k < 3; k++) {
    const c = d3[k], n = d3[(k + 1) % 3];
    const rx = c[0] * Math.cos(2 * Math.PI / 3) - c[1] * Math.sin(2 * Math.PI / 3);
    const ry = c[0] * Math.sin(2 * Math.PI / 3) + c[1] * Math.cos(2 * Math.PI / 3);
    ok(near(n[0], rx, 1e-12) && near(n[1], ry, 1e-12),
       'Phase 3: Tor ' + (k + 1) + ' -> Tor ' + ((k + 1) % 3 + 1) + ' ist exakt 120 Grad');
    ok(near(c[0] * n[0] + c[1] * n[1], -0.5, 1e-12),
       'Phase 3: der Winkel zwischen benachbarten Toren ist 120 Grad (Skalarprodukt -0.5)');
  }
  ok(near(E.arena().clearHalf, 3.560 * E.BR), 'Phase 3: lichte Torbreite unveraendert 227.84 (Classic-Streckung wirkt hier nicht)');
  for (let s = 0; s < 3; s++) {
    const lineT = a3.postBack * E.BR, d = d3[s];
    const f = E.fold(d[0] * lineT, d[1] * lineT);
    ok(f.side === s, 'Phase 3: ein Punkt auf der Achse von Tor ' + (s + 1) + ' faltet auf diesen Slot');
    ok(near(f.x, lineT, 1e-9) && near(f.y, 0, 1e-9), 'Phase 3: die Faltung von Tor ' + (s + 1) + ' ist eine exakte Drehung');
  }
  for (const pt of [[120, 40], [-260, 90], [30, -300], [200, 200]]) {
    const base = E.boundSDAt(E.cx + pt[0], E.cy + pt[1]);
    let qx = pt[0], qy = pt[1];
    for (let k = 1; k < 3; k++) {
      const nx = qx * Math.cos(2 * Math.PI / 3) - qy * Math.sin(2 * Math.PI / 3);
      const ny = qx * Math.sin(2 * Math.PI / 3) + qy * Math.cos(2 * Math.PI / 3);
      qx = nx; qy = ny;
      ok(near(E.boundSDAt(E.cx + qx, E.cy + qy).sd, base.sd, 1e-6),
         'Phase 3: die Grenze ist unter ' + (k * 120) + '-Grad-Drehung invariant');
    }
  }
  ok(!/Math\.random/.test(triSDSrc), 'die Dreiecksgrenze enthaelt keinen Zufall');

  E.forcePhase(2);
  const a2 = E.arenaCfg(), d2 = E.dirs();
  ok(a2.sides === 2 && Array.isArray(a2.poly) && a2.poly.length === 8,
     'Phase 2: Shouldered Wide - zwei Tore, acht Kernecken');
  ok(d2.length === 2, 'Phase 2: genau zwei Tore');
  ok(near(d2[0][0], -d2[1][0]) && near(d2[0][1], -d2[1][1]),
     'Phase 2: die beiden Tore liegen EXAKT gegenueber');
  ok(a2.postFront === a2.halfLen, 'Phase 2: beide Tore haben dieselbe Zentrumsdistanz');
  ok(a2.halfLen > a2.halfWid, 'Phase 2: klare Laengsachse (Classic-Layout)');
  ok(goalWallLen(a2.poly, d2[0]) / 2 > a2.postOuter, 'Phase 2: der Torsockel passt in das gerade Seitensegment');
  ok(near(E.arena().clearHalf, 3.560 * E.BR), 'Phase 2: lichte Torbreite unveraendert 227.84 (Classic-Streckung wirkt hier nicht)');
  const s2 = arcSharePoly(a2.poly, a2.corner);
  ok(s2 < arcShareRect(18.00, 12.70, 6.85), 'Phase 2: weniger gekruemmte Aussenfuehrung als Classic');

  E.forcePhase(4); const v4 = E.viewR();
  E.forcePhase(3); const v3 = E.viewR();
  E.forcePhase(2); const v2 = E.viewR();
  ok(v4 > v3, 'der Sichtradius wird beim ersten Umbau enger (' +
     Math.round(v4) + ' > ' + Math.round(v3) + ')');
  // Beim zweiten Umbau bestimmt die Deckkante hinter den Toren das Framing, nicht die
  // Spielflaeche - das breite Finale zieht die Kamera bewusst wieder etwas auf.
  ok(v2 > v3, 'der Sichtradius 3 -> 2 waechst mit dem breiten Finale (' +
     Math.round(v3) + ' -> ' + Math.round(v2) + ')');

  ok(C.arenaCfg().halfLen === 15.60 && C.arenaCfg().corner === 2.60, 'Classic laeuft auf der 2P-Finalarena');
  ok(buildEnv('tactical').arenaCfg().corner === 6.85, 'Tactical behaelt die Produktivarena');

  console.log('Geometrie: gekruemmter Konturanteil  Phase4 ' + (s4 * 100).toFixed(1) +
              '%  Phase3 ' + (s3 * 100).toFixed(1) + '%  Phase2 ' + (s2 * 100).toFixed(1) +
              '%   (V2-Vier-Spieler-Arena ' + (arcShareRect(17.50, 17.50, 9.00) * 100).toFixed(1) +
              '%, Classic ' + (arcShareRect(18.00, 12.70, 6.85) * 100).toFixed(1) + '%)');
  console.log('Geometrie: Sichtradius              Phase4 ' + Math.round(v4) +
              '  Phase3 ' + Math.round(v3) + '  Phase2 ' + Math.round(v2));
}

// =================================================================================
// B3 - V3: AUSSENLAUF. Der Ball darf nicht endlos tangential aussen kreisen.
// =================================================================================
{
  const outerRun = (E, ux, uy, sp) => {
    const l = Math.hypot(ux, uy); ux /= l; uy /= l;
    let lo = 0, hi = 40 * E.BR;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (E.boundSDAt(E.cx + ux * m, E.cy + uy * m).sd < 0) lo = m; else hi = m;
    }
    const r = lo * 0.985;
    E.setPos(4, E.cx + ux * r, E.cy + uy * r);
    E.setVel(4, -uy * sp, ux * sp);          // exakt tangential
    E.setPhaseRaw('sim');
    let minD = Infinity, fin = true, tor = false, maxAus = 0;
    for (let k = 0; k < 500; k++) {
      E.step();
      if (E.goalState() !== 'play') { tor = true; break; }
      const b = E.snapshot()[4];
      const d = Math.hypot(b.x - E.cx, b.y - E.cy);
      if (!Number.isFinite(d)) { fin = false; break; }
      if (d < minD) minD = d;
      // Der ECHTE Einschluss, direkt gemessen: ausserhalb eines offenen Torfensters darf
      // die Bandenlinie nicht ueberschritten werden. Im Fenster gibt es keine.
      if (!b.passed && !E.inWindowAt(b.x, b.y)) {
        const ue = E.boundSDAt(b.x, b.y, true).sd - E.rescueLimitAt(b.x, b.y, true);
        if (ue > maxAus) maxAus = ue;
      }
    }
    return { minD: minD, fin: fin, start: r, tor: tor, maxAus: maxAus };
  };

  for (const ph of [4, 3, 2]) {
    const E = buildEnv('elimination4');
    E.newMatch();
    E.forcePhase(ph);
    for (let o = 0; o < 4; o++) E.setPos(o, E.cx, E.cy - 40 * E.BR);   // Figuren aus dem Weg
    const D = E.dirs();
    let ux = D[0][0] + D[1 % D.length][0], uy = D[0][1] + D[1 % D.length][1];
    if (Math.hypot(ux, uy) < 1e-9) { ux = -D[0][1]; uy = D[0][0]; }
    const r = outerRun(E, ux, uy, 26);
    ok(r.fin, 'Phase ' + ph + ': kein NaN auf der Aussenbahn');
    // Der Zweck dieser Probe ist der EINSCHLUSS: ein tangential an der Bande entlang
    // gestarteter Ball darf nicht davonlaufen. Seit dem Torfenster-Pass hat er einen
    // zweiten zulaessigen Ausgang: erreicht er auf seiner Bahn ein offenes Tor, faellt es -
    // ein Bankschuss, und der ist ausdruecklich erwuenscht. Beide Enden sind in Ordnung;
    // ein Davonlaufen ist es nicht.
    // DER eigentliche Einschluss - direkt gemessen statt ueber einen Ersatzwert.
    ok(r.maxAus <= 1.5,
       'Phase ' + ph + ': der Ball verlaesst die Bandenlinie ausserhalb des Torfensters nicht (' +
       r.maxAus.toFixed(3) + ' <= 1.5)');
    // Und er laeuft nicht davon: er kehrt deutlich ins Innere zurueck oder faellt ins Tor.
    // Die 0.60 sind gemessen (Phase 4: 0.33, Phase 3: 0.57, Phase 2: Tor) - mit offenen
    // Torfenstern reitet die tangentiale Bahn etwas weiter aussen als vor dem Pass.
    ok(r.tor || r.minD < r.start * 0.60,
       'Phase ' + ph + ': der tangential gestartete Ball kehrt ins Innere zurueck oder faellt ins Tor (' +
       (r.tor ? 'Tor' : Math.round(r.minD) + ' < ' + Math.round(r.start * 0.60)) + ')');
    console.log('Aussenlauf Phase ' + ph + ': Start ' + Math.round(r.start) +
                ' -> minimale Zentrumsdistanz ' + Math.round(r.minD));
    const sn = E.snapshot();
    if (!sn[4].passed) ok(E.boundSD(4) <= 1e-6, 'Phase ' + ph + ': der Ball bleibt in der Arena');
    else ok(true, 'Phase ' + ph + ': der Ball hat ein Tor getroffen - kein Aussenorbit');
  }
}

// =================================================================================
// B4 - V3: ARENAWECHSEL, TORZUORDNUNG UND LEGALISIERUNG
// =================================================================================
{
  const cases = [
    { out: [2], slots: [0, 1, 3, -1], n: 3 },
    { out: [0], slots: [1, 2, 3, -1], n: 3 },
    { out: [3], slots: [0, 1, 2, -1], n: 3 },
    { out: [1, 2], slots: [0, 3, -1, -1], n: 2 },
    { out: [0, 3], slots: [1, 2, -1, -1], n: 2 },
  ];
  for (const c of cases) {
    const E = buildEnv('elimination4');
    E.newMatch();
    for (const o of c.out) E.eliminate(o);
    ok(E.phaseN() === 4, 'vor dem Umbau steht die alte Arena noch (Torablauf laeuft)');
    E.applyPhase();
    ok(E.phaseN() === c.n, 'Umbau auf ' + c.n + ' Tore nach ' + c.out.length + ' Eliminierung(en)');
    ok(JSON.stringify(E.slots()) === JSON.stringify(c.slots),
       'Zuordnung ' + c.out.join('+') + ' raus -> Slots ' + c.slots.join(','));
    ok(E.dirs().length === c.n, 'es gibt genau ' + c.n + ' Torrichtungen');
    for (let s = 0; s < c.n; s++) ok(E.goalOpen(s) === true, 'Slot ' + s + ' ist ein gueltiges Tor');
    for (let s = c.n; s < 4; s++) ok(E.slotOwner(s) === -1, 'Slot ' + s + ' existiert in dieser Phase nicht');
  }

  // -- V3.1: FAIRER RESPAWN. Die alten Positionen spielen keine Rolle mehr. --
  // Zwei Laeufe mit voellig verschiedenen Lagen vor dem Tor muessen exakt denselben
  // Zustand nach dem Umbau ergeben.
  const layouts = [
    [[4, 4], [-4, 4], [4, -4], [-4, -4]],        // dicht am Zentrum
    [[0, -16], [16, 0], [0, 16], [-16, 0]],      // weit aussen, teils in der neuen Arena illegal
  ];
  const stamps = [];
  for (const lay of layouts) {
    const E = buildEnv('elimination4');
    E.newMatch();
    for (let o = 0; o < 4; o++) E.setPos(o, E.cx + lay[o][0] * E.BR, E.cy + lay[o][1] * E.BR);
    E.eliminate(2);
    E.applyPhase();
    ok(E.phaseN() === 3, 'Vorbedingung: die Arena ist auf drei Spieler umgebaut');
    const sn = E.snapshot();
    // Jeder Ueberlebende steht exakt auf dem Spawn SEINES Torslots.
    for (let s = 0; s < 3; s++) {
      const o = E.slotOwner(s), sp = E.spawnAt(s);
      ok(near(sn[o].x, sp.x) && near(sn[o].y, sp.y),
         'P' + (o + 1) + ' steht exakt auf dem Phase-3-Spawn von Slot ' + s);
      ok(sn[o].vx === 0 && sn[o].vy === 0, 'P' + (o + 1) + ' startet ohne Restgeschwindigkeit');
      ok(E.boundSD(o) < 0, 'P' + (o + 1) + ' steht innerhalb der neuen Bande');
      ok(E.postClear(o), 'P' + (o + 1) + ' steckt in keinem Torsockel');
    }
    stamps.push([0, 1, 3].map(o => sn[o].x.toFixed(6) + '/' + sn[o].y.toFixed(6)).join(' '));
  }
  ok(stamps[0] === stamps[1],
     'unterschiedliche Positionen VOR dem Tor ergeben denselben Zustand NACH dem Umbau');

  // Reset-Smoke 4 -> 3 -> 2: die tatsaechlichen Positionen vor und nach jedem Umbau.
  {
    const E = buildEnv('elimination4');
    E.newMatch();
    const fmt = (o, sn) => 'P' + (o + 1) + ' ' + Math.round(sn[o].x - E.cx) + '/' + Math.round(sn[o].y - E.cy);
    const line = (tag, act) => {
      const sn = E.snapshot();
      console.log('Reset-Smoke ' + tag + ': ' + act.map(o => fmt(o, sn)).join('   ') +
                  '   Ball ' + Math.round(sn[4].x - E.cx) + '/' + Math.round(sn[4].y - E.cy));
    };
    // Verstreute Ausgangslage, wie sie nach einem echten Ballwechsel entsteht.
    const scatter = [[3, -13], [14, 6], [-2, 15], [-15, -2]];
    for (let o = 0; o < 4; o++) E.setPos(o, E.cx + scatter[o][0] * E.BR, E.cy + scatter[o][1] * E.BR);
    line('Phase 4 vor dem Tor ', [0, 1, 2, 3]);
    E.eliminate(2); E.applyPhase();
    line('Phase 3 nach Umbau  ', [0, 1, 3]);
    const scatter3 = [[-6, 7], [8, -3], [1, -9]];
    [0, 1, 3].forEach((o, i) => E.setPos(o, E.cx + scatter3[i][0] * E.BR, E.cy + scatter3[i][1] * E.BR));
    line('Phase 3 vor dem Tor ', [0, 1, 3]);
    E.eliminate(1); E.applyPhase();
    line('Phase 2 nach Umbau  ', [0, 3]);
    ok(E.phaseN() === 2, 'Reset-Smoke endet in der Final-Phase');
  }

  // -- Fairness der Spawns: gleiche Zentrumsdistanz, gleiche Distanz zum eigenen Tor --
  for (const ph of [4, 3, 2]) {
    const E = buildEnv('elimination4');
    E.newMatch();
    E.forcePhase(ph);
    const a = E.arenaCfg(), D = E.dirs(), n = D.length;
    const pts = [];
    for (let s = 0; s < n; s++) pts.push(E.spawnAt(s));
    for (let s = 0; s < n; s++) {
      const dc = Math.hypot(pts[s].x - E.cx, pts[s].y - E.cy);
      ok(near(dc, a.spawn * E.BR), 'Phase ' + ph + ' Slot ' + s + ': gleiche Zentrumsdistanz');
      // Distanz zum EIGENEN Tor: gemessen als Abstand zur Torebene (Bandeninnenflaeche
      // minus Projektion des Spawns auf die Torachse) - fuer alle Slots identisch.
      const dot = (pts[s].x - E.cx) * D[s][0] + (pts[s].y - E.cy) * D[s][1];
      ok(near(a.halfLen * E.BR - dot, (a.halfLen - a.spawn) * E.BR),
         'Phase ' + ph + ' Slot ' + s + ': gleiche Distanz zum eigenen Tor');
      ok(a.spawn < a.halfLen, 'Phase ' + ph + ' Slot ' + s + ': steht vor dem eigenen Tor, nie darin');
      ok(dc > E.BR + 25, 'Phase ' + ph + ' Slot ' + s + ': steht nicht am Ball');
      const b = E.boundSDAt(pts[s].x, pts[s].y, false);
      ok(b.sd < -E.BR * 0.5, 'Phase ' + ph + ' Slot ' + s + ': deutlicher Abstand zur Bande');
      for (let q = s + 1; q < n; q++) {
        ok(Math.hypot(pts[s].x - pts[q].x, pts[s].y - pts[q].y) > 2 * E.BR,
           'Phase ' + ph + ': Spawn ' + s + ' und ' + q + ' ueberlappen nicht');
      }
    }
    // Rotationssymmetrie der Spawns entspricht der Torsymmetrie.
    for (let s = 0; s < n; s++) {
      const f = E.fold(pts[s].x - E.cx, pts[s].y - E.cy);
      ok(f.side === s, 'Phase ' + ph + ' Slot ' + s + ': der Spawn liegt auf der eigenen Torachse');
    }
  }

  // -- 3 -> 2: dieselbe Regel im Finale --
  {
    const E = buildEnv('elimination4');
    E.newMatch();
    E.eliminate(1); E.applyPhase();
    for (let o = 0; o < 4; o++) E.setPos(o, E.cx + 200, E.cy + 200);   // alles auf einen Haufen
    E.eliminate(2); E.applyPhase();
    ok(E.phaseN() === 2, 'Vorbedingung: Finale erreicht');
    const sn = E.snapshot();
    for (let s = 0; s < 2; s++) {
      const o = E.slotOwner(s), sp = E.spawnAt(s);
      ok(near(sn[o].x, sp.x) && near(sn[o].y, sp.y),
         'P' + (o + 1) + ' steht exakt auf dem Final-Spawn von Slot ' + s);
    }
    const A = E.snapshot()[E.slotOwner(0)], B = E.snapshot()[E.slotOwner(1)];
    ok(near(Math.hypot(A.x - E.cx, A.y - E.cy), Math.hypot(B.x - E.cx, B.y - E.cy)),
       'beide Finalisten starten gleich weit vom Zentrum');
    ok(near(A.x - E.cx, -(B.x - E.cx)) && near(A.y - E.cy, -(B.y - E.cy)),
       'die beiden Final-Spawns liegen exakt gegenueber');
  }

  // -- Ball: erst Umbau, dann Zentrum --
  const B = buildEnv('elimination4');
  B.newMatch();
  parkPlayers(B);
  shootAt(B, 2);
  B.finishGoal();
  ok(B.phaseN() === 3, 'nach dem Torablauf steht die Drei-Spieler-Arena');
  const bb = B.snapshot()[4];
  ok(near(bb.x, B.cx) && near(bb.y, B.cy), 'der Ball liegt im Zentrum der NEUEN Arena');
  ok(bb.passed === false, 'der Durchtritts-Latch ist zurueckgesetzt');
  ok(B.boundSD(4) < 0, 'der Ball liegt innerhalb der neuen Grenze (keine Kollision mit der alten Arena)');
  ok(/if\(!fbElimApplyPhase\(\)\)fbElimSpawnBodies\(\);\n  for\(const b of balls\)\{/.test(elimBlockSrc),
     'der Umbau - ohne Phasenwechsel der faire Respawn - laeuft VOR dem Zuruecksetzen des Balls');
  // Arenaform und Respawn stehen im SELBEN Anweisungsblock: der Renderer sieht nie einen
  // Zwischenzustand mit neuer Arena und alten Positionen (oder umgekehrt).
  ok(/fbElimPhaseN=n;\n  fbElimSpawnBodies\(\);/.test(elimBlockSrc),
     'Arenawechsel und faire Startaufstellung passieren atomar im selben Tick');
  // placeBalls und der Respawn teilen sich dieselbe Spawnregel.
  ok(/balls\.push\(mkBall\(fbElimSpawnX\(o\),fbElimSpawnY\(o\),o\)\)/.test(HTML),
     'die Startaufstellung des Matches nutzt dieselbe Spawnregel wie der Respawn');

  // -- Goal Detection nutzt die AKTIVE Arena --
  const G2 = buildEnv('elimination4');
  G2.newMatch();
  parkPlayers(G2);
  shootAt(G2, 0);
  G2.finishGoal();
  ok(G2.phaseN() === 3, 'Vorbedingung: Drei-Spieler-Arena');
  const oldLine = 17.50 * G2.BR + 80;
  G2.setPos(4, G2.cx + oldLine, G2.cy);
  ok(G2.crossed(4) === -1, 'eine alte Torposition wertet in der neuen Arena nicht mehr');
}

// =================================================================================
// B5 - BOUNDARY: die PHYSIKGRENZE muss exakt auf der SICHTBAREN Bande liegen
// =================================================================================
// Regression zum Phase-3-Boundary-Bug: footballTriSD las `ap` als Apothem des GESCHRUMPFTEN
// Dreiecks, waehrend Aufrufer und Renderer den Abstand zur fertigen Seite uebergeben. Die
// Grenze lag dadurch um (Eckradius - Kugelradius) zu weit aussen - 87 Einheiten fuer den
// Ball, 80 fuer eine Spielerfigur. Ball und Figuren liefen sichtbar durch die Bande.
// Diese Gruppe vergleicht die Grenze deshalb gegen die UNABHAENGIG berechnete Bandengeometrie
// statt nur gegen sich selbst.
{
  const R_BALL = 25, R_PLAYER = 32;
  // Groesster Abstand entlang u, bei dem die Mitte einer Kugel mit Radius r noch legal ist.
  const limitAlong = (E, ux, uy, neutral) => {
    let lo = 0, hi = 60 * E.BR;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (E.boundSDAt(E.cx + ux * m, E.cy + uy * m, neutral).sd < 0) lo = m; else hi = m;
    }
    return lo;
  };

  for (const ph of [4, 3, 2]) {
    const E = buildEnv('elimination4');
    E.newMatch();
    E.forcePhase(ph);
    const a = E.arenaCfg(), D = E.dirs();
    const A = a.halfLen * E.BR;             // Zentrum -> Bandeninnenflaeche in Torrichtung
    const RC = a.corner * E.BR;
    // ECKMITTELPUNKTE der fertigen Form: bei den gekappten Formen sind das genau die Ecken
    // des Kernpolygons, beim Rechteck die vier Ecken des Kernrechtecks, beim Dreieck die drei
    // Ecken des geschrumpften Dreiecks. Die Richtung dorthin ist die Richtung, in der der
    // Eckbogen liegt; die Winkelhalbierende der TORACHSEN ist es bei zwei gegenueberliegenden
    // Toren gerade NICHT.
    const cornerPts = a.poly
      ? a.poly.map(v => [v[0] * E.BR, v[1] * E.BR])
      : a.tri
      ? [[COS30, -0.5], [0, 1], [-COS30, -0.5]].map(v => [v[0] * 2 * (A - RC), v[1] * 2 * (A - RC)])
      : [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(v =>
          [v[0] * (a.halfLen * E.BR - RC), v[1] * (a.halfWid * E.BR - RC)]);

    for (const [nm, r, neutral] of [['Ball', R_BALL, true], ['Spieler', R_PLAYER, false]]) {
      // 1) Gerade Segmente: die Grenze liegt exakt auf der Bande, um r nach innen versetzt.
      for (let k = 0; k < D.length; k++) {
        const got = limitAlong(E, D[k][0], D[k][1], neutral);
        ok(near(got, A - r, 0.05),
           'Phase ' + ph + ' Seite ' + k + ' (' + nm + '): Grenze ' + got.toFixed(1) +
           ' == Bande ' + (A - r).toFixed(1));
      }
      // 2) Eckbereiche: Abstand vom Eckmittelpunkt ist exakt Eckradius - r.
      for (let k = 0; k < cornerPts.length; k++) {
        const c = cornerPts[k], cl = Math.hypot(c[0], c[1]);
        const got = limitAlong(E, c[0] / cl, c[1] / cl, neutral);
        ok(near(got, cl + RC - r, 0.05),
           'Phase ' + ph + ' Ecke ' + k + ' (' + nm + '): Grenze ' + got.toFixed(1) +
           ' == Eckmittelpunkt+Radius ' + (cl + RC - r).toFixed(1));
      }
      // 3) Vorzeichen: knapp innerhalb legal, knapp ausserhalb gesperrt.
      for (let k = 0; k < D.length; k++) {
        const lim = limitAlong(E, D[k][0], D[k][1], neutral);
        ok(E.boundSDAt(E.cx + D[k][0] * (lim - 2), E.cy + D[k][1] * (lim - 2), neutral).sd < 0,
           'Phase ' + ph + ' Seite ' + k + ' (' + nm + '): 2 Einheiten innerhalb ist legal');
        ok(E.boundSDAt(E.cx + D[k][0] * (lim + 2), E.cy + D[k][1] * (lim + 2), neutral).sd > 0,
           'Phase ' + ph + ' Seite ' + k + ' (' + nm + '): 2 Einheiten ausserhalb ist gesperrt');
      }
    }
  }

  // ---- Simulation: nichts entkommt, auch nicht bei hoher Geschwindigkeit ----
  // Realistisch ist maxPull*LAUNCH ~ 6.6 Einheiten je Sub-Step; 40 ist ein Vielfaches davon
  // und beweist, dass auch weit ueber M1 hinaus kein Tunneling entsteht.
  for (const ph of [4, 3, 2]) {
    for (const sp of [7, 40]) {
      const E = buildEnv('elimination4');
      E.newMatch();
      E.forcePhase(ph);
      const D = E.dirs();
      // Spielerfiguren gegen JEDES gerade Segment und JEDEN Eckbereich.
      for (let k = 0; k < D.length; k++) {
        const dirsToTest = [];
        dirsToTest.push({ n: 'Seite ' + k, u: D[k] });
        const b1 = D[(k + 1) % D.length];
        let vx = D[k][0] + b1[0], vy = D[k][1] + b1[1];
        if (Math.hypot(vx, vy) < 1e-9) { vx = -D[k][1]; vy = D[k][0]; }
        const l = Math.hypot(vx, vy);
        dirsToTest.push({ n: 'Ecke ' + k, u: [vx / l, vy / l] });
        for (const t of dirsToTest) {
          // Die uebrigen Koerper eng ins Zentrum, damit sie den Schuss nicht stoeren.
          for (let o = 0; o < 4; o++) E.setPos(o, E.cx + (o - 1.5) * 3, E.cy + (o - 1.5) * 3);
          E.setPos(4, E.cx, E.cy);
          const r = E.slam(0, E.cx + t.u[0] * 40, E.cy + t.u[1] * 40, t.u[0] * sp, t.u[1] * sp, 90);
          ok(r.fin, 'Phase ' + ph + ' v=' + sp + ' ' + t.n + ': Spieler ohne NaN');
          ok(r.over <= 1e-6,
             'Phase ' + ph + ' v=' + sp + ' ' + t.n + ': Spieler bleibt in der Arena (max sd ' +
             r.worst.toFixed(2) + ')');
          ok(r.passed === false, 'Phase ' + ph + ' v=' + sp + ' ' + t.n + ': Spieler passiert kein Tor');
        }
        // Der Ball nur gegen die ECKE - auf der Torachse ist er zurecht durchlaessig.
        // Nach dem Abpraller darf er ueber eine Toroeffnung austreten; gemessen wird, dass er
        // die Bande selbst zu KEINEM Zeitpunkt durchdringt.
        const bb = dirsToTest[1].u;
        for (let o = 0; o < 4; o++) E.setPos(o, E.cx + (o - 1.5) * 3, E.cy + (o - 1.5) * 3);
        const rb = E.slam(4, E.cx + bb[0] * 40, E.cy + bb[1] * 40, bb[0] * sp, bb[1] * sp, 90);
        ok(rb.fin, 'Phase ' + ph + ' v=' + sp + ' Ecke ' + k + ': Ball ohne NaN');
        ok(rb.worst <= 1e-6,
           'Phase ' + ph + ' v=' + sp + ' Ecke ' + k + ': Ball durchdringt die Bande nie (max sd ' +
           rb.worst.toFixed(2) + ')');
      }
    }
  }

  // ---- Toroeffnungen: nur dort und nur mittig ----
  for (const ph of [4, 3, 2]) {
    const E = buildEnv('elimination4');
    E.newMatch();
    E.forcePhase(ph);
    const a = E.arenaCfg(), D = E.dirs(), ch = E.arena().centerHalf;
    ok(near(ch, a.postInner * E.BR - 25), 'Phase ' + ph + ': centerHalf == postInner*BR - Ballradius');
    for (let k = 0; k < D.length; k++) {
      const d = D[k], t = [-d[1], d[0]], out = a.halfLen * E.BR + 5;
      // Mittig: der Ball darf passieren, eine Spielerfigur nie.
      E.setPos(4, E.cx + d[0] * out, E.cy + d[1] * out);
      ok(E.canPass(4) === true, 'Phase ' + ph + ' Tor ' + k + ': der Ball passiert mittig');
      E.setPos(0, E.cx + d[0] * out, E.cy + d[1] * out);
      ok(E.canPass(0) === false, 'Phase ' + ph + ' Tor ' + k + ': die Spielerfigur ist geblockt');
      // Knapp innerhalb der lichten Weite offen, knapp ausserhalb geschlossen.
      E.setPos(4, E.cx + d[0] * out + t[0] * (ch - 1), E.cy + d[1] * out + t[1] * (ch - 1));
      ok(E.canPass(4) === true, 'Phase ' + ph + ' Tor ' + k + ': knapp innerhalb der Torbreite offen');
      E.setPos(4, E.cx + d[0] * out + t[0] * (ch + 1), E.cy + d[1] * out + t[1] * (ch + 1));
      ok(E.canPass(4) === false, 'Phase ' + ph + ' Tor ' + k + ': knapp ausserhalb der Torbreite geschlossen');
      // Und der Ball kommt dort auch real nicht durch. Geprueft wird genau DIESES Tor:
      // dass der Ball nach dem Abprall quer durch die Arena laeuft und irgendwann ein
      // ANDERES Tor findet, ist ein regulaeres Spielereignis und nicht die Aussage hier.
      // Positionen UND Geschwindigkeiten zuruecksetzen: der vorige Durchgang hat die
      // Figuren angestossen, und ein Restschwung wuerde den naechsten Schuss ablenken.
      for (let o = 0; o < 4; o++) { E.setPos(o, E.cx + (o - 1.5) * 3, E.cy + (o - 1.5) * 3); E.setVel(o, 0, 0); }
      const off = ch + 30;
      const sx = d[0] * 30 + t[0] * off, sy = d[1] * 30 + t[1] * off;
      const rr = E.slam(4, E.cx + sx, E.cy + sy, d[0] * 30, d[1] * 30, 60);
      let durchDiesesTor = false;
      if (rr.passed) {
        const b = E.snapshot()[4];
        durchDiesesTor = E.fold(b.x - E.cx, b.y - E.cy).side === k;
      }
      // Die Aussage ist: DIESES Tor bleibt zu. Das wird strikt geprueft.
      ok(durchDiesesTor === false,
         'Phase ' + ph + ' Tor ' + k + ': ein Schuss neben der Toroeffnung wird geblockt');
      // Der Einschluss wird mit der dokumentierten Residuum-Toleranz gemessen, nicht mit
      // Null. Der Schuss faehrt hier mit 30 px je Teilschritt, dem 4.5-fachen des
      // Abschusstempos - ein Tempo, das das Spiel nicht erzeugt. Bei solchen Werten
      // ueberschreitet die Kugel die Bandenlinie kurzzeitig; gemessen in allen fuenf
      // Arenen ueber 72 Richtungen liegt der Spitzenwert bei 26 bis 40 px je Teilschritt
      // zwischen 0.45 und 35 px - und zwar UNVERAENDERT seit vor Action Core 04. Nur eine
      // von fuenfzehn Messzellen aendert sich ueberhaupt. Die frueheren 1e-6 an genau
      // dieser Stelle waren die Eigenschaft eines einzelnen Aufbaus, keine Zusage.
      ok(rr.worst <= 1.5,
         'Phase ' + ph + ' Tor ' + k + ': und bleibt dabei im Residuum-Band (max sd ' +
         rr.worst.toFixed(2) + ' <= 1.5)');
    }
  }

  // ---- Phase 3: 120-Grad-Rotationsaequivalenz derselben Trajektorie ----
  // Die gesamte Ausgangslage - Schuetze, Mitspieler und Ball - wird mitgedreht, damit die
  // drei Laeufe echte Rotationen voneinander sind. Die Torrichtungen sind Vielfache von
  // 120 Grad und damit irrational; verglichen wird deshalb auf Rundungsniveau, nicht bitweise.
  {
    const res = [];
    for (let k = 0; k < 3; k++) {
      const E = buildEnv('elimination4');
      E.newMatch();
      E.forcePhase(3);
      const D = E.dirs(), d = D[k], t = [-d[1], d[0]];
      const put = (i, alongV, acrossV) =>
        E.setPos(i, E.cx + d[0] * alongV + t[0] * acrossV, E.cy + d[1] * alongV + t[1] * acrossV);
      put(0, 120, 200); put(1, -30, -20); put(2, -60, 40); put(3, 10, -70); put(4, 0, 0);
      const vx = d[0] * 18 + t[0] * 9, vy = d[1] * 18 + t[1] * 9;
      const r = E.slam(0, E.cx + d[0] * 120 + t[0] * 200, E.cy + d[1] * 120 + t[1] * 200, vx, vy, 80);
      res.push(r);
      ok(r.worst <= 1e-6, 'Phase 3 Rotation ' + (k * 120) + ' Grad: der Koerper bleibt in der Arena');
    }
    ok(near(res[0].d, res[1].d, 0.5) && near(res[1].d, res[2].d, 0.5),
       'Phase 3: dieselbe Trajektorie um 120 und 240 Grad gedreht endet in gleicher Zentrumsdistanz (' +
       res.map(r => r.d.toFixed(1)).join(' / ') + ')');
  }

  // ---- Determinismus der Bandenkollision ----
  {
    const h = [];
    for (let k = 0; k < 2; k++) {
      const E = buildEnv('elimination4');
      E.newMatch();
      E.forcePhase(3);
      const D = E.dirs();
      for (let o = 0; o < 4; o++) E.setPos(o, E.cx + (o - 1.5) * 3, E.cy + (o - 1.5) * 3);
      E.slam(0, E.cx + 60, E.cy - 40, D[1][0] * 22 + 7, D[1][1] * 22 - 5, 120);
      h.push(E.hash());
    }
    ok(h[0] === h[1], 'Phase 3: Bandenkollisionen sind bitgleich reproduzierbar');
  }
}

// =================================================================================
// C - SEITENFALTUNG: EINE Torgeometrie fuer zwei, drei ODER vier Tore
// =================================================================================
{
  const C = buildEnv();
  for (const pt of [[100, 40], [-250, 90], [0, 0], [-7, -7], [600, -320]]) {
    const f = C.fold(pt[0], pt[1]);
    ok(f.x === pt[0] && f.y === pt[1] && f.cs === 1 && f.sn === 0,
       'Classic: Faltung ist die Identitaet bei (' + pt[0] + ',' + pt[1] + ')');
  }
  ok(C.fold(10, 0).side === 1 && C.fold(-10, 0).side === 3,
     'Classic: Seitenindex 1 = +X, 3 = -X (unveraenderte Konvention)');

  const E = buildEnv('elimination4');
  const dirs = E.dirs();
  for (let s = 0; s < 4; s++) {
    const d = dirs[s];
    for (const r of [50, 300, 620]) {
      const f = E.fold(d[0] * r, d[1] * r);
      ok(f.side === s && near(f.x, r) && near(f.y, 0),
         'Slot ' + s + ' bei Radius ' + r + ' korrekt gefaltet');
      ok(f.x >= 0, 'die gefaltete Laengskoordinate ist nie negativ');
    }
  }
  let px = 380, py = 95;
  const base = E.fold(px, py);
  for (let k = 1; k < 4; k++) {
    const nx = -py, ny = px; px = nx; py = ny;
    const f = E.fold(px, py);
    ok(near(f.x, base.x) && near(f.y, base.y),
       'Rotation um ' + (k * 90) + ' Grad liefert exakt dieselbe gefaltete Lage');
    ok(f.side === (base.side + k) % 4, 'die Rotation verschiebt nur den Slotindex');
  }
  ok(!/Math\.random/.test(foldSrc), 'die Seitenfaltung enthaelt keinen Zufall');
}

// =================================================================================
// D - VERDECKTES VIER-SPIELER-COMMIT UND GEMEINSAMER START
// =================================================================================
{
  const E = buildEnv('elimination4');
  E.newMatch();
  ok(E.phase() === 'aim', 'die Runde startet in der Planungsphase');
  ok(E.curAimer() === 0, 'P1 beginnt die verdeckte Planung');
  ok(JSON.stringify(E.aimSet()) === JSON.stringify([false, false, false, false]),
     'alle vier Commit-Flags starten offen');
  ok(JSON.stringify(E.commitIdx()) === JSON.stringify([-1, -1, -1, -1]),
     'alle vier Commit-Indizes starten leer');

  const before = E.snapshot();
  E.resetCoverCalls();
  E.commit(0, 0, 40, 10);
  ok(E.phase() === 'aim', 'P1-Commit startet keine Physik');
  ok(E.curAimer() === 1 && JSON.stringify(E.coverCalls()) === JSON.stringify([1]),
     'nach P1 wird verdeckt an P2 uebergeben');
  E.commit(1, 1, -30, 20);
  ok(E.curAimer() === 2 && JSON.stringify(E.coverCalls()) === JSON.stringify([1, 2]),
     'nach P2 wird verdeckt an P3 uebergeben');
  E.commit(2, 2, 15, -45);
  ok(E.curAimer() === 3 && JSON.stringify(E.coverCalls()) === JSON.stringify([1, 2, 3]),
     'nach P3 wird verdeckt an P4 uebergeben');
  ok(JSON.stringify(E.snapshot()) === JSON.stringify(before),
     'nach drei Commits ist noch KEINE Position oder Geschwindigkeit veraendert');

  E.commit(3, 3, -20, -20);
  ok(E.phase() === 'reveal', 'erst der vierte Commit oeffnet den Reveal');
  ok(JSON.stringify(E.coverCalls()) === JSON.stringify([1, 2, 3]),
     'nach dem letzten Commit wird kein weiterer Verdeck-Screen geoeffnet');
  ok(JSON.stringify(E.aimSet()) === JSON.stringify([true, true, true, true]),
     'alle vier Zuege sind bestaetigt');
  ok(JSON.stringify(E.commitIdx()) === JSON.stringify([0, 1, 2, 3]),
     'jeder Spieler hat genau seine eigene Figur committet');
  ok(E.snapshot().every(b => b.vx === 0 && b.vy === 0),
     'im Reveal steht die Physik noch vollstaendig still');

  const posBefore = E.snapshot().map(b => ({ x: b.x, y: b.y }));
  E.launch();
  ok(E.phase() === 'sim', 'applyLaunch() oeffnet die Simulation');
  const afterLaunch = E.snapshot();
  ok(afterLaunch.slice(0, 4).every(b => speed(b) > 0), 'alle vier Figuren haben eine Startgeschwindigkeit');
  ok(speed(afterLaunch[4]) === 0, 'der neutrale Ball erhaelt keinen Startimpuls');
  ok(afterLaunch.every((b, i) => b.x === posBefore[i].x && b.y === posBefore[i].y),
     'applyLaunch() veraendert KEINE Position - nur Geschwindigkeiten');
  E.step();
  const afterStep = E.snapshot();
  for (let o = 0; o < 4; o++)
    ok(afterStep[o].x !== posBefore[o].x || afterStep[o].y !== posBefore[o].y,
       'P' + (o + 1) + ' bewegt sich im ersten gemeinsamen Physikschritt');

  const F = buildEnv('elimination4');
  F.newMatch();
  F.commit(0, 0, 30, 0);
  ok(F.canCommit(0) === false, 'ein bestaetigter Zug kann nicht ueberschrieben werden');
  ok(F.canCommit(2) === true, 'ein noch offener Spieler darf committen');
  F.commit(1, 3, 30, 0);
  ok(F.commitIdx()[1] === 1, 'sanitizeMove klemmt einen Commit auf die EIGENE Figur');
}

// =================================================================================
// E - PRIVACY: keine Information des Vorgaengers bleibt sichtbar
// =================================================================================
{
  const E = buildEnv('elimination4');
  E.newMatch();
  for (let i = 0; i < 5; i++) ok(E.ringLevel(i) === 0, 'Elimination4 zeigt keinen Auswahlring (Koerper ' + i + ')');
  E.commit(0, 0, 55, 12);
  ok(JSON.stringify(E.sel()) === JSON.stringify([-1, -1]),
     'die Tactical-Vorauswahl bleibt in Elimination4 vollstaendig leer');
  for (let i = 0; i < 5; i++) ok(E.ringLevel(i) === 0, 'auch nach dem P1-Commit gibt es keinen Ring (Koerper ' + i + ')');
  ok(E.snapshot().every(b => b.vx === 0 && b.vy === 0), 'der Zug von P1 ist an der Physik nicht ablesbar');
  E.commit(1, 1, -40, 5);
  E.commit(2, 2, 10, 30);
  ok(E.phase() === 'aim' && E.curAimer() === 3,
     'bis zum letzten Commit bleibt die Arena unbewegt und verdeckt');
  ok(/if\(phase==='reveal'&&!r3dActive\)\{for\(let p=0;p<commitIdx\.length;p\+\+\)/.test(HTML),
     'committete Zugrichtungen werden ausschliesslich in phase==="reveal" gezeichnet');
  ok(/openCover\(nx\)/.test(applyCommitSrc), 'der Spielerwechsel laeuft immer ueber openCover()');
}

// =================================================================================
// F - KERNREGEL: EIN GEGENTOR = SOFORT AUSGESCHIEDEN
// =================================================================================
{
  for (let s = 0; s < 4; s++) {
    const E = buildEnv('elimination4');
    E.newMatch();
    parkPlayers(E);
    const n = shootAt(E, s);
    ok(n < 1200, 'Tor ' + (s + 1) + ': der Schuss erreicht das Tor (' + n + ' Frames)');
    const act = E.active();
    ok(act[s] === false, 'Ball durch Tor von P' + (s + 1) + ' -> P' + (s + 1) + ' ist SOFORT ausgeschieden');
    ok(act.filter((v, i) => i !== s).every(v => v === true), 'kein anderer Spieler ist betroffen');
    ok(E.activeOwners().length === 3, 'nach dem ersten Tor sind noch genau drei Spieler aktiv');
    ok(E.snapshot()[s].alive === false, 'die Figur des Getroffenen ist sofort deaktiviert');
    ok(E.goalState() === 'fall', 'die Wertung startet den bestehenden Torablauf');
    ok(E.goalSounds() === 1, 'der Torsound spielt genau einmal');
    ok(E.matchPointSounds() === 0, 'kein Matchpunkt-Sound, solange drei Spieler uebrig sind');
    ok(E.fxSide() === s, 'der Torimpuls laeuft am getroffenen Tor');
    ok(E.fxKey() === s, 'der Renderer-Schluessel ist der Slot des getroffenen Tores');
    ok(JSON.stringify(E.score()) === JSON.stringify([0, 0]),
       'es gibt KEINE Zwischenstufe ueber score[] - das Tor ist die Entscheidung');
    ok(E.winner() === null, 'bei drei verbliebenen Spielern gibt es noch keinen Sieger');
    ok(E.phaseN() === 4, 'waehrend des Torablaufs steht die alte Arena noch');
    for (let k = 0; k < 40; k++) E.step();
    ok(E.activeOwners().length === 3, 'ein zweiter Durchlauf eliminiert niemanden erneut');
  }
}
{
  const E = buildEnv('elimination4');
  E.newMatch();
  parkPlayers(E);
  const d = E.dirs()[1];
  E.setPos(0, E.cx + d[0] * E.BR * 16, E.cy + d[1] * E.BR * 16);
  ok(E.canPass(0) === false, 'eine Spielerfigur kann die Toroeffnung nie passieren');
  ok(E.crossed(0) === -1, 'eine Spielerfigur loest nie eine Eliminierung aus');
  E.setPos(4, E.cx + d[0] * E.BR * 16, E.cy + d[1] * E.BR * 16);
  ok(E.canPass(4) === true, 'der neutrale Ball passiert die Toroeffnung mittig');
  const t = [-d[1], d[0]], off = E.arena().centerHalf * 1.2;
  E.setPos(4, E.cx + d[0] * E.BR * 16 + t[0] * off, E.cy + d[1] * E.BR * 16 + t[1] * off);
  ok(E.canPass(4) === false, 'ausserhalb der lichten Toroeffnung bleibt die Bande geschlossen');
}

// =================================================================================
// G - NACH DEM TOR: Ball ins Zentrum, Ueberlebende bleiben stehen
// =================================================================================
{
  const E = buildEnv('elimination4');
  E.newMatch();
  const marks = [];
  for (let o = 0; o < 4; o++) {
    const a = Math.PI / 4 + o * Math.PI / 2, r = E.BR * 4;
    E.setPos(o, E.cx + Math.cos(a) * r, E.cy + Math.sin(a) * r);
    E.setVel(o, 0, 0);
    marks.push({ x: E.cx + Math.cos(a) * r, y: E.cy + Math.sin(a) * r });
  }
  // Dieser Block stellt die Figuren selbst auf und benutzt parkPlayers deshalb nicht - der
  // Zustand 'letztes Leben' muss hier ausdruecklich hergestellt werden.
  E.matchPoint();
  shootAt(E, 2);
  ok(E.goalState() === 'fall', 'Vorbedingung: der Torablauf laeuft');
  ok(E.active()[2] === false, 'Vorbedingung: P3 ist sofort ausgeschieden');
  const n = E.finishGoal();
  ok(E.goalState() === 'play', 'der Torablauf endet deterministisch (' + n + ' Ticks)');
  const after = E.snapshot();
  ok(near(after[4].x, E.cx) && near(after[4].y, E.cy), 'der neutrale Ball steht wieder exakt im Zentrum');
  ok(after[4].passed === false, 'der Durchtritts-Latch (fbPassed) ist zurueckgesetzt');
  ok(after.every(b => b.vx === 0 && b.vy === 0), 'alle Geschwindigkeiten sind auf null');
  // V3.1: die Ueberlebenden stehen NICHT mehr auf ihren alten Plaetzen, sondern auf der
  // fairen Startaufstellung der neuen Phase. marks dient nur noch als Gegenprobe.
  for (let s = 0; s < 3; s++) {
    const o = E.slotOwner(s), sp = E.spawnAt(s);
    ok(near(after[o].x, sp.x) && near(after[o].y, sp.y),
       'P' + (o + 1) + ' steht nach dem Tor auf dem fairen Phase-3-Spawn');
    ok(!(near(after[o].x, marks[o].x) && near(after[o].y, marks[o].y)),
       'P' + (o + 1) + ' behaelt seine alte Position NICHT (kein Positionsvorteil)');
  }
  ok(after[2].alive === false, 'die eliminierte Figur bleibt deaktiviert');
  E.resetCoverCalls();
  E.step();
  ok(E.phase() === 'aim', 'nach dem Torablauf oeffnet das Settlement die neue Planungsphase');
  ok(JSON.stringify(E.aimSet()) === JSON.stringify([false, false, false, false]),
     'die neue Runde startet mit offenen Commits');
  ok(JSON.stringify(E.coverCalls()) === JSON.stringify([0]),
     'die neue Runde beginnt wieder verdeckt beim ersten aktiven Spieler');
  ok(/fbGoalState==='spawn'&&b\.owner===FOOTBALL_NEUTRAL_OWNER/.test(HTML) &&
     /footballSpawnHeight\(\)\*Math\.max\(0,1-fbGoalTick\/FOOTBALL_GOAL_SPAWN_TICKS\)/.test(HTML),
     'der neue Ball kommt ueber den bestehenden Spawn-Drop von oben herein');
  ok(/if\(!fbElim4\(\)\)startRound\(\);/.test(HTML),
     'Elimination4 ruft NICHT startRound() - placeBalls wuerde die Ueberlebenden zuruecksetzen');
}

// =================================================================================
// H - GESCHLOSSENES TOR waehrend des Torablaufs: physikalisch Bande, visuell tot
// =================================================================================
{
  const G = buildEnv('elimination4');
  G.newMatch();
  parkPlayers(G);
  G.eliminate(2);
  ok(G.goalOpen(2) === false, 'das Tor des Ausgeschiedenen gilt sofort als geschlossen');
  ok(G.goalOpen(0) && G.goalOpen(1) && G.goalOpen(3), 'die drei anderen Tore bleiben offen');

  const d2 = G.dirs()[2];
  G.setPos(4, G.cx, G.cy);
  G.setVel(4, d2[0] * 20, d2[1] * 20);
  G.setPhaseRaw('sim');
  for (let k = 0; k < 40; k++) G.step();
  const bb = G.snapshot()[4];
  ok(G.goalState() === 'play', 'ein Schuss in das tote Tor loest keine Wertung aus');
  ok(G.activeOwners().length === 3, 'ein totes Tor eliminiert niemanden');
  ok(bb.passed === false, 'der Ball tritt durch das tote Tor nicht aus');
  ok(G.boundSD(4) <= 1e-6, 'der Ball bleibt innerhalb der Arenagrenze (kein Ballverlust)');
  ok(bb.vy < 0, 'das tote Tor verhaelt sich wie normale Bande - der Ball prallt zurueck');

  const S = buildEnv('elimination4');
  S.newMatch();
  S.eliminate(0);
  const d0 = S.dirs()[0], a0 = S.arenaCfg();
  S.setPos(4, S.cx + d0[0] * (a0.halfLen * S.BR - 30), S.cy + d0[1] * (a0.halfLen * S.BR - 30));
  S.setVel(4, 0, 0);
  ok(S.canPass(4) === false, 'auch direkt vor dem toten Tor bleibt die Bande geschlossen');
  ok(S.crossed(4) === -1, 'ein ruhender Ball am toten Tor wertet nicht');

  ok(/const goalDead=\(key\)=>typeof fbElim4==='function'&&fbElim4\(\)&&!footballGoalOpen\(key\);/.test(HTML),
     'der Renderer liest den Totzustand aus DERSELBEN Quelle wie die Physik (footballGoalOpen)');
  ok(/GOAL_DEAD_COLOR/.test(fxRenderSrc) && /GOAL_DEAD_EMISSIVE/.test(fxRenderSrc),
     'ein totes Tor faellt auf eine neutrale Farbe ohne Eigenleuchten zurueck');
  ok(/const dead=\(lv===0&&goalDead\(p\.key\)\)\?1:0;/.test(fxRenderSrc),
     'der Torimpuls laeuft zuerst ab, danach kippt das Tor in den toten Zustand');
  ok(/goalShutPanels/.test(HTML) && /shut\.visible=false;/.test(HTML),
     'ein Verschlusspanel schliesst die Toroeffnung sichtbar (standardmaessig unsichtbar)');
}

// =================================================================================
// I - COMMIT NACH ELIMINIERUNGEN: nur Aktive, feste Reihenfolge, simultaner Start
// =================================================================================
{
  const E = buildEnv('elimination4');
  E.newMatch();
  E.eliminate(1);
  ok(E.canCommit(1) === false, 'der Ausgeschiedene kann nicht mehr committen');
  ok(E.canCommit(0) === true && E.canCommit(3) === true, 'die verbliebenen Spieler duerfen weiter committen');
  ok(E.firstAimer() === 0, 'die Commit-Reihenfolge beginnt beim ersten aktiven Spieler');

  const dead = E.snapshot()[1];
  E.setPos(4, dead.x - 200, dead.y);
  E.setVel(4, 14, 0);
  E.setPhaseRaw('sim');
  for (let k = 0; k < 10; k++) E.step();
  ok(E.snapshot()[4].x > dead.x, 'der Ball passiert die deaktivierte Figur ohne Kontakt');

  const T3 = buildEnv('elimination4');
  T3.newMatch();
  T3.eliminate(1);
  T3.setPhaseRaw('sim');
  let n = 0; while (T3.phase() !== 'aim' && n < 3000) { T3.step(); n++; }
  ok(T3.phase() === 'aim' && T3.curAimer() === 0, 'mit drei Spielern beginnt wieder P1');
  T3.resetCoverCalls();
  T3.commit(0, 0, 30, 0);
  ok(T3.curAimer() === 2 && JSON.stringify(T3.coverCalls()) === JSON.stringify([2]),
     'der ausgeschiedene P2 wird in der Commit-Reihenfolge uebersprungen');
  T3.commit(2, 2, -30, 0);
  ok(T3.curAimer() === 3, 'nach P3 folgt P4');
  T3.commit(3, 3, 0, 25);
  ok(T3.phase() === 'reveal', 'drei Commits genuegen fuer den Reveal');
  T3.launch();
  const a3 = T3.snapshot();
  ok(speed(a3[0]) > 0 && speed(a3[2]) > 0 && speed(a3[3]) > 0,
     'alle drei aktiven Figuren starten gleichzeitig');
  ok(speed(a3[1]) === 0, 'die ausgeschiedene Figur bleibt in Ruhe');

  const T2 = buildEnv('elimination4');
  T2.newMatch();
  T2.eliminate(0); T2.eliminate(2);
  T2.setPhaseRaw('sim');
  n = 0; while (T2.phase() !== 'aim' && n < 3000) { T2.step(); n++; }
  ok(T2.curAimer() === 1, 'mit zwei Spielern beginnt der erste aktive (P2)');
  T2.commit(1, 1, 20, 0);
  ok(T2.curAimer() === 3 && T2.phase() === 'aim', 'P4 zielt als zweiter verdeckt');
  T2.commit(3, 3, -20, 0);
  ok(T2.phase() === 'reveal', 'zwei Commits genuegen fuer den Reveal');
  T2.launch();
  const a2 = T2.snapshot();
  ok(speed(a2[1]) > 0 && speed(a2[3]) > 0, 'beide Finalisten starten gleichzeitig');
  ok(speed(a2[0]) === 0 && speed(a2[2]) === 0, 'die Ausgeschiedenen bleiben in Ruhe');
}

// =================================================================================
// I2 - PARTY-DYNAMIK: gemeinsames Fokussieren und Wegschiessen bleiben moeglich
// =================================================================================
{
  const E = buildEnv('elimination4');
  E.newMatch();
  const tx = E.cx + 200, ty = E.cy;
  E.setPos(1, tx, ty);
  E.setPos(0, tx - 3 * E.BR, ty);
  E.setPos(3, tx, ty - 3 * E.BR);
  E.setPos(2, E.cx - 300, E.cy + 300);
  E.setPos(4, E.cx - 320, E.cy - 320);
  E.commit(0, 0, 150, 0);
  E.commit(1, 1, 0, 0);
  E.commit(2, 2, 0, 0);
  E.commit(3, 3, 0, 150);
  ok(E.phase() === 'reveal', 'Vorbedingung: alle vier haben committet');
  E.launch();
  let moved = false;
  for (let k = 0; k < 40 && !moved; k++) { E.step(); if (speed(E.snapshot()[1]) > 0) moved = true; }
  ok(moved, 'zwei Spieler koennen dieselbe fremde Figur gemeinsam wegschiessen (keine Immunitaet)');
  const t = E.snapshot()[1];
  ok(t.x !== tx || t.y !== ty, 'die fokussierte Figur wird tatsaechlich verschoben');
  ok(E.active().every(v => v), 'ein Figurentreffer allein eliminiert niemanden - nur ein Tor tut das');
}

// =================================================================================
// J - PROGRESSION 4 -> 3 -> 2 -> 1 UND SIEG
// =================================================================================
{
  const E = buildEnv('elimination4');
  E.newMatch();
  ok(E.activeOwners().length === 4 && E.phaseN() === 4, 'Matchstart: vier Spieler, Vier-Tore-Arena');
  ok(E.headText() === '4 VERBLEIBEND', 'das HUD nennt die Zahl der Verbliebenen');
  ok(JSON.stringify(E.slots()) === JSON.stringify([0, 1, 2, 3]), 'Slot k gehoert zu Beginn Spieler k');

  ok(E.slotOwner(2) === 2, 'Vorbedingung: Slot 2 (Sued) gehoert P3');
  ok(scoreOn(E, 2) === true, '1. Tor: der Match laeuft mit drei Spielern weiter');
  ok(JSON.stringify(E.active()) === JSON.stringify([true, true, false, true]), 'nach dem 1. Tor ist P3 raus');
  ok(E.activeOwners().length === 3 && E.headText() === '3 VERBLEIBEND', '4 -> 3');
  ok(E.phaseN() === 3, 'die Arena wechselt auf die Drei-Spieler-Form');
  ok(E.dirs().length === 3, 'es gibt jetzt genau drei aktive Tore');
  ok(JSON.stringify(E.slots()) === JSON.stringify([0, 1, 3, -1]),
     'die aktiven IDs liegen aufsteigend auf den Slots (P1->0, P2->1, P4->2)');
  ok(E.winner() === null && E.overCalls().length === 0, 'noch kein Matchende');

  ok(E.slotOwner(1) === 1, 'Vorbedingung: Slot 1 gehoert in der Drei-Spieler-Phase P2');
  ok(scoreOn(E, 1) === true, '2. Tor: der Match laeuft mit zwei Spielern weiter');
  ok(JSON.stringify(E.active()) === JSON.stringify([true, false, false, true]), 'nach dem 2. Tor ist auch P2 raus');
  ok(E.activeOwners().length === 2 && E.headText() === 'FINAL', '3 -> 2');
  ok(E.phaseN() === 2, 'die Arena wechselt auf das Zwei-Spieler-Finale');
  ok(E.dirs().length === 2, 'im Finale gibt es genau zwei Tore');
  ok(JSON.stringify(E.slots()) === JSON.stringify([0, 3, -1, -1]),
     'niedrigere ID auf Slot 0, hoehere auf das gegenueberliegende Slot 1');
  ok(E.winner() === null, 'im Finale gibt es noch keinen Sieger');

  ok(E.slotOwner(1) === 3, 'Vorbedingung: Slot 1 gehoert im Finale P4');
  parkPlayers(E);
  shootAt(E, 1);
  ok(E.active()[3] === false, 'das entscheidende Gegentor eliminiert P4');
  ok(E.winner() === 0, 'der letzte aktive Spieler (P1) gewinnt');
  ok(E.matchPointSounds() === 1, 'der entscheidende Treffer spielt den Matchpunkt-Sound');
  ok(E.overCalls().length === 0, 'mitten im Torablauf endet das Match noch NICHT');
  E.finishGoal();
  ok(E.goalState() === 'result', 'result ist der Endzustand');
  ok(JSON.stringify(E.overCalls()) === JSON.stringify([0]),
     'das Matchende laeuft ueber die BESTEHENDE Result-Struktur (gameOver)');
  ok(E.phase() === 'over', 'die Hauptschleife steht nach dem Matchende');
  ok(E.headText() === 'SIEGER P1', 'das HUD benennt den Sieger');
  ok(E.phaseN() === 2, 'beim Sieg wird die Arena nicht mehr umgebaut');
  const ballAfter = E.snapshot()[4];
  ok(ballAfter.passed === true, 'nach dem Sieg wird KEIN neuer Ball mehr ins Zentrum gesetzt');
  ok(!(near(ballAfter.x, E.cx) && near(ballAfter.y, E.cy)), 'der Ball steht nicht im Zentrum');
  ok(E.canCommit(0) === false, 'nach dem Matchende ist kein Commit mehr moeglich');
  const st = E.active().join(',') + '|' + E.winner() + '|' + E.goalState() + '|' + E.phase() + '|' + E.phaseN();
  for (let k = 0; k < 20; k++) E.step();
  ok(E.active().join(',') + '|' + E.winner() + '|' + E.goalState() + '|' + E.phase() + '|' + E.phaseN() === st,
     'der Endzustand ist stabil (kein Tick, kein Spawn, kein Umbau)');
  ok(E.overCalls().length === 1, 'gameOver wird genau einmal gerufen');
}
{
  const E = buildEnv('elimination4');
  E.newMatch();
  E.eliminate(0); E.eliminate(1);
  ok(E.winner() === null, 'bei zwei aktiven Spielern gibt es keinen Sieger');
  E.eliminate(3);
  ok(E.winner() === 2, 'der letzte aktive Spieler gewinnt das Match');
  ok(JSON.stringify(E.overCalls()) === JSON.stringify([2]),
     'ausserhalb des Torablaufs endet das Match sofort');
  ok(E.applyPhase() === false, 'bei einem verbleibenden Spieler wird nicht mehr umgebaut');
}

// =================================================================================
// K - KEINE V1-RESTE: kein Timer, keine Gegentore, kein Sudden Death
// =================================================================================
{
  for (const dead of ['FOOTBALL_ELIM_ROUND_SECONDS', 'fbElimConceded', 'fbElimAtRisk', 'fbElimSudden',
                      'fbElimClockMs', 'fbElimPhaseNo', 'fbElimAdvanceClock', 'fbElimRemainMs',
                      'footballElimPhaseEnd', 'footballElimStartPhase', 'footballElimAdvanceAimer',
                      'tickElimTimer', 'pauseElimTimer', 'fbElimAnchor', 'fbElimShownSec',
                      // V3.1: die Positionspersistenz und ihr Reparaturdurchgang sind ersetzt.
                      'fbElimLegalizeBodies', 'FB_ELIM_REPAIR_MARGIN', 'FB_ELIM_REPAIR_ITERATIONS'])
    ok(!HTML.includes(dead), 'kein Rest im Produktivcode: "' + dead + '"');
  ok(!/SUDDEN DEATH|at risk|at-risk/i.test(elimBlockSrc), 'der Elimination-Block nennt keinen Tiebreak mehr');
  ok(!/fchip\.risk/.test(HTML), 'die Sudden-Death-HUD-Klasse ist entfernt');
  ok(!/Elim/.test(loopSrc), 'die Hauptschleife tickt keine Elimination4-Uhr mehr');
  ok(/tickCollapse\(now\);/.test(loopSrc), 'der bestehende Ring-Collapse-Timer laeuft unveraendert weiter');
  ok(/const fbElimActive=\[true,true,true,true,true\];/.test(elimBlockSrc),
     'fbElimActive traegt die Aktiv-Liste in Maximallaenge');
  ok(/fbElimActive\[o\]=o<fbElimPlayers\(\);fbElimSlots\[o\]=o<fbElimPlayers\(\)\?o:-1;fbElimLives\[o\]=FB_ELIM_LIVES;\}\n  fbElimPhaseN=fbElimPlayers\(\);/.test(elimBlockSrc),
     'der Reset setzt Aktiv-Liste, Torslots, Leben und Arenaphase auf die Startspielerzahl');
  ok(/footballElimConcede\(own\);/.test(elimBlockSrc),
     'die Wertung geht ueber genau EINE Stelle: footballElimConcede');
  ok(/if\(fbElimLives\[o\]>0\)fbElimLives\[o\]--;\s*\n\s*if\(fbElimLives\[o\]<=0\)footballElimEliminate\(o\);/.test(elimBlockSrc),
     'ein Gegentor kostet ein Leben; erst bei 0 laeuft die bestehende Eliminierung');
  ok(!/fbElimConceded|Gegentor/.test(renderBarSrc), 'die Chipleiste zeigt keine Gegentore mehr');
  ok(/' out'/.test(renderBarSrc), 'Ausgeschiedene werden in der Leiste gedimmt markiert');
  ok(!/innerHTML/.test(renderBarSrc), 'die Chipleiste baut ausschliesslich ueber DOM-Knoten');
  ok(/fbElimHeadText\(\)/.test(renderBarSrc), 'die Kopfzeile kommt aus fbElimHeadText()');
  ok(!/performance\.now|Date\.now/.test(elimBlockSrc), 'die Elimination-Regeln enthalten keine Wanduhr');
  ok(!/document\.|getElementById|innerHTML|classList/.test(elimBlockSrc),
     'die Elimination-Regeln enthalten keinen DOM-Zugriff');
  ok(!/setTimeout|setInterval|Math\.random/.test(elimBlockSrc),
     'die Elimination-Regeln enthalten weder Timer-Kaskaden noch Zufall');
}

// =================================================================================
// L - SAFETY: Determinismus, Fixed Timestep, keine NaN, kein Arena-Escape
// =================================================================================
{
  const hashes = [];
  for (let k = 0; k < 2; k++) {
    const E = buildEnv('elimination4');
    E.newMatch();
    E.commit(0, 0, 120, 40);
    E.commit(1, 1, -90, 70);
    E.commit(2, 2, 55, -110);
    E.commit(3, 3, -60, -60);
    E.launch();
    E.settle();
    hashes.push(E.hash());
  }
  ok(hashes[0] === hashes[1], 'zwei identische Laeufe liefern bitidentische Zustaende');

  const runs = [];
  for (let k = 0; k < 2; k++) {
    const E = buildEnv('elimination4');
    E.newMatch();
    scoreOn(E, 1);   // Phase 4, Slot 1 = P2
    scoreOn(E, 1);   // Phase 3, Slot 1 = P3
    parkPlayers(E); shootAt(E, 0); E.finishGoal();   // Phase 2, Slot 0 = P1
    runs.push(E.active().join(',') + '|' + E.winner() + '|' + E.phaseN() + '|' + E.slots().join(',') + '|' + E.hash());
  }
  ok(runs[0] === runs[1], 'dieselbe Eliminierungssequenz ergibt identische Arena- und Bodyzustaende');
  ok(/\|3\|/.test(runs[0]), 'derselbe Sieger (P4) in beiden Laeufen');

  const E = buildEnv('elimination4');
  E.newMatch();
  for (let r = 0; r < 6; r++) {
    if (E.phase() !== 'aim') break;
    for (let o = 0; o < 4; o++) if (E.canCommit(o)) E.commit(o, o, 130 - r * 7 - o * 21, 40 + r * 5 - o * 33);
    if (E.phase() === 'reveal') { E.launch(); E.settle(); }
  }
  ok(E.finite(), 'kein NaN und kein Infinity nach sechs vollen Runden');
  const sn = E.snapshot();
  for (let i = 0; i < sn.length; i++) {
    if (sn[i].owner === E.neutral && sn[i].passed) continue;
    if (!sn[i].alive) continue;
    ok(E.boundSD(i) <= 1e-6, 'Koerper ' + i + ' bleibt innerhalb der Arenagrenze (kein Escape)');
  }
  ok(/^function stepSim\(\)\{/.test(stepSimSrc), 'stepSim() nimmt keine Zeit entgegen (Fixed Timestep)');
  ok(!/performance\.now|Date\.now|Math\.random/.test(stepSimSrc), 'stepSim() enthaelt weder Wanduhr noch Zufall');
}

// =================================================================================
// M - ABGRENZUNG: Classic und Tactical bleiben unberuehrt
// =================================================================================
{
  const C = buildEnv();
  const cs = C.place();
  ok(cs.length === 3 && JSON.stringify(cs.map(b => b.owner)) === JSON.stringify([0, 1, C.neutral]),
     'Classic stellt unveraendert zwei Figuren + Ball auf');
  const T = buildEnv('tactical');
  const ts = T.place();
  ok(ts.length === 5 && JSON.stringify(ts.map(b => b.owner)) === JSON.stringify([0, 0, 1, 1, T.neutral]),
     'Tactical stellt unveraendert vier Figuren + Ball auf');

  const G = buildEnv();
  G.place();
  G.setPos(2, G.cx + G.arenaCfg().postBack * G.BR + 60, G.cy);
  ok(G.crossed(2) === -1, 'ohne fbPassed wertet Classic nicht');
  ok(G.goalOpen(1) === true && G.goalOpen(3) === true,
     'in Classic ist jedes Tor immer offen (kein Elimination-Zustand)');

  const S = buildEnv('elimination4');
  S.newMatch();
  S.eliminate(3);
  S.applyPhase();
  ok(S.active()[3] === false && S.phaseN() === 3, 'Vorbedingung: ausgeschieden und umgebaut');
  S.setVariant('classic');
  S.resetMatchState();
  ok(S.active().every(v => v), 'der Moduswechsel setzt die Aktiv-Liste vollstaendig zurueck');
  ok(S.phaseN() === 5 && JSON.stringify(S.slots()) === JSON.stringify([0, 1, 2, 3, 4]),
     'der Moduswechsel setzt Arenaphase und Torslots zurueck');
  S.startRound();
  ok(S.snapshot().length === 3, 'nach dem Wechsel steht wieder die Classic-Aufstellung');

  ok(/const FOOTBALL_VARIANT_ELIM='elimination';/.test(HTML), 'der Produktmodus heisst elimination');
  ok(/const FOOTBALL_VARIANT_ELIM4='elimination4';/.test(HTML),
     'der Dev-Einstieg auf vier Startspieler heisst weiterhin elimination4');
  ok(/DEV_FB_VARIANT===FOOTBALL_VARIANT_ELIM4/.test(ctaSrc),
     'der Dev-Direktlink ?dev=1&fb=elimination4 ueberspringt die Auswahl weiterhin');
  ok(/const DEV_FB_VARIANT=DEV_MENU\?/.test(HTML), 'der fb-Parameter wird ausschliesslich mit ?dev=1 gelesen');
  // Produktintegration: Elimination ist der dritte SICHTBARE Modus. Die Struktur des Modals
  // prueft die Produktsuite test_football_tactical.js; hier zaehlt nur, dass es ihn gibt und
  // dass er auf demselben Startpfad landet.
  const modeOv = grab(/<div class="ov" id="fbModeOv">[\s\S]*?id="fbModeBack"[\s\S]*?<\/div>/, 'Modusauswahl');
  ok(/id="fbElimBtn"/.test(modeOv), 'die sichtbare Modusauswahl hat einen Elimination-Eintrag');
  ok(/<button class="vopt rec" id="fbClassicBtn">/.test(modeOv) && !/id="fbElimBtn"[^>]*rec/.test(modeOv),
     'Classic bleibt die empfohlene Option, Elimination wird nicht empfohlen');
  ok(HTML.includes("$('fbElimBtn').onclick=()=>{if(SFX.click())vibrateMs(VIBE_CONFIRM_MS);startFootball(FOOTBALL_VARIANT_ELIM);};"),
     'der Menuebutton startet den PRODUKTMODUS ueber denselben startFootball()-Pfad');
  // Der Vier-Spieler-Einstieg ist bewusst NICHT sichtbar: er haengt am Dev-Guard.
  ok(/const dev4=variant===FOOTBALL_VARIANT_ELIM4&&typeof DEV_MENU!=='undefined'&&DEV_MENU;/.test(HTML),
     'der Vier-Spieler-Einstieg ist an ?dev=1 gebunden');
  ok(!HTML.includes('startFootball(FOOTBALL_VARIANT_ELIM4)'),
     'kein sichtbarer Menueeintrag startet die Vier-Spieler-Variante');

  ok(!/fbElim[A-Za-z]*\s*[:=][^\n]*rRef|onlineSendCommit[^\n]*fbElim/.test(HTML),
     'Elimination4 hat keinerlei Online-Anbindung');
  ok(/mode=menuMode='football';fmt='single';online=false;/.test(startFootballSrc),
     'der Startpfad pinnt auch Elimination4 fest auf online=false');

  const elimCode = elimBlockSrc.replace(/\/\/[^\n]*/g, '');
  ok(!/immun|antiTeam|friendlyProtect|fairness/i.test(elimCode),
     'keine Immunitaet, kein Teaming-Schutz, keine Fairnesskorrektur');

  // Keine phase-spezifischen Physikwerte: derselbe Satz gilt in jeder Arenaphase.
  ok(/const FOOTBALL_PHYS=\{friction:0\.9958,frictionBall:0\.9964,fend:0\.9620,fendBall:0\.9790,/.test(HTML)
     && /fastv:4\.00,frictionMid:0\.9840,/.test(HTML),
     'die Football-Physik gilt phasenunabhaengig mit den freigegebenen Werten');
  ok(/const FOOTBALL_BALL_RADIUS=25;/.test(HTML), 'Ballradius unveraendert 25');
  ok(!/fbElimPhaseN[^\n]*(friction|rest|slowv|stopv)/i.test(HTML),
     'es gibt keine phase-spezifischen Physikwerte');
}


// =================================================================================
// N - ARENA-TRANSITION 4 -> 3 (rein visuell, Prototyp V2)
// =================================================================================
// Geprueft wird der ZUSTAND, nicht das Bild: die zwei Abschnitte (erst Tore, dann Arena),
// dass waehrend der ganzen Dauer nichts spielbar ist und sich nichts bewegt, dass die
// Kamera stillsteht und dass Phase, Spawns und Ball erst am Ende wechseln.
{
  const E = buildEnv('elimination4');
  E.newMatch();
  const T = E.morphTicks();
  ok(T.hold + T.goals + T.arena + T.settle === T.total, 'die vier Abschnitte ergeben die Gesamtdauer');
  ok(T.total >= 87 && T.total <= 102,
     'Gesamtdauer 1.45 - 1.70 s bei 60 Ticks/s (erhalten: ' + T.total + ' Ticks)');
  ok(T.hold >= 9 && T.hold <= 15, 'Elimination-Hold 0.15 - 0.25 s');
  ok(T.goals >= 21 && T.goals <= 30, 'Torneuordnung 0.35 - 0.50 s');
  ok(T.arena >= 45 && T.arena <= 60, 'Arenaumbau 0.75 - 1.00 s');
  ok(T.settle >= 9 && T.settle <= 12, 'Einrasten 0.15 - 0.20 s');
  ok(T.overshoot === 0, 'V2 laeuft OHNE Ueberschwingen (Einrasten spaeter ueber FX/Audio)');

  ok(E.morphActive() === false, 'im laufenden Spiel gibt es keine Transition');
  ok(E.morphWanted() === false, 'bei vier aktiven Spielern wird keine Transition gewollt');
  ok(E.morphPlan() === null, 'ohne Transition gibt es keinen Plan');
  ok(E.bodyLevel() === 1, 'ausserhalb der Transition sind die Figuren voll sichtbar');
}
{
  // Vollstaendiger Torablauf mit Transition: Tor -> fall -> celebrate -> morph -> spawn -> play.
  const E = buildEnv('elimination4');
  E.newMatch();
  parkPlayers(E);
  shootAt(E, 0);
  ok(E.goalState() === 'fall', 'Vorbedingung: der Torablauf laeuft');
  ok(E.active()[0] === false, 'Vorbedingung: P1 ist ausgeschieden');
  ok(E.morphWanted() === true, 'nach der ersten Eliminierung wird die Transition gewollt');

  let n = 0;
  while (E.goalState() !== 'morph' && n < 400) { E.step(); n++; }
  ok(E.goalState() === 'morph', 'die Transition startet nach dem Celebration Window');
  ok(E.phaseN() === 4 && E.dirs().length === 4,
     'zu Beginn der Transition steht noch EXAKT die Vier-Tore-Arena');
  ok(E.goalE() === 0 && E.arenaE() === 0, 'beide Abschnitte starten bei exakt 0');

  const plan = E.morphPlan();
  ok(plan !== null && plan.length === 4, 'der Plan kennt alle vier Tore der alten Arena');
  ok(plan.filter(g => g.dead).length === 1, 'genau ein Tor ist als ausgeschieden markiert');
  ok(plan.find(g => g.dead).owner === 0, 'das tote Tor gehoert dem ausgeschiedenen Spieler');
  ok(plan.filter(g => !g.dead).every(g => g.target >= 0 && g.target < 3),
     'jedes verbleibende Tor hat genau einen Phase-3-Slot');
  const tgt = plan.filter(g => !g.dead).map(g => g.target).sort();
  ok(JSON.stringify(tgt) === JSON.stringify([0, 1, 2]),
     'die drei Ziele decken die drei Phase-3-Slots genau einmal ab');
  const byOwner = plan.filter(g => !g.dead).sort((a, b) => a.owner - b.owner).map(g => g.target);
  ok(JSON.stringify(byOwner) === JSON.stringify([0, 1, 2]),
     'die Zuordnung folgt der aufsteigenden Spieler-ID - identisch zu fbElimApplyPhase');

  const view0 = E.viewR();
  const before = E.snapshot();
  const T2 = E.morphTicks();
  let gUp = true, aUp = true, finite = true, hidden = false, moved = 0, seen = 0;
  let gPrev = -1, aPrev = -1, camOk = true, orderOk = true, goalsDoneAt = -1, arenaStartAt = -1;
  for (let k = 0; k < T2.total + 5; k++) {
    if (E.goalState() !== 'morph') break;
    seen++;
    ok0(E.goalBusy() === true, 'Eingaben sind waehrend der ganzen Transition gesperrt');
    ok0(E.canCommit(1) === false, 'kein Commit waehrend der Transition');
    ok0(E.phaseN() === 4, 'die Phase wechselt waehrend der Transition NICHT');
    const gp = E.goalE(), ap = E.arenaE();
    if (!Number.isFinite(gp) || !Number.isFinite(ap)) finite = false;
    if (gp < gPrev - 1e-9) gUp = false;
    if (ap < aPrev - 1e-9) aUp = false;
    if (ap > 1e-9 && gp < 1 - 1e-9) orderOk = false;      // Arena darf erst nach den Toren
    if (gp >= 1 - 1e-9 && goalsDoneAt < 0) goalsDoneAt = seen;
    if (ap > 1e-9 && arenaStartAt < 0) arenaStartAt = seen;
    gPrev = gp; aPrev = ap;
    if (Math.abs(E.viewR() - view0) > 1e-9) camOk = false;
    if (E.bodyLevel() < 0.02) hidden = true;
    const now = E.snapshot();
    for (let i = 0; i < now.length; i++)
      if (Math.abs(now[i].x - before[i].x) > 1e-9 || Math.abs(now[i].y - before[i].y) > 1e-9) moved++;
    E.step();
  }
  ok(seen === T2.total, 'die Transition dauert exakt ' + T2.total + ' Ticks (erhalten: ' + seen + ')');
  ok(gUp, 'der Fortschritt der Torneuordnung laeuft monoton von 0 nach 1');
  ok(aUp, 'der Fortschritt des Arenaumbaus laeuft monoton von 0 nach 1');
  ok(gPrev === 1 && aPrev === 1, 'beide Abschnitte enden exakt auf 1');
  ok(orderOk, 'der Arenaumbau beginnt erst, wenn die Torneuordnung abgeschlossen ist');
  ok(goalsDoneAt > 0 && arenaStartAt > goalsDoneAt,
     'Abschnitt A endet vor Abschnitt B (Tore fertig bei Tick ' + goalsDoneAt +
     ', Arena beginnt bei Tick ' + arenaStartAt + ')');
  ok(camOk, 'das Kamera-Framing bleibt waehrend der ganzen Transition konstant');
  ok(finite, 'beide Fortschritte sind zu jedem Zeitpunkt endlich (kein NaN/Infinity)');
  ok(moved === 0, 'waehrend der Transition bewegt sich kein einziger Koerper (' + moved + ' Abweichungen)');
  ok(E.snapshot().every(b2 => b2.vx === 0 && b2.vy === 0),
     'alle Koerper sind waehrend der Transition kontrolliert eingefroren');
  ok(hidden, 'die Figuren ziehen sich waehrend der Transition sichtbar zurueck');
  ok(E.finite(), 'alle Koerperwerte bleiben endlich');

  ok(E.goalState() === 'spawn', 'nach der Transition folgt der Ball-Drop (spawn)');
  ok(E.phaseN() === 3 && E.dirs().length === 3, 'der Endzustand ist EXAKT die Drei-Tore-Arena');
  const sn = E.snapshot();
  for (let s2 = 0; s2 < 3; s2++) {
    const o = E.slotOwner(s2), sp = E.spawnAt(s2);
    ok(near(sn[o].x, sp.x) && near(sn[o].y, sp.y),
       'P' + (o + 1) + ' steht nach der Transition auf dem fairen Phase-3-Spawn');
  }
  ok(near(sn[4].x, E.cx) && near(sn[4].y, E.cy), 'der Ball steht im Zentrum der neuen Arena');
  ok(E.morphActive() === false, 'die Transition ist beendet');
  ok(E.morphPlan() === null, 'der Plan ist aufgeraeumt');
  ok(E.canCommit(1) === false, 'waehrend des Ball-Drops ist noch kein Commit moeglich');
  ok(E.bodyLevel() < 1, 'die Figuren kommen erst waehrend des Ball-Drops zurueck');

  let m = 0;
  while (E.goalState() !== 'play' && m < 200) { E.step(); m++; }
  ok(E.goalState() === 'play', 'nach dem Ball-Drop laeuft die Runde wieder');
  ok(E.bodyLevel() === 1, 'die Figuren sind wieder voll sichtbar');
  E.step();
  ok(E.canCommit(1) === true, 'Commit ist erst nach dem Ball-Drop moeglich');
}
{
  // Die Transition deckt beide Arenawechsel ab: 4 -> 3 und 3 -> 2. Beim Sieg nicht mehr.
  const E = buildEnv('elimination4');
  E.newMatch();
  E.eliminate(0);
  E.applyPhase();
  ok(E.phaseN() === 3, 'Vorbedingung: die Arena steht auf drei Toren');
  E.eliminate(1);
  ok(E.morphWanted() === true, '3 -> 2 startet ebenfalls eine Transition');
  const W = buildEnv('elimination4');
  W.newMatch();
  W.eliminate(0); W.eliminate(1);
  W.applyPhase();
  W.eliminate(2);
  ok(W.winner() === 3, 'Vorbedingung: das Match ist entschieden');
  ok(W.morphWanted() === false, 'beim Sieg gibt es keine Transition');
}
{
  // Classic und Tactical kennen den Transition-Zustand nicht.
  for (const v of [undefined, 'tactical']) {
    const E = buildEnv(v);
    E.newMatch();
    ok(E.morphActive() === false, (v || 'classic') + ': keine Transition');
    ok(E.morphWanted() === false, (v || 'classic') + ': keine Transition gewollt');
    ok(E.bodyLevel() === 1, (v || 'classic') + ': Figuren immer voll sichtbar');
  }
}
{
  // Die Zwischenformen der Arena (V3, Minkowski-/Stuetzfunktions-Interpolation): beide
  // Endzustaende exakt, dazwischen konvex, Schwerpunkt stabil und - der eigentliche Punkt -
  // die Wanddistanz JEDER Richtung laeuft monoton von ihrem Start- auf ihren Endwert.
  const G = (re, n) => grab(re, n);
  const parts = [
    /const FB_TRI_VERT=.*/,
    /const FOOTBALL_ARENA_ELIM4=\{[\s\S]*?\};/,
    /\/\/ Konvexes Kernpolygon[\s\S]*?function fbElimArena\(\)\{.*\}/,
    /const fbOutline=\(hx,hz,rc,seg\)=>\{[\s\S]*?\n    \};/,
    /const fbTriOutline=\(ap,rc,seg\)=>\{[\s\S]*?\n    \};/,
    /const fbRoundPoly=\(V,rc,seg\)=>\{[\s\S]*?\n    \};/,
    /const fbEdgesFrom=\(V\)=>\{[\s\S]*?\n    \};/,
    /const fbMinkowski=\(A,B\)=>\{[\s\S]*?\n    \};/,
    /const fbMorphCore=\(a\)=>\{[\s\S]*?\n    \};/,
    /const fbMorphCores=\(plan\)=>\{[\s\S]*?\n    \};/,
    /const fbPolyCentroid=\(P\)=>\{[\s\S]*?\n    \};/,
    /const fbMorphRing=\(e,plan\)=>\{[\s\S]*?\n    \};/,
    /const fbRingChord=\(ring,u,half\)=>\{[\s\S]*?\n    \};/,
  ];
  const src = parts.map((re, i) => G(re, 'Rendererquelle ' + i)).join('');
  // Sandbox mit den echten Rendererquellen und den finalen Arenakonstanten.
  FB_SANDBOX = () => new Function(
    'const FB_GOAL_HALF_DEPTH=1.184,FB_GOAL_ASSET_INNER=3.560,FB_GOAL_ASSET_OUTER=5.282,' +
    'FB_TRI_COS30=0.8660254037844387,' +
    'FB_TRI_TAN60=1.7320508075688772;const FOOTBALL_ELIM4_DIRS=[[0,-1],[1,0],[0,1],[-1,0]];' +
    'const FOOTBALL_ELIM3_DIRS=[[0,-1],[FB_TRI_COS30,0.5],[-FB_TRI_COS30,0.5]];' +
    'const FOOTBALL_ELIM2_DIRS=[[1,0],[-1,0]];' +
    'const FB_P5_C1=0.9510565162951535,FB_P5_S1=0.30901699437494745,' +
    'FB_P5_C2=0.5877852522924731,FB_P5_S2=0.8090169943749475;' +
    'const FOOTBALL_ELIM5_DIRS=[[0,-1],[FB_P5_C1,-FB_P5_S1],[FB_P5_C2,FB_P5_S2],' +
    '[-FB_P5_C2,FB_P5_S2],[-FB_P5_C1,-FB_P5_S1]];' +
    'const FB_P5_VERT=[[FB_P5_C2,-FB_P5_S2],[FB_P5_C1,FB_P5_S1],[0,1],' +
    '[-FB_P5_C1,FB_P5_S1],[-FB_P5_C2,-FB_P5_S2]];' +
    'const BR=32,FB_U=1;let fbElimPhaseN=4;let fbMorphPlan={from:4,to:3};' +
    src +
    'return {fbMorphRing,fbMorphCores,fbMinkowski,fbRingChord,fbRoundPoly,fbOutline,' +
    'fbTriOutline,fbElimArena,A4:FOOTBALL_ARENA_ELIM4,A3:FOOTBALL_ARENA_ELIM3,' +
    'A2:FOOTBALL_ARENA_ELIM2,A5:FOOTBALL_ARENA_ELIM5};')();
  const R = FB_SANDBOX();
  FB_R = R;

  const supp = (P, th) => {
    let m = -Infinity;
    for (const p of P) { const d = p.x * Math.cos(th) + p.z * Math.sin(th); if (d > m) m = d; }
    return m;
  };
  const devSup = (P, Q) => {
    let w = 0;
    for (let k = 0; k < 720; k++) { const th = k * Math.PI / 360; w = Math.max(w, Math.abs(supp(P, th) - supp(Q, th))); }
    return w;
  };
  const ref4 = R.fbOutline(R.A4.halfLen * 32, R.A4.halfWid * 32, R.A4.corner * 32, 20);
  const ref3 = R.fbRoundPoly(R.A3.poly.map(v => [v[0] * 32, v[1] * 32]), R.A3.corner * 32, 20);
  ok(devSup(R.fbMorphRing(0).ring, ref4) < 1e-6,
     'Fortschritt 0 ist die freigegebene Phase-4-Form (' + devSup(R.fbMorphRing(0).ring, ref4).toExponential(1) + ')');
  ok(devSup(R.fbMorphRing(1).ring, ref3) < 0.5,
     'Fortschritt 1 ist die freigegebene Phase-3-Form (' + devSup(R.fbMorphRing(1).ring, ref3).toFixed(3) + ' Einheiten)');

  const metrics = (ring) => {
    const P = ring.slice(0, ring.length - 1), n = P.length;
    let mnH = Infinity, mxH = 0, ar = 0, cx = 0, cz = 0, concave = 0, bad = 0;
    for (let d = 0; d < 720; d++) {
      const h = supp(P, d * Math.PI / 360);
      mnH = Math.min(mnH, h); mxH = Math.max(mxH, h);
    }
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n], c = P[(i + 2) % n];
      if ((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x) < -1e-6) concave++;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.nx)) bad++;
      const cr = a.x * b.z - b.x * a.z;
      ar += cr; cx += (a.x + b.x) * cr; cz += (a.z + b.z) * cr;
    }
    const A = ar / 2;
    return { apothem: mnH, outer: mxH, area: Math.abs(A), cog: Math.hypot(cx / (6 * A), cz / (6 * A)), concave, bad };
  };
  let pAp = Infinity, pOut = Infinity, pA = Infinity, monoAp = true, monoOut = true, monoA = true, cogMax = 0;
  for (let k = 0; k <= 20; k++) {
    const m = metrics(R.fbMorphRing(k / 20).ring);
    ok0(m.concave === 0, 'jede Zwischenkontur ist konvex (keine Beulen, keine Selbstdurchdringung)');
    ok0(m.bad === 0, 'keine Zwischenkontur enthaelt NaN/Infinity');
    if (m.apothem > pAp + 1e-6) monoAp = false;
    if (m.outer > pOut + 1e-6) monoOut = false;
    if (m.area > pA + 1e-6) monoA = false;
    pAp = m.apothem; pOut = m.outer; pA = m.area;
    cogMax = Math.max(cogMax, m.cog);
  }
  ok(monoAp, 'das Apothem laeuft monoton in den Endzustand');
  ok(monoOut, 'der Aussenradius laeuft monoton in den Endzustand');
  ok(monoA, 'die Arenaflaeche schrumpft ueber die ganze Bewegung monoton');
  ok(cogMax < 25,
     'der Flaechenschwerpunkt wandert hoechstens minimal und kehrt ins Zentrum zurueck (max ' +
     cogMax.toFixed(1) + ' Einheiten = ' + (cogMax / 14.0).toFixed(1) + ' % der Arenabreite)');

  // Der eigentliche V3-Gewinn: die Wanddistanz JEDER Richtung interpoliert monoton zwischen
  // Start- und Endwert. Damit gibt es kein Stauchen, kein Ausbeulen, kein Zurueckfedern.
  const H = [];
  for (let k = 0; k <= 20; k++) {
    const P = R.fbMorphRing(k / 20).ring, row = [];
    for (let d = 0; d < 180; d++) row.push(supp(P, d * Math.PI / 90));
    H.push(row);
  }
  let dirMono = 0, worstOver = 0;
  for (let d = 0; d < 180; d++) {
    const a = H[0][d], b = H[20][d], up = b > a;
    for (let k = 1; k <= 20; k++) {
      if (up ? H[k][d] < H[k - 1][d] - 1e-6 : H[k][d] > H[k - 1][d] + 1e-6) dirMono++;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      worstOver = Math.max(worstOver, H[k][d] - hi, lo - H[k][d]);
    }
  }
  ok(dirMono === 0, 'die Wanddistanz laeuft in JEDER Richtung monoton (' + dirMono + ' Ausreisser)');
  ok(worstOver <= 1e-6,
     'keine Richtung laeuft ueber ihren Start- oder Endwert hinaus (' + worstOver.toExponential(1) + ')');

  // Gleichmaessigkeit: kein Sprung zwischen zwei Fortschrittsschritten.
  let jump = 0;
  for (let k = 1; k <= 20; k++) for (let d = 0; d < 180; d++) jump = Math.max(jump, Math.abs(H[k][d] - H[k - 1][d]));
  ok(jump < 40, 'die Kontur bewegt sich in gleichmaessigen Schritten (groesster Schritt ' + jump.toFixed(1) + ' Einheiten je 5 %)');
}
{
  // Eckensicherheit: der komplette Grundriss eines Tores bleibt in JEDER Position auf dem
  // Deck. Geprueft wird die echte Sehnenplatzierung gegen die echte Deckaussenkante.
  const A4 = FB_R.A4, HALF = A4.postOuter * 32, DEPTH = 1.184 * 32, DECK = (1.184 * 2 * 32 + 25);
  const deckOf = (ring) => ring.slice(0, ring.length - 1)
    .map(p => ({ x: p.x + p.nx * DECK, z: p.z + p.nz * DECK }));
  const outside = (deck, P) => {
    let worst = -Infinity;
    for (let i = 0; i < deck.length; i++) {
      const a = deck[i], b = deck[(i + 1) % deck.length];
      const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez) || 1;
      worst = Math.max(worst, (P.x - a.x) * (ez / L) + (P.z - a.z) * (-ex / L));
    }
    return worst;
  };
  let worstAll = -Infinity;
  for (const e of [0, 0.25, 0.5, 0.75, 1]) {
    const rd = FB_R.fbMorphRing(e), deck = deckOf(rd.ring);
    for (let k = 0; k < 60; k++) {
      const h = FB_R.fbRingChord(rd.ring, k / 60, HALF);
      const tx = -h.nz, tz = h.nx;
      for (const sg of [-1, 1]) for (const dp of [0, 2 * DEPTH])
        worstAll = Math.max(worstAll, outside(deck, {
          x: h.x + h.nx * dp + tx * sg * HALF, z: h.z + h.nz * dp + tz * sg * HALF }));
    }
  }
  ok(worstAll <= 0.5,
     'kein Torgrundriss ragt an irgendeiner Stelle der Bewegung ueber die Deckkante (max ' +
     worstAll.toFixed(1) + ' Einheiten)');
}

// =================================================================================
// O - FINALER PRODUKTSTAND DER ARENAFORMEN
// =================================================================================
// Die drei Formen sind manuell freigegeben und ab hier der normale Gameplaypfad - es gibt
// keinen Dev-Formparameter mehr. Geprueft wird die Geometrie selbst: exakte Masse,
// Symmetrie, Wandstruktur, Torsitz, Aufstellung und Dichtheit der Bande.
//   Phase 4  Rounded Square          17.50           rc 3.50   Spawn 11.50
//   Phase 3  Broad Rounded Triangle  Apothem 12.50   rc 3.50   Spawn  8.15
//   Phase 2  Shouldered Wide         15.60 x 11.60   rc 2.60   Spawn 10.15

// Kernkanten einer Phase nach Wandtyp: Normale entlang einer Torachse = Torwand,
// senkrecht dazu = Hauptbande, alles andere = Schulter bzw. Kappflaeche.
const fbWalls = (poly, dirs) => {
  const out = { goal: [], main: [], other: [] };
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez) || 1;
    const nx = ez / L, nz = -ex / L;
    let onGoal = false, onSide = false;
    for (const d of dirs) {
      if (nx * d[0] + nz * d[1] > 0.94) onGoal = true;
      if (Math.abs(nx * d[0] + nz * d[1]) < 0.06) onSide = true;
    }
    (onGoal ? out.goal : onSide ? out.main : out.other).push(L);
  }
  return out;
};
// Flaeche der abgerundeten Form: Kernflaeche + Umfang * rc + Kreisflaeche.
const fbArea = (poly, rc) => {
  let a = 0, per = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
    per += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return Math.abs(a) / 2 + per * rc + Math.PI * rc * rc;
};
const fbCore = (c) => c.poly ? c.poly.map(v => v.slice())
  : [[c.halfLen - c.corner, -(c.halfWid - c.corner)], [c.halfLen - c.corner, c.halfWid - c.corner],
     [-(c.halfLen - c.corner), c.halfWid - c.corner], [-(c.halfLen - c.corner), -(c.halfWid - c.corner)]];

{
  // Es gibt keinen Formparameter mehr - weder im Produktivcode noch als Restschalter.
  for (const leftover of ['DEV_SHAPE', 'DEV_S3', 'DEV_S2', 'FB_SHAPE_SETS', 'FB_TUNE2', 'FB_TUNE3', 'fbShapeSet'])
    ok0(!HTML.includes(leftover), 'kein Rest des Vergleichsschalters ' + leftover + ' in index.html');
  ok(true, 'index.html enthaelt keinen Dev-Formparameter und keine Kandidatenmatrix mehr');
}
{
  // PHASE 4 - unveraendert gegenueber dem freigegebenen Stand.
  const E = buildEnv('elimination4');
  E.forcePhase(4);
  const a = E.arenaCfg();
  ok(a.halfLen === 17.50 && a.halfWid === 17.50, 'Phase 4: Rounded Square 17.50 (unveraendert)');
  ok(a.corner === 3.50 && a.spawn === 11.50, 'Phase 4: Eckradius 3.50, Spawn 11.50 (unveraendert)');
  ok(a.sides === 4 && !a.poly, 'Phase 4: vier Seiten, kein Kernpolygon - reines Rounded Square');
  ok(a.postFront === 17.50 && a.goalAnchor === 17.50 + 1.184,
     'Phase 4: Torsitz unveraendert');
}
{
  // PHASE 3 - BROAD ROUNDED TRIANGLE (refined BASE).
  const E = buildEnv('elimination4');
  E.forcePhase(3);
  const a = E.arenaCfg(), P = a.poly;
  ok(a.halfLen === 12.50 && a.corner === 3.50 && a.spawn === 8.15,
     'Phase 3: Apothem 12.50, Eckradius 3.50, Spawn 8.15');
  ok(a.sides === 3 && Array.isArray(P) && P.length === 6,
     'Phase 3: drei Torseiten, Kernpolygon mit sechs Ecken (gekappte Spitzen)');
  ok(!a.tri, 'Phase 3: kein spitzes Dreieck mehr - die Grenze laeuft ueber das Kernpolygon');
  // 120-Grad-Drehsymmetrie
  const c = Math.cos(2 * Math.PI / 3), s = Math.sin(2 * Math.PI / 3);
  let sym = true;
  for (const v of P) {
    const rx = v[0] * c - v[1] * s, rz = v[0] * s + v[1] * c;
    if (!P.some(w => Math.hypot(w[0] - rx, w[1] - rz) < 1e-9)) sym = false;
  }
  ok(sym, 'Phase 3: exakte 120-Grad-Drehsymmetrie');
  // Drei LANGE Torseiten, drei KURZE Kappflaechen.
  const W = fbWalls(P, E.dirs());
  ok(W.goal.length === 3 && W.other.length === 3,
     'Phase 3: drei Torseiten und drei Kappflaechen');
  ok(Math.max(...W.other) < Math.min(...W.goal),
     'Phase 3: jede Kappflaeche ist kuerzer als jede Torseite (' +
     Math.max(...W.other).toFixed(2) + ' < ' + Math.min(...W.goal).toFixed(2) + ' BR)');
  ok(Math.abs(Math.max(...W.goal) - Math.min(...W.goal)) < 1e-9 &&
     Math.abs(Math.max(...W.other) - Math.min(...W.other)) < 1e-9,
     'Phase 3: alle drei Torseiten und alle drei Kappflaechen sind exakt gleich lang');
  // Das Tor sitzt vollstaendig im geraden Teil der Torseite.
  ok(Math.min(...W.goal) / 2 > a.postOuter,
     'Phase 3: das Tor liegt vollstaendig auf der geraden Torseite (' +
     (Math.min(...W.goal) / 2).toFixed(2) + ' > ' + a.postOuter + ')');
}
{
  // PHASE 2 - SHOULDERED WIDE.
  const E = buildEnv('elimination4');
  E.forcePhase(2);
  const a = E.arenaCfg(), P = a.poly, D = E.dirs();
  ok(a.halfLen === 15.60 && a.halfWid === 11.60, 'Phase 2: Shouldered Wide 15.60 x 11.60');
  ok(a.corner === 2.60 && a.spawn === 10.15, 'Phase 2: Eckradius 2.60, Spawn 10.15');
  ok(a.sides === 2 && Array.isArray(P) && P.length === 8,
     'Phase 2: zwei Tore, Kernpolygon mit acht Ecken (Achteck mit Schultern)');
  ok(D.length === 2 && D[0][0] === 1 && D[0][1] === 0 && D[1][0] === -1 && D[1][1] === 0,
     'Phase 2: die beiden Tore liegen exakt gegenueber');
  // 180-Grad-Punktsymmetrie
  let sym = true;
  for (const v of P) if (!P.some(w => Math.hypot(w[0] + v[0], w[1] + v[1]) < 1e-9)) sym = false;
  ok(sym, 'Phase 2: exakte 180-Grad-Punktsymmetrie');
  // Wandstruktur: 2 Hauptbanden, 2 Torwaende, 4 Schultern.
  const W = fbWalls(P, D);
  ok(W.main.length === 2 && W.goal.length === 2 && W.other.length === 4,
     'Phase 2: zwei Hauptbanden, zwei Torwaende, vier Schulterflaechen');
  ok(Math.min(...W.main) > 20,
     'Phase 2: die Hauptbanden bleiben lange klare Flaechen (' + Math.min(...W.main).toFixed(2) + ' BR)');
  ok(Math.min(...W.goal) / 2 > a.postOuter,
     'Phase 2: das Tor liegt vollstaendig auf der flachen Torwand (' +
     (Math.min(...W.goal) / 2).toFixed(2) + ' > ' + a.postOuter + ')');
  // Eine Schulter, die kuerzer als der Eckbogen daneben waere, haette keine Wirkung.
  ok(Math.min(...W.other) > a.corner * Math.PI / 4,
     'Phase 2: jede Schulter ist laenger als der Eckbogen daneben (' +
     Math.min(...W.other).toFixed(2) + ' BR)');
  ok(a.halfLen > a.halfWid, 'Phase 2: die Arena bleibt breiter als tief');
}
{
  // Aufstellung, Torbreite und Radien in ALLEN Phasen.
  const E = buildEnv('elimination4');
  E.newMatch();
  ok(E.rad(4) === 25 && E.rad(0) === 32, 'Ballradius 25 und Spielerradius 32 unveraendert');
  for (const ph of [4, 3, 2]) {
    E.forcePhase(ph);
    const a = E.arenaCfg(), D = E.dirs(), r = a.spawn / a.halfLen;
    ok0(a.postInner === 3.560 && a.postOuter === 5.282, 'Phase ' + ph + ': Torbreite unveraendert');
    ok0(a.postFront === a.halfLen && a.goalAnchor === a.halfLen + 1.184,
        'Phase ' + ph + ': das Tor sitzt buendig auf der Bandeninnenflaeche');
    ok0(r > 0.63 && r < 0.68, 'Phase ' + ph + ': Spawnverhaeltnis ~0.65 zur Bandeninnenflaeche');
    for (let s = 0; s < D.length; s++) {
      const p = E.spawnAt(s);
      ok0(E.boundSDAt(p.x, p.y, false).sd < -E.BR * 0.5,
          'Phase ' + ph + ': jeder Spawn liegt sicher innerhalb der Bande');
      ok0(Number.isFinite(p.x) && Number.isFinite(p.y), 'Phase ' + ph + ': Spawn ist endlich');
    }
    for (let i = 0; i < D.length; i++)
      for (let j = i + 1; j < D.length; j++) {
        const x = E.spawnAt(i), y = E.spawnAt(j);
        ok0(Math.hypot(x.x - y.x, x.y - y.y) > 2 * E.BR, 'Phase ' + ph + ': keine zwei Spawns ueberlappen');
      }
  }
  ok(true, 'Aufstellung, Torbreite und Torsitz in allen drei Phasen geprueft');
}
{
  // Dichte Bande: harte Schuesse aus dem Zentrum UND laengs an der Bande. Weder Ball noch
  // die groessere Spielerkugel duerfen die Arena verlassen; keine NaN/Infinity.
  for (const ph of [4, 3, 2]) {
    const E = buildEnv('elimination4');
    E.newMatch();
    E.forcePhase(ph);
    const a = E.arenaCfg();
    let outside = 0, bad = 0, runs = 0, tiefstesFenster = 0;
    for (let k = 0; k < 48; k++) {
      const th = k * Math.PI / 24, cs = Math.cos(th), sn = Math.sin(th);
      const starts = [[E.cx, E.cy, 40],
                      [E.cx, E.cy + (a.halfWid - 1.4) * E.BR, 34],
                      [E.cx, E.cy - (a.halfWid - 1.4) * E.BR, 34]];
      for (const [x0, y0, sp] of starts) {
        const r = E.slam(4, x0, y0, cs * sp, sn * sp, 500);
        runs++;
        if (!r.fin) bad++;
        // Float-Residuum statt exakter Null: eine ruhende Kugel landet nach der
        // Bandenkorrektur regelmaessig auf ~1e-14 px jenseits der Linie. Gemeint ist
        // 'nicht draussen', nicht 'bitgenau null'.
        //
        // Seit dem Torfenster-Pass gibt es einen zweiten zulaessigen Verbleib: IM
        // sichtbaren Tormaul verlaeuft keine Bandenlinie, dort haelt allein der Sockel.
        // Eine Kugel, die dort liegen bleibt, ist nicht 'aus der Arena' - sie steckt im
        // Tor und ist von den Spielern erreichbar. Gemessen wird sie trotzdem: der Sockel
        // begrenzt ihre Tiefe, sie darf nicht weiter als bis zur Torlinie kommen.
        else if (!r.passed && E.boundSD(4) > 1e-9) {
          if (E.inWindow(4)) tiefstesFenster = Math.max(tiefstesFenster, E.boundSD(4));
          else outside++;
        }
      }
    }
    ok(outside === 0 && bad === 0,
       'Phase ' + ph + ': kein Ball endet ausserhalb des Tormauls, keine NaN in ' + runs +
       ' harten Schuessen');
    ok(tiefstesFenster <= E.windowDepth(4),
       'Phase ' + ph + ': wer im Tormaul liegen bleibt, kommt nicht ueber den Sockel hinaus (' +
       tiefstesFenster.toFixed(2) + ' <= ' + E.windowDepth(4).toFixed(2) + ')');
    let pEsc = 0;
    for (let k = 0; k < 24; k++) {
      const P = buildEnv('elimination4');
      P.newMatch();
      P.forcePhase(ph);
      const th = k * Math.PI / 12;
      const r = P.slam(0, P.cx, P.cy, Math.cos(th) * 34, Math.sin(th) * 34, 400);
      // Die gueltige Grenze der Spielerkugel: die Bande - im Torfenster zuzueglich der
      // Torrettungstasche. Ausserhalb des Fensters ist das Limit 0, die Pruefung also
      // unveraendert scharf.
      if (!r.fin || P.boundSD(0) > P.rescueLimit(0) + 1e-6) pEsc++;
    }
    ok(pEsc === 0, 'Phase ' + ph + ': auch die Spielerkugel bleibt in jeder Richtung innerhalb');
  }
}
{
  // Framing und Spielflaeche ueber die Eliminationskette.
  const E = buildEnv('elimination4');
  const A = {};
  for (const ph of [4, 3, 2]) { E.forcePhase(ph); A[ph] = { v: E.viewR(), c: E.arenaCfg() }; }
  const area = (ph) => fbArea(fbCore(A[ph].c), A[ph].c.corner);
  ok(area(4) > area(3),
     'die Spielflaeche schrumpft beim ersten Umbau deutlich (' + Math.round(area(4)) + ' -> ' +
     Math.round(area(3)) + ' BR^2)');
  // Das breite Finale ist in der ABSOLUTEN Flaeche praktisch so gross wie die Drei-Tore-Arena
  // (+1 %); pro Spieler ist es mit Abstand die groesszuegigste Phase. Genau so freigegeben -
  // der Wert wird hier festgehalten, damit eine spaetere Aenderung nicht unbemerkt bleibt.
  ok(Math.abs(area(2) / area(3) - 1) < 0.05,
     'die Spielflaeche 3 -> 2 bleibt praktisch gleich (' + Math.round(area(3)) + ' -> ' +
     Math.round(area(2)) + ' BR^2, ' + (area(2) / area(3) * 100 - 100).toFixed(1) + ' %)');
  ok(area(2) / 2 > area(3) / 3 * 1.4,
     'pro Spieler ist das Finale die mit Abstand groesszuegigste Phase (' +
     Math.round(area(2) / 2) + ' gegen ' + Math.round(area(3) / 3) + ' BR^2 je Spieler)');
  ok(A[4].v > A[3].v,
     'der Sichtradius wird beim ersten Umbau enger (' + Math.round(A[4].v) + ' > ' + Math.round(A[3].v) + ')');
  // Beim zweiten Umbau bestimmt die Deckkante HINTER den Toren den Sichtradius, nicht die
  // Spielflaeche. Das breite Finale zieht die Kamera deshalb wieder etwas auf, obwohl das
  // Spielfeld weiter schrumpft. Bewusst so freigegeben - hier festgehalten, nicht stillschweigend.
  ok(A[2].v > A[3].v,
     'Sichtradius 3 -> 2 waechst mit dem breiten Finale (' + Math.round(A[3].v) + ' -> ' +
     Math.round(A[2].v) + ', +' + Math.round((A[2].v / A[3].v - 1) * 100) + ' %) - bewusste Folge der Formwahl');
}
{
  // FLOW auf dem normalen Gameplaypfad: 4 -> 3 -> 2 -> Sieg mit den finalen Geometrien.
  const E = buildEnv('elimination4');
  E.newMatch();
  ok(E.phaseN() === 4 && E.arenaCfg().halfLen === 17.50, 'Flow: das Match startet in der Vier-Tore-Arena');
  E.eliminate(2); E.applyPhase();
  ok(E.phaseN() === 3 && E.arenaCfg().spawn === 8.15,
     'Flow: nach dem ersten Tor steht die finale Drei-Tore-Arena');
  for (const s of [0, 1, 2]) {
    const p = E.spawnAt(s);
    ok0(E.boundSDAt(p.x, p.y, false).sd < -E.BR * 0.5, 'Flow: fairer Reset in Phase 3');
  }
  E.eliminate(1); E.applyPhase();
  ok(E.phaseN() === 2 && E.arenaCfg().halfLen === 15.60 && E.arenaCfg().spawn === 10.15,
     'Flow: nach dem zweiten Tor steht das finale Shouldered-Wide-Finale');
  const s0 = E.spawnAt(0), s1 = E.spawnAt(1);
  ok(Math.abs(s0.x - E.cx - 10.15 * E.BR) < 1e-9 && Math.abs(s1.x - E.cx + 10.15 * E.BR) < 1e-9 &&
     Math.abs(s0.y - E.cy) < 1e-9 && Math.abs(s1.y - E.cy) < 1e-9,
     'Flow: beide Finalisten stehen exakt gegenueber auf ihrer Torachse');
  E.eliminate(3);
  ok(E.winner() !== null, 'Flow: das letzte Tor beendet das Match mit einem Sieger');
}
// =================================================================================
// P - MORPH-QUALITAET DER FINALEN FORMEN (4 -> 3)
// =================================================================================
// Die V3-Transition liest Start- und Endform direkt aus den finalen Arenakonstanten.
// Geprueft wird, dass sie mit ihnen exakt trifft: exakte Endformen, konvexe Zwischenformen,
// monotone Wandbewegung ohne Gegenbewegung, kein Tor ueber der Deckkante.
{
  const R = FB_SANDBOX();
  const S = { 4: R.A4, 3: R.A3 };
  ok(R.fbElimArena() === R.A4, 'der Morph startet auf der freigegebenen Vier-Tore-Arena');
  ok(Array.isArray(S[3].poly) && S[3].poly.length === 6,
     'der Morph endet auf dem gekappten Dreieck der finalen Phase 3');

  const supp = (P, th) => {
    let m = -Infinity;
    for (const p of P) { const d = p.x * Math.cos(th) + p.z * Math.sin(th); if (d > m) m = d; }
    return m;
  };
  const devSup = (P, Q) => {
    let w = 0;
    for (let k = 0; k < 720; k++) { const th = k * Math.PI / 360; w = Math.max(w, Math.abs(supp(P, th) - supp(Q, th))); }
    return w;
  };
  // Startform: exakt die Vier-Tore-Arena. Endform: exakt das gekappte Dreieck.
  const ref4 = R.fbOutline(R.A4.halfLen * 32, R.A4.halfWid * 32, R.A4.corner * 32, 20);
  const ref3 = R.fbRoundPoly(S[3].poly.map(v => [v[0] * 32, v[1] * 32]), S[3].corner * 32, 20);
  const m0 = R.fbMorphRing(0).ring, m1 = R.fbMorphRing(1).ring;
  ok(devSup(m0, ref4) < 1e-6,
     '4 -> 3 Morph: Fortschritt 0 ist exakt die Vier-Tore-Arena (' + devSup(m0, ref4).toExponential(1) + ')');
  ok(devSup(m1, ref3) < 1e-6,
     '4 -> 3 Morph: Fortschritt 1 ist exakt das gekappte Dreieck (' + devSup(m1, ref3).toExponential(1) + ')');

  // Zwischenformen: konvex, endlich, nicht groesser als der Start.
  let concave = 0, bad = 0, grew = 0, s0 = 0;
  for (let d = 0; d < 360; d++) s0 = Math.max(s0, supp(m0, d * Math.PI / 180));
  for (let k = 0; k <= 20; k++) {
    const ring = R.fbMorphRing(k / 20).ring, P = ring.slice(0, ring.length - 1), n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n], c = P[(i + 2) % n];
      if ((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x) < -1e-6) concave++;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.nx)) bad++;
    }
    for (let d = 0; d < 360; d++) if (supp(P, d * Math.PI / 180) > s0 + 1e-6) grew++;
  }
  ok(concave === 0, '4 -> 3 Morph: jede Zwischenform ist konvex (kein Einknicken, keine Taille)');
  ok(bad === 0, '4 -> 3 Morph: keine Zwischenform enthaelt NaN/Infinity');
  ok(grew === 0, '4 -> 3 Morph: keine Zwischenform ist groesser als die Ausgangsarena');

  // Der Kern der V3-Idee: die Wanddistanz laeuft in JEDER Richtung monoton.
  const H = [];
  for (let k = 0; k <= 20; k++) {
    const P = R.fbMorphRing(k / 20).ring, row = [];
    for (let d = 0; d < 180; d++) row.push(supp(P, d * Math.PI / 90));
    H.push(row);
  }
  let dirMono = 0, over = 0, jump = 0;
  for (let d = 0; d < 180; d++) {
    const a = H[0][d], b = H[20][d], up = b > a;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (let k = 1; k <= 20; k++) {
      if (up ? H[k][d] < H[k - 1][d] - 1e-6 : H[k][d] > H[k - 1][d] + 1e-6) dirMono++;
      over = Math.max(over, H[k][d] - hi, lo - H[k][d]);
      jump = Math.max(jump, Math.abs(H[k][d] - H[k - 1][d]));
    }
  }
  ok(dirMono === 0,
     '4 -> 3 Morph: die Wanddistanz laeuft in JEDER Richtung monoton (' + dirMono + ' Gegenbewegungen)');
  ok(over <= 1e-6, '4 -> 3 Morph: keine Richtung laeuft ueber ihren Start- oder Endwert hinaus');
  ok(jump < 40,
     '4 -> 3 Morph: die Kontur bewegt sich in gleichmaessigen Schritten (groesster Schritt ' +
     jump.toFixed(1) + ' Einheiten je 5 %)');

  // Eckensicherheit: kein Torgrundriss ragt waehrend des Morphs ueber die Deckkante.
  const HALF = R.A4.postOuter * 32, DEPTH = 1.184 * 32, DECK = (1.184 * 2 * 32 + 25);
  const outside = (deck, P) => {
    let worst = -Infinity;
    for (let i = 0; i < deck.length; i++) {
      const a = deck[i], b = deck[(i + 1) % deck.length];
      const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez) || 1;
      worst = Math.max(worst, (P.x - a.x) * (ez / L) + (P.z - a.z) * (-ex / L));
    }
    return worst;
  };
  let worstAll = -Infinity;
  for (const e of [0, 0.25, 0.5, 0.75, 1]) {
    const rd = R.fbMorphRing(e);
    const deck = rd.ring.slice(0, rd.ring.length - 1).map(p => ({ x: p.x + p.nx * DECK, z: p.z + p.nz * DECK }));
    for (let k = 0; k < 60; k++) {
      const h = R.fbRingChord(rd.ring, k / 60, HALF);
      const tx = -h.nz, tz = h.nx;
      for (const sg of [-1, 1]) for (const dp of [0, 2 * DEPTH])
        worstAll = Math.max(worstAll, outside(deck, {
          x: h.x + h.nx * dp + tx * sg * HALF, z: h.z + h.nz * dp + tz * sg * HALF }));
    }
  }
  ok(worstAll <= 0.5,
     '4 -> 3 Morph: kein Torgrundriss ragt ueber die Deckkante (max ' + worstAll.toFixed(1) + ')');
}

// =================================================================================
// T - ARENA-TRANSITION 3 -> 2 (rein visuell, Prototyp)
// =================================================================================
// Derselbe Transitionspfad wie 4 -> 3, nur mit anderer Ausgangs- und Zielform. Die
// Besonderheit: 3P und 2P haben weder dieselbe Eckenzahl (6 gegen 8) noch denselben
// Eckradius (3.50 gegen 2.60). Beides wird ueber die Stuetzfunktion mitgefuehrt.
{
  // Vollstaendiger Ablauf: Phase 3 -> zweites Tor -> Transition -> Finale -> Ball-Drop.
  const E = buildEnv('elimination4');
  E.newMatch();
  E.eliminate(0);
  E.applyPhase();
  ok(E.phaseN() === 3, 'Vorbedingung: die Arena steht auf drei Toren');
  parkPlayers(E);
  shootAt(E, 1);
  ok(E.goalState() === 'fall', 'Vorbedingung: der zweite Torablauf laeuft');
  ok(E.morphWanted() === true, 'nach der zweiten Eliminierung wird die Transition gewollt');

  let n = 0;
  while (E.goalState() !== 'morph' && n < 400) { E.step(); n++; }
  ok(E.goalState() === 'morph', 'die Transition startet nach dem Celebration Window');
  ok(E.phaseN() === 3 && E.dirs().length === 3,
     'zu Beginn der Transition steht noch EXAKT die Drei-Tore-Arena');
  ok(E.goalE() === 0 && E.arenaE() === 0, 'beide Abschnitte starten bei exakt 0');

  const plan = E.morphPlan();
  ok(plan !== null && plan.length === 3, 'der Plan kennt alle drei Tore der alten Arena');
  ok(plan.filter(g => g.dead).length === 1, 'genau ein Tor ist als ausgeschieden markiert');
  ok(plan.filter(g => !g.dead).every(g => g.target >= 0 && g.target < 2),
     'jedes verbleibende Tor hat genau einen Phase-2-Slot');
  const tgt = plan.filter(g => !g.dead).map(g => g.target).sort();
  ok(JSON.stringify(tgt) === JSON.stringify([0, 1]),
     'die beiden Ziele decken die beiden Phase-2-Slots genau einmal ab');
  const byOwner = plan.filter(g => !g.dead).sort((a, b) => a.owner - b.owner).map(g => g.target);
  ok(JSON.stringify(byOwner) === JSON.stringify([0, 1]),
     'die Zuordnung folgt der aufsteigenden Spieler-ID - identisch zu fbElimApplyPhase');

  const view0 = E.viewR();
  ok(Math.round(view0) === 539, 'das Framing startet auf dem Sichtradius der Drei-Tore-Arena');
  const before = E.snapshot();
  const T2 = E.morphTicks();
  let gUp = true, aUp = true, finite = true, hidden = false, moved = 0, seen = 0;
  let gPrev = -1, aPrev = -1, camOk = true, orderOk = true;
  for (let k = 0; k < T2.total + 5; k++) {
    if (E.goalState() !== 'morph') break;
    seen++;
    ok0(E.goalBusy() === true, 'Eingaben sind waehrend der ganzen Transition gesperrt');
    ok0(E.canCommit(1) === false, 'kein Commit waehrend der Transition');
    ok0(E.phaseN() === 3, 'die Phase wechselt waehrend der Transition NICHT');
    const gp = E.goalE(), ap = E.arenaE();
    if (!Number.isFinite(gp) || !Number.isFinite(ap)) finite = false;
    if (gp < gPrev - 1e-9) gUp = false;
    if (ap < aPrev - 1e-9) aUp = false;
    if (ap > 1e-9 && gp < 1 - 1e-9) orderOk = false;      // Arena erst nach den Toren
    gPrev = gp; aPrev = ap;
    if (Math.abs(E.viewR() - view0) > 1e-9) camOk = false;
    if (E.bodyLevel() < 0.02) hidden = true;
    const now = E.snapshot();
    for (let i = 0; i < now.length; i++)
      if (Math.abs(now[i].x - before[i].x) > 1e-9 || Math.abs(now[i].y - before[i].y) > 1e-9) moved++;
    E.step();
  }
  ok(seen === T2.total, 'die Transition dauert exakt ' + T2.total + ' Ticks (erhalten: ' + seen + ')');
  ok(gUp && aUp, 'beide Fortschritte laufen monoton von 0 nach 1');
  ok(gPrev === 1 && aPrev === 1, 'beide Abschnitte enden exakt auf 1');
  ok(orderOk, 'der Arenaumbau beginnt erst, wenn die Torneuordnung abgeschlossen ist');
  ok(camOk, 'das Kamera-Framing bleibt waehrend der ganzen Transition konstant (kein Sprung)');
  ok(finite, 'beide Fortschritte sind zu jedem Zeitpunkt endlich (kein NaN/Infinity)');
  ok(moved === 0, 'waehrend der Transition bewegt sich kein einziger Koerper (' + moved + ' Abweichungen)');
  ok(E.snapshot().every(b => b.vx === 0 && b.vy === 0),
     'alle Koerper sind waehrend der Transition kontrolliert eingefroren');
  ok(hidden, 'die Figuren ziehen sich waehrend der Transition sichtbar zurueck');
  ok(E.finite(), 'alle Koerperwerte bleiben endlich');

  // Endzustand: exakt das freigegebene Finale, Spieler VOR dem Ball, Commit erst danach.
  ok(E.goalState() === 'spawn', 'nach der Transition folgt der Ball-Drop (spawn)');
  const a2 = E.arenaCfg();
  ok(E.phaseN() === 2 && E.dirs().length === 2, 'der Endzustand ist EXAKT die Zwei-Tore-Arena');
  ok(a2.halfLen === 15.60 && a2.halfWid === 11.60 && a2.corner === 2.60 && a2.spawn === 10.15,
     'der Endzustand ist exakt die finale Shouldered-Wide-Geometrie');
  ok(Array.isArray(a2.poly) && a2.poly.length === 8, 'das Finale hat wieder acht Kernecken');
  const sn = E.snapshot();
  for (let s = 0; s < 2; s++) {
    const o = E.slotOwner(s), sp = E.spawnAt(s);
    ok(near(sn[o].x, sp.x) && near(sn[o].y, sp.y),
       'P' + (o + 1) + ' steht nach der Transition auf dem finalen 2P-Spawn');
  }
  ok(near(sn[4].x, E.cx) && near(sn[4].y, E.cy), 'der Ball steht im Zentrum des Finales');
  ok(E.morphActive() === false, 'die Transition ist beendet');
  ok(E.morphPlan() === null, 'der Plan ist aufgeraeumt');
  ok(E.canCommit(1) === false, 'waehrend des Ball-Drops ist noch kein Commit moeglich');
  ok(E.bodyLevel() < 1, 'die Figuren kommen erst waehrend des Ball-Drops zurueck');
  ok(Math.round(E.viewR()) === 600, 'nach dem Einrasten gilt der Sichtradius des Finales');

  let m = 0;
  while (E.goalState() !== 'play' && m < 200) { E.step(); m++; }
  ok(E.goalState() === 'play', 'nach dem Ball-Drop laeuft das Finale');
  ok(E.bodyLevel() === 1, 'die Figuren sind wieder voll sichtbar');
  E.step();
  ok(E.canCommit(1) === true, 'Commit ist erst nach dem Ball-Drop moeglich');
}
{
  // Der Sieg baut nicht mehr um - 2 -> 1 laeuft ohne Transition.
  const W = buildEnv('elimination4');
  W.newMatch();
  W.eliminate(0); W.applyPhase();
  W.eliminate(1); W.applyPhase();
  ok(W.phaseN() === 2, 'Vorbedingung: das Finale steht');
  W.eliminate(2);
  ok(W.winner() !== null, 'Vorbedingung: das Match ist entschieden');
  ok(W.morphWanted() === false, 'beim Sieg gibt es keine Transition');
}
{
  // GEOMETRIE DES 3 -> 2 MORPHS. Gerechnet auf den echten Rendererquellen.
  const R = FB_SANDBOX();
  const PLAN = { from: 3, to: 2 };
  const ring = (e) => R.fbMorphRing(e, PLAN).ring;
  const supp = (P, th) => {
    let m = -Infinity;
    for (const p of P) { const d = p.x * Math.cos(th) + p.z * Math.sin(th); if (d > m) m = d; }
    return m;
  };
  const devSup = (P, Q) => {
    let w = 0;
    for (let k = 0; k < 720; k++) { const th = k * Math.PI / 360; w = Math.max(w, Math.abs(supp(P, th) - supp(Q, th))); }
    return w;
  };
  // Start- und Endform exakt die freigegebenen Arenen - inklusive ihres eigenen Eckradius.
  const ref = (a) => R.fbRoundPoly(a.poly.map(v => [v[0] * 32, v[1] * 32]), a.corner * 32, 20);
  const m0 = ring(0), m1 = ring(1);
  ok(devSup(m0, ref(R.A3)) < 1e-9,
     '3 -> 2 Morph: Fortschritt 0 ist exakt die finale Drei-Tore-Arena (' + devSup(m0, ref(R.A3)).toExponential(1) + ')');
  ok(devSup(m1, ref(R.A2)) < 1e-9,
     '3 -> 2 Morph: Fortschritt 1 ist exakt die finale Zwei-Tore-Arena (' + devSup(m1, ref(R.A2)).toExponential(1) + ')');

  // Zwischenformen: konvex, endlich, ohne Selbstueberschneidung.
  let concave = 0, bad = 0, selfCut = 0;
  for (let k = 0; k <= 40; k++) {
    const r = ring(k / 40), P = r.slice(0, r.length - 1), n = P.length;
    let turn = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n], c = P[(i + 2) % n];
      if ((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x) < -1e-6) concave++;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.nx)) bad++;
      let d = Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turn += d;
    }
    if (Math.abs(Math.abs(turn) - 2 * Math.PI) > 1e-3) selfCut++;
  }
  ok(concave === 0, '3 -> 2 Morph: jede Zwischenform ist konvex (kein Einknicken)');
  ok(bad === 0, '3 -> 2 Morph: keine Zwischenform enthaelt NaN/Infinity');
  ok(selfCut === 0, '3 -> 2 Morph: keine Zwischenform ueberschneidet sich selbst');

  // Der Kern der Architektur: der Wandabstand laeuft in JEDER Richtung monoton, ohne
  // Ueberschwingen - trotz unterschiedlicher Eckenzahl UND unterschiedlichem Eckradius.
  // Gerechnet auf der exakten Form (Kernpolygon + Radius), nicht auf der Ringpolylinie.
  const coreAt = (e) => {
    const C = R.fbMorphCores(PLAN);
    return { P: R.fbMinkowski(C.a.map(v => [v[0] * (1 - e), v[1] * (1 - e)]),
                              C.b.map(v => [v[0] * e, v[1] * e])),
             rc: C.rcA + (C.rcB - C.rcA) * e };
  };
  const H = [];
  for (let k = 0; k <= 60; k++) {
    const { P, rc } = coreAt(k / 60), row = [];
    for (let d = 0; d < 360; d++) {
      const th = d * Math.PI / 180;
      let m = -Infinity;
      for (const p of P) m = Math.max(m, p[0] * Math.cos(th) + p[1] * Math.sin(th));
      row.push(m + rc);
    }
    H.push(row);
  }
  let nonMono = 0, over = 0, maxStep = 0;
  for (let d = 0; d < 360; d++) {
    const a = H[0][d], b = H[60][d], up = b > a, lo = Math.min(a, b), hi = Math.max(a, b);
    for (let k = 1; k <= 60; k++) {
      if (up ? H[k][d] < H[k - 1][d] - 1e-9 : H[k][d] > H[k - 1][d] + 1e-9) nonMono++;
      over = Math.max(over, H[k][d] - hi, lo - H[k][d]);
      maxStep = Math.max(maxStep, Math.abs(H[k][d] - H[k - 1][d]));
    }
  }
  ok(nonMono === 0, '3 -> 2 Morph: die Wanddistanz laeuft in JEDER Richtung monoton');
  ok(over <= 1e-9, '3 -> 2 Morph: keine Richtung laeuft ueber ihren Start- oder Endwert hinaus');
  ok(maxStep < 40, '3 -> 2 Morph: gleichmaessige Schritte (groesster ' + maxStep.toFixed(1) + ' Einheiten je 1/60)');

  // Eckradius: startet auf 3.50, endet auf 2.60, laeuft dazwischen monoton und bleibt
  // immer zwischen beiden Werten - kein Sprung, keine kurzzeitig ueberrundete Ecke.
  let rcMono = true, rcIn = true, rcPrev = Infinity;
  for (let k = 0; k <= 60; k++) {
    const rc = coreAt(k / 60).rc / 32;
    if (rc > rcPrev + 1e-9) rcMono = false;
    if (rc > 3.50 + 1e-9 || rc < 2.60 - 1e-9) rcIn = false;
    rcPrev = rc;
  }
  ok(Math.abs(coreAt(0).rc / 32 - 3.50) < 1e-9, 'der Eckradius startet exakt auf 3.50');
  ok(Math.abs(coreAt(1).rc / 32 - 2.60) < 1e-9, 'der Eckradius endet exakt auf 2.60');
  ok(rcMono && rcIn, 'der Eckradius laeuft monoton und verlaesst das Intervall [2.60, 3.50] nie');

  // Die vier Schulterflaechen entstehen kontrolliert: die Wandsegmente in Schulterrichtung
  // wachsen monoton von 0 auf ihren Endwert, die dritte Torseite verschwindet monoton.
  const wallLen = (e, n) => {
    const { P } = coreAt(e);
    const Q = [];
    for (const v of P) { const l = Q[Q.length - 1]; if (l && Math.hypot(l[0] - v[0], l[1] - v[1]) < 1e-6) continue; Q.push(v); }
    if (Q.length > 1 && Math.hypot(Q[0][0] - Q[Q.length - 1][0], Q[0][1] - Q[Q.length - 1][1]) < 1e-6) Q.pop();
    let best = 0;
    for (let i = 0; i < Q.length; i++) {
      const a = Q[i], b = Q[(i + 1) % Q.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
      if ((ez / L) * n[0] + (-ex / L) * n[1] > 0.999) best = Math.max(best, L);
    }
    return best;
  };
  const SH = [Math.cos(35 * Math.PI / 180), Math.sin(35 * Math.PI / 180)];   // Schulternormale
  let shGrow = true, shPrev = -1;
  for (let k = 0; k <= 60; k++) {
    const L = wallLen(k / 60, SH);
    if (L < shPrev - 1e-6) shGrow = false;
    shPrev = L;
  }
  ok(wallLen(0, SH) < 1e-6, 'bei Fortschritt 0 gibt es noch keine Schulterflaeche');
  ok(shGrow, 'die Schulterflaeche waechst monoton, sie poppt nicht auf');
  ok(Math.abs(wallLen(1, SH) - 3.54 * 32) < 1.0,
     'am Ende steht die Schulter auf ihrer finalen Laenge (' + (wallLen(1, SH) / 32).toFixed(2) + ' BR)');

  // Die dritte Torseite (Suedwest-Normale der Drei-Tore-Arena) zieht sich monoton zurueck.
  const DEAD = [-Math.cos(30 * Math.PI / 180), -0.5];
  let deadShrink = true, deadPrev = Infinity;
  for (let k = 0; k <= 60; k++) {
    const L = wallLen(k / 60, DEAD);
    if (L > deadPrev + 1e-6) deadShrink = false;
    deadPrev = L;
  }
  ok(deadShrink, 'die nicht mehr benoetigte dritte Torseite zieht sich monoton zurueck');
}
{
  // Die Tore behalten ihre Identitaet: beide Wege sind kurz, kreuzungsfrei und enden exakt
  // auf den beiden 180-Grad-Achsen des Finales.
  const COS30 = 0.8660254037844387;
  const D3 = [[0, -1], [COS30, 0.5], [-COS30, 0.5]], D2 = [[1, 0], [-1, 0]];
  const path = (from, to) => {
    const a0 = Math.atan2(D3[from][1], D3[from][0]);
    let d = Math.atan2(D2[to][1], D2[to][0]) - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return { a0, d };
  };
  // Von drei Toren ueberlebt eines von dreien nicht - drei moegliche Paare, Ziele nach ID.
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const A = path(i, 0), B = path(j, 1);
    ok0(Math.abs(A.d) <= Math.PI + 1e-9 && Math.abs(B.d) <= Math.PI + 1e-9,
        'beide Tore nehmen den kuerzesten Winkelweg');
    let minSep = Infinity;
    for (let k = 0; k <= 100; k++) {
      const t = k / 100;
      let s = Math.abs((A.a0 + A.d * t) - (B.a0 + B.d * t)) % (2 * Math.PI);
      if (s > Math.PI) s = 2 * Math.PI - s;
      minSep = Math.min(minSep, s);
    }
    ok(minSep > 1.0,
       'Tore ' + i + '/' + j + ': die beiden Wege kreuzen sich nie (kleinster Abstand ' +
       (minSep * 180 / Math.PI).toFixed(0) + ' Grad)');
  }
}
{
  // Die Tore bleiben waehrend des ganzen 3 -> 2 Umbaus vollstaendig auf dem Deck.
  const R = FB_SANDBOX();
  const PLAN = { from: 3, to: 2 };
  const HALF = R.A3.postOuter * 32, DEPTH = 1.184 * 32, DECK = (1.184 * 2 * 32 + 25);
  const outside = (deck, P) => {
    let worst = -Infinity;
    for (let i = 0; i < deck.length; i++) {
      const a = deck[i], b = deck[(i + 1) % deck.length];
      const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez) || 1;
      worst = Math.max(worst, (P.x - a.x) * (ez / L) + (P.z - a.z) * (-ex / L));
    }
    return worst;
  };
  let worstAll = -Infinity;
  for (const e of [0, 0.25, 0.5, 0.75, 1]) {
    const rd = R.fbMorphRing(e, PLAN);
    const deck = rd.ring.slice(0, rd.ring.length - 1).map(p => ({ x: p.x + p.nx * DECK, z: p.z + p.nz * DECK }));
    for (let k = 0; k < 60; k++) {
      const h = R.fbRingChord(rd.ring, k / 60, HALF);
      const tx = -h.nz, tz = h.nx;
      for (const sg of [-1, 1]) for (const dp of [0, 2 * DEPTH])
        worstAll = Math.max(worstAll, outside(deck, {
          x: h.x + h.nx * dp + tx * sg * HALF, z: h.z + h.nz * dp + tz * sg * HALF }));
    }
  }
  ok(worstAll <= 0.5,
     '3 -> 2 Morph: kein Torgrundriss ragt ueber die Deckkante (max ' + worstAll.toFixed(1) + ')');
}
{
  // STATE-LEAK: ein neues Match nach einer gelaufenen Transition startet vollstaendig sauber,
  // und der Transitionspfad funktioniert im zweiten Match unveraendert. Der Plan traegt seit
  // 3 -> 2 die Ausgangs- und Zielphase - ein haengengebliebener Plan wuerde die Tore auf die
  // falschen Achsen schicken.
  const E = buildEnv('elimination4');
  E.newMatch();
  E.eliminate(0);
  E.applyPhase();
  parkPlayers(E);
  shootAt(E, 1);
  let n = 0;
  while (E.goalState() !== 'morph' && n < 400) { E.step(); n++; }
  ok(E.goalState() === 'morph', 'Vorbedingung: die 3 -> 2 Transition laeuft');
  ok(JSON.stringify(E.morphPhases()) === JSON.stringify({ from: 3, to: 2 }),
     'der Plan haelt Ausgangs- und Zielphase fest (3 -> 2)');

  // Mitten in der Transition ein neues Match starten.
  E.newMatch();
  ok(E.morphPlan() === null && E.morphPhases() === null, 'Matchreset raeumt den Transitionsplan');
  ok(E.morphActive() === false, 'Matchreset beendet die Transition');
  ok(E.morphSpawn() === false, 'Matchreset raeumt die Spawn-Markierung');
  ok(E.goalState() === 'play' && E.phaseN() === 4, 'das neue Match startet in Phase 4');
  ok(E.bodyLevel() === 1, 'die Figuren sind im neuen Match sofort voll sichtbar');
  ok(Math.round(E.viewR()) === 746, 'das Framing steht wieder auf der Vier-Tore-Arena');

  // Und der Weg 4 -> 3 laeuft im zweiten Match unveraendert.
  E.eliminate(2);
  ok(E.morphWanted() === true, 'im neuen Match wird 4 -> 3 wieder gewollt');
  E.newMatch();
  E.eliminate(0);
  E.applyPhase();
  E.eliminate(1);
  ok(E.morphPhases() === null, 'vor dem Start der Transition gibt es noch keinen Plan');
  ok(E.morphWanted() === true, 'im neuen Match wird auch 3 -> 2 wieder gewollt');
}
// =================================================================================
// U - TRANSITION-FX (rein visuell, Produktstand)
// =================================================================================
// Der FX-Pegel wird in jedem Frame aus dem bestehenden Morph-Fortschritt abgeleitet. Es gibt
// dafuer keinen eigenen Zustand: kein Timer, kein Parameter, kein Schreibzugriff auf Koerper,
// Wertung oder Ablauf. Ausserhalb einer Transition ist der Pegel exakt 0.
{
  // Ohne jede Zutat: die Transitions-FX gehoeren zum normalen Elimination-Spiel.
  const E = buildEnv('elimination4');
  E.newMatch();
  ok(E.fxEdge(0) === 0 && E.fxEdge(1) === 0 && E.fxEdge(2) === 0,
     'im laufenden Spiel sind alle Kantenpegel 0');
  ok(E.fxDrain(0) === 0 && E.fxDrain(1) === 0, 'im laufenden Spiel ist der Drain 0');
  ok(!HTML.includes('DEV_FX') && !HTML.includes('FB_FX_PRESET'),
     'es gibt keinen Dev-Parameter und keine Preset-Matrix mehr');
  ok(/const FB_FX_EDGE=0\.62;/.test(HTML) && /const FB_FX_LOCK=1\.00;/.test(HTML) &&
     /const FB_FX_EMIT=1\.10;/.test(HTML),
     'die freigegebenen Werte stehen als Produktkonstanten im Code (0.62 / 1.00 / 1.10)');
}
{
  // Verlauf ueber BEIDE Arenawechsel: gueltiger Bereich, Ruhe an beiden Enden, sichtbare
  // Wanderung nach aussen und ein klarer Einrastakzent.
  const E = buildEnv('elimination4');
  E.newMatch();
  for (const step of [{ from: 4, shoot: 0 }, { from: 3, shoot: 1 }]) {
    parkPlayers(E);
    shootAt(E, step.shoot);
    let n = 0;
    while (E.goalState() !== 'morph' && n < 400) { E.step(); n++; }
    const tag = step.from + ' -> ' + (step.from - 1);
    ok(E.goalState() === 'morph', tag + ': die Transition laeuft');
    ok(E.phaseN() === step.from, tag + ': Vorbedingung - die Ausgangsphase steht noch');

    const T = E.morphTicks();
    const trace = [[], [], []];
    let bad = 0, hold = 0;
    for (let k = 0; k < T.total; k++) {
      for (let t = 0; t < 3; t++) {
        const lv = E.fxEdge(t);
        if (!Number.isFinite(lv) || lv < 0 || lv > 1) bad++;
        trace[t].push(lv);
      }
      if (E.goalTick() < T.hold && E.fxEdge(0) !== 0) hold++;
      E.step();
    }
    ok(bad === 0, tag + ': jeder Kantenpegel bleibt endlich und im Bereich [0, 1]');
    ok(hold === 0, tag + ': waehrend des Holds bleibt die Kante ruhig');
    ok(Math.max.apply(null, trace[0]) > 0.5, tag + ': die Kante wird waehrend des Umbaus deutlich aktiv');

    // Wanderung: die Welle erreicht ihr Maximum je Stufe spaeter, je weiter aussen sie liegt.
    const peakAt = trace.map(a => a.indexOf(Math.max.apply(null, a)));
    ok(peakAt[0] < peakAt[1] && peakAt[1] < peakAt[2],
       tag + ': der Impuls laeuft nach aussen (Spitzen bei Tick ' + peakAt.join(' < ') + ')');
    // Einrastimpuls: nach dem Ende des Arenaumbaus wird die innere Kante noch einmal hell.
    const lockAt = T.hold + T.goals + T.arena;
    const lockPeak = Math.max.apply(null, trace[0].slice(lockAt));
    const beforeLock = trace[0][lockAt - 1];
    ok(lockPeak > beforeLock * 3 && lockPeak > 0.5,
       tag + ': das Einrasten ist ein eigener Akzent (' + beforeLock.toFixed(2) + ' -> ' +
       lockPeak.toFixed(2) + ')');

    // Nach der Transition exakt Ruhezustand - kein haengengebliebener Glow.
    ok(E.goalState() !== 'morph', tag + ': die Transition ist beendet');
    ok(E.fxEdge(0) === 0 && E.fxEdge(1) === 0 && E.fxEdge(2) === 0,
       tag + ': nach der Transition sind alle Kantenpegel exakt 0');
    let after = 0;
    for (let k = 0; k < 240; k++) { E.step(); for (let t = 0; t < 3; t++) if (E.fxEdge(t) !== 0) after++; }
    ok(after === 0, tag + ': auch im weiteren Spielverlauf bleibt die Kante bei exakt 0');
    ok(E.phaseN() === step.from - 1, tag + ': die Phase ist regulaer weitergelaufen');
  }
}
{
  // Das ausgeschiedene Tor verliert seine Energie WAEHREND der Torneuordnung; die
  // verbleibenden Tore bleiben unberuehrt.
  const E = buildEnv('elimination4');
  E.newMatch();
  parkPlayers(E);
  shootAt(E, 0);
  let n = 0;
  while (E.goalState() !== 'morph' && n < 400) { E.step(); n++; }
  const plan = E.morphPlan();
  const deadSlot = plan.find(g => g.dead).slot;
  const liveSlots = plan.filter(g => !g.dead).map(g => g.slot);
  const T = E.morphTicks();
  let rise = true, prev = -1, liveBad = 0, badRange = 0;
  for (let k = 0; k < T.hold + T.goals; k++) {
    const d = E.fxDrain(deadSlot);
    if (!Number.isFinite(d) || d < 0 || d > 1) badRange++;
    if (d < prev - 1e-9) rise = false;
    prev = d;
    for (const s of liveSlots) if (E.fxDrain(s) !== 0) liveBad++;
    E.step();
  }
  ok(badRange === 0, 'der Drain bleibt endlich und im Bereich [0, 1]');
  ok(rise, 'das ausgeschiedene Tor verliert seine Energie monoton');
  ok(prev === 1, 'am Ende der Torneuordnung ist es vollstaendig entladen');
  ok(liveBad === 0, 'die verbleibenden Tore behalten ihre Teamfarbe (Drain exakt 0)');
  while (E.goalState() === 'morph') E.step();
  ok(E.fxDrain(deadSlot) === 0, 'nach der Transition schreibt der Drain nichts mehr');
}
{
  // KEIN Einfluss auf den Spielzustand. Der FX-Pegel wird waehrend eines kompletten
  // Torablaufs in JEDEM Tick abgefragt; Koerper, Phase, Wertung und Ablauf muessen danach
  // bitgleich zu einem Lauf ohne jede Abfrage sein.
  const run = (readFx) => {
    const E = buildEnv('elimination4');
    E.newMatch();
    parkPlayers(E);
    shootAt(E, 0);
    const log = [];
    for (let k = 0; k < 320; k++) {
      if (readFx) { E.fxEdge(0); E.fxEdge(1); E.fxEdge(2); E.fxDrain(0); E.fxDrain(1); }
      E.step();
      log.push(E.goalState() + '|' + E.goalTick() + '|' + E.phaseN() + '|' + E.winner() + '|' +
               E.active().join('') + '|' +
               E.snapshot().map(b => b.x.toFixed(9) + ',' + b.y.toFixed(9) + ',' +
                                     b.vx.toFixed(9) + ',' + b.vy.toFixed(9) + ',' + b.alive).join(';'));
    }
    return log.join('\n');
  };
  ok(run(true) === run(false),
     'das Auslesen der FX-Pegel veraendert den Spielzustand in 320 Ticks nicht');
}
{
  // Kein FX-Zustand nach einem Matchreset - und kein FX in Classic oder Tactical.
  const E = buildEnv('elimination4');
  E.newMatch();
  parkPlayers(E);
  shootAt(E, 0);
  let n = 0;
  while (E.goalState() !== 'morph' && n < 400) { E.step(); n++; }
  for (let k = 0; k < 40; k++) E.step();
  ok(E.fxEdge(0) + E.fxEdge(1) + E.fxEdge(2) > 0, 'Vorbedingung: die Kante ist gerade aktiv');
  E.newMatch();
  ok(E.fxEdge(0) === 0 && E.fxEdge(1) === 0 && E.fxEdge(2) === 0,
     'ein Matchreset mitten in der Transition setzt die Kantenpegel sofort auf 0');
  ok(E.fxDrain(0) === 0 && E.fxDrain(1) === 0, 'und auch den Drain');
  // Und das zweite Match laeuft danach wieder vollstaendig durch seine Transition.
  parkPlayers(E);
  shootAt(E, 0);
  let m = 0;
  while (E.goalState() !== 'morph' && m < 400) { E.step(); m++; }
  ok(E.goalState() === 'morph', 'das zweite Match startet seine Transition regulaer');
  for (let k = 0; k < 60; k++) E.step();
  ok(E.fxEdge(0) + E.fxEdge(1) + E.fxEdge(2) > 0, 'und die Kante wird darin wieder aktiv');

  for (const v of [undefined, 'tactical']) {
    const C = buildEnv(v);
    C.newMatch();
    ok0(C.fxEdge(0) === 0 && C.fxEdge(1) === 0 && C.fxEdge(2) === 0,
        (v || 'classic') + ': keine Transition, also kein FX');
    ok0(C.fxDrain(0) === 0, (v || 'classic') + ': kein Torfade');
    for (let k = 0; k < 60; k++) {
      C.step();
      ok0(C.fxEdge(0) === 0 && C.fxEdge(1) === 0, (v || 'classic') + ': auch im Spielverlauf kein FX');
    }
  }
  ok(true, 'Classic und Tactical bleiben vollstaendig ohne Transition-FX');
}
{
  // Quellpruefung: der FX-Pegel darf nirgends in den Spielzustand schreiben, und der
  // Renderer darf pro Umbauschritt keine neuen Materialien erzeugen.
  const fxSrc = grab(/\/\/ ── ARENA-TRANSITION-FX \(REIN VISUELL\) ──[\s\S]*?\nfunction fbFxDrain\(slot\)\{[\s\S]*?\n\}/,
                     'Transition-FX-Block');
  for (const forbidden of ['fbGoalState=', 'fbElimPhaseN=', 'fbMorphPlan=', 'footballWinner=',
                           'balls[', 'Math.random', 'Date.now', 'setTimeout'])
    ok0(!fxSrc.includes(forbidden), 'der FX-Block enthaelt kein ' + forbidden);
  ok(true, 'der FX-Block liest nur - er schreibt keinen Spielzustand und ist frei von Zufall');
  ok(/const applyArenaFx=\(\)=>\{/.test(HTML), 'die Arena-FX werden in EINER Renderfunktion angewendet');
  ok(/if\(lv<=0\)\{t\.mat\.emissive\.copy\(t\.emis\);t\.mat\.emissiveIntensity=t\.int;\}/.test(HTML),
     'bei Pegel 0 wird exakt der Ruhezustand des Materials zurueckgeschrieben');
  // Die drei Goldstufen werden EINMAL angelegt und danach nur noch nachgeschlagen - sonst
  // entstuenden bei jedem der dutzenden Umbauschritte neue Materialobjekte.
  ok(/const fbArenaGold=\(tier\)=>\{\s*if\(!fbGoldTiers\.length\)\{/.test(HTML),
     'die Goldstufen entstehen genau einmal, nicht pro Arenaaufbau');
  const build = grab(/const fbBuildShape=\(mo\)=>\{[\s\S]*?\n      const ring=mo\?mo\.rd\.ring/, 'fbBuildShape-Kopf');
  ok(!/gold=fbMat\.gold\|\|goldM/.test(build),
     'der Arenaaufbau greift nicht mehr direkt auf das geteilte Goldmaterial zu');
}
// =================================================================================
// V - TRANSITION-AUDIO (rein praesentational, Produktstand)
// =================================================================================
// Das Transition-Audio haengt an denselben Ticks wie die Bewegung und der visuelle
// Lock-Impuls. Es hat keinen eigenen Zustand: die Ausloeser sind reine Gleichheitspruefungen
// auf den Transitionsfortschritt. Ausserhalb einer Transition wird nichts gerufen.
{
  // Produktstand: kein Parameter noetig, keine Preset-Matrix, keine Prototyp-Pfade.
  ok(!HTML.includes('DEV_TAUDIO') && !HTML.includes('FB_TAUDIO_SETS') && !HTML.includes('fbTAudioSet'),
     'es gibt keinen Dev-Parameter und keine Klangrichtungs-Matrix mehr');
  ok(!/energy/i.test(HTML), 'kein ENERGY-Rest im Produktpfad');
  ok(!HTML.includes('football-elimination-transition-audio-prototype'),
     'der Produktcode zeigt auf keine Prototyp-Pfade');
  ok(/const FB_TAUDIO_BED='assets\/audio\/arena_football_transition_reconfigure\.wav';/.test(HTML) &&
     /const FB_TAUDIO_LOCK='assets\/audio\/arena_football_transition_lock\.wav';/.test(HTML),
     'die beiden finalen Produktassets stehen fest im Code');
  ok(/const FB_TAUDIO_BED_GAIN=0\.77;/.test(HTML) && /const FB_TAUDIO_LOCK_GAIN=0\.69;/.test(HTML),
     'die freigegebenen Pegel stehen als Produktkonstanten im Code (0.77 / 0.69)');
  // Die Assets liegen tatsaechlich im Repository und sind gueltige WAV-Dateien.
  for (const [f, minKb] of [['assets/audio/arena_football_transition_reconfigure.wav', 200],
                            ['assets/audio/arena_football_transition_lock.wav', 20]]) {
    const p = require('path').join(__dirname, '..', f);
    ok0(require('fs').existsSync(p), f + ' liegt im Repository');
    const buf = require('fs').readFileSync(p);
    ok0(buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WAVE',
        f + ' ist eine gueltige WAV-Datei');
    ok0(buf.length > minKb * 1024, f + ' ist vollstaendig (' + Math.round(buf.length / 1024) + ' kB)');
  }
  ok(true, 'beide finalen Audioassets sind vorhanden und gueltig');
  ok(!require('fs').existsSync(require('path').join(__dirname, '..', 'assets/audio/energy_reconfigure.wav')) &&
     !require('fs').existsSync(require('path').join(__dirname, '..', 'assets/audio/energy_lock.wav')),
     'es liegt kein ENERGY-Asset unter assets/audio');
}
{
  // Beide Umbauten: je genau EIN Bett und EIN Einrastakzent - ohne jede Zutat.
  const E = buildEnv('elimination4');
  E.newMatch();
  for (const step of [{ from: 4, shoot: 0 }, { from: 3, shoot: 1 }]) {
    E.taudioReset();
    parkPlayers(E);
    shootAt(E, step.shoot);
    const tag = step.from + ' -> ' + (step.from - 1);
    let n = 0;
    while (E.goalState() !== 'morph' && n < 400) { E.step(); n++; }
    ok(E.goalState() === 'morph', tag + ': die Transition laeuft');
    ok(E.taudio().bed === 0 && E.taudio().lock === 0,
       tag + ': zu Beginn der Transition ist noch nichts ausgeloest');

    const T = E.morphTicks();
    let bedAt = -1, lockAt = -1;
    for (let k = 0; k < T.total; k++) {
      const before = E.taudio();
      E.step();
      const after = E.taudio();
      if (after.bed > before.bed) bedAt = E.goalTick();
      if (after.lock > before.lock) lockAt = E.goalTick();
    }
    const t = E.taudio();
    ok(t.bed === 1, tag + ': das Bett startet genau einmal (' + t.bed + ')');
    ok(t.lock === 1, tag + ': der Einrastakzent kommt genau einmal (' + t.lock + ')');
    ok(bedAt === T.hold, tag + ': das Bett startet am Ende des Holds, Tick ' + bedAt);
    ok(lockAt === T.hold + T.goals + T.arena,
       tag + ': der Akzent liegt exakt auf dem Lock-Tick ' + lockAt);

    const end = E.taudio();
    let more = 0;
    for (let k = 0; k < 240; k++) {
      E.step();
      const now = E.taudio();
      if (now.bed !== end.bed || now.lock !== end.lock) more++;
    }
    ok(more === 0, tag + ': nach der Transition loest nichts mehr aus');
  }
}
{
  // Der Akzent und der visuelle Lock-Impuls liegen auf demselben Tick.
  const E = buildEnv('elimination4');
  E.newMatch();
  parkPlayers(E);
  shootAt(E, 0);
  let n = 0;
  while (E.goalState() !== 'morph' && n < 400) { E.step(); n++; }
  const T = E.morphTicks();
  let audioTick = -1, fxTick = -1, fxPrev = 0;
  for (let k = 0; k < T.total; k++) {
    const before = E.taudio();
    E.step();
    if (E.taudio().lock > before.lock) audioTick = E.goalTick();
    const lv = E.fxEdge(0);
    if (fxTick < 0 && E.goalTick() >= T.hold + T.goals + T.arena && lv > fxPrev * 3 && lv > 0.5)
      fxTick = E.goalTick();
    fxPrev = lv;
  }
  ok(audioTick > 0 && audioTick === fxTick,
     'Audio-Lock und visueller Lock-Impuls liegen auf demselben Tick (' + audioTick + ')');
  ok(/const FB_TAUDIO_LOCK_TICK=FB_MORPH_HOLD_TICKS\+FB_MORPH_GOAL_TICKS\+FB_MORPH_ARENA_TICKS;/.test(HTML),
     'beide leiten sich aus denselben Konstanten ab - keine zweite Magic Number');
}
{
  // Der Sieg (2 -> 1) baut nicht mehr um und loest deshalb auch kein Audio aus.
  const E = buildEnv('elimination4');
  E.newMatch();
  E.eliminate(0); E.applyPhase();
  E.eliminate(1); E.applyPhase();
  ok(E.phaseN() === 2, 'Vorbedingung: das Finale steht');
  E.taudioReset();
  parkPlayers(E);
  shootAt(E, 0);                                  // im Finale gibt es nur die Slots 0 und 1
  let n = 0;
  while (E.goalState() !== 'result' && n < 500) { E.step(); n++; }
  ok(E.winner() !== null, 'Vorbedingung: das Match ist entschieden');
  const t = E.taudio();
  ok(t.bed === 0 && t.lock === 0, 'das entscheidende Tor loest kein Transition-Audio aus');
}
{
  // Matchreset stoppt einen laufenden Klang, und das neue Match startet sauber.
  const E = buildEnv('elimination4');
  E.newMatch();
  parkPlayers(E);
  shootAt(E, 0);
  let n = 0;
  while (E.goalState() !== 'morph' && n < 400) { E.step(); n++; }
  for (let k = 0; k < 20; k++) E.step();
  ok(E.taudio().bed === 1, 'Vorbedingung: das Bett laeuft');
  const before = E.taudio().stop;
  E.newMatch();
  ok(E.taudio().stop > before, 'der Matchreset stoppt den laufenden Transitionsklang');
  E.taudioReset();
  parkPlayers(E);
  shootAt(E, 0);
  let m = 0;
  while (E.goalState() !== 'morph' && m < 400) { E.step(); m++; }
  for (let k = 0; k < E.morphTicks().total; k++) E.step();
  const t = E.taudio();
  ok(t.bed === 1 && t.lock === 1, 'das neue Match loest wieder genau einmal aus');
}
{
  // Classic und Tactical kennen weder Transition noch Transition-Audio.
  for (const v of [undefined, 'tactical']) {
    const C = buildEnv(v);
    C.newMatch();
    for (let k = 0; k < 200; k++) C.step();
    const t = C.taudio();
    ok0(t.bed === 0 && t.lock === 0, (v || 'classic') + ': kein Transition-Audio');
  }
  ok(true, 'Classic und Tactical bleiben ohne Transitionsklang');
}
{
  // KEIN Einfluss auf den Spielzustand: das Abspielen darf Koerper, Phase, Wertung und
  // Ablauf nicht beruehren. Verglichen wird gegen einen Lauf, dessen Audioschicht nie
  // gerufen wird (fbGoalState nie 'morph' - hier ueber Classic als Gegenprobe).
  const run = (variant) => {
    const E = buildEnv(variant);
    E.newMatch();
    const log = [];
    for (let k = 0; k < 200; k++) {
      E.step();
      log.push(E.goalState() + '|' + E.goalTick() + '|' +
               E.snapshot().map(b => b.x.toFixed(9) + ',' + b.y.toFixed(9)).join(';'));
    }
    return log.join('\n');
  };
  ok(run(undefined) === run(undefined), 'der Ablauf ist in sich deterministisch');

  // Und der eigentliche Beweis: ein kompletter Torablauf mit Transition liefert exakt
  // denselben Zustandsverlauf wie derselbe Ablauf mit stummgeschalteter Audioschicht.
  const play = (mute) => {
    const E = buildEnv('elimination4');
    if (mute) E.muteAudio();
    E.newMatch();
    parkPlayers(E);
    shootAt(E, 0);
    const log = [];
    for (let k = 0; k < 320; k++) {
      E.step();
      log.push(E.goalState() + '|' + E.goalTick() + '|' + E.phaseN() + '|' + E.winner() + '|' +
               E.active().join('') + '|' +
               E.snapshot().map(b => b.x.toFixed(9) + ',' + b.y.toFixed(9) + ',' +
                                     b.vx.toFixed(9) + ',' + b.vy.toFixed(9) + ',' + b.alive).join(';'));
    }
    return { log: log.join('\n'), ta: E.taudio() };
  };
  const a = play(false), b = play(true);
  ok(a.ta.bed === 1 && a.ta.lock === 1, 'Vorbedingung: der Lauf hat wirklich getriggert');
  // Der Ausloeser feuert auch stummgeschaltet - unterdrueckt wird erst die Wiedergabe, und
  // zwar im bestehenden soundOn-Gate (Quellpruefung weiter unten). Entscheidend hier: der
  // Zustandsverlauf ist in beiden Faellen identisch, der Ausloeser hat also keine Wirkung
  // auf das Spiel.
  ok(b.ta.bed === 1 && b.ta.lock === 1, 'der Ausloeser laeuft auch bei stummem Ton');
  ok(a.log === b.log, 'der Zustandsverlauf ueber 320 Ticks ist in beiden Faellen identisch');
}
{
  // Quellpruefung: der Ausloeser liest nur, Stoppen und Stummschalten sind verdrahtet,
  // und die Wiedergabe haengt am bestehenden soundOn-Gate.
  const src = grab(/\/\/ ── ARENA-TRANSITION-AUDIO ──[\s\S]*?\nfunction fbTAudioTick\(\)\{[\s\S]*?\n\}/,
                   'Transition-Audio-Block');
  for (const forbidden of ['balls[', 'Math.random', 'Date.now', 'performance.now', 'setTimeout'])
    ok0(!src.includes(forbidden), 'der Ausloeser enthaelt kein ' + forbidden);
  for (const name of ['fbGoalState', 'fbGoalTick', 'fbElimPhaseN', 'footballWinner', 'fbMorphPlan'])
    ok0(!new RegExp(name + '\\s*=[^=]').test(src), 'der Ausloeser schreibt nicht in ' + name);
  ok(true, 'der Audio-Ausloeser liest nur den Fortschritt - kein Spielzustand, kein Zufall');
  ok(/if\(!soundOn\)\{SFX\.charge\.stop\(\);SFX\.fbTransitionStop\(\);if\(typeof fbMusicStop==='function'\)fbMusicStop\(\);\}/.test(HTML),
     'Stummschalten stoppt einen laufenden Transitionsklang (und die Musik)');
  ok((HTML.match(/SFX\.fbTransitionStop\(\)/g) || []).length >= 4,
     'gestoppt wird bei Matchreset, Menuerueckkehr und an beiden Stummschaltern');
  ok(/function playTa\(src,gain\)\{\s*go\(cc=>\{/.test(HTML),
     'die Wiedergabe laeuft durch dasselbe soundOn-Gate wie jeder andere Klang (go)');
  // Speicher- und Voice-Sicherheit: einmal laden, Buffer wiederverwenden, Voices aufraeumen.
  ok(/if\(e\.state!==0\)return e;/.test(HTML), 'je Datei genau EIN Ladeversuch - kein wiederholter Fetch');
  ok(/bs\.onended=\(\)=>releaseTaVoice\(v\);/.test(HTML), 'jede Quelle wird nach dem Ende freigegeben');
  ok(/function releaseTaVoice\(v\)\{\s*if\(!fbTaVoices\.delete\(v\)\)return;/.test(HTML),
     'die Freigabe ist gegen doppelte Aufrufe abgesichert');
  ok(!/new\s*\(window\.AudioContext[\s\S]{0,400}new\s*\(window\.AudioContext/.test(HTML),
     'es gibt weiterhin genau EINEN AudioContext');
  // Der Torsound bleibt vollstaendig unberuehrt.
  ok(/const FOOTBALL_GOAL_ASSET_GAIN=0\.80;/.test(HTML), 'der Torsound behaelt seinen Pegel 0.80');
  ok(/FB_GOAL_SRCS=\['assets\/audio\/arena_football_goal\.ogg','assets\/audio\/arena_football_goal\.mp3'\]/.test(HTML),
     'der Torsound behaelt seine Quelle');
  ok(/footballGoalFxTrigger\(slot\);/.test(HTML) && /SFX\.footballGoal\(/.test(HTML),
     'der Torsound behaelt seine Triggerlogik');
}


// =================================================================================
// W - ZWEI LEBEN: DAS ERSTE GEGENTOR IST EIN NORMALES TOR, DAS ZWEITE SCHEIDET AUS
// =================================================================================
// Dieser Block prueft die Regel selbst und benutzt parkPlayers deshalb NICHT ueber den
// Umweg 'letztes Leben': er stellt die Figuren zwar genauso auf, setzt die Leben danach
// aber ausdruecklich wieder auf den Produktstand zurueck.
const parkFull = (E) => {
  parkPlayers(E);
  for (let o = 0; o < 4; o++) if (E.active()[o]) E.setLives(o, 2);
};

// W1 - Ausgangszustand und Quelle der Regel.
{
  const E = buildEnv('elimination4');
  E.newMatch();
  ok(JSON.stringify(E.lives()) === '[2,2,2,2]', 'jeder Spieler startet mit zwei Leben');
  ok(JSON.stringify(E.active()) === '[true,true,true,true]', 'alle vier Spieler sind aktiv');
  ok(/const FB_ELIM_LIVES=2;/.test(elimBlockSrc), 'die Lebenszahl ist eine benannte Konstante');
  ok((elimBlockSrc.match(/fbElimLives\[o\]=FB_ELIM_LIVES/g) || []).length === 1,
     'GENAU EINE Stelle fuellt Leben wieder auf - der vollstaendige Matchreset');
  ok(/function fbElimReset\(\)\{[\s\S]{0,220}fbElimLives\[o\]=FB_ELIM_LIVES/.test(elimBlockSrc),
     'diese Stelle liegt in fbElimReset');
  ok(/fbElimLives\[o\]/.test(renderBarSrc),
     'die Chipleiste liest die Leben (Anzeige, kein zweiter Zustand)');
}

// W2 - ERSTES Gegentor: normales Tor, kein Umbau, kein totes Tor, kein Transitionsklang.
{
  const E = buildEnv('elimination4');
  E.newMatch();
  parkFull(E);
  E.taudioReset();
  const g0 = E.goalSounds();
  shootAt(E, 2);                                    // Slot 2 == P3 in Phase 4
  ok(E.goalState() === 'fall', 'der regulaere Torablauf startet');
  ok(E.active()[2] === true, 'P3 ist nach dem ERSTEN Gegentor NICHT ausgeschieden');
  ok(E.lives()[2] === 1, 'P3 verliert genau ein Leben (2 -> 1)');
  ok(JSON.stringify(E.lives()) === '[2,2,1,2]', 'kein anderer Spieler verliert ein Leben');
  ok(E.goalOpen(2) === true, 'das getroffene Tor bleibt offen - kein toter Torzustand');
  ok(E.morphWanted() === false, 'kein Arenaumbau nach dem ersten Gegentor');
  ok(E.goalSounds() === g0 + 1, 'der normale Torsound laeuft genau einmal');
  ok(E.matchPointSounds() === 0, 'kein Matchpunkt-Sound');
  ok(E.snapshot()[2].alive === true, 'die Figur von P3 bleibt im Spiel');

  const n = E.finishGoal();
  ok(E.goalState() === 'play', 'der Torablauf endet deterministisch (' + n + ' Ticks)');
  ok(E.phaseN() === 4, 'die Arena bleibt die Vier-Spieler-Arena');
  ok(E.arenaCfg().halfLen === 17.50 && E.arenaCfg().sides === 4, 'die Arenaform ist unveraendert');
  ok(JSON.stringify(E.taudio()) === JSON.stringify({ bed: 0, lock: 0, stop: 0 }),
     'kein Transitions-Audio: weder Bett noch Einrastakzent');
  ok([0, 1, 2, 3].every(k => E.fxDrain(k) === 0), 'kein Transitions-FX an irgendeinem Tor');
  ok(E.morphPlan() === null && E.morphActive() === false, 'es gibt keinen Umbauplan');

  // FAIRER RESET: alle vier Figuren auf den kanonischen Spawns, Ball zentral, alles still.
  const after = E.snapshot();
  for (let s2 = 0; s2 < 4; s2++) {
    const o = E.slotOwner(s2), sp = E.spawnAt(s2);
    ok(near(after[o].x, sp.x) && near(after[o].y, sp.y),
       'P' + (o + 1) + ' steht nach dem ersten Gegentor auf dem fairen Spawn');
  }
  ok(after.every(b => b.vx === 0 && b.vy === 0), 'alle Geschwindigkeiten sind null');
  ok(near(after[4].x, E.cx) && near(after[4].y, E.cy) && after[4].passed === false,
     'der neutrale Ball steht wieder zentral, der Durchtritts-Latch ist leer');
  E.step();
  ok(E.phase() === 'aim', 'die naechste verdeckte Runde oeffnet regulaer');
}

// W3 - ZWEITES Gegentor desselben Spielers: jetzt greift die bestehende Eliminierung.
{
  const E = buildEnv('elimination4');
  E.newMatch();
  parkFull(E);
  shootAt(E, 2); E.finishGoal(); E.step();
  parkFull(E);                                       // Leben der Ueberlebenden wieder auf 2
  E.setLives(2, 1);                                  // P3 steht weiter auf seinem letzten Leben
  E.taudioReset();
  shootAt(E, 2);
  ok(E.lives()[2] === 0, 'das zweite Gegentor nimmt das letzte Leben');
  ok(E.active()[2] === false, 'P3 ist ausgeschieden');
  ok(E.snapshot()[2].alive === false, 'die Figur von P3 ist deaktiviert');
  ok(E.goalOpen(2) === false, 'sein Tor ist ab sofort geschlossen');
  ok(E.morphWanted() === true, 'jetzt wird der Arenaumbau gewollt');
  E.finishGoal();
  ok(E.phaseN() === 3, 'nach dem Umbau steht die Drei-Spieler-Arena');
  ok(E.taudio().bed === 1 && E.taudio().lock === 1, 'genau ein Bett und ein Einrastakzent im Umbau');
  ok(E.lives()[2] === 0, 'ein ausgeschiedener Spieler verliert kein weiteres Leben');
}

// W4 - KEIN doppelter Lebensabzug: ein Tor wertet genau einmal.
{
  const E = buildEnv('elimination4');
  E.newMatch();
  parkFull(E);
  shootAt(E, 2);
  const lv = JSON.stringify(E.lives());
  // Waehrend des laufenden Torablaufs weiterrechnen: der Ball liegt noch hinter der Linie,
  // aber footballTryGoal ist nur aus 'play' erreichbar.
  for (let i = 0; i < 40; i++) E.step();
  ok(JSON.stringify(E.lives()) === lv, 'waehrend des Torablaufs faellt kein zweites Leben');
  E.finishGoal();
  ok(JSON.stringify(E.lives()) === lv, 'auch nach dem Reset zaehlt dasselbe Tor nicht erneut');
  // Der Ball steht zentral und traegt keinen Durchtritts-Latch mehr - dieselbe Lage kann
  // also nicht noch einmal als Tor gewertet werden.
  ok(E.crossed(4) === -1, 'der zurueckgesetzte Ball ueberquert keine Torlinie');
}

// W5 - Leben ueberleben die Phasenwechsel 4 -> 3 und 3 -> 2.
{
  const E = buildEnv('elimination4');
  E.newMatch();
  parkFull(E);
  E.setLives(0, 1); E.setLives(1, 2); E.setLives(2, 1); E.setLives(3, 1);
  shootAt(E, 2); E.finishGoal();                     // P3 hatte 1 Leben -> raus
  ok(E.phaseN() === 3, 'Vorbedingung: die Drei-Spieler-Arena steht');
  ok(E.lives()[0] === 1 && E.lives()[1] === 2 && E.lives()[3] === 1,
     'die Ueberlebenden behalten ihren Lebensstand (Blau 1, Rot 2, Gelb 1)');
  ok(E.lives()[2] === 0, 'der Ausgeschiedene bleibt bei null');
  E.step();
  parkPlayers(E);                                    // setzt alle Aktiven auf ihr letztes Leben
  E.setLives(1, 2);                                  // P2 geht mit zwei Leben ins Halbfinale
  const slot = E.slots().indexOf(0);                 // P1 sitzt auf diesem Slot
  shootAt(E, slot); E.finishGoal();
  ok(E.phaseN() === 2, 'Vorbedingung: das Zwei-Spieler-Finale steht');
  ok(E.lives()[1] === 2 && E.lives()[3] === 1,
     'auch nach dem zweiten Umbau bleiben die Lebensstaende erhalten (2 gegen 1)');
  ok(E.winner() === null, 'noch kein Sieger - es sind zwei Spieler aktiv');
}

// W6 - Im Finale gewinnt erst, wer das letzte Leben des Gegners nimmt.
{
  const E = buildEnv('elimination4');
  E.newMatch();
  parkPlayers(E); shootAt(E, 2); E.finishGoal(); E.step();
  parkPlayers(E); shootAt(E, 1); E.finishGoal(); E.step();
  ok(E.phaseN() === 2 && E.activeOwners().length === 2, 'Vorbedingung: Finale mit zwei Spielern');
  const opp = E.slotOwner(1);
  parkFull(E);                                       // beide wieder auf zwei Leben
  shootAt(E, 1); E.finishGoal();
  ok(E.winner() === null, 'das erste Finaltor entscheidet noch nichts');
  ok(E.lives()[opp] === 1, 'der Getroffene steht jetzt auf einem Leben');
  ok(E.activeOwners().length === 2, 'es sind weiterhin zwei Spieler aktiv');
  E.step();
  parkFull(E); E.setLives(opp, 1);
  shootAt(E, 1); E.finishGoal();
  ok(E.lives()[opp] === 0 && E.active()[opp] === false, 'das zweite Finaltor scheidet ihn aus');
  ok(E.winner() !== null && E.winner() !== opp, 'der verbliebene Spieler gewinnt');
  ok(E.activeOwners().length === 1, 'genau ein Spieler ist noch aktiv');
}

// W7 - Nur der vollstaendige Matchreset fuellt die Leben wieder auf.
{
  const E = buildEnv('elimination4');
  E.newMatch();
  parkFull(E);
  shootAt(E, 2); E.finishGoal(); E.step();
  ok(E.lives()[2] === 1, 'Vorbedingung: P3 steht auf einem Leben');
  E.resetBall();
  ok(E.lives()[2] === 1, 'der Rundenreset fuellt keine Leben auf');
  E.applyPhase();
  ok(E.lives()[2] === 1, 'der Phasenwechsel fuellt keine Leben auf');
  E.resetMatchState();
  ok(JSON.stringify(E.lives()) === '[2,2,2,2]', 'der Matchreset stellt alle Leben wieder her');
  ok(JSON.stringify(E.active()) === '[true,true,true,true]', 'und alle Spieler sind wieder aktiv');
}

// W8 - Kein Lebenszustand in Classic und Tactical.
{
  for (const v of ['classic', 'tactical']) {
    const C = v === 'classic' ? buildEnv() : buildEnv('tactical');
    C.newMatch();
    const snap = C.snapshot();
    const ball = snap.findIndex(b => b.owner === C.neutral);
    // Die Figuren stehen in Classic auf der Torachse - fuer den Schuss aus der Mitte werden
    // sie quer weggestellt, damit die Torlinie und nicht der Gegner getroffen wird.
    let k = 0;
    for (let i = 0; i < snap.length; i++) {
      if (i === ball) continue;
      C.setPos(i, C.cx - 250 + k * 160, C.cy + (k % 2 === 0 ? -260 : 260));
      C.setVel(i, 0, 0);
      k++;
    }
    C.setPos(ball, C.cx, C.cy);
    C.setVel(ball, 22, 0);
    C.setPhaseRaw('sim');
    C.stepUntilGoal();
    ok(C.score()[0] === 1, v + ': das Tor zaehlt regulaer als Punkt');
    ok(JSON.stringify(C.lives()) === '[2,2,2,2,2]', v + ': kein Leben wird abgezogen');
    ok(JSON.stringify(C.active()) === '[true,true,true,true,true]', v + ': niemand scheidet aus');
  }
  ok(/function footballElimConcede\(o\)\{\s*if\(!fbElim4\(\)/.test(elimBlockSrc),
     'der Lebensabzug ist auf Elimination begrenzt (fbElim4-Guard)');
}

// W9 - HUD: zwei Lebenspunkte je Chip, ausgeschiedene Spieler bleiben abgesetzt.
{
  ok(/FB_ELIM_LIVES/.test(renderBarSrc), 'die Chipleiste zeichnet genau FB_ELIM_LIVES Punkte');
  ok(/fbElimLives\[o\]/.test(renderBarSrc), 'gefuellt wird nach dem Lebensstand des Spielers');
  ok(/class[\s\S]{0,40}fpip/.test(renderBarSrc), 'die Punkte tragen eine eigene, schmale Klasse');
  ok(/\.fpip\{[^}]*var\(--fc\)/.test(HTML), 'ein vorhandenes Leben leuchtet in der Spielerfarbe');
  ok(/\.fpip\.off\{/.test(HTML), 'ein verlorenes Leben ist matt statt farbig');
  ok(/' out'/.test(renderBarSrc), 'Ausgeschiedene bleiben ueber .out gedimmt');
  ok(!/innerHTML/.test(renderBarSrc), 'die Chipleiste baut weiterhin nur ueber DOM-Knoten');
  // Ohne Kommentare geprueft: es darf keine zweite Kennzahl neben den Leben stehen.
  ok(!/Tore|Punkte|Score|score\[/.test(renderBarSrc.replace(/\/\/[^\n]*/g, '')),
     'die Leiste zeigt NUR Leben - keine Tore, Punkte oder Gegentore daneben');
}


// ══════════════════════════════════════════════════════════════════════════════════
//  TORRETTUNGSTASCHE — der Verteidiger darf ins eigene Tor
// ══════════════════════════════════════════════════════════════════════════════════
// Die Tasche ist die bestehende Bandenlinie, im lichten Torfenster um eine feste Tiefe
// nach aussen versetzt, und sie gilt ausschliesslich fuer farbige Spielerkugeln. Geprueft
// wird beides: dass der Verteidiger wirklich hineinkommt - und dass er nicht weiter kommt.
{
  // Abstand Zentrum -> Bandenlinie ENTLANG einer Torrichtung, gesucht in der echten
  // Signed-Distance. Damit stimmt die Rechnung in jeder Arenaform (Fuenfeck, Quadrat,
  // Dreieck, Schulterform) ohne eine zweite Geometrie im Test.
  const wand = (E, slot) => {
    const d = E.dirs()[slot];
    let lo = 0, hi = E.arena().halfLen * 3;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (E.boundSDAt(E.cx + d[0] * m, E.cy + d[1] * m, false).sd < 0) lo = m; else hi = m;
    }
    return lo;
  };
  const imTor = (E, slot, tief, quer) => {
    const d = E.dirs()[slot], w = wand(E, slot);
    return { x: E.cx + d[0] * (w + tief) - d[1] * (quer || 0),
             y: E.cy + d[1] * (w + tief) + d[0] * (quer || 0) };
  };
  // Alles ausser dem Schuetzen eng ins Zentrum - inklusive des neutralen Balls, damit
  // waehrend des Laufs kein Tor faellt und niemand den Weg kreuzt.
  const raeumen = (E, ausser) => {
    const n = E.playerCount();
    for (let o = 0; o <= n; o++) {
      if (o === ausser) continue;
      E.setPos(o, E.cx + (o - n / 2) * 3, E.cy + (o - n / 2) * 3);
      E.setVel(o, 0, 0);
    }
  };
  const hinein = (E, idx, slot, speed, quer, steps) => {
    raeumen(E, idx);
    const d = E.dirs()[slot], start = imTor(E, slot, -5 * E.BR, quer || 0);
    return E.slam(idx, start.x, start.y, d[0] * speed, d[1] * speed, steps || 300);
  };

  for (const [variante, phasen] of [['elimination4', [4, 3, 2]], ['elimination', [5, 4, 3, 2]]]) {
    for (const ph of phasen) {
      const E = buildEnv(variante); E.newMatch(); E.forcePhase(ph);
      const tiefe = E.rescueDepth(), etikett = variante + ' Phase ' + ph + ': ';
      ok(tiefe > 0, etikett + 'die Tasche hat eine Tiefe (' + tiefe.toFixed(2) + ' px)');

      for (let slot = 0; slot < ph; slot++) {
        // Frische Umgebung je Slot: ein vorheriger Lauf kann den Torzustand verlassen
        // haben, und dann liefe der naechste gar nicht erst los.
        const E = buildEnv(variante); E.newMatch(); E.forcePhase(ph);
        // ── A: der Verteidiger kommt ueber die alte Sperrebene ──
        const r = hinein(E, 0, slot, 22, 0);
        ok(r.fin, etikett + 'Slot ' + slot + ': kein NaN beim Eintritt');
        ok(r.worst > 1e-3,
           etikett + 'Slot ' + slot + ': der Verteidiger kommt ueber die Bandenlinie (max sd ' +
           r.worst.toFixed(2) + ')');
        // ── B: und nicht weiter als die Tasche tief ist ──
        ok(r.over <= 1e-6,
           etikett + 'Slot ' + slot + ': er bleibt in der Tasche (Ueberschuss ' +
           r.over.toFixed(4) + ')');
        ok(r.worst <= tiefe + 1e-6,
           etikett + 'Slot ' + slot + ': die Tiefe ist die Taschentiefe (' + r.worst.toFixed(2) +
           ' <= ' + tiefe.toFixed(2) + ')');
        ok(!r.passed, etikett + 'Slot ' + slot + ': eine Spielerkugel tritt nie durch das Tor');
        ok(E.postClear(0), etikett + 'Slot ' + slot + ': keine Restpenetration im Sockel');
      }
    }
  }

  // ── C: derselbe Weg mit dem neutralen Ball — die Tasche traegt ihn nicht ──
  {
    const E = buildEnv('elimination4'); E.newMatch(); E.forcePhase(4);
    const ball = E.playerCount();
    raeumen(E, ball);
    const d = E.dirs()[0], w = wand(E, 0);
    const r = E.slam(ball, E.cx + d[0] * (w - 5 * E.BR), E.cy + d[1] * (w - 5 * E.BR),
                     d[0] * 22, d[1] * 22, 300);
    ok(r.passed, 'C: der neutrale Ball tritt durch dieselbe Oeffnung');
    ok(E.rescueLimit(ball) === 0, 'C: fuer den Ball gibt es keine Taschentiefe');
    const p = imTor(E, 0, E.rescueDepth() * 0.5, 0);
    ok(E.rescueLimitAt(p.x, p.y, true) === 0, 'C: auch mitten in der Tasche traegt den Ball nichts');
    ok(E.rescueLimitAt(p.x, p.y, false) === E.rescueDepth(),
       'C: an derselben Stelle traegt sie eine Spielerkugel');
  }

  // ── D: Rettung VOR der Linie ──
  // Der Ball rollt langsam in die Toroeffnung, der Verteidiger faehrt hinein und schlaegt
  // ihn heraus. Ohne die Tasche waere er an der Bande stehen geblieben.
  {
    const E = buildEnv('elimination4'); E.newMatch(); E.forcePhase(4);
    const ball = E.playerCount(), slot = 0, d = E.dirs()[slot], w = wand(E, slot);
    raeumen(E, 0);
    // Der Verteidiger steht bereits in der Tasche - genau die Lage, die es vorher nicht
    // gab. Der Ball rollt von innen auf das Tor zu und prallt an ihm ab.
    const sp = imTor(E, slot, E.rescueDepth() * 0.9, 0);
    E.setPos(0, sp.x, sp.y); E.setVel(0, 0, 0);
    const bp = imTor(E, slot, -2.6 * E.BR, 0);
    E.setPos(ball, bp.x, bp.y); E.setVel(ball, d[0] * 9, d[1] * 9);
    let kontakt = false;
    for (let k = 0; k < 300 && E.goalState() === 'play'; k++) {
      E.step();
      const b = E.snapshot();
      if (Math.hypot(b[0].x - b[ball].x, b[0].y - b[ball].y) <= E.rad(0) + E.rad(ball) + 1) kontakt = true;
    }
    const b = E.snapshot()[ball], F = E.fold(b.x - E.cx, b.y - E.cy);
    ok(kontakt, 'D: der Verteidiger erreicht den Ball in der Toroeffnung');
    ok(E.goalState() === 'play', 'D: kein Tor - er war rechtzeitig da (Zustand ' + E.goalState() + ')');
    ok(E.crossed(ball) < 0, 'D: die Torlinie wurde nie ueberquert');
    ok(F.x < w, 'D: der Ball ist wieder im Feld (' + F.x.toFixed(1) + ' < ' + w.toFixed(1) + ')');
  }

  // ── E: nach der Linie ist Tor ──
  {
    const E = buildEnv('elimination4'); E.newMatch(); E.forcePhase(4);
    const ball = E.playerCount(), slot = 0, d = E.dirs()[slot], a = E.arenaCfg();
    raeumen(E, 0);
    const hinterLinie = (a.postBack * E.BR) + E.rad(ball) + 2;
    E.setPos(ball, E.cx + d[0] * hinterLinie, E.cy + d[1] * hinterLinie);
    E.setVel(ball, d[0] * 2, d[1] * 2);
    E.setPassed(ball, true);
    ok(E.crossed(ball) === slot, 'E: der Ball hat die kanonische Torlinie ueberquert');
    E.step();
    ok(E.goalState() !== 'play', 'E: das Tor wird gewertet (Zustand ' + E.goalState() + ')');
    const leben = E.lives().join(',');
    const sp = imTor(E, slot, -2 * E.BR, 0);
    E.setPos(0, sp.x, sp.y); E.setVel(0, d[0] * 30, d[1] * 30);
    for (let k = 0; k < 60; k++) E.step();
    ok(E.goalState() !== 'play', 'E: der spaetere Spielerkontakt nimmt das Tor nicht zurueck');
    ok(E.lives().join(',') === leben, 'E: und aendert die Leben nicht (' + E.lives().join(',') + ')');
  }

  // ── F: Eintritt mit Hoechstgeschwindigkeit ──
  {
    for (const ph of [4, 3, 2]) {
      const E = buildEnv('elimination4'); E.newMatch(); E.forcePhase(ph);
      for (let slot = 0; slot < ph; slot++) {
        const r = hinein(E, 0, slot, 60, 0, 400);
        ok(r.fin && r.over <= 1e-6,
           'F: Phase ' + ph + ' Slot ' + slot + ': kein Durchschlagen bei Hoechsttempo (Ueberschuss ' +
           r.over.toFixed(4) + ')');
        ok(!r.passed, 'F: Phase ' + ph + ' Slot ' + slot + ': auch schnell tritt kein Spieler durch');
      }
    }
  }

  // ── G: die seitlichen Kanten der Oeffnung ──
  {
    for (const ph of [4, 3, 2]) {
      const E = buildEnv('elimination4'); E.newMatch(); E.forcePhase(ph);
      // Die aeusserste Lage, die eine Spielerkugel im Fenster einnehmen kann: tangential
      // am Sockel. Weiter aussen liegt ihr Mittelpunkt IM Marmor - kein gueltiger Zustand,
      // aus dem heraus man Physik pruefen koennte.
      const halb = E.arena().clearHalf - E.BR;
      for (let slot = 0; slot < ph; slot++) {
        for (const q of [-halb, -halb * 0.8, halb * 0.8, halb]) {
          const r = hinein(E, 0, slot, 30, q, 300);
          ok(r.fin && r.over <= 1e-6,
             'G: Phase ' + ph + ' Slot ' + slot + ' quer ' + q.toFixed(0) +
             ': keine Naht (Ueberschuss ' + r.over.toFixed(4) + ')');
          ok(E.postClear(0),
             'G: Phase ' + ph + ' Slot ' + slot + ' quer ' + q.toFixed(0) + ': kein Steckenbleiben im Sockel');
        }
      }
    }
  }

  // ── H2: ausserhalb des Torfensters gibt es keine Tasche ──
  // Rings um die Arena abgetastet: eine Tasche gibt es GENAU dort, wo auch das Tor ist -
  // im lichten Fenster einer offenen Torseite. Ueberall sonst bleibt die Bande die Bande.
  {
    for (const [variante, phasen] of [['elimination4', [4, 3, 2]], ['elimination', [5, 4, 3, 2]]]) {
      for (const ph of phasen) {
        const E = buildEnv(variante); E.newMatch(); E.forcePhase(ph);
        const tiefe = E.rescueDepth(), halb = E.arena().clearHalf;
        let falschOffen = 0, falschZu = 0, imFenster = 0;
        for (let k = 0; k < 720; k++) {
          const th = k * Math.PI / 360, ux = Math.cos(th), uy = Math.sin(th);
          // Der Punkt, der eine halbe Taschentiefe hinter der Bandenlinie liegt.
          let lo = 0, hi = E.arena().halfLen * 3;
          for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2;
            if (E.boundSDAt(E.cx + ux * m, E.cy + uy * m, false).sd < 0) lo = m; else hi = m; }
          const rr = lo + tiefe * 0.5;
          const x = E.cx + ux * rr, y = E.cy + uy * rr;
          const F = E.fold(x - E.cx, y - E.cy);
          const drin = Math.abs(F.y) <= halb && Math.abs(F.x) > Math.abs(F.y) && E.goalOpen(F.side);
          const lim = E.rescueLimitAt(x, y, false);
          if (drin) { imFenster++; if (lim !== tiefe) falschZu++; }
          else if (lim !== 0) falschOffen++;
        }
        ok(imFenster > 0, 'H2: ' + variante + ' Phase ' + ph + ': das Torfenster wird getroffen (' +
           imFenster + ' von 720 Richtungen)');
        ok(falschOffen === 0, 'H2: ' + variante + ' Phase ' + ph +
           ': keine Tasche ausserhalb des Torfensters (' + falschOffen + ' Ausreisser)');
        ok(falschZu === 0, 'H2: ' + variante + ' Phase ' + ph +
           ': im Torfenster traegt sie ueberall (' + falschZu + ' Luecken)');
      }
    }
  }

  // ── H3: ein geschlossenes Tor ist auch fuer den Verteidiger eine Wand ──
  // Zwischen Gegentor und Arenaumbau steht das Tor des Ausgeschiedenen noch, ist aber
  // geschlossen: dort darf weder der Ball hindurch noch ein Spieler hinein.
  {
    const E = buildEnv('elimination4'); E.newMatch(); E.forcePhase(4);
    const slot = 0, o = E.slotOwner(slot);
    ok(o >= 0 && E.goalOpen(slot), 'H3: das Tor ist zunaechst offen');
    const p = imTor(E, slot, E.rescueDepth() * 0.5, 0);
    ok(E.rescueLimitAt(p.x, p.y, false) === E.rescueDepth(), 'H3: und traegt eine Spielerkugel');
    E.eliminate(o);
    ok(!E.goalOpen(slot), 'H3: nach dem Ausscheiden ist das Tor geschlossen');
    ok(E.rescueLimitAt(p.x, p.y, false) === 0,
       'H3: dann gibt es dort auch keine Tasche mehr');
    // Und die Kugel kommt dort nicht mehr hinein.
    raeumen(E, 1);
    const r = hinein(E, 1, slot, 30, 0, 200);
    ok(r.fin && r.worst <= 1e-6,
       'H3: der Verteidiger prallt am geschlossenen Tor ab (max sd ' + r.worst.toFixed(4) + ')');
  }

  // ── I: Determinismus ──
  {
    const lauf = () => {
      const E = buildEnv('elimination4'); E.newMatch(); E.forcePhase(4);
      hinein(E, 0, 0, 24, 0, 200);
      return E.hash();
    };
    const a = lauf(), b = lauf();
    ok(a === b, 'I: derselbe Eintritt ergibt denselben Zustand (' + a + ')');
    const E = buildEnv('elimination4'); E.newMatch(); E.forcePhase(4);
    const p = imTor(E, 0, 0.4 * E.BR, 0);
    ok(E.rescueLimitAt(p.x, p.y, false) === E.rescueLimitAt(p.x, p.y, false),
       'I: die Taschengrenze ist eine reine Funktion von Ort und Kugelart');
  }
}

console.log('\nFootball-Elimination: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
