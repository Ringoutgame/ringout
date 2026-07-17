// B2 Reconnect/Presence suite — drives the REAL online layer (attemptRejoin/
// reclaimSeatSlot/fastForwardMatch/attachRoomListeners/...) AND the REAL physics
// (placeBalls/stepSim/applyLaunch/afterResult) from index.html against an
// in-memory fake RTDB that mirrors the v3 rules including the B2 reclaim
// clauses (identity-bound mid-match re-take; lobby re-take only after the 15s
// stale window). Unlike test_ffa_flow (stubbed sim), this suite proves the
// CANONICAL REHYDRATION bit-identically: a client that reloads mid-match and
// replays the DB turn history must land on exactly the same simHash (balls,
// alive, R, score, seatGone) as a client that played through continuously.
//   node test_reconnect.js
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
  grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants'),
  grab(/const SPIN_K=[^\n]*/, 'spin constants'),
  grab(/const PCOLS=[^\n]*/, 'PCOLS'),
  // ── real sim ──
  grab(/function mkBall\(x,y,owner\)\{[^\n]*/, 'mkBall'),
  grab(/function aliveBalls\(owner\)\{[^\n]*/, 'aliveBalls'),
  grab(/function aliveCount\(owner\)\{[^\n]*/, 'aliveCount'),
  grab(/function np\(\)\{[^\n]*/, 'np'),
  grab(/function teamCap\(\)\{[^\n]*/, 'teamCap'),
  grab(/function ffaRoom\(\)\{[^\n]*/, 'ffaRoom'),
  grab(/function ffaSeatCap\(\)\{[^\n]*/, 'ffaSeatCap'),
  grab(/function teamOf\(s\)\{[^\n]*/, 'teamOf'),
  grab(/function colorSlot\(owner\)\{[^\n]*/, 'colorSlot'),
  grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls'),
  grab(/function newGame\(\)\{[\s\S]*?\n  startRound\(\);\}/, 'newGame'),
  grab(/function resetCommits\(\)\{[\s\S]*?\n\}/, 'resetCommits'),
  grab(/function startRound\(\)\{[\s\S]*?\n  setPhaseText\(\);\}/, 'startRound'),
  grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove'),
  grab(/function allAliveCommitted\(\)\{[^\n]*/, 'allAliveCommitted'),
  grab(/function beginReveal\(\)\{[^\n]*/, 'beginReveal'),
  grab(/function ejectGoneSeats\(\)\{[\s\S]*?\n\}/, 'ejectGoneSeats'),
  grab(/function simHash\(\)\{[\s\S]*?\n\}/, 'simHash'),
  grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch'),
  grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim'),
  grab(/function afterResult\(\)\{[\s\S]*?\n\}/, 'afterResult'),
  // ── real online layer ──
  grab(/function whenFB\(cb\)\{[^\n]*/, 'whenFB'),
  grab(/function fbReady\(\)\{[^\n]*/, 'fbReady'),
  grab(/function rRef\(p\)\{[^\n]*/, 'rRef'),
  grab(/function setStatus\(t\)\{[^\n]*/, 'setStatus'),
  grab(/function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom'),
  grab(/function pickFreeSeat\(p,max\)\{[^\n]*/, 'pickFreeSeat'),
  grab(/function validateRejoinRoom\(d\)\{[\s\S]*?\n\}/, 'validateRejoinRoom'),
  grab(/function seatCount\(p\)\{[^\n]*/, 'seatCount'),
  grab(/function seatsContiguous\(p,n\)\{[^\n]*/, 'seatsContiguous'),
  grab(/async function claimSeat\(code,op,maxSeats\)\{[\s\S]*?\n\}/, 'claimSeat'),
  grab(/function renderLobby\(p\)\{[\s\S]*?\n\}/, 'renderLobby'),
  grab(/function setOnTitle\(ffa\)\{[\s\S]*?\n\}/, 'setOnTitle'),
  grab(/function createRoom\(\)\{[\s\S]*?\n\}/, 'createRoom'),
  grab(/function joinRoom\(\)\{[\s\S]*?\n\}/, 'joinRoom'),
  grab(/function startFfaMatch\(\)\{[\s\S]*?\n\}/, 'startFfaMatch'),
  grab(/function onLobbyClosed\(\)\{[\s\S]*?\n\}/, 'onLobbyClosed'),
  grab(/function attachRoomListeners\(\)\{[\s\S]*?\n\}/, 'attachRoomListeners'),
  grab(/function maybeStart\(\)\{[^\n]*/, 'maybeStart'),
  grab(/function startOnlineGame\(\)\{[^\n]*/, 'startOnlineGame'),
  grab(/function fastForwardMatch\(turns\)\{[\s\S]*?\n\}/, 'fastForwardMatch'),
  grab(/function onOppLeft\(\)\{[\s\S]*?\n\}/, 'onOppLeft'),
  grab(/function onlineArmTurn\(\)\{[\s\S]*?\n\}/, 'onlineArmTurn'),
  grab(/function isCurrentCtx\(ctx\)\{[^\n]*/, 'isCurrentCtx'),
  grab(/function isOnlineTerminated\(\)\{[^\n]*/, 'isOnlineTerminated'),
  grab(/function writeTurnSlot\(s,payload,opts\)\{[\s\S]*?\n\}/, 'writeTurnSlot'),
  grab(/function writeLeaveSentinel\(s,attempt\)\{[\s\S]*?\n\}/, 'writeLeaveSentinel'),
  grab(/function scheduleSentinelRetry\(s,ctx\)\{[\s\S]*?\n\}/, 'scheduleSentinelRetry'),
  grab(/function onlineConnectionLost\(ctx\)\{[\s\S]*?\n\}/, 'onlineConnectionLost'),
  grab(/function clearSentinelRetry\(s\)\{[\s\S]*?\n\}/, 'clearSentinelRetry'),
  grab(/function clearAllSentinelRetries\(\)\{[\s\S]*?\n\}/, 'clearAllSentinelRetries'),
  grab(/function processSlot\(s,c\)\{[\s\S]*?\n\}/, 'processSlot'),
  grab(/function settleSlot\(s,ctx,result,err\)\{[\s\S]*?\n\}/, 'settleSlot'),
  grab(/function maybeReveal\(\)\{[\s\S]*?\n\}/, 'maybeReveal'),
  grab(/function onlineTurnValue\(val\)\{[\s\S]*?\n\}/, 'onlineTurnValue'),
  grab(/function onlineSendCommit\(idx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'onlineSendCommit'),
  grab(/function onlineRematch\(\)\{[^\n]*/, 'onlineRematch'),
  grab(/function leaveOnline\(\)\{[\s\S]*?\n\}/, 'leaveOnline'),
  // ── v3 identity + B2 reclaim ──
  grab(/function genToken\(n\)\{[\s\S]*?\n\}/, 'genToken'),
  grab(/function capGraphemes\(s,max\)\{[\s\S]*?\n\}/, 'capGraphemes'),
  grab(/function sanitizeName\(raw\)\{[\s\S]*?\n\}/, 'sanitizeName'),
  grab(/function newJoinOp\(\)\{[^\n]*/, 'newJoinOp'),
  grab(/function joinOpCurrent\(op\)\{[^\n]*/, 'joinOpCurrent'),
  grab(/function seatActive\(p,s\)\{[^\n]*/, 'seatActive'),
  grab(/async function reserveSeat\(code,seat\)\{[\s\S]*?\n\}/, 'reserveSeat'),
  grab(/async function armPresence\(code,seat\)\{[\s\S]*?\n\}/, 'armPresence'),
  grab(/async function activateSeat\(code,seat,extra\)\{[\s\S]*?\n\}/, 'activateSeat'),
  grab(/async function releaseReservation\(code,seat,dc\)\{[\s\S]*?\n\}/, 'releaseReservation'),
  grab(/async function claimSeatSlot\(code,seat,op,extra\)\{[\s\S]*?\n\}/, 'claimSeatSlot'),
  grab(/async function reclaimSeat\(code,seat,keepName\)\{[\s\S]*?\n\}/, 'reclaimSeat'),
  grab(/async function releaseReclaim\(code,seat,dc\)\{[\s\S]*?\n\}/, 'releaseReclaim'),
  grab(/async function reclaimSeatSlot\(code,seat,op,keepName\)\{[\s\S]*?\n\}/, 'reclaimSeatSlot'),
  grab(/function playerRecord\(seat\)\{[^\n]*/, 'playerRecord'),
  grab(/function nameForSeat\(s\)\{[\s\S]*?\n\}/, 'nameForSeat'),
  grab(/function findOwnSeat\(players,pid\)\{[\s\S]*?\n\}/, 'findOwnSeat'),
  grab(/function rememberRoom\(code,seat\)\{[^\n]*/, 'rememberRoom'),
  grab(/function forgetRoom\(\)\{[^\n]*/, 'forgetRoom'),
  grab(/function savedRoom\(\)\{[\s\S]*?\n\}/, 'savedRoom'),
  grab(/function clearLobbyHostGrace\(\)\{[^\n]*/, 'clearLobbyHostGrace'),
  grab(/function startLobbyHostGrace\(\)\{[\s\S]*?\n\}/, 'startLobbyHostGrace'),
  grab(/function evalLobbyHostPresence\(\)\{[\s\S]*?\n\}/, 'evalLobbyHostPresence'),
  grab(/function clearMatchGrace\(s\)\{[^\n]*/, 'clearMatchGrace'),
  grab(/function clearAllMatchGrace\(\)\{[^\n]*/, 'clearAllMatchGrace'),
  grab(/function startMatchGrace\(s\)\{[\s\S]*?\n\}/, 'startMatchGrace'),
  grab(/function seatFinallyGone\(s\)\{[\s\S]*?\n\}/, 'seatFinallyGone'),
  grab(/async function attemptRejoin\(code\)\{[\s\S]*?\n\}/, 'attemptRejoin'),
].join('\n');

// ── fake RTDB mirroring the v3 rules INCLUDING the B2 reclaim clauses ──
function makeDB() {
  const data = { rooms: {} };
  const listeners = new Set();
  let nowMs = 1751900000000;   // advanceable fake server time (the 15s stale window)
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
  const seatCap = fmt => fmt === 'ffa' ? 5 : fmt === 'triple_ffa' ? 3 : fmt === 'team_duel' ? 4 : 2;
  function buildMerged(room, writes) {
    const wp = {}, wpl = {}; let wstate;
    for (const w of writes) {
      if (w.parts[2] === 'p' && w.parts.length === 4) wp[w.parts[3]] = w.val;
      else if (w.parts[2] === 'players' && w.parts.length === 4) wpl[w.parts[3]] = w.val;
      else if (w.parts[2] === 'state' && w.parts.length === 3) wstate = w.val;
    }
    return {
      p: seat => (String(seat) in wp) ? wp[String(seat)] : (room && room.p && room.p[seat]),
      players: seat => (String(seat) in wpl) ? wpl[String(seat)] : (room && room.players && room.players[seat]),
      state: () => wstate !== undefined ? wstate : (room && room.state)
    };
  }
  function checkWrite(parts, val, merged) {
    if (parts[0] !== 'rooms') throw new Error('PERMISSION_DENIED');
    const room = data.rooms[parts[1]];
    if (parts.length === 2) {
      if (val != null) { if (room) throw new Error('PERMISSION_DENIED: room exists'); return; }
      if (room && ((room.p && Object.keys(room.p).length) || (room.players && Object.keys(room.players).length)))
        throw new Error('PERMISSION_DENIED: room not empty');
      return;
    }
    if (!room) throw new Error('PERMISSION_DENIED: no room');
    if (!merged) merged = buildMerged(room, [{ parts, val }]);
    const fmt = room.config && room.config.fmt, key = parts[2];
    if (key === 'p') {
      const seat = +parts[3];
      if (seat >= seatCap(fmt)) throw new Error('PERMISSION_DENIED: seat range');
      const cur = room.p && room.p[seat];
      if (val == null) {
        if (merged.players(seat) != null) throw new Error('PERMISSION_DENIED: p delete requires players delete in same write');
        return;
      }
      if (!val || typeof val !== 'object' || typeof val.s !== 'string' || typeof val.on !== 'boolean' || typeof val.t !== 'number'
        || Object.keys(val).some(k => k !== 's' && k !== 'on' && k !== 't'))
        throw new Error('PERMISSION_DENIED: p shape');
      if (!cur) {   // fresh RESERVE: on:false, lobby, matching players.tab in the SAME write
        if (val.on !== false) throw new Error('PERMISSION_DENIED: fresh reserve must be on:false');
        if (room.state !== 'lobby') throw new Error('PERMISSION_DENIED: reserve only in lobby');
        const pl = merged.players(seat);
        if (!pl || pl.tab !== val.s) throw new Error('PERMISSION_DENIED: reserve needs matching players.tab in same write');
        return;
      }
      if (val.s === cur.s) {
        if (cur.on === false && val.on === true) {   // ACTIVATE
          const ge = room.g && room.g[room.gen];
          if (ge && ge.e && ge.e[seat] === true) throw new Error('PERMISSION_DENIED: activate eliminated seat');
          const okState = seat === 0 || fmt === 'ffa' || fmt === 'triple_ffa' || fmt === 'team_duel' || room.state === 'playing' ||
            (seat === 1 && room.state === 'lobby' && merged.state() === 'playing');
          if (!okState) throw new Error('PERMISSION_DENIED: activate state gate');
          return;
        }
        if (cur.on === true && val.on === false) return;    // onDisconnect / deliberate offline-write
        if (cur.on === false && val.on === false) return;   // same-token refresh
        throw new Error('PERMISSION_DENIED: p on transition');
      }
      // Different token — B2 reclaim: identity-bound re-take of an OFFLINE seat.
      // playing: immediately (unless rules-eliminated via g/<gen>/e); lobby: only
      // after the 15s stale window. players/<seat> must ride in the SAME update.
      if (cur.on === false && val.on === false) {
        const pl = merged.players(seat);
        if (pl && pl.tab === val.s) {
          const ge = room.g && room.g[room.gen];
          if (room.state === 'playing' && !(ge && ge.e && ge.e[seat] === true)) return;
          if (room.state === 'lobby' && (nowMs - cur.t) >= 15000) return;
        }
      }
      throw new Error('PERMISSION_DENIED: p token mismatch (reclaim gate)');
    }
    if (key === 'state') {
      const p0 = room.p && room.p[0], p1 = merged.p(1);
      if (!(val === 'playing' && room.state === 'lobby' && p0 && p0.on === true && p1 && p1.on === true))
        throw new Error('PERMISSION_DENIED: state');
      return;
    }
    if (key === 'seats') {
      const ok = room.seats == null && room.state === 'playing' &&
        ((fmt === 'ffa' && val >= 2 && val <= 5) || (fmt === 'triple_ffa' && val === 3) || (fmt === 'team_duel' && val === 4));
      if (!ok) throw new Error('PERMISSION_DENIED: seats');
      return;
    }
    if (key === 'gen') { if (val !== room.gen + 1) throw new Error('PERMISSION_DENIED: gen'); return; }
    if (key === 'g') {
      if (val != null && at(parts) != null) throw new Error('PERMISSION_DENIED: move write-once');
      return;
    }
    if (key === 'players') {
      const seat = parts[3], si = +seat;
      const rec = room.players && room.players[seat];
      if (val == null) {
        if (merged.p(seat) != null) throw new Error('PERMISSION_DENIED: players delete requires p delete in same write');
        return;
      }
      if (si >= seatCap(fmt)) throw new Error('PERMISSION_DENIED: players seat range');
      if (!val || typeof val !== 'object'
        || typeof val.id !== 'string' || !/^[A-Za-z0-9_-]{8,24}$/.test(val.id)
        || typeof val.name !== 'string' || val.name.length < 1 || val.name.length > 48
        || typeof val.tab !== 'string' || !/^[A-Za-z0-9_-]{8,24}$/.test(val.tab)
        || Object.keys(val).some(k => k !== 'id' && k !== 'name' && k !== 'tab'))
        throw new Error('PERMISSION_DENIED: players record invalid');
      const pVal = merged.p(seat);
      if (!pVal || pVal.s !== val.tab) throw new Error('PERMISSION_DENIED: players needs matching p.s in same write');
      if (rec && rec.id === val.id) return;   // same-id update: id immutable, always ok
      if (rec) throw new Error('PERMISSION_DENIED: players replace denied (foreign id)');
      if (room.state !== 'lobby') throw new Error('PERMISSION_DENIED: players create only in lobby');
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
    update: async (ref, obj) => {
      const keys = Object.keys(obj);
      const paths = keys.map(k => ref.concat(String(k).split('/')));
      for (const p of paths) {
        const pathStr = p.join('/');
        for (const f of failures) {
          if (f.times > 0 && pathStr.startsWith(f.prefix)) { f.times--; throw new Error('INJECTED_WRITE_FAILURE: ' + pathStr); }
        }
      }
      const room = data.rooms[ref[1]];
      const merged = buildMerged(room, keys.map((k, i) => ({ parts: paths[i], val: obj[k] })));
      keys.forEach((k, i) => checkWrite(paths[i], obj[k], merged));
      keys.forEach((k, i) => {
        let o = data;
        for (let j = 0; j < paths[i].length - 1; j++) { if (o[paths[i][j]] == null) o[paths[i][j]] = {}; o = o[paths[i][j]]; }
        const last = paths[i][paths[i].length - 1];
        if (obj[k] == null) delete o[last]; else o[last] = JSON.parse(JSON.stringify(obj[k]));
      });
      notify();
    },
    remove: async ref => setParts(ref, null),
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
      // Initial-Fire ASYNC wie im echten Firebase-SDK: ein Attach waehrend des
      // synchronen fastForward-Replays darf nie mitten in der Schleife einen
      // Turn aufloesen (maybeReveal) — im Browser ist das ebenfalls unmoeglich.
      queueMicrotask(() => { if (listeners.has(l)) cb({ val: () => clone(at(l.parts)), exists: () => at(l.parts) != null }); });
      return () => listeners.delete(l);
    },
    onDisconnect: ref => ({
      set: async (val) => { const key = ref.join('/'); for (let i = ui.onDrop.length - 1; i >= 0; i--) if (ui.onDrop[i].ref.join('/') === key) ui.onDrop.splice(i, 1); ui.onDrop.push({ ref, val }); },
      cancel: async () => { const key = ref.join('/'); for (let i = ui.onDrop.length - 1; i >= 0; i--) if (ui.onDrop[i].ref.join('/') === key) ui.onDrop.splice(i, 1); }
    }),
    serverTimestamp: () => nowMs
  });
  return { data, FBfor, failWrite, advance: (ms) => { nowMs += ms; }, now: () => nowMs };
}

// ── one sandboxed client = the REAL online functions + REAL physics ──
function makeClient(db, code, forcePid) {
  const ui = { code, log: [], onDrop: [] };
  const FB = db.FBfor(ui);
  const seq = (makeClient._seq = (makeClient._seq || 0) + 1);
  const pid = forcePid || ('PID' + String(seq).padStart(6, '0'));
  const tab = 'TAB' + String(seq).padStart(6, '0');
  const body = `
    const TUNE=false; let r3dOrbit=false, r3dActive=false;
    const T=k=>k;
    const window={__FB_READY:true,__FB_ERR:null,FB};
    const document={querySelector:()=>({textContent:'',style:{}})};
    const els={}; function $(id){return els[id]||(els[id]={style:{},classList:{add(){},remove(){},toggle(){}},textContent:'',innerHTML:'',value:'',disabled:false,querySelector:()=>({textContent:'',style:{}})});}
    let toastT; const toast=m=>{ui.log.push('toast:'+m);};
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},charge:{start(){},stop(){},update(){}}};
    let soundOn=false, particles=[], fx3=[], bgPulse=0, bgPulseRGB='';
    function spawn(){} function popBall(){} function fx3Hit(){} function fx3Dust(){}
    function winnerRGB(){return '';} function devSync(){}
    function resize(){} function updScrollHint(){} function setOn(){}
    function updateHud(){} function setPhaseText(){} function openCover(){}
    function showRoundEnd(){ui.log.push('roundEnd');} function showTeamDraw(){ui.log.push('teamDraw');}
    function showScoreFly(){} function scorePulse(){}
    // gameOver-Stub: Phase + Sieger wie das Original, ohne DOM-Overlay
    let lastWinner=-1; function gameOver(w){setPhase('over');lastWinner=w;}
    const showGame=()=>ui.log.push('showGame');
    function hidePublicUI(){} function startPublicListing(){} function stopPublicListing(){}
    const pubCalls=[];
    function removePublicListing(c){pubCalls.push('remove:'+c);}
    function writePublicListing(c){pubCalls.push('write:'+c);return Promise.resolve();}
    let roomPublic=false, createVisibility='private';
    const LOGICAL=1000, cx=500, cy=500, R0=LOGICAL*0.485; let BR=LOGICAL*0.032, R=R0;
    function curFR(){return FRICTION;} function curFE(){return FEND;} function curST(){return STOPV;}
    function maxPull(){return R0*MAXPULL_FRAC;}
    const REVEAL_MS=600, RESULT_MS=950, REDUCED_MOTION=false;
    let mode='bot',menuMode='bot',diff='easy',winTarget=3,fmt='single',ffaN=3,ffaNMenu=3,roundNo=1;
    let online=false, roomCode='', myPlayer=0, gen=0, runningGen=-1, turnNo=-1;
    let turnUnsub=null, genUnsub=null, presUnsub=null, seatsUnsub=null, gameStarted=false;
    let lobbyP={}, seatLeft=[], seatGone=[];
    let pendingSlot={}, onlineSessionId=0;
    let sentinelRetryTimer={};
    const SENTINEL_RETRY_BASE_MS=300, SENTINEL_RETRY_MAX_MS=2000;
    const SENTINEL_RETRY_MAX_ATTEMPTS=11;
    let onlineTerminatedSession=-1;
    const NAME_MAX=16, NAME_MAX_UNITS=48, LOBBY_HOST_GRACE_MS=12000;
    // B2-Sandbox: Grace bewusst GROSS — diese Suite testet den Reconnect INNERHALB
    // der Grace (kein vorzeitiger Leave-Sentinel der Ueberlebenden). Das Feuern
    // der Grace selbst (Sentinel nach Ablauf) decken test_ffa_flow/test_ffa_race ab.
    const SEAT_STALE_MS=60000;
    let roomP={}, matchGraceTimer={};
    let onlinePid=${JSON.stringify(pid)}, onlineTab=${JSON.stringify(tab)}, onlineName='';
    let playersRoster={}, rosterUnsub=null, lobbyHostGraceTimer=null, joinOpSeq=0;
    let phase='over', phaseStart=0, curAimer=0, balls=[], aimSet=[], commitIdx=[], commitAim=[], commitSpin=[], score=[];
    let dragging=false,dragShooter=-1,dragOwner=-1,outBall=-1,roundWinner=-1;
    let replaying=false, repPlaying=false, recFrames=[];
    function setPhase(p){phase=p;phaseStart=0;}
    const rrand=()=>ui.code;
    ${SRC}
    function drop(){
      try{if(turnUnsub)turnUnsub();}catch(e){} try{if(genUnsub)genUnsub();}catch(e){}
      try{if(presUnsub)presUnsub();}catch(e){} try{if(seatsUnsub)seatsUnsub();}catch(e){}
      try{if(rosterUnsub)rosterUnsub();}catch(e){}
      turnUnsub=genUnsub=presUnsub=seatsUnsub=rosterUnsub=null;
      const d=ui.onDrop.slice(); ui.onDrop.length=0;
      for(const {ref,val} of d) FB.set(ref,val).catch(()=>{});
    }
    // Reveal-Phase manuell aufloesen (Ersatz fuer den rAF-Loop des Browsers):
    // exakt die Pipeline applyLaunch -> stepSim* -> afterResult wie in loop().
    function drive(){
      if(phase==='reveal'){
        applyLaunch();
        let k=0; while(phase==='sim'&&k++<20000)stepSim();
        if(phase==='result')afterResult();
      }
      return phase;
    }
    return {
      ui, els, drive,
      st(){return {online,mode,fmt,ffaN,myPlayer,gameStarted,roomCode,phase,gen,runningGen,turnNo,roundNo,
        aimSet:aimSet.slice(),score:score.slice(),ballN:balls.length,lastWinner,
        alive:balls.map(b=>b.alive?1:0).join('')};},
      setMenu(m,n){mode=menuMode=m;if(n)ffaN=ffaNMenu=n;},
      setFmt(f){fmt=f;},
      setName(n){onlineName=sanitizeName(n);},
      create(){createRoom();},
      join(c){$('onInput').value=c;joinRoom();},
      clickStart(){startFfaMatch();},
      hash(){return simHash();},
      aliveOf(o){return aliveCount(o);},
      gone(o){return !!seatGone[o];},
      pid(){return onlinePid;},
      status(){return $('onStatus').textContent;},
      pendingCount(){return Object.keys(pendingSlot).length;},
      commitMove(dx,dy,idx){
        if(phase!=='aim'||aimSet[myPlayer]||!aliveCount(myPlayer))return false;
        const own=idx!=null?idx:balls.findIndex(b=>b.alive&&b.owner===myPlayer);
        const m=sanitizeMove(myPlayer,own,dx,dy,0);
        onlineSendCommit(m.idx,m.dx,m.dy,m.sp);
        return true;
      },
      async rejoin(c){return await attemptRejoin(c);},
      leave(){leaveOnline();},
      drop
    };`;
  return new Function('FB', 'ui', body)(FB, ui);
}

let pass = 0, fail = 0;
const t = (name, cond, info) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''))); };
const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 2));
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
};
// Ein kompletter Online-Turn: alle lebenden Seats committen (moves = {seat:[dx,dy,idx?]}),
// danach loest jeder Client seine Reveal-Phase deterministisch selbst auf.
async function playTurn(clients, moves) {
  for (const c of clients) { const m = moves[c.st().myPlayer]; if (m) c.commitMove(m[0], m[1], m[2]); }
  await tick();
  for (const c of clients) c.drive();
  await tick();
}

(async () => {
  // ══ RC1: 2v2 (double) — Mid-Match-Reconnect, fmt bleibt 'double' (Bug-Fix) ══
  {
    const db = makeDB();
    const h = makeClient(db, 'DBL1'); h.setMenu('online'); h.setFmt('double'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('DBL1'); await tick();
    t('RC1 2v2 auto-start, 4 balls (2 per player)', h.st().gameStarted && g.st().gameStarted && h.st().ballN === 4 && g.st().ballN === 4);
    await playTurn([h, g], { 0: [30, -60], 1: [-20, 55] });
    t('RC1 turn 0 resolved identically', h.st().turnNo === 1 && g.st().turnNo === 1 && h.hash() === g.hash());
    await playTurn([h, g], { 0: [80, -120, 1], 1: [0, 0] });
    t('RC1 turn 1 resolved identically', h.st().turnNo === g.st().turnNo && h.hash() === g.hash());
    const gpid = g.pid(); const preHash = h.hash();
    g.drop(); await tick();
    const g2 = makeClient(db, 'X', gpid); g2.setMenu('online');
    const ok = await g2.rejoin('DBL1'); await tick();
    t('RC1 mid-match rejoin succeeds on the same seat', ok === true && g2.st().online === true && g2.st().myPlayer === 1 && g2.st().gameStarted === true);
    t('RC1 fmt double NOT normalized to ffa (historic bug)', g2.st().fmt === 'double' && g2.st().mode === 'online');
    t('RC1 replay rehydrates bit-identical state', g2.hash() === h.hash() && h.hash() === preHash, { h: h.hash(), g2: g2.hash() });
    t('RC1 turn/round rehydrated', g2.st().turnNo === h.st().turnNo && g2.st().roundNo === h.st().roundNo && g2.st().ballN === 4);
    t('RC1 no duplicate seat, presence re-activated', db.data.rooms.DBL1.p[1].on === true && db.data.rooms.DBL1.p[2] == null && db.data.rooms.DBL1.players[1].id === gpid);
    // beide spielen nach dem Reconnect deterministisch weiter
    await playTurn([h, g2], { 0: [10, -80], 1: [-45, 70] });
    t('RC1 lockstep continues in sync after the reconnect', h.hash() === g2.hash() && h.st().turnNo === g2.st().turnNo);
  }

  // ══ RC2: FFA (3 Spieler) — Refresh VOR eigenem Commit: kein Auto-Send,
  //         fremde Commits bleiben, Rehydration identisch ══
  {
    const db = makeDB();
    const h = makeClient(db, 'FFA1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('FFA1'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('FFA1'); await tick();
    h.clickStart(); await tick();
    t('RC2 ffa started 3p', [h, g1, g2].every(c => c.st().gameStarted && c.st().ffaN === 3));
    await playTurn([h, g1, g2], { 0: [25, -40], 1: [-30, 30], 2: [15, 50] });
    t('RC2 turn 0 in sync', h.hash() === g1.hash() && g1.hash() === g2.hash());
    // Turn 1: h und g1 committen, g2 laedt VOR seinem Commit neu
    h.commitMove(40, -20); g1.commitMove(-25, 45); await tick();
    const g2pid = g2.pid();
    g2.drop(); await tick();
    const g2b = makeClient(db, 'X', g2pid); g2b.setMenu('online');
    const ok = await g2b.rejoin('FFA1'); await tick();
    t('RC2 rejoin before own commit succeeds', ok === true && g2b.st().myPlayer === 2 && g2b.st().fmt === 'ffa' && g2b.st().ffaN === 3);
    t('RC2 foreign commits rehydrated, own slot still open', g2b.st().aimSet[0] === true && g2b.st().aimSet[1] === true && g2b.st().aimSet[2] === false);
    t('RC2 no auto-send of a merely local move', g2b.pendingCount() === 0 && (db.data.rooms.FFA1.g[0].t[1] || {})[2] == null);
    t('RC2 state matches the survivors', g2b.hash() === h.hash());
    g2b.commitMove(-10, -35); await tick();
    for (const c of [h, g1, g2b]) c.drive(); await tick();
    t('RC2 lockstep resolves for all after the late commit', h.hash() === g1.hash() && g1.hash() === g2b.hash() && h.st().turnNo === g2b.st().turnNo);
  }

  // ══ RC3: Refresh NACH gespeichertem Commit — Commit bleibt gueltig,
  //         wird nicht erneut gesendet ══
  {
    const db = makeDB();
    const h = makeClient(db, 'FFA2'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('FFA2'); await tick();
    h.clickStart(); await tick();
    g.commitMove(33, -44); await tick();
    const stored = db.data.rooms.FFA2.g[0].t[0][1];
    t('RC3 commit stored in db before the reload', !!stored && stored.dx === 33 && stored.dy === -44);
    const gpid = g.pid();
    g.drop(); await tick();
    const g2 = makeClient(db, 'X', gpid); g2.setMenu('online');
    const ok = await g2.rejoin('FFA2'); await tick();
    t('RC3 rejoin after own commit succeeds', ok === true && g2.st().myPlayer === 1);
    t('RC3 own stored commit rehydrated as set', g2.st().aimSet[1] === true && g2.pendingCount() === 0);
    const after = db.data.rooms.FFA2.g[0].t[0][1];
    t('RC3 stored commit untouched (no re-send, write-once intact)', after && after.dx === 33 && after.dy === -44);
    h.commitMove(0, 0); await tick();
    for (const c of [h, g2]) c.drive(); await tick();
    t('RC3 turn resolves with the preserved commit', h.hash() === g2.hash() && h.st().turnNo === 1);
  }

  // ══ RC4: TRIPLE FFA — Reconnect mit 2 eigenen Kugeln, fmt/teamCap korrekt ══
  {
    const db = makeDB();
    const h = makeClient(db, 'TRP1'); h.setMenu('ffa', 3); h.setFmt('triple_ffa'); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('TRP1'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('TRP1'); await tick();
    h.clickStart(); await tick();
    t('RC4 triple started, 6 balls', [h, g1, g2].every(c => c.st().gameStarted && c.st().ballN === 6 && c.st().fmt === 'triple_ffa'));
    await playTurn([h, g1, g2], { 0: [20, -50, 0], 1: [-35, 25], 2: [10, 40] });
    const g1pid = g1.pid(); g1.drop(); await tick();
    const g1b = makeClient(db, 'X', g1pid); g1b.setMenu('online');
    const ok = await g1b.rejoin('TRP1'); await tick();
    t('RC4 triple rejoin: fmt triple_ffa, 6 balls, seat 1', ok === true && g1b.st().fmt === 'triple_ffa' && g1b.st().ballN === 6 && g1b.st().myPlayer === 1);
    t('RC4 replay bit-identical', g1b.hash() === h.hash() && g1b.hash() === g2.hash());
    await playTurn([h, g1b, g2], { 0: [0, 0], 1: [50, -60, 4], 2: [0, 0] });
    t('RC4 sync continues (own 2nd ball committable)', h.hash() === g1b.hash() && g1b.hash() === g2.hash());
  }

  // ══ RC5: TEAM DUEL — Reconnect inkl. Teamzuordnung; endgueltiges Leave
  //         eliminiert nur die eigene Kugel, Partner spielt weiter ══
  {
    const db = makeDB();
    const h = makeClient(db, 'TEA1'); h.setMenu('ffa', 4); h.setFmt('team_duel'); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('TEA1'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('TEA1'); await tick();
    const g3 = makeClient(db, 'X'); g3.setMenu('online'); g3.join('TEA1'); await tick();
    h.clickStart(); await tick();
    t('RC5 team duel started 4p/4 balls', [h, g1, g2, g3].every(c => c.st().gameStarted && c.st().ballN === 4 && c.st().fmt === 'team_duel'));
    await playTurn([h, g1, g2, g3], { 0: [15, -30], 1: [-20, 25], 2: [30, 10], 3: [-10, -40] });
    t('RC5 turn 0 in sync (4 clients)', new Set([h, g1, g2, g3].map(c => c.hash())).size === 1);
    // Seat 2 (Team Blau, Partner von Seat 0) laedt neu
    const g2pid = g2.pid(); g2.drop(); await tick();
    const g2b = makeClient(db, 'X', g2pid); g2b.setMenu('online');
    const ok = await g2b.rejoin('TEA1'); await tick();
    t('RC5 rejoin restores seat 2 + team assignment', ok === true && g2b.st().myPlayer === 2 && g2b.st().fmt === 'team_duel' && g2b.st().ffaN === 4);
    t('RC5 replay bit-identical on all four', new Set([h, g1, g2b, g3].map(c => c.hash())).size === 1);
    // endgueltiges Leave von Seat 3 (Team Rot): nur SEINE Kugel faellt, Seat 1 spielt weiter
    g3.leave(); await tick();
    t('RC5 leave sentinel fills seat 3 slot', [h, g1, g2b].every(c => c.st().aimSet[3] === true && c.gone(3)));
    for (const c of [h, g1, g2b]) { const m = { 0: [0, 0], 1: [0, 0], 2: [0, 0] }[c.st().myPlayer]; c.commitMove(m[0], m[1]); }
    await tick();
    for (const c of [h, g1, g2b]) c.drive(); await tick();
    t('RC5 leaver ball eliminated, partner (seat 1) alive — team survives', [h, g1, g2b].every(c => c.aliveOf(3) === 0 && c.aliveOf(1) === 1));
    t('RC5 match continues in sync after the partial team loss', new Set([h, g1, g2b].map(c => c.hash())).size === 1 && [h, g1, g2b].every(c => c.st().gameStarted));
  }

  // ══ RC6: Rundenuebergang + Score — Reconnect NACH einer Turn-Aufloesung
  //         mit Ringout rehydriert gen/score/alive/roundNo korrekt ══
  {
    const db = makeDB();
    const h = makeClient(db, 'SGL1'); h.setMenu('online'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('SGL1'); await tick();
    t('RC6 1v1 started', h.st().gameStarted && g.st().gameStarted);
    // Deterministischer Ringout: Gast schiesst die EIGENE Kugel mit Maximalkraft
    // ueber die nahe Ringkante (Reichweite ~826px >> 209px bis zum Rand)
    await playTurn([h, g], { 0: [0, 0], 1: [0, -194] });
    t('RC6 ringout scored a point', (h.st().score[0] | 0) + (h.st().score[1] | 0) >= 1 && h.st().roundNo >= 2);
    t('RC6 both in sync after the round', h.hash() === g.hash());
    const gpid = g.pid(); g.drop(); await tick();
    const g2 = makeClient(db, 'X', gpid); g2.setMenu('online');
    const ok = await g2.rejoin('SGL1'); await tick();
    t('RC6 rejoin after turn resolution succeeds', ok === true && g2.st().myPlayer === 1);
    t('RC6 score/round/alive rehydrated bit-identical', g2.hash() === h.hash() && g2.st().score.join() === h.st().score.join() && g2.st().roundNo === h.st().roundNo);
    t('RC6 gen rehydrated', g2.st().gen === h.st().gen && g2.st().runningGen === h.st().runningGen);
  }

  // ══ RC7: Fremde Identity kann den Seat NICHT uebernehmen ══
  {
    const db = makeDB();
    const h = makeClient(db, 'ATK1'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('ATK1'); await tick();
    h.clickStart(); await tick();
    const gpid = g.pid();
    g.drop(); await tick();
    // Client-Gate: fremde pid findet keinen eigenen Seat
    const evil = makeClient(db, 'X'); evil.setMenu('online');
    const ok = await evil.rejoin('ATK1'); await tick();
    t('RC7 foreign identity rejoin rejected (no own seat)', ok === false && evil.st().online === false);
    // Rules-Gate: direkter Reclaim-Write mit fremder id wird atomar abgelehnt
    const ext = db.FBfor({ log: [], onDrop: [] });
    let denied = false;
    try {
      await ext.update(ext.ref(null, 'rooms/ATK1'), {
        'p/1': { s: 'EVILTAB00000000', on: false, t: db.now() },
        'players/1': { id: 'EVILPID00000000', name: 'evil', tab: 'EVILTAB00000000' }
      });
    } catch (e) { denied = true; }
    t('RC7 direct foreign reclaim write denied by the rules', denied && db.data.rooms.ATK1.players[1].id === gpid);
    t('RC7 stale seat untouched', db.data.rooms.ATK1.p[1].on === false);
  }

  // ══ RC8: endgueltig freigegebener Seat (deliberate leave) ist NICHT
  //         zurueckeroberbar; neu vergebene Identity bleibt geschuetzt ══
  {
    const db = makeDB();
    const h = makeClient(db, 'REL1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('REL1'); await tick();
    const gpid = g.pid();
    g.leave(); await tick();   // deliberate leave: p/1+players/1 atomar geloescht
    t('RC8 seat records fully released by the leave', db.data.rooms.REL1 == null || (db.data.rooms.REL1.p && db.data.rooms.REL1.p[1]) == null);
    const g2 = makeClient(db, 'X', gpid); g2.setMenu('online');
    const ok = await g2.rejoin('REL1'); await tick();
    t('RC8 rejoin of a released seat safely rejected', ok === false && g2.st().online === false);
    // Seat legitim neu vergeben (simuliert): players/1.id gehoert jetzt jemand anderem
    const db2 = makeDB();
    const h2 = makeClient(db2, 'REL2'); h2.setMenu('ffa', 3); h2.create(); await tick();
    const ga = makeClient(db2, 'X'); ga.setMenu('online'); ga.join('REL2'); await tick();
    const gapid = ga.pid();
    ga.drop(); await tick();
    db2.data.rooms.REL2.players[1].id = 'OTHERPID00000001';   // Recycling durch fremde Identity (direkt, wie nach 15s-Regel)
    const gb = makeClient(db2, 'X', gapid); gb.setMenu('online');
    const ok2 = await gb.rejoin('REL2'); await tick();
    t('RC8 re-assigned seat is never reclaimed by the old identity', ok2 === false && gb.st().online === false && db2.data.rooms.REL2.players[1].id === 'OTHERPID00000001');
  }

  // ══ RC9: zwei gleichzeitige Rejoin-Versuche derselben Identity -> genau
  //         EIN Gewinner, kein Doppel-Seat, fail-safe ══
  {
    const db = makeDB();
    const h = makeClient(db, 'DUP1'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('DUP1'); await tick();
    h.clickStart(); await tick();
    const gpid = g.pid();
    g.drop(); await tick();
    const a = makeClient(db, 'X', gpid); a.setMenu('online');
    const b = makeClient(db, 'X', gpid); b.setMenu('online');
    const [ra, rb] = await Promise.all([a.rejoin('DUP1'), b.rejoin('DUP1')]);
    await tick();
    const winners = [ra, rb].filter(x => x === true).length;
    t('RC9 exactly one concurrent rejoin wins', winners === 1, { ra, rb });
    t('RC9 seat holds ONE active presence, id preserved', db.data.rooms.DUP1.p[1].on === true && db.data.rooms.DUP1.players[1].id === gpid && db.data.rooms.DUP1.p[2] == null);
  }

  // ══ RC10: Lobby-Rejoin — 15s-Stale-Fenster, Namens-Restauration, kein
  //          Public-Listing-Write ══
  {
    const db = makeDB();
    const h = makeClient(db, 'LOB1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.setName('Zoe'); g.join('LOB1'); await tick();
    t('RC10 roster name written', db.data.rooms.LOB1.players[1].name === 'Zoe');
    const gpid = g.pid();
    g.drop(); await tick();
    const g2 = makeClient(db, 'X', gpid); g2.setMenu('online');   // frischer Tab OHNE lokalen Namen
    const early = await g2.rejoin('LOB1'); await tick();
    t('RC10 lobby rejoin inside the stale window rejected (rejoinWait)', early === false && g2.status() === 'rejoinWait');
    db.advance(15001);
    const ok = await g2.rejoin('LOB1'); await tick();
    t('RC10 lobby rejoin restores the same seat', ok === true && g2.st().myPlayer === 1 && db.data.rooms.LOB1.p[1].on === true);
    t('RC10 roster name restored from the canonical record', db.data.rooms.LOB1.players[1].name === 'Zoe' && db.data.rooms.LOB1.players[1].id === gpid);
    t('RC10 rejoin never touches the public listing', g2.ui.log.every(l => l.indexOf('write:') !== 0));
  }

  // ══ RC11: Leave/Cleanup nach Reconnect unveraendert ══
  {
    const db = makeDB();
    const h = makeClient(db, 'CLN1'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('CLN1'); await tick();
    h.clickStart(); await tick();
    const gpid = g.pid(); g.drop(); await tick();
    const g2 = makeClient(db, 'X', gpid); g2.setMenu('online');
    await g2.rejoin('CLN1'); await tick();
    g2.leave(); await tick();
    t('RC11 leave after reconnect releases p+players together', !(db.data.rooms.CLN1 && db.data.rooms.CLN1.p && db.data.rooms.CLN1.p[1]) && !(db.data.rooms.CLN1 && db.data.rooms.CLN1.players && db.data.rooms.CLN1.players[1]));
    h.leave(); await tick();
    t('RC11 last leave removes the empty room (cleanup intact)', db.data.rooms.CLN1 == null);
  }

  console.log(`\nReconnect-B2: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
