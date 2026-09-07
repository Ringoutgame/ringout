// STUFE 2A: die Protokollfassung ist eine Eigenschaft DES RAUMS.
//
// Ein einziger ausgelieferter Client bedient beide Familien. Welche gilt, entscheidet
// nicht seine Ausbaustufe, sondern der Raum, in dem er sitzt.
//
// DIE VIER SAETZE, um die es hier geht:
//   1. NEUE Raeume bekommen ihre Fassung aus ihrer KONFIGURATION: Football mit der
//      Lebensregel und drei bis fuenf Sitzen wird v9, alles andere bleibt v8. Der
//      Waehler zieht dieselben Grenzen wie die Rules - er weitet die v9-Flaeche nicht.
//   2. BESTEHENDE Raeume behalten ihre Fassung. Sie wird nie nachtraeglich gehoben,
//      und der Client betritt beide.
//   3. Die v9-Wege haengen an roomProto, nicht an ONLINE_PROTOCOL_VERSION. Derselbe
//      Client ist in einem v8-Raum KEIN v9-Client.
//   4. Kein Mischbetrieb: in einem v8-Raum schreibt er den Zugslot t, in einem
//      v9-Raum nie.
//   node test_online_room_protocol_routing.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 58 - s.length)));

function grab(re, was) {
  const m = HTML.match(re);
  if (!m) { console.log('Quelltext nicht gefunden: ' + was); process.exit(2); }
  return m[0];
}

// ── Der echte Quelltext ──────────────────────────────────────────────────────
const QUELLEN = [
  grab(/const ONLINE_PROTOCOL_VERSION=[^\n]*/, 'ONLINE_PROTOCOL_VERSION'),
  grab(/const ROOM_GAME_RINGOUT=[^\n]*/, 'ROOM_GAME_RINGOUT'),
  grab(/const FB_ONLINE_MODE_CLASSIC='classic'[\s\S]*?FB_ONLINE_MODE_TIMED='timedffa';/, 'Modusnamen'),
  grab(/function fbRaumFassung\(cfg\)\{[\s\S]*?\n\}/, 'fbRaumFassung'),
  grab(/function fbRaumFassungOk\(v\)\{[^\n]*\}/, 'fbRaumFassungOk'),
].join('\n');

const M = new Function(QUELLEN + `
  return { fbRaumFassung, fbRaumFassungOk, VER: ONLINE_PROTOCOL_VERSION };
`)();

const cfgFootball = (mode, cap) => ({ game: 'football', winTarget: 3, fmt: 'elimination',
                                      visibility: 'private', mode: mode, cap: cap });
const cfgRingOut = (fmt) => ({ game: 'ringout', winTarget: 3, fmt: fmt, visibility: 'private' });

console.log('=== Stufe 2A: die Fassung gehoert dem Raum ===');

// ══ DIE AUSBAUSTUFE ══════════════════════════════════════════════════════════
abschnitt('Der ausgelieferte Client kann beide Familien');
{
  t('seine Ausbaustufe ist 9', M.VER === 9, M.VER);
  t('er bedient v8', M.fbRaumFassungOk(8) === true);
  t('und v9', M.fbRaumFassungOk(9) === true);
  for (const v of [4, 5, 6, 7, 10, 0, -1, null, undefined, '9', 9.5])
    t('aber nicht die Fassung ' + JSON.stringify(v), M.fbRaumFassungOk(v) === false);
}

// ══ NEUE RAEUME ══════════════════════════════════════════════════════════════
abschnitt('Ein NEUER Raum bekommt seine Fassung aus seiner Konfiguration');
{
  for (const cap of [3, 4, 5])
    t('Football Lives mit ' + cap + ' Sitzen wird v9',
      M.fbRaumFassung(cfgFootball('lives', cap)) === 9, M.fbRaumFassung(cfgFootball('lives', cap)));
  // Die uebrigen Onlinemodi haben kein v9-Produkt hinter sich - sie bleiben v8.
  for (const m of ['classic', 'speed', 'team2v2', 'timedffa'])
    t('Football ' + m + ' bleibt v8', M.fbRaumFassung(cfgFootball(m, 3)) === 8);
  for (const f of ['ffa', 'triple_ffa', 'team_duel', 'single', 'double'])
    t('RingOut ' + f + ' bleibt v8', M.fbRaumFassung(cfgRingOut(f)) === 8);
  // Der Waehler weitet die v9-Flaeche auch an den Raendern nicht.
  for (const cap of [2, 6, 0, -1, 3.5, '4', null, undefined])
    t('Lives mit Sollbesetzung ' + JSON.stringify(cap) + ' bleibt v8',
      M.fbRaumFassung(cfgFootball('lives', cap)) === 8);
  t('ohne Modus bleibt es v8', M.fbRaumFassung({ game: 'football', cap: 3 }) === 8);
  t('ohne Konfiguration ebenso', M.fbRaumFassung(null) === 8 && M.fbRaumFassung('x') === 8);
}

