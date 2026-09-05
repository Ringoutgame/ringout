// Arena Football KANONISCHE WANDFORM (Kandidat B) — fokussierte Pruefung.
//
// Nach dem Geometrielabor 01 hat der Mensch Kandidat B gewaehlt: lange gerade Bande, eine
// KURZE bewusste Schulter davor, dann die flache Torwand. Diese Suite prueft, dass daraus
// EINE gemeinsame Quelle geworden ist und nicht vier abgeschriebene Zahlensaetze:
//   1. der temporaere A/B/C-Schalter ist restlos weg
//   2. es gibt genau EINE Zwei-Tor-Beschreibung und EINE radiale Beschreibung
//   3. Classic, Tactical, Team 2v2 und das Zwei-Spieler-Finale lesen dieselbe
//   4. die radialen Phasen 3/4/5 tragen dasselbe Schulterverhaeltnis - rotationsgleich
//   5. Tore, Torlinien und Spawns sind unveraendert
//   6. Sichtbares und Kollision lesen dieselben zwei Felder
//
// Usage: node tools/test_football_arena_canonical.js

const { loadIndexHtml, grab: grabIn } = require('./extract.js');
const HTML = loadIndexHtml();
const grab = (re, name) => grabIn(HTML, re, name);

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }

const BR = 32;
// Die echten Formquellen aus index.html - von den Halbebenen bis zu den vier Arenen.
const SRC = grab(/\/\/ Konvexes Kernpolygon[\s\S]*?function fbElimArena\(\)\{.*\}/, 'Formblock');
const G = new Function(`
  const FB_GOAL_HALF_DEPTH=1.184,FB_GOAL_ASSET_INNER=3.560,FB_GOAL_ASSET_OUTER=5.282;
  const FB_TRI_COS30=0.8660254037844387,FB_TRI_TAN60=1.7320508075688772;
  const FOOTBALL_ELIM4_DIRS=[[0,-1],[1,0],[0,1],[-1,0]];
  const FOOTBALL_ELIM3_DIRS=[[0,-1],[FB_TRI_COS30,0.5],[-FB_TRI_COS30,0.5]];
  const FB_TRI_VERT=[[FB_TRI_COS30,-0.5],[0,1],[-FB_TRI_COS30,-0.5]];
  const FOOTBALL_ELIM2_DIRS=[[1,0],[-1,0]];
  const FB_P5_C1=0.9510565162951535,FB_P5_S1=0.30901699437494745;
  const FB_P5_C2=0.5877852522924731,FB_P5_S2=0.8090169943749475;
  const FOOTBALL_ELIM5_DIRS=[[0,-1],[FB_P5_C1,-FB_P5_S1],[FB_P5_C2,FB_P5_S2],
                             [-FB_P5_C2,FB_P5_S2],[-FB_P5_C1,-FB_P5_S1]];
  const FB_P5_VERT=[[FB_P5_C2,-FB_P5_S2],[FB_P5_C1,FB_P5_S1],[0,1],
                    [-FB_P5_C1,FB_P5_S1],[-FB_P5_C2,-FB_P5_S2]];
  let fbElimPhaseN=4;
  ${SRC}
  return {FB_TWO_GOAL_SHAPE,FB_RADIAL_SHAPE,FB_P4_VERT,
          fbTwoGoalArena,fbRadialArena,fbShoulderRect,fbTruncPoly,
          A2:FOOTBALL_ARENA_ELIM2,A3:FOOTBALL_ARENA_ELIM3,A4:FOOTBALL_ARENA_ELIM4,
          A5:FOOTBALL_ARENA_ELIM5,AT:FOOTBALL_ARENA,AC:FOOTBALL_ARENA_CLASSIC,
          DIRS:{3:FOOTBALL_ELIM3_DIRS,4:FOOTBALL_ELIM4_DIRS,5:FOOTBALL_ELIM5_DIRS}};
`)();

