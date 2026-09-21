// ARENA FOOTBALL - Namensschilder ueber den Figuren.
//
// Arena Football zeigt den eingegebenen Namen jedes Teilnehmers ueber seiner Figur. Gemalt
// wird mit DEMSELBEN Code, den Ring Out seit jeher benutzt (drawBall, Abschnitt 6) - nur die
// Sichtbarkeitsregel unterscheidet sich, und die steht an genau einer Stelle: nameLabelOn().
//
// Geprueft werden ECHTE Funktionen aus index.html gegen einen aufzeichnenden Zeichenkontext.
// Nichts ist nachgebaut: drawBall, nameLabelOn, pName, nameForSeat, sanitizeName, ncol,
// colorSlot, OP und mkBall kommen woertlich aus dem Produkt. Aufgezeichnet wird, WELCHER Text
// mit WELCHER Schrift an WELCHER Stelle landet - und damit auch, was NICHT beschriftet wird.
//
// Die harten Zusagen, die hier fallen sollen, wenn sie jemand bricht:
//   - der neutrale Ball bekommt NIE ein Namensschild,
//   - zwei bis fuenf Figuren bekommen genau ihre eigenen Namen, ohne Dopplung und ohne Tausch,
//   - ein neuer Raum zeigt nie mehr den Namen aus dem alten,
//   - ein Rundenreset (frische Kugelobjekte) beschriftet weiter richtig,
//   - Ring Out verhaelt sich Zeichen fuer Zeichen wie vorher.
const { loadIndexHtml, grab, grabFunction } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
};
const abschnitt = (s) => console.log('\n== ' + s + ' ==');

// Die Sprachtabellen werden NICHT nachgebaut: der Rueckfallname eines Sitzes ohne Eintrag
// ist die echte Zeichenkette aus index.html.
function sprache(code) {
  const start = HTML.indexOf(code + ':{tagline:');
  if (start < 0) { console.error('FAIL: Sprachtabelle ' + code + ' fehlt'); process.exit(1); }
  const ende = HTML.indexOf('\n};', start);
  const block = HTML.slice(start, ende < 0 ? HTML.length : ende);
  const tab = {}; const re = /([A-Za-z0-9_]+):'((?:[^'\\]|\\.)*)'/g; let m;
  while ((m = re.exec(block))) if (tab[m[1]] === undefined) tab[m[1]] = m[2];
  return tab;
}
const I18N = { en: sprache('en'), de: sprache('de'), tr: sprache('tr') };

// ── Ein Zeichenkontext, der genau das kann, was drawBall benutzt - und sich merkt,
//    welcher Text wohin ging. measureText ist bewusst schlicht und deterministisch:
//    die Kuerzung soll ueber eine BREITE entscheiden, nicht ueber eine Zeichenzahl.
const ctx = {
  font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '',
  lineWidth: 0, lineJoin: '', lineCap: '', letterSpacing: '',
  shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, globalAlpha: 1,
  _stapel: [], texte: [],
  save() { this._stapel.push({ font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle }); },
  restore() { const s = this._stapel.pop(); if (s) { this.font = s.font; this.fillStyle = s.fillStyle; this.strokeStyle = s.strokeStyle; } },
  beginPath() {}, arc() {}, ellipse() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {},
  translate() {}, rotate() {}, fillRect() {}, clearRect() {}, setLineDash() {},
  createRadialGradient() { return { addColorStop() {} }; },
  _em() { const m = /(\d+(?:\.\d+)?)px/.exec(this.font); return m ? Number(m[1]) * 0.55 : 6; },
  measureText(s) { return { width: s.length * this._em() }; },
  fillText(s, x, y) { this.texte.push({ art: 'fill', s, x, y, font: this.font, farbe: this.fillStyle }); },
  strokeText(s, x, y) { this.texte.push({ art: 'stroke', s, x, y, font: this.font, farbe: this.strokeStyle }); }
};

// Die 3D-Projektion: eine feste, nachvollziehbare Perspektive. Sie muss nur zwei Dinge
// koennen - den Punkt verschieben und den Massstab mitliefern.
const r3d = { w2s: (lx, ly, h) => ({ x: lx * 1.5 + 40, y: ly * 1.5 - (h || 0) * 1.5 + 20, s: 1.5 }) };

