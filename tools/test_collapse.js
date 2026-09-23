// Ring-Collapse (lokales Bot Training, Two-Stage-Vertrag RingOut-Delta B2): gezielte State-Machine-Tests.
// Extrahiert das echte Core-Modul (==COLLAPSE-CORE-START/END==) UND den echten stepSim
// (inkl. Ring-out-/Decisive-Logik) aus index.html und treibt beide in einer minimalen
// Sandbox durch die geforderten Szenarien.
//   node tools/test_collapse.js
const fs = require('fs');
const path = require('path');
const HTML = require('./extract').loadIndexHtml();

const grab = (re, name) => { const m = HTML.match(re); if (!m) { console.error('FAIL: ' + name + ' nicht gefunden'); process.exit(2); } return m[0]; };
const coreM = HTML.match(/==COLLAPSE-CORE-START==([\s\S]*?)==COLLAPSE-CORE-END==/);
if (!coreM) { console.error('FAIL: Collapse-Core-Block nicht gefunden'); process.exit(2); }
const core = coreM[1];
const stepSimSrc = grab(/let fbVorausTiefe=0;[\s\S]*?\nfunction stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim (inkl. Planungsschalter)');
// Phase 1.6: stepSim und die Collapse-Auswertung teilen sich diese beiden Helfer.
const ballsOutsideSrc = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const applyLaunchSrc = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
const cancelDragSrc = grab(/function cancelAimDrag\(\)\{[\s\S]*?\n\}/, 'cancelAimDrag');
// Phase 1.5: der komplette Result-Pfad laeuft mit den ECHTEN Produktfunktionen.
const sanitizeSrc = grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove');
const commitSrc = grab(/function commit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'commit');
const applyCommitSrc = grab(/function applyCommit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'applyCommit');
const beginRevealSrc = grab(/function beginReveal\(\)\{[^\n]*\}/, 'beginReveal');
const afterResultSrc = grab(/function afterResult\(\)\{[\s\S]*?\n\}/, 'afterResult');
const startRoundSrc = grab(/function startRound\(\)\{[\s\S]*?setPhaseText\(\);\}/, 'startRound');
const resetCommitsSrc = grab(/function resetCommits\(\)\{[\s\S]*?commitSpin\.push\(0\);\}\}/, 'resetCommits');
const actBtnSrc = grab(/\$\('actBtn'\)\.onclick=\(\)=>\{[\s\S]*?commit\(who,idx,0,0\);\};/, 'Stand-Button-Handler');
const constSrc = grab(/const MAXPULL_FRAC=[^\n]*/, 'Physik-Konstanten');
const spinSrc = grab(/const SPIN_K=[^\n]*/, 'Spin-Konstanten');
const pcolsSrc = grab(/const PCOLS=[^\n]*/, 'PCOLS');
// Physikphase 4B-2: stepSim holt die Restitution ueber curRestBall/Band/Post. Der Block
// wird unveraendert aus index.html uebernommen; bei mode='bot' liefert footballPhys()
// null und alle drei Accessoren geben den unveraenderten globalen REST-Wert zurueck.
const footballRestSrc = grab(/const FOOTBALL_PHYS=\{[\s\S]*?\nfunction curRestPost\(\)[^\n]*/, 'Football-Restitutions-Accessoren');

// Minimale Sandbox mit stubs fuer alle externen Symbole der extrahierten Produktfunktionen.
// Echt (aus index.html extrahiert): Collapse-Core, stepSim inkl. Ring-out/Decisive,
// applyLaunch (Reveal->Sim), cancelAimDrag, commit/applyCommit,
// sanitizeMove, beginReveal, afterResult, startRound, resetCommits, der Stand-Button-
// Handler sowie alle Physikkonstanten. Der komplette Pfad
// aim -> commit -> reveal -> sim -> result -> afterResult -> startRound
// laeuft damit ueber Produktcode statt ueber Nachbauten.
// Gestubbt: nur DOM/Audio/Partikel, placeBalls, gameOver, showRoundEnd und der Bot.
// setPhase() protokolliert jeden Phasenwechsel mit dem Collapse-State — darauf beruht
// der Nachweis, dass nie ein aim+expired-Zustand entsteht.
const prefix = `
  let mode='bot', online=false, fmt='single', ffaN=2;
  let R0=1000, BR=32, R=R0, cx=0, cy=0;
  let phase='aim', phaseStart=0, menuVisible=false;
  let aimSet=[false,false], commitIdx=[], commitAim=[], commitSpin=[], curAimer=0, myPlayer=0;
  let balls=[];
  let outBall=-1, roundWinner=-1, bgPulse=0, bgPulseRGB='';
  let score=[0,0], roundNo=1, winTarget=3;
  let r3dActive=false, r3dOrbit=false, seatGone=[false,false];
  // Pointer-/Drag-Stubs: exakt so viel, wie das echte cancelAimDrag() und der
  // nachgebildete pointerup-Pfad benoetigen.
  let dragging=false, dragShooter=-1, dragOwner=-1;
  let dragStart={x:0,y:0}, dragCur={x:0,y:0}, dragPull={x:0,y:0}, dragSpin=0;
  let aimPid=-1, spinPid=-1;
  const released=[];
  const cv={releasePointerCapture(id){released.push(id);}};
  const phaseLog=[], gameOverCalls=[];
  // botMoves ist zugleich der exakte Zaehler ausgefuehrter lokaler Zuege: applyCommit()
  // ruft im Bot-Modus je erfolgreichem Commit genau einmal botMove() auf. Damit braucht
  // der Produktcode keinen Test-Hook.
  let botMoves=0, roundStarts=0, afterResultCalls=0, roundEnds=0;
  let botShot={dx:0,dy:0};
  // Sichtbarkeit des Tabs — collapseHidden() in index.html liest genau diese beiden Felder.
  const document={hidden:false,visibilityState:'visible'};
  ${constSrc}
  ${spinSrc}
  function curFR(){return FRICTION;} function curFE(){return FEND;} function curST(){return STOPV;}
  ${footballRestSrc}
  function maxPull(){return R0*MAXPULL_FRAC;}
  function np(){return mode==='ffa'?ffaN:2;}
  function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
  function aliveBalls(o){return balls.filter(b=>b.alive&&b.owner===o);}
  function colorSlot(o){return o;}
  function devSync(){} function ejectGoneSeats(){} function onlineSendCommit(){}
  // Deterministischer Bot: standardmaessig stehen bleiben; setBotShot() gibt ihm einen
  // festen Zug, mit dem sich ein rundenbeendender Ring-out reproduzierbar erzeugen laesst.
  function botMove(){botMoves++;const b=aliveBalls(1)[0];return {idx:b?balls.indexOf(b):-1,dx:botShot.dx,dy:botShot.dy};}
  // Neue Runde: zwei Kugeln gegenueber auf 35 % des aktuellen Radius (Analogie zum echten
  // placeBalls fuer fmt 'single'); der Zaehler ist zugleich der startRound-Zaehler.
  function placeBalls(){roundStarts++;balls=[{owner:0,alive:true,x:-R*0.35,y:0,vx:0,vy:0,spin:0},
                                             {owner:1,alive:true,x:R*0.35,y:0,vx:0,vy:0,spin:0}];}
  function gameOver(w){gameOverCalls.push(w);setPhase('over');}
  function showRoundEnd(){roundEnds++;} function showTeamDraw(){roundEnds++;}
  function setPhase(p){phase=p;phaseStart=_t;phaseLog.push(p+':'+collapseState);}
  function updateHud(){} function setPhaseText(){} function onlineArmTurn(){} function openCover(){}
  function spawn(){} function popBall(){} function winnerRGB(){return '';}
  function fx3Hit(){} function fx3Dust(){}
  const sfx={warn:0,tick:0,collapse:0,ringout:0,drop:0,launch:0,round:0,collapseStop:0,colvEvent:0};
  const SFX={warn(){sfx.warn++;},tick(){sfx.tick++;},collapse(){sfx.collapse++;},collapseStop(){sfx.collapseStop++;},colvEvent(){sfx.colvEvent++;},colPreload(){},hit(){},drop(){sfx.drop++;},ringout(){sfx.ringout++;},launch(){sfx.launch++;},round(){sfx.round++;},win(){},rollUpdate(){},unlock(){},charge:{start(){},stop(){},update(){}}};
  // Element-Registry statt Wegwerf-Objekten: der extrahierte Stand-Button-Handler wird
  // dadurch auf _els.actBtn.onclick abgelegt und ist im Test echt aufrufbar.
  const _els={};
  const $=(id)=>{if(!_els[id])_els[id]={textContent:'',offsetWidth:0,style:{},classList:{add(){},remove(){},toggle(){}}};return _els[id];};
  let _t=0; const performance={now(){return _t;}};
  ${pcolsSrc}
  ${ballsOutsideSrc}
  ${resolveRingOutsSrc}
  ${stepSimSrc}
  ${applyLaunchSrc}
  ${cancelDragSrc}
  ${sanitizeSrc}
  ${commitSrc}
  ${applyCommitSrc}
  ${beginRevealSrc}
  ${afterResultSrc}
  ${startRoundSrc}
  ${resetCommitsSrc}
  ${actBtnSrc}
`;
const suffix = `
  ; return {
    tickCollapse, onCollapseExpire, doCollapse, settleCollapse, collapseRoundEnd, pauseCollapseTimer, resetCollapseTimer,
    collapseRemainMs, shrinkFloor, collapseActive, inputLocked, canCommitInput,
    stepSim, applyLaunch, cancelAimDrag, commit, afterResult, startRound,
    ballsOutside, resolveRingOuts,
    setPos(i,x,y){balls[i].x=x;balls[i].y=y;},
    runSim(){let g=0;while(phase==='sim'&&g++<20000)stepSim();},
    // Mini-Nachbau der Produktschleife fuer die Phasen, die der Collapse beruehrt
    // (index.html: reveal -> applyLaunch, sim -> stepSim, result -> afterResult). Nur die
    // RESULT_MS-Wartezeit entfaellt; jeder Zustandsuebergang laeuft ueber Produktcode.
    runLoop(max=40000){let n=0;
      while(n++<max){
        if(phase==='reveal')applyLaunch();
        else if(phase==='sim')stepSim();
        else if(phase==='result'){afterResultCalls++;afterResult();}
        else return;                                   // aim/over: nichts mehr zu treiben
      }},
    standButton(){_els.actBtn.onclick();},             // echter Stand-Button-Handler
    setTime(v){_t=v;}, setMode(m){mode=m;}, setOnline(o){online=o;}, setPhase(p){phase=p;},
    setMenu(m){menuVisible=m;}, setAim(a){aimSet=a;}, setBalls(b){balls=b;}, setR(v){R=v;},
    setFmt(f){fmt=f;}, setScore(s){score=s;}, setWinTarget(v){winTarget=v;}, setBotShot(dx,dy){botShot={dx,dy};},
    setHidden(h){document.hidden=h;document.visibilityState=h?'hidden':'visible';},
    setVel(i,vx,vy,sp){balls[i].vx=vx;balls[i].vy=vy;balls[i].spin=sp;},
    getR(){return R;}, getR0(){return R0;}, getPhase(){return phase;}, getBalls(){return balls;},
    getRoundWinner(){return roundWinner;}, getOutBall(){return outBall;},
    getPhaseLog(){return phaseLog.slice();}, getBotMoves(){return botMoves;}, getReleased(){return released.slice();},
    getScore(){return score.slice();}, getRoundNo(){return roundNo;}, getGameOver(){return gameOverCalls.slice();},
    getRoundStarts(){return roundStarts;}, getAfterResultCalls(){return afterResultCalls;}, getRoundEnds(){return roundEnds;},
    // Tatsaechlich gesetzter Zug je Seat — ersetzt das fruehere Commit-Logbuch und prueft
    // damit den angewendeten Zustand statt eines Harness-Protokolls.
    getCommits(){return {aimSet:aimSet.slice(),idx:commitIdx.slice(),
                         aim:commitAim.map(a=>({dx:a.dx,dy:a.dy})),spin:commitSpin.slice()};},
    // Nachbildung des echten Drag-Starts (startAim) und des pointerup-Handlers aus index.html.
    // Beide beruehren nur Pointer-/DOM-Zustand; die Zugfreigabe selbst laeuft ueber das echte commit().
    startDrag(pid,who,idx){aimPid=pid;dragging=true;dragShooter=idx;dragOwner=who;dragPull={x:200,y:0};dragSpin=0.5;},
    pointerUp(pid){
      if(pid===spinPid){spinPid=-1;return;}
      if(pid!==aimPid)return;
      const who=dragOwner,sh=dragShooter;
      dragging=false;aimPid=-1;spinPid=-1;dragShooter=-1;dragOwner=-1;
      let px=dragPull.x,py=dragPull.y;const mp=maxPull(),pl=Math.sqrt(px*px+py*py);
      if(pl>mp){px*=mp/pl;py*=mp/pl;}
      let fx=-px,fy=-py,spin=0;
      if(pl<BR*0.4){fx=0;fy=0;spin=0;}else{spin=dragSpin;}
      commit(who,sh,fx,fy,spin);
    },
    getDrag(){return {dragging,aimPid,spinPid,dragShooter,dragOwner,dragPull:{x:dragPull.x,y:dragPull.y},dragSpin};},
    // Produkt-Frame-Schleife: exakt der tickCollapse-Aufruf aus loop() (kein Zugtimer in dieser App).
    prodTick(now){_t=now;tickCollapse(now);},
    hudText(){updateCollapseHud();return $('collapseTimer').textContent;},
    get state(){return {collapseEnabled,collapseState,collapseStage,matchElapsedMs,collapseRadius,collapseOuterR,collapseCountShown,collapseCountVisible,collapseWarned};},
    get sfx(){return sfx;},
    consts(){return {MATCH_COLLAPSE_SECONDS,COLLAPSE_STAGE_COUNT,COLLAPSE_CYCLE_SECONDS,COLLAPSE_WARNING_SECONDS,FINAL_COUNTDOWN_SECONDS,COLLAPSE_RADIUS_FACTOR,MAX_COLLAPSE_TICK_DELTA_MS};}
  };
`;
const make = () => new Function(prefix + core + suffix)();

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const twoBalls = () => [{owner:0,alive:true,x:0,y:0,vx:0,vy:0,spin:0},{owner:1,alive:true,x:9,y:9,vx:0,vy:0,spin:0}];
const ball = (owner,x,y) => ({owner,alive:true,x,y,vx:0,vy:0,spin:0});
// Seit Phase 1.5 klemmt tickCollapse ein einzelnes Frame-Delta auf
// MAX_COLLAPSE_TICK_DELTA_MS. Tests muessen die Uhr deshalb wie ein echter rAF-Verlauf
// vorruecken statt in einem Riesensprung. 50 ms = 20 fps, klar unter der Klemmung.
const FRAME_MS = 50;
const advance = (e, fromMs, toMs, step = FRAME_MS) => {
  for (let tt = fromMs + step; tt < toMs; tt += step) { e.setTime(tt); e.tickCollapse(tt); }
  e.setTime(toMs); e.tickCollapse(toMs);
};
// Faehrt die Matchuhr aus der Planungsphase heraus bis zum Ende des LAUFENDEN Zyklus.
// Bei 0 faellt der Collapse SOFORT in der Planungsphase (kein Auto-Stand, kein Warten auf
// Schuss/Settlement): der Helfer endet, sobald die Stufe gestiegen ist. Hat der Collapse
// selbst die Runde beendet (phase 'result'), bleibt sie so stehen.
const runOutTimer = (e, maxMs = 200000) => {
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  const stage0 = e.state.collapseStage;
  let tt = 0;
  while (e.state.collapseStage === stage0 && e.state.collapseState === 'running' && tt < maxMs) {
    tt += FRAME_MS; e.setTime(tt); e.tickCollapse(tt);
  }
  return tt;
};

// ── 0) Konstanten exakt (Two-Stage-Vertrag, RingOut-Delta B2) ──
{
  const c = make().consts();
  t('COLLAPSE_STAGE_COUNT=2', c.COLLAPSE_STAGE_COUNT === 2);
  t('COLLAPSE_CYCLE_SECONDS=30', c.COLLAPSE_CYCLE_SECONDS === 30);
  t('MATCH_COLLAPSE_SECONDS=60 (Stufen x Zyklus)', c.MATCH_COLLAPSE_SECONDS === 60
    && c.MATCH_COLLAPSE_SECONDS === c.COLLAPSE_STAGE_COUNT * c.COLLAPSE_CYCLE_SECONDS);
  t('COLLAPSE_WARNING_SECONDS=10', c.COLLAPSE_WARNING_SECONDS === 10);
  t('FINAL_COUNTDOWN_SECONDS=5', c.FINAL_COUNTDOWN_SECONDS === 5);
  t('COLLAPSE_RADIUS_FACTOR=0.82', near(c.COLLAPSE_RADIUS_FACTOR, 0.82));
  t('MAX_COLLAPSE_TICK_DELTA_MS=250', c.MAX_COLLAPSE_TICK_DELTA_MS === 250);
  // Der Gameplay-Timer ist kein Online-Timeout: er teilt keine Konstante mit Reconnect-/
  // Host-Grace, Football-Zugfrist oder Ready-Barriere.
  const coreDecl = (HTML.match(/const MATCH_COLLAPSE_SECONDS=[^\n]*/) || [''])[0];
  t('Collapse-Konstanten sind collapse-eigen (keine Grace-/Deadline-Konstante in der Deklaration)',
    !/GRACE|DEADLINE|RECONNECT|READY|TURN_/.test(coreDecl));
  t('kein Zugtimer portiert (TURN_TIMER_ENABLED/TURN_LIMIT_SECONDS fehlen im Produkt)',
    !/TURN_TIMER_ENABLED|TURN_LIMIT_SECONDS/.test(HTML));
}

// ── 1+2) Timer zaehlt nur in aim, pausiert waehrend Physik ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setMenu(false);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 1000);
  const beforePhysics = e.state.matchElapsedMs;
  e.setPhase('reveal');
  advance(e, 1000, 3000);
  t('Physik-Phase verbraucht keine Zeit', near(e.state.matchElapsedMs, beforePhysics));
  e.setPhase('aim');
  advance(e, 3000, 4000);
  // Der erste Frame nach einer Pause setzt nur den Anker (Delta 0) — deshalb ein Frame weniger.
  t('Timer zaehlt nur in aim (Physik uebersprungen)', near(e.state.matchElapsedMs, 2000 - FRAME_MS));
}

