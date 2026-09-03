// ARENA FOOTBALL — DIE TOROEFFNUNG.
//
// Die lichte Oeffnung ist 227.84 px breit, der Ball 50 px dick. Er passt hindurch, solange
// seine MITTE hoechstens (clearHalf - r) von der Torachse entfernt ist. Das war schon
// immer richtig. Falsch war, WER zurueckweist: fuer einen Ball, dessen Mitte zwischen
// (clearHalf - r) und clearHalf liegt - sichtbar im offenen Tor, nur mit der Kante im
// Pfosten - griff die gerade Stirnbande. Sie griff bis zu 20.3 px frueher als der Sockel
// und hat die Normale (-1,0): der Ball flog exakt 180 Grad zurueck, quer durch die Arena.
// Der Spieler sah ihn ins offene Tor laufen und von nichts Sichtbarem zurueckgeschlagen
// werden.
//
// Diese Suite haelt den neuen Vertrag fest:
//   1. Im sichtbaren Torfenster gibt es fuer den neutralen Ball KEINE Bande.
//   2. Zurueck weist dort der SOCKEL - mit seiner echten Kantennormale, gefegt geprueft,
//      damit ein schneller Ball nicht an der Kante vorbeispringt.
//   3. Ausserhalb des Fensters bleibt der Einschluss unveraendert streng.
//   4. Die Wertung selbst ist unangetastet.
//
// Gefahren wird die ECHTE Physik aus index.html - kein Nachbau.
//
//   node tools/test_football_goal_mouth.js
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const NL = String.fromCharCode(10);

function grab(re, name) {
  const m = SRC.match(re);
  if (!m) { console.error('FAIL: kann ' + name + ' nicht extrahieren'); process.exit(2); }
  return m[0];
}

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL: ' + msg); } };

const footballBlock = grab(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nfunction stepSim\(\)\{)/, 'Football-Block');
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const consts = grab(/const MAXPULL_FRAC=[^\n]*/, 'Physikkonstanten');
const spin = grab(/const SPIN_K=[^\n]*/, 'Spin');
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

