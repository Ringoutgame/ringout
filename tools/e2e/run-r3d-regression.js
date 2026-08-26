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

const SHOT_DIR = process.env.R3D_SHOTS || null;
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


// ── Fall D — Geometrie-Vertrag (Mobile Bug 2A) ──────────────────────────────
// Renderer, Projektion und Picking muessen dauerhaft aus DERSELBEN kanonischen
// Spielflaeche stammen. Frueher mischten sich innerWidth/innerHeight,
// die CSS-Flaeche von #cv3d und ein live gemessenes Rect: liefen sie
// auseinander (Mobile: dynamische Browserleisten), streckte der Browser das
// 3D-Bild und die sichtbare Kugel wanderte vom Trefferpunkt weg — gemessen bis
// 69,7 px, ab ~52 px greift pickOwnBall3D() die sichtbare Kugel nicht mehr.
//
// Geprueft wird gegen PRODUKTINVARIANTEN, nicht gegen Interna: die Position, an
// der die eigene Kugel gezeichnet wird, muss die Position sein, die das echte
// Picking verwendet — und ein Tipp dort muss die Kugel wirklich treffen.
// Der Lesehaken dafuer haengt an ?mobileDiag=1 und ist sonst inert.
const GEOM_TOL_PX = 1;          // "nahe 0", ausdruecklich NICHT die 52-px-Trefferzone

