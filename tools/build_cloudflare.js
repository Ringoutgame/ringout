// Baut die beiden Pakete fuer die Cloudflare-Auslieferung.
//
//   node tools/build_cloudflare.js [--asset-base=https://…/]
//
// WARUM ZWEI PAKETE. Cloudflare Pages nimmt keine Einzeldatei ueber 25 MiB an. Genau eine
// Datei des Spiels liegt darueber: assets/arena_platform.glb (~36 MB). Sie geht deshalb in
// den Objektspeicher (R2), alles andere bleibt bei Pages. Der logische Pfad bleibt in
// BEIDEN Faellen derselbe - assets/arena_platform.glb -, damit der Quelltext nichts von
// der Aufteilung weiss.
//
// WIE DER CLIENT ES ERFAEHRT. index.html bekommt im Paket (nicht im Repo!) ein Meta-Tag
//
//   <meta name="ringout-asset-base" content="https://…/">
//
// Das ist die EINZIGE Stelle, die die fremde Herkunft kennt; im Produkt liest sie
// ausschliesslich assetUrl(). Ohne Basis bleibt alles relativ - dann ist das Paket ein
// ganz gewoehnliches statisches Verzeichnis.
//
// Firebase bleibt Backend: Auth und Realtime Database sind unberuehrt. Hier geht es
// ausschliesslich um die Auslieferung der statischen Dateien.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AUS = path.join(ROOT, 'artifacts', 'cloudflare');
const PAGES = path.join(AUS, 'pages');
const R2 = path.join(AUS, 'r2');
const PAGES_MAX = 25 * 1024 * 1024;   // harte Grenze von Cloudflare Pages je Datei

const arg = (n) => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : ''; };
const ASSET_BASE = (arg('asset-base') || process.env.RINGOUT_ASSET_BASE || '').trim();

// Dieselbe ausdrueckliche Liste wie die Firebase-Auslieferung: veroeffentlicht wird nur,
// was hier steht. Sie wird aus build_hosting.js gelesen, damit es GENAU EINE Liste gibt.
const HOSTING = fs.readFileSync(path.join(__dirname, 'build_hosting.js'), 'utf8');
const BLOCK = HOSTING.slice(HOSTING.indexOf('const DATEIEN = ['), HOSTING.indexOf('];', HOSTING.indexOf('const DATEIEN = [')) + 2);
const DATEIEN = new Function(BLOCK + ' return DATEIEN;')();
if (!Array.isArray(DATEIEN) || DATEIEN.length < 10) { console.error('Dateiliste nicht lesbar'); process.exit(2); }

function leeren(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} fs.mkdirSync(d, { recursive: true }); }
function kopieren(rel, ziel) {
  const q = path.join(ROOT, rel), z = path.join(ziel, rel);
  fs.mkdirSync(path.dirname(z), { recursive: true });
  fs.copyFileSync(q, z);
  return fs.statSync(q).size;
}
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

leeren(PAGES); leeren(R2);

let nPages = 0, nR2 = 0, sPages = 0, sR2 = 0;
const zuGross = [];
for (const rel of DATEIEN) {
  const q = path.join(ROOT, rel);
  if (!fs.existsSync(q)) { console.error('fehlt: ' + rel); process.exit(2); }
  const n = fs.statSync(q).size;
  if (n > PAGES_MAX) { zuGross.push({ rel, n }); sR2 += kopieren(rel, R2); nR2++; }
  else { sPages += kopieren(rel, PAGES); nPages++; }
}

// index.html im PAKET bekommt die Assetbasis - die Datei im Repo bleibt unangetastet.
if (ASSET_BASE) {
  const p = path.join(PAGES, 'index.html');
  let s = fs.readFileSync(p, 'utf8');
  if (s.indexOf('<meta name="ringout-asset-base"') >= 0) { console.error('Paket traegt bereits eine Assetbasis'); process.exit(2); }
  const marke = '<meta name="viewport"';
  const i = s.indexOf(marke);
  if (i < 0) { console.error('kein viewport-Meta gefunden - Einfuegepunkt unklar'); process.exit(2); }
  const tag = '<meta name="ringout-asset-base" content="' + ASSET_BASE + '">\n';
  s = s.slice(0, i) + tag + s.slice(i);
  fs.writeFileSync(p, s);
  sPages += tag.length;
}

// Cache-Regeln fuer Pages. index.html bleibt frisch; die Assets tragen heute noch keinen
// Inhaltsstempel im Namen - deshalb ein Tag statt "immutable".
fs.writeFileSync(path.join(PAGES, '_headers'),
  '/index.html\n' +
  '  Cache-Control: no-cache, max-age=0\n' +
  '/assets/*\n' +
  '  Cache-Control: public, max-age=86400\n');

