// ARENA FOOTBALL - TACTICAL 1V1: DIE EROEFFNUNGSAUFSTELLUNG IST AUSGEGLICHEN.
//
// Ein Zwei-Personen-Spieltest fand aus der alten Aufstellung einen leichten direkten
// Eroeffnungstreffer. Diese Suite haelt beides fest: WARUM (die alte Vier-Koerper-Aufstellung
// liefert der vorderen Figur ein breites, kraftrobustes Fenster) und DASS die neue Aufstellung
// es nicht mehr tut - gefahren auf der ECHTEN Physik aus index.html (stepSim, Arena, Abschuss-
// kurve fbLaunchMul), nicht auf einem Nachbau. Dazu die Geometrie: fuenf Koerper, exakte
// Spiegelung Blau/Rot, Abstaende, Bandenfreiheit, Torkorridor frei, deterministisch.
//
// Die Schusssuche ist bewusst begrenzt (Winkelschritt 2 Grad, zwei Kraftstufen): sie soll
// offensichtliche Geometrie-Geschenke finden, nicht beweisen, dass ein Tor unmoeglich ist.
// Ein Praezisionsschuss von einem Grad Breite darf bleiben.
//
//   node tools/test_football_tactical_spawn.js
const { loadIndexHtml, grab } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
};
const abschnitt = (s) => console.log('\n== ' + s + ' ==');
const g = (re, name) => grab(HTML, re, name);

// ── Sandbox: derselbe Aufbau wie artifacts/football-action-core/env.js ──────────────
function sandkasten(spawnZeile) {
  let html = HTML;
  if (spawnZeile) html = html.replace(/const FOOTBALL_TACTICAL_1V1_SPAWN=\{[^\n]*\};/, spawnZeile);
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
    'fbVariant=FOOTBALL_VARIANT_TACTICAL; fbElimStartN=0; fbElimReset();',
    `return {
      BR, NEU: FOOTBALL_NEUTRAL_OWNER, arena(){ const a=fbArena(); return {halfLen:a.halfLen,halfWid:a.halfWid,postInner:a.postInner}; },
      spawn1v1(){ return FOOTBALL_TACTICAL_1V1_SPAWN; }, spawn4(){ return FOOTBALL_TACTICAL_SPAWN; },
      stell(){ placeBalls(); phase='sim'; fbGoalState='play'; fbGoalTick=0; footballWinner=null; score=[0,0];
        return balls.map(b=>({x:b.x-cx,y:b.y-cy,owner:b.owner,r:ballRad(b)})); },
      boundSD(i){ return footballBoundSD(balls[i]).sd; },
      lauf(idx,grad,tt,n){
        placeBalls(); phase='sim'; fbGoalState='play'; fbGoalTick=0; footballWinner=null; score=[0,0];
        const b=balls[idx]; const pull=tt*maxPull(); const mul=fbLaunchMul(pull);
        const r=grad*Math.PI/180; b.vx=Math.cos(r)*pull*mul; b.vy=Math.sin(r)*pull*mul;
        const ball=balls.find(x=>x.owner===FOOTBALL_NEUTRAL_OWNER);
        let kontakte=0, letzt={vx:ball.vx,vy:ball.vy}, tor=false, seite=-1;
        for(let k=0;k<n;k++){
          stepSim();
          if(Math.hypot(ball.vx-letzt.vx,ball.vy-letzt.vy)>0.35)kontakte++;
          letzt={vx:ball.vx,vy:ball.vy};
          if(fbGoalState!=='play'){tor=true; seite=score[0]>0?0:(score[1]>0?1:-1); break;}
          if(balls.every(x=>Math.hypot(x.vx,x.vy)<=curST()))break;
        }
        return {tor,seite,kontakte};
      },
      // ZWEI Abschuesse in DERSELBEN Simulation (das Zugmodell von Tactical 1v1 seit 2026-09-22):
      // Figur ia (Blau) und ib (Rot) starten zugleich; gemessen wird, ob und fuer wen ein Tor
      // faellt, und ob die beiden NICHT gewaehlten Figuren dabei bewegt wurden (sie bleiben
      // physisch - nichts ist eingefroren).
      lauf2(ia,ga,ta,ib,gb,tb,n){
        placeBalls(); phase='sim'; fbGoalState='play'; fbGoalTick=0; footballWinner=null; score=[0,0];
        const setz=(idx,grad,tt)=>{ const b=balls[idx]; const pull=tt*maxPull(); const mul=fbLaunchMul(pull); const r=grad*Math.PI/180; b.vx=Math.cos(r)*pull*mul; b.vy=Math.sin(r)*pull*mul; };
        setz(ia,ga,ta); setz(ib,gb,tb);
        const ruhig=[0,1,2,3].filter(i=>i!==ia&&i!==ib).map(i=>({i,x:balls[i].x,y:balls[i].y}));
        let tor=false, seite=-1;
        for(let k=0;k<n;k++){
          stepSim();
          if(fbGoalState!=='play'){ tor=true; seite=score[0]>0?0:(score[1]>0?1:-1); break; }
          if(balls.every(x=>Math.hypot(x.vx,x.vy)<=curST()))break;
        }
        const bewegt=ruhig.filter(r=>Math.hypot(balls[r.i].x-r.x,balls[r.i].y-r.y)>0.5).length;
        return {tor,seite,bewegt};
      }
    };`
  ].join('\n'))();
}

