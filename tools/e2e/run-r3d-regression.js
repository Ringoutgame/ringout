// ─────────────────────────────────────────────────────────────────────────────
// RingOut — 3D-Start-Regressionswaechter (Browser, ohne Firebase)
//
//   node tools/e2e/run-r3d-regression.js     (oder: npm run test:e2e:r3d)
//
// Haelt fest, dass der ausgelieferte Client im Normalfall WIRKLICH in der
// 3D-Szene startet — und dass der 2D-Fallback trotzdem sauber greift, wenn er
// greifen MUSS. Genau dieser Unterschied war bisher von aussen nicht pruefbar:
// ein stiller Rutsch in den Fallback sieht in allen Offline-Suiten gruen aus,
// weil dort kein Browser laeuft.
//
// Drei Faelle:
//   A  Produktivpfad          -> 3D aktiv, Stage-2-Arena geladen, kein Fallback
//   B  WebGL nicht verfuegbar -> kontrollierter 2D-Fallback, Spiel bleibt nutzbar
//   C  Stage-2-GLB kaputt     -> kontrollierter 2D-Fallback, Spiel bleibt nutzbar
//
// Der Test faellt rot, sobald Fall A unbemerkt in den Fallback rutscht.
//
// Umgebungs-Notiz (PROJECT.md): lokale Matches werden HEADED gefahren — der
// headless-SwiftShader-Chromium verliert beim ersten Launch requestAnimationFrame.
// index.html auf Platte wird nie veraendert; es laeuft nur der lokale Static-Server.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOST = '127.0.0.1';
const ARENA_GLB = 'assets/arena_platform_stage2.glb';
// Der Stage-2-Vertrag lebt in diesen Knoten: der Kern plus sechs echte Keile,
// die mit ihrem Segment fallen. Fehlt einer, ist das Asset nicht der freigegebene Stand.
const REQUIRED_NODES = ['PlayFloor_Core',
  'PlayFloor_Stage2_Wedge_01', 'PlayFloor_Stage2_Wedge_02', 'PlayFloor_Stage2_Wedge_03',
  'PlayFloor_Stage2_Wedge_04', 'PlayFloor_Stage2_Wedge_05', 'PlayFloor_Stage2_Wedge_06'];
// Erster gerenderter 3D-Frame nimmt den Boot-Overlay weg; das Sicherheitsnetz in
// index.html zieht erst nach 10 s. Wer innerhalb dieser Schranke fertig ist, hat
// tatsaechlich gerendert und ist nicht bloss ins Timeout gelaufen.
const BOOT_DEADLINE_MS = 8000;
const FALLBACK_TOAST = '3D nicht verfügbar';

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name) => { results.push({ name, ok: true }); console.log('  ✓ ' + name); };
const fail = (name, detail) => { results.push({ name, ok: false, detail }); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); };
const check = (cond, name, detail) => (cond ? ok(name) : fail(name, detail));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, HOST, () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// Zustand read-only aus dem DOM: 3D-Canvas, Body-Klasse, Fallback-Toast.
const readState = (page) => page.evaluate(() => {
  const c3 = document.getElementById('cv3d');
  let gl = false;
  if (c3) { try { gl = !!(c3.getContext('webgl2') || c3.getContext('webgl')); } catch (_) { gl = false; } }
  return {
    r3d: document.body.classList.contains('r3d'),
    hasCv3d: !!c3,
    cv3dVisible: !!c3 && getComputedStyle(c3).display !== 'none' && c3.width > 0 && c3.height > 0,
    glContext: gl,
    booting: document.body.classList.contains('booting'),
    toast: (document.getElementById('toast') || {}).textContent || '',
    actBtnVisible: !!(document.getElementById('actBtn') && document.getElementById('actBtn').offsetParent !== null),
  };
});

