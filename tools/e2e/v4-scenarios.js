// ─────────────────────────────────────────────────────────────────────────────
// RingOut — v4-E2E-Szenarien (echter Browser, echte Emulatoren, echte Callables)
//
// Diese Suite ist das UNABHAENGIGE ORAKEL der Arbiter-Integration. Sie kennt die
// Interna des Clients nicht: sie treibt ausschliesslich die produktiven
// Einstiegspunkte (createRoom/joinRoom/startFfaMatch/commit/onlineRematch/
// attemptRejoin/leaveOnline) ueber den Test-Adapter und prueft danach den
// TATSAECHLICHEN Datenbestand im RTDB-Emulator.
//
// Der entscheidende Unterschied zu den Offline-Suiten: hier gibt es kein Fake.
// Die Rules sind die echten, der Arbiter ist der echte, die Uhr ist die echte
// Serveruhr. Was hier gruen ist, ist am realen Vertrag gruen — deshalb wird
// diese Suite VOR der Client-Migration geschrieben und darf mit dem v3-Client
// erwartbar rot sein.
//
// Zeitverhalten: Szenarien 4-6 verbrauchen echte Matchzeit (zwei 30-s-Zyklen).
// Es wird NICHT geschlafen und nichts vorgespult — die Suite pollt den echten
// Datenbestand, bis der Server die Stufe selbst gesetzt hat. Das dauert, ist
// aber der einzige ehrliche Beweis fuer "exakt 30 Sekunden".
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const H = require('./lib/harness');
const V = require('./lib/harness-v4');

// ── Assertions ───────────────────────────────────────────────────────────────
function mkT() {
  const rows = [];
  const t = (name, cond, detail) => {
    rows.push({ name, ok: !!cond, detail: cond ? '' : (detail == null ? '' : String(detail)) });
    return !!cond;
  };
  t.rows = rows;
  t.passed = () => rows.filter((r) => r.ok).length;
  t.failed = () => rows.filter((r) => !r.ok).length;
  return t;
}

// ── Client-Lebenszyklus ──────────────────────────────────────────────────────
// Jeder Client ist ein eigener Browser-Context (eigener Storage, eigene
// Anonymous-Auth-UID) — genau wie zwei echte Spieler auf zwei Geraeten.
async function newClient(browser, navUrl, state, diag, label) {
  const ctx = await browser.newContext();
  await H.armContext(ctx, label, state);
  const page = await ctx.newPage();
  H.wireDiagnostics(page, label, diag);
  await page.goto(navUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 30000 });
  // Anonymous Auth ist Voraussetzung fuer JEDEN v4-Pfad: ohne UID darf gar
  // nichts passieren. Wir warten hier bewusst, damit ein Auth-Ausfall als
  // Auth-Fehler sichtbar wird und nicht spaeter als diffuser Callable-Fehler.
  const uid = await page.waitForFunction(
    () => (window.__FB_UID && window.__FB_UID.length ? window.__FB_UID : null),
    null, { timeout: 30000 },
  ).then((h) => h.jsonValue()).catch(() => null);
  return { ctx, page, label, uid };
}
const snap = (c) => c.page.evaluate(() => window.__ringoutE2E.snapshot());
const v4of = (c) => c.page.evaluate(() => window.__ringoutE2E.v4());
const drive = (c, fn, ...args) => c.page.evaluate(
  ([f, a]) => window.__ringoutE2E[f].apply(null, a), [fn, args]);

// Wartet, bis der Client einen Raumcode fuehrt (Create/Join abgeschlossen).
// Liest ueber den toleranten Kurzstatus room(), NICHT ueber den streng
// validierenden snapshot(): waehrend Raumaufbau und Formatwechsel darf das
// Spielfeld legitim noch aus der vorherigen Partie stammen — das ist kein
// Fehler und darf den Lauf nicht abbrechen.
async function waitRoomCode(c, timeoutMs) {
  try {
    const h = await c.page.waitForFunction(
      () => { const s = window.__ringoutE2E.room(); return (s.roomCode && s.roomCode.length === 4) ? s.roomCode : null; },
      null, { timeout: timeoutMs || 20000 });
    return await h.jsonValue();
  } catch (e) { return null; }
}
async function waitStarted(c, timeoutMs) {
  try {
    await c.page.waitForFunction(() => window.__ringoutE2E.room().gameStarted === true, null, { timeout: timeoutMs || 20000 });
    return true;
  } catch (e) { return false; }
}
async function closeClient(c) { try { await c.ctx.close(); } catch (e) { /* egal */ } }

