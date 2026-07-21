// Ring-Collapse-Timer (lokaler Bot-Training-Prototyp): gezielte State-Machine-Tests.
// Extrahiert das echte Core-Modul (==COLLAPSE-CORE-START/END==) UND den echten stepSim
// (inkl. Ring-out-/Decisive-Logik) aus index.html und treibt beide in einer minimalen
// Sandbox durch die geforderten Szenarien.
//   node tools/test_collapse.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(path.dirname(__dirname), 'index.html'), 'utf8');

const grab = (re, name) => { const m = HTML.match(re); if (!m) { console.error('FAIL: ' + name + ' nicht gefunden'); process.exit(2); } return m[0]; };
const coreM = HTML.match(/==COLLAPSE-CORE-START==([\s\S]*?)==COLLAPSE-CORE-END==/);
if (!coreM) { console.error('FAIL: Collapse-Core-Block nicht gefunden'); process.exit(2); }
const core = coreM[1];
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
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

// Minimale Sandbox mit stubs fuer alle externen Symbole der extrahierten Produktfunktionen.
// Echt (aus index.html extrahiert): Collapse-Core, stepSim inkl. Ring-out/Decisive,
// applyLaunch (Reveal->Sim), cancelAimDrag, commit/applyCommit/commitAutoStand,
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
  const sfx={warn:0,tick:0,collapse:0,ringout:0,drop:0,launch:0,round:0};
  const SFX={warn(){sfx.warn++;},tick(){sfx.tick++;},collapse(){sfx.collapse++;},hit(){},drop(){sfx.drop++;},ringout(){sfx.ringout++;},launch(){sfx.launch++;},round(){sfx.round++;},win(){},rollUpdate(){},unlock(){},charge:{start(){},stop(){},update(){}}};
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
    collapseRemainMs, shrinkFloor, collapseActive, inputLocked, canCommitInput, commitAutoStand,
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
    get state(){return {collapseEnabled,collapseState,matchElapsedMs,collapseRadius,collapseOuterR,collapseCountShown,collapseCountVisible,collapseWarned};},
    get sfx(){return sfx;},
    consts(){return {MATCH_COLLAPSE_SECONDS,COLLAPSE_WARNING_SECONDS,FINAL_COUNTDOWN_SECONDS,COLLAPSE_RADIUS_FACTOR,MAX_COLLAPSE_TICK_DELTA_MS};}
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
// Faehrt den Timer aus der Planungsphase heraus bis auf 0 (Auto-Stand inklusive).
const runOutTimer = (e) => {
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 120000);
};
// Treibt ein lokales Bot-Match ueber die ECHTEN Uebergaenge bis in die Simulation des
// letzten Zuges: aim -> Timer 0 -> Auto-Stand via commitAutoStand() -> reveal
// -> applyLaunch -> sim. Nach dem Ablauf wird bewusst KEIN tickCollapse mehr gerufen:
// alles Folgende muss allein ueber die Settlement-/Result-Hooks laufen.
const runToExpiry = (e) => { runOutTimer(e); e.applyLaunch(); };

// ── 0) Konstanten exakt (unveraendert) ──
{
  const c = make().consts();
  t('MATCH_COLLAPSE_SECONDS=120', c.MATCH_COLLAPSE_SECONDS === 120);
  t('COLLAPSE_WARNING_SECONDS=10', c.COLLAPSE_WARNING_SECONDS === 10);
  t('FINAL_COUNTDOWN_SECONDS=5', c.FINAL_COUNTDOWN_SECONDS === 5);
  t('COLLAPSE_RADIUS_FACTOR=0.82', near(c.COLLAPSE_RADIUS_FACTOR, 0.82));
  t('MAX_COLLAPSE_TICK_DELTA_MS=250', c.MAX_COLLAPSE_TICK_DELTA_MS === 250);
}

// ── 1+2) Timer zaehlt nur in aim, pausiert waehrend Physik ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setMenu(false);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 1000);                          // 1000 ms Planungsphase zaehlen
  const beforePhysics = e.state.matchElapsedMs;
  e.setPhase('reveal');
  advance(e, 1000, 3000);                       // 2000 ms Physik: kein Zeitverbrauch
  t('Physik-Phase verbraucht keine Zeit', near(e.state.matchElapsedMs, beforePhysics));
  e.setPhase('aim');
  advance(e, 3000, 4000);                       // wieder Planungsphase
  // Der erste Frame nach einer Pause setzt nur den Anker (Delta 0) — deshalb ein Frame weniger.
  t('Timer zaehlt nur in aim (Physik uebersprungen)', near(e.state.matchElapsedMs, 2000 - FRAME_MS));
}

// ── 3+4) Bei 0: offener Zug einmalig auf Stand; bestaetigter Zug bleibt ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  runOutTimer(e);
  const c = e.getCommits();
  t('Auto-Stand: genau ein ausgefuehrter Zug', e.getBotMoves() === 1);
  t('Auto-Stand: Spieler 0 bestaetigt', c.aimSet[0] === true);
  t('Auto-Stand: Stehen bleiben (dx=dy=0)', c.aim[0].dx === 0 && c.aim[0].dy === 0);
  t('Auto-Stand: State=expired', e.state.collapseState === 'expired');
  e.tickCollapse(120000);
  t('Auto-Stand nur einmal', e.getBotMoves() === 1);
}
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([true,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 120000);
  t('Bestaetigter Zug wird NICHT ueberschrieben', e.getBotMoves() === 0);
  t('Bestaetigt: State=expired', e.state.collapseState === 'expired');
}

