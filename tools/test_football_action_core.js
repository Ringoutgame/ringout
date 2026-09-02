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
      NEU:FOOTBALL_NEUTRAL_OWNER,
      // Freie Aufstellung und Einzelschritt: diese Suite braucht Spieler UND Ball.
      setz(list){ balls=list.map(b=>({x:cx+b.x,y:cy+b.y,vx:b.vx||0,vy:b.vy||0,
        sx:cx+b.x,sy:cy+b.y,owner:b.owner,alive:true,spin:b.spin||0}));
        phase='sim'; fbGoalState='play'; fbGoalTick=0; footballWinner=null; score=[0,0]; },
      schritt(){ stepSim(); },
      lese(){ return balls.map(b=>({x:b.x-cx,y:b.y-cy,vx:b.vx,vy:b.vy,owner:b.owner,
        sp:Math.hypot(b.vx,b.vy),passed:!!b.fbPassed})); },
      tor(){ return fbGoalState!=='play'; },
      restBall(){ return curRestBall(); },
      restBand(){ return curRestBand(); },
      restPostV(){ return curRestPost(); },
      stopv(){ return curST(); },
      playerR(){ return BR; },
      masse(o){ return ballMass({owner:o}); },
      phys(){ return {friction:FOOTBALL_PHYS.friction,frictionBall:FOOTBALL_PHYS.frictionBall,
        fend:FOOTBALL_PHYS.fend,fendBall:FOOTBALL_PHYS.fendBall,fastv:FOOTBALL_PHYS.fastv,
        frictionMid:FOOTBALL_PHYS.frictionMid,slowv:FOOTBALL_PHYS.slowv,
        stopv:FOOTBALL_PHYS.stopv,restBall:FOOTBALL_PHYS.restBall,
        restBand:FOOTBALL_PHYS.restBand,restPost:FOOTBALL_PHYS.restPost}; },
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

console.log('ARENA FOOTBALL — ACTION CORE: was ein guter Schuss anrichtet' + NL);

const f2 = (v) => v.toFixed(2);
const NEU = F.NEU;

// Ein Spieler trifft den ruhenden Ball bei GENAU dieser Kontaktgeschwindigkeit; der
// Auftreffwinkel entsteht aus dem seitlichen Versatz: sin(grad) = versatz / (rS + rB).
function stoss(vK, grad) {
  F.classic();
  const sum = F.ballR() + F.playerR();
  const off = Math.sin(grad * Math.PI / 180) * sum;
  const anlauf = sum + vK * 2 + 2;
  F.setz([{ x: -anlauf, y: off, vx: vK, vy: 0, owner: 0 }, { x: 0, y: 0, owner: NEU }]);
  let vorSp = vK;
  for (let k = 0; k < 40; k++) {
    const a = F.lese();
    if (a[1].sp > 1e-9) return { vEin: vorSp, vBall: a[1].sp, vSp: a[0].sp };
    vorSp = a[0].sp;
    F.schritt();
  }
  return { vEin: vorSp, vBall: 0, vSp: 0 };
}

// ── 1. DER SAUBERE VOLLTREFFER ──────────────────────────────────────────────
// Der Ball ist kleiner als eine Spielerkugel und bei gleicher Dichte damit leichter.
// Der Stossimpuls rechnete das frueher nicht: er behandelte beide als gleich schwer und
// gab dem Ball nur 71.4 % der Geschwindigkeit. Ein perfekter Schuss fuehlte sich deshalb
// nicht gefaehrlich an. Mit Masse nimmt der Ball, was ihm zusteht.
{
  ok(Math.abs(F.masse(NEU) - Math.pow(25 / 32, 3)) < 1e-15,
     'die Ballmasse folgt seinem Volumen (' + F.masse(NEU).toFixed(6) + ')');
  ok(F.masse(0) === 1 && F.masse(1) === 1, 'jede Spielerkugel wiegt 1');
  // Die Zahl ist keine Wunschgroesse, sondern folgt aus (1+e)/(1+m):
  const e = F.restBall(), m = F.masse(NEU);
  const erwartet = (1 + e) / (1 + m);
  ok(Math.abs(erwartet - 0.9751) < 0.0005,
     'die Theorie sagt ' + erwartet.toFixed(4) + ' der Kontaktgeschwindigkeit voraus');
  for (const vK of [2, 4, 6, F.launchV()]) {
    const r = stoss(vK, 0);
    const anteil = r.vBall / r.vEin;
    ok(anteil > 0.93 && anteil < 0.99,
       'Volltreffer bei ' + f2(vK) + ' px/Frame: der Ball nimmt ' +
       (anteil * 100).toFixed(1) + ' % mit (frueher 71.4 %)');
    // Der Schuetze bleibt in Bewegung — sonst gaebe es keine Anschlusskette.
    ok(r.vSp > r.vEin * 0.4,
       '  und der Schuetze behaelt ' + (r.vSp / r.vEin * 100).toFixed(1) + ' % (kein Stillstand)');
  }
}