function buildEnv() {
  return new Function(`
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${consts}
    ${spin}
    ${pcols}
    const TUNE=null;
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', outBall=-1, roundWinner=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false;
    let mode='football', fmt='single';
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
      // Die gefegte Pruefung fuer sich allein: eine Strecke hinein, Treffer und Endlage
      // heraus. So laesst sich die Sehne ueber eine Sockelecke pruefen, deren beide
      // Endpunkte frei sind - ein Fall, den eine reine Flugbahnprobe nur zufaellig traefe.
      rawSweep(ax,ay,bx,by){
        const b={x:cx+bx,y:cy+by,vx:bx-ax,vy:by-ay,owner:FOOTBALL_NEUTRAL_OWNER,alive:true,spin:0};
        balls=[b];
        const hit=footballSweepPost(b,cx+ax,cy+ay);
        const p=footballPostProbe(b);
        return {hit,x:b.x-cx,y:b.y-cy,d:p?p.d:null,r:ballRad(b)};
      },
      BR,
      classic(){ fbVariant='classic'; fbElimStartN=0; fbElimReset(); },
      phaseN(n){ fbVariant=FOOTBALL_VARIANT_ELIM; fbElimStartN=n; fbElimReset();
                 fbElimPhaseN=n; fbElimApplyPhase(); },
      arena(){ const a=fbArena(); return {halfLen:a.halfLen,postInner:a.postInner,
        postOuter:a.postOuter,postFront:a.postFront,postBack:a.postBack}; },
      dirs(){ return fbElim4()?fbElimDirs().map(d=>d.slice()):[[1,0],[-1,0]]; },
      clearHalf(){ return footballGoalClearHalf(); },
      centerHalf(){ return footballGoalCenterHalf(); },
      ballR(){ return fbBallR(); },
      launchV(){ return maxPull()*LAUNCH; },
      window(x,y,owner){ return footballGoalWindow({x:cx+x,y:cy+y,
        owner:owner===undefined?FOOTBALL_NEUTRAL_OWNER:owner,alive:true}); },
      canPass(x,y,owner){ return footballCanPassGoal({x:cx+x,y:cy+y,
        owner:owner===undefined?FOOTBALL_NEUTRAL_OWNER:owner,alive:true}); },
      over(x,y,owner){ const b={x:cx+x,y:cy+y,
        owner:owner===undefined?FOOTBALL_NEUTRAL_OWNER:owner,alive:true};
        return footballBoundSD(b).sd-footballRescueLimit(b); },
      postD(x,y,owner){ const p=footballPostProbe({x:cx+x,y:cy+y,
        owner:owner===undefined?FOOTBALL_NEUTRAL_OWNER:owner,alive:true});
        return p?p.d:null; },
      rescueDepth(){ return footballRescueDepth(); },
      // Ein Schuss. Meldet Tor, Torseite, Endlage, groessten Bandenueberschuss AUSSERHALB
      // eines Torfensters und ob je ein NaN auftrat.
      shoot(x0,y0,vx,vy,n){
        const b0x=cx+x0, b0y=cy+y0;
        balls=[{x:cx+x0,y:cy+y0,vx,vy,sx:cx+x0,sy:cy+y0,owner:FOOTBALL_NEUTRAL_OWNER,alive:true,spin:0}];
        phase='sim'; fbGoalState='play'; fbGoalTick=0; footballWinner=null; score=[0,0];
        let maxAus=0, nan=false, umkehr=false, umkehrUeber=Infinity, entwischt=false;
        let durchMarmor=false;
        const av=fbArena(), hinten=av.postBack*BR;
        const px0=av.postFront*BR, px1=av.postBack*BR;
        const py0=av.postInner*BR, py1=av.postOuter*BR;
        let vx0=b0x, vy0=b0y;
        // Strecke gegen das massive Sockelrechteck (Slab-Verfahren, gespiegelt in den
        // Viertelraum). Beruehrt die Bahn den Marmor selbst, ist die Kugel hindurchgefahren.
        const kreuzt=(ax,ay,bx,by)=>{
          const A=footballFold(ax-cx,ay-cy), B=footballFold(bx-cx,by-cy);
          if(A.side!==B.side)return false;
          const sx=A.x>=0?1:-1, sy=A.y>=0?1:-1;
          if((B.x>=0?1:-1)!==sx||(B.y>=0?1:-1)!==sy)return false;
          let X0=sx*A.x, Y0=sy*A.y, X1=sx*B.x, Y1=sy*B.y;
          let t0=0, t1=1;
          const slab=(p,q0,q1)=>{
            const d=q1-q0;
            if(Math.abs(d)<1e-12)return q0>=p[0]&&q0<=p[1];
            let a=(p[0]-q0)/d, b=(p[1]-q0)/d;
            if(a>b){const h=a;a=b;b=h;}
            if(a>t0)t0=a; if(b<t1)t1=b;
            return t0<=t1;
          };
          if(!slab([px0,px1],X0,X1))return false;
          if(!slab([py0,py1],Y0,Y1))return false;
          return t0<=t1;
        };
        for(let i=0;i<n;i++){
          stepSim();
          const b=balls[0]; if(!b)break;
          if(!isFinite(b.x)||!isFinite(b.vx)){nan=true;break;}
          if(kreuzt(vx0,vy0,b.x,b.y))durchMarmor=true;
          vx0=b.x; vy0=b.y;
          // Der erste Frame mit umgekehrter Laengsrichtung ist der Umkehrpunkt. Dort wird
          // gemessen, wie weit die Kugel vom Sockel entfernt war: hat der SOCKEL sie
          // zurueckgewiesen, liegt sie an ihm an (Abstand = Radius, Ueberschuss ~ 0). Hat
          // eine unsichtbare Wand sie zurueckgewiesen, steht sie weit davor.
          if(!umkehr){
            const p=footballPostProbe(b);
            const ue=p?p.d-ballRad(b):Infinity;
            if(ue<umkehrUeber)umkehrUeber=ue;
            if(b.vx*vx+b.vy*vy<0)umkehr=true;
          }
          if(!b.fbPassed&&Math.abs(footballFold(b.x-cx,b.y-cy).x)>hinten+ballRad(b))
            entwischt=true;
          if(!b.fbPassed&&!footballGoalWindow(b)){
            const ue=footballBoundSD(b).sd-footballRescueLimit(b);
            if(ue>maxAus)maxAus=ue;
          }
          if(fbGoalState!=='play')
            return {tor:true,seite:footballFold(b.x-cx,b.y-cy).side,maxAus,nan,umkehr,umkehrUeber,entwischt,durchMarmor,
                    end:{x:b.x-cx,y:b.y-cy,vx:b.vx,vy:b.vy},frames:i+1};
        }
        const b=balls[0];
        return {tor:false,seite:-1,maxAus,nan,umkehr,umkehrUeber,entwischt,durchMarmor,frames:n,
                passed:!!(b&&b.fbPassed), ruht:!!(b&&Math.hypot(b.vx,b.vy)<0.01),
                aussen:!!(b&&footballBoundSD(b).sd>footballRescueLimit(b)),
                end:b?{x:b.x-cx,y:b.y-cy,vx:b.vx,vy:b.vy}:null};
      },
      // Eine Spielerkugel in die Torrettungstasche schicken.
      shootPlayer(x0,y0,vx,vy,n){
        balls=[{x:cx+x0,y:cy+y0,vx,vy,sx:cx+x0,sy:cy+y0,owner:0,alive:true,spin:0}];
        phase='sim'; fbGoalState='play'; fbGoalTick=0; footballWinner=null; score=[0,0];
        let maxUeber=0, nan=false;
        for(let i=0;i<n;i++){
          stepSim();
          const b=balls[0]; if(!b)break;
          if(!isFinite(b.x)||!isFinite(b.vx)){nan=true;break;}
          const ue=footballBoundSD(b).sd-footballRescueLimit(b);
          if(ue>maxUeber)maxUeber=ue;
        }
        const b=balls[0];
        return {maxUeber,nan,tor:fbGoalState!=='play',
                end:b?{x:b.x-cx,y:b.y-cy,vx:b.vx,vy:b.vy,passed:!!b.fbPassed}:null};
      }
    };
  `)();
}

const F = buildEnv();
const BR = F.BR;
const f2 = (v) => v.toFixed(2);

console.log('ARENA FOOTBALL — DIE TOROEFFNUNG: sichtbar offen heisst physisch offen' + NL);

const ARENEN = [
  ['2P Shouldered Wide', () => F.classic()],
  ['5P Broad Rounded Pentagon', () => F.phaseN(5)],
  ['4P Rounded Square', () => F.phaseN(4)],
  ['3P Broad Rounded Triangle', () => F.phaseN(3)],
  ['2P Finale', () => F.phaseN(2)],
];