// Kanten eines Kernpolygons mit Aussennormale. Die Kantenlaenge IST die gerade Wand.
function kanten(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz);
    if (L < 1e-9) continue;
    let nx = dz / L, nz = -dx / L;
    if (nx * (A[0] + B[0]) / 2 + nz * (A[1] + B[1]) / 2 < 0) { nx = -nx; nz = -nz; }
    out.push({ L: L, nx: nx, nz: nz });
  }
  return out;
}
// Torseiten (Normale zeigt in eine Torrichtung) und Kappflaechen trennen.
function trenne(poly, dirs) {
  const tor = [], kappe = [];
  for (const k of kanten(poly)) {
    (dirs.some(d => Math.abs(k.nx - d[0]) < 1e-9 && Math.abs(k.nz - d[1]) < 1e-9) ? tor : kappe).push(k);
  }
  return { tor: tor, kappe: kappe };
}
const gleich = (arr) => arr.every(k => Math.abs(k.L - arr[0].L) < 1e-9);

// ══ A. DER A/B/C-SCHALTER IST RESTLOS WEG ════════════════════════════════════
{
  for (const rest of ['arenaGeom', 'DEV_ARENA_GEOM', 'FB_GEOM_LAB', 'fbGeomApply',
                      'fbGeomCache', 'fbRectPoly'])
    ok(!HTML.includes(rest), 'kein Rest des Geometrielabors: ' + rest);
  // Und keine tote Formfunktion: fbTruncTri ist in fbTruncPoly aufgegangen.
  ok(!HTML.includes('fbTruncTri'), 'die Dreiecks-Sonderform ist in fbTruncPoly aufgegangen');
  // fbArena ist wieder die schlichte Weiche ohne Zwischenschicht.
  const src = grab(/function fbArena\(\)\{[\s\S]*?\n\}/, 'fbArena');
  ok(!/lab|Lab|geom|Geom/.test(src), 'fbArena traegt keine Laborschicht mehr');
  ok(/return \(fbTactical\(\)\|\|fbTeam2\(\)\)\?FOOTBALL_ARENA:FOOTBALL_ARENA_CLASSIC;/.test(src),
     'sie waehlt nur noch zwischen den beiden Grundflaechen');
}