// Direkte Eroeffnungstreffer je Figur: Tor fuer die eigene Seite nach hoechstens zwei Kontakten.
// Liefert Anzahl und breitestes zusammenhaengendes Winkelfenster (Grad).
function direkte(F, idx, tt, schritt) {
  const eigen = idx < 2 ? 0 : 1; const win = [];
  let eigentor = 0;
  for (let gr = 0; gr < 360; gr += schritt) {
    const r = F.lauf(idx, gr, tt, 1200);
    if (!r.tor) continue;
    if (r.seite === eigen) { if (r.kontakte <= 2) win.push(gr); } else eigentor++;
  }
  let fenster = 0;
  if (win.length) { const s = new Set(win); for (const gr of win) { if (s.has((gr - schritt + 360) % 360)) continue; let n = 0, h = gr; while (s.has(h) && n < 360) { n += schritt; h = (h + schritt) % 360; } fenster = Math.max(fenster, n); } }
  return { n: win.length, fenster, eigentor };
}

// ══ 1. GEOMETRIE DER NEUEN AUFSTELLUNG ═══════════════════════════════════════════
abschnitt('1. Geometrie: fuenf Koerper, gespiegelt, frei, deterministisch');
const F = sandkasten();
const S = F.spawn1v1();
{
  t('die Konstante tragt die gemessenen Werte 7.50/4.60 und 9.80/0.00', S.frontX === 7.5 && S.frontY === 4.6 && S.backX === 9.8 && S.backY === 0);
  const K = F.stell();
  t('fuenf Koerper: B1, B2, R1, R2, Ball', K.map(k => k.owner).join(',') === '0,0,1,1,' + F.NEU);
  const nahe = (a, b) => Math.abs(a - b) < 1e-6;
  t('B1 (front) bei -7.50/-4.60 BR, B2 (back) bei -9.80/0', nahe(K[0].x, -7.5 * F.BR) && nahe(K[0].y, -4.6 * F.BR) && nahe(K[1].x, -9.8 * F.BR) && nahe(K[1].y, 0));
  t('Rot ist die exakte Spiegelung von Blau an der Mittelachse', K[2].x === -K[0].x && K[2].y === K[0].y && K[3].x === -K[1].x && K[3].y === K[1].y);
  t('der Ball liegt exakt in der Mitte', K[4].x === 0 && K[4].y === 0);
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let minGap = Infinity; for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) minGap = Math.min(minGap, d(K[i], K[j]) - K[i].r - K[j].r);
  t('kein Startkontakt: kleinster Spalt zwischen zwei Koerpern > 2 BR', minGap > 2 * F.BR, minGap / F.BR);
  t('die beiden eigenen Figuren stehen >= 5 BR auseinander (Touch bleibt eindeutig, Griffweite 2.8 BR)', d(K[0], K[1]) >= 5 * F.BR, d(K[0], K[1]) / F.BR);
  const A = F.arena();
  t('keine Figur an der Bande: Oberflaeche > 3 BR von jeder Grenze', [0, 1, 2, 3].every(i => -F.boundSD(i) > 3 * F.BR));
  t('keine Figur startet direkt an der Torlinie (halfLen - |x| > 4 BR)', [0, 1, 2, 3].every(i => A.halfLen * F.BR - Math.abs(K[i].x) > 4 * F.BR));
  t('der Torkorridor bleibt frei: jede Figur mit |x| > halfLen - 8 BR steht ausserhalb der lichten Torbreite', [0, 1, 2, 3].every(i => Math.abs(K[i].x) <= (A.halfLen - 8) * F.BR || Math.abs(K[i].y) > A.postInner * F.BR));
  t('die tiefe Figur steht 8.2 BR VOR der Torlinie - kein Torwart auf der Linie', A.halfLen - S.backX > 8);
  t('placeBalls ist deterministisch', JSON.stringify(F.stell()) === JSON.stringify(K));
  t('beide Figuren je Seite haben denselben Abstand zum Ball wie ihr Gegenstueck', [0, 1].every(i => Math.abs(Math.hypot(K[i].x, K[i].y) - Math.hypot(K[i + 2].x, K[i + 2].y)) < 1e-9));
}

