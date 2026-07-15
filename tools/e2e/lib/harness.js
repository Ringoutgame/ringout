// ─────────────────────────────────────────────────────────────────────────────
// RingOut — E2E harness core (shared infrastructure)
//
// This module owns everything the Online-FFA E2E needs and nothing gameplay
// specific: the in-memory index.html transform (structural, count-checked), the
// hard production-Firebase block for BOTH HTTP and WebSocket transport, the local
// static server, the JDK-21 RTDB emulator (process-local, no shell), a per-run
// isolated + SHA-256-verified temp rules copy, and the browser/port/temp cleanup.
// Both run-ffa-e2e.js (the harness) and spike.js (the diagnostic) build on this.
//
// It NEVER modifies index.html or firebase.rules.json on disk: the served HTML
// is transformed only in memory (page.route), the rules are used from a verified
// exclusive temp copy under tools/e2e/.tmp/<run-id>/, and every process/port/file
// the launcher itself created is torn down. Foreign files/processes are never
// touched.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');

// ── Fixed local configuration ────────────────────────────────────────────────
const REPO_ROOT   = path.resolve(__dirname, '..', '..', '..');
const INDEX_HTML  = path.join(REPO_ROOT, 'index.html');
const ROOT_RULES  = path.join(REPO_ROOT, 'firebase.rules.json');
const E2E_DIR     = path.join(__dirname, '..');          // tools/e2e
const TMP_BASE    = path.join(E2E_DIR, '.tmp');           // parent of per-run dirs
const ROOT_LOG_NAMES = ['firebase-debug.log', 'database-debug.log', 'ui-debug.log'];

const EMU_HOST    = '127.0.0.1';
const EMU_PORT    = 9000;
const EMU_AUX_PORTS = [4400, 4500]; // emulator hub / logging ports — must also be free/released
const EMU_PROJECT = 'demo-ringout-e2e';
const EMU_NS      = 'demo-ringout-e2e-default-rtdb';
const JDK21_HOME  = 'C:\\Program Files\\Microsoft\\jdk-21.0.11.10-hotspot';

// Host allowlist (nothing else may leave the machine). Emulator + local server
// are 127.0.0.1; the Firebase JS SDK modules load from www.gstatic.com. No wide
// allowlist — anything not on this list is aborted and recorded.
const ALLOW_HOSTS = new Set(['127.0.0.1', 'localhost', 'www.gstatic.com']);
const PROD_HINT   = 'ringout-87fbb'; // production project id — must never be contacted

// A hostname is production Firebase if it carries the project hint or ends in a
// Firebase RTDB domain. NOTE: the emulator namespace host also ends in
// firebaseio.com, but connectDatabaseEmulator rewrites transport to 127.0.0.1 —
// so a request/socket that actually resolves to such a host means the redirect
// failed → a real violation. Local loopback is matched separately and allowed.
function isProdHost(host) {
  return !!host && (host.includes(PROD_HINT) || host.endsWith('firebaseio.com') || host.endsWith('firebasedatabase.app'));
}
function isLocalHost(host) {
  return host === '127.0.0.1' || host === 'localhost';
}

// Chromium test-only launch flags. The served page (127.0.0.1:PORT) reaching the
// emulator (127.0.0.1:9000) is a loopback→loopback request that Chromium's Local/
// Private Network Access checks block by default. These flags relax ONLY the test
// browser; no production code, config, or served markup depends on them.
const CHROMIUM_E2E_ARGS = [
  '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults',
];

// Grace after a leaveOnline() call in which its known-benign permission_denied
// warning may still surface from the SDK before the swallowed rejection settles.
const LEAVE_WINDOW_GRACE_MS = 4000;

// The single exact permission_denied string that is tolerated — reported verbatim.
// The room code uses the EXACT production alphabet ([A-HJKMNP-Z2-9], i.e. no
// I/L/O/0/1) and the full warning string is anchored: it must be a `set` on the
// bare room root `/rooms/{CODE}` (no sub-path continuation into /p, /seats, /g,
// /t, …). Anything else — any sub-path, any other op, any transaction/seat error —
// does not match and therefore fails the run.
// The Firebase logger frames the warning with an optional `[ISO-timestamp]` prefix
// and trailing whitespace; those framing bits are tolerated, but the warning body
// itself is fully anchored so nothing may precede/follow it beyond that framing.
const ROOM_CODE_CLASS = '[A-HJKMNP-Z2-9]{4}';
const BENIGN_PERMISSION_DENIED_RE = new RegExp(
  '^(?:\\[[^\\]]*\\]\\s*)?@firebase/database: FIREBASE WARNING: set at /rooms/(' + ROOM_CODE_CLASS + ') failed: permission_denied\\s*$');

// B1 (v3 client cutover): the leave-sentinel/elimination-latch path is NOT
// implemented client-side (see tools/e2e/ffa-scenarios.js scenarioLeave) — the
// v3 rules foundation from B0 defers it ("Fund 2", see tools/e2e/spike.js): a
// move-slot write for seat $pl requires root.p($pl).on===true, which a departed
// seat never has. So whenever ANY client leaves while a match is still active
// for the OTHERS (including ordinary test cleanup closing clients one-by-one
// after a scenario's own assertions already passed), every remaining client's
// automatic writeLeaveSentinel() attempt for that seat is expected to fail here,
// repeating on the capped backoff until it gives up. Two diagnostics result per
// attempt: the SDK's own `transaction at .../g/<gen>/t/<turn>/<seat> failed`
// warning (carries the room code) and index.html's own
// `[online] Turn-Slot-Transaction fehlgeschlagen` error log (does not carry a
// room code). Unlike the other two patterns this one is NOT scoped to a leave
// window's few-second grace — the capped backoff can legitimately keep retrying
// for up to ~18s (SENTINEL_RETRY_MAX_ATTEMPTS) after the seat departed, well
// past LEAVE_WINDOW_GRACE_MS — so it is tolerated for the whole run once at
// least one leave has occurred, which is safe because the regex/prefix stay
// narrowly anchored to this exact known-benign shape.
const BENIGN_SENTINEL_WARN_RE = new RegExp(
  '^(?:\\[[^\\]]*\\]\\s*)?@firebase/database: FIREBASE WARNING: transaction at /rooms/' + ROOM_CODE_CLASS + '/g/\\d+/t/\\d+/[0-4] failed: permission_denied\\s*$');
