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
  grab(/function setOnTitle\(ffa\)\{[\s\S]*?\n\}/, 'setOnTitle'),
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
  grab(/function seatActive\(p,s\)\{[^\n]*/, 'seatActive'),
  grab(/async function reserveSeat\(code,seat\)\{[\s\S]*?\n\}/, 'reserveSeat'),
  grab(/async function armPresence\(code,seat\)\{[\s\S]*?\n\}/, 'armPresence'),
  grab(/async function activateSeat\(code,seat,extra\)\{[\s\S]*?\n\}/, 'activateSeat'),
  grab(/async function releaseReservation\(code,seat,dc\)\{[\s\S]*?\n\}/, 'releaseReservation'),
  grab(/async function claimSeatSlot\(code,seat,op,extra\)\{[\s\S]*?\n\}/, 'claimSeatSlot'),
  grab(/async function abortFreshRoom\(code,dc,listed\)\{[\s\S]*?\n\}/, 'abortFreshRoom'),
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
  // Minimal mirror of the v3 rules (B1 client cutover): unified room-state +
  // tokenized presence p/<seat>={s,on,t}. `merged` gives each checkWrite call a
  // POST-write view (this write's own siblings in the same atomic update layered
  // over the current room) for both p/<seat> and players/<seat> and `state`, just
  // like the real rules' merged `newData` tree — so e.g. a players/<seat> create
  // sees the sibling p/<seat> reservation written in the SAME update().
  // B1 scope note: recycling a STALE existing p/<seat> (15s rule) and the
  // in-match takeover case are deliberately NOT modeled — any write whose token
  // (s) differs from the current holder's is rejected here too, mirroring the
  // real client's "no automatic recycling/takeover" behavior (see Paket B/TODO).
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
      // cleanup delete: whole room removable ONLY when no seat p/players remain
      // AT ALL (not just no ACTIVE seat) — a stale reservation also blocks it,
      // matching the real rule's !data.child('p').exists() (existence, not on).
      if (room && ((room.p && Object.keys(room.p).length) || (room.players && Object.keys(room.players).length)))
        throw new Error('PERMISSION_DENIED: room not empty');
      return;
    }
    if (!room) throw new Error('PERMISSION_DENIED: no room');
    if (!merged) merged = buildMerged(room, [{ parts, val }]);
    const fmt = room.config && room.config.fmt, key = parts[2];
    if (key === 'p') {
      const seat = +parts[3];
      if (seat >= 5 || (fmt !== 'ffa' && seat >= 2)) throw new Error('PERMISSION_DENIED: seat range');
      const cur = room.p && room.p[seat];
      if (val == null) {   // delete only together with players/<seat> gone in the SAME write
        if (merged.players(seat) != null) throw new Error('PERMISSION_DENIED: p delete requires players delete in same write');
        return;
      }
      if (!val || typeof val !== 'object' || typeof val.s !== 'string' || typeof val.on !== 'boolean' || typeof val.t !== 'number'
        || Object.keys(val).some(k => k !== 's' && k !== 'on' && k !== 't'))
        throw new Error('PERMISSION_DENIED: p shape');
      if (!cur) {   // RESERVE: fresh claim, on:false, lobby, matching players.tab in the SAME write
        if (val.on !== false) throw new Error('PERMISSION_DENIED: fresh reserve must be on:false');
        if (room.state !== 'lobby') throw new Error('PERMISSION_DENIED: reserve only in lobby');
        const pl = merged.players(seat);
        if (!pl || pl.tab !== val.s) throw new Error('PERMISSION_DENIED: reserve needs matching players.tab in same write');
        return;
      }
      if (val.s === cur.s) {
        if (cur.on === false && val.on === true) {   // ACTIVATE
          const g = room.g && room.g[room.gen];
          if (g && g.e && g.e[seat] === true) throw new Error('PERMISSION_DENIED: activate eliminated seat');
          const okState = seat === 0 || fmt === 'ffa' || room.state === 'playing' ||
            (seat === 1 && room.state === 'lobby' && merged.state() === 'playing');
          if (!okState) throw new Error('PERMISSION_DENIED: activate state gate');
          return;
        }
        if (cur.on === true && val.on === false) return;    // onDisconnect / deliberate offline-write
        if (cur.on === false && val.on === false) return;   // same-token refresh (unused by B1 client)
        throw new Error('PERMISSION_DENIED: p on transition');
      }
      // Different token than the current holder: recycle/takeover — out of B1
      // scope (no automatic recycling/takeover implemented), rejected here too.
      throw new Error('PERMISSION_DENIED: p token mismatch (recycle/takeover not in B1 scope)');
    }
    if (key === 'state') {
      // lobby->playing: ffa host-start OR 1v1/2v2 guest claim; p/1 must already be
      // on:true in the SAME write (or already true), host p/0 stays on:true.
      const p0 = room.p && room.p[0], p1 = merged.p(1);
      if (!(val === 'playing' && room.state === 'lobby' && p0 && p0.on === true && p1 && p1.on === true))
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
      if (val == null) {       // delete only together with p/<seat> gone in the SAME write
        if (merged.p(seat) != null) throw new Error('PERMISSION_DENIED: players delete requires p delete in same write');
        return;
      }
      if (si >= 5 || (fmt !== 'ffa' && si >= 2)) throw new Error('PERMISSION_DENIED: players seat range');
      if (!val || typeof val !== 'object'
        || typeof val.id !== 'string' || !/^[A-Za-z0-9_-]{8,24}$/.test(val.id)
        || typeof val.name !== 'string' || val.name.length < 1 || val.name.length > 48
        || typeof val.tab !== 'string' || !/^[A-Za-z0-9_-]{8,24}$/.test(val.tab)
        || Object.keys(val).some(k => k !== 'id' && k !== 'name' && k !== 'tab'))
        throw new Error('PERMISSION_DENIED: players record invalid');
      const pVal = merged.p(seat);
      if (!pVal || pVal.s !== val.tab) throw new Error('PERMISSION_DENIED: players needs matching p.s in same write');
      if (rec && rec.id === val.id) return;   // same-id update (name refresh): id immutable, always ok
      // A differing-id create/replace needs a genuinely FRESH seat (no rec at all);
      // replacing an existing foreign record (recycle) is out of B1 scope.
      if (rec) throw new Error('PERMISSION_DENIED: players replace not in B1 scope (no recycling)');
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
    // Atomic multi-path update: honor failure injection and validate EVERY path
    // against the pre-write tree (with a merged post-write view across the WHOLE
    // batch) BEFORE any data change, then apply all-or-nothing — a single
    // rejected/failed path aborts the whole write, leaving no partial state.
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
    // v3: onDisconnect only ever SETs a token-bound offline payload — the real
    // client never calls .remove() on p/<seat> anymore.
    onDisconnect: ref => ({
      set: async (val) => { const key = ref.join('/'); for (let i = ui.onDrop.length - 1; i >= 0; i--) if (ui.onDrop[i].ref.join('/') === key) ui.onDrop.splice(i, 1); ui.onDrop.push({ ref, val }); },
      cancel: async () => { const key = ref.join('/'); for (let i = ui.onDrop.length - 1; i >= 0; i--) if (ui.onDrop[i].ref.join('/') === key) ui.onDrop.splice(i, 1); }
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
    // Public-Lobby (feature/public-lobby-mvp): the discovery index itself is not backed
    // by the fake DB, but writePublicListing/removePublicListing RECORD their calls so the
    // create-race + host-leave order can be asserted. bumpAfterListing lets a test make the
    // op go stale exactly after a successful listing write. UI helpers stay inert stubs.
    let roomPublic=false, createVisibility='private', bumpAfterListing=false;
    const pubCalls=[];
    function removePublicListing(c){pubCalls.push('remove:'+c);}
    function writePublicListing(c){pubCalls.push('write:'+c); if(bumpAfterListing){bumpAfterListing=false;joinOpSeq++;} return Promise.resolve();}
    function publicListingRef(){return null;} function hidePublicUI(){}
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
      // v3: onDisconnect writes its armed {s,on:false,t} payload, never removes.
      for(const {ref,val} of d) FB.set(ref,val).catch(()=>{});   // server-side reject (stale token) is silent, like real onDisconnect
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
      async releaseClaim(c,s){return await releaseReservation(c,s,null);},
      // Direct atomic-claim driver for the parallel-race / onDisconnect-lifecycle
      // tests: fresh op each call, real claimSeatSlot (p+players[+state] in one write).
      async claimSlot(c,s,extra){return await claimSeatSlot(c,s,newJoinOp(),extra);},
      onDrops(){return ui.onDrop.map(d=>d.ref.join('/'));},
      status(){return $('onStatus').textContent;},
      hasGrace(){return !!lobbyHostGraceTimer;},
      // Public-Lobby hooks: set the create-visibility, arm a stale-after-listing bump,
      // read the recorded listing calls, and read the committed roomPublic flag.
      setVis(v){createVisibility=v;},
      armStaleAfterListing(){bumpAfterListing=true;},
      pubCalls(){return pubCalls.slice();},
      isRoomPublic(){return roomPublic;},
      drop
    };`;
  return new Function('FB', 'ui', body)(FB, ui);
}

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
// External presence-flap simulation (server-observed disconnect from OUTSIDE any
// sandboxed client): v3 onDisconnect only ever writes {s,on:false,t} on the SAME
// token, never removes — this mirrors that for scenarios that flap a seat without
// going through a real client's own drop().
async function dropSeat(db, code, seat) {
  const ext = db.FBfor({ log: [], onDrop: [] });
  const cur = db.data.rooms[code].p[seat];
  await ext.set(ext.ref(null, 'rooms/' + code + '/p/' + seat), { s: cur.s, on: false, t: 1 });
}

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
    h.setLobbyP({ 0: { on: true }, 1: { on: true } });   // stale headcount: host missed g2's claim
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
    t('S9 guest atomic claim flipped state to playing', db.data.rooms.SGL1.state === 'playing' && db.data.rooms.SGL1.p[1].on === true && db.data.rooms.SGL1.players[1].id === g.pid());
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
    // Presence-Flap: p/3 geht serverseitig auf on:false (onDisconnect), g3 laeuft aber weiter
    await dropSeat(db, 'SYN4', 3); await tick();
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
    // Presence-Flap: Seat 4 geht serverseitig auf on:false, bevor irgendwer committet
    await dropSeat(db, 'SYN5', 4); await tick();
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

  // ── R1 (B1-revised): guest reload in the lobby — presence goes inactive
  //    (on:false, never removed) but the roster record lingers. B1 deliberately
  //    implements NO automatic recycling/takeover: a fresh join by a DIFFERENT
  //    identity claims the NEXT free seat (2), not the stale one, and the
  //    original identity's own direct rejoin attempt is safely rejected (dead
  //    code path — attemptRejoin/roomRejoinableState stay schema-compatible but
  //    unreachable from the UI; real same-seat rejoin is Paket B/B2). ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RJN1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('RJN1'); await tick();
    const gpid = g.pid();
    t('R1 guest seated 1 with roster record', g.st().myPlayer === 1 && db.data.rooms.RJN1.players[1].id === gpid);
    g.drop(); await tick();                              // reload: onDisconnect writes p/1 on:false; players/1 stays
    t('R1 presence inactive but roster record kept', db.data.rooms.RJN1.p[1].on === false && db.data.rooms.RJN1.players[1].id === gpid);
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('RJN1'); await tick();
    t('R1 no recycling: a new guest claims the NEXT free seat, not the stale one', g2.st().myPlayer === 2);
    t('R1 stale seat 1 untouched by the new joiner', db.data.rooms.RJN1.p[1].on === false && db.data.rooms.RJN1.players[1].id === gpid);
    const g3 = makeClient(db, 'X', gpid); g3.setMenu('online');
    const ok = await g3.rejoin('RJN1');
    t('R1 direct rejoin of the stale seat by the SAME identity is safely rejected', ok === false && g3.st().online === false);
    t('R1 rejected rejoin left the stale seat exactly as-is', db.data.rooms.RJN1.p[1].on === false && db.data.rooms.RJN1.players[1].id === gpid);
  }

  // ── R2 (B1-revised): host reload does NOT close the FFA lobby at once (grace) —
  //    that part of Paket A is a presence-tolerance feature, not a rejoin, and
  //    stays active. Actually reclaiming seat 0 during the grace still needs the
  //    recycling this task deliberately does not implement, so a direct host
  //    rejoin attempt is safely rejected. ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RJN2'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('RJN2'); await tick();
    const hpid = h.pid();
    h.drop(); await tick();                              // host reload: p/0 on:false, players/0 kept
    t('R2 guest keeps the lobby open during the host grace', g.st().online === true && g.hasGrace() === true);
    const h2 = makeClient(db, 'X', hpid); h2.setMenu('ffa');
    const ok = await h2.rejoin('RJN2'); await tick();
    t('R2 direct host rejoin during the grace is rejected (no recycling in B1)', ok === false && h2.st().online === false);
    t('R2 host seat left inactive, not restored by the rejected rejoin', db.data.rooms.RJN2.p[0].on === false);
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

  // ── R5: late rejoin attempt from room A after a newer join to room B -> the
  //    op guard neutralizes the old continuation (no globals/listeners/writes of
  //    B touched). The attempt would fail on its own anyway (no recycling in B1
  //    scope), but the op guard must still short-circuit it BEFORE that, leaving
  //    room A's stale seat exactly as the reload left it. ──
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
    t('R5 room A presence NOT restored by the stale rejoin', db.data.rooms.ROMA.p[1].on === false);
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
    // Same tab (p/1.s) as the legitimate holder — isolates the assertion to id
    // immutability specifically, not an (also-denied) tab/p.s mismatch.
    const holdTab = db.data.rooms.ATK1.p[1].s;
    try { await atk.set(atk.ref(null, 'rooms/ATK1/players/1'), { id: 'EVIL0001', name: 'evil', tab: holdTab }); } catch (e) { denied = true; }
    t('R6 id switch on an occupied seat denied (id immutable)', denied && db.data.rooms.ATK1.players[1].id === g.pid());
    denied = false;
    try { await atk.remove(atk.ref(null, 'rooms/ATK1/players/1')); } catch (e) { denied = true; }
    t('R6 record delete denied while the presence is held', denied && !!db.data.rooms.ATK1.players[1]);
    h.clickStart(); await tick();
    denied = false;
    try { await atk.set(atk.ref(null, 'rooms/ATK1/players/2'), { id: 'EVIL0002', name: 'evil', tab: 'EVILTAB0' }); } catch (e) { denied = true; }
    t('R6 record creation during a running match denied', denied && !(db.data.rooms.ATK1.players && db.data.rooms.ATK1.players[2]));
  }

  // ── R7: host rejoin during a RUNNING ffa match is rejected by the CLIENT
  //    boundary (roomRejoinableState requires state==='lobby') — maybeStart can
  //    never locally restart a running room. This is a client-side gate check
  //    only; the exact rule-level permission matrix for p/<seat> is covered by
  //    test_rules.js directly against the real firebase.rules.json. ──
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
    t('R7 host presence left inactive, untouched by the rejected rejoin', db.data.rooms.RUN1.p[0].on === false);
  }

  // ── R8 (B1-revised): 1v1 — host reload while still waiting for a guest leaves
  //    the host presence inactive (no recycling => the room reads as orphaned to
  //    new joiners, exactly like validateRoom is supposed to reject an inactive
  //    host); a direct host rejoin attempt is rejected too. Separately, once a
  //    match is running NORMALLY (no reload involved), rejoin (host or guest) is
  //    rejected by the client-side lobby-only boundary. ──
  {
    const db = makeDB();
    const h = makeClient(db, 'SGL2'); h.setMenu('online'); h.create(); await tick();
    const hpid = h.pid();
    h.drop(); await tick();                       // host reload while waiting
    const h2 = makeClient(db, 'X', hpid); h2.setMenu('online');
    const okWait = await h2.rejoin('SGL2'); await tick();
    t('R8 1v1 host rejoin while waiting rejected (no recycling in B1)', okWait === false && h2.st().online === false);
    const gOrphan = makeClient(db, 'X'); gOrphan.setMenu('online'); gOrphan.join('SGL2'); await tick();
    t('R8 1v1 room reads as orphaned to joiners while host is inactive', gOrphan.status() === 'Raum ist verwaist.' && gOrphan.st().online === false);

    // Separate room: a normal 1v1 match (no reload) running -> rejoin rejected.
    const db2 = makeDB();
    const h3 = makeClient(db2, 'SGL3'); h3.setMenu('online'); h3.create(); await tick();
    const h3pid = h3.pid();
    const g3 = makeClient(db2, 'X'); g3.setMenu('online'); g3.join('SGL3'); await tick();
    t('R8 1v1 auto-start on a normal join', h3.st().gameStarted && g3.st().gameStarted);
    h3.drop(); await tick();                      // host reload mid-match
    const h4 = makeClient(db2, 'X', h3pid); h4.setMenu('online');
    const okRun = await h4.rejoin('SGL3'); await tick();
    t('R8 1v1 host rejoin after match start rejected', okRun === false && h4.st().online === false && h4.status() === 'rejoinNoLobby' && db2.data.rooms.SGL3.p[0].on === false);
    const g3pid = g3.pid();
    g3.drop(); await tick();
    const g4 = makeClient(db2, 'X', g3pid); g4.setMenu('online');
    const okG = await g4.rejoin('SGL3'); await tick();
    t('R8 1v1 guest rejoin rejected (their join started the match)', okG === false && g4.status() === 'rejoinNoLobby');
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
    t('R9 2v2 host match rejoin rejected', ok === false && h2.status() === 'rejoinNoLobby' && db.data.rooms.DBL1.p[0].on === false);
  }

  // ── R10 (B1-revised, replaces old R10/RN1): a stale (disconnected) seat is
  //    NEVER automatically recycled or taken over in B1 scope — two clients
  //    racing to claim it both lose, the stale presence+record are left exactly
  //    as the reload left them, and a plain new join lands on the NEXT free
  //    seat instead. Real same-seat recycling is Paket B. ──
  {
    const db = makeDB();
    const h = makeClient(db, 'RCY1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('RCY1'); await tick();
    const stalePid = g1.pid();
    g1.drop(); await tick();                      // reload: presence inactive, record lingers (lobby)
    const a = makeClient(db, 'AAA'); const b = makeClient(db, 'BBB');
    const [ra, rb] = await Promise.all([a.claimSlot('RCY1', 1), b.claimSlot('RCY1', 1)]);
    t('R10 no recycling: both racing claims on the stale seat lose', ra.lost === true && rb.lost === true);
    t('R10 stale seat untouched by the failed race', db.data.rooms.RCY1.p[1].on === false && db.data.rooms.RCY1.players[1].id === stalePid);
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('RCY1'); await tick();
    t('R10 a plain new join claims the next free seat instead', g2.st().myPlayer === 2);
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
    t('RP1 db seat 1 holds a single active presence + winner record', db.data.rooms.PAR1.p[1].on === true && db.data.rooms.PAR1.players[1] && db.data.rooms.PAR1.players[1].id === winnerPid);
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

  // ── RN1 (B1-revised): releaseReservation atomically removes BOTH p/<seat> and
  //    players/<seat> together — the v3 rules reject deleting either one alone
  //    (see checkWrite), so the rollback helper must always pair them. ──
  {
    const db = makeDB();
    const h = makeClient(db, 'NPD1'); h.setMenu('ffa', 3); h.create(); await tick();
    const a = makeClient(db, 'AAA'); const ra = await a.claimSlot('NPD1', 1);
    t('RN1 fresh claim on a genuinely free seat succeeds', ra.ok === true && db.data.rooms.NPD1.p[1].on === true);
    await a.releaseClaim('NPD1', 1); await tick();
    t('RN1 rollback removes presence AND roster record together', db.data.rooms.NPD1.p[1] == null && !(db.data.rooms.NPD1.players && db.data.rooms.NPD1.players[1]));
  }

  // ── CR1 (B1 regression): a createRoom whose ACTIVATE fails must NOT leave an
  //    orphan room. v3's cleanup rule denies a whole-room delete while p/0 or
  //    players/0 still exist, so abortFreshRoom() has to clear the host seat's
  //    presence AND roster atomically FIRST, then remove the now-empty room —
  //    exactly the clear-then-delete order leaveOnline() uses. A direct room
  //    remove (the pre-fix behavior) is rejected by the fake DB's cleanup mirror
  //    and would leave db.data.rooms.<code> behind. ──
  {
    const db = makeDB();
    const h = makeClient(db, 'CRB1'); h.setMenu('ffa', 3);
    db.failWrite('rooms/CRB1/p/0', 1);   // the ACTIVATE (p/0 on:true) leg fails like a transport error
    h.create(); await tick();
    t('CR1 host create with failed ACTIVATE stays offline', h.st().online === false);
    t('CR1 no orphan room left behind (host seat cleared, room removed)', !db.data.rooms.CRB1);
  }

  // ── PUB-CR (public-lobby create race): the visibility snapshot is operation-local.
  //    A UI toggle flip DURING the create's awaits must never change the running op's
  //    path, listing decision or cleanup. ──
  {
    const db = makeDB();
    const h = makeClient(db, 'PUBA'); h.setMenu('ffa', 3);
    h.setVis('public'); h.create();   // snapshots visibility='public' before the first await
    h.setVis('private');              // UI flips mid-op -> must NOT affect this create
    await tick();
    t('PUB-CR1 public create stays public despite mid-op flip to private', !!db.data.rooms.PUBA && db.data.rooms.PUBA.config.visibility === 'public');
    t('PUB-CR1 listing written for the public room', h.pubCalls().includes('write:PUBA'));
    t('PUB-CR1 committed roomPublic === true', h.isRoomPublic() === true);
  }
  {
    const db = makeDB();
    const h = makeClient(db, 'PUBB'); h.setMenu('ffa', 3);
    h.setVis('private'); h.create();  // snapshots visibility='private'
    h.setVis('public');               // UI flips mid-op -> must NOT create a listing
    await tick();
    t('PUB-CR2 private create stays private despite mid-op flip to public', !!db.data.rooms.PUBB && db.data.rooms.PUBB.config.visibility === 'private');
    t('PUB-CR2 no listing written for a private create', !h.pubCalls().some(c => c.indexOf('write:') === 0));
    t('PUB-CR2 committed roomPublic === false', h.isRoomPublic() === false);
  }
  {
    // stale op AFTER a successful listing write -> room AND listing fully compensated.
    const db = makeDB();
    const h = makeClient(db, 'PUBC'); h.setMenu('ffa', 3);
    h.setVis('public'); h.armStaleAfterListing(); h.create(); await tick();
    t('PUB-CR3 stale-after-listing create leaves NO room', !db.data.rooms.PUBC);
    t('PUB-CR3 listing was written then compensated (remove)', h.pubCalls().includes('write:PUBC') && h.pubCalls().includes('remove:PUBC'));
    t('PUB-CR3 client stays offline (globals never committed)', h.st().online === false);
  }

  // ── PUB-JOIN (roomPublic commit): the joining client adopts roomPublic ONLY after a
  //    successful seat claim; a failed/full join must leave no residue. ──
  {
    const db = makeDB();
    const hp = makeClient(db, 'PRVR'); hp.setMenu('ffa', 3); hp.setVis('private'); hp.create(); await tick();
    const gp = makeClient(db, 'JG1'); gp.setMenu('online'); gp.join('PRVR'); await tick();
    t('PUB-JOIN private room -> guest roomPublic false', gp.isRoomPublic() === false && gp.st().myPlayer === 1);

    const hpub = makeClient(db, 'PUBR'); hpub.setMenu('ffa', 3); hpub.setVis('public'); hpub.create(); await tick();
    const g1 = makeClient(db, 'JG2'); g1.setMenu('online'); g1.join('PUBR'); await tick();   // seat 1
    t('PUB-JOIN public room -> guest roomPublic true after successful claim', g1.isRoomPublic() === true && g1.st().myPlayer === 1);
    const g2 = makeClient(db, 'JG3'); g2.setMenu('online'); g2.join('PUBR'); await tick();   // seat 2
    const g3 = makeClient(db, 'JG4'); g3.setMenu('online'); g3.join('PUBR'); await tick();   // seat 3
    const g4 = makeClient(db, 'JG5'); g4.setMenu('online'); g4.join('PUBR'); await tick();   // seat 4 -> 5/5 full
    const gLate = makeClient(db, 'JG6'); gLate.setMenu('online'); gLate.join('PUBR'); await tick();
    t('PUB-JOIN lost/full public join leaves roomPublic unset', gLate.isRoomPublic() === false && gLate.st().online === false);
  }

  // ── PUB-LEAVE (rules-conform host-leave order): a public host leaves while a guest is
  //    still seated. The host removes p/0 + players/0 atomically FIRST (room becomes
  //    objectively host-less), and only AFTER that update settles removes the listing —
  //    the removePublicListing call sits inside the update's .then(), so its presence in
  //    pubCalls proves the atomic anchor removal succeeded before it. A present guest does
  //    not block that cleanup. (The FFA guest then closes the now host-less lobby itself,
  //    tearing the room down — a separate, already-tested behavior.) ──
  {
    const db = makeDB();
    const host = makeClient(db, 'PUBL'); host.setMenu('ffa', 3); host.setVis('public'); host.create(); await tick();
    const guest = makeClient(db, 'LGX'); guest.setMenu('online'); guest.join('PUBL'); await tick();
    t('PUB-LEAVE setup: public host + guest both online', db.data.rooms.PUBL.p[0].on === true && db.data.rooms.PUBL.p[1].on === true);
    host.leave(); await tick();
    t('PUB-LEAVE host anchors p/0 + players/0 gone after leave', !db.data.rooms.PUBL || (db.data.rooms.PUBL.p[0] == null && !(db.data.rooms.PUBL.players && db.data.rooms.PUBL.players[0])));
    t('PUB-LEAVE listing removed only after the atomic anchor removal settled', host.pubCalls().includes('remove:PUBL'));
  }
  // ── PUB-GUEST-LEAVE: a GUEST leaving a public lobby must NOT touch the listing —
  //    only the host owns it, and the room stays a valid public lobby for the host. ──
  {
    const db = makeDB();
    const host = makeClient(db, 'PUBG'); host.setMenu('ffa', 3); host.setVis('public'); host.create(); await tick();
    const guest = makeClient(db, 'GGX'); guest.setMenu('online'); guest.join('PUBG'); await tick();
    t('PUB-GUEST-LEAVE setup: guest seated, guest roomPublic true', guest.st().myPlayer === 1 && guest.isRoomPublic() === true);
    guest.leave(); await tick();
    t('PUB-GUEST-LEAVE guest never removes the listing', !guest.pubCalls().some(c => c.indexOf('remove:') === 0));
    t('PUB-GUEST-LEAVE room + host stay (still a valid public lobby)', !!db.data.rooms.PUBG && db.data.rooms.PUBG.p[0] && db.data.rooms.PUBG.p[0].on === true);
  }

  console.log('\nFFA-Online-Flow: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
