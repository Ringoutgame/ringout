// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Security-Regression der RTDB-Rules gegen den ECHTEN Emulator.
//
//   node tools/e2e/rules_security_regression.js      (bzw. npm run test:e2e:rules)
//
// Dauerhafte Absicherung der vier Angriffsfaelle, die die lokale Single-Path-
// Mock-Engine in tools/test_rules.js grundsaetzlich NICHT darstellen kann, weil
// sie atomare Multi-Location-Writes voraussetzen:
//
//   A  atomar { s, Move OHNE ts }              -> DENY  + vollstaendiger Rollback
//   B  atomar { s, Move MIT ts }               -> ALLOW + legitimer Endzustand
//   C  Reveal mit Dezimal-seg (7.5)            -> DENY  + kein Reveal persistiert
//   D  atomar { bc/0, bc/1, br/0 }             -> DENY  + vollstaendiger Rollback
//
// A/B sichern den s/ts-Zeitvertrag: die Move-.validate entscheidet ueber die
// RESULTIERENDE Turn-Sicht (newData.parent().child('s')). Wuerde sie wieder auf
// die pre-write root-Sicht zurueckfallen, liesse A einen Move ohne ts in einen
// gestempelten Turn — Fall A schlaegt dann fehl.
// C sichert die Ganzzahligkeit von br.seg: br ist write-once, ein akzeptierter
// Dezimalwert wuerde den Turn dauerhaft blockieren (Client verlangt Integer).
// D sichert die Commit-Reveal-Ordnung: ein Reveal darf nicht von Commits
// profitieren, die erst im selben atomaren Write entstehen.
//
// Zu jedem DENY laeuft eine POSITIV-KONTROLLE mit sonst identischem Aufbau
// (B zu A, Integer-seg zu C, sequentielle bc/bc/br zu D). Ohne sie koennte ein
// DENY auch aus einem kaputten Setup stammen und faelschlich gruen wirken.
//
// Ein erwarteter DENY zaehlt AUSSCHLIESSLICH bei einer echten Rules-Ablehnung:
// der In-Page-Treiber meldet den rohen Fehlercode, die Bewertung passiert hier
// in Node ueber classifyDeny() und verlangt code === 'PERMISSION_DENIED'
// (gemessen am eingesetzten SDK-Pfad, s. DENY_CODE). Verbindungs-, Emulator-,
// SDK- oder Transportfehler sind damit KEIN bestandener Security-Fall.
//
// Fail-closed: jeder falsche ALLOW/DENY, jeder Nicht-Rules-Fehler in einem
// DENY-Fall, jeder fehlende Rollback, unerwarteter Reststate, Emulator-
// Startfehler, Timeout, Cleanup-Fehler, Produktionskontakt, eine unpassende
// Rules-Datei und jeder ungefangene Fehler beenden den Lauf mit Exit-Code 1.
// Der Timeout bricht den Lauf ueber den normalen catch/finally-Pfad ab, damit
// Cleanup (Browser, Emulator, Static-Server, Temp-Verzeichnis) IMMER laeuft.
//
// Rules-Quelle ist AUSSCHLIESSLICH die getrackte firebase.rules.json. Sie wird
// nur gelesen; H.prepareTempRules() legt eine byte-identische, SHA-256-
// verifizierte Kopie im Pro-Lauf-Temp-Verzeichnis an. Die Produktionsdatei wird
// nie geschrieben — der Lauf braucht deshalb auch keinen Restore-Mechanismus;
// die Unveraenderlichkeit wird zusaetzlich vorher/nachher per Hash belegt.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require('@playwright/test');
const H = require('./lib/harness');

// Globales Zeitlimit. Ueber RULES_SEC_TIMEOUT_MS nur fuer die Selbstpruefung des
// Timeout-Pfads verkuerzbar (der Lauf muss dann ueber catch/finally sauber
// abbrechen und trotzdem vollstaendig aufraeumen).
const RUN_TIMEOUT_MS = Number(process.env.RULES_SEC_TIMEOUT_MS) || 5 * 60 * 1000;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Fehlercode einer echten Rules-Ablehnung auf diesem SDK-Pfad. Nachgemessen am
// hier verwendeten Setup (Firebase JS SDK 12.x, RTDB-Emulator, set()/update()):
// der abgelehnte Write rejectet mit einem Error, der als EIGENEN Key
//   code = 'PERMISSION_DENIED'   (message: 'PERMISSION_DENIED: Permission denied')
// traegt. Verglichen wird ausschliesslich dieser Code (case-insensitiv, exakt —
// kein Substring auf der Fehlermeldung), damit ein Transport- oder SDK-Fehler
// niemals als erwarteter Security-DENY durchgeht.
const DENY_CODE = 'PERMISSION_DENIED';