const BENIGN_SENTINEL_ERROR_RE = /^\[online\] Turn-Slot-Transaction fehlgeschlagen \(Seat [0-4]\): Error: permission_denied/;

// Three precisely-scoped benign diagnostics are tolerated — no blanket suppression:
//   1) Chromium's own DevTools inspector resource, blocked by the client, never
//      reaching gameplay (console.error, ERR_BLOCKED_BY_CLIENT.Inspector).
//   2) The best-effort whole-room delete in leaveOnline(): `remove(rRef())` is
//      denied by the cleanup rule while another seat is still present. index.html
//      wraps it in `.catch(()=>{})` by design; the SDK logs a console warning
//      before the rejection is swallowed. Tolerated ONLY when it is a `set at
//      /rooms/<4-char-code> failed: permission_denied` (no sub-path), the code
//      belongs to a room a client is currently/just leaving, and the warning
//      timestamp falls inside that leave window. Anything else — any other path,
//      any other permission_denied, any transaction/seat/turn error — fails.
//   3) A remaining client's automatic leave-sentinel write for a just-departed
//      seat, denied by design (Fund 2 deferred, B1 scope — see above). Tolerated
//      for the whole run once at least one leave-window has been opened.
function isBenignDiag(d, state) {
  if (!d) return false;
  if (d.kind === 'console.error'
    && /Failed to load resource/.test(d.text)
    && /ERR_BLOCKED_BY_CLIENT\.Inspector/.test(d.text)) return true;
  const anyLeaveOccurred = !!(state && state.leaveWindows && state.leaveWindows.length);
  if (d.kind === 'console.error' && anyLeaveOccurred && BENIGN_SENTINEL_ERROR_RE.test(d.text)) return true;
  if (d.kind === 'console.warn') {
    const m = d.text.match(BENIGN_PERMISSION_DENIED_RE);
    if (m) {
      const code = m[1];
      const windows = (state && state.leaveWindows) || [];
      const ts = typeof d.ts === 'number' ? d.ts : 0;
      return windows.some((w) => w.code === code && ts >= w.start && (w.end == null || ts <= w.end));
    }
    if (anyLeaveOccurred && BENIGN_SENTINEL_WARN_RE.test(d.text)) return true;
  }
  return false;
}

// Small, self-contained assertions for the benign permission_denied matcher.
// Runs before any scenario so a matcher regression (too-loose or too-tight) is
// caught deterministically without needing the emulator. Throws on any mismatch.
function selfTestBenignMatcher() {
  const now = 1000000;
  const win = (code) => ({ leaveWindows: [{ code, start: now - 100, end: now + 100 }] });
  const mk = (path, kind, ts) => ({ kind: kind || 'console.warn', text: '@firebase/database: FIREBASE WARNING: set at ' + path + ' failed: permission_denied', ts: ts == null ? now : ts });
  const W = win('QX9K'); // the currently-expected active room code
  const cases = [];
  const accept = (why, d, st) => cases.push({ why, expect: 'accept', pass: isBenignDiag(d, st) === true });
  const reject = (why, d, st) => cases.push({ why, expect: 'reject', pass: isBenignDiag(d, st) === false });

  accept('gueltiger Root-Room-Delete im aktiven Leave-Fenster', mk('/rooms/QX9K'), W);
  accept('gueltig mit Logger-Rahmen ([timestamp] + Leerraum wie real emittiert)',
    { kind: 'console.warn', text: '[2026-07-12T13:07:53.126Z]  @firebase/database: FIREBASE WARNING: set at /rooms/QX9K failed: permission_denied ', ts: now }, W);
  reject('Code mit I (nicht im Alphabet)', mk('/rooms/QI9K'), win('QI9K'));
  reject('Code mit O (nicht im Alphabet)', mk('/rooms/QO9K'), win('QO9K'));
  reject('Code mit 0 (nicht im Alphabet)', mk('/rooms/QX0K'), win('QX0K'));
  reject('Code mit 1 (nicht im Alphabet)', mk('/rooms/QX1K'), win('QX1K'));
  reject('Unterpfad /rooms/CODE/p', mk('/rooms/QX9K/p'), W);
  reject('Unterpfad /rooms/CODE/g/0/t/0/1', mk('/rooms/QX9K/g/0/t/0/1'), W);
  reject('Unterpfad /rooms/CODE/seats/2', mk('/rooms/QX9K/seats/2'), W);
  reject('anderer Raumcode als aktiv', mk('/rooms/MTZV'), W);
  reject('ausserhalb des Leave-Fensters (ts nach end)', mk('/rooms/QX9K', 'console.warn', now + 100000), W);
  reject('kein aktives Leave-Fenster', mk('/rooms/QX9K'), { leaveWindows: [] });

  // Sentinel-Denied (Fund 2 deferred, B1 scope) — NICHT fenstergebunden, nur
  // "irgendein Leave ist im Lauf passiert".
  const mkTx = (path, ts) => ({ kind: 'console.warn', text: '@firebase/database: FIREBASE WARNING: transaction at ' + path + ' failed: permission_denied', ts: ts == null ? now : ts });
  const mkErr = (seat, ts) => ({ kind: 'console.error', text: '[online] Turn-Slot-Transaction fehlgeschlagen (Seat ' + seat + '): Error: permission_denied\n    at stack...', ts: ts == null ? now : ts });
  accept('Sentinel-Warn gueltig, irgendein Leave im Lauf (weit ausserhalb der 4s-Gnadenfrist)',
    mkTx('/rooms/QX9K/g/0/t/3/1', now + 20000), W);
  accept('Sentinel-Error gueltig, irgendein Leave im Lauf', mkErr(2, now + 20000), W);
  reject('Sentinel-Warn ohne jedes Leave im Lauf', mkTx('/rooms/QX9K/g/0/t/3/1'), { leaveWindows: [] });
  reject('Sentinel-Error ohne jedes Leave im Lauf', mkErr(2), { leaveWindows: [] });
  reject('Sentinel-Warn Seat ausserhalb 0-4', mkTx('/rooms/QX9K/g/0/t/3/5'), W);
  reject('Sentinel-Error Seat ausserhalb 0-4', mkErr(5), W);
  reject('Sentinel-Pfad mit falschem Op (set statt transaction)', mk('/rooms/QX9K/g/0/t/3/1'), W);
  reject('falsche Diagnose-Art (console.error statt warn)', mk('/rooms/QX9K', 'console.error'), W);
  reject('anderer Op (update/Transaction) statt set', { kind: 'console.warn', text: '@firebase/database: FIREBASE WARNING: update at /rooms/QX9K failed: permission_denied', ts: now }, W);

  const failed = cases.filter((c) => !c.pass);
  if (failed.length) throw new Error('Benign-Matcher-Selbsttest fehlgeschlagen:\n' + JSON.stringify(failed, null, 2));
  return { total: cases.length, cases: cases.map((c) => ({ expect: c.expect, why: c.why })) };
}

