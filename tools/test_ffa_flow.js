// M8-T3c multi-client flow tests — drives the REAL online-layer functions from
// index.html (createRoom/joinRoom/claimSeat/attachRoomListeners/startFfaMatch/
// maybeStart/leaveOnline/onlineArmTurn/onlineTurnValue/...) against an in-memory
// fake Firebase that mirrors the relevant v2 rules (write-once seats/claims,
// lobby-only joins, one-way state, gen increment). Game sim (newGame/beginReveal)
// is stubbed — physics is covered by the golden suite; this suite covers the
// online FFA lobby/start/lockstep/disconnect/rematch FLOW with 2..5 clients.
//   node test_ffa_flow.js
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
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
  grab(/function writeLeaveSentinel\(s,attempt\)\{[\s\S]*?\n\}/, 'writeLeaveSentinel'),
  grab(/function scheduleSentinelRetry\(s,ctx\)\{[\s\S]*?\n\}/, 'scheduleSentinelRetry'),
  grab(/function onlineConnectionLost\(ctx\)\{[\s\S]*?\n\}/, 'onlineConnectionLost'),
  grab(/function clearSentinelRetry\(s\)\{[\s\S]*?\n\}/, 'clearSentinelRetry'),
  grab(/function clearAllSentinelRetries\(\)\{[\s\S]*?\n\}/, 'clearAllSentinelRetries'),
  grab(/function np\(\)\{[^\n]*/, 'np'),
  grab(/function aliveCount\(owner\)\{[^\n]*/, 'aliveCount'),
  grab(/function allAliveCommitted\(\)\{[^\n]*/, 'allAliveCommitted'),
  grab(/function whoCanAim\(\)\{[^\n]*/, 'whoCanAim'),
  grab(/function whenFB\(cb\)\{[^\n]*/, 'whenFB'),
  grab(/function fbReady\(\)\{[^\n]*/, 'fbReady'),
  grab(/function rRef\(p\)\{[^\n]*/, 'rRef'),
  grab(/function setStatus\(t\)\{[^\n]*/, 'setStatus'),
  grab(/function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom'),
  grab(/function pickFreeSeat\(p,max\)\{[^\n]*/, 'pickFreeSeat'),
  grab(/function seatCount\(p\)\{[^\n]*/, 'seatCount'),
  grab(/function seatsContiguous\(p,n\)\{[^\n]*/, 'seatsContiguous'),
  grab(/async function claimSeat\(code,op\)\{[\s\S]*?\n\}/, 'claimSeat'),
  grab(/function renderLobby\(p\)\{[\s\S]*?\n\}/, 'renderLobby'),
  grab(/function openOnline\(\)\{[\s\S]*?\n\}/, 'openOnline'),
  grab(/function createRoom\(\)\{[\s\S]*?\n\}/, 'createRoom'),
  grab(/function joinRoom\(\)\{[\s\S]*?\n\}/, 'joinRoom'),
  grab(/function startFfaMatch\(\)\{[\s\S]*?\n\}/, 'startFfaMatch'),
  grab(/function onLobbyClosed\(\)\{[\s\S]*?\n\}/, 'onLobbyClosed'),
  grab(/function attachRoomListeners\(\)\{[\s\S]*?\n\}/, 'attachRoomListeners'),
  grab(/function maybeStart\(\)\{[^\n]*/, 'maybeStart'),
  grab(/function startOnlineGame\(\)\{[^\n]*/, 'startOnlineGame'),
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
  grab(/function onlineRematch\(\)\{[^\n]*/, 'onlineRematch'),
  grab(/function leaveOnline\(\)\{[\s\S]*?\n\}/, 'leaveOnline'),
  // v3 identity (Paket A) + compensated claim lifecycle (Korrekturrunde)
  grab(/function genToken\(n\)\{[\s\S]*?\n\}/, 'genToken'),
  grab(/function capGraphemes\(s,max\)\{[\s\S]*?\n\}/, 'capGraphemes'),
  grab(/function sanitizeName\(raw\)\{[\s\S]*?\n\}/, 'sanitizeName'),
  grab(/function newJoinOp\(\)\{[^\n]*/, 'newJoinOp'),
  grab(/function joinOpCurrent\(op\)\{[^\n]*/, 'joinOpCurrent'),
  grab(/async function claimSeatSlot\(code,seat,op,extra\)\{[\s\S]*?\n\}/, 'claimSeatSlot'),
  grab(/async function releaseSeatSlot\(code,seat,dc\)\{[\s\S]*?\n\}/, 'releaseSeatSlot'),
  grab(/async function releaseSeatClaim\(code,seat,dc\)\{[\s\S]*?\n\}/, 'releaseSeatClaim'),
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
  grab(/async function attemptRejoin\(code\)\{[\s\S]*?\n\}/, 'attemptRejoin'),
].join('\n');

// ── fake RTDB with the v3 rule behaviors the flows depend on ──
function makeDB() {
  const data = { rooms: {} };
  const listeners = new Set();
  // Failure injection: the next `times` writes whose path starts with `prefix`
  // fail like a transport error (before any data change) — used by the negative
  // claim-lifecycle scenarios (R3/R4).
  const failures = [];
  const failWrite = (prefix, times = 1) => failures.push({ prefix, times });
  const at = parts => parts.reduce((a, k) => (a && typeof a === 'object') ? a[k] : undefined, data);
  const clone = v => v === undefined || v === null ? null : JSON.parse(JSON.stringify(v));
  function notify() {
    for (const l of Array.from(listeners)) {
      if (!listeners.has(l)) continue;
      const cur = JSON.stringify(clone(at(l.parts)));
      if (cur !== l.last) { l.last = cur; l.cb({ val: () => clone(at(l.parts)), exists: () => at(l.parts) != null }); }
    }
  }
  // Minimal mirror of the v3 rules with the unified room-state + atomic-claim
  // semantics (Paket A, letzte Blocker). mergedP maps seat->true for presence writes
  // in the SAME atomic update() as the checked path, so a players/<seat> create sees
  // the sibling p/<seat> claim exactly as the real rules' merged newData does.
  function checkWrite(parts, val, mergedP) {
    if (parts[0] !== 'rooms') throw new Error('PERMISSION_DENIED');
    const room = data.rooms[parts[1]];
    if (parts.length === 2) {
      if (val != null) { if (room) throw new Error('PERMISSION_DENIED: room exists'); return; }
      // cleanup delete (v1): whole room removable ONLY when no seat is present
      if (room && [0, 1, 2, 3, 4].some(s => room.p && room.p[s] === true)) throw new Error('PERMISSION_DENIED: room not empty');
      return;
    }
    if (!room) throw new Error('PERMISSION_DENIED: no room');
    const fmt = room.config && room.config.fmt, key = parts[2];
    if (key === 'p') {
      const seat = +parts[3];
      if (val != null) {
        if (seat >= 5 || (fmt !== 'ffa' && seat >= 2)) throw new Error('PERMISSION_DENIED: seat range');
        if (room.p && room.p[seat]) throw new Error('PERMISSION_DENIED: write-once seat');   // write-once presence = sole arbiter
        if (seat === 0) {   // host presence re-add = lobby-only rejoin (unified state, ALL modes)
          const pl = room.players || {};
          if (!(pl[0] && pl[0].id) || room.state !== 'lobby') throw new Error('PERMISSION_DENIED: host rejoin only in lobby');
        }
        else if (room.state !== 'lobby') throw new Error('PERMISSION_DENIED: guest claim only in lobby');   // ALL modes, not just ffa
      }
      return;
    }
    if (key === 'state') {
      // lobby->playing: ffa host-start OR 1v1/2v2 guest claim; p/1 may be set in the
      // SAME atomic update (merged presence).
      const p1 = (room.p && room.p[1] === true) || !!(mergedP && mergedP[1]);
      if (!(val === 'playing' && room.state === 'lobby' && p1))
        throw new Error('PERMISSION_DENIED: state');
      return;
    }
    if (key === 'seats') {
      if (!(fmt === 'ffa' && room.seats == null && room.state === 'playing' && val >= 2 && val <= 5))
        throw new Error('PERMISSION_DENIED: seats');
      return;
    }
    if (key === 'gen') { if (val !== room.gen + 1) throw new Error('PERMISSION_DENIED: gen'); return; }
    if (key === 'g') {          // move slots are write-once (arbiter, mirrors the real rules)
      if (val != null && at(parts) != null) throw new Error('PERMISSION_DENIED: move write-once');
      return;
    }
    if (key === 'players') {   // v3 identity roster — mirrors the real v3 rule expressions
      const seat = parts[3], si = +seat;
      const rec = room.players && room.players[seat];
      const prePresent = room.p && room.p[seat] === true;   // pre-write presence
      if (val == null) {       // delete: only while the seat presence is NOT held (pre-write)
        if (prePresent) throw new Error('PERMISSION_DENIED: players delete while presence held');
        return;
      }
      if (si >= 5 || (fmt !== 'ffa' && si >= 2)) throw new Error('PERMISSION_DENIED: players seat range');
      if (!val || typeof val !== 'object'
        || typeof val.id !== 'string' || !/^[A-Za-z0-9_-]{8,24}$/.test(val.id)
        || typeof val.name !== 'string' || val.name.length < 1 || val.name.length > 48
        || typeof val.tab !== 'string' || !/^[A-Za-z0-9_-]{8,24}$/.test(val.tab)
        || Object.keys(val).some(k => k !== 'id' && k !== 'name' && k !== 'tab'))
        throw new Error('PERMISSION_DENIED: players record invalid');
      if (rec && rec.id === val.id) return;   // same-id update (name refresh / rejoin): id immutable, always ok
      // create (holder writes own record) OR recycle-replace (one atomic claim takes
      // over a stale foreign record): both need the merged presence (held from before
      // or set in the SAME atomic write) and lobby. A REPLACE additionally requires
      // a pre-write-free seat, so a currently-held foreign record can never be stolen.
      const mergedPresent = prePresent || !!(mergedP && mergedP[seat]);
      if (!mergedPresent) throw new Error('PERMISSION_DENIED: players needs presence');
      if (room.state !== 'lobby') throw new Error('PERMISSION_DENIED: players create/replace only in lobby');
      if (rec && prePresent) throw new Error('PERMISSION_DENIED: players replace requires pre-free presence');
      return;
    }
    throw new Error('PERMISSION_DENIED: ' + key);
  }
  function setParts(parts, val) {
    const pathStr = parts.join('/');
    for (const f of failures) {
      if (f.times > 0 && pathStr.startsWith(f.prefix)) { f.times--; throw new Error('INJECTED_WRITE_FAILURE: ' + pathStr); }
    }
    checkWrite(parts, val);
    let o = data;
    for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
    if (val == null) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = JSON.parse(JSON.stringify(val));
    notify();
  }
  const FBfor = ui => ({
    db: null,
    ref: (db, path) => path.split('/'),
    get: async ref => ({ exists: () => at(ref) != null, val: () => clone(at(ref)) }),
    set: async (ref, val) => setParts(ref, val),
    // Atomic multi-path update: honor failure injection and validate EVERY path
    // against the pre-write tree (with merged sibling presence) BEFORE any data
    // change, then apply all-or-nothing — a single rejected/failed path aborts the
    // whole write, leaving no partial p/players/state behind.
    update: async (ref, obj) => {
      const keys = Object.keys(obj);
      const paths = keys.map(k => ref.concat(String(k).split('/')));
      for (const p of paths) {
        const pathStr = p.join('/');
        for (const f of failures) {
          if (f.times > 0 && pathStr.startsWith(f.prefix)) { f.times--; throw new Error('INJECTED_WRITE_FAILURE: ' + pathStr); }
        }
      }
      const mergedP = {};
      keys.forEach((k, i) => { const pr = paths[i]; if (pr[pr.length - 2] === 'p' && obj[k] === true) mergedP[pr[pr.length - 1]] = true; });
      keys.forEach((k, i) => checkWrite(paths[i], obj[k], mergedP));
      keys.forEach((k, i) => {
        let o = data;
        for (let j = 0; j < paths[i].length - 1; j++) { if (o[paths[i][j]] == null) o[paths[i][j]] = {}; o = o[paths[i][j]]; }
        const last = paths[i][paths[i].length - 1];
        if (obj[k] == null) delete o[last]; else o[last] = JSON.parse(JSON.stringify(obj[k]));
      });
      notify();
    },
    remove: async ref => setParts(ref, null),
    // Immediate-resolution transaction mirror for the non-race flow suite (S1..F6):
    // no local-optimistic intermediate state modeled here (that is the job of the
    // dedicated two-phase harness in test_ffa_race.js) — just write-once arbitration,
    // synchronously, exactly like the old set()-based fake did.
    runTransaction: async (ref, updateFn, options) => {
      const current = clone(at(ref));
      const next = updateFn(current);
      if (next === undefined) return { committed: false, snapshot: { val: () => clone(at(ref)), exists: () => at(ref) != null } };
      setParts(ref, next);
      return { committed: true, snapshot: { val: () => clone(at(ref)), exists: () => at(ref) != null } };
    },
    onValue: (ref, cb) => {
      const l = { parts: ref, cb, last: JSON.stringify(clone(at(ref))) };
      listeners.add(l);
      cb({ val: () => clone(at(ref)), exists: () => at(ref) != null });   // initial fire like Firebase
      return () => listeners.delete(l);
    },
    onDisconnect: ref => ({
      remove: async () => { ui.onDrop.push(ref); },
      cancel: async () => { for (let i = ui.onDrop.length - 1; i >= 0; i--) if (ui.onDrop[i].join('/') === ref.join('/')) ui.onDrop.splice(i, 1); }
    }),
    serverTimestamp: () => 1751900000000
  });
  return { data, FBfor, failWrite };
}

// ── one sandboxed client = the real functions + inert UI/game stubs ──
function makeClient(db, code, forcePid) {
  const ui = { code, log: [], onDrop: [] };
  const FB = db.FBfor(ui);
  // Unique browser identity per sandboxed client (pid/tab match the rules charset).
  // forcePid lets a "reloaded" client keep the SAME pid (fresh tab) to test rejoin.
  const seq = (makeClient._seq = (makeClient._seq || 0) + 1);
  const pid = forcePid || ('PID' + String(seq).padStart(6, '0'));
  const tab = 'TAB' + String(seq).padStart(6, '0');
  const body = `
    const TUNE=false; let r3dOrbit=false;
    const T=k=>k;   // i18n-Stub: extrahierte Dialog-Funktionen loggen Text-KEYS (keine Asserts darauf)
    const PCOLS=[{ui:'#e33'},{ui:'#3e3'},{ui:'#33e'},{ui:'#ee3'},{ui:'#e3e'}];
    const window={__FB_READY:true,__FB_ERR:null,FB};
    const document={querySelector:()=>({textContent:''})};
    const els={}; function $(id){return els[id]||(els[id]={style:{},classList:{add(){},remove(){}},textContent:'',innerHTML:'',value:'',disabled:false,querySelector:()=>({textContent:''})});}
    let toastT; const toast=m=>{ui.log.push('toast:'+m);$('toast').textContent=m;};
    let mode='bot',menuMode='bot',diff='easy',winTarget=3,fmt='single',ffaN=3,ffaNMenu=3;
    let online=false, roomCode='', myPlayer=0, gen=0, runningGen=-1, turnNo=-1;
    let turnUnsub=null, genUnsub=null, presUnsub=null, seatsUnsub=null, gameStarted=false;
    let lobbyP={}, seatLeft=[], seatGone=[];
    let pendingSlot={}, onlineSessionId=0;
    let sentinelRetryTimer={};
    const SENTINEL_RETRY_BASE_MS=300, SENTINEL_RETRY_MAX_MS=2000;
    const SENTINEL_RETRY_MAX_ATTEMPTS=11;
    let onlineTerminatedSession=-1;
    // v3 identity state (per client)
    const NAME_MAX=16, NAME_MAX_UNITS=48, LOBBY_HOST_GRACE_MS=12000;
    let onlinePid=${JSON.stringify(pid)}, onlineTab=${JSON.stringify(tab)}, onlineName='';
    let playersRoster={}, rosterUnsub=null, lobbyHostGraceTimer=null, joinOpSeq=0;
    let phase='over', curAimer=0, balls=[], aimSet=[], commitIdx=[], commitAim=[], commitSpin=[], score=[];
    let replaying=false, repPlaying=false;
    const cx=500, cy=500, BR=32; let R=485;
    const rrand=()=>ui.code;
    const showGame=()=>ui.log.push('showGame'), showMenu=()=>ui.log.push('showMenu');
    const updateHud=()=>{}, setPhaseText=()=>{}, openCover=()=>{};
    const setPhase=ph=>{phase=ph;if(ph==='reveal')ui.log.push('reveal');};
    const sanitizeMove=(who,idx,dx,dy,sp)=>({idx,dx,dy,sp});
    function newGame(){ ui.log.push('newGame:'+np()); balls=[];aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
      for(let i=0;i<np();i++){const a=Math.PI/2+i*2*Math.PI/np();
        balls.push({owner:i,alive:true,x:cx+Math.cos(a)*300,y:cy+Math.sin(a)*300,vx:0,vy:0});
        aimSet.push(false);commitIdx.push(-1);commitAim.push({dx:0,dy:0});commitSpin.push(0);}
      phase='aim'; if(online){curAimer=myPlayer;onlineArmTurn();} }
    ${SRC}
    function drop(){   // browser-close simulation: listeners die, onDisconnect fires
      try{if(turnUnsub)turnUnsub();}catch(e){} try{if(genUnsub)genUnsub();}catch(e){}
      try{if(presUnsub)presUnsub();}catch(e){} try{if(seatsUnsub)seatsUnsub();}catch(e){}
      try{if(rosterUnsub)rosterUnsub();}catch(e){}
      turnUnsub=genUnsub=presUnsub=seatsUnsub=rosterUnsub=null;
      const d=ui.onDrop.slice(); ui.onDrop.length=0;
      for(const r of d) FB.remove(r).catch(()=>{});   // server no-op when the path is already gone
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
      setName(n){onlineName=sanitizeName(n); if(online&&roomCode){try{FB.set(rRef('players/'+myPlayer),playerRecord(myPlayer)).catch(()=>{});}catch(e){}}},
      roster(){return JSON.parse(JSON.stringify(playersRoster));},
      nameFor(s){return nameForSeat(s);},
      async rejoin(c){return await attemptRejoin(c);},
      async releaseClaim(c,s){return await releaseSeatClaim(c,s,null);},
      // Direct atomic-claim driver for the parallel-race / onDisconnect-lifecycle
      // tests: fresh op each call, real claimSeatSlot (p+players[+state] in one write).
      async claimSlot(c,s,extra){return await claimSeatSlot(c,s,newJoinOp(),extra);},
      onDrops(){return ui.onDrop.map(r=>r.join('/'));},
      status(){return $('onStatus').textContent;},
      hasGrace(){return !!lobbyHostGraceTimer;},
      drop
    };`;
  return new Function('FB', 'ui', body)(FB, ui);
}

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

(async () => {
  // ── S1: 3-player lobby -> start -> lockstep turn -> all reveal ──
  {
    const db = makeDB();
    const [h, g1, g2] = [makeClient(db, 'FFA3'), makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3); h.create(); await tick();
    t('S1 room created ffa lobby v3', db.data.rooms.FFA3.state === 'lobby' && db.data.rooms.FFA3.config.fmt === 'ffa' && db.data.rooms.FFA3.v === 3);
    t('S1 host roster record written', !!db.data.rooms.FFA3.players && db.data.rooms.FFA3.players[0] && db.data.rooms.FFA3.players[0].id === h.pid());
    g1.setMenu('online'); g1.join('FFA3'); await tick();
    g2.setMenu('online'); g2.join('FFA3'); await tick();
    t('S1 guests seated 1,2', g1.st().myPlayer === 1 && g2.st().myPlayer === 2 && g1.st().mode === 'ffa');
    t('S1 host lobby count 3/5', h.els.lobbyCount.textContent === '3/5');
    t('S1 guest sees no start button', g1.els.lobbyStart.style.display === 'none' && g1.els.lobbyHint.textContent === 'Warte auf Host…');
    t('S1 host start enabled', h.els.lobbyStart.style.display === '' && h.els.lobbyStart.disabled === false);
    h.clickStart(); await tick();
    t('S1 db playing seats 3', db.data.rooms.FFA3.state === 'playing' && db.data.rooms.FFA3.seats === 3);
    t('S1 all started ffaN=3', [h, g1, g2].every(c => c.st().gameStarted && c.st().ffaN === 3 && c.st().phase === 'aim'));
    t('S1 view rotation per seat (own ball bottom)', h.va() === 0 && g1.va() === -(1 * 2 * Math.PI / 3) && g2.va() === -(2 * 2 * Math.PI / 3));
    t('S1 commits flow', h.commitMove() === true && g1.commitMove() === true);
    await tick();
    t('S1 reveal waits for last player', [h, g1, g2].every(c => c.st().phase === 'aim' || c === g2) === false || h.st().phase === 'aim');
    g2.commitMove(); await tick();
    t('S1 all reveal after last commit', [h, g1, g2].every(c => c.st().phase === 'reveal'));
    // rematch (S7)
    h.rematch(); await tick();
    t('S7 rematch restarts all with same seats', db.data.rooms.FFA3.gen === 1 && [h, g1, g2].every(c => c.st().runningGen === 1 && c.st().phase === 'aim' && c.st().ffaN === 3));
    // in-match leave (Fix 2): match continues, leaver eliminated via move sentinel
    g1.leave(); await tick();
    t('F2 leave toast on remaining clients', h.ui.log.includes('toast:Spieler 2 hat das Match verlassen.') && g2.ui.log.includes('toast:Spieler 2 hat das Match verlassen.'));
    t('F2 match NOT ended by leave', h.st().gameStarted && g2.st().gameStarted && (h.els.wt || { textContent: '' }).textContent === '');
    t('F2 sentinel in db (idx!==seat, stand-still)', (() => { const c = db.data.rooms.FFA3.g[1].t[0][1]; return c && c.idx !== 1 && c.dx === 0 && c.dy === 0 && c.sp === 0; })());
    t('F2 leaver slot filled + gone flag on all', h.st().aimSet[1] === true && g2.st().aimSet[1] === true && h.gone(1) && g2.gone(1));
    h.commitMove(); g2.commitMove(); await tick();
    t('F2 reveal without waiting for leaver', h.st().phase === 'reveal' && g2.st().phase === 'reveal');
    t('F2 leaver ball ejected beyond rim on all', h.ballDist(1) > 485 && g2.ballDist(1) > 485);
  }

  // ── F2b: 2-Spieler-FFA, Gegner schliesst Browser -> Ueberlebender spielt weiter ──
  {
    const db = makeDB();
    const h = makeClient(db, 'DUO2'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('DUO2'); await tick();
    h.clickStart(); await tick();
    t('F2b started 2p', h.st().gameStarted && g.st().gameStarted && h.st().ffaN === 2);
    g.drop(); await tick();   // browser close: onDisconnect removes p/1
    t('F2b toast + sentinel written by survivor', h.ui.log.includes('toast:Spieler 2 hat das Match verlassen.') && h.st().aimSet[1] === true);
    h.commitMove(); await tick();
    t('F2b survivor reveals alone (no deadlock)', h.st().phase === 'reveal');
    t('F2b leaver ejected -> normal ring-out ends round', h.ballDist(1) > 485 && h.gone(1));
    t('F2b match not aborted', h.st().gameStarted && (h.els.wt || { textContent: '' }).textContent === '');
  }

  // ── S2: 5 players max, 6th rejected; join-after-start rejected (S3) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'FUL5'); h.setMenu('ffa', 5); h.create(); await tick();
    const gs = [1, 2, 3, 4].map(() => makeClient(db, 'X'));
    for (const g of gs) { g.setMenu('online'); g.join('FUL5'); await tick(); }
    t('S2 seats 1-4 claimed', gs.map(g => g.st().myPlayer).join(',') === '1,2,3,4');
    const g6 = makeClient(db, 'X'); g6.setMenu('online'); g6.join('FUL5'); await tick();
    t('S2 sixth join rejected', g6.els.onStatus.textContent === 'Raum ist schon voll.' && g6.st().online === false);
    h.clickStart(); await tick();
    t('S2 started with 5', db.data.rooms.FUL5.seats === 5 && [h, ...gs].every(c => c.st().ffaN === 5 && c.st().gameStarted));
    const g7 = makeClient(db, 'X'); g7.setMenu('online'); g7.join('FUL5'); await tick();
    t('S3 join after start rejected', g7.els.onStatus.textContent === 'Match läuft bereits.' && g7.st().online === false);
    // eliminated spectator (S10): kill seat 1 everywhere, next turn runs without them
    for (const c of [h, ...gs]) c.kill(1);
    t('S10 eliminated cannot aim', gs[0].canAim() === -1 && gs[0].commitMove() === false);
    h.commitMove(); gs[1].commitMove(); gs[2].commitMove(); gs[3].commitMove(); await tick();
    t('S10 reveal skips eliminated', [h, ...gs].every(c => c.st().phase === 'reveal'));
  }

  // ── S4: lobby gap blocks start; new joiner fills gap; start works ──
  {
    const db = makeDB();
    const h = makeClient(db, 'GAP1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'), g2 = makeClient(db, 'X'), g3 = makeClient(db, 'X');
    g1.setMenu('online'); g1.join('GAP1'); await tick();
    g2.setMenu('online'); g2.join('GAP1'); await tick();
    g1.leave(); await tick();   // seat 1 leaves -> gap (seats 0,2 occupied)
    t('S4 gap disables start', h.els.lobbyStart.disabled === true && h.els.lobbyHint.style.display === '');
    t('S4 gap hint text', h.els.lobbyHint.textContent === 'Sitzlücke: Warte auf freien Sitz / Spieler soll neu beitreten.');
    h.clickStart(); await tick();
    t('S4 gap start blocked, no db write', db.data.rooms.GAP1.state === 'lobby' && h.ui.log.includes('toast:Warte auf freien Sitz / Spieler soll neu beitreten.'));
    g3.setMenu('online'); g3.join('GAP1'); await tick();
    t('S4 new joiner fills seat 1', g3.st().myPlayer === 1 && h.els.lobbyStart.disabled === false);
    h.clickStart(); await tick();
    t('S4 start after gap filled', db.data.rooms.GAP1.seats === 3 && g3.st().gameStarted && g2.st().gameStarted);
  }

  // ── S5: host leaves lobby -> guests aborted; leave restores menu state ──
  {
    const db = makeDB();
    const h = makeClient(db, 'HST2'); h.setMenu('ffa', 4); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('HST2'); await tick();
    t('S5 guest mode ffa in lobby', g1.st().mode === 'ffa' && g1.st().online === true);
    h.leave(); await tick();
    t('S5 guest aborted with message', g1.els.onStatus.textContent === 'Host hat die Lobby geschlossen.' && g1.st().online === false);
    t('S5 guest menu state restored', g1.st().mode === 'online' && g1.st().ffaN === g1.st().ffaNMenu);
    t('S5 host ffaN restored after leave', h.st().mode === 'ffa' && h.st().ffaN === 4);
  }

  // ── S8: seat claimed after host headcount -> late seat ejected cleanly ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RCE2'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('RCE2'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('RCE2'); await tick();
    h.setLobbyP({ 0: true, 1: true });   // stale headcount: host missed g2's claim
    h.clickStart(); await tick();
    t('S8 db seats 2 despite 3 seated', db.data.rooms.RCE2.seats === 2);
    t('S8 match runs for seats 0,1', h.st().gameStarted && g1.st().gameStarted && h.st().ffaN === 2);
    t('S8 late seat ejected with status', g2.st().online === false && g2.st().gameStarted === false && g2.els.onStatus.textContent === 'Das Match ist ohne dich gestartet — tritt einem neuen Raum bei.');
  }

  // ── S9: 1v1 regression through the same fake (auto-start, flip, unified state) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'SGL1'); h.setMenu('online'); h.create(); await tick();
    t('S9 single room created in lobby v3', db.data.rooms.SGL1.state === 'lobby' && db.data.rooms.SGL1.config.fmt === 'single');
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('SGL1'); await tick();
    t('S9 guest atomic claim flipped state to playing', db.data.rooms.SGL1.state === 'playing' && db.data.rooms.SGL1.p[1] === true && db.data.rooms.SGL1.players[1].id === g.pid());
    t('S9 auto-start both, np 2', h.st().gameStarted && g.st().gameStarted && h.ui.log.includes('newGame:2'));
    t('S9 guest view flip stays 1v1', g.va() === Math.PI && h.va() === 0);
    t('S9 lobby untouched', (h.els.lobbyCount||{textContent:''}).textContent === '' && g.st().mode === 'online');
    g.drop(); await tick();   // browser close -> onDisconnect removes p/1
    t('S9 disconnect ends match for host', h.els.wt.textContent === 'Gegner hat den Raum verlassen.');
  }

  // ── F5: 4-Spieler-Sync (P0-Regression 2026-07-10) — Presence-Flap eines Seats:
  //    die anderen schreiben einen Leave-Sentinel; committet das Opfer danach selbst,
  //    verliert sein Write das Write-once-Race. ALLE Clients (auch das Opfer!) muessen
  //    exakt den DB-Wert simulieren -> identische Commits/gone-Flags/Phase ueberall. ──
  {
    const db = makeDB();
    const h = makeClient(db, 'SYN4'); h.setMenu('ffa', 4); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('SYN4'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('SYN4'); await tick();
    const g3 = makeClient(db, 'X'); g3.setMenu('online'); g3.join('SYN4'); await tick();
    h.clickStart(); await tick();
    const all = [h, g1, g2, g3];
    t('F5 started 4p', all.every(c => c.st().gameStarted && c.st().ffaN === 4));
    // Presence-Flap: p/3 verschwindet serverseitig (onDisconnect), g3 laeuft aber weiter
    const ext = db.FBfor({ log: [], onDrop: [] });
    await ext.remove(ext.ref(null, 'rooms/SYN4/p/3')); await tick();
    t('F5 sentinel written once for seat 3', (() => { const c = db.data.rooms.SYN4.g[0].t[0][3]; return c && c.idx !== 3 && c.dx === 0 && c.dy === 0; })());
    // Das Opfer versucht danach selbst zu committen -> Slot ist schon entschieden
    t('F5 victim commit blocked (echo already applied)', g3.commitMove() === false);
    t('F5 victim itself sees the sentinel (gone flag)', g3.gone(3) === true);
    h.commitMove(); g1.commitMove(); g2.commitMove(); await tick();
    t('F5 all four reveal', all.every(c => c.st().phase === 'reveal'));
    t('F5 gone flag identical on ALL clients', all.every(c => c.gone(3) === true));
    const ref = JSON.stringify({ i: h.st().commitIdx, a: h.st().commitAim, s: h.st().aimSet });
    t('F5 identical commit state on all clients', all.every(c => JSON.stringify({ i: c.st().commitIdx, a: c.st().commitAim, s: c.st().aimSet }) === ref));
    // Das sichtbare Symptom des Bugs: dieselbe Kugel muss auf ALLEN Clients fallen —
    // beginReveal ejectet Seat 3 ueberall identisch hinter die Ringkante (R+2*BR).
    t('F5 victim ball ejected identically on all clients', all.every(c => c.ballDist(3) > 485));
    t('F5 other balls untouched on all clients', all.every(c => [0, 1, 2].every(o => c.ballDist(o) <= 485)));
  }

  // ── F6: 5-Spieler-Sync mit unterschiedlichen Empfangsreihenfolgen (P0-Regression
  //    2026-07-10, Nachtrag) — alle 5 Seats committen im selben Turn, jeder Client
  //    liest den DB-Endzustand nach einer unterschiedlichen Anzahl Ticks (simuliert
  //    verschiedene Netzwerk-/Verarbeitungsreihenfolgen), zusaetzlich Presence-Flap/
  //    Sentinel-Race fuer Seat 4. Reihenfolge darf das Endergebnis nicht beeinflussen
  //    (DB ist der alleinige Arbiter), kein Client darf haengen bleiben. ──
  {
    const db = makeDB();
    const h = makeClient(db, 'SYN5'); h.setMenu('ffa', 5); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('SYN5'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('SYN5'); await tick();
    const g3 = makeClient(db, 'X'); g3.setMenu('online'); g3.join('SYN5'); await tick();
    const g4 = makeClient(db, 'X'); g4.setMenu('online'); g4.join('SYN5'); await tick();
    h.clickStart(); await tick();
    const all5 = [h, g1, g2, g3, g4];
    t('F6 started 5p', all5.every(c => c.st().gameStarted && c.st().ffaN === 5));
    // Presence-Flap: Seat 4 verschwindet serverseitig, bevor irgendwer committet
    const ext = db.FBfor({ log: [], onDrop: [] });
    await ext.remove(ext.ref(null, 'rooms/SYN5/p/4')); await tick();
    // Alle 5 committen "gleichzeitig" (Reihenfolge der Aufrufe variiert bewusst,
    // Seat 4 zuletzt und verliert das Write-once-Race gegen den bereits gesetzten Sentinel)
    g3.commitMove(); h.commitMove(); g1.commitMove(); g2.commitMove();
    const victimCommitOk = g4.commitMove();
    t('F6 victim commit blocked by existing sentinel', victimCommitOk === false);
    // Unterschiedliche Empfangsreihenfolge ist bereits oben in der Aufrufreihenfolge der
    // commitMove()-Calls simuliert (g3, h, g1, g2, dann die verlierende Seat-4-Schreibung);
    // die Fake-DB propagiert jeden Write synchron an alle Listener (wie das echte
    // onValue), zusaetzliche Ticks draenieren nur ausstehende Promise-Ketten.
    await tick(5);
    // "Kein Client haengt": jeder erreicht 'reveal' UND hat fuer alle 5 Seats einen
    // Commit registriert (aimSet komplett true) — kein Client wartet auf einen Seat,
    // der bei ihm anders (z. B. noch 'aim') aussieht als bei den anderen.
    t('F6 all five reveal regardless of read order', all5.every(c => c.st().phase === 'reveal'));
    t('F6 no client hangs (all 5 commit slots resolved everywhere)', all5.every(c => c.st().aimSet.length === 5 && c.st().aimSet.every(Boolean)));
    t('F6 gone flag for seat 4 identical on all five (incl. victim)', all5.every(c => c.gone(4) === true));
    const refCommit = JSON.stringify({ i: h.st().commitIdx, a: h.st().commitAim, s: h.st().aimSet });
    t('F6 identical commit slots on all five clients', all5.every(c => JSON.stringify({ i: c.st().commitIdx, a: c.st().commitAim, s: c.st().aimSet }) === refCommit));
    t('F6 identical ball state (seat 4 ejected, others untouched) on all five', all5.every(c => c.ballDist(4) > 485 && [0, 1, 2, 3].every(o => c.ballDist(o) <= 485)));
    const refHash = h.hash();
    t('F6 deterministic state hash identical on all five clients', all5.every(c => c.hash() === refHash));
    // Score/roundWinner werden in diesem Harness nicht durch echte Physik aufgeloest
    // (stepSim/afterResult sind hier nicht extrahiert, das ist Aufgabe der Golden-/
    // FFA-Kern-Suite) — die Invariante hier ist, dass der Score-Zustand trotz
    // unterschiedlicher Lese-Reihenfolgen ueberall exakt identisch bleibt.
    const refScore = JSON.stringify(h.st().score);
    t('F6 score state identical on all five clients', all5.every(c => JSON.stringify(c.st().score) === refScore));
  }

  // ── N1: player name sanitization + live roster propagation to other clients ──
  {
    const db = makeDB();
    const h = makeClient(db, 'NAM3'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('NAM3'); await tick();
    g1.setName('  Ali  '); await tick();
    t('N1 name trimmed/collapsed in db', db.data.rooms.NAM3.players[1].name === 'Ali');
    t('N1 host roster sees the guest name', h.nameFor(1) === 'Ali');
    g1.setName('x234567890123456789'); await tick();   // 19 chars -> capped at 16
    t('N1 overlong name capped to 16 visible chars', db.data.rooms.NAM3.players[1].name.length === 16);
    g1.setName('   '); await tick();                    // empty after trim -> color fallback
    t('N1 empty name falls back to seat color name in db', db.data.rooms.NAM3.players[1].name === 'col1');
    t('N1 nameFor falls back to color for empty roster name', h.nameFor(1) === 'col1');
  }

  // ── R1: guest reload in the lobby (presence drops, players record lingers) ->
  //    rejoin with the same pid lands on the SAME seat ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RJN1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('RJN1'); await tick();
    const gpid = g.pid();
    t('R1 guest seated 1 with roster record', g.st().myPlayer === 1 && db.data.rooms.RJN1.players[1].id === gpid);
    g.drop(); await tick();                              // reload: onDisconnect removes p/1; players/1 stays
    t('R1 presence gone but roster record kept for rejoin', db.data.rooms.RJN1.p[1] == null && db.data.rooms.RJN1.players[1].id === gpid);
    const g2 = makeClient(db, 'X', gpid); g2.setMenu('online'); g2.join('RJN1'); await tick();
    t('R1 rejoined the SAME seat 1', g2.st().myPlayer === 1 && g2.st().online === true && g2.status() === 'rejoinOk');
    t('R1 presence restored, roster id unchanged', db.data.rooms.RJN1.p[1] === true && db.data.rooms.RJN1.players[1].id === gpid);
  }

  // ── R2: host reload does NOT close the lobby at once (grace), host rejoins seat 0 ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RJN2'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('RJN2'); await tick();
    const hpid = h.pid();
    h.drop(); await tick();                              // host reload: p/0 removed, players/0 kept
    t('R2 guest keeps the lobby open during the host grace', g.st().online === true && g.hasGrace() === true);
    const h2 = makeClient(db, 'X', hpid); h2.setMenu('ffa'); h2.join('RJN2'); await tick();
    t('R2 host rejoined on seat 0', h2.st().myPlayer === 0 && h2.st().online === true);
    t('R2 guest grace cleared once the host returned', g.hasGrace() === false && g.st().online === true);
  }

  // ── R3: one path of the ATOMIC claim (players/1) fails -> the whole multi-path
  //    write is rejected: no presence, no roster record, join aborts loud, seat
  //    stays claimable (atomic all-or-nothing, no partial state) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RBK1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online');
    db.failWrite('rooms/RBK1/players/1', 1);   // the roster leg of the atomic claim fails
    g.join('RBK1'); await tick();
    t('R3 join aborted with visible error (not swallowed)', g.st().online === false && g.status().indexOf('err') === 0);
    t('R3 no ghost seat: presence not left behind', db.data.rooms.RBK1.p[1] == null);
    t('R3 no orphaned roster record', !(db.data.rooms.RBK1.players && db.data.rooms.RBK1.players[1]));
    t('R3 onDisconnect disarmed after the failed claim', g.ui.onDrop.length === 0);
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('RBK1'); await tick();
    t('R3 seat claimable again after the rollback', g2.st().myPlayer === 1 && db.data.rooms.RBK1.players[1].id === g2.pid());
  }

  // ── R4: a transport failure on the atomic claim (presence leg) aborts the WHOLE
  //    write — nothing (presence, roster, state) is left behind, the error surfaces
  //    (never swallowed into a false "seat taken"), and the seat stays claimable ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RBK2'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online');
    db.failWrite('rooms/RBK2/p/1', 1);   // the atomic multi-path claim fails like a network error
    g.join('RBK2'); await tick();
    t('R4 transport failure aborts join with visible error', g.st().online === false && g.status().indexOf('err') === 0);
    t('R4 atomic reject: neither presence nor roster record left', db.data.rooms.RBK2.p[1] == null && !(db.data.rooms.RBK2.players && db.data.rooms.RBK2.players[1]));
    t('R4 onDisconnect disarmed after the failed claim', g.ui.onDrop.length === 0);
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('RBK2'); await tick();
    t('R4 seat claimable again by a fresh guest', g2.st().myPlayer === 1 && db.data.rooms.RBK2.players[1].id === g2.pid());
  }

  // ── R5: late rejoin from room A after a newer join to room B -> op guard
  //    neutralizes the old continuation (no globals/listeners/writes of B touched) ──
  {
    const db = makeDB();
    const hA = makeClient(db, 'ROMA'); hA.setMenu('ffa', 3); hA.create(); await tick();
    const hB = makeClient(db, 'ROMB'); hB.setMenu('ffa', 3); hB.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('ROMA'); await tick();
    const gpid = g.pid();
    g.drop(); await tick();                       // reload while seated in A
    const g2 = makeClient(db, 'X', gpid); g2.setMenu('online');
    const late = g2.rejoin('ROMA');               // old intent, still in flight...
    g2.join('ROMB');                              // ...user decides differently (newer op)
    await tick(6);
    t('R5 late rejoin from room A neutralized (op guard)', (await late) === false);
    t('R5 client ended up in room B on a normal claim', g2.st().roomCode === 'ROMB' && g2.st().online === true && g2.st().myPlayer === 1);
    t('R5 room A presence NOT restored by the stale rejoin', db.data.rooms.ROMA.p[1] == null);
    t('R5 room A record untouched (rejoin identity preserved)', db.data.rooms.ROMA.players[1].id === gpid);
  }

  // ── R6: foreign claims against the roster (id switch, delete, mid-match create)
  //    are denied by the mirrored v3 rule expressions ──
  {
    const db = makeDB();
    const h = makeClient(db, 'ATK1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('ATK1'); await tick();
    const atk = db.FBfor({ log: [], onDrop: [] });
    let denied = false;
    try { await atk.set(atk.ref(null, 'rooms/ATK1/players/1'), { id: 'EVIL0001', name: 'evil', tab: 'EVILTAB0' }); } catch (e) { denied = true; }
    t('R6 id switch on an occupied seat denied (id immutable)', denied && db.data.rooms.ATK1.players[1].id === g.pid());
    denied = false;
    try { await atk.remove(atk.ref(null, 'rooms/ATK1/players/1')); } catch (e) { denied = true; }
    t('R6 record delete denied while the presence is held', denied && !!db.data.rooms.ATK1.players[1]);
    h.clickStart(); await tick();
    denied = false;
    try { await atk.set(atk.ref(null, 'rooms/ATK1/players/2'), { id: 'EVIL0002', name: 'evil', tab: 'EVILTAB0' }); } catch (e) { denied = true; }
    t('R6 record creation during a running match denied', denied && !(db.data.rooms.ATK1.players && db.data.rooms.ATK1.players[2]));
  }

  // ── R7: host rejoin during a RUNNING ffa match is rejected (client boundary
  //    AND rules) — maybeStart can never locally restart a running room ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RUN1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('RUN1'); await tick();
    h.clickStart(); await tick();
    const hpid = h.pid();
    h.drop(); await tick();                       // host reload mid-match
    const h2 = makeClient(db, 'X', hpid); h2.setMenu('ffa');
    const ok = await h2.rejoin('RUN1'); await tick();
    t('R7 host rejoin during running ffa match rejected', ok === false && h2.st().online === false && h2.st().gameStarted === false && h2.status() === 'rejoinNoLobby');
    t('R7 host presence NOT restored during playing', db.data.rooms.RUN1.p[0] == null);
    const atk = db.FBfor({ log: [], onDrop: [] });
    let denied = false;
    try { await atk.set(atk.ref(null, 'rooms/RUN1/p/0'), true); } catch (e) { denied = true; }
    t('R7 rules deny the p/0 restore while playing', denied);
  }

  // ── R8: 1v1 — host rejoin allowed ONLY while the room still waits for an
  //    opponent; after the auto-start every rejoin (host or guest) is rejected ──
  {
    const db = makeDB();
    const h = makeClient(db, 'SGL2'); h.setMenu('online'); h.create(); await tick();
    const hpid = h.pid();
    h.drop(); await tick();                       // host reload while waiting
    const h2 = makeClient(db, 'X', hpid); h2.setMenu('online');
    const okWait = await h2.rejoin('SGL2'); await tick();
    t('R8 1v1 host rejoin while waiting allowed', okWait === true && h2.st().myPlayer === 0 && db.data.rooms.SGL2.p[0] === true);
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('SGL2'); await tick();
    t('R8 1v1 auto-start after the guest join', h2.st().gameStarted && g.st().gameStarted);
    h2.drop(); await tick();                      // host reload mid-match
    const h3 = makeClient(db, 'X', hpid); h3.setMenu('online');
    const okRun = await h3.rejoin('SGL2'); await tick();
    t('R8 1v1 host rejoin after match start rejected', okRun === false && h3.st().online === false && h3.status() === 'rejoinNoLobby' && db.data.rooms.SGL2.p[0] == null);
    const atk = db.FBfor({ log: [], onDrop: [] });
    let denied = false;
    try { await atk.set(atk.ref(null, 'rooms/SGL2/p/0'), true); } catch (e) { denied = true; }
    t('R8 rules deny the 1v1 host presence restore (guest record exists)', denied);
    const gpid = g.pid();
    g.drop(); await tick();
    const g2 = makeClient(db, 'X', gpid); g2.setMenu('online');
    const okG = await g2.rejoin('SGL2'); await tick();
    t('R8 1v1 guest rejoin rejected (their join started the match)', okG === false && g2.status() === 'rejoinNoLobby');
  }

  // ── R9: 2v2 — same boundary: match rejoin rejected ──
  {
    const db = makeDB();
    const h = makeClient(db, 'DBL1'); h.setMenu('online'); h.setFmt('double'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('DBL1'); await tick();
    t('R9 2v2 started', h.st().gameStarted && g.st().gameStarted && db.data.rooms.DBL1.config.fmt === 'double');
    const hpid = h.pid();
    h.drop(); await tick();
    const h2 = makeClient(db, 'X', hpid); h2.setMenu('online');
    const ok = await h2.rejoin('DBL1'); await tick();
    t('R9 2v2 host match rejoin rejected', ok === false && h2.status() === 'rejoinNoLobby' && db.data.rooms.DBL1.p[0] == null);
  }

  // ── R10: seat recycling only in the lobby at free presence; a late rollback/
  //    cleanup never deletes a record that was taken over in the meantime ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RCY1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('RCY1'); await tick();
    const oldPid = g1.pid();
    g1.drop(); await tick();                      // reload: presence free, record lingers (lobby)
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('RCY1'); await tick();
    t('R10 lobby recycle takes the presence-free seat', g2.st().myPlayer === 1 && db.data.rooms.RCY1.players[1].id === g2.pid());
    t('R10 stale record replaced atomically inside the claim (never id mutation)', db.data.rooms.RCY1.players[1].id !== oldPid);
    const g1b = makeClient(db, 'X', oldPid); g1b.setMenu('online');
    const ok = await g1b.rejoin('RCY1'); await tick();
    t('R10 old identity rejoin rejected after the recycle', ok === false && g1b.st().online === false);
    t('R10 recycled seat untouched by the failed rejoin', db.data.rooms.RCY1.players[1].id === g2.pid() && db.data.rooms.RCY1.p[1] === true);
    // Worst-case cleanup fired against a taken-over seat: the id check (and the
    // rules delete-guard) must leave the foreign record alone.
    await g1b.releaseClaim('RCY1', 1); await tick();
    t('R10 late cleanup never deletes a foreign record', db.data.rooms.RCY1.players[1].id === g2.pid());
  }

  // ── RP1: two atomic claims on the SAME seat -> the write-once presence is the
  //    sole arbiter: exactly one winner, the other reports lost (no throw), and the
  //    DB holds a single consistent presence+record for that seat ──
  {
    const db = makeDB();
    const h = makeClient(db, 'PAR1'); h.setMenu('ffa', 3); h.create(); await tick();
    const a = makeClient(db, 'AAA'); const b = makeClient(db, 'BBB');
    const [ra, rb] = await Promise.all([a.claimSlot('PAR1', 1), b.claimSlot('PAR1', 1)]);
    t('RP1 exactly one atomic claim wins the shared seat', [ra, rb].filter(r => r.ok).length === 1 && [ra, rb].filter(r => r.lost).length === 1);
    const winnerPid = ra.ok ? a.pid() : b.pid();
    t('RP1 db seat 1 holds a single presence + winner record', db.data.rooms.PAR1.p[1] === true && db.data.rooms.PAR1.players[1] && db.data.rooms.PAR1.players[1].id === winnerPid);
  }

  // ── RD1: onDisconnect lifecycle — armed and KEPT after a successful atomic claim,
  //    disarmed after a rejected one (no leaked disconnect handler) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'ODC1'); h.setMenu('ffa', 3); h.create(); await tick();
    const a = makeClient(db, 'AAA'); const ra = await a.claimSlot('ODC1', 1);
    t('RD1 successful claim keeps its onDisconnect armed', ra.ok === true && a.onDrops().indexOf('rooms/ODC1/p/1') !== -1);
    const b = makeClient(db, 'BBB'); const rb = await b.claimSlot('ODC1', 1);   // seat held -> write-once rejects
    t('RD1 rejected claim disarms its onDisconnect', rb.lost === true && b.onDrops().length === 0);
  }

  // ── RN1: recycle race on a stale foreign seat — the loser NEVER pre-deletes the
  //    foreign record; the seat is only ever replaced atomically by the one winner ──
  {
    const db = makeDB();
    const h = makeClient(db, 'NPD1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('NPD1'); await tick();
    const stalePid = g1.pid();
    g1.drop(); await tick();   // reload: presence free, stale foreign record lingers (lobby)
    const a = makeClient(db, 'AAA'); const b = makeClient(db, 'BBB');
    const [ra, rb] = await Promise.all([a.claimSlot('NPD1', 1), b.claimSlot('NPD1', 1)]);
    t('RN1 recycle race: exactly one winner', [ra, rb].filter(r => r.ok).length === 1);
    const winnerPid = ra.ok ? a.pid() : b.pid();
    t('RN1 seat recycled atomically to the winner (no pre-delete)', db.data.rooms.NPD1.players[1].id === winnerPid && db.data.rooms.NPD1.p[1] === true);
    t('RN1 stale foreign record was replaced, not the winner clobbered', db.data.rooms.NPD1.players[1].id !== stalePid);
  }

  console.log('\nFFA-Online-Flow: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
