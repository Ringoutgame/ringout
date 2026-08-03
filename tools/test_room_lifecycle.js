// v4-ROOM-LIFECYCLE — serverseitige Create/Join/Activate/Leave/Start/Rematch-
// Callables gegen den ECHTEN RTDB- UND Functions-Emulator (Phase IIIB,
// gehaertet nach Review).
//
// Diese Suite treibt EXAKT die Produktionskerne (functions/room-core.js und
// functions/clock-core.js, per Dependency-Injection mit kontrollierter Zeit —
// keine Sleeps, keine Wanduhr) gegen einen frisch gestarteten RTDB-Emulator
// (JDK 21) mit den ECHTEN firebase.rules.json. Zusaetzlich startet die Suite
// den ECHTEN Functions-Emulator ueber functions/index.js und prueft die
// Callable-WRAPPER (Auth-Pflicht, Argument-Allowlist, Fehlercode-Mapping)
// ueber das HTTP-Callable-Protokoll — keine Produktion wird kontaktiert.
//
// Gehaertete Vertraege (Final Hardening):
//   - Zweistufiger Session-Handshake: Join/Create liefern NUR eine pending
//     Session (token + leaseId + expiresAt); erst roomActivateV4 macht daraus
//     active + Online-Presence. Der Client registriert onDisconnect mit dem
//     pending Token VOR dem Activate.
//   - Vollstaendige Sessionbindung: sess/<seat>/active ist Pflicht-CAS fuer
//     Moves (Rules-Feld sid), clockClose/clockSettle, Leave/Start/Rematch.
//   - Reservation-Lease: nie aktivierte, abgelaufene Reservierungen werden
//     beim naechsten Join recycelt; aktive Seats NIE.
//   - roomInstanceId (iid) an allen autoritativen Grenzen inkl. Arbiter.
//   - Listing-Cleanup: Transaction auf publicRooms/<code>, strikt iid-gebunden.
//   - Create: provisional bis Marker-Abschluss (nicht joinbar/listbar).
//   - Rematch ist Host-only; Startzeiten entstehen IM Transaction-Lauf.
//
// NICHT im Standard-Runner (tools/run_all_tests.js): braucht JDK 21 + globales
// firebase-tools (wie tools/e2e/). Aufruf: node tools/test_room_lifecycle.js
// (bzw. npm run test:lifecycle)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO = path.dirname(__dirname);
const EMU_HOST = '127.0.0.1', EMU_PORT = 9730, HUB_PORT = 4731, LOG_PORT = 4732, FN_PORT = 5732;
const PROJECT = 'demo-ringout-lifecycle';
const NS = PROJECT + '-default-rtdb';

