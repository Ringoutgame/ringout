// Arena Football TIMED FFA (Elimination 2.0) — fokussierte Regelsuite.
//
// Die Zeitregel ist die zweite Eliminationsregel neben den Leben. Sie steht daneben, sie
// ersetzt sie nicht: dieselbe Arena, dieselbe verdeckte Commit-Pipeline, derselbe
// Torablauf, derselbe Umbau. Was neu ist, sind genau vier Dinge - eine Phasenuhr, die
// ausschliesslich BEDENKZEIT zaehlt, ein Sechs-Sekunden-Riegel je Zug, eine
// Gegentorzaehlung je Phase, und ein Gleichstand, der nicht ausgelost wird.
//
// DIE UHR ZAEHLT BEDENKZEIT, NICHT BALLZEIT. Sie sinkt genau dann, wenn ein Mensch den
// Schuss noch aendern kann, und steht still, waehrend er nur zusieht - dieselbe Semantik,
// die Classic Speed Match schon hat. Sie kommt auch aus derselben Quelle: das Gatter ist
// fbDecisionWho(), und der Tick haengt in fbClockStep(). Diese Suite laedt deshalb die
// ECHTE Classic-Uhr mit und prueft beide Regeln an demselben Werk.
//
// Geprueft werden ausschliesslich diese drei Dinge und ihre Raender. Physik, Arena,
// Torgeometrie und Online sind Sache der bestehenden Suiten; hier wird nur belegt, dass
// sie unberuehrt bleiben.
//
// Wie alle Football-Harnesse extrahiert die Suite die ECHTEN Quellen aus index.html und
// beobachtet sie von aussen. Kein DOM, kein Renderer, kein Netzwerk, kein Zufall.
//
// Usage: node tools/test_football_timed_ffa.js

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
  grab(/function fbFfaOffen\(\)\{[\s\S]*?\n\}/, 'fbFfaOffen'),
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
               offen:fbFfaOffen(),bereit:aimSet.map(v=>v?1:0).join(''),
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
const SHOT = 6 * 60;     // 6 s Riegel je Zug - ebenfalls der Produktwert
// Die Phase ueber den ECHTEN Weg leerlaufen lassen: ein offenes Entscheidungsfenster,
// in dem die Uhr sinkt. Ohne anliegenden Zug endet das in einem Nullzug - genau wie im
// Produkt, wenn jemand seine sechs Sekunden verstreichen laesst.
function phaseAus(G, o) {
  G.fensterAuf();
  G.env({ ticks: 1 });
  G.zielen(o === undefined ? G.st().aktiv[0] : o, false);
  G.tick(1);
}

// ══ A. DIE UHR ZAEHLT BEDENKZEIT ═════════════════════════════════════════════
// Die Korrektur aus dem Spieltest: die Phasenuhr sinkt genau dann, wenn ein Mensch den
// Schuss noch aendern kann.
{
  const G = build(5);
  ok(G.st().ticks === TICKS, 'eine Phase beginnt mit ' + TICKS + ' Ticks (60 s bei 60 Hz)');
  G.zielen(0, {});
  ok(G.st().wer === 0, 'beim Zielen ist das Entscheidungsfenster offen');
  ok(G.running() === true, 'und die Phasenuhr meldet sich selbst als laufend');
  G.tick(60);
  ok(G.st().ticks === TICKS - 60,
     'sie sinkt um genau einen Tick je Schritt - eine Sekunde in 60 Schritten');
  // Das Gatter ist DIESELBE Funktion, die auch Classic benutzt. Zwei Fassungen davon
  // wuerden frueher oder spaeter auseinanderlaufen.
  ok(/typeof fbDecisionWho==='function'&&fbDecisionWho\(\)>=0;/.test(
       grab(/function fbFfaRunning\(\)\{[\s\S]*?\n\}/, 'fbFfaRunning')),
     'die Uhr fragt fbDecisionWho - sie hat keine zweite Fassung der Frage');
  // Und der Tick haengt dort, wo Speed Match sein Konto senkt: eine Stelle, zwei Regeln.
  const clockSrc = grab(/function fbClockStep\(\)\{[\s\S]*?\n\}/, 'fbClockStep');
  ok(/if\(fbFfaClockTick\(who\)\)return;/.test(clockSrc),
     'die Phasenuhr sinkt in fbClockStep - an derselben Stelle wie das persoenliche Konto');
  ok(!/fbFfaTicks--/.test(grab(/function fbFfaStep\(\)\{[\s\S]*?\n\}/, 'fbFfaStep')),
     'fbFfaStep zaehlt nur noch die Kurzmeldung, nicht mehr die Uhr');
}

// ══ B. SIMULATIONSZEIT IST FREI ═══════════════════════════════════════════════
{
  const G = build(5);
  G.zielen(0, {});
  G.tick(30);
  const nachDenken = G.st().ticks;
  ok(nachDenken === TICKS - 30, 'Vorlauf: eine halbe Sekunde Bedenkzeit ist verbraucht');
  // Der Schuss ist raus. Ab hier laeuft ausschliesslich Physik.
  G.loslassen(0);
  G.env({ phase: 'sim' });
  G.tick(600);
  ok(G.st().ticks === nachDenken, 'zehn Sekunden Simulation kosten NULL Phasenzeit');
  ok(G.running() === false, 'die Uhr meldet sich waehrend der Simulation als aus');
  ok(G.st().schuss === SHOT - 30, 'auch der Sechs-Sekunden-Riegel steht still');
}

// ══ C. TORABLAUF, RESET, UMBAU UND MENUE KOSTEN NICHTS ════════════════════════
{
  for (const [name, env] of [['im Reveal', { phase: 'reveal' }],
                             ['im Ergebnisfenster', { phase: 'result' }],
                             ['im Menue', { menu: true }],
                             ['im Torablauf', { goal: 'fall' }],
                             ['im Jubel', { goal: 'celebrate' }],
                             ['im Umbau', { goal: 'morph' }],
                             ['beim Spawn', { goal: 'spawn' }],
                             ['hinter dem Uebergabeschirm', { cover: true }],
                             ['im Orbit-Testmodus', { orbit: true }]]) {
    const H = build(5);
    H.zielen(0, {});
    H.env(env);
    const vor = H.st().ticks;
    H.tick(120);
    ok(H.st().ticks === vor, 'die Uhr steht ' + name);
    ok(!H.running(), 'und meldet sich selbst als angehalten ' + name);
    ok(H.st().bereit === '00000', 'und loest dort keinen automatischen Zug aus ' + name);
  }
}

