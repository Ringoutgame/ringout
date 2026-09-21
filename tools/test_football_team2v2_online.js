// ARENA FOOTBALL - TEAM 2V2 ONLINE: vier Menschen, zwei Teams, alle gleichzeitig.
//
// Online ist Team 2v2 ein v11-Raum mit genau vier Sitzen. Blau sitzt auf 0 und 1, Rot auf 2
// und 3; das Team folgt aus dem Sitz (fbTeam2Side), es gibt kein Teamfeld. Jeder Mensch fuehrt
// genau EINE Figur (Koerperindex = Sitz), Koerper 4 ist der neutrale Ball. Die Rundenmaschine
// ist woertlich die der Lebensregel: jeder Sitz zieht in jeder Runde, verdeckt, gleichzeitig;
// die Achtsekundenfrist schliesst offene Slots; getrennte Sitze werden uebersprungen.
//
// Geprueft werden ECHTE Funktionen aus index.html in kleinen Sandkaesten. Die Rules zu Team
// 2v2 prueft tools/test_rules.js (Abschnitt 19) gegen die echte firebase.rules.json.
//
//   node tools/test_football_team2v2_online.js
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

// ══ 1. MODUS, RAUMFASSUNG, VARIANTE, ISOLATION ═══════════════════════════════════
abschnitt('1. Register, Raumfassung und Variante - drei Modi, drei Vertraege');
{
  const M = new Function([
    'const ONLINE_PROTOCOL_VERSION=11; const DEV_MENU=false;',
    g(/const ROOM_GAME_RINGOUT=[^\n]*RINGOUT_SKIP_FASSUNG=\d+;/, 'ROOM_GAME + RINGOUT_SKIP_FASSUNG'),
    g(/const FOOTBALL_VARIANT_TACTICAL='[^']*';/, 'V_TACTICAL'),
    g(/const FOOTBALL_VARIANT_TEAM2='[^']*';/, 'V_TEAM2'),
    g(/const FOOTBALL_VARIANT_ELIM='[^']*';/, 'V_ELIM'),
    g(/const FB_ONLINE_MODE_CLASSIC=[\s\S]*?\nlet fbOnlineTeam=[^\n]*/, 'Modusregister'),
    g(/function fbTeam2Side\(o\)\{[^\n]*/, 'fbTeam2Side'),
    g(/function fbRaumFassung\(cfg\)\{[\s\S]*?\n\}/, 'fbRaumFassung'),
    fn('fbVarianteFuerModus'),
    'return { IDS: FB_ONLINE_MODE_IDS, def: fbModeDef, caps: fbModeCaps, rel: fbModeReleased, capOk: fbModeCapOk, defCap: fbModeDefaultCap,',
    '  fassung: fbRaumFassung, variante: fbVarianteFuerModus, seite: fbTeam2Side, sitze: fbTeam2SeatsOf, BLAU: FB_TEAM2_BLUE, ROT: FB_TEAM2_RED,',
    '  V: { tac: FOOTBALL_VARIANT_TACTICAL, t2: FOOTBALL_VARIANT_TEAM2, elim: FOOTBALL_VARIANT_ELIM } };'
  ].join('\n'))();
  const cfg = (mode, cap) => ({ game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'private', mode, cap });
  t('das Register kennt team2v2 mit genau vier Sitzen', M.caps('team2v2').join(',') === '4' && M.defCap('team2v2') === 4 && M.capOk('team2v2', 4) && !M.capOk('team2v2', 3) && !M.capOk('team2v2', 5));
  t('Team 2v2 ist freigegeben', M.rel('team2v2') === true);
  t('Lebensregel und Tactical bleiben freigegeben, Classic/Speed/Timed FFA gesperrt', M.rel('lives') && M.rel('tactical') && !M.rel('classic') && !M.rel('speed') && !M.rel('timedffa'));
  t('ein Team-2v2-Raum mit vier Sitzen ist ein v11-Raum', M.fassung(cfg('team2v2', 4)) === 11);
  t('mit anderer Sitzzahl faellt er auf v8 zurueck (die Rules kennen ihn dort nur als Lobby)', M.fassung(cfg('team2v2', 5)) === 8 && M.fassung(cfg('team2v2', 2)) === 8);
  t('Tactical (2) und Lebensregel (5) bleiben v11', M.fassung(cfg('tactical', 2)) === 11 && M.fassung(cfg('lives', 5)) === 11);
  t('die Variante folgt dem Modus: team2v2 -> Team 2v2, tactical -> Tactical, lives -> Elimination',
    M.variante('team2v2') === M.V.t2 && M.variante('tactical') === M.V.tac && M.variante('lives') === M.V.elim);
  t('drei Modi, drei verschiedene Varianten - keine zwei Modi teilen sich eine Regel', new Set([M.variante('team2v2'), M.variante('tactical'), M.variante('lives')]).size === 3);
  // Der Sitzvertrag: Blau 0/1, Rot 2/3 - dieselbe Zuordnung in Lobby (FB_TEAM2_SEATS) und Spiel (fbTeam2Side).
  t('Teams aus dem Sitz: 0,1 -> Blau, 2,3 -> Rot, Ball (5) -> keines', [0, 1, 2, 3, 4, 5].map(o => M.seite(o)).join(',') === '0,0,1,1,-1,-1');
  t('die Lobby-Sitzlisten sagen dasselbe', M.sitze(M.BLAU).join(',') === '0,1' && M.sitze(M.ROT).join(',') === '2,3');
}

// ══ 2. EINE FIGUR JE MENSCH, DER BALL GEHOERT NIEMANDEM ═════════════════════════
abschnitt('2. Koerperbesitz: Koerperindex = Sitz, der Ball ist frei');
{
  const M = new Function([
    'let mode="football", fbVariant="team2v2";',
    'function fbTactical(){ return mode==="football"&&fbVariant==="tactical"; }',
    fn('fbV9IdxGehoert'),
    'return { g: fbV9IdxGehoert };'
  ].join('\n'))();
  t('jeder der vier Sitze fuehrt genau seinen Koerper', [0, 1, 2, 3].every(s => M.g(s, s)));
  t('kein Sitz fuehrt den Koerper des Teamkollegen', !M.g(0, 1) && !M.g(1, 0) && !M.g(2, 3) && !M.g(3, 2));
  t('kein Sitz fuehrt einen Koerper des Gegners', !M.g(0, 2) && !M.g(0, 3) && !M.g(2, 0) && !M.g(3, 1));
  t('niemand fuehrt den Ball (4)', [0, 1, 2, 3].every(s => !M.g(s, 4)));
}

// ══ 3. EINGABEGATTER: ALLE VIER GLEICHZEITIG, JEDER NUR SEINEN ══════════════════
abschnitt('3. Eingabe: alle vier gleichzeitig, jeder nur die eigene Figur');
{
  const M = new Function([
    'let r3dOrbit=false, phase="aim", online=true, myPlayer=0, turnNo=0, gen=1;',
    'let mode="football", fbVariant="team2v2", aimSet=[false,false,false,false], curAimer=0;',
    'function inputLocked(){ return false; } function r3dInputBlocked(){ return false; }',
    'function aliveCount(o){ return 1; } function fbV9EingabeOffen(){ return true; }',
    'function fbShared(){ return false; } function fbOffen(){ return []; } function fbElim4(){ return false; }',
    'function fbTactical(){ return mode==="football"&&fbVariant==="tactical"; }',
    fn('fbTacAktivSitz'), fn('fbTacOnline'), fn('fbTacAmZug'),
    fn('whoCanAim'), fn('canCommitInput'),
    g(/function pickOwnBall\(who,p\)\{[^\n]*/, 'pickOwnBall'),
    'const BR=16; function teamCap(){ return 1; }',
    // Reichweite des Griffs: BR*5 = 80 px. Die Koerper stehen 60 px auseinander, der Ball
    // (Besitzer 5) zwischen Sitz 1 und 2 - jeder Griff hat also eine FREMDE Figur naeher.
    'let balls=[{owner:0,alive:true,x:0,y:0},{owner:1,alive:true,x:60,y:0},{owner:2,alive:true,x:120,y:0},{owner:3,alive:true,x:180,y:0},{owner:5,alive:true,x:90,y:0}];',
    'return { wer: whoCanAim, darf: canCommitInput, greif: (who,x)=>pickOwnBall(who,{x:x,y:0}), setz:(o)=>{ if("myPlayer" in o)myPlayer=o.myPlayer; if("aimSet" in o)aimSet=o.aimSet; if("turnNo" in o)turnNo=o.turnNo; } };'
  ].join('\n'))();
  for (let s = 0; s < 4; s++) { M.setz({ myPlayer: s, aimSet: [false, false, false, false], turnNo: 0 });
    t('Runde 0: Sitz ' + s + ' darf zielen - gleichzeitig mit allen anderen', M.wer() === s && M.darf(s) === true); }
  for (let s = 0; s < 4; s++) { M.setz({ myPlayer: s, aimSet: [false, false, false, false], turnNo: 1 });
    t('Runde 1: Sitz ' + s + ' darf wieder zielen (kein Wechselgatter wie bei Tactical)', M.wer() === s); }
  M.setz({ myPlayer: 2, aimSet: [false, false, true, false] });
  t('nach dem eigenen Zug ist die Eingabe des Sitzes zu (kein zweiter Zug in derselben Runde)', M.wer() === -1);
  // Der Griff findet nur die EIGENE Figur - auch wenn eine fremde naeher liegt.
  t('der Griff von Sitz 0 trifft nur Koerper 0, auch direkt neben dem Teamkollegen (1)', M.greif(0, 45) === 0);
  t('der Griff von Sitz 2 trifft nur Koerper 2, nicht den Teamkollegen (3) und nicht den Gegner (1)', M.greif(2, 175) === 2 && M.greif(2, 65) === 2);
  t('den Ball (Besitzer 5) greift kein Sitz - direkt auf dem Ball findet jeder nur sich oder nichts',
    M.greif(1, 90) === 1 && M.greif(2, 90) === 2 && M.greif(0, 90) === -1 && M.greif(3, 90) === -1);
  t('ausser Reichweite greift niemand', M.greif(0, 200) === -1);
}

// ══ 4. ZUGMENGE: VIER ZUEGE, EINE AUFLOESUNG ════════════════════════════════════
abschnitt('4. Zugmenge: vier Zuege in einer Runde, gemeinsam angewandt');
function sandkasten() {
  return new Function([
    g(/const FB_ONLINE_SEATS=[^\n]*/, 'FB_ONLINE_SEATS'),
    g(/const TURN_MOVE=[^\n]*/, 'TURN_*'),
    g(/const FB_V9_VALID='VALID'[\s\S]*?;/, 'FB_V9_VALID'),
    g(/const FB_V9_RAUS=[^\n]*/, 'FB_V9_RAUS'),
    g(/const FB_V9_NULLZUG=[^\n]*/, 'FB_V9_NULLZUG'),
    fn('fbV9Sitze'), fn('fbV9IdxGehoert'), fn('fbV9AcceptedOk'), fn('fbV9Wirken'),
    fn('fbTacAktivSitz'), fn('fbTacOnline'),
    'let online=true, mode="football", fbVariant="team2v2", turnNo=0, gen=1, phase="aim", footballWinner=null;',
    'function fbTactical(){ return mode==="football"&&fbVariant==="tactical"; }',
    'function fbV11Raum(){ return true; } let fbV11Passiv=[]; let fbElimActive=[true,true,true,true];',
    'function footballElimEliminate(){ throw new Error("Elimination im Team 2v2"); }',
    'let balls=[{owner:0,alive:true},{owner:1,alive:true},{owner:2,alive:true},{owner:3,alive:true},{owner:5,alive:true}];',
    'let commitIdx=[-1,-1,-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0},{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0,0,0], aimSet=[false,false,false,false];',
    'function resetCommits(){ commitIdx=[-1,-1,-1,-1]; commitAim=[{dx:0,dy:0},{dx:0,dy:0},{dx:0,dy:0},{dx:0,dy:0}]; commitSpin=[0,0,0,0]; aimSet=[false,false,false,false]; }',
    'const gestartet=[]; let reveals=0;',
    'function beginReveal(){ reveals++; }',
    'function applyLaunch(){ const l=[]; for(let s=0;s<4;s++) if(aimSet[s]&&commitIdx[s]>=0) l.push({seat:s,idx:commitIdx[s],dx:commitAim[s].dx}); gestartet.push(l); phase="sim"; }',
    'return { ok: fbV9AcceptedOk, wirken: fbV9Wirken, gestartet, passiv: fbV11Passiv, setz:(o)=>{ if("turnNo" in o)turnNo=o.turnNo; phase="aim"; }, stand:()=>({reveals}) };'
  ].join('\n'))();
}
{
  const S = sandkasten();
  const move = (seat, idx, dx) => ({ seat, kind: 'move', status: 'VALID', move: { idx, dx: dx === undefined ? 50 : dx, dy: 0, sp: 0 } });
  const alle = (dx) => [0, 1, 2, 3].map(s => move(s, s, (dx || 50) + s));
  t('vier eigene Zuege sind eine gueltige Zugmenge', S.ok(alle(), [0, 1, 2, 3]) === true);
  t('ein Zug auf den Koerper des Teamkollegen macht die Menge ungueltig', S.ok([move(0, 1), move(1, 1), move(2, 2), move(3, 3)], [0, 1, 2, 3]) === false);
  t('ein Zug auf den Ball macht die Menge ungueltig', S.ok([move(0, 0), move(1, 1), move(2, 4), move(3, 3)], [0, 1, 2, 3]) === false);
  t('drei Zuege und ein pass sind gueltig', S.ok([move(0, 0), move(1, 1), { seat: 2, kind: 'pass' }, move(3, 3)], [0, 1, 2, 3]) === true);
  t('drei Zuege und ein skip (getrennt) sind gueltig', S.ok([move(0, 0), { seat: 1, kind: 'skip' }, move(2, 2), move(3, 3)], [0, 1, 2, 3]) === true);
  t('eine Menge mit nur drei Eintraegen ist keine Runde zu viert', S.ok([move(0, 0), move(1, 1), move(2, 2)], [0, 1, 2, 3]) === false);
  S.setz({ turnNo: 0 });
  t('alle vier Zuege werden in EINER Aufloesung gestartet - jeder Koerper mit dem eigenen Vektor',
    S.wirken(alle(), [0, 1, 2, 3]) === true && JSON.stringify(S.gestartet[0]) === JSON.stringify([{ seat: 0, idx: 0, dx: 50 }, { seat: 1, idx: 1, dx: 51 }, { seat: 2, idx: 2, dx: 52 }, { seat: 3, idx: 3, dx: 53 }]), S.gestartet[0]);
  S.setz({ turnNo: 1 });
  t('Runde 1: wieder alle vier - kein Sitz wird uebergangen (kein Tactical-Gatter)', S.wirken(alle(60), [0, 1, 2, 3]) === true && S.gestartet[1].length === 4);
  S.setz({ turnNo: 2 });
  t('ein Sitz mit skip (getrennt) startet nicht, die drei anderen schon',
    S.wirken([move(0, 0), { seat: 1, kind: 'skip' }, move(2, 2), move(3, 3)], [0, 1, 2, 3]) === true && S.gestartet[2].map(x => x.seat).join(',') === '0,2,3');
  S.setz({ turnNo: 3 });
  t('ein Sitz mit late (Frist) startet nicht - Nullzug, kein Ausschluss',
    S.wirken([move(0, 0), move(1, 1), { seat: 2, kind: 'late' }, move(3, 3)], [0, 1, 2, 3]) === true && S.gestartet[3].map(x => x.seat).join(',') === '0,1,3' && !S.passiv[2]);
  S.setz({ turnNo: 4 });
  t('ein Sitz mit remove (Austritt) wird passiv, die drei anderen spielen weiter',
    S.wirken([move(0, 0), move(1, 1), move(2, 2), { seat: 3, kind: 'remove' }], [0, 1, 2, 3]) === true && S.passiv[3] === true && S.gestartet[4].length === 3);
  S.setz({ turnNo: 5 });
  t('ein passiver Sitz schiesst auch mit formal gueltigem Zug nicht mehr',
    S.wirken(alle(70), [0, 1, 2, 3]) === true && S.gestartet[5].map(x => x.seat).join(',') === '0,1,2');
  t('jede angewandte Runde eroeffnet genau einmal die Enthuellung', S.stand().reveals === 6);
}

// ══ 5. BEREITSCHAFT: 4/4, GETRENNT ZAEHLT ALS ABGESCHLOSSEN ═════════════════════
abschnitt('5. Bereitschaft je Sitz aus dem Raum - der Nenner sind die Handlungsfaehigen');
{
  const M = new Function([
    g(/const FB_ONLINE_SEATS=[^\n]*/, 'FB_ONLINE_SEATS'),
    g(/const FB_V9_TERMINALS=[^\n]*/, 'FB_V9_TERMINALS'),
    g(/const FB_V9_HEX_SALT_RE=[^\n]*/, 'HEX_RE'),
    g(/const FB_V9_DEADLINE_MS=\d+;[^\n]*/, 'FB_V9_DEADLINE_MS'),
    g(/const FB_V10_DEADLINE_MS=\d+;/, 'FB_V10_DEADLINE_MS'),
    fn('fbV9TerminalOk'), fn('fbV9Sitze'), fn('fbV9CtxBesetzung'), fn('fbV9LebenDraussen'), fn('fbV9DisqualifyOk'), fn('fbV9FristMs'),
    'let fbV9Leben=null; function fbV9LebenAktuell(L){ return !!L && fbV9Leben===L; }',
    fn('fbV9HudStand'),
    'const H="e".repeat(64);',
    'return { stand:(c,e,x)=>{ fbV9Leben={ctx:{v:9,code:"KX7P",gen:1,turn:0,seat:0,cap:4,proto:11,teil:[0,1,2,3]},rausStand:{d:{n:0,o:1000},c:c,e:e||null,x:x||null}}; return fbV9HudStand(); }, H };'
  ].join('\n'))();
  const mv = { k: 'move', h: M.H, ts: 1 }, pass = { k: 'pass', ts: 1 }, skip = { k: 'skip', ts: 1 }, late = { k: 'late', ts: 1 };
  let h = M.stand({});
  t('0/4: niemand hat abgegeben', h.bereit === 0 && h.gesamt === 4 && h.sitzBereit.slice(0, 4).join(',') === 'false,false,false,false');
  h = M.stand({ 0: mv, 2: mv });
  t('2/4: zwei Terminals - je Sitz nachvollziehbar (0 und 2)', h.bereit === 2 && h.gesamt === 4 && h.sitzBereit.slice(0, 4).join(',') === 'true,false,true,false');
  h = M.stand({ 0: mv, 1: mv, 2: mv });
  t('3/4: der eigene Sitz ist bereit, einer fehlt noch', h.bereit === 3 && h.eigenBereit === true);
  h = M.stand({ 0: mv, 1: mv, 2: mv, 3: mv });
  t('4/4: die Runde ist vollstaendig', h.bereit === 4 && h.gesamt === 4);
  h = M.stand({ 0: mv, 1: skip, 2: mv, 3: pass });
  t('ein getrennter Sitz (skip) und ein pass zaehlen als abgeschlossen: 4/4', h.bereit === 4 && h.gesamt === 4);
  h = M.stand({ 0: mv, 1: mv, 2: mv }, { 3: true });
  t('ein ausgetragener Sitz (e) verlaesst den Nenner: 3/3', h.bereit === 3 && h.gesamt === 3);
  h = M.stand({ 0: late, 1: mv, 2: mv, 3: mv });
  t('ein fremd geschlossener eigener Slot (late) heisst: Frist verpasst, nicht bereit', h.eigenVerpasst === true && h.eigenBereit === false && h.bereit === 4);
  t('das Fenster ist das v11-Fenster von acht Sekunden', h.fenster === 8000);
}

// ══ 6. NAMEN UND TEAMFARBEN ═════════════════════════════════════════════════════
abschnitt('6. Vier Namen, zwei Teamfarben, kein Schild auf dem Ball');
{
  const M = new Function([
    g(/const FOOTBALL_NEUTRAL_OWNER=\d+;[^\n]*/, 'FOOTBALL_NEUTRAL_OWNER'),
    g(/const NAME_COL=\[[^\n]*/, 'NAME_COL'),
    g(/const FB_NAME_COL=\[[^\n]*/, 'FB_NAME_COL'),
    'let mode="football", phase="aim", menuVisible=false, fmt="elimination", fbVariant="team2v2";',
    'function fbTeam2(){ return mode==="football"&&fbVariant==="team2v2"; }',
    g(/function fbTeam2Side\(o\)\{[^\n]*/, 'fbTeam2Side'),
    'function teamOf(o){ return o&1; }',
    g(/function colorSlot\(owner\)\{[^\n]*/, 'colorSlot'),
    g(/function ncol\(i\)\{[^\n]*/, 'ncol'),
    fn('nameLabelOn'),
    'return { on: nameLabelOn, farbe:(o)=>ncol(colorSlot(o)), slot: colorSlot, N: FOOTBALL_NEUTRAL_OWNER };'
  ].join('\n'))();
  const k = (o) => ({ owner: o, alive: true });
  t('alle vier Figuren tragen ein Schild', [0, 1, 2, 3].every(o => M.on(k(o))));
  t('der neutrale Ball traegt keines', M.on(k(M.N)) === false);
  t('beide Blauen tragen dieselbe Namensfarbe, beide Roten dieselbe', M.farbe(0) === M.farbe(1) && M.farbe(2) === M.farbe(3));
  t('Blau und Rot sind verschieden', M.farbe(0) !== M.farbe(2));
  t('die Farbe ist das Team, nicht die Person (Farbslot 0/0/1/1)', [0, 1, 2, 3].map(o => M.slot(o)).join(',') === '0,0,1,1');
}

// ══ 7. VERTRAEGE IM QUELLTEXT ═══════════════════════════════════════════════════
abschnitt('7. Vertraege im Quelltext');
{
  t('die Spielanbindung laeuft fuer Elimination, Tactical UND Team 2v2', /\|\|\(typeof fbTeam2==='function' && fbTeam2\(\)\)\)/.test(fn('fbV9LebenAn')));
  t('der Hoststart verlangt genau die Sitze 0,1,2,3', /fbTeam2Room\(\)&&!\(da\.length===FB_TEAM2_SITZE&&da\[0\]===0&&da\[1\]===1&&da\[2\]===2&&da\[3\]===3\)\)return;/.test(fn('fbV11Starten')));
  t('die Lobby startet Team 2v2 nur zu viert', /const genau=tac\?FB_TAC_SITZE:\(\(typeof fbTeam2Room==='function'&&fbTeam2Room\(\)\)\?FB_TEAM2_SITZE:0\);/.test(fn('fbV11Lobby')));
  t('online ist das gemeinsame Hotseat-Fenster aus: jeder Client greift nur seinen Sitz', /\|\|\(fbTeam2\(\)&&!online\);/.test(fn('fbShared')));
  t('der Hub fuehrt die Team-2v2-Karte direkt in die Lobby', /\{key:'team2v2',\s+card:'cardFb2v2'[^}]*direkt:true\}/.test(HTML) && /function fbTeam2OnlineOeffnen\(\)/.test(HTML));
  const bar = fn('renderTeam2Bar');
  // Die Leiste LIEST die Raumbereitschaft aus einer Ablage, die die v9-Anbindung je Bild
  // fuellt - sie ruft die v9-Auskunft nicht selbst (die bleibt im v9-Bereich).
  t('die Chipleiste liest online die Bereitschaft aus dem Raum und traegt die Namen',
    /const raum=online\?fbTeam2BereitOnline:null;/.test(bar) && /raum\?!!raum\[o\]:!!aimSet\[o\]/.test(bar)
    && /online\?pName\(o\):FOOTBALL_TEAM2V2_NAMES\[o\]/.test(bar) && bar.indexOf('fbV9HudStand') < 0);
  const hud = fn('fbV9HudPaint');
  t('das HUD zeigt Team 2v2 den Zaehler bereit/gesamt und hinterlegt die Sitzbereitschaft fuer die Leiste',
    /zaehler=h\.bereit\+'\/'\+h\.gesamt;/.test(hud) && /fbTeam2BereitOnline=offen\?h\.sitzBereit:null;/.test(hud)
    && /if\(sig!==fbTeam2BereitSig\)\{/.test(hud));
  t('die Wertung bleibt die Teamwertung nach Torseite, Erster bis 3', /if\(typeof fbTeam2==='function'&&fbTeam2\(\)\)return 'TEAM 2V2 · '\+fbFirstToText\(\);/.test(HTML));
  t('der Wirt eines Team-2v2-Raums sitzt auf dem ersten Sitz seiner Seite', /wirtSitz=fbTeam2SeatsOf\(fbOnlineTeam\)\[0\];/.test(HTML));
  const rules = require('fs').readFileSync(require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('die Rules kennen den Team-2v2-Raum (v11, Modus, vier Sitze)', /newData\.val\(\) === 'team2v2'\)\)/.test(rules) && /newData\.val\(\) === 4 && newData\.parent\(\)\.child\('mode'\)\.val\(\) === 'team2v2'/.test(rules));
  t('die Rules lassen den Team-2v2-Wirt auf Sitz 2 anlegen', /\(newData\.child\('v'\)\.val\(\) === 11 && newData\.child\('config\/mode'\)\.val\(\) === 'team2v2'\)\) && newData\.child\('hostUid'\)\.val\(\) === auth\.uid/.test(rules));
  t('die Rules verlangen fuer den Start alle vier Sitze', /child\('config\/mode'\)\.val\(\) !== 'team2v2' \|\| \(newData\.child\('0'\)\.val\(\) === true && newData\.child\('1'\)\.val\(\) === true && newData\.child\('2'\)\.val\(\) === true && newData\.child\('3'\)\.val\(\) === true\)/.test(rules));
}

console.log(`\nFootball-Team2v2-Online: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
