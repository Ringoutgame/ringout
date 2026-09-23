// ARENA FOOTBALL - TACTICAL 4-BALL 1V1 ONLINE: vier Figuren je Spieler, abwechselnde Zuege.
//
// Je Runde zieht EIN Sitz mit EINER eigenen Figur, der andere traegt ein automatisches pass,
// wer am Zug ist folgt aus Runde und Generation (fbTacAktivSitz) - und jeder Spieler fuehrt
// VIER Figuren. Seit 2026-09-22 ist das das Zugmodell NUR dieser Variante: Tactical 1v1 zieht
// gleichzeitig (fbTacGleichzeitig), 4-Ball abwechselnd (fbTacAbwechselnd); die Gatter fragen
// den Helfer, nie die Familienfrage fbTactical(). Neun Koerper: Sitz 0 fuehrt 0..3 (A1..A4), Sitz 1
// fuehrt 4..7 (B1..B4), Koerper 8 ist der neutrale Ball. Jede der vier eigenen Figuren ist in
// jedem eigenen Zug waehlbar, auch dieselbe wie im Zug davor; es gibt keine Rotation.
//
// Geprueft werden ECHTE Funktionen aus index.html in kleinen Sandkaesten: Register und
// Raumfassung, die Praedikate (fbTactical gilt fuer beide Varianten, fbTac4 nur fuer diese,
// fbTacFiguren 2/4), der Koerperbesitz, die Aufstellung (placeBalls), die Eingabegatter, die
// Zugmengenpruefung und -wirkung, die Namensschilder und die Vertraege im Quelltext. Die
// Rules prueft tools/test_rules.js (Abschnitt 20) gegen die echte firebase.rules.json.
//
//   node tools/test_football_tactical4_online.js
const { loadIndexHtml, grab, grabFunction } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
};
const abschnitt = (s) => console.log('\n== ' + s + ' ==');
const g = (re, name) => grab(HTML, re, name);
const fn = (name) => grabFunction(HTML, name);

function sprache(code) {
  const start = HTML.indexOf(code + ':{tagline:');
  if (start < 0) { console.error('FAIL: Sprachtabelle ' + code + ' fehlt'); process.exit(1); }
  const ende = HTML.indexOf('\n};', start);
  const block = HTML.slice(start, ende < 0 ? HTML.length : ende);
  const tab = {}; const re = /([A-Za-z0-9_]+):'((?:[^'\\]|\\.)*)'/g; let m;
  while ((m = re.exec(block))) if (tab[m[1]] === undefined) tab[m[1]] = m[2];
  return tab;
}
const I18N = { en: sprache('en'), de: sprache('de'), tr: sprache('tr') };

// Die Praedikate, wie sie im Produkt stehen - Variante und Modus sind hier veraenderbar.
const PRAEDIKATE = [
  g(/const FOOTBALL_VARIANT_TACTICAL='[^']*';/, 'V_TACTICAL'),
  g(/const FOOTBALL_VARIANT_TACTICAL4='[^']*';/, 'V_TACTICAL4'),
  g(/const FOOTBALL_VARIANT_TEAM2='[^']*';/, 'V_TEAM2'),
  g(/const FOOTBALL_VARIANT_ELIM='[^']*';/, 'V_ELIM'),
  'let mode="football", fbVariant="tactical4";',
  fn('fbTactical'), fn('fbTac4'),
  g(/const FB_TAC_FIGUREN=\d+, FB_TAC4_FIGUREN=\d+;/, 'FB_TAC_FIGUREN'),
  fn('fbTacFiguren'),
].join('\n');