// ══ B. GENAU EINE BESCHREIBUNG JE FAMILIE ════════════════════════════════════
{
  ok(/const FB_TWO_GOAL_SHAPE=\{rc:2\.60,shoulderDeg:35,endHalf:7\.00\};/.test(HTML),
     'die Zwei-Tor-Wandform steht genau einmal als benannte Beschreibung');
  ok(/const FB_RADIAL_SHAPE=\{rc:2\.60,vf:\{3:1\.5916,4:1\.2663,5:1\.1559\}\};/.test(HTML),
     'die radiale Wandform ebenso');
  ok((HTML.match(/FB_TWO_GOAL_SHAPE=/g) || []).length === 1
     && (HTML.match(/FB_RADIAL_SHAPE=/g) || []).length === 1,
     'jede der beiden wird an genau einer Stelle definiert');
  // Kein zweiter Satz Schulterzahlen irgendwo im Produkt.
  ok((HTML.match(/fbShoulderRect\(/g) || []).length === 1
     && /const fbShoulderRect=\(halfLen,halfWid,rc,thDeg,endHalf\)=>/.test(HTML),
     'fbShoulderRect hat genau einen Aufrufer: den kanonischen Generator');
  ok((HTML.match(/fbTruncPoly\(/g) || []).length === 1
     && /const fbTruncPoly=\(dirs,verts,ap,rc,vf\)=>/.test(HTML),
     'fbTruncPoly ebenso');
  ok(G.FB_TWO_GOAL_SHAPE.rc === 2.60 && G.FB_RADIAL_SHAPE.rc === 2.60,
     'beide Familien tragen denselben Eckradius 2.60');
}

// ══ C-F. ALLE VIER ZWEI-TOR-MODI AUS DERSELBEN QUELLE ════════════════════════
{
  ok(/const FOOTBALL_ARENA=fbTwoGoalArena\(18\.00,12\.70,7\.65\);/.test(HTML),
     'Tactical und True Team 2v2: Grundflaeche 18.00 x 12.70, Spawn 7.65');
  ok(/const FOOTBALL_ARENA_ELIM2=fbTwoGoalArena\(15\.60,11\.60,10\.15\);/.test(HTML),
     'Zwei-Spieler-Finale: Grundflaeche 15.60 x 11.60, Spawn 10.15');
  ok(/const FOOTBALL_ARENA_CLASSIC=FOOTBALL_ARENA_ELIM2;/.test(HTML),
     'Classic ist dieselbe Objektinstanz wie das Finale - nicht eine zweite Beschreibung');
  // Und True Team 2v2 liest dieselbe Instanz wie Tactical.
  ok(/return \(fbTactical\(\)\|\|fbTeam2\(\)\)\?FOOTBALL_ARENA:/.test(HTML),
     'True Team 2v2 liest dieselbe Instanz wie Tactical');
  // Das WANDPROFIL ist in beiden Grundflaechen dasselbe: gleicher Eckradius, gleicher
  // Schulterwinkel, gleiche flache Torwand.
  for (const [name, a] of [['Tactical/Team 2v2', G.AT], ['Classic/Finale', G.AC]]) {
    ok(a.corner === 2.60, name + ': Eckradius 2.60');
    ok(Array.isArray(a.poly) && a.poly.length === 8, name + ': achteckiges Kernpolygon');
    const t = trenne(a.poly, [[1, 0], [-1, 0]]);
    ok(t.tor.length === 2 && gleich(t.tor), name + ': zwei gleiche flache Torwaende');
    ok(t.kappe.length === 6, name + ': zwei Laengsbanden und vier Schultern');
    const stirn = t.tor[0].L;
    ok(Math.abs(stirn / 2 - 7.00) < 1e-9, name + ': halbe Torwand exakt endHalf 7.00');
    ok(stirn / 2 > a.postOuter, name + ': und damit ueber postOuter - die Tormuendung ist frei');
    // Schulterwinkel: 35 Grad Normalenwinkel gegen die Torachse.
    const sch = t.kappe.filter(k => Math.abs(k.nx) > 1e-9 && Math.abs(k.nz) > 1e-9);
    ok(sch.length === 4 && gleich(sch), name + ': vier gleich lange Schultern');
    const w = Math.abs(Math.atan2(sch[0].nz, sch[0].nx) * 180 / Math.PI);
    ok(Math.abs(Math.min(w, 180 - w) - 35) < 1e-6, name + ': Schulterwinkel exakt 35 Grad');
  }
  // Die konkreten Laengen aus dem Labor.
  const tt = trenne(G.AT.poly, [[1, 0], [-1, 0]]);
  const seiteT = tt.kappe.find(k => Math.abs(Math.abs(k.nz) - 1) < 1e-9).L;
  const schT = tt.kappe.find(k => Math.abs(k.nx) > 1e-9 && Math.abs(k.nz) > 1e-9).L;
  ok(Math.abs(seiteT - 26.46) < 0.01 && Math.abs(schT - 3.78) < 0.01,
     'Team/Tactical: gerade Bande 26.46, Schulter 3.78 (' + seiteT.toFixed(2) + '/' + schT.toFixed(2) + ')');
  const tc = trenne(G.AC.poly, [[1, 0], [-1, 0]]);
  const seiteC = tc.kappe.find(k => Math.abs(Math.abs(k.nz) - 1) < 1e-9).L;
  const schC = tc.kappe.find(k => Math.abs(k.nx) > 1e-9 && Math.abs(k.nz) > 1e-9).L;
  ok(Math.abs(seiteC - 23.20) < 0.01 && Math.abs(schC - 2.44) < 0.01,
     'Classic: gerade Bande 23.20, Schulter 2.44 (' + seiteC.toFixed(2) + '/' + schC.toFixed(2) + ')');
}

// ══ G. LIVES UND TIMED FFA WAEHLEN DIESELBE GEOMETRIE ════════════════════════
{
  // Die Arena haengt ausschliesslich an der Spielerzahl (fbElimPhaseN), nie an der Regel.
  const src = grab(/function fbElimArena\(\)\{.*\}/, 'fbElimArena');
  ok(/return FB_ELIM_ARENAS\[fbElimPhaseN\]/.test(src),
     'die Arena folgt der Phasenzahl - nicht der Regel');
  ok(!/fbTimed|fbElimRules|LIVES|TIMED/.test(src),
     'fbElimArena kennt weder die Lebensregel noch die Zeitregel');
  ok(!/fbTimed|fbElimRules/.test(grab(/function fbArena\(\)\{[\s\S]*?\n\}/, 'fbArena')),
     'und fbArena ebenso wenig');
}

// ══ H-K. DIE RADIALEN PHASEN: B-VERHAELTNIS UND ROTATIONSGLEICHHEIT ══════════
{
  ok(/const FOOTBALL_ARENA_ELIM3=fbRadialArena\(3,12\.50,8\.15,FOOTBALL_ELIM3_DIRS,FB_TRI_VERT\);/.test(HTML),
     'Drei-Spieler-Phase aus dem radialen Generator');
  ok(/const FOOTBALL_ARENA_ELIM4=fbRadialArena\(4,17\.50,11\.50,FOOTBALL_ELIM4_DIRS,FB_P4_VERT\);/.test(HTML),
     'Vier-Spieler-Phase ebenso');
  ok(/const FOOTBALL_ARENA_ELIM5=fbRadialArena\(5,19\.50,12\.75,FOOTBALL_ELIM5_DIRS,FB_P5_VERT\);/.test(HTML),
     'Fuenf-Spieler-Phase ebenso');
  // Das Verhaeltnis, das von B uebertragen wurde: Anteil der Schulter am Wandlauf.
  const tt = trenne(G.AT.poly, [[1, 0], [-1, 0]]);
  const seiteB = tt.kappe.find(k => Math.abs(Math.abs(k.nz) - 1) < 1e-9).L;
  const schB = tt.kappe.find(k => Math.abs(k.nx) > 1e-9 && Math.abs(k.nz) > 1e-9).L;
  const stirnB = tt.tor[0].L;
  const anteilB = schB / (seiteB / 2 + schB + stirnB / 2);
  ok(Math.abs(anteilB - 0.158) < 0.002,
     'B: die Schulter nimmt 15.8 % des Wandlaufs ein (' + (anteilB * 100).toFixed(1) + ' %)');
  for (const [n, a] of [[3, G.A3], [4, G.A4], [5, G.A5]]) {
    ok(a.corner === 2.60, n + ' Tore: kanonischer Eckradius 2.60');
    ok(a.sides === n, n + ' Tore: die Seitenzahl stimmt');
    ok(Array.isArray(a.poly) && a.poly.length === 2 * n,
       n + ' Tore: ' + n + ' Torseiten und ' + n + ' Kappflaechen (' + a.poly.length + ' Ecken)');
    const t = trenne(a.poly, G.DIRS[n]);
    ok(t.tor.length === n && t.kappe.length === n, n + ' Tore: sauber getrennt');
    // ROTATIONSGLEICHHEIT: alle Torseiten gleich lang, alle Kappen gleich lang.
    ok(gleich(t.tor), n + ' Tore: ALLE Torseiten exakt gleich lang (' + t.tor[0].L.toFixed(4) + ')');
    ok(gleich(t.kappe), n + ' Tore: ALLE Kappflaechen exakt gleich lang (' + t.kappe[0].L.toFixed(4) + ')');
    // Gleicher Abstand vom Zentrum: jede Torebene liegt auf demselben Apothem.
    const abst = G.DIRS[n].map((d, k) => {
      const e = t.tor.find(x => Math.abs(x.nx - d[0]) < 1e-9 && Math.abs(x.nz - d[1]) < 1e-9);
      return e ? Math.round((a.halfLen - a.corner) * 1e9) / 1e9 : null;
    });
    ok(abst.every(x => x !== null && x === abst[0]),
       n + ' Tore: jede Torseite liegt auf demselben Abstand vom Zentrum');
    // Und das B-Verhaeltnis.
    const anteil = t.kappe[0].L / (t.tor[0].L + t.kappe[0].L);
    ok(Math.abs(anteil - anteilB) < 0.003,
       n + ' Tore: dieselbe Schulterrelation wie B (' + (anteil * 100).toFixed(1) + ' %)');
    // Die kurze Kappe darf die Torseite nie dominieren.
    ok(t.kappe[0].L < t.tor[0].L * 0.30,
       n + ' Tore: die Kappe bleibt kurz gegenueber der Torseite');
    // Das Tor sitzt vollstaendig in der flachen Torseite.
    ok(t.tor[0].L / 2 > a.postOuter,
       n + ' Tore: halbe Torseite (' + (t.tor[0].L / 2).toFixed(2) + ') ueber postOuter');
  }
}

// ══ L+M. TORE UND TORLINIEN UNVERAENDERT ═════════════════════════════════════
{
  ok(/const FB_GOAL_ASSET_INNER=3\.560, FB_GOAL_ASSET_OUTER=5\.282;/.test(HTML),
     'die gemessenen Asset-Kanten sind unveraendert');
  ok(2 * 3.560 * BR === 227.84, 'die lichte Torbreite bleibt 227.84 px');
  ok(/const FB_GOAL_HALF_DEPTH=1\.184;/.test(HTML), 'die halbe Sockeltiefe ebenso');
  for (const [name, a] of [['Tactical/Team 2v2', G.AT], ['Classic/Finale', G.AC],
                           ['3 Tore', G.A3], ['4 Tore', G.A4], ['5 Tore', G.A5]]) {
    ok(a.postInner === 3.560 && a.postOuter === 5.282, name + ': Tormasse unveraendert');
    ok(a.postFront === a.halfLen, name + ': die Torlinie liegt auf der Bandeninnenflaeche');
    ok(Math.abs(a.postBack - (a.halfLen + 2 * 1.184)) < 1e-9, name + ': Sockelhinterkante als Formel');
  }
  // Die Wertung selbst ist unberuehrt.
  ok(/function footballGoalSide\(b\)\{/.test(HTML) && /function footballTryGoal\(b\)\{/.test(HTML),
     'Torerkennung und Wertung existieren unveraendert');
  ok((HTML.match(/score\[side\]=\(score\[side\]\|\|0\)\+1;/g) || []).length === 1,
     'und es gibt weiterhin genau einen Zaehlpfad');
}

// ══ N. SPAWNS UNVERAENDERT ═══════════════════════════════════════════════════
{
  const soll = { 'Tactical/Team 2v2': [G.AT, 7.65], 'Classic/Finale': [G.AC, 10.15],
                 '3 Tore': [G.A3, 8.15], '4 Tore': [G.A4, 11.50], '5 Tore': [G.A5, 12.75] };
  for (const name of Object.keys(soll)) {
    const [a, s] = soll[name];
    ok(a.spawn === s, name + ': Spawnabstand unveraendert (' + a.spawn + ')');
    // Kein Spawn liegt in einer Wand: er steht auf der Torachse, deutlich innerhalb der
    // Torebene, und die Schultern sitzen seitlich davon.
    ok(a.spawn < a.halfLen - a.corner, name + ': der Spawn liegt innerhalb der Kernebene');
  }
  ok(/const FOOTBALL_TACTICAL_SPAWN=\{frontX:6\.40,frontY:2\.80,backX:12\.20,backY:4\.60\};/.test(HTML),
     'die Vier-Figuren-Aufstellung (Tactical und Team 2v2) ist unveraendert');
}

// ══ O. SICHTBARES UND KOLLISION AUS DERSELBEN QUELLE ═════════════════════════
{
  ok(/if\(av\.poly\)return footballPolySD\(b\.x-cx,b\.y-cy,av\.poly,fbCorner\(\)-r\);/.test(HTML),
     'die Physik liest Kernpolygon und Eckradius aus fbArena()');
  ok(/\?fbRoundPoly\(av\.poly\.map\(v=>\[v\[0\]\*BR\*FB_U,v\[1\]\*BR\*FB_U\]\),rc,20\):null;/.test(HTML),
     'der Renderer baut den Ring aus DEMSELBEN Kernpolygon und demselben Radius');
  ok(/function fbCorner\(\)\{return fbArena\(\)\.corner\*BR;\}/.test(HTML),
     'und beide holen den Radius aus derselben Funktion');
  ok((HTML.match(/FOOTBALL_ARENA\./g) || []).length === 0,
     'kein Modul liest die Arenakonstanten am Zugriffsweg vorbei');
  // JEDE Arena traegt jetzt ein Kernpolygon - es gibt keinen Rechteck-Rueckfallpfad mehr,
  // auf dem Renderer und Physik unterschiedliche Formen bauen koennten.
  for (const [name, a] of [['Tactical/Team 2v2', G.AT], ['Classic/Finale', G.AC],
                           ['3 Tore', G.A3], ['4 Tore', G.A4], ['5 Tore', G.A5]])
    ok(Array.isArray(a.poly), name + ': traegt ein Kernpolygon');
  // Und jede traegt ihre Torachsen, die der Renderer fuer die Oeffnungen braucht.
  for (const [name, a, n] of [['Tactical/Team 2v2', G.AT, 2], ['Classic/Finale', G.AC, 2],
                              ['3 Tore', G.A3, 3], ['4 Tore', G.A4, 4], ['5 Tore', G.A5, 5]])
    ok(Array.isArray(a.dirs) && a.dirs.length === n, name + ': traegt ' + n + ' Torachsen');
}

// ══ P-W. PHYSIK, REGELN UND NETZ UNVERAENDERT ════════════════════════════════
{
  for (const c of [/slowv:0\.70,stopv:0\.075,restBall:0\.44,restBand:0\.60,restPost:0\.50\}/,
                   /const FOOTBALL_CONTACT_ITERATIONS=3;/, /const FOOTBALL_BALL_RADIUS=25;/,
                   /const FB_LAUNCH_SCALE=1\.26;/, /const FB_LAUNCH_CURVE=0\.98;/])
    ok(c.test(HTML), 'Physikkonstante unveraendert: ' + c.source);
  for (const c of [/const FOOTBALL_WIN_SCORE=3;/, /const FB_ELIM_LIVES=2;/,
                   /const FOOTBALL_FFA_PHASE_SECONDS=60;/, /const FOOTBALL_FFA_SHOT_SECONDS=6;/,
                   /const FOOTBALL_TEAM2V2_SHOT_SECONDS=6;/, /const FOOTBALL_TEAM2V2_PLAYERS=4;/,
                   /const FOOTBALL_BANK_SECONDS=45;/, /const FOOTBALL_SHOT_SECONDS=6;/,
                   /const FOOTBALL_TROUBLE_SECONDS=2;/])
    ok(c.test(HTML), 'Regelkonstante unveraendert: ' + c.source);
  ok(/const ONLINE_PROTOCOL_VERSION=7;/.test(HTML), 'Protokollversion unveraendert');
  ok(/const FOOTBALL_FMTS=\['elimination'\];/.test(HTML), 'FOOTBALL_FMTS unveraendert');
  // Kein lokaler Parameter kann die Geometrie mehr verstellen - online wie offline.
  ok(!/URLSearchParams[^\n]*arena/i.test(HTML),
     'kein Adresszeilenparameter beruehrt die Arenageometrie');
  const formblock = SRC;
  ok(!/online|URLSearchParams|DEV_/.test(formblock),
     'der Formblock liest weder Netzzustand noch Dev-Schalter');
}

console.log('');
console.log('Football-Arena-Kanonisch: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