// ── 2. DAS KOENNEN BLEIBT MESSBAR ───────────────────────────────────────────
// Ein Streifschuss darf nicht dasselbe leisten wie ein Volltreffer. Der Impuls wirkt
// entlang der Verbindungslinie, der Winkel geht also mit dem Kosinus ein — das war
// vorher so und ist es weiterhin. Neu ist, dass der ABSTAND zwischen gut und schlecht
// groesser geworden ist: der Volltreffer gewinnt mehr als der Streifschuss.
{
  const bei = (g) => { const r = stoss(6.0, g); return r.vBall / r.vEin; };
  const a0 = bei(0), a15 = bei(15), a30 = bei(30), a45 = bei(45);
  ok(a0 > a15 && a15 > a30 && a30 > a45,
     'streng monoton: 0 Grad ' + (a0 * 100).toFixed(1) + ' % > 15 Grad ' + (a15 * 100).toFixed(1) +
     ' % > 30 Grad ' + (a30 * 100).toFixed(1) + ' % > 45 Grad ' + (a45 * 100).toFixed(1) + ' %');
  ok(a0 - a45 > 0.25,
     'und der Abstand zwischen perfekt und schraeg ist gross (' +
     ((a0 - a45) * 100).toFixed(1) + ' Prozentpunkte, frueher 21.4)');
  ok(a45 < 0.75, 'ein 45-Grad-Streifschuss bleibt deutlich schwaecher (' +
     (a45 * 100).toFixed(1) + ' %)');
  // Und die Staerke bleibt eine eigene Groesse: mehr Tempo, mehr Ball.
  const s2 = stoss(2, 0).vBall, s4 = stoss(4, 0).vBall, s6 = stoss(6, 0).vBall;
  ok(s2 < s4 && s4 < s6, 'mehr Zugstaerke gibt mehr Ballgeschwindigkeit (' +
     f2(s2) + ' < ' + f2(s4) + ' < ' + f2(s6) + ')');
  // Ein schwacher Volltreffer bleibt schwaecher als ein starker Streifschuss — Winkel
  // und Staerke bleiben also BEIDE taktische Groessen, keine ersetzt die andere.
  ok(stoss(2, 0).vBall < stoss(6, 45).vBall,
     'Staerke schlaegt Winkel nicht automatisch: schwacher Volltreffer ' + f2(stoss(2, 0).vBall) +
     ' < starker Streifschuss ' + f2(stoss(6, 45).vBall));
}

