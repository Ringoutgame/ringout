// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Zugzeit-Anzeige im Browser, zwei Online-Clients
//
//   node tools/e2e/run-turn-timer.js        (npm run test:e2e:turntimer)
//
// Die Offline-Suite (tools/test_turn_timer.js) prueft die Logik. Hier zaehlt, was
// im echten Client sichtbar ist: dass beide Spieler dieselbe Sekunde sehen, dass
// die Anzeige nach einem Reload/Rejoin mitten in der Phase den TATSAECHLICHEN
// Restwert zeigt (und nicht auf 7 springt) und dass Zugtimer und Matchzeit zwei
// klar getrennte HUD-Elemente sind.
//
// Aufbau wie die uebrigen 3D-Laeufe: JDK-21-RTDB-Emulator, lokaler Static-Server,
// harte Produktions-Firebase-Sperre, echter 3D-Pfad. index.html bleibt unveraendert.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const H = require('./lib/harness');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = process.env.TT_OUT || path.join(REPO_ROOT, 'artifacts', 'turn_timer');
const VIEWPORT = { width: 1000, height: 820 };
const MOBILE = { width: 390, height: 780 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (page) => page.evaluate(() => window.__ringoutE2E.snapshot());
// Was der Spieler sieht: Sichtbarkeit, Zahl, Zustandsklassen, Balkenbreite.
const hud = (page) => page.evaluate(() => {
  const e = document.getElementById('turnTimer');
  const c = document.getElementById('collapseTimer');
  if (!e) return null;
  const cs = getComputedStyle(e);
  const r = e.getBoundingClientRect();
  return {
    visible: cs.display !== 'none' && r.width > 0,
    num: (document.getElementById('turnTimerNum') || {}).textContent || '',
    label: (document.getElementById('turnTimerLbl') || {}).textContent || '',
    urgent: e.classList.contains('urgent'),
    up: e.classList.contains('up'),
    fill: (document.getElementById('turnTimerFill') || { style: {} }).style.transform || '',
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    // Alle sichtbaren Bedienelemente der oberen Leiste — die Anzeige darf keines davon
    // ueberdecken (sonst gingen Menue-/Ton-Taps ins Leere).
    controls: [...document.querySelectorAll('header button, header .ibtn')].map((e) => {
      const q = e.getBoundingClientRect();
      return { id: e.id || e.className, x: Math.round(q.left), y: Math.round(q.top), r: Math.round(q.right), b: Math.round(q.bottom) };
    }).filter((q) => q.r > q.x),
    // Wem gehoert die Mitte der Anzeige? Muss die Anzeige selbst sein (nichts liegt darueber).
    hitAtCentre: (() => { const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el ? (el.id || el.className) : null; })(),
    collapseVisible: !!c && getComputedStyle(c).display !== 'none',
    collapseRect: c ? (() => { const q = c.getBoundingClientRect(); return { x: Math.round(q.left), w: Math.round(q.width) }; })() : null,
  };
});

const results = [];
const ok = (n, e) => { results.push({ n, ok: true, e }); console.log('  ✓ ' + n + (e ? ' — ' + e : '')); };
const bad = (n, e) => { results.push({ n, ok: false, e }); console.log('  ✗ ' + n + (e ? ' — ' + e : '')); };
const check = (c, n, e) => (c ? ok(n, e) : bad(n, e));

async function newClient(ctx, id, viewport) {
  const context = await ctx.browser.newContext({ serviceWorkers: 'block', viewport: viewport || VIEWPORT });
  await H.armContext(context, 'c' + id, ctx.state);
  const page = await context.newPage();
  const diag = { pageErrors: [] };
  page.on('pageerror', (e) => diag.pageErrors.push(String((e && e.message) || e)));
  H.wireDiagnostics(page, 'c' + id, ctx.diag);
  await page.goto(ctx.navUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.body.classList.contains('r3d'), null, { timeout: 30000 });
  return { id, context, page, diag, closed: false };
}

async function setupRoom(cs) {
  await cs[0].page.evaluate(() => window.__ringoutE2E.hostFFA(5, 'ffa'));
  const code = await H.poll(async () => { const s = await snap(cs[0].page); return s.roomCode && s.roomCode.length === 4 ? s.roomCode : null; }, 25000, 'Raum');
  await cs[1].page.evaluate((c) => window.__ringoutE2E.joinFFA(c), code);
  await H.poll(async () => { const s = await snap(cs[1].page); return s.online && s.myPlayer === 1 ? true : null; }, 25000, 'Beitritt');
  await H.poll(async () => { const p = await H.dbRead(cs[0].page, `rooms/${code}/p`); return p && p[0] && p[0].on === true && p[1] && p[1].on === true ? true : null; }, 25000, 'Seats aktiv');
  await H.poll(async () => { await cs[0].page.evaluate(() => window.__ringoutE2E.start()); return (await H.dbRead(cs[0].page, `rooms/${code}/state`)) === 'playing' ? true : null; }, 25000, 'Start');
  return code;
}

const waitAim = (cs, ms, label) => H.poll(async () => {
  const out = [];
  for (const c of cs) { const s = await snap(c.page); if (!(s.gameStarted && s.phase === 'aim')) return null; out.push(s); }
  return out;
}, ms, label);

(async () => {
  const state = { transformedHtml: null, prodHits: [], wsProdHits: [], otherBlocked: [], wsOtherBlocked: [], leaveWindows: [] };
  const diag = [];
  let staticServer = null, emu = null, browser = null, runDir = null;
  const cs = [];
  const report = {};
  fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    for (const p of [H.EMU_PORT, ...H.EMU_AUX_PORTS]) if (!(await H.portFree(p))) throw new Error(`Port ${p} belegt`);
    runDir = H.createRunDir();
    H.prepareTempRules(runDir);
    state.transformedHtml = H.transformHtml(fs.readFileSync(H.INDEX_HTML, 'utf8')).html;
    staticServer = await H.startStaticServer();
    const navUrl = `http://${H.EMU_HOST}:${staticServer.port}/index.html`;
    emu = H.startEmulator(runDir);
    await H.waitEmulators(90000);
    browser = await chromium.launch({ headless: false, args: [...H.CHROMIUM_E2E_ARGS, '--mute-audio', '--window-size=1010,880'] });
    const ctx = { browser, navUrl, state, diag };
    cs.push(await newClient(ctx, 0, VIEWPORT));
    cs.push(await newClient(ctx, 1, MOBILE));      // Client 1 bewusst in Handy-Groesse
    ok('zwei Clients im echten 3D-Pfad (Desktop 1000x820 + Mobil 390x780)');
    const code = await setupRoom(cs);
    report.room = code;
    ok('privater FFA-Raum laeuft', 'Code ' + code);

    // ── Sichtbarkeit + Start bei 7 ───────────────────────────────────────────
    await waitAim(cs, 40000, 'Aim turn 0');
    const first = [];
    for (const c of cs) first.push(await hud(c.page));
    report.firstAim = first;
    for (let i = 0; i < cs.length; i++) {
      check(first[i] && first[i].visible, `Anzeige sichtbar in der Aim-Phase (Client ${i})`);
      check(first[i] && ['7', '6'].includes(first[i].num), `startet bei 7 (Client ${i})`, first[i] && first[i].num);
      check(first[i] && first[i].label.length > 0, `Beschriftung gesetzt (Client ${i})`, first[i] && first[i].label);
      check(first[i] && !first[i].urgent, `kein Puls in den ersten Sekunden (Client ${i})`);
    }
    // Responsiv: das Handy-Layout ist schmaler, aber vollstaendig im Viewport.
    const m = first[1];
    check(m.rect.w > 0 && m.rect.x + m.rect.w <= MOBILE.width, 'Mobil: Anzeige vollstaendig im Viewport', JSON.stringify(m.rect));
    check(first[0].rect.w >= m.rect.w, 'Desktop-Anzeige ist nicht kleiner als die mobile', `${first[0].rect.w} vs ${m.rect.w}`);
    // Keine Ueberdeckung der Bedienelemente — auf beiden Groessen.
    for (let i = 0; i < cs.length; i++) {
      const h = first[i];
      const hit = h.controls.filter((q) => !(h.rect.x > q.r || q.x > h.rect.x + h.rect.w || h.rect.y > q.b || q.y > h.rect.y + h.rect.h));
      check(hit.length === 0, `Anzeige ueberdeckt keinen HUD-Button (Client ${i})`, JSON.stringify({ tt: h.rect, hit }));
    }

    // ── Zwei Clients zeigen dieselbe Sekunde ─────────────────────────────────
    const pairs = [];
    for (let k = 0; k < 6; k++) {
      const a = await hud(cs[0].page), b = await hud(cs[1].page);
      pairs.push([a.num, b.num]);
      await sleep(420);
    }
    report.pairs = pairs;
    const mismatches = pairs.filter(([a, b]) => Math.abs(Number(a) - Number(b)) > 1);
    check(mismatches.length === 0, 'beide Clients zeigen dieselbe Sekunde (Toleranz 1 durch Messversatz)', JSON.stringify(pairs));
    const exact = pairs.filter(([a, b]) => a === b).length;
    check(exact >= 4, 'ueberwiegend exakt identische Sekunde', `${exact}/${pairs.length} exakt gleich`);

    // ── Herunterzaehlen + Puls in den letzten Sekunden ───────────────────────
    // Wichtig: JEDE Probe traegt ihre turnNo. Ein Zugwechsel setzt die Anzeige
    // regulaer wieder auf 7 — ohne diese Zuordnung wuerde der Sprung faelschlich
    // als "zaehlt aufwaerts" gelesen. Ausgewertet wird deshalb pro Turn.
    const trace = [];
    for (let k = 0; k < 90; k++) {
      const s = await snap(cs[0].page).catch(() => null);
      const a = await hud(cs[0].page).catch(() => null);
      if (s && a) trace.push({ turnNo: s.turnNo, phase: s.phase, num: a.num, urgent: a.urgent, up: a.up, visible: a.visible });
      await sleep(220);
    }
    report.trace = trace;
    const byTurn = new Map();
    for (const x of trace) { if (x.phase !== 'aim' || !x.visible) continue; if (!byTurn.has(x.turnNo)) byTurn.set(x.turnNo, []); byTurn.get(x.turnNo).push(x); }
    const turns = [...byTurn.keys()].sort((a, b) => a - b);
    report.turnsObserved = turns;
    check(turns.length >= 2, 'mindestens zwei Zuege beobachtet', JSON.stringify(turns));
    let monotoneAll = true, resets = 0, sawUrgent = false, calmOk = true, urgentOk = true;
    for (const tn of turns) {
      const nums = byTurn.get(tn).map((x) => Number(x.num));
      for (let i = 1; i < nums.length; i++) if (nums[i] > nums[i - 1]) monotoneAll = false;
      if (nums[0] >= 6) resets++;                       // Turn startete sichtbar oben
      for (const x of byTurn.get(tn)) {
        const n = Number(x.num);
        if (n <= 0) continue;
        if (x.urgent) { sawUrgent = true; if (n > 3) urgentOk = false; }
        else if (n < 4) calmOk = false;                 // 3/2/1 muessen pulsieren
      }
    }
    check(monotoneAll, 'Anzeige zaehlt innerhalb jedes Zuges herunter (nie aufwaerts)',
      JSON.stringify(turns.map((tn) => [tn, byTurn.get(tn).map((x) => x.num).join('>')])));
    check(resets >= 2, 'jeder neue Zug startet die Anzeige wieder oben (>=6)', 'Zuege mit hohem Start: ' + resets);
    check(sawUrgent && urgentOk, 'Puls ausschliesslich in den letzten drei Sekunden');
    check(calmOk, 'Sekunden 7 bis 4 bleiben ruhig');
    const lows = trace.filter((x) => x.phase === 'aim' && Number(x.num) <= 1);
    check(lows.length > 0, 'Anzeige laeuft sichtbar bis an das Ende der Zugzeit', 'Proben bei <=1: ' + lows.length);

    // ── Timeout-Vertrag: eigener No-Shot, Kugel bleibt aktiv ─────────────────
    const st = await waitAim(cs, 45000, 'Aim nach Timeout').catch(() => null);
    if (st) {
      const dbT = await H.dbRead(cs[0].page, `rooms/${code}/g/${st[0].gen}/t/${st[0].turnNo - 1}`);
      report.timeoutSlots = dbT;
      const own0 = 0, own1 = 1;
      check(dbT && dbT['0'] && dbT['1'] && dbT['0'].idx === own0 && dbT['1'].idx === own1,
        'Timeout erzeugt weiterhin No-Shots auf den eigenen Kugeln', JSON.stringify(dbT && [dbT['0'], dbT['1']]));
      check(st[0].balls.every((b) => b.a), 'alle Kugeln nach dem Timeout weiterhin aktiv');
      check(st[0].seatGone.every((v) => v === false), 'kein Seat wird durch den Timeout als verlassen gewertet', JSON.stringify(st[0].seatGone));
      // Naechster Turn: der Endzustand ist geloest und die Anzeige laeuft wieder
      // (der genaue Startwert wird oben pro Turn geprueft — hier zaehlt, dass der
      // 0-/up-Zustand des Vorzugs nicht haengen bleibt).
      const again = await hud(cs[0].page);
      check(!again.up && Number(again.num) > 0, 'Endzustand ist beim naechsten Turn geloest', again.num);
      check(again.visible, 'Anzeige im naechsten Turn wieder sichtbar');
    } else bad('Aim-Phase nach dem Timeout erreicht');

    // ── Getrennt von der Matchzeit ───────────────────────────────────────────
    const sep = await hud(cs[0].page);
    if (sep.collapseVisible && sep.collapseRect) {
      check(sep.rect.x > sep.collapseRect.x + sep.collapseRect.w || sep.collapseRect.x > sep.rect.x + sep.rect.w,
        'Zugtimer und Matchzeit ueberlappen nicht', JSON.stringify([sep.rect, sep.collapseRect]));
    } else ok('Matchzeit-Anzeige online ausgeblendet — keine Verwechslung moeglich');

    // ── Reveal blendet aus ───────────────────────────────────────────────────
    const stR = await waitAim(cs, 40000, 'Aim vor Reveal');
    const tnR = stR[0].turnNo;
    for (const c of cs) await c.page.evaluate(() => window.__ringoutE2E.commitReady());
    const hidden = await H.poll(async () => {
      const s = await snap(cs[0].page);
      if (s.phase === 'aim' && s.turnNo === tnR) return null;
      const h = await hud(cs[0].page);
      return h.visible ? null : { phase: s.phase };
    }, 25000, 'Anzeige verschwindet ausserhalb der Aim-Phase').catch(() => null);
    check(!!hidden, 'Reveal/Simulation blendet die Anzeige aus', hidden && hidden.phase);

    // ── Reload/Rejoin mitten in der Aim-Phase ────────────────────────────────
    await waitAim(cs, 45000, 'Aim vor Rejoin');
    await sleep(2600);                                   // Phase bewusst anlaufen lassen
    const beforeRe = await hud(cs[0].page);
    await cs[1].page.reload({ waitUntil: 'domcontentloaded' });
    await cs[1].page.waitForFunction(() => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 30000 });
    await cs[1].page.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 30000 });
    await cs[1].page.evaluate(() => { const e = document.getElementById('onRejoin'); if (e) e.style.display = ''; });
    await cs[1].page.click('#rejoinBtn').catch(() => {});
    const back = await H.poll(async () => {
      const s = await snap(cs[1].page).catch(() => null);
      if (!s || !(s.online && s.gameStarted && s.roomCode === code && s.phase === 'aim')) return null;
      const h = await hud(cs[1].page);
      return h.visible ? h : null;
    }, 45000, 'Rejoin zeigt die Anzeige').catch(() => null);
    check(!!back, 'nach Reload/Rejoin ist die Anzeige wieder sichtbar');
    if (back) {
      const other = await hud(cs[0].page);
      report.rejoin = { before: beforeRe.num, rejoined: back.num, other: other.num };
      check(Math.abs(Number(back.num) - Number(other.num)) <= 1,
        'Rejoin zeigt die TATSAECHLICHE Restzeit (gleich dem durchgehenden Client)', `rejoined=${back.num} vs durchgehend=${other.num}`);
      check(!(back.num === '7' && Number(other.num) < 6), 'kein Sprung auf 7 bei bereits angelaufener Phase', `rejoined=${back.num} other=${other.num}`);
    }

    for (const c of cs) { try { await c.page.screenshot({ path: path.join(OUT_DIR, `turntimer_c${c.id}.png`) }); } catch (_) {} }
    const hard = cs.flatMap((c) => c.diag.pageErrors);
    check(hard.length === 0, 'keine harte Console-Exception', hard.join(' | '));
    check(state.prodHits.length === 0 && state.wsProdHits.length === 0, 'keine Produktionskontakte');
  } catch (e) {
    bad('Lauf abgebrochen', String((e && e.stack) || e));
  } finally {
    for (const c of cs) { if (!c.closed) { try { await c.page.evaluate(() => window.__ringoutE2E.leave()); } catch (_) {} try { await c.context.close(); c.closed = true; } catch (_) {} } }
    const clean = await H.cleanup({ browser, staticServer, emu, runDir, closeErrors: [], preexistingLogs: [] });
    report.results = results;
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify({ ...report, cleanup: clean }, null, 2));
    const p = results.filter((r) => r.ok).length, f = results.filter((r) => !r.ok);
    console.log(`\nZugzeit-Browsertest: ${p} passed, ${f.length} failed`);
    f.forEach((x) => console.log('   FAIL: ' + x.n + (x.e ? ' — ' + x.e : '')));
    process.exit(f.length || !clean.cleanupOk ? 1 : 0);
  }
})();