// ── 3+4) Bei 0: Collapse SOFORT, offener Zug bleibt offen (kein Auto-Stand) ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer(); e.setR(1000);
  const tt = runOutTimer(e);
  const c = e.getCommits();
  t('A: kein Collapse vor der Stage-1-Deadline, Collapse exakt bei 30 s Planungszeit', tt === 30000 && near(e.getR(), 820) && e.state.collapseStage === 1);
  t('Bei 0: kein Auto-Stand, kein Bot-Zug durch das Zyklusende', e.getBotMoves() === 0);
  t('Bei 0: offener Zug bleibt offen', c.aimSet[0] === false && e.getPhase() === 'aim');
  t('Bei 0: Zyklus 2 laeuft sofort (State=running)', e.state.collapseState === 'running');
  e.tickCollapse(120000);
  t('Bei 0: kein nachtraeglicher Auto-Stand', e.getBotMoves() === 0 && e.getCommits().aimSet[0] === false);
}
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([true,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 60100);                         // 2 x 30 s Planungszeit (+ ein Anker-Frame nach Collapse 1)
  t('Bestaetigter Zug wird NICHT ueberschrieben', e.getBotMoves() === 0);
  t('Bestaetigt: beide Stufen sofort ausgewertet (terminal)',
    e.state.collapseStage === 2 && e.state.collapseState === 'collapsed' && near(e.getR(), 672.4));
}