// ── 1. DIE ZWEI FRAGEN SIND GETRENNT ────────────────────────────────────────
// A) Ball im sichtbaren Fenster -> die Bande loest ihn NICHT auf.
// B) Derselbe Laengsabstand ausserhalb -> die Bande loest ihn SEHR WOHL auf.
{
  F.classic();
  const clear = F.clearHalf(), center = F.centerHalf(), r = F.ballR();
  const wand = F.arena().halfLen * BR;
  ok(Math.abs(clear - 113.92) < 1e-9, 'die lichte Halbbreite ist 113.92 px');
  ok(Math.abs(center - (clear - r)) < 1e-9, 'die Durchlasshalbbreite ist clearHalf - Ballradius');
  ok(Math.abs(center - 88.92) < 1e-9, 'also 88.92 px');
  // Das Band dazwischen ist genau der Ballradius breit - dort steht das offene Tor.
  ok(Math.abs((clear - center) - r) < 1e-9, 'das Band zwischen beiden ist genau ein Ballradius');
  // A) im Fenster
  for (const off of [0, center * 0.25, center * 0.5, center * 0.75, center, center + 5, clear - 0.1]) {
    ok(F.window(wand - 30, off) === true, 'A: bei Versatz ' + f2(off) + ' steht kein Marmor (Fenster)');
  }
  // B) ausserhalb
  for (const off of [clear + 0.1, clear + 5, clear + 30]) {
    ok(F.window(wand - 30, off) === false, 'B: bei Versatz ' + f2(off) + ' gilt die Bande wieder');
  }
  // Und die Durchlassfrage bleibt die engere - sie hat sich NICHT geaendert.
  ok(F.canPass(wand - 30, center) === true && F.canPass(wand - 30, center + 0.5) === false,
     'die Durchlassbreite ist unveraendert die engere Frage');
  // Eine SPIELERkugel bekommt das Fenster nie: fuer sie gilt ihre eigene Grenze.
  ok(F.window(wand - 30, 0, 0) === false && F.window(wand - 30, center, 0) === false,
     'eine Spielerkugel bekommt das Torfenster nicht');
  ok(F.canPass(wand - 30, 0, 0) === false, 'und den Durchlass erst recht nicht');
}

// ── 2. DIE TRAJEKTORIENMATRIX ───────────────────────────────────────────────
// Gerade Schuesse quer ueber die ganze Oeffnung, BEIDE Seiten, drei Tempi, alle Arenen.
// Erwartet: ein einziges zusammenhaengendes Trefferband um die Mitte, dahinter Pfosten.
{
  for (const [name, setup] of ARENEN) {
    setup();
    const a = F.arena(), clear = F.clearHalf(), center = F.centerHalf(), vmax = F.launchV();
    const d = F.dirs()[0], perp = [-d[1], d[0]], d0 = a.halfLen * BR - 150;
    for (const vt of [0.30, 0.65, 1.00]) {
      const v = vmax * vt;
      // Beide Seiten: negativer und positiver Versatz.
      let linksBis = 0, rechtsBis = 0, luecken = 0, vorher = null, nanFrei = true, aus = 0;
      for (let off = -clear - 4; off <= clear + 4; off += 0.5) {
        setup();
        const res = F.shoot(d[0] * d0 + perp[0] * off, d[1] * d0 + perp[1] * off,
                            d[0] * v, d[1] * v, 260);
        if (res.nan) nanFrei = false;
        if (res.maxAus > aus) aus = res.maxAus;
        if (res.tor) {
          if (off < 0) linksBis = Math.min(linksBis, off); else rechtsBis = Math.max(rechtsBis, off);
          if (vorher === false) luecken++;
          vorher = true;
        } else if (vorher === true) vorher = false;
      }
      const lbl = name + ' v=' + Math.round(vt * 100) + '%';
      ok(nanFrei, lbl + ': kein NaN');
      ok(aus <= 1.5, lbl + ': ausserhalb des Fensters bleibt der Einschluss streng (' + f2(aus) + ')');
      ok(-linksBis >= center && rechtsBis >= center,
         lbl + ': der ganze Durchlasskorridor trifft (links ' + f2(-linksBis) +
         ', rechts ' + f2(rechtsBis) + ' >= ' + f2(center) + ')');
      ok(Math.abs((-linksBis) - rechtsBis) <= 1.0,
         lbl + ': beide Seiten sind symmetrisch (' + f2(-linksBis) + ' / ' + f2(rechtsBis) + ')');
      ok(-linksBis <= clear && rechtsBis <= clear,
         lbl + ': aber niemals ueber die lichte Kante hinaus');
    }
  }
}

// ── 3. KEIN UNSICHTBARER RUECKPRALL IM FENSTER ──────────────────────────────
// Der eigentliche Befund: ein Ball, der sichtbar im offenen Tor steht, darf nicht mit
// 180 Grad zurueckgeschossen werden. Geprueft wird der Ausfallwinkel im ganzen Band.
{
  F.classic();
  const a = F.arena(), clear = F.clearHalf(), center = F.centerHalf(), vmax = F.launchV();
  const wand = a.halfLen * BR;
  let frueh = 0, geprueft = 0, maxFrueh = 0;
  for (let off = center + 0.5; off <= clear - 0.5; off += 0.5) {
    const res = F.shoot(wand - 150, off, vmax, 0, 60);
    if (!res.umkehr) continue;
    geprueft++;
    // Der Sockel setzt die Kugel beim Zurueckweisen genau auf Beruehrung: Abstand gleich
    // Radius, Ueberschuss also rund null. Alles Weitere hiesse, etwas anderes habe sie
    // aufgehalten - und dort steht nichts.
    if (res.umkehrUeber > 1.5) { frueh++; maxFrueh = Math.max(maxFrueh, res.umkehrUeber); }
  }
  ok(geprueft > 0, 'im Band zwischen Durchlass und lichter Kante wurde gemessen (' + geprueft + ')');
  ok(frueh === 0,
     'im sichtbaren Torfenster weist ausschliesslich der Sockel zurueck, und zwar erst bei ' +
     'Beruehrung (' + frueh + ' von ' + geprueft + ' zu frueh, max ' + f2(maxFrueh) + ' px)');
  // Gegenprobe 1: JENSEITS der lichten Kante steht wieder Marmor. Dort wirft die gerade
  // Stirnbande weiterhin geradeaus zurueck - genau wie eh und je.
  const res = F.shoot(wand - 150, clear + 8, vmax, 0, 60);
  const e = res.end, w = Math.abs(Math.atan2(e.vy, e.vx) * 180 / Math.PI);
  ok(!res.tor && w > 175, 'neben der lichten Kante wirft die Bande weiterhin geradeaus zurueck');
  ok(res.maxAus <= 1.5, 'und haelt die Kugel dabei auf der Bandenlinie (' + f2(res.maxAus) + ')');
  // Gegenprobe 2: weit ausserhalb des Sockels ueberhaupt. Dort weist die Bande zurueck,
  // ohne dass die Kugel den Sockel je beruehrt haette - der Beweis, dass die Bande dort
  // sehr wohl noch Material hat.
  const weit = F.shoot(wand - 150, 220, vmax, 0, 60);
  ok(weit.umkehr && weit.umkehrUeber > 1.5,
     'weit neben dem Sockel weist allein die Bande zurueck (Sockelabstand ' +
     (isFinite(weit.umkehrUeber) ? f2(weit.umkehrUeber) : 'nie erreicht') + ')');
}

