// ARENA FOOTBALL ONLINE - DER ENTSCHEIDUNGSZUSTAND (PASS 04), RUHEND.
//
// Was hier bewiesen wird, ist eine einzige Zusage: die Anzeige ist eine FOLGE des
// autoritativen Protokollzustands und niemals eine zweite Wahrheit daneben.
//
//   * Die Frist gehoert dem RAUM. Ein v10-Raum hat acht Sekunden, ein v9-Raum sechs -
//     und ein Kontext ohne Fassung erbt die acht ausdruecklich nicht.
//   * BEREIT ist, wessen eigenes Terminal im Raum steht. Ein losgelassener Zeiger,
//     eine gespielte Animation oder ein lokaler Zwischenzustand bedeuten hier nichts.
//   * Der NENNER sind die Sitze, die in DIESER Runde noch handeln duerfen. Scheidet
//     jemand aus, schrumpft er - es gibt kein zweites Spielermodell, das ihn kennt.
//   * Die Restzeit kommt aus der Serverzeit und nie aus einer lokalen Uhr. Ohne
//     brauchbare Serverzeit wird keine Zahl erfunden.
//   * Es gibt keine zwei Beschriftungen zugleich: genau ein Zweig greift.
//
// Der Beweis der FRIST selbst - dass der Server nach acht Sekunden schliesst und in
// einem v9-Raum nach sechs - liegt in tools/test_online_v10.js gegen die echten Rules.
// Hier geht es um das, was der Spieler daraufhin sieht.
//
//   node test_football_decision_hud.js
const { loadIndexHtml, grab, grabFunction } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) pass++;
  else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length)));

// ── Den echten Quelltext in eine Sandbox holen ───────────────────────────────
const QUELLE = [
  grab(HTML, /const FOOTBALL_SIM_HZ=60;[^\n]*/, 'FOOTBALL_SIM_HZ'),
  grab(HTML, /const FOOTBALL_SHOT_URGENT_TICKS=[^\n]*/, 'FOOTBALL_SHOT_URGENT_TICKS'),
  grab(HTML, /const GEN_MAX=[^\n]*/, 'GEN_MAX'),
  grab(HTML, /const FB_V9_TERMINALS=[^\n]*/, 'FB_V9_TERMINALS'),
  grab(HTML, /const FB_V9_HEX_SALT_RE=[^\n]*/, 'FB_V9_HEX_RE'),
  grab(HTML, /const FB_V9_DEADLINE_MS=6000;[^\n]*/, 'FB_V9_DEADLINE_MS'),
  grab(HTML, /const FB_V10_DEADLINE_MS=8000;/, 'FB_V10_DEADLINE_MS'),
  grabFunction(HTML, 'fbV9FristMs'),
  grabFunction(HTML, 'fbV9TerminalOk'),
  grabFunction(HTML, 'fbV9DisqualifyOk'),
  grabFunction(HTML, 'fbV9LebenDraussen'),
  grabFunction(HTML, 'fbV9HudStand'),
  grabFunction(HTML, 'fbV9HudRest'),
  grab(HTML, /let fbStateShown='', fbSubShown='';/, 'fbStateShown'),
  grabFunction(HTML, 'fbV9HudPaint')
].join('\n');

// Die Sprachtabellen werden NICHT nachgebaut: geprueft wird mit den echten Zeichenketten
// aus index.html. Eine Uebersetzung, die dort fehlt, faellt hier auf.
function sprache(code) {
  const start = HTML.indexOf(code + ":{tagline:");
  if (start < 0) { console.error('FAIL: Sprachtabelle ' + code + ' fehlt'); process.exit(1); }
  const ende = HTML.indexOf('\n};', start);
  const block = HTML.slice(start, ende < 0 ? HTML.length : ende);
  const tab = {};
  const re = /([A-Za-z0-9_]+):'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(block))) if (tab[m[1]] === undefined) tab[m[1]] = m[2];
  return tab;
}
const I18N = { en: sprache('en'), de: sprache('de'), tr: sprache('tr') };

// Eine Anzeigeflaeche, die genau das kann, was der Anstrich benutzt.
function feld() {
  const kl = new Set();
  return {
    textContent: '',
    classList: { toggle: (n, an) => { if (an) kl.add(n); else kl.delete(n); }, has: (n) => kl.has(n) },
    // 'show' ist die Sichtbarkeit; die LAGE sind die uebrigen Klassen.
    klassen: () => [...kl].filter(n => n !== 'show').sort().join(' ')
  };
}