// ── Tiny logger ──────────────────────────────────────────────────────────────
const log  = (...a) => console.log('[e2e]', ...a);
const warn = (...a) => console.warn('[e2e][WARN]', ...a);
const ok   = (m)    => console.log('  ✓', m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ── Test-only in-page adapter ────────────────────────────────────────────────
// Injected ONLY into the served copy. Every function drives an existing
// production code path — it never writes Firebase slots as a stand-in for a
// player action, sets winners/scores, eliminates balls, forces reveal, or
// manipulates turn/generation. snapshot() is strictly read-only serialization.
const ADAPTER_SRC = `
window.__ringoutE2E = (function(){
  function g(fn){ try{ return fn(); }catch(_){ return null; } }
  // boolArr/numArr remain for LOCAL-VIEW fields only (aimSet, seatLeft) — these
  // are not AUTH_FIELDS, are never compared for convergence, and staying
  // tolerant there does not risk a false-green desync verdict.
  function boolArr(a){ return Array.isArray(a) ? a.slice(0,5).map(function(v){return !!v;}) : []; }
  function r4(n){ return (typeof n==='number' && isFinite(n)) ? Math.round(n*1e4)/1e4 : 0; }
  function ownIdx(who){ var own=aliveBalls(who); return own.length?balls.indexOf(own[0]):-1; }

  // Strict readers for MANDATORY (AUTH_FIELDS-relevant) values: no catch-to-null,
  // no coercion, no invented defaults. Any violation throws with the exact field
  // path and offending value, which rejects page.evaluate() and fails the run —
  // a read/shape error must never be able to converge as an accidental match.
  function reqInt(path, v){ if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v) throw new Error('E2E snapshot: ' + path + ' keine gueltige Ganzzahl: ' + v); return v; }
  function reqFinite(path, v){ if (typeof v !== 'number' || !isFinite(v)) throw new Error('E2E snapshot: ' + path + ' nicht endlich: ' + v); return v; }
  function reqBool(path, v){ if (typeof v !== 'boolean') throw new Error('E2E snapshot: ' + path + ' nicht boolean: ' + v); return v; }
  function reqLen(path, arr, n){ if (!Array.isArray(arr) || arr.length !== n) throw new Error('E2E snapshot: ' + path + ' Laenge=' + (Array.isArray(arr)?arr.length:'kein Array') + ' erwartet=' + n); return arr; }
  return {
    ready: true,
    // ── Drivers: each calls the REAL production function, nothing more. ──
    hostFFA: function(win){ mode='ffa'; fmt='ffa'; winTarget=(win===5?5:3); createRoom(); },
    joinFFA: function(code){ mode='ffa'; var el=$('onInput'); if(el) el.value=code; joinRoom(); },
    start: function(){ startFfaMatch(); },
    leave: function(){ leaveOnline(); },
    // Legal zero-power move through the real commit()/sanitizeMove()/write-once path
    // (mirror of the #actBtn no-drag commit in index.html).
    commitReady: function(){ commit((online?myPlayer:0), ownIdx(online?myPlayer:0), 0, 0, 0); },
    // Legal small NON-zero move through the exact same real path (magnitude is
    // clamped by sanitizeMove()); never writes state directly.
    commitMove: function(dx,dy,sp){ var who=(online?myPlayer:0); commit(who, ownIdx(who), dx, dy, sp||0); },
    // ── Read-only serialization of existing state. Never mutates, never invents. ──
    // AUTH_FIELDS (roomCode*, gen, turnNo, phase, seats, seatGone, scores,
    // aliveCounts, winner, balls) plus commitIdx/commitAim/commitSpin (used by the
    // own-commit-vs-authority proof) are read STRICTLY: no g()/catch-to-null, no
    // coercion, no invented defaults/sentinels. A read/shape error throws with the
    // exact field path and value, rejecting page.evaluate() and failing the run —
    // it can never silently converge as a false-green null/[] match across
    // clients. Local-only view state (myPlayer, color, palette, online,
    // gameStarted, fmt, mode, runningGen, aimSet, seatLeft, reveal, terminated) is
    // not AUTH-compared and stays behind the tolerant g()/boolArr() readers.
    // *roomCode is intentionally read via g(): it is legitimately null/'' before
    // a room is created/joined (callers poll for it), never compared while null.
    snapshot: function(){
      var seatCount = np(); // production seat count — authoritative expected array length
      // score/commitIdx/commitAim/commitSpin are only guaranteed dense at length
      // seatCount from the moment resetCommits()/newGame() ran for THIS match
      // (i.e. once gameStarted is true) — before that (lobby / room setup), they
      // may still hold a differently-sized array from a prior local/bot game while
      // np() already reflects the new mode. That is expected, not an error: no
      // caller compares these fields before gameStarted, so pre-match reads stay
      // permissive; from gameStarted onward they are enforced strictly.
      var live = !!gameStarted;
      return {
        roomCode:    g(function(){return roomCode;}),
        myPlayer:    g(function(){return myPlayer;}),
        color:       g(function(){return (PCOLS && myPlayer!=null && PCOLS[myPlayer]) ? PCOLS[myPlayer].ui : null;}),
        palette:     g(function(){ var o=[]; if(typeof PCOLS!=='undefined'&&PCOLS){ for(var i=0;i<5;i++) o.push(PCOLS[i]?PCOLS[i].ui:null); } return o; }),
        online:      g(function(){return online;}),
        gameStarted: g(function(){return gameStarted;}),
        fmt:         g(function(){return fmt;}),
        mode:        g(function(){return mode;}),
        seats:       seatCount,
        gen:         reqInt('gen', gen),
        runningGen:  g(function(){return runningGen;}),
        turnNo:      reqInt('turnNo', turnNo),
        phase:       (function(){ if (typeof phase !== 'string' || !phase) throw new Error('E2E snapshot: phase ungueltig: ' + phase); return phase; })(),
        winner:      (function(){
          var w = reqInt('winner', roundWinner);
          if (w !== -1 && (w < 0 || w >= seatCount)) throw new Error('E2E snapshot: winner ausserhalb Seatbereich: ' + w + ' (seats=' + seatCount + ')');
          return w;
        })(),
        scores:      live ? (function(){
          reqLen('scores', score, seatCount);
          return score.map(function(v,i){
            var n = reqInt('scores[' + i + ']', v);
            if (n < 0) throw new Error('E2E snapshot: scores[' + i + '] negativ: ' + n);
            return n;
          });
        })() : g(function(){ return Array.isArray(score) ? score.slice() : []; }),
        aimSet:      boolArr(g(function(){return aimSet;})),
        // seatGone is a SPARSE production array (reset to [] on room join, only
        // ever given entries via seatGone[s]=true when a leave-sentinel is
        // detected — never pre-filled). Production itself treats a missing index
        // as "not gone" (falsy checks throughout index.html), so materializing
        // exactly seatCount booleans via direct indexed reads is a faithful,
        // exception-free densification — not an invented default masking an
        // error — and needs no gameStarted gate (indexing never throws).
        seatGone:    (function(){
          var out = [];
          for (var si = 0; si < seatCount; si++) out.push(!!seatGone[si]);
          return out;
        })(),
        seatLeft:    boolArr(g(function(){return seatLeft;})),
        commitIdx:   live ? (function(){
          reqLen('commitIdx', commitIdx, seatCount);
          return commitIdx.map(function(v,i){
            var n = reqInt('commitIdx[' + i + ']', v);
            if (n !== -1 && (n < 0 || n >= balls.length)) throw new Error('E2E snapshot: commitIdx[' + i + '] ausserhalb Ballbereich: ' + n + ' (balls=' + balls.length + ')');
            return n;
          });
        })() : g(function(){ return Array.isArray(commitIdx) ? commitIdx.slice() : []; }),
        // Bounds mirror the REAL production contract (sanitizeMove()'s magnitude
        // clamp via the actual maxPull() production function, called live here —
        // never a hardcoded/guessed constant, so it can never drift from prod).
        commitAim:   live ? (function(){
          reqLen('commitAim', commitAim, seatCount);
          var mp = maxPull();
          return commitAim.map(function(a,i){
            if (!a || typeof a !== 'object') throw new Error('E2E snapshot: commitAim[' + i + '] kein Objekt: ' + a);
            var dx = reqFinite('commitAim[' + i + '].dx', a.dx);
            var dy = reqFinite('commitAim[' + i + '].dy', a.dy);
            var len = Math.hypot(dx, dy);
            if (len > mp * (1 + 1e-9)) throw new Error('E2E snapshot: commitAim[' + i + '] Betrag ' + len + ' > maxPull() ' + mp);
            return { dx: r4(dx), dy: r4(dy) };
          });
        })() : g(function(){ return Array.isArray(commitAim) ? commitAim.slice() : []; }),
        // [-1,1] mirrors sanitizeMove()'s own Math.max(-1,Math.min(1,sp)) clamp.
        commitSpin:  live ? (function(){
          reqLen('commitSpin', commitSpin, seatCount);
          return commitSpin.map(function(v,i){
            var n = reqFinite('commitSpin[' + i + ']', v);
            if (n < -1 || n > 1) throw new Error('E2E snapshot: commitSpin[' + i + '] ausserhalb [-1,1]: ' + n);
            return r4(n);
          });
        })() : g(function(){ return Array.isArray(commitSpin) ? commitSpin.slice() : []; }),
        reveal:      g(function(){return phase==='reveal';}),
        terminated:  g(function(){return (typeof onlineTerminatedSession!=='undefined' && typeof onlineSessionId!=='undefined') ? (onlineTerminatedSession===onlineSessionId) : null;}),
        // Always exactly 5 by construction (independent of seatCount): every
        // possible seat slot 0..4 is probed, non-participating seats legitimately
        // report 0 (aliveCount() counts real balls only).
        aliveCounts: (function(){
          var a = [];
          for (var k=0;k<5;k++){
            var n = reqInt('aliveCounts[' + k + ']', aliveCount(k));
            if (n < 0) throw new Error('E2E snapshot: aliveCounts[' + k + '] negativ: ' + n);
            a.push(n);
          }
          return a;
        })(),
        // balls is a MANDATORY comparison field: a read/shape error must NOT silently
        // become null (two erroring clients would falsely "converge"). It is built
        // OUTSIDE g() so any exception rejects page.evaluate() and fails the run, and
        // every ball's numeric fields are finiteness-checked at the source before the
        // lossy r4() rounding could mask a NaN/Infinity. Every field's PRESENCE is
        // checked explicitly first — a missing 'spin' is a shape error and must fail,
        // never silently become 0.
        balls: (function(){
          if (typeof balls === 'undefined' || !Array.isArray(balls)) throw new Error('E2E snapshot: balls ist kein Array');
          if (balls.length < 1) throw new Error('E2E snapshot: balls ist leer');
          var REQ = ['owner','alive','x','y','vx','vy','spin'];
          return balls.map(function(b, i){
            if (!b || typeof b !== 'object') throw new Error('E2E snapshot: Ball ' + i + ' ist kein Objekt');
            for (var f=0; f<REQ.length; f++){
              if (!(REQ[f] in b)) throw new Error('E2E snapshot: Ball ' + i + ' Feld ' + REQ[f] + ' fehlt (Pfad balls[' + i + '].' + REQ[f] + ')');
            }
            if (typeof b.owner !== 'number' || !isFinite(b.owner) || Math.floor(b.owner) !== b.owner || b.owner < 0 || b.owner >= seatCount)
              throw new Error('E2E snapshot: Ball ' + i + ' owner ungueltig: ' + b.owner + ' (seats=' + seatCount + ')');
            if (typeof b.alive !== 'boolean') throw new Error('E2E snapshot: Ball ' + i + ' alive nicht boolean: ' + b.alive);
            var nums = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, spin: b.spin };
            for (var k in nums){ if (typeof nums[k] !== 'number' || !isFinite(nums[k])) throw new Error('E2E snapshot: Ball ' + i + ' Feld ' + k + ' nicht endlich: ' + nums[k]); }
            return { o: b.owner, a: b.alive, x: r4(b.x), y: r4(b.y), vx: r4(b.vx), vy: r4(b.vy), sp: r4(b.spin) };
          });
        })()
      };
    }
  };
})();
`;

// ── Structural, count-checked HTML transform (in memory only) ────────────────
function replaceOnce(src, find, repl, label, report) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`Injektionsmarker '${label}' erwartet genau 1x, gefunden ${n}x — Abbruch.`);
  report.push(`${label}: 1 Treffer`);
  return src.replace(find, repl);
}

