// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Regressionstest: Game-Over-Overlay-Race
//
//   node tools/e2e/run-overlay-race.js        (npm run test:e2e:overlay)
//
// gameOver() blendet #ov bewusst erst GAMEOVER_OVERLAY_DELAY_MS spaeter ein.
// Startet in diesem Fenster bereits ein Rematch (neue Generation), ein Leave oder
// ein neues Match, dann darf der alte Auftrag NICHT mehr einblenden. Vor dem Fix
// lief er weiter: #ov (position:fixed; inset:0; z-index:100) lag danach unsichtbar
// ueber der Arena, schluckte jede Canvas-Eingabe, und ein Tippen in Kugelnaehe traf
// #ovMenuBtn — der Spieler verliess unabsichtlich den Raum.
//
// Gemessen wird nicht der Timer, sondern das SICHTBARE Ergebnis: ein
// MutationObserver auf #ov zaehlt jede Einblendung, und es wird geprueft, wer den
// Punkt unter der eigenen Kugel wirklich besitzt (document.elementFromPoint).
//
// Aufbau wie run-3d-two-client.js: JDK-21-RTDB-Emulator, lokaler Static-Server,
// harte Produktions-Firebase-Sperre, zwei Kontexte im echten 3D-Pfad. index.html
// auf Platte wird nie veraendert.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const H = require('./lib/harness');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = process.env.OVR_OUT || path.join(REPO_ROOT, 'artifacts', 'overlay_race');
const VIEWPORT = { width: 1000, height: 820 };
// Grosszuegig ueber der 500-ms-Verzoegerung: was danach nicht sichtbar ist, kommt nicht mehr.
const SETTLE_MS = 2000;
const WIN_TARGET = 3;
const MAXPULL = 485 * 0.40;   // Produktionswert (R0 * MAXPULL_FRAC), s. index.html

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (page) => page.evaluate(() => window.__ringoutE2E.snapshot());

const results = [];
const ok = (n, e) => { results.push({ n, ok: true, e }); console.log('  ✓ ' + n + (e ? ' — ' + e : '')); };
const bad = (n, e) => { results.push({ n, ok: false, e }); console.log('  ✗ ' + n + (e ? ' — ' + e : '')); };
const check = (c, n, e) => (c ? ok(n, e) : bad(n, e));

