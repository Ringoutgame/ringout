'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// RingOut — serverseitiger Action-Clock-Arbiter (Kernlogik, dependency-injiziert).
//
// Vertrag (identisch zum lokalen Offline-Vertrag in index.html):
//   - 60 s globale aktive Matchzeit, 7 s maximale Entscheidungszeit je Aim-Phase
//   - die globale Uhr laeuft NUR waehrend 'aim' (resolving/Physik pausiert)
//   - Timeout erzeugt verbindliche No-Shots (Impuls 0), verspaetete Moves
//     verlieren doppelt: Rules-Deadline UND belegter Write-once-Slot
//   - Cracked bei <= 10 s Restzeit genau einmal, Expired bei 0 genau einmal
//   - nach Expired laufen Folgephasen OHNE Deadline weiter (kein Match-Abbruch)
//
// ── Datenlage (Phase IIIA): begrenzter aktiver Live-State ────────────────────
//   rooms/<code>/seatByUid/<uid> = <seat>   server-owned UID->Seat-Index
//   rooms/<code>/g/<gen>/live = { clock, slots }   NUR die aktuelle Phase
//   rooms/<code>/g/<gen>/t/<turn>           unveraenderliche Turn-Historie
//
// live enthaelt ausschliesslich die aktuelle Phase (eine Clock, hoechstens
// fuenf Slots, hoechstens fuenf Settlement-Reports) und waechst NICHT mit der
// Matchdauer. clockClose() transaktioniert AUSSCHLIESSLICH live — nie mehr den
// gesamten Generations-Subtree mit seiner wachsenden Turn-Historie. Clock und
// aktive Slots liegen im selben Knoten, damit "fehlende Slots fuellen UND
// Phase schliessen" weiterhin EIN atomarer Schreibvorgang ist.
//
// ── Crash-sichere Historienarchivierung ──────────────────────────────────────
// Weil live und t/<turn> getrennte Knoten sind, ist der Phasenabschluss ein
// idempotenter Zwei-Schritt mit explizitem Zwischenzustand:
//   1. clockClose: EINE Transaction auf live — finalisiert alle Slots,
//      wechselt auf 'resolving' und markiert archived:false (archivePending).
//   2. ensureArchived: schreibt die finalisierten Slots write-once nach
//      t/<turn> (identischer Retry ist idempotent, abweichender Inhalt ist ein
//      kontrollierter Desync) und bestaetigt danach archived:true in live.
// Bricht der Prozess zwischen den Schritten ab, repariert der NAECHSTE
// clockClose()- oder clockSettle()-Aufruf den Zustand: beide pruefen auf
// phase 'resolving' + archived!==true und holen die Archivierung nach. Eine
// Folgephase wird NIE ohne bestaetigte Archivierung eroeffnet (Guard in der
// Settle-Transaction) — kein doppelter, kein verlorener History-Turn.
//
// ── UID-/Seat-Eindeutigkeit: rooms/<code>/seatByUid ──────────────────────────
// seatOfUid() waehlt NIE mehr "den niedrigsten passenden Seat": der server-
// owned Index seatByUid/<uid> ist die einzige Quelle der Seat-Zuordnung. Ein
// Besitz gilt nur, wenn Indexeintrag UND players/<seat>/uid uebereinstimmen
// und die UID in keinem weiteren Seat vorkommt — jeder inkonsistente oder
// mehrdeutige Zustand ist fail-closed (permission/failed-precondition). Der
// Index ist fuer Clients vollstaendig read-only; seine Erstellung uebernehmen
// die Room-Create-/Join-Callables in Phase IIIB.
//
// ── Gen-Haertung ─────────────────────────────────────────────────────────────
// room.gen ist bei Protokoll v4 fuer Clients gesperrt (Rules). clockStart
// akzeptiert ausschliesslich die aktuelle room.gen (ein mitgesendetes gen-
// Argument muss exakt passen) und setzt eine bestehende Clock derselben
// Generation NIEMALS zurueck — remainingMs/cracked/expired bleiben erhalten.
// Der legitime Rematch-/New-Generation-Uebergang folgt serverseitig in IIIB/IV.
//
// Autoritaet: AUSSCHLIESSLICH dieser Arbiter schreibt live/clock, t/<turn>
// (v4) und seatByUid — die Rules verweigern jeden Client-Write; der Admin-SDK-
// Zugriff hier umgeht die Rules. Alle Zeitpunkte (startedAt/deadlineAt/crackAt/
// expiresAt/closedAt/settleDeadlineAt) sind absolute, vorberechnete SERVER-
// Zeiten: der Arbiter braucht keine Timer und keinen Scheduler — jeder Client
// darf close/settle jederzeit "anstossen", der Server validiert lazy gegen
// seine eigene Uhr und die Transactions erzwingen Idempotenz.
//
// ── Zugberechtigung: clock.eligibleSeats ─────────────────────────────────────
// Welche Seats eine Phase ueberhaupt betrifft, entscheidet der Server und nur er:
// eligibleSeats ist fuer die Dauer einer Phase unveraenderlich, wird beim Start
// aus dem v4-Roster abgeleitet und danach ausschliesslich per Settlement-Konsens
// fortgeschrieben (jeder Report traegt nextEligibleSeats). Damit blockiert ein
// eliminierter, aber noch verbundener Seat die naechste Runde nicht, bekommt
// keinen Timeout-No-Shot und kostet die globale Uhr keine 7 Sekunden.
// WICHTIG: Presence entscheidet hier NICHTS. Ein vor der Transaction gelesener
// Presence-Snapshot ist per Definition veraltbar; fehlende Slots werden IMMER
// als {ns:'stand'} gebucht.
//
// Grenze des Verfahrens: Settlement-Konsens ERKENNT Desyncs (abweichende Hashes
// oder abweichende nextEligibleSeats -> phase 'finished'/reason 'desync'), er ist
// aber KEIN kryptografischer Beweis einer korrekten Simulation. Einigen sich alle
// zugberechtigten Clients auf dasselbe falsche Ergebnis, uebernimmt der Server es.
//
// Dependency Injection ({db, now}) haelt den Kern frei von firebase-functions:
// die Emulator-Suite (tools/test_action_clock.js) treibt EXAKT diesen Code mit
// injizierter Zeit gegen den echten RTDB-Emulator; index.js ist nur der duenne
// onCall-Mantel (Auth-Pflicht + Fehlercode-Mapping).
// ─────────────────────────────────────────────────────────────────────────────

