// V9.3B1: die ruhende Protokollmaschine des Clients.
//
// Geprueft wird der ECHTE Quelltext aus index.html - Codec UND Maschine werden wie in
// den uebrigen Suiten herausgeschnitten und in einer Sandbox ausgefuehrt.
//
// WAS DIESE STUFE IST: Deutung, kein Netz. Die Maschine baut Commits und Reveals, haelt
// das Geheimnis der Runde, liest die beiden Barrieren und prueft Enthuellungen. Sie
// schreibt nichts, liest nichts aus Firebase und wird vom freigegebenen v8-Weg nicht
// aufgerufen. Der spielt unveraendert ueber g/<gen>/t/<turn>/<seat>.
//
// WAS SIE AUSDRUECKLICH NICHT TUT: sie fasst weder commitIdx/commitAim/aimSet noch die
// Physik an und ruft applyLaunch() nicht auf. Was aus einem falschen Hash oder einer
// ausgebliebenen Enthuellung SPIELERISCH folgt, ist eine offene Entscheidung.
//   node test_online_v9_client.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length)));
function grab(re, was) {
  const m = HTML.match(re);
  if (!m) throw new Error('Region nicht gefunden: ' + was);
  return m[0];
}

// ── Codec und Maschine in eine Sandbox holen ─────────────────────────────────
const REGIONEN = [
  // Codec (V9.3A)
  /const FB_V9_PREIMAGE_BYTES=60[^\n]*/, /const FB_V9_DOMAIN=\[[^\n]*/,
  /const FB_V9_HASH_PROTOCOL=9;/, /const FB_V9_KIND_MOVE=1;/,
  /const FB_V9_CODE_RE=[^\n]*/, /const FB_V9_VEC_MAX=195;/,
  /const FB_V9_U32_MAX=4294967295;/, /const FB_V9_HEX_SALT_RE=[^\n]*/,
  /function fbV9CryptoReady\(\)\{[\s\S]*?\n\}/, /function fbV9Int\(v,min,max\)\{[\s\S]*?\n\}/,
  /function fbV9Num\(v,grenze\)\{[\s\S]*?\n\}/, /function fbV9Preimage\(f,salt\)\{[\s\S]*?\n\}/,
  /function fbV9NewSalt\(\)\{[\s\S]*?\n\}/, /function fbV9Hex\(bytes\)\{[\s\S]*?\n\}/,
  /function fbV9Bytes\(hex,anzahl\)\{[\s\S]*?\n\}/, /const fbV9SaltFromHex=[^\n]*/,
  /async function fbV9Hash\(f,salt\)\{[\s\S]*?\n\}/,
  /async function fbV9Verify\(hash,f,salt\)\{[\s\S]*?\n\}/,
  // Maschine (V9.3B1)
  /const FB_V9_TERMINALS=[^\n]*/, /const FB_V9_RESULTS=[^\n]*/,
  /const FB_V9_VALID='VALID'[\s\S]*?NO_REVEAL';/,
  /let fbV9Secret=null;/, /function fbV9SecretClear\(\)\{[^\n]*/,
  /function fbV9SecretFor\(room,gen,turn\)\{[\s\S]*?\n\}/,
  /function fbV9SecretDone\(room,gen,turn\)\{[\s\S]*?\n\}/,
  /function fbV9SecretSync\(room,gen\)\{[\s\S]*?\n\}/,
  /async function fbV9MakeCommit\(ctx,zug\)\{[\s\S]*?\n\}/,
  /function fbV9MakePass\(\)\{[^\n]*/, /function fbV9MakeReveal\(ctx\)\{[\s\S]*?\n\}/,
  /function fbV9TerminalOk\(rec\)\{[\s\S]*?\n\}/, /function fbV9ResultOk\(rec\)\{[\s\S]*?\n\}/,
  /function fbV9CommitsComplete\(cap,c\)\{[\s\S]*?\n\}/,
  /function fbV9ResultsComplete\(cap,c,r\)\{[\s\S]*?\n\}/,
  /async function fbV9VerifyPair\(ctx,seat,commit,reveal\)\{[\s\S]*?\n\}/,
  /async function fbV9AcceptedSet\(ctx,cap,c,r\)\{[\s\S]*?\n\}/,
];
const bau = (kryptoStelle) => new Function('crypto', `
  const FB_ONLINE_SEATS=5, FB_ONLINE_BALL_IDX=5;
  ${REGIONEN.map((r, i) => grab(r, 'Region ' + i)).join('\n')}
  return { fbV9CryptoReady, fbV9NewSalt, fbV9Hex, fbV9SaltFromHex, fbV9Hash,
           fbV9SecretClear, fbV9SecretFor, fbV9SecretSync, fbV9SecretDone,
           fbV9MakeCommit, fbV9MakePass,
           fbV9MakeReveal, fbV9TerminalOk, fbV9ResultOk, fbV9CommitsComplete,
           fbV9ResultsComplete, fbV9VerifyPair, fbV9AcceptedSet,
           FB_V9_VALID, FB_V9_MISMATCH, FB_V9_MALFORMED, FB_V9_NO_REVEAL };
`)(kryptoStelle);
const M = bau(globalThis.crypto);

const hex = (b) => Buffer.from(b).toString('hex');
const H64 = 'ab12'.repeat(16), H32 = '0123456789abcdef'.repeat(2);
const CTX = { room: 'RN2K', gen: 7, turn: 42, seat: 1 };
const ZUG = { idx: 1, dx: 12.5, dy: -8.25, sp: 0.5 };
const wirft = async (fn) => { try { await fn(); return false; } catch (e) { return true; } };
// Terminals in beliebiger EINFUEGEreihenfolge bauen - genau darum geht es weiter unten.
const karte = (paare) => { const o = {}; for (const p of paare) o[p[0]] = p[1]; return o; };
const MOVE = (h) => ({ k: 'move', h: h || H64 });
const NULLT = (k) => ({ k: k });

console.log('=== V9.3B1: die ruhende Protokollmaschine ===');

(async () => {

// ══ COMMIT UND GEHEIMNIS ═════════════════════════════════════════════════════
abschnitt('Commit bauen und das Geheimnis halten');
{
  M.fbV9SecretClear();
  const c = await M.fbV9MakeCommit(CTX, ZUG);
  t('das Terminal nennt die Zugart move', c.k === 'move');
  t('und traegt einen 64-stelligen Hash', /^[0-9a-f]{64}$/.test(c.h), c.h);
  // Das Entscheidende: im Terminal steht NUR der Hash.
  t('das Terminal traegt genau zwei Felder', Object.keys(c).sort().join(',') === 'h,k',
    Object.keys(c).join(','));
  for (const f of ['dx', 'dy', 'sp', 'idx', 'n', 'salt'])
    t('kein ' + f + ' im Commit-Terminal', c[f] === undefined);

  const s = M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn);
  t('das Geheimnis liegt lokal bereit', !!s);
  t('es haelt das Salz als 16 rohe Bytes',
    s.salt instanceof Uint8Array && s.salt.length === 16, s.salt && s.salt.length);
  t('und den kanonischen Vektor unveraendert',
    s.idx === 1 && s.dx === 12.5 && s.dy === -8.25 && s.sp === 0.5);
  t('sowie den Hash, den es erzeugt hat', s.h === c.h);
  t('ein anderer Turn findet dieses Geheimnis nicht',
    M.fbV9SecretFor(CTX.room, CTX.gen, 43) === null);
  t('eine andere Generation ebenso wenig',
    M.fbV9SecretFor(CTX.room, 8, CTX.turn) === null);
  t('und ein anderer Raum auch nicht',
    M.fbV9SecretFor('ABCD', CTX.gen, CTX.turn) === null);

  // Unzulaessige Zugfelder erzeugen kein Commit - und kein Geheimnis.
  for (const paar of [['NaN', { dx: NaN }], ['Unendlich', { dy: Infinity }],
                      ['ausserhalb der Grenze', { dx: 196 }], ['fremde Figur', { idx: 9 }]])
    t('ein Zug mit ' + paar[0] + ' erzeugt kein Commit',
      await wirft(() => M.fbV9MakeCommit(CTX, Object.assign({}, ZUG, paar[1]))));

  // Ohne Web Crypto: geschlossen scheitern, nicht behelfsweise weiterrechnen.
  const ohne = bau({ subtle: {} });
  t('ohne Web Crypto entsteht kein Commit',
    await wirft(() => ohne.fbV9MakeCommit(CTX, ZUG)));
  t('und die Verfuegbarkeit wird ehrlich gemeldet', ohne.fbV9CryptoReady() === false);
}

// ══ PASS ═════════════════════════════════════════════════════════════════════
abschnitt('Die selbstgeschriebene Nullhandlung');
{
  const p = M.fbV9MakePass();
  t('pass traegt genau ein Feld', Object.keys(p).join(',') === 'k', Object.keys(p).join(','));
  t('naemlich die Zugart', p.k === 'pass');
  t('kein Hash', p.h === undefined);
  t('kein Salz - auch kein heimliches', p.n === undefined && p.salt === undefined);
}

// ══ BARRIERE 1 ═══════════════════════════════════════════════════════════════
abschnitt('Commit-Barriere: jeder Sitz der Sollbesetzung');
{
  const voll = (n) => { const o = {}; for (let i = 0; i < n; i++) o[i] = NULLT('pass'); return o; };
  t('cap 2 vollstaendig', M.fbV9CommitsComplete(2, voll(2)) === true);
  t('cap 3 vollstaendig', M.fbV9CommitsComplete(3, voll(3)) === true);
  t('cap 5 vollstaendig', M.fbV9CommitsComplete(5, voll(5)) === true);
  t('ein fehlender Sitz macht sie unvollstaendig', M.fbV9CommitsComplete(3, voll(2)) === false);
  t('ein Eintrag ausserhalb der Sollbesetzung ersetzt ihn nicht',
    M.fbV9CommitsComplete(3, karte([[0, NULLT('pass')], [1, NULLT('pass')], [4, NULLT('pass')]])) === false);
  t('alle fuenf Terminalarten werden erkannt',
    M.fbV9CommitsComplete(5, karte([[0, MOVE()], [1, NULLT('pass')], [2, NULLT('skip')],
                                    [3, NULLT('remove')], [4, NULLT('late')]])) === true);
  // Missgebildetes zaehlt NICHT mit.
  for (const paar of [['unbekannte Zugart', { k: 'out' }], ['ohne Zugart', { h: H64 }],
                      ['move ohne Hash', { k: 'move' }],
                      ['move mit kurzem Hash', { k: 'move', h: H64.slice(0, 63) }],
                      ['move mit Grossbuchstaben', { k: 'move', h: H64.toUpperCase() }],
                      ['pass MIT Hash', { k: 'pass', h: H64 }],
                      ['kein Objekt', 'pass'], ['null', null], ['leer', {}]])
    t('ein Terminal ' + paar[0] + ' erfuellt die Barriere nicht',
      M.fbV9CommitsComplete(2, karte([[0, NULLT('pass')], [1, paar[1]]])) === false);
  t('eine unsinnige Sollbesetzung wird abgelehnt',
    M.fbV9CommitsComplete(1, voll(1)) === false && M.fbV9CommitsComplete(6, voll(6)) === false);
  t('und eine fehlende Karte ebenso', M.fbV9CommitsComplete(3, null) === false);

  // Die EINFUEGEreihenfolge darf nichts aendern.
  const auf = karte([[0, MOVE()], [1, NULLT('pass')], [2, NULLT('late')]]);
  const ab = karte([[2, NULLT('late')], [1, NULLT('pass')], [0, MOVE()]]);
  t('die Einfuegereihenfolge aendert die Antwort nicht',
    M.fbV9CommitsComplete(3, auf) === M.fbV9CommitsComplete(3, ab) &&
    M.fbV9CommitsComplete(3, auf) === true);
}

// ══ REVEAL BAUEN ═════════════════════════════════════════════════════════════
abschnitt('Reveal bauen - genau die gehashten Werte');
{
  M.fbV9SecretClear();
  const c = await M.fbV9MakeCommit(CTX, ZUG);
  const s = M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn);
  const r = M.fbV9MakeReveal(CTX);
  t('das Ergebnis nennt die Art reveal', r.k === 'reveal');
  t('es traegt genau die gehashten Werte - nicht neu bereinigte',
    r.idx === s.idx && r.dx === s.dx && r.dy === s.dy && r.sp === s.sp);
  t('und exakt das gehaltene Salz', r.n === hex(s.salt));
  t('das Salz ist 32 Zeichen kleingeschrieben hexadezimal', /^[0-9a-f]{32}$/.test(r.n), r.n);
  t('das Ergebnis traegt genau fuenf Felder plus Art',
    Object.keys(r).sort().join(',') === 'dx,dy,idx,k,n,sp', Object.keys(r).join(','));

  t('ein fremder Turn liefert kein Ergebnis',
    await wirft(() => M.fbV9MakeReveal({ room: CTX.room, gen: CTX.gen, turn: 43, seat: 1 })));
  t('ein fremder Sitz ebenso',
    await wirft(() => M.fbV9MakeReveal({ room: CTX.room, gen: CTX.gen, turn: CTX.turn, seat: 2 })));
  M.fbV9SecretClear();
  t('und ohne Geheimnis gibt es keines', await wirft(() => M.fbV9MakeReveal(CTX)));
}

// ══ PRUEFUNG ═════════════════════════════════════════════════════════════════
abschnitt('Die Pruefung: vier Kategorien, nie eine Ausnahme');
{
  M.fbV9SecretClear();
  const c = await M.fbV9MakeCommit(CTX, ZUG);
  const r = M.fbV9MakeReveal(CTX);
  const pruef = (ctx, seat, com, rev) => M.fbV9VerifyPair(
    ctx === undefined ? CTX : ctx, seat === undefined ? 1 : seat,
    com === undefined ? c : com, rev === undefined ? r : rev);

  const gut = await pruef();
  t('die genaue Enthuellung ist VALID', gut.status === M.FB_V9_VALID, gut.status);
  t('und liefert den kanonischen Zug zurueck',
    gut.move && gut.move.idx === 1 && gut.move.dx === 12.5 && gut.move.dy === -8.25 && gut.move.sp === 0.5);

  // Jedes gebundene Feld muss auffallen.
  for (const paar of [['dx', { dx: 12.6 }], ['dy', { dy: -8.2 }], ['sp', { sp: 0.4 }],
                      ['das Salz', { n: H32 }]]) {
    const p = await pruef(CTX, 1, c, Object.assign({}, r, paar[1]));
    t('ein geaendertes ' + paar[0] + ' ergibt HASH_MISMATCH', p.status === M.FB_V9_MISMATCH, p.status);
    t('und liefert keinen Zug', p.move === null);
  }
  for (const paar of [['der Raum', { room: 'ABCD' }], ['die Generation', { gen: 8 }],
                      ['der Turn', { turn: 43 }]]) {
    const p = await pruef(Object.assign({}, CTX, paar[1]), 1, c, r);
    t('ein anderer Zusammenhang - ' + paar[0] + ' - ergibt HASH_MISMATCH',
      p.status === M.FB_V9_MISMATCH, p.status);
  }
  {
    // Seit der Tiefensicherung faellt das FRUEHER auf: eine Enthuellung, deren
    // Koerperindex nicht zum geprueften Sitz gehoert, ist eine Eigentumsverletzung -
    // und die wird als solche benannt, nicht erst am Hash als Zufallsabweichung.
    const p = await pruef(CTX, 2, c, r);
    t('ein anderer Sitz ergibt MALFORMED - Eigentum vor Hash',
      p.status === M.FB_V9_MALFORMED, p.status);
    // Und der Hash bindet den Sitz weiterhin: bei PASSENDEM Eigentum, aber falschem
    // Sitz im Zusammenhang, bleibt es die Hashabweichung.
    const q = await M.fbV9VerifyPair(CTX, 2, c, Object.assign({}, r, { idx: 2 }));
    t('bei stimmigem Eigentum, aber fremdem Sitz bleibt es HASH_MISMATCH',
      q.status === M.FB_V9_MISMATCH, q.status);
  }

  // Missgebildetes ist NICHT dasselbe wie ein falscher Hash.
  for (const paar of [['ein kurzer Commit-Hash', { k: 'move', h: H64.slice(0, 10) }],
                      ['ein Commit ohne Hash', { k: 'move' }],
                      ['ein Nullterminal statt eines Commits', NULLT('pass')],
                      ['gar kein Commit', null]]) {
    const p = await pruef(CTX, 1, paar[1], r);
    t(paar[0] + ' ergibt MALFORMED', p.status === M.FB_V9_MALFORMED, p.status);
  }
  for (const paar of [['ein kurzes Salz', { n: H32.slice(0, 31) }],
                      ['ein grossgeschriebenes Salz', { n: H32.toUpperCase() }],
                      ['ein nicht hexadezimales Salz', { n: 'z'.repeat(32) }],
                      ['ein NaN im Vektor', { dx: NaN }], ['ein unendliches dy', { dy: Infinity }],
                      ['ein dx ausserhalb der Grenze', { dx: 196 }],
                      ['ein gebrochener Koerperindex', { idx: 1.5 }],
                      ['eine unbekannte Ergebnisart', { k: 'maybe' }]]) {
    const p = await pruef(CTX, 1, c, Object.assign({}, r, paar[1]));
    t(paar[0] + ' ergibt MALFORMED', p.status === M.FB_V9_MALFORMED, p.status);
  }
  {
    const p = await pruef(CTX, 1, c, null);
    t('ein fehlendes Ergebnis ergibt MALFORMED', p.status === M.FB_V9_MALFORMED, p.status);
    const q = await pruef(CTX, 1, c, NULLT('noreveal'));
    t('eine ausgebliebene Enthuellung ergibt NO_REVEAL', q.status === M.FB_V9_NO_REVEAL, q.status);
    t('und liefert keinen Zug - aber ausdruecklich KEINE Strafe', q.move === null);
  }
}

// ══ BARRIERE 2 ═══════════════════════════════════════════════════════════════
abschnitt('Reveal-Barriere: zu jedem move ein Ergebnis');
{
  const R = { k: 'reveal', idx: 0, dx: 1, dy: 1, sp: 0, n: H32 };
  t('lauter Nullterminals brauchen kein Ergebnis',
    M.fbV9ResultsComplete(3, karte([[0, NULLT('pass')], [1, NULLT('skip')], [2, NULLT('late')]]), {}) === true);
  t('ein move ohne Ergebnis haelt die Barriere offen',
    M.fbV9ResultsComplete(2, karte([[0, MOVE()], [1, NULLT('pass')]]), {}) === false);
  t('mit Enthuellung ist sie geschlossen',
    M.fbV9ResultsComplete(2, karte([[0, MOVE()], [1, NULLT('pass')]]), karte([[0, R]])) === true);
  t('mit festgehaltener Nicht-Enthuellung ebenso',
    M.fbV9ResultsComplete(2, karte([[0, MOVE()], [1, NULLT('pass')]]),
                          karte([[0, NULLT('noreveal')]])) === true);
  for (const paar of [['missgebildetes Salz', { n: 'xx' }], ['unbekannte Art', { k: 'maybe' }],
                      ['fehlendes idx', { idx: undefined }], ['NaN im Vektor', { dx: NaN }]])
    t('ein Ergebnis mit ' + paar[0] + ' schliesst sie nicht',
      M.fbV9ResultsComplete(2, karte([[0, MOVE()], [1, NULLT('pass')]]),
                            karte([[0, Object.assign({}, R, paar[1])]])) === false);
  t('ein Ergebnis am falschen Sitz hilft nicht',
    M.fbV9ResultsComplete(2, karte([[0, MOVE()], [1, NULLT('pass')]]), karte([[1, R]])) === false);
  t('cap 5 gemischt: drei Zuege enthuellt, zwei Nullterminals',
    M.fbV9ResultsComplete(5, karte([[0, MOVE()], [1, NULLT('pass')], [2, MOVE()],
                                    [3, NULLT('late')], [4, MOVE()]]),
                          karte([[4, R], [0, R], [2, NULLT('noreveal')]])) === true);
  t('fehlt eines davon, bleibt sie offen',
    M.fbV9ResultsComplete(5, karte([[0, MOVE()], [1, NULLT('pass')], [2, MOVE()],
                                    [3, NULLT('late')], [4, MOVE()]]),
                          karte([[0, R], [2, R]])) === false);
  t('eine offene Commit-Barriere schliesst auch die zweite nicht',
    M.fbV9ResultsComplete(3, karte([[0, MOVE()], [1, NULLT('pass')]]), karte([[0, R]])) === false);
}

// ══ DIE ANERKANNTE ZUGMENGE ══════════════════════════════════════════════════
abschnitt('Die anerkannte Zugmenge - aufsteigend nach Sitz');
{
  M.fbV9SecretClear();
  // Zwei echte Zuege auf den Sitzen 0 und 2, dazu drei Nullterminals.
  const mk = async (seat, zug) => {
    const ctx = { room: CTX.room, gen: CTX.gen, turn: CTX.turn, seat: seat };
    const c = await M.fbV9MakeCommit(ctx, zug);
    return { c: c, r: M.fbV9MakeReveal(ctx) };
  };
  const a = await mk(0, { idx: 0, dx: 10, dy: -10, sp: 0 });
  const b = await mk(2, { idx: 2, dx: -3.5, dy: 7.25, sp: -1 });

  const commits = [[0, a.c], [1, NULLT('pass')], [2, b.c], [3, NULLT('skip')], [4, NULLT('remove')]];
  const ergebnisse = [[0, a.r], [2, b.r]];
  const menge = await M.fbV9AcceptedSet(CTX, 5, karte(commits), karte(ergebnisse));

  t('die Menge hat einen Eintrag je Sitz', menge && menge.length === 5, menge && menge.length);
  t('und ist aufsteigend nach Sitz geordnet',
    menge.map(e => e.seat).join(',') === '0,1,2,3,4', menge.map(e => e.seat).join(','));
  t('Sitz 0 ist ein gueltiger Zug',
    menge[0].kind === 'move' && menge[0].status === M.FB_V9_VALID
    && menge[0].move.dx === 10 && menge[0].move.sp === 0);
  t('Sitz 2 ebenso',
    menge[2].kind === 'move' && menge[2].status === M.FB_V9_VALID
    && menge[2].move.dy === 7.25 && menge[2].move.sp === -1);
  for (const paar of [[1, 'pass'], [3, 'skip'], [4, 'remove']]) {
    t('Sitz ' + paar[0] + ' ist ein ' + paar[1] + ' - gueltig und ohne Zug',
      menge[paar[0]].kind === paar[1] && menge[paar[0]].status === M.FB_V9_VALID
      && menge[paar[0]].move === null);
  }

  // DIE EINTREFFREIHENFOLGE DARF NICHTS AENDERN. Dieselben Endkarten, rueckwaerts
  // eingefuegt - dieselbe Antwort, Feld fuer Feld.
  const rueck = await M.fbV9AcceptedSet(CTX, 5,
    karte(commits.slice().reverse()), karte(ergebnisse.slice().reverse()));
  t('rueckwaerts eingefuegt ergibt sich dieselbe Menge',
    JSON.stringify(rueck) === JSON.stringify(menge));

  // Die drei Stoerfaelle - jeder deterministisch benannt, keiner in einen Nullzug
  // umgedeutet und keiner mit einer Spielfolge versehen.
  const falsch = await M.fbV9AcceptedSet(CTX, 5,
    karte(commits), karte([[0, Object.assign({}, a.r, { dx: 11 })], [2, b.r]]));
  t('ein falscher Hash steht als HASH_MISMATCH da',
    falsch[0].status === M.FB_V9_MISMATCH && falsch[0].move === null, falsch[0].status);
  t('und die uebrigen Sitze bleiben davon unberuehrt',
    falsch[2].status === M.FB_V9_VALID);
  const ohne = await M.fbV9AcceptedSet(CTX, 5,
    karte(commits), karte([[0, NULLT('noreveal')], [2, b.r]]));
  t('eine ausgebliebene Enthuellung steht als NO_REVEAL da',
    ohne[0].status === M.FB_V9_NO_REVEAL && ohne[0].move === null, ohne[0].status);
  const kaputt = await M.fbV9AcceptedSet(CTX, 5,
    karte(commits), karte([[0, Object.assign({}, a.r, { n: H32 })], [2, b.r]]));
  t('ein fremdes Salz steht als HASH_MISMATCH da', kaputt[0].status === M.FB_V9_MISMATCH);

  t('bei offener Barriere gibt es noch keine Menge',
    (await M.fbV9AcceptedSet(CTX, 5, karte(commits), karte([[0, a.r]]))) === null);
}

// ══ DAS GEHEIMNIS RAEUMEN ════════════════════════════════════════════════════
abschnitt('Das Geheimnis wird deterministisch geraeumt');
{
  M.fbV9SecretClear();
  await M.fbV9MakeCommit(CTX, ZUG);
  t('nach dem Commit liegt es bereit', !!M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn));
  M.fbV9SecretClear();
  t('ein ausdruecklicher Ruecksetzer raeumt es', M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn) === null);

  await M.fbV9MakeCommit(CTX, ZUG);
  M.fbV9SecretSync(CTX.room, 8);
  t('ein Generationswechsel raeumt es', M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn) === null);

  await M.fbV9MakeCommit(CTX, ZUG);
  M.fbV9SecretSync('ABCD', CTX.gen);
  t('ein Raumwechsel raeumt es', M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn) === null);

  await M.fbV9MakeCommit(CTX, ZUG);
  M.fbV9SecretSync(CTX.room, CTX.gen);
  t('derselbe Raum und dieselbe Generation lassen es stehen',
    !!M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn));

  // Nach abgeschlossener Enthuellung wird GENAU dieses Geheimnis geraeumt - und nur
  // dieses. Ein blindes Loeschen koennte den Zug einer laufenden Runde mitnehmen.
  M.fbV9SecretDone(CTX.room, CTX.gen, 43);
  t('ein fremder Turn raeumt das Geheimnis NICHT',
    !!M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn));
  M.fbV9SecretDone('ABCD', CTX.gen, CTX.turn);
  t('ein fremder Raum ebenso wenig', !!M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn));
  M.fbV9SecretDone(CTX.room, 8, CTX.turn);
  t('und eine fremde Generation auch nicht', !!M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn));
  M.fbV9SecretDone(CTX.room, CTX.gen, CTX.turn);
  t('die eigene Runde raeumt es', M.fbV9SecretFor(CTX.room, CTX.gen, CTX.turn) === null);
}

