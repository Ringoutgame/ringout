// ARENA FOOTBALL - TACTICAL 1V1 ONLINE: zwei Figuren je Spieler, GLEICHZEITIGE Zuege.
//
// Seit 2026-09-22 ist Tactical 1v1 online ein gleichzeitiges Zwei-Sitze-Spiel auf der
// Rundenmaschine der Lebensregel (dieselbe wie FFA und Team 2v2): beide Sitze entscheiden in
// jeder Runde zur selben Zeit, jeder waehlt EINE seiner zwei Figuren und gibt genau EINEN Zug
// ab; beide Zuege starten in DERSELBEN Simulation, alle fuenf Koerper kollidieren. Es gibt
// keinen aktiven Sitz, keinen Eroeffner, keinen Wechsel nach einem Tor oder Rematch. Stehen
// beide Terminals, loest die Runde sofort auf; fehlt eines, schliesst die Achtsekundenfrist es
// kanonisch (late/skip). Sitz 0 fuehrt B1/B2 (Koerper 0/1), Sitz 1 fuehrt R1/R2 (2/3),
// Koerper 4 ist der neutrale Ball. TACTICAL 4-BALL bleibt abwechselnd - das Zugmodell haengt an
// fbTacAbwechselnd()/fbTacGleichzeitig(), nie an fbTactical() (tools/test_football_tactical4_online.js).
//
// Geprueft werden ECHTE Funktionen aus index.html in kleinen Sandkaesten: Register und
// Raumfassung, das Zugmodell je Variante, der Koerperbesitz, die Eingabegatter, die
// Zugmengenpruefung und -wirkung (beide Zuege in einer Runde), zwei Clients ueber 20 Runden,
// die Namensschilder und die Vertraege im Quelltext, im HUD, in der Lobby und in den Rules.
// Die Rules selbst prueft tools/test_rules.js (Abschnitt 18) gegen die echte firebase.rules.json.
//
//   node tools/test_football_tactical_online.js
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
  'let mode="football", fbVariant="tactical";',
  fn('fbTactical'), fn('fbTac4'),
  g(/const FB_TAC_FIGUREN=\d+, FB_TAC4_FIGUREN=\d+;/, 'FB_TAC_FIGUREN'),
  fn('fbTacFiguren')
].join('\n');

// ══ 1. REGISTER UND RAUMFASSUNG ══════════════════════════════════════════════════
abschnitt('1. Register, Raumfassung und Variante');
{
  const M = new Function([
    'const ONLINE_PROTOCOL_VERSION=11; const DEV_MENU=false;',
    g(/const ROOM_GAME_RINGOUT=[^\n]*RINGOUT_SKIP_FASSUNG=\d+;/, 'ROOM_GAME + RINGOUT_SKIP_FASSUNG'),
    g(/const FOOTBALL_VARIANT_TACTICAL='[^']*';/, 'V_TACTICAL'),
    g(/const FOOTBALL_VARIANT_TEAM2='[^']*';/, 'V_TEAM2'),
    g(/const FOOTBALL_VARIANT_ELIM='[^']*';/, 'V_ELIM'),
    g(/const FB_ONLINE_MODE_CLASSIC=[\s\S]*?\nlet fbOnlineTeam=[^\n]*/, 'Modusregister'),
    g(/function fbRaumFassung\(cfg\)\{[\s\S]*?\n\}/, 'fbRaumFassung'),
    fn('fbVarianteFuerModus'),
    'return { IDS: FB_ONLINE_MODE_IDS, def: fbModeDef, caps: fbModeCaps, rel: fbModeReleased, capOk: fbModeCapOk, defCap: fbModeDefaultCap,',
    '  fassung: fbRaumFassung, variante: fbVarianteFuerModus, TAC: FB_ONLINE_MODE_TACTICAL, SITZE: FB_TAC_SITZE,',
    '  V_TAC: FOOTBALL_VARIANT_TACTICAL, V_TEAM2: FOOTBALL_VARIANT_TEAM2, V_ELIM: FOOTBALL_VARIANT_ELIM };'
  ].join('\n'))();
  t('das Register kennt tactical', M.IDS.indexOf('tactical') >= 0 && !!M.def('tactical'));
  t('Tactical fasst genau zwei Sitze', M.caps('tactical').join(',') === '2' && M.capOk('tactical', 2) && !M.capOk('tactical', 3) && M.defCap('tactical') === 2);
  t('... und FB_TAC_SITZE sagt dasselbe', M.SITZE === 2);
  t('Tactical ist freigegeben', M.rel('tactical') === true);
  t('die Lebensregel ist unveraendert freigegeben, Classic/Speed/Timed FFA gesperrt', M.rel('lives') === true && !M.rel('classic') && !M.rel('speed') && !M.rel('timedffa'));
  const cfg = (mode, cap) => ({ game: 'football', winTarget: 3, fmt: 'elimination', visibility: 'private', mode, cap });
  t('ein Tactical-Raum mit zwei Sitzen ist ein v11-Raum', M.fassung(cfg('tactical', 2)) === 11);
  t('ein Tactical-Raum mit anderer Sitzzahl faellt auf v8 zurueck (die Rules kennen ihn nicht)', M.fassung(cfg('tactical', 5)) === 8 && M.fassung(cfg('tactical', 3)) === 8);
  t('ein Lives-Raum bleibt v11', M.fassung(cfg('lives', 5)) === 11);
  t('die Variante folgt dem Modus: tactical -> Tactical', M.variante('tactical') === M.V_TAC);
  t('... team2v2 -> Team 2v2, jeder andere Modus -> Elimination', M.variante('lives') === M.V_ELIM && M.variante('team2v2') === M.V_TEAM2 && M.variante('') === M.V_ELIM);
}