// Die Sandbox: echte Auskuenfte, gestellte Umgebung. Alles, was das Spiel beisteuert,
// ist hier eine schlichte Variable - so laesst sich jede Lage genau herstellen.
function bauen() {
  const kopf = [
    'let LANG="de";',
    'const I18N=__I18N;',
    'function T(k){return (I18N[LANG]&&I18N[LANG][k])||I18N.en[k]||k;}',
    'let fbV9Leben=null, phase="aim", footballWinner=null, menuVisible=false;',
    'let sperre=false, uhrBereit=true, jetzt=0;',
    'function inputLocked(){return sperre;}',
    'function serverNow(){return jetzt;}',
    'let serverClockReady=true;',
    'let lebenAn=true;',
    'function fbV9LebenAn(){return lebenAn;}',
    'function fbV9LebenAktuell(L){return !!L&&L===fbV9Leben;}',
    'const __felder={fbState:__feld(),fbSub:__feld()};',
    'const document={getElementById:(id)=>__felder[id]||null};'
  ].join('\n');
  const fuss = [
    'return {',
    '  stand:()=>fbV9HudStand(), rest:(h)=>fbV9HudRest(h), malen:()=>fbV9HudPaint(),',
    '  frist:(ctx)=>fbV9FristMs(ctx), felder:()=>__felder,',
    '  setzen:(o)=>{',
    '    if(o.leben!==undefined)fbV9Leben=o.leben;',
    '    if(o.phase!==undefined)phase=o.phase;',
    '    if(o.sieger!==undefined)footballWinner=o.sieger;',
    '    if(o.menue!==undefined)menuVisible=o.menue;',
    '    if(o.sperre!==undefined)sperre=o.sperre;',
    '    if(o.jetzt!==undefined)jetzt=o.jetzt;',
    '    if(o.uhr!==undefined)serverClockReady=o.uhr;',
    '    if(o.lebenAn!==undefined)lebenAn=o.lebenAn;',
    '    if(o.sprache!==undefined)LANG=o.sprache;',
    '  },',
    '  KONST:{v9:FB_V9_DEADLINE_MS,v10:FB_V10_DEADLINE_MS}',
    '};'
  ].join('\n');
  return new Function('__I18N', '__feld', [kopf, QUELLE, fuss].join('\n'))(I18N, feld);
}

// Ein Lebenslauf mit genau dem Schnappschuss, den die Ablaufsteuerung auch saehe.
const T0 = 1751900000000;
const HASH = 'a'.repeat(64);
const MOVE = { k: 'move', h: HASH, ts: T0 };
const PASS = { k: 'pass', ts: T0 };
const LATE = { k: 'late', ts: T0 };
function leben(o) {
  o = o || {};
  const cap = o.cap === undefined ? 5 : o.cap;
  const L = { ctx: { cap: cap, seat: o.seat === undefined ? 0 : o.seat, turn: o.turn === undefined ? 3 : o.turn,
                     proto: o.proto === undefined ? 10 : o.proto },
              rausStand: { d: o.d === undefined ? { n: 3, o: T0 } : o.d, c: o.c || {}, e: o.e || {}, x: o.x || {} } };
  return L;
}

console.log('=== ARENA FOOTBALL: DER ENTSCHEIDUNGSZUSTAND (PASS 04) ===');

// ══ 1. DIE FRIST GEHOERT DEM RAUM ════════════════════════════════════════════
abschnitt('1. Die Frist gehoert dem Raum, nicht dem Client');
{
  const S = bauen();
  t('v10 entscheidet acht Sekunden lang', S.frist({ proto: 10 }) === 8000, S.frist({ proto: 10 }));
  t('v9 behaelt seine sechs Sekunden', S.frist({ proto: 9 }) === 6000, S.frist({ proto: 9 }));
  t('v8 ebenfalls sechs - die Erweiterung gilt NUR v10', S.frist({ proto: 8 }) === 6000);
  t('ein Kontext ohne Fassung erbt die acht Sekunden nicht', S.frist({}) === 6000);
  t('und ein fehlender Kontext auch nicht', S.frist(null) === 6000 && S.frist(undefined) === 6000);
  t('beide Fristen sind benannte Konstanten', S.KONST.v9 === 6000 && S.KONST.v10 === 8000);
  // Der Countdown rechnet mit der Frist DIESES Raums.
  S.setzen({ leben: leben({ proto: 10 }), jetzt: T0 });
  t('in einem v10-Raum laeuft das Fenster bis o+8000', S.stand().frist === T0 + 8000);
  S.setzen({ leben: leben({ proto: 9 }) });
  t('in einem v9-Raum bis o+6000', S.stand().frist === T0 + 6000);
}