// ── 4. VOM PFOSTEN INS TOR ──────────────────────────────────────────────────
// Ein Streifer darf nach innen abgelenkt werden und fallen. Das ist erwuenscht.
{
  F.classic();
  const a = F.arena(), center = F.centerHalf(), vmax = F.launchV();
  const wand = a.halfLen * BR;
  let abgelenkteTore = 0;
  for (let off = center + 0.5; off <= center + 12; off += 0.5) {
    const res = F.shoot(wand - 150, off, vmax, 0, 300);
    if (res.tor) abgelenkteTore++;
  }
  ok(abgelenkteTore > 0,
     'ein Streifer kann vom Pfosten ins Tor gelenkt werden (' + abgelenkteTore + ' Faelle)');
}

// ── 5. SCHRAEGE SCHUESSE ────────────────────────────────────────────────────
{
  F.classic();
  const a = F.arena(), clear = F.clearHalf(), center = F.centerHalf(), vmax = F.launchV();
  const wand = a.halfLen * BR;
  for (const grad of [0, 10, 20, 30, 45]) {
    const rad = grad * Math.PI / 180, v = vmax * 0.75;
    const vx = v * Math.cos(rad), vy = v * Math.sin(rad);
    const versatz = 150 * Math.tan(rad);
    let treffer = 0, aus = 0, nanFrei = true;
    for (let ziel = -clear; ziel <= clear; ziel += 1) {
      const res = F.shoot(wand - 150, ziel - versatz, vx, vy, 300);
      if (res.nan) nanFrei = false;
      if (res.maxAus > aus) aus = res.maxAus;
      if (res.tor) treffer++;
    }
    ok(nanFrei, grad + ' Grad: kein NaN');
    ok(aus <= 1.5, grad + ' Grad: der Einschluss ausserhalb des Fensters haelt (' + f2(aus) + ')');
    ok(treffer >= 100, grad + ' Grad: ein breites Trefferband bleibt (' + treffer + ' von 228)');
  }
}

// ── 6. HOECHSTTEMPO UND KETTENSTOSS ─────────────────────────────────────────
// Der schnellste Ball des Spiels darf weder tunneln noch ein Loch in der Kante finden.
{
  for (const [name, setup] of ARENEN) {
    setup();
    const a = F.arena(), clear = F.clearHalf(), center = F.centerHalf(), vmax = F.launchV();
    const d = F.dirs()[0], perp = [-d[1], d[0]], d0 = a.halfLen * BR - 150;
    // Bis zum doppelten Abschusstempo: ein Kettenstoss kann den Ball beschleunigen.
    for (const v of [vmax, vmax * 1.5, vmax * 2]) {
      let aus = 0, nanFrei = true, durch = 0, weg = 0;
      // Bis knapp ueber die lichte Kante hinaus - dort steht der Sockel im Fenster allein.
      for (let off = -clear - 4; off <= clear + 4; off += 0.5) {
        setup();
        const res = F.shoot(d[0] * d0 + perp[0] * off, d[1] * d0 + perp[1] * off,
                            d[0] * v, d[1] * v, 260);
        if (res.nan) nanFrei = false;
        if (res.maxAus > aus) aus = res.maxAus;
        if (res.tor) durch++;
        if (res.entwischt || res.durchMarmor) weg++;
      }
      const lbl = name + ' v=' + f2(v);
      ok(nanFrei, lbl + ': kein NaN bei Hoechsttempo');
      ok(aus <= 1.5, lbl + ': kein Tunneln durch die Bande (' + f2(aus) + ')');
      ok(weg === 0, lbl + ': kein Tunneln durch den Sockel (' + weg + ' entwischt)');
      ok(durch > 0, lbl + ': der Korridor traegt auch dort (' + durch + ' Treffer)');
    }
  }
}

// ── 6b. DIE SOCKELKANTE IM STREIFSCHUSS ──────────────────────────
// Frontal getroffen ist der Sockel leicht zu finden. Gefaehrlich ist der flache Streifer
// bei Hoechsttempo: pro Teilschritt ueberdeckt die Kugel die Kante nur fuer einen Sekunden-
// bruchteil. Genau dafuer steht die gefegte Pruefung.
{
  for (const [name, setup] of ARENEN) {
    setup();
    const a = F.arena(), clear = F.clearHalf(), vmax = F.launchV();
    const d = F.dirs()[0], perp = [-d[1], d[0]], d0 = a.halfLen * BR - 150;
    let weg = 0, nanFrei = true, versuche = 0;
    for (const grad of [0, 8, 16, 24, 32, 40]) {
      const rad = grad * Math.PI / 180;
      for (const vt of [1.0, 1.6, 2.2]) {
        const v = vmax * vt;
        for (let off = clear - 30; off <= clear + 2; off += 0.5) {
          setup();
          const vx = v * Math.cos(rad), vy = v * Math.sin(rad);
          const res = F.shoot(d[0] * d0 + perp[0] * off, d[1] * d0 + perp[1] * off,
                              d[0] * vx + perp[0] * vy, d[1] * vx + perp[1] * vy, 200);
          versuche++;
          if (res.nan) nanFrei = false;
          if (res.entwischt || res.durchMarmor) weg++;
        }
      }
    }
    ok(nanFrei, name + ': Streifschuesse bleiben endlich');
    ok(weg === 0, name + ': keine Kugel entwischt an der Sockelkante vorbei (' +
       weg + ' von ' + versuche + ')');
  }
}

