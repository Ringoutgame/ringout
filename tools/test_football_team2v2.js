// Arena Football TRUE TEAM 2V2 — fokussierte Regelsuite.
//
// Vier Menschen an einem Geraet, zwei Teams, ein neutraler Ball. Das ist NICHT Tactical:
// dort steuert EIN Mensch beide Figuren seines Teams. Hier besitzt jeder Mensch genau EINE
// Figur, dauerhaft, und alle vier entscheiden im selben Fenster.
//
// Was diese Suite prueft, ist genau das Neue — und nichts sonst:
//   1. das Besitzmodell (vier Identitaeten, feste Kugeln, Teamzuordnung als Ableitung)
//   2. das gemeinsame Fenster und der gleichzeitige Abschuss
//   3. die Teamwertung nach TORSEITE, samt Eigentor
//   4. dass Tactical, Classic, die Lebensregel, Timed FFA und Online unberuehrt bleiben
//
// Arena, Torgeometrie, Physik und Startkoordinaten sind Sache der bestehenden Suiten;
// hier wird nur belegt, dass True Team 2v2 sie unveraendert BENUTZT.
//
// Wie alle Football-Harnesse extrahiert die Suite die ECHTEN Quellen aus index.html und
// beobachtet sie von aussen. Kein DOM, kein Renderer, kein Netzwerk, kein Zufall.
//
// Usage: node tools/test_football_team2v2.js

const { loadIndexHtml, grab: grabIn } = require('./extract.js');
const HTML = loadIndexHtml();
const grab = (re, name) => grabIn(HTML, re, name);

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }

// ── Die echten Quellen ───────────────────────────────────────────────────────
const SRC = [
  grab(/const FOOTBALL_SIM_HZ=[^\n]*/, 'FOOTBALL_SIM_HZ'),
  grab(/const FOOTBALL_WIN_SCORE=3;/, 'FOOTBALL_WIN_SCORE'),
  grab(/const FOOTBALL_NEUTRAL_OWNER=[^\n]*/, 'FOOTBALL_NEUTRAL_OWNER'),
  grab(/const FOOTBALL_TACTICAL_SPAWN=[^\n]*/, 'FOOTBALL_TACTICAL_SPAWN'),
  grab(/const FOOTBALL_VARIANT_TACTICAL='tactical';/, 'FOOTBALL_VARIANT_TACTICAL'),
  grab(/function fbTactical\(\)\{[^\n]*/, 'fbTactical'),
  // Der neue Modus als Ganzes.
  grab(/const FOOTBALL_VARIANT_TEAM2='team2v2';[\s\S]*?const FOOTBALL_TEAM2V2_NAMES=\[[^\]]*\];/, 'Team-2v2-Konstanten'),
  grab(/function fbTeam2\(\)\{[^\n]*/, 'fbTeam2'),
  grab(/function fbTeam2Side\(o\)\{[^\n]*/, 'fbTeam2Side'),
  grab(/function fbShared\(\)\{[^\n]*/, 'fbShared'),
  grab(/function fbSharedShotTicks\(\)\{[^\n]*/, 'fbSharedShotTicks'),
  grab(/function fbOffen\(\)\{[\s\S]*?\n\}/, 'fbOffen'),
  // Die geteilten Weichen und die Aufstellung.
  grab(/function np\(\)\{[^\n]*/, 'np'),
  grab(/function teamOf\(s\)\{[^\n]*/, 'teamOf'),
  grab(/function colorSlot\(owner\)\{[^\n]*/, 'colorSlot'),
  grab(/function placeBalls\(\)\{[\s\S]*?\n\}/, 'placeBalls'),
  // Die Bedenkzeituhr — dieselbe, die Speed Match und Timed FFA benutzen.
  grab(/const FOOTBALL_RULES_FIRST3='first3';[\s\S]*?\nfunction fbShotText\(ticks\)\{[\s\S]*?\n\}/,
       'Classic-Regeln + Bedenkzeituhr'),
  grab(/let fbAutoShots=0, fbAutoSkips=0, fbTroubleSeen=\[false,false\];/, 'Zaehler der Automatik'),
  grab(/function fbShotShown\(\)\{[\s\S]*?\n\}/, 'fbShotShown'),
  // Absichten sammeln und gleichzeitig abschiessen.
  grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove'),
  grab(/function applyCommit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'applyCommit'),
  grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch'),
  // Die Wertung. footballGoalSide bildet die ueberquerte TORSEITE auf das punktende Team ab —
  // genau daran haengt die Eigentorregel.
  grab(/function footballGoalSide\(b\)\{[\s\S]*?\n\}/, 'footballGoalSide'),
  grab(/function footballTryGoal\(b\)\{[\s\S]*?\n\}/, 'footballTryGoal'),
  grab(/function footballResetRound\(\)\{[\s\S]*?\n\}/, 'footballResetRound'),
].join('\n');

// ── Sandkasten ───────────────────────────────────────────────────────────────
// Alles Regelrelevante kommt unveraendert aus index.html. Gestubbt ist nur die Aussenwelt:
// Renderer, Klang, HUD, Netz — und die Torgeometrie, die eine eigene Suite hat. Welches
// TOR ueberquert wurde, sagt hier der Harness; wie daraus ein Teampunkt wird, entscheidet
// unveraendert das Produkt.
function build(variante) {
  const g = new Function(`
    let mode='football', online=false, fmt='single';
    let phase='aim', menuVisible=false, fbGoalState='play', footballWinner=null, fbGoalTick=0;
    let balls=[], score=[0,0,0,0], roundNo=1, roundWinner=-1, outBall=-1, ffaN=0;
    let fbVariant='${variante}';
    const cx=0, cy=0, BR=14, R=520;
    let r3dOrbit=false;
    const document={hidden:false};
    let curAimer=-1, aimSet=[false,false,false,false];
    let commitIdx=[], commitAim=[], commitSpin=[];
    let dragging=false, dragOwner=-1, dragShooter=-1, dragSchwach=false;
    const LAUNCH=0.22;
    const log=[];
    // Welches Tor der Ball ueberquert hat: 0 = Blaus Tor, 1 = Rots Tor. Der Harness setzt
    // es; die Abbildung auf das punktende Team bleibt Sache des Produkts.
    let torSeite=-1;
    function footballGoalCrossed(b){return torSeite;}
    function mkBall(x,y,owner){return {x:x,y:y,vx:0,vy:0,spin:0,owner:owner,alive:true};}
    function maxPull(){return 100;}
    function setPhase(p){phase=p;log.push('phase:'+p);}
    function setPhaseText(){}
    function updateHud(){}
    function beginReveal(){log.push('reveal');setPhase('reveal');}
    function openCover(o){log.push('cover:'+o);}
    function onlineSendCommit(){log.push('netz');}
    function botMove(){return {idx:0,dx:0,dy:0};}
    function devSync(){}
    function fbLaunchMul(){return LAUNCH;}
    function fbSfxLaunch(){}
    function fbFeelLaunch(){}
    function spawn(){}
    function aliveCount(o){return balls.some(b=>b.alive&&b.owner===o)?1:0;}
    function aliveBalls(o){return balls.filter(b=>b.owner===o&&b.alive);}
    function aimVectorFromDrag(){return dragging?{fx:7.25,fy:-3.5,spin:0.25,weak:dragSchwach}:null;}
    function cancelAimDrag(){dragging=false;dragOwner=-1;dragShooter=-1;}
    function inputLocked(){return false;}
    function fbElim4(){return false;}
    function fbElimPlayers(){return 5;}
    function fbTimed(){return false;}
    function footballFreezePlayers(){for(const b of balls)if(b.owner!==FOOTBALL_NEUTRAL_OWNER){b.vx=0;b.vy=0;}}
    function footballGoalFxTrigger(){}
    function fbMusicGoal(){}
    function resetCommits(){aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
      for(let p=0;p<np();p++){aimSet.push(false);commitIdx.push(-1);commitAim.push({dx:0,dy:0});commitSpin.push(0);}}
    const seatGone=[false,false,false,false];
    const r3dActive=true, PCOLS=[{ui:'#4db8ff'},{ui:'#ff6b5e'},{ui:'#3ddc84'},{ui:'#ffd23f'}];
    const SFX={launch(){},footballGoal(){log.push('torklang');}};
    function fbArena(){return {spawn:6.4};}
    ${SRC}
    function neu(){placeBalls();resetCommits();phase='aim';fbGoalState='play';
      footballWinner=null;score=[0,0,0,0];curAimer=0;log.length=0;torSeite=-1;}
    neu();
    return {
      log,
      neu,
      st:()=>({besitzer:balls.filter(b=>b.owner!==FOOTBALL_NEUTRAL_OWNER).map(b=>b.owner),
               kugeln:balls.length,
               offen:fbOffen(),bereit:aimSet.slice(0,np()).map(v=>v?1:0).join(''),
               wer:fbDecisionWho(),schuss:fbShotTicks,zeigt:fbShotShown(),schussFuer:fbShotFor,
               phase:phase,goal:fbGoalState,winner:footballWinner,
               blau:score[0]|0,rot:score[1]|0,np:np(),
               bank:fbBank.slice(),
               absichten:aimSet.map((v,o)=>v?{who:o,idx:commitIdx[o],fx:commitAim[o].dx,
                                              fy:commitAim[o].dy,spin:commitSpin[o]}:null).filter(Boolean)}),
      // Positionen und Teamzuordnung.
      pos:()=>balls.map(b=>({owner:b.owner,x:+b.x.toFixed(4),y:+b.y.toFixed(4)})),
      team:(o)=>fbTeam2Side(o),
      farbe:(o)=>colorSlot(o),
      // Greifbare Figuren im gemeinsamen Fenster: genau die offenen Besitzer.
      greifbar:()=>fbOffen(),
      zielen:(o,zug)=>{phase='aim';fbGoalState='play';curAimer=o;
                dragging=!!zug;dragOwner=zug?o:-1;
                dragShooter=zug?balls.findIndex(b=>b.owner===o&&b.alive):-1;
                dragSchwach=!!(zug&&zug.schwach);},
      loslassen:(o,fx,fy)=>{dragging=false;dragOwner=-1;dragShooter=-1;
                applyCommit(o,balls.findIndex(b=>b.owner===o&&b.alive),fx||0,fy||0,0);},
      tick:(k)=>{for(let i=0;i<(k||1);i++)fbClockStep();},
      launch:()=>{const vor=phase;applyLaunch();
                return {phaseVorher:vor,phase:phase,
                        v:balls.map(b=>({owner:b.owner,vx:+b.vx.toFixed(6),vy:+b.vy.toFixed(6)}))};},
      // Ein Tor an der genannten TORSEITE (0 = Blaus Tor, 1 = Rots Tor).
      tor:(seite)=>{torSeite=seite;fbGoalState='play';
                const ball=balls.find(b=>b.owner===FOOTBALL_NEUTRAL_OWNER);
                ball.fbPassed=true;footballTryGoal(ball);torSeite=-1;},
      reset:()=>{footballResetRound();},
      env:(o)=>{if('phase'in o)phase=o.phase;if('goal'in o)fbGoalState=o.goal;
                if('variante'in o)fbVariant=o.variante;if('classic'in o)fbRules=o.classic;},
    };
  `);
  return g();
}

const SHOT = 6 * 60;

// ══ A. VIER IDENTITAETEN, VIER EIGENE KUGELN ═════════════════════════════════
{
  const G = build('team2v2');
  ok(G.st().np === 4, 'True Team 2v2 hat genau vier Spielerplaetze');
  ok(G.st().besitzer.join(',') === '0,1,2,3',
     'vier Figuren mit VIER verschiedenen Besitzern: ' + G.st().besitzer.join(','));
  ok(G.st().kugeln === 5, 'dazu genau ein neutraler Ball (5 Koerper)');
  ok(/const FOOTBALL_TEAM2V2_PLAYERS=4;/.test(HTML), 'die Spielerzahl steht als Konstante');
  ok(/const FOOTBALL_TEAM2V2_NAMES=\['B1','B2','R1','R2'\];/.test(HTML),
     'und die vier Identitaeten in kanonischer Reihenfolge');
  // Tactical im Vergleich: DORT tragen zwei Figuren denselben Besitzer.
  const T = build('tactical');
  ok(T.st().besitzer.join(',') === '0,0,1,1',
     'Tactical dagegen hat zwei Figuren je Besitzer: ' + T.st().besitzer.join(','));
  ok(T.st().np === 2, 'und nur zwei Spielerplaetze');
}

// ══ B. B1/B2 SIND BLAU, R1/R2 SIND ROT ═══════════════════════════════════════
{
  const G = build('team2v2');
  ok(G.team(0) === 0 && G.team(1) === 0, 'B1 und B2 gehoeren Blau');
  ok(G.team(2) === 1 && G.team(3) === 1, 'R1 und R2 gehoeren Rot');
  ok(G.team(5) === -1, 'der neutrale Ball gehoert keinem Team');
  // Und die FARBE folgt dem Team, nicht dem Besitzer - Teamkameraden duerfen nie wie
  // Gegner aussehen.
  ok(G.farbe(0) === 0 && G.farbe(1) === 0, 'beide Blauen tragen den Blau-Farbslot');
  ok(G.farbe(2) === 1 && G.farbe(3) === 1, 'beide Roten den Rot-Farbslot');
  ok(G.farbe(5) === 5, 'der neutrale Ball behaelt seinen eigenen (dunklen) Slot');
  // Das Team ist eine ABLEITUNG, keine gespeicherte Tabelle: es kann nicht auseinanderlaufen.
  ok(/function fbTeam2Side\(o\)\{return \(o===0\|\|o===1\)\?0:\(\(o===2\|\|o===3\)\?1:-1\);\}/.test(HTML),
     'die Teamzuordnung ist eine reine Ableitung aus dem Besitz');
}

// ══ C. JEDER STEUERT NUR SEINE EIGENE FIGUR ══════════════════════════════════
{
  const G = build('team2v2');
  ok(G.greifbar().join(',') === '0,1,2,3', 'zu Beginn sind alle vier Figuren greifbar');
  G.loslassen(1, 5, 5);                       // B2 bestaetigt
  ok(G.greifbar().join(',') === '0,2,3',
     'nach B2s Commit ist SEINE Figur nicht mehr greifbar - und nur seine');
  // Die Auswahl filtert ueber `owner`. Es gibt keinen Weg, ueber den B1 die Kugel von B2
  // ansprechen koennte: pickOwnBall nimmt entweder EINEN Besitzer oder die offene Menge.
  ok(/function pickOwnBall\(who,p\)\{const viele=Array\.isArray\(who\);/.test(HTML),
     'die Auswahl nimmt einen Besitzer oder eine Liste von Besitzern');
  ok(/viele\?who\.indexOf\(b\.owner\)>=0:b\.owner===who/.test(HTML),
     'und filtert in beiden Faellen ausschliesslich nach `owner`');
  ok((HTML.match(/viele\?who\.indexOf\(b\.owner\)>=0:b\.owner===who/g) || []).length === 2,
     'in 2D und in 3D auf genau dieselbe Weise');
  // WICHTIG UND BEWUSST: der lokale Maus-Ersatz (eine Maus, vier Figuren, ein Fenster)
  // erlaubt demselben Zeiger, nacheinander JEDE offene Figur zu greifen. Das ist die
  // geforderte Eingabehilfe, keine Aufweichung des Besitzes - denn die ABSICHT landet
  // immer im Platz des tatsaechlichen Besitzers der gegriffenen Kugel:
  ok(/startAim\(balls\[idx\]\.owner,idx,p,e\);/.test(HTML),
     '2D bindet den Zug an den Besitzer der GEGRIFFENEN Kugel, nicht an den gefuehrten Spieler');
  ok(/const wer=balls\[idx\]\.owner;/.test(HTML) && /startAim\(wer,idx,localPt\(e\),e\);/.test(HTML),
     'und 3D auf genau dieselbe Weise');
  ok(/if\(!\(Number\.isInteger\(idx\)&&balls\[idx\]&&balls\[idx\]\.alive&&balls\[idx\]\.owner===who\)\)/.test(HTML),
     'und sanitizeMove verwirft jeden Zug, dessen Kugel dem Besitzer nicht gehoert');
  // Praktisch: ein Commit fuer B2 landet im Platz von B2 - nie in dem eines anderen.
  {
    const H = build('team2v2');
    H.loslassen(1, 4.5, -2.5);
    const a = H.st().absichten;
    ok(a.length === 1 && a[0].who === 1, 'die Absicht liegt im Platz von B2');
    ok(a[0].idx === 1, 'und zeigt auf SEINE Kugel (Index 1)');
    ok(H.st().bereit === '0100', 'kein anderer Platz ist dadurch belegt');
  }
  // Und die Menge, die im gemeinsamen Fenster uebergeben wird, sind die OFFENEN Besitzer.
  ok((HTML.match(/const ziel=\(typeof fbShared==='function'&&fbShared\(\)\)\?fbOffen\(\):who;/g) || []).length === 2,
     'im gemeinsamen Fenster ist das die offene Menge, sonst genau ein Spieler');
}

// ══ D. EIN GEMEINSAMES SECHS-SEKUNDEN-FENSTER ════════════════════════════════
{
  ok(/const FOOTBALL_TEAM2V2_SHOT_SECONDS=6;/.test(HTML), 'der Riegel steht als eigene Konstante');
  ok(/const FOOTBALL_TEAM2V2_SHOT_TICKS=FOOTBALL_TEAM2V2_SHOT_SECONDS\*FOOTBALL_SIM_HZ;/.test(HTML),
     'und rechnet in Ticks, nicht in Wanduhr');
  const G = build('team2v2');
  G.zielen(0, {});
  ok(G.st().wer >= 0, 'das gemeinsame Fenster ist offen');
  ok(G.st().zeigt === SHOT, 'es beginnt mit ' + SHOT + ' Ticks = 6,0 Sekunden');
  G.tick(90);
  ok(G.st().schuss === SHOT - 90, 'der Countdown sinkt um genau einen Tick je Schritt');
  ok(G.st().schussFuer === -2, 'und gehoert dem FENSTER, keinem Spieler');
  // Eine Bestaetigung startet ihn NICHT neu - das ist der Kern.
  G.loslassen(0, 7.25, -3.5);
  G.zielen(1, {});
  G.tick(1);
  ok(G.st().schuss === SHOT - 91, 'eine Bestaetigung startet ihn nicht neu');
  // Keine Phasenuhr: True Team 2v2 spielt First to 3, nicht auf Zeit.
  ok(!/FOOTBALL_TEAM2V2_PHASE/.test(HTML), 'es gibt keine Phasenuhr in diesem Modus');
}

// ══ E. EIN EINZELNER SCHUSS SCHLIESST DAS FENSTER NICHT ══════════════════════
{
  const G = build('team2v2');
  G.loslassen(0, 1, 1);
  ok(G.st().bereit === '1000' && G.log.indexOf('reveal') < 0,
     'B1 ist bereit - abgeschossen wird nicht');
  G.loslassen(2, 2, 2);
  ok(G.st().bereit === '1010' && G.log.indexOf('reveal') < 0,
     'auch quer durch die Teams bestaetigt niemand fuer die anderen');
  G.loslassen(1, 3, 3);
  ok(G.log.indexOf('reveal') < 0, 'auch mit drei Bestaetigten faehrt niemand los');
  ok(G.st().offen.join(',') === '3', 'genau R2 ist noch offen');
  ok(G.log.filter(z => z.indexOf('cover:') === 0).length === 0,
     'und es gibt kein Weiterreichen des Geraets');
}

// ══ F. SIND ALLE BEREIT, SCHLIESST DAS FENSTER SOFORT ════════════════════════
{
  const G = build('team2v2');
  G.zielen(0, {});
  G.tick(78);                                  // 1,3 s
  G.loslassen(0, 1, 1); G.loslassen(2, 2, 2); G.loslassen(1, 3, 3);
  ok(G.st().wer >= 0, 'solange einer offen ist, laeuft das Fenster');
  G.loslassen(3, 4, 4);
  ok(G.log.indexOf('reveal') >= 0, 'mit dem vierten Commit schliesst es sofort');
  ok(G.st().wer === -1, 'und niemand kann mehr entscheiden');
  const rest = G.st().schuss;
  G.tick(300);
  ok(G.st().schuss === rest, 'der Countdown steht ab diesem Augenblick');
  ok(rest === SHOT - 78, 'verbraucht wurden genau die 1,3 s des Fensters');
}

// ══ G+H. ABLAUF: GENAU DER ANLIEGENDE VEKTOR, SONST NULLZUG ══════════════════
{
  const G = build('team2v2');
  G.loslassen(0, 9, 9);                        // B1 hat frueh bestaetigt
  G.zielen(2, {});                             // R1 haelt einen Zug
  G.tick(SHOT);
  ok(G.st().bereit === '1111', 'der Ablauf bestaetigt ALLE noch offenen Spieler');
  const a = G.st().absichten;
  const r1 = a.find(x => x.who === 2);
  ok(r1.fx === 7.25 && r1.fy === -3.5 && r1.spin === 0.25,
     'wer einen Zug anliegen hatte, bekommt GENAU diesen');
  ok(a.find(x => x.who === 1).fx === 0 && a.find(x => x.who === 3).fx === 0,
     'wer keinen hatte, bekommt einen Nullzug - kein erfundener Schuss');
  ok(a.find(x => x.who === 0).fx === 9, 'und der frueh Bestaetigte behaelt seinen Vektor');
  ok(G.log.indexOf('reveal') >= 0, 'danach schliesst das Fenster');
  // Der anliegende Zug eines SPAETEREN Spielers darf die Schleife ueberleben.
  const H = build('team2v2');
  H.zielen(3, {});                             // R2 - der LETZTE in kanonischer Ordnung
  H.tick(SHOT);
  const r2 = H.st().absichten.find(x => x.who === 3);
  ok(r2.fx === 7.25 && r2.fy === -3.5,
     'auch der letzte Spieler bekommt seinen Vektor, nicht einen Nullzug');
}

// ══ I. ALLE VIER GESCHWINDIGKEITEN VOR DEM ERSTEN PHYSIKSCHRITT ══════════════
{
  const G = build('team2v2');
  for (const o of [0, 1, 2, 3]) G.loslassen(o, o + 1, -(o + 1));
  ok(G.log.filter(z => z === 'phase:sim').length === 0,
     'zwischen den Bestaetigungen hat KEIN Simulationsschritt stattgefunden');
  const r = G.launch();
  ok(r.phaseVorher === 'reveal', 'der Abschuss beginnt aus der Reveal-Phase');
  const bewegt = r.v.filter(v => v.vx !== 0 || v.vy !== 0).map(v => v.owner);
  ok(bewegt.join(',') === '0,1,2,3', 'nach applyLaunch tragen ALLE vier eine Geschwindigkeit');
  ok(r.phase === 'sim', 'und erst danach beginnt die Simulation');
  const launchSrc = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
  const zeilen = launchSrc.trim().split('\n');
  ok(/setPhase\('sim'\)/.test(zeilen[zeilen.length - 2]),
     'setPhase(sim) steht am Ende von applyLaunch - keine Zuweisung danach');
}

// ══ J. KEIN VORTEIL DURCH DIE REIHENFOLGE DER EINGABE ════════════════════════
{
  const A = build('team2v2');
  for (const o of [0, 1, 2, 3]) A.loslassen(o, o + 1, -(o + 1));
  const ra = A.launch();
  const B2 = build('team2v2');
  for (const o of [3, 1, 0, 2]) B2.loslassen(o, o + 1, -(o + 1));
  const rb = B2.launch();
  ok(JSON.stringify(ra.v) === JSON.stringify(rb.v),
     'dieselben Absichten ergeben exakt dieselben Geschwindigkeiten - egal in welcher '
     + 'Reihenfolge sie eingegeben wurden');
  const launchSrc = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
  ok(/for\(let p=0;p<commitIdx\.length;p\+\+\)/.test(launchSrc),
     'applyLaunch laeuft in kanonischer Spielerreihenfolge (B1,B2,R1,R2)');
}

// ══ K+L+M. TEAMWERTUNG NACH TORSEITE, EIGENTOR EINGESCHLOSSEN ════════════════
{
  const G = build('team2v2');
  ok(G.st().blau === 0 && G.st().rot === 0, 'das Match beginnt 0:0');
  // Ueberquert der Ball ROTS Tor (Seite 1), punktet BLAU.
  G.tor(1);
  ok(G.st().blau === 1 && G.st().rot === 0, 'ein Tor in Rots Tor gibt BLAU genau einen Punkt');
  ok(G.log.filter(z => z === 'torklang').length === 1, 'und wird genau einmal gewertet');
  G.neu();
  // Ueberquert er BLAUS Tor (Seite 0), punktet ROT - auch wenn ein Blauer ihn dorthin
  // geschossen hat. Entscheidend ist die Torseite, nicht die letzte Beruehrung.
  G.tor(0);
  ok(G.st().rot === 1 && G.st().blau === 0,
     'ein Tor in Blaus eigenes Tor gibt ROT den Punkt (Eigentor)');
  // Das ist keine Sonderregel, sondern faellt aus der bestehenden Abbildung heraus.
  ok(/function footballGoalSide\(b\)\{[\s\S]*?return s<0\?-1:\(s===1\?0:1\);/.test(HTML),
     'die ueberquerte Torseite wird auf das punktende Team abgebildet - eine Zeile, kein Sonderfall');
  ok(!/letzte? ?(Beruehrung|touch)/i.test(grab(/function footballTryGoal\(b\)\{[\s\S]*?\n\}/, 'footballTryGoal')),
     'die Wertung kennt keinen Begriff von letzter Beruehrung');
  // Und es gibt genau EINEN Zaehlpfad.
  ok((HTML.match(/score\[side\]=\(score\[side\]\|\|0\)\+1;/g) || []).length === 1,
     'der Punkt wird an genau einer Stelle vergeben');
}

// ══ N. ERSTES TEAM MIT DREI TOREN GEWINNT ════════════════════════════════════
{
  const G = build('team2v2');
  G.tor(1); ok(G.st().winner === null, 'bei 1:0 ist nichts entschieden');
  G.tor(1); ok(G.st().winner === null, 'bei 2:0 auch nicht');
  G.tor(1);
  ok(G.st().blau === 3, 'Blau steht bei drei Toren');
  ok(G.st().winner === 0, 'und Blau gewinnt das Match');
  ok(/const FOOTBALL_WIN_SCORE=3;/.test(HTML), 'die Grenze ist die bestehende Konstante');
  // Rot gewinnt genauso.
  const H = build('team2v2');
  H.tor(0); H.tor(0); H.tor(0);
  ok(H.st().rot === 3 && H.st().winner === 1, 'ebenso Rot mit drei Toren');
  // Keine Elimination, keine Leben, keine Phasenuhr in diesem Modus.
  const src = grab(/const FOOTBALL_VARIANT_TEAM2='team2v2';[\s\S]*?const FOOTBALL_TEAM2V2_NAMES=\[[^\]]*\];/, 'Team-2v2-Block');
  ok(!/LIVES|fbElimLives|fbFfaTicks|PHASE_TICKS/.test(src),
     'der Modusblock kennt weder Leben noch Phasenuhr noch Elimination');
}

// ══ O+P. RUNDENRESET STELLT ALLES DETERMINISTISCH WIEDER HER ═════════════════
{
  const G = build('team2v2');
  const start = JSON.stringify(G.pos());
  for (const o of [0, 1, 2, 3]) G.loslassen(o, 5, 5);
  G.launch();
  ok(G.st().bereit === '1111', 'Vorzustand: alle bestaetigt und abgeschossen');
  G.reset();
  ok(JSON.stringify(G.pos()) === start,
     'der Rundenreset stellt alle vier Figuren UND den Ball exakt wieder her');
  ok(G.st().bereit === '0000', 'niemand ist mehr bestaetigt');
  ok(G.st().absichten.length === 0, 'und keine Absicht aus der vorigen Runde ueberlebt');
  ok(G.st().offen.join(',') === '0,1,2,3', 'das naechste gemeinsame Fenster steht allen offen');
  // Zweimal zuruecksetzen ergibt zweimal denselben Zustand.
  G.reset();
  ok(JSON.stringify(G.pos()) === start, 'und er ist bei jedem Reset derselbe');
}

// ══ Q. SPIEGELSYMMETRIE DER AUFSTELLUNG ══════════════════════════════════════
{
  const G = build('team2v2');
  const p = G.pos();
  const b1 = p.find(x => x.owner === 0), b2 = p.find(x => x.owner === 1);
  const r1 = p.find(x => x.owner === 2), r2 = p.find(x => x.owner === 3);
  const ball = p.find(x => x.owner === 5);
  ok(b1.x < 0 && b2.x < 0, 'Blau steht auf der -x-Seite');
  ok(r1.x > 0 && r2.x > 0, 'Rot auf der +x-Seite');
  ok(r1.x === -b1.x && r1.y === b1.y, 'R1 ist die exakte Spiegelung von B1');
  ok(r2.x === -b2.x && r2.y === b2.y, 'R2 die exakte Spiegelung von B2');
  ok(ball.x === 0 && ball.y === 0, 'der neutrale Ball startet zentral');
  // Und es sind DIESELBEN Koordinaten wie in Tactical - dieselbe Konstante, kein zweiter Satz.
  const T = build('tactical');
  const tp = T.pos();
  ok(JSON.stringify(p.map(x => [x.x, x.y])) === JSON.stringify(tp.map(x => [x.x, x.y])),
     'die Aufstellung ist Koordinate fuer Koordinate die von Tactical');
  ok(!/FOOTBALL_TEAM2V2_SPAWN/.test(HTML), 'es gibt keinen zweiten Spawn-Satz');
  ok((HTML.match(/const S=FOOTBALL_TACTICAL_SPAWN;/g) || []).length === 2,
     'beide Modi lesen dieselbe Spawn-Konstante');
}

// ══ R. MODUSWECHSEL LAESST NICHTS HINUEBERLAUFEN ═════════════════════════════
{
  const startSrc = grab(/function startFootball\(variant,rules\)\{[\s\S]*?\n\}/, 'startFootball');
  ok(/fbVariant=\(variant===FOOTBALL_VARIANT_TACTICAL\|\|variant===FOOTBALL_VARIANT_ELIM/.test(startSrc)
     && /\|\|variant===FOOTBALL_VARIANT_TEAM2\|\|dev4\)\?variant:'classic';/.test(startSrc),
     'startFootball kennt vier Varianten und clamped alles andere auf Classic');
  ok(/\}else fbElimRules=FOOTBALL_ELIM_RULES_LIVES;/.test(startSrc),
     'jeder Start ausserhalb der Elimination setzt die Eliminationsregel zurueck');
  ok(/fbRules=\(rules===FOOTBALL_RULES_SPEED\)\?FOOTBALL_RULES_SPEED:FOOTBALL_RULES_FIRST3;/.test(startSrc),
     'und die Classic-Regel wird bei JEDEM Start neu gesetzt');
  ok(/fbElimStartN=0;/.test(startSrc), 'die Startspielerzahl der Elimination ebenfalls');
  // True Team 2v2 haelt selbst keinen Zustand, der ueberleben koennte: seine gesamte
  // Identitaet ist fbVariant, und die wird bei jedem Start gesetzt.
  const src = grab(/const FOOTBALL_VARIANT_TEAM2='team2v2';[\s\S]*?const FOOTBALL_TEAM2V2_NAMES=\[[^\]]*\];/, 'Team-2v2-Block');
  ok(!/\blet\b/.test(src), 'der Modusblock deklariert keine einzige veraenderliche Groesse');
}

// ══ S. TACTICAL BLEIBT UNVERAENDERT ══════════════════════════════════════════
{
  const T = build('tactical');
  ok(T.st().besitzer.join(',') === '0,0,1,1', 'Tactical: zwei Figuren je Besitzer');
  ok(T.st().np === 2, 'zwei Spielerplaetze');
  ok(T.st().wer === -1, 'und KEIN Bedenkzeitfenster - Tactical kennt keine Zeit');
  ok(T.greifbar().length === 0, 'auch kein gemeinsames Fenster');
  ok(/function fbTactical\(\)\{return mode==='football'&&fbVariant===FOOTBALL_VARIANT_TACTICAL;\}/.test(HTML),
     'die Tactical-Weiche ist unveraendert');
  ok(/function fbSelectFigure\(who,idx\)\{/.test(HTML), 'die Figurenwahl existiert unveraendert');
  ok(/if\(!fbTactical\(\)\|\|who<0\|\|who>1\)return false;/.test(HTML),
     'und bleibt auf Tactical und zwei Spieler begrenzt');
  ok(/const fbSel=\[-1,-1\];/.test(HTML), 'ihr Zustand ist unveraendert zweistellig');
  ok(/function fbTacticalRingLevel\(i\)\{\s*\n\s*if\(!fbTactical\(\)/.test(HTML),
     'und der Auswahlring gilt weiterhin nur in Tactical');
}

// ══ T. CLASSIC BLEIBT UNVERAENDERT ═══════════════════════════════════════════
{
  // True Team 2v2 faellt ausdruecklich NICHT unter Classic - sonst haetten dort die
  // Speed-Match-Regeln gegolten.
  ok(/function fbClassic\(\)\{return mode==='football'&&!fbElim4\(\)&&!fbTactical\(\)&&!fbTeam2\(\);\}/.test(HTML),
     'Classic schliesst True Team 2v2 ausdruecklich aus');
  const G = build('team2v2');
  G.zielen(0, {});
  G.tick(120);
  ok(G.st().bank[0] === 45 * 60 && G.st().bank[1] === 45 * 60,
     'die persoenlichen Zeitkonten von Speed Match bleiben unberuehrt');
  ok(/else if\(fbSpeed\(\)&&fbBank\[who\]>0\)\{/.test(HTML),
     'das Konto sinkt nur, wenn wirklich Speed Match laeuft');
  for (const c of [/const FOOTBALL_WIN_SCORE=3;/, /const FOOTBALL_BANK_SECONDS=45;/,
                   /const FOOTBALL_SHOT_SECONDS=6;/, /const FOOTBALL_TROUBLE_SECONDS=2;/])
    ok(c.test(HTML), 'Classic-Konstante unveraendert: ' + c.source);
}

// ══ U+V. LEBENSREGEL UND TIMED FFA BLEIBEN UNVERAENDERT ══════════════════════
{
  ok(/const FB_ELIM_LIVES=2;/.test(HTML), 'die Lebensregel behaelt ihre zwei Leben');
  ok(/const FOOTBALL_FFA_PHASE_SECONDS=60;/.test(HTML), 'Timed FFA behaelt seine 60 s');
  ok(/const FOOTBALL_FFA_SHOT_SECONDS=6;/.test(HTML), 'und seinen eigenen Riegel');
  ok(/function fbTimed\(\)\{return fbElim4\(\)&&!online&&fbElimRules===FOOTBALL_ELIM_RULES_TIMED;\}/.test(HTML),
     'die Zeitregel haengt unveraendert an der Elimination');
  // Das gemeinsame Fenster gehoert jetzt beiden - aber jede Regel bringt ihre EIGENE
  // Riegellaenge mit, und keine liest die der anderen.
  ok(/FOOTBALL_TEAM2V2_SHOT_TICKS:\(\(typeof fbLives==='function'&&fbLives\(\)\)\?FOOTBALL_LIVES_SHOT_TICKS:FOOTBALL_FFA_SHOT_TICKS\);/.test(HTML),
     'jede der drei Regeln benutzt ihre eigene Riegelkonstante');
  ok(/function fbShared\(\)\{return \(typeof fbTimed==='function'&&fbTimed\(\)\)\|\|\(typeof fbLives==='function'&&fbLives\(\)\)\|\|fbTeam2\(\);\}/.test(HTML),
     'und das gemeinsame Fenster ist die Vereinigung der drei - nicht eine vierte Regel');
  // fbOffen bedient beide aus DERSELBEN Funktion.
  ok((HTML.match(/function fbOffen\(\)/g) || []).length === 1,
     'es gibt genau eine Fassung der offenen Menge');
}

// ══ W. ONLINE, PROTOKOLL UND RULES UNBERUEHRT ════════════════════════════════
{
  ok(/const ONLINE_PROTOCOL_VERSION=7;/.test(HTML), 'Protokollversion unveraendert');
  ok(/const FOOTBALL_FMTS=\['elimination'\];/.test(HTML), 'FOOTBALL_FMTS unveraendert');
  const src = grab(/const FOOTBALL_VARIANT_TEAM2='team2v2';[\s\S]*?const FOOTBALL_TEAM2V2_NAMES=\[[^\]]*\];/, 'Team-2v2-Block');
  const code = src.split('\n').filter(z => !/^\s*\/\//.test(z)).join('\n');
  ok(!/online|onlineSend|rRef|firebase|MOVE|roomCode/.test(code),
     'der Modusblock liest und schreibt nichts Netzwerkbezogenes');
  // Online kann diesen Modus nicht erreichen: der Onlineeinstieg setzt die Variante auf
  // Elimination, und fbTeam2 verlangt genau die Team-2v2-Variante.
  ok(/function fbTeam2\(\)\{return mode==='football'&&fbVariant===FOOTBALL_VARIANT_TEAM2;\}/.test(HTML),
     'fbTeam2 verlangt ausdruecklich die Team-2v2-Variante');
  // Alle VIER Onlineeinstiege (Erstellen, Beitreten, Deep Link, Rejoin) setzen die
  // Variante ausdruecklich auf Elimination - keiner von ihnen kann in True Team 2v2
  // landen, weder absichtlich noch als Rest aus einem vorigen lokalen Match.
  ok((HTML.match(/fbVariant=FOOTBALL_VARIANT_ELIM/g) || []).length === 4,
     'die vier Onlineeinstiege setzen die Variante ausdruecklich auf Elimination');
  // Und die neue Variante taucht ausschliesslich lokal auf: Deklaration, Weiche,
  // startFootball-Clamp, Menueknopf, Dev-Direktlink und die fbVariant-Vorbelegung.
  ok((HTML.match(/FOOTBALL_VARIANT_TEAM2/g) || []).length === 6,
     'die Variante wird an genau sechs Stellen genannt (erhalten: '
     + (HTML.match(/FOOTBALL_VARIANT_TEAM2/g) || []).length + ')');
}

// ══ Anzeige ══════════════════════════════════════════════════════════════════
{
  ok(/function renderTeam2Bar\(\)\{/.test(HTML), 'es gibt eine eigene Chipleiste');
  const bar = grab(/function renderTeam2Bar\(\)\{[\s\S]*?\n\}/, 'renderTeam2Bar');
  ok(/chip\.className='fchip'\+\(offen\?' act':''\)\+\(rdy\?' rdy':''\)/.test(bar),
     'sie benutzt die BESTEHENDEN Chip-Zustaende act und rdy - kein zweites Bauteil');
  ok(/pcol\(colorSlot\(o\)\)\.ui/.test(bar), 'und die Teamfarbe aus derselben Quelle wie der Renderer');
  ok(/FOOTBALL_TEAM2V2_NAMES\[o\]/.test(bar), 'die Chips tragen B1/B2/R1/R2');
  // Punktestand UND Chips: der Modus braucht beides.
  ok(/const punkte=!\(ffa\|\|\(typeof fbElim4==='function'&&fbElim4\(\)\)\);/.test(HTML),
     'der Punktestand bleibt in True Team 2v2 sichtbar');
  ok(/const chips=ffa\|\|\(typeof fbElim4==='function'&&fbElim4\(\)\)\|\|team2;/.test(HTML),
     'und die Chipleiste kommt hinzu');
  // Der grosse zentrale Countdown ist der bestehende.
  ok(/const gemeinsam=typeof fbShared==='function'&&fbShared\(\);/.test(HTML),
     'der grosse zentrale Countdown gilt in jedem gemeinsamen Fenster');
}

console.log('');
console.log('Football-Team-2v2: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