// ── 3. DIE DAEMPFUNG IST UNANGETASTET ───────────────────────────────────────
// Der Auftrag war ausdruecklich: den Ball NICHT frueher zur Ruhe bringen. Geprueft wird
// an der Quelle (die Konstanten) UND am Verhalten (freier Lauf ohne jeden Kontakt).
{
  const p = F.phys();
  ok(p.friction === 0.9958 && p.frictionBall === 0.9964,
     'Daempfung oberhalb der Auslaufschwelle unveraendert (Spieler ' + p.friction +
     ', Ball ' + p.frictionBall + ')');
  ok(p.fend === 0.9620 && p.fendBall === 0.9790,
     'Auslaufdaempfung unveraendert (Spieler ' + p.fend + ', Ball ' + p.fendBall + ')');
  ok(p.fastv === 4.00 && p.frictionMid === 0.9840,
     'das mittlere Spielerband ist unveraendert (ab ' + p.fastv + ', Faktor ' + p.frictionMid + ')');
  ok(p.slowv === 0.70 && p.stopv === 0.075, 'Auslauf- und Ruheschwelle unveraendert');
  ok(p.frictionBall > p.friction && p.fendBall > p.fend,
     'der Ball bleibt der lebendigere Koerper — er daempft in BEIDEN Baendern schwaecher');
  // Freier Lauf: gemessene Werte, damit eine spaetere Aenderung sofort auffaellt.
  const frei = (owner, v0) => {
    F.classic();
    F.setz([{ x: -F.arena().halfLen * BR * 0.9, y: 0, vx: v0, vy: 0, owner }]);
    const p2 = [];
    for (let k = 1; k <= 120; k++) {
      F.schritt();
      if (k === 30 || k === 60 || k === 120) p2.push(F.lese()[0].sp);
    }
    return p2;
  };
  const b = frei(NEU, 6), s = frei(0, 6);
  ok(Math.abs(b[0] - 4.8325) < 5e-4 && Math.abs(b[1] - 3.8922) < 5e-4 && Math.abs(b[2] - 2.5249) < 5e-4,
     'der Ball laeuft unveraendert aus (6.00 -> ' + b.map((v) => v.toFixed(4)).join(' -> ') + ')');
  ok(Math.abs(s[0] - 4.6610) < 5e-4 && Math.abs(s[1] - 2.7525) < 5e-4 && Math.abs(s[2] - 0.1801) < 5e-4,
     'die Spielerkugel setzt sich unveraendert (6.00 -> ' + s.map((v) => v.toFixed(4)).join(' -> ') + ')');
  ok(b[2] > s[2] * 10,
     'nach zwei Sekunden ist der Ball noch klar in Fahrt, die Spielerkugel praktisch still');
}

// ── 4. DER BALL BLEIBT NACH EINEM TREFFER GEFAEHRLICH ───────────────────────
{
  F.classic();
  const vmax = F.launchV();
  F.setz([{ x: -300, y: 0, vx: vmax, vy: 0, owner: 0 }, { x: 0, y: 0, owner: NEU }]);
  let start = 0, tGef = 0, weg = 0, vor = null, los = false, k0 = 0;
  for (let k = 0; k < 3000; k++) {
    F.schritt();
    const b = F.lese()[1]; if (!b) break;
    if (!los && b.sp > 1e-9) { los = true; start = b.sp; k0 = k; vor = { x: b.x, y: b.y }; }
    if (!los) continue;
    weg += Math.hypot(b.x - vor.x, b.y - vor.y); vor = { x: b.x, y: b.y };
    if (b.sp >= 1.0) tGef = k - k0;
    if (b.sp <= F.stopv()) break;
  }
  ok(start > 5.2, 'ein Maximalzug ueber die halbe Arena gibt dem Ball ' + f2(start) +
     ' px/Frame (frueher 4.01)');
  ok(tGef / 60 >= 3.0, 'er bleibt ' + (tGef / 60).toFixed(2) +
     ' s lang gefaehrlich (mindestens so lange wie frueher: 3.20 s)');
  ok(weg > 1700, 'und legt dabei ' + weg.toFixed(0) + ' px zurueck — ' +
     (weg / (2 * F.arena().halfLen * BR)).toFixed(2) + ' Arenalaengen (frueher 1477 px)');
}

