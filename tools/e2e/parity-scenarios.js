// ─────────────────────────────────────────────────────────────────────────────
// RINGOUT ONLINE FEATURE PARITY - E2E-Szenarien (Fassung 13)
//
// Zwei vollstaendig getrennte Browser-Kontexte spielen ein echtes Onlinematch
// gegen die lokale RTDB mit den ECHTEN Rules dieses Repos. Jede Zustandsaenderung
// laeuft ueber Produktcode (createRoom/joinRoom/commit/barrierRescuePlace/
// onlineRematch); gelesen wird der autoritative Zustand beider Clients.
//
//   P1  Collapse: Stufe 0 -> 1 -> 2, gleiche Uhr, gleicher Radius, keine dritte Stufe
//   P2  Rescue Wall: Platzierung, fremde Sicht, Nachrechnen, Bestand, Zugende
//   P3  Rules: fremde Autorenschaft, Unsinnswerte und eine dritte Stufe sind dicht
//   P4  Rueckkehr: derselbe Zustand allein aus der Historie
//   P5  Rematch: neue Generation -> Stufe 0, volle Arena, voller Wandbestand
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const H = require('./lib/harness');

function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }
const par = (page) => page.evaluate(() => window.__ringoutE2E.parity());
const DENK_MS = +(process.env.PARITY_DENK_MS || 6500);   // Planungszeit je Zug
const MAX_ZUEGE = +(process.env.PARITY_MAX_ZUEGE || 30);

async function newClient(ctx, id) {
  const context = await ctx.browser.newContext({ serviceWorkers: 'block' });
  await H.armContext(context, 'p' + id, ctx.state);
  const page = await context.newPage();
  H.wireDiagnostics(page, 'p' + id, ctx.diag);
  await page.goto(ctx.navUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 20000 });
  const emuOk = await page.evaluate(() => window.__E2E_EMULATOR === true && !window.__FB_ERR);
  assert(emuOk, 'Client p' + id + ': Emulator-Injektion nicht aktiv');
  await page.evaluate((k) => { try { localStorage.setItem('__e2e_client', k); } catch (_) {} }, 'p' + id);
  return { id, context, page, closed: false };
}

async function closeClient(c, ctx) {
  if (!c || c.closed) return;
  let code = null;
  try { const s = await par(c.page); code = s && s.room; } catch (_) {}
  const w = code ? H.beginLeaveWindow(ctx.state, code) : null;
  try { await c.page.evaluate(() => window.__ringoutE2E.leave()); }
  catch (e) { ctx.closeErrors.push('leave p' + c.id + ': ' + ((e && e.message) || e)); }
  if (w) H.endLeaveWindow(w);
  try { await c.context.close(); c.closed = true; }
  catch (e) { ctx.closeErrors.push('close p' + c.id + ': ' + ((e && e.message) || e)); }
}

// ── Raum: Host legt an, Gast tritt bei, das Match laeuft ─────────────────────
async function setupVersus(host, gast, win) {
  await host.page.evaluate((w) => window.__ringoutE2E.hostVersus(w), win || 3);
  let code;
  try {
    code = await H.poll(async () => {
      const s = await par(host.page);
      return s && s.room && s.room.length === 4 ? s.room : null;
    }, 20000, 'Host erstellt Versus-Raum');
  } catch (e) {
    // Der Grund steht im Statusfeld des Onlinebildschirms - ohne ihn waere der
    // Fehlschlag nicht erklaerbar.
    const lage = await host.page.evaluate(() => ({
      status: ((document.getElementById('onStatus') || {}).textContent || '').trim(),
      par: window.__ringoutE2E.parity(),
      fb: { ready: window.__FB_READY, err: window.__FB_ERR || null, uid: window.__FB_UID || null },
      diag: (() => { try { return JSON.parse(localStorage.getItem('ringout_diag')).log.slice(-6); } catch (_) { return null; } })(),
    }));
    throw new Error(((e && e.message) || e) + ' | Lage: ' + JSON.stringify(lage));
  }
  await gast.page.evaluate((c) => window.__ringoutE2E.joinVersus(c), code);
  for (const c of [host, gast]) {
    await H.poll(async () => { const s = await par(c.page); return s && s.started === true ? true : null; },
      30000, 'Client p' + c.id + ' im laufenden Match');
  }
  return code;
}

