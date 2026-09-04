// ARENA FOOTBALL — DAS THEMA (Action-Feel 03B)
//
// Pass 03B kehrt die Hierarchie um: nicht mehr ein Rhythmus, der auf Ereignisse
// antwortet, sondern ein STUECK, das durchlaeuft. Daraus folgen die Fragen dieser Suite:
//   1. Steht die Figur ueberhaupt als Figur - erkennbarer Rhythmus, erkennbarer Bogen,
//      und kehrt sie oft genug wieder?
//   2. Laeuft die UHR durch? Menue, Lobby, Match, Tor, Ergebnis, Rematch, Tabwechsel
//      duerfen sie nicht zuruecksetzen.
//   3. Beruehrt ein Schuss das Stueck? Er darf es nicht - weder starten noch verschieben.
//   4. Wo genau spielt es, und wo bleibt RingOut RingOut?
//   5. Faengt es erst nach einer echten Nutzergeste an, und bleiben Zeitgeber und
//      Audioknoten ueber lange Sitzungen beschraenkt?
//
// Komposition und Musikschicht werden dafuer WOERTLICH aus index.html uebernommen und in
// einem Sandkasten mit gefaelschtem AudioContext, gefaelschten Zeitgebern und einer
// vorspulbaren Uhr ausgefuehrt - kein Nachbau.
const { loadIndexHtml, grab: grabFrom, grabFunction } = require('./extract.js');
const HTML = loadIndexHtml();
const grab = (re, name) => grabFrom(HTML, re, name);
const NL = String.fromCharCode(10);

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.error('FAIL: ' + msg)); };
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('ARENA FOOTBALL - DAS THEMA: EINE FIGUR, EINE UHR, EIN PRODUKT' + NL);

const MUSIC_SRC = grab(/const FBMUSIC=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/, 'Musikschicht');
const grabIn = (re, name) => grabFrom(MUSIC_SRC, re, name);
// grabFunction erwartet Deklarationen am Zeilenanfang; im Modul sind sie eingerueckt.
// Die Einrueckung wegzunehmen aendert weder Klammerbilanz noch die geprueften Zeilen.
const MUSIC_FLAT = MUSIC_SRC.split(NL).map(l => l.replace(/^[ \t]+/, '')).join(NL);
// Die geteilte Klang-DNA: Tonvorrat, Klangfarbe und die eine Stimme, die sich das Thema
// und der Torklang teilen. Sie steht ausserhalb beider Module - der Sandkasten bekommt
// sie deshalb woertlich mitgeliefert.
const DNA_SRC = [grab(/const FB_MOTIF=\{G3:[\s\S]*?C6:1046\.50\};/, 'Tonvorrat'),
                 grab(/const FB_TIMBRE=\{detune:[\s\S]*?transientDec:[\d.]+\};/, 'Klangfarbe'),
                 grabFunction(HTML, 'fbPluckVoice')].join(NL);
// Das Klangmodul flach, damit eingerueckte Funktionen extrahierbar sind.
const SFX_SRC = grab(/const SFX=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/, 'Klangmodul');
const SFX_FLAT = SFX_SRC.split(NL).map(l => l.replace(/^[ \t]+/, '')).join(NL);

// ════════════════════════════════════════════════════════════════════════════
// TEIL 1 — DIE FIGUR
// ════════════════════════════════════════════════════════════════════════════
// Die Notentabellen werden aus dem Produktcode heraus ausgewertet, nicht nachgebaut:
// was hier geprueft wird, ist genau das, was klingt.
// Die Tontabelle steht seit Pass 03C ausserhalb des Moduls (FB_MOTIF), weil der
// Torklang dieselben Toene zitiert - genau das macht ihn zum Markenzeichen.
const KOMP = new Function(
  grab(/const FB_MOTIF=\{G3:[\s\S]*?C6:1046\.50\};/, 'Tonvorrat') + NL +
  grabIn(/const T=FB_MOTIF;[\s\S]*?const BASS=\[[^\]]*\];/, 'Komposition') + NL +
  'return {T,RUF,ANTWORT,HOOK,VARIANTE,ATEM,WENDE,FORM,ROOT,KICK,HAT,BASS};')();
const RASTER = new Function(
  grabIn(/const BPM=126, STEP=30\/BPM, BAR=8, CELL=16, CELLS=6, TOTAL=CELL\*CELLS;/, 'Raster') +
  NL + 'return {BPM,STEP,BAR,CELL,CELLS,TOTAL};')();

// ── 1. Der rhythmische Fingerabdruck ────────────────────────────────────────
// Ruf und Antwort teilen sich DENSELBEN Rhythmus. Genau das macht die Figur nach ein
// paar Sekunden wiedererkennbar: der Rhythmus stellt die Frage, die Tonhoehe antwortet.
{
  const rufR = KOMP.RUF.map(n => n[0]);
  const antR = KOMP.ANTWORT.map(n => n[0] - RASTER.BAR);
  ok(gleich(rufR, antR), 'Ruf und Antwort haben denselben Rhythmus (' + rufR.join(',') + ')');
  ok(gleich(KOMP.RUF.map(n => n[2]), KOMP.ANTWORT.map(n => n[2])),
     'und dieselbe Notenlaengenfolge - kurz kurz kurz LANG');
  ok(rufR.length === 4, 'die Figur hat vier Anschlaege je Takt');
  ok(!gleich(rufR, [0, 2, 4, 6]) && !gleich(rufR, [0, 1, 2, 3]),
     'der Rhythmus ist synkopiert, kein gerades Achtelraster (' + rufR.join(',') + ')');
  ok(KOMP.RUF[3][2] >= 2 && KOMP.RUF.slice(0, 3).every(n => n[2] === 1),
     'drei kurze Anschlaege, dann ein langer - der Landeton');
}

// ── 2. Die Kontur ───────────────────────────────────────────────────────────
// Der Ruf steigt und bleibt stehen, die Antwort kommt von oben und loest auf demselben
// Ton auf. Ein Bogen, keine Tonleiter und kein Arpeggio.
{
  const r = KOMP.RUF.map(n => n[1]), a = KOMP.ANTWORT.map(n => n[1]);
  ok(r[0] === KOMP.T.E4 && r[1] === KOMP.T.E4 && r[2] === KOMP.T.G4 && r[3] === KOMP.T.A4,
     'der Ruf steigt: E E G A');
  ok(a[0] === KOMP.T.C5 && a[1] === KOMP.T.B4 && a[2] === KOMP.T.G4 && a[3] === KOMP.T.A4,
     'die Antwort kommt von oben: C B G A');
  ok(r[3] === a[3], 'beide landen auf demselben Ton - das ist die Aufloesung');
  ok(a[0] > r[3], 'die Antwort setzt HOEHER ein als der Ruf endet (Spannung)');
  const schritte = [];
  for (let i = 1; i < r.length; i++) schritte.push(Math.round(1200 * Math.log2(r[i] / r[i - 1])));
  ok(new Set(schritte.filter(v => v !== 0)).size >= 2,
     'die Intervalle sind ungleich - kein Arpeggio (' + schritte.join(',') + ' Cent)');
  ok(gleich(KOMP.VARIANTE.slice(0, 4), KOMP.RUF), 'die Variante beginnt mit demselben Ruf');
  const vEnde = KOMP.VARIANTE[KOMP.VARIANTE.length - 1][1];
  ok(vEnde !== r[3], 'aber sie endet NICHT auf dem Grundton - sie bleibt offen');
  ok(vEnde === KOMP.T.B4, 'sondern auf der Sekunde (B) - deshalb will man den Ruf zurueck');
  ok(gleich(KOMP.VARIANTE.map(n => n[0]), KOMP.HOOK.map(n => n[0])),
     'und sie behaelt den Fingerabdruck exakt bei');
}

// ── 3. Die Form ─────────────────────────────────────────────────────────────
{
  ok(KOMP.FORM.length === RASTER.CELLS, 'die Form hat sechs Zellen');
  const hooks = KOMP.FORM.filter(z => gleich(z, KOMP.HOOK)).length;
  ok(hooks === 3, 'der Ruf steht in genau drei davon (' + hooks + ')');
  const idx = KOMP.FORM.map((z, i) => gleich(z, KOMP.HOOK) ? i : -1).filter(i => i >= 0);
  ok(gleich(idx, [0, 2, 4]), 'und zwar abwechselnd (Zellen ' + idx.join(',') + ')');
  ok(!gleich(KOMP.FORM[1], KOMP.FORM[3]) && !gleich(KOMP.FORM[3], KOMP.FORM[5]),
     'die drei Zwischenzellen sind alle verschieden - Variante, Atem, Wende');
  const unterHook = idx.map(i => KOMP.ROOT[i]);
  ok(new Set(unterHook).size === 3,
     'der Ruf steht ueber drei verschiedenen Grundtoenen (' + unterHook.join(', ') + ' Hz)');
  ok(new Set(KOMP.ROOT).size === 3,
     'die ganze Form kennt genau drei Grundtoene - kein Vier-Akkord-Muster');
  const sek = RASTER.TOTAL * RASTER.STEP;
  ok(sek >= 15 && sek <= 30, 'die vollstaendige Form dauert ' + sek.toFixed(2) + ' s (Ziel 15-30 s)');
  const zelle = RASTER.CELL * RASTER.STEP;
  ok(zelle >= 3 && zelle <= 6,
     'der Ruf selbst ist in ' + zelle.toFixed(2) + ' s zu hoeren (Ziel 3-6 s)');
  ok(2 * zelle <= 8, 'und er kommt spaetestens alle ' + (2 * zelle).toFixed(1) + ' s wieder');
}

// ── 4. Die Klangfarbe ───────────────────────────────────────────────────────
// Kein Sinuston-Klingelton: zwei verstimmte Koerper hinter einem zufallenden Filter,
// dazu eine kurze metallische Transiente auf einem INHARMONISCHEN Oberton.
{
  // Die Klangfarbe steht EINMAL ausserhalb beider Module: das Thema und der Torklang
  // benutzen woertlich dieselbe Stimme. Deshalb wird hier die geteilte Fassung geprueft.
  const p = grabFunction(HTML, 'fbPluckVoice');
  ok(/fbPluckVoice\(c,gMotif,t,f,steps\*STEP,0\.34,mRnd,voice\);/.test(MUSIC_SRC),
     'das Thema spielt seine Figur mit der geteilten Stimme');
  // Der schaerfere Beweis: die Kennzahlen der Klangfarbe stehen NUR in der geteilten
  // Fassung. Taucht eine davon im Musikmodul wieder auf, gibt es zwei Instrumente.
  for (const zahl of ['5.42', '1.0028', 'filtQ', 'sawMix', 'transientDec'])
    ok(MUSIC_SRC.indexOf(zahl) < 0, 'die Klangfarbe steht nicht doppelt im Musikmodul (' + zahl + ')');
  ok(/lp\.type='lowpass';lp\.Q\.value=K\.filtQ;/.test(p) && /filtQ:3\.5/.test(HTML),
     'der Anschlag ist ein zufallendes Filter');
  ok(/lp\.frequency\.exponentialRampToValueAtTime\(f\*K\.filtFall,t\+K\.filtTime\);/.test(p) &&
     /filtFall:1\.55/.test(HTML) && /filtTime:0\.13/.test(HTML),
     'es faellt in 130 ms auf die Naehe des Grundtons - das ist das Gezupfte');
  ok(/o1\.type='triangle'/.test(p) && /o2\.type='sawtooth'/.test(p),
     'zwei verschiedene Koerper, nicht ein Sinus');
  ok(/o2\.frequency\.value=f\*\(K\.detune\+K\.detuneJit\*rnd\(\)\);/.test(p) &&
     /detune:1\.0028/.test(HTML), 'minimal gegeneinander verstimmt - Breite statt Schaerfe');
  ok(/mo\.frequency\.value=f\*K\.partial;/.test(p) && /partial:5\.42/.test(HTML),
     'die metallische Transiente sitzt auf einem inharmonischen Oberton (5.42)');
  ok(Math.abs(5.42 - Math.round(5.42)) > 0.3, 'der bewusst KEIN ganzzahliges Vielfaches ist');
  ok(/mg\.gain\.exponentialRampToValueAtTime\(0\.0004,t\+K\.transientDec\);/.test(p) &&
     /transientDec:0\.05/.test(HTML), 'und nach 50 ms weg ist - Farbe, keine Glocke');
  ok(!/type='square'/.test(MUSIC_SRC), 'nirgends ein Rechteck - kein Chiptune');
}

