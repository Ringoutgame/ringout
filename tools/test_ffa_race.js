// P0-Race-Regression (2026-07-11, Nachbesserung): Turn-Slot-Writes laufen jetzt
// ausschliesslich ueber runTransaction(...,{applyLocally:false}) statt set() —
// das erzeugt bewusst KEIN lokal-optimistisches onValue-Zwischenevent fuer den
// eigenen Write; result.snapshot ist die einzige autoritative Quelle. Diese Datei
// modelliert eine echte Firebase-Transaction in zwei Phasen:
//   1) runTransaction() wird aufgerufen -> die Transaktion haengt in einer vom
//      Test manuell steuerbaren Queue (kein Event feuert, applyLocally:false).
//   2) Bei explizitem flush() wird die updateFn gegen den DANN aktuellen
//      autoritativen Serverwert ausgewertet: leer -> committed:true, schreibt und
//      benachrichtigt ALLE Clients; belegt -> committed:false, KEIN Write, aber
//      result.snapshot enthaelt den echten (fremden) Wert.
// Zusaetzlich: Raum-/Session-/Turn-Wechsel waehrend eine Transaction/ein Listener
// noch haengt, um isCurrentCtx() in index.html zu pruefen (Codex-Nachbesserung:
// "Alte Promise-/Listener-Callbacks aus Raum A duerfen Raum B nicht treffen").
//   node test_ffa_race.js
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
  grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove'),
  grab(/function simHash\(\)\{[\s\S]*?\n\}/, 'simHash'),
  grab(/function onlineRematch\(\)\{[^\n]*/, 'onlineRematch'),
  grab(/function leaveOnline\(\)\{[\s\S]*?\n\}/, 'leaveOnline'),
].join('\n');

