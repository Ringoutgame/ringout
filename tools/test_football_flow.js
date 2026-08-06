// Arena Football — Spielfluss-, Impuls- und Anti-Pinning-MESSHARNESS.
//
// Phase 4A: Audit + Baseline.
// Phase 4B-1: A/B-Abnahme der iterativen Kontaktaufloesung.
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
const consts             = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const spin               = grab(/const SPIN_K=[^\n]*/, 'spin constants');
const pcols              = grab(/const PCOLS=[^\n]*/, 'PCOLS');
const mkBallSrc          = grab(/function mkBall\([^\n]*/, 'mkBall');
const placeBallsSrc      = grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls');
const teamCapSrc         = grab(/function teamCap\([^\n]*/, 'teamCap');
const ballsOutsideSrc    = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const stepSimSrc         = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const goalNeutralOwnerSrc= grab(/const FOOTBALL_NEUTRAL_OWNER=[^\n]*/, 'FOOTBALL_NEUTRAL_OWNER');
const postInnerSrc       = grab(/const FOOTBALL_POST_INNER=[^\n]*/, 'FOOTBALL_POST_INNER');
const postOuterSrc       = grab(/const FOOTBALL_POST_OUTER=[^\n]*/, 'FOOTBALL_POST_OUTER');
const postFrontSrc       = grab(/const FOOTBALL_POST_FRONT=[^\n]*/, 'FOOTBALL_POST_FRONT');
const postBackSrc        = grab(/const FOOTBALL_POST_BACK=[^\n]*/, 'FOOTBALL_POST_BACK');
const contactIterSrc     = grab(/const FOOTBALL_CONTACT_ITERATIONS=[^\n]*/, 'FOOTBALL_CONTACT_ITERATIONS');
// Physikphase 4B-3: EIN produktiver Football-Physikstandard, getrennte Restitution,
// Daempfung/Settlement, Anti-Wedge. Der Block wird unveraendert uebernommen.
const presetSrc          = grab(/const FOOTBALL_PHYS=\{[\s\S]*?\nfunction curRestPost\(\)[^\n]*/, 'FOOTBALL_PHYS block');
const curFRSrc           = grab(/function curFR\(\)[^\n]*/, 'curFR');
const curFESrc           = grab(/function curFE\(\)[^\n]*/, 'curFE');
const curSTSrc           = grab(/function curST\(\)[^\n]*/, 'curST');
const postProbeSrc       = grab(/function footballPostProbe\(b\)\{[\s\S]*?\n\}/, 'footballPostProbe');
const wedgeSrc           = grab(/const FOOTBALL_WEDGE_MIN_CONTACTS=[\s\S]*?\nfunction footballEscape\(b,cs\)\{[\s\S]*?\n\}/, 'wedge block');
const goalClearHalfSrc   = grab(/function footballGoalClearHalf\([^\n]*/, 'footballGoalClearHalf');
const goalCenterHalfSrc  = grab(/function footballGoalCenterHalf\([^\n]*/, 'footballGoalCenterHalf');
const goalCanPassSrc     = grab(/function footballCanPassGoal\(b\)\{[\s\S]*?\n\}/, 'footballCanPassGoal');
const resolvePostSrc     = grab(/function footballResolvePost\(b\)\{[\s\S]*?\n\}/, 'footballResolvePost');
const fallTicksSrc       = grab(/const FOOTBALL_GOAL_FALL_TICKS=[^\n]*/, 'FOOTBALL_GOAL_FALL_TICKS');
const spawnTicksSrc      = grab(/const FOOTBALL_GOAL_SPAWN_TICKS=[^\n]*/, 'FOOTBALL_GOAL_SPAWN_TICKS');
const spawnHeightSrc     = grab(/function footballSpawnHeight\([^\n]*/, 'footballSpawnHeight');
const goalBusySrc        = grab(/function footballGoalBusy\([^\n]*/, 'footballGoalBusy');
const goalSideSrc        = grab(/function footballGoalSide\(b\)\{[\s\S]*?\n\}/, 'footballGoalSide');
const freezeSrc          = grab(/function footballFreezePlayers\(\)\{[\s\S]*?\n\}/, 'footballFreezePlayers');
const tryGoalSrc         = grab(/function footballTryGoal\(b\)\{[\s\S]*?\n\}/, 'footballTryGoal');
const resetRoundSrc      = grab(/function footballResetRound\(\)\{[\s\S]*?\n\}/, 'footballResetRound');
const tickGoalSrc        = grab(/function footballTickGoal\(\)\{[\s\S]*?\n\}/, 'footballTickGoal');
const winScoreSrc        = grab(/const FOOTBALL_WIN_SCORE=[^\n]*/, 'FOOTBALL_WIN_SCORE');
const winnerVarSrc       = grab(/let footballWinner=[^\n]*/, 'footballWinner');
const matchEndSrc        = grab(/function footballMatchEnd\(\)\{[\s\S]*?\n\}/, 'footballMatchEnd');
const resetMatchStateSrc = grab(/function footballResetMatchState\([^\n]*/, 'footballResetMatchState');
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
//    GLIDE   -> keine Ueberschreibung, exakt der Produktivpfad
//    CURRENT -> footballPhys() liefert null, also der Codepfad vor 4B-2 (auch ohne Anti-Wedge)
//    ICE     -> footballPhys() liefert den testinternen ICE-Wertesatz
const MODEL_ICE = { friction: 0.9985, fend: 0.9955, stopv: 0.018,
                    restBall: 0.48, restBand: 0.62, restPost: 0.52 };
const MODELS = ['CURRENT', 'GLIDE', 'ICE'];
function modelOverride(model) {
  if (model === 'CURRENT') return 'footballPhys=function(){return null;};';
  if (model === 'ICE') return 'const MODEL_ICE=' + JSON.stringify(MODEL_ICE) + ';' +
                              'footballPhys=function(){return mode===\'football\'?MODEL_ICE:null;};';
  return '';   // GLIDE = Produktivstand, keine Ueberschreibung
}

function buildEnv(ci, preset) {
  const iterLine = ci == null ? contactIterSrc : 'const FOOTBALL_CONTACT_ITERATIONS=' + ci + ';';
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
    let sfxHits=0, spawnCalls=0;
    const SFX={hit(){sfxHits++;},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){}};
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
    ${goalNeutralOwnerSrc}
    ${postInnerSrc}
    ${postOuterSrc}
    ${postFrontSrc}
    ${postBackSrc}
    ${iterLine}
    ${presetSrc}
    ${modelOverride(preset || 'GLIDE')}
    const __model=${JSON.stringify(preset || 'GLIDE')};
    ${curFRSrc}
    ${curFESrc}
    ${curSTSrc}
    ${goalClearHalfSrc}
    ${goalCenterHalfSrc}
    ${goalCanPassSrc}
    ${postProbeSrc}
    ${resolvePostSrc}
    ${wedgeSrc}
    ${fallTicksSrc}
    ${spawnTicksSrc}
    ${spawnHeightSrc}
    ${winScoreSrc}
    let fbGoalState='play', fbGoalTick=0;
    ${winnerVarSrc}
    ${goalBusySrc}
    ${goalSideSrc}
    ${freezeSrc}
    ${tryGoalSrc}
    ${npSrc}
    ${resetCommitsSrc}
    ${resetRoundSrc}
    ${startRoundSrc}
    ${tickGoalSrc}
    ${matchEndSrc}
    ${resetMatchStateSrc}
    ${stepSimSrc}
    return {
      ci: FOOTBALL_CONTACT_ITERATIONS,
      // ── Physikphase 4B-2 / 4B-3 ──
      presetName(){ return __model; },
      preset(){ return footballPhys(); },
      prodPhys(){ return FOOTBALL_PHYS; },
      effective(){ return {fr:curFR(), fe:curFE(), stopv:curST(),
                           restBall:curRestBall(), restBand:curRestBand(), restPost:curRestPost()}; },
      wedgeConst(){ return {minContacts:FOOTBALL_WEDGE_MIN_CONTACTS, dot:FOOTBALL_WEDGE_DOT,
                            v:FOOTBALL_WEDGE_V, progress:FOOTBALL_WEDGE_PROGRESS,
                            steps:FOOTBALL_WEDGE_STEPS, press:FOOTBALL_WEDGE_PRESS,
                            eps:FOOTBALL_WEDGE_EPS, minEscapeV:FOOTBALL_ESCAPE_MIN_V}; },
      escapes(){ let n=0; for(const b of balls) n+=(b.fbEscapes||0); return n; },
      geom(){ return {cx,cy,R,BR,flim:R-BR,
        x0:FOOTBALL_POST_FRONT*BR, x1:FOOTBALL_POST_BACK*BR,
        y0:FOOTBALL_POST_INNER*BR, y1:FOOTBALL_POST_OUTER*BR,
        goalHalf:footballGoalCenterHalf(), neutral:FOOTBALL_NEUTRAL_OWNER}; },
      tune(){ return {MAXPULL_FRAC,LAUNCH,FRICTION,FEND,SLOWV,REST,STOPV,SPIN_K,SPIN_DECAY,
        maxPull:maxPull(), maxLaunchV:maxPull()*LAUNCH}; },
      reset(){ balls=[]; phase='sim'; outBall=-1; roundWinner=-1; score=[0,0];
               fbGoalState='play'; fbGoalTick=0; footballWinner=null;
               sfxHits=0; spawnCalls=0; gameOverCalls=[]; },
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
// Referenzdaempfung des CURRENT-Pfades. Presets bringen eigene Werte mit; jeder Lauf
// holt sie ueber env.effective() (siehe makeRun), damit die Energiehuelle und die
// Micro-Step-Rekonstruktion zur tatsaechlich aktiven Physik passen.
const F    = TUNE.FRICTION;
const F2   = F * F;
const F4   = F2 * F2;

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
const mom = (s) => s.reduce((a, b) => ({ x: a.x + (b.alive ? b.vx : 0), y: a.y + (b.alive ? b.vy : 0) }),
                            { x: 0, y: 0 });
const f4  = (n) => Number(n.toFixed(4));
const f2f = (n) => Number(n.toFixed(2));

function postContact(p, eps) {
  eps = eps || 0;
  let best = null;
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const X = sx * (p.x - G.cx), Y = sy * (p.y - G.cy);
    if (X <= G.x0 - G.BR - eps || X >= G.x1 + G.BR + eps ||
        Y <= G.y0 - G.BR - eps || Y >= G.y1 + G.BR + eps) continue;
    const qx = X < G.x0 ? G.x0 : (X > G.x1 ? G.x1 : X);
    const qy = Y < G.y0 ? G.y0 : (Y > G.y1 ? G.y1 : Y);
    const d = Math.hypot(X - qx, Y - qy);
    if (d > G.BR + eps) continue;
    const nx = d > 1e-9 ? (X - qx) / d : 0, ny = d > 1e-9 ? (Y - qy) / d : 0;
    const c = { type: 'post', pen: Math.max(0, G.BR - d), gap: d, nx: sx * nx, ny: sy * ny };
    if (!best || c.gap < best.gap) best = c;
  }
  return best;
}
const bandApplies = (b) => !b.passed && !(b.owner === G.neutral && Math.abs(b.y - G.cy) <= G.goalHalf);

function contactsAt(state, i, eps) {
  const b = state[i], out = [];
  for (let j = 0; j < state.length; j++) {
    if (j === i || !state[j].alive) continue;
    const o = state[j];
    const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy);
    if (d > 2 * G.BR + eps || d <= 1e-12) continue;
    out.push({ type: 'ball', j, nx: dx / d, ny: dy / d, pen: Math.max(0, 2 * G.BR - d), gap: d });
  }
  const pc = postContact(b, eps);
  if (pc) out.push(pc);
  const rx = b.x - G.cx, ry = b.y - G.cy, r = Math.hypot(rx, ry);
  if (r >= G.flim - eps && r > 1e-9 && bandApplies(b))
    out.push({ type: 'band', nx: -rx / r, ny: -ry / r, pen: Math.max(0, r - G.flim), gap: r });
  return out;
}

// Exakte Rekonstruktion der beiden Micro-Step-Positionen aus dem Vorzustand.
// eff traegt die tatsaechlich aktive Daempfung des Laufs (Preset-abhaengig) und
// spiegelt die Zwei-Regime-Regel aus stepSim: unterhalb SLOWV greift FEND.
function sweep(pre, eff) {
  const damp = (b) => (Math.hypot(b.vx, b.vy) < TUNE.SLOWV ? eff.fe : eff.fr);
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
  // Frame (2 Micro-Steps) erzeugen kann — FEND ist stets <= FRICTION, daher ist FRICTION^4
  // die korrekte obere Schranke fuer beide Regime.
  const EFF = env.effective();
  const EF4 = EFF.fr * EFF.fr * EFF.fr * EFF.fr;
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
        // Eine Kugel auf der Sockel-AUSSENFLANKE liegt legitim jenseits von flim
        // (BACK=14.646*BR > R-BR). Ihre radiale Ueberschreitung ist keine Verletzung
        // der Bande und wird deshalb nicht in maxBandOver gezaehlt — genau die
        // Ausnahme, die auch die harte Invariante unten kennt.
        const onPost = c.some((x) => x.type === 'post');
        for (const x of c) {
          maxPenRest = Math.max(maxPenRest, x.pen);
          if (x.type === 'band' && !onPost) maxBandOver = Math.max(maxBandOver, x.pen);
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
          endPen = Math.max(endPen, Math.max(0, 2 * G.BR -
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
      const r = Math.hypot(b.x - G.cx, b.y - G.cy);
      if (r > G.flim + 1e-6 && !postContact(b, CONTACT_EPS)) {
        rec.notes.push('Ball ausserhalb der Bande: r=' + f4(r));
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
const { cx, cy, BR, flim, x0, x1, y0, y1 } = G;
const VMAX = TUNE.maxLaunchV;
const LV = [0.25, 0.50, 0.75, 1.00].map((k) => k * VMAX);
const D = Math.PI / 180;
const yMidPost = cy + 0.5 * (y0 + y1);

// ══════════════════════════════════════════════════════════════════════════
//  SZENARIENSATZ  (identisch fuer jede Iterationsvariante)
// ══════════════════════════════════════════════════════════════════════════
function runAll(ci, preset) {
  const env = buildEnv(ci, preset);
  const results = [];
  const run = makeRun(env, results);
  const M = { IMPULSE: [], OBLIQUE: [], ROLL: [], BAND: [], POST: [] };
  // Referenzdaempfung DIESES Laufs. Alle Verhaeltniszahlen unten werden gegen die
  // tatsaechlich aktive Reibung normiert — sonst waeren Presets nicht vergleichbar.
  const eEFF = env.effective(), eF2 = eEFF.fr * eEFF.fr, eF4 = eF2 * eF2;

  // ── A. SPIELER + BANDE ──
  run('A1 Spieler an Bande, Gegner drueckt frontal v=4.0', 'A',
    [B(cx, cy + flim, 0, 0, 0), B(cx, cy + flim - 2 * BR, 0, 4.0, 1)]);
  run('A2 Spieler an Bande, Gegner drueckt frontal v=VMAX', 'A',
    [B(cx, cy + flim, 0, 0, 0), B(cx, cy + flim - 2 * BR, 0, VMAX, 1)]);
  run('A3 Spieler an Bande, Gegner schraeg 30 grad', 'A',
    [B(cx, cy + flim, 0, 0, 0),
     B(cx - 2 * BR * Math.sin(30 * D), cy + flim - 2 * BR * Math.cos(30 * D),
       4.0 * Math.sin(30 * D), 4.0 * Math.cos(30 * D), 1)]);
  run('A4 Spieler an Bande, 4 Volltreffer nacheinander', 'A',
    [B(cx, cy + flim, 0, 0, 0), B(cx, cy + flim - 2 * BR, 0, VMAX, 1)],
    { shots: [1, 2, 3].map(() => ({ i: 1, vx: 0, vy: VMAX })) });

  // ── B. SPIELER / NEUTRALBALL + TORPFOSTEN ──
  run('B1 Neutralball an Sockel-Innenkante, Spieler drueckt', 'B',
    [B(cx + 0.5 * (x0 + x1), cy + y0 - BR, 0, 0, 4),
     B(cx + 0.5 * (x0 + x1), cy + y0 - 3 * BR, 0, 4.0, 0)]);
  run('B2 Neutralball an Sockel-Vorderkante, Spieler drueckt', 'B',
    [B(cx + x0 - BR, cy + 0.5 * (y0 + y1), 0, 0, 4),
     B(cx + x0 - 3 * BR, cy + 0.5 * (y0 + y1), 4.0, 0, 0)]);
  run('B3 Spielerball in Sockel-Innenecke gedrueckt', 'B',
    [B(cx + x0 - BR * 0.7071, cy + y0 - BR * 0.7071, 0, 0, 0),
     B(cx + x0 - BR * 0.7071 - 2 * BR * 0.7071, cy + y0 - BR * 0.7071 - 2 * BR * 0.7071,
       4.0 * 0.7071, 4.0 * 0.7071, 1)]);
  run('B4 Neutralball an Sockel-Innenkante, 4 Volltreffer', 'B',
    [B(cx + 0.5 * (x0 + x1), cy + y0 - BR, 0, 0, 4),
     B(cx + 0.5 * (x0 + x1), cy + y0 - 3 * BR, 0, VMAX, 0)],
    { shots: [1, 2, 3].map(() => ({ i: 1, vx: 0, vy: VMAX })) });

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
  {
    const a = 30 * D, px = 2 * BR * Math.sin(a), py = 2 * BR * Math.cos(a);
    const pair = (v0, v1) => [
      B(cx, cy + flim, 0, 0, 4),
      B(cx - px, cy + flim - py, v0 * Math.sin(a), v0 * Math.cos(a), 0),
      B(cx + px, cy + flim - py, -v1 * Math.sin(a), v1 * Math.cos(a), 1)];
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
      [B(cx, cy - 2 * BR - 0.5, 0, v0, 0), B(cx, cy, 0, 0, 4)], {
        maxFrames: 900,
        analyze(rec) {
          const h = firstHit(rec, 'ball', 0);
          if (!h) { rec.notes.push('kein Kontakt'); rec.verdict = 'FAIL'; return; }
          const ref = v0 * eF2;
          const pIn = mom(h.e.pre), pOut = mom(h.e.post);
          const m = {
            label, v0, sub: h.sub, penIn: h.h.pen,
            vPlayerAfter: sp(h.e.post[0]), vBallAfter: sp(h.e.post[1]),
            ratioPlayer: sp(h.e.post[0]) / ref, ratioBall: sp(h.e.post[1]) / ref,
            momentumErr: Math.abs(Math.hypot(pOut.x, pOut.y) - eF2 * Math.hypot(pIn.x, pIn.y)),
            energyEff: h.e.Epost / (h.e.Epre * eF4), frame: h.e.f
          };
          rec.impulse = m; M.IMPULSE.push(m);
        }
      });
  });

  // ── F. SCHRAEGER TREFFER ──
  [15, 30, 45, 60].forEach((deg, k) => {
    const th = deg * D, off = 2 * BR * Math.sin(th), v0 = 4.0;
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
  [['G1 Ausrollen Neutralball', 4], ['G2 Ausrollen Spielerball', 0]].forEach(([nm, owner]) => {
    const v0 = 3.0;
    run(nm, 'G', [B(cx, cy - 260, 0, v0, owner)], {
      maxFrames: 900,
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
      vIn: sp(before), vOut: sp(after), ratio: sp(after) / (sp(before) * eF2),
      normalRatio: vinN > 1e-9 ? voutN / (vinN * eF2) : null,
      tangentRatio: vinT > 1e-9 ? voutT / (vinT * eF2) : null,
      incidenceDeg: Math.acos(Math.min(1, vinN / (sp(before) || 1e-12))) / D
    };
    rec.band = m; M.BAND.push(m); return m;
  };
  [1.0, 2.0, 4.0, VMAX].forEach((v0, k) => {
    run('H' + (k + 1) + ' Bandenabprall zentral v=' + f2f(v0), 'H',
      [B(cx, cy + flim - 90, 0, v0, 4)], { maxFrames: 900, analyze: (r) => bandMetric(r, 'zentral', v0) });
  });
  [2.0, 4.0].forEach((v0, k) => {
    run('H' + (5 + k) + ' Bandenabprall schraeg v=' + f2f(v0), 'H',
      [B(cx - 200, cy + flim - 160, 0, v0, 4)], { maxFrames: 900, analyze: (r) => bandMetric(r, 'schraeg', v0) });
  });

  // ── I. PFOSTENABPRALL ──
  const postMetric = (rec, kind, v0) => {
    const h = firstHit(rec, 'post', 0);
    if (!h) { rec.notes.push('kein Sockelkontakt'); rec.verdict = 'FAIL'; return { kind, v0, ratio: null }; }
    const before = h.e.pre[0], after = h.e.post[0], n = h.h;
    const vinN  = Math.abs(before.vx * -n.nx + before.vy * -n.ny);
    const voutN = Math.abs(after.vx * n.nx + after.vy * n.ny);
    const m = {
      kind, v0, frame: h.e.f, sub: h.sub, penIn: n.pen,
      vIn: sp(before), vOut: sp(after), ratio: sp(after) / (sp(before) * eF2),
      normalRatio: vinN > 1e-9 ? voutN / (vinN * eF2) : null,
      inDeg: Math.atan2(before.vy, before.vx) / D, outDeg: Math.atan2(after.vy, after.vx) / D
    };
    rec.postM = m; M.POST.push(m); return m;
  };
  [1.0, 2.0, 4.0, VMAX].forEach((v0, k) => {
    run('I' + (k + 1) + ' Sockel frontal v=' + f2f(v0), 'I',
      [B(cx + x0 - BR - 110, yMidPost, v0, 0, 0)], { maxFrames: 900, analyze: (r) => postMetric(r, 'frontal', v0) });
  });
  run('I5 Sockel Innenkante tangential v=4.0', 'I',
    [B(cx + 0.5 * (x0 + x1), cy + y0 - BR - 110, 0, 4.0, 0)],
    { maxFrames: 900, analyze: (r) => postMetric(r, 'innenkante', 4.0) });
  run('I6 Sockel Innenecke diagonal v=4.0', 'I',
    [B(cx + x0 - 70, cy + y0 - 70, 4.0 * 0.7071, 4.0 * 0.7071, 0)],
    { maxFrames: 900, analyze: (r) => postMetric(r, 'innenecke', 4.0) });
  run('I7 Sockel frontal schraeg 30 grad v=4.0', 'I',
    [B(cx + x0 - BR - 110, yMidPost - 60, 4.0 * Math.cos(30 * D), 4.0 * Math.sin(30 * D), 0)],
    { maxFrames: 900, analyze: (r) => postMetric(r, 'frontal-30', 4.0) });

  // ── J. SOCKEL-AUSSENFLANKE JENSEITS DER BANDENLINIE ──
  // Der Sockel reicht mit BACK=14.646*BR radial UEBER flim hinaus. Eine Kugel auf
  // seiner Aussenflanke liegt legitim bei r>flim; Bandenklemmung und Sockelkorrektur
  // schieben dort gegeneinander. Genau dieser Fall muss unter Iteration konvergieren
  // statt zu schwingen — und darf keinen zweiten Reflexionsimpuls erzeugen.
  run('J1 Kugel auf Sockel-Aussenflanke (r>flim), ruhend', 'J',
    [B(cx + 430, cy + y1 + BR, 0, 0, 0)], { maxFrames: 600 });
  run('J2 Kugel auf Sockel-Aussenflanke, tangential angestossen', 'J',
    [B(cx + 430, cy + y1 + BR, -2.0, 0, 0)], { maxFrames: 600 });

  // ── W. DREI-KUGEL-KEIL AN BANDE UND TORSOCKEL (Reproduktion des manuellen Befunds) ──
  // Der neutrale Ball liegt an der Bande UND an der Aussenflanke des Marmorsockels; beide
  // Spielerkugeln druecken aus unterschiedlichen Richtungen dagegen. Damit liegen drei
  // unabhaengige Kontaktnormalen an, von denen mindestens ein Paar den Ball geometrisch
  // einschliesst — genau die Lage aus dem Browsertest, in der weitere Treffer nichts mehr
  // bewirken. Ohne Anti-Wedge bleibt der Ball stehen, mit Anti-Wedge gleitet er seitlich
  // an der Bande heraus (nicht radial durch Bande oder Sockel).
  {
    // Die Ecke ist exakt konstruiert: der Ball beruehrt GLEICHZEITIG die Aussenflanke des
    // Marmorsockels (tangentialer Abstand y1+BR) und die Bandenlinie (Radius flim).
    const wcy = y1 + BR, wcx = Math.sqrt(flim * flim - wcy * wcy);
    const rh = [wcx / flim, wcy / flim];               // Radialrichtung zur Ecke
    const uf = [-rh[1], rh[0]];                        // Tangente entlang der Bande, weg vom Sockel
    // Spieler 0 blockiert die tangentiale Flucht, Spieler 1 drueckt radial nach aussen.
    // Damit liegen VIER Normalen an (Bande, Sockel, zwei Kugeln) und der neutrale Ball ist
    // geometrisch geschlossen — die Lage aus dem Browserbefund.
    const wedge = (v) => [
      B(cx + wcx, cy + wcy, 0, 0, G.neutral),
      B(cx + wcx + 2 * BR * uf[0], cy + wcy + 2 * BR * uf[1], -v * uf[0], -v * uf[1], 0),
      B(cx + wcx - 2 * BR * rh[0], cy + wcy - 2 * BR * rh[1], v * rh[0], v * rh[1], 1)];
    run('W1 Drei-Kugel-Keil Bande+Sockel, Dauerdruck', 'W', wedge(1.0), { maxFrames: 2400 });
    // W2: nach jedem Settlement zielt abwechselnd ein Spieler auf die AKTUELLE Ballposition
    // und schiesst mit voller Kraft — der Fall "weitere Treffer loesen ihn nicht".
    run('W2 Drei-Kugel-Keil Bande+Sockel, 3 gezielte Nachschuesse', 'W', wedge(1.0), {
      maxFrames: 2400,
      shots: [0, 1, 2].map((k) => ({ i: 1 + (k % 2), at: 0, sp: VMAX }))
    });
  }

  return { ci: env.ci, preset: env.presetName(), results, M, env };
}

// ══════════════════════════════════════════════════════════════════════════
//  GAMEPLAY-REGRESSION (Torpassage / Barriere / Score / Reset / First-to-3)
// ══════════════════════════════════════════════════════════════════════════
function gameplayProbe(ci, preset) {
  const env = buildEnv(ci, preset);
  const out = {};

  // 1) Neutralball trifft die freie Toroeffnung mittig -> Tor, Score, 'fall'
  env.reset();
  env.setBalls([{ x: cx, y: cy, vx: 5.0, vy: 0, owner: 4 }]);
  let f = 0;
  while (f++ < 900 && env.goalState() === 'play' && env.phase() === 'sim') env.step();
  out.goalScored = env.score().slice();
  out.goalState = env.goalState();
  out.goalFrame = f;

  // 2) Spielerkugel auf derselben Bahn -> KEIN Durchtritt (unsichtbare Barriere)
  env.reset();
  env.setBalls([{ x: cx, y: cy, vx: 5.0, vy: 0, owner: 0 }]);
  f = 0;
  while (f++ < 900 && env.phase() === 'sim') env.step();
  const pb = env.get()[0];
  out.playerBlocked = !pb.passed && Math.hypot(pb.x - cx, pb.y - cy) <= flim + 1e-6;
  out.playerScore = env.score().slice();

  // 3) Neutralball genau auf die Pfosteninnenkante -> Pfostentreffer, KEIN Tor
  env.reset();
  env.setBalls([{ x: cx, y: cy + y0 + 1, vx: 5.0, vy: 0, owner: 4 }]);
  f = 0;
  while (f++ < 900 && env.goalState() === 'play' && env.phase() === 'sim') env.step();
  out.postNoGoal = env.score().slice();
  out.postPassed = env.passedFlags()[0];

  // 4) Voller Torablauf: 'fall' -> Reset -> 'spawn' -> 'play', frische Kugeln
  env.reset();
  env.setBalls([{ x: cx, y: cy, vx: 5.0, vy: 0, owner: 4 }]);
  f = 0;
  while (f++ < 900 && env.goalState() === 'play') env.step();
  const seq = [env.goalState()];
  for (let k = 0; k < 200; k++) { env.step(); if (seq[seq.length - 1] !== env.goalState()) seq.push(env.goalState()); }
  out.stateSeq = seq.join('->');
  out.ballsAfterReset = env.get().length;

  // 5) First-to-3: Score kuenstlich auf 2, ein weiteres Tor beendet das Match
  env.reset();
  env.setBalls([{ x: cx, y: cy, vx: 5.0, vy: 0, owner: 4 }]);
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
console.log('  BR=' + BR + '  R=' + G.R + '  flim=' + flim +
            '  Sockel X[' + f4(x0) + ',' + f4(x1) + '] Y[' + f4(y0) + ',' + f4(y1) + ']' +
            '  Torfenster=+-' + f4(G.goalHalf));
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
              ' ruhende Kontakte je Frame   minAbstand=' + num(r.minDist, 1) + ' px (2*BR=' + 2 * BR + ')');
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
P3('FRICTION (pro Micro-Step)', (p) => f4(EFFP[p].fr));
P3('  daraus Restgeschwindigkeit pro Sekunde', (p) => f4(perSec(EFFP[p].fr)));
P3('FEND (unterhalb SLOWV=' + TUNE.SLOWV + ')', (p) => f4(EFFP[p].fe));
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
                W1: 'W1 Drei-Kugel-Keil Bande+Sockel, Dauerdruck',
                W2: 'W2 Drei-Kugel-Keil Bande+Sockel, 3 gezielte Nachschuesse' };
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
const d4b = BN['D4 Neutralball Bande + zwei Spieler, 4 Nachschuesse'];
const d4n = NN['D4 Neutralball Bande + zwei Spieler, 4 Nachschuesse'];
ok(d4n.moved[0] > d4b.moved[0] * 1.5,
   'D4 Bandenkeil: Neutralball loest sich deutlich besser (' + f2f(d4b.moved[0]) + ' -> ' +
   f2f(d4n.moved[0]) + ' px)');
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

// C — Pinning
ok(AN_C.pinnedCount <= AB_C.pinnedCount,
   'Anzahl Pinning-Szenarien steigt nicht (' + AB_C.pinnedCount + ' -> ' + AN_C.pinnedCount + ')');
ok(AN_C.maxPin <= AB_C.maxPin,
   'maximale Pinning-Dauer steigt nicht an (' + AB_C.maxPin + ' -> ' + AN_C.maxPin + ' Frames)');

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

// F2 — Produktivstand: GLIDE ist der einzige Wertesatz im Produktivcode
{
  const FINAL = { friction: 0.9968, fend: 0.9935, stopv: 0.035,
                  restBall: 0.40, restBand: 0.52, restPost: 0.47 };
  const prod = PROBE.prodPhys();
  for (const k of Object.keys(FINAL))
    ok(prod[k] === FINAL[k], 'FOOTBALL_PHYS.' + k + ' = ' + FINAL[k] + ' (erhalten: ' + prod[k] + ')');
  ok(Object.keys(prod).length === Object.keys(FINAL).length,
     'FOOTBALL_PHYS enthaelt genau die sechs finalen Werte (keine Restfelder aus dem Prototyp)');
  // Der GLIDE-Lauf ist der unveraenderte Produktivpfad: keine Ueberschreibung noetig.
  ok(modelOverride('GLIDE') === '', 'das GLIDE-Modell ist der Produktivpfad ohne jede Ueberschreibung');
  const eg = EFFP.GLIDE;
  ok(eg.fr === prod.friction && eg.fe === prod.fend && eg.stopv === prod.stopv &&
     eg.restBall === prod.restBall && eg.restBand === prod.restBand && eg.restPost === prod.restPost,
     'die effektive Football-Physik ist exakt FOOTBALL_PHYS');
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

// H — Glide: laenger unterwegs, aber immer noch endlich
{
  const roll = (p, k) => PR[p].M.ROLL[k];
  for (const k of [0, 1]) {
    const lbl = k === 0 ? 'Neutralball' : 'Spielerball';
    ok(roll('GLIDE', k).settleFrames > roll('CURRENT', k).settleFrames * 1.8,
       lbl + ': GLIDE rollt deutlich laenger (' + roll('CURRENT', k).settleFrames + ' -> ' +
       roll('GLIDE', k).settleFrames + ' Frames)');
    ok(roll('ICE', k).settleFrames > roll('GLIDE', k).settleFrames,
       lbl + ': ICE rollt laenger als GLIDE (' + roll('ICE', k).settleFrames + ' Frames)');
    ok(roll('GLIDE', k).dist > roll('CURRENT', k).dist * 1.8 &&
       roll('ICE', k).dist > roll('GLIDE', k).dist,
       lbl + ': Ausrollstrecke steigt (' + f2f(roll('CURRENT', k).dist) + ' -> ' +
       f2f(roll('GLIDE', k).dist) + ' -> ' + f2f(roll('ICE', k).dist) + ' px)');
  }
  ok(PRESETS.every((p) => AP[p].noSettle === PR[p].results.filter((r) => r.stopped === 'maxFrames').length),
     'Settlement-Zaehlung konsistent');
  ok(PR.ICE.M.ROLL.every((m) => m.settleFrames > 0 && m.settleFrames < 2400),
     'auch ICE settled in endlicher Zeit (kein ewiges Mikrokriechen)');
  // Spieler- und Neutralball bleiben bitidentisch (weiterhin kein Massenmodell).
  ok(PRESETS.every((p) => Math.abs(PR[p].M.ROLL[0].dist - PR[p].M.ROLL[1].dist) < 1e-9),
     'Neutral- und Spielerball rollen in jedem Preset identisch (keine Masse eingefuehrt)');
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

// J — Drei-Kugel-Keil: ohne Anti-Wedge tot, mit Anti-Wedge geloest
{
  const W1 = wname.W1, W2 = wname.W2;
  const RELEASE_LIMIT = 600;   // Frames = 10 s — klares Zeitfenster
  // W1 (reiner Dauerdruck, keine Nachschuesse): sobald der Druck der Spieler abgeklungen
  // ist, RUHT der Ball legitim in der Ecke — es gibt keine Kraft mehr, die ihn loesen
  // muesste. Gemessen wird hier deshalb, dass der Keil ueberhaupt erkannt und aufgebrochen
  // wird, nicht dass der Ball davonfliegt.
  ok(PN.CURRENT[W1].escapes === 0 && PN.CURRENT[W1].moved[0] < 1,
     'W1 unter CURRENT: keine Reaktion, Ball bleibt stehen (' + f2f(PN.CURRENT[W1].moved[0]) + ' px)');
  for (const p of ['GLIDE', 'ICE']) {
    ok(PN[p][W1].escapes > 0, p + ': W1 erkennt den Keil und reagiert (' + PN[p][W1].escapes + ' Escapes)');
    ok(PN[p][W1].moved[0] > PN.CURRENT[W1].moved[0] * 10,
       p + ': W1 Subjekt loest sich messbar aus der Ecke (' + f2f(PN.CURRENT[W1].moved[0]) + ' -> ' +
       f2f(PN[p][W1].moved[0]) + ' px)');
  }
  // W2 ist der eigentliche Befund aus dem Browsertest: DREI gezielte Volltreffer auf den
  // eingeklemmten Ball. Ohne Anti-Wedge bewegt er sich nicht, mit Anti-Wedge loest er sich.
  ok(PN.CURRENT[W2].releaseFrame < 0 && PN.CURRENT[W2].moved[0] < 1,
     'W2 unter CURRENT: drei gezielte Volltreffer bewegen den Ball um ' +
     f2f(PN.CURRENT[W2].moved[0]) + ' px — der reproduzierte Fehler');
  for (const p of ['GLIDE', 'ICE']) {
    ok(PN[p][W2].releaseFrame > 0 && PN[p][W2].releaseFrame <= RELEASE_LIMIT,
       p + ': W2 loest sich in ' + PN[p][W2].releaseFrame + ' Frames (' + secs(PN[p][W2].releaseFrame) + ')');
    ok(PN[p][W2].moved[0] > 2 * G.BR,
       p + ': W2 Subjekt verlagert sich um ' + f2f(PN[p][W2].moved[0]) + ' px (> 2*BR)');
    ok(PN[p][W2].escapes > 0, p + ': W2 hat ' + PN[p][W2].escapes + ' Escape-Reaktionen ausgeloest');
    for (const w of [W1, W2]) {
      ok(PN[p][w].maxPostRest <= 1e-6 && PN[p][w].maxBandOver <= 1e-6,
         p + ': ' + w.slice(0, 2) + ' ohne Sockel- oder Bandenpenetration');
      ok(PN[p][w].maxSpeed <= VMAX + 1e-9,
         p + ': ' + w.slice(0, 2) + ' bleibt unter der Launch-Obergrenze (' + f4(PN[p][w].maxSpeed) + ')');
    }
  }
  ok(PN.GLIDE[W2].escapes < 50 && PN.ICE[W2].escapes < 50,
     'Escape feuert nicht in jedem Micro-Step (Mindestdauer wirkt als Sperre: ' +
     PN.GLIDE[W2].escapes + ' / ' + PN.ICE[W2].escapes + ' Reaktionen)');
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
  // Ausserhalb von Escape-Frames darf KEIN Frame Energie erzeugen — auch nicht mit Preset.
  const maxEffNoEscape = (p) => {
    const ef = EFFP[p].fr, ef4 = ef * ef * ef * ef;
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