// Knotennamen direkt aus dem AUSGELIEFERTEN GLB lesen (JSON-Chunk des glb-Containers).
const readGlbNodes = (page, url) => page.evaluate(async (u) => {
  const buf = await (await fetch(u)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('kein glTF-Binary');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  return { nodes: (json.nodes || []).map((n) => n.name).filter(Boolean), bytes: buf.byteLength };
}, url);

async function newClient(browser, navUrl, prep) {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const diag = { pageErrors: [], consoleErrors: [], responses: [], failed: [] };
  if (prep) await prep(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => diag.pageErrors.push(String((e && e.message) || e)));
  page.on('console', (m) => { if (m.type() === 'error') diag.consoleErrors.push(m.text()); });
  page.on('response', (r) => diag.responses.push({ status: r.status(), url: r.url() }));
  page.on('requestfailed', (r) => diag.failed.push({ url: r.url(), err: r.failure() && r.failure().errorText }));
  const t0 = Date.now();
  await page.goto(navUrl, { waitUntil: 'load' });
  return { context, page, diag, t0 };
}

// Bot-1v1 ueber die echte Menue-UI starten (kein Firebase noetig).
async function startBotMatch(page) {
  await page.click('#cardBot');
  await page.click('#ctaBtn');
  await page.waitForSelector('#bot1v1', { state: 'visible', timeout: 15000 });
  await page.click('#bot1v1');
  await page.waitForSelector('#actBtn', { state: 'visible', timeout: 20000 });
}

// Das Repo hat keine favicon.ico; Chromium holt sie trotzdem und schreibt bei
// 404 eine anonyme Zeile "Failed to load resource: … 404" — OHNE URL und ohne
// request/response-Event auf Seitenebene (nachgemessen: kein Favicon-Request in
// page.on('request')). Solche Zeilen sind daher nicht zuordenbar und werden
// bewusst toleriert; jeder 404 einer ECHTEN Seitenanfrage taucht in der
// Response-Liste auf und faellt bereits ueber die Asset-Pruefung durch.
const isUnattributableResourceError = (t) => /Failed to load resource.*40[34]/i.test(t);
const hardConsoleErrors = (diag) =>
  diag.consoleErrors.filter((t) => !/favicon/i.test(t) && !isUnattributableResourceError(t));

async function caseProduction(browser, navUrl, shotDir) {
  console.log('\nFall A — Produktivpfad (3D muss starten)');
  const c = await newClient(browser, navUrl, null);
  try {
    await c.page.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: BOOT_DEADLINE_MS + 4000 });
    const bootMs = Date.now() - c.t0;
    const s = await readState(c.page);

    check(s.r3d, '3D-Renderer aktiv (body.r3d)', 'body-Klassen ohne r3d');
    check(s.hasCv3d && s.cv3dVisible, '3D-Canvas #cv3d vorhanden und sichtbar');
    check(s.glContext, 'WebGL-Kontext auf #cv3d');
    check(!s.toast.includes(FALLBACK_TOAST), '2D-Fallback NICHT ausgeloest', 'Toast: ' + s.toast);
    // Zusammen mit "body.r3d" ist das der Beleg, dass wirklich ein 3D-Frame lief:
    // der Boot-Overlay verschwindet im 3D-Pfad erst im loop NACH r3d.render().
    // Allein aussagekraeftig ist die Zeit nicht — im Fehlerpfad endet der Boot
    // ebenfalls sofort.
    check(bootMs < BOOT_DEADLINE_MS, `Boot ohne 10-s-Sicherheitsnetz beendet (${bootMs} ms)`,
      `Boot dauerte ${bootMs} ms — nur das Sicherheitsnetz hat den Loader entfernt`);

    // Snapshot VOR der eigenen GLB-Abfrage: sonst wuerde der Test seinen eigenen
    // fetch als "Client hat die Arena geladen" zaehlen und im Fallback faelschlich
    // gruen bleiben.
    const clientRequests = c.diag.responses.slice();
    const glb = await readGlbNodes(c.page, new URL(ARENA_GLB, navUrl).href);
    const missing = REQUIRED_NODES.filter((n) => !glb.nodes.includes(n));
    check(missing.length === 0, `Stage-2-Arena enthaelt Core + 6 Keile (${glb.nodes.length} Knoten)`, 'fehlend: ' + missing.join(', '));

    await startBotMatch(c.page);
    await sleep(2500);
    const inMatch = await readState(c.page);
    check(inMatch.r3d && inMatch.hasCv3d, '3D bleibt im laufenden Match aktiv');
    check(!inMatch.toast.includes(FALLBACK_TOAST), 'kein nachtraeglicher Fallback im Match');

    const req = clientRequests.filter((r) => r.url.includes(ARENA_GLB));
    check(req.length > 0 && req.every((r) => r.status === 200), 'Stage-2-Arena vom Client geladen (HTTP 200)',
      req.length ? 'Status: ' + req.map((r) => r.status).join(',') : 'nie angefragt');
    const bad = c.diag.responses.filter((r) => r.status >= 400 && !/favicon/.test(r.url));
    check(bad.length === 0, 'keine fehlgeschlagenen Asset-Requests', bad.map((b) => b.status + ' ' + b.url).join(' | '));
    check(c.diag.pageErrors.length === 0, 'keine harte Console-Exception', c.diag.pageErrors.join(' | '));
    check(hardConsoleErrors(c.diag).length === 0, 'keine Console-Fehler (ausser favicon)', hardConsoleErrors(c.diag).join(' | '));

    if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await c.page.screenshot({ path: path.join(shotDir, 'r3d_match.png') }); }
  } finally { await c.context.close(); }
}