// Beide Seiten muessen an jeder Zuggrenze denselben Zustand haben. Verglichen wird
// alles, was die Partie ausmacht - nie lokale Sicht.
function gleich(a, b) {
  const f = (s) => JSON.stringify([s.gen, s.turn, s.stage, s.state, s.R, s.score, s.stakes, s.events, s.balls, s.hash]);
  return f(a) === f(b);
}

async function warteAim(clients, turn, ms) {
  await H.poll(async () => {
    for (const c of clients) {
      const s = await par(c.page);
      if (!(s && s.phase === 'aim' && s.turn === turn && s.aimSet.indexOf('0') >= 0)) return null;
    }
    return true;
  }, ms || 40000, 'beide Clients in der Planungsphase von Zug ' + turn);
}

async function zugEnde(clients, turn, ms) {
  await H.poll(async () => {
    for (const c of clients) { const s = await par(c.page); if (!(s && s.turn > turn)) return null; }
    return true;
  }, ms || 45000, 'beide Clients haben Zug ' + turn + ' abgeschlossen');
}

// ══ P1: COLLAPSE ════════════════════════════════════════════════════════════
async function scenarioCollapse(ctx) {
  const r = { name: 'collapse-2-clients', passed: false, pruefungen: [], stufen: {}, zuege: 0 };
  const ok = (n, c, i) => { r.pruefungen.push({ n, ok: !!c, i }); assert(c, n + (i !== undefined ? ' -> ' + JSON.stringify(i) : '')); };
  const host = await newClient(ctx, 0), gast = await newClient(ctx, 1);
  ctx.clients = [host, gast];
  try {
    const code = await setupVersus(host, gast, 3);
    r.roomCode = code;
    ctx.roomCode = code;
    const raum = await H.dbRead(host.page, 'rooms/' + code);
    ok('P1.1 der neue RingOut-Versus-Raum traegt die Fassung 13', raum && raum.v === 13, raum && { v: raum.v, fmt: raum.config && raum.config.fmt });
    const a0 = await par(host.page), b0 = await par(gast.page);
    ok('P1.2 zwei verschiedene Sitze', a0.seat !== b0.seat, [a0.seat, b0.seat]);
    ok('P1.3 der Collapse ist auf beiden Seiten aktiv', a0.aktiv === true && b0.aktiv === true);
    ok('P1.4 beide bei Stufe 0 und identischem Zustand', a0.stage === 0 && b0.stage === 0 && gleich(a0, b0), [a0, b0]);
    ctx.startR = a0.R;   // Ausgangsradius des Produkts (R0) - nie eine geratene Zahl
    r.startR = a0.R;
    ok('P1.5 beide mit drei Wand-Einsaetzen', JSON.stringify(a0.stakes) === JSON.stringify([3, 3]) && JSON.stringify(b0.stakes) === JSON.stringify([3, 3]), [a0.stakes, b0.stakes]);

    // Zuege spielen, bis beide Stufen gefallen sind. Gespielt wird ueber den echten
    // Nullzug (wie der Stand-Knopf) - die Kugeln bleiben liegen, die Uhr laeuft.
    let stufe1 = -1, stufe2 = -1;
    for (let z = 0; z < MAX_ZUEGE && stufe2 < 0; z++) {
      const s = await par(host.page);
      await warteAim([host, gast], s.turn);
      await H.sleep(DENK_MS);
      for (const c of [host, gast]) await c.page.evaluate(() => window.__ringoutE2E.commitReady());
      await zugEnde([host, gast], s.turn);
      r.zuege++;
      const a = await par(host.page), b = await par(gast.page);
      ok('P1.6 Zug ' + s.turn + ': beide Clients identisch', gleich(a, b), [a, b]);
      if (a.stage === 1 && stufe1 < 0) { stufe1 = s.turn; r.stufen.eins = { turn: s.turn, R: a.R }; }
      if (a.stage === 2 && stufe2 < 0) { stufe2 = s.turn; r.stufen.zwei = { turn: s.turn, R: a.R }; }
    }
    ok('P1.7 Stufe 1 ist gefallen', stufe1 >= 0, stufe1);
    ok('P1.8 Stufe 2 ist gefallen', stufe2 >= 0, stufe2);
    const a = await par(host.page), b = await par(gast.page);
    ok('P1.9 beide auf Stufe 2', a.stage === 2 && b.stage === 2);
    ok('P1.10 beide auf demselben spielbaren Radius', a.R === b.R, [a.R, b.R]);
    // Zweimal derselbe Faktor, gemessen am Ausgangsradius DIESES Produkts.
    ok('P1.11 Stufe 1 hat den Radius genau einmal verkleinert',
      Math.abs(r.stufen.eins.R - ctx.startR * 0.82) < 0.02, [r.stufen.eins.R, ctx.startR]);
    ok('P1.11b Stufe 2 ein zweites Mal - und nichts dazwischen',
      Math.abs(a.R - r.stufen.eins.R * 0.82) < 0.02, [a.R, r.stufen.eins.R]);
    ok('P1.12 der Zustand ist terminal und die Uhr steht', a.state === 'collapsed' && b.state === 'collapsed' && a.rest === 0 && b.rest === 0, [a.state, a.rest]);

    // Die autoritative Spur: genau zwei Marken (1 und 2) und Stempel je Zug.
    const gen = a.gen;
    const turns = await H.dbRead(host.page, 'rooms/' + code + '/g/' + gen + '/t');
    const marken = []; let ca = 0, cc = 0;
    for (const k in (turns || {})) { const z = turns[k];
      if (z && z.cs !== undefined) marken.push({ t: +k, s: z.cs });
      if (z && typeof z.ca === 'number') ca++;
      if (z && typeof z.cc === 'number') cc++; }
    marken.sort((x, y) => x.t - y.t);
    r.marken = marken; r.stempel = { ca, cc };
    ok('P1.13 es gibt GENAU zwei Stufenmarken', marken.length === 2, marken);
    ok('P1.14 mit den Werten 1 und 2 in dieser Reihenfolge', marken[0].s === 1 && marken[1].s === 2, marken);
    ok('P1.15 jeder Zug traegt seinen Beginn-Stempel', ca >= r.zuege, [ca, r.zuege]);
    ok('P1.16 und jeder abgeschlossene Zug seinen Schluss-Stempel', cc >= r.zuege - 1, [cc, r.zuege]);
    // Die Uhr ist die verbrauchte Planungszeit - nicht die Wanduhr des Matches.
    let plan = 0;
    for (const k in (turns || {})) { const z = turns[k];
      if (z && typeof z.ca === 'number' && typeof z.cc === 'number' && z.cc > z.ca) plan += z.cc - z.ca; }
    r.planungsMs = plan;
    ok('P1.17 die verbrauchte Planungszeit deckt beide Zyklen', plan >= 60000, plan);
    r.passed = true;
    return r;
  } catch (e) { r.error = String((e && e.message) || e); throw e; }
}