// ══ D. JEDER ZUG BEGINNT MIT SECHS SEKUNDEN ═════════════════════════════════
{
  ok(/const FOOTBALL_FFA_SHOT_SECONDS=6;/.test(HTML), 'der Riegel steht als eigene Konstante');
  ok(/const FOOTBALL_FFA_SHOT_TICKS=FOOTBALL_FFA_SHOT_SECONDS\*FOOTBALL_SIM_HZ;/.test(HTML),
     'und rechnet in Ticks, nicht in Wanduhr');
  const G = build(5);
  G.zielen(0, {});
  ok(G.st().zeigt === SHOT, 'ein Zug beginnt mit ' + SHOT + ' Ticks = 6,0 Sekunden');
  G.tick(90);
  ok(G.st().schuss === SHOT - 90, 'der Riegel sinkt im selben Takt');
  ok(G.st().ticks === TICKS - 90, 'und die Phasenuhr genau gleich schnell - beide zusammen');
  // ENTSCHEIDEND: bestaetigt einer, bekommt der naechste KEINEN frischen Countdown.
  // Es gibt nur ein Fenster, und es laeuft weiter, wo es stand.
  G.loslassen(0, 7.25, -3.5);
  ok(G.st().schuss === SHOT - 90, 'nach einer Bestaetigung laeuft derselbe Countdown weiter');
  G.zielen(1, {});
  G.tick(1);
  ok(G.st().schuss === SHOT - 91, 'kein Neustart fuer den naechsten Spieler');
  ok(G.st().schussFuer === -2, 'der Countdown gehoert dem gemeinsamen Fenster, keinem Spieler');
  ok(G.st().ticks === TICKS - 91, 'die Phasenuhr laeuft dabei weiter - sie gehoert allen');
  ok(/const FOOTBALL_FFA_WINDOW=-2;/.test(HTML),
     'der gemeinsame Eigentuemer steht als benannte Konstante im Produkt');
}

// ══ E. EIN EINZELNER SCHUSS SCHLIESST DAS FENSTER NICHT ════════════════════
// Das ist der Kern der Korrektur: wer fertig ist, wartet.
{
  const G = build(5);
  G.zielen(0, {});
  G.tick(60);
  G.loslassen(0, 7.25, -3.5);
  ok(G.st().bereit === '10000', 'P1 ist bestaetigt');
  ok(G.st().offen.join(',') === '1,2,3,4', 'die anderen vier sind noch offen');
  ok(G.log.indexOf('reveal') < 0, 'es wird NICHT abgeschossen - niemand faehrt allein los');
  ok(G.st().wer === 1, 'das Fenster bleibt offen, jetzt fuer den naechsten Offenen');
  G.tick(60);
  ok(G.st().schuss === SHOT - 120, 'und derselbe Countdown laeuft weiter');
  ok(G.st().ticks === TICKS - 120, 'die Phasenuhr ebenso');
  // Und es gibt keinen Uebergabeschirm mehr - das Geraet wird nicht weitergereicht.
  ok(G.log.indexOf('cover:1') < 0, 'kein Uebergabeschirm in der Zeitregel');
  // Erst der LETZTE schliesst das Fenster.
  G.loslassen(1, 1, 0); G.loslassen(2, 2, 0); G.loslassen(3, 3, 0);
  ok(G.log.indexOf('reveal') < 0, 'auch mit vier Bestaetigten wird nicht abgeschossen');
  G.loslassen(4, 4, 0);
  ok(G.log.indexOf('reveal') >= 0, 'erst mit dem Letzten faellt der gemeinsame Reveal');
  ok(G.st().offen.length === 0, 'und die offene Menge ist leer');
}

// ══ E2. SIND ALLE BEREIT, SCHLIESST DAS FENSTER SOFORT ═════════════════════
// Frueher Abschuss: es wird nicht bis 6,0 gewartet, wenn niemand mehr offen ist.
{
  const G = build(4);
  G.zielen(0, {});
  G.tick(90);                       // 1,5 s vergangen
  G.loslassen(0, 5, 1); G.loslassen(1, 4, 2); G.loslassen(2, 3, 3);
  ok(G.st().wer >= 0, 'solange einer offen ist, laeuft das Fenster');
  G.loslassen(3, 2, 4);
  ok(G.st().wer === -1, 'mit dem letzten Commit ist das Fenster zu');
  const nachher = G.st().ticks;
  G.tick(600);
  ok(G.st().ticks === nachher, 'und die Phasenuhr steht ab diesem Augenblick');
  ok(nachher === TICKS - 90, 'verbraucht wurden genau die 1,5 s des Fensters');
}

// ══ E3. FUENF SPIELER KOSTEN NICHT DAS FUENFFACHE ════════════════════════
// Die eigentliche Beschwerde: sequentiell haette ein Zyklus bis 5 x 6 s Phasenzeit
// gekostet. Ein gemeinsames Fenster kostet hoechstens 6 s - egal wie viele mitspielen.
{
  const messe = (n) => {
    const G = build(n);
    G.zielen(G.st().aktiv[0], false);
    G.tick(SHOT);                   // Fenster voll ausschoepfen
    return TICKS - G.st().ticks;
  };
  const drei = messe(3), vier = messe(4), fuenf = messe(5);
  ok(drei === SHOT && vier === SHOT && fuenf === SHOT,
     'ein voll ausgeschoepftes Fenster kostet immer genau ' + SHOT + ' Ticks ('
     + drei + '/' + vier + '/' + fuenf + ')');
  ok(fuenf < 2 * SHOT, 'insbesondere NICHT ein Vielfaches der Spielerzahl');
}