// ── 5+6+7) Collapse sofort bei 0 in der Planungsphase, genau einmal, Faktor 0.82 ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setR(1000);
  e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 29950);
  t('Kein Collapse vor 0', e.getR() === 1000 && e.state.collapseStage === 0);
  e.setPhase('sim'); e.tickCollapse(120000);
  t('Kein Collapse waehrend Physik (Uhr pausiert)', e.getR() === 1000 && e.state.collapseStage === 0);
  e.setPhase('aim'); e.setAim([false,false]); e.tickCollapse(120000); e.tickCollapse(120050);
  t('B: Stage 1 genau einmal, Radius = R*0.82', near(e.getR(), 820) && e.state.collapseStage === 1);
  t('D: Collapse 1 startet Zyklus 2 (State running, Timer 0)', e.state.collapseState === 'running' && e.state.matchElapsedMs === 0);
  t('Collapse-Core ruft KEINEN Direktsound (Hoerereignis kommt read-only aus dem visuellen Adapter)', e.sfx.collapse === 0);
  t('Collapse wertet ohne zusaetzlichen Sim-Frame aus', e.getPhase() === 'aim');
  e.runSim();
  e.setPhase('aim'); e.tickCollapse(120000);
  t('Kein zweiter Collapse ohne neuen Zyklusablauf (Radius stabil)', near(e.getR(), 820) && e.sfx.collapse === 0);
}

// ── L) Collapse-Sound im Core: nur Beeps und collapseStop, kein Direktsound ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setMenu(false);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 5000);
  e.setPhase('reveal'); advance(e, 5000, 7000);
  e.setPhase('aim'); e.setMenu(true); advance(e, 7000, 9000);
  t('Sound: ueber Phasen/Menue hinweg keine Core-Collapse-Sounds', e.sfx.collapse === 0 && e.sfx.colvEvent === 0);
}
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setR(1000); runOutTimer(e);
  t('Sound: Collapse-Uebergang loest im Core keinen Direktsound aus', e.sfx.collapse === 0 && e.sfx.colvEvent === 0);
  const stops = e.sfx.collapseStop;
  e.resetCollapseTimer();
  t('K/L: neues Match beendet die Bruch-/Truemmersequenz (genau ein collapseStop)', e.sfx.collapseStop === stops + 1);
  t('L: Reset loest keinen Bruch-Sound aus', e.sfx.collapse === 0 && e.sfx.colvEvent === 0);
}

// ── Sofortige Eliminierung ausserhalb des neuen Radius (Rundenende) ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  e.setR(1000);
  e.setBalls([{owner:0,alive:true,x:900,y:0,vx:0,vy:0,spin:0},{owner:1,alive:true,x:0,y:0,vx:0,vy:0,spin:0}]);
  runOutTimer(e);
  const b = e.getBalls();
  t('Sofort: Aussenkugel (900>820) ist der outBall', e.getOutBall() === 0);
  t('Sofort: gueltige Kugel bleibt', b[1].alive === true);
  t('Sofort: Rundenende -> phase=result', e.getPhase() === 'result');
  t('Sofort: Sieger = Bot (owner 1)', e.getRoundWinner() === 1);
}

// ── Keine neue Aim-Phase fuer ausgeschiedene Kugel (Runde laeuft weiter) ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  e.setR(1000);
  e.setBalls([
    {owner:0,alive:true,x:900,y:0,vx:0,vy:0,spin:0},
    {owner:0,alive:true,x:100,y:0,vx:0,vy:0,spin:0},
    {owner:1,alive:true,x:0,y:-100,vx:0,vy:0,spin:0}
  ]);
  runOutTimer(e);
  const b = e.getBalls();
  t('Weiterlauf: Aussenkugel (900) ausgeschieden', b[0].alive === false);
  t('H: Innenkugeln bleiben physikalisch gueltig', b[1].alive === true && b[2].alive === true);
  t('Weiterlauf: neue Planungsphase (phase=aim)', e.getPhase() === 'aim');
}

// ── shrinkFloor: normal R0*0.80, nach jedem Collapse eingefroren ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  t('shrinkFloor normal = R0*0.80', near(e.shrinkFloor(), 800));
  e.setR(1000); e.setBalls(twoBalls()); runOutTimer(e);
  t('C: shrinkFloor nach Collapse 1 = collapseRadius (820)', near(e.shrinkFloor(), 820));
  const nextR = Math.max(e.shrinkFloor(), e.getR() - e.getR0() * 0.030);
  t('Rundenschrumpf friert bei collapseRadius ein', near(nextR, 820));
}

// ── K) Rematch stellt Timer, Stufe und Floor wieder her ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setR(1000); runOutTimer(e);
  e.resetCollapseTimer(); e.setR(1000);
  t('Rematch: State=running', e.state.collapseState === 'running');
  t('Rematch: Stufe 0', e.state.collapseStage === 0);
  t('Rematch: elapsed=0', e.state.matchElapsedMs === 0);
  t('Rematch: collapseRadius=0', e.state.collapseRadius === 0);
  t('Rematch: collapseOuterR=0', e.state.collapseOuterR === 0);
  t('Rematch: Warnung zurueckgesetzt', e.state.collapseWarned === false);
  t('Rematch: shrinkFloor wieder R0*0.80', near(e.shrinkFloor(), 800));
}

// ── Matchende vor 0 verhindert Collapse ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setR(1000); e.setPhase('over');
  e.setTime(0); e.tickCollapse(0);
  e.setTime(999999); e.tickCollapse(999999);
  t('Match over: kein Timerablauf', e.state.collapseState === 'running');
  t('Match over: Radius unveraendert', e.getR() === 1000);
}
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setR(1000); e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 29900);
  e.setPhase('over'); e.tickCollapse(120000);
  t('Collapse nach Matchende verhindert', e.getR() === 1000 && e.state.collapseStage === 0 && e.state.collapseState === 'running');
}

// ── Nur lokales Bot-Training; alle anderen Modi (inkl. Arena Football) und Online unberuehrt ──
{
  for (const m of ['pvp', 'ffa', 'football']) {
    const x = make(); x.setMode(m); x.setBalls(twoBalls()); x.resetCollapseTimer(); x.setR(1000);
    t(m + ': collapseActive=false', x.collapseActive() === false);
    x.setPhase('aim'); x.setAim([false,false]); x.setTime(0); x.tickCollapse(0); advance(x, 0, 90000);
    t(m + ': kein Timerfortschritt, kein Collapse', x.state.matchElapsedMs === 0 && x.getR() === 1000 && x.state.collapseStage === 0);
  }
  const o = make(); o.setMode('bot'); o.setOnline(true); o.resetCollapseTimer();
  t('Online: collapseActive=false', o.collapseActive() === false);
  o.setPhase('aim'); o.setTime(0); o.tickCollapse(0); advance(o, 0, 120000);
  t('Online: kein Timerfortschritt', o.state.matchElapsedMs === 0);
}

// ── Grosse Countdown-Phase 5..1: je Sekunde ein Beep, Entprellung, keine Doppelung ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 20000);
  t('10s-Warnung genau einmal', e.sfx.warn === 1);
  t('Bei 10s noch kein Countdown-Beep', e.sfx.tick === 0);
  advance(e, 20000, 25000);
  e.tickCollapse(25000);
  t('Countdown 5: ein Beep', e.sfx.tick === 1);
  advance(e, 25000, 29990);
  t('Countdown 5..1: genau 5 Beeps', e.sfx.tick === 5);
  t('Warnung bleibt einmalig', e.sfx.warn === 1);
}

// ══════════════════════════════════════════════════════════════════════════════
// CORRECTNESS HARDENING — echte Uebergaenge (commit -> applyLaunch -> stepSim -> Collapse)
// ══════════════════════════════════════════════════════════════════════════════

// ── Restgeschwindigkeit/Spin werden vor der Collapse-Auswertung neutralisiert ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  e.setVel(0, 0.06, -0.03, 0.4);
  e.setVel(1, -0.05, 0.02, -0.6);
  runOutTimer(e);
  const b = e.getBalls();
  const snap = b.map(o => ({ x: o.x, y: o.y }));
  t('Rest: Collapse bei 0 ausgeloest', e.state.collapseStage === 1);
  t('Rest: vx/vy/spin aller lebenden Kugeln = 0',
    b.every(o => !o.alive || (o.vx === 0 && o.vy === 0 && o.spin === 0)));
  e.runSim();
  const a = e.getBalls();
  t('Rest: Position P0 exakt unveraendert', a[0].x === snap[0].x && a[0].y === snap[0].y);
  t('Rest: Position P1 exakt unveraendert', a[1].x === snap[1].x && a[1].y === snap[1].y);
  t('H: beide Kugeln innerhalb des neuen Radius leben', a[0].alive && a[1].alive);
}