// ══ 2. DIE ALTE AUFSTELLUNG: DAS GESCHENK IST REPRODUZIERBAR ═════════════════════
abschnitt('2. Die alte Vier-Koerper-Aufstellung liefert der vorderen Figur einen leichten Eroeffnungstreffer');
{
  const S4 = F.spawn4();
  const alt = sandkasten('const FOOTBALL_TACTICAL_1V1_SPAWN={frontX:' + S4.frontX.toFixed(2) + ',frontY:' + S4.frontY.toFixed(2) + ',backX:' + S4.backX.toFixed(2) + ',backY:' + S4.backY.toFixed(2) + '};');
  const K = alt.stell();
  t('Kontrolle: die alte Aufstellung ist geladen (B1 bei -6.40/-2.80)', Math.abs(K[0].x + 6.4 * alt.BR) < 1e-6 && Math.abs(K[0].y + 2.8 * alt.BR) < 1e-6, [K[0].x, K[0].y]);
  const v100 = direkte(alt, 0, 1.00, 2), v70 = direkte(alt, 0, 0.70, 2);
  t('alt, B1 bei 100 %: mindestens drei direkte Treffer bei 2-Grad-Schritt (breites Fenster)', v100.n >= 3 && v100.fenster >= 4, v100);
  t('alt, B1 bei 70 %: der Treffer bleibt auch bei geringerer Kraft (kraftrobust)', v70.n >= 2, v70);
}

// ══ 3. DIE NEUE AUFSTELLUNG: KEIN OFFENSICHTLICHER EROEFFNUNGSTREFFER ═══════════
abschnitt('3. Die neue Aufstellung: hoechstens ein 2-Grad-Fenster, keine kraftrobuste Wiederholung');
{
  const E = {};
  for (const idx of [0, 1, 2, 3]) E[idx] = { 100: direkte(F, idx, 1.00, 2), 70: direkte(F, idx, 0.70, 2) };
  const namen = ['B1', 'B2', 'R1', 'R2'];
  for (const idx of [0, 1, 2, 3]) {
    t(namen[idx] + ' bei 100 %: hoechstens ein direkter Treffer, Fenster <= 2 Grad', E[idx][100].n <= 1 && E[idx][100].fenster <= 2, E[idx][100]);
    t(namen[idx] + ' bei 70 %: kein direkter Treffer', E[idx][70].n === 0, E[idx][70]);
    t(namen[idx] + ': kein Eigentor aus der Eroeffnung', E[idx][100].eigentor === 0 && E[idx][70].eigentor === 0);
  }
  t('Blau und Rot liefern Zahl fuer Zahl dieselbe Messung (Fairness unabhaengig vom Eroeffner)', [0, 1].every(i => JSON.stringify(E[i]) === JSON.stringify(E[i + 2])), E);
}

// ══ 4. DIE VERTRAEGE IM QUELLTEXT ════════════════════════════════════════════════
abschnitt('4. Vertraege im Quelltext');
{
  t('Tactical 1v1 liest seine eigene Konstante; Team 2v2 die Vier-Koerper-Konstante; Tactical 4-Ball seine eigene',
    (HTML.match(/const S=FOOTBALL_TACTICAL_1V1_SPAWN;/g) || []).length === 1 && (HTML.match(/const S=FOOTBALL_TACTICAL_SPAWN;/g) || []).length === 1 && (HTML.match(/for\(const p of FOOTBALL_TACTICAL4_SPAWN\)/g) || []).length === 1);
  t('die Vier-Koerper-Konstante ist unveraendert (Team 2v2 / Tactical 4-Ball nicht betroffen)', /const FOOTBALL_TACTICAL_SPAWN=\{frontX:6\.40,frontY:2\.80,backX:12\.20,backY:4\.60\};/.test(HTML));
  t('Arena, Tor und Abschusskurve sind nicht angefasst', /const FOOTBALL_ARENA=fbTwoGoalArena\(18\.00,12\.70,7\.65\);/.test(HTML) && /const FB_GOAL_ASSET_INNER=3\.560, FB_GOAL_ASSET_OUTER=5\.282;/.test(HTML) && /const FB_LAUNCH_SCALE=1\.26;/.test(HTML));
  t('die Zugformel und die Frist sind nicht angefasst', /function fbTacAktivSitz\(turn,g\)\{ return \(\(turn\|0\)\+\(g\|0\)\+1\)%2; \}/.test(HTML) && /const FB_V10_DEADLINE_MS=8000/.test(HTML));
}

