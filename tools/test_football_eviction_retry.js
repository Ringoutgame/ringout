// POST-RELEASE HARDENING 01 — der endgueltige Passiv-Marker wird begrenzt nachgereicht.
//
// Nach Ablauf der Rueckkehrfrist traegt ein verbundener Mitspieler den getrennten Sitz
// mit g/<gen>/e/<sitz> endgueltig passiv ein. Bis zu diesem Pass war das EIN Versuch:
// lag die angeglichene Serveruhr des Clients eine Winzigkeit VOR der des Servers, wies
// der Server ihn ab - und ein zweiter kam erst mit einem fremden Praesenzereignis.
//
// Geprueft wird der ECHTE Quelltext aus index.html: Fristlage, Schreibversuch,
// Nachreich-Lauf und Abbruchwege. Nachgebaut sind nur die Umgebung, ein virtueller
// Zeitgeber und eine Transaktion, die genau das prueft, was die Rules pruefen: der
// Sitz ist getrennt, und laut SERVERZEIT seit mindestens SEAT_STALE_MS. Die Serveruhr
// des Clients kann gegen die des Servers verschoben werden - genau darin liegt der
// Grenzfall.
//
//   node tools/test_football_eviction_retry.js
const { loadIndexHtml, grab, grabFunction } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) pass++;
  else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + JSON.stringify(zusatz) : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));

const KONST = [
  grab(HTML, /const SEAT_STALE_MS=[^\n]*/, 'SEAT_STALE_MS'),
  grab(HTML, /const SENTINEL_RETRY_BASE_MS=[^\n]*/, 'SENTINEL_RETRY_*'),
].join('\n');
const QUELLE = [
  grabFunction(HTML, 'seatActive'),
  grabFunction(HTML, 'fbEvicted'),
  grabFunction(HTML, 'fbSeatGrace'),
  grabFunction(HTML, 'fbGraceExpired'),
  grabFunction(HTML, 'fbGraceWait'),
  grabFunction(HTML, 'fbWriteEviction'),
  grabFunction(HTML, 'clearMatchGrace'),
  grabFunction(HTML, 'clearAllMatchGrace'),
  grabFunction(HTML, 'seatFinallyGone'),
  grab(HTML, /const FB_EVICT_VERSUCHE=[\s\S]*?\nfunction fbEvictSchritt\(s\)\{[\s\S]*?\n\}/, 'Nachreich-Lauf'),
].join('\n');

// Ein virtueller Zeitgeber: Zeit vergeht nur, wenn der Test es sagt, und faellige
// Weckrufe laufen in ihrer Reihenfolge - mit ausgeloesten Versprechen dazwischen.
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function uhrwerk() {
  let jetzt = 0, id = 1;
  const q = new Map();
  return {
    jetzt: () => jetzt,
    offen: () => q.size,
    setTimeout: (fn, ms) => { const k = id++; q.set(k, { f: jetzt + Math.max(0, ms || 0), fn }); return k; },
    clearTimeout: (k) => { q.delete(k); },
    async vor(ms) {
      const ziel = jetzt + ms;
      for (;;) {
        // ERST die laufenden Versprechen abarbeiten, DANN die Zeit weiterstellen: eine
        // echte Transaktion wird im Augenblick ihres Aufrufs bewertet, nicht erst dann,
        // wenn der Pruefstand die Uhr schon vorgestellt hat.
        await flush();
        let naechst = null;
        for (const [k, e] of q) if (e.f <= ziel && (!naechst || e.f < naechst[1].f)) naechst = [k, e];
        if (!naechst) break;
        q.delete(naechst[0]); jetzt = naechst[1].f; naechst[1].fn(); await flush();
      }
      jetzt = ziel; await flush();
    },
  };
}

