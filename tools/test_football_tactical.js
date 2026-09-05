// Arena Football TACTICAL 1V1 — produktive Regressionssuite.
//
// Arena Football hat genau ZWEI Produktmodi: Classic 1v1 (Standard, 1 Figur je Spieler) und
// Tactical 1v1 (2 Figuren je Spieler, genau EIN Zug je Team und Runde). Tactical ist eine
// VARIANTE des Football-Modus (fbVariant), kein eigener mode, und hat KEINE eigene
// Zug-Zustandsmaschine: das Commit/Reveal-Modell ist bitgleich das von Classic.
//   verdeckte Aim-Phase Blau -> Commit -> Cover -> verdeckte Aim-Phase Rot -> Commit
//   -> Reveal -> applyLaunch startet BEIDE gewaehlten Figuren im selben Simulationsstart
//   -> gemeinsame Physik -> Settlement -> naechste verdeckte Runde
// Tactical fuegt der Pipeline nur eine Information hinzu: WELCHE der beiden eigenen Figuren
// das Team in dieser Runde bewegt.
//
// Diese Suite prueft deshalb vier Dinge:
//   1. dass die Tactical-Regeln gelten (2 Figuren je Team, EINE je Team und Runde, Auswahl
//      nur eigener Figuren, Hidden Information),
//   2. dass der Start beider Figuren gleichzeitig und vor dem ersten Physikschritt passiert,
//   3. dass Classic der Standard bleibt und strukturell unberuehrt ist,
//   4. dass die Modi sauber getrennt sind (Default, Fallback, Wechsel, kein State-Leak),
//   5. dass die sichtbare Modusauswahl genau drei Optionen zeigt (Classic als einzige
//      Empfehlung, Tactical, Elimination) und jede davon denselben Startpfad benutzt.
//
// Wie alle Football-Harnesse extrahiert sie die ECHTEN Quellen aus index.html und beobachtet
// sie von aussen — es wird nichts in den Physikkern injiziert. Kein DOM, kein Renderer, kein
// Netzwerk, kein Zufall: zwei Laeufe liefern bitidentische Ergebnisse.
//
// Usage: node tools/test_football_tactical.js

const { loadIndexHtml, grab: grabIn } = require('./extract.js');
const HTML = loadIndexHtml();
const grab = (re, name) => grabIn(HTML, re, name);

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
const speed = (b) => Math.hypot(b.vx, b.vy);

