// ARENA FOOTBALL - TACTICAL 4-BALL 1V1: DIE EROEFFNUNGSAUFSTELLUNG IST AUSGEGLICHEN.
//
// Die erste Aufstellung von Tactical 4-Ball war die gespiegelte Vier-Koerper-Aufstellung von
// Team 2v2; aus ihr hatte das vordere Paar einen leichten direkten Eroeffnungstreffer. Diese
// Suite haelt fest: die eigene Konstante FOOTBALL_TACTICAL4_SPAWN, ihre Geometrie (neun
// Koerper, exakte Spiegelung Blau/Rot, Abstaende, Bandenfreiheit, Torkorridor frei, freie Bahn
// jeder Figur zum Ball), dass die ALTE Aufstellung den leichten Treffer reproduziert und die
// NEUE nicht - gefahren auf der ECHTEN Physik aus index.html - und dass Team 2v2 und
// Tactical 1v1 ihre Aufstellungen behalten.
//
// Die Schusssuche ist bewusst begrenzt (Winkelschritt 2 Grad, zwei Kraftstufen): sie findet
// Geometrie-Geschenke, sie beweist keine Unmoeglichkeit. Ein Praezisionsschuss darf bleiben.
//
//   node tools/test_football_tactical4_spawn.js
const { loadIndexHtml, grab } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
};
const abschnitt = (s) => console.log('\n== ' + s + ' ==');
const KONST = /const FOOTBALL_TACTICAL4_SPAWN=\[[^\n]*\];/;