// ══ 1. REGISTER, RAUMFASSUNG, VARIANTE ═══════════════════════════════════════════
abschnitt('1. Register, Raumfassung und Variante');
{
  const M = new Function([
    'const ONLINE_PROTOCOL_VERSION=11; const DEV_MENU=false;',
    g(/const ROOM_GAME_RINGOUT=[^\n]*RINGOUT_SKIP_FASSUNG=\d+;/, 'ROOM_GAME + RINGOUT_SKIP_FASSUNG'),
    g(/const FOOTBALL_VARIANT_TACTICAL='[^']*';/, 'V_TACTICAL'),
    g(/const FOOTBALL_VARIANT_TACTICAL4='[^']*';/, 'V_TACTICAL4'),
    g(/const FOOTBALL_VARIANT_TEAM2='[^']*';/, 'V_TEAM2'),
    g(/const FOOTBALL_VARIANT_ELIM='[^']*';/, 'V_ELIM'),
    g(/const FB_ONLINE_MODE_CLASSIC=[\s\S]*?\nlet fbOnlineTeam=[^\n]*/, 'Modusregister'),
    g(/function fbRaumFassung\(cfg\)\{[\s\S]*?\n\}/, 'fbRaumFassung'),
    fn('fbVarianteFuerModus'),
    'return { IDS: FB_ONLINE_MODE_IDS, def: fbModeDef, caps: fbModeCaps, rel: fbModeReleased, capOk: fbModeCapOk, defCap: fbModeDefaultCap,',
    '  fassung: fbRaumFassung, variante: fbVarianteFuerModus, TAC4: FB_ONLINE_MODE_TACTICAL4, TAC: FB_ONLINE_MODE_TACTICAL, SITZE: FB_TAC_SITZE,',
    '  V_TAC: FOOTBALL_VARIANT_TACTICAL, V_TAC4: FOOTBALL_VARIANT_TACTICAL4, V_TEAM2: FOOTBALL_VARIANT_TEAM2, V_ELIM: FOOTBALL_VARIANT_ELIM };'
  ].join('\n'))();
  t('der Modusschluessel ist tactical4', M.TAC4 === 'tactical4');
  t('das Register kennt tactical4 - und weiterhin tactical', M.IDS.indexOf('tactical4') >= 0 && !!M.def('tactical4') && M.IDS.indexOf('tactical') >= 0);
  t('Tactical 4-Ball fasst genau zwei Sitze (die vier Figuren sind keine Teilnehmer)', M.caps('tactical4').join(',') === '2' && M.capOk('tactical4', 2) && !M.capOk('tactical4', 4) && !M.capOk('tactical4', 8) && M.defCap('tactical4') === 2);
  t('Tactical 4-Ball ist freigegeben', M.rel('tactical4') === true);
  t('Tactical 1v1, Lebensregel und Team 2v2 bleiben freigegeben, Classic/Speed/Timed FFA gesperrt', M.rel('tactical') && M.rel('lives') && M.rel('team2v2') && !M.rel('classic') && !M.rel('speed') && !M.rel('timedffa'));
  const cfg = (mode, cap) => ({ game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'private', mode, cap });
  t('ein Tactical-4-Ball-Raum mit zwei Sitzen ist ein v11-Raum', M.fassung(cfg('tactical4', 2)) === 11);
  t('mit anderer Sitzzahl faellt er auf v8 zurueck (die Rules kennen ihn nicht)', M.fassung(cfg('tactical4', 4)) === 8 && M.fassung(cfg('tactical4', 8)) === 8 && M.fassung(cfg('tactical4', 3)) === 8);
  t('Tactical (2), Lives (5) und Team 2v2 (4) bleiben v11', M.fassung(cfg('tactical', 2)) === 11 && M.fassung(cfg('lives', 5)) === 11 && M.fassung(cfg('team2v2', 4)) === 11);
  t('die Variante folgt dem Modus: tactical4 -> Tactical 4-Ball', M.variante('tactical4') === M.V_TAC4 && M.V_TAC4 === 'tactical4');
  t('... tactical -> Tactical, team2v2 -> Team 2v2, jeder andere -> Elimination', M.variante('tactical') === M.V_TAC && M.variante('team2v2') === M.V_TEAM2 && M.variante('lives') === M.V_ELIM && M.variante('') === M.V_ELIM);
}