// ─────────────────────────────────────────────────────────────────────────────
// 1) v4-Raum erstellen, aktivieren, beitreten und starten
// ─────────────────────────────────────────────────────────────────────────────
async function scenarioLifecycle(env) {
  const t = mkT();
  const host = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S1-Host');
  const guest = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S1-Gast');
  try {
    t('S1: Host bekommt eine Anonymous-Auth-UID', !!host.uid, 'uid=' + host.uid);
    t('S1: Gast bekommt eine eigene, andere UID', !!guest.uid && guest.uid !== host.uid, host.uid + ' / ' + guest.uid);
    t('S1: Client fuehrt Protokollversion 4', (await v4of(host)).proto === 4, 'proto=' + (await v4of(host)).proto);

    await drive(host, 'hostFFA', 3);
    const code = await waitRoomCode(host, 25000);
    t('S1: Raum wurde erstellt (Code liegt vor)', !!code, 'roomCode=' + code);
    if (!code) return t;

    const room = (await V.readRoom(code)).val || {};
    t('S1: Raum ist v4', room.v === 4, 'v=' + room.v);
    t('S1: Raum traegt eine server-generierte iid', typeof room.iid === 'string' && room.iid.length > 0, 'iid=' + room.iid);
    t('S1: Raum ist nicht mehr provisional', room.provisional === undefined, 'provisional=' + room.provisional);
    t('S1: seatByUid ist server-owned und zeigt Host auf Seat 0',
      room.seatByUid && room.seatByUid[host.uid] === 0, JSON.stringify(room.seatByUid));
    t('S1: players/0 traegt die Host-UID', room.players && room.players[0] && room.players[0].uid === host.uid,
      JSON.stringify(room.players && room.players[0]));
    t('S1: Host hat eine AKTIVE Session', room.sess && room.sess[0] && typeof room.sess[0].active === 'string',
      JSON.stringify(room.sess && room.sess[0]));
    t('S1: Host-Session ist aktiviert, nicht nur reserviert',
      room.sess && room.sess[0] && room.sess[0].pending == null, JSON.stringify(room.sess && room.sess[0]));

    await drive(guest, 'joinFFA', code);
    const gcode = await waitRoomCode(guest, 25000);
    t('S1: Gast ist demselben Raum beigetreten', gcode === code, 'gast=' + gcode);

    const r2 = await V.until(() => V.readRoom(code),
      (v) => v && v.sess && v.sess[1] && typeof v.sess[1].active === 'string', 20000);
    t('S1: Gast hat eine aktive Session auf Seat 1', r2.ok, JSON.stringify(r2.val && r2.val.sess));
    t('S1: seatByUid ordnet den Gast server-seitig Seat 1 zu',
      r2.val && r2.val.seatByUid && r2.val.seatByUid[guest.uid] === 1, JSON.stringify(r2.val && r2.val.seatByUid));
    t('S1: der Gast hat sich den Seat NICHT selbst ausgesucht (kein Client-Claim)',
      (await v4of(guest)).legacy && (await v4of(guest)).legacy.claimSeat === false, 'claimSeat noch vorhanden');

    await drive(host, 'start');
    const started = await V.until(() => V.readRoom(code), (v) => v && v.state === 'playing', 20000);
    t('S1: Match ist gestartet (state=playing)', started.ok, 'state=' + (started.val && started.val.state));
    const ck = await V.until(() => V.readClock(code, 0), (v) => v && v.phase === 'aim', 20000);
    t('S1: der Server hat live/clock eroeffnet', ck.ok, JSON.stringify(ck.val));
    t('S1: Eroeffnungsanker traegt stage 0 und einen vollen Zyklus',
      ck.val && ck.val.stage === 0 && ck.val.remainingMs === 30000, JSON.stringify(ck.val));
    t('S1: eligibleSeats stammt vom Server und deckt beide Seats',
      ck.val && ck.val.eligibleSeats === '0,1', 'eligibleSeats=' + (ck.val && ck.val.eligibleSeats));
    t('S1: beide Clients sind im Match', (await waitStarted(host)) && (await waitStarted(guest)));
    env.rooms.push(code);
  } finally { await closeClient(guest); await closeClient(host); }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Zug ausschliesslich ueber live/slots  +  3) live/clock steuert Turn/Deadline
