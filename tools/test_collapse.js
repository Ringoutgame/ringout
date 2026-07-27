// Action-Clock (globale 60s-Matchuhr + 7s-Zuglimit) — gezielte State-Machine-Tests
// fuer den OFFLINE-Teil des Vertrags (Bot-Training + Hotseat) inklusive der
// unveraenderten Bot-Arena-Collapse-Konsequenz. Extrahiert das echte Core-Modul
// (==COLLAPSE-CORE-START/END==) UND den echten stepSim (inkl. Ring-out-/Decisive-
// Logik) aus index.html und treibt beide in einer minimalen Sandbox durch die
// geforderten Szenarien. Der Online-Teil (clk-Anker, Races, Reconnect) wird in
// tools/test_action_clock.js gegen einen Fake-RTDB-Arbiter getestet.
//   node tools/test_collapse.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(path.dirname(__dirname), 'index.html'), 'utf8');

const grab = (re, name) => { const m = HTML.match(re); if (!m) { console.error('FAIL: ' + name + ' nicht gefunden'); process.exit(2); } return m[0]; };
const coreM = HTML.match(/==COLLAPSE-CORE-START==([\s\S]*?)==COLLAPSE-CORE-END==/);
if (!coreM) { console.error('FAIL: Collapse-Core-Block nicht gefunden'); process.exit(2); }
const core = coreM[1];
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
// stepSim und die Collapse-Auswertung teilen sich diese beiden Helfer.
const ballsOutsideSrc = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const applyLaunchSrc = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
const cancelDragSrc = grab(/function cancelAimDrag\(\)\{[\s\S]*?\n\}/, 'cancelAimDrag');
// Der komplette Result-Pfad laeuft mit den ECHTEN Produktfunktionen.
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

// Minimale Sandbox mit Stubs fuer alle externen Symbole der extrahierten Produktfunktionen.
// Echt (aus index.html extrahiert): Action-Clock-Core, stepSim inkl. Ring-out/Decisive,
// applyLaunch, cancelAimDrag, commit/applyCommit/commitAutoStand, sanitizeMove,
// beginReveal, afterResult, startRound, resetCommits, der Stand-Button-Handler sowie
// alle Physikkonstanten. Der komplette Pfad
// aim -> commit -> reveal -> sim -> result -> afterResult -> startRound
// laeuft damit ueber Produktcode statt ueber Nachbauten.
// Gestubbt: nur DOM/Audio/Partikel, placeBalls, gameOver, showRoundEnd, der Bot sowie
// die reinen Online-Symbole (writeTurnSlot/fbReady), die offline nie aufgerufen werden.
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
  // Online-Kontext: offline nie benutzt, aber von den Online-Zweigen des Core referenziert.
  let turnNo=-1, gen=0, roomCode='', onlineSessionId=1, seatLeft=[];
  function isOnlineTerminated(){return false;}
  function fbReady(){return false;}
  function writeTurnSlot(){}
  const toasts=[];
  function toast(m){toasts.push(m);}
  function T(k){return k;}
  // Pointer-/Drag-Stubs: exakt so viel, wie das echte cancelAimDrag() und der
  // nachgebildete pointerup-Pfad benoetigen.
  let dragging=false, dragShooter=-1, dragOwner=-1;
  let dragStart={x:0,y:0}, dragCur={x:0,y:0}, dragPull={x:0,y:0}, dragSpin=0;
  let aimPid=-1, spinPid=-1;
  const released=[];
  const cv={releasePointerCapture(id){released.push(id);}};
  const phaseLog=[], gameOverCalls=[];
  // botMoves ist zugleich der exakte Zaehler ausgefuehrter lokaler Zuege: applyCommit()
  // ruft im Bot-Modus je erfolgreichem Commit genau einmal botMove() auf.
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
    clockRemainMs, shrinkFloor, clockActive, collapseActive, inputLocked, canCommitInput, commitAutoStand, turnDeadlinePassed,
    stepSim, applyLaunch, cancelAimDrag, commit, afterResult, startRound,
    ballsOutside, resolveRingOuts,
    setPos(i,x,y){balls[i].x=x;balls[i].y=y;},
    runSim(){let g=0;while(phase==='sim'&&g++<20000)stepSim();},
    // Mini-Nachbau der Produktschleife fuer die Phasen, die die Uhr beruehrt
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
    setAimer(a){curAimer=a;},
    setHidden(h){document.hidden=h;document.visibilityState=h?'hidden':'visible';},
    setVel(i,vx,vy,sp){balls[i].vx=vx;balls[i].vy=vy;balls[i].spin=sp;},
    getR(){return R;}, getR0(){return R0;}, getPhase(){return phase;}, getBalls(){return balls;},
    getRoundWinner(){return roundWinner;}, getOutBall(){return outBall;},
    getPhaseLog(){return phaseLog.slice();}, getBotMoves(){return botMoves;}, getReleased(){return released.slice();},
    getScore(){return score.slice();}, getRoundNo(){return roundNo;}, getGameOver(){return gameOverCalls.slice();},
    getRoundStarts(){return roundStarts;}, getAfterResultCalls(){return afterResultCalls;}, getRoundEnds(){return roundEnds;},
    getToasts(){return toasts.slice();}, getAimer(){return curAimer;},
    getTurnPill(){const e=_els.turnTimer;return e?{text:e.textContent,display:e.style.display}:null;},
    // Tatsaechlich gesetzter Zug je Seat — prueft den angewendeten Zustand statt eines
    // Harness-Protokolls.
    getCommits(){return {aimSet:aimSet.slice(),idx:commitIdx.slice(),
                         aim:commitAim.map(a=>({dx:a.dx,dy:a.dy})),spin:commitSpin.slice()};},
    // Nachbildung des echten Drag-Starts (startAim) und des pointerup-Handlers aus index.html.
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
    get state(){return {clockEnabled,collapseState,matchElapsedMs,crackedState,collapseRadius,collapseOuterR,
                        collapseCountShown,collapseCountVisible,turnWindowSeat,turnWindowEndEl};},
    get sfx(){return sfx;},
    consts(){return {MATCH_CLOCK_MS,TURN_LIMIT_MS,CRACK_REMAIN_MS,TURN_WARN_MS,TURN_COUNT_MS,COLLAPSE_RADIUS_FACTOR,MAX_COLLAPSE_TICK_DELTA_MS};}
  };