// Kein Auslagern noetig? Dann gibt es auch kein zweites Paket - Pages traegt alles.
if (!zuGross.length) {
  try { fs.rmSync(R2, { recursive: true, force: true }); } catch (e) {}
  console.log('PAGES  ' + String(nPages).padStart(3) + ' Dateien  ' + mb(sPages) + '   -> ' + path.relative(ROOT, PAGES));
  console.log('R2       - nicht noetig: keine Datei ueber 25 MiB');
  console.log('Assetbasis im Paket: ' + (ASSET_BASE || '(keine - alles relativ)'));
  pruefeGroessen();
  pruefeVertrag([]);
  process.exit(0);
}
// Was fuer R2 gilt, steht beim Paket - nicht im Spielcode.
fs.writeFileSync(path.join(R2, 'LIESMICH.txt'),
  'R2-Paket fuer RingOut (nur LESENDER Zugriff aus dem Browser).\n\n' +
  'Inhalt: ' + zuGross.map(x => x.rel).join(', ') + '\n\n' +
  'Erwartete Objektmetadaten beim Hochladen:\n' +
  '  Content-Type:  model/gltf-binary\n' +
  '  Cache-Control: public, max-age=86400\n\n' +
  'CORS (nur GET/HEAD, nur die Playtest-Ursprünge):\n' +
  '  AllowedOrigins: https://<projekt>.pages.dev, http://127.0.0.1:*, http://localhost:*\n' +
  '  AllowedMethods: GET, HEAD\n' +
  '  AllowedHeaders: Range\n' +
  '  ExposeHeaders:  Content-Length, Content-Range\n' +
  '  MaxAgeSeconds:  86400\n\n' +
  'Der Pfad im Bucket MUSS dem logischen Pfad entsprechen:\n' +
  '  ' + zuGross.map(x => x.rel).join('\n  ') + '\n\n' +
  'Schreibrechte gehoeren NIE in den Client - das Paket wird einmalig hochgeladen.\n');

console.log('PAGES  ' + String(nPages).padStart(3) + ' Dateien  ' + mb(sPages) + '   -> ' + path.relative(ROOT, PAGES));
console.log('R2     ' + String(nR2).padStart(3) + ' Dateien  ' + mb(sR2) + '   -> ' + path.relative(ROOT, R2));
for (const x of zuGross) console.log('   ueber der Pages-Grenze: ' + x.rel + '  ' + mb(x.n));
console.log('Assetbasis im Paket: ' + (ASSET_BASE || '(keine - alles relativ)'));
// Sicherheitsnetz: nach dem Bau darf in PAGES keine Datei ueber der Grenze liegen.
pruefeGroessen();
function pruefeGroessen(){ (function pruefe(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { pruefe(p); continue; }
    const n = fs.statSync(p).size;
    if (n > PAGES_MAX) { console.error('ZU GROSS fuer Pages: ' + path.relative(PAGES, p) + ' ' + mb(n)); process.exit(2); }
  }
})(PAGES);
console.log('geprueft: keine Datei im Pages-Paket ueber 25 MiB'); }

// Der Vertrag zwischen Paket und Client: was hier nach R2 geht, MUSS im Produkt in
// ASSET_EXTERN stehen - und umgekehrt. Ohne diese Pruefung koennte das Paket eine Datei
// auslagern, die der Client weiterhin bei der Seite sucht (oder umgekehrt): 404 und eine
// tote Szene, erst beim Spielen sichtbar.
pruefeVertrag(zuGross.map(x => x.rel));
function pruefeVertrag(nachR2roh) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const ASSET_EXTERN=\[([^\]]*)\];/);
  if (!m) { console.error('ASSET_EXTERN im Produkt nicht gefunden'); process.exit(2); }
  const extern = (m[1].match(/'[^']+'/g) || []).map(x => x.slice(1, -1)).sort();
  const nachR2 = nachR2roh.slice().sort();
  if (JSON.stringify(extern) !== JSON.stringify(nachR2)) {
    console.error('Paket und Produkt sind sich uneinig:');
    console.error('  Produkt (ASSET_EXTERN): ' + JSON.stringify(extern));
    console.error('  Paket   (nach R2):      ' + JSON.stringify(nachR2));
    process.exit(2);
  }
  console.log('geprueft: ASSET_EXTERN im Produkt deckt sich mit dem R2-Paket');
}
