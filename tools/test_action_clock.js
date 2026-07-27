// Action-Clock ARBITER — serverseitige Autoritaet gegen den ECHTEN RTDB-Emulator.
//
// Diese Suite treibt EXAKT den Produktions-Arbiter (functions/clock-core.js, per
// Dependency-Injection mit kontrollierter Zeit — keine Sleeps, keine Wanduhr im
// Kern) gegen einen frisch gestarteten RTDB-Emulator (JDK 21) mit den ECHTEN
// firebase.rules.json. Admin-SDK-Writes des Arbiters umgehen die Rules (wie in
// Produktion); zusaetzlich beweisen REST-Checks gegen den Emulator, dass Clients
// rooms/<code>/g/<gen>/clock nie beschreiben koennen und v4-Slots auth-, phasen-
// und eligibleSeats-gebunden sind.
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
// n besetzte Seats, alle online. seats-Feld nur fuer die FFA-Familie (wie v3).
function roomN(n, fmt, over) {
  const p = {}, players = {};
  for (let s = 0; s < n; s++) {
    p[s] = { s: TAB[s], on: true, t: BASE };
    players[s] = { id: 'PLAYER0' + s, name: 'P' + s, tab: TAB[s], uid: UID[s] };
  }
  const r = {
    v: 4, config: { winTarget: 3, fmt: fmt || 'single', visibility: 'private' },
    gen: 0, state: 'playing', created: BASE - 5000, p, players,
  };
  if (fmt && fmt !== 'single' && fmt !== 'double') r.seats = n;
  return Object.assign(r, over || {});
}
const MOVE = { idx: 0, dx: 100, dy: -50, sp: 0.5 };

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
    const clockOf = async (code, g) => (await db.ref(`rooms/${code}/g/${g || 0}/clock`).get()).val();
    const slotsOf = async (code, g, tn) => (await db.ref(`rooms/${code}/g/${g}/t/${tn}`).get()).val() || {};
    const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || 'error'; } };
    const start = (code, uid) => arb.clockStart({ room: code, uid: uid || UID[0] });
    const close = (code, phaseId, uid) => arb.clockClose({ room: code, phaseId, uid: uid || UID[0] });
    const rep = (code, phaseId, seat, hash, next) =>
      arb.clockSettle({ room: code, phaseId, uid: UID[seat], hash, next });
    const commit = (code, g, tn, seat) => db.ref(`rooms/${code}/g/${g}/t/${tn}/${seat}`).set(Object.assign({}, MOVE, { idx: seat }));

    // ── 1) clockStart: Ownership, exakter Anker, generationsgebundener Pfad ──
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
    t('start: Anker liegt generationsgebunden unter g/0/clock', (await clockOf('ABCD')).phaseId === '0:0');
    t('start: kein raumweiter clock-Knoten mehr', (await db.ref('rooms/ABCD/clock').get()).val() === null);
    t('start: zweiter Aufruf idempotent', (await start('ABCD', UID[1])).status === 'exists');

    // ── 2) Close: vorzeitig verboten, exakter Zeitabzug, genau ein Abschluss ──
    t('close: vor Deadline mit offenen Commits abgelehnt', (await err(() => close('ABCD', '0:0'))) === 'too-early');
    await commit('ABCD', 0, 0, 0); await commit('ABCD', 0, 0, 1);
    simNow = BASE + 3000;
    const c1 = await close('ABCD', '0:0');
    t('close: alle Commits -> resolving', c1.status === 'closed' && c1.clock.phase === 'resolving');
    t('close: exakt 3000 aktive ms abgezogen', c1.clock.remainingMs === 57000);
    t('close: settleDeadlineAt serverseitig gesetzt', c1.clock.settleDeadlineAt === simNow + core.SETTLE_GRACE_MS);
    t('close: echte Commits unangetastet', (await slotsOf('ABCD', 0, 0))[0].dx === 100);
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
    t('settle: alte Phase stale (kein Doppel-Start)', (await rep('ABCD', '0:0', 0, 'h1', [0, 1])).status === 'stale');

    // ── 4) Timeout-Close: fehlende Slots als verbindlicher No-Shot ──
    await commit('ABCD', 0, 1, 0);
    t('close: Timeout vor Deadline abgelehnt', (await err(() => close('ABCD', '0:1'))) === 'too-early');
    simNow = BASE + 17000;                               // Deadline EXAKT erreicht
    const c2 = await close('ABCD', '0:1');
    const sl2 = await slotsOf('ABCD', 0, 1);
    t('close: Abschluss exakt auf der Deadline erlaubt', c2.status === 'closed');
    t('close: voller Fensterverbrauch (57000-7000)', c2.clock.remainingMs === 50000);
    t('close: echter Commit unangetastet', sl2[0].dx === 100);
    t('close: offener Seat -> verbindlicher No-Shot {ns:stand}', sl2[1] && sl2[1].ns === 'stand');
    t('close: zweiter Timeout-Versuch stale, Slots stabil',
      (await close('ABCD', '0:1', UID[1])).status === 'stale' && (await slotsOf('ABCD', 0, 1))[1].ns === 'stand');

    // ── 5) ATOMARER CLOSE (5 Seats, mehrere fehlende Slots) ─────────────────
    //    Ein Listener auf g/0 protokolliert JEDEN beobachtbaren Zustand: es darf
    //    weder eine aim-Phase mit bereits gebuchten No-Shots noch eine resolving-
    //    Phase mit unvollstaendigen Slots geben. Genau das war vor diesem Fix
    //    moeglich (Slot-Transactions zuerst, Clock-Transaction danach).
    await seed('ABCP', roomN(5, 'ffa'));
    simNow = BASE;
    await start('ABCP');
    const gref = db.ref('rooms/ABCP/g/0');
    const seen = [];
    const filled = (e) => { const s = (e.t && e.t['0']) || {}; let n = 0; for (let i = 0; i < 5; i++) if (s[i] != null) n++; return n; };
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
    const slP = await slotsOf('ABCP', 0, 0);
    t('atomic: alle 5 Slots gebucht', [0, 1, 2, 3, 4].every((s) => slP[s] != null));
    t('atomic: kein Zwischenzustand aim + Fremdbuchung', seen.every((e) => phaseOf(e) !== 'aim' || filled(e) <= 2));
    t('atomic: kein Zwischenzustand resolving + unvollstaendig', seen.every((e) => phaseOf(e) !== 'resolving' || filled(e) === 5));
    t('atomic: Uebergang wurde ueberhaupt beobachtet', seen.some((e) => phaseOf(e) === 'resolving'));
    t('atomic: nur stand-Sentinels, nie left', [1, 2, 4].every((s) => (seen[seen.length - 1].t['0'][s] || {}).ns === 'stand'));

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
    const slQ = await slotsOf('ABCQ', 0, 0);
    t('atomic: parallele Close hinterlassen konsistente Slots',
      slQ[0].dx === 100 && slQ[1].ns === 'stand' && slQ[2].ns === 'stand');
    t('atomic: parallele Close ziehen die Zeit nur EINMAL ab', (await clockOf('ABCQ')).remainingMs === 53000);

    // ── 6) Commit gegen Timeout ─────────────────────────────────────────────
    //    Rules rechnen mit der ECHTEN Serveruhr (now), daher hier Anker mit
    //    Date.now() statt simNow.
    await seed('ABCR', roomN(2, 'single', { g: { 0: { clock: core.aimAnchor(0, 0, 60000, Date.now(), '0,1', {}) } } }));
    t('commit: echter Commit kurz vor der Deadline gewinnt', (await restPut('rooms/ABCR/g/0/t/0/1', MOVE, UID[1])) === true);
    await seed('ABCS', roomN(2, 'single', { g: { 0: { clock: core.aimAnchor(0, 0, 60000, Date.now() - 60000, '0,1', {}) } } }));
    t('commit: Commit NACH der Deadline in leeren Slot abgelehnt', (await restPut('rooms/ABCS/g/0/t/0/0', MOVE, UID[0])) === false);
    // Timeout und echter Commit gleichzeitig: der Slot traegt danach GENAU eine
    // der beiden Formen — nie eine Mischung, nie zwei Abschluesse.
    await seed('ABCT', roomN(2));
    simNow = BASE;
    await start('ABCT');
    await commit('ABCT', 0, 0, 0);
    simNow = BASE + 7000;
    const race = await Promise.all([
      close('ABCT', '0:0'),
      db.ref('rooms/ABCT/g/0/t/0/1').transaction((cur) => (cur == null ? Object.assign({}, MOVE, { idx: 1 }) : undefined)),
    ]);
    const slT = (await slotsOf('ABCT', 0, 0))[1];
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
    t('presence: geloeschte Presence erzeugt KEIN left, sondern stand', (await slotsOf('ABCU', 0, 0))[1].ns === 'stand');
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
    t('presence: Reconnect waehrend Close -> weiterhin stand', (await slotsOf('ABCV', 0, 0))[1].ns === 'stand');
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
    t('elim: kein No-Shot fuer den eliminierten Seat', (await slotsOf('ABDA', 0, 1))[1] == null);
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

    // ── 11) Reconnect-Vollstaendigkeit: alles aus EINEM kalten Read ─────────
    const cold = await clockOf('ABCD');
    t('reconnect: alle Vertragsfelder im Anker vorhanden',
      ['v', 'gen', 'turn', 'phaseId', 'phase', 'startedAt', 'remainingMs', 'eligibleSeats', 'cracked', 'expired']
        .every((k) => cold[k] !== undefined));

    // ── 12) Rules gegen den ECHTEN Emulator ────────────────────────────────
    await seed('ABDL', roomN(2, 'single', { g: { 0: { clock: core.aimAnchor(0, 0, 60000, Date.now(), '0,1', {}) } } }));
    t('rules: clock-Write ohne Auth abgelehnt', (await restPut('rooms/ABDL/g/0/clock', { hack: 1 })) === false);
    t('rules: clock-Write mit Auth abgelehnt', (await restPut('rooms/ABDL/g/0/clock/deadlineAt', 9999999999999, UID[0])) === false);
    t('rules: alter Raumpfad rooms/<code>/clock bleibt zu', (await restPut('rooms/ABDL/clock', { hack: 1 }, UID[0])) === false);
    t('rules: v4-Slot ohne Auth abgelehnt', (await restPut('rooms/ABDL/g/0/t/0/0', MOVE)) === false);
    t('rules: v4-Slot eigener Seat vor Deadline erlaubt', (await restPut('rooms/ABDL/g/0/t/0/0', MOVE, UID[0])) === true);
    t('rules: v4-Slot fremder Seat abgelehnt', (await restPut('rooms/ABDL/g/0/t/0/1', MOVE, UID[0])) === false);
    await seed('ABDM', roomN(3, 'ffa', { g: { 0: { clock: core.aimAnchor(0, 0, 60000, Date.now(), '0,2', {}) } } }));
    t('rules: Seat ausserhalb eligibleSeats abgelehnt', (await restPut('rooms/ABDM/g/0/t/0/1', MOVE, UID[1])) === false);
    t('rules: Seat in eligibleSeats erlaubt', (await restPut('rooms/ABDM/g/0/t/0/2', Object.assign({}, MOVE, { idx: 2 }), UID[2])) === true);
    await seed('ABDN', roomN(2, 'single', { g: { 1: { clock: core.aimAnchor(1, 0, 60000, Date.now(), '0,1', {}) } } }));
    t('rules: Anker fremder Generation deckt g/0 nicht', (await restPut('rooms/ABDN/g/0/t/0/0', MOVE, UID[0])) === false);
    const v3room = roomN(2);
    v3room.v = 3;
    delete v3room.players[0].uid; delete v3room.players[1].uid;
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
    t('P1: clock auf freien Raumcode abgelehnt',
      (await restPut('rooms/ZZZZ/g/0/clock', core.aimAnchor(0, 0, 60000, Date.now(), '0,1', {}), UA)) === false);
    t('P1: Turn-Slot auf freien Raumcode abgelehnt', (await restPut('rooms/ZZZY/g/0/t/0/0', MOVE, UA)) === false);
    t('P1: Teil-Raum auf freien Code abgelehnt', (await restPut('rooms/ZZZX/config', { winTarget: 3, fmt: 'single', visibility: 'private' }, UA)) === false);
    t('P1: clock in bestehendem Raum bleibt unbeschreibbar', (await restPut('rooms/ABDL/g/0/clock/remainingMs', 60000, UID[0])) === false);

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
