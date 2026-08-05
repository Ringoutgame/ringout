// Arena-Football-Integrations-Shell — Regressionsnetz für den neuen mode==='football'.
//
// Extrahiert die ECHTEN Funktionen aus index.html (wie die bestehenden Golden-/
// Lockstep-Suiten) und prüft die Shell-Invarianten:
//   - Registrierung (MODE_ORDER / MENU_SEL / Karte / CTA-Texte),
//   - genau drei Kugeln (Blau links, Rot rechts, neutraler Ball mittig, owner 4),
//   - normaler 1v1-Aufbau unverändert (2 Kugeln),
//   - neutraler Ball ist nicht auswählbar (pickOwnBall filtert owner===who),
//   - Football: geschlossene runde Bande statt Ring-Out (Reflexion, keine Elimination),
//   - normale Modi behalten Ring-Out (mode='bot' eliminiert außerhalb liegende Kugeln).
// Nur lesend auf index.html.

const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(re, name) {
  const m = HTML.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
}

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }

// ── Registrierung: reine Rohtext-Prüfungen ──
ok(/const MODE_ORDER=\[[^\]]*'football'[^\]]*\]/.test(HTML), "MODE_ORDER enthält 'football'");
ok(/football:\{card:'cardFootball'/.test(HTML), 'MENU_SEL hat einen football-Eintrag');
ok(/id="cardFootball"/.test(HTML), 'Menükarte cardFootball existiert');
ok(/ctaFootball:'[^']+'/.test(HTML) && /infoFootball:'[^']+'/.test(HTML), 'CTA-/Info-Texte für football vorhanden');
ok(/menuSel==='football'/.test(HTML), 'CTA-Handler verzweigt auf football');

// ── Klick-/Auswahl-Pfad: jede Moduskarte MUSS ihre Einzel-Click-Bindung auf selectMenuMode haben.
//    (Genau dieser Listener fehlte fuer cardFootball -> Klick wirkungslos.) ──
ok(/\$\('cardFootball'\)\.onclick=\(\)=>selectMenuMode\('football'\)/.test(HTML), "cardFootball hat einen Click-Listener -> selectMenuMode('football')");
ok(/\$\('cardBot'\)\.onclick=\(\)=>selectMenuMode\('bot'\)/.test(HTML), 'cardBot bleibt auswaehlbar');
ok(/ctaFootball:'START ARENA FOOTBALL 1V1'/.test(HTML), "CTA-Text football = 'START ARENA FOOTBALL 1V1'");
// Strukturell: KEIN MENU_SEL-Kartenmodus ohne echten Auswahl-Pfad (schuetzt football + alle Karten).
const menuSelBlock = grab(/const MENU_SEL=\{[\s\S]*?\n\};/, 'MENU_SEL block');
const cardByMode = {};
let mm; const menuSelEntryRe = /(\w+):\{card:'([^']+)'/g;
while ((mm = menuSelEntryRe.exec(menuSelBlock)) !== null) cardByMode[mm[1]] = mm[2];
ok(Object.keys(cardByMode).length >= 6, 'MENU_SEL enthaelt alle Moduskarten inkl. football (' + Object.keys(cardByMode).length + ')');
for (const [modeKey, cardId] of Object.entries(cardByMode)) {
  const re = new RegExp("\\$\\('" + cardId + "'\\)\\.onclick=\\(\\)=>selectMenuMode\\('" + modeKey + "'\\)");
  ok(re.test(HTML), 'Karte ' + cardId + " besitzt den Auswahl-Pfad selectMenuMode('" + modeKey + "')");
}