// ── 5+6+7) Collapse erst nach Physik-Settlement, genau einmal, Faktor 0.82 ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setR(1000); runOutTimer(e);              // expired, Auto-Stand -> phase 'reveal'
  e.setPhase('sim'); e.tickCollapse(120000); // Physik laeuft: KEIN Collapse
  t('Kein Collapse waehrend Physik', e.getR() === 1000 && e.state.collapseState === 'expired');
  e.setPhase('aim'); e.tickCollapse(120000); // Settlement -> Collapse (setzt danach phase='sim')
  t('Collapse-Radius = R*0.82', near(e.getR(), 820));
  t('Collapse-State=collapsed', e.state.collapseState === 'collapsed');
  t('Collapse-Alarm genau einmal', e.sfx.collapse === 1);
  t('Collapse wertet ohne zusaetzlichen Sim-Frame aus', e.getPhase() === 'aim');
  e.runSim();                                 // nichts mehr zu simulieren
  e.setPhase('aim'); e.tickCollapse(120000);  // erneut -> kein zweiter Collapse
  t('Collapse nur einmal (Radius stabil)', near(e.getR(), 820) && e.sfx.collapse === 1);
}

// ── NEU: Sofortige Eliminierung ausserhalb des neuen Radius (Rundenende) ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  e.setR(1000);
  // Spieler 0: einzige Kugel bei Distanz 900 (innerhalb 1000, ausserhalb 820 nach Collapse)
  // Bot(1): Kugel im Zentrum (bleibt gueltig)
  e.setBalls([{owner:0,alive:true,x:900,y:0,vx:0,vy:0,spin:0},{owner:1,alive:true,x:0,y:0,vx:0,vy:0,spin:0}]);
  runOutTimer(e);
  e.setPhase('aim'); e.tickCollapse(120000);  // Collapse -> R=820, phase='sim'
  e.runSim();                                 // bestehende Ring-out-Logik laeuft sofort
  const b = e.getBalls();
  // Rundenbeendender Ring-out: die entscheidende Aussenkugel wird ueber den bestehenden
  // Pfad als outBall verarbeitet (faellt sichtbar), Runde endet, Bot gewinnt.
  t('Sofort: Aussenkugel (900>820) ist der outBall', e.getOutBall() === 0);
  t('Sofort: gueltige Kugel bleibt', b[1].alive === true);
  t('Sofort: Rundenende -> phase=result', e.getPhase() === 'result');
  t('Sofort: Sieger = Bot (owner 1)', e.getRoundWinner() === 1);
}

// ── NEU: Keine neue Aim-Phase fuer ausgeschiedene Kugel (Runde laeuft weiter) ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  e.setR(1000);
  // Spieler 0: 2 Kugeln (eine bei 900 = ausserhalb, eine bei 100 = innerhalb); Bot bei (0,-100)
  e.setBalls([
    {owner:0,alive:true,x:900,y:0,vx:0,vy:0,spin:0},
    {owner:0,alive:true,x:100,y:0,vx:0,vy:0,spin:0},
    {owner:1,alive:true,x:0,y:-100,vx:0,vy:0,spin:0}
  ]);
  runOutTimer(e);
  e.setPhase('aim'); e.tickCollapse(120000);  // Collapse -> R=820, phase='sim'
  e.runSim();
  const b = e.getBalls();
  t('Weiterlauf: Aussenkugel (900) ausgeschieden', b[0].alive === false);
  t('Weiterlauf: Innenkugeln bleiben', b[1].alive === true && b[2].alive === true);
  t('Weiterlauf: neue Planungsphase (phase=aim)', e.getPhase() === 'aim');
  t('Weiterlauf: ausgeschiedene Kugel nicht mehr aimbar (alive=false)', b[0].alive === false);
}

// ── 7+8) shrinkFloor: normal R0*0.80, nach Collapse eingefroren ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  t('shrinkFloor normal = R0*0.80', near(e.shrinkFloor(), 800));
  e.setR(1000); e.setBalls(twoBalls()); runOutTimer(e);
  e.setPhase('aim'); e.tickCollapse(120000); e.runSim();
  t('shrinkFloor nach Collapse = collapseRadius (820)', near(e.shrinkFloor(), 820));
  const nextR = Math.max(e.shrinkFloor(), e.getR() - e.getR0() * 0.030);
  t('Rundenschrumpf friert bei collapseRadius ein', near(nextR, 820));
}

// ── 8) Rematch stellt Timer + Floor wieder her ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setR(1000); runOutTimer(e);
  e.setPhase('aim'); e.tickCollapse(120000); e.runSim();
  e.resetCollapseTimer(); e.setR(1000);
  t('Rematch: State=running', e.state.collapseState === 'running');
  t('Rematch: elapsed=0', e.state.matchElapsedMs === 0);
  t('Rematch: collapseRadius=0', e.state.collapseRadius === 0);
  t('Rematch: collapseOuterR=0', e.state.collapseOuterR === 0);
  t('Rematch: Warnung zurueckgesetzt', e.state.collapseWarned === false);
  t('Rematch: shrinkFloor wieder R0*0.80', near(e.shrinkFloor(), 800));
}

// ── 9) Matchende vor 0 verhindert Collapse ──
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
  e.setR(1000); runOutTimer(e);
  e.setPhase('over'); e.tickCollapse(120000);
  t('Collapse nach Matchende verhindert', e.getR() === 1000 && e.state.collapseState === 'expired');
}

