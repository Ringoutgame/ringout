// Arena-Football-Integrations-Shell — Regressionsnetz für den neuen mode==='football'.
//
// Extrahiert die ECHTEN Funktionen aus index.html (wie die bestehenden Golden-/
// Lockstep-Suiten) und prüft die Shell-Invarianten:
//   - Registrierung (MODE_ORDER / MENU_SEL / Karte / CTA-Texte),
//   - genau drei Kugeln (Blau links, Rot rechts, neutraler Ball mittig, owner 4),
//   - normaler 1v1-Aufbau unverändert (2 Kugeln),
//   - neutraler Ball ist nicht auswählbar (pickOwnBall filtert owner===who),
//   - Football: geschlossene Rounded-Rectangle-Bande statt Ring-Out (Reflexion, keine Elimination),
//   - normale Modi behalten Ring-Out (mode='bot' eliminiert außerhalb liegende Kugeln).
// Nur lesend auf index.html.

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

// ── Registrierung: reine Rohtext-Prüfungen ──
ok(/const MODE_ORDER=\[[^\]]*'football'[^\]]*\]/.test(HTML), "MODE_ORDER enthält 'football'");
ok(/football:\{card:'cardFootball'/.test(HTML), 'MENU_SEL hat einen football-Eintrag');
ok(/id="cardFootball"/.test(HTML), 'Menükarte cardFootball existiert');
ok(/ctaFootball:'[^']+'/.test(HTML) && /infoFootball:'[^']+'/.test(HTML), 'CTA-/Info-Texte für football vorhanden');
ok(/menuSel==='football'/.test(HTML), 'CTA-Handler verzweigt auf football');

// ── Klick-/Auswahl-Pfad: jede Moduskarte MUSS ihre Einzel-Click-Bindung auf selectMenuMode haben.
//    (Genau dieser Listener fehlte fuer cardFootball -> Klick wirkungslos.) ──
ok(/\$\('cardFootball'\)\.onclick=\(\)=>selectMenuMode\('football'\)/.test(HTML), "cardFootball hat einen Click-Listener -> selectMenuMode('football')");
ok(/\$\('cardBot'\)\.onclick=\(\)=>selectMenuMode\('bot'\)/.test(HTML), 'cardBot bleibt auswaehlbar');
ok(/ctaFootball:'START ARENA FOOTBALL 1V1'/.test(HTML), "CTA-Text football = 'START ARENA FOOTBALL 1V1'");
// Strukturell: KEIN MENU_SEL-Kartenmodus ohne echten Auswahl-Pfad (schuetzt football + alle Karten).
const menuSelBlock = grab(/const MENU_SEL=\{[\s\S]*?\n\};/, 'MENU_SEL block');
const cardByMode = {};
let mm; const menuSelEntryRe = /(\w+):\{card:'([^']+)'/g;
while ((mm = menuSelEntryRe.exec(menuSelBlock)) !== null) cardByMode[mm[1]] = mm[2];
ok(Object.keys(cardByMode).length >= 6, 'MENU_SEL enthaelt alle Moduskarten inkl. football (' + Object.keys(cardByMode).length + ')');
for (const [modeKey, cardId] of Object.entries(cardByMode)) {
  const re = new RegExp("\\$\\('" + cardId + "'\\)\\.onclick=\\(\\)=>selectMenuMode\\('" + modeKey + "'\\)");
  ok(re.test(HTML), 'Karte ' + cardId + " besitzt den Auswahl-Pfad selectMenuMode('" + modeKey + "')");
}

// ── Physik-/Setup-Env: die echten Funktionen, mode parametrisierbar ──
const consts = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const spin = grab(/const SPIN_K=[^\n]*/, 'spin constants');
const pcols = grab(/const PCOLS=[^\n]*/, 'PCOLS');
const pcolsSandbox = pcols +
  // Der neutrale Football-Ball traegt FOOTBALL_NEUTRAL_OWNER (5). Im Produkt existiert er
  // ausserhalb des Football-Modus nicht - dieser Harness setzt ihn dort BEWUSST ein, um zu
  // beweisen, dass die Toroeffnung nicht in normale Modi leckt. Damit dabei der 2D-Ring-Out-
  // Pfad (im Football unerreichbar) nicht ueber einen fehlenden Farbslot stolpert, bekommt
  // die Sandbox-Tafel diesen einen Eintrag zusaetzlich. Die echte Tafel bleibt unberuehrt.
  'PCOLS.push(PCOLS[PCOLS.length-1]);';
