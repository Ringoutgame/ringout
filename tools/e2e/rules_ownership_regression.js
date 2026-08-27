// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Ownership-Regression (Online-Protokoll v3.1, Block A).
//
//   node tools/e2e/rules_ownership_regression.js   (bzw. npm run test:e2e:own)
//
// Prueft die authentifizierte Seat-Ownership gegen den ECHTEN RTDB-Emulator mit
// dem ECHTEN Firebase-Auth-Emulator. Jeder Client ist ein eigener Browser-
// Kontext und meldet sich eigenstaendig anonym an — die Rules sehen also echte,
// verschiedene request.auth.uid-Werte. Es gibt bewusst KEINE gefaelschte
// window-Variable als Ersatz: ein Ownership-Beweis, den der Test selbst setzt,
// beweist nichts.
//
// Der Lauf faehrt JEDEN Fall zweimal — einmal gegen den deploybaren EXPAND-Stand
// (firebase.rules.json) und einmal gegen den abgeleiteten CONTRACT-Stand
// (firebase.rules.contract.json). Genau das ist die Migrationsaussage:
//
//   EXPAND   Seat MIT uid ist geschuetzt; Seat OHNE uid verhaelt sich wie v3,
//            damit bereits ausgelieferte Clients weiterspielen koennen.
//   CONTRACT uid ist Pflicht, auth != null wird verlangt — der Zielstand.
//
// Ein erwarteter DENY zaehlt ausschliesslich bei echtem PERMISSION_DENIED
// (Bewertung in Node, nicht in der Seite). Verbindungs-, SDK- oder
// Transportfehler sind KEIN bestandener Security-Fall.
//
// Fail-closed: jeder falsche ALLOW/DENY, jeder Nicht-Rules-Fehler in einem
// DENY-Fall, ein Produktionskontakt, ein Emulator-/Timeout-Fehler oder ein
// Cleanup-Fehler beendet den Lauf mit Exit-Code 1.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const H = require('./lib/harness');
const { CONTRACT_FILE } = require('../derive_contract_rules');

const RUN_TIMEOUT_MS = Number(process.env.OWN_SEC_TIMEOUT_MS) || 8 * 60 * 1000;
const DENY_CODE = 'PERMISSION_DENIED';
const CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const HEX64 = 'a'.repeat(64);

function classify(res, kind) {
  if (kind === 'allow') {
    return (res && res.ok === true)
      ? { ok: true }
      : { ok: false, detail: 'unerwartet abgelehnt — code=' + JSON.stringify(res && res.code) + ' err=' + JSON.stringify(res && res.err) };
  }
  if (!res || res.ok !== false) return { ok: false, detail: 'unerwartet AKZEPTIERT (Regel greift nicht)' };
  const code = typeof res.code === 'string' ? res.code.toUpperCase() : null;
  return code === DENY_CODE
    ? { ok: true }
    : { ok: false, detail: 'abgelehnt, aber KEIN Rules-DENY — code=' + JSON.stringify(res.code) + ' err=' + JSON.stringify(res.err) };
}

// ── Ein Client = ein Browserkontext = eine eigene anonyme auth.uid ───────────
async function newClient(browser, url, label, state) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await H.armContext(context, label, state);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FB_READY === true, null, { timeout: 40000 });
  const info = await page.evaluate(() => ({ uid: window.__FB_UID || null, err: window.__FB_ERR || window.__FB_AUTH_ERR || null }));
  if (!info.uid) throw new Error(`${label}: keine auth.uid (${info.err || 'unbekannt'}) — Auth-Emulator nicht erreichbar?`);

  const call = (op) => (p, v) => page.evaluate(async ([o, pp, vv]) => {
    const FB = window.FB, ref = FB.ref(FB.db, 'rooms/' + pp);
    const revive = (x) => {
      if (Array.isArray(x)) return x.map(revive);
      if (x && typeof x === 'object') {
        if (x.__sv === 'ts') return FB.serverTimestamp();
        const out = {}; for (const k of Object.keys(x)) out[k] = revive(x[k]); return out;
      }
      return x;
    };
    try {
      if (o === 'set') await FB.set(ref, revive(vv));
      else await FB.update(ref, revive(vv));
      return { ok: true };
    } catch (e) {
      return { ok: false, code: (e && typeof e.code === 'string') ? e.code : null, err: String((e && e.message) || e) };
    }
  }, [op, p, v === undefined ? null : v]);

  return {
    label, page, context, uid: info.uid,
    set: call('set'),
    upd: call('upd'),
    read: (p) => page.evaluate(async (pp) => {
      const s = await window.FB.get(window.FB.ref(window.FB.db, 'rooms/' + pp));
      return s.exists() ? s.val() : null;
    }, p),
  };
}