// ── 10) Andere Modi/Online unberuehrt ──
{
  const e = make(); e.setMode('pvp'); e.resetCollapseTimer();
  t('PvP: collapseActive=false', e.collapseActive() === false);
  t('PvP: shrinkFloor = R0*0.80', near(e.shrinkFloor(), 800));
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
  advance(e, 0, 110000);                     // remain 10 -> warn
  t('10s-Warnung genau einmal', e.sfx.warn === 1);
  t('Bei 10s noch kein Countdown-Beep', e.sfx.tick === 0);
  advance(e, 110000, 115000);                // remain 5 -> Beep 5
  e.tickCollapse(115000);                    // gleiche Sekunde -> kein Doppel-Beep
  t('Countdown 5: ein Beep', e.sfx.tick === 1);
  advance(e, 115000, 119990);                // 4,3,2,1 in normalen Frames
  t('Countdown 5..1: genau 5 Beeps', e.sfx.tick === 5);
  t('Warnung bleibt einmalig', e.sfx.warn === 1);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1.4 — Correctness Hardening. Diese Faelle laufen ueber die echten
// Uebergaenge (commit -> applyLaunch -> stepSim-Settlement -> Collapse).
// ══════════════════════════════════════════════════════════════════════════════

// ── 1) Restgeschwindigkeit/Spin werden vor der Collapse-Auswertung neutralisiert ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  runToExpiry(e);
  // Die letzte regulaere Simulation kommt mit Restbewegung knapp unter STOPV (0.10) zur Ruhe.
  e.setVel(0, 0.06, -0.03, 0.4);
  e.setVel(1, -0.05, 0.02, -0.6);
  e.stepSim();                                   // Settlement -> settleCollapse -> doCollapse
  const b = e.getBalls();
  const snap = b.map(o => ({ x: o.x, y: o.y }));
  t('Rest: Collapse im Settlement ausgeloest', e.state.collapseState === 'collapsed');
  t('Rest: vx/vy/spin aller lebenden Kugeln = 0',
    b.every(o => !o.alive || (o.vx === 0 && o.vy === 0 && o.spin === 0)));
  e.runSim();                                    // Auswertung gegen den neuen Radius
  const a = e.getBalls();
  t('Rest: Position P0 exakt unveraendert', a[0].x === snap[0].x && a[0].y === snap[0].y);
  t('Rest: Position P1 exakt unveraendert', a[1].x === snap[1].x && a[1].y === snap[1].y);
  t('Rest: beide Kugeln innerhalb des neuen Radius bleiben leben', a[0].alive && a[1].alive);
}

// ── 2) Keine Aim-Luecke zwischen Settlement und Collapse ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  runToExpiry(e);
  e.runSim();
  const log = e.getPhaseLog();
  t('Aim-Luecke: kein Phasenzustand aim+expired', !log.includes('aim:expired'));
  t('Aim-Luecke: Collapse direkt aus dem Settlement (sim:expired)', log.includes('sim:expired'));
  t('Aim-Luecke: Collapse abgeschlossen', e.state.collapseState === 'collapsed');
  t('Aim-Luecke: neue Planungsphase erst nach dem Collapse', log.indexOf('aim:collapsed') > log.indexOf('sim:expired'));
  t('Aim-Luecke: genau ein ausgefuehrter Zug (Auto-Stand)', e.getBotMoves() === 1);
}
{
  // Solange expired gilt, wird JEDER Benutzer-Commitpfad tatsaechlich abgewiesen —
  // nicht nur der Zustand verglichen, sondern der Versuch real ausgefuehrt.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  t('Eingabe vor Ablauf frei', e.inputLocked() === false && e.canCommitInput(0) === true);
  advance(e, 0, 120000);
  t('Eingabe nach Ablauf gesperrt', e.inputLocked() === true);
  t('Kein zweiter Commit nach Auto-Stand', e.canCommitInput(0) === false);
  const moves = e.getBotMoves(), before = e.getCommits();
  // Regressionsschutz: selbst wenn ein Pfad kuenstlich in die Planungsphase zurueckfaellt,
  // bleibt bis zur Verarbeitung des Collapse jede Benutzereingabe wirkungslos.
  e.setPhase('aim'); e.setAim([false,false]);
  e.standButton();                                // echter Stand-Button
  e.commit(0, 0, -250, 120, 0.4);                 // direkter Benutzer-Commit
  e.startDrag(9, 0, 0); e.pointerUp(9);           // Pointer-/Drall-Pfad
  t('Stand-Button bei aim+expired abgewiesen', e.getCommits().aimSet[0] === false);
  t('Benutzer-Commit bei aim+expired abgewiesen', e.getBotMoves() === moves);
  t('Pointer-Commit bei aim+expired abgewiesen', e.getBotMoves() === moves);
  t('Bereits gesetzter Auto-Stand unveraendert',
    before.aim[0].dx === 0 && before.aim[0].dy === 0 && before.idx[0] === 0);
  // Der interne Pfad funktioniert weiterhin — aber genau einmal.
  e.commitAutoStand(0, 0);
  t('Interner Auto-Stand greift', e.getBotMoves() === moves + 1 && e.getCommits().aimSet[0] === true);
  e.commitAutoStand(0, 0);
  t('Interner Auto-Stand nicht wiederholbar', e.getBotMoves() === moves + 1);
}
{
  // commitAutoStand ist kein allgemeines Schlupfloch: ohne Timerablauf wirkungslos.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls(twoBalls()); e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  e.commitAutoStand(0, 0);
  t('Auto-Stand ohne Timerablauf wirkungslos', e.getBotMoves() === 0 && e.getCommits().aimSet[0] === false);
  e.setOnline(true); e.setPhase('aim');
  e.commitAutoStand(0, 0);
  t('Auto-Stand online wirkungslos', e.getBotMoves() === 0);
}

// ── 3) Aktiver Drag beim Timerablauf: Abbruch, ein Auto-Stand, kein zweiter Commit ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  e.setBalls(twoBalls()); e.setPhase('aim'); e.setAim([false,false]);
  e.startDrag(7, 0, 0);                           // Spieler zieht gerade zurueck
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 120000);                          // Timer 0
  const d = e.getDrag();
  t('Drag: beim Ablauf abgebrochen', d.dragging === false && d.aimPid === -1);
  t('Drag: Shooter/Owner zurueckgesetzt', d.dragShooter === -1 && d.dragOwner === -1);
  t('Drag: Pull und Spin zurueckgesetzt', d.dragPull.x === 0 && d.dragPull.y === 0 && d.dragSpin === 0);
  t('Drag: Pointer-Capture freigegeben', e.getReleased().includes(7));
  const c0 = e.getCommits();
  t('Drag: Auto-Stand genau einmal', e.getBotMoves() === 1 && c0.aimSet[0] === true);
  t('Drag: Auto-Stand ist Stehenbleiben', c0.aim[0].dx === 0 && c0.aim[0].dy === 0);
  e.pointerUp(7);                                 // spaetes pointerup nach dem Ablauf
  const c1 = e.getCommits();
  t('Drag: spaetes pointerup erzeugt keinen zweiten Commit', e.getBotMoves() === 1);
  t('Drag: bestaetigter Zug bleibt Stand', c1.aim[0].dx === 0 && c1.aim[0].dy === 0);
}

