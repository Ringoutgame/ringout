// Action-Clock ARBITER — serverseitige Autoritaet gegen den ECHTEN RTDB-Emulator.
//
// Diese Suite treibt EXAKT den Produktions-Arbiter (functions/clock-core.js, per
// Dependency-Injection mit kontrollierter Zeit — keine Sleeps, keine Wanduhr im
// Kern) gegen einen frisch gestarteten RTDB-Emulator (JDK 21) mit den ECHTEN
// firebase.rules.json. Admin-SDK-Writes des Arbiters umgehen die Rules (wie in
// Produktion); zusaetzlich beweisen REST-Checks gegen den Emulator, dass Clients
// weder rooms/<code>/g/<gen>/live/clock noch seatByUid noch die v4-Historie
// t/<turn> beschreiben koennen und v4-Live-Slots auth-, index-, phasen- und
// eligibleSeats-gebunden sind.
//
// Datenmodell (Phase IIIA): der aktive Phasen-State liegt KONSTANT KLEIN unter
// rooms/<code>/g/<gen>/live ({clock, slots}); die Historie unter t/<turn> wird
// serverseitig idempotent archiviert (archived-Marker, Crash-Recovery ueber
// jeden weiteren clockClose-/clockSettle-Aufruf).
//
// NICHT im Standard-Runner (tools/run_all_tests.js): braucht JDK 21 + globales
// firebase-tools (wie tools/e2e/) — CI (GitHub Actions, reines Node 20) wuerde
// sonst rot. Aufruf: node tools/test_action_clock.js  (bzw. npm run test:arbiter)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO = path.dirname(__dirname);
const EMU_HOST = '127.0.0.1', EMU_PORT = 9700, HUB_PORT = 4701, LOG_PORT = 4702;
const PROJECT = 'demo-ringout-clock';
const NS = PROJECT + '-default-rtdb';

const core = require(path.join(REPO, 'functions', 'clock-core.js'));
const admin = require(path.join(REPO, 'functions', 'node_modules', 'firebase-admin'));

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// ── Java-Aufloesung: portabel statt fest verdrahtet. Reihenfolge JAVA_HOME →
//    java aus PATH → dokumentierter lokaler Fallback → verstaendlicher Fehler.
//    Kein stiller Skip: fehlt eine brauchbare JVM, endet der Lauf mit Exit 2. ──
const LOCAL_JDK_FALLBACKS = [
  // Dokumentierter Fallback der Windows-Entwicklungsmaschine dieses Projekts.
  'C:\\Program Files\\Microsoft\\jdk-21.0.11.10-hotspot',
];
const JAVA_BIN = process.platform === 'win32' ? 'java.exe' : 'java';
const javaExe = (home) => path.join(home, 'bin', JAVA_BIN);
function resolveJava() {
  const home = process.env.JAVA_HOME;
  if (home && fs.existsSync(javaExe(home))) return { home, bin: javaExe(home), src: 'JAVA_HOME' };
  const probe = spawnSync(JAVA_BIN, ['-version'], { encoding: 'utf8' });
  if (!probe.error) return { home: null, bin: JAVA_BIN, src: 'PATH' };
  for (const c of LOCAL_JDK_FALLBACKS) if (fs.existsSync(javaExe(c))) return { home: c, bin: javaExe(c), src: 'lokaler Fallback' };
  return null;
}
function javaMajor(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  const m = String((r.stderr || '') + (r.stdout || '')).match(/version "(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ── Emulator-Lifecycle (Muster aus tools/e2e/lib/harness.js: firebase-tools-JS-
//    Entry direkt via node, per-Run-Temp-Verzeichnis, taskkill /T) ──
function resolveFirebaseEntry() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}
function startEmulator(runDir, java) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'firebase.rules.json'), path.join(runDir, 'firebase.rules.json'));
  fs.writeFileSync(path.join(runDir, 'firebase.json'), JSON.stringify({
    database: { rules: 'firebase.rules.json' },
    emulators: {
      singleProjectMode: true,
      database: { host: EMU_HOST, port: EMU_PORT },
      hub: { host: EMU_HOST, port: HUB_PORT },
      logging: { host: EMU_HOST, port: LOG_PORT },
      ui: { enabled: false },
    },
  }, null, 2));
  const env = Object.assign({}, process.env);
  if (java.home) {
    env.JAVA_HOME = java.home;
    env.PATH = path.join(java.home, 'bin') + path.delimiter + process.env.PATH;
  }
  const entry = resolveFirebaseEntry();
  if (!entry) { console.error('FAIL: firebase-tools nicht gefunden (npm i -g firebase-tools).'); process.exit(2); }
  const child = spawn(process.execPath, [entry, 'emulators:start', '--only', 'database', '--project', PROJECT], { cwd: runDir, env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return { child, getOutput: () => out };
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitReady(emu, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://${EMU_HOST}:${EMU_PORT}/.json?ns=${NS}&access_token=owner`);
      if (res.ok || res.status === 401) return true;
    } catch (e) { /* noch nicht bereit */ }
    if (/Emulator has exited|Error:/.test(emu.getOutput())) return false;
    await pause(250);
  }
  return false;
}
function killTree(pid) {
  return new Promise((resolve) => {
    const k = process.platform === 'win32'
      ? spawn('taskkill', ['/PID', String(pid), '/T', '/F'])
      : spawn('kill', ['-9', String(pid)]);
    k.on('close', () => resolve());
    k.on('error', () => resolve());
  });
}

// ── REST-Helfer: Client-Sicht gegen die ECHTEN Rules im Emulator.
//    Der Emulator prueft JWT-Claims ohne Signaturpruefung — ein lokal erzeugtes
//    HS256-Token mit beliebigem Secret simuliert damit einen Anonymous-Auth-User. ──
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function fakeJwt(uid) {
  const header = b64u({ alg: 'HS256', typ: 'JWT' });
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64u({
    iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT,
    iat, exp: iat + 3600, auth_time: iat,
    sub: uid, user_id: uid, uid, firebase: { sign_in_provider: 'anonymous', identities: {} },
  });
  const sig = crypto.createHmac('sha256', 'emulator-secret').update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}
async function restPut(p, value, uid) {
  const auth = uid ? '&auth=' + encodeURIComponent(fakeJwt(uid)) : '';
  const res = await fetch(`http://${EMU_HOST}:${EMU_PORT}/${p}.json?ns=${NS}${auth}`, {
    method: 'PUT', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' },
  });
  return res.ok;
}

// ── Fixtures ──
const UID = ['uid-seat0-00001', 'uid-seat1-00001', 'uid-seat2-00001', 'uid-seat3-00001', 'uid-seat4-00001'];
const TAB = ['TAB00000', 'TAB00001', 'TAB00002', 'TAB00003', 'TAB00004'];
const UX = 'uid-fremd-00001';
const BASE = 1751900000000;
// n besetzte Seats, alle online, KONSISTENTER seatByUid-Index (in Produktion
// server-owned, hier via Admin-SDK geseedet). seats-Feld nur fuer die FFA-Familie.
function roomN(n, fmt, over) {
  const p = {}, players = {}, seatByUid = {};
  for (let s = 0; s < n; s++) {
    p[s] = { s: TAB[s], on: true, t: BASE };
    players[s] = { id: 'PLAYER0' + s, name: 'P' + s, tab: TAB[s], uid: UID[s] };
    seatByUid[UID[s]] = s;
  }
  const r = {
    v: 4, config: { winTarget: 3, fmt: fmt || 'single', visibility: 'private' },
    gen: 0, state: 'playing', created: BASE - 5000, p, players, seatByUid,
  };
  if (fmt && fmt !== 'single' && fmt !== 'double') r.seats = n;
  return Object.assign(r, over || {});
}
const MOVE = { idx: 0, dx: 100, dy: -50, sp: 0.5 };
const MOVET = (tn) => Object.assign({}, MOVE, { t: tn });   // v4-Live-Move traegt den Turn
const LIVE_CLOCK = (anchor) => ({ g: { 0: { live: { clock: anchor } } } });