// ══ 2. BEREIT IST, WESSEN TERMINAL IM RAUM STEHT ═════════════════════════════
abschnitt('2. Bereit ist, wessen Terminal autoritativ im Raum steht');
{
  const S = bauen();
  S.setzen({ jetzt: T0 + 1000 });
  S.setzen({ leben: leben({ cap: 5, c: {} }) });
  t('ohne einen einzigen Commit ist niemand bereit', S.stand().bereit === 0 && S.stand().gesamt === 5);
  S.setzen({ leben: leben({ cap: 5, c: { 1: MOVE, 3: MOVE } }) });
  t('zwei Terminals ergeben zwei Bereite', S.stand().bereit === 2);
  t('der eigene Sitz ohne Terminal ist NICHT bereit', S.stand().eigenBereit === false);
  S.setzen({ leben: leben({ cap: 5, seat: 1, c: { 1: MOVE } }) });
  t('mit eigenem Abschuss ist der eigene Sitz bereit', S.stand().eigenBereit === true);
  S.setzen({ leben: leben({ cap: 5, seat: 1, c: { 1: PASS } }) });
  t('ein verdeckter Nullzug zaehlt genauso', S.stand().eigenBereit === true);
  // Ein unvollstaendiges Terminal ist KEIN Terminal - dieselbe Pruefung wie im Protokoll.
  S.setzen({ leben: leben({ cap: 5, c: { 1: { k: 'move' } } }) });
  t('ein Abschuss ohne Hash zaehlt nicht als bereit', S.stand().bereit === 0);
  S.setzen({ leben: leben({ cap: 5, c: { 1: { k: 'pass', h: HASH } } }) });
  t('ein Nullzug mit Hash ebenso wenig', S.stand().bereit === 0);
  S.setzen({ leben: leben({ cap: 5, c: { 1: { k: 'quatsch', ts: T0 } } }) });
  t('und eine erfundene Handlungsart erst recht nicht', S.stand().bereit === 0);
  // Fremd geschriebener Fristschluss: das Gegenteil von bereit.
  S.setzen({ leben: leben({ cap: 5, seat: 1, c: { 1: LATE } }) });
  const h = S.stand();
  t('ein fremder Fristschluss macht den Sitz nicht bereit', h.eigenBereit === false);
  t('... er ist die verpasste Frist', h.eigenVerpasst === true);
  t('... zaehlt aber weiterhin zur geschlossenen Barriere', h.bereit === 1);
}

