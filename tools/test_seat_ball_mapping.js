// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Seat→Kugel-Zuordnung, Timeout-No-Shot und Leave-Sentinel
//
//   node tools/test_seat_ball_mapping.js
//
// Sichert den P0-Fix vom 2026-08-04 ab: Eine Zeitueberschreitung ist KEIN
// Verlassen des Matches. Vorher trug der Online-Timeout-No-Shot einen FREMDEN
// Kugelindex — byte-identisch zum Leave-Sentinel. processSlot() las daraus
// "Seat hat verlassen", setzte seatGone dauerhaft, und ejectGoneSeats() warf die
// Kugel des Spielers ab dem naechsten Reveal in JEDEM Zug aus der Arena. Dieselbe
// Index-Arithmetik (idx%3===seat) war in TRIPLE FFA schon bei einem voellig
// normalen Zug falsch.
//
// Alle geprueften Funktionen werden VERBATIM aus index.html extrahiert — es wird
// nichts nachgebaut, sonst pruefte der Test eine andere Zuordnung als das Spiel.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
};

const SRC = [
  grab(/const FFA_MAX_SEATS=[^\n]*/, 'FFA_MAX_SEATS'),
  grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants'),
  grab(/function mkBall\(x,y,owner\)\{[^\n]*/, 'mkBall'),
  grab(/function aliveBalls\(owner\)\{[^\n]*/, 'aliveBalls'),
  grab(/function aliveCount\(owner\)\{[^\n]*/, 'aliveCount'),
  grab(/function np\(\)\{[^\n]*/, 'np'),
  grab(/function teamCap\(\)\{[^\n]*/, 'teamCap'),
  grab(/function seatOwnsBall\(s,idx\)\{[^\n]*/, 'seatOwnsBall'),
  grab(/function seatDefaultBall\(s\)\{[^\n]*/, 'seatDefaultBall'),
  grab(/function seatForeignBall\(s\)\{[^\n]*/, 'seatForeignBall'),
  grab(/function leaveSentinelMove\(s\)\{[^\n]*/, 'leaveSentinelMove'),
  grab(/function isLeaveSentinel\(s,c\)\{[^\n]*/, 'isLeaveSentinel'),
  grab(/function onlineNoShotIdx\(s\)\{[^\n]*/, 'onlineNoShotIdx'),
  grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls'),
  grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove'),
  grab(/function processSlot\(s,c\)\{[\s\S]*?\n\}/, 'processSlot'),
  grab(/function ejectGoneSeats\(\)\{[\s\S]*?\n\}/, 'ejectGoneSeats'),
].join('\n');

// Minimale Sandbox: nur die Symbole, die die extrahierten Funktionen wirklich
// lesen. Nichts davon trifft eine Spielentscheidung — die trifft ausschliesslich
// der echte Produktionscode oben.
function build() {
  const env = `
    const LOGICAL=1000, cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    let balls=[], mode='ffa', fmt='ffa', ffaN=2;
    let seatGone=[], aimSet=[], commitIdx=[], commitAim=[], commitSpin=[];
    let turnNo=0, onTurnTs={};
    let onlineTerminated=false;
    function isOnlineTerminated(){return onlineTerminated;}
    function clearSentinelRetry(){}
    function updateHud(){} function setPhaseText(){}
    function maxPull(){return R0*MAXPULL_FRAC;}
    ${SRC}
    return {
      setup(m,f,n){ mode=m; fmt=f; ffaN=n; R=R0; balls=[]; placeBalls();
                    seatGone=[]; aimSet=[]; commitIdx=[]; commitAim=[]; commitSpin=[];
                    for(let p=0;p<np();p++){aimSet.push(false);commitIdx.push(-1);commitAim.push({dx:0,dy:0});commitSpin.push(0);}
                    turnNo=0; onTurnTs={}; },
      // Neue Generation (Rematch): exakt die Zeile aus startOnlineGame().
      newGeneration(){ seatGone=[]; },
      processSlot:(s,c)=>processSlot(s,c),
      ejectGoneSeats:()=>ejectGoneSeats(),
      noShot:(s)=>onlineNoShotIdx(s),
      leaveMove:(s)=>leaveSentinelMove(s),
      isLeave:(s,c)=>isLeaveSentinel(s,c),
      ownsBall:(s,i)=>seatOwnsBall(s,i),
      defaultBall:(s)=>seatDefaultBall(s),
      sanitize:(w,i,dx,dy,sp)=>sanitizeMove(w,i,dx,dy,sp),
      seats:()=>np(),
      owners:()=>balls.map(b=>b.owner),
      gone:()=>{const o=[];for(let s=0;s<np();s++)o.push(!!seatGone[s]);return o;},
      alive:()=>balls.map(b=>b.alive),
      aimSet:()=>aimSet.slice(),
      commitIdx:()=>commitIdx.slice(),
      commitAim:()=>commitAim.map(a=>({dx:a.dx,dy:a.dy})),
      positions:()=>balls.map(b=>({x:b.x,y:b.y})),
      radius:()=>R, ballR:()=>BR,
      resetAim(){ for(let p=0;p<np();p++){aimSet[p]=false;commitIdx[p]=-1;commitAim[p]={dx:0,dy:0};commitSpin[p]=0;} turnNo++; },
      killBall(i){ balls[i].alive=false; },
    };
  `;
  return new Function(env)();
}

const G = build();
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; return; }
  fail++;
  console.error('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : ''));
};
const dist = (p) => Math.hypot(p.x - 500, p.y - 500);

// Ein echter Spielerzug, wie ihn applyCommit() auf die Leitung legt: sanitizeMove
// bestimmt den Index, der Slot traegt genau diesen Wert.
const realMove = (seat, dx, dy) => {
  const m = G.sanitize(seat, G.defaultBall(seat), dx, dy, 0);
  return { idx: m.idx, dx: m.dx, dy: m.dy, sp: m.sp };
};
// Der Timeout-No-Shot, wie ihn tickOnlineClock() schreibt.
const timeoutMove = (seat) => ({ idx: G.noShot(seat), dx: 0, dy: 0, sp: 0 });

// ── 1) Zeitueberschreitung in einem Zwei-Spieler-FFA ────────────────────────
{
  G.setup('ffa', 'ffa', 2);
  const before = G.positions();

  // Turn 0: Seat 0 spielt reguelaer, Seat 1 laeuft in die Zugzeit-Deadline.
  G.processSlot(0, realMove(0, 40, 0));
  const noShot = timeoutMove(1);
  t('1.1 Timeout-No-Shot traegt die EIGENE Kugel des Seats', noShot.idx === G.defaultBall(1), noShot);
  t('1.2 Timeout-No-Shot ist ein Stehenbleiben (0/0)', noShot.dx === 0 && noShot.dy === 0 && noShot.sp === 0, noShot);
  t('1.3 Timeout-No-Shot ist KEIN Leave-Muster', G.isLeave(1, noShot) === false);
  G.processSlot(1, noShot);

  t('1.4 kein Seat wird als "gone" markiert', JSON.stringify(G.gone()) === '[false,false]', G.gone());
  t('1.5 der No-Shot zaehlt als gueltiger Zug (aimSet)', JSON.stringify(G.aimSet()) === '[true,true]', G.aimSet());
  t('1.6 verarbeiteter Zug bleibt 0/0 auf eigener Kugel',
    G.commitIdx()[1] === G.defaultBall(1) && G.commitAim()[1].dx === 0 && G.commitAim()[1].dy === 0,
    { idx: G.commitIdx()[1], aim: G.commitAim()[1] });

  // Reveal: nichts wird aus der Arena teleportiert.
  G.ejectGoneSeats();
  const after = G.positions();
  t('1.7 keine Kugel wird teleportiert', JSON.stringify(before) === JSON.stringify(after), { before, after });
  t('1.8 keine Kugel liegt ausserhalb des Rings',
    after.every((p) => dist(p) <= G.radius() + G.ballR() * 0.1), after.map(dist));
  t('1.9 beide Kugeln leben weiter', JSON.stringify(G.alive()) === '[true,true]', G.alive());

  // Turn 1: derselbe Spieler spielt voellig normal weiter.
  G.resetAim();
  G.processSlot(0, realMove(0, 10, 0));
  G.processSlot(1, realMove(1, -30, 20));
  t('1.10 Seat 1 kann im Folgezug regulaer weiterspielen',
    G.aimSet()[1] === true && G.commitIdx()[1] === G.defaultBall(1));
  t('1.11 auch nach dem Folgezug bleibt kein Seat "gone"', JSON.stringify(G.gone()) === '[false,false]', G.gone());
  G.ejectGoneSeats();
  t('1.12 kein kuenstlicher Ring-Out durch den Timeout',
    G.positions().every((p) => dist(p) <= G.radius() + G.ballR() * 0.1));
}

// ── 2) TRIPLE FFA: normale Zuege aller drei Seats ───────────────────────────
{
  G.setup('ffa', 'triple_ffa', 3);
  t('2.1 TRIPLE FFA hat 3 Seats und 6 Kugeln', G.seats() === 3 && G.owners().length === 6, G.owners());
  t('2.2 Kugelbesitz: Seat s besitzt 2s und 2s+1', JSON.stringify(G.owners()) === '[0,0,1,1,2,2]', G.owners());
  for (let s = 0; s < 3; s++) {
    t(`2.3.${s} Seat ${s} kontrolliert Kugel ${2 * s}`, G.defaultBall(s) === 2 * s, G.defaultBall(s));
    t(`2.4.${s} Seat ${s} besitzt beide eigenen Kugeln`, G.ownsBall(s, 2 * s) && G.ownsBall(s, 2 * s + 1));
    t(`2.5.${s} Seat ${s} besitzt keine fremde Kugel`,
      [0, 1, 2, 3, 4, 5].filter((i) => G.ownsBall(s, i)).join(',') === `${2 * s},${2 * s + 1}`);
  }
  for (let s = 0; s < 3; s++) G.processSlot(s, realMove(s, 25, -25));
  t('2.6 kein Seat wird durch einen normalen TRIPLE-Zug "gone"',
    JSON.stringify(G.gone()) === '[false,false,false]', G.gone());
  const before = G.positions();
  G.ejectGoneSeats();
  t('2.7 keine TRIPLE-Kugel wird teleportiert', JSON.stringify(before) === JSON.stringify(G.positions()));
  // Auch der Timeout-No-Shot bleibt in TRIPLE ein normaler Zug.
  G.setup('ffa', 'triple_ffa', 3);
  for (let s = 0; s < 3; s++) G.processSlot(s, timeoutMove(s));
  t('2.8 TRIPLE-Timeout markiert keinen Seat als "gone"',
    JSON.stringify(G.gone()) === '[false,false,false]', G.gone());
}

// ── 3) FFA 5 und 2v2 (TEAM DUEL): vollstaendige Zuordnung ───────────────────
for (const [label, mode, fmt, n, expOwners] of [
  ['FFA 2', 'ffa', 'ffa', 2, [0, 1]],
  ['FFA 3', 'ffa', 'ffa', 3, [0, 1, 2]],
  ['FFA 5', 'ffa', 'ffa', 5, [0, 1, 2, 3, 4]],
  ['TEAM DUEL (2v2)', 'ffa', 'team_duel', 4, [0, 1, 2, 3]],
]) {
  G.setup(mode, fmt, n);
  t(`3.${label} Kugelbesitz wie erwartet`, JSON.stringify(G.owners()) === JSON.stringify(expOwners), G.owners());
  for (let s = 0; s < n; s++) {
    t(`3.${label} Seat ${s} -> eigene Kugel`, G.ownsBall(s, G.defaultBall(s)) === true);
    t(`3.${label} Seat ${s} Fremdkugel gehoert nicht ihm`, G.ownsBall(s, G.leaveMove(s).idx) === false, G.leaveMove(s));
    t(`3.${label} Seat ${s} Timeout ist kein Leave`, G.isLeave(s, timeoutMove(s)) === false);
    t(`3.${label} Seat ${s} Leave-Sentinel IST ein Leave`, G.isLeave(s, G.leaveMove(s)) === true);
  }
  for (let s = 0; s < n; s++) G.processSlot(s, realMove(s, 20, 15));
  t(`3.${label} normale Zuege loesen kein Leave aus`, G.gone().every((v) => v === false), G.gone());
  const before = G.positions();
  G.ejectGoneSeats();
  t(`3.${label} keine Kugel wird teleportiert`, JSON.stringify(before) === JSON.stringify(G.positions()));
}

// ── 4) Echter Leave: Semantik unveraendert ──────────────────────────────────
{
  G.setup('ffa', 'ffa', 3);
  const gone = 1;
  G.processSlot(0, realMove(0, 30, 0));
  const sentinel = G.leaveMove(gone);
  t('4.1 Leave-Sentinel traegt eine fremde Kugel', G.ownsBall(gone, sentinel.idx) === false, sentinel);
  t('4.2 Leave-Sentinel ist ein Stehenbleiben (0/0)', sentinel.dx === 0 && sentinel.dy === 0 && sentinel.sp === 0);
  G.processSlot(gone, sentinel);
  G.processSlot(2, realMove(2, -20, 10));
  t('4.3 nur der verlassene Seat wird "gone"', JSON.stringify(G.gone()) === '[false,true,false]', G.gone());
  t('4.4 der Sentinel schliesst den Slot regulaer', JSON.stringify(G.aimSet()) === '[true,true,true]', G.aimSet());
  t('4.5 sanitizeMove korrigiert den Fremdindex auf die eigene Kugel',
    G.commitIdx()[gone] === G.defaultBall(gone), G.commitIdx());

  const before = G.positions();
  G.ejectGoneSeats();
  const after = G.positions();
  t('4.6 die Kugel des Verlassenen wird hinter die Ringkante gesetzt',
    Math.abs(dist(after[gone]) - (G.radius() + G.ballR() * 2)) < 1e-9, dist(after[gone]));
  t('4.7 alle anderen Kugeln bleiben unberuehrt',
    after.every((p, i) => i === gone || (p.x === before[i].x && p.y === before[i].y)));
}

// ── 5) Rematch/neue Generation: seatGone wird vollstaendig zurueckgesetzt ────
{
  G.setup('ffa', 'ffa', 3);
  G.processSlot(1, G.leaveMove(1));
  t('5.1 Ausgangslage: ein Seat ist "gone"', JSON.stringify(G.gone()) === '[false,true,false]', G.gone());
  // Innerhalb DERSELBEN Generation darf sich das nie von selbst loesen.
  G.resetAim();
  G.processSlot(0, realMove(0, 10, 0));
  G.processSlot(2, realMove(2, 10, 0));
  t('5.2 ein echter Leave bleibt in derselben Generation bestehen',
    JSON.stringify(G.gone()) === '[false,true,false]', G.gone());
  // Rematch: neue Generation, leere Zughistorie.
  G.newGeneration();
  G.setup('ffa', 'ffa', 3);
  t('5.3 Rematch setzt seatGone vollstaendig zurueck',
    JSON.stringify(G.gone()) === '[false,false,false]', G.gone());
  t('5.4 nach dem Rematch leben alle Kugeln', G.alive().every((v) => v === true), G.alive());
  const before = G.positions();
  G.ejectGoneSeats();
  t('5.5 nach dem Rematch wird keine Kugel teleportiert',
    JSON.stringify(before) === JSON.stringify(G.positions()));
}

// ── 6) Gegenprobe: die alte Formel wuerde hier rot ──────────────────────────
// Dokumentiert die konkrete Regression, damit sie nicht unbemerkt zurueckkehren
// kann: der frueher geschriebene Fremdindex (s+1)%FFA_MAX_SEATS bzw. die
// Erkennung idx%3===seat lieferten genau die falschen Antworten.
{
  G.setup('ffa', 'ffa', 2);
  t('6.1 alter Timeout-Index (s+1)%5 waere ein Leave gewesen',
    G.isLeave(1, { idx: (1 + 1) % 5, dx: 0, dy: 0, sp: 0 }) === true);
  t('6.2 neuer Timeout-Index ist es nicht', G.isLeave(1, timeoutMove(1)) === false);
  G.setup('ffa', 'triple_ffa', 3);
  for (let s = 1; s < 3; s++) {
    const idx = G.defaultBall(s);
    t(`6.3.${s} alte TRIPLE-Erkennung idx%3===seat war fuer Seat ${s} falsch`, idx % 3 !== s, { s, idx });
    t(`6.3.${s} neue Ownership-Erkennung ist korrekt`, G.ownsBall(s, idx) === true);
  }
}

console.log(`Seat-Ball-Zuordnung: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