// Der Fallback ist Produktverhalten und muss erhalten bleiben: kein WebGL bzw.
// kein Arena-Asset => kontrollierte 2D-Darstellung statt weisser Seite.
async function caseFallback(browser, navUrl, label, prep) {
  console.log('\n' + label);
  const c = await newClient(browser, navUrl, prep);
  try {
    await c.page.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 20000 });
    await sleep(1200);
    const s = await readState(c.page);
    check(!s.r3d && !s.hasCv3d, '2D-Fallback aktiv (kein 3D-Canvas)');
    check(s.toast.includes(FALLBACK_TOAST), 'Fallback wird dem Spieler angezeigt', 'Toast: ' + s.toast);
    await startBotMatch(c.page);
    const inMatch = await readState(c.page);
    check(inMatch.actBtnVisible, 'Spiel im 2D-Fallback weiterhin bedienbar');
    check(c.diag.pageErrors.length === 0, 'Fallback ohne harte Console-Exception', c.diag.pageErrors.join(' | '));
  } finally { await c.context.close(); }
}

(async () => {
  let server = null, browser = null;
  try {
    const port = await freePort();
    server = spawn(process.execPath, [path.join(REPO_ROOT, 'tools', 'serve_local.js'), String(port)],
      { cwd: REPO_ROOT, stdio: 'ignore' });
    await sleep(1200);
    const navUrl = `http://${HOST}:${port}/index.html`;
    console.log('RingOut 3D-Start-Regressionswaechter — ' + navUrl);

    browser = await chromium.launch({ headless: false, args: ['--mute-audio', '--window-size=940,780'] });

    await caseProduction(browser, navUrl, process.env.R3D_SHOTS || null);

    await caseFallback(browser, navUrl, 'Fall B — WebGL nicht verfuegbar (Fallback muss greifen)', async (context) => {
      await context.addInitScript(() => {
        const orig = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (typeof type === 'string' && type.indexOf('webgl') === 0) return null;
          return orig.call(this, type, ...rest);
        };
      });
    });

    await caseFallback(browser, navUrl, 'Fall C — Stage-2-Arena nicht ladbar (Fallback muss greifen)', async (context) => {
      await context.route('**/arena_platform_stage2.glb', (r) => r.abort('failed'));
    });
  } catch (e) {
    fail('Testlauf abgebrochen', String((e && e.message) || e));
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
    if (server) { try { server.kill(); } catch (_) {} }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    console.log(`\n3D-Regression: ${passed} passed, ${failed.length} failed`);
    failed.forEach((f) => console.log('   FAIL: ' + f.name + (f.detail ? ' — ' + f.detail : '')));
    process.exit(failed.length ? 1 : 0);
  }
})();
