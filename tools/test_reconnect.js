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
const { grabFunction } = require('./extract.js');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
// Mehrzeilige Funktionen ueber ihre Klammern extrahieren statt ueber ein Zeilenmuster.
const fn = (name) => grabFunction(html, name);
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
  grab(/function fbOnlineRoom\(\)\{[^\n]*/, 'fbOnlineRoom'),
  grab(/let connUnsub=null, presenceRestoreBusy=false, presenceRestorePending=false;/, 'connUnsub'),
  grab(/function presenceCtxValid\(ctx\)\{[\s\S]*?\n\}/, 'presenceCtxValid'),
  grab(/async function restoreOwnPresence\(ctx\)\{[\s\S]*?\n\}/, 'restoreOwnPresence'),
  grab(/async function restorePresencePass\(ctx\)\{[\s\S]*?\n\}/, 'restorePresencePass'),
  grab(/function startPresenceWatch\(\)\{[\s\S]*?\n\}/, 'startPresenceWatch'),
  grab(/function stopPresenceWatch\(\)\{[^\n]*/, 'stopPresenceWatch'),
  grab(/function ffaSeatCap\(\)\{[^\n]*/, 'ffaSeatCap'),
  grab(/function teamOf\(s\)\{[^\n]*/, 'teamOf'),
  grab(/function colorSlot\(owner\)\{[^\n]*/, 'colorSlot'),
  grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls'),
  // newGame()/startRound() rufen drei Haken, die bisher leer gestellt waren. Sie werden
  // stattdessen VOLLSTAENDIG aus index.html uebernommen - inklusive ihrer (kleinen)
  // Aufrufhuellen. Damit fuehrt diese Suite genau denselben Code aus wie der Browser und
  // kann nicht daran vorbeilaufen, wenn einer der Haken spaeter Spielzustand anfasst.
  //   applyFootballHud -> fbHudOn, fbClearHudFx, fbScoreBox, fbElim4
  //   footballResetMatchState -> fbClearSelection, fbElimReset, footballClearGoalFx
  //   cancelAimDrag (ohne weitere Aufrufe)
  grab(/let menuVisible=[^\n]*/, 'menuVisible'),
  grab(/let dragging=false,dragShooter[^\n]*/, 'Drag-Zustand'),
  grab(/let aimPid=-1,spinPid[^\n]*/, 'Zeiger-Zustand'),
  grab(/let fbPopT=\[0,0\],fbScoreShown[^\n]*/, 'HUD-Timer'),
  grab(/let fbGoalState='play';[^\n]*/, 'fbGoalState'),
  grab(/let fbGoalTick=[^\n]*/, 'fbGoalTick'),
  grab(/let footballWinner=null;[^\n]*/, 'footballWinner'),
  grab(/let fbMorphPlan=null;[^\n]*/, 'fbMorphPlan'),
  grab(/let fbMorphSpawn=[^\n]*/, 'fbMorphSpawn'),
  grab(/let fbGoalFxSide=-1;[^\n]*/, 'fbGoalFxSide'),
  grab(/let fbGoalFxStart=[^\n]*/, 'fbGoalFxStart'),
  grab(/const fbSel=\[-1,-1\];/, 'fbSel'),
  grab(/const FOOTBALL_ELIM_MAX_PLAYERS=[^\n]*/, 'FOOTBALL_ELIM_MAX_PLAYERS'),
  grab(/const FOOTBALL_ELIM_START_PLAYERS=[^\n]*/, 'FOOTBALL_ELIM_START_PLAYERS'),
  grab(/const FOOTBALL_ELIM4_PLAYERS=[^\n]*/, 'FOOTBALL_ELIM4_PLAYERS'),
  grab(/const FOOTBALL_VARIANT_ELIM='elimination';/, 'FOOTBALL_VARIANT_ELIM'),
  grab(/const FOOTBALL_VARIANT_ELIM4='elimination4';/, 'FOOTBALL_VARIANT_ELIM4'),
  grab(/function fbElim4\(\)\{[^\n]*/, 'fbElim4'),
  grab(/const FB_ELIM_LIVES=2;[\s\S]*?\nfunction fbElimReset\(\)\{[\s\S]*?\n\}/, 'Elimination-Zustand + Reset'),
  fn('fbElimPlayers'),
  fn('fbClearSelection'),
  fn('footballClearGoalFx'),
  fn('footballResetMatchState'),
  fn('fbHudOn'),
  fn('fbScoreBox'),
  fn('fbClearHudFx'),
  fn('applyFootballHud'),
  fn('cancelAimDrag'),
  // Ring-Out-Pfad: seit der Collapse-Phase liegt er in eigenen Funktionen neben stepSim.
  // Diese Suite prueft die Rehydrierung bitgenau ueber simHash - dazu muss der Auswurf
  // derselbe Produktcode sein wie im Spiel, kein Nachbau.
  grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside'),
  grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts'),
  // Physikphase 4B-2: stepSim loest Daempfung, Settlement und Restitution ueber
  // curFRBall/curFEBall/curSLOWV/curRestBall/curRestBand und ueber ballRad auf. Der Block
  // kommt woertlich aus index.html (dieselbe Spanne wie test_physics_golden.js); ausserhalb
  // mode==='football' liefert footballPhys() null, also gelten exakt die globalen Konstanten.
  grab(/const FOOTBALL_PHYS=\{[\s\S]*?\nfunction curRestPost\(\)[^\n]*/, 'Football-Physik-Accessoren'),
  // Ring-Collapse: newGame() ruft resetCollapseTimer(), stepSim() ruft settleCollapse(),
  // afterResult() ruft collapseRoundEnd(). Der Block wird WOERTLICH uebernommen und ist hier
  // inert - collapseActive() verlangt mode==='bot' && !online, diese Suite spielt online.
  grab(/const MATCH_COLLAPSE_SECONDS=[\s\S]*?\nfunction collapseRoundEnd\(\)\{[\s\S]*?\n\}/, 'Ring-Collapse-Block'),
  // Arena-Football-Weiche, ebenfalls woertlich: mode ist hier nie 'football', fbElim4()
  // liefert also konstant false - genau wie im Produkt ausserhalb des Football-Modus.
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
  fn('fbReady'),
  // Seat-Eigentum haengt an auth.uid: fbUid() liefert sie, fbFailKey() unterscheidet
  // Verbindungs- von Anmeldefehlern. Beide kommen woertlich aus index.html.
  fn('fbUid'),
  fn('fbFailKey'),
  grab(/function rRef\(p\)\{[^\n]*/, 'rRef'),
  grab(/function setStatus\(t\)\{[^\n]*/, 'setStatus'),
  // Protokoll v4: Raumtyp + Football-Kontrakt + kanonische Zugereignisse, woertlich.
  grab(/const ROOM_GAME_RINGOUT=[\s\S]*?\nfunction validateTurnRecord\(rec,game,seat\)\{[\s\S]*?\n\}/, 'Protokoll v4'),
  grab(/function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom'),
  grab(/function pickFreeSeat\(p,max\)\{[^\n]*/, 'pickFreeSeat'),
  grab(/function validateRejoinRoom\(d\)\{[\s\S]*?\n\}/, 'validateRejoinRoom'),
  grab(/function seatCount\(p\)\{[^\n]*/, 'seatCount'),
  grab(/function seatsContiguous\(p,n\)\{[^\n]*/, 'seatsContiguous'),
  grab(/async function claimSeat\(code,op,maxSeats\)\{[\s\S]*?\n\}/, 'claimSeat'),
  // Football-Farbtafel: renderLobby faerbt ueber pcol(), maybeStart benennt die eigene
  // Farbe ueber colSlot4Name. Beides kommt woertlich aus index.html - ausserhalb des
  // Football-Modus liefert pcol() bitgenau PCOLS[i].
  grab(/const NAME_COL=[\s\S]*?\nfunction ncol\(i\)\{[^\n]*/, 'Football-Farbtafel'),
  grab(/function renderLobby\(p\)\{[\s\S]*?\n\}/, 'renderLobby'),
  grab(/function setOnTitle\(ffa\)\{[\s\S]*?\n\}/, 'setOnTitle'),
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
  grab(/function fbSkipBoundary\(\)\{[\s\S]*?\n\}/, 'fbSkipBoundary'),
  grab(/function fbWriteSkip\(s,attempt\)\{[\s\S]*?\n\}/, 'fbWriteSkip'),
  grab(/function fbMaybeSkipOffline\(\)\{[\s\S]*?\n\}/, 'fbMaybeSkipOffline'),
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
  fn('releaseReservation'),
  grab(/async function claimSeatSlot\(code,seat,op,extra\)\{[\s\S]*?\n\}/, 'claimSeatSlot'),
  fn('reclaimSeat'),
  grab(/async function releaseReclaim\(code,seat,dc\)\{[\s\S]*?\n\}/, 'releaseReclaim'),
  fn('reclaimSeatSlot'),
  grab(/function playerRecord\(seat\)\{[^\n]*/, 'playerRecord'),
  grab(/function nameForSeat\(s\)\{[\s\S]*?\n\}/, 'nameForSeat'),
  fn('findOwnSeat'),
  grab(/function rememberRoom\(code,seat\)\{[^\n]*/, 'rememberRoom'),
  grab(/function forgetRoom\(\)\{[^\n]*/, 'forgetRoom'),
  grab(/function savedRoom\(\)\{[\s\S]*?\n\}/, 'savedRoom'),
  grab(/function clearLobbyHostGrace\(\)\{[^\n]*/, 'clearLobbyHostGrace'),
  grab(/function startLobbyHostGrace\(\)\{[\s\S]*?\n\}/, 'startLobbyHostGrace'),
  grab(/function evalLobbyHostPresence\(\)\{[\s\S]*?\n\}/, 'evalLobbyHostPresence'),
  grab(/let matchGraceGen=\{\};/, 'matchGraceGen'),
  grab(/function clearMatchGrace\(s\)\{[^\n]*/, 'clearMatchGrace'),
  grab(/function rearmMatchGrace\(\)\{[\s\S]*?\n\}/, 'rearmMatchGrace'),
  grab(/let serverTimeOffset=0, serverClockReady=false, clockUnsub=null;/, 'serverTimeOffset'),
  grab(/function serverNow\(\)\{[^\n]*/, 'serverNow'),
  grab(/function startServerClock\(\)\{[\s\S]*?\n\}/, 'startServerClock'),
  grab(/function stopServerClock\(\)\{[^\n]*/, 'stopServerClock'),
  grab(/function fbSeatGrace\(s\)\{[\s\S]*?\n\}/, 'fbSeatGrace'),
  grab(/function fbGraceExpired\(s\)\{[^\n]*/, 'fbGraceExpired'),
  grab(/function fbGraceWait\(s\)\{[\s\S]*?\n\}/, 'fbGraceWait'),
  grab(/function fbGraceTimerAction\(s\)\{[\s\S]*?\n\}/, 'fbGraceTimerAction'),
  grab(/let genStartedAt=0, genStartPending=false;/, 'genStartedAt'),
  grab(/function markGenerationStart\(\)\{[\s\S]*?\n\}/, 'markGenerationStart'),
  grab(/function clearGenerationStart\(\)\{[^\n]*/, 'clearGenerationStart'),
  grab(/function fbGraceCtxValid\(ctx\)\{[\s\S]*?\n\}/, 'fbGraceCtxValid'),
  grab(/function fbAbsenceCandidates\(\)\{[\s\S]*?\n\}/, 'fbAbsenceCandidates'),
  grab(/function clearAllMatchGrace\(\)\{[^\n]*/, 'clearAllMatchGrace'),
  grab(/function startMatchGrace\(s\)\{[\s\S]*?\n\}/, 'startMatchGrace'),
  grab(/function clearLeaveState\(\)\{[^\n]*/, 'clearLeaveState'),
  grab(/function rederiveLeaveState\(\)\{[\s\S]*?\n\}/, 'rederiveLeaveState'),
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
    const fmt = room.config && room.config.fmt, key = parts[2];
    if (key === 'p') {
      const seat = +parts[3];
      if (seat >= seatCap(fmt)) throw new Error('PERMISSION_DENIED: seat range');
      // Seat-Ownership: Praesenz eines Sitzes mit fremdem Eigentuemer ist gesperrt.
      // Der frische Claim traegt seine uid im SELBEN Write (merged.players).
      {
        const own = (room.players && room.players[seat]) || null;
        const inWrite = merged.players(seat);
        if (own && own.uid !== undefined && own.uid !== authUid &&
            !(inWrite && inWrite.uid === authUid))
          throw new Error('PERMISSION_DENIED: p owned by another uid');
      }
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
        || Object.keys(val).some(k => k !== 'id' && k !== 'name' && k !== 'tab' && k !== 'uid'))
        throw new Error('PERMISSION_DENIED: players record invalid');
      // ── Seat-Ownership (auth.uid) ──────────────────────────────────────────────
      // uid darf nur die EIGENE sein (Rules: players/<seat>/uid === auth.uid).
      if (val.uid !== undefined && (typeof val.uid !== 'string' || val.uid.length < 1 || val.uid.length > 128 || val.uid !== authUid))
        throw new Error('PERMISSION_DENIED: players uid must be the writer auth.uid');
      // Ein bestehender Eigentuemer ist unveraenderlich, und ein uid-loser Bestandssitz
      // wird nicht inplace migriert. Beides nur ueber die regulaere Neuvergabe.
      if (rec && rec.uid !== undefined && val.uid !== rec.uid)
        throw new Error('PERMISSION_DENIED: players uid immutable');
      if (rec && rec.uid === undefined && val.uid !== undefined)
        throw new Error('PERMISSION_DENIED: no in-place uid migration');
      // Ein fremder Eigentuemer sperrt den Sitz vollstaendig.
      if (rec && rec.uid !== undefined && rec.uid !== authUid)
        throw new Error('PERMISSION_DENIED: players owned by another uid');
      const pVal = merged.p(seat);
      if (!pVal || pVal.s !== val.tab) throw new Error('PERMISSION_DENIED: players needs matching p.s in same write');
      if (rec && rec.id === val.id) return;   // same-id update: id immutable, always ok
      if (rec) throw new Error('PERMISSION_DENIED: players replace denied (foreign id)');
      if (room.state !== 'lobby') throw new Error('PERMISSION_DENIED: players create only in lobby');
      return;
    }
    throw new Error('PERMISSION_DENIED: ' + key);
  }
  function setParts(parts, val, authUid) {
    const pathStr = parts.join('/');
    for (const f of failures) {
      if (f.times > 0 && pathStr.startsWith(f.prefix)) { f.times--; throw new Error('INJECTED_WRITE_FAILURE: ' + pathStr); }
    }
    checkWrite(parts, val, undefined, authUid);
    let o = data;
    for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
    if (val == null) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = JSON.parse(JSON.stringify(val));
    notify();
  }
  const FBfor = (ui, authUid) => ({
    db: null,
    ref: (db, path) => path.split('/'),
    get: async ref => ({ exists: () => at(ref) != null, val: () => clone(at(ref)) }),
    set: async (ref, val) => setParts(ref, val, authUid),
    update: async (ref, obj) => {
      const keys = Object.keys(obj);
      ui.log.push('UPD ' + keys.join(','));
      const paths = keys.map(k => ref.concat(String(k).split('/')));
      for (const p of paths) {
        const pathStr = p.join('/');
        for (const f of failures) {
          if (f.times > 0 && pathStr.startsWith(f.prefix)) { f.times--; throw new Error('INJECTED_WRITE_FAILURE: ' + pathStr); }
        }
      }
      const room = data.rooms[ref[1]];
      const merged = buildMerged(room, keys.map((k, i) => ({ parts: paths[i], val: obj[k] })));
      keys.forEach((k, i) => checkWrite(paths[i], obj[k], merged, authUid));
      keys.forEach((k, i) => {
        let o = data;
        for (let j = 0; j < paths[i].length - 1; j++) { if (o[paths[i][j]] == null) o[paths[i][j]] = {}; o = o[paths[i][j]]; }
        const last = paths[i][paths[i].length - 1];
        if (obj[k] == null) delete o[last]; else o[last] = JSON.parse(JSON.stringify(obj[k]));
      });
      notify();
    },
    remove: async ref => setParts(ref, null, authUid),
    runTransaction: async (ref, updateFn, options) => {
      const current = clone(at(ref));
      const next = updateFn(current);
      if (next === undefined) return { committed: false, snapshot: { val: () => clone(at(ref)), exists: () => at(ref) != null } };
      setParts(ref, next, authUid);
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
      set: async (val) => { const key = ref.join('/'); ui.log.push('ARM ' + key); for (let i = ui.onDrop.length - 1; i >= 0; i--) if (ui.onDrop[i].ref.join('/') === key) ui.onDrop.splice(i, 1); ui.onDrop.push({ ref, val }); },
      cancel: async () => { const key = ref.join('/'); for (let i = ui.onDrop.length - 1; i >= 0; i--) if (ui.onDrop[i].ref.join('/') === key) ui.onDrop.splice(i, 1); }
    }),
    serverTimestamp: () => nowMs
  });
  // .info/connected ist kein Raumpfad und laeuft deshalb an checkWrite vorbei -
  // gesetzt wird direkt am Datenbaum, danach werden die Listener benachrichtigt.
  function setConnected(v) {
    if (!data['.info']) data['.info'] = {};
    data['.info'].connected = v;
    notify();
  }
  // Wie viele Beobachter haengen auf einem Pfad? Ein abgemeldeter Raum darf keinen
  // zurueckgelassenen Listener behalten (C1: kein Leck ueber Raumsitzungen hinweg).
  const listenerCount = (path) => { let n = 0; for (const l of listeners) if (l.parts.join('/') === path) n++; return n; };
  // .info/serverTimeOffset: der Standardweg, mit dem ein Client seine lokale Uhr an die
  // Serverzeit angleicht. Der Test stellt die Serverzeit vor und veroeffentlicht den
  // passenden Offset - das Produkt rechnet dann mit der echten Formel.
  function publishOffset() {
    if (!data['.info']) data['.info'] = {};
    data['.info'].serverTimeOffset = nowMs - Date.now();
    notify();
  }
  return { data, FBfor, failWrite, setConnected, listenerCount, publishOffset, touch: notify,
    // Zeit vorstellen UND den Offset nachziehen: so bewegt sich fuer den Client die
    // Serverzeit, nicht seine eigene Uhr.
    advanceServer: (ms) => { nowMs += ms; publishOffset(); },
    advance: (ms) => { nowMs += ms; }, now: () => nowMs };
}

// findOwnSeat wird zusaetzlich DIREKT geprueft (Gruppe RC-UID2). Der echte Rumpf laeuft
// dafuer in einer Mini-Sandbox - die Sitzaufloesung ist die Stelle, an der Eigentum,
// Legacy-Rueckfall und Mehrdeutigkeit zusammenkommen.
// Die echte Rueckkehrfrist aus index.html - kein im Test geratener Wert.
const SEAT_STALE_FROM_SOURCE = Number((html.match(/const SEAT_STALE_MS=(\d+)/) || [])[1]);
if (!Number.isFinite(SEAT_STALE_FROM_SOURCE)) { console.error('FAIL: cannot extract SEAT_STALE_MS'); process.exit(1); }

const FOS = new Function('FFA_MAX_SEATS', grabFunction(html, 'findOwnSeat') + '\nreturn findOwnSeat;')(5);
// ── one sandboxed client = the REAL online functions + REAL physics ──
function makeClient(db, code, forcePid, forceUid) {
  const ui = { code, log: [], onDrop: [] };
  const seq = (makeClient._seq = (makeClient._seq || 0) + 1);
  const pid = forcePid || ('PID' + String(seq).padStart(6, '0'));
  const tab = 'TAB' + String(seq).padStart(6, '0');
  // auth.uid: an den dauerhaften pid gebunden, damit ein Reload/neuer Tab dieselbe
  // Identitaet mitbringt - so verhaelt sich die anonyme Anmeldung mit Persistenz.
  const uid = forceUid || ('UID_' + pid);
  const FB = db.FBfor(ui, uid);
  const body = `
    const TUNE=false; let r3dOrbit=false, r3dActive=false;
    // Der Online-Football-Prototyp haengt an ?dev=1. Diese Suite spielt RingOut und
    // laeuft deshalb wie ein normaler Produktclient OHNE Dev-Schalter.
    const DEV_MENU=false;
    const T=k=>k;
    const window={__FB_READY:true,__FB_ERR:null,__FB_AUTH_ERR:null,__FB_UID:${JSON.stringify(uid)},FB};
    const document={querySelector:()=>({textContent:'',style:{},classList:{add(){},remove(){},toggle(){}}})};
    const els={}; function $(id){return els[id]||(els[id]={style:{},classList:{add(){},remove(){},toggle(){}},textContent:'',innerHTML:'',value:'',disabled:false,querySelector:()=>({textContent:'',style:{},classList:{add(){},remove(){},toggle(){}}})});}
    let toastT; const toast=m=>{ui.log.push('toast:'+m);};
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){},
      collapse(){},footballGoalStop(){},fbTransitionStop(){},charge:{start(){},stop(){},update(){}}};
    // HUD des Ring-Collapse: reine Anzeige, in einem kopflosen Harness ohne Bedeutung.
    function hideCollapseCount(){} function updateCollapseHud(){}
    // Arena-Football-Zustand. Diese Suite fuehrt KEIN Football-Match (mode ist 'online' bzw.
    // 'ffa'), deshalb ist der Reset hier bewusst wirkungslos. Damit der Haken nicht
    // stillschweigend veraltet, prueft der Block RC-ENV am Dateiende, dass die echte
    // Definition weiterhin existiert und weiterhin ausschliesslich Football-Zustand anfasst.
    // cv: Zeiger-Capture existiert kopflos nicht - cancelAimDrag ruft es best-effort auf.
    const cv={releasePointerCapture(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000})};
    let fbVariant='classic';
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
    // Die Rueckkehrfrist ist Produktvertrag (C3) und wird deshalb aus index.html
    // uebernommen, statt im Sandkasten geraten zu werden.
    const SEAT_STALE_MS=${SEAT_STALE_FROM_SOURCE};
    let roomP={}, matchGraceTimer={}, roomPSeen=false;
    let onlinePid=${JSON.stringify(pid)}, onlineTab=${JSON.stringify(tab)}, onlineName='';
    let playersRoster={}, rosterUnsub=null, lobbyHostGraceTimer=null, joinOpSeq=0;
    let phase='over', phaseStart=0, curAimer=0, balls=[], aimSet=[], commitIdx=[], commitAim=[], commitSpin=[], score=[];
    // dragging/dragShooter/dragOwner kommen jetzt aus dem echten Drag-Zustandsblock
    // (s. Grab 'Drag-Zustand') - hier bleiben nur die beiden Rundenvariablen.
    let outBall=-1,roundWinner=-1;
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
      // TRANSIENTER Abriss: der Server fuehrt die armierten onDisconnect-Writes aus,
      // die Listener dieses Clients bleiben aber bestehen - das SDK verbindet sich im
      // Browser von allein wieder. Genau der Fall aus dem Livelauf.
      netDrop(){ const d=ui.onDrop.slice(); ui.onDrop.length=0;
        for(const {ref,val} of d) FB.set(ref,val).catch(()=>{}); },
      // Zustand fuer die C1-Nachweise - rein lesend.
      // C3-Sonden - rein lesend.
      grace(s){ return fbSeatGrace(s); },
      left(o){ return !!seatLeft[o]; },
      gone(o){ return !!seatGone[o]; },
      graceWait(s){ return fbGraceWait(s); },
      timerAction(s){ return fbGraceTimerAction(s); },
      // Den Weckruf ausloesen, ohne real zu warten: gestellte Serverzeit bewegt
      // setTimeout nicht. Entscheidung und Handler sind die echten.
      fireGrace(s){ const a=fbGraceTimerAction(s); if(a==='act')seatFinallyGone(s); return a; },
      // Der Zustand unmittelbar nach attachRoomListeners: Listener haengen, aber der
      // Praesenz-Callback hat noch nicht geliefert.
      forgetPresenceView(){ roomP={}; roomPSeen=false; },
      rederiveNow(){ rederiveLeaveState(); },
      presenceSeen(){ return roomPSeen; },
      genStart(){ return {at:genStartedAt,pending:genStartPending}; },
      ctxValid(c){ return fbGraceCtxValid(c); },
      ctxNow(){ return {sid:onlineSessionId,room:roomCode,gen:gen}; },
      candidates(){ return fbAbsenceCandidates(); },
      graceTimers(){ const o=[]; for(const k in matchGraceTimer)if(matchGraceTimer[k])o.push({seat:+k,gen:matchGraceGen[k]}); return o; },
      clockReady(){ return serverClockReady; },
      presence(){ return {seat:myPlayer,tab:onlineTab,pid:onlinePid,
        uid:(typeof fbUid==='function'?fbUid():null),gen:gen,turn:turnNo,room:roomCode}; },
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
      // RC-ENV: die drei Haken, die newGame()/startRound() aufrufen, laufen hier als ECHTER
      // Produktcode. Diese Sonde ruft sie einzeln auf und macht ihre Football-Nebenwirkung
      // sichtbar, damit die Suite beweisen kann, dass es sich nicht um Attrappen handelt.
      runHook(name){
        if(name==='footballResetMatchState')footballResetMatchState();
        else if(name==='applyFootballHud')applyFootballHud();
        else if(name==='cancelAimDrag')cancelAimDrag();
        else throw new Error('unbekannter Haken: '+name);
      },
      fbState(){return {goal:fbGoalState,tick:fbGoalTick,winner:footballWinner,
                        lives:fbElimLives.slice(),sel:fbSel.slice(),fxSide:fbGoalFxSide,
                        dragging,aimPid};},
      pokeFbState(){fbGoalState='fall';fbGoalTick=7;footballWinner=1;fbElimLives[0]=0;
                    fbSel[0]=3;fbGoalFxSide=1;dragging=true;aimPid=5;},
      // Beobachteten Zustand auf lauter UNTERSCHEIDBARE Werte setzen. Ohne das koennte ein
      // Haken z. B. balls[0].vx=0 schreiben, ohne dass sich etwas messbar aendert - die
      // Kugeln liegen zwischen zwei Runden ohnehin still. Erst gegen diesen Zustand ist
      // "der Haken aendert nichts" eine belastbare Aussage.
      pokeSim(v){for(let i=0;i<balls.length;i++){const b=balls[i];
                  b.x+=7+i;b.y-=5+i;b.vx=1.5+i;b.vy=-2.5-i;b.spin=0.3+i*0.1;}
                score[0]=1;R=R0*0.93;
                // ABLAUFSTEUERUNG: v waehlt zwischen zwei ENTGEGENGESETZTEN Vorzustaenden.
                // Ein Haken, der ein Flag auf einen festen Wert zwingt (z. B. replaying=true,
                // was im Browser die Matchsimulation abschaltet), veraendert damit in genau
                // einem der beiden Durchgaenge etwas und wird sichtbar. Ein einziger
                // Vorzustand wuerde die eine Haelfte der Faelle verdecken.
                replaying=!!v;repPlaying=!!v;collapseEnabled=!!v;
                collapseState=v?'expired':'running';},
      // Vollstaendiger Schnappschuss dessen, was diese Suite als Zustand betrachtet:
      // Simulationszustand (ueber simHash), Rundenzustand, Online-Sitzung UND die
      // Ablaufsteuerungs-Flags, an denen im Browser der Spiel-Loop haengt.
      fullState(){return JSON.stringify({h:simHash(),phase,outBall,roundWinner,curAimer,
        score,roundNo,R,turnNo,gen,runningGen,gameStarted,online,myPlayer,roomCode,ffaN,fmt,mode,
        aimSet,commitIdx,commitSpin,seatLeft,seatGone,pending:Object.keys(pendingSlot),
        sid:onlineSessionId,term:onlineTerminatedSession,
        replaying,repPlaying,collapseEnabled,collapseState,matchElapsedMs});},
      aliveOf(o){return aliveCount(o);},
      gone(o){return !!seatGone[o];},
      pid(){return onlinePid;},
      uid(){return typeof fbUid==='function'?fbUid():'';},
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

  // ══ RC-ENV: die Football-/HUD-/Drag-Haken laufen als ECHTER Produktcode ══
  // newGame() und startRound() rufen footballResetMatchState(), applyFootballHud() und
  // cancelAimDrag(). Fruehere Fassungen dieser Suite haben sie leer gestellt - dann prueft
  // man aber nur noch, dass zwei gleich unvollstaendige Sandboxes uebereinstimmen. Sie sind
  // deshalb samt ihrer Aufrufhuellen woertlich aus index.html uebernommen. Diese Gruppe misst
  // beides direkt am laufenden Code, statt es aus dem Quelltext zu schliessen:
  //   1. Die Haken sind echt (sie zeigen ihre Football-/Drag-Wirkung).
  //   2. Sie ruehren den Zustand nicht an, den diese Suite vergleicht.
  {
    const db = makeDB();
    const c = makeClient(db, 'ENV1'); c.setMenu('ffa', 2); c.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('ENV1'); await tick();
    c.clickStart(); await tick();

    const c0Hash = c.hash();
    // 1. ECHTHEIT: Football-Zustand verstellen, Haken aufrufen, Wirkung nachweisen.
    c.pokeFbState();
    const dirty = c.fbState();
    t('RC-ENV Vorbedingung: Football-Zustand ist absichtlich verstellt',
      dirty.goal === 'fall' && dirty.winner === 1 && dirty.lives[0] === 0 && dirty.sel[0] === 3);
    c.runHook('footballResetMatchState');
    const reset = c.fbState();
    t('RC-ENV footballResetMatchState ist echter Produktcode (setzt Football-Zustand zurueck)',
      reset.goal === 'play' && reset.tick === 0 && reset.winner === null &&
      reset.lives[0] === 2 && reset.sel[0] === -1 && reset.fxSide === -1,
      reset);
    c.runHook('cancelAimDrag');
    const drag = c.fbState();
    t('RC-ENV cancelAimDrag ist echter Produktcode (raeumt den Zeiger-/Drag-Zustand)',
      drag.dragging === false && drag.aimPid === -1, { dragging: drag.dragging, aimPid: drag.aimPid });

    // Das Match laeuft nach den Hakenaufrufen unveraendert weiter.
    await playTurn([c, g], { 0: [12, -70], 1: [-30, 60] });
    t('RC-ENV Lockstep laeuft nach den Hakenaufrufen synchron weiter',
      c.hash() === g.hash() && c.st().turnNo === g.st().turnNo);

    // 2. WIRKUNGSLOSIGKEIT auf den beobachteten Zustand - GEMESSEN, nicht aus dem Quelltext
    //    geschlossen. Der Vergleich laeuft ueber denselben simHash, mit dem die Suite auch
    //    die Rehydrierung prueft, plus den vollstaendigen Zustandsschnappschuss. Der Zustand
    //    wird vorher bewusst auf unterscheidbare Werte gebracht (pokeSim), damit auch ein
    //    Schreibzugriff wie balls[0].vx=0 sichtbar wuerde.
    c.pokeSim(1);
    const poked = c.hash();
    t('RC-ENV Vorbedingung: der beobachtete Zustand ist unterscheidbar gesetzt',
      poked !== c0Hash && /"replaying":true/.test(c.fullState()) &&
      /"collapseState":"expired"/.test(c.fullState()), { vorher: c0Hash, gepoked: poked });
    for (const v of [1, 0]) {
      c.pokeSim(v);
      for (const hook of ['footballResetMatchState', 'applyFootballHud', 'cancelAimDrag']) {
        const before = c.fullState();
        c.runHook(hook);
        const after = c.fullState();
        t('RC-ENV ' + hook + ' laesst Simulation, Runde, Sitzung und Ablaufsteuerung unveraendert'
          + ' (Vorzustand ' + v + ')',
          after === before, { vorher: before.slice(0, 220), nachher: after.slice(0, 220) });
      }
    }

    // fbElim4 ist ebenfalls woertlich uebernommen: es haengt am Modus und liefert hier false.
    t('RC-ENV fbElim4 haengt am Football-Modus', /mode===.football./.test(grabFunction(html, 'fbElim4')));
    // Die Sandbox-Physik ist echter Produktcode, kein Nachbau.
    t('RC-ENV Physik-Accessoren kommen aus dem Produkt',
      /function curRestBall\(\)\{const c=footballPhys\(\);return c\?c\.restBall:REST;\}/.test(html));
    t('RC-ENV footballPhys ist ausserhalb Football null',
      /function footballPhys\(\)\{return mode==='football'\?FOOTBALL_PHYS:null;\}/.test(html));
  }

  // ══ RC-UID: Seat-Eigentum haengt an auth.uid, nicht an der oeffentlichen Spieler-ID ══
  // players.id ist fuer jeden lesbar, der den Raum kennt. Vor dieser Phase genuegte sie,
  // um einen Sitz zurueckzuholen. Jetzt entscheidet die anonyme auth.uid - dieselbe
  // Kenntnis von id, Name, Sitznummer und Raumcode darf einem Fremden nichts nuetzen.
  {
    const db = makeDB();
    const h = makeClient(db, 'UID1'); h.setMenu('ffa', 3); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('UID1'); await tick();
    const g2 = makeClient(db, 'X'); g2.setMenu('online'); g2.join('UID1'); await tick();
    h.clickStart(); await tick();
    const gpid = g.pid(), guid = g.uid();
    t('RC-UID der Sitz traegt die auth.uid seines Eigentuemers',
      db.data.rooms.UID1.players[1].uid === guid && guid.length > 0);
    t('RC-UID die uid unterscheidet sich von der oeffentlichen Spieler-ID',
      db.data.rooms.UID1.players[1].uid !== db.data.rooms.UID1.players[1].id);

    g.drop(); await tick();

    // 1. Fremde uid, aber die vollstaendige oeffentliche Identitaet des Opfers.
    const thief = makeClient(db, 'X', gpid, 'UID_THIEF_0001');
    thief.setMenu('online');
    const stolen = await thief.rejoin('UID1'); await tick();
    t('RC-UID gleicher pid, ANDERE uid erhaelt den Sitz nicht',
      stolen === false && thief.st().online === false);
    t('RC-UID der Sitz gehoert unveraendert dem Eigentuemer',
      db.data.rooms.UID1.players[1].uid === guid && db.data.rooms.UID1.players[1].id === gpid);

    // 2. Derselbe Mensch kehrt zurueck: gleiche uid, frischer Tab.
    const back = makeClient(db, 'X', gpid, guid); back.setMenu('online');
    const ok = await back.rejoin('UID1'); await tick();
    t('RC-UID gleiche uid bekommt denselben Sitz zurueck',
      ok === true && back.st().online === true && back.st().myPlayer === 1);
    t('RC-UID Sitz, Farbe und Zugehoerigkeit bleiben erhalten',
      db.data.rooms.UID1.players[1].uid === guid && db.data.rooms.UID1.p[1].on === true);

    // 3. Ein zweiter Tab derselben uid uebernimmt einen AKTIVEN Sitz nicht.
    const tab2 = makeClient(db, 'X', gpid, guid); tab2.setMenu('online');
    const dup = await tab2.rejoin('UID1'); await tick();
    t('RC-UID zweiter Tab derselben uid uebernimmt den aktiven Sitz nicht',
      dup === false && tab2.st().online === false && db.data.rooms.UID1.p[1].on === true);

    // 4. Der Zugslot gehoert dem Sitzeigentuemer.
    t('RC-UID nur der Eigentuemer schreibt seinen Zugslot',
      back.commitMove(20, -30) === true);
    await tick();
    t('RC-UID der Zug des Eigentuemers liegt in der Datenbank',
      !!(db.data.rooms.UID1.g && db.data.rooms.UID1.g[0] && db.data.rooms.UID1.g[0].t &&
         db.data.rooms.UID1.g[0].t[0] && db.data.rooms.UID1.g[0].t[0][1]));
  }

  // ══ RC-UID2: mehrdeutige und uid-lose Zustaende ══
  {
    // findOwnSeat entscheidet die Zuordnung. Zwei Datensaetze mit DERSELBEN uid sind ein
    // korrupter Zustand - dann wird nicht geraten, sondern abgelehnt (fail-closed), es
    // sei denn der gespeicherte Rejoin-Hinweis loest die Mehrdeutigkeit eindeutig auf.
    const A = 'UID_AAAA0001', B = 'UID_BBBB0002';
    const rec = (id, tab, uid) => (uid ? { id, name: 'n', tab, uid } : { id, name: 'n', tab });
    const players = { 0: rec('PIDHOST1', 'TABHOST1', A), 1: rec('PIDGUES1', 'TABGUES1', A) };
    t('RC-UID2 zwei Sitze mit derselben uid -> kein Treffer (fail-closed)',
      FOS(players, 'PIDGUES1', A, -1) === -1);
    t('RC-UID2 der gespeicherte Rejoin-Hinweis loest die Mehrdeutigkeit auf',
      FOS(players, 'PIDGUES1', A, 1) === 1);
    t('RC-UID2 ein Hinweis auf einen FREMDEN Sitz zaehlt nicht',
      FOS({ 0: rec('PIDHOST1', 'TABHOST1', A), 1: rec('PIDGUES1', 'TABGUES1', B) }, 'PIDGUES1', A, 1) === 0);
    t('RC-UID2 eindeutiger uid-Treffer gewinnt',
      FOS({ 0: rec('PIDHOST1', 'TABHOST1', A), 1: rec('PIDGUES1', 'TABGUES1', B) }, 'PIDGUES1', B, -1) === 1);
    t('RC-UID2 gleiche oeffentliche id, fremde uid -> abgelehnt',
      FOS({ 1: rec('PIDGUES1', 'TABGUES1', B) }, 'PIDGUES1', A, -1) === -1);
    t('RC-UID2 uid-loser Bestandssitz bleibt ueber die id erreichbar (Legacy)',
      FOS({ 1: rec('PIDGUES1', 'TABGUES1', null) }, 'PIDGUES1', A, -1) === 1);
    t('RC-UID2 ein uid-geschuetzter Sitz ist NIE ueber die id erreichbar',
      FOS({ 1: rec('PIDGUES1', 'TABGUES1', B) }, 'PIDGUES1', '', -1) === -1);
    t('RC-UID2 ohne uid und ohne id kein Treffer', FOS({ 1: rec('P', 'T', B) }, '', '', -1) === -1);
  }


  // ══ C1: TRANSIENTER RECONNECT — PRAESENZ WIEDERHERSTELLEN ══════════════════
  // Live beobachtet: ein kurzer Verbindungsabriss laesst p/<seat>.on auf false stehen.
  // Die Rules verlangen on===true fuer jeden weiteren Zug - der Spieler ist still
  // ausgesperrt, obwohl sein Client laengst wieder verbunden ist und weiter Daten
  // empfaengt. Wiederhergestellt wird ausschliesslich die VERBINDUNG.
  const c1Room = async (code) => {
    const db = makeDB();
    const h = makeClient(db, code); h.setMenu('online'); h.setFmt('single'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join(code); await tick();
    return { db, h, g, room: () => db.data.rooms[code] };
  };
  // Fail closed heisst: der Client versucht es GAR NICHT ERST. Nur den Endzustand zu
  // pruefen genuegt nicht - den weist die Datenbank ohnehin ab, und der Test koennte
  // eine fehlende Pruefung im Client nicht mehr von einer Ablehnung unterscheiden.
  const noAttempt = (g, seat) => !g.ui.log.some(x => x.indexOf('ARM ') === 0)
                              && !g.ui.log.some(x => x.indexOf('UPD p/' + seat) === 0);

  // ── C1-A: der Grundfall, vor dem eigenen Zug ──
  {
    const { db, g, room } = await c1Room('C1AA');
    const before = g.presence(), rec0 = JSON.parse(JSON.stringify(room().players[1]));
    t('C1-A Ausgangslage: Praesenz aktiv', room().p[1].on === true, room().p[1]);

    g.ui.log.length = 0;
    g.netDrop(); await tick();                       // Abriss: Server fuehrt onDisconnect aus
    t('C1-A REPRODUKTION: onDisconnect setzt die eigene Praesenz auf on:false',
      room().p[1].on === false, room().p[1]);

    db.setConnected(true); await tick(12);           // dasselbe SDK verbindet sich wieder
    const after = g.presence(), p = room().p[1];
    t('C1-A die Praesenz ist wiederhergestellt', p.on === true, p);
    t('C1-A gleiches Sitzungstoken', p.s === before.tab, { vorher: before.tab, nachher: p.s });
    t('C1-A gleicher Sitz', after.seat === before.seat && after.seat === 1, after);
    t('C1-A gleiche uid', after.uid === before.uid && room().players[1].uid === before.uid, after);
    t('C1-A gleiche pid', after.pid === before.pid, after);
    t('C1-A der Rosterdatensatz ist unveraendert',
      JSON.stringify(room().players[1]) === JSON.stringify(rec0), room().players[1]);
    t('C1-A kein zusaetzlicher Sitz angelegt', Object.keys(room().players).join(',') === '0,1',
      Object.keys(room().players));

    // ARM VOR ACTIVATE: erst das neue onDisconnect, dann on:true.
    const armAt = g.ui.log.findIndex(x => x.indexOf('ARM ') === 0);
    const actAt = g.ui.log.findIndex(x => x.indexOf('UPD p/1') === 0);
    t('C1-A ARM vor ACTIVATE', armAt >= 0 && actAt >= 0 && armAt < actAt,
      { arm: armAt, activate: actAt, log: g.ui.log.slice(0, 8) });
    t('C1-A ein neues onDisconnect ist armiert',
      g.ui.onDrop.length === 1 && g.ui.onDrop[0].val.on === false, g.ui.onDrop.length);
    t('C1-A und es haengt am EIGENEN Sitzpfad',
      g.ui.onDrop[0] && g.ui.onDrop[0].ref.join('/') === 'rooms/C1AA/p/1',
      g.ui.onDrop[0] && g.ui.onDrop[0].ref.join('/'));
    t('C1-A das armierte onDisconnect traegt das eigene Sitzungstoken',
      g.ui.onDrop[0] && g.ui.onDrop[0].val.s === before.tab, g.ui.onDrop[0] && g.ui.onDrop[0].val);

    // Und der eigentliche Zweck: der Zug geht wieder durch.
    t('C1-A nach der Wiederherstellung ist der eigene Zug wieder moeglich',
      g.commitMove(60, -40) === true);
    await tick();
    t('C1-A der Zug liegt in der Datenbank',
      !!(room().g && room().g[0] && room().g[0].t && room().g[0].t[0] && room().g[0].t[0][1]),
      (room().g || {})[0]);
  }

  // ── C1-B: nach dem eigenen Zug — Write-once bleibt Write-once ──
  {
    const { db, g, room } = await c1Room('C1BB');
    g.commitMove(50, 50); await tick();
    const rec = JSON.parse(JSON.stringify(room().g[0].t[0][1]));
    g.netDrop(); await tick();
    db.setConnected(true); await tick(12);
    t('C1-B die Praesenz ist wiederhergestellt', room().p[1].on === true, room().p[1]);
    t('C1-B der bereits geschriebene Zug bleibt unveraendert',
      JSON.stringify(room().g[0].t[0][1]) === JSON.stringify(rec), room().g[0].t[0][1]);
    t('C1-B kein zweiter Zug im selben Slot', g.commitMove(-70, 10) === false);
    await tick();
    t('C1-B der Slot traegt weiterhin genau den ersten Zug',
      JSON.stringify(room().g[0].t[0][1]) === JSON.stringify(rec), room().g[0].t[0][1]);
  }

  // ── C1-C: mehrfache Abrisse hintereinander bleiben folgenlos ──
  {
    const { db, g, room } = await c1Room('C1CC');
    for (let i = 0; i < 3; i++) {
      g.netDrop(); await tick();
      db.setConnected(false); await tick(2);
      db.setConnected(true); await tick(12);
    }
    t('C1-C nach drei Abrissen ist die Praesenz aktiv', room().p[1].on === true, room().p[1]);
    t('C1-C genau ein armiertes onDisconnect', g.ui.onDrop.length === 1, g.ui.onDrop.length);
    t('C1-C keine doppelten Sitze', Object.keys(room().players).join(',') === '0,1',
      Object.keys(room().players));
    t('C1-C der Sitz ist unveraendert', g.presence().seat === 1, g.presence());
  }

  // ── C1-N: bei JEDER Rueckverbindung wird neu armiert ──
  // Eine onDisconnect-Registrierung ueberlebt den Abriss nicht: hat der Server sie
  // ausgefuehrt, ist sie verbraucht. Zeigt die Praesenz danach (aus welchem Grund auch
  // immer) schon on:true, darf das ARM trotzdem nicht entfallen - sonst bliebe der Sitz
  // beim naechsten Ausfall faelschlich als verbunden stehen, und niemand wartet mehr auf
  // ihn mit einer Grace.
  {
    const { db, g, room } = await c1Room('C1NN');
    g.netDrop(); await tick();                       // Registrierung verbraucht, p on:false
    room().p[1].on = true;                           // Praesenz sieht wieder aktiv aus ...
    g.ui.onDrop.length = 0;                          // ... aber es ist NICHTS armiert
    g.ui.log.length = 0;
    db.setConnected(false); await tick(2);
    db.setConnected(true); await tick(14);
    t('C1-N auch bei aktiver Praesenz wird neu armiert',
      g.ui.onDrop.length === 1 && g.ui.onDrop[0].val.on === false, g.ui.onDrop);
    t('C1-N und die aktive Praesenz wird dabei nicht erneut geschrieben',
      !g.ui.log.some(x => x.indexOf('UPD p/1') === 0), g.ui.log.slice(0, 6));
  }

  // ── C1-O: ein Signal waehrend eines laufenden Durchgangs geht nicht verloren ──
  // Trifft waehrend der Wiederherstellung ein zweiter Abriss samt Rueckkehr ein, wurde
  // das zweite Signal frueher von der Einfachlauf-Sperre verschluckt. Das konnte einen
  // Sitz mit on:true OHNE armiertes onDisconnect hinterlassen.
  {
    const { db, g, room } = await c1Room('C1OO');
    g.netDrop(); await tick();
    g.ui.log.length = 0;
    db.setConnected(true);                           // Durchgang 1 startet (wartet auf den Raum)
    db.setConnected(false);                          // zweiter Abriss mittendrin
    db.setConnected(true);                           // und sofort wieder zurueck
    await tick(20);
    const arms = g.ui.log.filter(x => x.indexOf('ARM ') === 0).length;
    t('C1-O das zweite Verbindungssignal wird nachgeholt (mehr als ein Durchgang)',
      arms >= 2, { arms, log: g.ui.log.slice(0, 10) });
    t('C1-O am Ende: Praesenz aktiv UND ein onDisconnect armiert',
      room().p[1].on === true && g.ui.onDrop.length === 1, { p: room().p[1], onDrop: g.ui.onDrop.length });
  }

  // ── C1-D: bereits aktiv — dann passiert nichts ──
  {
    const { db, g, room } = await c1Room('C1DD');
    const t0 = room().p[1].t;
    g.ui.log.length = 0;
    db.setConnected(true); await tick(12);
    t('C1-D bei aktiver Praesenz wird nicht geschrieben',
      room().p[1].t === t0 && !g.ui.log.some(x => x.indexOf('UPD p/1') === 0), g.ui.log.slice(0, 5));
  }

  // ── C1-E: dauerhaft entfernter Sitz wird NICHT wiederbelebt ──
  {
    const { db, g, room } = await c1Room('C1EE');
    g.netDrop(); await tick();
    room().g = Object.assign(room().g || {}, { 0: Object.assign((room().g || {})[0] || {}, { e: { 1: true } }) });
    g.ui.log.length = 0;
    db.setConnected(true); await tick(12);
    t('C1-E ein evictierter Sitz bleibt offline', room().p[1].on === false, room().p[1]);
    t('C1-E der Client versucht es gar nicht erst', noAttempt(g, 1), g.ui.log.slice(0, 6));
  }

  // ── C1-F: Wiederverbindung nach einem Generationswechsel ──
  // Der Client uebernimmt eine neue Generation ueber seinen eigenen gen-Listener. Die
  // Wiederherstellung darf danach WEITER nur die Verbindung anfassen: derselbe Sitz,
  // dieselbe Identitaet, nichts Neues - und sie bleibt an die AKTUELLE Generation
  // gebunden (die Eviction-Sperre in C1-E prueft genau diese Bindung).
  {
    const { db, g, room } = await c1Room('C1FF');
    const uid0 = g.presence().uid, tab0 = g.presence().tab;
    g.netDrop(); await tick();
    room().gen = 1;                                   // Rematch/Neustart durch die Gegenseite
    await tick(4);                                    // der Client uebernimmt die Generation
    db.setConnected(true); await tick(12);
    const p = room().p[1];
    t('C1-F nach dem Generationswechsel gehoert die Praesenz weiter demselben Sitz',
      p.s === tab0 && room().players[1].uid === uid0 && g.presence().seat === 1, { p, presence: g.presence() });
    t('C1-F der Generationswechsel legt keinen zusaetzlichen Sitz an',
      Object.keys(room().players).join(',') === '0,1', Object.keys(room().players));
    // Fail closed bleibt fail closed: in der NEUEN Generation evictiert -> keine Rueckkehr.
    const { db: db2, g: g2, room: room2 } = await c1Room('C1FG');
    g2.netDrop(); await tick();
    room2().gen = 1;
    room2().g = Object.assign(room2().g || {}, { 1: { e: { 1: true } } });
    await tick(4);
    g2.ui.log.length = 0;
    db2.setConnected(true); await tick(12);
    t('C1-F in der neuen Generation evictiert -> keine Wiederherstellung',
      room2().p[1].on === false, room2().p[1]);
    t('C1-F auch dort kein Schreibversuch', noAttempt(g2, 1), g2.ui.log.slice(0, 6));
  }

  // ── C1-G: der Sitz gehoert inzwischen einer anderen Sitzung ──
  {
    const { db, g, room } = await c1Room('C1GG');
    g.netDrop(); await tick();
    room().players[1].tab = 'FREMDTAB0001';           // andere Sitzung hat den Sitz uebernommen
    g.ui.log.length = 0;
    db.setConnected(true); await tick(12);
    t('C1-G ein fremd uebernommener Sitz wird nicht zurueckgeholt',
      room().p[1].on === false, room().p[1]);
    t('C1-G der Client versucht es gar nicht erst', noAttempt(g, 1), g.ui.log.slice(0, 6));
  }

  // ── C1-H: fremder Eigentuemer (uid) ──
  {
    const { db, g, room } = await c1Room('C1HH');
    g.netDrop(); await tick();
    room().players[1].uid = 'UID_JEMAND_ANDERES';
    g.ui.log.length = 0;
    db.setConnected(true); await tick(12);
    t('C1-H ein Sitz mit fremder uid wird nicht reaktiviert', room().p[1].on === false, room().p[1]);
    t('C1-H der Client versucht es gar nicht erst', noAttempt(g, 1), g.ui.log.slice(0, 6));
  }

  // ── C1-L: fremdes PRAESENZ-Token ──
  {
    const { db, g, room } = await c1Room('C1LL');
    g.netDrop(); await tick();
    room().p[1].s = 'FREMDTAB0002';                  // eine andere Sitzung haelt die Praesenz
    g.ui.log.length = 0;
    db.setConnected(true); await tick(12);
    t('C1-L fremdes Praesenztoken -> keine Wiederherstellung', room().p[1].on === false, room().p[1]);
    t('C1-L der Client versucht es gar nicht erst', noAttempt(g, 1), g.ui.log.slice(0, 6));
  }

  // ── C1-I: der Raum existiert nicht mehr ──
  {
    const { db, g, room } = await c1Room('C1II');
    g.netDrop(); await tick();
    delete db.data.rooms['C1II'];
    g.ui.log.length = 0;
    db.setConnected(true); await tick(12);
    t('C1-I ein verschwundener Raum wird nicht neu erzeugt', db.data.rooms['C1II'] === undefined);
    t('C1-I und es wird nichts geschrieben', noAttempt(g, 1), g.ui.log.slice(0, 6));
  }

  // ── C1-J: bewusstes Verlassen beendet die Wiederherstellung ──
  {
    const { db, g, room } = await c1Room('C1JJ');
    g.leave(); await tick();
    g.ui.log.length = 0;
    db.setConnected(true); await tick(12);
    const r = db.data.rooms['C1JJ'];
    t('C1-J nach dem Verlassen wird keine Praesenz wiederhergestellt',
      !r || !r.p || !r.p[1] || r.p[1].on !== true, r && r.p);
    t('C1-J und der Beobachter ist abgemeldet', noAttempt(g, 1), g.ui.log.slice(0, 6));
    // Der Host ist weiterhin im Raum und behaelt seinen Beobachter - nur der des
    // Verlassenden verschwindet.
    t('C1-J der Beobachter des Verlassenden ist abgemeldet',
      db.listenerCount('.info/connected') === 1, db.listenerCount('.info/connected'));
  }

  // ── C1-M: kein Beobachterleck ──
  // Genau ein Beobachter je Client im Raum, und beim Verlassen verschwindet er wieder.
  {
    const db = makeDB();
    const h = makeClient(db, 'C1MM'); h.setMenu('online'); h.setFmt('single'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('C1MM'); await tick();
    t('C1-M zwei Clients im Raum -> zwei Beobachter',
      db.listenerCount('.info/connected') === 2, db.listenerCount('.info/connected'));
    g.leave(); await tick();
    t('C1-M nach dem Verlassen bleibt nur der des Hosts',
      db.listenerCount('.info/connected') === 1, db.listenerCount('.info/connected'));
    h.leave(); await tick();
    t('C1-M verlaesst auch der Host, bleibt kein Beobachter zurueck',
      db.listenerCount('.info/connected') === 0, db.listenerCount('.info/connected'));
  }

  // ── C1-K: der Gegner bleibt unberuehrt ──
  {
    const { db, h, g, room } = await c1Room('C1KK');
    const host0 = JSON.stringify(room().p[0]);
    g.netDrop(); await tick();
    db.setConnected(true); await tick(12);
    t('C1-K die Praesenz des Gegners wird nicht angefasst',
      JSON.stringify(room().p[0]) === host0, room().p[0]);
    t('C1-K der Gegner behaelt seinen Sitz', h.st().myPlayer === 0, h.st().myPlayer);
  }


  // ══ C4A: VERLASSEN-ZUSTAND IST GENERATIONSGEBUNDEN ═════════════════════════
  // seatLeft/seatGone beschreiben, wer in DIESER Generation nicht mehr mitspielt. Sie
  // wurden bisher nur beim Betreten eines Raums geleert - ein Rematch nahm sie mit.
  // Folgen: sofortiger Leave-Sentinel in der neuen Generation an der Frist vorbei, und
  // weil seatGone in simHash() einfliesst, ein abweichender Zustandshash.
  // Geprueft wird hier mit der ECHTEN Frist und gestellter Serveruhr.
  const c4aRoom = async (code) => {
    const db = makeDB();
    const h = makeClient(db, code); h.setMenu('ffa', 5); h.setFmt('ffa'); h.create(); await tick();
    const gs = [];
    for (let i = 1; i < 4; i++) { const g = makeClient(db, 'W' + i); g.setMenu('ffa', 5); g.setFmt('ffa'); g.join(code); await tick(); gs.push(g); }
    h.clickStart(); await tick();
    db.publishOffset(); await tick(6);
    return { db, h, gs, room: () => db.data.rooms[code] };
  };

  // ── C4A-1: eine TRENNUNG aus Generation 0 wirkt nicht in Generation 1 ──
  {
    const { db, h, room } = await c4aRoom('C4AA');
    // Knoten bleibt, on:false - das ist eine Trennung, kein Weggang.
    room().p[1] = { s: room().p[1].s, on: false, t: db.now() };
    db.publishOffset(); await tick(6);
    db.advanceServer(16000); await tick(10);
    t('C4A-1 der Weckruf entscheidet nach Ablauf', h.fireGrace(1) === 'act');
    await tick(6);
    t('C4A-1 Vorbedingung: die Frist ist abgelaufen und der Sitz vermerkt',
      h.grace(1).state === 'expired' && h.left(1) === true,
      { g: h.grace(1), left: h.left(1) });
    const goneVor = h.gone(1);

    // Rematch.
    room().gen = 1; db.touch(); await tick(12);
    t('C4A-1 die neue Generation laeuft', h.st().gen === 1, h.st().gen);
    t('C4A-1 der Vermerk aus Generation 0 wirkt NICHT weiter', h.left(1) === false,
      { left: h.left(1), vorher: true });
    t('C4A-1 auch der abgeleitete gone-Zustand ist geleert', h.gone(1) === false,
      { jetzt: h.gone(1), vorher: goneVor });
    t('C4A-1 der Knoten ist unangetastet - es wurde nichts entfernt',
      room().p[1] !== undefined && room().players[1] !== undefined, room().p[1]);
    t('C4A-1 die Frist laeuft in der neuen Generation NEU an - keine Umgehung',
      h.grace(1).state === 'reserved' && h.grace(1).raw < h.grace(1).since, h.grace(1));
    t('C4A-1 und der Sitz ist noch kein Abwesenheitskandidat', h.candidates().length === 0,
      h.candidates());
  }

  // ── C4A-2: ein bewusstes VERLASSEN bleibt auch nach dem Wechsel gueltig ──
  // Dort fehlt der Praesenzknoten - daran wird unterschieden.
  {
    const { db, h, gs, room } = await c4aRoom('C4AB');
    gs[0].leave(); await tick(8);
    t('C4A-2 Vorbedingung: der Knoten ist geloescht und der Sitz vermerkt',
      room().p[1] === undefined && h.left(1) === true, { p: room().p, left: h.left(1) });
    room().gen = 1; db.touch(); await tick(12);
    t('C4A-2 nach dem Wechsel gilt er weiterhin als weg', h.left(1) === true, h.left(1));
  }

  // ── C4A-3: Reihenfolge der Rueckmeldungen ──
  // Kommt der Generationswechsel VOR oder NACH der Trennungsmeldung, darf das Ergebnis
  // nicht davon abhaengen.
  {
    // (a) erst Trennung, dann Generationswechsel
    const A = await c4aRoom('C4AC');
    A.room().p[1] = { s: A.room().p[1].s, on: false, t: A.db.now() };
    A.db.publishOffset(); await tick(6);
    A.db.advanceServer(16000); await tick(10);
    A.h.fireGrace(1); await tick(6);
    A.room().gen = 1; A.db.touch(); await tick(12);

    // (b) erst Generationswechsel, dann Trennung
    const B = await c4aRoom('C4AD');
    B.room().gen = 1; B.db.touch(); await tick(12);
    B.room().p[1] = { s: B.room().p[1].s, on: false, t: B.db.now() };
    B.db.publishOffset(); await tick(6);
    B.db.advanceServer(16000); await tick(10);

    t('C4A-3 (a) Trennung vor dem Wechsel: kein Vermerk aus der alten Generation',
      A.h.left(1) === false, A.h.left(1));
    t('C4A-3 (b) Trennung nach dem Wechsel: sie gilt in der neuen Generation',
      B.h.grace(1).state === 'expired', B.h.grace(1));
    t('C4A-3 in beiden Reihenfolgen wurde nichts entfernt',
      A.room().players[1] !== undefined && B.room().players[1] !== undefined
      && (!A.room().g || !A.room().g[1] || A.room().g[1].e === undefined),
      { a: A.room().players[1] !== undefined, b: B.room().players[1] !== undefined });
  }

  // ── C4A-3b: Gen-Callback VOR dem ersten Praesenzstand ──
  // Ein leeres roomP heisst "noch nichts gesehen", nicht "niemand da". Ohne diese
  // Unterscheidung wuerde die Neuableitung jeden fremden Sitz als verlassen markieren.
  {
    const { db, h, room } = await c4aRoom('C4AF');
    t('C4A-3b Vorbedingung: ein Praesenzstand liegt vor', h.presenceSeen() === true);
    h.forgetPresenceView();
    t('C4A-3b danach gilt: noch nichts gesehen', h.presenceSeen() === false);
    h.rederiveNow();
    t('C4A-3b ohne Praesenzstand wird KEIN Sitz als verlassen markiert',
      [1, 2, 3].every(s2 => h.left(s2) === false), [1, 2, 3].map(s2 => h.left(s2)));
    t('C4A-3b und es wurde nichts geschrieben',
      room().players[1] !== undefined && room().p[1] !== undefined, room().p[1]);
  }

  // ── C4A-3c: der aus der Historie rekonstruierte Zustand ueberlebt den
  //     Initial-Callback der LAUFENDEN Generation ──
  // Beim Rejoin baut fastForwardMatch den Verlassen-Zustand aus den Zuegen wieder auf.
  // Der danach eintreffende erste gen-Callback traegt dieselbe Generation - er darf
  // nichts leeren, denn aus vergangenen Zuegen laesst sich seatGone nicht neu ableiten.
  {
    const { db, h, gs, room } = await c4aRoom('C4AG');
    const late = gs[2];
    const pid = late.pid(), uid = late.uid();
    gs[0].leave(); await tick(8);          // Sitz 1 geht -> Sentinel -> seatGone auf allen
    t('C4A-3c Vorbedingung: der Verlassen-Zustand steht bei den Verbliebenen',
      h.gone(1) === true && h.left(1) === true, { gone: h.gone(1), left: h.left(1) });

    // Sitz 3 laedt neu und steigt in DERSELBEN Generation wieder ein.
    late.drop();
    const fresh = makeClient(db, 'C4AG', pid, uid);
    fresh.setMenu('ffa', 5); fresh.setFmt('ffa');
    const okR = await fresh.rejoin('C4AG'); await tick(12);
    t('C4A-3c der Wiedereinstieg gelingt', okR === true && fresh.st().myPlayer === 3,
      { ok: okR, seat: fresh.st().myPlayer });
    t('C4A-3c der Zustand kam aus der Historie zurueck', fresh.gone(1) === true, fresh.gone(1));
    t('C4A-3c und der Initial-Callback derselben Generation loescht ihn NICHT',
      fresh.gone(1) === true && fresh.st().gen === h.st().gen,
      { gone: fresh.gone(1), gen: fresh.st().gen, ref: h.st().gen });
    t('C4A-3c beide rechnen denselben Zustand', fresh.hash() === h.hash(),
      { fresh: fresh.hash(), h: h.hash() });
  }

  // ── C4A-4: C1/C2/C3 bleiben unberuehrt ──
  {
    const { db, h, room } = await c4aRoom('C4AE');
    room().p[1] = { s: room().p[1].s, on: false, t: db.now() };
    db.publishOffset(); await tick(6);
    db.advanceServer(16000); await tick(10);
    h.fireGrace(1); await tick(6);
    room().gen = 1; db.touch(); await tick(12);
    // Rueckkehr in der neuen Generation: die Praesenz wird ganz normal wieder aktiv.
    room().p[1] = { s: room().p[1].s, on: true, t: db.now() };
    db.publishOffset(); await tick(10);
    t('C4A-4 die Rueckkehr funktioniert unveraendert',
      h.grace(1).state === 'online' && h.left(1) === false, { g: h.grace(1), left: h.left(1) });
    t('C4A-4 kein Kandidat, keine Eviction, kein remove',
      h.candidates().length === 0 && (!room().g || !room().g[1] || room().g[1].e === undefined),
      { k: h.candidates(), g: room().g && room().g[1] });
  }

  // ══ C3: RUECKKEHRFRIST UND FRISTABLAUF ═════════════════════════════════════
  // Die Frist ist ein RECHT AUF RUECKKEHR. Sie laeuft gegen die Serverzeit, nicht gegen
  // die Uhr des einzelnen Geraets - sonst kommen zwei Beobachter derselben Trennung zu
  // verschiedenen Ablaufzeitpunkten. C3 ENTSCHEIDET nur ueber Eignung; entfernt wird
  // nichts.
  const c3Room = async (code) => {
    const db = makeDB();
    const h = makeClient(db, code); h.setMenu('online'); h.setFmt('single'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join(code); await tick();
    db.publishOffset(); await tick(6);
    return { db, h, g, room: () => db.data.rooms[code] };
  };
  // Trennung wie durch ein serverseitiges onDisconnect - mit Server-Zeitstempel.
  const dropSeat = async (db, code, seat) => {
    const r = db.data.rooms[code];
    r.p[seat] = { s: r.p[seat].s, on: false, t: db.now() };
    db.publishOffset(); await tick(6);
  };
  const backSeat = async (db, code, seat) => {
    const r = db.data.rooms[code];
    r.p[seat] = { s: r.p[seat].s, on: true, t: db.now() };
    db.publishOffset(); await tick(6);
  };

  // ── C3-A: die Schwelle ──
  {
    const { db, h, room } = await c3Room('C3AA');
    t('C3-A die Uhr ist angeglichen', h.clockReady() === true);
    await dropSeat(db, 'C3AA', 1);
    t('C3-A unmittelbar nach der Trennung: reserviert', h.grace(1).state === 'reserved', h.grace(1));

    db.advanceServer(14900); await tick(6);
    t('C3-A nach 14,9 s: weiterhin reserviert', h.grace(1).state === 'reserved', h.grace(1));
    t('C3-A und noch kein Kandidat', h.candidates().length === 0, h.candidates());

    db.advanceServer(200); await tick(6);
    t('C3-A ab 15,0 s: abgelaufen', h.grace(1).state === 'expired', h.grace(1));
    t('C3-A das Alter zaehlt ab dem autoritativen Uebergang',
      h.grace(1).age >= 15000 && h.grace(1).age < 16000, h.grace(1).age);
  }

  // ── C3-B: zwei durchgehend anwesende Beobachter sind sich EINIG ──
  // Beide sehen dieselbe Trennung und rechnen gegen denselben Server-Zeitstempel. Mit
  // einer eigenen Stoppuhr je Client waeren ihre Ablaufzeitpunkte verschieden.
  {
    const db = makeDB();
    const h = makeClient(db, 'C3BB'); h.setMenu('ffa', 5); h.setFmt('ffa'); h.create(); await tick();
    const gs = [];
    for (let i = 1; i < 4; i++) { const g = makeClient(db, 'Y' + i); g.setMenu('ffa', 5); g.setFmt('ffa'); g.join('C3BB'); await tick(); gs.push(g); }
    h.clickStart(); await tick();
    db.publishOffset(); await tick(6);
    const room = () => db.data.rooms['C3BB'];
    const other = gs[1];                       // Sitz 2 - durchgehend im Raum
    room().p[1] = { s: room().p[1].s, on: false, t: db.now() };
    db.publishOffset(); await tick(6);
    db.advanceServer(15100); await tick(8);
    t('C3-B beide sehen denselben Zustand',
      h.grace(1).state === 'expired' && other.grace(1).state === 'expired',
      { h: h.grace(1), other: other.grace(1) });
    t('C3-B und dasselbe Alter (gemeinsame Zeitbasis, keine eigene Stoppuhr)',
      Math.abs(other.grace(1).age - h.grace(1).age) < 1000,
      { h: h.grace(1).age, other: other.grace(1).age });
    t('C3-B beide rechnen gegen denselben Server-Zeitstempel',
      h.grace(1).raw === other.grace(1).raw, { h: h.grace(1).raw, other: other.grace(1).raw });
  }

  // ── C3-B1: ein SPAETER hinzugekommener Client urteilt konservativ ──
  // Er war bei der Trennung nicht dabei. Seine Fristbasis beginnt deshalb fruehestens
  // mit seinem eigenen Eintritt - er entscheidet nie FRUEHER als ein Anwesender, sondern
  // wartet im Zweifel laenger. Das ist die richtige Richtung fuer eine Entscheidung, die
  // spaeter zu einer unwiderruflichen Entfernung fuehrt.
  {
    const db = makeDB();
    const h = makeClient(db, 'C3B1'); h.setMenu('ffa', 5); h.setFmt('ffa'); h.create(); await tick();
    const gs = [];
    for (let i = 1; i < 4; i++) { const g = makeClient(db, 'Z' + i); g.setMenu('ffa', 5); g.setFmt('ffa'); g.join('C3B1'); await tick(); gs.push(g); }
    h.clickStart(); await tick();
    db.publishOffset(); await tick(6);
    const room = () => db.data.rooms['C3B1'];
    const late = gs[2];
    const pid = late.pid(), uid = late.uid();
    room().p[1] = { s: room().p[1].s, on: false, t: db.now() };
    db.publishOffset(); await tick(6);
    db.advanceServer(10000); await tick(6);

    late.drop();
    const fresh = makeClient(db, 'C3B1', pid, uid);
    fresh.setMenu('ffa', 5); fresh.setFmt('ffa');
    const okR = await fresh.rejoin('C3B1'); await tick(8);
    db.publishOffset(); await tick(6);
    t('C3-B1 der spaete Beobachter ist im Raum', okR === true, okR);
    db.advanceServer(5100); await tick(8);
    t('C3-B1 der durchgehend Anwesende: abgelaufen', h.grace(1).state === 'expired', h.grace(1));
    t('C3-B1 der spaet Hinzugekommene urteilt konservativ - noch nicht abgelaufen',
      fresh.grace(1).state === 'reserved', fresh.grace(1));
    t('C3-B1 er entscheidet nie frueher als der Anwesende',
      fresh.grace(1).age <= h.grace(1).age, { spaet: fresh.grace(1).age, frueh: h.grace(1).age });
    t('C3-B1 beide sehen denselben Server-Zeitstempel der Trennung',
      fresh.grace(1).raw === h.grace(1).raw, { spaet: fresh.grace(1).raw, frueh: h.grace(1).raw });
  }

  // ── C3-B2: die Restwartezeit richtet sich nach dem Uebergang, nicht nach der
  //     eigenen Beobachtung. Wer eine zehn Sekunden alte Trennung zum ersten Mal
  //     sieht, wartet noch fuenf Sekunden - nicht wieder fuenfzehn.
  {
    const { db, h } = await c3Room('C3B2');
    await dropSeat(db, 'C3B2', 1);
    t('C3-B2 frisch getrennt: die volle Frist steht aus',
      Math.abs(h.graceWait(1) - 15000) < 500, h.graceWait(1));
    db.advanceServer(10000); await tick(6);
    t('C3-B2 nach zehn Sekunden bleiben noch rund fuenf',
      h.graceWait(1) > 4000 && h.graceWait(1) < 6000, h.graceWait(1));
    db.advanceServer(6000); await tick(6);
    t('C3-B2 jenseits der Schwelle bleibt nichts mehr auszuwarten', h.graceWait(1) === 0,
      h.graceWait(1));
    await backSeat(db, 'C3B2', 1);
    t('C3-B2 ein verbundener Sitz hat keine Wartezeit', h.graceWait(1) === 0, h.graceWait(1));
  }

  // ── C3-B3: ein Weckruf aus einer alten Generation ist gegenstandslos ──
  {
    const { db, h, room } = await c3Room('C3B3');
    const ctx = h.ctxNow();
    t('C3-B3 der eigene Kontext ist gueltig', h.ctxValid(ctx) === true, ctx);
    room().gen = 1; db.touch(); await tick(8);
    t('C3-B3 nach dem Generationswechsel ist derselbe Weckruf ungueltig',
      h.ctxValid(ctx) === false, { ctx, jetzt: h.ctxNow() });
    t('C3-B3 ein Weckruf aus einem anderen Raum ist ebenfalls ungueltig',
      h.ctxValid({ sid: ctx.sid, room: 'XXXX', gen: h.ctxNow().gen }) === false);
    t('C3-B3 und einer aus einer aelteren Sitzung',
      h.ctxValid({ sid: ctx.sid - 1, room: h.ctxNow().room, gen: h.ctxNow().gen }) === false);
  }

  // ── C3-B4: was der Weckruf beim Feuern TUT ──
  // Der Weckruf darf nur entscheiden, wenn die Frist wirklich abgelaufen ist. Bei einer
  // noch nicht eingeschwungenen Uhr (Zeitstempel in der Zukunft) wird erneut gewartet -
  // sonst waere die Fail-closed-Absicht genau dort wirkungslos, wo sie zaehlt.
  {
    const { db, h, room } = await c3Room('C3B4');
    await dropSeat(db, 'C3B4', 1);
    t('C3-B4 innerhalb der Frist: erneut wecken', h.timerAction(1) === 'rearm', h.grace(1));
    db.advanceServer(16000); await tick(6);
    t('C3-B4 nach Ablauf: entscheiden', h.timerAction(1) === 'act', h.grace(1));
    await backSeat(db, 'C3B4', 1);
    t('C3-B4 wieder verbunden: nichts tun', h.timerAction(1) === 'stop', h.grace(1));

    // Zeitstempel in der Zukunft - eine Uhr, die noch nicht eingeschwungen ist.
    room().p[1] = { s: room().p[1].s, on: false, t: db.now() + 60000 };
    db.publishOffset(); await tick(6);
    t('C3-B4 zukuenftiger Zeitstempel gilt als unbestimmt, nicht als Ablauf',
      h.grace(1).state === 'unknown' && h.grace(1).reason === 'future', h.grace(1));
    t('C3-B4 und wird NICHT entschieden, sondern erneut gewartet',
      h.timerAction(1) === 'rearm', h.timerAction(1));
  }

  // ── C3-B5: ohne Serverzeit bleibt es beim Verhalten vor C3 ──
  // Bewusste Entscheidung: gaebe es hier keinen Rueckfall, haenge ein RingOut-Match,
  // wenn .info/serverTimeOffset ausbleibt. Der lokale Weckruf hat dann bereits die
  // volle Frist abgewartet - frueher als bisher entscheidet er nie.
  {
    const db = makeDB();
    const h = makeClient(db, 'C3B5'); h.setMenu('online'); h.setFmt('single'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('C3B5'); await tick();
    const r = db.data.rooms['C3B5'];
    r.p[1] = { s: r.p[1].s, on: false, t: db.now() };
    db.touch(); await tick(6);
    t('C3-B5 ohne Serverzeit ist der Zustand unbestimmt',
      h.grace(1).state === 'unknown' && h.grace(1).reason === 'noClock', h.grace(1));
    t('C3-B5 der Weckruf faellt auf das bisherige Verhalten zurueck',
      h.timerAction(1) === 'act', h.timerAction(1));
    t('C3-B5 die volle Frist stand dafuer aus', h.graceWait(1) === 15000, h.graceWait(1));
  }

  // ── C3-C: Rueckkehr innerhalb der Frist ──
  {
    const { db, h } = await c3Room('C3CC');
    await dropSeat(db, 'C3CC', 1);
    db.advanceServer(5000); await tick(6);
    t('C3-C nach 5 s: reserviert', h.grace(1).state === 'reserved', h.grace(1));
    await backSeat(db, 'C3CC', 1);
    t('C3-C nach der Rueckkehr: online, keine Frist', h.grace(1).state === 'online', h.grace(1));
    t('C3-C und kein Kandidat mehr', h.candidates().length === 0, h.candidates());
    db.advanceServer(20000); await tick(6);
    t('C3-C auch lange danach entsteht kein Kandidat aus der alten Trennung',
      h.candidates().length === 0 && h.grace(1).state === 'online', h.grace(1));
  }

  // ── C3-D: kurz vor der Schwelle zurueck ──
  {
    const { db, h } = await c3Room('C3DD');
    await dropSeat(db, 'C3DD', 1);
    db.advanceServer(14800); await tick(6);
    await backSeat(db, 'C3DD', 1);
    db.advanceServer(5000); await tick(6);
    t('C3-D wer kurz vor der Schwelle zurueckkommt, laeuft nicht ab',
      h.grace(1).state === 'online' && h.candidates().length === 0, h.grace(1));
  }

  // ── C3-E: erneute Trennung startet eine NEUE Frist ──
  {
    const { db, h } = await c3Room('C3EE');
    await dropSeat(db, 'C3EE', 1);
    db.advanceServer(12000); await tick(6);
    await backSeat(db, 'C3EE', 1);
    db.advanceServer(1000); await tick(6);
    await dropSeat(db, 'C3EE', 1);            // zweite Trennung
    db.advanceServer(5000); await tick(6);
    t('C3-E die zweite Trennung rechnet von vorn - nicht aus der alten Frist weiter',
      h.grace(1).state === 'reserved' && h.grace(1).age >= 5000 && h.grace(1).age < 6000, h.grace(1));
    db.advanceServer(10100); await tick(6);
    t('C3-E und laeuft erst nach ihren eigenen 15 s ab', h.grace(1).state === 'expired', h.grace(1));
  }

  // ── C3-F: der Ablauf entfernt NICHTS ──
  {
    const { db, h, room } = await c3Room('C3FF');
    const before = JSON.stringify({ players: room().players, p: room().p, g: room().g || null });
    await dropSeat(db, 'C3FF', 1);
    db.advanceServer(30000); await tick(10);
    t('C3-F Frist abgelaufen', h.grace(1).state === 'expired', h.grace(1));
    // fbAbsenceCandidates() ist bewusst an den Online-Football-Raum gebunden (die
    // spaetere dauerhafte Entfernung ist football-spezifisch). In einem RingOut-Raum
    // ist die Liste deshalb leer - der Fristzustand gilt trotzdem.
    t('C3-F in einem RingOut-Raum entsteht keine Kandidatenliste', h.candidates().length === 0,
      h.candidates());
    t('C3-F der Spielerdatensatz existiert unveraendert weiter',
      room().players[1] !== undefined, room().players && Object.keys(room().players));
    t('C3-F die Praesenz wurde nicht geloescht', room().p[1] !== undefined, room().p);
    t('C3-F KEINE Eviction geschrieben',
      !room().g || !room().g[0] || room().g[0].e === undefined, room().g);
    t('C3-F der Zeitstempel der Trennung blieb unangetastet',
      room().p[1].t === JSON.parse(before).p[1].t || room().p[1].on === false, room().p[1]);
  }

  // ── C3-G: generationsgebunden ──
  {
    const { db, h, room } = await c3Room('C3GG');
    await dropSeat(db, 'C3GG', 1);
    db.advanceServer(30000); await tick(6);
    t('C3-G Vorbedingung: abgelaufen in Generation 0', h.grace(1).state === 'expired', h.grace(1));
    t('C3-G Vorbedingung: ein laufender Weckruf gehoert zu Generation 0',
      h.graceTimers().every(x => x.gen === 0), h.graceTimers());
    // Rematch: neue Generation, und der Sitz ist wieder da.
    room().gen = 1; await tick(6);
    await backSeat(db, 'C3GG', 1);
    t('C3-G in der neuen Generation gibt es keinen geerbten Kandidaten',
      h.candidates().length === 0 && h.grace(1).state === 'online', h.grace(1));
  }

  // ── C3-G2: ein Rematch darf den Weckruf nicht verlieren ──
  // Der Weckruf traegt seinen Generationskontext und wird beim Wechsel entwertet. Ein
  // gen-Write erzeugt aber KEINEN neuen Praesenz-Callback - ohne ausdruckliches
  // Neuarmieren bekaeme ein weiterhin getrennter Sitz in der neuen Generation nie
  // wieder einen Ablauf, und die neue Runde wartete unbegrenzt.
  {
    const { db, h, room } = await c3Room('C3G2');
    await dropSeat(db, 'C3G2', 1);
    const armed = () => h.graceTimers().filter(x => x.seat === 1)[0];
    t('C3-G2 Vorbedingung: ein Weckruf laeuft, in Generation 0',
      armed() && armed().gen === 0, h.graceTimers());
    const ctxAlt = h.ctxNow();
    room().gen = 1; db.touch(); await tick(10);
    t('C3-G2 der alte Weckruf ist entwertet', h.ctxValid(ctxAlt) === false, ctxAlt);
    t('C3-G2 der weiterhin getrennte Sitz hat einen Weckruf der NEUEN Generation',
      armed() && armed().gen === 1, h.graceTimers());
    // Und er gehoert zur neuen Generation.
    t('C3-G2 der neue Weckruf gehoert zur aktuellen Generation',
      h.ctxValid(h.ctxNow()) === true, h.ctxNow());
  }

  // ── C3-H: mehrere Getrennte haben unabhaengige Fristen ──
  // Zwei Sitze in EINEM Raum: dafuer braucht es ein FFA-Format mit mehr als zwei Sitzen.
  {
    const db = makeDB();
    const h = makeClient(db, 'C3HH'); h.setMenu('ffa', 5); h.setFmt('ffa'); h.create(); await tick();
    const gs = [];
    for (let i = 1; i < 4; i++) { const g = makeClient(db, 'X' + i); g.setMenu('ffa', 5); g.setFmt('ffa'); g.join('C3HH'); await tick(); gs.push(g); }
    h.clickStart(); await tick();
    db.publishOffset(); await tick(6);
    const room = () => db.data.rooms['C3HH'];
    if (room().p[1] && room().p[3]) {
      room().p[1] = { s: room().p[1].s, on: false, t: db.now() };
      db.publishOffset(); await tick(6);
      db.advanceServer(5000); await tick(6);
      room().p[3] = { s: room().p[3].s, on: false, t: db.now() };
      db.publishOffset(); await tick(6);
      db.advanceServer(10100); await tick(6);
      t('C3-H der zuerst Getrennte ist abgelaufen', h.grace(1).state === 'expired', h.grace(1));
      t('C3-H der spaeter Getrennte ist noch reserviert', h.grace(3).state === 'reserved', h.grace(3));
      db.advanceServer(5000); await tick(6);
      t('C3-H und laeuft erst nach seinen eigenen 15 s ab', h.grace(3).state === 'expired', h.grace(3));
    } else {
      t('C3-H Aufbau: zwei Gaeste vorhanden', false, Object.keys(room().p || {}));
    }
  }

  // ── C3-I: ohne angeglichene Uhr wird NICHT entschieden ──
  {
    const db = makeDB();
    const h = makeClient(db, 'C3II'); h.setMenu('online'); h.setFmt('single'); h.create(); await tick();
    const g = makeClient(db, 'X'); g.setMenu('online'); g.join('C3II'); await tick();
    // Kein publishOffset: der Client hat keine Serverzeit.
    const r = db.data.rooms['C3II'];
    r.p[1] = { s: r.p[1].s, on: false, t: db.now() };
    db.touch(); await tick(6);               // gemeldet, aber OHNE Zeitangleichung
    db.advance(30000); await tick(6);
    t('C3-I ohne Zeitangleichung gilt der Zustand als unbekannt, nicht als abgelaufen',
      h.clockReady() === false && h.grace(1).state === 'unknown', { ready: h.clockReady(), g: h.grace(1) });
    t('C3-I und es entsteht kein Kandidat', h.candidates().length === 0, h.candidates());
  }

  console.log(`\nReconnect-B2: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
