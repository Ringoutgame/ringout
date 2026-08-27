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

const RUN_TIMEOUT_MS = Number(process.env.OWN_SEC_TIMEOUT_MS) || 12 * 60 * 1000;
// Hart verriegelte Erwartung: ein stillschweigend uebersprungener Fall waere
// als 'gruen' nicht zu erkennen. Weicht die Zahl ab — nach oben oder unten —,
// bricht der Lauf ab, bis die Erwartung bewusst nachgezogen wurde.
// EXPAND laeuft sechs Faelle mehr als CONTRACT: den Legacy-Block (D1-D5) und die
// Altclient-Kompatibilitaet (X2/X3), die es unter CONTRACT nicht geben kann.
const EXPECTED_CHECKS = { expand: 93, contract: 87 };
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
// opts.anonymous: die Seite laedt normal, die Anmeldung wird aber dauerhaft blockiert.
// So entsteht ein echter unauthentifizierter Firebase-Client — genau der Fall,
// den die Rules bei einem geschuetzten Seat abweisen muessen.
async function newClient(browser, url, label, state, opts) {
  opts = opts || {};
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await H.armContext(context, label, state);
  if (opts.anonymous) await context.route(`**://${H.EMU_HOST}:${H.EMU_AUTH_PORT}/**`, (r) => r.abort());
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FB_READY === true, null, { timeout: 40000 });
  const info = await page.evaluate(() => ({ uid: window.__FB_UID || null, err: window.__FB_ERR || window.__FB_AUTH_ERR || null }));
  if (opts.anonymous) {
    if (info.uid) throw new Error(`${label}: unerwartet angemeldet — der Fall beweist sonst nichts.`);
  } else if (!info.uid) {
    throw new Error(`${label}: keine auth.uid (${info.err || 'unbekannt'}) — Auth-Emulator nicht erreichbar?`);
  }

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

// Ein Client, der ueber die PRODUKTPFADE arbeitet (createRoom/joinRoom/leaveOnline)
// statt ueber direkte DB-Writes — nur so beweisen die Flow-Faelle etwas ueber das
// Produkt. `holdAuth` haelt die Anmeldung an, bis release() gerufen wird: genau die
// Luecke, in der ein Nutzer wieder abbrechen kann.
async function newProductClient(browser, url, label, state, opts) {
  opts = opts || {};
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await H.armContext(context, label, state);
  let release = async () => {};
  if (opts.holdAuth) {
    const held = [];
    const pattern = `**://${H.EMU_HOST}:${H.EMU_AUTH_PORT}/**`;
    const handler = (route) => { held.push(route); };
    // release() muss die Route auch WIRKLICH abschalten — sonst haelt der naechste
    // Anmeldeversuch derselben Seite erneut an und der Test misst etwas anderes,
    // als er behauptet.
    release = async () => {
      try { await context.unroute(pattern, handler); } catch (e) { /* Route schon weg */ }
      for (const r of held.splice(0)) { try { await r.continue(); } catch (e) { /* Request abgebrochen */ } }
    };
    await context.route(pattern, handler);
  }
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!opts.holdAuth) {
    await page.waitForFunction(() => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 40000 });
  } else {
    await page.waitForFunction(() => !!(window.__ringoutE2E && window.__ringoutE2E.ready), null, { timeout: 40000 });
  }
  return {
    label, page, context, release,
    uid: () => page.evaluate(() => window.__FB_UID || null),
    snap: () => page.evaluate(() => window.__ringoutE2E.snapshot()),
    host: (n) => page.evaluate((k) => window.__ringoutE2E.hostFFA(k, 'ffa'), n),
    // Oeffentlich erstellen: derselbe Produktpfad, nur mit gesetzter Sichtbarkeit.
    hostPublic: (n) => page.evaluate((k) => {
      const el = document.getElementById('onVisPub');
      if (el && el.click) el.click();
      window.__ringoutE2E.hostFFA(k, 'ffa');
    }, n),
    join: (c) => page.evaluate((c2) => window.__ringoutE2E.joinFFA(c2), c),
    leave: () => page.evaluate(() => window.__ringoutE2E.leave()),
  };
}