// ── Bewertung eines Schreibversuchs (reine Funktionen, in Node unit-pruefbar) ──
// res = { ok:boolean, code?:string, err?:string } aus dem In-Page-Treiber.
function classifyDeny(res) {
  if (!res || res.ok !== false) return { ok: false, detail: 'unerwartet AKZEPTIERT (Regel greift nicht)' };
  const code = typeof res.code === 'string' ? res.code.toUpperCase() : null;
  if (code === DENY_CODE) return { ok: true, detail: null };
  return { ok: false, detail: 'abgelehnt, aber KEIN Rules-DENY — code=' + JSON.stringify(res.code) + ' err=' + JSON.stringify(res.err) };
}
function classifyAllow(res) {
  if (res && res.ok === true) return { ok: true, detail: null };
  return { ok: false, detail: 'unerwartet abgelehnt — code=' + JSON.stringify(res && res.code) + ' err=' + JSON.stringify(res && res.err) };
}

// Selbstpruefung der Klassifikation: echter/normalisierter PERMISSION_DENIED
// zaehlt, jeder andere Firebase-/Transportfehler nicht. Laeuft ohne Emulator und
// ohne die vier Security-Faelle zu mocken.
function selfCheckClassifier() {
  const cases = [
    ['echter Rules-DENY', { ok: false, code: 'PERMISSION_DENIED', err: 'PERMISSION_DENIED: Permission denied' }, true],
    ['normalisierter Rules-DENY (lowercase)', { ok: false, code: 'permission_denied' }, true],
    ['Netzwerkfehler', { ok: false, code: 'NETWORK_ERROR', err: 'network error' }, false],
    ['Emulator weg / unavailable', { ok: false, code: 'UNAVAILABLE', err: 'transport closed' }, false],
    ['SDK-Ausnahme ohne code', { ok: false, err: 'TypeError: x is not a function' }, false],
    ['Fehlertext enthaelt permission denied, aber kein code', { ok: false, err: 'Permission denied' }, false],
    ['Timeout ohne code', { ok: false, err: 'timeout of 5000ms exceeded' }, false],
    ['Write wurde akzeptiert', { ok: true }, false],
  ];
  const bad = [];
  for (const [name, res, expect] of cases) {
    if (classifyDeny(res).ok !== expect) bad.push(name);
  }
  return { ok: bad.length === 0, detail: bad.length ? 'falsch klassifiziert: ' + bad.join(', ') : null };
}