// ── 4) Mehrere Kugeln gleichzeitig ausserhalb des neuen Radius ──
{
  // Runde laeuft weiter: jeder Spieler verliert eine von zwei Kugeln.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(0,100,0), ball(1,0,890), ball(1,0,-100)]);
  runToExpiry(e); e.runSim();
  const b = e.getBalls();
  t('Aussen(4): beide Aussenkugeln ausgeschieden', b[0].alive === false && b[2].alive === false);
  t('Aussen(4): beide Innenkugeln leben', b[1].alive === true && b[3].alive === true);
  t('Aussen(4): Innenpositionen exakt', b[1].x === 100 && b[1].y === 0 && b[3].x === 0 && b[3].y === -100);
  t('Aussen(4): Runde laeuft weiter (aim)', e.getPhase() === 'aim');
  t('Aussen(4): kein Rundensieger', e.getRoundWinner() === -1);
  t('Aussen(4): ein Drop-Signal', e.sfx.drop === 1 && e.sfx.ringout === 0);
}
{
  // Rundenende: die letzten Kugeln beider Spieler sind gleichzeitig draussen.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(1,0,890)]);
  runToExpiry(e); e.runSim();
  t('Aussen(2): outBall = am weitesten draussen (Index 0)', e.getOutBall() === 0);
  t('Aussen(2): Sieger deterministisch = Bot (owner 1)', e.getRoundWinner() === 1);
  t('Aussen(2): Rundenende (result)', e.getPhase() === 'result');
  t('Aussen(2): ein Ringout-Signal', e.sfx.ringout === 1);
}

// ── 5) Kugeln innerhalb des neuen Radius behalten exakt ihre Position ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  const start = [ball(0,700,0), ball(0,-200,300), ball(1,0,-750), ball(1,400,-400)];
  e.setBalls(start.map(b => ({...b})));
  runToExpiry(e); e.runSim();
  const b = e.getBalls();
  t('Innen: alle vier Kugeln leben', b.every(o => o.alive));
  t('Innen: Positionen bit-identisch', b.every((o,i) => o.x === start[i].x && o.y === start[i].y));
  t('Innen: kein Ringout/Drop', e.sfx.ringout === 0 && e.sfx.drop === 0);
  t('Innen: neue Planungsphase', e.getPhase() === 'aim');
}

// ── 6) Keine Doppelwertung der Collapse-Auswertung ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(1,0,890)]);
  runToExpiry(e); e.runSim();
  const results = e.getPhaseLog().filter(p => p.startsWith('result:')).length;
  t('Doppelwertung: genau ein result-Uebergang', results === 1);
  t('Doppelwertung: genau ein Collapse-Alarm', e.sfx.collapse === 1);
  // Weitere Frames duerfen nichts erneut ausloesen.
  e.tickCollapse(120000); e.runSim(); e.tickCollapse(121000);
  t('Doppelwertung: kein zweiter Collapse', e.sfx.collapse === 1 && near(e.getR(), 820));
  t('Doppelwertung: kein zweites Ringout', e.sfx.ringout === 1);
  t('Doppelwertung: outBall stabil', e.getOutBall() === 0);
  t('Doppelwertung: Sieger stabil', e.getRoundWinner() === 1);
}

// ── 7) Matchende waehrend der Collapse-Auswertung startet keine neue Aim-Phase ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(1,0,890)]);
  runToExpiry(e);
  const before = e.getPhaseLog().length;
  e.runSim();
  const after = e.getPhaseLog().slice(before);
  t('Matchende: keine Aim-Phase nach dem Collapse', !after.some(p => p.startsWith('aim:')));
  t('Matchende: endet im Result-Zustand', e.getPhase() === 'result');
  // Direkter doCollapse-Aufruf nach Matchende bleibt wirkungslos.
  const o = make(); o.setMode('bot'); o.setBalls(twoBalls()); o.resetCollapseTimer(); o.setR(1000);
  runOutTimer(o);
  o.setPhase('over'); o.doCollapse();
  t('Matchende: doCollapse in phase=over wirkungslos', o.getR() === 1000 && o.state.collapseState === 'expired');
}

// ── 8) Reset/Rematch setzt Timer, Radius, State, Eingabesperre und Drag zurueck ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  e.setPhase('aim'); e.setAim([false,false]);
  e.startDrag(3, 0, 0);
  e.setTime(0); e.tickCollapse(0); advance(e, 0, 120000);
  e.applyLaunch(); e.runSim();
  t('Rematch-Vorbedingung: Collapse gelaufen', e.state.collapseState === 'collapsed');
  e.resetCollapseTimer(); e.setR(1000);
  const d = e.getDrag();
  t('Rematch: Eingabesperre aufgehoben', e.inputLocked() === false);
  t('Rematch: Drag-State sauber', d.dragging === false && d.aimPid === -1 && d.spinPid === -1);
  t('Rematch: Pull/Spin zurueckgesetzt', d.dragPull.x === 0 && d.dragSpin === 0);
  t('Rematch: Timer und State zurueckgesetzt', e.state.matchElapsedMs === 0 && e.state.collapseState === 'running');
  t('Rematch: Countdown verborgen', e.state.collapseCountVisible === false);
  e.setPhase('aim'); e.setAim([false,false]);
  t('Rematch: Eingabe wieder frei', e.canCommitInput(0) === true);
}

// ── 9) Andere Modi: doCollapse ist hart gegated, kein Debug-Hook mehr vorhanden ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer(); e.setR(1000);
  runOutTimer(e);                                                              // -> expired
  e.setOnline(true); e.doCollapse();
  t('Online: doCollapse wirkungslos', e.getR() === 1000 && e.state.collapseState === 'expired');
  e.setOnline(false); e.setMode('pvp'); e.doCollapse();
  t('PvP: doCollapse wirkungslos', e.getR() === 1000 && e.state.collapseState === 'expired');
  e.setMode('ffa'); e.doCollapse();
  t('FFA: doCollapse wirkungslos', e.getR() === 1000 && e.state.collapseState === 'expired');
  e.setMode('bot'); e.setPhase('aim'); e.doCollapse();
  t('Bot lokal: doCollapse wirkt', near(e.getR(), 820) && e.state.collapseState === 'collapsed');
}
t('Kein Debug-Hook __cdbg mehr im Produktcode', !/__cdbg/.test(HTML));
t('Kein cdbg-Query-Flag mehr im Produktcode', !/cdbg/.test(HTML));

