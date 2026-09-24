#!/usr/bin/env node
// ONLINE RESCUE WALL (Fassung 13): die reaktive Wand im echten Onlinevertrag.
//
// Getestet wird der ECHTE Code aus index.html - der Wandblock (==RESCUE-WALL==), der
// echte stepSim, die Nachrechnung (simReplayTurnTo) und das Onlinemodul (roWa*) gegen
// eine Datenbank-Attrappe, die sich wie der Slot verhaelt: write-once je (Zug, Sitz),
// Rueckgabe immer der autoritative Wert.
//
//   A  Gates: die Wand gibt es online nur in einem RingOut-Raum der Fassung 13
//   B  Platzierung: eigener Sitz, gueltiges Segment, write-once, EINE Wand je Zug
//   C  Fremde Wand: sie entsteht aus dem Slot, gehoert ihrem Besitzer und kostet DESSEN Einsatz
//   D  Determinismus: eine spaet eintreffende Wand fuehrt zum SELBEN Zugausgang
//   E  Zugende: der Zug haelt, bis jeder Sitz gesprochen hat
//   F  Bestand: drei Einsaetze je Match, kein Auffuellen, Ruecknahme gibt zurueck
//   G  Rueckkehr: Bestand und Waende allein aus der Historie
//   H  Rematch: neue Generation -> voller Bestand, keine alte Wand
//   I  Rules: Eigentuemer, write-once, Wertebereiche, eigener Zug
'use strict';
const fs = require('fs');
const path = require('path');
const { loadIndexHtml } = require('./extract');
const HTML = loadIndexHtml();
const RULES = JSON.parse(fs.readFileSync(path.join(path.dirname(__dirname), 'firebase.rules.json'), 'utf8'));