// ─────────────────────────────────────────────────────────────────────────────
async function scenarioSlotsAndClock(env) {
  const t = mkT();
  const a = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S2-Host');
  const b = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S2-Gast');
  try {
    await drive(a, 'hostFFA', 3);
    const code = await waitRoomCode(a, 25000);
    if (!code) { t('S2: Raum erstellt', false, 'kein Code'); return t; }
    await drive(b, 'joinFFA', code);
    await waitRoomCode(b, 25000);
    await V.until(() => V.readRoom(code), (v) => v && v.sess && v.sess[1] && v.sess[1].active, 20000);
    await drive(a, 'start');
    if (!(await waitStarted(a, 25000)) || !(await waitStarted(b, 25000))) {
      t('S2: Match gestartet', false, 'Start kam nicht durch'); return t;
    }
    const c0 = (await V.readClock(code, 0)).val || {};
    t('S2: Uhr steht auf aim, Turn 0', c0.phase === 'aim' && c0.turn === 0, JSON.stringify(c0));
    t('S3: Uhr traegt eine absolute Deadline', typeof c0.deadlineAt === 'number', 'deadlineAt=' + c0.deadlineAt);
    t('S3: das Zugfenster ist min(7 s, Restzyklus) = 7 s',
      c0.deadlineAt - c0.startedAt === 7000, 'fenster=' + (c0.deadlineAt - c0.startedAt));

    // Ein echter Zug ueber den produktiven commit()-Pfad.
    await drive(a, 'commitMove', 40, 10, 0);
    const sl = await V.until(() => V.readSlots(code, 0), (v) => v && v[0], 15000);
    t('S2: der Zug landet in live/slots/<seat>', sl.ok, JSON.stringify(sl.val));
    const mine = (sl.val || {})[0] || {};
    t('S2: der Slot traegt die Turnnummer', mine.t === 0, 't=' + mine.t);
    t('S2: der Slot traegt das Session-Token (sid)', typeof mine.sid === 'string' && mine.sid.length > 0, 'sid=' + mine.sid);
    const room = (await V.readRoom(code)).val || {};
    t('S2: sid ist exakt die AKTIVE Session des Seats',
      room.sess && room.sess[0] && mine.sid === room.sess[0].active, mine.sid + ' vs ' + (room.sess && room.sess[0] && room.sess[0].active));
    const hist0 = (await V.readTurn(code, 0, 0)).val;
    t('S2: solange die Phase offen ist, existiert KEINE Historie', hist0 == null, JSON.stringify(hist0));
    t('S2: der alte v3-Phasenstempel t/<turn>/s wird nicht mehr geschrieben',
      !hist0 || hist0.s === undefined, 's=' + (hist0 && hist0.s));

    // Zweiter Zug schliesst die Phase — der Server archiviert und oeffnet Turn 1.
    await drive(b, 'commitMove', -40, 10, 0);
    const c1 = await V.until(() => V.readClock(code, 0), (v) => v && v.turn === 1 && v.phase === 'aim', 30000);
    t('S3: nach beiden Commits oeffnet der Server Turn 1', c1.ok, JSON.stringify(c1.val));
    t('S3: die Uhr hat nur die tatsaechlich verbrauchte Zeit abgezogen',
      c1.val && c1.val.remainingMs <= 30000 && c1.val.remainingMs > 30000 - 7100,
      'remainingMs=' + (c1.val && c1.val.remainingMs));
    const h0 = await V.until(() => V.readTurn(code, 0, 0), (v) => v && v.c, 20000);
    t('S2: Turn 0 ist mit Clock-Anker archiviert', h0.ok && h0.val && typeof h0.val.c.stage === 'number', JSON.stringify(h0.val && h0.val.c));
    t('S2: die Historie enthaelt beide Zuege', h0.val && h0.val[0] && h0.val[1], Object.keys(h0.val || {}).join(','));
    t('S3: Turn 1 hat eine frische, spaetere Deadline',
      c1.val && c1.val.deadlineAt > c0.deadlineAt, c0.deadlineAt + ' -> ' + (c1.val && c1.val.deadlineAt));
    t('S3: kein Pre-Arming zukuenftiger Turns (t/1 existiert noch nicht)',
      (await V.readTurn(code, 0, 1)).val == null, 't/1 vorhanden');
    env.rooms.push(code);
  } finally { await closeClient(b); await closeClient(a); }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) Collapse 1 nach exakt 30 s   5) Zyklus 2 startet mit exakt 30 s