// ── 5. BANDE UND SOCKEL GEBEN DEM BALL EINE ZUKUNFT ─────────────────────────
// Bankschuss und Pfostenabpraller muessen ein Angriffsmittel bleiben. Die Restitutionen
// sind unveraendert; was sich aendert, ist der Pegel, mit dem der Ball ankommt.
{
  const prall = (ziel) => {
    F.classic();
    const a = F.arena(), wand = a.halfLen * BR, mitte = (a.postInner + a.postOuter) * 0.5 * BR;
    const vmax = F.launchV();
    if (ziel === 'band') F.setz([{ x: 0, y: 0, vx: 0, vy: vmax, owner: NEU }]);
    else F.setz([{ x: wand - 260, y: mitte, vx: vmax, vy: 0, owner: NEU }]);
    let vor = vmax;
    for (let k = 0; k < 600; k++) {
      F.schritt(); const b = F.lese()[0];
      if (ziel === 'band' ? b.vy < 0 : b.vx < 0) return { vor, nach: b.sp };
      vor = b.sp;
    }
    return { vor, nach: 0 };
  };
  const p = F.phys();
  ok(p.restBand === 0.60 && p.restPost === 0.50,
     'Bande und Sockel behalten ihre Restitution (' + p.restBand + ' / ' + p.restPost + ')');
  const bd = prall('band'), po = prall('post');
  ok(bd.nach / bd.vor > 0.55 && bd.nach / bd.vor < 0.65,
     'die Bande gibt ' + (bd.nach / bd.vor * 100).toFixed(1) + ' % zurueck');
  ok(po.nach / po.vor > 0.45 && po.nach / po.vor < 0.55,
     'der Sockel gibt ' + (po.nach / po.vor * 100).toFixed(1) + ' % zurueck');
  // Der Punkt, auf den es ankommt: nach einem sauberen Maximaltreffer ist der Ball auch
  // NACH der Bande noch schneller, als er frueher direkt nach dem Treffer war.
  const direkt = stoss(F.launchV(), 0).vBall;
  ok(direkt * (bd.nach / bd.vor) > 3.7,
     'nach Volltreffer UND Bande bleiben ' + f2(direkt * (bd.nach / bd.vor)) +
     ' px/Frame — fast so viel, wie ein Volltreffer frueher ueberhaupt lieferte (4.01)');
}

// ── 6. KETTEN ───────────────────────────────────────────────────────────────
// Spieler -> Ball -> Bande -> weiter, und Spieler -> Spieler -> Ball. Gemessen wird,
// dass die Kette nach jedem Glied noch Energie traegt.
{
  F.classic();
  const vmax = F.launchV();
  // Kette 1: Volltreffer, dann die lange Bande, dann weiter.
  F.setz([{ x: 0, y: -300, vx: 0, vy: vmax, owner: 0 }, { x: 0, y: -240, owner: NEU }]);
  let nachTreffer = 0, nachBande = 0, bande = false;
  for (let k = 0; k < 900; k++) {
    F.schritt();
    const b = F.lese()[1]; if (!b) break;
    if (!nachTreffer && b.sp > 1e-9) nachTreffer = b.sp;
    if (nachTreffer && !bande && b.vy < 0) { bande = true; nachBande = b.sp; }
  }
  ok(nachTreffer > 5.0, 'Kette: der Volltreffer setzt den Ball auf ' + f2(nachTreffer));
  ok(nachBande > 2.5, 'nach der Bande traegt er noch ' + f2(nachBande) +
     ' px/Frame — genug fuer einen Angriff');
  // Der Anteil enthaelt BEIDES: den Bandenverlust und die Daempfung auf dem Weg dorthin.
  // Er ist deshalb kleiner als die reine Bandenrestitution von 0.60.
  ok(nachBande / nachTreffer > 0.35,
     'die Bande nimmt ihm nicht die Zukunft (' + (nachBande / nachTreffer * 100).toFixed(1) +
     ' % erhalten, inklusive Flugdaempfung)');
  // Kette 2: Spieler trifft Spieler, dieser den Ball.
  F.classic();
  F.setz([{ x: -200, y: 0, vx: vmax, vy: 0, owner: 0 },
          { x: -136, y: 0, owner: 1 },
          { x: -54, y: 0, owner: NEU }]);
  let ballSp = 0;
  for (let k = 0; k < 600; k++) {
    F.schritt(); const s = F.lese();
    if (s[2].sp > 1e-9) { ballSp = s[2].sp; break; }
  }
  ok(ballSp > 2.0, 'Spieler -> Spieler -> Ball traegt bis zum Ball durch (' + f2(ballSp) + ' px/Frame)');
}