// ── Zwei-Stufen-Collapse: der Stufenvertrag liegt HIER, nicht im Client ──────
// Die Matchzeit ist kein einzelnes 60-s-Budget mehr, sondern STAGE_COUNT Zyklen
// à CYCLE_MS. clock.remainingMs ist immer die Restzeit des LAUFENDEN Zyklus,
// clock.stage die Zahl der vollzogenen Collapse-Stufen. Beim Ablauf eines Zyklus
// steigt stage, remainingMs wird exakt auf CYCLE_MS zurueckgesetzt und cracked
// faellt fuer das neue Warnfenster zurueck.
//
// Der Ueberhang, den die frühere clientseitige Uhr nachtraeglich wegrechnen
// musste, kann hier gar nicht entstehen: das Zugfenster ist immer
// min(TURN_LIMIT_MS, remainingMs) und die Rules lassen einen Slot-Write nur bis
// clock.deadlineAt zu — Buchung und Schreibgate benutzen DIESELBE Deadline.
// Ein Turn kann eine Stufengrenze damit nicht ueberziehen, und Zyklus 2 beginnt
// serverautoritativ immer mit exakt CYCLE_MS.
const CYCLE_MS = 30000;         // aktive Zeit je Collapse-Zyklus
const STAGE_COUNT = 2;          // Collapse-Stufen je Generation — es gibt keine dritte
const MATCH_CLOCK_MS = CYCLE_MS * STAGE_COUNT;   // Gesamtbudget (nur noch abgeleitet)
const TURN_LIMIT_MS = 7000;     // maximale Entscheidungszeit je Aim-Phase
const CRACK_REMAIN_MS = 10000;  // Cracked-Schwelle (Restzeit des LAUFENDEN Zyklus)
const SETTLE_GRACE_MS = 15000;  // Settlement-Quorum-Fallback gegen tote Phasen
const MAX_SEATS = 5;
const ROOM_RE = /^[A-HJKMNP-Z2-9]{4}$/;
const CLOCK_V = 4;              // v4: Stufenmodell (stage + zyklusweises remainingMs)

class ArbiterError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

// Seats der Partie: FFA-Familie traegt die Anzahl im write-once 'seats'-Feld,
// single/double sind immer 2.
function seatCount(room) {
  const fmt = room && room.config && room.config.fmt;
  if (fmt === 'ffa' || fmt === 'triple_ffa' || fmt === 'team_duel') {
    const n = room.seats;
    return (Number.isInteger(n) && n >= 2 && n <= MAX_SEATS) ? n : 0;
  }
  return 2;
}