// ══ DIE FORM AUS DER DATENBANK ═══════════════════════════════════════════════
abschnitt('Was aus Firebase zurueckkommt, traegt zusaetzlich ts');
{
  // Die Bauer liefern die Form OHNE Zeitstempel - den setzt spaeter die Schreibschicht
  // als Serverwert. Die Deuter bekommen sie aber MIT ts zurueck. Sie duerfen sich
  // deshalb nicht an der Bauform festhalten, sondern muessen die gespeicherte Form
  // lesen - sonst waere jede echte Runde fuer sie missgebildet.
  const TS = 1788700000000;
  t('ein gespeichertes move traegt zusaetzlich ts und bleibt gueltig',
    M.fbV9TerminalOk({ k: 'move', h: H64, ts: TS }) === true);
  for (const k of ['pass', 'skip', 'remove', 'late'])
    t('ein gespeichertes ' + k + ' ebenso', M.fbV9TerminalOk({ k: k, ts: TS }) === true);
  t('eine gespeicherte Enthuellung ebenso',
    M.fbV9ResultOk({ k: 'reveal', idx: 1, dx: 1, dy: 1, sp: 0, n: H32, ts: TS }) === true);
  t('und eine gespeicherte Nicht-Enthuellung ebenso',
    M.fbV9ResultOk({ k: 'noreveal', ts: TS }) === true);
  t('die Bauform ohne ts bleibt selbstverstaendlich lesbar',
    M.fbV9TerminalOk({ k: 'move', h: H64 }) === true && M.fbV9TerminalOk({ k: 'pass' }) === true);
  t('beide Barrieren lesen die gespeicherte Form',
    M.fbV9ResultsComplete(2, karte([[0, { k: 'move', h: H64, ts: TS }], [1, { k: 'pass', ts: TS }]]),
                          karte([[0, { k: 'noreveal', ts: TS }]])) === true);
}

