// ARENA FOOTBALL - ELITE BOT (lokales 1v1): FAIRNESS, WIEDERHOLBARKEIT, ISOLATION, SPIELSTAERKE.
//
// Der Elite Bot ist ein Planer, der mit DERSELBEN Physik rechnet wie das Spiel (stepSim auf
// einer Kopie der Koerper). Diese Suite haelt die Eigenschaften fest, auf die man sich beim
// Spielen verlassen koennen muss:
//
//   * FAIRNESS: der Zug entsteht ausschliesslich aus dem oeffentlichen Zustand und der Saat.
//     Verdeckte Eingaben des Menschen (Zugvektor, Richtung, Kraft, nicht aufgedeckter Commit)
//     aendern ihn nicht - das ist der Kern und wird hier direkt nachgewiesen.
//   * WIEDERHOLBARKEIT: gleiche Lage + gleiche Saat -> derselbe Zug.
//   * ISOLATION: eine Planung fasst weder Stand noch Koerper noch Phase an, und ein Tor in
//     der Vorausberechnung wird gemeldet, nie gewertet.
//   * BEGRENZUNG: die Suche ist endlich und laesst sich in Scheiben rechnen; das Ergebnis ist
//     dasselbe wie am Stueck (sonst haenge das Spiel von der Bildrate ab).
//   * SPIELSTAERKE: auf gestellten Lagen tut der Bot das Offensichtliche und schiesst kein
//     Eigentor.
//
// Die vollstaendige Messung (Matches gegen Vergleichsgegner, Planungsdauer) steht in
// artifacts/elitebot-01/bank.js - hier laufen nur schnelle, feste Nachweise.
//
//   node tools/test_football_elitebot.js
const { loadIndexHtml, grab } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
};
const abschnitt = (s) => console.log('\n== ' + s + ' ==');