// ── Physik-/Setup-Env: die echten Funktionen, mode parametrisierbar ──
const consts = grab(/const MAXPULL_FRAC=[^\n]*/, 'physics constants');
const spin = grab(/const SPIN_K=[^\n]*/, 'spin constants');
const pcols = grab(/const PCOLS=[^\n]*/, 'PCOLS');
const mkBallSrc = grab(/function mkBall\([^\n]*/, 'mkBall');
const placeBallsSrc = grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls');
const teamCapSrc = grab(/function teamCap\([^\n]*/, 'teamCap');
const pickOwnBallSrc = grab(/function pickOwnBall\([^\n]*/, 'pickOwnBall');
const ballsOutsideSrc = grab(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');
const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');

function buildEnv(startMode, startFmt) {
  const env = `
    const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;
    ${consts}
    ${spin}
    ${pcols}
    function curFR(){return FRICTION;} function curFE(){return FEND;} function curST(){return STOPV;}
    function maxPull(){return R0*MAXPULL_FRAC;}
    let balls=[], phase='sim', outBall=-1, roundWinner=-1;
    let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];
    let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false;
    let mode=${JSON.stringify(startMode)}, fmt=${JSON.stringify(startFmt)};
    const SFX={hit(){},drop(){},ringout(){},launch(){},round(){},win(){},rollUpdate(){},unlock(){}};
    function spawn(){} function popBall(){} function winnerRGB(){return '';}
    let r3dActive=false; function fx3Hit(){} function fx3Dust(){}
    function setPhase(p){phase=p;} function updateHud(){} function setPhaseText(){}
    function onlineArmTurn(){} function openCover(){}
    function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
    ${mkBallSrc}
    ${teamCapSrc}
    ${placeBallsSrc}
    ${pickOwnBallSrc}
    ${ballsOutsideSrc}
    ${resolveRingOutsSrc}
    ${stepSimSrc}
    return {
      cx, cy, R0, BR,
      place(){ placeBalls(); return balls.map(b=>({x:b.x,y:b.y,owner:b.owner,alive:b.alive})); },
      pick(who,p){ return pickOwnBall(who,p); },
      setBalls(list){ balls=list.map(b=>({x:b.x,y:b.y,vx:b.vx||0,vy:b.vy||0,sx:b.x,sy:b.y,owner:b.owner,alive:true,spin:0})); phase='sim'; outBall=-1; },
      step(){ stepSim(); },
      get(){ return { phase, balls: balls.map(b=>({x:b.x,y:b.y,alive:b.alive,owner:b.owner})) }; }
    };
  `;
  return new Function(env)();
}

// ── Football-Setup: genau drei Kugeln, symmetrisch ──
const F = buildEnv('football', 'single');
const fb = F.place();
ok(fb.length === 3, 'Football stellt genau drei Kugeln auf (erhalten: ' + fb.length + ')');
ok(JSON.stringify(fb.map(b => b.owner)) === JSON.stringify([0, 1, 4]), 'Football-Owner sind [0,1,4] (Blau/Rot/neutral)');
const blue = fb.find(b => b.owner === 0), red = fb.find(b => b.owner === 1), neutral = fb.find(b => b.owner === 4);
ok(blue && blue.x < F.cx, 'Blau startet links (x<cx)');
ok(red && red.x > F.cx, 'Rot startet rechts (x>cx)');
ok(neutral && neutral.x === F.cx && neutral.y === F.cy, 'neutraler Ball startet mittig');

// ── neutraler Ball ist nicht auswählbar ──
F.setBalls(fb.map(b => ({ x: b.x, y: b.y, owner: b.owner })));
const pickBlueAtNeutral = F.pick(0, { x: F.cx, y: F.cy });   // Pointer auf dem neutralen Ball, Spieler Blau
ok(pickBlueAtNeutral < 0 || fb[pickBlueAtNeutral].owner !== 4, 'Blau kann den neutralen Ball nicht wählen');
const pickRedAtNeutral = F.pick(1, { x: F.cx, y: F.cy });
ok(pickRedAtNeutral < 0 || fb[pickRedAtNeutral].owner !== 4, 'Rot kann den neutralen Ball nicht wählen');
const pickOwnBlue = F.pick(0, { x: blue.x, y: blue.y });     // Pointer auf der eigenen Kugel
ok(pickOwnBlue >= 0 && fb[pickOwnBlue].owner === 0, 'Blau kann die eigene Kugel wählen');

// ── Football: geschlossene runde Bande statt Ring-Out ──
F.setBalls([{ x: F.cx, y: F.cy + (F.R0 * 0.98), vx: 0, vy: 6, owner: 0 }, { x: F.cx, y: F.cy, owner: 4 }]);
for (let i = 0; i < 40; i++) F.step();
const fAfter = F.get();
const fDist = Math.hypot(fAfter.balls[0].x - F.cx, fAfter.balls[0].y - F.cy);
ok(fDist <= F.R0 + 1e-6, 'Football hält die Kugel innerhalb der Bande (dist ' + fDist.toFixed(2) + ' <= R ' + F.R0 + ')');
ok(fAfter.balls.every(b => b.alive), 'Football eliminiert keine Kugel (kein Ring-Out)');

// ── normale Modi unverändert: 1v1 hat zwei Kugeln, Ring-Out bleibt aktiv ──
const B = buildEnv('bot', 'single');
const bb = B.place();
ok(bb.length === 2 && JSON.stringify(bb.map(b => b.owner)) === JSON.stringify([0, 1]), 'Normaler 1v1-Aufbau unverändert (2 Kugeln [0,1])');
B.setBalls([{ x: B.cx, y: B.cy + (B.R0 * 1.2), vx: 0, vy: 4, owner: 1 }, { x: B.cx, y: B.cy, vx: 0, vy: 0, owner: 0 }]);
let ended = false;
for (let i = 0; i < 40 && !ended; i++) { B.step(); if (B.get().phase !== 'sim') ended = true; }
const bAfter = B.get();
ok(bAfter.phase === 'result' || bAfter.balls.some(b => !b.alive), 'Normaler Modus behält Ring-Out (außenliegende Kugel wird ausgewertet)');

// ════════════════════════════════════════════════════════════════════════════
// Arena-Football — VISUELLE Torintegration (GLB-Asset + zwei Instanzen)
// Reiner Export + Renderer-Einbindung; keine Physik/Gameplay/Bande. Prueft das
// exportierte GLB maschinell und die Einbindung in die echte RingOut-Szene.
// ════════════════════════════════════════════════════════════════════════════

// ── GLB maschinell parsen (dependency-frei: JSON-Chunk des glTF-Binary) ──
const GLB_PATH = path.join(__dirname, '..', 'assets', 'arena_football_goal_curved.glb');
ok(fs.existsSync(GLB_PATH), 'GLB-Datei assets/arena_football_goal_curved.glb vorhanden');
let glb = null;
if (fs.existsSync(GLB_PATH)) {
  const buf = fs.readFileSync(GLB_PATH);
  ok(buf.readUInt32LE(0) === 0x46546C67, 'GLB-Magic korrekt (glTF)');
  const total = buf.readUInt32LE(8);
  let off = 12, json = null;
  while (off < total) {
    const clen = buf.readUInt32LE(off), ctype = buf.readUInt32LE(off + 4);
    if (ctype === 0x4E4F534A) json = JSON.parse(buf.slice(off + 8, off + 8 + clen).toString('utf8'));
    off += 8 + clen;
  }
  glb = json;
}
if (glb) {
  const nodeNames = (glb.nodes || []).map(n => n.name);
  const meshNames = (glb.meshes || []).map(m => m.name);
  const matNames = (glb.materials || []).map(m => m.name);
  const rootIdx = (glb.scenes && glb.scenes[glb.scene || 0]) ? glb.scenes[glb.scene || 0].nodes : [];
  const rootNames = rootIdx.map(i => nodeNames[i]);
  const lights = (glb.extensions && glb.extensions.KHR_lights_punctual && glb.extensions.KHR_lights_punctual.lights) || [];
  // Genau EIN Tor-Asset: genau ein Root-Node, und der heisst AF_Goal.
  ok(rootNames.length === 1 && rootNames[0] === 'AF_Goal', 'GLB hat genau EIN Tor (Root-Node AF_Goal) — keine zweite Instanz');
  ok(nodeNames.length > 0 && nodeNames.every(n => n && n.startsWith('AF_Goal')), 'GLB enthaelt ausschliesslich AF_Goal*-Objekte');
  ok(!nodeNames.some(n => /Preview|Rim|Floor|prof/i.test(n)), 'GLB enthaelt keine Preview-/Profil-Objekte');
  ok((glb.cameras || []).length === 0, 'GLB enthaelt keine Kamera');
  ok(lights.length === 0 && !(glb.extensionsUsed || []).includes('KHR_lights_punctual'), 'GLB enthaelt keine Lichter');
  ok(matNames.includes('AF_Goal_Marble'), 'GLB enthaelt das Marmor-Material (AF_Goal_Marble)');
  ok(matNames.includes('AF_Goal_Gold'), 'GLB enthaelt das Gold-Material (AF_Goal_Gold)');
  ok(matNames.length === 2, 'GLB hat genau die zwei Tor-Materialien (erhalten: ' + matNames.length + ')');
  ok(meshNames.length === 9, 'GLB hat die neun Tor-Meshes (7 Basis + 2 rueckseitige Gold-Keylines; erhalten: ' + meshNames.length + ')');
  ok(!(glb.extensionsUsed || []).includes('KHR_draco_mesh_compression'), 'GLB nutzt keine Draco-Kompression');
  // Bounding-Box aus den POSITION-Accessoren (lokale Blender-Einheiten): Breite plausibel (~5.2, lichte Weite 4.0).
  let minX = Infinity, maxX = -Infinity;
  for (const m of (glb.meshes || [])) for (const p of m.primitives) {
    const a = glb.accessors[p.attributes.POSITION];
    if (a && a.min && a.max) { minX = Math.min(minX, a.min[0]); maxX = Math.max(maxX, a.max[0]); }
  }
  ok(maxX - minX > 4.0 && maxX - minX < 7.0, 'GLB-Bounding-Box plausibel (Breite ' + (maxX - minX).toFixed(2) + ' Blender-Einheiten)');
}

// ── Renderer-Einbindung: statische Pruefung des echten initR3D-Codes in index.html ──
// Genau EIN Ladevorgang fuer das Tor-GLB (kein Mehrfach-Laden/Duplizieren).
ok(/\.load\('assets\/arena_football_goal_curved\.glb'/.test(HTML), 'Loader-Pfad ist assets/arena_football_goal_curved.glb (gebogenes Tor)');
const loadCount = (HTML.match(/\.load\('assets\/arena_football_goal_curved\.glb'/g) || []).length;
ok(loadCount === 1, "Tor-GLB wird genau EINMAL geladen (erhalten: " + loadCount + ')');
// Zweite Instanz ist ein Clone desselben geladenen Assets (geteilte Geometrie/Materialien).
ok(/goalProto\.clone\(true\)/.test(HTML), 'Zweite Torinstanz nutzt einen Clone desselben Assets (kein zweiter Load)');
// Genau zwei Instanzen: mkGoal(1) UND mkGoal(-1).
ok(/goalPlus=mkGoal\(1\)/.test(HTML) && /goalMinus=mkGoal\(-1\)/.test(HTML), 'Genau zwei Torinstanzen im Football-Modus (+X und -X)');
// Positionen bei +X und -X (symmetrisch, radial ueber GLB_R -> Weltradius R).
ok(/g\.position\.set\(sign\*GOAL_R,\s*GOAL_WALK_Y,\s*0\)/.test(HTML), 'Torpositionen symmetrisch bei sign*GOAL_R (+X / -X, nach innen auf den Walkway versetzt)');
// Rotationsdifferenz exakt PI: rotation.y = -sign*PI/2 -> (+PI/2) vs (-PI/2), Differenz = PI.
ok(/g\.rotation\.set\(0,\s*-sign\*Math\.PI\/2,\s*0\)/.test(HTML), 'Rotationsdifferenz beider Tore exakt PI (radial zur Mitte)');
// Gleiche Skalierung: EIN goalScale fuer beide, aus BR/GLB_R/R0 abgeleitet (keine Magic-Number).
ok(/const goalScale=\(2\*BR\)\*GLB_R\/R0/.test(HTML), 'Tor-Skalierung aus 2*BR*GLB_R/R0 abgeleitet (keine eigenstaendige Torbreiten-Magic-Number)');
// Numerischer Nachweis: lichte Breite = 4 Balldurchmesser = 4*2*BR = 256 LOGICAL.
{ const LOGICAL = 1000, BR = LOGICAL * 0.032, GLB_R = 10.1, R0 = LOGICAL * 0.485;
  const goalScale = (2 * BR) * GLB_R / R0, sc0 = R0 / GLB_R;
  const clearLogical = 4.0 * goalScale * sc0;   // 4 Blender-Einheiten lichte Weite -> Welt-LOGICAL
  ok(Math.abs(clearLogical - 4 * (2 * BR)) < 1e-6, 'Abgeleitete lichte Torbreite = 4*2*BR = ' + (4 * 2 * BR) + ' LOGICAL (4 Balldurchmesser)'); }
// Sichtbarkeit NUR bei mode==='football' (und nicht im Menue-Preview) — gemeinsames footballView-Gate.
ok(/const footballView=\(mode==='football'\)&&!menuVisible/.test(HTML), "Tore nur sichtbar bei mode==='football' (nicht Menue/normale Modi)");
ok(/goalGroup\.visible=footballView/.test(HTML), 'Tor-Sichtbarkeit haengt am football-scoped footballView-Gate');
// Skaliert + schwebt mit der Plattform (gleiches sc/bob wie bGroup) — gleiches lokales System.
ok(/goalGroup\.scale\.setScalar\(sc\)/.test(HTML) && /goalGroup=new THREE\.Group\(\);goalGroup\.position\.set\(cx,0,cy\)/.test(HTML),
  'Tore liegen im lokalen Arena-System (Gruppe bei (cx,0,cy), mit sc skaliert)');
// Wiederverwendung der bestehenden Szene/Renderer: kein neuer WebGLRenderer/Scene/Camera fuer Tore.
ok((HTML.match(/new THREE\.WebGLRenderer/g) || []).length === 1, 'Kein zusaetzlicher Renderer fuer die Tore (bestehende Szene wiederverwendet)');
// BANDE UNVERAENDERT: der bestehende Grenz-Torus (Out-Kante) und die Warnzone sind unangetastet.
ok(/new THREE\.TorusGeometry\(GLB_R,\.075,12,176\)/.test(HTML), 'RingOut-Bande (Grenz-Torus an GLB_R) unveraendert');
ok(/new THREE\.RingGeometry\(9\.55,10\.05,128\)/.test(HTML), 'RingOut-Warnzone unveraendert');

// ════════════════════════════════════════════════════════════════════════════
// Arena-Football — BANDEN-ASSET (freigegebene transparente Blender-Bande, GLB)
// Ersetzt die fruehere prozedurale Bogen-/Luecken-Loesung vollstaendig. Reiner
// Export + Renderer-Einbindung; keine Physik/Kollision/Gameplay. GLB maschinell geprueft.
// ════════════════════════════════════════════════════════════════════════════

// ── Band-GLB maschinell parsen (dependency-frei: JSON-Chunk des glTF-Binary) ──
const BAND_PATH = path.join(__dirname, '..', 'assets', 'arena_football_band.glb');
ok(fs.existsSync(BAND_PATH), 'Band-GLB assets/arena_football_band.glb vorhanden');
let band = null;
if (fs.existsSync(BAND_PATH)) {
  const buf = fs.readFileSync(BAND_PATH);
  ok(buf.readUInt32LE(0) === 0x46546C67, 'Band-GLB-Magic korrekt (glTF)');
  const total = buf.readUInt32LE(8);
  let off = 12, json = null;
  while (off < total) {
    const clen = buf.readUInt32LE(off), ctype = buf.readUInt32LE(off + 4);
    if (ctype === 0x4E4F534A) json = JSON.parse(buf.slice(off + 8, off + 8 + clen).toString('utf8'));
    off += 8 + clen;
  }
  band = json;
}
if (band) {
  const nodeNames = (band.nodes || []).map(n => n.name);
  const matNames = (band.materials || []).map(m => m.name);
  const rootIdx = (band.scenes && band.scenes[band.scene || 0]) ? band.scenes[band.scene || 0].nodes : [];
  const rootNames = rootIdx.map(i => nodeNames[i]);
  const lights = (band.extensions && band.extensions.KHR_lights_punctual && band.extensions.KHR_lights_punctual.lights) || [];
  // Genau EIN Banden-Asset: genau ein Root-Node AF_Band_Root.
  ok(rootNames.length === 1 && rootNames[0] === 'AF_Band_Root', 'Band-GLB hat genau EINEN Root-Node AF_Band_Root — keine zweite Bandeninstanz');
  ok(nodeNames.length > 0 && nodeNames.every(n => n && n.startsWith('AF_Band')), 'Band-GLB enthaelt ausschliesslich AF_Band*-Objekte');
  // Keine importierte Arena / keine Tore / keine Crystal*/Ped*-Nodes / keine Profil-/Preview-Objekte.
  ok(!nodeNames.some(n => /ArenaImport|Pillar|Walkway|Tier|Temple|PlayFloor|WallRing|Cornice/i.test(n)), 'Band-GLB enthaelt keine importierte RingOut-Arena');
  ok(!nodeNames.some(n => /Goal/i.test(n)), 'Band-GLB enthaelt keine Tore');
  ok(!nodeNames.some(n => /Crystal/i.test(n)), 'Band-GLB enthaelt keine Crystal*-Objekte');
  ok(!nodeNames.some(n => /^Ped/i.test(n)), 'Band-GLB enthaelt keine Ped*-Objekte');
  ok(!nodeNames.some(n => /Preview|Floor|prof/i.test(n)), 'Band-GLB enthaelt keine Preview-/Profil-Objekte');
  ok((band.cameras || []).length === 0, 'Band-GLB enthaelt keine Kamera');
  ok(lights.length === 0 && !(band.extensionsUsed || []).includes('KHR_lights_punctual'), 'Band-GLB enthaelt keine Lichter');
  ok(matNames.includes('AF_Band_Glass'), 'Band-GLB enthaelt das Glas-Material (AF_Band_Glass)');
  ok(matNames.includes('AF_Band_Gold'), 'Band-GLB enthaelt das Gold-Material (AF_Band_Gold)');
  ok(matNames.includes('AF_Band_Marble'), 'Band-GLB enthaelt das Marmor-Material (AF_Band_Marble)');
  ok(matNames.length === 3, 'Band-GLB hat genau drei Banden-Materialien (Glas/Gold/Marmor, erhalten: ' + matNames.length + ')');
  ok(!(band.extensionsUsed || []).includes('KHR_draco_mesh_compression'), 'Band-GLB nutzt keine Draco-Kompression');
  // ── Zwei Toroeffnungen bei +X/-X sind Bestandteil der Geometrie ──
  // Genau zwei Glas-Boegen (AF_Band_Glass_0/_1) — je einer zwischen den beiden Oeffnungen.
  const glassCount = nodeNames.filter(n => /^AF_Band_Glass_/.test(n)).length;
  ok(glassCount === 2, 'Band-GLB hat genau zwei Glas-Boegen (zwei Segmente -> zwei Oeffnungen), erhalten: ' + glassCount);
  // Vier Endpfosten markieren die vier Oeffnungsraender (zwei je Oeffnung).
  const endcaps = (band.nodes || []).filter(n => /^AF_Band_EndCap_\d_[AB]$/.test(n.name) && n.translation);
  ok(endcaps.length === 4, 'Band-GLB hat vier Endpfosten an den Oeffnungsraendern (zwei je Oeffnung), erhalten: ' + endcaps.length);
  // Kein Endpfosten liegt in der Oeffnungsmitte (glTF-Z ~ tangential): bei +X (0) und -X (PI) ist die Luecke frei.
  const onAxis = endcaps.filter(n => Math.abs(n.translation[2]) < 0.5);
  ok(onAxis.length === 0, 'Kein Endpfosten in der Oeffnungsmitte (+X/-X) — die zwei Oeffnungen sind frei');
  // ── Radius/Hoehe plausibel: Bande liegt auf dem Arena-Walkway (~R=9.5), Basis nahe Walkway-Oberkante ──
  // Radius exakt aus den punktplatzierten Post-/EndCap-Nodes (Node-Translation, glTF X/Z-Ebene).
  const pts = (band.nodes || []).filter(n => /^AF_Band_(Post|EndCap)_\d/.test(n.name) && n.translation);
  let rmax = 0, rmin = Infinity;
  for (const n of pts) { const r = Math.hypot(n.translation[0], n.translation[2]); rmax = Math.max(rmax, r); rmin = Math.min(rmin, r); }
  ok(rmax > 8.5 && rmax < 11.0 && rmin > 8.5, 'Band-Radius plausibel auf dem Walkway (~9.5 GLB-Einheiten; min ' + rmin.toFixed(2) + ' / max ' + rmax.toFixed(2) + ')');
  // Hoehe: glTF-Y ueber alle Mesh-Nodes (Node-Translation + Accessor-Y-Bereich).
  let minY = Infinity, maxY = -Infinity;
  for (const nd of (band.nodes || [])) {
    if (nd.mesh == null) continue;
    const ty = (nd.translation || [0, 0, 0])[1];
    for (const p of band.meshes[nd.mesh].primitives) {
      const a = band.accessors[p.attributes.POSITION];
      if (a && a.min && a.max) { minY = Math.min(minY, ty + a.min[1]); maxY = Math.max(maxY, ty + a.max[1]); }
    }
  }
  ok(minY < 0.5 && maxY > 1.0 && (maxY - minY) < 2.5, 'Band-Hoehe plausibel: Basis nahe Walkway (' + minY.toFixed(2) + '), Barriere bis ' + maxY.toFixed(2) + ' GLB-Einheiten');
}

// ════════════════════════════════════════════════════════════════════════════
// Arena-Football — BANDEN-INTEGRATION (Renderer-Einbindung in initR3D)
// Statische Pruefung des echten index.html-Codes.
// ════════════════════════════════════════════════════════════════════════════

// ── Genau EIN Band-GLB-Load (kein Mehrfach-Laden/Duplizieren) ──
const bandLoadCount = (HTML.match(/\.load\('assets\/arena_football_band\.glb'/g) || []).length;
ok(bandLoadCount === 1, 'Band-GLB wird genau EINMAL geladen (erhalten: ' + bandLoadCount + ')');
// ── Genau EINE Bandeninstanz ──
const bandInstCount = (HTML.match(/bandGroup=new THREE\.Group\(\)/g) || []).length;
ok(bandInstCount === 1, 'Genau eine Bandeninstanz (bandGroup) wird erzeugt (erhalten: ' + bandInstCount + ')');
// ── Bande liegt im selben Arena-Lokalraum wie bGroup (erbt sc/bob) — keine eigene Skalierungs-Magic-Number ──
ok(/bGroup\.add\(bandGroup\)/.test(HTML), 'Bande haengt als Kind an bGroup (identischer Arena-Lokalraum, erbt sc/bob)');
ok(!/bandGroup\.scale\.setScalar/.test(HTML), 'Keine eigene Banden-Skalierung (kein bandGroup.scale) — Skalierung wird von bGroup geerbt (keine Magic-Number)');
ok(!/bandGroup\.position\.set/.test(HTML), 'Keine separate World-Space-Positionierung der Bande (Position von bGroup geerbt)');
// ── Additiv gekapselt: fehlt/streikt das GLB, bleibt die Arena unveraendert ──
ok(/\}catch\(_\)\{bandGroup=null;\}/.test(HTML), 'Band-GLB-Load ist in try/catch gekapselt (additiv, bricht initR3D nicht ab)');
// ── Mode-Scoping: footballView steuert bandGroup.visible ──
ok(/const footballView=\(mode==='football'\)&&!menuVisible/.test(HTML), "Football-Ansicht nur bei mode==='football' && !menuVisible");
ok(/if\(bandGroup\)bandGroup\.visible=footballView/.test(HTML), 'bandGroup.visible haengt am football-scoped footballView-Gate');
// ── Vollkreis-Sichtringe: im Football-Modus AUS, in normalen Modi AN ──
ok(/boundaryFull=\[zone,main,g\]/.test(HTML), 'boundaryFull haelt die drei Vollkreis-Sichtringe (Warnzone/Leuchtring/Goldring)');
ok(/if\(boundaryFull\)for\(const bm of boundaryFull\)bm\.visible=!footballView/.test(HTML), 'Vollkreis-Sichtringe nur in normalen Modi sichtbar (im Football-Modus aus)');
// ── KEIN prozeduraler Arc-/Luecken-Code mehr (alte Bandenloesung vollstaendig entfernt) ──
ok(!/footballBoundaryGroup/.test(HTML), 'Kein footballBoundaryGroup mehr (prozedurale Bande entfernt)');
ok(!/arcTorus/.test(HTML) && !/arcRing/.test(HTML), 'Keine arcTorus/arcRing-Helfer mehr (prozedurale Bande entfernt)');
ok(!/GOAL_TOTAL_WIDTH_BLENDER/.test(HTML) && !/GOAL_BOUNDARY_CLEARANCE/.test(HTML), 'Keine prozeduralen Oeffnungs-Konstanten mehr (GOAL_TOTAL_WIDTH_BLENDER/GOAL_BOUNDARY_CLEARANCE entfernt)');
ok(!/for\(const s of \[d,Math\.PI\+d\]\)/.test(HTML), 'Keine Zwei-Luecken-Bogenschleife mehr (prozedurale Segmentierung entfernt)');

// ── Drei originale Vollkreis-Sichtringe unveraendert vorhanden ──
ok(/new THREE\.TorusGeometry\(GLB_R,\.075,12,176\)/.test(HTML), '360-Grad Leuchtring-Vollkreis unveraendert (normale Modi)');
ok(/new THREE\.RingGeometry\(9\.55,10\.05,128\)/.test(HTML), '360-Grad Warnzonen-Vollkreis unveraendert (normale Modi)');
ok(/new THREE\.TorusGeometry\(9\.5,\.02,10,160\)/.test(HTML), '360-Grad Goldring-Vollkreis unveraendert (normale Modi)');
ok(/mainBMat=mainMat/.test(HTML), 'Grenz-Puls-Material (mainBMat) unveraendert an mainMat gebunden');

// ── Kollisions-/Physik-Bande unveraendert geschlossen (radiale Reflexion in stepSim) ──
ok(/const off=R\*0\.42/.test(HTML), 'Football-Spawn (stepSim/Setup) unveraendert');
ok(/flim=R-BR[\s\S]*fb\.vx-=\(1\+REST\)\*fvn\*fnx/.test(HTML), 'Radiale Kollisions-Reflexion (flim=R-BR) unveraendert — Bande physikalisch weiter geschlossen');

// ── Keine neue Szene/Kamera/Renderer (bestehende Infrastruktur wiederverwendet) ──
ok((HTML.match(/new THREE\.Scene\(\)/g) || []).length === 1, 'Genau eine Szene (keine zweite Arena/Szene)');
ok((HTML.match(/new THREE\.PerspectiveCamera/g) || []).length === 1, 'Genau eine Kamera (keine neue Kamera)');
ok((HTML.match(/new THREE\.WebGLRenderer/g) || []).length === 1, 'Genau ein Renderer (bestehende Szene wiederverwendet)');

// ── HUD-Hinweis aktualisiert ──
ok(!/Tore folgen im nächsten Schritt/.test(HTML), "HUD-Hinweis enthaelt nicht mehr 'Tore folgen im naechsten Schritt'");
ok(/Arena Football · Visuelle Integration/.test(HTML), "HUD-Hinweis aktualisiert auf 'Arena Football · Visuelle Integration'");

// ── Tor-Integration: Asset & Kernskalierung/Rotation unveraendert (nur Radialposition korrigiert) ──
ok(/g\.position\.set\(sign\*GOAL_R,\s*GOAL_WALK_Y,\s*0\)/.test(HTML), 'Torpositionen radial auf GOAL_R (nach innen versetzt)');
ok(/g\.rotation\.set\(0,\s*-sign\*Math\.PI\/2,\s*0\)/.test(HTML), 'Torrotationen (-sign*PI/2, Differenz PI) unveraendert');
ok(/g\.scale\.setScalar\(goalScale\)/.test(HTML), 'Torskalierung (goalScale) unveraendert');
// ── Tor-Load bleibt gekapselt; initR3D-Fehler weiterhin protokolliert ──
ok(/\}catch\(_\)\{goalGroup=null;\}/.test(HTML), 'Tor-GLB-Load bleibt in try/catch gekapselt (additiv)');
ok(/console\.error\('INITR3D_FAIL'/.test(HTML), 'initR3D-Fehler wird weiterhin protokolliert (kein stiller Abbruch)');

// ════════════════════════════════════════════════════════════════════════════
// Arena-Football — KORREKTURRUNDE (1) Tor-Platzierung  (2) Banden-/Glas-Qualitaet
// Rein visuelle Feinkorrektur; keine Physik/Kollision/Gameplay/Score.
// ════════════════════════════════════════════════════════════════════════════

// (1) Tore sitzen KONZENTRISCH am RUNDEN Arenarand. Das gebogene Tor wurde in Blender um seinen
//     Kruemmungsradius GOAL_CURVE_R (Balldurchmesser) gewickelt; GOAL_R = GOAL_CURVE_R*goalScale legt
//     das Kruemmungszentrum GENAU auf das Arenazentrum -> jede Radialschicht ist ein konzentrischer Bogen.
ok(/const GOAL_CURVE_R=6\.95;/.test(HTML), 'GOAL_CURVE_R=6.95 zentral definiert (Blender-Kruemmungsradius des Tor-Bogens)');
ok(/const GOAL_R=GOAL_CURVE_R\*goalScale;/.test(HTML), 'GOAL_R aus GOAL_CURVE_R*goalScale hergeleitet (konzentrisch: Kruemmungszentrum == Arenazentrum)');
ok(!/GOAL_R\s*=\s*8\.55/.test(HTML), 'Alte gerade-Tor-Konstante GOAL_R=8.55 vollstaendig entfernt');
{ const GLB_R = 10.1, BR = 1000 * 0.032, R0 = 1000 * 0.485;
  const goalScale = (2 * BR) * GLB_R / R0, GOAL_CURVE_R = 6.95, GOAL_R = GOAL_CURVE_R * goalScale;
  ok(GOAL_R < GLB_R, 'Tor-Mittelpunkt steht innerhalb der Aussenkante (GOAL_R=' + GOAL_R.toFixed(2) + ' < ' + GLB_R + ')');
  ok(GOAL_R > 9.0, 'Tor sitzt am Arenarand (GOAL_R nahe der Kante, nicht nach innen abgerueckt)');
  // Konzentrischer Fussabdruck (front y=-0.42 .. back y=+0.63 Balldurchmesser) fuellt den Walkway [8.7..10.1] GLB.
  const rFront = (GOAL_CURVE_R - 0.42) * goalScale, rBack = (GOAL_CURVE_R + 0.63) * goalScale;
  ok(rFront > 8.6 && rFront < 8.85, 'Fuss-Innenkante an der Walkway-Innenlippe (~8.7 GLB, r=' + rFront.toFixed(2) + ')');
  ok(rBack > 9.9 && rBack < GLB_R + 0.05, 'Fuss-Aussenkante randbuendig an der Arenakante (~10.1 GLB, r=' + rBack.toFixed(2) + ')'); }

// (2) Glas-Korrektur: nahezu farblos, klar, dezente Reflexe (nicht milchig/weiss/plastik). Nur Optik.
ok(/nm\.includes\('Glass'\)/.test(HTML), 'Banden-Materialbehandlung erkennt das Glas-Material am Namen');
ok(/m\.transmission=1\.0/.test(HTML) && /m\.roughness=0\.05/.test(HTML), 'Glas: hohe Transmission + niedrige (nicht kuenstlich null) Roughness');
ok(/m\.ior=1\.5/.test(HTML) && /m\.thickness=0\.05/.test(HTML), 'Glas: IOR 1.5 + deutlich duennere Wandstaerke (klarer, weniger optische Dichte)');
ok(/m\.color=new THREE\.Color\(1,1,1\)/.test(HTML), 'Glas: neutrale/farblose Basisfarbe (keine Weiss-/Blaufaerbung)');
ok(/m\.attenuationColor=new THREE\.Color\(1,1,1\)/.test(HTML) && /m\.attenuationDistance=Infinity/.test(HTML), 'Glas: Attenuation deaktiviert (keine Eigenfaerbung/-aufhellung)');
ok(/m\.clearcoat=0\.15/.test(HTML) && /m\.clearcoatRoughness=0\.1/.test(HTML), 'Glas: nur dezenter Clearcoat (kein Plastik-Glanz)');
ok(/m\.envMapIntensity=1\.0/.test(HTML), 'Glas: moderater HDRI-Reflex (envMapIntensity 1.0, nicht ueberstrahlt)');
ok(/m\.side=THREE\.FrontSide/.test(HTML) && /m\.transparent=false/.test(HTML) && /m\.depthWrite=true/.test(HTML), 'Glas: einseitig + Transmission-Pass (kein opacity-Faking, keine milchige Ueberlagerung)');
ok(!/m\.side=THREE\.DoubleSide/.test(HTML), 'Keine DoubleSide-Glasflaeche mehr (kein doppelter Milchglas-Layer)');
ok(/nm\.includes\('Gold'\)/.test(HTML) && /nm\.includes\('Marble'\)/.test(HTML), 'Gold- und Marmor-Material unveraendert behandelt (nicht Teil dieser Glas-Korrektur)');
// Geometrie/Asset der Bande bleiben unangetastet (nur Glas-Materialparameter veraendert).
ok(!/bandProto\.scale|bandProto\.position\.set/.test(HTML), 'Banden-Geometrie/Transform der Bande unveraendert (nur Glasmaterial korrigiert)');

console.log('\nFootball-Shell: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
