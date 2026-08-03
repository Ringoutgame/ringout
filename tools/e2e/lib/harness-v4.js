// ─────────────────────────────────────────────────────────────────────────────
// RingOut — E2E harness core, v4 (server-owned lifecycle + action clock)
//
// Warum eine eigene Datei neben lib/harness.js:
// Der v3-E2E (run-ffa-e2e.js) beweist den BESTEHENDEN Produktionspfad und muss
// unveraendert gruen bleiben — er startet nur den RTDB-Emulator und kennt weder
// Auth noch Callables. Diese Datei ergaenzt genau das, was v4 zusaetzlich
// braucht, und laesst lib/harness.js unangetastet:
//
//   - Emulator-Trio database + auth + functions statt nur database
//   - echte Anonymous Auth im Browser (connectAuthEmulator), keine Fake-JWTs:
//     der Client holt eine echte Emulator-UID, und die Functions-Runtime
//     verifiziert exakt dieses Token gegen denselben Auth-Emulator
//   - Emulator-Verdrahtung der Callables im ausgelieferten HTML
//   - Lesehelfer auf den Raum-Subtree fuer die Assertions
//
// Alles andere (Produktions-Firebase-Block, statischer Server, Run-Verzeichnis,
// verifizierte Rules-Kopie, Diagnose-Verdrahtung, Cleanup) kommt unveraendert
// aus lib/harness.js — es gibt keine zweite Implementierung dieser Teile.
//
// Diese Datei veraendert index.html und firebase.rules.json NIE auf Platte.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const H = require('./harness');

// ── Feste lokale Konfiguration (eigene Ports: der v3-E2E darf parallel laufen) ─
const EMU_HOST     = '127.0.0.1';
const DB_PORT      = 9010;
const AUTH_PORT    = 9109;
const FN_PORT      = 5011;
const HUB_PORT     = 4410;
const LOG_PORT     = 4510;
const EMU_PROJECT  = 'demo-ringout-v4e2e';
// WICHTIG: kein '-default-rtdb'-Suffix. Die Functions-Runtime loest ihren
// Default-Namespace unter dem Emulator als reine Projekt-ID auf (derselbe Befund
// steht in tools/test_room_lifecycle.js). Browser-Client und Arbiter muessen
// zwingend denselben Namespace benutzen — sonst schreibt der Server in einen
// Datenbestand, den der Client nie sieht, und der Beweis waere wertlos.
const EMU_NS       = EMU_PROJECT;
const FN_REGION    = 'europe-west1';
// Alle Ports, die dieser Lauf belegt — Vorabpruefung und Cleanup pruefen sie.
const ALL_PORTS    = [DB_PORT, AUTH_PORT, FN_PORT, HUB_PORT, LOG_PORT];

// Die sechs Room- und drei Clock-Callables. Der Bereitschafts-Check probt sie
// namentlich: fehlt eine, startet der Lauf gar nicht erst.
const CALLABLES = [
  'roomCreateV4', 'roomJoinV4', 'roomActivateV4', 'roomLeaveV4', 'roomStartV4', 'roomRematchV4',
  'clockStart', 'clockClose', 'clockSettle',
];