// ── 6c. DIE GEFEGTE PRUEFUNG: DAS TOR WIRD NIE BREITER ALS ES AUSSIEHT ──────
// Innerhalb des Fensters steht keine Bande mehr - dort haelt allein die Sockelkante. Je
// schneller die Kugel, desto kuerzer beruehrt sie diese Kante je Teilschritt. Ohne
// gefegte Pruefung waechst die wirksame Toroeffnung deshalb mit dem Tempo, bis die Kugel
// schliesslich HINTER der sichtbaren Kante durch massiven Sockel fliegt. Gemessen wird
// genau diese Grenze: die aeusserste Position, von der aus ein gerader Schuss noch faellt.
//
// Bis zum doppelten Abschusstempo waechst sie regulaer von 96.8 auf 113.7 - das ist der
// Streifer, der von der runden Ecke nach innen gelenkt wird und ausdruecklich erwuenscht
// ist. Ueber der sichtbaren Kante von 113.92 darf sie nie liegen: dort ist Marmor.
// (Ohne die gefegte Pruefung erreicht sie beim achtfachen Tempo 119.9.)
{
  F.classic();
  const clear = F.clearHalf(), center = F.centerHalf(), vmax = F.launchV();
  const d0 = F.arena().halfLen * BR - 150;
  // Die gemessene Kante im SPIELBAREN Tempoband. Sie ist der eigentliche Nachweis, dass
  // die gefegte Pruefung arbeitet: ohne sie findet die punktuelle Abtastung die runde
  // Sockelecke jedes Mal ein Stueck zu spaet, und die wirksame Oeffnung wird still breiter
  // als die Geometrie hergibt. Gemessen in allen fuenf Arenen, identisch:
  //     Tempo      30 %    50 %    65 %    80 %
  //   mit Sweep   96.70   97.80   98.40   98.40
  //   ohne Sweep  96.80   98.40   99.10   99.10
  // Die Toleranz von 0.2 px ist die halbe Schrittweite dieser Messung; der Unterschied
  // zwischen beiden Zeilen ist bis zu 0.7 px und faellt damit sicher auf.
  const KANTE = { 0.3: 96.70, 0.5: 97.80, 0.65: 98.40, 0.8: 98.40 };
  let letzte = 0;
  for (const vt of [0.3, 0.5, 0.65, 0.8, 1.0, 2.0, 4.0, 8.0]) {
    const v = vmax * vt;
    let kante = 0, marmor = 0;
    for (let off = 0; off <= clear + 8; off += 0.1) {
      F.classic();
      const q = F.shoot(d0, off, v, 0, 300);
      if (q.tor) kante = off;
      if (q.durchMarmor) marmor++;
    }
    const lbl = 'v=' + Math.round(vt * 100) + '%';
    ok(kante >= center, lbl + ': der Korridor traegt (' + f2(kante) + ' >= ' + f2(center) + ')');
    // Bis zum vierfachen Abschusstempo - weit ueber allem, was ein Kettenstoss erzeugt -
    // bleibt die wirksame Oeffnung innerhalb der sichtbaren Kante. Darueber kann eine Kugel
    // AUSSEN am Sockel abprallen und von dort ins Tor banken; das ist ein Abpraller, kein
    // Durchflug. Dass keine Kugel durch den Marmor faehrt, wird unabhaengig davon in jedem
    // Tempo geprueft.
    if (vt <= 4.0)
      ok(kante <= clear, lbl + ': das Tor ist nie breiter als es aussieht (' +
         f2(kante) + ' <= ' + f2(clear) + ')');
    ok(marmor === 0, lbl + ': und keine Kugel faehrt durch den Sockel (' + marmor + ')');
    if (KANTE[vt] !== undefined)
      ok(Math.abs(kante - KANTE[vt]) <= 0.2,
         lbl + ': die Sockelecke wird gefegt gefunden, nicht abgetastet (Kante ' +
         f2(kante) + ', erwartet ' + f2(KANTE[vt]) + ' +- 0.2)');
    ok(kante >= letzte - 0.5, lbl + ': die Kante waechst monoton mit dem Tempo, sie springt nicht');
    letzte = kante;
  }
}

