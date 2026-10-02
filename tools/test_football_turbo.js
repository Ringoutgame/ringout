// ARENA FOOTBALL - TURBO BOOST: Vorrat, Verbrauch, verdeckte Zugart.
//
// Geprueft werden die ECHTEN Quellen aus index.html in kleinen Sandkaesten:
//   1. Spielbaustein: drei Nutzungen je Match (3 -> 2 -> 1 -> 0), Verbrauch nur am Abschuss eines echten Zugs,
//      kein Verbrauch ohne Vorrat / fuer Nullzug / fuer nicht gestartete Sitze, Reset je Match,
//      Ring Out neutral.
//   2. Codec + Protokollmaschine: Turbo ist eine eigene Zugart im Hash; der Commit verraet sie
//      nicht, die Enthuellung hat dieselbe Form, die Pruefung erkennt sie am Hash; Manipulation
//      bleibt HASH_MISMATCH; ein normaler Zug bleibt bitgleich zu vorher.
//   3. Geheimnisspeicher: t:true wird gespeichert und nachgerechnet; alte Datensaetze gelten weiter.
//   4. Zugmenge: turbo nur als true.
//   5. Versionsgrenze: Turbo gibt es online NUR in einem Raum der Turbo-Fassung 14. Ein alter Client lehnt 14
//      ab; in einem Bestandsraum (11) waehlt, sendet und deutet auch ein neuer Client keinen Turbo.
//
//   node tools/test_football_turbo.js
'use strict';
const { loadIndexHtml } = require('./extract');
const HTML = loadIndexHtml();
let pass = 0, fail = 0;
const t = (name, ok, info) => { if (ok) { pass++; console.log('  [OK]   ' + name); } else { fail++; console.log('  [FAIL] ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); } };
const abschnitt = (s) => console.log('\n== ' + s + ' ==');
const zwischen = (a, b) => { const i = HTML.indexOf(a), j = HTML.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Bereich fehlt: ' + a); return HTML.slice(i, j); };
const hol = (re, was) => { const m = HTML.match(re); if (!m) throw new Error('nicht gefunden: ' + was); return m[0]; };

(async () => {
// ══ 1. SPIELBAUSTEIN ═════════════════════════════════════════════════════════
abschnitt('1. Vorrat, Wahl und Verbrauch');
{
  const TURBO = zwischen('// ══ ARENA FOOTBALL — TURBO BOOST', 'function applyLaunch(){');
  const bau = () => new Function('welt', `
    let mode=welt.mode, phase='aim', menuVisible=false, online=false, myPlayer=0, LANG='de', replaying=false;
    function fbTurboRaum(){ return online && welt.turboRaum === true; }
    const FOOTBALL_ELIM_MAX_PLAYERS=5;
    function whoCanAim(){ return welt.wer; }
    function T(k){ return k; } function toast(){ welt.toasts++; } function pName(o){ return 'P'+(o+1); }
    function fbFeelLaunch(){}
    ${TURBO}
    return { reset: fbTurboReset, rest: fbTurboUebrig, um: fbTurboUmschalten, fuer: fbTurboFuerZug, ab: fbTurboAbgegeben,
             faktor: fbTurboFaktor, leeren: fbTurboLeeren, zug: () => fbTurboZug.slice(), wahl: () => fbTurboWahl.slice(),
             setPhase: (p) => { phase = p; }, setMode: (m) => { mode = m; }, setOnline: (o) => { online = o; }, an: fbTurboAn,
             FAKTOR: FB_TURBO_FAKTOR, JE: FB_TURBO_JE_MATCH };`);
  const welt = { mode: 'football', wer: 0, toasts: 0 };
  const M = bau()(welt);
  M.reset();
  const N = M.JE;
  t('Startwerte: drei Nutzungen je Spieler und Match, Faktor 1.30', N === 3 && M.FAKTOR === 1.3 && [0, 1, 2, 3, 4].every(o => M.rest(o) === N));
  const schuss = { dx: 80, dy: -40 }, nullzug = { dx: 0, dy: 0 };
  // Ein Turbo-Schuss von Sitz o ueber den ganzen Weg: waehlen, abgeben, Abschuss.
  const turboSchuss = (o) => { welt.wer = o; M.setPhase('aim'); M.um(); M.ab(o, M.fuer(o, schuss), true); const f = M.faktor(o, 89); M.leeren(); return f; };
  M.um();
  t('Umschalten waehlt Turbo fuer den Sitz, der gerade zielt', M.wahl()[0] === true && M.wahl()[1] === false);
  M.um(); t('nochmal Umschalten nimmt die Wahl zurueck', M.wahl()[0] === false);
  M.um();
  t('ein Nullzug (Stehen bleiben) traegt keinen Turbo', M.fuer(0, nullzug) === false);
  t('ein echter Schuss traegt ihn', M.fuer(0, schuss) === true);
  M.ab(0, M.fuer(0, schuss), true);
  t('abgegeben: Wahl erledigt, Zug traegt Turbo, Vorrat noch unberuehrt', M.wahl()[0] === false && M.zug()[0] === true && M.rest(0) === 3);
  t('am Abschuss: Faktor und Verbrauch 3 -> 2', M.faktor(0, 89) === M.FAKTOR && M.rest(0) === 2);
  t('ein zweiter Aufruf fuer denselben Abschuss verbraucht nichts mehr', M.faktor(0, 89) === 1 && M.rest(0) === 2);
  M.leeren();
  // Was NICHT verbraucht: Schuss ohne Turbo, Nullzug, nicht gestarteter Zug, Laenge 0.
  welt.wer = 0; M.ab(0, false, true);
  t('ein Schuss ohne Turbo verbraucht nichts', M.faktor(0, 89) === 1 && M.rest(0) === 2);
  M.leeren(); M.um(); M.ab(0, M.fuer(0, nullzug), true);
  t('Turbo gewaehlt, aber Stehen bleiben: nichts verbraucht', M.faktor(0, 0) === 1 && M.rest(0) === 2);
  M.leeren(); M.um(); M.ab(0, M.fuer(0, schuss), true);
  t('ein nicht gestarteter Turbo-Zug (verworfen, ausgeschieden) verbraucht nichts und verfaellt', (M.leeren(), M.zug()[0] === false && M.rest(0) === 2));
  M.ab(0, true, true); t('Laenge 0 am Abschuss verbraucht nichts', M.faktor(0, 0) === 1 && M.rest(0) === 2);
  M.leeren(); M.um();
  t('eine gewaehlte, nicht abgegebene Wahl verfaellt am Abschuss', (M.leeren(), M.wahl()[0] === false && M.rest(0) === 2));
  // Der ganze Ablauf 3 -> 2 -> 1 -> 0.
  t('zweiter Turbo-Schuss: 2 -> 1', turboSchuss(0) === M.FAKTOR && M.rest(0) === 1);
  t('dritter Turbo-Schuss: 1 -> 0', turboSchuss(0) === M.FAKTOR && M.rest(0) === 0);
  welt.wer = 0; M.setPhase('aim'); M.um();
  t('ohne Vorrat laesst sich nichts waehlen', M.wahl()[0] === false);
  t('ein vierter Versuch wirkt normal und verbraucht nichts', turboSchuss(0) === 1 && M.rest(0) === 0);
  M.ab(0, true, true);
  t('auch ein erzwungener Turbo-Zug ohne Vorrat wirkt normal', M.faktor(0, 89) === 1 && M.rest(0) === 0);
  M.leeren();
  t('die anderen Spieler haben ihren Vorrat unveraendert', [1, 2, 3, 4].every(o => M.rest(o) === 3));
  welt.wer = 2; M.um(); M.ab(2, M.fuer(2, schuss), true); welt.wer = 3; M.um(); M.ab(3, M.fuer(3, schuss), true);
  t('gleichzeitiger Turbo zweier Spieler: jeder verbraucht genau einen eigenen', M.faktor(2, 50) === M.FAKTOR && M.faktor(3, 50) === M.FAKTOR && M.rest(2) === 2 && M.rest(3) === 2 && M.rest(4) === 3);
  M.setPhase('sim'); welt.wer = 4; M.um();
  t('waehrend die Kugeln rollen gibt es keine Wahl', M.wahl()[4] === false);
  M.reset();
  t('ein neues Match gibt jedem wieder drei', [0, 1, 2, 3, 4].every(o => M.rest(o) === 3) && M.zug().every(z => z === false));
  M.setMode('ffa'); M.setPhase('aim'); welt.wer = 0; M.um(); M.ab(0, true, true);
  t('Ring Out: keine Wahl, kein Faktor', M.wahl()[0] === false && M.fuer(0, schuss) === false && M.faktor(0, 89) === 1);
}

// ══ 2. CODEC UND PROTOKOLLMASCHINE ════════════════════════════════════════════
abschnitt('2. Verdeckte Zugart im Hash');
{
  const BEREICH = zwischen('const FB_V9_PREIMAGE_BYTES=60', '// ════ ENDE V9-PROTOKOLLMASCHINE ════');
  const raum = { turbo: true };
  const P = new Function('crypto', 'raum', `const FB_ONLINE_SEATS=5, FB_ONLINE_BALL_IDX=5;
    function fbTurboRaum(){ return raum.turbo; }
    ${BEREICH}
    return { fbV9MakeCommit, fbV9MakeReveal, fbV9VerifyPair, fbV9Hash, fbV9Preimage, fbV9SaltFromHex, fbV9Hex, fbV9SecretClear,
             KM: FB_V9_KIND_MOVE, KT: FB_V9_KIND_TURBO, VALID: FB_V9_VALID, MISMATCH: FB_V9_MISMATCH };`)(globalThis.crypto, raum);
  const ctx = { room: 'RN2K', gen: 3, turn: 7, seat: 1 };
  const zug = { idx: 1, dx: 61.5, dy: -33.25, sp: 0 };
  const cNorm = await P.fbV9MakeCommit(ctx, zug); const rNorm = P.fbV9MakeReveal(ctx);
  const cTur = await P.fbV9MakeCommit(ctx, Object.assign({ turbo: true }, zug)); const rTur = P.fbV9MakeReveal(ctx);
  t('Zugart: move = 1, move mit Turbo = 2', P.KM === 1 && P.KT === 2);
  t('der Commit traegt nur k und h - keine Spur vom Turbo', JSON.stringify(Object.keys(cTur).sort()) === '["h","k"]' && cTur.k === 'move' && /^[0-9a-f]{64}$/.test(cTur.h));
  t('die Enthuellung hat dieselbe Form wie ohne Turbo', JSON.stringify(Object.keys(rTur).sort()) === JSON.stringify(Object.keys(rNorm).sort()) && rTur.turbo === undefined);
  const vN = await P.fbV9VerifyPair(Object.assign({ seat: 1 }, ctx), 1, cNorm, rNorm);
  const vT = await P.fbV9VerifyPair(Object.assign({ seat: 1 }, ctx), 1, cTur, rTur);
  t('Pruefung: normaler Zug gueltig, ohne Turbo-Kennzeichen', vN.status === P.VALID && vN.move.turbo === undefined && vN.move.dx === 61.5);
  t('Pruefung: Turbo-Zug gueltig und am Hash als Turbo erkannt', vT.status === P.VALID && vT.move.turbo === true && vT.move.dy === -33.25);
  const falsch = Object.assign({}, rTur, { dx: 62 });
  t('manipulierte Enthuellung bleibt HASH_MISMATCH (auch mit beiden Zugarten)', (await P.fbV9VerifyPair(Object.assign({ seat: 1 }, ctx), 1, cTur, falsch)).status === P.MISMATCH);
  const vertauscht = await P.fbV9VerifyPair(Object.assign({ seat: 1 }, ctx), 1, cNorm, rTur);
  t('Enthuellung zu einem anderen Commit bleibt HASH_MISMATCH', vertauscht.status === P.MISMATCH);
  // Bitgleichheit des normalen Zugs: derselbe Hash wie mit der bisherigen festen Zugart 1.
  const salt = P.fbV9SaltFromHex(rNorm.n);
  const felder = { room: 'RN2K', gen: 3, turn: 7, seat: 1, kind: 1, idx: 1, dx: 61.5, dy: -33.25, sp: 0 };
  t('ein normaler Zug hasht wie bisher (Zugart-Byte 1)', (await P.fbV9Hash(felder, salt)) === cNorm.h && P.fbV9Preimage(felder, salt)[18] === 1);
  // BESTANDSRAUM (Fassung 11): dieselbe Enthuellung, derselbe Commit - aber die Turbo-Zugart gilt dort nicht.
  // Ein neuer Client urteilt damit genau wie ein alter, der Zugart 2 gar nicht kennt: HASH_MISMATCH.
  raum.turbo = false;
  const vAlt = await P.fbV9VerifyPair(Object.assign({ seat: 1 }, ctx), 1, cTur, rTur);
  t('Bestandsraum: ein Turbo-Commit ist HASH_MISMATCH - wie bei einem alten Client', vAlt.status === P.MISMATCH && vAlt.move === null);
  const vAltN = await P.fbV9VerifyPair(Object.assign({ seat: 1 }, ctx), 1, cNorm, rNorm);
  t('Bestandsraum: ein normaler Zug bleibt gueltig', vAltN.status === P.VALID && vAltN.move.turbo === undefined);
  raum.turbo = true;
  t('Zugart 3 bleibt unzugewiesen', (() => { try { P.fbV9Preimage(Object.assign({}, felder, { kind: 3 }), salt); return false; } catch (e) { return true; } })());
}

// ══ 3. GEHEIMNISSPEICHER ═════════════════════════════════════════════════════
abschnitt('3. Geheimnisspeicher: Turbo ueberlebt ein Neuladen');
{
  const S = new Function(`const FB_V9_STORE_V=1, FB_V9_KIND_MOVE=1, FB_V9_KIND_TURBO=2;
    const FB_V9_HEX_SALT_RE=/^[0-9a-f]{32}$/, FB_V9_HEX_HASH_RE=/^[0-9a-f]{64}$/;
    ${hol(/const FB_V9_SECRET_FIELDS=\[[^\n]*/, 'Felder')}
    ${hol(/const FB_V9_SECRET_TURBO='t';/, 'Turbo-Feld')}
    ${hol(/function fbV9SecretShapeOk\(ctx,uid,rec\)\{[\s\S]*?\n\}/, 'Form')}
    ${hol(/function fbV9SecretFelder\(ctx,rec\)\{[\s\S]*?\n\}/, 'Felder')}
    return { form: fbV9SecretShapeOk, felder: fbV9SecretFelder };`)();
  const ctx = { code: 'RN2K', gen: 3, turn: 7, seat: 1 };
  const alt = { v: 1, uid: 'U', salt: 'a'.repeat(32), idx: 1, dx: 1, dy: 2, sp: 0, h: 'b'.repeat(64) };
  t('bisheriger Datensatz ohne t bleibt gueltig und ist Zugart 1', S.form(ctx, 'U', alt) && S.felder(ctx, alt).kind === 1);
  t('Datensatz mit t:true ist gueltig und Zugart 2', S.form(ctx, 'U', Object.assign({ t: true }, alt)) && S.felder(ctx, Object.assign({ t: true }, alt)).kind === 2);
  t('t mit anderem Wert oder fremde Felder werden abgewiesen', !S.form(ctx, 'U', Object.assign({ t: false }, alt)) && !S.form(ctx, 'U', Object.assign({ x: 1 }, alt)));
}

// ══ 4. ZUGMENGE UND EINBINDUNG ════════════════════════════════════════════════
abschnitt('4. Einbindung');
{
  t('fbV9AcceptedOk nimmt turbo nur als true', /if\(m\.turbo!==undefined&&m\.turbo!==true\)return false;/.test(HTML));
  t('fbV9Wirken uebernimmt den Turbo nur aus der geprueften Enthuellung', /fbTurboZug\[e\.seat\]=e\.move\.turbo===true;/.test(HTML));
  t('applyLaunch: genau ein Faktor je gestartetem Sitz, danach verfaellt jeder Turbo-Zug',
    /const turbo=typeof fbTurboFaktor==='function'\?fbTurboFaktor\(p,Math\.hypot\(commitAim\[p\]\.dx,commitAim\[p\]\.dy\)\):1;/.test(HTML) && /if\(typeof fbTurboLeeren==='function'\)fbTurboLeeren\(\);\n  \/\/ Der Abschuss ist EIN Ereignis/.test(HTML));
  t('Match-Reset setzt den Vorrat zurueck', /fbClockReset\(\);if\(typeof fbTurboReset==='function'\)fbTurboReset\(\);footballClearGoalFx\(\)/.test(HTML));
  t('online reist die Wahl im Commit, nicht offen daneben', /fbV9LebenHandeln\(\{move:\{idx:m\.idx,dx:m\.dx,dy:m\.dy,sp:m\.sp,turbo:turbo\}\}\)/.test(HTML));
  const rules = require('fs').readFileSync(require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  t('keine neue Datenbankform: die Rules kennen kein Turbo-Feld', !/turbo/i.test(rules));
}

// ══ 5. VERSIONSGRENZE ════════════════════════════════════════════════════════
abschnitt('5. Versionsgrenze: Turbo nur in Raeumen der Fassung 14');
{
  const { fassungTurbo, grabFunction } = require('./extract');
  const F = new Function('welt', `const ONLINE_PROTOCOL_VERSION=11, ROOM_GAME_RINGOUT='ringout', ROOM_GAME_FOOTBALL='football', RINGOUT_SKIP_FASSUNG=12, RINGOUT_PARITY_FASSUNG=13;
    const FB_ONLINE_MODE_TACTICAL='tactical', FB_ONLINE_MODE_TACTICAL4='tactical4', FB_ONLINE_MODE_TEAM2='team2v2', FB_ONLINE_MODE_LIVES='lives', FB_TAC_SITZE=2, FB_TEAM2_SITZE=4;
    let online=true, roomProto=0;
    ${fassungTurbo(HTML)}
    ${hol(/let roomFassung=0;\nfunction raumFassungSetzen\(v\)\{[^\n]*\}\nfunction fbTurboRaum\(\)\{[^\n]*\}/, 'Setter')}
    ${grabFunction(HTML, 'fbRaumFassung')}
    ${grabFunction(HTML, 'fbRaumFassungOk')}
    ${grabFunction(HTML, 'roomListable')}
    return { T: FOOTBALL_TURBO_FASSUNG, v11: fbFassungV11, proto: fbProtoVonFassung, fassung: fbRaumFassung, ok: fbRaumFassungOk, listbar: roomListable,
             setzen: raumFassungSetzen, turboRaum: fbTurboRaum, stand: () => ({ roomFassung, roomProto }), setOnline: (o) => { online = o; } };`)({});
  const cfg = (mode, cap) => ({ game: 'football', fmt: 'elimination', mode, cap, winTarget: 3, visibility: 'private' });
  t('die Turbo-Fassung ist 14 und gehoert zur v11-Familie', F.T === 14 && F.v11(14) && F.v11(11) && !F.v11(10) && !F.v11(13) && !F.v11(15));
  t('ihre Protokollnummer ist 11 - die Rundenmaschine bleibt dieselbe', F.proto(14) === 11 && F.proto(11) === 11 && F.proto(13) === 13 && F.proto(8) === 8);
  t('jeder NEUE Raum der vier Modi traegt die Turbo-Fassung', [['lives', 5], ['tactical', 2], ['tactical4', 2], ['team2v2', 4]].every(([m, c]) => F.fassung(cfg(m, c)) === 14));
  t('RingOut bekommt sie nie', ['ffa', 'triple_ffa', 'team_duel', 'single', 'double'].every(f => F.fassung({ game: 'ringout', fmt: f }) === 13));
  t('der neue Client bedient und listet 11 UND 14', F.ok(11) && F.ok(14) && F.listbar(11) && F.listbar(14) && !F.ok(15));
  // Der ALTE Client (ausgeliefert vor dem Turbo) kennt 14 nicht: genau diese Zeile stand dort.
  const altOk = new Function('const ONLINE_PROTOCOL_VERSION=11, RINGOUT_SKIP_FASSUNG=12, RINGOUT_PARITY_FASSUNG=13;\n'
    + 'function fbRaumFassungOk(v){ return v===8||(ONLINE_PROTOCOL_VERSION>=9&&v===9)||(ONLINE_PROTOCOL_VERSION>=10&&v===10)||(ONLINE_PROTOCOL_VERSION>=11&&v===11)||v===RINGOUT_SKIP_FASSUNG||v===RINGOUT_PARITY_FASSUNG; }\nreturn fbRaumFassungOk;')();
  t('der alte Client lehnt Fassung 14 beim Beitritt ab und bedient 11 weiter', altOk(14) === false && altOk(11) === true);
  F.setzen(14);
  t('Turbo-Raum: Fassung 14, Protokoll 11, Turbo an', F.stand().roomFassung === 14 && F.stand().roomProto === 11 && F.turboRaum() === true);
  F.setzen(11);
  t('Bestandsraum: Fassung 11, Protokoll 11, KEIN Turbo', F.stand().roomFassung === 11 && F.stand().roomProto === 11 && F.turboRaum() === false);
  F.setzen(13);
  t('RingOut-Raum: kein Turbo', F.turboRaum() === false && F.stand().roomProto === 13);
  F.setzen(14); F.setOnline(false);
  t('ohne Onlineraum gibt es keinen Turbo-RAUM (lokal entscheidet der Modus)', F.turboRaum() === false);

  // Der Spielbaustein haengt an derselben Frage.
  const TURBO = zwischen('// ══ ARENA FOOTBALL — TURBO BOOST', 'function applyLaunch(){');
  const welt = { mode: 'football', wer: 0, turboRaum: false };
  const M = new Function('welt', `let mode=welt.mode, phase='aim', menuVisible=false, online=true, myPlayer=0, LANG='de', replaying=false;
    const FOOTBALL_ELIM_MAX_PLAYERS=5;
    function fbTurboRaum(){ return online && welt.turboRaum === true; }
    function whoCanAim(){ return welt.wer; } function T(k){ return k; } function toast(){} function pName(o){ return 'P'; } function fbFeelLaunch(){}
    ${TURBO}
    return { reset: fbTurboReset, rest: fbTurboUebrig, um: fbTurboUmschalten, fuer: fbTurboFuerZug, ab: fbTurboAbgegeben, faktor: fbTurboFaktor,
             wahl: () => fbTurboWahl.slice(), an: fbTurboAn, setOnline: (o) => { online = o; }, FAKTOR: FB_TURBO_FAKTOR };`)(welt);
  M.reset();
  const schuss = { dx: 80, dy: -40 };
  M.um();
  t('online im Bestandsraum: nichts waehlbar, kein Turbo-Zug, kein Faktor', M.an() === false && M.wahl()[0] === false && M.fuer(0, schuss) === false && (M.ab(0, true, true), M.faktor(0, 89) === 1) && M.rest(0) === 3);
  welt.turboRaum = true; M.reset(); M.um();
  t('online im Turbo-Raum: waehlbar, Turbo-Zug, Faktor, Verbrauch', M.an() === true && M.wahl()[0] === true && M.fuer(0, schuss) === true && (M.ab(0, true, true), M.faktor(0, 89) === M.FAKTOR) && M.rest(0) === 2);
  M.setOnline(false); welt.turboRaum = false; M.reset(); M.um();
  t('lokal: Turbo unabhaengig von jeder Raumfassung', M.an() === true && M.wahl()[0] === true);

  t('fbTurboAn haengt online am Raum', /function fbTurboAn\(\)\{return mode==='football'&&\(!online\|\|\(typeof fbTurboRaum==='function'&&fbTurboRaum\(\)\)\);\}/.test(HTML));
  t('die Pruefung deutet die Turbo-Zugart nur im Turbo-Raum', /typeof FB_V9_KIND_TURBO==='undefined'\|\|!\(typeof fbTurboRaum==='function'&&fbTurboRaum\(\)\)\)\?null:/.test(HTML));
  t('zurueckgeschrieben und verglichen wird die Fassung, wie sie im Raum steht', (HTML.match(/upd\['v'\]=roomFassung;/g) || []).length === 2 && /if\(v\.v!==roomFassung\)return 'version';/.test(HTML) && /const room=\{v:roomFassung,/.test(HTML));
  const rules = require('fs').readFileSync(require('path').join(__dirname, '..', 'firebase.rules.json'), 'utf8');
  const n11 = (rules.match(/=== 11(?!\d)/g) || []).length, n14 = (rules.match(/=== 14(?!\d)/g) || []).length;
  const u11 = (rules.match(/!== 11(?!\d)/g) || []).length, u14 = (rules.match(/!== 14(?!\d)/g) || []).length;
  t('die Rules nennen Fassung 14 an jeder Stelle, an der sie 11 nennen (' + n11 + '/' + n14 + ', ' + u11 + '/' + u14 + ')', n11 === n14 && u11 === u14 && n11 >= 80);
  t('und die Fassung eines Raums ist unveraenderlich', /"v": \{ "\.write": "data\.exists\(\) && newData\.exists\(\) && newData\.val\(\) === data\.val\(\)"/.test(rules));
}

console.log(`\nFootball-Turbo: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ABBRUCH: ' + (e && e.stack || e)); process.exit(1); });
