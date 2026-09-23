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
    'function devSync(){} function simTickReset(){} function fbFeelLaunch(){} function fbSfxLaunch(){} function fx3Launch(){}',
    'let seatGone=[false,false];',
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
    // Der ECHTE Ausfuehrungspfad. Ohne ihn prueft die Suite nur ihr eigenes Modell - genau
    // daran ist der erste Anlauf gescheitert: der Messstand zaehlte roundNo selbst hoch und
    // liess den Bot planen, waehrend das Spiel denselben Zug wiederholte.
    g(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch'),
    // Der ECHTE Commit-Weg des Menschen (applyCommit) - der Zugrechtsfehler lag genau dort:
    // applyCommit ruft fbBotZuegeLegen() ohne Sitzfilter.
    g(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove'),
    g(/function applyCommit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'applyCommit'),
    'function beginReveal(){setPhase("reveal");} function onlineSendCommit(){} function botMove(){return {idx:-1,dx:0,dy:0};}',
    // Das ECHTE startRound: nach einem Tor oeffnet footballTickGoal die naechste Runde darueber.
    g(/function startRound\(\)\{[\s\S]*?\n\s*setPhaseText\(\);\}/, 'startRound'),
    g(/const FB_BOT=\{[\s\S]*?\nfunction fbBotZug\(sitz\)\{[\s\S]*?\n\}/, 'Elite-Bot-Planer'),
    // Die VERDRAHTUNG steht bewusst HINTER dem Planer: sie schreibt Commits, der Planer nie.
    g(/function fbBotZuegeLegen\(nurSitz\)\{[\s\S]*?\n\}/, 'Zuege legen'),
    'let turnNo=-1, gen=0;',
    g(/function fbBotAmZugHandeln\(\)\{[\s\S]*?\n\}/, 'Bot am Zug'),
    'fbVariant="classic"; fbElimStartN=0; fbElimReset(); fbBotModus=true;',
    'return {',
    '  BR, cx, cy, NEU: FOOTBALL_NEUTRAL_OWNER, PARAM: FB_BOT, maxPull:()=>maxPull(),',
    '  // Wie startRound im Produkt: aufstellen, Commits raeumen (die Arrays folgen np(), das',
    '  // je Variante anders ist) und die ERSTE Runde oeffnen. Jede weitere oeffnet der Settle.',
    '  stellen(){ placeBalls(); resetCommits(); phase="aim"; fbGoalState="play"; fbGoalTick=0;',
    '    footballWinner=null; fbBotRundeNeu(); },',
    '  neuesMatch(){ score[0]=0; score[1]=0; score[2]=0; score[3]=0; roundNo=1;',
    '    fbBotRunde=0; turnNo=-1; fbBotVergessen(); this.stellen(); },',
    '  // Die Variante umstellen - danach gilt ihr Vertrag: Sitzzahl, Figuren, Zugmodell.',
    '  // Heisst bewusst NICHT modus(): so heisst schon der Schalter fuer den Bot-Modus.',
    '  variante(v){ fbVariant=v; this.neuesMatch(); },',
    '  np(){ return np(); }, figuren(sitz){ return fbBotFiguren(balls,sitz).length; },',
    '  abwechselnd(){ return fbTacAbwechselnd(); }, gleichzeitig(){ return fbTacGleichzeitig(); },',
    '  amZug(){ return fbTacAktivSitz(turnNo,gen); },',
    '  saat(s){ fbBotSaat=s>>>0||1; fbBotVergessen(); },',
    '  suche(wer){ return fbBotSuche(wer); },',
    '  auftrag(wer){ return fbBotAuftrag(wer); }, arbeiten(a,b){ return fbBotArbeiten(a,b); },',
    '  planen(){ return fbBotPlanen(); }, scheibe(){ return fbBotScheibe(); },',
    '  fertig(sitz){ return fbBotFertig(sitz===undefined?1:sitz); },',
    '  sitze(){ return fbBotSitze(); }, zuegeLegen(s){ return fbBotZuegeLegen(s); },',
    '  // Fuer den Lastmessstand: sind ALLE Bots dieser Runde fertig, und wie viele',
    '  // Simulationen sind insgesamt gelaufen?',
    '  alleFertig(){ return !!fbBotPlan && fbBotPlan.je.every(e=>!!e.aktion); },',
    '  // Produktpfad fuer den Zugrechtsnachweis: dieselben Aufrufe wie Pointer-Handler und loop().',
    '  commitMensch(idx,dx,dy){ applyCommit(0,idx,dx,dy,0); },',
    '  bildZiel(){ fbBotScheibe(); fbBotAmZugHandeln(); },',
    '  launch(){ applyLaunch(); }, schritt(){ stepSim(); }, phase(){ return phase; },',
    '  turn(){ return turnNo; }, planSitze(){ return fbBotPlan&&fbBotPlan.je ? fbBotPlan.je.map(e=>e.sitz) : []; },',
    '  tempi(){ return balls.map(b=>({o:b.owner,v:Math.hypot(b.vx,b.vy)})); },',
    '  rematch(){ fbBotMatchNeu(); score=[0,0,0,0]; roundNo=1; placeBalls(); resetCommits(); phase="aim";',
    '    fbGoalState="play"; fbGoalTick=0; footballWinner=null; fbBotRundeNeu(); },',
    '  simZaehler(){ let n=0; if(fbBotPlan)for(const e of fbBotPlan.je){ if(e.auftrag)n+=e.auftrag.sims;',
    '    else if(e.aktion)n+=e.aktion.sims||0; } return n; },',
    '  rundeNeu(){ return fbBotRundeNeu(); }, marke(){ return fbBotMarke(); },',
    '  // EINE Runde auf dem PRODUKTPFAD: Rundenbeginn, Zug des Bots wie in applyCommit,',
    '  // applyLaunch, dann stepSim bis zur Ruhe. Gemeldet wird, was geplant und was',
    '  // tatsaechlich ausgefuehrt wurde, sowie die dichteste Annaeherung an den Ball.',
    '  produktRunde(menschZug){',
    '    // NICHT selbst oeffnen: das tat stellen() beim Matchbeginn und danach der Settle von',
    '    // stepSim. Ein zweiter Oeffner verschoebe die Zugparitaet im abwechselnden Modell.',
    '    const marke=fbBotMarke();',
    '    // Der Mensch legt seinen Zug wie applyCommit - und NUR wenn er am Zug ist.',
    '    const menschDran=!fbTacAbwechselnd()||fbTacAktivSitz(turnNo,gen)===FB_BOT_MENSCH;',
    '    if(menschDran&&menschZug&&menschZug.idx>=0){ commitIdx[0]=menschZug.idx;',
    '      commitAim[0]={dx:menschZug.dx,dy:menschZug.dy}; commitSpin[0]=0; aimSet[0]=true; }',
    '    // Und die ECHTE Verdrahtung legt die Bot-Zuege daneben - aufgerufen OHNE Sitzfilter,',
    '    // genau wie applyCommit es tut. Frueher filterte der Pruefstand hier selbst nach dem',
    '    // Sitz am Zug; das Produkt tat es nicht, und der Bot schoss im Zug des Menschen mit.',
    '    const amZug=fbTacAbwechselnd()?fbTacAktivSitz(turnNo,gen):undefined;',
    '    const gelegt=fbBotZuegeLegen();',
    '    const bz=fbBotEintrag(fbBotSitze()[0]);',
    '    // Beobachtet wird der erste Bot-Sitz: sein GEPLANTER Zug gegen den, der wirklich',
    '    // angewandt wurde. Handelte er diese Runde nicht (abwechselnd, Mensch am Zug), ist',
    '    // sein Commit -1 und es gibt nichts zu vergleichen.',
    '    const sitz0=fbBotSitze()[0];',
    '    const idx0=commitIdx[sitz0], ziel0=aimSet[sitz0]?{dx:commitAim[sitz0].dx,dy:commitAim[sitz0].dy}:null;',
    '    applyLaunch();',
    '    let delta=0;',
    '    if(ziel0&&idx0>=0&&balls[idx0]){',
    '      const m0=fbLaunchMul(Math.hypot(ziel0.dx,ziel0.dy));',
    '      delta=Math.hypot(balls[idx0].vx-ziel0.dx*m0, balls[idx0].vy-ziel0.dy*m0);',
    '    }',
    '    const vor=[score[0],score[1]]; let k=0, tor=-1, naehe=1e9;',
    '    const ballVorX=(balls.find(b=>b.owner===FOOTBALL_NEUTRAL_OWNER)||{x:cx}).x;',
    '    const ball=balls.find(b=>b.owner===FOOTBALL_NEUTRAL_OWNER), bot=(idx0>=0?balls[idx0]:null);',
    '    // Gelaufen wird, bis das PRODUKT die Runde schliesst: der Settle in stepSim setzt',
    '    // phase zurueck auf "aim", raeumt die Commits und oeffnet die naechste Runde.',
    '    // Auf Ruhe zu warten reichte nicht - eine Runde, die die Schrittgrenze erreicht,',
    '    // settlet nie, dann bliebe aimSet stehen und der Zugzaehler stuende still.',
    '    for(;k<4000&&phase==="sim";k++){ stepSim();',
    '      if(bot&&ball)naehe=Math.min(naehe,Math.hypot(bot.x-ball.x,bot.y-ball.y)/BR);',
    '      if(score[0]!==vor[0])tor=0; if(score[1]!==vor[1])tor=1; }',
    '    if(tor>=0){ fbGoalState="play"; fbGoalTick=0; placeBalls(); }',
    '    phase="aim";',
    '    return { marke:marke, zug:ziel0?(ziel0.dx.toFixed(4)+"/"+ziel0.dy.toFixed(4)):"-", delta:delta,',
    '             gelegt:gelegt, figur:idx0, menschDran:menschDran, amZug:amZug,',
    '             kontakt:naehe, tor:tor, rueckfall:!!(bz&&bz.rueckfall),',
    '             ballWeg:((balls.find(b=>b.owner===FOOTBALL_NEUTRAL_OWNER)||{x:ballVorX}).x-ballVorX)/BR }; },',
    '  planStatus(sitz){ if(!fbBotPlan)return null; const e=fbBotEintrag(sitz===undefined?1:sitz);',
    '    return {marke:fbBotPlan.marke, sitze:fbBotPlan.je.map(x=>x.sitz),',
    '            hatAktion:!!(e&&e.aktion), hatAuftrag:!!(e&&e.auftrag)}; },',
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
t('Rundenbeginn zaehlt die Runde und legt den Auftrag an (Settle)',
  /if\(!fbVorausAn\(\)&&typeof fbBotRundeNeu==='function'\)fbBotRundeNeu\(\);/.test(HTML));
// DER FEHLER AUS DEM SPIELTEST: Football zaehlt roundNo nicht hoch (roundNo++ steht nur an
// den RingOut-Rundenenden). Ohne einen EIGENEN Rundenzaehler trug jede torlose Runde dieselbe
// Marke, der Plan der ersten Runde galt weiter, und der Bot spielte denselben Zug aus einer
// laengst anderen Lage. Diese drei Pins halten die Konstruktion fest.
t('roundNo wird im Produkt nur an den RingOut-Rundenenden hochgezaehlt',
  (HTML.match(/roundNo\+\+/g) || []).length === 2);
t('der Bot fuehrt einen eigenen Rundenzaehler', /^let fbBotRunde=0;$/m.test(HTML));
t('die Marke enthaelt den eigenen Rundenzaehler',
  /function fbBotMarke\(\)\{return \(fbBotRunde\|0\)\+'@'/.test(HTML));
t('beide Rundenoeffner gehen durch denselben Einstieg',
  (HTML.match(/fbBotRundeNeu\(\);/g) || []).length === 2);
t('Bild treibt die Planung scheibenweise', /if\(typeof fbBotScheibe==='function'\)fbBotScheibe\(\);/.test(HTML));
// Der Commit des Menschen legt die Zuege ALLER Bot-Sitze daneben - genau einen je Sitz.
t('Commit legt die Zuege aller Bot-Sitze daneben',
  /fbBotSpielt\(\)&&who===FB_BOT_MENSCH\)\{\n\s+fbBotZuegeLegen\(\);/.test(HTML));
t('der Mensch sitzt immer auf Sitz 0', /const FB_BOT_MENSCH=0;/.test(HTML));
t('genau EIN Zug je Sitz - mehr laesst kein Modusvertrag zu',
  /if\(aimSet\[sitz\]\)continue;/.test(HTML) && /aimSet\[sitz\]=true; gelegt\+\+;/.test(HTML));
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
t('Rematch geht durch denselben Matchbeginn wie der Start',
  /if\(typeof fbBotMatchNeu==='function'\)fbBotMatchNeu\(\);/.test(HTML));
t('der Matchbeginn steht an genau einer Stelle',
  /function fbBotMatchNeu\(\)\{\n\s+fbBotVergessen\(\); fbBotNeueSaat\(\); fbBotRunde=0;/.test(HTML)
  && (HTML.match(/fbBotSaat=\(\(Date\.now\(\)/g) || []).length === 1);
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
const planer = grab(HTML, /const FB_BOT=\{[\s\S]*?\nfunction fbBotZug\(sitz\)\{[\s\S]*?\n\}/, 'Planer');
// fbBotSim SICHERT den Eingabezustand und stellt ihn zurueck - sonst raeumte der Settle einer
// Vorausberechnung den bereits abgegebenen Zug des Menschen weg. Das ist Schutz, kein Zugriff:
// gelesen wird davon nichts. Der uebrige Planer nennt diese Felder gar nicht.
const planerOhneSim = planer.split(simQuelle).join('');
for (const verdeckt of ['commitAim', 'aimSet', 'curAimer']) {
  t('der Planer (ausser der Sicherung in fbBotSim) fasst ' + verdeckt + ' nicht an',
    planerOhneSim.indexOf(verdeckt) < 0);
}
t('fbBotSim sichert den Eingabezustand und stellt ihn vollstaendig zurueck',
  /const eAim=aimSet,eIdx=commitIdx,eCa=commitAim,eCs=commitSpin,eCur=curAimer;/.test(simQuelle)
  && /aimSet=eAim; commitIdx=eIdx; commitAim=eCa; commitSpin=eCs; curAimer=eCur;/.test(simQuelle));
t('und liest keinen dieser Werte aus - er kopiert nur Referenzen',
  !/aimSet\[/.test(simQuelle) && !/commitAim\[/.test(simQuelle) && !/commitIdx\[/.test(simQuelle));
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

// == 9. DER SPIELTEST-FEHLER: mehrere Runden auf dem Produktpfad ==================
// Der Besitzer meldete einen Bot, der den Ball oft verfehlt und unkontrolliert wirkt.
// Ursache: Football zaehlt roundNo nicht hoch, die Planmarke blieb zwischen TORLOSEN Runden
// gleich, und der Plan der ersten Runde galt weiter. Der alte Messstand hat das verdeckt,
// weil er roundNo selbst hochzaehlte. Dieser Abschnitt faehrt deshalb den ECHTEN Weg:
// Rundenbeginn -> fbBotZug -> applyLaunch -> stepSim, ueber mehrere torlose Runden.
abschnitt('9. Mehrere Runden auf dem Produktpfad (Spieltest-Regression)');
{
  const B = sandkasten();
  const mpB = B.maxPull();
  // Ein sanfter Mensch: er trifft den Ball, schiesst aber kein Tor - so bleibt der Stand
  // stehen, und nur ein eigener Rundenzaehler kann die Runden noch unterscheiden.
  const sanft = () => {
    const l = B.lage(), i = l.findIndex(b => b.alive && b.owner === 0), bi = l.findIndex(b => b.owner === B.NEU);
    const w = Math.atan2(l[bi].y - l[i].y, l[bi].x - l[i].x);
    return { idx: i, dx: Math.cos(w) * mpB * 0.55, dy: Math.sin(w) * mpB * 0.55 };
  };
  B.saat(4711); B.neuesMatch();
  const marken = new Set(), zuege = new Set();
  let maxDelta = 0, rueckfaelle = 0, kontakte = 0, torlos = 0, n = 0;
  for (let r = 0; r < 6; r++) {
    const e = B.produktRunde(sanft());
    n++;
    marken.add(e.marke); zuege.add(e.zug);
    maxDelta = Math.max(maxDelta, e.delta);
    if (e.rueckfall) rueckfaelle++;
    if (e.kontakt <= 1.85) kontakte++;      // Figur 1 BR + Football 25/32 BR = 1.781 BR
    if (e.tor < 0) torlos++;
  }
  console.log('    ' + n + ' Runden: ' + marken.size + ' verschiedene Marken, ' + zuege.size
    + ' verschiedene Zuege, ' + kontakte + ' mit Ballkontakt, ' + torlos + ' torlos');
  t('jede Runde traegt eine eigene Marke', marken.size === n, [marken.size, n]);
  t('der Bot spielt nicht in jeder Runde denselben Zug', zuege.size > 1, zuege.size);
  // Es genuegt, dass der GROSSTEIL der Runden torlos bleibt: nur dort kann der Spielstand
  // die Marke nicht unterscheiden, und genau dort war der Fehler.
  t('die Runden blieben ueberwiegend torlos - nur der eigene Zaehler unterscheidet sie',
    torlos >= n - 1, [torlos, n]);
  t('kein Rueckfallzug', rueckfaelle === 0, rueckfaelle);
  // Plan gegen Ausfuehrung: applyLaunch muss GENAU den geplanten Impuls setzen.
  t('der ausgefuehrte Impuls entspricht dem geplanten (Delta 0)', maxDelta < 1e-9, maxDelta);
  // BEWUSST keine Pflicht zum Ballkontakt in JEDER Runde: die Bewertung darf eine
  // Repositionierung hoeher bewerten als eine Beruehrung (gemessen: bester Zug 375,6 ohne
  // Kontakt gegen 374,5 mit Kontakt). Gefordert ist, dass der Bot den Ball ueberwiegend
  // spielt - Dauerflucht vom Ball waere der gemeldete Fehler.
  t('der Bot spielt den Ball in der Mehrheit der Runden', kontakte >= Math.ceil(n * 0.6), [kontakte, n]);

  // Erreichbarer Ball: der Bot steht frei davor. Geprueft wird ueber MEHRERE Saaten - mit
  // einer einzigen haengt das Ergebnis an der Auswahl unter fast gleich guten Zuegen.
  const frei = [];
  for (const saat of [909, 1717, 2323, 4242, 8181]) {
    B.saat(saat); B.setzen([{ owner: 1, x: 6, y: 0 }, { owner: 0, x: 14, y: 9 }, { owner: B.NEU, x: 1, y: 0 }]);
    const r1 = B.produktRunde({ idx: -1, dx: 0, dy: 0 });
    frei.push({ k: r1.kontakt, weg: r1.ballWeg });
  }
  // Massgeblich ist, was mit dem BALL passiert: ein Zug, der ihn nicht bewegt, ist in dieser
  // Lage vertan. Die blosse Annaeherung sagt das nicht (Beruehrung liegt bei 1.781 BR).
  const bewegt = frei.filter(x => Math.abs(x.weg) > 0.5).length;
  console.log('    erreichbarer Ball, fuenf Saaten: '
    + frei.map(x => x.k.toFixed(2) + ' BR / Ballweg ' + x.weg.toFixed(1)).join(' | '));
  t('erreichbarer Ball wird gespielt (der Ball bewegt sich)', bewegt >= 3, { bewegt, frei });

  // Vier aufeinanderfolgende Runden muessen vier Marken tragen.
  B.saat(5150); B.neuesMatch();
  const folge = [];
  for (let r = 0; r < 4; r++) folge.push(B.produktRunde(sanft()).marke);
  t('vier aufeinanderfolgende Runden, vier Marken', new Set(folge).size === 4, folge);
}

// == 10. DIE VERTRAEGE DER BOT-MODI ==============================================
// Jede angebotene Bot-Fassung muss den Vertrag IHRES Onlinemodus tragen: Sitzzahl, Figuren
// je Sitz, Zugmodell und genau EINE Aktion je Sitz und Zug. Gefahren wird der ECHTE Weg -
// Rundenbeginn, fbBotZuegeLegen, applyLaunch, stepSim.
abschnitt('10. Die Vertraege der Bot-Modi');
{
  const M = sandkasten();
  const mpM = M.maxPull();
  // Der Mensch spielt sanft auf den Ball - er soll Runden erzeugen, nicht gewinnen.
  const menschZug = () => {
    const l = M.lage(), i = l.findIndex(b => b.alive && b.owner === 0), bi = l.findIndex(b => b.owner === M.NEU);
    if (i < 0 || bi < 0) return { idx: -1, dx: 0, dy: 0 };
    const w = Math.atan2(l[bi].y - l[i].y, l[bi].x - l[i].x);
    return { idx: i, dx: Math.cos(w) * mpM * 0.5, dy: Math.sin(w) * mpM * 0.5 };
  };
  const VERTRAEGE = [
    { v: 'classic',   name: '1 VS 1',          sitze: 2, figuren: 1, koerper: 3, ab: false },
    { v: 'tactical',  name: 'TACTICAL 1V1',    sitze: 2, figuren: 2, koerper: 5, ab: false },
    { v: 'tactical4', name: 'TACTICAL 4-BALL', sitze: 2, figuren: 4, koerper: 9, ab: true },
    { v: 'team2v2',   name: 'TEAM 2V2',        sitze: 4, figuren: 1, koerper: 5, ab: false }
  ];
  for (const c of VERTRAEGE) {
    M.saat(4711); M.variante(c.v);
    const lage = M.lage();
    const botSitze = M.sitze();
    t(c.name + ': ' + c.koerper + ' Koerper insgesamt', lage.length === c.koerper, lage.length);
    t(c.name + ': ' + c.sitze + ' Sitze', M.np() === c.sitze, M.np());
    t(c.name + ': der Mensch sitzt auf 0, alle uebrigen Sitze sind Bots',
      botSitze.length === c.sitze - 1 && botSitze.indexOf(0) < 0, botSitze);
    t(c.name + ': ' + c.figuren + ' Figur(en) je Sitz',
      botSitze.every(s2 => M.figuren(s2) === c.figuren) && M.figuren(0) === c.figuren,
      botSitze.map(s2 => M.figuren(s2)));
    t(c.name + ': Zugmodell ' + (c.ab ? 'abwechselnd' : 'gleichzeitig'),
      M.abwechselnd() === c.ab, { ab: M.abwechselnd(), gl: M.gleichzeitig() });

    // Mehrere Runden ueber den echten Pfad.
    const marken = new Set(), figuren = new Set(), zuege = new Set();
    let maxDelta = 0, rueckfaelle = 0, kontakte = 0, runden = 0, legungen = [];
    for (let r = 0; r < 6; r++) {
      const e = M.produktRunde(menschZug());
      runden++;
      marken.add(e.marke); zuege.add(e.zug);
      if (e.figur >= 0) figuren.add(e.figur);
      maxDelta = Math.max(maxDelta, e.delta);
      if (e.rueckfall) rueckfaelle++;
      if (e.kontakt <= 1.85) kontakte++;
      legungen.push(e.gelegt);
    }
    console.log('    ' + c.name + ': ' + marken.size + ' Marken, ' + zuege.size + ' Zuege, '
      + figuren.size + ' verschiedene Figuren gespielt, ' + kontakte + ' mit Ballkontakt, '
      + 'Legungen je Runde ' + JSON.stringify(legungen));
    t(c.name + ': jede Runde traegt eine eigene Marke', marken.size === runden, [marken.size, runden]);
    t(c.name + ': der ausgefuehrte Impuls entspricht dem geplanten', maxDelta < 1e-9, maxDelta);
    t(c.name + ': kein Rueckfallzug', rueckfaelle === 0, rueckfaelle);
    // Genau EINE Aktion je handelndem Sitz und Runde - nie mehrere Figuren auf einmal.
    const erwarteteLegung = c.ab ? [0, 1] : [c.sitze - 1];
    t(c.name + ': je Runde genau ein Zug je handelndem Sitz',
      legungen.every(x => erwarteteLegung.indexOf(x) >= 0), legungen);
    // Mehrfigurige Modi muessen zwischen ihren Figuren WAEHLEN, nicht immer dieselbe nehmen.
    if (c.figuren > 1) {
      t(c.name + ': der Bot waehlt zwischen seinen Figuren', figuren.size > 1, [...figuren]);
    }
    if (c.ab) {
      // Abwechselnd: der Mensch eroeffnet, danach wechselt der Sitz am Zug Runde fuer Runde.
      M.saat(4711); M.variante(c.v);
      const folge = [];
      for (let r = 0; r < 4; r++) { folge.push(M.amZug()); M.produktRunde(menschZug()); }
      t(c.name + ': der Mensch eroeffnet', folge[0] === 0, folge);
      t(c.name + ': der Sitz am Zug wechselt Runde fuer Runde',
        folge.every((x, i) => x === i % 2), folge);
    }
  }
}

// == 11. ZUGRECHT IM ABWECHSELNDEN MODELL (Spieltest-Regression) ====================
// Gemeldet: in Tactical 4-Ball gegen den Bot schoss der Bot auch im Zug des Menschen.
// Ursache: applyCommit rief fbBotZuegeLegen() ohne Sitzfilter, und fbBotZuegeLegen pruefte
// das Zugrecht nicht - der Bot legte einen Commit, und applyLaunch schoss ihn ab. Der alte
// Pruefstand verdeckte das, weil er selbst nach dem Sitz am Zug filterte.
// Hier laeuft ALLES ueber den Produktpfad, ohne eigenes Zuggatter:
//   Zielphase: fbBotScheibe() + fbBotAmZugHandeln() (wie loop), Mensch: applyCommit(),
//   Reveal: applyLaunch() (wie loop nach REVEAL_MS), Auflosung: stepSim bis zum Settle.
// Unterschieden wird ein SCHUSS (Impuls DURCH applyLaunch) von passiver Bewegung (spaeter,
// durch Kollision) - nur der Schuss unterliegt dem Zugrecht.
abschnitt('11. Zugrecht im abwechselnden Modell (Tactical 4-Ball gegen Bot)');
{
  const Z = sandkasten();
  const mpZ = Z.maxPull();
  const menschZugZ = () => {
    const l = Z.lage(), bi = l.findIndex(b => b.owner === Z.NEU);
    let i = -1, d = 1e9;
    l.forEach((b, k) => { if (b.alive && b.owner === 0) { const q = Math.hypot(b.x - l[bi].x, b.y - l[bi].y); if (q < d) { d = q; i = k; } } });
    const w = Math.atan2(l[bi].y - l[i].y, l[bi].x - l[i].x);
    return { idx: i, dx: Math.cos(w) * mpZ * 0.35, dy: Math.sin(w) * mpZ * 0.35 };
  };
  // Ein Zug auf dem Produktpfad. Rueckgabe: wer am Zug war, wer DURCH den Abschuss einen
  // Impuls bekam, ob ein Plan fuer einen passiven Sitz existierte, und der Zugwechsel.
  function zug() {
    const amZug = Z.amZug(), turnVor = Z.turn();
    const planPassiv = Z.planSitze().filter(x => x !== amZug);
    let bilder = 0;
    while (Z.phase() === 'aim' && bilder < 5000) {
      if (amZug === 0 && bilder === 3) { const m = menschZugZ(); Z.commitMensch(m.idx, m.dx, m.dy); }
      else Z.bildZiel();
      bilder++;
    }
    if (Z.phase() !== 'reveal') return { amZug, fehler: 'kein Reveal (' + Z.phase() + ')' };
    const vor = Z.tempi();
    Z.launch();
    const nach = Z.tempi();
    const schuetzen = [...new Set(nach.map((b, i) => (b.o !== Z.NEU && b.v > 1e-9 && vor[i].v < 1e-9) ? b.o : -1).filter(x => x >= 0))];
    let k = 0;
    while (Z.phase() === 'sim' && k < 8000) { Z.schritt(); k++; }
    return { amZug, schuetzen, planPassiv, wechsel: Z.turn() - turnVor, stand: Z.lage && null };
  }

  Z.saat(20260923); Z.variante('tactical4');
  t('Tactical 4-Ball gegen Bot ist abwechselnd', Z.abwechselnd() === true);
  t('der Mensch eroeffnet', Z.amZug() === 0, Z.amZug());
  const zuege = [];
  for (let r = 0; r < 8; r++) zuege.push(zug());
  const menschZuege = zuege.filter(x => x.amZug === 0), botZuege = zuege.filter(x => x.amZug === 1);
  console.log('    8 Zuege: am Zug ' + zuege.map(x => x.amZug).join('') + '   Schuetzen je Zug '
    + zuege.map(x => '[' + (x.schuetzen || []).join(',') + ']').join(' '));
  t('keine Zuege ohne Reveal', zuege.every(x => !x.fehler), zuege.filter(x => x.fehler));
  t('Mensch und Bot wechseln sich ab (0101...)', zuege.every((x, i) => x.amZug === i % 2), zuege.map(x => x.amZug));
  // DER FEHLER: im Zug des Menschen darf der Bot NICHT schiessen.
  t('im Zug des Menschen schiesst der Bot nicht (nur Sitz 0 bekommt einen Impuls)',
    menschZuege.every(x => x.schuetzen.length === 1 && x.schuetzen[0] === 0), menschZuege.map(x => x.schuetzen));
  t('im Zug des Bots schiesst nur der Bot', botZuege.every(x => x.schuetzen.length === 1 && x.schuetzen[0] === 1),
    botZuege.map(x => x.schuetzen));
  t('genau ein Zugwechsel je Zug', zuege.every(x => x.wechsel === 1), zuege.map(x => x.wechsel));
  t('fuer einen passiven Sitz existiert nie ein Plan', zuege.every(x => x.planPassiv.length === 0),
    zuege.map(x => x.planPassiv));

  // Tor und Anstoss: nach einem Tor oeffnet der Torablauf die naechste Runde. Auch dort
  // genau ein Zugwechsel, und der Plan gehoert allein dem neuen Sitz am Zug.
  Z.saat(4242); Z.variante('tactical4');
  Z.setzen([{ owner: 0, x: -12.5, y: 0 }, { owner: Z.NEU, x: -15.5, y: 0 }]);
  // setzen stellt neu auf und oeffnet eine Runde - der Mensch ist weiterhin am Zug.
  const vorTor = Z.zustand().score.slice(), turnTor = Z.turn(), amZugTor = Z.amZug();
  const lt = Z.lage(), iT = lt.findIndex(b => b.alive && b.owner === 0 && Math.abs(b.x + 12.5) < 1e-6);
  let b2 = 0;
  while (Z.phase() === 'aim' && b2 < 50) { if (b2 === 2) Z.commitMensch(iT, -mpZ, 0); else Z.bildZiel(); b2++; }
  Z.launch();
  let k2 = 0, torGefallen = false;
  while (k2 < 20000) {
    Z.schritt(); k2++;
    const st = Z.zustand();
    if (st.score[0] !== vorTor[0] || st.score[1] !== vorTor[1]) torGefallen = true;
    if (torGefallen && st.phase === 'aim' && st.torLage === 'play') break;
  }
  const nachTor = Z.zustand();
  console.log('    Tor: Stand ' + vorTor.join(':') + ' -> ' + nachTor.score.slice(0, 2).join(':')
    + ', am Zug ' + amZugTor + ' -> ' + Z.amZug() + ', Zugwechsel ' + (Z.turn() - turnTor));
  t('ein Tor faellt im Pruefzug', torGefallen, nachTor.score);
  t('nach dem Tor genau ein Zugwechsel', Z.turn() - turnTor === 1, Z.turn() - turnTor);
  t('nach dem Tor ist der Bot am Zug und nur er hat einen Plan',
    Z.amZug() === 1 && JSON.stringify(Z.planSitze()) === '[1]', { amZug: Z.amZug(), plan: Z.planSitze() });

  // Rematch: der Mensch eroeffnet wieder, kein Plan aus dem alten Match.
  Z.rematch();
  t('nach dem Rematch eroeffnet wieder der Mensch', Z.amZug() === 0, Z.amZug());
  t('nach dem Rematch gibt es keinen Bot-Plan im Zug des Menschen', Z.planSitze().length === 0, Z.planSitze());

  // Gegenprobe: die gleichzeitigen Modi bleiben gleichzeitig - dort legt der Bot beim Commit
  // des Menschen seinen Zug daneben, und beide Figuren bekommen den Impuls im selben Abschuss.
  for (const v of ['classic', 'tactical', 'team2v2']) {
    Z.saat(777); Z.variante(v);
    let bb = 0;
    while (Z.phase() === 'aim' && bb < 5000) { if (bb === 3) { const m = menschZugZ(); Z.commitMensch(m.idx, m.dx, m.dy); } else Z.bildZiel(); bb++; }
    const vv = Z.tempi(); Z.launch(); const nn = Z.tempi();
    const sch = [...new Set(nn.map((b, i) => (b.o !== Z.NEU && b.v > 1e-9 && vv[i].v < 1e-9) ? b.o : -1).filter(x => x >= 0))].sort();
    const erwartet = v === 'team2v2' ? [0, 1, 2, 3] : [0, 1];
    t(v + ': weiterhin gleichzeitig - alle Sitze schiessen im selben Abschuss',
      JSON.stringify(sch) === JSON.stringify(erwartet), sch);
  }
}

console.log(`\nFootball-EliteBot: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