// ── Kein Warten: der Collapse faellt in der Planungsphase, ohne Schuss/Settlement ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  runOutTimer(e);
  const log = e.getPhaseLog();
  t('Kein Warten: Collapse ohne Phasenwechsel (kein reveal/sim noetig)', !log.includes('sim:expired') && e.getPhase() === 'aim');
  t('Kein Warten: kein Phasenzustand aim+expired (Sperre nur synchron)', !log.includes('aim:expired'));
  t('Kein Warten: Collapse abgeschlossen', e.state.collapseStage === 1 && near(e.getR(), 820));
  t('Kein Warten: Planungsphase laeuft mit offenem Zug weiter', e.getCommits().aimSet[0] === false);
  t('Kein Warten: kein Zug durch das Zyklusende', e.getBotMoves() === 0);
}
{
  // I) Nach beiden Collapses ist JEDER Benutzer-Commitpfad sofort frei — real ausgefuehrt.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  t('Eingabe vor Ablauf frei', e.inputLocked() === false && e.canCommitInput(0) === true);
  advance(e, 0, 60200);
  t('Eingabe nach beiden Collapses frei (keine Sperre)', e.inputLocked() === false && e.state.collapseStage === 2);
  const moves = e.getBotMoves();
  e.setPhase('aim'); e.setAim([false,false]);
  t('I: Commit nach Collapse 2 erlaubt', e.canCommitInput(0) === true);
  e.commit(0, 0, -250, 120, 0.4);
  const c = e.getCommits();
  t('I: Benutzer-Commit nach Collapse 2 angewendet', e.getBotMoves() === moves + 1 && c.aimSet[0] === true && c.aim[0].dx === -250);
  e.setPhase('aim'); e.setAim([false,false]);
  e.standButton();
  t('I: Stand-Button nach Collapse 2 angewendet', e.getBotMoves() === moves + 2 && e.getCommits().aimSet[0] === true);
  e.setPhase('aim'); e.setAim([false,false]);
  e.startDrag(9, 0, 0); e.pointerUp(9);
  t('I: Pointer-Commit nach Collapse 2 angewendet', e.getBotMoves() === moves + 3 && e.getCommits().aimSet[0] === true);
}
t('Kein interner Auto-Stand mehr (das Zyklusende erzwingt keinen Zug)', !/commitAutoStand/.test(HTML));

// ── Mehrere Kugeln gleichzeitig ausserhalb des neuen Radius ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(0,100,0), ball(1,0,890), ball(1,0,-100)]);
  runOutTimer(e);
  const b = e.getBalls();
  t('Aussen(4): beide Aussenkugeln ausgeschieden', b[0].alive === false && b[2].alive === false);
  t('Aussen(4): beide Innenkugeln leben', b[1].alive === true && b[3].alive === true);
  t('Aussen(4): Innenpositionen exakt', b[1].x === 100 && b[1].y === 0 && b[3].x === 0 && b[3].y === -100);
  t('Aussen(4): Runde laeuft weiter (aim)', e.getPhase() === 'aim');
  t('Aussen(4): kein Rundensieger', e.getRoundWinner() === -1);
  t('Aussen(4): ein Drop-Signal', e.sfx.drop === 1 && e.sfx.ringout === 0);
}
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(1,0,890)]);
  runOutTimer(e);
  t('Aussen(2): outBall = am weitesten draussen (Index 0)', e.getOutBall() === 0);
  t('Aussen(2): Sieger deterministisch = Bot (owner 1)', e.getRoundWinner() === 1);
  t('Aussen(2): Rundenende (result)', e.getPhase() === 'result');
  t('Aussen(2): ein Ringout-Signal', e.sfx.ringout === 1);
}

// ── Kugeln innerhalb des neuen Radius behalten exakt ihre Position ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  const start = [ball(0,700,0), ball(0,-200,300), ball(1,0,-750), ball(1,400,-400)];
  e.setBalls(start.map(b => ({...b})));
  runOutTimer(e);
  const b = e.getBalls();
  t('Innen: alle vier Kugeln leben', b.every(o => o.alive));
  t('Innen: Positionen bit-identisch', b.every((o,i) => o.x === start[i].x && o.y === start[i].y));
  t('Innen: kein Ringout/Drop', e.sfx.ringout === 0 && e.sfx.drop === 0);
  t('Innen: neue Planungsphase', e.getPhase() === 'aim');
}

// ── Keine Doppelwertung der Collapse-Auswertung ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(1,0,890)]);
  runOutTimer(e);
  const results = e.getPhaseLog().filter(p => p.startsWith('result:')).length;
  t('Doppelwertung: genau ein result-Uebergang', results === 1);
  e.tickCollapse(120000); e.runSim(); e.tickCollapse(121000);
  t('Doppelwertung: kein zweiter Collapse', e.sfx.collapse === 0 && near(e.getR(), 820));
  t('Doppelwertung: kein zweites Ringout', e.sfx.ringout === 1);
  t('Doppelwertung: outBall stabil', e.getOutBall() === 0);
  t('Doppelwertung: Sieger stabil', e.getRoundWinner() === 1);
}

// ── Matchende waehrend der Collapse-Auswertung startet keine neue Aim-Phase ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(1,0,890)]);
  e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 29900);
  const before = e.getPhaseLog().length;
  advance(e, 29900, 30100);
  const after = e.getPhaseLog().slice(before);
  t('Matchende: keine Aim-Phase nach dem Collapse', !after.some(p => p.startsWith('aim:')));
  t('Matchende: endet im Result-Zustand', e.getPhase() === 'result');
  const o = make(); o.setMode('bot'); o.setBalls(twoBalls()); o.resetCollapseTimer(); o.setR(1000);
  o.setPhase('aim'); o.setAim([false,false]); o.setTime(0); o.tickCollapse(0);
  advance(o, 0, 29900);
  o.setPhase('over'); o.doCollapse(); o.tickCollapse(120000);
  t('Matchende: doCollapse in phase=over wirkungslos', o.getR() === 1000 && o.state.collapseStage === 0);
}

// ── K) Reset/Rematch setzt Timer, Radius, State, Eingabesperre und Drag zurueck ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  e.setPhase('aim'); e.setAim([false,false]);
  e.startDrag(3, 0, 0);
  e.setTime(0); e.tickCollapse(0); advance(e, 0, 60000);
  t('Rematch-Vorbedingung: Collapse 1 gelaufen, Drag an lebender Kugel erhalten', e.state.collapseStage === 1 && e.getDrag().dragging === true);
  e.resetCollapseTimer(); e.setR(1000);
  const d = e.getDrag();
  t('Rematch: Eingabesperre aufgehoben', e.inputLocked() === false);
  t('Rematch: Drag-State sauber', d.dragging === false && d.aimPid === -1 && d.spinPid === -1);
  t('Rematch: Pull/Spin zurueckgesetzt', d.dragPull.x === 0 && d.dragSpin === 0);
  t('Rematch: Timer, Stufe und State zurueckgesetzt', e.state.matchElapsedMs === 0 && e.state.collapseState === 'running' && e.state.collapseStage === 0);
  t('Rematch: Countdown verborgen', e.state.collapseCountVisible === false);
  e.setPhase('aim'); e.setAim([false,false]);
  t('Rematch: Eingabe wieder frei', e.canCommitInput(0) === true);
}

// ── Online und Matchende: doCollapse ist hart gegated ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer(); e.setR(1000);
  e.setOnline(true); e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 120000); e.doCollapse();
  t('Online: doCollapse wirkungslos', e.getR() === 1000 && e.state.collapseStage === 0);
  e.setOnline(false); e.setPhase('over'); e.doCollapse(); e.tickCollapse(130000);
  t('Matchende: doCollapse wirkungslos', e.getR() === 1000 && e.state.collapseStage === 0);
  runOutTimer(e);
  t('Bot lokal: Collapse bei 0 wirkt', near(e.getR(), 820) && e.state.collapseStage === 1);
}
t('Kein Debug-Hook __cdbg im Produktcode', !/__cdbg/.test(HTML));
t('Kein cdbg-Query-Flag im Produktcode', !/cdbg/.test(HTML));

// ── Inaktiver Tab: kein Zeitsprung, keine uebersprungenen Countdown-Stufen ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 25000);
  t('Tab: Countdown startet bei 5', e.state.collapseCountShown === 5 && e.sfx.tick === 1);
  e.pauseCollapseTimer();
  e.setTime(200000); e.tickCollapse(200000);
  t('Tab: kein Zeitdelta-Sprung', near(e.state.matchElapsedMs, 25000));
  t('Tab: Timer laeuft nicht ab', e.state.collapseState === 'running');
  t('Tab: keine Stufe uebersprungen', e.state.collapseCountShown === 5 && e.sfx.tick === 1);
  advance(e, 200000, 205000);
  t('Tab: 5..1 vollstaendig abgelaufen', e.sfx.tick === 5);
  t('Tab: Zyklusende danach regulaer (Collapse sofort)', e.state.collapseStage === 1 && e.state.collapseState === 'running');
}

// ── Grosser Countdown ist ausserhalb der Planungsphase verborgen ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 26500);
  t('Countdown: in aim sichtbar', e.state.collapseCountVisible === true && e.state.collapseCountShown === 4);
  const beeps = e.sfx.tick;
  for (const p of ['reveal', 'sim', 'result', 'over']) {
    e.setPhase(p); e.tickCollapse(26500);
    t('Countdown: in ' + p + ' verborgen', e.state.collapseCountVisible === false);
  }
  e.setPhase('aim'); e.setMenu(true); e.tickCollapse(26500);
  t('Countdown: im Menue verborgen', e.state.collapseCountVisible === false);
  e.setMenu(false); e.tickCollapse(26500);
  t('Countdown: in aim wieder sichtbar', e.state.collapseCountVisible === true);
  t('Countdown: Wiedereinblenden ohne zweiten Beep', e.sfx.tick === beeps);
  t('Countdown: Timerwert unveraendert', near(e.state.matchElapsedMs, 26500));
  t('Countdown: State unveraendert', e.state.collapseState === 'running');
}

// ══════════════════════════════════════════════════════════════════════════════
// RESULT-PFAD UND TIMER-HARDENING — echter Ablauf aim -> result -> afterResult -> startRound
// ══════════════════════════════════════════════════════════════════════════════
const roundEndSetup = (e, score = [0,0], winTarget = 3) => {
  e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setScore(score); e.setWinTarget(winTarget);
  e.setBalls([ball(0,0,0), ball(1,900,0)]);
  e.setBotShot(400, 0);
};