function sandkasten(spawnZeile) {
  let html = HTML;
  if (spawnZeile) html = html.replace(KONST, spawnZeile);
  const gg = (re, name) => grab(html, re, name);
  return new Function([
    'const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;',
    gg(/const MAXPULL_FRAC=[^\n]*/, 'Physikkonstanten'),
    gg(/const SPIN_K=[^\n]*/, 'Spin'),
    gg(/const PCOLS=[^\n]*/, 'PCOLS'),
    'const TUNE=null; function maxPull(){return R0*MAXPULL_FRAC;}',
    "let balls=[], phase='sim', outBall=-1, roundWinner=-1;",
    'let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];',
    "let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false; let mode='football', fmt='single';",
    'let score=[0,0], roundNo=1, r3dActive=false;',
    'const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},footballGoal(){},footballGoalPreload(){},footballGoalStop(){},fbTransitionBed(){},fbTransitionLock(){},fbTransitionStop(){}};',
    "function spawn(){} function popBall(){} function winnerRGB(){return '';} function fx3Hit(){} function fx3Dust(){}",
    'function setPhase(p){phase=p;} function updateHud(){} function setPhaseText(){} function onlineArmTurn(){} function openCover(){} function cancelAimDrag(){}',
    'function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;} function gameOver(){phase="over";}',
    gg(/function mkBall\([^\n]*/, 'mkBall'),
    gg(/function teamCap\([^\n]*/, 'teamCap'),
    gg(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls'),
    gg(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside'),
    gg(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts'),
    gg(/function np\([^\n]*/, 'np'),
    gg(/function resetCommits\(\)\{[\s\S]*?\n\}/, 'resetCommits'),
    gg(/function startRound\(\)\{[\s\S]*?\n\}/, 'startRound'),
    gg(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nfunction stepSim\(\)\{)/, 'Football-Block'),
    gg(/function curFR\(\)[^\n]*/, 'curFR'), gg(/function curFE\(\)[^\n]*/, 'curFE'), gg(/function curST\(\)[^\n]*/, 'curST'),
    gg(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim'),
    gg(/const FB_LAUNCH_SCALE=[\s\S]*?\nfunction fbLaunchMul\(len\)\{[\s\S]*?\n\}/, 'fbLaunchMul'),
    'fbVariant=FOOTBALL_VARIANT_TACTICAL4; fbElimStartN=0; fbElimReset();',
    `return {
      BR, NEU: FOOTBALL_NEUTRAL_OWNER, arena(){ const a=fbArena(); return {halfLen:a.halfLen,halfWid:a.halfWid,postInner:a.postInner}; },
      spawn4(){ return FOOTBALL_TACTICAL4_SPAWN; }, spawnTeam(){ return FOOTBALL_TACTICAL_SPAWN; }, spawn1v1(){ return FOOTBALL_TACTICAL_1V1_SPAWN; },
      stell(){ placeBalls(); phase='sim'; fbGoalState='play'; fbGoalTick=0; footballWinner=null; score=[0,0];
        return balls.map(b=>({x:b.x-cx,y:b.y-cy,owner:b.owner,r:ballRad(b)})); },
      boundSD(i){ return footballBoundSD(balls[i]).sd; },
      lauf(idx,grad,tt,n){
        placeBalls(); phase='sim'; fbGoalState='play'; fbGoalTick=0; footballWinner=null; score=[0,0];
        const b=balls[idx]; const pull=tt*maxPull(); const mul=fbLaunchMul(pull);
        const r=grad*Math.PI/180; b.vx=Math.cos(r)*pull*mul; b.vy=Math.sin(r)*pull*mul;
        const ball=balls.find(x=>x.owner===FOOTBALL_NEUTRAL_OWNER);
        let kontakte=0, letzt={vx:ball.vx,vy:ball.vy}, tor=false, seite=-1, bewegt=false;
        for(let k=0;k<n;k++){
          stepSim();
          if(Math.hypot(ball.vx-letzt.vx,ball.vy-letzt.vy)>0.35){kontakte++;bewegt=true;}
          letzt={vx:ball.vx,vy:ball.vy};
          if(fbGoalState!=='play'){tor=true; seite=score[0]>0?0:(score[1]>0?1:-1); break;}
          if(balls.every(x=>Math.hypot(x.vx,x.vy)<=curST()))break;
        }
        return {tor,seite,kontakte,bewegt};
      }
    };`
  ].join('\n'))();
}

// Direkte Eroeffnungstreffer je Figur (Tor fuer die eigene Seite nach <= 2 Ballkontakten):
// Winkel, Anzahl, breitestes Fenster, Eigentore, Ballkontakte.
function direkte(F, idx, tt, schritt) {
  const eigen = idx < 4 ? 0 : 1; const win = []; let eigentor = 0, kontakt = 0;
  for (let gr = 0; gr < 360; gr += schritt) {
    const r = F.lauf(idx, gr, tt, 1200);
    if (r.bewegt) kontakt++;
    if (!r.tor) continue;
    if (r.seite === eigen) { if (r.kontakte <= 2) win.push(gr); } else eigentor++;
  }
  let fenster = 0;
  if (win.length) { const s = new Set(win); for (const gr of win) { if (s.has((gr - schritt + 360) % 360)) continue; let n = 0, h = gr; while (s.has(h) && n < 360) { n += schritt; h = (h + schritt) % 360; } fenster = Math.max(fenster, n); } }
  return { n: win.length, fenster, eigentor, kontakt, winkel: win };
}
const robust = (a, b, schritt) => { const s = new Set(b.winkel); return a.winkel.filter(g => s.has(g) || s.has((g + schritt) % 360) || s.has((g - schritt + 360) % 360)).length; };

// ══ 1. GEOMETRIE ═════════════════════════════════════════════════════════════════
abschnitt('1. Geometrie: neun Koerper, gespiegelt, frei, jede Figur mit freier Bahn zum Ball');
const F = sandkasten();
const S4 = F.spawn4();
{
  t('die Konstante traegt die gemessenen Werte: (7.50,-5.00) (7.50,5.00) (9.40,0.00) (12.60,4.00)', JSON.stringify(S4) === JSON.stringify([[7.5, -5], [7.5, 5], [9.4, 0], [12.6, 4]]));
  const K = F.stell();
  t('neun Koerper: A1..A4, B1..B4, Ball', K.map(k => k.owner).join(',') === '0,0,0,0,1,1,1,1,' + F.NEU);
  const nahe = (a, b) => Math.abs(a - b) < 1e-6;
  t('Blau steht auf den Sollkoordinaten bei -x', [0, 1, 2, 3].every(i => nahe(K[i].x, -S4[i][0] * F.BR) && nahe(K[i].y, S4[i][1] * F.BR)));
  t('Rot ist die exakte Spiegelung von Blau an der Mittelachse', [0, 1, 2, 3].every(i => nahe(K[i + 4].x, -K[i].x) && nahe(K[i + 4].y, K[i].y)));
  t('der Ball liegt exakt in der Mitte', K[8].x === 0 && K[8].y === 0);
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let minGap = Infinity, minEigen = Infinity;
  for (let i = 0; i < 9; i++) for (let j = i + 1; j < 9; j++) { minGap = Math.min(minGap, d(K[i], K[j]) - K[i].r - K[j].r); if (i < 4 && j < 4) minEigen = Math.min(minEigen, d(K[i], K[j])); }
  t('kein Startkontakt: kleinster Spalt zwischen zwei Koerpern > 2 BR', minGap > 2 * F.BR, minGap / F.BR);
  t('eigene Figuren stehen >= 5 BR auseinander (Touch eindeutig bei 2.8 BR Griffweite)', minEigen >= 5 * F.BR, minEigen / F.BR);
  const A = F.arena();
  t('keine Figur an der Bande: Oberflaeche > 3 BR von jeder Grenze', [0, 1, 2, 3, 4, 5, 6, 7].every(i => -F.boundSD(i) > 3 * F.BR));
  t('keine Figur direkt an der Torlinie (halfLen - |x| > 4 BR)', [0, 1, 2, 3, 4, 5, 6, 7].every(i => A.halfLen * F.BR - Math.abs(K[i].x) > 4 * F.BR));
  t('der Torkorridor bleibt frei: |x| > halfLen - 8 BR nur ausserhalb der lichten Torbreite', [0, 1, 2, 3, 4, 5, 6, 7].every(i => Math.abs(K[i].x) <= (A.halfLen - 8) * F.BR || Math.abs(K[i].y) > A.postInner * F.BR));
  t('der Blocker steht 8.6 BR vor der Torlinie - kein Torwart auf der Linie', A.halfLen - S4[2][0] > 8);
  // Freie Bahn: kein Mitspieler naeher als 1.9 BR an der geraden Strecke Figur -> Ball.
  const bahnFrei = (i) => { const a = K[i], b = K[8]; const L = Math.hypot(b.x - a.x, b.y - a.y);
    return [0, 1, 2, 3].filter(j => j !== i).every(j => { const c = K[j]; const tt = Math.max(0, Math.min(1, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (L * L)));
      return Math.hypot(c.x - (a.x + tt * (b.x - a.x)), c.y - (a.y + tt * (b.y - a.y))) >= 1.9 * F.BR; }); };
  t('jede der vier Figuren hat eine freie gerade Bahn zum Ball (keine steht hinter Mitspielern)', [0, 1, 2, 3].every(bahnFrei));
  t('placeBalls ist deterministisch', JSON.stringify(F.stell()) === JSON.stringify(K));
}

// ══ 2. DIE ALTE AUFSTELLUNG REPRODUZIERT DEN LEICHTEN TREFFER ═══════════════════
abschnitt('2. Die alte (gespiegelte Vier-Koerper-)Aufstellung liefert dem vorderen Paar einen leichten Eroeffnungstreffer');
{
  const alt = sandkasten('const FOOTBALL_TACTICAL4_SPAWN=[[6.40,-2.80],[12.20,4.60],[6.40,2.80],[12.20,-4.60]];');
  const K = alt.stell();
  t('Kontrolle: die alte Aufstellung ist geladen (A1 bei -6.40/-2.80)', Math.abs(K[0].x + 6.4 * alt.BR) < 1e-6 && Math.abs(K[0].y + 2.8 * alt.BR) < 1e-6);
  const a100 = direkte(alt, 0, 1.00, 2), a70 = direkte(alt, 0, 0.70, 2);
  t('alt, A1 bei 100 %: mindestens drei direkte Treffer bei 2-Grad-Schritt, Fenster >= 4 Grad', a100.n >= 3 && a100.fenster >= 4, a100);
  t('alt, A1 bei 70 %: der Treffer bleibt (kraftrobust)', a70.n >= 2 && robust(a100, a70, 2) >= 1, { n: a70.n, robust: robust(a100, a70, 2) });
  t('alt, A3 ebenso', direkte(alt, 2, 1.00, 2).n >= 3);
}

// ══ 3. DIE NEUE AUFSTELLUNG ══════════════════════════════════════════════════════
abschnitt('3. Die neue Aufstellung: hoechstens ein 2-Grad-Fenster, nicht kraftrobust, Blau == Rot');
{
  const E = {}; const namen = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'];
  for (let i = 0; i < 8; i++) E[i] = { 100: direkte(F, i, 1.00, 2), 70: direkte(F, i, 0.70, 2) };
  for (let i = 0; i < 8; i++) {
    t(namen[i] + ' bei 100 %: hoechstens ein direkter Treffer, Fenster <= 2 Grad', E[i][100].n <= 1 && E[i][100].fenster <= 2, { n: E[i][100].n, fenster: E[i][100].fenster });
    t(namen[i] + ' bei 70 %: kein direkter Treffer', E[i][70].n === 0, E[i][70].n);
    t(namen[i] + ': kein kraftrobuster Winkel, kein Eigentor', robust(E[i][100], E[i][70], 2) === 0 && E[i][100].eigentor === 0 && E[i][70].eigentor === 0);
    t(namen[i] + ': die Figur erreicht den Ball im ersten Zug (Kontakt in mindestens 3 % der Winkel)', E[i][100].kontakt * 2 >= 0.03 * 360, E[i][100].kontakt);
  }
  t('Blau und Rot liefern Zahl fuer Zahl dieselbe Messung', [0, 1, 2, 3].every(i => JSON.stringify([E[i][100].n, E[i][100].fenster, E[i][100].kontakt, E[i][70].n]) === JSON.stringify([E[i + 4][100].n, E[i + 4][100].fenster, E[i + 4][100].kontakt, E[i + 4][70].n])));
  const summe = [0, 1, 2, 3].reduce((s, i) => s + E[i][100].n, 0);
  t('alle vier zusammen: hoechstens zwei direkte Treffer bei 100 % (vorher 16)', summe <= 2, summe);
}

// ══ 4. DIE ANDEREN MODI SIND UNBERUEHRT ══════════════════════════════════════════
abschnitt('4. Team 2v2 und Tactical 1v1 behalten ihre Aufstellungen; Vertraege im Quelltext');
{
  t('Team 2v2: FOOTBALL_TACTICAL_SPAWN unveraendert (6.40/2.80, 12.20/4.60)', /const FOOTBALL_TACTICAL_SPAWN=\{frontX:6\.40,frontY:2\.80,backX:12\.20,backY:4\.60\};/.test(HTML) && JSON.stringify(F.spawnTeam()) === JSON.stringify({ frontX: 6.4, frontY: 2.8, backX: 12.2, backY: 4.6 }));
  t('Tactical 1v1: FOOTBALL_TACTICAL_1V1_SPAWN unveraendert (7.50/4.60, 9.80/0.00)', /const FOOTBALL_TACTICAL_1V1_SPAWN=\{frontX:7\.50,frontY:4\.60,backX:9\.80,backY:0\.00\};/.test(HTML) && JSON.stringify(F.spawn1v1()) === JSON.stringify({ frontX: 7.5, frontY: 4.6, backX: 9.8, backY: 0 }));
  t('nur die Tactical-4-Ball-Aufstellung liest FOOTBALL_TACTICAL4_SPAWN; Team 2v2 liest die Vier-Koerper-Konstante allein', (HTML.match(/for\(const p of FOOTBALL_TACTICAL4_SPAWN\)/g) || []).length === 1 && (HTML.match(/const S=FOOTBALL_TACTICAL_SPAWN;/g) || []).length === 1);
  t('Arena, Tor, Abschusskurve, Zugformel und Frist sind nicht angefasst', /const FOOTBALL_ARENA=fbTwoGoalArena\(18\.00,12\.70,7\.65\);/.test(HTML) && /const FB_GOAL_ASSET_INNER=3\.560, FB_GOAL_ASSET_OUTER=5\.282;/.test(HTML) && /const FB_LAUNCH_SCALE=1\.26;/.test(HTML) && /function fbTacAktivSitz\(turn,g\)\{ return \(\(turn\|0\)\+\(g\|0\)\+1\)%2; \}/.test(HTML) && /const FB_V10_DEADLINE_MS=8000/.test(HTML));
}

console.log(`\nFootball-Tactical4-Spawn: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