// ── Emulator-Trio starten ────────────────────────────────────────────────────
// functions.source zeigt auf das ECHTE functions/-Verzeichnis des Repos: der
// Emulator laedt exakt functions/index.js mit den produktiven Wrappern, nicht
// eine Kopie, die auseinanderlaufen koennte.
function startEmulatorV4(runDir) {
  const fnSource = path.relative(runDir, path.join(H.REPO_ROOT, 'functions')).split(path.sep).join('/');
  fs.writeFileSync(path.join(runDir, 'firebase.json'), JSON.stringify({
    // Die RTDB-Instanz wird NAMENTLICH deklariert, damit der Emulator die echten
    // Rules genau in den Namespace laedt, den auch die Functions-Runtime
    // benutzt. Ohne diese Deklaration legt der Emulator einen Nicht-Default-
    // Namespace mit OFFENEN Rules an — jeder Sicherheits-Assert dieses Laufs
    // waere dann falsch-gruen. Der Rules-Canary in waitReadyV4 prueft das.
    database: [{ instance: EMU_PROJECT, rules: 'firebase.rules.json' }],
    functions: { source: fnSource },
    emulators: {
      singleProjectMode: true,
      database:  { host: EMU_HOST, port: DB_PORT },
      auth:      { host: EMU_HOST, port: AUTH_PORT },
      functions: { host: EMU_HOST, port: FN_PORT },
      hub:       { host: EMU_HOST, port: HUB_PORT },
      logging:   { host: EMU_HOST, port: LOG_PORT },
      ui:        { enabled: false },
    },
  }, null, 2));

  const env = Object.assign({}, process.env, {
    JAVA_HOME: H.JDK21_HOME,
    PATH: path.join(H.JDK21_HOME, 'bin') + path.delimiter + process.env.PATH,
    // Die Functions-Runtime verifiziert ID-Tokens gegen GENAU diesen laufenden
    // Auth-Emulator — dieselbe Instanz, an der sich der Browser anonym anmeldet.
    // Es gibt in diesem Lauf keine Fake-JWTs: die UID im Callable stammt aus
    // einer echten signInAnonymously-Session des echten Clients.
    FIREBASE_AUTH_EMULATOR_HOST: EMU_HOST + ':' + AUTH_PORT,
  });

  const args = ['emulators:start', '--only', 'database,auth,functions', '--project', EMU_PROJECT];
  const entry = H.resolveFirebaseEntry();
  let child;
  if (entry) {
    child = spawn(process.execPath, [entry, ...args], { cwd: runDir, env });
  } else {
    H.warn('firebase-tools JS-Entry nicht gefunden — Fallback über shell:true.');
    child = spawn('firebase', args, { cwd: runDir, env, shell: true });
  }

  let out = '';
  if (child.stdout) child.stdout.on('data', (d) => { out += d; });
  if (child.stderr) child.stderr.on('data', (d) => { out += d; });

  let exited = false, exitInfo = null;
  child.on('exit', (code, signal) => { exited = true; exitInfo = { code, signal }; });
  const waitExit = (ms) => new Promise((res) => {
    if (exited) return res(true);
    const to = setTimeout(() => res(false), ms);
    child.once('exit', () => { clearTimeout(to); res(true); });
  });

  return { child, getOutput: () => out, hasExited: () => exited, exitInfo: () => exitInfo, waitExit };
}