// ══ P2: RESCUE WALL ═════════════════════════════════════════════════════════
async function scenarioWall(ctx) {
  const r = { name: 'rescue-wall', passed: false, pruefungen: [] };
  const ok = (n, c, i) => { r.pruefungen.push({ n, ok: !!c, i }); assert(c, n + (i !== undefined ? ' -> ' + JSON.stringify(i) : '')); };
  const [host, gast] = ctx.clients;
  const code = ctx.roomCode;
  try {
    const s0 = await par(host.page);
    const gen = s0.gen, zug = s0.turn;
    await warteAim([host, gast], zug);
    ok('P2.1 vor dem Schuss darf niemand setzen (Planungsphase)',
      (await host.page.evaluate(() => window.__ringoutE2E.canPlaceWall())) === false);
    // Ein echter Zug: der Host schiesst, der Gast bleibt stehen. Damit laeuft eine
    // Simulation, in der eine Wand ueberhaupt etwas bedeuten kann.
    await host.page.evaluate(() => window.__ringoutE2E.commitMove(120, 0, 0));
    await gast.page.evaluate(() => window.__ringoutE2E.commitReady());
    // Waehrend der Simulation die Wand setzen - ueber den echten Produktweg.
    const gesetzt = await H.poll(async () => {
      const s = await par(host.page);
      if (s.phase !== 'sim') return null;
      const erg = await host.page.evaluate(() => window.__ringoutE2E.placeWall(3));
      return erg === true ? true : null;
    }, 15000, 'Rescue Wall im laufenden Zug gesetzt');
    ok('P2.2 die Wand wurde im laufenden Zug gesetzt', gesetzt === true);
    const slot = await H.poll(async () => {
      const v = await H.dbRead(gast.page, 'rooms/' + code + '/g/' + gen + '/rw/' + zug + '/' + s0.seat);
      return (v && typeof v.k === 'number') ? v : null;
    }, 15000, 'der Gast liest denselben Wandslot');
    r.slot = slot;
    ok('P2.3 der Slot traegt Tick und Segment', Number.isInteger(slot.k) && slot.s === 3, slot);
    ok('P2.4 und gehoert dem setzenden Sitz',
      !(await H.dbRead(gast.page, 'rooms/' + code + '/g/' + gen + '/rw/' + zug + '/' + (1 - s0.seat))), null);
    await zugEnde([host, gast], zug, 60000);
    const a = await par(host.page), b = await par(gast.page);
    ok('P2.5 beide Clients sind nach der Wand identisch', gleich(a, b), [a, b]);
    ok('P2.6 der Einsatz ist auf beiden Seiten verbucht', a.stakes[s0.seat] === 2 && b.stakes[s0.seat] === 2, [a.stakes, b.stakes]);
    ok('P2.7 der Bestand des anderen Sitzes ist unberuehrt', a.stakes[1 - s0.seat] === 3 && b.stakes[1 - s0.seat] === 3, [a.stakes, b.stakes]);
    ok('P2.8 die Wand ist am Zugende vollstaendig weg', a.walls.length === 0 && b.walls.length === 0, [a.walls, b.walls]);
    ok('P2.9 und ihr Zeitplan ebenso', a.events.length === 0 && b.events.length === 0, [a.events, b.events]);
    // Zweite Wand im selben Zug: gesperrt (write-once je Zug und Sitz).
    const s1 = await par(host.page);
    await warteAim([host, gast], s1.turn);
    await host.page.evaluate(() => window.__ringoutE2E.commitMove(120, 0, 0));
    await gast.page.evaluate(() => window.__ringoutE2E.commitReady());
    const zweimal = await H.poll(async () => {
      const s = await par(host.page);
      if (s.phase !== 'sim') return null;
      const e1 = await host.page.evaluate(() => window.__ringoutE2E.placeWall(6));
      if (e1 !== true) return null;
      const e2 = await host.page.evaluate(() => window.__ringoutE2E.placeWall(7));
      return { e1, e2 };
    }, 15000, 'zweite Wand im selben Zug versucht');
    ok('P2.10 eine zweite Wand im selben Zug wird abgelehnt', zweimal.e2 === false, zweimal);
    await zugEnde([host, gast], s1.turn, 60000);
    const a2 = await par(host.page), b2 = await par(gast.page);
    ok('P2.11 auch danach sind beide Clients identisch', gleich(a2, b2), [a2, b2]);
    ok('P2.12 und genau zwei Einsaetze sind verbraucht', a2.stakes[s0.seat] === 1 && b2.stakes[s0.seat] === 1, [a2.stakes, b2.stakes]);
    r.passed = true;
    return r;
  } catch (e) { r.error = String((e && e.message) || e); throw e; }
}

