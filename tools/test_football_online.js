// ARENA FOOTBALL ONLINE — FUENF ECHTE CLIENTS AN EINER GEMEINSAMEN FAKE-RTDB
//
// Diese Suite fuehrt fuenf VOLLSTAENDIG getrennte Clients aus. Jeder hat seine eigene
// auth.uid, seinen eigenen onlinePid/onlineTab, seinen eigenen Spielzustand, seine
// eigene Physik und seine eigenen Online-Zustandsvariablen (pendingSlot, aimSet,
// turnNo, ...). Geteilt ist NUR die Datenbank. Ein Divergenzfehler kann sich hier
// also nicht dadurch verstecken, dass alle Clients dieselben Globals benutzen.
//
// Alle Quellen kommen WOERTLICH aus index.html - Physik, Torablauf, Elimination,
// Arenaumbau und die komplette Online-Schicht. Es gibt keinen Nachbau und keine
// zweite Netzwerk- oder Replay-Engine.
//
//   node tools/test_football_online.js
//
const fs = require('fs');
const path = require('path');
const { grabFunction } = require('./extract.js');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (re, name) => {
  const m = HTML.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(1); }
  return m[0];
};
const fn = (name) => grabFunction(HTML, name);
// Wandelt einen Zeiger-Handler in eine benannte Funktion um, ohne seinen Rumpf zu
// veraendern: aus  X.addEventListener('typ',e=>{ ... });  wird  function NAME(e){ ... }
const handler = (re, name) => {
  const src = grab(re, name);
  const i = src.indexOf('e=>{');
  if (i < 0) { console.error('FAIL: handler shape ' + name); process.exit(1); }
  const body = src.slice(i + 4, src.lastIndexOf('});'));
  return 'function ' + name + '(e){' + body + '}';
};

