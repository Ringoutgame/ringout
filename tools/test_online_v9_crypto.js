// V9.3A: der kryptografische Codec - kanonische Zugvorlage, Salz und SHA-256.
//
// Geprueft wird der ECHTE Quelltext aus index.html: die Codec-Regionen werden wie in den
// uebrigen Suiten herausgeschnitten und in einer Sandbox ausgefuehrt. Eine Nachbildung
// waere hier besonders wertlos - der ganze Sinn des Vertrags ist, dass genau DIESE Bytes
// entstehen.
//
// WAS DIESE STUFE IST: reine Rechenschicht. Sie schreibt nichts, liest nichts aus
// Firebase und wird von keinem Spielpfad aufgerufen. Der freigegebene Client bleibt auf
// ONLINE_PROTOCOL_VERSION = 8; die Einbindung in den Zugpfad ist V9.3B.
//   node test_online_v9_crypto.js
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

// ── Die echten Codec-Regionen in eine Sandbox holen ──────────────────────────
const REGIONEN = [
  [/const FB_V9_PREIMAGE_BYTES=60[^\n]*/, 'Groessen'],
  [/const FB_V9_DOMAIN=\[[^\n]*/, 'Bereichsmarke'],
  [/const FB_V9_HASH_PROTOCOL=9;/, 'Protokollnummer'],
  [/const FB_V9_KIND_MOVE=1;/, 'Zugart'],
  [/const FB_V9_CODE_RE=[^\n]*/, 'Raumcode-Alphabet'],
  [/const FB_V9_VEC_MAX=195;/, 'Vektorgrenze'],
  [/const FB_V9_U32_MAX=4294967295;/, 'uint32-Grenze'],
  [/const FB_V9_HEX_SALT_RE=[^\n]*/, 'Hexformen'],
  [/function fbV9CryptoReady\(\)\{[\s\S]*?\n\}/, 'fbV9CryptoReady'],
  [/function fbV9Int\(v,min,max\)\{[\s\S]*?\n\}/, 'fbV9Int'],
  [/function fbV9Num\(v,grenze\)\{[\s\S]*?\n\}/, 'fbV9Num'],
  [/function fbV9Preimage\(f,salt\)\{[\s\S]*?\n\}/, 'fbV9Preimage'],
  [/function fbV9NewSalt\(\)\{[\s\S]*?\n\}/, 'fbV9NewSalt'],
  [/function fbV9Hex\(bytes\)\{[\s\S]*?\n\}/, 'fbV9Hex'],
  [/function fbV9Bytes\(hex,anzahl\)\{[\s\S]*?\n\}/, 'fbV9Bytes'],
  [/const fbV9SaltFromHex=[^\n]*/, 'fbV9SaltFromHex'],
  [/async function fbV9Hash\(f,salt\)\{[\s\S]*?\n\}/, 'fbV9Hash'],
  [/async function fbV9Verify\(hash,f,salt\)\{[\s\S]*?\n\}/, 'fbV9Verify'],
];
const bau = (kryptoStelle) => new Function('crypto', `
  // Die zwei Grenzwerte, die der Codec aus dem Onlineteil mitbenutzt.
  const FB_ONLINE_SEATS=5, FB_ONLINE_BALL_IDX=5;
  ${REGIONEN.map(r => grab(r[0], r[1])).join('\n')}
  return { fbV9CryptoReady, fbV9Preimage, fbV9NewSalt, fbV9Hex, fbV9Bytes,
           fbV9SaltFromHex, fbV9Hash, fbV9Verify,
           FB_V9_PREIMAGE_BYTES, FB_V9_SALT_BYTES, FB_V9_DOMAIN, FB_V9_HASH_PROTOCOL };
`)(kryptoStelle);
// Der Regelfall: die echten Bausteine der Laufzeit.
const C = bau(globalThis.crypto);

// Hilfen fuer die Tests selbst - bewusst OHNE die Produktionshelfer gebaut.
const hex = (b) => Buffer.from(b).toString('hex');
const salt16 = (start) => { const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = (start === undefined ? i : (start + i) & 0xff); return s; };
const ZUG = { room: 'RN2K', gen: 7, turn: 42, seat: 3, kind: 1, idx: 3,
              dx: 12.5, dy: -8.25, sp: 0.5 };
const mit = (aenderung) => Object.assign({}, ZUG, aenderung);
const wirft = (fn) => { try { fn(); return false; } catch (e) { return true; } };

console.log('=== V9.3A: Zugvorlage, Salz und SHA-256 ===');

// ══ SERIALISIERUNG ═══════════════════════════════════════════════════════════
abschnitt('Die 60-Byte-Vorlage');
{
  const b = C.fbV9Preimage(ZUG, salt16());
  t('die Vorlage ist genau 60 Byte lang', b.length === 60, b.length);
  t('und ist eine Uint8Array', b instanceof Uint8Array);
  t('die Bereichsmarke steht auf 0..3: 52 4f 39 01', hex(b.subarray(0, 4)) === '524f3901', hex(b.subarray(0, 4)));
  t('Byte 4 traegt die Protokollnummer 9 - nicht die 8 des Clients', b[4] === 9, b[4]);
  t('der Raumcode steht als vier ASCII-Bytes auf 5..8',
    hex(b.subarray(5, 9)) === Buffer.from('RN2K', 'ascii').toString('hex'), hex(b.subarray(5, 9)));

  // Die Ganzzahlen - Byte fuer Byte, gross-endian.
  t('die Generation steht gross-endian auf 9..12', hex(b.subarray(9, 13)) === '00000007', hex(b.subarray(9, 13)));
  t('der Turn steht gross-endian auf 13..16', hex(b.subarray(13, 17)) === '0000002a', hex(b.subarray(13, 17)));
  t('der Sitz steht auf 17', b[17] === 3, b[17]);
  t('die Zugart move = 1 steht auf 18', b[18] === 1, b[18]);
  t('der Koerperindex steht auf 19', b[19] === 3, b[19]);

  // Die Gleitkommazahlen - gegen die unabhaengige Rechnung von Node.
  const bd = (v) => { const x = Buffer.alloc(8); x.writeDoubleBE(v); return x.toString('hex'); };
  t('dx liegt als binary64 gross-endian auf 20..27', hex(b.subarray(20, 28)) === bd(12.5), hex(b.subarray(20, 28)));
  t('dy ebenso auf 28..35', hex(b.subarray(28, 36)) === bd(-8.25), hex(b.subarray(28, 36)));
  t('sp ebenso auf 36..43', hex(b.subarray(36, 44)) === bd(0.5), hex(b.subarray(36, 44)));
  t('das Salz belegt genau 44..59', hex(b.subarray(44, 60)) === hex(salt16()), hex(b.subarray(44, 60)));

  // Gross-Endian ist ausdruecklich gemeint: klein-endian saehe anders aus.
  const kl = Buffer.alloc(8); kl.writeDoubleLE(12.5);
  t('und zwar GROSS-endian - klein-endian waere ein anderes Bitmuster',
    hex(b.subarray(20, 28)) !== kl.toString('hex'));
}

// ══ RAUMCODE ═════════════════════════════════════════════════════════════════
abschnitt('Der Raumcode - dasselbe Alphabet wie rrand()');
{
  for (const code of ['RN2K', 'ABCD', '2345', 'ZZZZ', 'HJKM'])
    t('ein gueltiger Code wird angenommen: ' + code,
      !wirft(() => C.fbV9Preimage(mit({ room: code }), salt16())));
  // I, L, O und 0/1 fehlen im Alphabet - sie sind mit anderen Zeichen verwechselbar.
  for (const code of ['RIN2', 'RLN2', 'RON2', 'R0N2', 'R1N2'])
    t('ein Code mit Verwechslungszeichen wird abgewiesen: ' + code,
      wirft(() => C.fbV9Preimage(mit({ room: code }), salt16())));
  for (const code of ['RN2', 'RN2KK', '', 'rn2k', 'RN2k', 'RN-K', 'RN 2'])
    t('ein missgebildeter Code wird abgewiesen: "' + code + '"',
      wirft(() => C.fbV9Preimage(mit({ room: code }), salt16())));
  t('ein Code, der keine Zeichenkette ist, wird abgewiesen',
    wirft(() => C.fbV9Preimage(mit({ room: 1234 }), salt16())));
}

// ══ NORMALISIERUNG ═══════════════════════════════════════════════════════════
abschnitt('Normalisierung: eine Bedeutung, ein Bitmuster');
{
  // Negative Null verhaelt sich in jeder Rechnung wie +0, hat aber ein anderes
  // Bitmuster. Ohne Normalisierung haetten zwei identische Zuege zwei Hashes.
  const plus = C.fbV9Preimage(mit({ dx: 0, dy: 0, sp: 0 }), salt16());
  const minus = C.fbV9Preimage(mit({ dx: -0, dy: -0, sp: -0 }), salt16());
  t('+0 und -0 ergeben dieselben Bytes', hex(plus) === hex(minus));
  t('und zwar das Muster der POSITIVEN Null',
    hex(plus.subarray(20, 28)) === '0000000000000000', hex(plus.subarray(20, 28)));

  for (const paar of [['NaN', NaN], ['+Infinity', Infinity], ['-Infinity', -Infinity]])
    for (const feld of ['dx', 'dy', 'sp'])
      t('ein ' + feld + ' von ' + paar[0] + ' wird abgewiesen',
        wirft(() => C.fbV9Preimage(mit({ [feld]: paar[1] }), salt16())));

  // Die Vektorgrenzen sind die des v8-Zugslots.
  for (const paar of [['dx', 195.0001], ['dx', -195.0001], ['dy', 196], ['sp', 1.0001], ['sp', -1.0001]])
    t('ein ' + paar[0] + ' ausserhalb der Grenze wird abgewiesen',
      wirft(() => C.fbV9Preimage(mit({ [paar[0]]: paar[1] }), salt16())));
  t('genau AUF der Grenze ist zulaessig',
    !wirft(() => C.fbV9Preimage(mit({ dx: 195, dy: -195, sp: -1 }), salt16())));

  // Ganzzahlfelder: kein stilles Runden, kein Ueberlauf.
  for (const paar of [['gen', 1.5], ['turn', 2.5], ['seat', 1.5], ['idx', 0.5]])
    t('ein gebrochenes ' + paar[0] + ' wird abgewiesen',
      wirft(() => C.fbV9Preimage(mit({ [paar[0]]: paar[1] }), salt16())));
  for (const paar of [['gen', -1], ['turn', -1], ['seat', -1], ['idx', -1]])
    t('ein negatives ' + paar[0] + ' wird abgewiesen',
      wirft(() => C.fbV9Preimage(mit({ [paar[0]]: paar[1] }), salt16())));
  t('eine Generation ueber uint32 wird abgewiesen',
    wirft(() => C.fbV9Preimage(mit({ gen: 4294967296 }), salt16())));
  t('genau uint32-Maximum ist zulaessig',
    !wirft(() => C.fbV9Preimage(mit({ gen: 4294967295, turn: 4294967295 }), salt16())));
  t('ein Sitz jenseits der Sitzzahl wird abgewiesen',
    wirft(() => C.fbV9Preimage(mit({ seat: 5 }), salt16())));
  t('ein Koerperindex jenseits des Balls wird abgewiesen',
    wirft(() => C.fbV9Preimage(mit({ idx: 6 }), salt16())));
  t('der Ballindex 5 selbst ist darstellbar',
    !wirft(() => C.fbV9Preimage(mit({ idx: 5 }), salt16())));
  t('ohne Zugfelder gibt es keine Vorlage', wirft(() => C.fbV9Preimage(null, salt16())));
}

// ══ ZUGART ════════════════════════════════════════════════════════════════════
abschnitt('Die Zugart: nur was zugewiesen ist');
{
  // Das Byte bleibt im Vertrag - es trennt einen Abschuss von jeder kuenftigen Handlung,
  // damit ein Commit nicht spaeter als etwas anderes wiederverwendbar ist. Zugewiesen
  // ist bisher aber NUR move = 1. Alles andere scheitert geschlossen; eine zweite Zugart
  // braucht ihre eigene Nummer, ihren eigenen Vertrag und ihre eigenen Tests - nicht
  // eine Luecke, die schon offensteht.
  t('move = 1 wird angenommen', !wirft(() => C.fbV9Preimage(mit({ kind: 1 }), salt16())));
  for (const k of [0, 2, 3, 127, 255, 256, -1])
    t('eine nicht zugewiesene Zugart ' + k + ' wird abgewiesen',
      wirft(() => C.fbV9Preimage(mit({ kind: k }), salt16())));
  t('eine gebrochene Zugart wird abgewiesen',
    wirft(() => C.fbV9Preimage(mit({ kind: 1.5 }), salt16())));
  for (const paar of [['fehlend', undefined], ['null', null], ['Zeichenkette', 'move'],
                      ['NaN', NaN]])
    t('eine Zugart ' + paar[0] + ' wird abgewiesen',
      wirft(() => C.fbV9Preimage(mit({ kind: paar[1] }), salt16())));
  // Der eingefrorene Vektor bleibt davon unberuehrt: er traegt ohnehin move = 1.
  t('das Byte an Offset 18 ist unveraendert die 1',
    C.fbV9Preimage(ZUG, salt16())[18] === 1);
}

// ══ SALZ ═════════════════════════════════════════════════════════════════════
abschnitt('Das Salz: 128 Bit aus Web Crypto');
{
  t('Web Crypto ist in dieser Laufzeit vorhanden', C.fbV9CryptoReady() === true);
  const s = C.fbV9NewSalt();
  t('ein erzeugtes Salz ist eine Uint8Array', s instanceof Uint8Array);
  t('und genau 16 Byte lang', s.length === 16, s.length);
  // KEIN Test auf "zwei Salze sind verschieden": ein echter Zufallsgenerator darf
  // dieselbe Folge zweimal liefern, so unwahrscheinlich das ist. Eine Zusicherung, die
  // prinzipiell falsch fehlschlagen kann, ist keine Zusicherung. Nachgewiesen wird
  // stattdessen, was tatsaechlich verlangt ist: der Helfer fordert genau 16 Byte beim
  // Zufallsbaustein der Laufzeit an und gibt unveraendert zurueck, was dieser lieferte.
  const beobachtet = [];
  const gestellt = bau({
    getRandomValues: (ziel) => {
      beobachtet.push({ art: ziel && ziel.constructor && ziel.constructor.name,
                        laenge: ziel ? ziel.length : -1 });
      for (let i = 0; i < ziel.length; i++) ziel[i] = i;   // 00 01 02 ... 0f
      return ziel;
    },
    subtle: { digest: () => { throw new Error('hier nicht gebraucht'); } },
  });
  const kontrolliert = gestellt.fbV9NewSalt();
  t('fbV9NewSalt() fragt genau EINMAL beim Zufallsbaustein an',
    beobachtet.length === 1, beobachtet.length);
  t('und fordert genau 16 Byte an',
    beobachtet[0] && beobachtet[0].laenge === 16, beobachtet[0] && beobachtet[0].laenge);
  t('in einer Uint8Array',
    beobachtet[0] && beobachtet[0].art === 'Uint8Array', beobachtet[0] && beobachtet[0].art);
  t('und gibt exakt die gelieferten Bytes zurueck - unveraendert',
    hex(kontrolliert) === '000102030405060708090a0b0c0d0e0f', hex(kontrolliert));
  // Nichts global verbogen, nichts zurueckzusetzen: die Sandbox bekommt ihren
  // Zufallsbaustein als Parameter. Der regulaere Codec bleibt davon unberuehrt.
  t('der regulaere Codec liefert weiterhin ein 16-Byte-Salz', C.fbV9NewSalt().length === 16);
  // Der Quelltext greift ausdruecklich zu crypto.getRandomValues, nicht zu Math.random.
  const q = grab(/function fbV9NewSalt\(\)\{[\s\S]*?\n\}/, 'fbV9NewSalt');
  t('der Quelltext ruft crypto.getRandomValues', /crypto\.getRandomValues\(new Uint8Array\(/.test(q));
  t('und nirgends Math.random', q.indexOf('Math.random') < 0);

  const h = C.fbV9Hex(s);
  t('die Hexform ist 32 Zeichen lang', h.length === 32, h.length);
  t('und kleingeschrieben', h === h.toLowerCase() && /^[0-9a-f]{32}$/.test(h), h);
  t('Rueckweg Hex -> Bytes ergibt genau dasselbe Salz', hex(C.fbV9SaltFromHex(h)) === hex(s));

  const gut = '0123456789abcdef'.repeat(2);
  t('ein gueltiges Salz in Hexform wird angenommen', C.fbV9SaltFromHex(gut).length === 16);
  for (const paar of [['grossgeschrieben', gut.toUpperCase()], ['zu kurz', gut.slice(0, 31)],
                      ['zu lang', gut + 'a'], ['nicht hexadezimal', 'z'.repeat(32)],
                      ['leer', ''], ['keine Zeichenkette', 12345]])
    t('ein Salz ' + paar[0] + ' wird abgewiesen', wirft(() => C.fbV9SaltFromHex(paar[1])));

  t('eine Vorlage mit falscher Salzlaenge wird abgewiesen',
    wirft(() => C.fbV9Preimage(ZUG, new Uint8Array(15))));
  t('und eine ohne Salz ebenso', wirft(() => C.fbV9Preimage(ZUG, null)));
}

// ══ HASH ═════════════════════════════════════════════════════════════════════
abschnitt('SHA-256 und die Bindung');
(async () => {
  const s = salt16();
  const h = await C.fbV9Hash(ZUG, s);
  t('der Hash ist 64 Zeichen lang', h.length === 64, h.length);
  t('und kleingeschrieben hexadezimal', /^[0-9a-f]{64}$/.test(h), h);
  t('derselbe Zug mit demselben Salz ergibt denselben Hash',
    (await C.fbV9Hash(ZUG, s)) === h);

  // JEDES gebundene Feld muss den Hash aendern - sonst waere es nicht gebunden.
  const anders = [
    ['dx', { dx: 12.5000001 }], ['dy', { dy: -8.26 }], ['sp', { sp: 0.4999 }],
    ['die Generation', { gen: 8 }], ['den Turn', { turn: 43 }],
    ['den Sitz', { seat: 2 }], ['den Koerperindex', { idx: 2 }],
    ['den Raumcode', { room: 'RN2M' }],
  ];
  for (const paar of anders)
    t('ein anderer Wert fuer ' + paar[0] + ' ergibt einen anderen Hash',
      (await C.fbV9Hash(mit(paar[1]), s)) !== h);
  t('ein anderes Salz ergibt einen anderen Hash',
    (await C.fbV9Hash(ZUG, salt16(100))) !== h);

  // Die Pruefung: wahr nur bei genauer Uebereinstimmung, sonst falsch - nie eine
  // Ausnahme nach aussen und nie eine Reparatur.
  t('die Pruefung bestaetigt die genaue Enthuellung',
    (await C.fbV9Verify(h, ZUG, s)) === true);
  t('sie verneint einen geaenderten Vektor',
    (await C.fbV9Verify(h, mit({ dx: 12.6 }), s)) === false);
  t('sie verneint ein anderes Salz',
    (await C.fbV9Verify(h, ZUG, salt16(9))) === false);
  for (const paar of [['grossgeschrieben', h.toUpperCase()], ['zu kurz', h.slice(0, 63)],
                      ['nicht hexadezimal', 'z'.repeat(64)], ['leer', ''],
                      ['keine Zeichenkette', 12345], ['null', null]])
    t('ein Commit-Hash ' + paar[0] + ' scheitert geschlossen',
      (await C.fbV9Verify(paar[1], ZUG, s)) === false);
  t('unzulaessige Zugfelder scheitern geschlossen, ohne Ausnahme',
    (await C.fbV9Verify(h, mit({ dx: NaN }), s)) === false);

  // ══ FESTER PRUEFVEKTOR ═══════════════════════════════════════════════════
  abschnitt('Fester Pruefvektor - der Vertrag zwischen zwei Clients');
  // Diese beiden Zeichenketten sind EINGEFROREN. Sie wurden UNABHAENGIG vom
  // Produktionscode gerechnet (eigener Pufferaufbau, node:crypto) und sind damit die
  // Zusicherung, dass jede kuenftige Umsetzung - andere Sprache, anderes Geraet -
  // dieselben Bytes und denselben Hash erzeugt. Wer sie aendern muss, aendert das
  // Protokoll und braucht dafuer einen Grund.
  const V_BYTES = '524f390109524e324b000000070000002a0301034029000000000000'
                + 'c0208000000000003fe0000000000000000102030405060708090a0b0c0d0e0f';
  const V_HASH = '7c2d16b2c41f8131a70277ca5c4a558b99d0b9f5e38f81b56cd5a4e304ffc545';
  const vs = new Uint8Array(16); for (let i = 0; i < 16; i++) vs[i] = i;
  const vb = C.fbV9Preimage({ room: 'RN2K', gen: 7, turn: 42, seat: 3, kind: 1, idx: 3,
                              dx: 12.5, dy: -8.25, sp: 0.5 }, vs);
  t('die Vorlage des Pruefvektors ist byteweise die eingefrorene', hex(vb) === V_BYTES, hex(vb));
  t('und ihr SHA-256 ist der eingefrorene',
    (await C.fbV9Hash({ room: 'RN2K', gen: 7, turn: 42, seat: 3, kind: 1, idx: 3,
                        dx: 12.5, dy: -8.25, sp: 0.5 }, vs)) === V_HASH);
  // Gegenrechnung mit dem eingebauten SHA-256 von Node - eine zweite, unabhaengige
  // Umsetzung desselben Standards. Stimmen beide ueberein, liegt es nicht am Codec.
  const nodeHash = require('crypto').createHash('sha256').update(Buffer.from(vb)).digest('hex');
  t('node:crypto kommt ueber dieselben Bytes zum selben Hash', nodeHash === V_HASH, nodeHash);

  console.log('\nOnline-V9-Crypto: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('AUSNAHME: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
