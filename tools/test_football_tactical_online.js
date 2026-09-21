// ARENA FOOTBALL - TACTICAL 1V1 ONLINE: abwechselnde Zuege auf der v11-Rundenmaschine.
//
// Online ist Tactical ein v11-Raum mit genau zwei Sitzen. Sitz 0 fuehrt B1/B2 (Koerper 0,1),
// Sitz 1 fuehrt R1/R2 (Koerper 2,3), Koerper 4 ist der neutrale Ball. Die Rundenmaschine ist
// woertlich die der Lebensregel; Tactical fuegt ihr genau EINE Regel hinzu: je Runde zieht
// EIN Sitz, der andere traegt ein automatisches `pass`. Wer am Zug ist, folgt aus Runde und
// Generation (fbTacAktivSitz) - beide Clients und die Rules rechnen dieselbe Formel.
//
// Geprueft werden ECHTE Funktionen aus index.html in kleinen Sandkaesten: das Register und
// die Raumfassung, die Zugformel, der Koerperbesitz, die Eingabegatter (whoCanAim,
// canCommitInput), die Zugmengenpruefung und -wirkung (fbV9AcceptedOk, fbV9Wirken), die
// Namensschilder und die Vertraege im Quelltext. Die Rules zu Tactical prueft
// tools/test_rules.js (Abschnitt 18) gegen die echte firebase.rules.json.
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

// Die Sprachtabellen kommen aus index.html, nicht aus dem Test.
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

// ══ 1. REGISTER, RAUMFASSUNG, VARIANTE ═══════════════════════════════════════════
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