// ══ 2. DAS ZUGMODELL JE VARIANTE ═════════════════════════════════════════════════
abschnitt('2. Zugmodell: Tactical 1v1 gleichzeitig, Tactical 4-Ball abwechselnd - getrennt durch einen Helfer');
{
  const M = new Function([
    PRAEDIKATE,
    'let online=true, turnNo=0, gen=1;',
    fn('fbTacAktivSitz'), fn('fbTacOnline'), fn('fbTacAbwechselnd'), fn('fbTacGleichzeitig'), fn('fbTacAmZug'), fn('fbTacPassivRunde'),
    'return { ab: fbTacAbwechselnd, gl: fbTacGleichzeitig, passiv: fbTacPassivRunde, aktiv: fbTacAktivSitz,',
    '  setz: (o)=>{ if("online" in o)online=o.online; if("fbVariant" in o)fbVariant=o.fbVariant; if("mode" in o)mode=o.mode; if("turnNo" in o)turnNo=o.turnNo; if("gen" in o)gen=o.gen; } };'
  ].join('\n'))();
  M.setz({ online: true, fbVariant: 'tactical', mode: 'football' });
  t('Tactical 1v1 online ist GLEICHZEITIG, nicht abwechselnd', M.gl() === true && M.ab() === false);
  let passivJe = false;
  for (const gn of [1, 2, 3]) for (const tn of [0, 1, 2, 10, 11]) for (const s of [0, 1]) if (M.passiv({ turn: tn, gen: gn, seat: s })) passivJe = true;
  t('Tactical 1v1: in KEINER Runde, Generation oder auf keinem Sitz gibt es einen passiven Sitz (kein Auto-pass)', passivJe === false);
  M.setz({ fbVariant: 'tactical4' });
  t('Tactical 4-Ball online ist ABWECHSELND, nicht gleichzeitig', M.ab() === true && M.gl() === false);
  t('Tactical 4-Ball: der Sitz, der nicht am Zug ist, ist passiv (Formel unveraendert)', M.passiv({ turn: 0, gen: 1, seat: 1 }) === true && M.passiv({ turn: 0, gen: 1, seat: 0 }) === false
    && M.passiv({ turn: 1, gen: 1, seat: 0 }) === true && M.passiv({ turn: 0, gen: 2, seat: 0 }) === true);
  t('die Zugformel selbst ist unveraendert (Sitz 0 eroeffnet Generation 1, jede Runde und jedes Rematch wechselt)',
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map(tn => M.aktiv(tn, 1)).join('') === '010101010' && M.aktiv(0, 2) === 1 && M.aktiv(0, 3) === 0 && [9, 10, 11].map(tn => M.aktiv(tn, 1)).join('') === '101');
  M.setz({ fbVariant: 'tactical', online: false });
  t('lokal (offline) gilt keines der beiden Onlinemodelle', M.ab() === false && M.gl() === false);
  M.setz({ online: true, fbVariant: 'elimination' });
  t('die Lebensregel ist weder das eine noch das andere Tactical-Modell', M.ab() === false && M.gl() === false && M.passiv({ turn: 0, gen: 1, seat: 1 }) === false);
  M.setz({ fbVariant: 'team2v2' });
  t('Team 2v2 ebenso wenig', M.ab() === false && M.gl() === false);
  t('ohne Zusammenhang gibt es keinen passiven Sitz', (M.setz({ fbVariant: 'tactical4' }), M.passiv(null) === false));
}

// ══ 3. KOERPERBESITZ ═════════════════════════════════════════════════════════════
abschnitt('3. Koerperbesitz: Sitz s fuehrt 2s und 2s+1, der Ball gehoert niemandem');
{
  const M = new Function([
    'let tac=true; function fbTactical(){ return tac; }',
    fn('fbV9IdxGehoert'),
    'return { g: fbV9IdxGehoert, setz: (v)=>{ tac=v; } };'
  ].join('\n'))();
  t('Tactical: Sitz 0 fuehrt Koerper 0 und 1', M.g(0, 0) && M.g(0, 1));
  t('Tactical: Sitz 1 fuehrt Koerper 2 und 3', M.g(1, 2) && M.g(1, 3));
  t('Tactical: Sitz 0 fuehrt NICHT 2, 3 oder den Ball (4)', !M.g(0, 2) && !M.g(0, 3) && !M.g(0, 4));
  t('Tactical: Sitz 1 fuehrt NICHT 0, 1 oder den Ball (4)', !M.g(1, 0) && !M.g(1, 1) && !M.g(1, 4));
  M.setz(false);
  t('Lebensregel: der Koerperindex ist der Sitz - unveraendert', M.g(0, 0) && M.g(3, 3) && !M.g(0, 1) && !M.g(2, 5));
}

