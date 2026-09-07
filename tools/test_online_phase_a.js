// ONLINE PHASE A — Modus, Sollbesetzung und modusbewusste Lobby (Protokoll v8).
//
// Was diese Suite zusichert:
//   1. es gibt EIN Modusregister, und alle Stellen lesen daraus
//   2. jede Modus/Sollbesetzungs-Paarung ist genau die vereinbarte
//   3. das Freigabetor trennt "hat Raum und Lobby" von "ist online freigegeben"
//   4. die Lobby zeigt Modus, Soll und Ist - und startet nur bei Gleichheit
//   5. Team 2v2 zeigt B1/B2/R1/R2 in ihren Teams
//   6. der ZUGPFAD ist unveraendert der v7-Pfad - kein v9-Mechanismus ist da
//
// Der Modus/Kapazitaets-Vertrag selbst (Client- und Rules-Seite) liegt in
// test_online_protocol.js und test_rules.js; hier steht, was NUR Phase A betrifft.
//
//   node tools/test_online_phase_a.js

const { loadIndexHtml, grab: grabIn } = require('./extract.js');
const HTML = loadIndexHtml();
const grab = (re, name) => grabIn(HTML, re, name);
const RULES = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error('FAIL: ' + m); } };

// Das echte Register und seine Abfragen - woertlich aus index.html.
const R = new Function(`
  const DEV_MENU=false;
  ${grab(/const FB_ONLINE_MODE_CLASSIC=[\s\S]*?\nlet fbOnlineTeam=[^\n]*/, 'Modusregister')}
  function seatActive(p,s){ return !!(p&&p[s]&&p[s].on===true); }
  function fbTeam2Side(o){return (o===0||o===1)?0:((o===2||o===3)?1:-1);}
  return {FB_ONLINE_MODES, FB_ONLINE_MODE_IDS, fbModeDef, fbModeValid, fbModeCaps,
          fbModeCapOk, fbModeDefaultCap, fbModeReleased, fbModeSelectable,
          BLUE:FB_TEAM2_BLUE, RED:FB_TEAM2_RED, SEATS:FB_TEAM2_SEATS,
          fbTeam2SeatsOf, fbTeam2Count, fbTeam2FreeSeat, fbTeam2Side,
          start:{mode:fbOnlineMode, cap:fbOnlineCap, team:fbOnlineTeam}};
`)();

// ══ A. EIN REGISTER, FUENF MODI ══════════════════════════════════════════════
{
  ok(R.FB_ONLINE_MODE_IDS.join(',') === 'classic,speed,team2v2,lives,timedffa',
     'das Register kennt genau die fuenf vereinbarten Modi');
  ok(Object.keys(R.FB_ONLINE_MODES).sort().join(',') === 'classic,lives,speed,team2v2,timedffa',
     'und keine weiteren');
  for (const m of R.FB_ONLINE_MODE_IDS)
    ok(R.fbModeValid(m) === true, 'der Modus ' + m + ' ist gueltig');
  for (const m of ['elimination', 'ffa', 'single', '', 'LIVES', 'toString', '__proto__'])
    ok(R.fbModeValid(m) === false, '"' + m + '" ist kein Modus');
  // Prototypenketten duerfen nicht als Modus durchgehen - deshalb hasOwnProperty.
  ok(/Object\.prototype\.hasOwnProperty\.call\(FB_ONLINE_MODES,m\)/.test(HTML),
     'die Registerabfrage liest nur eigene Eintraege, nicht die Prototypenkette');
}

// ══ B. SOLLBESETZUNG: GENAU DIE VEREINBARTEN PAARUNGEN ═══════════════════════
{
  const SOLL = { classic: [2], speed: [2], team2v2: [4], lives: [3, 4, 5], timedffa: [3, 4, 5] };
  for (const m of Object.keys(SOLL)) {
    ok(R.fbModeCaps(m).join(',') === SOLL[m].join(','),
       m + ' erlaubt genau ' + SOLL[m].join('/') + ' Spieler');
    for (let c = 0; c <= 7; c++)
      ok(R.fbModeCapOk(m, c) === (SOLL[m].indexOf(c) >= 0),
         m + ' mit ' + c + ' Spielern: ' + (SOLL[m].indexOf(c) >= 0 ? 'gueltig' : 'ungueltig'));
  }
  // Die im Auftrag ausdruecklich benannten Fehlpaarungen.
  for (const [m, c] of [['classic', 4], ['speed', 5], ['team2v2', 3], ['lives', 2], ['timedffa', 6]])
    ok(R.fbModeCapOk(m, c) === false, m + ' + ' + c + ' wird abgewiesen');
  // Keine krummen Zahlen, keine Zeichenketten.
  for (const c of [2.5, '2', null, undefined, NaN, Infinity])
    ok(R.fbModeCapOk('classic', c) === false, 'classic + ' + String(c) + ' ist keine Sollbesetzung');
  ok(R.fbModeDefaultCap('lives') === 5 && R.fbModeDefaultCap('team2v2') === 4,
     'die Voreinstellung ist die groesste zulaessige Besetzung');
  ok(R.start.mode === 'lives' && R.start.cap === 5,
     'die Startauswahl ist der heute freigegebene Modus in voller Besetzung');
}

