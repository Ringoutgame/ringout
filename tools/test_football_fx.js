// ARENA FOOTBALL — EFFEKTSCHICHT (Action-Feel 02)
//
// Zwei Fragen an die neue Bildsprache:
//   1. Bleibt sie beschraenkt? Auch nach minutenlangem Dauerbeschuss darf die Effektliste
//      weder wachsen noch Speicher halten - das Spiel laeuft auf Telefonen.
//   2. Bleibt sie Ausgabe? Kein Effekt darf Spielzustand lesen, schreiben oder erzeugen,
//      und waehrend einer Rehydrierung darf ueberhaupt nichts aufblitzen.
//
// Der Effektcode wird WOERTLICH aus index.html uebernommen und in einem Sandkasten
// ausgefuehrt - kein Nachbau.
const { loadIndexHtml, grab: grabFrom } = require('./extract.js');
const HTML = loadIndexHtml();
const grab = (re, name) => grabFrom(HTML, re, name);

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.error('FAIL: ' + msg)); };

console.log('ARENA FOOTBALL - EFFEKTSCHICHT: BESCHRAENKT UND OHNE SPIELZUSTAND\n');

// ── Der Sandkasten: nur die Effektsprache, sonst nichts ──────────────────────
// Seit 2026-09-23 endet die Effektsprache mit fx3Glint: das Wandlicht (fx3Wall) und seine
// Bandenabtastung sind mit dem dekorativen Bandeneffekt entfernt.
const fxSrc = grab(/const FX3_MAX=140;[\s\S]*?\nfunction fx3Glint\(x,y,mag,rgb,dec\)\{[\s\S]*?\}\);\}/, 'Effektsprache');
const updSrc = grab(/if\(fx3\.length\)\{for\(const f of fx3\)[^\n]*\n/, 'fx3-Fortschreibung');
const env = new Function(`
  let fx3=[];
  const BR=32;
  ${fxSrc}
  function tick(){ ${updSrc} }
  return { fx3:()=>fx3, len:()=>fx3.length, tick,
           push:(o)=>fx3Push(o), hit:fx3Hit, shock:fx3Shock, flash:fx3Flash,
           sparks:fx3Sparks, glint:fx3Glint, max:FX3_MAX,
           reset:()=>{fx3=[];} };
`)();

// ── 1. Die Obergrenze haelt ──────────────────────────────────────────────────
{
  env.reset();
  for (let i = 0; i < 5000; i++) env.push({ t: 5, x: 0, y: 0, life: 1, dec: .01, mag: 1, rgb: '1,2,3' });
  ok(env.len() === env.max, 'die Liste wird bei ' + env.max + ' Eintraegen gedeckelt (erhalten ' + env.len() + ')');
  ok(env.max <= 200, 'die Obergrenze ist telefontauglich klein (' + env.max + ')');
}

// ── 2. Dauerbeschuss: viele Ereignisse, konstante Obergrenze ─────────────────
// Nachgestellt werden mehrere Minuten Spiel: Abschuesse, Bandentreffer, Ballschlaege und
// Figurenkontakte, dazwischen immer die normale Fortschreibung.
{
  env.reset();
  let maxLen = 0;
  for (let frame = 0; frame < 20000; frame++) {           // ~5.5 Minuten bei 60 fps
    if (frame % 7 === 0) env.sparks(0, 0, 1, 0, 0.9, '10,20,30', 7, 1.5);
    if (frame % 11 === 0) { env.flash(0, 0, 1, '10,20,30'); env.shock(0, 0, 1, '10,20,30'); }
    if (frame % 5 === 0) env.hit(0, 0, 0.7);
    env.tick();
    if (env.len() > maxLen) maxLen = env.len();
  }
  ok(maxLen <= env.max, 'auch unter Dauerbeschuss bleibt die Liste gedeckelt (Spitze ' + maxLen + ')');
  // Und sie raeumt sich wieder leer, sobald nichts mehr passiert.
  for (let i = 0; i < 400; i++) env.tick();
  ok(env.len() === 0, 'nach dem Abklingen ist die Liste leer (' + env.len() + ')');
}

// ── 3. Jeder Effekt ist kurzlebig ───────────────────────────────────────────
{
  env.reset();
  env.sparks(0, 0, 1, 0, 1, '1,2,3', 8, 1.5); env.flash(0, 0, 1, '1,2,3');
  env.shock(0, 0, 1, '1,2,3'); env.hit(0, 0, 1);
  let n = 0;
  while (env.len() > 0 && n < 600) { env.tick(); n++; }
  ok(env.len() === 0, 'alle Formen verschwinden von selbst');
  ok(n / 60 <= 0.6, 'die laengste Form lebt hoechstens 0.6 s (' + (n / 60).toFixed(2) + ' s)');
}

// ── 4. Die Effekte fassen keinen Spielzustand an ─────────────────────────────
{
  const namen = ['fx3Push', 'fx3Hit', 'fx3Shock', 'fx3Flash', 'fx3Sparks', 'fx3Launch',
                 'fbFeelBallHit', 'fbFeelPlayers', 'fbGlowOwner', 'fbBallAccent'];
  for (const n of namen) {
    const i = HTML.indexOf('function ' + n + '(');
    ok(i >= 0, 'die Effektschicht kennt ' + n);
    if (i < 0) continue;
    const q = HTML.slice(i, HTML.indexOf('\n}', i) + 2);
    ok(!/\b[ab]\.(?:vx|vy|x|y|spin|alive|owner)\s*=/.test(q), n + ' schreibt keinen Kugelzustand');
    ok(!/\b(?:score|fbGoalState|fbElimLives|fbElimActive|footballWinner|phase|turnNo|balls)\s*=[^=]/.test(q),
       n + ' schreibt keinen Spielzustand');
  }
}

// ── 5. Stufen: der Mikrokontakt bleibt unsichtbar ───────────────────────────
{
  const tierSrc = grab(/const FB_FX_T1=[^\n]*\nfunction fbFxTier[^\n]*\n/, 'Stufen');
  const tier = new Function(tierSrc + 'return fbFxTier;')();
  ok(tier(0.02) === 0 && tier(0.10) === 0, 'Mikrokontakte erzeugen gar nichts');
  ok(tier(0.25) === 1, 'ein normaler Kontakt ist Stufe 1');
  ok(tier(0.50) === 2, 'ein kraeftiger Kontakt ist Stufe 2');
  ok(tier(0.90) === 3, 'ein Heldentreffer ist Stufe 3');
  ok(tier(0.62) === 3 && tier(0.61) === 2, 'die Schwelle zur Heldenstufe liegt fest');
}

// ── 6. Rehydrierung und Wiedergabe bleiben dunkel ───────────────────────────
{
  const gate = HTML.match(/function fbFxOn\(\)\{[^\n]*\n/)[0];
  ok(/mode==='football'/.test(gate), 'die Effekte gelten nur im Football-Modus');
  ok(/!fbFxMute/.test(gate), 'waehrend der Rehydrierung ist die Bildsprache stumm');
  ok(/!replaying/.test(gate), 'und waehrend einer Wiedergabe ebenfalls');
  const ff = HTML.match(/function fastForwardMatch\([^)]*\)\{[\s\S]*?\n\}/)[0];
  ok(/fbFxSilence\(true\)/.test(ff), 'die Rehydrierung schaltet die Bildsprache aktiv stumm');
  ok(/soundOn=false/.test(ff), 'und den Klang wie bisher');
  ok(/finally\s*\{[\s\S]*?fbFxSilence\(fx\)/.test(ff),
     'beides wird auch bei einem Abbruch wieder freigegeben');
  ok(/finally\s*\{[\s\S]*?fx3=\[\]/.test(ff), 'und die Effektliste wird geleert');
}

// ── 7. RingOut bleibt unberuehrt ────────────────────────────────────────────
{
  ok(/const ballMat=PCOLS\.map\(mkBallMat\);/.test(HTML),
     'RingOut behaelt seinen eigenen Materialsatz ohne Eigenleuchten');
  const mk = HTML.match(/const mkBallMat=pc=>new THREE\.MeshPhysicalMaterial\(\{[^}]*\}\);/)[0];
  ok(!/emissive/.test(mk), 'das RingOut-Material hat kein Eigenleuchten');
  // Der Football-Satz hat ein Eigenleuchten - das im RUHEZUSTAND auf null steht und
  // damit nichts beitraegt. Premium ist der Moment, nicht die Kugel.
  const iFB = HTML.indexOf('const mkBallMatFB=pc=>{');
  const mkFB = iFB < 0 ? '' : HTML.slice(iFB, HTML.indexOf(String.fromCharCode(10) + '    };', iFB));
  ok(/emissive:pc\.m3,emissiveIntensity:FB_EMIS_REST/.test(mkFB),
     'das Football-Material hat ein Eigenleuchten fuer die Aktion');
  ok(/const FB_EMIS_REST=0\.0,/.test(HTML),
     'im Ruhezustand traegt es nichts bei (Ruhewert 0)');
  ok(/color:pc\.m3,map:ballTex/.test(mkFB),
     'und der Grundton ist im Ruhezustand der gewohnte - nicht abgedunkelt');
  ok(/m\.userData\.fbBase=new THREE\.Color\(pc\.m3\);/.test(mkFB),
     'die Ruhefarbe liegt als Bezugspunkt am Material');
  ok(/else m\.material\.color\.copy\(m\.material\.userData\.fbBase\);/.test(HTML),
     'ohne Aufladung wird exakt auf die Ruhefarbe zurueckgesetzt');
  // Der neutrale Ball teilt sich das dunkle RingOut-Material - er bleibt schwarz.
  ok(/p5Mat,ballMat\[4\]\];/.test(HTML), 'der neutrale Ball behaelt das bisherige dunkle Material');
  // Und die Emissivsteuerung greift nur im Football-Modus und nie am Ball.
  ok(/if\(mode==='football'&&b\.owner!==FOOTBALL_NEUTRAL_OWNER&&m\.material\.userData\.fbBase\)\{/.test(HTML),
     'das Eigenleuchten wird nur fuer Football-Spielerkugeln gesetzt');
}

// ── 7b. Die Reaktion erreicht den Renderer wirklich ─────────────────────────
// Materialglanz und Ballsaum leben im Renderer-Scope; die Ereignisschicht kommt nur
// ueber das oeffentliche r3d-Objekt an sie heran. Ohne diesen Weg bliebe beides
// wirkungslos - das Material stuende fuer immer auf dem Ruhewert.
{
  ok(/setGlow\(o,mag\)\{fbSetGlow\(o,mag\);\},/.test(HTML), 'der Materialglanz hat eine Schreibluke');
  ok(/setBallAccent\(mag\)\{fbSetBallAccent\(mag\);\},/.test(HTML), 'der Ballsaum ebenso');
  ok(/function fbGlowOwner\(o,mag\)\{ if\(r3d&&typeof r3d\.setGlow==='function'\)/.test(HTML),
     'und die Ereignisschicht benutzt genau diese Luke');
  ok(/function fbBallAccent\(mag\)\{ if\(r3d&&typeof r3d\.setBallAccent==='function'\)/.test(HTML),
     'auch fuer den Ballsaum');
}

// ── 7c. Keine doppelte Rueckmeldung auf einem Kontakt ───────────────────────
{
  ok(/function footballResolvePost\(b,emit\)\{/.test(HTML),
     'die Sockelaufloesung weiss, ob sie melden darf');
  ok(/footballResolvePost\(fb,ci===1\|\|it===0\)/.test(HTML),
     'sie meldet hoechstens einmal je Micro-Step');
  ok(/footballResolvePost\(fb,false\)/.test(HTML), 'die Nachkorrektur meldet nie');
  const fl = HTML.slice(HTML.indexOf('function fbFeelLaunch('));
  ok(/if\(fbFxMute\|\|replaying\)return;/.test(fl.slice(0, 400)),
     'auch der Abschusseffekt schweigt bei Rehydrierung und Wiedergabe');
}

// ── 7d. Kein dekorativer Bandeneffekt mehr (2026-09-23) ─────────────────────
// Auf Wunsch des Besitzers entfernt: nach dem Schuss erschienen an der Bande blau-weiss-rote
// Funken (fbFeelWall: Wandlicht, Blitz, Ring, Glanz und Splitter in Spielerfarbe bzw. Weiss
// fuer den Ball). Der Klang des Bandenabprallers bleibt - er ist Spielrueckmeldung.
{
  for (const weg of ['function fbFeelWall(', 'function fx3Wall(', 'function fbWallPath(', 'function fbWallSD(', 'FB_WALL_SEG'])
    ok(HTML.indexOf(weg) < 0, 'entfernt: ' + weg.replace('function ', '').replace('(', ''));
  ok(HTML.indexOf('fbFeelWall(') < 0, 'kein Aufruf des Bandeneffekts mehr in stepSim');
  ok(/fbSfxImpact\(Math\.min\(1,fvn\/5\),900\+balls\.indexOf\(fb\),'band'\);\}/.test(HTML),
     'der Bandenabpraller klingt weiterhin');
  ok(HTML.indexOf('t:6,') < 0, 'kein Effekt vom Typ Wandlicht wird mehr erzeugt');
  // Die uebrigen Rueckmeldungen bleiben unberuehrt.
  for (const bleibt of ['function fbFeelBallHit(', 'function fbFeelPlayers(', 'function fx3Launch('])
    ok(HTML.indexOf(bleibt) >= 0, 'unveraendert vorhanden: ' + bleibt.replace('function ', '').replace('(', ''));
}

// ── 9. PASS 02C: Licht statt Glitzer ────────────────────────────────────────
// Der weisse Sternglanz ist ab jetzt die Ausnahme: er gehoert dem Ballhelden, dem harten
// Bandentreffer des Balls. Alltagskontakte bekommen ihn nicht mehr.
{
  const koerper = (n) => { const i = HTML.indexOf('function ' + n + '(');
    return i < 0 ? '' : HTML.slice(i, HTML.indexOf(String.fromCharCode(10) + '}', i)); };
  // Reine Textzaehlung - kein Regex, damit Klammern im Suchbegriff nichts bedeuten.
  const zaehl = (q, was) => { let n = 0, i = 0;
    for (;;) { const j = q.indexOf(was, i); if (j < 0) break; n++; i = j + was.length; }
    return n; };

  const spieler = koerper('fbFeelPlayers');
  ok(zaehl(spieler, 'fx3Glint(') === 0, 'Figur gegen Figur funkelt gar nicht mehr');
  ok(zaehl(spieler, 'fx3Sparks(') <= 2, 'und wirft hoechstens je einen farbigen Splitter');
  ok(/fx3Flash\(x,y,mag\*\.6,fbRgb\(o1\)\)/.test(spieler),
     'stattdessen ein kurzer Kontaktblitz in den beiden Spielerfarben');
  ok(/fbGlowOwner\(o1,mag\*\.6\); fbGlowOwner\(o2,mag\*\.6\);/.test(spieler),
     'und beide Kugeln hellen kurz auf');

  const held = koerper('fbFeelBallHit');
  ok(zaehl(held, 'fx3Glint(') === 1, 'der Ballheld bekommt genau EINEN Glanz');
  ok(/fx3Sparks\(x,y,dx,dy,mag,col,2,0\.9\)/.test(held), 'und genau zwei gerichtete Splitter');
  ok(/fbGlowOwner\(owner,1\)/.test(held), 'der Angreifer laedt sich dabei voll auf');
  ok(/fbBallAccent\(mag\)/.test(held), 'und der Ball bekommt seinen Saum');

  // Pfostentreffer: die weissen Funken im Torbereich sind entfernt, der Klang bleibt.
  ok(HTML.indexOf('fbFeelPost') < 0, 'entfernt: fbFeelPost samt beiden Aufrufen');
  ok(zaehl(HTML, "fbSfxImpact(Math.min(1,-vn/5),700+balls.indexOf(b),'post')") === 2,
     'beide Pfostenpfade klingen weiterhin');

  const abschuss = koerper('fx3Launch');
  ok(zaehl(abschuss, 'fx3Glint(') === 0, 'der Abschuss funkelt nicht mehr weiss');
  ok(zaehl(abschuss, 'fx3Sparks(') === 0, 'und wirft keine Funkenfaecher mehr');
  ok(zaehl(abschuss, 'fx3Shock(') === 2, 'stattdessen zwei farbige Hoefe');
  ok(/fbGlowOwner\(owner,\.45\+\.55\*m\)/.test(abschuss), 'und die Kugel selbst laedt sich auf');
  ok(/const n=1\+Math\.round\(m\*2\);/.test(abschuss), 'der Staubkegel ist ausgeduennt');
}

// ── 10. Der Bewegungsstrich ─────────────────────────────────────────────────
// Er entsteht direkt aus der Geschwindigkeit, nicht aus Partikeln: nichts zu verwalten,
// nichts zu recyceln, unterhalb der Schwelle gar nichts.
{
  ok(/const FB_TRAIL_V=2\.2, FB_TRAIL_FULL=6\.0;/.test(HTML),
     'der Strich hat eine Einsatz- und eine Vollschwelle');
  const i = HTML.indexOf('// ── BEWEGUNGSSTRICH (Action-Feel 02C) ──');
  ok(i >= 0, 'der Bewegungsstrich ist im Ausgabepfad umgesetzt');
  const q = HTML.slice(i, i + 2200);
  ok(/if\(v<FB_TRAIL_V\)continue;/.test(q), 'langsames Rollen zieht nichts');
  ok(/if\(neutral&&acc<=0\.05\)continue;/.test(q),
     'der neutrale Ball zieht nur nach einem wuchtigen Schlag mit');
  ok(/mode==='football'/.test(q), 'und das alles nur im Football-Modus');
  ok(!/fx3Push|fx3\.push/.test(q), 'der Strich legt keinen einzigen Effekteintrag an');
  ok(/for\(let i=0;i<3;i\+\+\)/.test(q), 'er besteht aus genau drei kurzen Abschnitten');
  ok(!/new [A-Z]/.test(q), 'und allokiert dabei nichts');
}

// ── 7e. Die Bot-Vorausberechnung klingt nicht (2026-09-24) ─────────────────
// Sie faehrt den echten stepSim auf Kopien; deren Banden- und Pfostenkontakte klangen als
// schnelle Klickserie nach jedem Schuss (im Spieltest: 444 von 467 Klangaufrufen).
{
  const quelle = grab(/function fbSfxImpact\(power,key,art\)\{[\s\S]*?\n\}/, 'fbSfxImpact');
  const gespielt = [];
  const lauf = (planung, art) => new Function('fbVorausAn', 'mode', 'SFX', quelle + '\nfbSfxImpact(0.8,1,"' + art + '");')(
    () => planung, 'football',
    { fbImpact: (p, k, a) => gespielt.push('fb:' + a), hit: () => gespielt.push('hit') });
  for (const art of ['band', 'post', 'ball', 'player']) lauf(true, art);
  ok(gespielt.length === 0, 'waehrend der Planung klingt kein Kontakt (' + gespielt.join(',') + ')');
  for (const art of ['band', 'post', 'ball', 'player']) lauf(false, art);
  ok(gespielt.join(',') === 'fb:band,fb:post,fb:ball,fb:player', 'im Spiel klingen alle vier Kontaktarten weiter (' + gespielt.join(',') + ')');
}

// ── 8. Kein zweites Kamerasystem, kein Postprocessing ───────────────────────
{
  ok((HTML.match(/function fbCamKick\(/g) || []).length === 1, 'es gibt genau EINEN Kameraimpuls');
  ok((HTML.match(/function fx3Launch\(/g) || []).length === 1, 'es gibt genau EINEN Abschusseffekt');
  ok(!/EffectComposer|UnrealBloomPass|RenderPass/.test(HTML),
     'kein Postprocessing-Stack fuer diesen Pass');
  // Entscheidend ist nicht, ob es irgendwo im Renderer ein Sprite gibt (die Wolken sind
  // einmalige Deko), sondern dass die EFFEKTSCHICHT selbst keine Szenenobjekte anlegt.
  const auszug = (n) => { const i = HTML.indexOf('function ' + n + '(');
    return i < 0 ? '' : HTML.slice(i, HTML.indexOf(String.fromCharCode(10) + '}', i) + 2); };
  const fxQuellen = ['fx3Push','fx3Hit','fx3Shock','fx3Flash','fx3Sparks','fx3Launch',
                     'fbFeelBallHit','fbFeelPlayers','drawFx3']
    .map(auszug).join(' ');
  ok(fxQuellen.length > 0 && !/new THREE\./.test(fxQuellen),
     'die Effektschicht legt kein einziges Three.js-Objekt an');
  ok(!/\.dispose\(\)/.test(fxQuellen),
     'und muss deshalb auch nichts freigeben - es gibt nichts zu lecken');
}

console.log('\nFootball-FX: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
