// Arena-Football — Regressionssuite fuer den FINALEN Produktivstand:
//   Classic-Arena SHOULDERED WIDE (998.4 x 742.4, Eckradius 83.2) - dieselbe
//   Objektinstanz wie das Elimination-Finale (FOOTBALL_ARENA_CLASSIC)
//   buendige Torintegration (postFront == halfLen, lichte Torbreite 227.84)
//   Movement M1 (getrennte Spieler-/Ball-Daempfung)
//   neutraler Ballradius 25 (Spieler bleiben BR = 32)
// Extrahiert die ECHTEN Quellen aus index.html (gleiche Architektur wie die
// Football-Harnesses): der zusammenhaengende Football-Block plus stepSim laufen
// unveraendert in einer Sandbox — nichts wird nachgebaut.
//
//   node tools/test_football_arena.js
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(re, name) {
  const m = SRC.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
}

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL: ' + msg); } };

const footballBlock = grab(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nfunction stepSim\(\)\{)/, 'Football-Block');
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const consts = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const spin = grab(/const SPIN_K=[^\n]*/, 'spin constants');
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

function buildEnv(mode0) {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${consts}
    ${spin}
    ${pcols}
    const TUNE=null;
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', outBall=-1, roundWinner=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false;
    let mode=${JSON.stringify(mode0)}, fmt='single';
    let score=[0,0], roundNo=1, r3dActive=false;
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},
               footballGoal(){},footballGoalPreload(){},footballGoalStop(){},
               fbTransitionBed(){},fbTransitionLock(){},fbTransitionStop(){}};
    function spawn(){} function popBall(){} function winnerRGB(){return '';}
    function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;} function updateHud(){} function setPhaseText(){}
    function onlineArmTurn(){} function openCover(){} function cancelAimDrag(){}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    function gameOver(){phase='over';}
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
    return {
      arena(){ return fbArena(); },          // Classic == FOOTBALL_ARENA_CLASSIC
      arenaShared(){ return fbArena()===FOOTBALL_ARENA_ELIM2; },
      arenaTactical(){ return FOOTBALL_ARENA; },
      hx(){ return fbHalfLen(); }, hz(){ return fbHalfWid(); }, rc(){ return fbCorner(); },
      shapeSD(dx,dz,hx,hz,rc){ const s=footballShapeSD(dx,dz,hx,hz,rc); return {sd:s.sd,nx:s.nx,nz:s.nz}; },
      phys(){ return FOOTBALL_PHYS; },
      ballR(){ return fbBallR(); },
      rad(owner){ return ballRad({owner}); },
      neutral(){ return FOOTBALL_NEUTRAL_OWNER; },
      clearHalf(){ return footballGoalClearHalf(); },
      centerHalf(){ return footballGoalCenterHalf(); },
      canPass(b){ return footballCanPassGoal(b); },
      goalSide(b){ return footballGoalSide(b); },
      eff(){ return {fr:curFR(),fe:curFE(),st:curST(),frB:curFRBall(),feB:curFEBall(),sv:curSLOWV(),
                     rb:curRestBall(),rband:curRestBand(),rpost:curRestPost()}; },
      globals(){ return {FRICTION,FEND,SLOWV,STOPV,REST,BR}; },
      launchV(){ return maxPull()*LAUNCH; },
      reset(){ balls=[]; phase='sim'; fbGoalState='play'; fbGoalTick=0; footballWinner=null; score=[0,0]; },
      setBalls(list){ balls=list.map(b=>({x:b.x,y:b.y,vx:b.vx||0,vy:b.vy||0,sx:b.x,sy:b.y,
                       owner:b.owner,alive:true,spin:b.spin||0})); phase='sim'; },
      step(){ stepSim(); },
      goalState(){ return fbGoalState; },
      score(){ return score.slice(); },
      escapes(){ let n=0; for(const b of balls) n+=(b.fbEscapes||0); return n; },
      sd(i){ return footballBoundSD(balls[i]).sd; },
      place(){ placeBalls(); return balls.map(b=>({x:b.x,y:b.y,owner:b.owner})); },
      get(){ return balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,owner:b.owner,
                                  alive:b.alive,spin:b.spin,passed:!!b.fbPassed})); }
    };
  `;
  return new Function(env)();
}

const F = buildEnv('football');
const BR = 32, A = F.arena();

// ── ARENA: produktive Konfiguration ────────────────────────────────────────────
ok(A.halfLen === 15.60 && F.hx() === 499.2, 'Innenlaenge 998.4 (halfLen 15.60 BR = 499.2)');
ok(A.halfWid === 11.60 && Math.abs(F.hz() - 371.2) < 1e-9, 'Innenbreite 742.4 (halfWid 11.60 BR = 371.2)');
ok(A.corner === 2.60 && Math.abs(F.rc() - 83.2) < 1e-9, 'Eckradius 83.2 (2.60 BR)');
// KANONISCHE ZWEI-FIGUREN-ARENA: Classic und das Elimination-Finale benutzen DIESELBE
// Objektinstanz - es gibt keine zweite Beschreibung derselben Form.
ok(F.arenaShared(), 'Classic teilt sich die Arenainstanz mit dem Elimination-Finale');
ok(Array.isArray(A.poly) && A.poly.length === 8, 'Shouldered Wide: achteckiges Kernpolygon (2 Banden, 2 Torwaende, 4 Schultern)');
ok(F.arenaTactical().halfLen === 18.00 && F.arenaTactical().corner === 6.85,
   'Tactical behaelt unveraendert die alte Rounded-Rectangle-Arena');
// Classic und Tactical stehen auf VERSCHIEDENEN Arenaformen. Der 3D-Renderer baut Form und
// Tore nur neu, wenn sich sein Layout-Schluessel aendert - der Schluessel muss die Variante
// deshalb unterscheiden. Taete er das nicht, bliebe nach Tactical -> Menue -> Classic die
// alte Arena stehen, waehrend die Physik bereits die neue Grenze benutzt.
ok(/const fbPhaseWant=footballView\?\(fbElim4\(\)\?'elim'\+fbElimPhaseN:\(fbTactical\(\)\?'tac':'classic'\)\):'';/.test(SRC),
   'der 3D-Layout-Schluessel unterscheidet Elimination-Phase, Tactical und Classic');
// Dieselbe Frage stellt sich fuer die KAMERA: sie rahmt aus fbArena(), wird aber nur bei
// Groessenaenderung oder Wechsel der Ansichtsrotation neu berechnet. Ohne eigene Kennung
// bliebe sie nach einem Variantenwechsel auf dem Rahmen der vorherigen Arena stehen.
ok(/function fbFrameKey\(\)\{/.test(SRC) && /va!==curVA\|\|fbk!==curFBK/.test(SRC),
   'die Kamera rahmt neu, sobald sich die Arenaform aendert (fbFrameKey)');
ok(A.corner < A.halfWid && A.corner < A.halfLen, 'Eckradius kleiner als beide Halbmasse');
ok(A.halfWid - A.corner > A.postOuter, 'gerade Stirnseite reicht ueber die Sockelaussenkante hinaus');
ok(A.spawn === 10.15, 'Spawnabstand 10.15 BR (324.8)');
// Keine Kreisannahme mehr im produktiven Grenzpfad:
ok(!/flim=R-BR/.test(stepSimSrc), 'stepSim enthaelt keine radiale Kreisgrenze (flim=R-BR) mehr');
ok(/footballBoundSD\(fb\)/.test(stepSimSrc), 'stepSim nutzt die Rounded-Rectangle-Grenze (footballBoundSD)');
ok(!/FOOTBALL_ARENA_VARIANTS|footballArenaKey/.test(SRC), 'keine Arena-Variantenauswahl mehr im Produktcode');
ok(!/FOOTBALL_BALL_PRESETS|footballBallKey/.test(SRC), 'keine Ballgroessen-Presets mehr im Produktcode');
ok(!/FOOTBALL_MOVE_PRESETS|footballMoveKey/.test(SRC), 'keine Movement-Presets mehr im Produktcode');

// ── ARENA: Geometrie der Grenze (Symmetrie, C1, Kreisreproduktion) ─────────────
{
  const H = [F.hx() - 25, F.hz() - 25, F.rc() - 25];
  let sym = true;
  for (const [dx, dz] of [[500, 100], [300, 350], [520, 180], [10, 370], [431, 219]]) {
    const a = F.shapeSD(dx, dz, ...H), b = F.shapeSD(-dx, dz, ...H), c = F.shapeSD(dx, -dz, ...H);
    if (Math.abs(a.sd - b.sd) > 1e-12 || Math.abs(a.nx + b.nx) > 1e-12) sym = false;
    if (Math.abs(a.sd - c.sd) > 1e-12 || Math.abs(a.nz + c.nz) > 1e-12) sym = false;
  }
  ok(sym, 'Grenze ist in beiden Achsen exakt spiegelsymmetrisch');
  const ax = H[0] - H[2], az = H[1] - H[2];
  let c1 = true;
  for (const e of [1e-6, 1e-7]) {
    const s1 = F.shapeSD(H[0], az - e, ...H), s2 = F.shapeSD(H[0], az + e, ...H);
    const s3 = F.shapeSD(ax - e, H[1], ...H), s4 = F.shapeSD(ax + e, H[1], ...H);
    if (Math.abs(s1.nx - s2.nx) > 1e-5 || Math.abs(s1.nz - s2.nz) > 1e-5) c1 = false;
    if (Math.abs(s3.nx - s4.nx) > 1e-5 || Math.abs(s3.nz - s4.nz) > 1e-5) c1 = false;
  }
  ok(c1, 'Normale ist am Uebergang Gerade/Eckbogen stetig (C1)');
  let circle = true;
  for (const [dx, dz] of [[100, 0], [0, -300], [213, 187], [-450, 12]]) {
    const s = F.shapeSD(dx, dz, 485, 485, 485), r = Math.hypot(dx, dz);
    if (Math.abs(s.sd - (r - 485)) > 1e-9) circle = false;
  }
  ok(circle, 'corner==halfLen==halfWid reproduziert exakt den Kreis (SD-Mathematik konsistent)');
}

// ── TOR: buendige Integration, Masse, Passage ──────────────────────────────────
ok(A.postFront === A.halfLen, 'Tor buendig: Sockelvorderkante exakt auf der Bandeninnenflaeche');
ok(Math.abs(F.clearHalf() * 2 - 227.84) < 1e-9, 'lichte Torbreite 227.84');
ok(Math.abs(A.postBack * BR - 574.976) < 1e-9, 'Torlinie (Sockelhinterkante) bei 574.976');
// Keine Ballfang-Tasche: kein Punkt INNERHALB der Ballmitten-Grenze kommt dem
// Sockelrechteck naeher als der Ballradius (geprueft fuer Ball 25 und Spieler 32).
for (const r of [25, 32]) {
  const hx = F.hx() - r, hz = F.hz() - r, rc = F.rc() - r;
  const x0 = A.postFront * BR, x1 = A.postBack * BR, y0 = A.postInner * BR, y1 = A.postOuter * BR;
  let minD = 1e9;
  for (let i = 0; i <= 700; i++) for (let j = 0; j <= 500; j++) {
    const dx = -F.hx() + i * (2 * F.hx() / 700), dz = -F.hz() + j * (2 * F.hz() / 500);
    if (F.shapeSD(dx, dz, hx, hz, rc).sd > 0) continue;
    const X = Math.abs(dx), Y = Math.abs(dz);
    const qx = X < x0 ? x0 : (X > x1 ? x1 : X), qy = Y < y0 ? y0 : (Y > y1 ? y1 : Y);
    const d = Math.hypot(X - qx, Y - qy);
    if (d < minD) minD = d;
  }
  ok(minD >= r - 1e-6, 'keine Ballfang-Tasche: Mindestabstand Ballmitte(r=' + r + ')->Sockel ' + minD.toFixed(2) + ' >= ' + r);
}
// Passage-Gate: nur der neutrale Ball, nur an der Stirnseite, nur in der nutzbaren Breite.
ok(Math.abs(F.centerHalf() - 88.92) < 1e-9, 'nutzbare Zentrums-Halbbreite 88.92 (clearHalf - Ballradius 25)');
ok(F.canPass({ owner: F.neutral(), x: 500 + 499.2, y: 500 + 88 }), 'neutraler Ball innerhalb der Oeffnung darf passieren');
ok(!F.canPass({ owner: 0, x: 500 + 499.2, y: 500 }), 'Spielerkugel darf NIE passieren');
ok(!F.canPass({ owner: F.neutral(), x: 500 + 499.2, y: 500 + 90 }), 'neutraler Ball knapp ausserhalb der nutzbaren Breite passiert nicht');
ok(!F.canPass({ owner: F.neutral(), x: 500 + 10, y: 500 + 88 }), 'Oeffnung gilt nur an der Stirnseite (|x| > |y|)');
// Verhaltenstest: mittiger Schuss = Tor fuer Blau; Spieler wird an der Oeffnung geblockt.
{
  const V = F.launchV();
  F.reset(); F.setBalls([{ x: 500, y: 500, vx: V, vy: 0, owner: F.neutral() }]);
  for (let i = 0; i < 600 && F.goalState() === 'play'; i++) F.step();
  ok(F.goalState() !== 'play' && F.score()[0] === 1, 'mittiger Schuss ergibt Tor fuer Blau (+X-Tor)');
  F.reset(); F.setBalls([{ x: 500, y: 500, vx: V, vy: 0, owner: 0 }]);
  for (let i = 0; i < 600; i++) F.step();
  const pb = F.get()[0];
  ok(F.goalState() === 'play' && Math.abs(pb.x - 500) <= F.hx() - 32 + 1e-6, 'Spielerkugel bleibt an der Toroeffnung in der Arena');
}

// ── BALL: Radius 25, Spieler 32, eine Quelle ───────────────────────────────────
ok(/const FOOTBALL_BALL_RADIUS=25;/.test(SRC), 'FOOTBALL_BALL_RADIUS = 25 im Quellcode');
ok(F.ballR() === 25, 'fbBallR() liefert 25 im Football-Modus');
ok(F.rad(F.neutral()) === 25 && F.rad(0) === 32 && F.rad(1) === 32, 'ballRad: neutral 25, Spieler 32');
// Rendering und Physik teilen die Quelle: der Renderer skaliert die BR-Kugel mit ballRad(b)/BR.
ok(/const rad=ballRad\(b\),rs=rad\/BR;/.test(SRC) && /m\.scale\.setScalar\(rs\*Math\.max\(\.001,bodyLv\)\);d\.scale\.setScalar\(rs\*Math\.max\(\.001,bodyLv\)\);/.test(SRC),
   'Renderer bezieht den sichtbaren Radius aus ballRad (eine Quelle fuer Physik und Optik)');
ok(/function footballBoundSD\(b\)\{\n  const r=ballRad\(b\),av=fbArena\(\);/.test(SRC), 'Bandengrenze nutzt ballRad(b)');
ok(/const p=footballPostProbe\(b\),r=ballRad\(b\);/.test(SRC), 'Pfostenaufloesung nutzt ballRad(b)');
ok(/const rb=ballRad\(b\);/.test(footballBlock), 'Anti-Wedge-Kontakte nutzen ballRad');

// ── MOVEMENT M1 ────────────────────────────────────────────────────────────────
{
  const p = F.phys();
  ok(p.friction === 0.9958, 'Spieler-Daempfung 0.9958');
  ok(p.frictionBall === 0.9964, 'Ball-Daempfung 0.9964');
  ok(p.fend === 0.9760 && p.fendBall === 0.9790, 'Auslaufdaempfung 0.9760 / 0.9790 (Spieler / Ball)');
  ok(p.slowv === 0.70, 'Auslaufschwelle slowv 0.70');
  ok(p.stopv === 0.075, 'Settlement-Schwelle stopv 0.075');
  ok(p.restBall === 0.44 && p.restBand === 0.60 && p.restPost === 0.50, 'Restitution 0.44 / 0.60 / 0.50');
  ok(p.frictionBall !== p.friction, 'Spieler-/Ball-Daempfung sind getrennt');
  const e = F.eff();
  ok(e.fr === 0.9958 && e.frB === 0.9964 && e.fe === 0.9760 && e.feB === 0.9790 && e.sv === 0.70 && e.st === 0.075,
     'Accessoren liefern im Football-Modus exakt die freigegebenen Daempfungswerte');
  ok(e.rb === 0.44 && e.rband === 0.60 && e.rpost === 0.50, 'Restitutions-Accessoren liefern M1');
  // Ausserhalb Football: exakt die globalen Konstanten (RingOut unveraendert).
  const G = buildEnv('bot'), ge = G.eff(), gg = G.globals();
  ok(ge.fr === gg.FRICTION && ge.fe === gg.FEND && ge.sv === gg.SLOWV && ge.st === gg.STOPV, 'ausserhalb Football gelten die globalen Daempfungswerte');
  ok(ge.frB === gg.FRICTION && ge.feB === gg.FEND, 'Ball-Accessoren fallen ausserhalb Football auf die globalen Werte zurueck');
  ok(ge.rb === gg.REST && ge.rband === gg.REST && ge.rpost === gg.REST, 'Restitution ausserhalb Football unveraendert REST');
  ok(G.ballR() === gg.BR && G.rad(4) === gg.BR, 'ausserhalb Football hat jede Kugel Radius BR (FFA-Slot 4 inklusive)');
}

// ── TOR: Totzonen-Schutz (Review-Befund der Finalisierung) ─────────────────────
// Ein langsam durchgetretener Ball kann VOR der Torlinie liegenbleiben, jenseits der
// maximalen Spielerreichweite (halfLen + Ballradius = 524.2). Ohne Wertung waere das Match
// dauerhaft blockiert. footballGoalSide wertet einen RUHENDEN, unerreichbaren Kanalball
// als Tor; ein noch erreichbarer Kanalball (|dx| <= 524.2) bleibt dagegen im Spiel.
{
  const V = F.launchV();
  // Start und Geschwindigkeit so, dass der Ball hinter der Bandenlinie, aber VOR der
  // Torlinie liegenbleibt: Endlage zwischen der maximalen Spielerreichweite (524.2) und
  // der Torlinie (574.976) - genau die Lage, die ohne Wertung dauerhaft blockieren wuerde.
  F.reset(); F.setBalls([{ x: 500 + 470, y: 500, vx: 0.95, vy: 0, owner: F.neutral() }]);
  let goal = false;
  for (let i = 0; i < 2400 && !goal; i++) { F.step(); goal = F.goalState() !== 'play'; }
  ok(goal && F.score()[0] === 1, 'Totzonen-Schutz: unerreichbar ruhender Kanalball wird als Tor gewertet');
  // Gegenprobe: Ball ruht knapp HINTER der Bandenlinie, aber innerhalb der Reichweite —
  // kein Tor, der Ball bleibt spielbar.
  ok(F.goalSide({ owner: F.neutral(), fbPassed: true, x: 500 + 515, y: 500, vx: 0, vy: 0 }) === -1,
     'erreichbarer Kanalball (|dx|=515) wird NICHT gewertet');
}

// ── SPAWNS ─────────────────────────────────────────────────────────────────────
{
  const pl = F.place();
  ok(pl.length === 3 && pl[2].x === 500 && pl[2].y === 500, 'Ballspawn exakt im Mittelpunkt');
  ok(pl[0].x === 500 - 324.8 && pl[1].x === 500 + 324.8 && pl[0].y === 500 && pl[1].y === 500, 'Spielerspawns symmetrisch bei +-324.8');
  // Gemessen an der ECHTEN Grenze (footballBoundSD, achteckiges Kernpolygon + Eckradius),
  // nicht am umschliessenden Rechteck - die Schultern schneiden die Ecken ja gerade weg.
  ok(F.sd(0) < 0 && F.sd(1) < 0, 'beide Spielerspawns liegen innerhalb der echten Grenze');
  ok(Math.abs(F.sd(0) - F.sd(1)) < 1e-9, 'beide Spawns haben denselben Bandenabstand');
  ok(F.sd(2) < 0, 'der Ballspawn liegt innerhalb der echten Grenze');
  // Abstand Figur -> eigene Torlinie und Figur -> Ball: beide Seiten exakt gleich.
  ok(Math.abs((pl[0].x - 500) + (pl[1].x - 500)) < 1e-9, 'die Spawns sind exakt gegenueber');
  ok(Math.abs(Math.abs(pl[0].x - 500) - A.spawn * BR) < 1e-9,
     'Startdistanz zur Mitte == spawn*BR (' + (A.spawn * BR) + ')');
  ok(Math.abs(A.postFront * BR - Math.abs(pl[0].x - 500)) > 32 + 25,
     'zwischen Figur und Torlinie passt Ball und Figur - kein Spawn im Torkorridor');
}

// ── SAFETY: Determinismus, kein NaN, kein Ausbruch, keine Energieerzeugung ────
{
  const V = F.launchV();
  const run = () => {
    F.reset();
    F.setBalls([
      { x: 380, y: 470, vx: V * 0.9, vy: V * 0.1, owner: 0 },
      { x: 620, y: 530, vx: -V * 0.7, vy: -V * 0.2, owner: 1 },
      { x: 500, y: 500, vx: 0, vy: 0, owner: F.neutral() },
    ]);
    for (let i = 0; i < 300; i++) F.step();
    return JSON.stringify(F.get());
  };
  ok(run() === run(), 'deterministisch: identische Laeufe sind bitgleich');
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let nan = false, maxSd = -1e9, esc = 0;
  for (let t = 0; t < 300; t++) {
    F.reset();
    F.setBalls([
      { x: 380, y: 500, vx: (rnd() * 2 - 1) * V, vy: (rnd() * 2 - 1) * V, owner: 0 },
      { x: 620, y: 500, vx: (rnd() * 2 - 1) * V, vy: (rnd() * 2 - 1) * V, owner: 1 },
      { x: 500, y: 500, vx: (rnd() * 2 - 1) * V, vy: (rnd() * 2 - 1) * V, owner: F.neutral() },
    ]);
    for (let i = 0; i < 240 && F.goalState() === 'play'; i++) {
      F.step();
      const s = F.get();
      for (let j = 0; j < 3; j++) {
        if (!Number.isFinite(s[j].x) || !Number.isFinite(s[j].vx)) nan = true;
        if (!s[j].passed) maxSd = Math.max(maxSd, F.sd(j));
      }
    }
    esc += F.escapes();
  }
  ok(!nan, 'keine NaN/Infinity in 300 Zufallslaeufen');
  // Bekanntes, dokumentiertes Residuum an der Ecke Pfostenvorderkante/Bandenlinie
  // (< 1 LOGICAL, deterministisch, Folgeframe holt zurueck) -> Toleranz 1.5.
  ok(maxSd <= 1.5, 'kein Arena-Ausbruch (max sd ' + maxSd.toFixed(3) + ', Toleranz 1.5)');
  ok(esc === 0, 'keine Anti-Wedge-Escapes');
  // Bande erzeugt nie Energie (0/30/45/60 Grad gegen die Laengsseiten-Normale):
  let gained = false;
  for (const deg of [0, 30, 45, 60]) {
    const rad = deg * Math.PI / 180, lim = F.hz() - 25;
    F.reset();
    F.setBalls([{ x: 500, y: 500 + lim - 120, vx: Math.sin(rad) * V * 0.6, vy: Math.cos(rad) * V * 0.6, owner: F.neutral() }]);
    let before = null;
    for (let i = 0; i < 600; i++) {
      const pre = F.get()[0];
      if (pre.vy > 0) before = pre;
      F.step();
      const post = F.get()[0];
      if (before && post.vy < 0) {
        if (Math.hypot(post.vx, post.vy) > Math.hypot(before.vx, before.vy) + 1e-9) gained = true;
        break;
      }
    }
  }
  ok(!gained, 'Bandenkontakt erzeugt keine Energie (alle Winkel)');
  // Spieler->Ball: Impulssumme waechst nicht.
  F.reset();
  F.setBalls([{ x: 300, y: 500, vx: V * 0.6, vy: 0, owner: 0 }, { x: 500, y: 500, vx: 0, vy: 0, owner: F.neutral() }]);
  let pre = null, energyOk = false;
  for (let i = 0; i < 900; i++) {
    const s = F.get();
    if (s[1].vx === 0) pre = s;
    F.step();
    const t = F.get();
    if (t[1].vx !== 0) {
      energyOk = (Math.hypot(t[0].vx, t[0].vy) + Math.hypot(t[1].vx, t[1].vy)) <= Math.hypot(pre[0].vx, pre[0].vy) + 1e-9;
      break;
    }
  }
  ok(energyOk, 'Spieler->Ball-Kontakt erzeugt keine Energie');
  // Fixed Timestep: exakt 2 Micro-Steps pro stepSim, keine Frame-Time-Abhaengigkeit.
  ok(/for\(let s=0;s<2;s\+\+\)\{/.test(stepSimSrc), 'stepSim laeuft mit festen 2 Micro-Steps');
  // Wanduhr nur im dokumentiert REIN VISUELLEN Goal-FX-Impuls (footballGoalFxTrigger/-Level,
  // Render-Uhr fuer den Emissive-Puls) — die Simulation selbst (stepSim) bleibt tickbasiert.
  ok(!/performance\.now|Date\.now|setInterval/.test(stepSimSrc), 'keine Wanduhr/Intervalle in stepSim');
  ok(!/setInterval/.test(footballBlock), 'kein setInterval im Football-Block');
  const clockUses = (footballBlock.match(/performance\.now/g) || []).length;
  const fxBlock = footballBlock.slice(footballBlock.indexOf('fbGoalFxStart'), footballBlock.indexOf('function footballGoalFxLevel'));
  ok(clockUses > 0 ? /footballGoalFxTrigger|fbGoalFxStart/.test(fxBlock) && clockUses <= 3 : true,
     'Wanduhr im Football-Block nur im visuellen Goal-FX-Impuls');
}

console.log('Football-Arena: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
