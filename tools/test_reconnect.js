// Reconnect-Tests (v4) — Wiedereinstieg, Zustandswiederherstellung und der
// Zwei-Stufen-Collapse gegen die ECHTEN Kerne (functions/room-core.js +
// functions/clock-core.js) ueber tools/lib/fake-v4.js.
//
// Ersetzt vollstaendig die v3-Mechanik dieser Suite: stampOnlinePhase,
// onlineFold, onlineClock, onlineRevealBlocked, der Client-gen-Bump und das
// Client-Reclaim von p/<seat> existieren nicht mehr. An ihre Stelle treten
//   · Reconnect ueber iid, sess und roomActivateV4 (Sessionrotation)
//   · Live-Zustand ausschliesslich aus g/<gen>/live/clock
//   · Wiederherstellung aus den archivierten Ankern t/<turn>/c
//   · stage 0/1/2, Reconnect mitten in Zyklus 2, kein doppelter Collapse
//   · alte Generation unveraenderlich, Rematch bei stage 0 / remainingMs 30000
//   node tools/test_reconnect.js
'use strict';
const { makeDb, makeClient } = require('./lib/v4-client-harness.js');

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 2));
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
};
const attempt = async (fn) => {
  try { return { ok: true, val: await fn() }; }
  catch (e) { return { ok: false, code: String((e && e.code) || ''), msg: String((e && e.message) || e) }; }
};

// ── Match aufsetzen: 1v1 startet mit der Gast-Aktivierung automatisch ───────
async function duel(db) {
  const h = makeClient(db, 'X'), g = makeClient(db, 'X');
  h.setMenu('online'); h.setFmt('single');
  h.create(); await tick();
  const code = h.st().roomCode;
  g.setMenu('online'); g.join(code); await tick();
  return { h, g, code };
}
// Eine komplette Phase abwickeln: Deadline ueberschreiten, schliessen, beide
// melden ihr Ergebnis. Der Arbiter zieht dabei die verbrauchte Zeit ab und
// setzt an der Zyklusgrenze die Stufe — genau wie in Produktion.
async function playPhase(db, code, cs, next) {
  const iid = db.room(code).iid, gen = db.room(code).gen;
  const ck = db.clock(code, gen);
  if (!ck || ck.phase !== 'aim') return false;
  db.advance(7000);
  // Nach aufgebrauchtem Budget oeffnet der Arbiter UNGETIMTE Phasen
  // (deadlineAt === null). Die lassen sich per Konstruktion nicht ueber eine
  // Deadline schliessen — dort muessen alle zugberechtigten Seats wirklich
  // committen. Deshalb legt hier jeder Client zuerst seinen Zug.
  if (ck.deadlineAt == null) { for (const c of cs) await c.putSlot(ck.turn); }
  await cs[0].callV4('clockClose', { room: code, iid, session: cs[0].session(), phaseId: ck.phaseId }).catch(() => {});
  for (const c of cs) {
    await c.callV4('clockSettle', {
      room: code, iid, session: c.session(), phaseId: ck.phaseId,
      hash: 'h' + ck.turn, next: next || [0, 1],
    }).catch(() => {});
  }
  await tick();
  return true;
}
// So viele Phasen spielen, bis der Server die gewuenschte Stufe gesetzt hat.
async function playUntilStage(db, code, cs, stage, cap) {
  for (let i = 0; i < (cap || 20); i++) {
    const ck = db.clock(code, db.room(code).gen);
    if (ck && (ck.stage || 0) >= stage) return true;
    if (!(await playPhase(db, code, cs))) return false;
  }
  return (db.clock(code, db.room(code).gen).stage || 0) >= stage;
}