function transformHtml(src) {
  const report = [];
  let out = src;

  out = replaceOnce(out,
    'import { getDatabase, ref, set, get, update, remove, onValue, onDisconnect, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";',
    'import { getDatabase, connectDatabaseEmulator, ref, set, get, update, remove, onValue, onDisconnect, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";',
    'db-import', report);

  out = replaceOnce(out,
    'databaseURL: "https://ringout-87fbb-default-rtdb.europe-west1.firebasedatabase.app",',
    `databaseURL: "https://${EMU_NS}.firebaseio.com",`,
    'databaseURL->demo', report);

  out = replaceOnce(out,
    'projectId: "ringout-87fbb",',
    `projectId: "${EMU_PROJECT}",`,
    'projectId->demo', report);

  out = replaceOnce(out,
    'const db = getDatabase(app);',
    `const db = getDatabase(app);\n    connectDatabaseEmulator(db, "${EMU_HOST}", ${EMU_PORT});\n    window.__E2E_EMULATOR = true;`,
    'emulator-connect', report);

  // Adapter is injected just before the game IIFE's closing token. Beyond the
  // count check, verify the structural context so a future edit that reshapes the
  // file cannot cause a silent mis-injection:
  //   • exactly three "\n})();" tokens (two earlier IIFEs + the game IIFE),
  //   • the last one is the final top-level construct (only whitespace after it),
  //   • a known game-scope symbol appears before it (we are past the game logic).
  const closeTok = '\n})();';
  const closeCount = out.split(closeTok).length - 1;
  if (closeCount !== 3) throw new Error(`IIFE-Close-Token '\\n})();' erwartet 3x, gefunden ${closeCount}x — Abbruch.`);
  const at = out.lastIndexOf(closeTok);
  const tail = out.slice(at + closeTok.length);
  if (tail.replace(/\s+/g, '').replace(/<\/script>|<\/body>|<\/html>/gi, '') !== '') {
    throw new Error('Adapter-Ziel: hinter dem letzten IIFE-Close steht unerwarteter Code — Abbruch (Strukturkontext verändert).');
  }
  if (out.lastIndexOf('function onlineSendCommit', at) < 0 || out.lastIndexOf('window.__FB_READY', at) < 0) {
    throw new Error('Adapter-Ziel: erwarteter Spiel-Scope-Kontext (onlineSendCommit / __FB_READY) fehlt vor dem Einfügepunkt — Abbruch.');
  }
  out = out.slice(0, at)
    + '\n\n/* ==== E2E TEST ADAPTER — nur testseitig ausgeliefert, index.html auf Platte unveraendert ==== */\n'
    + ADAPTER_SRC + out.slice(at);
  report.push('adapter: vor letztem IIFE-Close injiziert (Close-Token 3x + Strukturkontext verifiziert)');

  return { html: out, report };
}