// ════════════════════════════════════════════════════════════════════════════
// TEIL 2 — WO SPIELT ES?
// ════════════════════════════════════════════════════════════════════════════
const glueSrc = [grab(/const FB_FX_T1=[\d., =A-Z_]+;/, 'Stufenschwellen')]
  .concat(['fbMusicAllowed', 'fbMusicLobbyOpen', 'fbMusicScene', 'fbMusicIntensity',
           'fbMusicSync', 'fbMusicAccentOk', 'fbMusicLaunch', 'fbMusicHero', 'fbMusicGoal',
           'fbMusicResult', 'fbFxTier'].map(n => grabFunction(HTML, n))).join(NL);

const G = new Function(`
  const env={mode:'football',musicOn:true,soundOn:true,menuVisible:false,replaying:false,
             fbFxMute:false,phase:'aim',elim:false,act:[0,1,2,3,4],lives:[2,2,2,2,2],
             score:[0,0],online:false,terminated:false,lobby:false};
  let mode,musicOn,soundOn,menuVisible,replaying,fbFxMute,phase,score,fbElimLives,online;
  let fbMusicOnlinePanel=null;
  const FOOTBALL_WIN_SCORE=3;
  function fbElim4(){return env.elim;}
  function fbElimActiveOwners(){return env.act.slice();}
  function isOnlineTerminated(){return env.terminated;}
  // Der Onlinebildschirm als echtes Element: fbMusicLobbyOpen liest classList.contains.
  const document={getElementById:(id)=>id==='online'
    ?{classList:{contains:(k)=>k==='show'&&env.lobby}}:null};
  function bind(){mode=env.mode;musicOn=env.musicOn;soundOn=env.soundOn;
    menuVisible=env.menuVisible;replaying=env.replaying;fbFxMute=env.fbFxMute;
    phase=env.phase;score=env.score;fbElimLives=env.lives;online=env.online;}
  const calls=[];
  const FBMUSIC={set:(s,i)=>calls.push(['set',s,i]),hero:(m)=>calls.push(['hero',m]),
                 launch:(p)=>calls.push(['launch',p]),goal:(m)=>calls.push(['goal',m]),
                 result:(w)=>calls.push(['result',w]),stop:()=>calls.push(['stop'])};
  // Die abgeloeste Spur ist noch da, aber sie fuehrt nicht mehr. Beide Attrappen sammeln
  // in dieselbe Liste, damit sichtbar wird, WELCHE Stimme was bekommt.
  const FBTRACK={set:(s)=>calls.push(['track',s]),stop:()=>calls.push(['trackStop']),
                 setDark:(v)=>calls.push(['trackDark',v])};
  ${glueSrc}
  const lauf=(fn)=>{bind();calls.length=0;fn();return calls.slice();};
  return {env,
    scene:()=>{bind();return fbMusicScene();},
    iv:()=>{bind();return fbMusicIntensity();},
    sync:()=>lauf(()=>fbMusicSync()),
    launch:(p)=>lauf(()=>fbMusicLaunch(p)),
    hero:(m)=>lauf(()=>fbMusicHero(m)),
    goal:(m)=>lauf(()=>fbMusicGoal(m)),
    res:(w)=>lauf(()=>fbMusicResult(w))};
`)();

function reset(over) {
  Object.assign(G.env, {
    mode: 'football', musicOn: true, soundOn: true, menuVisible: false, replaying: false,
    fbFxMute: false, phase: 'aim', elim: false, act: [0, 1, 2, 3, 4],
    lives: [2, 2, 2, 2, 2], score: [0, 0], online: false, terminated: false, lobby: false,
  });
  if (over) Object.assign(G.env, over);
}

// ── 5. Der Geltungsbereich ──────────────────────────────────────────────────
// Das Thema gehoert der SCHALE dieses Produkts - Startseite, Moduswahl, Lobby, Match,
// Ergebnis. Es gehoert NICHT in ein RingOut-, FFA-, Team-Duel- oder Bot-Spiel.
{
  reset({ menuVisible: true });
  ok(G.scene() === 'menu', 'auf der Startseite spielt das Thema');
  reset({ menuVisible: true, mode: 'bot' });
  ok(G.scene() === 'menu', 'auch wenn dort gerade eine RingOut-Karte gewaehlt ist');
  reset({ menuVisible: true, lobby: true });
  ok(G.scene() === 'lobby', 'auf dem Onlinebildschirm wechselt es in die Lobbybesetzung');
  reset({ menuVisible: true, lobby: true, mode: 'ffa' });
  ok(G.scene() === 'lobby', 'unabhaengig vom gewaehlten Onlinemodus');
  reset();
  ok(G.scene() === 'match', 'im laufenden Arena-Football-Match die volle Besetzung');
  reset({ phase: 'over' });
  ok(G.scene() === 'menu', 'unter dem Ergebnisfenster tritt es zurueck - aber es bleibt');
  for (const m of ['bot', 'pvp', 'ffa', 'online']) {
    reset({ mode: m });
    ok(G.scene() === 'off', 'im laufenden ' + m + '-Spiel schweigt es - RingOut bleibt RingOut');
  }
  reset({ replaying: true });
  ok(G.scene() === 'off', 'waehrend einer Wiedergabe schweigt es');
  reset({ menuVisible: true, replaying: true });
  ok(G.scene() === 'off', 'auch im Menue');
  reset({ fbFxMute: true });
  ok(G.scene() === 'off', 'waehrend einer Rehydrierung ebenfalls');
  reset({ musicOn: false, menuVisible: true });
  ok(G.scene() === 'off', 'der Musikschalter schaltet es ab');
  reset({ soundOn: false, menuVisible: true });
  ok(G.scene() === 'off', 'der uebergeordnete Klangschalter auch');
  reset({ online: true, terminated: true });
  ok(G.scene() === 'off', 'nach einem terminalen Onlineabbruch schweigt es');
  reset({ online: true, terminated: false });
  ok(G.scene() === 'match', 'ein intaktes Onlinematch spielt normal');
}

// ── 6. Akzente gehoeren dem Match ───────────────────────────────────────────
{
  reset();
  ok(G.launch(1).length === 1, 'im Match liegt ein Abschussakzent auf dem Stueck');
  reset({ menuVisible: true });
  ok(G.launch(1).length === 0, 'im Menue gibt es nichts zu quittieren');
  reset({ menuVisible: true, lobby: true });
  ok(G.launch(1).length === 0, 'in der Lobby ebenfalls nicht');
  reset();
  ok(G.hero(0.10).length === 0, 'ein Mikrokontakt am Ball erzeugt keinen Ton');
  ok(G.hero(0.55).length === 0, 'ein kraeftiger Kontakt bleibt ohne Musiknote');
  ok(G.hero(0.80).length === 1, 'erst der Heldentreffer bekommt eine');
  ok(G.goal(true).length === 1, 'das Tor bekommt seinen Akzent');
  reset({ replaying: true });
  ok(G.goal(true).length === 0 && G.hero(0.9).length === 0 && G.launch(1).length === 0,
     'in einer Wiedergabe gar keiner');
  reset({ phase: 'over' });
  const r = G.res(true);
  ok(r.length === 1 && r[0][0] === 'result',
     'die Aufloesung erreicht die Musik auch unter dem Ergebnisfenster');
  reset({ fbFxMute: true });
  ok(G.res(true).length === 0, 'waehrend einer Rehydrierung klingt sie nicht');
  reset({ replaying: true });
  ok(G.res(true).length === 0, 'in einer Wiedergabe auch nicht');
  ok(!/FBMUSIC\.stop\(\)/.test(grabFunction(HTML, 'fbMusicResult')),
     'und sie beendet das Stueck NICHT - das Thema laeuft danach weiter');
}

// ── 7. Der Einsatz steigt, das Stueck bleibt ────────────────────────────────
{
  reset({ elim: true, act: [0, 1, 2, 3, 4] });
  ok(near(G.iv(), 0, 1e-9), 'fuenf Spieler: Grundbesetzung');
  reset({ elim: true, act: [0, 1, 2, 3] });
  ok(near(G.iv(), 1 / 3, 1e-9), 'vier Spieler: etwas mehr Antrieb');
  reset({ elim: true, act: [0, 1, 2] });
  ok(near(G.iv(), 2 / 3, 1e-9), 'drei Spieler: eine Schicht mehr');
  reset({ elim: true, act: [0, 1] });
  ok(near(G.iv(), 1, 1e-9), 'zwei Spieler: volle Duellbesetzung');
  reset({ elim: true, act: [0, 1], lives: [2, 2, 2, 2, 2] });
  ok(near(G.iv(), 1, 1e-9), 'ein Match, das zu zweit STARTET, ist sofort ein Duell');
  reset({ elim: true, act: [0, 1, 2, 3, 4], lives: [1, 2, 2, 2, 2] });
  ok(near(G.iv(), 0.15, 1e-9), 'ein letztes Leben hebt leicht an');
  reset({ elim: true, act: [0, 1], lives: [1, 1, 2, 2, 2] });
  ok(G.iv() === 1, 'und kann die Obergrenze nicht ueberschreiten');
  reset({ score: [0, 0] }); ok(near(G.iv(), 0, 1e-9), 'Classic 0:0 ist Grundbesetzung');
  reset({ score: [1, 0] }); ok(near(G.iv(), 0.5, 1e-9), 'Classic 1:0 zieht an');
  reset({ score: [2, 1] }); ok(near(G.iv(), 1, 1e-9), 'Classic beim Matchball ist voll');
  // Die Intensitaet wird weiterhin abgeleitet, aber der Bildlauf fragt sie nicht mehr:
  // das abgeloeste Thema bekommt nur noch 'off'. Die Zahl bleibt geprueft (oben), damit
  // eine spaetere Match-Atmosphaere darauf aufsetzen kann.
  reset({ menuVisible: true, elim: true, act: [0, 1] });
  const c = G.sync();
  ok(c.some(x => x[0] === 'track' && x[1] === 'menu'), 'im Menue erreicht die Szene das Stueck');
  ok(c.every(x => x[0] !== 'set' || (x[1] === 'off' && x[2] === 0)),
     'und das abgeloeste Thema bekommt auch dort nur "off"');
}

