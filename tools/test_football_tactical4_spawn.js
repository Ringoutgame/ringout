// ARENA FOOTBALL - TACTICAL 4-BALL 1V1: DIE EROEFFNUNGSAUFSTELLUNG IST EINE AUSGEGLICHENE RAUTE.
//
// Seit 2026-09-22 stehen die vier Figuren je Spieler als RAUTE: Spitze vorn (zentral, am Ball),
// zwei Seiten auf halber Tiefe, hinten zentral vor dem eigenen Tor; Rot exakt gespiegelt.
// Diese Suite haelt fest: die eigene Konstante FOOTBALL_TACTICAL4_SPAWN, die RAUTENFORM selbst
// (Spitze und Hinterfigur auf der Torachse, Seiten spiegelgleich, gleiche Schenkel), die
// Geometrie (neun Koerper, exakte Spiegelung Blau/Rot, Abstaende, Bandenfreiheit, Torkorridor
// frei), dass die ALTE Aufstellung den leichten Eroeffnungstreffer reproduziert und die NEUE
// gar keinen mehr zulaesst - gefahren auf der ECHTEN Physik aus index.html - und dass
// Team 2v2 und Tactical 1v1 ihre Aufstellungen behalten.
//
// Die Schusssuche ist bewusst begrenzt (Winkelschritt 2 Grad, zwei Kraftstufen): sie findet
// Geometrie-Geschenke, sie beweist keine Unmoeglichkeit. Die vollstaendige Messung (1 Grad,
// fuenf Kraftstufen, alle acht Figuren) steht in artifacts/tactical4-spawn-01/eroeffnung4.js.
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
abschnitt('1. Die Raute: Form, Geometrie, Spiegelung, Freiraum');
const F = sandkasten();
const S4 = F.spawn4();
{
  t('die Konstante traegt die gemessenen Werte: (4.25,0.00) (7.00,-8.00) (7.00,8.00) (9.75,0.00)', JSON.stringify(S4) === JSON.stringify([[4.25, 0], [7, -8], [7, 8], [9.75, 0]]));
  // ── DIE RAUTE als Form, nicht als Zahlenreihe: eine Spitze vorn, zwei spiegelgleiche
  //    Seiten, eine Figur hinten - Spitze und Hinterfigur auf der Torachse.
  const [vorn, links, rechts, hinten] = S4;
  t('Raute: die Spitze steht vorn auf der Torachse (y = 0), am naechsten am Ball', vorn[1] === 0 && vorn[0] < links[0] && vorn[0] < hinten[0], vorn);
  t('Raute: die Hinterfigur steht hinten auf der Torachse (y = 0), am weitesten vom Ball', hinten[1] === 0 && hinten[0] > links[0] && hinten[0] > vorn[0], hinten);
  t('Raute: die beiden Seiten stehen auf derselben Tiefe und exakt spiegelgleich zur Torachse', links[0] === rechts[0] && links[1] === -rechts[1] && links[1] < 0 && rechts[1] > 0, [links, rechts]);
  t('Raute: die Seiten liegen auf halber Tiefe zwischen Spitze und Hinterfigur - gleiche Schenkel', Math.abs(links[0] - (vorn[0] + hinten[0]) / 2) < 1e-9
    && Math.abs(Math.hypot(links[0] - vorn[0], links[1]) - Math.hypot(hinten[0] - links[0], links[1])) < 1e-9, { s: links[0], mitte: (vorn[0] + hinten[0]) / 2 });
  t('Raute: die Diagonalen sind 5.50 BR (tief) und 16.00 BR (breit)', Math.abs((hinten[0] - vorn[0]) - 5.5) < 1e-9 && Math.abs(2 * rechts[1] - 16) < 1e-9);
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
  t('die Hinterfigur steht 8.25 BR vor der Torlinie - kein Torwart auf der Linie', A.halfLen - S4[3][0] > 8, A.halfLen - S4[3][0]);
  t('die Spitze haelt 2.47 BR Spalt zum Ball - kein Startkontakt, aber sofortiger Druck', S4[0][0] - 1 - 25 / 32 > 2 && S4[0][0] < 5, S4[0][0]);
  // Freie Bahn: kein Mitspieler naeher als 1.9 BR an der geraden Strecke Figur -> Ball.
  const bahn = (i, ziel) => { const a = K[i], b = K[ziel]; const L = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.min(...[0, 1, 2, 3].filter(j => j !== i && j !== ziel).map(j => { const c = K[j]; const tt = Math.max(0, Math.min(1, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (L * L)));
      return Math.hypot(c.x - (a.x + tt * (b.x - a.x)), c.y - (a.y + tt * (b.y - a.y))) / F.BR; })); };
  t('Spitze und beide Seiten haben eine freie gerade Bahn zum Ball', [0, 1, 2].every(i => bahn(i, 8) >= 1.9), [0, 1, 2].map(i => bahn(i, 8)));
  // Die Hinterfigur steht auf der Torachse HINTER der Spitze - das ist die Raute, kein Fehler:
  // sie ist die Aufbaufigur und spielt ueber die eigene Spitze. Genau das wird hier festgehalten,
  // damit es niemand spaeter fuer einen Fehler haelt und die Form aufbricht.
  t('die Hinterfigur spielt ueber die eigene Spitze: deren Mitte liegt auf ihrer Bahn zum Ball', bahn(3, 8) < 0.1, bahn(3, 8));
  t('... und ihre Bahn zur eigenen Spitze ist frei (Aufbau in einem Zug)', bahn(3, 0) >= 1.9, bahn(3, 0));
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
abschnitt('3. Die Raute: KEIN direkter Eroeffnungstreffer, auf keiner Kraftstufe, Blau == Rot');
{
  const E = {}; const namen = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'];
  // Vier Kraftstufen statt zwei: die Raute soll den ersten Zug auf KEINER Stufe verschenken.
  const STUFEN = [1.00, 0.85, 0.70, 0.55];
  for (let i = 0; i < 8; i++) { E[i] = {}; for (const tt of STUFEN) E[i][tt] = direkte(F, i, tt, 2); }
  for (let i = 0; i < 8; i++) {
    t(namen[i] + ': kein direkter Eroeffnungstreffer auf irgendeiner Kraftstufe (100/85/70/55 %)', STUFEN.every(tt => E[i][tt].n === 0), STUFEN.map(tt => E[i][tt].n));
    t(namen[i] + ': kein kraftrobuster Winkel, kein Eigentor', robust(E[i][1.00], E[i][0.70], 2) === 0 && STUFEN.every(tt => E[i][tt].eigentor === 0));
    t(namen[i] + ': die Figur erreicht den Ball im ersten Zug (Kontakt in mindestens 5 % der Winkel)', E[i][1.00].kontakt * 2 >= 0.05 * 360, E[i][1.00].kontakt);
  }
  t('Blau und Rot liefern Zahl fuer Zahl dieselbe Messung', [0, 1, 2, 3].every(i => STUFEN.every(tt => JSON.stringify([E[i][tt].n, E[i][tt].fenster, E[i][tt].kontakt, E[i][tt].eigentor]) === JSON.stringify([E[i + 4][tt].n, E[i + 4][tt].fenster, E[i + 4][tt].kontakt, E[i + 4][tt].eigentor]))));
  const summe = STUFEN.reduce((s, tt) => s + [0, 1, 2, 3].reduce((q, i) => q + E[i][tt].n, 0), 0);
  t('alle vier zusammen ueber alle vier Kraftstufen: null direkte Treffer (vorher 16 allein bei 100 %)', summe === 0, summe);
  // Und die SCHMALE Raute zeigt, warum die Breite noetig ist: dort prallt der Ball an der
  // gegenueberliegenden Seitenfigur des Gegners ab und laeuft ins Tor - kraftrobust.
  const schmal = sandkasten('const FOOTBALL_TACTICAL4_SPAWN=[[5.00,0.00],[7.50,-4.50],[7.50,4.50],[10.00,0.00]];');
  const s100 = direkte(schmal, 1, 1.00, 2), s85 = direkte(schmal, 1, 0.85, 2);
  t('Gegenprobe: eine SCHMALE Raute (Seiten bei +-4.50) gibt der Seitenfigur einen kraftrobusten Treffer (100 % und 85 % auf demselben Winkel)', s100.n >= 1 && robust(s100, s85, 2) >= 1, { n100: s100.n, n85: s85.n, robust: robust(s100, s85, 2) });
}

// ══ 4. DIE ANDEREN MODI SIND UNBERUEHRT ══════════════════════════════════════════
abschnitt('4. Team 2v2 und Tactical 1v1 behalten ihre Aufstellungen; Vertraege im Quelltext');
{
  t('Team 2v2: FOOTBALL_TACTICAL_SPAWN unveraendert (6.40/2.80, 12.20/4.60)', /const FOOTBALL_TACTICAL_SPAWN=\{frontX:6\.40,frontY:2\.80,backX:12\.20,backY:4\.60\};/.test(HTML) && JSON.stringify(F.spawnTeam()) === JSON.stringify({ frontX: 6.4, frontY: 2.8, backX: 12.2, backY: 4.6 }));
  t('Tactical 1v1: FOOTBALL_TACTICAL_1V1_SPAWN unveraendert (7.50/4.60, 9.80/0.00)', /const FOOTBALL_TACTICAL_1V1_SPAWN=\{frontX:7\.50,frontY:4\.60,backX:9\.80,backY:0\.00\};/.test(HTML) && JSON.stringify(F.spawn1v1()) === JSON.stringify({ frontX: 7.5, frontY: 4.6, backX: 9.8, backY: 0 }));
  t('nur die Tactical-4-Ball-Aufstellung liest FOOTBALL_TACTICAL4_SPAWN; Team 2v2 liest die Vier-Koerper-Konstante allein', (HTML.match(/for\(const p of FOOTBALL_TACTICAL4_SPAWN\)/g) || []).length === 1 && (HTML.match(/const S=FOOTBALL_TACTICAL_SPAWN;/g) || []).length === 1);
  t('die Reihenfolge der vier Paare ist die der Raute (Spitze, Seite, Seite, hinten) und placeBalls liest sie unveraendert', /for\(const p of FOOTBALL_TACTICAL4_SPAWN\)balls\.push\(mkBall\(cx\+sx\*p\[0\]\*BR,cy\+p\[1\]\*BR,s\)\);/.test(HTML));
  t('Arena, Tor, Abschusskurve, Zugformel und Frist sind nicht angefasst', /const FOOTBALL_ARENA=fbTwoGoalArena\(18\.00,12\.70,7\.65\);/.test(HTML) && /const FB_GOAL_ASSET_INNER=3\.560, FB_GOAL_ASSET_OUTER=5\.282;/.test(HTML) && /const FB_LAUNCH_SCALE=1\.26;/.test(HTML) && /function fbTacAktivSitz\(turn,g\)\{ return \(\(turn\|0\)\+\(g\|0\)\+1\)%2; \}/.test(HTML) && /const FB_V10_DEADLINE_MS=8000/.test(HTML));
}

console.log(`\nFootball-Tactical4-Spawn: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