// ══ DIE VERDRAHTUNG IM PRODUKT ═══════════════════════════════════════════════
// Die Weiche nuetzt nichts, wenn sie nicht an den richtigen Stellen haengt. Geprueft
// wird deshalb der ECHTE Quelltext - eng, an jeder einzelnen Stelle.
abschnitt('Die Weiche haengt an den richtigen Stellen');
{
  t('der Client fuehrt die Fassung DES RAUMS mit',
    /^let roomProto=0;$/m.test(HTML));
  t('genau eine Stelle legt einen Raum an, und sie fragt den Waehler',
    (HTML.match(/roomProto=fbRaumFassung\(cfg\);/g) || []).length === 1
    && (HTML.match(/const room=\{v:roomProto,/g) || []).length === 1);
  t('keine Stelle schreibt die Ausbaustufe blind in einen Raum',
    (HTML.match(/v:ONLINE_PROTOCOL_VERSION/g) || []).length === 0);
  t('alle drei Raumpruefungen fragen nach einer bedienbaren Fassung',
    (HTML.match(/fbRaumFassungOk\(d\.v\)/g) || []).length === 3,
    (HTML.match(/fbRaumFassungOk\(d\.v\)/g) || []).length);
  t('und keine vergleicht mehr gegen die Ausbaustufe',
    (HTML.match(/!==ONLINE_PROTOCOL_VERSION/g) || []).length === 0);
  t('Beitritt und Wiedereintritt uebernehmen die Fassung des geprueften Raums',
    (HTML.match(/if\(v\.ok\)roomProto=d\.v;/g) || []).length === 2,
    (HTML.match(/if\(v\.ok\)roomProto=d\.v;/g) || []).length);
  t('der Sitzclaim traegt die Fassung des Raums mit',
    (HTML.match(/upd\['v'\]=roomProto;/g) || []).length === 2);
  t('die Praesenzruecknahme vergleicht gegen die Fassung des Raums',
    /if\(v\.v!==roomProto\)return 'version';/.test(HTML));
  t('das Verlassen leert die Fassung', /roomCode=''; roomProto=0;/.test(HTML));
  // Die v9-Wege haengen am RAUM.
  t('fbV9RaumHier fragt den Raum, nicht die Ausbaustufe',
    /function fbV9RaumHier\(\)\{ return !!online && roomProto===9; \}/.test(HTML));
  t('fbV9LebenAn ebenso',
    /return !fbV9Nachspielen && !!online && roomProto===9 && mode==='football'/.test(HTML));
  t('und die Startweiche liest die Fassung DES gelesenen Raums',
    /return !!raum && raum\.v===9 && ONLINE_PROTOCOL_VERSION>=9;/.test(HTML));
  // Der Zugslot bleibt v8 vorbehalten - und die Sperre haengt jetzt am Raum.
  const wts = grab(/function writeTurnSlot\(s,payload,opts\)\{[\s\S]*?\n\}/, 'writeTurnSlot');
  t('writeTurnSlot sperrt genau dann, wenn der RAUM ein v9-Raum ist',
    /if\(typeof fbV9RaumHier==='function'&&fbV9RaumHier\(\)\)return;/.test(wts));
  t('und nennt v9 nur dafuer',
    (wts.match(/fbV9[A-Za-z]*/g) || []).join(',') === 'fbV9RaumHier,fbV9RaumHier');
  t('der v8-Pfad in writeTurnSlot ist unveraendert',
    /'\/g\/'\+ctx\.gen\+'\/t\/'\+ctx\.turnNo\+'\/'\+s/.test(wts));
}

// ══ KEINE VERMISCHUNG ════════════════════════════════════════════════════════
abschnitt('Kein Mischbetrieb - die Rules ziehen dieselben Grenzen');
{
  const R = fs.readFileSync(path.join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  const rules = JSON.parse(R);
  const g = rules.rules.rooms.$code.g.$gen;
  for (const zweig of ['d', 'c', 'ro', 'r', 's', 'z', 'q', 'x'])
    t('der v9-Zweig ' + zweig + ' gilt nur fuer v9-Raeume',
      JSON.stringify(g[zweig]).indexOf("child('v').val() === 9") >= 0);
  t('und der v8-Zugslot bleibt v9 verschlossen',
    JSON.stringify(g.t).indexOf("child('v').val() === 9") < 0);
  // Die Rules nehmen v9 ausschliesslich fuer Football Lives 3-5 - genau die Flaeche,
  // die der Waehler vergibt. Waeren die beiden verschieden, entstuenden Raeume, die
  // der Client anlegt und der Server abweist.
  const cfg = rules.rules.rooms.$code.config;
  t('die Rules lassen v9 nur fuer Football zu',
    cfg.game['.validate'].indexOf("child('v').val() !== 9") >= 0);
  t('nur mit der Lebensregel',
    cfg.mode['.validate'].indexOf("newData.val() === 'lives'") >= 0);
  t('und nur mit drei bis fuenf Sitzen',
    cfg.cap['.validate'].indexOf('newData.val() >= 3 && newData.val() <= 5') >= 0);
  t('die Raumfassung selbst laesst 4 bis 9 zu',
    rules.rules.rooms.$code.v['.validate'].indexOf('newData.val() === 9') >= 0);
  t('und ist unveraenderlich - kein Raum wird nachtraeglich gehoben',
    rules.rules.rooms.$code.v['.validate'].indexOf('!data.exists() || newData.val() === data.val()') >= 0);
}

console.log('\nRaum-Protokollweiche: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