// ── Extraktion der echten Quellen ────────────────────────────────────────────────
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
const commitSrc          = grab(/function commit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'commit');
const applyCommitSrc     = grab(/function applyCommit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'applyCommit');
const applyLaunchSrc     = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
const beginRevealSrc     = grab(/function beginReveal\(\)\{[^\n]*/, 'beginReveal');
const footballBlockSrc   = grab(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nfunction stepSim\(\)\{)/, 'Football-Block');
const curFRSrc           = grab(/function curFR\(\)[^\n]*/, 'curFR');
const curFESrc           = grab(/function curFE\(\)[^\n]*/, 'curFE');
const curSTSrc           = grab(/function curST\(\)[^\n]*/, 'curST');
const stepSimSrc         = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
// Der Tactical-Abschnitt als Ganzes — Grundlage der Struktur-Assertions weiter unten.
const tacticalBlockSrc   = grab(/\/\/ ══ ARENA FOOTBALL TACTICAL[\s\S]*?\nfunction fbTacticalRingLevel\(i\)\{[\s\S]*?\n\}/, 'Tactical-Block');
// Menue-/Startpfad: Modusauswahl, Dev-Direktlink und der einzige Football-Startpunkt.
const startFootballSrc   = grab(/function startFootball\(variant,rules\)\{[\s\S]*?\n\}/, 'startFootball');
const devFbVariantSrc    = grab(/const DEV_FB_VARIANT=[^\n]*/, 'DEV_FB_VARIANT');
const ctaSrc             = grab(/\$\('ctaBtn'\)\.onclick=\(\)=>\{[\s\S]*?\n\};/, 'CTA-Handler');

// ── Sandbox ──────────────────────────────────────────────────────────────────────
// Exakt das Muster von tools/test_football_shell.js: DOM-, Audio- und Renderer-Aufrufe sind
// Zaehler-Stubs, alles Spielrelevante kommt unveraendert aus index.html.
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
    let coverCalls=[], goalSounds=0;
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},
               footballGoal(){goalSounds++;},footballGoalPreload(){},footballGoalStop(){},
               fbTransitionBed(){},fbTransitionLock(){},fbTransitionStop(){}};
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
    // ihn ueber denselben typeof-Guard wie im Browser — der Fallback ist damit echt getestet.
    ${devFbVariant === undefined ? '' : 'const DEV_FB_VARIANT=' + JSON.stringify(devFbVariant) + ';'}
    ${footballBlockSrc}
    ${curFRSrc}
    ${curFESrc}
    ${curSTSrc}
    ${inputLockedSrc}
    ${canCommitSrc}
    ${sanitizeMoveSrc}
    ${commitSrc}
    ${applyCommitSrc}
    ${applyLaunchSrc}
    ${stepSimSrc}
    return {
      cx, cy, BR, neutral: FOOTBALL_NEUTRAL_OWNER, winScore: FOOTBALL_WIN_SCORE,
      spawnCfg(){ return FOOTBALL_TACTICAL_SPAWN; },
      arena(){ return {halfLen:fbHalfLen(), halfWid:fbHalfWid(), corner:fbCorner(),
                       clearHalf:footballGoalClearHalf(), centerHalf:footballGoalCenterHalf()}; },
      setVariant(v){ fbVariant=v; }, variant(){ return fbVariant; },
      setMode(m){ mode=m; },
      tactical(){ return fbTactical(); },
      teamCap(){ return teamCap(); },
      // ── Aufstellung ──
      place(){ placeBalls(); return this.snapshot(); },
      snapshot(){ return balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,owner:b.owner,alive:b.alive})); },
      rad(i){ return ballRad(balls[i]); },
      boundSD(i){ return footballBoundSD(balls[i]).sd; },
      figureId(i){ return fbFigureId(i); },
      // ── Auswahl ──
      select(who,idx){ return fbSelectFigure(who,idx); },
      sel(){ return fbSel.slice(); },
      ringLevel(i){ return fbTacticalRingLevel(i); },
      ringConst(){ return {selected:FB_RING_SELECTED, selectable:FB_RING_SELECTABLE}; },
      pick(who,p){ return pickOwnBall(who,p); },
      // ── Commit / Reveal ──
      curAimer(){ return curAimer; },
      phase(){ return phase; },
      aimSet(){ return aimSet.slice(); },
      commitIdx(){ return commitIdx.slice(); },
      commitAim(){ return commitAim.map(a=>({dx:a.dx,dy:a.dy})); },
      coverCalls(){ return coverCalls.slice(); },
      resetCoverCalls(){ coverCalls=[]; },
      canCommit(who){ return canCommitInput(who); },
      startRound(){ startRound(); },
      commit(who,idx,fx,fy){ commit(who,idx,fx,fy,0); },
      launch(){ applyLaunch(); },
      step(){ stepSim(); },
      // Bis zum Settlement laufen lassen; liefert die Anzahl Frames (harte Obergrenze).
      settle(maxFrames){ let n=0; const lim=maxFrames||4000;
        while(phase!=='aim'&&phase!=='over'&&n<lim){ stepSim(); n++; }
        return n; },
      // ── Tor / Score ──
      score(){ return score.slice(); },
      setScore(a,b){ score=[a,b]; },
      goalSide(i){ return footballGoalSide(balls[i]); },
      goalState(){ return fbGoalState; },
      winner(){ return footballWinner; },
      overCalls(){ return gameOverCalls.slice(); },
      goalSounds(){ return goalSounds; },
      resetMatchState(){ footballResetMatchState(); },
      resetRound(){ footballResetRound(); },
      // ── Direkte Zustandsmanipulation fuer Szenarien ──
      setBalls(list){ balls=list.map(b=>({x:b.x,y:b.y,vx:b.vx||0,vy:b.vy||0,sx:b.x,sy:b.y,
                       owner:b.owner,alive:true,spin:b.spin||0})); },
      setVel(i,vx,vy){ balls[i].vx=vx; balls[i].vy=vy; },
      setPos(i,x,y){ balls[i].x=x; balls[i].y=y; },
      setPhase(p){ phase=p; },
      setAimSet(a,b){ aimSet=[a,b]; },
      setCommitIdx(a,b){ commitIdx=[a,b]; },
      setCurAimer(w){ curAimer=w; },
      escapes(){ let n=0; for(const b of balls) n+=(b.fbEscapes||0); return n; },
      // Deterministischer Zustands-Hash ueber alle Koerper (FNV-1a wie simHash im Spiel).
      hash(){ let h=2166136261>>>0;
        const mix=s=>{for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}};
        for(const b of balls)mix(b.owner+':'+(b.alive?1:0)+':'+b.x+':'+b.y+':'+b.vx+':'+b.vy+';');
        mix('|'+score.join(',')+'|'+phase);
        return ('0000000'+h.toString(16)).slice(-8); },
      finite(){ for(const b of balls){ if(!Number.isFinite(b.x)||!Number.isFinite(b.y)||
        !Number.isFinite(b.vx)||!Number.isFinite(b.vy)) return false; } return true; }
    };
  `;
  return new Function(env)();
}

// Eine vollstaendige simultane Runde ueber den ECHTEN Pfad: verdeckter Commit Blau,
// verdeckter Commit Rot, Reveal, gemeinsamer Launch, Settlement.
function playRound(E, blueIdx, bfx, bfy, redIdx, rfx, rfy) {
  E.select(0, blueIdx); E.commit(0, blueIdx, bfx, bfy);
  E.select(1, redIdx);  E.commit(1, redIdx, rfx, rfy);
  E.launch();
  return E.settle();
}

console.log('ARENA FOOTBALL — Produktsuite: Classic 1v1 (Standard) + Tactical 1v1\n');

// ══════════════════════════════════════════════════════════════════════════════════
// MODE — genau zwei Produktmodi, Classic ist Standard, sauberer Fallback
// ══════════════════════════════════════════════════════════════════════════════════
{
  // A) Start ohne Parameter -> Classic
  ok(buildEnv().variant() === 'classic', 'A) ohne fb-Parameter startet Classic');
  ok(buildEnv(null).variant() === 'classic', 'A) fb-Parameter fehlt (null) -> Classic');
  // B) fb=classic -> Classic
  ok(buildEnv('classic').variant() === 'classic', 'B) fb=classic -> Classic');
  // C) fb=tactical -> Tactical
  const TC = buildEnv('tactical');
  ok(TC.variant() === 'tactical' && TC.tactical() === true, 'C) fb=tactical -> Tactical');
  // D) fb=tactical-dual und jeder andere Unsinn -> Classic-Fallback
  for (const bad of ['tactical-dual', 'dual', 'TACTICAL', '', 'x'])
    ok(buildEnv(bad).variant() === 'classic',
       'D) ungueltiger fb-Wert "' + bad + '" faellt auf Classic zurueck');

  // E/F) Bodyanzahl je Modus
  ok(buildEnv('classic').place().length === 3, 'E) Classic startet mit 3 Bodies');
  ok(buildEnv('tactical').place().length === 5, 'F) Tactical startet mit 5 Bodies');

  // G/H) Moduswechsel im laufenden Prozess liefert die jeweils korrekte Aufstellung.
  const SW = buildEnv();
  ok(SW.place().length === 3, 'G) Ausgangslage Classic: 3 Bodies');
  SW.setVariant('tactical'); SW.resetMatchState(); SW.startRound();
  let sn = SW.snapshot();
  ok(sn.length === 5 && JSON.stringify(sn.map(b => b.owner)) === JSON.stringify([0, 0, 1, 1, SW.neutral]),
     'G) Classic -> Tactical liefert die korrekte Tactical-Aufstellung');
  SW.setVariant('classic'); SW.resetMatchState(); SW.startRound();
  sn = SW.snapshot();
  ok(sn.length === 3 && JSON.stringify(sn.map(b => b.owner)) === JSON.stringify([0, 1, SW.neutral]),
     'H) Tactical -> Classic liefert die korrekte Classic-Aufstellung');

  // I) Keine Tactical-Selection bleibt in Classic haengen.
  const LK = buildEnv('tactical');
  LK.resetMatchState(); LK.startRound(); LK.select(0, 1);
  ok(LK.sel()[0] === 1, 'I) Vorbedingung: Tactical-Auswahl steht');
  LK.setVariant('classic'); LK.resetMatchState(); LK.startRound();
  ok(LK.sel()[0] === -1 && LK.sel()[1] === -1, 'I) der Moduswechsel raeumt die Auswahl ab');
  ok(LK.select(0, 0) === false, 'I) in Classic ist die Figurenwahl vollstaendig inert');
  ok(LK.ringLevel(0) === 0 && LK.ringLevel(1) === 0, 'I) in Classic gibt es keinen Auswahlring');

  // J) Keine Classic-Commit-Indizes kontaminieren Tactical.
  const CT = buildEnv('classic');
  CT.resetMatchState(); CT.startRound(); CT.commit(0, 0, 60, 0);
  ok(CT.commitIdx()[0] === 0 && CT.aimSet()[0] === true, 'J) Vorbedingung: Classic-Commit steht');
  CT.setVariant('tactical'); CT.resetMatchState(); CT.startRound();
  ok(JSON.stringify(CT.commitIdx()) === JSON.stringify([-1, -1]),
     'J) der Wechsel nach Tactical startet ohne Classic-Commit-Indizes');
  ok(JSON.stringify(CT.aimSet()) === JSON.stringify([false, false]), 'J) und ohne gesetzte Commit-Flags');

  // ── Es gibt nur diese zwei Produktmodi: kein Dual-Rest im Produktivcode ──
  for (const dead of ['fbDual', 'fbPlan', 'tactical-dual', 'fbDualPlanMove', 'fbDualTeamCommit',
                      'fbDualApplyPlans', 'fbDualHoldTap', 'FB_RING_PLANNED', 'fbTacticalRingScale',
                      'fbClearPlanning', 'FOOTBALL_VARIANT_TACTICAL_DUAL'])
    ok(!HTML.includes(dead), 'kein Dual-Rest im Produktivcode: "' + dead + '"');
  ok((HTML.match(/fbVariant=/g) || []).length >= 1 && !/tactical-dual/.test(HTML),
     'fbVariant kennt nur noch classic und tactical');

  // ── Der EINZIGE Startpfad clamped jeden fremden Wert auf den Standardmodus ──
  // Zulaessig sind genau die VIER Produktmodi (Classic, Tactical, Team 2v2,
  // Elimination) plus der Dev-Einstieg auf die Vier-Spieler-Elimination; jeder andere
  // Wert faellt auf den Standardmodus zurueck. Der Dev-Einstieg haengt zusaetzlich an
  // ?dev=1 und ist ueber die Modusauswahl nicht erreichbar.
  ok(/fbVariant=\(variant===FOOTBALL_VARIANT_TACTICAL\|\|variant===FOOTBALL_VARIANT_ELIM/.test(startFootballSrc)
     && /\|\|variant===FOOTBALL_VARIANT_TEAM2\|\|dev4\)\?variant:'classic'/.test(startFootballSrc),
     'startFootball() clamped jede unbekannte Variante auf Classic');
  ok(/const dev4=variant===FOOTBALL_VARIANT_ELIM4&&typeof DEV_MENU!=='undefined'&&DEV_MENU;/.test(startFootballSrc),
     'der Vier-Spieler-Einstieg ist an ?dev=1 gebunden und damit kein Produktmodus');
  ok(/online=false/.test(startFootballSrc), 'startFootball() startet immer lokal (online=false)');
  ok(/fmt='single'/.test(startFootballSrc), 'startFootball() setzt das Bestandsformat single');
  ok(/\$\('fbModeOv'\)\.classList\.add\('show'\)/.test(ctaSrc),
     'die Moduskarte oeffnet die sichtbare Drei-Modi-Auswahl');
  ok(/DEV_FB_VARIANT==='classic'\|\|DEV_FB_VARIANT===FOOTBALL_VARIANT_TACTICAL/.test(ctaSrc),
     'nur ein GUELTIGER Dev-Direktlink ueberspringt die Auswahl');
  ok(/const DEV_FB_VARIANT=DEV_MENU\?/.test(devFbVariantSrc),
     'der fb-Parameter wird ausschliesslich mit ?dev=1 gelesen');

  // Der Aktionsbutton ("Stehen bleiben") muss in Tactical die GEWAEHLTE Figur committen —
  // der Zug ist ein Nullzug, aber commitIdx steuert die Reveal-Markierung.
  const actSrc = grab(/\$\('actBtn'\)\.onclick=\(\)=>\{[\s\S]*?\n  commit\(who,idx,0,0\);\};/, 'actBtn-Handler');
  ok(/fbTactical\(\)&&fbSel\[who\]>=0\)idx=fbSel\[who\]/.test(actSrc),
     '"Stehen bleiben" committet in Tactical die gewaehlte Figur, nicht pauschal die erste');
  // Beim Verlassen des Matches faellt die Variante auf den Standardmodus zurueck —
  // sonst zeigt die Menue-Vorschau die Tactical-Aufstellung, obwohl Classic empfohlen wird.
  const showMenuSrc = grab(/function showMenu\(\)\{[\s\S]*?updScrollHint\(\);\}/, 'showMenu');
  ok(/fbVariant='classic';/.test(showMenuSrc),
     'showMenu() setzt die Football-Variante auf den Standardmodus zurueck');

  // ── SICHTBARE MODUSAUSWAHL: genau FUENF Optionen, Classic als einzige Empfehlung ──
  // Vier lokale Modi (Classic, Tactical, Team 2v2, Elimination) plus ONLINE. Geprueft
  // wird das Modal selbst (Struktur, Reihenfolge, Empfehlung) und die Verdrahtung der
  // Buttons.
  const fbModalSrc = grab(/<div class="ov" id="fbModeOv">[\s\S]*?<button class="wbtn" id="fbModeBack">/, 'fbModeOv');
  const voptBtns = fbModalSrc.match(/<button class="vopt[^"]*" id="(\w+)">/g) || [];
  ok(voptBtns.length === 5, 'die Modusauswahl zeigt genau fuenf Optionen (erhalten: ' + voptBtns.length + ')');
  ok(/<button class="vopt rec" id="fbClassicBtn">/.test(fbModalSrc), 'Option 1 ist Classic');
  ok(/<button class="vopt" id="fbTacticalBtn">/.test(fbModalSrc), 'Option 2 ist Tactical');
  ok(/<button class="vopt" id="fbElimBtn">/.test(fbModalSrc), 'Option 3 ist Elimination');
  ok(/<button class="vopt" id="fbOnlineBtn">/.test(fbModalSrc), 'Option 4 ist Online');
  ok(fbModalSrc.indexOf('fbClassicBtn') < fbModalSrc.indexOf('fbTacticalBtn') &&
     fbModalSrc.indexOf('fbTacticalBtn') < fbModalSrc.indexOf('fbElimBtn') &&
     fbModalSrc.indexOf('fbElimBtn') < fbModalSrc.indexOf('fbOnlineBtn'),
     'Reihenfolge Classic -> Tactical -> Elimination -> Online');
  ok((fbModalSrc.match(/class="vopt rec"/g) || []).length === 1,
     'genau EINE Option ist empfohlen (.vopt.rec)');
  ok(!/id="fbElimBtn"[\s\S]{0,40}rec/.test(fbModalSrc) && /<button class="vopt" id="fbElimBtn">/.test(fbModalSrc),
     'Elimination wird NICHT empfohlen — Classic bleibt der Standard');
  ok(!/id="fbOnlineBtn"[\s\S]{0,40}rec/.test(fbModalSrc), 'Online wird ebenfalls nicht empfohlen');
  ok(/id="fbModeBack"/.test(HTML) && /\$\('fbModeBack'\)\.onclick=\(\)=>\$\('fbModeOv'\)\.classList\.remove\('show'\)/.test(HTML),
     'der Zurueck-Button schliesst das Modal unveraendert');
  // Jede Option ruft denselben einzigen Startpfad mit ihrer Variante auf — kein zweiter Pfad,
  // keine Zwischenbestaetigung, dieselbe Haptik wie die Bestandsoptionen.
  // TACTICAL startet direkt. ELIMINATION oeffnet seine Einrichtung und startet von dort
  // ueber DIESELBE Funktion - der Startpfad ist derselbe, nur der Weg dorthin ist einen
  // Schirm laenger (Regel und Teilnehmerzahl muessen vorher feststehen).
  // Geprueft wird ueber den ausgeschnittenen Handler statt ueber einen zusammengesetzten
  // regulaeren Ausdruck: der Handler darf umgebrochen sein, und ein Muster mit vier
  // Escape-Ebenen prueft am Ende nur noch sich selbst.
  for (const [id, arg] of [['fbTacticalBtn', 'FOOTBALL_VARIANT_TACTICAL'],
                           ['fbLivesBtn', 'FOOTBALL_VARIANT_ELIM'],
                           ['fbTimedBtn', 'FOOTBALL_VARIANT_ELIM']]) {
    const at = HTML.indexOf("$('" + id + "').onclick=");
    const src = at >= 0 ? HTML.slice(at, HTML.indexOf('};', at) + 2) : '';
    ok(src.includes('if(SFX.click())vibrateMs(VIBE_CONFIRM_MS);')
       && src.includes('startFootball(' + arg + ');'),
       id + ' startet ueber startFootball() mit der eigenen Variante und derselben Haptik');
  }
  // CLASSIC startet seit dem Regelpass NICHT sofort, sondern oeffnet die Regelwahl —
  // dieselbe Bauweise wie die Modusauswahl darueber. Gestartet wird erst aus ihr heraus,
  // und zwar mit der GEWAEHLTEN Regel als zweitem Argument.
  ok(/\$\('fbClassicBtn'\)\.onclick=\(\)=>\{[^\n]*\n[^\n]*fbRuleOv'\)\.classList\.add\('show'\);\};/.test(HTML),
     'fbClassicBtn oeffnet die Regelwahl statt sofort zu starten');
  for (const [id, rules] of [['fbFirst3Btn', 'FOOTBALL_RULES_FIRST3'],
                             ['fbSpeedBtn', 'FOOTBALL_RULES_SPEED']]) {
    ok(HTML.includes("startFootball('classic'," + rules + ");"),
       id + ' startet Classic mit ' + rules);
  }
  // Eine Definition, SECHS Menue-Aufrufer (Classic-Regelwahl zwei, Elimination-
  // Einrichtung zwei, Tactical einer, Team 2v2 einer), der Dev-Direktlink — und eine
  // Kommentarerwaehnung. ONLINE ist bewusst NICHT darunter: es startet kein lokales
  // Match, sondern uebergibt an den bestehenden Onlinebildschirm.
  ok((HTML.match(/startFootball\(/g) || []).length === 9,
     'kein zweiter Startpfad neben startFootball() (erhalten: ' + (HTML.match(/startFootball\(/g) || []).length + ')');
  const onlineHandler = grab(/\$\('fbOnlineBtn'\)\.onclick=\(\)=>\{[\s\S]*?\n\};/, 'fbOnlineBtn-Handler');
  ok(!/startFootball/.test(onlineHandler), 'ONLINE startet kein lokales Match');
  ok(/mode='football'; fbVariant=FOOTBALL_VARIANT_ELIM; fmt=FB_ONLINE_FMT; fbElimStartN=0;/.test(onlineHandler),
     'es setzt nur den Kontext - Raumtyp, Variante, freie Startbesetzung');
  ok(/openOnline\(\);/.test(onlineHandler),
     'und uebergibt an den BESTEHENDEN Onlinebildschirm - kein zweiter Ablauf');
  ok(/\$\('fbModeOv'\)\.classList\.remove\('show'\);/.test(onlineHandler),
     'die Modusauswahl schliesst sich dabei');
  ok(/if\(TUNE\)/.test(onlineHandler) && /r3dActive/.test(onlineHandler),
     'und es gelten dieselben Vorbedingungen wie fuer die lokalen Modi (Tuning, 3D-Szene)');
  // Der Produktweg ist NICHT an ?dev=1 gebunden - genau das ist der Zweck.
  ok(!/DEV_MENU/.test(onlineHandler), 'der Produktweg verlangt kein ?dev=1');
  // Elimination hat jetzt EINEN Einrichtungsschritt — gebaut wie die Classic-Regelwahl,
  // weil dort zwei Entscheidungen zusammengehoeren, die beide vor dem Anpfiff fallen
  // muessen: nach welcher Regel ausgeschieden wird und mit wie vielen Leuten.
  const elimOv = grab(/<div class="ov" id="fbElimOv">[\s\S]*?id="fbElimBack"[\s\S]*?<\/div>/, 'Elimination-Einrichtung');
  ok(/id="fbLivesBtn"/.test(elimOv) && /id="fbTimedBtn"/.test(elimOv),
     'die Einrichtung bietet beide Regeln an — die Leben bleiben erreichbar');
  ok(/<button class="vopt rec" id="fbLivesBtn">/.test(elimOv) && !/id="fbTimedBtn"[^>]*rec/.test(elimOv),
     'die Leben bleiben die empfohlene Regel, Timed FFA wird nicht empfohlen');
  ok(/id="fbElimN3"/.test(elimOv) && /id="fbElimN4"/.test(elimOv) && /id="fbElimN5"/.test(elimOv),
     'und sie bietet drei Teilnehmerzahlen an: 3, 4 und 5');
  ok(!/fbElimConfirm|elimConfirm/.test(HTML),
     'dahinter kommt aber keine weitere Bestaetigung — ein Schirm, dann Anpfiff');

  // ── i18n: die neuen Strings existieren in allen drei Sprachen ──
  for (const [lang, title, sub] of [['EN', 'ELIMINATION', '3–5 PLAYERS · LIVES OR TIMED'],
                                    ['DE', 'ELIMINATION', '3–5 SPIELER · LEBEN ODER ZEIT'],
                                    ['TR', 'ELİMİNASYON', '3–5 OYUNCU · CAN VEYA SÜRE']]) {
    ok(HTML.includes("fbElimT:'" + title + "',fbElimS:'" + sub + "'"),
       lang + ': Elimination-Titel und Kurztext vorhanden');
  }
  ok((HTML.match(/fbElimT:'/g) || []).length === 3 && (HTML.match(/fbElimS:'/g) || []).length === 3,
     'die Elimination-Strings existieren in genau drei Sprachtabellen');
  ok(/\$\('fbElimT'\)\.textContent=T\('fbElimT'\);\$\('fbElimS'\)\.textContent=T\('fbElimS'\);/.test(HTML),
     'applyLang() beschriftet die dritte Option mit');
  ok((HTML.match(/fbOnlineT:'/g) || []).length === 3 && (HTML.match(/fbOnlineS:'/g) || []).length === 3,
     'auch die Online-Strings stehen in genau drei Sprachtabellen');
  ok((HTML.match(/onSubFb:'/g) || []).length === 3,
     'und der Untertitel des Onlinebildschirms ebenfalls');
  ok(/\$\('fbOnlineT'\)\.textContent=T\('fbOnlineT'\);\$\('fbOnlineS'\)\.textContent=T\('fbOnlineS'\);/.test(HTML),
     'applyLang() beschriftet auch die vierte Option');
  // Keine Tech-Begriffe in der primaeren Auswahl.
  for (const word of ['HIDDEN', 'COMMIT', 'HOTSEAT', 'DEV', 'ADAPTIVE'])
    ok(!new RegExp(word).test(fbModalSrc), 'kein Tech-Begriff im Auswahlmodal: "' + word + '"');

  // ── EINSTIEGS-PIN: es gibt genau FUENF Stellen, die mode='football' setzen. Die
  //    Zahl ist bewusst gepinnt - eine sechste waere eine neue Tuer in den Modus und
  //    muss auffallen:
  //      1. startFootball        - der lokale Produktweg, pinnt online=false
  //      2. fbOnlineBtn          - der oeffentliche Onlineeinstieg aus der Modusauswahl
  //      3. der Dev-Einstieg     - derselbe Kontext, nur ohne den Umweg ueber die Auswahl
  //      4. joinRoom             - Beitritt zu einem bestehenden Football-Raum
  //      5. attemptRejoin        - Rueckkehr auf den eigenen Sitz
  const fbAssignments = (HTML.match(/mode=menuMode='football'|mode='football'/g) || []).length;
  ok(fbAssignments === 5, 'mode="football" wird an genau fuenf Stellen gesetzt (erhalten: ' + fbAssignments + ')');
  // Der DEV-Einstieg bleibt vollstaendig erhalten und bleibt an ?dev=1 gebunden.
  ok(/\$\('devFbOnlineBtn'\)\.onclick=\(\)=>\{\s*if\(!DEV_MENU\)return;/.test(HTML),
     'der Dev-Einstieg ist im Handler selbst weiterhin an ?dev=1 gebunden');
  ok(/if\(DEV_MENU\)\{\$\('devPanel'\)\.style\.display='';\$\('devFbOnlineSec'\)\.style\.display='';\}/.test(HTML),
     'und das Dev-Panel wird ohne ?dev=1 weiterhin nicht eingeblendet');
  // Und beide Einstiege setzen WOERTLICH denselben Kontext - es gibt keinen zweiten Weg.
  const devHandler = grab(/\$\('devFbOnlineBtn'\)\.onclick=\(\)=>\{[\s\S]*?\n\};/, 'devFbOnlineBtn-Handler');
  const KONTEXT = "mode='football'; fbVariant=FOOTBALL_VARIANT_ELIM; fmt=FB_ONLINE_FMT; fbElimStartN=0;";
  ok(devHandler.includes(KONTEXT) && onlineHandler.includes(KONTEXT),
     'Produktweg und Dev-Einstieg setzen denselben Kontext');
  ok(/openOnline\(\);/.test(devHandler), 'und beide rufen denselben Onlinebildschirm');
  // Die sichtbare Auswahl fuehrt jetzt selbst dorthin - ohne Entwicklerbegriffe.
  ok(!/devFbOnlineBtn|DEV|\?dev=1/.test(fbModalSrc),
     'die Modusauswahl nennt keinen Entwicklerbegriff');
  ok(/id="fbOnlineBtn"/.test(fbModalSrc), 'sondern einen normalen Online-Eintrag');
  // Vier Optionen sind hoeher als ein Telefon im QUERFORMAT. Gemessen bei 568x320 und
  // 667x375: das Panel war 485 px hoch, der Zurueck-Knopf lag vollstaendig ausserhalb -
  // und weil .ov zentriert und html/body overflow:hidden sind, war er unerreichbar.
  // Das Panel bekommt deshalb eine Hoehengrenze und laeuft innen.
  ok(/max-height:calc\(100vh - 24px\);max-height:calc\(100dvh - 24px\);overflow-y:auto/.test(HTML),
     'das Modalpanel ist hoehenbegrenzt und scrollt auf kurzen Bildschirmen');
  ok(/overscroll-behavior:contain/.test(HTML),
     'und nimmt die Seite dahinter nicht mit');

  // ── DER KOPF DES ONLINEBILDSCHIRMS sagt die Wahrheit ──
  // Der Raum fasst fuenf, gestartet wird ab zwei. Ein Kopf, der "5" verspricht, waere
  // eine Falschauskunft an genau der Stelle, an der der Spieler entscheidet.
  const titelSrc = grab(/function setOnTitle\(ffa\)\{[\s\S]*?\n\}/, 'setOnTitle');
  ok(/\$\('onTitleMode'\)\.textContent=fbo\?'ARENA FOOTBALL'/.test(titelSrc),
     'der Onlinebildschirm nennt Arena Football beim Namen');
  ok(/\$\('onBadgeN'\)\.textContent=fbo\?'2–5'/.test(titelSrc),
     'und zeigt die Spielerzahl als 2–5, nicht als feste 5');
  ok(/\$\('onCtxt'\)\.textContent=fbo\?T\('onSubFb'\)/.test(titelSrc),
     'der Untertitel kommt aus der Sprachtabelle - dreisprachig wie alles andere');
  ok(!/Elimination · 5 Spieler/.test(HTML),
     'der fest verdrahtete Fuenf-Spieler-Text ist verschwunden');

  // ── DER RUECKWEG: kein Rest aus dem Onlinebildschirm ──
  // Wer den Onlinebildschirm verlaesst, ohne einen Raum betreten zu haben, muss den
  // Menuekontext VOLLSTAENDIG wiederfinden. Ohne das bliebe nach einem Abbruch aus dem
  // Football-Online das Raumformat im fmt-Global stehen, waehrend mode schon wieder
  // RingOut ist - ein Mischzustand, der erst beim naechsten Start auffiele.
  const backSrc = grab(/const onlineBack=\(\)=>\{[\s\S]*?updScrollHint\(\);\};/, 'onlineBack');
  ok(/leaveOnline\(\);/.test(backSrc), 'der Rueckweg nimmt den bestehenden Verlassen-Pfad');
  ok(/mode=menuMode;/.test(backSrc), 'stellt den zuletzt gewaehlten Menuemodus wieder her');
  ok(/updateMenuPreview\(\);/.test(backSrc),
     'und setzt mode, Format und Spielerzahl gemeinsam aus der sichtbaren Auswahl zurueck');
  ok(backSrc.indexOf('leaveOnline();') < backSrc.indexOf('updateMenuPreview();'),
     'und zwar ERST nach dem Verlassen - sonst liefe die Vorschau in eine offene Sitzung');
  // updateMenuPreview fasst eine laufende Sitzung nie an.
  const prevSrc = grab(/function updateMenuPreview\(\)\{[\s\S]*?\n\}/, 'updateMenuPreview');
  ok(/if\(online\)return;/.test(prevSrc), 'die Vorschau ruehrt eine laufende Online-Sitzung nicht an');

  // ── DER AUSTRITT AUS EINEM LAUFENDEN MATCH bleibt der kanonische ──
  // Der neue Einstieg darf die C4B-Semantik nicht umgehen: ein laufendes Football-Match
  // wird ueber denselben bestaetigten Austritt verlassen wie bisher.
  ok(/if\(fbPermanentLeaveRequired\(\)\)return void fbBeginCanonicalLeave\(after\);/.test(HTML),
     'leaveOnline faehrt fuer ein laufendes Football-Match weiterhin den kanonischen Austritt');
  ok(/function fbPermanentLeaveRequired\(\)\{\s*return !!\(window\.FB&&roomCode&&gameStarted&&myPlayer>=0&&fbOnlineRoom\(\)&&!fbLeaveRetired\);/.test(HTML),
     'und die Bedingung dafuer ist unveraendert an das LAUFENDE Match gebunden');
  ok(!/fbPermanentLeaveRequired|fbBeginCanonicalLeave/.test(onlineHandler),
     'der neue Einstieg kennt den Austrittspfad gar nicht - er kann ihn nicht umgehen');
  ok(!/leaveOnline/.test(onlineHandler),
     'und verlaesst beim Betreten auch keine Sitzung');

  // ── DIE MUSIK laeuft weiter ──
  // Der Onlinebildschirm ist eine Flaeche UEBER dem Menue: die Szene wechselt auf
  // 'lobby', die Uhr des Stuecks laeuft unveraendert weiter.
  ok(!/fbMusicStop|FBMUSIC/.test(onlineHandler),
     'der Einstieg haelt das Thema nicht an - es wechselt nur die Besetzung');
  ok(/if\(menuVisible\)return fbMusicLobbyOpen\(\)\?'lobby':'menu';/.test(HTML),
     'der Onlinebildschirm ist der Lobby-Zustand des laufenden Themas');
  ok(/return !!fbMusicOnlinePanel&&fbMusicOnlinePanel\.classList\.contains\('show'\);/.test(HTML),
     'erkannt an derselben Flaeche, die der Einstieg oeffnet');

  // ── RINGOUT bleibt unberuehrt ──
  // Der Einstieg fasst weder den RingOut-Onlineweg noch die Menueauswahl an.
  ok(/\$\('ffaOnline'\)\.onclick=\(\)=>\{SFX\.unlock\(\);fmt='ffa';openOnline\(\);\};/.test(HTML),
     'der FFA-Onlineeinstieg ist unveraendert');
  ok(!/menuMode/.test(onlineHandler),
     'der Football-Einstieg laesst die Menueauswahl stehen - der Rueckweg findet sie wieder');
  ok((HTML.match(/function openOnline\(\)\{/g) || []).length === 1,
     'es gibt genau EINEN Onlinebildschirm fuer alle Modi');
  ok((HTML.match(/function createRoom\(\)\{/g) || []).length === 1 &&
     (HTML.match(/function joinRoom\(\)\{/g) || []).length === 1,
     'und je genau eine Raumanlage und einen Beitritt');
  ok(/mode=menuMode='football';fmt='single';online=false;/.test(startFootballSrc),
     'der Startpfad pinnt Arena Football fest auf online=false');
  const previewSrc = grab(/function updateMenuPreview\(\)\{[\s\S]*?\n\}/, 'updateMenuPreview');
  ok(/if\(online\)return;/.test(previewSrc),
     'die zweite Zuweisung liegt in der Menue-Vorschau, die bei online sofort aussteigt');
  ok(!/config:\{[^}]*mode/.test(HTML), 'Online-Raeume tragen kein mode-Feld — Football ist dort nie erreichbar');
}

// ══════════════════════════════════════════════════════════════════════════════════
// A — VARIANTE, CLASSIC-INVARIANZ UND STRUKTUR
// ══════════════════════════════════════════════════════════════════════════════════
{
  const E = buildEnv();
  ok(E.variant() === 'classic', 'Default-Variante ist Classic (ohne Dev-Flag nie Tactical)');
  ok(E.tactical() === false, 'fbTactical() ist im Default false');

  const classic = E.place();
  ok(classic.length === 3, 'Classic stellt weiterhin genau 3 Kugeln auf (erhalten: ' + classic.length + ')');
  ok(JSON.stringify(classic.map(b => b.owner)) === JSON.stringify([0, 1, E.neutral]),
     'Classic-Owner unveraendert [0,1,neutral]');
  ok(E.teamCap() === 1, 'Classic-teamCap unveraendert 1');

  E.setVariant('tactical');
  ok(E.tactical() === true, 'fbVariant=tactical aktiviert Tactical im Football-Modus');
  E.setMode('bot');
  ok(E.tactical() === false, 'Tactical greift ausschliesslich bei mode==="football"');
  E.setMode('football');
  ok(E.teamCap() === 2, 'Tactical-teamCap ist 2 (zwei Figuren je Team)');

  // ── KEINE zweite Zug-Zustandsmaschine: die alternierende Logik des ersten Prototyps
  //    ist restlos entfernt. (Der Renderer hat eine gleichnamige lokale Bandhilfe, deshalb
  //    wird gezielt der Tactical-Block geprueft, nicht die ganze Datei.)
  ok(!/fbTurn|fbArmTurn|fbHandOverTurn/.test(tacticalBlockSrc),
     'kein alternierender Zugzustand mehr im Tactical-Block');
  ok(!/fbTactical/.test(canCommitSrc),
     'canCommitInput enthaelt keine Tactical-Sonderregel mehr (Classic-Semantik)');
  ok(!/fbTactical/.test(applyCommitSrc),
     'applyCommit enthaelt keinen Tactical-Sonderpfad mehr — Blau und Rot committen wie in Classic');
  ok(!/fbArmTurn|fbTurn/.test(startRoundSrc), 'startRound ohne alternierende Tactical-Logik');
  ok(!/fbArmTurn/.test(stepSimSrc), 'stepSim ohne alternierende Tactical-Logik');
  // Beide committeten Bodies bekommen ihre Velocity VOR dem Phasenwechsel nach 'sim'.
  const viLaunch = applyLaunchSrc.indexOf('balls[idx].vx=');
  const siLaunch = applyLaunchSrc.indexOf("setPhase('sim')");
  ok(viLaunch > 0 && siLaunch > viLaunch,
     'applyLaunch setzt alle Startgeschwindigkeiten VOR setPhase("sim")');
  ok(!/stepSim\(/.test(applyLaunchSrc),
     'applyLaunch fuehrt keinen Physikschritt aus — kein Body startet frueher als der andere');

  // Struktur: der Tactical-Block enthaelt keine Zeit-, Zufalls- oder Umgebungsquelle.
  ok(!/performance\.now\(|Date\.now\(|Math\.random\(/.test(tacticalBlockSrc),
     'Tactical-Block ohne Zeit-/Zufallsquelle (keine neue Frame-Time-Abhaengigkeit)');
  ok(!/URLSearchParams|location\./.test(tacticalBlockSrc),
     'Tactical-Block liest keine URL/Umgebung (das tut nur DEV_FB_VARIANT)');
  ok(!/multiSelect|dragShooter2|aimPid2/.test(HTML),
     'kein zweiter Aim-/Drag-Kanal im Produktivcode (kein simultaner Doppelschuss EINES Teams)');
  // Physik unveraendert.
  ok((HTML.match(/const FOOTBALL_PHYS=/g) || []).length === 1,
     'FOOTBALL_PHYS bleibt die einzige Physikkonfiguration');
  ok(!/TACTICAL_PHYS|FOOTBALL_TACTICAL_(FRICTION|REST|LAUNCH)/.test(HTML),
     'keine Tactical-eigenen Physikparameter');
  ok(/const FOOTBALL_BALL_RADIUS=25;/.test(HTML), 'Ballradius 25 unveraendert');
  // Grundflaeche unveraendert (18.00 x 12.70); das WANDPROFIL kommt seit der
  // Kanonisierung aus derselben Quelle wie Classic, Team 2v2 und das Finale.
  ok(/const FOOTBALL_ARENA=fbTwoGoalArena\(18\.00,12\.70,7\.65\);/.test(HTML),
     'Tactical behaelt Grundflaeche und Spawn und liest das Wandprofil kanonisch');
  // Die Zahlen stehen unter einem Namen (FB_GOAL_ASSET_*) und werden nirgends skaliert.
  // Geprueft wird beides: die Herkunft im Quelltext und der Wert zur Laufzeit.
  ok(/const FB_GOAL_ASSET_INNER=3\.560, FB_GOAL_ASSET_OUTER=5\.282;/.test(HTML) &&
     /postInner:FB_GOAL_ASSET_INNER,postOuter:FB_GOAL_ASSET_OUTER,postFront:halfLen/.test(HTML),
     'Torgeometrie unveraendert: jede Arena steht auf den gemessenen Asset-Kanten 3.560/5.282');
  ok(!/FB_CLASSIC_GOAL_K/.test(HTML),
     'es gibt keinen modusabhaengigen Torbreitenfaktor mehr — auch nicht fuer Classic');
}

// ══════════════════════════════════════════════════════════════════════════════════
// A2 — CLASSIC 1V1: der Standardmodus laeuft unveraendert durch dieselbe Pipeline
// ══════════════════════════════════════════════════════════════════════════════════
{
  const C = buildEnv('classic');
  C.resetMatchState(); C.setScore(0, 0); C.resetCoverCalls(); C.startRound();
  const s0 = C.snapshot();
  ok(s0.length === 3, 'Classic: genau 3 Bodies (1 Blau, 1 Rot, 1 neutraler Ball)');
  ok(s0.filter(b => b.owner === 0).length === 1 && s0.filter(b => b.owner === 1).length === 1,
     'Classic: genau eine Figur je Spieler');
  ok(s0[2].x === C.cx && s0[2].y === C.cy, 'Classic: neutraler Ball exakt im Mittelpunkt');
  ok(near(s0[1].x, 2 * C.cx - s0[0].x) && near(s0[0].y, C.cy) && near(s0[1].y, C.cy),
     'Classic-Spawns unveraendert: Blau links, Rot exakt gespiegelt, beide auf der Mittelachse');

  // Hidden Commit/Reveal: Blau verdeckt, Cover, Rot verdeckt, dann Reveal.
  ok(JSON.stringify(C.coverCalls()) === JSON.stringify([0]), 'Classic: Rundenbeginn verdeckt bei Blau');
  C.commit(0, 0, 60, 12);
  ok(C.phase() === 'aim' && C.aimSet()[1] === false, 'Classic: der Blau-Commit startet keine Physik');
  ok(JSON.stringify(C.coverCalls()) === JSON.stringify([0, 1]), 'Classic: Cover-Wechsel zu Rot');
  C.commit(1, 1, -60, 12);
  ok(C.phase() === 'reveal', 'Classic: erst nach beiden Commits folgt das Reveal');
  const pre = C.snapshot();
  C.launch();
  const post = C.snapshot();
  const started = post.map((b, i) => (speed(b) > 0 ? i : -1)).filter(i => i >= 0);
  ok(JSON.stringify(started) === JSON.stringify([0, 1]),
     'Classic: beide Spielerfiguren starten simultan (erhalten: [' + started.join(',') + '])');
  ok(speed(post[2]) === 0, 'Classic: der neutrale Ball erhaelt keinen Startimpuls');
  ok(post.every((b, i) => near(b.x, pre[i].x) && near(b.y, pre[i].y)),
     'Classic: keine Position aendert sich vor dem ersten Physikschritt');
  C.settle();
  ok(C.phase() === 'aim' && C.curAimer() === 0, 'Classic: nach dem Settlement wieder verdeckt bei Blau');

  // Tor, Reset und First to 3 unveraendert.
  const hl = C.arena().halfLen;
  const G = buildEnv('classic');
  G.place(); G.setScore(0, 0); G.resetMatchState(); G.setPhase('sim');
  G.setPos(2, G.cx + hl - 60, G.cy); G.setVel(2, 9, 0);
  for (let i = 0; i < 400 && G.goalState() === 'play'; i++) G.step();
  ok(G.score()[0] === 1 && G.goalSounds() === 1, 'Classic: Tor wertet unveraendert (ein Punkt, ein Sound)');
  for (let i = 0; i < 500 && G.phase() !== 'aim'; i++) G.step();
  const ref = buildEnv('classic').place();
  ok(G.snapshot().every((b, i) => near(b.x, ref[i].x) && near(b.y, ref[i].y) && speed(b) === 0),
     'Classic: nach dem Tor stehen alle 3 Bodies wieder auf Startposition');
  // MATCHZIEL. Classic laeuft seit dem Zeitmodus-Pass auf Zeit und endet NICHT mehr beim
  // dritten Tor; TACTICAL behaelt First-to-3 unveraendert. Beides wird hier nebeneinander
  // geprueft, damit die Trennung nicht unbemerkt verrutscht.
  const W = buildEnv('classic');
  ok(W.winScore === 3, 'FOOTBALL_WIN_SCORE bleibt 3 — es gilt fuer Classic FIRST TO 3 und Tactical');
  // CLASSIC FIRST TO 3 (die Standardregel): das dritte Tor entscheidet, wie eh und je.
  W.place(); W.resetMatchState(); W.setScore(2, 0); W.setPhase('sim');
  W.setPos(2, W.cx + hl - 60, W.cy); W.setVel(2, 9, 0);
  for (let i = 0; i < 400 && W.goalState() === 'play'; i++) W.step();
  ok(W.score()[0] === 3 && W.winner() === 0,
     'Classic FIRST TO 3: das dritte Tor entscheidet das Match');
  const WT = buildEnv('tactical');
  WT.place(); WT.resetMatchState(); WT.setScore(2, 0); WT.setPhase('sim');
  // Tactical hat vier Figuren; der neutrale Ball ist Koerper 4, nicht 2.
  WT.setPos(4, WT.cx + hl - 60, WT.cy); WT.setVel(4, 9, 0);
  for (let i = 0; i < 400 && WT.goalState() === 'play'; i++) WT.step();
  ok(WT.score()[0] === 3 && WT.winner() === 0,
     'Tactical: das dritte Tor entscheidet das Match — unveraendert');
}

// ══════════════════════════════════════════════════════════════════════════════════
// B — AUFSTELLUNG: 2+2+1, eindeutige IDs, symmetrisch, kollisionsfrei
// ══════════════════════════════════════════════════════════════════════════════════
const T = buildEnv();
// Die Quelltextpruefung oben zeigt, dass Tactical die Asset-Kanten unveraendert benutzt.
// Hier derselbe Nachweis zur Laufzeit: 227.84 px — dieselbe Oeffnung wie in Classic und
// im Elimination-Finale.
{ T.setMode('football'); T.setVariant('tactical');
  ok(Math.abs(T.arena().clearHalf - 3.560 * T.BR) < 1e-9,
     'Tactical-Toroeffnung misst zur Laufzeit unveraendert 227.84 px (' +
     (2 * T.arena().clearHalf).toFixed(2) + ')'); }
T.setVariant('tactical');
const S = T.place();
{
  ok(S.length === 5, 'Tactical stellt genau 5 Koerper auf (erhalten: ' + S.length + ')');
  ok(S.filter(b => b.owner === 0).length === 2, 'Blau besitzt genau 2 Figuren (B1/B2)');
  ok(S.filter(b => b.owner === 1).length === 2, 'Rot besitzt genau 2 Figuren (R1/R2)');
  ok(S.filter(b => b.owner === T.neutral).length === 1, 'genau 1 neutraler Ball');
  ok(JSON.stringify(S.map(b => b.owner)) === JSON.stringify([0, 0, 1, 1, T.neutral]),
     'stabile Reihenfolge B1,B2,R1,R2,Ball');

  const ids = S.map((_, i) => T.figureId(i));
  ok(JSON.stringify(ids) === JSON.stringify(['B1', 'B2', 'R1', 'R2', 'BALL']),
     'eindeutige Figur-IDs B1/B2/R1/R2/BALL (erhalten: ' + ids.join(',') + ')');
  ok(new Set(ids).size === ids.length, 'keine ID doppelt vergeben');

  const ball = S[4];
  ok(ball.x === T.cx && ball.y === T.cy, 'neutraler Ball startet exakt im Mittelpunkt');

  for (let i = 0; i < 2; i++) {
    const blue = S[i], red = S[i + 2];
    ok(near(red.x, 2 * T.cx - blue.x, 1e-9) && near(red.y, blue.y, 1e-9),
       'Figur ' + (i + 1) + ': Rot exakt an der Mittelachse gespiegelt');
  }
  const dist = (b, x, y) => Math.hypot(b.x - x, b.y - y);
  for (let i = 0; i < 2; i++) {
    ok(near(dist(S[i], T.cx, T.cy), dist(S[i + 2], T.cx, T.cy), 1e-9),
       'Figur ' + (i + 1) + ': identischer Abstand zum Ball fuer Blau und Rot');
    const hl = T.arena().halfLen;
    ok(near(dist(S[i], T.cx - hl, T.cy), dist(S[i + 2], T.cx + hl, T.cy), 1e-9),
       'Figur ' + (i + 1) + ': identischer Abstand zum eigenen Tor fuer Blau und Rot');
  }

  let minGap = Infinity;
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const gap = Math.hypot(S[i].x - S[j].x, S[i].y - S[j].y) - (T.rad(i) + T.rad(j));
    minGap = Math.min(minGap, gap);
  }
  ok(minGap > 0, 'keine Ueberlappung im Spawnbild (kleinster Spalt ' + minGap.toFixed(2) + ' px)');
  ok(minGap > T.BR, 'kein Startkontakt — kleinster Spalt > 1 BR (' + minGap.toFixed(2) + ' px)');

  // footballBoundSD misst bereits die Kugel-OBERFLAECHE: sd<0 = Abstand nach innen.
  let minEdge = Infinity;
  for (let i = 0; i < S.length; i++) minEdge = Math.min(minEdge, -T.boundSD(i));
  ok(minEdge > 3 * T.BR, 'keine Figur startet an der Bande (kleinster Randabstand '
     + minEdge.toFixed(1) + ' px)');

  const hl = T.arena().halfLen, clear = T.arena().clearHalf;
  for (let i = 0; i < 4; i++) {
    const dx = Math.abs(S[i].x - T.cx), dy = Math.abs(S[i].y - T.cy);
    ok(hl - dx > 4 * T.BR, T.figureId(i) + ' startet nicht direkt an der Torlinie');
    if (dx > hl - 8 * T.BR) ok(dy > clear, T.figureId(i) + ' startet ausserhalb des Torkorridors');
  }

  const again = T.place();
  ok(JSON.stringify(again) === JSON.stringify(S), 'placeBalls() ist deterministisch (identisches Spawnbild)');
}

// ══════════════════════════════════════════════════════════════════════════════════
// C — AUSWAHL: nur eigene, lebende Figuren; vor dem Commit aenderbar
// ══════════════════════════════════════════════════════════════════════════════════
{
  T.resetMatchState(); T.setScore(0, 0); T.resetCoverCalls(); T.startRound();
  ok(T.sel()[0] === -1 && T.sel()[1] === -1, 'Rundenbeginn startet ohne Vorauswahl');

  ok(T.select(0, 0) === true, 'Blau kann B1 waehlen');
  ok(T.sel()[0] === 0, 'Auswahl von Blau steht auf B1');
  ok(T.select(0, 1) === true, 'Blau kann die Auswahl vor dem Commit auf B2 aendern');
  ok(T.sel()[0] === 1, 'Auswahl von Blau steht jetzt auf B2');
  ok(T.select(0, 2) === false && T.sel()[0] === 1, 'Blau kann R1 NICHT waehlen');
  ok(T.select(0, 3) === false && T.sel()[0] === 1, 'Blau kann R2 NICHT waehlen');
  ok(T.select(0, 4) === false && T.sel()[0] === 1, 'Blau kann den neutralen Ball NICHT waehlen');
  ok(T.select(1, 0) === false, 'Rot kann keine blaue Figur waehlen');
  ok(T.select(1, 1) === false, 'Rot kann auch B2 nicht waehlen');
  ok(T.select(1, 2) === true && T.sel()[1] === 2, 'Rot kann R1 waehlen');
  ok(T.select(1, 3) === true && T.sel()[1] === 3, 'Rot kann auf R2 wechseln');
  ok(T.select(1, 4) === false, 'Rot kann den neutralen Ball NICHT waehlen');
  ok(T.select(0, 99) === false, 'ungueltiger Index wird abgewiesen');

  const P = T.snapshot();
  const pickAtBall = T.pick(0, { x: T.cx, y: T.cy });
  ok(pickAtBall < 0 || P[pickAtBall].owner !== T.neutral,
     'Pointer auf dem neutralen Ball greift fuer Blau keine Kugel');
  const pickAtRed = T.pick(0, { x: P[2].x, y: P[2].y });
  ok(pickAtRed < 0 || P[pickAtRed].owner === 0, 'Pointer auf einer roten Figur greift fuer Blau nie Rot');
  ok(T.pick(0, { x: P[0].x, y: P[0].y }) === 0, 'Pointer auf B1 greift genau B1');
  ok(T.pick(0, { x: P[1].x, y: P[1].y }) === 1, 'Pointer auf B2 greift genau B2');
  ok(T.pick(1, { x: P[2].x, y: P[2].y }) === 2, 'Pointer auf R1 greift genau R1');
  ok(T.pick(1, { x: P[3].x, y: P[3].y }) === 3, 'Pointer auf R2 greift genau R2');

  // Ein Commit auf eine FREMDE Figur wird von sanitizeMove auf eine eigene zurueckgeholt —
  // Blau kann eine rote Figur auch ueber einen manipulierten Index nicht starten.
  T.startRound();
  T.commit(0, 2, 60, 0);
  ok(T.commitIdx()[0] === 0 || T.commitIdx()[0] === 1,
     'ein Commit auf eine gegnerische Figur wird auf eine eigene Figur zurueckgesetzt');
}

// ══════════════════════════════════════════════════════════════════════════════════
// D — SIMULTANES COMMIT/REVEAL: beide committen, dann startet die Physik gemeinsam
// ══════════════════════════════════════════════════════════════════════════════════
{
  T.resetMatchState(); T.setScore(0, 0); T.resetCoverCalls(); T.startRound();
  ok(T.curAimer() === 0, 'Blau zielt zuerst (verdeckt)');
  ok(JSON.stringify(T.coverCalls()) === JSON.stringify([0]),
     'Rundenbeginn oeffnet den Verdeck-Screen fuer Blau');
  ok(T.canCommit(0) === true, 'Blau darf committen');

  // ── Commit Blau: speichert Figur + Zug, startet KEINE Physik ──
  const beforeBlue = T.snapshot();
  T.select(0, 0);
  T.commit(0, 0, 60, 18);
  ok(T.aimSet()[0] === true && T.aimSet()[1] === false, 'nur Blau hat committet');
  ok(T.commitIdx()[0] === 0, 'Blau-Commit speichert exakt eine Figur (B1)');
  ok(T.commitIdx()[1] === -1, 'Rot hat noch keinen gespeicherten Zug');
  ok(near(T.commitAim()[0].dx, 60) && near(T.commitAim()[0].dy, 18),
     'Blau-Commit speichert Richtung und Staerke');
  ok(T.phase() === 'aim', 'nach dem Blau-Commit laeuft KEIN Reveal — die Runde ist offen');
  const afterBlue = T.snapshot();
  ok(afterBlue.every((b, i) => near(b.x, beforeBlue[i].x) && near(b.y, beforeBlue[i].y) && speed(b) === 0),
     'der Blau-Commit startet keine Physik (kein Koerper bewegt sich)');
  ok(T.curAimer() === 1, 'danach zielt Rot');
  ok(JSON.stringify(T.coverCalls()) === JSON.stringify([0, 1]),
     'zwischen den Teams geht der Verdeck-Screen fuer Rot auf');
  ok(T.canCommit(0) === false, 'Blau kann seinen Zug nach dem Commit nicht mehr aendern');
  ok(T.canCommit(1) === true, 'Rot darf jetzt committen');

  // ── Commit Rot: erst danach Reveal ──
  T.select(1, 3);
  T.commit(1, 3, -66, -22);
  ok(T.aimSet()[0] === true && T.aimSet()[1] === true, 'beide Teams haben committet');
  ok(JSON.stringify(T.commitIdx()) === JSON.stringify([0, 3]),
     'beide Moves liegen vor: B1 fuer Blau, R2 fuer Rot');
  ok(near(T.commitAim()[1].dx, -66) && near(T.commitAim()[1].dy, -22),
     'Rot-Commit speichert Richtung und Staerke');
  ok(T.phase() === 'reveal', 'erst nach dem zweiten Commit beginnt das Reveal');
  const beforeLaunch = T.snapshot();
  ok(beforeLaunch.every(b => speed(b) === 0),
     'auch der Rot-Commit startet keine separate Vorphysik');

  // ── Gemeinsamer Launch: genau zwei Startimpulse, im selben Simulationsstart ──
  T.launch();
  const afterLaunch = T.snapshot();
  ok(T.phase() === 'sim', 'nach dem Launch laeuft die gemeinsame Physik');
  const started = afterLaunch.map((b, i) => (speed(b) > 0 ? i : -1)).filter(i => i >= 0);
  ok(JSON.stringify(started) === JSON.stringify([0, 3]),
     'exakt die zwei gewaehlten Figuren starten (erhalten: [' + started.join(',') + '])');
  ok(afterLaunch.filter(b => b.owner === 0 && speed(b) > 0).length === 1, 'genau EINE blaue Figur startet');
  ok(afterLaunch.filter(b => b.owner === 1 && speed(b) > 0).length === 1, 'genau EINE rote Figur startet');
  ok(speed(afterLaunch[1]) === 0, 'die nicht gewaehlte blaue Figur B2 erhaelt keinen Startimpuls');
  ok(speed(afterLaunch[2]) === 0, 'die nicht gewaehlte rote Figur R1 erhaelt keinen Startimpuls');
  ok(speed(afterLaunch[4]) === 0, 'der neutrale Ball erhaelt keinen Startimpuls');
  ok(afterLaunch.every((b, i) => near(b.x, beforeLaunch[i].x) && near(b.y, beforeLaunch[i].y)),
     'der Launch verschiebt noch nichts — er setzt nur Geschwindigkeiten');

  // Beide bewegen sich im ERSTEN gemeinsamen Physikschritt.
  T.step();
  const afterStep = T.snapshot();
  ok(!near(afterStep[0].x, afterLaunch[0].x) || !near(afterStep[0].y, afterLaunch[0].y),
     'die blaue Figur bewegt sich im ersten Schritt');
  ok(!near(afterStep[3].x, afterLaunch[3].x) || !near(afterStep[3].y, afterLaunch[3].y),
     'die rote Figur bewegt sich im SELBEN ersten Schritt');

  // ── Settlement: neue verdeckte Runde, Positionen bleiben erhalten ──
  T.resetCoverCalls();
  const frames = T.settle();
  ok(frames > 1, 'das Settlement brauchte mehrere Frames (' + frames + ')');
  ok(T.phase() === 'aim', 'nach dem Auslaufen beginnt die naechste Planungsphase');
  ok(T.curAimer() === 0, 'die naechste Runde beginnt wieder verdeckt bei Blau');
  ok(JSON.stringify(T.coverCalls()) === JSON.stringify([0]),
     'das Settlement oeffnet den Verdeck-Screen fuer Blau — kein einseitiger Folgezug');
  ok(JSON.stringify(T.aimSet()) === JSON.stringify([false, false]), 'beide Commit-States sind geleert');
  ok(JSON.stringify(T.commitIdx()) === JSON.stringify([-1, -1]), 'beide gespeicherten Zuege sind weg');
  ok(T.sel()[0] === -1 && T.sel()[1] === -1, 'beide Auswahlen sind zurueckgesetzt');

  // KEIN Respawn nach einem normalen Settlement.
  const settled = T.snapshot();
  const spawnRef = buildEnv(); spawnRef.setVariant('tactical');
  const ref = spawnRef.place();
  const moved = settled.some((b, i) => !near(b.x, ref[i].x, 1e-6) || !near(b.y, ref[i].y, 1e-6));
  ok(moved, 'nach einem normalen Settlement bleiben die Positionen erhalten (kein Respawn)');
}

// ══════════════════════════════════════════════════════════════════════════════════
// E — HIDDEN INFORMATION: kein Leak der gegnerischen Auswahl
// ══════════════════════════════════════════════════════════════════════════════════
{
  const H = buildEnv(); H.setVariant('tactical');
  const rc = H.ringConst();
  H.resetMatchState(); H.setScore(0, 0); H.startRound();

  // Blau zielt: nur blaue Figuren tragen einen Ring.
  H.select(0, 1);
  ok(H.ringLevel(1) === rc.selected, 'die gewaehlte eigene Figur traegt den deutlichen Ring');
  ok(H.ringLevel(0) === rc.selectable, 'die zweite eigene Figur bleibt dezent markiert');
  ok(rc.selected > rc.selectable, 'gewaehlt ist klar staerker als waehlbar');
  ok(H.ringLevel(2) === 0 && H.ringLevel(3) === 0,
     'waehrend Blau zielt, ist an den roten Figuren nichts markiert');
  ok(H.ringLevel(4) === 0, 'der neutrale Ball traegt nie einen Ring');

  // Blau committet -> Rot uebernimmt. Blaus Wahl darf jetzt NICHT mehr sichtbar sein.
  H.commit(0, 1, 50, 0);
  ok(H.curAimer() === 1, 'Rot ist an der verdeckten Reihe');
  ok(H.ringLevel(0) === 0 && H.ringLevel(1) === 0,
     'Rot sieht die Auswahl von Blau nicht (kein Ring an blauen Figuren)');
  ok(H.ringLevel(2) === rc.selectable && H.ringLevel(3) === rc.selectable,
     'Rot sieht seine beiden eigenen Figuren als waehlbar');
  H.select(1, 2);
  ok(H.ringLevel(2) === rc.selected, 'Rots eigene Wahl wird ihm angezeigt');
  ok(H.ringLevel(0) === 0 && H.ringLevel(1) === 0, 'auch nach Rots Wahl kein Leak zu Blau');

  // Reveal: erst hier duerfen BEIDE gestarteten Figuren markiert sein.
  H.commit(1, 2, -50, 0);
  ok(H.phase() === 'reveal', 'nach beiden Commits folgt das Reveal');
  ok(H.ringLevel(1) === rc.selected && H.ringLevel(2) === rc.selected,
     'im Reveal sind genau die beiden gestarteten Figuren markiert');
  ok(H.ringLevel(0) === 0 && H.ringLevel(3) === 0 && H.ringLevel(4) === 0,
     'im Reveal traegt keine der nicht gestarteten Kugeln einen Ring');
  H.launch();
  ok([0, 1, 2, 3, 4].every(i => H.ringLevel(i) === 0), 'waehrend der Physik gibt es keinen Ring');
}

// ══════════════════════════════════════════════════════════════════════════════════
// F — SIMULTAN-SZENARIEN: alle fuenf Koerper bleiben kollidierbar
// ══════════════════════════════════════════════════════════════════════════════════
{
  const C = buildEnv(); C.setVariant('tactical');
  const R2 = 2 * C.BR + 1;   // knapp ausserhalb Kontakt

  // 1 — Angriff + Parade: beide gestarteten Figuren treffen im selben Zug aufeinander.
  C.setBalls([{ x: C.cx - 260, y: C.cy, owner: 0 }, { x: C.cx - 420, y: C.cy + 200, owner: 0 },
              { x: C.cx + 260, y: C.cy, owner: 1 }, { x: C.cx + 420, y: C.cy + 200, owner: 1 },
              { x: C.cx, y: C.cy + 320, owner: C.neutral }]);
  C.setPhase('sim'); C.setVel(0, 5, 0); C.setVel(2, -5, 0);
  let crossed = false;
  for (let i = 0; i < 300; i++) { C.step(); const s = C.snapshot(); if (s[0].vx < 0 && s[2].vx > 0) { crossed = true; break; } }
  ok(crossed, 'Angriff und Parade treffen sich im selben Zug (Kreuzkollision Blau/Rot)');

  // 2 — die nicht gewaehlten Figuren werden durch Kollision bewegt.
  C.setBalls([{ x: C.cx - 200, y: C.cy, owner: 0 }, { x: C.cx - 200 + R2, y: C.cy, owner: 0 },
              { x: C.cx + 300, y: C.cy - 200, owner: 1 }, { x: C.cx + 300, y: C.cy + 200, owner: 1 },
              { x: C.cx, y: C.cy + 300, owner: C.neutral }]);
  C.setPhase('sim'); C.setVel(0, 4, 0);
  for (let i = 0; i < 8; i++) C.step();
  ok(speed(C.snapshot()[1]) > 0, 'eine nicht gestartete eigene Figur wird angestossen (kein Team-Ghosting)');

  // 3 — gegnerische Figuren kollidieren.
  C.setBalls([{ x: C.cx - 200, y: C.cy, owner: 0 }, { x: C.cx - 200 + R2, y: C.cy, owner: 1 },
              { x: C.cx + 300, y: C.cy - 200, owner: 0 }, { x: C.cx + 300, y: C.cy + 200, owner: 1 },
              { x: C.cx, y: C.cy + 300, owner: C.neutral }]);
  C.setPhase('sim'); C.setVel(0, 4, 0);
  for (let i = 0; i < 8; i++) C.step();
  ok(speed(C.snapshot()[1]) > 0, 'gegnerische Figuren kollidieren');

  // 4 — Pass B1 -> Ball -> B2.
  const gap = C.BR + 25 + 1;
  C.setBalls([{ x: C.cx - 300, y: C.cy, owner: 0 }, { x: C.cx + 200, y: C.cy, owner: 0 },
              { x: C.cx + 300, y: C.cy - 250, owner: 1 }, { x: C.cx + 300, y: C.cy + 250, owner: 1 },
              { x: C.cx - 300 + gap, y: C.cy, owner: C.neutral }]);
  C.setPhase('sim'); C.setVel(0, 6, 0);
  let ballTouched = false, b2Touched = false;
  for (let i = 0; i < 400; i++) {
    C.step(); const s = C.snapshot();
    if (speed(s[4]) > 0) ballTouched = true;
    if (speed(s[1]) > 0) { b2Touched = true; break; }
  }
  ok(ballTouched, 'eine Figur kann den neutralen Ball spielen');
  ok(b2Touched, 'Pass B1 -> Ball -> B2 kommt an');

  // 5 — beide Teams greifen im selben Zug nach dem Ball: der Ball wird von beiden erreicht.
  C.setBalls([{ x: C.cx - 200, y: C.cy, owner: 0 }, { x: C.cx - 420, y: C.cy + 220, owner: 0 },
              { x: C.cx + 200, y: C.cy, owner: 1 }, { x: C.cx + 420, y: C.cy + 220, owner: 1 },
              { x: C.cx, y: C.cy, owner: C.neutral }]);
  C.setPhase('sim'); C.setVel(0, 5, 0); C.setVel(2, -5, 0);
  let ballMoved = false;
  for (let i = 0; i < 300; i++) { C.step(); if (speed(C.snapshot()[4]) > 0) { ballMoved = true; break; } }
  ok(ballMoved, 'beide Teams koennen im selben Zug um den Ball kaempfen');

  // 6 — tiefe Figur blockt den Ball (Verteidigung).
  const hl = C.arena().halfLen;
  C.setBalls([{ x: C.cx - 300, y: C.cy - 300, owner: 0 }, { x: C.cx - hl + 160, y: C.cy, owner: 0 },
              { x: C.cx + 300, y: C.cy - 250, owner: 1 }, { x: C.cx + 300, y: C.cy + 250, owner: 1 },
              { x: C.cx - hl + 400, y: C.cy, owner: C.neutral }]);
  C.setPhase('sim'); C.setVel(4, -7, 0);
  let blocked = false;
  for (let i = 0; i < 600; i++) { C.step(); if (C.snapshot()[4].vx >= 0) { blocked = true; break; } }
  ok(blocked, 'eine tief stehende eigene Figur blockt den Ball');
}

// ══════════════════════════════════════════════════════════════════════════════════
// G — TOR, SCORE, RESET, FIRST TO 3
// ══════════════════════════════════════════════════════════════════════════════════
{
  const G = buildEnv(); G.setVariant('tactical');
  const hl = G.arena().halfLen;

  // Goal Detection wertet AUSSCHLIESSLICH den neutralen Ball.
  G.place(); G.setScore(0, 0); G.resetMatchState();
  G.setPos(0, G.cx + hl + 400, G.cy);
  ok(G.goalSide(0) === -1, 'eine Spielerfigur hinter der Torlinie ist KEIN Tor');
  ok(G.score()[0] === 0 && G.score()[1] === 0, 'Score bleibt durch Spielerfiguren unberuehrt');

  // Tor waehrend der gemeinsamen Bewegung -> Punkt fuer Blau, genau einmal gewertet.
  G.place(); G.setScore(0, 0); G.resetMatchState(); G.setPhase('sim');
  G.setPos(4, G.cx + hl - 60, G.cy); G.setVel(4, 9, 0); G.setVel(0, 3, 0); G.setVel(2, -3, 0);
  for (let i = 0; i < 400 && G.goalState() === 'play'; i++) G.step();
  ok(G.score()[0] === 1 && G.score()[1] === 0, 'Ball durch das rote Tor -> Punkt fuer Blau');
  ok(G.goalSounds() === 1, 'genau ein Torsound je Tor');
  for (let i = 0; i < 60; i++) G.step();
  ok(G.score()[0] === 1, 'keine zweite Wertung desselben Tores');

  // Ball durch das blaue Tor -> Punkt fuer Rot.
  G.place(); G.setScore(0, 0); G.resetMatchState(); G.setPhase('sim');
  G.setPos(4, G.cx - hl + 60, G.cy); G.setVel(4, -9, 0);
  for (let i = 0; i < 400 && G.goalState() === 'play'; i++) G.step();
  ok(G.score()[0] === 0 && G.score()[1] === 1, 'Ball durch das blaue Tor -> Punkt fuer Rot');

  // Vollstaendiger Torablauf -> Rundenreset -> neue SIMULTANE Runde, immer beginnend bei Blau.
  G.resetCoverCalls();
  for (let i = 0; i < 400 && G.phase() !== 'aim'; i++) G.step();
  const spawnRef = buildEnv(); spawnRef.setVariant('tactical');
  const ref = spawnRef.place();
  const after = G.snapshot();
  ok(after.length === 5, 'nach dem Tor stehen wieder 5 Koerper im Feld');
  ok(after.every((b, i) => near(b.x, ref[i].x) && near(b.y, ref[i].y)),
     'alle 4 Spielerfiguren und der Ball stehen wieder auf Startposition');
  ok(after.every(b => speed(b) === 0), 'nach dem Reset ruhen alle Koerper');
  ok(JSON.stringify(G.aimSet()) === JSON.stringify([false, false]), 'beide Commit-States sind leer');
  ok(JSON.stringify(G.commitIdx()) === JSON.stringify([-1, -1]), 'keine gespeicherten Zuege mehr');
  ok(G.sel()[0] === -1 && G.sel()[1] === -1, 'beide Auswahlen sind sauber');
  ok(G.curAimer() === 0, 'nach dem Tor beginnt die neue verdeckte Runde bei Blau');
  ok(G.coverCalls().includes(0), 'der Verdeck-Screen geht wieder fuer Blau auf');
  // Keine Anstossregel mehr: auch nach einem Gegentor beginnt Blau.
  ok(!/kassiert/.test(tacticalBlockSrc), 'keine Anstossregel "kassierendes Team beginnt" mehr im Code');

  // First to 3.
  const W = buildEnv(); W.setVariant('tactical');
  ok(W.winScore === 3, 'Matchziel bleibt First to 3');
  W.place(); W.resetMatchState(); W.setScore(2, 0); W.setPhase('sim');
  W.setPos(4, W.cx + hl - 60, W.cy); W.setVel(4, 9, 0);
  for (let i = 0; i < 400 && W.goalState() === 'play'; i++) W.step();
  ok(W.score()[0] === 3, 'drittes Tor gezaehlt');
  ok(W.winner() === 0, 'Blau ist Matchsieger');
  for (let i = 0; i < 400 && W.overCalls().length === 0; i++) W.step();
  ok(JSON.stringify(W.overCalls()) === JSON.stringify([0]), 'Matchende genau einmal fuer Blau');

  const N = buildEnv(); N.setVariant('tactical');
  N.place(); N.resetMatchState(); N.setScore(1, 0); N.setPhase('sim');
  N.setPos(4, N.cx + hl - 60, N.cy); N.setVel(4, 9, 0);
  for (let i = 0; i < 400 && N.goalState() === 'play'; i++) N.step();
  ok(N.score()[0] === 2 && N.winner() === null, 'bei 2:0 laeuft das Match weiter');
}

// ══════════════════════════════════════════════════════════════════════════════════
// H — ROBUSTHEIT: Determinismus ueber echte Runden, endliche Werte, kein Arena-Escape
// ══════════════════════════════════════════════════════════════════════════════════
{
  // Deterministisches Rundenskript. Beide Teams committen jede Runde; die Zuege sind so
  // gewaehlt, dass es regelmaessig zu nahezu gleichzeitigen Kontakten kommt.
  const SCRIPT = [
    [0, 70, 18, 3, -66, -22],
    [1, 58, -30, 2, -74, 12],
    [0, 44, 40, 2, -52, -38],
    [1, 66, 10, 3, -60, 26],
    [0, 62, -14, 2, -62, 14],
    [1, 50, 34, 3, -50, -34],
  ];
  function playScript() {
    const P = buildEnv(); P.setVariant('tactical');
    P.resetMatchState(); P.setScore(0, 0); P.startRound();
    let allFinite = true, maxOut = -Infinity, rounds = 0, bothStarted = 0;
    for (const [bi, bfx, bfy, ri, rfx, rfy] of SCRIPT) {
      if (P.phase() !== 'aim') break;
      P.select(0, bi); P.commit(0, bi, bfx, bfy);
      P.select(1, ri); P.commit(1, ri, rfx, rfy);
      // Ein Settlement laesst Restgeschwindigkeiten unterhalb der Stopschwelle stehen (wie in
      // Classic). Gemessen wird deshalb, welche Koerper durch den Launch eine NEUE
      // Geschwindigkeit bekommen — nicht, welche ueberhaupt eine haben.
      const pre = P.snapshot();
      P.launch();
      const post = P.snapshot();
      const started = post.map((b, i) => (!near(b.vx, pre[i].vx) || !near(b.vy, pre[i].vy) ? i : -1))
                          .filter(i => i >= 0);
      if (started.length === 2 && post[started[0]].owner === 0 && post[started[1]].owner === 1) bothStarted++;
      P.settle();
      rounds++;
      if (!P.finite()) allFinite = false;
      const s = P.snapshot();
      for (let i = 0; i < s.length; i++) {
        if (s[i].owner === P.neutral) continue;
        maxOut = Math.max(maxOut, P.boundSD(i));
      }
    }
    return { hash: P.hash(), finite: allFinite, maxOut, escapes: P.escapes(),
             score: P.score(), rounds, bothStarted };
  }
  const r1 = playScript(), r2 = playScript();
  ok(r1.rounds === SCRIPT.length, 'alle ' + SCRIPT.length + ' simultanen Runden liefen durch (erhalten: ' + r1.rounds + ')');
  ok(r1.bothStarted === r1.rounds, 'in JEDER Runde starteten genau eine blaue und eine rote Figur');
  ok(r1.hash === r2.hash, 'zwei identische Rundenskripte liefern denselben Zustand (Determinismus)');
  ok(r1.finite, 'kein NaN/Infinity in Position oder Geschwindigkeit');
  ok(r1.maxOut <= 0.5, 'keine Spielerfigur verlaesst die Arena (max. Ueberstand '
     + r1.maxOut.toFixed(3) + ' px)');
  ok(r1.escapes === 0, 'kein Wedge-Escape im normalen Spielverlauf');
  ok(JSON.stringify(r1.score) === JSON.stringify(r2.score), 'gleicher Score bei gleichem Skript');

  // Mehrere Matches hintereinander: der Matchzustand startet jedes Mal sauber.
  const M = buildEnv(); M.setVariant('tactical');
  for (let m = 0; m < 3; m++) {
    M.setScore(1, 2);
    M.resetMatchState();
    ok(M.winner() === null, 'Match ' + (m + 1) + ': kein Sieger aus dem Vormatch');
    ok(M.sel()[0] === -1 && M.sel()[1] === -1, 'Match ' + (m + 1) + ': keine Auswahl aus dem Vormatch');
  }
}

console.log('\nFootball-Tactical: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