// ══ F. ABLAUF MIT ANLIEGENDEM ZUG: GENAU DIESER VEKTOR ═══════════════════════
{
  const G = build(5);
  // Zwei haben schon bestaetigt, einer haelt einen Zug an, zwei haben nichts.
  G.zielen(0, {}); G.loslassen(0, 9, 9);
  G.zielen(1, {}); G.loslassen(1, 8, 8);
  G.zielen(2, {});                  // P3 haelt einen gueltigen Zug
  G.tick(SHOT);
  ok(G.st().bereit === '11111', 'der Ablauf bestaetigt ALLE noch offenen Spieler');
  ok(G.log.indexOf('reveal') >= 0, 'und schliesst das gemeinsame Fenster');
  const a = G.st().absichten;
  const p3 = a.find(x => x.who === 2);
  ok(p3.fx === 7.25 && p3.fy === -3.5 && p3.spin === 0.25,
     'wer einen Zug anliegen hatte, bekommt GENAU diesen - nicht erfunden, nicht gerundet');
  const p4 = a.find(x => x.who === 3), p5 = a.find(x => x.who === 4);
  ok(p4.fx === 0 && p4.fy === 0 && p5.fx === 0 && p5.fy === 0,
     'wer keinen hatte, bekommt einen Nullzug');
  ok(a.find(x => x.who === 0).fx === 9 && a.find(x => x.who === 1).fx === 8,
     'und die frueher Bestaetigten behalten ihren eigenen Vektor unveraendert');
  ok(G.st().autoSchuss === 1 && G.st().autoAus === 2,
     'gezaehlt: ein automatischer Schuss, zwei Aussetzer');
  // Es ist derselbe Weg wie in Classic: eine Funktion, eine Vektorquelle.
  const expSrc = grab(/function fbCommitFor\(who\)\{[\s\S]*?\n\}/, 'fbCommitFor');
  ok(/aimVectorFromDrag\(\)/.test(expSrc),
     'die Automatik liest denselben Vektor, den ein Loslassen erzeugt haette');
  ok((HTML.match(/function fbCommitFor\(/g) || []).length === 1,
     'und es gibt genau eine solche Funktion fuer beide Regeln');
  ok(/function fbFfaExpire\(\)\{[\s\S]*?for\(const o of fbFfaOffen\(\)\)fbCommitFor\(o\);/.test(HTML),
     'der gemeinsame Ablauf benutzt sie fuer JEDEN offenen Spieler');
  ok(/function fbDecisionExpire\(who\)\{[\s\S]*?fbCommitFor\(who\);/.test(HTML),
     'und der Einzelablauf von Speed Match dieselbe');
}

// ══ G. ABLAUF OHNE ANLIEGENDEN ZUG: AUSSETZEN ═══════════════════════════════
{
  const G = build(5);
  G.zielen(0, false);
  G.tick(SHOT);
  ok(G.st().bereit === '11111', 'ohne einen einzigen Zug wird trotzdem jeder bestaetigt');
  ok(G.st().absichten.every(x => x.fx === 0 && x.fy === 0 && x.spin === 0),
     'und zwar durchweg als Nullzug - kein erfundener Schuss, keine Zufallsrichtung');
  ok(G.st().autoAus === 5 && G.st().autoSchuss === 0, 'fuenf Aussetzer, kein Schuss');
  // Ein zu schwacher Zug zaehlt wie keiner - dieselbe Schwelle wie beim Loslassen.
  const H = build(5);
  H.zielen(0, { schwach: true });
  H.tick(SHOT);
  ok(H.st().autoAus === 5 && H.st().autoSchuss === 0, 'ein zu schwacher Zug zaehlt wie keiner');
}

// ══ H. PHASENUHR AUF NULL MIT ANLIEGENDEM ZUG ══════════════════════════════
{
  const G = build(5);
  G.env({ ticks: 30 });
  G.zielen(0, {});
  G.tick(30);
  ok(G.st().ticks === 0 && G.st().due === true, 'die Phase ist abgelaufen und vorgemerkt');
  ok(G.st().bereit === '11111', 'das gemeinsame Fenster ist fuer ALLE geschlossen');
  ok(G.st().absichten.find(x => x.who === 0).fx === 7.25,
     'der anliegende Zug wurde genau so abgegeben - es gibt keine Nachspielzeit');
  ok(G.log.indexOf('reveal') >= 0, 'und der gemeinsame Abschuss steht an');
  ok(G.st().aktiv.length === 5, 'ausgewertet ist noch nichts: erst laeuft die Aktion');
  // Die Aktion laeuft vollstaendig aus. Laufende Physik wird nie unterbrochen.
  G.env({ phase: 'sim' });
  G.tick(600);
  ok(G.st().aktiv.length === 5, 'auch nach zehn Sekunden Physik ist niemand ausgeschieden');
  G.concede(2);
  G.resolve(false);
  ok(G.st().aktiv.indexOf(2) < 0, 'erst das Settlement wertet die Phase aus');
}

// ══ I. PHASENUHR AUF NULL OHNE ANLIEGENDEN ZUG ═════════════════════════════
{
  const G = build(5);
  G.env({ ticks: 1 });
  G.zielen(0, false);
  G.tick(1);
  ok(G.st().bereit === '11111' && G.st().absichten.every(x => x.fx === 0),
     'ohne Zug setzen alle aus');
  ok(G.st().due === true && G.st().ticks === 0, 'und die Phase ist vorgemerkt');
  G.concede(3);
  G.resolve(false);
  ok(G.st().aktiv.indexOf(3) < 0, 'die Auswertung folgt danach, nicht davor');
}

// ══ J. GLEICHSTAND: RIEGEL JA, PHASENUHR NEIN ══════════════════════════════
{
  const G = build(4);
  G.concede(1); G.concede(2);
  G.env({ ticks: 1 });
  G.zielen(0, false);
  G.tick(1);
  G.resolve(false);
  ok(G.st().danger === true, 'Ausgangslage: der Gleichstand laeuft');
  G.fensterAuf();
  G.zielen(3, {});
  ok(G.st().wer >= 0, 'im Gleichstand beginnt ein neues gemeinsames Fenster');
  ok(G.st().offen.length === 4, 'in dem alle vier aktiven Spieler offen sind');
  const vor = G.st().ticks;
  G.tick(120);
  ok(G.st().ticks === vor, 'die Phasenuhr laeuft im Gleichstand nicht mehr');
  ok(G.running() === false, 'sie meldet sich selbst als aus - die Regulaerphase ist vorbei');
  ok(G.st().schuss === SHOT - 120, 'der Sechs-Sekunden-Riegel laeuft trotzdem');
  G.tick(SHOT - 120);
  ok(G.st().offen.length === 0,
     'und laeuft er ab, sind ALLE bestaetigt - im Gleichstand kann niemand endlos stocken');
  ok(G.log.indexOf('reveal') >= 0, 'der Gleichstand schiesst ebenfalls gemeinsam ab');
}

// ══ K. VERDECKTER TAB VERBRAUCHT NICHTS ═══════════════════════════════════
{
  const G = build(5);
  G.zielen(0, {});
  G.tick(60);
  const offen = G.st().ticks, riegel = G.st().schuss;
  G.env({ hidden: true });
  G.tick(1200);
  ok(G.st().ticks === offen, 'ein verdeckter Tab verbraucht keine Phasenzeit');
  ok(G.st().schuss === riegel, 'und keinen Riegel');
  ok(G.st().bereit.indexOf('1') < 0, 'und kann erst recht keinen automatischen Zug ausloesen');
}

// ══ S0. DER ANLIEGENDE ZUG UEBERLEBT DIE SCHLEIFE ════════════════════════
// Befund aus dem unabhaengigen Review: der gemeinsame Ablauf laeuft ueber ALLE offenen
// Spieler. Wird dabei der laufende Zug eines SPAETEREN Spielers vorzeitig abgeraeumt,
// bekommt er einen Nullzug statt seines Vektors - und weiss nicht, warum.
{
  const G = build(5);
  G.fensterAuf();
  G.zielen(2, {});                  // P3 zieht - P1 und P2 sind aber VOR ihm offen
  ok(G.st().offen.join(',') === '0,1,2,3,4', 'alle fuenf sind offen, P3 haelt einen Zug');
  G.tick(SHOT);
  const p3 = G.st().absichten.find(x => x.who === 2);
  ok(p3.fx === 7.25 && p3.fy === -3.5 && p3.spin === 0.25,
     'P3 bekommt GENAU seinen Vektor, obwohl zwei Spieler vor ihm bestaetigt wurden');
  ok(G.st().autoSchuss === 1 && G.st().autoAus === 4,
     'genau ein automatischer Schuss und vier Aussetzer');
  // Und derselbe Fall am Phasenende.
  const H = build(5);
  H.fensterAuf();
  H.env({ ticks: 30 });
  H.zielen(4, {});                  // diesmal der LETZTE Spieler
  H.tick(30);
  const p5 = H.st().absichten.find(x => x.who === 4);
  ok(p5.fx === 7.25 && p5.fy === -3.5,
     'auch am Phasenende ueberlebt der anliegende Zug die ganze Schleife');
}

// ══ S1. DER ABSCHUSS IST WIRKLICH GLEICHZEITIG ═══════════════════════════
// Die zentrale Forderung: keine Physik zwischen den Bestaetigungen, und beim ersten
// Simulationsschritt hat JEDE Figur ihre Geschwindigkeit schon.
{
  const G = build(5);
  G.fensterAuf();
  for (const o of [0, 1, 2, 3, 4]) G.loslassen(o, o + 1, -(o + 1));
  ok(G.log.indexOf('reveal') >= 0, 'mit dem letzten Commit faellt der gemeinsame Reveal');
  ok(G.log.filter(z => z === 'phase:sim').length === 0,
     'zwischen den Bestaetigungen hat KEIN Simulationsschritt stattgefunden');
  const r = G.launch();
  ok(r.phaseVorher === 'reveal', 'der Abschuss beginnt aus der Reveal-Phase');
  ok(r.bewegt.join(',') === '0,1,2,3,4',
     'nach applyLaunch tragen ALLE fuenf Figuren eine Geschwindigkeit');
  ok(r.phase === 'sim', 'und erst danach beginnt die Simulation');
  // Quelltext: der Wechsel in die Simulation ist die LETZTE Anweisung von applyLaunch.
  const launchSrc = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
  const zeilen = launchSrc.trim().split('\n');
  ok(/setPhase\('sim'\)/.test(zeilen[zeilen.length - 2]),
     'setPhase(sim) steht am Ende von applyLaunch - keine Zuweisung danach');
  ok(!/setPhase\('sim'\)/.test(launchSrc.slice(0, launchSrc.lastIndexOf("setPhase('sim')"))),
     'und nur ein einziges Mal');
}

// ══ S2. KEIN VORTEIL DURCH DIE REIHENFOLGE DER EINGABE ═════════════════════
{
  const A = build(5); A.fensterAuf();
  for (const o of [0, 1, 2, 3, 4]) A.loslassen(o, o + 1, -(o + 1));
  const ra = A.launch();
  const B2 = build(5); B2.fensterAuf();
  for (const o of [3, 0, 4, 2, 1]) B2.loslassen(o, o + 1, -(o + 1));
  const rb = B2.launch();
  ok(JSON.stringify(ra.v) === JSON.stringify(rb.v),
     'dieselben Absichten ergeben exakt dieselben Geschwindigkeiten - egal in welcher '
     + 'Reihenfolge sie eingegeben wurden');
  ok(ra.bewegt.join(',') === rb.bewegt.join(','), 'und dieselbe Menge bewegter Figuren');
  const launchSrc = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
  ok(/for\(let p=0;p<commitIdx\.length;p\+\+\)/.test(launchSrc),
     'applyLaunch laeuft in kanonischer Spielerreihenfolge, nicht in Eingabereihenfolge');
}

// ══ S3. KEINE ALTEN ABSICHTEN IM NAECHSTEN FENSTER ════════════════════════
{
  const G = build(5);
  G.fensterAuf();
  G.loslassen(0, 7, 7);
  ok(G.st().absichten.find(x => x.who === 0).fx === 7, 'die Absicht steht im laufenden Fenster');
  G.fensterAuf();
  ok(G.st().bereit === '00000', 'im neuen Fenster ist niemand mehr bestaetigt');
  ok(G.st().absichten.length === 0, 'und keine Absicht aus dem vorigen Fenster ueberlebt');
  const r = G.launch();
  ok(r.bewegt.length === 0, 'ein Abschuss ohne Absichten bewegt niemanden');
  ok(/function resetCommits\(\)\{aimSet=\[\];commitIdx=\[\];commitAim=\[\];commitSpin=\[\];/.test(HTML),
     'im Produkt raeumt resetCommits Bestaetigung, Ziel, Vektor und Drall gemeinsam');
}

// ══ S4. DAS ZWEIERFINALE BLEIBT GLEICHZEITIG ═════════════════════════════
{
  const G = build(2);
  G.fensterAuf();
  ok(G.st().offen.join(',') === '0,1', 'im Finale sind beide im selben Fenster offen');
  G.zielen(0, {});
  G.tick(60);
  G.loslassen(0, 3, 3);
  ok(G.log.indexOf('reveal') < 0, 'einer allein schiesst auch im Finale nicht ab');
  ok(G.st().schuss === SHOT - 60, 'und der Countdown ist derselbe geteilte');
  ok(G.st().schussFuer === -2, 'er gehoert dem Fenster, nicht einem der beiden');
  G.loslassen(1, 4, 4);
  ok(G.log.indexOf('reveal') >= 0, 'erst beide zusammen schliessen das Fenster');
  const r = G.launch();
  ok(r.bewegt.join(',') === '0,1', 'und beide starten gleichzeitig');
}

// ══ S5. KEIN UEBERGABESCHIRM IN DER ZEITREGEL ════════════════════════════
// Aber ueberall sonst bleibt er genau, wie er war.
{
  const G = build(5);
  G.fensterAuf();
  G.loslassen(0, 1, 1);
  ok(G.log.filter(z => z.indexOf('cover:') === 0).length === 0,
     'in der Zeitregel wird das Geraet nicht weitergereicht');
  const commitSrc = grab(/function applyCommit\(who,shooterIdx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'applyCommit');
  ok(/if\(zeit\)\{const offen=fbFfaOffen\(\);nx=offen\.length\?offen\[0\]:-1;\}/.test(commitSrc),
     'die Suche laeuft ueber ALLE offenen Spieler, nicht nur ueber die nachfolgenden');
  ok(/if\(nx>=0\)\{curAimer=nx;if\(!zeit\)openCover\(nx\);/.test(commitSrc),
     'und der Uebergabeschirm bleibt ausserhalb der Zeitregel unveraendert');
  ok((HTML.match(/if\(!\(typeof fbTimed==='function'&&fbTimed\(\)\)\)openCover\(curAimer\);/g) || []).length === 2,
     'auch die beiden Rundenstarts oeffnen ihn weiterhin - nur nicht in der Zeitregel');
}

// ══ S6. BESTAETIGUNG AUSSERHALB DER REIHENFOLGE ══════════════════════════
// Der Fehler, den die alte Reihenfolgesuche gehabt haette: wer als Letzter im Index,
// aber nicht als Letzter in der Zeit bestaetigt, haette den Reveal zu frueh ausgeloest.
{
  const G = build(5);
  G.fensterAuf();
  G.loslassen(4, 1, 1);                       // der HOECHSTE Index zuerst
  ok(G.log.indexOf('reveal') < 0, 'kein vorzeitiger Reveal, obwohl niemand mehr folgt');
  ok(G.st().offen.join(',') === '0,1,2,3', 'die vier vorderen sind weiterhin offen');
  ok(G.st().wer === 0, 'und das Fenster fuehrt jetzt den ersten Offenen');
  G.loslassen(2, 1, 1); G.loslassen(0, 1, 1); G.loslassen(3, 1, 1);
  ok(G.log.indexOf('reveal') < 0, 'auch nach vier Bestaetigungen nicht');
  G.loslassen(1, 1, 1);
  ok(G.log.indexOf('reveal') >= 0, 'erst der wirklich Letzte schliesst das Fenster');
}

// ══ S7. TACTICAL UND DIE FIGURENWAHL BLEIBEN UNBERUEHRT ══════════════════
{
  ok(/if\(typeof fbTactical==='function'&&fbTactical\(\)\)fbSelectFigure\(wer,idx\);/.test(HTML),
     'derselbe Griff waehlt in Tactical weiterhin die Figur');
  ok(/function fbTactical\(\)\{/.test(HTML), 'die Tactical-Weiche ist unveraendert vorhanden');
  // Die Erweiterung der Greifzone ist auf die Zeitregel begrenzt.
  ok((HTML.match(/const ziel=\(typeof fbTimed==='function'&&fbTimed\(\)\)\?fbFfaOffen\(\):who;/g) || []).length === 2,
     'ausserhalb der Zeitregel bleibt genau ein Spieler greifbar (2D und 3D)');
  ok(/const viele=Array\.isArray\(who\)/.test(HTML),
     'die Mehrfachauswahl ist eine Erweiterung derselben Funktion, keine zweite');
}

// ══ L. CLASSIC SPEED MATCH BLEIBT UNVERAENDERT ═════════════════════════════
{
  const G = build(5);
  // Dieselbe Uhr, andere Regel. Haette die Erweiterung Classic beschaedigt, faellt es
  // genau hier auf - am laufenden Werk, nicht an einer Textprobe.
  G.env({ variante: 'classic', classic: 'speed', regel: 'lives' });
  G.zielen(0, {});
  ok(G.st().wer === 0, 'in Speed Match ist dasselbe Entscheidungsfenster offen');
  G.tick(60);
  ok(G.st().bank[0] === 45 * 60 - 60, 'dort sinkt das persoenliche Konto, wie im Bestand');
  ok(G.st().bank[1] === 45 * 60, 'und das des Gegners keine einzige Zehntelsekunde');
  ok(G.st().ticks === TICKS, 'die Phasenuhr der Zeitregel wird dabei nicht angefasst');
  ok(G.st().schuss === 360 - 60, 'und der Sechs-Sekunden-Riegel ist derselbe wie zuvor');
  for (const c of [/const FOOTBALL_BANK_SECONDS=45;/, /const FOOTBALL_SHOT_SECONDS=6;/,
                   /const FOOTBALL_TROUBLE_SECONDS=2;/, /const FOOTBALL_WIN_SCORE=3;/])
    ok(c.test(HTML), 'Classic-Konstante unveraendert: ' + c.source);
  ok(/function fbRegulationOver\(\)\{return fbBank\[0\]<=0&&fbBank\[1\]<=0;\}/.test(HTML),
     'das Ende der Regulaerzeit in Speed Match ist unveraendert');
}

// ══ M. DIE LEBENSREGEL KENNT KEINE ZEIT ══════════════════════════════════
{
  const G = build(4);
  G.env({ regel: 'lives' });
  G.zielen(0, {});
  G.tick(300);
  ok(G.st().wer === -1, 'in der Lebensregel gibt es kein Entscheidungsfenster');
  ok(G.st().ticks === TICKS, 'also laeuft dort auch keine Phasenuhr');
  ok(G.st().schuss === 0, 'und kein Sechs-Sekunden-Riegel');
  ok(G.st().bereit.indexOf('1') < 0, 'nichts wird automatisch abgegeben');
  G.concede(0);
  ok(G.st().lives[0] === 1 && G.st().conceded[0] === 0, 'ein Gegentor kostet ein Leben');
  G.concede(0);
  ok(G.st().aktiv.indexOf(0) < 0, 'das zweite scheidet aus - die Bestandsregel ist unberuehrt');
  ok(/const FB_ELIM_LIVES=2;/.test(HTML), 'und sie behaelt ihre zwei Leben');
}

// ══ B. Das Phasenende unterbricht nichts ══════════════════════════════════════
{
  const G = build(5);
  phaseAus(G);
  ok(G.st().due === true, 'die abgelaufene Phase ist vorgemerkt');
  ok(G.st().aktiv.length === 5, 'aber noch ist niemand ausgeschieden');
  // Erst der Aufruf am Ende der Aktion wertet aus.
  G.concede(2);
  G.resolve(false);
  ok(G.st().aktiv.length === 4 && G.st().aktiv.indexOf(2) < 0,
     'erst die Auswertung am Ende der Aktion scheidet aus');

  // Und im Produkt haengt dieser Aufruf an genau zwei Stellen: im Settlement und am
  // Ende des Torablaufs. Nirgends sonst - insbesondere nicht mitten in der Physik.
  const rufe = (HTML.match(/fbFfaResolve\(/g) || []).length;
  ok(rufe === 3, 'fbFfaResolve hat eine Definition und genau zwei Aufrufer (' + rufe + ')');
  const stepSimSrc = grab(/function stepSim\(\)\{[\s\S]*?\n\}/, 'stepSim');
  ok(/if\(typeof fbFfaResolve==='function'&&fbFfaResolve\(false\)\)return;/.test(stepSimSrc),
     'der eine steht im Settlement — nach dem Stillstand, vor der Freigabe der Eingabe');
  const tickGoalSrc = grab(/function footballTickGoal\(\)\{[\s\S]*?\n\}/, 'footballTickGoal');
  ok(/if\(typeof fbFfaResolve==='function'\)fbFfaResolve\(true\);/.test(tickGoalSrc),
     'der andere am Ende des Torablaufs');
  ok(!/fbFfaResolve/.test(grab(/function stepSim\(\)\{[\s\S]*?let moving=false;/, 'stepSim-Physikteil')),
     'im laufenden Physikteil wird nicht ausgewertet');
}

// ══ C+D. Eindeutig Schlechtester scheidet aus, Zaehler gehen auf null ═════════
{
  const G = build(4);
  G.concede(0); G.concede(2); G.concede(2); G.concede(2); G.concede(3);
  ok(G.st().conceded.slice(0, 4).join(',') === '1,0,3,1', 'die Gegentore stehen je Spieler');
  ok(G.worst().join(',') === '2', 'der Schlechteste ist eindeutig');
  phaseAus(G);
  G.resolve(false);
  ok(G.st().aktiv.join(',') === '0,1,3', 'genau er scheidet aus');
  ok(G.st().conceded.slice(0, 4).join(',') === '0,0,0,0', 'alle Zaehler gehen auf null');
  ok(G.st().ticks === TICKS, 'und die Uhr auf eine volle Phase');
  ok(G.st().due === false && G.st().danger === false, 'nichts bleibt vorgemerkt');
}

// ══ E+F. Die Progression 5→4→3→2→Sieger und 4→3→2→Sieger ═════════════════════
for (const start of [5, 4, 3]) {
  const G = build(start);
  const folge = [];
  let schutz = 0;
  while (G.st().aktiv.length > 1 && schutz++ < 10) {
    // Der jeweils erste aktive Spieler kassiert eines mehr als alle anderen.
    const akt = G.st().aktiv;
    G.concede(akt[0]);
    phaseAus(G);
    G.resolve(false);
    folge.push(G.st().aktiv.length);
  }
  ok(folge.join('→') === Array.from({ length: start - 1 }, (_, i) => start - 1 - i).join('→'),
     start + ' Spieler laufen ueber ' + folge.join('→') + ' bis zum Sieger');
  ok(G.st().winner !== null, 'am Ende steht ein Sieger fest');
  ok(G.st().aktiv.length === 1 && G.st().aktiv[0] === G.st().winner,
     'und es ist der letzte Verbliebene');
}

// ══ G. Gleichstand erzeugt genau die richtige Gefahrenmenge ═══════════════════
{
  const G = build(4);
  G.concede(0); G.concede(1); G.concede(1); G.concede(2); G.concede(2);
  ok(G.worst().join(',') === '1,2', 'zwei Spieler liegen gleichauf am schlechtesten');
  phaseAus(G);
  const r = G.resolve(false);
  ok(r === false, 'die Auswertung beendet den Frame nicht — gespielt wird weiter');
  ok(G.st().danger === true, 'stattdessen beginnt der Gleichstand-Ausgang');
  ok(G.st().set.slice(0, 4).join(',') === 'false,true,true,false',
     'angreifbar sind genau die beiden gleichauf Schlechtesten');
  ok(G.st().aktiv.length === 4, 'niemand ist ausgeschieden');
  ok(G.st().conceded.slice(0, 4).join(',') === '1,2,2,0',
     'und die Zaehler bleiben stehen — es wird nichts zurueckgesetzt');
  ok(G.running() === false, 'die Uhr steht ab jetzt');
}

// ══ H+I. Wer im Gleichstand ausscheidet — und wer nicht ══════════════════════
{
  const G = build(4);
  G.concede(1); G.concede(1); G.concede(2); G.concede(2);
  phaseAus(G); G.resolve(false);
  ok(G.st().danger === true, 'Ausgangslage: Gleichstand laeuft');

  // Ein SICHERER Spieler kassiert — nichts passiert.
  G.concede(0);
  ok(G.st().aktiv.length === 4, 'ein Gegentor eines Sicheren scheidet niemanden aus');
  ok(G.st().danger === true, 'der Gleichstand laeuft unveraendert weiter');
  ok(G.st().conceded[0] === 1, 'gezaehlt wird es trotzdem');

  // Ein ANGREIFBARER kassiert — er ist raus, und eine neue Phase beginnt.
  G.concede(2);
  ok(G.st().aktiv.join(',') === '0,1,3', 'ein Gegentor eines Angreifbaren scheidet ihn aus');
  ok(G.st().danger === false, 'der Gleichstand ist damit beendet');
  ok(G.st().set.slice(0, 4).join(',') === 'false,false,false,false', 'die Gefahrenmenge ist leer');
  ok(G.st().conceded.slice(0, 4).join(',') === '0,0,0,0', 'die Zaehler sind zurueckgesetzt');
  ok(G.st().ticks === TICKS, 'und die Uhr laeuft wieder voll');
}

// ══ J. Das Zweierfinale spielt dieselbe Regel ════════════════════════════════
{
  const G = build(2);
  ok(G.st().aktiv.length === 2, 'zwei Spieler, dieselbe Regel');
  G.concede(1);
  phaseAus(G);
  G.resolve(false);
  ok(G.st().winner === 0, 'der mit weniger Gegentoren gewinnt das Finale');
  ok(G.log.indexOf('matchEnd') >= 0, 'das Match endet ueber den BESTEHENDEN Weg');

  // Auch das Finale kennt den Gleichstand.
  const H = build(2);
  phaseAus(H);
  H.resolve(false);
  ok(H.st().danger === true && H.st().set.slice(0, 2).join(',') === 'true,true',
     'stehen beide gleich, sind im Finale beide angreifbar');
  H.concede(1);
  ok(H.st().winner === 0, 'das naechste Gegentor entscheidet');
}

// ══ K. Rematch laesst nichts stehen ══════════════════════════════════════════
{
  const G = build(5);
  G.concede(0); G.concede(0); G.concede(1);
  phaseAus(G); G.resolve(false);
  ok(G.st().aktiv.length === 4, 'Vorzustand: es ist etwas passiert');
  G.setup(5);
  const s = G.st();
  ok(s.ticks === TICKS && s.due === false && s.danger === false, 'die Uhr ist wieder voll');
  ok(s.conceded.join(',') === '0,0,0,0,0', 'die Gegentore sind leer');
  ok(s.set.join(',') === 'false,false,false,false,false', 'die Gefahrenmenge ist leer');
  ok(s.aktiv.length === 5 && s.phaseN === 5, 'alle Spieler und die Arenaphase sind zurueck');
  ok(s.winner === null, 'und es gibt keinen Sieger mehr');
  // Der Produktweg dorthin: footballResetMatchState raeumt die Zeitregel mit.
  const resetSrc = grab(/function footballResetMatchState\(\)\{[^\n]*/, 'footballResetMatchState');
  ok(/fbElimReset\(\);if\(typeof fbFfaReset==='function'\)fbFfaReset\(\);/.test(resetSrc),
     'der Matchreset raeumt Leben UND Zeitregel — in dieser Reihenfolge');
}

// ══ L. Regelwechsel laesst nichts hinueberlaufen ═════════════════════════════
{
  const G = build(4);
  G.concede(0); G.concede(0);
  ok(G.st().conceded[0] === 2 && G.st().lives[0] === 2,
     'in der Zeitregel zaehlen Gegentore und die Leben bleiben unangetastet');

  const H = build(4);
  H.env({ regel: FFA_LIVES() });
  H.concede(0);
  ok(H.st().lives[0] === 1 && H.st().conceded[0] === 0,
     'in der Lebensregel kostet dasselbe Gegentor ein Leben und keinen Zaehler');
  H.concede(0);
  ok(H.st().aktiv.indexOf(0) < 0, 'und das zweite scheidet aus — die Bestandsregel ist unveraendert');

  // Der Produktweg: startFootball setzt die Regel bei JEDEM Start explizit.
  const startSrc = grab(/function startFootball\(variant,rules\)\{[\s\S]*?\n\}/, 'startFootball');
  ok(/if\(fbVariant===FOOTBALL_VARIANT_ELIM\)\{/.test(startSrc)
     && /\}else fbElimRules=FOOTBALL_ELIM_RULES_LIVES;/.test(startSrc),
     'jede andere Variante setzt ausdruecklich auf die Leben zurueck');
  ok(/fbElimRules=\(fbElimSetupRules===FOOTBALL_ELIM_RULES_TIMED\)\?FOOTBALL_ELIM_RULES_TIMED:FOOTBALL_ELIM_RULES_LIVES;/.test(startSrc),
     'und die Elimination uebernimmt sie aus der Einrichtung — an genau einer Stelle');
  // Nur ZUWEISUNGEN zaehlen - fbElimRules=== in fbTimed() ist ein Vergleich.
  // Fuenf Stellen: Deklaration, zwei Zweige in startFootball, und die beiden
  // Onlineeinstiege. Die letzten beiden sind das Ergebnis des unabhaengigen Reviews:
  // sie laufen NICHT ueber startFootball und haetten die Regel sonst stehen lassen.
  const setzt = (HTML.match(/fbElimRules=[^=]/g) || []).length;
  ok(setzt === 5, 'fbElimRules wird an genau fuenf Stellen gesetzt (' + setzt + ')');
  const onlineStellen = (HTML.match(/fbElimRules=FOOTBALL_ELIM_RULES_LIVES;   \/\/ online/g) || []).length;
  ok(onlineStellen === 2,
     'beide Onlineeinstiege setzen ausdruecklich auf die Lebensregel zurueck (' + onlineStellen + ')');
}
function FFA_LIVES() { return 'lives'; }

// ══ M. Das kanonische Torereignis zaehlt genau einmal ════════════════════════
{
  const G = build(4);
  G.concede(3);
  ok(G.st().conceded[3] === 1, 'ein Gegentor erhoeht um genau eins');
  // Es gibt genau EINEN Aufrufer der Wertung, und die Zeitregel haengt an ihm.
  const rufe = (HTML.match(/footballElimConcede\(/g) || []).length;
  ok(rufe === 2, 'footballElimConcede hat eine Definition und genau einen Aufrufer (' + rufe + ')');
  const concedeSrc = grab(/function footballElimConcede\(o\)\{[\s\S]*?\n\}/, 'footballElimConcede');
  ok(/fbFfaConceded\[o\]\+\+;/.test(concedeSrc),
     'die Zeitregel zaehlt in derselben Funktion wie der Lebensabzug');
  ok((HTML.match(/fbFfaConceded\[o\]\+\+/g) || []).length === 1,
     'und an keiner zweiten Stelle');
  ok(!/fbPassed|footballGoalCrossed/.test(grab(/const FOOTBALL_ELIM_RULES_LIVES='lives';[\s\S]*?\nfunction fbFfaResolve\(imTor\)\{[\s\S]*?\n\}/, 'Timed-FFA-Block')),
     'die Zeitregel leitet kein Tor aus der Ballposition ab — sie kennt nur das Ereignis');
}

// ══ N. Classic, Tactical und Online bleiben unberuehrt ══════════════════════
{
  ok(/const FOOTBALL_FMTS=\['elimination'\];/.test(HTML), 'FOOTBALL_FMTS unveraendert');
  ok(/const ONLINE_PROTOCOL_VERSION=7;/.test(HTML), 'Protokollversion unveraendert');
  const ffaBlock = grab(/const FOOTBALL_ELIM_RULES_LIVES='lives';[\s\S]*?\nfunction fbFfaResolve\(imTor\)\{[\s\S]*?\n\}/, 'Timed-FFA-Block');
  // Kommentare zaehlen nicht: der Block ERWAEHNT online, um zu sagen, dass es dort diese
  // Regel nicht gibt. Geprueft wird der Code.
  const ffaCode = ffaBlock.split('\n').filter(z => !/^\s*\/\//.test(z)).join('\n');
  ok(!/onlineSend|rRef|firebase|MOVE|writeTurnSlot|roomCode/.test(ffaCode),
     'die Zeitregel schreibt oder liest nichts Netzwerkbezogenes');
  // Sie LIEST `online` an genau einer Stelle: um sich selbst dort abzuschalten.
  ok((ffaCode.match(/\bonline\b/g) || []).length === 1
     && /return fbElim4\(\)&&!online&&/.test(ffaCode),
     'sie liest `online` genau einmal — um sich online abzuschalten');
  // Sie ist an die Eliminationsregeln gebunden — Classic und Tactical erreichen sie nie.
  ok(/function fbTimed\(\)\{return fbElim4\(\)&&!online&&fbElimRules===FOOTBALL_ELIM_RULES_TIMED;\}/.test(HTML),
     'fbTimed verlangt die Eliminationsregeln UND offline — Classic, Tactical und Online '
     + 'koennen sie nicht ausloesen');
  for (const c of [/const FOOTBALL_WIN_SCORE=3;/, /const FOOTBALL_BANK_SECONDS=45;/,
                   /const FOOTBALL_SHOT_SECONDS=6;/, /const FOOTBALL_TROUBLE_SECONDS=2;/])
    ok(c.test(HTML), 'Classic-Konstante unveraendert: ' + c.source);
  ok(/const FB_ELIM_LIVES=2;/.test(HTML), 'die Lebensregel behaelt ihre zwei Leben');
  // Die Arena wird nicht angefasst: die Zeitregel benutzt denselben Umbau.
  ok(!/FB_ELIM_ARENAS|FOOTBALL_ARENA_/.test(ffaBlock),
     'sie definiert keine eigene Geometrie — der Umbau kommt aus dem Bestand');
}

// ══ N2. Das Leck ins Onlinematch (Befund aus dem unabhaengigen Review) ══════
// Der Onlineeinstieg setzt die Variante auf Elimination, laeuft aber NICHT ueber
// startFootball. Nach einem lokalen Timed-Match waere fbElimRules dort auf 'timed'
// stehengeblieben und die Zeitregel im Onlinematch aktiv gewesen. Zwei Riegel:
{
  const G = build(4);
  ok(G.st().regel === 'timed', 'Ausgangslage: lokal laeuft die Zeitregel');
  G.env({ online: true });
  G.concede(0); G.concede(0);
  ok(G.st().lives[0] === 0 && G.st().conceded[0] === 0,
     'online kostet dasselbe Gegentor Leben — die Zeitregel greift nicht mehr');
  ok(G.st().aktiv.indexOf(0) < 0, 'und die Lebensregel scheidet wie im Bestand aus');
  G.env({ online: false });
  const H = build(4);
  H.env({ online: true });
  H.zielen(0, {});
  H.tick(300);
  ok(H.st().ticks === TICKS && H.st().due === false,
     'online laeuft auch die Phasenuhr nicht - fuenf Sekunden Zielen kosten nichts');
  ok(H.st().wer === -1, 'weil es online gar kein Entscheidungsfenster gibt');
  ok(H.st().bereit.indexOf('1') < 0, 'und deshalb auch keinen automatischen Zug');
}

// ══ Anzeige ═════════════════════════════════════════════════════════════════
{
  const G = build(5);
  ok(G.uhr() === '1:00', 'die volle Phase steht als 1:00');
  G.env({ ticks: 59 * 60 });
  ok(G.uhr() === '0:59', 'nach einer Sekunde als 0:59');
  G.env({ ticks: 1 });
  ok(G.uhr() === '0:01', 'der letzte Tick steht noch als 0:01');
  G.env({ ticks: 0 });
  ok(G.uhr() === '0:00', 'erst danach 0:00');
  G.env({ ticks: 60 });
  ok(G.kopf() === '0:01', 'der Kopf zeigt im Normalfall die Uhr');
  G.concede(1); G.concede(2);
  phaseAus(G); G.resolve(false);
  ok(G.kopf() === 'ffaDanger', 'im Gleichstand nennt er den Gleichstand');
}

console.log('');
console.log('Football-Timed-FFA: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