// ══ C. DAS FREIGABETOR ═══════════════════════════════════════════════════════
// Phase A gibt jedem Modus einen Raum und eine Lobby. Sie gibt ihm NICHT sein
// Onlinespiel: solange v9 fehlt, stehen Zugvektoren im Klartext in einem lesbaren Pfad.
// Neue simultane Wettbewerbsmodi duerfen deshalb nicht als fertig angeboten werden.
{
  ok(R.fbModeReleased('lives') === true,
     'die Lebensregel ist der heute freigegebene Onlinemodus');
  for (const m of ['classic', 'speed', 'team2v2', 'timedffa'])
    ok(R.fbModeReleased(m) === false, m + ' ist online noch NICHT freigegeben');
  // Ohne Dev-Menue ist ein nicht freigegebener Modus nicht waehlbar.
  ok(R.fbModeSelectable('lives') === true, 'freigegeben heisst waehlbar');
  for (const m of ['classic', 'speed', 'team2v2', 'timedffa'])
    ok(R.fbModeSelectable(m) === false, m + ' ist ohne ?dev=1 nicht waehlbar');
  // Mit Dev-Menue schon - der Mensch muss Phase A ausprobieren koennen.
  const D = new Function(`
    const DEV_MENU=true;
    ${grab(/const FB_ONLINE_MODE_CLASSIC=[\s\S]*?\nlet fbOnlineTeam=[^\n]*/, 'Modusregister')}
    return {sel:fbModeSelectable, rel:fbModeReleased};
  `)();
  for (const m of R.FB_ONLINE_MODE_IDS)
    ok(D.sel(m) === true, 'mit ?dev=1 ist ' + m + ' erreichbar');
  ok(D.rel('team2v2') === false,
     'der Dev-Schalter macht einen Modus erreichbar, aber nicht freigegeben');
  // EIN Tor, kein verstreutes Geflecht aus Sonderfaellen.
  ok((HTML.match(/released:/g) || []).length === 5,
     'der Freigabestand steht an genau fuenf Stellen - einer je Modus');
  ok((HTML.match(/fbModeSelectable\(/g) || []).length === 4,
     'und wird ueber genau eine Abfrage gelesen (Definition, Anzeige, Auswahl, Beitritt)');
  // DAS TOR GILT FUER JEDEN WEG IN EINEN RAUM. Eine Auswahl auszublenden genuegt nicht:
  // ein geteilter Raumcode waere sonst die Hintertuer in einen unfertigen Modus.
  const reach = grab(/function modeReachable\(cfg\)\{[\s\S]*?\n\}/, 'modeReachable');
  ok(/return \(typeof fbModeSelectable==='function'\)\?fbModeSelectable\(cfg\.mode\):true;/.test(reach),
     'der Beitritt fragt dasselbe Freigabetor');
  ok(/if\(!cfg\|\|!roomIsFootball\(cfg\)\)return true;/.test(reach),
     'und laesst RingOut-Raeume unberuehrt');
  const vr = grab(/function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom');
  ok(/if\(!modeReachable\(cfg\)\)return\{ok:false,reason:'Dieser Onlinemodus ist noch nicht freigegeben\.'\};/.test(vr),
     'der Beitritt per Raumcode wird mit klarem Grund abgewiesen');
  const vj = grab(/function validateRejoinRoom\(d\)\{[\s\S]*?\n\}/, 'validateRejoinRoom');
  ok(/if\(!modeReachable\(cfg\)\)return\{ok:false,reason:'noRoom'\};/.test(vj),
     'und die Rueckkehr ebenso');
  // Die oeffentliche Raumliste zeigt Football-Raeume ohnehin nicht.
  const plv = grab(/function publicListingView\(d,now\)\{[\s\S]*?\n\}/, 'publicListingView');
  ok(/if\(roomIsFootball\(cfg\)\)return\{show:false,remove:false\};/.test(plv),
     'und die oeffentliche Liste fuehrt gar keinen Football-Raum');
  for (const lang of [/onModeLocked:'This online mode is not released yet\.'/,
                      /onModeLocked:'Dieser Onlinemodus ist noch nicht freigegeben\.'/,
                      /onModeLocked:'Bu çevrimiçi mod henüz yayında değil\.'/])
    ok(lang.test(HTML), 'die Sperrmeldung steht in allen drei Sprachen');
  // Die Auswahl blendet nicht freigegebene Modi aus und beschriftet sie als solche.
  const show = grab(/function fbOnModeShow\(\)\{[\s\S]*?\n\}/, 'fbOnModeShow');
  ok(/btn\.style\.display=frei\?'':'none';/.test(show),
     'die Auswahl blendet nicht waehlbare Modi aus');
  // Und sie fasst dabei die RICHTIGEN Knoepfe an. Die Zeile oben allein genuegt nicht:
  // ein falsch gebildeter Bezeichner laesst sie ins Leere laufen, und das Freigabetor
  // waere wirkungslos, ohne dass eine Textpruefung es merkt.
  ok(/const btn=\$\(fbOnModeBtnId\(m\)\+'Btn'\); if\(!btn\)continue;/.test(show),
     'und findet sie ueber die vollstaendige Knopfkennung');
  const idFn = new Function(`${grab(/function fbOnModeBtnId\(m\)\{[^\n]*/, 'fbOnModeBtnId')}
    return fbOnModeBtnId;`)();
  for (const m of R.FB_ONLINE_MODE_IDS) {
    const basis = idFn(m);
    ok(basis !== '' && HTML.indexOf('id="' + basis + 'Btn"') > 0,
       m + ': der Knopf ' + basis + 'Btn existiert im Markup');
    ok(HTML.indexOf('id="' + basis + 'S"') > 0,
       m + ': und seine Kurzbeschreibung ' + basis + 'S');
  }
  ok(/fbModeReleased\(m\)\?'':' · '\+T\('onModeDev'\)/.test(show),
     'und markiert einen sichtbaren, aber unfreigegebenen Modus ausdruecklich');
  for (const lang of [/onModeDev:'NOT RELEASED ONLINE YET'/, /onModeDev:'ONLINE NOCH NICHT FREIGEGEBEN'/,
                      /onModeDev:'ÇEVRİMİÇİ HENÜZ YAYINDA DEĞİL'/])
    ok(lang.test(HTML), 'der Freigabehinweis steht in allen drei Sprachen');
}

// ══ D. DIE AUSWAHL FUEHRT IN DEN BESTEHENDEN ONLINEBILDSCHIRM ════════════════
{
  const pick = grab(/function fbOnModePick\(m\)\{[\s\S]*?\n\}/, 'fbOnModePick');
  ok(/if\(!fbModeSelectable\(m\)\)return;/.test(pick),
     'ein nicht waehlbarer Modus laesst sich auch programmatisch nicht waehlen');
  ok(/if\(caps\.length===1\)\{ fbOnlineCap=caps\[0\]; fbOnlineEnter\(\); return; \}/.test(pick),
     'ein Modus mit genau einer Spielerzahl geht ohne Zwischenschritt weiter');
  ok(/fbOnlineCap=fbModeDefaultCap\(m\);/.test(pick),
     'sonst wird die Voreinstellung aus dem Register gesetzt');
  ok(/b\.style\.display=caps\.indexOf\(c\)>=0\?'':'none'/.test(pick),
     'und die Spielerzahl-Auswahl zeigt nur die zulaessigen Zahlen');
  const enter = grab(/function fbOnlineEnter\(\)\{[\s\S]*?\n\}/, 'fbOnlineEnter');
  ok(/openOnline\(\);/.test(enter),
     'danach uebernimmt der BESTEHENDE Onlinebildschirm - kein zweiter Ablauf');
  ok(/fmt=FB_ONLINE_FMT;/.test(enter),
     'und das Raumformat bleibt das bestehende');
  // Die Schirme existieren und tragen keine Entwicklerbegriffe.
  const ov = grab(/<div class="ov" id="fbOnModeOv">[\s\S]*?<\/div>\s*<\/div>/, 'Moduswahl-Schirm');
  for (const id of ['fbOnClassicBtn', 'fbOnSpeedBtn', 'fbOnTeam2Btn', 'fbOnLivesBtn', 'fbOnTimedBtn'])
    ok(ov.indexOf(id) >= 0, 'die Moduswahl bietet ' + id + ' an');
  ok(!/DEV|\?dev=1/.test(ov), 'und nennt keinen Entwicklerbegriff');
  const cov = grab(/<div class="ov" id="fbOnCapOv">[\s\S]*?<\/div>\s*<\/div>/, 'Spielerzahl-Schirm');
  for (const id of ['fbOnCap3', 'fbOnCap4', 'fbOnCap5'])
    ok(cov.indexOf(id) >= 0, 'die Spielerzahl-Auswahl bietet ' + id + ' an');
  ok(cov.indexOf('fbOnCap2') < 0 && cov.indexOf('fbOnCap6') < 0,
     'und keine Zahl, die kein Modus zulaesst');
}

// ══ E. DIE LOBBY SAGT MODUS, SOLL UND IST ════════════════════════════════════
{
  const lob = grab(/function renderLobby\(p\)\{[\s\S]*?\n\}/, 'renderLobby');
  ok(/\$\('lobbyCount'\)\.textContent=n\+'\/'\+cap;/.test(lob),
     'die Lobby zeigt beigetreten/erforderlich');
  ok(/modeEl\.textContent=mo\?/.test(lob) && /fbLobbyMode\(\)/.test(lob),
     'und den Modus des Raums');
  ok(/const soll=fbLobbyCap\(\);/.test(lob) && /const bereit=team2\?\(blau===2&&rot===2\):\(n===soll&&!gap\);/.test(lob),
     'der Startknopf oeffnet NUR bei genau der Sollbesetzung');
  ok(/n<soll\?fbWaitText\(n,soll\)/.test(lob),
     'und der Hinweis nennt, wie viele fehlen');
  // Der Wartetext ist eine Aussage, kein Platzhalter.
  const W = new Function(`${grab(/function fbWaitText\(n,soll\)\{[\s\S]*?\n\}/, 'fbWaitText')}
    return fbWaitText;`)();
  ok(W(4, 5) === 'Warte auf 1 weiteren Spieler…', 'einer fehlt: Einzahl');
  ok(W(3, 5) === 'Warte auf 2 weitere Spieler…', 'zwei fehlen: Mehrzahl');
  ok(W(1, 5) === 'Warte auf 4 weitere Spieler…', 'vier fehlen');
  ok(W(5, 5) === '' && W(6, 5) === '', 'bei voller Besetzung sagt er nichts mehr');
  // Sitzkreise und Namenszeilen laufen ueber dieselbe Sollbesetzung - ein Drei-Spieler-
  // Raum zeigt keine vierte oder fuenfte Position als beitretbar.
  ok(/for\(let s=0;s<cap;s\+\+\)\{/.test(lob),
     'nur Sitze innerhalb der Sollbesetzung werden gezeichnet');
  ok(/if\(s<cap&&seatActive\(p,s\)\)/.test(lob),
     'und nur sie tragen einen Namen');
}

// ══ F. TEAM 2V2: B1/B2 GEGEN R1/R2 ═══════════════════════════════════════════
{
  const lob = grab(/function renderLobby\(p\)\{[\s\S]*?\n\}/, 'renderLobby');
  ok(/const team2=fbTeam2Room\(\);/.test(lob),
     'die Lobby kennt Team 2v2 als eigenen Teambegriff');
  // Und sie fragt dabei den MODUS DES RAUMS, nicht fbVariant: online laeuft die
  // Football-Variante immer als Elimination, weshalb fbTeam2() dort false ist. Genau
  // daran lag die Vier-Farben-Lobby.
  const room2 = grab(/function fbTeam2Room\(\)\{[^\n]*/, 'fbTeam2Room');
  ok(/return fmt===FB_ONLINE_FMT&&fbLobbyMode\(\)===FB_ONLINE_MODE_TEAM2;/.test(room2),
     'und leitet das aus dem Raummodus ab, nicht aus fbVariant');
  ok(/const TEAM2_ORDER=\[1,2,4,5,6\];/.test(lob),
     'Blau sind die Sitze 0 und 1, Rot die Sitze 2 und 3');
  ok(/\$\('lobbyTeamBlue'\)\.style\.display=\(team\|\|team2\)\?'':'none';/.test(lob),
     'und die Teamkopfzeilen erscheinen auch dort');
  ok(/FOOTBALL_TEAM2V2_NAMES\[s\]\+' · '\+\(seatActive\(p,s\)\?fbTeam2NameForSeat\(s\):T\('seatFree'\)\)/.test(lob),
     'jede Zeile nennt ihre Sitzidentitaet - B1, B2, R1, R2 - und freie Plaetze als FREI');
  // ══ DIE ZEILENBESCHRIFTUNG NENNT DAS TEAM, NICHT DIE SITZFARBE ═════════════
  // Gefunden im Firebase-Spieltest: ohne eingegebenen Namen stand dort der Rueckfall von
  // nameForSeat() - und der ist die SPIELERfarbe des Sitzes (col0..col4). In einem
  // Zweiteamspiel ergab das "B2 · RED", "R1 · GREEN", "R2 · YELLOW": drei falsche
  // Auskuenfte von vieren, und zwei Farben, die es dort gar nicht gibt.
  {
    const L = new Function(`
      let playersRoster={};
      const I18N={en:{col0:'BLUE',col1:'RED',col2:'GREEN',col3:'YELLOW',col4:'PURPLE'}};
      function T(k){return I18N.en[k]||k;}
      function sanitizeName(x){return String(x||'').slice(0,48);}
      const FB_TEAM2_BLUE=0;
      function fbTeam2Side(o){return (o===0||o===1)?0:((o===2||o===3)?1:-1);}
      ${grab(/function fbTeam2NameForSeat\(s\)\{[\s\S]*?\n\}/, 'fbTeam2NameForSeat')}
      ${grab(/function nameForSeat\(s\)\{[\s\S]*?\n\}/, 'nameForSeat')}
      return { setz:(r)=>{playersRoster=r||{};}, team2:fbTeam2NameForSeat, generisch:nameForSeat };
    `)();
    // (A)-(D) Ohne Namen nennt jede Zeile ihre TEAMfarbe.
    L.setz({ 0:{name:''}, 1:{name:''}, 2:{name:''}, 3:{name:''} });
    ok(L.team2(0) === 'BLUE', 'B1 zeigt BLUE');
    ok(L.team2(1) === 'BLUE', 'B2 zeigt BLUE - nicht RED');
    ok(L.team2(2) === 'RED', 'R1 zeigt RED - nicht GREEN');
    ok(L.team2(3) === 'RED', 'R2 zeigt RED - nicht YELLOW');
    // (E)+(F) Gruen und Gelb sind in Team 2v2 unerreichbar.
    const alle = [0, 1, 2, 3].map(x => L.team2(x)).join(' ');
    ok(alle.indexOf('GREEN') < 0, 'kein GREEN in der Team-2v2-Lobby');
    ok(alle.indexOf('YELLOW') < 0, 'und kein YELLOW');
    ok(new Set([0, 1, 2, 3].map(x => L.team2(x))).size === 2,
       'es gibt genau zwei Farbnamen - eine je Team');
    // Ein eingegebener Name gewinnt weiterhin; der Rueckfall ersetzt ihn nicht.
    L.setz({ 0:{name:'Tunay'}, 1:{name:''}, 2:{name:'Jo'}, 3:{name:''} });
    ok(L.team2(0) === 'Tunay' && L.team2(2) === 'Jo', 'ein eingegebener Name steht weiterhin dort');
    ok(L.team2(1) === 'BLUE' && L.team2(3) === 'RED', 'und nur die leeren Plaetze tragen die Teamfarbe');
    // (G)+(H) Die generische Zuordnung ist UNVERAENDERT - Lives und Timed FFA brauchen sie.
    L.setz({ 0:{name:''}, 1:{name:''}, 2:{name:''}, 3:{name:''} });
    ok(L.generisch(0) === 'BLUE' && L.generisch(1) === 'RED'
       && L.generisch(2) === 'GREEN' && L.generisch(3) === 'YELLOW',
       'nameForSeat() bleibt die Spielerfarbe - Lives und Timed FFA sind unberuehrt');
    // Und die Sonderbehandlung greift NUR in der Team-2v2-Zeile.
    ok((HTML.match(/fbTeam2NameForSeat\(/g) || []).length === 2,
       'die Team-2v2-Beschriftung wird an genau einer Stelle benutzt (Definition + Zeile)');
    ok(/return n\|\|T\('col'\+\(fbTeam2Side\(s\)===FB_TEAM2_BLUE\?0:1\)\);/.test(
         grab(/function fbTeam2NameForSeat\(s\)\{[\s\S]*?\n\}/, 'fbTeam2NameForSeat')),
       'und leitet die Farbe aus der Teamzuordnung des Sitzes ab');
  }
  ok(/const FOOTBALL_TEAM2V2_NAMES=\['B1','B2','R1','R2'\];/.test(HTML),
     'und diese Namen kommen aus derselben Quelle wie lokal');
  // Die Zuordnung ist eine ABLEITUNG aus dem Sitz - kein gespeicherter Zustand.
  ok(!/teamOfSeat|seatTeam|config\/team|"team":/.test(HTML),
     'die Teamzugehoerigkeit wird nirgends gespeichert');
  ok(RULES.indexOf('team2v2') > 0 && RULES.indexOf('"team"') < 0,
     'auch die Rules kennen team2v2 nur als Modusnamen, nicht als Zustandsfeld');
}

// ══ F2. TEAM 2V2: ZWEI TEAMS, NICHT VIER SPIELER ═════════════════════════════
// Der Spieltest fand eine Lobby, die Team 2v2 wie ein generisches Vierer-FFA zeigte:
// B1 blau, B2 rot, R1 gruen, R2 gelb. Ursache war colorSlot(), das seinen Teambegriff
// aus fbTeam2() zieht - und fbTeam2() prueft fbVariant, die online IMMER Elimination
// ist. Die Lobby fragt jetzt den Raummodus.
{
  // (A) Es gibt genau ZWEI Teams.
  ok(R.SEATS.length === 2, 'es gibt genau zwei Teams');
  ok(R.BLUE === 0 && R.RED === 1, 'Blau ist Team 0, Rot ist Team 1');
  // (B)+(C) Sitzableitung - dieselbe wie lokal.
  ok(R.fbTeam2SeatsOf(R.BLUE).join(',') === '0,1', 'Blau sind die Sitze 0 und 1');
  ok(R.fbTeam2SeatsOf(R.RED).join(',') === '2,3', 'Rot sind die Sitze 2 und 3');
  for (const s of [0, 1]) ok(R.fbTeam2Side(s) === R.BLUE, 'Sitz ' + s + ' leitet Blau ab');
  for (const s of [2, 3]) ok(R.fbTeam2Side(s) === R.RED, 'Sitz ' + s + ' leitet Rot ab');
  ok(R.fbTeam2SeatsOf(2).length === 0 && R.fbTeam2SeatsOf(-1).length === 0,
     'ein drittes Team gibt es nicht');
  // Das Team wird NIRGENDS gespeichert - weder im Raum noch in den Rules.
  ok(!/config\.team|'team':|"team":/.test(HTML), 'kein Teamfeld im Raum');
  ok(RULES.indexOf('"team"') < 0, 'und keines in den Rules');

  // (D)+(E) Die Wahl begrenzt die Kandidatensitze - und nur die.
  const P = (belegt) => { const p = {}; for (const x of belegt) p[x] = { s: 't' + x, on: true, t: 1 }; return p; };
  ok(R.fbTeam2FreeSeat(P([]), R.BLUE) === 0, 'Blau vergibt zuerst Sitz 0');
  ok(R.fbTeam2FreeSeat(P([0]), R.BLUE) === 1, 'ist 0 belegt, folgt 1 - deterministisch von unten');
  ok(R.fbTeam2FreeSeat(P([]), R.RED) === 2, 'Rot vergibt zuerst Sitz 2');
  ok(R.fbTeam2FreeSeat(P([2]), R.RED) === 3, 'ist 2 belegt, folgt 3');
  ok(R.fbTeam2FreeSeat(P([2, 3]), R.BLUE) === 0,
     'ein volles Rot beruehrt die Blau-Vergabe nicht');
  // (F)+(G) Ein volles Team nimmt niemanden mehr auf.
  ok(R.fbTeam2FreeSeat(P([0, 1]), R.BLUE) === -1, 'volles Blau weist einen weiteren Blau ab');
  ok(R.fbTeam2FreeSeat(P([2, 3]), R.RED) === -1, 'volles Rot weist einen weiteren Rot ab');
  ok(R.fbTeam2Count(P([0, 2]), R.BLUE) === 1 && R.fbTeam2Count(P([0, 2]), R.RED) === 1,
     'die Zaehlung trennt die Teams sauber');
  ok(R.fbTeam2Count(P([0, 1, 2, 3]), R.BLUE) === 2 && R.fbTeam2Count(P([0, 1, 2, 3]), R.RED) === 2,
     'und ein volles Feld ist 2/2 zu 2/2');
  // Ein Sitz mit Praesenzrecord, aber noch nicht aktiv, gilt bereits als vergeben -
  // dieselbe Bedingung wie in pickFreeSeat, sonst waere er doppelt beanspruchbar.
  ok(R.fbTeam2FreeSeat({ 0: { s: 'x', on: false, t: 1 } }, R.BLUE) === 1,
     'ein reservierter, noch nicht aktivierter Sitz gilt als vergeben');

  // (H) Der atomare Anspruch bleibt der Schiedsrichter.
  const claim = grab(/async function claimSeat\(code,op,maxSeats,kandidaten,team2\)\{[\s\S]*?\n\}/, 'claimSeat');
  ok(/const seat=kandidaten\?pickSeatFrom\(d\.p,kandidaten\):pickFreeSeat\(d\.p,maxSeats\);/.test(claim),
     'die Teamwahl begrenzt nur die Kandidatensitze');
  ok(/const r=await claimSeatSlot\(code,seat,op,undefined,team2\);/.test(claim),
     'beansprucht wird weiterhin ueber den bestehenden atomaren write-once-Claim');
  ok(/if\(r\.lost\)continue;/.test(claim),
     'ein verlorenes Rennen holt einen frischen Schnappschuss - zwei gleichzeitige '
     + 'Beitritte ins selbe Team koennen denselben Sitz nicht beide bekommen');
  ok(/const runden=kandidaten\?kandidaten\.length:maxSeats;/.test(claim),
     'und die Versuchszahl folgt der Kandidatenmenge');

  // (I)+(J)+(K) Die Lobby zeigt zwei Teams - kein Gruen, kein Gelb.
  const lob2 = grab(/function renderLobby\(p\)\{[\s\S]*?\n\}/, 'renderLobby');
  ok(/const col=pcol\(fbLobbyColorSlot\(s\)\)\.ui;/.test(lob2),
     'die Sitzkreise tragen die TEAMfarbe');
  const cs = grab(/function fbLobbyColorSlot\(s\)\{[^\n]*/, 'fbLobbyColorSlot');
  ok(/return fbTeam2Room\(\)\?fbTeam2Side\(s\):colorSlot\(s\);/.test(cs),
     'und zwar aus der Teamableitung, nicht aus der Spielerfarbe');
  ok(/row\.style\.color=pcol\(fbTeam2Side\(s\)\)\.ui;/.test(lob2),
     'auch die Namenszeilen tragen die Teamfarbe');
  // pcol(0) ist Blau, pcol(1) Rot - Gruen (2) und Gelb (3) sind in Team 2v2 unerreichbar.
  ok(R.fbTeam2Side(0) < 2 && R.fbTeam2Side(1) < 2 && R.fbTeam2Side(2) < 2 && R.fbTeam2Side(3) < 2,
     'kein Sitz kann je auf den Gruen- oder Gelbslot zeigen');
  ok(/\$\('lobbyTeamBlue'\)\.style\.display=\(team\|\|team2\)\?'':'none';/.test(lob2),
     'die Teamkopfzeilen erscheinen');
  ok(/const TEAM2_ORDER=\[1,2,4,5,6\];/.test(lob2), 'B1 und B2 stehen unter Blau, R1 und R2 unter Rot');

  // (L) Die eigene Identitaet nennt Sitz UND Team.
  ok(/FOOTBALL_TEAM2V2_NAMES\[myPlayer\]\+' · '\+T\(fbTeam2Side\(myPlayer\)===FB_TEAM2_BLUE\?'teamBlue':'teamRed'\)/.test(lob2),
     '"DU BIST B1 · BLAU" statt einer Farbe');

  // Die Teamwahl selbst.
  const ask = grab(/function fbTeamAsk\(p,weiter,zurueck\)\{[\s\S]*?\n\}/, 'fbTeamAsk');
  ok(/const belegt=fbTeam2Count\(p,t\), voll=belegt>=2;/.test(ask),
     'die Wahl zeigt die Belegung je Team');
  ok(/const gesperrt=voll;/.test(ask),
     'gesperrt ist EIN Grund: das Team ist voll - keine Ersteller-Sonderregel mehr');
  ok(!/wirt/.test(ask),
     'die Teamwahl kennt den Ersteller nicht mehr als Sonderfall');
  ok(/btn\.disabled=gesperrt;/.test(ask), 'gesperrt heisst wirklich gesperrt');
  const picked = grab(/function fbTeamPicked\(t\)\{[\s\S]*?\n\}/, 'fbTeamPicked');
  ok(/if\(\$\(t===FB_TEAM2_BLUE\?'fbOnTeamBlueBtn':'fbOnTeamRedBtn'\)\.disabled\)return;/.test(picked),
     'auch ein programmatischer Klick kommt an der Sperre nicht vorbei');
  // Beide Wege benutzen denselben Schirm.
  ok((HTML.match(/fbTeamAsk\(/g) || []).length === 3,
     'Ersteller und Beitretender gehen durch dieselbe Teamwahl (Definition + zwei Wege)');
  // ══ DIE REIHENFOLGE: ERST HANDELN, DANN TEAM ═══════════════════════════════
  // (A)+(B) Die MODUSWAHL fragt nicht nach dem Team. Sie fuehrt in den normalen
  // Onlinebildschirm - dieselbe Tuer wie fuer jeden anderen Modus.
  const pick2 = grab(/function fbOnModePick\(m\)\{[\s\S]*?\n\}/, 'fbOnModePick');
  ok(!/fbTeamAsk/.test(pick2),
     'die Moduswahl fragt NICHT nach dem Team - die Seite gehoert zu einer Handlung');
  ok(/if\(caps\.length===1\)\{ fbOnlineCap=caps\[0\]; fbOnlineEnter\(\); return; \}/.test(pick2),
     'Team 2v2 hat genau eine Spielerzahl und geht direkt in den Onlinebildschirm');
  // (C)+(D)+(E) ERSTELLEN oeffnet die Teamwahl - und nur dort.
  const cre = grab(/\$\('onCreate'\)\.onclick=\(\)=>\{[\s\S]*?\n\};/, 'onCreate-Handler');
  ok(/fbOnlineMode===FB_ONLINE_MODE_TEAM2/.test(cre) && /fbTeamAsk\(\{\},/.test(cre),
     'ERSTELLEN fragt bei Team 2v2 nach der Seite');
  ok(/\(t\)=>\{fbOnlineTeam=t;createRoom\(\);\}/.test(cre),
     'und legt den Raum erst NACH der Wahl an');
  ok(/fbOnlineTeam=-1;   \/\/ andere Modi/.test(cre),
     'jeder andere Modus legt sofort an - ohne Teamfrage');
  // (F)+(G)+(H)+(I) BEITRETEN fragt erst nach Code, Pruefung und Belegung.
  const jr = grab(/function joinRoom\(\)\{[\s\S]*?\n\}/, 'joinRoom');
  const iCode = jr.indexOf("$('onInput')");
  const iPruef = jr.indexOf('validateRoom(d)');
  const iTeam = jr.indexOf('fbTeamAsk');
  const iClaim = jr.indexOf('claimSeat(');
  ok(iCode >= 0 && iPruef > iCode && iTeam > iPruef && iClaim > iTeam,
     'Reihenfolge im Beitritt: Code -> Raumpruefung -> Teamwahl -> Sitzanspruch');
  ok(/if\(!v\.ok\)\{ setStatus\(v\.reason\); return; \}/.test(jr)
     && jr.indexOf('if(!v.ok)') < iTeam,
     'ein ungueltiger Code kommt nie bis zur Teamwahl');
  ok(/if\(joinFb&&v\.mode===FB_ONLINE_MODE_TEAM2\)\{/.test(jr),
     'und nur ein echter Team-2v2-Raum zeigt sie ueberhaupt');
  ok(/const frisch=await window\.FB\.get\(window\.FB\.ref\(window\.FB\.db,'rooms\/'\+code\)\);/.test(jr)
     && jr.indexOf('const frisch=') < jr.indexOf('const wahl=await new Promise'),
     'die Belegung wird FRISCH gelesen, bevor gefragt wird');
  // (J)+(K) Volle Seiten.
  ok(/if\(!blauFrei&&!rotFrei\)\{ setStatus\(T\('roomFull'\)\); return; \}/.test(jr),
     'sind beide Seiten voll, gibt es gar keine Wahl - der Raum ist voll');
  ok(/const wahl=await new Promise\(r=>fbTeamAsk\(pJetzt,/.test(jr),
     'die Wahl bekommt die aktuelle Belegung - volle Seiten sind dort gesperrt');
  // (L) Die Wahl liefert genau die Sitze ihrer Seite.
  ok(/c=await claimSeat\(code,op,cap,fbTeam2SeatsOf\(wahl\),true\);/.test(jr),
     'die Wahl geht als Kandidatenmenge ihrer eigenen Seite in den Claim');
  // (O)+(P) Rennen: erneut fragen, immer in derselben Seite.
  ok(/for\(let versuch=0;versuch<4;versuch\+\+\)\{/.test(jr),
     'ein verlorenes Rennen fuehrt zu einem neuen Versuch, nicht zum Abbruch');
  ok(/setStatus\(T\('teamFullMsg'\)\);\s*\n\s*c=null;/.test(jr),
     'und wenn die gewaehlte Seite inzwischen voll ist, wird das gesagt und neu gefragt');
  ok(!/fbTeam2SeatsOf\(1-wahl\)|gegenteam|anderesTeam/.test(jr),
     'niemand wird stillschweigend in die andere Seite geschoben');
  // (Q) Vor der Bestaetigung wird NICHTS beansprucht.
  ok(jr.indexOf('claimSeat(') > jr.indexOf('fbTeamAsk')
     && !/armPresence|activateSeat/.test(jr.slice(0, jr.indexOf('fbTeamAsk'))),
     'vor der Teambestaetigung wird weder Sitz noch Praesenz beansprucht');
  // (M)+(N) Keine stehengebliebene Wahl.
  ok(/let fbOnlineTeam=-1;/.test(HTML),
     'es gibt keine Vorbelegung der Seite - -1 heisst "keine Wahl offen"');
  ok(/\(\)=>\{fbOnlineTeam=-1;\}/.test(cre),
     'ein Abbruch der Teamwahl raeumt sie ab');
  ok(/fbOnlineTeam=-1;       \/\/ die Wahl hat ihren Zweck erfuellt/.test(HTML),
     'und nach der Anlage gilt sie fuer keinen weiteren Raum');
  ok(/if\(fbOnlineTeam!==FB_TEAM2_BLUE&&fbOnlineTeam!==FB_TEAM2_RED\)\{ setStatus\(T\('onTeamMissing'\)\); return; \}/.test(HTML),
     'ohne offene Wahl legt die Anlage keinen Team-2v2-Raum an - kein stiller Blau-Rueckfall');
  // Der Beitritt benutzt die globale Wahl gar nicht - sie ist dort eine lokale Groesse.
  ok(!/fbOnlineTeam/.test(jr),
     'der Beitritt fasst die Ersteller-Wahl nicht an');
  // DER BELEGTE FEHLER: der Teamschirm lag hinter dem Onlinebildschirm.
  ok(/#fbOnTeamOv\{z-index:140\}/.test(HTML),
     'der Teamschirm liegt ueber dem Onlinebildschirm (.cover, z-index 120)');
  ok(/\.cover\{position:fixed;inset:0;[^}]*z-index:120/.test(HTML),
     'und der Onlinebildschirm ist genau dieser .cover');

  // (M) KEIN Durchfallen in die generische Partie.
  const sfm = grab(/function startFfaMatch\(\)\{[\s\S]*?\n\}/, 'startFfaMatch');
  ok(/if\(fbOnlineRoom\(\)&&!fbModeReleased\(fbLobbyMode\(\)\)\)\{\s*\n\s*toast\(T\('onModeNoPlay'\)\);\s*\n\s*return;/.test(sfm),
     'ein nicht freigegebener Modus startet NICHT - sauberer Halt statt Rueckfall');
  ok(/const spielbar=fbModeReleased\(fbLobbyMode\(\)\);/.test(lob2)
     && /\$\('lobbyStart'\)\.disabled=!\(bereit&&spielbar\);/.test(lob2),
     'und der Startknopf bleibt zu, auch bei voller Besetzung');
  ok(/onModeNoPlay:'TEAM 2V2 ONLINE GAMEPLAY NOT ENABLED YET'/.test(HTML),
     'die Entwicklermeldung sagt genau, was fehlt');
  ok((HTML.match(/onModeNoPlay:'/g) || []).length === 3,
     'und steht in allen drei Sprachtabellen');

  // (N) Die Lebensregel bleibt der einzige freigegebene Modus - unveraendert.
  ok(R.fbModeReleased('lives') === true && R.FB_ONLINE_MODES.lives.caps.join(',') === '3,4,5',
     'Lives online ist unveraendert freigegeben mit 3 bis 5 Sitzen');
  ok(R.fbModeReleased('team2v2') === false, 'Team 2v2 bleibt unfreigegeben');

  // (O)+(P)+(Q) werden in Abschnitt G gepinnt.
}

// ══ F3. HOST IST NICHT DER SITZ ═══════════════════════════════════
// Bis v7 galt: wer auf Sitz 0 sitzt, ist Host. In Team 2v2 ist Sitz 0 aber kanonisch B1
// - der Ersteller haette damit nie Rot waehlen koennen. v8 traegt die Hostkennung als
// eigenes, unveraenderliches Raumfeld.
{
  const H = new Function(`
    let myPlayer=0, playersRoster={};
    const FFA_MAX_SEATS=5;
    let UID='ich';
    function fbUid(){return UID;}
    ${grab(/let roomHostUid='';/, 'roomHostUid-Deklaration')}
    ${grab(/function isHost\(\)\{[^\n]*/, 'isHost')}
    ${grab(/function hostSeat\(\)\{[\s\S]*?\n\}/, 'hostSeat')}
    return {
      setz:(seat,host,roster,uid)=>{myPlayer=seat;roomHostUid=host;playersRoster=roster||{};UID=uid||'ich';},
      isHost, hostSeat };
  `)();
  const R2 = { 0:{uid:'blau0'}, 1:{uid:'blau1'}, 2:{uid:'ich'}, 3:{uid:'rot3'} };

  // (A) Der Ersteller auf Sitz 2 IST Host.
  H.setz(2, 'ich', R2, 'ich');
  ok(H.isHost() === true, 'der Ersteller auf Sitz 2 ist Host');
  ok(H.hostSeat() === 2, 'und sein Hostsitz ist 2');
  // (B) Wer auf Sitz 0 sitzt, ist es NICHT.
  H.setz(0, 'ich', R2, 'blau0');
  ok(H.isHost() === false, 'wer auf Sitz 0 sitzt, ist deshalb NICHT Host');
  ok(H.hostSeat() === 2, 'der Hostsitz bleibt 2 - er haengt an der Kennung, nicht am Platz');
  // (C) Ein Fremder erst recht nicht.
  H.setz(3, 'ich', R2, 'rot3');
  ok(H.isHost() === false, 'ein anderer Mitspieler ist kein Host');
  // (D) Altbestand ohne Kennung: die alte Konvention gilt weiter - und NUR dann.
  H.setz(0, '', {}, 'irgendwer');
  ok(H.isHost() === true, 'ohne Hostkennung (v4-v7) gilt weiterhin Sitz 0');
  H.setz(2, '', {}, 'irgendwer');
  ok(H.isHost() === false, 'und dort ist Sitz 2 kein Host');
  ok(H.hostSeat() === 0, 'auch der Hostsitz faellt dort auf 0 zurueck');
  // Eine leere Kennung darf nie zufaellig passen.
  H.setz(1, '', { 1:{uid:''} }, '');
  ok(H.isHost() === false, 'eine leere Kennung macht niemanden zum Host');

  // Der Quelltext: EIN Begriff, ueberall gefragt.
  const ih = grab(/function isHost\(\)\{[^\n]*/, 'isHost');
  ok(/roomHostUid\?\(roomHostUid===fbUid\(\)&&!!roomHostUid\):\(myPlayer===0\)/.test(ih),
     'isHost fragt die Kennung, und nur ohne sie den Sitz');
  const lob3 = grab(/function renderLobby\(p\)\{[\s\S]*?\n\}/, 'renderLobby');
  ok(/const host=isHost\(\)/.test(lob3), 'die Lobby fragt isHost(), nicht myPlayer===0');
  ok(/if\(roomPublic&&isHost\(\)\)/.test(HTML), 'der Listeneintrag ebenso');
  ok(/wasHost=isHost\(\)/.test(HTML), 'und das Verlassen ebenso');
  // Die Lobby-Hostfrist beobachtet den HOSTSITZ - in einem v8-Raum kann das Sitz 2 sein.
  ok(/if\(seatActive\(lobbyP,hostSeat\(\)\)\)return;/.test(HTML),
     'die Hostfrist beobachtet den Sitz des Hosts');
  ok(/if\(!\(online&&ffaRoom\(\)&&!gameStarted&&!isHost\(\)\)\)return;/.test(HTML),
     'und laeuft nur bei den Nicht-Hosts');
  // Es bleiben genau VIER Vorkommen von myPlayer===0, und keines davon ist eine
  // Hostpruefung:
  //   1x in isHost() selbst - der Rueckfall fuer Raeume ohne Hostkennung (v4-v7)
  //   3x in der 1v1-Kartenanzeige (card0 gehoert dem Sitz 0) - reine Sitzsemantik
  ok((HTML.match(/myPlayer===0/g) || []).length === 4,
     'die verbliebenen myPlayer===0 sind Rueckfall und Kartenanzeige, keine Hostpruefung');
  ok(/function isHost\(\)\{ return roomHostUid\?/.test(HTML),
     'und die einzige Hostfrage steht in isHost()');
  for (const [f, re] of [['renderLobby', /function renderLobby\(p\)\{[\s\S]*?\n\}/],
                         ['maybeStart', /function maybeStart\(\)\{[^\n]*/],
                         ['startFfaMatch', /function startFfaMatch\(\)\{[\s\S]*?\n\}/]])
    ok(!/myPlayer===0/.test(grab(re, f)), f + ' fragt nirgends mehr nach dem Sitz 0');

  // Der Ersteller beansprucht den ersten Sitz SEINER Seite.
  const cr = grab(/function createRoom\(\)\{[\s\S]*?\n\}/, 'createRoom');
  ok(/wirtSitz=fbTeam2SeatsOf\(fbOnlineTeam\)\[0\];/.test(cr),
     'der Ersteller sitzt auf dem ersten Sitz seiner gewaehlten Seite');
  ok(/hostUid:fbUid\(\)/.test(cr), 'und schreibt seine Hostkennung in den Raum');
  ok(/room\.p\[wirtSitz\]=/.test(cr) && /room\.players\[wirtSitz\]=/.test(cr),
     'Praesenz und Roster entstehen auf genau diesem Sitz');
  ok(/armPresence\(code,wirtSitz\)/.test(cr) && /activateSeat\(code,wirtSitz\)/.test(cr),
     'Reservierung und Aktivierung ebenso');
  ok(/abortFreshRoom\(code,dc,listed,wirtSitz\)/.test(cr),
     'und der Aufraeumpfad raeumt genau diesen Sitz ab - kein Waisenraum');
  ok(/let dc=null, code='', created=false, listed=false, wirtSitz=0;/.test(cr),
     'wirtSitz lebt ausserhalb des try - sonst saehe der catch ihn nicht');
  ok(/if\(visibility==='public'&&!fbo\)\{/.test(cr),
     'ein Football-Raum schreibt keinen oeffentlichen Eintrag - die Liste zeigt ihn ohnehin nie, '
     + 'und dessen Regel haengt an p/0');

  // Die Raumpruefungen verlangen die Kennung und geben sie weiter.
  const vr2 = grab(/function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom');
  ok(/if\(typeof d\.hostUid!=='string'\|\|!d\.hostUid\)return\{ok:false/.test(vr2),
     'ein v8-Raum ohne Hostkennung ist ungueltig');
  ok(/hostUid:d\.hostUid/.test(vr2), 'und die Pruefung reicht sie durch');
  ok((HTML.match(/roomHostUid=v\.hostUid\|\|'';/g) || []).length === 3,
     'Beitritt, 1v1-Beitritt und Rueckkehr uebernehmen sie - alle drei');
  ok(/roomHostUid='';/.test(grab(/function leaveOnline\([\s\S]*?\n\}/, 'leaveOnline'))
     || /fbRoomCap=0; roomHostUid='';/.test(HTML),
     'und das Verlassen raeumt sie ab');

  // Die Rules: v8 fragt die Kennung, der Altbestand den Sitz.
  const rr = JSON.parse(RULES).rules.rooms.$code;
  ok(rr.hostUid !== undefined && rr.hostUid['.write'] === undefined,
     'hostUid hat keine eigene Schreiberlaubnis - damit ist sie unveraenderlich');
  ok(rr.hostUid['.validate'].indexOf("newData.val() === auth.uid") >= 0,
     'sie muss bei der Anlage die uid des Erstellers sein');
  ok(rr.hostUid['.validate'].indexOf("child('v').val() === 8") >= 0,
     'und es gibt sie nur in v8');
  for (const [pfad, regel] of [['seats', rr.seats['.write']], ['state', rr.state['.write']]]) {
    ok(regel.indexOf("child('hostUid').val() === auth.uid") >= 0,
       pfad + ': v8 fragt die Hostkennung');
    ok(regel.indexOf("child('players').child('0').child('uid').val() === auth.uid") >= 0,
       pfad + ': und der Altbestand weiterhin den Sitz 0');
    ok(regel.indexOf("child('v').val() === 8") >= 0,
       pfad + ': die beiden Wege sind versionsgetrennt');
  }
  // Der Zugpfad bleibt SITZgebunden - Host zu sein verleiht keinen fremden Zug.
  ok(rr.g.$gen.t.$turn.$pl['.write'].indexOf('hostUid') < 0,
     'der Zugpfad kennt keine Hostkennung - Host zu sein verleiht keinen fremden Zug');
}

// ══ F4. WAS ERST DER ECHTE MEHRBROWSER-TEST FAND ═════════════════════════════
// Zwei Fehler, die keine Quelltextpruefung und keine Attrappe gezeigt hat - beide
// traten erst auf, als vier echte Browser einem Raum beitraten, den ein ROT-Ersteller
// angelegt hatte.
{
  // (1) "Raum ist verwaist." bei JEDEM Beitritt.
  //     validateRoom() fragte fest nach p/0. In einem Raum mit rotem Ersteller sitzt der
  //     Host auf Sitz 2 - p/0 existiert dort gar nicht.
  const hs = new Function(`
    const FFA_MAX_SEATS=5;
    ${grab(/function roomHostSeat\(d\)\{[\s\S]*?\n\}/, 'roomHostSeat')}
    return roomHostSeat;
  `)();
  const raum = (hostUid, players) => ({ hostUid, players });
  ok(hs(raum('u2', { 2:{uid:'u2'}, 0:{uid:'u0'} })) === 2,
     'der Hostsitz wird aus der Hostkennung abgeleitet - hier Sitz 2');
  ok(hs(raum('u0', { 0:{uid:'u0'}, 2:{uid:'u2'} })) === 0, 'und hier Sitz 0');
  ok(hs(raum('', { 0:{uid:'u0'} })) === 0, 'ohne Kennung (v4-v7) gilt unveraendert Sitz 0');
  ok(hs(raum('unbekannt', { 0:{uid:'u0'} })) === 0,
     'und eine Kennung ohne passenden Sitz faellt sicher auf 0 zurueck');
  ok(hs(null) === 0 && hs({}) === 0, 'ein leerer Schnappschuss ergibt 0, nicht undefined');

  const vr3 = grab(/function validateRoom\(d\)\{[\s\S]*?\n\}/, 'validateRoom');
  ok(/const hs=roomHostSeat\(d\);/.test(vr3)
     && /if\(!p\|\|typeof p!=='object'\|\|!\(p\[hs\]&&p\[hs\]\.on===true\)\)/.test(vr3),
     'die Verwaisungspruefung fragt nach dem HOSTSITZ, nicht nach Sitz 0');
  ok(!/p\[0\]&&p\[0\]\.on===true/.test(vr3),
     'und nirgends mehr fest nach p/0');

  // (2) Der Spieler auf Sitz 0 sah die Hoststeuerung.
  //     Die Zuweisung von roomHostUid stand im Beitrittsweg HINTER einem Zeilenkommentar
  //     und war damit wirkungslos; isHost() fiel auf "Sitz 0" zurueck.
  ok((HTML.match(/roomHostUid=v\.hostUid\|\|'';/g) || []).length === 3,
     'alle drei Wege in einen Raum uebernehmen die Hostkennung');
  const imKommentar = HTML.split('\n').filter(z => {
    const i = z.indexOf('//');
    return i >= 0 && z.indexOf('roomHostUid=', i) > i;
  });
  ok(imKommentar.length === 0,
     'und keine dieser Zuweisungen steht hinter einem Zeilenkommentar');
  // Dieselbe Falle fuer die uebrigen Zuweisungen desselben Blocks.
  for (const feld of ['fbRoomMode=v.mode', 'fbRoomCap=Number.isInteger']) {
    const tot = HTML.split('\n').filter(z => {
      const i = z.indexOf('//');
      return i >= 0 && z.indexOf(feld, i) > i;
    });
    ok(tot.length === 0, 'auch "' + feld + '" steht nirgends im Kommentar');
  }

  // (3) Der GESPEICHERTE Ersatzname ist teambewusst - sonst kann die Anzeige nichts
  //     mehr richten: sie sieht einen echten Namen.
  const pr = grab(/function playerRecord\(seat,team2\)\{[^\n]*/, 'playerRecord');
  ok(/name:\(onlineName\|\|T\('col'\+\(team2\?\(fbTeam2Side\(seat\)===FB_TEAM2_BLUE\?0:1\):seat\)\)\)/.test(pr),
     'ohne getippten Namen speichert Team 2v2 die TEAMfarbe, sonst die Sitzfarbe');
  ok(/c=await claimSeat\(code,op,cap,fbTeam2SeatsOf\(wahl\),true\);/.test(HTML),
     'der Team-2v2-Beitritt gibt das ausdruecklich weiter');
  ok(/const rec0=playerRecord\(wirtSitz,fbo&&fbOnlineMode===FB_ONLINE_MODE_TEAM2\);/.test(HTML),
     'die Anlage ebenso');
  ok(/playerRecord\(myPlayer,fbTeam2Room\(\)\)/.test(HTML),
     'und eine spaetere Namensaenderung ebenso');
}

// ══ G. DER ZUGPFAD IST UNVERAENDERT - KEIN v9 ════════════════════════════════
// Das ist die wichtigste Zusicherung dieser Phase. v8 aendert Raumkopf und Lobby;
// die Bedeutung von g/<gen>/t/<turn>/<seat> bleibt exakt die von v7.
{
  ok(/const ONLINE_PROTOCOL_VERSION=8;/.test(HTML), 'die Protokollversion ist 8');
  const send = grab(/function onlineSendCommit\(idx,fx,fy,spin\)\{[\s\S]*?\n\}/, 'onlineSendCommit');
  ok(/writeTurnSlot\(myPlayer,\{k:TURN_MOVE,idx:myPlayer,dx:fx,dy:fy,sp:spin\|\|0\}\)/.test(send),
     'der Zug geht unveraendert als {k,idx,dx,dy,sp} in den Slot');
  ok(!/hash|salt|nonce|commitH|reveal/i.test(send), 'ohne Hash, ohne Salz, ohne Reveal');
  const slot = grab(/function writeTurnSlot\(s,payload,opts\)\{[\s\S]*?\n\}/, 'writeTurnSlot');
  ok(/rooms\/'\+ctx\.room\+'\/g\/'\+ctx\.gen\+'\/t\/'\+ctx\.turnNo\+'\/'\+s/.test(slot),
     'und in denselben Pfad wie in v7');
  ok(/runTransaction\(slotRef, current=>current==null\?payload:undefined, \{applyLocally:false\}\)/.test(slot),
     'write-once per Transaction, unveraendert');
  // Kein v9-Feld existiert - weder im Client noch in den Rules.
  for (const w of ['fbCommitHash', 'commitSalt', 'revealPath', 'deadlineAt', 'windowOpenAt'])
    ok(HTML.indexOf(w) < 0, 'kein v9-Rest im Client: ' + w);
  const rooms = JSON.parse(RULES).rules.rooms.$code;
  // Seit V9.1 traegt eine Generation zusaetzlich die v9-GRUNDLAGE d/c/ro/r, seit
  // V9.4B1 ausserdem s/z/q/x (Generationsstart, Protokollabschluss, Bereitschaft,
  // Protokoll-Disqualifikation). Jeder dieser Zweige ist an `v === 9` gebunden und
  // damit fuer jeden v8-Raum unerreichbar - die Aussage dieser Suite bleibt also
  // dieselbe, sie wird nur genauer: Phase A wird von v9 nicht angefasst.
  ok(Object.keys(rooms.g.$gen).sort().join(',') === 'c,d,e,q,r,ro,s,t,x,z',
     'eine Generation traegt Zughistorie, Eviction und die v9-Grundlage d/c/ro/r/s/z/q/x');
  for (const zweig of ['d', 'c', 'ro', 'r', 's', 'z', 'q', 'x'])
    ok(JSON.stringify(rooms.g.$gen[zweig]).indexOf("child('v').val() === 9") >= 0,
       'der Zweig ' + zweig + ' ist an v9 gebunden und damit in einem v8-Raum unerreichbar');
  const slotRegel = rooms.g.$gen.t.$turn.$pl;
  ok(Object.keys(slotRegel).filter(k => !k.startsWith('.') && k !== '$other').sort().join(',')
     === 'dx,dy,idx,k,sp',
     'der Zugslot traegt weiterhin genau k, idx, dx, dy, sp');
  ok(!/"h"|"ts"|"n"/.test(JSON.stringify(slotRegel)),
     'und kein Hash-, Zeitstempel- oder Salzfeld');
  // Die Rules tragen seit V9.1 die v9-Grundlage. Der CLIENT tut es ausdruecklich nicht:
  // er steht auf Protokoll 8, kennt keinen der neuen Pfade und kann folglich keinen
  // v9-Raum anlegen oder betreten. Genau das ist die Trennung, die diese Stufe schuetzt.
  ok(/const ONLINE_PROTOCOL_VERSION=8;/.test(HTML),
     'der freigegebene Client steht unveraendert auf Protokoll 8');
  for (const pfad of ["/d/'", "/c/'", "'d/'", "'c/'"])
    ok(HTML.indexOf("g/'+ctx.gen+'" + pfad) < 0,
       'der Client schreibt keinen v9-Pfad: ' + pfad);
  // Seit V9.3A liegt der v9-Codec (Vorlage, Salz, SHA-256) im Quelltext - RUHEND. Die
  // Aussage dieser Suite wird dadurch nicht schwaecher, sondern schaerfer: nicht "es gibt
  // keine Hashfunktion", sondern "sie wird von nirgendwo aufgerufen". Genau diese
  // Trennung schuetzt V9.3A; die Einbindung in den Zugpfad ist V9.3B.
  const codecStart = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
  // Der ruhende v9-Bereich umfasst seit V9.3B1 zwei Bloecke: den Codec und die
  // Protokollmaschine darunter. Die Aussage bleibt dieselbe - ausserhalb dieses
  // Bereichs nennt nichts eine v9-Funktion, also ruft ihn auch nichts auf.
  const codecEnde = HTML.indexOf('// ════ ENDE V9-BEREITSCHAFTSSTEUERUNG ════');
  ok(codecStart > 0 && codecEnde > codecStart, 'der ruhende v9-Bereich ist abgegrenzt');
  const codec = HTML.slice(codecStart, codecEnde);
  ok(HTML.split(codec).join('').indexOf('crypto.subtle') < 0,
     'JEDES Vorkommen von crypto.subtle liegt darin - keines im Spielpfad');
  ok(HTML.split(codec).join('').indexOf('fbV9') < 0,
     'ausserhalb nennt KEINE Zeile eine v9-Funktion - der Bereich ist unbenutzt');
  for (const fn of ['onlineSendCommit', 'writeTurnSlot', 'onlineArmTurn', 'maybeReveal',
                    'processSlot', 'applyLaunch', 'allAliveCommitted'])
    ok(grab(new RegExp('function ' + fn + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'), fn)
         .indexOf('fbV9') < 0,
       fn + '() ruht unveraendert - kein v9-Aufruf darin');
}

// ══ H. DIE SOLLBESETZUNG IST UNVERAENDERLICH ═════════════════════════════════
// config liegt unterhalb eines bestehenden Raums, und die Raumregel erlaubt dort nur
// Anlage oder Loeschung. Es gibt also gar keinen Schreibweg - auch nicht fuer den Host.
{
  const rooms = JSON.parse(RULES).rules.rooms.$code;
  ok(rooms['.write'].indexOf('!data.exists() && newData.exists()') >= 0,
     'ein bestehender Raum laesst sich nur noch loeschen, nicht beschreiben');
  ok(rooms.config['.write'] === undefined,
     'config traegt keine eigene Schreiberlaubnis - damit ist es unveraenderlich');
  ok(rooms.config.mode !== undefined && rooms.config.cap !== undefined,
     'Modus und Sollbesetzung sind benannte Felder, kein $other-Durchlass');
  ok(rooms.config.$other['.validate'] === false,
     'und jedes andere Konfigurationsfeld bleibt verboten');
  ok(rooms.seats['.validate'].indexOf("config/cap") >= 0,
     'das Startsignal wird gegen die Sollbesetzung geprueft');
  // Der Host bekommt keine neue Macht: er darf weiterhin nur den Lebenszyklus.
  ok(rooms.seats['.write'].indexOf("players').child('0').child('uid').val() === auth.uid") >= 0,
     'nur der Host schreibt das Startsignal - unveraendert');
  ok(rooms.state['.validate'].indexOf("newData.val() === 'playing' && data.val() === 'lobby'") >= 0,
     'und der Raumzustand bleibt eine Einbahn');
}

console.log('\nOnline-Phase-A: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