// ── 6d. DIE SEHNE UEBER DIE SOCKELKANTE ─────────────────────────
// Der gemeinste Fall: beide Endpunkte des Schritts liegen FREI, die Strecke dazwischen
// taucht aber in den Sockel ein. Weder Start noch Ende verraet etwas davon - nur die
// gefegte Pruefung kann ihn sehen. Faellt sie aus, faehrt die Kugel durch sichtbaren
// Marmor. Genau so ein Fall kam aus dem Review: der Fruehabbruch verwarf jeden Startpunkt
// im aufgeweiteten Rechteck als "beruehrt schon" - dessen Eckquadrate enthalten aber auch
// freie Punkte.
//
// Der Vertrag wird direkt an der Geometrie gemessen: taucht die Strecke ein, obwohl der
// Start frei war, MUSS die gefegte Pruefung greifen. Gerechnet wird mit dem Abstand zum
// Sockelrechteck, denselben Kanten, die auch footballPostProbe benutzt.
{
  F.classic();
  const a5 = F.arena(), r5 = F.ballR();
  const rx0 = a5.postFront * BR, rx1 = a5.postBack * BR;
  const ry0 = a5.postInner * BR, ry1 = a5.postOuter * BR;
  // Abstand eines Punktes zum Sockelrechteck im gespiegelten Viertelraum.
  const dRect = (x, y) => {
    const qx = x < rx0 ? rx0 : (x > rx1 ? rx1 : x);
    const qy = y < ry0 ? ry0 : (y > ry1 ? ry1 : y);
    return Math.hypot(x - qx, y - qy);
  };
  let verpasst = 0, geprueft5 = 0, faelle = 0, maxRest = 0, schlimmste = 0, fremdBesitz = 0;
  for (let ax = rx0 - 40; ax <= rx1 + 40; ax += 3.5)
    for (let ay = ry0 - 40; ay <= ry1 + 40; ay += 3.5) {
      if (dRect(ax, ay) < r5) continue;                 // Start schon im Kontakt: diskreter Fall
      for (let w = 0; w < 360; w += 15)
        for (const len of [4, 9, 16, 30]) {
          const bx = ax + len * Math.cos(w * Math.PI / 180);
          const by = ay + len * Math.sin(w * Math.PI / 180);
          // Taucht die Strecke ein? Fein abgetastet, unabhaengig von der Implementierung.
          let tief = 0;
          for (let k = 0; k <= 200; k++) {
            const e = r5 - dRect(ax + (bx - ax) * k / 200, ay + (by - ay) * k / 200);
            if (e > tief) tief = e;
          }
          geprueft5++;
          if (tief <= 1e-9) continue;
          // Auf welcher Seite des Sockels beginnt die Beruehrung? Nur zur Toroeffnung hin
          // fehlt die Bandenlinie; dort MUSS die gefegte Pruefung greifen. Jenseits der
          // Pfosteninnenflaeche ist die Bande Eigentuemerin und der Sweep hat sich
          // herauszuhalten - sonst hat ein Kontakt zwei Besitzer.
          let ey = null;
          for (let k = 0; k <= 200; k++) {
            const px = ax + (bx - ax) * k / 200, py = ay + (by - ay) * k / 200;
            if (dRect(px, py) < r5) { ey = py; break; }
          }
          const imFenster = ey !== null && ey <= ry0 + 1e-9;
          F.classic();
          const res = F.rawSweep(ax, ay, bx, by);
          if (!imFenster) { if (res.hit) fremdBesitz++; continue; }
          faelle++;
          if (!res.hit) { verpasst++; schlimmste = Math.max(schlimmste, tief); }
          // Der Abstand wird selbst gerechnet: footballPostProbe weist einen Punkt GENAU
          // auf der aufgeweiteten Kante bereits ab (strikte Schnellablehnung) - und genau
          // dorthin setzt die gefegte Pruefung den Beruehrpunkt.
          else maxRest = Math.max(maxRest, Math.abs(dRect(res.x, res.y) - r5));
        }
    }
  ok(geprueft5 > 20000, 'die Sockelumgebung wurde systematisch abgefahren (' + geprueft5 + ' Strecken)');
  ok(faelle > 500, 'davon tauchen ' + faelle + ' auf der Torseite in den Sockel ein');
  ok(fremdBesitz === 0,
     'jenseits der Pfosteninnenflaeche greift die gefegte Pruefung nie ein (' + fremdBesitz +
     ') - dort gehoert der Kontakt allein der Bande');
  ok(verpasst === 0,
     'keine eintauchende Strecke wird uebersehen (' + verpasst + ' verpasst, tiefste ' +
     f2(schlimmste) + ' px) - auch nicht, wenn beide Endpunkte frei liegen');
  ok(maxRest < 1e-6,
     'und jeder Treffer wird exakt auf Beruehrabstand gesetzt (max Abweichung ' +
     maxRest.toExponential(1) + ')');
}

// ── 6f. DER GEMELDETE FALL AN DER AEUSSEREN SOCKELECKE ───────────────
// Aus dem Review: bei Querabstand 180 - weit ausserhalb des Fensters - griff die gefegte
// Pruefung an der AEUSSEREN Sockelecke zu. Die Kugel bekam die schraege Pfostennormale,
// die Lage aber von der Bande: ein Kontakt mit zwei Besitzern, Ausfall (-2.094, 5.874).
// Erwartet ist stattdessen exakt das Verhalten von vor diesem Pass - dort loest der
// bestehende diskrete Sockeltest auf, unveraendert.
{
  F.classic();
  const q = F.shoot(470, 180, 10, 0, 1);
  ok(Math.abs(q.end.x - 474.200) < 5e-4 && Math.abs(q.end.y - 187.871) < 5e-4,
     'die Lage an der aeusseren Sockelecke ist unveraendert (' + q.end.x.toFixed(3) + ', ' +
     q.end.y.toFixed(3) + ')');
  ok(Math.abs(q.end.vx + 1.296) < 5e-4 && Math.abs(q.end.vy - 6.416) < 5e-4,
     'und die Geschwindigkeit ebenso (' + q.end.vx.toFixed(3) + ', ' + q.end.vy.toFixed(3) + ')');
}