// ══ EIGENTUM AM ABSCHUSS ═════════════════════════════════════════════════════
abschnitt('Ein Abschuss gehoert der eigenen Figur');
{
  // Dieselbe Zuordnung, die validateTurnRecord() im v8-Zugslot verlangt und die die
  // v9-Rules am Sitz festmachen. Hier gespiegelt, nicht erfunden.
  const v8 = grab(/function validateTurnRecord\(rec,game,seat\)\{[\s\S]*?\n\}/, 'validateTurnRecord');
  t('der v8-Validator verlangt idx === seat', /return rec\.idx===seat;/.test(v8));

  M.fbV9SecretClear();
  const ctx = { room: 'RN2K', gen: 7, turn: 42, seat: 1 };
  t('der eigene Koerperindex wird angenommen',
    !(await wirft(() => M.fbV9MakeCommit(ctx, { idx: 1, dx: 5, dy: 5, sp: 0 }))));
  for (const idx of [0, 2, 3, 4, 5])
    t('ein Commit auf die fremde Figur ' + idx + ' entsteht gar nicht erst',
      await wirft(() => M.fbV9MakeCommit(ctx, { idx: idx, dx: 5, dy: 5, sp: 0 })));
  t('und einer ausserhalb des Bereichs ebenso wenig',
    await wirft(() => M.fbV9MakeCommit(ctx, { idx: 6, dx: 5, dy: 5, sp: 0 })));

  // TIEFENSICHERUNG: ein in sich stimmiger Hash auf eine FREMDE Figur darf nie als
  // gueltiger Zug gelten - auch wenn die Rules so einen Datensatz gar nicht annehmen.
  // Der Deuter verlaesst sich nicht darauf, dass vor ihm schon jemand geprueft hat.
  M.fbV9SecretClear();
  const c2 = await M.fbV9MakeCommit(ctx, { idx: 1, dx: 5, dy: 5, sp: 0 });
  const r2 = M.fbV9MakeReveal(ctx);
  const gut = await M.fbV9VerifyPair(ctx, 1, c2, r2);
  t('die eigene Figur ergibt VALID', gut.status === M.FB_V9_VALID, gut.status);
  for (const idx of [0, 2, 5]) {
    const p = await M.fbV9VerifyPair(ctx, 1, c2, Object.assign({}, r2, { idx: idx }));
    t('eine Enthuellung auf die fremde Figur ' + idx + ' ergibt MALFORMED',
      p.status === M.FB_V9_MALFORMED && p.move === null, p.status);
  }
  const weg = await M.fbV9VerifyPair(ctx, 1, c2, Object.assign({}, r2, { idx: 9 }));
  t('und einer ausserhalb des Bereichs ebenso', weg.status === M.FB_V9_MALFORMED, weg.status);
}
// ══ QUELLTEXT-WAECHTER ═══════════════════════════════════════════════════════
abschnitt('Waechter: die Maschine ruht wirklich');
{
  const start = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
  const ende = HTML.indexOf('// ════ ENDE V9-PROTOKOLLMASCHINE ════');
  t('Codec und Maschine sind ein abgegrenzter Block', start > 0 && ende > start);
  const block = HTML.slice(start, ende);
  const rest = HTML.split(block).join('');
  // Fuer die Benutzungspruefungen zaehlt der CODE, nicht der Fliesstext: die
  // Kommentare der Maschine nennen genau die Namen, die sie nicht anfasst.
  const NL = String.fromCharCode(10);
  const ohneText = block.split(NL).map(zl => { const k = zl.indexOf('//');
    return k >= 0 ? zl.slice(0, k) : zl; }).join(NL);
  for (const w of ['window.FB', 'runTransaction', 'onValue', 'serverTimestamp', 'rRef('])
    t('die Maschine benutzt kein ' + w, ohneText.indexOf(w) < 0);
  // Und sie fasst den Spielzustand nicht an.
  for (const w of ['commitIdx', 'commitAim', 'commitSpin', 'aimSet', 'applyLaunch', 'balls['])
    t('sie beruehrt ' + w + ' nicht', ohneText.indexOf(w) < 0);
  // Der freigegebene v8-Weg ist unveraendert.
  const v8 = grab(/function writeTurnSlot\(s,payload,opts\)\{[\s\S]*?\n\}/, 'writeTurnSlot');
  t('writeTurnSlot() schreibt weiterhin in den v8-Pfad t/',
    /'\/g\/'\+ctx\.gen\+'\/t\/'\+ctx\.turnNo\+'\/'\+s/.test(v8));
  t('und kennt keinen v9-Pfad',
    v8.indexOf("/c/'") < 0 && v8.indexOf("/r/'") < 0 && v8.indexOf("/ro/'") < 0);
  const al = grab(/function applyLaunch\(\)\{[\s\S]*?\n\}/, 'applyLaunch');
  t('applyLaunch() ist unberuehrt', al.indexOf('fbV9') < 0 && al.indexOf('FB_V9') < 0);
  t('der freigegebene Client steht weiterhin auf Protokoll 8',
    /const ONLINE_PROTOCOL_VERSION=8;/.test(HTML));
  // Keine Spielfolge fuer eine ausgebliebene oder falsche Enthuellung - die Entscheidung
  // steht aus und darf hier nirgends vorweggenommen sein.
  for (const w of ['fbElimLives', 'footballElimEliminate', 'gameOver', 'toast('])
    t('die Maschine zieht keine Spielfolge ueber ' + w, ohneText.indexOf(w) < 0);
}

console.log('\nOnline-V9-Client: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.log('AUSNAHME: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