// ── 10) Inaktiver Tab: kein Zeitsprung, keine uebersprungenen Countdown-Stufen ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 115000);                                // remain 5 -> Beep 5
  t('Tab: Countdown startet bei 5', e.state.collapseCountShown === 5 && e.sfx.tick === 1);
  e.pauseCollapseTimer();                               // visibilitychange -> hidden
  e.setTime(200000); e.tickCollapse(200000);            // 85 s Hintergrundzeit
  t('Tab: kein Zeitdelta-Sprung', near(e.state.matchElapsedMs, 115000));
  t('Tab: Timer laeuft nicht ab', e.state.collapseState === 'running');
  t('Tab: keine Stufe uebersprungen', e.state.collapseCountShown === 5 && e.sfx.tick === 1);
  advance(e, 200000, 205000);
  t('Tab: 5..1 vollstaendig abgelaufen', e.sfx.tick === 5);
  t('Tab: Timerablauf danach reguler', e.state.collapseState === 'expired');
}

// ── 11) Grosser Countdown ist ausserhalb der Planungsphase verborgen ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 116500);                                // remain 3.5 -> Zahl 4
  t('Countdown: in aim sichtbar', e.state.collapseCountVisible === true && e.state.collapseCountShown === 4);
  const beeps = e.sfx.tick;
  for (const p of ['reveal', 'sim', 'result', 'over']) {
    e.setPhase(p); e.tickCollapse(116500);
    t('Countdown: in ' + p + ' verborgen', e.state.collapseCountVisible === false);
  }
  e.setPhase('aim'); e.setMenu(true); e.tickCollapse(116500);
  t('Countdown: im Menue verborgen', e.state.collapseCountVisible === false);
  e.setMenu(false); e.tickCollapse(116500);             // zurueck in die Planungsphase
  t('Countdown: in aim wieder sichtbar', e.state.collapseCountVisible === true);
  t('Countdown: Wiedereinblenden ohne zweiten Beep', e.sfx.tick === beeps);
  t('Countdown: Timerwert unveraendert', near(e.state.matchElapsedMs, 116500));
  t('Countdown: State unveraendert', e.state.collapseState === 'running');
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1.5 — Result-Pfad und Timer-Hardening. Diese Faelle treiben den ECHTEN
// Ablauf aim -> commit -> reveal -> sim -> result -> afterResult -> startRound.
// Nach dem Timerablauf wird bewusst KEIN tickCollapse mehr gerufen: der Collapse
// muss allein ueber settleCollapse()/collapseRoundEnd() laufen. Damit beweisen
// diese Tests zugleich, dass der tickCollapse-Fallback im regulaeren Ablauf
// unerreichbar ist.
// ══════════════════════════════════════════════════════════════════════════════

// Ausgangslage fuer den rundenbeendenden Ring-out: der erzwungene Zug des Spielers ist
// ein Stand, der Bot schiesst seine einzige Kugel aus dem Ring -> stepSim verlaesst die
// Simulation ueber phase='result' und erreicht settleCollapse() nie.
const roundEndSetup = (e, score = [0,0], winTarget = 3) => {
  e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setScore(score); e.setWinTarget(winTarget);
  e.setBalls([ball(0,0,0), ball(1,900,0)]);
  e.setBotShot(400, 0);                        // maxPull nach aussen -> sicherer Ring-out
};

// ── 12) Rundenbeendender, nicht matchentscheidender Ring-out ──
{
  const e = make(); roundEndSetup(e);
  runToExpiry(e);                              // -> reveal -> applyLaunch -> sim
  e.runLoop();                                 // sim -> result -> afterResult -> startRound
  const log = e.getPhaseLog();
  t('Result: Runde endet ueber den echten Ring-out-Pfad', log.filter(p => p.startsWith('result:')).length === 1);
  t('Result: Collapse VOR startRound verarbeitet', e.state.collapseState === 'collapsed');
  t('Result: Radius exakt R*0.82 (kein doppelter Schrumpf)', near(e.getR(), 820));
  t('Result: kein 0.97*0.82', !near(e.getR(), 795.4, 1e-3));
  t('Result: kein aim+expired', !log.includes('aim:expired'));
  t('Result: neue Runde in aim+collapsed', e.getPhase() === 'aim' && log[log.length - 1] === 'aim:collapsed');
  t('Result: Eingabesperre aufgehoben', e.inputLocked() === false);
  t('Result: Collapse-Alarm genau einmal', e.sfx.collapse === 1);
  t('Result: Punkt an Spieler 0', e.getScore()[0] === 1 && e.getScore()[1] === 0);
  t('Result: kein Fallback-Tick noetig', e.state.collapseRadius === 820);
}

// ── 13) Collapse nach Result: keine Doppelwertung, kein doppeltes startRound ──
{
  const e = make(); roundEndSetup(e);
  runToExpiry(e); e.runLoop();
  const score = e.getScore(), starts = e.getRoundStarts(), ars = e.getAfterResultCalls();
  t('Doppel: afterResult genau einmal je Result', ars === 1);
  t('Doppel: genau ein startRound', starts === 1);
  t('Doppel: genau ein Rundenende-Overlay', e.getRoundEnds() === 1);
  t('Doppel: genau ein Ringout-Signal', e.sfx.ringout === 1);
  t('Doppel: outBall zurueckgesetzt', e.getOutBall() === -1);
  t('Doppel: roundWinner zurueckgesetzt', e.getRoundWinner() === -1);
  // Weiterlaufen darf nichts erneut ausloesen.
  e.runLoop(); e.tickCollapse(130000); e.runLoop();
  t('Doppel: Punktestand stabil', e.getScore()[0] === score[0] && e.getScore()[1] === score[1]);
  t('Doppel: kein zweites startRound', e.getRoundStarts() === starts);
  t('Doppel: kein zweites afterResult', e.getAfterResultCalls() === ars);
  t('Doppel: kein zweiter Collapse', e.sfx.collapse === 1 && near(e.getR(), 820));
  t('Doppel: Rundenzaehler genau einmal erhoeht', e.getRoundNo() === 2);
}