const grab = (re, name) => { const m = HTML.match(re); if (!m) { console.error('FAIL: ' + name + ' nicht gefunden'); process.exit(2); } return m[0]; };
const blockM = HTML.match(/==RESCUE-WALL-START==([\s\S]*?)==RESCUE-WALL-END==/);
if (!blockM) { console.error('FAIL: Rescue-Wall-Block nicht gefunden'); process.exit(2); }
const wall = blockM[1];
const stepSimSrc = grab(/let fbVorausTiefe=0;[\s\S]*?\nfunction stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
const ballsOutsideSrc = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const constSrc = grab(/const MAXPULL_FRAC=[^\n]*/, 'Physik-Konstanten');
const spinSrc = grab(/const SPIN_K=[^\n]*/, 'Spin-Konstanten');
const pcolsSrc = grab(/const PCOLS=[^\n]*/, 'PCOLS');
const footballRestSrc = grab(/const FOOTBALL_PHYS=\{[\s\S]*?\nfunction curRestPost\(\)[^\n]*/, 'Football-Restitution');
const modul = grab(/let roWaTurn=-1;[\s\S]*?\nfunction roWaEinsatzOffen\(\)\{[^\n]*\}/, 'roWa-Modul');
const writeOnce = grab(/function roWriteOnce\(pfad,wert\)\{[\s\S]*?\n\}/, 'roWriteOnce');

if (!/simReplayTurnTo/.test(modul)) { console.error('FAIL: das Modul rechnet nicht nach'); process.exit(2); }
if (!/if\(typeof roWaHalt==='function'&&roWaHalt\(\)\)return;/.test(stepSimSrc)) { console.error('FAIL: stepSim kennt den Zugende-Halt nicht'); process.exit(2); }

const prefix = `
  let mode='pvp', online=true, fmt='single', ffaN=2, roomProto=13;
  let R0=1000, BR=32, R=R0, cx=0, cy=0;
  let phase='aim', phaseStart=0, menuVisible=false, fbCoverOpen=false;
  let aimSet=[false,false], commitIdx=[], commitAim=[], commitSpin=[], curAimer=0;
  let myPlayer=0, turnNo=0, gen=0, roomCode='AB12', onlineSessionId=1, terminated=false;
  let balls=[], outBall=-1, roundWinner=-1, bgPulse=0, bgPulseRGB='';
  let score=[0,0], roundNo=1, winTarget=3;
  let r3dActive=false, r3dOrbit=false, seatGone=[false,false], seatLeft=[false,false];
  let soundOn=true, particles=[], fx3=[], replaying=false;
  let aimPid=-1, spinPid=-1, camPid=-1, cam2Pid=-1, resizeCalls=0;
  const RINGOUT_PARITY_FASSUNG=13, RINGOUT_SKIP_FASSUNG=12;
  const diag=[];
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
  const document={ getElementById(id){ return _els[id]||null; }, createElement(){ return _mkEl('neu'); },
                   body:{appendChild(e){ _els[e.id]=e; }} };
  const cv={};
  function resize(){resizeCalls++;}
  function r3dInputBlocked(){return false;}
  function inputLocked(){return false;}
  function localPt(e){return {x:e.clientX,y:e.clientY};}
  function ringoutParitaetsRaum(){return !!online&&roomProto===RINGOUT_PARITY_FASSUNG;}
  function isCurrentCtx(c){return c.sid===onlineSessionId&&c.room===roomCode&&c.gen===gen&&c.turnNo===turnNo;}
  function isOnlineTerminated(){return terminated;}
  function r3dDiag(k,i){diag.push({k:k,i:i});}
  function fbFxSilence(v){return !!v;}
  function fbLaunchMul(){return LAUNCH;}
  function fbSfxLaunch(){}
  function fx3Launch(){}
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
  function onlineArmTurn(){ turnNo++; if(typeof roWaZugNeu==='function')roWaZugNeu(turnNo); }
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
  // Firebase-Attrappe: write-once je Pfad, Knotenlesen ueber Praefix, onValue liefert
  // den aktuellen Knoten sofort und nach jeder Aenderung.
  const DB={}; const HOERER=[];
  function _knoten(p){ const out={}; const pre=p+'/';
    for(const k in DB){ if(k.indexOf(pre)!==0)continue; const rest=k.slice(pre.length);
      if(rest.indexOf('/')>=0)continue; out[rest]=DB[k]; }
    return Object.keys(out).length?out:null; }
  function _melden(){ for(const h of HOERER)h.cb({val(){return _knoten(h.p);}}); }
  const window={FB:{
    db:{}, ref(_d,p){return {p:p};}, serverTimestamp(){return {__ts:true};},
    runTransaction(ref,fn,opt){
      const cur=(ref.p in DB)?DB[ref.p]:null;
      const neu=fn(cur);
      let wert=cur;
      if(neu!==undefined){ wert=(neu&&neu.__ts)?1:neu; DB[ref.p]=wert; _melden(); }
      return Promise.resolve({committed:neu!==undefined,snapshot:{val(){return wert;}}});
    },
    onValue(ref,cb){ const h={p:ref.p,cb:cb}; HOERER.push(h);
      cb({val(){return _knoten(ref.p);}});
      return ()=>{ const i=HOERER.indexOf(h); if(i>=0)HOERER.splice(i,1); }; }
  }};
  ${ballsOutsideSrc}
  ${resolveRingOutsSrc}
  ${stepSimSrc}
  ${wall}
  ${writeOnce}
  ${modul}
  _els.rescueBadge=_mkEl('rescueBadge'); _els.rescueBadge.style.display='none';
  _els.rescueBadgeN=_mkEl('rescueBadgeN');
`;

const suffix = `
  ; return {
    BARRIER_STAKES_START, BARRIER_SEG_COUNT,
    barrierRescueMode, barrierRescueSeat, barrierRescueCanPlace, barrierRescuePlace,
    barrierRuntimeOn, barrierAvailableForMatch, barrierCanArmSeat, barrierMatchReset,
    barrierRoundReset, barrierRescueEventOf, barrierUi,
    roWaOnline, roWaReset, roWaZugNeu, roWaWatch, roWaWert, roWaPlan, roWaAbgleich,
    roWaZugEnde, roWaHalt, roWaFertig, roWaOffen, roWaEinsatzOffen, roWaHistorie,
    roWaAussageNachtragen, roWaBestandSetzen, roWaNachspielGate,
    stepSim, DB, diag,
    // Abschuss wie im Produkt: Tick 0, Abbild, Listener, Simulationsphase.
    abschuss(v){ for(let i=0;i<v.length;i++)if(v[i]){balls[i].vx=v[i][0];balls[i].vy=v[i][1];}
      simTickReset(); simLaunchSnapshot=simSnapshotTake();
      if(typeof roWaWatch==='function')roWaWatch();
      setPhase('sim'); },
    lauf(n){ for(let i=0;i<n&&phase==='sim';i++)stepSim(); },
    bisEnde(max){ let g=0; while(phase==='sim'&&g++<(max||20000))stepSim(); return g; },
    tick(){return simTick;}, phase(){return phase;}, raus(){return outBall;},
    setPhaseRaw(p){phase=p;}, setTurn(n){turnNo=n;}, zug(n){turnNo=n;roWaZugNeu(n);}, setGen(g){gen=g;}, setSeat(s){myPlayer=s;},
    setProto(p){roomProto=p;}, setOnline(o){online=o;}, setMode(m){mode=m;}, setMenu(m){menuVisible=m;},
    setBalls(b){balls=b;}, setR(v){R=v;}, setTerm(v){terminated=v;}, setLeft(a){seatLeft=a;},
    setFmt(f){fmt=f;}, setFFA(n){ffaN=n;},
    kugeln(){return balls.map(b=>({owner:b.owner,alive:b.alive,x:b.x,y:b.y,vx:b.vx,vy:b.vy}));},
    stand(){return barrierStakesBySeat.slice();},
    events(){return barrierRescueEvents.map(e=>({tick:e.tick,owner:e.owner,seg:e.seg,on:e.on}));},
    waende(){return barrierWalls.map(w=>({owner:w.owner,segs:w.segs.slice()}));},
    wandZahl(){return barrierWalls.length;}
  }`;

let pass = 0, fail = 0;
const t = (name, cond, info) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL: ' + name + (info !== undefined ? ' — ' + JSON.stringify(info) : '')); }
};
const sec = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));
const bau = () => { const w = new Function(prefix + suffix)(); w.barrierMatchReset(); return w; };
const warte = () => new Promise(r => setImmediate(r));
const kugel = (owner, x, y) => ({ owner, alive: true, x, y, vx: 0, vy: 0, spin: 0, sx: x, sy: y });
// Ausgangslage: zwei Kugeln, die rechte laeuft nach aussen und wird ohne Wand hinausgetragen.
const lage = (w) => { w.setR(1000); w.setBalls([kugel(0, 600, 0), kugel(1, -600, 0)]); w.zug(0); };