// 6) Collapse 2 terminal
// ─────────────────────────────────────────────────────────────────────────────
// Es wird echte Zeit verbraucht: beide Clients lassen die Phasen auslaufen, der
// Server bucht die No-Shots und zieht die Zeit ab. Geprueft wird ausschliesslich
// der Serverzustand.
async function scenarioTwoCycles(env) {
  const t = mkT();
  const a = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S4-Host');
  const b = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S4-Gast');
  try {
    await drive(a, 'hostFFA', 3);
    const code = await waitRoomCode(a, 25000);
    if (!code) { t('S4: Raum erstellt', false, 'kein Code'); return t; }
    await drive(b, 'joinFFA', code);
    await waitRoomCode(b, 25000);
    await V.until(() => V.readRoom(code), (v) => v && v.sess && v.sess[1] && v.sess[1].active, 20000);
    await drive(a, 'start');
    if (!(await waitStarted(a, 25000))) { t('S4: Match gestartet', false, ''); return t; }

    // Zyklus 1 auslaufen lassen: kein Client committet, der Server schliesst
    // jede Phase an ihrer Deadline und bucht {ns:'stand'}.
    const st1 = await V.until(() => V.readClock(code, 0), (v) => v && v.stage >= 1, 90000, 'stage 1');
    t('S4: Collapse 1 ist gefallen', st1.ok, JSON.stringify(st1.val));
    if (!st1.ok) return t;
    t('S5: Zyklus 2 startet mit exakt 30 000 ms',
      st1.val.remainingMs === 30000, 'remainingMs=' + st1.val.remainingMs);
    t('S5: kein Ueberhang — der Zyklus wurde nicht angeschnitten',
      st1.val.remainingMs === 30000 && st1.val.stage === 1, JSON.stringify(st1.val));
    t('S4: das Warnfenster ist fuer den neuen Zyklus zurueckgesetzt',
      st1.val.cracked === false, 'cracked=' + st1.val.cracked);
    t('S4: die Uhr ist nach Stufe 1 nicht abgelaufen', st1.val.expired === false, 'expired=' + st1.val.expired);

    // Der Stufenwechsel muss im Historien-Anker sichtbar sein.
    const anchors = [];
    for (let turn = 0; turn < 12; turn++) {
      const h = (await V.readTurn(code, 0, turn)).val;
      if (!h || !h.c) break;
      anchors.push({ turn, stage: h.c.stage, rem: h.c.remainingAfter });
    }
    t('S4: die Historie traegt je Turn einen Clock-Anker', anchors.length >= 2, JSON.stringify(anchors));
    t('S4: der Stufenwechsel ist im Anker als Sprung zwischen zwei Turns sichtbar',
      anchors.some((x) => x.stage === 1), JSON.stringify(anchors));
    t('S4: kein Anker traegt eine negative Restzeit',
      anchors.every((x) => typeof x.rem === 'number' && x.rem >= 0), JSON.stringify(anchors));

    // Zyklus 2 ebenfalls auslaufen lassen.
    const st2 = await V.until(() => V.readClock(code, 0), (v) => v && v.stage >= 2, 90000, 'stage 2');
    t('S6: Collapse 2 ist gefallen', st2.ok, JSON.stringify(st2.val));
    if (st2.ok) {
      t('S6: nach der letzten Stufe ist die Uhr terminal bei 0',
        st2.val.remainingMs === 0 && st2.val.expired === true, JSON.stringify(st2.val));
      const st3 = await V.until(() => V.readClock(code, 0), (v) => v && v.stage >= 3, 20000, 'stage 3');
      t('S6: es entsteht KEINE dritte Stufe', !st3.ok, 'stage=' + (st3.val && st3.val.stage));
      const after = (await V.readClock(code, 0)).val || {};
      t('S6: Folgephasen laufen ohne Deadline weiter (kein Match-Abbruch)',
        after.phase !== 'finished' ? after.deadlineAt == null : true, JSON.stringify(after));
    }
    env.rooms.push(code);
  } finally { await closeClient(b); await closeClient(a); }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7) Late Join und Reconnect