// ── 8. Der Bildlauf reicht genau eine Szene weiter ──────────────────────────
{
  reset();
  const c1 = G.sync();
  ok(c1.length === 2, 'ein Bildlauf reicht genau zwei Eingaenge weiter (' + c1.length + ')');
  ok(c1[0][0] === 'track' && c1[0][1] === 'match',
     'die abgeleitete Szene geht an das Stueck');
  ok(c1[1][0] === 'set' && c1[1][1] === 'off' && c1[1][2] === 0,
     'und das abgeloeste Thema wird in JEDEM Bild auf off gehalten - nicht einmalig');
  const lp = grabFunction(HTML, 'loop');
  const imBild = (lp.match(/fbMusicSync\(\)/g) || []).length;
  ok(imBild === 1, 'die Bildschleife ruft genau EINMAL je Bild (' + imBild + ')');
  // Der einzige weitere Aufrufer ist die Rehydrierung (s. Abschnitt 19c) - sie blockiert
  // den Hauptfaden und kann deshalb nicht auf den naechsten Bildlauf warten.
  const gesamt = (HTML.match(/fbMusicSync\(\);/g) || []).length;   // mit Semikolon: Aufrufe, nicht die Deklaration
  ok(gesamt === 3, 'im ganzen Produkt gibt es genau drei Aufrufer (' + gesamt + ')');
  const iSync = lp.indexOf('fbMusicSync()'), iRep = lp.indexOf('if(replaying)');
  ok(iSync > 0 && iRep > 0 && iSync < iRep,
     'er steht VOR der Wiedergabe-Abkuerzung - sonst liefe die Musik im Replay weiter');
  ok(!/fbMusicStop\(\)/.test(grabFunction(HTML, 'showMenu')),
     'der Weg ins Menue beendet das Thema nicht mehr - es wechselt nur die Besetzung');
}

// ── 8b. Die Abloesung ist dicht ─────────────────────────────────────────────
// Der Auftrag lautet: keine doppelte Musik, kein altes Motiv darunter. Das ist keine
// Frage der Wahrscheinlichkeit, sondern eine des Aufbaus - und genau das wird hier
// geprueft, fuer JEDE Szene und an der Quelle.
{
  for (const [name, over] of [['Startseite', { menuVisible: true }],
                              ['Lobby', { menuVisible: true, lobby: true }],
                              ['Match', {}],
                              ['Ergebnis', { phase: 'over' }],
                              ['RingOut-Spiel', { mode: 'ffa' }],
                              ['Wiedergabe', { replaying: true }],
                              ['Musik aus', { musicOn: false, menuVisible: true }]]) {
    reset(over);
    const c = G.sync();
    const alt = c.filter(x => x[0] === 'set');
    ok(alt.length === 1 && alt[0][1] === 'off' && alt[0][2] === 0,
       name + ': das abgeloeste Thema bekommt ausschliesslich off');
    const neu = c.filter(x => x[0] === 'track');
    ok(neu.length === 1 && neu[0][1] === G.scene(),
       name + ': das Stueck bekommt genau die abgeleitete Szene');
  }
  // Der Klangschalter haelt BEIDE an - sonst liefe die eine Spur weiter, waehrend die
  // andere schweigt.
  const stopSrc = grabFunction(HTML, 'fbMusicStop');
  ok(/FBTRACK\.stop\(\)/.test(stopSrc) && /FBMUSIC\.stop\(\)/.test(stopSrc),
     'Klang aus haelt das Stueck UND das abgeloeste Thema an');
  // Und der Hintergrundtab ebenfalls beide.
  ok(/FBTRACK\.setDark\(h\)/.test(HTML) && /FBMUSIC\.setDark\(h\)/.test(HTML),
     'der Hintergrundtab schaltet beide still');
}