const core = require(path.join(REPO, 'functions', 'clock-core.js'));
// Restzeit, mit der eine NEUE Generation eroeffnet wird: ein Collapse-Zyklus,
// nicht das Gesamtbudget (Stufenvertrag, s. clock-core/openingAnchor).
const CYCLE = core.CYCLE_MS;
const roomCore = require(path.join(REPO, 'functions', 'room-core.js'));
const admin = require(path.join(REPO, 'functions', 'node_modules', 'firebase-admin'));

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// ── Java-Aufloesung: JAVA_HOME → PATH → dokumentierter Fallback → klarer Fehler ──
const LOCAL_JDK_FALLBACKS = [
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
  // Functions-Quelle: das ECHTE functions/-Verzeichnis des Repos (relativ zum
  // Temp-runDir) — der Emulator laedt exakt functions/index.js (die Wrapper).
  const fnSource = path.relative(runDir, path.join(REPO, 'functions')).split(path.sep).join('/');
  fs.writeFileSync(path.join(runDir, 'firebase.json'), JSON.stringify({
    database: { rules: 'firebase.rules.json' },
    functions: { source: fnSource },
    emulators: {
      singleProjectMode: true,
      database: { host: EMU_HOST, port: EMU_PORT },
      functions: { host: EMU_HOST, port: FN_PORT },
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
  // Auth-Emulator-Modus fuer die Functions-Runtime: verifyIdToken akzeptiert
  // dann unsignierte Emulator-Tokens (es laeuft KEIN echter Auth-Emulator und
  // es wird nichts kontaktiert — nur der Verifikationsmodus schaltet um).
  env.FIREBASE_AUTH_EMULATOR_HOST = EMU_HOST + ':9799';
  const entry = resolveFirebaseEntry();
  if (!entry) { console.error('FAIL: firebase-tools nicht gefunden (npm i -g firebase-tools).'); process.exit(2); }
  const child = spawn(process.execPath, [entry, 'emulators:start', '--only', 'database,functions', '--project', PROJECT], { cwd: runDir, env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return { child, getOutput: () => out };
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitReady(emu, timeoutMs) {
  const until = Date.now() + timeoutMs;
  // 1) Vollstaendiger Start: erst das Ready-Banner garantiert, dass Rules
  //    geladen UND alle Functions registriert sind (Readiness-Polling — der
  //    einzige zulaessige Warte-Mechanismus dieser Suite).
  while (Date.now() < until && !/All emulators ready/.test(emu.getOutput())) {
    if (/Emulator has exited|Error: Could not start/.test(emu.getOutput())) return false;
    await pause(250);
  }
  if (!/All emulators ready/.test(emu.getOutput())) return false;
  // 2) Rules-Canary: ein gesperrter Pfad MUSS abgelehnt werden — laeuft der
  //    Emulator mit offenen Rules, bricht die Suite hier hart ab statt
  //    Sicherheits-Asserts gegen eine offene DB zu "bestehen".
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://${EMU_HOST}:${EMU_PORT}/reqs/canary/x.json?ns=${NS}`, {
        method: 'PUT', body: '{"sig":"x"}', headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) break;
      if (res.ok) { console.error('FAIL: Rules NICHT geladen (Canary-Write ging durch).'); return false; }
    } catch (e) { /* noch nicht bereit */ }
    await pause(250);
  }
  // 3) Callable-Probe: der Wrapper muss antworten (401 UNAUTHENTICATED).
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://${EMU_HOST}:${FN_PORT}/${PROJECT}/europe-west1/roomCreateV4`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}',
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && body.error && body.error.status === 'UNAUTHENTICATED') return true;
    } catch (e) { /* Functions noch nicht bereit */ }
    await pause(250);
  }
  return false;
}
function killTree(pid) {
  return new Promise((resolve) => {
    const k = process.platform === 'win32'
      ? spawn('taskkill', ['/PID', String(pid), '/T', '/F'])
      : spawn('kill', ['-9', String(pid)]);
    k.on('close', (code) => resolve(code === 0));
    k.on('error', () => resolve(false));
  });
}

// ── REST-/Callable-Helfer (Client-Sicht; Fake-JWTs, Emulator prueft keine Signatur) ──
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwtPayload(uid) {
  const iat = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT,
    iat, exp: iat + 3600, auth_time: iat,
    sub: uid, user_id: uid, uid, firebase: { sign_in_provider: 'anonymous', identities: {} },
  };
}
const fakeJwt = (uid) => {
  const header = b64u({ alg: 'HS256', typ: 'JWT' });
  const payload = b64u(jwtPayload(uid));
  const sig = crypto.createHmac('sha256', 'emulator-secret').update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
};
// Callable-Protokoll: unsignierter Emulator-Token (alg none).
const fakeJwtNone = (uid) => b64u({ alg: 'none', typ: 'JWT' }) + '.' + b64u(jwtPayload(uid)) + '.';
async function restWrite(method, p, value, uid) {
  const auth = uid ? '&auth=' + encodeURIComponent(fakeJwt(uid)) : '';
  const res = await fetch(`http://${EMU_HOST}:${EMU_PORT}/${p}.json?ns=${NS}${auth}`, {
    method, body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' },
  });
  return res.ok;
}
const restPut = (p, v, uid) => restWrite('PUT', p, v, uid);
const restPatch = (p, v, uid) => restWrite('PATCH', p, v, uid);
async function callFn(name, data, uid) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = 'Bearer ' + fakeJwtNone(uid);
  const res = await fetch(`http://${EMU_HOST}:${FN_PORT}/${PROJECT}/europe-west1/${name}`, {
    method: 'POST', headers, body: JSON.stringify({ data: data || {} }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, http: res.status, result: body.result, code: body.error && body.error.status };
}

// ── Fixtures ──
const UID = ['uid-lc-seat0-01', 'uid-lc-seat1-01', 'uid-lc-seat2-01', 'uid-lc-seat3-01', 'uid-lc-seat4-01'];
const PID = ['PIDLC000', 'PIDLC001', 'PIDLC002', 'PIDLC003', 'PIDLC004'];
const TAB = ['TABLC000', 'TABLC001', 'TABLC002', 'TABLC003', 'TABLC004'];
const UX = 'uid-lc-fremd-01';
const BASE = 1751900000000;
const CFG = (fmt, vis) => ({ winTarget: 3, fmt: fmt || 'single', visibility: vis || 'private' });
const IDENT = (i) => ({ pid: PID[i], name: 'P' + i, tab: TAB[i] });

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

  const runDir = path.join(os.tmpdir(), 'ringout-room-lifecycle-' + process.pid);
  const emu = startEmulator(runDir, java);
  let exitCode = 2;
  try {
    if (!(await waitReady(emu, 180000)))
      throw new Error('Emulator nicht bereit.\n' + emu.getOutput().slice(-3000));
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = EMU_HOST + ':' + EMU_PORT;
    const app = admin.initializeApp({ projectId: PROJECT, databaseURL: `http://${EMU_HOST}:${EMU_PORT}?ns=${NS}` });
    const db = admin.database(app);
    let simNow = BASE;                                   // injizierte Serverzeit — keine Sleeps
    // Deterministische Codes/IDs/Tokens fuer die Kern-Tests.
    const codeQueue = [];
    let codeSerial = 0, iidSerial = 0, tokSerial = 0;
    const FALLBACK_CODES = ['QQAA', 'QQAB', 'QQAC', 'QQAD', 'QQAE', 'QQAF', 'QQAG', 'QQAH', 'QQBA', 'QQBB', 'QQBC', 'QQBD'];
    const codeGen = () => codeQueue.length ? codeQueue.shift() : FALLBACK_CODES[codeSerial++];
    const idGen = () => 'IIDLC-' + String(1000 + (iidSerial++));
    const tokGen = () => 'SRVTOKLC' + String(1000 + (tokSerial++));
    const mkCore = (dbi) => roomCore.createRoomCore({ db: dbi || db, now: () => simNow, codeGen, idGen, tokGen });
    const rc = mkCore();
    const clk = core.createArbiter({ db, now: () => simNow });
    const roomOf = async (code) => (await db.ref('rooms/' + code).get()).val();
    const clockOf = async (code, g) => (await db.ref(`rooms/${code}/g/${g || 0}/live/clock`).get()).val();
    const liveOf = async (code, g) => (await db.ref(`rooms/${code}/g/${g || 0}/live`).get()).val();
    const iidOf = async (code) => (await db.ref('rooms/' + code + '/iid').get()).val();
    const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || 'error'; } };
    // Alle genannten Seats regulaer aktivieren (Handshake) — Presence und
    // Session sind server-owned, ein direkter on:true-Write existiert nicht mehr.
    const onlineAll = async (code, seats) => { for (const s of seats) await activate(code, s); };
    let reqSerial = 0;
    // Session-Registry der Tests: merkt sich je (code, seat) den zuletzt
    // ausgestellten pending Token bzw. die aktive Session.
    const SESS = {};
    const remember = (code, i, r) => { SESS[code + ':' + i] = r; return r; };
    const sessOf = (code, i) => (SESS[code + ':' + i] || {}).token;
    const create = async (i, over) => {
      const r = await rc.roomCreateV4(Object.assign({
        uid: UID[i], requestId: 'req-basic-' + (i) + '-' + (++reqSerial), config: CFG(),
      }, IDENT(i), over || {}));
      return remember(r.room, i, r);
    };
    const cre = async (i, requestId, cfg, over) => {
      const r = await rc.roomCreateV4(Object.assign({ uid: UID[i], requestId, config: cfg || CFG() }, IDENT(i), over || {}));
      return remember(r.room, i, r);
    };
    const join = async (code, i, over) => {
      const r = await rc.roomJoinV4(Object.assign(
        { uid: UID[i], room: code, iid: await iidOf(code) }, IDENT(i), over || {}));
      return remember(code, i, r);
    };
    // Aktivierung wie im spaeteren Client: onDisconnect (pending Token) wird
    // VOR dem Activate registriert — hier als expliziter Schritt sichtbar.
    const activate = async (code, i, over) => {
      const have = SESS[code + ':' + i] || {};
      const r = await rc.roomActivateV4(Object.assign(
        { uid: UID[i], room: code, iid: await iidOf(code), token: have.token, leaseId: have.leaseId }, over || {}));
      remember(code, i, { token: r.token, leaseId: have.leaseId });
      return r;
    };
    // Join + Aktivierung in einem Schritt (Standardweg der meisten Tests).
    const joinAct = async (code, i) => { const j = await join(code, i); await activate(code, i); return j; };
    // Create + Host-Aktivierung: in der neuen Welt ist auch der HOST erst nach
    // roomActivateV4 handlungsberechtigt (Session aktiv, Presence online).
    const creAct = async (i, requestId, cfg) => { const r = await cre(i, requestId, cfg); await activate(r.room, i); return r; };
    const leave = async (code, i, iid, session) => rc.roomLeaveV4({
      uid: UID[i], room: code, iid: iid || await iidOf(code), session: session || sessOf(code, i),
    });
    const startM = async (code, i, iid, session) => rc.roomStartV4({
      uid: UID[i || 0], room: code, iid: iid || await iidOf(code), session: session || sessOf(code, i || 0),
    });
    const rematch = async (code, i, expectedGen, iid, session) => rc.roomRematchV4({
      uid: UID[i], room: code, expectedGen, iid: iid || await iidOf(code), session: session || sessOf(code, i),
    });
    // Test-Fassade: Transaction-Pfade protokollieren, gezielt scheitern lassen
    // oder VOR einer Transaction einen Seiteneffekt ausfuehren (Race-Simulation).
    const hookDb = (hooks) => ({
      ref: (p) => {
        const real = db.ref(p);
        return new Proxy(real, {
          get(target, k) {
            if (k === 'transaction') {
              return async (fn) => {
                if (hooks.beforeTx) await hooks.beforeTx(p);
                if (hooks.failTx && hooks.failTx(p)) throw new Error('simulierter Absturz');
                if (hooks.onTx) hooks.onTx(p);
                return target.transaction(fn);
              };
            }
            if (k === 'set' && hooks.failSet) {
              return (v) => {
                if (hooks.failSet(p)) return Promise.reject(new Error('simulierter Absturz'));
                return target.set(v);
              };
            }
            const v = target[k];
            return typeof v === 'function' ? v.bind(target) : v;
          },
        });
      },
    });

    // ── 1) CREATE: gueltige Raeume, server-owned Zustand ────────────────────
    codeQueue.push('ABJA');
    const c1 = await create(0);
    t('create: privater v4-Raum erstellt', c1.status === 'created' && c1.room === 'ABJA' && c1.seat === 0);
    const r1 = await roomOf('ABJA');
    t('create: v4/lobby/gen0/created serverseitig', r1.v === 4 && r1.state === 'lobby' && r1.gen === 0 && r1.created === BASE);
    t('create: servergenerierte roomInstanceId gesetzt und zurueckgegeben',
      typeof r1.iid === 'string' && r1.iid.length >= 8 && c1.iid === r1.iid);
    t('create: Host-Record vollstaendig (id/name/tab/uid)',
      r1.players[0].id === PID[0] && r1.players[0].name === 'P0' && r1.players[0].tab === TAB[0] && r1.players[0].uid === UID[0]);
    t('create: seatByUid konsistent auf Seat 0', r1.seatByUid[UID[0]] === 0 && Object.keys(r1.seatByUid).length === 1);
    t('create: Session PENDING (nie sofort aktiv), Lease serverseitig gesetzt',
      r1.sess[0].active == null && r1.sess[0].pending.token === c1.token
      && r1.sess[0].pending.leaseId === c1.leaseId
      && r1.sess[0].pending.expiresAt === BASE + roomCore.RESERVE_LEASE_MS
      && r1.sess[0].iid === r1.iid);
    t('create: Token ist servergeneriert (nicht der Client-tab)', c1.token !== TAB[0] && typeof c1.token === 'string');
    t('create: genau ein Seat belegt', Object.keys(r1.players).length === 1);
    t('create: Presence reserviert (on:false) mit pending Token', r1.p[0].on === false && r1.p[0].s === c1.token);
    t('create: Raum ist bis zum Marker-Abschluss NICHT provisional (Marker lief durch)', r1.provisional === undefined);
    t('create: kein Clock-/History-/seats-Prefill', r1.g === undefined && r1.clock === undefined && r1.seats === undefined);
    t('create: Marker complete mit Code+iid persistiert',
      await (async () => {
        const m = (await db.ref('reqs/' + UID[0]).get()).val();
        const k = Object.keys(m)[0];
        return m[k].state === 'complete' && m[k].code === 'ABJA' && m[k].iid === r1.iid && m[k].sig != null;
      })());
    codeQueue.push('ABJB');
    const c2 = await cre(1, 'req-public-0001', CFG('ffa', 'public'));
    t('create: oeffentlicher FFA-Raum erstellt', c2.status === 'created' && (await roomOf('ABJB')).config.visibility === 'public');
    t('create: Server schreibt KEIN Public-Listing (Host-Client nach Aktivierung, wie v3)',
      (await db.ref('publicRooms').get()).val() === null);
    codeQueue.push('ABJC');
    const c3 = await rc.roomCreateV4(Object.assign({ uid: UID[2], requestId: 'req-name-00001', config: CFG() }, IDENT(2), { name: '  Na\u0000me\u202E ' + 'x'.repeat(60) }));
    const n3 = (await roomOf('ABJC')).players[0].name;
    t('create: Name sanitisiert und gecappt', c3.status === 'created' && n3.indexOf('\u0000') < 0 && n3.indexOf('\u202E') < 0 && n3.length <= 48 && n3.slice(0, 4) === 'Name');
    t('create: winTarget 4 abgelehnt', (await err(() => create(0, { requestId: 'req-bad-000001', config: { winTarget: 4, fmt: 'single', visibility: 'private' } }))) === 'invalid');
    t('create: unbekanntes fmt abgelehnt', (await err(() => create(0, { requestId: 'req-bad-000002', config: { winTarget: 3, fmt: 'x', visibility: 'private' } }))) === 'invalid');
    t('create: Extra-Feld in config abgelehnt', (await err(() => create(0, { requestId: 'req-bad-000004', config: { winTarget: 3, fmt: 'single', visibility: 'private', seats: 5 } }))) === 'invalid');
    t('create: ungueltige pid abgelehnt', (await err(() => rc.roomCreateV4({ uid: UID[0], requestId: 'req-bad-000005', config: CFG(), pid: 'x', name: 'A', tab: TAB[0] }))) === 'invalid');
    t('create: ungueltiges requestId abgelehnt', (await err(() => cre(0, 'kurz', CFG()))) === 'invalid');
    t('create: unauthentifiziert abgelehnt', (await err(() => rc.roomCreateV4(Object.assign({ uid: '', requestId: 'req-bad-000006', config: CFG() }, IDENT(0))))) === 'permission');
    codeQueue.push('ABJD');
    await rc.roomCreateV4(Object.assign({
      uid: UID[3], requestId: 'req-manip-0001', config: CFG(),
      seat: 4, gen: 7, clock: { remainingMs: 1 }, seatByUid: { [UX]: 0 }, sess: { 0: 'HACK' }, iid: 'HACKIID0', g: { 0: { t: {} } },
    }, IDENT(3)));
    const r4 = await roomOf('ABJD');
    t('create: clientgewaehlter Seat ignoriert (Creator ist Seat 0)', r4.seatByUid[UID[3]] === 0 && r4.players[0].uid === UID[3]);
    t('create: Gen-/Clock-/Index-/sess-/iid-Injektion wirkungslos',
      r4.gen === 0 && r4.g === undefined && Object.keys(r4.seatByUid).length === 1
      && r4.sess[0].active == null && r4.sess[0].pending.token !== 'HACK' && r4.iid !== 'HACKIID0');

    // ── 2) CREATE: Kollision, Idempotenz, Crash-Reparatur ───────────────────
    const v3room = {
      v: 3, config: CFG(), gen: 0, state: 'lobby', created: BASE - 1000,
      p: { 0: { s: 'TABV3000', on: false, t: BASE - 1000 } },
      players: { 0: { id: 'PIDV3000', name: 'V3', tab: 'TABV3000' } },
    };
    await db.ref('rooms/ABJE').set(v3room);
    const beforeCollision = core.canonical(await roomOf('ABJE'));
    codeQueue.push('ABJE', 'ABJF');                     // Kandidat 1 kollidiert mit v3-Raum
    const c5 = await create(4, { requestId: 'req-coll-00001' });
    t('create: Kollision ueberschreibt nichts — naechster Kandidat', c5.room === 'ABJF' && c5.status === 'created');
    t('create: kollidierter v3-Raum byte-identisch', core.canonical(await roomOf('ABJE')) === beforeCollision);
    codeQueue.push('ABJE', 'ABJE', 'ABJE', 'ABJE', 'ABJE', 'ABJE');
    t('create: erschoepfte Kandidaten -> kontrollierter unavailable-Fehler',
      (await err(() => create(4, { requestId: 'req-coll-00002' }))) === 'unavailable');
    t('create: auch danach nichts ueberschrieben', core.canonical(await roomOf('ABJE')) === beforeCollision);
    // Idempotenz: identischer Retry adoptiert denselben Raum.
    const roomsBefore = Object.keys((await db.ref('rooms').get()).val() || {}).length;
    const cr1 = await cre(0, 'req-idem-00001', CFG());
    const cr2 = await cre(0, 'req-idem-00001', CFG());
    const roomsAfter = Object.keys((await db.ref('rooms').get()).val() || {}).length;
    t('create: identischer Retry -> derselbe Raum', cr1.status === 'created' && cr2.status === 'exists' && cr1.room === cr2.room && cr1.iid === cr2.iid);
    t('create: Retry erzeugt keinen zweiten Raum', roomsAfter === roomsBefore + 1);
    t('create: gleiche requestId mit anderer Payload abgelehnt',
      (await err(() => cre(0, 'req-idem-00001', CFG('ffa')))) === 'invalid');
    // Crash A: Abbruch beim Room-Write (Marker reserviert, kein Raum).
    codeQueue.push('ABJG');
    const crashA = mkCore(hookDb({ failTx: (p) => p === 'rooms/ABJG' }));
    t('create-crash: Abbruch beim Room-Write wirft',
      (await err(() => crashA.roomCreateV4(Object.assign({ uid: UID[1], requestId: 'req-crash-0001', config: CFG() }, IDENT(1))))) === 'error');
    const mA = (await db.ref('reqs/' + UID[1] + '/req-crash-0001').get()).val();
    t('create-crash: Marker reserviert Code+iid dauerhaft VOR der Raumerstellung',
      mA.state === 'reserved' && mA.code === 'ABJG' && typeof mA.iid === 'string' && (await roomOf('ABJG')) === null);
    const cA = await cre(1, 'req-crash-0001', CFG());
    t('create-crash: Retry verwendet denselben reservierten Code', cA.status === 'created' && cA.room === 'ABJG' && cA.iid === mA.iid);
    // Crash B: Raum erstellt, Marker-Abschluss bricht ab -> Retry adoptiert.
    codeQueue.push('ABJH');
    let reqTx = 0;
    const crashB = mkCore(hookDb({ failTx: (p) => p.indexOf('reqs/' + UID[2] + '/req-crash-0002') === 0 && (++reqTx) === 2 }));
    t('create-crash: Abbruch nach Room-Write vor Marker-Abschluss wirft',
      (await err(() => crashB.roomCreateV4(Object.assign({ uid: UID[2], requestId: 'req-crash-0002', config: CFG() }, IDENT(2))))) === 'error');
    t('create-crash: Raum existiert, Marker noch reserviert',
      (await roomOf('ABJH')) !== null && (await db.ref('reqs/' + UID[2] + '/req-crash-0002/state').get()).val() === 'reserved');
    const cB = await cre(2, 'req-crash-0002', CFG());
    t('create-crash: Retry adoptiert den eigenen Raum (kein Ghost, kein Zweitraum)',
      cB.status === 'exists' && cB.room === 'ABJH'
      && (await db.ref('reqs/' + UID[2] + '/req-crash-0002/state').get()).val() === 'complete');
    // Parallele identische Requests: genau EIN Raum, beide sehen ihn.
    codeQueue.push('ABJJ', 'ABJK');
    const [pc1, pc2] = await Promise.all([
      cre(1, 'req-par-000001', CFG()),
      cre(1, 'req-par-000001', CFG()),
    ]);
    t('create: parallele identische Requests -> derselbe Raum', pc1.room === pc2.room && pc1.iid === pc2.iid);
    t('create: genau ein Raum je Request (kein Ghost)',
      ((await roomOf('ABJJ')) === null) !== ((await roomOf('ABJK')) === null));

    // ── 3) JOIN: reine Reservierung, Seats vergibt der Server ───────────────
    codeQueue.push('ABKA');
    await cre(0, 'req-join-00001', CFG('ffa'));
    const j1 = await join('ABKA', 1);
    t('join: Gast erhaelt Seat 1', j1.status === 'joined' && j1.seat === 1);
    const rA = await roomOf('ABKA');
    t('join: players/seatByUid/sess/Presence atomar konsistent (pending, offline)',
      rA.players[1].uid === UID[1] && rA.seatByUid[UID[1]] === 1
      && rA.sess[1].active == null && rA.sess[1].pending.token === j1.token
      && rA.sess[1].pending.leaseId === j1.leaseId && rA.sess[1].iid === rA.iid
      && rA.p[1].on === false && rA.p[1].s === j1.token);
    t('join: Raum bleibt in der Lobby (reine Reservierung, keine Clock)', rA.state === 'lobby' && rA.g === undefined);
    t('join: Lease traegt eine absolute Server-Ablaufzeit', rA.sess[1].pending.expiresAt === BASE + roomCore.RESERVE_LEASE_MS);
    const j2 = await join('ABKA', 2, { seat: 4 });
    t('join: clientgewaehlter Seat wirkungslos (niedrigster freier Seat)', j2.seat === 2);
    const j2b = await join('ABKA', 2);
    t('join: dieselbe UID idempotent auf demselben Seat', j2b.status === 'exists' && j2b.seat === 2);
    const [j3, j4] = await Promise.all([join('ABKA', 3), join('ABKA', 4)]);
    t('join: parallele Joins erhalten verschiedene Seats', [j3.seat, j4.seat].sort().join(',') === '3,4');
    t('join: voller Raum abgelehnt', (await err(async () => rc.roomJoinV4(Object.assign(
      { uid: UX, room: 'ABKA', iid: await iidOf('ABKA') }, { pid: 'PIDLCX00', name: 'X', tab: 'TABLCX00' })))) === 'failed');
    t('join: falsche iid abgelehnt (stale Operation)', (await err(() => rc.roomJoinV4(Object.assign(
      { uid: UX, room: 'ABKA', iid: 'IIDLC-FREMD1' }, { pid: 'PIDLCX00', name: 'X', tab: 'TABLCX00' })))) === 'failed');
    t('join: iid ist Pflicht', (await err(() => rc.roomJoinV4(Object.assign(
      { uid: UX, room: 'ABKA' }, { pid: 'PIDLCX00', name: 'X', tab: 'TABLCX00' })))) === 'invalid');
    // Race um den LETZTEN freien Seat (triple_ffa: 3 Seats, 1 frei).
    codeQueue.push('ABKB');
    await cre(0, 'req-join-00002', CFG('triple_ffa'));
    await join('ABKB', 1);
    const [l1, l2] = await Promise.all([
      join('ABKB', 2).then((r) => r.status, (e) => e.code),
      join('ABKB', 3).then((r) => r.status, (e) => e.code),
    ]);
    t('join: Race um den letzten Seat -> genau ein Gewinner',
      [l1, l2].filter((x) => x === 'joined').length === 1 && [l1, l2].filter((x) => x === 'failed').length === 1);
    codeQueue.push('ABKC');
    await cre(0, 'req-join-00003', CFG('ffa'));
    await db.ref('rooms/ABKC/seatByUid/' + UID[1]).set(0);
    t('join: widerspruechlicher seatByUid-Zustand -> permission', (await err(() => join('ABKC', 1))) === 'permission');
    codeQueue.push('ABKD');
    await cre(0, 'req-join-00004', CFG('ffa'));
    await db.ref('rooms/ABKD/players/2').set({ id: PID[2], name: 'DUP', tab: TAB[2], uid: UID[1] });
    t('join: doppelte UID im Roster -> permission', (await err(() => join('ABKD', 1))) === 'permission');
    t('join: v3-Raum abgelehnt (Protokollgrenze)', (await err(() => rc.roomJoinV4(Object.assign(
      { uid: UID[1], room: 'ABJE', iid: 'IIDLC-EGAL01' }, IDENT(1))))) === 'invalid');
    codeQueue.push('ABKE');
    await cre(0, 'req-join-00005', CFG('ffa'));
    simNow = BASE + 7200000;
    t('join: abgelaufener Raum abgelehnt (TTL)', (await err(() => join('ABKE', 1))) === 'failed');
    simNow = BASE;

    // ── 4) ACTIVATE: Tokenrotation + 1v1/2v2-Start erst nach echter Aktivierung ──
    codeQueue.push('ABKF');
    await cre(0, 'req-1v1-00001', CFG('single'));
    const jF = await join('ABKF', 1);
    const rF0 = await roomOf('ABKF');
    t('join 1v1: Beitritt reserviert NUR — kein Matchstart, keine Clock',
      jF.status === 'joined' && rF0.state === 'lobby' && rF0.g === undefined);
    // "Verlorene Join-Antwort": der committete Join allein startet nie ein Match.
    t('join 1v1: verlorene Join-Antwort startet kein Match', rF0.state === 'lobby');
    const pendH = (await roomOf('ABKF')).sess[0].pending;
    const aH = await activate('ABKF', 0);
    const rFa = await roomOf('ABKF');
    t('activate: pending -> active, Presence online mit demselben Token',
      aH.status === 'activated' && aH.started === false && aH.token === pendH.token
      && rFa.sess[0].active === aH.token && rFa.sess[0].pending == null
      && rFa.p[0].s === aH.token && rFa.p[0].on === true);
    t('activate: noch kein Start (Gast nicht aktiviert)', rFa.state === 'lobby');
    simNow = BASE + 4000;
    const aG = await activate('ABKF', 1);
    const rF1 = await roomOf('ABKF');
    t('activate: Gast-Aktivierung startet 1v1 atomar (state+Clock)',
      aG.started === true && rF1.state === 'playing' && aG.clock != null);
    t('activate: Startzeit entsteht IN der Transaction (deadline = Aktivierung+7000)',
      aG.clock.startedAt === BASE + 4000 && aG.clock.deadlineAt === BASE + 11000 && aG.clock.remainingMs === CYCLE && aG.clock.stage === 0
      && aG.clock.eligibleSeats === '0,1' && rF1.seats === undefined);
    t('activate: fremde UID abgelehnt', (await err(() => rc.roomActivateV4({ uid: UX, room: 'ABKF', iid: rF1.iid, token: 'FREMDTOKEN000001', leaseId: 'FREMDLEASE000001' }))) === 'permission');
    t('activate: falsche iid abgelehnt', (await err(() => rc.roomActivateV4({ uid: UID[1], room: 'ABKF', iid: 'IIDLC-FREMD1', token: sessOf('ABKF', 1), leaseId: 'X' }))) === 'failed');
    // Retry/Zwei-Tab: erneute Aktivierung rotiert erneut, setzt aber NIE die Clock zurueck.
    const clkBefore = core.canonical(await clockOf('ABKF'));
    // Verlorene Activate-Antwort: derselbe Aufruf ist idempotent (Token ist
    // bereits aktiv) — keine Rotation, keine Clock-Aenderung.
    const aG2 = await activate('ABKF', 1);
    t('activate: Retry einer verlorenen Antwort ist idempotent',
      aG2.status === 'activated' && aG2.token === aG.token && aG2.started === false
      && core.canonical(await clockOf('ABKF')) === clkBefore);
    // Zweiter Tab / Reconnect: neuer Join stellt eine NEUE pending Session aus,
    // active bleibt bis zum Activate unveraendert — danach ist der alte Token tot.
    const oldTok = aG.token;
    const reJoin = await join('ABKF', 1);
    const rMid = await roomOf('ABKF');
    t('reconnect: Join stellt neue pending Session aus, active bleibt vorerst alt',
      reJoin.status === 'exists' && reJoin.seat === 1 && reJoin.token !== oldTok
      && rMid.sess[1].active === oldTok && rMid.sess[1].pending.token === reJoin.token);
    const aG3 = await activate('ABKF', 1);
    const rF2 = await roomOf('ABKF');
    t('reconnect: Activate uebernimmt den neuen Token (Takeover), alter Token tot',
      aG3.token === reJoin.token && aG3.token !== oldTok && rF2.sess[1].active === aG3.token
      && rF2.sess[1].pending == null && rF2.p[1].on === true && rF2.p[1].s === aG3.token);
    t('reconnect: verspaetetes Activate mit ALTEM Token/Lease abgelehnt',
      (await err(() => rc.roomActivateV4({ uid: UID[1], room: 'ABKF', iid: rF2.iid, token: oldTok, leaseId: 'ALTLEASE00000001' }))) === 'failed');
    t('reconnect: alter Tab kann mit altem Token nicht mehr clockClose aufrufen',
      (await err(() => clk.clockClose({ room: 'ABKF', phaseId: '0:0', uid: UID[1], iid: rF2.iid, session: oldTok }))) === 'permission');
    t('reconnect: alter Tab kann nicht clockSettle aufrufen',
      (await err(() => clk.clockSettle({ room: 'ABKF', phaseId: '0:0', uid: UID[1], hash: 'h', next: '', iid: rF2.iid, session: oldTok }))) === 'permission');
    t('reconnect: alter Tab kann nicht leaven',
      (await err(() => rc.roomLeaveV4({ uid: UID[1], room: 'ABKF', iid: rF2.iid, session: oldTok }))) === 'permission');
    t('reconnect: alter Tab kann nicht starten (kein Host + tote Session)',
      (await err(() => rc.roomStartV4({ uid: UID[1], room: 'ABKF', iid: rF2.iid, session: oldTok }))) === 'permission');
    t('reconnect: alter Tab kann nicht rematchen',
      (await err(() => rc.roomRematchV4({ uid: UID[1], room: 'ABKF', expectedGen: 0, iid: rF2.iid, session: oldTok }))) === 'permission');
    t('reconnect: neuer Tab bleibt allein handlungsberechtigt (Close mit aktiver Session ist zulaessig)',
      (await err(() => clk.clockClose({ room: 'ABKF', phaseId: '0:0', uid: UID[1], iid: rF2.iid, session: aG3.token }))) === 'too-early');
    t('join: Beitritt nach Matchstart (neue UID) abgelehnt', (await err(() => join('ABKF', 2))) === 'failed');
    t('join: eigener Seat nach Matchstart idempotent zurueckgegeben (Reconnect)',
      await (async () => {
        const a = await rc.roomJoinV4(Object.assign({ uid: UID[1], room: 'ABKF', iid: await iidOf('ABKF') }, IDENT(1)));
        const b = await rc.roomJoinV4(Object.assign({ uid: UID[1], room: 'ABKF', iid: await iidOf('ABKF') }, IDENT(1)));
        return a.status === 'exists' && b.seat === 1 && a.token !== b.token;   // je Aufruf frische pending Session
      })());
    // 2v2-Auto-Start: identische Semantik fuer fmt double.
    codeQueue.push('ABKT');
    await creAct(0, 'req-2v2-00001', CFG('double'));
    await join('ABKT', 1);
    t('activate 2v2: erst beide aktiv -> Start', (await roomOf('ABKT')).state === 'lobby');
    const a2 = await activate('ABKT', 1);
    t('activate 2v2: Gast-Aktivierung startet das Doppel', a2.started === true && (await roomOf('ABKT')).state === 'playing');
    // ── 4b) onDisconnect-Fenster + Tokenrotation gegen die ECHTEN Rules ────
    //    Raum mit realer Wanduhr (Presence-Validates rechnen mit Serverzeit).
    const SVt = { '.sv': 'timestamp' };
    simNow = Date.now();
    codeQueue.push('ABKR');
    await cre(0, 'req-tok-00001', CFG('single'));
    const jR = await join('ABKR', 1);
    // Der Client registriert seinen onDisconnect mit dem PENDING Token VOR dem
    // Activate — der Rules-Vertrag muss das ablehnen, solange der Token noch
    // nicht aktiv ist (Presence darf ohne Aktivierung nicht geschrieben werden),
    // aber nach dem Activate genau diesen Token akzeptieren.
    t('handshake: Presence-Write mit pending Token VOR Activate abgelehnt',
      (await restPut('rooms/ABKR/p/1', { s: jR.token, on: true, t: SVt }, UID[1])) === false);
    t('handshake: kein falsches Online vor Activate', (await db.ref('rooms/ABKR/p/1/on').get()).val() === false);
    t('handshake: keine Clock vor Activate', (await clockOf('ABKR')) === null);
    await activate('ABKR', 0);
    const aR = await activate('ABKR', 1);
    t('handshake: nach Activate ist genau dieser Token gueltig',
      aR.token === jR.token && (await db.ref('rooms/ABKR/sess/1/active').get()).val() === jR.token);
    t('disconnect: Offline-Write direkt nach Activate wirkt (onDisconnect-Pfad)',
      (await restPut('rooms/ABKR/p/1', { s: aR.token, on: false, t: SVt }, UID[1])) === true
      && (await db.ref('rooms/ABKR/p/1/on').get()).val() === false);
    // Rotation durch einen zweiten Tab: der alte Token verliert JEDE Wirkung.
    const j2R = await join('ABKR', 1);
    const a2R = await activate('ABKR', 1);
    t('rotation: neuer Tab besitzt eine andere aktive Session', a2R.token !== aR.token);
    t('rotation: alter onDisconnect (alter Token) prallt an den Rules ab',
      (await restPut('rooms/ABKR/p/1', { s: aR.token, on: false, t: SVt }, UID[1])) === false);
    t('rotation: neue Presence bleibt online', (await db.ref('rooms/ABKR/p/1/on').get()).val() === true);
    t('rotation: neuer Token schreibt Presence normal',
      (await restPut('rooms/ABKR/p/1', { s: a2R.token, on: false, t: SVt }, UID[1])) === true);
    t('rotation: fremde UID auch mit korrektem Token abgelehnt',
      (await restPut('rooms/ABKR/p/1', { s: a2R.token, on: true, t: SVt }, UX)) === false);
    t('sess: Client kann sess nicht schreiben', (await restPut('rooms/ABKR/sess/1/active', 'HACKTOK00001', UID[1])) === false);
    // Gameplay-Bindung: der alte Tab gewinnt keinen Move-Slot mehr.
    await db.ref('rooms/ABKR/p/1').set({ s: a2R.token, on: true, t: Date.now() });
    const liveR = core.aimAnchor(0, 0, CYCLE, Date.now(), '0,1', {});
    await db.ref('rooms/ABKR/g/0/live').set({ iid: await iidOf('ABKR'), clock: liveR });
    t('rotation: alter Tab kann keinen Move-Slot gewinnen (sid)',
      (await restPut('rooms/ABKR/g/0/live/slots/1', { idx: 1, dx: 10, dy: 10, sp: 0, t: 0, sid: aR.token }, UID[1])) === false);
    t('rotation: neuer Tab schreibt seinen Move normal',
      (await restPut('rooms/ABKR/g/0/live/slots/1', { idx: 1, dx: 10, dy: 10, sp: 0, t: 0, sid: a2R.token }, UID[1])) === true);
    simNow = BASE;

    // ── 5) LEAVE (nur Lobby) + Listing-Cleanup-Vertrag ──────────────────────
    codeQueue.push('ABKG');
    await creAct(0, 'req-leave-0001', CFG('ffa'));
    await join('ABKG', 1); await join('ABKG', 2);
    const iidG = await iidOf('ABKG');
    const lv1 = await leave('ABKG', 1);
    const rG = await roomOf('ABKG');
    t('leave: players + seatByUid + sess + Presence atomar entfernt',
      lv1.status === 'left' && rG.players[1] === undefined && rG.seatByUid[UID[1]] === undefined
      && (rG.sess == null || rG.sess[1] === undefined) && (rG.p == null || rG.p[1] === undefined));
    t('leave: Retry idempotent (gone)', (await leave('ABKG', 1)).status === 'gone');
    t('leave: falsche iid abgelehnt', (await err(() => leave('ABKG', 2, 'IIDLC-FREMD1'))) === 'failed');
    t('leave: fremde UID ohne Seat -> gone, fremde Seats unberuehrt',
      (await rc.roomLeaveV4({ uid: UX, room: 'ABKG', iid: iidG, session: 'FREMDTOKEN000001' })).status === 'gone' && (await roomOf('ABKG')).players[2].uid === UID[2]);
    const jRe = await join('ABKG', 3);
    t('leave: freigewordener Seat wird neu vergeben', jRe.status === 'joined' && jRe.seat === 1);
    // Host-Leave + Listing: Crash zwischen Leave und Listing-Delete wird per
    // cleanupPending deterministisch repariert; das Listing gehoert der iid.
    await db.ref('publicRooms/ABKG').set({ created: BASE, iid: iidG });
    const failLst = mkCore(hookDb({ failTx: (p) => p === 'publicRooms/ABKG' }));
    t('leave: Host-Leave mit scheiterndem Listing-Delete wirft',
      (await err(() => failLst.roomLeaveV4({ uid: UID[0], room: 'ABKG', iid: iidG, session: sessOf('ABKG', 0) }))) === 'error');
    const rG2 = await roomOf('ABKG');
    t('leave: Host ist raus, cleanupPending gesetzt, Listing (noch) vorhanden',
      rG2.players[0] === undefined && rG2.cleanupPending === true && (await db.ref('publicRooms/ABKG').get()).val() !== null);
    t('leave: Retry repariert das Listing deterministisch',
      (await rc.roomLeaveV4({ uid: UID[0], room: 'ABKG', iid: iidG, session: sessOf('ABKG', 0) })).status === 'gone'
      && (await db.ref('publicRooms/ABKG').get()).val() === null
      && (await db.ref('rooms/ABKG/cleanupPending').get()).val() === null);
    // Letzter Spieler -> Raum geloescht; Last-Delete-Retry -> gone.
    await leave('ABKG', 2);
    const lvLast = await leave('ABKG', 3, iidG);
    t('leave: letzter Spieler loescht den Raum', lvLast.status === 'deleted' && (await roomOf('ABKG')) === null);
    t('leave: Retry auf geloeschtem Raum idempotent gone',
      (await rc.roomLeaveV4({ uid: UID[3], room: 'ABKG', iid: iidG, session: sessOf('ABKG', 3) })).status === 'gone');
    // Verwaistes Listing nach Raum-Loeschung: Retry raeumt es nach — aber nie
    // das Listing eines FREMDEN Raums unter demselben Code.
    await db.ref('publicRooms/ABKG').set({ created: BASE, iid: iidG });
    await rc.roomLeaveV4({ uid: UID[3], room: 'ABKG', iid: iidG, session: sessOf('ABKG', 3) });
    t('leave: verwaistes Listing nach Loeschung nachgeraeumt', (await db.ref('publicRooms/ABKG').get()).val() === null);
    // In-Match-Leave: kontrolliert abgelehnt, NICHTS halb entfernt (Phase IV).
    const lvPlay = await err(() => leave('ABKF', 1));
    const rFx = await roomOf('ABKF');
    t('leave: im laufenden Match abgelehnt (Phase IV), Zustand vollstaendig intakt',
      lvPlay === 'failed' && rFx.players[1].uid === UID[1] && rFx.seatByUid[UID[1]] === 1 && rFx.state === 'playing');

    // ── 6) START (Host, nur Lobby, v3-Bedingungen) ──────────────────────────
    codeQueue.push('ABKJ');
    await creAct(0, 'req-start-0001', CFG('ffa'));
    await join('ABKJ', 1); await join('ABKJ', 2);
    t('start: Gast darf nicht starten', (await err(() => startM('ABKJ', 1))) === 'permission');
    t('start: fremde UID darf nicht starten', (await err(async () => rc.roomStartV4({ uid: UX, room: 'ABKJ', iid: await iidOf('ABKJ'), session: 'FREMDTOKEN000001' }))) === 'permission');
    t('start: falsche iid abgelehnt', (await err(() => startM('ABKJ', 0, 'IIDLC-FREMD1'))) === 'failed');
    t('start: nur reservierte (nie aktivierte) Gaeste blockieren den Start', (await err(() => startM('ABKJ'))) === 'failed');
    await onlineAll('ABKJ', [1, 2]);
    const s1 = await startM('ABKJ');
    t('start: korrekter erster Anker (ein Zyklus, stage 0, deadline/eligible/state/seats)',
      s1.status === 'started' && s1.clock.remainingMs === CYCLE && s1.clock.stage === 0 && s1.clock.deadlineAt === BASE + 7000
      && s1.clock.eligibleSeats === '0,1,2' && (await roomOf('ABKJ')).state === 'playing' && (await roomOf('ABKJ')).seats === 3);
    const s2 = await startM('ABKJ');
    t('start: Retry ist exists und setzt die Clock nicht zurueck',
      s2.status === 'exists' && core.canonical(s2.clock) === core.canonical(s1.clock));
    // Startzeit unter Contention: vergeht zwischen Vorpruefung und Transaction
    // Zeit, entsteht die Deadline TROTZDEM aus der Transaktionszeit.
    codeQueue.push('ABKK');
    await creAct(0, 'req-start-0002', CFG('ffa'));
    await joinAct('ABKK', 1);
    let bumped = false;
    const lateCore = mkCore(hookDb({ beforeTx: async (p) => { if (p === 'rooms/ABKK' && !bumped) { bumped = true; simNow = BASE + 5000; } } }));
    const sLate = await lateCore.roomStartV4({ uid: UID[0], room: 'ABKK', iid: await iidOf('ABKK'), session: sessOf('ABKK', 0) });
    t('start: Deadline entsteht IN der Transaction (keine verkuerzte erste Phase)',
      sLate.status === 'started' && sLate.clock.startedAt === BASE + 5000 && sLate.clock.deadlineAt === BASE + 12000);
    simNow = BASE;
    // Paralleler Start: genau ein started.
    codeQueue.push('ABKM');
    await creAct(0, 'req-start-0003', CFG('ffa'));
    await joinAct('ABKM', 1);
    const [ps1, ps2] = await Promise.all([startM('ABKM'), startM('ABKM')]);
    t('start: parallele Aufrufe -> genau ein started',
      [ps1.status, ps2.status].filter((s) => s === 'started').length === 1
      && core.canonical(ps1.clock) === core.canonical(ps2.clock));
    codeQueue.push('ABKN');
    await creAct(0, 'req-start-0004', CFG('ffa'));
    t('start: ein Spieler reicht nicht', (await err(() => startM('ABKN'))) === 'failed');
    await joinAct('ABKN', 1); await joinAct('ABKN', 2);
    await leave('ABKN', 1);
    t('start: Sitzluecke blockiert den Start (kein Auto-Nachruecken, v3)', (await err(() => startM('ABKN'))) === 'failed');
    codeQueue.push('ABKP');
    await creAct(0, 'req-start-0005', CFG('ffa'));
    await joinAct('ABKP', 1);
    await db.ref('rooms/ABKP/seatByUid/' + UID[1]).set(3);
    t('start: inkonsistenter Roster blockiert den Start', (await err(() => startM('ABKP'))) === 'failed');

    // ── 7) REMATCH: Host-only, CAS, Crash-Reparatur, Scope ──────────────────
    codeQueue.push('ABNA');
    await creAct(0, 'req-rem-00001', CFG('single'));
    await join('ABNA', 1);
    simNow = BASE + 1000;
    await activate('ABNA', 1);                          // startet das 1v1
    t('rematch: waehrend aim abgelehnt (kein terminaler Zustand)', (await err(() => rematch('ABNA', 0, 0))) === 'failed');
    for (const s of [0, 1]) await db.ref(`rooms/ABNA/g/0/live/slots/${s}`).set({ idx: s, dx: 10, dy: 10, sp: 0, t: 0, sid: sessOf('ABNA', s) });
    simNow = BASE + 3000;
    await clk.clockClose({ room: 'ABNA', phaseId: '0:0', uid: UID[0], iid: await iidOf('ABNA'), session: sessOf('ABNA', 0) });
    await clk.clockSettle({ room: 'ABNA', phaseId: '0:0', uid: UID[0], hash: 'h', next: '', iid: await iidOf('ABNA'), session: sessOf('ABNA', 0) });
    await clk.clockSettle({ room: 'ABNA', phaseId: '0:0', uid: UID[1], hash: 'h', next: '', iid: await iidOf('ABNA'), session: sessOf('ABNA', 1) });
    t('rematch: Vorbedingung — Gen 0 organisch finished/complete',
      (await clockOf('ABNA', 0)).phase === 'finished' && (await clockOf('ABNA', 0)).reason === 'complete');
    const histBefore = core.canonical((await db.ref('rooms/ABNA/g/0').get()).val());
    t('rematch: GAST abgelehnt (Host-only)', (await err(() => rematch('ABNA', 1, 0))) === 'permission');
    t('rematch: fremde UID abgelehnt', (await err(async () => rc.roomRematchV4({ uid: UX, room: 'ABNA', expectedGen: 0, iid: await iidOf('ABNA'), session: 'FREMDTOKEN000001' }))) === 'permission');
    t('rematch: falsches expectedGen abgelehnt', (await err(() => rematch('ABNA', 0, 5))) === 'failed');
    t('rematch: expectedGen ist Pflicht', (await err(async () => rc.roomRematchV4({ uid: UID[0], room: 'ABNA', iid: await iidOf('ABNA'), session: sessOf('ABNA', 0) }))) === 'invalid');
    t('rematch: falsche iid abgelehnt', (await err(() => rematch('ABNA', 0, 0, 'IIDLC-FREMD1'))) === 'failed');
    simNow = BASE + 9000;
    const rm1 = await rematch('ABNA', 0, 0);            // HOST
    t('rematch: neue Generation exakt oldGen+1 (nur Host)', rm1.status === 'rematched' && rm1.gen === 1 && (await roomOf('ABNA')).gen === 1);
    // Stufen-Reset des Rematch: die neue Generation beginnt bei stage 0 mit einem
    // vollen Zyklus, 'aim' und leeren Slots — sie erbt die Stufen der
    // Vorgaengergeneration nicht.
    t('rematch: neue Clock frisch (ein Zyklus, stage 0, cracked/expired false, phaseId 1:0)',
      rm1.clock.remainingMs === CYCLE && rm1.clock.stage === 0
      && rm1.clock.cracked === false && rm1.clock.expired === false && rm1.clock.phase === 'aim'
      && rm1.clock.phaseId === '1:0' && rm1.clock.deadlineAt === BASE + 9000 + 7000);
    t('rematch: neue Generation startet mit leeren live/slots',
      (await db.ref('rooms/ABNA/g/1/live/slots').get()).val() === null);
    t('rematch: alte Generation byte-identisch', core.canonical((await db.ref('rooms/ABNA/g/0').get()).val()) === histBefore);
    const rm2 = await rematch('ABNA', 0, 0);
    t('rematch: identischer Retry liefert dieselbe Generation ohne Reset',
      rm2.status === 'exists' && rm2.gen === 1 && core.canonical(rm2.clock) === core.canonical(rm1.clock));
    // Parallele HOST-Aufrufe: genau ein Bump.
    for (const s of [0, 1]) await db.ref(`rooms/ABNA/g/1/live/slots/${s}`).set({ idx: s, dx: 10, dy: 10, sp: 0, t: 0, sid: sessOf('ABNA', s) });
    simNow = BASE + 12000;
    await clk.clockClose({ room: 'ABNA', phaseId: '1:0', uid: UID[0], iid: await iidOf('ABNA'), session: sessOf('ABNA', 0) });
    await clk.clockSettle({ room: 'ABNA', phaseId: '1:0', uid: UID[0], hash: 'h', next: '', iid: await iidOf('ABNA'), session: sessOf('ABNA', 0) });
    await clk.clockSettle({ room: 'ABNA', phaseId: '1:0', uid: UID[1], hash: 'h', next: '', iid: await iidOf('ABNA'), session: sessOf('ABNA', 1) });
    const [pr1, pr2] = await Promise.all([rematch('ABNA', 0, 1), rematch('ABNA', 0, 1)]);
    t('rematch: parallele Host-Aufrufe erzeugen genau eine neue Generation',
      (await roomOf('ABNA')).gen === 2 && pr1.gen === 2 && pr2.gen === 2
      && [pr1.status, pr2.status].filter((s) => s === 'rematched').length === 1);
    t('rematch: kein Sprung um mehrere Generationen', (await clockOf('ABNA', 3)) === null);
    t('rematch: Client-Gen-Write bleibt verboten', (await restPut('rooms/ABNA/gen', 3, UID[0])) === false);
    // Crash-Reparatur: Absturz zwischen Gen-Bump und Anker.
    codeQueue.push('ABNB');
    await creAct(0, 'req-rem-00002', CFG('single'));
    await joinAct('ABNB', 1);
    await db.ref('rooms/ABNB/g/0/live/clock').update({ phase: 'finished', reason: 'complete' });
    const crashRm = mkCore(hookDb({ failTx: (p) => p === 'rooms/ABNB/g/1/live' }));
    t('rematch-crash: Abbruch nach Gen-Bump wirft',
      (await err(async () => crashRm.roomRematchV4({ uid: UID[0], room: 'ABNB', expectedGen: 0, iid: await iidOf('ABNB'), session: sessOf('ABNB', 0) }))) === 'error');
    t('rematch-crash: Gen gebumpt, Anker fehlt', (await db.ref('rooms/ABNB/gen').get()).val() === 1 && (await clockOf('ABNB', 1)) === null);
    const rmFix = await rematch('ABNB', 0, 0);
    t('rematch-crash: Retry repariert den Anker (exists, dieselbe Generation)',
      rmFix.status === 'exists' && rmFix.gen === 1 && rmFix.clock.remainingMs === CYCLE && rmFix.clock.stage === 0);
    // Grosse alte Historie beeinflusst den Rematch-Transaction-Scope nicht.
    codeQueue.push('ABNC');
    await creAct(0, 'req-rem-00003', CFG('single'));
    await joinAct('ABNC', 1);
    const bigHist = {};
    for (let i = 0; i < 500; i++) bigHist[i] = { 0: { idx: 0, dx: 1, dy: 1, sp: 0, t: i }, 1: { ns: 'stand' } };
    await db.ref('rooms/ABNC/g/0/t').set(bigHist);
    await db.ref('rooms/ABNC/g/0/live/clock').update({ phase: 'finished', reason: 'complete' });
    const txPaths = [];
    const spyCore = mkCore(hookDb({ onTx: (p) => txPaths.push(p) }));
    const rmBig = await spyCore.roomRematchV4({ uid: UID[0], room: 'ABNC', expectedGen: 0, iid: await iidOf('ABNC'), session: sessOf('ABNC', 0) });
    t('rematch: Transactions beruehren NUR gen und g/<neu>/live (nie alte Historie)',
      rmBig.status === 'rematched' && txPaths.length > 0
      && txPaths.every((p) => p === 'rooms/ABNC/gen' || p === 'rooms/ABNC/g/1/live'));
    t('rematch: 500 alte Turns byte-identisch', Object.keys((await db.ref('rooms/ABNC/g/0/t').get()).val()).length === 500
      && core.canonical((await db.ref('rooms/ABNC/g/0/t/250').get()).val()) === core.canonical(bigHist[250]));

    // ── 8) STALE OPERATIONS: geloeschte und neu erstellte Raeume ────────────
    // Join gegen Last-Player-Delete: der Raum verschwindet direkt vor der
    // Join-Transaction — Loesch-Probe: not-found, KEINE Wiederbelebung.
    codeQueue.push('ABPA');
    await creAct(0, 'req-race-0001', CFG('ffa'));
    const iidPA = await iidOf('ABPA');
    let nuked = false;
    const nukeCore = mkCore(hookDb({ beforeTx: async (p) => { if (p === 'rooms/ABPA' && !nuked) { nuked = true; await db.ref('rooms/ABPA').set(null); } } }));
    t('race: Join gegen Last-Player-Delete -> not-found',
      (await err(() => nukeCore.roomJoinV4(Object.assign({ uid: UID[1], room: 'ABPA', iid: iidPA }, IDENT(1))))) === 'not-found');
    t('race: geloeschter Raum wird NICHT wiederbelebt', (await roomOf('ABPA')) === null);
    // Start gegen Delete.
    codeQueue.push('ABPB');
    await creAct(0, 'req-race-0002', CFG('ffa'));
    await joinAct('ABPB', 1);
    const iidPB = await iidOf('ABPB');
    let nuked2 = false;
    const nukeCore2 = mkCore(hookDb({ beforeTx: async (p) => { if (p === 'rooms/ABPB' && !nuked2) { nuked2 = true; await db.ref('rooms/ABPB').set(null); } } }));
    t('race: Start gegen Delete -> not-found',
      (await err(() => nukeCore2.roomStartV4({ uid: UID[0], room: 'ABPB', iid: iidPB, session: sessOf('ABPB', 0) }))) === 'not-found');
    t('race: auch hier keine Wiederbelebung', (await roomOf('ABPB')) === null);
    // Leave gegen Join: der Joiner kommt vor der Leave-Transaction an — der
    // Raum bleibt bestehen (kein Delete des letzten Spielers mehr).
    codeQueue.push('ABPC');
    await creAct(0, 'req-race-0003', CFG('ffa'));
    let joined = false;
    const joinCore = mkCore(hookDb({ beforeTx: async (p) => { if (p === 'rooms/ABPC' && !joined) { joined = true; await join('ABPC', 1); } } }));
    const lvRace = await joinCore.roomLeaveV4({ uid: UID[0], room: 'ABPC', iid: await iidOf('ABPC'), session: sessOf('ABPC', 0) });
    const rPC = await roomOf('ABPC');
    t('race: Leave gegen Join -> Raum bleibt mit dem Joiner bestehen',
      lvRace.status === 'left' && rPC != null && rPC.players[1].uid === UID[1] && rPC.players[0] === undefined);
    // Alte Operation gegen NEU erstellten Raum mit demselben Code.
    await rc.roomLeaveV4({ uid: UID[1], room: 'ABPC', iid: rPC.iid, session: sessOf('ABPC', 1) });   // Raum weg
    codeQueue.push('ABPC');
    await creAct(2, 'req-race-0004', CFG('ffa'));
    const fresh = core.canonical(await roomOf('ABPC'));
    t('race: alter Join gegen neuen Raum mit demselben Code -> failed',
      (await err(() => rc.roomJoinV4(Object.assign({ uid: UID[1], room: 'ABPC', iid: rPC.iid }, IDENT(1))))) === 'failed');
    t('race: altes Leave gegen neuen Raum -> failed',
      (await err(() => rc.roomLeaveV4({ uid: UID[2], room: 'ABPC', iid: rPC.iid, session: sessOf('ABPC', 0) }))) === 'failed');
    t('race: alter Start gegen neuen Raum -> failed',
      (await err(() => rc.roomStartV4({ uid: UID[2], room: 'ABPC', iid: rPC.iid, session: sessOf('ABPC', 0) }))) === 'failed');
    t('race: altes Activate gegen neuen Raum -> failed',
      (await err(() => rc.roomActivateV4({ uid: UID[2], room: 'ABPC', iid: rPC.iid, token: 'ALTTOKEN00000001', leaseId: 'ALTLEASE00000001' }))) === 'failed');
    t('race: alter Rematch gegen neuen Raum -> failed',
      (await err(() => rc.roomRematchV4({ uid: UID[2], room: 'ABPC', expectedGen: 0, iid: rPC.iid, session: sessOf('ABPC', 0) }))) === 'failed');
    t('race: neuer Raum blieb durch alle stale Operationen byte-identisch',
      core.canonical(await roomOf('ABPC')) === fresh);

    // ── 8b) RESERVATION-LEASE: nie aktivierte Reservierungen verfallen ──────
    //    Eine verlorene Join-Antwort darf einen Seat nicht dauerhaft blockieren;
    //    ein AKTIVER Seat wird dagegen niemals ueber die Lease recycelt.
    codeQueue.push('ABQA');
    simNow = BASE;
    await creAct(0, 'req-lease-0001', CFG('single'));
    const jLost = await join('ABQA', 1);                 // Antwort "geht verloren"
    const iidQA = await iidOf('ABQA');
    const leaseEnd = (await db.ref('rooms/ABQA/sess/1/pending/expiresAt').get()).val();
    t('lease: pending Session traegt eine absolute Server-Ablaufzeit',
      leaseEnd === BASE + roomCore.RESERVE_LEASE_MS);
    t('lease: reservierter Seat blockiert waehrend gueltiger Lease',
      (await err(() => rc.roomJoinV4(Object.assign({ uid: UID[2], room: 'ABQA', iid: iidQA }, IDENT(2))))) === 'failed');
    t('lease: Raum bleibt in der Lobby (kein Start durch die Reservierung)', (await roomOf('ABQA')).state === 'lobby');
    simNow = leaseEnd;                                   // Lease exakt abgelaufen
    const jTake = await join('ABQA', 2);
    const rQA = await roomOf('ABQA');
    t('lease: nach Ablauf uebernimmt ein anderer Spieler den Seat',
      jTake.status === 'joined' && jTake.seat === 1 && rQA.players[1].uid === UID[2]);
    t('lease: Index atomar umgehaengt (kein Doppel-Seat, kein Rest des Vorgaengers)',
      rQA.seatByUid[UID[2]] === 1 && rQA.seatByUid[UID[1]] === undefined
      && Object.keys(rQA.seatByUid).length === 2 && Object.keys(rQA.players).length === 2);
    t('lease: verspaetetes Activate der alten Lease abgelehnt',
      (await err(() => rc.roomActivateV4({ uid: UID[1], room: 'ABQA', iid: rQA.iid, token: jLost.token, leaseId: jLost.leaseId }))) === 'permission');
    t('lease: letzter freier Seat in 1v1 ist nach Ablauf wieder nutzbar (Match startbar)',
      await (async () => { const a = await activate('ABQA', 2); return a.started === true; })());
    // Aktiver Seat: Lease-Ablauf aendert NICHTS.
    codeQueue.push('ABQB');
    simNow = BASE;
    await creAct(0, 'req-lease-0002', CFG('ffa'));
    await joinAct('ABQB', 1);
    simNow = BASE + roomCore.RESERVE_LEASE_MS * 5;       // weit nach jeder Lease
    const jNo = await join('ABQB', 2);
    t('lease: aktiver Seat wird NIE recycelt (neuer Spieler bekommt Seat 2)', jNo.seat === 2);
    t('lease: aktiver Seat behaelt Besitzer und Session',
      (await roomOf('ABQB')).players[1].uid === UID[1] && (await db.ref('rooms/ABQB/sess/1/active').get()).val() === sessOf('ABQB', 1));
    simNow = BASE;

    // ── 8c) LISTING-CLEANUP: Transaction, strikt iid-gebunden ───────────────
    codeQueue.push('ABQC');
    const cL = await creAct(0, 'req-list-0001', CFG('ffa', 'public'));
    const iidOld = cL.iid;
    await db.ref('publicRooms/ABQC').set({ created: BASE, iid: iidOld });
    await leave('ABQC', 0);                              // letzter Spieler -> Raum weg
    t('listing: Raum geloescht, eigenes Listing mit entfernt',
      (await roomOf('ABQC')) === null && (await db.ref('publicRooms/ABQC').get()).val() === null);
    // Recycelter Code: neuer Raum + NEUES Listing; der alte Cleanup laeuft danach.
    codeQueue.push('ABQC');
    const cL2 = await creAct(2, 'req-list-0002', CFG('ffa', 'public'));
    const newListing = { created: BASE + 1, iid: cL2.iid };
    await db.ref('publicRooms/ABQC').set(newListing);
    const roomFresh = core.canonical(await roomOf('ABQC'));
    t('listing: alter Leave gegen die neue Instanz wird abgewiesen (iid)',
      (await err(() => rc.roomLeaveV4({ uid: UID[0], room: 'ABQC', iid: iidOld, session: 'ALTETOKEN0000001' }))) === 'failed');
    t('listing: alter Cleanup laesst das NEUE Listing byte-identisch stehen',
      core.canonical((await db.ref('publicRooms/ABQC').get()).val()) === core.canonical(newListing));
    t('listing: alter Cleanup beruehrt den neuen Raum nicht', core.canonical(await roomOf('ABQC')) === roomFresh);
    t('listing: v3-Listing (ohne iid) wird von einem v4-Cleanup nie geloescht',
      await (async () => {
        await db.ref('publicRooms/ABQD').set({ created: BASE });
        await rc.roomLeaveV4({ uid: UID[0], room: 'ABQD', iid: iidOld, session: 'ALTETOKEN0000001' });
        return (await db.ref('publicRooms/ABQD').get()).val() != null;
      })());

    // ── 8d) IID AN DEN ARBITER-GRENZEN: alte Operation, neuer Raum ──────────
    //    Ein recycelter Raumcode darf von keiner alten Clock-/Archiv-/Rematch-
    //    Operation beruehrt werden — auch nicht ueber den Arbiter.
    codeQueue.push('ABQE');
    const cI = await creAct(0, 'req-iid-00001', CFG('single'));
    await joinAct('ABQE', 1);                            // startet das 1v1
    const oldIid = cI.iid, oldSess = sessOf('ABQE', 0);
    const liveOld = core.canonical(await liveOf('ABQE'));
    t('iid: Arbiter-Close mit fremder iid abgelehnt',
      (await err(() => clk.clockClose({ room: 'ABQE', phaseId: '0:0', uid: UID[0], iid: 'IIDFREMD00000001', session: oldSess }))) === 'failed');
    t('iid: Arbiter-Settle mit fremder iid abgelehnt',
      (await err(() => clk.clockSettle({ room: 'ABQE', phaseId: '0:0', uid: UID[0], hash: 'h', next: '', iid: 'IIDFREMD00000001', session: oldSess }))) === 'failed');
    t('iid: Arbiter-Start mit fremder iid abgelehnt',
      (await err(() => clk.clockStart({ room: 'ABQE', uid: UID[0], iid: 'IIDFREMD00000001', session: oldSess }))) === 'failed');
    t('iid: live blieb durch alle Fremd-iid-Versuche unveraendert', core.canonical(await liveOf('ABQE')) === liveOld);
    // Raum loeschen und unter demselben Code NEU erstellen.
    await db.ref('rooms/ABQE').set(null);
    codeQueue.push('ABQE');
    const cI2 = await creAct(3, 'req-iid-00002', CFG('single'));
    await joinAct('ABQE', 4);
    const freshLive = core.canonical(await liveOf('ABQE'));
    const freshRoom = core.canonical(await roomOf('ABQE'));
    t('iid: alte Clock-Operation gegen den neuen Raum abgelehnt',
      (await err(() => clk.clockClose({ room: 'ABQE', phaseId: '0:0', uid: UID[0], iid: oldIid, session: oldSess }))) === 'failed');
    t('iid: alter Rematch gegen den neuen Raum abgelehnt',
      (await err(() => rc.roomRematchV4({ uid: UID[0], room: 'ABQE', expectedGen: 0, iid: oldIid, session: oldSess }))) === 'failed');
    t('iid: neuer Raum und seine live-Phase blieben byte-identisch',
      core.canonical(await liveOf('ABQE')) === freshLive && core.canonical(await roomOf('ABQE')) === freshRoom);
    t('iid: neue Instanz arbeitet normal weiter (eigener Close ist zulaessig)',
      await (async () => {
        for (const s of [0, 1]) await db.ref(`rooms/ABQE/g/0/live/slots/${s}`).set({ idx: s, dx: 10, dy: 10, sp: 0, t: 0, sid: sessOf('ABQE', s === 0 ? 3 : 4) });
        const c = await clk.clockClose({ room: 'ABQE', phaseId: '0:0', uid: UID[3], iid: cI2.iid, session: sessOf('ABQE', 3) });
        return c.status === 'closed';
      })());

    // ── 8e) PROVISIONAL: nie finalisierte Creates sind nicht spielbar ───────
    codeQueue.push('ABQF');
    let reqTx2 = 0;
    const crashProv = mkCore(hookDb({ failTx: (p) => p.indexOf('reqs/' + UID[0] + '/req-prov-0001') === 0 && (++reqTx2) === 2 }));
    await err(() => crashProv.roomCreateV4(Object.assign({ uid: UID[0], requestId: 'req-prov-0001', config: CFG('ffa', 'public') }, IDENT(0))));
    const rProv = await roomOf('ABQF');
    t('provisional: Raum existiert, ist aber als provisional markiert', rProv != null && rProv.provisional === true);
    t('provisional: nicht joinbar', (await err(() => join('ABQF', 1))) === 'failed');
    t('provisional: Host kann seine Session nicht aktivieren (Raum unfertig)',
      (await err(() => rc.roomActivateV4({ uid: UID[0], room: 'ABQF', iid: rProv.iid, token: rProv.sess[0].pending.token, leaseId: rProv.sess[0].pending.leaseId }))) === 'failed');
    t('provisional: nicht startbar (Session nie aktiv)',
      (await err(() => rc.roomStartV4({ uid: UID[0], room: 'ABQF', iid: rProv.iid, session: rProv.sess[0].pending.token }))) === 'permission');
    t('provisional: kein Match, keine Clock', (await roomOf('ABQF')).state === 'lobby' && (await clockOf('ABQF')) === null);
    t('provisional: nicht listbar (Rules)', (await restPut('publicRooms/ABQF', { created: { '.sv': 'timestamp' }, iid: rProv.iid }, UID[0])) === false);
    const cProv = await rc.roomCreateV4(Object.assign({ uid: UID[0], requestId: 'req-prov-0001', config: CFG('ffa', 'public') }, IDENT(0)));
    t('provisional: identischer Retry aktiviert exakt denselben Raum',
      cProv.room === 'ABQF' && cProv.iid === rProv.iid && (await roomOf('ABQF')).provisional === undefined);
    remember('ABQF', 0, cProv);
    t('provisional: danach normal joinbar', (await join('ABQF', 1)).seat === 1);
    // Nie retried: der provisionale Raum verfaellt und wird opportunistisch entfernt.
    codeQueue.push('ABQG');
    let reqTx3 = 0;
    const crashProv2 = mkCore(hookDb({ failTx: (p) => p.indexOf('reqs/' + UID[1] + '/req-prov-0002') === 0 && (++reqTx3) === 2 }));
    await err(() => crashProv2.roomCreateV4(Object.assign({ uid: UID[1], requestId: 'req-prov-0002', config: CFG('ffa') }, IDENT(1))));
    t('provisional: Leiche existiert zunaechst', (await roomOf('ABQG')) != null);
    simNow = BASE + roomCore.PROVISIONAL_TTL_MS;
    const iidQG = (await roomOf('ABQG')).iid;
    t('provisional: abgelaufener Raum wird beim Join-Versuch sicher entfernt',
      (await err(() => rc.roomJoinV4(Object.assign({ uid: UID[2], room: 'ABQG', iid: iidQG }, IDENT(2))))) === 'not-found'
      && (await roomOf('ABQG')) === null);
    simNow = BASE;

    // ── 9) V3-REGRESSION: der produktive Pfad bleibt unveraendert ───────────
    const SV = { '.sv': 'timestamp' };
    const v3new = {
      v: 3, config: CFG('single'), gen: 0, state: 'lobby', created: SV,
      p: { 0: { s: 'TABV3111', on: false, t: SV } },
      players: { 0: { id: 'PIDV3111', name: 'V3', tab: 'TABV3111' } },
    };
    t('v3: Raumerstellung ohne Auth weiterhin erlaubt', (await restPut('rooms/ABMA', v3new)) === true);
    t('v3: Host-ACTIVATE weiterhin erlaubt', (await restPut('rooms/ABMA/p/0', { s: 'TABV3111', on: true, t: SV })) === true);
    t('v3: atomarer Gast-RESERVE (p+players) weiterhin erlaubt',
      (await restPatch('rooms/ABMA', {
        'p/1': { s: 'TABV3222', on: false, t: SV },
        'players/1': { id: 'PIDV3222', name: 'G', tab: 'TABV3222' },
      })) === true);
    t('v3: gekoppelter ACTIVATE+Start (p/1+state) weiterhin erlaubt',
      (await restPatch('rooms/ABMA', {
        'p/1': { s: 'TABV3222', on: true, t: SV },
        state: 'playing',
      })) === true);
    t('v3: Move-Write ohne Auth weiterhin erlaubt', (await restPut('rooms/ABMA/g/0/t/0/0', { idx: 0, dx: 10, dy: 10, sp: 0 })) === true);
    t('v3: gen-Bump ohne Auth weiterhin erlaubt', (await restPut('rooms/ABMA/gen', 1)) === true);
    const v3ffa = {
      v: 3, config: CFG('ffa'), gen: 0, state: 'lobby', created: SV,
      p: { 0: { s: 'TABV3331', on: true, t: BASE }, 1: { s: 'TABV3332', on: true, t: BASE } },
      players: { 0: { id: 'PIDV3331', name: 'A', tab: 'TABV3331' }, 1: { id: 'PIDV3332', name: 'B', tab: 'TABV3332' } },
    };
    await db.ref('rooms/ABMB').set(Object.assign({}, v3ffa, { created: Date.now() - 5000 }));
    t('v3: FFA-Start (state) weiterhin erlaubt', (await restPut('rooms/ABMB/state', 'playing')) === true);
    t('v3: FFA-Start (seats) weiterhin erlaubt', (await restPut('rooms/ABMB/seats', 2)) === true);
    const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
    // Migrationsstand des Clients. IIIB forderte hier "Client bleibt v3", weil
    // dort index.html unberuehrt blieb. Auf dem Integrationsbranch fuehrt der
    // Client seit 5e59db6 ("prepare protocol v4") bereits Version 4 — die alte
    // Aussage ist damit gegenstandslos, die dahinterliegende Absicht nicht:
    // solange die Client-Migration nicht GESCHLOSSEN ist (Etappe C), darf der
    // Client keine v4-Callable aufrufen. Genau das haelt der zweite Assert fest;
    // er wird mit der Migration gemeinsam auf den Zielzustand gezogen.
    t('v4: Client fuehrt Protokollversion 4', /const ONLINE_PROTOCOL_VERSION\s*=\s*4/.test(html));
    t('v3: Client referenziert die neuen Callables noch nicht',
      ['roomCreateV4', 'roomJoinV4', 'roomActivateV4', 'roomLeaveV4', 'roomStartV4', 'roomRematchV4']
        .every((n) => html.indexOf(n) < 0));
    t('v4: direkter Client-Create verboten', (await restPut('rooms/ABMC', Object.assign({}, v3new, { v: 4 }), UID[0])) === false);
    t('v4: reqs-Marker fuer Clients gesperrt', (await restPut('reqs/' + UID[0] + '/req-x-000001', { sig: 'x' }, UID[0])) === false);
    t('v4: Client-state-Write verboten', (await restPut('rooms/ABKN/state', 'playing', UID[0])) === false);

    // ── 10) CALLABLE-WRAPPER am ECHTEN Functions-Emulator ───────────────────
    //    Prueft functions/index.js selbst: Auth-Pflicht, Argument-Allowlist,
    //    Fehlercode-Mapping und alle sechs Lifecycle-Wrapper (reale Wanduhr —
    //    nur strukturelle Asserts).
    const W0 = 'uid-wrap-host-01', W1 = 'uid-wrap-guest-1', WX = 'uid-wrap-fremd-1';
    const WID = { pid: 'PIDWRAP00', tab: 'TABWRAP00' };
    const noAuth = await callFn('roomCreateV4', { requestId: 'req-wrap-00001', config: CFG(), pid: WID.pid, tab: WID.tab, name: 'W' });
    t('wrapper: ohne Auth -> UNAUTHENTICATED', noAuth.http === 401 && noAuth.code === 'UNAUTHENTICATED');
    const badCfg = await callFn('roomCreateV4', { requestId: 'req-wrap-00002', config: { winTarget: 9, fmt: 'single', visibility: 'private' }, pid: WID.pid, tab: WID.tab }, W0);
    t('wrapper: invalid-argument gemappt', badCfg.code === 'INVALID_ARGUMENT');
    const wc = await callFn('roomCreateV4', { requestId: 'req-wrap-00003', config: CFG(), pid: WID.pid, tab: WID.tab, name: 'Host' }, W0);
    t('wrapper: roomCreateV4 liefert room/iid/seat', wc.ok && wc.result && wc.result.seat === 0
      && typeof wc.result.room === 'string' && typeof wc.result.iid === 'string');
    const wroom = wc.result.room, wiid = wc.result.iid;
    // Die Functions-Runtime kann ihren Default-Namespace ohne "-default-rtdb"-
    // Suffix aufloesen — den tatsaechlichen Namespace einmalig detektieren und
    // die Admin-Sicht der Wrapper-Raeume daran binden.
    let dbW = db;
    if ((await roomOf(wroom)) === null) {
      const appW = admin.initializeApp({ projectId: PROJECT, databaseURL: `http://${EMU_HOST}:${EMU_PORT}?ns=${PROJECT}` }, 'fnns');
      dbW = admin.database(appW);
    }
    const roomOfW = async (code) => (await dbW.ref('rooms/' + code).get()).val();
    t('wrapper: erstellter Raum im Functions-Namespace vorhanden', (await roomOfW(wroom)) !== null);
    t('wrapper: roomCreateV4 liefert die pending Host-Session (token+leaseId)',
      typeof wc.result.token === 'string' && typeof wc.result.leaseId === 'string');
    const nf = await callFn('roomJoinV4', { room: 'ZZQQ', iid: wiid, pid: 'PIDWRAP01', tab: 'TABWRAP01' }, W1);
    t('wrapper: not-found gemappt', nf.code === 'NOT_FOUND');
    // Argument-Allowlist: boesartige Extra-Felder erreichen den Kern nicht.
    const wj = await callFn('roomJoinV4', {
      room: wroom, iid: wiid, pid: 'PIDWRAP01', tab: 'TABWRAP01', name: 'Gast',
      seat: 4, seatByUid: { [WX]: 0 }, sess: { 1: { active: 'HACK' } }, gen: 9, clock: { remainingMs: 1 },
    }, W1);
    const wroomVal = await roomOfW(wroom);
    t('wrapper: roomJoinV4 reserviert Seat 1 (pending), Allowlist filtert Manipulationsfelder',
      wj.ok && wj.result.seat === 1 && typeof wj.result.token === 'string'
      && wroomVal.gen === 0 && wroomVal.g === undefined && wroomVal.state === 'lobby'
      && wroomVal.seatByUid[WX] === undefined
      && wroomVal.sess[1].active == null && wroomVal.sess[1].pending.token === wj.result.token);
    const permA = await callFn('roomActivateV4', { room: wroom, iid: wiid, token: wj.result.token, leaseId: wj.result.leaseId }, WX);
    t('wrapper: permission-denied gemappt (fremde UID)', permA.code === 'PERMISSION_DENIED');
    const badLease = await callFn('roomActivateV4', { room: wroom, iid: wiid, token: wj.result.token, leaseId: 'FALSCHELEASE0001' }, W1);
    t('wrapper: falsche leaseId -> FAILED_PRECONDITION', badLease.code === 'FAILED_PRECONDITION');
    const noTok = await callFn('roomActivateV4', { room: wroom, iid: wiid }, W1);
    t('wrapper: Activate ohne Token -> INVALID_ARGUMENT', noTok.code === 'INVALID_ARGUMENT');
    const wa0 = await callFn('roomActivateV4', { room: wroom, iid: wiid, token: wc.result.token, leaseId: wc.result.leaseId }, W0);
    const wa1 = await callFn('roomActivateV4', { room: wroom, iid: wiid, token: wj.result.token, leaseId: wj.result.leaseId }, W1);
    t('wrapper: roomActivateV4 startet das 1v1 erst nach BEIDEN Aktivierungen',
      wa0.ok && wa0.result.started === false && wa1.ok && wa1.result.started === true
      && wa1.result.token === wj.result.token && (await roomOfW(wroom)).state === 'playing');
    const wlNoSess = await callFn('roomLeaveV4', { room: wroom, iid: wiid }, W1);
    t('wrapper: Leave ohne Session -> INVALID_ARGUMENT', wlNoSess.code === 'INVALID_ARGUMENT');
    const wl = await callFn('roomLeaveV4', { room: wroom, iid: wiid, session: wa1.result.token }, W1);
    t('wrapper: failed-precondition gemappt (Leave im Match)', wl.code === 'FAILED_PRECONDITION');
    const wrGuest = await callFn('roomRematchV4', { room: wroom, iid: wiid, expectedGen: 0, session: wa1.result.token }, W1);
    t('wrapper: Rematch durch Gast -> PERMISSION_DENIED', wrGuest.code === 'PERMISSION_DENIED');
    await dbW.ref('rooms/' + wroom + '/g/0/live/clock').update({ phase: 'finished', reason: 'complete' });
    const wrStale = await callFn('roomRematchV4', { room: wroom, iid: wiid, expectedGen: 0, session: 'ALTETOKEN0000001' }, W0);
    t('wrapper: Rematch mit alter Session -> PERMISSION_DENIED', wrStale.code === 'PERMISSION_DENIED');
    const wrHost = await callFn('roomRematchV4', { room: wroom, iid: wiid, expectedGen: 0, session: wa0.result.token }, W0);
    t('wrapper: Rematch durch Host -> Gen 1 mit frischer Clock',
      wrHost.ok && wrHost.result.gen === 1 && wrHost.result.clock.remainingMs === CYCLE && wrHost.result.clock.stage === 0);
    // FFA-Start ueber den Wrapper (kompletter Handshake).
    const wc2 = await callFn('roomCreateV4', { requestId: 'req-wrap-00004', config: CFG('ffa'), pid: WID.pid, tab: WID.tab, name: 'Host' }, W0);
    const w2room = wc2.result.room, w2iid = wc2.result.iid;
    const wj2 = await callFn('roomJoinV4', { room: w2room, iid: w2iid, pid: 'PIDWRAP01', tab: 'TABWRAP01' }, W1);
    const wa2h = await callFn('roomActivateV4', { room: w2room, iid: w2iid, token: wc2.result.token, leaseId: wc2.result.leaseId }, W0);
    const wa2g = await callFn('roomActivateV4', { room: w2room, iid: w2iid, token: wj2.result.token, leaseId: wj2.result.leaseId }, W1);
    t('wrapper: FFA bleibt nach beiden Aktivierungen in der Lobby (Host startet explizit)',
      wa2h.ok && wa2g.ok && wa2g.result.started === false && (await roomOfW(w2room)).state === 'lobby');
    const wsGuest = await callFn('roomStartV4', { room: w2room, iid: w2iid, session: wa2g.result.token }, W1);
    t('wrapper: Start durch Gast -> PERMISSION_DENIED', wsGuest.code === 'PERMISSION_DENIED');
    const ws = await callFn('roomStartV4', { room: w2room, iid: w2iid, session: wa2h.result.token }, W0);
    t('wrapper: roomStartV4 startet FFA (ein Zyklus, stage 0, deadline relativ +7000)',
      ws.ok && ws.result.status === 'started' && ws.result.clock.remainingMs === CYCLE && ws.result.clock.stage === 0
      && ws.result.clock.deadlineAt === ws.result.clock.startedAt + 7000);
    const wLeave = await callFn('roomLeaveV4', { room: 'ZZQQ', iid: wiid, session: wa0.result.token }, W0);
    t('wrapper: Leave auf geloeschtem/fremdem Raum idempotent gone', wLeave.ok && wLeave.result.status === 'gone');

    exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('FAIL: unerwarteter Fehler:', e && e.stack || e);
    exitCode = 2;
  } finally {
    // Cleanup-Vertrag: laeuft IMMER (auch bei Testfehlern und erzwungenen
    // Abbruechen), meldet jeden Cleanup-Fehler sichtbar und prueft den
    // tatsaechlichen Exit beider Emulatoren (ein Kindprozess deckt RTDB und
    // Functions ab — taskkill /T beendet den ganzen Baum).
    for (const a of admin.apps.slice()) { try { await a.delete(); } catch (e) { console.error('Cleanup: App-Delete fehlgeschlagen: ' + (e && e.message)); } }
    const killed = await killTree(emu.child.pid);
    if (!killed) console.error('Cleanup: taskkill meldete Fehler fuer PID ' + emu.child.pid + '.');
    const exited = await new Promise((resolve) => {
      if (emu.child.exitCode != null) return resolve(true);
      const to = setTimeout(() => resolve(emu.child.exitCode != null), 10000);
      emu.child.once('exit', () => { clearTimeout(to); resolve(true); });
    });
    if (!exited) console.error('Cleanup: Emulator-Kindprozess laeuft noch (PID ' + emu.child.pid + ').');
    try { fs.rmSync(runDir, { recursive: true, force: true }); }
    catch (e) { console.error('Cleanup: Temp-Verzeichnis nicht entfernt (' + runDir + '): ' + (e && e.message)); }
  }
  console.log('\nRoom-Lifecycle (RTDB+Functions-Emulator): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(exitCode);
})();