// ── 14) Matchentscheidender Ring-out: Matchende hat Vorrang vor dem Collapse ──
{
  const e = make(); roundEndSetup(e, [2,0], 3);
  runToExpiry(e); e.runLoop();
  const log = e.getPhaseLog();
  t('Matchende: gameOver genau einmal fuer Spieler 0', e.getGameOver().length === 1 && e.getGameOver()[0] === 0);
  t('Matchende: Endphase over', e.getPhase() === 'over');
  t('Matchende: keine neue Aim-Phase', !log.slice(log.indexOf('result:expired')).some(p => p.startsWith('aim:')));
  t('Matchende: kein startRound', e.getRoundStarts() === 0);
  t('Matchende: kein Collapse mehr noetig', e.sfx.collapse === 0 && e.getR() === 1000);
  t('Matchende: Endstand 3:0', e.getScore()[0] === 3);
  // Auch spaetere Frames duerfen den Collapse nicht nachholen.
  e.tickCollapse(130000); e.runLoop();
  t('Matchende: kein nachtraeglicher Collapse', e.sfx.collapse === 0 && e.getR() === 1000);
  t('Matchende: collapseRoundEnd wirkungslos in over', e.collapseRoundEnd() === false);
}

// ── 15) Mehrere Hidden-Ticks verbrauchen keine Zeit ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 115500);                                 // remain 4.5 -> Zahl 5 sichtbar
  const el = e.state.matchElapsedMs, beeps = e.sfx.tick;
  t('Hidden: Countdown vor dem Wechsel sichtbar', e.state.collapseCountVisible === true);
  e.setHidden(true);
  e.setTime(115550); e.tickCollapse(115550);             // erster Hintergrund-Tick
  t('Hidden: erster Tick verbraucht keine Zeit', near(e.state.matchElapsedMs, el));
  t('Hidden: Countdown ausgeblendet', e.state.collapseCountVisible === false);
  for (let k = 2; k <= 40; k++) { const tt = 115500 + k * 50; e.setTime(tt); e.tickCollapse(tt); }
  t('Hidden: auch weitere Ticks verbrauchen keine Zeit', near(e.state.matchElapsedMs, el));
  t('Hidden: keine Beeps', e.sfx.tick === beeps);
  t('Hidden: kein Timerablauf', e.state.collapseState === 'running');
  t('Hidden: kein Auto-Stand', e.getBotMoves() === 0);
  // ── 16) Rueckkehr zu visible: erster Tick setzt nur den Anker ──
  e.setHidden(false);
  e.setTime(400000); e.tickCollapse(400000);             // lange Wanduhrzeit vergangen
  t('Visible: erster Tick ohne Delta-Sprung', near(e.state.matchElapsedMs, el));
  t('Visible: Countdown wieder sichtbar', e.state.collapseCountVisible === true);
  t('Visible: Wiedereinblenden ohne zweiten Beep', e.sfx.tick === beeps);
  e.setTime(400050); e.tickCollapse(400050);
  t('Visible: danach zaehlt die Uhr normal weiter', near(e.state.matchElapsedMs, el + 50));
}

// ── 17) Grosser sichtbarer Frame-Sprung ueberspringt keine Countdown-Stufe ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 114800);                                 // remain 5.2 s: Countdown noch nicht gestartet
  t('Sprung: vor dem Stall kein Countdown', e.state.collapseCountShown === -1 && e.sfx.tick === 0);
  const stall = 117800;                                  // 3 s Main-Thread-Stall in EINEM Frame
  e.setTime(stall); e.tickCollapse(stall);
  t('Sprung: Delta auf MAX_COLLAPSE_TICK_DELTA_MS geklemmt', near(e.state.matchElapsedMs, 114800 + 250));
  t('Sprung: keine Stufe uebersprungen (5 zuerst)', e.state.collapseCountShown === 5 && e.sfx.tick === 1);
  t('Sprung: kein vorzeitiger Timerablauf', e.state.collapseState === 'running');
  t('Sprung: kein vorzeitiger Auto-Stand', e.getBotMoves() === 0);
  advance(e, stall, stall + 6000);                       // weiter in normalen Frames
  t('Sprung: alle fuenf Stufen genau einmal', e.sfx.tick === 5);
  t('Sprung: Timerablauf regulaer', e.state.collapseState === 'expired');
  t('Sprung: genau ein Auto-Stand', e.getBotMoves() === 1);
}

// ── 18) Normale Frameraten bleiben zeitlich exakt (Klemmung ohne Nebenwirkung) ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 6000, 16);                               // ~60 fps
  t('60 fps: Zeit exakt', near(e.state.matchElapsedMs, 6000));
  const o = make(); o.setMode('bot'); o.setBalls(twoBalls()); o.resetCollapseTimer();
  o.setPhase('aim'); o.setAim([false,false]);
  o.setTime(0); o.tickCollapse(0);
  advance(o, 0, 6000, 33);                               // ~30 fps
  t('30 fps: Zeit exakt', near(o.state.matchElapsedMs, 6000));
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1.6 — Positionsreine Collapse-Ring-out-Auswertung. Nach dem Settlement
// sind die vorhandenen x/y autoritativ: der Collapse setzt nur den Radius und
// prueft die aktuellen Positionen. Kein zusaetzlicher Physikframe, keine erneute
// Kollisions- oder Ueberlappungsaufloesung.
// ══════════════════════════════════════════════════════════════════════════════

