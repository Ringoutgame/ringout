// Multi-Client-Flow-Tests (v4) — treibt die ECHTEN Online-Funktionen aus
// index.html (createRoom/joinRoom/startFfaMatch/attachRoomListeners/
// attachClockListener/onlineArmTurn/onlineTurnValue/writeTurnSlot/leaveOnline/…)
// gegen die gemeinsame v4-Schicht aus tools/lib/fake-v4.js.
//
// Die frueheren v3-Nachbauten (Seat-Claiming, Presence-Writes, Rules-Mirror,
// Leave-Sentinel) sind ersatzlos entfallen: die Fake-Schicht fahrt den ECHTEN
// room-core.js/clock-core.js, also entscheiden Seatvergabe, Sessionrotation,
// Matchstart, Uhr und Historie hier genau so wie in Produktion.
//
// Geprueft wird deshalb nicht mehr, WAS der Client schreibt, sondern
//   (1) welche Callables er mit welchen Argumenten aufruft,
//   (2) welche Datenlage daraus serverseitig entsteht,
//   (3) dass er auf server-owned Pfade NICHTS mehr schreibt.
// Die Spielsimulation (newGame/beginReveal) bleibt gestubbt — Physik deckt die
// Golden-Suite ab; hier geht es um Lobby, Start, Lockstep, Disconnect, Rematch
// mit 2..5 Clients.
//   node tools/test_ffa_flow.js
// Der Client-Sandkasten (Extraktion aus index.html + Fake-v4-Anbindung) liegt
// gemeinsam in tools/lib/v4-client-harness.js — Flow, Race und Reconnect
// teilen ihn sich, damit es nur EINE Stelle gibt, die den v4-Vertrag abbildet.
const { makeDb, makeClient } = require('./lib/v4-client-harness.js');

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 2));
  for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
};

// ── Szenario-Helfer ──────────────────────────────────────────────────────────
// Jede UID sitzt auf genau EINEM Seat, und der Index stimmt mit players ueberein.
function uniqueSeats(room) {
  if (!room || !room.seatByUid) return false;
  const seats = Object.values(room.seatByUid);
  if (new Set(seats).size !== seats.length) return false;
  for (const uid of Object.keys(room.seatByUid)) {
    const s = room.seatByUid[uid];
    if (!room.players || !room.players[s] || room.players[s].uid !== uid) return false;
  }
  return true;
}