// Seat des Aufrufers ueber den server-owned Index seatByUid/<uid>. Fail-closed:
// gueltig ist ein Besitz NUR, wenn (1) der Indexeintrag ein Seat im gueltigen
// Bereich ist, (2) players/<seat>/uid exakt zur UID passt und (3) die UID in
// keinem weiteren players-Seat vorkommt. Fehlender Eintrag, falsches Ziel,
// Widerspruch oder Mehrdeutigkeit ergeben -1 — niemals "den niedrigsten Seat".
function seatOfUid(room, uid) {
  if (typeof uid !== 'string' || !uid) return -1;
  const players = (room && room.players) || {};
  const index = (room && room.seatByUid) || {};
  const seat = index[uid];
  if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS) return -1;
  const p = players[seat];
  if (!p || p.uid !== uid) return -1;
  for (let s = 0; s < MAX_SEATS; s++) {
    if (s !== seat && players[s] && players[s].uid === uid) return -1;
  }
  return seat;
}

// eligibleSeats werden als normalisierter CSV-Schluessel gespeichert ('0,1,3'):
// sortiert, eindeutig, RTDB-freundlich (kein Array-Sparsing), in einem Vergleich
// konsensfaehig und in den Rules mit einem contains() exakt pruefbar.
function seatKey(seats) { return seats.slice().sort((a, b) => a - b).join(','); }

function parseSeatKey(key) {
  if (typeof key !== 'string') return null;
  if (key === '') return [];
  const out = [];
  for (const part of key.split(',')) {
    if (!/^[0-9]$/.test(part)) return null;
    const s = Number(part);
    if (s >= MAX_SEATS || out.indexOf(s) >= 0 || (out.length && s <= out[out.length - 1])) return null;
    out.push(s);
  }
  return out;
}

// Client-Eingabe (Array oder CSV) auf den kanonischen Schluessel normalisieren.
// allowed = Menge, aus der ausschliesslich gewaehlt werden darf (Teilmengenregel).
// Rueckgabe null = ungueltig; '' = leer (Partie vorbei) ist gueltig.
function normalizeSeats(input, allowed) {
  let arr;
  if (Array.isArray(input)) arr = input;
  else if (typeof input === 'string') arr = input === '' ? [] : input.split(',');
  else return null;
  if (arr.length > MAX_SEATS) return null;
  const seen = [];
  for (const raw of arr) {
    const s = typeof raw === 'number' ? raw : (/^[0-9]$/.test(String(raw)) ? Number(String(raw)) : NaN);
    if (!Number.isInteger(s) || s < 0 || s >= MAX_SEATS) return null;
    if (allowed && allowed.indexOf(s) < 0) return null;
    if (seen.indexOf(s) >= 0) return null;
    seen.push(s);
  }
  return seatKey(seen);
}

