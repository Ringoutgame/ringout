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
const postProbeSrc = grab(/function footballPostProbe\(b\)\{[\s\S]*?\n\}/, 'footballPostProbe');
const wedgeSrc = grab(/const FOOTBALL_WEDGE_MIN_CONTACTS=[\s\S]*?\nfunction footballEscape\(b,cs\)\{[\s\S]*?\n\}/, 'wedge block');
const goalClearHalfSrc = grab(/function footballGoalClearHalf\([^\n]*/, 'footballGoalClearHalf');
const goalCenterHalfSrc = grab(/function footballGoalCenterHalf\([^\n]*/, 'footballGoalCenterHalf');
const goalCanPassSrc = grab(/function footballCanPassGoal\(b\)\{[\s\S]*?\n\}/, 'footballCanPassGoal');
const resolvePostSrc = grab(/function footballResolvePost\(b\)\{[\s\S]*?\n\}/, 'footballResolvePost');
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
const canCommitSrc = grab(/function canCommitInput\(who\)\{[\s\S]*?\n\}/, 'canCommitInput');
const npSrc = grab(/function np\([^\n]*/, 'np');
const resetCommitsSrc = grab(/function resetCommits\(\)\{[\s\S]*?\n\}/, 'resetCommits');
const startRoundSrc = grab(/function startRound\(\)\{[\s\S]*?\n\}/, 'startRound');

function buildEnv(startMode, startFmt, startPreset) {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${consts}
    ${spin}
    ${pcols}
    // Kein Browser-TUNE-Override im Harness — curFE/curST greifen darauf zurueck.
    const TUNE=null;
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', outBall=-1, roundWinner=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false;
    let mode=${JSON.stringify(startMode)}, fmt=${JSON.stringify(startFmt)};
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},
           footballGoal(mp){goalAudio.plays++;if(mp)goalAudio.matchPoints++;},
           footballGoalPreload(){goalAudio.preloads++;},footballGoalStop(){goalAudio.stops++;}};
const goalAudio={plays:0,matchPoints:0,preloads:0,stops:0};   // Tor-Audio: Aufrufzaehler statt echter Ausgabe
    function spawn(){} function popBall(){} function winnerRGB(){return '';}
    let r3dActive=false; function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;} function updateHud(){} function setPhaseText(){}
    function onlineArmTurn(){} function openCover(){}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    // Bestehende Result-Struktur: im Browser DOM-lastig, hier als reiner Recorder.
    // Sie setzt exakt das, worauf der Football-Resultzustand sich verlaesst: phase='over'.
    let gameOverCalls=[];
    function gameOver(w){gameOverCalls.push(w);phase='over';}
    let score=[0,0], roundNo=1;
    let collapseEnabled=false, collapseState='running';
    function collapseActive(){return false;}
    function cancelAimDrag(){cancelDragCalls++;}
    let cancelDragCalls=0;
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
      // Effektive Physik, wie stepSim sie sieht — geht durch dieselben Accessoren.
      effective(){ return {fr:curFR(), fe:curFE(), stopv:curST(), slowv:curSLOWV(),
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
      get(){ return { phase, balls: balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,alive:b.alive,owner:b.owner})) }; }
    };
  `;
  return new Function(env)();
}

// ── Football-Setup: genau drei Kugeln, symmetrisch ──
const F = buildEnv('football', 'single');
const fb = F.place();
ok(fb.length === 3, 'Football stellt genau drei Kugeln auf (erhalten: ' + fb.length + ')');
ok(JSON.stringify(fb.map(b => b.owner)) === JSON.stringify([0, 1, 4]), 'Football-Owner sind [0,1,4] (Blau/Rot/neutral)');
const blue = fb.find(b => b.owner === 0), red = fb.find(b => b.owner === 1), neutral = fb.find(b => b.owner === 4);
ok(blue && blue.x < F.cx, 'Blau startet links (x<cx)');
ok(red && red.x > F.cx, 'Rot startet rechts (x>cx)');
ok(neutral && neutral.x === F.cx && neutral.y === F.cy, 'neutraler Ball startet mittig');

// ── neutraler Ball ist nicht auswählbar ──
F.setBalls(fb.map(b => ({ x: b.x, y: b.y, owner: b.owner })));
const pickBlueAtNeutral = F.pick(0, { x: F.cx, y: F.cy });   // Pointer auf dem neutralen Ball, Spieler Blau
ok(pickBlueAtNeutral < 0 || fb[pickBlueAtNeutral].owner !== 4, 'Blau kann den neutralen Ball nicht wählen');
const pickRedAtNeutral = F.pick(1, { x: F.cx, y: F.cy });
ok(pickRedAtNeutral < 0 || fb[pickRedAtNeutral].owner !== 4, 'Rot kann den neutralen Ball nicht wählen');
const pickOwnBlue = F.pick(0, { x: blue.x, y: blue.y });     // Pointer auf der eigenen Kugel
ok(pickOwnBlue >= 0 && fb[pickOwnBlue].owner === 0, 'Blau kann die eigene Kugel wählen');

// ── Football: geschlossene Rounded-Rectangle-Bande statt Ring-Out ──
// Spielerkugel direkt an der Laengsbande mit Schwung nach aussen: sie bleibt innerhalb
// der um BR nach innen versetzten Grenze (footballBoundSD <= 0) und lebt weiter.
F.setBalls([{ x: F.cx, y: F.cy + F.halfWid() - F.BR, vx: 0, vy: 6, owner: 0 }, { x: F.cx, y: F.cy, owner: 4 }]);
let fMaxSd = -Infinity;
for (let i = 0; i < 40; i++) { F.step(); fMaxSd = Math.max(fMaxSd, F.boundSD(F.get().balls[0]).sd); }
const fAfter = F.get();
ok(fMaxSd <= 1e-6, 'Football hält die Kugel innerhalb der Bande (max sd ' + fMaxSd.toFixed(4) + ' <= 0)');
ok(fAfter.balls.every(b => b.alive), 'Football eliminiert keine Kugel (kein Ring-Out)');

// ════════════════════════════════════════════════════════════════════════════
// PHYSIKPHASE 1 — TORPASSAGE: neutraler Ball darf durch, Spieler nie.
// Rein numerisch (keine Renderer-/GLB-Abfrage), beide Tore spiegelsymmetrisch.
// KEINE Goal Detection, kein Score, kein Reset — nur die Grenzentscheidung.
// ════════════════════════════════════════════════════════════════════════════

// ── A. KANONISCHE GEOMETRIE (auf BALLHOEHE: Marmor-Sockel des GERADEN Tors) ──
// Alle Werte stammen aus FOOTBALL_ARENA (gerades Tor-Asset, 1 Blender-Einheit == 2*BR):
// postInner 3.560*BR = 113.92 (lichte Halbbreite), postOuter 5.282*BR, Sockeltiefe
// 2*FB_GOAL_HALF_DEPTH = 2.368*BR. Der neutrale Ball hat den eigenen Produktivradius
// fbBallR() = 25 (FOOTBALL_BALL_RADIUS), die Spieler bleiben BR = 32.
const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 1e-9 : eps);
ok(near(F.clearHalf(), 3.560 * F.BR), 'Lichte Halbbreite auf Ballhoehe = 3.560*BR = ' + (3.56 * F.BR).toFixed(2) + ' LOGICAL (Sockel-Innenkante 1.780 Blender)');
ok(near(F.neutralR(), 25), 'Neutraler Ball traegt den Produktivradius FOOTBALL_BALL_RADIUS = 25');
ok(near(F.centerHalf(), 3.560 * F.BR - F.neutralR()), 'Nutzbare Zentrums-Halbbreite = 3.560*BR - fbBallR = ' + (3.56 * F.BR - 25).toFixed(2));
ok(near(F.clearHalf() - F.centerHalf(), F.neutralR()), 'Reduktion ist exakt der Radius des NEUTRALEN Balls (keine erfundene Clearance)');
// Sockel-Fussabdruck als Rechteck: tangential aus den gemessenen Sockelkanten des geraden
// Tors, in Torrichtung postFront==halfLen (Sockelvorderkante auf der Bandeninnenflaeche)
// bis postBack = halfLen + 2*FB_GOAL_HALF_DEPTH.
{ const bx = F.box();
  ok(near(bx.y0, 3.560 * F.BR), 'Sockel-Innenkante = 3.560*BR = ' + bx.y0.toFixed(2) + ' (1.780 Blender)');
  ok(near(bx.y1, 5.282 * F.BR), 'Sockel-Aussenkante = 5.282*BR = ' + bx.y1.toFixed(2) + ' (2.641 Blender)');
  ok(near(bx.x0, 18.00 * F.BR), 'Sockel-Vorderkante = halfLen = 18.00*BR = ' + bx.x0.toFixed(1));
  ok(near(bx.x1, (18.00 + 2 * 1.184) * F.BR), 'Sockel-Hinterkante = halfLen + 2*1.184 = 20.368*BR = ' + bx.x1.toFixed(3));
  ok(bx.x0 < bx.x1 && bx.y0 < bx.y1, 'Sockel-Rechteck ist nicht degeneriert');
  // TORINTEGRATION: postFront == halfLen — die Sockelvorderkante liegt EXAKT auf der
  // Bandeninnenflaeche. Eine Ballmitte im Feld kommt hoechstens bis halfLen-r; der
  // naechste Sockelpunkt ist dann genau r entfernt -> keine Ballfang-Tasche neben dem Tor.
  ok(near(bx.x0, F.halfLen()), 'postFront == halfLen: Sockelvorderkante exakt auf der Bandeninnenflaeche');
  // KONSISTENZ: Gate und Sockel beschreiben exakt dieselbe lichte Weite.
  ok(near(bx.y0 - F.neutralR(), F.centerHalf()), 'Sockel-Innenkante - fbBallR == nutzbare Zentrums-Halbbreite — eine einzige Geometrie');
  ok(near(bx.y0, F.clearHalf()), 'Sockel-Innenkante == lichte Halbbreite');
  // Spiegelsymmetrie: boxGap haengt nur von |x-cx| und |y-cy| ab -> vier identische Sockel.
  const probe = { x: F.cx + 400, y: F.cy + 130 };
  const g = F.boxGap(probe);
  for (const sx of [+1, -1]) for (const sy of [+1, -1])
    ok(near(F.boxGap({ x: F.cx + sx * 400, y: F.cy + sy * 130 }), g, 1e-9),
      'Sockelgeometrie identisch bei (' + (sx > 0 ? '+X' : '-X') + ',' + (sy > 0 ? '+y' : '-y') + ') — vollstaendig gespiegelt'); }
// Beide Tore identisch: die Pruefung haengt nur an |y-cy| -> +X und -X sind zwangslaeufig gleich breit.
ok(F.canPass({ owner: 4, x: F.cx + 400, y: F.cy + F.centerHalf() }) === F.canPass({ owner: 4, x: F.cx - 400, y: F.cy + F.centerHalf() }),
  'Beide Torhalbbreiten identisch (+X und -X spiegelsymmetrisch)');
// Renderer-/GLB-Unabhaengigkeit: die Physikfunktionen referenzieren nichts aus der 3D-Schicht.
const goalPhysSrc = halfDepthSrc + arenaSrc +
  goalClearHalfSrc + goalCenterHalfSrc + goalCanPassSrc + postProbeSrc + resolvePostSrc;
ok(!/THREE|goalGroup|goalScale|GLB_R|scene|renderer|camera|geometry|boundingBox|\.glb/i.test(goalPhysSrc),
  'Tor-/Pfostenphysik ohne jede Renderer-/GLB-/Mesh-/Bounding-Box-Abfrage');
ok(/BR/.test(goalClearHalfSrc) && /\*BR/.test(postProbeSrc), 'Alle Torgroessen aus BR abgeleitet');
// Keine rohen LOGICAL-Pixelwerte im Physikcode — nur asset-dokumentierte Blender-Verhaeltnisse.
ok(!/\b(128|256|96|105\.6|73\.6|142\.8|37\.2|180)\b/.test(goalPhysSrc),
  'Keine rohen LOGICAL-Magic-Numbers in der Tor-/Pfostenphysik');
ok(/3\.560/.test(arenaSrc) && /5\.282/.test(arenaSrc) && /1\.184/.test(halfDepthSrc),
  'Sockelkanten dokumentiert aus dem eingefrorenen Blender-Build abgeleitet (3.560/5.282/1.184)');
ok(/postBack:18\.00\+2\*FB_GOAL_HALF_DEPTH/.test(arenaSrc),
  'Sockel-Hinterkante als Formel aus halfLen + Sockeltiefe (keine zweite Zahl)');

// ── B. NEUTRALER BALL: Passage ──
// Helfer: schiesst EINEN Ball entlang der Torachse und meldet, ob er die Bande verlassen
// hat. dirX = +1 -> +X-Tor, -1 -> -X-Tor. offY = tangentiale Ablage des Ballzentrums.
// Ab Gameplayphase 2 setzt ein gueltiges Tor die Runde zurueck — die ENDposition ist danach
// wieder die Startposition. Massgeblich fuer "hat der Ball die Arena verlassen?" ist deshalb
// der GROESSTE waehrend des Fluges erreichte Torachsen-Abstand |x-cx|, nicht die Endlage.
function shoot(owner, dirX, offY, speed, startFrac) {
  const sf = startFrac == null ? 0.55 : startFrac;
  F.setBalls([{ x: F.cx + dirX * F.halfLen() * sf, y: F.cy + offY, vx: dirX * (speed == null ? 5 : speed), vy: 0, owner }]);
  let maxDx = 0, peak = null;
  for (let i = 0; i < 300; i++) {
    F.step();
    const b = F.get().balls[0];
    const dd = Math.abs(b.x - F.cx);
    if (dd > maxDx) { maxDx = dd; peak = b; }
  }
  const b = F.get().balls[0];
  return { dist: maxDx, b: peak || b, endBall: b };
}
const OUT = F.halfLen() + F.neutralR();          // eindeutig ausserhalb der Stirnbande
const NEUTRAL_LIM = F.halfLen() - F.neutralR();  // Reflexionsgrenze der Ballmitte (neutral)
const PLAYER_LIM = F.halfLen() - F.BR;           // Reflexionsgrenze der Ballmitte (Spieler)

const nPlus = shoot(4, +1, 0, 5);
ok(nPlus.dist > OUT, 'Neutraler Ball passiert das +X-Tor zentral (dist ' + nPlus.dist.toFixed(1) + ' > ' + OUT.toFixed(1) + ')');
const nMinus = shoot(4, -1, 0, 5);
ok(nMinus.dist > OUT, 'Neutraler Ball passiert das -X-Tor zentral (dist ' + nMinus.dist.toFixed(1) + ' > ' + OUT.toFixed(1) + ')');
// Knapp INNERHALB der nutzbaren Seitenkante -> muss passieren (beide Tore, beide Seiten).
for (const dir of [+1, -1]) for (const sgn of [+1, -1]) {
  const r = shoot(4, dir, sgn * (F.centerHalf() - 1), 5);
  ok(r.dist > OUT, 'Neutraler Ball passiert knapp innerhalb der Seitenkante (Tor ' + (dir > 0 ? '+X' : '-X') + ', y' + (sgn > 0 ? '+' : '-') + ')');
}
// Auf Hoehe des Sockelkoerpers (ab lichter Halbbreite) -> blockiert. Da postFront==halfLen,
// haelt hier bereits die geschlossene Stirnbande: die Ballmitte kommt nie ueber halfLen-r.
for (const dir of [+1, -1]) for (const sgn of [+1, -1]) {
  const r = shoot(4, dir, sgn * F.clearHalf(), 5);
  ok(r.dist <= NEUTRAL_LIM + 1e-6, 'Neutraler Ball wird neben der Oeffnung blockiert (Tor ' + (dir > 0 ? '+X' : '-X') + ', y' + (sgn > 0 ? '+' : '-') + ')');
}
// Ausserhalb der Tore (tangential weit weg, im Eckbogenbereich) bleibt die Bande geschlossen.
const nBand = shoot(4, +1, 250, 5);
ok(nBand.dist <= NEUTRAL_LIM + 1e-6, 'Neutraler Ball prallt ausserhalb der Toroeffnung an der Bande ab');
// Neutraler Ball senkrecht zur Torachse (Richtung +Y) -> geschlossene Laengsbande.
F.setBalls([{ x: F.cx, y: F.cy + 300, vx: 0, vy: 6, owner: 4 }]);
let nUpMax = 0;
for (let i = 0; i < 300; i++) { F.step(); const b = F.get().balls[0];
  nUpMax = Math.max(nUpMax, Math.abs(b.y - F.cy)); }
ok(nUpMax <= F.halfWid() - F.neutralR() + 1e-6, 'Neutraler Ball wird quer zur Torachse von der Laengsbande gehalten');
// Diagonaler Eintritt, der INNERHALB des Torfensters ankommt -> Passage.
F.setBalls([{ x: F.cx + F.halfLen() * 0.30, y: F.cy - F.halfWid() * 0.30, vx: 5, vy: 2.6, owner: 4 }]);
let nDiagMax = 0;
for (let i = 0; i < 300; i++) { F.step(); const b = F.get().balls[0];
  nDiagMax = Math.max(nDiagMax, Math.abs(b.x - F.cx)); }
ok(nDiagMax > OUT, 'Neutraler Ball passiert diagonal innerhalb der Oeffnung');
// Schneller Ball: Microsteps duerfen die seitliche Torbegrenzung nicht ueberspringen.
const nFastIn = shoot(4, +1, 0, 12);
ok(nFastIn.dist > OUT, 'Schneller neutraler Ball passiert das Tor zentral (kein verpasster Sub-Step)');
const nFastOut = shoot(4, +1, F.clearHalf() + 4, 12);
ok(nFastOut.dist <= NEUTRAL_LIM + 1e-6, 'Schneller neutraler Ball tunnelt NICHT neben der Toroeffnung durch die Bande');
// Nach der Passage keine kuenstliche Rueckreflexion: Geschwindigkeit bleibt nach aussen gerichtet.
ok(nPlus.b.vx > 0, 'Neutraler Ball behaelt nach der +X-Passage seine Auswaertsrichtung (keine Rueckreflexion)');
ok(nMinus.b.vx < 0, 'Neutraler Ball behaelt nach der -X-Passage seine Auswaertsrichtung (keine Rueckreflexion)');
// Auch mit tangentialer Drift ausserhalb wird er nicht wieder eingefangen (Latch fbPassed).
F.setBalls([{ x: F.cx + F.halfLen() * 0.55, y: F.cy, vx: 5, vy: 1.2, owner: 4 }]);
let nDriftMax = 0, nDrift = null;
for (let i = 0; i < 400; i++) { F.step(); const b = F.get().balls[0];
  const dd = Math.abs(b.x - F.cx); if (dd > nDriftMax) { nDriftMax = dd; nDrift = b; } }
ok(nDriftMax > OUT, 'Ausgetretener neutraler Ball wird trotz tangentialer Drift nicht zurueckgefangen');
// Er bleibt am Leben und wird NICHT als Ring-Out behandelt.
// phase darf regulaer nach 'aim' settlen (Ball kommt zur Ruhe) — nur 'result' waere ein Rundenende.
ok(nDrift.alive && F.get().phase !== 'result', 'Ausgetretener neutraler Ball bleibt am Leben (kein Ring-Out, kein Rundenende)');

// ── B2. TORPFOSTEN (Marmor-Sockel als Rechteck-Kollider) ──
// Verfolgt ueber den GESAMTEN Flug den kleinsten Abstand der Ballmitte zum Sockel-Rechteck.
// Faellt er unter den Ballradius (radOf), steckt der Ball im Marmor -> Durchdringung.
// Seit postFront==halfLen gilt zusaetzlich: eine Ballmitte IM Feld kann den Sockel nie
// beruehren — der Minimalabstand ist konstruktionsbedingt exakt der Ballradius.
function fly(owner, start, vel, steps) {
  F.setBalls([{ x: start.x, y: start.y, vx: vel.vx, vy: vel.vy, owner }]);
  let minGap = Infinity, maxDx = 0;
  for (let i = 0; i < (steps || 400); i++) {
    F.step();
    const b = F.get().balls[0];
    minGap = Math.min(minGap, F.boxGap(b));
    maxDx = Math.max(maxDx, Math.abs(b.x - F.cx));
  }
  const b = F.get().balls[0];
  return { minGap, b, dist: maxDx };
}
const PEN_EPS = 1e-6;                        // numerische Toleranz
const ESCAPED = OUT;                         // eindeutig ausserhalb der Arena
const radOf = (owner) => owner === 4 ? F.neutralR() : F.BR;   // Radius wie ballRad(b)
// Entlang der Torachse nach aussen auf ein Tor zu, mit tangentialem Versatz offY.
const shootGoal = (owner, dir, offY, speed, steps) =>
  fly(owner, { x: F.cx + dir * F.halfLen() * 0.45, y: F.cy + offY }, { vx: dir * speed, vy: 0 }, steps);

// Zentraler Durchtritt bleibt frei — beide Tore, ohne jede Sockelberuehrung.
for (const dir of [+1, -1]) {
  const r = shootGoal(4, dir, 0, 5);
  ok(r.dist > ESCAPED, 'Neutraler Ball passiert ' + (dir > 0 ? '+X' : '-X') + '-Tor mittig (Sockel stoeren nicht)');
  ok(r.minGap > radOf(4), 'Mittiger Durchtritt ohne Sockelberuehrung (Gap ' + r.minGap.toFixed(1) + ')');
}
// Schuss AUF die Sockelmitte: da die Sockelvorderkante exakt auf der Bandeninnenflaeche
// liegt, haelt die Bande den Ball bei halfLen-r — der Marmor wird nie penetriert und der
// Minimalabstand faellt nie unter den Ballradius. Linker UND rechter Sockel, beide Tore.
const POST_MID = (F.box().y0 + F.box().y1) / 2;      // 4.421*BR, Mitte des Sockelkoerpers
for (const dir of [+1, -1]) for (const sgn of [+1, -1]) {
  const side = (sgn > 0 ? 'linker' : 'rechter') + ' Sockel ' + (dir > 0 ? '+X' : '-X');
  const r = shootGoal(4, dir, sgn * POST_MID, 5);
  ok(r.minGap >= radOf(4) - PEN_EPS, 'Treffer ' + side + ': keine Penetration (min Gap ' + r.minGap.toFixed(2) + ' >= r ' + radOf(4) + ')');
  ok(r.dist <= NEUTRAL_LIM + 1e-6, 'Treffer ' + side + ': Ball prallt ab und kommt nicht durch (dist ' + r.dist.toFixed(1) + ')');
}
// Gespiegeltes Verhalten: +X und -X liefern identische Distanzen (Betrag).
{ const a = shootGoal(4, +1, POST_MID, 5), b = shootGoal(4, -1, -POST_MID, 5);
  ok(near(a.dist, b.dist, 1e-9), 'Sockeltreffer an +X und -X exakt gespiegelt identisch'); }
// Diagonaler Beschuss Richtung Sockel-/Eckbereich.
{ const r = fly(4, { x: F.cx + F.halfLen() * 0.30, y: F.cy - F.halfWid() * 0.10 }, { vx: 5, vy: 3.6 });
  ok(r.minGap >= radOf(4) - PEN_EPS, 'Diagonaler Beschuss: keine Penetration (min Gap ' + r.minGap.toFixed(2) + ')'); }
// Schneller Beschuss -> kein Tunneling (Spielmaximum liegt bei ~6.6/Sub-Step).
for (const sp of [8, 12, 20, 40]) {
  const r = shootGoal(4, +1, POST_MID, sp);
  ok(r.minGap >= radOf(4) - PEN_EPS, 'Schneller Sockelbeschuss v=' + sp + ' tunnelt nicht (min Gap ' + r.minGap.toFixed(2) + ')');
  ok(r.dist <= NEUTRAL_LIM + 1e-6, 'Schneller Sockelbeschuss v=' + sp + ' kommt nicht durch');
}
// Ball knapp INNERHALB der nutzbaren Weite passiert — bei jeder Geschwindigkeit.
for (const sp of [5, 12, 20]) {
  const r = shootGoal(4, +1, F.centerHalf() - 0.5, sp);
  ok(r.dist > ESCAPED, 'Ball knapp frei neben dem Sockel passiert (v=' + sp + ')');
  ok(r.minGap >= radOf(4) - PEN_EPS, 'Knappe Passage bleibt beruehrungsfrei (v=' + sp + ', Gap ' + r.minGap.toFixed(2) + ')');
}
// Ball auf Hoehe des Sockelkoerpers (ab lichter Halbbreite aufwaerts) kommt bei keiner
// Geschwindigkeit durch und penetriert nie.
for (const sp of [5, 12, 20]) for (const off of [F.clearHalf(), POST_MID, F.box().y1 - 2]) {
  const r = shootGoal(4, +1, off, sp);
  ok(r.dist <= NEUTRAL_LIM + 1e-6, 'Ball auf den Sockelkoerper (off ' + off.toFixed(1) + ', v=' + sp + ') kommt nicht durch');
  ok(r.minGap >= radOf(4) - PEN_EPS, 'Ball auf den Sockelkoerper (off ' + off.toFixed(1) + ', v=' + sp + ') dringt nicht ein');
}
// KEINE Penetration ueber das gesamte Streifband — Oeffnung, Innenkante, Sockel, Bande.
for (let off = 0; off <= 220; off += 4) for (const sp of [5, 12, 20]) {
  const r = shootGoal(4, +1, off, sp, 300);
  if (r.minGap < radOf(4) - PEN_EPS) ok(false, 'Penetration bei off=' + off + ' v=' + sp + ' (Gap ' + r.minGap.toFixed(3) + ')');
}
ok(true, 'Kein Startversatz 0..220 bei v=5/12/20 erzeugt eine Marmor-Penetration');
// Auch Spielerkugeln duerfen nicht im Marmor stecken.
for (const owner of [0, 1]) for (const dir of [+1, -1]) {
  const r = shootGoal(owner, dir, POST_MID, 6);
  ok(r.minGap >= radOf(owner) - PEN_EPS, (owner === 0 ? 'Blauer' : 'Roter') + ' Spieler dringt nicht in den Sockel ein (' + (dir > 0 ? '+X' : '-X') + ')');
  ok(r.dist <= PLAYER_LIM + 1e-6, (owner === 0 ? 'Blauer' : 'Roter') + ' Spieler bleibt am Sockel in der Arena (' + (dir > 0 ? '+X' : '-X') + ')');
}
// Reflexionslogik an der Stirnbande vor dem Sockel: Normalanteil (vx) kehrt sich um,
// Tangentialanteil (vy) bleibt erhalten — dissipativ ueber curRestBand().
{ F.setBalls([{ x: F.cx + NEUTRAL_LIM - 12, y: F.cy + POST_MID, vx: 5, vy: 3, owner: 4 }]);
  let hit = null;
  for (let i = 0; i < 6 && !hit; i++) { F.step(); const b = F.get().balls[0]; if (b.vx < 0) hit = b; }
  ok(hit !== null, 'Frontaler Treffer auf die Stirnbande kehrt den Normalanteil (vx) um');
  if (hit) {
    ok(Math.abs(hit.vx) < 5, 'Reflexion ist dissipativ (kein Energiegewinn: |vx| ' + Math.abs(hit.vx).toFixed(2) + ' < 5)');
    ok(hit.vy > 0, 'Tangentialanteil (vy) bleibt in seiner Richtung erhalten');
  } }
// Der Sockel bleibt HINTER der Torlinie ein echtes Hindernis: ein durch die Oeffnung
// ausgetretener Ball, der tangential in die Sockelunterkante driftet, wird mit
// curRestPost() reflektiert (footballResolvePost gilt auch fuer ausgetretene Baelle).
{ F.setBalls([{ x: F.cx + 610, y: F.cy, vx: 0, vy: 3, owner: 4 }]);
  let hit = null, preVy = 3, minG = Infinity;
  for (let i = 0; i < 40 && !hit; i++) {
    const pre = F.get().balls[0];
    F.step();
    const b = F.get().balls[0];
    minG = Math.min(minG, F.boxGap(b));
    if (b.vy < 0) { hit = b; preVy = pre.vy; }
  }
  ok(hit !== null, 'Ausgetretener Ball prallt am Sockel hinter der Linie ab (vy kehrt um)');
  if (hit) {
    const ratio = Math.abs(hit.vy) / preVy;
    ok(ratio > 0.3 && ratio < 0.7, 'Sockelabprall nutzt curRestPost()~0.50 (Verhaeltnis ' + ratio.toFixed(3) + ')');
    ok(minG >= radOf(4) - PEN_EPS, 'Auch hinter der Linie keine Sockelpenetration (min Gap ' + minG.toFixed(2) + ')');
  } }
// fbPassed darf bei einem Schuss neben die Oeffnung NIE entstehen -> Ball bleibt drinnen.
{ const r = shootGoal(4, +1, POST_MID, 6, 400);
  ok(r.dist <= NEUTRAL_LIM + 1e-6, 'Blockierter Schuss setzt kein fbPassed (Ball bleibt drinnen)'); }
// Quelltext-Invarianten der Phase 1B.
ok(/if\(footballResolvePost\(fb\)\)continue;/.test(HTML), 'Pfostenkollision laeuft VOR der Grenzentscheidung und beendet den Sub-Step');
ok(HTML.indexOf('footballResolvePost(fb)') < HTML.indexOf('if(fb.fbPassed){footballTryGoal(fb);continue;}'), 'Pfostenpruefung steht vor dem fbPassed-Latch');
ok((HTML.match(/footballResolvePost\(/g) || []).length === 3, 'Genau eine Definition + zwei Aufrufe von footballResolvePost (keine zweite Pfostenlogik)');
// 4B-2: die Formel ist unveraendert, nur der eingesetzte Restitutionswert kommt jetzt
// aus der zentralen Kontaktart-Auswahl. Ohne Football-Preset liefert sie exakt REST —
// die urspruengliche Aussage "keine neue Bounciness" gilt damit weiterhin fuer CURRENT
// und fuer jeden Nicht-Football-Modus (Laufzeitnachweis in Abschnitt B/C).
ok(/\(1\+e\)\*vn\*nx/.test(resolvePostSrc) && /\(1\+e\)\*vn\*ny/.test(resolvePostSrc) &&
   /const e=curRestPost\(\);/.test(resolvePostSrc),
  'Sockelreflexion nutzt unveraenderte Formel mit e=curRestPost() (kontaktartabhaengige Restitution)');
ok(!/REST\s*=|REST\*\s*[0-9]/.test(resolvePostSrc), 'Sockelreflexion definiert keine eigene Restitution');
ok((HTML.match(/footballResolvePost\(fb\)/g) || []).length === 2,
  'Sockelaufloesung: einmal vor der Grenzentscheidung, einmal als Nachkorrektur der Bandenkorrektur');

// ── C. SPIELERBÄLLE: Barriere an beiden Toren ──
for (const owner of [0, 1]) for (const dir of [+1, -1]) {
  const r = shoot(owner, dir, 0, 5);
  ok(r.dist <= PLAYER_LIM + 1e-6,
    (owner === 0 ? 'Blauer' : 'Roter') + ' Spieler wird am ' + (dir > 0 ? '+X' : '-X') + '-Tor blockiert (dist ' + r.dist.toFixed(1) + ')');
}
// Spieler exakt im Torzentrum-Fenster -> trotzdem blockiert (Barriere deckt die volle Oeffnung).
for (const owner of [0, 1]) {
  const r = shoot(owner, +1, F.centerHalf() - 1, 5);
  ok(r.dist <= PLAYER_LIM + 1e-6, (owner === 0 ? 'Blauer' : 'Roter') + ' Spieler wird auch mitten in der Toroeffnung blockiert');
}
// Diagonaler Spielerimpuls in die Oeffnung -> blockiert.
F.setBalls([{ x: F.cx + F.halfLen() * 0.30, y: F.cy - F.halfWid() * 0.30, vx: 5, vy: 2.6, owner: 0 }]);
let pDiagMax = 0;
for (let i = 0; i < 300; i++) { F.step(); pDiagMax = Math.max(pDiagMax, Math.abs(F.get().balls[0].x - F.cx)); }
ok(pDiagMax <= PLAYER_LIM + 1e-6, 'Diagonaler Spielerimpuls in die Toroeffnung wird blockiert');
// Schneller Spielerball tunnelt nicht durch die Oeffnung.
const pFast = shoot(1, +1, 0, 12);
ok(pFast.dist <= PLAYER_LIM + 1e-6, 'Schneller Spielerball tunnelt nicht durch die Toroeffnung');
// Die Laengsbande bleibt fuer Spieler geschlossen (quer zur Torachse).
F.setBalls([{ x: F.cx, y: F.cy + 300, vx: 0, vy: 6, owner: 0 }]);
let pUpMax = 0;
for (let i = 0; i < 300; i++) { F.step(); pUpMax = Math.max(pUpMax, Math.abs(F.get().balls[0].y - F.cy)); }
const pUp = F.get().balls[0];
ok(pUpMax <= F.halfWid() - F.BR + 1e-6, 'Laengsbande bleibt fuer Spieler ausserhalb der Tore geschlossen');
// Spieler werden im Football-Modus nie eliminiert.
ok(pUp.alive && pFast.b.alive, 'Spielerkugeln werden im Football-Modus nicht eliminiert');
// Direkte Funktionspruefung der Rollenunterscheidung.
ok(F.canPass({ owner: 4, x: F.cx + 450, y: F.cy }) === true, 'canPass: neutraler Ball im Torfenster -> true');
ok(F.canPass({ owner: 0, x: F.cx + 450, y: F.cy }) === false, 'canPass: blauer Spieler im Torfenster -> false');
ok(F.canPass({ owner: 1, x: F.cx + 450, y: F.cy }) === false, 'canPass: roter Spieler im Torfenster -> false');
ok(F.canPass({ owner: 4, x: F.cx + 450, y: F.cy + F.centerHalf() + 1 }) === false, 'canPass: neutraler Ball knapp ausserhalb -> false');
ok(F.canPass({ owner: 4, x: F.cx + 450, y: F.cy + F.centerHalf() - 1e-6 }) === true, 'canPass: neutraler Ball an der nutzbaren Kante -> true');

// ── D. MODE-SCOPING: Passage-Ausnahme ausschliesslich im Football-Modus ──
// Die Ausnahme haengt im echten Quelltext an mode==='football'.
ok(/if\(mode==='football'\)\{for\(const fb of balls\)/.test(HTML), "Boundary-Ausnahme ist an mode==='football' gebunden");
ok(/footballCanPassGoal\(fb\)/.test(HTML), 'stepSim nutzt die zentrale Toroeffnungs-Pruefung');
// Genau EINE autoritative Passage-Entscheidung im gesamten Quelltext.
// 4B-2: ein zweiter Aufruf kam in footballContacts dazu — die Wedge-Erkennung fragt
// DIESELBE zentrale Funktion, statt die Toroeffnung ein zweites Mal zu modellieren.
ok((HTML.match(/footballCanPassGoal\(/g) || []).length === 3, 'Genau eine Definition + zwei Aufrufe von footballCanPassGoal (keine zweite Physiklogik)');
ok(/!footballCanPassGoal\(b\)\)/.test(wedgeSrc), 'Wedge-Erkennung nutzt die zentrale Toroeffnungs-Pruefung');
// Neutraler Ball (owner 4) existiert in normalen Modi gar nicht -> kein Mode-Leck moeglich.
const Bn = buildEnv('bot', 'single');
Bn.setBalls([{ x: Bn.cx + Bn.R0 * 0.55, y: Bn.cy, vx: 5, vy: 0, owner: 4 }, { x: Bn.cx, y: Bn.cy, vx: 0, vy: 0, owner: 0 }]);
for (let i = 0; i < 60 && Bn.get().phase === 'sim'; i++) Bn.step();
const bnAfter = Bn.get();
ok(bnAfter.phase === 'result' || bnAfter.balls.some(b => !b.alive), 'Normaler Modus: Toroeffnung wirkt NICHT (Ring-Out greift weiterhin)');
// Diese Phase implementiert ausdruecklich KEINE Goal Detection / Score / Reset / Barriere-Visual.
ok(!/goalScore|goalsScored|onGoal|scoreGoal|GOAL_DETECT/i.test(HTML), 'Keine Goal-Detection/Score-Logik hinzugefuegt');
ok(!/barrierMesh|energyBarrier|goalBarrierMesh/i.test(HTML), 'Keine sichtbare Barrieren-Geometrie hinzugefuegt');
ok((HTML.match(/new THREE\.WebGLRenderer/g) || []).length === 1, 'Kein zusaetzlicher Renderer durch die Physikphase');

// ════════════════════════════════════════════════════════════════════════════
// GAMEPLAYPHASE 2 — GOAL DETECTION, BALLFALL, RUNDENRESET
// Torlinie = Sockel-Hinterkante (FOOTBALL_POST_BACK*BR). Tickgetrieben, deterministisch.
// KEIN First-to-3, kein Matchende, kein Gewinnerbildschirm, kein Zeitmodus.
// ════════════════════════════════════════════════════════════════════════════
const GOAL_LINE = F.box().x1;                  // kanonische Torlinie == Sockel-Hinterkante
const G = buildEnv('football', 'single');      // eigene Instanz: Zustand bleibt isoliert
const NR = G.neutralR();                       // Radius des neutralen Balls (fbBallR = 25)

// ── A. GOAL DETECTION ──
ok(near(GOAL_LINE, 20.368 * F.BR, 1e-9), 'Torlinie = Sockel-Hinterkante 20.368*BR = ' + GOAL_LINE.toFixed(3) + ' (keine neue Magic Number)');
// Zentrum GENAU auf der Linie zaehlt noch nicht — erst der VOLLSTAENDIG passierte Ball
// (Schwelle: |dx| - fbBallR > postBack*BR, also der Radius des NEUTRALEN Balls).
ok(G.goalSide({ owner: 4, fbPassed: true, x: G.cx + GOAL_LINE, y: G.cy }) === -1, 'Ballzentrum auf der Torlinie zaehlt noch NICHT');
ok(G.goalSide({ owner: 4, fbPassed: true, x: G.cx + GOAL_LINE + NR - 0.1, y: G.cy }) === -1, 'Ball noch nicht vollstaendig hinter der Linie zaehlt nicht');
ok(G.goalSide({ owner: 4, fbPassed: true, x: G.cx + GOAL_LINE + NR + 0.1, y: G.cy }) === 0, 'Vollstaendig hinter der +X-Linie zaehlt');
ok(G.goalSide({ owner: 4, fbPassed: true, x: G.cx - GOAL_LINE - NR - 0.1, y: G.cy }) === 1, 'Vollstaendig hinter der -X-Linie zaehlt (gespiegelt)');
// Spiegelsymmetrie der Schwelle
{ const d = GOAL_LINE + NR + 0.1;
  ok(G.goalSide({ owner: 4, fbPassed: true, x: G.cx + d, y: G.cy }) === 0 &&
     G.goalSide({ owner: 4, fbPassed: true, x: G.cx - d, y: G.cy }) === 1, '+X und -X nutzen dieselbe Schwelle'); }
// Ohne fbPassed kein Tor (Pfostentreffer / Weg ausserhalb der Oeffnung erreichen das nie).
ok(G.goalSide({ owner: 4, fbPassed: false, x: G.cx + GOAL_LINE + NR + 50, y: G.cy }) === -1, 'Ohne fbPassed kein Tor (Pfostentreffer zaehlt nicht)');
// Spielerkugeln zaehlen nie.
for (const owner of [0, 1])
  ok(G.goalSide({ owner, fbPassed: true, x: G.cx + GOAL_LINE + NR + 50, y: G.cy }) === -1,
    (owner === 0 ? 'Blauer' : 'Roter') + ' Spielerball zaehlt nie als Tor');
// Quelltext: genau EINE Goal-Detection, ohne Renderer-/GLB-Abfrage.
const goalLogicSrc = goalSideSrc + tryGoalSrc + tickGoalSrc + resetRoundSrc + freezeSrc;
// Geprueft wird der CODE, nicht die Prosa: Kommentare erst entfernen. Sonst schlaegt der
// Test schon an, wenn in einer Erklaerung ein Fachbegriff wie "Celebration Window" steht.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
ok(!/THREE|scene|renderer|camera|ballMeshes|\.glb|document|window/i.test(stripComments(goalLogicSrc)),
   'Torlogik ohne Renderer-/GLB-/DOM-Abfrage');
ok((HTML.match(/function footballGoalSide\(/g) || []).length === 1, 'Genau eine Goal-Detection-Funktion');
ok((HTML.match(/footballTryGoal\(/g) || []).length === 2, 'footballTryGoal: eine Definition, genau ein Aufruf');
ok(/fbArena\(\)\.postBack\*BR/.test(goalSideSrc), 'Torlinie aus FOOTBALL_ARENA.postBack abgeleitet');
ok(/fbBallR\(\)/.test(goalSideSrc), 'Vollstaendig-hinter-der-Linie-Schwelle nutzt den Radius des neutralen Balls (fbBallR)');

// ── Integration: echtes Tor schiessen ──
// Schiesst den neutralen Ball radial in ein Tor und laeuft bis zum Zustandswechsel.
// Die Spieler stehen bewusst NEBEN der Schusslinie (y-Versatz): geprueft wird die
// Torlogik, nicht die Ball/Spieler-Kollision. Auf der x-Achse wuerde der Ball sonst
// am gegnerischen Spielerball abprallen und das Tor nie erreichen.
function kickToGoal(env, dir, speed) {
  const off = env.spawnOff();                    // kanonischer Spielerabstand (FOOTBALL_ARENA.spawn)
  env.setBalls([
    { x: env.cx - off, y: env.cy + 250, vx: 0, vy: 0, owner: 0 },
    { x: env.cx + off, y: env.cy - 250, vx: 0, vy: 0, owner: 1 },
    { x: env.cx + dir * 150, y: env.cy, vx: dir * (speed || 6), vy: 0, owner: 4 },
  ]);
  let n = 0;
  while (env.goalState() === 'play' && n < 600) { env.step(); n++; }
  return n;
}
// ── B. SCORE + Torseitenzuordnung ──
G.setScore(0, 0);
kickToGoal(G, +1);
ok(G.goalState() === 'fall', 'Gueltiges Tor wechselt play -> fall');
ok(JSON.stringify(G.score()) === '[1,0]', '+X-Tor (rotes Tor) gibt BLAU den Punkt — erhalten ' + JSON.stringify(G.score()));
// Kein Doppelpunkten waehrend des gesamten Fallablaufs.
for (let i = 0; i < G.fallTicks + G.celebrateTicks + G.spawnTicks + 20; i++) G.step();
ok(JSON.stringify(G.score()) === '[1,0]', 'Kein Doppelpunkten waehrend Fall/Spawn/Reset');
ok(G.goalState() === 'play', 'Nach Fall + Spawn zurueck in play');
// -X-Tor gibt der Gegenseite den Punkt.
kickToGoal(G, -1);
ok(JSON.stringify(G.score()) === '[1,1]', '-X-Tor (blaues Tor) gibt ROT den Punkt — erhalten ' + JSON.stringify(G.score()));
for (let i = 0; i < G.fallTicks + G.celebrateTicks + G.spawnTicks + 20; i++) G.step();
ok(JSON.stringify(G.score()) === '[1,1]', 'Score bleibt ueber den Rundenreset erhalten');
// Eigentore sind erlaubt: entscheidend ist NUR das ueberquerte Tor, nicht der letzte Kontakt.
ok(G.goalSide({ owner: 4, fbPassed: true, x: G.cx + GOAL_LINE + G.BR + 1, y: G.cy }) === 0 &&
   G.goalSide({ owner: 4, fbPassed: true, x: G.cx - GOAL_LINE - G.BR - 1, y: G.cy }) === 1,
  'Punktzuordnung haengt ausschliesslich am ueberquerten Tor (Eigentore moeglich)');
ok(!/lastTouch|lastToucher|assist/i.test(goalLogicSrc), 'Keine Last-Touch-/Assist-Logik');
// Neues Football-Match startet bei 0:0.
G.newMatch();
ok(JSON.stringify(G.score()) === '[0,0]', 'Neues Football-Match startet bei 0:0');
ok(G.goalState() === 'play' && G.goalTick() === 0, 'Neues Match startet im Zustand play');
// Matchende ist Sache der Zustandsmaschine, nicht des Torereignisses (Gameplayphase 3).
ok(!/winTarget/i.test(goalLogicSrc), 'Football nutzt NICHT den RingOut-winTarget (3/5), sondern die eigene Konstante');
ok(!/gameOver\(/.test(tryGoalSrc), 'Das Torereignis selbst beendet das Match nicht (erst nach dem Ballfall)');

// ── C. GOAL-FALL: Sperre, Einfrieren, Determinismus ──
const H = buildEnv('football', 'single');
H.setScore(0, 0);
// Spieler bekommen Schwung, damit "einfrieren" ueberhaupt pruefbar ist.
{ const off = H.spawnOff();
  H.setBalls([
    { x: H.cx - off, y: H.cy + 250, vx: 2.5, vy: 1.5, owner: 0 },
    { x: H.cx + off, y: H.cy - 250, vx: -2.0, vy: 1.0, owner: 1 },
    { x: H.cx + 150, y: H.cy, vx: 6, vy: 0, owner: 4 },
  ]);
  let n = 0; while (H.goalState() === 'play' && n < 600) { H.step(); n++; }
  ok(H.goalState() === 'fall', 'Zustand wechselt play -> goal_fall'); }
ok(H.goalBusy() === true, 'Torablauf meldet sich als busy');
ok(H.locked() === true, 'Eingabe waehrend goal_fall gesperrt (inputLocked)');
ok(H.canCommit(0) === false && H.canCommit(1) === false, 'Kein Commit waehrend goal_fall moeglich (beide Spieler)');
ok(H.dragCalls() > 0, 'Laufende Eingabe wurde beim Tor abgebrochen (cancelAimDrag)');
// Spieler stehen still und bleiben es.
{ const pl = H.get().balls.filter(b => b.owner !== 4);
  ok(pl.length === 2 && pl.every(b => b.vx === 0 && b.vy === 0), 'Beide Spielerbaelle sind eingefroren (v=0)');
  ok(pl.every(b => b.alive), 'Spielerbaelle werden nicht eliminiert'); }
{ const before = H.get().balls.filter(b => b.owner !== 4).map(b => ({ x: b.x, y: b.y }));
  for (let i = 0; i < 20; i++) H.step();
  const after = H.get().balls.filter(b => b.owner !== 4).map(b => ({ x: b.x, y: b.y }));
  ok(JSON.stringify(before) === JSON.stringify(after), 'Spieler rollen waehrend des Ballfalls nicht weiter'); }
// Tick laeuft deterministisch hoch, Score bleibt bei genau 1.
{ const t0 = H.goalTick(); H.step(); ok(H.goalTick() === t0 + 1, 'Fall-Tick zaehlt deterministisch pro Sub-Step hoch'); }
ok(JSON.stringify(H.score()) === '[1,0]', 'Waehrend goal_fall kein zweites Scoring');
// Der neutrale Ball laeuft planar weiter nach aussen (keine Bandenreflexion nach dem Tor).
{ const n0 = H.get().balls.find(b => b.owner === 4);
  const r0 = Math.abs(n0.x - H.cx);
  for (let i = 0; i < 10; i++) H.step();
  const n1 = H.get().balls.find(b => b.owner === 4);
  const r1 = Math.abs(n1.x - H.cx);
  ok(r1 > r0, 'Neutraler Ball laeuft nach dem Tor weiter nach aussen (keine Rueckreflexion)');
  ok(r1 > H.halfLen(), 'Neutraler Ball bleibt waehrend des Falls ausserhalb der Arena'); }
// Fallhoehe/Spawnhoehe sind rein visuell und deterministisch aus dem Tick abgeleitet.
ok(H.spawnHeight() > 0 && near(H.spawnHeight(), H.BR * 10), 'Spawnhoehe kanonisch aus BR abgeleitet');
ok(/fbGoalState==='fall'/.test(HTML) && /FOOTBALL_NEUTRAL_OWNER/.test(HTML), 'Renderer-Fall ist an fbGoalState und den neutralen Ball gebunden');
ok(/footballSpawnHeight\(\)\*Math\.max\(0,1-fbGoalTick\/FOOTBALL_GOAL_SPAWN_TICKS\)/.test(HTML), 'Spawn-Hoehe deterministisch aus dem Tickzaehler (keine Wanduhr)');
ok(!/setTimeout\([^)]*fbGoal/.test(HTML) && !/setInterval\([^)]*fbGoal/.test(HTML), 'Kein setTimeout/setInterval im Torablauf');

// ── D. RESET ──
// Bis zum Ende des Falls laufen lassen -> Reset muss exakt bei fallTicks greifen.
{ const I2 = buildEnv('football', 'single');
  // Bewusst ein Stand, der auch nach drei weiteren Toren FOOTBALL_WIN_SCORE nie erreicht —
  // dieser Block prueft den REGULAEREN Rundenreset, nicht das Matchende (s. Abschnitt F).
  I2.setScore(0, 1);
  kickToGoal(I2, +1);
  ok(JSON.stringify(I2.score()) === '[1,1]', 'Score zaehlt von einem bestehenden Stand weiter');
  I2.setAim();                                  // simulierte Aim-/Commit-Reste
  let guard = 0;
  while (I2.goalState() === 'fall' && guard++ < 500) I2.step();
  // UX-3C: zwischen Ballfall und Rundenreset liegt jetzt das Celebration Window.
  ok(I2.goalState() === 'celebrate', 'Nach fester Tickzahl wechselt goal_fall -> celebrate');
  guard = 0; while (I2.goalState() === 'celebrate' && guard++ < 500) I2.step();
  ok(I2.goalState() === 'spawn', 'Nach dem Celebration Window folgt der Rundenreset (spawn)');
  // Kanonische Referenz aus einer SEPARATEN Instanz — I2.place() wuerde die gerade
  // zurueckgesetzten Kugeln ueberschreiben, die hier genau geprueft werden sollen.
  const ref = buildEnv('football', 'single').place();
  const after = I2.get().balls;                  // Zustand unmittelbar nach dem Reset
  ok(after.length === 3, 'Nach dem Reset stehen wieder genau drei Kugeln im Feld');
  ok(JSON.stringify(after.map(b => b.owner)) === '[0,1,4]', 'Rollen/Owner nach dem Reset korrekt [0,1,4]');
  for (let i = 0; i < 3; i++)
    ok(near(after[i].x, ref[i].x, 1e-9) && near(after[i].y, ref[i].y, 1e-9),
      'Kugel ' + i + ' (owner ' + ref[i].owner + ') steht nach dem Reset auf der kanonischen Startposition');
  ok(after.every(b => b.vx === 0 && b.vy === 0), 'Alle Geschwindigkeiten nach dem Reset = 0');
  ok(after.every(b => b.alive), 'Alle Kugeln nach dem Reset alive');
  ok(I2.passedFlags().every(f => f === false), 'fbPassed ist nach dem Reset auf allen Kugeln geloescht');
  const st = I2.aimState();
  ok(st.aimSet.every(a => a === false), 'Aim-Zustaende nach dem Reset geloescht');
  ok(st.commitIdx.every(c => c === -1), 'Commit-Zustaende nach dem Reset geloescht');
  // Spawn -> play
  guard = 0; while (I2.goalState() === 'spawn' && guard++ < 500) I2.step();
  ok(I2.goalState() === 'play', 'Nach dem Spawn zurueck zu play');
  ok(I2.locked() === false, 'Eingabe nach dem Reset wieder freigegeben');
  ok(I2.canCommit(0) === true, 'Commit nach dem Reset wieder moeglich');
  ok(I2.aimState().phase === 'aim', 'Planungsphase nach dem Reset wieder offen');
  // ZWEITES Tor muss erneut erkannt werden (fbPassed sauber zurueckgesetzt).
  const scoreBefore = I2.score();
  kickToGoal(I2, +1);
  ok(I2.goalState() === 'fall', 'Zweites Tor wird nach dem Reset erneut erkannt');
  ok(I2.score()[0] === scoreBefore[0] + 1, 'Zweites Tor erhoeht den Score erneut (' + JSON.stringify(scoreBefore) + ' -> ' + JSON.stringify(I2.score()) + ')');
  // Drittes Tor: kein First-to-3-Abbruch, Ablauf bleibt identisch.
  while (I2.goalState() !== 'play') I2.step();
  kickToGoal(I2, -1);
  ok(I2.goalState() === 'fall' && I2.score()[1] >= 1, 'Drittes Tor laeuft regulaer weiter (kein Matchende)');
  ok(JSON.stringify(I2.score()) === '[2,2]', 'Stand 2:2 — noch niemand hat FOOTBALL_WIN_SCORE erreicht');
  ok(I2.winner() === null, 'Bei 2:2 ist kein Gewinner gesetzt (kein Unentschieden, kein Abbruch)'); }

// ════════════════════════════════════════════════════════════════════════════
// F. MATCHENDE — First-to-3, autoritativer Resultzustand, neues Match
// (Gameplayphase 3). Deterministisch: kein Timer, kein DOM als Source of Truth.
// ════════════════════════════════════════════════════════════════════════════

// Ballfall UND Celebration Window bis zum naechsten Zustandswechsel ('spawn' bei normalem
// Tor, 'result' beim Sieg). Beide Phasen sind reines Warten; wer die Tickgrenzen einzeln
// pruefen will, tut das ueber goalState()/goalTick() (s. F2 und J1).
function runFall(env) {
  let g = 0;
  while ((env.goalState() === 'fall' || env.goalState() === 'celebrate') && g++ < 500) env.step();
}
// Frische Instanz auf Stand a:b, dann genau ein Tor in Richtung dir, Ballfall komplett.
function matchAfterGoal(a, b, dir) {
  const M = buildEnv('football', 'single');
  M.setScore(a, b); kickToGoal(M, dir); runFall(M);
  return M;
}

// ── F1. FIRST-TO-3-REGEL ──
ok(/const FOOTBALL_WIN_SCORE=3;/.test(HTML), 'FOOTBALL_WIN_SCORE ist als benannte Konstante = 3 definiert');
ok(buildEnv('football', 'single').winScore === 3, 'FOOTBALL_WIN_SCORE traegt zur Laufzeit den Wert 3');
ok((HTML.match(/score\[side\]>=FOOTBALL_WIN_SCORE/g) || []).length === 1, 'Genau EINE zentrale First-to-3-Pruefung');
ok(!/score\[side\]>=3|score\[0\]>=3|score\[1\]>=3/.test(HTML), 'Keine verstreute Magic Number 3 in der Matchlogik');
ok(!/overtime|goldenGoal|extraTime|timeLimit|matchClock/i.test(HTML), 'Kein Overtime-/Zeitlimit-Code');
{ const M = matchAfterGoal(2, 0, +1);
  ok(JSON.stringify(M.score()) === '[3,0]', 'Stand 2:0 -> naechstes Tor fuer Blau ergibt 3:0');
  ok(M.winner() === 0, 'Stand 2:0 -> naechstes Tor gewinnt (Blau)');
  ok(M.goalState() === 'result', 'Stand 2:0 -> entscheidendes Tor beendet das Match'); }
{ const M = matchAfterGoal(2, 2, -1);
  ok(JSON.stringify(M.score()) === '[2,3]', 'Stand 2:2 -> naechstes Tor fuer Rot ergibt 2:3');
  ok(M.winner() === 1, 'Stand 2:2 -> naechstes Tor gewinnt (keine Zwei-Tore-Differenz noetig)');
  ok(M.goalState() === 'result', 'Stand 2:2 -> entscheidendes Tor beendet das Match'); }
{ const M = matchAfterGoal(1, 2, +1);
  ok(JSON.stringify(M.score()) === '[2,2]', 'Stand 1:2 -> Tor fuer Blau ergibt 2:2');
  ok(M.winner() === null, 'Ausgleich auf 2:2 beendet das Match NICHT');
  ok(M.goalState() === 'spawn', 'Ohne Sieg laeuft der normale Rundenreset weiter'); }
// Eigentore zaehlen regulaer und koennen genauso entscheiden — die Seite entscheidet, nicht der Schuetze.
{ const M = matchAfterGoal(0, 2, -1);
  ok(M.winner() === 1 && JSON.stringify(M.score()) === '[0,3]', 'Auch ein Tor ins eigene Tor kann das Match entscheiden'); }

// ── F2. ENTSCHEIDENDES TOR: genau einmal werten, voller Ballfall, dann result ──
{ const M = buildEnv('football', 'single');
  M.setScore(2, 0);
  kickToGoal(M, +1);
  ok(JSON.stringify(M.score()) === '[3,0]', 'Entscheidendes Tor wird genau einmal gewertet');
  ok(M.winner() === 0, 'Gewinner steht bereits beim Torereignis kanonisch fest');
  ok(M.goalState() === 'fall', 'Entscheidendes Tor startet zuerst den regulaeren Ballfall');
  ok(M.overCalls().length === 0, 'Matchende NICHT sofort beim Tor — erst nach dem Ballfall');
  // Der Fall wird nicht abgeschnitten: dieselbe Tickgrenze wie bei jedem anderen Tor.
  let g = 0; while (M.goalState() === 'fall' && M.goalTick() < M.fallTicks - 1 && g++ < 500) M.step();
  ok(M.goalState() === 'fall' && M.goalTick() === M.fallTicks - 1, 'Ballfall laeuft bis unmittelbar vor die kanonische Tickgrenze (FOOTBALL_GOAL_FALL_TICKS)');
  ok(M.overCalls().length === 0, 'Vor der Tickgrenze noch kein Matchende');
  M.step();
  // UX-3C: auch das entscheidende Tor bekommt zuerst sein Celebration Window — das
  // Result-Overlay darf den Trefferimpuls nicht sofort ueberdecken.
  ok(M.goalState() === 'celebrate', 'Genau bei FOOTBALL_GOAL_FALL_TICKS: fall -> celebrate');
  ok(M.overCalls().length === 0, 'im Celebration Window ist das Matchende noch NICHT ausgeloest');
  let gw = 0;
  while (M.goalState() === 'celebrate' && M.goalTick() < M.winCelebrateTicks - 1 && gw++ < 500) M.step();
  ok(M.goalState() === 'celebrate' && M.overCalls().length === 0,
     'das Matchende wartet die volle Matchpunkt-Celebration ab');
  M.step();
  ok(M.goalState() === 'result', 'erst am Ende des Celebration Windows: celebrate -> result (spawn wird uebersprungen)');
  ok(M.goalTick() === 0, 'fbGoalTick beim Eintritt in result zurueckgesetzt');
  ok(M.overCalls().length === 1 && M.overCalls()[0] === 0, 'Bestehende Result-Struktur genau einmal mit dem gespeicherten Gewinner aufgerufen');
  ok(M.get().phase === 'over', 'Matchende nutzt die bestehende Result-Phase (over) — keine zweite Matchengine');
  ok(JSON.stringify(M.score()) === '[3,0]', 'Kein Doppelpunkten beim entscheidenden Tor');
  // Kein Spawn/Reset nach dem Sieg: der Ball liegt weiterhin ausserhalb, die Latches stehen.
  const nb = M.get().balls.find(b => b.owner === 4);
  ok(Math.abs(nb.x - M.cx) > M.halfLen(), 'Kein neuer Ball nach dem Sieg: der Ball bleibt ausserhalb der Arena');
  ok(M.passedFlags().some(f => f === true), 'Kein Rundenreset nach dem Sieg (fbPassed steht noch — placeBalls wurde nicht gerufen)');
  ok(M.aimState().phase !== 'aim', 'Nach dem Sieg wird keine neue Planungsphase geoeffnet'); }
ok(/if\(footballWinner!==null\)\{fbGoalState='result';fbGoalTick=0;footballMatchEnd\(\);return;\}/.test(tickGoalSrc),
  'Uebergang fall -> result haengt am kanonisch gespeicherten Gewinner');
ok(!/setTimeout|setInterval/.test(tickGoalSrc + tryGoalSrc + matchEndSrc), 'Matchende ohne setTimeout-Kaskade (rein tickgesteuert)');

// ── F3. RESULT-ZUSTAND: stabil, gesperrt, unveraenderlich ──
{ const M = buildEnv('football', 'single');
  M.setScore(2, 0); kickToGoal(M, +1); runFall(M);
  ok(M.goalState() === 'result', 'Setup: Resultzustand erreicht');
  ok(M.get().phase === 'over', 'Setup: bestehende Result-Phase aktiv');
  const scoreAtEnd = JSON.stringify(M.score());
  const playersAtEnd = JSON.stringify(M.get().balls.filter(b => b.owner !== 4).map(b => ({ x: b.x, y: b.y })));
  ok(M.goalBusy() === true, 'Resultzustand meldet sich als busy');
  ok(M.locked() === true, 'Eingabe im Resultzustand gesperrt (inputLocked)');
  ok(M.canCommit(0) === false && M.canCommit(1) === false, 'Kein Drag/Release/Commit im Resultzustand (beide Spieler)');
  for (let i = 0; i < 400; i++) M.step();
  ok(M.goalState() === 'result', 'Resultzustand bleibt ueber viele Ticks stabil (kein Rueckfall nach play)');
  ok(M.goalTick() === 0, 'Im Resultzustand laeuft kein Tickzaehler weiter');
  ok(JSON.stringify(M.score()) === scoreAtEnd, 'Score im Resultzustand unveraenderlich (Goal Detection gesperrt)');
  ok(M.winner() === 0, 'Gewinner bleibt im Resultzustand autoritativ gespeichert');
  ok(M.overCalls().length === 1, 'Kein zweiter Matchende-Aufruf ueber viele Ticks');
  ok(JSON.stringify(M.get().balls.filter(b => b.owner !== 4).map(b => ({ x: b.x, y: b.y }))) === playersAtEnd,
    'Spieler bleiben im Resultzustand gestoppt');
  ok(M.passedFlags().some(f => f === true), 'Keine automatisch gestartete neue Runde im Resultzustand'); }
ok(/if\(fbGoalState==='result'\)return;/.test(tickGoalSrc), 'result ist ein Endzustand: die Zustandsmaschine tickt nicht weiter');
ok(/if\(fbGoalState!=='play'\)return;/.test(tryGoalSrc), 'Goal Detection wertet ausschliesslich aus play heraus');
ok(/function footballGoalBusy\(\)\{return mode==='football'&&fbGoalState!=='play';\}/.test(HTML),
  'Eingabesperre deckt result automatisch mit ab (alles ausser play)');

// ── F4. GEWINNERANZEIGE (bestehende Result-Struktur, football-scoped) ──
ok((HTML.match(/function gameOver\(/g) || []).length === 1, 'Genau eine Result-/Gewinnerfunktion — keine neue Praesentationsschicht');
// Eine Definition und zwei Aufrufer: der Torablauf (Classic/Tactical, First-to-3) und die
// Elimination4-Entscheidung, wenn der vorletzte Spieler ausserhalb eines Torablaufs ausscheidet.
ok((HTML.match(/footballMatchEnd\(/g) || []).length === 3, 'footballMatchEnd: eine Definition, genau zwei Aufrufer');
ok(/gameOver\(footballWinner\);/.test(matchEndSrc), 'Matchende uebergibt den KANONISCHEN Gewinner (kein DOM-Text, keine Farbe)');
ok(!/textContent|innerHTML|getElementById|\$\(/.test(matchEndSrc), 'Matchende selbst schreibt kein DOM — das macht die bestehende Result-Struktur');
ok(/colName\(winner\)\+' '\+T\('wins'\)/.test(HTML), 'Gewinnertext kommt aus der bestehenden i18n-Zeile');
ok(/col0:'BLAU'/.test(HTML) && /col1:'ROT'/.test(HTML) && /wins:'GEWINNT'/.test(HTML), 'Deutsche Gewinnertexte: BLAU GEWINNT / ROT GEWINNT');
ok(/const iPlay=online\|\|mode==='bot';/.test(HTML), 'Lokales Football zeigt die neutrale Gewinner-Headline (kein VICTORY/DEFEAT)');
ok(/T\('finalScore'\)/.test(HTML) && /finalScore:'ENDSTAND'/.test(HTML), 'Endstand wird im Result-Overlay angezeigt');
ok(/fbNewMatch:'[^']*Neues Match'/.test(HTML), 'Button-Text "Neues Match" vorhanden (de)');
ok(/function rematchLabel\(\)\{return mode==='football'\?T\('fbNewMatch'\):T\('rematch'\);\}/.test(HTML),
  'Neues-Match-Beschriftung ist mode-scoped — normale Modi behalten "Rematch"');
ok((HTML.match(/rematchLabel\(\)/g) || []).length === 3, 'rematchLabel: eine Definition, genau zwei Verwendungen (applyLang + gameOver)');
ok(/id="ovMenuBtn"/.test(HTML), 'Bestehender Menue-Button im Result-Overlay wird wiederverwendet');
ok(/\$\('replayBtn'\)\.style\.display=mode==='football'\?'none':'';/.test(HTML), 'Replay-Button nur im Football ausgeblendet — andere Modi unveraendert');
ok(!/id="fbResult|id="footballOv|id="fbOv/i.test(HTML), 'Kein zweites Football-Result-Overlay');
ok(!/confetti|particleWin|cameraShake/i.test(HTML), 'Keine Konfetti-/Partikel-/Kamera-Effekte ergaenzt');

// ── F5. NEUES MATCH ──
{ const M = buildEnv('football', 'single');
  M.setScore(2, 0); kickToGoal(M, +1); runFall(M);
  ok(M.goalState() === 'result' && M.winner() === 0, 'Setup: Match ist beendet');
  M.setAim();                                   // Aim-/Commit-Reste aus dem alten Match
  M.newMatch();
  ok(JSON.stringify(M.score()) === '[0,0]', 'Neues Match startet bei 0:0');
  ok(M.winner() === null, 'Neues Match: Gewinner auf null zurueckgesetzt');
  ok(M.goalState() === 'play', 'Neues Match: fbGoalState zurueck auf play');
  ok(M.goalTick() === 0, 'Neues Match: fbGoalTick zurueckgesetzt');
  const ref = buildEnv('football', 'single').place();
  const after = M.get().balls;
  ok(after.length === 3 && JSON.stringify(after.map(b => b.owner)) === '[0,1,4]', 'Neues Match: frische Kugeln [0,1,4]');
  for (let i = 0; i < 3; i++)
    ok(near(after[i].x, ref[i].x, 1e-9) && near(after[i].y, ref[i].y, 1e-9),
      'Neues Match: Kugel ' + i + ' (owner ' + ref[i].owner + ') auf der Startposition');
  ok(after.every(b => b.vx === 0 && b.vy === 0), 'Neues Match: alle Geschwindigkeiten 0');
  ok(after.every(b => b.alive), 'Neues Match: alle Kugeln alive');
  ok(M.passedFlags().every(f => f === false), 'Neues Match: fbPassed vollstaendig weg');
  const st = M.aimState();
  ok(st.aimSet.every(a => a === false), 'Neues Match: Aim-Zustaende geloescht');
  ok(st.commitIdx.every(c => c === -1), 'Neues Match: Commit-/Pending-Zustaende geloescht');
  ok(st.phase === 'aim', 'Neues Match: Planungsphase wieder offen');
  ok(M.locked() === false, 'Neues Match: Eingabesperre aufgehoben');
  ok(M.canCommit(0) === true && M.canCommit(1) === true, 'Neues Match: Eingabe wieder moeglich');
  // Erstes Tor im neuen Match zaehlt regulaer und beendet nichts.
  kickToGoal(M, +1);
  ok(JSON.stringify(M.score()) === '[1,0]', 'Erstes Tor im neuen Match zaehlt regulaer (keine alte Punktzahl)');
  ok(M.goalState() === 'fall' && M.winner() === null, 'Erstes Tor im neuen Match beendet das Match nicht'); }
ok(/function newGame\(\)\{[\s\S]*?footballResetMatchState\(\);/.test(HTML), 'newGame nutzt die zentrale Football-Match-Initialisierung');
ok((HTML.match(/footballResetMatchState\(\)/g) || []).length === 3, 'footballResetMatchState: eine Definition, genau zwei Aufrufe (newGame + showMenu)');
ok(/\$\('rematchBtn'\)\.onclick=\(\)=>\{if\(online\)[\s\S]*?newGame\(\);\};/.test(HTML), 'Neues-Match-Button laeuft ueber den bestehenden newGame-Pfad');

// ── F6. MODUSWECHSEL / MENUE ──
{ const M = buildEnv('football', 'single');
  M.setScore(2, 0); kickToGoal(M, +1); runFall(M);
  ok(M.goalState() === 'result', 'Setup: Football-Result aktiv');
  M.resetMatchState();                          // == showMenu()- bzw. newGame()-Pfad
  ok(M.goalState() === 'play' && M.goalTick() === 0, 'Menue/Moduswechsel raeumt den Torablauf ab');
  ok(M.winner() === null, 'Menue/Moduswechsel raeumt den Gewinner ab (kein alter Winner-Text)');
  ok(M.locked() === false, 'Nach dem Moduswechsel keine Football-Eingabesperre mehr'); }
// Ein gesetztes Football-Resultflag darf NORMALE Modi unter keinen Umstaenden beruehren.
{ const Bn = buildEnv('bot', 'single');
  Bn.setGoalState('result');
  ok(Bn.goalBusy() === false, 'Football-Resultzustand meldet ausserhalb von football nie busy');
  ok(Bn.locked() === false, 'Football-Result sperrt die Eingabe normaler RingOut-Modi nicht');
  ok(Bn.canCommit(0) === true, 'Normaler RingOut-Modus bleibt trotz Football-Resultflag voll bedienbar'); }
ok(/function showMenu\(\)\{[\s\S]*?footballResetMatchState\(\);/.test(HTML), 'showMenu raeumt den Football-Matchzustand ab');

// ── F7. REGRESSION: nicht entscheidendes Tor laeuft unveraendert ──
{ const M = buildEnv('football', 'single');
  M.setScore(0, 0);
  kickToGoal(M, +1);
  ok(M.goalState() === 'fall' && M.winner() === null, 'Nicht entscheidendes Tor: regulaerer Ballfall, kein Gewinner');
  runFall(M);
  ok(M.goalState() === 'spawn', 'Nicht entscheidendes Tor: regulaerer Rundenreset (spawn) statt result');
  ok(M.overCalls().length === 0, 'Nicht entscheidendes Tor loest kein Matchende aus');
  let g = 0; while (M.goalState() !== 'play' && g++ < 500) M.step();
  ok(M.goalState() === 'play', 'Nicht entscheidendes Tor: zurueck in play');
  ok(M.locked() === false, 'Nach nicht entscheidendem Tor ist die Eingabe wieder frei');
  ok(M.get().phase === 'aim', 'Nach nicht entscheidendem Tor laeuft die Planungsphase regulaer weiter'); }

// ── E. MODE-SCOPING ──
{ const Bn2 = buildEnv('bot', 'single');
  ok(Bn2.goalSide({ owner: 4, fbPassed: true, x: Bn2.cx + GOAL_LINE + Bn2.BR + 50, y: Bn2.cy }) === -1, 'Ausserhalb Football kein Tor (goalSide -1)');
  ok(Bn2.goalBusy() === false, 'Ausserhalb Football nie ein Torablauf');
  Bn2.setBalls([{ x: Bn2.cx, y: Bn2.cy, vx: 0, vy: 0, owner: 0 }]);
  for (let i = 0; i < 30; i++) Bn2.step();
  ok(Bn2.goalState() === 'play', 'Ausserhalb Football bleibt der Torzustand unberuehrt'); }
ok(/mode==='football'&&fbGoalState==='fall'/.test(HTML), 'Renderer-Falloffset ist football-scoped');
ok(/function footballGoalBusy\(\)\{return mode==='football'/.test(HTML), 'Eingabesperre ist football-scoped');
ok((HTML.match(/new THREE\.WebGLRenderer/g) || []).length === 1, 'Kein zusaetzlicher Renderer durch Gameplayphase 2');
ok(/new THREE\.TorusGeometry\(GLB_R,\.075,12,176\)/.test(HTML), 'RingOut-Bande weiterhin unveraendert');
ok(!/overtime|goldenGoal|timeLimit|matchClock|extraTime|bestOf|rematchCount/i.test(HTML), 'Kein Zeitmodus/Overtime/Golden Goal/Best-of-Serie ergaenzt');

// ── normale Modi unverändert: 1v1 hat zwei Kugeln, Ring-Out bleibt aktiv ──
const B = buildEnv('bot', 'single');
const bb = B.place();
ok(bb.length === 2 && JSON.stringify(bb.map(b => b.owner)) === JSON.stringify([0, 1]), 'Normaler 1v1-Aufbau unverändert (2 Kugeln [0,1])');
B.setBalls([{ x: B.cx, y: B.cy + (B.R0 * 1.2), vx: 0, vy: 4, owner: 1 }, { x: B.cx, y: B.cy, vx: 0, vy: 0, owner: 0 }]);
let ended = false;
for (let i = 0; i < 40 && !ended; i++) { B.step(); if (B.get().phase !== 'sim') ended = true; }
const bAfter = B.get();
ok(bAfter.phase === 'result' || bAfter.balls.some(b => !b.alive), 'Normaler Modus behält Ring-Out (außenliegende Kugel wird ausgewertet)');

// ════════════════════════════════════════════════════════════════════════════
// Arena-Football — VISUELLE Torintegration (GERADES GLB-Asset + zwei Instanzen)
// Mit der Arena-Finalisierung ersetzt das gerade Tor (assets/arena_football_goal.glb)
// das fruehere konzentrisch gekruemmte Tor der Kreisarena vollstaendig — dessen
// GLB-Parsing und Platzierungspruefungen sind ersatzlos gestrichen (Feature entfernt).
// Reiner Export + Renderer-Einbindung; keine Physik/Gameplay/Bande.
// ════════════════════════════════════════════════════════════════════════════

// ── GLB maschinell parsen (dependency-frei: JSON-Chunk des glTF-Binary) ──
const GLB_PATH = path.join(__dirname, '..', 'assets', 'arena_football_goal.glb');
ok(fs.existsSync(GLB_PATH), 'GLB-Datei assets/arena_football_goal.glb vorhanden (gerades Tor)');
let glb = null;
if (fs.existsSync(GLB_PATH)) {
  const buf = fs.readFileSync(GLB_PATH);
  ok(buf.readUInt32LE(0) === 0x46546C67, 'GLB-Magic korrekt (glTF)');
  const total = buf.readUInt32LE(8);
  let off = 12, json = null;
  while (off < total) {
    const clen = buf.readUInt32LE(off), ctype = buf.readUInt32LE(off + 4);
    if (ctype === 0x4E4F534A) json = JSON.parse(buf.slice(off + 8, off + 8 + clen).toString('utf8'));
    off += 8 + clen;
  }
  glb = json;
}
if (glb) {
  const nodeNames = (glb.nodes || []).map(n => n.name);
  const matNames = (glb.materials || []).map(m => m.name);
  const rootIdx = (glb.scenes && glb.scenes[glb.scene || 0]) ? glb.scenes[glb.scene || 0].nodes : [];
  const rootNames = rootIdx.map(i => nodeNames[i]);
  const lights = (glb.extensions && glb.extensions.KHR_lights_punctual && glb.extensions.KHR_lights_punctual.lights) || [];
  // Genau EIN Tor-Asset: genau ein Root-Node, und der heisst AF_Goal.
  ok(rootNames.length === 1 && rootNames[0] === 'AF_Goal', 'GLB hat genau EIN Tor (Root-Node AF_Goal) — keine zweite Instanz');
  ok(nodeNames.length > 0 && nodeNames.every(n => n && n.startsWith('AF_Goal')), 'GLB enthaelt ausschliesslich AF_Goal*-Objekte');
  ok(!nodeNames.some(n => /Preview|Rim|Floor|prof/i.test(n)), 'GLB enthaelt keine Preview-/Profil-Objekte');
  ok((glb.cameras || []).length === 0, 'GLB enthaelt keine Kamera');
  ok(lights.length === 0 && !(glb.extensionsUsed || []).includes('KHR_lights_punctual'), 'GLB enthaelt keine Lichter');
  ok(matNames.includes('AF_Goal_Marble'), 'GLB enthaelt das Marmor-Material (AF_Goal_Marble)');
  ok(matNames.includes('AF_Goal_Gold'), 'GLB enthaelt das Gold-Material (AF_Goal_Gold)');
  ok(matNames.length === 2, 'GLB hat genau die zwei Tor-Materialien (erhalten: ' + matNames.length + ')');
  ok((glb.meshes || []).length === 7, 'GLB hat die sieben Tor-Meshes des geraden Tors (2 Sockel, Wappen, 4 Rahmen-/Keyline-Profile; erhalten: ' + (glb.meshes || []).length + ')');
  ok(!(glb.extensionsUsed || []).includes('KHR_draco_mesh_compression'), 'GLB nutzt keine Draco-Kompression');
  // ── Sockelvermessung: die Quelle der FOOTBALL_ARENA-Torkonstanten ──
  // AF_Goal_Base_L/R (Node-Translation +- lokale POSITION-Accessoren, Blender-Einheiten):
  // tangential |x| = 1.780 .. 2.641, in Torrichtung z = -0.592 .. 0.592. Mit der
  // Asset-Konvention 1 Blender-Einheit == 2*BR ergeben sich postInner 3.560*BR,
  // postOuter 5.282*BR und FB_GOAL_HALF_DEPTH 1.184*BR (Konstanten auf 3 Stellen gerundet).
  const bases = (glb.nodes || []).filter(n => /^AF_Goal_Base_[LR]$/.test(n.name || '') && n.mesh != null);
  ok(bases.length === 2, 'GLB hat genau die zwei Marmor-Sockel AF_Goal_Base_L/R (erhalten: ' + bases.length + ')');
  if (bases.length === 2) {
    let inner = Infinity, outer = 0, zHalf = 0;
    for (const nd of bases) {
      const tx = (nd.translation || [0, 0, 0])[0];
      for (const p of glb.meshes[nd.mesh].primitives) {
        const a = glb.accessors[p.attributes.POSITION];
        inner = Math.min(inner, Math.abs(tx) - Math.max(Math.abs(a.min[0]), Math.abs(a.max[0])));
        outer = Math.max(outer, Math.abs(tx) + Math.max(Math.abs(a.min[0]), Math.abs(a.max[0])));
        zHalf = Math.max(zHalf, Math.max(Math.abs(a.min[2]), Math.abs(a.max[2])));
      }
    }
    const bx = F.box();
    ok(near(2 * inner, bx.y0 / F.BR, 2e-3), 'Gemessene Sockel-Innenkante 2*' + inner.toFixed(4) + ' == FOOTBALL_ARENA.postInner ' + (bx.y0 / F.BR));
    ok(near(2 * outer, bx.y1 / F.BR, 2e-3), 'Gemessene Sockel-Aussenkante 2*' + outer.toFixed(4) + ' == FOOTBALL_ARENA.postOuter ' + (bx.y1 / F.BR));
    ok(near(2 * (2 * zHalf), (bx.x1 - bx.x0) / F.BR, 2e-3), 'Gemessene Sockeltiefe 2*2*' + zHalf.toFixed(4) + ' == 2*FB_GOAL_HALF_DEPTH ' + ((bx.x1 - bx.x0) / F.BR).toFixed(3));
    // Beide Sockel exakt spiegelsymmetrisch aufgestellt.
    const t0x = bases[0].translation[0], t1x = bases[1].translation[0];
    ok(near(t0x, -t1x, 1e-6), 'Sockel L/R exakt spiegelsymmetrisch platziert (+-' + Math.abs(t0x).toFixed(3) + ')');
  }
  // Bounding-Box aus den POSITION-Accessoren + Node-Translation: Gesamtbreite ~5.28 Blender.
  let minX = Infinity, maxX = -Infinity;
  for (const nd of (glb.nodes || [])) {
    if (nd.mesh == null) continue;
    const tx = (nd.translation || [0, 0, 0])[0];
    for (const p of glb.meshes[nd.mesh].primitives) {
      const a = glb.accessors[p.attributes.POSITION];
      if (a && a.min && a.max) { minX = Math.min(minX, tx + a.min[0]); maxX = Math.max(maxX, tx + a.max[0]); }
    }
  }
  ok(maxX - minX > 4.5 && maxX - minX < 6.0, 'GLB-Bounding-Box plausibel (Breite ' + (maxX - minX).toFixed(2) + ' Blender-Einheiten, Sockelaussenkanten 2*2.641)');
}

// ── Renderer-Einbindung: statische Pruefung des echten initR3D-Codes in index.html ──
// Genau EIN Ladevorgang fuer das GERADE Tor-GLB; das gebogene Tor ist vollstaendig weg.
ok(/\.load\('assets\/arena_football_goal\.glb'/.test(HTML), 'Loader-Pfad ist assets/arena_football_goal.glb (gerades Tor)');
const loadCount = (HTML.match(/\.load\('assets\/arena_football_goal\.glb'/g) || []).length;
ok(loadCount === 1, "Tor-GLB wird genau EINMAL geladen (erhalten: " + loadCount + ')');
ok(!/arena_football_goal_curved/.test(HTML), 'Das gekruemmte Kreis-Tor (arena_football_goal_curved.glb) wird nicht mehr geladen');
// Zweite Instanz ist ein Clone desselben geladenen Assets (geteilte Geometrie/Materialien).
ok(/goalProto\.clone\(true\)/.test(HTML), 'Zweite Torinstanz nutzt einen Clone desselben Assets (kein zweiter Load)');
// Genau zwei Instanzen in den Produktmodi: goalDefs() liefert dort exakt +X (Rot) und -X (Blau).
// Der vierte Eintrag entsteht nur in der Dev-Variante Elimination4.
ok(/:\s*\[\{dir:\[1,0\],col:1,key:1\},\{dir:\[-1,0\],col:0,key:-1\}\]/.test(HTML),
   'Genau zwei Torinstanzen im Football-Modus (+X und -X)');
// Position: Tor-Mitte auf goalAnchor = halfLen + FB_GOAL_HALF_DEPTH -> Sockelvorderkante
// exakt auf der Bandeninnenflaeche. Dieselbe FOOTBALL_ARENA-Quelle wie die Physik.
ok(/AV=fbArena\(\)/.test(HTML), 'Renderer-Torgeometrie kommt aus fbArena() (eine Quelle mit der Physik)');
ok(/g\.position\.set\(d\[0\]\*AV\.goalAnchor\*BR\*FB_U,GOAL_WALK_Y,d\[1\]\*AV\.goalAnchor\*BR\*FB_U\)/.test(HTML),
   'Torposition dir*goalAnchor*BR*FB_U (Sockelvorderkante == Bandeninnenflaeche)');
// Rotationsdifferenz exakt PI: GOAL_ROT = atan2(-dx,-dz) liefert fuer +X exakt -PI/2 und
// fuer -X exakt +PI/2 — dieselben Zahlen wie zuvor, jetzt aus einer Formel statt aus einer
// Achsentabelle (die Elimination-Phasen brauchen auch 120-Grad-Richtungen).
ok(/g\.rotation\.set\(0,GOAL_ROT\(d\),0\)/.test(HTML) &&
   /const GOAL_ROT=\(d\)=>Math\.atan2\(-d\[0\],-d\[1\]\);/.test(HTML) &&
   Math.atan2(-1, -0) === -Math.PI / 2 && Math.atan2(1, -0) === Math.PI / 2,
   'Rotationsdifferenz beider Tore exakt PI (Oeffnung zur Arenamitte)');
// Gleiche Skalierung: EIN goalScale fuer beide, aus BR/GLB_R/R0 abgeleitet (keine Magic-Number).
ok(/const goalScale=\(2\*BR\)\*GLB_R\/R0/.test(HTML), 'Tor-Skalierung aus 2*BR*GLB_R/R0 abgeleitet (keine eigenstaendige Torbreiten-Magic-Number)');
// Gerade Torlinie: PlaneGeometry quer ueber die lichte Oeffnung, Halbbreite = postInner.
ok(/const rectLineHalf=AV\.postInner\*BR\*FB_U;/.test(HTML), 'Torlinien-Halbbreite = FOOTBALL_ARENA.postInner (lichte Oeffnung, keine zweite Breite)');
ok(/new THREE\.PlaneGeometry\(GOAL_LINE_W,rectLineHalf\*2\)/.test(HTML), 'Torlinie ist ein GERADES Band (rectLineGeo/PlaneGeometry, kein Kreisbogen)');
// Sichtbarkeit NUR bei mode==='football' (und nicht im Menue-Preview) — gemeinsames footballView-Gate.
ok(/const footballView=\(mode==='football'\)&&!menuVisible/.test(HTML), "Tore nur sichtbar bei mode==='football' (nicht Menue/normale Modi)");
ok(/goalGroup\.visible=footballView/.test(HTML), 'Tor-Sichtbarkeit haengt am football-scoped footballView-Gate');
// Skaliert + schwebt mit der Plattform (gleiches sc/bob wie bGroup) — gleiches lokales System.
ok(/goalGroup\.scale\.setScalar\(sc\)/.test(HTML) && /goalGroup=new THREE\.Group\(\);goalGroup\.position\.set\(cx,0,cy\)/.test(HTML),
  'Tore liegen im lokalen Arena-System (Gruppe bei (cx,0,cy), mit sc skaliert)');
// Wiederverwendung der bestehenden Szene/Renderer: kein neuer WebGLRenderer/Scene/Camera fuer Tore.
ok((HTML.match(/new THREE\.WebGLRenderer/g) || []).length === 1, 'Kein zusaetzlicher Renderer fuer die Tore (bestehende Szene wiederverwendet)');
// RINGOUT UNVERAENDERT: der bestehende Grenz-Torus (Out-Kante) und die Warnzone sind unangetastet.
ok(/new THREE\.TorusGeometry\(GLB_R,\.075,12,176\)/.test(HTML), 'RingOut-Bande (Grenz-Torus an GLB_R) unveraendert');
ok(/new THREE\.RingGeometry\(9\.55,10\.05,128\)/.test(HTML), 'RingOut-Warnzone unveraendert');

// ════════════════════════════════════════════════════════════════════════════
// Arena-Football — BANDEN-ASSET (freigegebene transparente Blender-Bande, GLB)
// Ersetzt die fruehere prozedurale Bogen-/Luecken-Loesung vollstaendig. Reiner
// Export + Renderer-Einbindung; keine Physik/Kollision/Gameplay. GLB maschinell geprueft.
// ════════════════════════════════════════════════════════════════════════════

// ── Band-GLB maschinell parsen (dependency-frei: JSON-Chunk des glTF-Binary) ──
const BAND_PATH = path.join(__dirname, '..', 'assets', 'arena_football_band.glb');
ok(fs.existsSync(BAND_PATH), 'Band-GLB assets/arena_football_band.glb vorhanden');
let band = null;
if (fs.existsSync(BAND_PATH)) {
  const buf = fs.readFileSync(BAND_PATH);
  ok(buf.readUInt32LE(0) === 0x46546C67, 'Band-GLB-Magic korrekt (glTF)');
  const total = buf.readUInt32LE(8);
  let off = 12, json = null;
  while (off < total) {
    const clen = buf.readUInt32LE(off), ctype = buf.readUInt32LE(off + 4);
    if (ctype === 0x4E4F534A) json = JSON.parse(buf.slice(off + 8, off + 8 + clen).toString('utf8'));
    off += 8 + clen;
  }
  band = json;
}
if (band) {
  const nodeNames = (band.nodes || []).map(n => n.name);
  const matNames = (band.materials || []).map(m => m.name);
  const rootIdx = (band.scenes && band.scenes[band.scene || 0]) ? band.scenes[band.scene || 0].nodes : [];
  const rootNames = rootIdx.map(i => nodeNames[i]);
  const lights = (band.extensions && band.extensions.KHR_lights_punctual && band.extensions.KHR_lights_punctual.lights) || [];
  // Genau EIN Banden-Asset: genau ein Root-Node AF_Band_Root.
  ok(rootNames.length === 1 && rootNames[0] === 'AF_Band_Root', 'Band-GLB hat genau EINEN Root-Node AF_Band_Root — keine zweite Bandeninstanz');
  ok(nodeNames.length > 0 && nodeNames.every(n => n && n.startsWith('AF_Band')), 'Band-GLB enthaelt ausschliesslich AF_Band*-Objekte');
  // Keine importierte Arena / keine Tore / keine Crystal*/Ped*-Nodes / keine Profil-/Preview-Objekte.
  ok(!nodeNames.some(n => /ArenaImport|Pillar|Walkway|Tier|Temple|PlayFloor|WallRing|Cornice/i.test(n)), 'Band-GLB enthaelt keine importierte RingOut-Arena');
  ok(!nodeNames.some(n => /Goal/i.test(n)), 'Band-GLB enthaelt keine Tore');
  ok(!nodeNames.some(n => /Crystal/i.test(n)), 'Band-GLB enthaelt keine Crystal*-Objekte');
  ok(!nodeNames.some(n => /^Ped/i.test(n)), 'Band-GLB enthaelt keine Ped*-Objekte');
  ok(!nodeNames.some(n => /Preview|Floor|prof/i.test(n)), 'Band-GLB enthaelt keine Preview-/Profil-Objekte');
  ok((band.cameras || []).length === 0, 'Band-GLB enthaelt keine Kamera');
  ok(lights.length === 0 && !(band.extensionsUsed || []).includes('KHR_lights_punctual'), 'Band-GLB enthaelt keine Lichter');
  ok(matNames.includes('AF_Band_Glass'), 'Band-GLB enthaelt das Glas-Material (AF_Band_Glass)');
  ok(matNames.includes('AF_Band_Gold'), 'Band-GLB enthaelt das Gold-Material (AF_Band_Gold)');
  ok(matNames.includes('AF_Band_Marble'), 'Band-GLB enthaelt das Marmor-Material (AF_Band_Marble)');
  ok(matNames.length === 3, 'Band-GLB hat genau drei Banden-Materialien (Glas/Gold/Marmor, erhalten: ' + matNames.length + ')');
  ok(!(band.extensionsUsed || []).includes('KHR_draco_mesh_compression'), 'Band-GLB nutzt keine Draco-Kompression');
  // ── Zwei Toroeffnungen bei +X/-X sind Bestandteil der Geometrie ──
  // Genau zwei Glas-Boegen (AF_Band_Glass_0/_1) — je einer zwischen den beiden Oeffnungen.
  const glassCount = nodeNames.filter(n => /^AF_Band_Glass_/.test(n)).length;
  ok(glassCount === 2, 'Band-GLB hat genau zwei Glas-Boegen (zwei Segmente -> zwei Oeffnungen), erhalten: ' + glassCount);
  // Vier Endpfosten markieren die vier Oeffnungsraender (zwei je Oeffnung).
  const endcaps = (band.nodes || []).filter(n => /^AF_Band_EndCap_\d_[AB]$/.test(n.name) && n.translation);
  ok(endcaps.length === 4, 'Band-GLB hat vier Endpfosten an den Oeffnungsraendern (zwei je Oeffnung), erhalten: ' + endcaps.length);
  // Kein Endpfosten liegt in der Oeffnungsmitte (glTF-Z ~ tangential): bei +X (0) und -X (PI) ist die Luecke frei.
  const onAxis = endcaps.filter(n => Math.abs(n.translation[2]) < 0.5);
  ok(onAxis.length === 0, 'Kein Endpfosten in der Oeffnungsmitte (+X/-X) — die zwei Oeffnungen sind frei');
  // ── Radius/Hoehe plausibel: Bande liegt auf dem Arena-Walkway (~R=9.5), Basis nahe Walkway-Oberkante ──
  // Radius exakt aus den punktplatzierten Post-/EndCap-Nodes (Node-Translation, glTF X/Z-Ebene).
  const pts = (band.nodes || []).filter(n => /^AF_Band_(Post|EndCap)_\d/.test(n.name) && n.translation);
  let rmax = 0, rmin = Infinity;
  for (const n of pts) { const r = Math.hypot(n.translation[0], n.translation[2]); rmax = Math.max(rmax, r); rmin = Math.min(rmin, r); }
  ok(rmax > 8.5 && rmax < 11.0 && rmin > 8.5, 'Band-Radius plausibel auf dem Walkway (~9.5 GLB-Einheiten; min ' + rmin.toFixed(2) + ' / max ' + rmax.toFixed(2) + ')');
  // Hoehe: glTF-Y ueber alle Mesh-Nodes (Node-Translation + Accessor-Y-Bereich).
  let minY = Infinity, maxY = -Infinity;
  for (const nd of (band.nodes || [])) {
    if (nd.mesh == null) continue;
    const ty = (nd.translation || [0, 0, 0])[1];
    for (const p of band.meshes[nd.mesh].primitives) {
      const a = band.accessors[p.attributes.POSITION];
      if (a && a.min && a.max) { minY = Math.min(minY, ty + a.min[1]); maxY = Math.max(maxY, ty + a.max[1]); }
    }
  }
  ok(minY < 0.5 && maxY > 1.0 && (maxY - minY) < 2.5, 'Band-Hoehe plausibel: Basis nahe Walkway (' + minY.toFixed(2) + '), Barriere bis ' + maxY.toFixed(2) + ' GLB-Einheiten');
}

// ════════════════════════════════════════════════════════════════════════════
// Arena-Football — BANDEN-INTEGRATION (Renderer-Einbindung in initR3D)
// Seit der Arena-Finalisierung wird das Band-GLB NUR noch als MATERIALQUELLE geladen
// (fbMat.glass/gold/marble); seine kreisfoermige Geometrie haengt nicht mehr in der
// Szene (bandGroup entfernt). Die sichtbare Arena entsteht prozedural in fbBuildShape
// aus DENSELBEN FOOTBALL_ARENA-Parametern wie die Physikgrenze. Die frueheren
// bandGroup-/Kreisband-Sichtbarkeitspruefungen sind ersatzlos gestrichen (Feature
// entfernt); geprueft wird der neue kanonische Aufbau.
// ════════════════════════════════════════════════════════════════════════════

// ── Genau EIN Band-GLB-Load (kein Mehrfach-Laden/Duplizieren) ──
const bandLoadCount = (HTML.match(/\.load\('assets\/arena_football_band\.glb'/g) || []).length;
ok(bandLoadCount === 1, 'Band-GLB wird genau EINMAL geladen (erhalten: ' + bandLoadCount + ')');
// ── Nur Materialquelle: keine Szeneninstanz des Band-GLB mehr ──
ok(!/bandGroup/.test(HTML), 'Keine bandGroup mehr — das Band-GLB haengt nicht mehr als Instanz in der Szene');
ok(!/scene\.add\(bandProto\)|bGroup\.add\(bandProto\)/.test(HTML), 'bandProto wird nur traversiert (Materialquelle), nie in die Szene gehaengt');
ok(/if\(nm\.includes\('Glass'\)\)fbMat\.glass=m;else if\(nm\.includes\('Gold'\)\)fbMat\.gold=m;else if\(nm\.includes\('Marble'\)\)fbMat\.marble=m;/.test(HTML),
  'Band-GLB liefert die geteilten Materialinstanzen fbMat.glass/gold/marble');
// ── Prozedurale Rounded-Rectangle-Arena aus den Physikparametern ──
// Der Parameter traegt seit der Arena-Transition die optionale Zwischenform; ohne ihn
// baut die Funktion unveraendert die Form der aktiven Phase.
ok(/const fbBuildShape=\(mo\)=>\{/.test(HTML), 'fbBuildShape baut die sichtbare Football-Arena prozedural auf');
ok(/const hx=av\.halfLen\*BR\*FB_U,hz=av\.halfWid\*BR\*FB_U,rc=av\.corner\*BR\*FB_U;/.test(HTML),
  'fbBuildShape nutzt DIESELBEN FOOTBALL_ARENA-Parameter wie footballShapeSD (eine Formquelle)');
ok(/const gap=av\.postOuter\*BR\*FB_U;/.test(HTML), 'Bandenoeffnung endet an der Sockel-Aussenkante (postOuter) — kein offener Streifen neben dem Tor');
for (const helper of ['fbOutline', 'fbBandPath', 'fbSweep', 'fbStrip', 'fbFill'])
  ok(new RegExp('const ' + helper + '=').test(HTML), 'Prozeduraler Aufbau-Helfer ' + helper + ' vorhanden');
// Aufbau einmalig, sobald die Materialquelle geladen ist — und erneut ausschliesslich bei
// einem echten Wechsel der Arenavariante (fbLayout). In Classic/Tactical bleibt es damit bei
// genau einem Aufbau; ein zweiter entsteht nur beim Wechsel in die Dev-Variante Elimination4.
// fbWant traegt ausserhalb der Transition weiterhin die Arenavariante; waehrend der
// Transition den Fortschrittsschritt. In beiden Faellen baut nur ein WECHSEL neu auf.
ok(/if\(fbWant&&\(!fbShapeGroup\|\|fbLayout!==fbWant\)\)\{fbBuildShape\(fbDesc\);/.test(HTML), 'Aufbau laeuft einmalig, sobald die Materialquelle geladen ist');
// ── Sichtbarkeiten: prozedurale Arena + Tore im Football, runde Plattform + Ringe sonst ──
ok(/if\(fbShapeGroup\)fbShapeGroup\.visible=footballView/.test(HTML), 'fbShapeGroup.visible haengt am football-scoped footballView-Gate');
// Review-Fix der Finalisierung: die runde Plattform weicht nur, wenn die prozedurale
// Rechteckarena wirklich gebaut wurde (rectReady) — faellt das Band-GLB aus, bleibt sie
// als Notboden sichtbar statt Baelle/Tore vor dem Himmel schweben zu lassen.
ok(/const rectReady=footballView&&!!fbShapeGroup;/.test(HTML), 'rectReady koppelt das Ausblenden der runden Plattform an die gebaute Rechteckarena');
ok(/for\(const o of fbPlatformTops\)o\.visible=!rectReady/.test(HTML), 'Runde Plattform weicht im Football-Modus der Rechteckarena (nur wenn gebaut)');
ok(/boundaryFull=\[zone,main,g\]/.test(HTML), 'boundaryFull haelt die drei Vollkreis-Sichtringe (Warnzone/Leuchtring/Goldring)');
ok(/if\(boundaryFull\)for\(const bm of boundaryFull\)bm\.visible=!rectReady/.test(HTML), 'Vollkreis-Sichtringe nur in normalen Modi sichtbar (bzw. als Fallback ohne Rechteckarena)');
// ── Kamera-Framing folgt der Rechteckarena (getrennte Bedarfe je Achse) ──
// Review-Fix: horizontal zaehlt die Deck-/Toraussenkante (postBack + Ballradius), sonst
// beschneidet ein schmaler Viewport die Tore; vertikal weiter fbHalfWid.
ok(/const fbEdgeX=fbFrame\?fbArena\(\)\.postBack\*BR\+FOOTBALL_BALL_RADIUS:0;/.test(HTML),
  'Kamera-Framing deckt horizontal die Deck-Aussenkante (postBack + Ballradius)');
// Classic/Tactical: getrennte Bedarfe je Achse (elimView ist dort 0 und faellt weg).
// Elimination4: ein gemeinsamer Sichtradius je Arenaphase.
ok(/const elimView=fbFrame&&fbElim4\(\)\?fbElimViewR\(\):0;/.test(HTML) &&
   /const needX=fbFrame\?\(elimView\|\|fbEdgeX\)\+\(need-R0\):need;/.test(HTML) &&
   /const needZ=fbFrame\?\(elimView\|\|fbHalfWid\(\)\)\+\(need-R0\):need;/.test(HTML),
  'Kamera-Framing nutzt Rechteckbedarfe je Achse, andere Modi den symmetrischen Bedarf');

// ── Drei originale Vollkreis-Sichtringe unveraendert vorhanden ──
ok(/new THREE\.TorusGeometry\(GLB_R,\.075,12,176\)/.test(HTML), '360-Grad Leuchtring-Vollkreis unveraendert (normale Modi)');
ok(/new THREE\.RingGeometry\(9\.55,10\.05,128\)/.test(HTML), '360-Grad Warnzonen-Vollkreis unveraendert (normale Modi)');
ok(/new THREE\.TorusGeometry\(9\.5,\.02,10,160\)/.test(HTML), '360-Grad Goldring-Vollkreis unveraendert (normale Modi)');
ok(/mainBMat=mainMat/.test(HTML), 'Grenz-Puls-Material (mainBMat) unveraendert an mainMat gebunden');

// ── Physik: Spawn und Bande haengen an FOOTBALL_ARENA (alter Kreiscode entfernt) ──
ok(/const off=fbArena\(\)\.spawn\*BR;/.test(HTML), 'Football-Spawn aus FOOTBALL_ARENA.spawn (7.65*BR)');
ok(!/const off=R\*0\.42/.test(HTML), 'Alter Kreis-Spawn (R*0.42) entfernt');
ok(/const fbs=footballBoundSD\(fb\),fbd=fbs\.sd;/.test(HTML), 'stepSim loest die Bande ueber footballBoundSD (Signed Distance) auf');
ok(/fb\.vx-=\(1\+RBAND\)\*fvn\*fnx/.test(HTML), 'Bandenreflexion unveraendert mit RBAND=curRestBand()');
ok(!/flim=R-BR/.test(HTML), 'Der alte Radialtest (flim=R-BR) ist ersatzlos entfernt');

// ── Keine neue Szene/Kamera/Renderer (bestehende Infrastruktur wiederverwendet) ──
ok((HTML.match(/new THREE\.Scene\(\)/g) || []).length === 1, 'Genau eine Szene (keine zweite Arena/Szene)');
ok((HTML.match(/new THREE\.PerspectiveCamera/g) || []).length === 1, 'Genau eine Kamera (keine neue Kamera)');
ok((HTML.match(/new THREE\.WebGLRenderer/g) || []).length === 1, 'Genau ein Renderer (bestehende Szene wiederverwendet)');

// ── Untere Statuszeile: die Labels der Integrations-Shell sind vollstaendig weg ──
// (UX-Phase 2B: der finale Football-Modus zeigt unten gar keine Meldung mehr; wer am Zug
// ist, traegt die aktive Teamkarte im HUD. Details in Abschnitt "UX-PHASE 2B" unten.)
ok(!/Tore folgen im nächsten Schritt/.test(HTML), "HUD-Hinweis enthaelt nicht mehr 'Tore folgen im naechsten Schritt'");
ok(!/Arena Football · Visuelle Integration/.test(HTML), "alte Shell-Meldung 'Arena Football · Visuelle Integration' entfernt");

// ── Tor-Load bleibt gekapselt; initR3D-Fehler weiterhin protokolliert ──
ok(/g\.scale\.setScalar\(goalScale\)/.test(HTML), 'Torskalierung (goalScale) unveraendert');
ok(/\}catch\(_\)\{goalGroup=null;fbBuildGoals=null;\}/.test(HTML), 'Tor-GLB-Load bleibt in try/catch gekapselt (additiv)');
ok(/console\.error\('INITR3D_FAIL'/.test(HTML), 'initR3D-Fehler wird weiterhin protokolliert (kein stiller Abbruch)');
// Das gekruemmte Tor der Kreisarena ist restlos weg (Konstanten inklusive).
ok(!/GOAL_CURVE_R/.test(HTML), 'GOAL_CURVE_R (Kruemmungsradius des Kreis-Tors) vollstaendig entfernt');

// ════════════════════════════════════════════════════════════════════════════
// Arena-Football — GLAS-/MATERIALQUALITAET der Bande (unveraendert aus der
// Korrekturrunde; die Tor-Platzierungs-Pruefungen der Kreisarena sind mit dem
// gekruemmten Tor ersatzlos gestrichen)
// ════════════════════════════════════════════════════════════════════════════

// Glas: nahezu farblos, klar, dezente Reflexe (nicht milchig/weiss/plastik). Nur Optik.
// Geprueft wird der Glass-Zweig der Band-Materialbehandlung (fbTex-Kopien fuer opake
// prozedurale Bauteile duerfen DoubleSide sein — deshalb der gescope-te Grab).
const glassBranchSrc = grab(/if\(nm\.includes\('Glass'\)\)\{[\s\S]*?\}else if\(nm\.includes\('Gold'\)\)/, 'Glass-Materialzweig');
ok(/nm\.includes\('Glass'\)/.test(HTML), 'Banden-Materialbehandlung erkennt das Glas-Material am Namen');
ok(/m\.transmission=1\.0/.test(glassBranchSrc) && /m\.roughness=0\.05/.test(glassBranchSrc), 'Glas: hohe Transmission + niedrige (nicht kuenstlich null) Roughness');
ok(/m\.ior=1\.5/.test(glassBranchSrc) && /m\.thickness=0\.05/.test(glassBranchSrc), 'Glas: IOR 1.5 + duenne Wandstaerke (klar, kaum optische Dichte)');
ok(/m\.color=new THREE\.Color\(1,1,1\)/.test(glassBranchSrc), 'Glas: neutrale/farblose Basisfarbe (keine Weiss-/Blaufaerbung)');
ok(/m\.attenuationColor=new THREE\.Color\(1,1,1\)/.test(glassBranchSrc) && /m\.attenuationDistance=Infinity/.test(glassBranchSrc), 'Glas: Attenuation deaktiviert (keine Eigenfaerbung/-aufhellung)');
ok(/m\.clearcoat=0\.15/.test(glassBranchSrc) && /m\.clearcoatRoughness=0\.1/.test(glassBranchSrc), 'Glas: nur dezenter Clearcoat (kein Plastik-Glanz)');
ok(/m\.envMapIntensity=1\.0/.test(glassBranchSrc), 'Glas: moderater HDRI-Reflex (envMapIntensity 1.0, nicht ueberstrahlt)');
ok(/m\.side=THREE\.FrontSide/.test(glassBranchSrc) && /m\.transparent=false/.test(glassBranchSrc) && /m\.depthWrite=true/.test(glassBranchSrc), 'Glas: einseitig + Transmission-Pass (kein opacity-Faking, keine milchige Ueberlagerung)');
ok(!/DoubleSide/.test(stripComments(glassBranchSrc)), 'Keine DoubleSide-Glasflaeche (kein doppelter Milchglas-Layer)');
ok(/nm\.includes\('Gold'\)/.test(HTML) && /nm\.includes\('Marble'\)/.test(HTML), 'Gold- und Marmor-Material weiterhin am Namen erkannt und veredelt');
// Geometrie/Asset der Bande bleiben unangetastet (nur Materialparameter veraendert).
ok(!/bandProto\.scale|bandProto\.position\.set/.test(HTML), 'Band-GLB-Geometrie/Transform unveraendert (reine Materialquelle)');

// ══════════════════════════════════════════════════════════════════════════════
// PHYSIKPHASE 4B-1 — ITERATIVE KONTAKTAUFLOESUNG GEGEN PINNING
// Geprueft wird ausschliesslich die STRUKTUR der Aenderung, nicht ihr Tuning-Effekt:
// Iterationszahl, Mode-Scoping, genau EINE Integration je Micro-Step und die
// Unveraendertheit aller Tuning-Konstanten. Die Wirkungsmessung (Restueberlappung,
// Bandenkeil, A/B gegen ci=1) liegt in tools/test_football_flow.js.
// ══════════════════════════════════════════════════════════════════════════════

// ── A. Iterationszahl ──
{
  const it = buildEnv('football', 'single');
  ok(it.contactIterations === 3,
     'FOOTBALL_CONTACT_ITERATIONS traegt zur Laufzeit den Wert 3 (erhalten: ' + it.contactIterations + ')');
  ok(/const FOOTBALL_CONTACT_ITERATIONS=3;/.test(HTML),
     'FOOTBALL_CONTACT_ITERATIONS=3 ist als benannte Konstante in index.html definiert');
  ok(Number.isInteger(it.contactIterations) && it.contactIterations >= 1,
     'Iterationszahl ist eine feste ganze Zahl >= 1 (deterministisch, keine Toleranz-Abbruchbedingung)');
}

// ── B. Mode-Scoping: Football iteriert, alle anderen Modi genau einmal ──
// Strukturell UND verhaltensbasiert. Gezaehlt wird der Kopf des jeweiligen
// Grenzblocks: footballResolvePost (Football-Zweig) bzw. ballsOutside (Ring-Out-Zweig).
// Beide liegen innerhalb der Iterationsschleife -> Aufrufe = Micro-Steps x Kontaktpaesse.
ok(/const ci=mode==='football'\?FOOTBALL_CONTACT_ITERATIONS:1;/.test(HTML),
   "Iterationszahl ist auf mode==='football' gescoped (sonst hart 1)");
ok(/for\(let it=0;it<ci;it\+\+\)\{/.test(HTML), 'Kontaktaufloesung laeuft in einer Schleife ueber ci');
{
  const MICRO = 2;   // stepSim() fuehrt zwei Micro-Steps pro Aufruf aus
  const probe = { vx: 0.5, vy: 0, owner: 0 };   // ruhig, kontaktfrei, weit weg von Sockel und Bande

  const Fi = buildEnv('football', 'single');
  Fi.setBalls([{ x: Fi.cx + 120, y: Fi.cy, ...probe }]);
  Fi.resetPassCounts();
  Fi.step();
  const cF = Fi.passCounts();
  ok(cF.post === MICRO * Fi.contactIterations,
     'Football: ' + MICRO + ' Micro-Steps x ' + Fi.contactIterations + ' Kontaktpaesse = ' +
     (MICRO * Fi.contactIterations) + ' Grenzdurchgaenge (erhalten: ' + cF.post + ')');
  ok(cF.outside === 0, 'Football nutzt den Ring-Out-Pfad nicht (ballsOutside 0x)');

  const Bi = buildEnv('bot', 'single');
  Bi.setBalls([{ x: Bi.cx + 120, y: Bi.cy, ...probe }]);
  Bi.resetPassCounts();
  Bi.step();
  const cB = Bi.passCounts();
  ok(cB.outside === MICRO,
     'Nicht-Football: genau EIN Kontaktpass je Micro-Step (' + MICRO + ' Durchgaenge, erhalten: ' + cB.outside + ')');
  ok(cB.post === 0, 'Nicht-Football beruehrt den Football-Grenzblock nicht (footballResolvePost 0x)');
  ok(cB.outside < cF.post, 'Nur der Football-Modus iteriert die Kontaktaufloesung mehrfach');
}

// ── C. Integration und Daempfung laufen genau EINMAL je Micro-Step ──
// Nachweis ueber die kontaktfreie Flugbahn: waeren Integration oder Daempfung mit in
// die Iterationsschleife gerutscht, waeren Weg und Restgeschwindigkeit nach einem
// stepSim() messbar anders. Der Erwartungswert wird aus den EXTRAHIERTEN Konstanten
// gebildet, nicht aus duplizierten Zahlen.
{
  const start = { x: 300, y: 500, vx: 3.0, vy: 0 };
  // Erwartungswert aus der TATSAECHLICH aktiven Daempfung des jeweiligen Modells.
  // Seit Movement M1 bringt der Football-Modus auch eine EIGENE Umschaltschwelle mit
  // (curSLOWV, im Preset slowv=0.50) — der Erwartungswert nutzt exakt denselben Accessor.
  const expect = (env) => {
    const E = env.effective();
    let x = start.x, y = start.y, vx = start.vx, vy = start.vy;
    for (let s = 0; s < 2; s++) {
      x += vx; y += vy;
      const f = Math.sqrt(vx * vx + vy * vy) < E.slowv ? E.fe : E.fr;
      vx *= f; vy *= f;
    }
    return { x, y, vx, vy };
  };
  const oneStep = (env) => { env.setBalls([{ ...start, x: env.cx - 200, y: env.cy, owner: 0 }]);
    env.step(); return env.get().balls[0]; };
  for (const m of ['PROD', 'BASELINE']) {
    const env = buildEnv('football', 'single', m);
    const e = expect(env), g = oneStep(env);
    ok(g.x === e.x - start.x + (env.cx - 200) && g.y === env.cy,
       m + ': kontaktfreie Position nach einem stepSim exakt = 2x Integration (kein zusaetzlicher Schritt)');
    ok(g.vx === e.vx && g.vy === e.vy,
       m + ': kontaktfreie Geschwindigkeit exakt = 2x Daempfung (Daempfung nicht in der Iterationsschleife)');
  }
  // Die Kontakt-Iteration selbst hat keine Nebenwirkung: mit abgeschalteter Football-Physik
  // ist die kontaktfreie Flugbahn im Football-Modus bit-identisch zum Bot-Modus.
  const gF = oneStep(buildEnv('football', 'single', 'BASELINE'));
  const gB = oneStep(buildEnv('bot', 'single'));
  ok(gF.x === gB.x && gF.y === gB.y && gF.vx === gB.vx && gF.vy === gB.vy,
     'kontaktfreie Flugbahn in Football (Baseline) und Nicht-Football bit-identisch (Iteration ohne Nebenwirkung)');
}
// Strukturell: genau eine Integrationsanweisung, und sie steht VOR der Iterationsschleife.
{
  const iInteg = stepSimSrc.indexOf('b.x+=b.vx;b.y+=b.vy;');
  const iLoop = stepSimSrc.indexOf('for(let it=0;it<ci;it++)');
  ok(iInteg >= 0 && iLoop > iInteg,
     'Integration/Daempfung steht oberhalb der Kontakt-Iterationsschleife');
  ok(stepSimSrc.split('b.x+=b.vx;b.y+=b.vy;').length - 1 === 1,
     'es gibt genau EINE Integrationsanweisung in stepSim');
  ok(stepSimSrc.split('for(let it=0;it<ci;it++)').length - 1 === 1,
     'es gibt genau EINE Kontakt-Iterationsschleife in stepSim');
}
// Treffer-Feedback haengt am ersten Kontaktpass (keine doppelten Sounds/Partikel).
ok(/if\(it===0\)\{/.test(HTML), 'Treffer-Feedback ist auf den ersten Kontaktpass begrenzt (if(it===0))');

// ── D. Tuning-Konstanten unveraendert (Pin gegen versehentliche Aenderung in 4B) ──
// 4B-1 ist eine reine Aufloesungs-Aenderung. Masse, Restitution, Daempfung und Launch
// bleiben exakt auf dem Stand der 4A-Baseline; jede Abweichung muss hier auffallen.
{
  const T = buildEnv('football', 'single').tune();
  ok(T.REST === 0.25, 'REST unveraendert 0.25 (erhalten: ' + T.REST + ')');
  ok(T.FRICTION === 0.992, 'FRICTION unveraendert 0.992 (erhalten: ' + T.FRICTION + ')');
  ok(T.FEND === 0.992, 'FEND unveraendert 0.992 (erhalten: ' + T.FEND + ')');
  ok(T.STOPV === 0.10, 'STOPV unveraendert 0.10 (erhalten: ' + T.STOPV + ')');
  ok(T.SLOWV === 0.35, 'SLOWV unveraendert 0.35 (erhalten: ' + T.SLOWV + ')');
  ok(T.LAUNCH === 0.034, 'LAUNCH unveraendert 0.034 (erhalten: ' + T.LAUNCH + ')');
  ok(T.MAXPULL_FRAC === 0.40, 'MAXPULL_FRAC unveraendert 0.40 (erhalten: ' + T.MAXPULL_FRAC + ')');
  ok(T.SPIN_K === 0.004 && T.SPIN_DECAY === 0.985, 'Spin-Konstanten unveraendert (0.004 / 0.985)');
  // Kein Massenmodell eingefuehrt: der Stossimpuls bleibt die m=1-Zweikoerperformel.
  // Seit 4B-2 traegt sie die kontaktartabhaengige Restitution RB=curRestBall(); die
  // Division durch 2 (gleiche Massen) und die Struktur der Formel sind unveraendert.
  ok(/const imp=-\(1\+RB\)\*vn\/2;/.test(HTML),
     'Ball-Ball-Impuls bleibt die m=1-Zweikoerperformel -(1+RB)*vn/2 (keine Masse eingefuehrt)');
  ok(/const FR=curFR\(\),FE=curFE\(\),RB=curRestBall\(\),RBAND=curRestBand\(\);/.test(HTML),
     'RB stammt aus curRestBall() (zentrale Konfiguration, keine Magic Number in stepSim)');
  ok(/a\.x-=nx\*ov\/2;a\.y-=ny\*ov\/2;b\.x\+=nx\*ov\/2;b\.y\+=ny\*ov\/2;/.test(HTML),
     'Positionskorrektur unveraendert strikt haelftig (keine gewichtete Trennung)');
}

// ══════════════════════════════════════════════════════════════════════════════
// MOVEMENT M1 — DER EINZIGE PRODUKTIVE FOOTBALL-PHYSIKSTANDARD
// (Nachfolger des 4B-3-GLIDE-Satzes; M1 wurde in der Movement-Prototypphase vermessen
// und manuell freigegeben, s. artifacts/football-movement-prototype/.) Geprueft wird der
// FINALE Zustand: genau ein Wertesatz mit exakt den freigegebenen M1-Werten, getrennte
// Ball-/Spielerdaempfung, keine Auswahl, kein URL-Parameter, deterministische
// Wedge-Erkennung. Die Sandbox laeuft standardmaessig durch den Produktivpfad;
// 'BASELINE' schaltet die Football-Physik ab (globale Konstanten).
// ══════════════════════════════════════════════════════════════════════════════

// ── A. Genau ein Produktivstandard mit den freigegebenen M1-Werten ──
{
  const FINAL = { friction: 0.9976, frictionBall: 0.9982, fend: 0.9905, fendBall: 0.9905,
                  slowv: 0.50, stopv: 0.050, restBall: 0.44, restBand: 0.60, restPost: 0.50 };
  const P = buildEnv('football', 'single'), prod = P.prodPhys(), T = P.tune();
  for (const k of Object.keys(FINAL))
    ok(prod[k] === FINAL[k], 'FOOTBALL_PHYS.' + k + ' = ' + FINAL[k] + ' (erhalten: ' + prod[k] + ')');
  ok(Object.keys(prod).length === 9, 'FOOTBALL_PHYS enthaelt genau diese neun Werte, keine Restfelder');
  ok((HTML.match(/const FOOTBALL_PHYS=/g) || []).length === 1,
     'FOOTBALL_PHYS ist genau einmal definiert (zentrale Konfiguration)');
  ok(/function footballPhys\(\)\{return mode==='football'\?FOOTBALL_PHYS:null;\}/.test(HTML),
     'ein einziger Zugriffspunkt footballPhys(), ohne Auswahl');
  // Preset-Umschaltungen (4B-2-Prototyp UND Movement-Prototyp) sind vollstaendig weg.
  ok(!/FOOTBALL_PRESETS/.test(HTML), 'keine FOOTBALL_PRESETS mehr im Produktivcode');
  ok(!/FOOTBALL_PRESET_DEFAULT/.test(HTML), 'kein FOOTBALL_PRESET_DEFAULT mehr im Produktivcode');
  ok(!/footballPreset/.test(HTML), 'keine Preset-Variable mehr im Produktivcode');
  ok(!/fbphys/.test(HTML), 'kein URL-Parameter ?fbphys mehr im Produktivcode');
  ok(!/wedge:\s*true/.test(HTML), 'kein Preset-Flag mehr fuer den Anti-Wedge-Block');
  // M1-Invarianten: alle Werte physikalisch plausibel und in sich konsistent.
  ok(prod.frictionBall > prod.friction && prod.frictionBall < 1,
     'der neutrale Ball rollt laenger als die Spieler (frictionBall > friction)');
  ok(prod.fend < prod.friction && prod.fendBall < prod.frictionBall,
     'Auslaufdaempfung haerter als die Gleitdaempfung (Zwei-Regime, Kriechauslauf endet frueher)');
  ok(prod.slowv > T.SLOWV && prod.stopv < T.STOPV,
     'hoehere Umschaltschwelle + tiefere Stoppschwelle als die globalen Konstanten');
  ok(prod.restBall < 1 && prod.restBand < 1 && prod.restPost < 1 &&
     prod.friction < 1 && prod.fend < 1, 'nirgends wird Energie erzeugt (alle Faktoren < 1)');
  ok(prod.restBand > prod.restPost && prod.restPost > prod.restBall,
     'restBand > restPost > restBall (Bande am lebendigsten, Pass kontrolliert)');
  ok(P.contactIterations === 3, 'FOOTBALL_CONTACT_ITERATIONS bleibt 3');
}

// ── B. Baseline-Vergleich: der Stand vor 4B-2 ist als Testmodell weiter erreichbar ──
{
  const C = buildEnv('football', 'single', 'BASELINE');
  const T = C.tune(), E = C.effective();
  ok(C.preset() === null, 'BASELINE liefert keine Football-Physik (footballPhys() === null)');
  ok(E.fr === T.FRICTION && E.fe === T.FEND && E.stopv === T.STOPV,
     'BASELINE: Daempfung und Stoppschwelle exakt die globalen Konstanten');
  ok(E.restBall === T.REST && E.restBand === T.REST && E.restPost === T.REST,
     'BASELINE: alle drei Restitutionen exakt der globale REST-Wert');
  const P = buildEnv('football', 'single').effective();
  ok(P.fr !== E.fr && P.stopv !== E.stopv && P.restBand !== E.restBand,
     'der Produktivstand unterscheidet sich messbar von der Baseline');
}

// ── C. Die Football-Physik wirkt ausschliesslich im Football-Modus ──
{
  const T = buildEnv('bot', 'single').tune();
  const Bn = buildEnv('bot', 'single'), E = Bn.effective();
  ok(Bn.preset() === null && E.fr === T.FRICTION && E.fe === T.FEND && E.stopv === T.STOPV &&
     E.restBall === T.REST && E.restBand === T.REST && E.restPost === T.REST,
     'Bot-Modus laeuft unveraendert ueber die globalen Konstanten');
  // Verhaltensbasiert: die kontaktfreie Flugbahn im Bot-Modus ist unabhaengig davon, ob
  // die Football-Physik geladen ist.
  const traj = (p) => { const e = buildEnv('bot', 'single', p);
    e.setBalls([{ x: e.cx - 200, y: e.cy, vx: 3.0, vy: 0, owner: 0 }]);
    for (let i = 0; i < 30; i++) e.step();
    const b = e.get().balls[0]; return [b.x, b.y, b.vx, b.vy].join('|'); };
  ok(traj('PROD') === traj('BASELINE'),
     'Bot-Modus: Flugbahn ueber 30 Frames bit-identisch mit und ohne geladene Football-Physik');
}

// ── D. Glide: getrennte Daempfung, getrennte Stoppschwelle, spaeteres Settlement ──
{
  const T = buildEnv('football', 'single').tune();
  ok(T.FRICTION === T.FEND, 'globale Konstanten unveraendert: FRICTION === FEND (Audit-Fixpunkt U6)');
  const E = buildEnv('football', 'single').effective();
  ok(E.fr > T.FRICTION, 'Gleitdaempfung schwaecher als bisher (' + E.fr + ' > ' + T.FRICTION + ')');
  ok(E.fe < E.fr, 'Endphasendaempfung HAERTER als die Gleitdaempfung (Zwei-Regime reaktiviert)');
  ok(E.stopv < T.STOPV, 'Settlement-Schwelle tiefer als bisher (' + E.stopv + ' < ' + T.STOPV + ')');
  // Verhaltensbasiert: gleicher Schuss, laengerer Weg und spaeteres Settlement.
  const roll = (p) => { const e = buildEnv('football', 'single', p);
    e.setBalls([{ x: e.cx, y: e.cy - 260, vx: 0, vy: 3.0, owner: 4 }]);
    let f = 0, dist = 0, prev = e.get().balls[0];
    while (f++ < 4000 && e.get().phase === 'sim') { e.step();
      const b = e.get().balls[0]; dist += Math.hypot(b.x - prev.x, b.y - prev.y); prev = b; }
    return { frames: f, dist }; };
  const rB = roll('BASELINE'), rP = roll('PROD');
  ok(rP.frames > rB.frames * 1.5,
     'Ausrollzeit steigt deutlich: Baseline ' + rB.frames + ' -> produktiv ' + rP.frames + ' Frames');
  ok(rP.dist > rB.dist * 1.5,
     'Ausrollstrecke steigt deutlich: ' + rB.dist.toFixed(0) + ' -> ' + rP.dist.toFixed(0) + ' px');
  ok(rP.frames < 4000, 'der Produktivstand settled endlich (kein ewiges Mikrokriechen)');
}

// ── E. Getrennte Restitution wirkt kontaktartabhaengig ──
{
  // Bande: Normalanteil nach dem Abprall / Normalanteil davor (gerade Laengsbande +y).
  const bandRatio = (p) => { const e = buildEnv('football', 'single', p);
    e.setBalls([{ x: e.cx, y: e.cy + e.halfWid() - e.neutralR() - 90, vx: 0, vy: 2.0, owner: 4 }]);
    let vIn = 2.0;
    for (let i = 0; i < 200; i++) { const before = e.get().balls[0]; e.step();
      const after = e.get().balls[0];
      if (after.vy < 0) { vIn = before.vy; return Math.abs(after.vy) / vIn; } }
    return null; };
  const bB = bandRatio('BASELINE'), bP = bandRatio('PROD');
  ok(bB !== null && bP !== null, 'Bandenabprall in Baseline und Produktivstand messbar');
  ok(bP > bB * 1.5,
     'Banden-Rueckprall steigt: ' + bB.toFixed(3) + ' -> ' + bP.toFixed(3));
  ok(bP < 1.0, 'Bande bleibt dissipativ (kein Energiegewinn am Rand)');
  // Pfosten und Ball-Ball nutzen eigene Werte — strukturell nachgewiesen.
  ok(/const e=curRestPost\(\);/.test(HTML), 'Pfostenreflexion nutzt curRestPost()');
  ok(/\(1\+RBAND\)\*fvn\*fnx/.test(HTML), 'Bandenreflexion nutzt RBAND=curRestBand()');
  // In den PRODUKTIVEN Kontaktformeln (stepSim, Sockelaufloesung) darf kein direkter
  // REST-Zugriff mehr stehen. Die Bot-KI-Vorausberechnung (simExchange/simSnap) rechnet
  // weiterhin mit REST — sie laeuft ausschliesslich im Bot-Modus und bleibt unangetastet.
  ok(!/\(1\+REST\)/.test(stepSimSrc) && !/\(1\+REST\)/.test(resolvePostSrc),
     'keine direkte (1+REST)-Verwendung mehr in stepSim und footballResolvePost');
  ok((HTML.match(/\(1\+REST\)/g) || []).length === 2,
     'die beiden verbliebenen (1+REST) stehen ausschliesslich in der Bot-Vorausberechnung');
}

// ── F. Wedge-Erkennung: finale, benannte Schwellen, deterministisch ──
{
  const W = buildEnv('football', 'single').wedgeConst();
  // Exakte Endwerte — jede spaetere Aenderung muss hier bewusst nachgezogen werden.
  const FINAL_W = { minContacts: 2, dot: -0.45, v: 0.25, progress: 0.40,
                    steps: 8, press: 0.01, eps: 0.5, minEscapeV: 0.12 };
  for (const k of Object.keys(FINAL_W))
    ok(W[k] === FINAL_W[k], 'FOOTBALL_WEDGE ' + k + ' = ' + FINAL_W[k] + ' (erhalten: ' + W[k] + ')');
  // ... und weiterhin innerhalb der vorgegebenen Bereiche.
  ok(W.dot <= -0.35 && W.dot >= -0.50, 'Normalen-Dot ' + W.dot + ' liegt in [-0.50,-0.35]');
  ok(W.v >= 0.20 && W.v <= 0.30, 'Geschwindigkeitsschwelle ' + W.v + ' liegt in [0.20,0.30]');
  ok(W.progress >= 0.30 && W.progress <= 0.50, 'Fortschrittsschwelle ' + W.progress + ' liegt in [0.30,0.50]');
  ok(W.steps >= 8 && W.steps <= 16, 'Mindestdauer ' + W.steps + ' Micro-Steps liegt in [8,16]');
  ok(Number.isInteger(W.steps), 'Mindestdauer ist eine feste ganze Zahl (keine Zufallserkennung)');
  ok(W.minEscapeV > 0 && W.minEscapeV <= 0.15,
     'Mindest-Escape ' + W.minEscapeV + ' px/Micro-Step ist eng begrenzt (<= 0.15)');
  ok(!/Math\.random/.test(wedgeSrc), 'Wedge-Block enthaelt keinen Zufall');
  // Fluchtrichtung: gleiche Kontaktlage -> exakt gleiche Richtung, reproduzierbar.
  const E = buildEnv('football', 'single');
  const cs = [{ nx: 1, ny: 0, other: null }, { nx: -1, ny: 0, other: null }];
  const d1 = E.escapeDir(cs), d2 = E.escapeDir(cs);
  ok(d1[0] === d2[0] && d1[1] === d2[1], 'Fluchtrichtung ist bei gleicher Lage identisch (deterministisch)');
  ok(Math.abs(Math.hypot(d1[0], d1[1]) - 1) < 1e-12, 'Fluchtrichtung ist normiert');
  ok(Math.abs(d1[0]) < 1e-12, 'exakt gegenlaeufige Normalen -> tangentiale Flucht (nicht in ein Hindernis)');
}

// ── G. Escape feuert nur nach Mindestdauer und nur im echten Keil ──
{
  // Einzelkontakt im FELDINNEREN: Ball ruht frei, ein zweiter Ball drueckt frontal.
  // Nur EINE Kontakt-Normale -> FOOTBALL_WEDGE_MIN_CONTACTS (2) ist strukturell nie
  // erfuellt, niemals ein Escape, egal wie lange. (An der Bande waere das Paar
  // Bande+Druecker bereits ein echter geschlossener Keil — das ist Absicht des Systems.)
  const E = buildEnv('football', 'single');
  E.setBalls([{ x: E.cx, y: E.cy, vx: 0, vy: 0, owner: 4 },
              { x: E.cx, y: E.cy - (E.neutralR() + E.BR), vx: 0, vy: 0.05, owner: 0 }]);
  for (let i = 0; i < 400; i++) E.step();
  ok(E.escapes() === 0, 'kein Escape bei einem einzelnen frontalen Kontaktpaar (erhalten: ' + E.escapes() + ')');

  // Freier Flug ohne jeden Kontakt: Zaehler bleibt bei 0.
  const F2 = buildEnv('football', 'single');
  F2.setBalls([{ x: F2.cx - 200, y: F2.cy, vx: 1.0, vy: 0, owner: 4 }]);
  for (let i = 0; i < 60; i++) F2.step();
  ok(F2.escapes() === 0 && F2.wedgeCounters().every((c) => c === 0),
     'kontaktfreier Ball erzeugt weder Wedge-Zaehler noch Escape');

  // Die Baseline hat den Anti-Wedge-Block ueberhaupt nicht.
  const C = buildEnv('football', 'single', 'BASELINE');
  const cbY = C.cy + C.halfWid() - C.neutralR();
  const crr = C.neutralR() + C.BR;                          // Kontaktabstand Spieler/neutraler Ball
  C.setBalls([{ x: C.cx, y: cbY, vx: 0, vy: 0, owner: 4 },
              { x: C.cx - crr * 0.5, y: cbY - crr * 0.866, vx: 0.6, vy: 1.0, owner: 0 },
              { x: C.cx + crr * 0.5, y: cbY - crr * 0.866, vx: -0.6, vy: 1.0, owner: 1 }]);
  for (let i = 0; i < 600; i++) C.step();
  ok(C.escapes() === 0, 'BASELINE loest nie einen Escape aus (Referenzmodell bleibt der alte Zustand)');
}

// ── H. Escape ist energieneutral, ausser im eng begrenzten Stillstandsfall ──
{
  const E = buildEnv('football', 'single');
  const W = E.wedgeConst();
  // Umlenkung: der Betrag der Geschwindigkeit bleibt erhalten -> keine kinetische Energie.
  ok(/const s=v>FOOTBALL_ESCAPE_MIN_V\?v:FOOTBALL_ESCAPE_MIN_V;/.test(HTML),
     'Escape uebernimmt den vorhandenen Betrag und hebt ihn nur im Stillstand auf den Mindestwert');
  ok(/b\.vx=d\[0\]\*s;b\.vy=d\[1\]\*s;/.test(HTML),
     'Escape setzt nur die RICHTUNG neu (reine Umverteilung, kein additiver Impuls)');
  // 120 Micro-Steps/s: 0.12 px/Micro-Step = 14.4 px/s. Ein Ballradius (32 px) braucht
  // damit gut zwei Sekunden — sichtbar als Gleiten, nicht als Wegschnippen.
  ok(W.minEscapeV * 120 < 20, 'Mindest-Escape entspricht ' + (W.minEscapeV * 120).toFixed(1) + ' px/s (keine Explosion)');
  const TUNE2 = E.tune();
  ok(W.minEscapeV < TUNE2.MAXPULL_FRAC * 1000 * 0.485 * TUNE2.LAUNCH * 0.02,
     'Mindest-Escape liegt unter 2 % der Launch-Obergrenze');
  ok(/b\.fbWedge=0;/.test(HTML), 'nach einem Escape startet die Mindestdauer neu (kein Dauerfeuer)');
}

// ── I. Die Football-Physik veraendert Geometrie, Tor- und Matchlogik nicht ──
// Beide Modelle muessen dasselbe Ergebnis liefern: der Produktivstand und die Baseline.
for (const p of ['PROD', 'BASELINE']) {
  const M = buildEnv('football', 'single', p);
  // Torpassage mittig -> Tor, Score, Ballfall. Startspeed 6.5 (< Launch-Maximum ~6.6):
  // die BASELINE-Daempfung (FRICTION 0.992) traegt maximal v0/(1-f) = 812 LOGICAL weit —
  // genug fuer die Torlinie bei 676.8; mit 5.0 (Reichweite 625) kaeme sie nicht mehr an.
  M.setBalls([{ x: M.cx, y: M.cy, vx: 6.5, vy: 0, owner: 4 }]);
  let f = 0; while (f++ < 1200 && M.goalState() === 'play') M.step();
  ok(M.goalState() === 'fall' && JSON.stringify(M.score()) === '[1,0]',
     p + ': Torpassage wertet unveraendert (Zustand ' + M.goalState() + ', Score ' + JSON.stringify(M.score()) + ')');
  // Vollstaendiger Ablauf fall -> spawn -> play mit frischen Kugeln
  const seq = [M.goalState()];
  for (let k = 0; k < 300; k++) { M.step(); if (seq[seq.length - 1] !== M.goalState()) seq.push(M.goalState()); }
  ok(seq.join('->') === 'fall->celebrate->spawn->play',
     p + ': Torablauf fall->celebrate->spawn->play (' + seq.join('->') + ')');
  ok(M.get().balls.length === 3, p + ': Rundenreset stellt wieder genau drei Kugeln auf');
  // Spielerkugel wird an der Toroeffnung weiterhin geblockt
  const B2 = buildEnv('football', 'single', p);
  B2.setBalls([{ x: B2.cx, y: B2.cy, vx: 5.0, vy: 0, owner: 0 }]);
  let g = 0; while (g++ < 1200 && B2.get().phase === 'sim') B2.step();
  const pb = B2.get().balls[0];
  ok(Math.abs(pb.x - B2.cx) <= B2.halfLen() - B2.BR + 1e-6 && JSON.stringify(B2.score()) === '[0,0]',
     p + ': Spielerbarriere haelt, kein Score');
  // First-to-3 unveraendert
  ok(M.winScore === 3, p + ': FOOTBALL_WIN_SCORE bleibt 3');
}

// ── J. Keine Penetration unter der produktiven Football-Physik ──
{
  const p = 'PROD';
  const M = buildEnv('football', 'single');
  const box = M.box();
  const jRad = (owner) => owner === 4 ? M.neutralR() : M.BR;
  const bY = M.cy + M.halfWid() - M.neutralR();     // neutraler Ball an der +y-Laengsbande
  const jrr = M.neutralR() + M.BR;
  M.setBalls([{ x: M.cx, y: bY, vx: 0, vy: 0, owner: 4 },
              { x: M.cx - M.BR, y: bY - jrr * 0.866, vx: 0.9, vy: 1.4, owner: 0 },
              { x: M.cx + M.BR, y: bY - jrr * 0.866, vx: -0.9, vy: 1.4, owner: 1 }]);
  let maxSd = -Infinity, minPen = Infinity;
  for (let i = 0; i < 900; i++) {
    M.step();
    for (const b of M.get().balls) {
      if (!b.alive) continue;
      minPen = Math.min(minPen, M.boxGap(b) - jRad(b.owner));   // < 0 == im Marmor
      maxSd = Math.max(maxSd, M.boundSD(b).sd);                 // > 0 == jenseits der Bande
    }
  }
  ok(minPen >= -1e-6, p + ': keine Sockelpenetration im Drei-Kugel-Keil (min Reserve ' + minPen.toFixed(4) + ')');
  ok(maxSd <= 1e-6, p + ': keine Kugel jenseits der Bandenlinie (max sd ' + maxSd.toFixed(4) + ')');
  ok(M.passedFlags().every((f) => f === false), p + ': kein Ball hat dabei die Toroeffnung passiert');
  ok(box.x0 === buildEnv('football', 'single', 'BASELINE').box().x0,
     p + ': Sockelgeometrie durch die Football-Physik unveraendert');
}

// ══════════════════════════════════════════════════════════════════════════════
// UX-PHASE 2 — ARENA-FOOTBALL-MATCH-HUD
// Geprueft wird die Abgrenzung, nicht die Optik: dass das HUD ausschliesslich im
// Football-Modus greift, dass es die BESTEHENDE Statusleiste nutzt statt einer zweiten
// Score-Engine, dass die Matchregel nur aus FOOTBALL_WIN_SCORE stammt und dass die
// Einblendungen keinen Spielzustand beruehren.
// ══════════════════════════════════════════════════════════════════════════════
const fbHudSrc = grab(/const FB_POP_MS=[\s\S]*?\nfunction updateHud\(\)\{/, 'Football-HUD-Block');
const updateHudSrc = grab(/function updateHud\(\)\{[\s\S]*?\n\}/, 'updateHud');
const newGameSrc = grab(/function newGame\(\)\{[\s\S]*?startRound\(\);\}/, 'newGame');
const showMenuSrc = grab(/function showMenu\(\)\{[\s\S]*?updScrollHint\(\);\}/, 'showMenu');
const setPhaseTextSrc = grab(/function setPhaseText\(\)\{[\s\S]*?\n\}/, 'setPhaseText');
const fbCssSrc = grab(/#game\.fb \.status\{[\s\S]*?\n\.arena-wrap\{/, 'Football-HUD-CSS');

// ── A. Aufbau: bestehende Statusleiste, Blau links, Score mittig, Rot rechts ──
{
  const iCard0 = HTML.indexOf('id="card0"'), iBox = HTML.indexOf('class="scorebox"'), iCard1 = HTML.indexOf('id="card1"');
  ok(iCard0 > 0 && iBox > iCard0 && iCard1 > iBox,
     'Reihenfolge in der Statusleiste: card0 (Blau) -> scorebox -> card1 (Rot)');
  ok(/\.status\{[^}]*grid-template-columns:1fr auto 1fr/.test(HTML),
     'Statusleiste bleibt das bestehende 1fr-auto-1fr-Raster (kein zweites HUD-Layout)');
  ok(/#game\.fb #card0 \.pn\{color:var\(--p1\)\}/.test(HTML) && /#game\.fb #card1 \.pn\{color:var\(--p2\)\}/.test(HTML),
     'Blau links, Rot rechts — ueber die IDs adressiert, nicht ueber die Kindreihenfolge');
  ok(/#game\.fb #card0\{border-left:2px solid rgba\(0,212,255/.test(HTML) &&
     /#game\.fb #card1\{border-right:2px solid rgba\(255,77,77/.test(HTML),
     'Teamakzent nur als Kante: blau ausschliesslich links, rot ausschliesslich rechts');
  ok(/#game\.fb \.score\{font-size:30px/.test(HTML) && /#game\.fb \.pcard \.pn\{font-size:11px/.test(HTML),
     'Score ist der visuelle Schwerpunkt (30px gegen 11px Teamname)');
  ok(/#game\.fb \.score\{[^}]*font-variant-numeric:tabular-nums/.test(HTML) &&
     /#game\.fb \.score \.s0,#game\.fb \.score \.s1\{display:inline-block;min-width:/.test(HTML),
     'feste Ziffernbreite -> kein Layoutsprung beim Wechsel 0/1/2/3');
  ok(/@media\(max-width:380px\)/.test(fbCssSrc), 'eigener Kompaktzustand fuer schmale Fenster vorhanden');
  ok(/#game\.fb \.scorebox\{[^}]*border-color:rgba\(255,201,64/.test(HTML),
     'feine Goldkante am Score-Panel (bestehende Goldsprache)');
  ok(!/<img|<svg/.test(fbCssSrc), 'keine Icons/Portraits/Wappen im HUD');
}

// ── B. Mode-Scoping: ausserhalb Football existiert das HUD nicht ──
{
  const rules = fbCssSrc.split('\n').map((l) => l.trim())
    .filter((l) => l.includes('{') && !l.startsWith('/*') && !l.startsWith('*'))
    // Keyframe-Stops ("0%{…}", "52%{…}") sind keine Selektoren — sie koennen ausserhalb
    // eines @keyframes-Blocks gar nicht vorkommen und tragen deshalb kein Mode-Scoping.
    .filter((l) => !/^\d+(\.\d+)?%\s*\{/.test(l))
    .map((l) => l.slice(0, l.indexOf('{')).trim()).filter(Boolean);
  const NEUTRAL = ['@keyframes fbgoal0', '@keyframes fbgoal1', '@keyframes fbsheen',
                   '@keyframes fbglow0', '@keyframes fbglow1',
                   '@media(prefers-reduced-motion:reduce)', '@media(max-width:380px)', '.arena-wrap'];
  ok(rules.length > 10, 'HUD-CSS-Block gefunden (' + rules.length + ' Regeln)');
  ok(rules.every((s) => s.startsWith('#game.fb') || NEUTRAL.includes(s)),
     'jede HUD-Regel haengt an #game.fb (Ausnahmen nur: Keyframes, Media-Query)');
  ok(/function fbHudOn\(\)\{return mode==='football'&&!menuVisible;\}/.test(HTML),
     "die Football-Klasse haengt an mode==='football' UND !menuVisible");
  ok(/g\.classList\.toggle\('fb',on\);/.test(fbHudSrc) && /if\(!on\)fbClearHudFx\(\);/.test(fbHudSrc),
     'beim Verlassen des Football-Modus wird die Klasse entfernt und alles abgeraeumt');
  ok(/applyFootballHud\(\);/.test(showMenuSrc),
     'showMenu() raeumt das Football-HUD ab (Menuewechsel, Moduswechsel)');
  ok(/fbClearHudFx\(\)\{[\s\S]*?clearTimeout\(fbPopT\[t\]\)[\s\S]*?classList\.remove\('pop'\)/.test(fbHudSrc),
     'Abraeumen stoppt die Score-Animation restlos (keine Reste in anderen Modi)');
  ok(/if\(mode==='football'\)fbScorePulse\(\);/.test(updateHudSrc),
     'die Score-Reaktion laeuft ausschliesslich im Football-Modus');
  // Kein Football-Text ausserhalb von Football: der Untertitel ist explizit verzweigt.
  ok(/\$\('rinfo'\)\.textContent=mode==='football'/.test(updateHudSrc) && /:'Runde '\+roundNo;/.test(updateHudSrc),
     'andere Modi behalten im Untertitel unveraendert die Rundenanzeige');
}

// ── C. First-to-N: genau eine Quelle fuer die Matchregel, deutscher Text im HUD ──
{
  ok(/function fbFirstToText\(\)\{return I18N\.de\.fbFirstTo\.replace\('\{n\}',FOOTBALL_WIN_SCORE\);\}/.test(HTML),
     'die Zahl im Untertitel stammt aus FOOTBALL_WIN_SCORE');
  ok(/\$\('rinfo'\)\.textContent=mode==='football'\?fbFirstToText\(\)/.test(updateHudSrc),
     'der Football-Untertitel kommt aus genau dieser Funktion');
  // URSACHE des englischen Textes: LANG faellt ohne gespeicherte Auswahl auf 'en' zurueck,
  // waehrend die gesamte In-Game-Ebene ('Runde N', 'zielt…', 'BLAU'/'ROT') hart Deutsch ist.
  // Der Untertitel folgt deshalb seinen Nachbarn statt der Menue-i18n.
  ok(/return I18N\[l\]\?l:'en';/.test(HTML), 'LANG-Default ist unveraendert (globale Sprachlogik nicht angefasst)');
  ok(/:'Runde '\+roundNo;/.test(updateHudSrc), 'der Nachbartext im selben Feld ist unveraendert deutsch');
  for (const [lang, txt] of [['en', 'FIRST TO {n}'], ['de', 'ERSTER BIS {n}']]) {
    ok(HTML.includes("fbFirstTo:'" + txt + "'"), 'i18n ' + lang + ": '" + txt + "'");
  }
  ok(/fbFirstTo:'İLK \{n\}'/.test(HTML), "i18n tr: 'ILK {n}'");
  ok((HTML.match(/fbFirstTo:/g) || []).length === 3, 'fbFirstTo in allen drei Sprachen gepflegt');
  // Keine der Uebersetzungen darf die Zahl selbst enthalten — sonst gaebe es eine zweite
  // Wahrheit neben FOOTBALL_WIN_SCORE.
  ok(!/fbFirstTo:'[^']*[0-9][^']*'/.test(HTML),
     'keine Uebersetzung hardcodiert die Zahl (nur der {n}-Platzhalter)');
  ok(buildEnv('football', 'single').winScore === 3, 'FOOTBALL_WIN_SCORE ist weiterhin die Regel (3)');
  // Und das Ergebnis, wie es im HUD steht — mit derselben Rechnung wie im Produktivcode.
  const de = (HTML.match(/fbFirstTo:'(ERSTER BIS \{n\})'/) || [])[1];
  ok(de && de.replace('{n}', 3) === 'ERSTER BIS 3', 'deutsche Anzeige lautet "ERSTER BIS 3"');
  ok((HTML.match(/fbFirstTo:'(FIRST TO \{n\})'/) || [])[1].replace('{n}', 3) === 'FIRST TO 3',
     'englische Fassung lautet "FIRST TO 3"');
  ok((HTML.match(/fbFirstTo:'(İLK \{n\})'/) || [])[1].replace('{n}', 3) === 'İLK 3',
     'tuerkische Fassung lautet "ILK 3"');
}

// ── D. UX-PHASE 2B: Anstosshinweis vollstaendig entfernt ──
{
  for (const id of ['fbIntro', 'fbIntroTxt', 'fbShowIntro', 'FB_INTRO_MS', 'fbIntroT', 'fbintro'])
    ok(!HTML.includes(id), 'kein Rest von "' + id + '" im Produktivcode');
  ok(!/BLAU<\/b><em>/.test(HTML) && !/→<\/em>/.test(HTML), 'keine Pfeil-/Anstossgrafik mehr vorhanden');
  ok(!/fbShowIntro|fbIntro/.test(newGameSrc), 'newGame() hat keinen Intro-Hook mehr');
  // UX-Phase 3 ergaenzt genau EINEN weiteren einmaligen Timer: den Gold-Schimmer am
  // Score-Panel. Mehr darf es nicht werden — jeder zusaetzliche Timer ist ein Leckrisiko.
  ok((fbHudSrc.match(/setTimeout/g) || []).length === 2,
     'genau ZWEI einmalige Timer im HUD (Score-Reaktion + Panel-Schimmer)');
  ok(!/setInterval/.test(fbHudSrc), 'weiterhin kein permanenter Timer');
}

// ── E2. UX-PHASE 2B: keine sekundaeren Teamstatuswoerter im Football-HUD ──
{
  ok(/#game\.fb \.pcard \.pw\{display:none\}/.test(HTML),
     '"zielt…"/"bereit" sind im Football-HUD ausgeblendet');
  ok(/#game\.fb \.pcard\{[^}]*align-content:center/.test(HTML),
     'der verbliebene Teamname sitzt mittig in der Karte');
  // Andere Modi behalten ihre Statusanzeige: die Regel ist .fb-gescoped und updateHud()
  // befuellt ready0/ready1 unveraendert fuer alle Modi.
  ok(/\.pcard \.pw\{font-size:8px;color:#7688a6/.test(HTML), 'Basisregel fuer .pw unveraendert (andere Modi)');
  ok(/\$\('ready0'\)\.textContent=readyText\(0\);/.test(updateHudSrc) &&
     /\$\('ready1'\)\.textContent=readyText\(1\);/.test(updateHudSrc),
     'readyText() wird weiterhin fuer alle Modi gesetzt (nur die Football-Darstellung blendet aus)');
}

// ── E3. UX-PHASE 2B: alte untere Integrationsmeldung entfernt ──
{
  ok(!/Arena Football · Visuelle Integration/.test(HTML), "'Arena Football · Visuelle Integration' entfernt");
  ok(!/Arena Football — Shell/.test(HTML), "'Arena Football — Shell' entfernt");
  ok(!/Beide aufgedeckt…'/.test(setPhaseTextSrc.slice(0, setPhaseTextSrc.indexOf('if(online)'))),
     'keine Football-Phasentexte mehr im Football-Zweig');
  // Classic/Tactical: entweder die echte 3D-Fehlermeldung oder eine leere Zeile. Die
  // Statuszeile mit dem aktiven Zieler existiert ausschliesslich in der Dev-Variante Elimination4.
  ok(/if\(!r3dActive\)\{p\.textContent='3D-Szene nicht verfügbar/.test(setPhaseTextSrc) &&
     /fbElim4\(\)\)\{/.test(setPhaseTextSrc),
     'im Football bleibt unten nur die echte 3D-Fehlermeldung, sonst leer');
  ok(/if\(online\)\{/.test(setPhaseTextSrc), 'die Statuszeilen der anderen Modi sind unveraendert vorhanden');
}

// ── E. Score-Reaktion: kurz, dekorativ, ohne Rueckwirkung ──
{
  ok(/const FB_POP_MS=460;/.test(HTML), 'Tor-Reaktion dauert 460 ms (kurz und kontrolliert)');
  // UX-Phase 3: die Reaktion ist weiterhin EINE einmalige kurze Bewegung — jetzt mit
  // Gold-Impuls, der wieder exakt auf den Ruhezustand (Teamfarbe, kein Schatten) faellt.
  for (const side of ['0', '1']) {
    const kf = (HTML.match(new RegExp('@keyframes fbgoal' + side + '\\{[\\s\\S]*?\\n\\}')) || [])[0] || '';
    ok(/0%\{transform:scale\(1\)/.test(kf) && /100%\{transform:scale\(1\);color:var\(--p[12]\);text-shadow:none\}/.test(kf),
       'fbgoal' + side + ' startet und endet exakt im Ruhezustand (kein Dauerleuchten)');
    ok(!/infinite|alternate/.test(kf), 'fbgoal' + side + ' laeuft einmalig (kein Dauerblinken)');
    const peak = Number((kf.match(/transform:scale\((1\.\d+)\)/) || [])[1]);
    ok(peak > 1 && peak <= 1.25, 'fbgoal' + side + ': Spitzenskalierung bleibt dezent (' + peak + ' <= 1.25)');
  }
  ok(/const v=score\[t\]\|0,el=\$\(t\?'sc1':'sc0'\);/.test(fbHudSrc),
     'die Reaktion liest ausschliesslich score[] — keine eigene Zaehlung');
  ok(/if\(el&&v>fbScoreShown\[t\]\)/.test(fbHudSrc),
     'ausgeloest wird nur bei einem echten Anstieg des angezeigten Standes');
  ok(/fbScoreShown=\[score\[0\]\|0,score\[1\]\|0\];/.test(newGameSrc),
     'beim Matchstart wird der Anzeigestand gleichgezogen (kein Puls auf 0:0)');
  ok(!/setInterval/.test(fbHudSrc), 'kein permanenter Timer im HUD (nur einmalige setTimeout)');
  ok(!/shake|confetti|particle|spawn\(|SFX\./i.test(fbHudSrc),
     'keine Partikel, kein Shake, keine neuen Sounds im HUD');
  ok(!/firebase|fetch\(|XMLHttpRequest|db\./.test(fbHudSrc), 'keine neue Netzwerkabhaengigkeit im HUD');
  // UX-3B: JS-Timer und CSS-Animation MUESSEN dieselbe Dauer haben — laeuft der Timer
  // frueher ab, schneidet er die Animation ab; laeuft er spaeter, haengt die Klasse nach.
  const popMs = Number(HTML.match(/const FB_POP_MS=(\d+);/)[1]);
  const hudMs = Number(HTML.match(/const FB_GOAL_HUD_MS=(\d+);/)[1]);
  ok(popMs === 460, 'die Score-Zahl behaelt ihren praegnanten Pop (460 ms)');
  ok(hudMs >= 1100 && hudMs <= 1250, 'Panel-Nachklang im vorgegebenen Fenster 1100–1250 ms (' + hudMs + ' ms)');
  ok(hudMs > popMs, 'der goldene Nachklang ueberdauert den Score-Pop');
  const cssSec = (s) => Number(s) * 1000;
  for (const side of ['0', '1']) {
    const decl = (HTML.match(new RegExp('#game\\.fb \\.scorebox\\.fbgoal' + side + '\\{animation:([^}]+)\\}')) || [])[1] || '';
    const durs = (decl.match(/([\d.]+)s/g) || []).map((x) => cssSec(x.slice(0, -1)));
    ok(durs.length === 2 && durs.every((d) => d === hudMs),
       'fbgoal' + side + ': beide CSS-Animationen laufen exakt FB_GOAL_HUD_MS (' + durs.join('/') + ')');
  }
  for (const side of ['0', '1']) {
    const decl = (HTML.match(new RegExp('#game\\.fb \\.score \\.s' + side + '\\.pop\\{animation:([^}]+)\\}')) || [])[1] || '';
    const d = cssSec(((decl.match(/([\d.]+)s/) || [])[1] || 0));
    ok(d === popMs, 's' + side + '.pop laeuft exakt FB_POP_MS (' + d + ' ms)');
  }
}

// ── F. Die Spiellogik bleibt unberuehrt ──
{
  const HUD_IDS = /fbShowIntro|fbScorePulse|applyFootballHud|fbClearHudFx|classList/;
  for (const [nm, src] of [['footballTryGoal', tryGoalSrc], ['footballGoalSide', goalSideSrc],
                           ['footballResetRound', resetRoundSrc], ['footballTickGoal', tickGoalSrc],
                           ['footballMatchEnd', matchEndSrc], ['footballResetMatchState', resetMatchStateSrc]])
    ok(!HUD_IDS.test(src), nm + ' enthaelt keinen HUD-Code (Wertung und Ablauf unveraendert)');
  ok(/score\[side\]=\(score\[side\]\|\|0\)\+1;/.test(tryGoalSrc),
     'die Wertung selbst ist unveraendert (score[side]++ in footballTryGoal)');
  ok(/if\(score\[side\]>=FOOTBALL_WIN_SCORE\)footballWinner=side;/.test(tryGoalSrc),
     'First-to-3 wird weiterhin genau an der Wertungsstelle geprueft');
  // Das HUD haengt an updateHud() — dem bestehenden, einzigen Anzeige-Einstiegspunkt.
  ok(/updateHud\(\);/.test(tryGoalSrc), 'das Tor aktualisiert die Anzeige ueber den bestehenden updateHud()-Pfad');
}

// ══════════════════════════════════════════════════════════════════════════════
// UX-PHASE 3 — PREMIUM GOAL FEEDBACK
// Geprueft wird die Abgrenzung und die Aufraeumbarkeit, nicht der Geschmack:
// dass das Tor-Feedback genau EINMAL pro Tor feuert, dass genau EINE Seite reagiert,
// dass es restlos in den Ruhezustand zurueckfaellt und dass es Physik, Wertung und
// Ablauf nirgends beruehrt.
// ══════════════════════════════════════════════════════════════════════════════

// ── G1. Der In-World-Impuls: Existenz, Benennung, Abgrenzung ──
{
  for (const id of ['FB_GOAL_FX_MS', 'FB_GOAL_FX_ATTACK', 'fbGoalFxSide', 'fbGoalFxStart',
                    'footballGoalFxTrigger', 'footballClearGoalFx', 'footballGoalFxSign',
                    'footballGoalFxLevel'])
    ok(goalFxSrc.includes(id), 'Goal-FX-Helfer "' + id + '" existiert im Produktivcode');
  ok(!/setTimeout|setInterval|requestAnimationFrame/.test(goalFxSrc),
     'der Impuls ist zustandslos ueber die Renderuhr geloest (kein Timer, keine Timeout-Kaskade)');
  ok(!/score|fbGoalState|fbGoalTick|footballWinner|balls|\bvx\b|\bvy\b/.test(goalFxSrc),
     'der Impuls liest und schreibt keinen Spielzustand (kein Score, kein Ablauf, keine Physik)');
  ok(!/textContent|innerHTML|getElementById|classList|querySelector/.test(goalFxSrc),
     'der Impuls fasst kein DOM an — das HUD ist eine eigene Ebene');
  // UX-3B: laengerer Nachklang. Der Impuls DARF und SOLL ueber den Ball-Respawn hinaus
  // sichtbar bleiben — geprueft wird das weiter unten gegen die echte Zustandsmaschine.
  const dur = Number(goalFxSrc.match(/FB_GOAL_FX_MS=(\d+)/)[1]);
  ok(dur >= 1450 && dur <= 1600, 'Impulsdauer im vorgegebenen Fenster 1450–1600 ms (' + dur + ' ms)');
  const atk = Number(goalFxSrc.match(/FB_GOAL_FX_ATTACK=([\d.]+)/)[1]);
  ok(atk * dur <= 200, 'der Peak bleibt frueh: Anstiegszeit ' + (atk * dur).toFixed(1) + ' ms (<= 200 ms)');
  ok(/return q\*q;/.test(goalFxSrc),
     'quadratischer Ausklang — traegt die Goldglut sichtbar weiter als eine kubische Kurve');
}

// ── G2. Genau EIN Trigger pro Tor, an der einzigen Wertungsstelle ──
{
  // Eine Definition und genau ein Aufruf JE WERTUNGSPFAD: footballTryGoal (Classic/Tactical)
  // und footballElimTryGoal (Elimination4). Beide werten nur aus fbGoalState==='play'.
  ok((HTML.match(/footballGoalFxTrigger\(/g) || []).length === 3,
     'footballGoalFxTrigger existiert genau einmal und wird genau einmal je Wertungspfad aufgerufen');
  ok(/footballGoalFxTrigger\(side\);/.test(tryGoalSrc),
     'der Aufruf sitzt in footballTryGoal — der einzigen Stelle, die aus play heraus wertet');
  ok(/if\(fbGoalState!=='play'\)return;/.test(tryGoalSrc),
     'und damit hinter der bestehenden Einmal-Sperre (kein Doppelfeuer im selben Tor)');

  const G3 = buildEnv('football', 'single');
  ok(G3.fxSide() === -1, 'vor dem ersten Tor ist der Impuls inaktiv (-1)');
  G3.setScore(0, 0);
  kickToGoal(G3, +1);                       // echtes Tor durch die +X-Oeffnung -> Punkt fuer Blau
  ok(G3.goalState() === 'fall', 'Testtor ist gewertet (play -> fall)');
  ok(JSON.stringify(G3.score()) === '[1,0]', 'gewertet wurde genau eine Seite (Blau)');
  ok(G3.fxSide() === 0, 'der Impuls kennt die punktende Seite (0 = Blau)');
  ok(G3.fxSign() === 1, 'und leuchtet am +X-Tor — dem Tor, das getroffen wurde');
  const start = G3.fxStart();
  // Weiterlaufende Ticks des Torablaufs duerfen den Impuls nicht erneut ausloesen.
  for (let i = 0; i < G3.fallTicks + G3.spawnTicks + 20; i++) G3.step();
  ok(G3.fxStart() === start, 'der Impuls feuert waehrend des Torablaufs kein zweites Mal');
}

// ── G3. Huellkurve: startet bei 0, klingt sauber aus, genau EIN Tor leuchtet ──
{
  const G4 = buildEnv('football', 'single');
  G4.setScore(0, 0);
  kickToGoal(G4, +1);
  const t = G4.fxStart(), D = G4.fxDur;
  ok(G4.fxLevel(1, t) === 0, 'Pegel bei t=0 exakt 0 (kein harter Blitz zum Start)');
  // Exakt 0 (nicht "fast 0"): nur so stellt der Renderer die Ruhewerte bitgenau wieder her.
  ok(G4.fxLevel(1, t + D + 1) === 0 && G4.fxLevel(1, t + D * 2) === 0 && G4.fxLevel(1, t + D * 100) === 0,
     'nach Ablauf exakt 0 — der Ruhezustand wird garantiert wieder erreicht');
  const A = G4.fxAttack;
  const peak = G4.fxLevel(1, t + D * A);
  ok(Math.abs(peak - 1) < 1e-9, 'Spitzenwert 1.0 genau am Ende der Anstiegsphase');
  // Anstieg selbst monoton steigend: der Treffer baut sich sauber auf, ohne Zwischenabfall.
  let up = true, prevUp = 0;
  for (let p = 0; p <= A; p += A / 20) { const v = G4.fxLevel(1, t + D * p); if (v < prevUp - 1e-12) up = false; prevUp = v; }
  ok(up, 'der Aktivierungsimpuls steigt monoton bis zur Spitze');
  // Monoton fallend nach der Spitze: sauberes Ease-Out statt Flackern.
  let mono = true, prev = peak;
  for (let p = A + 0.01; p < 1; p += 0.01) { const v = G4.fxLevel(1, t + D * p); if (v > prev + 1e-12) mono = false; prev = v; }
  ok(mono, 'nach der Spitze faellt der Pegel monoton (Ease-Out, kein Strobing)');
  // Kein statisches Festhalten: auf halber Nachglut ist der Pegel bereits deutlich gefallen,
  // aber noch klar sichtbar — genau das Fenster zwischen "haelt fest" und "schon weg".
  const half = G4.fxLevel(1, t + D * (A + (1 - A) * 0.5));
  ok(half > 0.15 && half < 0.4,
     'auf halber Nachglut noch sichtbar, aber klar abklingend (' + half.toFixed(3) + ')');
  // Und immer nur EIN Tor: das gegenueberliegende bleibt vollstaendig unberuehrt.
  let other = 0;
  for (let p = 0; p <= 1.5; p += 0.01) other = Math.max(other, G4.fxLevel(-1, t + D * p));
  ok(other === 0, 'das gegenueberliegende Tor bleibt waehrend des gesamten Impulses bei 0');
  // Spiegelbildlich: ein Punkt fuer Rot leuchtet am -X-Tor.
  const G5 = buildEnv('football', 'single');
  G5.setScore(0, 0);
  kickToGoal(G5, -1);
  ok(G5.score()[1] === 1 && G5.fxSide() === 1 && G5.fxSign() === -1,
     'Punkt fuer Rot leuchtet spiegelbildlich am -X-Tor');
}

// ── G3b. UX-PHASE 3B: der Nachklang ueberdauert den Ball-Respawn — OHNE ihn zu verzoegern ──
{
  // Gameplay-Timing zuerst: die Tickzahlen des Torablaufs sind unveraendert. Waere hier
  // etwas verschoben worden, waere der laengere Effekt mit einem langsameren Spiel erkauft.
  ok(G.fallTicks === 72 && G.spawnTicks === 30,
     'Fall- und Spawn-Ticks unveraendert (72/30) — der Effekt verzoegert den neuen Ball nicht');
  ok(!/FB_GOAL_FX|GoalFx/.test(tickGoalSrc + resetRoundSrc),
     'die Zustandsmaschine des Torablaufs kennt die Effektdauer nicht');

  const G7 = buildEnv('football', 'single');
  G7.setScore(0, 0);
  kickToGoal(G7, +1);
  const t = G7.fxStart();
  // Frames bis zur Eingabefreigabe MESSEN statt annehmen — gegen die echte Zustandsmaschine.
  let frames = 0;
  while (G7.goalState() !== 'play' && frames < 600) { G7.step(); frames++; }
  ok(G7.goalState() === 'play', 'Ball ist regulaer zurueck im Spiel');
  // MESSWERT: footballTickGoal laeuft einmal je stepSim-Frame, nicht je Sub-Step —
  // (72+51+30) Ticks sind damit ~2550 ms bei 60 fps. Referenz 60 fps, wie die Renderuhr.
  const playableMs = frames * 1000 / 60;
  const ballVisibleMs = (G7.fallTicks + G7.celebrateTicks) * 1000 / 60;   // ab hier existiert der neue Ball
  ok(playableMs >= 2200 && playableMs <= 2800,
     'Gesamtzeit Tor -> naechste spielbare Runde im Zielfenster 2.2–2.8 s (' +
     Math.round(playableMs) + ' ms)');
  // UX-3C: der neue Ball erscheint erst NACH dem Torimpuls — genau das war der Befund.
  ok(ballVisibleMs > G7.fxDur,
     'der neue Ball erscheint erst nach dem Ende des Torimpulses (Ball ~' +
     Math.round(ballVisibleMs) + ' ms > Impuls ' + G7.fxDur + ' ms)');
  ok(G7.fxLevel(1, t + ballVisibleMs) === 0,
     'und damit ist der Impuls beim Erscheinen des neuen Balls bereits im Ruhewert');
  // Entscheidend fuer die Entkopplung: footballResetRound() feuert am Ende der Fallphase
  // (fallTicks) und erzeugt dort komplett frische Kugelobjekte — der Impuls laeuft darueber
  // hinweg unveraendert weiter, weil er an keinem kugel- oder rundengebundenen Zustand haengt.
  const resetMs = G7.fallTicks * 1000 / 60;
  ok(resetMs < G7.fxDur && G7.fxLevel(1, t + resetMs) > 0,
     'der Rundenreset bei ~' + Math.round(resetMs) + ' ms schneidet den Impuls nicht ab');
  // Aber er haelt nicht ewig: kurz nach Ablauf ist der Ruhewert erreicht.
  ok(G7.fxLevel(1, t + G7.fxDur + 1) === 0, 'danach exakt Ruhewert (kein Dauerleuchten)');
}

// ── G4. Aufraeumen: newGame(), showMenu() und Matchende lassen nichts stehen ──
{
  ok(/footballClearGoalFx\(\);fbMorphPlan=null;fbMorphSpawn=false;\}/.test(resetMatchStateSrc),
     'footballResetMatchState() setzt den Impuls zurueck (newGame + showMenu laufen hier durch)');
  ok(/footballResetMatchState\(\);/.test(newGameSrc), 'newGame() ruft footballResetMatchState()');
  ok(/footballResetMatchState\(\);/.test(showMenuSrc), 'showMenu() ruft footballResetMatchState()');
  ok(/footballClearGoalFx\(\);/.test(matchEndSrc), 'footballMatchEnd() setzt den Impuls zurueck');

  const G6 = buildEnv('football', 'single');
  G6.setScore(0, 0);
  kickToGoal(G6, +1);
  ok(G6.fxSide() === 0, 'Impuls laeuft');
  G6.newMatch();
  ok(G6.fxSide() === -1 && G6.fxStart() === 0, 'neues Match: Impuls vollstaendig zurueckgesetzt');
  ok(G6.fxLevel(1, 1e12) === 0 && G6.fxLevel(-1, 1e12) === 0,
     'und beide Tore liefern danach dauerhaft Pegel 0 (kein haengender Glow)');
  G6.resetMatchState();
  ok(G6.fxSide() === -1, 'Menuewechsel (footballResetMatchState) ist idempotent');
  G6.matchEnd();
  ok(G6.fxSide() === -1, 'Matchende hinterlaesst keinen aktiven Impuls');
}

// ── G5. Renderer-Ebene: Ruhewerte werden gehalten und exakt wiederhergestellt ──
{
  const fxRenderSrc = grab(/const goalFxParts=\[\];[\s\S]*?\n    \};/, 'Renderer-Goal-FX-Block');
  ok(/col:mat\.emissive\.clone\(\),int:mat\.emissiveIntensity/.test(HTML),
     'je Bauteil werden Ruhefarbe und Ruheintensitaet als Kopie festgehalten');
  ok(/p\.mat\.emissive\.copy\(p\.col\)\.lerp\(GOAL_FX_GOLD,GOAL_FX_MIX\*lv\);/.test(fxRenderSrc),
     'die Emissive-Farbe wird IMMER aus der Ruhefarbe neu berechnet (kein Aufaddieren, kein Drift)');
  ok(/p\.mat\.emissiveIntensity=p\.int\*\(1\+p\.gain\*lv\);/.test(fxRenderSrc),
     'die Intensitaet ist ein Faktor auf den Ruhewert -> lv=0 stellt exakt den Ruhezustand her');
  // Geschrieben wird nur bei einer echten Zustandsaenderung — Torimpuls ODER (nur
  // Elimination4) der Wechsel in ein ausgeschiedenes, totes Tor.
  // dm ist der Totzustand als PEGEL: ohne FX-Preset exakt der bisherige 0/1-Wert, mit
  // Preset zusaetzlich der weiche Drain des ausgeschiedenen Tores waehrend der Transition.
  ok(/if\(lv===p\.lv&&dm===p\.dead\)continue;/.test(fxRenderSrc),
     'im Ruhezustand wird kein Material angefasst (keine Schreiblast pro Frame)');
  const mix = Number(HTML.match(/const GOAL_FX_MIX=([\d.]+);/)[1]);
  ok(mix > 0.5 && mix < 1, 'Gold dominiert den Impuls, die Teamfarbe bleibt aber lesbar (MIX=' + mix + ')');
  ok(/const GOAL_FX_GOLD=new THREE\.Color\(0xffd79a\);/.test(HTML),
     'Feedbackfarbe ist warmes Gold-Weiss (kein Neon, kein RGB-Wechsel)');
  ok(/addGoalFx\(def\.key,o\.material,GOAL_FX_GAIN_EMBLEM\)/.test(HTML) &&
     /addGoalFx\(def\.key,cp,GOAL_FX_GAIN_FRAME\)/.test(HTML) &&
     /addGoalFx\(def\.key,lineMat,GOAL_FX_GAIN_LINE\)/.test(HTML),
     'drei Bauteile reagieren: Wappen, vordere Keyline, Torlinie/Oeffnungsakzent');
  // Der Impuls wird bewusst UNABHAENGIG von footballView gerechnet — nur so faellt er auch
  // dann in den Ruhezustand zurueck, wenn der Modus mitten im Impuls verlassen wird.
  ok(/if\(goalFxParts\.length\)applyGoalFx\(t0\+nowS\*1000\);/.test(HTML),
     'der Renderer wertet den Impuls in jedem Frame aus (auch ausserhalb der Football-Ansicht)');
  ok(!/goalFxParts|applyGoalFx|GOAL_FX_/.test(stepSimSrc),
     'stepSim (Physik) kennt das Tor-Feedback nicht');
}

// ── G6. HUD-Ebene funktional: genau EINE Seite reagiert, Abraeumen ist vollstaendig ──
{
  // Kleiner DOM-Ersatz: nur was der HUD-Block wirklich anfasst (classList + offsetWidth).
  function mkEl() {
    const cls = new Set();
    return { cls, offsetWidth: 0,
      classList: { add: (...c) => c.forEach((x) => cls.add(x)),
                   remove: (...c) => c.forEach((x) => cls.delete(x)),
                   contains: (x) => cls.has(x) } };
  }
  const hudBody = fbHudSrc.slice(0, fbHudSrc.lastIndexOf('function updateHud'));
  function buildHud() {
    const els = { sc0: mkEl(), sc1: mkEl(), box: mkEl() };
    const timers = [];
    const make = new Function('els', 'timers', `
      let mode='football', menuVisible=false, score=[0,0];
      const $=(id)=>els[id]||null;
      const document={querySelector:(s)=>s==='.scorebox'?els.box:null};
      let __seq=0;
      const setTimeout=(f)=>{const id=++__seq;timers.push({id,f});return id;};
      const clearTimeout=(id)=>{const i=timers.findIndex(t=>t.id===id);if(i>=0)timers.splice(i,1);};
      const I18N={de:{fbFirstTo:'ERSTER BIS {n}'}};
      const FOOTBALL_WIN_SCORE=3;
      ${hudBody}
      return { pulse(s){score=s;fbScorePulse();},
               clear(){fbClearHudFx();},
               fire(){const due=timers.splice(0);for(const t of due)t.f();},
               pending(){return timers.length;} };
    `);
    return { els, api: make(els, timers) };
  }

  // Tor fuer Blau: nur die linke Score-Seite und die linke Panel-Klasse reagieren.
  {
    const { els, api } = buildHud();
    api.pulse([1, 0]);
    ok(els.sc0.classList.contains('pop') && !els.sc1.classList.contains('pop'),
       'Tor fuer Blau: nur die BLAUE Score-Zahl reagiert');
    ok(els.box.classList.contains('fbgoal0') && !els.box.classList.contains('fbgoal1'),
       'und am Score-Panel leuchtet genau die blaue Seite');
    api.fire();
    ok(!els.sc0.classList.contains('pop') && !els.box.classList.contains('fbgoal0'),
       'nach Ablauf der Timer sind alle Klassen wieder entfernt');
  }
  // Tor fuer Rot: spiegelbildlich.
  {
    const { els, api } = buildHud();
    api.pulse([0, 1]);
    ok(els.sc1.classList.contains('pop') && !els.sc0.classList.contains('pop'),
       'Tor fuer Rot: nur die ROTE Score-Zahl reagiert');
    ok(els.box.classList.contains('fbgoal1') && !els.box.classList.contains('fbgoal0'),
       'und am Score-Panel leuchtet genau die rote Seite');
  }
  // Zweites Tor der Gegenseite: die Seitenklasse WECHSELT, sie stapelt sich nicht.
  {
    const { els, api } = buildHud();
    api.pulse([1, 0]);
    api.pulse([1, 1]);
    ok(els.box.classList.contains('fbgoal1') && !els.box.classList.contains('fbgoal0'),
       'schnelles Gegentor: immer genau EINE Seitenklasse am Panel (kein Stapeln)');
    // 2 Score-Timer (je Seite einer) + GENAU EIN Panel-Timer. Waere der alte Panel-Timer
    // nicht ersetzt worden, stuenden hier 4 — und der erste wuerde den zweiten Effekt killen.
    ok(api.pending() === 3, 'der alte Panel-Timer wurde ersetzt, nicht zusaetzlich angelegt');
  }
  // Unveraenderter Stand loest gar nichts aus.
  {
    const { els, api } = buildHud();
    api.pulse([0, 0]);
    ok(!els.sc0.classList.contains('pop') && !els.sc1.classList.contains('pop') &&
       els.box.cls.size === 0, 'ohne Score-Anstieg passiert nichts (kein Puls auf 0:0)');
  }
  // Menuewechsel raeumt mitten im laufenden Effekt vollstaendig ab.
  {
    const { els, api } = buildHud();
    api.pulse([1, 0]);
    api.clear();
    ok(els.sc0.cls.size === 0 && els.box.cls.size === 0,
       'fbClearHudFx() entfernt Score-Puls UND Panel-Schimmer restlos');
    ok(api.pending() === 0, 'und stoppt beide Timer (kein Nachfeuern in einem anderen Modus)');
  }
}

// ── G7. Physik, Wertung und Ablauf sind nachweislich unberuehrt ──
{
  const FX_IDS = /GoalFx|goalFxParts|applyGoalFx|GOAL_FX_|fbGoalPanelFx|fbgoal/;
  for (const [nm, src] of [['footballGoalSide', goalSideSrc], ['footballCanPassGoal', goalCanPassSrc],
                           ['footballResolvePost', resolvePostSrc], ['footballTickGoal', tickGoalSrc],
                           ['footballResetRound', resetRoundSrc], ['stepSim', stepSimSrc],
                           ['FOOTBALL_PHYS/Wedge', presetSrc + wedgeSrc]])
    ok(!FX_IDS.test(src), nm + ' enthaelt kein Tor-Feedback (Physik/Detection unveraendert)');
  ok(/score\[side\]=\(score\[side\]\|\|0\)\+1;/.test(tryGoalSrc) &&
     /if\(score\[side\]>=FOOTBALL_WIN_SCORE\)footballWinner=side;/.test(tryGoalSrc),
     'Wertung und First-to-3 stehen unveraendert vor dem Feedback-Aufruf');
  // Andere Modi: das Feedback existiert dort strukturell nicht.
  ok(/if\(mode!=='football'\)return -1;/.test(goalSideSrc),
     'ausserhalb Football wird nie ein Tor erkannt — damit feuert der Impuls dort nie');
  ok(/if\(mode==='football'\)fbScorePulse\(\);/.test(updateHudSrc),
     'auch die HUD-Reaktion bleibt auf den Football-Modus beschraenkt');
}

// ══════════════════════════════════════════════════════════════════════════════
// UX-PHASE 3C — CELEBRATION WINDOW VOR BALL-RESPAWN
// Geprueft wird ausschliesslich das TIMING des bestehenden Torablaufs: dass die neue
// Wartephase Teil DERSELBEN Zustandsmaschine ist, dass in ihr kein Ball im Bild ist,
// und dass Wertung, Goal-FX und Aufraeumen davon voellig unberuehrt bleiben.
// ══════════════════════════════════════════════════════════════════════════════

// ── H1. Die Phase ist Teil der bestehenden Maschine, nicht eine zweite ──
{
  ok(/const FOOTBALL_GOAL_CELEBRATE_TICKS=51;/.test(HTML),
     'Celebration Window als benannte Tickkonstante (51 Ticks)');
  const cMs = 51 * 1000 / 60;
  ok(cMs >= 700 && cMs <= 1000, 'Celebration Window ~' + Math.round(cMs) + ' ms (Zielfenster 700–1000 ms)');
  const wMs = Number(HTML.match(/const FOOTBALL_GOAL_WIN_CELEBRATE_TICKS=(\d+);/)[1]) * 1000 / 60;
  ok(wMs >= 1100 && wMs <= 1400, 'Matchpunkt-Celebration ~' + Math.round(wMs) + ' ms (Zielfenster 1100–1400 ms)');
  ok(wMs > cMs, 'der Matchpunkt bekommt mehr Raum als ein normales Tor');
  // Keine zweite Zustandsmaschine, kein loser Timer, keine Wanduhr.
  ok((HTML.match(/function footballTickGoal\(/g) || []).length === 1,
     'weiterhin genau EINE Torzustandsmaschine');
  ok(!/setTimeout|setInterval|performance\.now|Date\.now/.test(tickGoalSrc),
     'die Wartephase ist rein tickgetrieben (kein setTimeout, keine Wanduhr im Torablauf)');
  ok(!/setTimeout\([^)]*celebrat|setInterval\([^)]*celebrat/i.test(HTML),
     'nirgends eine setTimeout-basierte Celebration-Gameplaylogik');
  ok(/function footballCelebrateTicks\(\)\{[\s\S]*?footballWinner!==null\?FOOTBALL_GOAL_WIN_CELEBRATE_TICKS:FOOTBALL_GOAL_CELEBRATE_TICKS/.test(HTML),
     'die Laenge haengt am kanonischen footballWinner — kein zweites Flag');
  ok(/function footballGoalBusy\(\)\{return mode==='football'&&fbGoalState!=='play';\}/.test(HTML),
     "die Eingabesperre greift unveraendert ueber fbGoalState!=='play' (keine neue Sperre)");
  ok(!/pauseGame|globalPause|freezeAll|__paused/i.test(HTML), 'keine neue globale Pausefunktion');
}

// ── H2. Ablauf und Zeiten am echten Tor ──
{
  const C = buildEnv('football', 'single');
  C.setScore(0, 0);
  kickToGoal(C, +1);
  const scoreAtGoal = JSON.stringify(C.score());
  ok(scoreAtGoal === '[1,0]', 'Score reagiert SOFORT beim Tor (vor jeder Wartephase)');
  ok(C.fxSide() === 0 && C.fxStart() > 0, 'Goal-FX startet ebenfalls sofort beim Tor');

  // Fallphase unveraendert, dann Celebration. Der Torframe selbst hat bereits einen Tick
  // gefahren (stepSim wertet und tickt im selben Aufruf) — deshalb startet der Zaehler bei 1.
  ok(C.goalTick() === 1, 'der Torframe hat bereits einen Falltick gefahren');
  let g = 1; while (C.goalState() === 'fall' && g < 500) { C.step(); g++; }
  ok(g === C.fallTicks, 'Fallphase unveraendert ' + C.fallTicks + ' Ticks (nicht verlaengert)');
  ok(C.goalState() === 'celebrate' && C.goalTick() === 0, 'danach celebrate mit frischem Tickzaehler');
  ok(C.celebrateTicksNow() === C.celebrateTicks, 'normales Tor nutzt die kurze Celebration');

  // WAEHREND der Celebration: kein neuer Ball, kein Score, keine Eingabe.
  const neutralOutside = () => {
    const nb = C.get().balls.find((b) => b.owner === 4);
    return Math.abs(nb.x - C.cx) > C.halfLen();
  };
  let stillOutside = true, scoreStable = true, lockedAll = true;
  let c = 0;
  while (C.goalState() === 'celebrate' && c++ < 500) {
    if (!neutralOutside()) stillOutside = false;
    if (JSON.stringify(C.score()) !== scoreAtGoal) scoreStable = false;
    if (!C.locked()) lockedAll = false;
    C.step();
  }
  ok(c === C.celebrateTicks, 'Celebration laeuft exakt FOOTBALL_GOAL_CELEBRATE_TICKS (' + c + ')');
  ok(stillOutside, 'waehrend der Celebration liegt kein neuer Ball im Feld (der alte ist ausserhalb)');
  ok(scoreStable, 'die Celebration veraendert den Score nicht');
  ok(lockedAll, 'die Eingabe bleibt ueber die bestehende Torsperre durchgehend gesperrt');
  ok(C.goalState() === 'spawn', 'erst danach beginnt der bestehende Spawn-Ablauf');

  // Der Rundenreset passiert wirklich erst JETZT — nicht schon am Fallende.
  const nb = C.get().balls.find((b) => b.owner === 4);
  ok(Math.hypot(nb.x - C.cx, nb.y - C.cy) < 1e-9, 'der neue Ball entsteht erst am Ende der Celebration (Mitte)');
  ok(C.passedFlags().every((f) => f === false), 'footballResetRound() lief genau hier (fbPassed geloescht)');
  ok(C.locked() === true, 'waehrend des Spawn-Drops bleibt die Eingabe gesperrt');

  let s = 0; while (C.goalState() === 'spawn' && s++ < 500) C.step();
  ok(s === C.spawnTicks, 'Spawn-Ablauf unveraendert ' + C.spawnTicks + ' Ticks');
  ok(C.goalState() === 'play' && C.locked() === false, 'erst danach ist die naechste Runde spielbar');
  ok(JSON.stringify(C.score()) === '[1,0]', 'ueber den gesamten Ablauf genau EIN Punkt');

  // Gesamtbilanz in ms (60 fps).
  const toBall = (C.fallTicks + C.celebrateTicks) * 1000 / 60;
  const toPlay = (C.fallTicks + C.celebrateTicks + C.spawnTicks) * 1000 / 60;
  ok(toBall >= 1900 && toBall <= 2300, 'neuer Ball sichtbar nach ~' + Math.round(toBall) + ' ms');
  ok(toPlay >= 2200 && toPlay <= 2800, 'naechste Runde spielbar nach ~' + Math.round(toPlay) + ' ms');
  ok(toPlay < 3000, 'der Ablauf bleibt unter 3 s (ruhiger, aber nicht traege)');
}

// ── H3. Matchpunkt: Goal-FX vor dem Result-Overlay ──
{
  const W = buildEnv('football', 'single');
  W.setScore(2, 0);
  kickToGoal(W, +1);
  ok(W.winner() === 0 && W.overCalls().length === 0, 'Gewinner steht fest, Overlay noch nicht');
  let g = 0; while (W.goalState() === 'fall' && g++ < 500) W.step();
  ok(W.goalState() === 'celebrate', 'auch das entscheidende Tor bekommt ein Celebration Window');
  ok(W.celebrateTicksNow() === W.winCelebrateTicks, 'und zwar die laengere Matchpunkt-Variante');
  // JETZT messen: footballMatchEnd() raeumt den Impuls am Ende bewusst ab, danach ist er 0.
  ok(W.fxLevel(1, W.fxStart() + W.fallTicks * 1000 / 60) > 0,
     'der Trefferimpuls ist beim Eintritt in die Matchpunkt-Celebration noch sichtbar');
  let c = 0, overlayEarly = false;
  while (W.goalState() === 'celebrate' && c++ < 500) { if (W.overCalls().length) overlayEarly = true; W.step(); }
  ok(!overlayEarly, 'das Result-Overlay erscheint zu keinem Zeitpunkt waehrend der Celebration');
  ok(c === W.winCelebrateTicks, 'Matchpunkt-Celebration laeuft exakt ' + c + ' Ticks');
  ok(W.goalState() === 'result' && W.overCalls().length === 1, 'erst danach uebernimmt die bestehende Result-Struktur');
  // Der Torimpuls war bis dahin sichtbar: sein Ende liegt VOR dem Overlay.
  const overlayMs = (W.fallTicks + W.winCelebrateTicks) * 1000 / 60;
  ok(overlayMs > W.fxDur,
     'der Trefferimpuls laeuft vollstaendig ab, bevor das Overlay kommt (Overlay ~' +
     Math.round(overlayMs) + ' ms > Impuls ' + W.fxDur + ' ms)');
  ok(W.fxSide() === -1, 'footballMatchEnd() hat den Impuls danach sauber abgeraeumt');
  // Kein neuer Ball nach dem Sieg — der Rundenreset wird uebersprungen.
  const nb = W.get().balls.find((b) => b.owner === 4);
  ok(Math.abs(nb.x - W.cx) > W.halfLen(), 'nach dem Sieg entsteht kein neuer Ball');
}

// ── H4. Aufraeumen und Abgrenzung ──
{
  // Aus jeder Phase heraus raeumen newGame() und der Menuewechsel sauber auf.
  for (const stopAt of ['fall', 'celebrate', 'spawn']) {
    const E = buildEnv('football', 'single');
    E.setScore(0, 0);
    kickToGoal(E, +1);
    let g = 0; while (E.goalState() !== stopAt && E.goalState() !== 'play' && g++ < 500) E.step();
    ok(E.goalState() === stopAt, 'Setup: Zustand ' + stopAt + ' erreicht');
    E.newMatch();
    ok(E.goalState() === 'play' && E.goalTick() === 0 && E.fxSide() === -1,
       'newGame() aus "' + stopAt + '" heraus: Zustand, Tick und Goal-FX sauber zurueckgesetzt');
    ok(JSON.stringify(E.score()) === '[0,0]' && E.winner() === null,
       'und Score/Gewinner ebenfalls (kein Rest aus der Wartephase)');
  }
  {
    const E = buildEnv('football', 'single');
    E.setScore(2, 0); kickToGoal(E, +1);
    let g = 0; while (E.goalState() !== 'celebrate' && g++ < 500) E.step();
    E.resetMatchState();                       // == showMenu()-Pfad
    ok(E.goalState() === 'play' && E.winner() === null && E.fxSide() === -1,
       'Menuewechsel mitten in der Matchpunkt-Celebration raeumt vollstaendig ab');
  }
  // Andere Modi und Physik bleiben unberuehrt.
  ok(/if\(mode!=='football'\)return -1;/.test(goalSideSrc),
     'ausserhalb Football gibt es kein Tor — und damit auch keine Celebration');
  ok(!/celebrat/i.test(stripComments(stepSimSrc)),
     'stepSim selbst kennt die Wartephase nicht (nur der bestehende Torablauf-Zweig)');
  ok(!/celebrat/i.test(presetSrc + wedgeSrc + goalSideSrc + goalCanPassSrc + resolvePostSrc),
     'Physikpreset, Anti-Wedge und Goal Detection sind unberuehrt');
  ok(!/celebrat/i.test(stripComments(goalFxSrc)),
     'die Goal-FX-Ebene kennt die Wartephase nicht (Effektdauern unveraendert)');
  ok(/const FB_GOAL_FX_MS=1500;/.test(HTML) && /const FB_GOAL_HUD_MS=1200;/.test(HTML) &&
     /const FB_POP_MS=460;/.test(HTML),
     'Goal-FX-Dauern aus UX-3/3B unveraendert (1500 / 1200 / 460 ms)');
  // Der Renderer haelt den gefallenen Ball auch in der neuen Phase unten.
  ok(/mode==='football'&&fbGoalState==='celebrate'&&b\.owner===FOOTBALL_NEUTRAL_OWNER/.test(HTML),
     'der Renderer blendet den gefallenen Ball auch waehrend der Celebration aus');
}

// ════════════════════════════════════════════════════════════════════════════
// TOR-AUDIO (Audio-Phase 2): echtes Asset, eine Engine, genau ein Trigger.
// Rein statische Quellpruefung auf index.html + Existenz/Format des Assets.
// ════════════════════════════════════════════════════════════════════════════
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const sfxSrc   = grab(/const SFX=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/, 'SFX-IIFE');
  const goalSrc  = grab(/    footballGoal\(matchPoint\)\{[\s\S]*?\n    \},/, 'SFX.footballGoal');
  const loadSrc  = grab(/  function loadFootballGoalAsset\(cc\)\{[\s\S]*?\n  \}/, 'loadFootballGoalAsset');
  const stopSrc  = grab(/    footballGoalStop\(\)\{[\s\S]*?\n    \},/, 'SFX.footballGoalStop');
  const trySrc   = grab(/function footballTryGoal\(b\)\{[\s\S]*?\n\}/, 'footballTryGoal');
  const audioDir = path.join(__dirname, '..', 'assets', 'audio');
  const FB_GOAL_SRCS_ALL = () =>
    (HTML.match(/const FB_GOAL_SRCS=\[([^\]]+)\]/)[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));

  // ── A. Produktives Asset vorhanden, Rohquelle bleibt reine Entwicklungsvorlage ──
  const ogg = path.join(audioDir, 'arena_football_goal.ogg');
  ok(fs.existsSync(ogg), 'produktives OGG-Asset assets/audio/arena_football_goal.ogg existiert');
  ok(fs.existsSync(ogg) && fs.statSync(ogg).size > 4096,
     'das OGG-Asset ist kein leerer Platzhalter (' + (fs.existsSync(ogg) ? fs.statSync(ogg).size : 0) + ' B)');
  ok(fs.existsSync(ogg) && fs.readFileSync(ogg).slice(0, 4).toString('latin1') === 'OggS',
     'das Asset traegt einen echten Ogg-Container-Header');

  // Nutzlaenge beider Formate exakt aus den Containern — ohne Decoder, ohne Abhaengigkeit.
  // OGG: granule position der LETZTEN Seite = Gesamtzahl der Samples.
  // MP3: Xing-Framecount x 1152 abzueglich Encoder-Delay/Padding aus dem LAME-Tag.
  function oggInfo(file) {
    const b = fs.readFileSync(file);
    let last = -1, i = 0;
    while ((i = b.indexOf('OggS', i + 1)) !== -1) last = i;
    const rate = b.readUInt32LE(b.indexOf('vorbis') + 11);
    return { rate, samples: Number(b.readBigUInt64LE(last + 6)) };
  }
  function mp3Info(file) {
    const b = fs.readFileSync(file);
    const x = b.indexOf('Xing'), L = b.indexOf('LAME');
    if (x < 0 || L < 0) return null;
    const frames = (b.readUInt32BE(x + 4) & 1) ? b.readUInt32BE(x + 8) : 0;
    const d = b.readUInt32BE(L + 20) & 0xffffff;
    return { samples: frames * 1152 - ((d >> 12) & 0xfff) - (d & 0xfff) };
  }
  const OG = oggInfo(ogg), MP = mp3Info(path.join(audioDir, 'arena_football_goal.mp3'));
  const oggSec = OG.samples / OG.rate;
  ok(OG.rate === 48000, 'das OGG-Asset laeuft mit 48 kHz (' + OG.rate + ' Hz)');
  // Audio-Phase 2B: der Vorlauf vor dem Hauptimpact wurde von 467 ms auf 35 ms gekuerzt.
  // Die Gesamtdauer sinkt dadurch von 2.050 s auf ~1.618 s — der Ausklang bleibt unangetastet.
  ok(oggSec >= 1.45 && oggSec <= 1.75,
     'die Nutzlaenge liegt im Zielband 1.45-1.75 s (' + oggSec.toFixed(4) + ' s)');
  ok(oggSec < 2.0,
     'der langgezogene Aufbau aus Audio-Phase 2 ist entfernt (kuerzer als die alten 2.050 s)');
  ok(MP !== null && Math.abs(MP.samples - OG.samples) <= 48,
     'OGG und MP3 haben dieselbe Nutzlaenge (' + (MP ? MP.samples : '?') + ' vs ' + OG.samples + ' Samples)');
  // Der Sound muss vor dem Spawn des neuen Balls (~2050 ms nach dem Tor) ausgelaufen sein.
  ok(oggSec * 1000 < 2050,
     'der Torsound endet vor dem Spawn des neuen Balls (' + Math.round(oggSec * 1000) + ' ms < 2050 ms)');
  ok(/const FB_GOAL_SRCS=\['assets\/audio\/arena_football_goal\.ogg'/.test(HTML),
     'der Laufzeitcode bevorzugt das produktive OGG-Asset');
  ok(!/Goal sound Arena Football/.test(strip(sfxSrc)),
     'die Rohquelle wird zur Laufzeit NIE geladen (nur als Kommentar/Entwicklungsvorlage referenziert)');
  // Die Rohquelle ist Entwicklungsvorlage und bleibt ueber alle Schnittphasen unveraendert.
  const rawSrc = path.join(audioDir, 'Goal sound Arena Football.mp3');
  ok(fs.existsSync(rawSrc) && fs.statSync(rawSrc).size === 473856,
     'die Rohquelle ist unveraendert (473856 B)');
  ok(FB_GOAL_SRCS_ALL().every((s) => /^assets\/audio\/arena_football_goal\.(ogg|mp3)$/.test(s)),
     'die Quellenliste enthaelt ausschliesslich produktive Assetpfade');
  ok(FB_GOAL_SRCS_ALL().every((s) => fs.existsSync(path.join(__dirname, '..', s))),
     'jeder referenzierte Assetpfad existiert wirklich');
  ok(!/data:audio|base64/i.test(sfxSrc), 'keine Base64-Einbettung des Tor-Audios');
  ok(!/https?:\/\//.test(strip(sfxSrc)), 'keine externe URL im Sound-Modul');

  // ── B. Eine Audio-Engine: der bestehende Context/Unlock-Pfad wird wiederverwendet ──
  ok((HTML.match(/new\(window\.AudioContext\|\|window\.webkitAudioContext\)\(\)/g) || []).length === 1,
     'es existiert genau EINE AudioContext-Instanziierung im gesamten Dokument');
  ok(/loadFootballGoalAsset\(ac\(\)\)/.test(sfxSrc),
     'das Preload laeuft ueber den bestehenden ac()-Unlock-Pfad (User-Geste)');
  ok(/go\(c=>\{/.test(goalSrc), 'die Wiedergabe laeuft ueber den bestehenden go()-Wrapper');
  ok(/function go\(f\)\{if\(soundOn\)/.test(sfxSrc),
     'go() respektiert die globale Sound-Einstellung soundOn');
  ok(/await fetch\(src\)/.test(loadSrc) && /decodeAudioData/.test(loadSrc),
     'das Asset wird per fetch() geladen und per decodeAudioData() zu einem AudioBuffer dekodiert');
  ok(/c\.createBufferSource\(\)/.test(goalSrc),
     'jedes Tor erzeugt eine FRISCHE AudioBufferSource (kein geteilter Wiedergabecursor)');
  ok(!/new Audio\(|HTMLAudioElement|<audio/i.test(sfxSrc),
     'kein HTMLAudioElement — die Wiedergabe laeuft ausschliesslich ueber die Web-Audio-Kette');

  // ── C. Keine prozeduralen Ersatztoene, kein Fallback-Dong ──
  ok(!/createOscillator|createBuffer\(/.test(goalSrc + loadSrc),
     'der Torsound enthaelt keinen prozeduralen Oszillator und kein synthetisches Buffer');
  ok(/if\(fbGoalLoad!==2\)return;/.test(goalSrc),
     'fehlt oder laedt das Asset, bleibt das Tor still (kein Ersatzton)');
  ok(/catch\(e\)\{\}/.test(loadSrc) && !/throw/.test(loadSrc),
     'Lade-/Decodierfehler werden abgefangen und blockieren das Gameplay nicht');
  ok(/\}\)\(\);/.test(loadSrc), 'der Ladepfad ist eine gekapselte async-IIFE ohne offenen Promise nach aussen');
  ok(/if\(fbGoalLoad!==0\)return;/.test(loadSrc),
     'genau EIN Ladeversuch pro Seitenladen (kein Fetch-Spam)');
  ok(/src\.onended=\(\)=>releaseGoalVoice\(v\);/.test(goalSrc),
     'jede Quelle wird nach Ablauf freigegeben (kein Node-Leak)');
  ok(!/setInterval/.test(sfxSrc), 'kein setInterval im Sound-Modul');

  // ── D. Trigger: genau einmal, nur Football, ohne Rueckwirkung ──
  // Drei Aufrufer: die beiden Wertungspfade (footballTryGoal fuer Classic/Tactical,
  // footballElimTryGoal fuer Elimination4) und die ?dev=1-Hoerprobe. Je Tor genau einer.
  ok((HTML.match(/SFX\.footballGoal\(/g) || []).length === 3,
     'SFX.footballGoal() hat genau drei Aufrufer: die zwei Torpfade und die ?dev=1-Hoerprobe');
  ok(/if\(mode==='football'\)SFX\.footballGoal\(footballWinner!==null\);/.test(trySrc),
     'der Torsound haengt im Torpfad und ausschliesslich an mode===\'football\'');
  ok(/if\(fbGoalState!=='play'\)return;/.test(trySrc),
     'footballTryGoal wertet nur aus \'play\' — dieselbe Einmalgarantie wie der Goal-FX-Impuls');
  ok(trySrc.indexOf('SFX.footballGoal(') > trySrc.indexOf('score[side]=(score[side]||0)+1;'),
     'der Sound startet NACH der bestaetigten Scorevergabe');
  const resetSrc = grab(/function footballResetRound\(\)\{[\s\S]*?\n\}/, 'footballResetRound');
  const tickSrc  = grab(/function footballTickGoal\(\)\{[\s\S]*?\n\}/, 'footballTickGoal');
  const endSrc   = grab(/function footballMatchEnd\(\)\{[\s\S]*?\n\}/, 'footballMatchEnd');
  ok(!/SFX\.footballGoal\(/.test(resetSrc + tickSrc + endSrc),
     'kein Trigger in Rundenreset, Celebration-Tick, Spawn oder Matchende');
  ok(!/footballGoal\(|footballGoalStop\(/.test(strip(grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim'))),
     'die Physikschleife kennt das Tor-Audio nicht');
  ok(!/return[^;]/.test(strip(goalSrc)),
     'footballGoal liefert keinen Wert zurueck — reine Ausgabe, keine Entscheidungsquelle');
  ok(!/SFX\.footballGoal\([^)]*\)\s*(\?|&&|\|\||===|!==)/.test(HTML),
     'kein Aufrufer wertet ein Ergebnis des Torsounds aus');

  // ── E. Lautstaerke und Matchpunkt ──
  const gain = Number(HTML.match(/const FOOTBALL_GOAL_ASSET_GAIN=([\d.]+);/)[1]);
  ok(gain >= 0.70 && gain <= 0.90, 'FOOTBALL_GOAL_ASSET_GAIN liegt im freigegebenen Band (' + gain + ')');
  ok(gain === 0.80, 'FOOTBALL_GOAL_ASSET_GAIN ist unveraendert 0.80 (' + gain + ')');
  const mul = Number(HTML.match(/const FOOTBALL_GOAL_MATCHPOINT_GAIN_MUL=([\d.]+);/)[1]);
  ok(mul > 1 && mul <= 1.08, 'die Matchpunkt-Anhebung bleibt minimal (+' + Math.round((mul - 1) * 100) + ' %)');
  ok(mul === 1.06, 'der Matchpunkt-Multiplikator ist unveraendert 1.06 (' + mul + ')');
  ok(/FOOTBALL_GOAL_ASSET_GAIN\*\(matchPoint\?FOOTBALL_GOAL_MATCHPOINT_GAIN_MUL:1\)/.test(goalSrc),
     'Matchpunkt variiert AUSSCHLIESSLICH ueber den Gain');
  ok(!/playbackRate|detune/.test(goalSrc),
     'kein Pitch-Gimmick: normales Tor und Matchpunkt klingen identisch');
  ok(FB_GOAL_SRCS_ALL().length >= 1 && !/matchPoint\?'[^']*\.(ogg|mp3)'/.test(goalSrc),
     'normales Tor und Matchpunkt verwenden dieselbe Datei (keine zweite Quelle)');
  ok(!/createDynamicsCompressor/.test(sfxSrc), 'kein eigener Limiter fuer das Tor-Audio');

  // ── F. Cleanup ──
  ok(/setTargetAtTime\(\.0001,c\.currentTime,FB_GOAL_STOP_FADE\/3\)/.test(stopSrc),
     'der Stop blendet weich aus statt hart zu schneiden (kein Klick)');
  ok(/v\.src\.stop\(c\.currentTime\+FB_GOAL_STOP_FADE\)/.test(stopSrc),
     'nach dem Ausblenden wird die Quelle wirklich gestoppt (laeuft nie weiter)');
  ok(!/fbGoalBuf=null/.test(stopSrc), 'der dekodierte Buffer bleibt fuer spaetere Matches im Cache');
  ok(/SFX\.footballGoalStop\(\);/.test(grab(/function showMenu\(\)\{[\s\S]*?\n\}/, 'showMenu')),
     'showMenu() raeumt einen laufenden Torsound ab');
  ok(/SFX\.footballGoalStop\(\);/.test(grab(/function newGame\(\)\{[\s\S]*?\n\}/, 'newGame')),
     'newGame() raeumt einen laufenden Torsound ab');
  ok(!/SFX\.footballGoalStop\(\)/.test(endSrc),
     'das Matchende schneidet den Siegtor-Sound NICHT ab (er laeuft natuerlich aus)');

  // ── G. Dev-Hoerprobe nur mit ?dev=1 ──
  const devSrc = grab(/if\(DEV_MENU\)window\.addEventListener\('keydown'[\s\S]*?\n\}\);/, 'Dev-Hoerprobe');
  ok(/^if\(DEV_MENU\)/.test(devSrc), 'die Hoerprobe wird ohne ?dev=1 gar nicht erst registriert');
  ok(/const DEV_MENU=new URLSearchParams\(location\.search\)\.get\('dev'\)==='1';/.test(HTML),
     'DEV_MENU haengt exakt an ?dev=1');
  ok(/if\(mode!=='football'\|\|menuVisible\)return;/.test(devSrc),
     'die Hoerprobe wirkt nur im laufenden Football-Modus');
  ok(/SFX\.footballGoal\(e\.shiftKey\)/.test(devSrc), 'G = normales Tor, Shift+G = Matchpunktvariante');
  ok(!/score|fbGoalState|footballTryGoal|footballGoalFxTrigger|updateHud/.test(devSrc),
     'die Hoerprobe aendert weder Score noch Goal-State und loest keine Animation aus');

  // ── H. Bestehende Werte unveraendert (Pin) ──
  ok(/const FB_GOAL_FX_MS=1500;/.test(HTML) && /const FOOTBALL_GOAL_CELEBRATE_TICKS=51;/.test(HTML) &&
     /const FOOTBALL_GOAL_WIN_CELEBRATE_TICKS=66;/.test(HTML),
     'Goal-FX-Dauer und beide Celebration Windows sind unveraendert (1500 ms / 51 / 66 Ticks)');
  ok(!/SFX\./.test(strip(grab(/function footballGoalSide\(b\)\{[\s\S]*?\n\}/, 'footballGoalSide'))),
     'die Goal Detection enthaelt keinerlei Audioaufruf');
}

console.log('\nFootball-Shell: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