// Stellt den Moment unmittelbar vor dem Settlement-Hook nach: Timer abgelaufen, Zug
// gespielt, Kugeln stehen an exakt diesen Positionen. Nur so lassen sich Settlement-
// Positionen mit Restueberlappung vorgeben — die normale Simulation wuerde eine
// vorgegebene Ueberlappung vorher selbst aufloesen. settleCollapse() ist der echte Hook,
// den stepSim an dieser Stelle aufruft.
const settledAtExpiry = (positions) => {
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls(positions.map(p => ({...p})));
  runOutTimer(e);                              // Timer 0 -> Auto-Stand, State 'expired'
  // Settlement erreicht: die Physik steht, die Planungsphase wuerde jetzt oeffnen.
  // Ab hier darf auf diesen Positionen keine weitere Physik mehr laufen — ein
  // anschliessendes runLoop() ist bei korrektem Verhalten ein No-op und schlaegt nur an,
  // wenn der Collapse selbst noch einen Sim-Frame einplant.
  e.setPhase('aim');
  return e;
};
const posOf = (e) => e.getBalls().map(b => ({ x: b.x, y: b.y, alive: b.alive }));

// ── 19) Ueberlappende innere Kugeln behalten exakt ihre Position ──
{
  const before = [ball(0,100,0), ball(0,150,0), ball(1,-200,0)];   // Paar ueberlappt um 14 px
  const e = settledAtExpiry(before);
  t('Ueberlappung: Ausgangslage ueberlappt wirklich', Math.hypot(150 - 100, 0) < 64);
  const logBefore = e.getPhaseLog().length;
  const ended = e.settleCollapse();
  // Kein setPhase im Collapse-Pfad -> es wird kein zusaetzlicher Sim-Frame eingeplant.
  t('Ueberlappung: kein Phasenwechsel durch den Collapse', e.getPhaseLog().length === logBefore);
  e.runLoop();                                   // no-op, solange kein Sim-Frame eingeplant wurde
  const a = posOf(e);
  t('Ueberlappung: Runde laeuft weiter', ended === false && e.getPhase() !== 'result');
  t('Ueberlappung: Radius auf 820', near(e.getR(), 820));
  t('Ueberlappung: x/y aller Kugeln exakt unveraendert',
    a.every((o, i) => o.x === before[i].x && o.y === before[i].y));
  t('Ueberlappung: alle Kugeln leben', a.every(o => o.alive));
  t('Ueberlappung: vx/vy/spin = 0', e.getBalls().every(o => o.vx === 0 && o.vy === 0 && o.spin === 0));
  t('Ueberlappung: keine Eliminierung', e.sfx.drop === 0 && e.sfx.ringout === 0);
}

// ── 20) Kontaktgruppe direkt an der neuen Grenze (820 + BR*0.1 = 823.2) ──
{
  // Kugel 0 liegt mit x=822 knapp INNEN, Kugel 1 mit x=762 klar innen; sie ueberlappen
  // um 4 px. Ein zusaetzlicher Kollisionsdurchlauf wuerde sie auseinanderschieben und
  // Kugel 0 auf 824 nach AUSSEN druecken -> anderes Ring-out-Ergebnis.
  const before = [ball(0,822,0), ball(0,762,0), ball(1,0,0)];
  const e = settledAtExpiry(before);
  const ended = e.settleCollapse();
  e.runLoop();                                   // no-op, solange kein Sim-Frame eingeplant wurde
  const a = posOf(e);
  t('Grenze: Kontaktgruppe wird nicht auseinandergeschoben', a[0].x === 822 && a[1].x === 762);
  t('Grenze: knapp innen liegende Kugel ueberlebt', a[0].alive === true);
  t('Grenze: Nachbarkugel ueberlebt', a[1].alive === true);
  t('Grenze: Runde laeuft weiter', ended === false && e.getRoundWinner() === -1);
  t('Grenze: keine Eliminierung', e.sfx.drop === 0 && e.sfx.ringout === 0);
}
{
  // Gegenprobe: dieselbe Gruppe, aber die aeussere Kugel liegt anhand ihrer
  // Settlement-Position wirklich draussen (824 > 823.2) -> genau sie wird verarbeitet.
  const before = [ball(0,824,0), ball(0,764,0), ball(1,0,0)];
  const e = settledAtExpiry(before);
  e.settleCollapse();
  e.runLoop();
  const a = posOf(e);
  t('Grenze: echte Aussenkugel ausgeschieden', a[0].alive === false);
  t('Grenze: Innenkugeln unveraendert', a[1].x === 764 && a[1].alive === true && a[2].x === 0);
  t('Grenze: genau ein Drop-Signal', e.sfx.drop === 1 && e.sfx.ringout === 0);
}

// ── 21) Kontaktkette: Settlement-Positionen identisch mit und ohne Collapse ──
{
  const chain = () => [ball(0,-60,0), ball(0,0,0), ball(1,60,0)];   // paarweise 4 px Ueberlappung
  // Kontrolllauf: identischer Zug, Timer laeuft weiter -> kein Collapse.
  const c = make(); c.setMode('bot'); c.resetCollapseTimer(); c.setR(1000);
  c.setBalls(chain()); c.setPhase('aim'); c.setAim([false,false]);
  c.setTime(0); c.tickCollapse(0);
  c.commit(0, 1, 0, 0, 0); c.runLoop();
  // Echter Lauf: derselbe Zug, aber der Timer laeuft ab -> Collapse im Settlement.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls(chain()); runToExpiry(e); e.runLoop();
  const cp = posOf(c), ep = posOf(e);
  t('Kette: Kontrolllauf ohne Collapse', c.state.collapseState === 'running' && near(c.getR(), 1000));
  t('Kette: echter Lauf mit Collapse', e.state.collapseState === 'collapsed' && near(e.getR(), 820));
  t('Kette: Restueberlappung im Settlement vorhanden', Math.hypot(ep[1].x - ep[0].x, ep[1].y - ep[0].y) < 64);
  t('Kette: Positionen bit-identisch zum Lauf ohne Collapse',
    ep.every((o, i) => o.x === cp[i].x && o.y === cp[i].y));
  t('Kette: alle drei Kugeln leben', ep.every(o => o.alive));
  t('Kette: keine Eliminierung durch den Collapse', e.sfx.drop === 0 && e.sfx.ringout === 0);
  t('Kette: neue Planungsphase', e.getPhase() === 'aim');
}