const BASIS = 1760000000000;
function bau(opt) {
  opt = opt || {};
  const U = uhrwerk();
  // skew: um so viel steht die Serveruhr des CLIENTS vor der des SERVERS.
  const W = { skew: opt.skew || 0, verweigern: !!opt.verweigern, versuche: 0, commits: 0,
              warn: [], sentinel: [], oppLeft: false };
  const M = new Function('U', 'W', 'BASIS', `
    const setTimeout = U.setTimeout, clearTimeout = U.clearTimeout;
    const console = { warn: (m) => W.warn.push(String(m)), error() {}, log() {} };
    ${KONST}
    let online = true, gameStarted = true, mode = 'football', myPlayer = 0;
    let onlineSessionId = 1, roomCode = 'HARD', gen = 1, v11 = ${opt.v11 === false ? 'false' : 'true'};
    let serverClockReady = ${opt.uhr === false ? 'false' : 'true'}, genStartedAt = 0;
    // Sitz 1 ist zum Zeitpunkt 0 gegangen; Sitz 0 ist dieser Client, verbunden.
    let roomP = { 0: { s: 'T0', on: true, t: BASIS }, 1: { s: 'T1', on: false, t: BASIS } };
    let roomEv = {}, fbExitBusy = {}, seatLeft = [], matchGraceTimer = {}, matchGraceGen = {};
    function serverNow() { return BASIS + U.jetzt() + W.skew; }
    function fbOnlineRoom() { return mode === 'football'; }
    function fbV11Raum() { return v11; }
    function isOnlineTerminated() { return false; }
    function fbElimPlayers() { return 5; }
    function toast() {}
    function nameForSeat(s) { return 'P' + s; }
    function writeLeaveSentinel(s) { W.sentinel.push(s); }
    function onOppLeft() { W.oppLeft = true; }
    // Die Transaktion prueft, was die Rules pruefen - gegen die SERVERZEIT.
    const window = { FB: { db: {}, ref: (db, pfad) => ({ pfad }),
      runTransaction(ref, fn) {
        W.versuche++;
        return new Promise((res, rej) => Promise.resolve().then(() => {
          const teile = ref.pfad.split('/');
          const sitz = +teile[5], g = +teile[3];
          if (g !== gen) { rej(new Error('PERMISSION_DENIED: eviction gen')); return; }
          if (roomEv[sitz] === true) { res({ committed: false, snapshot: { val: () => true } }); return; }
          const p = roomP[sitz], server = BASIS + U.jetzt();
          if (W.verweigern || !p || p.on !== false || (server - p.t) < SEAT_STALE_MS) {
            rej(new Error('PERMISSION_DENIED: eviction target not stale enough')); return; }
          roomEv[sitz] = fn(null); W.commits++;
          res({ committed: true, snapshot: { val: () => true } });
        }));
      } } };
    ${QUELLE}
    return {
      setz(o) { for (const k in o) eval(k + ' = o[k]'); },
      ev: () => Object.assign({}, roomEv),
      lauf: () => { const o = {}; for (const k in fbEvictLauf) { const l = fbEvictLauf[k];
        o[k] = { versuche: l.versuche, aufgegeben: l.aufgegeben, wartet: !!l.timer, gen: l.gen }; } return o; },
      seatFinallyGone: (s) => seatFinallyGone(s),
      sichern: (s) => fbEvictSichern(s),
      clearMatchGrace: (s) => clearMatchGrace(s),
      clearAll: () => clearAllMatchGrace(),
      praesenz: (s, on) => { roomP[s] = { s: 'T' + s, on: on, t: BASIS + U.jetzt() }; },
      leer: (s) => { seatLeft[s] = false; },
    };
  `)(U, W, BASIS);
  return { U, W, M };
}

console.log('=== HARDENING 01: der endgueltige Passiv-Marker ===');

(async () => {

abschnitt('Die Obergrenze steht im Quelltext');
{
  t('hoechstens drei Schreibversuche je Sitz und Generation', /const FB_EVICT_VERSUCHE=3;/.test(HTML));
  t('kein neuer Zeitwert: nachgereicht wird im bestehenden Wiederholungsabstand',
    /Math\.max\(fbGraceWait\(s\),SENTINEL_RETRY_MAX_MS\)/.test(HTML));
  t('der Abbruch haengt am Rueckkehrweckruf desselben Sitzes',
    /delete matchGraceGen\[s\]; fbEvictStop\(s\); \}/.test(HTML) && /clearMatchGrace\(s\); fbEvictStopAlle\(\); \}/.test(HTML));
}