`;
const make = () => new Function(prefix + core + suffix)();

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const twoBalls = () => [{owner:0,alive:true,x:0,y:0,vx:0,vy:0,spin:0},{owner:1,alive:true,x:9,y:9,vx:0,vy:0,spin:0}];
const ball = (owner,x,y) => ({owner,alive:true,x,y,vx:0,vy:0,spin:0});
const MATCH = 60000, TURN = 7000, CRACK = 10000;
// tickCollapse klemmt ein einzelnes Frame-Delta auf MAX_COLLAPSE_TICK_DELTA_MS.
// Tests ruecken die Uhr deshalb wie ein echter rAF-Verlauf vor statt in einem
// Riesensprung. 50 ms = 20 fps, klar unter der Klemmung.
const FRAME_MS = 50;
const advance = (e, fromMs, toMs, step = FRAME_MS) => {
  for (let tt = fromMs + step; tt < toMs; tt += step) { e.setTime(tt); e.tickCollapse(tt); }
  e.setTime(toMs); e.tickCollapse(toMs);
};
// Verbraucht aktive Entscheidungszeit OHNE offenes Fenster (alle Seats committed):
// treibt die globale Uhr deterministisch an eine Zielmarke, ohne Zuege auszuloesen.
const drainTo = (e, target) => {
  e.setPhase('aim'); e.setAim([true,true]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, target);
};
// Faehrt den Timer bis auf 0: erst fensterlos auf 56s, dann oeffnet das LETZTE Fenster
// (Restzeit 4000 < TURN_LIMIT) und endet exakt bei 0 — genau EIN erzwungener No-Shot,
// wie im frueheren 120s-Prototyp der einzelne Auto-Stand am Matchende.
const runOutTimer = (e) => {
  drainTo(e, MATCH - 4000);
  e.setAim([false,false]);
  advance(e, MATCH - 4000, MATCH);
};
// Treibt ein lokales Bot-Match ueber die ECHTEN Uebergaenge bis in die Simulation des
// letzten Zuges: aim -> Timer 0 -> No-Shot via commitAutoStand() -> reveal
// -> applyLaunch -> sim. Nach dem Ablauf wird bewusst KEIN tickCollapse mehr gerufen:
// alles Folgende muss allein ueber die Settlement-/Result-Hooks laufen.
const runToExpiry = (e) => { runOutTimer(e); e.applyLaunch(); };

// ── 0) Vertragskonstanten exakt ──
{
  const c = make().consts();
  t('MATCH_CLOCK_MS=60000', c.MATCH_CLOCK_MS === 60000);
  t('TURN_LIMIT_MS=7000', c.TURN_LIMIT_MS === 7000);
  t('CRACK_REMAIN_MS=10000', c.CRACK_REMAIN_MS === 10000);
  t('TURN_WARN_MS=3000', c.TURN_WARN_MS === 3000);
  t('TURN_COUNT_MS=2000', c.TURN_COUNT_MS === 2000);
  t('COLLAPSE_RADIUS_FACTOR=0.82', near(c.COLLAPSE_RADIUS_FACTOR, 0.82));
  t('MAX_COLLAPSE_TICK_DELTA_MS=250', c.MAX_COLLAPSE_TICK_DELTA_MS === 250);
}

// ── 1) Start: exakt 60s Restzeit, Uhr aktiv in JEDEM Modus ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  t('Start: Restzeit exakt 60000', e.clockRemainMs() === 60000);
  t('Start: Uhr aktiv (bot)', e.clockActive() === true);
  t('Start: Arena-Konsequenz aktiv (bot lokal)', e.collapseActive() === true);
  const p = make(); p.setMode('pvp'); p.resetCollapseTimer();
  t('Start: Uhr aktiv (pvp/hotseat)', p.clockActive() === true);
  t('Start: Arena-Konsequenz NUR bot (pvp false)', p.collapseActive() === false);
  const f = make(); f.setMode('ffa'); f.resetCollapseTimer();
  t('Start: Uhr aktiv (ffa lokal)', f.clockActive() === true);
}

// ── 2) Uhr zaehlt nur in aim, pausiert waehrend Physik ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setMenu(false);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 1000);                          // 1000 ms Planungsphase zaehlen
  const beforePhysics = e.state.matchElapsedMs;
  e.setPhase('reveal');
  advance(e, 1000, 3000);                       // 2000 ms Physik: kein Zeitverbrauch
  t('Physik-Phase verbraucht keine Zeit', near(e.state.matchElapsedMs, beforePhysics));
  t('Physik-Phase: kein Fenster aktiv', e.state.turnWindowSeat === -1 && e.state.turnWindowEndEl === null);
  e.setPhase('aim');
  advance(e, 3000, 4000);                       // wieder Planungsphase
  // Der erste Frame nach einer Pause setzt nur den Anker (Delta 0) — deshalb ein Frame weniger.
  t('Uhr zaehlt nur in aim (Physik uebersprungen)', near(e.state.matchElapsedMs, 2000 - FRAME_MS));
  // result/over/Menue pausieren ebenfalls
  const el = e.state.matchElapsedMs;
  for (const p of ['result','over']) { e.setPhase(p); advance(e, 4000, 4500); t('Pause in ' + p, near(e.state.matchElapsedMs, el)); }
  e.setPhase('aim'); e.setMenu(true); advance(e, 4500, 5000);
  t('Pause im Menue', near(e.state.matchElapsedMs, el));
}

// ── 3) Hotseat (pvp) nutzt denselben Vertrag; Online zaehlt lokal NICHT ──
{
  const e = make(); e.setMode('pvp'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]); e.setAimer(0);
  e.setTime(0); e.tickCollapse(0); advance(e, 0, 2000);
  t('PvP: Uhr laeuft (derselbe Vertrag)', near(e.state.matchElapsedMs, 2000));
  t('PvP: Fenster fuer curAimer 0', e.state.turnWindowSeat === 0);
  const o = make(); o.setMode('bot'); o.setOnline(true); o.resetCollapseTimer();
  o.setPhase('aim'); o.setTime(0); o.tickCollapse(0); advance(o, 0, 12000);
  t('Online: kein lokaler Zeitfortschritt (Autoritaet = clk)', o.state.matchElapsedMs === 0);
  t('Online: Arena-Konsequenz aus', o.collapseActive() === false);
}

// ── 4) Erstes Fenster: Timeout exakt bei 7000, verbindlicher 0-Impuls-No-Shot ──
{
  const e = make(); e.setMode('bot'); e.setBalls([ball(0,-350,0), ball(1,350,0)]); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, TURN - FRAME_MS);
  t('7s: unmittelbar vor Ablauf kein Zug', e.getBotMoves() === 0);
  t('7s: Eingabe vor Ablauf frei', e.inputLocked() === false && e.canCommitInput(0) === true);
  e.setTime(TURN); e.tickCollapse(TURN);
  const c = e.getCommits();
  t('7s: Timeout exakt bei 7000 (ein Zug)', e.getBotMoves() === 1);
  t('7s: No-Shot mit Impuls exakt 0', c.aim[0].dx === 0 && c.aim[0].dy === 0 && c.spin[0] === 0);
  t('7s: Zug gilt als abgeschlossen', c.aimSet[0] === true && e.getPhase() === 'reveal');
  t('7s: Rueckmeldung "Zeit abgelaufen"', e.getToasts().length === 1 && e.getToasts()[0] === 'turnTimeout');
  t('7s: Uhr hat exakt 7000 verbraucht', e.state.matchElapsedMs === 7000);
  t('7s: Match laeuft weiter (kein Expiry)', e.state.collapseState === 'running');
  // Kugelzustand unangetastet: Positionen wie gesetzt, keine kuenstliche Bewegung
  e.runLoop();
  const b = e.getBalls();
  t('7s: Kugelpositionen unveraendert', b[0].x === -350 && b[0].y === 0 && b[1].x === 350 && b[1].y === 0);
}

// ── 5) Normaler Commit vor 7s: nur die tatsaechlich verbrauchte Zeit wird abgezogen ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 3000);                           // Spieler denkt 3s nach
  e.commit(0, 0, 40, 0, 0);                      // echter Zug -> Bot antwortet -> reveal
  t('Commit: Fenster endet sofort', e.getPhase() === 'reveal' && e.getBotMoves() === 1);
  t('Commit: exakt 3000 verbraucht', e.state.matchElapsedMs === 3000);
  t('Commit: Restzeit 57000', e.clockRemainMs() === 57000);
  e.runLoop();                                   // Physik (verbraucht keine Zeit)
  advance(e, 3000, 5000);                        // neue Planungsphase ab Anker
  t('Commit: naechstes Fenster wieder voll (kein Timeout bei alter Deadline)', e.getBotMoves() === 1);
  advance(e, 5000, 3000 + FRAME_MS + TURN);      // 7000 aktive ms im 2. Fenster
  t('Commit: 2. Fenster-Timeout nach weiteren 7000 aktiven ms', e.getBotMoves() === 2);
  t('Commit: Gesamtverbrauch 3000+7000', near(e.state.matchElapsedMs, 10000, FRAME_MS + 1));
}

// ── 6) Verspaeteter Commit wird abgelehnt (jeder Benutzer-Pfad) ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, TURN - FRAME_MS);                // unmittelbar VOR der Deadline: Fenster noch offen
  t('Spaet: vor der Deadline nicht gesperrt', e.turnDeadlinePassed() === false);
  e.setTime(TURN); e.tickCollapse(TURN);         // Deadline-Tick: No-Shot wird ATOMAR im selben Tick gesetzt
  const moves = e.getBotMoves(), booked = e.getCommits();
  t('Spaet: Deadline-Tick hat den No-Shot atomar gebucht', moves === 1 && booked.aimSet[0] === true);
  // Jeder danach eintreffende Benutzer-Commit ist verspaetet und wird abgewiesen:
  // der Zug ist abgeschlossen (aimSet) und die Phase hat die Planung verlassen.
  e.standButton();
  e.commit(0, 0, -250, 120, 0.4);
  e.startDrag(9, 0, 0); e.pointerUp(9);
  const after = e.getCommits();
  t('Spaet: kein zweiter Zug durch Stand-Button/Commit/Pointer', e.getBotMoves() === moves);
  t('Spaet: gebuchter No-Shot bleibt unveraendert', after.aim[0].dx === 0 && after.aim[0].dy === 0);
  t('Spaet: kein Ueberschreiben des aimSet', after.aimSet[0] === true);
}

// ── 7) Zug-Countdown: Warnung ab 3s, grosse Zahl + Beep in den letzten 2s, je Fenster ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 4000);                           // Fensterrest 3000
  t('Countdown: Pill sichtbar', e.getTurnPill().display === '');
  t('Countdown: bei Rest 3000 noch keine Zahl', e.state.collapseCountShown === -1 && e.sfx.tick === 0);
  advance(e, 4000, 5000);                        // Fensterrest 2000 -> Zahl 2
  t('Countdown: Zahl 2 mit einem Beep', e.state.collapseCountShown === 2 && e.sfx.tick === 1);
  e.tickCollapse(5000);                          // gleiche Sekunde -> kein Doppel-Beep
  t('Countdown: kein Doppel-Beep', e.sfx.tick === 1);
  advance(e, 5000, 6000);                        // Fensterrest 1000 -> Zahl 1
  t('Countdown: Zahl 1, zweiter Beep', e.state.collapseCountShown === 1 && e.sfx.tick === 2);
  advance(e, 6000, TURN);                        // Timeout
  t('Countdown: Fensterende, Zahl verborgen', e.state.collapseCountVisible === false);
  // Naechstes Fenster: Countdown-Entprellung je Fenster zurueckgesetzt
  e.runLoop();
  advance(e, TURN, TURN + 6000 + FRAME_MS);      // 2. Fenster bis Rest <2000
  t('Countdown: 2. Fenster beept erneut (2 und 1)', e.sfx.tick === 4);
}

// ── 8) Countdown/Pill sind ausserhalb der Planungsphase verborgen — ohne Doppel-Beep ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 5500);                           // Fensterrest 1500 -> Zahl 2 sichtbar
  t('Verborgen: in aim sichtbar', e.state.collapseCountVisible === true && e.state.collapseCountShown === 2);
  const beeps = e.sfx.tick;
  for (const p of ['reveal', 'sim', 'result', 'over']) {
    e.setPhase(p); e.tickCollapse(5500);
    t('Verborgen: in ' + p, e.state.collapseCountVisible === false);
  }
  e.setPhase('aim'); e.setMenu(true); e.tickCollapse(5500);
  t('Verborgen: im Menue', e.state.collapseCountVisible === false);
  e.setMenu(false); e.tickCollapse(5500);
  // Rueckkehr: Fenster wird neu armiert (Zustand ausserhalb aim verworfen) — die Uhr
  // stand still, die Zahl erscheint erst wieder ab der neuen Fenster-Restzeit.
  t('Verborgen: Timerwert unveraendert', near(e.state.matchElapsedMs, 5500));
  t('Verborgen: State unveraendert', e.state.collapseState === 'running');
  t('Verborgen: kein Beep durch das Wiedereinblenden', e.sfx.tick === beeps);
}

// ── 9) Inaktiver Tab: kein Zeitsprung, kein vorzeitiger Timeout ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 5000);                                  // Fensterrest 2000, Zahl 2
  const el = e.state.matchElapsedMs, beeps = e.sfx.tick;
  e.setHidden(true);
  e.setTime(5050); e.tickCollapse(5050);
  t('Hidden: erster Tick verbraucht keine Zeit', near(e.state.matchElapsedMs, el));
  t('Hidden: Countdown ausgeblendet', e.state.collapseCountVisible === false);
  for (let k = 2; k <= 40; k++) { const tt = 5000 + k * 50; e.setTime(tt); e.tickCollapse(tt); }
  t('Hidden: auch weitere Ticks verbrauchen keine Zeit', near(e.state.matchElapsedMs, el));
  t('Hidden: keine Beeps', e.sfx.tick === beeps);
  t('Hidden: kein Timeout im Hintergrund', e.getBotMoves() === 0);
  e.setHidden(false);
  e.setTime(400000); e.tickCollapse(400000);            // lange Wanduhrzeit vergangen
  t('Visible: erster Tick ohne Delta-Sprung', near(e.state.matchElapsedMs, el));
  e.setTime(400050); e.tickCollapse(400050);
  t('Visible: danach zaehlt die Uhr normal weiter', near(e.state.matchElapsedMs, el + 50));
}

// ── 10) Grosser sichtbarer Frame-Sprung: Delta geklemmt, keine Stufe uebersprungen ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, 4800);                                   // Fensterrest 2200: noch keine Zahl
  t('Sprung: vor dem Stall kein Countdown', e.state.collapseCountShown === -1 && e.sfx.tick === 0);
  e.setTime(7800); e.tickCollapse(7800);                 // 3 s Main-Thread-Stall in EINEM Frame
  t('Sprung: Delta auf MAX_COLLAPSE_TICK_DELTA_MS geklemmt', near(e.state.matchElapsedMs, 4800 + 250));
  t('Sprung: keine Stufe uebersprungen (2 zuerst)', e.state.collapseCountShown === 2 && e.sfx.tick === 1);
  t('Sprung: kein vorzeitiger Timeout', e.getBotMoves() === 0);
  advance(e, 7800, 7800 + 2500);                         // weiter in normalen Frames
  t('Sprung: beide Stufen genau einmal', e.sfx.tick === 2);
  t('Sprung: Timeout regulaer nach 7000 aktiven ms', e.getBotMoves() === 1);
}

// ── 11) Normale Frameraten bleiben zeitlich exakt (Klemmung ohne Nebenwirkung) ──
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

// ── 12) Vollstaendig passives Match: 9 Fenster (8x7000 + 4000), dann Expiry ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]);
  let tt = 0; e.setTime(0); e.tickCollapse(0);
  let guard = 0;
  while (e.state.collapseState === 'running' && guard++ < 12) {
    advance(e, tt, tt + TURN); tt += TURN;               // Fenster-Timeout -> No-Shot -> reveal
    if (e.state.collapseState !== 'running') break;
    e.runLoop();                                         // Physik/Result verbrauchen keine Zeit
    tt += 500; e.setTime(tt); e.tickCollapse(tt);        // neue Planungsphase ankert
  }
  t('Passiv: genau 9 erzwungene Zuege', e.getBotMoves() === 9);
  t('Passiv: exakt 60000 aktive ms verbraucht', e.state.matchElapsedMs === 60000);
  t('Passiv: Restzeit 0 (nie negativ)', e.clockRemainMs() === 0);
  t('Passiv: Expiry genau einmal', e.state.collapseState === 'expired');
  t('Passiv: Crack genau einmal auf dem Weg', e.state.crackedState === true && e.sfx.warn === 1);
  t('Passiv: 9 Timeout-Rueckmeldungen', e.getToasts().length === 9);
}

// ── 13) Cracked-State: exakt einmal bei Restzeit <=10000, Rematch setzt zurueck ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  drainTo(e, MATCH - CRACK - 1000);              // Rest 11000: noch kein Crack
  t('Crack: vor der Schwelle nicht gesetzt', e.state.crackedState === false && e.sfx.warn === 0);
  advance(e, MATCH - CRACK - 1000, MATCH - CRACK);   // Rest exakt 10000
  t('Crack: exakt an der Schwelle gesetzt', e.state.crackedState === true);
  t('Crack: genau ein Warnsignal', e.sfx.warn === 1);
  advance(e, MATCH - CRACK, MATCH - CRACK + 3000);
  t('Crack: idempotent (kein zweites Signal)', e.sfx.warn === 1 && e.state.crackedState === true);
  e.resetCollapseTimer();
  t('Crack: Rematch setzt zurueck', e.state.crackedState === false);
  t('Crack: Rematch-Restzeit wieder 60000', e.clockRemainMs() === 60000);
}

// ── 14) Expiry: offene Zuege einmalig No-Shot; bestaetigter Zug bleibt ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  runOutTimer(e);
  const c = e.getCommits();
  t('Expiry: genau ein erzwungener Zug', e.getBotMoves() === 1);
  t('Expiry: Spieler 0 bestaetigt', c.aimSet[0] === true);
  t('Expiry: Stehen bleiben (dx=dy=0)', c.aim[0].dx === 0 && c.aim[0].dy === 0);
  t('Expiry: State=expired', e.state.collapseState === 'expired');
  e.tickCollapse(MATCH);
  t('Expiry: nur einmal', e.getBotMoves() === 1);
}
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  drainTo(e, MATCH - 4000);
  e.setAim([true,false]);                        // Spieler hat bereits bestaetigt
  advance(e, MATCH - 4000, MATCH);
  t('Expiry: bestaetigter Zug wird NICHT ueberschrieben', e.getBotMoves() === 0);
  t('Expiry: State=expired trotzdem gesetzt', e.state.collapseState === 'expired');
}

// ── 15) Hotseat-Expiry (pvp): fehlende Seats erhalten No-Shots, Runde startet einmal ──
{
  const e = make(); e.setMode('pvp'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  drainTo(e, MATCH - 4000);
  e.setAim([false,false]); e.setAimer(0);
  advance(e, MATCH - 4000, MATCH);               // letztes Fenster laeuft bei 0 aus
  const c = e.getCommits();
  t('Hotseat: beide Seats No-Shot', c.aimSet[0] === true && c.aimSet[1] === true);
  t('Hotseat: beide mit Impuls 0', c.aim[0].dx === 0 && c.aim[0].dy === 0 && c.aim[1].dx === 0 && c.aim[1].dy === 0);
  t('Hotseat: Reveal genau einmal gestartet', e.getPhase() === 'reveal');
  t('Hotseat: Expiry gesetzt', e.state.collapseState === 'expired');
  t('Hotseat: keine Arena-Konsequenz (R unveraendert)', e.getR() === 1000);
  e.runLoop();                                   // Physik + neue Runde
  t('Hotseat: Matchlogik laeuft weiter (aim)', e.getPhase() === 'aim');
  e.setAim([false,false]); e.setAimer(0);
  e.setTime(MATCH + 1000); e.tickCollapse(MATCH + 1000);
  t('Hotseat: Folgerunden ohne Deadline (kein Fenster)', e.state.turnWindowEndEl === null);
  t('Hotseat: Eingabe wieder frei (untimed)', e.inputLocked() === false && e.canCommitInput(0) === true);
}

// ── 16) Hotseat-Fensterfolge: jeder Aimer erhaelt sein eigenes 7s-Fenster ──
{
  const e = make(); e.setMode('pvp'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setPhase('aim'); e.setAim([false,false]); e.setAimer(0);
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, TURN);                           // Seat 0 laeuft ab -> No-Shot, curAimer -> 1
  const c1 = e.getCommits();
  t('Hotseat-Folge: Seat 0 No-Shot', c1.aimSet[0] === true && c1.aim[0].dx === 0);
  t('Hotseat-Folge: Zug wandert zu Seat 1', e.getAimer() === 1 && e.getPhase() === 'aim');
  // Das Fenster von Seat 1 armiert im Tick NACH dem Seat-Wechsel (7050) und endet
  // deshalb bei 14050 aktiven ms — ein Frame Versatz, exakt deterministisch.
  advance(e, TURN, 2 * TURN + 2 * FRAME_MS);     // Seat 1 laeuft ebenfalls ab
  const c2 = e.getCommits();
  t('Hotseat-Folge: Seat 1 No-Shot', c2.aimSet[1] === true && c2.aim[1].dx === 0);
  t('Hotseat-Folge: danach Reveal', e.getPhase() === 'reveal');
  t('Hotseat-Folge: 2x7000 aktive ms (+1 Armierungsframe) verbraucht', e.state.matchElapsedMs === 2 * TURN + FRAME_MS);
  t('Hotseat-Folge: zwei Rueckmeldungen', e.getToasts().length === 2);
}

// ── 17) Collapse erst nach Physik-Settlement, genau einmal, Faktor 0.82 (Bot-Arena) ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setR(1000); runOutTimer(e);              // expired, No-Shot -> phase 'reveal'
  e.setPhase('sim'); e.tickCollapse(MATCH);  // Physik laeuft: KEIN Collapse
  t('Kein Collapse waehrend Physik', e.getR() === 1000 && e.state.collapseState === 'expired');
  e.setPhase('aim'); e.tickCollapse(MATCH);  // Settlement-Recovery -> Collapse
  t('Collapse-Radius = R*0.82', near(e.getR(), 820));
  t('Collapse-State=collapsed', e.state.collapseState === 'collapsed');
  t('Collapse-Alarm genau einmal', e.sfx.collapse === 1);
  e.runSim();
  e.setPhase('aim'); e.tickCollapse(MATCH);  // erneut -> kein zweiter Collapse
  t('Collapse nur einmal (Radius stabil)', near(e.getR(), 820) && e.sfx.collapse === 1);
}

// ── 18) Sofortige Eliminierung ausserhalb des neuen Radius (Rundenende) ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  e.setR(1000);
  e.setBalls([{owner:0,alive:true,x:900,y:0,vx:0,vy:0,spin:0},{owner:1,alive:true,x:0,y:0,vx:0,vy:0,spin:0}]);
  runOutTimer(e);
  e.setPhase('aim'); e.tickCollapse(MATCH);  // Collapse -> R=820, Auswertung
  e.runSim();
  const b = e.getBalls();
  t('Sofort: Aussenkugel (900>820) ist der outBall', e.getOutBall() === 0);
  t('Sofort: gueltige Kugel bleibt', b[1].alive === true);
  t('Sofort: Rundenende -> phase=result', e.getPhase() === 'result');
  t('Sofort: Sieger = Bot (owner 1)', e.getRoundWinner() === 1);
}

// ── 19) Keine neue Aim-Phase fuer ausgeschiedene Kugel (Runde laeuft weiter) ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  e.setR(1000);
  e.setBalls([
    {owner:0,alive:true,x:900,y:0,vx:0,vy:0,spin:0},
    {owner:0,alive:true,x:100,y:0,vx:0,vy:0,spin:0},
    {owner:1,alive:true,x:0,y:-100,vx:0,vy:0,spin:0}
  ]);
  runOutTimer(e);
  e.setPhase('aim'); e.tickCollapse(MATCH);
  e.runSim();
  const b = e.getBalls();
  t('Weiterlauf: Aussenkugel (900) ausgeschieden', b[0].alive === false);
  t('Weiterlauf: Innenkugeln bleiben', b[1].alive === true && b[2].alive === true);
  t('Weiterlauf: neue Planungsphase (phase=aim)', e.getPhase() === 'aim');
}

// ── 20) shrinkFloor: normal R0*0.80, nach Collapse eingefroren ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  t('shrinkFloor normal = R0*0.80', near(e.shrinkFloor(), 800));
  e.setR(1000); e.setBalls(twoBalls()); runOutTimer(e);
  e.setPhase('aim'); e.tickCollapse(MATCH); e.runSim();
  t('shrinkFloor nach Collapse = collapseRadius (820)', near(e.shrinkFloor(), 820));
  const nextR = Math.max(e.shrinkFloor(), e.getR() - e.getR0() * 0.030);
  t('Rundenschrumpf friert bei collapseRadius ein', near(nextR, 820));
}

// ── 21) Rematch stellt Uhr + Floor + Fenster wieder her ──
{
  const e = make(); e.setMode('bot'); e.setBalls(twoBalls()); e.resetCollapseTimer();
  e.setR(1000); runOutTimer(e);
  e.setPhase('aim'); e.tickCollapse(MATCH); e.runSim();
  e.resetCollapseTimer(); e.setR(1000);
  t('Rematch: State=running', e.state.collapseState === 'running');
  t('Rematch: elapsed=0', e.state.matchElapsedMs === 0);
  t('Rematch: collapseRadius=0', e.state.collapseRadius === 0);
  t('Rematch: kein Fenster', e.state.turnWindowSeat === -1 && e.state.turnWindowEndEl === null);
  t('Rematch: Crack zurueckgesetzt', e.state.crackedState === false);
  t('Rematch: shrinkFloor wieder R0*0.80', near(e.shrinkFloor(), 800));
}

// ── 22) Matchende vor 0 verhindert Ablauf/Collapse ──
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
  e.setPhase('over'); e.tickCollapse(MATCH);
  t('Collapse nach Matchende verhindert', e.getR() === 1000 && e.state.collapseState === 'expired');
}

// ── 23) Restgeschwindigkeit/Spin werden vor der Collapse-Auswertung neutralisiert ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  runToExpiry(e);
  e.setVel(0, 0.06, -0.03, 0.4);
  e.setVel(1, -0.05, 0.02, -0.6);
  e.stepSim();                                   // Settlement -> settleCollapse -> doCollapse
  const b = e.getBalls();
  const snap = b.map(o => ({ x: o.x, y: o.y }));
  t('Rest: Collapse im Settlement ausgeloest', e.state.collapseState === 'collapsed');
  t('Rest: vx/vy/spin aller lebenden Kugeln = 0',
    b.every(o => !o.alive || (o.vx === 0 && o.vy === 0 && o.spin === 0)));
  e.runSim();
  const a = e.getBalls();
  t('Rest: Position P0 exakt unveraendert', a[0].x === snap[0].x && a[0].y === snap[0].y);
  t('Rest: Position P1 exakt unveraendert', a[1].x === snap[1].x && a[1].y === snap[1].y);
  t('Rest: beide Kugeln innerhalb des neuen Radius bleiben leben', a[0].alive && a[1].alive);
}

// ── 24) Keine Aim-Luecke zwischen Settlement und Collapse ──
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
  t('Aim-Luecke: genau ein erzwungener Zug', e.getBotMoves() === 1);
}
{
  // Solange expired gilt, wird JEDER Benutzer-Commitpfad tatsaechlich abgewiesen.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,100,0), ball(1,-300,0)]);
  runOutTimer(e);
  t('Eingabe nach Ablauf gesperrt', e.inputLocked() === true);
  const moves = e.getBotMoves(), before = e.getCommits();
  e.setPhase('aim'); e.setAim([false,false]);
  e.standButton();
  e.commit(0, 0, -250, 120, 0.4);
  e.startDrag(9, 0, 0); e.pointerUp(9);
  t('Stand-Button bei aim+expired abgewiesen', e.getCommits().aimSet[0] === false);
  t('Benutzer-Commit bei aim+expired abgewiesen', e.getBotMoves() === moves);
  t('Pointer-Commit bei aim+expired abgewiesen', e.getBotMoves() === moves);
  t('Bereits gesetzter No-Shot unveraendert',
    before.aim[0].dx === 0 && before.aim[0].dy === 0 && before.idx[0] === 0);
  // Der interne Pfad funktioniert weiterhin — aber genau einmal.
  e.commitAutoStand(0, 0);
  t('Interner No-Shot greift', e.getBotMoves() === moves + 1 && e.getCommits().aimSet[0] === true);
  e.commitAutoStand(0, 0);
  t('Interner No-Shot nicht wiederholbar', e.getBotMoves() === moves + 1);
}
{
  // commitAutoStand ist kein allgemeines Schlupfloch: ohne abgelaufene Deadline wirkungslos.
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls(twoBalls()); e.setPhase('aim'); e.setAim([false,false]);
  e.setTime(0); e.tickCollapse(0);
  e.commitAutoStand(0, 0);
  t('No-Shot ohne Deadline wirkungslos', e.getBotMoves() === 0 && e.getCommits().aimSet[0] === false);
  e.setOnline(true); e.setPhase('aim');
  e.commitAutoStand(0, 0);
  t('No-Shot online wirkungslos (Slot-Arbiter zustaendig)', e.getBotMoves() === 0);
}

// ── 25) Aktiver Drag beim Fensterablauf: Abbruch, ein No-Shot, kein zweiter Commit ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer();
  e.setBalls(twoBalls()); e.setPhase('aim'); e.setAim([false,false]);
  e.startDrag(7, 0, 0);                           // Spieler zieht gerade zurueck
  e.setTime(0); e.tickCollapse(0);
  advance(e, 0, TURN);                            // Fenster-Timeout
  const d = e.getDrag();
  t('Drag: beim Ablauf abgebrochen', d.dragging === false && d.aimPid === -1);
  t('Drag: Shooter/Owner zurueckgesetzt', d.dragShooter === -1 && d.dragOwner === -1);
  t('Drag: Pull und Spin zurueckgesetzt', d.dragPull.x === 0 && d.dragPull.y === 0 && d.dragSpin === 0);
  t('Drag: Pointer-Capture freigegeben', e.getReleased().includes(7));
  const c0 = e.getCommits();
  t('Drag: No-Shot genau einmal', e.getBotMoves() === 1 && c0.aimSet[0] === true);
  t('Drag: No-Shot ist Stehenbleiben', c0.aim[0].dx === 0 && c0.aim[0].dy === 0);
  e.pointerUp(7);                                 // spaetes pointerup nach dem Ablauf
  const c1 = e.getCommits();
  t('Drag: spaetes pointerup erzeugt keinen zweiten Commit', e.getBotMoves() === 1);
  t('Drag: bestaetigter Zug bleibt Stand', c1.aim[0].dx === 0 && c1.aim[0].dy === 0);
}

// ── 26) Mehrere Kugeln gleichzeitig ausserhalb des neuen Radius ──
{
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
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(1,0,890)]);
  runToExpiry(e); e.runSim();
  t('Aussen(2): outBall = am weitesten draussen (Index 0)', e.getOutBall() === 0);
  t('Aussen(2): Sieger deterministisch = Bot (owner 1)', e.getRoundWinner() === 1);
  t('Aussen(2): Rundenende (result)', e.getPhase() === 'result');
  t('Aussen(2): ein Ringout-Signal', e.sfx.ringout === 1);
}

// ── 27) Kugeln innerhalb des neuen Radius behalten exakt ihre Position ──
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

// ── 28) Keine Doppelwertung der Collapse-Auswertung ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(1,0,890)]);
  runToExpiry(e); e.runSim();
  const results = e.getPhaseLog().filter(p => p.startsWith('result:')).length;
  t('Doppelwertung: genau ein result-Uebergang', results === 1);
  t('Doppelwertung: genau ein Collapse-Alarm', e.sfx.collapse === 1);
  e.tickCollapse(MATCH); e.runSim(); e.tickCollapse(MATCH + 1000);
  t('Doppelwertung: kein zweiter Collapse', e.sfx.collapse === 1 && near(e.getR(), 820));
  t('Doppelwertung: kein zweites Ringout', e.sfx.ringout === 1);
  t('Doppelwertung: outBall stabil', e.getOutBall() === 0);
  t('Doppelwertung: Sieger stabil', e.getRoundWinner() === 1);
}

// ── 29) Matchende waehrend der Collapse-Auswertung startet keine neue Aim-Phase ──
{
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,900,0), ball(1,0,890)]);
  runToExpiry(e);
  const before = e.getPhaseLog().length;
  e.runSim();
  const after = e.getPhaseLog().slice(before);
  t('Matchende: keine Aim-Phase nach dem Collapse', !after.some(p => p.startsWith('aim:')));
  t('Matchende: endet im Result-Zustand', e.getPhase() === 'result');
  const o = make(); o.setMode('bot'); o.setBalls(twoBalls()); o.resetCollapseTimer(); o.setR(1000);
  runOutTimer(o);
  o.setPhase('over'); o.doCollapse();
  t('Matchende: doCollapse in phase=over wirkungslos', o.getR() === 1000 && o.state.collapseState === 'expired');
}

// ── 30) Andere Modi: doCollapse ist hart gegated ──
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

// ══════════════════════════════════════════════════════════════════════════════
// Result-Pfad: rundenbeendender letzter erzwungener Zug (echte Uebergaenge).
// Nach dem Timerablauf wird bewusst KEIN tickCollapse mehr gerufen: der Collapse
// muss allein ueber settleCollapse()/collapseRoundEnd() laufen.
// ══════════════════════════════════════════════════════════════════════════════
const roundEndSetup = (e, score = [0,0], winTarget = 3) => {
  e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setScore(score); e.setWinTarget(winTarget);
  e.setBalls([ball(0,0,0), ball(1,900,0)]);
  e.setBotShot(400, 0);                        // maxPull nach aussen -> sicherer Ring-out
};

// ── 31) Rundenbeendender, nicht matchentscheidender Ring-out ──
{
  const e = make(); roundEndSetup(e);
  runToExpiry(e);                              // -> reveal -> applyLaunch -> sim
  e.runLoop();                                 // sim -> result -> afterResult -> startRound
  const log = e.getPhaseLog();
  t('Result: Runde endet ueber den echten Ring-out-Pfad', log.filter(p => p.startsWith('result:')).length === 1);
  t('Result: Collapse VOR startRound verarbeitet', e.state.collapseState === 'collapsed');
  t('Result: Radius exakt R*0.82 (kein doppelter Schrumpf)', near(e.getR(), 820));
  t('Result: kein aim+expired', !log.includes('aim:expired'));
  t('Result: neue Runde in aim+collapsed', e.getPhase() === 'aim' && log[log.length - 1] === 'aim:collapsed');
  t('Result: Eingabesperre aufgehoben', e.inputLocked() === false);
  t('Result: Collapse-Alarm genau einmal', e.sfx.collapse === 1);
  t('Result: Punkt an Spieler 0', e.getScore()[0] === 1 && e.getScore()[1] === 0);
}

// ── 32) Collapse nach Result: keine Doppelwertung, kein doppeltes startRound ──
{
  const e = make(); roundEndSetup(e);
  runToExpiry(e); e.runLoop();
  const score = e.getScore(), starts = e.getRoundStarts(), ars = e.getAfterResultCalls();
  t('Doppel: afterResult genau einmal je Result', ars === 1);
  t('Doppel: genau ein startRound', starts === 1);
  t('Doppel: genau ein Rundenende-Overlay', e.getRoundEnds() === 1);
  t('Doppel: genau ein Ringout-Signal', e.sfx.ringout === 1);
  e.runLoop(); e.tickCollapse(MATCH + 10000); e.runLoop();
  t('Doppel: Punktestand stabil', e.getScore()[0] === score[0] && e.getScore()[1] === score[1]);
  t('Doppel: kein zweites startRound', e.getRoundStarts() === starts);
  t('Doppel: kein zweiter Collapse', e.sfx.collapse === 1 && near(e.getR(), 820));
  t('Doppel: Rundenzaehler genau einmal erhoeht', e.getRoundNo() === 2);
}

// ── 33) Matchentscheidender Ring-out: Matchende hat Vorrang vor dem Collapse ──
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
  e.tickCollapse(MATCH + 10000); e.runLoop();
  t('Matchende: kein nachtraeglicher Collapse', e.sfx.collapse === 0 && e.getR() === 1000);
  t('Matchende: collapseRoundEnd wirkungslos in over', e.collapseRoundEnd() === false);
}

// ══════════════════════════════════════════════════════════════════════════════
// Positionsreine Collapse-Ring-out-Auswertung (Settlement-Positionen autoritativ).
// ══════════════════════════════════════════════════════════════════════════════
const settledAtExpiry = (positions) => {
  const e = make(); e.setMode('bot'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls(positions.map(p => ({...p})));
  runOutTimer(e);                              // Timer 0 -> No-Shot, State 'expired'
  e.setPhase('aim');
  return e;
};
const posOf = (e) => e.getBalls().map(b => ({ x: b.x, y: b.y, alive: b.alive }));

// ── 34) Ueberlappende innere Kugeln behalten exakt ihre Position ──
{
  const before = [ball(0,100,0), ball(0,150,0), ball(1,-200,0)];   // Paar ueberlappt um 14 px
  const e = settledAtExpiry(before);
  t('Ueberlappung: Ausgangslage ueberlappt wirklich', Math.hypot(150 - 100, 0) < 64);
  const logBefore = e.getPhaseLog().length;
  const ended = e.settleCollapse();
  t('Ueberlappung: kein Phasenwechsel durch den Collapse', e.getPhaseLog().length === logBefore);
  e.runLoop();
  const a = posOf(e);
  t('Ueberlappung: Runde laeuft weiter', ended === false && e.getPhase() !== 'result');
  t('Ueberlappung: Radius auf 820', near(e.getR(), 820));
  t('Ueberlappung: x/y aller Kugeln exakt unveraendert',
    a.every((o, i) => o.x === before[i].x && o.y === before[i].y));
  t('Ueberlappung: alle Kugeln leben', a.every(o => o.alive));
  t('Ueberlappung: keine Eliminierung', e.sfx.drop === 0 && e.sfx.ringout === 0);
}

// ── 35) Kontaktgruppe direkt an der neuen Grenze (820 + BR*0.1 = 823.2) ──
{
  const before = [ball(0,822,0), ball(0,762,0), ball(1,0,0)];
  const e = settledAtExpiry(before);
  const ended = e.settleCollapse();
  e.runLoop();
  const a = posOf(e);
  t('Grenze: Kontaktgruppe wird nicht auseinandergeschoben', a[0].x === 822 && a[1].x === 762);
  t('Grenze: knapp innen liegende Kugel ueberlebt', a[0].alive === true);
  t('Grenze: Nachbarkugel ueberlebt', a[1].alive === true);
  t('Grenze: Runde laeuft weiter', ended === false && e.getRoundWinner() === -1);
}
{
  const before = [ball(0,824,0), ball(0,764,0), ball(1,0,0)];
  const e = settledAtExpiry(before);
  e.settleCollapse();
  e.runLoop();
  const a = posOf(e);
  t('Grenze: echte Aussenkugel ausgeschieden', a[0].alive === false);
  t('Grenze: Innenkugeln unveraendert', a[1].x === 764 && a[1].alive === true && a[2].x === 0);
  t('Grenze: genau ein Drop-Signal', e.sfx.drop === 1 && e.sfx.ringout === 0);
}

// ── 36) Mehrere gleichzeitig aeussere Kugeln: deterministisch, jede genau einmal ──
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
  t('Mehrfach: genau ein Ringout-Signal', e.sfx.ringout === 1);
  e.runLoop();
  t('Mehrfach: genau ein afterResult', e.getAfterResultCalls() === 1);
  t('Mehrfach: Radius bleibt 820 (kein Doppelschrumpf)', near(e.getR(), 820));
  t('Mehrfach: genau ein Punkt', e.getScore()[1] === 1 && e.getScore()[0] === 0);
}

// ── 37) ballsOutside ist positionsrein und deterministisch sortiert ──
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

// ── 38) Kein zusaetzlicher Physikdurchlauf im Collapse-Pfad (Quelltextnachweis) ──
{
  const doCollapseSrc = grab(/function doCollapse\(\)\{[\s\S]*?\n\}/, 'doCollapse');
  t('doCollapse setzt keine Phase (kein sim-Frame)', !/setPhase\(/.test(doCollapseSrc));
  t('doCollapse ruft stepSim nicht auf', !/stepSim\(/.test(doCollapseSrc));
  t('doCollapse nutzt die gemeinsame Ermittlung', /ballsOutside\(\)/.test(doCollapseSrc));
  t('doCollapse nutzt die gemeinsame Verarbeitung', /resolveRingOuts\(/.test(doCollapseSrc));
  t('stepSim nutzt dieselbe Ermittlung', /ballsOutside\(\)/.test(stepSimSrc));
  t('stepSim nutzt dieselbe Verarbeitung', /resolveRingOuts\(/.test(stepSimSrc));
  t('resolveRingOuts: eine Definition + zwei Aufrufer', (HTML.match(/resolveRingOuts/g) || []).length === 3);
  t('Rundenende-Uebergang existiert genau einmal',
    (HTML.match(/outBall=decisive;setPhase\('result'\)/g) || []).length === 1);
}

// ── 39) Normaler stepSim-Ring-out-Pfad bleibt ohne Collapse voll funktional ──
{
  const e = make(); e.setMode('pvp'); e.resetCollapseTimer(); e.setR(1000);
  e.setBalls([ball(0,0,0), ball(1,990,0)]);
  e.setVel(1, 8, 0, 0);                                // faehrt regulaer aus dem Ring
  e.setPhase('sim'); e.runSim();
  t('Normal: Ring-out ueber die normale Physik', e.getOutBall() === 1 && e.getPhase() === 'result');
  t('Normal: Sieger = Spieler 0', e.getRoundWinner() === 0);
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

console.log('\nRing-Collapse/Action-Clock: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