// ── 22) Mehrere gleichzeitig aeussere Kugeln: deterministisch, jede genau einmal ──
{
  const before = [ball(0,900,0), ball(0,850,0), ball(0,830,0), ball(1,0,0)];
  const e = settledAtExpiry(before);
  const ended = e.settleCollapse();
  const a = posOf(e);
  t('Mehrfach: Rundenende erkannt', ended === true && e.getPhase() === 'result');
  t('Mehrfach: outBall = am weitesten draussen', e.getOutBall() === 0);
  t('Mehrfach: Sieger = Bot (owner 1)', e.getRoundWinner() === 1);
  t('Mehrfach: die beiden anderen Aussenkugeln ausgeschieden', a[1].alive === false && a[2].alive === false);
  t('Mehrfach: Innenkugel unveraendert', a[3].alive === true && a[3].x === 0 && a[3].y === 0);
  t('Mehrfach: Positionen aller Aussenkugeln unveraendert',
    a[0].x === 900 && a[1].x === 850 && a[2].x === 830);
  t('Mehrfach: genau ein Ringout-Signal', e.sfx.ringout === 1);
  t('Mehrfach: genau ein result-Uebergang', e.getPhaseLog().filter(p => p.startsWith('result:')).length === 1);
  // Weiterlaufen: genau eine Wertung, kein Doppelschrumpf.
  e.runLoop();
  t('Mehrfach: genau ein afterResult', e.getAfterResultCalls() === 1);
  t('Mehrfach: genau ein startRound', e.getRoundStarts() === 1);
  t('Mehrfach: Radius bleibt 820 (kein Doppelschrumpf)', near(e.getR(), 820));
  t('Mehrfach: genau ein Punkt', e.getScore()[1] === 1 && e.getScore()[0] === 0);
}

// ── 23) ballsOutside ist positionsrein und deterministisch sortiert ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,1500,0), ball(0,0,0), ball(1,-1200,0), ball(1,50,0)]);
  e.getBalls()[2].alive = false;                       // tote Aussenkugel zaehlt nicht
  const snap = posOf(e);
  const out = e.ballsOutside();
  t('ballsOutside: nur lebende Aussenkugeln, aufsteigend', JSON.stringify(out) === '[0]');
  t('ballsOutside: veraendert keine Position',
    posOf(e).every((o, i) => o.x === snap[i].x && o.y === snap[i].y));
  t('ballsOutside: veraendert keinen alive-Status', posOf(e).every((o, i) => o.alive === snap[i].alive));
}

// ── 24) Kein zusaetzlicher Physikdurchlauf im Collapse-Pfad (Quelltextnachweis) ──
{
  const doCollapseSrc = grab(/function doCollapse\(\)\{[\s\S]*?\n\}/, 'doCollapse');
  t('doCollapse setzt keine Phase (kein sim-Frame)', !/setPhase\(/.test(doCollapseSrc));
  t('doCollapse ruft stepSim nicht auf', !/stepSim\(/.test(doCollapseSrc));
  t('doCollapse nutzt die gemeinsame Ermittlung', /ballsOutside\(\)/.test(doCollapseSrc));
  t('doCollapse nutzt die gemeinsame Verarbeitung', /resolveRingOuts\(/.test(doCollapseSrc));
  t('stepSim nutzt dieselbe Ermittlung', /ballsOutside\(\)/.test(stepSimSrc));
  t('stepSim nutzt dieselbe Verarbeitung', /resolveRingOuts\(/.test(stepSimSrc));
  // Keine zweite abweichende Ring-out-Logik: genau eine Definition und genau zwei
  // Aufrufer (stepSim, doCollapse). Die Bot-Vorhersage (simExchange/simSnap) ist ein
  // eigenstaendiger, bestandsgeschuetzter Predictor und beruehrt den Spielzustand nie.
  t('resolveRingOuts: eine Definition + zwei Aufrufer', (HTML.match(/resolveRingOuts/g) || []).length === 3);
  t('ballsOutside: eine Definition + drei Nutzungen', (HTML.match(/ballsOutside/g) || []).length === 4);
  t('Rundenende-Uebergang existiert genau einmal',
    (HTML.match(/outBall=decisive;setPhase\('result'\)/g) || []).length === 1);
}

// ── 25) Normaler stepSim-Ring-out-Pfad bleibt ohne Collapse voll funktional ──
{
  const e = make(); e.setMode('pvp'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,0,0), ball(1,990,0)]);
  e.setVel(1, 8, 0, 0);                                // faehrt regulaer aus dem Ring
  e.setPhase('sim'); e.runSim();
  t('Normal: Ring-out ueber die normale Physik', e.getOutBall() === 1 && e.getPhase() === 'result');
  t('Normal: Sieger = Spieler 0', e.getRoundWinner() === 0);
  t('Normal: genau ein Ringout-Signal', e.sfx.ringout === 1);
  t('Normal: kein Collapse beteiligt', e.sfx.collapse === 0 && near(e.getR(), 1000));
}
{
  const e = make(); e.setMode('pvp'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,0,0), ball(0,200,0), ball(1,990,0), ball(1,-990,0)]);
  e.setVel(2, 8, 0, 0); e.setVel(3, -8, 0, 0);         // beide Kugeln von Spieler 1 raus
  e.setPhase('sim'); e.runSim();
  const b = e.getBalls();
  t('Normal: mehrfacher Ring-out im selben Sub-Step', e.getPhase() === 'result');
  t('Normal: Sieger = Spieler 0', e.getRoundWinner() === 0);
  t('Normal: beide Kugeln von Spieler 1 raus', !(b[2].alive && b[3].alive));
  t('Normal: Kugeln von Spieler 0 leben', b[0].alive === true && b[1].alive === true);
}

console.log('\nRing-Collapse: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