// ── In-Page-Treiber: fuehrt die Schreibversuche ueber window.FB (echtes
//    Firebase-SDK) gegen den Emulator aus und meldet ROHE Ergebnisse inkl.
//    Fehlercode. update() mit Kindpfaden ist ein echter atomarer
//    Multi-Location-Write — genau die Semantik, um die es hier geht.
const DRIVER = async () => {
  const FB = window.FB;
  const ref = (p) => FB.ref(FB.db, 'rooms/' + p);
  const TS = () => FB.serverTimestamp();
  const fail = (e) => ({ ok: false, code: (e && typeof e.code === 'string') ? e.code : null, err: String((e && e.message) || e) });
  const set = async (p, v) => { try { await FB.set(ref(p), v); return { ok: true }; } catch (e) { return fail(e); } };
  const upd = async (p, o) => { try { await FB.update(ref(p), o); return { ok: true }; } catch (e) { return fail(e); } };
  const read = async (p) => { const s = await FB.get(ref(p)); return s.exists() ? s.val() : null; };

  const checks = [];
  const deny = (name, res) => checks.push({ name, kind: 'deny', res });
  const allow = (name, res) => checks.push({ name, kind: 'allow', res });
  const state = (name, ok, detail) => checks.push({ name, kind: 'state', ok: !!ok, detail: ok ? null : (detail || null) });

  // ── Setup: laufendes 1v1-Match mit zwei Online-Seats ──────────────────────
  const CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = null;
  for (let i = 0; i < 12 && !code; i++) {
    const cand = Array.from({ length: 4 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');
    if ((await read(cand)) == null) code = cand;
  }
  if (!code) return { fatal: 'kein freier Raumcode', checks };
  const P = (s, on) => ({ s, on, t: TS() });
  await set(code, { v: 3, config: { winTarget: 3, fmt: 'single', visibility: 'private' }, gen: 0, state: 'lobby',
    p: { 0: P('HOSTTAB0', false) }, players: { 0: { id: 'HOST0000', name: 'H', tab: 'HOSTTAB0' } }, created: TS() });
  await upd(code, { 'p/0/on': true, 'p/0/t': TS() });
  await upd(code, { 'p/1': P('GTAB0001', false), 'players/1': { id: 'GUEST001', name: 'G', tab: 'GTAB0001' } });
  await upd(code, { 'p/1/on': true, 'p/1/t': TS(), state: 'playing' });
  const room = await read(code);
  const setupOk = !!room && room.state === 'playing' && room.p && room.p[0] && room.p[0].on === true && room.p[1] && room.p[1].on === true;
  state('Setup: Match laeuft, beide Seats online', setupOk,
    'Setup fehlgeschlagen — jedes folgende DENY waere ohne Aussagekraft: ' + JSON.stringify(room && room.state));
  if (!setupOk) return { fatal: 'Setup fehlgeschlagen', checks };

  const MOVE = { idx: 0, dx: 100, dy: -50, sp: 0.5 };
  const HEX64 = 'a'.repeat(64);
  let turnNo = 0;
  const nextTurn = () => { const n = turnNo++; return { n, p: code + '/g/0/t/' + n }; };
  const BC = (seat, n) => ({ v: 1, seat, turn: n, hash: HEX64 });
  const BR = (seat, n, seg) => { const r = { v: 1, seat, turn: n, nonce: HEX64 }; if (seg !== undefined) r.seg = seg; return r; };

  // ══ A — atomar { s, Move OHNE ts } muss abgelehnt werden ══════════════════
  {
    const t = nextTurn();
    deny('A: atomar s + Move OHNE ts abgelehnt', await upd(t.p, { s: TS(), 0: MOVE }));
    const after = await read(t.p);
    state('A: vollstaendiger Rollback (weder s noch Move persistiert)', after === null,
      'Reststate im Turn: ' + JSON.stringify(after));
  }

  // ══ B — atomar { s, Move MIT ts } bleibt gueltig (Positivkontrolle zu A) ══
  {
    const t = nextTurn();
    allow('B: atomar s + Move MIT ts akzeptiert', await upd(t.p, { s: TS(), 0: Object.assign({}, MOVE, { ts: TS() }) }));
    const after = await read(t.p);
    const ok = !!after && typeof after.s === 'number' && !!after['0']
      && typeof after['0'].ts === 'number' && after['0'].idx === MOVE.idx && after['0'].dx === MOVE.dx;
    state('B: legitimer Endzustand (s, Move und ts als Serverzahlen vorhanden)', ok, JSON.stringify(after));
  }

  // ══ C — Reveal mit Dezimal-seg muss abgelehnt werden ══════════════════════
  {
    const t = nextTurn();
    await set(t.p + '/bc/0', BC(0, t.n));                 // Commits sequentiell, wie im Produktclient
    await set(t.p + '/bc/1', BC(1, t.n));
    const commitsOk = (await read(t.p + '/bc/0')) !== null && (await read(t.p + '/bc/1')) !== null;
    state('C: Setup — beide Commits liegen vor', commitsOk, 'Commits fehlen, Reveal-DENY waere ohne Aussagekraft');
    deny('C: Reveal mit seg 7.5 abgelehnt', await set(t.p + '/br/0', BR(0, t.n, 7.5)));
    const afterDeny = await read(t.p + '/br/0');
    state('C: kein ungueltiger Reveal persistiert (write-once bleibt frei)', afterDeny === null,
      'Reststate im Reveal: ' + JSON.stringify(afterDeny));
    // Positivkontrolle: derselbe Reveal mit Integer-seg ist gueltig.
    allow('C: Reveal mit Integer-seg 7 akzeptiert (Positivkontrolle)', await set(t.p + '/br/0', BR(0, t.n, 7)));
    const afterAllow = await read(t.p + '/br/0');
    state('C: gueltiger Reveal persistiert mit seg 7', !!afterAllow && afterAllow.seg === 7, JSON.stringify(afterAllow));
  }

  // ══ D — bc/0 + bc/1 + br/0 in EINEM atomaren Update muss abgelehnt werden ══
  {
    const t = nextTurn();
    deny('D: atomar bc/0 + bc/1 + br/0 abgelehnt',
      await upd(t.p, { 'bc/0': BC(0, t.n), 'bc/1': BC(1, t.n), 'br/0': BR(0, t.n, 3) }));
    const after = await read(t.p);
    state('D: vollstaendiger Rollback (auch die Commits fehlen)', after === null,
      'Reststate im Turn: ' + JSON.stringify(after));
    // Positivkontrolle: dieselben drei Knoten sequentiell geschrieben sind gueltig —
    // abgelehnt wird ausschliesslich der Reveal aus demselben Write.
    allow('D: bc/0 sequentiell akzeptiert (Positivkontrolle)', await set(t.p + '/bc/0', BC(0, t.n)));
    allow('D: bc/1 sequentiell akzeptiert (Positivkontrolle)', await set(t.p + '/bc/1', BC(1, t.n)));
    allow('D: br/0 nach beiden Commits akzeptiert (Positivkontrolle)', await set(t.p + '/br/0', BR(0, t.n, 3)));
  }


  // ══ E — Leave-Sentinel im Online-FFA (Bug 3A) ═════════════════════════════
  // Der Move-Slot eines nicht mehr aktiven Seats darf von einem verbliebenen
  // Client gefuellt werden — aber AUSSCHLIESSLICH mit der kanonischen
  // Sentinel-Signatur aus index.html: Nullvektor auf einer FREMDEN, im Match
  // existierenden Kugel. Im klassischen FFA hat jeder Seat genau eine Kugel und
  // es gilt Kugelindex === Seatindex, "fremd" heisst dort also idx !== seat.
  {
    const FF = { idx: 1, dx: 0, dy: 0, sp: 0 };          // gueltiger Sentinel fuer Seat 2
    const NORMAL = { idx: 2, dx: 120, dy: -40, sp: 0.3 };// normaler Zug des Seats 2
    let fcode = null;
    for (let i = 0; i < 12 && !fcode; i++) {
      const cand = Array.from({ length: 4 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');
      if ((await read(cand)) == null) fcode = cand;
    }
    if (!fcode) return { fatal: 'kein freier FFA-Raumcode', checks };
    await set(fcode, { v: 3, config: { winTarget: 3, fmt: 'ffa', visibility: 'private' }, gen: 0, state: 'lobby',
      p: { 0: P('FHOSTTAB', false) }, players: { 0: { id: 'FHOST000', name: 'F0', tab: 'FHOSTTAB' } }, created: TS() });
    await upd(fcode, { 'p/0/on': true, 'p/0/t': TS() });
    for (const [seat, tab, id] of [[1, 'FTAB0001', 'FGUEST01'], [2, 'FTAB0002', 'FGUEST02']]) {
      await upd(fcode, { ['p/' + seat]: P(tab, false), ['players/' + seat]: { id, name: 'F' + seat, tab } });
      await upd(fcode, { ['p/' + seat + '/on']: true, ['p/' + seat + '/t']: TS() });
    }
    await set(fcode + '/state', 'playing');
    await set(fcode + '/seats', 3);
    const froom = await read(fcode);
    const fOk = !!froom && froom.state === 'playing' && froom.seats === 3
      && froom.p && [0, 1, 2].every((s) => froom.p[s] && froom.p[s].on === true);
    state('E: Setup — FFA-Match mit 3 aktiven Seats laeuft', fOk,
      'Setup fehlgeschlagen: ' + JSON.stringify(froom && { st: froom.state, seats: froom.seats }));
    if (!fOk) return { fatal: 'FFA-Setup fehlgeschlagen', checks };

    let fturn = 0;
    const ft = () => { const n = fturn++; return { n, p: fcode + '/g/0/t/' + n }; };

    // ── E1/E2: aktiver Seat — Positivkontrolle. Der Bestandszweig
    //    (p/<seat>.on === true) bleibt unveraendert erlaubt; diese Aenderung
    //    schraenkt den normalen Zugpfad also nicht ein. Wer den Slot eines
    //    AKTIVEN Seats fuellen darf, regelt weiterhin ausschliesslich dieser
    //    Bestandszweig — er ist nicht Gegenstand von Bug 3A.
    {
      const t = ft();
      allow('E1: aktiver Seat — normaler Zug weiterhin schreibbar (Bestandszweig unveraendert)',
        await set(t.p + '/2', NORMAL));
      const t2 = ft();
      allow('E2: aktiver Seat — Schreibpfad unveraendert, auch fuer einen Nullvektor-Zug',
        await set(t2.p + '/2', FF));
    }

    // ── Seat 2 verlaesst bewusst: p UND players werden atomar entfernt ───────
    await upd(fcode, { 'p/2': null, 'players/2': null });
    const gone = await read(fcode + '/p/2');
    state('E: Seat 2 hat bewusst verlassen (p und players entfernt)', gone === null, JSON.stringify(gone));

    // ── E3: offline Seat, NORMALER Move bleibt verboten ─────────────────────
    {
      const t = ft();
      deny('E3: verlassener Seat — normaler Fremd-Move weiterhin abgelehnt', await set(t.p + '/2', NORMAL));
      state('E3: nichts persistiert', (await read(t.p + '/2')) === null);
    }
    // ── E4: unvollstaendiger Sentinel ───────────────────────────────────────
    {
      const t = ft();
      deny('E4: verlassener Seat — Sentinel ohne sp abgelehnt', await set(t.p + '/2', { idx: 1, dx: 0, dy: 0 }));
    }
    // ── E5: Sentinel mit Zusatzfeld ─────────────────────────────────────────
    {
      const t = ft();
      deny('E5: verlassener Seat — Sentinel mit Zusatzfeld abgelehnt',
        await set(t.p + '/2', { idx: 1, dx: 0, dy: 0, sp: 0, extra: 1 }));
    }
    // ── E6: falsche Signatur (Bewegung bzw. eigene Kugel) ───────────────────
    {
      const t = ft();
      deny('E6a: verlassener Seat — Nullvektor auf EIGENER Kugel abgelehnt',
        await set(t.p + '/2', { idx: 2, dx: 0, dy: 0, sp: 0 }));
      const t2 = ft();
      deny('E6b: verlassener Seat — fremde Kugel MIT Bewegung abgelehnt',
        await set(t2.p + '/2', { idx: 1, dx: 5, dy: 0, sp: 0 }));
      const t3 = ft();
      deny('E6c: verlassener Seat — fremde Kugel mit Drall abgelehnt',
        await set(t3.p + '/2', { idx: 1, dx: 0, dy: 0, sp: 0.4 }));
    }
    // ── E12: idx ausserhalb der Seatzahl dieses Matches ─────────────────────
    {
      const t = ft();
      deny('E12: verlassener Seat — Sentinel auf nicht existierender Kugel (idx 4 bei 3 Seats) abgelehnt',
        await set(t.p + '/2', { idx: 4, dx: 0, dy: 0, sp: 0 }));
    }
    // ── E8: falsche Generation ──────────────────────────────────────────────
    {
      deny('E8: verlassener Seat — Sentinel in falscher Generation abgelehnt',
        await set(fcode + '/g/1/t/0/2', FF));
    }
    // ── E9: gueltiger Sentinel nach bewusstem Leave -> ERLAUBT ──────────────
    let e9turn = null;
    {
      const t = ft(); e9turn = t;
      allow('E9: bewusstes Leave — gueltiger Sentinel akzeptiert', await set(t.p + '/2', FF));
      const after = await read(t.p + '/2');
      state('E9: Sentinel persistiert unveraendert', !!after && after.idx === 1 && after.dx === 0 && after.dy === 0 && after.sp === 0,
        JSON.stringify(after));
    }
    // ── E7: write-once — belegter Slot bleibt unantastbar ───────────────────
    {
      deny('E7: belegter Slot — zweiter Sentinel abgelehnt', await set(e9turn.p + '/2', { idx: 0, dx: 0, dy: 0, sp: 0 }));
      const after = await read(e9turn.p + '/2');
      state('E7: erster Sentinel bleibt unveraendert', !!after && after.idx === 1, JSON.stringify(after));
    }

    // ── Disconnect-Fall: Seat 1 geht auf on:false (players bleibt) ──────────
    await upd(fcode, { 'p/1/on': false, 'p/1/t': TS() });
    const flapT = Date.now();
    const flap = await read(fcode + '/p/1');
    state('E: Seat 1 ist per Disconnect inaktiv (players bleibt bestehen)',
      !!flap && flap.on === false && (await read(fcode + '/players/1')) !== null, JSON.stringify(flap));

    // ── E10: innerhalb der 15-s-Karenz noch KEIN Sentinel ──────────────────
    {
      const t = ft();
      deny('E10: Disconnect innerhalb der Karenz — Sentinel abgelehnt', await set(t.p + '/1', { idx: 0, dx: 0, dy: 0, sp: 0 }));
      state('E10: nichts persistiert', (await read(t.p + '/1')) === null);
    }
    // ── E11: nach Ablauf der Karenz ist derselbe Sentinel gueltig ───────────
    {
      // Die Rules-Karenz liegt bewusst 1 s VOR SEAT_STALE_MS (15 s): der Client
      // feuert damit garantiert erst, wenn das Serverfenster offen ist — sonst
      // gaebe es bei jedem Disconnect eine abgelehnte erste Transaktion.
      const waitMs = 14600 - (Date.now() - flapT);
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      const t = ft();
      allow('E11: Disconnect nach der Rules-Karenz (14 s) — Sentinel akzeptiert', await set(t.p + '/1', { idx: 0, dx: 0, dy: 0, sp: 0 }));
      const after = await read(t.p + '/1');
      state('E11: Sentinel persistiert', !!after && after.idx === 0, JSON.stringify(after));
    }
    // ── E14: gestempelter Turn — die Zugform gilt auch fuer den Sentinel ────
    //    Existiert t/<turn>/s, verlangt .validate zwingend ein ts. Der Sentinel
    //    ist davon nicht ausgenommen: ohne ts abgelehnt, mit ts akzeptiert.
    {
      await upd(fcode, { 'p/2': null, 'players/2': null });   // Seat 2 bleibt verlassen
      const t = ft();
      allow('E14: Phasenstempel fuer den Turn gesetzt', await set(t.p + '/s', TS()));
      deny('E14a: gestempelter Turn — Sentinel OHNE ts abgelehnt', await set(t.p + '/2', FF));
      state('E14a: nichts persistiert', (await read(t.p + '/2')) === null);
      allow('E14b: gestempelter Turn — Sentinel MIT ts akzeptiert',
        await set(t.p + '/2', Object.assign({}, FF, { ts: TS() })));
      const after = await read(t.p + '/2');
      state('E14b: Sentinel mit Stempel persistiert', !!after && after.idx === 1 && typeof after.ts === 'number',
        JSON.stringify(after));
    }
    // ── E13: Rueckkehr setzt die Karenz zurueck — der Sentinel-Zweig greift
    //    danach erst wieder nach erneuten 15 s. Geprueft wird die Bedingung, die
    //    dieser Aenderung gehoert: frisches p/<seat>.t und on === true.
    {
      await upd(fcode, { 'p/1/on': true, 'p/1/t': TS() });
      const back = await read(fcode + '/p/1');
      state('E13: zurueckgekehrter Seat ist wieder aktiv, Karenz neu gestartet',
        !!back && back.on === true && typeof back.t === 'number', JSON.stringify(back));
      await upd(fcode, { 'p/1/on': false, 'p/1/t': TS() });
      const t = ft();
      deny('E13: nach der Rueckkehr laeuft die 15-s-Karenz neu — Sentinel wieder abgelehnt',
        await set(t.p + '/1', { idx: 0, dx: 0, dy: 0, sp: 0 }));
    }
  }

  return { checks, code };
};

// ── Rules-Vorbedingungen: schlaegt sofort und deutlich fehl, wenn dieser Test
//    gegen eine Rules-Datei laeuft, die den abgesicherten Vertrag nicht traegt.
function assertRulesContract(rulesText) {
  const turn = JSON.parse(rulesText).rules.rooms.$code.g.$gen.t.$turn;
  const problems = [];
  if (!turn.bc || !turn.bc.$seat) problems.push('bc/$seat fehlt');
  if (!turn.br || !turn.br.$seat) problems.push('br/$seat fehlt');
  const seg = turn.br && turn.br.$seat && turn.br.$seat.seg && turn.br.$seat.seg['.validate'];
  if (!seg || seg.indexOf('% 1 === 0') < 0) problems.push('br.seg ohne Ganzzahlpruefung');
  const pl = turn.$pl && turn.$pl['.validate'];
  if (!pl || pl.indexOf("newData.parent().child('s').exists()") < 0) problems.push('Move-.validate ohne resultierende Turn-Sicht');
  // Bug 3A: der Leave-Sentinel-Zweig und seine Disconnect-Karenz muessen im
  // Move-Slot-Vertrag stehen — sonst haengt Online-FFA beim Verlassen wieder.
  const plw = turn.$pl && turn.$pl['.write'];
  if (!plw || plw.indexOf("newData.child('idx').val() + '' !== $pl") < 0) problems.push('Leave-Sentinel-Zweig fehlt');
  if (!plw || plw.indexOf('>= 14000') < 0) problems.push('Leave-Sentinel ohne Disconnect-Karenz');
  if (problems.length) throw new Error('Rules-Vertrag unvollstaendig: ' + problems.join(', '));
}

// Nur als Skript ausfuehren; beim require() stehen die reinen Helfer bereit
// (macht sie ohne Emulatorlauf pruefbar).
module.exports = { assertRulesContract, classifyDeny, classifyAllow, selfCheckClassifier, DENY_CODE };
if (require.main !== module) return;

(async () => {
  const state = { transformedHtml: null, prodHits: [], wsProdHits: [], otherBlocked: [], wsOtherBlocked: [], leaveWindows: [] };
  let staticServer = null, emu = null, browser = null, runDir = null;
  const failures = [];
  let checks = [];
  let rulesHashBefore = null;
  let timer = null;

  // Der eigentliche Lauf als eigene Funktion: der Timeout rejectet parallel dazu,
  // der Kontrollfluss landet dadurch im catch und anschliessend IMMER im finally.
  const mainRun = async () => {
    // (1) Rules-Quelle: nur lesen, Vertrag pruefen, Hash merken.
    const rulesBuf = fs.readFileSync(H.ROOT_RULES);
    rulesHashBefore = sha256(rulesBuf);
    assertRulesContract(rulesBuf.toString('utf8'));

    // (2) Isolierter Lauf: eigene Ports, eigenes Temp-Verzeichnis, byte-identische
    //     Rules-Kopie (prepareTempRules verifiziert SHA-256 selbst).
    for (const p of [H.EMU_PORT, ...H.EMU_AUX_PORTS]) {
      if (!(await H.portFree(p))) throw new Error(`Port ${p} belegt — Abbruch.`);
    }
    runDir = H.createRunDir();
    const copyHash = H.prepareTempRules(runDir);
    if (copyHash !== rulesHashBefore) throw new Error('Rules-Kopie weicht von der getrackten Datei ab.');

    const t = H.transformHtml(fs.readFileSync(H.INDEX_HTML, 'utf8'));
    state.transformedHtml = t.html;
    staticServer = await H.startStaticServer();
    emu = H.startEmulator(runDir);
    await H.waitHttp(`http://${H.EMU_HOST}:${H.EMU_PORT}/.json?ns=${H.EMU_NS}`, 90000);

    browser = await chromium.launch({ args: [...H.CHROMIUM_E2E_ARGS, '--mute-audio'] });
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await H.armContext(ctx, 'rules-sec', state);     // Produktions-Firebase hart gesperrt
    const page = await ctx.newPage();
    await page.goto(`http://${H.EMU_HOST}:${staticServer.port}/index.html?r2d=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__FB_READY === true, null, { timeout: 30000 });

    const res = await page.evaluate(DRIVER);
    if (res.fatal) failures.push('Treiber-Abbruch: ' + res.fatal);
    // Bewertung in Node: DENY zaehlt nur bei echter Rules-Ablehnung.
    checks = (res.checks || []).map((c) => {
      if (c.kind === 'state') return { name: c.name, ok: !!c.ok, detail: c.detail || null };
      const v = c.kind === 'deny' ? classifyDeny(c.res) : classifyAllow(c.res);
      return { name: c.name, ok: v.ok, detail: v.detail };
    });
    await ctx.close();
  };

  try {
    // Selbstpruefung der DENY-Klassifikation (ohne Emulator, ohne Mocking der
    // vier Security-Faelle) — laeuft bei jedem Testlauf mit.
    const self = selfCheckClassifier();
    if (!self.ok) failures.push('Helper-Selbstpruefung: ' + self.detail);
    checks.push({ name: 'Helper: nur PERMISSION_DENIED zaehlt als Rules-DENY', ok: self.ok, detail: self.detail });

    const run = mainRun();
    run.catch(() => {});                             // spaete Rejection nach Timeout nicht unhandled lassen
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Zeitlimit ueberschritten (${RUN_TIMEOUT_MS} ms).`)), RUN_TIMEOUT_MS);
    });
    await Promise.race([run, timeout]);
  } catch (e) {
    failures.push('Ausnahme: ' + String((e && e.stack) || e));
    console.error('ABBRUCH:', e);
  } finally {
    if (timer) clearTimeout(timer);                  // kein dangling Timer

    // Cleanup laeuft IMMER — auch nach Timeout. Es beendet Browser, Emulator,
    // Static-Server und entfernt das Pro-Lauf-Temp-Verzeichnis; ein noch
    // offener page.evaluate() endet mit dem Browser.
    let cleanup = { cleanupOk: false, notes: ['cleanup nicht ausgefuehrt'] };
    try {
      cleanup = await H.cleanup({ browser, staticServer, emu, runDir, closeErrors: [], preexistingLogs: [] });
    } catch (e) {
      failures.push('Cleanup-Ausnahme: ' + String((e && e.message) || e));
    }

    for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : '  — ' + (c.detail || 'fehlgeschlagen')}`);
    const passed = checks.filter((c) => c.ok).length;
    for (const c of checks) if (!c.ok) failures.push('Check: ' + c.name);
    if (checks.length < 2) failures.push('Keine Emulator-Checks ausgefuehrt.');

    // Produktions-Isolation: jeder Kontaktversuch ist ein Testfehler.
    if (state.prodHits.length) failures.push(`Produktionskontakt ueber HTTP: ${state.prodHits.length}`);
    if (state.wsProdHits.length) failures.push(`Produktionskontakt ueber WebSocket: ${state.wsProdHits.length}`);

    // Die getrackte Rules-Datei muss byte-identisch geblieben sein.
    let rulesHashAfter = null;
    try { rulesHashAfter = sha256(fs.readFileSync(H.ROOT_RULES)); } catch (e) { failures.push('Rules-Nachlese: ' + e.message); }
    if (rulesHashBefore && rulesHashAfter && rulesHashAfter !== rulesHashBefore) failures.push('firebase.rules.json wurde veraendert!');

    // Cleanup ist Teil des Ergebnisses, nicht Beiwerk.
    if (!cleanup.cleanupOk) failures.push('Cleanup unvollstaendig: ' + JSON.stringify(cleanup.notes));

    const ok = failures.length === 0;
    console.log(`\nRules-Security-Regression (echte firebase.rules.json, sha256 ${String(rulesHashBefore).slice(0, 16)}…): `
      + `${passed} passed, ${checks.length - passed} failed — Cleanup ${cleanup.cleanupOk ? 'ok' : 'FEHLER'}`
      + `, prodHits ${state.prodHits.length}, wsProdHits ${state.wsProdHits.length}`);
    if (!ok) console.error('\nFEHLER:\n  - ' + failures.join('\n  - '));
    process.exit(ok ? 0 : 1);
  }
})();
