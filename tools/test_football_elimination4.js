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
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }
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
const elimBlockSrc       = grab(/ARENA FOOTBALL ELIMINATION4[\s\S]*?\nfunction footballElimResetBall\(\)\{[\s\S]*?\n\}/, 'Elimination4-Block');
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
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},
               footballGoal(mp){goalSounds++;if(mp)matchPointSounds++;},footballGoalPreload(){},footballGoalStop(){}};
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
      cx, cy, BR, neutral: FOOTBALL_NEUTRAL_OWNER, players: FOOTBALL_ELIM4_PLAYERS,
      dirs(){ return fbElimDirs().map(d=>d.slice()); },
      dirs4(){ return FOOTBALL_ELIM4_DIRS.map(d=>d.slice()); },
      // -- V3: adaptive Arena --
      phaseN(){ return fbElimPhaseN; },
      slots(){ return fbElimSlots.slice(); },
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
      arenaCfg(){ const a=fbArena(); return {halfLen:a.halfLen,halfWid:a.halfWid,corner:a.corner,
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
      active(){ return fbElimActive.slice(); },
      activeOwners(){ return fbElimActiveOwners(); },
      headText(){ return fbElimHeadText(); },
      firstAimer(){ return fbElimFirstAimer(); },
      eliminate(o){ footballElimEliminate(o); },
      resetBall(){ footballElimResetBall(); },
      // -- Tor / Match --
      goalState(){ return fbGoalState; },
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
  const act = E.active(), D = E.dirs(), n = D.length, r = E.BR * 7;
  let i = 0;
  for (let o = 0; o < 4; o++) {
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
  E.setPos(4, E.cx, E.cy);
  E.setVel(4, d[0] * v, d[1] * v);
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

console.log('ARENA FOOTBALL - Dev-Prototyp ELIMINATION4 V3: ONE GOAL = OUT + ADAPTIVE ARENA\n');

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
  ok(E.variant() === 'elimination4', '?dev=1&fb=elimination4 aktiviert die Dev-Variante');
  ok(E.elim() === true && E.tactical() === false, 'Elimination4 und Tactical schliessen sich aus');
  E.setMode('bot');
  ok(E.elim() === false, 'ausserhalb mode==="football" ist Elimination4 inert');
  E.setMode('football');

  ok(E.players === 4, 'FOOTBALL_ELIM4_PLAYERS ist 4');
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
  ok(a.postInner === ca.postInner && a.postOuter === ca.postOuter,
     'Torbreite unveraendert: postInner/postOuter exakt wie im Produktivmodus');
  ok(near(E.arena().clearHalf, C.arena().clearHalf),
     'lichte Torbreite identisch zu Classic (227.84 - keine Retunung)');
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

  ok(ca.halfLen === 18.00 && ca.halfWid === 12.70, 'Classic behaelt die Produktivarena (18.00 x 12.70)');
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
  const s3 = arcShareTri(a3.halfLen, a3.corner);
  ok(a3.sides === 3 && a3.tri === true, 'Phase 3: abgerundetes Dreieck mit drei Seiten');
  ok(d3.length === 3, 'Phase 3: genau drei Tore');
  ok(a3.halfLen === 11.50 && a3.corner === 3.50, 'Phase 3: Apothem 11.50 BR, Eckradius 3.50 BR');
  ok(s3 < 0.25, 'Phase 3: gekruemmter Konturanteil ' + (s3 * 100).toFixed(1) + ' Prozent');
  ok((a3.halfLen - a3.corner) * Math.sqrt(3) > a3.postOuter,
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
  ok(near(E.arena().clearHalf, C.arena().clearHalf), 'Phase 3: lichte Torbreite unveraendert 227.84');
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
  ok(a2.sides === 2 && a2.tri === false, 'Phase 2: Rounded Rectangle mit zwei Toren');
  ok(d2.length === 2, 'Phase 2: genau zwei Tore');
  ok(near(d2[0][0], -d2[1][0]) && near(d2[0][1], -d2[1][1]),
     'Phase 2: die beiden Tore liegen EXAKT gegenueber');
  ok(a2.postFront === a2.halfLen, 'Phase 2: beide Tore haben dieselbe Zentrumsdistanz');
  ok(a2.halfLen > a2.halfWid, 'Phase 2: klare Laengsachse (Classic-Layout)');
  ok(a2.halfWid - a2.corner > a2.postOuter, 'Phase 2: der Torsockel passt in das gerade Seitensegment');
  ok(near(E.arena().clearHalf, C.arena().clearHalf), 'Phase 2: lichte Torbreite unveraendert 227.84');
  const s2 = arcShareRect(a2.halfLen, a2.halfWid, a2.corner);
  ok(s2 < arcShareRect(18.00, 12.70, 6.85), 'Phase 2: weniger gekruemmte Aussenfuehrung als Classic');

  E.forcePhase(4); const v4 = E.viewR();
  E.forcePhase(3); const v3 = E.viewR();
  E.forcePhase(2); const v2 = E.viewR();
  ok(v4 > v3 && v3 > v2, 'der Sichtradius schrumpft von Phase zu Phase (' +
     [v4, v3, v2].map(v => Math.round(v)).join(' > ') + ')');

  ok(C.arenaCfg().halfLen === 18.00 && C.arenaCfg().corner === 6.85, 'Classic behaelt die Produktivarena');
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
    let minD = Infinity, fin = true;
    for (let k = 0; k < 500; k++) {
      E.step();
      if (E.goalState() !== 'play') break;
      const b = E.snapshot()[4];
      const d = Math.hypot(b.x - E.cx, b.y - E.cy);
      if (!Number.isFinite(d)) { fin = false; break; }
      if (d < minD) minD = d;
    }
    return { minD: minD, fin: fin, start: r };
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
    ok(r.minD < r.start * 0.55,
       'Phase ' + ph + ': der tangential gestartete Ball kehrt ins Innere zurueck (' +
       Math.round(r.minD) + ' < ' + Math.round(r.start * 0.55) + ')');
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
  ok(/fbElimApplyPhase\(\);\n  for\(const b of balls\)\{/.test(elimBlockSrc),
     'der Umbau laeuft VOR dem Zuruecksetzen des Balls');
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
    // ECKMITTELPUNKTE der fertigen Form - beim Rechteck die vier Ecken des Kernrechtecks,
    // beim Dreieck die drei Ecken des geschrumpften Dreiecks. Die Richtung dorthin ist die
    // Richtung, in der der Eckbogen liegt; die Winkelhalbierende der TORACHSEN ist es bei
    // zwei gegenueberliegenden Toren gerade NICHT.
    const cornerPts = a.tri
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
          ok(r.worst <= 1e-6,
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
      // Und der Ball kommt dort auch real nicht durch.
      for (let o = 0; o < 4; o++) E.setPos(o, E.cx + (o - 1.5) * 3, E.cy + (o - 1.5) * 3);
      const off = ch + 30;
      const sx = d[0] * 30 + t[0] * off, sy = d[1] * 30 + t[1] * off;
      const rr = E.slam(4, E.cx + sx, E.cy + sy, d[0] * 30, d[1] * 30, 60);
      ok(rr.passed === false && rr.worst <= 1e-6,
         'Phase ' + ph + ' Tor ' + k + ': ein Schuss neben der Toroeffnung wird geblockt');
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
  ok(!/SUDDEN DEATH|at risk|at-risk/i.test(elimBlockSrc), 'der Elimination4-Block nennt keinen Tiebreak mehr');
  ok(!/fchip\.risk/.test(HTML), 'die Sudden-Death-HUD-Klasse ist entfernt');
  ok(!/Elim/.test(loopSrc), 'die Hauptschleife tickt keine Elimination4-Uhr mehr');
  ok(/tickCollapse\(now\);/.test(loopSrc), 'der bestehende Ring-Collapse-Timer laeuft unveraendert weiter');
  ok(/const fbElimActive=\[true,true,true,true\];/.test(elimBlockSrc),
     'fbElimActive traegt weiterhin die Aktiv-Liste');
  ok(/fbElimActive\[o\]=true;fbElimSlots\[o\]=o;\}\n  fbElimPhaseN=FOOTBALL_ELIM4_PLAYERS;/.test(elimBlockSrc),
     'der Reset setzt Aktiv-Liste, Torslots und Arenaphase zurueck');
  ok(/footballElimEliminate\(own\);\s*\/\/ EIN GEGENTOR = SOFORT AUSGESCHIEDEN/.test(elimBlockSrc),
     'die Wertung eliminiert direkt - keine Zwischenstufe');
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
  ok(S.phaseN() === 4 && JSON.stringify(S.slots()) === JSON.stringify([0, 1, 2, 3]),
     'der Moduswechsel setzt Arenaphase und Torslots zurueck');
  S.startRound();
  ok(S.snapshot().length === 3, 'nach dem Wechsel steht wieder die Classic-Aufstellung');

  ok(/const FOOTBALL_VARIANT_ELIM4='elimination4';/.test(HTML), 'die Variante heisst elimination4');
  ok(/DEV_FB_VARIANT===FOOTBALL_VARIANT_ELIM4/.test(ctaSrc), 'Elimination4 ist nur ueber den Dev-Direktlink erreichbar');
  ok(/const DEV_FB_VARIANT=DEV_MENU\?/.test(HTML), 'der fb-Parameter wird ausschliesslich mit ?dev=1 gelesen');
  ok(!/fbElim4Btn|elimination4Btn/.test(HTML), 'die sichtbare Modusauswahl hat keinen Elimination4-Eintrag');
  const modeOv = grab(/<div class="ov" id="fbModeOv">[\s\S]*?id="fbModeBack"[\s\S]*?<\/div>/, 'Modusauswahl');
  ok(!/elimination/i.test(modeOv), 'die Modusauswahl nennt Elimination4 nicht');

  ok(!/fbElim[A-Za-z]*\s*[:=][^\n]*rRef|onlineSendCommit[^\n]*fbElim/.test(HTML),
     'Elimination4 hat keinerlei Online-Anbindung');
  ok(/mode=menuMode='football';fmt='single';online=false;/.test(startFootballSrc),
     'der Startpfad pinnt auch Elimination4 fest auf online=false');

  const elimCode = elimBlockSrc.replace(/\/\/[^\n]*/g, '');
  ok(!/immun|antiTeam|friendlyProtect|fairness/i.test(elimCode),
     'keine Immunitaet, kein Teaming-Schutz, keine Fairnesskorrektur');

  // Keine phase-spezifischen Physikwerte: M1 gilt unveraendert in jeder Arenaphase.
  ok(/const FOOTBALL_PHYS=\{friction:0\.9976,frictionBall:0\.9982,fend:0\.9905,fendBall:0\.9905,/.test(HTML),
     'M1-Physik unveraendert');
  ok(/const FOOTBALL_BALL_RADIUS=25;/.test(HTML), 'Ballradius unveraendert 25');
  ok(!/fbElimPhaseN[^\n]*(friction|rest|slowv|stopv)/i.test(HTML),
     'es gibt keine phase-spezifischen Physikwerte');
}

console.log('\nFootball-Elimination4 (V3): ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
