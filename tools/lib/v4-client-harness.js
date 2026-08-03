// ─────────────────────────────────────────────────────────────────────────────
// RingOut — gemeinsamer v4-Client-Sandkasten fuer die Offline-Suiten.
//
// Extrahiert die ECHTEN Online-Funktionen aus index.html und laesst sie in
// einem Sandkasten je Client gegen tools/lib/fake-v4.js laufen (echte
// room-core/clock-core-Kerne). Es gibt bewusst nur EINE Stelle, an der die
// Extraktionsliste, die Stubs und die Client-API gepflegt werden — die drei
// Online-Suiten teilen sie sich.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const { createFakeV4 } = require('./fake-v4.js');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(1); }
  return m[0];
};

const SRC = [
  grab(/const ONLINE_PROTOCOL_VERSION=[^\n]*/, 'ONLINE_PROTOCOL_VERSION'),
  grab(/const FFA_MAX_SEATS=[^\n]*/, 'FFA_MAX_SEATS'),
  grab(/const GEN_MAX=[^\n]*/, 'GEN_MAX'),
  grab(/function viewAngle\(\)\{[\s\S]*?\n\}/, 'viewAngle'),
  grab(/function beginReveal\(\)\{[^\n]*/, 'beginReveal'),
  grab(/function ejectGoneSeats\(\)\{[\s\S]*?\n\}/, 'ejectGoneSeats'),
  grab(/function onlineConnectionLost\(ctx\)\{[\s\S]*?\n\}/, 'onlineConnectionLost'),
  grab(/function np\(\)\{[^\n]*/, 'np'),
  grab(/function teamCap\(\)\{[^\n]*/, 'teamCap'),
  grab(/function ffaRoom\(\)\{[^\n]*/, 'ffaRoom'),
  grab(/function ffaSeatCap\(\)\{[^\n]*/, 'ffaSeatCap'),
  grab(/function teamOf\(s\)\{[^\n]*/, 'teamOf'),
  grab(/function colorSlot\(owner\)\{[^\n]*/, 'colorSlot'),
  grab(/function aliveCount\(owner\)\{[^\n]*/, 'aliveCount'),
  grab(/function allAliveCommitted\(\)\{[^\n]*/, 'allAliveCommitted'),
  // multi-line since the collapse refactor — same greedy-safe pattern the other
  // multi-line functions in this list use, so future line breaks stay covered
  grab(/function whoCanAim\(\)\{[\s\S]*?\n\}/, 'whoCanAim'),
  grab(/function whenFB\(cb\)\{[^\n]*/, 'whenFB'),
  grab(/function fbReady\(\)\{[^\n]*/, 'fbReady'),
  grab(/function rRef\(p\)\{[^\n]*/, 'rRef'),
  grab(/function setStatus\(t\)\{[^\n]*/, 'setStatus'),
  grab(/function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom'),
  grab(/function pickFreeSeat\(p,max\)\{[^\n]*/, 'pickFreeSeat'),
  grab(/function seatCount\(p\)\{[^\n]*/, 'seatCount'),
  grab(/function seatsContiguous\(p,n\)\{[^\n]*/, 'seatsContiguous'),
  grab(/function renderLobby\(p\)\{[\s\S]*?\n\}/, 'renderLobby'),
  grab(/function setOnTitle\(ffa\)\{[\s\S]*?\n\}/, 'setOnTitle'),
  grab(/function openOnline\(\)\{[\s\S]*?\n\}/, 'openOnline'),
  grab(/function createRoom\(\)\{[\s\S]*?\n\}/, 'createRoom'),
  grab(/function joinRoom\(\)\{[\s\S]*?\n\}/, 'joinRoom'),
  grab(/function startFfaMatch\(\)\{[\s\S]*?\n\}/, 'startFfaMatch'),
  grab(/function onLobbyClosed\(\)\{[\s\S]*?\n\}/, 'onLobbyClosed'),
  grab(/function attachRoomListeners\(\)\{[\s\S]*?\n\}/, 'attachRoomListeners'),
  grab(/function maybeStart\(\)\{[^\n]*\n[^\n]*\}/, 'maybeStart'),
  grab(/function startOnlineGame\(\)\{[\s\S]*?\n\}/, 'startOnlineGame'),
  grab(/function ensureOnlineClock\(\)\{[\s\S]*?\n\}/, 'ensureOnlineClock'),
  grab(/function onOppLeft\(\)\{[\s\S]*?\n\}/, 'onOppLeft'),
  grab(/function onlineArmTurn\(\)\{[\s\S]*?\n\}/, 'onlineArmTurn'),
  grab(/function isCurrentCtx\(ctx\)\{[^\n]*/, 'isCurrentCtx'),
  grab(/function isOnlineTerminated\(\)\{[^\n]*/, 'isOnlineTerminated'),
  grab(/function writeTurnSlot\(s,payload,opts\)\{[\s\S]*?\n\}/, 'writeTurnSlot'),
  grab(/function processSlot\(s,c\)\{[\s\S]*?\n\}/, 'processSlot'),
  grab(/function settleSlot\(s,ctx,result,err\)\{[\s\S]*?\n\}/, 'settleSlot'),
  grab(/function maybeReveal\(\)\{[\s\S]*?\n\}/, 'maybeReveal'),
  grab(/function onlineTurnValue\(val\)\{[\s\S]*?\n\}/, 'onlineTurnValue'),
  grab(/function onlineSendCommit\(idx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'onlineSendCommit'),
  grab(/function simHash\(\)\{[\s\S]*?\n\}/, 'simHash'),
  grab(/function onlineRematch\(\)\{[\s\S]*?\n\}/, 'onlineRematch'),
  grab(/function leaveOnline\(\)\{[\s\S]*?\n\}/, 'leaveOnline'),
  // v3 identity (Paket A) + compensated claim lifecycle (Korrekturrunde)
  grab(/function genToken\(n\)\{[\s\S]*?\n\}/, 'genToken'),
  grab(/function capGraphemes\(s,max\)\{[\s\S]*?\n\}/, 'capGraphemes'),
  grab(/function sanitizeName\(raw\)\{[\s\S]*?\n\}/, 'sanitizeName'),
  grab(/function newJoinOp\(\)\{[^\n]*/, 'newJoinOp'),
  grab(/function joinOpCurrent\(op\)\{[^\n]*/, 'joinOpCurrent'),
  grab(/function seatActive\(p,s\)\{[^\n]*/, 'seatActive'),
  grab(/function roomRejoinableState\(d,seat\)\{[\s\S]*?\n\}/, 'roomRejoinableState'),
  grab(/function playerRecord\(seat\)\{[^\n]*/, 'playerRecord'),
  grab(/function nameForSeat\(s\)\{[\s\S]*?\n\}/, 'nameForSeat'),
  grab(/function findOwnSeat\(players,pid\)\{[\s\S]*?\n\}/, 'findOwnSeat'),
  grab(/function rememberRoom\(code,seat\)\{[^\n]*/, 'rememberRoom'),
  grab(/function forgetRoom\(\)\{[^\n]*/, 'forgetRoom'),
  grab(/function savedRoom\(\)\{[\s\S]*?\n\}/, 'savedRoom'),
  grab(/function clearLobbyHostGrace\(\)\{[^\n]*/, 'clearLobbyHostGrace'),
  grab(/function startLobbyHostGrace\(\)\{[\s\S]*?\n\}/, 'startLobbyHostGrace'),
  grab(/function evalLobbyHostPresence\(\)\{[\s\S]*?\n\}/, 'evalLobbyHostPresence'),
  // B2 same-seat reclaim + in-match grace + canonical rehydration
  grab(/function validateRejoinRoom\(d\)\{[\s\S]*?\n\}/, 'validateRejoinRoom'),
  grab(/function clearMatchGrace\(s\)\{[^\n]*/, 'clearMatchGrace'),
  grab(/function clearAllMatchGrace\(\)\{[^\n]*/, 'clearAllMatchGrace'),
  grab(/function startMatchGrace\(s\)\{[\s\S]*?\n\}/, 'startMatchGrace'),
  grab(/function seatFinallyGone\(s\)\{[\s\S]*?\n\}/, 'seatFinallyGone'),
  grab(/function fastForwardMatch\(turns\)\{[\s\S]*?\n\}/, 'fastForwardMatch'),
  grab(/async function attemptRejoin\(code\)\{[\s\S]*?\n\}/, 'attemptRejoin'),
  // v4: Transport, Uhr und Zugberechtigung
  grab(/function v4Ready\(\)\{[^\n]*/, 'v4Ready'),
  grab(/function whenV4\(timeoutMs\)\{[\s\S]*?\n\}/, 'whenV4'),
  grab(/function newRequestId\(\)\{[^\n]*/, 'newRequestId'),
  grab(/async function callV4\(name,data\)\{[\s\S]*?\n\}/, 'callV4'),
  grab(/async function callV4Retry\(name,data,tries\)\{[\s\S]*?\n\}/, 'callV4Retry'),
  grab(/function v4Err\(e\)\{[\s\S]*?\n\}/, 'v4Err'),
  grab(/function attachClockListener\(\)\{[\s\S]*?\n\}/, 'attachClockListener'),
  grab(/function onOnlineClock\(\)\{[\s\S]*?\n\}/, 'onOnlineClock'),
  grab(/function onlineClockView\(nowSrv\)\{[\s\S]*?\n\}/, 'onlineClockView'),
  grab(/function onlineEligibleSeats\(\)\{[\s\S]*?\n\}/, 'onlineEligibleSeats'),
  grab(/function onlineSeatEligible\(s\)\{[^\n]*/, 'onlineSeatEligible'),
  grab(/function onlineAllEligibleCommitted\(\)\{[\s\S]*?\n\}/, 'onlineAllEligibleCommitted'),
  grab(/function onlineNextEligible\(\)\{[\s\S]*?\n\}/, 'onlineNextEligible'),
  grab(/function reportSettlement\(\)\{[\s\S]*?\n\}/, 'reportSettlement'),
  grab(/function flushSettlement\(\)\{[\s\S]*?\n\}/, 'flushSettlement'),
  grab(/function requestClockClose\(\)\{[\s\S]*?\n\}/, 'requestClockClose'),
  // Zweizeiler: die schliessende Klammer steht am ZEILENENDE, nicht auf einer
  // eigenen Zeile — ein [\s\S]*?\n\} wuerde ueber die Funktion hinausgreifen.
  grab(/function onlineResetClock\(\)\{[^\n]*\n[^\n]*\}/, 'onlineResetClock'),
  grab(/function onlineCollapseCount\(\)\{[^\n]*/, 'onlineCollapseCount'),
].join('\n');

// ── Gemeinsame v4-Datenschicht ───────────────────────────────────────────────
// KEIN eigener Rules-Nachbau und KEIN Mini-Arbiter mehr: tools/lib/fake-v4.js
// fahrt den ECHTEN functions/room-core.js und functions/clock-core.js gegen eine
// In-Memory-DB. Damit gilt hier exakt derselbe Vertrag wie am Emulator.
//
// Was der Client frueher selbst schrieb (Raum anlegen, Seat claimen, Presence
// aktivieren, state/seats setzen, gen bumpen, Listing pflegen, Leave-Sentinel
// nachschieben), macht jetzt ausschliesslich der Server. Diese Suite prueft
// deshalb nicht mehr die WRITES des Clients, sondern seine AUFRUFE und die
// daraus folgende, serverseitig entstandene Datenlage.
function makeDb() {
  // Steuerbare Serverzeit: die Suite muss Deadlines ueberschreiten koennen, ohne
  // real zu warten. Der Arbiter rechnet ausschliesslich mit dieser Uhr.
  let T = 1700000000000;
  const F = createFakeV4({ now: () => T });
  F.db.now = () => T;
  return {
    F,
    advance(ms) { T += ms; },
    setNow(v) { T = v; },
    get data() { return { rooms: F.db.read('rooms') || {} }; },
    room: (c) => F.room(c),
    clock: (c, g) => F.clock(c, g || 0),
    slots: (c, g) => F.slots(c, g || 0),
    turn: (c, g, t2) => F.turn(c, g || 0, t2),
    calls: () => F.calls.slice(),
    clearCalls: () => { F.calls.length = 0; },
    // Schreibprotokoll — NUR die Pfade, die der CLIENT selbst geschrieben hat.
    // Serverwrites des Arbiters laufen ueber dieselbe DB, sind aber als 'server'
    // markiert. Genau diese Trennung traegt den Nachweis, dass der Client keine
    // server-owned Pfade mehr anfasst.
    writes: () => F.db.writeLog.filter((w) => w.actor === 'client').map((w) => w.path),
    allWrites: () => F.db.writeLog.map((w) => w.actor + ':' + w.path),
    clearWrites: () => { F.db.writeLog.length = 0; },
    now: () => F.db.now(),
    // Client-Sicht auf die Datenbank, gebunden an die UID dieses Clients.
    FBfor: (ui, uid) => Object.assign({}, F.FB, { call: F.callableFor(uid) }),
  };
}

// ── one sandboxed client = the real functions + inert UI/game stubs ──
function makeClient(db, code, forcePid, forceUid) {
  const ui = { code, log: [], onDrop: [] };
  // Jeder Client hat eine EIGENE Anonymous-Auth-UID — genau wie zwei echte
  // Geraete. forceUid laesst einen "neu geladenen" Client dieselbe UID behalten
  // (Reconnect), forcePid dieselbe dauerhafte Spieler-Id.
  const seq = (makeClient._seq = (makeClient._seq || 0) + 1);
  const pid = forcePid || ('PID' + String(seq).padStart(6, '0'));
  const tab = 'TAB' + String(seq).padStart(6, '0');
  const uid = forceUid || ('uid-flow-' + String(seq).padStart(4, '0'));
  const FB = db.FBfor(ui, uid);
  const body = `
    const TUNE=false; let r3dOrbit=false;
    const T=k=>k;   // i18n-Stub: extrahierte Dialog-Funktionen loggen Text-KEYS (keine Asserts darauf)
    const PCOLS=[{ui:'#e33'},{ui:'#3e3'},{ui:'#33e'},{ui:'#ee3'},{ui:'#e3e'}];
    // v4-Laufzeit: UID aus der Anonymous-Auth und die Callable-Fabrik. Beides
    // ist Vorbedingung fuer jeden v4-Pfad (v4Ready pruef genau das).
    const window={__FB_READY:true,__FB_ERR:null,__FB_V4:true,__FB_UID:${JSON.stringify(uid)},FB,
      addEventListener(){},removeEventListener(){},dispatchEvent(){}};
    const FN_REGION='europe-west1';
    const document={querySelector:()=>({textContent:''})};
    const els={}; function $(id){return els[id]||(els[id]={style:{},classList:{add(){},remove(){}},textContent:'',innerHTML:'',value:'',disabled:false,querySelector:()=>({textContent:''})});}
    let toastT; const toast=m=>{ui.log.push('toast:'+m);$('toast').textContent=m;};
    let mode='bot',menuMode='bot',diff='easy',winTarget=3,fmt='single',ffaN=3,ffaNMenu=3;
    let online=false, roomCode='', myPlayer=0, gen=0, runningGen=-1, turnNo=-1;
    let turnUnsub=null, genUnsub=null, presUnsub=null, seatsUnsub=null, gameStarted=false;
    let lobbyP={}, seatLeft=[], seatGone=[];
    let pendingSlot={}, onlineSessionId=0;
    // Die Leave-Sentinel-Maschinerie ist im Produktcode entfallen — offene Slots
    // fuellt der Arbiter an der Deadline. Hier steht deshalb NICHTS mehr.
    let onlineTerminatedSession=-1;
    // v4-Rauminstanz und Session (werden ausschliesslich aus Callable-Antworten
    // befuellt, nie geraten).
    let onlineIid='', onlineSession='', clockUnsub=null, v4ReqSeq=0;
    let onlineClockState=null, clockClosePhase='', clockSettlePhase='', clockStartGen=-1;
    let pendingSettle=null, settleRetryAt=0, onlineReplaying=false;
    // v3 identity state (per client)
    const NAME_MAX=16, NAME_MAX_UNITS=48, LOBBY_HOST_GRACE_MS=12000;
    let onlinePid=${JSON.stringify(pid)}, onlineTab=${JSON.stringify(tab)}, onlineName='';
    let playersRoster={}, rosterUnsub=null, lobbyHostGraceTimer=null, joinOpSeq=0;
    // B2: In-Match-Grace laeuft hier mit ECHTEN Timern, aber 0ms — sie feuert im
    // naechsten tick() (setImmediate pumpt die Timer-Phase), sodass die zeitfreien
    // Vor-B2-Disconnect-Asserts (Sofort-Sentinel nach drop) unveraendert gelten.
    // Das 15s-Reclaim-Fenster ist davon unabhaengig (Fake-DB-Zeit via db.advance).
    let roomP={}, matchGraceTimer={};
    // Online-Uhr (v4): der Zustand ist echt — onlineResetClock/onlineClockView/
    // onlineEligibleSeats werden aus index.html extrahiert und pflegen ihn.
    let srvOffsetMs=0, onCollapsedGen=-1, onCollapseCount=0;
    let onlineRemainMs=30000, onlineHasClock=false;
    const COLLAPSE_CYCLE_SECONDS=30, COLLAPSE_STAGE_COUNT=2;
    function serverNow(){return Date.now()+srvOffsetMs;}
    function updateCollapseHud(){}
    function onlineCollapsePending(){return false;}   // Visuals sind in dieser Suite inert
    const SEAT_STALE_MS=0;
    // fastForwardMatch-Umgebung: Physik ist hier gestubbt (Flow-Suite testet den
    // Online-FLOW; die bit-identische Replay-Physik deckt test_reconnect ab).
    // stepSim-Stub = natuerlicher Turn-Abschluss ohne Ringout: Commits zuruecksetzen,
    // naechster Turn wird gearmt — exakt der !moving-Zweig des echten stepSim.
    let soundOn=false, particles=[], fx3=[];
    function applyLaunch(){setPhase('sim');}
    function stepSim(){for(let i=0;i<np();i++){aimSet[i]=false;commitIdx[i]=-1;commitAim[i]={dx:0,dy:0};commitSpin[i]=0;}setPhase('aim');if(online){curAimer=myPlayer;onlineArmTurn();}}
    function afterResult(){}
    // Public-Lobby: das Discovery-Listing ist in v4 vollstaendig server-owned
    // (roomCreateV4 legt es an, roomStartV4/roomLeaveV4 raeumen es iid-gebunden
    // ab). Der Client schreibt es NICHT mehr — es gibt hier deshalb auch keine
    // Listing-Stubs mehr, nur noch das committete roomPublic-Flag.
    let roomPublic=false, createVisibility='private';
    function hidePublicUI(){}
    function startPublicListing(){} function stopPublicListing(){} function setOn(){}
    function updScrollHint(){}   // Scroll-Cue der Startseite: reine UI, im Flow inert
    let phase='over', curAimer=0, balls=[], aimSet=[], commitIdx=[], commitAim=[], commitSpin=[], score=[];
    let replaying=false, repPlaying=false;
    const cx=500, cy=500, BR=32; let R=485;
    const rrand=()=>ui.code;
    const showGame=()=>ui.log.push('showGame'), showMenu=()=>ui.log.push('showMenu');
    const updateHud=()=>{}, setPhaseText=()=>{}, openCover=()=>{};
    const setPhase=ph=>{phase=ph;if(ph==='reveal')ui.log.push('reveal');};
    const sanitizeMove=(who,idx,dx,dy,sp)=>({idx,dx,dy,sp});
    // processSlot() braucht aliveBalls() fuer den server-gebuchten No-Shot
    // ({ns:'stand'} -> eigene Kugel, Impuls 0).
    function aliveBalls(o){return balls.filter(b=>b.alive&&b.owner===o);}
    function newGame(){ ui.log.push('newGame:'+np()); balls=[];aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
      for(let i=0;i<np();i++){const a=Math.PI/2+i*2*Math.PI/np();
        balls.push({owner:i,alive:true,x:cx+Math.cos(a)*300,y:cy+Math.sin(a)*300,vx:0,vy:0});
        aimSet.push(false);commitIdx.push(-1);commitAim.push({dx:0,dy:0});commitSpin.push(0);}
      phase='aim'; if(online){curAimer=myPlayer;onlineArmTurn();} }
    // whoCanAim consults the collapse input lock. collapseActive() is
    // collapseEnabled && mode==='bot' && !online — always false in this online
    // harness, so production returns false here too.
    function inputLocked(){return false;}
    ${SRC}
    // Browserfenster zu: alle Listener sterben, der Client schreibt NICHTS mehr.
    // In v4 gibt es keinen clientseitigen onDisconnect-Payload — Presence und
    // Session gehoeren dem Server, und ein offener Slot wird vom Arbiter an der
    // Deadline als No-Shot gebucht.
    function drop(){
      try{if(turnUnsub)turnUnsub();}catch(e){} try{if(genUnsub)genUnsub();}catch(e){}
      try{if(presUnsub)presUnsub();}catch(e){} try{if(seatsUnsub)seatsUnsub();}catch(e){}
      try{if(rosterUnsub)rosterUnsub();}catch(e){} try{if(clockUnsub)clockUnsub();}catch(e){}
      turnUnsub=genUnsub=presUnsub=seatsUnsub=rosterUnsub=clockUnsub=null;
      ui.onDrop.length=0;
    }
    return {
      ui, els,
      st(){return {online,mode,menuMode,fmt,ffaN,ffaNMenu,myPlayer,gameStarted,roomCode,phase,gen,runningGen,aimSet:aimSet.slice(),commitIdx:commitIdx.slice(),commitAim:commitAim.map(a=>a.dx+'/'+a.dy),score:score.slice()};},
      setMenu(m,n){mode=menuMode=m;if(n)ffaN=ffaNMenu=n;},
      setLobbyP(p){lobbyP=p;},
      create(){createRoom();},
      join(c){$('onInput').value=c;joinRoom();},
      clickStart(){startFfaMatch();},
      canAim(){return whoCanAim();},
      va(){return viewAngle();},
      ballDist(o){const b=balls.find(x=>x.owner===o);return b?Math.hypot(b.x-cx,b.y-cy):-1;},
      hash(){return simHash();},
      gone(o){return !!seatGone[o];},
      kill(o){const b=balls.find(x=>x.owner===o);if(b)b.alive=false;},
      // P0-Fix-Spiegel: wie commit() online — NUR senden, das Turn-Echo (onlineTurnValue)
      // wendet den Move an (auch den eigenen). Kein lokaler Sonderweg mehr.
      commitMove(){ if(whoCanAim()<0)return false; onlineSendCommit(myPlayer,5,5,0); return true; },
      rematch(){onlineRematch();},
      leave(){leaveOnline();},
      pid(){return onlinePid;},
      setFmt(f){fmt=f;},
      // Spiegel des produktiven nameInput-Handlers (inline Event-Listener, daher
      // nicht extrahierbar): AUSSCHLIESSLICH das Feld name wird partiell
      // geschrieben — nie der ganze Record. Ein set() mit playerRecord() wuerde
      // uid loeschen und tab rotieren; die v4-Rules lehnen das ab.
      setName(n){onlineName=sanitizeName(n);
        if(!(online&&roomCode))return Promise.resolve();
        const wanted=onlineName||T('col'+myPlayer);
        try{ return FB.update(rRef('players/'+myPlayer),{name:wanted}).catch(()=>{}); }
        catch(e){ return Promise.resolve(); }},
      roster(){return JSON.parse(JSON.stringify(playersRoster));},
      nameFor(s){return nameForSeat(s);},
      async rejoin(c){return await attemptRejoin(c);},
      status(){return $('onStatus').textContent;},
      hasGrace(){return !!lobbyHostGraceTimer;},
      setVis(v){createVisibility=v;},
      isRoomPublic(){return roomPublic;},
      // Eigenen Zug direkt in live/slots legen — derselbe Weg wie writeTurnSlot
      // (Write-once-Transaction, sid + Turnnummer), aber ohne die UI-Kette.
      // Suiten, die viele Phasen am Stueck abspielen, brauchen das.
      async putSlot(turn){
        const ref=window.FB.ref(window.FB.db,'rooms/'+roomCode+'/g/'+gen+'/live/slots/'+myPlayer);
        return await window.FB.runTransaction(ref, cur=>cur==null
          ? {idx:myPlayer,dx:1,dy:1,sp:0,t:(turn==null?turnNo:turn),sid:onlineSession}
          : undefined);
      },
      // ── v4-Sicht dieses Clients ──
      uid(){return window.__FB_UID;},
      iid(){return onlineIid;},
      session(){return onlineSession;},
      clock(){return onlineClockState?JSON.parse(JSON.stringify(onlineClockState)):null;},
      eligible(){return onlineEligibleSeats();},
      nextEligible(){return onlineNextEligible();},
      // Direkter Callable-Zugriff fuer Race-/Idempotenz-Szenarien: exakt der
      // Aufrufweg des Clients, aber ohne UI drumherum.
      async callV4(name,data){return await callV4(name,data);},
      // Zwei Aufrufe mit STABILER requestId (Retry-Semantik des Clients).
      async callTwice(name,data){
        const payload=Object.assign({requestId:newRequestId()},data||{});
        const a=await window.FB.call(name)(payload);
        const b=await window.FB.call(name)(payload);
        return [a&&a.data,b&&b.data];
      },
      drop
    };`;
  return new Function('FB', 'ui', body)(FB, ui);
}

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
// B2: tick pumpt zusaetzlich EINE reale Timer-Runde (2ms) — die 0ms-Grace-Timer
// der Sandbox (SEAT_STALE_MS=0) feuern damit deterministisch innerhalb eines
// tick(), und ihre Folgewrites propagieren in der zweiten setImmediate-Serie.
const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 2));
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
};
// External presence-flap simulation (server-observed disconnect from OUTSIDE any
// sandboxed client): v3 onDisconnect only ever writes {s,on:false,t} on the SAME
// token, never removes — this mirrors that for scenarios that flap a seat without
// going through a real client's own drop().
async function dropSeat(db, code, seat) {
  const ext = db.FBfor({ log: [], onDrop: [] });
  const cur = db.data.rooms[code].p[seat];
  await ext.set(ext.ref(null, 'rooms/' + code + '/p/' + seat), { s: cur.s, on: false, t: 1 });
}


module.exports = { makeDb, makeClient, SRC };