// ── Rundenbeendender, nicht matchentscheidender Ring-out ──
{
  const e = make(); roundEndSetup(e);
  runOutTimer(e);
  e.runLoop();
  const log = e.getPhaseLog();
  t('Result: Runde endet ueber den echten Ring-out-Pfad', log.filter(p => p.startsWith('result:')).length === 1);
  t('Result: Collapse VOR startRound verarbeitet', e.state.collapseStage === 1);
  t('Result: Radius exakt R*0.82 (kein doppelter Schrumpf)', near(e.getR(), 820));
  t('Result: kein 0.97*0.82', !near(e.getR(), 795.4, 1e-3));
  t('Result: kein aim+expired', !log.includes('aim:expired'));
  t('Result: neue Runde in aim (Zyklus 2 laeuft)', e.getPhase() === 'aim' && log[log.length - 1] === 'aim:running');
  t('Result: Eingabesperre aufgehoben', e.inputLocked() === false);
  t('Result: Punkt an Spieler 0', e.getScore()[0] === 1 && e.getScore()[1] === 0);
  t('Result: collapseRadius gesetzt', e.state.collapseRadius === 820);
}

// ── Collapse nach Result: keine Doppelwertung, kein doppeltes startRound ──
{
  const e = make(); roundEndSetup(e);
  runOutTimer(e); e.runLoop();
  const score = e.getScore(), starts = e.getRoundStarts(), ars = e.getAfterResultCalls();
  t('Doppel: afterResult genau einmal je Result', ars === 1);
  t('Doppel: genau ein startRound', starts === 1);
  t('Doppel: genau ein Rundenende-Overlay', e.getRoundEnds() === 1);
  t('Doppel: genau ein Ringout-Signal', e.sfx.ringout === 1);
  t('Doppel: outBall zurueckgesetzt', e.getOutBall() === -1);
  t('Doppel: roundWinner zurueckgesetzt', e.getRoundWinner() === -1);
  e.runLoop(); e.tickCollapse(130000); e.runLoop();
  t('Doppel: Punktestand stabil', e.getScore()[0] === score[0] && e.getScore()[1] === score[1]);
  t('Doppel: kein zweites startRound', e.getRoundStarts() === starts);
  t('Doppel: kein zweites afterResult', e.getAfterResultCalls() === ars);
  t('Doppel: kein zweiter Collapse', e.sfx.collapse === 0 && near(e.getR(), 820));
  t('Doppel: Rundenzaehler genau einmal erhoeht', e.getRoundNo() === 2);
}

// ── Matchentscheidender Ring-out: Matchende hat Vorrang ──
{
  const e = make(); roundEndSetup(e, [2,0], 3);
  runOutTimer(e); e.runLoop();
  const log = e.getPhaseLog();
  t('Matchende: gameOver genau einmal fuer Spieler 0', e.getGameOver().length === 1 && e.getGameOver()[0] === 0);
  t('Matchende: Endphase over', e.getPhase() === 'over');
  t('Matchende: keine neue Aim-Phase', !log.slice(log.findIndex(p => p.startsWith('result:'))).some(p => p.startsWith('aim:')));
  t('Matchende: kein startRound', e.getRoundStarts() === 0);
  t('Matchende: Collapse 1 war bereits gefallen (820)', e.sfx.collapse === 0 && near(e.getR(), 820) && e.state.collapseStage === 1);
  t('Matchende: Endstand 3:0', e.getScore()[0] === 3);
  e.tickCollapse(130000); e.runLoop();
  t('Matchende: kein nachtraeglicher Collapse', near(e.getR(), 820) && e.state.collapseStage === 1);
  t('Matchende: collapseRoundEnd wirkungslos in over', e.collapseRoundEnd() === false);
}

// ── Mehrere Hidden-Ticks verbrauchen keine Zeit ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 25500);
  const el = e.state.matchElapsedMs, beeps = e.sfx.tick;
  t('Hidden: Countdown vor dem Wechsel sichtbar', e.state.collapseCountVisible === true);
  e.setHidden(true);
  e.setTime(25550); e.tickCollapse(25550);
  t('Hidden: erster Tick verbraucht keine Zeit', near(e.state.matchElapsedMs, el));
  t('Hidden: Countdown ausgeblendet', e.state.collapseCountVisible === false);
  for (let k = 2; k <= 40; k++) { const tt = 25500 + k * 50; e.setTime(tt); e.tickCollapse(tt); }
  t('Hidden: auch weitere Ticks verbrauchen keine Zeit', near(e.state.matchElapsedMs, el));
  t('Hidden: keine Beeps', e.sfx.tick === beeps);
  t('Hidden: kein Timerablauf', e.state.collapseState === 'running');
  e.setHidden(false);
  e.setTime(400000); e.tickCollapse(400000);
  t('Visible: erster Tick ohne Delta-Sprung', near(e.state.matchElapsedMs, el));
  t('Visible: Countdown wieder sichtbar', e.state.collapseCountVisible === true);
  t('Visible: Wiedereinblenden ohne zweiten Beep', e.sfx.tick === beeps);
  e.setTime(400050); e.tickCollapse(400050);
  t('Visible: danach zaehlt die Uhr normal weiter', near(e.state.matchElapsedMs, el + 50));
}

// ── M) Grosser sichtbarer Frame-Sprung ueberspringt keine Countdown-Stufe ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 24800);
  t('Sprung: vor dem Stall kein Countdown', e.state.collapseCountShown === -1 && e.sfx.tick === 0);
  const stall = 27800;
  e.setTime(stall); e.tickCollapse(stall);
  t('Sprung: Delta auf MAX_COLLAPSE_TICK_DELTA_MS geklemmt', near(e.state.matchElapsedMs, 24800 + 250));
  t('Sprung: keine Stufe uebersprungen (5 zuerst)', e.state.collapseCountShown === 5 && e.sfx.tick === 1);
  t('Sprung: kein vorzeitiger Timerablauf', e.state.collapseState === 'running');
  advance(e, stall, stall + 6000);
  t('Sprung: alle fuenf Stufen genau einmal', e.sfx.tick === 5);
  t('Sprung: Zyklusende regulaer (Collapse sofort, Stufe 1)', e.state.collapseStage === 1 && e.state.collapseState === 'running');
  t('Sprung: kein Zug durch das Zyklusende', e.getBotMoves() === 0);
}