// ── 6e. BEIDE TORE SIND DASSELBE TOR ────────────────────────────
// Die Arena ist punktsymmetrisch. Ein Schuss und sein am Mittelpunkt gespiegeltes
// Gegenstueck muessen sich gleich verhalten - sonst haetten zwei Spieler nicht dasselbe
// Tor vor sich. Die Physik rechnet in einem gefalteten Rahmen, und die Rueckfaltung ueber
// (cx, cy) ist auf beiden Seiten unterschiedlich genau. Wo eine Entscheidung genau auf
// einer Kante liegt, kann dieser Rundungsfehler sie kippen.
// Genau das ist einmal passiert: eine Kugel, die sich vom Sockel wegbewegte, wurde von der
// gefegten Pruefung bei t=0 wieder auf die Kante gesetzt - am -X-Tor, am +X-Tor nicht.
// 2.05 px Unterschied zwischen zwei baugleichen Toren.
{
  F.classic();
  const clear = F.clearHalf(), center = F.centerHalf(), vmax = F.launchV();
  const d0 = F.arena().halfLen * BR - 150;
  let paare = 0, torUnterschied = 0, abweichend = [], maxAbw = 0;
  for (const vt of [0.3, 0.65, 1.0])
    for (let off = -clear - 6; off <= clear + 6; off += 0.5) {
      const v = vmax * vt;
      F.classic(); const p = F.shoot(d0, off, v, 0, 300);
      F.classic(); const q = F.shoot(-d0, -off, -v, 0, 300);
      paare++;
      if (p.tor !== q.tor) { torUnterschied++; continue; }
      const d = Math.max(Math.abs(p.end.x + q.end.x), Math.abs(p.end.y + q.end.y));
      // Rauschgrenze 1e-6, nicht 1e-9: die Rueckfaltung ueber (cx, cy) sammelt auf langen
      // Bahnen Rundung. Die einzige ECHTE Abweichung liegt Groessenordnungen darueber
      // (die Korridorkante, unten ausdruecklich ausgenommen).
      if (d > 1e-6) { abweichend.push(Math.abs(off)); maxAbw = Math.max(maxAbw, d); }
    }
  ok(paare > 700, 'gespiegelte Schusspaare geprueft (' + paare + ')');
  ok(torUnterschied === 0,
     'kein gespiegeltes Paar entscheidet sich unterschiedlich fuer oder gegen ein Tor (' +
     torUnterschied + ')');
  // Positionsgleichheit auf 1e-9 - mit genau EINER dokumentierten Ausnahme: der
  // Korridorkante selbst. Dort liegt die Kugel exakt auf der Entscheidungsschwelle; die
  // Faltung gibt sie auf den beiden Seiten unterschiedlich genau wieder. Der Ausgang ist
  // auch dort auf beiden Seiten gleich (oben geprueft), nur die Bahn danach nicht.
  const fremd = abweichend.filter((o) => Math.abs(o - center) > 1e-9);
  ok(fremd.length === 0,
     'ausserhalb der Korridorkante sind gespiegelte Schuesse deckungsgleich (' +
     abweichend.length + ' Abweichungen, davon ' + fremd.length + ' abseits der Kante, max ' +
     f2(maxAbw) + ' px)');
}

// ── 7. DER EINSCHLUSS AUSSERHALB DES FENSTERS ───────────────────────────────
// Zufallslaeufe in allen Arenen: ausserhalb eines offenen Torfensters gilt die
// Bandenlinie unveraendert streng.
{
  let seed = 20260902 >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const [name, setup] of ARENEN) {
    setup();
    const a = F.arena(), vmax = F.launchV();
    let maxAus = 0, nanFrei = true;
    for (let t = 0; t < 200; t++) {
      setup();
      const ang = rnd() * Math.PI * 2, sp = vmax * (0.3 + 0.7 * rnd());
      const rr = a.halfLen * BR * (0.15 + 0.7 * rnd()), ph = rnd() * Math.PI * 2;
      const res = F.shoot(Math.cos(ph) * rr, Math.sin(ph) * rr,
                          Math.cos(ang) * sp, Math.sin(ang) * sp, 300);
      if (res.nan) nanFrei = false;
      if (res.maxAus > maxAus) maxAus = res.maxAus;
    }
    ok(nanFrei, name + ': 200 Zufallslaeufe ohne NaN');
    ok(maxAus <= 1.5,
       name + ': ausserhalb des Torfensters bleibt der Einschluss streng (' + f2(maxAus) + ')');
  }
}

// ── 8. DIE TORRETTUNGSTASCHE IST UNBERUEHRT ─────────────────────────────────
{
  F.classic();
  const a = F.arena(), center = F.centerHalf(), vmax = F.launchV();
  const wand = a.halfLen * BR, tiefe = F.rescueDepth();
  ok(tiefe > 0, 'die Rettungstasche hat weiterhin eine Tiefe (' + f2(tiefe) + ')');
  // Eine Spielerkugel faehrt in die Tasche und bleibt darin.
  const res = F.shootPlayer(wand - 120, 0, vmax * 0.6, 0, 240);
  ok(!res.nan, 'die Spielerkugel bleibt endlich');
  ok(res.maxUeber <= tiefe + 1.5,
     'sie kommt nicht tiefer als die Tasche erlaubt (' + f2(res.maxUeber) +
     ' <= ' + f2(tiefe + 1.5) + ')');
  ok(!res.tor, 'und sie wertet kein Tor');
  ok(res.end && !res.end.passed, 'sie tritt auch nicht durch das Tor aus');
  // Und sie bekommt das Fenster des neutralen Balls an keiner Stelle.
  let bekommtFenster = false;
  for (let off = -200; off <= 200; off += 5)
    for (let dx = -60; dx <= 60; dx += 10)
      if (F.window(wand + dx, off, 0)) bekommtFenster = true;
  ok(!bekommtFenster, 'eine Spielerkugel bekommt das Torfenster an keiner Stelle');
}