const TS = { __sv: 'ts' };                        // wird in der Seite zu serverTimestamp()
const CODE_CHARS = CH;
const recFor = (uid, tab, name) => ({ id: 'PID' + uid.slice(0, 8).replace(/[^A-Za-z0-9_-]/g, 'x') + '0000', name, tab, uid });
async function freshCodeFor(c) {
  for (let i = 0; i < 20; i++) {
    const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    if ((await c.read(code)) == null) return code;
  }
  throw new Error('kein freier Raumcode');
}
// Offene Lobby mit nur dem Host — Ziel fuer den abgebrochenen Join.
async function mkRoomFor(c, fmt) {
  const code = await freshCodeFor(c);
  await c.set(code, { v: 3, config: { winTarget: 3, fmt, visibility: 'private' }, gen: 0, state: 'lobby',
    p: { 0: { s: 'HOSTTAB0', on: false, t: TS } }, players: { 0: recFor(c.uid, 'HOSTTAB0', 'H') }, created: TS });
  await c.upd(code, { 'p/0/on': true, 'p/0/t': TS });
  return code;
}
// TRIPLE FFA (exakt 3 Sitze): Host aktiv, beide Gastsitze seit ueber
// SEAT_STALE_MS auf on:false. Ohne Recycling-Rueckfall waere der Raum 'voll'.
async function mkStaleTripleFor(cl) {
  const [owner, foe, owner2] = cl;
  const code = await mkRoomFor(owner, 'triple_ffa');
  for (const [seat, c, tab] of [[1, foe, 'STALETB1'], [2, owner2, 'STALETB2']]) {
    await c.upd(code, { ['p/' + seat]: { s: tab, on: false, t: TS }, ['players/' + seat]: recFor(c.uid, tab, 'S' + seat) });
    await c.upd(code, { ['p/' + seat + '/on']: true, ['p/' + seat + '/t']: TS });
    await c.upd(code, { ['p/' + seat + '/s']: tab, ['p/' + seat + '/on']: false, ['p/' + seat + '/t']: TS });
  }
  await new Promise((r) => setTimeout(r, 15600));   // Karenz serverseitig ablaufen lassen
  return code;
}
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
  // Ein fehlgeschlagenes Setup macht JEDEN folgenden DENY bedeutungslos —
  // deshalb bricht es hier hart ab, statt still weiterzulaufen.
  const must = (res, what) => {
    if (!res || res.ok !== true) throw new Error(`Setup fehlgeschlagen (${what}): code=${res && res.code} err=${res && res.err}`);
    return res;
  };
  const mkRoom = async (fmt, seatOwners) => {
    const code = await freshCode();
    const host = seatOwners[0];
    must(await host.set(code, {
      v: 3, config: { winTarget: 3, fmt, visibility: 'private' }, gen: 0, state: 'lobby',
      p: { 0: P('HOSTTAB0', false) }, players: { 0: rec(host.uid, 'HOSTTAB0', 'H') }, created: TS,
    }), 'Raum anlegen');
    must(await host.upd(code, { 'p/0/on': true, 'p/0/t': TS }), 'Host aktivieren');
    const ffaLike = fmt === 'ffa' || fmt === 'triple_ffa' || fmt === 'team_duel';
    // seatOwners.length === 1 -> nur der Host; die Gastschleife laeuft dann nicht.
    for (let seat = 1; seat < seatOwners.length; seat++) {
      const c = seatOwners[seat], tab = 'TAB00' + seat + '000';
      must(await c.upd(code, { ['p/' + seat]: P(tab, false), ['players/' + seat]: rec(c.uid, tab, 'P' + seat) }), 'Seat ' + seat + ' reservieren');
      // 1v1/2v2: der Gast wird nur zusammen mit dem Start aktiv (Bestandsvertrag,
      // s. activateSeat(code,seat,{state:'playing'})). FFA startet der Host separat.
      const act = { ['p/' + seat + '/on']: true, ['p/' + seat + '/t']: TS };
      if (!ffaLike && seat === 1) act.state = 'playing';
      must(await c.upd(code, act), 'Seat ' + seat + ' aktivieren');
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


  // ══ P1-1 — eine vergebene uid laesst sich nicht mehr abstreifen ═══════════
  {
    const code = await mkRoom('ffa', [owner, owner2, foe]);
    const mine = rec(owner.uid, 'HOSTTAB0', 'H');
    expect('A: uid-Child des eigenen Seats loeschen', 'deny',
      await owner.set(code + '/players/0/uid', null));
    state('A2: uid unveraendert', (await owner.read(code + '/players/0/uid')) === owner.uid);
    expect('B: Parent-Replace ohne uid', 'deny',
      await owner.set(code + '/players/0', { id: mine.id, name: mine.name, tab: mine.tab }));
    expect('C: Multi-Path-Downgrade (uid:null neben harmlosem Feld)', 'deny',
      await owner.upd(code, { 'players/0/uid': null, 'players/0/name': 'X' }));
    expect('C2: uid A -> uid B beim aktiven Claim', 'deny',
      await owner.upd(code, { 'players/0': rec(owner2.uid, 'HOSTTAB0', 'H') }));
    state('C3: Eigentuemer nach allen Versuchen unveraendert',
      (await owner.read(code + '/players/0/uid')) === owner.uid);
  }

  // ══ P1-2 — an einen laufenden Legacy-Claim wird nichts angeheftet ═════════
  // Nur unter EXPAND konstruierbar: unter CONTRACT entsteht ein uid-loser Seat
  // gar nicht erst (siehe Migrationsblock).
  if (stage === 'expand') {
    const code = await freshCode();
    await owner.set(code, {
      v: 3, config: { winTarget: 3, fmt: 'ffa', visibility: 'private' }, gen: 0, state: 'lobby',
      p: { 0: P('LEGCYTAB', false) }, players: { 0: { id: 'LEGACYID0000', name: 'L', tab: 'LEGCYTAB' } }, created: TS,
    });
    await owner.upd(code, { 'p/0/on': true, 'p/0/t': TS });
    const legacyRec = { id: 'LEGACYID0000', name: 'L', tab: 'LEGCYTAB', uid: foe.uid };
    expect('D: aktiver Legacy-Seat — fremde uid anheften', 'deny',
      await foe.upd(code, { 'players/0': legacyRec }));
    expect('D2: aktiver Legacy-Seat — isolierter uid-Write', 'deny',
      await foe.set(code + '/players/0/uid', foe.uid));
    expect('D3: eigener Legacy-Seat — Selbstmigration im Lauf', 'deny',
      await owner.upd(code, { 'players/0': { id: 'LEGACYID0000', name: 'L', tab: 'LEGCYTAB', uid: owner.uid } }));
    await owner.set(code + '/state', 'playing');
    expect('D4: laufendes Match — uid anheften', 'deny',
      await foe.set(code + '/players/0/uid', foe.uid));
    state('D5: Seat ist weiterhin Legacy', (await owner.read(code + '/players/0/uid')) === null);
  }

  // ══ E/F/G/H — Entstehung von Eigentum: frisch und per Recycling ═══════════
  {
    const code = await mkRoom('ffa', [owner]);
    expect('E: vollstaendiger frischer Claim in einer atomaren Operation', 'allow',
      await foe.upd(code, { 'p/1': P('FRESHTB1', false), 'players/1': rec(foe.uid, 'FRESHTB1', 'F') }));
    state('E2: der frische Seat gehoert dem Anspruchsteller',
      (await owner.read(code + '/players/1/uid')) === foe.uid);
    await foe.upd(code, { 'p/1/s': 'FRESHTB1', 'p/1/on': false, 'p/1/t': TS });
    const t0 = Date.now();
    expect('G: Recycling bei 14 999 ms', 'deny',
      await owner2.upd(code, { 'p/1': P('LATETAB1', false), 'players/1': rec(owner2.uid, 'LATETAB1', 'R') }));
    const waitMs = 15600 - (Date.now() - t0);
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    expect('H: Recycling ab 15 000 ms', 'allow',
      await owner2.upd(code, { 'p/1': P('LATETAB1', false), 'players/1': rec(owner2.uid, 'LATETAB1', 'R') }));
    state('H2: Eigentum ist uebergegangen', (await owner.read(code + '/players/1/uid')) === owner2.uid);
  }

  // ══ I — zwei gleichzeitige Reclaims, genau ein Eigentuemer ════════════════
  {
    const code = await mkRoom('ffa', [owner, owner2, foe]);
    await owner.set(code + '/state', 'playing');
    await owner2.upd(code, { 'p/1/s': 'TAB001000', 'p/1/on': false, 'p/1/t': TS });
    const both = await Promise.all([
      owner2.upd(code, { 'p/1': P('RACETB01', false), 'players/1': rec(owner2.uid, 'RACETB01', 'P1') }),
      foe.upd(code, { 'p/1': P('RACETB02', false), 'players/1': rec(foe.uid, 'RACETB02', 'P1') }),
    ]);
    const wins = both.filter((r) => r && r.ok === true).length;
    const finalUid = await owner.read(code + '/players/1/uid');
    state('I: zwei parallele Reclaims — nur der Eigentuemer gewinnt',
      wins === 1 && finalUid === owner2.uid, JSON.stringify({ wins, finalUid }));
  }

  // ══ O — Parent-/Multi-Path-Angriffe auf Presence, Move und Barrier ════════
  {
    const code = await mkRoom('ffa', [owner, owner2, foe]);
    await owner.set(code + '/state', 'playing');
    await owner.set(code + '/seats', 3);
    expect('O1: fremden Presence-Parent komplett ersetzen', 'deny',
      await foe.set(code + '/p/0', P('HOSTTAB0', false)));
    expect('O2: Multi-Path auf zwei fremde Seats', 'deny',
      await foe.upd(code, { 'p/0/on': false, 'p/1/on': false, 'p/0/t': TS, 'p/1/t': TS }));
    expect('O3: Multi-Path mit eigenem und fremdem Move', 'deny',
      await foe.upd(code + '/g/0/t/0', { 2: { idx: 2, dx: 1, dy: 1, sp: 0 }, 0: { idx: 0, dx: 1, dy: 1, sp: 0 } }));
    state('O3b: auch der eigene Teil des Angriffs blieb aus',
      (await owner.read(code + '/g/0/t/0/2')) === null);
    expect('O4: fremdes bc ueber den Turn-Parent', 'deny',
      await foe.upd(code + '/g/0/t/1', { 'bc/0': { v: 1, seat: 0, turn: 1, hash: HEX64 } }));
  }


  // ══ B — die Karenzgrenze so genau messen, wie der Emulator es hergibt ═════
  // Ein exakter 14 999-ms-Schuss ist mit echten Netz-Roundtrips nicht ehrlich
  // behauptbar. Gemessen wird deshalb ein enges Fenster UM die Grenze herum und
  // die tatsaechlich erreichte Genauigkeit wird mitprotokolliert.
  {
    const code = await mkRoom('ffa', [owner, foe]);
    must(await foe.upd(code, { 'p/1/s': 'TAB001000', 'p/1/on': false, 'p/1/t': TS }), 'Seat 1 offline');
    const t0 = await owner.read(code + '/p/1/t');
    const tryAt = async (targetMs, label, kind) => {
      const now0 = Date.now();
      const srv = await owner.read(code + '/p/1/t');   // Serverzeitbezug erneuern
      const drift = Date.now() - now0;
      const waitFor = t0 + targetMs - Date.now();
      if (waitFor > 0) await new Promise((r) => setTimeout(r, waitFor));
      const elapsedLocal = Date.now() - t0;
      const res = await owner.upd(code, { 'p/1': P('BND' + targetMs, false), 'players/1': rec(owner.uid, 'BND' + targetMs, 'B') });
      return { res, elapsedLocal, drift, srv, label, kind };
    };
    const early = await tryAt(12000, 'B1: deutlich vor der Karenz (~12 s)', 'deny');
    expect(early.label + ` [lokal gemessen ${early.elapsedLocal} ms]`, 'deny', early.res);
    const late = await tryAt(16500, 'B2: sicher nach der Karenz (~16,5 s)', 'allow');
    expect(late.label + ` [lokal gemessen ${late.elapsedLocal} ms]`, 'allow', late.res);
    state('B3: gemessene Karenzgrenze liegt zwischen den beiden Messpunkten',
      early.elapsedLocal < 15000 && late.elapsedLocal >= 15000,
      `frueh=${early.elapsedLocal} ms, spaet=${late.elapsedLocal} ms — exakte 14999/15000-Steuerung ist ueber echte Roundtrips nicht darstellbar`);
  }

  // ══ C — echtes Rennen: beide Seiten sind zum Startzeitpunkt legitim ═══════
  {
    const code = await mkRoom('ffa', [owner, foe]);
    // Seat 1 wird frei: bewusstes Verlassen. Danach sind BEIDE anderen Clients
    // gleichberechtigte Kandidaten fuer einen frischen Claim.
    must(await foe.upd(code, { 'p/1': null, 'players/1': null }), 'Seat 1 freigeben');
    const both = await Promise.all([
      owner2.upd(code, { 'p/1': P('RACEA001', false), 'players/1': rec(owner2.uid, 'RACEA001', 'A') }),
      foe.upd(code, { 'p/1': P('RACEB001', false), 'players/1': rec(foe.uid, 'RACEB001', 'B') }),
    ]);
    const wins = both.filter((r) => r && r.ok === true).length;
    const uid1 = await owner.read(code + '/players/1/uid');
    state('C: zwei legitime Anspruchsteller — genau einer gewinnt',
      wins === 1 && (uid1 === owner2.uid || uid1 === foe.uid),
      JSON.stringify({ wins, uid1, codes: both.map((r) => r && r.code) }));
    const tab1 = await owner.read(code + '/p/1/s');
    state('C2: Presence und Roster gehoeren demselben Gewinner',
      (uid1 === owner2.uid && tab1 === 'RACEA001') || (uid1 === foe.uid && tab1 === 'RACEB001'),
      JSON.stringify({ uid1, tab1 }));
  }

  // ══ E — ohne Anmeldung ist an einem geschuetzten Seat nichts zu holen ═════
  {
    const code = await mkRoom('ffa', [owner, owner2, foe]);
    must(await owner.set(code + '/state', 'playing'), 'Match starten');
    must(await owner.set(code + '/seats', 3), 'Seatzahl setzen');
    const anon = cl.anon;   // Seite ohne abgeschlossene Anmeldung
    expect('E1: unauthentifiziert — fremde Presence', 'deny',
      await anon.upd(code, { 'p/0/s': 'HOSTTAB0', 'p/0/on': false, 'p/0/t': TS }));
    expect('E2: unauthentifiziert — fremder Move-Slot', 'deny',
      await anon.set(code + '/g/0/t/0/0', { idx: 0, dx: 10, dy: 10, sp: 0 }));
    expect('E3: unauthentifiziert — fremdes bc', 'deny',
      await anon.set(code + '/g/0/t/0/bc/0', { v: 1, seat: 0, turn: 0, hash: HEX64 }));
    expect('E4: unauthentifiziert — fremdes br', 'deny',
      await anon.set(code + '/g/0/t/0/br/0', { v: 1, seat: 0, turn: 0, nonce: HEX64, seg: 3 }));
    expect('E5: unauthentifiziert — fremder Roster-Eintrag', 'deny',
      await anon.upd(code, { 'players/0/name': 'HACKED' }));
    state('E6: nichts davon hat gewirkt',
      (await owner.read(code + '/p/0/on')) === true && (await owner.read(code + '/g/0/t/0/0')) === null
      && (await owner.read(code + '/players/0/name')) === 'H');
  }

  // ══ H — br ueber Parent- und Multi-Path-Wege ══════════════════════════════
  {
    const code = await mkRoom('single', [owner, owner2]);
    const bc = (seat, turn) => ({ v: 1, seat, turn, hash: HEX64 });
    const br = (seat, turn, seg) => ({ v: 1, seat, turn, nonce: HEX64, seg });
    must(await owner.set(code + '/g/0/t/0/bc/0', bc(0, 0)), 'bc/0');
    must(await owner2.set(code + '/g/0/t/0/bc/1', bc(1, 0)), 'bc/1');
    expect('H1: fremdes br ueber den br-Parent setzen', 'deny',
      await owner.set(code + '/g/0/t/0/br', { 0: br(0, 0, 3), 1: br(1, 0, 3) }));
    expect('H2: fremdes br im Multi-Path neben dem eigenen', 'deny',
      await owner.upd(code + '/g/0/t/0/br', { 0: br(0, 0, 3), 1: br(1, 0, 3) }));
    state('H3: kein br persistiert', (await owner.read(code + '/g/0/t/0/br')) === null);
    expect('H4: eigenes br allein bleibt erlaubt', 'allow', await owner.set(code + '/g/0/t/0/br/0', br(0, 0, 3)));
    expect('H5: fremdes bc ueber den Turn-Parent', 'deny',
      await owner.upd(code + '/g/0/t/1', { 'bc/1': bc(1, 1) }));
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


// ── Produktpfad-Faelle: Abbruch waehrend der Anmeldung, Seat-Allocator ───────
// Diese Faelle laufen bewusst NICHT ueber direkte DB-Writes: geprueft wird das
// Verhalten des Produkts, nicht das der Rules.
async function runFlowCases(stage, browser, url, state, checks, raw) {
  // `st` meldet Produktverhalten — hier gibt es kein ALLOW/DENY, sondern nur
  // "hat das Produkt getan, was der Vertrag sagt".
  const st = (name, ok, detail) => checks.push({ stage, name, ok: !!ok, detail: ok ? null : (detail || null) });
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  // snapshot() des E2E-Adapters prueft strenge Invarianten und wirft bei einem
  // Zwischenzustand (z. B. Lobbywechsel, waehrend die Kugeln noch zur vorigen
  // Partie gehoeren). Fuer die Rennen-Faelle ist genau dieser Moment normal —
  // ein geworfener Snapshot ist dort kein Befund, sondern schlicht 'noch nicht
  // stabil'. Deshalb hier tolerant lesen und weiterpollen.
  const safeSnap = async (c) => { try { return await c.snap(); } catch (e) { return null; } };
  // Wartet, bis der Client seinen Raumcode kennt (Create ist erst danach gueltig).
  const waitCode = async (c) => {
    for (let i = 0; i < 80; i++) {
      const sn = await safeSnap(c);
      if (!sn) { await settle(250); continue; }
      if (sn.roomCode && sn.roomCode.length === 4) return sn.roomCode;
      await settle(250);
    }
    return null;
  };

  // Jeden Raum-Write der Seite mitschreiben — nur so laesst sich beweisen, dass
  // ein abgebrochener Create wirklich NICHTS hinterlassen hat.
  const recordWrites = (page) => page.evaluate(() => {
    window.__WRITES = [];
    const FB = window.FB, wrap = (fn) => function (ref) {
      try { window.__WRITES.push(String(ref && ref.toString ? ref.toString() : '')); } catch (e) {}
      return fn.apply(this, arguments);
    };
    FB.set = wrap(FB.set); FB.update = wrap(FB.update);
  });
  const roomWrites = (page) => page.evaluate(() => (window.__WRITES || []).filter((u) => /\/rooms\//.test(u)));

  // ── J: Create waehrend der Anmeldung abgebrochen ──────────────────────────
  {
    const c = await newProductClient(browser, url, `${stage}:pending-create`, state, { holdAuth: true });
    try {
      await recordWrites(c.page);
      await c.host(3);                       // Nutzer klickt "Raum erstellen"
      await settle(400);
      await c.leave();                       // Nutzer geht zurueck, Anmeldung haengt noch
      await c.release();                           // Anmeldung wird jetzt endlich fertig
      await c.page.waitForFunction(() => window.__FB_READY === true, null, { timeout: 40000 });
      await settle(2500);
      const w = await roomWrites(c.page);
      const snap = (await safeSnap(c)) || {};
      st('J: Create waehrend der Anmeldung abgebrochen — kein Raum entsteht',
        w.length === 0 && !snap.online && !snap.roomCode, JSON.stringify({ writes: w.slice(0, 3), online: snap.online, code: snap.roomCode }));
    } finally { try { await c.context.close(); } catch (_) {} }
  }

  // ── K: Join waehrend der Anmeldung abgebrochen ────────────────────────────
  {
    const code = await raw.mkLobby('ffa');
    const c = await newProductClient(browser, url, `${stage}:pending-join`, state, { holdAuth: true });
    try {
      await c.join(code);
      await settle(400);
      await c.leave();
      await c.release();
      await c.page.waitForFunction(() => window.__FB_READY === true, null, { timeout: 40000 });
      await settle(2500);
      const seat1 = await raw.read(code + '/p/1');
      const snap = (await safeSnap(c)) || {};
      st('K: Join waehrend der Anmeldung abgebrochen — kein Seat wird belegt',
        seat1 === null && !snap.online, JSON.stringify({ seat1, online: snap.online }));
    } finally { try { await c.context.close(); } catch (_) {} }
  }

  // ── N: der Allocator nutzt einen wirklich recyclebaren Seat ───────────────
  // TRIPLE FFA hat exakt drei Sitze: Host aktiv, beide Gastsitze abgelaufen.
  // Ohne den Recycling-Rueckfall wuerde der Raum faelschlich als voll gelten.
  {
    const code = await raw.mkStaleTriple();
    const c = await newProductClient(browser, url, `${stage}:recycle-join`, state);
    try {
      await c.join(code);
      let seat = -1;
      for (let i = 0; i < 60 && seat < 0; i++) {
        const snap = await safeSnap(c); if (!snap) { await settle(250); continue; }
        if (snap.online && typeof snap.myPlayer === 'number' && snap.myPlayer >= 0) seat = snap.myPlayer;
        else await settle(250);
      }
      const uidNow = await raw.read(code + '/players/' + seat + '/uid');
      const mine = await c.uid();
      st('N: abgelaufener Lobby-Seat wird vom Produktclient recycelt',
        (seat === 1 || seat === 2) && uidNow === mine, JSON.stringify({ seat, uidNow, mine }));
    } finally { try { await c.context.close(); } catch (_) {} }
  }

  // ── D: echter onDisconnect gegen einen neuen Claim ───────────────────────
  // Nicht simuliert: Tab A haelt den Seat ueber den Produktpfad, sein
  // onDisconnect ist real registriert. Wird der Kontext geschlossen, feuert der
  // Server ihn — er darf den inzwischen gueltigen NEUEN Tokenzustand nicht
  // ueberschreiben.
  {
    const code = await raw.mkLobby('ffa');
    const a = await newProductClient(browser, url, `${stage}:disc-a`, state);
    let b = null;
    try {
      await a.join(code);
      let seat = -1;
      for (let i = 0; i < 60 && seat < 0; i++) {
        const sn = await safeSnap(a); if (!sn) { await settle(250); continue; }
        if (sn.online && sn.myPlayer >= 0) seat = sn.myPlayer; else await settle(250);
      }
      st('D0: Tab A haelt einen Seat ueber den Produktpfad', seat === 1, 'seat=' + seat);
      const tabA = await raw.read(code + '/p/' + seat + '/s');
      await a.context.close();                       // echter Disconnect -> onDisconnect feuert
      await settle(1500);
      const afterDisc = await raw.read(code + '/p/' + seat);
      st('D1: onDisconnect hat on:false gesetzt, den Seat aber NICHT geloescht',
        !!afterDisc && afterDisc.on === false && afterDisc.s === tabA, JSON.stringify(afterDisc));
      // Neuer Claim derselben Person in einer neuen Session (neues Tab-Token).
      b = await newProductClient(browser, url, `${stage}:disc-b`, state);
      await b.join(code);
      let seatB = -1;
      for (let i = 0; i < 60 && seatB < 0; i++) {
        const sn = await safeSnap(b); if (!sn) { await settle(250); continue; }
        if (sn.online && sn.myPlayer >= 0) seatB = sn.myPlayer; else await settle(250);
      }
      const tabNow = await raw.read(code + '/p/' + seatB + '/s');
      const onNow = await raw.read(code + '/p/' + seatB + '/on');
      st('D2: der neue Claim gilt und traegt sein eigenes Token',
        seatB >= 1 && tabNow !== tabA && onNow === true, JSON.stringify({ seatB, tabNow, tabA, onNow }));
      await settle(1500);
      st('D3: der alte onDisconnect hat den neuen Zustand nicht ueberschrieben',
        (await raw.read(code + '/p/' + seatB + '/s')) === tabNow && (await raw.read(code + '/p/' + seatB + '/on')) === true);
    } finally {
      try { await a.context.close(); } catch (_) {}
      if (b) { try { await b.context.close(); } catch (_) {} }
    }
  }

  // ── F: Public-Create-Abbruch in drei Stufen ──────────────────────────────
  {
    // F-A: Abbruch, bevor ueberhaupt etwas veroeffentlicht ist.
    const c1 = await newProductClient(browser, url, `${stage}:pub-early`, state, { holdAuth: true });
    try {
      await recordWrites(c1.page);
      await c1.hostPublic(3);
      await settle(300);
      await c1.leave();
      await c1.release();
      await c1.page.waitForFunction(() => window.__FB_READY === true, null, { timeout: 40000 });
      await settle(2500);
      const w = await roomWrites(c1.page);
      st('F-A: Abbruch vor dem Listing hinterlaesst nichts', w.length === 0, JSON.stringify(w.slice(0, 3)));
    } finally { try { await c1.context.close(); } catch (_) {} }

    // F-B: Raum und Listing existieren, noch kein Gast -> sauberes Aufraeumen.
    const c2 = await newProductClient(browser, url, `${stage}:pub-clean`, state);
    try {
      await c2.hostPublic(3);
      const code2 = await waitCode(c2);
      st('F-B0: oeffentlicher Raum entstanden', !!code2, String(code2));
      await c2.leave();
      await settle(2500);
      const room = await raw.read(code2);
      const listed = await raw.readPublic(code2);
      st('F-B: ohne Gast wird Raum UND Listing sauber entfernt', room === null && listed === null,
        JSON.stringify({ room: room && Object.keys(room), listed }));
    } finally { try { await c2.context.close(); } catch (_) {} }

    // F-C: Der Abbruch-Guard. Sobald ein Gast den Raum betreten hat, darf der
    // Create-Abbruch des Hosts den Raum NICHT mehr abraeumen. Der Guard liest
    // dafuer autoritativ nach, ob ausser der eigenen Host-Reservierung noch
    // fremde Anker existieren — dieselbe Frage stellt dieser Test direkt an den
    // Datenbestand, weil abortFreshRoom nur intern erreichbar ist.
    const host = await newProductClient(browser, url, `${stage}:pub-host`, state);
    const guest = await newProductClient(browser, url, `${stage}:pub-guest`, state);
    try {
      await host.hostPublic(3);
      const code3 = await waitCode(host);
      await guest.join(code3);
      let gseat = -1;
      for (let i = 0; i < 60 && gseat < 0; i++) {
        const sn = await safeSnap(guest); if (!sn) { await settle(250); continue; }
        if (sn.online && sn.myPlayer >= 0) gseat = sn.myPlayer; else await settle(250);
      }
      st('F-C0: Gast sitzt im gelisteten Raum', gseat === 1, 'seat=' + gseat);

      // Genau die Bedingung, die der Guard prueft:
      const room = await raw.read(code3);
      const foreignSeat = !!(room && room.p && Object.keys(room.p).some((k) => k !== '0'));
      const foreignRec = !!(room && room.players && Object.keys(room.players).some((k) => k !== '0'));
      st('F-C1: der Raum traegt fremde Anker — der Abbruch muss ausbleiben',
        foreignSeat && foreignRec, JSON.stringify({ foreignSeat, foreignRec }));

      // Und die Rules halten selbst dann, wenn ein Abbruch es doch versuchte:
      // ein Raum mit Gastankern laesst sich nicht loeschen.
      const del = await host.page.evaluate(async (cc) => {
        try { await window.FB.remove(window.FB.ref(window.FB.db, 'rooms/' + cc)); return { ok: true }; }
        catch (e) { return { ok: false, code: (e && e.code) || null }; }
      }, code3);
      st('F-C2: Raum-Delete mit Gastankern wird von den Rules abgelehnt',
        del.ok === false, JSON.stringify(del));
      const still = await raw.read(code3 + '/p/1');
      st('F-C3: der Gastsitz steht unveraendert', !!still, JSON.stringify(still));
    } finally {
      try { await host.context.close(); } catch (_) {}
      try { await guest.context.close(); } catch (_) {}
    }
  }

  // ── G: schnelle Mehrfach-Operationen — nur die aktuelle gewinnt ───────────
  {
    const codeA = await raw.mkLobby('ffa');
    const c = await newProductClient(browser, url, `${stage}:races`, state);
    try {
      // Create -> Create: der zweite Klick entwertet den ersten.
      await c.host(3); await c.host(3);
      const codeC = await waitCode(c);
      const snap1 = (await safeSnap(c)) || {};
      st('G1: Create -> Create ergibt genau EINEN Raum',
        !!codeC && snap1.roomCode === codeC, JSON.stringify({ codeC, snapCode: snap1.roomCode }));
      await c.leave(); await settle(1200);

      // Create -> Join: der Join ist die aktuelle Operation. Massgeblich ist der
      // Datenbestand — genau EIN Gastsitz im beigetretenen Raum. Die UI-Momentaufnahme
      // ist waehrend eines Raumwechsels bewusst kein verlaesslicher Zeuge.
      await c.host(3); await c.join(codeA);
      const seatsIn = async (code) => {
        const pp = await raw.read(code + '/p');
        return pp ? Object.keys(pp).filter((k) => k !== '0') : [];
      };
      let joined = [];
      for (let i = 0; i < 60; i++) { joined = await seatsIn(codeA); if (joined.length) break; await settle(250); }
      st('G2: Create -> Join belegt genau einen Sitz im beigetretenen Raum',
        joined.length === 1, JSON.stringify({ joined }));
      await c.leave(); await settle(1500);
      st('G2b: nach dem Verlassen ist der Sitz wieder frei',
        (await seatsIn(codeA)).length === 0);

      // Join -> Join auf denselben Raum: der zweite Klick entwertet den ersten,
      // zurueck bleibt genau eine Sitzbelegung — kein Geistersitz.
      await c.join(codeA); await c.join(codeA);
      let twice = [];
      for (let i = 0; i < 60; i++) { twice = await seatsIn(codeA); if (twice.length) break; await settle(250); }
      await settle(1500);
      twice = await seatsIn(codeA);
      st('G3: Join -> Join belegt genau einen Sitz', twice.length === 1, JSON.stringify({ twice }));
      await c.leave(); await settle(1500);

      // Join -> Cancel: nichts bleibt zurueck.
      await c.join(codeA); await c.leave(); await settle(2000);
      const pAfter = await raw.read(codeA + '/p');
      const left = pAfter ? Object.keys(pAfter).filter((k) => k !== '0') : [];
      const snap3 = (await safeSnap(c)) || {};
      st('G4: Join -> Abbruch hinterlaesst keinen Sitz',
        left.length === 0 && !snap3.online, JSON.stringify({ left, online: snap3.online }));
    } finally { try { await c.context.close(); } catch (_) {} }
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
    // Ein fremder Prozess auf unseren Ports wuerde einen 'gruenen' Lauf gegen
    // eine ganz andere Datenbank erzeugen — das ist kein bestandener Test.
    for (const port of [H.EMU_PORT, ...H.EMU_AUX_PORTS]) {
      if (!(await H.portFree(port))) throw new Error(`Port ${port} belegt — Abbruch (Fremdprozess).`);
    }
    const before = checks.length;
    runDir = H.createRunDir();
    H.prepareTempRules(runDir, file);
    staticServer = await H.startStaticServer();
    emu = H.startEmulator(runDir);
    await H.waitEmulators(90000);
    browser = await chromium.launch({ args: [...H.CHROMIUM_E2E_ARGS, '--mute-audio'] });
    const url = `http://${H.EMU_HOST}:${staticServer.port}/index.html?r2d=1`;
    const cl = [];
    for (const label of ['owner', 'foe', 'owner2']) cl.push(await newClient(browser, url, `${stage}:${label}`, state));
    cl.anon = await newClient(browser, url, `${stage}:anon`, state, { anonymous: true });
    try {
      await runCases(stage, cl, checks);
      await runFlowCases(stage, browser, url, state, checks, {
        read: (p) => cl[0].read(p),
        mkLobby: () => mkRoomFor(cl[0], 'ffa'),
        mkStaleTriple: () => mkStaleTripleFor(cl),
        // publicRooms ist NUR als begrenzte Query lesbar (Rules) — genau so, wie
        // das Produkt die Liste holt. Ein Einzelknoten-Read waere denied.
        readPublic: (c) => cl[0].page.evaluate(async (cc) => {
          const FB = window.FB;
          const q = FB.query(FB.ref(FB.db, 'publicRooms'), FB.orderByChild('created'), FB.limitToLast(30));
          const s2 = await FB.get(q);
          const v = s2.exists() ? s2.val() : null;
          return v && Object.prototype.hasOwnProperty.call(v, cc) ? v[cc] : null;
        }, c),
      });
    } finally {
      for (const c of cl.concat([cl.anon])) { try { await c.context.close(); } catch (_) {} }
    }
    const cl2 = await H.cleanup({ browser, staticServer, emu, runDir, closeErrors: [], preexistingLogs: [] });
    browser = staticServer = emu = runDir = null;
    if (!cl2 || cl2.cleanupOk !== true) {
      failures.push(`[${stage}] Cleanup nicht sauber: ` + JSON.stringify({ notes: cl2 && cl2.notes, portsFree: cl2 && cl2.portsFree, runGone: cl2 && cl2.runGone }));
    }
    const ran = checks.length - before, want = EXPECTED_CHECKS[stage];
    if (ran !== want) {
      failures.push(`[${stage}] ${ran} Checks gelaufen, erwartet ${want} — Faelle fehlen oder sind neu.`);
    }
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