const TS = { __sv: 'ts' };                        // wird in der Seite zu serverTimestamp()
const P = (tab, on) => ({ s: tab, on, t: TS });

// ── Die Faelle ───────────────────────────────────────────────────────────────
// Jeder Fall nennt seine Erwartung pro Rules-Stand. `skip` markiert Faelle, die
// in einem Stand konstruktionsbedingt nicht existieren koennen.
async function runCases(stage, cl, checks) {
  const [owner, foe, owner2] = cl;
  const rec = (uid, tab, name) => ({ id: 'PID' + uid.slice(0, 8).replace(/[^A-Za-z0-9_-]/g, 'x') + '0000', name, tab, uid });
  const expect = (name, kind, res, detail) => {
    const v = classify(res, kind);
    checks.push({ stage, name, ok: v.ok, detail: v.ok ? (detail || null) : v.detail });
  };
  const state = (name, ok, detail) => checks.push({ stage, name, ok: !!ok, detail: ok ? null : (detail || null) });

  const freshCode = async () => {
    for (let i = 0; i < 20; i++) {
      const c = Array.from({ length: 4 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');
      if ((await owner.read(c)) == null) return c;
    }
    throw new Error('kein freier Raumcode');
  };

  // Ein FFA-Raum mit drei Seats: 0 = owner, 1 = owner2, 2 = foe.
  // Jeder Seat wird von SEINEM Eigentuemer beansprucht — genau wie im Produkt.
  const mkRoom = async (fmt, seatOwners) => {
    const code = await freshCode();
    const host = seatOwners[0];
    await host.set(code, {
      v: 3, config: { winTarget: 3, fmt, visibility: 'private' }, gen: 0, state: 'lobby',
      p: { 0: P('HOSTTAB0', false) }, players: { 0: rec(host.uid, 'HOSTTAB0', 'H') }, created: TS,
    });
    await host.upd(code, { 'p/0/on': true, 'p/0/t': TS });
    const ffaLike = fmt === 'ffa' || fmt === 'triple_ffa' || fmt === 'team_duel';
    for (let seat = 1; seat < seatOwners.length; seat++) {
      const c = seatOwners[seat], tab = 'TAB00' + seat + '000';
      await c.upd(code, { ['p/' + seat]: P(tab, false), ['players/' + seat]: rec(c.uid, tab, 'P' + seat) });
      // 1v1/2v2: der Gast wird nur zusammen mit dem Start aktiv (Bestandsvertrag,
      // s. activateSeat(code,seat,{state:'playing'})). FFA startet der Host separat.
      const act = { ['p/' + seat + '/on']: true, ['p/' + seat + '/t']: TS };
      if (!ffaLike && seat === 1) act.state = 'playing';
      await c.upd(code, act);
    }
    return code;
  };

  // ══ CLAIM / UID ═══════════════════════════════════════════════════════════
  {
    const code = await mkRoom('ffa', [owner, owner2, foe]);
    const room = await owner.read(code);
    const ok = !!room && [0, 1, 2].every((s) => room.p && room.p[s] && room.p[s].on === true);
    state('Setup: FFA-Raum, drei Seats von drei verschiedenen auth.uid beansprucht', ok, JSON.stringify(room && room.p));

    state('C0: die drei Clients tragen verschiedene auth.uid',
      owner.uid !== foe.uid && owner.uid !== owner2.uid && foe.uid !== owner2.uid,
      [owner.uid, owner2.uid, foe.uid].join(' / '));
    state('C0b: players/<seat>/uid entspricht dem jeweiligen Client',
      room.players[0].uid === owner.uid && room.players[1].uid === owner2.uid && room.players[2].uid === foe.uid);

    expect('C1: eigener frischer Claim', 'allow', { ok: ok });
    expect('C2: players.uid != auth.uid', 'deny',
      await foe.upd(code, { 'players/2/uid': owner.uid }));
    expect('C3: fremde uid nach dem Claim aendern', 'deny',
      await foe.upd(code, { 'players/0/uid': foe.uid }));
    // Der Angreifer kennt Token und Namen des Opfers — sie sind welt-lesbar.
    const victimTab = room.p[0].s, victimRec = room.players[0];
    state('C4a: Seat-Token des Opfers ist oeffentlich lesbar', victimTab === 'HOSTTAB0', JSON.stringify(victimTab));
    expect('C4: fremden AKTIVEN Seat mit kopiertem Token uebernehmen', 'deny',
      await foe.upd(code, { 'p/0': P(victimTab, false), 'players/0': rec(foe.uid, victimTab, victimRec.name) }));

    // ── PRESENCE ────────────────────────────────────────────────────────────
    expect('P1a: eigene Presence auf on:false', 'allow',
      await foe.upd(code, { 'p/2/s': 'TAB002000', 'p/2/on': false, 'p/2/t': TS }));
    expect('P1b: eigene Presence zurueck auf on:true', 'allow',
      await foe.upd(code, { 'p/2/s': 'TAB002000', 'p/2/on': true, 'p/2/t': TS }));
    expect('P2: fremde Presence auf on:false', 'deny',
      await foe.upd(code, { 'p/0/s': victimTab, 'p/0/on': false, 'p/0/t': TS }));
    state('P2b: fremde Presence unveraendert', (await owner.read(code + '/p/0/on')) === true);
    // Erst den Nachbarn regulaer offline nehmen — sonst scheitert der Angriff schon
    // am Presence-Zustand und der Ownership-Zweig bliebe ungeprueft.
    await owner2.upd(code, { 'p/1/s': 'TAB001000', 'p/1/on': false, 'p/1/t': TS });
    expect('P3: fremde Presence auf on:true zurueckholen', 'deny',
      await foe.upd(code, { 'p/1/s': 'TAB001000', 'p/1/on': true, 'p/1/t': TS }));
    await owner2.upd(code, { 'p/1/s': 'TAB001000', 'p/1/on': true, 'p/1/t': TS });
    expect('P4/P5: fremdes p + players atomar loeschen', 'deny',
      await foe.upd(code, { 'p/0': null, 'players/0': null }));
    state('P5b: fremder Roster-Eintrag unveraendert', (await owner.read(code + '/players/0/uid')) === owner.uid);

    // ── MOVE ────────────────────────────────────────────────────────────────
    await owner.set(code + '/state', 'playing');
    await owner.set(code + '/seats', 3);
    expect('M1: eigener Move-Slot', 'allow',
      await foe.set(code + '/g/0/t/0/2', { idx: 2, dx: 40, dy: -10, sp: 0.1 }));
    expect('M2: fremder Move-Slot', 'deny',
      await foe.set(code + '/g/0/t/0/0', { idx: 0, dx: 40, dy: -10, sp: 0.1 }));
    state('M2b: fremder Slot blieb leer', (await owner.read(code + '/g/0/t/0/0')) === null);
    expect('M3: eigener Move des Eigentuemers weiterhin moeglich', 'allow',
      await owner.set(code + '/g/0/t/0/0', { idx: 0, dx: 5, dy: 5, sp: 0 }));
  }

  // ══ BARRIER (2 Seats, bestehender Commit-Reveal-Vertrag) ══════════════════
  {
    const code = await mkRoom('single', [owner, owner2]);   // laeuft bereits (Gastclaim hat gestartet)
    const bc = (seat, turn) => ({ v: 1, seat, turn, hash: HEX64 });
    const br = (seat, turn, seg) => ({ v: 1, seat, turn, nonce: HEX64, seg });
    expect('B1: eigener bc', 'allow', await owner.set(code + '/g/0/t/0/bc/0', bc(0, 0)));
    expect('B2: fremder bc', 'deny', await owner.set(code + '/g/0/t/0/bc/1', bc(1, 0)));
    expect('B3: bc des zweiten Eigentuemers', 'allow', await owner2.set(code + '/g/0/t/0/bc/1', bc(1, 0)));
    expect('B4: eigener br nach beiden bc', 'allow', await owner.set(code + '/g/0/t/0/br/0', br(0, 0, 3)));
    expect('B5: fremder br', 'deny', await owner.set(code + '/g/0/t/0/br/1', br(1, 0, 3)));
    expect('B6: br des zweiten Eigentuemers', 'allow', await owner2.set(code + '/g/0/t/0/br/1', br(1, 0, 3)));
    expect('B7: Segment weiterhin ganzzahlig (Bestandsvertrag)', 'deny',
      await owner.set(code + '/g/0/t/1/br/0', br(0, 1, 3.5)));
  }

  // ══ SESSION: Reload, zweiter Tab, gestohlene Tokens ═══════════════════════
  {
    const code = await mkRoom('ffa', [owner, owner2, foe]);
    await owner.set(code + '/state', 'playing');   // Reclaim-Zweig gilt im laufenden Match
    const before = await owner.read(code + '/players/1');
    // Disconnect des Eigentuemers (wie onDisconnect)
    await owner2.upd(code, { 'p/1/s': 'TAB001000', 'p/1/on': false, 'p/1/t': TS });
    // Reload = neue Session (neuer tab), gleiche auth.uid
    expect('S1: Reclaim mit derselben auth.uid und neuem Tab', 'allow',
      await owner2.upd(code, { 'p/1': P('NEWTAB01', false), 'players/1': rec(owner2.uid, 'NEWTAB01', before.name) }));
    expect('S1b: danach wieder aktiv', 'allow',
      await owner2.upd(code, { 'p/1/s': 'NEWTAB01', 'p/1/on': true, 'p/1/t': TS }));
    // Angreifer kennt pid und tab — aber nicht die uid
    await owner2.upd(code, { 'p/1/s': 'NEWTAB01', 'p/1/on': false, 'p/1/t': TS });
    expect('S2: fremde auth.uid mit kopierter id und kopiertem tab kann NICHT reclaimen', 'deny',
      await foe.upd(code, { 'p/1': P('STOLENTB', false), 'players/1': { id: before.id, name: before.name, tab: 'STOLENTB', uid: foe.uid } }));
    state('S2b: Eigentuemer unveraendert', (await owner.read(code + '/players/1/uid')) === owner2.uid);
  }

  // ══ LOBBY-RECYCLING: der bestehende Stale-Pfad muss offen bleiben ═════════
  {
    const code = await mkRoom('ffa', [owner, owner2, foe]);
    // Seat 2 geht offline; erst nach SEAT_STALE_MS darf ein NEUER Spieler ran.
    await foe.upd(code, { 'p/2/s': 'TAB002000', 'p/2/on': false, 'p/2/t': TS });
    const t0 = Date.now();
    expect('L1: Recycling innerhalb der Karenz', 'deny',
      await owner2.upd(code, { 'p/2': P('RECYTAB1', false), 'players/2': rec(owner2.uid, 'RECYTAB1', 'R') }));
    const waitMs = 15600 - (Date.now() - t0);
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    expect('L2: Recycling nach der bestehenden Stale-Regel (>= 15 s, Lobby)', 'allow',
      await owner2.upd(code, { 'p/2': P('RECYTAB1', false), 'players/2': rec(owner2.uid, 'RECYTAB1', 'R') }));
    state('L2b: Seat gehoert jetzt dem neuen Eigentuemer', (await owner.read(code + '/players/2/uid')) === owner2.uid);
  }

  // ══ MIGRATION: Seat OHNE uid ══════════════════════════════════════════════
  // Genau hier unterscheiden sich die beiden Rules-Staende. EXPAND laesst einen
  // uid-losen Seat wie unter v3 zu (bereits ausgelieferte Clients spielen
  // weiter); CONTRACT verlangt die uid und sperrt ihn aus.
  {
    const code = await freshCode();
    const legacyCreate = await owner.set(code, {
      v: 3, config: { winTarget: 3, fmt: 'ffa', visibility: 'private' }, gen: 0, state: 'lobby',
      p: { 0: P('LEGCYTAB', false) }, players: { 0: { id: 'LEGACYID0000', name: 'L', tab: 'LEGCYTAB' } }, created: TS,
    });
    expect('X1: Raum mit uid-losem Roster anlegen (Altclient-Form)', stage === 'expand' ? 'allow' : 'deny', legacyCreate);
    if (stage === 'expand') {
      await owner.upd(code, { 'p/0/on': true, 'p/0/t': TS });
      expect('X2: EXPAND — fremder Client darf einen uid-losen Seat wie unter v3 anfassen', 'allow',
        await foe.upd(code, { 'p/0/s': 'LEGCYTAB', 'p/0/on': false, 'p/0/t': TS }));
      state('X3: EXPAND — der Seat traegt weiterhin keine uid', (await owner.read(code + '/players/0/uid')) === null);
    } else {
      state('X2: CONTRACT — uid-loser Raum entsteht gar nicht erst', (await owner.read(code)) === null);
    }
  }
}

// ── Lauf ─────────────────────────────────────────────────────────────────────
(async () => {
  const state = { transformedHtml: null, prodHits: [], wsProdHits: [], otherBlocked: [], wsOtherBlocked: [], leaveWindows: [] };
  const failures = [];
  let checks = [];
  let staticServer = null, emu = null, browser = null, runDir = null, timer = null;

  const stages = [
    { stage: 'expand', file: H.ROOT_RULES },
    { stage: 'contract', file: CONTRACT_FILE },
  ];

  const runStage = async ({ stage, file }) => {
    runDir = H.createRunDir();
    H.prepareTempRules(runDir, file);
    staticServer = await H.startStaticServer();
    emu = H.startEmulator(runDir);
    await H.waitEmulators(90000);
    browser = await chromium.launch({ args: [...H.CHROMIUM_E2E_ARGS, '--mute-audio'] });
    const url = `http://${H.EMU_HOST}:${staticServer.port}/index.html?r2d=1`;
    const cl = [];
    for (const label of ['owner', 'foe', 'owner2']) cl.push(await newClient(browser, url, `${stage}:${label}`, state));
    try {
      await runCases(stage, cl, checks);
    } finally {
      for (const c of cl) { try { await c.context.close(); } catch (_) {} }
    }
    await H.cleanup({ browser, staticServer, emu, runDir, closeErrors: [], preexistingLogs: [] });
    browser = staticServer = emu = runDir = null;
  };

  try {
    if (!fs.existsSync(CONTRACT_FILE)) throw new Error('firebase.rules.contract.json fehlt — node tools/derive_contract_rules.js ausfuehren.');
    state.transformedHtml = H.transformHtml(fs.readFileSync(H.INDEX_HTML, 'utf8')).html;
    const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Zeitlimit erreicht')), RUN_TIMEOUT_MS); });
    await Promise.race([(async () => { for (const s of stages) { await runStage(s); } })(), deadline]);
  } catch (e) {
    failures.push('Laufabbruch: ' + ((e && e.message) || e));
  } finally {
    if (timer) clearTimeout(timer);
    if (browser || staticServer || emu || runDir) {
      await H.cleanup({ browser, staticServer, emu, runDir, closeErrors: [], preexistingLogs: [] });
    }
  }

  const bad = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} [${c.stage}] ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  if (state.prodHits.length) failures.push('Produktionskontakt (HTTP): ' + JSON.stringify(state.prodHits.slice(0, 3)));
  if (state.wsProdHits.length) failures.push('Produktionskontakt (WS): ' + JSON.stringify(state.wsProdHits.slice(0, 3)));
  for (const c of bad) failures.push(`[${c.stage}] ${c.name}: ${c.detail || 'fehlgeschlagen'}`);

  const passed = checks.length - bad.length;
  console.log(`\nOwnership-Regression (EXPAND + CONTRACT, echter Auth-Emulator): ${passed} passed, ${bad.length} failed`
    + ` — prodHits ${state.prodHits.length}, wsProdHits ${state.wsProdHits.length}`);
  if (failures.length) {
    console.error('\nFEHLGESCHLAGEN:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  if (!checks.length) { console.error('Keine Checks gelaufen — Abbruch.'); process.exit(1); }
})();