async function caseGeometry(browser, navUrl) {
  console.log('\nFall D — Geometrie-Vertrag: Rendering und Picking teilen eine Flaeche');
  const c = await newClient(browser, navUrl + '?mobileDiag=1', null);
  try {
    await c.page.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 20000 });
    const diag = () => c.page.evaluate(() => window.__mobileDiag());
    const pickAt = (x, y) => c.page.evaluate(([a, b]) => window.__mobileDiagPick(a, b), [x, y]);
    const hasHook = await c.page.evaluate(() => typeof window.__mobileDiag === 'function');
    check(hasHook, 'Geometrie-Lesehaken unter ?mobileDiag=1 verfuegbar');
    if (!hasHook) return;

    await startBotMatch(c.page);
    await sleep(700);

    // 1) Ausgangszustand: eine Flaeche, kein Versatz, Picking trifft.
    const base = await diag();
    check(base.r3dActive === true, '3D aktiv fuer die Geometriepruefung');
    check(base.projectionGeometryMismatch === false,
      'Ausgangszustand: Projektion, CSS-Flaeche und Zeichenpuffer stimmen ueberein',
      JSON.stringify(base.mismatch));
    check(base.mismatchPx < GEOM_TOL_PX,
      `Ausgangszustand: gezeichnete Kugel == Picking-Position (${base.mismatchPx.toFixed(2)} px)`,
      'Abweichung ' + base.mismatchPx);
    const b0 = await pickAt(base.ball.draw.x, base.ball.draw.y);
    check(b0.idx >= 0, 'Ausgangszustand: Tipp auf die gezeichnete Kugel trifft sie', JSON.stringify(b0));
    check(Math.abs(base.buf.w / base.pixelRatio - base.cv3dRect.w) < GEOM_TOL_PX &&
          Math.abs(base.buf.h / base.pixelRatio - base.cv3dRect.h) < GEOM_TOL_PX,
      'Zeichenpuffer entspricht der sichtbaren CSS-Flaeche (keine Streckung)',
      `buf ${base.buf.w}x${base.buf.h} @${base.pixelRatio} vs css ${base.cv3dRect.w}x${base.cv3dRect.h}`);

    // 2) Echtes Zielen bleibt unveraendert: ein Zug an der gezeichneten Position
    //    loest wirklich einen Schuss aus (die Kugel bewegt sich danach).
    const beforeShot = base.ball.logical;
    await c.page.mouse.move(base.ball.draw.x, base.ball.draw.y);
    await c.page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await c.page.mouse.move(base.ball.draw.x, base.ball.draw.y + i * 9);
      await sleep(16);
    }
    await c.page.mouse.up();
    await sleep(2600);
    const afterShot = await diag();
    check(!!afterShot.ball && Math.hypot(afterShot.ball.logical.x - beforeShot.x,
                                         afterShot.ball.logical.y - beforeShot.y) > 1,
      'Aim/Drag unveraendert: Zug an der gezeichneten Kugel loest einen Schuss aus',
      JSON.stringify({ vorher: beforeShot, nachher: afterShot.ball && afterShot.ball.logical }));
    await sleep(1500);

    // 3) Mobil-typische Hoehenaenderung der Spielflaeche OHNE window-resize.
    //    Genau dieser Fall lieferte vorher 34,9 px bzw. 69,7 px Versatz.
    await c.page.evaluate(() => { window.__geomResize = 0; addEventListener('resize', () => { window.__geomResize++; }); });
    let worst = 0;
    for (const dh of [60, 120, 200]) {
      await c.page.evaluate((v) => { document.getElementById('cv3d').style.height = (innerHeight - v) + 'px'; }, dh);
      await sleep(700);
      const x = await diag();
      worst = Math.max(worst, x.mismatchPx || 0);
      const rs = await c.page.evaluate(() => window.__geomResize);
      check(rs === 0, `Hoehe -${dh}px: kein window-resize noetig (Erkennung ueber die Flaeche selbst)`, 'resize-Events: ' + rs);
      check(x.projectionGeometryMismatch === false,
        `Hoehe -${dh}px: Geometrie bleibt eine einzige Quelle`, JSON.stringify(x.mismatch));
      check(x.mismatchPx < GEOM_TOL_PX,
        `Hoehe -${dh}px: kein Drift zwischen Darstellung und Picking (${x.mismatchPx.toFixed(2)} px)`,
        'Abweichung ' + x.mismatchPx);
      const hit = await pickAt(x.ball.draw.x, x.ball.draw.y);
      check(hit.idx >= 0, `Hoehe -${dh}px: Tipp auf die gezeichnete Kugel trifft sie`, JSON.stringify(hit));
    }
    check(worst < GEOM_TOL_PX, `groesste Abweichung bleibt nahe 0 px (${worst.toFixed(2)} px, nicht blosses "< 52 px")`);

    // 4) Breite und Versatz der Flaeche, ebenfalls ohne window-resize.
    await c.page.evaluate(() => { const e = document.getElementById('cv3d'); e.style.height = ''; e.style.width = '78%'; e.style.marginLeft = '48px'; });
    await sleep(700);
    const off = await diag();
    check(off.projectionGeometryMismatch === false, 'versetzte/schmalere Flaeche: Geometrie konsistent', JSON.stringify(off.mismatch));
    check(off.mismatchPx < GEOM_TOL_PX,
      `versetzte Flaeche: kein Drift (${off.mismatchPx.toFixed(2)} px)`, 'Abweichung ' + off.mismatchPx);
    const hitOff = await pickAt(off.ball.draw.x, off.ball.draw.y);
    check(hitOff.idx >= 0, 'versetzte Flaeche: Tipp auf die gezeichnete Kugel trifft sie', JSON.stringify(hitOff));

    // 5) Zuruecksetzen und klassischer window-resize-Pfad.
    await c.page.evaluate(() => { const e = document.getElementById('cv3d'); e.style.width = ''; e.style.marginLeft = ''; e.style.height = ''; });
    await sleep(700);
    const back = await diag();
    check(back.projectionGeometryMismatch === false && back.mismatchPx < GEOM_TOL_PX,
      'Ausgangsgeometrie wird wiederhergestellt', JSON.stringify(back.mismatch));
    await c.page.setViewportSize({ width: 414, height: 896 });
    await sleep(700);
    const rs2 = await diag();
    check(rs2.projectionGeometryMismatch === false && rs2.mismatchPx < GEOM_TOL_PX,
      'klassischer window-resize bleibt konsistent', JSON.stringify(rs2.mismatch));
    const hitR = await pickAt(rs2.ball.draw.x, rs2.ball.draw.y);
    check(hitR.idx >= 0, 'nach window-resize trifft der Tipp die gezeichnete Kugel', JSON.stringify(hitR));
    check(c.diag.pageErrors.length === 0, 'Geometriepfad ohne harte Console-Exception', c.diag.pageErrors.join(' | '));
  } finally {
    await c.context.close();
  }
}