// Kanonische Serialisierung fuer den Archiv-Gleichheitsvergleich. RTDB liefert
// dichte 0..n-Schluessel als Array und laesst Luecken als null — beides wird
// auf dieselbe Objektform normalisiert, damit "identischer Inhalt" nicht an
// der Snapshot-Repraesentation scheitert.
function canonical(v) {
  if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  const keys = Object.keys(v).filter((k) => v[k] !== null && v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

// Transaction mit vorab synchronisiertem Cache: ein kurzlebiger value-Listener
// stellt sicher, dass bereits der ERSTE Update-Lauf mit den echten Serverdaten
// rechnet. Dadurch ist `cur == null` beweiskraeftig "Knoten existiert nicht" —
// ein geloeschter Knoten bleibt geloescht (frueher setzte ein Vorab-Snapshot-
// Fallback `cur = pre` geloeschte Knoten wieder ein; genau dieser Fallback ist
// abgeschafft). Ein Abort auf null ist damit endgueltig und resurrectionsfrei.
async function cachedTransaction(ref, update) {
  let ready;
  const synced = new Promise((resolve) => { ready = resolve; });
  const cb = ref.on('value', () => ready());
  try {
    await synced;
    return await ref.transaction(update);
  } finally {
    ref.off('value', cb);
  }
}

// Aim-Anker: ALLE Zeitpunkte absolut und vorberechnet. remaining<=0 (nach
// Expired) oeffnet eine UNGETIMTE Phase (kein deadlineAt) — die Matchlogik
// laeuft weiter, es entsteht nie eine negative Restzeit.
function aimAnchor(gen, turn, remainingMs, at, eligibleSeats, flags) {
  const timed = remainingMs > 0;
  const win = timed ? Math.min(TURN_LIMIT_MS, remainingMs) : 0;
  const a = {
    v: CLOCK_V, gen, turn, phaseId: gen + ':' + turn,
    phase: 'aim',
    startedAt: at,
    remainingMs,
    stage: (flags && flags.stage) || 0,
    eligibleSeats,
    cracked: !!(flags && flags.cracked),
    expired: !!(flags && flags.expired),
    closedAt: null, settleDeadlineAt: null, settled: null, reason: null,
    deadlineAt: null, crackAt: null, expiresAt: null,
    archived: null,
  };
  if (timed) {
    a.deadlineAt = at + win;
    // Crack-Zeitpunkt nur, wenn die Schwelle in DIESER Phase erreichbar ist.
    if (!a.cracked && remainingMs > CRACK_REMAIN_MS && (remainingMs - CRACK_REMAIN_MS) <= win)
      a.crackAt = at + (remainingMs - CRACK_REMAIN_MS);
    if (remainingMs <= win) a.expiresAt = at + remainingMs;
  }
  return a;
}

// Eroeffnungsanker einer Generation: Turn 0, Zyklus 1, stage 0, frisches
// Warnfenster (cracked/expired false), leere Slots (der Aufrufer schreibt
// ausschliesslich { iid, clock }).
//
// Der Stufenvertrag einer NEUEN Generation steht damit an GENAU einer Stelle.
// Alle vier Eroeffnungspfade — clockStart, roomStartV4, der Auto-Start in
// roomActivateV4 und roomRematchV4 — teilen sich diesen Aufruf; keiner setzt
// CYCLE_MS oder stage selbst. Ein Rematch beginnt dadurch zwangslaeufig wieder
// mit zwei vollen Zyklen und kann die Stufen der Vorgaengergeneration weder
// erben noch fortschreiben.
function openingAnchor(gen, at, eligibleSeats) {
  return aimAnchor(gen, 0, CYCLE_MS, at, eligibleSeats, { stage: 0 });
}

function createArbiter(opts) {
  const db = opts.db;
  const nowMs = typeof opts.now === 'function' ? opts.now : () => Date.now();

  // Transaction-Ziele: NUR der konstant kleine live-Knoten und der einzelne
  // Turn-Knoten der Archivierung — nie ein wachsender Subtree.
  const liveRef = (room, gen) => db.ref('rooms/' + room + '/g/' + gen + '/live');
  const turnRef = (room, gen, turn) => db.ref('rooms/' + room + '/g/' + gen + '/t/' + turn);

  // Gemeinsame Eingangspruefung. Liest GEZIELT nur die benoetigten Felder — nie
  // den ganzen Raum inklusive wachsender g/<gen>-Historie (Kosten + Latenz).
  // Haertung (Phase IIIB): jede Clock-Operation ist an die Rauminstanz (iid)
  // UND an die AKTIVE Session des aufrufenden Seats gebunden — UID/Seat allein
  // genuegen nicht mehr. Ein alter Tab (rotierte Session) und eine stale
  // Operation (recycelter Raumcode) scheitern hier fail-closed.
  async function loadRoom(room, uid, args) {
    if (typeof room !== 'string' || !ROOM_RE.test(room)) throw new ArbiterError('invalid', 'Ungueltiger Raumcode.');
    if (typeof uid !== 'string' || !uid) throw new ArbiterError('permission', 'Auth erforderlich.');
    if (!args || typeof args.iid !== 'string' || !args.iid)
      throw new ArbiterError('invalid', 'roomInstanceId (iid) fehlt.');
    if (typeof args.session !== 'string' || !args.session)
      throw new ArbiterError('invalid', 'Session-Token fehlt.');
    const base = db.ref('rooms/' + room);
    const [v, state, fmt, seats, gen, players, seatIdx, iid, sessSnap] = await Promise.all([
      base.child('v').get(), base.child('state').get(), base.child('config/fmt').get(),
      base.child('seats').get(), base.child('gen').get(), base.child('players').get(),
      base.child('seatByUid').get(), base.child('iid').get(), base.child('sess').get(),
    ]);
    if (!v.exists()) throw new ArbiterError('not-found', 'Raum existiert nicht.');
    if (v.val() !== 4) throw new ArbiterError('invalid', 'Action-Clock erfordert Protokoll v4.');
    if (iid.val() !== args.iid) throw new ArbiterError('failed', 'Rauminstanz veraltet (iid stimmt nicht).');
    if (state.val() !== 'playing') throw new ArbiterError('failed', 'Match laeuft nicht.');
    const meta = {
      config: { fmt: fmt.val() }, seats: seats.val(),
      players: players.val() || {}, seatByUid: seatIdx.val() || {},
    };
    const seat = seatOfUid(meta, uid);
    if (seat < 0) throw new ArbiterError('permission', 'Kein eindeutiger Seat fuer diese UID.');
    const sess = (sessSnap.val() || {})[seat];
    if (!sess || typeof sess.active !== 'string' || sess.active !== args.session)
      throw new ArbiterError('permission', 'Session ungueltig oder veraltet.');
    return { meta, seat, gen: gen.val() | 0, iid: args.iid };
  }

  // Zugberechtigte Seats der ERSTEN Phase: alle besetzten v4-Roster-Plaetze.
  // Rueckgabe null, sobald IRGENDEIN besetzter Seat oder Indexeintrag der
  // UID-/Seat-Eindeutigkeit widerspricht — dann startet keine Clock.
  function rosterSeats(meta) {
    const n = seatCount(meta);
    const out = [];
    for (let s = 0; s < n; s++) {
      const p = meta.players[s];
      if (!p || typeof p.uid !== 'string' || !p.uid) continue;
      if (seatOfUid(meta, p.uid) !== s) return null;
      out.push(s);
    }
    for (const uid of Object.keys(meta.seatByUid || {})) {
      if (seatOfUid(meta, uid) < 0) return null;
    }
    return out;
  }

  // Historienarchivierung — idempotent und wiederholbar (Crash-Recovery).
  // Schritt 1: finalisierte live-Slots write-once nach t/<turn>. Ein identischer
  //            Retry ist ein No-op; abweichender Inhalt ist ein kontrollierter
  //            Desync (bestehende Historie wird NIE ueberschrieben).
  // Schritt 2: archived:true in live bestaetigen (Transaction, phasengebunden).
  // iid-Haertung: unmittelbar VOR dem History-Write wird die Rauminstanz
  // verifiziert, und beide live-Transactions sind an live.iid gebunden — eine
  // stale Archivierung kann in einem recycelten Raum weder Historie schreiben
  // noch etwas "reparieren". Rueckgabe: der frische live-Wert.
  async function ensureArchived(room, gen, live, iid) {
    const clock = live && live.clock;
    if (!clock || clock.phase !== 'resolving' || clock.archived === true) return live;
    if (live.iid !== iid) return live;               // stale Sicht -> nichts anfassen
    const turn = clock.turn;
    const slots = live.slots || {};
    // Instanzpruefung unmittelbar vor dem History-Write.
    const curIid = (await db.ref('rooms/' + room + '/iid').get()).val();
    if (curIid !== iid) return live;
    // Unveraenderlicher Clock-Anker je Turn: Replay und fastForwardMatch koennen
    // damit beide Collapse-Stufen, HUD-Restzeit und Radien exakt rekonstruieren,
    // ohne die Live-Uhr zu kennen. stage/remainingAfter sind die Werte NACH dem
    // Close, ein Stufenwechsel ist also der Sprung zwischen zwei Turns.
    const anchor = {
      startedAt: clock.startedAt,
      usedMs: typeof clock.usedMs === 'number' ? clock.usedMs : 0,
      stage: clock.stage || 0,
      remainingAfter: clock.remainingMs,
    };
    const record = Object.assign({}, slots, { c: anchor });
    // Der Vergleich laeuft NUR ueber die Slots: der Anker ist abgeleitet und darf
    // einen identischen Retry nicht als Desync erscheinen lassen.
    const slotsOf = (o) => { const r = {}; for (const k of Object.keys(o || {})) if (k !== 'c') r[k] = o[k]; return r; };
    let mismatch = false;
    await cachedTransaction(turnRef(room, gen, turn), (cur) => {
      if (cur == null) return record;                // write-once Erstschreibung
      mismatch = canonical(slotsOf(cur)) !== canonical(slots);
      return;                                        // Historie ist unantastbar
    });
    const lref = liveRef(room, gen);
    if (mismatch) {
      // t/<turn> widerspricht den finalisierten Slots -> kontrolliertes Ende;
      // aus diesem Zustand wird NIE eine Folgephase eroeffnet.
      await cachedTransaction(lref, (cur) => {
        if (cur == null) return;                     // geloescht bleibt geloescht
        if (cur.iid !== iid) return;                 // fremde Instanz -> nie anfassen
        const c = cur && cur.clock;
        if (!c || c.gen !== gen || c.turn !== turn || c.phase !== 'resolving') return;
        return Object.assign({}, cur, { clock: Object.assign({}, c, { phase: 'finished', reason: 'desync' }) });
      });
    } else {
      await cachedTransaction(lref, (cur) => {
        if (cur == null) return;                     // geloescht bleibt geloescht
        if (cur.iid !== iid) return;                 // fremde Instanz -> nie anfassen
        const c = cur && cur.clock;
        if (!c || c.gen !== gen || c.turn !== turn || c.phase !== 'resolving' || c.archived === true) return;
        return Object.assign({}, cur, { clock: Object.assign({}, c, { archived: true }) });
      });
    }
    return (await lref.get()).val();
  }

  // A) Matchstart: erste Aim-Phase der aktuellen Generation eroeffnen.
  //    Write-once je Generation — ein zweiter Aufruf ist ein No-op (Echo zaehlt),
  //    setzt also NIE remainingMs/cracked/expired einer bestehenden Clock zurueck.
  //    Gen-Haertung: ausschliesslich room.gen; ein mitgesendetes gen-Argument
  //    mit alter oder zukuenftiger Generation wird fail-closed abgelehnt.
  async function clockStart(args) {
    const { meta, gen, iid } = await loadRoom(args.room, args.uid, args);
    if (args.gen !== undefined && args.gen !== null && args.gen !== gen)
      throw new ArbiterError('failed', 'ClockStart nur fuer die aktuelle Generation (room.gen).');
    if (!seatCount(meta)) throw new ArbiterError('failed', 'Seat-Anzahl unbekannt (seats fehlt).');
    const seats = rosterSeats(meta);
    if (seats == null) throw new ArbiterError('failed', 'UID-/Seat-Zuordnung inkonsistent.');
    if (seats.length < 2) throw new ArbiterError('failed', 'Zu wenige besetzte Seats.');
    const res = await cachedTransaction(liveRef(args.room, gen), (cur) => {
      if (cur && cur.clock && cur.clock.gen === gen) return;   // bereits eroeffnet -> Echo
      // Serverzeit IM Transaction-Lauf: ein Retry unter Contention uebernimmt
      // nie eine bereits veraltete Deadline — die erste Aim-Phase startet immer
      // mit dem vollen Fenster. live traegt die Rauminstanz (iid-Bindung aller
      // Folge-Transactions).
      return { iid, clock: openingAnchor(gen, nowMs(), seatKey(seats)) };
    });
    const live = res.snapshot.val();
    return { status: res.committed ? 'started' : 'exists', clock: (live && live.clock) || null };
  }

  // C) Aim-Phase abschliessen: vorzeitig (alle Commits da) oder ab Deadline.
  //    EINE Transaction AUSSCHLIESSLICH auf g/<gen>/live: Slots lesen, fehlende
  //    Slots fuellen und die Phase schliessen passieren als EIN Schreibvorgang —
  //    kein beobachtbarer Zwischenzustand, und zwei parallele Aufrufe
  //    konvergieren (einer schliesst, der andere ist No-op). Danach wird die
  //    Historie archiviert; ein stale-Aufruf holt eine ausstehende
  //    Archivierung nach (Crash-Recovery).
  async function clockClose(args) {
    const { gen, iid } = await loadRoom(args.room, args.uid, args);
    const ref = liveRef(args.room, gen);
    const t = nowMs();
    let outcome = 'stale';
    const res = await cachedTransaction(ref, (cur) => {
      // Cache ist vorab synchronisiert (cachedTransaction): `cur == null`
      // heisst beweiskraeftig "geloescht" -> Abort, nie Wiederbelebung.
      if (cur == null) return;
      outcome = 'stale';
      if (cur.iid !== iid) return;                   // fremde Rauminstanz -> nie anfassen
      const clock = cur && cur.clock;
      if (!clock || clock.gen !== gen || clock.phaseId !== args.phaseId || clock.phase !== 'aim') return;
      const eligible = parseSeatKey(clock.eligibleSeats);
      if (eligible == null) { outcome = 'corrupt'; return; }
      const slots = (cur && cur.slots) || {};
      const open = eligible.filter((s) => slots[s] == null);
      const deadline = typeof clock.deadlineAt === 'number' ? clock.deadlineAt : null;
      if (open.length && (deadline == null || t < deadline)) { outcome = 'too-early'; return; }
      // Fehlende Slots write-once fuellen — IMMER als verbindlicher No-Shot.
      // Kein Presence-Blick: 'left' waere aus einem veraltbaren Snapshot geraten.
      const nextSlots = Object.assign({}, slots);
      for (const s of open) nextSlots[s] = { ns: 'stand' };
      const eff = Math.min(t, deadline == null ? t : deadline);
      const used = Math.max(0, Math.min(eff - clock.startedAt, Math.min(TURN_LIMIT_MS, clock.remainingMs)));
      let rem = Math.max(0, clock.remainingMs - used);
      let stage = clock.stage || 0;
      let cracked = clock.cracked === true;
      // ── Stufengrenze ──────────────────────────────────────────────────────
      // Der Zyklus ist aufgebraucht: die Stufe faellt GENAU hier. Solange noch
      // eine Stufe aussteht, beginnt der naechste Zyklus mit exakt CYCLE_MS und
      // einem frischen Warnfenster; nach der letzten Stufe bleibt die Uhr
      // terminal bei 0 (expired) — eine dritte Stufe gibt es nicht.
      if (rem <= 0 && stage < STAGE_COUNT) {
        stage += 1;
        if (stage < STAGE_COUNT) { rem = CYCLE_MS; cracked = false; }
      }
      const expired = clock.expired === true || (rem <= 0 && stage >= STAGE_COUNT);
      outcome = 'closed';
      return Object.assign({}, cur, {                // iid bleibt erhalten
        clock: Object.assign({}, clock, {
          phase: 'resolving', closedAt: t, settleDeadlineAt: t + SETTLE_GRACE_MS,
          remainingMs: rem,
          stage: stage,
          usedMs: used,                              // Verbrauch DIESER Phase — Quelle des Historien-Ankers
          // Cracked gilt je Zyklus: der Rollover oben hat ihn ggf. schon geloest.
          cracked: cracked || (rem > 0 && rem <= CRACK_REMAIN_MS),
          expired: expired,
          settled: null,
          archived: false,                           // archivePending — Schritt 2 folgt
        }),
        slots: nextSlots,
      });
    });
    if (!res.committed && outcome === 'too-early')
      throw new ArbiterError('too-early', 'Noch offene Commits und Deadline nicht erreicht.');
    if (!res.committed && outcome === 'corrupt')
      throw new ArbiterError('failed', 'Clock-Anker unbrauchbar (eligibleSeats).');
    // Archivierung: nach dem eigenen Close ODER als Reparatur eines frueheren
    // Abbruchs (stale-Aufruf trifft resolving + archived:false). Der Snapshot
    // traegt dank synchronisiertem Cache immer den echten Serverstand; bei
    // geloeschtem Knoten ist er leer — dann gibt es nichts zu reparieren.
    let live = res.snapshot.val();
    if (live && live.clock && live.clock.phase === 'resolving' && live.clock.archived !== true)
      live = await ensureArchived(args.room, gen, live, iid);
    const closed = res.committed && outcome === 'closed';
    return { status: closed ? 'closed' : 'stale', clock: (live && live.clock) || null };
  }

  // E/F) Settlement: jeder zugberechtigte Seat meldet sein deterministisches
  //      Ergebnis (hash) UND die daraus folgende Zugberechtigung der naechsten
  //      Phase (next). Der erste Report eines Seats ist write-once; eine
  //      identische Wiederholung ist idempotent, eine abweichende ist Desync.
  //      NUR ein vollstaendiges, widerspruchsfreies Quorum aus eligibleSeats
  //      oeffnet die naechste Phase — GENAU EINMAL, und NUR nachdem die
  //      Historie des geschlossenen Turns bestaetigt archiviert ist. Die neue
  //      Folgephase ersetzt den gesamten live-Knoten (frische Clock, leere
  //      Slots, keine alten Reports) — live bleibt konstant klein.
  //      Nach settleDeadlineAt gilt: ein unvollstaendiges Quorum wird NIE aus
  //      Teilreports fortgesetzt, sondern endet deterministisch als
  //      finished/settlement_timeout — reihenfolgeunabhaengig, entschieden
  //      vollstaendig INNERHALB der Transaction (kein Vorab-Read entscheidet).
  async function clockSettle(args) {
    const { gen, seat, iid } = await loadRoom(args.room, args.uid, args);
    if (typeof args.hash !== 'string' || !args.hash || args.hash.length > 64)
      throw new ArbiterError('invalid', 'Settlement-Hash fehlt oder ist ungueltig.');
    const ref = liveRef(args.room, gen);
    let pre = (await ref.get()).val();
    // Crash-Recovery: eine ausstehende Archivierung wird VOR dem Settle
    // nachgeholt (idempotent). Ergibt sie einen Historien-Desync, ist die
    // Phase terminal und der Settle unten laeuft als stale aus.
    if (pre && pre.clock && pre.clock.phase === 'resolving' && pre.clock.archived !== true)
      pre = await ensureArchived(args.room, gen, pre, iid);
    const t = nowMs();
    let outcome = 'stale';
    const res = await cachedTransaction(ref, (cur) => {
      if (cur == null) return;                       // geloescht bleibt geloescht (s. clockClose)
      outcome = 'stale';
      if (cur.iid !== iid) return;                   // fremde Rauminstanz -> nie anfassen
      const clock = cur && cur.clock;
      if (!clock || clock.gen !== gen || clock.phaseId !== args.phaseId || clock.phase !== 'resolving') return;
      // Keine Folgephase (und kein Terminal-Uebergang) ohne archivierten
      // Vorgaenger — der Guard sitzt bewusst IN der Transaction.
      if (clock.archived !== true) { outcome = 'unarchived'; return; }
      const eligible = parseSeatKey(clock.eligibleSeats);
      if (eligible == null) { outcome = 'corrupt'; return; }
      if (eligible.indexOf(seat) < 0) { outcome = 'permission'; return; }
      const next = normalizeSeats(args.next, eligible);
      if (next == null) { outcome = 'invalid'; return; }
      const settled = Object.assign({}, clock.settled || {});
      const prev = settled[seat];
      if (prev && (prev.hash !== args.hash || prev.next !== next)) {
        outcome = 'desync';                          // write-once verletzt -> kontrolliertes Ende
        return Object.assign({}, cur, { clock: Object.assign({}, clock, { phase: 'finished', reason: 'desync' }) });
      }
      settled[seat] = { hash: args.hash, next };
      const missing = eligible.filter((s) => settled[s] == null);
      if (missing.length) {
        const graceUp = typeof clock.settleDeadlineAt === 'number' && t >= clock.settleDeadlineAt;
        if (!graceUp) {
          outcome = 'pending';                       // Quorum offen, Grace laeuft
          return Object.assign({}, cur, { clock: Object.assign({}, clock, { settled }) });
        }
        // Post-Grace ohne vollstaendiges Quorum: deterministisch terminal.
        // Kein Teilreport darf eine Folgephase (und deren eligibleSeats)
        // bestimmen; turn/phaseId bleiben unveraendert.
        outcome = 'timeout';
        return Object.assign({}, cur, {
          clock: Object.assign({}, clock, { settled, phase: 'finished', reason: 'settlement_timeout' }),
        });
      }
      const reports = eligible.map((s) => settled[s]);
      const head = reports[0];
      if (!reports.every((r) => r.hash === head.hash && r.next === head.next)) {
        outcome = 'desync';
        return Object.assign({}, cur, {
          clock: Object.assign({}, clock, { settled, phase: 'finished', reason: 'desync' }),
        });
      }
      if (head.next === '') {                        // niemand mehr zugberechtigt -> Partie vorbei
        outcome = 'finished';
        return Object.assign({}, cur, {
          clock: Object.assign({}, clock, { settled, phase: 'finished', reason: 'complete' }),
        });
      }
      outcome = 'opened';
      // Folgephase = frischer live-Knoten: turn/phaseId exakt einmal erhoeht,
      // neue eligibleSeats, KEINE alten Slots, KEINE alten Reports; die
      // Rauminstanz (iid) bleibt gebunden.
      return {
        iid: cur.iid,
        clock: aimAnchor(clock.gen, clock.turn + 1, clock.remainingMs, t, head.next,
          { cracked: clock.cracked, expired: clock.expired, stage: clock.stage || 0 }),
      };
    });
    if (!res.committed && outcome === 'permission')
      throw new ArbiterError('permission', 'Seat ist in dieser Phase nicht zugberechtigt.');
    if (!res.committed && outcome === 'invalid')
      throw new ArbiterError('invalid', 'nextEligibleSeats fehlt oder ist ungueltig.');
    if (!res.committed && outcome === 'corrupt')
      throw new ArbiterError('failed', 'Clock-Anker unbrauchbar (eligibleSeats).');
    if (!res.committed && outcome === 'unarchived')
      throw new ArbiterError('failed', 'Turn-Historie noch nicht archiviert.');
    const live = res.snapshot.val();
    const status = !res.committed ? 'stale'
      : (outcome === 'pending' || outcome === 'timeout') ? outcome
        : (outcome === 'opened' || outcome === 'finished' || outcome === 'desync') ? 'settled' : 'stale';
    return { status, clock: (live && live.clock) || null };
  }

  return { clockStart, clockClose, clockSettle };
}

module.exports = {
  createArbiter, ArbiterError, aimAnchor, openingAnchor, seatCount, seatOfUid,
  seatKey, parseSeatKey, normalizeSeats, canonical, cachedTransaction,
  MATCH_CLOCK_MS, TURN_LIMIT_MS, CRACK_REMAIN_MS, SETTLE_GRACE_MS, CLOCK_V,
  CYCLE_MS, STAGE_COUNT, MAX_SEATS, ROOM_RE,
};