// ══ P3: RULES ═══════════════════════════════════════════════════════════════
async function scenarioRules(ctx) {
  const r = { name: 'rules', passed: false, pruefungen: [] };
  const ok = (n, c, i) => { r.pruefungen.push({ n, ok: !!c, i }); assert(c, n + (i !== undefined ? ' -> ' + JSON.stringify(i) : '')); };
  const [host, gast] = ctx.clients;
  const code = ctx.roomCode;
  const schreib = (page, pfad, wert) => page.evaluate(({ p, v }) => window.FB.set(window.FB.ref(window.FB.db, p), v)
    .then(() => 'ok').catch((e) => String((e && (e.code || e.message)) || e)), { p: pfad, v: wert });
  let fenster = null;
  try {
    const s = await par(gast.page), h = await par(host.page);
    const gen = s.gen, zug = s.turn;
    const dicht = (x) => /permission|denied/i.test(String(x));
    // Jede dieser Abweisungen ist der ZWECK der Probe - sie wird vorher angemeldet,
    // damit die Diagnoseschranke sie nicht mit einem echten Fehler verwechselt und
    // umgekehrt keine unangemeldete Abweisung durchlaesst.
    const p = (x) => '/rooms/' + code + '/g/' + gen + x;
    fenster = H.beginProbeWindow(ctx.state, [
      p('/rw/' + zug + '/' + h.seat), p('/rw/' + zug + '/' + s.seat),
      p('/t/' + zug + '/cs'), p('/t/' + zug + '/ca'),
      p('/rw/' + zug + '/9'), '/rooms/' + code + '/g/' + (gen + 1) + '/rw/0/' + s.seat,
    ]);
    const a1 = await schreib(gast.page, 'rooms/' + code + '/g/' + gen + '/rw/' + zug + '/' + h.seat, { p: true });
    ok('P3.1 die Wand eines FREMDEN Sitzes darf niemand schreiben', dicht(a1), a1);
    const a2 = await schreib(gast.page, 'rooms/' + code + '/g/' + gen + '/rw/' + zug + '/' + s.seat, { k: 1, s: 99 });
    ok('P3.2 ein Segment ausserhalb 0..11 wird abgewiesen', dicht(a2), a2);
    const a3 = await schreib(gast.page, 'rooms/' + code + '/g/' + gen + '/rw/' + zug + '/' + s.seat, { k: 1, s: 3, p: true });
    ok('P3.3 Platzierung UND Aussage zugleich wird abgewiesen', dicht(a3), a3);
    const a4 = await schreib(gast.page, 'rooms/' + code + '/g/' + gen + '/t/' + zug + '/cs', 3);
    ok('P3.4 eine dritte Collapse-Stufe wird abgewiesen', dicht(a4), a4);
    const a5 = await schreib(gast.page, 'rooms/' + code + '/g/' + gen + '/t/' + zug + '/ca', 1);
    ok('P3.5 ein selbst erfundener Zeitstempel wird abgewiesen', dicht(a5), a5);
    const a6 = await schreib(gast.page, 'rooms/' + code + '/g/' + gen + '/rw/' + zug + '/9', { p: true });
    ok('P3.6 ein Sitz ausserhalb 0..4 wird abgewiesen', dicht(a6), a6);
    const a7 = await schreib(gast.page, 'rooms/' + code + '/g/' + (gen + 1) + '/rw/0/' + s.seat, { p: true });
    ok('P3.7 eine fremde Generation wird abgewiesen', dicht(a7), a7);
    r.passed = true;
    return r;
  } catch (e) { r.error = String((e && e.message) || e); throw e; }
  finally { H.endProbeWindow(fenster); }
}

