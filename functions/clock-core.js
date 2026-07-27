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
// ── Datenlage: der Clock-Anker liegt bei rooms/<code>/g/<gen>/clock ────────────
// Bewusst NICHT unter rooms/<code>/clock: Clock und Turn-Slots derselben
// Generation muessen im selben atomar transaktionierbaren Subtree liegen, sonst
// ist "fehlende Slots fuellen UND Phase schliessen" zwangslaeufig zweistufig und
// damit fuer Beobachter (und fuer einen Absturz zwischen den Schritten) partiell
// sichtbar. Der niedrigste gemeinsame Knoten von clock und t/<turn> ist g/<gen>
// — genau darauf laeuft clockClose() in EINER Transaction.
//
// Autoritaet: AUSSCHLIESSLICH dieser Arbiter schreibt g/<gen>/clock — die Rules
// verweigern jeden Client-Write (".write": false); der Admin-SDK-Zugriff hier
// umgeht die Rules. Alle Zeitpunkte (startedAt/deadlineAt/crackAt/expiresAt/
// closedAt/settleDeadlineAt) sind absolute, vorberechnete SERVER-Zeiten: der
// Arbiter braucht keine Timer und keinen Scheduler — jeder Client darf close/
// settle jederzeit "anstossen", der Server validiert lazy gegen seine eigene Uhr
// und die Transaction erzwingt Idempotenz (genau ein Abschluss je Phase).
//
// ── Zugberechtigung: clock.eligibleSeats ─────────────────────────────────────
// Welche Seats eine Phase ueberhaupt betrifft, entscheidet der Server und nur er:
// eligibleSeats ist fuer die Dauer einer Phase unveraenderlich, wird beim Start
// aus dem v4-Roster abgeleitet und danach ausschliesslich per Settlement-Konsens
// fortgeschrieben (jeder Report traegt nextEligibleSeats). Damit blockiert ein
// eliminierter, aber noch verbundener Seat die naechste Runde nicht, bekommt
// keinen Timeout-No-Shot und kostet die globale Uhr keine 7 Sekunden.
// WICHTIG: Presence entscheidet hier NICHTS mehr. Ein vor der Transaction
// gelesener Presence-Snapshot ist per Definition veraltbar; ein Reconnect
// zwischen Read und Write haette sonst einen fremden 'left'-Sentinel erzeugt.
// Fehlende Slots werden deshalb IMMER als {ns:'stand'} gebucht.
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

const MATCH_CLOCK_MS = 60000;   // globale aktive Matchzeit
const TURN_LIMIT_MS = 7000;     // maximale Entscheidungszeit je Aim-Phase
const CRACK_REMAIN_MS = 10000;  // Cracked-Schwelle (globale Restzeit)
const SETTLE_GRACE_MS = 15000;  // Settlement-Quorum-Fallback gegen tote Phasen
const MAX_SEATS = 5;
const ROOM_RE = /^[A-HJKMNP-Z2-9]{4}$/;
const CLOCK_V = 2;              // v2: eligibleSeats + settleDeadlineAt + Reports {hash,next}

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

