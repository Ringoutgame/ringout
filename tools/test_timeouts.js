// FRISTEN-INVENTAR — eine Zahl, eine Bedeutung, zwei Orte.
//
// Jede Frist dieses Produkts steht an ZWEI Stellen: im Client (index.html) und in den
// Rules (firebase.rules.json). Laufen sie auseinander, entsteht der unangenehmste
// Fehlertyp, den es hier gibt - einer, den niemand sieht: der Client glaubt, ein Sitz sei
// frei, und der Server weist ihn ab. Oder umgekehrt.
//
// Diese Suite ist deshalb kein Verhaltenstest, sondern eine BESTANDSAUFNAHME mit
// Anspruch: sie zaehlt jede Zahl in den Rules, ordnet sie ihrer Bedeutung zu und
// vergleicht sie mit der Konstante, die im Client dieselbe Bedeutung traegt. Eine neue
// Zahl, eine verschobene Zahl oder eine Zahl an einer neuen Stelle laesst sie
// fehlschlagen - auch dann, wenn beide Seiten fuer sich genommen stimmig waeren.
//
// AUSDRUECKLICH GETRENNT gehalten werden zwei Dinge, die zufaellig gleich gross sind:
// die Rueckkehrfrist eines Sitzes (SEAT_STALE_MS) und die Bereitschaftsfrist einer Runde
// (FB_V9_READY_DEADLINE_MS). Geprueft wird deshalb nach PFAD und Muster, nie nach Wert.
//
//   node tools/test_timeouts.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const RULES_PATH = process.env.RULES_PATH || path.join(__dirname, '..', 'firebase.rules.json');
const RULES = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 58 - s.length)));

// ── Die Konstanten des Clients ──────────────────────────────────────────────
const zahl = (re, was) => {
  const m = HTML.match(re);
  if (!m) { console.log('nicht gefunden: ' + was); process.exit(2); }
  return Number(m[1]);
};
const K = {
  SEAT_STALE_MS: zahl(/const SEAT_STALE_MS=(\d+);/, 'SEAT_STALE_MS'),
  FB_V9_DEADLINE_MS: zahl(/const FB_V9_DEADLINE_MS=(\d+);/, 'FB_V9_DEADLINE_MS'),
  FB_V10_DEADLINE_MS: zahl(/const FB_V10_DEADLINE_MS=(\d+);/, 'FB_V10_DEADLINE_MS'),
  FB_V9_READY_DEADLINE_MS: zahl(/const FB_V9_READY_DEADLINE_MS=(\d+);/, 'FB_V9_READY_DEADLINE_MS'),
  HOST_EXTRA_GRACE_MS: zahl(/const HOST_EXTRA_GRACE_MS=(\d+);/, 'HOST_EXTRA_GRACE_MS'),
  ROOM_MAX_AGE_MS: zahl(/const ROOM_MAX_AGE_MS=(\d+);/, 'ROOM_MAX_AGE_MS'),
  GEN_MAX: zahl(/const GEN_MAX=(\d+)/, 'GEN_MAX'),
};
// Die abgeleiteten Fristen stehen im Client als AUSDRUCK da - genau das ist der Punkt:
// sie sind keine zweite Zahl, sondern eine Rechnung auf der ersten.
const LOBBY_HOST_AUSDRUCK = (HTML.match(/const LOBBY_HOST_GRACE_MS=([^;]+);/) || [])[1];
const V11_HOST_AUSDRUCK = (HTML.match(/const FB_V11_HOST_FRIST_MS=([^;]+);/) || [])[1];
const LOBBY_HOST_GRACE_MS = K.SEAT_STALE_MS + 5000;
const FB_V11_HOST_FRIST_MS = K.SEAT_STALE_MS + K.HOST_EXTRA_GRACE_MS;

console.log('=== FRISTEN-INVENTAR: Client und Rules ===');