// ── 9. DIE WERTUNG IST UNANGETASTET ─────────────────────────────────────────
{
  F.classic();
  const a = F.arena(), r = F.ballR();
  // Die kanonische Torlinie steht unveraendert an der Sockelhinterkante.
  ok(/if\(Math\.abs\(dx\)-fbBallR\(\)>fbArena\(\)\.postBack\*BR\)return F\.side;/.test(SRC),
     'die kanonische Torlinie ist unveraendert die Sockelhinterkante');
  ok(/function footballGoalCrossed\(b\)\{[\s\S]{0,200}?!b\.fbPassed\)return -1;/.test(SRC),
     'gewertet wird weiterhin nur ein Ball, der die Oeffnung passiert hat');
  ok(/if\(fbGoalState!=='play'\)return;/.test(SRC), 'und nur genau einmal je Torereignis');
  // Der Durchlass-Latch haengt unveraendert an der ENGEREN Frage.
  ok(/if\(footballCanPassGoal\(fb\)\)\{fb\.fbPassed=true;continue;\}/.test(SRC),
     'der Durchlass-Latch haengt an footballCanPassGoal, nicht am Fenster');
  ok(/const FB_GOAL_PASS_EPS=1e-6;/.test(SRC) &&
     /Math\.abs\(F\.y\)<=footballGoalCenterHalf\(\)\+FB_GOAL_PASS_EPS/.test(SRC),
     'sein Vergleich traegt die Rechengenauigkeit der Seitenfaltung als benannte Konstante');
  // ... und das Latch ist widerruflich. Ohne diese Ruecknahme bleibt eine vom Sockel
  // zurueckgeworfene Kugel dauerhaft von der Bande ausgenommen.
  ok(/if\(fb\.fbPassed&&footballBoundSD\(fb\)\.sd<=footballRescueLimit\(fb\)\)fb\.fbPassed=false;/.test(SRC),
     'wer wieder innerhalb der Bandenlinie auftaucht, verliert das Durchtritts-Latch');
  ok(SRC.indexOf('fb.fbPassed=false;') < SRC.indexOf('if(fb.fbPassed){footballTryGoal(fb);continue;}'),
     'die Ruecknahme steht vor der Wertung');
  // DIE RUECKNAHME IN DER PRAXIS. Ein Schuss knapp neben den Korridor wird von der runden
  // Sockelecke nach innen abgelenkt. Auf diesem Rueckweg laeuft seine Mitte durch den
  // Korridor - und bekam dabei frueher das Durchtritts-Latch. Danach galt fuer ihn keine
  // Bande mehr: er konnte die Arena an beliebiger Stelle verlassen. Geprueft wird, dass
  // eine solche Kugel am Ende WIEDER der Bande gehoert.
  {
    const a3 = F.arena(), vmax3 = F.launchV(), d3 = a3.halfLen * BR - 150;
    const center = F.centerHalf(), clear = F.clearHalf();
    let zurueck = 0, latchDrin = 0;
    for (const vt of [0.3, 0.65, 1.0]) {
      for (let off = center + 8; off <= clear + 2; off += 0.25) {
        F.classic();
        const q = F.shoot(d3, -off, vmax3 * vt, 0, 800);
        if (q.tor || q.aussen) continue;           // gefallen oder im Tormaul liegengeblieben
        zurueck++;
        if (q.passed) latchDrin++;
      }
    }
    ok(zurueck > 50, 'abgelenkte Kugeln kehren messbar in die Arena zurueck (' + zurueck + ')');
    ok(latchDrin === 0,
       'keine davon behaelt das Durchtritts-Latch (' + latchDrin + ' von ' + zurueck +
       ') - sie gehoeren wieder der Bande');
  }
  // Und keine Kugel bleibt in Bewegung haengen oder landet ausser Reichweite: jede kommt
  // zur Ruhe, und zwar diesseits der Torlinie, wo die Spieler sie noch erreichen.
  {
    const a4 = F.arena(), vmax4 = F.launchV(), d4 = a4.halfLen * BR - 150;
    const clear = F.clearHalf();
    const reichweite = a4.halfLen * BR + F.ballR();
    let laeuft = 0, zuWeit = 0, offen = 0, maxX = 0;
    for (const vt of [0.3, 0.65, 1.0, 2.0]) {
      for (let off = -clear - 6; off <= clear + 6; off += 0.5) {
        F.classic();
        const q = F.shoot(d4, off, vmax4 * vt, 0, 2000);
        if (q.tor) continue;
        offen++;
        if (!q.ruht) laeuft++;
        const fx = Math.abs(q.end.x);
        if (fx > maxX) maxX = fx;
        if (fx > reichweite) zuWeit++;
      }
    }
    ok(offen > 100, 'es gibt genug Schuesse ohne Tor zu pruefen (' + offen + ')');
    ok(laeuft === 0, 'jede Kugel ohne Tor kommt zur Ruhe (' + laeuft + ' laufen noch)');
    ok(zuWeit === 0, 'und keine bleibt ausser Spielerreichweite liegen (max ' + f2(maxX) +
       ' <= ' + f2(reichweite) + ')');
  }
}

// ── 10. ZUSTAENDIGKEIT UND DETERMINISMUS ────────────────────────────────────
{
  ok(/if\(footballGoalWindow\(fb\)\)continue;/.test(SRC),
     'im Fenster loest die Bande nicht auf - keine zwei Kollider auf derselben Stelle');
  ok(SRC.indexOf('if(footballResolvePost(fb,ci===1||it===0))') <
     SRC.indexOf('if(footballGoalWindow(fb))continue;'),
     'der Sockel wird VOR der Bandenentscheidung gefragt');
  const sweep = grab(/function footballSweepPost\(b,px,py\)\{[\s\S]*?\n\}/, 'footballSweepPost');
  ok(!/Math\.random|Date\.now|performance\./.test(sweep),
     'die gefegte Sockelkollision ist frei von Zufall und Zeit');
  ok(/if\(mode!=='football'\|\|b\.owner!==FOOTBALL_NEUTRAL_OWNER\)return false;/.test(sweep),
     'sie gilt nur im Football-Modus und nur fuer den neutralen Ball');
  ok(/const disc=B2\*B2-4\*A2\*C2;/.test(sweep),
     'sie schneidet die Strecke gegen die runde Ecke, nicht nur gegen die Rechteckkante');
  ok(/curRestPost\(\)/.test(sweep), 'und spiegelt mit der Sockel-Restitution');
  // Determinismus: derselbe Schuss zweimal liefert exakt dasselbe.
  F.classic();
  const a = F.arena(), vmax = F.launchV(), wand = a.halfLen * BR;
  const r1 = F.shoot(wand - 150, F.centerHalf() + 3, vmax, 0.7, 200);
  const r2 = F.shoot(wand - 150, F.centerHalf() + 3, vmax, 0.7, 200);
  ok(JSON.stringify(r1.end) === JSON.stringify(r2.end) && r1.tor === r2.tor,
     'derselbe Schuss liefert bitgleich dasselbe Ergebnis');
}

console.log(NL + 'Football-Toroeffnung: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
