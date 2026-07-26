// Final-only browser smoke for the APPROVED six-segment stand.
//
// Loads tools/ring_collapse/browser_smoke/harness.html in headless Chromium
// (Playwright, same runtime the validation harnesses used), which loads ONLY
// the committed final GLB via the tracked vendored three.js r170 tree.
//
// Verdict (process exit code):
//   0  — GLB loaded, 12 expected roots present, one frame rendered,
//        0 console errors, 0 page errors, 0 external requests, GL_NO_ERROR
//   1  — any browser / load / resource / console error, missing roots,
//        or any request leaving 127.0.0.1
//
// Run:  node tools/ring_collapse/browser_smoke/run_smoke.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HARNESS = '/tools/ring_collapse/browser_smoke/harness.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript',
  '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm', '.png': 'image/png' };

// Map a request path to a file inside ROOT, or null if it escapes.
// A plain startsWith(ROOT) check is not enough: `/../Ringout_evil/x` joins to a
// *sibling* directory whose name merely begins with ROOT's name. Comparing the
// resolved relative path rejects both that and ordinary `../` traversal.
function resolveWithinRoot(urlPath) {
  const fp = path.resolve(ROOT, '.' + urlPath);
  const rel = path.relative(ROOT, fp);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
    return null;
  return fp;
}

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let p;
      try { p = decodeURIComponent(req.url.split('?')[0]); }
      catch { resp.writeHead(400); resp.end(); return; }
      const fp = resolveWithinRoot(p);
      if (!fp) { resp.writeHead(403); resp.end(); return; }
      fs.readFile(fp, (err, buf) => {
        if (err) { resp.writeHead(404); resp.end(String(err)); return; }
        resp.writeHead(200, { 'content-type':
          MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        resp.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

async function main() {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-webgl'] });
  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];
  const failedRequests = [];
  let verdictFail = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('request', r => {
      const u = new URL(r.url());
      // blob:/data: are in-page object URLs (e.g. the GLB's embedded PNG
      // textures) — only real network schemes can leave the machine.
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost')
        externalRequests.push(r.url());
    });
    page.on('requestfailed', r => failedRequests.push(r.url() + ' :: ' + (r.failure()?.errorText || '?')));

    await page.goto(`http://127.0.0.1:${port}${HARNESS}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true || window.__fatal, null,
      { timeout: 120000 });
    const fatal = await page.evaluate(() => window.__fatal || null);
    const result = await page.evaluate(() => window.__result || null);
    await page.close();

    if (fatal) verdictFail.push('fatal: ' + fatal);
    if (!result) verdictFail.push('no result object');
    if (result) {
      if (result.roots !== 12) verdictFail.push(`roots=${result.roots} (expected 12)`);
      if (result.missing_roots.length) verdictFail.push('missing roots: ' + result.missing_roots.join(', '));
      if (result.gl_error !== 0) verdictFail.push('WebGL error code ' + result.gl_error);
      console.log(`loaded final GLB: ${result.roots} roots · ${result.triangles} triangles · gl_error=${result.gl_error}`);
    }
    if (consoleErrors.length) verdictFail.push(`${consoleErrors.length} console error(s): ` + consoleErrors.join(' | '));
    if (pageErrors.length) verdictFail.push(`${pageErrors.length} page error(s): ` + pageErrors.join(' | '));
    if (failedRequests.length) verdictFail.push(`${failedRequests.length} failed request(s): ` + failedRequests.join(' | '));
    if (externalRequests.length) verdictFail.push(`${externalRequests.length} EXTERNAL request(s): ` + externalRequests.join(' | '));
  } catch (e) {
    verdictFail.push('runner error: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    srv.close();
  }
  if (verdictFail.length) {
    console.error('SMOKE FAIL:\n  - ' + verdictFail.join('\n  - '));
    process.exit(1);
  }
  console.log('SMOKE OK — final GLB loads clean: 12 roots, 1 frame rendered, '
    + '0 console/page errors, 0 external requests');
  process.exit(0);
}

if (require.main === module) main();

// Exported for path-containment tests; requiring this file starts nothing.
module.exports = { ROOT, serve, resolveWithinRoot };