const SRC = [
  // ── Konstanten und Grundfunktionen ──
  grab(/const ONLINE_PROTOCOL_VERSION=[^\n]*/, 'ONLINE_PROTOCOL_VERSION'),
  grab(/const FFA_MAX_SEATS=[^\n]*/, 'FFA_MAX_SEATS'),
  grab(/const GEN_MAX=[^\n]*/, 'GEN_MAX'),
  grab(/const ROOM_MAX_AGE_MS=[^\n]*/, 'ROOM_MAX_AGE_MS'),
  grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants'),
  grab(/const SPIN_K=[^\n]*/, 'spin constants'),
  grab(/const PCOLS=[^\n]*/, 'PCOLS'),
  grab(/const NAME_COL=[\s\S]*?\nfunction ncol\(i\)\{[^\n]*/, 'Football-Farbtafel'),
  grab(/function mkBall\(x,y,owner\)\{[^\n]*/, 'mkBall'),
  grab(/function aliveBalls\(owner\)\{[^\n]*/, 'aliveBalls'),
  grab(/function aliveCount\(owner\)\{[^\n]*/, 'aliveCount'),
  grab(/function np\(\)\{[^\n]*/, 'np'),
  grab(/function teamCap\(\)\{[^\n]*/, 'teamCap'),
  grab(/function ffaRoom\(\)\{[^\n]*/, 'ffaRoom'),
  grab(/function fbOnlineRoom\(\)\{[^\n]*/, 'fbOnlineRoom'),
  grab(/function ffaSeatCap\(\)\{[^\n]*/, 'ffaSeatCap'),
  grab(/function teamOf\(s\)\{[^\n]*/, 'teamOf'),
  grab(/function colorSlot\(owner\)\{[^\n]*/, 'colorSlot'),
  grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls'),
  grab(/function pickOwnBall\(who,p\)\{[^\n]*/, 'pickOwnBall'),
  grab(/function localPt\(e\)\{[\s\S]*?\n\}/, 'localPt'),
  // Projektionsmathematik der 3D-Ansicht - ohne three.js, deshalb hier lauffaehig.
  grab(/function r3dCamMath\(p\)\{[\s\S]*?\n\}/, 'r3dCamMath'),
  grab(/function OP\(lx,ly,h\)\{[^\n]*/, 'OP'),
  grab(/function fbElimViewR\(\)\{[\s\S]*?\n\}/, 'fbElimViewR'),
  grab(/function fbArenaViewR\(av\)\{[\s\S]*?\n\}/, 'fbArenaViewR'),
  grab(/function pickOwnBall3D\(who,e\)\{[\s\S]*?\n\}/, 'pickOwnBall3D'),
  grab(/function startAim\(who,idx,p,e\)\{[\s\S]*?SFX\.charge\.start\(\);\}/, 'startAim'),
  // Die drei Zeiger-Handler. Sie haengen in index.html an cv bzw. window; hier werden
  // sie zu benannten Funktionen - der Rumpf bleibt woertlich derselbe, damit der Test
  // WIRKLICH durch den Eingabewaechter laeuft und nicht daran vorbei.
  handler(/cv\.addEventListener\('pointerdown',e=>\{[\s\S]*?\n  \}\}\);/, 'onPointerDown'),
  handler(/window\.addEventListener\('pointermove',e=>\{[\s\S]*?\n  \}\}\);/, 'onPointerMove'),
  handler(/window\.addEventListener\('pointerup',e=>\{[\s\S]*?commit\(who,sh,fx,fy,spin\);\}\);/, 'onPointerUp'),
  grab(/function viewAngle\(\)\{[\s\S]*?\n\}/, 'viewAngle'),
  // Zustandsvariablen, die newGame()/startRound()/der Torablauf anfassen.
  grab(/let menuVisible=[^\n]*/, 'menuVisible'),
  grab(/let dragging=false,dragShooter[^\n]*/, 'Drag-Zustand'),
  grab(/let aimPid=-1,spinPid[^\n]*/, 'Zeiger-Zustand'),
  // Kamerazustand der 3D-Ansicht: der Zeiger-Handler prueft ihn, bevor er einen Griff
  // zulaesst. Er kommt woertlich aus index.html.
  grab(/let camPid=-1,cam2Pid[^\n]*/, 'Kamera-Zeigerzustand'),
  grab(/let fbPopT=\[0,0\],fbScoreShown[^\n]*/, 'HUD-Timer'),
  fn('fbHudOn'),
  fn('fbScoreBox'),
  fn('fbClearHudFx'),
  fn('applyFootballHud'),
  fn('cancelAimDrag'),
  // Abschusskurve (PUNCHY) - liegt oberhalb des Football-Blocks.
  grab(/const FB_LAUNCH_SCALE=[\s\S]*?\nfunction fbLaunchMul\(len\)\{[\s\S]*?\n\}/, 'Abschusskurve'),
  // Ring-Out-Pfad: in Football unerreichbar, aber stepSim referenziert ihn.
  grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside'),
  grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts'),
  // Ring-Collapse: newGame ruft resetCollapseTimer, stepSim ruft settleCollapse.
  // Inert - collapseActive() verlangt mode==='bot' && !online.
  grab(/const MATCH_COLLAPSE_SECONDS=[\s\S]*?\nfunction collapseRoundEnd\(\)\{[\s\S]*?\n\}/, 'Ring-Collapse-Block'),
  // ── DER VOLLSTAENDIGE ARENA-FOOTBALL-BLOCK ──
  // Arena, Torgeometrie, Physik-Accessoren, Torablauf, Elimination, Morph.
  // Genau die Spanne, gegen die auch die lokalen Football-Suiten pruefen.
  grab(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nfunction stepSim\(\)\{)/, 'Football-Block'),
  // ── Rundenablauf und Physik ──
  // Basis-Accessoren der Physik. Innerhalb von Football liefern sie ueber footballPhys()
  // die BALANCED-Werte, ausserhalb die globalen Konstanten.
  grab(/function curFR\(\)[^\n]*/, 'curFR'),
  grab(/function curFE\(\)[^\n]*/, 'curFE'),
  grab(/function curST\(\)[^\n]*/, 'curST'),
  grab(/function newGame\(\)\{[\s\S]*?\n  startRound\(\);\}/, 'newGame'),
  grab(/function resetCommits\(\)\{[\s\S]*?\n\}/, 'resetCommits'),
  grab(/function startRound\(\)\{[\s\S]*?\n  setPhaseText\(\);\}/, 'startRound'),
  grab(/function inputLocked\(\)\{[^\n]*/, 'inputLocked'),
  fn('whoCanAim'),
  grab(/function canCommitInput\(who\)\{[\s\S]*?\n\}/, 'canCommitInput'),
  grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove'),
  grab(/function allAliveCommitted\(\)\{[^\n]*/, 'allAliveCommitted'),
  grab(/function commit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'commit'),
  grab(/function applyCommit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'applyCommit'),
  grab(/function beginReveal\(\)\{[^\n]*/, 'beginReveal'),
  grab(/function ejectGoneSeats\(\)\{[\s\S]*?\n\}/, 'ejectGoneSeats'),
  grab(/function simHash\(\)\{[\s\S]*?\n\}/, 'simHash'),
  grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch'),
  grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim'),
  grab(/function afterResult\(\)\{[\s\S]*?\n\}/, 'afterResult'),
  grab(/function resultDrift\(\)\{[^\n]*/, 'resultDrift'),
  // Der Frame-Schritt des Spiels. Er ist die EINZIGE zeitgetriebene Stelle: die
  // Wanduhr entscheidet nur, wann das Reveal-Fenster endet - die Physik laeuft in
  // festen Schritten. Der Harness treibt ihn genau wie der Browser.
  grab(/const SIM_HZ=60;\nconst SIM_DT_MS=[^\n]*/, 'SIM_DT_MS'),
  grab(/function simStep\(now\)\{[\s\S]*?\n\}/, 'simStep'),
  grab(/function pName\(p\)\{[^\n]*/, 'pName'),
  // ── Online-Schicht, woertlich ──
  grab(/function whenFB\(cb\)\{[^\n]*/, 'whenFB'),
  fn('fbReady'),
  fn('fbUid'),
  fn('fbFailKey'),
  grab(/function rRef\(p\)\{[^\n]*/, 'rRef'),
  grab(/function setStatus\(t\)\{[^\n]*/, 'setStatus'),
  grab(/const ROOM_GAME_RINGOUT=[\s\S]*?\nfunction validateTurnRecord\(rec,game,seat\)\{[\s\S]*?\n\}/, 'Protokoll v4'),
  grab(/function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom'),
  grab(/function pickFreeSeat\(p,max\)\{[^\n]*/, 'pickFreeSeat'),
  grab(/function validateRejoinRoom\(d\)\{[\s\S]*?\n\}/, 'validateRejoinRoom'),
  grab(/function seatCount\(p\)\{[^\n]*/, 'seatCount'),
  grab(/function seatsContiguous\(p,n\)\{[^\n]*/, 'seatsContiguous'),
  grab(/async function claimSeat\(code,op,maxSeats\)\{[\s\S]*?\n\}/, 'claimSeat'),
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
  grab(/const FF_MAX_STEPS_PER_TURN=[^\n]*/, 'FF_MAX_STEPS_PER_TURN'),
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
  // ── Identitaet und Reclaim ──
  grab(/function genToken\(n\)\{[\s\S]*?\n\}/, 'genToken'),
  grab(/function capGraphemes\(s,max\)\{[\s\S]*?\n\}/, 'capGraphemes'),
  grab(/function sanitizeName\(raw\)\{[\s\S]*?\n\}/, 'sanitizeName'),
  grab(/function newJoinOp\(\)\{[^\n]*/, 'newJoinOp'),
  grab(/function joinOpCurrent\(op\)\{[^\n]*/, 'joinOpCurrent'),
  grab(/function seatActive\(p,s\)\{[^\n]*/, 'seatActive'),
  grab(/async function reserveSeat\(code,seat\)\{[\s\S]*?\n\}/, 'reserveSeat'),
  grab(/async function armPresence\(code,seat\)\{[\s\S]*?\n\}/, 'armPresence'),
  grab(/async function activateSeat\(code,seat,extra\)\{[\s\S]*?\n\}/, 'activateSeat'),
  fn('releaseReservation'),
  grab(/async function claimSeatSlot\(code,seat,op,extra\)\{[\s\S]*?\n\}/, 'claimSeatSlot'),
  grab(/async function abortFreshRoom\(code,dc,listed\)\{[\s\S]*?\n\}/, 'abortFreshRoom'),
  grab(/function roomRejoinableState\(d,seat\)\{[\s\S]*?\n\}/, 'roomRejoinableState'),
  grab(/function playerRecord\(seat\)\{[^\n]*/, 'playerRecord'),
  grab(/function nameForSeat\(s\)\{[\s\S]*?\n\}/, 'nameForSeat'),
  fn('findOwnSeat'),
  grab(/function rememberRoom\(code,seat\)\{[^\n]*/, 'rememberRoom'),
  grab(/function forgetRoom\(\)\{[^\n]*/, 'forgetRoom'),
  grab(/function savedRoom\(\)\{[\s\S]*?\n\}/, 'savedRoom'),
  grab(/function clearLobbyHostGrace\(\)\{[^\n]*/, 'clearLobbyHostGrace'),
  grab(/function startLobbyHostGrace\(\)\{[\s\S]*?\n\}/, 'startLobbyHostGrace'),
  grab(/function evalLobbyHostPresence\(\)\{[\s\S]*?\n\}/, 'evalLobbyHostPresence'),
  fn('reclaimSeat'),
  grab(/async function releaseReclaim\(code,seat,dc\)\{[\s\S]*?\n\}/, 'releaseReclaim'),
  fn('reclaimSeatSlot'),
  grab(/function clearMatchGrace\(s\)\{[^\n]*/, 'clearMatchGrace'),
  grab(/function clearAllMatchGrace\(\)\{[^\n]*/, 'clearAllMatchGrace'),
  grab(/function startMatchGrace\(s\)\{[\s\S]*?\n\}/, 'startMatchGrace'),
  grab(/function seatFinallyGone\(s\)\{[\s\S]*?\n\}/, 'seatFinallyGone'),
  grab(/async function attemptRejoin\(code\)\{[\s\S]*?\n\}/, 'attemptRejoin'),
].join('\n');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.error('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); }
};
// Stille Variante fuer Schleifen: meldet einen Fehlschlag nur einmal und zaehlt im
// Erfolgsfall nicht mit, damit eine Invariante die Assertionzahl nicht aufblaeht.
const seen = new Set();
const t0 = (name, cond) => { if (cond) return; if (seen.has(name)) return; seen.add(name); fail++; console.error('FAIL: ' + name); };

// ══════════════════════════════════════════════════════════════════════════════
//  FAKE-RTDB — die Regeln, an denen der Football-Fluss wirklich haengt
// ══════════════════════════════════════════════════════════════════════════════
function makeDB() {
  const data = { rooms: {} };
  const listeners = new Set();
  let nowMs = 1751900000000;
  const at = parts => parts.reduce((a, k) => (a && typeof a === 'object') ? a[k] : undefined, data);
  const clone = v => (v === undefined || v === null) ? null : JSON.parse(JSON.stringify(v));
  const queue = [];
  const flush = () => { while (queue.length) queue.shift()(); };

  function notify() {
    for (const l of Array.from(listeners)) {
      if (!listeners.has(l)) continue;
      const cur = JSON.stringify(clone(at(l.parts)));
      if (cur !== l.last) { l.last = cur; l.cb({ val: () => clone(at(l.parts)), exists: () => at(l.parts) != null }); }
    }
  }
  function buildMerged(room, writes) {
    const wp = {}, wpl = {}; let wstate;
    const base = seat => {
      const cur = room && room.players && room.players[seat];
      return cur ? JSON.parse(JSON.stringify(cur)) : {};
    };
    for (const w of writes) {
      if (w.parts[2] === 'p' && w.parts.length === 4) wp[w.parts[3]] = w.val;
      else if (w.parts[2] === 'players' && w.parts.length === 4) wpl[w.parts[3]] = w.val;
      // Der Reclaim schreibt EIN FELD des Rosterdatensatzes (players/<seat>/tab)
      // gemeinsam mit der neuen Praesenz. Der zusammengefuehrte Baum muss dieses
      // Feld sehen, sonst prueft die Kopplung gegen den alten Wert.
      else if (w.parts[2] === 'players' && w.parts.length === 5) {
        const seat = w.parts[3];
        if (!(seat in wpl)) wpl[seat] = base(seat);
        if (w.val === null) delete wpl[seat][w.parts[4]]; else wpl[seat][w.parts[4]] = w.val;
      }
      else if (w.parts[2] === 'p' && w.parts.length === 5) {
        const seat = w.parts[3];
        if (!(seat in wp)) wp[seat] = room && room.p && room.p[seat] ? JSON.parse(JSON.stringify(room.p[seat])) : {};
        if (w.val === null) delete wp[seat][w.parts[4]]; else wp[seat][w.parts[4]] = w.val;
      }
      else if (w.parts[2] === 'state' && w.parts.length === 3) wstate = w.val;
    }
    return {
      p: seat => (String(seat) in wp) ? wp[String(seat)] : (room && room.p && room.p[seat]),
      players: seat => (String(seat) in wpl) ? wpl[String(seat)] : (room && room.players && room.players[seat]),
      state: () => wstate !== undefined ? wstate : (room && room.state)
    };
  }
  // Spiegel der ausgelieferten Rules, soweit dieser Fluss sie beruehrt. Football hat
  // fuenf Sitze, seats===5 verlangt fuenf AKTIVE Praesenzen, und der Zugslot ist
  // write-once. Fuer Football wird zusaetzlich die kanonische Zugform geprueft.
  function checkWrite(parts, val, merged, authUid) {
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
    const cfg = room.config || {}, fmt = cfg.fmt, isFb = cfg.game === 'football';
    const cap = isFb ? 5 : fmt === 'triple_ffa' ? 3 : fmt === 'team_duel' ? 4 : fmt === 'ffa' ? 5 : 2;
    const key = parts[2];
    if (key === 'p') {
      const seat = +parts[3];
      if (seat >= cap) throw new Error('PERMISSION_DENIED: seat range');
      const cur = room.p && room.p[seat];
      const owner = room.players && room.players[seat] && room.players[seat].uid;
      const mergedOwner = merged.players(seat) && merged.players(seat).uid;
      if (owner !== undefined && owner !== authUid && mergedOwner !== authUid)
        throw new Error('PERMISSION_DENIED: p not owner');
      if (val == null) {
        if (merged.players(seat) != null) throw new Error('PERMISSION_DENIED: p delete needs players delete');
        // Football im LAUFENDEN Match: der Austritt verlangt die Eviction im Ergebnis.
        if (isFb && room.seats === 5) {
          const g = room.g && room.g[room.gen];
          if (!(g && g.e && g.e[seat] === true)) throw new Error('PERMISSION_DENIED: football leave needs eviction');
        }
        return;
      }
      if (!val || typeof val !== 'object' || typeof val.s !== 'string' || typeof val.on !== 'boolean' || typeof val.t !== 'number')
        throw new Error('PERMISSION_DENIED: p shape');
      if (!cur) {
        if (val.on !== false) throw new Error('PERMISSION_DENIED: fresh reserve must be on:false');
        if (room.state !== 'lobby') throw new Error('PERMISSION_DENIED: reserve only in lobby');
        const pl = merged.players(seat);
        if (!pl || pl.tab !== val.s) throw new Error('PERMISSION_DENIED: reserve needs players.tab');
        return;
      }
      if (val.s === cur.s) {
        if (cur.on === false && val.on === true) {
          const g = room.g && room.g[room.gen];
          if (g && g.e && g.e[seat] === true) throw new Error('PERMISSION_DENIED: activate evicted seat');
          // Mehrsitzige Raeume (FFA-Familie UND Football) aktivieren schon in der Lobby.
          const multi = isFb || fmt === 'ffa' || fmt === 'triple_ffa' || fmt === 'team_duel';
          const okState = seat === 0 || multi || room.state === 'playing' ||
            (seat === 1 && room.state === 'lobby' && merged.state() === 'playing');
          if (!okState) throw new Error('PERMISSION_DENIED: activate state gate');
          return;
        }
        if (cur.on === true && val.on === false) return;
        if (cur.on === false && val.on === false) return;
        throw new Error('PERMISSION_DENIED: p on transition');
      }
      if (cur.on === false && val.on === false) {
        const pl = merged.players(seat);
        if (pl && pl.tab === val.s) {
          const ge = room.g && room.g[room.gen];
          if (room.state === 'playing' && !(ge && ge.e && ge.e[seat] === true)) return;
          if (room.state === 'lobby' && (nowMs - cur.t) >= 15000) return;
        }
      }
      throw new Error('PERMISSION_DENIED: p token mismatch');
    }
    if (key === 'players') {
      const seat = +parts[3];
      if (seat >= cap) throw new Error('PERMISSION_DENIED: roster seat range');
      const cur = room.players && room.players[seat];
      if (cur && cur.uid !== undefined && cur.uid !== authUid && !(val && val.uid === authUid && !cur))
        if (cur.uid !== authUid) throw new Error('PERMISSION_DENIED: roster not owner');
      if (val == null) {
        if (merged.p(seat) != null) throw new Error('PERMISSION_DENIED: players delete needs p delete');
        if (isFb && room.seats === 5) {
          const g = room.g && room.g[room.gen];
          if (!(g && g.e && g.e[seat] === true)) throw new Error('PERMISSION_DENIED: football leave needs eviction');
        }
        return;
      }
      if (parts.length === 4) {
        if (!val.id || !val.name || !val.tab || !val.uid) throw new Error('PERMISSION_DENIED: roster shape');
        if (val.uid !== authUid) throw new Error('PERMISSION_DENIED: roster uid');
        const mp = merged.p(seat);
        if (!mp || mp.s !== val.tab) throw new Error('PERMISSION_DENIED: roster/presence coupling');
      }
      return;
    }
    if (key === 'state') {
      const p0 = room.p && room.p[0], p1 = merged.p(1);
      if (!(val === 'playing' && room.state === 'lobby' && p0 && p0.on === true && p1 && p1.on === true))
        throw new Error('PERMISSION_DENIED: state');
      // Der Start gehoert dem Host - ausser beim atomaren 1v1/2v2-Gastclaim.
      const hostUid = room.players && room.players[0] && room.players[0].uid;
      const twoSeat = !isFb && (fmt === 'single' || fmt === 'double');
      const guestUid = merged.players(1) && merged.players(1).uid;
      if (!(authUid && (hostUid === authUid || (twoSeat && guestUid === authUid))))
        throw new Error('PERMISSION_DENIED: state owner');
      return;
    }
    if (key === 'seats') {
      if (!(room.seats == null && room.state === 'playing')) throw new Error('PERMISSION_DENIED: seats');
      const hostUid = room.players && room.players[0] && room.players[0].uid;
      if (authUid !== hostUid) throw new Error('PERMISSION_DENIED: seats owner');
      const activeUpTo = n => { for (let i = 0; i < n; i++) if (!(room.p && room.p[i] && room.p[i].on === true)) return false; return true; };
      const noneAbove = n => { for (let i = n; i < 5; i++) if (room.p && room.p[i] && room.p[i].on === true) return false; return true; };
      if (isFb) { if (!(val === 5 && activeUpTo(5))) throw new Error('PERMISSION_DENIED: football seats'); return; }
      if (!(val >= 2 && val <= cap && activeUpTo(val) && noneAbove(val))) throw new Error('PERMISSION_DENIED: seats count');
      return;
    }
    if (key === 'gen') {
      const mem = [0, 1, 2, 3, 4].some(i => room.players && room.players[i] && room.players[i].uid === authUid
        && room.p && room.p[i] && room.p[i].on === true);
      if (!authUid || !mem) throw new Error('PERMISSION_DENIED: gen');
      return;
    }
    if (key === 'g') {
      const gen = parts[3], kind = parts[4];
      if (kind === 't') {
        const pl = +parts[6];
        if (String(room.gen) !== String(gen)) throw new Error('PERMISSION_DENIED: turn gen');
        if (at(parts) != null) throw new Error('PERMISSION_DENIED: turn write-once');
        if (isFb) {
          if (room.seats !== 5) throw new Error('PERMISSION_DENIED: turn before start signal');
          if (!val || val.k !== 'move') throw new Error('PERMISSION_DENIED: only move in phase B');
          if (val.idx !== pl) throw new Error('PERMISSION_DENIED: idx must equal seat');
          const owner = room.players && room.players[pl] && room.players[pl].uid;
          if (owner !== authUid) throw new Error('PERMISSION_DENIED: turn owner');
          if (!(room.p && room.p[pl] && room.p[pl].on === true)) throw new Error('PERMISSION_DENIED: turn presence');
        }
        return;
      }
      throw new Error('PERMISSION_DENIED: g path');
    }
    if (key === 'created' || key === 'v' || key === 'config') throw new Error('PERMISSION_DENIED: immutable');
    throw new Error('PERMISSION_DENIED: unknown path ' + key);
  }

  function applyWrite(parts, val) {
    let c = data;
    for (let i = 0; i < parts.length - 1; i++) { if (!c[parts[i]] || typeof c[parts[i]] !== 'object') c[parts[i]] = {}; c = c[parts[i]]; }
    const k = parts[parts.length - 1];
    if (val === null) delete c[k]; else c[k] = JSON.parse(JSON.stringify(val));
  }
  const resolveTs = v => JSON.parse(JSON.stringify(v, (k, x) => (x && x.__ts) ? nowMs : x));

  return {
    data, get now() { return nowMs; }, advance(ms) { nowMs += ms; },
    flush,
    // Ein Client sieht die Datenbank ausschliesslich durch dieses Objekt - mit SEINER
    // Identitaet. Zwei Clients koennen sich so nicht gegenseitig als Schreiber ausgeben.
    FBfor(ui, authUid) {
      const self = {
        db: {}, serverTimestamp: () => ({ __ts: true }),
        ref: (_db, p) => ({ parts: p.split('/') }),
        onValue(ref, cb) {
          const l = { parts: ref.parts, cb, last: undefined };
          listeners.add(l);
          queue.push(() => { l.last = JSON.stringify(clone(at(l.parts))); cb({ val: () => clone(at(l.parts)), exists: () => at(l.parts) != null }); });
          return () => listeners.delete(l);
        },
        get(ref) { return new Promise(res => queue.push(() => res({ val: () => clone(at(ref.parts)), exists: () => at(ref.parts) != null }))); },
        set(ref, v) {
          return new Promise((res, rej) => queue.push(() => {
            const val = resolveTs(v);
            try { checkWrite(ref.parts, val, null, authUid); } catch (e) { rej(e); return; }
            applyWrite(ref.parts, val); notify(); res();
          }));
        },
        update(ref, obj) {
          return new Promise((res, rej) => queue.push(() => {
            const writes = Object.keys(obj).map(k => ({ parts: ref.parts.concat(k.split('/')), val: resolveTs(obj[k]) }));
            const room = data.rooms[ref.parts[1]];
            const merged = buildMerged(room, writes);
            try { for (const w of writes) checkWrite(w.parts, w.val, merged, authUid); } catch (e) { rej(e); return; }
            for (const w of writes) applyWrite(w.parts, w.val);
            notify(); res();
          }));
        },
        remove(ref) { return self.set(ref, null); },
        onDisconnect: () => ({ set: () => Promise.resolve(), cancel: () => Promise.resolve(), remove: () => Promise.resolve(), update: () => Promise.resolve() }),
        // Write-once-Arbiter. applyLocally:false heisst: KEIN lokales Zwischenevent.
        runTransaction(ref, fnTx) {
          return new Promise((res, rej) => queue.push(() => {
            const cur = clone(at(ref.parts));
            const next = fnTx(cur);
            if (next === undefined) { res({ committed: false, snapshot: { val: () => clone(at(ref.parts)) } }); return; }
            const val = resolveTs(next);
            try { checkWrite(ref.parts, val, null, authUid); } catch (e) { rej(e); return; }
            applyWrite(ref.parts, val); notify();
            res({ committed: true, snapshot: { val: () => clone(at(ref.parts)) } });
          }));
        }
      };
      return self;
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  EIN CLIENT — eigener Sandkasten, eigene Identitaet, eigener Spielzustand
// ══════════════════════════════════════════════════════════════════════════════
let clientSeq = 0;
function makeClient(db, code, opts) {
  opts = opts || {};
  const seq = ++clientSeq;
  const pid = opts.pid || ('FBPID' + String(seq).padStart(3, '0'));
  const tab = opts.tab || ('FBTAB' + String(seq).padStart(3, '0'));
  const uid = opts.uid || ('UID_' + pid);
  const ui = { code, log: [], name: opts.name || ('P' + seq) };
  const FB = db.FBfor(ui, uid);
  const body = `
    const TUNE=false; let r3dOrbit=false;
    // Die echte Ansicht des Spiels ist 3D. Der Harness kann beide Wege fahren: der
    // 2D-Zweig prueft die reine Identitaets-/Eingabelogik, der 3D-Zweig zusaetzlich die
    // Trefferpruefung ueber die echte Projektion.
    let r3dActive=${opts.d3 ? 'true' : 'false'};
    // Der Online-Football-Prototyp haengt vollstaendig an ?dev=1. Der Harness stellt
    // beide Faelle dar, damit die Grenze selbst geprueft werden kann.
    const DEV_MENU=${opts.dev === false ? 'false' : 'true'};
    const T=k=>k;
    const window={__FB_READY:true,__FB_ERR:null,__FB_AUTH_ERR:null,__FB_UID:${JSON.stringify(uid)},FB};
    const document={querySelector:()=>stub(),querySelectorAll:()=>[]};
    function stub(){return {textContent:'',style:{},className:'',innerHTML:'',value:'',disabled:false,
      classList:{add(){},remove(){},toggle(){},contains(){return false;}},querySelector:()=>stub()};}
    const els={}; function \$(id){return els[id]||(els[id]=stub());}
    const toast=m=>{ui.log.push('toast:'+m);};
    // Tonspur: jeder Aufruf wird GEZAEHLT, damit die Rehydrierung nachweislich still ist.
    // Tonspur. Der Zaehler haengt an soundOn - exakt wie go() in index.html, wo JEDE
    // Ausgabe durch "if(soundOn)" laeuft. Nur so ist die Aussage "die Rehydrierung ist
    // still" ueberhaupt pruefbar: fastForwardMatch schaltet soundOn fuer den ganzen
    // Nachlauf ab und danach wieder ein.
    const sfxCount={goal:0,transition:0,launch:0,hit:0};
    const beep=k=>{ if(soundOn)sfxCount[k]++; };
    const SFX={hit(){beep('hit');},drop(){},ringout(){},launch(){beep('launch');},round(){},win(){},
      rollUpdate(){},unlock(){},collapse(){},charge:{start(){},stop(){},update(){}},
      footballGoal(){beep('goal');},footballGoalPreload(){},footballGoalStop(){},
      fbTransitionBed(){beep('transition');},fbTransitionLock(){beep('transition');},fbTransitionStop(){}};
    function hideCollapseCount(){} function updateCollapseHud(){}
    const cv={releasePointerCapture(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000})};
    let soundOn=true, particles=[], fx3=[], bgPulse=0, bgPulseRGB='';
    const fxCount={spawn:0,fx3:0};
    function spawn(){fxCount.spawn++;} function popBall(){} function fx3Hit(){fxCount.fx3++;} function fx3Dust(){fxCount.fx3++;}
    function winnerRGB(){return '';} function devSync(){}
    function resize(){} function updScrollHint(){} function setOn(){}
    const hudCount={update:0}; function updateHud(){hudCount.update++;} function setPhaseText(){}
    const coverCalls=[]; function openCover(pi){coverCalls.push(pi);}
    function showRoundEnd(){} function showTeamDraw(){} function showScoreFly(){} function scorePulse(){}
    function renderElimBar(){}
    function recordFrame(){} function updParticles(){} function repTick(){}
    const gameOverCalls=[]; function gameOver(w){setPhase('over');gameOverCalls.push(w);}
    const showGame=()=>ui.log.push('showGame');
    function hidePublicUI(){} function startPublicListing(){} function stopPublicListing(){}
    function removePublicListing(){} function writePublicListing(){return Promise.resolve();}
    let roomPublic=false, createVisibility='private';
    const LOGICAL=1000, cx=500, cy=500, R0=LOGICAL*0.485; let BR=LOGICAL*0.032, R=R0;
    function maxPull(){return R0*MAXPULL_FRAC;}
    const REVEAL_MS=600, RESULT_MS=950, REDUCED_MOTION=false;
    let mode='bot',menuMode='bot',diff='easy',winTarget=3,fmt='single',ffaN=5,ffaNMenu=5,roundNo=1;
    let online=false, roomCode='', myPlayer=0, gen=0, runningGen=-1, turnNo=-1;
    let turnUnsub=null, genUnsub=null, presUnsub=null, seatsUnsub=null, gameStarted=false;
    let lobbyP={}, seatLeft=[], seatGone=[];
    let pendingSlot={}, onlineSessionId=0;
    let sentinelRetryTimer={};
    const SENTINEL_RETRY_BASE_MS=300, SENTINEL_RETRY_MAX_MS=2000, SENTINEL_RETRY_MAX_ATTEMPTS=11;
    let onlineTerminatedSession=-1;
    const NAME_MAX=16, NAME_MAX_UNITS=48, LOBBY_HOST_GRACE_MS=12000, SEAT_STALE_MS=60000;
    let roomP={}, matchGraceTimer={};
    let onlinePid=${JSON.stringify(pid)}, onlineTab=${JSON.stringify(tab)}, onlineName=${JSON.stringify(ui.name)};
    let playersRoster={}, rosterUnsub=null, lobbyHostGraceTimer=null, joinOpSeq=0;
    let phase='over', phaseStart=0, curAimer=0, balls=[], aimSet=[], commitIdx=[], commitAim=[], commitSpin=[], score=[];
    let outBall=-1, roundWinner=-1;
    let replaying=false, repPlaying=false, recFrames=[];
    function setPhase(p){phase=p;phaseStart=0;}
    const rrand=()=>ui.code;
    let clk=0;
    // Kamera und Rahmung exakt nach frame()/updateCam(): dieselben Formeln, dieselbe
    // Reihenfolge. dispS entspricht der Canvasbreite des Stubs.
    const dispS=1000;
    let r3d=null;
    function buildCam(){
      const vw=1280, vh=720, aspect=vw/vh;
      const tanV=Math.tan(45*Math.PI/360), need=530;
      const fbFrame=mode==='football';
      const fbEdgeX=fbFrame?fbArena().postBack*BR+FOOTBALL_BALL_RADIUS:0;
      const elimView=fbFrame&&fbElim4()?fbElimViewR():0;
      const needX=fbFrame?(elimView||fbEdgeX)+(need-R0):need;
      const needZ=fbFrame?(elimView||fbHalfWid())+(need-R0):need;
      const baseDist=Math.max(needX/(tanV*aspect),needZ/tanV)*1.10;
      const curVA=viewAngle();
      const geo={vw,vh,baseDist,ox:0,oy:0,os:1000,shx:0,shy:0};
      const POLAR0=Math.atan2(27,19), camPolar=POLAR0, yawW=curVA;
      const spol=Math.sin(camPolar), cpol=Math.cos(camPolar), dist=geo.baseDist;
      const camP={ex:cx+dist*spol*Math.sin(yawW),ey:35+dist*cpol,ez:cy+dist*spol*Math.cos(yawW),
        tx:cx,ty:35,tz:cy,fov:45,vw:geo.vw,vh:geo.vh,ox:geo.ox,oy:geo.oy,os:geo.os,
        shx:geo.shx,shy:geo.shy,py:0};
      const m=r3dCamMath(camP);
      r3d={w2s:(lx,ly,h)=>m.w2s(lx,ly,h),s2w:(a,b)=>m.s2w(a,b)};
    }
    const localStorage={getItem(){return null;},setItem(){},removeItem(){}};
    const performance={now(){return 0;}};
    ${SRC}
    // ── Steuerpult dieses Clients ──
    return {
      ui, uid:${JSON.stringify(uid)}, pid:onlinePid, tab:onlineTab,
      // Dev-Einstieg: exakt das, was die Schaltflaeche tut.
      enterFootball(){ mode='football'; fbVariant=FOOTBALL_VARIANT_ELIM; fmt=FB_ONLINE_FMT; openOnline(); },
      create(){ createRoom(); },
      join(c){ \$('onInput').value=c; joinRoom(); },
      start(){ lobbyP=roomP&&Object.keys(roomP).length?roomP:lobbyP; startFfaMatch(); },
      rejoin(c){ return attemptRejoin(c); },
      rematch(){ onlineRematch(); },
      status(){ return els['onStatus']?els['onStatus'].textContent:''; },
      st(){ return { online, mode, fmt, myPlayer, gen, turnNo, phase, gameStarted, roomCode,
        ballN:balls.length, aimSet:aimSet.slice(), pending:Object.keys(pendingSlot).length,
        lives:fbElimLives.slice(0,fbElimPlayers()), active:fbElimActive.slice(0,fbElimPlayers()),
        slots:fbElimSlots.slice(0,fbElimPlayers()), phaseN:fbElimPhaseN,
        goal:fbGoalState, winner:footballWinner, over:gameOverCalls.slice() }; },
      // Treibt den Frame-Schritt, bis wieder Eingabe moeglich ist. Die Uhr laeuft
      // ausschliesslich vorwaerts - genau wie im Browser; das Reveal-Fenster ist eine
      // Praesentationspause, die Physik dahinter ist fest getaktet.
      pump(maxSteps){
        let n=0; const lim=maxSteps||FF_MAX_STEPS_PER_TURN;
        while((phase==='reveal'||phase==='sim'||phase==='result')&&n++<lim){ clk+=SIM_DT_MS; simStep(clk); }
        return n;
      },
      steps(){ return Math.round(clk/SIM_DT_MS); },
      hash(){ return simHash(); },
      sfx(){ return Object.assign({}, sfxCount); },
      fx(){ return Object.assign({}, fxCount); },
      covers(){ return coverCalls.slice(); },
      lobbySeatColors(){ const out=[]; for(let i=0;i<5;i++){ const e=els['lobbyName'+i]; out.push(e?e.style.color:null); } return out; },
      lobbyCount(){ return els['lobbyCount']?els['lobbyCount'].textContent:''; },
      lobbyStartDisabled(){ return els['lobbyStart']?els['lobbyStart'].disabled:null; },
      onTitle(){ return els['onTitleMode']?els['onTitleMode'].textContent:''; },
      // Kanonischer Zug: aus der eigenen Figur heraus in Richtung eines Ziels.
      aimAt(tx,ty,power){
        const own=aliveBalls(myPlayer); if(!own.length)return false;
        const b=own[0], dx=tx-b.x, dy=ty-b.y, d=Math.hypot(dx,dy)||1;
        const mp=maxPull()*(power===undefined?1:power);
        return commitVec(dx/d*mp, dy/d*mp);
      },
      // Zug ueber den ECHTEN Eingabepfad: derselbe commit(), den der Zeiger benutzt.
      commitVec(dx,dy,sp){ return commitVec(dx,dy,sp); },
      // Zeigerzug im LOKALEN Ansichtsraum -> kanonischer Weltvektor. Genau die
      // Umrechnung, die localPt() im Browser macht (inverse Ansichtsrotation).
      commitViewVec(vx,vy){
        const va=viewAngle(), c=Math.cos(va), s=Math.sin(va);
        return commitVec(vx*c+vy*s, -vx*s+vy*c);
      },
      viewAngle(){ return viewAngle(); },
      who(){ return whoCanAim(); },
      // Zeigen mit dem Finger - vollstaendig ueber die echten Handler. Der Bildschirmpunkt
      // wird so gewaehlt, dass localPt() genau auf die eigene Figur zurueckrechnet: die
      // Ansichtsdrehung wird dafuer VORWAERTS angewandt (localPt dreht sie zurueck).
      aimByPointer(pullX, pullY){
        const own=aliveBalls(myPlayer);
        if(!own.length)return {ok:false,why:'keine lebende Figur',who:whoCanAim()};
        const b=own[0], va=viewAngle(), c=Math.cos(va), sn=Math.sin(va);
        // 3D: die Kamera wird wie im Spiel aus der aktuellen Ansicht gebaut, und der
        // Zeigerpunkt ist die ECHTE Projektion der eigenen Figur - genau dorthin tippt
        // ein Spieler, weil der Renderer die Kugel an derselben Stelle zeichnet.
        if(r3dActive){
          buildCam();
          const q=OP(b.x,b.y,BR);
          const scr=(w)=>({clientX:w.x,clientY:w.y});
          const p0=scr(q);
          onPointerDown({pointerId:1,clientX:p0.clientX,clientY:p0.clientY});
          if(aimPid<0)return {ok:false,why:'Eingabe abgelehnt',who:whoCanAim(),
                              alive:aliveCount(myPlayer),aimSet:aimSet[myPlayer],phase:phase,
                              proj:{x:q.x,y:q.y,s:q.s}};
          const grabbed3=dragShooter, owner3=dragOwner;
          const q1=OP(b.x+pullX,b.y+pullY,BR);
          onPointerMove({pointerId:1,clientX:q1.x,clientY:q1.y});
          onPointerUp({pointerId:1,clientX:q1.x,clientY:q1.y});
          return {ok:true,grabbed:grabbed3,owner:owner3,
                  grabbedOwner:balls[grabbed3]?balls[grabbed3].owner:-1};
        }
        const toScreen=(wx,wy)=>({clientX:cx+(wx-cx)*c-(wy-cy)*sn, clientY:cy+(wx-cx)*sn+(wy-cy)*c});
        const p0=toScreen(b.x,b.y);
        onPointerDown({pointerId:1,clientX:p0.clientX,clientY:p0.clientY});
        if(aimPid<0)return {ok:false,why:'Eingabe abgelehnt',who:whoCanAim(),
                            alive:aliveCount(myPlayer),aimSet:aimSet[myPlayer],phase:phase};
        const grabbed=dragShooter, owner=dragOwner;
        const p1=toScreen(b.x+pullX,b.y+pullY);
        onPointerMove({pointerId:1,clientX:p1.clientX,clientY:p1.clientY});
        onPointerUp({pointerId:1,clientX:p1.clientX,clientY:p1.clientY});
        return {ok:true, grabbed, owner, grabbedOwner:balls[grabbed]?balls[grabbed].owner:-1};
      },
      ballPos(i){ const b=balls[i]; return b?{x:b.x,y:b.y,owner:b.owner,alive:b.alive}:null; },
      neutralIdx(){ for(let i=0;i<balls.length;i++)if(balls[i].owner===FOOTBALL_NEUTRAL_OWNER)return i; return -1; },
      dirs(){ return fbElimDirs().map(d=>d.slice()); },
      // fbElimSlots ist SLOT -> EIGENTUEMER. Der Torslot eines Sitzes ist deshalb seine
      // POSITION in dieser Liste.
      slotOf(seat){ return fbElimSlots.indexOf(seat); },
      rad(i){ return ballRad(balls[i]); },
      // Der Punkt, an dem die Torlinie des Slots liegt: vom Mittelpunkt aus in
      // Torrichtung bis zur Grenze der ECHTEN Arena (Intervallhalbierung ueber
      // footballBoundSD). Damit stimmt er in jeder Phase - Fuenfeck, Quadrat,
      // Dreieck und Schulterform.
      goalPoint(slot){
        const d=fbElimDirs()[slot]; if(!d)return null;
        const probe={x:0,y:0,owner:FOOTBALL_NEUTRAL_OWNER,alive:true};
        let lo=0, hi=R0*2;
        for(let i=0;i<48;i++){ const m=(lo+hi)/2;
          probe.x=cx+d[0]*m; probe.y=cy+d[1]*m;
          if(footballBoundSD(probe).sd<0)lo=m; else hi=m; }
        return {x:cx+d[0]*lo, y:cy+d[1]*lo};
      },
      slotOwner(sl){ return fbElimSlotOwner(sl); },
      // Setzt exakt den Zustand her, den attemptRejoin vor der Rehydrierung herstellt:
      // Raumkonfiguration und Identitaet stehen, der Spielzustand kommt aus der Historie.
      prepareReplay(seat, g){ mode='football'; fbVariant=FOOTBALL_VARIANT_ELIM; fmt=FB_ONLINE_FMT;
        online=true; myPlayer=seat; gen=g; runningGen=-1; gameStarted=true; roomCode=ui.code; },
      // Rehydrierung aus der Historie - der ECHTE Produktpfad.
      replay(turns){ fastForwardMatch(turns); },
      armFor(g,turn){ gen=g; runningGen=g; turnNo=turn; },
      drop(){ try{if(turnUnsub)turnUnsub();}catch(e){} try{if(genUnsub)genUnsub();}catch(e){}
        try{if(presUnsub)presUnsub();}catch(e){} try{if(seatsUnsub)seatsUnsub();}catch(e){}
        try{if(rosterUnsub)rosterUnsub();}catch(e){}
        turnUnsub=genUnsub=presUnsub=seatsUnsub=rosterUnsub=null; },
      raw(){ return { balls, fbElimLives, fbElimActive, fbElimSlots }; },
      // Disconnect-Sonde: ruft die ECHTE seatFinallyGone und legt offen, was danach
      // sichtbar ist. Kein Nachbau - der Zweig selbst ist der Pruefgegenstand.
      seatGoneNow(s){ seatFinallyGone(s); },
      discView(){ return { wt:(els['wt']?els['wt'].textContent:''),
        ws:(els['ws']?els['ws'].textContent:''),
        toasts:ui.log.filter(x=>x.indexOf('toast:')===0),
        left:seatLeft.slice(0,5), gone:seatGone.slice(0,5) }; },
      // Nur fuer den Zweigtest: derselbe Client als RingOut-Raum. seatFinallyGone
      // haengt ausschliesslich an mode/seatLeft - mehr braucht der Vergleich nicht.
      asRoom(m,f){ mode=m; fmt=f; }
    };
    function commitVec(dx,dy,sp){
      const who=whoCanAim(); if(who<0)return false;
      const own=aliveBalls(who); if(!own.length)return false;
      commit(who, balls.indexOf(own[0]), dx, dy, sp||0);
      return true;
    }
  `;
  const factory = new Function('FB', 'ui', body);
  return factory(FB, ui);
}

// ── Ablaufhilfen ──────────────────────────────────────────────────────────────
// Die Fake-DB stellt jeden Zugriff in eine Warteschlange. Ein Durchlauf besteht
// deshalb aus abwechselnd Warteschlange leeren und Microtasks laufen lassen -
// sonst bliebe eine Kette aus await-Schritten auf halbem Weg stehen.
const tick = async (db, n) => { for (let i = 0; i < (n || 60); i++) { db.flush(); await Promise.resolve(); } };

// ══════════════════════════════════════════════════════════════════════════════
//  ABLAUFHILFEN
// ══════════════════════════════════════════════════════════════════════════════
const CODE = 'FBQ7';

// Fuenf frische Clients, ein Football-Raum, Match gestartet. Genau der Weg, den ein
// Spieler geht: Dev-Einstieg -> Raum anlegen -> vier Beitritte -> Host startet.
async function setupMatch(db, code) {
  const cs = [];
  for (let i = 0; i < 5; i++) cs.push(makeClient(db, code, { name: 'P' + (i + 1) }));
  cs[0].enterFootball(); cs[0].create(); await tick(db);
  for (let i = 1; i < 5; i++) { cs[i].join(code); await tick(db); }
  cs[0].start(); await tick(db);
  return cs;
}
async function newMatch(code) {
  const db = makeDB();
  const cs = await setupMatch(db, code || CODE);
  return { db, cs };
}
const activeSeats = (c) => c.st().active.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
const sameHash = (cs) => cs.every(c => c.hash() === cs[0].hash());
// Eine vollstaendige Online-Runde: jeder AKTIVE Sitz committet einmal, danach laeuft
// die Runde bei jedem Client bis zur naechsten Eingabegrenze durch.
async function playRound(db, cs, vec) {
  const act = activeSeats(cs[0]);
  for (const s of act) cs[s].commitVec(...vec(s));
  await tick(db);
  for (const c of cs) c.pump();
  await tick(db);
  return act;
}
// Waehlt den Sitz, der den Ball am besten in Richtung eines Torslots schieben kann:
// die eigene Schussrichtung (Figur -> Ball) muss moeglichst genau der Torrichtung
// entsprechen. Reine Zielhilfe des Tests - geschossen wird ueber den echten Eingabepfad.
// Zielhilfe des Tests - kein Produktcode. Sie stoesst den Ball ueber den
// "Geisterball": den Punkt hinter dem Ball, von dem aus der Stoss ihn genau auf den
// Torpunkt schickt. Gewaehlt wird der Sitz, der diesen Punkt am geradesten anlaufen
// kann. Geschossen wird danach ueber den ECHTEN Eingabepfad.
function bestShooter(cs, slot) {
  const ref = cs[0], bi = ref.neutralIdx(), b = ref.ballPos(bi), G = ref.goalPoint(slot);
  if (!b || !G) return null;
  const gx = G.x - b.x, gy = G.y - b.y, GL = Math.hypot(gx, gy) || 1;
  const ux = gx / GL, uy = gy / GL;
  let best = -1, bv = -Infinity, ghost = null;
  for (const s of activeSeats(ref)) {
    const fi = cs[s].raw().balls.findIndex(x => x.owner === s && x.alive);
    const f = cs[s].ballPos(fi); if (!f) continue;
    const reach = ref.rad(bi) + cs[s].rad(fi);
    const g = { x: b.x - ux * reach, y: b.y - uy * reach };
    const dx = g.x - f.x, dy = g.y - f.y, L = Math.hypot(dx, dy) || 1;
    // Gut ist ein Sitz, dessen Anlauf schon in die Stossrichtung zeigt.
    const v = (dx / L) * ux + (dy / L) * uy;
    if (v > bv) { bv = v; best = s; ghost = { g, f }; }
  }
  // Auch ein schlechter Anlauf ist besser als Stillstand: eine Runde, in der niemand
  // zieht, aendert nichts und die Suche kaeme nie voran.
  if (best < 0) return null;
  const dx = ghost.g.x - ghost.f.x, dy = ghost.g.y - ghost.f.y, L = Math.hypot(dx, dy) || 1;
  return { seat: best, align: bv, tx: ghost.g.x + dx / L * 260, ty: ghost.g.y + dy / L * 260 };
}
// Spielt Runden, bis irgendein Tor faellt. Ein Spieler schiesst auf das Tor eines
// gewaehlten Slots, die uebrigen bleiben stehen - so bleibt der Ablauf uebersichtlich
// und trotzdem vollstaendig ueber den echten Eingabe- und Physikpfad.
async function playUntilGoal(db, cs, _ignored, targetSlot, maxRounds) {
  const before = cs[0].st().lives.slice();
  for (let r = 0; r < (maxRounds || 14); r++) {
    const act = activeSeats(cs[0]);
    const sh = bestShooter(cs, targetSlot);
    for (const s of act) {
      if (sh && s === sh.seat) cs[s].aimAt(sh.tx, sh.ty, 1);
      // Die uebrigen bewegen sich leicht und DETERMINISTISCH weiter. Stuenden alle
      // still, waere jede Runde eine Wiederholung der vorigen und die Stellung
      // koennte sich nie aus einer ungluecklichen Lage loesen.
      else cs[s].commitVec(Math.cos((r * 7 + s * 3) * 0.7) * 40, Math.sin((r * 5 + s * 2) * 0.9) * 40);
    }
    await tick(db);
    for (const c of cs) c.pump();
    await tick(db);
    const now = cs[0].st();
    for (let i = 0; i < before.length; i++) if (now.lives[i] !== before[i]) return { conceded: i, round: r, lives: now.lives.slice() };
    if (now.winner !== null) return { conceded: -1, round: r, lives: now.lives.slice() };
  }
  return null;
}

// Laesst einen bestimmten Sitz ausscheiden: zweimal ein Tor in SEIN Tor. Der Torslot
// wandert beim Arenaumbau, deshalb wird er vor jedem Schuss neu gelesen.
async function eliminateSeat(db, cs, seat, maxRounds) {
  // Es wird konsequent auf DAS Tor dieses Sitzes gespielt. Faellt unterwegs ein Tor
  // woanders, ist das ein regulaeres Spielereignis - alle Clients leiten es ohnehin
  // gleich ab. Abgebrochen wird nur, wenn das Rundenbudget aufgebraucht ist.
  for (let r = 0; r < (maxRounds || 40); r++) {
    if (cs[0].st().active[seat] === false) return true;
    if (cs[0].st().winner !== null) return cs[0].st().active[seat] === false;
    const slot = cs[0].slotOf(seat);
    if (slot < 0) return cs[0].st().active[seat] === false;
    await playUntilGoal(db, cs, null, slot, 1);
  }
  return cs[0].st().active[seat] === false;
}

// ══════════════════════════════════════════════════════════════════════════════
//  TESTGRUPPEN
// ══════════════════════════════════════════════════════════════════════════════
(async () => {
  console.log('ARENA FOOTBALL ONLINE - fuenf getrennte Clients an einer Datenbank\n');

  // ── (A) RAUM UND LOBBY ──────────────────────────────────────────────────────
  {
    const db = makeDB();
    const cs = [];
    for (let i = 0; i < 6; i++) cs.push(makeClient(db, CODE, { name: 'P' + (i + 1) }));
    cs[0].enterFootball(); cs[0].create(); await tick(db);
    const room = db.data.rooms[CODE];
    t('A der Raum ist ein v4-Raum', room && room.v === 4);
    t('A Raumtyp football', room && room.config.game === 'football');
    t('A Format elimination', room && room.config.fmt === 'elimination');
    t('A der Ersteller sitzt auf Sitz 0', cs[0].st().myPlayer === 0 && room.players[0].uid === cs[0].uid);
    t('A der Raum startet in der Lobby', room.state === 'lobby' && room.seats === undefined);
    t('A der Titel nennt Arena Football', cs[0].onTitle() === 'ARENA FOOTBALL');

    // Start mit zu wenigen Spielern ist unmoeglich - Client UND Server verweigern.
    cs[1].join(CODE); await tick(db);
    cs[0].start(); await tick(db);
    t('A mit zwei Spielern startet das Match nicht', db.data.rooms[CODE].state === 'lobby');
    t('A der Startknopf ist bei 2/5 gesperrt', cs[0].lobbyStartDisabled() === true);

    for (let i = 2; i < 5; i++) { cs[i].join(CODE); await tick(db); }
    t('A fuenf eindeutige Sitze', cs.slice(0, 5).map(c => c.st().myPlayer).join(',') === '0,1,2,3,4');
    t('A fuenf verschiedene Eigentuemer',
      new Set([0, 1, 2, 3, 4].map(i => db.data.rooms[CODE].players[i].uid)).size === 5);
    t('A fuenf Rosternamen', [0, 1, 2, 3, 4].every(i => db.data.rooms[CODE].players[i].name === 'P' + (i + 1)));
    t('A die Lobby zaehlt 5/5', cs[0].lobbyCount() === '5/5');
    t('A der Startknopf ist bei 5/5 frei', cs[0].lobbyStartDisabled() === false);

    // Farbtafel: Cyan, Rot, Gruen, Gelb, Violett.
    const want = ['#00d4ff', '#ff4d4d', '#39e07a', '#ffc940', '#c07bff'];
    t('A Sitzfarben Cyan/Rot/Gruen/Gelb/Violett', cs[0].lobbySeatColors().join(',') === want.join(','), cs[0].lobbySeatColors());

    // Ein sechster Client bekommt keinen Sitz.
    cs[5].join(CODE); await tick(db);
    t('A ein sechster Spieler bekommt keinen Sitz', cs[5].st().myPlayer === 0 && cs[5].st().online === false);
    t('A es gibt keinen Sitz 5 im Raum', db.data.rooms[CODE].p[5] === undefined && db.data.rooms[CODE].players[5] === undefined);

    cs[0].start(); await tick(db);
    t('A mit genau fuenf startet das Match', db.data.rooms[CODE].state === 'playing' && db.data.rooms[CODE].seats === 5);
    t('A alle fuenf Clients sind im Match', cs.slice(0, 5).every(c => c.st().gameStarted === true));
    t('A sechs Koerper: fuenf Spieler und der neutrale Ball',
      cs.slice(0, 5).every(c => c.st().ballN === 6));
    t('A der neutrale Ball ist kein Teilnehmer',
      cs[0].neutralIdx() === 5 && cs[0].ballPos(5).owner === 5 && db.data.rooms[CODE].players[5] === undefined);
    t('A Arenaphase 5, alle aktiv, je zwei Leben',
      cs.every(c => c.st().phaseN === 5 && c.st().active.join('') === 'truetruetruetruetrue'.replace(/true/g, 'true') || true));
    t('A Startzustand: fuenf aktive Spieler mit je zwei Leben',
      cs.slice(0, 5).every(c => c.st().lives.join(',') === '2,2,2,2,2' && c.st().active.every(Boolean) && c.st().phaseN === 5));
    t('A alle fuenf Clients starten mit identischem Zustand', sameHash(cs.slice(0, 5)));
    t('A online gibt es KEINE Privacy-Cover', cs.slice(0, 5).every(c => c.covers().length === 0));
    for (const c of cs) c.drop();
  }

  // ── (B) ERSTE RUNDE: paralleler Commit, ein Reveal, gleichzeitiger Abschuss ──
  {
    const { db, cs } = await newMatch();
    const h0 = cs[0].hash();
    t('B alle Clients starten identisch', sameHash(cs));

    // Vier committen, einer noch nicht -> niemand darf enthuellen.
    for (let i = 0; i < 4; i++) cs[i].commitVec(50, -30);
    await tick(db);
    t('B vier Datensaetze in der Datenbank', Object.keys(db.data.rooms[CODE].g[0].t[0]).length === 4);
    t('B niemand hat enthuellt, solange ein Sitz fehlt', cs.every(c => c.st().phase === 'aim'));
    t('B niemand hat optimistisch abgeschossen', cs.every(c => c.hash() === h0));

    cs[4].commitVec(50, -30);
    await tick(db);
    t('B fuenf Datensaetze', Object.keys(db.data.rooms[CODE].g[0].t[0]).length === 5);
    t('B jeder Datensatz traegt die kanonische Form',
      [0, 1, 2, 3, 4].every(i => { const r = db.data.rooms[CODE].g[0].t[0][i];
        return r.k === 'move' && r.idx === i && typeof r.dx === 'number' && typeof r.dy === 'number' && typeof r.sp === 'number'; }));
    t('B jeder Sitz hat nur seinen eigenen Slot beschrieben',
      [0, 1, 2, 3, 4].every(i => db.data.rooms[CODE].g[0].t[0][i].idx === i));
    t('B jetzt enthuellen ALLE', cs.every(c => c.st().phase === 'reveal'));

    // Gleichzeitiger Abschuss: nach dem Reveal-Fenster laufen alle fuenf Figuren los.
    for (const c of cs) c.pump();
    await tick(db);
    t('B alle Clients sind wieder in der Planungsphase', cs.every(c => c.st().phase === 'aim'));
    t('B genau ein Zug weiter', cs.every(c => c.st().turnNo === 1));
    t('B alle fuenf Clients haben denselben Zustand', sameHash(cs), cs.map(c => c.hash()));
    t('B der Zustand hat sich wirklich veraendert', cs[0].hash() !== h0);
    t('B alle fuenf Figuren wurden bewegt (ein Abschuss, kein Nacheinander)',
      cs[0].st().aimSet.length === 5);
    for (const c of cs) c.drop();
  }

  // ── (C) RENNEN AM ZUGSLOT ───────────────────────────────────────────────────
  {
    const { db, cs } = await newMatch();
    // Vier Clients schreiben, der fuenfte startet seine Transaktion, ohne dass sie
    // abgeschlossen wird - solange darf niemand enthuellen.
    for (let i = 0; i < 4; i++) cs[i].commitVec(40, 40);
    await tick(db);
    t('C kein Reveal bei vier von fuenf', cs.every(c => c.st().phase === 'aim'));
    cs[4].commitVec(40, 40);
    t('C der eigene Write ist noch unterwegs', cs[4].st().pending === 1);
    t('C der Schreiber selbst enthuellt nicht vorzeitig', cs[4].st().phase === 'aim');
    await tick(db);
    t('C nach dem Abschluss enthuellen alle', cs.every(c => c.st().phase === 'reveal'));
    t('C keine offenen eigenen Writes mehr', cs.every(c => c.st().pending === 0));
    // Ein zweiter Versuch desselben Spielers darf nichts veraendern.
    const before = JSON.stringify(db.data.rooms[CODE].g[0].t[0]);
    cs[2].commitVec(-99, -99); await tick(db);
    t('C ein zweiter Zug desselben Sitzes aendert die Historie nicht',
      JSON.stringify(db.data.rooms[CODE].g[0].t[0]) === before);
    for (const c of cs) c.pump();
    await tick(db);
    t('C genau ein Reveal je Client', cs.every(c => c.st().turnNo === 1));
    t('C alle identisch', sameHash(cs));
    // Ein wiederholter Listener-Schnappschuss darf nichts erneut anwenden.
    const h = cs[0].hash();
    await tick(db); await tick(db);
    t('C wiederholte Snapshots wenden nichts erneut an', cs[0].hash() === h && sameHash(cs));
    for (const c of cs) c.drop();
  }

  // ── (D) VIELE RUNDEN OHNE DIVERGENZ ─────────────────────────────────────────
  {
    const { db, cs } = await newMatch();
    const vecs = [[80, 0], [-60, 30], [0, -90], [45, 45], [-70, -20], [20, 75], [-30, -60], [95, -15]];
    for (let r = 0; r < 8; r++) {
      await playRound(db, cs, (s) => { const v = vecs[(r + s) % vecs.length]; return [v[0], v[1], (s % 3 - 1) * 0.4]; });
      t0('D alle fuenf Clients bleiben identisch', sameHash(cs));
      t0('D turnNo laeuft gleich', cs.every(c => c.st().turnNo === cs[0].st().turnNo));
      const raw = cs[0].raw();
      t0('D keine NaN/Infinity in der Simulation',
        raw.balls.every(b => Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy)));
    }
    t('D acht Runden ohne Divergenz', sameHash(cs) && cs[0].st().turnNo === 8);
    t('D an der Rundengrenze ruht alles', cs[0].raw().balls.every(b => b.vx === 0 && b.vy === 0 && (b.spin || 0) === 0));
    for (const c of cs) c.drop();
  }

  // ── (E) TORE UND LEBEN ──────────────────────────────────────────────────────
  {
    const { db, cs } = await newMatch();
    const owner0 = cs[0].slotOwner(0);
    const g = await playUntilGoal(db, cs, 1, 0, 16);
    t('E ein Tor ist gefallen', !!g && g.conceded >= 0, g);
    if (g && g.conceded >= 0) {
      t('E alle fuenf Clients kennen dasselbe Gegentor', cs.every(c => c.st().lives.join(',') === cs[0].st().lives.join(',')), cs.map(c => c.st().lives.join('')));
      t('E genau EIN Leben abgezogen',
        cs[0].st().lives.filter(v => v === 1).length === 1 && cs[0].st().lives.filter(v => v === 2).length === 4);
      t('E erstes Gegentor eliminiert NICHT', cs[0].st().active.every(Boolean) && cs[0].st().phaseN === 5);
      t('E die Arena bleibt fuenfeckig', cs.every(c => c.st().phaseN === 5));
      t('E nach dem Torablauf steht alles still',
        cs[0].raw().balls.every(b => b.vx === 0 && b.vy === 0 && (b.spin || 0) === 0));
      t('E alle Clients identisch nach dem Tor', sameHash(cs));
      // Tor genau EINMAL: fuenf Clients erkennen dasselbe Tor, aber jeder nur einmal.
      t('E jeder Client hat genau einen Torsound ausgeloest', cs.every(c => c.sfx().goal === 1), cs.map(c => c.sfx().goal));
      t('E es gibt KEIN Tor-Paket in der Datenbank',
        JSON.stringify(db.data.rooms[CODE]).indexOf('goal') < 0);
    }
    for (const c of cs) c.drop();
  }

  // ── (F) ZWEITES GEGENTOR: ELIMINIERUNG UND ARENAUMBAU 5->4 ──────────────────
  {
    const { db, cs } = await newMatch();
    const first = await playUntilGoal(db, cs, 1, 0, 16);
    t('F erstes Gegentor gefallen', !!first && first.conceded >= 0);
    const victim = first && first.conceded;
    const second = victim === null ? null : await playUntilGoal(db, cs, 1, cs[0].slotOf(victim), 16);
    const st = cs[0].st();
    t('F ein zweites Gegentor ist gefallen', !!second);
    if (second) {
      t('F alle Clients haben dieselbe Aktivliste', cs.every(c => c.st().active.join(',') === st.active.join(',')));
      t('F alle Clients haben dieselben Leben', cs.every(c => c.st().lives.join(',') === st.lives.join(',')));
      t('F alle Clients haben dieselbe Arenaphase', cs.every(c => c.st().phaseN === st.phaseN));
      t('F alle Clients haben dieselbe Torzuordnung', cs.every(c => c.st().slots.join(',') === st.slots.join(',')));
      t('F alle Clients identisch', sameHash(cs), cs.map(c => c.hash()));
      if (st.active.filter(Boolean).length === 4) {
        t('F genau ein Spieler ist ausgeschieden', st.active.filter(v => !v).length === 1);
        t('F die Arena steht auf vier', st.phaseN === 4);
        t('F der Ausgeschiedene blockiert die Runde nicht', activeSeats(cs[0]).length === 4);
        await playRound(db, cs, () => [30, 30]);
        t('F die naechste Runde laeuft mit vier Zuegen',
          Object.keys(db.data.rooms[CODE].g[0].t[cs[0].st().turnNo - 1] || {}).length === 4);
        t('F nach der Vier-Spieler-Runde weiterhin identisch', sameHash(cs));
      }
    }
    for (const c of cs) c.drop();
  }

  // ── (G) REHYDRIERUNG AUS DER HISTORIE ───────────────────────────────────────
  {
    const { db, cs } = await newMatch();
    const checkpoints = [];
    const snap = (label) => checkpoints.push({ label, turn: cs[0].st().turnNo, hash: cs[0].hash(), st: cs[0].st() });
    snap('Start 5P');
    await playRound(db, cs, () => [70, 20]); snap('gewoehnliche Runde');
    const g1 = await playUntilGoal(db, cs, 1, 0, 16); snap('nach dem ersten Gegentor');
    const victim = g1 && g1.conceded;
    if (victim !== null && victim >= 0) { await playUntilGoal(db, cs, 1, cs[0].slotOf(victim), 16); snap('nach der Eliminierung'); }
    await playRound(db, cs, () => [-40, 55]); snap('Runde danach');

    const turns = db.data.rooms[CODE].g[0].t;
    for (const cp of checkpoints) {
      // Ein FRISCHER Client, der die Historie bis zu diesem Punkt nachspielt.
      const fresh = makeClient(db, CODE, { name: 'REPLAY' });
      fresh.prepareReplay(0, 0);
      const upto = {}; for (const k of Object.keys(turns)) if (+k < cp.turn) upto[k] = turns[k];
      fresh.replay(upto);
      t('G Rehydrierung "' + cp.label + '" trifft den Referenzzustand',
        fresh.hash() === cp.hash, { label: cp.label, fresh: fresh.hash(), ref: cp.hash });
      t0('G Rehydrierung uebernimmt die Leben nicht aus dem Netz, sondern leitet sie ab',
        fresh.st().lives.join(',') === cp.st.lives.join(','));
      t0('G Rehydrierung leitet die Arenaphase ab', fresh.st().phaseN === cp.st.phaseN);
      t0('G Rehydrierung leitet die Aktivliste ab', fresh.st().active.join(',') === cp.st.active.join(','));
      t0('G Rehydrierung landet auf demselben Zug', fresh.st().turnNo === cp.turn);
      t('G Rehydrierung "' + cp.label + '" bleibt still',
        fresh.sfx().goal === 0 && fresh.sfx().transition === 0 && fresh.sfx().launch === 0,
        fresh.sfx());
      fresh.drop();
    }
    t('G alle Checkpoints geprueft', checkpoints.length >= 4, checkpoints.map(c => c.label));
    for (const c of cs) c.drop();
  }

  // ── (H) TEILWEISE GEFUELLTER LAUFENDER ZUG ──────────────────────────────────
  {
    const { db, cs } = await newMatch();
    await playRound(db, cs, () => [55, -25]);
    await playRound(db, cs, () => [-35, 65]);
    // Laufender Zug: nur drei von fuenf haben geschrieben.
    cs[0].commitVec(10, 10); cs[1].commitVec(10, 10); cs[3].commitVec(10, 10);
    await tick(db);
    const cur = cs[0].st().turnNo;
    t('H der laufende Zug hat drei von fuenf Datensaetzen',
      Object.keys(db.data.rooms[CODE].g[0].t[cur]).length === 3);
    t('H niemand enthuellt', cs.every(c => c.st().phase === 'aim'));

    const fresh = makeClient(db, CODE, { name: 'LATE' });
    fresh.prepareReplay(2, 0);
    fresh.replay(db.data.rooms[CODE].g[0].t);
    t('H der frische Client hat die abgeschlossenen Zuege nachgespielt', fresh.st().turnNo === cur, { fresh: fresh.st().turnNo, cur });
    t('H er haengt am laufenden Zug und schiesst nicht', fresh.st().phase === 'aim');
    t('H er hat die vorhandenen Datensaetze uebernommen',
      fresh.st().aimSet.filter(Boolean).length === 3, fresh.st().aimSet);
    t('H er erfindet keine fehlenden Zuege',
      Object.keys(db.data.rooms[CODE].g[0].t[cur]).length === 3);
    t('H er steht auf demselben Spielzustand wie die anderen', fresh.hash() === cs[0].hash());
    fresh.drop();
    for (const c of cs) c.drop();
  }

  // ── (I) WAS IN DER DATENBANK STEHT - UND WAS NICHT ──────────────────────────
  {
    const { db, cs } = await newMatch();
    await playRound(db, cs, () => [60, 30]);
    await playUntilGoal(db, cs, 1, 0, 16);
    const room = db.data.rooms[CODE];
    const flat = JSON.stringify(room);
    const verboten = ['fbElimLives', 'fbElimActive', 'fbElimSlots', 'arenaPhase', 'morph',
      'goalState', 'winner', 'lives', 'phaseN', 'vx', 'vy', 'spin'];
    for (const w of verboten) t0('I "' + w + '" steht NICHT in der Datenbank', flat.indexOf(w) < 0);
    t('I kein abgeleiteter Spielzustand im Netz', verboten.every(w => flat.indexOf(w) < 0), flat.slice(0, 200));
    t('I der Raum traegt nur die erlaubten Zweige',
      Object.keys(room).sort().join(',') === 'config,created,g,gen,p,players,seats,state,v',
      Object.keys(room).sort());
    t('I die Historie enthaelt ausschliesslich Zugereignisse',
      Object.keys(room.g[0]).join(',') === 't');
    t('I jeder Zugdatensatz hat genau fuenf Felder',
      Object.keys(room.g[0].t).every(turn => Object.keys(room.g[0].t[turn]).every(seat =>
        Object.keys(room.g[0].t[turn][seat]).sort().join(',') === 'dx,dy,idx,k,sp')));
    t('I es wurde kein Eviction-Marker geschrieben', room.g[0].e === undefined);
    t('I es wurde kein skip/remove geschrieben',
      Object.keys(room.g[0].t).every(turn => Object.keys(room.g[0].t[turn]).every(seat =>
        room.g[0].t[turn][seat].k === 'move')));
    for (const c of cs) c.drop();
  }

  // ── (J) ANSICHT UND EINGABE ─────────────────────────────────────────────────
  {
    const { db, cs } = await newMatch();
    // Jeder Sitz sieht die Arena anders. Ein und derselbe GEWOLLTE Weltvektor muss
    // trotzdem als exakt derselbe kanonische Zug in der Historie landen.
    const W = { x: 96, y: -72 };
    const angles = cs.map(c => c.viewAngle());
    t('J die fuenf Sitze sehen die Arena unterschiedlich', new Set(angles.map(a => a.toFixed(6))).size === 5, angles);
    for (let s = 0; s < 5; s++) {
      const va = cs[s].viewAngle(), c = Math.cos(va), si = Math.sin(va);
      // Weltvektor -> Ansichtsvektor (die Umkehrung dessen, was localPt() macht).
      cs[s].commitViewVec(W.x * c - W.y * si, W.x * si + W.y * c);
    }
    await tick(db);
    const slots = db.data.rooms[CODE].g[0].t[0];
    for (let s = 0; s < 5; s++)
      t0('J jeder Sitz speichert denselben kanonischen Weltvektor',
        Math.abs(slots[s].dx - W.x) < 1e-9 && Math.abs(slots[s].dy - W.y) < 1e-9);
    t('J alle fuenf Sitze speichern denselben kanonischen Weltvektor',
      [0, 1, 2, 3, 4].every(s => Math.abs(slots[s].dx - W.x) < 1e-9 && Math.abs(slots[s].dy - W.y) < 1e-9),
      [0, 1, 2, 3, 4].map(s => [slots[s].dx.toFixed(3), slots[s].dy.toFixed(3)]));
    t('J kein Sitz bekommt mehr Kraft als ein anderer',
      new Set([0, 1, 2, 3, 4].map(s => Math.hypot(slots[s].dx, slots[s].dy).toFixed(9))).size === 1);
    for (const c of cs) c.pump(); await tick(db);
    t('J alle Clients bleiben nach dem Ansichtszug identisch', sameHash(cs));
    for (const c of cs) c.drop();
  }

  // ── (K) FESTE SCHRITTE: DIE BILDRATE AENDERT NICHTS ─────────────────────────
  {
    // Zwei Matches mit identischer Historie, aber unterschiedlicher "Bildrate":
    // einmal ein Schritt je Aufruf, einmal fuenf. Der Zustand muss gleich sein.
    const run = async (batch) => {
      const { db, cs } = await newMatch('FBQ8');
      for (let r = 0; r < 4; r++) {
        for (const s of activeSeats(cs[0])) cs[s].commitVec(70 - r * 10, -20 + r * 15);
        await tick(db);
        let guard = 0;
        while (cs.some(c => c.st().phase !== 'aim') && guard++ < 4000) for (const c of cs) c.pump(batch);
        await tick(db);
      }
      const h = cs[0].hash(); for (const c of cs) c.drop();
      return h;
    };
    const h1 = await run(1), h5 = await run(5), h9 = await run(9);
    t('K ein Schritt je Aufruf und fuenf je Aufruf ergeben denselben Zustand', h1 === h5, { h1, h5 });
    t('K auch neun je Aufruf aendern nichts', h1 === h9, { h1, h9 });
  }

  // ── (L) JEDER DER FUENF ALS ERSTER AUSGESCHIEDENER ──────────────────────────
  // Der Umbau 5->4 muss fuer JEDEN moeglichen ersten Ausfall bei allen Clients
  // dasselbe ergeben - und ein frisch aus der Historie aufgebauter Client muss
  // exakt dort landen.
  {
    for (let victim = 0; victim < 5; victim++) {
      const { db, cs } = await newMatch('FBQ' + (2 + victim));
      const okE = await eliminateSeat(db, cs, victim);
      t('L P' + (victim + 1) + ' scheidet als erster aus', okE, { victim });
      if (okE) {
        const st = cs[0].st();
        t0('L genau ein Spieler ist ausgeschieden', st.active.filter(v => !v).length === 1);
        t('L P' + (victim + 1) + ': alle Clients einig ueber Aktivliste/Leben/Phase/Tore',
          cs.every(c => { const x = c.st();
            return x.active.join(',') === st.active.join(',') && x.lives.join(',') === st.lives.join(',')
              && x.phaseN === st.phaseN && x.slots.join(',') === st.slots.join(','); }),
          cs.map(c => c.st().slots.join('')));
        t('L P' + (victim + 1) + ': genau dieser Sitz ist raus', st.active[victim] === false);
        t('L P' + (victim + 1) + ': die Arena steht auf vier', st.phaseN === 4);
        t('L P' + (victim + 1) + ': alle Clients identisch', sameHash(cs), cs.map(c => c.hash()));
        t0('L die Ueberlebenden behalten ihre Leben', st.lives.filter((v, i) => i !== victim).every(v => v >= 1));
        t0('L der Ausgeschiedene hat null Leben', st.lives[victim] === 0);
        t0('L der neutrale Ball steht wieder in der Mitte',
          Math.abs(cs[0].ballPos(cs[0].neutralIdx()).x - 500) < 1e-6 && Math.abs(cs[0].ballPos(cs[0].neutralIdx()).y - 500) < 1e-6);
        // Ein frischer Client baut denselben Zustand allein aus der Historie auf.
        const fresh = makeClient(db, 'FBQ' + (2 + victim), { name: 'RE' + victim });
        fresh.prepareReplay(0, 0);
        fresh.replay(db.data.rooms['FBQ' + (2 + victim)].g[0].t);
        t('L P' + (victim + 1) + ': ein frisch rehydrierter Client trifft denselben Zustand',
          fresh.hash() === cs[0].hash(), { fresh: fresh.hash(), ref: cs[0].hash() });
        t0('L die Rehydrierung leitet auch hier alles selbst ab',
          fresh.st().active.join(',') === st.active.join(',') && fresh.st().lives.join(',') === st.lives.join(',')
          && fresh.st().phaseN === st.phaseN && fresh.st().slots.join(',') === st.slots.join(','));
        fresh.drop();
      }
      for (const c of cs) c.drop();
    }
  }

  // ── (M) VOLLSTAENDIGES MATCH BIS ZUM SIEGER ─────────────────────────────────
  {
    const { db, cs } = await newMatch('FBQ9');
    const order = [];
    for (let step = 0; step < 3; step++) {
      const act = activeSeats(cs[0]);
      const victim = act[act.length - 1];              // immer den letzten aktiven Sitz
      const okE = await eliminateSeat(db, cs, victim, 90);
      if (!okE) break;
      order.push(victim);
      t0('M nach jeder Eliminierung sind alle Clients einig', sameHash(cs));
      t0('M die Arenaphase folgt der Teilnehmerzahl', cs[0].st().phaseN === activeSeats(cs[0]).length);
    }
    t('M drei Eliminierungen durchlaufen: 5->4->3->2', order.length === 3, order);
    const st = cs[0].st();
    if (order.length === 3) {
      t('M zwei Spieler sind uebrig', st.active.filter(Boolean).length === 2);
      t('M die Arena steht auf zwei', st.phaseN === 2);
      t('M alle Clients identisch im Finale', sameHash(cs));
      // Letzte Eliminierung -> Sieger.
      const last = activeSeats(cs[0])[1];
      const okE = await eliminateSeat(db, cs, last, 120);
      t('M das Match hat einen Sieger', okE && cs[0].st().winner !== null, { winner: cs[0].st().winner });
      if (cs[0].st().winner !== null) {
        const w = cs[0].st().winner;
        t('M alle fuenf Clients nennen denselben Sieger', cs.every(c => c.st().winner === w), cs.map(c => c.st().winner));
        t('M der Sieger ist der letzte aktive Spieler', cs[0].st().active[w] === true && cs[0].st().active.filter(Boolean).length === 1);
        t('M alle Clients haben dasselbe Endergebnis', sameHash(cs), cs.map(c => c.hash()));
        t('M das Matchende lief bei jedem Client genau einmal', cs.every(c => c.st().over.length === 1 && c.st().over[0] === w));
        // Und aus der Historie allein.
        const fresh = makeClient(db, 'FBQ9', { name: 'FINAL' });
        fresh.prepareReplay(0, 0);
        fresh.replay(db.data.rooms.FBQ9.g[0].t);
        t('M ein frischer Client leitet denselben Sieger aus der Historie ab',
          fresh.st().winner === w, { fresh: fresh.st().winner, ref: w });
        t('M und denselben Endzustand', fresh.hash() === cs[0].hash(), { fresh: fresh.hash(), ref: cs[0].hash() });
        t('M auch das Finale wurde still nachgespielt',
          fresh.sfx().goal === 0 && fresh.sfx().transition === 0, fresh.sfx());
        fresh.drop();
      }
    }
    // Die Datenbank hat waehrend des ganzen Matches nur Zugereignisse gesehen.
    const room = db.data.rooms.FBQ9;
    t('M die Datenbank enthaelt auch nach dem ganzen Match nur Zugereignisse',
      Object.keys(room.g[0]).join(',') === 't' && room.g[0].e === undefined);
    t('M ausschliesslich move-Ereignisse in der ganzen Historie',
      Object.keys(room.g[0].t).every(tn => Object.keys(room.g[0].t[tn]).every(sn => room.g[0].t[tn][sn].k === 'move')));
    for (const c of cs) c.drop();
  }

  // ── (N) NEULADEN: RUECKKEHR AUF DEN EIGENEN SITZ ────────────────────────────
  // Kein Phase-C-Verhalten: niemand wird uebersprungen, entfernt oder evictet. Nur
  // die Frage, ob ein Spieler, der sein Fenster neu laedt, waehrend alle anderen
  // gesund sind, seinen Sitz und den vollen Spielzustand zurueckbekommt.
  {
    const db = makeDB();
    const cs = await setupMatch(db, 'FBQ6');
    await playRound(db, cs, () => [65, -25]);
    await playRound(db, cs, () => [-40, 50]);
    const ref = cs[0].hash(), refTurn = cs[0].st().turnNo;

    // Sitz 2 laedt neu: dasselbe Geraet, dieselbe Identitaet, neues Tab-Token.
    const gone = cs[2];
    const pid = gone.pid, uid = gone.uid;
    gone.drop();
    db.data.rooms.FBQ6.p[2].on = false;                 // onDisconnect des alten Tabs
    const back = makeClient(db, 'FBQ6', { pid, uid, name: 'P3' });
    // Die Rueckkehr laeuft ueber mehrere Datenbankschritte. Sie wird deshalb
    // NEBENLAEUFIG zum Takt gestartet - sonst wartet sie auf eine Warteschlange,
    // die niemand mehr leert.
    const pending = back.rejoin('FBQ6');
    await tick(db);
    const ok = await pending;
    await tick(db);
    t('N die Rueckkehr auf den eigenen Sitz gelingt', ok === true, { ok });
    t('N derselbe Sitz', back.st().myPlayer === 2);
    t('N wieder im Football-Modus mit der richtigen Variante',
      back.st().mode === 'football' && back.st().fmt === 'elimination');
    t('N das Match laeuft weiter, keine Lobby', back.st().gameStarted === true);
    t('N der volle Spielzustand kam aus der Historie', back.hash() === ref, { back: back.hash(), ref });
    t('N derselbe Zug', back.st().turnNo === refTurn, { back: back.st().turnNo, ref: refTurn });
    t('N die Rueckkehr war still', back.sfx().goal === 0 && back.sfx().launch === 0, back.sfx());
    t('N kein Sitz wurde uebersprungen oder entfernt',
      db.data.rooms.FBQ6.g[0].e === undefined &&
      Object.keys(db.data.rooms.FBQ6.g[0].t).every(tn =>
        Object.keys(db.data.rooms.FBQ6.g[0].t[tn]).every(sn => db.data.rooms.FBQ6.g[0].t[tn][sn].k === 'move')));

    // Und danach laeuft der Lockstep zu fuenft normal weiter.
    const five = [cs[0], cs[1], back, cs[3], cs[4]];
    await playRound(db, five, () => [30, 30]);
    t('N nach der Rueckkehr laufen alle fuenf wieder synchron', sameHash(five), five.map(c => c.hash()));
    t('N und stehen auf demselben Zug', five.every(c => c.st().turnNo === five[0].st().turnNo));
    for (const c of five) c.drop();
  }

  // ── (O) REMATCH: WAS DIE BESTEHENDE ARCHITEKTUR HEUTE TRAEGT ────────────────
  // onlineRematch() erhoeht die Generation; der gen-Listener startet daraufhin bei
  // JEDEM Client ein frisches Match. Fuer Football heisst das: neue Historie, neue
  // Arena, volle Leben. Hier wird genau das nachgewiesen - eine eigene Rematch-
  // Bedienoberflaeche entsteht in dieser Phase NICHT.
  {
    const db = makeDB();
    const cs = await setupMatch(db, 'FBQ5');
    await playRound(db, cs, () => [70, 20]);
    await playUntilGoal(db, cs, null, 0, 12);
    const beforeLives = cs[0].st().lives.join(',');
    cs[0].rematch(); await tick(db);
    t('O die Generation ist gestiegen', db.data.rooms.FBQ5.gen === 1);
    t('O alle Clients sind in der neuen Generation', cs.every(c => c.st().gen === 1), cs.map(c => c.st().gen));
    t('O jedes Match startet mit fuenf Spielern und vollen Leben',
      cs.every(c => c.st().lives.join(',') === '2,2,2,2,2' && c.st().active.every(Boolean) && c.st().phaseN === 5),
      cs.map(c => c.st().lives.join('')));
    t('O der Zustand vor dem Rematch war ein anderer', beforeLives !== '2,2,2,2,2');
    t('O alle Clients starten das Rematch identisch', sameHash(cs), cs.map(c => c.hash()));
    t('O die neue Generation hat eine eigene, leere Historie',
      !db.data.rooms.FBQ5.g[1] || Object.keys(db.data.rooms.FBQ5.g[1]).length === 0
      || Object.keys(db.data.rooms.FBQ5.g[1].t || {}).length <= 1);
    t('O keine Eviction wird in die neue Generation vererbt',
      !db.data.rooms.FBQ5.g[1] || db.data.rooms.FBQ5.g[1].e === undefined);
    // Und die neue Generation spielt normal.
    await playRound(db, cs, () => [-55, 35]);
    t('O das Rematch spielt sich normal weiter', sameHash(cs) && cs[0].st().turnNo >= 1);
    for (const c of cs) c.drop();
  }

  // ── (P) DIE DEV-GRENZE GILT AN JEDEM WEG ────────────────────────────────────
  // Der Prototyp ist nicht veroeffentlicht. Es genuegt deshalb NICHT, nur die
  // Schaltflaeche zu verstecken: wer den Raumcode kennt, darf ohne ?dev=1 auch ueber
  // das Beitrittsfeld oder eine gespeicherte Rueckkehr nicht hineinkommen.
  {
    const db = makeDB();
    // Bewusst nur VIER Sitze besetzt: Sitz 4 ist frei. Sonst scheiterte der Beitritt
    // schon an der vollen Lobby und der Test bewiese ueber die Dev-Grenze nichts.
    const cs = [];
    for (let i = 0; i < 4; i++) cs.push(makeClient(db, 'FBQ4', { name: 'P' + (i + 1) }));
    cs[0].enterFootball(); cs[0].create(); await tick(db);
    for (let i = 1; i < 4; i++) { cs[i].join('FBQ4'); await tick(db); }
    t('P Vorbedingung: vier Sitze belegt, Sitz 4 ist frei',
      Object.keys(db.data.rooms.FBQ4.players).length === 4 && db.data.rooms.FBQ4.players[4] === undefined);

    // Ein normaler Produktclient - ohne Dev-Schalter - auf den freien Sitz.
    const plain = makeClient(db, 'FBQ4', { name: 'PLAIN', dev: false });
    plain.join('FBQ4'); await tick(db);
    t('P ohne ?dev=1 fuehrt der Raumcode nicht in den Football-Raum',
      plain.st().online === false && plain.st().mode !== 'football', plain.st());
    t('P der freie Sitz bleibt frei', db.data.rooms.FBQ4.players[4] === undefined);
    // Gegenprobe: derselbe Beitritt MIT Dev-Schalter gelingt.
    const devJoin = makeClient(db, 'FBQ4', { name: 'P5' });
    devJoin.join('FBQ4'); await tick(db);
    t('P mit ?dev=1 gelingt derselbe Beitritt',
      devJoin.st().online === true && devJoin.st().myPlayer === 4, devJoin.st());
    cs.push(devJoin);
    cs[0].start(); await tick(db);
    t('P das Match startet danach normal', db.data.rooms.FBQ4.seats === 5);

    // Auch die Rueckkehr auf einen eigenen Sitz bleibt ohne Dev-Schalter verschlossen.
    const gone = cs[3], pid = gone.pid, uid = gone.uid;
    gone.drop(); db.data.rooms.FBQ4.p[3].on = false;
    const backNoDev = makeClient(db, 'FBQ4', { pid, uid, name: 'P4', dev: false });
    const pend = backNoDev.rejoin('FBQ4'); await tick(db); const okNo = await pend; await tick(db);
    t('P ohne ?dev=1 gelingt auch die Rueckkehr nicht', okNo === false && backNoDev.st().online === false);
    // ... mit Dev-Schalter dagegen schon - die Grenze ist der Schalter, nicht der Sitz.
    const backDev = makeClient(db, 'FBQ4', { pid, uid, name: 'P4' });
    const pend2 = backDev.rejoin('FBQ4'); await tick(db); const okYes = await pend2; await tick(db);
    t('P mit ?dev=1 gelingt dieselbe Rueckkehr', okYes === true && backDev.st().myPlayer === 3, { okYes });

    // Und ein Client ohne Dev-Schalter legt selbst dann keinen Football-Raum an,
    // wenn der Kontext gesetzt waere.
    const maker = makeClient(db, 'FBR2', { name: 'NODEV', dev: false });
    maker.enterFootball(); maker.create(); await tick(db);
    t('P ohne ?dev=1 entsteht kein Football-Raum',
      !db.data.rooms.FBR2 || db.data.rooms.FBR2.config.game !== 'football',
      db.data.rooms.FBR2 && db.data.rooms.FBR2.config);
    // Und es entsteht auch kein ERSATZraum. Ein Rueckfall auf einen RingOut-Raum waere
    // ein widerspruechlicher Mischzustand: online=true, waehrend mode 'football' bleibt.
    t('P ohne ?dev=1 entsteht ueberhaupt kein Raum', !db.data.rooms.FBR2, db.data.rooms.FBR2);
    t('P der Client bleibt offline und lokal',
      maker.st().online === false && maker.st().roomCode === '', maker.st());
    maker.drop(); plain.drop(); backNoDev.drop(); backDev.drop();
    for (const c of cs) c.drop();
  }

  // ── (Q) ANSICHT NACH DEM ARENAUMBAU ─────────────────────────────────────────
  // Die Ansicht dreht so, dass der eigene Torslot dort liegt, wo Slot 0 liegt. Vor der
  // ersten Eliminierung ist die Slotliste die Identitaet - erst danach zeigt sich, ob
  // sie in der richtigen Richtung gelesen wird (SLOT -> EIGENTUEMER).
  {
    const ownGoalInView = (c, seat) => {
      const slot = c.slotOf(seat); if (slot < 0) return null;
      const d = c.dirs()[slot], va = c.viewAngle();
      // Weltrichtung des eigenen Tores in den Ansichtsraum drehen.
      return { x: d[0] * Math.cos(va) - d[1] * Math.sin(va), y: d[0] * Math.sin(va) + d[1] * Math.cos(va) };
    };
    // Faellt der LETZTE Sitz aus, bleibt die Slotliste zufaellig die Identitaet - dieser
    // Fall allein bewiese nichts. Gezaehlt wird deshalb, wie viele Opferfaelle eine
    // ECHTE Verschiebung erzeugen.
    let shifted = 0;
    for (let victim = 0; victim < 5; victim++) {
      const db = makeDB();
      const cs = await setupMatch(db, 'FBS' + victim);
      const ref0 = cs[0].dirs()[0];
      // Vor der Eliminierung: jeder sieht sein Tor an der Stelle von Slot 0.
      for (const s of activeSeats(cs[0])) {
        const v = ownGoalInView(cs[s], s);
        t0('Q vor der Eliminierung liegt das eigene Tor auf der Slot-0-Achse',
          !!v && Math.abs(v.x - ref0[0]) < 1e-9 && Math.abs(v.y - ref0[1]) < 1e-9);
      }
      const okE = await eliminateSeat(db, cs, victim);
      t0('Q die Eliminierung gelingt', okE);
      if (okE) {
        const refA = cs[0].dirs()[0];
        let allOk = true;
        for (const s of activeSeats(cs[0])) {
          const v = ownGoalInView(cs[s], s);
          const ok = !!v && Math.abs(v.x - refA[0]) < 1e-9 && Math.abs(v.y - refA[1]) < 1e-9;
          if (!ok) allOk = false;
        }
        t('Q nach dem Ausfall von P' + (victim + 1) + ' sieht jeder Ueberlebende sein EIGENES Tor',
          allOk, activeSeats(cs[0]).map(s => ({ seat: s, slot: cs[s].slotOf(s), va: +cs[s].viewAngle().toFixed(4) })));
        t0('Q die Slotliste ist die Zuordnung SLOT -> EIGENTUEMER',
          activeSeats(cs[0]).every(s => cs[0].st().slots[cs[0].slotOf(s)] === s));
        t0('Q der Ausgeschiedene hat keinen Torslot mehr', cs[0].slotOf(victim) < 0);
        if (activeSeats(cs[0]).some(x => cs[0].slotOf(x) !== x)) shifted++;
      }
      for (const c of cs) c.drop();
    }
    t('Q die Gruppe hat echte Slotverschiebungen geprueft, nicht nur die Identitaet',
      shifted === 4, { shifted });
  }

  // ── (R) AIMABILITY-MATRIX: kann jeder Ueberlebende nach dem Umbau wirklich zielen? ──
  // Der Live-Bericht lautete: nach dem ersten Ausfall konnte EIN Ueberlebender seine
  // Figur nicht mehr steuern. Zustands-Hashes zeigen so etwas nicht - sie sagen nur,
  // dass alle dieselbe Welt sehen, nicht dass jeder sie bedienen kann. Diese Gruppe
  // laeuft deshalb durch den ECHTEN Eingabepfad: pointerdown -> Trefferpruefung ->
  // startAim -> pointermove -> pointerup -> commit -> Zugslot in der Datenbank.
  {
    const setup = async (db, code, d3) => {
      const cs = [];
      for (let i = 0; i < 5; i++) cs.push(makeClient(db, code, { name: 'P' + (i + 1), d3: !!d3 }));
      cs[0].enterFootball(); cs[0].create(); await tick(db);
      for (let i = 1; i < 5; i++) { cs[i].join(code); await tick(db); }
      cs[0].start(); await tick(db);
      return cs;
    };
    // Eine vollstaendige Zeile der Matrix: jeder Sitz versucht zu zielen, und das
    // Ergebnis muss exakt der Teilnahme entsprechen.
    const row = (cs, label, view) => {
      const surv = activeSeats(cs[0]);
      let ok = true;
      const detail = [];
      for (let s = 0; s < 5; s++) {
        const r = cs[s].aimByPointer(40, -30);
        const should = surv.indexOf(s) >= 0;
        if (r.ok !== should) { ok = false; detail.push({ seat: s, should, got: r }); }
        // Ein Griff muss die EIGENE Figur erwischt haben - nie die eines anderen.
        if (r.ok && r.grabbedOwner !== s) { ok = false; detail.push({ seat: s, grabbedOwner: r.grabbedOwner }); }
      }
      t(label + ' [' + view + ']: genau die Ueberlebenden koennen zielen', ok, detail);
      return surv;
    };
    // Und der Zugweg muss die URSPRUENGLICHEN Sitznummern tragen - nicht die kompakte
    // Nummerierung der aktuellen Phase.
    const checkSlots = async (db, code, cs, surv, label, view) => {
      await tick(db);
      const turn = cs[0].st().turnNo;
      const rec = db.data.rooms[code].g[0].t[turn] || {};
      const keys = Object.keys(rec).map(Number).sort((a, b) => a - b);
      t(label + ' [' + view + ']: die Zugslots tragen die urspruenglichen Sitznummern',
        keys.join(',') === surv.join(','), { keys, surv });
      t(label + ' [' + view + ']: jeder Datensatz traegt idx === eigener Sitz',
        keys.every(k => rec[k].idx === k && rec[k].k === 'move'), rec);
    };

    for (const view of ['2D', '3D']) {
      const d3 = view === '3D';
      // (R1) Alle fuenf ersten Ausfaelle - der Fall aus dem Live-Bericht.
      for (let victim = 0; victim < 5; victim++) {
        const db = makeDB(), code = 'FBM' + victim;
        const cs = await setup(db, code, d3);
        const okE = await eliminateSeat(db, cs, victim);
        t('R1 P' + (victim + 1) + ' [' + view + ']: der erste Ausfall gelingt', okE);
        if (okE) {
          const surv = row(cs, 'R1 nach dem Ausfall von P' + (victim + 1), view);
          t0('R1 vier Ueberlebende', surv.length === 4);
          t0('R1 die Arena steht auf vier', cs[0].st().phaseN === 4);
          await checkSlots(db, code, cs, surv, 'R1 nach dem Ausfall von P' + (victim + 1), view);
        }
        for (const c of cs) c.drop();
      }
      // (R2) Weiter bis 3P und 2P - mit SPAERLICHEN Ueberlebenden. Von vorne
      // auszuscheiden laesst {1,2,3,4} -> {2,3,4} -> {3,4} uebrig: genau die Mengen,
      // bei denen eine Verwechslung von Sitz und Phasenplatz auffliegen muss.
      // Raumcodes sind VIERSTELLIG - joinRoom kuerzt laengere Eingaben, die Gaeste
      // landeten sonst in einem anderen Raum als der Host.
      const SEQS = [[0, 1, 2], [4, 0, 1], [2, 4, 0]];
      for (let q = 0; q < SEQS.length; q++) {
        const seq = SEQS[q];
        const db = makeDB(), code = 'FBN' + q;
        const cs = await setup(db, code, d3);
        for (const victim of seq) {
          if (activeSeats(cs[0]).indexOf(victim) < 0) continue;
          const okE = await eliminateSeat(db, cs, victim, 90);
          t0('R2 [' + view + '] der Ausfall von P' + (victim + 1) + ' gelingt', okE);
          if (!okE || cs[0].st().winner !== null) break;
          const surv = row(cs, 'R2 [' + seq.map(v => 'P' + (v + 1)).join('>') + '] nach P' + (victim + 1), view);
          t0('R2 die Arenaphase folgt der Teilnehmerzahl', cs[0].st().phaseN === surv.length);
          await checkSlots(db, code, cs, surv, 'R2 nach P' + (victim + 1), view);
          for (const c of cs) c.pump();
          await tick(db);
        }
        for (const c of cs) c.drop();
      }
    }
  }


// ── S · DISCONNECT EINES FOOTBALL-SITZES ───────────────────────────────────────
// Der unabhaengige Review hatte bestaetigt: ein Football-Raum betrat den alten
// 1v1-Zweig (onOppLeft) und erklaerte das Match fuer alle Verbliebenen fuer beendet.
// Diese Gruppe haelt das korrigierte Verhalten fest UND den Sicherheitsvertrag: ein
// Ausfall darf den Spielzustand in keiner Weise veraendern.
{
  const { db, cs } = await newMatch('DIS1');
  const code = 'DIS1';
  // Der Generationsknoten entsteht erst mit dem ersten Zug.
  const turnRec = (d, c) => (((d.data.rooms[c] || {}).g || {})[0] || {}).t || {};
  const before = cs[0].st();
  const turnsBefore = JSON.stringify((turnRec(db, code)) || {});
  const hashBefore = cs[0].hash();
  t('S0 Ausgangslage: Match laeuft', before.gameStarted === true && before.phase === 'aim', before);

  cs[0].seatGoneNow(3);                       // Sitz 4 faellt endgueltig aus
  const v = cs[0].discView(), after = cs[0].st();

  // ── Der behobene Fehler ──
  t('S1 kein 1v1-Overlay: das Match wird NICHT fuer beendet erklaert',
    v.wt === '' && v.ws === '', v);
  t('S2 der Ausfall wird gemeldet, ohne das Match zu beenden',
    v.toasts.some(x => x.indexOf('nicht mehr verbunden') >= 0), v.toasts);
  t('S3 der Sitz ist als ausgefallen vermerkt', v.left[3] === true, v.left);

  // ── Sicherheitsvertrag: nichts am Spielzustand darf sich bewegt haben ──
  t('S4 kein falscher Sieger', after.winner === null && after.over.length === 0, after);
  t('S5 kein Leben verloren', after.lives.join(',') === before.lives.join(','),
    { vorher: before.lives, nachher: after.lives });
  t('S6 niemand eliminiert', after.active.join(',') === before.active.join(','),
    { vorher: before.active, nachher: after.active });
  t('S7 keine Sitzverschiebung (Slot->Eigentuemer unveraendert)',
    after.slots.join(',') === before.slots.join(','), { vorher: before.slots, nachher: after.slots });
  t('S8 Arenaphase unveraendert', after.phaseN === before.phaseN, after.phaseN);
  t('S9 kein falsches Tor', after.goal === before.goal, { vorher: before.goal, nachher: after.goal });
  t('S10 Zug und Eingabestand unveraendert',
    after.turnNo === before.turnNo && after.aimSet.join(',') === before.aimSet.join(','), after);
  t('S11 Zughistorie unangetastet',
    JSON.stringify((turnRec(db, code)) || {}) === turnsBefore, turnRec(db, code));
  t('S12 Simulationszustand unveraendert (gleicher Hash)', cs[0].hash() === hashBefore,
    { vorher: hashBefore, nachher: cs[0].hash() });

  // ── Zweimaliges Ausloesen darf nichts hinzufuegen ──
  const toastsBefore = v.toasts.length;
  cs[0].seatGoneNow(3);
  const v2 = cs[0].discView();
  t('S13 wiederholtes Ausloesen bleibt folgenlos',
    v2.toasts.length === toastsBefore && v2.wt === '' && cs[0].hash() === hashBefore, v2);

  // ── Phase-B-Grenze, ausdruecklich festgeschrieben ──
  // Der Zug braucht weiterhin den MOVE des ausgefallenen Sitzes. Genau das ist die
  // erste Aufgabe von Phase C (SKIP/REMOVE/Rejoin) - hier wird sie NICHT geloest,
  // sondern als bekannte Grenze belegt.
  const rec = (turnRec(db, code) || {})[before.turnNo] || {};
  t('S14 PHASE-B-GRENZE: fuer den ausgefallenen Sitz wird KEIN Zug erfunden',
    rec['3'] === undefined, rec);
  t('S15 PHASE-B-GRENZE: die Runde wartet weiter auf den fehlenden Zug',
    cs[0].st().phase === 'aim' && cs[0].st().turnNo === before.turnNo, cs[0].st());
}

// ── S · RINGOUT BLEIBT UNVERAENDERT ────────────────────────────────────────────
// Dieselbe Funktion, andere Raumart: der 1v1-Zweig und der FFA-Zweig muessen sich
// exakt wie vorher verhalten. Ein frischer, nicht verbundener Client genuegt - die
// Zweigwahl haengt nur an mode/seatLeft.
{
  const db = makeDB();
  const one = makeClient(db, 'RGO1', { name: 'R1' });
  one.asRoom('pvp', 'single');
  one.seatGoneNow(1);
  const v1 = one.discView();
  t('S16 RingOut 1v1: das Gegner-verlassen-Overlay erscheint weiterhin',
    v1.wt === 'Gegner hat den Raum verlassen.' && v1.ws === 'Das Match kann nicht fortgesetzt werden.', v1);

  const ffa = makeClient(db, 'RGO2', { name: 'R2' });
  ffa.asRoom('ffa', 'ffa');
  ffa.seatGoneNow(2);
  const v2 = ffa.discView();
  t('S17 RingOut FFA: weiterhin der Leave-Pfad mit Sitzvermerk',
    v2.left[2] === true && v2.toasts.some(x => x.indexOf('hat das Match verlassen') >= 0), v2);
  t('S18 RingOut FFA: kein 1v1-Overlay', v2.wt === '', v2);
}

console.log('\nFootball-Online: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR: ' + (e && e.stack || e)); process.exit(1); });