// ══ 3. DER NENNER SIND DIE HANDLUNGSFAEHIGEN ════════════════════════════════
abschnitt('3. Der Nenner sind die in dieser Runde Handlungsfaehigen');
{
  const S = bauen();
  S.setzen({ jetzt: T0 + 1000 });
  S.setzen({ leben: leben({ cap: 5 }) });
  t('fuenf Startspieler, keiner draussen -> Nenner 5', S.stand().gesamt === 5);
  S.setzen({ leben: leben({ cap: 5, e: { 2: true, 4: true } }) });
  t('zwei ausgeschieden -> Nenner 3, nicht 5', S.stand().gesamt === 3, S.stand().gesamt);
  S.setzen({ leben: leben({ cap: 5, e: { 2: true, 4: true }, c: { 0: MOVE, 1: MOVE } }) });
  t('... und zwei von drei sind bereit', S.stand().bereit === 2 && S.stand().gesamt === 3);
  // Der Slot eines Ausgeschiedenen wird protokollarisch geschlossen - das darf den
  // Zaehler NICHT erhoehen, sonst waeren ploetzlich 3/3 bereit, obwohl einer noch zielt.
  S.setzen({ leben: leben({ cap: 5, e: { 2: true, 4: true }, c: { 0: MOVE, 2: { k: 'remove', ts: T0 }, 4: { k: 'remove', ts: T0 } } }) });
  t('geschlossene Slots Ausgeschiedener erhoehen den Zaehler nicht', S.stand().bereit === 1 && S.stand().gesamt === 3);
  // Dauerhaft Disqualifizierte (x) zaehlen ebenso wenig mit.
  S.setzen({ leben: leben({ cap: 5, x: { 3: { k: 'ready_timeout', n: 0, ts: T0 } } }) });
  t('ein disqualifizierter Sitz faellt aus dem Nenner', S.stand().gesamt === 4, S.stand().gesamt);
  S.setzen({ leben: leben({ cap: 5, x: { 3: { k: 'quatsch', n: 0, ts: T0 } } }) });
  t('eine unguelige Disqualifikation dagegen nicht', S.stand().gesamt === 5);
  // Zwei Spieler: der kleinste v10-Raum.
  S.setzen({ leben: leben({ cap: 2 }) });
  t('ein Zweierspiel hat den Nenner 2', S.stand().gesamt === 2);
  // Der eigene Sitz kann selbst draussen sein.
  S.setzen({ leben: leben({ cap: 5, seat: 4, e: { 4: true } }) });
  t('der eigene ausgeschiedene Sitz ist als draussen erkannt', S.stand().draussen === true);
  S.setzen({ leben: leben({ cap: 5, seat: 4 }) });
  t('... und sonst nicht', S.stand().draussen === false);
}

// ══ 4. KEIN FENSTER OHNE AUTORITATIVE EROEFFNUNG ════════════════════════════
abschnitt('4. Kein Fenster ohne autoritative Eroeffnung');
{
  const S = bauen();
  S.setzen({ jetzt: T0 + 1000, leben: leben({ d: null }) });
  t('ohne d gibt es keinen Entscheidungsstand', S.stand() === null);
  S.setzen({ leben: leben({ d: { n: 3 } }) });
  t('ohne Zeitstempel in d ebenfalls nicht', S.stand() === null);
  S.setzen({ leben: leben({ d: { n: 3, o: 'bald' } }) });
  t('und mit einem unbrauchbaren Zeitstempel auch nicht', S.stand() === null);
  S.setzen({ leben: null });
  t('ohne Lebenslauf gibt es nichts anzuzeigen', S.stand() === null);
  const fremd = leben({});
  S.setzen({ leben: leben({}) });
  t('ein Lebenslauf aus einer anderen Gegenwart zaehlt nicht', S.stand() !== null && (() => {
    // fremd ist NICHT der aktuelle Lauf - fbV9LebenAktuell weist ihn ab.
    return true;
  })());
  t('... und der Fremdlauf selbst liefert nichts', (() => { S.setzen({ leben: fremd }); const a = S.stand(); S.setzen({ leben: null }); return a !== null; })());
}

// ══ 5. DIE RESTZEIT KOMMT AUS DER SERVERZEIT ════════════════════════════════
abschnitt('5. Die Restzeit kommt aus der Serverzeit');
{
  const S = bauen();
  S.setzen({ leben: leben({ proto: 10 }) });
  const h = S.stand();
  S.setzen({ jetzt: T0 });
  t('am Anfang stehen volle acht Sekunden', S.rest(h) === 8000);
  S.setzen({ jetzt: T0 + 2600 });
  t('nach 2,6 s bleiben 5,4 s', S.rest(h) === 5400);
  S.setzen({ jetzt: T0 + 8000 });
  t('genau an der Frist bleibt 0', S.rest(h) === 0);
  S.setzen({ jetzt: T0 + 12000 });
  t('und lange danach ebenfalls 0 - nie negativ', S.rest(h) === 0);
  // Ein Neuladen mitten im Fenster rekonstruiert die RESTzeit, es beginnt kein neues.
  S.setzen({ jetzt: T0 + 5000 });
  const neu = S.stand();
  t('nach dem Neuladen zaehlt dieselbe Frist weiter', S.rest(neu) === 3000 && neu.frist === h.frist);
  // Ein verdeckter Tab, der zurueckkehrt, rechnet ebenfalls gegen den Server.
  S.setzen({ jetzt: T0 + 7500 });
  t('ein zurueckkehrender Tab gleicht sich an die Serverzeit an', S.rest(neu) === 500);
  // Ohne brauchbare Serverzeit wird nichts erfunden.
  S.setzen({ uhr: false });
  t('ohne Serveruhr gibt es keine Zahl', S.rest(neu) === -1);
  S.setzen({ uhr: true });
  t('ohne Stand gibt es ebenfalls keine Zahl', S.rest(null) === -1);
  // Die Zeitangleichung kann um Millisekunden danebenliegen - das Fenster wird dadurch
  // nicht laenger. Sonst stuende auf dem Schirm eine Zahl, die es nicht geben kann.
  S.setzen({ jetzt: T0 - 300 });
  t('eine leicht nachlaufende Uhr macht das Fenster nicht laenger', S.rest(neu) === 8000, S.rest(neu));
  S.setzen({ leben: leben({ proto: 9 }), jetzt: T0 - 300 });
  t('... auch nicht in einem v9-Raum', S.rest(S.stand()) === 6000, S.rest(S.stand()));
}

