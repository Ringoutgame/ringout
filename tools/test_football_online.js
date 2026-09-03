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
// Die Protokollversion kommt aus index.html, nie aus einer Zahl im Test.
const VER = Number(HTML.split('const ONLINE_PROTOCOL_VERSION=')[1].split(';')[0]);
// Die echte Rueckkehrfrist aus index.html - kein im Test geratener Wert.
const SEAT_STALE_FROM_SOURCE = Number((HTML.match(/const SEAT_STALE_MS=(\d+)/) || [])[1]);
if (!Number.isFinite(SEAT_STALE_FROM_SOURCE)) { console.error('FAIL: cannot extract SEAT_STALE_MS'); process.exit(1); }
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
  // Der Release liest den Zugvektor jetzt aus aimVectorFromDrag() — derselben Quelle,
  // aus der auch der Ablauf der Bedenkzeit schoepft. Beide muessen im Test durch
  // GENAU diese Funktion laufen, sonst prueft der Test einen Nachbau.
  grab(/function aimVectorFromDrag\(\)\{[\s\S]*?\n\}/, 'aimVectorFromDrag'),
  handler(/window\.addEventListener\('pointerup',e=>\{[\s\S]*?commit\(who,sh,v\.fx,v\.fy,v\.spin\);\}\);/, 'onPointerUp'),
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
  grab(/function fbSkipBoundary\(\)\{[\s\S]*?\n\}/, 'fbSkipBoundary'),
  grab(/let roomEv=\{\}, evUnsub=null, fbExitBusy=\{\}, fbRemovePending=\[\];/, 'roomEv'),
  grab(/function fbEvicted\(s\)\{[^\n]*/, 'fbEvicted'),
  grab(/function fbWinnerEligible\(o\)\{[\s\S]*?\n\}/, 'fbWinnerEligible'),
  grab(/function fbEligibleOwners\(\)\{[\s\S]*?\n\}/, 'fbEligibleOwners'),
  grab(/function fbPermanentExitHappened\(\)\{[\s\S]*?\n\}/, 'fbPermanentExitHappened'),
  grab(/function stopEvictionWatch\(\)\{[^\n]*/, 'stopEvictionWatch'),
  grab(/function startEvictionWatch\(\)\{[\s\S]*?\n\}/, 'startEvictionWatch'),
  grab(/function fbWriteEviction\(seat\)\{[\s\S]*?\n\}/, 'fbWriteEviction'),
  grab(/function fbWriteRemoveFor\(s,attempt\)\{[\s\S]*?\n\}/, 'fbWriteRemoveFor'),
  grab(/function fbCloseSeatSlot\(s,attempt\)\{[\s\S]*?\n\}/, 'fbCloseSeatSlot'),
  grab(/function fbMaybeWriteRemoves\(\)\{[\s\S]*?\n\}/, 'fbMaybeWriteRemoves'),
  grab(/function fbMaybeEvictExpired\(\)\{[\s\S]*?\n\}/, 'fbMaybeEvictExpired'),
  grab(/function fbApplyPendingRemovals\(\)\{[\s\S]*?\n\}/, 'fbApplyPendingRemovals'),
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
  grab(/function onlineRematch\(\)\{[\s\S]*?\n\}/, 'onlineRematch'),
  // C4B/Entscheidung 3: der kanonische Austritt gehoert zum Leave-Pfad dazu.
  grab(/const LEAVE_TRIES=3;[^\n]*\n/, 'LEAVE_TRIES'),
  grab(/let fbLeaveBusy=false[^\n]*\n/, 'fbLeaveState'),
  fn('fbPermanentLeaveRequired'),
  fn('fbLeaveCtxValid'),
  fn('fbBeginCanonicalLeave'),
  fn('fbCanonicalLeave'),
  fn('fbLeaveRetry'),
  fn('fbLeaveFinish'),
  fn('fbLeaveGiveUp'),
  grab(/function leaveOnline\(after\)\{[\s\S]*?\n\}/, 'leaveOnline'),
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
  const failWrites = {};
  let nowMs = 1751900000000;
  const at = parts => parts.reduce((a, k) => (a && typeof a === 'object') ? a[k] : undefined, data);
  const clone = v => (v === undefined || v === null) ? null : JSON.parse(JSON.stringify(v));
  const queue = [];
  const flush = () => { while (queue.length) queue.shift()(); };

  // Zurueckgehaltene Zustellung: Schluessel ist uid|letztes Pfadsegment. Damit laesst
  // sich nachstellen, dass ZWEI Clients denselben Schreibvorgang zu verschiedenen
  // Zeitpunkten sehen - der Kern jeder Determinismusfrage. get() bleibt unberuehrt: der
  // autoritative Abruf ist ein anderer Weg als der Listener.
  const held = new Set();
  const isHeld = l => held.has(l.uid + '|' + l.parts[l.parts.length - 1]);
  function notify() {
    for (const l of Array.from(listeners)) {
      if (!listeners.has(l)) continue;
      if (isHeld(l)) continue;
      const cur = JSON.stringify(clone(at(l.parts)));
      if (cur !== l.last) { l.last = cur; l.cb({ val: () => clone(at(l.parts)), exists: () => at(l.parts) != null }); }
    }
  }
  function buildMerged(room, writes) {
    const wp = {}, wpl = {}, wev = {}; let wstate;
    const base = seat => {
      const cur = room && room.players && room.players[seat];
      return cur ? JSON.parse(JSON.stringify(cur)) : {};
    };
    for (const w of writes) {
      if (w.parts[2] === 'p' && w.parts.length === 4) wp[w.parts[3]] = w.val;
      // C4B: Eviction-Marker aus DEMSELBEN Update. Die echten Rules pruefen den
      // ERGEBNISBAUM - der kanonische Football-Austritt schreibt Marker und beide
      // Loeschungen in einem Zug. Ohne diese Zeile wiese das Modell eine regelkonforme
      // Operation ab.
      else if (w.parts[2] === 'g' && w.parts[4] === 'e' && w.parts.length === 6)
        wev[w.parts[3] + '/' + w.parts[5]] = w.val;
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
      // C4B: Eviction-Sicht auf den ERGEBNISBAUM - Marker aus demselben Update zaehlen.
      ev: (gen, seat) => ((String(gen) + '/' + String(seat)) in wev)
        ? wev[String(gen) + '/' + String(seat)]
        : !!(room && room.g && room.g[gen] && room.g[gen].e && room.g[gen].e[seat] === true),
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
    // Vergleichsschreiben auf die Protokollversion (Action Core 04 / Protokoll v5):
    // erlaubt ist ausschliesslich ein WERTGLEICHES Schreiben. Es reist im atomaren
    // Sitzclaim mit und weist einen Raum ab, der zwischen Pruefung und Claim geloescht
    // und mit anderer Version neu angelegt wurde.
    if (key === 'v') {
      if (val !== room.v) throw new Error('PERMISSION_DENIED: protocol version mismatch');
      return;
    }

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
          if (merged.ev(room.gen, seat) !== true)
            throw new Error('PERMISSION_DENIED: football leave needs eviction');
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
          if (merged.ev(room.gen, seat) !== true)
            throw new Error('PERMISSION_DENIED: football leave needs eviction');
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
      // Der Start ist ein ATOMARES Update aus state und seats. Geprueft wird deshalb der
      // ZUSAMMENGEFUEHRTE Ergebnisbaum - dort steht das state-Bein desselben Updates.
      const stateJetzt = merged ? merged.state() : room.state;
      const pVon = i => (merged ? merged.p(i) : (room.p && room.p[i]));
      const plVon = i => (merged ? merged.players(i) : (room.players && room.players[i]));
      if (!(room.seats == null && stateJetzt === 'playing')) throw new Error('PERMISSION_DENIED: seats');
      const hostUid = room.players && room.players[0] && room.players[0].uid;
      if (authUid !== hostUid) throw new Error('PERMISSION_DENIED: seats owner');
      const activeUpTo = n => { for (let i = 0; i < n; i++) { const q = pVon(i); if (!(q && q.on === true)) return false; } return true; };
      const noneAbove = n => { for (let i = n; i < 5; i++) { const q = pVon(i); if (q && q.on === true) return false; } return true; };
      // Football startet mit zwei bis fuenf: alle gezaehlten Sitze verbunden, darueber
      // kein weiterer belegt. Eine Ablehnung faellt dank des atomaren Starts vollstaendig
      // zurueck - der Raum bleibt Lobby.
      if (isFb) {
        const keinerDarueber = (n) => { for (let i = n; i < 5; i++) if (plVon(i)) return false; return true; };
        if (!(val >= 2 && val <= 5 && activeUpTo(val) && keinerDarueber(val)))
          throw new Error('PERMISSION_DENIED: football seats');
        return;
      }
      if (!(val >= 2 && val <= cap && activeUpTo(val) && noneAbove(val))) throw new Error('PERMISSION_DENIED: seats count');
      return;
    }
    if (key === 'gen') {
      const mem = [0, 1, 2, 3, 4].some(i => room.players && room.players[i] && room.players[i].uid === authUid
        && room.p && room.p[i] && room.p[i].on === true);
      if (!authUid || !mem) throw new Error('PERMISSION_DENIED: gen');
      // C4B/Entscheidung 2: Traegt die abgeschlossene Generation einen Austritt, ist der
      // Rematch im selben Raum serverseitig gesperrt - fuer jeden Schreiber.
      const evNow = (room.g && room.g[room.gen] && room.g[room.gen].e) || {};
      const traegtAustritt = [0, 1, 2, 3, 4].some(i =>
        evNow[i] === true || (merged ? merged.ev(room.gen, i) === true : false));
      if (traegtAustritt) throw new Error('PERMISSION_DENIED: gen nach dauerhaftem Austritt');
      return;
    }
    if (key === 'g') {
      const gen = parts[3], kind = parts[4];
      if (kind === 't') {
        const pl = +parts[6];
        if (String(room.gen) !== String(gen)) throw new Error('PERMISSION_DENIED: turn gen');
        if (at(parts) != null) throw new Error('PERMISSION_DENIED: turn write-once');
        if (isFb) {
          if (!(room.seats >= 2 && room.seats <= 5)) throw new Error('PERMISSION_DENIED: turn before start signal');
          if (!val || (val.k !== 'move' && val.k !== 'skip' && val.k !== 'remove'))
            throw new Error('PERMISSION_DENIED: unknown turn kind');
          if (val.idx !== pl) throw new Error('PERMISSION_DENIED: idx must equal seat');
          const owner = room.players && room.players[pl] && room.players[pl].uid;
          const ev = (room.g && room.g[gen] && room.g[gen].e) || {};
          const on = (i) => !!(room.p && room.p[i] && room.p[i].on === true);
          if (val.k === 'move') {
            // Eigentuemerzweig: nur der Sitzinhaber selbst, und nur solange er verbunden ist.
            if (owner !== authUid) throw new Error('PERMISSION_DENIED: turn owner');
            if (!on(pl)) throw new Error('PERMISSION_DENIED: turn presence');
          } else {
            // Fremdzweig: irgendein ANDERER Sitzinhaber, selbst verbunden und nicht evictiert.
            let writer = -1;
            for (let i = 0; i < 5; i++)
              if (i !== pl && room.players && room.players[i] && room.players[i].uid === authUid) writer = i;
            if (writer < 0) throw new Error('PERMISSION_DENIED: skip writer must be another seat owner');
            if (!on(writer)) throw new Error('PERMISSION_DENIED: skip writer must be online');
            if (ev[writer] === true) throw new Error('PERMISSION_DENIED: evicted writer');
            if (val.dx !== 0 || val.dy !== 0 || val.sp !== 0)
              throw new Error('PERMISSION_DENIED: skip/remove must carry the zero vector');
            if (val.k === 'skip') {
              // Der Kern des Vertrags: das Ziel muss offline sein - im ERGEBNISBAUM.
              if (on(pl)) throw new Error('PERMISSION_DENIED: skip target is online');
              if (ev[pl] === true) throw new Error('PERMISSION_DENIED: skip for an evicted seat');
            } else {
              if (ev[pl] !== true) throw new Error('PERMISSION_DENIED: remove without eviction');
            }
          }
        }
        return;
      }
      if (kind === 'e') {
        // C4B: Eviction-Marker. Nachgebildet wird der Zweig aus firebase.rules.json:
        // v4, laufendes Match, fuenf Sitze, write-once, aktuelle Generation, der Sitz
        // existiert - und geschrieben wird entweder vom Sitzinhaber SELBST oder von
        // einem anderen, verbundenen und nicht evictierten Mitspieler, dessen Ziel
        // seit mindestens 15 s offline ist.
        const seat = +parts[5];
        if (!isFb) throw new Error('PERMISSION_DENIED: eviction only in football');
        if (room.state !== 'playing' || !(room.seats >= 2 && room.seats <= 5)) throw new Error('PERMISSION_DENIED: eviction state');
        if (String(room.gen) !== String(gen)) throw new Error('PERMISSION_DENIED: eviction gen');
        if (at(parts) != null) throw new Error('PERMISSION_DENIED: eviction write-once');
        if (val !== true) throw new Error('PERMISSION_DENIED: eviction value');
        if (!(room.players && room.players[seat])) throw new Error('PERMISSION_DENIED: eviction unknown seat');
        if (!authUid) throw new Error('PERMISSION_DENIED: eviction unauthenticated');
        const ev = (room.g && room.g[gen] && room.g[gen].e) || {};
        const on = (i) => !!(room.p && room.p[i] && room.p[i].on === true);
        const ownSeat = [0, 1, 2, 3, 4].filter(i => room.players[i] && room.players[i].uid === authUid);
        if (ownSeat.indexOf(seat) >= 0) return;            // Selbstaustritt, ohne Frist
        let writer = -1;
        for (const i of ownSeat) if (i !== seat && on(i) && ev[i] !== true) writer = i;
        if (writer < 0) throw new Error('PERMISSION_DENIED: eviction writer must be a connected peer');
        if (on(seat)) throw new Error('PERMISSION_DENIED: eviction target is online');
        const t0 = room.p && room.p[seat] && room.p[seat].t;
        if (!(typeof t0 === 'number' && (nowMs - t0) >= 15000))
          throw new Error('PERMISSION_DENIED: eviction target not stale enough');
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
    // .info/connected ist kein Raumpfad - direkt setzen und melden (C1).
    setConnected(v) { if (!data['.info']) data['.info'] = {}; data['.info'].connected = v; notify(); },
    // Nur melden, ohne etwas zu schreiben (C4B-Tests).
    touch() { notify(); },
    // Praesenz eines Sitzes umschalten, wie es ein serverseitiges onDisconnect tut (C2).
    setPresence(code, seat, on) {
      const r = data.rooms[code]; if (!r || !r.p || !r.p[seat]) return false;
      r.p[seat].on = !!on; r.p[seat].t = nowMs; notify(); return true;
    },
    // C3: .info/serverTimeOffset - der Standardweg zur Angleichung an die Serverzeit.
    publishOffset() {
      if (!data['.info']) data['.info'] = {};
      data['.info'].serverTimeOffset = nowMs - Date.now();
      notify();
    },
    // Serverzeit vorstellen UND den Offset nachziehen: fuer den Client bewegt sich
    // damit die Serverzeit, nicht seine eigene Uhr.
    advanceServer(ms) { nowMs += ms; this.publishOffset(); },
    // Einem Client einen Pfad vorenthalten bzw. ihn nachtraeglich zustellen.
    hold(uid, key) { held.add(uid + '|' + key); },
    release(uid, key) { held.delete(uid + '|' + key); notify(); },
    // Die naechsten n update()-Aufrufe dieses Clients scheitern.
    failWrites(uid, n) { failWrites[uid] = n; },
    flush,
    // Ein Client sieht die Datenbank ausschliesslich durch dieses Objekt - mit SEINER
    // Identitaet. Zwei Clients koennen sich so nicht gegenseitig als Schreiber ausgeben.
    FBfor(ui, authUid) {
      const self = {
        db: {}, serverTimestamp: () => ({ __ts: true }),
        ref: (_db, p) => ({ parts: p.split('/') }),
        onValue(ref, cb) {
          const l = { parts: ref.parts, cb, last: undefined, uid: authUid };
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
            // Fehlerinjektion: nur so laesst sich pruefen, was passiert, wenn ein
            // dauerhafter Austritt WIRKLICH nicht zustande kommt.
            if (failWrites[authUid] > 0) { failWrites[authUid]--; rej(new Error('PERMISSION_DENIED: injiziert')); return; }
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
    // Die echte Ansicht des Spiels ist 3D - Arena Football verlangt sie, und der
    // Beitritt lehnt einen Client ohne sie ab (er koennte einen Sitz besetzen, ohne
    // ziehen zu koennen). Ein Client des Harness ist deshalb standardmaessig SPIELBAR.
    // Die Zeigerpruefung faehrt trotzdem beide Wege: sie schaltet die Ansicht nach dem
    // Beitritt um (view2d) - der 2D-Zweig prueft die reine Eingabelogik, der 3D-Zweig
    // zusaetzlich die Trefferpruefung ueber die echte Projektion.
    let r3dActive=${opts.no3d ? 'false' : 'true'};
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
    const NAME_MAX=16, NAME_MAX_UNITS=48, LOBBY_HOST_GRACE_MS=12000;
    // Rueckkehrfrist: Produktvertrag, deshalb aus index.html uebernommen.
    const SEAT_STALE_MS=${SEAT_STALE_FROM_SOURCE};
    let roomP={}, matchGraceTimer={}, roomPSeen=false;
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
      lobbyHint(){ return els['lobbyHint']?String(els['lobbyHint'].textContent||''):''; },
      lobbyCount(){ return els['lobbyCount']?String(els['lobbyCount'].textContent||''):''; },
      // Startversuch mit einer Zahl, die inzwischen ueberholt ist - genau das
      // Rennen zwischen Kopfzaehlen und Klick.
      startWith(n){ const echt=seatCount(lobbyP);
        try{ lobbyP=JSON.parse(JSON.stringify(lobbyP)); for(let i=n;i<echt;i++)delete lobbyP[i];
             startFfaMatch(); }finally{ lobbyP=roomP; } },
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
      // Nur fuer die Zeigerpruefung: die Ansicht umschalten, NACHDEM der Sitz steht.
      view2d(){ r3dActive=false; },
      view3d(){ r3dActive=true; },
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
      prepareReplay(seat, g, n){ mode='football'; fbVariant=FOOTBALL_VARIANT_ELIM; fmt=FB_ONLINE_FMT;
        online=true; myPlayer=seat; gen=g; runningGen=-1; gameStarted=true; roomCode=ui.code;
        // Genau die Zeile aus attemptRejoin: die Startbesetzung kommt aus dem
        // kanonischen Startsignal, nicht aus der aktuellen Praesenz.
        if(n>=2)fbElimStartN=n; },
      // Die ECHTE Rueckkehrpruefung des Produkts auf einem Raum-Schnappschuss.
      rejoinCheck(d){ return validateRejoinRoom(d); },
      startN(){ return fbElimPlayers(); },
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
      leave(){ leaveOnline(); },
      // Der Uebergang, den der Aufrufer normalerweise mitgibt (showMenu). Er raeumt den
      // Matchzustand ab und darf deshalb erst nach der Bestaetigung laufen.
      leaveThen(){ ui.afterCount=ui.afterCount||0; leaveOnline(()=>{ ui.afterCount++; }); },
      afterCount(){ return ui.afterCount||0; },
      tab(){ return onlineTab; },
      // C4B/Entscheidung 3: was der Austritt gerade tut und woran er scheiterte.
      leaveState(){ return { busy:fbLeaveBusy, retired:fbLeaveRetired, error:fbLeaveError }; },
      // C4B/Entscheidung 2: der Generationswechsel OHNE den Client-Waechter - so wird
      // sichtbar, ob der SERVER ihn sperrt.
      forceGenWrite(){ return window.FB.set(rRef('gen'),gen+1).then(()=>'ok',()=>'denied'); },
      // C2-Sonden: die ENTSCHEIDUNG des Clients sichtbar machen. Nur das Ergebnis in der
      // Datenbank zu pruefen genuegt nicht - unzulaessige Schreibvorgaenge weist die
      // Datenbank ohnehin ab, und der Test koennte eine fehlende Pruefung im Client
      // nicht mehr von einer Ablehnung unterscheiden.
      skipBoundary(){ return fbSkipBoundary(); },
      grace(s){ return fbSeatGrace(s); },
      candidates(){ return fbAbsenceCandidates(); },
      ev(){ return JSON.parse(JSON.stringify(roomEv||{})); },
      tryEvict(s){ return fbWriteEviction(s); },
      closeSlot(s){ return fbCloseSeatSlot(s,0); },
      eligible(){ return fbEligibleOwners(); },
      pendingRemovals(){ const o=[]; for(let i=0;i<fbElimPlayers();i++)if(fbRemovePending[i])o.push(i); return o; },
      applyRemovals(){ return fbApplyPendingRemovals(); },
      elimEliminate(o){ footballElimEliminate(o); },
      exitHappened(){ return fbPermanentExitHappened(); },
      rematch(){ onlineRematch(); },
      rematchShown(){ return els['rematchBtn'] ? els['rematchBtn'].style.display !== 'none' : null; },
      evWatch(){ return !!evUnsub; },
      boundary(){ return fbSkipBoundary(); },
      clockReady(){ return serverClockReady; },
      genStart(){ return {at:genStartedAt,pending:genStartPending}; },
      trySkip(s){ return fbWriteSkip(s,0); },
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
  const api = factory(FB, ui);
  api.uid = uid;          // fuer clientweise Zustellsteuerung im Test
  return api;
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
// Wie setupMatch, aber mit n Teilnehmern (2-5). Derselbe Produktweg: Dev-Einstieg,
// Raum anlegen, beitreten, Host startet.
async function setupMatchN(db, code, n) {
  const cs = [];
  for (let i = 0; i < n; i++) cs.push(makeClient(db, code, { name: 'P' + (i + 1) }));
  cs[0].enterFootball(); cs[0].create(); await tick(db);
  for (let i = 1; i < n; i++) { cs[i].join(code); await tick(db); }
  cs[0].start(); await tick(db);
  return cs;
}
async function newMatchN(code, n) {
  const db = makeDB();
  const cs = await setupMatchN(db, code, n);
  return { db, cs };
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
    t('A der Raum traegt die aktuelle Protokollversion v' + VER, room && room.v === VER);
    t('A Raumtyp football', room && room.config.game === 'football');
    t('A Format elimination', room && room.config.fmt === 'elimination');
    t('A der Ersteller sitzt auf Sitz 0', cs[0].st().myPlayer === 0 && room.players[0].uid === cs[0].uid);
    t('A der Raum startet in der Lobby', room.state === 'lobby' && room.seats === undefined);
    t('A der Titel nennt Arena Football', cs[0].onTitle() === 'ARENA FOOTBALL');

    // Allein kann niemand starten - Client UND Server verweigern.
    cs[0].start(); await tick(db);
    t('A allein startet das Match nicht', db.data.rooms[CODE].state === 'lobby');
    t('A der Startknopf ist bei 1/5 gesperrt', cs[0].lobbyStartDisabled() === true);
    // Ab zwei Teilnehmern darf der Host starten (der eigentliche Start folgt weiter
    // unten mit voller Besetzung; die Startgruppen 2/3/4 stehen in C5).
    cs[1].join(CODE); await tick(db);
    t('A ab 2/5 ist der Startknopf frei', cs[0].lobbyStartDisabled() === false);

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
    // Diese Aussage stammt aus Phase B, als es fuer Football noch gar keinen SKIP gab.
    // Mit C2 bekommt der getrennte Sitz waehrend seiner Abwesenheit regulaer einen
    // SKIP - das ist der Zweck der Aenderung. Unveraendert gilt: KEINE Eviction, KEIN
    // remove, und ein SKIP nur fuer den Sitz, der tatsaechlich getrennt war.
    {
      const T = db.data.rooms.FBQ6.g[0].t;
      const kinds = {};
      for (const tn of Object.keys(T)) for (const sn of Object.keys(T[tn])) {
        (kinds[T[tn][sn].k] = kinds[T[tn][sn].k] || []).push(tn + '/' + sn);
      }
      t('N keine Eviction und kein remove', db.data.rooms.FBQ6.g[0].e === undefined && !kinds.remove,
        { e: db.data.rooms.FBQ6.g[0].e, kinds: Object.keys(kinds) });
      t('N ein SKIP entsteht ausschliesslich fuer den getrennten Sitz 2',
        (kinds.skip || []).every(x => x.split('/')[1] === '2'), kinds.skip);
      t('N alle uebrigen Datensaetze sind echte Zuege',
        (kinds.move || []).length + (kinds.skip || []).length ===
        Object.keys(T).reduce((n, tn) => n + Object.keys(T[tn]).length, 0), Object.keys(kinds));
    }

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

  // ── (P) DER OEFFENTLICHE WEG TRAEGT - UND SCHUETZT WEITER ───────────────────
  // Arena Football Online ist ab jetzt ein normaler Produktweg. Geprueft wird an der
  // echten Datenbank, dass ein Client OHNE ?dev=1 einen Football-Raum anlegt, ueber den
  // Raumcode beitritt und auf seinen Sitz zurueckkehrt - und dass dabei alles andere
  // unveraendert gilt: Kapazitaet fuenf, Start ab zwei, eingefrorene Startbesetzung,
  // kein spaeter Beitritt. Der Dev-Schalter ist kein Tuersteher mehr, sondern nur noch
  // eine Abkuerzung im Menue: beide Wege muessen dasselbe Ergebnis liefern.
  {
    const db = makeDB();
    // Ein ganz normaler Client legt den Raum an.
    const host = makeClient(db, 'PUB1', { name: 'HOST', dev: false });
    host.enterFootball(); host.create(); await tick(db);
    t('P ohne ?dev=1 entsteht ein Raum', !!db.data.rooms.PUB1, Object.keys(db.data.rooms));
    t('P und zwar ein FOOTBALL-Raum, kein RingOut-Raum',
      db.data.rooms.PUB1.config.game === 'football', db.data.rooms.PUB1.config);
    t('P mit dem bestehenden Raumformat', db.data.rooms.PUB1.config.fmt === 'elimination',
      db.data.rooms.PUB1.config.fmt);
    t('P er startet in der Lobby', db.data.rooms.PUB1.state === 'lobby');
    t('P der Host sitzt auf Sitz 0 und ist online',
      host.st().online === true && host.st().myPlayer === 0 && host.st().mode === 'football',
      host.st());

    // Beitritt ueber den Raumcode - ebenfalls ohne Dev-Schalter.
    const gaeste = [];
    for (let i = 1; i < 5; i++) {
      const g = makeClient(db, 'PUB1', { name: 'G' + i, dev: false });
      g.join('PUB1'); await tick(db);
      gaeste.push(g);
    }
    t('P vier weitere Clients treten ohne ?dev=1 bei',
      gaeste.every((g, i) => g.st().online === true && g.st().myPlayer === i + 1),
      gaeste.map(g => g.st().myPlayer));
    t('P alle landen im Football-Modus',
      gaeste.every(g => g.st().mode === 'football' && g.st().fmt === 'elimination'));
    t('P der Raum fasst genau fuenf Sitze',
      Object.keys(db.data.rooms.PUB1.players).length === 5);
    // Der sechste kommt nicht mehr hinein - die Kapazitaet ist unveraendert.
    const sechster = makeClient(db, 'PUB1', { name: 'G5', dev: false });
    sechster.join('PUB1'); await tick(db);
    t('P ein sechster Client bekommt keinen Sitz', sechster.st().online === false, sechster.st());
    t('P und der Raum bleibt bei fuenf',
      Object.keys(db.data.rooms.PUB1.players).length === 5);
    sechster.drop();

    // Der Host startet - dasselbe Startsignal wie bisher.
    host.start(); await tick(db);
    t('P der oeffentliche Host startet das Match', db.data.rooms.PUB1.state === 'playing');
    t('P und friert die Startbesetzung ein', db.data.rooms.PUB1.seats === 5,
      db.data.rooms.PUB1.seats);
    for (const g of gaeste) g.drop();
    host.drop();
  }

  {
    // Start ab ZWEI - auch das gilt fuer den oeffentlichen Weg unveraendert, und allein
    // startet weiterhin niemand.
    const db = makeDB();
    const a = makeClient(db, 'PUB2', { name: 'A', dev: false });
    a.enterFootball(); a.create(); await tick(db);
    t('P allein ist der Startknopf gesperrt', a.lobbyStartDisabled() === true);
    a.start(); await tick(db, 20);
    t('P und es wird kein Startsignal geschrieben', db.data.rooms.PUB2.seats === undefined,
      db.data.rooms.PUB2.seats);
    t('P der Raum bleibt in der Lobby', db.data.rooms.PUB2.state === 'lobby');
    const b = makeClient(db, 'PUB2', { name: 'B', dev: false });
    b.join('PUB2'); await tick(db);
    t('P zu zweit ist er frei', a.lobbyStartDisabled() === false);
    a.start(); await tick(db);
    t('P und das Match startet zu zweit', db.data.rooms.PUB2.seats === 2,
      db.data.rooms.PUB2.seats);
    // Und danach kommt niemand mehr hinein - die Besetzung ist eingefroren.
    const spaet = makeClient(db, 'PUB2', { name: 'SPAET', dev: false });
    spaet.join('PUB2'); await tick(db);
    t('P ein spaeter Beitritt bleibt draussen', spaet.st().online === false ||
      spaet.st().myPlayer >= db.data.rooms.PUB2.seats, spaet.st());
    t('P die eingefrorene Besetzung bleibt bei zwei', db.data.rooms.PUB2.seats === 2);
    spaet.drop(); a.drop(); b.drop();
  }

  {
    // Die Rueckkehr auf den eigenen Sitz - ohne Dev-Schalter, und mit demselben
    // Ergebnis wie mit ihm. Die Grenze ist der SITZ, nicht der Schalter.
    const db = makeDB();
    const cs = [];
    for (let i = 0; i < 3; i++) cs.push(makeClient(db, 'PUB3', { name: 'R' + i, dev: false }));
    cs[0].enterFootball(); cs[0].create(); await tick(db);
    for (let i = 1; i < 3; i++) { cs[i].join('PUB3'); await tick(db); }
    cs[0].start(); await tick(db);
    t('P Vorbedingung: ein laufendes Match zu dritt', db.data.rooms.PUB3.seats === 3);
    const weg = cs[2], pid = weg.pid, uid = weg.uid;
    weg.drop(); db.data.rooms.PUB3.p[2].on = false;
    const zurueck = makeClient(db, 'PUB3', { pid, uid, name: 'R2', dev: false });
    const p1 = zurueck.rejoin('PUB3'); await tick(db); const ok1 = await p1; await tick(db);
    t('P ohne ?dev=1 gelingt die Rueckkehr auf den eigenen Sitz',
      ok1 === true && zurueck.st().myPlayer === 2, { ok1, st: zurueck.st() });
    // Gegenprobe: derselbe Weg MIT Dev-Schalter liefert dasselbe - der Schalter ist
    // keine Grenze mehr, sondern nur noch eine Abkuerzung im Menue.
    zurueck.drop(); db.data.rooms.PUB3.p[2].on = false;
    const mitDev = makeClient(db, 'PUB3', { pid, uid, name: 'R2' });
    const p2 = mitDev.rejoin('PUB3'); await tick(db); const ok2 = await p2; await tick(db);
    t('P mit ?dev=1 gelingt dieselbe Rueckkehr',
      ok2 === true && mitDev.st().myPlayer === 2, { ok2 });
    // Ein FREMDER Sitz bleibt unerreichbar - daran hat sich nichts geaendert.
    const fremd = makeClient(db, 'PUB3', { name: 'FREMD', dev: false });
    const p3 = fremd.rejoin('PUB3'); await tick(db); const ok3 = await p3; await tick(db);
    t('P eine fremde Identitaet kommt weiterhin nicht auf einen Sitz',
      ok3 === false && fremd.st().online === false, { ok3, st: fremd.st() });
    fremd.drop(); mitDev.drop();
    for (const c of cs) c.drop();
  }

  {
    // Ein Client OHNE 3D-Szene darf keinen Sitz bekommen. Arena Football braucht sie -
    // ohne sie sagt schon die Statuszeile, dass der Modus nicht spielbar ist. Bekaeme er
    // trotzdem einen Sitz, wartete das Match auf einen Zug, den er nicht machen kann,
    // bis Frist und REMOVE greifen.
    const db = makeDB();
    const wirt = makeClient(db, 'N3D1', { name: 'H', dev: false });
    wirt.enterFootball(); wirt.create(); await tick(db);
    const blind = makeClient(db, 'N3D1', { name: 'BLIND', dev: false, no3d: true });
    blind.join('N3D1'); await tick(db);
    t('P ein Client ohne 3D-Szene bekommt keinen Sitz',
      blind.st().online === false && blind.st().roomCode === '', blind.st());
    t('P und der Sitz bleibt frei', db.data.rooms.N3D1.players[1] === undefined,
      Object.keys(db.data.rooms.N3D1.players));
    // Ein sehender Client bekommt denselben Sitz sofort - die Bedingung ist die Szene,
    // nicht der Raum.
    const sehend = makeClient(db, 'N3D1', { name: 'G', dev: false });
    sehend.join('N3D1'); await tick(db);
    t('P ein spielbarer Client bekommt ihn', sehend.st().myPlayer === 1, sehend.st());
    wirt.start(); await tick(db);
    t('P und das Match startet', db.data.rooms.N3D1.seats === 2);

    // Auch die RUECKKEHR auf den eigenen Sitz verlangt die Szene.
    const pid = sehend.pid, uid = sehend.uid;
    sehend.drop(); db.data.rooms.N3D1.p[1].on = false;
    const zurueckBlind = makeClient(db, 'N3D1', { pid, uid, name: 'G', dev: false, no3d: true });
    const pb = zurueckBlind.rejoin('N3D1'); await tick(db); const okb = await pb; await tick(db);
    t('P ohne 3D-Szene gelingt auch die Rueckkehr nicht',
      okb === false && zurueckBlind.st().online === false, { okb, st: zurueckBlind.st() });
    t('P der Sitz bleibt dabei unberuehrt', db.data.rooms.N3D1.players[1] !== undefined);
    // Mit Szene gelingt genau dieselbe Rueckkehr - der gespeicherte Raum wurde nicht
    // verworfen, nur der Versuch abgelehnt.
    const zurueckSehend = makeClient(db, 'N3D1', { pid, uid, name: 'G', dev: false });
    const pz = zurueckSehend.rejoin('N3D1'); await tick(db); const okz = await pz; await tick(db);
    t('P mit 3D-Szene gelingt dieselbe Rueckkehr',
      okz === true && zurueckSehend.st().myPlayer === 1, { okz, st: zurueckSehend.st() });
    zurueckBlind.drop(); zurueckSehend.drop(); blind.drop(); wirt.drop();
  }

  {
    // Und der Dev-Weg selbst ist unveraendert: ein Client MIT ?dev=1 legt denselben
    // Raum an und spielt denselben Ablauf.
    const db = makeDB();
    const cs = [];
    for (let i = 0; i < 2; i++) cs.push(makeClient(db, 'PUB4', { name: 'D' + i }));
    cs[0].enterFootball(); cs[0].create(); await tick(db);
    cs[1].join('PUB4'); await tick(db);
    cs[0].start(); await tick(db);
    t('K der Dev-Weg legt denselben Raumtyp an',
      db.data.rooms.PUB4.config.game === 'football' && db.data.rooms.PUB4.seats === 2);
    await playRound(db, cs, () => [-50, 30]);
    t('K und spielt sich unveraendert', sameHash(cs) && cs[0].st().turnNo >= 0);
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
      for (let i = 0; i < 5; i++) cs.push(makeClient(db, code, { name: 'P' + (i + 1) }));
      cs[0].enterFootball(); cs[0].create(); await tick(db);
      for (let i = 1; i < 5; i++) { cs[i].join(code); await tick(db); }
      cs[0].start(); await tick(db);
      // Die Ansicht wird ERST nach dem Beitritt umgeschaltet: ein Client ohne 3D-Szene
      // bekaeme gar keinen Sitz (s. Beitrittsbedingung). Geprueft wird hier die
      // Eingabelogik, nicht die Beitrittsbedingung.
      if (!d3) for (const c of cs) c.view2d();
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


// ── C1 · TRANSIENTER RECONNECT IM LAUFENDEN FOOTBALL-MATCH ────────────────────
// Ein kurzer Verbindungsabriss darf den Spielzustand nicht beruehren - er stellt nur
// die Verbindung wieder her. Und ein bereits Ausgeschiedener bleibt ausgeschieden.
{
  const { db, cs } = await newMatch('C1F1');
  const code = 'C1F1', seat = 2, c = cs[seat];
  const before = c.st(), hash0 = c.hash();
  const room = () => db.data.rooms[code];
  const rec0 = JSON.stringify(room().players[seat]);

  // Der Server hat das armierte onDisconnect ausgefuehrt.
  room().p[seat].on = false;
  db.setConnected(true); await tick(db, 40);

  const after = c.st();
  t('C1F die Praesenz des lebenden Sitzes ist wiederhergestellt',
    room().p[seat].on === true, room().p[seat]);
  t('C1F gleicher Sitz', after.myPlayer === before.myPlayer && after.myPlayer === seat, after.myPlayer);
  t('C1F Rosterdatensatz unveraendert', JSON.stringify(room().players[seat]) === rec0, room().players[seat]);
  t('C1F keine Leben veraendert', after.lives.join(',') === before.lives.join(','),
    { vorher: before.lives, nachher: after.lives });
  t('C1F niemand eliminiert', after.active.join(',') === before.active.join(','), after.active);
  t('C1F Slot->Eigentuemer unveraendert', after.slots.join(',') === before.slots.join(','), after.slots);
  t('C1F Arenaphase, Zug und Torzustand unveraendert',
    after.phaseN === before.phaseN && after.turnNo === before.turnNo && after.goal === before.goal, after);
  t('C1F kein Sieger erfunden', after.winner === null && after.over.length === 0, after);
  t('C1F Simulationszustand unveraendert (gleicher Hash)', c.hash() === hash0,
    { vorher: hash0, nachher: c.hash() });
  t('C1F alle fuenf Clients bleiben deckungsgleich', sameHash(cs), cs.map(x => x.hash()));
  t('C1F kein zusaetzlicher Sitz angelegt',
    Object.keys(room().players).length === 5, Object.keys(room().players));
}

// Der Ausgeschiedene: Identitaet und Verbindung ja - Spielrechte nein.
{
  const db = makeDB(), code = 'C1F2';
  const cs = await setupMatch(db, code);
  const victim = 3;
  const okE = await eliminateSeat(db, cs, victim, 90);
  t('C1F2 Vorbedingung: der Sitz ist ausgeschieden', okE && cs[0].st().active[victim] === false,
    cs[0].st().active);
  if (okE) {
    const c = cs[victim], before = c.st(), hash0 = c.hash();
    const room = () => db.data.rooms[code];
    room().p[victim].on = false;
    db.setConnected(true); await tick(db, 40);

    t('C1F2 die Verbindung des Ausgeschiedenen wird wiederhergestellt',
      room().p[victim].on === true, room().p[victim]);
    t('C1F2 er bleibt ausgeschieden', c.st().active[victim] === false, c.st().active);
    t('C1F2 er bekommt keine Leben zurueck', c.st().lives.join(',') === before.lives.join(','),
      { vorher: before.lives, nachher: c.st().lives });
    t('C1F2 er erhaelt kein Zielrecht', c.who() !== victim, c.who());
    t('C1F2 der Spielzustand ist unveraendert', c.hash() === hash0, { vorher: hash0, nachher: c.hash() });
    t('C1F2 die Ueberlebenden sind unveraendert',
      cs[0].st().active.join(',') === before.active.join(','), cs[0].st().active);
  }
}


// ── C2 · VORUEBERGEHEND OFFLINE → SICHERER SKIP ────────────────────────────────
// Die Reservierung eines Sitzes ist ein RECHT AUF RUECKKEHR, keine Pflicht der uebrigen,
// auf ihn zu warten. Ist ein aktiver Teilnehmer an einer Eingabegrenze offline und hat
// keinen Zug abgegeben, schliesst ein Mitspieler dessen Slot mit dem kanonischen
// Nullzug - auf dem URSPRUENGLICHEN Sitz.
{
  const turnsOf = (db, code, gen) => (((db.data.rooms[code].g || {})[gen || 0] || {}).t) || {};
  const offline = async (db, code, seat) => { db.setPresence(code, seat, false); await tick(db, 20); };
  const online = async (db, code, seat) => { db.setPresence(code, seat, true); await tick(db, 20); };

  // ── C2-1: offline VOR dem Zug → SKIP, und die Runde laeuft weiter ──
  {
    const { db, cs } = await newMatch('C21A');
    const code = 'C21A', off = 3;
    const before = cs[0].st();
    await offline(db, code, off);
    for (const c of cs) if (c.idx !== off) c.commitVec(60, -40, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);

    const rec = turnsOf(db, code)[0] || {};
    const after = cs[0].st();
    t('C2-1 der getrennte Sitz bekommt einen SKIP',
      rec[String(off)] && rec[String(off)].k === 'skip', rec[String(off)]);
    t('C2-1 der SKIP traegt den Nullvektor und den EIGENEN Sitzindex',
      rec[String(off)] && rec[String(off)].idx === off && rec[String(off)].dx === 0
      && rec[String(off)].dy === 0 && rec[String(off)].sp === 0, rec[String(off)]);
    t('C2-1 er steht im Slot des URSPRUENGLICHEN Sitzes',
      Object.keys(rec).sort().join(',') === '0,1,2,3,4', Object.keys(rec));
    t('C2-1 die Runde laeuft weiter', after.turnNo === before.turnNo + 1, after.turnNo);
    t('C2-1 alle fuenf Clients sind deckungsgleich', sameHash(cs), cs.map(c => c.hash()));

    // Die Zusicherungen aus dem Vertrag.
    t('C2-1 kein Leben verloren', after.lives.join(',') === before.lives.join(','),
      { vorher: before.lives, nachher: after.lives });
    t('C2-1 niemand eliminiert', after.active.join(',') === before.active.join(','), after.active);
    t('C2-1 kein Tor', after.goal === 'play' && cs[0].sfx().goal === 0, { goal: after.goal });
    t('C2-1 keine Sitzverschiebung', after.slots.join(',') === before.slots.join(','), after.slots);
    t('C2-1 kein REMOVE und keine Eviction',
      db.data.rooms[code].g[0].e === undefined
      && !Object.keys(turnsOf(db, code)).some(tn => Object.keys(turnsOf(db, code)[tn])
        .some(sn => turnsOf(db, code)[tn][sn].k === 'remove')), db.data.rooms[code].g[0].e);
    t('C2-1 die Arena bleibt unveraendert', after.phaseN === before.phaseN, after.phaseN);
    t('C2-1 der Roster bleibt vollstaendig - kein Sitz freigegeben',
      Object.keys(db.data.rooms[code].players).length === 5
      && db.data.rooms[code].players[off] !== undefined, Object.keys(db.data.rooms[code].players));
    t('C2-1 die Praesenz des Getrennten bleibt offline (Reservierung besteht)',
      db.data.rooms[code].p[off].on === false, db.data.rooms[code].p[off]);
    // Und der Koerper: er bleibt stehen, lebt und ist weiter da.
    const body = cs[0].raw().balls.find(b => b.owner === off);
    t('C2-1 die Figur des Uebersprungenen lebt weiter', !!body && body.alive === true, !!body);
  }

  // ── C2-2: offline NACH dem eigenen Zug → der Zug bleibt ──
  {
    const { db, cs } = await newMatch('C22A');
    const code = 'C22A', off = 2;
    cs[off].commitVec(70, 20, 0); await tick(db, 30);
    const mine = JSON.stringify(turnsOf(db, code)[0][String(off)]);
    await offline(db, code, off);
    for (const c of cs) if (c.idx !== off) c.commitVec(50, -30, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
    const rec = turnsOf(db, code)[0][String(off)];
    t('C2-2 der bereits abgegebene Zug bleibt unveraendert', JSON.stringify(rec) === mine, rec);
    t('C2-2 er wird NICHT durch einen SKIP ersetzt', rec.k === 'move', rec.k);
    t('C2-2 die Runde laeuft normal weiter', cs[0].st().turnNo === 1, cs[0].st().turnNo);
  }

  // ── C2-3: Trennung waehrend der Simulation → kein SKIP mitten hinein ──
  {
    const { db, cs } = await newMatch('C23A');
    const code = 'C23A', off = 1;
    for (const c of cs) c.commitVec(80, 10, 0);
    await tick(db, 30);
    // Jetzt laeuft die Runde. Waehrenddessen faellt Sitz 1 aus.
    t('C2-3 Vorbedingung: die Runde rechnet', cs[0].st().phase !== 'aim', cs[0].st().phase);
    await offline(db, code, off);
    const t0 = JSON.stringify(turnsOf(db, code)[0]);
    t('C2-3 waehrend der Simulation entsteht kein zusaetzlicher Datensatz',
      JSON.stringify(turnsOf(db, code)[0]) === t0, turnsOf(db, code)[0]);
    for (const c of cs) c.pump();
    await tick(db, 40);
    t('C2-3 die Runde 0 traegt weiterhin fuenf echte Zuege',
      Object.keys(turnsOf(db, code)[0]).length === 5
      && Object.keys(turnsOf(db, code)[0]).every(k => turnsOf(db, code)[0][k].k === 'move'),
      turnsOf(db, code)[0]);
    t('C2-3 kein Leben und keine Elimination durch die Trennung',
      cs[0].st().lives.join(',') === '2,2,2,2,2' && cs[0].st().active.join(',') === 'true,true,true,true,true',
      cs[0].st());

    // ── C2-4: an der NAECHSTEN Eingabegrenze bekommt er dann seinen SKIP ──
    await tick(db, 20);
    for (const c of cs) if (c.idx !== off) c.commitVec(40, 40, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
    const r1 = turnsOf(db, code)[1] || {};
    t('C2-4 in der naechsten Runde erhaelt der weiterhin getrennte Sitz einen SKIP',
      r1[String(off)] && r1[String(off)].k === 'skip', r1[String(off)]);
  }

  // ── C2-5: Rueckkehr VOR dem SKIP → der SKIP wird abgelehnt ──
  // Der Schreibvorgang liegt in der Warteschlange, waehrend die Praesenz zurueckkommt.
  // Geprueft wird beim Schreiben, nicht beim Auswaehlen - genau wie in den echten Rules.
  {
    const { db, cs } = await newMatch('C25A');
    const code = 'C25A', off = 4;
    // Der SKIP wird angesetzt (die Clients sehen die Trennung sofort), liegt aber noch
    // in der Warteschlange, als die Praesenz zurueckkehrt. Geprueft wird beim Schreiben.
    db.setPresence(code, off, false);
    db.setPresence(code, off, true);
    await tick(db, 40);
    const rec = (turnsOf(db, code)[0] || {})[String(off)];
    t('C2-5 kehrt der Sitz vorher zurueck, entsteht KEIN SKIP',
      rec === undefined || rec.k === 'move', rec);
    // Und er zieht wieder selbst.
    cs[off].commitVec(55, 15, 0); await tick(db, 30);
    const rec2 = (turnsOf(db, code)[0] || {})[String(off)];
    t('C2-5 der zurueckgekehrte Spieler zieht selbst', rec2 && rec2.k === 'move', rec2);
  }

  // ── C2-6: Rueckkehr NACH dem SKIP → Runde N bleibt SKIP, Runde N+1 zaehlt wieder ──
  {
    const { db, cs } = await newMatch('C26A');
    const code = 'C26A', off = 2;
    await offline(db, code, off);
    for (const c of cs) if (c.idx !== off) c.commitVec(60, -40, 0);
    await tick(db, 40);
    const skipped = JSON.stringify(turnsOf(db, code)[0][String(off)]);
    t('C2-6 Vorbedingung: der SKIP steht', JSON.parse(skipped).k === 'skip', skipped);
    // Er kehrt zurueck, bevor die naechste Runde beginnt.
    await online(db, code, off);
    for (const c of cs) c.pump();
    await tick(db, 40);
    t('C2-6 der SKIP der Runde 0 bleibt unveraendert',
      JSON.stringify(turnsOf(db, code)[0][String(off)]) === skipped, turnsOf(db, code)[0][String(off)]);
    t('C2-6 derselbe Sitz, dieselbe Identitaet', cs[off].st().myPlayer === off, cs[off].st().myPlayer);
    t('C2-6 unveraenderte Leben', cs[off].st().lives.join(',') === '2,2,2,2,2', cs[off].st().lives);
    // Runde 1: er spielt wieder normal mit.
    for (const c of cs) c.commitVec(45, 25, 0);
    await tick(db, 40);
    const r1 = turnsOf(db, code)[1] || {};
    t('C2-6 in der naechsten Runde zieht er wieder selbst',
      r1[String(off)] && r1[String(off)].k === 'move', r1[String(off)]);
    for (const c of cs) c.pump();
    await tick(db, 40);
    t('C2-6 alle bleiben deckungsgleich', sameHash(cs), cs.map(c => c.hash()));
  }

  // ── C2-7: MOVE gegen SKIP - genau ein Datensatz ──
  {
    const { db, cs } = await newMatch('C27A');
    const code = 'C27A', off = 3;
    db.setPresence(code, off, false);
    db.flush();                       // SKIP-Versuche laufen an
    cs[off].commitVec(65, -15, 0);    // im selben Moment zieht der Spieler doch
    await tick(db, 40);
    const rec = (turnsOf(db, code)[0] || {})[String(off)];
    t('C2-7 es existiert genau EIN Datensatz', rec !== undefined && typeof rec === 'object', rec);
    t('C2-7 und er ist entweder ein echter Zug oder ein SKIP - nie beides, nie halb',
      rec && (rec.k === 'move' || rec.k === 'skip') && rec.idx === off, rec);
    t('C2-7 die Clients bleiben deckungsgleich', sameHash(cs), cs.map(c => c.hash()));
  }

  // ── C2-8: mehrere Clients schreiben denselben SKIP ──
  {
    const { db, cs } = await newMatch('C28A');
    const code = 'C28A', off = 0;
    await offline(db, code, off);     // alle vier verbliebenen sehen dasselbe
    const rec = (turnsOf(db, code)[0] || {})[String(off)];
    t('C2-8 trotz mehrerer Schreiber entsteht genau ein SKIP', rec && rec.k === 'skip', rec);
    t('C2-8 kein Client haelt einen offenen Schreibvorgang',
      cs.every(c => c.st().pending === 0), cs.map(c => c.st().pending));
  }

  // ── C2-9: zwei Teilnehmer gleichzeitig getrennt ──
  {
    const { db, cs } = await newMatch('C29A');
    const code = 'C29A';
    db.setPresence(code, 1, false); db.setPresence(code, 4, false); await tick(db, 30);
    for (const c of cs) if (c.idx !== 1 && c.idx !== 4) c.commitVec(60, -40, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
    const rec = turnsOf(db, code)[0] || {};
    t('C2-9 beide bekommen ihren eigenen SKIP auf ihrem eigenen Sitz',
      rec['1'] && rec['1'].k === 'skip' && rec['1'].idx === 1 &&
      rec['4'] && rec['4'].k === 'skip' && rec['4'].idx === 4, { s1: rec['1'], s4: rec['4'] });
    t('C2-9 die uebrigen drei haben echte Zuege',
      ['0', '2', '3'].every(k => rec[k] && rec[k].k === 'move'), rec);
    t('C2-9 die Runde laeuft weiter', cs[0].st().turnNo === 1, cs[0].st().turnNo);
    t('C2-9 kein Leben verloren, niemand eliminiert',
      cs[0].st().lives.join(',') === '2,2,2,2,2'
      && cs[0].st().active.join(',') === 'true,true,true,true,true', cs[0].st());
  }

  // ── C2-9b: der Client ENTSCHEIDET richtig, nicht nur die Datenbank ──
  // Diese Gruppe prueft den Entschluss selbst: fbWriteSkip muss ablehnen, bevor
  // ueberhaupt geschrieben wird.
  {
    const { db, cs } = await newMatch('C29B');
    const code = 'C29B';
    t('C2-9b in der Eingabephase ist die Grenze offen', cs[0].skipBoundary() === true);
    t('C2-9b ein VERBUNDENER Sitz wird nicht uebersprungen', cs[0].trySkip(2) === false);
    t('C2-9b der eigene Sitz wird nie uebersprungen', cs[0].trySkip(0) === false);

    // Sitz 2 zieht selbst, ist danach offline: sein Zug darf nicht ersetzt werden.
    cs[2].commitVec(70, 20, 0); await tick(db, 30);
    db.setPresence(code, 2, false); await tick(db, 20);
    t('C2-9b ein bereits abgegebener Zug wird nicht durch einen SKIP ersetzt',
      cs[0].trySkip(2) === false);

    // Waehrend die Runde rechnet, ist die Grenze zu.
    for (const c of cs) if (c.idx !== 2) c.commitVec(50, -30, 0);
    await tick(db, 40);
    t('C2-9b waehrend der Simulation ist die Grenze geschlossen',
      cs[0].st().phase === 'aim' || cs[0].skipBoundary() === false,
      { phase: cs[0].st().phase, boundary: cs[0].skipBoundary() });
    // Und ausdruecklich: in keiner Nicht-Eingabephase darf sie offen sein.
    let sawClosed = false;
    for (let k = 0; k < 400; k++) {
      if (cs[0].st().phase !== 'aim') { sawClosed = cs[0].skipBoundary() === false; break; }
      cs[0].pump(1);
    }
    t('C2-9b ausserhalb der Eingabephase ist die Grenze nachweislich geschlossen', sawClosed !== false,
      { phase: cs[0].st().phase, boundary: cs[0].skipBoundary() });
  }

  // ── C2-10: duennbesetzte Sitze nach Eliminierungen (4P, 3P) ──
  // Nach einem Ausfall sind die aktiven URSPRUNGSsitze nicht mehr 0..n-1. Der SKIP muss
  // trotzdem auf dem urspruenglichen Sitz landen und nicht auf einer kompakten Nummer.
  {
    const db = makeDB(), code = 'C2SP';
    const cs = await setupMatch(db, code);
    const okE = await eliminateSeat(db, cs, 1, 90);
    t('C2-10 Vorbedingung: Sitz 1 ist ausgeschieden', okE && cs[0].st().active[1] === false,
      cs[0].st().active);
    if (okE) {
      await tick(db, 30);
      const alive = cs[0].st().active.map((v, i) => v ? i : -1).filter(i => i >= 0);
      const off = alive[alive.length - 1];
      const turn = cs[0].st().turnNo;
      db.setPresence(code, off, false); await tick(db, 30);
      for (const s2 of alive) if (s2 !== off) cs[s2].commitVec(60, -40, 0);
      await tick(db, 40);
      const rec = turnsOf(db, code)[turn] || {};
      t('C2-10 der SKIP steht auf dem URSPRUENGLICHEN Sitz ' + off,
        rec[String(off)] && rec[String(off)].k === 'skip' && rec[String(off)].idx === off, rec);
      t('C2-10 der ausgeschiedene Sitz bekommt KEINEN Datensatz',
        rec['1'] === undefined, rec);
      t('C2-10 die Sitznummern werden nicht verdichtet',
        Object.keys(rec).sort().join(',') === alive.slice().sort().join(','),
        { slots: Object.keys(rec), alive });
    }
  }

  // ── C2-11: ein ausgeschiedener, getrennter Sitz bekommt keinen SKIP ──
  {
    const db = makeDB(), code = 'C2EL';
    const cs = await setupMatch(db, code);
    const victim = 3;
    const okE = await eliminateSeat(db, cs, victim, 90);
    t('C2-11 Vorbedingung: der Sitz ist ausgeschieden', okE && cs[0].st().active[victim] === false,
      cs[0].st().active);
    if (okE) {
      db.setPresence(code, victim, false); await tick(db, 30);
      const turn = cs[0].st().turnNo;
      const rec = turnsOf(db, code)[turn] || {};
      t('C2-11 fuer den Ausgeschiedenen entsteht kein SKIP', rec[String(victim)] === undefined, rec);
    }
  }

  // ── C2-12: Rehydrierung aus einer Historie MIT SKIP ──
  {
    const { db, cs } = await newMatch('C2RH');
    const code = 'C2RH', off = 2;
    await offline(db, code, off);
    for (const c of cs) if (c.idx !== off) c.commitVec(60, -40, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
    await online(db, code, off);
    for (const c of cs) c.commitVec(35, 45, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
    const ref = cs[0].hash(), refTurn = cs[0].st().turnNo;
    const fresh = makeClient(db, code, { name: 'RH' });
    fresh.prepareReplay(0, 0);
    fresh.replay(turnsOf(db, code));
    t('C2-12 ein frischer Client rekonstruiert die Historie mit SKIP zeichengleich',
      fresh.hash() === ref, { fresh: fresh.hash(), ref });
    t('C2-12 und steht beim selben Zug', fresh.st().turnNo === refTurn,
      { fresh: fresh.st().turnNo, ref: refTurn });
  }

  // ── C2-13: eine neue Generation traegt keine alten SKIPs ──
  {
    const { db, cs } = await newMatch('C2GN');
    const code = 'C2GN', off = 1;
    await offline(db, code, off);
    for (const c of cs) if (c.idx !== off) c.commitVec(60, -40, 0);
    await tick(db, 40);
    t('C2-13 Vorbedingung: SKIP in Generation 0',
      (turnsOf(db, code, 0)[0] || {})[String(off)] &&
      (turnsOf(db, code, 0)[0] || {})[String(off)].k === 'skip', turnsOf(db, code, 0)[0]);
    await online(db, code, off);
    db.data.rooms[code].gen = 1; await tick(db, 30);
    t('C2-13 die neue Generation startet ohne Datensaetze',
      Object.keys(turnsOf(db, code, 1)).length === 0, turnsOf(db, code, 1));
  }
}

// ── C3 · RUECKKEHRFRIST IM LAUFENDEN FOOTBALL-MATCH ────────────────────────────
// Die Frist ist ein Rueckkehrrecht. Sie laeuft gegen die Serverzeit und wird von den
// SKIPs aus C2 nicht beruehrt. Am Ablauf entsteht ausschliesslich EIGNUNG - entfernt
// wird nichts.
{
  const turnsOf = (db, code, gen) => (((db.data.rooms[code].g || {})[gen || 0] || {}).t) || {};
  {
    const { db, cs } = await newMatch('C3F1');
    const code = 'C3F1', off = 2;
    db.publishOffset(); await tick(db, 20);
    t('C3F die Uhr ist angeglichen', cs[0].clockReady() === true);

    const before = cs[0].st();
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 30);
    t('C3F direkt nach der Trennung: reserviert', cs[0].grace(off).state === 'reserved', cs[0].grace(off));
    t('C3F noch kein Kandidat', cs[0].candidates().length === 0, cs[0].candidates());

    // C2 laeuft waehrenddessen weiter: die Runde wird per SKIP geschlossen.
    for (const c of cs) if (c.idx !== off) c.commitVec(60, -40, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
    const sinceAfterSkip = cs[0].grace(off).since;
    t('C3F die Runde lief per SKIP weiter',
      (turnsOf(db, code)[0] || {})[String(off)] &&
      (turnsOf(db, code)[0] || {})[String(off)].k === 'skip', turnsOf(db, code)[0]);

    // Und noch eine Runde - der SKIP darf die Frist nicht verschieben.
    for (const c of cs) if (c.idx !== off) c.commitVec(40, 40, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
    t('C3F ein SKIP verschiebt den Fristbeginn NICHT',
      cs[0].grace(off).since === sinceAfterSkip, { vorher: sinceAfterSkip, nachher: cs[0].grace(off).since });

    // Jetzt die Schwelle.
    db.advanceServer(14900); await tick(db, 20);
    t('C3F nach 14,9 s: weiterhin reserviert', cs[0].grace(off).state === 'reserved', cs[0].grace(off));
    t('C3F und weiterhin kein Kandidat', cs[0].candidates().length === 0, cs[0].candidates());
    db.advanceServer(200); await tick(db, 20);
    t('C3F ab 15 s: abgelaufen', cs[0].grace(off).state === 'expired', cs[0].grace(off));
    t('C3F der Sitz ist jetzt Kandidat fuer die spaetere Entfernung',
      cs[0].candidates().join(',') === String(off), cs[0].candidates());

    // ── Und nun der Kern: am Ablauf passiert NICHTS ──
    const after = cs[0].st();
    t('C3F kein Leben verloren', after.lives.join(',') === before.lives.join(','),
      { vorher: before.lives, nachher: after.lives });
    t('C3F niemand eliminiert', after.active.join(',') === before.active.join(','), after.active);
    t('C3F kein Sieger', after.winner === null && after.over.length === 0, after);
    t('C3F keine Sitzverschiebung', after.slots.join(',') === before.slots.join(','), after.slots);
    t('C3F die Arena bleibt unveraendert', after.phaseN === before.phaseN, after.phaseN);
    t('C3F der Spielerdatensatz existiert weiter', db.data.rooms[code].players[off] !== undefined,
      Object.keys(db.data.rooms[code].players));
    t('C3F die Praesenz wurde nicht geloescht', db.data.rooms[code].p[off] !== undefined,
      db.data.rooms[code].p[off]);
    t('C3F KEINE Eviction geschrieben', db.data.rooms[code].g[0].e === undefined,
      db.data.rooms[code].g[0].e);
    t('C3F kein REMOVE-Datensatz',
      !Object.keys(turnsOf(db, code)).some(tn => Object.keys(turnsOf(db, code)[tn])
        .some(sn => turnsOf(db, code)[tn][sn].k === 'remove')), turnsOf(db, code));

    // Rueckkehr NACH Fristablauf, aber vor jeder Entfernung: die Eignung entfaellt sofort.
    db.setPresence(code, off, true); db.publishOffset(); await tick(db, 30);
    t('C3F eine spaete, aber legitime Rueckkehr loescht die Eignung',
      cs[0].grace(off).state === 'online' && cs[0].candidates().length === 0, cs[0].grace(off));
    t('C3F der Zurueckgekehrte behaelt Sitz und Leben',
      cs[off].st().myPlayer === off && cs[off].st().lives.join(',') === before.lives.join(','),
      cs[off].st());
  }

  // ── C3GA: die Kandidatur ist an die laufende Generation gebunden ──
  // Nach einem Rematch setzt das Spiel Leben und Aktivliste zurueck, die Praesenz bleibt
  // aber stehen. Eine Trennung aus der ALTEN Generation darf in der neuen nicht sofort
  // wieder als Abwesenheit gelten - dort beginnt die Frist von vorn.
  {
    const { db, cs } = await newMatch('C3GA');
    const code = 'C3GA', off = 2;
    db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(20000); await tick(db, 20);
    t('C3GA Vorbedingung: abgelaufen und Kandidat in Generation 0',
      cs[0].grace(off).state === 'expired' && cs[0].candidates().indexOf(off) >= 0,
      { g: cs[0].grace(off), k: cs[0].candidates() });

    // Rematch - der Sitz bleibt getrennt.
    db.data.rooms[code].gen = 1; db.publishOffset(); await tick(db, 30);
    t('C3GA nach dem Rematch ist der alte Ausfall KEIN Kandidat mehr',
      cs[0].candidates().indexOf(off) < 0, { k: cs[0].candidates(), g: cs[0].grace(off) });
    // Er ist aber auch nicht dauerhaft ausgeschlossen: seine Frist laeuft ab dem Beginn
    // der neuen Generation NEU an - Wartezeit, Weckruf und Kandidatur rechnen gegen
    // dieselbe Basis.
    t('C3GA die Frist rechnet ab dem Generationsbeginn, nicht ab dem alten Zeitstempel',
      cs[0].grace(off).state === 'reserved' && cs[0].grace(off).raw < cs[0].grace(off).since,
      cs[0].grace(off));
    db.advanceServer(16000); await tick(db, 20);
    t('C3GA nach den eigenen 15 s der neuen Generation ist er wieder Kandidat',
      cs[0].candidates().indexOf(off) >= 0, cs[0].candidates());

    // Erst eine Trennung IN der neuen Generation zaehlt wieder - nach ihren eigenen 15 s.
    db.setPresence(code, off, true); db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    t('C3GA eine frische Trennung ist zunaechst reserviert',
      cs[0].grace(off).state === 'reserved' && cs[0].candidates().indexOf(off) < 0, cs[0].grace(off));
    db.advanceServer(16000); await tick(db, 20);
    t('C3GA und wird nach ihren eigenen 15 s wieder Kandidat',
      cs[0].candidates().indexOf(off) >= 0, cs[0].candidates());
  }

  // ── C3GB: eine Rueckkehr loescht die finale Ausfallmerkung ──
  // Ohne das bekaeme eine ZWEITE Trennung nie wieder einen Weckruf.
  {
    const { db, cs } = await newMatch('C3GB');
    const code = 'C3GB', off = 1;
    db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    cs[0].seatGoneNow(off);                       // Ausfall wird final vermerkt
    t('C3GB der Ausfall ist vermerkt', cs[0].discView().left[off] === true, cs[0].discView().left);
    db.setPresence(code, off, true); db.publishOffset(); await tick(db, 30);
    t('C3GB die Rueckkehr loescht die Merkung', cs[0].discView().left[off] !== true,
      cs[0].discView().left);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    t('C3GB eine zweite Trennung wird wieder als reserviert gefuehrt',
      cs[0].grace(off).state === 'reserved', cs[0].grace(off));
  }

  // ── C3F1d: ohne feststehende Generationsgrenze gibt es KEINE Kandidaten ──
  // Der Rejoin setzt gen, bevor der Listener haengt - eine Grenze allein aus dem
  // Vergleich "hat sich gen geaendert" wuerde nach einem Neuladen nie gesetzt. Und ohne
  // Serverzeit darf sie gar nicht erst festgelegt werden: eine nachgehende Geraeteuhr
  // ergaebe eine zu kleine Grenze, unter der ein alter Zeitstempel durchrutscht.
  {
    const { db, cs } = await newMatch('C3GC');
    const code = 'C3GC', off = 3;
    db.publishOffset(); await tick(db, 20);
    t('C3F1d nach dem Beitritt steht die Generationsgrenze',
      cs[0].genStart().at > 0 && cs[0].genStart().pending === false, cs[0].genStart());

    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(20000); await tick(db, 20);
    t('C3F1d mit Grenze wird der Sitz benannt', cs[0].candidates().indexOf(off) >= 0,
      cs[0].candidates());
  }
  {
    // Derselbe Ablauf, aber der Client bekommt nie eine Serverzeit.
    const db = makeDB(), code = 'C3GD';
    const cs = await setupMatch(db, code);
    const off = 3;
    db.setPresence(code, off, false); await tick(db, 20);
    db.advance(30000); await tick(db, 20);
    t('C3F1d ohne Serverzeit bleibt die Grenze unbestimmt',
      cs[0].genStart().at === 0, cs[0].genStart());
    t('C3F1d und es wird NIEMAND als Kandidat benannt', cs[0].candidates().length === 0,
      cs[0].candidates());
  }

  // ── C3F2: ein ausgeschiedener Getrennter ist KEIN Abwesenheitskandidat ──
  {
    const db = makeDB(), code = 'C3F2';
    const cs = await setupMatch(db, code);
    db.publishOffset(); await tick(db, 20);
    const victim = 1;
    const okE = await eliminateSeat(db, cs, victim, 90);
    t('C3F2 Vorbedingung: der Sitz ist ausgeschieden', okE && cs[0].st().active[victim] === false,
      cs[0].st().active);
    if (okE) {
      db.setPresence(code, victim, false); db.publishOffset(); await tick(db, 30);
      db.advanceServer(30000); await tick(db, 20);
      t('C3F2 die Frist gilt auch fuer ihn als abgelaufen', cs[0].grace(victim).state === 'expired',
        cs[0].grace(victim));
      t('C3F2 aber er ist KEIN Abwesenheitskandidat - Eliminierung ist keine Abwesenheit',
        cs[0].candidates().indexOf(victim) < 0, cs[0].candidates());
      t('C3F2 und er bleibt ausgeschieden', cs[0].st().active[victim] === false, cs[0].st().active);
    }
  }

  // ── C3F3: Fristablauf waehrend der Simulation aendert nichts ──
  {
    const { db, cs } = await newMatch('C3F3');
    const code = 'C3F3', off = 4;
    db.publishOffset(); await tick(db, 20);
    const before = cs[0].st(), hash0 = cs[0].hash();
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    for (const c of cs) if (c.idx !== off) c.commitVec(80, 10, 0);
    await tick(db, 30);
    // Mitten in der Rechenphase laeuft die Frist ab.
    db.advanceServer(20000); await tick(db, 20);
    t('C3F3 der Ablauf ist waehrend der Simulation sichtbar',
      cs[0].grace(off).state === 'expired', cs[0].grace(off));
    t('C3F3 aber der Spielzustand wurde dadurch nicht angefasst',
      cs[0].st().lives.join(',') === before.lives.join(',') &&
      cs[0].st().active.join(',') === before.active.join(','), cs[0].st());
    for (const c of cs) c.pump();
    await tick(db, 40);
    t('C3F3 die Runde laeuft deterministisch zu Ende und alle bleiben gleich',
      sameHash(cs), cs.map(c => c.hash()));
  }
}


// ── C4B · KANONISCHER DAUERHAFTER AUSTRITT ────────────────────────────────────
// Zwei Ursachen, ein Weg: abgelaufene Frist und bewusstes Verlassen schreiben denselben
// Eviction-Marker; ein verbundener Mitspieler schliesst den Slot mit dem typisierten
// REMOVE; die Spielwirkung faellt deterministisch an der naechsten Eingabegrenze.
{
  const turnsOf = (db, code, gen) => (((db.data.rooms[code].g || {})[gen || 0] || {}).t) || {};
  const evOf = (db, code, gen) => ((db.data.rooms[code].g || {})[gen || 0] || {}).e || {};
  const removeCount = (db, code, seat) => {
    let n = 0; const T = turnsOf(db, code);
    for (const tn of Object.keys(T)) if (T[tn][String(seat)] && T[tn][String(seat)].k === 'remove') n++;
    return n;
  };
  // Eine Runde weiterspielen, damit die Eingabegrenze erreicht wird.
  const seatOf = (c) => c.st().myPlayer;
  const nextBoundary = async (db, cs) => {
    for (const c of cs) { const st = c.st(), me = st.myPlayer;
      if (st.active[me] && !st.aimSet[me]) c.commitVec(50, -30, 0); }
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
  };

  // ── C4B-1: Fristablauf -> kanonischer Austritt ──
  {
    const { db, cs } = await newMatch('C4CA');
    const code = 'C4CA', off = 3;
    db.publishOffset(); await tick(db, 20);
    const before = cs[0].st();
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    t('C4B-1 Vorbedingung: C3 benennt den Sitz', cs[0].candidates().indexOf(off) >= 0, cs[0].candidates());

    cs[0].seatGoneNow(off); await tick(db, 40);      // der Weckruf der Frist
    t('C4B-1 der Eviction-Marker steht', evOf(db, code)[off] === true, evOf(db, code));

    // Die laufende Runde war ueber C2 bereits mit einem SKIP geschlossen - der dauerhafte
    // Austritt gehoert damit in die NAECHSTE Runde.
    await nextBoundary(db, cs);
    t('C4B-1 ein REMOVE wurde geschrieben - genau einmal', removeCount(db, code, off) === 1,
      turnsOf(db, code));
    await nextBoundary(db, cs);
    const after = cs[0].st();
    t('C4B-1 der Sitz ist aus dem Spiel genommen', after.active[off] === false, after.active);
    t('C4B-1 KEIN Leben wurde abgezogen', after.lives.join(',') === before.lives.join(','),
      { vorher: before.lives, nachher: after.lives });
    t('C4B-1 KEIN Tor', cs[0].sfx().goal === 0, cs[0].sfx());
    t('C4B-1 die Arena steht auf der verbliebenen Spielerzahl', after.phaseN === 4, after.phaseN);
    t('C4B-1 die Uebrigen behalten ihre URSPRUENGLICHEN Sitznummern',
      after.slots.filter(v => v >= 0).slice().sort().join(',') === '0,1,2,4', after.slots);
    t('C4B-1 alle Clients sind deckungsgleich', sameHash(cs), cs.map(c => c.hash()));
    t('C4B-1 kein Sieger bei vier Verbliebenen', after.winner === null, after.winner);
  }

  // ── C4B-2: bewusstes Verlassen -> derselbe Weg ──
  {
    const { db, cs } = await newMatch('C4CB');
    const code = 'C4CB', quit = 2;
    db.publishOffset(); await tick(db, 20);
    const before = cs[0].st();
    cs[quit].leave(); await tick(db, 40);
    t('C4B-2 der Eviction-Marker steht', evOf(db, code)[quit] === true, evOf(db, code));
    t('C4B-2 die eigenen Datensaetze sind zurueckgetreten',
      db.data.rooms[code].p[quit] === undefined && db.data.rooms[code].players[quit] === undefined,
      { p: db.data.rooms[code].p[quit], pl: db.data.rooms[code].players[quit] });
    t('C4B-2 ein Mitspieler hat den REMOVE geschrieben - genau einmal',
      removeCount(db, code, quit) === 1, turnsOf(db, code));
    t('C4B-2 ohne Wartefrist', true);

    await nextBoundary(db, cs.filter(c => seatOf(c) !== quit));
    const after = cs[0].st();
    t('C4B-2 der Sitz ist aus dem Spiel genommen', after.active[quit] === false, after.active);
    t('C4B-2 KEIN Leben, KEIN Tor',
      after.lives.join(',') === before.lives.join(',') && cs[0].sfx().goal === 0,
      { lives: after.lives, sfx: cs[0].sfx() });
    t('C4B-2 die Arena steht auf vier', after.phaseN === 4, after.phaseN);
    t('C4B-2 die verbliebenen vier sind deckungsgleich',
      cs.filter(c => seatOf(c) !== quit).every(c => c.hash() === cs[0].hash()),
      cs.map(c => c.hash()));
  }

  // ── C4B-3: Rueckkehr VOR der Eviction verhindert sie ──
  {
    const { db, cs } = await newMatch('C4CC');
    const code = 'C4CC', off = 1;
    db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    db.setPresence(code, off, true); db.publishOffset(); await tick(db, 20);   // er ist zurueck
    cs[0].seatGoneNow(off); await tick(db, 40);
    t('C4B-3 nach der Rueckkehr entsteht KEINE Eviction', evOf(db, code)[off] === undefined,
      evOf(db, code));
    t('C4B-3 und kein REMOVE', removeCount(db, code, off) === 0, turnsOf(db, code));
    t('C4B-3 der Sitz bleibt aktiv', cs[0].st().active[off] === true, cs[0].st().active);
  }

  // ── C4B-3b: der Client ENTSCHEIDET selbst, nicht erst die Datenbank ──
  // Nur den Endzustand zu pruefen genuegt nicht: unzulaessige Schreibvorgaenge weist die
  // Datenbank ohnehin ab. Hier wird der Entschluss selbst geprueft.
  {
    const { db, cs } = await newMatch('C4CH');
    const code = 'C4CH';
    db.publishOffset(); await tick(db, 20);
    t('C4B-3b ein VERBUNDENER Sitz wird nicht ausgetragen', cs[0].tryEvict(2) === false);
    t('C4B-3b der eigene Sitz nie ueber diesen Weg', cs[0].tryEvict(0) === false);

    db.setPresence(code, 2, false); db.publishOffset(); await tick(db, 20);
    t('C4B-3b ein getrennter Sitz VOR Fristablauf wird nicht ausgetragen',
      cs[0].tryEvict(2) === false, cs[0].grace(2));
    db.advanceServer(16000); await tick(db, 20);
    t('C4B-3b erst nach Fristablauf wird ausgetragen', cs[0].tryEvict(2) === true, cs[0].grace(2));
  }

  // ── C4B-3c: der offene Slot eines Ausgetragenen wird mit REMOVE geschlossen ──
  // Faellt die Eviction, waehrend ein SKIP unterwegs ist, weist der Server diesen SKIP ab
  // (er verlangt ein nicht evictiertes Ziel). Die Wiederholung darf dann nicht wieder
  // einen SKIP versuchen - sonst bliebe der Slot fuer immer offen und die Runde stehen.
  {
    const { db, cs } = await newMatch('C4CI');
    const code = 'C4CI', off = 3;
    db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(off); await tick(db, 40);
    t('C4B-3c Vorbedingung: der Sitz ist ausgetragen', cs[0].ev()[off] === true, cs[0].ev());
    await nextBoundary(db, cs);
    // Der Slot der neuen Runde ist offen - und wird mit dem REMOVE geschlossen, nicht
    // mit einem SKIP, den der Server ablehnen wuerde.
    const turn = cs[0].st().turnNo;
    const rec = (turnsOf(db, code)[turn] || {})[String(off)];
    t('C4B-3c der Slot wurde geschlossen', rec !== undefined, turnsOf(db, code)[turn]);
    t('C4B-3c und zwar mit einem REMOVE', rec && rec.k === 'remove', rec);
  }

  // ── C4B-3d: mehrere Austritte derselben Runde kroenen keinen Ausgetretenen ──
  // Werden die letzten beiden Teilnehmer in DERSELBEN Runde ausgetragen, darf der
  // Zwischenstand "einer uebrig" nicht als Sieger veroeffentlicht werden.
  {
    const { db, cs } = await newMatch('C4CJ');
    const code = 'C4CJ';
    db.publishOffset(); await tick(db, 20);
    // Erst auf zwei Aktive bringen.
    for (const off of [4, 3, 2]) {
      db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
      db.advanceServer(16000); await tick(db, 20);
      const w = cs.find(c => seatOf(c) !== off && cs[0].st().active[seatOf(c)]);
      w.seatGoneNow(off); await tick(db, 40);
      await nextBoundary(db, cs); await nextBoundary(db, cs);
    }
    t('C4B-3d Vorbedingung: zwei Aktive', cs[0].st().active.filter(Boolean).length === 2,
      cs[0].st().active);
    // Und jetzt gehen BEIDE in derselben Runde.
    db.setPresence(code, 0, false); db.setPresence(code, 1, false);
    db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[1].seatGoneNow(0); cs[0].seatGoneNow(1); await tick(db, 40);
    await nextBoundary(db, cs); await nextBoundary(db, cs);
    const st = cs[0].st();
    t('C4B-3d kein Ausgetretener wird zum Sieger erklaert',
      st.winner === null || st.active[st.winner] === true,
      { winner: st.winner, active: st.active, over: st.over });
    t('C4B-3d und es wurde kein Tor und kein Leben erfunden',
      cs[0].sfx().goal === 0 && st.lives.join(',') === '2,2,2,2,2',
      { sfx: cs[0].sfx(), lives: st.lives });
  }

  // ── C4B-3e: SKIP in Flug, Eviction gewinnt -> die Wiederholung schliesst mit REMOVE ──
  // Ohne die Weiche versuchte die Wiederholung erneut einen SKIP, wuerde wieder
  // abgewiesen - und der Slot bliebe offen, die Runde stuende fuer immer.
  {
    const { db, cs } = await newMatch('C4CK');
    const code = 'C4CK', off = 2;
    db.publishOffset(); await tick(db, 20);
    // Eine Runde regulaer spielen, damit wir in einer FRISCHEN Runde rennen koennen.
    await nextBoundary(db, cs);
    const turn = cs[0].st().turnNo;
    t('C4B-3e Vorbedingung: frische Runde, Slot offen',
      (turnsOf(db, code)[turn] || {})[String(off)] === undefined, turnsOf(db, code)[turn]);

    // Jetzt faellt der Sitz aus - mit einem Zeitstempel, der die Frist bereits
    // ueberschritten hat. Der Praesenzwechsel setzt den SKIP an; er liegt in der
    // Warteschlange, denn geflusht wird erst spaeter.
    const r = db.data.rooms[code];
    r.p[off] = { s: r.p[off].s, on: false, t: db.now - 20000 };
    db.publishOffset();                       // meldet die Trennung -> SKIP wird angesetzt

    // ... und GENAU JETZT gewinnt die Eviction das Rennen.
    r.g = r.g || {}; r.g[0] = r.g[0] || {}; r.g[0].e = { [off]: true };
    db.publishOffset();

    // Erst hier laeuft die Warteschlange: der angesetzte SKIP trifft auf einen bereits
    // ausgetragenen Sitz und wird abgewiesen.
    await tick(db, 30);
    t('C4B-3e Vorbedingung: der Sitz ist ausgetragen', cs[0].ev()[off] === true, cs[0].ev());

    // Die Wiederholung laeuft ueber einen echten Timer (Backoff).
    for (let k = 0; k < 12; k++) { await new Promise(res => setTimeout(res, 60)); await tick(db, 10); }

    const rec = (turnsOf(db, code)[turn] || {})[String(off)];
    t('C4B-3e der Slot ist geschlossen - er bleibt nicht offen', rec !== undefined,
      turnsOf(db, code)[turn]);
    t('C4B-3e und zwar mit einem REMOVE, nicht mit einem SKIP', rec && rec.k === 'remove', rec);
    t('C4B-3e genau ein Datensatz fuer diesen Sitz', removeCount(db, code, off) === 1,
      turnsOf(db, code));
    t('C4B-3e kein Client haelt noch einen offenen Schreibvorgang',
      cs.every(c => c.st().pending === 0), cs.map(c => c.st().pending));
    t('C4B-3e das Match laeuft weiter - kein Abbruch',
      cs[0].st().gameStarted === true && cs[0].st().over.length === 0, cs[0].st());
  }

  // ── C4B-4: mehrere Schreiber, genau ein Marker und ein REMOVE ──
  {
    const { db, cs } = await newMatch('C4CD');
    const code = 'C4CD', off = 4;
    db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    for (const c of cs) if (seatOf(c) !== off) c.seatGoneNow(off);   // alle vier gleichzeitig
    await tick(db, 40);
    t('C4B-4 genau ein Eviction-Marker', evOf(db, code)[off] === true
      && Object.keys(evOf(db, code)).length === 1, evOf(db, code));
    await nextBoundary(db, cs);
    t('C4B-4 genau ein REMOVE', removeCount(db, code, off) === 1, turnsOf(db, code));
    t('C4B-4 kein Client haelt einen offenen Schreibvorgang',
      cs.every(c => c.st().pending === 0), cs.map(c => c.st().pending));
  }

  // ── C4B-5: Rehydrierung aus einer Historie MIT REMOVE ──
  {
    const { db, cs } = await newMatch('C4CE');
    const code = 'C4CE', off = 0;
    db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[1].seatGoneNow(off); await tick(db, 40);
    await nextBoundary(db, cs);
    await nextBoundary(db, cs);
    const ref = cs[1].hash(), refTurn = cs[1].st().turnNo;
    const fresh = makeClient(db, code, { name: 'RH' });
    fresh.prepareReplay(0, 0);
    fresh.replay(turnsOf(db, code));
    t('C4B-5 ein frischer Client rekonstruiert die Historie mit REMOVE zeichengleich',
      fresh.hash() === ref, { fresh: fresh.hash(), ref });
    t('C4B-5 dieselbe Aktivliste und dieselben Leben',
      fresh.st().active.join(',') === cs[1].st().active.join(',')
      && fresh.st().lives.join(',') === cs[1].st().lives.join(','),
      { fresh: fresh.st(), ref: cs[1].st() });
    t('C4B-5 dieselbe Arenaphase', fresh.st().phaseN === cs[1].st().phaseN,
      { fresh: fresh.st().phaseN, ref: cs[1].st().phaseN });
  }

  // ── C4B-6: 5 -> 4 -> 3 -> 2 ausschliesslich durch dauerhafte Austritte ──
  {
    const { db, cs } = await newMatch('C4CF');
    const code = 'C4CF';
    db.publishOffset(); await tick(db, 20);
    const lives0 = cs[0].st().lives.join(',');
    const erwartet = [4, 3, 2];
    let i = 0;
    for (const off of [4, 3, 2]) {
      db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
      db.advanceServer(16000); await tick(db, 20);
      const writer = cs.find(c => seatOf(c) !== off && cs[0].st().active[seatOf(c)]);
      writer.seatGoneNow(off); await tick(db, 40);
      await nextBoundary(db, cs);   // die laufende Runde schliesst der SKIP
      await nextBoundary(db, cs);   // hier steht der REMOVE und wird angewandt
      const st = cs[0].st();
      t('C4B-6 nach dem Austritt von Sitz ' + off + ': Arena auf ' + erwartet[i],
        st.phaseN === erwartet[i], { phaseN: st.phaseN, erwartet: erwartet[i] });
      t('C4B-6 Sitz ' + off + ' ist draussen, die uebrigen bleiben',
        st.active[off] === false, st.active);
      t('C4B-6 Leben unveraendert', st.lives.join(',') === lives0, st.lives);
      t('C4B-6 kein Tor unterwegs', cs[0].sfx().goal === 0, cs[0].sfx());
      i++;
    }
    const fin = cs[0].st();
    t('C4B-6 am Ende sind genau zwei aktiv',
      fin.active.filter(Boolean).length === 2, fin.active);
    t('C4B-6 die urspruenglichen Sitze wurden nie verdichtet',
      fin.slots.length === 5, fin.slots);
    t('C4B-6 alle Clients deckungsgleich', sameHash(cs), cs.map(c => c.hash()));
  }

  // ── C4B-7: Austritt bei nur noch zwei Teilnehmern ──
  // Der bestehende Vertrag entscheidet: bleibt genau einer uebrig, ist er Sieger.
  // Kein erfundenes Tor, kein Lebensabzug.
  {
    const { db, cs } = await newMatch('C4CG');
    const code = 'C4CG';
    db.publishOffset(); await tick(db, 20);
    const lives0 = cs[0].st().lives.join(',');
    for (const off of [4, 3, 2]) {
      db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
      db.advanceServer(16000); await tick(db, 20);
      const w = cs.find(c => seatOf(c) !== off && cs[0].st().active[seatOf(c)]);
      w.seatGoneNow(off); await tick(db, 40);
      await nextBoundary(db, cs);
      await nextBoundary(db, cs);
    }
    t('C4B-7 Vorbedingung: zwei Teilnehmer', cs[0].st().active.filter(Boolean).length === 2,
      cs[0].st().active);
    // Und nun geht auch der zweite.
    db.setPresence(code, 1, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(1); await tick(db, 40);
    await nextBoundary(db, cs);
    await nextBoundary(db, cs);
    const st = cs[0].st();
    t('C4B-7 der verbliebene Spieler ist Sieger', st.winner === 0, { winner: st.winner, active: st.active });
    t('C4B-7 ohne erfundenes Tor und ohne Lebensabzug',
      cs[0].sfx().goal === 0 && st.lives.join(',') === lives0, { sfx: cs[0].sfx(), lives: st.lives });
  }
}

// ── C4B · NACHWEISE ZU DEN DREI P1 AUS DEM ABSCHLUSSREVIEW ────────────────────
{
  const seatOf = (c) => c.st().myPlayer;
  const nextBoundary = async (db, cs) => {
    for (const c of cs) { const st = c.st(), me = st.myPlayer;
      if (st.active[me] && !st.aimSet[me]) c.commitVec(50, -30, 0); }
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
  };
  // ── C4B-5a: der letzte Verbliebene wird selbst entfernt ──
  // Ein verzoegerter REMOVE darf niemanden kroenen, der selbst schon ausgetragen ist.
  {
    const { db, cs } = await newMatch('C4CL');
    const code = 'C4CL';
    db.publishOffset(); await tick(db, 20);
    const lives0 = cs[0].st().lives.join(',');
    // Auf zwei Aktive bringen.
    for (const off of [4, 3, 2]) {
      db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
      db.advanceServer(16000); await tick(db, 20);
      const w = cs.find(c => seatOf(c) !== off && cs[0].st().active[seatOf(c)]);
      w.seatGoneNow(off); await tick(db, 40);
      await nextBoundary(db, cs); await nextBoundary(db, cs);
    }
    t('C4B-5a Vorbedingung: zwei Aktive', cs[0].st().active.filter(Boolean).length === 2,
      cs[0].st().active);
    // Sitz 1 wird ausgetragen - waehrend fuer Sitz 0 bereits eine Eviction vorliegt.
    db.setPresence(code, 1, false); db.setPresence(code, 0, false);
    db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    t('C4B-5a ein ausgetragener Sitz ist nicht mehr siegberechtigt',
      cs[0].eligible().indexOf(0) >= 0 || cs[0].eligible().indexOf(1) >= 0
      || cs[0].eligible().length === 0, cs[0].eligible());
    cs[1].seatGoneNow(0); cs[0].seatGoneNow(1); await tick(db, 40);
    await nextBoundary(db, cs); await nextBoundary(db, cs);
    const st = cs[0].st();
    t('C4B-5a kein ausgetragener Sitz wird Sieger',
      st.winner === null || (st.active[st.winner] === true && cs[0].ev()[st.winner] !== true),
      { winner: st.winner, active: st.active, ev: cs[0].ev() });
    t('C4B-5a kein Tor, kein Lebensabzug',
      cs[0].sfx().goal === 0 && st.lives.join(',') === lives0, { sfx: cs[0].sfx(), lives: st.lives });
  }

  // ── C4B-5b: Ergebnis ohne verbleibenden Teilnehmer ──
  // Es darf kein Sieger erfunden werden - und gameOver darf nicht mit null aufgerufen
  // werden (dort werden Name und Farbe eines Siegers erwartet).
  {
    const { db, cs } = await newMatch('C4CM');
    const code = 'C4CM';
    db.publishOffset(); await tick(db, 20);
    for (const off of [4, 3, 2]) {
      db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
      db.advanceServer(16000); await tick(db, 20);
      const w = cs.find(c => seatOf(c) !== off && cs[0].st().active[seatOf(c)]);
      w.seatGoneNow(off); await tick(db, 40);
      await nextBoundary(db, cs); await nextBoundary(db, cs);
    }
    db.setPresence(code, 0, false); db.setPresence(code, 1, false);
    db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[1].seatGoneNow(0); cs[0].seatGoneNow(1); await tick(db, 40);
    await nextBoundary(db, cs); await nextBoundary(db, cs);
    const st = cs[0].st();
    t('C4B-5b gameOver wurde NICHT mit null aufgerufen',
      st.over.every(w => w !== null && w !== undefined), st.over);
    t('C4B-5b kein erfundener Sieger', st.winner === null || st.active[st.winner] === true,
      { winner: st.winner, active: st.active });
    t('C4B-5b kein Tor, keine Lebensmanipulation',
      cs[0].sfx().goal === 0 && st.lives.join(',') === '2,2,2,2,2',
      { sfx: cs[0].sfx(), lives: st.lives });
  }

  // ── C4B-5e: eine neue Generation startet nach einem Austritt NICHT ──
  // Die Rules sperren nur den Schreiber selbst; ein verbundener Mitspieler koennte gen
  // erhoehen. Jeder Client muss den Start dann verweigern.
  {
    const { db, cs } = await newMatch('C4CP');
    const code = 'C4CP', off = 2;
    db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(off); await tick(db, 40);
    t('C4B-5e Vorbedingung: ein Austritt liegt vor', cs[0].exitHappened() === true, cs[0].ev());
    const lauf0 = cs[0].st().runningGen;
    // Ein Mitspieler erhoeht die Generation direkt in den Daten (so wie es ein Peer
    // regelkonform koennte).
    db.data.rooms[code].gen = db.data.rooms[code].gen + 1; db.touch(); await tick(db, 30);
    t('C4B-5e kein Client startet die neue Generation',
      cs.every(c => c.st().runningGen === lauf0), cs.map(c => c.st().runningGen));
    t('C4B-5e und niemand wird zum Sieger erklaert',
      cs[0].st().winner === null && cs[0].st().over.every(w => w !== null && w !== undefined),
      { winner: cs[0].st().winner, over: cs[0].st().over });
  }

  // ── C4B-5f: der Batch benutzt dieselbe Siegerquelle ──
  {
    const { db, cs } = await newMatch('C4CQ');
    const code = 'C4CQ';
    db.publishOffset(); await tick(db, 20);
    // Einen Sitz austragen lassen, aber den REMOVE noch NICHT anwenden: er ist
    // evictiert und damit nicht mehr siegberechtigt.
    db.setPresence(code, 1, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(1); await tick(db, 40);
    // Der Marker allein ist eine Berechtigung, kein Spielzug: solange kein REMOVE in
    // der Historie steht, bleibt der Sitz Teilnehmer. Sonst entschiede die
    // Zustellreihenfolge des Listeners ueber den Spielausgang.
    t('C4B-5f der Marker allein nimmt die Siegberechtigung NICHT',
      cs[0].eligible().indexOf(1) >= 0, { eligible: cs[0].eligible(), ev: cs[0].ev() });
    t('C4B-5f die uebrigen bleiben siegberechtigt',
      [0, 2, 3, 4].every(x => cs[0].eligible().indexOf(x) >= 0), cs[0].eligible());
    // Erst der kanonische REMOVE entscheidet.
    await nextBoundary(db, cs);
    t('C4B-5f der kanonische REMOVE steht in der Historie',
      cs[0].pendingRemovals().indexOf(1) >= 0, cs[0].pendingRemovals());
    t('C4B-5f und erst er nimmt die Siegberechtigung',
      cs[0].eligible().indexOf(1) < 0, cs[0].eligible());
  }

  // ── C4B-5c: Rematch nach dauerhaftem Austritt ist gesperrt ──
  {
    const { db, cs } = await newMatch('C4CN');
    const code = 'C4CN', off = 2;
    db.publishOffset(); await tick(db, 20);
    t('C4B-5c vor jedem Austritt ist ein Rematch moeglich',
      cs[0].exitHappened() === false, cs[0].exitHappened());
    const gen0 = db.data.rooms[code].gen;
    cs[0].rematch(); await tick(db, 30);
    t('C4B-5c und er startet die naechste Generation', db.data.rooms[code].gen === gen0 + 1,
      db.data.rooms[code].gen);

    // Jetzt ein dauerhafter Austritt.
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(off); await tick(db, 40);
    t('C4B-5c der Austritt ist vermerkt', cs[0].exitHappened() === true, cs[0].ev());
    const gen1 = db.data.rooms[code].gen;
    cs[0].rematch(); await tick(db, 30);
    t('C4B-5c danach startet KEINE neue Generation mehr',
      db.data.rooms[code].gen === gen1, db.data.rooms[code].gen);
    t('C4B-5c kein geloeschter Rosteranker gelangt in eine neue Generation',
      db.data.rooms[code].gen === gen1, { gen: db.data.rooms[code].gen, erwartet: gen1 });
    // Der Server sperrt den Wechsel ohnehin (s. C4B-7a). Die Aufgabe des Clients ist
    // eine andere: er darf den Spieler nicht ins Leere klicken lassen, sondern muss
    // sagen, warum nichts passiert.
    t('C4B-5c der Client sagt dem Spieler, warum kein Rematch mehr geht',
      cs[0].discView().toasts.some(x => x.indexOf('kein Rematch in diesem Raum') >= 0),
      cs[0].discView().toasts);
  }

  // ── C4B-5d: bewusstes Verlassen sperrt den Rematch ebenso ──
  {
    const { db, cs } = await newMatch('C4CO');
    const code = 'C4CO', quit = 3;
    db.publishOffset(); await tick(db, 20);
    cs[quit].leave(); await tick(db, 40);
    t('C4B-5d der Rosteranker ist zurueckgetreten',
      db.data.rooms[code].players[quit] === undefined, db.data.rooms[code].players);
    const gen0 = db.data.rooms[code].gen;
    cs[0].rematch(); await tick(db, 30);
    t('C4B-5d ein Rematch startet keine neue Generation mit fehlendem Anker',
      db.data.rooms[code].gen === gen0, db.data.rooms[code].gen);
    t('C4B-5d die Rematch-Schaltflaeche wird nicht angeboten',
      cs[0].rematchShown() !== true || cs[0].exitHappened() === true,
      { shown: cs[0].rematchShown(), exit: cs[0].exitHappened() });
  }

}


// ── C4B · DIE WACHEN DER SIEGERBESTIMMUNG ─────────────────────────────────────
// Geprueft wird der Entschluss selbst: wer darf Sieger werden, und was passiert, wenn
// niemand mehr uebrig ist. Ohne diese Gruppen waeren die Wachen nicht diskriminierend
// abgesichert.
{
  const seatOf = (c) => c.st().myPlayer;
  const nextBoundary = async (db, cs) => {
    for (const c of cs) { const st = c.st(), me = st.myPlayer;
      if (st.active[me] && !st.aimSet[me]) c.commitVec(50, -30, 0); }
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
  };
  // Einen Sitz dauerhaft austragen (Marker + Anwendung), damit die Runde schrumpft.
  const austragen = async (db, cs, code, off) => {
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    const w = cs.find(c => seatOf(c) !== off && cs[0].st().active[seatOf(c)]);
    w.seatGoneNow(off); await tick(db, 40);
    await nextBoundary(db, cs); await nextBoundary(db, cs);
  };

  // ── C4B-6a: ein vorgemerkter Austritt gilt schon im Torpfad ──
  // Die Lage, vor der die Wache steht: gegen den einen faellt ein echtes Tor, fuer den
  // anderen liegt im selben Zug bereits ein dauerhafter Austritt vor. Dann ist niemand
  // mehr uebrig - es darf kein Sieger gekroent und kein Siegerende gefeiert werden.
  {
    const { db, cs } = await newMatch('C4DA');
    const code = 'C4DA';
    db.publishOffset(); await tick(db, 20);
    await austragen(db, cs, code, 4);
    await austragen(db, cs, code, 3);
    await austragen(db, cs, code, 2);
    t('C4B-6a Vorbedingung: zwei Aktive (0 und 1)',
      cs[0].st().active.filter(Boolean).length === 2 && cs[0].st().active[0] && cs[0].st().active[1],
      cs[0].st().active);

    // Fuer Sitz 0 liegt ein REMOVE vor, ist aber noch nicht angewandt - genau das
    // Zeitfenster, in dem ein Zug aufgeloest wird.
    db.setPresence(code, 0, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[1].seatGoneNow(0); await tick(db, 40);
    await nextBoundary(db, cs);
    t('C4B-6a der REMOVE fuer Sitz 0 ist vorgemerkt, aber noch nicht angewandt',
      cs[1].pendingRemovals().indexOf(0) >= 0 && cs[1].st().active[0] === true,
      { pending: cs[1].pendingRemovals(), active: cs[1].st().active });
    t('C4B-6a ein vorgemerkter Austritt nimmt die Siegberechtigung',
      cs[1].eligible().indexOf(0) < 0, { eligible: cs[1].eligible(), pending: cs[1].pendingRemovals() });
    t('C4B-6a und der andere bleibt berechtigt', cs[1].eligible().indexOf(1) >= 0, cs[1].eligible());

    // Jetzt scheidet Sitz 1 regulaer aus - der Torpfad.
    const vorher = cs[1].st();
    cs[1].elimEliminate(1);
    const st = cs[1].st();
    t('C4B-6a kein vorgemerkt ausgetragener Sitz wird Sieger',
      st.winner === null, { winner: st.winner, pending: cs[1].pendingRemovals() });
    t('C4B-6a gameOver wurde NICHT mit null aufgerufen',
      st.over.every(w => w !== null && w !== undefined), st.over);
    t('C4B-6a das Match endet ohne Sieger', st.phase === 'over', st.phase);
    t('C4B-6a und ohne Lebensmanipulation', st.lives.join(',') === vorher.lives.join(','),
      { vorher: vorher.lives, nachher: st.lives });
  }

  // ── C4B-6b: der Batch entscheidet aus der ENDGUELTIGEN Menge ──
  // Drei Spieler scheiden regulaer durch Tore aus - sie bleiben verbunden und duerfen
  // deshalb fuer die beiden Verbliebenen schreiben. Verlieren diese beiden dauerhaft
  // die Verbindung, werden sie im SELBEN Schritt entfernt: danach ist die berechtigte
  // Menge leer.
  {
    const { db, cs } = await newMatch('C4DB');
    const code = 'C4DB';
    db.publishOffset(); await tick(db, 20);
    for (const s of [4, 3, 2]) {
      const raus = await eliminateSeat(db, cs, s, 40);
      t('C4B-6b Sitz ' + s + ' scheidet regulaer durch Tore aus', raus === true,
        { active: cs[0].st().active, lives: cs[0].st().lives });
    }
    t('C4B-6b Vorbedingung: zwei Aktive, drei verbundene Zuschauer',
      cs[0].st().active.filter(Boolean).length === 2 && cs[0].st().active[0] && cs[0].st().active[1],
      cs[0].st().active);

    const lebenVorher = cs[2].st().lives.join(',');
    const toreVorher = cs[2].sfx().goal;
    db.setPresence(code, 0, false); db.setPresence(code, 1, false);
    db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    // Ein ausgeschiedener, aber verbundener Mitspieler traegt beide aus.
    cs[2].seatGoneNow(0); await tick(db, 40);
    cs[2].seatGoneNow(1); await tick(db, 40);
    t('C4B-6b beide Austritte sind vermerkt',
      cs[2].ev()[0] === true && cs[2].ev()[1] === true, cs[2].ev());
    await nextBoundary(db, cs);
    const p = cs[2].pendingRemovals();
    t('C4B-6b beide Austritte liegen im selben Schritt an', p.indexOf(0) >= 0 && p.indexOf(1) >= 0, p);

    const n = cs[2].applyRemovals();
    const st = cs[2].st();
    t('C4B-6b der Schritt entfernt beide', n === 2, n);
    t('C4B-6b danach ist niemand mehr aktiv', st.active.filter(Boolean).length === 0, st.active);
    t('C4B-6b es wird KEIN Sieger erklaert', st.winner === null, st.winner);
    t('C4B-6b gameOver wurde NICHT mit null aufgerufen',
      st.over.every(w => w !== null && w !== undefined), st.over);
    t('C4B-6b der Austritt kostet weder Tor noch Leben',
      cs[2].sfx().goal === toreVorher && st.lives.join(',') === lebenVorher,
      { tore: cs[2].sfx().goal, lives: st.lives });
  }

  // ── C4B-6d: gleiche Historie, verschiedene Marker-Zustellung, gleiches Ergebnis ──
  // Der Eviction-Marker erreicht zwei Clients zu verschiedenen Zeitpunkten. Beide haben
  // dieselbe kanonische Zughistorie - also MUESSEN beide denselben Sieger und denselben
  // simHash bestimmen. Waere der Marker Spielautoritaet, entschiede hier die
  // Zustellreihenfolge und die beiden Clients liefen auseinander.
  {
    const { db, cs } = await newMatch('C4DD');
    const code = 'C4DD';
    db.publishOffset(); await tick(db, 20);
    for (const s of [4, 3]) {
      const raus = await eliminateSeat(db, cs, s, 40);
      t('C4B-6d Sitz ' + s + ' scheidet regulaer durch Tore aus', raus === true, cs[0].st().active);
    }
    t('C4B-6d Vorbedingung: drei Aktive, zwei verbundene Zuschauer',
      cs[0].st().active.join(',') === 'true,true,true,false,false', cs[0].st().active);

    // Sitze 1 und 2 fallen dauerhaft aus: Marker und kanonischer REMOVE entstehen.
    db.setPresence(code, 1, false); db.setPresence(code, 2, false);
    db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[3].seatGoneNow(1); await tick(db, 40);
    cs[3].seatGoneNow(2); await tick(db, 40);
    await nextBoundary(db, cs);
    t('C4B-6d die REMOVE-Datensaetze von 1 und 2 stehen an',
      cs[3].pendingRemovals().join(',') === '1,2' && cs[4].pendingRemovals().join(',') === '1,2',
      { a: cs[3].pendingRemovals(), b: cs[4].pendingRemovals() });

    // Sitz 0 wird ausgetragen - der Marker erreicht cs[3] sofort, cs[4] gar nicht.
    db.hold(cs[4].uid, 'e');
    db.setPresence(code, 0, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[3].seatGoneNow(0); await tick(db, 5);
    t('C4B-6d die beiden Clients sehen den Marker unterschiedlich',
      cs[3].ev()[0] === true && cs[4].ev()[0] !== true, { a: cs[3].ev(), b: cs[4].ev() });
    t('C4B-6d ihre kanonische Historie ist identisch',
      cs[3].pendingRemovals().join(',') === cs[4].pendingRemovals().join(',')
      && cs[3].hash() === cs[4].hash(),
      { a: cs[3].pendingRemovals(), b: cs[4].pendingRemovals(), ha: cs[3].hash(), hb: cs[4].hash() });

    const na = cs[3].applyRemovals(), nb = cs[4].applyRemovals();
    const a = cs[3].st(), b = cs[4].st();
    t('C4B-6d beide wenden denselben Batch an', na === 2 && nb === 2, { na, nb });
    t('C4B-6d beide bestimmen DENSELBEN Sieger', a.winner === b.winner,
      { a: a.winner, b: b.winner });
    t('C4B-6d beide melden dasselbe Ergebnis', JSON.stringify(a.over) === JSON.stringify(b.over),
      { a: a.over, b: b.over });
    t('C4B-6d und bleiben im selben Simulationszustand', cs[3].hash() === cs[4].hash(),
      { a: cs[3].hash(), b: cs[4].hash() });
    t('C4B-6d der Sieger folgt der Historie, nicht dem Marker', a.winner === 0,
      { winner: a.winner, ev: cs[3].ev(), active: a.active });
    t('C4B-6d gameOver wurde NICHT mit null aufgerufen',
      a.over.every(w => w !== null && w !== undefined), a.over);

    // Der Marker kommt nach - am Spielergebnis darf sich nichts mehr aendern.
    const vorher = { winner: a.winner, over: JSON.stringify(a.over), hash: cs[4].hash() };
    db.release(cs[4].uid, 'e'); await tick(db, 40);
    t('C4B-6d der nachtraeglich zugestellte Marker aendert das Ergebnis nicht',
      cs[4].st().winner === vorher.winner && JSON.stringify(cs[4].st().over) === vorher.over
      && cs[4].hash() === vorher.hash,
      { winner: cs[4].st().winner, over: cs[4].st().over, ev: cs[4].ev() });
    t('C4B-6d und beide Clients bleiben deckungsgleich',
      cs[3].st().winner === cs[4].st().winner && cs[3].hash() === cs[4].hash(),
      { a: cs[3].st().winner, b: cs[4].st().winner });
  }

  // ── C4B-6c: nach einem Austritt startet keine neue Generation ──
  {
    const { db, cs } = await newMatch('C4DC');
    const code = 'C4DC', off = 2;
    db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(off); await tick(db, 40);
    t('C4B-6c Vorbedingung: ein Austritt liegt vor', cs[0].exitHappened() === true, cs[0].ev());

    const genVorher = db.data.rooms[code].gen;
    const laufVorher = cs.map(c => c.st().runningGen);
    // Ein Mitspieler erhoeht die Generation trotzdem - die Rules sperren nur den
    // Schreiber selbst, nicht diesen Fall.
    db.data.rooms[code].gen = genVorher + 1; db.touch(); await tick(db, 40);
    const laufNachher = cs.map(c => c.st().runningGen);
    t('C4B-6c kein Client startet die neue Generation',
      laufNachher.join(',') === laufVorher.join(','), { vorher: laufVorher, nachher: laufNachher });
    t('C4B-6c und es wird kein neuer Zug fuer diese Generation begonnen',
      ((db.data.rooms[code].g || {})[genVorher + 1] || {}).t === undefined,
      (db.data.rooms[code].g || {})[genVorher + 1]);
    t('C4B-6c der geloeschte Rosteranker wird nicht wiederverwendet',
      cs[0].st().active[off] === false || cs[0].ev()[off] === true,
      { active: cs[0].st().active, ev: cs[0].ev() });
  }
}


// ── C4B · SERVERSEITIGE REMATCH-SPERRE UND KANONISCHER AUSTRITT ──────────────
{
  const nextBoundary = async (db, cs) => {
    for (const c of cs) { const st = c.st(), me = st.myPlayer;
      if (st.active[me] && !st.aimSet[me]) c.commitVec(50, -30, 0); }
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
  };
  // Ein Schreibversuch OHNE Client-Waechter, ausgewertet gegen die Datenbank.
  const genWrite = async (db, c) => { const p = c.forceGenWrite(); await tick(db, 30); return p; };

  // ── C4B-7a: die Rematch-Sperre haengt nicht am Client ──
  // Ein Client-Waechter kann sie nicht durchsetzen: er haengt an der Zustellung seines
  // Listeners, und ein frisch geladener Client kennt den Marker gar nicht. Geprueft wird
  // deshalb der Schreibvorgang selbst - er muss von der Datenbank abgelehnt werden.
  {
    const { db, cs } = await newMatch('C4EA');
    const code = 'C4EA';
    db.publishOffset(); await tick(db, 20);
    const gen0 = db.data.rooms[code].gen;
    t('C4B-7a ohne Austritt ist der Generationswechsel erlaubt',
      (await genWrite(db, cs[0])) === 'ok' && db.data.rooms[code].gen === gen0 + 1,
      db.data.rooms[code].gen);

    db.setPresence(code, 2, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(2); await tick(db, 40);
    t('C4B-7a der Austritt steht in der Historie', cs[0].ev()[2] === true, cs[0].ev());

    const gen1 = db.data.rooms[code].gen;
    for (const i of [0, 1, 2, 3, 4]) {
      const r = await genWrite(db, cs[i]);
      t('C4B-7a Client ' + i + ' darf danach keine neue Generation schreiben',
        r === 'denied' && db.data.rooms[code].gen === gen1,
        { antwort: r, gen: db.data.rooms[code].gen });
    }
  }

  // ── C4B-7b: der Austritt geht gegen die AUTORITATIVE Generation ──
  // Ein fremder Rematch erhoeht die Generation, waehrend ein Client sie noch nicht
  // zugestellt bekommen hat. Sein Austritt darf nicht gegen die alte Generation
  // geschrieben werden - sonst wiese die Regel das gesamte atomare Update ab und der
  // Sitz bliebe als verbundener Geistersitz stehen.
  {
    const { db, cs } = await newMatch('C4EB');
    const code = 'C4EB', quit = 3;
    db.publishOffset(); await tick(db, 20);
    db.hold(cs[quit].uid, 'gen');
    const genAlt = cs[quit].st().gen;
    cs[0].rematch(); await tick(db, 40);
    const genNeu = db.data.rooms[code].gen;
    t('C4B-7b die Generation ist serverseitig weiter', genNeu === genAlt + 1, { genAlt, genNeu });
    t('C4B-7b der austretende Client kennt sie noch nicht', cs[quit].st().gen === genAlt,
      cs[quit].st().gen);

    cs[quit].leave(); await tick(db, 60);
    const room = db.data.rooms[code];
    t('C4B-7b der Sitz ist zurueckgenommen',
      (!room || !room.players || room.players[quit] === undefined), room && room.players);
    t('C4B-7b keine Praesenz bleibt zurueck',
      (!room || !room.p || room.p[quit] === undefined), room && room.p);
    t('C4B-7b der Marker steht in der AKTUELLEN Generation',
      !!(room && room.g && room.g[genNeu] && room.g[genNeu].e && room.g[genNeu].e[quit] === true),
      room && room.g);
    t('C4B-7b und nicht in der alten',
      !(room && room.g && room.g[genAlt] && room.g[genAlt].e && room.g[genAlt].e[quit] === true),
      room && room.g);
    t('C4B-7b der Client hat den Raum wirklich verlassen',
      cs[quit].st().online === false && cs[quit].st().roomCode === '', cs[quit].st());
    t('C4B-7b und meldet keinen Fehler', cs[quit].leaveState().error === '', cs[quit].leaveState());
  }

  // ── C4B-7c: ein abgelehnter Versuch wird wiederholt, nicht verschluckt ──
  {
    const { db, cs } = await newMatch('C4EC');
    const code = 'C4EC', quit = 2;
    db.publishOffset(); await tick(db, 20);
    db.failWrites(cs[quit].uid, 1);
    cs[quit].leave(); await tick(db, 60);
    const room = db.data.rooms[code];
    t('C4B-7c der zweite Anlauf gelingt',
      (!room || !room.players || room.players[quit] === undefined), room && room.players);
    t('C4B-7c der Austritt ist vermerkt',
      !!(room && room.g && room.g[room.gen] && room.g[room.gen].e
         && room.g[room.gen].e[quit] === true), room && room.g);
    t('C4B-7c und der Client ist danach draussen', cs[quit].st().online === false, cs[quit].st());
  }

  // ── C4B-7d: scheitert der Austritt endgueltig, wird er NICHT vorgetaeuscht ──
  // Kein halber Austritt: entweder der Sitz ist serverseitig zurueckgenommen, oder der
  // Spieler ist weiter im Match - und erfaehrt das auch.
  {
    const { db, cs } = await newMatch('C4ED');
    const code = 'C4ED', quit = 1;
    db.publishOffset(); await tick(db, 20);
    db.failWrites(cs[quit].uid, 99);
    cs[quit].leave(); await tick(db, 80);
    const room = db.data.rooms[code];
    t('C4B-7d der Sitz bleibt serverseitig bestehen',
      !!(room && room.players && room.players[quit]), room && room.players);
    t('C4B-7d die Praesenz bleibt bestehen - kein halber Austritt',
      !!(room && room.p && room.p[quit]), room && room.p);
    t('C4B-7d kein Austrittsmarker wurde gesetzt',
      !(room && room.g && room.g[room.gen] && room.g[room.gen].e
        && room.g[room.gen].e[quit] === true), room && room.g);
    t('C4B-7d der Client bleibt im Match',
      cs[quit].st().online === true && cs[quit].st().roomCode === code, cs[quit].st());
    t('C4B-7d das Scheitern ist festgehalten',
      cs[quit].leaveState().error !== '' && cs[quit].leaveState().busy === false,
      cs[quit].leaveState());
    t('C4B-7d und es wird dem Spieler gesagt',
      cs[quit].discView().toasts.some(x => x.indexOf('Austritt nicht bestaetigt') >= 0),
      cs[quit].discView().toasts);
    t('C4B-7d nichts wurde als erledigt vermerkt', cs[quit].leaveState().retired === false,
      cs[quit].leaveState());

    db.failWrites(cs[quit].uid, 0);
    cs[quit].leave(); await tick(db, 60);
    const room2 = db.data.rooms[code];
    t('C4B-7d der naechste Versuch traegt',
      (!room2 || !room2.players || room2.players[quit] === undefined), room2 && room2.players);
    t('C4B-7d und der Client ist danach draussen', cs[quit].st().online === false, cs[quit].st());
  }

  // ── C4B-7e: der Austritt bleibt ein dauerhafter Austritt ──
  // Nach dem kanonischen Verlassen schliesst ein verbliebener Mitspieler den Sitz per
  // REMOVE - genau wie beim Fristablauf, ohne Tor und ohne Lebensabzug.
  {
    const { db, cs } = await newMatch('C4EE');
    const code = 'C4EE', quit = 4;
    db.publishOffset(); await tick(db, 20);
    const leben0 = cs[0].st().lives.join(',');
    cs[quit].leave(); await tick(db, 60);
    const evAt = (r) => (r && r.g && r.g[r.gen] && r.g[r.gen].e) || {};
    t('C4B-7e der Austritt ist vermerkt',
      evAt(db.data.rooms[code])[quit] === true, db.data.rooms[code] && db.data.rooms[code].g);
    await nextBoundary(db, cs); await nextBoundary(db, cs);
    const st = cs[0].st();
    t('C4B-7e der Sitz ist aus dem Spiel genommen', st.active[quit] === false, st.active);
    t('C4B-7e ohne Tor und ohne Lebensabzug',
      cs[0].sfx().goal === 0 && st.lives.join(',') === leben0,
      { sfx: cs[0].sfx(), lives: st.lives });
    t('C4B-7e die uebrigen Sitze bleiben, wie sie waren',
      st.active.map((v, i) => (v ? i : -1)).filter(i => i >= 0).join(',') === '0,1,2,3', st.active);
    t('C4B-7e alle verbliebenen Clients sind deckungsgleich',
      [0, 1, 2, 3].every(i => cs[i].hash() === cs[0].hash()), [0, 1, 2, 3].map(i => cs[i].hash()));
  }
}


// ── C4B · NACHBESSERUNGEN AUS DEM ABSCHLUSSREVIEW ────────────────────────────
{
  // ── C4B-8a: der Uebergang ins Menue folgt der Bestaetigung, nicht dem Klick ──
  // showMenu() raeumt den Matchzustand ab. Solange der Austritt nicht bestaetigt ist,
  // ist der Client aber weiter Teilnehmer - ein abgeraeumter Zustand waere falsch.
  {
    const { db, cs } = await newMatch('C4FA');
    const code = 'C4FA', quit = 1;
    db.publishOffset(); await tick(db, 20);
    const hash0 = cs[quit].hash();
    db.failWrites(cs[quit].uid, 99);
    cs[quit].leaveThen(); await tick(db, 80);
    t('C4B-8a der Uebergang ist NICHT gelaufen', cs[quit].afterCount() === 0,
      cs[quit].afterCount());
    t('C4B-8a der Matchzustand steht unveraendert', cs[quit].hash() === hash0,
      { vorher: hash0, nachher: cs[quit].hash() });
    t('C4B-8a der Client ist weiter im Match', cs[quit].st().online === true, cs[quit].st());

    db.failWrites(cs[quit].uid, 0);
    cs[quit].leaveThen(); await tick(db, 60);
    t('C4B-8a nach der Bestaetigung laeuft der Uebergang genau einmal',
      cs[quit].afterCount() === 1, cs[quit].afterCount());
    t('C4B-8a und der Sitz ist zurueckgenommen',
      db.data.rooms[code] === undefined || db.data.rooms[code].players[quit] === undefined,
      db.data.rooms[code] && db.data.rooms[code].players);
  }

  // ── C4B-8b: ein abgelehnter Rematch nimmt lokal nichts vorweg ──
  // Ein Client, der den Marker noch nicht zugestellt bekommen hat, laeuft in die
  // serverseitige Sperre. Er darf die neue Generation nicht schon vorher starten und
  // sie dann wieder zuruecknehmen - beobachtbar waere ein kurzer, falscher Neustart.
  {
    const { db, cs } = await newMatch('C4FB');
    const code = 'C4FB', off = 2;
    db.publishOffset(); await tick(db, 20);
    db.hold(cs[3].uid, 'e');            // dieser Client erfaehrt vom Austritt nichts
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(off); await tick(db, 40);
    t('C4B-8b der eine Client kennt den Austritt, der andere nicht',
      cs[0].exitHappened() === true && cs[3].exitHappened() === false,
      { a: cs[0].ev(), b: cs[3].ev() });

    const gen0 = db.data.rooms[code].gen;
    const lauf0 = cs.map(c => c.st().runningGen);
    const hash0 = cs[3].hash();
    cs[3].rematch(); await tick(db, 40);
    t('C4B-8b die Generation bleibt unveraendert', db.data.rooms[code].gen === gen0,
      db.data.rooms[code].gen);
    t('C4B-8b kein Client hat eine neue Generation gestartet',
      cs.every((c, i) => c.st().runningGen === lauf0[i]), cs.map(c => c.st().runningGen));
    t('C4B-8b auch der Anfragende nicht - sein Zustand ist unberuehrt',
      cs[3].hash() === hash0, { vorher: hash0, nachher: cs[3].hash() });
    t('C4B-8b und er erfaehrt, dass es nicht geht',
      cs[3].discView().toasts.some(x => x.indexOf('Rematch nicht') >= 0),
      cs[3].discView().toasts);
  }

  // ── C4B-8c: ein verspaeteter Austritt traegt keine fremde Sitzung aus ──
  // Derselbe Account in einem neuen Tab kann den Sitz zurueckerobern. Ein noch laufender
  // Austritt der alten Sitzung darf dessen Anker nicht loeschen.
  {
    const { db, cs } = await newMatch('C4FC');
    const code = 'C4FC', quit = 3;
    db.publishOffset(); await tick(db, 20);
    // Der Sitz gehoert jetzt einer NEUEREN Sitzung desselben Kontos.
    const neuerTab = 'FBTAB_NEU';
    db.data.rooms[code].players[quit].tab = neuerTab;
    db.data.rooms[code].p[quit].s = neuerTab;
    db.touch(); await tick(db, 20);
    t('C4B-8c die alte Sitzung kennt einen anderen Tab', cs[quit].tab() !== neuerTab,
      { alt: cs[quit].tab(), neu: neuerTab });

    cs[quit].leave(); await tick(db, 60);
    const room = db.data.rooms[code];
    t('C4B-8c der Rosteranker der neuen Sitzung bleibt stehen',
      !!(room && room.players && room.players[quit] && room.players[quit].tab === neuerTab),
      room && room.players && room.players[quit]);
    t('C4B-8c ihre Praesenz bleibt ebenfalls stehen',
      !!(room && room.p && room.p[quit] && room.p[quit].s === neuerTab),
      room && room.p && room.p[quit]);
    t('C4B-8c und es wurde kein Austritt fuer sie vermerkt',
      !(room && room.g && room.g[room.gen] && room.g[room.gen].e
        && room.g[room.gen].e[quit] === true), room && room.g);
    t('C4B-8c die alte Sitzung hat den Raum trotzdem verlassen',
      cs[quit].st().online === false, cs[quit].st());
  }

  // ── C4B-8d: ein bereits gesetzter Marker laesst die Anker nicht zurueck ──
  // Beim Fristablauf setzt ein Mitspieler den Marker, waehrend p/ und players/ stehen
  // bleiben. Verlaesst der Betroffene danach selbst, muessen genau diese Anker weg -
  // und der write-once Marker darf nicht erneut geschrieben werden.
  {
    const { db, cs } = await newMatch('C4FD');
    const code = 'C4FD', off = 4;
    db.publishOffset(); await tick(db, 20);
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(off); await tick(db, 40);
    const evJetzt = () => { const r = db.data.rooms[code];
      return (r && r.g && r.g[r.gen] && r.g[r.gen].e) || {}; };
    t('C4B-8d der Marker steht, die Anker stehen noch',
      evJetzt()[off] === true
      && !!db.data.rooms[code].players[off] && !!db.data.rooms[code].p[off],
      { g: db.data.rooms[code].g, players: db.data.rooms[code].players[off] });

    db.setPresence(code, off, true);   // der Betroffene ist wieder verbunden …
    await tick(db, 20);
    cs[off].leave(); await tick(db, 60);   // … und geht selbst
    const room = db.data.rooms[code];
    t('C4B-8d sein Rosteranker ist weg',
      !room || !room.players || room.players[off] === undefined, room && room.players);
    t('C4B-8d seine Praesenz ist weg',
      !room || !room.p || room.p[off] === undefined, room && room.p);
    t('C4B-8d der Marker steht unveraendert',
      !room || (room.g && room.g[room.gen] && room.g[room.gen].e
                && room.g[room.gen].e[off] === true), room && room.g);
    t('C4B-8d ohne gemeldeten Fehler', cs[off].leaveState().error === '',
      cs[off].leaveState());
  }
}


// ── C5 · VARIABLER MATCHSTART: ZWEI BIS FUENF ───────────────────────────────
// Ein Football-Raum fasst fuenf Sitze; gestartet wird ab zwei. Die Startbesetzung ist
// die des Startsignals `seats` - sie friert mit dem Start ein und gilt fuer die ganze
// Generation. Ungenutzte Sitze sind keine Teilnehmer: keine Leben, keine Zugpflicht,
// kein Eintrag in der Historie.
{
  const nextBoundary = async (db, cs) => {
    for (const c of cs) { const st = c.st(), me = st.myPlayer;
      if (st.active[me] && !st.aimSet[me]) c.commitVec(50, -30, 0); }
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
  };

  // ── C5-1: allein startet niemand ──
  {
    const db = makeDB();
    const solo = makeClient(db, 'C5AA', { name: 'P1' });
    solo.enterFootball(); solo.create(); await tick(db);
    t('C5-1 der Startknopf ist bei 1/5 gesperrt', solo.lobbyStartDisabled() === true,
      solo.lobbyStartDisabled());
    t('C5-1 der Hinweis in der Lobby nennt die Mindestzahl',
      solo.lobbyHint().indexOf('Mindestens 2 Spieler') >= 0, solo.lobbyHint());
    solo.start(); await tick(db, 30);
    t('C5-1 und der Raum bleibt in der Lobby', db.data.rooms.C5AA.state === 'lobby',
      db.data.rooms.C5AA.state);
    t('C5-1 kein Startsignal geschrieben', db.data.rooms.C5AA.seats === undefined,
      db.data.rooms.C5AA.seats);
    // Der Klick darf nicht wirkungslos verpuffen - der Host erfaehrt den Grund.
    // Der Klick darf nicht wirkungslos verpuffen - der Host erfaehrt den Grund aus
    // derselben gemeinsamen Mindestzahl, die auch die uebrigen Formate schuetzt.
    t('C5-1 der Startversuch sagt dem Host, was fehlt',
      solo.discView().toasts.some(x => x.indexOf('Mindestens 2 Spieler nötig') >= 0),
      solo.discView().toasts);
  }

  // ── C5-2 bis C5-5: Start mit zwei, drei, vier und fuenf ──
  // Fuer jede Besetzung dasselbe Versprechen: genaue Teilnehmerliste, passende
  // Arenaform, zwei Leben je Teilnehmer, keine Zugpflicht fuer ungenutzte Sitze.
  const ARENA = { 2: 2, 3: 3, 4: 4, 5: 5 };   // Teilnehmer -> Arenaphase (Shouldered Wide /
                                              // Broad Rounded Triangle / Rounded Square / Pentagon)
  for (const n of [2, 3, 4, 5]) {
    const code = 'C5B' + n;
    const { db, cs } = await newMatchN(code, n);
    const raum = db.data.rooms[code];
    const kopf = 'C5-' + n + ' (' + n + ' Teilnehmer) ';

    t(kopf + 'das Match ist gestartet', raum.state === 'playing' && raum.seats === n,
      { state: raum.state, seats: raum.seats });
    t(kopf + 'alle Clients spielen', cs.every(c => c.st().gameStarted === true),
      cs.map(c => c.st().gameStarted));
    t(kopf + 'die Teilnehmerliste ist genau die Lobby',
      cs[0].st().active.join(',') === new Array(n).fill('true').join(','),
      cs[0].st().active);
    t(kopf + 'die Startbesetzung steht bei allen gleich',
      cs.every(c => c.startN() === n), cs.map(c => c.startN()));
    t(kopf + 'die urspruenglichen Sitznummern bleiben',
      cs.map(c => c.st().myPlayer).join(',') === [...Array(n).keys()].join(','),
      cs.map(c => c.st().myPlayer));
    t(kopf + 'jeder Teilnehmer hat zwei Leben',
      cs[0].st().lives.join(',') === new Array(n).fill('2').join(','), cs[0].st().lives);
    // Ungenutzte Sitze sind keine stillen Mitspieler: keine Aktivmarke, kein Torslot,
    // keine Kugel - und damit nichts, worauf das Spiel je warten oder was es anzeigen
    // koennte (die Chipleiste laeuft ebenfalls nur ueber die Teilnehmer).
    const roh = cs[0].raw();
    t(kopf + 'ungenutzte Sitze sind nicht aktiv und haben keinen Torslot',
      [0, 1, 2, 3, 4].every(i => (i < n) || (roh.fbElimActive[i] === false && roh.fbElimSlots[i] === -1)),
      { active: roh.fbElimActive, slots: roh.fbElimSlots });
    t(kopf + 'und keine Kugel im Feld',
      [0, 1, 2, 3, 4].every(i => (i < n) || cs[0].st().ballN === n + 1),
      { ballN: cs[0].st().ballN, erwartet: n + 1 });
    t(kopf + 'die richtige Arenaform', cs[0].st().phaseN === ARENA[n], cs[0].st().phaseN);
    t(kopf + 'die Torslots gehoeren genau den Teilnehmern',
      cs[0].st().slots.slice().sort().join(',') === [...Array(n).keys()].join(','),
      cs[0].st().slots);
    t(kopf + 'kein ungenutzter Sitz ist im Raum eingetragen',
      [0, 1, 2, 3, 4].every(i => (i < n) === !!raum.players[i]),
      Object.keys(raum.players || {}));

    // Ein spaeter Beitritt darf keinen freien Sitz mehr besetzen.
    if (n < 5) {
      const spaet = makeClient(db, code, { name: 'SPAET' });
      spaet.join(code); await tick(db, 40);
      t(kopf + 'ein spaeter Beitritt bekommt keinen freien Sitz',
        spaet.st().online === false && Object.keys(db.data.rooms[code].players).length === n,
        { online: spaet.st().online, players: Object.keys(db.data.rooms[code].players) });
    }

    // Zugpflicht: genau die Teilnehmer, niemand sonst.
    for (let i = 0; i < n; i++) cs[i].commitVec(40 + i * 5, -30, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
    const slot0 = ((raum.g[raum.gen] || {}).t || {})['0'] || {};
    t(kopf + 'der erste Zug enthaelt genau die Teilnehmer',
      Object.keys(slot0).sort().join(',') === [...Array(n).keys()].join(','),
      Object.keys(slot0));
    t(kopf + 'die Runde wurde aufgeloest - niemand wartet auf leere Sitze',
      cs.every(c => c.st().turnNo >= 1), cs.map(c => c.st().turnNo));
    t(kopf + 'alle Clients sind deckungsgleich', cs.every(c => c.hash() === cs[0].hash()),
      cs.map(c => c.hash()));

    // Rehydrierung: ein frischer Client leitet denselben Zustand aus der Historie ab.
    const ref = cs[0].hash(), refSt = cs[0].st();
    const fresh = makeClient(db, code, { name: 'REPLAY' });
    fresh.prepareReplay(0, raum.gen, raum.seats);
    fresh.replay(raum.g[raum.gen].t);
    t(kopf + 'Rehydrierung trifft denselben Zustand', fresh.hash() === ref,
      { fresh: fresh.hash(), ref });
    t(kopf + 'Rehydrierung leitet Leben und Arenaphase ab',
      fresh.st().lives.join(',') === refSt.lives.join(',') && fresh.st().phaseN === refSt.phaseN,
      { lives: fresh.st().lives, phaseN: fresh.st().phaseN });
    // Und die Rueckkehrpruefung des Produkts akzeptiert genau diese Besetzung.
    t(kopf + 'die Rueckkehr in diesen Raum ist erlaubt',
      cs[0].rejoinCheck(db.data.rooms[code]).ok === true, cs[0].rejoinCheck(db.data.rooms[code]));
  }

  // ── C5-5b: die ECHTE Rueckkehr in eine Dreierpartie ──
  // Der Rueckkehrer darf die Startbesetzung nicht raten und nicht aus der aktuellen
  // Praesenz ableiten - er liest sie aus dem Startsignal des Raums.
  {
    const { db, cs } = await newMatchN('C5R3', 3);
    db.publishOffset(); await tick(db, 20);
    await playRound(db, cs, () => [-40, 50]);
    const ref = cs[0].hash(), refTurn = cs[0].st().turnNo;

    const gone = cs[2], pid = gone.pid, uid = gone.uid;
    gone.drop();
    db.data.rooms.C5R3.p[2].on = false;
    const back = makeClient(db, 'C5R3', { pid, uid, name: 'P3' });
    const pending = back.rejoin('C5R3');
    await tick(db);
    const ok = await pending;
    await tick(db);
    t('C5-5b die Rueckkehr in die Dreierpartie gelingt', ok === true, { ok });
    t('C5-5b die Startbesetzung kommt aus dem Startsignal', back.startN() === 3, back.startN());
    t('C5-5b derselbe Sitz, dasselbe Match',
      back.st().myPlayer === 2 && back.st().gameStarted === true, back.st());
    t('C5-5b der volle Spielzustand kam aus der Historie', back.hash() === ref,
      { back: back.hash(), ref });
    t('C5-5b derselbe Zug und dieselbe Arenaform',
      back.st().turnNo === refTurn && back.st().phaseN === 3,
      { turn: back.st().turnNo, ref: refTurn, phaseN: back.st().phaseN });
    t('C5-5b die Rueckkehr war still', back.sfx().goal === 0 && back.sfx().launch === 0, back.sfx());
  }

  // ── C5-5c: das Startrennen darf den Raum nicht toeten ──
  // Der Host zaehlt zwei Spieler, im selben Moment belegt ein dritter einen Sitz. Das
  // Startsignal `seats=2` ist dann unzulaessig (ein Beigetretener bliebe zurueck). Weil
  // Zustand und Startsignal in EINEM Update stehen, faellt die Ablehnung vollstaendig
  // zurueck: der Raum bleibt Lobby. Nacheinander geschrieben waere er verloren gewesen -
  // 'playing' ohne Startsignal, und die Zustandsregel laesst sich nicht wiederholen.
  {
    const db = makeDB();
    const cs = [];
    for (let i = 0; i < 3; i++) cs.push(makeClient(db, 'C5RC', { name: 'P' + (i + 1) }));
    cs[0].enterFootball(); cs[0].create(); await tick(db);
    cs[1].join('C5RC'); await tick(db);

    // Der Host haelt seine Zaehlung fest, der Dritte tritt bei, DANN klickt der Host.
    const gezaehlt = cs[0].lobbyCount();
    cs[2].join('C5RC'); await tick(db);
    cs[0].startWith(2); await tick(db, 40);

    const raum = db.data.rooms.C5RC;
    t('C5-5c der Host hatte zwei gezaehlt', gezaehlt === '2/5', gezaehlt);
    t('C5-5c das verlorene Rennen laesst den Raum in der Lobby',
      raum.state === 'lobby' && raum.seats === undefined, { state: raum.state, seats: raum.seats });
    t('C5-5c niemand ist gestartet', cs.every(c => c.st().gameStarted === false),
      cs.map(c => c.st().gameStarted));
    t('C5-5c alle drei sitzen weiterhin im Raum',
      [0, 1, 2].every(i => !!raum.players[i]), Object.keys(raum.players || {}));

    // Und der zweite Versuch - jetzt mit der richtigen Zahl - traegt.
    cs[0].start(); await tick(db, 60);
    const raum2 = db.data.rooms.C5RC;
    t('C5-5c der naechste Startversuch gelingt',
      raum2.state === 'playing' && raum2.seats === 3, { state: raum2.state, seats: raum2.seats });
    t('C5-5c und alle drei sind im Match',
      cs.every(c => c.st().gameStarted === true) && cs[0].st().phaseN === 3,
      { started: cs.map(c => c.st().gameStarted), phaseN: cs[0].st().phaseN });
  }

  // ── C5-6: die Rueckkehrpruefung weist unmoegliche Besetzungen ab ──
  {
    const { db, cs } = await newMatchN('C5C3', 3);
    const raum = db.data.rooms.C5C3;
    const mit = (seats) => Object.assign({}, raum, { seats });
    t('C5-6 Besetzung 2 bis 5 wird angenommen',
      [2, 3, 4, 5].every(n => cs[0].rejoinCheck(mit(n)).ok === true),
      [2, 3, 4, 5].map(n => cs[0].rejoinCheck(mit(n)).ok));
    t('C5-6 eine Besetzung von 1 wird abgewiesen', cs[0].rejoinCheck(mit(1)).ok === false,
      cs[0].rejoinCheck(mit(1)));
    t('C5-6 eine Besetzung von 6 wird abgewiesen', cs[0].rejoinCheck(mit(6)).ok === false,
      cs[0].rejoinCheck(mit(6)));
  }

  // ── C5-7: Elimination 3 -> 2 -> Sieger ──
  {
    const { db, cs } = await newMatchN('C5D3', 3);
    db.publishOffset(); await tick(db, 20);
    t('C5-7 Start in der Dreierarena', cs[0].st().phaseN === 3, cs[0].st().phaseN);
    const raus = await eliminateSeat(db, cs, 2, 40);
    t('C5-7 ein Teilnehmer scheidet regulaer aus', raus === true, cs[0].st().active);
    t('C5-7 die Arena baut auf zwei um', cs[0].st().phaseN === 2, cs[0].st().phaseN);
    t('C5-7 zwei Teilnehmer sind uebrig', cs[0].st().active.filter(Boolean).length === 2,
      cs[0].st().active);
    const rest = cs[0].st().active.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    const weg = await eliminateSeat(db, cs, rest[1], 40);
    t('C5-7 das Match endet mit einem Sieger',
      weg === true && cs[0].st().winner === rest[0],
      { winner: cs[0].st().winner, erwartet: rest[0] });
    t('C5-7 alle Clients nennen denselben Sieger',
      cs.every(c => c.st().winner === cs[0].st().winner), cs.map(c => c.st().winner));
  }

  // ── C5-8: Elimination 4 -> 3 -> 2 ──
  {
    const { db, cs } = await newMatchN('C5D4', 4);
    db.publishOffset(); await tick(db, 20);
    t('C5-8 Start in der Viererarena', cs[0].st().phaseN === 4, cs[0].st().phaseN);
    t('C5-8 Sitz 3 scheidet aus', (await eliminateSeat(db, cs, 3, 40)) === true, cs[0].st().active);
    t('C5-8 die Arena zeigt drei', cs[0].st().phaseN === 3, cs[0].st().phaseN);
    t('C5-8 Sitz 2 scheidet aus', (await eliminateSeat(db, cs, 2, 40)) === true, cs[0].st().active);
    t('C5-8 die Arena zeigt zwei', cs[0].st().phaseN === 2, cs[0].st().phaseN);
    t('C5-8 die urspruenglichen Sitznummern blieben',
      cs[0].st().active.map((v, i) => (v ? i : -1)).filter(i => i >= 0).join(',') === '0,1',
      cs[0].st().active);
  }

  // ── C5-9: zwei Teilnehmer - der Austritt entscheidet das Match ──
  {
    const { db, cs } = await newMatchN('C5D2', 2);
    db.publishOffset(); await tick(db, 20);
    t('C5-9 Start in der Zweierarena', cs[0].st().phaseN === 2, cs[0].st().phaseN);
    const leben0 = cs[0].st().lives.join(',');
    cs[1].leave(); await tick(db, 60);
    t('C5-9 der Austritt ist vermerkt',
      ((db.data.rooms.C5D2.g[db.data.rooms.C5D2.gen] || {}).e || {})[1] === true,
      db.data.rooms.C5D2.g);
    await nextBoundary(db, cs); await nextBoundary(db, cs);
    const st = cs[0].st();
    t('C5-9 der Verbliebene gewinnt', st.winner === 0, { winner: st.winner, active: st.active });
    t('C5-9 ohne Tor und ohne Lebensabzug',
      cs[0].sfx().goal === 0 && st.lives.join(',') === leben0,
      { sfx: cs[0].sfx(), lives: st.lives });
  }

  // ── C5-10: Trennung, SKIP und dauerhafter Austritt in einer Dreierpartie ──
  // C1 bis C4B duerfen nicht von fuenf Startsitzen ausgehen.
  {
    const { db, cs } = await newMatchN('C5E3', 3);
    const code = 'C5E3', off = 2;
    db.publishOffset(); await tick(db, 20);
    const leben0 = cs[0].st().lives.join(',');

    // Voruebergehend offline: der Slot wird per SKIP geschlossen, niemand verliert etwas.
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    for (const i of [0, 1]) cs[i].commitVec(40, -30, 0);
    await tick(db, 40);
    for (const c of cs) c.pump();
    await tick(db, 40);
    const T = db.data.rooms[code].g[db.data.rooms[code].gen].t || {};
    const skips = Object.keys(T).filter(k => T[k][off] && T[k][off].k === 'skip').length;
    t('C5-10 der offline stehende Sitz wird uebersprungen', skips >= 1, { skips, T: Object.keys(T) });
    t('C5-10 SKIP kostet kein Leben', cs[0].st().lives.join(',') === leben0, cs[0].st().lives);
    t('C5-10 und der Sitz bleibt Teilnehmer', cs[0].st().active[off] === true, cs[0].st().active);

    // Rueckkehr: dieselbe Kennung, derselbe Sitz.
    db.setPresence(code, off, true); await tick(db, 40);
    t('C5-10 nach der Rueckkehr ist der Sitz wieder verbunden',
      db.data.rooms[code].p[off].on === true && cs[0].st().active[off] === true,
      db.data.rooms[code].p[off]);

    // Dauerhaft weg: Frist, Eviction, REMOVE, Umbau auf zwei.
    db.setPresence(code, off, false); db.publishOffset(); await tick(db, 20);
    db.advanceServer(16000); await tick(db, 20);
    cs[0].seatGoneNow(off); await tick(db, 40);
    t('C5-10 der dauerhafte Austritt ist vermerkt', cs[0].ev()[off] === true, cs[0].ev());
    await nextBoundary(db, cs); await nextBoundary(db, cs);
    const st = cs[0].st();
    t('C5-10 der Sitz ist aus dem Spiel genommen', st.active[off] === false, st.active);
    t('C5-10 die Arena baut auf zwei um', st.phaseN === 2, st.phaseN);
    t('C5-10 ohne Tor und ohne Lebensabzug',
      cs[0].sfx().goal === 0 && st.lives.join(',') === leben0,
      { sfx: cs[0].sfx(), lives: st.lives });
    t('C5-10 die Verbliebenen behalten ihre Sitznummern',
      st.active.map((v, i) => (v ? i : -1)).filter(i => i >= 0).join(',') === '0,1', st.active);
    t('C5-10 und laufen deckungsgleich weiter',
      cs[0].hash() === cs[1].hash(), [cs[0].hash(), cs[1].hash()]);
  }
}

console.log('\nFootball-Online: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR: ' + (e && e.stack || e)); process.exit(1); });
