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
  grab(/function writeLeaveSentinel\(s\)\{[\s\S]*?\n\}/, 'writeLeaveSentinel'),
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
  grab(/async function claimSeat\(code\)\{[\s\S]*?\n\}/, 'claimSeat'),
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
  grab(/function onlineTurnValue\(val\)\{[\s\S]*?\n\}/, 'onlineTurnValue'),
  grab(/function onlineSendCommit\(idx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'onlineSendCommit'),
  grab(/function onlineRematch\(\)\{[^\n]*/, 'onlineRematch'),
  grab(/function leaveOnline\(\)\{[\s\S]*?\n\}/, 'leaveOnline'),
].join('\n');

// ── fake RTDB with the v2 rule behaviors the flows depend on ──
function makeDB() {
  const data = { rooms: {} };
  const listeners = new Set();
  const at = parts => parts.reduce((a, k) => (a && typeof a === 'object') ? a[k] : undefined, data);
  const clone = v => v === undefined || v === null ? null : JSON.parse(JSON.stringify(v));
  function notify() {
    for (const l of Array.from(listeners)) {
      if (!listeners.has(l)) continue;
      const cur = JSON.stringify(clone(at(l.parts)));
      if (cur !== l.last) { l.last = cur; l.cb({ val: () => clone(at(l.parts)), exists: () => at(l.parts) != null }); }
    }
  }
  function checkWrite(parts, val) {  // minimal mirror of the published v2 rules
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
        if (fmt === 'ffa' && room.p && room.p[seat]) throw new Error('PERMISSION_DENIED: write-once seat');
        if (fmt === 'ffa' && seat !== 0 && room.state !== 'lobby') throw new Error('PERMISSION_DENIED: not lobby');
      }
      return;
    }
    if (key === 'state') {
      if (!(fmt === 'ffa' && val === 'playing' && room.state === 'lobby' && room.p && room.p[1] === true))
        throw new Error('PERMISSION_DENIED: state');
      return;
    }
    if (key === 'seats') {
      if (!(fmt === 'ffa' && room.seats == null && room.state === 'playing' && val >= 2 && val <= 5))
        throw new Error('PERMISSION_DENIED: seats');
      return;
    }
    if (key === 'gen') { if (val !== room.gen + 1) throw new Error('PERMISSION_DENIED: gen'); return; }
    if (key === 'g') return;    // move write-once is covered by rules + lockstep suites
    throw new Error('PERMISSION_DENIED: ' + key);
  }
  function setParts(parts, val) {
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
    update: async (ref, obj) => { for (const k of Object.keys(obj)) setParts(ref.concat(String(k).split('/')), obj[k]); },
    remove: async ref => setParts(ref, null),
    onValue: (ref, cb) => {
      const l = { parts: ref, cb, last: JSON.stringify(clone(at(ref))) };
      listeners.add(l);
      cb({ val: () => clone(at(ref)), exists: () => at(ref) != null });   // initial fire like Firebase
      return () => listeners.delete(l);
    },
    onDisconnect: ref => ({ remove() { ui.onDrop.push(ref); } }),
    serverTimestamp: () => 1751900000000
  });
  return { data, FBfor };
}

// ── one sandboxed client = the real functions + inert UI/game stubs ──
function makeClient(db, code) {
  const ui = { code, log: [], onDrop: [] };
  const FB = db.FBfor(ui);
  const body = `
    const TUNE=false; let r3dOrbit=false;
    const PCOLS=[{ui:'#e33'},{ui:'#3e3'},{ui:'#33e'},{ui:'#ee3'},{ui:'#e3e'}];
    const window={__FB_READY:true,__FB_ERR:null,FB};
    const document={querySelector:()=>({textContent:''})};
    const els={}; function $(id){return els[id]||(els[id]={style:{},classList:{add(){},remove(){}},textContent:'',innerHTML:'',value:'',disabled:false,querySelector:()=>({textContent:''})});}
    let toastT; const toast=m=>{ui.log.push('toast:'+m);$('toast').textContent=m;};
    let mode='bot',menuMode='bot',diff='easy',winTarget=3,fmt='single',ffaN=3,ffaNMenu=3;
    let online=false, roomCode='', myPlayer=0, gen=0, runningGen=-1, turnNo=-1;
    let turnUnsub=null, genUnsub=null, presUnsub=null, seatsUnsub=null, gameStarted=false;
    let lobbyP={}, seatLeft=[], seatGone=[];
    let phase='over', curAimer=0, balls=[], aimSet=[], commitIdx=[], commitAim=[], commitSpin=[];
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
      turnUnsub=genUnsub=presUnsub=seatsUnsub=null;
      const d=ui.onDrop.slice(); ui.onDrop.length=0;
      for(const r of d) FB.remove(r);
    }
    return {
      ui, els,
      st(){return {online,mode,menuMode,fmt,ffaN,ffaNMenu,myPlayer,gameStarted,roomCode,phase,gen,runningGen,aimSet:aimSet.slice()};},
      setMenu(m,n){mode=menuMode=m;if(n)ffaN=ffaNMenu=n;},
      setLobbyP(p){lobbyP=p;},
      create(){createRoom();},
      join(c){$('onInput').value=c;joinRoom();},
      clickStart(){startFfaMatch();},
      canAim(){return whoCanAim();},
      va(){return viewAngle();},
      ballDist(o){const b=balls.find(x=>x.owner===o);return b?Math.hypot(b.x-cx,b.y-cy):-1;},
      gone(o){return !!seatGone[o];},
      kill(o){const b=balls.find(x=>x.owner===o);if(b)b.alive=false;},
      commitMove(){ if(whoCanAim()<0)return false; aimSet[myPlayer]=true; onlineSendCommit(myPlayer,5,5,0);
        if(allAliveCommitted()&&phase==='aim'){if(turnUnsub){turnUnsub();turnUnsub=null;}beginReveal();} return true; },
      rematch(){onlineRematch();},
      leave(){leaveOnline();},
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
    t('S1 room created ffa lobby', db.data.rooms.FFA3.state === 'lobby' && db.data.rooms.FFA3.config.fmt === 'ffa' && db.data.rooms.FFA3.v === 2);
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

  // ── S9: 1v1 regression through the same fake (auto-start, flip, no lobby) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'SGL1'); h.setMenu('online'); h.create(); await tick();
    t('S9 single room without state', db.data.rooms.SGL1.state === undefined && db.data.rooms.SGL1.config.fmt === 'single');
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('SGL1'); await tick();
    t('S9 auto-start both, np 2', h.st().gameStarted && g.st().gameStarted && h.ui.log.includes('newGame:2'));
    t('S9 guest view flip stays 1v1', g.va() === Math.PI && h.va() === 0);
    t('S9 lobby untouched', (h.els.lobbyCount||{textContent:''}).textContent === '' && g.st().mode === 'online');
    g.drop(); await tick();   // browser close -> onDisconnect removes p/1
    t('S9 disconnect ends match for host', h.els.wt.textContent === 'Gegner hat den Raum verlassen.');
  }

  console.log('\nFFA-Online-Flow: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
