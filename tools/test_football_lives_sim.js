// Arena Football LEBENSREGEL SIMULTAN — fokussierte Regelsuite.
//
// Die Lebensregel lief lokal bis zuletzt sequentiell: ein Spieler zielte hinter dem
// Uebergabeschirm, gab ab, der naechste bekam das Geraet. Seit LIVES SIMULTANEOUS 01
// entscheiden ALLE aktiven Spieler im SELBEN Sechs-Sekunden-Fenster, danach starten alle
// Figuren gleichzeitig.
//
// Die REGEL ist dabei unberuehrt: zwei Gegentore, dann raus. Was sich geaendert hat, ist
// ausschliesslich der Ablauf - und er ist kein zweites Werk, sondern dasselbe gemeinsame
// Fenster, das Timed FFA und True Team 2v2 schon benutzen (fbShared/fbOffen).
//
// Was diese Suite prueft:
//   1. ein gemeinsames Fenster fuer 3, 4 und 5 Spieler
//   2. eine Bestaetigung schiesst niemanden ab; alle bereit schliesst sofort
//   3. Ablauf: anliegender Vektor genau so, sonst Nullzug - fuer JEDEN Offenen
//   4. alle Geschwindigkeiten vor dem ersten Physikschritt, reihenfolgeunabhaengig
//   5. die Lebensbuchung 2 -> 1 -> raus, unveraendert
//   6. keine Phasenuhr, kein Gleichstand, kein Sequenzrest
//   7. Zeitregel, Team 2v2, Classic, Tactical, Arena B und Online unberuehrt
//
// Wie alle Football-Harnesse extrahiert die Suite die ECHTEN Quellen aus index.html.
//
// Usage: node tools/test_football_lives_sim.js

const { loadIndexHtml, grab: grabIn } = require('./extract.js');
const HTML = loadIndexHtml();
const grab = (re, name) => grabIn(HTML, re, name);

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }

// ── Die echten Quellen ───────────────────────────────────────────────────────
const SRC = [
  grab(/const FOOTBALL_SIM_HZ=[^\n]*/, 'FOOTBALL_SIM_HZ'),
  grab(/const FOOTBALL_ELIM_MAX_PLAYERS=[^\n]*/, 'FOOTBALL_ELIM_MAX_PLAYERS'),
  grab(/const FOOTBALL_ELIM_START_PLAYERS=[^\n]*/, 'FOOTBALL_ELIM_START_PLAYERS'),
  grab(/const FOOTBALL_ELIM4_PLAYERS=[^\n]*/, 'FOOTBALL_ELIM4_PLAYERS'),
  grab(/const FOOTBALL_VARIANT_ELIM='elimination';/, 'FOOTBALL_VARIANT_ELIM'),
  grab(/const FOOTBALL_VARIANT_ELIM4='elimination4';/, 'FOOTBALL_VARIANT_ELIM4'),
  grab(/let fbElimStartN=0;[^\n]*/, 'fbElimStartN'),
  grab(/function fbElim4\(\)\{[^\n]*/, 'fbElim4'),
  grab(/function fbElimPlayers\(\)\{[\s\S]*?\n\}/, 'fbElimPlayers'),
  grab(/function fbElimSlotOwner\(slot\)\{[^\n]*/, 'fbElimSlotOwner'),
  grab(/const FB_ELIM_LIVES=2;[\s\S]*?\nfunction fbElimReset\(\)\{[\s\S]*?\n\}/, 'Elimination-Zustand + Reset'),
  grab(/function fbElimActiveOwners\(\)\{[^\n]*/, 'fbElimActiveOwners'),
  grab(/function fbElimApplyPhase\(\)\{[\s\S]*?\n\}/, 'fbElimApplyPhase'),
  grab(/function footballElimEliminate\(o\)\{[\s\S]*?\n\}/, 'footballElimEliminate'),
  // Der Kern dieser Suite: die Zeitregel als Ganzes.
  grab(/const FOOTBALL_ELIM_RULES_LIVES='lives';[\s\S]*?\nfunction fbFfaResolve\(imTor\)\{[\s\S]*?\n\}/, 'Timed-FFA-Block'),
  grab(/function footballElimConcede\(o\)\{[\s\S]*?\n\}/, 'footballElimConcede'),
  // Die Anzeige liegt im HUD-Teil, nicht im Regelblock.
  grab(/function fbFfaHeadText\(\)\{[\s\S]*?\n\}/, 'fbFfaHeadText'),
  grab(/function fbFfaClockText\(\)\{[\s\S]*?\n\}/, 'fbFfaClockText'),
  // Das gemeinsame Fenster gehoert seit True Team 2v2 zwei Regeln. Die Praedikate
  // kommen deshalb mit - sonst pruefte diese Suite eine Uhr, deren Gatter fehlt.
  grab(/const FOOTBALL_VARIANT_TEAM2='team2v2';[\s\S]*?const FOOTBALL_TEAM2V2_NAMES=\[[^\]]*\];/,
       'Team-2v2-Konstanten'),
  grab(/function fbTeam2\(\)\{[^\n]*/, 'fbTeam2'),
  grab(/function fbTeam2Side\(o\)\{[^\n]*/, 'fbTeam2Side'),
  grab(/function fbShared\(\)\{[^\n]*/, 'fbShared'),
  grab(/function fbSharedShotTicks\(\)\{[^\n]*/, 'fbSharedShotTicks'),
  // DIE BEDENKZEITUHR SELBST. Sie gehoert Classic und Timed FFA gemeinsam; ohne sie
  // koennte diese Suite die Zeitsemantik nur behaupten statt sie laufen zu lassen.
  grab(/const FOOTBALL_RULES_FIRST3='first3';[\s\S]*?\nfunction fbShotText\(ticks\)\{[\s\S]*?\n\}/,
       'Classic-Regeln + Bedenkzeituhr'),
  // fbShotShown() liegt im HUD-Teil: sie beantwortet den Uebergang zum naechsten
  // Spieler richtig, in dem fbShotTicks noch dem vorigen gehoert.
  grab(/function fbShotShown\(\)\{[\s\S]*?\n\}/, 'fbShotShown'),
  // DER COMMIT- UND ABSCHUSSWEG. Ohne ihn koennte diese Suite "gleichzeitig" nur
  // behaupten: applyCommit sammelt die Absichten und entscheidet, wann das Fenster
  // schliesst; applyLaunch weist ALLE Geschwindigkeiten zu, bevor die Simulation
  // beginnt. Genau das ist die Regel, und genau das wird hier gemessen.
  grab(/function sanitizeMove\(who,idx,dx,dy,sp\)\{[\s\S]*?\n\}/, 'sanitizeMove'),
  grab(/function applyCommit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'applyCommit'),
  grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch'),
  grab(/function fbOffen\(\)\{[\s\S]*?\n\}/, 'fbOffen'),
  grab(/let fbAutoShots=0, fbAutoSkips=0, fbTroubleSeen=\[false,false\];/, 'Zaehler der Automatik'),
].join('\n');

// ── Sandkasten ───────────────────────────────────────────────────────────────
// Alles Regelrelevante kommt unveraendert aus index.html. Gestubbt ist nur die
// Aussenwelt: Kugeln, HUD, Umbau, Matchende. Jeder Stub zaehlt seine Aufrufe, damit die
// Reihenfolge pruefbar ist statt nur das Ergebnis.
function build(n) {
  const g = new Function(`
    let mode='football', online=false;
    let phase='sim', menuVisible=false, fbGoalState='play', footballWinner=null, fbGoalTick=0;
    let balls=[];
    let fbVariant='elimination';
    // Die Aussenwelt der Bedenkzeituhr. Alles davon ist gestubbt - die Uhr selbst kommt
    // unveraendert aus index.html.
    let r3dOrbit=false;
    const document={hidden:false};
    let curAimer=-1, aimSet=[false,false,false,false,false];
    let score=[0,0];
    // Der anliegende Zugvektor. Der Harness entscheidet, ob gerade einer da ist; die
    // Werte sind bewusst unrund, damit "genau dieser Vektor" pruefbar ist.
    let dragging=false, dragOwner=-1, dragShooter=-1, dragSchwach=false;
    function aimVectorFromDrag(){return dragging?{fx:7.25,fy:-3.5,spin:0.25,weak:dragSchwach}:null;}
    function cancelAimDrag(){dragging=false;dragOwner=-1;dragShooter=-1;}
    function inputLocked(){return false;}
    function aliveCount(o){return (o>=0&&balls[o]&&balls[o].alive)?1:0;}
    function aliveBalls(o){return balls.filter(b=>b.owner===o&&b.alive);}
    function fbTactical(){return false;}
    // applyCommit und applyLaunch kommen ECHT aus index.html. Gestubbt ist nur, was
    // darunter liegt: Netz, Bot, HUD, Klang, Renderer.
    let commitIdx=[], commitAim=[], commitSpin=[];
    const LAUNCH=0.22;
    function maxPull(){return 100;}
    function np(){return balls.length;}
    function setPhase(p){phase=p;log.push('phase:'+p);}
    function setPhaseText(){}
    function beginReveal(){log.push('reveal');setPhase('reveal');}
    function openCover(o){log.push('cover:'+o);}
    function onlineSendCommit(){log.push('netz');}
    function botMove(){return {idx:0,dx:0,dy:0};}
    function devSync(){}
    function fbLaunchMul(){return LAUNCH;}
    function fbSfxLaunch(){log.push('launchSfx');}
    function fbFeelLaunch(){}
    function spawn(){}
    const r3dActive=true, PCOLS=[{ui:'#fff'}], SFX={launch(){}};
    const seatGone=[false,false,false,false,false];   // nur fuer die Online-Diagnose in applyLaunch
    const BR=14;                                     // Kugelradius: applyLaunch prueft daran nur die Rueckmeldung
    function colorSlot(o){return 0;}
    function fbCloseCover(){log.push('coverZu');fbSetCover(false);}
    ${SRC}
    const log=[];
    function updateHud(){log.push('hud');}
    function footballMatchEnd(){log.push('matchEnd');}
    function footballMatchEndNoWinner(){log.push('matchEndNoWinner');}
    function fbElimSpawnBodies(){log.push('spawn');}
    function footballElimResetBall(){log.push('resetBall');if(!fbElimApplyPhase())fbElimSpawnBodies();}
    function fbMorphWanted(){return false;}
    function fbMorphBegin(){log.push('morph');}
    function fbMorphPlanSet(){}
    function T(k){return k;}
    // Eine Figur je Spieler — mehr braucht die Regel nicht.
    function setup(anzahl){
      fbElimStartN=anzahl;
      balls=[];for(let o=0;o<anzahl;o++)balls.push({owner:o,alive:true,vx:0,vy:0,spin:0});
      fbElimReset();fbFfaReset();fbClockReset();
      fbElimRules=FOOTBALL_ELIM_RULES_TIMED;
      footballWinner=null;fbGoalState='play';phase='sim';menuVisible=false;
      curAimer=-1;aimSet=[false,false,false,false,false];
      dragging=false;dragOwner=-1;dragShooter=-1;dragSchwach=false;
      r3dOrbit=false;document.hidden=false;
      commitIdx=[];commitAim=[];commitSpin=[];
      for(let o=0;o<anzahl;o++){commitIdx.push(-1);commitAim.push({dx:0,dy:0});commitSpin.push(0);}
      log.length=0;
    }
    setup(${n});
    return {
      log,
      st:()=>({ticks:fbFfaTicks,due:fbFfaDue,danger:fbFfaDanger,
               set:fbFfaDangerSet.slice(),conceded:fbFfaConceded.slice(),
               aktiv:fbElimActiveOwners(),phaseN:fbElimPhaseN,winner:footballWinner,
               lives:fbElimLives.slice(),regel:fbElimRules,
               schuss:fbShotTicks,schussFuer:fbShotFor,zeigt:fbShotShown(),
               wer:fbDecisionWho(),bank:fbBank.slice(),
               autoSchuss:fbAutoShots,autoAus:fbAutoSkips,
               offen:fbOffen(),bereit:aimSet.map(v=>v?1:0).join(''),
               absichten:aimSet.map((v,o)=>v?{who:o,idx:commitIdx[o],fx:commitAim[o].dx,
                                              fy:commitAim[o].dy,spin:commitSpin[o]}:null)
                              .filter(Boolean)}),
      setup,
      // Ein NEUES gemeinsames Fenster. Im Produkt raeumt resetCommits() dieselben drei
      // Listen beim Rundenstart - hier steht dieselbe Wirkung, damit die Suite mehrere
      // Zyklen hintereinander spielen kann.
      fensterAuf:()=>{aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
                for(let p=0;p<balls.length;p++){aimSet.push(false);commitIdx.push(-1);
                  commitAim.push({dx:0,dy:0});commitSpin.push(0);}
                for(const b of balls){b.vx=0;b.vy=0;b.spin=0;}
                phase='aim';fbGoalState='play';menuVisible=false;
                curAimer=fbElimActiveOwners()[0];},
      // Der ECHTE Abschussweg, plus die Beobachtung, in welcher Reihenfolge und in welcher
      // Phase die Geschwindigkeiten gesetzt wurden. Genau daran haengt, ob der Abschuss
      // wirklich gleichzeitig ist.
      launch:()=>{
        const vorher=balls.map(b=>({vx:b.vx,vy:b.vy}));
        const phaseVorher=phase;
        applyLaunch();
        const bewegt=[];
        balls.forEach((b)=>{if(b.vx!==0||b.vy!==0)bewegt.push(b.owner);});
        return {phaseVorher:phaseVorher,phase:phase,bewegt:bewegt,
                v:balls.map(b=>({owner:b.owner,vx:+b.vx.toFixed(6),vy:+b.vy.toFixed(6),
                                 spin:b.spin||0}))};
      },
      // Ein Zug wird ueber den ECHTEN Weg bestaetigt.
      commit:(o,fx,fy,spin)=>applyCommit(o,balls.findIndex(b=>b.owner===o&&b.alive),
                                         fx||0,fy||0,spin||0),
      // Zustand von aussen setzen — der Harness spielt das Spiel, nicht die Regel.
      env:(o)=>{if('phase'in o)phase=o.phase;if('goal'in o)fbGoalState=o.goal;
                if('menu'in o)menuVisible=o.menu;if('ticks'in o)fbFfaTicks=o.ticks;
                if('regel'in o)fbElimRules=o.regel;if('online'in o)online=o.online;
                if('variante'in o)fbVariant=o.variante;if('classic'in o)fbRules=o.classic;
                if('orbit'in o)r3dOrbit=o.orbit;if('hidden'in o)document.hidden=o.hidden;
                if('cover'in o)fbSetCover(o.cover);},
      // EIN offenes Entscheidungsfenster: genau der Zustand, in dem ein Mensch den Schuss
      // noch aendern kann. Alles andere ist per Definition keine Bedenkzeit.
      zielen:(o,zug)=>{phase='aim';fbGoalState='play';menuVisible=false;
                curAimer=o;
                dragging=!!zug;dragOwner=zug?o:-1;
                dragShooter=zug?balls.findIndex(b=>b.owner===o&&b.alive):-1;
                dragSchwach=!!(zug&&zug.schwach);},
      // Loslassen: dieser Spieler bestaetigt - ueber den echten Commit-Weg.
      loslassen:(o,fx,fy)=>{dragging=false;dragOwner=-1;dragShooter=-1;
                applyCommit(o,balls.findIndex(b=>b.owner===o&&b.alive),fx||0,fy||0,0);},
      // Der Takt des Produkts: simStep ruft erst die Uhr, dann die Kurzmeldung.
      tick:(k)=>{for(let i=0;i<(k||1);i++){fbClockStep();fbFfaStep();}},
      step:(k)=>{for(let i=0;i<(k||1);i++)fbFfaStep();},
      concede:(o)=>footballElimConcede(o),
      resolve:(imTor)=>fbFfaResolve(!!imTor),
      running:()=>fbFfaRunning(),
      worst:()=>fbFfaWorst(),
      kopf:()=>fbFfaHeadText?fbFfaHeadText():'',
      uhr:()=>fbFfaClockText?fbFfaClockText():'',
    };
  `);
  return g();
}

const TICKS = 60 * 60;   // 60 s bei 60 Hz — derselbe Wert wie im Produkt
const SHOT = 6 * 60;

// Ein Sandkasten in der LEBENSREGEL, mit offenem gemeinsamem Fenster.
function leben(n) {
  const G = build(n);
  G.env({ regel: 'lives' });
  G.fensterAuf();
  return G;
}

// ══ A+B+C. EIN GEMEINSAMES FENSTER FUER 3, 4 UND 5 SPIELER ═══════════════════
{
  ok(/const FOOTBALL_LIVES_SHOT_SECONDS=6;/.test(HTML),
     'der Riegel der Lebensregel steht als eigene Konstante');
  ok(/const FOOTBALL_LIVES_SHOT_TICKS=FOOTBALL_LIVES_SHOT_SECONDS\*FOOTBALL_SIM_HZ;/.test(HTML),
     'und rechnet in Ticks, nicht in Wanduhr');
  for (const n of [3, 4, 5]) {
    const G = leben(n);
    ok(G.st().regel === 'lives', n + ' Spieler: die Lebensregel laeuft');
    ok(G.st().offen.length === n, n + ' Spieler: ALLE sind im selben Fenster offen');
    ok(G.st().wer >= 0, n + ' Spieler: das Entscheidungsfenster ist offen');
    G.zielen(G.st().offen[0], {});
    ok(G.st().zeigt === SHOT, n + ' Spieler: es beginnt mit ' + SHOT + ' Ticks = 6,0 s');
    G.tick(60);
    ok(G.st().schuss === SHOT - 60, n + ' Spieler: der Countdown sinkt einen Tick je Schritt');
    ok(G.st().schussFuer === -2, n + ' Spieler: er gehoert dem FENSTER, keinem Spieler');
    // Und er startet bei einer Bestaetigung NICHT neu.
    G.loslassen(G.st().offen[0], 5, 5);
    G.tick(1);
    ok(G.st().schuss === SHOT - 61, n + ' Spieler: eine Bestaetigung startet ihn nicht neu');
  }
  ok(/function fbLives\(\)\{return fbElim4\(\)&&!online&&fbElimRules===FOOTBALL_ELIM_RULES_LIVES;\}/.test(HTML),
     'die lokale Lebensregel ist ein eigener benannter Zustand');
  ok(/function fbShared\(\)\{return \(typeof fbTimed==='function'&&fbTimed\(\)\)\|\|\(typeof fbLives==='function'&&fbLives\(\)\)\|\|fbTeam2\(\);\}/.test(HTML),
     'und sie gehoert zum gemeinsamen Fenster - kein zweites daneben');
  ok((HTML.match(/function fbOffen\(\)/g) || []).length === 1,
     'es gibt genau eine Fassung der offenen Menge');
}

// ══ D. EINE BESTAETIGUNG SCHIESST NIEMANDEN AB ═══════════════════════════════
{
  const G = leben(5);
  G.loslassen(0, 1, 1);
  ok(G.st().bereit === '10000' && G.log.indexOf('reveal') < 0,
     'P1 ist bereit - abgeschossen wird nicht');
  G.loslassen(3, 2, 2);
  ok(G.st().bereit === '10010' && G.log.indexOf('reveal') < 0,
     'auch ausserhalb der Reihenfolge bestaetigt niemand fuer die anderen');
  G.loslassen(1, 3, 3); G.loslassen(4, 4, 4);
  ok(G.log.indexOf('reveal') < 0, 'auch mit vier Bestaetigten faehrt niemand los');
  ok(G.st().offen.join(',') === '2', 'genau P3 ist noch offen');
  ok(G.log.filter(z => z.indexOf('cover:') === 0).length === 0,
     'und das Geraet wird nirgends weitergereicht');
}

// ══ E. SIND ALLE BEREIT, SCHLIESST DAS FENSTER SOFORT ════════════════════════
{
  const G = leben(4);
  G.zielen(0, {});
  G.tick(72);                                   // 1,2 s
  for (const o of [0, 1, 2]) G.loslassen(o, o + 1, 1);
  ok(G.st().wer >= 0, 'solange einer offen ist, laeuft das Fenster');
  G.loslassen(3, 4, 1);
  ok(G.log.indexOf('reveal') >= 0, 'mit dem letzten Commit schliesst es sofort');
  ok(G.st().wer === -1, 'und niemand kann mehr entscheiden');
  const rest = G.st().schuss;
  G.tick(300);
  ok(G.st().schuss === rest, 'der Countdown steht ab diesem Augenblick');
  ok(rest === SHOT - 72, 'verbraucht wurden genau die 1,2 s des Fensters');
}

// ══ F+G. ABLAUF: GENAU DER ANLIEGENDE VEKTOR, SONST NULLZUG ══════════════════
{
  const G = leben(5);
  G.loslassen(0, 9, 9);                         // P1 hat frueh bestaetigt
  G.zielen(3, {});                              // P4 haelt einen gueltigen Zug
  G.tick(SHOT);
  ok(G.st().bereit === '11111', 'der Ablauf bestaetigt ALLE noch offenen Spieler');
  const a = G.st().absichten;
  const p4 = a.find(x => x.who === 3);
  ok(p4.fx === 7.25 && p4.fy === -3.5 && p4.spin === 0.25,
     'wer einen Zug anliegen hatte, bekommt GENAU diesen');
  ok([1, 2, 4].every(o => { const x = a.find(y => y.who === o); return x.fx === 0 && x.fy === 0; }),
     'wer keinen hatte, bekommt einen Nullzug - kein erfundener Schuss');
  ok(a.find(x => x.who === 0).fx === 9, 'und der frueh Bestaetigte behaelt seinen Vektor');
  ok(G.st().autoSchuss === 1 && G.st().autoAus === 3,
     'gezaehlt: ein automatischer Schuss, drei Aussetzer');
  ok(G.log.indexOf('reveal') >= 0, 'danach schliesst das Fenster');
}

// ══ H. ALLE GESCHWINDIGKEITEN VOR DEM ERSTEN PHYSIKSCHRITT ═══════════════════
{
  const G = leben(5);
  for (const o of [0, 1, 2, 3, 4]) G.loslassen(o, o + 1, -(o + 1));
  ok(G.log.filter(z => z === 'phase:sim').length === 0,
     'zwischen den Bestaetigungen hat KEIN Simulationsschritt stattgefunden');
  const r = G.launch();
  ok(r.phaseVorher === 'reveal', 'der Abschuss beginnt aus der Reveal-Phase');
  ok(r.bewegt.join(',') === '0,1,2,3,4', 'nach applyLaunch tragen ALLE fuenf eine Geschwindigkeit');
  ok(r.phase === 'sim', 'und erst danach beginnt die Simulation');
}

// ══ I. KEIN VORTEIL DURCH DIE REIHENFOLGE DER EINGABE ════════════════════════
{
  const A = leben(5);
  for (const o of [0, 1, 2, 3, 4]) A.loslassen(o, o + 1, -(o + 1));
  const ra = A.launch();
  const B2 = leben(5);
  for (const o of [4, 2, 0, 3, 1]) B2.loslassen(o, o + 1, -(o + 1));
  const rb = B2.launch();
  ok(JSON.stringify(ra.v) === JSON.stringify(rb.v),
     'dieselben Absichten ergeben exakt dieselben Geschwindigkeiten - egal in welcher '
     + 'Reihenfolge sie eingegeben wurden');
}

// ══ J. KEINE SEQUENTIELLE NAECHSTER-SPIELER-AUTORITAET MEHR ══════════════════
{
  // Wer zielen darf, beantwortet ausschliesslich die offene Menge - nicht curAimer.
  const src = grab(/function fbDecisionWho\(\)\{[\s\S]*?\n\}/, 'fbDecisionWho');
  ok(/if\(typeof fbShared==='function'&&fbShared\(\)\)\{[\s\S]*?const offen=fbOffen\(\);/.test(src),
     'fbDecisionWho fragt im gemeinsamen Fenster die offene Menge');
  ok(/return offen\.length\?offen\[0\]:-1;/.test(src),
     'und leitet daraus ab - curAimer ist dort keine Autoritaet mehr');
  const aim = grab(/function whoCanAim\(\)\{[\s\S]*?\n/, 'whoCanAim');
  ok(/const offen=fbOffen\(\);/.test(HTML.slice(HTML.indexOf('function whoCanAim'),
                                                 HTML.indexOf('function pickOwnBall'))),
     'und whoCanAim ebenso');
  // Der Uebergabeschirm bleibt ausschliesslich ausserhalb des gemeinsamen Fensters.
  ok((HTML.match(/if\(!\(typeof fbShared==='function'&&fbShared\(\)\)\)openCover\(curAimer\);/g) || []).length === 2,
     'beide Rundenstarts oeffnen ihn nur ausserhalb eines gemeinsamen Fensters');
  ok(/if\(nx>=0\)\{curAimer=nx;if\(!gemeinsam\)openCover\(nx\);/.test(HTML),
     'und applyCommit ebenso');
  // Ohne Tor: nach dem Settlement steht ein FRISCHES gemeinsames Fenster, kein naechster
  // Spieler.
  const G = leben(4);
  for (const o of [0, 1, 2, 3]) G.loslassen(o, 1, 1);
  G.launch();
  G.fensterAuf();
  ok(G.st().offen.join(',') === '0,1,2,3', 'nach dem Settlement sind wieder ALLE offen');
  ok(G.st().bereit === '0000', 'und niemand ist bestaetigt');
}

// ══ K+L. DIE LEBENSBUCHUNG IST UNVERAENDERT ══════════════════════════════════
{
  const G = leben(4);
  ok(G.st().lives.slice(0, 4).join(',') === '2,2,2,2', 'jeder startet mit zwei Leben');
  G.concede(1);
  ok(G.st().lives[1] === 1, 'das erste Gegentor macht 2 -> 1');
  ok(G.st().aktiv.length === 4, 'und scheidet niemanden aus');
  ok(G.st().conceded[1] === 0, 'die Gegentorzaehler der Zeitregel bleiben unberuehrt');
  G.concede(1);
  ok(G.st().lives[1] === 0, 'das zweite macht 1 -> 0');
  ok(G.st().aktiv.indexOf(1) < 0, 'und scheidet den Spieler aus');
  ok(/const FB_ELIM_LIVES=2;/.test(HTML), 'die Lebenszahl ist unveraendert zwei');
  // EIN Buchungspunkt, kein zweiter Detektor.
  ok((HTML.match(/footballElimConcede\(/g) || []).length === 2,
     'footballElimConcede hat eine Definition und genau einen Aufrufer');
  const cs = grab(/function footballElimConcede\(o\)\{[\s\S]*?\n\}/, 'footballElimConcede');
  ok(/if\(fbElimLives\[o\]>0\)fbElimLives\[o\]--;/.test(cs)
     && /if\(fbElimLives\[o\]<=0\)footballElimEliminate\(o\);/.test(cs),
     'die Lebensbuchung steht unveraendert an derselben Stelle');
}

// ══ M+N. TOR UND ELIMINIERUNG OEFFNEN EIN FRISCHES FENSTER ═══════════════════
{
  // Tor mit verbleibendem Leben: neues gemeinsames Fenster, alle offen.
  const G = leben(4);
  for (const o of [0, 1, 2, 3]) G.loslassen(o, 1, 1);
  G.concede(2);
  ok(G.st().lives[2] === 1 && G.st().aktiv.length === 4, 'P3 verliert ein Leben, bleibt drin');
  G.fensterAuf();
  ok(G.st().offen.join(',') === '0,1,2,3' && G.st().bereit === '0000',
     'danach steht ein frisches Fenster fuer ALLE vier');
  // Zweites Gegentor: Eliminierung, dann frisches Fenster fuer die Verbliebenen.
  G.concede(2);
  ok(G.st().aktiv.join(',') === '0,1,3', 'P3 ist ausgeschieden');
  G.fensterAuf();
  ok(G.st().offen.join(',') === '0,1,3', 'das naechste Fenster kennt nur noch die drei Aktiven');
  ok(G.st().bereit.slice(0, 4) === '0000', 'und keine Absicht ueberlebt die Eliminierung');
}

// ══ O+P+Q+R+S. DIE PROGRESSION UND DAS FINALE ════════════════════════════════
for (const start of [5, 4, 3]) {
  const G = leben(start);
  const folge = [];
  let schutz = 0;
  while (G.st().aktiv.length > 1 && schutz++ < 12) {
    const o = G.st().aktiv[0];
    G.concede(o); G.concede(o);                 // zwei Gegentore = raus
    folge.push(G.st().aktiv.length);
    G.fensterAuf();
  }
  ok(folge.join('→') === Array.from({ length: start - 1 }, (_, i) => start - 1 - i).join('→'),
     start + ' Spieler laufen ueber ' + folge.join('→') + ' bis zum Sieger');
  ok(G.st().winner !== null && G.st().aktiv[0] === G.st().winner,
     start + ' Spieler: der letzte Verbliebene gewinnt');
}
{
  // Das Zweierfinale bleibt simultan.
  const G = leben(2);
  ok(G.st().offen.join(',') === '0,1', 'im Finale sind beide im selben Fenster offen');
  G.zielen(0, {});
  G.tick(60);
  G.loslassen(0, 3, 3);
  ok(G.log.indexOf('reveal') < 0, 'einer allein schiesst auch im Finale nicht ab');
  ok(G.st().schuss === SHOT - 60, 'und der Countdown ist derselbe geteilte');
  G.loslassen(1, 4, 4);
  ok(G.log.indexOf('reveal') >= 0, 'erst beide zusammen');
  const r = G.launch();
  ok(r.bewegt.join(',') === '0,1', 'und beide starten gleichzeitig');
}

// ══ T+U. KEINE PHASENUHR, KEIN GLEICHSTAND ═══════════════════════════════════
{
  const G = leben(5);
  G.zielen(0, {});
  G.tick(600);
  ok(G.st().ticks === 60 * 60, 'in der Lebensregel steht die Phasenuhr auf dem vollen Wert');
  ok(G.st().due === false, 'es gibt kein faelliges Phasenende');
  ok(G.st().danger === false, 'und keinen Gleichstand-Ausgang');
  ok(!/fbLives/.test(grab(/function fbFfaRunning\(\)\{[\s\S]*?\n\}/, 'fbFfaRunning')),
     'die Phasenuhr fragt ausdruecklich NICHT nach der Lebensregel');
  ok(!/fbLives/.test(grab(/function fbFfaResolve\(imTor\)\{[\s\S]*?\n\}/, 'fbFfaResolve')),
     'und die Phasenauswertung ebenso wenig');
  ok(/if\(typeof fbTimed==='function'&&fbTimed\(\)\)\{/.test(
       grab(/function fbClockStep\(\)\{[\s\S]*?\n\}/, 'fbClockStep')),
     'der Tick ruft die Phasenuhr nur unter fbTimed auf');
  // Auch die ANZEIGE muss die beiden Begriffe trennen. fbFfaPaint() zeichnet zwei Dinge:
  // den grossen Schuss-Countdown (haben alle simultanen Modi) und den Kopf mit Phasenuhr
  // und DANGER (hat nur die Zeitregel). Haengen beide an derselben Variablen, koennte ein
  // stehengebliebenes fbFfaDanger aus einem frueheren Zeitregel-Match im Kopf der
  // Lebensregel auftauchen.
  const paint = grab(/function fbFfaPaint\(\)\{[\s\S]*?\n\}/, 'fbFfaPaint');
  ok(/const gemeinsam=typeof fbShared==='function'&&fbShared\(\);/.test(paint)
     && /const zeit=typeof fbTimed==='function'&&fbTimed\(\);/.test(paint),
     'fbFfaPaint fuehrt Fenster und Zeitregel als ZWEI getrennte Groessen');
  ok(/const rest=gemeinsam\?fbShotShown\(\):-1;/.test(paint),
     'der grosse Countdown haengt am gemeinsamen Fenster - die Lebensregel bekommt ihn');
  ok(/const dgr=zeit&&\(fbFfaDanger\|\|fbFfaNotice==='danger'\);/.test(paint),
     'DANGER haengt allein an der Zeitregel');
  ok(/const uhr=zeit&&!dgr&&/.test(paint),
     'und die Phasenuhr im Kopf ebenso - die Lebensregel kann beide nie zeigen');
}

// ══ V+W+X. KEINE ALTEN ABSICHTEN ═════════════════════════════════════════════
{
  const G = leben(4);
  G.loslassen(0, 7, 7);
  ok(G.st().absichten.find(x => x.who === 0).fx === 7, 'die Absicht steht im laufenden Fenster');
  G.fensterAuf();
  ok(G.st().bereit === '0000' && G.st().absichten.length === 0,
     'nach dem Settlement ueberlebt keine Absicht');
  G.loslassen(1, 5, 5);
  G.concede(0);                                  // Tor mit verbleibendem Leben
  G.fensterAuf();
  ok(G.st().absichten.length === 0, 'nach einem Tor ebenso wenig');
  G.loslassen(2, 5, 5);
  G.concede(0);                                  // zweites Gegentor -> Eliminierung
  G.fensterAuf();
  ok(G.st().aktiv.indexOf(0) < 0 && G.st().absichten.length === 0,
     'und nach einer Eliminierung ebenso wenig');
  ok(/function resetCommits\(\)\{aimSet=\[\];commitIdx=\[\];commitAim=\[\];commitSpin=\[\];/.test(HTML),
     'im Produkt raeumt resetCommits Bestaetigung, Ziel, Vektor und Drall gemeinsam');
}

// ══ Y+Z+AA+AB. DIE ANDEREN MODI BLEIBEN UNBERUEHRT ═══════════════════════════
{
  // Timed FFA: eigener Riegel, eigene Phasenuhr, eigener Gleichstand.
  ok(/const FOOTBALL_FFA_PHASE_SECONDS=60;/.test(HTML), 'Timed FFA behaelt seine 60 s');
  ok(/const FOOTBALL_FFA_SHOT_SECONDS=6;/.test(HTML), 'und seinen eigenen Riegel');
  ok(/FOOTBALL_TEAM2V2_SHOT_TICKS:\(\(typeof fbLives==='function'&&fbLives\(\)\)\?FOOTBALL_LIVES_SHOT_TICKS:FOOTBALL_FFA_SHOT_TICKS\)/.test(HTML),
     'jede der drei Regeln benutzt ihre eigene Riegelkonstante');
  const T = build(5);                            // Zeitregel (Vorgabe des Sandkastens)
  T.fensterAuf();
  T.zielen(0, {});
  T.tick(60);
  ok(T.st().ticks === 60 * 60 - 60, 'die Phasenuhr der Zeitregel laeuft unveraendert');
  // True Team 2v2 und Classic.
  ok(/const FOOTBALL_TEAM2V2_SHOT_SECONDS=6;/.test(HTML), 'Team 2v2 behaelt seinen Riegel');
  ok(/const FOOTBALL_TEAM2V2_PLAYERS=4;/.test(HTML), 'und seine vier Identitaeten');
  for (const c of [/const FOOTBALL_WIN_SCORE=3;/, /const FOOTBALL_BANK_SECONDS=45;/,
                   /const FOOTBALL_SHOT_SECONDS=6;/, /const FOOTBALL_TROUBLE_SECONDS=2;/])
    ok(c.test(HTML), 'Classic-Konstante unveraendert: ' + c.source);
  ok(/function fbTactical\(\)\{return mode==='football'&&fbVariant===FOOTBALL_VARIANT_TACTICAL;\}/.test(HTML),
     'die Tactical-Weiche ist unveraendert');
  ok(/const fbSel=\[-1,-1\];/.test(HTML), 'und seine Figurenwahl ebenso');
  // Speed Match laeuft im selben Sandkasten weiter.
  const S = build(5);
  S.env({ variante: 'classic', classic: 'speed', regel: 'lives' });
  S.zielen(0, {});
  S.tick(60);
  ok(S.st().bank[0] === 45 * 60 - 60 && S.st().bank[1] === 45 * 60,
     'Speed Match senkt weiterhin nur das Konto des Zielenden');
}

// ══ AC+AD. ONLINE UND ARENA B UNBERUEHRT ═════════════════════════════════════
{
  ok(/const ONLINE_PROTOCOL_VERSION=7;/.test(HTML), 'Protokollversion unveraendert');
  ok(/const FOOTBALL_FMTS=\['elimination'\];/.test(HTML), 'FOOTBALL_FMTS unveraendert');
  // Online bleibt sequentiell: fbLives verlangt ausdruecklich offline.
  const G = leben(4);
  G.env({ online: true });
  ok(G.st().wer === -1, 'online gibt es kein gemeinsames Fenster');
  ok(G.st().offen.length === 0, 'und keine offene Menge');
  G.concede(0); G.concede(0);
  ok(G.st().aktiv.indexOf(0) < 0, 'die Lebensregel selbst gilt online unveraendert weiter');
  // Arena B unberuehrt.
  ok(/const FB_TWO_GOAL_SHAPE=\{rc:2\.60,shoulderDeg:35,endHalf:7\.00\};/.test(HTML),
     'die kanonische Zwei-Tor-Wandform ist unveraendert');
  ok(/const FB_RADIAL_SHAPE=\{rc:2\.60,vf:\{3:1\.5916,4:1\.2663,5:1\.1559\}\};/.test(HTML),
     'die radiale ebenso');
  ok(/const FB_GOAL_ASSET_INNER=3\.560, FB_GOAL_ASSET_OUTER=5\.282;/.test(HTML),
     'und die Tormasse ebenso');
  for (const c of [/slowv:0\.70,stopv:0\.075,restBall:0\.44,restBand:0\.60,restPost:0\.50\}/,
                   /const FOOTBALL_CONTACT_ITERATIONS=3;/])
    ok(c.test(HTML), 'Physikkonstante unveraendert: ' + c.source);
}

console.log('');
console.log('Football-Lives-Simultan: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