// ── M) Normale Frameraten bleiben zeitlich exakt (Klemmung ohne Nebenwirkung) ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 6000, 16);
  t('60 fps: Zeit exakt', near(e.state.matchElapsedMs, 6000));
  const o = make(); o.setMode('bot'); o.setBalls(twoBalls()); o.resetCollapseTimer();
  o.setPhase('aim'); o.setAim([false,false]);
  o.setTime(0); o.tickCollapse(0);
  advance(o, 0, 6000, 33);
  t('30 fps: Zeit exakt', near(o.state.matchElapsedMs, 6000));
}
{
  // M) Frameraten-unabhaengige Stufen: bei 16/33/50/97-ms-Frames faellt jede Stufe
  // genau einmal innerhalb EINES Frames nach ihrer kanonischen Planungszeit, mit
  // identischer Arena-Geometrie — kein uebersprungener, kein doppelter Collapse.
  for (const step of [16, 33, 50, 97]) {
    const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer(); e.setR(1000);
    e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
    const at = []; let last = 0, tt = 0;
    while (tt < 70000) { tt += step; e.setTime(tt); e.tickCollapse(tt); if (e.state.collapseStage !== last) { at.push(tt); last = e.state.collapseStage; } }
    t('M: ' + step + ' ms/Frame — Stufe 1 innerhalb eines Frames nach 30 s', at.length === 2 && at[0] >= 30000 && at[0] < 30000 + step + 1);
    t('M: ' + step + ' ms/Frame — Stufe 2 genau 30 s Planungszeit nach Stufe 1 (+ Anker-Frame)', at[1] >= at[0] + 30000 && at[1] < at[0] + 30000 + 2 * step + 1);
    t('M: ' + step + ' ms/Frame — identische Endgeometrie 672.4, terminal, kein dritter Collapse',
      near(e.getR(), 672.4) && e.state.collapseStage === 2 && e.state.collapseState === 'collapsed');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOFORTIGER COLLAPSE (Quelle fcfaf6e) — Timer 0 + KEIN Schuss = Collapse trotzdem.
// Der laufende Zug bleibt bestehen, Aim/Drag/Schuss funktionieren auf der kleineren
// Arena weiter, genau ein Collapse je Stufe, keine Stufe wird uebersprungen.
// ══════════════════════════════════════════════════════════════════════════════
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 29950);
  t('I: 50 ms vor 0 ist die Arena noch gross, Zug offen', e.getR() === 1000 && e.getCommits().aimSet[0] === false);
  advance(e, 29950, 30000);
  t('I: bei 0 ist die Arena SOFORT kleiner (820), ohne Schuss', near(e.getR(), 820) && e.state.collapseStage === 1);
  t('I: kein Schuss und kein Auto-Stand durch den Collapse', e.getBotMoves() === 0 && e.getCommits().aimSet[0] === false);
  t('I: Planungsphase laeuft weiter, Eingabe frei', e.getPhase() === 'aim' && e.inputLocked() === false && e.canCommitInput(0) === true);
  t('D: Zyklus 2 beginnt bei 0 (Timer-Neustart)', e.state.collapseState === 'running' && e.state.matchElapsedMs === 0);
  advance(e, 30000, 34900);
  t('Warten: Arena bleibt klein', near(e.getR(), 820) && e.state.collapseStage === 1);
  t('Warten: Zug weiterhin offen, kein Auto-Stand', e.getCommits().aimSet[0] === false && e.getBotMoves() === 0);
  t('Warten: Zyklus-2-Uhr laeuft (erster Frame nach dem Collapse ankert nur)', near(e.state.matchElapsedMs, 4900 - FRAME_MS));
  e.setPos(0, 800, 0);
  e.setBotShot(0, 0);
  e.commit(0, 0, 400, 0, 0);
  t('I: Schuss unmittelbar nach Collapse 1 angenommen', e.getCommits().aimSet[0] === true && e.getBotMoves() === 1);
  const resultsBefore = e.getPhaseLog().filter(p => p.startsWith('result:')).length;
  e.runLoop();
  t('C: Physik nutzt den neuen Arena-Zustand (Ring-out an 820 statt 1000, Punkt an den Bot)',
    e.getPhaseLog().filter(p => p.startsWith('result:')).length === resultsBefore + 1 && e.getScore()[1] === 1);
  t('Schuss: Radius unveraendert 820 (kein zweiter Collapse)', near(e.getR(), 820) && e.state.collapseStage === 1);
}
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 28500);
  e.startDrag(5, 0, 0);
  advance(e, 28500, 30000);
  const d = e.getDrag();
  t('Drag: Collapse waehrend des Drags gefallen', near(e.getR(), 820) && e.state.collapseStage === 1);
  t('Drag: bleibt erhalten (Kugel lebt, Runde offen)', d.dragging === true && d.aimPid === 5 && d.dragShooter === 0);
  t('Drag: kein Auto-Stand, Zug offen', e.getCommits().aimSet[0] === false);
  e.pointerUp(5);
  const c = e.getCommits();
  t('I: Release nach dem Collapse loest den Schuss aus', e.getBotMoves() === 1 && c.aimSet[0] === true);
  t('Drag: Schuss ist der gezogene Zug, kein Stand', c.aim[0].dx !== 0);
  t('Drag: State nach dem Schuss sauber', e.getDrag().dragging === false && e.getDrag().aimPid === -1);
}
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(0,100,0), ball(1,-300,0)]);
  e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 28500);
  e.startDrag(6, 0, 0);
  advance(e, 28500, 30000);
  const d = e.getDrag();
  t('Drag tot: Aussenkugel durch den Collapse ausgeschieden', e.getBalls()[0].alive === false && e.getBalls()[1].alive === true);
  t('Drag tot: Drag an der toten Kugel abgebrochen', d.dragging === false && d.aimPid === -1 && e.getReleased().includes(6));
  e.pointerUp(6);
  t('Drag tot: spaetes pointerup committet nichts', e.getBotMoves() === 0 && e.getCommits().aimSet[0] === false);
  t('Drag tot: Spieler kann mit der Innenkugel weiter zielen', e.canCommitInput(0) === true && e.getPhase() === 'aim');
}
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 29950);
  e.setPhase('reveal'); e.tickCollapse(30000); e.tickCollapse(30050);
  t('Uebergang: kein Collapse waehrend eines Phasenuebergangs', e.getR() === 1000 && e.state.collapseStage === 0);
  e.setPhase('aim'); e.setAim([false,false]);
  e.tickCollapse(30100); e.tickCollapse(30150);
  t('B: Collapse genau einmal nach dem Uebergang', near(e.getR(), 820) && e.state.collapseStage === 1);
  e.tickCollapse(30150); e.tickCollapse(30150); e.tickCollapse(30200);
  t('B: kein doppelter Collapse durch weitere Frames derselben Zeit', near(e.getR(), 820) && e.state.collapseStage === 1);
  e.setPhase('sim'); e.runSim(); e.setPhase('aim');
  t('B: Settlement-Hooks loesen keinen zweiten Collapse aus', e.settleCollapse() === false && e.collapseRoundEnd() === false && near(e.getR(), 820));
}
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 29900);
  e.setTime(29900 + 40000); e.tickCollapse(29900 + 40000);   // 40-s-Stall in EINEM Frame
  t('M: nur Stufe 1 (keine uebersprungene Stufe)', e.state.collapseStage === 1 && near(e.getR(), 820));
  t('M: Zyklus 2 beginnt bei 0', e.state.collapseState === 'running' && e.state.matchElapsedMs === 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// J) BOT-PRODUKTPFAD (Quelle 24f4423) — exakt die Frame-Schleife des Spiels (tickCollapse):
// der Collapse-Countdown ist KEIN Zug-Timeout. Bei 0 faellt der Collapse, bevor irgendein
// automatischer Zug, Bot-Schuss, Reveal oder Physik stattfindet; der menschliche Zug bleibt
// offen, der Bot zieht erst nach dem menschlichen Commit.
// ══════════════════════════════════════════════════════════════════════════════
const prodAdvance = (e, fromMs, toMs, step = FRAME_MS) => {
  for (let tt = fromMs + step; tt < toMs; tt += step) e.prodTick(tt);
  e.prodTick(toMs);
};
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0, 100, 0), ball(1, -300, 0)]);
  e.setPhase('aim'); e.setAim([false, false]); e.prodTick(0);
  prodAdvance(e, 0, 29950);
  t('BOT A: 50 ms vor 0 — kein Auto-Stand, kein Bot-Zug, Arena gross, Zug offen',
    e.getBotMoves() === 0 && e.getCommits().aimSet[0] === false && e.getR() === 1000 && e.getPhase() === 'aim');
  const logBefore = e.getPhaseLog().length;
  prodAdvance(e, 29950, 30000);
  const log = e.getPhaseLog().slice(logBefore);
  t('BOT A: bei 0 Arena bereits kleiner (820)', near(e.getR(), 820));
  t('BOT A: Collapse Count genau +1', e.state.collapseStage === 1 && e.state.collapseState === 'running');
  t('BOT A: menschlicher Zug weiterhin offen (kein Auto-Commit, kein Auto-Stand)', e.getCommits().aimSet[0] === false);
  t('BOT A: Bot hat NICHT geschossen', e.getBotMoves() === 0 && e.getCommits().aimSet[1] === false);
  t('BOT A: kein Reveal / keine Physik durch den Collapse-Timer', !log.some((p) => p.startsWith('reveal:') || p.startsWith('sim:')) && e.getPhase() === 'aim');
  t('BOT A: Eingabe frei (kein Timeout-Lock)', e.inputLocked() === false && e.canCommitInput(0) === true);
  prodAdvance(e, 30000, 40000);
  t('BOT C: Arena bleibt klein, Zug offen, kein automatischer Zug nach 10 s',
    near(e.getR(), 820) && e.getCommits().aimSet[0] === false && e.getBotMoves() === 0 && e.getPhase() === 'aim');
  t('BOT C: Zyklus 2 laeuft (kein zweiter Collapse vor 30 s)', e.state.collapseStage === 1 && near(e.state.matchElapsedMs, 10000 - FRAME_MS));
  e.prodTick(40000); e.prodTick(40000); e.prodTick(40050);
  t('BOT D: kein doppelter Collapse', e.state.collapseStage === 1 && near(e.getR(), 820));
  t('BOT D: Settlement-/Rundenende-Hooks wirkungslos', e.settleCollapse() === false && e.collapseRoundEnd() === false);
  e.startDrag(11, 0, 0);
  prodAdvance(e, 40050, 41000);
  t('BOT B: Drag waehrend Zyklus 2 aktiv, kein Auto-Zug', e.getDrag().dragging === true && e.getBotMoves() === 0);
  e.setPos(0, -800, 0);
  e.setBotShot(0, 0);
  e.pointerUp(11);
  const c = e.getCommits();
  t('J: eigener Schuss angenommen, Bot-Zug regulaer ergaenzt (Bot-Logik, nicht Timer)', c.aimSet[0] === true && c.aim[0].dx !== 0 && e.getBotMoves() === 1 && c.aimSet[1] === true);
  t('J: Reveal erst durch den eigenen Schuss', e.getPhaseLog().slice(-1)[0].startsWith('reveal:'));
  const resultsBefore = e.getPhaseLog().filter((p) => p.startsWith('result:')).length;
  e.runLoop();
  t('J: Physik nutzt bereits den kleineren Radius (Ring-out an 820, Punkt an den Bot)',
    e.getPhaseLog().filter((p) => p.startsWith('result:')).length === resultsBefore + 1 && e.getScore()[1] === 1);
  t('J: Radius bleibt 820, Stufe 1 (kein Doppelschrumpf)', near(e.getR(), 820) && e.state.collapseStage === 1);
}
{
  // J) Gegenprobe: der Mensch schiesst VOR 0 — Collapse dann in der naechsten Planungsphase.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0, 100, 0), ball(1, -300, 0)]);
  e.setPhase('aim'); e.setAim([false, false]); e.prodTick(0);
  prodAdvance(e, 0, 20000);
  e.commit(0, 0, 0, 0, 0); e.runLoop();
  t('J: Zug vor 0 — Bot genau einmal durch den Commit, Uhr bei 20 s', e.getBotMoves() === 1 && e.getPhase() === 'aim' && near(e.state.matchElapsedMs, 20000));
  prodAdvance(e, 20000, 30100);
  t('J: Collapse bei 30 s Planungszeit in der neuen Phase, weiterhin kein Auto-Zug', near(e.getR(), 820) && e.getBotMoves() === 1 && e.getCommits().aimSet[0] === false);
}
{
  // J) Bot nach Collapse 2: der Bot bleibt funktional und zieht weiterhin nur mit dem Menschen.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0, 100, 0), ball(1, -300, 0)]);
  e.setPhase('aim'); e.setAim([false, false]); e.prodTick(0);
  prodAdvance(e, 0, 60100);
  t('J: nach Collapse 2 kein Bot-Zug ohne menschlichen Commit', e.state.collapseStage === 2 && e.getBotMoves() === 0);
  e.setBotShot(-60, 0);
  e.commit(0, 0, 60, 0, 0); e.runLoop();
  t('J: nach Collapse 2 zieht der Bot genau einmal mit, neue Planungsphase erreicht', e.getBotMoves() === 1 && e.getPhase() === 'aim' && near(e.getR(), 672.4));
}