const QUELLE = [
  grab(HTML, /const NAME_COL=\[[^\n]*/, 'NAME_COL'),
  grab(HTML, /const FB_NAME_COL=\[[^\n]*/, 'FB_NAME_COL'),
  grab(HTML, /const NAME_MAX=\d+;[^\n]*/, 'NAME_MAX'),
  grab(HTML, /const NAME_MAX_UNITS=\d+;[^\n]*/, 'NAME_MAX_UNITS'),
  grab(HTML, /const FOOTBALL_NEUTRAL_OWNER=\d+;[^\n]*/, 'FOOTBALL_NEUTRAL_OWNER'),
  grab(HTML, /const FOOTBALL_VARIANT_TACTICAL='[^']*';/, 'FOOTBALL_VARIANT_TACTICAL'),
  grab(HTML, /const FOOTBALL_VARIANT_TEAM2='[^']*';/, 'FOOTBALL_VARIANT_TEAM2'),
  grab(HTML, /const FOOTBALL_VARIANT_ELIM4='[^']*';/, 'FOOTBALL_VARIANT_ELIM4'),
  grabFunction(HTML, 'capGraphemes'),
  grabFunction(HTML, 'sanitizeName'),
  grabFunction(HTML, 'nameForSeat'),
  grab(HTML, /function pName\(p\)\{[^\n]*/, 'pName'),
  grab(HTML, /function ncol\(i\)\{[^\n]*/, 'ncol'),
  grab(HTML, /function colorSlot\(owner\)\{[^\n]*/, 'colorSlot'),
  grab(HTML, /function fbTactical\(\)\{[^\n]*/, 'fbTactical'),
  grab(HTML, /function fbTeam2\(\)\{[^\n]*/, 'fbTeam2'),
  grab(HTML, /function fbTeam2Side\(o\)\{[^\n]*/, 'fbTeam2Side'),
  grab(HTML, /function OP\(lx,ly,h\)\{[^\n]*/, 'OP'),
  grab(HTML, /function mkBall\(x,y,owner\)\{[^\n]*/, 'mkBall'),
  grabFunction(HTML, 'nameLabelOn'),
  grabFunction(HTML, 'drawBall')
].join('\n');

const KOPF = [
  'let LANG="de"; const I18N=__I18N; const ctx=__ctx; const r3d=__r3d;',
  'function T(k){return (I18N[LANG]&&I18N[LANG][k])||I18N.en[k]||k;}',
  // Spielzustand, den drawBall liest. Startwert: ein laufendes Online-Football-Match.
  'let mode="football", phase="aim", menuVisible=false, online=true, myPlayer=0;',
  // Die Variante setzt jeder Abschnitt selbst - ueber die ECHTEN Konstanten aus dem
  // Produkt (M.V), nicht ueber nachgetippte Zeichenketten.
  'let fbVariant="", fmt="ffa", playersRoster={};',
  'let r3dActive=false, BR=16, R=300, cx=400, cy=300;',
  // Rein farbliche Nachbarschaft: fuer das Namensschild belanglos, fuer drawBall noetig.
  'function teamOf(o){return o&1;}',
  'function viewAngle(){return 0;}',
  'function pcol(){return {c:"#101010",lt:"#202020",dk:"#000000",gl:"10,20,30",rgb:"10,20,30"};}'
].join('\n');

const FUSS = `
return {
  drawBall, nameLabelOn, pName, nameForSeat, sanitizeName, mkBall, ncol,
  NEUTRAL: FOOTBALL_NEUTRAL_OWNER, NAME_MAX, FB_NAME_COL,
  V: { tactical: FOOTBALL_VARIANT_TACTICAL, team2: FOOTBALL_VARIANT_TEAM2, elim4: FOOTBALL_VARIANT_ELIM4 },
  setz(o){
    if('mode' in o) mode=o.mode;
    if('phase' in o) phase=o.phase;
    if('menuVisible' in o) menuVisible=o.menuVisible;
    if('online' in o) online=o.online;
    if('myPlayer' in o) myPlayer=o.myPlayer;
    if('fbVariant' in o) fbVariant=o.fbVariant;
    if('fmt' in o) fmt=o.fmt;
    if('playersRoster' in o) playersRoster=o.playersRoster;
    if('r3dActive' in o) r3dActive=o.r3dActive;
    if('BR' in o) BR=o.BR;
    if('LANG' in o) LANG=o.LANG;
  },
  lies(){ return {mode,phase,menuVisible,online,myPlayer,fbVariant,fmt,r3dActive,playersRoster}; }
};`;

const M = new Function('__I18N', '__ctx', '__r3d', [KOPF, QUELLE, FUSS].join('\n'))(I18N, ctx, r3d);

// Ein Bild zeichnen und NUR die Namensschilder zurueckgeben. Das Kugellabel (die Ziffer)
// traegt Schriftschnitt 900, das Namensschild 800 - die Unterscheidung ist Teil der Zusage.
function schilder(kugeln) {
  ctx.texte.length = 0;
  for (const b of kugeln) if (b.alive) M.drawBall(b);
  return ctx.texte.filter(e => e.art === 'fill' && /^800 /.test(e.font));
}
// Eine Football-Aufstellung: n Figuren auf einem Kreis plus der neutrale Ball in der Mitte.
function aufstellung(n) {
  const k = [];
  for (let i = 0; i < n; i++) k.push(M.mkBall(400 + Math.cos(i * 2 * Math.PI / n) * 120, 300 + Math.sin(i * 2 * Math.PI / n) * 120, i));
  k.push(M.mkBall(400, 300, M.NEUTRAL));
  return k;
}
const roster = (...namen) => {
  const p = {};
  namen.forEach((n, s) => { p[s] = { id: 'pid' + s, name: n, tab: 'tab' + s, uid: 'uid' + s }; });
  return p;
};

// ══ 1. DIE SICHTBARKEITSREGEL - EINE STELLE, ZWEI SPIELE ════════════════════════
abschnitt('1. nameLabelOn: wer traegt ein Schild?');
{
  const kugel = (o) => ({ x: 0, y: 0, vx: 0, vy: 0, owner: o, alive: true, spin: 0 });

  // RING OUT bleibt Zeichen fuer Zeichen, wie es war: sichtbar ausser in der Simulation.
  M.setz({ mode: 'ffa', menuVisible: false });
  for (const ph of ['aim', 'reveal', 'result', 'over']) {
    M.setz({ phase: ph });
    t('Ring Out zeigt den Namen in Phase ' + ph, M.nameLabelOn(kugel(0)) === true);
  }
  M.setz({ phase: 'sim' });
  t('Ring Out blendet den Namen in der Simulation aus', M.nameLabelOn(kugel(0)) === false);
  // Und das Menue aendert an Ring Out NICHTS - die Regel dort ist unveraendert phasengebunden.
  M.setz({ menuVisible: true, phase: 'aim' });
  t('Ring Out: das Menue aendert die Regel nicht (keine Regression)', M.nameLabelOn(kugel(0)) === true);
  M.setz({ phase: 'sim' });
  t('Ring Out: im Menue gilt weiter dieselbe Phasenregel', M.nameLabelOn(kugel(0)) === false);
  M.setz({ menuVisible: false });

  // ARENA FOOTBALL: durchgehend sichtbar - auch waehrend der Physik.
  M.setz({ mode: 'football', fbVariant: M.V.elim4 });
  for (const ph of ['aim', 'reveal', 'sim', 'result', 'over']) {
    M.setz({ phase: ph });
    t('Football zeigt den Namen in Phase ' + ph, M.nameLabelOn(kugel(0)) === true);
  }

  // Der neutrale Ball: in KEINER Phase, in KEINER Variante.
  let neutralJe = false;
  for (const v of [M.V.elim4, M.V.team2, M.V.tactical, 'shell']) {
    for (const ph of ['aim', 'reveal', 'sim', 'result', 'over']) {
      M.setz({ fbVariant: v, phase: ph });
      if (M.nameLabelOn(kugel(M.NEUTRAL))) neutralJe = true;
    }
  }
  t('der neutrale Ball traegt in keiner Phase und keiner Variante ein Schild', neutralJe === false);
  t('... und FOOTBALL_NEUTRAL_OWNER ist die Kennung, die dabei gilt', M.NEUTRAL === 5, M.NEUTRAL);

  // Menue-Vorspiel: dort laeuft kein Match.
  M.setz({ fbVariant: M.V.elim4, phase: 'aim', menuVisible: true });
  t('Football: das Menue-Vorspiel bleibt ohne Schilder', M.nameLabelOn(kugel(0)) === false);
  M.setz({ menuVisible: false });

  // Tactical: eine Identitaet, zwei Figuren - und BEIDE tragen ihren Namen. Genau das ist
  // dort die Auskunft, die zaehlt: welche zwei Koerper zu wem gehoeren (2026-09-21).
  M.setz({ fbVariant: M.V.tactical });
  t('Football Tactical beschriftet beide Figuren eines Spielers', M.nameLabelOn(kugel(0)) === true && M.nameLabelOn(kugel(1)) === true);
  t('... und den neutralen Ball auch dort nicht', M.nameLabelOn(kugel(M.NEUTRAL)) === false);
  M.setz({ fbVariant: M.V.team2 });
  t('Football Team 2v2 beschriftet seine vier eigenstaendigen Figuren', M.nameLabelOn(kugel(2)) === true);
  M.setz({ fbVariant: M.V.elim4 });
}

// ══ 2. SITZ -> NAME: EINE EINZIGE QUELLE ════════════════════════════════════════
abschnitt('2. Die Namensquelle: players/<seat>, nichts daneben');
{
  M.setz({ mode: 'football', online: true, phase: 'aim', playersRoster: roster('Ali', 'Bea', 'Cem', 'Dora', 'Eren') });
  const namen = [0, 1, 2, 3, 4].map(s => M.pName(s));
  t('fuenf Sitze liefern genau ihre fuenf Namen', namen.join('|') === 'Ali|Bea|Cem|Dora|Eren', namen);
  t('kein Name doppelt', new Set(namen).size === 5);

  // Ein Sitz ohne Eintrag faellt auf den Farbnamen zurueck - nicht auf einen Fremdnamen.
  M.setz({ playersRoster: roster('Ali', '', 'Cem') });
  t('ein Sitz ohne Namen faellt auf den Farbnamen zurueck', M.pName(1) === I18N.de.col1, M.pName(1));
  t('... und veraendert die Namen der Nachbarn nicht', M.pName(0) === 'Ali' && M.pName(2) === 'Cem');

  // Der gespeicherte Name wird nie stillschweigend umgeschrieben - nur gelesen und gesaeubert.
  const roh = '  Mia   Meyer  ';
  M.setz({ playersRoster: { 0: { name: roh, uid: 'u0' } } });
  t('der Anzeigename wird gesaeubert (sanitizeName), der gespeicherte bleibt roh',
    M.pName(0) === 'Mia Meyer' && M.lies().playersRoster[0].name === roh, [M.pName(0), M.lies().playersRoster[0].name]);

  // Lokales Spiel kennt keine eingegebenen Namen - dort bleibt die allgemeine Beschriftung.
  M.setz({ online: false });
  t('lokal bleibt die allgemeine Beschriftung (kein Rueckgriff auf einen alten Raum)',
    M.pName(0) === I18N.de.namePlayer + ' 1' && M.pName(4) === I18N.de.namePlayer + ' 5', [M.pName(0), M.pName(4)]);
  M.setz({ online: true });
}

// ══ 3. ZWEI BIS FUENF FIGUREN, RICHTIG ZUGEORDNET ═══════════════════════════════
abschnitt('3. 2 bis 5 Teilnehmer: jedes Schild auf der eigenen Figur');
{
  const ALLE = ['Ali', 'Bea', 'Cem', 'Dora', 'Eren'];
  for (const n of [2, 3, 4, 5]) {
    M.setz({ mode: 'football', phase: 'aim', online: true, fbVariant: M.V.elim4, playersRoster: roster(...ALLE.slice(0, n)) });
    const kugeln = aufstellung(n);
    const s = schilder(kugeln);
    t(n + ' Teilnehmer: genau ' + n + ' Schilder (der neutrale Ball bleibt leer)', s.length === n, s.map(e => e.s));
    t(n + ' Teilnehmer: die Namen stimmen und keiner doppelt',
      s.map(e => e.s).join('|') === ALLE.slice(0, n).join('|') && new Set(s.map(e => e.s)).size === n, s.map(e => e.s));
    // Zuordnung ueber die Stelle: jedes Schild steht ueber SEINER Figur.
    let zugeordnet = true;
    kugeln.filter(b => b.owner !== M.NEUTRAL).forEach((b, i) => {
      const e = s[i];
      if (!e || Math.abs(e.x - b.x) > 0.001 || !(e.y < b.y)) zugeordnet = false;
    });
    t(n + ' Teilnehmer: jedes Schild steht mittig UEBER seiner Figur', zugeordnet, s.map(e => [e.s, e.x, e.y]));
    // Und der Name des neutralen Balls taucht nirgends auf.
    t(n + ' Teilnehmer: kein Schild traegt den Namen des neutralen Balls',
      !s.some(e => e.s === M.pName(M.NEUTRAL)));
  }
}

// ══ 4. DER NEUTRALE BALL - AUCH BEIM ZEICHNEN ═══════════════════════════════════
abschnitt('4. Der neutrale Ball bleibt in jedem Bild unbeschriftet');
{
  M.setz({ mode: 'football', online: true, fbVariant: M.V.elim4, playersRoster: roster('Ali', 'Bea', 'Cem', 'Dora', 'Eren') });
  let treffer = 0, bilder = 0;
  for (const ph of ['aim', 'reveal', 'sim', 'result', 'over']) {
    for (const raum of [false, true]) {
      M.setz({ phase: ph, r3dActive: raum });
      const kugeln = aufstellung(5);
      const s = schilder(kugeln);
      bilder++;
      if (s.length !== 5) treffer++;
    }
  }
  t('ueber alle Phasen, 2D und 3D: immer genau fuenf Schilder', treffer === 0 && bilder === 10, [treffer, bilder]);

  // Der neutrale Ball allein im Bild: gar kein Schild.
  M.setz({ phase: 'sim', r3dActive: false });
  t('der neutrale Ball allein erzeugt kein einziges Schild', schilder([M.mkBall(400, 300, M.NEUTRAL)]).length === 0);
}

// ══ 5. RAUMWECHSEL, REJOIN, SITZTAUSCH - KEIN ALTER NAME ════════════════════════
abschnitt('5. Neuer Raum, Rejoin, Sitztausch');
{
  M.setz({ mode: 'football', phase: 'aim', online: true, r3dActive: false, fbVariant: M.V.elim4 });

  // Raum A.
  M.setz({ myPlayer: 0, playersRoster: roster('Ali', 'Bea', 'Cem') });
  const a = schilder(aufstellung(3)).map(e => e.s);
  t('Raum A zeigt die Namen aus Raum A', a.join('|') === 'Ali|Bea|Cem', a);

  // Raum verlassen: playersRoster wird geleert (wie beim Austritt im Produkt).
  M.setz({ playersRoster: {} });
  const leer = schilder(aufstellung(3)).map(e => e.s);
  t('nach dem Verlassen steht kein Name aus Raum A mehr im Bild',
    !leer.some(n => ['Ali', 'Bea', 'Cem'].includes(n)), leer);

  // Raum B - derselbe Browser, ANDERER Sitz, andere Mitspieler.
  M.setz({ myPlayer: 2, playersRoster: roster('Nils', 'Ole', 'Pia') });
  const bnamen = schilder(aufstellung(3)).map(e => e.s);
  t('Raum B zeigt ausschliesslich die Namen aus Raum B', bnamen.join('|') === 'Nils|Ole|Pia', bnamen);
  t('... und kein einziger Name aus Raum A ist uebrig',
    !bnamen.some(n => ['Ali', 'Bea', 'Cem'].includes(n)), bnamen);
  t('... der eigene Sitz verschiebt die Zuordnung nicht (b.owner entscheidet, nicht myPlayer)',
    bnamen[2] === 'Pia' && M.lies().myPlayer === 2, bnamen);

  // Rejoin: derselbe Sitz, derselbe Name - das Bild bleibt richtig.
  M.setz({ playersRoster: {} });                       // Verbindung weg
  M.setz({ playersRoster: roster('Nils', 'Ole', 'Pia') }); // Schnappschuss wieder da
  t('nach dem Rejoin traegt jede Figur wieder ihren Namen',
    schilder(aufstellung(3)).map(e => e.s).join('|') === 'Nils|Ole|Pia');

  // Ein umbenannter Sitz schlaegt beim naechsten Bild durch - ohne zweite Zuordnung.
  M.setz({ playersRoster: roster('Nils', 'Ole-2', 'Pia') });
  t('eine Namensaenderung wirkt im naechsten Bild', schilder(aufstellung(3))[1].s === 'Ole-2');
}

// ══ 6. PASSIVER SITZ UND RUNDENRESET ════════════════════════════════════════════
abschnitt('6. Passive Figur und Rundenreset');
{
  M.setz({ mode: 'football', phase: 'aim', online: true, fbVariant: M.V.elim4, myPlayer: 0, playersRoster: roster('Ali', 'Bea', 'Cem', 'Dora') });

  // Eine passive (getrennte) Figur bleibt koerperlich im Feld - und behaelt ihren Namen.
  const passiv = aufstellung(4);
  t('eine passive, aber noch vorhandene Figur behaelt ihren Namen',
    schilder(passiv).map(e => e.s).join('|') === 'Ali|Bea|Cem|Dora');

  // Ausgeschieden = nicht mehr im Bild: kein Geisterschild.
  passiv[1].alive = false;
  const nachAus = schilder(passiv).map(e => e.s);
  t('eine entfernte Figur hinterlaesst kein Schild', nachAus.join('|') === 'Ali|Cem|Dora', nachAus);

  // Rundenreset: placeBalls() erzeugt FRISCHE Kugelobjekte. Da das Schild nichts speichert,
  // sondern jedes Bild neu aus b.owner liest, stimmt die Zuordnung danach unveraendert.
  const frisch = aufstellung(4);
  t('nach dem Rundenreset (frische Kugelobjekte) stimmen alle Schilder wieder',
    schilder(frisch).map(e => e.s).join('|') === 'Ali|Bea|Cem|Dora');
  t('... und die Figuren stehen dabei an neuen Stellen (es wird wirklich neu gesetzt)',
    frisch[0] !== passiv[0]);

  // Tor und Reset dazwischen: die Schilder sind danach nicht dauerhaft weg.
  const folge = ['aim', 'sim', 'result', 'aim'].map(ph => { M.setz({ phase: ph }); return schilder(aufstellung(4)).length; });
  t('Zielen -> Physik -> Tor -> naechste Runde: in jeder Phase vier Schilder',
    folge.join(',') === '4,4,4,4', folge);
}

// ══ 7. LANGE NAMEN: EINE KUERZUNGSREGEL, KEIN ZWEITER MASSSTAB ══════════════════
abschnitt('7. Lange Namen');
{
  M.setz({ mode: 'football', phase: 'aim', online: true, r3dActive: false, fbVariant: M.V.elim4 });
  const lang = 'Maximiliane12345';   // NAME_MAX = 16 sichtbare Zeichen: die Obergrenze des Produkts
  t('die Laengengrenze des Produkts ist NAME_MAX', M.NAME_MAX === 16, M.NAME_MAX);
  t('sanitizeName laesst genau NAME_MAX Zeichen stehen', M.sanitizeName(lang).length === 16);
  t('... und kuerzt darueber hinaus selbst', M.sanitizeName(lang + 'XXXX').length === 16);

  M.setz({ playersRoster: roster(lang, 'Bea') });
  const s = schilder(aufstellung(2));
  t('ein zu langer Name wird fuer die Anzeige mit Auslassung gekuerzt',
    s[0].s.endsWith('…') && s[0].s.length < lang.length, s[0].s);
  t('... und der gespeicherte Name bleibt unangetastet',
    M.lies().playersRoster[0].name === lang, M.lies().playersRoster[0].name);
  t('ein kurzer Name wird NICHT gekuerzt', s[1].s === 'Bea');

  // Die Kuerzung entscheidet ueber die BREITE, nicht ueber eine Zeichenzahl. Schrift und
  // Grenze wachsen gemeinsam mit dem Massstab - solange die Schrift nicht an der
  // Lesbarkeitsgrenze klebt, kuerzt jede Entfernung deshalb gleich weit.
  M.setz({ BR: 40 });                          // gross genug, dass die 12px-Grenze nicht greift
  const nah = schilder(aufstellung(2))[0].s;
  M.setz({ r3dActive: true });                 // Massstab 1.5
  const fern = schilder(aufstellung(2))[0].s;
  t('die Kuerzung folgt der Breite, nicht einer festen Zeichenzahl', fern === nah, [nah, fern]);
  M.setz({ r3dActive: false });

  // Und an der Lesbarkeitsgrenze gewinnt die Lesbarkeit: die Schrift bleibt bei 12px
  // stehen, waehrend die Grenze weiter schrumpft - es passen bewusst WENIGER Zeichen hinein,
  // statt dass die Schrift unleserlich klein wird.
  M.setz({ BR: 12 });                          // 12*.66 = 7.92px -> auf 12px angehoben
  const winzig = schilder(aufstellung(2))[0].s;
  t('an der Lesbarkeitsgrenze weicht die Zeichenzahl, nicht die Schriftgroesse',
    winzig.length < nah.length && winzig.endsWith('…'), [nah, winzig]);
  M.setz({ BR: 16 });
}

// ══ 8. DER STIL IST DER VON RING OUT ════════════════════════════════════════════
abschnitt('8. Stil, Lage und Massstab');
{
  M.setz({ mode: 'football', phase: 'aim', online: true, r3dActive: false, fbVariant: M.V.elim4, playersRoster: roster('Ali', 'Bea') });
  const kugeln = aufstellung(2);
  ctx.texte.length = 0;
  for (const b of kugeln) if (b.alive) M.drawBall(b);
  const fuell = ctx.texte.filter(e => e.art === 'fill' && /^800 /.test(e.font));
  const kontur = ctx.texte.filter(e => e.art === 'stroke' && /^800 /.test(e.font));

  t('jedes Schild wird zuerst konturiert und dann gefuellt (Lesbarkeit auf hellem Grund)',
    kontur.length === 2 && fuell.length === 2);
  t('Schriftschnitt und Familie sind die von Ring Out', /^800 [\d.]+px system-ui$/.test(fuell[0].font), fuell[0].font);
  t('das Schild traegt die Namensfarbe des Sitzes (FB_NAME_COL)',
    fuell[0].farbe === M.FB_NAME_COL[0] && fuell[1].farbe === M.FB_NAME_COL[1], [fuell[0].farbe, fuell[1].farbe]);
  t('die Namensfarben zweier Sitze sind unterscheidbar', fuell[0].farbe !== fuell[1].farbe);
  t('das Schild steht ueber der Figur, nicht darauf', fuell[0].y < kugeln[0].y - 16, [fuell[0].y, kugeln[0].y]);
  t('das Schild steht waagerecht mittig auf der Figur', Math.abs(fuell[0].x - kugeln[0].x) < 0.001);

  // Massstab: in der Tiefe schrumpft das Schild mit - aber nie unter die Lesbarkeitsgrenze.
  const gr = (f) => Number(/(\d+(?:\.\d+)?)px/.exec(f)[1]);
  const nah = gr(fuell[0].font);
  M.setz({ r3dActive: true });
  ctx.texte.length = 0;
  for (const b of aufstellung(2)) if (b.alive) M.drawBall(b);
  const fern = gr(ctx.texte.filter(e => e.art === 'fill' && /^800 /.test(e.font))[0].font);
  t('die Schriftgroesse folgt dem perspektivischen Massstab', fern > nah, [nah, fern]);
  M.setz({ r3dActive: false });
  t('... und faellt nie unter die Lesbarkeitsgrenze von 12px', nah >= 12, nah);
}

// ══ 9. LEISTUNG UND LEBENSZYKLUS ════════════════════════════════════════════════
abschnitt('9. Leistung, Eingabe und Lebenszyklus');
{
  const db = grabFunction(HTML, 'drawBall');
  t('das Schild ist gemalter Text - kein DOM-Knoten je Teilnehmer',
    !/document\.|createElement|appendChild|innerHTML|style\./.test(db));
  t('... und damit nichts, was einen Zeiger abfangen koennte (Zielen bleibt frei)',
    !/addEventListener|pointerEvents/.test(db));
  t('... und keine Textur je Bild', !/createPattern|createImageData|drawImage|toDataURL/.test(db));
  // Gezaehlt wird im CODE, nicht in der Erlaeuterung: reine Kommentarzeilen fallen weg.
  const nurCode = (s) => s.split('\n').filter(z => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n');
  const dbCode = nurCode(db), htmlCode = nurCode(HTML);
  t('es gibt keine zweite Namenszuordnung neben pName()',
    (dbCode.match(/pName\(/g) || []).length === 1, (dbCode.match(/pName\(/g) || []).length);
  t('die Sichtbarkeit wird an genau einer Stelle entschieden (Definition + ein Aufruf)',
    (htmlCode.match(/nameLabelOn\(/g) || []).length === 2, (htmlCode.match(/nameLabelOn\(/g) || []).length);
  t('das Schild haengt am Kugelobjekt - es wird nur fuer lebende Figuren gezeichnet',
    /for\(const b of balls\)if\(b\.alive\)drawBall\(b\);/.test(HTML));

  // Kein Zustand zwischen zwei Bildern: dasselbe Bild zweimal gezeichnet ergibt dasselbe.
  M.setz({ mode: 'football', phase: 'aim', online: true, fbVariant: M.V.elim4, playersRoster: roster('Ali', 'Bea', 'Cem') });
  const eins = schilder(aufstellung(3)).map(e => [e.s, e.x, e.y, e.font].join(':'));
  const zwei = schilder(aufstellung(3)).map(e => [e.s, e.x, e.y, e.font].join(':'));
  t('zwei aufeinanderfolgende Bilder sind identisch (kein aufgestauter Zustand)',
    eins.join('|') === zwei.join('|'));

  // Der Zeichenkontext wird sauber hinterlassen: save/restore paarweise.
  t('der Zeichenkontext bleibt ausgeglichen (save/restore paarweise)', ctx._stapel.length === 0, ctx._stapel.length);
}

// ══ 10. RING OUT BLEIBT, WIE ES WAR ═════════════════════════════════════════════
abschnitt('10. Ring Out: keine sichtbare Aenderung');
{
  M.setz({ mode: 'ffa', fmt: 'ffa', online: true, r3dActive: true, menuVisible: false, playersRoster: roster('Ali', 'Bea', 'Cem') });
  const k = [M.mkBall(300, 300, 0), M.mkBall(400, 300, 1), M.mkBall(500, 300, 2)];

  M.setz({ phase: 'aim' });
  const beimZielen = schilder(k).map(e => e.s);
  t('Ring Out beschriftet beim Zielen alle drei Kugeln', beimZielen.join('|') === 'Ali|Bea|Cem', beimZielen);

  M.setz({ phase: 'sim' });
  t('Ring Out zeigt waehrend der Simulation weiterhin KEINE Namen', schilder(k).length === 0);

  M.setz({ phase: 'result' });
  t('Ring Out beschriftet im Ergebnis wieder', schilder(k).length === 3);

  // Die Zeichenzeile selbst ist woertlich die alte - nur die Bedingung davor ist neu.
  const db = grabFunction(HTML, 'drawBall');
  for (const zeile of [
    "const fs=Math.max(12,BR*.66*q.s);",
    "ctx.font='800 '+fs+'px system-ui';",
    "const maxW=BR*3.6*q.s;",
    "const ly=q.y-BR*1.55*q.s;",
    "ctx.lineJoin='round';ctx.lineWidth=fs*.28;ctx.strokeStyle='rgba(8,10,14,.80)';",
    "ctx.fillStyle=ncol(colorSlot(b.owner));ctx.fillText(txt,q.x,ly);"
  ]) t('unveraendert: ' + zeile.slice(0, 46), db.indexOf(zeile) > 0, zeile);

  // Und drawBall schluckt weiterhin nichts ausser der Zeichenabstandsangabe.
  t('drawBall faengt weiterhin nur die Zeichenabstandsangabe ab',
    (db.match(/catch/g) || []).length === 1 && /letterSpacing/.test(db));
}

console.log(`\nFootball-Namensschilder: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