// ── 8c. Das Stueck: Schleife, Blenden, genau EIN Kontext ────────────────────
// Gegen die Wellenform laesst sich hier nichts pruefen, gegen den Aufbau schon - und
// die vier Punkte unten sind die, an denen eine Menuemusik hoerbar kaputtgeht.
{
  const src = grab(/const FBTRACK=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/, 'Menuemusik');
  const num = (n) => {
    const m = HTML.match(new RegExp('const ' + n + '=([\\d.]+)'));
    return m ? parseFloat(m[1]) : NaN;
  };
  const TAKT = 4 * 60 / 128;
  const ein = parseFloat(HTML.match(/const FB_MENU_LOOP_IN=([\d.]+)/)[1]);
  const aus = parseFloat(HTML.match(/FB_MENU_LOOP_OUT=([\d.]+)/)[1]);
  ok(Math.abs(ein / TAKT - Math.round(ein / TAKT)) < 1e-9,
     'der Schleifenanfang liegt auf einer Taktgrenze (Takt ' + (ein / TAKT) + ')');
  ok(Math.abs(aus / TAKT - Math.round(aus / TAKT)) < 1e-9,
     'das Schleifenende ebenfalls (Takt ' + (aus / TAKT) + ')');
  ok(ein >= 28 && ein < 29,
     'der Schleifenanfang liegt hinter dem Aufbau (' + ein + ' s) - Einstieg und Aufbau '
     + 'laufen einmal je Menuebesuch, nicht bei jedem Umlauf');
  ok(aus - ein >= 30,
     'der Umlauf ist lang genug, um nicht als Schleife aufzufallen (' +
     (aus - ein).toFixed(3) + ' s)');
  // Der Pegel ist der eine Wert, an dem die Lautstaerke haengt. Der Hoertest hat 0.50
  // als deutlich zu laut verworfen; die Vorgabe lautet rund 0.30.
  const pegel = num('FB_MENU_GAIN');
  ok(pegel >= 0.28 && pegel <= 0.32,
     'der Menuepegel liegt in der Vorgabe 0,28-0,32 (' + pegel + ')');
  const raus = num('FB_MENU_FADE_OUT');
  ok(raus >= 0.5 && raus <= 0.9,
     'die Matchblende liegt in der Vorgabe 0,5-0,9 s (' + raus + ' s)');
  ok(num('FB_MENU_FADE_IN') > 0 && num('FB_MENU_FADE_IN') < raus,
     'die Rueckkehr blendet kuerzer ein als das Match ausblendet');
  ok(/SFX\.ctxRunning/.test(src) && !/new\s*\(?\s*window\.AudioContext/.test(src),
     'es benutzt den gemeinsamen Kontext und legt keinen zweiten an');
  ok((src.match(/createBufferSource\(\)/g) || []).length === 1,
     'es gibt genau eine Stelle, an der eine Quelle entsteht');
  ok(/if\(stimme\|\|!buf\|\|!c\)return;/.test(src),
     'und sie legt keine zweite an, solange eine laeuft');
  ok(/stimme=null;/.test(src) && src.indexOf('stimme=null;') < src.indexOf('v.src.stop'),
     'das Anhalten loest die Quelle SOFORT - ein zweiter Aufruf trifft nichts mehr');
  // Jede Wiedergabe braucht ihr eigenes Gain, sonst zieht eine laufende Ausblendung die
  // naechste Einblendung mit. Genau das passiert beim schnellen Menue -> Match -> Menue.
  ok(/const g=c\.createGain\(\);g\.gain\.value=0\.0001;g\.connect\(master\);/.test(src),
     'jede Wiedergabe bekommt ihr eigenes Gain');
  ok(/const FB_MENU_SRCS=\['assets\/audio\/arena-football-menu\.m4a'/.test(HTML),
     'das Asset liegt unter assets/audio/ und wird mit Rueckfall geladen');
}

// ════════════════════════════════════════════════════════════════════════════
// TEIL 3 — DER SANDKASTEN
// ════════════════════════════════════════════════════════════════════════════
function mkParam(v) {
  // hist haelt JEDEN gesetzten Wert fest. Eine Stimme, die ihre Tonhoehe faehrt, hat
  // nicht einen Wert, sondern einen Verlauf - und beim Torklang steckt die Aussage
  // gerade im Anfang des Sweeps, nicht in seinem Ende.
  return {
    value: v, ev: 0, hist: [],
    setValueAtTime(x) { this.value = x; this.hist.push(x); this.ev++; return this; },
    linearRampToValueAtTime(x) { this.value = x; this.hist.push(x); this.ev++; return this; },
    exponentialRampToValueAtTime(x) { this.value = x; this.hist.push(x); this.ev++; return this; },
    setTargetAtTime(x) { this.value = x; this.hist.push(x); this.ev++; return this; },
    cancelScheduledValues() { this.ev++; return this; },
  };
}
function mkCtx() {
  const ctx = { currentTime: 0, state: 'running', destination: { kind: 'dest' } };
  ctx.live = new Set();     // erzeugt und noch nicht getrennt
  ctx.all = [];             // jemals erzeugt, in Reihenfolge
  ctx.srcs = [];            // laufende Quellen mit Stopzeit
  ctx.swallow = false;      // Quellen melden sich nie zurueck (unterbrochener Audiofaden)
  const node = (kind) => {
    const n = {
      kind, conns: 0,
      connect(t) { this.conns++; this.dest = t; },
      disconnect() { ctx.live.delete(this); this.dest = null; },
    };
    ctx.all.push(n); ctx.live.add(n); return n;
  };
  const src = (n) => {
    n.start = (t) => { n.t0 = t; };
    n.stop = (t) => { n.t1 = t; if (ctx.srcs.indexOf(n) < 0) ctx.srcs.push(n); };
    return n;
  };
  ctx.createGain = () => { const n = node('gain'); n.gain = mkParam(1); return n; };
  ctx.createBiquadFilter = () => {
    const n = node('filter'); n.type = ''; n.frequency = mkParam(0); n.Q = mkParam(0); return n;
  };
  ctx.createOscillator = () => {
    const n = node('osc'); n.type = ''; n.frequency = mkParam(0); return src(n);
  };
  ctx.createBufferSource = () => {
    const n = node('bufsrc'); n.buffer = null; n.loop = false; n.playbackRate = mkParam(1);
    return src(n);
  };
  ctx.advance = (dt) => {
    ctx.currentTime += dt;
    if (ctx.swallow) return;
    const rest = [];
    for (const n of ctx.srcs) {
      if (n.t1 != null && n.t1 <= ctx.currentTime) { if (n.onended) n.onended(); }
      else rest.push(n);
    }
    ctx.srcs = rest;
  };
  return ctx;
}
function mkEnv() {
  const ctx = mkCtx();
  let msNow = 0, seq = 1;
  const ivals = new Map(), touts = new Map();
  const si = (fn, ms) => { const id = seq++; ivals.set(id, { fn, ms, next: msNow + ms }); return id; };
  const ci = (id) => { ivals.delete(id); };
  const st = (fn, ms) => { const id = seq++; touts.set(id, { fn, at: msNow + ms }); return id; };
  const perf = { now: () => msNow };
  const SFX = {
    ctx: null,
    ctxRunning() { return this.ctx; },
    noiseBuf() { return this.ctx ? { fake: 'noise' } : null; },
  };
  const M = new Function('SFX', 'setInterval', 'clearInterval', 'setTimeout', 'performance',
    DNA_SRC + NL + MUSIC_SRC + NL + 'return FBMUSIC;')(SFX, si, ci, st, perf);
  // chunk = wie grob die Zeit voranschreitet. Ist er groesser als das Zeitgeberintervall,
  // bildet das einen HAENGENDEN Hauptfaden nach: der Lauf kommt zu spaet und genau EINMAL -
  // so wie ein Browser einen verzoegerten setInterval nachholt, naemlich gar nicht.
  function advance(ms, chunk) {
    const c0 = chunk || 10;
    const end = msNow + ms;
    while (msNow < end) {
      const d = Math.min(c0, end - msNow);
      msNow += d; ctx.advance(d / 1000);
      for (const iv of Array.from(ivals.values()))
        if (iv.next <= msNow) { iv.next = msNow + iv.ms; iv.fn(); }
      for (const [id, t] of Array.from(touts)) if (t.at <= msNow) { touts.delete(id); t.fn(); }
    }
  }
  // Ein harter Sprung der Audiouhr OHNE Zeitgeberlaeufe: Hintergrundtab, Ruhezustand,
  // haengender Hauptfaden.
  function jump(sec) { ctx.currentTime += sec; msNow += sec * 1000; }
  return { M, ctx, SFX, advance, jump,
           marke: () => ctx.all.length,
           seit: (m) => ctx.all.slice(m),
           timers: () => ivals.size,
           unlock: () => { SFX.ctx = ctx; },
           masterNode: () => Array.from(ctx.live).find(n => n.dest === ctx.destination) };
}
const toene = (nodes) => nodes.filter(n => n.kind === 'osc').map(n => n.frequency.value);
// Jede Tonhoehe, die eine Stimme angenommen hat - fest gesetzte wie gefahrene.
const alleToene = (nodes) => nodes.filter(n => n.kind === 'osc')
  .reduce((a, n) => a.concat([n.frequency.value], n.frequency.hist || []), []);
const enthaelt = (arr, f) => arr.some(v => Math.abs(v - f) < 0.5);
const rauschen = (nodes) => nodes.filter(n => n.kind === 'bufsrc').length;
// Erreicht diese Stimme den Ausgang noch? Ein Klang, dessen Weg unterwegs getrennt wurde,
// ist STUMM - auch wenn alle seine eigenen Knoten noch vorhanden sind. Genau das war die
// Luecke: die Suite zaehlte Trennungen, pruefte aber nie die Hoerbarkeit.
function erreichtAusgang(ctx, n) {
  let k = n, tiefe = 0;
  while (k && tiefe++ < 12) { if (k.dest === ctx.destination) return true; k = k.dest; }
  return false;
}
// Das Stimmenbudget wird je SCHRITT geprueft: ein begonnener Schritt wird zu Ende
// geplant, hoechstens sieben Stimmen stehen also ueber der Grenze.
const VOICE_CAP = 32 + 8;
// Passt das, was KLINGT, zu der Stelle, die die absolute Uhr vorgibt? Fuer jede geplante
// Stimme im Tonumfang der Figur wird aus ihrem Zeitpunkt der Schritt zurueckgerechnet und
// mit der Notentabelle verglichen. Damit haengt die Pruefung am echten Schrittzaehler des
// Planers, nicht an der abgeleiteten Positionsangabe.
function figurStimmt(e, nodes) {
  const st = e.ctx.currentTime - e.M.pos().elapsed;
  let geprueft = 0, falsch = 0, leer = 0;
  for (const n of nodes) {
    if (n.kind !== 'osc' || n.t0 == null) continue;
    const f = n.frequency.value;
    if (f < 190 || f > 700) continue;              // Bett, Puls, Bass und Transiente liegen ausserhalb
    const roh = (n.t0 - st) / RASTER.STEP, k = Math.round(roh);
    if (Math.abs(roh - k) > 0.02) continue;        // ein Akzent, nicht im Raster
    const ci = ((Math.floor(k / RASTER.CELL) % RASTER.CELLS) + RASTER.CELLS) % RASTER.CELLS;
    const kk = ((k % RASTER.CELL) + RASTER.CELL) % RASTER.CELL;
    const erwartet = KOMP.FORM[ci].filter(x => x[0] === kk).map(x => x[1]);
    geprueft++;
    if (!erwartet.length) { leer++; continue; }    // an dieser Stelle steht gar keine Figur
    if (!erwartet.some(soll => Math.abs(f / soll - 1) < 0.01)) falsch++;
  }
  return { geprueft: geprueft, falsch: falsch, leer: leer };
}

// Das Klangmodul woertlich ausgefuehrt: fuer den Torklang reicht ein Sandkasten mit
// gefaelschtem AudioContext. `soundOn` ist dort immer an - geprueft wird der Klang, die
// Stummschaltung haengt an derselben go()-Weiche wie bei jedem anderen Spielklang.
function mkKlang() {
  const ctx = mkCtx();
  ctx.createBuffer = (ch, len, sr) => ({ length: len, getChannelData: () => new Float32Array(len) });
  ctx.sampleRate = 44100;
  const fensterl = { AudioContext: function () { return ctx; } };
  const SFXm = new Function('soundOn', 'window', 'performance', 'setTimeout', 'fetch',
    DNA_SRC + NL + SFX_SRC + NL + 'return SFX;')(
    true, fensterl, { now: () => 0 }, (fn) => 0, () => Promise.reject(new Error('kein Netz')));
  return {
    SFX: SFXm, ctx: ctx,
    advance: (sek) => ctx.advance(sek),
    reset: () => { ctx.advance(5); },
    toene: (fn) => { const m = ctx.all.length; fn(); return alleToene(ctx.all.slice(m)); },
  };
}

// ── 9. Ohne Nutzergeste bleibt es still ─────────────────────────────────────
{
  const e = mkEnv();
  let threw = null;
  try { e.M.set('menu', 0); e.M.set('match', 1); e.M.launch(1); e.M.goal(true); e.M.result(true); }
  catch (err) { threw = err; }
  ok(!threw, 'ohne entsperrten Context wirft nichts (' + (threw ? threw.message : 'sauber') + ')');
  ok(e.ctx.all.length === 0, 'und es entsteht kein einziger Audioknoten');
  ok(e.timers() === 0, 'auch kein Zeitgeber');
  ok(e.M.live() === false && e.M.scene() === 'off', 'die Schicht meldet sich als nicht aufgebaut');
  ok(e.M.pos() === null, 'und es gibt noch keine Stelle im Stueck');
  e.unlock();
  e.M.set('menu', 0);
  ok(e.M.live() === true, 'nach dem Entsperren baut derselbe Aufruf sie auf');
  ok(e.M.scene() === 'menu' && e.timers() === 1, 'die Menuebesetzung laeuft mit einem Zeitgeber');
  ok(!/new\s*\(?\s*window\.AudioContext/.test(MUSIC_SRC) && !/new AudioContext/.test(MUSIC_SRC),
     'die Schicht erzeugt keinen eigenen AudioContext');
  ok(/ctxRunning\(\)\{return c&&c\.state==='running'\?c:null;\}/.test(HTML),
     'und SFX gibt ihn nur heraus, wenn er laeuft');
  const acCount = (HTML.match(/new\(window\.AudioContext\|\|window\.webkitAudioContext\)/g) || []).length;
  ok(acCount === 1, 'im ganzen Produkt gibt es genau EINE Context-Erzeugung');
  // PASS 03C - DIE URSACHE, warum das Menuethema frueher erst nach dem ersten
  // Spielstart begann: die Entsperrung hing an EINEM pointerdown mit {once:true}. Die
  // erste Geste auf der scrollbaren Startseite ist aber oft ein Wischen, und ein Wischen
  // erteilt nicht in jedem Browser eine Audiofreigabe. Scheiterte dieser eine Versuch,
  // meldete sich der Zuhoerer trotzdem ab - und nichts versuchte es je wieder.
  ok(!/\{once:true\}/.test(HTML.slice(HTML.indexOf('MOBILE-AUTOPLAY'),
                                       HTML.indexOf('MOBILE-AUTOPLAY') + 900)),
     'die Entsperrung haengt nicht mehr an einem EINZIGEN Versuch');
  ok(/const GESTEN=\['pointerdown','touchend','keydown','click'\];/.test(HTML),
     'sie horcht auf mehrere Gestenarten');
  ok(/if\(SFX\.ctxRunning&&SFX\.ctxRunning\(\)\)\n\s*for\(const g of GESTEN\)window\.removeEventListener\(g,versuch,true\);/.test(HTML),
     'und meldet sich erst ab, wenn der Context TATSAECHLICH laeuft');
  ok(/window\.addEventListener\(g,versuch,true\);/.test(HTML),
     'in der Capture-Phase - kein Handler kann den Versuch abfangen');
  ok((HTML.match(/new\(window\.AudioContext\|\|window\.webkitAudioContext\)/g) || []).length === 1,
     'und es entsteht dabei weiterhin nur EIN AudioContext');
  // Vor der Geste bleibt es still - daran aendert sich nichts.
  ok(/unlock\(\)\{if\(soundOn\)try\{ac\(\);\}catch\(e\)\{\}\},/.test(HTML),
     'der Versuch selbst bleibt ein blosses ac() - kein Autoplay-Trick');
}

// ── 10. Die Menuemusik traegt die Figur ─────────────────────────────────────
// Hier lernt der Spieler das Thema. Also muss der Ruf hier hoerbar sein - und zwar ohne
// Schlagzeug, das ihn zudeckt.
{
  const e = mkEnv(); e.unlock();
  e.M.set('menu', 0);
  const m = e.marke();          // NACH dem Aufbau: die Arenaluft ist Teil des Betts, kein Anschlag
  e.advance(9000);
  const neu = e.seit(m), f = toene(neu);
  ok(enthaelt(f, KOMP.T.E4), 'im Menue erklingt der erste Ton des Rufs (E4)');
  ok(enthaelt(f, KOMP.T.G4) && enthaelt(f, KOMP.T.A4), 'und seine Fortsetzung (G4, A4)');
  ok(enthaelt(f, KOMP.T.C5) && enthaelt(f, KOMP.T.B4), 'auch die Antwort (C5, B4)');
  // PASS 03C: der zweite Puls gehoert ins Menue - genau er traegt den Rhythmus.
  ok(rauschen(neu) > 0, 'und der zweite Puls laeuft mit (' + rauschen(neu) + ' Anschlaege)');
  ok(e.M.voices() <= VOICE_CAP, 'das Stimmenbudget haelt (' + e.M.voices() + ')');
}

// ── 11. Menue -> Lobby -> Match: dieselbe Uhr, andere Besetzung ─────────────
// Das ist der Kern von Pass 03B. Die Stelle im Stueck darf bei KEINEM Wechsel
// zurueckspringen, und der Graph darf kein zweites Mal aufgebaut werden.
{
  const e = mkEnv(); e.unlock();
  e.M.set('menu', 0);
  const master0 = e.masterNode();
  e.advance(6000); const p1 = e.M.pos();
  e.M.set('lobby', 0); e.advance(4000); const p2 = e.M.pos();
  e.M.set('match', 0.5); e.advance(5000); const p3 = e.M.pos();
  e.M.set('menu', 0); e.advance(3000); const p4 = e.M.pos();     // Ergebnisfenster
  e.M.set('match', 1); e.advance(4000); const p5 = e.M.pos();    // Rematch
  const folge = [p1, p2, p3, p4, p5].map(p => p.elapsed);
  let steigt = true;
  for (let i = 1; i < folge.length; i++) if (folge[i] <= folge[i - 1]) steigt = false;
  ok(steigt, 'die Uhr laeuft ueber alle Wechsel hinweg monoton weiter (' +
     folge.map(v => v.toFixed(1)).join(' -> ') + ' s)');
  ok(near(folge[4], 22, 0.6), 'sie zaehlt die echte Zeit');
  ok(p5.step === Math.floor(p5.elapsed / RASTER.STEP) % RASTER.TOTAL,
     'die Stelle im Stueck folgt exakt aus der Uhr (Schritt ' + p5.step + ')');
  ok(p5.cycles >= 0, 'die Form hat sich ' + p5.cycles + ' mal wiederholt');
  ok(e.masterNode() === master0, 'der Graph wurde dabei GENAU EINMAL aufgebaut');
  ok(e.timers() === 1, 'und es laeuft weiterhin genau ein Zeitgeber');
  ok(e.M.live() === true, 'die Schicht steht ununterbrochen');
}

// ── 12. Die Besetzung wechselt tatsaechlich ─────────────────────────────────
{
  const e = mkEnv(); e.unlock();
  e.M.set('menu', 0); e.advance(500);
  let m = e.marke(); e.advance(9000); const imMenue = e.seit(m);
  e.M.set('lobby', 0);
  m = e.marke(); e.advance(9000); const inLobby = e.seit(m);
  e.M.set('match', 1);
  m = e.marke(); e.advance(9000); const imMatch = e.seit(m);
  const treu = figurStimmt(e, imMatch);
  ok(treu.geprueft >= 8, 'ueber mehrere Zellen hinweg wurden viele Toene geplant (' +
     treu.geprueft + ')');
  ok(treu.falsch === 0 && treu.leer === 0,
     'und alle stehen genau dort, wo die Notentabelle sie hinschreibt');
  // PASS 03C: der zweite Puls - Zaehlung und volles Kickmuster - ist genau das, was den
  // Rhythmus traegt. Er gehoert deshalb ins MENUE, nicht erst ins Match. Die DICHTE ist
  // ueberall dieselbe; unterschieden wird nur der Pegel.
  ok(rauschen(imMenue) > 0, 'das Menue hat den zweiten Puls (' + rauschen(imMenue) + ')');
  ok(rauschen(inLobby) > 0 && rauschen(imMatch) > 0, 'Lobby und Match ebenfalls');
  const hoch = Math.max(imMenue.length, inLobby.length, imMatch.length);
  const tief = Math.min(imMenue.length, inLobby.length, imMatch.length);
  ok(hoch / tief <= 1.2, 'und die Dichte ist in allen drei Szenen praktisch dieselbe (' +
     imMenue.length + ' / ' + inLobby.length + ' / ' + imMatch.length + ')');
  for (const paar of [['Menue', imMenue], ['Lobby', inLobby], ['Match', imMatch]]) {
    const f = toene(paar[1]);
    ok(enthaelt(f, KOMP.T.E4) && enthaelt(f, KOMP.T.A4),
       'der Ruf laeuft auch in der Besetzung ' + paar[0]);
  }
  ok(/const SCHICHT=\{/.test(MUSIC_SRC) && /const SZENE=\{/.test(MUSIC_SRC),
     'es gibt EINE Besetzung und daneben eine reine Pegeltabelle - kein zweites Stueck');
  const sched = grabFunction(MUSIC_FLAT, 'scheduleStep');
  ok(!/scene/.test(sched.replace(/\/\/[^\n]*/g, '')),
     'der Planer selbst kennt die Szene gar nicht - er spielt immer dasselbe Stueck');
}

// ── 13. Ein Schuss fasst das Stueck nicht an ────────────────────────────────
{
  const e = mkEnv(); e.unlock();
  e.M.set('match', 1); e.advance(7000);
  const vor = e.M.pos();
  for (let i = 0; i < 30; i++) { e.M.launch(1); e.M.hero(1); }
  const nach = e.M.pos();
  ok(vor.step === nach.step && vor.cell === nach.cell,
     'dreissig Abschuesse veraendern die Stelle im Stueck nicht');
  ok(near(vor.elapsed, nach.elapsed, 1e-9), 'und auch die Uhr nicht');
  ok(e.timers() === 1, 'der Zeitgeber laeuft unveraendert');
  for (const paar of [['launch', 'pwr'], ['hero', 'mag'], ['goal', ''], ['result', 'win']]) {
    const n = paar[0];
    const q = grabIn(new RegExp(n + '\\(' + paar[1] + '\\)\\{[\\s\\S]*?\\n    \\},'),
                     'Akzent ' + n);
    for (const verboten of ['nextT', 'startT', 'align(', 'scheduleStep', 'pluck(', 'FORM', 'step=']) {
      ok(q.indexOf(verboten) < 0, n + '() beruehrt ' + verboten + ' nicht');
    }
  }
  ok(/const HERO_MS=260;/.test(MUSIC_SRC), 'der Ballakzent hat eine Sperrzeit von 260 ms');
  const m = e.marke();
  for (let i = 0; i < 20; i++) e.M.hero(1);
  ok(e.seit(m).length <= 2, 'zwanzig Heldentreffer in einem Bild ergeben hoechstens einen Ton');
}

// ── 14. Das Tor: kurz zurueck, dann weiter an derselben Stelle ──────────────
{
  const e = mkEnv(); e.unlock();
  e.M.set('match', 1); e.advance(8000);
  const vor = e.M.pos();
  const m = e.marke();
  e.M.goal();
  // PASS 03C: der motivische Akzent liegt im TORKLANG (s. Abschnitt 23c), nicht mehr hier -
  // er muss auch dann erklingen, wenn die Musik ausgeschaltet ist. Das Thema duckt nur.
  ok(toene(e.seit(m)).length === 0, 'das Thema spielt beim Tor keinen eigenen Ton');
  ok([KOMP.T.E5 / KOMP.T.E4, KOMP.T.G5 / KOMP.T.G4, KOMP.T.A5 / KOMP.T.A4]
       .every(v => near(v, 2, 0.01)),
     'die Toene des Torklangs sind exakt der Ruf eine Oktave hoeher');
  e.advance(4000);
  const nach = e.M.pos();
  ok(nach.elapsed > vor.elapsed, 'das Stueck laeuft danach weiter');
  ok(nach.step === Math.floor(nach.elapsed / RASTER.STEP) % RASTER.TOTAL,
     'und zwar an genau der Stelle, an der es ohnehin stuende - kein Neustart nach dem Tor');
  ok(e.M.scene() === 'match', 'die Szene bleibt dieselbe');
  ok(e.timers() === 1, 'der Zeitgeber wurde nie angehalten');
  ok(/hold\(duck\.gain,0\.16,0\.05,t\);/.test(MUSIC_SRC),
     'das Thema tritt STARK zurueck - auf ein Sechstel');
  ok(/duck\.gain\.setTargetAtTime\(1,t\+GOAL_DUCK,0\.35\);/.test(MUSIC_SRC),
     'und kommt von selbst wieder - kein Zustand, der haengen bleiben kann');
}

// ── 15. Ergebnis und Rematch ────────────────────────────────────────────────
// Kein fremdes Siegeslied: die ANTWORT der Figur, langsam. Danach laeuft das Thema
// weiter - der Rematch findet es an der richtigen Stelle vor.
{
  const e = mkEnv(); e.unlock();
  e.M.set('match', 1); e.advance(10000);
  const m = e.marke();
  e.M.result(true);
  const akkord = toene(e.seit(m));
  ok(enthaelt(akkord, KOMP.T.C5) && enthaelt(akkord, KOMP.T.B4) &&
     enthaelt(akkord, KOMP.T.G4) && enthaelt(akkord, KOMP.T.A4),
     'die Aufloesung ist die Antwort der Figur: C B G A');
  ok(gleich(KOMP.ANTWORT.map(n => n[1]), [KOMP.T.C5, KOMP.T.B4, KOMP.T.G4, KOMP.T.A4]),
     'also genau die Toene, die im Stueck ohnehin stehen');
  ok(e.timers() === 1, 'das Matchende haelt den Rhythmus NICHT an');
  ok(e.M.live() === true, 'und baut nichts ab');
  const vor = e.M.pos();
  e.M.set('menu', 0); e.advance(3000);      // Ergebnisfenster
  e.M.set('match', 1); e.advance(3000);     // Rematch
  const nach = e.M.pos();
  ok(nach.elapsed > vor.elapsed && e.timers() === 1, 'der Rematch setzt auf demselben Stueck auf');
  ok(nach.step === Math.floor(nach.elapsed / RASTER.STEP) % RASTER.TOTAL,
     'an der Stelle, an der die Uhr steht - nicht bei Takt 1');
  ok(e.M.voices() <= VOICE_CAP, 'das Stimmenbudget haelt (' + e.M.voices() + ')');
}

// ── 16. Musik aus und wieder an ─────────────────────────────────────────────
{
  const e = mkEnv(); e.unlock();
  e.M.set('match', 1); e.advance(5000);
  e.M.stop();
  ok(e.timers() === 0, 'AUS haelt sofort an');
  ok(e.M.scene() === 'off', 'und meldet sich als aus');
  e.advance(2500);
  ok(e.ctx.live.size === 0, 'nach der Ausblende ist der Graph leer (' + e.ctx.live.size + ')');
  ok(e.M.live() === false, 'die Schicht ist abgebaut');
  ok(e.M.voices() === 0, 'keine Stimme bleibt zurueck');
  e.M.set('menu', 0);
  const m = e.marke();          // NACH dem Aufbau: das Bett ist Aufbau, nicht Anschlag
  ok(e.M.live() === true && e.timers() === 1, 'AN baut sauber neu auf');
  e.advance(3000);
  const ersteToene = toene(e.seit(m));
  ok(enthaelt(ersteToene, KOMP.T.E4),
     'und das Stueck beginnt an seinem Anfang - mit dem Ruf, nicht mit seiner Antwort');
  ok(ersteToene.length > 0 && Math.abs(ersteToene[0] - KOMP.T.E4) < 0.5,
     'der allererste Ton nach dem Einschalten IST der Ruf (' + ersteToene[0].toFixed(1) + ' Hz)');
  ok(/function run\(\)\{if\(timer\)return;align\(true\);timer=setInterval/.test(MUSIC_SRC),
     'jeder Einstieg rastet auf einen Takt ein');
  ok(/if\(toBar\)k=Math\.ceil\(k\/BAR\)\*BAR;/.test(MUSIC_SRC), 'und zwar auf den naechsten');
  e.M.stop(); e.advance(80); e.M.set('menu', 0); e.advance(2500);
  ok(e.M.live() === true && e.timers() === 1,
     'ein schnelles AUS/AN ueberlebt den bestellten Abbau');
  ok(/const g0=\+\+stopGen;/.test(MUSIC_SRC) &&
     /if\(g0===stopGen&&scene==='off'\)teardown\(\);/.test(MUSIC_SRC),
     'die Entwertung ist als Generationszaehler umgesetzt');
}

// ── 17. RingOut: still, aber die Uhr laeuft weiter ──────────────────────────
// Genau das macht "ein durchlaufendes Produkt" aus: wer zwischendurch ein Bot-Spiel
// macht, findet das Thema danach an der richtigen Stelle vor - nicht bei Takt 1.
{
  const e = mkEnv(); e.unlock();
  e.M.set('menu', 0); e.advance(5000);
  const vor = e.M.pos();
  const master0 = e.masterNode();
  e.M.set('off', 0);
  ok(e.timers() === 0, 'im RingOut-Spiel laeuft kein Zeitgeber');
  const m = e.marke();
  e.advance(12000);
  ok(e.seit(m).length === 0, 'und es entsteht kein einziger Klang');
  ok(e.M.live() === true, 'der Aufbau bleibt aber stehen - es ist eine Pause, kein Ende');
  const m2 = e.marke();
  e.M.set('menu', 0);
  const nach = e.M.pos();
  ok(nach.elapsed - vor.elapsed >= 11.9,
     'die Uhr ist waehrenddessen weitergelaufen (+' + (nach.elapsed - vor.elapsed).toFixed(1) + ' s)');
  ok(e.masterNode() === master0, 'und der Graph wurde nicht neu gebaut');
  ok(e.timers() === 1, 'der Zeitgeber ist zurueck');
  // Und das Entscheidende: es spielt DORT weiter, wo die Uhr steht - nicht wieder am
  // Anfang der Figur. Geprueft wird an dem, was tatsaechlich geplant wurde.
  e.advance(6000);
  const pruef = figurStimmt(e, e.seit(m2));
  ok(pruef.geprueft > 0, 'nach dem Wiedereinstieg wurden Toene der Figur geplant (' +
     pruef.geprueft + ')');
  ok(pruef.falsch === 0, 'und JEDER steht an der Stelle, die die Uhr vorgibt (' +
     pruef.falsch + ' Abweichungen)');
  ok(pruef.leer === 0, 'an Stellen ohne Figur klingt auch keine (' + pruef.leer + ')');
}

// ── 18. Hintergrundtab ──────────────────────────────────────────────────────
{
  const e = mkEnv(); e.unlock();
  e.M.set('match', 1); e.advance(4000);
  e.M.setDark(true);
  ok(e.timers() === 0, 'im Hintergrundtab laeuft kein Zeitgeber');
  const m = e.marke();
  e.advance(8000);
  ok(e.seit(m).length === 0, 'und entsteht kein einziger neuer Knoten');
  ok(e.M.live() === true, 'der Aufbau bleibt stehen');
  e.M.setDark(false);
  ok(e.timers() === 1, 'bei der Rueckkehr laeuft er wieder');
  const m2 = e.marke();
  e.advance(60);
  ok(e.seit(m2).length <= 24, 'und es wird nichts nachgeholt (' + e.seit(m2).length + ')');
  e.M.setDark(false);
  ok(e.timers() === 1, 'ein zweites "sichtbar" aendert nichts');
  ok(/document\.addEventListener\('visibilitychange'/.test(HTML),
     'das Produkt haengt an visibilitychange');
  ok(/FBMUSIC\.setDark\(h\)/.test(HTML), 'und meldet die Sichtbarkeit an die Musik');
  ok(/collapseHidden==='function'\)\?collapseHidden\(\)/.test(HTML),
     'mit derselben Sichtbarkeitspruefung wie der Collapse-Timer');
}

// ── 19. Kein Nachholen, egal wie gross die Luecke ───────────────────────────
{
  for (const luecke of [0.45, 3, 45, 600]) {
    const e = mkEnv(); e.unlock();
    e.M.set('match', 1); e.advance(1500);
    const m = e.marke();
    e.jump(luecke);
    e.advance(60);
    const neu = e.seit(m).length;
    // Ein Vorlauf von 0.5 s umfasst gut zwei Schritte; mehr als eine Handvoll Knoten
    // darf ein einzelner Lauf nicht erzeugen. Nachgeholt wuerden bei 600 s ueber 2500.
    ok(neu <= 24, 'nach ' + luecke + ' s Uhrsprung entstehen nur wenige Knoten (' + neu + ')');
    const zeiten = Array.from(new Set(e.ctx.srcs.map(n => n.t0).filter(v => v != null)))
      .sort((a, b) => a - b);
    let engste = Infinity;
    for (let i = 1; i < zeiten.length; i++) engste = Math.min(engste, zeiten[i] - zeiten[i - 1]);
    ok(!(engste < 0.20), 'und keine zwei Schritte fallen zusammen (' +
       (engste === Infinity ? 'nur einer' : engste.toFixed(3)) + ')');
    ok(e.M.voices() <= VOICE_CAP, 'das Stimmenbudget haelt');
  }
  ok(/if\(nextT<now\)align\(false\);/.test(MUSIC_SRC),
     'ein Ausreisser rastet neu ein, statt aufzuholen');
  ok(!/if\(nextT<now\)\{align\(false\);return;\}/.test(MUSIC_SRC),
     'und der verspaetete Lauf PLANT danach weiter - sonst waere er wirkungslos');
  ok(!/Math\.max\(nextT,now/.test(MUSIC_SRC), 'faellige Schritte werden nie zusammengeklemmt');
}

// ── 19b. Ein haengender Hauptfaden darf nicht verstummen ────────────────────
// Der Befund aus dem echten Browser: faellt der Zeitgeber staendig zu spaet - auf einem
// Telefon, dessen Hauptfaden die 3D-Szene traegt, ist das der Normalfall -, dann muss der
// verspaetete Lauf trotzdem PLANEN. Ein Lauf, der nur neu einrastet und zurueckkehrt,
// bleibt wirkungslos; aus lauter solchen Laeufen wird Stille.
{
  for (const ruckel of [60, 120, 250]) {
    const e = mkEnv(); e.unlock();
    e.M.set('match', 1);
    e.advance(1000, ruckel);
    const a0 = e.M.pos();
    e.advance(12000, ruckel);          // zwoelf Sekunden mit gedehntem Zeitgeber
    const a1 = e.M.pos();
    const gespielt = a1.sched - a0.sched;
    const erwartet = (a1.elapsed - a0.elapsed) / RASTER.STEP;
    ok(gespielt > 0, 'bei ' + ruckel + ' ms Ruckeln wird ueberhaupt geplant (' + gespielt + ')');
    ok(gespielt >= erwartet * 0.8,
       'und zwar fast jeder Schritt (' + gespielt + ' von ' + erwartet.toFixed(0) + ')');
    ok(gespielt <= erwartet * 1.05,
       'aber keiner doppelt - es wird nichts nachgeholt (' + gespielt + ')');
    const pruef = figurStimmt(e, e.ctx.all);
    ok(pruef.falsch === 0 && pruef.leer === 0,
       'und die Figur steht trotz Ruckeln an der richtigen Stelle');
  }
}

// ── 19c. Die Rehydrierung schaltet das Thema SOFORT ab ─────────────────────
// fastForwardMatch() blockiert den Hauptfaden: waehrend die Historie durchlaeuft, kommt
// KEIN Bildlauf. Wer sich darauf verlaesst, dass der naechste Bildlauf die Szene
// umstellt, laesst Bett und Arenaluft durch die ganze Rehydrierung weiterklingen - und
// ein faelliger Planerlauf kann danach noch Schritte der alten Szene planen.
{
  const ff = grabFunction(HTML, 'fastForwardMatch');
  // Die volle Aufrufform, nicht nur der Name: eine abgehaengte Zeile enthaelt den Namen
  // ebenfalls und wuerde eine blosse Namenszaehlung ueberleben.
  const AUFRUF = "if(typeof fbMusicSync==='function')fbMusicSync();";
  const rufe = ff.split(AUFRUF).length - 1;
  ok(rufe === 2, 'die Rehydrierung zieht das Thema zweimal mit (' + rufe + ')');
  const iStumm = ff.indexOf('fbFxSilence(true)');
  const iErster = ff.indexOf(AUFRUF);
  const iTry = ff.indexOf('try{');
  ok(iStumm >= 0 && iErster > iStumm && iErster < iTry,
     'der erste Aufruf steht direkt hinter der Stummschaltung, VOR dem Durchlauf');
  const iFinally = ff.indexOf('} finally {');
  const iZweiter = ff.indexOf(AUFRUF, iFinally);
  ok(iZweiter > iFinally, 'der zweite gibt es gemeinsam mit Klang und Bild wieder frei');
  ok(ff.indexOf('fbFxSilence(fx)') < iZweiter,
     'und zwar in derselben Reihenfolge wie die beiden anderen Schichten');

  // Der zeitliche Ablauf mit einem LAUFENDEN Graphen: Lobbymusik spielt, die Historie
  // laeuft durch (Uhr laeuft, kein Zeitgeberlauf), danach das Match.
  const e = mkEnv(); e.unlock();
  e.M.set('lobby', 0); e.advance(4000);
  ok(e.M.running() === true, 'vor dem Rejoin laeuft die Lobbymusik');
  e.M.set('off', 0);                       // genau das tut der erste fbMusicSync()
  ok(e.M.running() === false, 'die Rehydrierung haelt den Planer sofort an');
  const m = e.marke();
  e.jump(6);                               // sechs Sekunden blockierter Hauptfaden
  ok(e.seit(m).length === 0, 'waehrend der blockierten Zeit entsteht kein Klang');
  e.M.set('match', 0.5);                   // der zweite fbMusicSync() nach dem finally
  e.advance(3000);
  ok(e.M.running() === true, 'danach laeuft das Thema in der Matchbesetzung weiter');
  const pruef = figurStimmt(e, e.seit(m));
  ok(pruef.falsch === 0 && pruef.leer === 0,
     'und zwar an der Stelle, an der die Uhr inzwischen steht - nicht am Anfang');
}

// ── 20. Eine lange Sitzung ──────────────────────────────────────────────────
// Nicht der erste Aufbau ist die Frage, sondern die halbe Stunde danach: dreissig
// Wechsel durch Menue, Lobby, Match, Tor, Ergebnis, Rematch und RingOut.
{
  const e = mkEnv(); e.unlock();
  e.M.set('menu', 0);
  const master0 = e.masterNode();
  let maxLive = 0, maxVoices = 0;
  for (let i = 0; i < 30; i++) {
    e.M.set('menu', 0); e.advance(800);
    e.M.set('lobby', 0); e.advance(800);
    e.M.set('match', (i % 21) / 20); e.advance(1500);
    e.M.launch(0.9); e.M.hero(0.8); e.M.goal(i % 5 === 0);
    e.advance(1500);
    e.M.result(i % 2 === 0);
    e.advance(1200);
    if (e.ctx.live.size > maxLive) maxLive = e.ctx.live.size;
    if (e.M.voices() > maxVoices) maxVoices = e.M.voices();
    e.M.set('off', 0); e.advance(600);
  }
  ok(e.masterNode() === master0, 'nach dreissig Durchlaeufen steht derselbe Graph');
  ok(maxLive <= 60, 'die Spitze der lebenden Knoten bleibt klein (' + maxLive + ')');
  ok(maxVoices <= VOICE_CAP, 'das Stimmenbudget wurde nie ueberschritten (' + maxVoices + ')');
  ok(e.timers() === 0, 'am Ende laeuft kein Zeitgeber');
  e.M.stop(); e.advance(2500);
  ok(e.ctx.live.size === 0, 'der Abbau leert den Graphen vollstaendig (' + e.ctx.live.size + ')');
  ok(e.M.voices() === 0, 'und laesst keine Stimme zurueck');
}

// ── 21. Der Stimmenzaehler gehoert dem Aufbau ───────────────────────────────
// Der stille Totalausfall: eine Stimme meldet sich nie zurueck, der Zaehler steigt, und
// ab der Obergrenze plant die Schicht gar nichts mehr.
{
  const e = mkEnv(); e.unlock();
  e.M.set('match', 1);
  e.ctx.swallow = true;
  e.advance(8000);
  const stecken = e.M.voices();
  ok(stecken > 0 && stecken <= VOICE_CAP,
     'haengende Stimmen laufen auf und werden gedeckelt (' + stecken + ')');
  ok(/const LOOKAHEAD=0\.50, TIMER_MS=25, MAX_VOICES=32, VOICE_HEADROOM=8;/.test(MUSIC_SRC),
     'die weiche Grenze steht als Zahl im Code');
  ok(0.50 / 0.025 >= 15,
     'und der Vorlauf deckt mindestens fuenfzehn Zeitgeberlaeufe ab - Reserve fuer ein langsames Geraet');
  const m = e.marke();
  e.advance(4000);
  ok(e.seit(m).length === 0, 'am Anschlag plant die Schicht nichts mehr - der Ausfallfall');
  e.M.stop(); e.advance(1500);
  e.ctx.swallow = false;
  e.M.set('menu', 0);
  ok(e.M.voices() === 0, 'der neue Aufbau startet mit einem frischen Zaehler');
  const m2 = e.marke();
  e.advance(4000);
  ok(e.seit(m2).length > 0, 'und plant wieder - das Thema kommt zurueck');
  ok(/const b0=build0;/.test(MUSIC_SRC) && /if\(b0===build0&&voices>0\)voices--;/.test(MUSIC_SRC),
     'die Bindung an den Aufbau steht im Code');
  ok(/c=cc;build0\+\+;voices=0;/.test(MUSIC_SRC), 'und jeder Aufbau setzt den Zaehler zurueck');
}

// ── 22. Genau ein Zeitgeber ─────────────────────────────────────────────────
{
  const e = mkEnv(); e.unlock();
  e.M.set('menu', 0);
  for (let i = 0; i < 300; i++) e.M.set(['menu', 'lobby', 'match', 'off'][i % 4], (i % 21) / 20);
  ok(e.timers() <= 1, 'auch nach 300 Szenenwechseln hoechstens einer (' + e.timers() + ')');
  e.M.set('match', 1);
  ok(e.timers() === 1, 'und im Match genau einer');
  ok(/function run\(\)\{if\(timer\)return;/.test(MUSIC_SRC),
     'der Aufbau ist im Code gegen einen zweiten Zeitgeber gesperrt');
  const siCount = (MUSIC_SRC.match(/setInterval\(/g) || []).length;
  ok(siCount === 1, 'es gibt genau eine setInterval-Stelle (' + siCount + ')');
}

// ── 23. Die Mischung ────────────────────────────────────────────────────────
{
  const MASTER = parseFloat((MUSIC_SRC.match(/const MASTER=([\d.]+);/) || [])[1]);
  const AMB = parseFloat((MUSIC_SRC.match(/const AMB=([\d.]+);/) || [])[1]);
  const TOR = parseFloat((HTML.match(/const FOOTBALL_GOAL_ASSET_GAIN=([\d.]+);/) || [])[1]);
  ok(MASTER > 0 && MASTER <= 0.4, 'der Musterpegel ist zurueckhaltend (' + MASTER + ')');
  ok(MASTER < TOR, 'und liegt deutlich unter dem Torklang (' + MASTER + ' < ' + TOR + ')');
  ok(AMB > 0 && AMB <= 0.03, 'die Arenaluft ist fast unhoerbar (' + AMB + ')');
  const B = new Function(grabIn(/const SCHICHT=\{[^}]*\};/, 'Schichten') + NL +
    grabIn(/const SZENE=\{[^}]*\};/, 'Szenenpegel') + NL + 'return {SCHICHT,SZENE};')();
  ok(B.SCHICHT.hat > 0 && B.SCHICHT.kick > 0 && B.SCHICHT.bass > 0,
     'es gibt EINE Besetzung, und sie hat den zweiten Puls');
  ok(B.SCHICHT.motif >= 0.28, 'die Figur steht darin weit vorn (' + B.SCHICHT.motif + ')');
  // PASS 03C: das Menue ist die Markenfassung, das Match tritt zurueck.
  ok(B.SZENE.menu === 1.00, 'das Menue spielt die Musik in voller Hoehe');
  ok(B.SZENE.match >= 0.70 && B.SZENE.match <= 0.80,
     'im Match tritt sie auf ' + Math.round(B.SZENE.match * 100) + ' % zurueck (Ziel 70-80 %)');
  ok(B.SZENE.lobby >= 0.90 && B.SZENE.lobby <= 1.00,
     'die Lobby liegt dazwischen (' + Math.round(B.SZENE.lobby * 100) + ' %)');
  ok(B.SZENE.menu > B.SZENE.match,
     'die Spielklaenge sitzen damit im Match klar vor der Musik');
  // Aber die RHYTHMISCHE Identitaet ist ueberall dieselbe - nur der Pegel unterscheidet.
  const sched2 = grabFunction(MUSIC_FLAT, 'scheduleStep');
  ok(/if\(KICK\[k\]\)kick\(/.test(sched2) && /if\(HAT\[k\]\)hat\(/.test(sched2) &&
     /if\(BASS\[k\]\)bass\(/.test(sched2),
     'der Planer spielt in jeder Szene dasselbe Muster');
  ok(!/spieltKick|spieltHat|spieltBass/.test(MUSIC_SRC),
     'es gibt keine szenenabhaengige Dichte mehr');
  const Z = new Function(grabIn(/const ZUSCHLAG=\{[^}]*\};/, 'Zuschlag') + NL + 'return ZUSCHLAG;')();
  ok(Z.kick > Z.motif * 3,
     'der Zuschlag bei zwei Spielern trifft das Schlagwerk, kaum die Melodie - dasselbe Lied, ernster');
  ok(/g\.connect\(master\);/.test(grabIn(/launch\(pwr\)\{[\s\S]*?\n    \},/, 'Abschussakzent')),
     'der Abschussakzent haengt am Master, nicht am geduckten Zweig');
  ok(/gAmb=cc\.createGain\(\);gAmb\.gain\.value=0\.0001;gAmb\.connect\(master\);/.test(MUSIC_SRC),
     'die Atmosphaere haengt neben dem Duck - der Raum faellt beim Tor nicht zusammen');
}

// ── 23b. Jede Pegelaenderung haelt ihren aktuellen Wert fest ────────────────
// cancelScheduledValues allein laesst offen, auf welchen Wert ein Parameter zurueckfaellt.
// Erst das Festhalten macht den naechsten Uebergang in jedem Browser stetig - sonst wird
// aus einer weichen Ausblende ein Sprung.
{
  const h = grabFunction(MUSIC_FLAT, 'hold').split(NL).map(l => l.trim()).join('|');
  ok(h.indexOf('p.cancelScheduledValues(t);|p.setValueAtTime(p.value,t);|' +
               'p.setTargetAtTime(v,t,tc);') >= 0,
     'es gibt genau eine Halte-Paarung: loeschen, FESTHALTEN, neues Ziel');
  const roh = (MUSIC_SRC.match(/cancelScheduledValues\(/g) || []).length;
  ok(roh === 1, 'cancelScheduledValues steht nur in dieser einen Paarung (' + roh + ')');
  const nutzer = (MUSIC_SRC.match(/hold\(/g) || []).length;
  ok(nutzer >= 9, 'und sie wird ueberall benutzt (' + nutzer + ' Stellen)');
}

// ── 23c. DER TORKLANG: eine Energieentladung, die die Figur zitiert ────────
// Ein Tor soll nach Arena Football klingen und nicht nach irgendeinem Tor. Deshalb sind
// die Toene des Torklangs woertlich die des Rufs, und sein Instrument ist dasselbe.
{
  const st = grabFunction(SFX_FLAT, 'goalSting');
  // Die fuenf Schichten.
  ok(/wo\.frequency\.setValueAtTime\(132,t\);/.test(st) &&
     /wo\.frequency\.exponentialRampToValueAtTime\(42,t\+0\.09\);/.test(st),
     '1 GEWICHT: ein kurzer, tiefer Anschlag (132 -> 42 Hz in 90 ms)');
  ok(/rb\.frequency\.exponentialRampToValueAtTime\(4200,t\+0\.24\);/.test(st),
     '2 ENTLADUNG: das Rauschen steigt in 240 ms auf');
  ok(/to\.frequency\.setValueAtTime\(FB_MOTIF\.A4\/4,t\+0\.02\);/.test(st) &&
     /to\.frequency\.exponentialRampToValueAtTime\(FB_MOTIF\.A4,t\+0\.22\);/.test(st),
     '  und der Ton steigt mit ihm von A2 auf A4 - ein Ton der Figur, kein beliebiger');
  ok(/glanz\.frequency\.value=FB_MOTIF\.A4\*FB_TIMBRE\.partial;/.test(st),
     '3 GLANZ: derselbe inharmonische Oberton wie im Instrument des Themas');
  ok(440 * 5.42 < 7000, '  und er liegt unter 7 kHz - auf einem Telefon hell, nicht schrill');
  ok(/const frag=mp\?\[FB_MOTIF\.E5,FB_MOTIF\.G5,FB_MOTIF\.A5,FB_MOTIF\.C6\]/.test(st) &&
     /:\[FB_MOTIF\.E5,FB_MOTIF\.G5,FB_MOTIF\.A5\];/.test(st),
     '4 FIGUR: E G A - der Anfang des Rufs, beim Matchpunkt mit einem Ton mehr');
  ok(/fbPluckVoice\(c,sg,t\+0\.10\+k\*0\.085,frag\[k\],0\.34,0\.30,Math\.random,halte\);/.test(st),
     '  gespielt mit DEMSELBEN Instrument wie das Thema');
  ok(/eg\.gain\.exponentialRampToValueAtTime\(0\.0006,t\+\(mp\?1\.25:0\.95\)\);/.test(st),
     '5 NACHKLANG: 0.95 s, beim Matchpunkt 1.25 s - im vorgegebenen Band');

  // Die Toene sind woertlich die des Rufs.
  ok(near(KOMP.RUF[0][1] * 2, KOMP.T.E5, 0.02) && near(KOMP.RUF[2][1] * 2, KOMP.T.G5, 0.02) &&
     near(KOMP.RUF[3][1] * 2, KOMP.T.A5, 0.02),
     'E5 G5 A5 sind exakt der Ruf eine Oktave hoeher');

  // Er ist der lauteste Klang des Spiels - und haengt NICHT an der Musik.
  const GG = Number((HTML.match(/const FB_GOAL_GAIN=([\d.]+);/) || [])[1]);
  const MP = Number((HTML.match(/const FB_GOAL_MP_MUL=([\d.]+);/) || [])[1]);
  ok(GG >= 0.6 && GG <= 0.8, 'der Torklang ist der lauteste Klang des Spiels (' + GG + ')');
  ok(MP > 1 && MP <= 1.1, 'der Matchpunkt hebt nur leicht an (+' + Math.round((MP - 1) * 100) + ' %)');
  const MASTER = parseFloat((MUSIC_SRC.match(/const MASTER=([\d.]+);/) || [])[1]);
  ok(GG > MASTER * 1.8, 'und liegt deutlich ueber der Musik (' + GG + ' gegen ' + MASTER + ')');
  ok(!/musicOn/.test(st) && !/FBMUSIC/.test(st),
     'er klingt auch dann, wenn die Musik ausgeschaltet ist - er ist Spielklang, nicht Musik');

  // Das Stockasset ist nicht geloescht, sondern abgeregelt: der Whoosh stammt aus
  // derselben Quelle wie die Arena-Transitionen und liess ein Tor klingen wie ein Umbau.
  const MIX = Number((HTML.match(/const FOOTBALL_GOAL_ASSET_MIX=([\d.]+);/) || [])[1]);
  ok(MIX === 0, 'das fruehere Stockasset liegt still (' + MIX + ')');
  ok(/loadFootballGoalAsset/.test(HTML) && /footballGoalStop\(\)\{/.test(HTML),
     'sein Lade- und Stoppweg bleibt aber vollstaendig erhalten - nichts wurde entfernt');
  ok(/if\(FOOTBALL_GOAL_ASSET_MIX<=0\)return;/.test(HTML),
     'und ein Wert ueber null legt es sofort wieder unter die Signatur');

  // ── Und jetzt angehoert: das Klangmodul wird woertlich ausgefuehrt. ──
  const K = mkKlang();
  const f0 = K.toene(() => K.SFX.fbGoalSting(false));
  ok(enthaelt(f0, KOMP.T.E5) && enthaelt(f0, KOMP.T.G5) && enthaelt(f0, KOMP.T.A5),
     'gespielt erklingen E5 G5 A5 - der Ruf');
  ok(!enthaelt(f0, KOMP.T.C6), 'beim normalen Tor ohne den vierten Ton');
  ok(enthaelt(f0, 132), 'dazu das Gewicht bei 132 Hz');
  ok(enthaelt(f0, KOMP.T.A4 * 5.42), 'und der Glanz auf dem inharmonischen Oberton (2384 Hz)');
  ok(f0.some(v => v > 7000) === false, 'nichts davon liegt ueber 7 kHz - auf dem Telefon hell, nicht schrill');
  const f1 = K.toene(() => K.SFX.fbGoalSting(true));
  ok(enthaelt(f1, KOMP.T.C6), 'der Matchpunkt bekommt den aufloesenden Ton dazu');
  ok(enthaelt(f1, KOMP.T.E5) && enthaelt(f1, KOMP.T.A5),
     'behaelt aber dieselbe Identitaet - kein anderer Klang');
  // Der Weg zum Ausgang muss stehen, bis die LETZTE Schicht durch ist. Die kuerzeste
  // Stimme des Stings endet nach 40 ms, die Figur beginnt erst nach 100 ms: wer den
  // gemeinsamen Ausgang an die erste beendete Stimme koppelt, macht das Tor unhoerbar.
  K.reset();
  const mA = K.ctx.all.length;
  K.SFX.fbGoalSting(false);
  const neuA = K.ctx.all.slice(mA);
  const figur = neuA.filter(n => n.kind === 'osc' &&
    [KOMP.T.E5, KOMP.T.G5, KOMP.T.A5].some(fr => Math.abs(n.frequency.value - fr) < 0.5));
  ok(figur.length >= 3, 'die Figur des Torklangs steht als Stimmen bereit (' + figur.length + ')');
  ok(figur.every(n => erreichtAusgang(K.ctx, n)), 'und ihr Weg zum Ausgang steht');
  K.advance(0.07);            // der kurze Anschlag ist durch - die Figur noch lange nicht
  ok(figur.every(n => erreichtAusgang(K.ctx, n)),
     'er steht auch noch, nachdem die kuerzeste Stimme beendet ist');
  K.advance(0.35);            // die Figur klingt
  ok(figur.some(n => erreichtAusgang(K.ctx, n) || n.t1 <= K.ctx.currentTime),
     'die Figur hat den Ausgang erreicht, statt ins Leere zu spielen');
  ok(/if\(v\.g&&!v\.geteilt\)try\{v\.g\.disconnect\(\);\}catch\(e\)\{\}/.test(HTML),
     'ein geteilter Ausgang wird nicht von einer Einzelstimme getrennt');
  ok(/if\(--offen<=0\)\{try\{sg\.disconnect\(\);\}catch\(e\)\{\}\}/.test(HTML),
     'sondern erst von der letzten');
  K.advance(2.0);
  ok(K.ctx.live.size === 0, 'und danach ist der Graph leer (' + K.ctx.live.size + ')');

  // Er raeumt hinter sich auf, auch nach vielen Toren.
  K.reset();
  for (let i = 0; i < 40; i++) { K.SFX.fbGoalSting(i % 4 === 0); K.advance(2.0); }
  K.advance(3.0);
  ok(K.ctx.live.size === 0, 'nach vierzig Toren haengt kein Knoten mehr am Graphen (' +
     K.ctx.live.size + ')');
  // Und der Weg ins Menue blendet einen laufenden Torklang weich aus.
  K.SFX.fbGoalSting(false);
  K.advance(0.05);
  const offen = K.ctx.srcs.length;
  K.SFX.footballGoalStop();
  ok(offen > 0 && K.ctx.srcs.every(n => n.t1 <= K.ctx.currentTime + 0.2),
     'footballGoalStop() holt jede Stimme der Signatur herunter (' + offen + ')');
  K.advance(3.0);
  ok(K.ctx.live.size === 0, 'und der Graph ist danach leer');

  // Genau EIN Klang je Tor, an der kanonischen Stelle - und keiner aus der Historie.
  const gs = (HTML.match(/goalSting\(matchPoint\);/g) || []).length;
  ok(gs === 2, 'die Signatur wird an genau zwei Stellen ausgeloest: Torklang und Dev-Probe (' + gs + ')');
  ok(/function goalSting\(matchPoint\)\{\n\s*go\(c=>\{/.test(HTML),
     'sie laeuft durch go() - waehrend einer Rehydrierung ist soundOn false, also still');
  // Und das Thema traegt den Akzent NICHT mehr doppelt.
  const mg = grabIn(/goal\(\)\{[\s\S]*?\n    \},/, 'Musik-Tor');
  ok(!/frag|E5|createOscillator/.test(mg),
     'das Thema spielt beim Tor keinen eigenen Akzent mehr - sonst klaenge die Figur doppelt');
  ok(/hold\(duck\.gain,0\.16,0\.05,t\);/.test(mg), 'es tritt stattdessen STARK zurueck');
}

// ── 24. Kein Spielzustand, kein Protokoll, kein simHash ─────────────────────
{
  for (const w of ['score', 'phase', 'balls', 'fbGoalState', 'fbElimLives', 'fbElimActive',
                   'turnNo', 'footballWinner', 'roomCode']) {
    ok(!new RegExp(w + '\\s*=[^=]').test(MUSIC_SRC), 'die Musikschicht schreibt nicht in ' + w);
  }
  ok(!/simHash/.test(MUSIC_SRC), 'sie kennt simHash ueberhaupt nicht');
  ok(!/window\.FB|firebase|rRef\(/.test(MUSIC_SRC), 'und weder Firebase noch das Online-Protokoll');
  ok(!/Math\.random/.test(MUSIC_SRC),
     'ihr Zufall ist ein eigener Zaehler - er kann keine Simulation beruehren');
  ok(/function mRnd\(\)\{seed=\(seed\*1664525\+1013904223\)>>>0;/.test(MUSIC_SRC),
     'und ist ein einfacher, gekapselter Zaehler');
  for (const n of ['fbMusicAllowed', 'fbMusicScene', 'fbMusicIntensity', 'fbMusicSync',
                   'fbMusicAccentOk', 'fbMusicLaunch', 'fbMusicHero', 'fbMusicGoal',
                   'fbMusicResult', 'fbMusicStop', 'fbMusicLobbyOpen']) {
    const q = grabFunction(HTML, n);
    ok(!/\b(score|phase|balls|fbGoalState|fbElimLives|fbElimActive|turnNo|footballWinner)\s*=[^=]/.test(q),
       n + ' schreibt keinen Spielzustand');
  }
  ok(!/[Mm]usic|FBMUSIC/.test(grabFunction(HTML, 'simHash')), 'simHash kennt die Musik nicht');
}

// ── 25. Die Ereignisse haengen an den kanonischen Stellen ───────────────────
{
  ok(/if\(typeof fbMusicLaunch==='function'\)fbMusicLaunch\(pwr\);/
       .test(grabFunction(HTML, 'fbSfxLaunch')),
     'der Abschussakzent haengt am selben Ereignis wie der Abschussklang');
  const goalHooks = (HTML.match(
    /if\(typeof fbMusicGoal==='function'\)fbMusicGoal\(\);/g) || []).length;
  ok(goalHooks === 2, 'beide Torwege melden das Tor (' + goalHooks + ')');
  ok(/if\(typeof fbMusicHero==='function'\)fbMusicHero\(mag\);/.test(HTML),
     'der Ballakzent haengt am Kontakt Figur/Ball');
  ok(/if\(typeof fbMusicResult==='function'\)fbMusicResult\(true\);/.test(HTML),
     'das Matchende mit Sieger loest auf');
  ok(/if\(typeof fbMusicResult==='function'\)fbMusicResult\(false\);/.test(HTML),
     'das Matchende ohne Teilnehmer ebenfalls');
}

// ── 26. Die Einstellung ─────────────────────────────────────────────────────
{
  ok(/<div class="pills" id="musicGrp"/.test(HTML), 'das Einstellungsfenster hat eine Musikzeile');
  ok(/<button id="musicOnBtn">ON<\/button><button id="musicOffBtn">OFF<\/button>/.test(HTML),
     'mit derselben Pillenform wie Vibration');
  ok(/musicLbl:'Music'/.test(HTML) && /musicLbl:'Musik'/.test(HTML) && /musicLbl:'Müzik'/.test(HTML),
     'die Beschriftung existiert in allen drei Sprachen');
  ok(/localStorage\.getItem\('ringout_music'\)/.test(HTML), 'die Wahl wird gelesen');
  ok(/localStorage\.setItem\('ringout_music',on\?'1':'0'\)/.test(HTML), 'und gemerkt');
  ok(/if\(!on&&typeof fbMusicStop==='function'\)fbMusicStop\(\);/.test(HTML),
     'OFF heisst sofort still');
  ok(/'musicOnBtn','musicOffBtn'/.test(HTML), 'die Knoepfe haben das uebliche Klickfeedback');
  const muteHooks = (HTML.match(
    /SFX\.fbTransitionStop\(\);if\(typeof fbMusicStop==='function'\)fbMusicStop\(\);/g) || []).length;
  ok(muteHooks === 2, 'beide Stummschalter nehmen die Musik mit (' + muteHooks + ')');
}

console.log(NL + 'Football-Musik: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
