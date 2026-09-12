// MODUS UND KOERPER GEHOEREN ZUSAMMEN (Stability 01), RUHEND.
//
// Der Renderer zeichnet in jedem Bild genau das, was in balls steht, und holt fuer jede
// Figur ueber pcol(colorSlot(owner)) eine Farbe. Der neutrale Ball von Arena Football
// traegt den Besitzer 5 - und eine Farbe hat dieser Slot NUR, solange mode==='football':
// die globale Tafel hat fuenf Eintraege, die Football-Tafel sechs.
//
// Blieben die Koerper eines Modus stehen, waehrend der Modus wechselt, bekaeme drawBall
// also undefined statt einer Farbe. Die Ausnahme verlaesst dann die Bildschleife, das
// abschliessende requestAnimationFrame wird nie erreicht - und es wird NIE WIEDER
// gezeichnet. Kein Absturz mit Meldung, sondern ein eingefrorenes Bild.
//
// Diese Suite beweist die Zusage, die das verhindert: es gibt GENAU EINEN Weg, den
// Modus vor dem Match zu wechseln, und er stellt die Koerper im selben Schritt neu.
//
//   node test_mode_bodies.js
const { loadIndexHtml, grab, grabFunction } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) pass++;
  else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));

// ── Die echten Funktionen in eine Sandbox ───────────────────────────────────
// Gestellt werden nur die Groessen, auf die es fuer DIESE Frage nicht ankommt: wo eine
// Figur steht, ist hier gleichgueltig - WELCHEN BESITZER sie traegt, ist alles.
const QUELLE = [
  grab(HTML, /const PCOLS=\[[^\n]*/, 'PCOLS'),
  grab(HTML, /const FB_COL_P5=[^\n]*/, 'FB_COL_P5'),
  grab(HTML, /const FB_PCOLS=\[[^\n]*/, 'FB_PCOLS'),
  grab(HTML, /const FOOTBALL_NEUTRAL_OWNER=[^\n]*/, 'FOOTBALL_NEUTRAL_OWNER'),
  grab(HTML, /const FOOTBALL_TACTICAL_SPAWN=\{[\s\S]*?\};/, 'FOOTBALL_TACTICAL_SPAWN'),
  grab(HTML, /const FOOTBALL_TEAM2V2_PLAYERS=[^\n]*/, 'FOOTBALL_TEAM2V2_PLAYERS'),
  grabFunction(HTML, 'pcol'),
  grabFunction(HTML, 'colorSlot'),
  grabFunction(HTML, 'placeBalls'),
  grabFunction(HTML, 'fbVorspielKoerperOk'),
  grabFunction(HTML, 'setzeVorspiel')
].join('\n');

function bauen() {
  const kopf = [
    // Umgebung des Vorspiels. Positionen sind hier bedeutungslos.
    'let mode="bot", fmt="single", ffaN=3, gameStarted=false;',
    'let balls=[], R=1000, outBall=-1;',
    'const R0=1000, cx=0, cy=0, BR=10;',
    'function mkBall(x,y,o){return {x:x,y:y,vx:0,vy:0,owner:o,alive:true};}',
    // Die Football-Spielweisen als schlichte Schalter - geprueft wird ihre WIRKUNG auf
    // die Besitzer, nicht ihre eigene Logik.
    'let istElim=false, istTeam2=false, istTaktik=false, elimN=5;',
    'function fbElim4(){return istElim;}',
    'function fbElimPlayers(){return elimN;}',
    'function fbTeam2(){return istTeam2;}',
    'function fbTeam2Side(o){return o<2?0:1;}',
    'function fbTactical(){return istTaktik;}',
    'function fbElimSpawnX(o){return o;}',
    'function fbElimSpawnY(o){return o;}',
    'function fbArena(){return {spawn:6};}',
    'function teamOf(o){return o%2;}'
  ].join('\n');
  const fuss = [
    'return {',
    '  setze:(m,f,n)=>setzeVorspiel(m,f,n),',
    '  besitzer:()=>balls.map(b=>b.owner),',
    '  farben:()=>balls.map(b=>pcol(colorSlot(b.owner))),',
    '  stand:()=>({mode:mode,fmt:fmt,ffaN:ffaN,anzahl:balls.length,R:R,outBall:outBall}),',
    '  variante:(o)=>{istElim=!!o.elim;istTeam2=!!o.team2;istTaktik=!!o.taktik;if(o.n)elimN=o.n;},',
    '  laeuft:(v)=>{gameStarted=v;},',
    '  koerperSetzen:(bs)=>{balls=bs.map(o=>mkBall(0,0,o));},',
    '  raum:(v)=>{R=v;}, ausserhalb:(v)=>{outBall=v;}',
    '};'
  ].join('\n');
  return new Function([kopf, QUELLE, fuss].join('\n'))();
}

console.log('=== MODUS UND KOERPER GEHOEREN ZUSAMMEN (Stability 01) ===');

// ══ 1. DIE FARBE FEHLT WIRKLICH ═════════════════════════════════════════════
abschnitt('1. Ausserhalb von Arena Football hat der neutrale Ball keine Farbe');
{
  const S = bauen();
  // Die Ausgangslage des Fehlers, von Hand hergestellt: Football-Koerper, fremder Modus.
  S.koerperSetzen([0, 1, 5]);
  S.laeuft(true);              // ein laufendes Match wuerde nichts neu stellen
  S.setze('football', 'single');
  t('in Arena Football hat jede Figur eine Farbe', S.farben().every(f => !!f), JSON.stringify(S.farben().map(f => !!f)));
  S.setze('ffa', 'ffa');
  const ohne = S.farben().map(f => !!f);
  t('in Ring Out fehlt dem neutralen Ball die Farbe - das ist der Fehler', ohne[2] === false, JSON.stringify(ohne));
  t('... und nur ihm: die Spielerfarben gibt es in beiden Tafeln', ohne[0] === true && ohne[1] === true);
}

// ══ 2. DER EINE WEG STELLT DIE KOERPER MIT ══════════════════════════════════
abschnitt('2. Der eine Weg stellt die Koerper im selben Schritt neu');
{
  const S = bauen();
  // Arena Football, Lebensregel mit fuenf Startspielern - so sieht die Vorschau aus,
  // aus der heraus der Fehler ausgeloest wurde.
  S.variante({ elim: true, n: 5 });
  S.setze('football', 'elimination');
  t('Arena Football stellt fuenf Figuren und den neutralen Ball',
    S.besitzer().join(',') === '0,1,2,3,4,5', S.besitzer().join(','));
  t('... und alle sechs haben eine Farbe', S.farben().every(f => !!f));
  // Jetzt der Wechsel nach Ring Out - genau der, der die Bildschleife toetete.
  S.variante({ elim: false });
  S.setze('ffa', 'ffa', 5);
  t('nach dem Wechsel steht kein Besitzer 5 mehr da', S.besitzer().indexOf(5) < 0, S.besitzer().join(','));
  t('... und wieder hat jede Figur eine Farbe', S.farben().every(f => !!f), JSON.stringify(S.farben().map(f => !!f)));
  t('... der Modus ist wirklich gewechselt', S.stand().mode === 'ffa' && S.stand().fmt === 'ffa');
  t('... und die Spielerzahl mitgesetzt', S.stand().ffaN === 5);
}

// ══ 3. JEDER MODUSWECHSEL, DEN DAS VORSPIEL KENNT ═══════════════════════════
abschnitt('3. Jeder Wechsel des Vorspiels laesst gueltige Koerper zurueck');
{
  const S = bauen();
  // Die sechs Lagen der Menuevorschau plus die Onlinewege, in jeder Reihenfolge gegen
  // jede andere. Nach JEDEM Wechsel muss jede Figur eine Farbe haben.
  const LAGEN = [
    { nm: 'Ring Out FFA',        m: 'ffa',      f: 'ffa',        n: 5, v: {} },
    { nm: 'Triple FFA',          m: 'ffa',      f: 'triple_ffa', n: 3, v: {} },
    { nm: 'Team Duel',           m: 'ffa',      f: 'team_duel',  n: 4, v: {} },
    { nm: 'Versus',              m: 'online',   f: 'double',     n: 3, v: {} },
    { nm: 'Bot 1v1',             m: 'bot',      f: 'single',     n: 3, v: {} },
    { nm: 'Football Shell',      m: 'football', f: 'single',     n: 3, v: {} },
    { nm: 'Football Lives 5',    m: 'football', f: 'elimination', n: 3, v: { elim: true, n: 5 } },
    { nm: 'Football Lives 3',    m: 'football', f: 'elimination', n: 3, v: { elim: true, n: 3 } },
    { nm: 'Football Team 2v2',   m: 'football', f: 'team2v2',    n: 3, v: { team2: true } },
    { nm: 'Football Tactical',   m: 'football', f: 'single',     n: 3, v: { taktik: true } }
  ];
  let paare = 0, schlecht = [];
  for (const von of LAGEN) for (const nach of LAGEN) {
    S.variante({ elim: !!von.v.elim, team2: !!von.v.team2, taktik: !!von.v.taktik, n: von.v.n || 5 });
    S.setze(von.m, von.f, von.n);
    S.variante({ elim: !!nach.v.elim, team2: !!nach.v.team2, taktik: !!nach.v.taktik, n: nach.v.n || 5 });
    S.setze(nach.m, nach.f, nach.n);
    paare++;
    if (!S.farben().every(f => !!f)) schlecht.push(von.nm + ' -> ' + nach.nm + ' [' + S.besitzer().join(',') + ']');
  }
  t('alle ' + paare + ' Uebergaenge lassen gueltige Koerper zurueck', schlecht.length === 0, schlecht.slice(0, 4).join(' | '));
  t('... und kein Uebergang laesst die Koerper leer', S.stand().anzahl > 0);
}

// ══ 4. EIN LAUFENDES MATCH WIRD NICHT ANGEFASST ═════════════════════════════
abschnitt('4. Ein laufendes Match stellt seine Koerper selbst');
{
  const S = bauen();
  S.variante({ elim: true, n: 5 });
  S.setze('football', 'elimination');
  const vorher = S.besitzer().join(',');
  S.raum(777); S.ausserhalb(3);
  S.laeuft(true);
  S.setze('ffa', 'ffa', 5);
  t('waehrend eines Matches bleiben die Koerper unangetastet', S.besitzer().join(',') === vorher, S.besitzer().join(','));
  t('... auch die Plattformgroesse', S.stand().R === 777);
  t('... und die gefallene Kugel', S.stand().outBall === 3);
  t('der Modus folgt trotzdem dem Aufrufer', S.stand().mode === 'ffa' && S.stand().fmt === 'ffa');
  S.laeuft(false);
  S.setze('ffa', 'ffa', 5);
  t('nach dem Match werden sie wieder gestellt', S.besitzer().indexOf(5) < 0 && S.stand().R === 1000 && S.stand().outBall === -1);
}

// ══ 5. ES GIBT NUR DIESEN EINEN WEG ═════════════════════════════════════════
abschnitt('5. Es gibt nur diesen einen Weg');
{
  // Die Zusage ist nur so gut wie ihre Ausschliesslichkeit: kein Vorspielweg darf den
  // Modus an ihm vorbei setzen. Geprueft werden die Stellen, an denen genau das frueher
  // geschah - sie nennen jetzt alle denselben Weg.
  const stellen = [
    ["die Menuevorschau (Ring Out FFA)", "menuMode='ffa';fmtMenu='ffa';setzeVorspiel('ffa','ffa',5);"],
    ["die Menuevorschau (Triple)", "menuMode='ffa';fmtMenu='triple_ffa';setzeVorspiel('ffa','triple_ffa',3);"],
    ["die Menuevorschau (Team Duel)", "menuMode='ffa';fmtMenu='team_duel';setzeVorspiel('ffa','team_duel',4);"],
    ["die Menuevorschau (Versus)", "menuMode='online';fmtMenu='double';setzeVorspiel('online','double');"],
    ["die Menuevorschau (Arena Football)", "menuMode='football';fmtMenu='single';setzeVorspiel('football','single');"],
    ["die Menuevorschau (Bot)", "menuMode='bot';fmtMenu='single';setzeVorspiel('bot','single');"],
    ["der Hub-Knopf (FFA)", "setzeVorspiel('ffa','ffa');openOnline();return;"],
    ["der Hub-Knopf (Triple)", "setzeVorspiel('ffa','triple_ffa');openOnline();return;"],
    ["der Hub-Knopf (Team Duel)", "setzeVorspiel('ffa','team_duel');openOnline();return;"],
    ["die Startseite (Alle Raeume)", "$('homeViewAll').onclick=()=>{SFX.unlock();setzeVorspiel('ffa','ffa');openOnline();};"],
    ["die Startseite (Raum anlegen)", "$('homeCreate').onclick=()=>{SFX.unlock();setzeVorspiel('ffa','ffa');openOnline();};"],
    ["die Startseite (Code beitreten)", "$('homeJoinCode').onclick=()=>{SFX.unlock();setzeVorspiel('ffa','ffa');openOnline();"],
    ["die Startseite (Wiedereintritt)", "$('homeRejoin').onclick=()=>{SFX.unlock();setzeVorspiel('ffa','ffa');openOnline();};"],
    ["der Einstieg aus einer Raumzeile", "setzeVorspiel('ffa','ffa'); openOnline();"],
    ["der Austritt aus einem Raum", "setzeVorspiel(menuMode,fmtMenu,ffaNMenu);"],
    ["die Dev-Pille Bot", "menuMode='bot';setzeVorspiel('bot');"],
    ["die Dev-Pille 2 Spieler", "menuMode='pvp';setzeVorspiel('pvp');"],
    ["die Dev-Pille FFA", "menuMode='ffa';setzeVorspiel('ffa');"],
    ["die Dev-Pille Online", "menuMode='online';setzeVorspiel('online');"],
    ["der Beitritt (Football oder Ring Out)", "setzeVorspiel(mode,fmt);   // Kulisse der Lobby"]
  ];
  for (const [nm, txt] of stellen) t(nm + ' geht durch den einen Weg', HTML.indexOf(txt) > 0, txt.slice(0, 60));
  // Und die alten, unpaarigen Zuweisungen sind wirklich fort.
  for (const alt of ["mode='ffa';fmt='ffa';openOnline();", "mode='ffa'; fmt='ffa'; openOnline();",
                     "mode=menuMode; ffaN=ffaNMenu;", "mode=menuMode='ffa'"])
    t('die alte unpaarige Zuweisung "' + alt.slice(0, 34) + '…" ist fort', HTML.indexOf(alt) < 0);
  // Der Weg selbst raeumt auch die Plattform und die gefallene Kugel ab - genau die
  // beiden Zeilen, die die Menuevorschau frueher selbst trug.
  const weg = grabFunction(HTML, 'setzeVorspiel');
  t('der Weg stellt Plattformgroesse und Fallrest zurueck', /R=R0;outBall=-1;placeBalls\(\);/.test(weg));
  t('... und laesst ein laufendes Match in Ruhe', /if\(gameStarted\)return;/.test(weg));
  // Die Menuevorschau hat ihre eigene Kopie davon abgegeben.
  const vorschau = grabFunction(HTML, 'updateMenuPreview');
  t('die Menuevorschau haelt keine zweite Kopie mehr', vorschau.indexOf('placeBalls()') < 0);
  t('... und geht ausschliesslich ueber den einen Weg',
    (vorschau.match(/setzeVorspiel\(/g) || []).length === 6, (vorschau.match(/setzeVorspiel\(/g) || []).length);
}

// ══ 5b. UND DIE LISTE IST VOLLSTAENDIG ══════════════════════════════════════
abschnitt('5b. Jede Zuweisung an mode ist gezaehlt und begruendet');
{
  // Eine Aufzaehlung umgeschriebener Zeilen beweist nur, dass DIESE Zeilen stimmen -
  // nicht, dass es keine weitere gibt. Genau daran ist der erste Anlauf dieses Passes
  // gescheitert: vier Tueren blieben offen, weil niemand nach ihnen gesucht hatte.
  // Deshalb wird hier JEDE Zuweisung an `mode` gezaehlt. Kommt eine dazu, faellt sie
  // auf und muss begruendet werden - entweder geht sie durch den einen Weg, oder sie
  // fuehrt NACH Arena Football (dessen Tafel alle Farbslots kennt), oder ihr folgt
  // unmittelbar ein eigener Koerperaufbau.
  const zeilen = HTML.split("\n");
  const treffer = [];
  zeilen.forEach((z, i) => {
    const ohne = z.indexOf("//") >= 0 ? z.slice(0, z.indexOf("//")) : z;
    const re = /(^|[^.\w])mode\s*=(?!=)/g;
    let m;
    while ((m = re.exec(ohne))) {
      const vor = ohne.slice(0, m.index + m[1].length);
      if (/(menuMode|fbOnlineMode|fbRoomMode|onlineMode|roomMode)\s*$/.test(vor)) continue;
      treffer.push({ zeile: i + 1, text: z.trim() });
    }
  });
  // Die zwoelf bekannten Stellen, jede mit ihrem Grund.
  const ERWARTET = [
    ["die Anfangsbelegung beim Laden", "let mode='bot'"],
    ["Bot 1v1 - danach newGame()", "$('bot1v1')"],
    ["Bot 2v2 - danach newGame()", "$('bot2v2')"],
    ["lokaler Football-Start - nach Arena Football, danach newGame()", "mode=menuMode='football';fmt='single';online=false;"],
    ["der Arena-Onlineeinstieg - nach Arena Football", "mode='football'; fbVariant=FOOTBALL_VARIANT_ELIM; fmt=FB_ONLINE_FMT; fbElimStartN=0;"],
    ["der eine Weg selbst", "mode=m;"],
    ["der Rueckweg aus dem Onlinebildschirm - danach updateMenuPreview()", "const onlineBack=()=>{leaveOnline();mode=menuMode;"],
    ["der Arena-Matchstart - nach Arena Football", "mode='football'; fmt=FB_ONLINE_FMT; online=true;"],
    ["der Beitritt (Football-Zweig) - nach Arena Football", "if(joinFb){ mode='football'"],
    ["der Beitritt (Ring-Out-Zweig) - danach setzeVorspiel", "} else mode='ffa';"],
    ["der Beitritt zu einem 1v1/2v2-Raum - danach setzeVorspiel", "mode='online';   // Gast kann aus dem FFA-Menue"],
    ["der Wiedereintritt - danach setzeVorspiel", "mode=rjFb?'football':ffa?'ffa':'online';"]
  ];
  t("es gibt genau " + ERWARTET.length + " Zuweisungen an mode", treffer.length === ERWARTET.length,
    treffer.length + ": " + treffer.map(x => x.zeile).join(","));
  for (const [nm, txt] of ERWARTET)
    t("... darunter " + nm, treffer.some(x => x.text.indexOf(txt) >= 0), txt.slice(0, 50));
  // Und die drei Stellen, die den Modus VON Arena Football wegtragen koennen, tragen
  // den Koerperaufbau unmittelbar danach.
  const nachher = (marke) => {
    const i = HTML.indexOf(marke);
    return i > 0 && HTML.slice(i, i + 900).indexOf("setzeVorspiel(mode,fmt);") > 0;
  };
  t("der Beitritt stellt die Koerper unmittelbar danach", nachher("} else mode='ffa';"));
  t("der Beitritt zu einem 1v1/2v2-Raum ebenso", nachher("mode='online';   // Gast kann aus dem FFA-Menue"));
  t("der Wiedereintritt ebenso", nachher("mode=rjFb?'football':ffa?'ffa':'online';"));
  // Der Rueckweg in den festgehaltenen Kontext und das Bootangebot gehen durch den Weg.
  t("der Rueckweg in den Kontext geht durch den einen Weg",
    HTML.indexOf("setzeVorspiel(k.mode,k.fmt); openOnline();") > 0);
  t("das Rueckkehrangebot beim Seitenstart ebenso",
    HTML.indexOf("setzeVorspiel((fmt==='single'||fmt==='double')?'online':'ffa',fmt); openOnline();") > 0);
  // Und der Austritt stellt das Format der MENUEAUSWAHL wieder her, nicht das des
  // verlassenen Raums - sonst liefe der Aufbau unter einer fremden Beschreibung.
  t("der Austritt nimmt das Format der Menueauswahl",
    HTML.indexOf("setzeVorspiel(menuMode,fmtMenu,ffaNMenu);") > 0);
  t("... und die Menueauswahl fuehrt dieses Format wirklich mit",
    (HTML.match(/fmtMenu=/g) || []).length === 7, (HTML.match(/fmtMenu=/g) || []).length);
}

// ══ 6. WAS DAS AUFRAEUMEN NICHT ANFASSEN DARF ═══════════════════════════════
abschnitt('6. Der Eingriff bleibt beim Aufraeumen');
{
  // Kein Symptomverband: drawBall selbst ist unveraendert und faengt nichts ab.
  const db = grabFunction(HTML, 'drawBall');
  // drawBall traegt EINEN vorbestehenden Versuch - die Zeichenabstandsangabe, die nicht
  // jeder Browser kennt. Er hat mit der Farbe nichts zu tun, und die Farbe selbst wird
  // weiterhin ungeschuetzt gelesen: der Fehler wird vermieden, nicht geschluckt.
  t('drawBall liest die Farbe unveraendert und ungeschuetzt',
    db.split('\n')[1].trim() === 'const pc=pcol(colorSlot(b.owner));   // TEAM DUEL: beide Teamkugeln in Teamfarbe',
    db.split('\n')[1].trim().slice(0, 60));
  t('... und faengt nichts ausser der vorbestehenden Zeichenabstandsangabe ab',
    (db.match(/catch/g) || []).length === 1 && /letterSpacing/.test(db),
    (db.match(/catch/g) || []).length);
  // Die Farbtafeln sind unangetastet.
  t('die Tafeln sind unveraendert',
    /const FB_PCOLS=\[PCOLS\[0\],PCOLS\[1\],PCOLS\[2\],PCOLS\[3\],FB_COL_P5,PCOLS\[4\]\];/.test(HTML)
    && (grab(HTML, /const PCOLS=\[[^\n]*/, 'PCOLS').match(/\{ui:/g) || []).length === 5);
  // Die Bildschleife selbst ist unveraendert - der Fehler wird vermieden, nicht geschluckt.
  const loop = grabFunction(HTML, 'loop');
  t('die Bildschleife faengt nichts ab', loop.indexOf('catch') < 0);
  t('... und stellt weiterhin genau ein naechstes Bild', (loop.match(/requestAnimationFrame\(loop\)/g) || []).length === 2,
    (loop.match(/requestAnimationFrame\(loop\)/g) || []).length);
  // PASS 04 bleibt unberuehrt.
  t('die Entscheidungsfrist ist unveraendert', HTML.indexOf('const FB_V10_DEADLINE_MS=8000;') > 0
    && HTML.indexOf('const FB_V9_DEADLINE_MS=6000;') > 0);
  t('der Entscheidungszustand ist unveraendert', HTML.indexOf('function fbV9HudStand(){') > 0
    && HTML.indexOf("if(typeof fbV9HudPaint==='function')fbV9HudPaint();") > 0);
}

console.log('\nModus-und-Koerper: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