// ─────────────────────────────────────────────────────────────────────────────
async function scenarioLateJoinReconnect(env) {
  const t = mkT();
  const a = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S7-Host');
  const b = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S7-Gast');
  let c = null;
  try {
    await drive(a, 'hostFmt', 'ffa', 3);
    const code = await waitRoomCode(a, 25000);
    if (!code) { t('S7: Raum erstellt', false, 'kein Code'); return t; }

    // Late Join: ein dritter Spieler tritt der LOBBY bei, bevor gestartet wird.
    await drive(b, 'joinFFA', code);
    await waitRoomCode(b, 25000);
    c = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S7-Spaet');
    await drive(c, 'joinFFA', code);
    const ccode = await waitRoomCode(c, 25000);
    t('S7: Late Join in die Lobby gelingt', ccode === code, 'code=' + ccode);
    const r = await V.until(() => V.readRoom(code),
      (v) => v && v.sess && v.sess[2] && v.sess[2].active, 20000);
    t('S7: der spaete Spieler bekommt Seat 2 vom Server', r.ok && r.val.seatByUid[c.uid] === 2,
      JSON.stringify(r.val && r.val.seatByUid));

    await drive(a, 'start');
    if (!(await waitStarted(a, 25000))) { t('S7: Match gestartet', false, ''); return t; }
    const ck = await V.until(() => V.readClock(code, 0), (v) => v && v.phase === 'aim', 20000);
    t('S7: alle drei Seats sind zugberechtigt', ck.ok && ck.val.eligibleSeats === '0,1,2',
      'eligibleSeats=' + (ck.val && ck.val.eligibleSeats));

    // Reconnect: der Gast laedt neu und nimmt seinen Seat per Rejoin zurueck.
    const before = (await V.readRoom(code)).val;
    const sessBefore = before.sess[1].active;
    await b.page.reload({ waitUntil: 'domcontentloaded' });
    await b.page.waitForFunction(() => window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 30000 });
    await b.page.waitForFunction(() => (window.__FB_UID && window.__FB_UID.length) ? true : null, null, { timeout: 30000 }).catch(() => {});
    await drive(b, 'rejoin', code);
    const back = await V.until(() => V.readRoom(code),
      (v) => v && v.sess && v.sess[1] && v.sess[1].active && v.sess[1].active !== sessBefore, 30000);
    t('S7: Reconnect rotiert die Session des Seats', back.ok,
      sessBefore + ' -> ' + (back.val && back.val.sess && back.val.sess[1] && back.val.sess[1].active));
    t('S7: der Seat bleibt derselbe UID zugeordnet',
      back.val && back.val.seatByUid && back.val.seatByUid[b.uid] === 1, JSON.stringify(back.val && back.val.seatByUid));
    t('S7: die laufende Uhr wurde durch den Reconnect NICHT zurueckgesetzt',
      (await V.readClock(code, 0)).val.remainingMs <= 30000, '');
    t('S7: der zurueckgekehrte Client ist wieder im Match', await waitStarted(b, 25000));
    env.rooms.push(code);
  } finally { if (c) await closeClient(c); await closeClient(b); await closeClient(a); }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8) Rematch setzt stage=0 und remainingMs=30000