// -- Der Sandkasten: echte Physik, echter Planer, gestellte Umgebung ----------------
function sandkasten() {
  const g = (re, name) => grab(HTML, re, name);
  return new Function([
    'const LOGICAL=1000; const cx=500, cy=500, R0=LOGICAL*0.485, BR=LOGICAL*0.032; let R=R0;',
    g(/const MAXPULL_FRAC=[^\n]*/, 'Physikkonstanten'),
    g(/const SPIN_K=[^\n]*/, 'Spin'),
    g(/const PCOLS=[^\n]*/, 'PCOLS'),
    'const TUNE=null; function maxPull(){return R0*MAXPULL_FRAC;}',
    "let balls=[], phase='sim', outBall=-1, roundWinner=-1;",
    'let aimSet=[false,false], commitIdx=[-1,-1], commitAim=[{dx:0,dy:0},{dx:0,dy:0}], commitSpin=[0,0];',
    "let curAimer=0, bgPulse=0, bgPulseRGB='', ffaN=2, myPlayer=0, online=false; let mode='football', fmt='single';",
    'let score=[0,0], roundNo=1, r3dActive=false, replaying=false;',
    'const SFX=new Proxy({},{get:()=>()=>{}});',
    "function spawn(){} function popBall(){} function winnerRGB(){return '';} function fx3Hit(){} function fx3Dust(){}",
    'function setPhase(p){phase=p;} function updateHud(){} function setPhaseText(){} function onlineArmTurn(){} function openCover(){} function cancelAimDrag(){}',
    'function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;} function gameOver(){phase="over";}',
    'function devSync(){} function simTickReset(){}',
    g(/function mkBall\([^\n]*/, 'mkBall'),
    g(/function teamCap\([^\n]*/, 'teamCap'),
    g(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls'),
    g(/function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside'),
    g(/function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts'),
    g(/function np\([^\n]*/, 'np'),
    g(/function resetCommits\(\)\{[\s\S]*?\n\}/, 'resetCommits'),
    g(/const FOOTBALL_NEUTRAL_OWNER=[\s\S]*?(?=\nlet fbVorausTiefe=0;)/, 'Football-Block'),
    g(/function curFR\(\)[^\n]*/, 'curFR'), g(/function curFE\(\)[^\n]*/, 'curFE'), g(/function curST\(\)[^\n]*/, 'curST'),
    g(/let fbVorausTiefe=0;[\s\S]*?function fbVorausAn\(\)\{return fbVorausTiefe>0;\}/, 'Planungsschalter'),
    g(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim'),
    g(/const FB_LAUNCH_SCALE=[\s\S]*?\nfunction fbLaunchMul\(len\)\{[\s\S]*?\n\}/, 'fbLaunchMul'),
    g(/const FB_BOT=\{[\s\S]*?\nfunction fbBotZug\(\)\{[\s\S]*?\n\}/, 'Elite-Bot-Planer'),
    'fbVariant="classic"; fbElimStartN=0; fbElimReset(); fbBotModus=true;',
    'return {',
    '  BR, cx, cy, NEU: FOOTBALL_NEUTRAL_OWNER, PARAM: FB_BOT, maxPull:()=>maxPull(),',
    '  stellen(){ placeBalls(); phase="aim"; fbGoalState="play"; fbGoalTick=0; footballWinner=null; },',
    '  neuesMatch(){ score[0]=0; score[1]=0; roundNo=1; this.stellen(); },',
    '  saat(s){ fbBotSaat=s>>>0||1; fbBotVergessen(); },',
    '  suche(wer){ return fbBotSuche(wer); },',
    '  auftrag(wer){ return fbBotAuftrag(wer); }, arbeiten(a,b){ return fbBotArbeiten(a,b); },',
    '  planen(){ return fbBotPlanen(); }, scheibe(){ return fbBotScheibe(); }, fertig(){ return fbBotFertig(); },',
    '  planStatus(){ return fbBotPlan?{marke:fbBotPlan.marke,hatAktion:!!fbBotPlan.aktion,hatAuftrag:!!fbBotPlan.auftrag}:null; },',
    '  vergessen(){ fbBotVergessen(); }, modus(v){ fbBotModus=!!v; }, spielt(){ return fbBotSpielt(); },',
    '  planAn(){ return fbVorausAn(); }, planTor(){ return fbVorausTor; },',
    '  lage(){ return balls.map(b=>({x:(b.x-cx)/BR,y:(b.y-cy)/BR,owner:b.owner,alive:b.alive})); },',
    '  // Eine Lage stellen: Liste aus {owner,x,y} in BR um die Mitte. Die Koerper selbst',
    '  // bleiben die echten aus placeBalls - nur Ort und Geschwindigkeit werden gesetzt.',
    '  setzen(liste){ placeBalls(); phase="aim"; fbGoalState="play"; fbGoalTick=0; footballWinner=null;',
    '    for(const p of liste){ const b=balls.find(x=>x.owner===p.owner); if(!b)continue;',
    '      b.x=cx+p.x*BR; b.y=cy+p.y*BR; b.vx=0; b.vy=0; b.spin=0; b.alive=true; } },',
    '  zustand(){ return {score:[score[0],score[1]], runde:roundNo, phase:phase, torLage:fbGoalState,',
    '    koerper:balls.map(b=>[b.x,b.y,b.vx,b.vy,b.spin,b.alive?1:0])}; },',
    '  // Eine gleichzeitige Runde auf den LAUFENDEN Koerpern (wie applyLaunch).',
    '  zugRunde(z0,z1,maxSchritte){',
    '    const leg=(z)=>{ if(!z||z.idx<0)return; const b=balls[z.idx]; if(!b||!b.alive)return;',
    '      const mul=fbLaunchMul(Math.hypot(z.dx,z.dy)); b.vx=z.dx*mul; b.vy=z.dy*mul; b.spin=z.sp||0; };',
    '    leg(z0); leg(z1);',
    '    const vorher=[score[0],score[1]]; let k=0, tor=-1;',
    '    for(;k<maxSchritte;k++){ stepSim();',
    '      if(score[0]!==vorher[0]){tor=0;break;} if(score[1]!==vorher[1]){tor=1;break;}',
    '      let bewegt=false; for(const b of balls){if(b.alive&&Math.hypot(b.vx,b.vy)>curST()){bewegt=true;break;}}',
    '      if(!bewegt)break; }',
    '    return {tor:tor, schritte:k}; },',
    '  // Verdeckte Eingaben des Menschen setzen - der Planer darf sie nicht sehen.',
    '  verdeckt(o){ if(o.commitAim)commitAim=o.commitAim; if(o.aimSet)aimSet=o.aimSet;',
    '               if(o.commitIdx)commitIdx=o.commitIdx; if(o.curAimer!==undefined)curAimer=o.curAimer; }',
    '};'
  ].join('\n'))();
}

// == 1. Verdrahtung im Produkt =====================================================
abschnitt('1. Verdrahtung im Produkt');
t('Planungsschalter vor stepSim', /let fbVorausTiefe=0;[\s\S]{0,400}function fbVorausAn\(\)\{return fbVorausTiefe>0;\}\nfunction stepSim\(\)/.test(HTML));
t('Rueckmeldung nur ausserhalb der Planung', /if\(!fbVorausAn\(\)\)\{\n\s+const mag=Math\.min\(1,Math\.abs\(vn\)\/5\);/.test(HTML));
t('Tor in der Planung wird gemeldet, nicht gewertet', /if\(fbVorausAn\(\)\)\{const ps=footballGoalSide\(b\); if\(ps>=0\)fbVorausTor=ps; return;\}/.test(HTML));
const simQuelle = grab(HTML, /function fbBotSim\([\s\S]*?\n\}/, 'fbBotSim');
t('fbBotSim zaehlt die Planungstiefe hoch und stellt sie im finally zurueck',
  /fbVorausTiefe\+\+/.test(simQuelle) && /fbVorausTiefe--/.test(simQuelle) && /finally/.test(simQuelle));
t('startFootball nimmt den Bot-Schalter entgegen', /function startFootball\(variant,rules,gegenBot\)\{/.test(HTML));
t('Rundenbeginn legt den Auftrag an (Settle)', /if\(!fbVorausAn\(\)&&typeof fbBotPlanen==='function'\)fbBotPlanen\(\);/.test(HTML));
t('Bild treibt die Planung scheibenweise', /if\(typeof fbBotScheibe==='function'\)fbBotScheibe\(\);/.test(HTML));
t('Commit holt den fertigen Zug', /fbBotSpielt\(\)&&who===0\)\{\n\s+const bz=fbBotZug\(\);/.test(HTML));
// Gegen den Bot sitzt nur EIN Mensch am Geraet - ein Uebergabeschirm waere sinnlos. Der Grund
// steht neben dem bestehenden (gemeinsames Fenster) in EINEM Helfer, den beide Rundenstarts
// fragen; zwei getrennte Inline-Bedingungen waeren sonst irgendwann auseinandergelaufen.
t('fbOhneUebergabe deckt gemeinsames Fenster UND Bot ab',
  /function fbOhneUebergabe\(\)\{return fbShared\(\)\|\|\(typeof fbBotSpielt==='function'&&fbBotSpielt\(\)\);\}/.test(HTML));
t('beide Rundenstarts fragen denselben Helfer',
  (HTML.match(/if\(!\(typeof fbOhneUebergabe==='function'&&fbOhneUebergabe\(\)\)\)openCover\(curAimer\);/g) || []).length === 2);
t('Zurueck im Menue endet der Bot-Modus', /fbBotModus=false;[\s\S]{0,160}fbBotVergessen\(\);/.test(HTML));
// Ein Rematch laeuft ueber newGame(), nicht ueber startFootball(). Die erste Runde traegt
// danach wieder Marke "Runde 1, Stand 0:0" - ohne Vergessen waere der Plan des VORIGEN
// Matches noch gueltig. Die Saat wird an beiden Stellen aus demselben Helfer gezogen.
t('Rematch vergisst den Plan und zieht eine neue Saat',
  /if\(typeof fbBotVergessen==='function'\)\{fbBotVergessen\(\);fbBotNeueSaat\(\);\}/.test(HTML));
t('die Saat wird an genau einer Stelle gezogen',
  (HTML.match(/fbBotSaat=\(\(Date\.now\(\)/g) || []).length === 1
  && (HTML.match(/fbBotNeueSaat\(\)/g) || []).length === 3);
t('Gegnername kommt aus der Sprachtabelle', /fbBotSpielt\(\)&&p===1\)\?T\('fbBotName'\)/.test(HTML));
t('die Gegnerkarte im HUD traegt den Bot-Namen statt der Farbe',
  /\$\('n1'\)\.textContent=mode==='football'\?\(\(typeof fbBotSpielt==='function'&&fbBotSpielt\(\)\)\?T\('fbBotName'\):'ROT'\)/.test(HTML));
t('fbBotName steht in allen drei Sprachen', (HTML.match(/fbBotName:'ELITE BOT'/g) || []).length === 3);
t('TRAINING fuehrt in seine Auswahl statt "bald"', /\{key:'training',[^\n]*direkt:true\}/.test(HTML) && !/id="cardFbBot"[^\n]*msoon|msoon"[^\n]*id="cardFbBot"/.test(HTML));
t('TRAINING-Ebene hat den Elite-Bot-Eintrag', /id="fbTrainBotBtn"/.test(HTML) && /FB_HUB_TRAINING=\[\n\s+\{key:'elitebot'/.test(HTML));

// == 2. Der Planer sieht nur oeffentlichen Zustand =================================
abschnitt('2. Der Planer sieht nur oeffentlichen Zustand');
const sicht = grab(HTML, /function fbBotSicht\(wer\)\{[\s\S]*?\n\}/, 'fbBotSicht');
for (const verdeckt of ['commitAim', 'commitIdx', 'commitSpin', 'aimSet', 'curAimer', 'dragging', 'aimVec', 'pointer']) {
  t('fbBotSicht liest ' + verdeckt + ' nicht', sicht.indexOf(verdeckt) < 0);
}
const planer = grab(HTML, /const FB_BOT=\{[\s\S]*?\nfunction fbBotZug\(\)\{[\s\S]*?\n\}/, 'Planer');
for (const verdeckt of ['commitAim', 'aimSet', 'curAimer']) {
  t('der ganze Planer fasst ' + verdeckt + ' nicht an', planer.indexOf(verdeckt) < 0);
}
t('der Planer holt seine Lage nur ueber fbBotSicht', (planer.match(/fbBotSicht\(/g) || []).length >= 1);

// == 3. Fairness: verdeckte Eingaben aendern nichts ================================
abschnitt('3. Fairness gegenueber der verdeckten Eingabe');
const F = sandkasten();
const alsText = (z) => z ? [z.idx, z.dx.toFixed(9), z.dy.toFixed(9), (z.sp || 0).toFixed(9)].join('|') : 'null';
F.saat(4711); F.neuesMatch();
const ohne = F.suche(1);
t('ein Zug kommt zustande', !!ohne && ohne.idx >= 0);
const verdeckteLagen = [
  { commitAim: [{ dx: 300, dy: 0 }, { dx: 0, dy: 0 }], aimSet: [true, false], commitIdx: [0, -1], curAimer: 0 },
  { commitAim: [{ dx: -120, dy: 260 }, { dx: 0, dy: 0 }], aimSet: [true, false], commitIdx: [0, -1], curAimer: 0 },
  { commitAim: [{ dx: 5, dy: -400 }, { dx: 0, dy: 0 }], aimSet: [false, false], commitIdx: [-1, -1], curAimer: 1 }
];
verdeckteLagen.forEach((v, i) => {
  F.saat(4711); F.neuesMatch(); F.verdeckt(v);
  t('verdeckte Eingabe ' + (i + 1) + ' aendert den Zug nicht', alsText(F.suche(1)) === alsText(ohne));
});
F.saat(4711); F.neuesMatch();
t('gleiche Saat zweimal -> identisch', alsText(F.suche(1)) === alsText(ohne));
F.saat(99991); F.neuesMatch();
const andere = F.suche(1);
t('eine andere Saat liefert einen gueltigen Zug', !!andere && andere.idx >= 0);

// == 4. Jeder Zug ist legal ========================================================
abschnitt('4. Legale Zuege');
const mp = F.maxPull();
let legal = true, fremd = false, nichtEndlich = false;
for (let s = 1; s <= 30; s++) {
  F.saat(s * 7717); F.neuesMatch();
  const z = F.suche(1); if (!z) { legal = false; break; }
  const lageJetzt = F.lage();
  if (Math.hypot(z.dx, z.dy) > mp + 1e-6) legal = false;
  if (!isFinite(z.dx) || !isFinite(z.dy)) nichtEndlich = true;
  if (!lageJetzt[z.idx] || lageJetzt[z.idx].owner !== 1 || !lageJetzt[z.idx].alive) fremd = true;
}
t('30 Zuege bleiben in der Hoechstkraft', legal);
t('30 Zuege bewegen nur eine eigene, lebende Figur', !fremd);
t('kein Zug enthaelt NaN oder Unendlich', !nichtEndlich);

// == 5. Isolation: Planung fasst den laufenden Zustand nicht an ====================
abschnitt('5. Isolation der Vorausberechnung');
F.saat(2024); F.neuesMatch();
const vorher = F.zustand();
F.suche(1);
const nachher = F.zustand();
t('Stand unveraendert', JSON.stringify(vorher.score) === JSON.stringify(nachher.score));
t('Rundenzaehler unveraendert', vorher.runde === nachher.runde);
t('Phase unveraendert', vorher.phase === nachher.phase);
t('Torablauf unveraendert', vorher.torLage === nachher.torLage);
t('Koerper (Ort, Tempo, Drall, Leben) unveraendert', JSON.stringify(vorher.koerper) === JSON.stringify(nachher.koerper));
t('Planungsschalter steht danach wieder auf aus', F.planAn() === false);
// Eine Lage, in der die Vorausberechnung sicher ein Tor sieht: der Ball liegt im Tormaul.
F.setzen([{ owner: 1, x: 6, y: 0 }, { owner: 0, x: 14, y: 7 }, { owner: F.NEU, x: -14.5, y: 0 }]);
const standVorTor = F.zustand();
F.suche(1);
t('ein Tor in der Vorausberechnung veraendert den Stand nicht', JSON.stringify(F.zustand().score) === JSON.stringify(standVorTor.score));
t('ein Tor in der Vorausberechnung veraendert die Koerper nicht', JSON.stringify(F.zustand().koerper) === JSON.stringify(standVorTor.koerper));

// == 6. Begrenzte Suche, in Scheiben identisch =====================================
abschnitt('6. Begrenzte und unterbrechbare Suche');
F.saat(8080); F.neuesMatch();
const amStueck = F.suche(1);
F.saat(8080); F.neuesMatch();
const auf = F.auftrag(1);
let scheiben = 0;
while (!F.arbeiten(auf, F.PARAM.scheibeMs)) { scheiben++; if (scheiben > 500) break; }
t('in Scheiben gerechnet ergibt denselben Zug', alsText(auf.ergebnis) === alsText(amStueck));
t('die Suche endet (unter 500 Scheiben)', scheiben > 0 && scheiben <= 500, scheiben);
t('die Zahl der Simulationen ist begrenzt', amStueck.sims > 0 && amStueck.sims <= 400, amStueck.sims);
const erwartet = F.PARAM.winkel * F.PARAM.kraft.length + F.PARAM.bank + 1;
t('grobe Stufe prueft jeden Kandidaten genau einmal', auf.grob.length === erwartet, [auf.grob.length, erwartet]);
t('feine Stufe prueft genau feinN Kandidaten gegen alle Gegnerzuege',
  amStueck.sims === erwartet + F.PARAM.feinN * auf.gegner.length, [amStueck.sims, erwartet, F.PARAM.feinN, auf.gegner.length]);
// Eine Scheibe von 0 ms rechnet genau ein Stueck - auch das darf das Ergebnis nicht drehen.
F.saat(8080); F.neuesMatch();
const auf0 = F.auftrag(1);
let n0 = 0;
while (!F.arbeiten(auf0, 0)) { n0++; if (n0 > 5000) break; }
t('kleinstmoegliche Scheiben ergeben denselben Zug', alsText(auf0.ergebnis) === alsText(amStueck));
t('kleinstmoegliche Scheiben entsprechen der Zahl der Simulationen', n0 >= amStueck.sims, [n0, amStueck.sims]);

// == 7. Lebenslauf des Plans =======================================================
abschnitt('7. Lebenslauf des Plans');
F.saat(31337); F.neuesMatch(); F.vergessen();
t('ohne Planung gibt es keinen Plan', F.planStatus() === null);
F.planen();
const st1 = F.planStatus();
t('Rundenbeginn legt einen Auftrag an, rechnet aber nicht', !!st1 && st1.hatAuftrag && !st1.hatAktion);
let bilder = 0;
while (F.planStatus() && !F.planStatus().hatAktion && bilder < 500) { F.scheibe(); bilder++; }
t('nach genug Scheiben steht der Zug', F.planStatus().hatAktion && !F.planStatus().hatAuftrag);
console.log('    Bilder bis zum fertigen Zug: ' + bilder + ' (Budget ' + F.PARAM.scheibeMs + ' ms je Bild)');
const marke1 = F.planStatus().marke;
F.planen();
t('dieselbe Runde rechnet nicht erneut', F.planStatus().marke === marke1);
const botZug = F.fertig();
F.zugRunde({ idx: 0, dx: mp * 0.4, dy: 0, sp: 0 }, { idx: botZug.idx, dx: botZug.dx, dy: botZug.dy, sp: 0 }, 900);
F.vergessen();
t('fbBotVergessen loescht den Plan', F.planStatus() === null);
F.modus(false);
t('ausserhalb des Bot-Modus wird nicht geplant', F.planen() === null && F.planStatus() === null);
F.modus(true);

// == 8. Spielstaerke auf gestellten Lagen ==========================================
abschnitt('8. Spielstaerke auf gestellten Lagen');
// Der Bot (Rot, owner 1) greift das Tor bei -X an; sein eigenes Tor liegt bei +X.
function lageProbe(name, aufbau) {
  const erg = { n: 0, treffer: 0, eigentor: 0, erste: null };
  for (let s = 1; s <= 5; s++) {
    F.saat(s * 1013); F.setzen(aufbau);
    const z = F.suche(1); if (!z) continue;
    const vorBall = F.lage().find(b => b.owner === F.NEU);
    F.setzen(aufbau);
    const r = F.zugRunde(null, { idx: z.idx, dx: z.dx, dy: z.dy, sp: 0 }, 1200);
    const nachBall = F.lage().find(b => b.owner === F.NEU);
    erg.n++; if (r.tor === 1) erg.treffer++; if (r.tor === 0) erg.eigentor++;
    if (!erg.erste) erg.erste = { vorBall, nachBall, tor: r.tor };
  }
  console.log('    ' + name + ': ' + erg.treffer + '/' + erg.n + ' Tore, ' + erg.eigentor + ' Eigentore');
  return erg;
}
const A = lageProbe('klare Torchance', [{ owner: 1, x: -8, y: 0 }, { owner: 0, x: 14, y: 8 }, { owner: F.NEU, x: -12, y: 0 }]);
t('klare Torchance wird verwandelt', A.treffer === A.n, [A.treffer, A.n]);
const B = lageProbe('Ball vor dem eigenen Tor', [{ owner: 1, x: 8, y: 2.5 }, { owner: 0, x: 3, y: -6 }, { owner: F.NEU, x: 12, y: 0 }]);
t('kein Eigentor, wenn der Ball vor dem eigenen Tor liegt', B.eigentor === 0, B.eigentor);
t('der Ball wird vom eigenen Tor weggespielt', B.erste.nachBall.x < B.erste.vorBall.x, [B.erste.vorBall.x, B.erste.nachBall.x]);
const C = lageProbe('Gegner in der Schussbahn', [{ owner: 1, x: -6, y: 0 }, { owner: 0, x: -11, y: 0 }, { owner: F.NEU, x: -9, y: 0 }]);
t('bei versperrter Bahn faellt kein Eigentor', C.eigentor === 0, C.eigentor);
const D = lageProbe('Ball an der Bande', [{ owner: 1, x: 2, y: 10 }, { owner: 0, x: -8, y: -4 }, { owner: F.NEU, x: -2, y: 11.2 }]);
t('an der Bande faellt kein Eigentor', D.eigentor === 0, D.eigentor);
t('an der Bande wird der Ball Richtung Gegnertor bewegt', D.erste.nachBall.x < D.erste.vorBall.x, [D.erste.vorBall.x, D.erste.nachBall.x]);
// Aus der Eroeffnung heraus soll der Bot nicht passiv herumstehen.
F.saat(5150); F.neuesMatch();
const erst = F.suche(1);
t('aus der Eroeffnung wird deutlich Kraft eingesetzt', Math.hypot(erst.dx, erst.dy) > mp * 0.3, Math.hypot(erst.dx, erst.dy) / mp);

console.log(`\nFootball-EliteBot: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