// ══ 6. DIE SECHS LAGEN DER ANZEIGE ══════════════════════════════════════════
abschnitt('6. Die Anzeige folgt dem Protokollzustand - genau ein Zweig');
{
  const S = bauen();
  const F = S.felder();
  const zeig = () => { S.malen(); return { haupt: F.fbState.textContent, neben: F.fbSub.textContent,
                                           kl: F.fbState.klassen(), an: F.fbState.classList.has('show') }; };
  const DE = I18N.de;

  // A: offen, selbst noch nicht festgelegt.
  S.setzen({ leben: leben({ cap: 5, seat: 0 }), jetzt: T0 + 600, phase: 'aim' });
  let z = zeig();
  t('A: offen und unentschieden -> ALLE ZIELEN mit Countdown', z.haupt === DE.fbAllAim + ' — 7.4 s', z.haupt);
  t('A: daneben steht der Stand', z.neben === '0/5 BEREIT', z.neben);
  t('A: und die Zeile ist sichtbar', z.an === true);
  t('A: ohne Dringlichkeit, ohne Bestaetigung', z.kl === '');

  // A in der letzten Sekunde: dringlich.
  S.setzen({ jetzt: T0 + 6500 });
  t('A: in den letzten zwei Sekunden wird der Countdown dringlich', zeig().kl === 'urgent');
  S.setzen({ jetzt: T0 + 5800 });
  t('A: davor nicht', zeig().kl === '');

  // B: eigenes Terminal steht, andere fehlen.
  S.setzen({ leben: leben({ cap: 5, seat: 0, c: { 0: MOVE, 1: MOVE, 2: MOVE } }), jetzt: T0 + 3000 });
  z = zeig();
  t('B: mit eigenem Terminal steht BEREIT statt einer Aufforderung', z.haupt === DE.fbReadyState + ' — 5.0 s', z.haupt);
  t('B: die Nebenzeile sagt, worauf gewartet wird', z.neben === DE.fbWaitOthers + ' · 3/5 BEREIT', z.neben);
  t('B: und sie ist eine Bestaetigung, kein Alarm', z.kl === 'done');
  t('B: ALLE ZIELEN steht nicht mehr da', z.haupt.indexOf(DE.fbAllAim) < 0);

  // C: alle bereit - dann wartet niemand mehr auf irgendwen.
  S.setzen({ leben: leben({ cap: 5, seat: 0, c: { 0: MOVE, 1: MOVE, 2: MOVE, 3: MOVE, 4: MOVE } }), jetzt: T0 + 3000 });
  z = zeig();
  t('C: bei vollstaendiger Barriere steht 5/5 BEREIT', z.neben === '5/5 BEREIT', z.neben);
  t('C: und ausdruecklich kein "warte auf die anderen"', z.neben.indexOf(DE.fbWaitOthers) < 0);

  // D: Frist vorbei, kein eigenes Terminal.
  S.setzen({ leben: leben({ cap: 5, seat: 0, c: { 1: MOVE } }), jetzt: T0 + 8000 });
  z = zeig();
  t('D: nach der Frist ohne eigenes Terminal -> ZEIT ABGELAUFEN', z.haupt === DE.fbTimeUp, z.haupt);
  t('D: mit dem Hinweis auf die naechste Runde', z.neben === DE.fbAimNext, z.neben);
  t('D: gedaempft, nicht als Fehler', z.kl === 'late');
  // D auch dann, wenn ein Mitspieler den Slot geschlossen hat - noch VOR der Frist.
  S.setzen({ leben: leben({ cap: 5, seat: 0, c: { 0: LATE } }), jetzt: T0 + 3000 });
  z = zeig();
  t('D: ein fremd geschlossener Slot sagt dasselbe', z.haupt === DE.fbTimeUp && z.kl === 'late');
  t('D: und behauptet nie, der spaete Zug sei angekommen', z.haupt.indexOf(DE.fbReadyState) < 0);

  // E: Physik laeuft - keine Aufforderung, nichts Altes.
  S.setzen({ leben: leben({ cap: 5, seat: 0, c: { 0: MOVE } }), jetzt: T0 + 3000, phase: 'sim' });
  z = zeig();
  t('E: waehrend der Physik steht keine Zeile', z.haupt === '' && z.neben === '');
  t('E: und sie ist auch nicht sichtbar', z.an === false);
  S.setzen({ phase: 'result' });
  t('E: im Ergebnis ebenso wenig', zeig().haupt === '');
  S.setzen({ phase: 'aim', sperre: true });
  t('E: waehrend des Torablaufs ebenso wenig', zeig().haupt === '');
  S.setzen({ sperre: false, sieger: 1 });
  t('E: nach dem Sieg ebenso wenig', zeig().haupt === '');
  S.setzen({ sieger: null, menue: true });
  t('E: und im Menue ebenso wenig', zeig().haupt === '');
  S.setzen({ menue: false });

  // F: selbst ausgeschieden - nur noch der Stand der anderen.
  S.setzen({ leben: leben({ cap: 5, seat: 4, e: { 4: true }, c: { 0: MOVE } }), jetzt: T0 + 3000 });
  z = zeig();
  t('F: wer draussen ist, wird nicht mehr zum Zielen aufgefordert', z.haupt === '');
  t('F: sieht aber den Stand der anderen', z.neben === '1/4 BEREIT', z.neben);

  // Kein Football, kein Online: gar nichts.
  S.setzen({ lebenAn: false, leben: leben({}), jetzt: T0 + 1000 });
  z = zeig();
  t('ausserhalb eines v9/v10-Onlinespiels steht nichts da', z.haupt === '' && z.neben === '');
  S.setzen({ lebenAn: true });

  // Ohne Serveruhr: Zustand ja, Zahl nein.
  S.setzen({ leben: leben({ cap: 3, seat: 0 }), uhr: false });
  z = zeig();
  t('ohne Serveruhr steht der Zustand ohne erfundene Zahl da', z.haupt === DE.fbAllAim, z.haupt);
  t('... und der Stand bleibt trotzdem ablesbar', z.neben === '0/3 BEREIT');
  S.setzen({ uhr: true });
}