// ══ 2. PRAEDIKATE UND FIGURENZAHL ═════════════════════════════════════════════════
abschnitt('2. Praedikate: fbTactical gilt fuer beide Varianten, fbTac4 nur fuer diese, vier Figuren');
{
  const M = new Function([
    PRAEDIKATE,
    'let fmt="single";',
    g(/function teamCap\(\)\{[^\n]*/, 'teamCap'),
    'return { tac: fbTactical, tac4: fbTac4, fig: fbTacFiguren, cap: teamCap, setz: (v,m)=>{ fbVariant=v; if(m)mode=m; } };'
  ].join('\n'))();
  t('tactical4: fbTactical UND fbTac4 sind wahr, vier Figuren je Sitz, teamCap 4', M.tac() && M.tac4() && M.fig() === 4 && M.cap() === 4);
  M.setz('tactical');
  t('tactical: fbTactical wahr, fbTac4 falsch, zwei Figuren, teamCap 2 (unveraendert)', M.tac() && !M.tac4() && M.fig() === 2 && M.cap() === 2);
  M.setz('elimination');
  t('elimination: beide falsch, teamCap 1', !M.tac() && !M.tac4() && M.cap() === 1);
  M.setz('team2v2');
  t('team2v2: beide falsch', !M.tac() && !M.tac4());
  M.setz('tactical4', 'ringout');
  t('ausserhalb von Football gilt keine der beiden', !M.tac() && !M.tac4());
  t('die Zahlen stehen genau einmal: FB_TAC_FIGUREN=2, FB_TAC4_FIGUREN=4', /const FB_TAC_FIGUREN=2, FB_TAC4_FIGUREN=4;/.test(HTML));
  t('fbClassic schliesst Tactical (beide Varianten) und Team 2v2 aus', /function fbClassic\(\)\{return mode==='football'&&!fbElim4\(\)&&!fbTactical\(\)&&!fbTeam2\(\);\}/.test(HTML));
  t('Arena und Kamerarahmung folgen fbTactical - Tactical 4-Ball spielt auf der Tactical-Arena', /return \(fbTactical\(\)\|\|fbTeam2\(\)\)\?FOOTBALL_ARENA:FOOTBALL_ARENA_CLASSIC;/.test(HTML));
}

// ══ 3. KOERPERBESITZ ═════════════════════════════════════════════════════════════
abschnitt('3. Koerperbesitz: Sitz 0 fuehrt 0..3, Sitz 1 fuehrt 4..7, der Ball (8) gehoert niemandem');
{
  const M = new Function([
    PRAEDIKATE,
    fn('fbV9IdxGehoert'),
    'return { g: fbV9IdxGehoert, setz: (v)=>{ fbVariant=v; } };'
  ].join('\n'))();
  t('Sitz 0 fuehrt genau die Koerper 0, 1, 2, 3', [0, 1, 2, 3].every(i => M.g(0, i)) && [4, 5, 6, 7, 8, 9].every(i => !M.g(0, i)));
  t('Sitz 1 fuehrt genau die Koerper 4, 5, 6, 7', [4, 5, 6, 7].every(i => M.g(1, i)) && [0, 1, 2, 3, 8, 9].every(i => !M.g(1, i)));
  t('den Ball (8) fuehrt kein Sitz', !M.g(0, 8) && !M.g(1, 8));
  t('kein Koerper gehoert beiden Sitzen', [0, 1, 2, 3, 4, 5, 6, 7, 8].every(i => !(M.g(0, i) && M.g(1, i))));
  t('unsinnige Indizes gehoeren niemandem', !M.g(0, -1) && !M.g(0, 1.5) && !M.g(0, NaN) && !M.g(1, '4'));
  M.setz('tactical');
  t('Tactical (2): Sitz 0 fuehrt 0/1, Sitz 1 fuehrt 2/3 - unveraendert', M.g(0, 0) && M.g(0, 1) && !M.g(0, 2) && M.g(1, 2) && M.g(1, 3) && !M.g(1, 4));
  M.setz('elimination');
  t('Lebensregel: der Koerperindex ist der Sitz - unveraendert', M.g(0, 0) && M.g(3, 3) && !M.g(0, 1) && !M.g(2, 5));
}

// ══ 4. AUFSTELLUNG ═══════════════════════════════════════════════════════════════
abschnitt('4. Aufstellung: neun Koerper, spiegelsymmetrisch, ohne Ueberlappung, niemand im Tor');
{
  const M = new Function([
    PRAEDIKATE,
    'let fmt="single", ffaN=0, BR=1, cx=0, cy=0, R=100, balls=[];',
    'function fbElim4(){ return false; } function fbTeam2(){ return false; }',
    'function fbArena(){ return { spawn: 7.65 }; }',
    g(/const FOOTBALL_NEUTRAL_OWNER=\d+;/, 'FOOTBALL_NEUTRAL_OWNER'),
    g(/const FOOTBALL_TACTICAL_SPAWN=\{[^\n]*\};/, 'FOOTBALL_TACTICAL_SPAWN'),
    g(/const FOOTBALL_TACTICAL_1V1_SPAWN=\{[^\n]*\};/, 'FOOTBALL_TACTICAL_1V1_SPAWN'),
    g(/const FOOTBALL_TACTICAL4_SPAWN=\[[^\n]*\];/, 'FOOTBALL_TACTICAL4_SPAWN'),
    fn('mkBall'),
    g(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls'),
    'return { stell: (v)=>{ fbVariant=v; placeBalls(); return balls.map(b=>({o:b.owner,x:b.x,y:b.y})); }, S4: FOOTBALL_TACTICAL4_SPAWN, S: FOOTBALL_TACTICAL_SPAWN, N: FOOTBALL_NEUTRAL_OWNER };'
  ].join('\n'))();
  const K = M.stell('tactical4');
  t('neun Koerper', K.length === 9, K.length);
  t('Besitz in Reihenfolge: A A A A B B B B Ball', K.map(k => k.o).join(',') === '0,0,0,0,1,1,1,1,' + M.N);
  t('genau vier Figuren je Sitz, genau ein Ball', K.filter(k => k.o === 0).length === 4 && K.filter(k => k.o === 1).length === 4 && K.filter(k => k.o === M.N).length === 1);
  t('der Ball liegt exakt in der Mitte', K[8].x === 0 && K[8].y === 0);
  t('alle Blauen bei -x, alle Roten bei +x', K.slice(0, 4).every(k => k.x < 0) && K.slice(4, 8).every(k => k.x > 0));
  t('Rot ist die exakte Spiegelung von Blau an der Mittelachse', [0, 1, 2, 3].every(i => K[i + 4].x === -K[i].x && K[i + 4].y === K[i].y));
  // Seit 2026-09-22 ist die Aufstellung eine RAUTE: Spitze vorn und Hinterfigur hinten stehen
  // auf der Torachse, die beiden Seiten spiegelgleich darueber und darunter auf halber Tiefe.
  t('Raute: Spitze (0) und Hinterfigur (3) stehen auf der Torachse, die Seiten (1,2) spiegelgleich auf gleicher Tiefe',
    K[0].y === 0 && K[3].y === 0 && K[1].x === K[2].x && K[1].y === -K[2].y && K[1].y !== 0, [K[0], K[1], K[2], K[3]]);
  t('Raute: die Spitze steht am naechsten am Ball, die Hinterfigur am weitesten - dazwischen die Seiten',
    Math.abs(K[0].x) < Math.abs(K[1].x) && Math.abs(K[1].x) < Math.abs(K[3].x));
  t('Raute: gleiche Schenkel - die Seiten liegen auf halber Tiefe zwischen Spitze und Hinterfigur',
    Math.abs(Math.abs(K[1].x) - (Math.abs(K[0].x) + Math.abs(K[3].x)) / 2) < 1e-9);
  let minD = 1e9, minEigen = 1e9;
  for (let i = 0; i < 9; i++) for (let j = i + 1; j < 9; j++) { const d = Math.hypot(K[i].x - K[j].x, K[i].y - K[j].y);
    minD = Math.min(minD, d); if (i < 4 && j < 4) minEigen = Math.min(minEigen, d); }
  // Kein Koerper beruehrt einen anderen: Spielerradius 1, Ball 25/32 BR. Der kleinste Abstand
  // ueberhaupt ist Spitze -> Ball; eigene Figuren bleiben >= 5 BR auseinander (Griffweite 2.8 BR).
  t('kein Koerper beruehrt einen anderen (kleinster Spalt > 2 BR)', minD - 1 - 25 / 32 > 2, minD);
  t('eigene Figuren stehen >= 5 BR auseinander - jede bleibt auf dem Telefon eindeutig greifbar', minEigen >= 5, minEigen);
  // postInner 3.560 (lichte Torbreite, s. Kommentar an FOOTBALL_TACTICAL_SPAWN): die tiefen
  // Figuren stehen ausserhalb des Tors; halfLen 18.00: niemand steht in der Bande.
  t('keine Figur mit |x| > 10 BR steht in der lichten Torbreite (|y| > 3.56) - Torkorridor frei', K.slice(0, 8).every(k => Math.abs(k.x) <= 10 || Math.abs(k.y) > 3.56));
  t('niemand steht in der Bande (|x| < 17)', K.every(k => Math.abs(k.x) < 17));
  const T2 = M.stell('tactical');
  // Die Aufstellung ist Zeichen fuer Zeichen die EIGENE Konstante FOOTBALL_TACTICAL4_SPAWN (Blau bei -x,
  // Rot gespiegelt); Team 2v2 (FOOTBALL_TACTICAL_SPAWN) und Tactical 1v1 sind hier kein Massstab.
  const nahe = (a, b) => Math.abs(a - b) < 1e-6;
  t('die vier Figuren je Seite sind Zeichen fuer Zeichen die eigene Konstante FOOTBALL_TACTICAL4_SPAWN', M.S4.length === 4 && [0, 1, 2, 3].every(i => nahe(K[i].x, -M.S4[i][0]) && nahe(K[i].y, M.S4[i][1]) && nahe(K[i + 4].x, M.S4[i][0]) && nahe(K[i + 4].y, M.S4[i][1])));
  t('Tactical 1v1 stellt weiterhin fuenf Koerper - aus seiner eigenen Aufstellung', T2.length === 5 && T2.map(k => k.o).join(',') === '0,0,1,1,' + M.N && T2[1].y === 0 && T2[1].x === -9.8);
  t('Tactical stellt weiterhin fuenf Koerper (0,0,1,1,Ball)', T2.map(k => k.o).join(',') === '0,0,1,1,' + M.N);
  t('placeBalls ist deterministisch', JSON.stringify(M.stell('tactical4')) === JSON.stringify(K));
}

// ══ 5. EINGABEGATTER ═════════════════════════════════════════════════════════════
abschnitt('5. Eingabegatter: nur der Sitz am Zug, nur eine eigene Figur, kein zweiter Zug');
{
  const M = new Function([
    PRAEDIKATE,
    'let r3dOrbit=false, phase="aim", online=true, myPlayer=0, turnNo=0, gen=1;',
    'let aimSet=[false,false], curAimer=0;',
    'function inputLocked(){ return false; } function r3dInputBlocked(){ return false; }',
    'function aliveCount(o){ return 4; } function fbV9EingabeOffen(){ return true; }',
    'function fbShared(){ return false; } function fbOffen(){ return []; } function fbElim4(){ return false; }',
    'function fbBotSpielt(){return false;}',
    fn('fbTacAktivSitz'), fn('fbTacOnline'), fn('fbTacDuell'), fn('fbTacAbwechselnd'), fn('fbTacAmZug'),   // das Zugmodell: abwechselnd nur hier
    fn('whoCanAim'), fn('canCommitInput'),
    'const BR=16; let fmt="single";',
    g(/function teamCap\(\)\{[^\n]*/, 'teamCap'),
    g(/function pickOwnBall\(who,p\)\{[^\n]*/, 'pickOwnBall'),
    'let balls=[{owner:0,alive:true,x:0,y:0},{owner:0,alive:true,x:0,y:60},{owner:0,alive:true,x:0,y:120},{owner:0,alive:true,x:0,y:180},',
    '           {owner:1,alive:true,x:300,y:0},{owner:1,alive:true,x:300,y:60},{owner:1,alive:true,x:300,y:120},{owner:1,alive:true,x:300,y:180},{owner:5,alive:true,x:150,y:90}];',
    'return { wer: whoCanAim, darf: canCommitInput, greif: (who,x,y)=>pickOwnBall(who,{x:x,y:y}), setz: (o)=>{ if("myPlayer" in o)myPlayer=o.myPlayer; if("turnNo" in o)turnNo=o.turnNo; if("gen" in o)gen=o.gen; if("aimSet" in o)aimSet=o.aimSet; if("fbVariant" in o)fbVariant=o.fbVariant; } };'
  ].join('\n'))();
  M.setz({ myPlayer: 0, turnNo: 0, gen: 1 });
  t('Runde 0: Sitz 0 darf zielen', M.wer() === 0 && M.darf(0) === true);
  M.setz({ myPlayer: 1 });
  t('Runde 0: Sitz 1 darf NICHT zielen - obwohl sein aimSet frei ist', M.wer() === -1 && M.darf(1) === false);
  M.setz({ turnNo: 1 });
  t('Runde 1: Sitz 1 darf zielen', M.wer() === 1 && M.darf(1) === true);
  M.setz({ myPlayer: 0 });
  t('Runde 1: Sitz 0 darf NICHT zielen', M.wer() === -1 && M.darf(0) === false);
  M.setz({ myPlayer: 1, turnNo: 1, aimSet: [false, true] });
  t('nach dem eigenen Zug ist die Eingabe des Sitzes am Zug zu (kein zweiter Zug, kein Figurenwechsel)', M.wer() === -1);
  // Der Griff: jede der vier eigenen Figuren, keine fremde, nicht der Ball (Reichweite 4*BR*5 = 320 px).
  t('Sitz 0 greift jede seiner vier Figuren - je nach Naehe', M.greif(0, 0, 5) === 0 && M.greif(0, 0, 65) === 1 && M.greif(0, 0, 125) === 2 && M.greif(0, 0, 185) === 3);
  t('Sitz 1 greift jede seiner vier Figuren', M.greif(1, 300, 5) === 4 && M.greif(1, 300, 65) === 5 && M.greif(1, 300, 125) === 6 && M.greif(1, 300, 185) === 7);
  t('Sitz 0 greift nie eine Figur von Sitz 1 - auch direkt darauf nicht', [0, 60, 120, 180].every(y => { const i = M.greif(0, 300, y); return i === -1 || (i >= 0 && i <= 3); }));
  t('den Ball (8) greift kein Sitz', [0, 1].every(s => { const i = M.greif(s, 150, 90); return i !== 8; }));
  // Enge Griffweite wie bei Tactical (BR*2.8 = 44.8 px bei BR 16): ein Tipp 50 px neben der eigenen
  // Figur greift nichts - sonst griffe ein Tipp auf eine fremde Figur die naechste eigene.
  t('die Griffweite ist die enge der Mehrfigurenregeln: 40 px trifft, 50 px nicht', M.greif(0, 40, 0) === 0 && M.greif(0, 50, 0) === -1);
  t('... im Quelltext: teamCap()>=2 -> BR*2.8, sonst BR*5', /const reach=teamCap\(\)>=2\?BR\*2\.8:BR\*5;/.test(HTML));
  M.setz({ fbVariant: 'elimination', myPlayer: 1, turnNo: 0, aimSet: [false, false] });
  t('Lebensregel: Sitz 1 darf in Runde 0 zielen (kein Wechselgatter)', M.wer() === 1 && M.darf(1) === true);
}

// ══ 6. ZUGMENGE: PRUEFUNG UND WIRKUNG ════════════════════════════════════════════
abschnitt('6. Zugmenge: eine eigene Figur aus vier startet, dieselbe darf wiederkommen');
function sandkasten() {
  return new Function([
    PRAEDIKATE,
    g(/const FB_ONLINE_SEATS=[^\n]*/, 'FB_ONLINE_SEATS'),
    g(/const TURN_MOVE=[^\n]*/, 'TURN_*'),
    g(/const FB_V9_VALID='VALID'[\s\S]*?;/, 'FB_V9_VALID (alle vier Kategorien)'),
    g(/const FB_V9_RAUS=[^\n]*/, 'FB_V9_RAUS'),
    g(/const FB_V9_NULLZUG=[^\n]*/, 'FB_V9_NULLZUG'),
    fn('fbV9Sitze'), fn('fbV9IdxGehoert'), fn('fbV9AcceptedOk'), fn('fbV9Wirken'),
    'function fbBotSpielt(){return false;}',
    fn('fbTacAktivSitz'), fn('fbTacOnline'), fn('fbTacDuell'), fn('fbTacAbwechselnd'),
    'let online=true, turnNo=0, gen=1, phase="aim", footballWinner=null;',
    'function fbV11Raum(){ return true; } let fbV11Passiv=[]; let fbElimActive=[true,true];',
    'function footballElimEliminate(){ throw new Error("Elimination im Tactical"); }',
    'let balls=[0,0,0,0,1,1,1,1,5].map(o=>({owner:o,alive:true}));',
    'let commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0], aimSet=[false,false];',
    'function resetCommits(){ commitIdx=[-1,-1]; commitAim=[{dx:0,dy:0},{dx:0,dy:0}]; commitSpin=[0,0]; aimSet=[false,false]; }',
    'const gestartet=[]; let reveals=0;',
    'function beginReveal(){ reveals++; }',
    'function applyLaunch(){ const l=[]; for(let s=0;s<2;s++) if(aimSet[s]&&commitIdx[s]>=0) l.push({seat:s,idx:commitIdx[s],dx:commitAim[s].dx}); gestartet.push(l); phase="sim"; }',
    'return { ok: fbV9AcceptedOk, wirken: fbV9Wirken, gestartet, setz:(o)=>{ if("turnNo" in o)turnNo=o.turnNo; if("gen" in o)gen=o.gen; if("fbVariant" in o)fbVariant=o.fbVariant; phase="aim"; }, stand:()=>({commitIdx:commitIdx.slice(),aimSet:aimSet.slice(),reveals}) };'
  ].join('\n'))();
}
{
  const S = sandkasten();
  const move = (seat, idx, dx) => ({ seat, kind: 'move', status: 'VALID', move: { idx, dx: dx === undefined ? 50 : dx, dy: 0, sp: 0 } });
  const pass = (seat) => ({ seat, kind: 'pass' });
  t('Sitz 0 darf jede seiner vier Figuren starten', [0, 1, 2, 3].every(i => S.ok([move(0, i), pass(1)], [0, 1]) === true));
  t('Sitz 0 darf keine Figur von Sitz 1 starten', [4, 5, 6, 7].every(i => S.ok([move(0, i), pass(1)], [0, 1]) === false));
  t('Sitz 0 darf nicht den Ball (8) starten, auch nichts ausserhalb', S.ok([move(0, 8), pass(1)], [0, 1]) === false && S.ok([move(0, 9), pass(1)], [0, 1]) === false);
  t('Sitz 1 darf jede seiner vier Figuren starten', [4, 5, 6, 7].every(i => S.ok([pass(0), move(1, i)], [0, 1]) === true));
  t('Sitz 1 darf keine Figur von Sitz 0 und nicht den Ball starten', [0, 1, 2, 3, 8].every(i => S.ok([pass(0), move(1, i)], [0, 1]) === false));
  S.setz({ turnNo: 0, gen: 1 });
  t('Runde 0: Sitz 0 zieht mit A3 (Koerper 2) -> genau Koerper 2 startet', S.wirken([move(0, 2), pass(1)], [0, 1]) === true && JSON.stringify(S.gestartet[0]) === JSON.stringify([{ seat: 0, idx: 2, dx: 50 }]), S.gestartet[0]);
  S.setz({ turnNo: 0, gen: 1 });
  t('Runde 0: ein formal gueltiger Zug des NICHT aktiven Sitzes 1 startet nichts', S.wirken([pass(0), move(1, 7)], [0, 1]) === true && S.gestartet[1].length === 0, S.gestartet[1]);
  S.setz({ turnNo: 1, gen: 1 });
  t('Runde 1: Sitz 1 zieht mit B4 (Koerper 7) -> genau Koerper 7 startet', S.wirken([pass(0), move(1, 7)], [0, 1]) === true && JSON.stringify(S.gestartet[2]) === JSON.stringify([{ seat: 1, idx: 7, dx: 50 }]));
  S.setz({ turnNo: 2, gen: 1 });
  t('Runde 2: Sitz 0 darf A3 (Koerper 2) ERNEUT starten - keine Rotation, keine Sperre', S.wirken([move(0, 2), pass(1)], [0, 1]) === true && JSON.stringify(S.gestartet[3]) === JSON.stringify([{ seat: 0, idx: 2, dx: 50 }]));
  S.setz({ turnNo: 3, gen: 1 });
  t('Runde 3: Sitz 1 darf B4 (Koerper 7) erneut starten', S.wirken([pass(0), move(1, 7)], [0, 1]) === true && JSON.stringify(S.gestartet[4]) === JSON.stringify([{ seat: 1, idx: 7, dx: 50 }]));
  S.setz({ turnNo: 0, gen: 2 });
  t('Generation 2, Runde 0: jetzt eroeffnet Sitz 1 - mit B1 (Koerper 4)', S.wirken([pass(0), move(1, 4)], [0, 1]) === true && JSON.stringify(S.gestartet[5]) === JSON.stringify([{ seat: 1, idx: 4, dx: 50 }]));
  t('jede angewandte Runde eroeffnet genau einmal die Enthuellung', S.stand().reveals === 6);
  S.setz({ turnNo: 0, gen: 1, fbVariant: 'tactical' });
  t('Tactical (2 Figuren): Sitz 0 darf Koerper 2 dort NICHT starten (gehoert Rot) - unveraendert', S.ok([move(0, 2), pass(1)], [0, 1]) === false && S.ok([move(0, 1), pass(1)], [0, 1]) === true);
}

// ══ 7. ZWEI CLIENTS, DIESELBE HISTORIE, ALLE ACHT FIGUREN ════════════════════════
abschnitt('7. Zwei getrennte Clients rechnen 24 Runden ueber alle acht Figuren identisch');
{
  const A = sandkasten(), B = sandkasten();
  const folge = [];
  // Sitz 0 zieht der Reihe nach 0,1,2,3,0,1,...; Sitz 1 zieht 7,6,5,4,7,... - jede Figur mehrfach.
  for (let tn = 0; tn < 24; tn++) {
    const aktiv = (tn + 1 + 1) % 2;
    const n = Math.floor(tn / 2);
    const idx = aktiv === 0 ? (n % 4) : (7 - (n % 4));
    folge.push(aktiv === 0
      ? [{ seat: 0, kind: 'move', status: 'VALID', move: { idx, dx: 30 + tn, dy: -tn, sp: 0 } }, { seat: 1, kind: 'pass' }]
      : [{ seat: 0, kind: 'pass' }, { seat: 1, kind: 'move', status: 'VALID', move: { idx, dx: -30 - tn, dy: tn, sp: 0 } }]);
  }
  let gleich = true, alleAngewandt = true;
  for (let tn = 0; tn < folge.length; tn++) {
    A.setz({ turnNo: tn, gen: 1 }); B.setz({ turnNo: tn, gen: 1 });
    const ra = A.wirken(folge[tn], [0, 1]), rb = B.wirken(folge[tn], [0, 1]);
    if (!ra || !rb) alleAngewandt = false;
    if (JSON.stringify(A.gestartet[tn]) !== JSON.stringify(B.gestartet[tn])) gleich = false;
  }
  t('24 Runden: beide Clients wenden jede Runde an', alleAngewandt);
  t('24 Runden: beide Clients starten in jeder Runde denselben Koerper mit demselben Vektor', gleich);
  t('24 Runden: in jeder Runde startet genau EIN Koerper', A.gestartet.every(l => l.length === 1));
  t('24 Runden: die Sitze wechseln sich strikt ab', A.gestartet.map(l => l[0].seat).join('') === '010101010101010101010101');
  t('24 Runden: jeder gestartete Koerper gehoert dem Sitz am Zug', A.gestartet.every(l => (l[0].seat === 0 && l[0].idx <= 3) || (l[0].seat === 1 && l[0].idx >= 4 && l[0].idx <= 7)));
  const benutzt = new Set(A.gestartet.map(l => l[0].idx));
  t('24 Runden: alle acht Figuren kamen zum Einsatz, jede mehrfach', benutzt.size === 8 && [0, 1, 2, 3, 4, 5, 6, 7].every(i => A.gestartet.filter(l => l[0].idx === i).length === 3));
}

// ══ 8. NAMENSSCHILDER ════════════════════════════════════════════════════════════
abschnitt('8. Namen: keine Schilder ueber den Figuren, der Name steht oben im Spielstand');
{
  const M = new Function([
    g(/const FOOTBALL_NEUTRAL_OWNER=\d+;[^\n]*/, 'FOOTBALL_NEUTRAL_OWNER'),
    'let mode="football", phase="aim", menuVisible=false;',
    'function fbTactical(){ return true; }',   // Tactical 4-Ball gehoert zur Tactical-Familie
    fn('nameLabelOn'),
    'return { on: nameLabelOn, N: FOOTBALL_NEUTRAL_OWNER };'
  ].join('\n'))();
  const k = (o) => ({ owner: o, alive: true });
  t('acht Figuren, null Schilder, ein Ball ohne', [0, 0, 0, 0, 1, 1, 1, 1, M.N].map(o => M.on(k(o))).every(v => v === false));
  t('auch waehrend der Physik bleiben die Schilder', (() => { const N = new Function('let mode="football", phase="sim", menuVisible=false; const FOOTBALL_NEUTRAL_OWNER=5;' + fn('nameLabelOn') + ';return nameLabelOn;')(); return N(k(0)) && N(k(1)) && !N(k(5)); })());
}

// ══ 9. DIE VERTRAEGE IM QUELLTEXT ════════════════════════════════════════════════
abschnitt('9. Vertraege im Quelltext, Hub, Lobby, Rules');
{
  t('fbTactical gilt fuer beide Varianten - Tactical-Regeln muessen nicht doppelt geschrieben werden', /function fbTactical\(\)\{return mode==='football'&&\(fbVariant===FOOTBALL_VARIANT_TACTICAL\|\|fbVariant===FOOTBALL_VARIANT_TACTICAL4\);\}/.test(HTML));
  t('fbTeam2 ist unveraendert', /function fbTeam2\(\)\{return mode==='football'&&fbVariant===FOOTBALL_VARIANT_TEAM2;\}/.test(HTML));
  t('teamCap nimmt die Figurenzahl aus fbTacFiguren', /function teamCap\(\)\{if\(typeof fbTactical==='function'&&fbTactical\(\)\)return \(typeof fbTacFiguren==='function'\)\?fbTacFiguren\(\):2;/.test(HTML));
  t('die 1-gegen-1-Auswahl fuehrt TACTICAL 4-BALL 1V1 in die Lobby', /\{key:'tactical4',\s+btn:'fbDuelTac4Btn'[^}]*\}/.test(HTML) && /function fbTactical4OnlineOeffnen\(\)/.test(HTML) && /if\(key==='tactical4'\)fbTactical4OnlineOeffnen\(\);/.test(HTML));
  t('die Option nennt den Modus und die vier Figuren', /id="fbDuelTac4T">TACTICAL 4-BALL 1V1</.test(HTML) && /id="fbDuelTac4S">4 FIGURES EACH · ALTERNATING TURNS</.test(HTML));
  t('die Tactical-Option bleibt unveraendert (2 Figuren)', /id="fbDuelTacS">2 FIGURES EACH · ALTERNATING TURNS</.test(HTML) && /\{key:'tactical',\s+btn:'fbDuelTacBtn'[^}]*\}/.test(HTML));
  t('der Onlineeinstieg prueft Tuning, 3D-Szene und Freigabe wie Tactical', /async function fbTactical4OnlineOeffnen\(\)\{\n  if\(TUNE\)[^\n]*\n  if\(!\(await r3dSichern\(true\)\)\)[^\n]*\n  if\(!fbOnlineFrei\(FB_ONLINE_MODE_TACTICAL4\)\)[^\n]*\n  fbOnlineMode=FB_ONLINE_MODE_TACTICAL4; fbOnlineCap=fbModeDefaultCap\(FB_ONLINE_MODE_TACTICAL4\);\n  fbOnlineEnter\(\);\n\}/.test(HTML));
  t('der Tactical-Raum-Begriff (Hoststart zu zweit, Lobbygatter) gilt fuer beide Modi', /function fbTacRaum\(\)\{ return fbOnlineRoom\(\)&&\(fbLobbyMode\(\)===FB_ONLINE_MODE_TACTICAL\|\|fbLobbyMode\(\)===FB_ONLINE_MODE_TACTICAL4\); \}/.test(HTML));
  t('die Raumanlage nimmt die Sitzzahl beider Tactical-Modi aus dem Register', /\(fbOnlineMode===FB_ONLINE_MODE_TACTICAL\|\|fbOnlineMode===FB_ONLINE_MODE_TACTICAL4\)\?fbModeDefaultCap\(fbOnlineMode\):fbOnlineCap/.test(HTML));
  t('die Lobby erklaert die vier Figuren und die abwechselnden Zuege', /T\(tac4\?'fbLobbyTac4How1':\(tac\?'fbLobbyTacHow1':'fbLobbyHow1'\)\)/.test(HTML) && /const tac=\(fmt===FB_ONLINE_FMT&&fbLobbyMode\(\)===FB_ONLINE_MODE_TACTICAL\)\|\|tac4;/.test(HTML));
  t('der HUD-Untertitel nennt den Modus: TACTICAL 4-BALL · Erster bis 3', /if\(typeof fbTac4==='function'&&fbTac4\(\)\)return 'TACTICAL 4-BALL · '\+fbFirstToText\(\);/.test(fn('fbModeText')));
  t('die alte Modusauswahl (?dev=1) kennt den Modus', /id="fbOnTactical4Btn"/.test(HTML) && /\$\('fbOnTactical4Btn'\)\.onclick=\(\)=>fbOnModePick\(FB_ONLINE_MODE_TACTICAL4\);/.test(HTML) && /tactical4:'fbOnTactical4'/.test(HTML));
  t('der Dev-Direktlink ?dev=1&fb=tactical4 und startFootball kennen die Variante', (HTML.match(/DEV_FB_VARIANT===FOOTBALL_VARIANT_TACTICAL4/g) || []).length === 2 && /variant===FOOTBALL_VARIANT_TACTICAL4\|\|/.test(fn('startFootball')));
  t('die Spielanbindung laeuft ueber fbTactical - also auch fuer Tactical 4-Ball', /\(typeof fbTactical==='function' && fbTactical\(\)\)/.test(fn('fbV9LebenAn')));
  t('fbV9Wirken startet nur den Koerper des Sitzes am Zug (unveraendert)', /if\(tacAktiv>=0&&e\.seat!==tacAktiv\)continue;/.test(fn('fbV9Wirken')));
  t('der passive Sitz traegt sein pass wie bei Tactical (fbTacPassivRunde ueber fbTacOnline)', /function fbTacOnline\(\)\{ return !!online&&fbTactical\(\); \}/.test(HTML));
  for (const l of ['en', 'de', 'tr']) {
    t(l + ': onModeTactical4 / onModeTactical4S / fbLobbyTac4How1 sind uebersetzt (die 1-gegen-1-Option liest diese Registerschluessel)',
      ['onModeTactical4', 'onModeTactical4S', 'fbLobbyTac4How1'].every(k => typeof I18N[l][k] === 'string' && I18N[l][k].length > 0)
      && /4/.test(I18N[l].onModeTactical4S));
  }
  const rules = require('fs').readFileSync(require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('die Rules kennen den Tactical-4-Ball-Raum (v11, Modus, Sitzzahl 2)', /newData\.val\(\) === 'tactical4'/.test(rules) && /newData\.val\(\) === 2 && newData\.parent\(\)\.child\('mode'\)\.val\(\) === 'tactical4'/.test(rules));
  // Seit 2026-09-22 ist tactical4 der EINZIGE Modus mit Zuggatter am Commit: Tactical 1v1
  // schiesst gleichzeitig, und die Rules nennen das Gatter deshalb nur noch fuer tactical4.
  t('die Rules erzwingen die Zugformel am Commit fuer tactical4 - und nur dort', /\(root\.child\('rooms'\)\.child\(\$code\)\.child\('config\/mode'\)\.val\(\) !== 'tactical4' \|\| newData\.child\('k'\)\.val\(\) !== 'move' \|\|/.test(rules)
    && !/!== 'tactical' && root\.child\('rooms'\)\.child\(\$code\)\.child\('config\/mode'\)\.val\(\) !== 'tactical4'\) \|\| newData\.child\('k'\)/.test(rules));   // das alte Doppelgatter (tactical UND tactical4) ist fort
  t('die Rules erzwingen den Koerperbesitz an der Enthuellung: Sitz 0 <= 3, Sitz 1 4..7', /\(\$seat === '0' && newData\.val\(\) <= 3\) \|\| \(\$seat === '1' && newData\.val\(\) >= 4 && newData\.val\(\) <= 7\)/.test(rules));
  t('... und die Obergrenze 5 der uebrigen Modi bleibt', /!== 'tactical4' && newData\.val\(\) <= 5 && newData\.val\(\) \+ '' === \$seat/.test(rules));
}

// ══ 10. DER CODEC: DIE VORLAGE TRAEGT AUCH DIE KOERPER 4..7 ══════════════════════
abschnitt('10. Codec: die Vorlage nimmt Koerper 0..8 in Tactical 4-Ball, sonst wie bisher bis 5');
{
  const M = new Function([
    PRAEDIKATE,
    g(/const FB_ONLINE_SEATS=\d+, FB_ONLINE_BALL_IDX=\d+;/, 'FB_ONLINE_BALL_IDX'),
    fn('fbV9IdxObergrenze'),
    'return { max: fbV9IdxObergrenze, setz: (v)=>{ fbVariant=v; }, BALL: FB_ONLINE_BALL_IDX };'
  ].join('\n'))();
  t('tactical4: die Obergrenze ist 8 (der Ball) - die Koerper 6 und 7 sind commitbar', M.max() === 8);
  M.setz('tactical');
  t('tactical: die Obergrenze bleibt 5 wie bisher', M.max() === 5 && M.BALL === 5);
  M.setz('elimination');
  t('Lebensregel: die Obergrenze bleibt der Ball (5)', M.max() === 5);
  M.setz('team2v2');
  t('Team 2v2: die Obergrenze bleibt der Ball (5)', M.max() === 5);
  t('die Vorlage liest die Obergrenze ueber den Helfer (typeof-geschuetzt fuer die Codec-Pruefstaende)', /b\[19\]=fbV9Int\(f\.idx,0,\(typeof fbV9IdxObergrenze==='function'\)\?fbV9IdxObergrenze\(\):FB_ONLINE_BALL_IDX\);/.test(fn('fbV9Preimage')));
  t('der Helfer liegt im Codec (vor ENDE V9-CODEC)', HTML.indexOf('function fbV9IdxObergrenze') < HTML.indexOf('// ════ ENDE V9-CODEC ════'));
}

console.log(`\nFootball-Tactical4-Online: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
