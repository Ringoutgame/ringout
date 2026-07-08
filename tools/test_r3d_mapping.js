// M4-T2 (Option B): Tests fuer die pure 3D-Projektions-Mathematik aus index.html.
// - Round-Trip s2w(w2s(p)) ueber ein Punktraster (Input-Fairness)
// - P2-Kamera-Spiegelung (180-Grad-Sicht) gegen den 2D-Spiegel-Kontrakt
// - Hoehen-Lift, Massstab, Orientierung
// - 2D-Pfad von localPt byte-identisch vorhanden
//   node tools/test_r3d_mapping.js

const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(path.dirname(__dirname), 'index.html'), 'utf8');

const fnM = HTML.match(/function r3dCamMath\(p\)\{[\s\S]*?\n\}/);
if (!fnM) { console.error('FAIL: r3dCamMath nicht gefunden'); process.exit(2); }
const r3dCamMath = new Function(fnM[0] + '; return r3dCamMath;')();

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// Kamera-Parameter wie im Spiel (frame()): Ziel (500,35,500), Neigung dir~(0,19,27), Overlay zentriert
// shx/shy = Principal-Point-Shift, py = Schwebe-Bob-Ebene (beide wie im Adapter)
function makeCam(side, vw, vh, shx = 0, shy = 0, py = 0) {
  const TY = 19 / Math.hypot(19, 27), TZ = 27 / Math.hypot(19, 27);
  const tanV = Math.tan(45 * Math.PI / 360), need = 606 * 1.05, aspect = vw / vh;
  const dist = Math.max(need / (tanV * aspect), need / tanV) * 1.10;
  const os = Math.min(vw, vh) * 0.9, ox = (vw - os) / 2, oy = (vh - os) / 2;
  return r3dCamMath({ ex: 500, ey: 35 + dist * TY, ez: 500 + side * dist * TZ,
                      tx: 500, ty: 35, tz: 500, fov: 45, vw, vh, ox, oy, os, shx, shy, py });
}