// ══════════════════════════════════════════════════════════════════════════════
// TWO-STAGE — zwei Zyklen a 30 s: Warnfenster 20-30 s und 50-60 s, Collapse 1 bei 30 s,
// Timer-Neustart, Collapse 2 bei 60 s (terminal), kein dritter Collapse, warn-/tick-Beeps
// je Zyklus exakt einmal.
// ══════════════════════════════════════════════════════════════════════════════
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer(); e.setR(1000);
  e.setPhase('aim'); e.setAim([false,false]); e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 19900);
  t('2S: vor 20 s keine Warnung', e.sfx.warn === 0);
  advance(e, 19900, 20100);
  t('2S: Warnfenster 1 beginnt bei 20 s', e.sfx.warn === 1);
  advance(e, 20100, 29950);
  t('A: vor 30 s kein Collapse', e.state.collapseStage === 0 && e.getR() === 1000);
  advance(e, 29950, 30000);
  t('B/C: Collapse 1 -> Radius 820, Stufe 1 — SOFORT bei 30 s, ohne Zug', near(e.getR(), 820) && e.state.collapseStage === 1 && e.getCommits().aimSet[0] === false);
  t('D: Timer-Neustart fuer Zyklus 2', e.state.collapseState === 'running' && e.state.matchElapsedMs === 0);
  t('D: Warn-/Countdown-Latches fuer Zyklus 2 geloest', e.state.collapseWarned === false && e.state.collapseCountShown === -1);
  t('H: Kugeln/Score unangetastet', e.getBalls().every(b => b.alive) && e.getScore()[0] === 0 && e.getScore()[1] === 0);
  t('2S: Countdown-Beeps Zyklus 1 = 5', e.sfx.tick === 5);
  const t0 = 60000;
  e.setPhase('aim'); e.setAim([false,false]); e.setTime(t0); e.tickCollapse(t0);
  advance(e, t0, t0 + 19900);
  t('2S: Zyklus 2 ohne fruehe Warnung', e.sfx.warn === 1);
  advance(e, t0 + 19900, t0 + 20100);
  t('2S: Warnfenster 2 beginnt bei 50 s Gesamtplanungszeit', e.sfx.warn === 2);
  advance(e, t0 + 20100, t0 + 29950);
  t('E: vor 60 s Gesamtplanungszeit kein zweiter Collapse', e.state.collapseStage === 1);
  advance(e, t0 + 29950, t0 + 30000);
  t('E/F: Collapse 2 -> Radius 672.4, Stufe 2 terminal',
    near(e.getR(), 672.4) && e.state.collapseStage === 2 && e.state.collapseState === 'collapsed');
  t('F: shrinkFloor friert auf 672.4 ein', near(e.shrinkFloor(), 672.4));
  t('2S: Countdown-Beeps beider Zyklen = 2x5', e.sfx.tick === 10);
  t('2S: Warnsignal je Zyklus exakt einmal (2)', e.sfx.warn === 2);
  e.setPhase('aim'); e.setAim([false,false]);
  const t1 = 200000; e.setTime(t1); e.tickCollapse(t1);
  advance(e, t1, t1 + 45000);
  t('G: kein dritter Collapse (Radius stabil, terminal)',
    near(e.getR(), 672.4) && e.state.collapseState === 'collapsed' && e.state.collapseStage === 2);
  t('G: keine weiteren Beeps im terminalen Zustand', e.sfx.tick === 10 && e.sfx.warn === 2);
  t('F: HUD-Timer terminal (collapsed)', e.hudText() === '00:00');
}

// ══════════════════════════════════════════════════════════════════════════════
// POSITIONSREINE COLLAPSE-RING-OUT-AUSWERTUNG — kein zusaetzlicher Physikframe.
// ══════════════════════════════════════════════════════════════════════════════
const settledAtExpiry = (positions) => {
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls(positions.map(p => ({...p})));
  runOutTimer(e);
  return e;
};
const posOf = (e) => e.getBalls().map(b => ({ x: b.x, y: b.y, alive: b.alive }));