(async () => {
  // ── C1: Reconnect ueber iid + sess + roomActivateV4 ──────────────────────
  {
    const db = makeDb();
    const { h, g, code } = await duel(db);
    t('C1 Match laeuft', db.room(code).state === 'playing');
    const sessBefore = db.room(code).sess[1].active;
    const uid = g.uid(), pid = g.pid();
    // Browser weg: alle Listener sterben, der Client schreibt nichts.
    g.drop(); await tick();
    t('C1 die Session bleibt serverseitig bestehen', db.room(code).sess[1].active === sessBefore);
    t('C1 die Uhr laeuft unveraendert weiter', db.clock(code, 0).phase === 'aim');
    // Neuer Tab, SELBE Anonymous-UID und selbe dauerhafte Spieler-Id.
    const g2 = makeClient(db, 'X', pid, uid);
    const ok = await g2.rejoin(code); await tick();
    t('C1 Rejoin gelingt', ok === true);
    t('C1 derselbe Seat wird zurueckgegeben', g2.st().myPlayer === 1);
    t('C1 die Session wurde rotiert', db.room(code).sess[1].active !== sessBefore);
    t('C1 der Client fuehrt die neue Session', g2.session() === db.room(code).sess[1].active);
    t('C1 der Client fuehrt die Rauminstanz', g2.iid() === db.room(code).iid);
    t('C1 seatByUid bleibt bei derselben UID', db.room(code).seatByUid[uid] === 1);
    t('C1 der Client hat NICHTS selbst geschrieben (kein Reclaim)',
      db.writes().every((p) => !/\/p\/[0-4]$/.test(p) && !/\/players\/[0-4]$/.test(p)));
    t('C1 der Wiedereinsteiger ist im Match', g2.st().gameStarted === true);
    t('C1 die laufende Uhr wurde nicht zurueckgesetzt', db.clock(code, 0).turn === 0);
    // Der ALTE Tab hat sein Schreibrecht verloren.
    t('C1 der alte Tab haelt ein veraltetes Token', g.session() === sessBefore);
    const stale = await attempt(() => g.callV4('clockClose',
      { room: code, iid: db.room(code).iid, session: sessBefore, phaseId: db.clock(code, 0).phaseId }));
    t('C1 der alte Tab wird fail-closed abgewiesen', !stale.ok && stale.code === 'functions/permission-denied');
  }

  // ── C2: fremde Identitaet bekommt den Seat NICHT ─────────────────────────
  {
    const db = makeDb();
    const { code } = await duel(db);
    const intruder = makeClient(db, 'X');
    const ok = await intruder.rejoin(code); await tick();
    t('C2 fremder Rejoin auf einen vollen Raum scheitert', ok === false);
    t('C2 der Eindringling bleibt offline', intruder.st().online === false);
    t('C2 der Raum bleibt bei zwei Belegungen', Object.keys(db.room(code).seatByUid).length === 2);
  }

  // ── C3: Live-Zustand kommt ausschliesslich aus live/clock ────────────────
  {
    const db = makeDb();
    const { h, g, code } = await duel(db);
    const ck = db.clock(code, 0);
    t('C3 beide Clients sehen dieselbe phaseId',
      h.clock().phaseId === ck.phaseId && g.clock().phaseId === ck.phaseId);
    t('C3 beide sehen dieselbe Restzeit und Stufe',
      h.clock().remainingMs === ck.remainingMs && h.clock().stage === ck.stage
      && g.clock().remainingMs === ck.remainingMs);
    t('C3 Zugberechtigung kommt aus dem Anker',
      JSON.stringify(h.eligible()) === '[0,1]' && JSON.stringify(g.eligible()) === '[0,1]');
    t('C3 Eroeffnung: stage 0 und ein voller Zyklus', ck.stage === 0 && ck.remainingMs === 30000);
    t('C3 der Client fuehrt KEINE eigene Uhrfaltung mehr',
      h.clock().remainingMs === db.clock(code, 0).remainingMs);
  }

  // ── C4: zwei exakte 30-s-Zyklen, kein Ueberhang, kein dritter Collapse ───
  {
    const db = makeDb();
    const { h, g, code } = await duel(db);
    const cs = [h, g];
    t('C4 Stufe 1 wird erreicht', await playUntilStage(db, code, cs, 1));
    const s1 = db.clock(code, 0);
    t('C4 Zyklus 2 startet mit exakt 30 000 ms', s1.remainingMs === 30000);
    t('C4 der Server meldet Stufe 1', s1.stage === 1);
    t('C4 das Warnfenster ist zurueckgesetzt', s1.cracked === false);
    t('C4 die Uhr ist nach Stufe 1 nicht abgelaufen', s1.expired === false);
    // Die Anker der Historie zeigen den Stufensprung.
    const anchors = [];
    for (let turn = 0; turn < 20; turn++) {
      const hst = db.turn(code, 0, turn);
      if (!hst || !hst.c) break;
      anchors.push({ turn, stage: hst.c.stage, rem: hst.c.remainingAfter });
    }
    t('C4 jeder abgeschlossene Turn traegt einen Clock-Anker', anchors.length >= 4);
    t('C4 der Stufensprung ist im Anker sichtbar', anchors.some((a) => a.stage === 1));
    t('C4 kein Anker traegt eine negative Restzeit', anchors.every((a) => a.rem >= 0));
    t('C4 kein Anker ueberschreitet einen Zyklus', anchors.every((a) => a.rem <= 30000));
    t('C4 Stufe 2 wird erreicht', await playUntilStage(db, code, cs, 2));
    const s2 = db.clock(code, 0);
    t('C4 nach der letzten Stufe ist die Uhr terminal bei 0',
      s2.remainingMs === 0 && s2.expired === true);
    t('C4 die Stufe bleibt bei 2', s2.stage === 2);
    // Weiterspielen erzeugt KEINE dritte Stufe.
    await playPhase(db, code, cs); await playPhase(db, code, cs);
    const s3 = db.clock(code, 0);
    t('C4 es entsteht keine dritte Stufe', (s3.stage || 0) === 2);
    t('C4 die Restzeit bleibt 0', s3.remainingMs === 0);
    t('C4 Folgephasen laufen ungetimt weiter (kein Match-Abbruch)',
      s3.phase !== 'finished' ? s3.deadlineAt == null : true);
  }

  // ── C5: Reconnect MITTEN in Zyklus 2 ────────────────────────────────────
  {
    const db = makeDb();
    const { h, g, code } = await duel(db);
    const cs = [h, g];
    t('C5 Stufe 1 erreicht', await playUntilStage(db, code, cs, 1));
    await playPhase(db, code, cs);                  // mitten in Zyklus 2
    const before = db.clock(code, 0);
    t('C5 wir stehen in Zyklus 2', before.stage === 1 && before.remainingMs < 30000 && before.remainingMs > 0);
    const uid = g.uid(), pid = g.pid(), turnBefore = before.turn;
    g.drop(); await tick();
    const g2 = makeClient(db, 'X', pid, uid);
    const ok = await g2.rejoin(code); await tick();
    t('C5 Rejoin in Zyklus 2 gelingt', ok === true && g2.st().myPlayer === 1);
    const after = db.clock(code, 0);
    t('C5 die Uhr wurde NICHT zurueckgesetzt',
      after.stage === 1 && after.remainingMs === before.remainingMs && after.turn === turnBefore);
    t('C5 der Wiedereinsteiger uebernimmt Stufe 1 aus dem Anker', g2.clock().stage === 1);
    t('C5 er sieht dieselbe Restzeit wie der Server', g2.clock().remainingMs === after.remainingMs);
    t('C5 er sieht dieselbe phaseId wie der verbliebene Client',
      g2.clock().phaseId === h.clock().phaseId);
    t('C5 kein doppelter Collapse: der Zaehler passt zur Serverstufe',
      g2.st().gameStarted === true && after.stage === 1);
  }

  // ── C6: Wiederherstellung aus t/<turn>/c ────────────────────────────────
  {
    const db = makeDb();
    const { h, g, code } = await duel(db);
    const cs = [h, g];
    await playUntilStage(db, code, cs, 1);
    const anchors = [];
    for (let turn = 0; turn < 20; turn++) {
      const hst = db.turn(code, 0, turn);
      if (!hst || !hst.c) break;
      anchors.push(hst.c);
    }
    t('C6 die Historie ist lueckenlos archiviert', anchors.length >= 4);
    t('C6 jeder Anker traegt startedAt, usedMs, stage und remainingAfter',
      anchors.every((a) => typeof a.startedAt === 'number' && typeof a.usedMs === 'number'
        && typeof a.stage === 'number' && typeof a.remainingAfter === 'number'));
    t('C6 die Restzeit faellt monoton bis zur Stufengrenze',
      anchors.every((a, i) => i === 0 || a.stage > anchors[i - 1].stage || a.remainingAfter <= anchors[i - 1].remainingAfter));
    t('C6 der Stufensprung setzt die Restzeit auf einen vollen Zyklus',
      anchors.every((a, i) => i === 0 || !(a.stage > anchors[i - 1].stage) || a.remainingAfter === 30000));
    t('C6 die Historie enthaelt die gebuchten No-Shots',
      Object.keys(db.turn(code, 0, 0)).filter((k) => k !== 'c').length === 2);
    t('C6 kein Turn traegt einen v3-Phasenstempel', db.turn(code, 0, 0).s === undefined);
  }

  // ── C7: alte Generation ist unveraenderlich, Rematch startet neu ─────────
  {
    const db = makeDb();
    const { h, g, code } = await duel(db);
    const cs = [h, g];
    await playUntilStage(db, code, cs, 2);
    t('C7 beide Stufen sind gefallen', db.clock(code, 0).stage === 2);
    // Generation beenden: niemand mehr zugberechtigt.
    await playPhase(db, code, cs, []);
    t('C7 die Generation ist beendet', db.clock(code, 0).phase === 'finished');
    const histBefore = JSON.stringify(db.turn(code, 0, 0));
    const clockBefore = JSON.stringify(db.clock(code, 0));
    h.rematch(); await tick();
    t('C7 die Generation ist um genau 1 gestiegen', db.room(code).gen === 1);
    const nc = db.clock(code, 1);
    t('C7 der Rematch setzt stage auf 0', nc.stage === 0);
    t('C7 der Rematch setzt remainingMs auf 30000', nc.remainingMs === 30000);
    t('C7 cracked und expired sind zurueckgesetzt', nc.cracked === false && nc.expired === false);
    t('C7 die neue Generation traegt eine neue phaseId', nc.phaseId === '1:0');
    t('C7 live/slots der neuen Generation ist leer', db.slots(code, 1) == null);
    t('C7 die alte Historie ist byte-identisch', JSON.stringify(db.turn(code, 0, 0)) === histBefore);
    t('C7 die alte Uhr ist byte-identisch', JSON.stringify(db.clock(code, 0)) === clockBefore);
    t('C7 die Clients folgen der neuen Generation',
      h.st().runningGen === 1 && h.clock() && h.clock().stage === 0);
    t('C7 der Collapse-Zaehler der neuen Generation ist 0', h.st().gen === 1);
    // Ein zweiter Rematch gegen dieselbe expectedGen ist idempotent.
    const c1 = JSON.stringify(db.clock(code, 1));
    h.rematch(); await tick();
    t('C7 wiederholter Rematch setzt die neue Uhr nicht zurueck', JSON.stringify(db.clock(code, 1)) === c1);
    t('C7 wiederholter Rematch erzeugt keine dritte Generation', db.room(code).gen === 1);
  }

  // ── C8: Reconnect nach dem Rematch landet in der NEUEN Generation ────────
  {
    const db = makeDb();
    const { h, g, code } = await duel(db);
    const cs = [h, g];
    await playUntilStage(db, code, cs, 2);
    await playPhase(db, code, cs, []);
    h.rematch(); await tick();
    t('C8 neue Generation laeuft', db.room(code).gen === 1 && db.clock(code, 1).stage === 0);
    const uid = g.uid(), pid = g.pid();
    g.drop(); await tick();
    const g2 = makeClient(db, 'X', pid, uid);
    const ok = await g2.rejoin(code); await tick();
    t('C8 Rejoin nach Rematch gelingt', ok === true && g2.st().myPlayer === 1);
    t('C8 der Wiedereinsteiger sieht die NEUE Generation', g2.st().gen === 1);
    t('C8 er startet bei stage 0 mit vollem Zyklus',
      g2.clock() && g2.clock().stage === 0 && g2.clock().remainingMs === 30000);
    t('C8 er sieht nicht die alte Generation', g2.clock().phaseId === '1:0');
  }

  console.log('\nReconnect-B2: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