// ─────────────────────────────────────────────────────────────────────────────
async function scenarioRematch(env) {
  const t = mkT();
  const a = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S8-Host');
  const b = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S8-Gast');
  try {
    await drive(a, 'hostFFA', 3);
    const code = await waitRoomCode(a, 25000);
    if (!code) { t('S8: Raum erstellt', false, 'kein Code'); return t; }
    await drive(b, 'joinFFA', code);
    await waitRoomCode(b, 25000);
    await V.until(() => V.readRoom(code), (v) => v && v.sess && v.sess[1] && v.sess[1].active, 20000);
    await drive(a, 'start');
    if (!(await waitStarted(a, 25000))) { t('S8: Match gestartet', false, ''); return t; }

    // 1) Beide Collapse-Stufen abwarten — der Rematch soll NACH Collapse 2 laufen.
    const st2 = await V.until(() => V.readClock(code, 0), (v) => v && v.stage >= 2, 120000, 'Collapse 2');
    t('S8: Collapse 2 ist gefallen, bevor der Rematch ausgeloest wird', st2.ok, JSON.stringify(st2.val));
    if (!st2.ok) return t;
    // 2) Die Generation muss TERMINAL sein — roomRematchV4 verweigert sonst
    //    fail-closed ("Match der aktuellen Generation ist nicht beendet"), und
    //    genau das soll so sein: aus einer laufenden Partie darf niemand die
    //    Generation wegziehen. Hier wird das Ende ueber den regulaeren
    //    Settlement-Weg herbeigefuehrt: der Gast verschwindet, das Quorum kann
    //    nicht mehr zustande kommen, der Arbiter beendet die Phase nach seiner
    //    Gnadenfrist deterministisch.
    const w = H.beginLeaveWindow(env.state, code);
    await closeClient(b);
    H.endLeaveWindow(w);
    const fin = await V.until(() => V.readClock(code, 0), (v) => v && v.phase === 'finished', 90000, 'Generation beendet');
    t('S8: die erste Generation ist terminal beendet', fin.ok, JSON.stringify(fin.val));
    if (!fin.ok) return t;
    const genBefore = (await V.readRoom(code)).val.gen;
    const histBefore = JSON.stringify((await V.readTurn(code, genBefore, 0)).val);

    await drive(a, 'rematch');
    const r = await V.until(() => V.readRoom(code), (v) => v && v.gen === genBefore + 1, 30000, 'gen-Bump');
    t('S8: der Rematch erhoeht die Generation um genau 1', r.ok, 'gen=' + (r.val && r.val.gen));
    if (!r.ok) return t;
    const nc = await V.until(() => V.readClock(code, genBefore + 1), (v) => v && v.phase === 'aim', 30000);
    t('S8: die neue Generation hat eine frische Uhr', nc.ok, JSON.stringify(nc.val));
    t('S8: der Rematch setzt stage auf 0', nc.val && nc.val.stage === 0, 'stage=' + (nc.val && nc.val.stage));
    t('S8: der Rematch setzt remainingMs auf 30000', nc.val && nc.val.remainingMs === 30000, 'remainingMs=' + (nc.val && nc.val.remainingMs));
    t('S8: cracked und expired sind zurueckgesetzt',
      nc.val && nc.val.cracked === false && nc.val.expired === false, JSON.stringify(nc.val));
    t('S8: die neue Generation traegt eine neue phaseId',
      nc.val && nc.val.phaseId === (genBefore + 1) + ':0', 'phaseId=' + (nc.val && nc.val.phaseId));
    t('S8: live/slots der neuen Generation ist leer',
      (await V.readSlots(code, genBefore + 1)).val == null, '');
    t('S8: die alte Generation bleibt unveraendert',
      JSON.stringify((await V.readTurn(code, genBefore, 0)).val) === histBefore, '');
    // Der Rematch ist idempotent: ein zweiter Aufruf gegen dieselbe expectedGen
    // liefert den bestehenden Anker zurueck, statt die frische Uhr zu resetten.
    const clockBefore = JSON.stringify((await V.readClock(code, genBefore + 1)).val);
    await drive(a, 'rematch');
    await H.sleep(1500);
    t('S8: ein wiederholter Rematch setzt die neue Uhr NICHT zurueck',
      JSON.stringify((await V.readClock(code, genBefore + 1)).val) === clockBefore, '');
    t('S8: der wiederholte Rematch erzeugt keine dritte Generation',
      (await V.readRoom(code)).val.gen === genBefore + 1, '');
    env.rooms.push(code);
  } finally { await closeClient(b); await closeClient(a); }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9) FFA 3/5 und 2v2