// ── B + C + D: der Grenzfall aus dem Release ─────────────────────────────────
abschnitt('B/C/D - erster Versuch knapp vor der Grenze, dann Erfolg');
{
  // Die Client-Uhr steht 1,5 s vor: bei 28,5 s Serverzeit glaubt der Client, 30 s seien um.
  const { U, W, M } = bau({ skew: 1500 });
  await U.vor(28500);
  M.seatFinallyGone(1);
  await flush();
  t('B - der erste Versuch geht hinaus', W.versuche === 1, W.versuche);
  t('B - … und wird vom Server abgewiesen (noch keine 30 s)', W.commits === 0 && M.ev()[1] !== true);
  t('B - der Lauf plant einen Nachversuch statt aufzugeben',
    M.lauf()[1] && M.lauf()[1].wartet === true && M.lauf()[1].aufgegeben === false, M.lauf());
  await U.vor(2000);
  t('C - OHNE jedes Praesenz- oder Oberflaechenereignis steht der Marker', M.ev()[1] === true, M.ev());
  t('B - genau zwei Schreibversuche', W.versuche === 2, W.versuche);
  t('D - genau ein Marker geschrieben', W.commits === 1, W.commits);
  t('D - danach ist kein Lauf mehr offen', Object.keys(M.lauf()).length === 0, M.lauf());
  await U.vor(120000);
  t('D - auch viel spaeter kein weiterer Versuch', W.versuche === 2 && W.commits === 1, W);
  t('D - kein Weckruf haengt nach', U.offen() === 0, U.offen());
  t('keine Warnung', W.warn.length === 0, W.warn);
}

// ── Nicht zu frueh ───────────────────────────────────────────────────────────
abschnitt('Vor Ablauf der Rueckkehrfrist wird NIE geschrieben');
{
  const { U, W, M } = bau({ skew: 0 });
  await U.vor(10000);
  M.sichern(1);                               // selbst ein zu frueher Einstieg ...
  await U.vor(19999);
  t('… schreibt bis 29,999 s nichts', W.versuche === 0, W.versuche);
  t('… und wartet stattdessen', M.lauf()[1] && M.lauf()[1].wartet === true, M.lauf());
  await U.vor(1);
  t('mit Ablauf der Frist genau ein Versuch - und er gelingt', W.versuche === 1 && M.ev()[1] === true, W);
}

// ── A + G: Rueckkehr vor der Frist ──────────────────────────────────────────
abschnitt('A/G - wer vor der Frist zurueckkommt, wird nicht passiv');
{
  const { U, W, M } = bau({ skew: 1500 });
  await U.vor(28500);
  M.seatFinallyGone(1);                       // abgewiesen, Nachversuch geplant
  await U.vor(1000);                          // 29,5 s: er ist zurueck
  M.praesenz(1, true);
  M.clearMatchGrace(1);                       // was der Praesenz-Listener bei Rueckkehr tut
  await U.vor(60000);
  t('A - kein Passiv-Marker', M.ev()[1] !== true, M.ev());
  t('A - nach dem Abbruch kein weiterer Versuch', W.versuche === 1, W.versuche);
  t('A - kein Lauf offen', Object.keys(M.lauf()).length === 0, M.lauf());
}
{
  // Derselbe Fall OHNE den Abbruch: der geplante Weckruf feuert trotzdem - und darf
  // nichts mehr anrichten.
  const { U, W, M } = bau({ skew: 1500 });
  await U.vor(28500);
  M.seatFinallyGone(1);
  await U.vor(1000);
  M.praesenz(1, true);                        // zurueck, aber niemand bricht den Lauf ab
  await U.vor(60000);
  t('G - ein veralteter Weckruf nimmt dem Zurueckgekehrten nichts', M.ev()[1] !== true && W.versuche === 1, W);
  t('G - er beendet den Lauf selbst', Object.keys(M.lauf()).length === 0, M.lauf());
}
{
  // Und die ZWEITE Abwesenheit danach: ein neuer Lauf, den der alte nicht stoert.
  const { U, W, M } = bau({ skew: 1500 });
  await U.vor(28500);
  M.seatFinallyGone(1);                       // Lauf 1, abgewiesen, Nachversuch bei 30,5 s
  await U.vor(500);                           // 29,0 s: zurueck ...
  M.praesenz(1, true); M.clearMatchGrace(1); M.leer(1);
  await U.vor(500);                           // 29,5 s: ... und sofort wieder weg (neuer Stempel)
  M.praesenz(1, false);
  await U.vor(28500);                         // 58,0 s: der Client haelt die neue Frist fuer abgelaufen
  M.seatFinallyGone(1);                       // Lauf 2: abgewiesen, der Server sieht erst 28,5 s
  await U.vor(2000);
  t('G - die neue Abwesenheit bekommt ihre eigene, volle Frist', M.ev()[1] === true, { ev: M.ev(), W });
  t('G - insgesamt genau ein Marker', W.commits === 1, W.commits);
  t('G - drei Versuche: einer im alten Lauf, zwei im neuen', W.versuche === 3, W.versuche);
}