// ── Port / process / polling helpers ─────────────────────────────────────────
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, EMU_HOST);
  });
}

function waitHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('Timeout beim Warten auf ' + url));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

async function poll(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('Timeout: ' + label);
    await sleep(200);
  }
}

// ── Static file server (index.html itself is served via page.route) ──────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream',
};
function startStaticServer() {
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const full = path.join(REPO_ROOT, rel);
      if (!full.startsWith(REPO_ROOT)) { res.writeHead(403).end(); return; }
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    } catch (_) { res.writeHead(500).end(); }
  });
  return new Promise((resolve) => {
    server.listen(0, EMU_HOST, () => resolve({ server, port: server.address().port }));
  });
}

// ── Per-run isolated temp directory (secure, link-checked) ───────────────────
// A fresh random run dir under tools/e2e/.tmp/. The parent chain is verified to
// contain no symlink/junction; the dir is created exclusively. Only this dir is
// ever removed at cleanup — the shared .tmp parent is never recursively wiped.
function assertNoLink(p, whatFor) {
  let st;
  try { st = fs.lstatSync(p); } catch (_) { return; } // not existing yet is fine
  if (st.isSymbolicLink()) throw new Error(`Sicherheit: ${whatFor} (${p}) ist ein Symlink/Junction — Abbruch.`);
}