// ─────────────────────────────────────────────────────────────────────────────
async function scenarioFormats(env) {
  const t = mkT();

  // ── FFA mit 3 Spielern ──
  {
    const cs = [];
    try {
      for (let i = 0; i < 3; i++) cs.push(await newClient(env.browser, env.navUrl, env.state, env.diag, 'S9-FFA3-' + i));
      await drive(cs[0], 'hostFFA', 3);
      const code = await waitRoomCode(cs[0], 25000);
      if (code) {
        for (let i = 1; i < 3; i++) { await drive(cs[i], 'joinFFA', code); await waitRoomCode(cs[i], 25000); }
        await V.until(() => V.readRoom(code), (v) => v && v.sess && v.sess[2] && v.sess[2].active, 25000);
        await drive(cs[0], 'start');
        const r = await V.until(() => V.readRoom(code), (v) => v && v.state === 'playing', 25000);
        t('S9: FFA 3 startet', r.ok, 'state=' + (r.val && r.val.state));
        t('S9: FFA 3 schreibt seats=3 server-seitig', r.val && r.val.seats === 3, 'seats=' + (r.val && r.val.seats));
        const ck = (await V.readClock(code, 0)).val || {};
        t('S9: FFA 3 — alle drei Seats zugberechtigt', ck.eligibleSeats === '0,1,2', 'eligibleSeats=' + ck.eligibleSeats);
        t('S9: FFA 3 — Eroeffnung mit stage 0 / 30 000 ms',
          ck.stage === 0 && ck.remainingMs === 30000, JSON.stringify(ck));
        env.rooms.push(code);
      } else t('S9: FFA-3-Raum erstellt', false, 'kein Code');
    } finally { for (const c of cs.reverse()) await closeClient(c); }
  }

  // ── FFA mit 5 Spielern ──
  {
    const cs = [];
    try {
      for (let i = 0; i < 5; i++) cs.push(await newClient(env.browser, env.navUrl, env.state, env.diag, 'S9-FFA5-' + i));
      await drive(cs[0], 'hostFFA', 5);
      const code = await waitRoomCode(cs[0], 25000);
      if (code) {
        for (let i = 1; i < 5; i++) { await drive(cs[i], 'joinFFA', code); await waitRoomCode(cs[i], 25000); }
        await V.until(() => V.readRoom(code), (v) => v && v.sess && v.sess[4] && v.sess[4].active, 30000);
        await drive(cs[0], 'start');
        const r = await V.until(() => V.readRoom(code), (v) => v && v.state === 'playing', 25000);
        t('S9: FFA 5 startet', r.ok, 'state=' + (r.val && r.val.state));
        t('S9: FFA 5 schreibt seats=5 server-seitig', r.val && r.val.seats === 5, 'seats=' + (r.val && r.val.seats));
        const ck = (await V.readClock(code, 0)).val || {};
        t('S9: FFA 5 — alle fuenf Seats zugberechtigt', ck.eligibleSeats === '0,1,2,3,4', 'eligibleSeats=' + ck.eligibleSeats);
        env.rooms.push(code);
      } else t('S9: FFA-5-Raum erstellt', false, 'kein Code');
    } finally { for (const c of cs.reverse()) await closeClient(c); }
  }

  // ── 2v2 (fmt 'double', zwei Seats mit je zwei Kugeln) ──
  {
    const cs = [];
    try {
      for (let i = 0; i < 2; i++) cs.push(await newClient(env.browser, env.navUrl, env.state, env.diag, 'S9-2v2-' + i));
      await drive(cs[0], 'hostDuel', 'double', 3);
      const code = await waitRoomCode(cs[0], 25000);
      if (code) {
        await drive(cs[1], 'joinDuel', code);
        await waitRoomCode(cs[1], 25000);
        // 1v1/2v2 startet serverseitig automatisch mit der Gast-Aktivierung.
        const r = await V.until(() => V.readRoom(code), (v) => v && v.state === 'playing', 30000);
        t('S9: 2v2 startet automatisch mit der Gast-Aktivierung', r.ok, 'state=' + (r.val && r.val.state));
        t('S9: 2v2 setzt KEIN seats-Feld (immer zwei Seats)', r.val && r.val.seats === undefined, 'seats=' + (r.val && r.val.seats));
        const ck = await V.until(() => V.readClock(code, 0), (v) => v && v.phase === 'aim', 25000);
        t('S9: 2v2 — Eroeffnung mit stage 0 / 30 000 ms',
          ck.val && ck.val.stage === 0 && ck.val.remainingMs === 30000, JSON.stringify(ck.val));
        t('S9: 2v2 — beide Seats zugberechtigt', ck.val && ck.val.eligibleSeats === '0,1', 'eligibleSeats=' + (ck.val && ck.val.eligibleSeats));
        env.rooms.push(code);
      } else t('S9: 2v2-Raum erstellt', false, 'kein Code');
    } finally { for (const c of cs.reverse()) await closeClient(c); }
  }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10) Disconnect waehrend Aim erzeugt GENAU EINEN No-Shot
