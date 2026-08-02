// Arena-Football-Integrations-Shell — Regressionsnetz für den neuen mode==='football'.
//
// Extrahiert die ECHTEN Funktionen aus index.html (wie die bestehenden Golden-/
// Lockstep-Suiten) und prüft die Shell-Invarianten:
//   - Registrierung (MODE_ORDER / MENU_SEL / Karte / CTA-Texte),
//   - genau drei Kugeln (Blau links, Rot rechts, neutraler Ball mittig, owner 4),
//   - normaler 1v1-Aufbau unverändert (2 Kugeln),
//   - neutraler Ball ist nicht auswählbar (pickOwnBall filtert owner===who),
//   - Football: geschlossene runde Bande statt Ring-Out (Reflexion, keine Elimination),
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

function buildEnv(startMode, startFmt) {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${consts}
    ${spin}
    ${pcols}
    function curFR(){return FRICTION;} function curFE(){return FEND;} function curST(){return STOPV;}
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', outBall=-1, roundWinner=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false;
    let mode=${JSON.stringify(startMode)}, fmt=${JSON.stringify(startFmt)};
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){}};
    function spawn(){} function popBall(){} function winnerRGB(){return '';}
    let r3dActive=false; function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;} function updateHud(){} function setPhaseText(){}
    function onlineArmTurn(){} function openCover(){}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    ${mkBallSrc}
    ${teamCapSrc}
    ${placeBallsSrc}
    ${pickOwnBallSrc}
    ${ballsOutsideSrc}
    ${resolveRingOutsSrc}
    ${stepSimSrc}
    return {
      cx, cy, R0, BR,
      place(){ placeBalls(); return balls.map(b=>({x:b.x,y:b.y,owner:b.owner,alive:b.alive})); },
      pick(who,p){ return pickOwnBall(who,p); },
      setBalls(list){ balls=list.map(b=>({x:b.x,y:b.y,vx:b.vx||0,vy:b.vy||0,sx:b.x,sy:b.y,owner:b.owner,alive:true,spin:0})); phase='sim'; outBall=-1; },
      step(){ stepSim(); },
      get(){ return { phase, balls: balls.map(b=>({x:b.x,y:b.y,alive:b.alive,owner:b.owner})) }; }
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

// ── Football: geschlossene runde Bande statt Ring-Out ──
F.setBalls([{ x: F.cx, y: F.cy + (F.R0 * 0.98), vx: 0, vy: 6, owner: 0 }, { x: F.cx, y: F.cy, owner: 4 }]);
for (let i = 0; i < 40; i++) F.step();
const fAfter = F.get();
const fDist = Math.hypot(fAfter.balls[0].x - F.cx, fAfter.balls[0].y - F.cy);
ok(fDist <= F.R0 + 1e-6, 'Football hält die Kugel innerhalb der Bande (dist ' + fDist.toFixed(2) + ' <= R ' + F.R0 + ')');
ok(fAfter.balls.every(b => b.alive), 'Football eliminiert keine Kugel (kein Ring-Out)');

// ── normale Modi unverändert: 1v1 hat zwei Kugeln, Ring-Out bleibt aktiv ──
const B = buildEnv('bot', 'single');
const bb = B.place();
ok(bb.length === 2 && JSON.stringify(bb.map(b => b.owner)) === JSON.stringify([0, 1]), 'Normaler 1v1-Aufbau unverändert (2 Kugeln [0,1])');
B.setBalls([{ x: B.cx, y: B.cy + (B.R0 * 1.2), vx: 0, vy: 4, owner: 1 }, { x: B.cx, y: B.cy, vx: 0, vy: 0, owner: 0 }]);
let ended = false;
for (let i = 0; i < 40 && !ended; i++) { B.step(); if (B.get().phase !== 'sim') ended = true; }
const bAfter = B.get();
ok(bAfter.phase === 'result' || bAfter.balls.some(b => !b.alive), 'Normaler Modus behält Ring-Out (außenliegende Kugel wird ausgewertet)');

console.log('\nFootball-Shell: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