// ══ 4. EINGABEGATTER ═════════════════════════════════════════════════════════════
abschnitt('4. Eingabegatter: beide Sitze greifen, zielen und bestaetigen in derselben Runde - jeder einmal');
{
  const M = new Function([
    PRAEDIKATE,
    'let r3dOrbit=false, phase="aim", online=true, myPlayer=0, turnNo=0, gen=1;',
    'let aimSet=[false,false], curAimer=0;',
    'function inputLocked(){ return false; } function r3dInputBlocked(){ return false; }',
    'function aliveCount(o){ return 2; } function fbV9EingabeOffen(){ return true; }',
    'function fbShared(){ return false; } function fbOffen(){ return []; } function fbElim4(){ return false; }',
    // Das echte Praedikat an einem gestellten Lebenslauf: aktuell, mit oder ohne Handlung.
    'let fbV9Leben=null, onlineSessionId=1, roomCode="KX7P";',
    fn('fbV9LebenAktuell'), fn('fbV9EigenAbgegeben'),
    fn('fbTacAktivSitz'), fn('fbTacOnline'), fn('fbTacAbwechselnd'), fn('fbTacAmZug'),
    fn('whoCanAim'), fn('canCommitInput'),
    'const BR=16; let fmt="single";',
    g(/function teamCap\(\)\{[^\n]*/, 'teamCap'),
    g(/function pickOwnBall\(who,p\)\{[^\n]*/, 'pickOwnBall'),
    'let balls=[{owner:0,alive:true,x:0,y:0},{owner:0,alive:true,x:0,y:60},{owner:1,alive:true,x:300,y:0},{owner:1,alive:true,x:300,y:60},{owner:5,alive:true,x:150,y:30}];',
    'return { wer: whoCanAim, darf: canCommitInput, greif: (who,x,y)=>pickOwnBall(who,{x:x,y:y}), abgegeben: fbV9EigenAbgegeben,',
    '  leben: (L)=>{ fbV9Leben=L; if(L){ L.sid=onlineSessionId; L.room=roomCode; L.gen=gen; L.seat=myPlayer; L.stufe=L.stufe||"PROTOKOLL"; } },',
    '  setz: (o)=>{ if("myPlayer" in o)myPlayer=o.myPlayer; if("turnNo" in o)turnNo=o.turnNo; if("gen" in o)gen=o.gen; if("aimSet" in o)aimSet=o.aimSet; if("fbVariant" in o)fbVariant=o.fbVariant; curAimer=myPlayer; } };'
  ].join('\n'))();
  M.setz({ myPlayer: 0, turnNo: 0, gen: 1, aimSet: [false, false] });
  t('Runde 0: Sitz 0 darf zielen und bestaetigen', M.wer() === 0 && M.darf(0) === true);
  M.setz({ myPlayer: 1 });
  t('Runde 0: Sitz 1 darf in DERSELBEN Runde zielen und bestaetigen (kein Wechselgatter)', M.wer() === 1 && M.darf(1) === true);
  M.setz({ myPlayer: 0, turnNo: 1 });
  t('Runde 1: Sitz 0 darf wieder', M.wer() === 0 && M.darf(0) === true);
  M.setz({ myPlayer: 1 });
  t('Runde 1: Sitz 1 darf wieder', M.wer() === 1 && M.darf(1) === true);
  M.setz({ myPlayer: 0, turnNo: 0, gen: 2 });
  t('Generation 2 (Rematch), Runde 0: Sitz 0 darf sofort - es gibt keinen Eroeffner', M.wer() === 0 && M.darf(0) === true);
  M.setz({ myPlayer: 1 });
  t('Generation 2, Runde 0: Sitz 1 ebenso', M.wer() === 1 && M.darf(1) === true);
  // Genau ein Zug je Sitz und Runde: nach dem eigenen Terminal ist die Eingabe zu. Online
  // sperrt whoCanAim ueber aimSet (wie in der Lebensregel); canCommitInput laesst online
  // grundsaetzlich durch - der zweite Riegel ist der write-once-Slot der Rules (Abschnitt 18).
  M.setz({ myPlayer: 0, turnNo: 0, gen: 1, aimSet: [true, false] });
  t('nach dem eigenen Zug ist die Eingabe von Sitz 0 zu (kein zweiter Zug, kein Figurenwechsel)', M.wer() === -1);
  M.setz({ myPlayer: 1 });
  t('... waehrend Sitz 1 in derselben Runde weiter offen ist', M.wer() === 1 && M.darf(1) === true);
  M.setz({ myPlayer: 1, aimSet: [true, true] });
  t('haben beide abgegeben, ist fuer beide zu', M.wer() === -1 && (M.setz({ myPlayer: 0 }), M.wer() === -1));
  t('online laesst canCommitInput den Sitz grundsaetzlich durch - den zweiten Zug verhindert der write-once-Slot der Rules', /if\(online\)return true;/.test(fn('canCommitInput')));
  // Die Sperre nach der eigenen Abgabe - BEVOR der Raum den Zug spiegelt (aimSet bleibt online offen).
  M.setz({ myPlayer: 0, turnNo: 0, gen: 1, aimSet: [false, false] });
  M.leben({ aktion: null, lauf: null });
  t('ohne Handlung im Lebenslauf ist die Eingabe offen', M.abgegeben() === false && M.wer() === 0);
  M.leben({ aktion: { move: { idx: 1, dx: 40, dy: 0, sp: 0 } }, lauf: null });
  t('gemerkte Handlung (vor der Uebergabe): abgegeben, Eingabe zu - obwohl aimSet noch frei ist', M.abgegeben() === true && M.wer() === -1);
  M.leben({ aktion: null, lauf: { terminal: { k: 'move' }, commitFertig: false } });
  t('Terminal an die Ablaufsteuerung uebergeben: abgegeben, Eingabe zu', M.abgegeben() === true && M.wer() === -1);
  M.leben({ aktion: null, lauf: { terminal: null, commitFertig: true } });
  t('Commit im Raum bestaetigt: abgegeben, Eingabe zu', M.abgegeben() === true && M.wer() === -1);
  M.leben({ aktion: null, lauf: { terminal: null, commitFertig: false, eigenUnbekannt: false } });
  t('offener Lauf ohne eigenes Terminal: Eingabe offen', M.abgegeben() === false && M.wer() === 0);
  const fremd = { aktion: { pass: true }, lauf: null }; M.leben(fremd); fremd.sid = 999;
  t('ein veralteter Lebenslauf (andere Session) sperrt nichts', M.abgegeben() === false && M.wer() === 0);
  M.leben(null);
  // Der Griff: nur eigene Figuren, nie der Gegner, nie der Ball (enge Griffweite BR*2.8).
  M.setz({ myPlayer: 0, aimSet: [false, false] });
  t('Sitz 0 greift jede seiner beiden Figuren - je nach Naehe', M.greif(0, 0, 5) === 0 && M.greif(0, 0, 65) === 1);
  t('Sitz 1 greift jede seiner beiden Figuren', M.greif(1, 300, 5) === 2 && M.greif(1, 300, 65) === 3);
  t('Sitz 0 greift nie eine Figur von Sitz 1, Sitz 1 nie eine von Sitz 0', [0, 60].every(y => { const i = M.greif(0, 300, y); return i === -1 || i <= 1; }) && [0, 60].every(y => { const i = M.greif(1, 0, y); return i === -1 || i >= 2; }));
  t('den Ball (4) greift kein Sitz', [0, 1].every(s => M.greif(s, 150, 30) !== 4));
  // Gegenproben: Tactical 4-Ball bleibt abwechselnd, die Lebensregel bleibt, wie sie war.
  M.setz({ fbVariant: 'tactical4', myPlayer: 1, turnNo: 0, gen: 1, aimSet: [false, false] });
  t('Tactical 4-Ball: Sitz 1 darf in Runde 0 NICHT zielen (abwechselnd, unveraendert)', M.wer() === -1 && M.darf(1) === false);
  M.setz({ myPlayer: 0 });
  t('Tactical 4-Ball: Sitz 0 darf in Runde 0', M.wer() === 0 && M.darf(0) === true);
  M.setz({ fbVariant: 'elimination', myPlayer: 1, turnNo: 0, aimSet: [false, false] });
  t('Lebensregel: Sitz 1 darf in Runde 0 zielen (unveraendert)', M.wer() === 1 && M.darf(1) === true);
}

// ══ 5. ZUGMENGE: PRUEFUNG UND WIRKUNG ════════════════════════════════════════════
abschnitt('5. Zugmenge: beide Zuege einer Runde starten gemeinsam, jeder nur einen eigenen Koerper');
function sandkasten() {
  return new Function([
    PRAEDIKATE,
    g(/const FB_ONLINE_SEATS=[^\n]*/, 'FB_ONLINE_SEATS'),
    g(/const TURN_MOVE=[^\n]*/, 'TURN_*'),
    g(/const FB_V9_VALID='VALID'[\s\S]*?;/, 'FB_V9_VALID (alle vier Kategorien)'),
    g(/const FB_V9_RAUS=[^\n]*/, 'FB_V9_RAUS'),
    g(/const FB_V9_NULLZUG=[^\n]*/, 'FB_V9_NULLZUG'),
    fn('fbV9Sitze'), fn('fbV9IdxGehoert'), fn('fbV9AcceptedOk'), fn('fbV9Wirken'),
    fn('fbTacAktivSitz'), fn('fbTacOnline'), fn('fbTacAbwechselnd'),
    'let online=true, turnNo=0, gen=1, phase="aim", footballWinner=null;',
    'function fbV11Raum(){ return true; } let fbV11Passiv=[]; let fbElimActive=[true,true];',
    'function footballElimEliminate(){ throw new Error("Elimination im Tactical"); }',
    'let balls=[{owner:0,alive:true},{owner:0,alive:true},{owner:1,alive:true},{owner:1,alive:true},{owner:5,alive:true}];',
    'let commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0], aimSet=[false,false];',
    'function resetCommits(){ commitIdx=[-1,-1]; commitAim=[{dx:0,dy:0},{dx:0,dy:0}]; commitSpin=[0,0]; aimSet=[false,false]; }',
    'const gestartet=[]; let reveals=0;',
    'function beginReveal(){ reveals++; }',
    'function applyLaunch(){ const l=[]; for(let s=0;s<2;s++) if(aimSet[s]&&commitIdx[s]>=0) l.push({seat:s,idx:commitIdx[s],dx:commitAim[s].dx}); gestartet.push(l); phase="sim"; }',
    'return { ok: fbV9AcceptedOk, wirken: fbV9Wirken, gestartet, setz:(o)=>{ if("turnNo" in o)turnNo=o.turnNo; if("gen" in o)gen=o.gen; if("fbVariant" in o){ fbVariant=o.fbVariant; balls=(fbVariant==="tactical4"?[0,0,0,0,1,1,1,1,5]:[0,0,1,1,5]).map(x=>({owner:x,alive:true})); } phase="aim"; fbV11Passiv=[]; }, stand:()=>({commitIdx:commitIdx.slice(), aimSet:aimSet.slice(), reveals}) };'
  ].join('\n'))();
}
{
  const S = sandkasten();
  const move = (seat, idx, dx) => ({ seat, kind: 'move', status: 'VALID', move: { idx, dx: dx === undefined ? 50 : dx, dy: 0, sp: 0 } });
  const pass = (seat) => ({ seat, kind: 'pass' });
  const late = (seat) => ({ seat, kind: 'late' });
  // Pruefung der Form: eigener Koerper ja, fremder nein, Ball nie.
  t('Sitz 0 darf Koerper 0 oder 1 starten', S.ok([move(0, 0), move(1, 2)], [0, 1]) === true && S.ok([move(0, 1), move(1, 3)], [0, 1]) === true);
  t('Sitz 0 darf NICHT Koerper 2 oder 3 starten (Rot)', S.ok([move(0, 2), move(1, 3)], [0, 1]) === false && S.ok([move(0, 3), pass(1)], [0, 1]) === false);
  t('Sitz 1 darf NICHT Koerper 0 oder 1 starten (Blau)', S.ok([move(0, 0), move(1, 0)], [0, 1]) === false && S.ok([pass(0), move(1, 1)], [0, 1]) === false);
  t('den Ball (4) darf niemand starten, ebenso nichts ausserhalb', S.ok([move(0, 4), pass(1)], [0, 1]) === false && S.ok([pass(0), move(1, 4)], [0, 1]) === false && S.ok([pass(0), move(1, 5)], [0, 1]) === false);
  // Wirkung: beide Zuege einer Runde starten GEMEINSAM.
  S.setz({ turnNo: 0, gen: 1 });
  t('Runde 0: Sitz 0 zieht mit B2 (1), Sitz 1 mit R1 (2) -> BEIDE starten in derselben Simulation',
    S.wirken([move(0, 1), move(1, 2, -50)], [0, 1]) === true && JSON.stringify(S.gestartet[0]) === JSON.stringify([{ seat: 0, idx: 1, dx: 50 }, { seat: 1, idx: 2, dx: -50 }]), S.gestartet[0]);
  S.setz({ turnNo: 1, gen: 1 });
  t('Runde 1: B1 (0) und R2 (3) - wieder beide, freie Wahl der eigenen Figur',
    S.wirken([move(0, 0), move(1, 3, -40)], [0, 1]) === true && JSON.stringify(S.gestartet[1]) === JSON.stringify([{ seat: 0, idx: 0, dx: 50 }, { seat: 1, idx: 3, dx: -40 }]), S.gestartet[1]);
  S.setz({ turnNo: 2, gen: 1 });
  t('Runde 2: Sitz 0 darf B2 (1) ERNEUT waehlen - keine Rotation, keine Sperre',
    S.wirken([move(0, 1), move(1, 2)], [0, 1]) === true && S.gestartet[2].map(l => l.idx).join(',') === '1,2');
  S.setz({ turnNo: 3, gen: 1 });
  t('Runde 3: nur Sitz 1 zieht, Sitz 0 passt -> genau R1 (2) startet, die Runde schliesst',
    S.wirken([pass(0), move(1, 2)], [0, 1]) === true && JSON.stringify(S.gestartet[3]) === JSON.stringify([{ seat: 1, idx: 2, dx: 50 }]), S.gestartet[3]);
  S.setz({ turnNo: 4, gen: 1 });
  t('Runde 4: Sitz 0 zieht, Sitz 1 hat die Frist verpasst (late) -> genau B1 startet, die Runde schliesst (kein Stillstand)',
    S.wirken([move(0, 0), late(1)], [0, 1]) === true && JSON.stringify(S.gestartet[4]) === JSON.stringify([{ seat: 0, idx: 0, dx: 50 }]), S.gestartet[4]);
  S.setz({ turnNo: 5, gen: 1 });
  t('Runde 5: beide passen -> nichts startet, die Runde schliesst trotzdem', S.wirken([pass(0), pass(1)], [0, 1]) === true && S.gestartet[5].length === 0);
  S.setz({ turnNo: 0, gen: 2 });
  t('Generation 2 (Rematch), Runde 0: beide starten sofort - kein Eroeffner, kein Wechsel',
    S.wirken([move(0, 0), move(1, 3)], [0, 1]) === true && S.gestartet[6].length === 2 && S.gestartet[6].map(l => l.seat).join(',') === '0,1');
  t('jede angewandte Runde eroeffnet genau einmal die Enthuellung', S.stand().reveals === 7);
  // Gegenproben: Tactical 4-Ball bleibt abwechselnd, die Lebensregel bleibt gleichzeitig.
  S.setz({ turnNo: 0, gen: 1, fbVariant: 'tactical4' });
  t('Tactical 4-Ball, Runde 0: ein formal gueltiger Zug des NICHT aktiven Sitzes 1 (B1 = Koerper 4) startet nichts - nur Sitz 0 (abwechselnd, unveraendert)',
    S.wirken([move(0, 1), move(1, 4)], [0, 1]) === true && JSON.stringify(S.gestartet[7]) === JSON.stringify([{ seat: 0, idx: 1, dx: 50 }]), S.gestartet[7]);
  S.setz({ turnNo: 0, gen: 1, fbVariant: 'elimination' });
  t('Lebensregel: beide Sitze starten in derselben Runde (unveraendert)',
    S.wirken([move(0, 0), move(1, 1)], [0, 1]) === true && S.gestartet[8].length === 2);
}

// ══ 6. ZWEI CLIENTS, DIESELBE HISTORIE ═══════════════════════════════════════════
abschnitt('6. Zwei getrennte Clients rechnen dieselbe gleichzeitige Zugfolge identisch');
{
  const A = sandkasten(), B = sandkasten();
  const folge = [];
  for (let tn = 0; tn < 20; tn++) {
    // Jede Runde beide Zuege; die Figurenwahl wechselt frei (0,1,1,0,...) bzw. (3,2,2,3,...).
    const ia = (tn % 4 === 1 || tn % 4 === 2) ? 1 : 0, ib = (tn % 4 === 1 || tn % 4 === 2) ? 2 : 3;
    folge.push([
      { seat: 0, kind: 'move', status: 'VALID', move: { idx: ia, dx: 30 + tn, dy: -tn, sp: 0 } },
      { seat: 1, kind: 'move', status: 'VALID', move: { idx: ib, dx: -30 - tn, dy: tn, sp: 0 } }
    ]);
  }
  let gleich = true, alleAngewandt = true;
  for (let tn = 0; tn < folge.length; tn++) {
    A.setz({ turnNo: tn, gen: 1 }); B.setz({ turnNo: tn, gen: 1 });
    const ra = A.wirken(folge[tn], [0, 1]), rb = B.wirken(folge[tn], [0, 1]);
    if (!ra || !rb) alleAngewandt = false;
    if (JSON.stringify(A.gestartet[tn]) !== JSON.stringify(B.gestartet[tn])) gleich = false;
  }
  t('20 Runden: beide Clients wenden jede Runde an', alleAngewandt);
  t('20 Runden: beide Clients starten in jeder Runde dieselben Koerper mit denselben Vektoren', gleich);
  t('20 Runden: in jeder Runde starten genau ZWEI Koerper - einer je Sitz', A.gestartet.every(l => l.length === 2 && l[0].seat === 0 && l[1].seat === 1));
  t('20 Runden: jeder gestartete Koerper gehoert seinem Sitz', A.gestartet.every(l => l[0].idx <= 1 && l[1].idx >= 2 && l[1].idx <= 3));
  t('20 Runden: beide eigenen Figuren kommen je Sitz mehrfach zum Zug', new Set(A.gestartet.map(l => l[0].idx)).size === 2 && new Set(A.gestartet.map(l => l[1].idx)).size === 2);
}

// ══ 7. NAMENSSCHILDER ════════════════════════════════════════════════════════════
abschnitt('7. Namen: keine Schilder ueber den Figuren, der Name steht oben im Spielstand');
{
  const M = new Function([
    g(/const FOOTBALL_NEUTRAL_OWNER=\d+;[^\n]*/, 'FOOTBALL_NEUTRAL_OWNER'),
    'let mode="football", phase="aim", menuVisible=false;',
    'function fbTactical(){ return true; }',
    fn('nameLabelOn'),
    'return { on: nameLabelOn, N: FOOTBALL_NEUTRAL_OWNER };'
  ].join('\n'))();
  const k = (o) => ({ owner: o, alive: true });
  t('B1 und B2 tragen KEIN Schild - zwei Menschen, die Farbe genuegt', M.on(k(0)) === false);
  t('R1 und R2 ebenso wenig', M.on(k(1)) === false);
  t('der neutrale Ball traegt keines', M.on(k(M.N)) === false);
  t('vier Figuren, null Schilder, ein Ball ohne', [0, 0, 1, 1, M.N].map(o => M.on(k(o))).join(',') === 'false,false,false,false,false');
}

// ══ 8. VERTRAEGE IM QUELLTEXT ════════════════════════════════════════════════════
abschnitt('8. Vertraege im Quelltext, im HUD, in der Lobby und in den Rules');
{
  // Das Zugmodell haengt an EINEM Helfer - nirgends mehr an der Familienfrage fbTactical/fbTacOnline.
  t('fbTacAbwechselnd = online && Tactical 4-Ball; fbTacGleichzeitig = online && Tactical 1v1',
    /function fbTacAbwechselnd\(\)\{ return fbTacOnline\(\)&&fbTac4\(\); \}/.test(HTML) && /function fbTacGleichzeitig\(\)\{ return fbTacOnline\(\)&&!fbTac4\(\); \}/.test(HTML));
  t('der passive Sitz existiert nur im abwechselnden Modell', /function fbTacPassivRunde\(ctx\)\{ return fbTacAbwechselnd\(\)&&!!ctx&&fbTacAktivSitz\(ctx\.turn,ctx\.gen\)!==ctx\.seat; \}/.test(HTML));
  t('kein Zuggatter fragt mehr fbTacOnline()&&!fbTacAmZug (die Familienfrage koppelte beide Varianten)', (HTML.match(/fbTacOnline\(\)&&!fbTacAmZug/g) || []).length === 0);
  t('canCommitInput, whoCanAim und der Auswahlring gattern nur noch abwechselnd (dreimal fbTacAbwechselnd()&&!fbTacAmZug)', (HTML.match(/fbTacAbwechselnd\(\)&&!fbTacAmZug\(/g) || []).length === 3);
  const bereit = fn('fbV9LebenBereit');
  t('die Rundenmaschine fragt weiter fbTacPassivRunde - das Auto-pass gibt es damit nur noch in 4-Ball', /const passiv=\(typeof fbTacPassivRunde==='function'\)&&fbTacPassivRunde\(ctx\);/.test(bereit) && /aktion:passiv\?\{pass:true\}:null/.test(bereit));
  const wirken = fn('fbV9Wirken');
  t('fbV9Wirken kennt einen Sitz am Zug nur noch im abwechselnden Modell', /const tacAktiv=\(typeof fbTacAbwechselnd==='function'&&fbTacAbwechselnd\(\)\)\?fbTacAktivSitz\(turnNo,gen\):-1;/.test(wirken)
    && /if\(tacAktiv>=0&&e\.seat!==tacAktiv\)continue;/.test(wirken));
  t('die Spielanbindung laeuft fuer Tactical, die Lebensregel UND Team 2v2', /\(\(typeof fbElim4==='function' && fbElim4\(\)\)\|\|\(typeof fbTactical==='function' && fbTactical\(\)\)\|\|\(typeof fbTeam2==='function' && fbTeam2\(\)\)\)/.test(HTML));
  // HUD: DEIN ZUG / GEGNER AM ZUG nur noch abwechselnd; gleichzeitig zaehlt "bereit/gesamt".
  const hud = fn('fbV9HudPaint');
  t('das HUD sagt DEIN ZUG / GEGNER AM ZUG nur im abwechselnden Modell (4-Ball)', /const tac=\(typeof fbTacAbwechselnd==='function'\)&&fbTacAbwechselnd\(\);/.test(hud) && /T\('fbOppTurn'\)/.test(hud) && /T\('fbYourTurn'\)/.test(hud));
  t('Tactical 1v1 bekommt den Zaehler bereit/gesamt ("1/2") - ohne Richtung oder Kraft des Gegners', /if\(team2\|\|\(\(typeof fbTacGleichzeitig==='function'\)&&fbTacGleichzeitig\(\)\)\)\{/.test(hud) && /zaehler=h\.bereit\+'\/'\+h\.gesamt;/.test(hud));
  t('die Chipleiste bleibt Team 2v2 vorbehalten', /if\(team2&&sig!==fbTeam2BereitSig\)\{/.test(hud));
  t('der Zaehler liest die Bereitschaft aus dem Raum (fbV9HudStand: bereit, gesamt, sitzBereit)', /bereit:bereit,sitzBereit:sitzBereit/.test(fn('fbV9HudStand')));
  for (const l of ['en', 'de', 'tr']) {
    t(l + ': fbYourTurn / fbOppTurn / fbReadyState / onModeTactical / fbLobbyTacHow1 / fbLobbyTacHow2 sind uebersetzt',
      ['fbYourTurn', 'fbOppTurn', 'fbReadyState', 'onModeTactical', 'onModeTacticalS', 'fbLobbyTacHow1', 'fbLobbyTacHow2'].every(k => typeof I18N[l][k] === 'string' && I18N[l][k].length > 0));
  }
  t('die Lobby erklaert Tactical 1v1 als gleichzeitig (en/de/tr)', /at the same time/.test(I18N.en.fbLobbyTacHow1) && /gleichzeitig/.test(I18N.de.fbLobbyTacHow1) && /aynı anda/.test(I18N.tr.fbLobbyTacHow1));
  t('... und "Die Zuege wechseln sich ab" nur noch fuer 4-Ball', /\$\('lobbyInfo2'\)\.textContent=T\(tac4\?'fbLobbyTacHow2':'fbLobbyHow2'\);/.test(HTML) && /alternate/i.test(I18N.en.fbLobbyTacHow2));
  t('der Ring am eigenen Figurenpaar erscheint online in 1v1 auf beiden Clients (Gatter nur abwechselnd)', /if\(online&&typeof fbTacAbwechselnd==='function'&&fbTacAbwechselnd\(\)&&!fbTacAmZug\(curAimer\)\)return 0;/.test(fn('fbTacticalRingLevel')));
  t('nach der eigenen Abgabe: kein Ring, keine Geste (whoCanAim und Ring fragen fbV9EigenAbgegeben)', /if\(online&&typeof fbV9EigenAbgegeben==='function'&&fbV9EigenAbgegeben\(\)\)return 0;/.test(fn('fbTacticalRingLevel'))
    && /\|\|\(typeof fbV9EigenAbgegeben==='function'&&fbV9EigenAbgegeben\(\)\)\)\?-1:myPlayer;/.test(fn('whoCanAim')));
  t('die Namensschilder bleiben in beiden Tactical-Varianten aus', /if\(typeof fbTactical==='function'&&fbTactical\(\)\)return false;/.test(fn('nameLabelOn')));
  // Die Aufstellung ist die freigegebene - unveraendert.
  const spawn = new Function(g(/const FOOTBALL_TACTICAL_1V1_SPAWN=\{[^\n]*\};/, 'FOOTBALL_TACTICAL_1V1_SPAWN') + '\nreturn FOOTBALL_TACTICAL_1V1_SPAWN;')();
  t('die ausgeglichene Aufstellung ist unveraendert (front 7.50/4.60, back 9.80/0.00)', spawn.frontX === 7.5 && spawn.frontY === 4.6 && spawn.backX === 9.8 && spawn.backY === 0, spawn);
  // Hub, Lobby, Start, Einstiege.
  t('die 1-gegen-1-Auswahl fuehrt TACTICAL 1V1 in die Lobby', /\{key:'tactical',\s+btn:'fbDuelTacBtn'[^}]*\}/.test(HTML) && /if\(key==='tactical'\)fbTacticalOnlineOeffnen\(\);/.test(HTML) && /function fbTacticalOnlineOeffnen\(\)/.test(HTML));
  t('die Raumanlage nimmt die Sitzzahl aus dem Register (fuer beide Tactical-Modi)', /\(fbOnlineMode===FB_ONLINE_MODE_TACTICAL\|\|fbOnlineMode===FB_ONLINE_MODE_TACTICAL4\)\?fbModeDefaultCap\(fbOnlineMode\):fbOnlineCap/.test(HTML));
  t('der Hoststart verlangt genau die Sitze 0 und 1', /fbTacRaum\(\)&&!\(da\.length===FB_TAC_SITZE&&da\[0\]===0&&da\[1\]===1\)\)return;/.test(fn('fbV11Starten')));
  t('die Lobby startet Tactical nur zu zweit', /const genau=tac\?FB_TAC_SITZE:/.test(fn('fbV11Lobby')) && /hoechst=genau\|\|FB_ONLINE_SEATS;/.test(fn('fbV11Lobby')));
  t('alle drei Onlineeinstiege leiten die Variante aus dem Modus ab', (HTML.match(/fbVariant=fbVarianteFuerModus\(/g) || []).length === 3);
  // Rules.
  const rules = require('fs').readFileSync(require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('die Rules kennen den Tactical-Raum (v11, Modus, Sitzzahl 2)', /newData\.val\(\) === 'tactical'/.test(rules) && /newData\.val\(\) === 2 && newData\.parent\(\)\.child\('mode'\)\.val\(\) === 'tactical'/.test(rules));
  t('die Rules gattern den Commit NICHT mehr fuer tactical - nur noch fuer tactical4', /\(root\.child\('rooms'\)\.child\(\$code\)\.child\('config\/mode'\)\.val\(\) !== 'tactical4' \|\| newData\.child\('k'\)\.val\(\) !== 'move' \|\| \(\(\(\$turn\.matches\(\/\[02468\]\$\/\) \? 0 : 1\) \+ root\.child\('rooms'\)\.child\(\$code\)\.child\('gen'\)\.val\(\) \+ 1\) % 2\) \+ '' === \$seat\)/.test(rules)
    && !/!== 'tactical' && root\.child\('rooms'\)\.child\(\$code\)\.child\('config\/mode'\)\.val\(\) !== 'tactical4'\) \|\| newData\.child\('k'\)/.test(rules));
  t('die Rules erzwingen den Koerperbesitz an der Enthuellung (Sitz 0: 0/1, Sitz 1: 2/3)', /\(\$seat === '0' && \(newData\.val\(\) === 0 \|\| newData\.val\(\) === 1\)\) \|\| \(\$seat === '1' && \(newData\.val\(\) === 2 \|\| newData\.val\(\) === 3\)\)/.test(rules));
  t('die Frist ist die v11-Achtsekundenfrist (kein Sechssekundenrueckfall)', /const FB_V10_DEADLINE_MS=8000/.test(HTML) && /\? 8000 : 6000\)/.test(rules));
}

console.log(`\nFootball-Tactical-Online: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
