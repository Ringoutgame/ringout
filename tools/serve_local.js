// Minimaler lokaler Static-Server fuer die Live-Hoerprobe/Entwicklung —
// ohne Zusatzabhaengigkeiten (nur Node-Bordmittel), Auslieferung strikt auf
// den Projektordner begrenzt (path.relative-Containment).
//
// Aufruf:  node tools/serve_local.js [port]     (Standard: 8123)
// Danach:  http://127.0.0.1:8123/index.html
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8123;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const p = path.join(ROOT, rel);
  if (path.relative(ROOT, p).startsWith('..') || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => {
  console.log('RingOut lokal:  http://127.0.0.1:' + PORT + '/index.html');
  console.log('(Beenden: Strg+C)');
});