// ── 7. HOECHSTTEMPO UND EINSCHLUSS ──────────────────────────────────────────
// Der Stoss ist verlustbehaftet: er kann keine Energie erzeugen, das Tempo kann also
// nicht davonlaufen. Gemessen statt gedeckelt — eine Deckelung wuerde starke Schuesse
// beschneiden und die vorhandenen Stressproben (26-30 px je Teilschritt) verfaelschen.
{
  let seed = 424242 >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const A = [['2P Shouldered Wide', () => F.classic()], ['5P', () => F.phaseN(5)],
             ['4P', () => F.phaseN(4)], ['3P', () => F.phaseN(3)], ['2P Finale', () => F.phaseN(2)]];
  const vmax = F.launchV(), kontaktD = F.ballR() + F.playerR();
  let maxBall = 0, nan = 0, maxAus = 0, laeufe = 0, tore = 0;
  for (const [, setup] of A) {
    for (let t = 0; t < 120; t++) {
      setup();
      const list = [{ x: 0, y: 0, owner: NEU }];
      const n = 2 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const ph = rnd() * Math.PI * 2, r = 90 + rnd() * 260;
        list.push({ x: Math.cos(ph) * r, y: Math.sin(ph) * r,
                    vx: -Math.cos(ph) * vmax, vy: -Math.sin(ph) * vmax, owner: i % 5 });
      }
      F.setz(list); laeufe++;
      for (let k = 0; k < 300; k++) {
        F.schritt();
        const s = F.lese();
        let ende = false;
        for (const b of s) {
          if (!isFinite(b.x) || !isFinite(b.vx)) { nan++; ende = true; break; }
          if (b.owner === NEU && b.sp > maxBall) maxBall = b.sp;
          if (b.passed) continue;
          if (b.owner === NEU && F.window(b.x, b.y)) continue;
          const ue = F.over(b.x, b.y, b.owner);
          if (ue > maxAus) maxAus = ue;
        }
        if (ende) break;
        if (F.tor()) { tore++; break; }
      }
    }
  }
  ok(laeufe === 600, laeufe + ' Ketten mit zwei bis fuenf Maximalschuessen in fuenf Arenen');
  ok(nan === 0, 'kein NaN');
  ok(maxBall < vmax * 2,
     'das Tempo laeuft nicht davon: hoechstens ' + f2(maxBall) + ' px/Frame = ' +
     (maxBall / vmax * 100).toFixed(0) + ' % des Abschusstempos');
  ok(maxBall < kontaktD * 0.5,
     'und bleibt weit unter der kleinsten Kontaktdistanz (' + f2(maxBall) + ' gegen ' +
     kontaktD + ' px) — kein Ueberspringen moeglich');
  ok(maxAus <= 1.5,
     'der Einschluss haelt unter Hoechstlast (max Ueberschuss ' + maxAus.toFixed(3) + ' px)');
  ok(tore > 100, 'und es fallen dabei reichlich Tore (' + tore + ' in ' + laeufe + ' Ketten)');
}