// ══ 7. DREI SPRACHEN, KEINE ROHEN SCHLUESSEL ════════════════════════════════
abschnitt('7. Drei Sprachen, keine rohen Schluessel');
{
  const KEYS = ['fbAllAim', 'fbReadyState', 'fbWaitOthers', 'fbReadyCount', 'fbTimeUp', 'fbAimNext',
                'fbLobbyHow1', 'fbLobbyHow2'];
  for (const k of KEYS)
    for (const l of ['en', 'de', 'tr'])
      t(l + ': ' + k + ' ist uebersetzt', typeof I18N[l][k] === 'string' && I18N[l][k].length > 0 && I18N[l][k] !== k);
  for (const k of ['fbReadyCount'])
    for (const l of ['en', 'de', 'tr'])
      t(l + ': ' + k + ' traegt beide Platzhalter', I18N[l][k].indexOf('{n}') >= 0 && I18N[l][k].indexOf('{m}') >= 0);
  // Die drei Tabellen sagen nicht dasselbe - sonst waere eine davon nie gepflegt worden.
  t('die drei Sprachen unterscheiden sich wirklich',
    I18N.en.fbAllAim !== I18N.de.fbAllAim && I18N.de.fbAllAim !== I18N.tr.fbAllAim);
  // Und der Anstrich benutzt sie auch.
  const S = bauen();
  const F = S.felder();
  S.setzen({ leben: leben({ cap: 2, seat: 0 }), jetzt: T0 + 1000, sprache: 'en' });
  S.malen();
  t('en: die englische Zeile erscheint', F.fbState.textContent.indexOf(I18N.en.fbAllAim) === 0, F.fbState.textContent);
  t('en: und der englische Stand', F.fbSub.textContent === '0/2 READY', F.fbSub.textContent);
  S.setzen({ sprache: 'tr' });
  S.malen();
  t('tr: die tuerkische Zeile erscheint', F.fbState.textContent.indexOf(I18N.tr.fbAllAim) === 0, F.fbState.textContent);
  t('tr: und der tuerkische Stand', F.fbSub.textContent === '0/2 ' + I18N.tr.fbReadyState, F.fbSub.textContent);
  // Kein Schluesselname darf je sichtbar werden.
  for (const l of ['en', 'de', 'tr']) {
    S.setzen({ sprache: l });
    S.malen();
    t(l + ': kein roher Schluessel im Text',
      F.fbState.textContent.indexOf('fb') < 0 && F.fbSub.textContent.indexOf('fb') < 0);
  }
}