// Seat des Aufrufers ueber die vertrauenswuerdige Auth-Identitaet (players/<s>/uid).
function seatOfUid(room, uid) {
  const players = (room && room.players) || {};
  for (let s = 0; s < MAX_SEATS; s++) {
    if (players[s] && players[s].uid === uid) return s;
  }
  return -1;
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
    eligibleSeats,
    cracked: !!(flags && flags.cracked),
    expired: !!(flags && flags.expired),
    closedAt: null, settleDeadlineAt: null, settled: null, reason: null,
    deadlineAt: null, crackAt: null, expiresAt: null,
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

function createArbiter(opts) {
  const db = opts.db;
  const nowMs = typeof opts.now === 'function' ? opts.now : () => Date.now();

  const genRef = (room, gen) => db.ref('rooms/' + room + '/g/' + gen);
  const clockRef = (room, gen) => db.ref('rooms/' + room + '/g/' + gen + '/clock');

  // Gemeinsame Eingangspruefung. Liest GEZIELT nur die benoetigten Felder — nie
  // den ganzen Raum inklusive wachsender g/<gen>-Historie (Kosten + Latenz).
  async function loadRoom(room, uid) {
    if (typeof room !== 'string' || !ROOM_RE.test(room)) throw new ArbiterError('invalid', 'Ungueltiger Raumcode.');
    if (typeof uid !== 'string' || !uid) throw new ArbiterError('permission', 'Auth erforderlich.');
    const base = db.ref('rooms/' + room);
    const [v, state, fmt, seats, gen, players] = await Promise.all([
      base.child('v').get(), base.child('state').get(), base.child('config/fmt').get(),
      base.child('seats').get(), base.child('gen').get(), base.child('players').get(),
    ]);
    if (!v.exists()) throw new ArbiterError('not-found', 'Raum existiert nicht.');
    if (v.val() !== 4) throw new ArbiterError('invalid', 'Action-Clock erfordert Protokoll v4.');
    if (state.val() !== 'playing') throw new ArbiterError('failed', 'Match laeuft nicht.');
    const meta = { config: { fmt: fmt.val() }, seats: seats.val(), players: players.val() || {} };
    const seat = seatOfUid(meta, uid);
    if (seat < 0) throw new ArbiterError('permission', 'Aufrufer sitzt nicht in diesem Raum.');
    return { meta, seat, gen: gen.val() | 0 };
  }

  // Zugberechtigte Seats der ERSTEN Phase: alle besetzten v4-Roster-Plaetze.
  function rosterSeats(meta) {
    const n = seatCount(meta);
    const out = [];
    for (let s = 0; s < n; s++) {
      const p = meta.players[s];
      if (p && typeof p.uid === 'string' && p.uid) out.push(s);
    }
    return out;
  }

  // A) Matchstart/Rematch: erste Aim-Phase der aktuellen Generation eroeffnen.
  //    Write-once je Generation — ein zweiter Aufruf ist ein No-op (Echo zaehlt).
  async function clockStart(args) {
    const { meta, gen } = await loadRoom(args.room, args.uid);
    if (!seatCount(meta)) throw new ArbiterError('failed', 'Seat-Anzahl unbekannt (seats fehlt).');
    const seats = rosterSeats(meta);
    if (seats.length < 2) throw new ArbiterError('failed', 'Zu wenige besetzte Seats.');
    const at = nowMs();
    const res = await clockRef(args.room, gen).transaction((cur) => {
      if (cur && cur.gen === gen) return;            // bereits eroeffnet -> Echo uebernimmt
      return aimAnchor(gen, 0, MATCH_CLOCK_MS, at, seatKey(seats), {});
    });
    return { status: res.committed ? 'started' : 'exists', clock: res.snapshot.val() };
  }

  // C) Aim-Phase abschliessen: vorzeitig (alle Commits da) oder ab Deadline.
  //    EINE Transaction auf g/<gen> — dem niedrigsten gemeinsamen Knoten von
  //    clock und t/<turn>. Slots lesen, fehlende Slots fuellen und die Phase
  //    schliessen passieren damit als EIN Schreibvorgang: es gibt keinen
  //    beobachtbaren Zwischenzustand mit halb gebuchten No-Shots, und zwei
  //    parallele Aufrufe konvergieren (einer schliesst, der andere ist No-op).
  async function clockClose(args) {
    const { gen } = await loadRoom(args.room, args.uid);
    const ref = genRef(args.room, gen);
    const pre = (await ref.get()).val();
    const t = nowMs();
    let outcome = 'stale';
    const res = await ref.transaction((cur) => {
      // Erster Transaction-Lauf kann mit leerem lokalen Cache (null) starten: dann
      // gegen den Vorab-Read rechnen — weicht der echte Serverwert ab, schlaegt der
      // Commit fehl und das SDK wiederholt mit den Serverdaten (Guards greifen dann).
      if (cur == null) cur = pre;
      outcome = 'stale';
      const clock = cur && cur.clock;
      if (!clock || clock.gen !== gen || clock.phaseId !== args.phaseId || clock.phase !== 'aim') return;
      const eligible = parseSeatKey(clock.eligibleSeats);
      if (eligible == null) { outcome = 'corrupt'; return; }
      const turnKey = String(clock.turn);
      const slots = (cur.t && cur.t[turnKey]) || {};
      const open = eligible.filter((s) => slots[s] == null);
      const deadline = typeof clock.deadlineAt === 'number' ? clock.deadlineAt : null;
      if (open.length && (deadline == null || t < deadline)) { outcome = 'too-early'; return; }
      // Fehlende Slots write-once fuellen — IMMER als verbindlicher No-Shot.
      // Kein Presence-Blick: 'left' waere aus einem veraltbaren Snapshot geraten.
      const nextSlots = Object.assign({}, slots);
      for (const s of open) nextSlots[s] = { ns: 'stand' };
      const nextTurns = Object.assign({}, cur.t || {});
      nextTurns[turnKey] = nextSlots;
      const eff = Math.min(t, deadline == null ? t : deadline);
      const used = Math.max(0, Math.min(eff - clock.startedAt, Math.min(TURN_LIMIT_MS, clock.remainingMs)));
      const rem = Math.max(0, clock.remainingMs - used);
      outcome = 'closed';
      return Object.assign({}, cur, {
        t: nextTurns,
        clock: Object.assign({}, clock, {
          phase: 'resolving', closedAt: t, settleDeadlineAt: t + SETTLE_GRACE_MS,
          remainingMs: rem,
          cracked: clock.cracked === true || rem <= CRACK_REMAIN_MS,
          expired: clock.expired === true || rem <= 0,
          settled: null,
        }),
      });
    });
    if (!res.committed && outcome === 'too-early')
      throw new ArbiterError('too-early', 'Noch offene Commits und Deadline nicht erreicht.');
    if (!res.committed && outcome === 'corrupt')
      throw new ArbiterError('failed', 'Clock-Anker unbrauchbar (eligibleSeats).');
    const val = res.snapshot.val();
    return { status: res.committed ? 'closed' : 'stale', clock: (val && val.clock) || null };
  }

  // E/F) Settlement: jeder zugberechtigte Seat meldet sein deterministisches
  //      Ergebnis (hash) UND die daraus folgende Zugberechtigung der naechsten
  //      Phase (next). Der erste Report eines Seats ist write-once; eine
  //      identische Wiederholung ist idempotent, eine abweichende ist Desync.
  //      NUR ein vollstaendiges, widerspruchsfreies Quorum aus eligibleSeats
  //      oeffnet die naechste Phase — GENAU EINMAL (Transaction auf dem Clock-
  //      Knoten, dem einzigen von diesem Aufruf beruehrten Teilbaum).
  //      Nach settleDeadlineAt gilt: ein unvollstaendiges Quorum wird NIE aus
  //      Teilreports fortgesetzt, sondern endet deterministisch als
  //      finished/settlement_timeout. Vorher konnte nach der Grace ein
  //      einzelner (auch manipulierter) Report die Folgephase samt
  //      nextEligibleSeats bestimmen und damit ehrliche Seats ausschliessen —
  //      das Ergebnis hing von der Transaction-Reihenfolge ab. Jetzt ist das
  //      Post-Grace-Ergebnis reihenfolgeunabhaengig; die Entscheidung faellt
  //      vollstaendig INNERHALB der Transaction (kein Vorab-Read entscheidet).
  async function clockSettle(args) {
    const { gen, seat } = await loadRoom(args.room, args.uid);
    if (typeof args.hash !== 'string' || !args.hash || args.hash.length > 64)
      throw new ArbiterError('invalid', 'Settlement-Hash fehlt oder ist ungueltig.');
    const ref = clockRef(args.room, gen);
    const pre = (await ref.get()).val();
    const t = nowMs();
    let outcome = 'stale';
    const res = await ref.transaction((cur) => {
      if (cur == null) cur = pre;                    // Null-First-Run: s. clockClose
      outcome = 'stale';
      if (!cur || cur.gen !== gen || cur.phaseId !== args.phaseId || cur.phase !== 'resolving') return;
      const eligible = parseSeatKey(cur.eligibleSeats);
      if (eligible == null) { outcome = 'corrupt'; return; }
      if (eligible.indexOf(seat) < 0) { outcome = 'permission'; return; }
      const next = normalizeSeats(args.next, eligible);
      if (next == null) { outcome = 'invalid'; return; }
      const settled = Object.assign({}, cur.settled || {});
      const prev = settled[seat];
      if (prev && (prev.hash !== args.hash || prev.next !== next)) {
        outcome = 'desync';                          // write-once verletzt -> kontrolliertes Ende
        return Object.assign({}, cur, { phase: 'finished', reason: 'desync' });
      }
      settled[seat] = { hash: args.hash, next };
      const missing = eligible.filter((s) => settled[s] == null);
      if (missing.length) {
        const graceUp = typeof cur.settleDeadlineAt === 'number' && t >= cur.settleDeadlineAt;
        if (!graceUp) {
          outcome = 'pending';                       // Quorum offen, Grace laeuft
          return Object.assign({}, cur, { settled });
        }
        // Post-Grace ohne vollstaendiges Quorum: deterministisch terminal.
        // Kein Teilreport darf eine Folgephase (und deren eligibleSeats)
        // bestimmen; turn/phaseId bleiben unveraendert.
        outcome = 'timeout';
        return Object.assign({}, cur, { settled, phase: 'finished', reason: 'settlement_timeout' });
      }
      const reports = eligible.map((s) => settled[s]);
      const head = reports[0];
      if (!reports.every((r) => r.hash === head.hash && r.next === head.next)) {
        outcome = 'desync';
        return Object.assign({}, cur, { settled, phase: 'finished', reason: 'desync' });
      }
      if (head.next === '') {                        // niemand mehr zugberechtigt -> Partie vorbei
        outcome = 'finished';
        return Object.assign({}, cur, { settled, phase: 'finished', reason: 'complete' });
      }
      outcome = 'opened';
      return aimAnchor(cur.gen, cur.turn + 1, cur.remainingMs, t, head.next,
        { cracked: cur.cracked, expired: cur.expired });
    });
    if (!res.committed && outcome === 'permission')
      throw new ArbiterError('permission', 'Seat ist in dieser Phase nicht zugberechtigt.');
    if (!res.committed && outcome === 'invalid')
      throw new ArbiterError('invalid', 'nextEligibleSeats fehlt oder ist ungueltig.');
    if (!res.committed && outcome === 'corrupt')
      throw new ArbiterError('failed', 'Clock-Anker unbrauchbar (eligibleSeats).');
    const status = !res.committed ? 'stale'
      : (outcome === 'pending' || outcome === 'timeout') ? outcome : 'settled';
    return { status, clock: res.snapshot.val() };
  }

  return { clockStart, clockClose, clockSettle };
}

module.exports = {
  createArbiter, ArbiterError, aimAnchor, seatCount, seatOfUid,
  seatKey, parseSeatKey, normalizeSeats,
  MATCH_CLOCK_MS, TURN_LIMIT_MS, CRACK_REMAIN_MS, SETTLE_GRACE_MS, CLOCK_V,
};