(async () => {
  // Der Raumcode kommt in v4 vom SERVER — der Client kennt ihn erst, nachdem
  // roomCreateV4 geantwortet hat.
  const codeOf = (c) => c.st().roomCode;
  // Lobby aufbauen: Host erstellt, Gaeste treten bei. Rueckgabe = Raumcode.
  async function lobby(db, host, guests) {
    host.create(); await tick();
    const code = codeOf(host);
    for (const g of guests) { g.setMenu('online'); g.join(code); await tick(); }
    return code;
  }
  // Bringt die laufende Generation regulaer zu Ende: Deadline ueberschreiten,
  // Phase schliessen lassen, dann melden beide Seiten "niemand mehr
  // zugberechtigt" — der Arbiter beendet die Partie mit reason 'complete'.
  async function finishGeneration(db, code, clients) {
    const room = db.room(code), gen = room.gen, iid = room.iid;
    const ck = db.clock(code, gen);
    db.advance(8000);                                  // Zugfenster ueberschritten
    await clients[0].callV4('clockClose', { room: code, iid, session: clients[0].session(), phaseId: ck.phaseId }).catch(() => {});
    for (const c of clients) {
      await c.callV4('clockSettle', {
        room: code, iid, session: c.session(), phaseId: ck.phaseId, hash: 'endhash1', next: [],
      }).catch(() => {});
    }
    await tick();
  }

  // ── S1: 3-Spieler-Lobby -> Start -> Lockstep -> Reveal ────────────────────
  {
    const db = makeDb();
    const [h, g1, g2] = [makeClient(db, 'X'), makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3);
    const code = await lobby(db, h, [g1, g2]);
    const room = db.room(code);
    t('S1 Raum vom Server erstellt (v4, Lobby, ffa)',
      !!room && room.v === 4 && room.state === 'lobby' && room.config.fmt === 'ffa');
    t('S1 Raum traegt eine server-generierte iid', typeof room.iid === 'string' && room.iid.length > 0);
    t('S1 Client kennt die Rauminstanz', h.iid() === room.iid);
    t('S1 Host-Session ist aktiv (sess/0)', !!room.sess && typeof room.sess[0].active === 'string');
    t('S1 Client fuehrt genau dieses Session-Token', h.session() === room.sess[0].active);
    t('S1 seatByUid ist server-owned', room.seatByUid[h.uid()] === 0);
    t('S1 Host-Rosterrecord traegt pid und uid',
      room.players[0].id === h.pid() && room.players[0].uid === h.uid());
    t('S1 Gaeste bekommen Seat 1 und 2 vom Server',
      g1.st().myPlayer === 1 && g2.st().myPlayer === 2 && g1.st().mode === 'ffa');
    t('S1 seatByUid deckt alle drei UIDs',
      db.room(code).seatByUid[g1.uid()] === 1 && db.room(code).seatByUid[g2.uid()] === 2);
    t('S1 jede UID sitzt auf genau einem Seat', uniqueSeats(db.room(code)));
    t('S1 Lobbyzaehler 3/5', h.els.lobbyCount.textContent === '3/5');
    t('S1 Gast sieht keinen Startknopf',
      g1.els.lobbyStart.style.display === 'none' && g1.els.lobbyHint.textContent === 'Warte auf Host…');
    t('S1 Host-Start ist freigegeben',
      h.els.lobbyStart.style.display === '' && h.els.lobbyStart.disabled === false);

    h.clickStart(); await tick();
    const r2 = db.room(code);
    t('S1 Server setzt state und seats', r2.state === 'playing' && r2.seats === 3);
    t('S1 alle Clients gestartet, ffaN=3',
      [h, g1, g2].every((c) => c.st().gameStarted && c.st().ffaN === 3 && c.st().phase === 'aim'));
    const ck = db.clock(code, 0);
    t('S1 Server hat live/clock eroeffnet', !!ck && ck.phase === 'aim' && ck.turn === 0);
    t('S1 Eroeffnungsanker: stage 0, ein voller Zyklus', ck.stage === 0 && ck.remainingMs === 30000);
    t('S1 eligibleSeats deckt alle drei Seats', ck.eligibleSeats === '0,1,2');
    t('S1 alle Clients sehen dieselbe Uhr',
      [h, g1, g2].every((c) => c.clock() && c.clock().phaseId === ck.phaseId));
    t('S1 Sichtrotation je Seat (eigene Kugel unten)',
      h.va() === 0 && g1.va() === -(1 * 2 * Math.PI / 3) && g2.va() === -(2 * 2 * Math.PI / 3));

    // Zugpfad: ausschliesslich live/slots, mit sid und Turnnummer.
    t('S1 Commits gehen durch', h.commitMove() === true && g1.commitMove() === true);
    await tick();
    const sl = db.slots(code, 0) || {};
    t('S1 Zug landet in live/slots/<seat>', !!sl[0] && !!sl[1]);
    t('S1 Slot traegt die Turnnummer', sl[0].t === 0 && sl[1].t === 0);
    t('S1 Slot traegt das Session-Token (sid)',
      sl[0].sid === db.room(code).sess[0].active && sl[1].sid === db.room(code).sess[1].active);
    t('S1 keine v4-Historie solange die Phase offen ist', db.turn(code, 0, 0) == null);
    t('S1 Reveal wartet auf den letzten Spieler', h.st().phase === 'aim');
    g2.commitMove(); await tick();
    t('S1 alle im Reveal nach dem letzten Commit', [h, g1, g2].every((c) => c.st().phase === 'reveal'));

    // Kein Clientwrite auf server-owned Pfade.
    t('S1 kein Client schreibt live/clock', db.writes().every((p) => !/\/live\/clock/.test(p)));
    t('S1 kein Client schreibt in die Historie t/<turn>',
      db.writes().every((p) => !/\/g\/\d+\/t\//.test(p)));
    t('S1 kein Client schreibt sess oder seatByUid',
      db.writes().every((p) => !/\/(sess|seatByUid)(\/|$)/.test(p)));
    t('S1 Clientwrites betreffen ausschliesslich live/slots',
      db.writes().filter((p) => /^rooms\//.test(p)).every((p) => /\/live\/slots\/[0-4]$/.test(p)));
  }

  // ── S2: fuenf Spieler, sechster wird abgewiesen ───────────────────────────
  {
    const db = makeDb();
    const cs = [0, 1, 2, 3, 4, 5].map(() => makeClient(db, 'X'));
    cs[0].setMenu('ffa', 5);
    const code = await lobby(db, cs[0], cs.slice(1, 5));
    t('S2 Seats 1-4 vom Server vergeben',
      cs[1].st().myPlayer === 1 && cs[2].st().myPlayer === 2 && cs[3].st().myPlayer === 3 && cs[4].st().myPlayer === 4);
    t('S2 fuenf eindeutige Seats', uniqueSeats(db.room(code)));
    cs[5].setMenu('online'); cs[5].join(code); await tick();
    t('S2 sechster Beitritt abgewiesen', cs[5].st().online === false);
    t('S2 Raum bleibt bei fuenf Sessions', Object.keys(db.room(code).sess).length === 5);
    cs[0].clickStart(); await tick();
    t('S2 mit fuenf gestartet', db.room(code).seats === 5 && cs.slice(0, 5).every((c) => c.st().gameStarted));
    t('S2 alle fuenf Seats zugberechtigt', db.clock(code, 0).eligibleSeats === '0,1,2,3,4');
  }

  // ── S3: Beitritt nach Matchstart wird abgewiesen ──────────────────────────
  {
    const db = makeDb();
    const [h, g1, late] = [makeClient(db, 'X'), makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3);
    const code = await lobby(db, h, [g1]);
    h.clickStart(); await tick();
    late.setMenu('online'); late.join(code); await tick();
    t('S3 Beitritt nach Start abgewiesen', late.st().online === false);
    t('S3 der laufende Raum bleibt bei zwei Sessions', Object.keys(db.room(code).sess).length === 2);
    t('S3 die Uhr des laufenden Matches ist unberuehrt', db.clock(code, 0).eligibleSeats === '0,1');
  }

  // ── S4: Startsperre bei Sitzluecke, Freigabe nach Auffuellen ──────────────
  {
    const db = makeDb();
    const [h, g1, g2] = [makeClient(db, 'X'), makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3);
    const code = await lobby(db, h, [g1, g2]);
    g1.leave(); await tick();                          // Luecke auf Seat 1
    t('S4 Luecke sperrt den Start', h.els.lobbyStart.disabled === true);
    t('S4 Luecken-Hinweis sichtbar',
      h.els.lobbyHint.textContent === 'Sitzlücke: Warte auf freien Sitz / Spieler soll neu beitreten.');
    db.clearCalls();
    h.clickStart(); await tick();
    t('S4 gesperrter Start ruft kein roomStartV4',
      db.calls().every((c) => c.name !== 'roomStartV4'));
    t('S4 Raum bleibt in der Lobby', db.room(code).state === 'lobby');
    const g3 = makeClient(db, 'X'); g3.setMenu('online'); g3.join(code); await tick();
    t('S4 neuer Spieler bekommt den freien Seat 1', g3.st().myPlayer === 1);
    h.clickStart(); await tick();
    t('S4 Start nach gefuellter Luecke', db.room(code).state === 'playing' && db.room(code).seats === 3);
  }

  // ── S5: Gast verlaesst die Lobby -> Session serverseitig freigegeben ──────
  {
    const db = makeDb();
    const [h, g1] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3);
    const code = await lobby(db, h, [g1]);
    const guestUid = g1.uid();
    t('S5 Gast ist im FFA-Modus in der Lobby', g1.st().mode === 'ffa' && g1.st().online === true);
    g1.setMenu('bot', 2);
    g1.leave(); await tick();
    t('S5 Gast ist offline', g1.st().online === false && g1.st().roomCode === '');
    t('S5 Menuezustand wiederhergestellt', g1.st().mode === 'bot' && g1.st().ffaN === 2);
    t('S5 Client haelt keine Session mehr', g1.session() === '' && g1.iid() === '');
    const r = db.room(code);
    t('S5 Session des Gasts serverseitig freigegeben', !r.sess || !r.sess[1] || r.sess[1].active == null);
    t('S5 seatByUid des Gasts geraeumt', !r.seatByUid || r.seatByUid[guestUid] === undefined);
    t('S5 Host bleibt unberuehrt', h.st().online === true && r.sess[0].active === h.session());
    t('S5 der Client hat den Seat NICHT selbst geloescht',
      db.writes().every((p) => !/\/players\/[0-4]$/.test(p) && !/\/p\/[0-4]$/.test(p)));
  }

  // ── S8: Late-Join-Race — der Start friert die Seatzahl ein ────────────────
  {
    const db = makeDb();
    const [h, g1, g2] = [makeClient(db, 'X'), makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3);
    const code = await lobby(db, h, [g1]);
    h.clickStart();
    g2.setMenu('online'); g2.join(code);
    await tick(); await tick();
    t('S8 der Server friert seats beim Start ein', db.room(code).seats === 2);
    t('S8 Match laeuft fuer Seat 0 und 1', db.clock(code, 0).eligibleSeats === '0,1');
    t('S8 der zu spaete Client ist nicht im Match', g2.st().gameStarted === false);
  }

  // ── S9: 1v1 startet automatisch mit der Gast-Aktivierung ─────────────────
  {
    const db = makeDb();
    const [h, g] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('online'); h.setFmt('single');
    h.create(); await tick();
    const code = codeOf(h);
    t('S9 1v1-Raum in der Lobby erstellt',
      db.room(code).state === 'lobby' && db.room(code).config.fmt === 'single' && db.room(code).v === 4);
    g.setMenu('online'); g.join(code); await tick();
    t('S9 Gast-Aktivierung startet das Match serverseitig', db.room(code).state === 'playing');
    t('S9 kein seats-Feld bei 1v1', db.room(code).seats === undefined);
    t('S9 beide gestartet', h.st().gameStarted && g.st().gameStarted && g.st().myPlayer === 1);
    t('S9 Uhr mit stage 0 und vollem Zyklus',
      db.clock(code, 0).stage === 0 && db.clock(code, 0).remainingMs === 30000);
    t('S9 beide Seats zugberechtigt', db.clock(code, 0).eligibleSeats === '0,1');
    g.drop(); await tick();
    t('S9 Host bleibt im Match', h.st().gameStarted === true);
    t('S9 die Uhr laeuft unveraendert weiter', db.clock(code, 0).phase === 'aim');
  }

  // ── S10: eliminierter Seat blockiert die Folgephase nicht ─────────────────
  {
    const db = makeDb();
    const [h, g1, g2] = [makeClient(db, 'X'), makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3);
    const code = await lobby(db, h, [g1, g2]);
    h.clickStart(); await tick();
    [h, g1, g2].forEach((c) => c.kill(2));
    t('S10 eliminierter Seat kann nicht zielen', g2.canAim() < 0);
    t('S10 naechste Zugberechtigung schliesst den eliminierten Seat aus',
      JSON.stringify(h.nextEligible()) === '[0,1]');
    t('S10 alle Clients leiten dieselbe Folgeberechtigung ab',
      JSON.stringify(g1.nextEligible()) === JSON.stringify(h.nextEligible()));
    t('S10 die LAUFENDE Phase behaelt ihre Zugberechtigung',
      db.clock(code, 0).eligibleSeats === '0,1,2');
  }

  // ── S7: Rematch ist serverautoritativ ────────────────────────────────────
  {
    const db = makeDb();
    const [h, g] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('online'); h.setFmt('single');
    h.create(); await tick();
    const code = codeOf(h);
    g.setMenu('online'); g.join(code); await tick();
    t('S7 Match laeuft', db.room(code).state === 'playing');
    const genBefore = db.room(code).gen;
    h.rematch(); await tick();
    t('S7 Rematch aus laufender Partie wird abgelehnt', db.room(code).gen === genBefore);
    t('S7 der Client hat gen nicht selbst geschrieben',
      db.writes().every((p) => !/^rooms\/[A-Z0-9]{4}\/gen$/.test(p)));
    await finishGeneration(db, code, [h, g]);
    t('S7 Generation ist beendet', db.clock(code, 0).phase === 'finished');
    h.rematch(); await tick();
    const ng = genBefore + 1;
    t('S7 Rematch erhoeht die Generation um genau 1', db.room(code).gen === ng);
    const nc = db.clock(code, ng);
    t('S7 neue Generation: stage 0 und voller Zyklus', !!nc && nc.stage === 0 && nc.remainingMs === 30000);
    t('S7 neue Generation: frische phaseId', nc.phaseId === ng + ':0');
    t('S7 neue Generation: leere live/slots', db.slots(code, ng) == null);
    t('S7 alte Generation unveraendert', db.clock(code, 0).phase === 'finished');
  }

  // ── S11: Callable-Retries sind idempotent ────────────────────────────────
  {
    const db = makeDb();
    const h = makeClient(db, 'X');
    const [a, b] = await h.callTwice('roomCreateV4', {
      config: { winTarget: 3, fmt: 'ffa', visibility: 'private' },
      pid: 'PIDRETRY01', tab: 'TABRETRY01', name: 'Retry',
    });
    t('S11 Retry liefert denselben Raum', a.room === b.room && typeof a.room === 'string');
    t('S11 Retry liefert dieselbe Rauminstanz', a.iid === b.iid);
    t('S11 Retry erzeugt keinen zweiten Raum', Object.keys(db.data.rooms).length === 1);
    t('S11 Retry vergibt keinen zweiten Seat', Object.keys(db.room(a.room).sess).length === 1);
    const act1 = await h.callV4('roomActivateV4', { room: a.room, iid: a.iid, token: a.token, leaseId: a.leaseId });
    const act2 = await h.callV4('roomActivateV4', { room: a.room, iid: a.iid, token: act1.token, leaseId: a.leaseId });
    t('S11 doppelte Aktivierung bleibt bei einer aktiven Session',
      act2.token === act1.token && db.room(a.room).sess[0].active === act1.token);
  }

  // ── S12: Formate — TRIPLE FFA und TEAM DUEL ──────────────────────────────
  {
    for (const [f, n] of [['triple_ffa', 3], ['team_duel', 4]]) {
      const db = makeDb();
      const cs = Array.from({ length: n }, () => makeClient(db, 'X'));
      cs[0].setMenu('ffa', n); cs[0].setFmt(f);
      const code = await lobby(db, cs[0], cs.slice(1));
      t(f + ': Raum traegt das Format', db.room(code).config.fmt === f);
      t(f + ': alle ' + n + ' Seats eindeutig vergeben', uniqueSeats(db.room(code)));
      cs[0].clickStart(); await tick();
      t(f + ': Server startet mit seats=' + n, db.room(code).state === 'playing' && db.room(code).seats === n);
      t(f + ': alle Seats zugberechtigt',
        db.clock(code, 0).eligibleSeats === Array.from({ length: n }, (_, i) => i).join(','));
      t(f + ': Eroeffnung mit stage 0 und vollem Zyklus',
        db.clock(code, 0).stage === 0 && db.clock(code, 0).remainingMs === 30000);
    }
  }

  // ── S13: Host verlaesst die Lobby -> Raum ist tot, Gaeste steigen aus ─────
  {
    const db = makeDb();
    const [h, g1] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3);
    const code = await lobby(db, h, [g1]);
    t('S13 Gast ist in der Lobby', g1.st().online === true);
    h.leave(); await tick();
    t('S13 Host-Session serverseitig freigegeben',
      !db.room(code) || !db.room(code).sess || !db.room(code).sess[0] || db.room(code).sess[0].active == null);
    t('S13 der Host hat den Raum NICHT selbst geloescht',
      db.writes().every((p) => !/^rooms\/[A-Z0-9]{4}$/.test(p)));
    t('S13 Host ist offline und im Menuezustand', h.st().online === false && h.st().roomCode === '');
  }

  // ── S14: Namen und Roster ────────────────────────────────────────────────
  {
    const db = makeDb();
    const [h, g1] = [makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3);
    h.setName('Alice');
    const code = await lobby(db, h, [g1]);
    t('S14 der Name wandert beim Create in den Roster', db.room(code).players[0].name === 'Alice');
    t('S14 der Host sieht seinen eigenen Namen', h.nameFor(0) === 'Alice');
    t('S14 der Gast sieht den Hostnamen ueber den Roster-Listener', g1.nameFor(0) === 'Alice');
    t('S14 ohne eigenen Namen faellt der Gast auf einen Vorgabenamen zurueck',
      typeof db.room(code).players[1].name === 'string' && db.room(code).players[1].name.length >= 1);
    t('S14 der Roster traegt fuer jeden Seat die UID',
      db.room(code).players[0].uid === h.uid() && db.room(code).players[1].uid === g1.uid());
  }

  // ── S15: In-Match-Leave -> die Uebrigen spielen weiter ───────────────────
  {
    const db = makeDb();
    const [h, g1, g2] = [makeClient(db, 'X'), makeClient(db, 'X'), makeClient(db, 'X')];
    h.setMenu('ffa', 3);
    const code = await lobby(db, h, [g1, g2]);
    h.clickStart(); await tick();
    t('S15 Match laeuft mit drei Seats', db.clock(code, 0).eligibleSeats === '0,1,2');
    g1.leave(); await tick();
    t('S15 der Verlassende ist offline', g1.st().online === false);
    t('S15 die Uebrigen bleiben im Match', h.st().gameStarted === true && g2.st().gameStarted === true);
    t('S15 die laufende Phase behaelt ihre Zugberechtigung',
      db.clock(code, 0).eligibleSeats === '0,1,2');
    t('S15 kein Client hat einen Ersatzzug fuer den fremden Seat geschrieben',
      db.writes().every((p) => !/\/live\/slots\/1$/.test(p)));
    t('S15 die Uebrigen koennen weiter committen',
      h.commitMove() === true && g2.commitMove() === true);
  }

  console.log('\nFFA-Online-Flow: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