(async function main() {
  const java = resolveJava();
  if (!java) {
    console.error('FAIL: Keine Java-Laufzeit gefunden. Setze JAVA_HOME auf ein JDK 21,\n'
      + '      lege java in den PATH, oder installiere eines der dokumentierten\n'
      + '      Fallback-JDKs:\n        ' + LOCAL_JDK_FALLBACKS.join('\n        '));
    process.exit(2);
  }
  const major = javaMajor(java.bin);
  if (major < 21) {
    console.error('FAIL: Der RTDB-Emulator dieser Suite verlangt JDK 21, gefunden: '
      + (major || 'unbekannt') + ' (Quelle: ' + java.src + ').');
    process.exit(2);
  }
  console.log('Java ' + major + ' via ' + java.src + (java.home ? ' (' + java.home + ')' : ''));

  const runDir = path.join(os.tmpdir(), 'ringout-clock-arbiter-' + process.pid);
  const emu = startEmulator(runDir, java);
  let exitCode = 2;
  try {
    if (!(await waitReady(emu, 90000))) {
      console.error('FAIL: Emulator nicht bereit.\n' + emu.getOutput().slice(-2000));
      process.exit(2);
    }
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = EMU_HOST + ':' + EMU_PORT;
    const app = admin.initializeApp({ projectId: PROJECT, databaseURL: `http://${EMU_HOST}:${EMU_PORT}?ns=${NS}` });
    const db = admin.database(app);
    let simNow = BASE;                                   // injizierte Serverzeit — keine Sleeps
    const arb = core.createArbiter({ db, now: () => simNow });
    const seed = (code, val) => db.ref('rooms/' + code).set(val);
    const liveOf = async (code, g) => (await db.ref(`rooms/${code}/g/${g || 0}/live`).get()).val();
    const clockOf = async (code, g) => (await db.ref(`rooms/${code}/g/${g || 0}/live/clock`).get()).val();
    const lslots = async (code, g) => (await db.ref(`rooms/${code}/g/${g || 0}/live/slots`).get()).val() || {};
    const hist = async (code, g, tn) => (await db.ref(`rooms/${code}/g/${g}/t/${tn}`).get()).val();
    const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || 'error'; } };
    const start = (code, uid) => arb.clockStart({ room: code, uid: uid || UID[0] });
    const close = (code, phaseId, uid) => arb.clockClose({ room: code, phaseId, uid: uid || UID[0] });
    const rep = (code, phaseId, seat, hash, next) =>
      arb.clockSettle({ room: code, phaseId, uid: UID[seat], hash, next });
    const commit = (code, g, tn, seat) =>
      db.ref(`rooms/${code}/g/${g}/live/slots/${seat}`).set(Object.assign({}, MOVET(tn), { idx: seat }));
    // Test-Fassaden um dieselbe db: transaction-Pfade protokollieren bzw.
    // gezielt scheitern lassen (simulierter Function-Absturz zwischen den
    // Archivierungs-Schritten) — der Produktionscode bleibt frei von Seams.
    const wrapDb = (onTx) => ({
      ref: (p) => {
        const real = db.ref(p);
        return new Proxy(real, {
          get(target, k) {
            if (k === 'transaction') return (fn) => { onTx(p); return target.transaction(fn); };
            const v = target[k];
            return typeof v === 'function' ? v.bind(target) : v;
          },
        });
      },
    });
    const failDb = (shouldFail) => wrapDb((p) => { if (shouldFail(p)) throw new Error('simulierter Absturz'); });

    // ── 1) clockStart: Ownership, exakter Anker, begrenzter live-Pfad ──
    await seed('ABCD', roomN(2));
    t('start: Fremder abgelehnt', (await err(() => start('ABCD', UX))) === 'permission');
    t('start: ohne uid abgelehnt', (await err(() => arb.clockStart({ room: 'ABCD', uid: '' }))) === 'permission');
    t('start: ungueltiger Raumcode abgelehnt', (await err(() => arb.clockStart({ room: 'abcd!', uid: UID[0] }))) === 'invalid');
    const s1 = await start('ABCD');
    t('start: eroeffnet', s1.status === 'started' && s1.clock.phase === 'aim');
    t('start: Restzeit exakt 60000', s1.clock.remainingMs === 60000);
    t('start: Deadline = start+7000', s1.clock.startedAt === BASE && s1.clock.deadlineAt === BASE + 7000);
    t('start: crackAt/expiresAt in Phase 1 unerreichbar', s1.clock.crackAt == null && s1.clock.expiresAt == null);
    t('start: phaseId gen:turn', s1.clock.phaseId === '0:0');
    t('start: eligibleSeats aus dem v4-Roster', s1.clock.eligibleSeats === '0,1');
    t('start: Anker liegt begrenzt unter g/0/live/clock', (await clockOf('ABCD')).phaseId === '0:0');
    t('start: live enthaelt vor dem ersten Commit nur clock', Object.keys((await liveOf('ABCD')) || {}).join(',') === 'clock');
    t('start: kein raumweiter clock-Knoten mehr', (await db.ref('rooms/ABCD/clock').get()).val() === null);
    t('start: kein alter Gen-Pfad g/0/clock mehr', (await db.ref('rooms/ABCD/g/0/clock').get()).val() === null);
    t('start: zweiter Aufruf idempotent', (await start('ABCD', UID[1])).status === 'exists');

    // ── 2) Close: vorzeitig verboten, exakter Zeitabzug, genau ein Abschluss ──
    t('close: vor Deadline mit offenen Commits abgelehnt', (await err(() => close('ABCD', '0:0'))) === 'too-early');
    await commit('ABCD', 0, 0, 0); await commit('ABCD', 0, 0, 1);
    simNow = BASE + 3000;
    const c1 = await close('ABCD', '0:0');
    t('close: alle Commits -> resolving', c1.status === 'closed' && c1.clock.phase === 'resolving');
    t('close: exakt 3000 aktive ms abgezogen', c1.clock.remainingMs === 57000);
    t('close: settleDeadlineAt serverseitig gesetzt', c1.clock.settleDeadlineAt === simNow + core.SETTLE_GRACE_MS);
    t('close: Historie sofort archiviert und bestaetigt', c1.clock.archived === true && (await hist('ABCD', 0, 0)) != null);
    t('close: echte Commits unangetastet (live und Historie)',
      (await lslots('ABCD', 0))[0].dx === 100 && (await hist('ABCD', 0, 0))[0].dx === 100);
    t('close: Doppel-Finalize ist stale (genau ein Abschluss)', (await close('ABCD', '0:0', UID[1])).status === 'stale');

    // ── 3) Settlement-Grundvertrag ──
    simNow = BASE + 10000;                               // Physik kostet keine Uhrzeit
    t('settle: ohne nextEligibleSeats abgelehnt',
      (await err(() => arb.clockSettle({ room: 'ABCD', phaseId: '0:0', uid: UID[0], hash: 'h1' }))) === 'invalid');
    const st1 = await rep('ABCD', '0:0', 0, 'h1', [0, 1]);
    t('settle: erster Report wartet auf Quorum', st1.status === 'pending' && st1.clock.phase === 'resolving');
    t('settle: Report wird als {hash,next} abgelegt',
      st1.clock.settled[0].hash === 'h1' && st1.clock.settled[0].next === '0,1');
    const st2 = await rep('ABCD', '0:0', 1, 'h1', [1, 0]);   // unsortiert -> normalisiert
    t('settle: Quorum -> Turn 1 eroeffnet', st2.clock.phase === 'aim' && st2.clock.turn === 1 && st2.clock.phaseId === '0:1');
    t('settle: Restzeit unveraendert durch Physik (57000)', st2.clock.remainingMs === 57000);
    t('settle: neue Deadline = jetzt+7000', st2.clock.startedAt === BASE + 10000 && st2.clock.deadlineAt === BASE + 17000);
    t('settle: eligibleSeats aus dem Konsens uebernommen', st2.clock.eligibleSeats === '0,1');
    t('settle: Folgephase leert live (keine alten Slots, keine alten Reports)',
      Object.keys((await liveOf('ABCD')) || {}).join(',') === 'clock' && st2.clock.settled == null);
    t('settle: alte Phase stale (kein Doppel-Start)', (await rep('ABCD', '0:0', 0, 'h1', [0, 1])).status === 'stale');

    // ── 4) Timeout-Close: fehlende Slots als verbindlicher No-Shot ──
    await commit('ABCD', 0, 1, 0);
    t('close: Timeout vor Deadline abgelehnt', (await err(() => close('ABCD', '0:1'))) === 'too-early');
    simNow = BASE + 17000;                               // Deadline EXAKT erreicht
    const c2 = await close('ABCD', '0:1');
    const sl2 = await lslots('ABCD', 0);
    t('close: Abschluss exakt auf der Deadline erlaubt', c2.status === 'closed');
    t('close: voller Fensterverbrauch (57000-7000)', c2.clock.remainingMs === 50000);
    t('close: echter Commit unangetastet', sl2[0].dx === 100);
    t('close: offener Seat -> verbindlicher No-Shot {ns:stand}', sl2[1] && sl2[1].ns === 'stand');
    t('close: No-Shot in der Historie t/1 archiviert', (await hist('ABCD', 0, 1))[1].ns === 'stand');
    t('close: zweiter Timeout-Versuch stale, Slots stabil',
      (await close('ABCD', '0:1', UID[1])).status === 'stale' && (await lslots('ABCD', 0))[1].ns === 'stand');

    // ── 5) ATOMARER CLOSE (5 Seats, mehrere fehlende Slots) ─────────────────
    //    Ein Listener auf g/0/live protokolliert JEDEN beobachtbaren Zustand:
    //    es darf weder eine aim-Phase mit bereits gebuchten No-Shots noch eine
    //    resolving-Phase mit unvollstaendigen Slots geben.
    await seed('ABCP', roomN(5, 'ffa'));
    simNow = BASE;
    await start('ABCP');
    const gref = db.ref('rooms/ABCP/g/0/live');
    const seen = [];
    const filled = (e) => { const s = e.slots || {}; let n = 0; for (let i = 0; i < 5; i++) if (s[i] != null) n++; return n; };
    const phaseOf = (e) => (e.clock && e.clock.phase) || null;
    // Deterministische Synchronisation statt fester Wartezeit: das Promise
    // loest exakt mit dem Listener-Event auf, das den Endzustand traegt.
    let seenFinal;
    const finalSeen = new Promise((resolve) => { seenFinal = resolve; });
    const onVal = gref.on('value', (snap) => {
      const e = JSON.parse(JSON.stringify(snap.val() || {}));
      seen.push(e);
      if (phaseOf(e) === 'resolving' && filled(e) === 5) seenFinal();
    });
    await commit('ABCP', 0, 0, 0); await commit('ABCP', 0, 0, 3);
    simNow = BASE + 7000;
    const c5 = await close('ABCP', '0:0');
    await finalSeen;                                     // Listener-Bedingung, kein Sleep
    gref.off('value', onVal);
    t('atomic: 5 Seats, 3 fehlende Slots -> resolving', c5.status === 'closed' && c5.clock.phase === 'resolving');
    const slP = await lslots('ABCP', 0);
    t('atomic: alle 5 Slots gebucht', [0, 1, 2, 3, 4].every((s) => slP[s] != null));
    t('atomic: Historie traegt alle 5 Slots', Object.keys((await hist('ABCP', 0, 0)) || {}).length === 5);
    t('atomic: kein Zwischenzustand aim + Fremdbuchung', seen.every((e) => phaseOf(e) !== 'aim' || filled(e) <= 2));
    t('atomic: kein Zwischenzustand resolving + unvollstaendig', seen.every((e) => phaseOf(e) !== 'resolving' || filled(e) === 5));
    t('atomic: Uebergang wurde ueberhaupt beobachtet', seen.some((e) => phaseOf(e) === 'resolving'));
    t('atomic: nur stand-Sentinels, nie left', [1, 2, 4].every((s) => ((seen[seen.length - 1].slots || {})[s] || {}).ns === 'stand'));

    // Simulierte Exception VOR der Transaction: kein Byte darf sich aendern.
    await seed('ABCQ', roomN(3, 'ffa'));
    simNow = BASE;
    await start('ABCQ');
    await commit('ABCQ', 0, 0, 0);
    const boom = core.createArbiter({ db, now: () => { throw new Error('simulierter Ausfall vor der Transaction'); } });
    const beforeBoom = JSON.stringify((await db.ref('rooms/ABCQ/g/0').get()).val());
    t('atomic: Exception vor der Transaction wirft', (await err(() => boom.clockClose({ room: 'ABCQ', phaseId: '0:0', uid: UID[0] }))) === 'error');
    t('atomic: Exception vor der Transaction aendert nichts',
      JSON.stringify((await db.ref('rooms/ABCQ/g/0').get()).val()) === beforeBoom);

    // Zwei parallele clockClose: genau ein Abschluss, keine Doppelbuchung.
    simNow = BASE + 7000;
    const par = await Promise.all([close('ABCQ', '0:0'), close('ABCQ', '0:0', UID[1])]);
    t('atomic: zwei parallele Close -> genau ein closed',
      par.filter((r) => r.status === 'closed').length === 1 && par.filter((r) => r.status === 'stale').length === 1);
    const slQ = await lslots('ABCQ', 0);
    t('atomic: parallele Close hinterlassen konsistente Slots',
      slQ[0].dx === 100 && slQ[1].ns === 'stand' && slQ[2].ns === 'stand');
    t('atomic: parallele Close ziehen die Zeit nur EINMAL ab', (await clockOf('ABCQ')).remainingMs === 53000);
    t('atomic: parallele Close archivieren genau EINEN History-Turn',
      core.canonical(await hist('ABCQ', 0, 0)) === core.canonical(slQ));

    // ── 6) Commit gegen Timeout ─────────────────────────────────────────────
    //    Rules rechnen mit der ECHTEN Serveruhr (now), daher hier Anker mit
    //    Date.now() statt simNow.
    await seed('ABCR', roomN(2, 'single', LIVE_CLOCK(core.aimAnchor(0, 0, 60000, Date.now(), '0,1', {}))));
    t('commit: echter Commit kurz vor der Deadline gewinnt', (await restPut('rooms/ABCR/g/0/live/slots/1', MOVET(0), UID[1])) === true);
    await seed('ABCS', roomN(2, 'single', LIVE_CLOCK(core.aimAnchor(0, 0, 60000, Date.now() - 60000, '0,1', {}))));
    t('commit: Commit NACH der Deadline in leeren Slot abgelehnt', (await restPut('rooms/ABCS/g/0/live/slots/0', MOVET(0), UID[0])) === false);
    // Timeout und echter Commit gleichzeitig: der Slot traegt danach GENAU eine
    // der beiden Formen — nie eine Mischung, nie zwei Abschluesse.
    await seed('ABCT', roomN(2));
    simNow = BASE;
    await start('ABCT');
    await commit('ABCT', 0, 0, 0);
    simNow = BASE + 7000;
    const race = await Promise.all([
      close('ABCT', '0:0'),
      db.ref('rooms/ABCT/g/0/live/slots/1').transaction((cur) => (cur == null ? Object.assign({}, MOVET(0), { idx: 1 }) : undefined)),
    ]);
    const slT = (await hist('ABCT', 0, 0))[1];
    t('commit: Timeout und Commit parallel -> genau eine Slot-Form',
      (slT.ns === 'stand') !== (slT.idx === 1));
    t('commit: Timeout und Commit parallel -> genau ein Abschluss',
      race[0].status === 'closed' && (await clockOf('ABCT')).phase === 'resolving');

    // ── 7) Reconnect / Presence ─────────────────────────────────────────────
    //    Presence entscheidet ueber Timer-No-Shots GAR NICHT mehr. Ein veralteter
    //    Snapshot kann keinen fremden left-Sentinel mehr erzeugen.
    await seed('ABCU', roomN(2, 'single', { p: { 0: { s: TAB[0], on: true, t: BASE } } }));  // Seat 1 ohne Presence
    simNow = BASE;
    await start('ABCU');
    await commit('ABCU', 0, 0, 0);
    simNow = BASE + 7000;
    await close('ABCU', '0:0');
    t('presence: geloeschte Presence erzeugt KEIN left, sondern stand', (await lslots('ABCU', 0))[1].ns === 'stand');
    // Reconnect waehrend eines laufenden clockClose darf nichts veraendern.
    await seed('ABCV', roomN(2, 'single', { p: { 0: { s: TAB[0], on: true, t: BASE } } }));
    simNow = BASE;
    await start('ABCV');
    await commit('ABCV', 0, 0, 0);
    simNow = BASE + 7000;
    const closing = close('ABCV', '0:0');
    await db.ref('rooms/ABCV/p/1').set({ s: TAB[1], on: true, t: BASE + 6999 });   // Reconnect mitten im Close
    const cV = await closing;
    t('presence: Reconnect waehrend Close -> Phase genau einmal geschlossen', cV.status === 'closed');
    t('presence: Reconnect waehrend Close -> weiterhin stand', (await lslots('ABCV', 0))[1].ns === 'stand');
    // Reconnect waehrend resolving: der Anker bleibt Byte fuer Byte stehen.
    const frozen = JSON.stringify(await clockOf('ABCV'));
    await db.ref('rooms/ABCV/p/1').set({ s: TAB[1], on: false, t: BASE + 7100 });
    await db.ref('rooms/ABCV/p/1').set({ s: TAB[1], on: true, t: BASE + 7200 });
    t('presence: Reconnect waehrend resolving laesst den Anker unveraendert', JSON.stringify(await clockOf('ABCV')) === frozen);
    simNow = BASE + 8000;
    await rep('ABCV', '0:0', 0, 'h', [0, 1]);
    const vRe = await rep('ABCV', '0:0', 1, 'h', [0, 1]);
    t('presence: Settlement fuer dieselbe phaseId nach Reconnect gilt', vRe.clock.phase === 'aim' && vRe.clock.turn === 1);
    // Unterschiedliche Settle-Reihenfolgen fuehren zum identischen Anker.
    for (const [code, order] of [['ABCW', [0, 1]], ['ABCX', [1, 0]]]) {
      await seed(code, roomN(2));
      simNow = BASE;
      await start(code);
      await commit(code, 0, 0, 0); await commit(code, 0, 0, 1);
      simNow = BASE + 2000;
      await close(code, '0:0');
      simNow = BASE + 5000;
      for (const s of order) await rep(code, '0:0', s, 'h', [0, 1]);
    }
    const ordW = await clockOf('ABCW'), ordX = await clockOf('ABCX');
    t('presence: Settle-Reihenfolge egal — identischer Folgeanker',
      JSON.stringify(ordW) === JSON.stringify(ordX) && ordW.turn === 1 && ordW.remainingMs === 58000);

    // ── 8) Eliminierung: eligibleSeats statt Presence ───────────────────────
    await seed('ABDA', roomN(3, 'ffa'));
    simNow = BASE;
    await start('ABDA');
    t('elim: Startmenge = alle drei Seats', (await clockOf('ABDA')).eligibleSeats === '0,1,2');
    for (const s of [0, 1, 2]) await commit('ABDA', 0, 0, s);
    simNow = BASE + 2000;
    await close('ABDA', '0:0');
    simNow = BASE + 6000;
    for (const s of [0, 1]) await rep('ABDA', '0:0', s, 'h', [0, 2]);
    const el1 = (await rep('ABDA', '0:0', 2, 'h', [0, 2])).clock;
    t('elim: Konsens setzt eligibleSeats der Folgephase auf 0,2', el1.eligibleSeats === '0,2' && el1.turn === 1);
    t('elim: eliminierter Seat bleibt verbunden', (await db.ref('rooms/ABDA/p/1/on').get()).val() === true);
    // Die naechste Phase wartet NICHT auf Seat 1 und zieht keine 7 s fuer ihn ab.
    await commit('ABDA', 0, 1, 0); await commit('ABDA', 0, 1, 2);
    simNow = el1.startedAt + 1500;
    const el2 = await close('ABDA', '0:1');
    t('elim: Folgephase schliesst ohne den eliminierten Seat vorzeitig', el2.status === 'closed');
    t('elim: nur die tatsaechlich genutzten 1500 ms kosten Uhrzeit', el2.clock.remainingMs === el1.remainingMs - 1500);
    t('elim: kein No-Shot fuer den eliminierten Seat', (await hist('ABDA', 0, 1))[1] == null);
    t('elim: eliminierter Seat darf nicht settlen',
      (await err(() => rep('ABDA', '0:1', 1, 'h', [0, 2]))) === 'permission');
    t('elim: eligibleSeats darf nicht wieder wachsen',
      (await err(() => rep('ABDA', '0:1', 0, 'h', [0, 1, 2]))) === 'invalid');
    // Team-Duel: dieselbe Semantik ueber vier Seats.
    await seed('ABDB', roomN(4, 'team_duel'));
    simNow = BASE;
    await start('ABDB');
    t('elim: team_duel Startmenge = 0,1,2,3', (await clockOf('ABDB')).eligibleSeats === '0,1,2,3');
    for (const s of [0, 1, 2, 3]) await commit('ABDB', 0, 0, s);
    simNow = BASE + 1000;
    await close('ABDB', '0:0');
    for (const s of [0, 1, 2]) await rep('ABDB', '0:0', s, 'h', [0, 2]);
    const tdB = (await rep('ABDB', '0:0', 3, 'h', [0, 2])).clock;
    t('elim: team_duel Folgephase nur mit 0,2', tdB.eligibleSeats === '0,2' && tdB.phase === 'aim');
    // Leere Folgemenge = Partie vorbei: es wird KEINE tote Phase eroeffnet.
    await seed('ABDC', roomN(2));
    simNow = BASE;
    await start('ABDC');
    await commit('ABDC', 0, 0, 0); await commit('ABDC', 0, 0, 1);
    simNow = BASE + 1000;
    await close('ABDC', '0:0');
    await rep('ABDC', '0:0', 0, 'h', []);
    const fin = (await rep('ABDC', '0:0', 1, 'h', [])).clock;
    t('elim: leere Folgemenge -> finished/complete statt toter Phase',
      fin.phase === 'finished' && fin.reason === 'complete');

    // ── 9) Settlement: write-once, Konsens, Grace ──────────────────────────
    await seed('ABDD', roomN(3, 'ffa'));
    simNow = BASE;
    await start('ABDD');
    for (const s of [0, 1, 2]) await commit('ABDD', 0, 0, s);
    simNow = BASE + 1000;
    await close('ABDD', '0:0');
    await rep('ABDD', '0:0', 0, 'hA', [0, 1, 2]);
    const again = await rep('ABDD', '0:0', 0, 'hA', [2, 1, 0]);   // identisch nach Normalisierung
    t('settle: identische Wiederholung ist idempotent',
      again.status === 'pending' && again.clock.phase === 'resolving' && again.clock.settled[0].hash === 'hA');
    t('settle: Report eines fremden Seats unveraendert', again.clock.settled[1] == null);
    const overw = await rep('ABDD', '0:0', 0, 'hB', [0, 1, 2]);   // abweichender Retry
    t('settle: abweichender Retry -> desync (write-once verteidigt)',
      overw.clock.phase === 'finished' && overw.clock.reason === 'desync');
    t('settle: finished ist terminal', (await rep('ABDD', '0:0', 1, 'hA', [0, 1, 2])).status === 'stale');
    // Abweichende nextEligibleSeats sind ebenfalls Desync.
    await seed('ABDE', roomN(3, 'ffa'));
    simNow = BASE;
    await start('ABDE');
    for (const s of [0, 1, 2]) await commit('ABDE', 0, 0, s);
    simNow = BASE + 1000;
    await close('ABDE', '0:0');
    await rep('ABDE', '0:0', 0, 'h', [0, 1, 2]);
    await rep('ABDE', '0:0', 1, 'h', [0, 1, 2]);
    const dsn = (await rep('ABDE', '0:0', 2, 'h', [0, 2])).clock;
    t('settle: abweichende nextEligibleSeats -> desync', dsn.phase === 'finished' && dsn.reason === 'desync');
    // Ungueltige Reports werden abgewiesen, nicht gespeichert.
    await seed('ABDF', roomN(2));
    simNow = BASE;
    await start('ABDF');
    await commit('ABDF', 0, 0, 0); await commit('ABDF', 0, 0, 1);
    simNow = BASE + 1000;
    await close('ABDF', '0:0');
    t('settle: doppelter Seat in next abgelehnt', (await err(() => rep('ABDF', '0:0', 0, 'h', [0, 0]))) === 'invalid');
    t('settle: unbekannter Seat in next abgelehnt', (await err(() => rep('ABDF', '0:0', 0, 'h', [0, 4]))) === 'invalid');
    t('settle: leerer Hash abgelehnt', (await err(() => rep('ABDF', '0:0', 0, '', [0, 1]))) === 'invalid');
    t('settle: ungueltiger Report hinterlaesst nichts', (await clockOf('ABDF')).settled == null);
    // Zwei parallele identische Settle-Aufrufe (volles Quorum): genau EINE
    // Folgephase, turn/phaseId exakt einmal erhoeht, kein verlorener Report.
    const parS = await Promise.all([rep('ABDF', '0:0', 0, 'h', [0, 1]), rep('ABDF', '0:0', 1, 'h', [0, 1])]);
    const afterS = await clockOf('ABDF');
    t('settle: parallele identische Reports oeffnen genau eine Folgephase',
      afterS.phase === 'aim' && afterS.turn === 1 && afterS.phaseId === '0:1');
    t('settle: parallele Aufrufe verlieren keinen Report', parS.every((r) => r.status !== 'stale'));
    // Grace-Fallback ohne jede Presence-Beteiligung — aber NIE aus Teilreports.
    await seed('ABDG', roomN(3, 'ffa'));
    simNow = BASE;
    await start('ABDG');
    for (const s of [0, 1, 2]) await commit('ABDG', 0, 0, s);
    simNow = BASE + 1000;
    const cg = await close('ABDG', '0:0');
    t('grace: settleDeadlineAt = closedAt + Grace', cg.clock.settleDeadlineAt === cg.clock.closedAt + core.SETTLE_GRACE_MS);
    const g1 = await rep('ABDG', '0:0', 0, 'h', [0, 1, 2]);
    t('grace: vor Ablauf bleibt resolving', g1.clock.phase === 'resolving');
    await db.ref('rooms/ABDG/p').set(null);                // Presence komplett weg — irrelevant
    simNow = cg.clock.settleDeadlineAt;
    const g2 = await rep('ABDG', '0:0', 0, 'h', [0, 1, 2]); // identischer Retry, Quorum 1/3
    t('grace: unvollstaendiges Quorum nach Ablauf -> finished/settlement_timeout (nie Teilreport-Folgephase)',
      g2.status === 'timeout' && g2.clock.phase === 'finished' && g2.clock.reason === 'settlement_timeout');
    t('grace: turn/phaseId/eligibleSeats bleiben beim Timeout unveraendert',
      g2.clock.turn === 0 && g2.clock.phaseId === '0:0' && g2.clock.eligibleSeats === '0,1,2');

    // ── 9b) POST-GRACE: das Ergebnis ist reihenfolgeunabhaengig — kein
    //        einzelner oder teilweiser Report bestimmt je eine Folgephase ──
    const openThenGrace = async (code, n, fmt) => {
      await seed(code, roomN(n, fmt));
      simNow = BASE;
      await start(code);
      for (let s = 0; s < n; s++) await commit(code, 0, 0, s);
      simNow = BASE + 1000;
      const c = await close(code, '0:0');
      return c.clock.settleDeadlineAt;
    };
    // (1) Ein einzelner Report nach Grace: keine Aim-Phase, settlement_timeout.
    let dl = await openThenGrace('ABEJ', 2);
    simNow = dl;
    const pg1 = await rep('ABEJ', '0:0', 0, 'hX', [0]);
    t('post-grace: einzelner Report -> finished/settlement_timeout, keine Aim-Phase',
      pg1.status === 'timeout' && pg1.clock.phase === 'finished' && pg1.clock.reason === 'settlement_timeout');
    t('post-grace: nextEligibleSeats des Einzelreports NICHT uebernommen',
      pg1.clock.eligibleSeats === '0,1' && pg1.clock.turn === 0);
    // Ein spaeterer Report kann den terminalen Zustand nicht ueberschreiben.
    const pg1b = await rep('ABEJ', '0:0', 1, 'hX', [0, 1]);
    t('post-grace: settlement_timeout ist terminal und idempotent',
      pg1b.status === 'stale' && (await clockOf('ABEJ')).reason === 'settlement_timeout');
    // (2) Zwei parallele widerspruechliche Reports nach Grace: nie eine Aim-Phase,
    //     nie die nextEligibleSeats eines "Gewinners".
    dl = await openThenGrace('ABEK', 2);
    simNow = dl;
    await Promise.all([rep('ABEK', '0:0', 0, 'hA', [0]), rep('ABEK', '0:0', 1, 'hB', [1])]);
    const pg2 = await clockOf('ABEK');
    t('post-grace: parallele widerspruechliche Reports -> terminal, keine Aim-Phase',
      pg2.phase === 'finished' && pg2.reason === 'settlement_timeout');
    t('post-grace: eligibleSeats stammen von keinem der beiden Reports',
      pg2.eligibleSeats === '0,1' && pg2.turn === 0);
    // (3) Ein Report kurz vor, einer nach Grace: das volle konsistente Quorum
    //     wurde innerhalb der offenen resolving-Phase gespeichert -> normal weiter.
    dl = await openThenGrace('ABEM', 2);
    simNow = dl - 1;
    await rep('ABEM', '0:0', 0, 'h', [0, 1]);
    simNow = dl + 5000;
    const pg3 = await rep('ABEM', '0:0', 1, 'h', [0, 1]);
    t('post-grace: vollstaendiges konsistentes Quorum darf normal fortfahren',
      pg3.status === 'settled' && pg3.clock.phase === 'aim' && pg3.clock.turn === 1);
    // (4) Vollstaendiges, aber widerspruechliches Quorum nach Grace: desync.
    dl = await openThenGrace('ABEN', 2);
    simNow = dl - 1;
    await rep('ABEN', '0:0', 0, 'hA', [0, 1]);
    simNow = dl + 5000;
    const pg4 = await rep('ABEN', '0:0', 1, 'hB', [0, 1]);
    t('post-grace: volles widerspruechliches Quorum -> finished/desync',
      pg4.clock.phase === 'finished' && pg4.clock.reason === 'desync');
    // (5) Gar kein Report vor der Grace, dann ein gueltiger Settle-Poke:
    //     settlement_timeout, keine Folgerunde (3 Seats -> Quorum 1/3).
    dl = await openThenGrace('ABEP', 3, 'ffa');
    simNow = dl + 10000;
    const pg5 = await rep('ABEP', '0:0', 0, 'h', [0, 1, 2]);
    t('post-grace: Poke ohne vorhandene Reports -> finished/settlement_timeout',
      pg5.status === 'timeout' && pg5.clock.phase === 'finished' && pg5.clock.reason === 'settlement_timeout');
    t('post-grace: keine Folgerunde eroeffnet', pg5.clock.turn === 0 && pg5.clock.phaseId === '0:0');

    // ── 10) Crack- und Expired-Leiter ueber volle Timeout-Turns ─────────────
    await seed('ABDH', roomN(2));
    simNow = BASE;
    await start('ABDH');
    let ck = await clockOf('ABDH');
    const advance = async (c) => {
      simNow = c.deadlineAt;
      await close('ABDH', c.phaseId);
      await rep('ABDH', c.phaseId, 0, 'h', [0, 1]);
      await rep('ABDH', c.phaseId, 1, 'h', [0, 1]);
      return clockOf('ABDH');
    };
    for (let i = 0; i < 7; i++) ck = await advance(ck);      // 60000 -> 11000
    t('crack: Restzeit 11000 nach 7 Timeout-Turns', ck.remainingMs === 11000 && ck.cracked === false);
    t('crack: crackAt vorberechnet (start+1000)', ck.crackAt === ck.startedAt + 1000);
    simNow = ck.deadlineAt;
    await close('ABDH', ck.phaseId);
    let ck2 = await clockOf('ABDH');
    t('crack: beim Unterschreiten genau einmal gesetzt', ck2.cracked === true && ck2.remainingMs === 4000);
    await rep('ABDH', ck.phaseId, 0, 'h', [0, 1]);
    await rep('ABDH', ck.phaseId, 1, 'h', [0, 1]);
    ck2 = await clockOf('ABDH');
    t('expiry: letztes Fenster = Restzeit (deadline=start+4000)', ck2.deadlineAt === ck2.startedAt + 4000);
    t('expiry: expiresAt = deadline (0 wird exakt erreicht)', ck2.expiresAt === ck2.deadlineAt);
    t('crack: bleibt true, crackAt nicht erneut gesetzt', ck2.cracked === true && ck2.crackAt == null);
    simNow = ck2.deadlineAt;
    await close('ABDH', ck2.phaseId);
    let ck3 = await clockOf('ABDH');
    t('expiry: bei 0 genau einmal gesetzt', ck3.expired === true && ck3.remainingMs === 0);
    await rep('ABDH', ck2.phaseId, 0, 'h', [0, 1]);
    await rep('ABDH', ck2.phaseId, 1, 'h', [0, 1]);
    ck3 = await clockOf('ABDH');
    t('expiry: Folgephase UNGETIMT (kein deadlineAt), Match laeuft weiter',
      ck3.phase === 'aim' && ck3.deadlineAt == null && ck3.expired === true);
    simNow += 500000;
    t('expiry: ungetimte Phase kennt keinen Timeout-Close', (await err(() => close('ABDH', ck3.phaseId))) === 'too-early');
    await commit('ABDH', 0, ck3.turn, 0); await commit('ABDH', 0, ck3.turn, 1);
    const cu = await close('ABDH', ck3.phaseId);
    t('expiry: ungetimter Close nur nach vollstaendigen Commits, Restzeit bleibt 0',
      cu.status === 'closed' && cu.clock.remainingMs === 0);
    t('expiry: gesamte Leiter lueckenlos archiviert (t/0..t/9)',
      await (async () => { for (let i = 0; i <= 9; i++) if ((await hist('ABDH', 0, i)) == null) return false; return true; })());

    // ── 11) Reconnect-Vollstaendigkeit: alles aus live + Historie ───────────
    const cold = await clockOf('ABCD');
    t('reconnect: alle Vertragsfelder im Anker vorhanden',
      ['v', 'gen', 'turn', 'phaseId', 'phase', 'startedAt', 'remainingMs', 'eligibleSeats', 'cracked', 'expired']
        .every((k) => cold[k] !== undefined));
    t('reconnect: abgeschlossene Turns aus t/<turn> rekonstruierbar',
      (await hist('ABCD', 0, 0)) != null && (await hist('ABCD', 0, 1)) != null);

    // ── 12) Rules gegen den ECHTEN Emulator ────────────────────────────────
    //    created mit ECHTER Wanduhr: die Presence-Validates rechnen mit dem
    //    2-h-Join-Fenster gegen die reale Serverzeit des Emulators.
    await seed('ABDL', roomN(2, 'single', Object.assign({ created: Date.now() - 5000 }, LIVE_CLOCK(core.aimAnchor(0, 0, 60000, Date.now(), '0,1', {})))));
    t('rules: clock-Write ohne Auth abgelehnt', (await restPut('rooms/ABDL/g/0/live/clock', { hack: 1 })) === false);
    t('rules: clock-Write mit Auth abgelehnt', (await restPut('rooms/ABDL/g/0/live/clock/deadlineAt', 9999999999999, UID[0])) === false);
    t('rules: alter Raumpfad rooms/<code>/clock bleibt zu', (await restPut('rooms/ABDL/clock', { hack: 1 }, UID[0])) === false);
    t('rules: alter Gen-Pfad g/<gen>/clock bleibt zu', (await restPut('rooms/ABDL/g/0/clock', { hack: 1 }, UID[0])) === false);
    t('rules: v4-Slot ohne Auth abgelehnt', (await restPut('rooms/ABDL/g/0/live/slots/0', MOVET(0))) === false);
    t('rules: v4-Slot eigener Seat vor Deadline erlaubt', (await restPut('rooms/ABDL/g/0/live/slots/0', MOVET(0), UID[0])) === true);
    t('rules: v4-Slot write-once (Retry abgelehnt)', (await restPut('rooms/ABDL/g/0/live/slots/0', MOVET(0), UID[0])) === false);
    t('rules: v4-Slot fremder Seat abgelehnt', (await restPut('rooms/ABDL/g/0/live/slots/1', MOVET(0), UID[0])) === false);
    t('rules: v4-Slot ohne t-Feld abgelehnt (Turn-Bindung)', (await restPut('rooms/ABDL/g/0/live/slots/1', MOVE, UID[1])) === false);
    t('rules: v4-Slot mit falschem t abgelehnt', (await restPut('rooms/ABDL/g/0/live/slots/1', MOVET(3), UID[1])) === false);
    t('rules: v4-Historie fuer Clients gesperrt (eigener Seat, vor Deadline)',
      (await restPut('rooms/ABDL/g/0/t/0/0', MOVE, UID[0])) === false);
    t('rules: seatByUid fuer Clients gesperrt (eigener Eintrag)', (await restPut('rooms/ABDL/seatByUid/' + UID[0], 0, UID[0])) === false);
    t('rules: seatByUid fuer Fremde gesperrt', (await restPut('rooms/ABDL/seatByUid/' + UX, 1, UX)) === false);
    t('rules: UID ohne Indexeintrag kommt in keinen Slot', (await restPut('rooms/ABDL/g/0/live/slots/1', MOVET(0), UX)) === false);
    t('rules: v4-Presence fremde UID abgelehnt',
      (await restPut('rooms/ABDL/p/1', { s: TAB[1], on: false, t: { '.sv': 'timestamp' } }, UX)) === false);
    t('rules: v4-Presence eigene UID erlaubt',
      (await restPut('rooms/ABDL/p/1', { s: TAB[1], on: false, t: { '.sv': 'timestamp' } }, UID[1])) === true);
    // Inkonsistenter Index: der Slot bleibt fail-closed zu — fuer BEIDE Seiten
    // des Widerspruchs (Index zeigt woandershin / players-uid passt nicht).
    const inc = roomN(2, 'single', LIVE_CLOCK(core.aimAnchor(0, 0, 60000, Date.now(), '0,1', {})));
    inc.seatByUid = {}; inc.seatByUid[UID[0]] = 0; inc.seatByUid[UID[1]] = 0;
    await seed('ABDQ', inc);
    t('rules: seatByUid zeigt auf fremden Seat -> kein Slot-Write', (await restPut('rooms/ABDQ/g/0/live/slots/1', MOVET(0), UID[1])) === false);
    t('rules: widerspruechliches Indexziel ebenfalls gesperrt', (await restPut('rooms/ABDQ/g/0/live/slots/0', MOVET(0), UID[1])) === false);
    await seed('ABDM', roomN(3, 'ffa', LIVE_CLOCK(core.aimAnchor(0, 0, 60000, Date.now(), '0,2', {}))));
    t('rules: Seat ausserhalb eligibleSeats abgelehnt', (await restPut('rooms/ABDM/g/0/live/slots/1', MOVET(0), UID[1])) === false);
    t('rules: Seat in eligibleSeats erlaubt', (await restPut('rooms/ABDM/g/0/live/slots/2', Object.assign({}, MOVET(0), { idx: 2 }), UID[2])) === true);
    await seed('ABDN', roomN(2, 'single', { g: { 1: { live: { clock: core.aimAnchor(1, 0, 60000, Date.now(), '0,1', {}) } } } }));
    t('rules: Anker fremder Generation deckt g/0 nicht', (await restPut('rooms/ABDN/g/0/live/slots/0', MOVET(0), UID[0])) === false);
    t('rules: Write in g/1 verlangt room.gen === 1', (await restPut('rooms/ABDN/g/1/live/slots/0', MOVET(0), UID[0])) === false);
    const v3room = roomN(2);
    v3room.v = 3;
    delete v3room.players[0].uid; delete v3room.players[1].uid;
    delete v3room.seatByUid;
    await seed('ABDP', v3room);
    t('rules: v3-Slot bleibt ohne Auth erlaubt (Bestand, echter Emulator)',
      (await restPut('rooms/ABDP/g/0/t/0/0', MOVE)) === true);

    // ── 13) Review-Befunde P0/P1 am ECHTEN Emulator ────────────────────────
    const UA = 'uid-angreifer-001';
    t('P0: fremdes players/1/uid ueberschreiben abgelehnt', (await restPut('rooms/ABDL/players/1/uid', UA, UA)) === false);
    t('P0: Host players/0/uid ueberschreiben abgelehnt', (await restPut('rooms/ABDL/players/0/uid', UA, UA)) === false);
    t('P0: eigene uid aendern abgelehnt (unveraenderlich)', (await restPut('rooms/ABDL/players/1/uid', UA, UID[1])) === false);
    t('P0: fremder players-Record abgelehnt',
      (await restPut('rooms/ABDL/players/1', { id: 'PLAYER01', name: 'X', tab: TAB[1], uid: UA }, UA)) === false);
    t('P0: eigener Namenswechsel bleibt erlaubt',
      (await restPut('rooms/ABDL/players/1', { id: 'PLAYER01', name: 'Neu', tab: TAB[1], uid: UID[1] }, UID[1])) === true);
    t('P0: Seat-Uebernahme wirkt auch gegen den Arbiter nicht',
      core.seatOfUid((await db.ref('rooms/ABDL').get()).val(), UA) === -1);
    t('P1: live/clock auf freien Raumcode abgelehnt',
      (await restPut('rooms/ZZZZ/g/0/live/clock', core.aimAnchor(0, 0, 60000, Date.now(), '0,1', {}), UA)) === false);
    t('P1: live-Slot auf freien Raumcode abgelehnt', (await restPut('rooms/ZZZY/g/0/live/slots/0', MOVET(0), UA)) === false);
    t('P1: seatByUid auf freien Raumcode abgelehnt', (await restPut('rooms/ZZZW/seatByUid/' + UA, 0, UA)) === false);
    t('P1: Teil-Raum auf freien Code abgelehnt', (await restPut('rooms/ZZZX/config', { winTarget: 3, fmt: 'single', visibility: 'private' }, UA)) === false);
    t('P1: clock in bestehendem Raum bleibt unbeschreibbar', (await restPut('rooms/ABDL/g/0/live/clock/remainingMs', 60000, UID[0])) === false);

    // ── 14) UID-/SEAT-EINDEUTIGKEIT: fail-closed statt "niedrigster Seat" ──
    // Reine Funktionslogik (kein DB-Zugriff noetig):
    t('uid: doppelte UID in zwei Seats -> kein Besitz (Kernfunktion)',
      core.seatOfUid({ players: { 0: { uid: 'u' }, 1: { uid: 'u' } }, seatByUid: { u: 0 } }, 'u') === -1);
    t('uid: ohne Indexeintrag kein Besitz trotz players-Treffer (nie niedrigster Seat)',
      core.seatOfUid({ players: { 0: { uid: 'u' } }, seatByUid: {} }, 'u') === -1);
    t('uid: Index ausserhalb des Seatbereichs -> kein Besitz',
      core.seatOfUid({ players: { 0: { uid: 'u' } }, seatByUid: { u: 7 } }, 'u') === -1);
    t('uid: Index als Nicht-Ganzzahl -> kein Besitz',
      core.seatOfUid({ players: { 0: { uid: 'u' } }, seatByUid: { u: '0' } }, 'u') === -1);
    // Gegen den echten Emulator (Arbiter-Callables):
    const dup = roomN(2);
    dup.players[1].uid = UID[0];                       // dieselbe UID in zwei players-Seats
    dup.seatByUid = {}; dup.seatByUid[UID[0]] = 0;
    await seed('ABFA', dup);
    t('uid: doppelte UID in zwei players-Seats -> Callable permission', (await err(() => start('ABFA'))) === 'permission');
    const noIdx = roomN(2);
    delete noIdx.seatByUid[UID[1]];                    // Seat 1 besetzt, aber ohne Indexeintrag
    await seed('ABGA', noIdx);
    t('uid: fehlender seatByUid-Eintrag -> Callable permission', (await err(() => start('ABGA', UID[1]))) === 'permission');
    t('uid: inkonsistentes Roster verhindert clockStart komplett (fail-closed)',
      (await err(() => start('ABGA', UID[0]))) === 'failed');
    const wrongIdx = roomN(2);
    wrongIdx.seatByUid[UID[1]] = 0;                    // Index zeigt auf fremden Seat
    await seed('ABGB', wrongIdx);
    t('uid: seatByUid zeigt auf falschen Seat -> permission', (await err(() => start('ABGB', UID[1]))) === 'permission');
    t('uid: Widerspruch blockiert auch den konsistenten Aufrufer (Roster-Pruefung)',
      (await err(() => start('ABGB', UID[0]))) === 'failed');
    const contra = roomN(2);
    contra.players[1].uid = UX;                        // players sagt UX, Index sagt UID[1]
    await seed('ABGC', contra);
    t('uid: players.uid und seatByUid widersprechen sich -> permission', (await err(() => start('ABGC', UID[1]))) === 'permission');
    t('uid: konsistente Zuordnung startet weiterhin normal', (await start('ABCD', UID[1])).status === 'exists');

    // ── 15) BEGRENZTER LIVE-STATE + CRASH-SICHERE ARCHIVIERUNG ─────────────
    // (a) Transaction-Scope: NUR g/<gen>/live und der einzelne t/<turn> —
    //     bewiesen ueber eine Pfad-protokollierende Fassade UND eine grosse
    //     kuenstliche Historie (500 Turns), die byte-identisch bleibt.
    const bigHist = {};
    for (let i = 100; i < 600; i++) bigHist[i] = { 0: { idx: 0, dx: 1, dy: 1, sp: 0, t: i }, 1: { ns: 'stand' } };
    await seed('ABFB', roomN(2));
    await db.ref('rooms/ABFB/g/0/t').set(bigHist);
    const txPaths = [];
    const spy = core.createArbiter({ db: wrapDb((p) => txPaths.push(p)), now: () => simNow });
    simNow = BASE;
    await spy.clockStart({ room: 'ABFB', uid: UID[0] });
    await commit('ABFB', 0, 0, 0); await commit('ABFB', 0, 0, 1);
    simNow = BASE + 2000;
    const cBig = await spy.clockClose({ room: 'ABFB', phaseId: '0:0', uid: UID[0] });
    await spy.clockSettle({ room: 'ABFB', phaseId: '0:0', uid: UID[0], hash: 'h', next: [0, 1] });
    await spy.clockSettle({ room: 'ABFB', phaseId: '0:0', uid: UID[1], hash: 'h', next: [0, 1] });
    t('live: Close/Settle funktionieren unveraendert neben 500 History-Turns',
      cBig.status === 'closed' && (await clockOf('ABFB')).turn === 1);
    t('live: Transactions beruehren AUSSCHLIESSLICH live und t/<turn>',
      txPaths.length > 0 && txPaths.every((p) => p === 'rooms/ABFB/g/0/live' || p === 'rooms/ABFB/g/0/t/0'));
    const histAll = (await db.ref('rooms/ABFB/g/0/t').get()).val();
    t('live: grosse Historie bleibt byte-identisch (500 Turns + neuer t/0)',
      Object.keys(histAll).length === 501 && core.canonical(histAll[350]) === core.canonical(bigHist[350]));
    t('live: live-Groesse unabhaengig von der Historie (nur clock nach Phasenwechsel)',
      Object.keys((await liveOf('ABFB')) || {}).join(',') === 'clock' && (await clockOf('ABFB')).settled == null);
    // (b) Write-once-Historie: eine bereits existierende, ABWEICHENDE t/<turn>
    //     wird nie ueberschrieben — kontrollierter desync.
    const conflict = roomN(2);
    await seed('ABFC', conflict);
    await db.ref('rooms/ABFC/g/0/t/0').set({ 0: { idx: 0, dx: 55, dy: 5, sp: 0, t: 0 } });
    simNow = BASE;
    await start('ABFC');
    await commit('ABFC', 0, 0, 0); await commit('ABFC', 0, 0, 1);
    simNow = BASE + 2000;
    const cM = await close('ABFC', '0:0');
    t('archiv: abweichende bestehende Historie -> kontrollierter desync',
      cM.clock.phase === 'finished' && cM.clock.reason === 'desync');
    t('archiv: bestehende Historie bleibt write-once unangetastet',
      (await hist('ABFC', 0, 0))[0].dx === 55 && (await hist('ABFC', 0, 0))[1] == null);
    t('archiv: desync ist terminal — Settle danach stale', (await rep('ABFC', '0:0', 0, 'h', [0, 1])).status === 'stale');
    // (c) Crash DIREKT NACH dem atomaren Close (vor dem History-Write):
    await seed('ABFD', roomN(2));
    simNow = BASE;
    await start('ABFD');
    await commit('ABFD', 0, 0, 0); await commit('ABFD', 0, 0, 1);
    simNow = BASE + 2000;
    const crash1 = core.createArbiter({ db: failDb((p) => /\/t\/0$/.test(p)), now: () => simNow });
    t('crash: Abbruch direkt nach atomarem Close wirft', (await err(() => crash1.clockClose({ room: 'ABFD', phaseId: '0:0', uid: UID[0] }))) === 'error');
    const lvD = await liveOf('ABFD');
    t('crash: Close committed, Archiv offen (archived=false, t/0 fehlt)',
      lvD.clock.phase === 'resolving' && lvD.clock.archived === false && (await hist('ABFD', 0, 0)) == null);
    simNow = BASE + 3000;
    const rD1 = await rep('ABFD', '0:0', 0, 'h', [0, 1]);
    t('crash: clockSettle repariert die Archivierung', rD1.status === 'pending' && rD1.clock.archived === true);
    t('crash: t/0 nachgeholt und inhaltlich korrekt', (await hist('ABFD', 0, 0))[0].dx === 100 && (await hist('ABFD', 0, 0))[1].dx === 100);
    const rD2 = await rep('ABFD', '0:0', 1, 'h', [0, 1]);
    t('crash: kein verlorener Turn — Folgephase 0:1 oeffnet normal', rD2.clock.phase === 'aim' && rD2.clock.turn === 1);
    // (d) Crash NACH dem History-Write, aber VOR der Archiv-Bestaetigung:
    await seed('ABFE', roomN(2));
    simNow = BASE;
    await start('ABFE');
    await commit('ABFE', 0, 0, 0); await commit('ABFE', 0, 0, 1);
    simNow = BASE + 2000;
    let liveTx = 0;
    const crash2 = core.createArbiter({
      db: failDb((p) => /\/live$/.test(p) && (++liveTx) === 2),   // 1. live-Txn = Close, 2. = Bestaetigung
      now: () => simNow,
    });
    t('crash: Abbruch nach History-Write wirft', (await err(() => crash2.clockClose({ room: 'ABFE', phaseId: '0:0', uid: UID[0] }))) === 'error');
    const histE = await hist('ABFE', 0, 0);
    t('crash: t/0 geschrieben, Bestaetigung offen', histE != null && (await clockOf('ABFE')).archived === false);
    // Reparatur durch erneuten clockClose (stale-Pfad): idempotenter Archiv-Retry.
    const cRepair = await close('ABFE', '0:0');
    t('crash: erneuter clockClose repariert (stale + archived=true)',
      cRepair.status === 'stale' && cRepair.clock.archived === true);
    t('crash: identischer Archiv-Retry idempotent — kein doppelter History-Turn',
      core.canonical(await hist('ABFE', 0, 0)) === core.canonical(histE));
    await rep('ABFE', '0:0', 0, 'h', [0, 1]);
    const rE = await rep('ABFE', '0:0', 1, 'h', [0, 1]);
    t('crash: danach normales Quorum -> genau eine Folgephase', rE.clock.turn === 1 && rE.clock.phase === 'aim');
    // (e) KEINE Folgephase ohne bestaetigte Archivierung — auch nicht mit
    //     vollem Quorum, solange die Archivierung scheitert.
    await seed('ABFF', roomN(2));
    simNow = BASE;
    await start('ABFF');
    await commit('ABFF', 0, 0, 0); await commit('ABFF', 0, 0, 1);
    simNow = BASE + 2000;
    const crash3 = core.createArbiter({ db: failDb((p) => /\/t\/0$/.test(p)), now: () => simNow });
    await err(() => crash3.clockClose({ room: 'ABFF', phaseId: '0:0', uid: UID[0] }));
    t('archiv: Settle mit scheiternder Archivierung wirft und oeffnet NICHTS',
      (await err(() => crash3.clockSettle({ room: 'ABFF', phaseId: '0:0', uid: UID[0], hash: 'h', next: [0, 1] }))) === 'error');
    const lvF = await liveOf('ABFF');
    t('archiv: keine Folgephase ohne bestaetigte Archivierung',
      lvF.clock.phase === 'resolving' && lvF.clock.turn === 0 && lvF.clock.archived === false && lvF.clock.settled == null);
    await rep('ABFF', '0:0', 0, 'h', [0, 1]);
    const rF = await rep('ABFF', '0:0', 1, 'h', [0, 1]);
    t('archiv: nach Reparatur oeffnet das Quorum genau eine Folgephase',
      rF.clock.turn === 1 && rF.clock.phase === 'aim' && (await hist('ABFF', 0, 0)) != null);

    // ── 16) GEN-HAERTUNG: Clients koennen keine frische 60-s-Uhr erzwingen ──
    await seed('ABFG', roomN(2));
    simNow = BASE;
    t('gen: ClockStart mit zukuenftiger Generation abgelehnt', (await err(() => arb.clockStart({ room: 'ABFG', uid: UID[0], gen: 1 }))) === 'failed');
    t('gen: ClockStart mit alter Generation abgelehnt', (await err(() => arb.clockStart({ room: 'ABFG', uid: UID[0], gen: -1 }))) === 'failed');
    const gs = await arb.clockStart({ room: 'ABFG', uid: UID[0], gen: 0 });
    t('gen: ClockStart mit exakter room.gen erlaubt', gs.status === 'started');
    await commit('ABFG', 0, 0, 0); await commit('ABFG', 0, 0, 1);
    simNow = BASE + 3000;
    await close('ABFG', '0:0');
    simNow = BASE + 4000;
    await rep('ABFG', '0:0', 0, 'h', [0, 1]); await rep('ABFG', '0:0', 1, 'h', [0, 1]);
    const beforeRestart = await clockOf('ABFG');
    const gs2 = await start('ABFG');
    t('gen: zweiter ClockStart ist exists und setzt remainingMs nicht zurueck',
      gs2.status === 'exists' && gs2.clock.remainingMs === 57000 && gs2.clock.turn === 1);
    t('gen: Anker nach erneutem Start byte-identisch', JSON.stringify(await clockOf('ABFG')) === JSON.stringify(beforeRestart));
    const gs3 = await start('ABDH');                     // ABDH ist nach der Leiter expired
    t('gen: ClockStart nach cracked/expired setzt Flags nicht zurueck',
      gs3.status === 'exists' && gs3.clock.expired === true && gs3.clock.cracked === true && gs3.clock.remainingMs === 0);
    await seed('ABFJ', roomN(2));
    simNow = BASE;
    const parG = await Promise.all([start('ABFJ'), start('ABFJ', UID[1])]);
    t('gen: parallele ClockStarts erzeugen genau einen Anker',
      parG.filter((r) => r.status === 'started').length === 1);
    t('gen: beide Aufrufer sehen denselben Anker', JSON.stringify(parG[0].clock) === JSON.stringify(parG[1].clock));
    // Rules: room.gen ist fuer v4-Clients vollstaendig gesperrt; v3 unveraendert.
    t('gen: v4-Client kann room.gen nicht schreiben (Host)', (await restPut('rooms/ABFG/gen', 1, UID[0])) === false);
    t('gen: v4-Client kann room.gen nicht schreiben (Gast)', (await restPut('rooms/ABFG/gen', 1, UID[1])) === false);
    t('gen: v4 Same-Value-Write ebenfalls verboten', (await restPut('rooms/ABFG/gen', 0, UID[0])) === false);
    t('gen: v4 ohne Auth ebenfalls verboten', (await restPut('rooms/ABFG/gen', 1)) === false);
    t('gen: v3-Gen-Bump bleibt ohne Auth erlaubt (Bestand)', (await restPut('rooms/ABDP/gen', 1)) === true);

    // ── 17) CREATE-PREFILL-BYPASS: seatByUid ist unter KEINEM Typ client-schreibbar ──
    //    Review-Blocker: ein SKALARER seatByUid-Wert hat keine Kinder, die
    //    `$uid`-Kindregel feuerte also nie. Jetzt lehnt die Raum-.validate das Feld
    //    auf Parent-Ebene ab und der Knoten selbst ist per `.validate: false`
    //    gesperrt. Geprueft gegen den ECHTEN Emulator ueber die Client-REST-Sicht.
    const SV = { '.sv': 'timestamp' };
    const create4 = (uid, over) => Object.assign({
      v: 4, config: { winTarget: 3, fmt: 'single', visibility: 'private' },
      gen: 0, state: 'lobby', created: SV,
      p: { 0: { s: TAB[0], on: false, t: SV } },
      players: { 0: { id: 'PLAYER00', name: 'P0', tab: TAB[0], uid } },
    }, over || {});
    const noIndex = async (code) => (await db.ref('rooms/' + code + '/seatByUid').get()).val() === null;
    t('create-bypass: v4-Create OHNE seatByUid bleibt erlaubt (Kontrolle)',
      (await restPut('rooms/ABHA', create4(UID[0]), UID[0])) === true && (await noIndex('ABHA')));
    t('create-bypass: seatByUid als Zahl abgelehnt',
      (await restPut('rooms/ABHB', create4(UID[0], { seatByUid: 0 }), UID[0])) === false && (await noIndex('ABHB')));
    t('create-bypass: seatByUid als String abgelehnt',
      (await restPut('rooms/ABHC', create4(UID[0], { seatByUid: '0' }), UID[0])) === false && (await noIndex('ABHC')));
    t('create-bypass: seatByUid als Boolean abgelehnt',
      (await restPut('rooms/ABHD', create4(UID[0], { seatByUid: true }), UID[0])) === false && (await noIndex('ABHD')));
    t('create-bypass: seatByUid als Liste abgelehnt',
      (await restPut('rooms/ABHE', create4(UID[0], { seatByUid: [0, 1] }), UID[0])) === false && (await noIndex('ABHE')));
    t('create-bypass: seatByUid mit einem Eintrag abgelehnt',
      (await restPut('rooms/ABHF', create4(UID[0], { seatByUid: { [UID[0]]: 0 } }), UID[0])) === false && (await noIndex('ABHF')));
    t('create-bypass: seatByUid mit mehreren Eintraegen abgelehnt',
      (await restPut('rooms/ABHG', create4(UID[0], { seatByUid: { [UID[0]]: 0, [UX]: 1 } }), UID[0])) === false && (await noIndex('ABHG')));
    // Leere Container ({} / []) sind in RTDB gleichbedeutend mit null und werden
    // bereits VOR der Regelauswertung verworfen — der Create geht deshalb durch
    // (am Emulator verifiziert), traegt danach aber kein seatByUid. Ein Deny waere
    // hier nicht erzwingbar und auch nicht die relevante Eigenschaft; geprueft wird
    // die Invariante, die zaehlt: es entsteht KEIN vorbefuellter Index.
    await restPut('rooms/ABHJ', create4(UID[0], { seatByUid: {} }), UID[0]);
    t('create-bypass: leeres Objekt plant keinen Index', await noIndex('ABHJ'));
    await restPut('rooms/ABHK', create4(UID[0], { seatByUid: [] }), UID[0]);
    t('create-bypass: leere Liste plant keinen Index', await noIndex('ABHK'));
    // Spaetere Client-Writes auf den bestehenden Raum: jede Form abgelehnt.
    t('create-bypass: spaeterer Write des ganzen Index abgelehnt',
      (await restPut('rooms/ABHA/seatByUid', { [UID[0]]: 0 }, UID[0])) === false);
    t('create-bypass: spaeterer Skalar-Write des Index abgelehnt',
      (await restPut('rooms/ABHA/seatByUid', 0, UID[0])) === false);
    t('create-bypass: einzelner Kind-Write abgelehnt',
      (await restPut('rooms/ABHA/seatByUid/' + UID[0], 0, UID[0])) === false);
    t('create-bypass: Delete des Index abgelehnt (bestehender Index)',
      (await restPut('rooms/ABDL/seatByUid', null, UID[0])) === false
      && (await db.ref('rooms/ABDL/seatByUid').get()).val() != null);
    t('create-bypass: Delete eines einzelnen Eintrags abgelehnt',
      (await restPut('rooms/ABDL/seatByUid/' + UID[1], null, UID[1])) === false);
    t('create-bypass: Admin-SDK schreibt den Index weiterhin (Arbiter-Pfad)',
      await (async () => {
        await db.ref('rooms/ABHA/seatByUid').set({ [UID[0]]: 0 });
        return (await db.ref('rooms/ABHA/seatByUid/' + UID[0]).get()).val() === 0;
      })());
    // Angrenzende server-owned Felder: dieselbe Kaskade, auch als Skalar.
    t('create-bypass: g als Skalar im Create abgelehnt',
      (await restPut('rooms/ABHM', create4(UID[0], { g: 1 }), UID[0])) === false);
    t('create-bypass: vorbefuellte Turn-Historie im Create abgelehnt',
      (await restPut('rooms/ABHN', create4(UID[0], { g: { 0: { t: { 0: { 0: MOVE } } } } }), UID[0])) === false);
    t('create-bypass: vorbefuellter live/clock im Create abgelehnt',
      (await restPut('rooms/ABHP', create4(UID[0], LIVE_CLOCK(core.aimAnchor(0, 0, 60000, Date.now(), '0,1', {}))), UID[0])) === false);
    t('create-bypass: alter clock-Pfad als Skalar im Create abgelehnt',
      (await restPut('rooms/ABHQ', create4(UID[0], { clock: 1 }), UID[0])) === false);
    // v3 bleibt unveraendert: Create ohne Auth und ohne uid weiterhin erlaubt.
    const v3create = create4(undefined);
    v3create.v = 3;
    delete v3create.players[0].uid;
    t('create-bypass: v3-Create bleibt ohne Auth erlaubt (Bestand)',
      (await restPut('rooms/ABHR', v3create)) === true);

    exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('FAIL: unerwarteter Fehler:', e && e.stack || e);
    exitCode = 2;
  } finally {
    try { await admin.app().delete(); } catch (e) {}
    await killTree(emu.child.pid);
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\nAction-Clock-Arbiter (RTDB-Emulator): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(exitCode);
})();