{
  const before = [ball(0,100,0), ball(0,150,0), ball(1,-200,0)];
  const e = settledAtExpiry(before);
  const logBefore = e.getPhaseLog().filter(p => p.startsWith('sim:') || p.startsWith('result:')).length;
  const ended = e.getPhase() === 'result';
  t('Ueberlappung: Settlement-Hook danach wirkungslos', e.settleCollapse() === false);
  t('Ueberlappung: kein Sim-/Result-Uebergang durch den Collapse', logBefore === 0);
  e.runLoop();
  const a = posOf(e);
  t('Ueberlappung: Runde laeuft weiter', ended === false && e.getPhase() !== 'result');
  t('Ueberlappung: Radius auf 820', near(e.getR(), 820));
  t('Ueberlappung: x/y aller Kugeln exakt unveraendert', a.every((o, i) => o.x === before[i].x && o.y === before[i].y));
  t('Ueberlappung: alle Kugeln leben', a.every(o => o.alive));
  t('Ueberlappung: vx/vy/spin = 0', e.getBalls().every(o => o.vx === 0 && o.vy === 0 && o.spin === 0));
  t('Ueberlappung: keine Eliminierung', e.sfx.drop === 0 && e.sfx.ringout === 0);
}
{
  const before = [ball(0,822,0), ball(0,762,0), ball(1,0,0)];
  const e = settledAtExpiry(before);
  const ended = e.getPhase() === 'result';
  e.runLoop();
  const a = posOf(e);
  t('Grenze: Kontaktgruppe wird nicht auseinandergeschoben', a[0].x === 822 && a[1].x === 762);
  t('Grenze: knapp innen liegende Kugel ueberlebt', a[0].alive === true);
  t('Grenze: Nachbarkugel ueberlebt', a[1].alive === true);
  t('Grenze: Runde laeuft weiter', ended === false && e.getRoundWinner() === -1);
  t('Grenze: keine Eliminierung', e.sfx.drop === 0 && e.sfx.ringout === 0);
}
{
  const before = [ball(0,824,0), ball(0,764,0), ball(1,0,0)];
  const e = settledAtExpiry(before);
  e.runLoop();
  const a = posOf(e);
  t('Grenze: echte Aussenkugel ausgeschieden', a[0].alive === false);
  t('Grenze: Innenkugeln unveraendert', a[1].x === 764 && a[1].alive === true && a[2].x === 0);
  t('Grenze: genau ein Drop-Signal', e.sfx.drop === 1 && e.sfx.ringout === 0);
}
{
  const chain = () => [ball(0,-60,0), ball(0,0,0), ball(1,60,0)];
  const c = make(); c.setMode('bot'); c.resetCollapseTimer(); c.setR(1000);
  c.setBalls(chain()); c.setPhase('aim'); c.setAim([false,false]);
  c.setTime(0); c.tickCollapse(0);
  c.commit(0, 1, 0, 0, 0); c.runLoop();
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls(chain()); runOutTimer(e);
  e.commit(0, 1, 0, 0, 0); e.runLoop();
  const cp = posOf(c), ep = posOf(e);
  t('Kette: Kontrolllauf ohne Collapse', c.state.collapseState === 'running' && near(c.getR(), 1000));
  t('Kette: echter Lauf mit Collapse', e.state.collapseStage === 1 && near(e.getR(), 820));
  t('M: Settlement-Positionen bit-identisch zum Lauf ohne Collapse (keine zusaetzliche Physik)',
    ep.every((o, i) => o.x === cp[i].x && o.y === cp[i].y));
  t('Kette: alle drei Kugeln leben', ep.every(o => o.alive));
  t('Kette: keine Eliminierung durch den Collapse', e.sfx.drop === 0 && e.sfx.ringout === 0);
  t('Kette: neue Planungsphase', e.getPhase() === 'aim');
}
{
  const before = [ball(0,900,0), ball(0,850,0), ball(0,830,0), ball(1,0,0)];
  const e = settledAtExpiry(before);
  const ended = e.getPhase() === 'result';
  const a = posOf(e);
  t('Mehrfach: Rundenende erkannt', ended === true);
  t('Mehrfach: outBall = am weitesten draussen', e.getOutBall() === 0);
  t('Mehrfach: Sieger = Bot (owner 1)', e.getRoundWinner() === 1);
  t('Mehrfach: die beiden anderen Aussenkugeln ausgeschieden', a[1].alive === false && a[2].alive === false);
  t('Mehrfach: Innenkugel unveraendert', a[3].alive === true && a[3].x === 0 && a[3].y === 0);
  t('Mehrfach: Positionen aller Aussenkugeln unveraendert', a[0].x === 900 && a[1].x === 850 && a[2].x === 830);
  t('Mehrfach: genau ein Ringout-Signal', e.sfx.ringout === 1);
  t('Mehrfach: genau ein result-Uebergang', e.getPhaseLog().filter(p => p.startsWith('result:')).length === 1);
  e.runLoop();
  t('Mehrfach: genau ein afterResult', e.getAfterResultCalls() === 1);
  t('Mehrfach: genau ein startRound', e.getRoundStarts() === 1);
  t('Mehrfach: Radius bleibt 820 (kein Doppelschrumpf)', near(e.getR(), 820));
  t('Mehrfach: genau ein Punkt', e.getScore()[1] === 1 && e.getScore()[0] === 0);
}
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,1500,0), ball(0,0,0), ball(1,-1200,0), ball(1,50,0)]);
  e.getBalls()[2].alive = false;
  const snap = posOf(e);
  const out = e.ballsOutside();
  t('ballsOutside: nur lebende Aussenkugeln, aufsteigend', JSON.stringify(out) === '[0]');
  t('ballsOutside: veraendert keine Position', posOf(e).every((o, i) => o.x === snap[i].x && o.y === snap[i].y));
  t('ballsOutside: veraendert keinen alive-Status', posOf(e).every((o, i) => o.alive === snap[i].alive));
}
{
  const doCollapseSrc = grab(/function doCollapse\(\)\{[\s\S]*?\n\}/, 'doCollapse');
  t('doCollapse setzt keine Phase (kein sim-Frame)', !/setPhase\(/.test(doCollapseSrc));
  t('doCollapse ruft stepSim nicht auf', !/stepSim\(/.test(doCollapseSrc));
  t('doCollapse nutzt die gemeinsame Ermittlung', /ballsOutside\(\)/.test(doCollapseSrc));
  t('doCollapse nutzt die gemeinsame Verarbeitung', /resolveRingOuts\(/.test(doCollapseSrc));
  t('stepSim nutzt dieselbe Ermittlung', /ballsOutside\(\)/.test(stepSimSrc));
  t('stepSim nutzt dieselbe Verarbeitung', /resolveRingOuts\(/.test(stepSimSrc));
  // Keine zweite abweichende Ring-out-Logik: genau eine Definition und genau zwei
  // Aufrufer (stepSim, doCollapse). Gezaehlt werden Aufrufe/Definitionen, keine Kommentare.
  t('resolveRingOuts: eine Definition + zwei Aufrufer', (HTML.match(/resolveRingOuts\(/g) || []).length === 3);
  t('ballsOutside: eine Definition + zwei Aufrufer', (HTML.match(/ballsOutside\(/g) || []).length === 3);
  t('Rundenende-Uebergang existiert genau einmal', (HTML.match(/outBall=decisive;setPhase\('result'\)/g) || []).length === 1);
}
{
  const e = make(); e.setMode('pvp'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,0,0), ball(1,990,0)]);
  e.setVel(1, 8, 0, 0);
  e.setPhase('sim'); e.runSim();
  t('Normal: Ring-out ueber die normale Physik', e.getOutBall() === 1 && e.getPhase() === 'result');
  t('Normal: Sieger = Spieler 0', e.getRoundWinner() === 0);
  t('Normal: genau ein Ringout-Signal', e.sfx.ringout === 1);
  t('Normal: kein Collapse beteiligt', e.sfx.collapse === 0 && near(e.getR(), 1000));
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE-2-ARENA, SEGMENT-GLB UND AUSLIEFERUNG (Quelle f518c14 + 6d81aaa)
// ══════════════════════════════════════════════════════════════════════════════
const ROOT = path.dirname(__dirname);
const PAGES_MAX = 25 * 1024 * 1024;
const readGlb = (rel) => {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  const jlen = buf.readUInt32LE(12);
  return { buf, gltf: JSON.parse(buf.slice(20, 20 + jlen).toString('utf8')) };
};
{
  const asset = (HTML.match(/assets\/arena_platform_stage2\w*\.glb/) || [])[0];
  t('Stage2: Produkt laedt das Stage-2-Arena-GLB (v1-Pfad entfernt)', !!asset && !/assets\/arena_platform\.glb/.test(HTML));
  const { buf, gltf } = readGlb(asset);
  t('Stage2-GLB: gueltiger glTF-Binary-Header', buf.readUInt32LE(0) === 0x46546C67);
  t('Stage2-GLB: unter der Pages-Grenze (25 MiB), kein R2 noetig', buf.length < PAGES_MAX);
  const names = new Set((gltf.nodes || []).map(n => n.name));
  const wedges = ['01', '02', '03', '04', '05', '06'].map(n => 'PlayFloor_Stage2_Wedge_' + n);
  t('Stage2-GLB: PlayFloor_Core + sechs Boden-Keile vorhanden', names.has('PlayFloor_Core') && wedges.every(n => names.has(n)));
  t('Stage2-GLB: kein monolithischer Boden mehr', !names.has('PlayFloor') && !names.has('PlayFloor_Stage2'));
  t('Stage2-Adapter: Keile haengen an ihrem Segment (pr.wedge)', /pr\.wedge/.test(HTML));
  t('Stage2-Adapter: kein globales Ausblenden des Stage-2-Bodens', !/colvFloor2/.test(HTML) && !/COLV_LAST_MV/.test(HTML));
  t('Stage2-GLB: Collapse-2-Inventar vorhanden (Tier2/GoldTier2/Tier3)', names.has('Tier2') && names.has('GoldTier2') && names.has('Tier3'));
  t('Stage2-GLB: Band-/Sockel-Inventar vorhanden (Walkway/WallRing/Goldringe/Tier1)',
    ['Walkway', 'WallRing', 'GoldStepEdge', 'GoldWalkRing', 'Tier1', 'GoldTier1', 'TierBridge'].every(n => names.has(n)));
  t('Stage2-GLB: Tier3-Traeger der finalen Arena (Tip-Inventar)', ['GoldTipBand', 'TempleTip', 'TipGold'].every(n => names.has(n)));
  // Texturen der Stage-2-Arena sind die bereits freigegebenen Diaet-Texturen der Live-Arena.
  const live = readGlb('assets/arena_platform.glb');
  const imgBytes = (g) => (g.gltf.images || []).map((im) => { const v = g.gltf.bufferViews[im.bufferView]; return im.name + ':' + im.mimeType + ':' + v.byteLength; }).join('|');
  t('Stage2-GLB: Texturen identisch zur freigegebenen Arena-Diaet (Name, Format, Groesse)', imgBytes({ gltf }) === imgBytes(live));
}
{
  const segRel = (HTML.match(/assets\/ring_collapse\/[\w/.-]+\.glb/) || [])[0];
  t('Segment-GLB: Produktionspfad (kein validation/-Ordner)', segRel === 'assets/ring_collapse/ring_collapse_six_segment_simplified.glb' && !/validation\//.test(HTML));
  const { buf, gltf } = readGlb(segRel);
  t('Segment-GLB: unter der Pages-Grenze (25 MiB)', buf.length < PAGES_MAX);
  const roots = (gltf.scenes[gltf.scene || 0].nodes || []).map((i) => gltf.nodes[i].name);
  const nums = ['01', '02', '03', '04', '05', '06'];
  t('Segment-GLB: sechs Segmente je Intact + Cracked', nums.every((n) => roots.some((r) => new RegExp('^Segment' + n + '_Intact').test(r)) && roots.some((r) => new RegExp('^Segment' + n + '_.*Cracked').test(r))));
  t('Segment-GLB: nur Produktionsordner im Repo (kein validation/, keine .blend)',
    !fs.existsSync(path.join(ROOT, 'assets', 'ring_collapse', 'validation')) && !fs.readdirSync(path.join(ROOT, 'assets', 'ring_collapse')).some((f) => /\.blend/i.test(f)));
  const hosting = fs.readFileSync(path.join(ROOT, 'tools', 'build_hosting.js'), 'utf8');
  t('Auslieferung: Stage-2-Arena und Segment-GLB in der Hosting-/Pages-Liste', hosting.includes("'assets/arena_platform_stage2.glb'") && hosting.includes("'" + segRel + "'"));
  t('Auslieferung: die v1-Arena wird nicht mehr ausgeliefert', !hosting.includes("'assets/arena_platform.glb'"));
  t('Auslieferung: alle 14 Collapse-WAVs gelistet', (hosting.match(/'assets\/sfx\/ring_collapse\/[a-z_0-9]+\.wav'/g) || []).length === 14);
}

// ══════════════════════════════════════════════════════════════════════════════
// ARENA FOOTBALL UND RENDERER-VERTRAG — der Collapse-Adapter wirkt nur im lokalen
// Bot-Match; Football behaelt Plattform-Skalierung, Randhoehe und Sichtbarkeit.
// ══════════════════════════════════════════════════════════════════════════════
{
  const colvTickSrc = grab(/function colvTick\(nowS\)\{[\s\S]*?\n    \}/, 'colvTick');
  t('Adapter: Uhr-Match ist ausschliesslich das lokale Bot-Match', /const clockMatch=collapseActive\(\)&&!menuVisible;/.test(colvTickSrc));
  t('Adapter: keine Online-Collapse-Abhaengigkeit (Online-Collapse nicht portiert)',
    !/onlineHasClock|onlineRemainMs|onlineCollapseCount|onCollapsePreview|onCollapsedGen|onCollapseCount/.test(HTML));
  t('Adapter: Stufe 0 setzt den Divisor auf GLB_R (Football-Skalierung unveraendert)', /if\(want===0&&cnt===0\)\{[\s\S]*?colv\.div=GLB_R;/.test(colvTickSrc));
  t('Frame: Plattform-Divisor aus dem Adapter, Grenz-Deko mit GLB_R', /const sc=R\/colv\.div, scB=R\/GLB_R;/.test(HTML) && /bGroup\.visible=!colv\.swap;/.test(HTML));
  t('Frame: Football-Randhoehe bleibt .165', (HTML.match(/\(mode==='football'\?\.165:colv\.lift\)\*sc/g) || []).length === 2);
  t('Frame: runde Plattform weicht der Rechteckarena (Pro-Frame-Hide nur bei stehender Rechteckarena, einmalige Rueckstellung)',
    /if\(rectReady\|\|fbTopsHidden\)\{for\(const o of fbPlatformTops\)o\.visible=!rectReady;fbTopsHidden=rectReady;\}/.test(HTML));
  t('Frame: Adapter laeuft VOR der Football-Sichtbarkeitsregel', HTML.indexOf('colvTick(nowS);') > 0 && HTML.indexOf('colvTick(nowS);') < HTML.indexOf('if(rectReady||fbTopsHidden)'));
  t('Renderer: genau ein Arena-GLB-Ladepfad und ein Segment-Ladepfad', (HTML.match(/GLTFLoader\(\)\.load\(assetUrl\('assets\/arena_platform/g) || []).length === 1
    && (HTML.match(/GLTFLoader\(\)\.load\(assetUrl\('assets\/ring_collapse\//g) || []).length === 1);
  t('Overlay: 2D-Collapse-Overlay entfernt (keine gemalten Warn-/Rissmarkierungen)', !/drawCollapseOverlay|collapseRingPath|collapseFillZone/.test(HTML));
}

console.log('\nRing-Collapse: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
