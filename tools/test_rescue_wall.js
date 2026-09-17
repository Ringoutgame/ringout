// Reactive Rescue Wall (RW1, Offline/Bot): gezielte Vertragstests.
// Extrahiert den echten Wandblock (==RESCUE-WALL-START/END==) UND den echten stepSim
// aus index.html und treibt beide in einer minimalen Sandbox durch die Szenarien des
// freigegebenen Features. Online (rw-Slot, v4-Turn-Autoritaet) ist nicht Teil von RW1
// und wird hier ausdruecklich als ABWESEND geprueft.
//   node tools/test_rescue_wall.js
const HTML = require('./extract').loadIndexHtml();

const grab = (re, name) => { const m = HTML.match(re); if (!m) { console.error('FAIL: ' + name + ' nicht gefunden'); process.exit(2); } return m[0]; };
const blockM = HTML.match(/==RESCUE-WALL-START==([\s\S]*?)==RESCUE-WALL-END==/);
if (!blockM) { console.error('FAIL: Rescue-Wall-Block nicht gefunden'); process.exit(2); }
const wall = blockM[1];

const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const ballsOutsideSrc = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const constSrc = grab(/const MAXPULL_FRAC=[^\n]*/, 'Physik-Konstanten');
const spinSrc = grab(/const SPIN_K=[^\n]*/, 'Spin-Konstanten');
const pcolsSrc = grab(/const PCOLS=[^\n]*/, 'PCOLS');
const footballRestSrc = grab(/const FOOTBALL_PHYS=\{[\s\S]*?\nfunction curRestPost\(\)[^\n]*/, 'Football-Restitutions-Accessoren');

// Vorbedingungen an den extrahierten Text: bricht laut ab, statt still falsch zu messen.
if (!/typeof simTickAdvance==='function'/.test(stepSimSrc)) { console.error('FAIL: stepSim erhoeht den Sub-Step-Zaehler nicht'); process.exit(2); }
if (!/typeof barrierStep==='function'/.test(stepSimSrc)) { console.error('FAIL: stepSim ruft die Wandkollision nicht auf'); process.exit(2); }
if (!/wall\.owner>=0&&b\.owner!==wall\.owner/.test(wall)) { console.error('FAIL: Besitzerfilter der Wand fehlt'); process.exit(2); }

const prefix = `
  let mode='bot', online=false, fmt='single', ffaN=2;
  let R0=1000, BR=32, R=R0, cx=0, cy=0;
  let phase='aim', phaseStart=0, menuVisible=false, fbCoverOpen=false;
  let aimSet=[false,false], commitIdx=[], commitAim=[], commitSpin=[], curAimer=0;
  let balls=[];
  let outBall=-1, roundWinner=-1, bgPulse=0, bgPulseRGB='';
  let score=[0,0], roundNo=1, winTarget=3;
  let r3dActive=false, r3dOrbit=false, seatGone=[false,false];
  let aimPid=-1, spinPid=-1, camPid=-1, cam2Pid=-1;
  let resizeCalls=0;
  // Browserumgebung: genau so viel, wie der Wandblock beim Laden und im Betrieb liest.
  const location={search:''};
  const _listeners={};
  function addEventListener(type,fn){ (_listeners[type]=_listeners[type]||[]).push(fn); }
  const _els={};
  function _mkEl(id){ return {id:id,textContent:'',style:{display:'',cssText:''},
    classList:{_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},
      toggle(c,on){ if(on===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c); } else { on?this._s.add(c):this._s.delete(c);} },
      contains(c){return this._s.has(c);}},
    getBoundingClientRect(){return {left:0,top:0,right:40,bottom:40,width:40,height:40};},
    contains(){return false;}, disabled:false}; }
  const document={
    getElementById(id){ return _els[id]||null; },
    createElement(){ return _mkEl('neu'); },
    body:{appendChild(e){ _els[e.id]=e; }}
  };
  const cv={};
  function resize(){resizeCalls++;}
  function r3dInputBlocked(){return false;}
  function inputLocked(){return false;}
  function localPt(e){return {x:e.clientX,y:e.clientY};}
  ${constSrc}
  ${spinSrc}
  ${pcolsSrc}
  function curFR(){return FRICTION;} function curFE(){return FEND;} function curST(){return STOPV;}
  function curFRBall(){return FRICTION;} function curFEBall(){return FEND;} function curSLOWV(){return SLOWV;}
  function curFMID(){return FRICTION;} function curFASTV(){return Infinity;}
  ${footballRestSrc}
  function maxPull(){return R0*MAXPULL_FRAC;}
  function np(){return mode==='ffa'?ffaN:2;}
  function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
  function colorSlot(o){return o;}
  function setPhase(p){phase=p;if(typeof barrierPhaseHook==='function')barrierPhaseHook(p);}
  function updateHud(){} function setPhaseText(){} function devSync(){}
  function spawn(){} function popBall(){} function winnerRGB(){return '';}
  function fx3Hit(){} function fx3Flash(){} function fx3Shock(){} function fx3Dust(){}
  function showRoundEnd(){} function showTeamDraw(){} function gameOver(){setPhase('over');}
  function footballFreezePlayers(){} function footballTickGoal(){} function footballPhys(){return null;}
  function ballRad(){return BR;} function ballMass(){return 1;}
  function settleCollapse(){return false;}
  let fbGoalState='play';
  const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},
    warn(){},tick(){},collapse(){},collapseStop(){},colvEvent(){},colPreload(){},
    charge:{start(){},stop(){},update(){}}};
  ${ballsOutsideSrc}
  ${resolveRingOutsSrc}
  ${stepSimSrc}
  ${wall}
  // Das HUD-Abzeichen existiert im Produkt als festes Markup; hier wird es nachgebildet,
  // damit barrierRescueBadge() seinen echten Zustand pflegen kann.
  _els.rescueBadge=_mkEl('rescueBadge'); _els.rescueBadge.style.display='none';
  _els.rescueBadgeN=_mkEl('rescueBadgeN');
`;

const suffix = `
  ; return {
    BARRIER_SEG_COUNT, BARRIER_SPAN, BARRIER_HALF, BARRIER_RESTITUTION, BARRIER_STAKES_START,
    BARRIER_RESCUE_ZONE_INNER, BARRIER_RESCUE_ZONE_OUTER, BARRIER_RESCUE_TAP_SLOP_PX, BARRIER_MAX_BOUNCES,
    barrierSegAt, barrierSegCanon, barrierRescueZoneSeg, barrierRescueMode, barrierRescueSeat,
    barrierRescueCanPlace, barrierRescuePlace, barrierRescueActivate, barrierRescueEventOf,
    barrierOn, barrierStep, barrierPrepare, barrierArcs, barrierBuildArcs, barrierActiveSegments,
    barrierActiveWalls, barrierMakeWall, barrierWallsSet, barrierRescueClear,
    barrierRoundReset, barrierMatchReset, barrierPhaseHook, barrierUi, barrierRescueBadge,
    barrierCanArmSeat, barrierUiSeat, barrierRuntimeOn, barrierAvailableForMatch,
    simTick:()=>simTick, simTickReset, simTickAdvance,
    stepSim, ballsOutside,
    setMode(m){mode=m;}, setOnline(o){online=o;}, setPhaseRaw(p){phase=p;}, setPhaseHook(p){setPhase(p);},
    setMenu(m){menuVisible=m;}, setCover(c){fbCoverOpen=c;}, setR(v){R=v;}, getR(){return R;},
    setBalls(b){balls=b;}, getBalls(){return balls;}, getPhase(){return phase;},
    setStakes(a){for(let i=0;i<a.length;i++)barrierStakesBySeat[i]=a[i];},
    getStakes(){return barrierStakesBySeat.slice();},
    getEvents(){return barrierRescueEvents.map(e=>({tick:e.tick,owner:e.owner,seg:e.seg,on:e.on}));},
    getWalls(){return barrierWalls.map(w=>({owner:w.owner,segs:w.segs.slice(),arcs:w.arcs.length}));},
    getBadge(){const e=_els.rescueBadge;return {display:e.style.display,ready:e.classList.contains('ready'),
      empty:e.classList.contains('empty'),n:_els.rescueBadgeN.textContent};},
    getResizeCalls(){return resizeCalls;},
    getListeners(){return Object.keys(_listeners).sort();},
    BR:()=>BR, R0:()=>R0, cx:()=>cx, cy:()=>cy
  };
`;

let api;
try { api = new Function(prefix + suffix)(); }
catch (e) { console.error('FAIL: Sandbox laeuft nicht an — ' + e.message); process.exit(2); }

let pass = 0, fail = 0;
const t = (name, cond, info) => {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL: ' + name + (info !== undefined ? ' — ' + JSON.stringify(info) : '')); }
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);
const sec = (s) => console.log('\n' + s);

// Ausgangslage: Bot-Match, Physikphase, zwei lebende Kugeln.
const reset = (opts) => {
  const o = opts || {};
  api.setMode(o.mode || 'bot'); api.setOnline(!!o.online); api.setMenu(false); api.setCover(false);
  api.setR(o.R || 1000);
  api.setBalls([{owner:0,alive:true,x:0,y:0,vx:0,vy:0,spin:0},
                {owner:1,alive:true,x:200,y:0,vx:0,vy:0,spin:0}]);
  api.barrierMatchReset();
  api.setPhaseRaw(o.phase || 'sim');
  api.simTickReset();
};

// ── A. Vertragskonstanten ───────────────────────────────────────────────────
sec('A. Vertragskonstanten');
t('A1 zwoelf Randsegmente', api.BARRIER_SEG_COUNT === 12, api.BARRIER_SEG_COUNT);
t('A2 Segmentbreite 30 Grad', near(api.BARRIER_SPAN, Math.PI / 6));
t('A3 halbe Breite 15 Grad', near(api.BARRIER_HALF, Math.PI / 12));
t('A4 Wand-Restitution 0.55 (nicht die Kugel-Kugel-Restitution)', api.BARRIER_RESTITUTION === 0.55, api.BARRIER_RESTITUTION);
t('A5 drei Einsaetze je Seat und Match', api.BARRIER_STAKES_START === 3, api.BARRIER_STAKES_START);
t('A6 Rescue-Zone beginnt bei 62 % des Radius', api.BARRIER_RESCUE_ZONE_INNER === 0.62, api.BARRIER_RESCUE_ZONE_INNER);
t('A7 Rescue-Zone endet bei 145 % des Radius', api.BARRIER_RESCUE_ZONE_OUTER === 1.45, api.BARRIER_RESCUE_ZONE_OUTER);
t('A8 Tap-Wackeltoleranz 14 CSS-Pixel', api.BARRIER_RESCUE_TAP_SLOP_PX === 14, api.BARRIER_RESCUE_TAP_SLOP_PX);
t('A9 hoechstens vier Reflexionen je Kugel und Sub-Step', api.BARRIER_MAX_BOUNCES === 4, api.BARRIER_MAX_BOUNCES);

// ── B. Verfuegbarkeit: nur lokales Bot-Match ───────────────────────────────
sec('B. Verfuegbarkeit');
reset();
t('B1 Bot-Match offline: Rescue Wall aktiv', api.barrierRescueMode() === true);
t('B2 setzender Seat ist Seat 0', api.barrierRescueSeat() === 0);
reset({online:true});
t('B3 online: Rescue Wall aus', api.barrierRescueMode() === false);
t('B4 online: kein setzender Seat', api.barrierRescueSeat() === -1);
t('B5 online: auch die Pre-Shot-Vorwahl ist aus', api.barrierCanArmSeat(0) === false);
t('B6 online: keine Wand-Bedienoberflaeche', api.barrierUiSeat() === -1);
reset({mode:'pvp'});
t('B7 Hotseat: keine Rescue Wall (dort gilt die Pre-Shot-Wand)', api.barrierRescueMode() === false);
t('B8 Hotseat: die Wand ist im Match grundsaetzlich verfuegbar', api.barrierAvailableForMatch() === true);
reset({mode:'football'});
t('B9 Arena Football: die Wand existiert nicht', api.barrierAvailableForMatch() === false);
t('B10 Arena Football: keine Rescue Wall', api.barrierRescueMode() === false);
t('B11 Arena Football: keine Bedienoberflaeche', api.barrierUiSeat() === -1);
reset({mode:'ffa'});
t('B12 FFA: die Wand existiert nicht', api.barrierAvailableForMatch() === false);
reset(); api.setMenu(true);
t('B13 Menue: die Wand ist aus', api.barrierRuntimeOn() === false);
t('B14 Menue: keine Rescue Wall', api.barrierRescueMode() === false);
api.setMenu(false);

// ── C. Segmentzuordnung und Zone ──────────────────────────────────────────
sec('C. Segmentzuordnung und Zone');
reset();
const R = api.getR();
// Segmentmitte k liegt bei Winkel -90 Grad + k*30 Grad.
for (let k = 0; k < 12; k++) {
  const a = -Math.PI / 2 + k * Math.PI / 6;
  const px = Math.cos(a) * R, py = Math.sin(a) * R;
  t('C1.' + k + ' Segmentmitte ' + k + ' rastet auf Segment ' + k, api.barrierSegAt(px, py) === k, api.barrierSegAt(px, py));
}
const segAtAngle = (deg, rr) => {
  const a = (deg * Math.PI) / 180;
  return api.barrierRescueZoneSeg(Math.cos(a) * R * rr, Math.sin(a) * R * rr);
};
t('C2 Tap am Rand trifft das Segment', segAtAngle(-90, 1.0) === 0);
t('C3 Tap am Innenrand der Zone (63 %) zaehlt', segAtAngle(-90, 0.63) === 0);
t('C4 Tap weit ausserhalb (144 %) zaehlt', segAtAngle(-90, 1.44) === 0);
t('C5 Tap knapp innerhalb der Zone (61 %) zaehlt nicht', segAtAngle(-90, 0.61) === -1);
t('C6 Tap weit ausserhalb der Zone (146 %) zaehlt nicht', segAtAngle(-90, 1.46) === -1);
t('C7 Arenamitte zaehlt nie (dort dreht die Kamera)', api.barrierRescueZoneSeg(0, 0) === -1);
t('C8 Winkeltoleranz: 14 Grad neben der Mitte bleibt im Segment', segAtAngle(-90 + 14, 1.0) === 0);
t('C9 Grenze bei 15 Grad kippt ins Nachbarsegment', segAtAngle(-90 + 16, 1.0) === 1);
t('C10 Wrap 11->0 ueber die Oberkante', segAtAngle(-90 - 16, 1.0) === 11);
// Die Zone haengt am AKTUELLEN Radius: nach einem Collapse wandert sie mit.
api.setR(820);
t('C11 nach Collapse-Stufe 1 (R*0.82): Tap auf dem neuen Rand zaehlt',
  api.barrierRescueZoneSeg(Math.cos(-Math.PI / 2) * 820, Math.sin(-Math.PI / 2) * 820) === 0);
t('C12 nach Collapse-Stufe 1: der ALTE Rand liegt ausserhalb der Zone',
  api.barrierRescueZoneSeg(Math.cos(-Math.PI / 2) * 1000 * 1.25, Math.sin(-Math.PI / 2) * 1000 * 1.25) === -1);
api.setR(672);
t('C13 nach Collapse-Stufe 2 (R*0.82^2): Tap auf dem neuen Rand zaehlt',
  api.barrierRescueZoneSeg(Math.cos(-Math.PI / 2) * 672, Math.sin(-Math.PI / 2) * 672) === 0);
api.setR(1000);
t('C14 ungueltige Segmentnummern werden abgewiesen', api.barrierSegCanon(12) < 0 && api.barrierSegCanon(-1) < 0 && api.barrierSegCanon(1.5) < 0);
t('C15 gueltige Segmentnummern bleiben erhalten', api.barrierSegCanon(0) === 0 && api.barrierSegCanon(11) === 11);

// ── D. Einsaetze ──────────────────────────────────────────────────────────
sec('D. Einsaetze');
reset();
t('D1 Matchstart: drei Einsaetze je Seat', api.getStakes()[0] === 3 && api.getStakes()[1] === 3, api.getStakes());
t('D2 Platzierung verbraucht genau einen Einsatz', api.barrierRescuePlace(0, 3) === true && api.getStakes()[0] === 2, api.getStakes());
t('D3 hoechstens EINE Wand je Zug', api.barrierRescuePlace(0, 5) === false && api.getStakes()[0] === 2, api.getStakes());
api.setPhaseHook('aim');            // Zugende: Wand und Zeitplan fallen
api.setPhaseRaw('sim'); api.simTickReset();
t('D4 naechster Zug: wieder setzbar, Bestand sinkt weiter', api.barrierRescuePlace(0, 7) === true && api.getStakes()[0] === 1);
api.setPhaseHook('aim'); api.setPhaseRaw('sim'); api.simTickReset();
t('D5 dritte Wand verbraucht den letzten Einsatz', api.barrierRescuePlace(0, 9) === true && api.getStakes()[0] === 0);
api.setPhaseHook('aim'); api.setPhaseRaw('sim'); api.simTickReset();
t('D6 ohne Einsatz ist nichts mehr setzbar', api.barrierRescueCanPlace(0) === false && api.barrierRescuePlace(0, 1) === false);
api.barrierRoundReset();
t('D7 neue Runde fuellt NICHT auf', api.getStakes()[0] === 0, api.getStakes());
api.barrierMatchReset();
t('D8 neues Match setzt alle Seats auf den Startbestand', api.getStakes()[0] === 3 && api.getStakes()[1] === 3, api.getStakes());
reset();
api.setR(820);
api.barrierRescuePlace(0, 0);
const stakesBeforeCollapse = api.getStakes()[0];
api.setR(672);
t('D9 eine Collapse-Stufe veraendert den Bestand nicht', api.getStakes()[0] === stakesBeforeCollapse, api.getStakes());
api.setR(1000);

// ── E. Platzierungsfreigabe ───────────────────────────────────────────────
sec('E. Platzierungsfreigabe');
reset();
t('E1 waehrend der Physikphase setzbar', api.barrierRescueCanPlace(0) === true);
for (const p of ['aim', 'reveal', 'result', 'over']) {
  api.setPhaseRaw(p);
  t('E2.' + p + ' in der Phase "' + p + '" nicht setzbar', api.barrierRescueCanPlace(0) === false);
}
api.setPhaseRaw('sim');
t('E3 der gegnerische Seat kann nie setzen', api.barrierRescueCanPlace(1) === false);
t('E4 eine ungueltige Seatnummer wird abgewiesen', api.barrierRescueCanPlace(-1) === false && api.barrierRescueCanPlace(9) === false);
api.setMenu(true);
t('E5 im Menue nicht setzbar', api.barrierRescueCanPlace(0) === false);
api.setMenu(false);
api.setCover(true);
t('E6 waehrend der verdeckten Uebergabe nicht setzbar', api.barrierRescueCanPlace(0) === false);
api.setCover(false);
reset();
api.setBalls([{owner:0,alive:false,x:0,y:0,vx:0,vy:0,spin:0},{owner:1,alive:true,x:200,y:0,vx:0,vy:0,spin:0}]);
t('E7 ein ausgeschiedener Seat kann nicht setzen', api.barrierRescueCanPlace(0) === false);
reset();
t('E8 eine ungueltige Segmentnummer erzeugt keine Wand', api.barrierRescuePlace(0, 99) === false && api.getStakes()[0] === 3);

// ── F. Tick-Semantik: Ereignis wird erst an der naechsten Sub-Step-Grenze zur Wand ──
sec('F. Tick-Semantik');
reset();
api.barrierRescuePlace(0, 0);
const ev = api.getEvents();
t('F1 die Platzierung erzeugt genau ein Ereignis', ev.length === 1, ev);
t('F2 das Ereignis traegt den aktuellen Sub-Step-Zaehler', ev[0].tick === api.simTick(), {ev: ev[0], tick: api.simTick()});
t('F3 das Ereignis gehoert dem setzenden Seat und seinem Segment', ev[0].owner === 0 && ev[0].seg === 0, ev[0]);
t('F4 es ist noch KEINE Wand — die entsteht erst an der Sub-Step-Grenze', api.getWalls().length === 0, api.getWalls());
api.barrierRescueActivate();
t('F5 bei erreichtem Tick wird das Ereignis zur Wand', api.getWalls().length === 1, api.getWalls());
t('F6 die Wand gehoert ihrem Seat und traegt genau ihr Segment',
  api.getWalls()[0].owner === 0 && api.getWalls()[0].segs.length === 1 && api.getWalls()[0].segs[0] === 0, api.getWalls());
api.barrierRescueActivate();
t('F7 erneutes Aktivieren erzeugt keine zweite Wand', api.getWalls().length === 1, api.getWalls());
reset();
api.simTickReset();
api.barrierRescuePlace(0, 0);
api.simTickAdvance();
api.barrierRescueActivate();
t('F8 ein Ereignis mit erreichtem Tick wird auch spaeter aktiv', api.getWalls().length === 1);

// ── G. Kollision: die Wand haelt ausschliesslich die Kugeln ihres Besitzers ──
sec('G. Kollision');
// Die zweite Kugel steht bewusst INNEN und still: sie darf die Runde nicht selbst
// beenden, sonst misst der Kollisionstest gar nichts mehr.
// Ein Ring-out zeigt sich am Phasenwechsel nach 'result'. Die ausgeschiedene Kugel
// behaelt dabei alive=true — sie driftet im Ergebnisbild noch sichtbar weiter.
const PARK = {x: 0, y: 250};
const runWall = (wallOwner, ballOwner) => {
  reset();
  // Kugel laeuft von innen gerade nach oben auf die Mitte von Segment 0 zu.
  api.setBalls([{owner:ballOwner,alive:true,x:0,y:-R*0.55,vx:0,vy:-60,spin:0},
                {owner:1-ballOwner,alive:true,x:PARK.x,y:PARK.y,vx:0,vy:0,spin:0}]);
  api.barrierWallsSet(wallOwner === null ? [] : [api.barrierMakeWall(wallOwner, [0])]);
  api.setPhaseRaw('sim');
  let maxR = 0;
  for (let i = 0; i < 40 && api.getPhase() === 'sim'; i++) {
    api.stepSim();
    const b = api.getBalls()[0];
    maxR = Math.max(maxR, Math.hypot(b.x, b.y));
  }
  return {ball: api.getBalls()[0], phase: api.getPhase(), maxR: maxR, rang: api.getPhase() === 'result'};
};
const GRENZE = R + api.BR() * 0.1;
const gEigen = runWall(0, 0);
t('G1 die eigene Kugel wird gehalten — die Runde endet nicht', gEigen.rang === false, {phase: gEigen.phase});
t('G2 sie ueberschreitet die Grenze nie', gEigen.maxR <= GRENZE, {maxR: gEigen.maxR, grenze: GRENZE});
t('G3 der Abprall kehrt die Bewegungsrichtung um', gEigen.ball.vy > 0, {vy: gEigen.ball.vy});
t('G4 der Abprall ist gedaempft (Restitution 0.55, kein Trampolin)',
  gEigen.ball.vy > 0 && gEigen.ball.vy < 60, {vy: gEigen.ball.vy});
const gFremd = runWall(0, 1);
t('G5 eine FREMDE Kugel laeuft ungebremst durch, die Runde endet', gFremd.rang === true, {phase: gFremd.phase});
t('G6 sie ueberschreitet dabei die Grenze', gFremd.maxR > GRENZE, {maxR: gFremd.maxR, grenze: GRENZE});
const gPre = runWall(-1, 1);
t('G7 die Pre-Shot-Wand (Besitzer -1) haelt ALLE Kugeln', gPre.rang === false, {phase: gPre.phase});
const gOhne = runWall(null, 0);
t('G8 Gegenprobe: ohne Wand scheidet dieselbe Kugel aus', gOhne.rang === true, {phase: gOhne.phase});
t('G9 Gegenprobe: ohne Wand ist der Physikschalter aus', api.barrierOn() === false);

// ── H. Boegen: benachbarte Segmente verschmelzen, fremde Besitzer nie ──────
sec('H. Boegen');
let arcs = api.barrierBuildArcs([0]);
t('H1 ein Segment ergibt einen Bogen', arcs.length === 1 && arcs[0].segs === 1, arcs);
arcs = api.barrierBuildArcs([0, 1]);
t('H2 zwei benachbarte Segmente verschmelzen zu EINEM Bogen ohne innere Kante', arcs.length === 1 && arcs[0].segs === 2, arcs);
arcs = api.barrierBuildArcs([11, 0]);
t('H3 die Verschmelzung greift auch ueber die 11/0-Grenze', arcs.length === 1 && arcs[0].segs === 2, arcs);
arcs = api.barrierBuildArcs([0, 6]);
t('H4 getrennte Segmente bleiben zwei Boegen', arcs.length === 2, arcs);
arcs = api.barrierBuildArcs([0,1,2,3,4,5,6,7,8,9,10,11]);
t('H5 alle zwoelf ergeben einen geschlossenen Ring ohne Enden', arcs.length === 1 && arcs[0].full === true, arcs);
reset();
api.barrierWallsSet([api.barrierMakeWall(0, [3]), api.barrierMakeWall(1, [4])]);
const w = api.getWalls();
t('H6 Segmente VERSCHIEDENER Besitzer verschmelzen nie zu einem Bogen',
  w.length === 2 && w[0].arcs === 1 && w[1].arcs === 1, w);
t('H7 die Wandmengen liegen nach Besitzer aufsteigend (deterministische Reihenfolge)',
  w[0].owner < w[1].owner, w.map(x => x.owner));

// ── I. Lebensdauer ────────────────────────────────────────────────────────
sec('I. Lebensdauer');
reset();
api.barrierRescuePlace(0, 0); api.barrierRescueActivate();
t('I1 waehrend der Physikphase steht die Wand', api.getWalls().length === 1);
t('I2 der Physikschalter ist an', api.barrierOn() === true);
api.setPhaseHook('aim');
t('I3 mit dem Zugende faellt die Wand', api.getWalls().length === 0, api.getWalls());
t('I4 mit dem Zugende faellt auch der Zeitplan', api.getEvents().length === 0, api.getEvents());
t('I5 ausserhalb der Physikphase ist der Schalter aus', api.barrierOn() === false);
reset();
api.barrierRescuePlace(0, 0); api.barrierRescueActivate();
api.setPhaseHook('result');
t('I6 ein rundenbeendender Ring-out raeumt die Wand ebenso ab', api.getWalls().length === 0);
reset();
api.barrierRescuePlace(0, 0); api.barrierRescueActivate();
api.barrierRoundReset();
t('I7 die neue Runde raeumt Wand und Zeitplan ab', api.getWalls().length === 0 && api.getEvents().length === 0);
reset();
api.barrierRescuePlace(0, 0); api.barrierRescueActivate();
api.barrierMatchReset();
t('I8 das neue Match raeumt Wand und Zeitplan ab', api.getWalls().length === 0 && api.getEvents().length === 0);

// ── J. Anzeige ────────────────────────────────────────────────────────────
sec('J. Anzeige');
reset();
api.barrierUi();
let badge = api.getBadge();
t('J1 im Bot-Match ist das Abzeichen sichtbar', badge.display !== 'none', badge);
t('J2 es zeigt den Restbestand', String(badge.n) === '3', badge);
t('J3 es glimmt, solange die Wand einsetzbar ist', badge.ready === true, badge);
api.setPhaseRaw('aim'); api.barrierUi();
badge = api.getBadge();
t('J4 in der Planungsphase glimmt es nicht (dort ist nichts setzbar)', badge.ready === false, badge);
api.setPhaseRaw('sim');
api.setStakes([0, 3]); api.barrierUi();
badge = api.getBadge();
t('J5 ohne Einsaetze ist es ausgegraut', badge.empty === true, badge);
t('J6 ohne Einsaetze glimmt es nicht', badge.ready === false, badge);
reset({mode:'football'});
api.barrierUi();
t('J7 im Arena Football bleibt das Abzeichen verborgen', api.getBadge().display === 'none', api.getBadge());
reset({online:true});
api.barrierUi();
t('J8 online bleibt das Abzeichen verborgen', api.getBadge().display === 'none', api.getBadge());

// ── K. Eingabe ────────────────────────────────────────────────────────────
sec('K. Eingabe');
const ls = api.getListeners();
t('K1 die Wandbedienung haengt an den vier Zeigerereignissen',
  ['pointercancel','pointerdown','pointermove','pointerup'].every(x => ls.indexOf(x) >= 0), ls);

// ── L. Quelltextvertrag ───────────────────────────────────────────────────
sec('L. Quelltextvertrag (index.html)');
t('L1 der Wandblock ist als Einheit markiert', /==RESCUE-WALL-START==/.test(HTML) && /==RESCUE-WALL-END==/.test(HTML));
t('L2 das Abzeichen liegt in der Spielerkarte 0',
  /<div class="pcard" id="card0">.*id="rescueBadge".*<div class="pw" id="ready0">/.test(HTML));
t('L3 Arena Football blendet das Abzeichen aus', /#game\.fb \.rbadge\{display:none\}/.test(HTML));
t('L4 das Wand-GLB laeuft ueber assetUrl und wird genau einmal geladen',
  (HTML.match(/GLTFLoader\(\)\.load\(assetUrl\('assets\/temporary_barrier\//g) || []).length === 1);
t('L5 die Arena- und Segment-Ladepfade bleiben unberuehrt',
  (HTML.match(/GLTFLoader\(\)\.load\(assetUrl\('assets\/arena_platform/g) || []).length === 1
  && (HTML.match(/GLTFLoader\(\)\.load\(assetUrl\('assets\/ring_collapse\//g) || []).length === 1);
t('L6 alle Einhaengepunkte in stepSim sind typeof-abgesichert',
  /if\(typeof barrierRescueActivate==='function'\)barrierRescueActivate\(\);/.test(stepSimSrc)
  && /if\(typeof barrierPrepare==='function'\)barrierPrepare\(\);/.test(stepSimSrc)
  && /if\(typeof barrierStep==='function'\)barrierStep\(\);/.test(stepSimSrc)
  && /if\(typeof simTickAdvance==='function'\)simTickAdvance\(\);/.test(stepSimSrc));
t('L7 die Wandkollision laeuft VOR der Ring-Out-Auswertung',
  stepSimSrc.indexOf('barrierStep()') < stepSimSrc.indexOf('ballsOutside()'));
t('L8 der Sub-Step-Zaehler steigt NACH der Ring-Out-Auswertung',
  stepSimSrc.indexOf('resolveRingOuts(crossed)') < stepSimSrc.indexOf('simTickAdvance()'));
t('L9 die Wandkollision liegt im RingOut-Zweig, nicht im Football-Zweig',
  stepSimSrc.indexOf("mode==='football'") < stepSimSrc.indexOf('barrierStep()'));
// Der Block liegt HINTER stepSim und damit ausserhalb des Football-Schnittfensters
// (`const FOOTBALL_NEUTRAL_OWNER=` … `function stepSim(){`), das mehrere Football-Suiten
// als Ganzes herausschneiden. Weiter vorne darf er nicht stehen: zwischen den
// Football-Konstanten hat er Bereichsschnitte anderer Suiten aufgeblaeht.
// Die Regel "ab der Football-Physik kein Suchparameter-Leser" erfuellt er nicht durch
// seinen Platz, sondern durch den eigenen Parser barrierParam().
t('L10 der Wandblock liegt hinter stepSim, ausserhalb des Football-Schnittfensters',
  HTML.indexOf('==RESCUE-WALL-START==') > HTML.indexOf('\nfunction stepSim(){'));
t('L10b hinter der Football-Physik steht kein Suchparameter-Leser',
  !/URLSearchParams/.test(HTML.slice(HTML.indexOf('FOOTBALL_PHYS'))));
t('L10c die Wand liest ihre Debugschalter ueber den eigenen Parser',
  /function barrierParam\(name\)\{/.test(HTML) && !/URLSearchParams/.test(wall));
t('L11 Online-Collapse/-Wand ist nicht portiert (RW1)',
  !/barrierRescueNetOn|barrierRescueOnlineMatch|barrierRescueOnlineOn|writeRescueSlot|rescueSlotValid/.test(HTML));
t('L12 kein Online-Slot `rw` im Client', !/\/rw\/|rescuePlacementPayload|RESCUE_RW_VERSION/.test(HTML));
t('L13 der Abschuss setzt den Sub-Step-Zaehler zurueck',
  /if\(typeof simTickReset==='function'\)simTickReset\(\);/.test(HTML));
t('L14 der Phasenwaechter haengt an setPhase',
  /function setPhase\(p\)\{[^\n]*barrierPhaseHook\(p\)/.test(HTML));
t('L15 neues Match setzt die Einsaetze zurueck',
  /if\(typeof barrierMatchReset==='function'\)barrierMatchReset\(\);/.test(HTML));
t('L16 die neue Runde raeumt die Zugbindung ab',
  /if\(typeof barrierRoundReset==='function'\)barrierRoundReset\(\);/.test(HTML));
t('L17 der Kontextverlust verwirft einen laufenden Wand-Drag',
  /if\(typeof barrierDragCancel==='function'\)barrierDragCancel\(\);/.test(HTML));
t('L18 das Wand-Asset steht in der Auslieferungsliste',
  /'assets\/temporary_barrier\/export\/temporary_barrier_polish2\.glb'/.test(
    require('fs').readFileSync(require('path').join(__dirname, 'build_hosting.js'), 'utf8')));

console.log('\nRescue-Wall: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