function createRunDir() {
  assertNoLink(REPO_ROOT, 'Repo-Root');
  assertNoLink(E2E_DIR, 'tools/e2e');
  fs.mkdirSync(TMP_BASE, { recursive: true });
  assertNoLink(TMP_BASE, 'tools/e2e/.tmp');
  const runDir = path.join(TMP_BASE, 'run-' + crypto.randomBytes(9).toString('hex'));
  fs.mkdirSync(runDir); // no recursive → fails if it somehow exists (unique id)
  assertNoLink(runDir, 'Run-Verzeichnis');
  return runDir;
}

// ── SHA-256-verified, exclusive temp rules copy (no symlink, no hardlink) ─────
function prepareTempRules(runDir) {
  const dst = path.join(runDir, 'firebase.rules.json');
  const srcBuf = fs.readFileSync(ROOT_RULES);
  const srcHash = sha256(srcBuf);
  const fd = fs.openSync(dst, 'wx'); // exclusive create: never overwrite an existing target
  try { fs.writeFileSync(fd, srcBuf); } finally { fs.closeSync(fd); }

  const lst = fs.lstatSync(dst);
  if (lst.isSymbolicLink()) throw new Error('Rules-Kopie ist ein Symlink — Abbruch.');
  const st = fs.statSync(dst);
  if (!st.isFile()) throw new Error('Rules-Kopie ist keine reguläre Datei — Abbruch.');
  if (st.nlink !== 1) throw new Error(`Rules-Kopie hat ${st.nlink} Hardlinks (erwartet 1) — Abbruch.`);
  if (fs.realpathSync(dst) === fs.realpathSync(ROOT_RULES)) throw new Error('Rules-Kopie zeigt auf denselben Real-Pfad wie die Root-Rules — Abbruch.');
  if (sha256(fs.readFileSync(dst)) !== srcHash) throw new Error('SHA-256 der Rules-Kopie weicht ab — Abbruch.');
  return srcHash;
}

// Pre-existing repo-root debug logs are NEVER touched — only reported.
function preexistingRootLogs() {
  return ROOT_LOG_NAMES.filter((n) => fs.existsSync(path.join(REPO_ROOT, n)));
}

// ── Firebase RTDB emulator (JDK 21, process-local, no shell) ─────────────────
// Resolve the firebase-tools JS entry so we can spawn it via `node <entry>` with
// an explicit argument list — no shell:true (avoids Node DEP0190 and the .cmd
// argument-injection surface). cwd is the per-run dir so all *-debug.log files
// the emulator writes land there and are removed with the run dir.
function resolveFirebaseEntry() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
  ];
  for (const c of candidates) { if (c && fs.existsSync(c)) return c; }
  return null;
}

function startEmulator(runDir) {
  const fbjson = path.join(runDir, 'firebase.json');
  fs.writeFileSync(fbjson, JSON.stringify({
    database: { rules: 'firebase.rules.json' },
    emulators: { singleProjectMode: true, database: { host: EMU_HOST, port: EMU_PORT }, ui: { enabled: false } },
  }, null, 2));

  const env = Object.assign({}, process.env, {
    JAVA_HOME: JDK21_HOME,
    PATH: path.join(JDK21_HOME, 'bin') + path.delimiter + process.env.PATH,
  });
  const args = ['emulators:start', '--only', 'database', '--project', EMU_PROJECT];
  const entry = resolveFirebaseEntry();
  let child;
  if (entry) {
    child = spawn(process.execPath, [entry, ...args], { cwd: runDir, env });
  } else {
    // Fallback only if the JS entry cannot be located: shell resolves firebase.cmd.
    warn('firebase-tools JS-Entry nicht gefunden — Fallback über shell:true.');
    child = spawn('firebase', args, { cwd: runDir, env, shell: true });
  }

  let out = '';
  if (child.stdout) child.stdout.on('data', (d) => { out += d; });
  if (child.stderr) child.stderr.on('data', (d) => { out += d; });

  // Track the child's own exit/close so cleanup can positively confirm it ended,
  // rather than inferring termination from free ports alone.
  let exited = false, exitInfo = null;
  child.on('exit', (code, signal) => { exited = true; exitInfo = { code, signal }; });
  const waitExit = (ms) => new Promise((res) => {
    if (exited) return res(true);
    const to = setTimeout(() => res(false), ms);
    child.once('exit', () => { clearTimeout(to); res(true); });
  });

  return { child, getOutput: () => out, hasExited: () => exited, exitInfo: () => exitInfo, waitExit };
}

// Kill ONLY our own emulator PID and its tree. taskkill is an .exe (no shell).
// Returns a structured result so cleanup can evaluate the exit code: 0 = killed,
// 128 (or an explicit "not found") = the process had already ended → still a
// success. Any other outcome is a genuine cleanup failure.
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve({ ok: true, code: null, alreadyGone: true, out: '' });
    let out = '';
    const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F']);
    if (k.stdout) k.stdout.on('data', (d) => { out += d; });
    if (k.stderr) k.stderr.on('data', (d) => { out += d; });
    k.on('close', (code) => {
      const alreadyGone = code === 128 || /not found|nicht gefunden|not running|kann nicht/i.test(out);
      resolve({ ok: code === 0 || alreadyGone, code, alreadyGone, out: out.trim() });
    });
    k.on('error', (e) => resolve({ ok: false, code: null, alreadyGone: false, out: 'taskkill-Fehler: ' + e.message }));
  });
}