abschnitt('Der Client - eine Quelle je Bedeutung');
{
  t('die Rueckkehrfrist steht genau EINMAL im Client',
    (HTML.match(/const SEAT_STALE_MS=/g) || []).length === 1);
  t('die Lobby-Wirtsfrist wird ABGELEITET, nicht wiederholt',
    LOBBY_HOST_AUSDRUCK === 'SEAT_STALE_MS+5000', LOBBY_HOST_AUSDRUCK);
  // Die Wirtsfrist ist Rueckkehrfrist PLUS einem eigenen, benannten Zuschlag - nicht
  // die Lobbyfrist der Bestandsfassungen, die einem anderen Zweck dient und sich mit
  // ihr verdoppeln wuerde.
  t('die v11-Wirtsfrist ist Rueckkehrfrist plus Wirtszuschlag',
    V11_HOST_AUSDRUCK === 'SEAT_STALE_MS+HOST_EXTRA_GRACE_MS', V11_HOST_AUSDRUCK);
  t('der Wirtszuschlag ist kleiner als die Rueckkehrfrist selbst',
    K.HOST_EXTRA_GRACE_MS > 0 && K.HOST_EXTRA_GRACE_MS < K.SEAT_STALE_MS,
    K.HOST_EXTRA_GRACE_MS);
  // Beide Spiele fragen DIESELBE Konstante: Ring Out ueber die gemeinsame
  // Praesenz-/Sitzschicht, Arena Football zusaetzlich in der Raumpruefung.
  // Der Rumpf bis zur naechsten Funktion - so haengt die Pruefung nicht an einer
  // geratenen Zeichenzahl.
  const NL = String.fromCharCode(10);
  const rumpf = (kopf) => { const i = HTML.indexOf(kopf);
    const j = HTML.indexOf(NL + 'function ', i + kopf.length);
    return HTML.slice(i, j > 0 ? j : i + 3000); };
  for (const fn of ['function fbSeatGrace(s){', 'function seatLage(p,s,jetzt,frist){'])
    t('SEAT_STALE_MS traegt ' + fn.slice(9, fn.indexOf('(')),
      rumpf(fn).indexOf('SEAT_STALE_MS') > 0);
  t('es gibt keine zweite Sitzfrist neben ihr',
    (HTML.match(/const [A-Z_0-9]*STALE[A-Z_0-9]*_MS=/g) || []).length === 1,
    (HTML.match(/const [A-Z_0-9]*STALE[A-Z_0-9]*_MS=/g) || []).join(','));
}

// ── Jede Zahl der Rules, mit Pfad ───────────────────────────────────────────
function zahlen() {
  const raus = [];
  const gehe = (node, pfad) => {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (k.startsWith('.') && typeof v === 'string') {
        const re = /(?<![\w.])(\d{4,9})(?![\w.])/g;
        let m;
        while ((m = re.exec(v))) raus.push({ wert: Number(m[1]), pfad, feld: k });
      } else if (v && typeof v === 'object') gehe(v, pfad + '/' + k);
    }
  };
  gehe(RULES.rules, '');
  return raus;
}
const GEFUNDEN = zahlen();
const zaehle = (wert, pfad, feld) => GEFUNDEN.filter(z => z.wert === wert && z.pfad === pfad && (!feld || z.feld === feld)).length;