// ── E + F: Generation und Lobby ─────────────────────────────────────────────
abschnitt('E/F - ein Generationswechsel oder die Lobby beendet den Lauf');
{
  const { U, W, M } = bau({ skew: 1500 });
  await U.vor(28500);
  M.seatFinallyGone(1);
  M.setz({ gen: 2 });                         // die Generation wechselt, ohne Abbruchaufruf
  await U.vor(60000);
  t('E - fuer die alte Generation wird nicht weiter geschrieben', W.versuche === 1 && M.ev()[1] !== true, W);
  t('E - der Lauf ist beendet', Object.keys(M.lauf()).length === 0, M.lauf());
}
{
  const { U, W, M } = bau({ skew: 1500 });
  await U.vor(28500);
  M.seatFinallyGone(1);
  M.setz({ gameStarted: false });             // der Raum faellt in seine Lobby ...
  M.clearAll();                               // ... und raeumt dabei alles ab (fbV11ZurueckInLobby)
  await U.vor(60000);
  t('F - in der Lobby kein weiterer Versuch', W.versuche === 1 && M.ev()[1] !== true, W);
  t('F - der Lauf ist beendet', Object.keys(M.lauf()).length === 0, M.lauf());
}
{
  const { U, W, M } = bau({ skew: 1500 });
  await U.vor(28500);
  M.seatFinallyGone(1);
  M.setz({ gameStarted: false });             // Lobby OHNE Abbruchaufruf
  await U.vor(60000);
  t('F - auch ohne Abbruchaufruf: kein Versuch ausserhalb des Matches', W.versuche === 1, W.versuche);
}

// ── Obergrenze ──────────────────────────────────────────────────────────────
abschnitt('Hoechstens drei Versuche - dann aufgeben und melden');
{
  const { U, W, M } = bau({ skew: 0, verweigern: true });
  await U.vor(30000);
  M.seatFinallyGone(1);
  await U.vor(600000);
  t('genau drei Schreibversuche', W.versuche === 3, W.versuche);
  t('kein Marker', M.ev()[1] !== true);
  t('der Lauf steht als aufgegeben da', M.lauf()[1] && M.lauf()[1].aufgegeben === true, M.lauf());
  t('… ohne weiteren Weckruf', U.offen() === 0, U.offen());
  t('der Fehlschlag wird genau einmal gemeldet', W.warn.length === 1 && /Passiv-Marker/.test(W.warn[0]), W.warn);
}

// ── Ohne Zeitbasis ──────────────────────────────────────────────────────────
abschnitt('Ohne angeglichene Serveruhr wird nichts geraten');
{
  const { U, W, M } = bau({ uhr: false });
  await U.vor(40000);
  M.sichern(1);
  await U.vor(120000);
  t('kein Schreibversuch ohne Zeitbasis', W.versuche === 0, W.versuche);
  t('und kein endlos wartender Lauf', Object.keys(M.lauf()).length === 0 && U.offen() === 0, M.lauf());
}

// ── I + J: Bestandsvertraege ────────────────────────────────────────────────
abschnitt('I/J - v9/v10 und Ring Out bleiben, wie sie sind');
{
  const { U, W, M } = bau({ skew: 1500, v11: false });
  await U.vor(28500);
  M.seatFinallyGone(1);
  await U.vor(120000);
  t('I - v9/v10: weiterhin genau EIN Versuch', W.versuche === 1, W.versuche);
  t('I - v9/v10: kein Nachreich-Lauf', Object.keys(M.lauf()).length === 0, M.lauf());
}
{
  const { U, W, M } = bau({ skew: 0 });
  M.setz({ mode: 'ffa' });
  await U.vor(30000);
  M.seatFinallyGone(1);
  await U.vor(60000);
  t('J - Ring Out: der Leave-Sentinel wie bisher', W.sentinel.length === 1 && W.sentinel[0] === 1, W.sentinel);
  t('J - Ring Out: kein Passiv-Marker, kein Lauf', W.versuche === 0 && Object.keys(M.lauf()).length === 0, W);
}

console.log('\nFootball-Passiv-Marker: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