// Existence check for our OWN PID only (never enumerates or touches foreign
// processes). Signal 0 does not affect the target: ESRCH → gone, EPERM → still
// alive but not signalable by us (treated conservatively as running).
function pidRunning(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

// ── Playwright context wiring: doc transform + hard production block ──────────
// Registers BOTH the HTTP route (fetch/xhr/eventsource/long-poll/document) and
// the WebSocket route, and awaits both, so no transport can leave the machine
// before protection is active. Callers MUST await this before newPage()/goto().
async function armContext(context, label, state) {
  // 1) HTTP / fetch / XHR / EventSource / long-polling + the main document.
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    let host, pathname;
    try { const u = new URL(url); host = u.hostname; pathname = u.pathname; } catch (_) { host = ''; pathname = ''; }

    if (req.resourceType() === 'document' && pathname === '/index.html') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: state.transformedHtml });
    }
    if (isProdHost(host)) {                       // fail-closed: production Firebase over HTTP
      state.prodHits.push({ ctx: label, transport: 'http', restype: req.resourceType(), url });
      return route.abort('blockedbyclient');
    }
    if (ALLOW_HOSTS.has(host)) return route.continue();
    state.otherBlocked.push({ ctx: label, transport: 'http', host, url });
    return route.abort('blockedbyclient');
  });

  // 2) WebSocket transport (the Firebase RTDB SDK's default channel). Local
  //    loopback is proxied to the real emulator; production is fail-closed
  //    (never connected to server); anything else is blocked.
  await context.routeWebSocket(/.*/, (ws) => {
    const url = ws.url();
    let host; try { host = new URL(url).hostname; } catch (_) { host = ''; }
    if (isProdHost(host)) {
      state.wsProdHits.push({ ctx: label, transport: 'ws', url });
      ws.close();                                 // fail-closed: no connectToServer()
      return;
    }
    if (isLocalHost(host)) { ws.connectToServer(); return; } // transparent proxy to emulator
    state.wsOtherBlocked.push({ ctx: label, transport: 'ws', host, url });
    ws.close();
  });
}

function wireDiagnostics(page, label, diag) {
  const push = (o) => diag.push(Object.assign({ ctx: label, ts: Date.now() }, o));
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') push({ kind: 'console.error', text: m.text() });
    else if (t === 'warning') push({ kind: 'console.warn', text: m.text() });
  });
  page.on('pageerror', (e) => push({ kind: 'pageerror', text: String(e && e.message || e) }));
  page.on('requestfailed', (r) => {
    const u = r.url();
    let host; try { host = new URL(u).hostname; } catch (_) { host = ''; }
    // Do not note failures we deliberately cause (production block).
    if (!isProdHost(host)) push({ kind: 'requestfailed', text: u + ' :: ' + (r.failure() && r.failure().errorText) });
  });
}

// Read any RTDB path authoritatively through a client's own window.FB (read-only).
async function dbRead(page, relPath) {
  return page.evaluate(async (p) => {
    const snap = await window.FB.get(window.FB.ref(window.FB.db, p));
    return snap.val();
  }, relPath);
}

// ── Leave-window bookkeeping (scopes the benign permission_denied allowlist) ──
function beginLeaveWindow(state, code) {
  const w = { code, start: Date.now(), end: null };
  (state.leaveWindows || (state.leaveWindows = [])).push(w);
  return w;
}
function endLeaveWindow(w) { if (w) w.end = Date.now() + LEAVE_WINDOW_GRACE_MS; }
async function registerLeave(state, code, fn) {
  const w = beginLeaveWindow(state, code);
  try { return await fn(); } finally { endLeaveWindow(w); }
}

// ── Two negative production-block probes (HTTP + WebSocket) ───────────────────
// Both must be caught by our own protection without any real connection. Each
// probe carries a UNIQUE, single-use id in its production URL. Afterwards we
// separate out ONLY the exact expected probe hit (exact URL + exactly one match)
// — never by a general production-host substring, so a real concurrent production
// leak can never be masked by the probe filter. If a probe produced zero or more
// than one matching hit, the probe FAILS. Every remaining prodHit/wsProdHit stays
// in the tallies and fails the run.
function separateExactHit(hits, url) {
  const matches = hits.filter((h) => h.url === url);
  const remaining = hits.filter((h) => h.url !== url);
  return { matches, remaining };
}

async function runNegativeProbes({ browser, navUrl, state, diag }) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const probeId = 'e2e-neg-probe-' + crypto.randomBytes(6).toString('hex');
  let page;
  try {
    await armContext(context, 'probe', state);
    page = await context.newPage();
    wireDiagnostics(page, 'probe', diag);
    await page.goto(navUrl, { waitUntil: 'domcontentloaded' });

    const base = 'ringout-87fbb-default-rtdb.europe-west1.firebasedatabase.app';
    const httpUrl = `https://${base}/probe-${probeId}.json`;
    const httpRes = await page.evaluate((u) => fetch(u).then(() => 'connected').catch(() => 'blocked'), httpUrl);

    const wsUrl = `wss://${base}/.ws?v=5&ns=ringout-87fbb-default-rtdb&probe=${probeId}`;
    const wsRes = await page.evaluate((u) => new Promise((res) => {
      let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
      try {
        const w = new WebSocket(u);
        w.onopen = () => { fin('connected'); try { w.close(); } catch (_) {} };
        w.onerror = () => fin('blocked');
        w.onclose = () => fin('blocked');
      } catch (_) { fin('blocked'); }
      setTimeout(() => fin('timeout'), 5000);
    }), wsUrl);

    // Separate ONLY the exact expected probe hit for each transport.
    const httpSep = separateExactHit(state.prodHits, httpUrl);
    const wsSep = separateExactHit(state.wsProdHits, wsUrl);
    state.prodHits = httpSep.remaining;
    state.wsProdHits = wsSep.remaining;

    const httpBlocked = httpRes === 'blocked' && httpSep.matches.length === 1;
    const wsBlocked = wsRes !== 'connected' && wsSep.matches.length === 1;

    if (!httpBlocked) {
      throw new Error(`Negative HTTP-Probe nicht eindeutig blockiert (res=${httpRes}, exakte Probe-Treffer=${httpSep.matches.length}).`);
    }
    if (!wsBlocked) {
      throw new Error(`Negative WebSocket-Probe nicht eindeutig blockiert (res=${wsRes}, exakte Probe-Treffer=${wsSep.matches.length}).`);
    }
    return {
      probeId,
      http: { url: httpUrl, result: httpRes, expectedProbeHits: httpSep.matches.length, blocked: true, remainingRealProdHits: state.prodHits.length },
      ws: { url: wsUrl, result: wsRes, expectedProbeHits: wsSep.matches.length, blocked: true, remainingRealWsProdHits: state.wsProdHits.length },
    };
  } finally {
    try { await context.close(); } catch (_) {}
  }
}