// ══ 5. GLEICHZEITIGE EROEFFNUNG ══════════════════════════════════════════════════
// Seit 2026-09-22 schiessen in Tactical 1v1 BEIDE in derselben Runde - auch in der ersten.
// Die Analyse in Abschnitt 3 galt dem alleinigen Eroeffnungsschuss (der Gegner steht still).
// Hier wird begrenzt gesucht, ob das ZUSAMMENSPIEL zweier Startvektoren ein neues Geschenk
// erzeugt. Raster je Seite: beide Figuren, 10-Grad-Schritt, 100 % und 70 % Kraft (144 Schuesse
// je Seite, 20 736 Paare auf der echten Physik; das Raster ist spiegelsymmetrisch). Gemessen wird je Schuss der Anteil der
// gegnerischen Antworten, gegen die er trifft - getrennt danach, WELCHE Figur der Gegner
// bewegt. Denn das ist der strukturelle Befund dieser Aufstellung: die hintere Figur (B2/R2)
// steht in der Schusslinie der gegnerischen hinteren Figur. Bleibt sie stehen, ist die Linie
// zu; wird sie bewegt, ist sie offen. Das ist kein Freitor, sondern die Entscheidung "wer
// seine hintere Figur bewegt, oeffnet dem Gegner die Mitte" - fuer beide Seiten gleich.
// Bewiesen wird: kein garantiertes Tor; kein Tor gegen einen Gegner, der seine hintere Figur
// stehen laesst; Blau und Rot Zahl fuer Zahl gleich; beide gerade hintere Schuesse zugleich
// ergeben kein Tor; die nicht gewaehlten Figuren bleiben physisch.
abschnitt('5. Gleichzeitige Eroeffnung: kein Freitor - nur wer die hintere Figur bewegt, oeffnet die Mitte');
{
  // Das Raster ist spiegelsymmetrisch (180 - k*10 liegt wieder auf dem Raster): nur so ist der
  // Vergleich Blau/Rot Zahl fuer Zahl moeglich - bei 8 Grad laege Rots gerader Schuss (180) daneben.
  const SCHRITT = 10, N = 1200;
  const blau = [], rot = [];
  for (const idx of [0, 1]) for (let gr = 0; gr < 360; gr += SCHRITT) for (const tt of [1.00, 0.70]) blau.push({ idx, gr, tt });
  for (const idx of [2, 3]) for (let gr = 0; gr < 360; gr += SCHRITT) for (const tt of [1.00, 0.70]) rot.push({ idx, gr, tt });
  // treff[Seite][Schuss][GegnerFigur] = Zahl der Treffer gegen Antworten mit dieser Figur.
  const zB = blau.map(() => ({ 2: 0, 3: 0, eigen: 0 })), zR = rot.map(() => ({ 0: 0, 1: 0, eigen: 0 }));
  const je = { 2: rot.filter(r => r.idx === 2).length, 3: rot.filter(r => r.idx === 3).length, 0: blau.filter(b => b.idx === 0).length, 1: blau.filter(b => b.idx === 1).length };
  let paare = 0, tore = 0, bewegtPaare = 0;
  const t0 = Date.now();
  for (let a = 0; a < blau.length; a++) for (let b = 0; b < rot.length; b++) {
    const r = F.lauf2(blau[a].idx, blau[a].gr, blau[a].tt, rot[b].idx, rot[b].gr, rot[b].tt, N);
    paare++;
    if (r.bewegt > 0) bewegtPaare++;
    if (!r.tor) continue;
    tore++;
    if (r.seite === 0) { zB[a][rot[b].idx]++; zR[b].eigen++; } else if (r.seite === 1) { zR[b][blau[a].idx]++; zB[a].eigen++; }
  }
  const dauer = Date.now() - t0;
  // Anteile: gesamt, gegen "Gegner bewegt die vordere Figur", gegen "Gegner bewegt die hintere".
  const antB = blau.map((_, a) => ({ ges: (zB[a][2] + zB[a][3]) / rot.length, vorn: zB[a][2] / je[2], hinten: zB[a][3] / je[3], eigen: zB[a].eigen / rot.length }));
  const antR = rot.map((_, b) => ({ ges: (zR[b][0] + zR[b][1]) / blau.length, vorn: zR[b][0] / je[0], hinten: zR[b][1] / je[1], eigen: zR[b].eigen / blau.length }));
  const maxVon = (arr, k) => arr.reduce((m, x) => Math.max(m, x[k]), 0);
  const bestB = blau[antB.map(x => x.ges).indexOf(maxVon(antB, 'ges'))], bestR = rot[antR.map(x => x.ges).indexOf(maxVon(antR, 'ges'))];
  console.log('  Paare ' + paare + ', Tore ' + tore + ' (' + (100 * tore / paare).toFixed(2) + ' %), ' + dauer + ' ms');
  console.log('  bester Blau-Schuss ' + JSON.stringify(bestB) + ': trifft in ' + (100 * maxVon(antB, 'ges')).toFixed(1) + ' % aller Rot-Antworten - gegen "Rot bewegt R1 (vorn)" ' + (100 * antB[blau.indexOf(bestB)].vorn).toFixed(1) + ' %, gegen "Rot bewegt R2 (hinten)" ' + (100 * antB[blau.indexOf(bestB)].hinten).toFixed(1) + ' %');
  console.log('  bester Rot-Schuss  ' + JSON.stringify(bestR) + ': trifft in ' + (100 * maxVon(antR, 'ges')).toFixed(1) + ' % aller Blau-Schuesse - gegen "Blau bewegt B1 (vorn)" ' + (100 * antR[rot.indexOf(bestR)].vorn).toFixed(1) + ' %, gegen "Blau bewegt B2 (hinten)" ' + (100 * antR[rot.indexOf(bestR)].hinten).toFixed(1) + ' %');
  console.log('  hoechster Anteil gegen einen Gegner, der die hintere Figur stehen laesst: Blau ' + (100 * maxVon(antB, 'vorn')).toFixed(1) + ' %, Rot ' + (100 * maxVon(antR, 'vorn')).toFixed(1) + ' %');
  t('kein Schuss trifft GARANTIERT (gegen jede Antwort)', maxVon(antB, 'ges') < 1 && maxVon(antR, 'ges') < 1, { maxB: maxVon(antB, 'ges'), maxR: maxVon(antR, 'ges') });
  t('gegen einen Gegner, der seine hintere Figur stehen laesst, trifft kein Schuss in mehr als 15 % der Antworten - die Mitte ist zu', maxVon(antB, 'vorn') <= 0.15 && maxVon(antR, 'vorn') <= 0.15, { blau: maxVon(antB, 'vorn'), rot: maxVon(antR, 'vorn') });
  t('kein Schuss trifft gegen die Mehrheit aller Antworten, wenn man beide Gegnerfiguren zusammennimmt (kein dominantes Freitor)', maxVon(antB, 'ges') <= 0.5 && maxVon(antR, 'ges') <= 0.5, { maxB: maxVon(antB, 'ges'), maxR: maxVon(antR, 'ges') });
  t('Blau und Rot liefern denselben besten Anteil (Fairness: kein Seitenvorteil aus dem Zusammenspiel)', Math.abs(maxVon(antB, 'ges') - maxVon(antR, 'ges')) <= 2 / rot.length + 1e-9 && Math.abs(maxVon(antB, 'hinten') - maxVon(antR, 'hinten')) <= 2 / je[3] + 1e-9, { b: maxVon(antB, 'ges'), r: maxVon(antR, 'ges') });
  t('Tore aus zwei gleichzeitigen Eroeffnungsschuessen sind selten (< 5 % aller Paare)', tore / paare < 0.05, tore / paare);
  t('Eigentore bleiben die Ausnahme: kein Schuss faengt sich in mehr als 10 % der Antworten ein Eigentor', maxVon(antB, 'eigen') <= 0.10 && maxVon(antR, 'eigen') <= 0.10, { b: maxVon(antB, 'eigen'), r: maxVon(antR, 'eigen') });
  // Beide hintere Figuren gerade aufeinander zu - die natuerlichste beidseitige Eroeffnung.
  const gerade = [1.00, 0.70].map(tt => [1.00, 0.70].map(tt2 => F.lauf2(1, 0, tt, 3, 180, tt2, N)));
  t('beide hintere Figuren gerade zugleich (alle vier Kraftpaare): kein Tor fuer irgendeine Seite - der Wirt hat keinen Vorteil aus der Rechenreihenfolge', gerade.every(z => z.every(r => r.tor === false)), gerade.map(z => z.map(r => r.seite)));
  t('die zwei nicht gewaehlten Figuren bleiben physisch: in vielen Paaren werden sie durch Kollisionen bewegt', bewegtPaare > paare * 0.05, bewegtPaare / paare);
  t('die Messung bleibt begrenzt (unter 90 s)', dauer < 90000, dauer);
}

console.log(`\nFootball-Tactical-Spawn: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