// ── In-Page-Beobachter: zaehlt JEDE Einblendung von #ov ──────────────────────
const OBSERVER = () => {
  const el = document.getElementById('ov');
  window.__ovShows = 0;
  window.__ovLog = [];
  let last = el.classList.contains('show');
  new MutationObserver(() => {
    const now = el.classList.contains('show');
    if (now !== last) { if (now) window.__ovShows++; window.__ovLog.push({ t: Date.now(), show: now }); last = now; }
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
};
const resetShows = (page) => page.evaluate(() => { window.__ovShows = 0; window.__ovLog = []; });
const shows = (page) => page.evaluate(() => window.__ovShows);
const ovVisible = (page) => page.evaluate(() => !!document.querySelector('#ov.show'));
// Wem gehoert der Punkt, den der Spieler zum Zielen antippen wuerde?
const ownerAtOwnBall = (page) => page.evaluate(() => {
  const g = window.__ringoutE2E.aimPoints(0.2, 0);
  const cv = document.getElementById('cv');
  if (!g) return { err: 'kein Ziel' };
  const p = g.blocked ? g.centre : g.down;
  const el = document.elementFromPoint(p.x, p.y);
  return { id: el ? (el.id || el.tagName) : null, isCanvas: el === cv, blocked: !!g.blocked };
});

async function newClient(ctx, id) {
  const context = await ctx.browser.newContext({ serviceWorkers: 'block', viewport: VIEWPORT });
  await H.armContext(context, 'c' + id, ctx.state);
  const page = await context.newPage();
  const diag = { pageErrors: [] };
  page.on('pageerror', (e) => diag.pageErrors.push(String((e && e.message) || e)));
  H.wireDiagnostics(page, 'c' + id, ctx.diag);
  await page.goto(ctx.navUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.body.classList.contains('r3d'), null, { timeout: 30000 });
  await page.evaluate(OBSERVER);
  return { id, context, page, diag, closed: false };
}

async function setupRoom(cs) {
  await cs[0].page.evaluate((w) => window.__ringoutE2E.hostFFA(w, 'ffa'), WIN_TARGET);
  const code = await H.poll(async () => { const s = await snap(cs[0].page); return s.roomCode && s.roomCode.length === 4 ? s.roomCode : null; }, 25000, 'Raum');
  await cs[1].page.evaluate((c) => window.__ringoutE2E.joinFFA(c), code);
  await H.poll(async () => { const s = await snap(cs[1].page); return s.online && s.myPlayer === 1 ? true : null; }, 25000, 'Beitritt');
  await H.poll(async () => {
    const p = await H.dbRead(cs[0].page, `rooms/${code}/p`);
    return p && p[0] && p[0].on === true && p[1] && p[1].on === true ? true : null;
  }, 25000, 'Seats aktiv');
  await H.poll(async () => {
    await cs[0].page.evaluate(() => window.__ringoutE2E.start());
    return (await H.dbRead(cs[0].page, `rooms/${code}/state`)) === 'playing' ? true : null;
  }, 25000, 'Start');
  return code;
}

const waitAim = (cs, ms, label) => H.poll(async () => {
  const out = [];
  for (const c of cs) { const s = await snap(c.page); if (!(s.gameStarted && s.phase === 'aim')) return null; out.push(s); }
  return out;
}, ms, label);

// Ein Zug: Seat 1 schiesst die EIGENE Kugel ueber die Kante (voller Zug nach aussen),
// Seat 0 bleibt stehen. Beide ueber den echten commit()-Pfad. Ergebnis: Seat 0 punktet.
async function loseRound(cs) {
  const st = await waitAim(cs, 40000, 'Aim vor Runde');
  const tn = st[0].turnNo;
  await cs[0].page.evaluate(() => window.__ringoutE2E.commitReady());
  await cs[1].page.evaluate((mp) => window.__ringoutE2E.commitMove(0, -mp, 0), MAXPULL);
  return H.poll(async () => {
    const s = await snap(cs[0].page);
    if (s.phase === 'over') return 'over';
    return (s.phase === 'aim' && s.turnNo > tn) ? 'next' : null;
  }, 40000, 'Runde aufgeloest');
}

// Spielt bis zum Matchende. onOver wird aufgerufen, SOBALD phase==='over' gesehen
// wird — dort laesst sich das 500-ms-Fenster gezielt treffen.
async function playToGameOver(cs, onOver) {
  for (let k = 0; k < 12; k++) {
    const st = await waitAim(cs, 40000, `Aim Runde ${k}`).catch(() => null);
    if (!st) break;
    const tn = st[0].turnNo;
    await cs[0].page.evaluate(() => window.__ringoutE2E.commitReady());
    await cs[1].page.evaluate((mp) => window.__ringoutE2E.commitMove(0, -mp, 0), MAXPULL);
    const r = await H.poll(async () => {
      for (const c of cs) { const s = await snap(c.page); if (s.phase === 'over') return { over: true, at: c.id }; }
      const s0 = await snap(cs[0].page);
      return (s0.phase === 'aim' && s0.turnNo > tn) ? { over: false } : null;
    }, 40000, 'Runde aufgeloest').catch(() => null);
    if (r && r.over) { if (onOver) await onOver(); return true; }
  }
  return false;
}

(async () => {
  const state = { transformedHtml: null, prodHits: [], wsProdHits: [], otherBlocked: [], wsOtherBlocked: [], leaveWindows: [] };
  const diag = [];
  let staticServer = null, emu = null, browser = null, runDir = null;
  const cs = [];
  fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    for (const p of [H.EMU_PORT, ...H.EMU_AUX_PORTS]) if (!(await H.portFree(p))) throw new Error(`Port ${p} belegt`);
    runDir = H.createRunDir();
    H.prepareTempRules(runDir);
    state.transformedHtml = H.transformHtml(fs.readFileSync(H.INDEX_HTML, 'utf8')).html;
    staticServer = await H.startStaticServer();
    const navUrl = `http://${H.EMU_HOST}:${staticServer.port}/index.html`;   // echter 3D-Pfad
    emu = H.startEmulator(runDir);
    await H.waitEmulators(90000);
    browser = await chromium.launch({ headless: false, args: [...H.CHROMIUM_E2E_ARGS, '--mute-audio', '--window-size=1010,880'] });
    const ctx = { browser, navUrl, state, diag };
    for (let i = 0; i < 2; i++) cs.push(await newClient(ctx, i));
    const code = await setupRoom(cs);
    console.log('  Raum ' + code + ' laeuft (winTarget ' + WIN_TARGET + ')\n');

    // ── T1: Game Over OHNE Rematch blendet das Overlay weiterhin korrekt ein ──
    console.log('T1 — Game Over ohne Rematch');
    for (const c of cs) await resetShows(c.page);
    let reached = await playToGameOver(cs, null);
    check(reached, 'T1 Matchende erreicht');
    await sleep(SETTLE_MS);
    for (const c of cs) {
      check(await ovVisible(c.page), `T1 Overlay wird eingeblendet (Client ${c.id})`);
      check((await shows(c.page)) === 1, `T1 genau EINE Einblendung (Client ${c.id})`, 'shows=' + await shows(c.page));
    }
    check(await cs[0].page.evaluate(() => { const b = document.getElementById('rematchBtn'); return !!b && b.offsetParent !== null; }), 'T1 Rematch-Button im Overlay bedienbar');

    // ── T3: Rematch bei bereits sichtbarem Overlay entfernt es korrekt ────────
    console.log('\nT3 — Rematch nach sichtbarem Overlay');
    const gen1 = (await snap(cs[0].page)).gen;
    for (const c of cs) await resetShows(c.page);
    await cs[0].page.click('#rematchBtn');
    const fresh1 = await H.poll(async () => {
      const out = [];
      for (const c of cs) { const s = await snap(c.page); if (!(s.gameStarted && s.phase === 'aim' && s.gen > gen1)) return null; out.push(s); }
      return out;
    }, 30000, 'neue Generation').catch(() => null);
    check(!!fresh1, 'T3 Rematch startet neue Generation', fresh1 ? 'gen ' + fresh1[0].gen : '');
    await sleep(SETTLE_MS);
    for (const c of cs) {
      check(!(await ovVisible(c.page)), `T3 Overlay ist entfernt (Client ${c.id})`);
      check((await shows(c.page)) === 0, `T3 keine erneute Einblendung (Client ${c.id})`, 'shows=' + await shows(c.page));
    }

    // ── T2/T5: Rematch INNERHALB der 500 ms verhindert das alte Overlay ───────
    console.log('\nT2/T5 — Rematch innerhalb des Einblendfensters');
    const gen2 = (await snap(cs[0].page)).gen;
    for (const c of cs) await resetShows(c.page);
    let windowMs = null;
    reached = await playToGameOver(cs, async () => {
      const t0 = Date.now();
      await cs[0].page.evaluate(() => window.__ringoutE2E.rematch());   // echter onlineRematch()
      windowMs = Date.now() - t0;
    });
    check(reached, 'T2 Matchende erreicht');
    check(windowMs !== null && windowMs < 500, 'T2 Rematch lag im 500-ms-Fenster', 'ausgeloest nach ' + windowMs + ' ms');
    const fresh2 = await H.poll(async () => {
      const out = [];
      for (const c of cs) { const s = await snap(c.page); if (!(s.gameStarted && s.phase === 'aim' && s.gen > gen2)) return null; out.push(s); }
      return out;
    }, 30000, 'neue Generation nach Schnell-Rematch').catch(() => null);
    check(!!fresh2, 'T2 neue Generation laeuft', fresh2 ? 'gen ' + fresh2[0].gen : '');
    await sleep(SETTLE_MS);
    for (const c of cs) {
      const n = await shows(c.page);
      check(n === 0, `T2/T5 kein nachlaufendes Overlay der alten Generation (Client ${c.id})`, 'shows=' + n);
      check(!(await ovVisible(c.page)), `T2 Overlay bleibt aus (Client ${c.id})`);
    }

    // ── T6: Canvas bleibt nach dem Rematch anklickbar ─────────────────────────
    console.log('\nT6 — Canvas nach Rematch');
    for (const c of cs) {
      const o = await ownerAtOwnBall(c.page);
      check(o.isCanvas === true, `T6 Punkt an der eigenen Kugel gehoert dem Canvas (Client ${c.id})`, 'getroffen: ' + o.id);
    }
    // Und ein ECHTER Pointer-Schuss muss ankommen.
    const stT6 = await waitAim(cs, 30000, 'Aim fuer echten Schuss');
    const tnT6 = stT6[0].turnNo;
    for (const c of cs) {
      const g = await c.page.evaluate(() => window.__ringoutE2E.aimPoints(0.25, Math.PI));
      if (!g || g.blocked || !g.inViewport) { bad(`T6 Zielpunkt nicht erreichbar (Client ${c.id})`, g && g.blockedBy); continue; }
      const m = c.page.mouse;
      await m.move(g.down.x, g.down.y); await m.down();
      for (let k = 1; k <= 5; k++) { await m.move(g.down.x + (g.up.x - g.down.x) * k / 5, g.down.y + (g.up.y - g.down.y) * k / 5); await sleep(15); }
      await m.up();
    }
    const landed = await H.poll(async () => {
      const a = await snap(cs[0].page), b = await snap(cs[1].page);
      return (a.aimSet[0] && b.aimSet[1]) || a.turnNo > tnT6 || a.phase !== 'aim' ? true : null;
    }, 20000, 'echter Schuss kommt an').catch(() => null);
    check(!!landed, 'T6 echter Canvas-Schuss erreicht das Spiel nach dem Rematch');
    await H.poll(async () => { const s = await snap(cs[0].page); return (s.phase === 'aim' && s.turnNo > tnT6) || s.phase === 'over' ? true : null; }, 40000, 'Zug aufgeloest').catch(() => null);

    // ── T4/T7: erneutes Game Over blendet wieder ein; Overlay-Menue funktioniert ──
    console.log('\nT4/T7 — erneutes Game Over und Overlay-Menue');
    for (const c of cs) await resetShows(c.page);
    reached = await playToGameOver(cs, null);
    check(reached, 'T4 erneutes Matchende erreicht');
    await sleep(SETTLE_MS);
    for (const c of cs) {
      const n = await shows(c.page);
      check(n === 1, `T4 nach abgebrochenem Auftrag wieder genau EINE Einblendung (Client ${c.id})`, 'shows=' + n);
    }
    await cs[1].page.click('#ovMenuBtn');
    const menu = await H.poll(async () => {
      const s = await snap(cs[1].page);
      const inMenu = await cs[1].page.evaluate(() => getComputedStyle(document.getElementById('menu')).display !== 'none');
      return (!s.online && inMenu) ? { s, inMenu } : null;
    }, 20000, 'Overlay-Menue fuehrt ins Hauptmenue').catch(() => null);
    check(!!menu, 'T7 Overlay-Menue fuehrt zurueck ins Hauptmenue und verlaesst den Raum');
    check(!(await ovVisible(cs[1].page)), 'T7 Overlay ist danach ausgeblendet');
    await sleep(SETTLE_MS);
    check(!(await ovVisible(cs[1].page)), 'T8 Leave/Menue laesst keinen Auftrag nachlaufen');

    // ── T8: Leave INNERHALB des Fensters raeumt den Auftrag auf ───────────────
    console.log('\nT8 — Leave innerhalb des Einblendfensters (frischer Raum)');
    try { await cs[0].page.evaluate(() => window.__ringoutE2E.leave()); } catch (_) {}
    await sleep(800);
    for (const c of cs) await resetShows(c.page);
    const code2 = await setupRoom(cs);
    console.log('  zweiter Raum ' + code2);
    let leaveMs = null;
    reached = await playToGameOver(cs, async () => {
      const t0 = Date.now();
      await cs[1].page.evaluate(() => window.__ringoutE2E.leave());
      leaveMs = Date.now() - t0;
    });
    check(reached, 'T8 Matchende erreicht');
    check(leaveMs !== null && leaveMs < 500, 'T8 Leave lag im 500-ms-Fenster', 'ausgeloest nach ' + leaveMs + ' ms');
    await sleep(SETTLE_MS);
    const nLeave = await shows(cs[1].page);
    check(nLeave === 0, 'T8 nach Leave im Fenster erscheint kein Overlay', 'shows=' + nLeave);
    check(!(await ovVisible(cs[1].page)), 'T8 Overlay bleibt aus');

    // ── T8b: Reconnect — der wiederhergestellte Client startet ohne Altlast ───
    console.log('\nT8b — Reload/Rejoin nach Rematch');
    const genR = (await snap(cs[0].page)).gen;
    await cs[0].page.evaluate(() => window.__ringoutE2E.rematch()).catch(() => {});
    await H.poll(async () => { const s = await snap(cs[0].page); return s.gen > genR ? true : null; }, 25000, 'neue Generation vor Rejoin').catch(() => null);
    await cs[0].page.reload({ waitUntil: 'domcontentloaded' });
    await cs[0].page.waitForFunction(() => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 30000 });
    await cs[0].page.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });
    await cs[0].page.evaluate(OBSERVER);
    await cs[0].page.evaluate(() => { const e = document.getElementById('onRejoin'); if (e) e.style.display = ''; });
    await cs[0].page.click('#rejoinBtn').catch(() => {});
    await sleep(SETTLE_MS + 1500);
    const nRe = await shows(cs[0].page);
    check(nRe === 0, 'T8b Reconnect startet ohne nachlaufendes Overlay', 'shows=' + nRe);

    for (const c of cs) { try { await c.page.screenshot({ path: path.join(OUT_DIR, `overlay_c${c.id}.png`) }); } catch (_) {} }
    const hardErr = cs.flatMap((c) => c.diag.pageErrors);
    check(hardErr.length === 0, 'keine harte Console-Exception', hardErr.join(' | '));
    check(state.prodHits.length === 0 && state.wsProdHits.length === 0, 'keine Produktionskontakte');
  } catch (e) {
    bad('Lauf abgebrochen', String((e && e.stack) || e));
  } finally {
    for (const c of cs) { if (!c.closed) { try { await c.page.evaluate(() => window.__ringoutE2E.leave()); } catch (_) {} try { await c.context.close(); c.closed = true; } catch (_) {} } }
    const clean = await H.cleanup({ browser, staticServer, emu, runDir, closeErrors: [], preexistingLogs: [] });
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify({ results, cleanup: clean }, null, 2));
    const p = results.filter((r) => r.ok).length, f = results.filter((r) => !r.ok);
    console.log(`\nOverlay-Race: ${p} passed, ${f.length} failed`);
    f.forEach((x) => console.log('   FAIL: ' + x.n + (x.e ? ' — ' + x.e : '')));
    process.exit(f.length || !clean.cleanupOk ? 1 : 0);
  }
})();