(async () => {
// ══ A. GATES ═════════════════════════════════════════════════════════════════
sec('A. Online gibt es die Wand nur in einem RingOut-Raum der Fassung 13');
{
  const w = bau(); lage(w);
  t('A1 Fassung 13: die Wand ist verfuegbar', w.barrierAvailableForMatch() === true && w.roWaOnline() === true);
  w.setPhaseRaw('sim');
  t('A2 der Rescue-Modus laeuft', w.barrierRescueMode() === true);
  t('A3 und der setzende Sitz ist der EIGENE', w.barrierRescueSeat() === 0);
  w.setSeat(1);
  t('A4 aus Sicht des anderen Clients dessen eigener', w.barrierRescueSeat() === 1);
  w.setSeat(0);
  t('A5 die Pre-Shot-Vorwahl bleibt online aus', w.barrierCanArmSeat(0) === false);
}
{
  const w = bau(); lage(w); w.setProto(12); w.setPhaseRaw('sim');
  t('A6 Fassung 12 hat online keine Wand', w.roWaOnline() === false && w.barrierAvailableForMatch() === false);
  t('A7 und keinen Setzsitz', w.barrierRescueSeat() === -1 && w.barrierRescueCanPlace(0) === false);
}
{
  const w = bau(); lage(w); w.setOnline(false); w.setMode('bot'); w.setPhaseRaw('sim');
  t('A8 das lokale Bot-Training bleibt unveraendert', w.barrierRescueMode() === true && w.barrierRescueSeat() === 0);
}

// ══ B. PLATZIERUNG ═══════════════════════════════════════════════════════════
sec('B. Die Platzierung ist eigen, einmalig und autoritativ');
{
  const w = bau(); lage(w);
  w.abschuss([[6, 0], null]); w.lauf(3);
  const k = w.tick();
  t('B1 der eigene Sitz darf setzen', w.barrierRescueCanPlace(0) === true);
  t('B2 ein fremder Sitz nicht', w.barrierRescueCanPlace(1) === false);
  const ok1 = w.barrierRescuePlace(0, 3);
  await warte();
  t('B3 die Platzierung gilt sofort lokal', ok1 === true && w.events().length === 1 && w.events()[0].seg === 3);
  t('B4 und steht autoritativ im eigenen Slot', JSON.stringify(w.DB['rooms/AB12/g/0/rw/0/0']) === JSON.stringify({ k: k, s: 3 }), w.DB);
  t('B5 sie kostet genau einen Einsatz', w.stand()[0] === 2 && w.stand()[1] === 3, w.stand());
  t('B6 eine zweite Wand im selben Zug ist gesperrt', w.barrierRescueCanPlace(0) === false && w.barrierRescuePlace(0, 5) === false);
  t('B7 und es bleibt bei EINEM Slot', Object.keys(w.DB).length === 1, Object.keys(w.DB));
}
{
  const w = bau(); lage(w);
  w.abschuss([[6, 0], null]); w.lauf(2);
  t('B8 ein ungueltiges Segment wird nicht gesetzt', w.barrierRescuePlace(0, 12) === false && w.barrierRescuePlace(0, -1) === false);
  await warte();
  t('B9 und schreibt nichts', Object.keys(w.DB).length === 0, Object.keys(w.DB));
}
{
  // Fremder Slot gewinnt das Rennen: die eigene Platzierung wird zurueckgenommen,
  // der Einsatz kommt zurueck - ohne zweite Buchhaltung.
  const w = bau(); lage(w);
  w.abschuss([[6, 0], null]); w.lauf(2);
  w.DB['rooms/AB12/g/0/rw/0/0'] = { p: true };     // bereits eine Aussage dieses Sitzes
  w.barrierRescuePlace(0, 3);
  await warte();
  t('B10 der autoritative Wert gilt', JSON.stringify(w.DB['rooms/AB12/g/0/rw/0/0']) === JSON.stringify({ p: true }));
  t('B11 die eigene Wand faellt wieder weg', w.events().length === 0, w.events());
  t('B12 und der Einsatz ist zurueck', w.stand()[0] === 3, w.stand());
}

// ══ C. FREMDE WAND ═══════════════════════════════════════════════════════════
sec('C. Eine fremde Wand entsteht aus ihrem Slot');
{
  const w = bau(); lage(w);
  w.abschuss([[6, 0], [-6, 0]]); w.lauf(2);
  w.roWaWert({ 1: { k: 1, s: 9 } });
  t('C1 die Wand gehoert Sitz 1', w.events().length === 1 && w.events()[0].owner === 1 && w.events()[0].seg === 9, w.events());
  t('C2 sie kostet DESSEN Einsatz, nicht den eigenen', w.stand()[0] === 3 && w.stand()[1] === 2, w.stand());
  w.lauf(1);
  const ws = w.waende();
  t('C3 die aktivierte Wand traegt ihren Besitzer', ws.length === 1 && ws[0].owner === 1, ws);
  t('C4 die Wandkollision liegt vor der Ring-out-Auswertung (Quelltext)',
    /if\(typeof barrierStep==='function'\)barrierStep\(\);\s*\n\s*const crossed=ballsOutside\(\);/.test(HTML));
}

// ══ D. DETERMINISMUS ═════════════════════════════════════════════════════════
sec('D. Eine spaete Wand fuehrt zum SELBEN Zugausgang');
{
  // A setzt bei Tick k. B erfaehrt es erst deutlich spaeter und rechnet den Zug vom
  // Abschuss an neu. Danach muessen beide Welten Kugel fuer Kugel gleich sein.
  const A = bau(), B = bau();
  lage(A); lage(B);
  A.abschuss([[6, 0], null]); B.abschuss([[6, 0], null]);
  A.lauf(3); B.lauf(3);
  const k = A.tick();
  A.barrierRescuePlace(0, 3);
  await warte();
  B.lauf(12);                                   // B ist laengst vorbei
  const vorher = B.tick();
  B.roWaWert({ 0: { k: k, s: 3 } });
  t('D1 B rechnet den Zug nach', B.tick() === vorher, [B.tick(), vorher]);
  // Verglichen wird der Zeitplan, nicht der Laufzeitstand: A steht noch VOR dem Sub-Step
  // ihres eigenen Ticks, B hat ihn im Nachlauf bereits durchlaufen. Dass beide danach
  // beim selben Ergebnis herauskommen, zeigt D3.
  const ohneOn = (e) => ({ tick: e.tick, owner: e.owner, seg: e.seg });
  t('D2 und hat danach denselben Zeitplan',
    JSON.stringify(A.events().map(ohneOn)) === JSON.stringify(B.events().map(ohneOn)), [A.events(), B.events()]);
  A.bisEnde(); B.bisEnde();
  t('D3 beide Welten enden Kugel fuer Kugel gleich', JSON.stringify(A.kugeln()) === JSON.stringify(B.kugeln()), [A.kugeln(), B.kugeln()]);
  t('D4 und mit demselben Bestand', JSON.stringify(A.stand()) === JSON.stringify(B.stand()), [A.stand(), B.stand()]);
  t('D5 die Wand hat die Kugel wirklich gehalten', A.kugeln()[0].alive === true && A.phase() !== 'result', A.kugeln());
}
{
  // Gegenprobe: ohne Wand geht dieselbe Kugel hinaus. Sonst wuerde D nichts beweisen.
  const w = bau(); lage(w);
  w.abschuss([[6, 0], null]);
  w.bisEnde();
  t('D6 ohne Wand verlaesst die Kugel den Ring', w.phase() === 'result' && w.raus() === 0, [w.phase(), w.raus()]);
}

// ══ E. ZUGENDE ═══════════════════════════════════════════════════════════════
sec('E. Der Zug endet erst, wenn jeder gesprochen hat');
{
  const w = bau(); lage(w);
  w.abschuss([[1, 0], [-1, 0]]);
  w.bisEnde();
  t('E1 der Zug haelt am Ende an', w.phase() === 'sim' && w.roWaHalt() === true);
  const tickA = w.tick();
  w.stepSim(); w.stepSim();
  t('E2 und die Physik ruht dabei vollstaendig', w.tick() === tickA, [w.tick(), tickA]);
  await warte();
  t('E3 die eigene Aussage ist hinausgegangen', JSON.stringify(w.DB['rooms/AB12/g/0/rw/0/0']) === JSON.stringify({ p: true }), w.DB);
  t('E4 es fehlt noch der andere Sitz', w.roWaFertig() === false);
  w.roWaWert({ 0: { p: true }, 1: { p: true } });
  t('E5 danach ist der Zug vollstaendig', w.roWaFertig() === true && w.roWaHalt() === false);
  w.bisEnde();
  t('E6 und er endet regulaer in der Planungsphase', w.phase() === 'aim', w.phase());
}
{
  // Ein Sitz, der gar nicht setzen konnte, haelt den Zug nie auf.
  const w = bau(); lage(w);
  w.roWaBestandSetzen([]);
  w.setBalls([kugel(0, 600, 0), kugel(1, -600, 0)]);
  w.abschuss([[1, 0], [-1, 0]]);
  w.roWaWert({ 0: { p: true }, 1: { p: true } });
  w.bisEnde();
  t('E7 mit beiden Aussagen laeuft der Zug durch', w.phase() === 'aim', w.phase());
}
{
  const w = bau(); lage(w); w.setTerm(true);
  w.abschuss([[1, 0], [-1, 0]]);
  w.bisEnde();
  t('E8 nach einem terminalen Abbruch wird nie gewartet', w.roWaHalt() === false && w.phase() === 'aim');
}
{
  const w = bau(); lage(w); w.setLeft([false, true]);
  w.abschuss([[1, 0], [-1, 0]]);
  w.bisEnde();
  await warte();
  t('E9 ein abwesender Sitz haelt den Zug nicht auf', w.phase() === 'aim', w.phase());
}

// ══ F. BESTAND ═══════════════════════════════════════════════════════════════
sec('F. Drei Einsaetze je Match, kein Auffuellen');
{
  const w = bau(); lage(w);
  t('F1 Startbestand', w.stand()[0] === 3 && w.BARRIER_STAKES_START === 3);
  for (let n = 1; n <= 3; n++) {
    w.zug(n - 1);
    w.setBalls([kugel(0, 600, 0), kugel(1, -600, 0)]);
    w.abschuss([[6, 0], null]); w.lauf(2);
    w.barrierRescuePlace(0, 3); await warte();
    t('F2.' + n + ' nach ' + n + ' Waenden bleiben ' + (3 - n), w.stand()[0] === 3 - n, w.stand());
  }
  w.zug(3);
  w.setBalls([kugel(0, 600, 0), kugel(1, -600, 0)]);
  w.abschuss([[6, 0], null]); w.lauf(2);
  t('F3 danach ist kein Einsatz mehr da', w.barrierRescueCanPlace(0) === false && w.barrierRescuePlace(0, 3) === false);
  t('F4 und eine neue Runde fuellt nicht auf', (w.barrierRoundReset(), w.stand()[0] === 0), w.stand());
}
{
  // Eine vierte Wand aus einem fremden Slot gilt nicht - dieselbe Obergrenze auf
  // jedem Client, ohne dass der Server sie zaehlen muesste.
  const w = bau(); lage(w);
  for (let n = 0; n < 3; n++) {
    w.zug(n);
    w.setBalls([kugel(0, 600, 0), kugel(1, -600, 0)]);
    w.abschuss([[6, 0], null]); w.lauf(2);
    w.roWaWert({ 1: { k: 1, s: 3 } });
  }
  t('F5 Sitz 1 hat drei Waende gesetzt', w.stand()[1] === 0, w.stand());
  w.zug(3);
  w.setBalls([kugel(0, 600, 0), kugel(1, -600, 0)]);
  w.abschuss([[6, 0], null]); w.lauf(2);
  w.roWaWert({ 1: { k: 1, s: 3 } });
  t('F6 eine vierte Wand desselben Sitzes gilt nicht', w.events().length === 0, w.events());
  t('F7 und der Bestand bleibt bei 0', w.stand()[1] === 0, w.stand());
}

// ══ G. RUECKKEHR ═════════════════════════════════════════════════════════════
sec('G. Die Rueckkehr baut den Bestand aus der Historie');
{
  const w = bau(); lage(w);
  w.roWaHistorie({ 0: { 0: { k: 4, s: 3 } }, 1: { 1: { k: 2, s: 9 } }, 2: { 0: { k: 6, s: 1 } } });
  const vor = w.roWaNachspielGate(true);
  for (let n = 0; n <= 3; n++) w.zug(n);
  w.roWaNachspielGate(vor);
  t('G1 zwei eigene Waende sind verbraucht', w.stand()[0] === 1, w.stand());
  t('G2 eine fremde ebenso', w.stand()[1] === 2, w.stand());
  t('G3 der laufende Zug beginnt ohne Zeitplan', w.events().length === 0, w.events());
}

// ══ H. REMATCH ═══════════════════════════════════════════════════════════════
sec('H. Ein Rematch beginnt mit vollem Bestand');
{
  const w = bau(); lage(w);
  w.abschuss([[6, 0], null]); w.lauf(2);
  w.barrierRescuePlace(0, 3); await warte();
  t('H1 Vorbereitung: eine Wand steht', w.stand()[0] === 2 && w.events().length === 1);
  w.setGen(1); w.setTurn(0);
  w.barrierMatchReset();                         // newGame des Rematches
  t('H2 der Bestand ist wieder voll', JSON.stringify(w.stand()) === JSON.stringify([3, 3]), w.stand());
  t('H3 es gibt keinen alten Zeitplan mehr', w.events().length === 0 && w.wandZahl() === 0);
  t('H4 und keine alte Aussage', w.roWaOffen() === false);
}

// ══ I. RULES ═════════════════════════════════════════════════════════════════
sec('I. Die Rules tragen denselben Vertrag');
{
  const rw = RULES.rules.rooms.$code.g.$gen.rw;
  t('I1 der Wandslot existiert als eigener Zweig', !!rw && !!rw.$turn && !!rw.$turn.$seat);
  const S = rw.$turn.$seat, W = S['.write'], V = S['.validate'];
  t('I2 nur in einem RingOut-Raum der Fassung 13',
    /child\('v'\)\.val\(\) === 13/.test(W) && /child\('config\/game'\)\.val\(\) === 'ringout'/.test(W));
  t('I3 nur im laufenden Match', /child\('state'\)\.val\(\) === 'playing'/.test(W));
  t('I4 nur in der aktuellen Generation', /\$gen === root\.child\('rooms'\)\.child\(\$code\)\.child\('gen'\)\.val\(\) \+ ''/.test(W));
  t('I5 write-once', /!data\.exists\(\)/.test(W) && /newData\.exists\(\)/.test(W));
  t('I6 NUR der Eigentuemer des Sitzes',
    /child\('players'\)\.child\(\$seat\)\.child\('uid'\)\.val\(\) === auth\.uid/.test(W));
  t('I7 und nur, wenn er verbunden ist', /child\('p'\)\.child\(\$seat\)\.child\('on'\)\.val\(\) === true/.test(W));
  t('I8 und nur fuer einen Zug, den er selbst gespielt hat',
    /child\('t'\)\.child\(\$turn\)\.child\(\$seat\)\.exists\(\)/.test(W));
  t('I9 der Sitz ist auf 0..4 begrenzt', /\$seat === '0' \|\| \$seat === '1' \|\| \$seat === '2' \|\| \$seat === '3' \|\| \$seat === '4'/.test(W));
  t('I10 entweder Platzierung ODER Aussage - nie beides',
    /newData\.hasChildren\(\['k','s'\]\) && !newData\.child\('p'\)\.exists\(\)/.test(V)
    && /newData\.child\('p'\)\.exists\(\) && !newData\.child\('k'\)\.exists\(\) && !newData\.child\('s'\)\.exists\(\)/.test(V));
  t('I11 das Segment ist ganzzahlig 0..11',
    /newData\.val\(\) >= 0 && newData\.val\(\) <= 11/.test(S.s['.validate'])
    && /newData\.val\(\) === \(newData\.val\(\) - newData\.val\(\) % 1\)/.test(S.s['.validate']));
  t('I12 der Sub-Step-Zaehler ist ganzzahlig und begrenzt',
    /newData\.val\(\) >= 0 && newData\.val\(\) <= 20000/.test(S.k['.validate']));
  t('I13 die Aussage ist genau true', /newData\.val\(\) === true/.test(S.p['.validate']));
  t('I14 nichts anderes darf im Slot stehen', S.$other['.validate'] === false);
  t('I15 die Obergrenze des Zaehlers ist die des Nachrechnens',
    /const SIM_REPLAY_MAX_STEPS=20000;/.test(HTML));
  t('I16 Arena Football hat keinen rw-Zweig',
    !/football/.test(JSON.stringify(rw)));
}

console.log('\nOnline-Rescue-Wall: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