// ── Cleanup (awaited, error-effective; only own resources are touched) ────────
// cleanupOk is true only when there are no cleanup notes, every own port is free,
// and the run dir is gone. The original test outcome is never overwritten here —
// the launcher reports both the run result and this cleanup result.
async function cleanup({ browser, staticServer, emu, runDir, closeErrors, preexistingLogs }) {
  const notes = [];
  try { if (browser) await browser.close(); } catch (e) { notes.push('browser: ' + e.message); }
  if (staticServer && staticServer.server) {
    try { await new Promise((res, rej) => staticServer.server.close((err) => err ? rej(err) : res())); }
    catch (e) { notes.push('server-close: ' + e.message); }
  }
  // Terminate ONLY our own emulator tree and positively verify it ended. Before
  // ever calling taskkill, check the child's OWN observed exit status
  // (emu.hasExited(), backed by the 'exit' event) — if it already terminated by
  // itself, taskkill is never invoked against that PID: by the time cleanup runs
  // the OS may have reused the number for an unrelated process, and taskkill has
  // no way to tell the difference. A second, immediate hasExited() check runs
  // right before the taskkill call itself to shrink the remaining TOCTOU window.
  // pidRunning() is only consulted after we ourselves invoked taskkill (to verify
  // taskkill's own effect) — never in the self-exited branch, where a positive
  // hit would only reflect the same PID-reuse ambiguity, not our own process.
  let procResult = null;
  if (emu && emu.child) {
    const pid = emu.child.pid;
    const alreadyExitedSelf = emu.hasExited ? emu.hasExited() : false;
    if (alreadyExitedSelf) {
      procResult = { pid, killCode: null, killOk: true, alreadyGone: true, selfExited: true, killedViaTaskkill: false, childExited: true, stillRunning: null };
    } else {
      const stillAliveJustBefore = emu.hasExited ? !emu.hasExited() : true; // second, last-moment check
      let kr;
      if (!stillAliveJustBefore) {
        kr = { ok: true, code: null, alreadyGone: true, out: '(Zweitpruefung unmittelbar vor taskkill: Child bereits beendet — taskkill uebersprungen)' };
      } else {
        try { kr = await killTree(pid); } catch (e) { kr = { ok: false, code: null, alreadyGone: false, out: 'killTree-Ausnahme: ' + e.message }; }
      }
      if (!kr.ok) notes.push(`emu-kill: taskkill code=${kr.code} out=${kr.out}`);
      const childExited = emu.waitExit ? await emu.waitExit(8000) : null;
      if (childExited === false) notes.push('emu-child: eigener Prozess hat sich nicht innerhalb 8s beendet');
      await sleep(1500); // let the emulator release its ports
      const stillRunning = pidRunning(pid);
      if (stillRunning) notes.push(`emu-pid: eigene PID ${pid} laeuft nach Cleanup weiter`);
      procResult = { pid, killCode: kr.code, killOk: kr.ok, alreadyGone: kr.alreadyGone, selfExited: false, killedViaTaskkill: stillAliveJustBefore, childExited, stillRunning };
    }
  } else {
    await sleep(1500);
  }

  // Remove ONLY our own run dir (with its exclusive rules copy, firebase.json and
  // any *-debug.log the emulator wrote there). The shared .tmp parent is untouched.
  try { if (runDir && fs.existsSync(runDir)) fs.rmSync(runDir, { recursive: true, force: true }); }
  catch (e) { notes.push('runDir-rm: ' + e.message); }

  // Surface (never swallow) any close/leave errors collected during scenarios.
  if (Array.isArray(closeErrors)) for (const e of closeErrors) notes.push('scenario-close: ' + e);

  // Report — but never delete — any root debug log that newly appeared (should be
  // none, since the emulator's cwd is the run dir). Pre-existing ones are ignored.
  const pre = preexistingLogs || [];
  const strayLogs = ROOT_LOG_NAMES.filter((n) => fs.existsSync(path.join(REPO_ROOT, n)) && !pre.includes(n));
  for (const n of strayLogs) notes.push('unerwartetes Root-Log (nicht gelöscht): ' + n);

  const portsFree = {};
  for (const p of [EMU_PORT, ...EMU_AUX_PORTS]) portsFree[p] = await portFree(p);
  if (staticServer && staticServer.port) portsFree[staticServer.port] = await portFree(staticServer.port);

  const runGone = !runDir || !fs.existsSync(runDir);
  // cleanupOk requires: no cleanup notes (which already capture kill failure, a
  // child that never exited, and a PID still running), the run dir gone, and every
  // OWN port free. Foreign processes/ports are never inspected.
  const cleanupOk = notes.length === 0 && runGone && Object.values(portsFree).every(Boolean);
  return { notes, portsFree, runGone, strayLogs, process: procResult, cleanupOk };
}

module.exports = {
  // constants
  REPO_ROOT, INDEX_HTML, ROOT_RULES, TMP_BASE,
  EMU_HOST, EMU_PORT, EMU_AUX_PORTS, EMU_PROJECT, EMU_NS, JDK21_HOME,
  ALLOW_HOSTS, PROD_HINT, CHROMIUM_E2E_ARGS, ADAPTER_SRC, BENIGN_PERMISSION_DENIED_RE,
  // helpers
  log, warn, ok, sleep, isBenignDiag, selfTestBenignMatcher, isProdHost, isLocalHost,
  transformHtml, portFree, waitHttp, poll, startStaticServer,
  createRunDir, prepareTempRules, preexistingRootLogs,
  startEmulator, resolveFirebaseEntry, killTree, pidRunning,
  armContext, wireDiagnostics, dbRead,
  beginLeaveWindow, endLeaveWindow, registerLeave, runNegativeProbes, cleanup,
};