// ── 8. DETERMINISMUS ────────────────────────────────────────────────────────
// Lockstep, Wiedergabe und Rehydrierung haengen daran, dass derselbe Eingang bitgleich
// denselben Ausgang liefert — in JEDER Arenaform.
{
  const A = [['2P', () => F.classic()], ['5P', () => F.phaseN(5)], ['4P', () => F.phaseN(4)],
             ['3P', () => F.phaseN(3)], ['2P Finale', () => F.phaseN(2)]];
  const vmax = F.launchV();
  for (const [n, setup] of A) {
    const lauf = () => {
      setup();
      F.setz([{ x: -200, y: 30, vx: vmax, vy: 0.7, owner: 0 },
              { x: 0, y: 0, owner: NEU },
              { x: 150, y: -80, vx: -vmax * 0.6, vy: 0.2, owner: 1 }]);
      for (let k = 0; k < 300; k++) F.schritt();
      return JSON.stringify(F.lese());
    };
    ok(lauf() === lauf(), n + ': derselbe Eingang liefert bitgleich denselben Ausgang');
  }
  // Der Stossimpuls selbst darf weder Zufall noch Uhrzeit kennen.
  const sim = SRC.match(/function stepSim\(\)\{[\s\S]*?\n\}/)[0];
  ok(!/Math\.random|Date\.now|performance\./.test(sim),
     'stepSim ist frei von Zufall und Zeit');
  ok(/const ma=ballMass\(a\),mb=ballMass\(b\),isum=1\/ma\+1\/mb;/.test(SRC),
     'die Massen kommen aus einer einzigen Quelle');
  ok(/const imp=-\(1\+RB\)\*vn\/isum,ia=imp\/ma,ib=imp\/mb;/.test(SRC),
     'und der Impuls verteilt sich nach ihnen');
}

// ── 9. AUSSERHALB FOOTBALL AENDERT SICH NICHTS ──────────────────────────────
// Zwei gleich schwere Kugeln liefern bitgenau die alte Formel. Das ist die Zusage fuer
// RingOut, FFA, Team Duel und die Golden-Physik.
{
  ok((1 / 1 + 1 / 1) === 2, 'fuer gleiche Massen ist 1/ma+1/mb exakt 2');
  const proben = [0.1, 1 / 3, Math.PI, 6.5959999999, 1e-9, 1234.5678];
  ok(proben.every((v) => (v / 1) === v), 'und die Division durch die Masse 1 ist exakt neutral');
  ok(F.masse(0) === 1 && F.masse(1) === 1 && F.masse(2) === 1 && F.masse(3) === 1 && F.masse(4) === 1,
     'jede Spielerkugel wiegt 1 — nur Owner ' + NEU + ' ist der leichte Ball');
  ok(/function ballMass\(b\)\{return mode==='football'&&b\.owner===FOOTBALL_NEUTRAL_OWNER\?FOOTBALL_BALL_MASS:1;\}/.test(SRC),
     'ausserhalb des Football-Modus wiegt ausnahmslos jede Kugel 1');
}

// ── 10. DAS TORMAUL BLEIBT, WIE ES ABGENOMMEN WURDE ─────────────────────────
{
  ok(/if\(footballGoalWindow\(fb\)\)continue;/.test(SRC),
     'im sichtbaren Torfenster haelt die Bande weiterhin nichts auf');
  ok(/function footballSweepPost\(b,px,py\)\{/.test(SRC), 'die gefegte Sockelkollision steht');
  ok(/if\(fb\.fbPassed&&footballBoundSD\(fb\)\.sd<=footballRescueLimit\(fb\)\)fb\.fbPassed=false;/.test(SRC),
     'der Durchtritt bleibt widerruflich');
  ok(/if\(Math\.abs\(dx\)-fbBallR\(\)>fbArena\(\)\.postBack\*BR\)return F\.side;/.test(SRC),
     'die kanonische Torlinie ist unveraendert');
  ok(F.rescueDepth() > 0, 'die Torrettungstasche hat weiterhin ihre Tiefe (' +
     F.rescueDepth().toFixed(2) + ' px)');
  // Und der Korridor traegt weiterhin — mit mehr Tempo, aber nicht breiter.
  F.classic();
  const clear = F.clearHalf(), center = F.centerHalf(), vmax = F.launchV();
  const d0 = F.arena().halfLen * BR - 150;
  let kante = 0;
  for (let off = 0; off <= clear + 4; off += 0.1) {
    F.classic();
    if (F.shoot(d0, off, vmax, 0, 300).tor) kante = off;
  }
  ok(kante >= center && kante <= clear,
     'die wirksame Toroeffnung ist unveraendert (' + f2(kante) + ' zwischen ' +
     f2(center) + ' und ' + f2(clear) + ')');
}

console.log(NL + 'Football-Action-Core: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