// Was es geben DARF - und genau wie oft. Jede Zeile nennt die Bedeutung und die
// Konstante, aus der die Zahl stammt. Steht hier etwas nicht, faellt es unten auf.
const ERWARTET = [
  { bedeutung: 'Rueckkehrfrist eines Sitzes (Praesenz)',        pfad: '/rooms/$code/p/$i',                      feld: '.write', wert: K.SEAT_STALE_MS,           mal: 1, quelle: 'SEAT_STALE_MS' },
  { bedeutung: 'Rueckkehrfrist eines Sitzes (Roster)',          pfad: '/rooms/$code/players/$i',                feld: '.write', wert: K.SEAT_STALE_MS,           mal: 4, quelle: 'SEAT_STALE_MS' },
  { bedeutung: 'Rueckkehrfrist vor der Austragung',             pfad: '/rooms/$code/g/$gen/e/$seat',            feld: '.write', wert: K.SEAT_STALE_MS,           mal: 1, quelle: 'SEAT_STALE_MS' },
  { bedeutung: 'Bereitschaftsfrist einer Runde',                pfad: '/rooms/$code/g/$gen/q/$turn/$seat',      feld: '.write', wert: K.FB_V9_READY_DEADLINE_MS, mal: 2, quelle: 'FB_V9_READY_DEADLINE_MS' },
  { bedeutung: 'Entscheidungsfenster v10/v11',                  pfad: '/rooms/$code/g/$gen/c/$turn/$seat',      feld: '.write', wert: K.FB_V10_DEADLINE_MS,      mal: 3, quelle: 'FB_V10_DEADLINE_MS' },
  { bedeutung: 'Entscheidungsfenster v9',                       pfad: '/rooms/$code/g/$gen/c/$turn/$seat',      feld: '.write', wert: K.FB_V9_DEADLINE_MS,       mal: 3, quelle: 'FB_V9_DEADLINE_MS' },
  { bedeutung: 'Enthuellungsfenster',                           pfad: '/rooms/$code/g/$gen/r/$turn/$seat',      feld: '.write', wert: K.FB_V9_DEADLINE_MS,       mal: 2, quelle: 'FB_V9_DEADLINE_MS' },
  { bedeutung: 'Hoechstalter eines gelisteten Raums',           pfad: '/publicRooms/$code',                     feld: '.write', wert: K.ROOM_MAX_AGE_MS,         mal: 2, quelle: 'ROOM_MAX_AGE_MS' },
  { bedeutung: 'Hoechstalter eines Praesenzstempels',           pfad: '/rooms/$code/p/$i',                      feld: '.validate', wert: K.ROOM_MAX_AGE_MS,      mal: 1, quelle: 'ROOM_MAX_AGE_MS' },
  { bedeutung: 'Hoechste Generationsnummer',                    pfad: '/rooms/$code/gen',                       feld: '.validate', wert: K.GEN_MAX,              mal: 1, quelle: 'GEN_MAX' },
  { bedeutung: 'Hoechste Rundennummer (q)',                     pfad: '/rooms/$code/g/$gen/q/$turn/$seat/n',    feld: '.validate', wert: 9999,                   mal: 1, quelle: 'Rundenschranke' },
  { bedeutung: 'Hoechste Rundennummer (x)',                     pfad: '/rooms/$code/g/$gen/x/$seat/n',          feld: '.validate', wert: 9999,                   mal: 1, quelle: 'Rundenschranke' },
  { bedeutung: 'Hoechste Rundennummer (d)',                     pfad: '/rooms/$code/g/$gen/d/$turn/n',          feld: '.validate', wert: 9999,                   mal: 1, quelle: 'Rundenschranke' },
];

abschnitt('Die Rules - jede Zahl an ihrem Platz');
{
  console.log('   Bedeutung                                  Wert      mal  Quelle');
  for (const e of ERWARTET) {
    const n = zaehle(e.wert, e.pfad, e.feld);
    console.log('   ' + e.bedeutung.padEnd(42) + String(e.wert).padStart(8) + '  ' +
                String(n).padStart(3) + '  ' + e.quelle);
    t(e.bedeutung + ' steht ' + e.mal + '-mal in ' + e.pfad, n === e.mal, n);
  }
  // Die Gegenprobe: KEINE Zahl in den Rules, die oben nicht steht. Damit faellt auch
  // eine neu eingefuehrte Frist auf, an die hier niemand gedacht hat.
  const erlaubt = (z) => ERWARTET.some(e => e.wert === z.wert && e.pfad === z.pfad && e.feld === z.feld);
  const fremd = GEFUNDEN.filter(z => !erlaubt(z));
  t('es gibt keine unbekannte Zahl in den Rules', fremd.length === 0,
    fremd.map(z => z.wert + '@' + z.pfad + z.feld).join(' | '));
}