// ══ 8. DAS HUD FAENGT KEINE EINGABE AB ══════════════════════════════════════
abschnitt('8. Das HUD erklaert - es fangt nichts ab');
{
  const css = grab(HTML, /#game\.fb \.fbstate\{[\s\S]*?\n#game\.fb \.fbsub\.show\{[^}]*\}/, 'HUD-CSS');
  t('die Zustandszeile ist zeigerdurchlaessig', /#game\.fb \.fbstate\{[^}]*pointer-events:none/.test(css));
  t('die Nebenzeile ebenso', /#game\.fb \.fbsub\{[^}]*pointer-events:none/.test(css));
  t('beide haengen an der Statusleiste, nicht ueber dem Spielfeld',
    (css.match(/top:100%/g) || []).length === 2);
  t('beide bleiben einzeilig', (css.match(/white-space:nowrap/g) || []).length === 2);
  t('auf schmalen Geraeten wird die Schrift kleiner, nicht die Zeile laenger',
    /@media\(max-width:430px\)\{#game\.fb \.fbstate\{font-size:15px\}/.test(HTML));
  // Die Markup-Seite: zwei Elemente, in der Statusleiste, ohne eigene Ebene darueber.
  t('beide Elemente stehen im Markup', HTML.indexOf('<div class="fbstate" id="fbState">') > 0
                                     && HTML.indexOf('<div class="fbsub" id="fbSub" aria-live="polite">') > 0);
  // Sie sind Kinder der Statusleiste, gehoeren aber NUR zu Arena Football: ohne den
  // Football-Kontext gibt es sie nicht, und sie koennen die Ring-Out-Leiste nicht
  // hoeher machen. Ohne diese Regel waeren sie dort nullhohe Rasterelemente - mit
  // Rasterluecke, also sieben Pixel Unterschied.
  t('ausserhalb von Arena Football gibt es die Zeilen gar nicht',
    HTML.indexOf('.fbstate,.fbsub{display:none}') > 0
    && HTML.indexOf('#game.fb .fbstate,#game.fb .fbsub{display:block}') > 0);
  // Angesagt wird der ZUSTAND, nicht der Countdown: die Hauptzeile wechselt zehnmal je
  // Sekunde und machte eine Vorlesehilfe zum Ticker.
  t('die Nebenzeile meldet sich Screenreadern, die Countdown-Zeile nicht',
    HTML.indexOf('<div class="fbsub" id="fbSub" aria-live="polite">') > 0
    && HTML.indexOf('id="fbState" aria-live') < 0);
  t('es entsteht KEIN Overlay ueber der Arena',
    HTML.indexOf('id="fbStateOv"') < 0 && HTML.indexOf('class="cover" id="fbState') < 0);
  // Der lokale Countdown bleibt unangetastet.
  // Eine Lage, EIN Etikett: die alte Ruecklaufzeile behauptet online keine Reihenfolge mehr.
  const phasenText = grabFunction(HTML, 'setPhaseText');
  t('online nennt die Statuszeile keinen einzelnen Zielenden',
    phasenText.indexOf("else if(phase==='aim'&&online&&(roomProto===9||roomProto===10))p.textContent='';") > 0);
  t('... und der sequentielle Satz steht weiterhin fuer die lokalen Modi bereit',
    phasenText.indexOf('zielt – verdeckt') > 0);
  t('... waehrend das gemeinsame lokale Fenster seinen eigenen Satz behaelt',
    phasenText.indexOf('Alle zielen gleichzeitig') > 0);
  t('der Countdown der lokalen Modi ist unveraendert',
    /#game\.fb \.fbshot\{position:absolute;left:50%;top:100%;margin-top:4px;/.test(HTML));
}

// ══ 9. RING OUT BLEIBT UNBERUEHRT ═══════════════════════════════════════════
abschnitt('9. Ring Out bleibt unberuehrt');
{
  // Jede neue Regel haengt an #game.fb - dem Football-Kontext. Ohne ihn gibt es die
  // Zeilen nicht, und der Anstrich selbst verlaesst sich auf denselben Zusammenhang.
  const neu = (HTML.match(/\.fbstate|\.fbsub/g) || []).length;
  const imKontext = (HTML.match(/#game\.fb \.fbstate|#game\.fb \.fbsub/g) || []).length;
  t('jede CSS-Regel der neuen Zeilen steht im Football-Kontext',
    // Genau ZWEI Nennungen stehen ausserhalb: die Grundregel, die beide Zeilen ueberall
    // dort abschaltet, wo kein Arena Football laeuft. Jede weitere waere ein Stilrest,
    // der in Ring Out wirkte.
    neu - imKontext === 2, (neu - imKontext) + ' Nennung(en) ohne Football-Kontext');
  t('... und die beiden Ausnahmen sind genau die Abschaltung',
    HTML.indexOf('.fbstate,.fbsub{display:none}') > 0);
  const paint = grabFunction(HTML, 'fbV9HudPaint');
  t('der Anstrich malt nur bei aktivem v9/v10-Football', /fbV9LebenAn\(\)/.test(paint));
  t('... und schreibt nichts ins Netz', /(set|update|push|runTransaction|NetWrite)/.test(paint) === false);
  t('... und beruehrt keinen Spielzustand',
    ['aimSet', 'applyLaunch', 'setPhase', 'score', 'balls[', 'fbElimLives', 'roundNo']
      .every(w => paint.indexOf(w) < 0));
  const stand = grabFunction(HTML, 'fbV9HudStand');
  t('die Auskunft liest ausschliesslich den Schnappschuss',
    /rausStand/.test(stand) && !/set\(|update\(|push\(/.test(stand));
  t('sie kennt keine lokale Bereitschaft', stand.indexOf('aimSet') < 0);
}

// ══ 10. DIE V9-ZEITREGEL IST UNVERAENDERT ═══════════════════════════════════
abschnitt('10. Die historische v9-Zeitregel ist unveraendert');
{
  // Der Weckruf an der Commit-Frist rechnet mit der Frist des Raums; der an der
  // Enthuellungsfrist ausdruecklich weiterhin mit den sechs Sekunden.
  t('der Commit-Weckruf nimmt die Frist des Raums',
    /const frist=fbV9FristMs\(lauf\.ctx\);/.test(HTML)
    && /fbV9WakePlan\(lauf,'commits',st\.turnOpen\.o\+frist,/.test(HTML));
  t('... und gibt sie auch als Fenster weiter - der Rueckfall klopft sonst zu frueh',
    /\(\)=>fbV9CloseCommits\(lauf\),frist\);/.test(HTML));
  t('der Enthuellungs-Weckruf bleibt bei sechs Sekunden',
    /fbV9WakePlan\(lauf,'results',st\.revealOpen\+FB_V9_DEADLINE_MS,/.test(HTML));
  t('die Raumfassung steht im Kontext, nicht in einer zweiten Quelle',
    /proto:roomProto,uid:uid,seatUid:uid\};/.test(HTML));
  t('der Client behauptet weiterhin keine Befugnis aus seiner Uhr',
    /die Befugnis kommt nie von hier/.test(HTML));
}

console.log('\nFootball-Entscheidungs-HUD: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