// ── Bereitschaft: Banner -> Rules-Canary -> alle neun Callables ──────────────
// Der Rules-Canary ist kein Komfort-Check: laeuft der Emulator versehentlich mit
// offenen Rules, wuerde jeder Sicherheits-Assert dieses Laufs falsch-gruen. Der
// Lauf bricht dann hart ab, statt etwas zu "bestehen".
async function waitReadyV4(emu, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !/All emulators ready/.test(emu.getOutput())) {
    if (/Emulator has exited|Error: Could not start|address already in use/i.test(emu.getOutput()))
      return { ok: false, why: 'Emulator-Start fehlgeschlagen' };
    await H.sleep(250);
  }
  if (!/All emulators ready/.test(emu.getOutput())) return { ok: false, why: 'Ready-Banner nicht erschienen' };

  let canary = false;
  while (Date.now() < until && !canary) {
    try {
      const res = await fetch(`http://${EMU_HOST}:${DB_PORT}/reqs/canary/x.json?ns=${EMU_NS}`, {
        method: 'PUT', body: '{"sig":"x"}', headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) { canary = true; break; }
      if (res.ok) return { ok: false, why: 'Rules NICHT geladen (Canary-Write ging durch)' };
    } catch (e) { /* noch nicht bereit */ }
    await H.sleep(250);
  }
  if (!canary) return { ok: false, why: 'Rules-Canary nicht bestaetigt' };

  for (const name of CALLABLES) {
    let seen = false;
    while (Date.now() < until && !seen) {
      try {
        const res = await fetch(`http://${EMU_HOST}:${FN_PORT}/${EMU_PROJECT}/${FN_REGION}/${name}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}',
        });
        const body = await res.json().catch(() => ({}));
        // Ohne Auth MUSS jede Callable mit UNAUTHENTICATED antworten — das
        // beweist zugleich Erreichbarkeit UND die Auth-Pflicht des Wrappers.
        if (res.status === 401 && body.error && body.error.status === 'UNAUTHENTICATED') { seen = true; break; }
      } catch (e) { /* Functions noch nicht bereit */ }
      await H.sleep(250);
    }
    if (!seen) return { ok: false, why: 'Callable nicht bereit/ohne Auth-Pflicht: ' + name };
  }
  return { ok: true };
}

// ── HTML-Transform: db + auth + functions auf die Emulatoren ──────────────────
// Strukturell und zaehlgeprueft wie in lib/harness.js. Zwei Marker sind bewusst
// OPTIONAL: der Functions-Import und der Callable-Endpunkt existieren im v3-
// Client noch nicht. Fehlen sie, wird das im Report vermerkt und der Lauf
// laeuft weiter — genau so entsteht der dokumentierte rote Ausgangszustand von
// Etappe C1, ohne dass der Transform selbst scheitert.
function replaceOnce(src, find, repl, label, report) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`Injektionsmarker '${label}' erwartet genau 1x, gefunden ${n}x — Abbruch.`);
  report.push(`${label}: 1 Treffer`);
  return src.replace(find, repl);
}
function replaceOptional(src, find, repl, label, report) {
  const n = src.split(find).length - 1;
  if (n === 0) { report.push(`${label}: 0 Treffer (v3-Client — erwartet vor der Migration)`); return { out: src, hit: false }; }
  if (n !== 1) throw new Error(`Injektionsmarker '${label}' erwartet 0x oder 1x, gefunden ${n}x — Abbruch.`);
  report.push(`${label}: 1 Treffer`);
  return { out: src.replace(find, repl), hit: true };
}

function transformHtmlV4(src) {
  const report = [];
  let out = src;
  const present = { functionsImport: false, functionsConnect: false };

  // 1) Datenbank auf den Emulator.
  out = replaceOnce(out,
    'import { getDatabase, ref, set, get, update, remove, onValue, onDisconnect, serverTimestamp, runTransaction, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";',
    'import { getDatabase, connectDatabaseEmulator, ref, set, get, update, remove, onValue, onDisconnect, serverTimestamp, runTransaction, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";',
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
    `const db = getDatabase(app);\n    connectDatabaseEmulator(db, "${EMU_HOST}", ${DB_PORT});\n    window.__E2E_EMULATOR = true;`,
    'emulator-connect(db)', report);

  // 2) Anonymous Auth auf den Emulator. Der dynamische Import bleibt dynamisch
  //    (die Boot-Isolation ist genau dafuer da) — es wird ausschliesslich
  //    connectAuthEmulator VOR dem ersten Auth-Aufruf eingeschoben.
  out = replaceOnce(out,
    '      const auth = m.getAuth(app);',
    `      const auth = m.getAuth(app);\n      m.connectAuthEmulator(auth, "http://${EMU_HOST}:${AUTH_PORT}", { disableWarnings: true });`,
    'emulator-connect(auth)', report);

  // 3) Callables auf den Emulator — optional, s. o. Der Client laedt
  //    firebase-functions wie die Auth dynamisch; connectFunctionsEmulator wird
  //    unmittelbar nach getFunctions eingeschoben, also VOR dem ersten Aufruf.
  const fi = replaceOptional(out,
    'import("https://www.gstatic.com/firebasejs/12.15.0/firebase-functions.js")',
    'import("https://www.gstatic.com/firebasejs/12.15.0/firebase-functions.js")',
    'functions-import', report);
  out = fi.out; present.functionsImport = fi.hit;

  const fc = replaceOptional(out,
    '      const fns = m.getFunctions(app, FN_REGION);',
    `      const fns = m.getFunctions(app, FN_REGION);\n      m.connectFunctionsEmulator(fns, "${EMU_HOST}", ${FN_PORT});`,
    'emulator-connect(functions)', report);
  out = fc.out; present.functionsConnect = fc.hit;

  // 4) Test-Adapter vor den letzten IIFE-Close — identische Strukturpruefung wie
  //    im v3-Harness, zusaetzlich um die v4-Treiber erweitert.
  const closeTok = '\n})();';
  const closeCount = out.split(closeTok).length - 1;
  if (closeCount !== 3) throw new Error(`IIFE-Close-Token '\\n})();' erwartet 3x, gefunden ${closeCount}x — Abbruch.`);
  const at = out.lastIndexOf(closeTok);
  const tail = out.slice(at + closeTok.length);
  if (tail.replace(/\s+/g, '').replace(/<\/script>|<\/body>|<\/html>/gi, '') !== '') {
    throw new Error('Adapter-Ziel: hinter dem letzten IIFE-Close steht unerwarteter Code — Abbruch.');
  }
  if (out.lastIndexOf('function onlineSendCommit', at) < 0 || out.lastIndexOf('window.__FB_READY', at) < 0) {
    throw new Error('Adapter-Ziel: erwarteter Spiel-Scope-Kontext fehlt vor dem Einfügepunkt — Abbruch.');
  }
  out = out.slice(0, at)
    + '\n\n/* ==== E2E TEST ADAPTER v4 — nur testseitig ausgeliefert, index.html auf Platte unveraendert ==== */\n'
    + H.ADAPTER_SRC
    + ADAPTER_V4_SRC
    + out.slice(at);
  report.push('adapter(v3+v4): vor letztem IIFE-Close injiziert');

  return { html: out, report, present };
}

// ── v4-Treiber-Adapter ───────────────────────────────────────────────────────
// Ergaenzt window.__E2E um genau die Treiber, die der v3-Adapter nicht hat.
// Jeder ruft ausschliesslich die ECHTE Produktionsfunktion auf — kein Treiber
// schreibt Zustand, keiner umgeht den Client. Alle Lesefelder sind tolerant
// (der v3-Client kennt die v4-Globals noch nicht und muss hier `null` liefern
// duerfen, statt den ganzen Lauf mit einem ReferenceError abzubrechen).
const ADAPTER_V4_SRC = `
;(function(){
  var A = window.__ringoutE2E; if (!A) return;
  function g(fn){ try { var v = fn(); return v === undefined ? null : v; } catch(e){ return null; } }
  // ── Treiber ──
  A.hostDuel = function(fmtWanted, win){
    mode='online'; fmt=(fmtWanted==='double'?'double':'single'); winTarget=(win===5?5:3); createRoom();
  };
  A.joinDuel = function(code){
    mode='online'; var el=$('onInput'); if(el) el.value=code; joinRoom();
  };
  A.hostFmt = function(fmtWanted, win){
    mode='ffa'; fmt=fmtWanted; winTarget=(win===5?5:3); createRoom();
  };
  // Toleranter Kurzstatus. Der v3-Adapter-snapshot() validiert streng (und wirft
  // z. B., solange balls noch aus einer vorherigen Partie mit mehr Seats stammen)
  // — fuer "warte, bis der Raum steht" ist das der falsche Leser: dort darf ein
  // Zwischenzustand des Spielfelds den Lauf nicht abbrechen.
  A.room = function(){
    return {
      roomCode:    g(function(){ return roomCode || null; }),
      myPlayer:    g(function(){ return myPlayer; }),
      online:      g(function(){ return online; }),
      gameStarted: g(function(){ return gameStarted; }),
      gen:         g(function(){ return gen; }),
      turnNo:      g(function(){ return turnNo; }),
      phase:       g(function(){ return phase; })
    };
  };
  // Treibt den ECHTEN nameInput-Handler: Wert setzen und ein input-Event
  // feuern. Damit laeuft exakt der Produktionspfad (partieller Write auf
  // players/<seat>/name) gegen die echten Rules — kein Nachbau.
  A.typeName = function(v){
    var el = document.getElementById('nameInput');
    if (!el) return false;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  A.rematch = function(){ if (typeof onlineRematch==='function') onlineRematch(); };
  A.rejoin  = function(code){ if (typeof attemptRejoin==='function') return attemptRejoin(code); return null; };
  A.openOnline = function(){ if (typeof openOnline==='function') openOnline(); };
  // ── v4-Lesefelder (tolerant: v3-Client liefert ueberall null) ──
  A.v4 = function(){
    return {
      uid:      g(function(){ return window.__FB_UID || null; }),
      proto:    g(function(){ return ONLINE_PROTOCOL_VERSION; }),
      iid:      g(function(){ return onlineIid || null; }),
      session:  g(function(){ return onlineSession || null; }),
      // Serverseitige Uhr, wie der Client sie sieht. null = der Client fuehrt
      // keine live/clock-Sicht (v3-Zustand).
      clock:    g(function(){ return onlineClockState ? {
                  phase:      onlineClockState.phase,
                  turn:       onlineClockState.turn,
                  stage:      onlineClockState.stage,
                  remainingMs:onlineClockState.remainingMs,
                  cracked:    onlineClockState.cracked,
                  expired:    onlineClockState.expired,
                  deadlineAt: onlineClockState.deadlineAt,
                  phaseId:    onlineClockState.phaseId,
                  eligibleSeats: onlineClockState.eligibleSeats
                } : null; }),
      collapse: g(function(){ return typeof onlineCollapseCount==='function' ? onlineCollapseCount() : null; }),
      // Rest-v3-Uhr: MUSS nach der Migration verschwunden sein. Vorhandensein
      // ist selbst eine Assertion (Szenario "keine v3-Uhrreste").
      legacy: {
        stampOnlinePhase:   (typeof stampOnlinePhase   !== 'undefined'),
        onlineFold:         (typeof onlineFold         !== 'undefined'),
        onlineClock:        (typeof onlineClock        !== 'undefined'),
        onlineCollapseTurn: (typeof onlineCollapseTurn !== 'undefined'),
        onTurnStamp:        (typeof onTurnStamp        !== 'undefined'),
        onTurnTs:           (typeof onTurnTs           !== 'undefined'),
        onStampProbe:       (typeof onStampProbe       !== 'undefined'),
        writeLeaveSentinel: (typeof writeLeaveSentinel !== 'undefined'),
        claimSeat:          (typeof claimSeat          !== 'undefined')
      }
    };
  };
})();
`;

// ── Lesehelfer auf den Emulator-Datenbestand ─────────────────────────────────
// rooms/<code> ist per Rules oeffentlich lesbar — die Assertions brauchen daher
// kein Admin-Token und sehen exakt das, was auch ein Client saehe.
async function readPath(p) {
  const res = await fetch(`http://${EMU_HOST}:${DB_PORT}/${p}.json?ns=${EMU_NS}`);
  if (!res.ok) return { ok: false, http: res.status, val: null };
  const val = await res.json().catch(() => null);
  return { ok: true, http: res.status, val };
}
const readRoom  = (code)             => readPath('rooms/' + code);
const readClock = (code, gen)        => readPath(`rooms/${code}/g/${gen}/live/clock`);
const readSlots = (code, gen)        => readPath(`rooms/${code}/g/${gen}/live/slots`);
const readTurn  = (code, gen, turn)  => readPath(`rooms/${code}/g/${gen}/t/${turn}`);

// Wartet, bis `pick(val)` wahr wird — Polling auf dem echten Datenbestand, kein
// blindes sleep(). Gibt den letzten gelesenen Wert zurueck (auch im Timeout-
// Fall), damit die Assertion berichten kann, was tatsaechlich dastand.
async function until(readFn, pick, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await readFn();
    last = r && r.val;
    let hit = false;
    try { hit = !!pick(last); } catch (e) { hit = false; }
    if (hit) return { ok: true, val: last };
    await H.sleep(120);
  }
  return { ok: false, val: last, label: label || '' };
}

module.exports = {
  EMU_HOST, DB_PORT, AUTH_PORT, FN_PORT, HUB_PORT, LOG_PORT, ALL_PORTS,
  EMU_PROJECT, EMU_NS, FN_REGION, CALLABLES,
  startEmulatorV4, waitReadyV4, transformHtmlV4, ADAPTER_V4_SRC,
  readPath, readRoom, readClock, readSlots, readTurn, until,
};