abschnitt('Die abgeleiteten Fristen');
{
  console.log('   Rueckkehrfrist (beide Spiele)      ' + String(K.SEAT_STALE_MS).padStart(7) + ' ms');
  console.log('   Lobby-Wirtsfrist (v8/v10)         ' + String(LOBBY_HOST_GRACE_MS).padStart(7) + ' ms   = Rueckkehrfrist + 5000');
  console.log('   Wirtszuschlag (v11)               ' + String(K.HOST_EXTRA_GRACE_MS).padStart(7) + ' ms');
  console.log('   Wirtsfrist v11 (Nachfolge)        ' + String(FB_V11_HOST_FRIST_MS).padStart(7) + ' ms   = Rueckkehrfrist + Wirtszuschlag');
  console.log('   Entscheidungsfenster v10/v11      ' + String(K.FB_V10_DEADLINE_MS).padStart(7) + ' ms');
  console.log('   Entscheidungsfenster v9           ' + String(K.FB_V9_DEADLINE_MS).padStart(7) + ' ms');
  console.log('   Bereitschaftsfrist                ' + String(K.FB_V9_READY_DEADLINE_MS).padStart(7) + ' ms');
  t('die Wirtsfrist ueberdauert die Rueckkehrfrist', FB_V11_HOST_FRIST_MS > K.SEAT_STALE_MS);
  // Sie darf sie aber nicht verdoppeln: so lange soll niemand vor einer Lobby sitzen,
  // in der er nichts starten darf.
  t('… ohne sie zu verdoppeln', FB_V11_HOST_FRIST_MS < 2 * K.SEAT_STALE_MS,
    FB_V11_HOST_FRIST_MS);
  // Die Zugfrist ist eine GANZ andere Groesse als die Rueckkehrfrist - sie darf sich
  // durch eine Aenderung an jener nie mitbewegen.
  t('das Entscheidungsfenster haengt NICHT an der Rueckkehrfrist',
    K.FB_V10_DEADLINE_MS === 8000 && K.FB_V9_DEADLINE_MS === 6000,
    K.FB_V10_DEADLINE_MS + '/' + K.FB_V9_DEADLINE_MS);
}

abschnitt('Getrennt ist nicht stumm - die Ausnahme steht nur in v11');
{
  const c = RULES.rules.rooms.$code.g.$gen.c.$turn.$seat['.write'];
  const d = RULES.rules.rooms.$code.g.$gen.d.$turn['.write'];
  t('der fruehe Slotschluss gilt nur fuer die Fassung 11',
    /'skip' && \(root\.child\('rooms'\)\.child\(\$code\)\.child\('v'\)\.val\(\) === 11 \|\|/.test(c));
  t('er verlangt weiterhin einen getrennten Sitz',
    /child\('p'\)\.child\(\$seat\)\.child\('on'\)\.val\(\) === false/.test(c));
  t('er verlangt weiterhin einen nicht ausgetragenen Sitz',
    /child\('e'\)\.child\(\$seat\)\.val\(\) !== true/.test(c));
  t('er bleibt write-once', /!data\.exists\(\)/.test(c));
  t('die Fassungen davor behalten ihre Frist im Ausdruck',
    c.indexOf("=== 10) ? 8000 : 6000") > 0);
  const fuenf = ['0', '1', '2', '3', '4'].every(i =>
    d.indexOf("=== 11 && root.child('rooms').child($code).child('p').child('" + i + "').child('on').val() === false") > 0);
  t('die Rundenoeffnung kennt den Getrennten fuer jeden Sitz', fuenf);
  const stellen = (d.match(/child\('on'\)\.val\(\) === false/g) || []).length;
  t('und zwar genau zehnmal: fuenf Sitze in zwei Zweigen', stellen === 10, stellen);
}

console.log('\nFristen-Inventar: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