for (const [vw, vh] of [[800, 600], [390, 780], [1400, 900]]) {   // Landscape, Portrait-Phone, Desktop
  const os = Math.min(vw, vh) * 0.9, ox = (vw - os) / 2, oy = (vh - os) / 2;
  const P1 = makeCam(1, vw, vh), P2 = makeCam(-1, vw, vh);

  // 1) Round-Trip: Welt -> Overlay -> Client-px -> Welt, ueber ein Raster inkl. Randnaehe
  let worst = 0;
  for (let lx = 60; lx <= 940; lx += 110) for (let ly = 60; ly <= 940; ly += 110) {
    for (const C of [P1, P2]) {
      const o = C.w2s(lx, ly, 0);
      const pxX = ox + o.x / 1000 * os, pxY = oy + o.y / 1000 * os;
      const back = C.s2w(pxX, pxY);
      worst = Math.max(worst, Math.abs(back.x - lx), Math.abs(back.y - ly));
    }
  }
  t(`[${vw}x${vh}] Round-Trip < 1e-6 (worst ${worst.toExponential(2)})`, worst < 1e-6);

  // 2) P2 = exakte 180-Grad-Sicht: w2s_P2(p) == w2s_P1(gespiegeltes p)  (Overlay zentriert)
  let mworst = 0;
  for (let lx = 100; lx <= 900; lx += 160) for (let ly = 100; ly <= 900; ly += 160) {
    const a = P2.w2s(lx, ly, 0), b = P1.w2s(1000 - lx, 1000 - ly, 0);
    mworst = Math.max(mworst, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  t(`[${vw}x${vh}] P2-Spiegelung < 1e-6 (worst ${mworst.toExponential(2)})`, mworst < 1e-6);

  // 3) Hoehen-Lift: h hebt den Punkt auf dem Schirm nach oben (kleineres y), x stabil in der Mitte
  {
    const a = P1.w2s(500, 700, 0), b = P1.w2s(500, 700, 32);
    t(`[${vw}x${vh}] Hoehe hebt nach oben`, b.y < a.y && Math.abs(b.x - a.x) < 1e-9);
  }
  // 4) Massstab s: positiv, endlich, hinten kleiner als vorn (Perspektive)
  {
    const near = P1.w2s(500, 900, 0), far = P1.w2s(500, 100, 0);
    t(`[${vw}x${vh}] s endlich/positiv, hinten kleiner`, near.s > far.s && far.s > 0 && isFinite(near.s));
  }
  // 5) Orientierung: P1 sieht ly=100 (gegneriche Seite) OBEN im Bild
  {
    const farPt = P1.w2s(500, 100, 0), nearPt = P1.w2s(500, 900, 0);
    t(`[${vw}x${vh}] Orientierung (fern=oben)`, farPt.y < nearPt.y);
  }
}

// 6) Grenzpunkt-Konsistenz: Punkt auf Simulationsgrenze (r=R) projiziert == sichtbare Torus-Position,
//    da beide exakt dieselbe Weltkoordinate nutzen -> hier: Round-Trip auf Grenzpunkten extra streng
{
  const C = makeCam(1, 800, 600), R = 485;
  let worst = 0;
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8, lx = 500 + Math.cos(a) * R, ly = 500 + Math.sin(a) * R;
    const o = C.w2s(lx, ly, 0);
    const back = C.s2w((800 - 540) / 2 + o.x / 1000 * 540, (600 - 540) / 2 + o.y / 1000 * 540);
    worst = Math.max(worst, Math.abs(back.x - lx), Math.abs(back.y - ly));
  }
  t(`Grenzpunkte (r=R) Round-Trip < 1e-6 (worst ${worst.toExponential(2)})`, worst < 1e-6);
}

// 6b) Shift + Bob (Parity-Pass): Round-Trip und P2-Spiegelung muessen mit
//     Principal-Point-Shift und angehobener Spielebene exakt bleiben
{
  const vw = 800, vh = 600, os = Math.min(vw, vh) * 0.9, ox = (vw - os) / 2, oy = (vh - os) / 2;
  for (const [shx, shy, py] of [[37, -22, 0], [0, 0, 7], [37, -22, 7], [-15, 40, -7]]) {
    const P1 = makeCam(1, vw, vh, shx, shy, py), P2 = makeCam(-1, vw, vh, shx, shy, py);
    let worst = 0, mworst = 0;
    for (let lx = 80; lx <= 920; lx += 140) for (let ly = 80; ly <= 920; ly += 140) {
      const o = P1.w2s(lx, ly, 0);
      const back = P1.s2w(ox + o.x / 1000 * os, oy + o.y / 1000 * os);
      worst = Math.max(worst, Math.abs(back.x - lx), Math.abs(back.y - ly));
      const a = P2.w2s(lx, ly, 0), b = P1.w2s(1000 - lx, 1000 - ly, 0);
      mworst = Math.max(mworst, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }
    t(`Shift(${shx},${shy})+Bob(${py}) Round-Trip < 1e-6 (worst ${worst.toExponential(2)})`, worst < 1e-6);
    t(`Shift(${shx},${shy})+Bob(${py}) P2-Spiegelung < 1e-6`, mworst < 1e-6);
  }
  // Bob hebt die ganze Ebene auf dem Schirm an (py>0 -> projizierter Punkt hoeher)
  const A = makeCam(1, vw, vh, 0, 0, 0), B = makeCam(1, vw, vh, 0, 0, 7);
  t('Bob hebt Ebene sichtbar an', B.w2s(500, 700, 0).y < A.w2s(500, 700, 0).y);
}

// 6c) Frei gedrehte Spieler-Kamera (Yaw/Polar/Zoom beliebig): Round-Trip bleibt exakt
{
  const vw = 800, vh = 600, os = 540, ox = 130, oy = 30;
  for (const [yaw, polar, dist] of [[0.7, 0.9, 1600], [-2.1, 0.35, 1250], [3.0, 1.14, 2100]]) {
    const C = r3dCamMath({ ex: 500 + dist * Math.sin(polar) * Math.sin(yaw), ey: 35 + dist * Math.cos(polar),
                           ez: 500 + dist * Math.sin(polar) * Math.cos(yaw),
                           tx: 500, ty: 35, tz: 500, fov: 45, vw, vh, ox, oy, os, shx: 20, shy: -10, py: 4 });
    let worst = 0;
    for (let lx = 100; lx <= 900; lx += 160) for (let ly = 100; ly <= 900; ly += 160) {
      const o = C.w2s(lx, ly, 0);
      const back = C.s2w(ox + o.x / 1000 * os, oy + o.y / 1000 * os);
      worst = Math.max(worst, Math.abs(back.x - lx), Math.abs(back.y - ly));
    }
    t(`freie Kamera yaw=${yaw} polar=${polar}: Round-Trip < 1e-6 (worst ${worst.toExponential(2)})`, worst < 1e-6);
  }
}

// 7) localPt: 2D-Zweig byte-identisch vorhanden (der historische Code als exakter Substring)
{
  const orig = "const r=cv.getBoundingClientRect();const sc=LOGICAL/(r.width||dispS);let x=(e.clientX-r.left)*sc,y=(e.clientY-r.top)*sc;if(online&&myPlayer===1){x=2*cx-x;y=2*cy-y;}return{x:x,y:y};";
  t('localPt 2D-Zweig byte-identisch', HTML.includes(orig));
  t('localPt 3D-Zweig gated', HTML.includes("if(r3dActive)return r3d.s2w(e.clientX,e.clientY);"));
}

// 8) #cv3d braucht explizite CSS-Groesse: setSize(...,false) setzt nur die Backing-Aufloesung
//    (xDPR); ohne width/height:100% rendert das Canvas auf DPR>1-Geraeten (Handys) groesser
//    als der Viewport -> Arena erscheint abgeschnitten (Mobile-Portrait-Framing-Bug).
{
  const cssM = HTML.match(/#cv3d\{[^}]*\}/);
  t('#cv3d CSS hat width:100% und height:100%',
    !!cssM && cssM[0].includes('width:100%') && cssM[0].includes('height:100%'));
}

console.log(`\nr3d-Mapping: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