// ══ P4: RUECKKEHR ═══════════════════════════════════════════════════════════
async function scenarioRejoin(ctx) {
  const r = { name: 'rueckkehr', passed: false, pruefungen: [] };
  const ok = (n, c, i) => { r.pruefungen.push({ n, ok: !!c, i }); assert(c, n + (i !== undefined ? ' -> ' + JSON.stringify(i) : '')); };
  const [host, gast] = ctx.clients;
  try {
    const vor = await par(gast.page), vorH = await par(host.page);
    await gast.page.reload({ waitUntil: 'domcontentloaded' });
    await gast.page.waitForFunction(() => window.__FB_READY === true && window.__ringoutE2E && window.__ringoutE2E.ready, null, { timeout: 30000 });
    // Die Rueckkehr ist im Produkt bewusst eine Entscheidung: nach dem Neuladen steht der
    // gemerkte Raum bereit, und der Spieler tippt auf ZURUECK INS MATCH. Genau dieser Weg
    // wird hier ausgeloest - kein Hilfskonstrukt.
    const gemerkt = await gast.page.evaluate(() => window.__ringoutE2E.savedRoom());
    ok('P4.0 der Raum ist nach dem Neuladen gemerkt', !!gemerkt && gemerkt.code === ctx.roomCode, gemerkt);
    // Die Rueckkehr muss im ERSTEN Anlauf gelingen. Sie tat das nicht, solange der
    // gen-Listener dieselbe Generation zusaetzlich startete (zwei Startvorgaenge melden
    // denselben Zugpfad an; die Datenbank brach mit einem internen Fehler ab und der
    // Rueckkehrer stand wieder bei Zug 0). Seit attemptRejoin runningGen vor dem
    // Anmelden der Listener setzt, gibt es genau EINEN Start - der Pruefstand haelt das
    // hier fest, damit ein Rueckfall sofort auffaellt.
    const anlaeufe = [];
    let rjErg = false;
    for (let n = 0; n < 2 && rjErg !== true; n++) {
      rjErg = await gast.page.evaluate(() => window.__ringoutE2E.rejoinSaved());
      anlaeufe.push({ n: n + 1, erg: rjErg, status: await gast.page.evaluate(() => ((document.getElementById('onStatus') || {}).textContent || '').trim()) });
    }
    r.rejoinAnlaeufe = anlaeufe;
    ok('P4.0b die Rueckkehr gelingt im ERSTEN Anlauf', rjErg === true && anlaeufe.length === 1, anlaeufe);
    const nach = await H.poll(async () => { const s = await par(gast.page); return (s && s.started === true) ? s : null; },
      60000, 'der Rueckkehrer ist wieder im Match');
    const nachH = await par(host.page);
    r.vor = vor; r.nach = nach;
    ok('P4.1 der Rueckkehrer steht wieder im laufenden Match', nach.started === true && nach.aktiv === true, nach);
    const spur = await gast.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ringout_diag')).log.filter((e) => e[1] === 'rocol' || e[1] === 'rowa'); } catch (_) { return null; } });
    r.spur = spur;
    ok('P4.2 auf derselben Collapse-Stufe', nach.stage === nachH.stage, { nach, nachH, spur });
    ok('P4.3 kein Sprung zurueck auf Stufe 0', nach.stage === vor.stage, [nach.stage, vor.stage]);
    ok('P4.4 mit demselben spielbaren Radius', nach.R === nachH.R, [nach.R, nachH.R]);
    ok('P4.5 mit demselben Wandbestand', JSON.stringify(nach.stakes) === JSON.stringify(nachH.stakes), [nach.stakes, nachH.stakes]);
    ok('P4.6 ohne Wand aus einem vergangenen Zug', nach.walls.length === 0 && nach.events.length === 0, [nach.walls, nach.events]);
    ok('P4.7 und mit demselben Punktestand', JSON.stringify(nach.score) === JSON.stringify(nachH.score), [nach.score, nachH.score]);
    // Der Zug danach laeuft wieder gemeinsam - der Rueckkehrer spielt mit.
    const s = await par(host.page);
    await warteAim([host, gast], s.turn, 60000);
    await H.sleep(500);
    for (const c of [host, gast]) await c.page.evaluate(() => window.__ringoutE2E.commitReady());
    await zugEnde([host, gast], s.turn, 60000);
    const a = await par(host.page), b = await par(gast.page);
    ok('P4.8 der naechste Zug laeuft auf beiden Seiten gleich', gleich(a, b), [a, b]);
    r.passed = true;
    return r;
  } catch (e) { r.error = String((e && e.message) || e); throw e; }
}