// ══ 2. WER IST AM ZUG - DIE FORMEL ═══════════════════════════════════════════════
abschnitt('2. Die Zugformel: Sitz 0 eroeffnet, jede Runde und jedes Rematch wechselt');
{
  const M = new Function([
    fn('fbTacAktivSitz'),
    'let online=true, turnNo=0, gen=1; let mode="football", fbVariant="tactical";',
    'function fbTactical(){ return mode==="football"&&fbVariant==="tactical"; }',
    fn('fbTacOnline'), fn('fbTacAmZug'), fn('fbTacPassivRunde'),
    'return { aktiv: fbTacAktivSitz, passiv: fbTacPassivRunde, amZug: (s,tn,gn)=>{ turnNo=tn; gen=gn; return fbTacAmZug(s); } };'
  ].join('\n'))();
  t('Generation 1, Runde 0: Sitz 0 (der Wirt, Blau) eroeffnet', M.aktiv(0, 1) === 0);
  t('Generation 1: 0,1,0,1,... - strikte Abwechslung', [0, 1, 2, 3, 4, 5, 6, 7, 8].map(tn => M.aktiv(tn, 1)).join('') === '010101010');
  t('Generation 1: auch zweistellige Runden folgen der Paritaet (9 -> 1, 10 -> 0, 11 -> 1)', [9, 10, 11].map(tn => M.aktiv(tn, 1)).join('') === '101');
  t('Generation 2 (Rematch): Sitz 1 eroeffnet', M.aktiv(0, 2) === 1 && M.aktiv(1, 2) === 0);
  t('Generation 3: wieder Sitz 0', M.aktiv(0, 3) === 0);
  let strikt = true;
  for (let gn = 1; gn <= 4; gn++) for (let tn = 0; tn < 40; tn++) if (M.aktiv(tn, gn) === M.aktiv(tn + 1, gn)) strikt = false;
  t('in keiner Generation zieht derselbe Sitz zweimal nacheinander (160 Runden)', strikt);
  t('das Ergebnis ist immer ein Sitz: 0 oder 1', [0, 1, 2, 3, 7, 100, 9999].every(tn => [0, 1].includes(M.aktiv(tn, 1))));
  t('fbTacAmZug fragt dieselbe Formel', M.amZug(0, 0, 1) === true && M.amZug(1, 0, 1) === false && M.amZug(1, 1, 1) === true && M.amZug(0, 1, 1) === false);
  t('der passive Sitz einer Runde ist der, der NICHT am Zug ist', M.passiv({ turn: 0, gen: 1, seat: 1 }) === true && M.passiv({ turn: 0, gen: 1, seat: 0 }) === false
    && M.passiv({ turn: 1, gen: 1, seat: 0 }) === true && M.passiv({ turn: 1, gen: 1, seat: 1 }) === false);
  t('ohne Zusammenhang gibt es keinen passiven Sitz', M.passiv(null) === false);
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
abschnitt('4. Eingabegatter: nur der Sitz am Zug greift, zielt und bestaetigt');
{
  const M = new Function([
    'let r3dOrbit=false, phase="aim", online=true, myPlayer=0, turnNo=0, gen=1;',
    'let mode="football", fbVariant="tactical", aimSet=[false,false], curAimer=0;',
    'function inputLocked(){ return false; } function r3dInputBlocked(){ return false; }',
    'function aliveCount(o){ return 2; } function fbV9EingabeOffen(){ return true; }',
    'function fbShared(){ return false; } function fbOffen(){ return []; } function fbElim4(){ return false; }',
    'function fbTactical(){ return mode==="football"&&fbVariant==="tactical"; }',
    fn('fbTacAktivSitz'), fn('fbTacOnline'), fn('fbTacAmZug'),
    fn('whoCanAim'), fn('canCommitInput'),
    'return { wer: whoCanAim, darf: canCommitInput, setz: (o)=>{ if("myPlayer" in o)myPlayer=o.myPlayer; if("turnNo" in o)turnNo=o.turnNo; if("gen" in o)gen=o.gen; if("aimSet" in o)aimSet=o.aimSet; if("fbVariant" in o)fbVariant=o.fbVariant; } };'
  ].join('\n'))();
  // Runde 0, Generation 1: Sitz 0 am Zug.
  M.setz({ myPlayer: 0, turnNo: 0, gen: 1 });
  t('Runde 0: Sitz 0 darf zielen', M.wer() === 0 && M.darf(0) === true);
  M.setz({ myPlayer: 1 });
  t('Runde 0: Sitz 1 darf NICHT zielen - obwohl sein aimSet frei ist', M.wer() === -1 && M.darf(1) === false);
  // Runde 1: Sitz 1 am Zug.
  M.setz({ turnNo: 1 });
  t('Runde 1: Sitz 1 darf zielen', M.wer() === 1 && M.darf(1) === true);
  M.setz({ myPlayer: 0 });
  t('Runde 1: Sitz 0 darf NICHT zielen', M.wer() === -1 && M.darf(0) === false);
  // Ein zweiter Zug in derselben Runde: nach dem eigenen Terminal ist aimSet gesetzt.
  M.setz({ myPlayer: 1, turnNo: 1, aimSet: [false, true] });
  t('nach dem eigenen Zug ist die Eingabe des Sitzes am Zug zu (kein zweiter Zug)', M.wer() === -1);
  // Die Lebensregel ist unberuehrt: dort gilt allein aimSet.
  M.setz({ fbVariant: 'elimination', myPlayer: 1, turnNo: 0, aimSet: [false, false] });
  t('Lebensregel: Sitz 1 darf in Runde 0 zielen (kein Wechselgatter)', M.wer() === 1 && M.darf(1) === true);
}

// ══ 5. ZUGMENGE: PRUEFUNG UND WIRKUNG ════════════════════════════════════════════
abschnitt('5. Zugmenge: nur der Sitz am Zug startet, nur einen eigenen Koerper');
function sandkasten() {
  return new Function([
    g(/const FB_ONLINE_SEATS=[^\n]*/, 'FB_ONLINE_SEATS'),
    g(/const TURN_MOVE=[^\n]*/, 'TURN_*'),
    g(/const FB_V9_VALID='VALID'[\s\S]*?;/, 'FB_V9_VALID (alle vier Kategorien)'),
    g(/const FB_V9_RAUS=[^\n]*/, 'FB_V9_RAUS'),
    g(/const FB_V9_NULLZUG=[^\n]*/, 'FB_V9_NULLZUG'),
    fn('fbV9Sitze'), fn('fbV9IdxGehoert'), fn('fbV9AcceptedOk'), fn('fbV9Wirken'),
    fn('fbTacAktivSitz'), fn('fbTacOnline'),
    'let online=true, mode="football", fbVariant="tactical", turnNo=0, gen=1, phase="aim", footballWinner=null;',
    'function fbTactical(){ return mode==="football"&&fbVariant==="tactical"; }',
    'function fbV11Raum(){ return true; } let fbV11Passiv=[]; let fbElimActive=[true,true];',
    'function footballElimEliminate(){ throw new Error("Elimination im Tactical"); }',
    'let balls=[{owner:0,alive:true},{owner:0,alive:true},{owner:1,alive:true},{owner:1,alive:true},{owner:5,alive:true}];',
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
  // Pruefung der Form.
  t('Sitz 0 darf Koerper 1 starten', S.ok([move(0, 1), pass(1)], [0, 1]) === true);
  t('Sitz 0 darf Koerper 0 starten', S.ok([move(0, 0), pass(1)], [0, 1]) === true);
  t('Sitz 0 darf NICHT Koerper 2 starten (Rot)', S.ok([move(0, 2), pass(1)], [0, 1]) === false);
  t('Sitz 1 darf NICHT den Ball (4) starten', S.ok([pass(0), move(1, 4)], [0, 1]) === false);
  t('Sitz 1 darf Koerper 3 starten', S.ok([pass(0), move(1, 3)], [0, 1]) === true);
  // Wirkung, Runde 0 (Sitz 0 am Zug).
  S.setz({ turnNo: 0, gen: 1 });
  t('Runde 0: Sitz 0 zieht mit Koerper 1, Sitz 1 passt -> genau Koerper 1 startet',
    S.wirken([move(0, 1), pass(1)], [0, 1]) === true && JSON.stringify(S.gestartet[0]) === JSON.stringify([{ seat: 0, idx: 1, dx: 50 }]), S.gestartet[0]);
  S.setz({ turnNo: 0, gen: 1 });
  t('Runde 0: ein formal gueltiger Zug des NICHT aktiven Sitzes 1 startet nichts (zweiter Riegel neben den Rules)',
    S.wirken([pass(0), move(1, 2)], [0, 1]) === true && S.gestartet[1].length === 0, S.gestartet[1]);
  S.setz({ turnNo: 0, gen: 1 });
  t('Runde 0: beide passen -> nichts startet, die Runde schliesst trotzdem',
    S.wirken([pass(0), pass(1)], [0, 1]) === true && S.gestartet[2].length === 0);
  // Runde 1 (Sitz 1 am Zug).
  S.setz({ turnNo: 1, gen: 1 });
  t('Runde 1: Sitz 1 zieht mit Koerper 3 -> genau Koerper 3 startet',
    S.wirken([pass(0), move(1, 3)], [0, 1]) === true && JSON.stringify(S.gestartet[3]) === JSON.stringify([{ seat: 1, idx: 3, dx: 50 }]), S.gestartet[3]);
  S.setz({ turnNo: 1, gen: 1 });
  t('Runde 1: ein Zug von Sitz 0 startet nichts', S.wirken([move(0, 0), pass(1)], [0, 1]) === true && S.gestartet[4].length === 0);
  // Rematch: Generation 2, Runde 0 -> Sitz 1.
  S.setz({ turnNo: 0, gen: 2 });
  t('Generation 2, Runde 0: jetzt zieht Sitz 1', S.wirken([pass(0), move(1, 2)], [0, 1]) === true && JSON.stringify(S.gestartet[5]) === JSON.stringify([{ seat: 1, idx: 2, dx: 50 }]));
  t('jede angewandte Runde eroeffnet genau einmal die Enthuellung', S.stand().reveals === 6);
  // Die Lebensregel ist unberuehrt: dort starten beide.
  S.setz({ turnNo: 0, gen: 1, fbVariant: 'elimination' });
  t('Lebensregel: beide Sitze starten in derselben Runde (unveraendert)',
    S.wirken([move(0, 0), move(1, 1)], [0, 1]) === true && S.gestartet[6].length === 2);
}

// ══ 6. ZWEI CLIENTS, DIESELBE HISTORIE ═══════════════════════════════════════════
abschnitt('6. Zwei getrennte Clients rechnen dieselbe Zugfolge identisch');
{
  const A = sandkasten(), B = sandkasten();
  const folge = [];
  for (let tn = 0; tn < 20; tn++) {
    const aktiv = (tn + 1 + 1) % 2;   // gen 1
    const idx = aktiv === 0 ? (tn % 4 < 2 ? 0 : 1) : (tn % 4 < 2 ? 2 : 3);
    const menge = aktiv === 0
      ? [{ seat: 0, kind: 'move', status: 'VALID', move: { idx, dx: 30 + tn, dy: -tn, sp: 0 } }, { seat: 1, kind: 'pass' }]
      : [{ seat: 0, kind: 'pass' }, { seat: 1, kind: 'move', status: 'VALID', move: { idx, dx: -30 - tn, dy: tn, sp: 0 } }];
    folge.push(menge);
  }
  let gleich = true, alleAngewandt = true;
  for (let tn = 0; tn < folge.length; tn++) {
    A.setz({ turnNo: tn, gen: 1 }); B.setz({ turnNo: tn, gen: 1 });
    const ra = A.wirken(folge[tn], [0, 1]), rb = B.wirken(folge[tn], [0, 1]);
    if (!ra || !rb) alleAngewandt = false;
    if (JSON.stringify(A.gestartet[tn]) !== JSON.stringify(B.gestartet[tn])) gleich = false;
  }
  t('20 Runden: beide Clients wenden jede Runde an', alleAngewandt);
  t('20 Runden: beide Clients starten in jeder Runde denselben Koerper mit demselben Vektor', gleich);
  t('20 Runden: in jeder Runde startet genau EIN Koerper', A.gestartet.every(l => l.length === 1));
  t('20 Runden: die Sitze wechseln sich strikt ab', A.gestartet.map(l => l[0].seat).join('') === '01010101010101010101');
  t('20 Runden: jeder gestartete Koerper gehoert dem Sitz am Zug', A.gestartet.every(l => (l[0].seat === 0 && l[0].idx <= 1) || (l[0].seat === 1 && l[0].idx >= 2 && l[0].idx <= 3)));
}

// ══ 7. NAMENSSCHILDER ════════════════════════════════════════════════════════════
abschnitt('7. Namen: auf beiden Figuren eines Spielers, nie auf dem Ball');
{
  const M = new Function([
    g(/const FOOTBALL_NEUTRAL_OWNER=\d+;[^\n]*/, 'FOOTBALL_NEUTRAL_OWNER'),
    'let mode="football", phase="aim", menuVisible=false;',
    'function fbTactical(){ return true; }',
    fn('nameLabelOn'),
    'return { on: nameLabelOn, N: FOOTBALL_NEUTRAL_OWNER };'
  ].join('\n'))();
  const k = (o) => ({ owner: o, alive: true });
  t('B1 und B2 tragen ein Schild', M.on(k(0)) && M.on(k(0)));
  t('R1 und R2 tragen ein Schild', M.on(k(1)) && M.on(k(1)));
  t('der neutrale Ball traegt keines', M.on(k(M.N)) === false);
  t('vier Figuren, vier Schilder, ein Ball ohne', [0, 0, 1, 1, M.N].map(o => M.on(k(o))).join(',') === 'true,true,true,true,false');
}

// ══ 8. DIE VERTRAEGE IM QUELLTEXT ════════════════════════════════════════════════
abschnitt('8. Vertraege im Quelltext');
{
  const bereit = fn('fbV9LebenBereit');
  t('der passive Sitz traegt sein pass von Anfang an (fbV9LebenBereit)', /const passiv=\(typeof fbTacPassivRunde==='function'\)&&fbTacPassivRunde\(ctx\);/.test(bereit)
    && /aktion:passiv\?\{pass:true\}:null/.test(bereit));
  const bekannt = fn('fbV9EigenBekannt');
  t('nach einem Neuladen reicht der passive Sitz das pass nach, sobald sein Slot bekannt ist', /fbTacPassivRunde\(lauf\.ctx\)/.test(bekannt) && /fbV9Action\(lauf,\{pass:true\}\)/.test(bekannt));
  t('... und nur, wenn dort noch nichts steht', /if\(!lauf\|\|lauf\.terminal\|\|lauf\.commitFertig\)return;/.test(bekannt));
  t('die Rundenmaschine meldet den bekannten Slot genau einmal weiter', (HTML.match(/if\(typeof fbV9EigenBekannt==='function'\)fbV9EigenBekannt\(lauf\);/g) || []).length === 1);
  t('die Spielanbindung laeuft fuer Tactical, die Lebensregel UND Team 2v2', /\(\(typeof fbElim4==='function' && fbElim4\(\)\)\|\|\(typeof fbTactical==='function' && fbTactical\(\)\)\|\|\(typeof fbTeam2==='function' && fbTeam2\(\)\)\)/.test(fn('fbV9LebenAn')));
  const wirken = fn('fbV9Wirken');
  t('fbV9Wirken kennt den Sitz am Zug', /const tacAktiv=\(typeof fbTacOnline==='function'&&fbTacOnline\(\)\)\?fbTacAktivSitz\(turnNo,gen\):-1;/.test(wirken)
    && /if\(tacAktiv>=0&&e\.seat!==tacAktiv\)continue;/.test(wirken));
  const hud = fn('fbV9HudPaint');
  t('das HUD sagt dem Gegner GEGNER AM ZUG und dem Sitz am Zug DEIN ZUG', /T\('fbOppTurn'\)/.test(hud) && /T\('fbYourTurn'\)/.test(hud) && /klasse='wait'/.test(hud));
  for (const l of ['en', 'de', 'tr']) {
    t(l + ': fbYourTurn / fbOppTurn / onModeTactical / onModeTacticalS / fbLobbyTacHow1 / fbLobbyTacHow2 sind uebersetzt',
      ['fbYourTurn', 'fbOppTurn', 'onModeTactical', 'onModeTacticalS', 'fbLobbyTacHow1', 'fbLobbyTacHow2'].every(k => typeof I18N[l][k] === 'string' && I18N[l][k].length > 0));
  }
  t('der Ring am eigenen Figurenpaar erscheint online nur beim Sitz am Zug', /if\(online&&typeof fbTacOnline==='function'&&fbTacOnline\(\)&&!fbTacAmZug\(curAimer\)\)return 0;/.test(fn('fbTacticalRingLevel')));
  t('der Hub fuehrt die Tactical-Karte direkt in die Lobby', /\{key:'tactical',\s+card:'cardFb1v1'[^}]*direkt:true\}/.test(HTML) && /function fbTacticalOnlineOeffnen\(\)/.test(HTML));
  t('die Raumanlage nimmt die Sitzzahl aus dem Register (fuer beide Tactical-Modi)', /\(fbOnlineMode===FB_ONLINE_MODE_TACTICAL\|\|fbOnlineMode===FB_ONLINE_MODE_TACTICAL4\)\?fbModeDefaultCap\(fbOnlineMode\):fbOnlineCap/.test(HTML));
  t('der Hoststart verlangt genau die Sitze 0 und 1', /fbTacRaum\(\)&&!\(da\.length===FB_TAC_SITZE&&da\[0\]===0&&da\[1\]===1\)\)return;/.test(fn('fbV11Starten')));
  t('die Lobby startet Tactical nur zu zweit', /const genau=tac\?FB_TAC_SITZE:/.test(fn('fbV11Lobby')) && /hoechst=genau\|\|FB_ONLINE_SEATS;/.test(fn('fbV11Lobby')));
  t('alle drei Onlineeinstiege leiten die Variante aus dem Modus ab', (HTML.match(/fbVariant=fbVarianteFuerModus\(/g) || []).length === 3);
  const rules = require('fs').readFileSync(require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('die Rules kennen den Tactical-Raum (v11, Modus, Sitzzahl 2)', /newData\.val\(\) === 'tactical'/.test(rules) && /newData\.val\(\) === 2 && newData\.parent\(\)\.child\('mode'\)\.val\(\) === 'tactical'/.test(rules));
  t('die Rules erzwingen die Zugformel am Commit', /\(\(\$turn\.matches\(\/\[02468\]\$\/\) \? 0 : 1\) \+ root\.child\('rooms'\)\.child\(\$code\)\.child\('gen'\)\.val\(\) \+ 1\) % 2\) \+ '' === \$seat/.test(rules));
  t('die Rules erzwingen den Koerperbesitz an der Enthuellung', /\(\$seat === '0' && \(newData\.val\(\) === 0 \|\| newData\.val\(\) === 1\)\) \|\| \(\$seat === '1' && \(newData\.val\(\) === 2 \|\| newData\.val\(\) === 3\)\)/.test(rules));
}

console.log(`\nFootball-Tactical-Online: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