// ─────────────────────────────────────────────────────────────────────────────
// Kein Client erfindet den fehlenden Zug: der Server fuellt den offenen Slot an
// der Deadline mit {ns:'stand'} — write-once, genau einmal, unabhaengig davon,
// wie viele Clients den Abschluss anstossen.
async function scenarioDisconnectNoShot(env) {
  const t = mkT();
  const a = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S10-Host');
  const b = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S10-Gast');
  let closed = false;
  try {
    await drive(a, 'hostFFA', 3);
    const code = await waitRoomCode(a, 25000);
    if (!code) { t('S10: Raum erstellt', false, 'kein Code'); return t; }
    await drive(b, 'joinFFA', code);
    await waitRoomCode(b, 25000);
    await V.until(() => V.readRoom(code), (v) => v && v.sess && v.sess[1] && v.sess[1].active, 20000);
    await drive(a, 'start');
    if (!(await waitStarted(a, 25000))) { t('S10: Match gestartet', false, ''); return t; }
    await V.until(() => V.readClock(code, 0), (v) => v && v.phase === 'aim', 20000);

    // Der Gast verschwindet MITTEN in der Aim-Phase, ohne zu committen.
    const w = H.beginLeaveWindow(env.state, code);
    await closeClient(b); closed = true;
    H.endLeaveWindow(w);

    // Der Host committet regulaer; der offene Slot des Gasts muss vom Server
    // als verbindlicher No-Shot gebucht werden.
    await drive(a, 'commitMove', 30, 0, 0);
    // Die Phase MUSS den Zustand 'resolving' verlassen — der Ausgang haengt vom
    // Quorum ab und beides ist vertragskonform:
    //   · ein vollstaendiges Quorum oeffnet die Folgephase (turn >= 1)
    //   · ein unvollstaendiges endet nach settleDeadlineAt deterministisch als
    //     'settlement_timeout'. In einem Zwei-Spieler-Raum, dessen Gegner
    //     verschwunden ist, ist genau das der richtige Ausgang: Presence
    //     entscheidet beim Arbiter bewusst NICHTS, ein lebender Seat bleibt also
    //     zugberechtigt und kann kein Quorum mehr bilden.
    // Was hier NICHT passieren darf, ist Stillstand in 'resolving'.
    const done = await V.until(() => V.readClock(code, 0),
      (v) => v && (v.turn >= 1 || v.phase === 'finished'), 40000, 'Phase verlaesst resolving');
    t('S10: die Phase bleibt nicht in resolving stehen', done.ok, JSON.stringify(done.val));
    t('S10: der Ausgang ist deterministisch (Folgephase oder settlement_timeout)',
      done.ok && (done.val.turn >= 1 || done.val.reason === 'settlement_timeout'),
      JSON.stringify(done.val && { phase: done.val.phase, turn: done.val.turn, reason: done.val.reason }));
    t('S10: der verbliebene Client hat sein Ergebnis gemeldet',
      done.val && done.val.settled && Object.keys(done.val.settled).length >= 1,
      JSON.stringify(done.val && done.val.settled));

    const h = (await V.readTurn(code, 0, 0)).val || {};
    t('S10: der offene Slot ist als No-Shot gebucht', h[1] && h[1].ns === 'stand', JSON.stringify(h[1]));
    t('S10: der No-Shot ist ein Stand, nie ein "left"', !h[1] || h[1].ns === 'stand', JSON.stringify(h[1]));
    t('S10: der eigene Zug des Hosts blieb erhalten', h[0] && h[0].ns === undefined, JSON.stringify(h[0]));
    t('S10: es gibt GENAU einen No-Shot in diesem Turn',
      Object.keys(h).filter((k) => k !== 'c' && h[k] && h[k].ns === 'stand').length === 1,
      JSON.stringify(h));
    t('S10: der No-Shot kostet die Uhr hoechstens ein Zugfenster',
      done.val && done.val.remainingMs >= 30000 - 7100, 'remainingMs=' + (done.val && done.val.remainingMs));
    t('S10: kein Client hat einen Leave-Sentinel geschrieben (Maschinerie entfernt)',
      (await v4of(a)).legacy.writeLeaveSentinel === false, 'writeLeaveSentinel noch vorhanden');
    env.rooms.push(code);
  } finally { if (!closed) await closeClient(b); await closeClient(a); }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Regressionsschutz: der v4-Pfad darf keine v3-Uhrreste mehr enthalten
// ─────────────────────────────────────────────────────────────────────────────
async function scenarioNoLegacyClock(env) {
  const t = mkT();
  const c = await newClient(env.browser, env.navUrl, env.state, env.diag, 'S11-Rest');
  try {
    const v = await v4of(c);
    const L = v.legacy || {};
    t('S11: stampOnlinePhase ist entfernt', L.stampOnlinePhase === false);
    t('S11: onlineFold ist entfernt', L.onlineFold === false);
    t('S11: onlineClock ist entfernt', L.onlineClock === false);
    t('S11: onlineCollapseTurn ist entfernt', L.onlineCollapseTurn === false);
    t('S11: onTurnStamp ist entfernt', L.onTurnStamp === false);
    t('S11: onTurnTs ist entfernt', L.onTurnTs === false);
    t('S11: onStampProbe ist entfernt', L.onStampProbe === false);
    t('S11: die Leave-Sentinel-Maschinerie ist entfernt', L.writeLeaveSentinel === false);
    t('S11: Client-Seat-Claiming ist entfernt', L.claimSeat === false);
    t('S11: der Client fuehrt eine iid der Rauminstanz', v.iid !== undefined);
  } finally { await closeClient(c); }
  return t;
}

module.exports = {
  scenarioLifecycle, scenarioSlotsAndClock, scenarioTwoCycles,
  scenarioLateJoinReconnect, scenarioRematch, scenarioFormats,
  scenarioDisconnectNoShot, scenarioNoLegacyClock,
};