const mkBallSrc = grab(/function mkBall\([^\n]*/, 'mkBall');
const placeBallsSrc = grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls');
const teamCapSrc = grab(/function teamCap\([^\n]*/, 'teamCap');
const pickOwnBallSrc = grab(/function pickOwnBall\([^\n]*/, 'pickOwnBall');
const ballsOutsideSrc = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
// ── Football-Kernblock (Arena-Finalisierung) ──
// Der GESAMTE produktive Football-Code liegt zusammenhaengend zwischen
// FOOTBALL_NEUTRAL_OWNER und stepSim: Rounded-Rectangle-Arena (FOOTBALL_ARENA,
// footballShapeSD/footballBoundSD), Ballradius (FOOTBALL_BALL_RADIUS/fbBallR/ballRad),
// Physikstandard M1 (FOOTBALL_PHYS + cur*-Accessoren), Pfosten, Anti-Wedge, Torablauf,
// Goal-FX und Matchende. Er wird als EIN Quellblock uebernommen — dieselbe kanonische
// Extraktionsarchitektur wie in den Prototyp-Harnesses
// (artifacts/football-*-prototype/measure.js), statt zwei Dutzend Einzel-Grabs.
const footballBlock = grab(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nfunction stepSim\(\)\{)/, 'Football-Block');
// curFR/curFE/curST stehen oberhalb des Football-Blocks (sie gelten fuer alle Modi).
const curFRSrc = grab(/function curFR\(\)[^\n]*/, 'curFR');
const curFESrc = grab(/function curFE\(\)[^\n]*/, 'curFE');
const curSTSrc = grab(/function curST\(\)[^\n]*/, 'curST');
// Einzel-Grabs NUR fuer Quelltext-Assertions (die Sandbox laeuft ueber den Block).
const halfDepthSrc = grab(/const FB_GOAL_HALF_DEPTH=[^\n]*/, 'FB_GOAL_HALF_DEPTH');
const arenaSrc = grab(/const FOOTBALL_ARENA=\{[\s\S]*?\};/, 'FOOTBALL_ARENA');
const presetSrc = grab(/const FOOTBALL_PHYS=\{[\s\S]*?\nfunction curRestPost\(\)[^\n]*/, 'FOOTBALL_PHYS block');
// Abschusskurve - unveraendert aus dem Produktivcode.
const tempoSrc = grab(/const FB_LAUNCH_SCALE=[\s\S]*?\nfunction fbLaunchMul\(len\)\{[\s\S]*?\n\}/, 'Abschusskurve');
const postProbeSrc = grab(/function footballPostProbe\(b\)\{[\s\S]*?\n\}/, 'footballPostProbe');
const wedgeSrc = grab(/const FOOTBALL_WEDGE_MIN_CONTACTS=[\s\S]*?\nfunction footballEscape\(b,cs\)\{[\s\S]*?\n\}/, 'wedge block');
const goalClearHalfSrc = grab(/function footballGoalClearHalf\([^\n]*/, 'footballGoalClearHalf');
const goalCenterHalfSrc = grab(/function footballGoalCenterHalf\([^\n]*/, 'footballGoalCenterHalf');
const goalCanPassSrc = grab(/function footballCanPassGoal\(b\)\{[\s\S]*?\n\}/, 'footballCanPassGoal');
const resolvePostSrc = grab(/function footballResolvePost\(b,emit\)\{[\s\S]*?\n\}/, 'footballResolvePost');
// Goal Detection: seit der Vier-Tore-Faltung liegt die Linienpruefung in
// footballGoalCrossed (liefert die getroffene TORSEITE), footballGoalSide ist nur noch die
// Classic-Abbildung "Punkt fuer die Gegenseite". Geprueft wird deshalb beides als eine Einheit.
const goalSideSrc = grab(/function footballGoalCrossed\(b\)\{[\s\S]*?\nfunction footballGoalSide\(b\)\{[\s\S]*?\n\}/, 'footballGoalSide');
const freezeSrc = grab(/function footballFreezePlayers\(\)\{[\s\S]*?\n\}/, 'footballFreezePlayers');
// Der Parameter heisst seit der Vier-Tore-Faltung `key` statt `sign`: Classic/Tactical
// uebergeben weiterhin +-1, Elimination4 den Ownerindex des getroffenen Tores.
const goalFxSrc = grab(/const FB_GOAL_FX_MS=[\s\S]*?\nfunction footballGoalFxLevel\(key,nowMs\)\{[\s\S]*?\n\}/, 'Football-Goal-FX-Block');
const tryGoalSrc = grab(/function footballTryGoal\(b\)\{[\s\S]*?\n\}/, 'footballTryGoal');
const resetRoundSrc = grab(/function footballResetRound\(\)\{[\s\S]*?\n\}/, 'footballResetRound');
const tickGoalSrc = grab(/function footballTickGoal\(\)\{[\s\S]*?\n\}/, 'footballTickGoal');
const matchEndSrc = grab(/function footballMatchEnd\(\)\{[\s\S]*?\n\}/, 'footballMatchEnd');
const resetMatchStateSrc = grab(/function footballResetMatchState\([^\n]*/, 'footballResetMatchState');
const inputLockedSrc = grab(/function inputLocked\([^\n]*/, 'inputLocked');
// Die Vektorquelle des Zugs — dieselbe Funktion, die auch der menschliche Release benutzt.
// Sie wird WOERTLICH uebernommen, damit der Test nicht seinen eigenen Nachbau prueft.
const aimVectorSrc = grab(/function aimVectorFromDrag\(\)\{[\s\S]*?\n\}/, 'aimVectorFromDrag');
// Die Kartenzeile: sie traegt im Speed Match das Zeitkonto. Woertlich uebernommen, damit
// der Test die ECHTE Beschriftung prueft und nicht seinen Nachbau.
const readyTextSrc = grab(/function readyText\(p\)\{[\s\S]*?\n\}/, 'readyText');
const canCommitSrc = grab(/function canCommitInput\(who\)\{[\s\S]*?\n\}/, 'canCommitInput');
const npSrc = grab(/function np\([^\n]*/, 'np');
const resetCommitsSrc = grab(/function resetCommits\(\)\{[\s\S]*?\n\}/, 'resetCommits');
const startRoundSrc = grab(/function startRound\(\)\{[\s\S]*?\n\}/, 'startRound');

function buildEnv(startMode, startFmt, startPreset) {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${consts}
    ${spin}
    ${pcolsSandbox}
    // Kein Browser-TUNE-Override im Harness — curFE/curST greifen darauf zurueck.
    const TUNE=null;
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', outBall=-1, roundWinner=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false;
    let mode=${JSON.stringify(startMode)}, fmt=${JSON.stringify(startFmt)};
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},
           footballGoal(mp){goalAudio.plays++;if(mp)goalAudio.matchPoints++;},
           footballGoalPreload(){goalAudio.preloads++;},footballGoalStop(){goalAudio.stops++;},
           fbTransitionBed(){},fbTransitionLock(){},fbTransitionStop(){}};
const goalAudio={plays:0,matchPoints:0,preloads:0,stops:0};   // Tor-Audio: Aufrufzaehler statt echter Ausgabe
    function spawn(){} function popBall(){} function winnerRGB(){return '';}
    let r3dActive=false; function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;} function updateHud(){} function setPhaseText(){}
    function onlineArmTurn(){} function openCover(){fbSetCover(true);}
    // Der Schliessweg des Uebergabeschirms ist im Produkt DOM-behaftet; hier bleibt
    // genau der Zustandsanteil, auf den sich die Uebergabefrist verlaesst.
    function fbCloseCover(){fbSetCover(false);}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    // Bestehende Result-Struktur: im Browser DOM-lastig, hier als reiner Recorder.
    // Sie setzt exakt das, worauf der Football-Resultzustand sich verlaesst: phase='over'.
    let gameOverCalls=[];
    function gameOver(w){gameOverCalls.push(w);phase='over';}
    let score=[0,0], roundNo=1;
    let collapseEnabled=false, collapseState='running';
    function collapseActive(){return false;}
    function cancelAimDrag(){cancelDragCalls++;dragging=false;dragShooter=-1;dragOwner=-1;
      dragStart={x:0,y:0};dragCur={x:0,y:0};dragPull={x:0,y:0};dragSpin=0;}
    let cancelDragCalls=0;
    // Zugzustand und Commit-Weg. Der Commit wird nur AUFGEZEICHNET — gefragt ist, WELCHER
    // Zug bei Ablauf der Bedenkzeit entsteht, nicht was die Simulation daraus macht.
    let dragging=false,dragShooter=-1,dragOwner=-1,dragStart={x:0,y:0},dragCur={x:0,y:0},dragPull={x:0,y:0},dragSpin=0;
    function aliveBalls(o){return balls.filter(b=>b.alive&&b.owner===o);}
    let commitLog=[];
    function applyCommit(who,idx,fx,fy,sp){commitLog.push({who,idx,fx,fy,sp:sp||0});aimSet[who]=true;}
    ${aimVectorSrc}
    ${readyTextSrc}
    ${mkBallSrc}
    ${teamCapSrc}
    ${placeBallsSrc}
    ${pickOwnBallSrc}
    ${ballsOutsideSrc}
    ${resolveRingOutsSrc}
    ${npSrc}
    ${resetCommitsSrc}
    ${startRoundSrc}
    // Der KOMPLETTE produktive Football-Block (Arena, Ballradius, Physik M1, Pfosten,
    // Anti-Wedge, Torablauf, Goal-FX, Matchende) — eine einzige kanonische Extraktion.
    // Er bringt fbGoalState/fbGoalTick/footballWinner selbst mit.
    ${footballBlock}
    // Vergleichsmodell des Laufs. Default ist der PRODUKTIVSTAND (M1) — die Sandbox
    // laeuft damit standardmaessig durch denselben Code wie das Spiel. 'BASELINE' schaltet
    // die Football-Physik komplett ab (footballPhys() -> null: globale Daempfung/REST,
    // kein Anti-Wedge); Arenaform, Torablauf und Matchlogik bleiben unveraendert.
    ${startPreset === 'BASELINE' ? 'footballPhys=function(){return null;};' : ''}
    const __model=${JSON.stringify(startPreset || 'PROD')};
    ${curFRSrc}
    ${curFESrc}
    ${curSTSrc}
    ${inputLockedSrc}
    ${canCommitSrc}
    ${tempoSrc}
    ${stepSimSrc}
    // ── Kontaktpass-Zaehler (Physikphase 4B-1) ──
    // Rein beobachtend: beide Wrapper reichen Argumente und Rueckgabewert unveraendert
    // durch und aendern kein Verhalten. Gezaehlt wird, WIE OFT die Kontaktaufloesung je
    // Micro-Step durchlaufen wird. footballResolvePost steht am Kopf des Football-
    // Grenzblocks, ballsOutside am Kopf des Nicht-Football-Zweigs — beide liegen INNERHALB
    // der Iterationsschleife und werden je Kontaktpass einmal je Kugel erreicht.
    // (footballResolvePost wird nach einer Bandenklemmung ein zweites Mal aufgerufen; die
    // Messszenarien unten halten die Kugel deshalb bewusst kontaktfrei im Feldinneren.)
    let postPassCalls=0, outsidePassCalls=0;
    const __resolvePostOrig=footballResolvePost, __ballsOutsideOrig=ballsOutside;
    footballResolvePost=function(b){postPassCalls++;return __resolvePostOrig(b);};
    ballsOutside=function(){outsidePassCalls++;return __ballsOutsideOrig();};
    return {
      cx, cy, R0, BR,
      // ── Arena-Geometrie (Rounded Rectangle, alles aus FOOTBALL_ARENA) ──
      halfLen(){ return fbHalfLen(); },
      // Tiefe der Torrettungstasche (nur farbige Spielerkugeln, nur im Torfenster).
      rescueDepth(){ return footballRescueDepth(); },
      rescueLimitAt(x,y,owner){ return footballRescueLimit({x,y,owner,alive:true}); },
      halfWid(){ return fbHalfWid(); },
      cornerR(){ return fbCorner(); },
      neutralR(){ return fbBallR(); },
      spawnOff(){ return fbArena().spawn*BR; },
      // Kopie, weil footballBoundSD das wiederverwendete fbSD-Objekt liefert.
      boundSD(b){ const s=footballBoundSD(b); return {sd:s.sd,nx:s.nx,nz:s.nz}; },
      // ── Physikphase 4B-1 ──
      contactIterations: FOOTBALL_CONTACT_ITERATIONS,
      tune(){ return {MAXPULL_FRAC,LAUNCH,FRICTION,FEND,SLOWV,REST,STOPV,SPIN_K,SPIN_DECAY}; },
      // ── Physikphase 4B-2 / 4B-3 / Movement M1 ──
      presetName(){ return __model; },
      prodPhys(){ return FOOTBALL_PHYS; },
      preset(){ return footballPhys(); },
      // Kandidatenwechsel wie der Dev-Parameter ?roll=: dasselbe mutable Objekt.
      setPhys(o){ Object.assign(FOOTBALL_PHYS, o); },
      maxLaunchV(){ return maxPull()*LAUNCH; },
      curve(){ return {scale:FB_LAUNCH_SCALE, curve:FB_LAUNCH_CURVE}; },
      // Geschwindigkeit fuer einen Zug der Staerke frac (0..1 von maxPull) - genau die
      // Rechnung, die applyLaunch im Spiel ausfuehrt.
      launchV(frac){ const len=maxPull()*frac; return len*fbLaunchMul(len); },
      // Die alte, streng lineare Kurve als Referenz fuer die Gewinnangaben.
      linearV(frac){ return maxPull()*frac*LAUNCH; },
      // Effektive Physik, wie stepSim sie sieht — geht durch dieselben Accessoren.
      effective(){ return {fr:curFR(), fe:curFE(), stopv:curST(), slowv:curSLOWV(),
                           fmid:curFMID(), fastv:curFASTV(),
                           frBall:curFRBall(), feBall:curFEBall(),
                           restBall:curRestBall(), restBand:curRestBand(), restPost:curRestPost()}; },
      wedgeConst(){ return {minContacts:FOOTBALL_WEDGE_MIN_CONTACTS, dot:FOOTBALL_WEDGE_DOT,
                            v:FOOTBALL_WEDGE_V, progress:FOOTBALL_WEDGE_PROGRESS,
                            steps:FOOTBALL_WEDGE_STEPS, press:FOOTBALL_WEDGE_PRESS,
                            eps:FOOTBALL_WEDGE_EPS, minEscapeV:FOOTBALL_ESCAPE_MIN_V}; },
      escapes(){ let n=0; for(const b of balls) n+=(b.fbEscapes||0); return n; },
      wedgeCounters(){ return balls.map(b=>b.fbWedge||0); },
      escapeDir(list){ return footballEscapeDir(list); },
      energy(){ let e=0; for(const b of balls) if(b.alive) e+=b.vx*b.vx+b.vy*b.vy; return 0.5*e; },
      resetPassCounts(){ postPassCalls=0; outsidePassCalls=0; },
      passCounts(){ return {post:postPassCalls, outside:outsidePassCalls}; },
      // ── Gameplayphase 2 ──
      goalState(){ return fbGoalState; },
      goalTick(){ return fbGoalTick; },
      score(){ return score.slice(); },
      setScore(a,b){ score=[a,b]; },
      goalSide(b){ return footballGoalSide(b); },
      goalBusy(){ return footballGoalBusy(); },
      locked(){ return inputLocked(); },
      canCommit(who){ aimSet=[false,false]; phase='aim'; return canCommitInput(who); },
      fallTicks: FOOTBALL_GOAL_FALL_TICKS, spawnTicks: FOOTBALL_GOAL_SPAWN_TICKS,
      celebrateTicks: FOOTBALL_GOAL_CELEBRATE_TICKS,
      winCelebrateTicks: FOOTBALL_GOAL_WIN_CELEBRATE_TICKS,
      celebrateTicksNow(){ return footballCelebrateTicks(); },
      spawnHeight(){ return footballSpawnHeight(); },
      dragCalls(){ return cancelDragCalls; },
      aimState(){ return {aimSet:aimSet.slice(), commitIdx:commitIdx.slice(), phase}; },
      setAim(){ aimSet=[true,true]; commitIdx=[0,1]; },
      passedFlags(){ return balls.map(b=>!!b.fbPassed); },
      // Spiegelt den echten Neues-Match-Pfad newGame() -> startRound() (ohne DOM/HUD):
      // Score auf 0, zentrale Football-Match-Initialisierung, frischer Rundenstart.
      newMatch(){ score=[]; for(let p=0;p<np();p++)score.push(0); footballResetMatchState(); startRound(); },
      // ── Gameplayphase 3 ──
      winner(){ return footballWinner; },
      winScore: FOOTBALL_WIN_SCORE,
      // ── Classic-Regelvarianten ──
      simHz: FOOTBALL_SIM_HZ,
      bankSeconds: FOOTBALL_BANK_SECONDS,
      bankTicks: FOOTBALL_BANK_TICKS,
      shotSeconds: FOOTBALL_SHOT_SECONDS,
      shotTicksMax: FOOTBALL_SHOT_TICKS,
      troubleSeconds: FOOTBALL_TROUBLE_SECONDS,
      troubleTicks: FOOTBALL_TROUBLE_TICKS,
      urgentTicks: FOOTBALL_SHOT_URGENT_TICKS,
      rules(){ return fbRules; },
      setRules(r){ fbRules=r; },
      speed(){ return fbSpeed(); },
      classicMode(){ return fbClassic(); },
      // ── Persoenliche Zeitkonten ──
      bank(w){ return fbBank[w]; },
      setBank(w,t){ fbBank[w]=t; },
      trouble(w){ return fbTrouble(w); },
      shotCap(w){ return fbShotCap(w); },
      shot(){ return fbShotTicks; },
      shotFor(){ return fbShotFor; },
      bankText(w){ return fbBankText(w); },
      shotText(){ return fbShotText(); },
      // ── Ende der Regulaerzeit ──
      regOver(){ return fbRegulationOver(); },
      // ── Kurzmeldungen (rein anzeigend) ──
      notice(){ return fbNotice; },
      noticeTicks(){ return fbNoticeTicks; },
      noticeTroubleMax: FOOTBALL_NOTICE_TROUBLE_TICKS,
      noticeFinalMax: FOOTBALL_NOTICE_FINAL_TICKS,
      troubleSeen(){ return fbTroubleSeen.slice(); },
      bankLabel(p){ return readyText(p); },
      golden(){ return fbGolden; },
      setVariant(v){ fbVariant=v; },
      decisionWho(){ return fbDecisionWho(); },
      decide(){ return fbClockDecide(); },
      // Ein Tick der UHR — unabhaengig von stepSim, so wie im Produkt: dort haengt sie an
      // simStep, das in JEDER Phase laeuft.
      tick(){ fbClockStep(); },
      tickN(n){ for(let k=0;k<n;k++)fbClockStep(); },
      setCover(b){ fbSetCover(b); },
      cover(){ return fbCoverOpen; },
      coverTicks(){ return fbCoverTicks; },
      handoffSeconds: FOOTBALL_HANDOFF_SECONDS,
      handoffTicks: FOOTBALL_HANDOFF_TICKS,
      setAimer(w){ curAimer=w; },
      openTurn(){ phase='aim'; aimSet=[false,false]; curAimer=0; fbSetCover(false); fbGoalState='play'; footballWinner=null; },
      setDrag(o,idx,px,py,sp){ dragging=true;dragOwner=o;dragShooter=idx;dragPull={x:px,y:py};dragSpin=sp||0; },
      dragLive(){ return dragging; },
      commits(){ return commitLog.slice(); },
      clearCommits(){ commitLog=[]; },
      vectorNow(){ return aimVectorFromDrag(); },
      overCalls(){ return gameOverCalls.slice(); },
      resetMatchState(){ footballResetMatchState(); },
      setGoalState(s){ fbGoalState=s; },
      // ── UX-Phase 3: rein visueller Tor-Impuls ──
      fxSide(){ return fbGoalFxSide; },
      fxStart(){ return fbGoalFxStart; },
      fxSign(){ return footballGoalFxSign(); },
      fxLevel(sign,nowMs){ return footballGoalFxLevel(sign,nowMs); },
      matchEnd(){ footballMatchEnd(); },
      fxDur: FB_GOAL_FX_MS,
      fxAttack: FB_GOAL_FX_ATTACK,
      clearHalf(){ return footballGoalClearHalf(); },
      centerHalf(){ return footballGoalCenterHalf(); },
      canPass(b){ return footballCanPassGoal(b); },
      // Sockel-Rechteck im kanonischen Quadranten (X = Torachse, Y = tangential),
      // direkt aus FOOTBALL_ARENA (postFront/postBack/postInner/postOuter).
      box(){ const av=fbArena(); return {x0:av.postFront*BR,x1:av.postBack*BR,y0:av.postInner*BR,y1:av.postOuter*BR}; },
      // Abstand einer Ballmitte zum naechstgelegenen der vier Sockel (0 = Kontakt).
      // < ballRad bedeutet: der Ball steckt im Marmor.
      boxGap(p){ const b=this.box(); let best=Infinity;
        for(const sx of [1,-1])for(const sy of [1,-1]){
          const X=sx*(p.x-cx),Y=sy*(p.y-cy);
          const qx=X<b.x0?b.x0:(X>b.x1?b.x1:X),qy=Y<b.y0?b.y0:(Y>b.y1?b.y1:Y);
          best=Math.min(best,Math.hypot(X-qx,Y-qy));}
        return best; },
      place(){ placeBalls(); return balls.map(b=>({x:b.x,y:b.y,owner:b.owner,alive:b.alive})); },
      pick(who,p){ return pickOwnBall(who,p); },
      setBalls(list){ balls=list.map(b=>({x:b.x,y:b.y,vx:b.vx||0,vy:b.vy||0,sx:b.x,sy:b.y,owner:b.owner,alive:true,spin:0})); phase='sim'; outBall=-1; },
      step(){ stepSim(); },
      // Phase frei setzen und lesen: der Zeitmodus muss beweisen, dass die Uhr NUR in
      // 'sim' laeuft — dafuer braucht die Suite Zugriff auf die anderen Phasen.
      setPhaseRaw(p){ phase=p; },
      phase(){ return phase; },
      get(){ return { phase, balls: balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,alive:b.alive,owner:b.owner})) }; }
    };
  `;
  return new Function(env)();
}

// ── Football-Setup: genau drei Kugeln, symmetrisch ──
// Owner des NEUTRALEN Balls. Seit der Fuenf-Spieler-Phase ist Slot 4 eine Spielerfarbe.
const NEU = 5;              // Owner des neutralen Balls
const NL = String.fromCharCode(10);

console.log('ARENA FOOTBALL — CLASSIC 1V1 AUF ZEIT' + NL);

// Ein frisches Classic-Match.
function neu() { const M = buildEnv('football', 'single'); M.newMatch(); return M; }

// Den Ball von innen auf ein Tor schiessen. dir +1 = rechtes Tor (Blau punktet).
// Die beiden Figuren stehen dabei weit weg, damit der Ball freie Bahn hat.
function schiessen(M, dir, tempo) {
  const off = M.spawnOff();
  M.setBalls([
    { x: M.cx - off, y: M.cy + 250, vx: 0, vy: 0, owner: 0 },
    { x: M.cx + off, y: M.cy - 250, vx: 0, vy: 0, owner: 1 },
    { x: M.cx + dir * 150, y: M.cy, vx: dir * (tempo || 6), vy: 0, owner: NEU },
  ]);
}
// Ein rollender Ball QUER zur Torachse: er bleibt lange in Bewegung und kann dabei
// kein Tor erreichen — genau richtig, um die Uhr zu beobachten.
function rollen(M, tempo) {
  const off = M.spawnOff();
  M.setBalls([
    { x: M.cx - off, y: M.cy + 250, vx: 0, vy: 0, owner: 0 },
    { x: M.cx + off, y: M.cy - 250, vx: 0, vy: 0, owner: 1 },
    { x: M.cx, y: M.cy, vx: 0, vy: tempo || 6, owner: NEU },
  ]);
}
// Bis zum Tor laufen lassen (oder bis nichts mehr passiert).
function bisTor(M, max) {
  let k = 0;
  while (M.goalState() === 'play' && k++ < (max || 400)) M.step();
  return M.goalState() !== 'play';
}
// Torablauf komplett abarbeiten, bis wieder gespielt wird oder das Match endet.
function torFertig(M) {
  let k = 0;
  while (M.goalState() !== 'play' && M.goalState() !== 'result' && k++ < 800) M.step();
}


// ══════════════════════════════════════════════════════════════════════════════
// A–C. DIE REGELWAHL
// ══════════════════════════════════════════════════════════════════════════════
// Classic hat zwei Regeln, und sie werden VOR dem Start gewaehlt. Die eine ist die
// Bestandsregel, die andere die schnelle Variante — beide bleiben erhalten.
{
  ok(/id="fbRuleOv"/.test(HTML), 'es gibt ein eigenes Overlay fuer die Regelwahl');
  ok(/id="fbFirst3Btn"/.test(HTML) && /id="fbSpeedBtn"/.test(HTML),
     'beide Regeln sind eigene, sichtbare Optionen');
  // "First to 3" heisst bewusst NICHT "Best of 3" — das waere ein anderes Wettkampfformat.
  ok(/fbFirst3T:'FIRST TO 3'/.test(HTML), 'die erste Regel heisst FIRST TO 3');
  ok(!/Best of 3|BEST OF 3/i.test(HTML), 'nirgends steht "Best of 3"');
  ok(/fbSpeedT:'SPEED MATCH'/.test(HTML), 'die zweite Regel heisst SPEED MATCH');
  // Der Untertitel muss den Unterschied sofort verstaendlich machen.
  ok(/fbFirst3S:'FIRST PLAYER TO SCORE 3 GOALS WINS'/.test(HTML),
     'First to 3 nennt seine Regel im Untertitel');
  ok(/fbSpeedS:'45 s PERSONAL TIME · 6 s PER SHOT · TIME TROUBLE'/.test(HTML),
     'Speed Match nennt Zeitkonto, Schussfrist und Zeitnot im Untertitel');
  // Der angezeigte Vertrag muss dem ausgefuehrten entsprechen: nirgends darf eine
  // Rundenzahl versprochen werden, die es nicht mehr gibt — auch nicht als HTML-Rueckfall
  // oder in einer der drei Sprachtafeln.
  ok(!/1[0-9]? ?(ROUNDS|RUNDEN|RAUND)/i.test(HTML),
     'nirgends wird eine feste Rundenzahl versprochen');
  // Gestartet wird ueber DENSELBEN einen Startpfad, nur mit der Regel als Argument.
  ok(HTML.includes("startFootball('classic',FOOTBALL_RULES_FIRST3);"), 'First to 3 startet Classic');
  ok(HTML.includes("startFootball('classic',FOOTBALL_RULES_SPEED);"), 'Speed Match startet Classic');
  ok(/function startFootball\(variant,rules\)\{/.test(HTML),
     'die Regel kommt als Argument in den einen Startpfad');
  ok(/fbRules=\(rules===FOOTBALL_RULES_SPEED\)\?FOOTBALL_RULES_SPEED:FOOTBALL_RULES_FIRST3;/.test(HTML),
     'ein unbekannter oder fehlender Wert faellt auf die Bestandsregel zurueck');
}
{
  // C) SAUBERE TRENNUNG. Keine der beiden Regeln darf Zustand der anderen sehen.
  const M = neu();
  ok(M.rules() === 'first3', 'Classic startet in FIRST TO 3');
  ok(M.speed() === false && M.classicMode() === true, 'First to 3 ist Classic, aber kein Speed Match');
  M.setRules('speed');
  ok(M.speed() === true, 'auf Speed Match umgestellt');
  M.setVariant('tactical');
  ok(M.classicMode() === false && M.speed() === false,
     'Tactical ist weder Classic noch Speed Match — die Regel greift dort nie');
  M.setVariant('classic');
  M.setVariant('elimination');
  ok(M.speed() === false, 'Elimination ebenso wenig');
}

// ══════════════════════════════════════════════════════════════════════════════
// D–F. FIRST TO 3 — DIE BESTANDSREGEL, UNVERAENDERT
// ══════════════════════════════════════════════════════════════════════════════
{
  const M = neu();
  ok(M.winScore === 3, 'FOOTBALL_WIN_SCORE ist 3');
  M.setScore(2, 0);
  schiessen(M, +1); bisTor(M); torFertig(M);
  ok(M.score()[0] === 3, 'das dritte Tor faellt (' + M.score().join(':') + ')');
  ok(M.winner() === 0, 'und entscheidet das Match');
  ok(M.goalState() === 'result', 'danach steht der Endzustand');
}
{
  // E) KEIN ZEITKONTO. In First to 3 laeuft keine Sekunde — es gibt nichts zu verwalten.
  const M = neu();
  M.openTurn();
  ok(M.decisionWho() === -1, 'in First to 3 gibt es keinen Entscheider mit Zeitdruck');
  const b0 = M.bank(0), b1 = M.bank(1);
  M.tickN(600);
  ok(M.bank(0) === b0 && M.bank(1) === b1, 'kein Zeitkonto sinkt (' + M.bank(0) + '/' + M.bank(1) + ')');
  ok(M.shot() === 0, 'und es laeuft kein Commit-Countdown');
}
{
  // F) KEINE RUNDENGRENZE — nirgends. Der Spieltest hat die Zwoelf-Runden-Regel verworfen:
  //    sie war eine ZWEITE Regulaerzeit neben den Konten und konnte ein Match beenden,
  //    obwohl beide Spieler noch Zeit hatten.
  ok(!/FOOTBALL_ROUNDS/.test(HTML), 'A) es gibt keine Rundenkonstante mehr');
  ok(!/fbRoundsDone|fbRoundNo/.test(HTML), 'A) und keinen Rundenzaehler im Produktivcode');
  ok(!/ROUND \{a\} \/ \{b\}|RUNDE \{a\} \/ \{b\}|RAUND \{a\} \/ \{b\}/.test(HTML),
     'B) kein "ROUND x / 12" mehr im HUD');
  ok(/function fbRegulationOver\(\)\{return fbBank\[0\]<=0&&fbBank\[1\]<=0;\}/.test(HTML),
     'A) die Regulaerzeit haengt jetzt allein an den beiden Konten');
  const M = neu();
  ok(M.golden() === false, 'F) First to 3 kennt kein Golden Goal');
}

// ══════════════════════════════════════════════════════════════════════════════
// G–K. SPEED MATCH — DIE PERSOENLICHEN ZEITKONTEN
// ══════════════════════════════════════════════════════════════════════════════
// Der Kern der Korrektur: es sinkt IMMER nur das Konto dessen, der gerade zielt.
function speed() { const M = neu(); M.setRules('speed'); M.resetMatchState(); return M; }
// Zwei Dauern, weil die beiden Ereignisse nicht gleich wichtig sind. Der Spieltest fand
// beide zu kurz; die letzte Aktion braucht laenger, weil sie den Ausgang betrifft.
function NOTICE_SEK(name) {
  const m = HTML.match(new RegExp('const FOOTBALL_NOTICE_' + name + '_TICKS=(\\d+);'));
  return m ? Number(m[1]) / 60 : -1;
}
{
  const M = speed();
  ok(M.bankSeconds === 45 && M.bankTicks === 45 * 60,
     'G/H) 45 Sekunden sind exakt 2700 feste Ticks (' + M.bankTicks + ')');
  ok(M.bank(0) === M.bankTicks, 'G) Blau startet mit vollem Konto');
  ok(M.bank(1) === M.bankTicks, 'H) Rot startet mit vollem Konto');
  ok(M.shotSeconds === 6 && M.shotTicksMax === 360, 'L) 6 Sekunden sind exakt 360 Ticks');
  ok(M.troubleSeconds === 2 && M.troubleTicks === 120, 'R) 2 Sekunden sind exakt 120 Ticks');
}
{
  // I) NUR DER ZIELENDE VERLIERT ZEIT. Das ist die Zusage, an der der ganze Pass haengt.
  const M = speed();
  M.openTurn();
  ok(M.decisionWho() === 0, 'Blau ist am Zug');
  M.tickN(300);
  ok(M.bank(0) === M.bankTicks - 300, 'Blau verliert 300 Ticks (' + M.bank(0) + ')');
  ok(M.bank(1) === M.bankTicks, 'ROT verliert dabei keine einzige Zehntelsekunde (' + M.bank(1) + ')');
  // Und umgekehrt.
  M.setAimer(1);
  M.tickN(180);
  ok(M.bank(1) === M.bankTicks - 180, 'Rot verliert seine eigenen 180 Ticks');
  ok(M.bank(0) === M.bankTicks - 300, 'Blaus Konto steht unveraendert (' + M.bank(0) + ')');
}
{
  // J) DIE SIMULATION KOSTET KEIN KONTO. Wer zusieht, zahlt nicht.
  const M = speed();
  M.openTurn();
  for (const p of ['sim', 'reveal', 'result', 'over']) {
    M.openTurn(); M.setPhaseRaw(p);
    const a = M.bank(0), b = M.bank(1);
    M.tickN(120);
    ok(M.bank(0) === a && M.bank(1) === b, 'J) die Phase ' + p + ' kostet kein Zeitkonto');
  }
  // K) DER UEBERGABESCHIRM EBENSO.
  M.openTurn(); M.setCover(true);
  const a = M.bank(0), b = M.bank(1);
  M.tickN(120);
  ok(M.bank(0) === a && M.bank(1) === b, 'K) der Uebergabeschirm kostet kein Zeitkonto');
  // Und der Torablauf.
  M.openTurn(); M.setGoalState('fall');
  const c = M.bank(0);
  M.tickN(120);
  ok(M.bank(0) === c, 'auch der Torablauf kostet nichts');
  M.setGoalState('play');
}
{
  // L) DIE NORMALE OBERGRENZE JE COMMIT IST 6 SEKUNDEN.
  const M = speed();
  M.openTurn();
  M.tick();
  ok(M.shotFor() === 0 && M.shot() === M.shotTicksMax - 1,
     'L) der Countdown startet bei 6 Sekunden (' + M.shot() + ')');
  ok(M.shotCap(0) === M.shotTicksMax, 'und die Obergrenze folgt dem vollen Konto');
  // M) DIE ANZEIGE STIMMT MIT DEM MASSGEBLICHEN TICKSTAND UEBEREIN.
  M.setBank(0, M.bankTicks); M.openTurn(); M.tickN(60);
  ok(M.shotText() === ((M.shotTicksMax - 60) / 60).toFixed(1),
     'M) der angezeigte Countdown ist der Tickstand (' + M.shotText() + ')');
  ok(M.bankText(0) === '0:44', 'M) und das Konto zeigt 0:44 nach einer Sekunde (' + M.bankText(0) + ')');
}

// ══════════════════════════════════════════════════════════════════════════════
// N–O. ABLAUF DES COMMIT-COUNTDOWNS
// ══════════════════════════════════════════════════════════════════════════════
{
  // N) MIT LIEGENDEM ZUGVEKTOR: genau dieser wird abgegeben.
  const M = speed();
  M.openTurn(); M.clearCommits();
  M.setDrag(0, 0, 40, -30, 0.5);
  const erwartet = M.vectorNow();
  ok(erwartet.weak === false, 'der liegende Zug ist ein echter Schuss');
  M.tickN(M.shotTicksMax);
  const c = M.commits();
  ok(c.length === 1, 'N) bei Ablauf entsteht genau EIN Commit');
  ok(c[0].fx === erwartet.fx && c[0].fy === erwartet.fy && c[0].sp === erwartet.spin,
     'N) und traegt EXAKT den liegenden Vektor (' + c[0].fx + '/' + c[0].fy + '/' + c[0].sp + ')');
  ok(!M.dragLive(), 'der Zug ist danach beendet — kein spaetes pointerup ueberschreibt ihn');
}
{
  // O) OHNE ZUGVEKTOR: ein Nullzug, kein erfundener Schuss.
  const M = speed();
  M.openTurn(); M.clearCommits();
  M.tickN(M.shotTicksMax);
  const c = M.commits();
  ok(c.length === 1 && c[0].fx === 0 && c[0].fy === 0 && c[0].sp === 0,
     'O) ohne liegenden Zug entsteht ein Nullzug');
  // Keine Zufallsrichtung, keine Zielhilfe — im Quelltext nachweisbar.
  const src = HTML.slice(HTML.indexOf('function fbDecisionExpire'), HTML.indexOf('function fbClockDecide'));
  ok(!/Math\.random|Math\.atan2|aimAssist|snap/i.test(src),
     'O) der Ablauf erfindet weder Richtung noch Staerke');
}
{
  // Ein TIPP unterhalb der Schussschwelle ist ebenfalls kein Schuss.
  const M = speed();
  M.openTurn(); M.clearCommits();
  M.setDrag(0, 0, 1, 1, 0);
  ok(M.vectorNow().weak === true, 'ein Tipp gilt als schwach');
  M.tickN(M.shotTicksMax);
  ok(M.commits()[0].fx === 0 && M.commits()[0].fy === 0, 'und wird bei Ablauf zum Nullzug');
}

// ══════════════════════════════════════════════════════════════════════════════
// P–S. ZEITNOT
// ══════════════════════════════════════════════════════════════════════════════
{
  // P) DAS KONTO ERREICHT EXAKT NULL — und bleibt dort.
  const M = speed();
  M.openTurn(); M.setBank(0, 5);
  M.tickN(5);
  ok(M.bank(0) === 0, 'P) das Konto steht exakt auf 0 (' + M.bank(0) + ')');
  M.tickN(60);
  ok(M.bank(0) === 0, 'P) und sinkt nicht ins Negative');
  // Q) ZEITNOT ist erreicht — aber niemand scheidet aus und niemand bekommt ein Tor.
  ok(M.trouble(0) === true, 'Q) Blau ist in Zeitnot');
  ok(M.trouble(1) === false, 'Q) Rot nicht');
  ok(M.winner() === null, 'Q) das leere Konto beendet das Match NICHT');
  ok(M.score()[0] === 0 && M.score()[1] === 0, 'Q) und verschenkt kein Tor');
}
{
  // R) IN ZEITNOT SIND ES 2 SEKUNDEN JE COMMIT.
  const M = speed();
  M.setBank(0, 0);
  M.openTurn();
  ok(M.shotCap(0) === M.troubleTicks, 'R) die Obergrenze faellt auf 2 Sekunden');
  M.tick();
  ok(M.shot() === M.troubleTicks - 1, 'R) und der Countdown startet dort (' + M.shot() + ')');
  M.clearCommits();
  M.tickN(M.troubleTicks);
  ok(M.commits().length === 1, 'R) nach zwei Sekunden steht der Zug');
}
{
  // S) LEERT SICH DAS KONTO MITTEN IM COMMIT, bleiben hoechstens zwei Sekunden — nicht
  //    die sechs, die der Countdown vielleicht noch uebrig haette.
  const M = speed();
  M.openTurn(); M.setBank(0, 30);          // eine halbe Sekunde Konto
  M.tick();
  ok(M.shot() === M.shotTicksMax - 1, 'S) der Commit startet regulaer mit 6 Sekunden');
  M.tickN(29);                              // Konto laeuft leer
  ok(M.bank(0) === 0, 'S) das Konto ist genau jetzt leer');
  // Der Tick, in dem das Konto leerlaeuft, verbraucht selbst schon eine Zehntelsekunde des
  // neuen Fensters: gekappt wird auf 120, danach zaehlt derselbe Tick auf 119 herunter.
  // "Hoechstens zwei Sekunden ab dem Leerlaufpunkt" ist damit exakt eingehalten.
  ok(M.shot() === M.troubleTicks - 1,
     'S) und der laufende Commit faellt sofort auf hoechstens 2 Sekunden (' + M.shot() + ')');
  M.clearCommits();
  M.tickN(M.troubleTicks);
  ok(M.commits().length === 1, 'S) nach diesen zwei Sekunden steht der Zug');
}

// ══════════════════════════════════════════════════════════════════════════════
// T–U. DER FAIRNESSVERTRAG — DER ALTE EXPLOIT MUSS UNMOEGLICH SEIN
// ══════════════════════════════════════════════════════════════════════════════
// Szenario aus dem Auftrag: Blau fuehrt 5:3 und trödelt bei JEDEM Commit die vollen
// sechs Sekunden. Frueher verbrannte das die GEMEINSAME Uhr und nahm Rot kuenftige
// Angriffe. Jetzt darf es ausschliesslich Blau selbst treffen.
{
  const M = speed();
  M.setScore(5, 3);
  const rotVorher = M.bank(1);
  let blauCommits = 0;
  // Blau schoepft sein Konto in Sechs-Sekunden-Bloecken aus.
  for (let k = 0; k < 10; k++) {
    M.openTurn(); M.setAimer(0); M.clearCommits();
    M.tickN(M.shotCap(0));
    blauCommits++;
    if (M.bank(0) === 0) break;
  }
  ok(M.bank(0) === 0, 'T) Blau hat sein EIGENES Konto verbraucht (' + blauCommits + ' Commits)');
  ok(M.bank(1) === rotVorher,
     'T) Rots Konto ist dabei unberuehrt geblieben (' + M.bank(1) + ' von ' + rotVorher + ')');
  ok(M.trouble(0) === true && M.trouble(1) === false, 'T) nur Blau ist in Zeitnot');
  // U) Und die Zahl der Regulaerrunden hat sich durch das Troedeln NICHT veraendert.
  ok(M.regOver() === false,
     'U) die Regulaerzeit laeuft weiter — Rot hat noch sein volles Konto');
  ok(M.decide() === false, 'U) und kein Zyklusabschluss beendet das Match');
  ok(M.winner() === null, 'U) Blau kann das Match durch Troedeln nicht beenden');
  // Rot bekommt weiterhin seine vollen sechs Sekunden je Zug.
  M.openTurn(); M.setAimer(1);
  ok(M.shotCap(1) === M.shotTicksMax, 'U) Rot zieht unveraendert mit sechs Sekunden');
}

// ══════════════════════════════════════════════════════════════════════════════
// F–K. DIE KONTEN SIND DIE REGULAERZEIT
// ══════════════════════════════════════════════════════════════════════════════
{
  // F) EIN leeres Konto beendet die Regulaerzeit NICHT. Der andere hat noch Zeit.
  const M = speed();
  M.setBank(0, 0);
  ok(M.regOver() === false, 'F) ein leeres Konto beendet die Regulaerzeit nicht');
  ok(M.decide() === false, 'F) und der Zyklusabschluss entscheidet nichts');
  ok(M.winner() === null, 'F) das Match laeuft weiter');
  // G) Der Spieler mit leerem Konto zieht weiter — mit zwei Sekunden.
  M.openTurn(); M.setAimer(0);
  ok(M.decisionWho() === 0, 'G) er bekommt weiterhin seinen Zug');
  ok(M.shotCap(0) === M.troubleTicks, 'G) mit zwei Sekunden Bedenkzeit');
  M.clearCommits();
  M.tickN(M.troubleTicks);
  ok(M.commits().length === 1, 'G) und sein Zug kommt zustande — er wird nicht uebersprungen');
  ok(M.winner() === null, 'G) niemand scheidet aus, niemand bekommt ein Tor geschenkt');
  // H) Das gegnerische Konto bleibt dabei unberuehrt.
  ok(M.bank(1) === M.bankTicks, 'H) das Konto des Gegners ist unangetastet (' + M.bank(1) + ')');
}
{
  // I) ERST das ZWEITE leere Konto beendet die Regulaerzeit.
  const M = speed();
  M.setBank(0, 0); M.setBank(1, 30);
  ok(M.regOver() === false, 'I) mit Restzeit bei Rot laeuft die Regulaerzeit');
  M.openTurn(); M.setAimer(1);
  M.tickN(30);
  ok(M.bank(1) === 0, 'I) Rots Konto ist jetzt leer');
  ok(M.regOver() === true, 'I) und damit ist die Regulaerzeit vorbei');
}
{
  // J) DER LETZTE ZYKLUS BLEIBT GANZ. Leert sich das zweite Konto mitten im Zug, wird
  //    dieser Zug nicht abgeschnitten: er fliegt aus, und ein Tor daraus zaehlt.
  const M = speed();
  M.setScore(1, 1); M.setBank(0, 0); M.setBank(1, 0);
  schiessen(M, +1);
  ok(M.get().phase === 'sim', 'J) der letzte Zyklus fliegt');
  ok(M.winner() === null, 'J) und ist beim Abschuss noch nicht gewertet');
  bisTor(M);
  ok(M.score()[0] === 2, 'J) das Tor des letzten Zyklus zaehlt (' + M.score().join(':') + ')');
  torFertig(M);
  // K) Erst danach entscheidet der Stand.
  ok(M.winner() === 0, 'K) ungleicher Stand nach dem letzten Zyklus entscheidet fuer Blau');
  ok(M.goalState() === 'result', 'K) danach steht der Endzustand');
}
{
  // K) Auch ohne Tor: der Zyklus loest sich auf, dann faellt die Entscheidung.
  const M = speed();
  M.setScore(3, 1); M.setBank(0, 0); M.setBank(1, 0);
  ok(M.decide() === true, 'K) der aufgeloeste Zyklus entscheidet das Match');
  ok(M.winner() === 0, 'K) fuer den mit dem hoeheren Stand');
}

// ══════════════════════════════════════════════════════════════════════════════
// Z–AB. GOLDEN GOAL
// ══════════════════════════════════════════════════════════════════════════════
{
  // Z) GLEICHSTAND NACH RUNDE 12 -> GOLDEN GOAL.
  const M = speed();
  M.setScore(2, 2);
  M.setBank(0, 0); M.setBank(1, 0);
  M.decide();
  ok(M.golden() === true, 'Z) Gleichstand nach dem letzten Zyklus fuehrt ins Golden Goal');
  ok(M.winner() === null, 'Z) und beendet das Match noch nicht');
  ok(M.score()[0] === 2 && M.score()[1] === 2, 'Z) der Punktestand bleibt stehen');
  // M) BEIDE KONTEN SIND LEER — im Golden Goal ziehen deshalb BEIDE mit zwei Sekunden.
  ok(M.bank(0) === 0 && M.bank(1) === 0, 'M) beide Konten stehen auf 0');
  ok(M.shotCap(0) === M.troubleTicks && M.shotCap(1) === M.troubleTicks,
     'M) und beide ziehen im Golden Goal mit zwei Sekunden');
  ok(M.trouble(0) === true && M.trouble(1) === true, 'M) beide sind in Zeitnot');
  // Es gibt keine Regulaerzeit mehr, die wieder anlaufen koennte.
  M.decide();
  ok(M.golden() === true && M.winner() === null,
     'AB) ein weiterer Zyklusabschluss aendert im Golden Goal nichts');
  // AA) DAS NAECHSTE GUELTIGE TOR GEWINNT.
  schiessen(M, +1); bisTor(M);
  ok(M.score()[0] === 3, 'AA) das Golden Goal faellt (' + M.score().join(':') + ')');
  ok(M.winner() === 0, 'AA) und entscheidet das Match sofort');
}
{
  // AB) In Zeitnot gilt auch im Golden Goal die Zwei-Sekunden-Grenze.
  const M = speed();
  M.setScore(1, 1); M.setBank(0, 0); M.setBank(1, 0);
  M.decide();
  ok(M.golden() === true, 'Setup: Golden Goal laeuft');
  M.openTurn();
  ok(M.shotCap(0) === M.troubleTicks, 'M) Blau zieht im Golden Goal mit zwei Sekunden');
  M.setAimer(1);
  ok(M.shotCap(1) === M.troubleTicks, 'M) Rot ebenso — beide Konten sind aufgebraucht');
}

// ══════════════════════════════════════════════════════════════════════════════
// AC–AD. REMATCH UND REGELWECHSEL
// ══════════════════════════════════════════════════════════════════════════════
{
  // AC) REMATCH setzt ALLES zurueck — und behaelt die gewaehlte Regel.
  const M = speed();
  M.setScore(4, 4); M.setBank(0, 120); M.setBank(1, 30);
  M.openTurn(); M.tickN(60);
  M.newMatch();
  ok(M.rules() === 'speed', 'AC) die gewaehlte Regel bleibt erhalten');
  ok(M.bank(0) === M.bankTicks && M.bank(1) === M.bankTicks,
     'AC) beide Konten stehen wieder auf 45 s (' + M.bank(0) + '/' + M.bank(1) + ')');
  ok(M.golden() === false, 'AC) kein offenes Golden Goal');
  ok(M.trouble(0) === false && M.trouble(1) === false, 'AC) keine Zeitnot');
  ok(M.shot() === 0 && M.shotFor() === -1, 'AC) kein laufender Commit-Countdown');
  ok(M.score()[0] === 0 && M.score()[1] === 0, 'AC) 0:0');
  // Ein neues Match beginnt hinter dem Uebergabeschirm — so wie jede Runde. Wichtig ist,
  // dass seine Frist frisch steht und nicht ein Rest aus dem alten Match.
  ok(M.cover() === true && M.coverTicks() === M.handoffTicks,
     'AC) das neue Match startet hinter einem frischen Uebergabeschirm (' + M.coverTicks() + ')');
}
{
  // AD) REGELWECHSEL hinterlaesst nichts. Speed-Zustand darf First to 3 nicht erreichen.
  const M = speed();
  M.setScore(3, 3); M.setBank(0, 0); M.setBank(1, 0);
  M.decide();
  ok(M.golden() === true, 'Setup: Speed Match steht im Golden Goal mit leerem Konto');
  // Zurueck ins Menue und die andere Regel waehlen — im Produkt startFootball(...,'first3').
  M.setRules('first3'); M.newMatch();
  ok(M.rules() === 'first3', 'AD) die Regel ist First to 3');
  ok(M.golden() === false, 'AD) kein Golden Goal aus dem Speed Match');
  ok(M.bank(0) === M.bankTicks && M.bank(1) === M.bankTicks, 'AD) keine leeren Konten geerbt');
  ok(M.speed() === false, 'AD) und die Zeitregel greift nicht mehr');
  M.openTurn(); M.tickN(300);
  ok(M.bank(0) === M.bankTicks, 'AD) in First to 3 sinkt kein Konto');
  // Und der Weg zurueck: First-to-3-Endzustand darf Speed Match nicht erreichen.
  M.setScore(2, 0); schiessen(M, +1); bisTor(M); torFertig(M);
  ok(M.winner() === 0, 'Setup: First to 3 ist entschieden');
  M.setRules('speed'); M.newMatch();
  ok(M.winner() === null, 'AD) Speed Match erbt keinen Endzustand');
  ok(M.golden() === false && M.regOver() === false, 'AD) und startet mit laufender Regulaerzeit');
}

// ══════════════════════════════════════════════════════════════════════════════
// DIE UEBERGABEFRIST
// ══════════════════════════════════════════════════════════════════════════════
// Hinter dem Schirm steht alles still — richtig, denn der Naechste hat das Feld noch
// nicht gesehen. Genau das machte ihn frueher zum Loch: nach der letzten Runde liess er
// sich offen lassen und das Match endete nie (Befund des unabhaengigen Reviews).
{
  const M = speed();
  ok(M.handoffSeconds === 30 && M.handoffTicks === 30 * 60,
     'die Uebergabefrist ist 30 Sekunden = 1800 Ticks');
  M.openTurn(); M.setCover(true);
  ok(M.coverTicks() === M.handoffTicks, 'beim Oeffnen steht sie voll');
  const a = M.bank(0), b = M.bank(1);
  M.tickN(600);
  ok(M.bank(0) === a && M.bank(1) === b, 'sie kostet kein Zeitkonto');
  M.tickN(M.coverTicks());
  ok(M.cover() === false, 'nach Ablauf ist der Schirm weg');
  ok(M.decisionWho() === 0, 'und der Spieler ist wieder handlungsfaehig');
  ok(/function fbCloseCover\(\)\{/.test(HTML), 'es gibt genau einen Schliessweg fuer den Schirm');
  ok(/\$\('coverBtn'\)\.onclick=\(\)=>fbCloseCover\(\);/.test(HTML), 'der Knopf benutzt ihn');
  ok(/fbCoverTicks===0&&typeof fbCloseCover==='function'\)fbCloseCover\(\)/.test(HTML),
     'und die Uebergabefrist denselben');
}

// ══════════════════════════════════════════════════════════════════════════════
// DAS GATE UND DER DETERMINISMUS
// ══════════════════════════════════════════════════════════════════════════════
{
  ok(/function fbClockStep\(\)\{[\s\S]{0,900}?const who=fbDecisionWho\(\);/.test(HTML),
     'das Gate steht in der Uhr selbst, nicht beim Aufrufer');
  ok(/function fbDecisionWho\(\)\{[\s\S]*?if\(phase!=='aim'\)return -1;/.test(HTML),
     'es verlangt ausdruecklich die Zielphase');
  ok(/function fbDecisionWho\(\)\{[\s\S]*?if\(fbCoverOpen\)return -1;/.test(HTML),
     'der Uebergabeschirm ist im Gate benannt');
  ok(/function fbDecisionWho\(\)\{[\s\S]*?document\.hidden\)return -1;/.test(HTML),
     'ein verdeckter Tab kostet keine Zeit');
  ok(/function fbDecisionWho\(\)\{[\s\S]*?r3dOrbit\)return -1;/.test(HTML),
     'der Orbit-Testmodus ebenso wenig');
  ok(/function simStep\(now\)\{[\s\S]{0,700}?if\(typeof fbClockStep==='function'\)fbClockStep\(\);/.test(HTML),
     'die Uhr haengt an simStep, das in jeder Phase laeuft');
  ok(!/if\(!fbSeq&&typeof fbClockStep==='function'\)fbClockStep\(\);/.test(HTML),
     'und nicht mehr an stepSim, das nur in der Simulationsphase laeuft');
  // §23: alle drei Zeiten sind feste Ticks, keine Wanduhr.
  // Ohne Kommentarzeilen geprueft: die Begruendungen im Quelltext NENNEN die Wanduhr
  // ausdruecklich, um zu erklaeren, warum sie nicht benutzt wird.
  const src = HTML.slice(HTML.indexOf('const FOOTBALL_RULES_FIRST3'), HTML.indexOf('function fbClockDecide'))
    .split(NL).filter((l) => !l.trim().startsWith('//')).join(NL);
  ok(!/Date\.now|performance\.|setTimeout|setInterval|requestAnimationFrame/.test(src),
     'die Zeitregel kennt weder Date.now noch Timer noch die Bildwiederholrate');
  ok(/const FOOTBALL_BANK_TICKS=FOOTBALL_BANK_SECONDS\*FOOTBALL_SIM_HZ;/.test(HTML) &&
     /const FOOTBALL_SHOT_TICKS=FOOTBALL_SHOT_SECONDS\*FOOTBALL_SIM_HZ;/.test(HTML) &&
     /const FOOTBALL_TROUBLE_TICKS=FOOTBALL_TROUBLE_SECONDS\*FOOTBALL_SIM_HZ;/.test(HTML),
     'alle drei Tickzahlen sind abgeleitet, nicht getippt');
}
{
  // Zwei getrennte Laeufe mit demselben Eingang stehen bitgleich gleich.
  const lauf = () => {
    const M = speed();
    M.openTurn(); M.clearCommits();
    M.setDrag(0, 0, 37, -21, -0.25);
    M.tickN(137);
    return JSON.stringify({ b: [M.bank(0), M.bank(1)], s: M.shot(), c: M.commits() });
  };
  ok(lauf() === lauf(), 'die Zeitregel ist deterministisch');
}

// ══════════════════════════════════════════════════════════════════════════════
// AE. DIE ACTION-CORE-PHYSIK IST UNANGETASTET
// ══════════════════════════════════════════════════════════════════════════════
// Dieser Pass ist Regeln und Darstellung, keine Physik. Die abgenommenen Werte aus
// 5c8dd58 muessen Zeichen fuer Zeichen dieselben sein.
{
  ok(/const FOOTBALL_BALL_MASS=Math\.pow\(FOOTBALL_BALL_RADIUS\/BR,3\);/.test(HTML),
     'AE) die Ballmasse ist unveraendert (25/32)^3');
  ok(/const imp=-\(1\+RB\)\*vn\/isum,ia=imp\/ma,ib=imp\/mb;/.test(HTML),
     'AE) der massenbehaftete Stossimpuls ist unveraendert');
  ok(/friction:0\.9958,frictionBall:0\.9964,\s*fend:0\.9620,fendBall:0\.9790,/.test(HTML),
     'AE) die Daempfung beider Kugelarten ist unveraendert');
  ok(/restBall:0\.44,restBand:0\.60,restPost:0\.50\}/.test(HTML),
     'AE) die Restitutionen sind unveraendert');
  ok(!/FOOTBALL_BALL_MAX_STEP/.test(HTML), 'AE) es gibt weiterhin keinen Tempo-Deckel');
  ok(/if\(footballGoalWindow\(fb\)\)continue;/.test(HTML), 'AF) das Torfenster ist unveraendert');
  ok(/function footballSweepPost\(b,px,py\)\{/.test(HTML), 'AF) die gefegte Sockelkollision steht');
  ok(/fbShoulderRect\(15\.60,11\.60,2\.60,35,6\.10\)/.test(HTML), 'AF) die 2P-Arena ist unveraendert');
  ok(/const FB_GOAL_ASSET_INNER=3\.560, FB_GOAL_ASSET_OUTER=5\.282;/.test(HTML),
     'AF) und das Tor misst unveraendert 227.84 px');
  // Der TICK selbst fasst keinen Koerper an.
  const clockSrc = HTML.slice(HTML.indexOf('function fbClockStep'), HTML.indexOf('function fbDecisionExpire'));
  ok(!/balls|\.vx|\.vy|\.x=|\.y=/.test(clockSrc),
     'der Tick liest und schreibt keinen Kugelzustand');
}

// ══════════════════════════════════════════════════════════════════════════════
// AI. ONLINE BLEIBT UNBERUEHRT
// ══════════════════════════════════════════════════════════════════════════════
{
  ok(/function fbDecisionWho\(\)\{[\s\S]{0,200}?if\(!fbSpeed\(\)\|\|online\)return -1;/.test(HTML),
     'AI) die Zeitregel ist online sofort aus');
  ok(/const FOOTBALL_FMTS=\['elimination'\];/.test(HTML),
     'AI) Online-Football kennt ausschliesslich Elimination');
  ok(/const ONLINE_PROTOCOL_VERSION=7;/.test(HTML), 'AI) die Protokollversion bleibt 7');
  // Und fbSpeed verlangt fbClassic — in Elimination ist es damit strukturell unmoeglich.
  ok(/function fbSpeed\(\)\{return fbClassic\(\)&&fbRules===FOOTBALL_RULES_SPEED;\}/.test(HTML),
     'AI) Speed Match verlangt Classic — in Elimination unerreichbar');
}

// ══════════════════════════════════════════════════════════════════════════════
// DAS HUD
// ══════════════════════════════════════════════════════════════════════════════
// Zwei verschiedene Begriffe, zwei verschiedene Stellen: der Commit-Countdown steht in
// der Mitte, die persoenlichen Konten bei den Spielerkarten. Sie duerfen nie verwechselt
// werden — deshalb auch zwei verschiedene Formate.
{
  const M = speed();
  M.setBank(0, 37 * 60 + 30);
  ok(M.bankText(0) === '0:38', 'das Konto zeigt M:SS, aufgerundet (' + M.bankText(0) + ')');
  M.setBank(0, 0);
  ok(M.bankText(0) === '0:00', 'ein leeres Konto zeigt 0:00');
  M.setBank(0, M.bankTicks); M.openTurn(); M.tickN(12);
  ok(M.shotText() === '5.8', 'der Commit-Countdown zeigt Zehntelsekunden (' + M.shotText() + ')');
  ok(M.urgentTicks === 2 * 60, 'die letzten zwei Sekunden sind als Konstante benannt');
  ok(/sep\.classList\.toggle\('urgent',dringlich\)/.test(HTML) &&
     /const dringlich=laeuft&&rest<=FOOTBALL_SHOT_URGENT_TICKS;/.test(HTML),
     'der dringliche Zustand haengt an derselben Konstante');
  // Der Countdown gehoert EINEM Spieler. Zwischen dem Oeffnen des Fensters und dem
  // naechsten festen Schritt liegt mindestens ein gezeichnetes Bild — ohne diese Frage
  // zeigte es dort den Rest des VORIGEN Spielers oder eine dringliche 0.0.
  ok(/function fbShotShown\(\)\{[\s\S]*?return fbShotFor===who\?fbShotTicks:fbShotCap\(who\);/.test(HTML),
     'die Anzeige zeigt nie den Countdown eines anderen Spielers');
  ok(!/sep\.classList\.toggle\('hold'/.test(HTML),
     'der tote Halt-Zustand ist entfernt — im Halt steht schlicht der Doppelpunkt');
  // Und die drei neuen Knoepfe haengen an derselben Druckreaktion wie alle anderen.
  ok(/'fbFirst3Btn','fbSpeedBtn','fbRuleBack',/.test(HTML),
     'die Regelwahl-Knoepfe haengen an der gemeinsamen Druckreaktion');
  ok(/#game\.fb\.fbspeed \.pcard \.pw\.trouble\{/.test(HTML), 'die Zeitnot hat eine eigene Darstellung');
  ok(/#game\.fb\.fbspeed \.pcard \.pw\{display:block/.test(HTML),
     'die Spielerkarte zeigt im Speed Match ihre Zeile — sonst bleibt sie verborgen');
  ok(/return I18N\.de\.fbSpeedT;/.test(HTML),
     'der Untertitel nennt schlicht die Regel — es gibt keinen Rundenzaehler mehr');
  // §9: die Konten sind jetzt deutlich prominenter — sie beenden im Speed Match das Match
  // und haben damit den Rang eines Punktestands, nicht den einer Fussnote.
  ok(/#game\.fb\.fbspeed \.pcard \.pw\{display:block;font-size:15px/.test(HTML),
     'das Zeitkonto ist gross gesetzt (15 px statt 8.5)');
  ok(/#game\.fb\.fbspeed #card0 \.pw:not\(\.act\):not\(\.trouble\)\{color:var\(--p1\)\}/.test(HTML) &&
     /#game\.fb\.fbspeed #card1 \.pw:not\(\.act\):not\(\.trouble\)\{color:var\(--p2\)\}/.test(HTML),
     'und traegt die Teamfarbe — auf einen Blick klar, wessen Zeit da steht');
  // Ohne die beiden :not() gewaenne die Teamfarbe (zwei IDs) jeden Spezifitaetsvergleich
  // gegen .act und .trouble (eine ID): die Zeitnot bliebe blau, der aktive Spieler
  // unmarkiert. Genau das hat der unabhaengige Review gefunden.
  ok(!/#game\.fb\.fbspeed #card[01] \.pw\{color:var/.test(HTML),
     'die Teamfarbe ueberschreibt die Zustandsfarben nicht');
  ok(/@media\(max-width:380px\)\{\s*#game\.fb\.fbspeed \.pcard \.pw\{font-size:13px\}/.test(HTML),
     'auf schmalen Telefonen bleibt es lesbar, ohne die Leiste zu sprengen');
}

// ══════════════════════════════════════════════════════════════════════════════
// HUD-POLITUR: WENIGER TEXT, DIESELBEN ZAHLEN
// ══════════════════════════════════════════════════════════════════════════════
// Der Spieltest fand die Leiste zu wortreich. Die drei wichtigen Zahlen bleiben gross und
// sichtbar; verschwunden sind ausschliesslich die WIEDERHOLTEN Etiketten davor.
{
  const M = speed();
  // Kein Etikett mehr vor dem Konto — die Zahl steht auf der Karte des Spielers.
  M.setBank(0, 31 * 60);
  ok(M.bankLabel(0) === '0:31', 'die Spielerkarte traegt nur noch die Zahl (' + M.bankLabel(0) + ')');
  ok(!/^(BANK|ZEIT|SÜRE|SHOT)/.test(M.bankLabel(0)), 'ohne wiederholtes Etikett davor');
  // Auch das leere Konto zeigt eine Zahl, kein Wort: die Darstellung spricht die Zeitnot aus.
  M.setBank(0, 0);
  ok(M.bankLabel(0) === '0:00', 'ein leeres Konto zeigt 0:00, kein Textbanner (' + M.bankLabel(0) + ')');
  ok(/#game\.fb\.fbspeed \.pcard \.pw\.trouble\{/.test(HTML),
     'die Zeitnot spricht ueber die Darstellung der 0:00');
  // Die Etiketten sind aus dem laufenden HUD verschwunden.
  ok(!/I18N\.de\.fbBank/.test(HTML), 'das Wort BANK/ZEIT steht nirgends mehr im HUD');
  // Die drei wichtigen Zahlen sind weiterhin da UND gross.
  ok(/#game\.fb\.fbspeed \.pcard \.pw\{display:block;font-size:15px/.test(HTML),
     'beide Zeitkonten bleiben sichtbar und gross');
  ok(/#game\.fb\.fbspeed \.score \.sep\.clk\{font-size:15px/.test(HTML),
     'der zentrale Countdown bleibt gross');
  ok(/\$\('sc0'\)\.textContent=score\[0\]/.test(HTML), 'und der Punktestand steht unveraendert');
}

// ══════════════════════════════════════════════════════════════════════════════
// KURZMELDUNGEN — ZEITNOT UND LETZTE AKTION
// ══════════════════════════════════════════════════════════════════════════════
{
  // Sie sind REIN ANZEIGEND. Keine Zeile der Wertung liest sie.
  const src = HTML.slice(HTML.indexOf('function fbClockDecide'), HTML.indexOf('function fbClockReset'));
  ok(!/fbNotice/.test(src), 'die Wertung liest den Meldungszustand nicht');
  ok(/let fbNotice=''/.test(HTML) && /function fbNoticeFire\(kind\)/.test(HTML),
     'der Meldungszustand ist eine eigene, klar benannte Groesse');
  const tSek = NOTICE_SEK('TROUBLE'), fSek = NOTICE_SEK('FINAL');
  ok(tSek >= 1.4 && tSek <= 1.6, 'die Zeitnot steht 1.4-1.6 s (' + tSek + ' s)');
  ok(fSek >= 1.6 && fSek <= 1.8, 'die letzte Aktion steht 1.6-1.8 s (' + fSek + ' s)');
  // RANGFOLGE: die letzte Aktion ist das wichtigere Ereignis — sie steht laenger UND
  // wiegt optisch schwerer.
  ok(fSek > tSek, 'die letzte Aktion steht laenger als die Zeitnot');
  ok(/#game\.fb \.fbnote\.final\{font-size:11px/.test(HTML) &&
     /#game\.fb \.fbnote\{[\s\S]*?font-size:9\.5px/.test(HTML),
     'und ist rund 15 % groesser gesetzt (11 px gegen 9.5 px)');
  ok(/#game\.fb \.fbnote\.final\.show\{animation:fbfinal/.test(HTML),
     'ihr Eintritt ist spuerbarer');
  ok(!/scale\(1\.[3-9]|scale\([2-9]/.test(HTML.slice(HTML.indexOf('@keyframes fbfinal'),
                                                      HTML.indexOf('@keyframes fbfinal') + 260)),
     'aber ohne Vollbild oder Sprung — hoechstens ein kurzer Anschlag');
}
{
  // ERSTES leeres Konto: Zeitnot-Meldung, Match laeuft weiter.
  const M = speed();
  M.openTurn(); M.setBank(0, 3);
  M.tickN(3);
  ok(M.bank(0) === 0, 'Blaus Konto ist leer');
  ok(M.notice() === 'trouble0', 'die Zeitnot-Meldung erscheint fuer Blau (' + M.notice() + ')');
  ok(M.noticeTicks() > 0 && M.noticeTicks() <= M.noticeTroubleMax, 'und laeuft ab');
  ok(M.winner() === null && M.regOver() === false,
     'das erste leere Konto beendet das Match NICHT');
  // GENAU EINMAL je Spieler: sie kommt nicht wieder.
  M.tickN(M.noticeTroubleMax);
  ok(M.notice() === '', 'nach anderthalb Sekunden ist sie spurlos weg');
  M.openTurn(); M.setAimer(0);
  M.tickN(300);
  ok(M.notice() === '', 'und sie feuert nicht erneut, solange das Konto leer bleibt');
  ok(M.troubleSeen()[0] === true && M.troubleSeen()[1] === false,
     'der Riegel steht nur fuer Blau');
}
{
  // ZWEITES leeres Konto: LETZTE AKTION statt einer zweiten Zeitnot-Meldung.
  const M = speed();
  M.openTurn(); M.setBank(0, 0); M.setBank(1, 2);
  M.setAimer(1);
  M.tickN(2);
  ok(M.bank(1) === 0, 'Rots Konto ist jetzt ebenfalls leer');
  ok(M.regOver() === true, 'damit ist die Regulaerzeit vorbei');
  ok(M.notice() === 'final', 'die Meldung ist LETZTE AKTION, nicht eine zweite Zeitnot');
  ok(/fbFinal:'FINAL PLAY'/.test(HTML) && /fbFinal:'LETZTE AKTION'/.test(HTML),
     'sie ist in beiden Sprachen benannt');
  // Sie unterbricht NICHTS: der laufende Zyklus loest sich vollstaendig auf.
  ok(M.winner() === null, 'sie entscheidet nichts');
  M.setScore(2, 1);
  schiessen(M, +1);
  ok(M.get().phase === 'sim', 'die letzte Aktion fliegt weiter');
  bisTor(M);
  ok(M.score()[0] === 3, 'ihr Tor zaehlt (' + M.score().join(':') + ')');
  torFertig(M);
  ok(M.winner() === 0, 'erst NACH der Aufloesung faellt die Entscheidung');
}
{
  // Gleichstand nach der letzten Aktion -> Golden Goal, unveraendert.
  const M = speed();
  M.setScore(2, 2); M.setBank(0, 0); M.setBank(1, 0);
  M.decide();
  ok(M.golden() === true && M.winner() === null, 'Gleichstand fuehrt weiterhin ins Golden Goal');
}
{
  // Rematch loescht auch den Meldungszustand.
  const M = speed();
  M.openTurn(); M.setBank(0, 1); M.tickN(1);
  ok(M.notice() === 'trouble0', 'Setup: eine Meldung steht');
  M.newMatch();
  ok(M.notice() === '' && M.noticeTicks() === 0, 'das neue Match startet ohne Meldung');
  ok(M.troubleSeen()[0] === false && M.troubleSeen()[1] === false, 'und ohne Riegel');
}
{
  // FIRST TO 3 bleibt frei von der Speed-Match-Zeitanzeige.
  const M = neu();
  ok(M.speed() === false, 'Setup: First to 3');
  ok(M.bankLabel(0) !== '0:45', 'die Karte zeigt kein Zeitkonto (' + M.bankLabel(0) + ')');
  M.openTurn(); M.tickN(120);
  ok(M.notice() === '', 'und es entsteht keine Meldung');
  ok(/#game\.fb\.fbspeed \.pcard \.pw\{display:block/.test(HTML) &&
     /#game\.fb \.pcard \.pw\{display:none\}/.test(HTML),
     'die Zeitzeile haengt an .fbspeed — First to 3 und Tactical bleiben ohne sie');
}
{
  // MOBIL: die Meldung ist absolut positioniert und UNTER die Leiste gehaengt — sie
  // belegt keine Zeile im Layout und verschiebt deshalb keine Zahl.
  ok(/#game\.fb \.fbnote\{position:absolute;left:50%;top:100%/.test(HTML),
     'die Meldung haengt absolut unter der Leiste und verschiebt die Zahlen nicht');
  ok(/#game\.fb \.status\{position:relative\}/.test(HTML),
     'ihr Bezugsrahmen ist die Leiste selbst');
  // "Bewegung reduzieren" muss AUCH den Eintritt der letzten Aktion stoppen.
  ok(/@media\(prefers-reduced-motion:reduce\)\{[\s\S]{0,200}?#game\.fb \.fbnote\.final\.show\{animation:none\}/.test(HTML),
     'bei reduzierter Bewegung laeuft auch der Eintritt der letzten Aktion nicht');
  ok(/white-space:nowrap/.test(HTML.slice(HTML.indexOf('#game.fb .fbnote{'),
                                          HTML.indexOf('#game.fb .fbnote{') + 500)),
     'sie bricht nicht um');
  ok(/@media\(max-width:360px\)/.test(HTML), 'sehr schmale Geraete haben einen eigenen Rueckfall');
  // Und der Klang ist weich: Sinus, Tiefpass, kurz — keine spitzen Toene.
  const sfx = HTML.slice(HTML.indexOf('fbTimeTrouble(){'), HTML.indexOf('// Ring-Collapse-Timer'));
  ok(/o\.type='sine'/.test(sfx) && !/sawtooth|square/.test(sfx), 'die Akzente sind Sinus, nicht schneidend');
  ok(/lp\.frequency\.value=900/.test(sfx), 'und laufen durch einen Tiefpass bei 900 Hz');
}

// ══════════════════════════════════════════════════════════════════════════════
// DER LEBENSLAUF DER KURZMELDUNG
// ══════════════════════════════════════════════════════════════════════════════
// Befunde des unabhaengigen Reviews. Alle drei sind Anzeigefehler, keine Regelfehler —
// aber sie treffen genau das, was dieser Pass verspricht: ein kurzes Ereignis, das
// spurlos verschwindet und genau einmal klingt.
{
  // 1. Die Meldung haengt NICHT am Countdown-Schluessel. Sonst bliebe sie waehrend eines
  //    langen Ballflugs stehen, obwohl ihre Zeit abgelaufen ist.
  const paint = HTML.slice(HTML.indexOf('function fbClockPaint'), HTML.indexOf('function fbNoticeText'));
  const vorReturn = paint.slice(0, paint.indexOf('return'));
  ok(/fbNoticePaint\(\);/.test(vorReturn),
     'die Meldung wird VOR jedem fruehen Ruecksprung angestrichen');
  ok((paint.match(/fbNoticePaint\(\)/g) || []).length === 1,
     'und zwar genau einmal je Bild');
  // 2. Ausserhalb des Speed Match raeumt sie sich ab, statt frueh zurueckzukehren.
  const np = HTML.slice(HTML.indexOf('function fbNoticePaint'), HTML.indexOf('let fbBankShown'));
  ok(/const an=typeof fbSpeed==='function'&&fbSpeed\(\)&&!!fbNotice;/.test(np) &&
     !/if\(typeof fbSpeed!=='function'\|\|!fbSpeed\(\)\)return;/.test(np),
     'ausserhalb des Speed Match wird sie abgeraeumt, nicht uebersprungen');
  ok(/el\.classList\.toggle\('show',an\)/.test(np), 'die show-Klasse folgt diesem Zustand');
  // 3. Der Klang haengt am WECHSEL des angezeigten Zustands — und updateHud loescht den
  //    Meldungsschluessel nicht mehr, sonst schluege dieselbe Meldung ein zweites Mal an.
  ok(/const neu=an&&fbNoticeShown!==key;/.test(np) && /if\(neu&&/.test(np),
     'der Klang haengt am echten Wechsel, nicht am Neuaufbau des HUD');
  ok(!/fbNoticeShown='';/.test(HTML.slice(HTML.indexOf('function updateHud'),
                                          HTML.indexOf('function updateHud') + 3000)),
     'updateHud setzt den Meldungsschluessel nicht zurueck');
}
{
  // 4. Die 0:00 ist in der Zeitnot die WICHTIGSTE Zahl — sie darf nicht schrumpfen.
  const tr = HTML.slice(HTML.indexOf('#game.fb.fbspeed .pcard .pw.trouble{'),
                        HTML.indexOf('@keyframes fbnot'));
  ok(!/font-size/.test(tr), 'die Zeitnot verkleinert die Zahl nicht');
  ok(/color:rgba\(255,138,120/.test(tr) && /animation:fbnot/.test(tr),
     'sie unterscheidet sich ueber Farbe und einen ruhigen Puls');
  ok(!/\.pw\.trouble\{font-size/.test(HTML), 'auch in keiner Media-Query');
  // 5. Die toten Etiketten sind aus allen drei Sprachtafeln entfernt.
  ok(!/fbBank:'/.test(HTML), 'kein fbBank-Schluessel mehr in irgendeiner Sprachtafel');
  // 6. Die Klaenge sind kurz — und die Dauer im Kommentar stimmt mit dem Code ueberein.
  const sfx = HTML.slice(HTML.indexOf('fbTimeTrouble(){'), HTML.indexOf('// Ring-Collapse-Timer'));
  const stops = (sfx.match(/o\.stop\(t\+d\+\.(\d+)\)/g) || []);
  ok(stops.length === 2, 'beide Akzente haben ein festes Ende');
  ok(/Zeitnot 0\.33 s, letzte Aktion 0\.40 s/.test(HTML),
     'und die genannte Dauer ist die tatsaechliche');
}

// ══════════════════════════════════════════════════════════════════════════════
// QUERFORMAT: DIE LEISTE RUECKT NACH OBEN
// ══════════════════════════════════════════════════════════════════════════════
// Der Spieltest fand die Leiste im Querformat zu tief — sie verdeckte Spielfeld. Die
// Ursache war nicht ihre Groesse, sondern die Kopfzeile darueber. Korrigiert wurde die
// POSITION; alle Zahlen behalten ihre Groesse.
{
  const lq = HTML.slice(HTML.indexOf('@media(orientation:landscape) and (max-height:520px)'),
                        HTML.indexOf('/* Sehr schmale Geraete (320 px)'));
  ok(lq.length > 100, 'es gibt eine eigene Querformat-Regel');
  ok(/#game\.fb header\{position:absolute/.test(lq),
     'die Kopfzeile verlaesst dort den Fluss');
  ok(/#game\.fb header \.gtitle\{display:none\}/.test(lq),
     'der Schriftzug entfaellt im Querformat');
  // §6: keine geratenen Festwerte, die nur zu einem Geraet passen.
  ok(/env\(safe-area-inset-top/.test(lq) && /env\(safe-area-inset-right/.test(lq),
     'Notch und Systemleiste werden ueber env(safe-area-inset-*) beruecksichtigt');
  ok(/max\(2px,env\(safe-area-inset-top,0px\)\)/.test(lq),
     'mit einem Mindestabstand statt eines festen Offsets');
  // Die Zahlen selbst werden dort NICHT verkleinert — das war ausdruecklich verboten.
  ok(!/font-size/.test(lq), 'im Querformat wird keine einzige Zahl verkleinert');
  // §5: das Hochformat bleibt unberuehrt — die Regel greift nur bei liegender Ausrichtung
  // und niedriger Hoehe.
  ok(/@media\(orientation:landscape\) and \(max-height:520px\)/.test(HTML),
     'die Regel ist auf das Querformat beschraenkt');
  // Die Meldung haengt an der LEISTE, nicht am Bildschirmrand — dadurch sitzt sie in
  // beiden Ausrichtungen richtig und wird nirgends angeschnitten.
  ok(/#game\.fb \.status\{position:relative\}/.test(HTML),
     'die Statusleiste ist der Bezugsrahmen der Meldung');
  ok(/#game\.fb \.fbnote\{position:absolute;left:50%;top:100%;margin-top:5px/.test(HTML),
     'und die Meldung sitzt darunter, ohne geratene Pixelzahl');
  // §7: die drei wichtigen Zahlen sind unveraendert vorhanden und gross.
  ok(/#game\.fb\.fbspeed \.pcard \.pw\{display:block;font-size:15px/.test(HTML),
     'beide Zeitkonten bleiben gross');
  ok(/#game\.fb\.fbspeed \.score \.sep\.clk\{font-size:15px/.test(HTML),
     'der zentrale Countdown bleibt gross');
  ok(!/fbBank:'/.test(HTML), 'und es sind keine Etiketten zurueckgekehrt');
}

console.log(NL + 'Football-Classic-Regeln: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