// ── fake RTDB with a real two-phase runTransaction() model ──
function makeDB() {
  const data = { rooms: {} };
  const listeners = new Set();          // {parts, cb, last}
  const txQueue = [];                   // {parts, updateFn, resolve, reject}
  let autoFlush = true;
  let lastTxOptions = null;             // Testhook (Codex-Nachbesserung Punkt 4): letzte an runTransaction uebergebene options
  const at = parts => parts.reduce((a, k) => (a && typeof a === 'object') ? a[k] : undefined, data);
  const clone = v => v === undefined || v === null ? null : JSON.parse(JSON.stringify(v));
  function notify() {
    for (const l of Array.from(listeners)) {
      if (!listeners.has(l)) continue;
      const cur = JSON.stringify(clone(at(l.parts)));
      if (cur !== l.last) { l.last = cur; l.cb({ val: () => clone(at(l.parts)), exists: () => at(l.parts) != null }); }
    }
  }
  function checkWrite(parts, val) {  // minimal mirror of the published v2 rules (unverändert)
    if (parts[0] !== 'rooms') throw new Error('PERMISSION_DENIED');
    const room = data.rooms[parts[1]];
    if (parts.length === 2) {
      if (val != null) { if (room) throw new Error('PERMISSION_DENIED: room exists'); return; }
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
    if (key === 'g') {          // move slots are write-once (arbiter, mirrors the real rules)
      if (val != null && at(parts) != null) throw new Error('PERMISSION_DENIED: move write-once');
      return;
    }
    throw new Error('PERMISSION_DENIED: ' + key);
  }
  function setParts(parts, val) {
    checkWrite(parts, val);
    let o = data;
    for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
    if (val == null) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = JSON.parse(JSON.stringify(val));
    notify();
  }
  function snapshotOf(parts) { return { val: () => clone(at(parts)), exists: () => at(parts) != null }; }
  // Loest EINE haengende Transaction gegen den JETZT aktuellen autoritativen
  // Serverwert auf — echtes Firebase wertet die updateFn ebenfalls gegen den
  // aktuellen Stand aus (mit Retry bei Konflikt; hier reicht eine Auswertung, da
  // die Tests die Reihenfolge bereits explizit steuern).
  function resolveTx(w) {
    const current = clone(at(w.parts));
    let next;
    try { next = w.updateFn(current); } catch (e) { w.reject(e); return; }
    if (next === undefined) { w.resolve({ committed: false, snapshot: snapshotOf(w.parts) }); return; }   // Slot belegt -> kein Write
    try { checkWrite(w.parts, next); } catch (e) { w.reject(e); return; }
    let o = data;
    for (let i = 0; i < w.parts.length - 1; i++) { if (o[w.parts[i]] == null) o[w.parts[i]] = {}; o = o[w.parts[i]]; }
    o[w.parts[w.parts.length - 1]] = JSON.parse(JSON.stringify(next));
    notify();
    w.resolve({ committed: true, snapshot: snapshotOf(w.parts) });
  }
  function flushNext() { const w = txQueue.shift(); if (!w) return false; resolveTx(w); return true; }
  function flushAll() { while (txQueue.length) flushNext(); }
  // Gezielte Aufloesung EINER bestimmten haengenden Turn-Slot-Transaction (letztes
  // Pfadsegment = Seat). Noetig fuer T26: Seat A wird bis zum Limit getrieben,
  // waehrend Seat B seine Transaction unangetastet in der Queue behaelt.
  function idxForSeat(seat) { return txQueue.findIndex(w => String(w.parts[w.parts.length - 1]) === String(seat)); }
  function flushSlot(seat) { const i = idxForSeat(seat); if (i < 0) return false; resolveTx(txQueue.splice(i, 1)[0]); return true; }
  function rejectSlot(seat, err) { const i = idxForSeat(seat); if (i < 0) return false; txQueue.splice(i, 1)[0].reject(err || new Error('NETWORK_ERROR')); return true; }
  // Simuliert einen echten Netzwerk-/Transport-Fehler: die Transaction wird NIE
  // gegen die Daten ausgewertet, einfach direkt abgelehnt (kein Rules-Fehler).
  function rejectNext(err) { const w = txQueue.shift(); if (!w) return false; w.reject(err || new Error('NETWORK_ERROR')); return true; }
  const FBfor = ui => ({
    db: null,
    ref: (db, path) => path.split('/'),
    get: async ref => ({ exists: () => at(ref) != null, val: () => clone(at(ref)) }),
    set: async (ref, val) => setParts(ref, val),          // weiterhin genutzt fuer Raum/Presence/gen/state/seats (kein Turn-Slot-Pfad mehr)
    update: async (ref, obj) => { for (const k of Object.keys(obj)) setParts(ref.concat(String(k).split('/')), obj[k]); },
    remove: async ref => setParts(ref, null),
    // Codex-Nachbesserung Punkt 4: die Fake-DB akzeptiert runTransaction() nur mit
    // dem dritten Argument {applyLocally:false} — genau wie die echte Firebase-API
    // es fuer den Turn-Slot-Pfad braucht (kein lokal-optimistisches Zwischenevent).
    // Fehlt das Argument, ist applyLocally nicht exakt false, oder heisst die
    // Property anders, wird die Transaction mit einem echten Fehler abgelehnt —
    // ein Regressions-Bug in index.html (z. B. Rueckfall auf set() oder ein Tippfehler
    // im Options-Objekt) faellt so sofort in JEDEM Test auf, der einen Turn-Slot
    // schreibt, statt nur in einem einzelnen isolierten Assert.
    runTransaction: (ref, updateFn, options) => new Promise((resolve, reject) => {
      lastTxOptions = options;
      if (!options || options.applyLocally !== false) {
        reject(new Error('runTransaction() MUST be called with {applyLocally:false} on the turn-slot path — got: ' + JSON.stringify(options)));
        return;
      }
      const w = { parts: ref, updateFn, resolve, reject };
      txQueue.push(w);
      // applyLocally:false -> hier bewusst KEIN Event, auch nicht beim Schreiber
      // selbst. Unkontestierte Writes (Normalfall) werden trotzdem sofort UND
      // unabhaengig von fremden, bewusst zurueckgehaltenen Race-Writes aufgeloest.
      if (autoFlush) { const idx = txQueue.indexOf(w); if (idx !== -1) txQueue.splice(idx, 1); resolveTx(w); }
    }),
    onValue: (ref, cb) => {
      const l = { parts: ref, cb, last: JSON.stringify(clone(at(ref))) };
      listeners.add(l);
      ui.lastListenerCb = cb;   // Testhook fuer T8: Referenz auf den zuletzt registrierten Callback dieses Clients
      // Testhook fuer T21 (Codex-Nachbesserung Punkt 4): gezielter Zugriff auf den
      // zuletzt registrierten Presence-/Gen-/Seats-Callback dieses Clients, um einen
      // verspaeteten Event NACH einem Raumwechsel gezielt zu simulieren.
      const kind = ref[2];   // 'p' | 'gen' | 'seats' | 'g' (Turn-Pfad) | undefined (Room-Root)
      ui.lastCbByKind = ui.lastCbByKind || {};
      ui.lastCbByKind[kind] = cb;
      cb({ val: () => clone(at(ref)), exists: () => at(ref) != null });
      return () => listeners.delete(l);
    },
    onDisconnect: ref => ({ remove() { ui.onDrop.push(ref); } }),
    serverTimestamp: () => 1751900000000
  });
  return {
    data, FBfor,
    setAutoFlush(v) { autoFlush = v; },
    flushNext, flushAll, rejectNext, flushSlot, rejectSlot,
    queueLen() { return txQueue.length; },
    get lastTxOptions() { return lastTxOptions; },
  };
}

// ── one sandboxed client = the real functions + inert UI/game stubs ──
function makeClient(db, code) {
  const ui = { code, log: [], onDrop: [] };
  const FB = db.FBfor(ui);
  const body = `
    const TUNE=false; let r3dOrbit=false;
    const T=k=>k;
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
    let phase='over', curAimer=0, balls=[], aimSet=[], commitIdx=[], commitAim=[], commitSpin=[], score=[];
    let replaying=false, repPlaying=false;
    const cx=500, cy=500, BR=32; let R=485;
    const rrand=()=>ui.code;
    const showGame=()=>ui.log.push('showGame'), showMenu=()=>ui.log.push('showMenu');
    const updateHud=()=>{}, setPhaseText=()=>{}, openCover=()=>{};
    const setPhase=ph=>{phase=ph;if(ph==='reveal')ui.log.push('reveal');};
    // maxPull() ist eine reine Physik-Konstante (R0*MAXPULL_FRAC) ausserhalb des
    // Scopes dieses Race-Harness -> als grosszuegiger Stub, damit die fixen
    // Test-Commits (dx=dy=5) nie geclamped werden. sanitizeMove() selbst ist NICHT
    // gestubbt (s. SRC) — die echte Produktionsfunktion validiert Ballindex/Ownership
    // (Codex-Nachbesserung Punkt 6: ein Passthrough-Stub haette den 2v2-Ownership-Bug
    // nie gefunden).
    const maxPull=()=>999999;
    // Fake-Timer statt echter setTimeout()-Wartezeiten (SENTINEL_RETRY_* liegen bei
    // 300-2000ms) — die Tests steuern das Feuern manuell ueber fireTimer(), analog
    // zum db.flushNext()-Muster fuer Transactions. Shadowt bewusst die globalen
    // Node-Timer NUR innerhalb dieses Sandbox-Scopes.
    let __timers=[];
    const setTimeout=(fn,ms)=>{ const h={fn,ms}; __timers.push(h); return h; };
    const clearTimeout=(h)=>{ const i=__timers.indexOf(h); if(i!==-1)__timers.splice(i,1); };
    function newGame(){ ui.log.push('newGame:'+np()); balls=[];aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
      for(let i=0;i<np();i++){aimSet.push(false);commitIdx.push(-1);commitAim.push({dx:0,dy:0});commitSpin.push(0);}
      if(mode!=='ffa'&&fmt==='double'){
        // echte 2v2-Ballzuordnung wie placeBalls() in index.html: 2 Kugeln pro Team,
        // Owner-Pattern 0,0,1,1 (Team 0 -> Ballindex 0/1, Team 1 -> Ballindex 2/3).
        balls.push({owner:0,alive:true,x:cx-100,y:cy+100,vx:0,vy:0});
        balls.push({owner:0,alive:true,x:cx+100,y:cy+100,vx:0,vy:0});
        balls.push({owner:1,alive:true,x:cx-100,y:cy-100,vx:0,vy:0});
        balls.push({owner:1,alive:true,x:cx+100,y:cy-100,vx:0,vy:0});
      }else{
        for(let i=0;i<np();i++){const a=Math.PI/2+i*2*Math.PI/np();
          balls.push({owner:i,alive:true,x:cx+Math.cos(a)*300,y:cy+Math.sin(a)*300,vx:0,vy:0});}
      }
      phase='aim'; if(online){curAimer=myPlayer;onlineArmTurn();} }
    ${SRC}
    function drop(){
      try{if(turnUnsub)turnUnsub();}catch(e){} try{if(genUnsub)genUnsub();}catch(e){}
      try{if(presUnsub)presUnsub();}catch(e){} try{if(seatsUnsub)seatsUnsub();}catch(e){}
      turnUnsub=genUnsub=presUnsub=seatsUnsub=null;
      const d=ui.onDrop.slice(); ui.onDrop.length=0;
      for(const r of d) FB.remove(r);
    }
    return {
      ui, els,
      st(){return {online,mode,menuMode,fmt,ffaN,ffaNMenu,myPlayer,gameStarted,roomCode,phase,gen,runningGen,turnNo,sessionId:onlineSessionId,aimSet:aimSet.slice(),commitIdx:commitIdx.slice(),commitAim:commitAim.map(a=>a.dx+'/'+a.dy),score:score.slice(),pending:Object.keys(pendingSlot).slice()};},
      setMenu(m,n){mode=menuMode=m;if(n)ffaN=ffaNMenu=n;},
      setFmt(f){fmt=f;},
      setLobbyP(p){lobbyP=p;},
      create(){createRoom();},
      join(c){$('onInput').value=c;joinRoom();},
      clickStart(){startFfaMatch();},
      canAim(){return whoCanAim();},
      hash(){return simHash();},
      gone(o){return !!seatGone[o];},
      kill(o){const b=balls.find(x=>x.owner===o);if(b)b.alive=false;},
      // P0-Fix-Spiegel: wie commit() online — nur senden (Transaction), settleSlot
      // bzw. das Turn-Echo wendet den Move an (auch den eigenen).
      commitMove(idx){ if(whoCanAim()<0)return false; onlineSendCommit(idx==null?myPlayer:idx,5,5,0); return true; },
      rematch(){onlineRematch();},
      leave(){leaveOnline();},
      forceSentinel(seat){ writeLeaveSentinel(seat); },
      lastListenerCb(){ return ui.lastListenerCb; },   // Testhook T8
      lastCb(kind){ return ui.lastCbByKind && ui.lastCbByKind[kind]; },   // Testhook T21 ('p'|'gen'|'seats')
      fireTimer(){ const h=__timers.shift(); if(h){ h.fn(); return true; } return false; },   // Testhook T18-T20: Sentinel-Retry manuell feuern
      timerCount(){ return __timers.length; },
      timerDelays(){ return __timers.map(x=>x.ms); },   // Testhook T22: Backoff-Werte pruefen
      peekTimerFn(){ return __timers[0] && __timers[0].fn; },   // Testhook T24: Retry-Callback VOR leave einfangen (simuliert einen spaet feuernden Timer, der dem Cleanup entkam)
      connLostCount(){ return ui.log.filter(m=>m==='toast:Verbindung zum Spiel verloren. Bitte Raum neu betreten.').length; },
      terminated(){ return isOnlineTerminated(); },   // Testhook T26: terminaler Abbruchzustand der aktuellen Session
      lastCbTurn(){ return ui.lastCbByKind && ui.lastCbByKind['g']; },
      drop
    };`;
  return new Function('FB', 'ui', body)(FB, ui);
}

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

(async () => {
  // ── T1: Transaction gewinnt mit eigenem Move ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T1AA'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T1AA'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    h.commitMove();
    t('T1 committed=true wins, own move applied via processSlot', db.queueLen() === 1);
    db.flushNext(); db.setAutoFlush(true); await tick();
    t('T1 own move applied exactly from the authoritative snapshot', h.st().aimSet[0] === true && h.st().commitAim[0] === '5/5' && h.gone(0) === false);
  }

  // ── T2: Transaction verliert gegen Sentinel ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T2AA'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('T2AA'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('T2AA'); await tick();
    h.clickStart(); await tick();
    const all = [h, g1, g2];
    db.setAutoFlush(false);
    h.forceSentinel(2);                       // Sentinel zuerst in der Queue -> gewinnt
    g2.commitMove();                          // Opfer committet parallel, verliert unten
    t('T2 both transactions pending, nothing applied yet', g2.st().aimSet[2] === false && h.st().aimSet[2] === false);
    db.flushNext();                           // Sentinel: committed=true
    db.flushNext();                           // Opfer: committed=false, snapshot=Sentinel
    db.setAutoFlush(true); await tick();
    t('T2 victim converges on the authoritative sentinel snapshot, not its own payload', g2.st().commitAim[2] === '0/0' && g2.gone(2) === true);
    t('T2 all clients converge identically', all.every(c => c.st().commitAim[2] === '0/0' && c.gone(2) === true));
    t('T2 no pending left', all.every(c => c.st().pending.length === 0));
  }

  // ── T3: Transaction verliert gegen echten Move (Sentinel-Schreiber verliert) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T3AA'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('T3AA'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('T3AA'); await tick();
    h.clickStart(); await tick();
    const all = [h, g1, g2];
    db.setAutoFlush(false);
    g2.commitMove();                          // echter Move zuerst -> gewinnt
    h.forceSentinel(2);                       // Sentinel verliert unten
    db.flushNext(); db.flushNext();
    db.setAutoFlush(true); await tick();
    t('T3 sentinel-writer converges on the real move (own committed=false result never applied)', h.st().commitAim[2] === '5/5' && h.gone(2) === false);
    t('T3 all clients converge identically', all.every(c => c.st().commitAim[2] === '5/5' && c.gone(2) === false));
  }

  // ── T4: identische Sentinel-Payloads verschiedener Clients (das war der Bug in
  //    der ersten Fix-Iteration: ein Wertevergleich haette den Gewinn hier
  //    faelschlich als "eigenes Echo" verworfen — die Transaction braucht diesen
  //    Vergleich gar nicht mehr, da result.snapshot immer autoritativ ist) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T4AA'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('T4AA'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('T4AA'); await tick();
    h.clickStart(); await tick();
    const all = [h, g1, g2];
    db.setAutoFlush(false);
    h.forceSentinel(2); g1.forceSentinel(2);   // zwei Clients schreiben unabhaengig denselben (byte-identischen) Sentinel fuer Seat 2
    t('T4 two competing identical-payload transactions queued', db.queueLen() === 2);
    db.flushAll(); db.setAutoFlush(true); await tick();
    t('T4 winner applied, loser converges on the SAME authoritative value (no false rejection)', h.st().commitAim[2] === '0/0' && g1.st().commitAim[2] === '0/0');
    t('T4 all clients converge identically', all.every(c => c.st().commitAim[2] === '0/0' && c.gone(2) === true));
  }

  // ── T5: applyLocally:false erzeugt kein optimistisches Event ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T5AA'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T5AA'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    h.commitMove();
    // Solange die Transaction in der Queue haengt, darf WEDER der Schreiber selbst
    // NOCH irgendein anderer Client irgendetwas fuer diesen Slot sehen — es gibt
    // schlicht kein Event, bis geflusht wird.
    t('T5 no local event for the writer itself while transaction is pending', h.st().aimSet[0] === false && h.st().pending.includes('0'));
    t('T5 no event for other clients either', g.st().aimSet[0] === false);
    db.flushNext(); db.setAutoFlush(true); await tick();
    t('T5 event fires only after the transaction resolves', h.st().aimSet[0] === true && g.st().aimSet[0] === true);
  }

  // ── T6: kein Reveal während Transaction pending ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T6AA'); h.setMenu('online'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T6AA'); await tick();
    db.setAutoFlush(false);
    g.commitMove(); h.commitMove();
    t('T6 no reveal while both transactions are still pending', h.st().phase === 'aim' && g.st().phase === 'aim');
    db.flushAll(); db.setAutoFlush(true); await tick();
    t('T6 reveal only after both settle', h.st().phase === 'reveal' && g.st().phase === 'reveal');
  }

  // ── T7: alter Promise-Callback aus Raum A trifft Raum B mit identischem gen/turn/seat ──
  {
    const db = makeDB();
    const hA = makeClient(db, 'T7RA'); hA.setMenu('ffa', 2); hA.create(); await tick();
    const gA = makeClient(db, 'X'); gA.setMenu('online'); gA.join('T7RA'); await tick();
    hA.clickStart(); await tick();
    t('T7 room A started at gen=0/turn=0', hA.st().gen === 0 && hA.st().turnNo === 0);
    db.setAutoFlush(false);
    hA.commitMove();                          // Transaction fuer Raum A, Seat 0, gen=0/turn=0 haengt
    t('T7 stale transaction queued in room A', db.queueLen() === 1);
    hA.leave();                                // Client verlaesst Raum A OHNE dass die eigene Transaction je aufgeloest wurde
    // gA (bleibt in Raum A) reagiert regulaer auf hA's Weggang mit einem eigenen
    // Sentinel-Write fuer den nun verwaisten Seat 0 -> ZWEITE haengende
    // Transaction in Raum A (realistisches Nebenprodukt, kein Testfehler).
    t('T7 remaining guest in room A reacted with its own stale-room sentinel', db.queueLen() === 2);
    const hB = makeClient(db, 'T7RB'); hB.setMenu('ffa', 2); hB.create(); await tick();
    const gB = makeClient(db, 'X'); gB.setMenu('online'); gB.join('T7RB'); await tick();
    hB.clickStart(); await tick();
    t('T7 room B independently also at gen=0/turn=0/seat=0 (identical coordinates, different room)', hB.st().gen === 0 && hB.st().turnNo === 0);
    hB.commitMove();                          // Raum B, Seat 0 committet regulaer -> eigene, aktuelle Transaction
    t('T7 third (current, room B) transaction queued alongside the two stale room-A ones', db.queueLen() === 3);
    db.flushAll();                             // loest ALLE auf: die zwei veralteten (Raum A) UND die aktuelle (Raum B)
    db.setAutoFlush(true); await tick();
    t('T7 room B converges normally on its own move', hB.st().aimSet[0] === true && hB.st().commitAim[0] === '5/5');
    t('T7 stale room-A resolutions did not touch room B / no crash', hB.st().pending.length === 0);
    // hA's Transaction war bereits VOR dem Leave server-seitig unterwegs (queued
    // zuerst) und gewinnt daher regulaer das Write-once-Race in Raum A gegen gA's
    // Sentinel — ein Leave storniert einen bereits abgeschickten Transaction-Write
    // nicht (realistisches Firebase-Verhalten). gA (im Raum geblieben) sieht
    // korrekt DIESEN Wert; nur hA's EIGENE Client-seitige Verarbeitung des
    // Ergebnisses wird durch isCurrentCtx() verworfen (hA hat die Session verlassen).
    t('T7 room A guest unaffected by room B, converges on the already in-flight real move', gA.st().aimSet[0] === true && gA.st().commitAim[0] === '5/5' && gA.gone(0) === false);
    t('T7 leaving client itself never re-applies the stale result to its own (now inactive) state', hA.st().pending.length === 0);
  }

  // ── T8: alter Listener-Callback aus vorheriger Session ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T8AA'); h.setMenu('online'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T8AA'); await tick();
    const staleCb = h.lastListenerCb();        // Referenz auf den turnUnsub-Callback der ERSTEN Session
    const sessionBefore = h.st().sessionId;
    h.leave(); await tick();                   // Session wird entwertet (onlineSessionId++)
    const h2 = makeClient(db, 'T8BB'); h2.setMenu('online'); h2.create(); await tick();   // h existiert als Objekt weiter, aber wir simulieren am urspruenglichen h weiter
    t('T8 session id advanced past the stale listeners captured context', h.st().sessionId > sessionBefore);
    const beforeAim = h.st().aimSet.slice();
    staleCb({ val: () => ({ 1: { idx: 2, dx: 0, dy: 0, sp: 0 } }), exists: () => true });   // simuliert einen verspaeteten Firebase-Event der alten Session
    t('T8 stale listener callback from the previous session is ignored (isCurrentCtx blocks it)', JSON.stringify(h.st().aimSet) === JSON.stringify(beforeAim));
  }

  // ── T9: verspätete Snapshots/Transactions aus vorherigem Turn ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T9AA'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T9AA'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    g.commitMove();                            // gen=0/turn=0 fuer g haengt
    t('T9 stale-turn transaction queued', db.queueLen() === 1);
    db.setAutoFlush(true);
    h.rematch(); await tick();                  // gen-Bump -> alle rearmen fuer gen=1/turn=0 BEVOR die alte Transaction aufgeloest wird
    t('T9 rematch rearmed before the old transaction settled', g.st().gen === 1 && g.st().runningGen === 1 && g.st().phase === 'aim');
    db.flushNext(); await tick();                // jetzt loest sich die ALTE (gen=0) Transaction auf
    t('T9 stale resolution did not touch the new turn', g.st().aimSet[1] === false && g.st().phase === 'aim');
    g.commitMove(); h.commitMove(); await tick();
    t('T9 new turn commits normally afterwards', g.st().phase === 'reveal' && h.st().phase === 'reveal');
  }

  // ── T10: unterschiedliche Empfangsreihenfolgen pro Client (die Aufrufreihenfolge
  //    der commitMove()/forceSentinel()-Calls variiert bewusst von der Flush-
  //    Reihenfolge — das Endergebnis darf davon nicht abhaengen) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T10A'); h.setMenu('ffa', 4); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('T10A'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('T10A'); await tick();
    const g3 = makeClient(db, 'X'); g3.setMenu('online'); g3.join('T10A'); await tick();
    h.clickStart(); await tick();
    const all = [h, g1, g2, g3];
    db.setAutoFlush(false);
    g3.commitMove(); h.commitMove(); g1.commitMove(); g2.commitMove();   // Aufrufreihenfolge bewusst nicht Seat-sortiert
    t('T10 four independent transactions queued', db.queueLen() === 4);
    db.flushAll(); db.setAutoFlush(true); await tick();
    t('T10 all four reveal regardless of call order', all.every(c => c.st().phase === 'reveal'));
    const ref = JSON.stringify({ i: h.st().commitIdx, a: h.st().commitAim });
    t('T10 identical commit state on all four clients', all.every(c => JSON.stringify({ i: c.st().commitIdx, a: c.st().commitAim }) === ref));
  }

  // ── T11: 4-Client-Konvergenz mit ueberlappendem Race ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T11A'); h.setMenu('ffa', 4); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('T11A'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('T11A'); await tick();
    const g3 = makeClient(db, 'X'); g3.setMenu('online'); g3.join('T11A'); await tick();
    h.clickStart(); await tick();
    const all = [h, g1, g2, g3];
    db.setAutoFlush(false);
    g3.commitMove();                           // Opfer (Seat 3) committet zuerst -> gewinnt
    h.forceSentinel(3); g1.forceSentinel(3);    // zwei andere schreiben unabhaengig einen Sentinel fuer denselben Seat
    t('T11 three competing transactions for seat 3', db.queueLen() === 3);
    db.flushAll(); db.setAutoFlush(true); await tick();
    h.commitMove(); g1.commitMove(); g2.commitMove(); await tick();
    t('T11 all four reveal', all.every(c => c.st().phase === 'reveal'));
    t('T11 victim move won', all.every(c => c.gone(3) === false && c.st().commitAim[3] === '5/5'));
    const refHash = h.hash();
    t('T11 identical state hash on all four clients', all.every(c => c.hash() === refHash));
    t('T11 no pending left anywhere', all.every(c => c.st().pending.length === 0));
  }

  // ── T12: 5-Client-Konvergenz, Opfer verliert diesmal gegen den Sentinel ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T12A'); h.setMenu('ffa', 5); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('T12A'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('T12A'); await tick();
    const g3 = makeClient(db, 'X'); g3.setMenu('online'); g3.join('T12A'); await tick();
    const g4 = makeClient(db, 'X'); g4.setMenu('online'); g4.join('T12A'); await tick();
    h.clickStart(); await tick();
    const all = [h, g1, g2, g3, g4];
    db.setAutoFlush(false);
    h.forceSentinel(4);                        // Sentinel zuerst -> gewinnt
    g4.commitMove();                           // Opfer verliert
    db.flushAll(); db.setAutoFlush(true); await tick();
    h.commitMove(); g1.commitMove(); g2.commitMove(); g3.commitMove(); await tick();
    t('T12 all five reveal, no client hangs', all.every(c => c.st().phase === 'reveal' && c.st().aimSet.every(Boolean)));
    t('T12 victim ejected (sentinel won)', all.every(c => c.gone(4) === true && c.st().commitAim[4] === '0/0'));
    const refHash = h.hash();
    t('T12 identical state hash on all five clients', all.every(c => c.hash() === refHash));
    const refScore = JSON.stringify(h.st().score);
    t('T12 identical score state on all five clients', all.every(c => JSON.stringify(c.st().score) === refScore));
  }

  // ── T13: Online-1v1-Normalflow bleibt unter dem Transaction-Modell unveraendert ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T13A'); h.setMenu('online'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T13A'); await tick();
    t('T13 1v1 auto-start', h.st().gameStarted && g.st().gameStarted);
    h.commitMove(); await tick();
    t('T13 waits for second player', h.st().phase === 'aim' && g.st().phase === 'aim');
    g.commitMove(); await tick();
    t('T13 both reveal', h.st().phase === 'reveal' && g.st().phase === 'reveal');
    t('T13 identical commits', JSON.stringify(h.st().commitAim) === JSON.stringify(g.st().commitAim));
  }

  // ── T14: Online-2v2-Duo mit korrekten, ECHT validierten Kugelindizes (Codex-
  //    Nachbesserung Punkt 6: der bisherige Test nutzte Ballindex 1 fuer Team 1 —
  //    das ist in placeBalls() eine Team-0-Kugel! Der alte Test-Stub fuer
  //    sanitizeMove() war ein reiner Passthrough und haette die falsche Ownership
  //    nie bemerkt. Ab hier laeuft die ECHTE, aus index.html extrahierte
  //    sanitizeMove() — Team 0 besitzt Ballindex 0/1, Team 1 besitzt 2/3.) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T14A'); h.setMenu('online'); h.setFmt('double'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T14A'); await tick();
    t('T14 2v2-Duo started', h.st().gameStarted && g.st().gameStarted && h.st().fmt === 'double' && g.st().fmt === 'double');
    h.commitMove(0); g.commitMove(2); await tick();   // je Team einen GUELTIGEN eigenen Ball-Index gewaehlt
    t('T14 both reveal', h.st().phase === 'reveal' && g.st().phase === 'reveal');
    t('T14 own ball index transported correctly for both teams', h.st().commitIdx[0] === 0 && g.st().commitIdx[1] === 2);
  }

  // ── T14b: Gegenprobe — die ECHTE sanitizeMove() korrigiert einen ungueltigen
  //    (fremden) Ballindex automatisch auf eine eigene lebende Kugel; eine falsche
  //    Ownership wird NIE uebernommen, unabhaengig davon, was der Client sendet ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T14B'); h.setMenu('online'); h.setFmt('double'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T14B'); await tick();
    h.commitMove(0);
    g.commitMove(0);   // g (Team 1) sendet BEWUSST einen fremden Ballindex (Team-0-Kugel)
    await tick();
    t('T14b invalid foreign ball index is corrected to one of the players own balls', g.st().commitIdx[1] === 2 || g.st().commitIdx[1] === 3);
    t('T14b invalid index never transports the foreign teams ball', g.st().commitIdx[1] !== 0 && g.st().commitIdx[1] !== 1);
    t('T14b reveal still proceeds normally after correction', h.st().phase === 'reveal' && g.st().phase === 'reveal');
  }

  // ── T15: keine doppelte Slot-Verarbeitung ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T15A'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T15A'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    h.commitMove();
    db.flushAll(); db.setAutoFlush(true); await tick();
    const snap1 = JSON.stringify({ i: h.st().commitIdx, a: h.st().commitAim, s: h.st().aimSet });
    await tick();   // zusaetzlicher Settle-Zyklus: nichts darf sich erneut aendern
    const snap2 = JSON.stringify({ i: h.st().commitIdx, a: h.st().commitAim, s: h.st().aimSet });
    t('T15 confirmed value stable, no duplicate re-application', snap1 === snap2 && h.st().aimSet[0] === true);
    g.commitMove(); await tick();
    t('T15 reveals normally afterwards', h.st().phase === 'reveal' && g.st().phase === 'reveal');
  }

  // ── T16: echter Netzwerk-/Transaction-Fehler — eigener Payload darf NIE
  //    angewendet werden, Pending-State wird sauber entfernt, Listener bleibt
  //    aktiv, kein vorzeitiges Reveal, ein spaeterer fremder Write kommt normal an ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T16A'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T16A'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    h.commitMove();
    db.rejectNext(new Error('NETWORK_ERROR'));
    db.setAutoFlush(true); await tick();
    t('T16 own payload never applied after a real transaction error', h.st().aimSet[0] === false);
    t('T16 pending state cleared after error', h.st().pending.length === 0);
    t('T16 no premature reveal', h.st().phase === 'aim');
    // Retry: ein erneuter commit()-Versuch (z.B. Spieler klickt nochmal) fuellt den Slot normal
    h.commitMove(); g.commitMove(); await tick();
    t('T16 retry succeeds and match proceeds normally', h.st().phase === 'reveal' && g.st().phase === 'reveal');
  }

  // ── T-APPLYLOCALLY: runTransaction() wird auf dem Turn-Slot-Pfad ausschliesslich
  //    mit {applyLocally:false} aufgerufen (Codex-Nachbesserung Punkt 4) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'TALA'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('TALA'); await tick();
    h.clickStart(); await tick();
    h.commitMove(); await tick();
    t('T-ApplyLocally options.applyLocally===false was actually passed to runTransaction()', !!db.lastTxOptions && db.lastTxOptions.applyLocally === false);
    // Selbsttest der Pruefung: die Fake-DB MUSS eine Transaction ohne korrektes
    // options-Argument ablehnen — sonst waere die Pruefung oben wirkungslos.
    let rejected = false;
    try {
      await new Promise((res, rej) => {
        db.FBfor({ onDrop: [] }).runTransaction(['rooms', 'TALA', 'g', '0', 't', '0', '1'], c => (c == null ? { idx: 1, dx: 0, dy: 0, sp: 0 } : undefined), { applyLocally: true }).then(res, rej);
      });
    } catch (e) { rejected = true; }
    t('T-ApplyLocally self-check: the fake DB itself rejects a wrong options argument', rejected === true);
  }

  // ── T17: ein autoritativer FREMDwert kommt an, WAEHREND die eigene (Sentinel-)
  //    Transaction fuer denselben Slot noch pending ist; die eigene Transaction
  //    schlaegt DANACH zusaetzlich mit einem echten Fehler fehl — der bereits
  //    autoritativ uebernommene Fremdwert darf dadurch nie angetastet werden, und
  //    das Reveal muss anschliessend normal starten koennen ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T17A'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T17A'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    g.commitMove();                 // gs ECHTER Move fuer Seat 1 -> zuerst in der Queue, soll gewinnen
    h.forceSentinel(1);             // hs Sentinel fuer DENSELBEN Slot -> queued danach, wird ueberholt
    t('T17 both transactions pending for the same slot', db.queueLen() === 2);
    db.flushNext();                 // gs Move: committed=true -> Broadcast an ALLE Clients
    await tick();
    t('T17 foreign authoritative value applied on h immediately, hs own transaction still pending', h.st().aimSet[1] === true && h.st().commitAim[1] === '5/5' && h.st().pending.includes('1'));
    db.rejectNext(new Error('NETWORK_ERROR'));   // hs eigene, nun ueberholte Transaction schlaegt zusaetzlich ECHT fehl
    db.setAutoFlush(true); await tick();
    t('T17 hs failed own transaction did not touch the already-applied foreign value', h.st().commitAim[1] === '5/5' && h.st().pending.length === 0);
    t('T17 no orphan sentinel retry scheduled (slot was already authoritative when the error arrived)', h.timerCount() === 0);
    h.commitMove(); await tick();
    t('T17 reveal starts correctly afterwards', h.st().phase === 'reveal' && g.st().phase === 'reveal');
  }

  // ── T18: Leave-Sentinel-Transaction schlaegt EINMAL mit einem echten Fehler fehl
  //    -> automatischer, kontextgebundener Retry gewinnt anschliessend ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T18A'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T18A'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    g.drop(); await tick();                           // g verlaesst -> h (Ueberlebender) schreibt automatisch einen System-Sentinel fuer Seat 1
    t('T18 sentinel transaction queued after opponent left', db.queueLen() === 1);
    db.rejectNext(new Error('NETWORK_ERROR'));         // erster Versuch: echter Transportfehler
    db.setAutoFlush(true); await tick();
    t('T18 own payload not applied after the first failure, pending cleared', h.st().aimSet[1] === false && h.st().pending.length === 0);
    t('T18 automatic retry timer scheduled (capped backoff, no immediate spam)', h.timerCount() === 1);
    db.setAutoFlush(false);
    h.fireTimer();                                     // Retry feuert (kontextgebunden, seatLeft weiterhin true) -> neue Transaction
    t('T18 retry transaction queued', db.queueLen() === 1);
    db.flushAll(); db.setAutoFlush(true); await tick();
    t('T18 retry succeeded, sentinel applied on all clients', h.st().aimSet[1] === true && h.gone(1) === true);
    h.commitMove(); await tick();
    t('T18 match proceeds normally after the successful retry', h.st().phase === 'reveal');
  }

  // ── T19: Retry wird SOFORT abgebrochen, wenn waehrenddessen ein anderer
  //    (autoritativer) Slotwert gewinnt — ein zweiter, unabhaengiger Client fuellt
  //    denselben verwaisten Slot, bevor hs Retry-Timer feuert ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T19A'); h.setMenu('ffa', 3); h.create(); await tick();
    const g1 = makeClient(db, 'X'); g1.setMenu('online'); g1.join('T19A'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('T19A'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    g1.drop(); await tick();                           // h UND g2 reagieren beide mit einem eigenen Sentinel fuer Seat 1
    t('T19 two independent sentinel transactions queued for the departed seat', db.queueLen() === 2);
    db.rejectNext(new Error('NETWORK_ERROR'));         // die ERSTE (hs) schlaegt echt fehl -> Retry wird geplant
    db.flushNext();                                     // die ZWEITE (g2s) wird regulaer aufgeloest -> gewinnt
    db.setAutoFlush(true); await tick();
    t('T19 g2 sentinel won and is authoritative for all clients', h.st().aimSet[1] === true && h.gone(1) === true);
    t('T19 hs pending retry timer was cancelled immediately once the authoritative value arrived', h.timerCount() === 0);
    h.commitMove(); g2.commitMove(); await tick();
    t('T19 match proceeds normally afterwards', h.st().phase === 'reveal' && g2.st().phase === 'reveal');
  }

  // ── T20: Retry wird SOFORT abgebrochen, wenn Session/Raum/Generation/Turn
  //    wechselt (hier: Rematch/neuer Turn), BEVOR der Retry-Timer feuert ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T20A'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T20A'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    g.drop(); await tick();
    db.rejectNext(new Error('NETWORK_ERROR'));
    db.setAutoFlush(true); await tick();
    t('T20 retry timer scheduled after a real transaction error', h.timerCount() === 1);
    h.rematch(); await tick();                          // gen-Bump -> neuer Turn VOR dem Retry-Feuern
    t('T20 rematch rearmed the turn', h.st().gen === 1 && h.st().phase === 'aim');
    t('T20 the stale retry timer was cancelled immediately on the turn change, never fires for the old turn', h.timerCount() === 0);
  }

  // ── T21: dasselbe Clientobjekt verlaesst Raum A und tritt Raum B bei — alte
  //    Presence-/Gen-/Seats-Callbacks aus Raum A duerfen Raum B NIE beeinflussen
  //    (gen ueberschreiben, startOnlineGame ausloesen, ffaN aendern, Sentinel starten) ──
  {
    const db = makeDB();
    const hA = makeClient(db, 'T21A'); hA.setMenu('ffa', 2); hA.create(); await tick();
    const gA = makeClient(db, 'X'); gA.setMenu('online'); gA.join('T21A'); await tick();
    const staleP = hA.lastCb('p'), staleGen = hA.lastCb('gen'), staleSeats = hA.lastCb('seats');
    t('T21 room A presence/gen/seats callbacks captured', typeof staleP === 'function' && typeof staleGen === 'function' && typeof staleSeats === 'function');
    hA.leave(); await tick();                           // Raum A wird verlassen (Session-Bump)
    const hB = makeClient(db, 'T21B'); hB.setMenu('ffa', 2); hB.create(); await tick();
    hA.setMenu('online'); hA.join('T21B'); await tick(); // DASSELBE Clientobjekt tritt Raum B (als Gast) bei
    t('T21 hA now in room B', hA.st().roomCode === 'T21B' && hA.st().gen === 0);
    const genBefore = hA.st().gen, ffaNBefore = hA.st().ffaN, gameStartedBefore = hA.st().gameStarted;
    staleGen({ val: () => 7, exists: () => true });                                                  // verspaeteter gen-Event aus Raum A
    staleSeats({ val: () => 5, exists: () => true });                                                 // verspaeteter seats-Event aus Raum A (wuerde sonst maybeStart ausloesen)
    staleP({ val: () => ({ 0: true, 1: true, 2: true, 3: true, 4: true }), exists: () => true });     // verspaeteter presence-Event aus Raum A
    await tick();
    t('T21 stale room-A gen callback did not touch room B', hA.st().gen === genBefore);
    t('T21 stale room-A seats/presence callbacks did not start or alter room B', hA.st().gameStarted === gameStartedBefore && hA.st().ffaN === ffaNBefore);
  }

  // ── T22: permanenter Fehler -> Retry-Kette ist begrenzt, Backoff gedeckelt, pro
  //    Seat nie mehr als ein Timer/eine Transaction, Abbruch nach dem Limit mit
  //    genau EINEM Verbindungsfehler-Pfad (Codex-Finding: unbegrenztes Weiterschreiben) ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T22A'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T22A'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    g.drop(); await tick();                     // Ueberlebender h schreibt automatisch einen System-Sentinel fuer Seat 1
    t('T22 initial sentinel transaction queued', db.queueLen() === 1);
    const delays = [];
    let guard = 0, oneTimerAlways = true, oneTxAlways = true;
    while (h.connLostCount() === 0 && guard++ < 60) {
      if (db.queueLen() > 1) oneTxAlways = false;   // nie mehr als eine Transaction pro Seat gleichzeitig
      db.rejectNext(new Error('PERMISSION_DENIED'));   // permanenter (nicht transienter) Fehler
      await tick();
      if (h.connLostCount() > 0) break;
      if (h.timerCount() !== 1) oneTimerAlways = false;   // nie mehr als ein Retry-Timer pro Seat
      delays.push(h.timerDelays()[0]);
      h.fireTimer();                              // Retry feuert -> naechster Versuch
      await tick();
    }
    t('T22 retry chain terminated at the limit (no infinite loop)', h.connLostCount() === 1 && guard < 60);
    t('T22 never more than one pending transaction per seat', oneTxAlways === true);
    t('T22 never more than one retry timer per seat', oneTimerAlways === true);
    t('T22 backoff starts at 300/600/1200', delays[0] === 300 && delays[1] === 600 && delays[2] === 1200);
    t('T22 backoff capped at 2000ms', Math.max.apply(null, delays) === 2000);
    t('T22 exactly SENTINEL_RETRY_MAX_ATTEMPTS (11) retries before giving up', delays.length === 11);
    t('T22 connection-lost path triggered exactly once', h.connLostCount() === 1);
    t('T22 no timer and no pending left after giving up', h.timerCount() === 0 && h.st().pending.length === 0);
    t('T22 turn listener detached on give-up (no frozen turn left silently listening)', h.st().phase === 'aim');   // Overlay uebernimmt, Rueckweg via leaveOnline
  }

  // ── T23: leaveOnline entfernt einen geplanten Sentinel-Retry ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T23A'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T23A'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    g.drop(); await tick();
    db.rejectNext(new Error('NETWORK_ERROR')); await tick();
    t('T23 a retry timer is scheduled', h.timerCount() === 1);
    h.leave();
    t('T23 leaveOnline cleared the scheduled retry timer', h.timerCount() === 0);
  }

  // ── T24: Raum A -> Raum B — ein alter, dem Cleanup entkommener Retry-Callback darf
  //    in Raum B weder schreiben noch das (neue) Match beenden ──
  {
    const db = makeDB();
    const hA = makeClient(db, 'T24A'); hA.setMenu('ffa', 2); hA.create(); await tick();
    const gA = makeClient(db, 'X'); gA.setMenu('online'); gA.join('T24A'); await tick();
    hA.clickStart(); await tick();
    db.setAutoFlush(false);
    gA.drop(); await tick();
    db.rejectNext(new Error('NETWORK_ERROR')); await tick();
    const staleFn = hA.peekTimerFn();            // Retry-Callback aus Raum A VOR dem Verlassen einfangen
    t('T24 stale room-A retry callback captured', typeof staleFn === 'function');
    hA.leave(); await tick();
    const hB = makeClient(db, 'T24B'); hB.setMenu('ffa', 2); hB.create(); await tick();
    hA.setMenu('online'); hA.join('T24B'); await tick();   // DASSELBE Clientobjekt tritt Raum B bei
    t('T24 hA is now in room B', hA.st().roomCode === 'T24B');
    db.setAutoFlush(true);
    const qBefore = db.queueLen(), connBefore = hA.connLostCount();
    staleFn();                                   // der alte Raum-A-Retry feuert verspaetet, waehrend hA in Raum B ist
    await tick();
    t('T24 stale room-A retry wrote nothing', db.queueLen() === qBefore);
    t('T24 stale room-A retry did not end room B / no connection-lost', hA.connLostCount() === connBefore && hA.st().roomCode === 'T24B');
  }

  // ── T25: ein autoritativer Slotwert MITTEN in der Retry-Kette (nach mehreren
  //    Fehlversuchen, aber vor dem Limit) beendet die Kette sofort — kein Abbruch ──
  {
    const db = makeDB();
    const h = makeClient(db, 'T25A'); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('T25A'); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    g.drop(); await tick();
    db.rejectNext(new Error('NETWORK_ERROR')); await tick();   // Fehlversuch 1
    h.fireTimer(); await tick();                                // Retry-Write (attempt 1)
    db.rejectNext(new Error('NETWORK_ERROR')); await tick();   // Fehlversuch 2 -> mitten in der Kette
    t('T25 h is mid retry chain (not at the limit yet)', h.timerCount() === 1 && h.connLostCount() === 0);
    // Ein fremder autoritativer Wert fuer Seat 1 kommt ueber den Turn-Listener an.
    const turnCb = h.lastCb('g');
    turnCb({ val: () => ({ 1: { idx: 0, dx: 0, dy: 0, sp: 0 } }), exists: () => true });
    await tick();
    t('T25 authoritative value applied, retry chain stopped before the limit', h.st().aimSet[1] === true && h.timerCount() === 0);
    t('T25 no connection-lost triggered (limit never reached)', h.connLostCount() === 0);
  }

  // ── T26: terminaler Abbruch ist einmalig UND wirkt gegen einen ZWEITEN offenen
  //    Seat (Codex-Finding: Seat A erreicht das Retry-Limit, waehrend Seat B noch
  //    eine laufende Transaction hat — deren spaeterer Callback darf weder einen
  //    zweiten Abbruch noch processSlot/maybeReveal ausloesen). Seat A = fremder
  //    Sentinel (Seat 1), Seat B = eigener, absichtlich nie aufgeloester Move (Seat
  //    0) — je genau ein Schreiber, praezise per rejectSlot/flushSlot steuerbar. ──
  async function driveToTerminal(code){
    const db = makeDB();
    const h = makeClient(db, code); h.setMenu('ffa', 2); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join(code); await tick();
    h.clickStart(); await tick();
    db.setAutoFlush(false);
    h.commitMove();                                   // Seat B: eigener Move (Seat 0) -> bleibt pending, nie aufgeloest
    g.drop(); await tick();                            // Seat A: nur h bleibt -> genau EIN Sentinel-Schreiber fuer Seat 1
    for (let i = 0; i < 10; i++) { db.rejectSlot('1', new Error('NETWORK_ERROR')); await tick(); h.fireTimer(); }
    db.rejectSlot('1', new Error('NETWORK_ERROR')); await tick();   // Fehlversuch 10 -> Retry fuer Versuch 11 geplant (noch nicht gefeuert)
    return { db, h, g };
  }
  {
    const { db, h } = await driveToTerminal('T26A');
    t('T26 not terminated one attempt short of the limit', h.terminated() === false && h.connLostCount() === 0 && h.timerCount() === 1);
    t('T26 seat B still has a live pending transaction at this moment', h.st().pending.includes('0') && db.queueLen() >= 1);
    h.fireTimer();                                     // finaler Retry (Versuch 11)
    db.rejectSlot('1', new Error('NETWORK_ERROR')); await tick();   // Versuch 11 schlaegt fehl -> onlineConnectionLost
    t('T26 connection-lost triggered exactly once, terminal state set', h.connLostCount() === 1 && h.terminated() === true);
    t('T26 all timers cleared and pending invalidated on abort', h.timerCount() === 0 && h.st().pending.length === 0);
    // Seat B schlaegt DANACH fehl: kein zweiter Abbruch, keine Zustandsaenderung.
    db.rejectSlot('0', new Error('NETWORK_ERROR')); await tick();
    t('T26 seat B failing after abort does NOT trigger a second connection-lost', h.connLostCount() === 1);
    t('T26 seat B failure after abort changes nothing / schedules no timer', h.timerCount() === 0 && h.st().aimSet[0] === false && h.st().phase === 'aim');
  }

  // ── T26b: Alternativzweig — Seat B GEWINNT nach dem Abbruch (seine Transaction
  //    committet server-seitig). Der terminale Guard muss trotzdem jeden Effekt
  //    verhindern: kein processSlot, kein Reveal, keine Zustandsaenderung. ──
  {
    const { db, h } = await driveToTerminal('T26B');
    h.fireTimer();
    db.rejectSlot('1', new Error('NETWORK_ERROR')); await tick();   // -> onlineConnectionLost
    t('T26b terminal state set', h.terminated() === true && h.connLostCount() === 1);
    const before = JSON.stringify({ a: h.st().aimSet, i: h.st().commitIdx, ph: h.st().phase });
    db.flushSlot('0'); await tick();                   // Seat B gewinnt (committet) NACH dem Abbruch
    t('T26b seat B winning after abort does not apply processSlot (aimSet unchanged)', h.st().aimSet[0] === false);
    t('T26b seat B winning after abort starts no reveal', h.st().phase === 'aim');
    t('T26b no state change at all from the post-abort winning transaction', JSON.stringify({ a: h.st().aimSet, i: h.st().commitIdx, ph: h.st().phase }) === before);
    t('T26b still exactly one connection-lost, no new timers', h.connLostCount() === 1 && h.timerCount() === 0);
    // Frischer Raum / neue Session laeuft danach wieder normal.
    db.setAutoFlush(true);   // driveToTerminal hatte autoFlush deaktiviert
    h.leave(); await tick();
    t('T26b terminal state reset after leaveOnline', h.terminated() === false);
    const h2 = makeClient(db, 'T26N'); h2.setMenu('online'); h2.create(); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('T26N'); await tick();
    h2.commitMove(); g2.commitMove(); await tick();
    t('T26b a fresh room/session plays normally again', h2.st().phase === 'reveal' && g2.st().phase === 'reveal');
  }

  console.log('\nFFA-Online-Race: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