// ── Fall E — WebGL-Context-Recovery (Mobile Bug 2B) ─────────────────────────
// Ein verlorener Kontext blieb frueher unbemerkt: r3dActive blieb true, der
// Zeichenpuffer fiel auf 0x0, Gameplay und Overlay liefen weiter — der Spieler
// zielte blind auf ein schwarzes Bild, und ohne preventDefault kam der Kontext
// nie zurueck. Geprueft wird gegen Produktverhalten: waehrend des Verlusts darf
// keine lokale Eingabe durchkommen und der Match-Zustand sich nicht aendern;
// nach dem Restore muss ohne Reload weitergespielt werden koennen — inklusive
// des Geometrievertrags aus Bug 2A.
//
// WEBGL_lose_context wird ausschliesslich hier im Test benutzt; der Produktcode
// kennt die Erweiterung nicht.
async function caseContextRecovery(browser, navUrl) {
  console.log('\nFall E — WebGL-Context-Recovery: Verlust sperrt, Restore stellt her');
  const c = await newClient(browser, navUrl + '?mobileDiag=1', null);
  try {
    await c.page.waitForFunction(() => !document.body.classList.contains('booting'), null, { timeout: 20000 });
    const diag = () => c.page.evaluate(() => window.__mobileDiag());
    const rec = () => c.page.evaluate(() => window.__r3dRecoveryState());
    const pickAt = (x, y) => c.page.evaluate(([a, b]) => window.__mobileDiagPick(a, b), [x, y]);
    // Der Test haelt den Extension-Handle selbst; nach dem Verlust gibt
    // getExtension() keinen neuen mehr her.
    await c.page.evaluate(() => {
      const cv3d = document.getElementById('cv3d');
      const gl = cv3d.getContext('webgl2') || cv3d.getContext('webgl');
      window.__testLose = gl && gl.getExtension('WEBGL_lose_context');
    });
    const hasExt = await c.page.evaluate(() => !!window.__testLose);
    check(hasExt, 'WEBGL_lose_context im Test verfuegbar');
    if (!hasExt) return;

    await startBotMatch(c.page);
    await sleep(900);

    // 1) Normalzustand
    const before = await diag();
    const recBefore = await rec();
    check(before.r3dActive === true && before.contextLost === false, '1 normaler 3D-Start unveraendert',
      'r3dActive=' + before.r3dActive + ' lost=' + before.contextLost);
    check(recBefore.lost === false && recBefore.inputBlocked === false && recBefore.hint === false,
      '1 kein Recovery-Zustand im Normalbetrieb', JSON.stringify(recBefore));
    check(!!recBefore.env, '1 Environment im Normalbetrieb vorhanden');
    const cfgBefore = { shadow: recBefore.shadow, toneMapping: recBefore.toneMapping,
                        colorSpace: recBefore.colorSpace, pixelRatio: recBefore.pixelRatio,
                        exposure: recBefore.exposure };
    const stateBefore = await c.page.evaluate(() => window.__mobileDiag().ball);
    if (SHOT_DIR) { fs.mkdirSync(SHOT_DIR, { recursive: true }); await c.page.screenshot({ path: path.join(SHOT_DIR, 'ctx_A_before_loss.png') }); }

    // 2) Kontextverlust
    const turnBefore = (await rec()).match;
    await c.page.evaluate(() => window.__testLose.loseContext());
    await sleep(1200);
    const lost = await diag(), recLost = await rec();
    check(lost.contextLost === true, '2 Context Loss wird erkannt', 'isContextLost=' + lost.contextLost);
    check(recLost.lost === true, '3 Recovery-Zustand gesetzt (r3dContextLost)', JSON.stringify(recLost));
    check(recLost.hint === true && /wiederhergestellt/i.test(recLost.hintText || ''),
      '3 sichtbarer Recovery-Hinweis fuer den Spieler', recLost.hintText);
    check(!!lost.buf && lost.buf.w === 0 && lost.buf.h === 0, '4 Zeichenpuffer ist 0x0', JSON.stringify(lost.buf));
    check(recLost.inputBlocked === true, '4 Eingabe zentral gesperrt statt blindem Weiterspielen', JSON.stringify(recLost.inputBlocked));

    // 5-7) Eingaben waehrend des Verlusts
    const camBefore = recLost.cam;
    await c.page.evaluate(() => document.getElementById('actBtn').click());   // Stand-Button
    await sleep(400);
    const afterStand = (await rec()).match;
    check(JSON.stringify(afterStand.aimSet) === JSON.stringify(turnBefore.aimSet) && afterStand.phase === turnBefore.phase,
      '5 Aim/Shot waehrend des Verlusts blockiert', JSON.stringify({ vor: turnBefore, nach: afterStand }));
    const armed = (await rec()).canArm;
    check(armed === false, '6 Barrier waehrend des Verlusts blockiert', 'barrierCanArm=' + armed);
    await c.page.mouse.move(200, 400); await c.page.mouse.down();
    for (let i = 1; i <= 6; i++) { await c.page.mouse.move(200 + i * 20, 400); await sleep(16); }
    await c.page.mouse.up(); await sleep(300);
    const camAfter = (await rec()).cam;
    check(JSON.stringify(camAfter) === JSON.stringify(camBefore), '7 Kamera waehrend des Verlusts blockiert',
      JSON.stringify({ vor: camBefore, nach: camAfter }));

    // 8) Match-/Netzwerkzustand unveraendert
    const turnAfterLoss = (await rec()).match;
    check(turnAfterLoss.turn === turnBefore.turn && turnAfterLoss.gen === turnBefore.gen &&
          JSON.stringify(turnAfterLoss.score) === JSON.stringify(turnBefore.score),
      '8 Match-/Game-State durch den Verlust unveraendert', JSON.stringify({ vor: turnBefore, nach: turnAfterLoss }));

    // 9-15) Restore
    await c.page.evaluate(() => window.__testLose.restoreContext());
    const okRestore = await c.page.waitForFunction(() => {
      const r = window.__r3dRecoveryState(); return r && r.lost === false && r.failed === false;
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    check(okRestore, '9 Context Restore wird erkannt und abgeschlossen');
    await sleep(600);
    const after = await diag(), recAfter = await rec();
    check(after.contextLost === false, '11 Kontext wieder gueltig', 'isContextLost=' + after.contextLost);
    check(!!after.buf && after.buf.w > 0 && after.buf.h > 0, '11 Zeichenpuffer wieder korrekt', JSON.stringify(after.buf));
    check(after.projectionGeometryMismatch === false && after.mismatchPx < 1,
      '10 Bug-2A-Geometrievertrag nach Restore weiterhin erfuellt (' + after.mismatchPx.toFixed(2) + ' px)',
      JSON.stringify(after.mismatch));
    check(recAfter.shadow.enabled === cfgBefore.shadow.enabled && recAfter.shadow.type === cfgBefore.shadow.type,
      '12/14 Shadow-Konfiguration wiederhergestellt', JSON.stringify({ vor: cfgBefore.shadow, nach: recAfter.shadow }));
    check(recAfter.toneMapping === cfgBefore.toneMapping && recAfter.colorSpace === cfgBefore.colorSpace &&
          recAfter.pixelRatio === cfgBefore.pixelRatio,
      '12 Renderer-Konfiguration wiederhergestellt (ToneMapping, ColorSpace, PixelRatio)',
      JSON.stringify({ vor: cfgBefore, nach: recAfter }));
    check(!!recAfter.env, '13 Environment/PMREM wieder vorhanden', 'env=' + recAfter.env);
    check(recAfter.envProfile === recBefore.envProfile, '13 dasselbe Environment-Profil wie vorher',
      JSON.stringify({ vor: recBefore.envProfile, nach: recAfter.envProfile }));
    check(Math.abs(recAfter.exposure - cfgBefore.exposure) < 1e-6, '13 Belichtung des Profils wieder angewandt',
      JSON.stringify({ vor: cfgBefore.exposure, nach: recAfter.exposure }));
    check(recAfter.hint === false, '9 Recovery-Hinweis wieder entfernt');
    check(!!after.ball && Math.hypot(after.ball.logical.x - stateBefore.logical.x,
                                     after.ball.logical.y - stateBefore.logical.y) < 1,
      '15 aktueller Ball-/Match-State wird korrekt dargestellt',
      JSON.stringify({ vor: stateBefore.logical, nach: after.ball && after.ball.logical }));
    if (SHOT_DIR) await c.page.screenshot({ path: path.join(SHOT_DIR, 'ctx_B_after_restore.png') });

    // 16-17) Weiterspielen ohne Reload, ohne Match-Reset
    const hit = await pickAt(after.ball.draw.x, after.ball.draw.y);
    check(hit.idx >= 0, '16 Picking nach Restore trifft die gezeichnete Kugel wieder', JSON.stringify(hit));
    const turnPre = (await rec()).match;
    check(turnPre.turn === turnBefore.turn && turnPre.gen === turnBefore.gen &&
          JSON.stringify(turnPre.score) === JSON.stringify(turnBefore.score),
      '17 kein Match-/Turn-Reset durch den Restore', JSON.stringify({ vor: turnBefore, nach: turnPre }));
    await c.page.mouse.move(after.ball.draw.x, after.ball.draw.y);
    await c.page.mouse.down();
    for (let i = 1; i <= 6; i++) { await c.page.mouse.move(after.ball.draw.x, after.ball.draw.y + i * 9); await sleep(16); }
    await c.page.mouse.up();
    await sleep(2600);
    const shot = await diag();
    check(!!shot.ball && Math.hypot(shot.ball.logical.x - after.ball.logical.x,
                                    shot.ball.logical.y - after.ball.logical.y) > 1,
      '16 Aim/Shot nach erfolgreichem Restore wieder moeglich',
      JSON.stringify({ vor: after.ball.logical, nach: shot.ball && shot.ball.logical }));
    await sleep(1500);

    // 18) Zweiter vollstaendiger Zyklus
    await c.page.evaluate(() => window.__testLose.loseContext());
    await sleep(1000);
    const lost2 = await rec();
    check(lost2.lost === true && lost2.inputBlocked === true, '18 zweiter Verlust wird ebenfalls erkannt und sperrt', JSON.stringify(lost2));
    await c.page.evaluate(() => window.__testLose.restoreContext());
    const ok2 = await c.page.waitForFunction(() => {
      const r = window.__r3dRecoveryState(); return r && r.lost === false && r.failed === false;
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    check(ok2, '18 zweiter Restore erfolgreich');
    await sleep(600);
    const after2 = await diag(), rec2 = await rec();
    check(after2.contextLost === false && after2.buf.w > 0 && !!rec2.env,
      '18 nach dem zweiten Zyklus wieder voll funktionsfaehig',
      JSON.stringify({ lost: after2.contextLost, buf: after2.buf, env: rec2.env }));
    check(after2.projectionGeometryMismatch === false && after2.mismatchPx < 1,
      '18 Geometrievertrag auch nach dem zweiten Zyklus (' + after2.mismatchPx.toFixed(2) + ' px)',
      JSON.stringify(after2.mismatch));
    const hardErrs = hardConsoleErrors(c.diag);
    check(c.diag.pageErrors.length === 0, 'Recovery ohne harte Console-Exception', c.diag.pageErrors.join(' | '));
    check(hardErrs.length === 0, 'Recovery ohne Console-Fehler', hardErrs.join(' | '));
  } finally {
    await c.context.close();
  }
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

    await caseGeometry(browser, navUrl);

    await caseContextRecovery(browser, navUrl);
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
