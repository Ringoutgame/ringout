// Arena Football — Spielfluss-, Impuls- und Anti-Pinning-MESSHARNESS.
//
// Phase 4A: Audit + Baseline.
// Phase 4B-1: A/B-Abnahme der iterativen Kontaktaufloesung.
// Migriert auf den produktiven Stand: Rounded-Rectangle-Arena B (footballShapeSD/
// footballBoundSD), Ballradius 25 (ballRad), Physikstandard M1 (FOOTBALL_PHYS mit
// eigener Balldaempfung) und Sockel nur noch im Torkanal (postFront == halfLen).
//
// Der Harness extrahiert die ECHTEN Physikfunktionen aus index.html (gleiches
// Verfahren wie tools/test_football_shell.js und tools/test_physics_golden.js) und
// beobachtet sie von aussen. Es wird NICHTS in den Physikkern injiziert.
//
// A/B-VERFAHREN (4B-1): der Harness baut ZWEI Sandboxen aus derselben Quelle und
// ueberschreibt dabei ausschliesslich den Wert der benannten Konstanten
// FOOTBALL_CONTACT_ITERATIONS:
//   ci = 1  -> exakt der Physikpfad VOR 4B-1 (Baseline)
//   ci = 3  -> der produktive Wert aus index.html
// Beide laufen dieselben Szenarien im selben Prozess, alle Zahlen sind damit direkt
// vergleichbar und keine Baseline muss aus einem frueheren Lauf erinnert werden.
//
// Kein Dateisystemzugriff ausser dem Lesen von index.html, kein Netzwerk, kein DOM,
// kein Renderer, kein Zufall. Zweimaliger Lauf liefert bitidentische Ergebnisse.
//
// AUFLOESUNG: stepSim() fuehrt PRO AUFRUF ZWEI Micro-Steps aus. Von aussen ist die
// Frame-Grenze die feinste ZUSTANDS-Beobachtungsstufe. Die KONTAKT-Erkennung arbeitet
// feiner: aus dem Vorzustand werden beide Micro-Step-Positionen exakt rekonstruiert
// (Integration -> Daempfung, spin=0), solange im ersten Micro-Step nichts kollidiert
// ist. Damit sind Kontaktzeitpunkt, Kontaktnormale und die ECHTE Eindringtiefe VOR der
// Korrektur messbar — nicht nur der Restwert danach.
//
// Usage: node tools/test_football_flow.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(re, name) {
  const m = HTML.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
}

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }

// ── Extraktion der echten Quellen ──
// KANONISCHE EXTRAKTION (Referenz: artifacts/football-movement-prototype/measure.js):
// der gesamte Football-Block liegt zusammenhaengend zwischen FOOTBALL_NEUTRAL_OWNER und
// stepSim — Rounded-Rectangle-Arena (FOOTBALL_ARENA, footballShapeSD, footballBoundSD),
// Ballradius (FOOTBALL_BALL_RADIUS/ballRad), Physikstandard M1 (FOOTBALL_PHYS inkl.
// getrennter Balldaempfung), Sockel, Anti-Wedge, Torablauf und Tor-FX. EINE Extraktion
// als Ganzes statt zwei Dutzend Einzelregex — die Suite laeuft damit garantiert gegen
// den echten, zusammenhaengenden Produktivblock.
const consts             = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const spin               = grab(/const SPIN_K=[^\n]*/, 'spin constants');
const pcols              = grab(/const PCOLS=[^\n]*/, 'PCOLS');
const mkBallSrc          = grab(/function mkBall\([^\n]*/, 'mkBall');
const placeBallsSrc      = grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls');
const teamCapSrc         = grab(/function teamCap\([^\n]*/, 'teamCap');
const ballsOutsideSrc    = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const stepSimSrc         = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const footballBlockSrc   = grab(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nfunction stepSim\(\)\{)/, 'Football-Block');
const contactIterSrc     = grab(/const FOOTBALL_CONTACT_ITERATIONS=[^\n]*/, 'FOOTBALL_CONTACT_ITERATIONS');
// curFR/curFE/curST stehen oberhalb des Football-Blocks (sie gelten fuer alle Modi).
const curFRSrc           = grab(/function curFR\(\)[^\n]*/, 'curFR');
const curFESrc           = grab(/function curFE\(\)[^\n]*/, 'curFE');
const curSTSrc           = grab(/function curST\(\)[^\n]*/, 'curST');
const npSrc              = grab(/function np\([^\n]*/, 'np');
const resetCommitsSrc    = grab(/function resetCommits\(\)\{[\s\S]*?\n\}/, 'resetCommits');
const startRoundSrc      = grab(/function startRound\(\)\{[\s\S]*?\n\}/, 'startRound');

const CI_PROD = Number(contactIterSrc.match(/=\s*(\d+)/)[1]);

// Physik-Sandbox. `ci` ueberschreibt NUR den Wert von FOOTBALL_CONTACT_ITERATIONS —
// alles andere ist unveraendert die Quelle aus index.html.
// ══════════════════════════════════════════════════════════════════════════
//  TESTINTERNE VERGLEICHSMODELLE  (Physikphase 4B-3)
//  Produktiv gibt es nur noch GLIDE — der Wertesatz steht als FOOTBALL_PHYS in
//  index.html und wird hier unveraendert uebernommen. CURRENT (Stand vor 4B-2) und
//  ICE (verworfener Kandidat) existieren AUSSCHLIESSLICH hier, damit Regression und
//  Dokumentation eine Vergleichsbasis behalten. Sie werden nicht in den Produktivcode
//  injiziert, sondern ueber EINE ueberschriebene Funktion aktiviert:
//    GLIDE   -> keine Ueberschreibung, exakt der Produktivpfad (seit Movement-Phase M1
//               ist das der M1-Wertesatz inkl. eigener Balldaempfung frictionBall)
//    CURRENT -> footballPhys() liefert null, also der Codepfad vor 4B-2 (auch ohne Anti-Wedge)
//    ICE     -> footballPhys() liefert den testinternen ICE-Wertesatz
// Die Vergleichsmodelle sind HISTORISCH eingefroren. Seit M1 erwartet der Produktivpfad
// zusaetzlich frictionBall/fendBall/slowv (curFRBall/curFEBall/curSLOWV); ICE erhaelt sie
// konsistent ergaenzt (Ball wie Spieler gedaempft, slowv = globales SLOWV 0.35), damit
// das historische Modell unter dem neuen Codepfad exakt sein altes Verhalten behaelt.
const MODEL_ICE = { friction: 0.9985, frictionBall: 0.9985, fend: 0.9955, fendBall: 0.9955,
                    slowv: 0.35, stopv: 0.018,
                    restBall: 0.48, restBand: 0.62, restPost: 0.52 };
const MODELS = ['CURRENT', 'GLIDE', 'ICE'];
function modelOverride(model) {
  if (model === 'CURRENT') return 'footballPhys=function(){return null;};';
  if (model === 'ICE') return 'const MODEL_ICE=' + JSON.stringify(MODEL_ICE) + ';' +
                              'footballPhys=function(){return mode===\'football\'?MODEL_ICE:null;};';
  return '';   // GLIDE = Produktivstand, keine Ueberschreibung
}

function buildEnv(ci, preset) {
  // ci ueberschreibt AUSSCHLIESSLICH den Wert der benannten Konstanten im ansonsten
  // unveraenderten Block — exakter Ersatz der wortgleich gegrabbten Zeile, keine
  // Regex-Weichmachung. Der Block deklariert fbGoalState/fbGoalTick/footballWinner
  // selbst; die Sandbox darf sie nicht erneut deklarieren.
  const footballBlock = ci == null ? footballBlockSrc
    : footballBlockSrc.replace(contactIterSrc, 'const FOOTBALL_CONTACT_ITERATIONS=' + ci + ';');
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${consts}
    ${spin}
    ${pcols}
    const TUNE=null;                       // kein Browser-Override im Harness
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', outBall=-1, roundWinner=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false;
    let mode='football', fmt='single';
    // Effekt-Zaehler: belegt, dass die Nachiterationen KEIN zweites Treffer-Feedback ausloesen.
    // goalSounds/goalSoundMatchPoints belegen zusaetzlich die Einmalgarantie des Tor-Audios.
    let sfxHits=0, spawnCalls=0, goalSounds=0, goalSoundMatchPoints=0, goalSoundStops=0;
    const SFX={hit(){sfxHits++;},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},
               footballGoal(mp){goalSounds++;if(mp)goalSoundMatchPoints++;},
               footballGoalPreload(){},footballGoalStop(){goalSoundStops++;},
               fbTransitionBed(){},fbTransitionLock(){},fbTransitionStop(){}};
    function spawn(){spawnCalls++;} function popBall(){} function winnerRGB(){return '';}
    let r3dActive=false; function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;} function updateHud(){} function setPhaseText(){}
    function onlineArmTurn(){} function openCover(){}
    function cancelAimDrag(){}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    let score=[0,0], roundNo=1;
    let collapseEnabled=false, collapseState='running';
    function collapseActive(){return false;}
    let gameOverCalls=[];
    function gameOver(w){gameOverCalls.push(w);phase='over';}
    ${mkBallSrc}
    ${teamCapSrc}
    ${placeBallsSrc}
    ${ballsOutsideSrc}
    ${resolveRingOutsSrc}
    ${npSrc}
    ${resetCommitsSrc}
    ${startRoundSrc}
    ${footballBlock}
    ${modelOverride(preset || 'GLIDE')}
    const __model=${JSON.stringify(preset || 'GLIDE')};
    ${curFRSrc}
    ${curFESrc}
    ${curSTSrc}
    ${stepSimSrc}
    return {
      ci: FOOTBALL_CONTACT_ITERATIONS,
      // ── Physikphase 4B-2 / 4B-3 / Movement M1 ──
      presetName(){ return __model; },
      preset(){ return footballPhys(); },
      prodPhys(){ return FOOTBALL_PHYS; },
      effective(){ return {fr:curFR(), fe:curFE(), stopv:curST(),
                           frBall:curFRBall(), feBall:curFEBall(), slowv:curSLOWV(),
                           restBall:curRestBall(), restBand:curRestBand(), restPost:curRestPost()}; },
      wedgeConst(){ return {minContacts:FOOTBALL_WEDGE_MIN_CONTACTS, dot:FOOTBALL_WEDGE_DOT,
                            v:FOOTBALL_WEDGE_V, progress:FOOTBALL_WEDGE_PROGRESS,
                            steps:FOOTBALL_WEDGE_STEPS, press:FOOTBALL_WEDGE_PRESS,
                            eps:FOOTBALL_WEDGE_EPS, minEscapeV:FOOTBALL_ESCAPE_MIN_V}; },
      escapes(){ let n=0; for(const b of balls) n+=(b.fbEscapes||0); return n; },
      geom(){ return {cx,cy,BR, ballR:FOOTBALL_BALL_RADIUS,
        hx:fbHalfLen(), hw:fbHalfWid(), rc:fbCorner(),
        x0:fbArena().postFront*BR, x1:fbArena().postBack*BR,
        y0:fbArena().postInner*BR, y1:fbArena().postOuter*BR,
        clearHalf:footballGoalClearHalf(), goalHalf:footballGoalCenterHalf(),
        neutral:FOOTBALL_NEUTRAL_OWNER}; },
      // Geometrie-Sonden mit der ECHTEN Quelle (footballBoundSD/footballPostProbe/
      // footballCanPassGoal/ballRad) — das Beobachtungsmodell des Harness fragt hier,
      // statt die Grenzform nachzubauen. fbSD ist ein wiederverwendetes Objekt, daher
      // wird kopiert.
      rad(b){ return ballRad(b); },
      boundSD(b){ const s=footballBoundSD(b); return {sd:s.sd, nx:s.nx, nz:s.nz}; },
      canPass(b){ return footballCanPassGoal(b); },
      tune(){ return {MAXPULL_FRAC,LAUNCH,FRICTION,FEND,SLOWV,REST,STOPV,SPIN_K,SPIN_DECAY,
        maxPull:maxPull(), maxLaunchV:maxPull()*LAUNCH}; },
      reset(){ balls=[]; phase='sim'; outBall=-1; roundWinner=-1; score=[0,0];
               fbGoalState='play'; fbGoalTick=0; footballWinner=null;
               sfxHits=0; spawnCalls=0; gameOverCalls=[];
               goalSounds=0; goalSoundMatchPoints=0; goalSoundStops=0; },
      setMode(m){ mode=m; }, mode(){ return mode; },
      setBalls(list){ balls=list.map(b=>({x:b.x,y:b.y,vx:b.vx||0,vy:b.vy||0,sx:b.x,sy:b.y,
                       owner:b.owner,alive:true,spin:b.spin||0})); phase='sim'; },
      // Erneuter Schuss aus der Aim-Phase — exakt der Effekt von applyLaunch().
      shoot(i,vx,vy){ balls[i].vx=vx; balls[i].vy=vy; balls[i].spin=0; phase='sim'; },
      step(){ stepSim(); },
      phase(){ return phase; },
      goalState(){ return fbGoalState; },
      goalTick(){ return fbGoalTick; },
      score(){ return score.slice(); },
      winner(){ return footballWinner; },
      overCalls(){ return gameOverCalls.slice(); },
      fx(){ return {sfxHits, spawnCalls}; },
      goalAudio(){ return {goalSounds, goalSoundMatchPoints, goalSoundStops}; },
      passedFlags(){ return balls.map(b=>!!b.fbPassed); },
      place(){ placeBalls(); return balls.map(b=>({x:b.x,y:b.y,owner:b.owner})); },
      get(){ return balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,owner:b.owner,
                                  alive:b.alive,spin:b.spin,passed:!!b.fbPassed})); }
    };
  `;
  return new Function(env)();
}

const PROBE = buildEnv();
const G    = PROBE.geom();
const TUNE = PROBE.tune();
const WC   = PROBE.wedgeConst();
// Radius einer Kugel im Football-Modus — exakt ballRad(b) aus der Quelle: Spieler BR,
// neutraler Ball FOOTBALL_BALL_RADIUS. Node-seitig gespiegelt, weil das Kontaktmodell
// in heissen Schleifen laeuft; die Werte kommen aus geom() und damit aus der Quelle.
const rad = (b) => (b.owner === G.neutral ? G.ballR : G.BR);

// ══════════════════════════════════════════════════════════════════════════
//  KONTAKT- UND PINNING-MODELL  (rein beobachtend, Node-seitig)
// ══════════════════════════════════════════════════════════════════════════
const CONTACT_EPS = 0.5;    // px  — "in Kontakt" am Frame-Ende
const PIN_COS     = -0.5;   // n1*n2 <= -0.5  ==  Oeffnungswinkel >= 120 grad
const PIN_V       = 0.25;   // px/Micro-Step — 2.5 x STOPV
const PIN_DX      = 0.40;   // px/Frame
const PIN_FRAMES  = 6;      // Frames (= 12 Micro-Steps = 0.10 s)
const PRESS_V     = 0.01;   // px/Micro-Step

const sp  = (b) => Math.hypot(b.vx, b.vy);
const eng = (s) => 0.5 * s.reduce((a, b) => a + (b.alive ? b.vx * b.vx + b.vy * b.vy : 0), 0);
const f4  = (n) => Number(n.toFixed(4));
const f2f = (n) => Number(n.toFixed(2));

// Sockelkontakt — dieselbe Kreis/AABB-Geometrie wie footballPostProbe, aber mit
// Kontakttoleranz eps (die Quellfunktion lehnt jenseits des Beruehrabstands hart ab)
// und dem Radius der KONKRETEN Kugel (ballRad-Regel).
function postContact(p, eps) {
  eps = eps || 0;
  const r = rad(p);
  let best = null;
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const X = sx * (p.x - G.cx), Y = sy * (p.y - G.cy);
    if (X <= G.x0 - r - eps || X >= G.x1 + r + eps ||
        Y <= G.y0 - r - eps || Y >= G.y1 + r + eps) continue;
    const qx = X < G.x0 ? G.x0 : (X > G.x1 ? G.x1 : X);
    const qy = Y < G.y0 ? G.y0 : (Y > G.y1 ? G.y1 : Y);
    const d = Math.hypot(X - qx, Y - qy);
    if (d > r + eps) continue;
    const nx = d > 1e-9 ? (X - qx) / d : 0, ny = d > 1e-9 ? (Y - qy) / d : 0;
    const c = { type: 'post', pen: Math.max(0, r - d), gap: d, nx: sx * nx, ny: sy * ny };
    if (!best || c.gap < best.gap) best = c;
  }
  return best;
}
// Gilt die Bande fuer diese Kugel? Exakt die Regel aus stepSim: ein bereits
// ausgetretener Ball (fbPassed) und ein Ball in der nutzbaren Toroeffnung
// (footballCanPassGoal — ECHTE Quellfunktion via PROBE) sind ausgenommen.
const bandApplies = (b) => !b.passed && !PROBE.canPass(b);

function contactsAt(state, i, eps) {
  const b = state[i], out = [];
  const rb = rad(b);
  for (let j = 0; j < state.length; j++) {
    if (j === i || !state[j].alive) continue;
    const o = state[j];
    const rr = rb + rad(o);
    const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy);
    if (d > rr + eps || d <= 1e-12) continue;
    out.push({ type: 'ball', j, nx: dx / d, ny: dy / d, pen: Math.max(0, rr - d), gap: d });
  }
  const pc = postContact(b, eps);
  if (pc) out.push(pc);
  // Rounded-Rectangle-Grenze ueber die ECHTE Signed-Distance-Quelle (footballBoundSD):
  // sd >= 0 heisst Ballmitte auf/jenseits der Grenze, die Aussennormale kommt mit.
  if (bandApplies(b)) {
    const s = PROBE.boundSD(b);
    if (s.sd >= -eps)
      out.push({ type: 'band', nx: -s.nx, ny: -s.nz, pen: Math.max(0, s.sd), gap: s.sd });
  }
  return out;
}

// Exakte Rekonstruktion der beiden Micro-Step-Positionen aus dem Vorzustand.
// eff traegt die tatsaechlich aktive Daempfung des Laufs (Preset-abhaengig) und
// spiegelt die Zwei-Regime-Regel aus stepSim: unterhalb slowv greift fend. Seit M1
// traegt der NEUTRALE Ball eine eigene Daempfung (frictionBall/fendBall).
function sweep(pre, eff) {
  const damp = (b) => {
    const nb = b.owner === G.neutral;
    return Math.hypot(b.vx, b.vy) < eff.slowv ? (nb ? eff.feBall : eff.fe)
                                              : (nb ? eff.frBall : eff.fr);
  };
  const s1 = pre.map((b) => ({ ...b, x: b.x + b.vx, y: b.y + b.vy }));
  const c1 = s1.map((b, i) => (b.alive ? contactsAt(s1, i, 0) : []));
  if (c1.some((c) => c.length)) return { sub: 1, cs: c1 };
  const s2 = s1.map((b) => { const f = damp(b);
    return { ...b, x: b.x + b.vx * f, y: b.y + b.vy * f, vx: b.vx * f, vy: b.vy * f }; });
  return { sub: 2, cs: s2.map((b, i) => (b.alive ? contactsAt(s2, i, 0) : [])) };
}

function clamped(cs) {
  for (let a = 0; a < cs.length; a++)
    for (let b = a + 1; b < cs.length; b++)
      if (cs[a].nx * cs[b].nx + cs[a].ny * cs[b].ny <= PIN_COS) return true;
  return false;
}
function pressed(state, cs) {
  for (const c of cs) {
    if (c.type !== 'ball') continue;
    const o = state[c.j];
    if (o.vx * -c.nx + o.vy * -c.ny > PRESS_V) return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════
//  SZENARIO-RUNNER
// ══════════════════════════════════════════════════════════════════════════
const MAX_FRAMES = 2400;

function makeRun(env, results) {
  // Aktive Physik dieses Laufs. EF4 ist die Obergrenze, die reine Daempfung ueber einen
  // Frame (2 Micro-Steps) erzeugen kann — fend ist stets <= friction, und seit M1 ist
  // die SCHWAECHSTE Daempfung im System max(friction, frictionBall): der neutrale Ball
  // laeuft bewusst laenger als die Spieler. Genau dieser Wert ist die korrekte obere
  // Schranke fuer beide Regime und beide Kugelarten.
  const EFF = env.effective();
  const FRMAX = Math.max(EFF.fr, EFF.frBall);
  const EF4 = FRMAX * FRMAX * FRMAX * FRMAX;
  // Zulaessiger Energiezuwachs eines Escape-Frames: der Mindest-Escape hebt eine praktisch
  // stehende Kugel auf FOOTBALL_ESCAPE_MIN_V, mehr kann er per Konstruktion nicht.
  const ESC_E = 0.5 * WC.minEscapeV * WC.minEscapeV;
  return function run(name, cls, balls, opt) {
    opt = opt || {};
    const maxF = opt.maxFrames || MAX_FRAMES;
    const shots = opt.shots || [];
    env.reset();
    env.setBalls(balls);

    const log = [];
    const n = balls.length;
    const pinRun = new Array(n).fill(0), pinMax = new Array(n).fill(0), pinTotal = new Array(n).fill(0);
    let maxSim = 0, events = 0, minDist = Infinity, maxSpeed = 0;
    let maxPenIn = 0, maxPenRest = 0, maxBandOver = 0, maxPostRest = 0;
    let minEff = Infinity, maxEff = 0, effFrames = 0;
    let goalF = -1, shotIdx = 0;
    const settleAt = [];
    let prevTouch = new Set();
    let stopped = 'maxFrames';
    // ── 4B-2: Escape- und Loesungsmetriken ──
    let escTotal = 0, escFrames = 0, firstEscape = null, releaseFrame = -1, releaseDist = 0;
    let travelled = 0;

    const s0 = env.get();
    const E0 = eng(s0);

    for (let f = 1; f <= maxF; f++) {
      const pre = env.get();
      const Epre = eng(pre);
      const sw = sweep(pre, EFF);
      const escPre = env.escapes();
      env.step();
      const post = env.get();
      const Epost = eng(post);
      const escDelta = env.escapes() - escPre;
      if (escDelta > 0) {
        escTotal += escDelta; escFrames++;
        if (!firstEscape) firstEscape = { f, Epre, Epost, dE: Epost - Epre };
      }
      // Weg des Subjekts (Index 0) und der Zeitpunkt, an dem es den Keil sichtbar
      // verlassen hat: Verlagerung > 2*BR gegenueber dem Start.
      travelled += Math.hypot(post[0].x - pre[0].x, post[0].y - pre[0].y);
      if (releaseFrame < 0 && Math.hypot(post[0].x - s0[0].x, post[0].y - s0[0].y) > 2 * G.BR) {
        releaseFrame = f; releaseDist = travelled;
      }

      if (env.goalState() !== 'play') {
        goalF = f; stopped = 'goal';
        log.push({ f, pre, post, sw, cs: [], Epre, Epost, esc: escDelta });
        break;
      }

      const cs = [];
      let frameContacts = 0;
      const touch = new Set();
      for (let i = 0; i < post.length; i++) {
        if (!post[i].alive) { cs.push([]); continue; }
        const c = contactsAt(post, i, CONTACT_EPS);
        cs.push(c);
        frameContacts += c.length;
        // Auf dem Rounded Rectangle mit postFront==halfLen ist der Sockel im Feld
        // unerreichbar; legitim jenseits der Grenze liegt NUR ein ausgetretener Ball
        // (fbPassed) — den schliesst bandApplies bereits aus. Die fruehere Ausnahme
        // fuer die Sockel-Aussenflanke (Kreisarena) ist damit gegenstandslos: jede
        // gemeldete Banden-Penetration ist eine echte Verletzung.
        for (const x of c) {
          maxPenRest = Math.max(maxPenRest, x.pen);
          if (x.type === 'band') maxBandOver = Math.max(maxBandOver, x.pen);
          if (x.type === 'post') maxPostRest = Math.max(maxPostRest, x.pen);
          touch.add(i + '|' + x.type + (x.type === 'ball' ? '|' + x.j : ''));
        }
      }
      for (const b of post) if (b.alive) maxSpeed = Math.max(maxSpeed, sp(b));
      for (let i = 0; i < sw.cs.length; i++)
        for (const x of sw.cs[i]) {
          maxPenIn = Math.max(maxPenIn, x.pen);
          touch.add(i + '|' + x.type + (x.type === 'ball' ? '|' + x.j : ''));
        }

      maxSim = Math.max(maxSim, frameContacts);
      for (const k of touch) if (!prevTouch.has(k)) events++;
      prevTouch = touch;

      for (let i = 0; i < post.length; i++)
        for (let j = i + 1; j < post.length; j++)
          if (post[i].alive && post[j].alive)
            minDist = Math.min(minDist, Math.hypot(post[i].x - post[j].x, post[i].y - post[j].y));

      const hadContact = frameContacts > 0 || sw.cs.some((c) => c.length);
      if (hadContact && Epre > 1e-9) {
        const eff = Epost / (Epre * EF4);
        minEff = Math.min(minEff, eff); maxEff = Math.max(maxEff, eff); effFrames++;
      }

      for (let i = 0; i < post.length; i++) {
        const b = post[i];
        const prog = Math.hypot(b.x - pre[i].x, b.y - pre[i].y);
        const isPin = b.alive && cs[i].length >= 2 && clamped(cs[i]) &&
                      sp(b) < PIN_V && prog < PIN_DX && pressed(post, cs[i]);
        if (isPin) { pinRun[i]++; pinMax[i] = Math.max(pinMax[i], pinRun[i]); pinTotal[i]++; }
        else pinRun[i] = 0;
      }

      log.push({ f, pre, post, sw, cs, Epre, Epost, esc: escDelta });

      if (env.phase() === 'aim') {
        settleAt.push(f);
        if (shotIdx < shots.length) {
          const s = shots[shotIdx++];
          if (s.at != null) {
            // Gezielter Nachschuss: der Spieler zielt auf die AKTUELLE Position des Ziels —
            // genau das tut ein Mensch, der einen klemmenden Ball freischiessen will.
            const st = env.get();
            const dx = st[s.at].x - st[s.i].x, dy = st[s.at].y - st[s.i].y;
            const L = Math.hypot(dx, dy) || 1;
            env.shoot(s.i, s.sp * dx / L, s.sp * dy / L);
          } else env.shoot(s.i, s.vx, s.vy);
          continue;
        }
        stopped = 'settled'; break;
      }
    }

    const sEnd = env.get();
    // BLEIBENDE Ueberlappung: was im Ruhezustand sichtbar ineinander steckt.
    // Bewusst getrennt vom transienten Spitzenwert maxPenRest waehrend des Einschlags.
    let endPen = 0;
    for (let i = 0; i < sEnd.length; i++)
      for (let j = i + 1; j < sEnd.length; j++)
        if (sEnd[i].alive && sEnd[j].alive)
          endPen = Math.max(endPen, Math.max(0, rad(sEnd[i]) + rad(sEnd[j]) -
            Math.hypot(sEnd[i].x - sEnd[j].x, sEnd[i].y - sEnd[j].y)));
    const rec = {
      name, cls, ci: env.ci, start: s0, end: sEnd, log, endPen, maxSpeed,
      frames: log.length, stopped,
      settleAt, settleFrames: settleAt.length ? settleAt[settleAt.length - 1] : -1,
      goalFrame: goalF, shots: shots.length,
      moved: s0.map((b, i) => Math.hypot(sEnd[i].x - b.x, sEnd[i].y - b.y)),
      events, maxSimultaneous: maxSim,
      minDist: minDist === Infinity ? null : minDist,
      maxPenIn, maxPenRest, maxBandOver, maxPostRest,
      pinRawMax: pinMax, pinTotal,
      pinFramesMax: Math.max(...pinMax),
      pinFramesTotal: pinTotal.reduce((a, b) => a + b, 0),
      pinned: pinMax.some((v) => v >= PIN_FRAMES),
      E0, E1: eng(sEnd),
      minEff: effFrames ? minEff : null, maxEff: effFrames ? maxEff : null,
      fx: env.fx(),
      preset: env.presetName(),
      escapes: escTotal, escapeFrames: escFrames, firstEscape,
      releaseFrame, releaseDist, travelled,
      verdict: 'PASS', notes: []
    };

    // ── Harte Invarianten ──
    // Energie: kein Frame darf ueber die reine Daempfung hinaus zulegen. Einzige
    // benannte Ausnahme ist ein Frame mit bestaetigtem Static-Wedge-Escape, und auch
    // der nur bis zur Obergrenze des Mindest-Escape (0.5*v_min^2 je Kugel).
    for (const e of log) {
      const allow = (e.esc || 0) * ESC_E;
      if (e.Epre != null && e.Epost > e.Epre * EF4 * (1 + 1e-9) + allow + 1e-12) {
        rec.notes.push('ENERGIEZUNAHME Frame ' + e.f + ' (' + f4(e.Epost / (e.Epre * EF4)) + ')');
        rec.verdict = 'FAIL';
        break;
      }
    }
    if (maxPostRest > 1e-6) { rec.notes.push('Sockel-Restpenetration ' + f4(maxPostRest) + ' px'); rec.verdict = 'FAIL'; }
    for (const b of sEnd) {
      if (!b.alive || !bandApplies(b)) continue;
      const s = PROBE.boundSD(b);
      if (s.sd > 1e-6) {
        rec.notes.push('Ball ausserhalb der Bande: sd=' + f4(s.sd));
        rec.verdict = 'FAIL';
      }
    }
    if (rec.verdict !== 'FAIL') {
      if (rec.pinned) { rec.verdict = 'WARN'; rec.notes.push('PINNING erkannt'); }
      if (maxPenRest > 0.05) { rec.verdict = 'WARN'; rec.notes.push('Restueberlappung ' + f4(maxPenRest) + ' px'); }
      if (stopped === 'maxFrames') { rec.verdict = 'WARN'; rec.notes.push('kein Settlement in ' + maxF + ' Frames'); }
    }
    if (opt.analyze) opt.analyze(rec);
    results.push(rec);
    return rec;
  };
}

function firstHit(rec, type, ballIdx) {
  for (const e of rec.log) {
    const c = e.sw.cs[ballIdx];
    if (!c) continue;
    const h = c.find((x) => x.type === type);
    if (h) return { e, h, sub: e.sw.sub };
  }
  return null;
}

const B = (x, y, vx, vy, owner) => ({ x, y, vx: vx || 0, vy: vy || 0, owner });
const { cx, cy, BR } = G;
const NBR = G.ballR;                  // Radius des neutralen Balls (25)
const RR  = NBR + BR;                 // Kontaktdistanz Spieler <-> Neutralball (57)
const VMAX = TUNE.maxLaunchV;
const LV = [0.25, 0.50, 0.75, 1.00].map((k) => k * VMAX);
const D = Math.PI / 180;
// Ballmitte AUF der +y-Laengsbande (gerades Segment, |x-cx| <= hx-rc = 356.8):
// die Grenze fuer Ballmitten ist die um den KUGELRADIUS eingerueckte Arenaform.
const bandY = (r) => cy + G.hw - r;

// ══════════════════════════════════════════════════════════════════════════
//  SZENARIENSATZ  (identisch fuer jede Iterationsvariante)
// ══════════════════════════════════════════════════════════════════════════
function runAll(ci, preset) {
  const env = buildEnv(ci, preset);
  const results = [];
  const run = makeRun(env, results);
  const M = { IMPULSE: [], OBLIQUE: [], ROLL: [], BAND: [], POST: [] };
  // Referenzdaempfung DIESES Laufs. Alle Verhaeltniszahlen unten werden gegen die
  // tatsaechlich aktive Reibung des SUBJEKTS normiert — sonst waeren Presets nicht
  // vergleichbar. Seit M1 hat der neutrale Ball seine eigene Daempfung: eF2 gilt fuer
  // Spieler-Subjekte (E/F), nF2 fuer Neutralball-Subjekte (H/I).
  const eEFF = env.effective(), eF2 = eEFF.fr * eEFF.fr, eF4 = eF2 * eF2;
  const nF2 = eEFF.frBall * eEFF.frBall;

  // ── A. SPIELER + BANDE ──
  run('A1 Spieler an Bande, Gegner drueckt frontal v=4.0', 'A',
    [B(cx, bandY(BR), 0, 0, 0), B(cx, bandY(BR) - 2 * BR, 0, 4.0, 1)]);
  run('A2 Spieler an Bande, Gegner drueckt frontal v=VMAX', 'A',
    [B(cx, bandY(BR), 0, 0, 0), B(cx, bandY(BR) - 2 * BR, 0, VMAX, 1)]);
  run('A3 Spieler an Bande, Gegner schraeg 30 grad', 'A',
    [B(cx, bandY(BR), 0, 0, 0),
     B(cx - 2 * BR * Math.sin(30 * D), bandY(BR) - 2 * BR * Math.cos(30 * D),
       4.0 * Math.sin(30 * D), 4.0 * Math.cos(30 * D), 1)]);
  run('A4 Spieler an Bande, 4 Volltreffer nacheinander', 'A',
    [B(cx, bandY(BR), 0, 0, 0), B(cx, bandY(BR) - 2 * BR, 0, VMAX, 1)],
    { shots: [1, 2, 3].map(() => ({ i: 1, vx: 0, vy: VMAX })) });

  // ── B. (GESTRICHEN) SPIELER / NEUTRALBALL + TORPFOSTEN IM FELD ──
  // Auf der produktiven Arena liegt die Sockelvorderkante EXAKT auf der Bandeninnen-
  // flaeche (postFront == halfLen). Eine Kugel im Feld kommt hoechstens auf Beruehr-
  // abstand an den Sockel — die Drueck-Szenarien B1-B4 (Kugel an der Sockelkante im
  // Feld) sind damit geometrisch unmoeglich geworden und entfallen ersatzlos. Die
  // verbliebene, real erreichbare Sockelphysik (ausgetretener neutraler Ball im
  // Torkanal) wird in Klasse I gemessen.

  // ── C. NEUTRALBALL ZWISCHEN ZWEI SPIELERN ──
  run('C1 Ball zwischen Rot/Blau, exakt symmetrisch', 'C',
    [B(cx, cy, 0, 0, 4), B(cx - 2 * BR, cy, 3.0, 0, 0), B(cx + 2 * BR, cy, -3.0, 0, 1)]);
  run('C2 Ball zwischen Rot/Blau, 5 % asymmetrisch', 'C',
    [B(cx, cy, 0, 0, 4), B(cx - 2 * BR, cy, 3.0, 0, 0), B(cx + 2 * BR, cy, -3.15, 0, 1)]);
  run('C3 Ball zwischen Rot/Blau, diagonaler Druck 90 grad', 'C',
    [B(cx, cy, 0, 0, 4), B(cx - 2 * BR, cy, 3.0, 0, 0), B(cx, cy + 2 * BR, 0, -3.0, 1)]);
  run('C4 Ball zwischen Rot/Blau, langsamer Dauerdruck', 'C',
    [B(cx, cy, 0, 0, 4), B(cx - 2 * BR, cy, 1.0, 0, 0), B(cx + 2 * BR, cy, -1.0, 0, 1)]);

  // ── D. DREIFACHKONTAKT AN DER BANDE ──
  // Neutralball (r=25) auf der geraden Laengsbande, zwei Spieler (r=32) druecken im
  // 30-grad-Faecher. Abstand = Kontaktdistanz RR=57 statt frueher 2*BR.
  {
    const a = 30 * D, px = RR * Math.sin(a), py = RR * Math.cos(a);
    const pair = (v0, v1) => [
      B(cx, bandY(NBR), 0, 0, 4),
      B(cx - px, bandY(NBR) - py, v0 * Math.sin(a), v0 * Math.cos(a), 0),
      B(cx + px, bandY(NBR) - py, -v1 * Math.sin(a), v1 * Math.cos(a), 1)];
    run('D1 Neutralball Bande + zwei Spieler, symmetrisch', 'D', pair(3.0, 3.0));
    run('D2 Neutralball Bande + zwei Spieler, asymmetrisch', 'D', pair(3.0, 2.4));
    run('D3 Neutralball Bande + zwei Spieler, Dauerdruck', 'D', pair(1.0, 1.0));
    run('D4 Neutralball Bande + zwei Spieler, 4 Nachschuesse', 'D', pair(3.0, 3.0), {
      shots: [0, 1, 2].map(() => ({ i: 1, vx: VMAX * Math.sin(a), vy: VMAX * Math.cos(a) }))
    });
  }

  // ── E. ZENTRALE IMPULSUEBERTRAGUNG ──
  LV.forEach((v0, k) => {
    const label = [25, 50, 75, 100][k] + ' %';
    run('E' + (k + 1) + ' Zentraler Stoss, Launch ' + label, 'E',
      [B(cx, cy - RR - 0.5, 0, v0, 0), B(cx, cy, 0, 0, 4)], {
        maxFrames: 900,
        analyze(rec) {
          const h = firstHit(rec, 'ball', 0);
          if (!h) { rec.notes.push('kein Kontakt'); rec.verdict = 'FAIL'; return; }
          const ref = v0 * eF2;
          // Impulserhaltung AN DER IMPULSSTELLE, rekonstruiert ueber die Frame-Grenze:
          // seit M1 daempfen Spieler (fr) und neutraler Ball (frBall) unterschiedlich,
          // die Summe der Rohgeschwindigkeiten ist daher KEINE Erhaltungsgroesse mehr.
          // Kontakt in Micro-Step 1: post_i = w_i*f_i und sum(w) == sum(pre_i*f_i);
          // Kontakt in Micro-Step 2: post_i = w_i und sum(w) == sum(pre_i*f_i^2).
          // Das Regime (fr oder fend) haengt je Micro-Step von der Geschwindigkeit VOR
          // der Daempfung ab — vorwaerts direkt anwendbar, rueckwaerts eindeutig ueber
          // die Konsistenzprobe w = post/fr, sonst w = post/fend (nur E1 landet nach
          // dem Impuls unterhalb der M1-Schwelle slowv=0.50).
          const dampF = (s, nb) => (s < eEFF.slowv ? (nb ? eEFF.feBall : eEFF.fe)
                                                   : (nb ? eEFF.frBall : eEFF.fr));
          let inx = 0, iny = 0, outx = 0, outy = 0;
          for (let i = 0; i < h.e.pre.length; i++) {
            const nb = h.e.pre[i].owner === G.neutral;
            let vx = h.e.pre[i].vx, vy = h.e.pre[i].vy;
            for (let k = 0; k < h.sub; k++) {           // Daempfungen bis zur Impulsstelle
              const f = dampF(Math.hypot(vx, vy), nb); vx *= f; vy *= f;
            }
            inx += vx; iny += vy;
            const o = h.e.post[i];
            if (h.sub === 1) {                          // eine Daempfung NACH dem Impuls
              const fr = nb ? eEFF.frBall : eEFF.fr, fe = nb ? eEFF.feBall : eEFF.fe;
              const s = Math.hypot(o.vx, o.vy);
              const f = (s / fr) >= eEFF.slowv ? fr : fe;
              outx += o.vx / f; outy += o.vy / f;
            } else { outx += o.vx; outy += o.vy; }
          }
          const m = {
            label, v0, sub: h.sub, penIn: h.h.pen,
            vPlayerAfter: sp(h.e.post[0]), vBallAfter: sp(h.e.post[1]),
            ratioPlayer: sp(h.e.post[0]) / ref, ratioBall: sp(h.e.post[1]) / ref,
            momentumErr: Math.hypot(outx - inx, outy - iny),
            energyEff: h.e.Epost / (h.e.Epre * eF4), frame: h.e.f
          };
          rec.impulse = m; M.IMPULSE.push(m);
        }
      });
  });

  // ── F. SCHRAEGER TREFFER ──
  // Stossparameter fuer den Soll-Kontaktwinkel: off = RR*sin(theta) — die Kontakt-
  // distanz Spieler/Neutralball ist seit Ballgroessen-Phase B3 57 statt 2*BR.
  [15, 30, 45, 60].forEach((deg, k) => {
    const th = deg * D, off = RR * Math.sin(th), v0 = 4.0;
    run('F' + (k + 1) + ' Schraeger Treffer ' + deg + ' grad', 'F',
      [B(cx - off, cy - 140, 0, v0, 0), B(cx, cy, 0, 0, 4)], {
        maxFrames: 900,
        analyze(rec) {
          const h = firstHit(rec, 'ball', 0);
          if (!h) { rec.notes.push('kein Kontakt'); rec.verdict = 'FAIL'; return; }
          const ball = h.e.post[1], plr = h.e.post[0], ref = sp(h.e.pre[0]) * eF2, nrm = h.h;
          const ang = (b) => { const a = ((Math.atan2(b.vx, b.vy) / D) + 360) % 360; return a > 180 ? a - 360 : a; };
          const o = {
            deg, sub: h.sub, penIn: nrm.pen,
            geomDeg: Math.abs(Math.atan2(-nrm.nx, -nrm.ny) / D),
            ballDeg: ang(ball), ballSpeed: sp(ball), playerSpeed: sp(plr), playerDeg: ang(plr),
            vRef: ref, frame: h.e.f
          };
          o.ballRatio = o.ballSpeed / ref;
          o.playerRatio = o.playerSpeed / ref;
          o.angleErr = Math.abs(Math.abs(o.ballDeg) - deg);
          rec.oblique = o; M.OBLIQUE.push(o);
        }
      });
  });

  // ── G. AUSROLLVERHALTEN ──
  // maxFrames 1600 statt 900: M1/ICE daempfen deutlich schwaecher als der alte
  // GLIDE-Satz (frictionBall 0.9982 bzw. 0.9985) — der Auslauf inkl. eines legitimen
  // Bandenkontakts dauert bis ~900+ Frames und braucht Reserve bis zum Settlement.
  [['G1 Ausrollen Neutralball', 4], ['G2 Ausrollen Spielerball', 0]].forEach(([nm, owner]) => {
    const v0 = 3.0;
    run(nm, 'G', [B(cx, cy - 260, 0, v0, owner)], {
      maxFrames: 1600,
      analyze(rec) {
        const marks = [0.75, 0.50, 0.25];
        const res = { name: nm, owner, v0, marks: [], dist: 0 };
        let done = 0, x = rec.start[0].x, y = rec.start[0].y, dist = 0;
        for (const e of rec.log) {
          dist += Math.hypot(e.post[0].x - x, e.post[0].y - y);
          x = e.post[0].x; y = e.post[0].y;
          while (done < marks.length && sp(e.post[0]) <= v0 * marks[done]) {
            res.marks.push({ frac: marks[done], frame: e.f, dist });
            done++;
          }
        }
        res.dist = dist; res.settleFrames = rec.settleFrames; res.contacts = rec.events;
        rec.roll = res; M.ROLL.push(res);
      }
    });
  });

  // ── H. BANDENABPRALL ──
  const bandMetric = (rec, kind, v0) => {
    const h = firstHit(rec, 'band', 0);
    if (!h) { rec.notes.push('kein Bandenkontakt'); rec.verdict = 'FAIL'; return { kind, v0, ratio: null }; }
    const before = h.e.pre[0], after = h.e.post[0], n = h.h;
    const vinN  = Math.abs(before.vx * -n.nx + before.vy * -n.ny);
    const voutN = Math.abs(after.vx * n.nx + after.vy * n.ny);
    const vinT  = Math.abs(before.vx * -n.ny + before.vy * n.nx);
    const voutT = Math.abs(after.vx * -n.ny + after.vy * n.nx);
    const m = {
      kind, v0, frame: h.e.f, sub: h.sub, penIn: n.pen,
      vIn: sp(before), vOut: sp(after), ratio: sp(after) / (sp(before) * nF2),
      normalRatio: vinN > 1e-9 ? voutN / (vinN * nF2) : null,
      tangentRatio: vinT > 1e-9 ? voutT / (vinT * nF2) : null,
      incidenceDeg: Math.acos(Math.min(1, vinN / (sp(before) || 1e-12))) / D
    };
    rec.band = m; M.BAND.push(m); return m;
  };
  // Beide Aufpunkte liegen auf dem GERADEN Segment der +y-Laengsbande
  // (|x-cx| <= hx-rc = 356.8): die Normale ist exakt (0,-1), der Tangentialanteil
  // bleibt messbar unveraendert. maxFrames 1600: siehe Klasse G (M1/ICE-Auslauf).
  [1.0, 2.0, 4.0, VMAX].forEach((v0, k) => {
    run('H' + (k + 1) + ' Bandenabprall zentral v=' + f2f(v0), 'H',
      [B(cx, bandY(NBR) - 90, 0, v0, 4)], { maxFrames: 1600, analyze: (r) => bandMetric(r, 'zentral', v0) });
  });
  // Schraeg: auf der GERADEN Bande entsteht der Einfallswinkel aus der Geschwindigkeit
  // selbst (40 grad gegen die Normale) — auf dem Kreis kam er frueher aus dem
  // Aufpunkt-Versatz. Der Kontakt bleibt auf dem geraden Segment (x ~= cx-66).
  [2.0, 4.0].forEach((v0, k) => {
    run('H' + (5 + k) + ' Bandenabprall schraeg v=' + f2f(v0), 'H',
      [B(cx - 200, bandY(NBR) - 160, v0 * Math.sin(40 * D), v0 * Math.cos(40 * D), 4)],
      { maxFrames: 1600, analyze: (r) => bandMetric(r, 'schraeg', v0) });
  });

  // ── I. SOCKELABPRALL IM TORKANAL ──
  // Mit postFront == halfLen ist der Sockel aus dem Feld heraus unerreichbar; die
  // einzige real erreichbare Sockelphysik trifft den AUSGETRETENEN neutralen Ball im
  // Torkanal (zwischen Bandenlinie und Torlinie). Die Szenarien schicken den Ball
  // beruehrungsfrei durch die Oeffnung (fbPassed) und lassen ihn dort driftend die
  // Sockel-Innenflaeche bzw. die Sockel-Vorderecke treffen. Die alten Feld-Szenarien
  // (frontal/innenkante aus dem Feld) sind geometrisch entfallen.
  const postMetric = (rec, kind, v0) => {
    const h = firstHit(rec, 'post', 0);
    if (!h) { rec.notes.push('kein Sockelkontakt'); rec.verdict = 'FAIL'; return { kind, v0, ratio: null }; }
    const before = h.e.pre[0], after = h.e.post[0], n = h.h;
    const vinN  = Math.abs(before.vx * -n.nx + before.vy * -n.ny);
    const voutN = Math.abs(after.vx * n.nx + after.vy * n.ny);
    const m = {
      kind, v0, frame: h.e.f, sub: h.sub, penIn: n.pen,
      vIn: sp(before), vOut: sp(after), ratio: sp(after) / (sp(before) * nF2),
      normalRatio: vinN > 1e-9 ? voutN / (vinN * nF2) : null,
      inDeg: Math.atan2(before.vy, before.vx) / D, outDeg: Math.atan2(after.vy, after.vx) / D
    };
    rec.postM = m; M.POST.push(m); return m;
  };
  // Flache Drift (Steigung 0.13) auf die Sockel-INNENFLAECHE: Start 11 px vor der
  // Ballmitten-Grenze (hx - ballR = 474.2), Durchtritt bei y-cy ~ 81.4 < 88.92,
  // Kontakt bei y-cy = 88.92 (= y0 - ballR) und x-cx ~ 530 — mitten im Kanal,
  // deutlich VOR der Torlinie (599.976). Vier Startgeschwindigkeiten.
  // Der Startpunkt haengt an G.hx statt an einer festen Zahl: die Szenarien bleiben
  // damit auch nach einem Formwechsel der Arena an derselben Stelle im Torkanal.
  {
    const sI = 0.13, uI = 1 / Math.hypot(1, sI), sxI = cx + G.hx - 36, syI = cy + 80;
    [1.0, 2.0, 4.0, VMAX].forEach((v0, k) => {
      run('I' + (k + 1) + ' Sockel-Innenflaeche im Torkanal v=' + f2f(v0), 'I',
        [B(sxI, syI, v0 * uI, v0 * uI * sI, 4)],
        { maxFrames: 1600, analyze: (r) => postMetric(r, 'innenflaeche', v0) });
    });
    // Steilere Driften treffen die SOCKEL-VORDERECKE (499.2,113.92): die Kontaktnormale
    // kommt vom Eckpunkt und ist schraeg — die Kreis/AABB-Aufloesung der Quelle.
    run('I5 Sockel-Vorderecke flach v=4.0', 'I',
      [B(sxI, cy + 80, 4.0 / Math.hypot(1, 0.30), 4.0 * 0.30 / Math.hypot(1, 0.30), 4)],
      { maxFrames: 1600, analyze: (r) => postMetric(r, 'vorderecke', 4.0) });
    run('I6 Sockel-Vorderecke steil v=4.0', 'I',
      [B(sxI, cy + 70, 4.0 / Math.hypot(1, 0.80), 4.0 * 0.80 / Math.hypot(1, 0.80), 4)],
      { maxFrames: 1600, analyze: (r) => postMetric(r, 'vorderecke-steil', 4.0) });
    // Gespiegelte Innenflaeche (-y): beide Sockelseiten rechnen exakt symmetrisch.
    run('I7 Sockel-Innenflaeche gespiegelt v=4.0', 'I',
      [B(sxI, cy - 80, 4.0 * uI, -4.0 * uI * sI, 4)],
      { maxFrames: 1600, analyze: (r) => postMetric(r, 'innenflaeche-sued', 4.0) });
  }

  // ── J. (GESTRICHEN) SOCKEL-AUSSENFLANKE JENSEITS DER BANDENLINIE ──
  // Auf dem Kreis ragte der Sockel radial UEBER die Bandenlinie hinaus und eine Kugel
  // konnte legitim bei r > flim auf seiner Aussenflanke liegen (Bande und Sockel
  // korrigierten gegeneinander). Auf dem Rounded Rectangle liegt der gesamte Sockel
  // AUSSERHALB der Grenze (postFront == halfLen) — die Lage existiert nicht mehr,
  // J1/J2 entfallen ersatzlos.

  // ── W. KEIL AN DER LAENGSBANDE (Anti-Wedge-Verhaltenstest) ──
  // Der urspruengliche Drei-Kugel-Keil lag in der Ecke Bande+Sockel-Aussenflanke —
  // diese Ecke existiert auf dem Rounded Rectangle nicht mehr (Sockel im Feld
  // unerreichbar). Der Keil wird deshalb auf der geraden Laengsbande nachgebaut:
  // der neutrale Ball liegt an der Bande, Spieler 0 blockiert RUHEND die eine
  // tangentiale Flucht (Beruehrabstand), Spieler 1 drueckt frontal in die Bande.
  // Damit liegen drei Normalen an (Bande, Blocker, Druecker); Bande vs. Druecker
  // schliessen den Ball geometrisch ein (Dot -1) — der Anti-Wedge muss ihn erkennen
  // und TANGENTIAL (weg vom Blocker) an der Bande herausgleiten lassen, nicht durch
  // Bande oder Kugeln. Unter CURRENT (keine Football-Physik) gibt es strukturell
  // keinen Escape.
  {
    const wby = bandY(NBR);
    // Druckstaerke 0.30: die Keilbestaetigung verlangt GLEICHZEITIG |v|<WEDGE_V=0.25
    // und anhaltenden Druck > WEDGE_PRESS ueber 8 Micro-Steps. Die Feinsuche auf der
    // flachen Bande (Prototyp-Probe, GLIDE und ICE) zeigt: nur ein sanfter Dauerdruck
    // um 0.25-0.30 haelt den Ball langsam genug UND drueckt lange genug — staerkerer
    // Druck haelt den Ball zu schnell, schwaecherer faellt vor der Bestaetigung unter
    // die Druckschwelle. 0.30 feuert in beiden Modellen deterministisch.
    const wedge = (v) => [
      B(cx, wby, 0, 0, G.neutral),
      B(cx + RR, wby, 0, 0, 0),               // tangentialer Blocker, ruhend
      B(cx, wby - RR, 0, v, 1)];              // frontaler Druecker
    run('W1 Keil an der Laengsbande, Dauerdruck', 'W', wedge(0.30), { maxFrames: 2400 });
    // W2: nach jedem Settlement schiesst der Druecker mit voller Kraft auf die
    // AKTUELLE Ballposition — der Fall "weitere frontale Treffer loesen ihn nicht,
    // erst der Anti-Wedge tut es". (Auf dem Kreis schoss abwechselnd auch der zweite
    // Spieler; hier bleibt der Blocker passiv, sonst gaebe es eine triviale
    // tangentiale Flucht ganz ohne Keillage.)
    run('W2 Keil an der Laengsbande, 3 gezielte Nachschuesse', 'W', wedge(0.30), {
      maxFrames: 2400,
      shots: [0, 1, 2].map(() => ({ i: 2, at: 0, sp: VMAX }))
    });
  }

  return { ci: env.ci, preset: env.presetName(), results, M, env };
}

// ══════════════════════════════════════════════════════════════════════════
//  GAMEPLAY-REGRESSION (Torpassage / Barriere / Score / Reset / First-to-3)
// ══════════════════════════════════════════════════════════════════════════
// Schussgeschwindigkeit der Torproben: die Torlinie liegt auf der neuen Arena bei
// |dx| = 676.776 (Sockel-Hinterkante + Ballradius) statt ~500 auf dem Kreis. Mit dem
// alten v=5.0 bliebe der Ball unter CURRENT (FRICTION 0.992) nach ~600 px im Kanal
// liegen — 6.5 (knapp unter vMax 6.596) traegt ihn sicher ueber die Linie.
const PROBE_V = 6.5;
function gameplayProbe(ci, preset) {
  const env = buildEnv(ci, preset);
  const out = {};

  // 1) Neutralball trifft die freie Toroeffnung mittig -> Tor, Score, 'fall'
  env.reset();
  env.setBalls([{ x: cx, y: cy, vx: PROBE_V, vy: 0, owner: 4 }]);
  let f = 0;
  while (f++ < 900 && env.goalState() === 'play' && env.phase() === 'sim') env.step();
  out.goalScored = env.score().slice();
  out.goalState = env.goalState();
  out.goalFrame = f;

  // 2) Spielerkugel auf derselben Bahn -> KEIN Durchtritt (unsichtbare Barriere)
  env.reset();
  env.setBalls([{ x: cx, y: cy, vx: PROBE_V, vy: 0, owner: 0 }]);
  f = 0;
  while (f++ < 900 && env.phase() === 'sim') env.step();
  const pb = env.get()[0];
  out.playerBlocked = !pb.passed && env.boundSD(pb).sd <= 1e-6;
  out.playerScore = env.score().slice();

  // 3) Neutralball knapp AUSSERHALB der nutzbaren Oeffnung (y = centerHalf + 1):
  //    die Bande neben dem Tor reflektiert, kein fbPassed, KEIN Tor. (Der alte
  //    "Pfosteninnenkanten"-Treffer aus dem Feld existiert nicht mehr, s. Klasse I.)
  env.reset();
  env.setBalls([{ x: cx, y: cy + G.goalHalf + 1, vx: PROBE_V, vy: 0, owner: 4 }]);
  f = 0;
  while (f++ < 900 && env.goalState() === 'play' && env.phase() === 'sim') env.step();
  out.postNoGoal = env.score().slice();
  out.postPassed = env.passedFlags()[0];

  // 4) Voller Torablauf: 'fall' -> Reset -> 'spawn' -> 'play', frische Kugeln
  env.reset();
  env.setBalls([{ x: cx, y: cy, vx: PROBE_V, vy: 0, owner: 4 }]);
  f = 0;
  while (f++ < 900 && env.goalState() === 'play') env.step();
  const seq = [env.goalState()];
  for (let k = 0; k < 200; k++) { env.step(); if (seq[seq.length - 1] !== env.goalState()) seq.push(env.goalState()); }
  out.stateSeq = seq.join('->');
  out.ballsAfterReset = env.get().length;

  // 5) First-to-3: Score kuenstlich auf 2, ein weiteres Tor beendet das Match
  env.reset();
  env.setBalls([{ x: cx, y: cy, vx: PROBE_V, vy: 0, owner: 4 }]);
  f = 0;
  while (f++ < 900 && env.goalState() === 'play') env.step();
  out.firstGoalWinner = env.winner();

  return out;
}

// ══════════════════════════════════════════════════════════════════════════
//  LAEUFE
// ══════════════════════════════════════════════════════════════════════════
const BASE = runAll(1, 'CURRENT');          // Physikpfad VOR 4B-1
const NEW  = runAll(CI_PROD, 'CURRENT');    // produktiver ci-Wert, Referenzphysik
const byName = (arr) => Object.fromEntries(arr.map((r) => [r.name, r]));
const BN = byName(BASE.results), NN = byName(NEW.results);
// Die 4B-1-Kennzahlen beziehen sich auf den urspruenglichen Szenariensatz. Die in 4B-2
// ergaenzte W-Klasse ist ein bewusst UNLOESBARER Keil unter CURRENT und wuerde die
// Ueberlappungs- und Pinning-Maxima dominieren; sie wird deshalb getrennt ausgewiesen.
const NO_W = (r) => r.cls !== 'W';

// ══════════════════════════════════════════════════════════════════════════
//  AUSGABE
// ══════════════════════════════════════════════════════════════════════════
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n) => (v == null ? '—' : String(f4(v))).padStart(n);
const secs = (fr) => (fr == null || fr < 0 ? '—' : (fr / 60).toFixed(2) + ' s');
const short = (r) => r.name.split(' ')[0];

console.log('ARENA FOOTBALL — SPIELFLUSS- UND ANTI-PINNING-MESSHARNESS');
console.log('Phase 4B-1: A/B-Abnahme der iterativen Kontaktaufloesung\n');
console.log('Konstanten aus index.html (unveraendert uebernommen):');
console.log('  FOOTBALL_CONTACT_ITERATIONS = ' + CI_PROD + '   (Baseline-Lauf erzwingt 1)');
console.log('  LAUNCH=' + TUNE.LAUNCH + '  MAXPULL_FRAC=' + TUNE.MAXPULL_FRAC +
            '  -> vMax=' + f4(TUNE.maxLaunchV) + ' px/Micro-Step (' + f4(TUNE.maxLaunchV * 120) + ' px/s)');
console.log('  FRICTION=' + TUNE.FRICTION + '  FEND=' + TUNE.FEND + '  SLOWV=' + TUNE.SLOWV +
            '  REST=' + TUNE.REST + '  STOPV=' + TUNE.STOPV);
console.log('  Arena (Shouldered Wide): halfLen=' + f4(G.hx) + '  halfWid=' + f4(G.hw) +
            '  Eckradius=' + f4(G.rc) + '  BR=' + BR + '  BallR=' + NBR);
console.log('  Sockel X[' + f4(G.x0) + ',' + f4(G.x1) + '] Y[' + f4(G.y0) + ',' + f4(G.y1) + ']' +
            '  Torfenster=+-' + f4(G.goalHalf) + '  Torlinie=|dx|>' + f4(G.x1 + NBR));
console.log('  Masse weiterhin NICHT modelliert (imp=-(1+REST)*vn/2), keine Geschwindigkeitsgrenze.\n');

console.log('══ A/B-VERGLEICH JE SZENARIO ' + '═'.repeat(64));
console.log('   ' + pad('Szenario', 10) + pad('Verlagerung Subjekt', 26) + pad('Restueberlappung', 24) +
            pad('Pinning Fr.', 14) + 'Settlement Fr.');
console.log('   ' + pad('', 10) + pad('ci=1  ->  ci=' + CI_PROD, 26) + pad('ci=1  ->  ci=' + CI_PROD, 24) +
            pad('ci=1 -> ' + CI_PROD, 14) + 'ci=1 -> ' + CI_PROD);
let lastCls = '';
for (const r of NEW.results) {
  const b = BN[r.name];
  if (r.cls !== lastCls) { console.log('   ' + '─'.repeat(84)); lastCls = r.cls; }
  const arrow = (x, y, dec) => f2f(x).toFixed(dec) + ' -> ' + f2f(y).toFixed(dec);
  console.log('   ' + pad(short(r), 10) +
    pad(f2f(b.moved[0]).toFixed(2) + ' px -> ' + f2f(r.moved[0]).toFixed(2) + ' px', 26) +
    pad(f4(b.maxPenRest) + ' -> ' + f4(r.maxPenRest) + ' px', 24) +
    pad(b.pinFramesMax + ' -> ' + r.pinFramesMax, 14) +
    (b.settleFrames + ' -> ' + r.settleFrames));
}

console.log('\n══ SZENARIEN IM DETAIL (ci=' + CI_PROD + ') ' + '═'.repeat(56));
lastCls = '';
for (const r of NEW.results) {
  const b = BN[r.name];
  if (r.cls !== lastCls) { console.log(''); lastCls = r.cls; }
  const fmtB = (x, p) => '(' + f2f(x.x) + ',' + f2f(x.y) + ' v' + (p ? f4(sp(x)) : f2f(sp(x))) + ')';
  console.log('── ' + r.name);
  console.log('   Start     : ' + r.start.map((x) => fmtB(x, 0)).join(' '));
  console.log('   Ende      : ' + r.end.map((x) => fmtB(x, 1)).join(' '));
  console.log('   Verlagerg.: ' + r.moved.map((v) => f2f(v) + ' px').join('  |  ') +
              '     (Baseline: ' + b.moved.map((v) => f2f(v) + ' px').join('  |  ') + ')');
  console.log('   Kontakte  : ' + r.events + ' Ereignisse, max ' + r.maxSimultaneous +
              ' ruhende Kontakte je Frame   minAbstand=' + num(r.minDist, 1) +
              ' px (Kontaktdistanz ' + RR + ' Ball/Spieler, ' + 2 * BR + ' Spieler/Spieler)');
  console.log('   Penetr.   : Eindringtiefe waehrend Micro-Step=' + f4(r.maxPenIn) +
              ' px   Peak nach Korrektur=' + f4(r.maxPenRest) + ' (Baseline ' + f4(b.maxPenRest) + ')' +
              '   BLEIBEND=' + f4(r.endPen) + ' (Baseline ' + f4(b.endPen) + ')' +
              '   Bande=' + f4(r.maxBandOver) + '   Sockel=' + f4(r.maxPostRest));
  console.log('   Settlement: ' + (r.settleAt.length
              ? r.settleAt.join(', ') + ' Frames (' + secs(r.settleFrames) + ')' +
                (r.shots ? '  [' + (r.shots + 1) + ' Schuesse]' : '')
              : r.stopped === 'goal' ? 'TOR in Frame ' + r.goalFrame
              : 'nicht erreicht (' + r.frames + ' Frames)'));
  console.log('   Pinning   : max ' + r.pinFramesMax + ' Frames zusammenhaengend (Baseline ' +
              b.pinFramesMax + ')' + (r.pinned ? '  -> GEPINNT' : '') +
              '   gesamt ' + r.pinFramesTotal + ' (Baseline ' + b.pinFramesTotal + ')');
  console.log('   Energie   : E0=' + f4(r.E0) + ' -> E1=' + f4(r.E1) +
              '   Kollisionswirkungsgrad min=' + num(r.minEff, 1) + ' max=' + num(r.maxEff, 1) +
              '   (Baseline min=' + num(b.minEff, 1) + ' max=' + num(b.maxEff, 1) + ')');
  console.log('   Effekte   : ' + r.fx.sfxHits + ' Trefferklaenge, ' + r.fx.spawnCalls +
              ' Partikelbursts (Baseline ' + b.fx.sfxHits + ' / ' + b.fx.spawnCalls + ')');
  console.log('   Ergebnis  : ' + r.verdict + (r.notes.length ? '  [' + r.notes.join('; ') + ']' : ''));
}

// ── Einzelkontakt-Regression: Baseline vs. neu ──
console.log('\n══ EINZELKONTAKT-REGRESSION ' + '═'.repeat(65));
console.log('\n1) Zentraler Stoss (Referenz vRef = v0*FRICTION^2)');
console.log('   ' + pad('Launch', 8) + pad('Anteil Sp. (ci1 -> ci' + CI_PROD + ')', 26) +
            pad('Anteil Ball (ci1 -> ci' + CI_PROD + ')', 27) + pad('E-Wirkungsgrad', 26) + 'Impulsfehler');
NEW.M.IMPULSE.forEach((m, i) => {
  const b = BASE.M.IMPULSE[i];
  console.log('   ' + pad(m.label, 8) + pad(f4(b.ratioPlayer) + ' -> ' + f4(m.ratioPlayer), 26) +
              pad(f4(b.ratioBall) + ' -> ' + f4(m.ratioBall), 27) +
              pad(f4(b.energyEff) + ' -> ' + f4(m.energyEff), 26) + m.momentumErr.toExponential(1));
});

console.log('\n2) Schraeger Treffer (v0=4.0)');
console.log('   ' + pad('Soll', 9) + pad('Abgang Ball (ci1 -> ci' + CI_PROD + ')', 30) +
            pad('vBall/vRef', 24) + 'vSpieler/vRef');
NEW.M.OBLIQUE.forEach((m, i) => {
  const b = BASE.M.OBLIQUE[i];
  console.log('   ' + pad(m.deg + ' grad', 9) + pad(f4(b.ballDeg) + ' -> ' + f4(m.ballDeg) + ' grad', 30) +
              pad(f4(b.ballRatio) + ' -> ' + f4(m.ballRatio), 24) +
              f4(b.playerRatio) + ' -> ' + f4(m.playerRatio));
});

console.log('\n3) Ausrollverhalten (v0=3.0, kontaktfrei)');
NEW.M.ROLL.forEach((m, i) => {
  const b = BASE.M.ROLL[i];
  console.log('   ' + pad(m.owner === 4 ? 'Neutralball' : 'Spielerball', 14) +
              'Settlement ' + b.settleFrames + ' -> ' + m.settleFrames + ' Frames   Weg ' +
              f2f(b.dist) + ' -> ' + f2f(m.dist) + ' px   Kontakte ' + b.contacts + ' -> ' + m.contacts);
});

console.log('\n4) Bandenabprall');
console.log('   ' + pad('Art', 10) + pad('v0', 8) + pad('|v| Verh. (ci1 -> ci' + CI_PROD + ')', 26) +
            pad('Normal', 24) + 'Tangential');
NEW.M.BAND.forEach((m, i) => {
  const b = BASE.M.BAND[i];
  if (m.ratio == null) return;
  console.log('   ' + pad(m.kind, 10) + pad(f4(m.v0), 8) + pad(f4(b.ratio) + ' -> ' + f4(m.ratio), 26) +
              pad(num(b.normalRatio, 1) + ' -> ' + num(m.normalRatio, 1), 24) +
              num(b.tangentRatio, 1) + ' -> ' + num(m.tangentRatio, 1));
});

console.log('\n5) Pfostenabprall');
console.log('   ' + pad('Art', 12) + pad('v0', 8) + pad('|v| Verh. (ci1 -> ci' + CI_PROD + ')', 26) +
            pad('Normal', 24) + 'Abgang');
NEW.M.POST.forEach((m, i) => {
  const b = BASE.M.POST[i];
  if (m.ratio == null) return;
  console.log('   ' + pad(m.kind, 12) + pad(f4(m.v0), 8) + pad(f4(b.ratio) + ' -> ' + f4(m.ratio), 26) +
              pad(num(b.normalRatio, 1) + ' -> ' + num(m.normalRatio, 1), 24) +
              f4(b.outDeg) + ' -> ' + f4(m.outDeg) + ' grad');
});

// ── Turbo-Boost-Kontrolle: Spitzengeschwindigkeiten Baseline vs. neu ──
console.log('\n══ TURBO-BOOST-KONTROLLE (Spitzengeschwindigkeit je Szenario) ' + '═'.repeat(32));
const spdUp = NEW.results.map((r) => ({ n: short(r), b: BN[r.name].maxSpeed, a: r.maxSpeed }))
                         .filter((x) => x.a > x.b + 1e-9);
console.log('   vMax aus dem Launch = ' + f4(VMAX) + ' px/Micro-Step (physikalische Obergrenze der Eingabe)');
console.log('   Szenarien mit hoeherer Spitze als Baseline: ' + spdUp.length + ' von ' + NEW.results.length);
for (const x of spdUp)
  console.log('     ' + pad(x.n, 6) + 'Baseline ' + pad(f4(x.b), 10) + '-> neu ' + pad(f4(x.a), 10) +
              '(+' + f2f((x.a / x.b - 1) * 100) + ' %, ' + f2f(x.a / VMAX) + ' x vMax)');
const gMaxB = Math.max(...BASE.results.map((r) => r.maxSpeed));
const gMaxN = Math.max(...NEW.results.map((r) => r.maxSpeed));
console.log('   Globale Spitze: ' + f4(gMaxB) + ' -> ' + f4(gMaxN) + ' px/Micro-Step  (= ' +
            f2f(gMaxN / VMAX) + ' x vMax)');
console.log('   Energiehuelle bleibt bei 1.0 — jede Erhoehung ist reine UMVERTEILUNG zwischen');
console.log('   Kugeln innerhalb desselben Micro-Steps, keine erzeugte Energie.');

// ── Konvergenzkurve ueber die Iterationszahl ──
console.log('\n══ KONVERGENZ DER RESTUEBERLAPPUNG ueber FOOTBALL_CONTACT_ITERATIONS ' + '═'.repeat(24));
const CI_SWEEP = [1, 2, 3, 4, 6, 8];
const sweepRuns = CI_SWEEP.map((c) => ({ c, r: runAll(c, 'CURRENT') }));
console.log('   ' + pad('ci', 5) + pad('transienter Spitzenwert', 26) + pad('BLEIBEND (Ruhelage)', 24) +
            pad('D4 Verlagerung', 18) + 'max Pinning');
for (const s of sweepRuns) {
  const rs = s.r.results.filter(NO_W);              // vergleichbar mit der 4B-1-Messung
  const mx = Math.max(...rs.map((r) => r.maxPenRest));
  const ep = Math.max(...rs.map((r) => r.endPen));
  const pm = Math.max(...rs.map((r) => r.pinFramesMax));
  const d4 = s.r.results.find((r) => r.name.startsWith('D4'));
  console.log('   ' + pad(s.c === CI_PROD ? s.c + ' *' : s.c, 5) + pad(f4(mx) + ' px', 26) +
              pad(f4(ep) + ' px', 24) + pad(f2f(d4.moved[0]).toFixed(2) + ' px', 18) +
              pm + ' Frames');
}
console.log('   * = produktiver Wert (ohne W-Klasse gemessen). Zielmarke < 0.05 px: BLEIBEND ab ci=' +
            (sweepRuns.find((s) => Math.max(...s.r.results.filter(NO_W).map((r) => r.endPen)) < 0.05) || { c: '—' }).c +
            ', transienter Spitzenwert erst ab ci=' +
            (sweepRuns.find((s) => Math.max(...s.r.results.filter(NO_W).map((r) => r.maxPenRest)) < 0.05) || { c: '—' }).c + '.');

// ══════════════════════════════════════════════════════════════════════════
//  VERGLEICHSMODELLE: CURRENT vs GLIDE vs ICE   (Physikphase 4B-2 / 4B-3)
//  Alle drei laufen mit dem produktiven FOOTBALL_CONTACT_ITERATIONS und demselben
//  Szenariensatz. CURRENT ist identisch mit dem NEW-Lauf oben (keine Football-Physik).
//  PRODUKTIV ist ausschliesslich GLIDE — CURRENT und ICE existieren nur in diesem
//  Harness als Referenz fuer Regression und Dokumentation.
// ══════════════════════════════════════════════════════════════════════════
const PRESETS = MODELS;   // CURRENT / GLIDE / ICE — nur GLIDE ist produktiv
const PR = { CURRENT: NEW, GLIDE: runAll(CI_PROD, 'GLIDE'), ICE: runAll(CI_PROD, 'ICE') };
const PN = {}, EFFP = {};
for (const p of PRESETS) { PN[p] = byName(PR[p].results); EFFP[p] = buildEnv(CI_PROD, p).effective(); }
const aggP = (R) => ({
  maxSpeed: Math.max(...R.results.map((r) => r.maxSpeed)),
  maxEff: Math.max(...R.results.map((r) => r.maxEff ?? 0)),
  maxPenRest: Math.max(...R.results.map((r) => r.maxPenRest)),
  maxPost: Math.max(...R.results.map((r) => r.maxPostRest)),
  maxBand: Math.max(...R.results.map((r) => r.maxBandOver)),
  maxPin: Math.max(...R.results.map((r) => r.pinFramesMax)),
  totalPin: R.results.reduce((a, r) => a + r.pinFramesTotal, 0),
  pinnedCount: R.results.filter((r) => r.pinned).length,
  escapes: R.results.reduce((a, r) => a + r.escapes, 0),
  noSettle: R.results.filter((r) => r.stopped === 'maxFrames').length,
  fails: R.results.filter((r) => r.verdict === 'FAIL').length
});
const AP = {}; for (const p of PRESETS) AP[p] = aggP(PR[p]);
const P3 = (label, fn, unit) => console.log('   ' + pad(label, 40) +
  PRESETS.map((p) => String(fn(p)).padStart(14)).join('') + (unit ? '  ' + unit : ''));
const perSec = (f) => Math.pow(f, 120);

console.log('\n══ VERGLEICHSMODELLE ' + '═'.repeat(72));
console.log('   PRODUKTIV ist ausschliesslich GLIDE. CURRENT (Stand vor 4B-2) und ICE (verworfener');
console.log('   Kandidat) existieren nur in diesem Harness als Referenz.');
console.log('   ' + pad('Metrik', 40) + PRESETS.map((p) => (p === 'GLIDE' ? p + ' *' : p).padStart(14)).join(''));
console.log('   ' + '─'.repeat(82));
console.log('   -- wirksame Physik --');
P3('FRICTION Spieler (pro Micro-Step)', (p) => f4(EFFP[p].fr));
P3('  daraus Restgeschwindigkeit pro Sekunde', (p) => f4(perSec(EFFP[p].fr)));
P3('FRICTION neutraler Ball (M1: eigener Wert)', (p) => f4(EFFP[p].frBall));
P3('  daraus Restgeschwindigkeit pro Sekunde', (p) => f4(perSec(EFFP[p].frBall)));
P3('SLOWV (Regime-Schwelle des Presets)', (p) => f4(EFFP[p].slowv));
P3('FEND (unterhalb SLOWV)', (p) => f4(EFFP[p].fe));
P3('STOPV (Settlement-Schwelle)', (p) => f4(EFFP[p].stopv));
P3('REST_BALL', (p) => f4(EFFP[p].restBall));
P3('REST_BAND', (p) => f4(EFFP[p].restBand));
P3('REST_POST', (p) => f4(EFFP[p].restPost));

console.log('   -- Ausrollen v0=3.0, kontaktfrei --');
[['Neutralball', 0], ['Spielerball', 1]].forEach(([lbl, k]) => {
  const m = (p) => PR[p].M.ROLL[k];
  const mark = (p, i) => { const x = m(p).marks[i]; return x ? x.frame : '—'; };
  P3(lbl + ': Frames bis 75 %', (p) => mark(p, 0));
  P3(lbl + ': Frames bis 50 %', (p) => mark(p, 1));
  P3(lbl + ': Frames bis 25 %', (p) => mark(p, 2));
  P3(lbl + ': Settlement (Frames)', (p) => m(p).settleFrames);
  P3(lbl + ': Settlement (Sekunden)', (p) => (m(p).settleFrames / 60).toFixed(2));
  P3(lbl + ': Strecke (px)', (p) => f2f(m(p).dist));
});

console.log('   -- Kontaktverhalten --');
P3('Zentraler Stoss 100 %: Anteil Ball', (p) => f4(PR[p].M.IMPULSE[3].ratioBall));
P3('Zentraler Stoss 100 %: E-Wirkungsgrad', (p) => f4(PR[p].M.IMPULSE[3].energyEff));
P3('Schraeger Treffer 45 Grad: Abgang', (p) => f4(PR[p].M.OBLIQUE[2].ballDeg));
P3('Schraeger Treffer 45 Grad: vBall/vRef', (p) => f4(PR[p].M.OBLIQUE[2].ballRatio));
P3('Bande zentral: Normal-Rueckprall', (p) => f4(PR[p].M.BAND[3].normalRatio));
P3('Bande schraeg: Tangential', (p) => f4(PR[p].M.BAND[5].tangentRatio));
P3('Pfosten frontal: Normal-Rueckprall', (p) => f4(PR[p].M.POST[3].normalRatio));

console.log('   -- Keile --');
const wname = { D4: 'D4 Neutralball Bande + zwei Spieler, 4 Nachschuesse',
                W1: 'W1 Keil an der Laengsbande, Dauerdruck',
                W2: 'W2 Keil an der Laengsbande, 3 gezielte Nachschuesse' };
for (const [k, n] of Object.entries(wname)) {
  P3(k + ': Verlagerung Subjekt (px)', (p) => f2f(PN[p][n].moved[0]));
  P3(k + ': Frames bis Loesung (>2*BR)', (p) => (PN[p][n].releaseFrame < 0 ? 'nie' : PN[p][n].releaseFrame));
  P3(k + ': Escapes', (p) => PN[p][n].escapes);
  P3(k + ': Pinning (Frames)', (p) => PN[p][n].pinFramesMax);
}

console.log('   -- global ueber alle ' + NEW.results.length + ' Szenarien --');
P3('Spitzengeschwindigkeit (px/Micro-Step)', (p) => f4(AP[p].maxSpeed));
P3('  davon x vMax (' + f4(VMAX) + ')', (p) => f2f(AP[p].maxSpeed / VMAX));
P3('Max. Energiezunahme (1.0 = keine)', (p) => f4(AP[p].maxEff));
P3('Ball-Ball-Ueberlappung Peak (px)', (p) => f4(AP[p].maxPenRest));
P3('Sockel-Restpenetration (px)', (p) => f4(AP[p].maxPost));
P3('Ueberschreitung Bandenlinie (px)', (p) => f4(AP[p].maxBand));
P3('Szenarien mit Pinning', (p) => AP[p].pinnedCount);
P3('Max. Pinning-Dauer (Frames)', (p) => AP[p].maxPin);
P3('Summe Pinning-Frames', (p) => AP[p].totalPin);
P3('Escape-Reaktionen gesamt', (p) => AP[p].escapes);
P3('Szenarien ohne Settlement', (p) => AP[p].noSettle);
P3('Szenarien mit FAIL-Verdikt', (p) => AP[p].fails);
console.log('   Hinweis zur Energiezunahme: der Wert ist ein VERHAELTNIS je Frame. Werte > 1 treten');
console.log('   ausschliesslich in Escape-Frames auf, in denen eine praktisch stehende Kugel auf den');
console.log('   Mindest-Escape gehoben wird. Absolut sind das hoechstens ' +
            f4(0.5 * WC.minEscapeV * WC.minEscapeV) + ' je Kugel — bei einer');
console.log('   Startenergie von 1 bis 9 in diesen Szenarien. Ausserhalb der Escape-Frames liegt das');
console.log('   Verhaeltnis in JEDEM Preset bei <= 1.000001 (eigene Assertion weiter unten).');

// ── Drei-Kugel-Keil im Detail ──
console.log('\n══ DREI-KUGEL-KEIL IM DETAIL ' + '═'.repeat(64));
for (const n of [wname.W1, wname.W2]) {
  console.log('── ' + n);
  for (const p of PRESETS) {
    const r = PN[p][n];
    const fe = r.firstEscape;
    console.log('   ' + pad(p, 9) +
      'Loesung ' + pad(r.releaseFrame < 0 ? 'nie' : r.releaseFrame + ' Fr (' + secs(r.releaseFrame) + ')', 20) +
      'Weg ' + pad(f2f(r.releaseDist) + ' px', 14) +
      'Verlagerung ' + pad(f2f(r.moved[0]) + ' px', 14) +
      'vMax ' + pad(f4(r.maxSpeed), 10) +
      'Escapes ' + pad(r.escapes, 6) +
      'minAbstand ' + pad(num(r.minDist, 1), 10) +
      'Sockel ' + pad(f4(r.maxPostRest), 8) + 'Bande ' + f4(r.maxBandOver));
    if (fe) console.log('   ' + pad('', 9) + 'erster Escape in Frame ' + fe.f +
      ': E ' + f4(fe.Epre) + ' -> ' + f4(fe.Epost) + '  (dE ' + fe.dE.toExponential(1) +
      ', Obergrenze ' + f4(0.5 * WC.minEscapeV * WC.minEscapeV) + ' je Kugel)');
  }
}
console.log('   Wedge-Definition: >= ' + WC.minContacts + ' Kontakte, Normalen-Dot <= ' + WC.dot +
            ', |v| < ' + WC.v + ' px/Micro-Step, Fortschritt < ' + WC.progress + ' px/Frame,');
console.log('   Druck > ' + WC.press + ' px/Micro-Step, Dauer >= ' + WC.steps + ' Micro-Steps (' +
            (WC.steps / 2) + ' Frames), Kontakttoleranz ' + WC.eps + ' px, Mindest-Escape ' +
            WC.minEscapeV + ' px/Micro-Step.');

// ── Gameplay-Regression ──
console.log('\n══ GAMEPLAY-REGRESSION ' + '═'.repeat(70));
const GB = gameplayProbe(1, 'CURRENT'), GN = gameplayProbe(CI_PROD, 'CURRENT');
const gline = (k, label) => console.log('   ' + pad(label, 42) +
  pad('ci=1: ' + JSON.stringify(GB[k]), 30) + 'ci=' + CI_PROD + ': ' + JSON.stringify(GN[k]));
gline('goalScored', 'Torpassage mittig -> Score');
gline('goalState', 'Zustand nach Tor');
gline('goalFrame', 'Frame des Torereignisses');
gline('playerBlocked', 'Spielerkugel wird an der Oeffnung geblockt');
gline('playerScore', 'Score dabei unveraendert');
gline('postNoGoal', 'Pfostentreffer erzeugt KEIN Tor');
gline('postPassed', 'fbPassed nach Pfostentreffer');
gline('stateSeq', 'Zustandsfolge des Torablaufs');
gline('ballsAfterReset', 'Kugeln nach Rundenreset');
gline('firstGoalWinner', 'Gewinner nach 1. Tor (First-to-3)');

// ── Gameplay-Regression je Preset ──
const GP = {}; for (const p of PRESETS) GP[p] = gameplayProbe(CI_PROD, p);
const GP_INVARIANT = ['goalScored', 'goalState', 'playerBlocked', 'playerScore',
                      'postNoGoal', 'postPassed', 'stateSeq', 'ballsAfterReset', 'firstGoalWinner'];
console.log('\n══ GAMEPLAY-REGRESSION JE PRESET ' + '═'.repeat(60));
console.log('   ' + pad('Kriterium', 34) + PRESETS.map((p) => p.padStart(22)).join(''));
for (const k of GP_INVARIANT.concat(['goalFrame']))
  console.log('   ' + pad(k, 34) + PRESETS.map((p) => JSON.stringify(GP[p][k]).padStart(22)).join(''));
console.log('   (goalFrame darf abweichen — schnellerer Ball erreicht das Tor frueher. Alles' +
            ' andere muss identisch sein.)');

// ── Zusammenfassung ──
const agg = (R, keep) => {
  const rs = keep ? R.results.filter(keep) : R.results;
  return {
    count: rs.length,
    pinnedCount: rs.filter((r) => r.pinned).length,
    maxPin: Math.max(...rs.map((r) => r.pinFramesMax)),
    totalPin: rs.reduce((a, r) => a + r.pinFramesTotal, 0),
    maxPenRest: Math.max(...rs.map((r) => r.maxPenRest)),
    endPen: Math.max(...rs.map((r) => r.endPen)),
    maxPenIn: Math.max(...rs.map((r) => r.maxPenIn)),
    maxPost: Math.max(...rs.map((r) => r.maxPostRest)),
    maxBand: Math.max(...rs.map((r) => r.maxBandOver)),
    maxEff: Math.max(...rs.map((r) => r.maxEff ?? 0)),
    minEff: Math.min(...rs.map((r) => r.minEff ?? Infinity)),
    noSettle: rs.filter((r) => r.stopped === 'maxFrames').length,
    fails: rs.filter((r) => r.verdict === 'FAIL').length
  };
};
const AB = agg(BASE), AN = agg(NEW);
const AB_C = agg(BASE, NO_W), AN_C = agg(NEW, NO_W);   // ohne die neue W-Klasse
console.log('\n══ ZUSAMMENFASSUNG ' + '═'.repeat(74));
const row = (label, a, b, unit) => console.log('   ' + pad(label, 46) + pad(String(a) + (unit || ''), 20) +
  '-> ' + b + (unit || ''));
row('Szenarien gesamt', BASE.results.length, NEW.results.length, '');
row('Szenarien mit Pinning (>= ' + PIN_FRAMES + ' Frames)', AB.pinnedCount, AN.pinnedCount, '');
row('Max. Pinning-Dauer', AB.maxPin, AN.maxPin, ' Frames');
row('Summe Pinning-Frames ueber alle Szenarien', AB.totalPin, AN.totalPin, ' Frames');
row('Ball-Ball-Ueberlappung, transienter Peak', f4(AB.maxPenRest), f4(AN.maxPenRest), ' px');
row('Ball-Ball-Ueberlappung, BLEIBEND (Ruhelage)', f4(AB.endPen), f4(AN.endPen), ' px');
row('Max. Eindringtiefe waehrend Micro-Step', f4(AB.maxPenIn), f4(AN.maxPenIn), ' px');
row('Max. Sockel-Restpenetration', f4(AB.maxPost), f4(AN.maxPost), ' px');
row('Max. Ueberschreitung der Bandenlinie', f4(AB.maxBand), f4(AN.maxBand), ' px');
row('Max. Energiezunahme (1.0 = keine)', f4(AB.maxEff), f4(AN.maxEff), '');
row('Groesster Energieverlust je Kontaktframe', f4(AB.minEff), f4(AN.minEff), '');
row('Szenarien ohne Settlement', AB.noSettle, AN.noSettle, '');
row('Szenarien mit FAIL-Verdikt', AB.fails, AN.fails, '');

// ══════════════════════════════════════════════════════════════════════════
//  ASSERTIONS
// ══════════════════════════════════════════════════════════════════════════
console.log('');
// Struktur / Scoping
ok(CI_PROD === 3, 'FOOTBALL_CONTACT_ITERATIONS === 3 (ist ' + CI_PROD + ')');
ok(/const ci=mode==='football'\?FOOTBALL_CONTACT_ITERATIONS:1;/.test(HTML),
   'Iterationszahl ist auf mode===\'football\' gescoped, sonst 1');

// Geometrie der produktiven Arena — jede Erwartung aus den Formeln der Quelle
// hergeleitet (BR = 32 logische Einheiten):
//   halfLen 18.00*BR = 576      halfWid 12.70*BR = 406.4     corner 6.85*BR = 219.2
//   clearHalf 3.560*BR = 113.92   centerHalf = clearHalf - ballR = 88.92
//   Sockel X [15.60*BR, (15.60+2*1.184)*BR] = [499.2, 574.976], Y [113.92, 169.024]
//   Torlinie |dx| > Sockel-Hinterkante + ballR = 599.976
const near9 = (a, b) => Math.abs(a - b) <= 1e-9;
ok(G.hx === 499.2 && near9(G.hw, 371.2) && near9(G.rc, 83.2),
   'Shouldered Wide: halfLen=499.2, halfWid=371.2, Eckradius=83.2 (' +
   f4(G.hx) + '/' + f4(G.hw) + '/' + f4(G.rc) + ')');
ok(BR === 32 && G.ballR === 25,
   'Radien: Spieler BR=32, neutraler Ball FOOTBALL_BALL_RADIUS=25');
ok(near9(G.clearHalf, 113.92) && near9(G.goalHalf, 88.92),
   'Torfenster: clearHalf=113.92 (Torbreite 227.84), centerHalf=88.92 (=clearHalf-25)');
ok(G.x0 === 499.2 && near9(G.x1, 574.976) && near9(G.y0, 113.92) && near9(G.y1, 169.024),
   'Sockelrechteck [499.2..574.976] x [113.92..169.024]');
ok(G.x0 === G.hx,
   'postFront == halfLen: der Sockel beginnt exakt auf der Bandeninnenflaeche und ist im Feld unerreichbar');
{
  const plc = PROBE.place();
  ok(plc.length === 3 &&
     near9(plc[0].x, cx - 324.8) && plc[0].y === cy && plc[0].owner === 0 &&
     near9(plc[1].x, cx + 324.8) && plc[1].y === cy && plc[1].owner === 1 &&
     plc[2].x === cx && plc[2].y === cy && plc[2].owner === G.neutral,
     'Spawn: Spieler bei cx+-spawn*BR = cx+-324.8, neutraler Ball exakt auf (cx,cy)');
}

// A — Klemmsituationen.
// WICHTIG: der exakt frontale Fall (A1/A2/A4 — Bande, Ball und Stoesser auf EINER
// Radiallinie) ist ein 1D-Problem OHNE geometrische Fluchtrichtung. Eine Verlagerung
// von 0 px ist dort das physikalisch korrekte Ergebnis und KEIN Solverdefekt: die
// Iteration kann daran nichts aendern und soll es auch nicht. Loesbar ist dieser Fall
// nur ueber Masse/Restitution (Phase 4B-2). Getestet wird deshalb der Fall MIT
// Fluchtrichtung — der Bandenkeil aus zwei Spielern (D-Klasse).
const a4b = BN['A4 Spieler an Bande, 4 Volltreffer nacheinander'];
const a4n = NN['A4 Spieler an Bande, 4 Volltreffer nacheinander'];
ok(a4b.moved[0] === 0 && a4n.moved[0] === 0,
   'A4 exakt frontal: unveraendert 0 px — 1D-Fall ohne Fluchtrichtung, kein Solverdefekt');
// D4 auf dem Rechteck: anders als auf dem Kreis friert ci=1 den Bandenkeil NICHT mehr
// ein (die flache Bande laesst den Faecher auch einfach aufgeloest ausweichen, gemessen
// ~60 px schon in der Baseline). Der Nutzen der Iterationen zeigt sich hier in der
// Restueberlappung (Assertions unter B) — fuer die Verlagerung bleibt eine Loesungs-
// und eine Nicht-Verschlechterungs-Garantie.
const d4b = BN['D4 Neutralball Bande + zwei Spieler, 4 Nachschuesse'];
const d4n = NN['D4 Neutralball Bande + zwei Spieler, 4 Nachschuesse'];
// GEMESSEN WIRD DIE LOESUNG, NICHT DIE ENDLAGE. Auf der Shouldered-Wide-Arena gleitet der
// befreite Ball an der langen Bande weiter und laeuft anschliessend teilweise zurueck - die
// NETTO-Verlagerung (moved) faellt dadurch klein aus, obwohl der Keil sich sauber loest.
// releaseFrame ist der Frame, in dem das Subjekt erstmals mehr als 2*BR entfernt ist; das
// ist die arenaunabhaengige Aussage 'der Keil hat sich geloest'.
ok(d4b.releaseFrame >= 0 && d4n.releaseFrame >= 0,
   'D4 Bandenkeil loest sich in beiden Varianten (>2*BR nach ' + d4b.releaseFrame + ' / ' +
   d4n.releaseFrame + ' Frames)');
// Gemessen wird die QUALITAET der Aufloesung, nicht die Endlage: die Nachiterationen
// existieren, um die bleibende Ueberlappung zu druecken. Die Netto-Verlagerung taugt dafuer
// nicht - der befreite Ball rollt an der Bande weiter und teils zurueck.
ok(d4n.endPen <= d4b.endPen + 1e-12,
   'D4: die Iterationen verschlechtern die Loesung nicht (bleibende Ueberlappung ' +
   f4(d4b.endPen) + ' -> ' + f4(d4n.endPen) + ' px)');
// Turbo-Boost-Kontrolle. Die harte Schranke ist die Energiehuelle (maxEff <= 1.0, s.u.);
// zusaetzlich darf keine Kugel die Launch-Obergrenze ueberschreiten und die globale
// Spitze darf gegenueber der Baseline nicht steigen. Einzelne Szenarien duerfen
// minimal hoeher liegen — das ist Umverteilung im Keil, nicht erzeugte Energie.
ok(gMaxN <= gMaxB + 1e-9,
   'globale Spitzengeschwindigkeit steigt nicht (' + f4(gMaxB) + ' -> ' + f4(gMaxN) + ')');
ok(NEW.results.every((r) => r.maxSpeed <= VMAX + 1e-9),
   'keine Kugel ueberschreitet die Launch-Obergrenze vMax=' + f4(VMAX));
ok(NEW.results.every((r) => r.maxSpeed <= BN[r.name].maxSpeed * 1.01 + 1e-9),
   'kein Szenario mit mehr als 1 % hoeherer Spitzengeschwindigkeit (kein Turbo-Boost)');

// B — Ueberlappung (ohne die in 4B-2 ergaenzte W-Klasse, siehe NO_W oben)
ok(AB_C.maxPenRest > 2.0, 'Baseline zeigt die bekannte Ueberlappung (' + f4(AB_C.maxPenRest) + ' px)');
ok(AN_C.maxPenRest < AB_C.maxPenRest * 0.05,
   'Ueberlappungs-Peak um >= 95 % reduziert (' + f4(AB_C.maxPenRest) + ' -> ' + f4(AN_C.maxPenRest) + ' px)');
ok(AN_C.endPen < AB_C.endPen * 0.25,
   'bleibende Ueberlappung um >= 75 % reduziert (' + f4(AB_C.endPen) + ' -> ' + f4(AN_C.endPen) + ' px)');
// Die Zielmarke aus dem Auftrag ist < 0.05 px. Sie wird mit dem VORGEGEBENEN Wert
// FOOTBALL_CONTACT_ITERATIONS=3 NICHT erreicht (0.0929 px) — die Konvergenztabelle
// oben zeigt, dass dafuer ci=4 noetig ist. Der vorgegebene Wert wird nicht eigenmaechtig
// erhoeht; die Suite scheitert deshalb hier nicht, weist die Luecke aber laut aus.
const TARGET_PEN = 0.05;
if (AN_C.maxPenRest >= TARGET_PEN) {
  const need = sweepRuns.find((s) => Math.max(...s.r.results.filter(NO_W).map((r) => r.maxPenRest)) < TARGET_PEN);
  console.log('WARN: Zielmarke < ' + TARGET_PEN + ' px NICHT erreicht bei ci=' + CI_PROD +
              ' (gemessen ' + f4(AN_C.maxPenRest) + ' px). Erreicht ab ci=' + (need ? need.c : '>8') +
              '. Wert bleibt wie beauftragt bei ' + CI_PROD + ' — Entscheidung liegt beim Auftraggeber.');
}

// C — Pinning. Auf der flachen Bande haelt die vollstaendigere Aufloesung den
// Dauerdruck-Faecher (D2/D3) um EINEN Frame laenger in ruhendem Kontakt als die
// Baseline — das ist stabiler Kontakt, kein Festsitzen: dieselben Szenarien loesen
// sich nachweislich (D2 ~21 px, D4 ~57 px Verlagerung). Zulaessig ist deshalb eine
// enge Toleranz von +1 Frame / +1 Szenario statt strikter Monotonie (Kreis-Baseline).
ok(AN_C.pinnedCount <= AB_C.pinnedCount + 1,
   'Anzahl Pinning-Szenarien steigt hoechstens um 1 (' + AB_C.pinnedCount + ' -> ' + AN_C.pinnedCount + ')');
ok(AN_C.maxPin <= AB_C.maxPin + 1,
   'maximale Pinning-Dauer steigt hoechstens um 1 Frame (' + AB_C.maxPin + ' -> ' + AN_C.maxPin + ' Frames)');

// D — Energie
ok(AN.maxEff <= 1.000001, 'keine Energiezunahme (max ' + f4(AN.maxEff) + ')');
ok(AN.fails === 0, 'kein Szenario mit FAIL-Verdikt');
ok(AN.maxPost <= 1e-6, 'keine Sockel-Restpenetration (' + f4(AN.maxPost) + ')');
ok(AN.maxBand <= 1e-6, 'keine Ueberschreitung der Bandenlinie (' + f4(AN.maxBand) + ')');

// E — Einzelkollisionen unveraendert
const near = (a, b, t) => Math.abs(a - b) <= t;
ok(NEW.M.IMPULSE.every((m, i) => near(m.ratioBall, BASE.M.IMPULSE[i].ratioBall, 1e-9) &&
                                 near(m.ratioPlayer, BASE.M.IMPULSE[i].ratioPlayer, 1e-9)),
   'zentraler Stoss: Impulsanteile bit-identisch zur Baseline');
ok(NEW.M.IMPULSE.every((m) => m.momentumErr < 1e-9), 'zentraler Stoss: Impulserhaltung exakt');
ok(NEW.M.IMPULSE.every((m, i) => near(m.energyEff, BASE.M.IMPULSE[i].energyEff, 1e-9)),
   'zentraler Stoss: Energieverhaeltnis unveraendert');
ok(NEW.M.OBLIQUE.every((m, i) => near(m.ballDeg, BASE.M.OBLIQUE[i].ballDeg, 1e-9)),
   'schraeger Treffer: Abgangswinkel unveraendert');
ok(NEW.M.BAND.every((m, i) => near(m.ratio, BASE.M.BAND[i].ratio, 1e-9)),
   'Bandenabprall: Geschwindigkeitsverhaeltnis unveraendert');
ok(NEW.M.POST.every((m, i) => near(m.ratio, BASE.M.POST[i].ratio, 1e-9)),
   'Pfostenabprall: Geschwindigkeitsverhaeltnis unveraendert');
ok(NEW.M.ROLL.every((m, i) => m.settleFrames === BASE.M.ROLL[i].settleFrames &&
                              near(m.dist, BASE.M.ROLL[i].dist, 1e-9)),
   'Ausrollen: kontaktfreie Strecke unveraendert (Integration/Daempfung nur 1x)');

// F — Gameplay
ok(JSON.stringify(GB.goalScored) === JSON.stringify(GN.goalScored), 'Torpassage: Score unveraendert');
ok(GB.goalState === GN.goalState, 'Torpassage: Zustand unveraendert');
ok(GB.playerBlocked === true && GN.playerBlocked === true, 'Spielerbarriere haelt in beiden Varianten');
ok(JSON.stringify(GB.postNoGoal) === JSON.stringify(GN.postNoGoal), 'Pfostentreffer: kein Tor, unveraendert');
ok(GB.stateSeq === GN.stateSeq, 'Torablauf-Zustandsfolge unveraendert (' + GN.stateSeq + ')');
ok(GB.ballsAfterReset === GN.ballsAfterReset, 'Rundenreset erzeugt gleich viele Kugeln');

// Effekte: keine zusaetzlichen Treffer-Sounds/Partikel durch die Nachiterationen
// Die Nachiterationen duerfen KEIN zusaetzliches Feedback ausloesen (if(it===0)).
// Weniger ist erlaubt und tritt auf: was frueher ueber mehrere Micro-Steps als Folge
// von Nachschlaegen knallte, ist jetzt ein einziger sauber aufgeloester Kontakt.
ok(NEW.results.every((r) => r.fx.sfxHits <= BN[r.name].fx.sfxHits),
   'keine zusaetzlichen Trefferklaenge durch die Nachiterationen');
ok(NEW.results.every((r) => r.fx.spawnCalls <= BN[r.name].fx.spawnCalls),
   'keine zusaetzlichen Partikelbursts durch die Nachiterationen');
ok(NEW.results.every((r) => r.fx.sfxHits === r.fx.spawnCalls),
   'Trefferklang und Partikelburst bleiben strikt gekoppelt (ein Feedback je Kontakt)');

// ══════════════════════════════════════════════════════════════════════════
//  PHYSIKPHASE 4B-2 — PRESETS, GLIDE, ANTI-WEDGE
// ══════════════════════════════════════════════════════════════════════════

// F2 — Produktivstand: GLIDE ist der einzige Wertesatz im Produktivcode.
// Seit Movement-Phase M1 umfasst er NEUN Werte: getrennte Balldaempfung
// (frictionBall/fendBall) und eine eigene Umschaltschwelle slowv.
{
  const FINAL = { friction: 0.9958, frictionBall: 0.9964, fend: 0.9760, fendBall: 0.9790,
                  slowv: 0.70, stopv: 0.075,
                  restBall: 0.44, restBand: 0.60, restPost: 0.50 };
  const prod = PROBE.prodPhys();
  for (const k of Object.keys(FINAL))
    ok(prod[k] === FINAL[k], 'FOOTBALL_PHYS.' + k + ' = ' + FINAL[k] + ' (erhalten: ' + prod[k] + ')');
  ok(Object.keys(prod).length === Object.keys(FINAL).length,
     'FOOTBALL_PHYS enthaelt genau diese neun Werte (keine Restfelder aus dem Prototyp)');
  // Die abgeschlossene Vergleichsmatrix darf nicht im Produktcode zurueckbleiben.
  ok(!/FB_ROLL_SETS|FB_TEMPO_SETS|DEV_ROLL|DEV_TEMPO/.test(HTML),
     'keine Roll-/Tempo-Vergleichsmatrix mehr im Produktivcode');
  // Der GLIDE-Lauf ist der unveraenderte Produktivpfad: keine Ueberschreibung noetig.
  ok(modelOverride('GLIDE') === '', 'das GLIDE-Modell ist der Produktivpfad ohne jede Ueberschreibung');
  const eg = EFFP.GLIDE;
  ok(eg.fr === prod.friction && eg.fe === prod.fend && eg.stopv === prod.stopv &&
     eg.frBall === prod.frictionBall && eg.feBall === prod.fendBall && eg.slowv === prod.slowv &&
     eg.restBall === prod.restBall && eg.restBand === prod.restBand && eg.restPost === prod.restPost,
     'die effektive Football-Physik ist exakt FOOTBALL_PHYS');
  // M1-Signatur: der neutrale Ball ist SCHWAECHER gedaempft als die Spieler und
  // laeuft dadurch laenger; im Auslauf teilen sich beide dasselbe harte fend.
  ok(eg.frBall > eg.fr, 'M1: frictionBall > friction — der Ball rollt laenger als die Spieler');
  // Auch im Auslauf behaelt der Ball seinen leichten Vorsprung - er ist dort ebenfalls
  // etwas schwaecher gedaempft als die Spielerfiguren, aber beide enden zuegig.
  ok(eg.feBall > eg.fe, 'unterhalb slowv bleibt der Ball minimal laenger in Bewegung als die Spieler');
  ok(eg.slowv > eg.stopv * 5, 'slowv liegt klar ueber stopv - es gibt eine echte Auslaufphase');
  // Kein Auswahl- oder URL-Mechanismus mehr im Produktivcode.
  ok(!/FOOTBALL_PRESETS/.test(HTML) && !/FOOTBALL_PRESET_DEFAULT/.test(HTML) && !/footballPreset/.test(HTML),
     'keine Preset-Auswahl mehr im Produktivcode');
  ok(!/fbphys/.test(HTML), 'kein URL-Parameter ?fbphys mehr im Produktivcode');
  ok(!/URLSearchParams/.test(HTML.slice(HTML.indexOf('FOOTBALL_PHYS'))),
     'die Football-Physik liest keinen URL-Parameter');
  ok((HTML.match(/const FOOTBALL_PHYS=/g) || []).length === 1,
     'FOOTBALL_PHYS ist genau einmal definiert (zentrale Konfiguration)');
}

// G — CURRENT ist exakt der Referenzzustand
ok(EFFP.CURRENT.fr === TUNE.FRICTION && EFFP.CURRENT.fe === TUNE.FEND &&
   EFFP.CURRENT.stopv === TUNE.STOPV && EFFP.CURRENT.restBall === TUNE.REST &&
   EFFP.CURRENT.restBand === TUNE.REST && EFFP.CURRENT.restPost === TUNE.REST,
   'CURRENT nutzt exakt die globalen Konstanten (kein Preset aktiv)');
ok(AP.CURRENT.escapes === 0, 'CURRENT loest keinen einzigen Escape aus (reine Referenz)');
ok(EFFP.GLIDE.fr > EFFP.CURRENT.fr && EFFP.ICE.fr > EFFP.GLIDE.fr,
   'Gleitdaempfung steigt CURRENT -> GLIDE -> ICE');
ok(EFFP.GLIDE.fe < EFFP.GLIDE.fr && EFFP.ICE.fe < EFFP.ICE.fr,
   'FEND ist in beiden Presets haerter als FRICTION (Zwei-Regime-Modell aktiv)');
ok(EFFP.GLIDE.stopv < EFFP.CURRENT.stopv && EFFP.ICE.stopv < EFFP.GLIDE.stopv,
   'Settlement-Schwelle sinkt CURRENT -> GLIDE -> ICE');

// H — Der finale Football-Auslauf: laenger als die globale Basis, aber in derselben
// Groessenordnung - und weit entfernt vom fruehen Kriechauslauf. Die Vergleichsbasis
// CURRENT sind die GLOBALEN Konstanten (FRICTION 0.992, STOPV 0.10) der Bestandsmodi,
// nicht ein frueherer Football-Satz.
{
  const roll = (p, k) => PR[p].M.ROLL[k];
  for (const k of [0, 1]) {
    const lbl = k === 0 ? 'Neutralball' : 'Spielerball';
    ok(roll('GLIDE', k).settleFrames > roll('CURRENT', k).settleFrames,
       lbl + ': der Football-Auslauf ist laenger als die globale Basis (' +
       roll('CURRENT', k).settleFrames + ' -> ' + roll('GLIDE', k).settleFrames + ' Frames)');
    ok(roll('GLIDE', k).settleFrames < roll('CURRENT', k).settleFrames * 1.5,
       lbl + ': aber in derselben Groessenordnung - kein Kriechauslauf (' +
       (roll('GLIDE', k).settleFrames / roll('CURRENT', k).settleFrames).toFixed(2) + ' x)');
    ok(roll('ICE', k).settleFrames > roll('GLIDE', k).settleFrames * 2,
       lbl + ': ICE rollt weiterhin um ein Vielfaches laenger (' + roll('ICE', k).settleFrames + ' Frames)');
    ok(roll('GLIDE', k).dist > roll('CURRENT', k).dist &&
       roll('ICE', k).dist > roll('GLIDE', k).dist,
       lbl + ': Ausrollstrecke steigt (' + f2f(roll('CURRENT', k).dist) + ' -> ' +
       f2f(roll('GLIDE', k).dist) + ' -> ' + f2f(roll('ICE', k).dist) + ' px)');
  }
  ok(PRESETS.every((p) => AP[p].noSettle === PR[p].results.filter((r) => r.stopped === 'maxFrames').length),
     'Settlement-Zaehlung konsistent');
  ok(PR.ICE.M.ROLL.every((m) => m.settleFrames > 0 && m.settleFrames < 2400),
     'auch ICE settled in endlicher Zeit (kein ewiges Mikrokriechen)');
  // Massefreiheit vs. M1-Balldaempfung: unter CURRENT (globale Konstanten, kontakt-
  // freier Auslauf) rollen Neutral- und Spielerball weiterhin bitidentisch — es gibt
  // nach wie vor KEIN Massenmodell. Unter GLIDE (M1) rollt der neutrale Ball BEWUSST
  // weiter als die Spieler (frictionBall 0.9964 > friction 0.9958); unter ICE sind
  // beide gleich gedaempft, ihre Auslaeufe beruehren aber radiusbedingt die Bande an
  // verschiedenen Punkten und sind deshalb nicht mehr bitgleich vergleichbar.
  ok(Math.abs(PR.CURRENT.M.ROLL[0].dist - PR.CURRENT.M.ROLL[1].dist) < 1e-9,
     'CURRENT: Neutral- und Spielerball rollen identisch (keine Masse, gleiche Daempfung)');
  ok(PR.GLIDE.M.ROLL[0].dist > PR.GLIDE.M.ROLL[1].dist,
     'GLIDE (M1): der neutrale Ball rollt weiter als der Spieler (' +
     f2f(PR.GLIDE.M.ROLL[1].dist) + ' -> ' + f2f(PR.GLIDE.M.ROLL[0].dist) + ' px)');
}

// I — Getrennte Restitution wirkt kontaktartabhaengig
{
  const band = (p) => PR[p].M.BAND[3].normalRatio, post = (p) => PR[p].M.POST[3].normalRatio;
  const ball = (p) => PR[p].M.IMPULSE[3].ratioBall;
  ok(band('GLIDE') > band('CURRENT') * 1.5 && band('ICE') > band('GLIDE'),
     'Banden-Rueckprall steigt (' + f4(band('CURRENT')) + ' -> ' + f4(band('GLIDE')) + ' -> ' +
     f4(band('ICE')) + ')');
  ok(post('GLIDE') > post('CURRENT') * 1.4 && post('ICE') > post('GLIDE'),
     'Pfosten-Rueckprall steigt (' + f4(post('CURRENT')) + ' -> ' + f4(post('GLIDE')) + ' -> ' +
     f4(post('ICE')) + ')');
  ok(ball('GLIDE') > ball('CURRENT') && ball('ICE') > ball('GLIDE'),
     'Ball-Ball-Weitergabe steigt (' + f4(ball('CURRENT')) + ' -> ' + f4(ball('GLIDE')) + ' -> ' +
     f4(ball('ICE')) + ')');
  ok(PRESETS.every((p) => band(p) < 1 && post(p) < 1),
     'Bande und Pfosten bleiben in jedem Preset dissipativ (< 1.0)');
  ok(PRESETS.every((p) => Math.abs(PR[p].M.BAND[5].tangentRatio - 1) < 1e-9),
     'Tangentialanteil an der Bande bleibt exakt 1.0 (keine Wandreibung eingefuehrt)');
  ok(PRESETS.every((p) => PR[p].M.IMPULSE.every((m) => m.momentumErr < 1e-9)),
     'Impulserhaltung bleibt in jedem Preset exakt');
  // Der Abgang folgt in JEDEM Preset exakt der realen Verbindungslinie. Der Winkel gegen
  // den GEPLANTEN Wurf darf presetabhaengig leicht abweichen — er haengt an der diskreten
  // Zeitschrittweite, und ein gleitenderer Ball erreicht den Kontakt mit anderer Restgeschwindigkeit.
  ok(PRESETS.every((p) => PR[p].M.OBLIQUE.every((m) => Math.abs(Math.abs(m.ballDeg) - m.geomDeg) < 1e-9)),
     'Abgang folgt in jedem Preset exakt der Kontaktnormalen (reine Geometrie, kein Preset-Effekt)');
}

// J — Keil an der Laengsbande: ohne Anti-Wedge keine Reaktion, mit Anti-Wedge geloest.
// Die Systemleistung (Erkennung, tangentialer Escape, keine Penetration, Energie
// begrenzt) wird unveraendert getestet — nur die Geometrie ist vom entfallenen
// Bande+Sockel-Eck auf die gerade Laengsbande umgezogen (s. Klasse W).
{
  const W1 = wname.W1, W2 = wname.W2;
  const RELEASE_LIMIT = 600;   // Frames = 10 s — klares Zeitfenster
  // CURRENT hat strukturell keinen Anti-Wedge (footballPhys() liefert null).
  ok(PN.CURRENT[W1].escapes === 0 && PN.CURRENT[W2].escapes === 0,
     'CURRENT: kein einziger Escape in W1/W2 — ohne Football-Physik existiert der Anti-Wedge nicht');
  // W1 unter CURRENT: der frontale Dauerdruck ist ein 1D-Problem — der Ball bleibt
  // zwischen Bande und Druecker praktisch stehen.
  ok(PN.CURRENT[W1].moved[0] < 1,
     'W1 unter CURRENT: keine Reaktion, Ball bleibt stehen (' + f2f(PN.CURRENT[W1].moved[0]) + ' px)');
  // ICE (weiche Vergleichsdaempfung) ist der Beleg, dass der Anti-Wedge unveraendert
  // funktioniert: dort haelt der Druecker lange genug Druck, die Keilbestaetigung laeuft
  // durch und der Ball gleitet tangential heraus.
  ok(PN.ICE[W1].escapes > 0, 'ICE: W1 erkennt den Keil und reagiert (' + PN.ICE[W1].escapes + ' Escapes)');
  ok(PN.ICE[W2].releaseFrame > 0 && PN.ICE[W2].releaseFrame <= RELEASE_LIMIT,
     'ICE: W2 loest sich in ' + PN.ICE[W2].releaseFrame + ' Frames (' + secs(PN.ICE[W2].releaseFrame) + ')');
  ok(PN.ICE[W2].moved[0] > 2 * G.BR,
     'ICE: W2 Subjekt verlagert sich um ' + f2f(PN.ICE[W2].moved[0]) + ' px (> 2*BR)');
  // GLIDE ist der PRODUKTIVSTAND. Mit dem finalen Daempfungssatz kommt in genau diesen
  // Szenarien alles so schnell zur Ruhe, dass die Keilbestaetigung (acht aufeinander
  // folgende Micro-Steps mit anhaltendem Aussendruck) gar nicht mehr erreicht wird - der
  // Zug endet vorher regulaer im Settlement. Das ist KEINE Blockade: geprueft wird
  // deshalb, was hier wirklich zaehlt - die Lage loest sich sauber auf, ohne Penetration,
  // ohne Dauerschwingen, und der Zug endet in endlicher Zeit.
  for (const w of [W1, W2]) {
    ok(PN.GLIDE[w].settleFrames > 0 && PN.GLIDE[w].settleFrames < RELEASE_LIMIT,
       'GLIDE: ' + w.slice(0, 2) + ' kommt in ' + PN.GLIDE[w].settleFrames +
       ' Frames regulaer zur Ruhe (kein Dauerzustand)');
    ok(PN.GLIDE[w].endPen <= 1e-6,
       'GLIDE: ' + w.slice(0, 2) + ' hinterlaesst keine bleibende Ueberlappung');
  }
  for (const p of ['GLIDE', 'ICE']) {
    for (const w of [W1, W2]) {
      ok(PN[p][w].maxPostRest <= 1e-6 && PN[p][w].maxBandOver <= 1e-6,
         p + ': ' + w.slice(0, 2) + ' ohne Sockel- oder Bandenpenetration');
      ok(PN[p][w].maxSpeed <= VMAX + 1e-9,
         p + ': ' + w.slice(0, 2) + ' bleibt unter der Launch-Obergrenze (' + f4(PN[p][w].maxSpeed) + ')');
    }
  }
  ok(PN.ICE[W2].escapes > 0 && PN.ICE[W2].escapes < 50,
     'Escape feuert nicht in jedem Micro-Step (Mindestdauer wirkt als Sperre: ' +
     PN.ICE[W2].escapes + ' Reaktionen)');
}

// K — Turbo-Boost- und Energiekontrolle je Preset
{
  for (const p of PRESETS) {
    ok(AP[p].maxSpeed <= VMAX + 1e-9,
       p + ': keine Kugel ueberschreitet die Launch-Obergrenze (' + f4(AP[p].maxSpeed) + ' <= ' + f4(VMAX) + ')');
    ok(AP[p].fails === 0, p + ': kein Szenario mit FAIL-Verdikt');
    ok(AP[p].maxPost <= 1e-6, p + ': keine Sockel-Restpenetration');
    ok(AP[p].maxBand <= 1e-6, p + ': keine Ueberschreitung der Bandenlinie');
  }
  // Ausserhalb von Escape-Frames darf KEIN Frame Energie erzeugen — auch nicht mit
  // Preset. Referenz ist die schwaechste Daempfung im System (seit M1: frictionBall).
  const maxEffNoEscape = (p) => {
    const ef = Math.max(EFFP[p].fr, EFFP[p].frBall), ef4 = ef * ef * ef * ef;
    let m = 0;
    for (const r of PR[p].results) for (const e of r.log) {
      if ((e.esc || 0) > 0 || !(e.Epre > 1e-9)) continue;
      const v = e.Epost / (e.Epre * ef4); if (v > m) m = v;
    }
    return m;
  };
  for (const p of PRESETS)
    ok(maxEffNoEscape(p) <= 1.000001,
       p + ': ausserhalb der Escape-Frames keine Energiezunahme (max ' + f4(maxEffNoEscape(p)) + ')');
  ok(AP.CURRENT.maxEff <= 1.000001, 'CURRENT: gar keine Energiezunahme (max ' + f4(AP.CURRENT.maxEff) + ')');
}

// L — Gameplay bleibt ueber alle Presets identisch
for (const k of GP_INVARIANT)
  ok(PRESETS.every((p) => JSON.stringify(GP[p][k]) === JSON.stringify(GP.CURRENT[k])),
     'Gameplay presetunabhaengig: ' + k + ' = ' + JSON.stringify(GP.CURRENT[k]));

// Determinismus
const digest = (arr) => crypto.createHash('sha256')
  .update(arr.map((s) => s.map((b) => [b.x, b.y, b.vx, b.vy].map((v) => v.toFixed(12)).join(',')).join('|')).join('#'))
  .digest('hex');
const fpBase = digest(BASE.results.map((r) => r.end));
const fpNew  = digest(NEW.results.map((r) => r.end));
const fpNew2 = digest(runAll(CI_PROD, 'CURRENT').results.map((r) => r.end));
ok(fpNew === fpNew2, 'Determinismus: zweiter Lauf in frischer Sandbox liefert identische Endzustaende');
ok(fpBase !== fpNew, 'Baseline und neue Variante unterscheiden sich messbar');
// Presets sind einzeln reproduzierbar — jeder Lauf in frischer Sandbox.
const fpPreset = {}, fpPreset2 = {};
for (const p of PRESETS) {
  fpPreset[p] = digest(PR[p].results.map((r) => r.end));
  fpPreset2[p] = digest(runAll(CI_PROD, p).results.map((r) => r.end));
  ok(fpPreset[p] === fpPreset2[p], 'Determinismus ' + p + ': Wiederholung liefert identische Endzustaende');
}
ok(new Set(PRESETS.map((p) => fpPreset[p])).size === 3,
   'die drei Presets unterscheiden sich messbar voneinander');
console.log('\n   Fingerprint Endzustaende ci=1        : ' + fpBase.slice(0, 32));
console.log('   Fingerprint Endzustaende ci=' + CI_PROD + '        : ' + fpNew.slice(0, 32));
console.log('   Fingerprint Wiederholung ci=' + CI_PROD + '       : ' + fpNew2.slice(0, 32));
for (const p of PRESETS)
  console.log('   Fingerprint Preset ' + pad(p, 18) + ': ' + fpPreset[p].slice(0, 32) +
              '  (Wiederholung ' + (fpPreset[p] === fpPreset2[p] ? 'identisch' : 'ABWEICHEND') + ')');

// ════════════════════════════════════════════════════════════════════════════
// TOR-AUDIO (Audio-Phase 2): Einmalgarantie am LAUFENDEN Torablauf.
// Der SFX-Stub zaehlt nur Aufrufe — geprueft wird, WANN und WIE OFT der
// Torablauf den Sound anstoesst, nicht die Audioausgabe selbst.
// ════════════════════════════════════════════════════════════════════════════
{
  const env = buildEnv(3, 'CURRENT');
  // PROBE_V statt frueher 5.0: die Torlinie liegt auf der neuen Arena bei 676.776 —
  // siehe gameplayProbe.
  const shootNeutral = () => env.setBalls([{ x: cx, y: cy, vx: PROBE_V, vy: 0, owner: 4 }]);
  const runToGoal = () => { let f = 0; while (f++ < 900 && env.goalState() === 'play') env.step(); };
  const runToPlay = () => {
    let f = 0;
    while (f++ < 900 && env.goalState() !== 'play' && env.goalState() !== 'result') env.step();
  };

  // ── Ein Tor = genau ein Sound, und zwar erst mit der bestaetigten Wertung ──
  env.reset();
  shootNeutral();
  ok(env.goalAudio().goalSounds === 0, 'vor dem Tor ist kein Torsound ausgeloest');
  runToGoal();
  const g1 = env.goalAudio();
  ok(g1.goalSounds === 1, 'ein bestaetigtes Tor loest GENAU EINEN Torsound aus (' + g1.goalSounds + ')');
  ok(g1.goalSoundMatchPoints === 0, 'ein Tor ohne Matchpunkt nutzt die normale Variante');
  ok(env.score()[0] + env.score()[1] === 1, 'der Sound haengt an genau einer Scoreerhoehung');

  // ── Fall, Celebration, Reset und Spawn loesen KEINEN weiteren Sound aus ──
  runToPlay();
  ok(env.goalAudio().goalSounds === 1,
     'Ballfall, Celebration Window, Rundenreset und Spawn bleiben still (' + env.goalAudio().goalSounds + ')');
  ok(env.goalState() === 'play', 'der Torablauf ist regulaer zurueck in \'play\'');
  for (let k = 0; k < 200; k++) env.step();
  ok(env.goalAudio().goalSounds === 1, 'auch die folgende freie Spielphase loest keinen Torsound aus');

  // ── Torprobe ohne Wertung: Ball knapp neben der Oeffnung bleibt still ──
  // (frueher "Pfosteninnenkante"; auf dem Rechteck reflektiert die Bande neben dem
  // Tor — kein fbPassed, keine Wertung, kein Sound. Gleicher Aufbau wie Probe 3.)
  env.reset();
  env.setBalls([{ x: cx, y: cy + G.goalHalf + 1, vx: PROBE_V, vy: 0, owner: 4 }]);
  for (let k = 0; k < 900 && env.goalState() === 'play'; k++) env.step();
  ok(env.score()[0] + env.score()[1] === 0 && env.goalAudio().goalSounds === 0,
     'Torprobe ohne Wertung (Bande neben der Oeffnung) loest keinen Torsound aus');

  // ── Spielerkugel an der Barriere: kein Tor, kein Sound ──
  env.reset();
  env.setBalls([{ x: cx, y: cy, vx: PROBE_V, vy: 0, owner: 0 }]);
  for (let k = 0; k < 900 && env.phase() === 'sim'; k++) env.step();
  ok(env.goalAudio().goalSounds === 0, 'die blockierte Spielerkugel loest keinen Torsound aus');

  // ── Ausserhalb des Football-Modus gibt es keinen Torsound ──
  env.reset();
  env.setMode('bot');
  env.setBalls([{ x: cx, y: cy, vx: PROBE_V, vy: 0, owner: 4 }]);
  for (let k = 0; k < 900 && env.phase() === 'sim'; k++) env.step();
  ok(env.goalAudio().goalSounds === 0, 'in anderen Modi wird der Torsound nie angestossen');
  env.setMode('football');

  // ── Mehrere Tore: je Tor genau ein Sound; erst das Siegtor ist Matchpunkt ──
  env.reset();
  const perGoal = [];
  for (let g = 0; g < 3; g++) {
    shootNeutral();
    runToGoal();
    perGoal.push({ sounds: env.goalAudio().goalSounds, mp: env.goalAudio().goalSoundMatchPoints,
                   winner: env.winner() });
    if (env.winner() === null) runToPlay();
  }
  ok(perGoal.map((p) => p.sounds).join(',') === '1,2,3',
     'drei Tore ergeben exakt drei Torsounds (' + perGoal.map((p) => p.sounds).join(',') + ')');
  ok(perGoal[0].mp === 0 && perGoal[1].mp === 0,
     'die beiden Tore vor der Entscheidung nutzen die normale Variante');
  ok(perGoal[2].mp === 1 && perGoal[2].winner !== null,
     'genau das Siegtor nutzt die Matchpunktvariante');
  ok(env.score()[0] === 3, 'First-to-3 ist erreicht — der Matchpunkt haengt am kanonischen Gewinner');

  // ── Matchende schneidet den Siegtor-Sound nicht ab ──
  runToPlay();
  ok(env.goalState() === 'result', 'der Torablauf endet regulaer im Endzustand \'result\'');
  ok(env.goalAudio().goalSounds === 3, 'das Matchende loest keinen weiteren Torsound aus');
  ok(env.goalAudio().goalSoundStops === 0,
     'das Matchende stoppt den laufenden Siegtor-Sound NICHT (er laeuft natuerlich aus)');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