// ══ P5: REMATCH ═════════════════════════════════════════════════════════════
// Der Rematch laeuft ueber den echten onlineRematch()-Pfad (Generation + 1). Er ist
// hier auch ohne Matchende pruefbar: die neue Generation MUSS bei Stufe 0, voller
// Arena und vollem Wandbestand beginnen - genau das ist die Zusicherung.
async function scenarioRematch(ctx) {
  const r = { name: 'rematch', passed: false, pruefungen: [] };
  const ok = (n, c, i) => { r.pruefungen.push({ n, ok: !!c, i }); assert(c, n + (i !== undefined ? ' -> ' + JSON.stringify(i) : '')); };
  const [host, gast] = ctx.clients;
  const code = ctx.roomCode;
  try {
    const vor = await par(host.page);
    ok('P5.1 Vorbedingung: das Match steht auf Stufe 2 mit verbrauchten Einsaetzen',
      vor.stage === 2 && vor.stakes[vor.seat] < 3, [vor.stage, vor.stakes]);
    await host.page.evaluate(() => window.__ringoutE2E.rematch());
    const neu = await H.poll(async () => {
      const a = await par(host.page), b = await par(gast.page);
      return (a && b && a.gen === vor.gen + 1 && b.gen === vor.gen + 1 && a.started && b.started) ? [a, b] : null;
    }, 60000, 'beide Clients in der neuen Generation');
    const [a, b] = neu;
    ok('P5.2 beide Clients sind in der neuen Generation', a.gen === vor.gen + 1 && b.gen === vor.gen + 1, [a.gen, b.gen]);
    ok('P5.3 der Collapse beginnt wieder bei Stufe 0', a.stage === 0 && b.stage === 0, [a.stage, b.stage]);
    ok('P5.4 die Arena ist wieder vollstaendig', Math.abs(a.R - ctx.startR) < 0.02 && Math.abs(b.R - ctx.startR) < 0.02, [a.R, b.R, ctx.startR]);
    ok('P5.5 die Uhr laeuft wieder', a.state === 'running' && b.state === 'running' && a.rest > 0 && b.rest > 0, [a.state, a.rest]);
    ok('P5.6 der Wandbestand ist wieder voll', JSON.stringify(a.stakes) === JSON.stringify([3, 3]) && JSON.stringify(b.stakes) === JSON.stringify([3, 3]), [a.stakes, b.stakes]);
    ok('P5.7 keine alte Wand und kein alter Zeitplan', a.walls.length === 0 && a.events.length === 0 && b.walls.length === 0 && b.events.length === 0, [a.walls, a.events]);
    ok('P5.8 und keine Stufenmarke der neuen Generation',
      !(await H.dbRead(host.page, 'rooms/' + code + '/g/' + a.gen + '/t/0/cs')), null);
    ok('P5.9 beide Clients sind identisch', gleich(a, b), [a, b]);
    r.passed = true;
    return r;
  } catch (e) { r.error = String((e && e.message) || e); throw e; }
  finally {
    for (const c of ctx.clients || []) await closeClient(c, ctx);
  }
}

module.exports = { scenarioCollapse, scenarioWall, scenarioRules, scenarioRejoin, scenarioRematch, newClient, closeClient };
