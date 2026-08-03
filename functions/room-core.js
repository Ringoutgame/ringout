'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// RingOut — serverseitiger v4-Room-Lifecycle (Phase IIIB, final gehaertet).
//
// Sechs Callable-Kerne: roomCreateV4, roomJoinV4, roomActivateV4, roomLeaveV4,
// roomStartV4, roomRematchV4. Sie uebernehmen die BESTEHENDE v3-Produktsemantik
// (kein neuer Lobby-Ablauf), verlagern aber jede autoritative Entscheidung auf
// den Server.
//
// ── Zweistufiger Session-Handshake ───────────────────────────────────────────
// Server-owned Session-State je Seat:
//   rooms/<code>/sess/<seat> = { iid, active: <token>|null,
//                                pending: { token, leaseId, expiresAt }|null }
// roomCreateV4/roomJoinV4 reservieren den Seat und erzeugen NUR eine pending
// Session (Token + leaseId + absolute Server-Ablaufzeit) — der Spieler ist
// danach weder online noch spielberechtigt, es startet keine Clock. Der Client
// registriert seinen onDisconnect-Handler mit dem pending Token und ruft ERST
// DANACH roomActivateV4 auf: das setzt atomar active = pending.token,
// pending = null und die Presence online mit demselben Token. Der Disconnect-
// Handler existiert damit garantiert, BEVOR der Spieler online wird — das
// fruehere Fenster (Activate vor onDisconnect-Registrierung) ist geschlossen.
// 1v1/2v2 startet erst, wenn BEIDE Seats eine gueltige aktive Session UND
// passende Online-Presence besitzen; der Clock-Anker entsteht in derselben
// finalen Transaction.
//
// ── Vollstaendige Sessionbindung ─────────────────────────────────────────────
// sess/<seat>/active ist Pflicht-CAS fuer ALLE sitzbezogenen Spielpfade:
// live/slots-Moves (Rules: Pflichtfeld `sid` === active), clockClose/
// clockSettle/clockStart (clock-core.loadRoom), roomLeaveV4, roomStartV4,
// roomRematchV4 (session-Pflichtargument) und roomActivateV4 (pending token +
// leaseId). Nach einer Rotation (Takeover/Reconnect) verliert der alte Tab
// damit JEDE Handlung: kein Move, kein Close/Settle, kein Leave/Start/
// Rematch, keine erneute Aktivierung mit alter Lease. UID/Seat allein
// genuegen nirgends mehr.
//
// ── Reservation-Lease + Recycling ────────────────────────────────────────────
// pending Sessions tragen expiresAt (RESERVE_LEASE_MS). Solange die Lease
// laeuft, bleibt der Seat reserviert. Ein reservierter, nie aktivierter Seat
// (active == null, pending abgelaufen, Presence offline) wird beim naechsten
// Join atomar recycelt — der alte token/leaseId kann danach nicht mehr
// aktivieren. Ein AKTIVER Seat wird NIE ueber die Lease recycelt; der
// Reconnect eines aktiven Seats erzeugt nur eine neue pending Session und
// ersetzt active erst bei erfolgreichem Activate.
//
// ── roomInstanceId (iid) an allen autoritativen Grenzen ──────────────────────
// Jeder v4-Raum traegt eine unveraenderliche, servergenerierte iid. Alle
// Callables nach Create verlangen sie und pruefen sie vor UND innerhalb der
// autoritativen Transaction; sess/<seat> traegt die iid ebenfalls (Einzel-
// knoten-Transactions bleiben instanzgebunden), und der Clock-Arbiter bindet
// live/Archiv/Settle an live.iid (clock-core). Alle Transactions laufen als
// cachedTransaction: `cur == null` ist beweiskraeftig "geloescht" und fuehrt
// zu einem endgueltigen Abort — ein geloeschter oder recycelter Raum kann von
// alten Operationen weder wiederbelebt noch veraendert werden.
//
// ── Crash-sicherer Create + provisional-Grenze ───────────────────────────────
// Marker-State-Machine reqs/<uid>/<requestId> (reserved -> complete, per Pfad
// UID-gebunden) haelt Payload-Signatur, reservierten Code, iid sowie den
// pending Host-Token VOR der Raumerstellung fest; die Raumerstellung ist
// write-once an (code, iid) gebunden. Ein identischer Retry adoptiert den
// reservierten Code bzw. den eigenen Raum — nie ein zweiter Raum. EHRLICHE
// GRENZE: ein Create, dessen Prozess nach dem Raum-Write abbricht und NIE
// retried wird, hinterlaesst einen Raum im Zustand `provisional: true` bis zu
// dessen Ablauf (PROVISIONAL_TTL_MS). Ein provisionaler Raum ist NICHT
// joinbar und NICHT listbar (Rules) — ein oeffentlich spielbarer Ghost-Raum
// entsteht also nicht; abgelaufene provisionale Raeume werden opportunistisch
// (Join-Versuch, Kandidaten-Probe im Create) iid-gebunden entfernt. Erst der
// Marker-Abschluss macht den Raum aktiv (provisional wird entfernt).
//
// ── Leave & Public-Listing (transaction- und iid-gebunden) ───────────────────
// v4-Listings tragen die iid ihres Raums (Rules erzwingen das). Der Cleanup
// laeuft als Transaction auf publicRooms/<code> und loescht AUSSCHLIESSLICH
// ein Listing mit exakt der eigenen alten iid — ein neues Listing eines
// recycelten Codes (andere iid, oder v3 ohne iid) bleibt byte-identisch
// stehen, und cleanupPending eines fremden Raums wird nie beruehrt. Der
// Host-Leave setzt server-owned cleanupPending; jeder weitere Leave-Aufruf
// repariert einen abgebrochenen Cleanup deterministisch.
//
// ── Transaction-/Read-Scope ──────────────────────────────────────────────────
// Join/Leave/Start transaktionieren den Raumknoten nur im Lobby-Zustand
// (strukturell klein). roomActivateV4 transaktioniert den Raumknoten auch im
// laufenden Match (Reconnect) — bewusst dokumentierte Ausnahme: Session-
// Uebernahme, Presence und Auto-Start muessen iid-gebunden atomar sein; die
// Payload ist durch die zwei Zyklen aktiver Zeit je Generation begrenzt, Reconnects sind
// selten. Rematch transaktioniert nur den gen-Zaehler + den frischen
// g/<neu>/live-Knoten; Create den Marker + den neuen Raumknoten.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const {
  ArbiterError, openingAnchor, seatOfUid, seatKey, canonical, cachedTransaction,
  MAX_SEATS, ROOM_RE,
} = require('./clock-core');

const GEN_MAX = 10000;              // wie der Client/GEN_MAX und die gen-Rule
const ROOM_TTL_MS = 7200000;        // 2 h — identisch zum Rules-Join-Fenster
const RESERVE_LEASE_MS = 120000;    // pending-Session-Lease (Join -> Activate)
const PROVISIONAL_TTL_MS = 600000;  // nie finalisierte Create-Raeume: Ablauf
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // identisch zu rrand()
const CODE_TRIES = 6;               // identisch zum v3-Client-Create
const ID_RE = /^[A-Za-z0-9_-]{8,24}$/;    // pid/tab — identisch zu den Rules
const REQ_RE = /^[A-Za-z0-9_-]{8,64}$/;   // Idempotency-Schluessel
const IID_RE = /^[A-Za-z0-9_-]{8,64}$/;   // roomInstanceId (servergeneriert)
const NAME_MAX = 48;                // Rules-Bound (UTF-16-Units)

const FMT_CAPACITY = { single: 2, double: 2, ffa: 5, triple_ffa: 3, team_duel: 4 };
const CONFIG_KEYS = ['winTarget', 'fmt', 'visibility'];

// Namens-Sanitizer — Serverseite der bestehenden Client-Regeln (sanitizeName):
// C0/C1-Controls, Bidi-Steuerzeichen und unsichtbare Formatzeichen entfernen,
// Whitespace kollabieren/trimmen, harter 48-Unit-Cap. Rueckgabe null = leer.
function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200F\u2028-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u00AD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX).trim();
  return s.length ? s : null;
}

// Room-Konfiguration: AUSSCHLIESSLICH die erlaubten Felder, unbekannte Felder
// werden abgelehnt (kein stilles Ignorieren von Manipulationsversuchen).
function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
  for (const k of Object.keys(cfg)) if (CONFIG_KEYS.indexOf(k) < 0) return null;
  if (cfg.winTarget !== 3 && cfg.winTarget !== 5) return null;
  if (!FMT_CAPACITY[cfg.fmt]) return null;
  if (cfg.visibility !== 'private' && cfg.visibility !== 'public') return null;
  return { winTarget: cfg.winTarget, fmt: cfg.fmt, visibility: cfg.visibility };
}

// Besetzte Seats fail-closed: jeder besetzte Seat und jeder Indexeintrag muss
// der UID-/Seat-Eindeutigkeit genuegen (seatOfUid), sonst null. Rueckgabe ist
// aufsteigend sortiert.
function occupiedSeats(meta) {
  const out = [];
  for (let s = 0; s < MAX_SEATS; s++) {
    const p = meta.players && meta.players[s];
    if (!p || typeof p.uid !== 'string' || !p.uid) continue;
    if (seatOfUid(meta, p.uid) !== s) return null;
    out.push(s);
  }
  for (const uid of Object.keys(meta.seatByUid || {})) {
    if (seatOfUid(meta, uid) < 0) return null;
  }
  return out;
}

// 16 Zeichen [A-Za-z0-9_-] — erfuellt ID_RE (8..24) und IID_RE.
const randToken = () => crypto.randomBytes(12).toString('base64url');

// Session-Helfer: darf dieser (reservierte) Seat recycelt werden? NUR wenn er
// nie aktiv wurde, seine pending-Lease abgelaufen ist und die Presence offline
// blieb. Ein aktiver Seat ist grundsaetzlich unantastbar.
function seatRecyclable(sessEntry, pEntry, t) {
  if (pEntry && pEntry.on === true) return false;
  if (!sessEntry) return true;                       // Altbestand ohne Session-State
  if (sessEntry.active != null) return false;        // aktiv -> NIE recyceln
  const pend = sessEntry.pending;
  return !pend || typeof pend.expiresAt !== 'number' || pend.expiresAt <= t;
}

function createRoomCore(opts) {
  const db = opts.db;
  const nowMs = typeof opts.now === 'function' ? opts.now : () => Date.now();
  // Injizierbar fuer deterministische Tests: Raumcode-Kandidaten, Instanz-IDs,
  // Session-Tokens/Lease-IDs.
  const nextCode = typeof opts.codeGen === 'function' ? opts.codeGen : () => {
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  };
  const newIid = typeof opts.idGen === 'function' ? opts.idGen : randToken;
  const newTok = typeof opts.tokGen === 'function' ? opts.tokGen : randToken;

  const roomRef = (room) => db.ref('rooms/' + room);
  const liveRef = (room, gen) => db.ref('rooms/' + room + '/g/' + gen + '/live');
  const reqRef = (uid, id) => db.ref('reqs/' + uid + '/' + id);

  function checkUid(uid) {
    if (typeof uid !== 'string' || !uid) throw new ArbiterError('permission', 'Auth erforderlich.');
  }
  function checkRoomCode(room) {
    if (typeof room !== 'string' || !ROOM_RE.test(room)) throw new ArbiterError('invalid', 'Ungueltiger Raumcode.');
  }
  function checkIidArg(iid) {
    if (typeof iid !== 'string' || !IID_RE.test(iid))
      throw new ArbiterError('invalid', 'roomInstanceId (iid) fehlt oder ist ungueltig.');
  }
  function checkSessionArg(session) {
    if (typeof session !== 'string' || !session)
      throw new ArbiterError('invalid', 'Session-Token fehlt.');
  }
  // Spieler-Identitaet (pid/tab sind Client-Session-Tokens wie in v3, nur
  // formvalidiert; die vertrauenswuerdige Identitaet ist ausschliesslich uid).
  function checkIdentity(args) {
    if (typeof args.pid !== 'string' || !ID_RE.test(args.pid)) throw new ArbiterError('invalid', 'Ungueltige Spieler-ID.');
    if (typeof args.tab !== 'string' || !ID_RE.test(args.tab)) throw new ArbiterError('invalid', 'Ungueltiges Session-Token.');
    const name = args.name === undefined || args.name === null ? 'Player' : sanitizeName(args.name);
    if (!name) throw new ArbiterError('invalid', 'Ungueltiger Name.');
    return { pid: args.pid, tab: args.tab, name };
  }
  // Existenz/Version/Instanz — gezielte Reads, nie der ganze Raum.
  async function readV4(room) {
    const base = roomRef(room);
    const [v, state, iid, provisional] = await Promise.all([
      base.child('v').get(), base.child('state').get(), base.child('iid').get(),
      base.child('provisional').get(),
    ]);
    if (!v.exists()) throw new ArbiterError('not-found', 'Raum existiert nicht.');
    if (v.val() !== 4) throw new ArbiterError('invalid', 'Erfordert Protokoll v4.');
    return { state: state.val(), iid: iid.val(), provisional: provisional.val() === true };
  }
  function checkInstance(roomIid, argIid) {
    if (roomIid !== argIid) throw new ArbiterError('failed', 'Rauminstanz veraltet (iid stimmt nicht).');
  }
  async function readMeta(room) {
    const base = roomRef(room);
    const [players, seatByUid, fmt, gen, sess] = await Promise.all([
      base.child('players').get(), base.child('seatByUid').get(),
      base.child('config/fmt').get(), base.child('gen').get(), base.child('sess').get(),
    ]);
    return {
      players: players.val() || {}, seatByUid: seatByUid.val() || {},
      fmt: fmt.val(), gen: gen.val() | 0, sess: sess.val() || {},
    };
  }
  // Session-Pflicht: args.session muss der AKTIVEN Session des Seats entsprechen.
  function checkActiveSession(meta, seat, session) {
    const s = meta.sess && meta.sess[seat];
    if (!s || typeof s.active !== 'string' || s.active !== session)
      throw new ArbiterError('permission', 'Session ungueltig oder veraltet.');
  }
  // Frische Aim-Phase einer Generation write-once anlegen (Start-Echo,
  // Rematch-Gewinner und Crash-Reparatur teilen sich exakt diesen Schritt) —
  // eine bestehende Clock wird NIE zurueckgesetzt; die Startzeit entsteht IM
  // Transaction-Lauf; live traegt die Rauminstanz (iid-Bindung).
  //
  // Stufenmodell: der Anker kommt aus openingAnchor (clock-core) und traegt
  // damit zwangslaeufig stage 0, remainingMs = CYCLE_MS, phase 'aim',
  // cracked/expired false und die frischen eligibleSeats des Rosters. Der
  // geschriebene Wert ist { iid, clock } OHNE slots — live/slots der neuen
  // Generation ist also leer. Weil der Anker gen-gebunden ist, entsteht auch
  // die phaseId (<gen>:0) neu. Die Vorgaengergeneration wird nicht angefasst.
  async function ensureAnchor(room, gen, roster, iid) {
    const ref = liveRef(room, gen);
    await cachedTransaction(ref, (cur) => {
      if (cur && cur.clock) return;
      if (cur && cur.iid !== undefined && cur.iid !== iid) return;   // fremde Instanz
      return { iid, clock: openingAnchor(gen, nowMs(), seatKey(roster)) };
    });
    return (await ref.child('clock').get()).val();
  }
  // Public-Listing-Cleanup: Transaction AUF dem Listing, strikt iid-gebunden —
  // geloescht wird ausschliesslich ein Listing, das exakt die eigene alte iid
  // traegt (fehlt das Listing, ist nichts zu tun). Ein neues Listing unter
  // recyceltem Code (andere iid oder v3 ohne iid) bleibt unangetastet; das
  // cleanupPending-Flag wird nur im Raum der EIGENEN Instanz geraeumt.
  async function cleanupListing(room, iid) {
    await cachedTransaction(db.ref('publicRooms/' + room), (cur) => {
      if (cur == null) return;                       // kein Listing -> nichts zu tun
      if (cur.iid !== iid) return;                   // fremdes/v3-Listing: NIE loeschen
      return null;
    });
    const curIid = (await roomRef(room).child('iid').get()).val();
    if (curIid === iid) await roomRef(room).child('cleanupPending').set(null);
  }
  // Abgelaufenen provisionalen Raum entfernen (opportunistisch — beim Join-
  // Versuch und bei der Kandidaten-Probe im Create; kein Scheduler noetig).
  async function reapProvisional(room, t) {
    let reaped = false;
    await cachedTransaction(roomRef(room), (cur) => {
      if (cur == null) return;
      if (cur.provisional !== true) return;
      if (typeof cur.created !== 'number' || t - cur.created < PROVISIONAL_TTL_MS) return;
      reaped = true;
      return null;
    });
    return reaped;
  }

  // ── roomCreateV4 — Marker-State-Machine reserved -> complete ───────────────
  async function reserveCandidate(t) {
    for (let i = 0; i < CODE_TRIES; i++) {
      const cand = nextCode();
      if (typeof cand !== 'string' || !ROOM_RE.test(cand)) continue;
      const snap = await roomRef(cand).get();
      if (!snap.exists()) return cand;
      // Abgelaufene provisionale Leiche unter dem Kandidaten? Sicher entfernen.
      const val = snap.val();
      if (val && val.provisional === true && typeof val.created === 'number'
        && t - val.created >= PROVISIONAL_TTL_MS) {
        if (await reapProvisional(cand, t)) return cand;
      }
    }
    throw new ArbiterError('unavailable', 'Kein freier Raumcode gefunden.');
  }
  async function roomCreateV4(args) {
    checkUid(args.uid);
    if (typeof args.requestId !== 'string' || !REQ_RE.test(args.requestId))
      throw new ArbiterError('invalid', 'requestId fehlt oder ist ungueltig.');
    const cfg = validateConfig(args.config);
    if (!cfg) throw new ArbiterError('invalid', 'Ungueltige Raum-Konfiguration.');
    const who = checkIdentity(args);
    // Der Client bestimmt NICHTS server-owned: Seat, Gen, Clock, Historie,
    // seatByUid, sess, iid, Token und Zeitwerte kommen ausschliesslich von hier.
    const sig = canonical({ config: cfg, name: who.name, pid: who.pid, tab: who.tab });
    const rref = reqRef(args.uid, args.requestId);
    const done = async (marker, status) => {
      // Abschluss-/Reparaturpfad: Marker complete -> provisional raeumen und
      // die im Marker persistierte pending-Host-Session zurueckgeben.
      await cachedTransaction(roomRef(marker.code), (cur) => {
        if (cur == null) return;
        if (cur.iid !== marker.iid) return;          // fremde Instanz: nie anfassen
        if (cur.provisional !== true) return;
        const next = Object.assign({}, cur);
        delete next.provisional;
        return next;
      });
      return {
        status, room: marker.code, seat: 0, iid: marker.iid,
        token: marker.token, leaseId: marker.leaseId,
      };
    };
    for (let attempt = 0; attempt < CODE_TRIES + 2; attempt++) {
      const t = nowMs();
      let marker = (await rref.get()).val();
      if (marker && marker.sig !== sig)
        throw new ArbiterError('invalid', 'requestId bereits mit anderer Payload verwendet.');
      if (marker && marker.state === 'complete') return done(marker, 'exists');
      if (!marker) {
        // Reservierung: Code, iid und pending Host-Session werden VOR der
        // Raumerstellung dauerhaft im Marker festgehalten — jeder Abbruch
        // danach ist durch einen identischen Retry reparierbar.
        const draft = {
          uid: args.uid, requestId: args.requestId, sig,
          code: await reserveCandidate(t), iid: newIid(),
          token: newTok(), leaseId: newTok(),
          state: 'reserved', at: t,
        };
        const res = await cachedTransaction(rref, (cur) => (cur == null ? draft : undefined));
        marker = res.committed ? draft : ((res.snapshot && res.snapshot.val()) || null);
        if (!marker) continue;                       // Zwilling gewann das Race -> neu lesen
        if (marker.sig !== sig)
          throw new ArbiterError('invalid', 'requestId bereits mit anderer Payload verwendet.');
        if (marker.state === 'complete') return done(marker, 'exists');
      }
      // Raum write-once unter (marker.code, marker.iid) erstellen ODER die
      // eigene, bereits erstellte Instanz adoptieren (Retry/Zwilling/Crash).
      // Der Raum entsteht PROVISIONAL und mit pending Host-Session — joinbar/
      // listbar wird er erst nach dem Marker-Abschluss.
      const res = await cachedTransaction(roomRef(marker.code), (cur) => {
        if (cur != null) return;                     // belegt -> unten: eigene Instanz?
        const tc = nowMs();
        return {
          v: 4, config: cfg, gen: 0, state: 'lobby', created: tc, iid: marker.iid,
          provisional: true,
          p: { 0: { s: marker.token, on: false, t: tc } },
          players: { 0: { id: who.pid, name: who.name, tab: who.tab, uid: args.uid } },
          seatByUid: { [args.uid]: 0 },
          sess: { 0: { iid: marker.iid, active: null, pending: { token: marker.token, leaseId: marker.leaseId, expiresAt: tc + RESERVE_LEASE_MS } } },
        };
      });
      const cur = res.snapshot.val();
      if (cur && cur.iid === marker.iid) {
        // Abschluss: Marker auf complete (write-once, idempotent).
        await cachedTransaction(rref, (m) => {
          if (m == null) return;
          if (m.state === 'complete' || m.code !== marker.code || m.iid !== marker.iid) return;
          return Object.assign({}, m, { state: 'complete' });
        });
        const fin = (await rref.get()).val();
        if (fin && fin.state === 'complete' && fin.code === marker.code && fin.iid === marker.iid)
          return done(fin, res.committed ? 'created' : 'exists');
        continue;                                    // Marker wanderte -> aktuellen Stand uebernehmen
      }
      // Fremder Raum unter dem reservierten Code (Race nach der Verfuegbar-
      // keitspruefung): Marker per CAS auf einen neuen Kandidaten schieben.
      // Der fremde Raum wird NIE beruehrt; ein eigener Raum existiert in
      // diesem Zweig nicht (write-once schlug fehl).
      const cand = await reserveCandidate(nowMs());
      const nid = newIid();
      const ntok = newTok(), nlease = newTok();
      await cachedTransaction(rref, (m) => {
        if (m == null) return;
        if (m.state === 'complete') return;
        if (m.code !== marker.code || m.iid !== marker.iid) return;   // jemand war schneller
        return Object.assign({}, m, { code: cand, iid: nid, token: ntok, leaseId: nlease });
      });
    }
    throw new ArbiterError('unavailable', 'Kein freier Raumcode gefunden.');
  }

  // ── roomJoinV4 — reserviert NUR (pending Session, kein Online, keine Clock) ─
  async function roomJoinV4(args) {
    checkUid(args.uid);
    checkRoomCode(args.room);
    checkIidArg(args.iid);
    const who = checkIdentity(args);
    const t0 = nowMs();
    const info = await readV4(args.room);
    checkInstance(info.iid, args.iid);
    if (info.provisional) {
      // Nie finalisierter Create: nicht joinbar; abgelaufene Leiche entfernen.
      if (await reapProvisional(args.room, t0)) throw new ArbiterError('not-found', 'Raum existiert nicht.');
      throw new ArbiterError('failed', 'Raum ist noch nicht fertig erstellt.');
    }
    const meta = await readMeta(args.room);
    const have = seatOfUid(meta, args.uid);
    if (have >= 0) {
      // Reconnect-Pfad: eigener Seat — neue pending Session ausstellen; active
      // bleibt bis zum erfolgreichen Activate unangetastet. Einzelknoten-
      // Transaction, instanzgebunden ueber sess.iid.
      const token = newTok(), leaseId = newTok();
      const res = await cachedTransaction(db.ref('rooms/' + args.room + '/sess/' + have), (cur) => {
        if (cur == null) return;                     // Session-State weg -> stale
        if (cur.iid !== args.iid) return;            // fremde Instanz
        return Object.assign({}, cur, { pending: { token, leaseId, expiresAt: nowMs() + RESERVE_LEASE_MS } });
      });
      if (!res.committed) throw new ArbiterError('failed', 'Rauminstanz veraltet (iid stimmt nicht).');
      return { status: 'exists', room: args.room, seat: have, iid: args.iid, token, leaseId };
    }
    if (meta.seatByUid[args.uid] !== undefined)
      throw new ArbiterError('permission', 'UID-/Seat-Zuordnung inkonsistent.');
    for (let s = 0; s < MAX_SEATS; s++) {
      if (meta.players[s] && meta.players[s].uid === args.uid)
        throw new ArbiterError('permission', 'UID-/Seat-Zuordnung inkonsistent.');
    }
    if (info.state !== 'lobby') throw new ArbiterError('failed', 'Match laeuft bereits.');
    const token = newTok(), leaseId = newTok();
    const ref = roomRef(args.room);
    let outcome = 'gone', joined = -1;
    const res = await cachedTransaction(ref, (cur) => {
      if (cur == null) return;                       // geloescht bleibt geloescht
      outcome = 'gone';
      if (cur.v !== 4) { outcome = 'wrongv'; return; }
      if (cur.iid !== args.iid) { outcome = 'stale'; return; }
      if (cur.provisional === true) { outcome = 'provisional'; return; }
      if (cur.state !== 'lobby') { outcome = 'playing'; return; }
      const t = nowMs();
      if (typeof cur.created === 'number' && t - cur.created >= ROOM_TTL_MS) { outcome = 'expired'; return; }
      const m = { players: cur.players || {}, seatByUid: cur.seatByUid || {} };
      const mine = seatOfUid(m, args.uid);
      if (mine >= 0) { outcome = 'exists'; return; }
      if (m.seatByUid[args.uid] !== undefined) { outcome = 'conflict'; return; }
      for (let s = 0; s < MAX_SEATS; s++) {
        if (m.players[s] && m.players[s].uid === args.uid) { outcome = 'conflict'; return; }
      }
      const cap = FMT_CAPACITY[cur.config && cur.config.fmt];
      if (!cap) { outcome = 'corrupt'; return; }
      // Seat bestimmt der SERVER: niedrigster freier Seat ab 1 (v3-Claim).
      // Ein Seat gilt AUCH als frei, wenn seine Reservierung nie aktiviert
      // wurde und die Lease abgelaufen ist (atomares Recycling) — ein aktiver
      // Seat ist grundsaetzlich unantastbar.
      let seat = -1, recycleUid = null;
      for (let s = 1; s < cap; s++) {
        const idxUid = Object.keys(m.seatByUid).find((u) => m.seatByUid[u] === s) || null;
        const empty = !m.players[s] && !(cur.p && cur.p[s]) && !idxUid;
        if (empty) { seat = s; break; }
        if (m.players[s] && seatRecyclable(cur.sess && cur.sess[s], cur.p && cur.p[s], t)) {
          seat = s; recycleUid = (m.players[s] && m.players[s].uid) || idxUid; break;
        }
      }
      if (seat < 0) { outcome = 'full'; return; }
      const seatByUid = Object.assign({}, cur.seatByUid);
      if (recycleUid) delete seatByUid[recycleUid];
      seatByUid[args.uid] = seat;
      outcome = 'joined'; joined = seat;
      // Reine Reservierung: Presence offline, pending Session mit Lease —
      // KEIN state-Flip, KEIN Clock-Anker (das uebernimmt roomActivateV4).
      return Object.assign({}, cur, {
        players: Object.assign({}, cur.players, { [seat]: { id: who.pid, name: who.name, tab: who.tab, uid: args.uid } }),
        seatByUid,
        p: Object.assign({}, cur.p, { [seat]: { s: token, on: false, t } }),
        sess: Object.assign({}, cur.sess, { [seat]: { iid: cur.iid, active: null, pending: { token, leaseId, expiresAt: t + RESERVE_LEASE_MS } } }),
      });
    });
    if (outcome === 'joined' && res.committed)
      return { status: 'joined', room: args.room, seat: joined, iid: args.iid, token, leaseId };
    if (outcome === 'exists') return roomJoinV4(args);   // Race: eigener Seat entstand parallel -> Reconnect-Pfad
    if (outcome === 'full') throw new ArbiterError('failed', 'Raum ist voll.');
    if (outcome === 'playing') throw new ArbiterError('failed', 'Match laeuft bereits.');
    if (outcome === 'expired') throw new ArbiterError('failed', 'Raum ist abgelaufen.');
    if (outcome === 'provisional') throw new ArbiterError('failed', 'Raum ist noch nicht fertig erstellt.');
    if (outcome === 'conflict') throw new ArbiterError('permission', 'UID-/Seat-Zuordnung inkonsistent.');
    if (outcome === 'stale') throw new ArbiterError('failed', 'Rauminstanz veraltet (iid stimmt nicht).');
    if (outcome === 'corrupt' || outcome === 'wrongv') throw new ArbiterError('failed', 'Raum unbrauchbar.');
    throw new ArbiterError('not-found', 'Raum existiert nicht.');
  }

  // ── roomActivateV4 — Handshake-Abschluss: pending -> active + Presence ─────
  async function roomActivateV4(args) {
    checkUid(args.uid);
    checkRoomCode(args.room);
    checkIidArg(args.iid);
    if (typeof args.token !== 'string' || !args.token)
      throw new ArbiterError('invalid', 'pending Session-Token fehlt.');
    if (typeof args.leaseId !== 'string' || !args.leaseId)
      throw new ArbiterError('invalid', 'leaseId fehlt.');
    const info = await readV4(args.room);
    checkInstance(info.iid, args.iid);
    const ref = roomRef(args.room);
    let outcome = 'gone', seat = -1, started = false, startGen = 0, already = false;
    const res = await cachedTransaction(ref, (cur) => {
      if (cur == null) return;                       // geloescht bleibt geloescht
      outcome = 'gone'; started = false; already = false;
      if (cur.v !== 4) { outcome = 'wrongv'; return; }
      if (cur.iid !== args.iid) { outcome = 'stale'; return; }
      if (cur.provisional === true) { outcome = 'provisional'; return; }
      const m = { players: cur.players || {}, seatByUid: cur.seatByUid || {} };
      const s = seatOfUid(m, args.uid);
      if (s < 0) { outcome = 'perm'; return; }
      seat = s;
      const sn = (cur.sess && cur.sess[s]) || null;
      const t = nowMs();
      // Idempotenter Retry einer verlorenen Activate-Antwort: der Token IST
      // bereits die aktive Session -> Erfolg ohne erneute Rotation.
      if (sn && sn.active === args.token) { outcome = 'activated'; already = true; return cur; }
      // Handshake: pending Session muss exakt passen und die Lease leben.
      if (!sn || !sn.pending || sn.pending.token !== args.token
        || sn.pending.leaseId !== args.leaseId
        || typeof sn.pending.expiresAt !== 'number' || sn.pending.expiresAt <= t) {
        outcome = 'lease'; return;
      }
      const next = Object.assign({}, cur, {
        sess: Object.assign({}, cur.sess, { [s]: { iid: cur.iid, active: args.token, pending: null } }),
        p: Object.assign({}, cur.p, { [s]: { s: args.token, on: true, t } }),
      });
      outcome = 'activated';
      // Auto-Start 1v1/2v2: NUR wenn ALLE benoetigten Seats eine gueltige
      // aktive Session UND passende Online-Presence besitzen. Der Clock-Anker
      // entsteht in DIESER finalen Transaction (Serverzeit im Lauf).
      const fmt = cur.config && cur.config.fmt;
      if (cur.state === 'lobby' && (fmt === 'single' || fmt === 'double')) {
        const ready = [0, 1].every((x) => {
          const pp = next.p && next.p[x], ss = next.sess && next.sess[x];
          return next.players && next.players[x] && ss && typeof ss.active === 'string'
            && pp && pp.on === true && pp.s === ss.active;
        });
        const gen = cur.gen | 0;
        if (ready && !(cur.g && cur.g[gen] && cur.g[gen].live)) {
          next.state = 'playing';
          next.g = Object.assign({}, cur.g);
          next.g[gen] = Object.assign({}, next.g[gen], {
            live: { iid: cur.iid, clock: openingAnchor(gen, t, seatKey([0, 1])) },
          });
          started = true; startGen = gen;
        }
      }
      return next;
    });
    if (outcome === 'activated' && (res.committed || already)) {
      const room = res.snapshot.val();
      const clock = started ? room.g[startGen].live.clock : null;
      return { status: 'activated', room: args.room, seat, token: args.token, started, clock };
    }
    if (outcome === 'perm') throw new ArbiterError('permission', 'Kein eindeutiger Seat fuer diese UID.');
    if (outcome === 'lease') throw new ArbiterError('failed', 'Session-Lease ungueltig oder abgelaufen.');
    if (outcome === 'stale') throw new ArbiterError('failed', 'Rauminstanz veraltet (iid stimmt nicht).');
    if (outcome === 'provisional') throw new ArbiterError('failed', 'Raum ist noch nicht fertig erstellt.');
    if (outcome === 'wrongv') throw new ArbiterError('failed', 'Raum unbrauchbar.');
    throw new ArbiterError('not-found', 'Raum existiert nicht.');
  }

  // ── roomLeaveV4 (nur Lobby — In-Match-Leave ist Phase IV) ──────────────────
  async function roomLeaveV4(args) {
    checkUid(args.uid);
    checkRoomCode(args.room);
    checkIidArg(args.iid);
    checkSessionArg(args.session);
    const base = roomRef(args.room);
    const vSnap = await base.child('v').get();
    if (!vSnap.exists()) {
      // Vollstaendig geloeschter Raum: idempotent 'gone' — dabei ein evtl.
      // verwaistes Listing der EIGENEN Instanz nachraeumen (Retry-Vertrag).
      await cleanupListing(args.room, args.iid);
      return { status: 'gone' };
    }
    if (vSnap.val() !== 4) throw new ArbiterError('invalid', 'Erfordert Protokoll v4.');
    const [iidSnap, stateSnap, pendingSnap] = await Promise.all([
      base.child('iid').get(), base.child('state').get(), base.child('cleanupPending').get(),
    ]);
    checkInstance(iidSnap.val(), args.iid);
    const meta = await readMeta(args.room);
    const seatPre = seatOfUid(meta, args.uid);
    const anywhere = meta.seatByUid[args.uid] !== undefined
      || Object.keys(meta.players).some((s) => meta.players[s] && meta.players[s].uid === args.uid);
    if (!anywhere) {
      if (pendingSnap.val() === true) await cleanupListing(args.room, args.iid);
      return { status: 'gone' };
    }
    if (seatPre < 0) throw new ArbiterError('failed', 'UID-/Seat-Zuordnung inkonsistent.');
    // Sessionbindung: der Aufrufer muss die aktive Session besitzen — oder,
    // solange der Seat nie aktiviert wurde, die eigene pending Session.
    const snPre = meta.sess[seatPre];
    const pendingOk = snPre && snPre.active == null && snPre.pending && snPre.pending.token === args.session;
    if (!(snPre && (snPre.active === args.session || pendingOk)))
      throw new ArbiterError('permission', 'Session ungueltig oder veraltet.');
    if (stateSnap.val() !== 'lobby')
      throw new ArbiterError('failed', 'Leave im laufenden Match ist noch nicht unterstuetzt (Phase IV).');
    let outcome = 'gone', wasHost = false;
    await cachedTransaction(base, (cur) => {
      if (cur == null) return;                       // geloescht bleibt geloescht
      outcome = 'gone';
      if (cur.v !== 4) { outcome = 'wrongv'; return; }
      if (cur.iid !== args.iid) { outcome = 'stale'; return; }
      if (cur.state !== 'lobby') { outcome = 'playing'; return; }
      const m = { players: cur.players || {}, seatByUid: cur.seatByUid || {} };
      const seat = seatOfUid(m, args.uid);
      if (seat < 0) {
        const stillThere = m.seatByUid[args.uid] !== undefined
          || Object.keys(m.players).some((s) => m.players[s] && m.players[s].uid === args.uid);
        if (stillThere) outcome = 'inconsistent';
        return;
      }
      const c = (cur.sess && cur.sess[seat]) || null;
      const pOk = c && c.active == null && c.pending && c.pending.token === args.session;
      if (!(c && (c.active === args.session || pOk))) { outcome = 'session'; return; }
      wasHost = seat === 0;
      const players = Object.assign({}, cur.players); delete players[seat];
      const seatByUid = Object.assign({}, cur.seatByUid); delete seatByUid[args.uid];
      const p = Object.assign({}, cur.p); delete p[seat];
      const sess = Object.assign({}, cur.sess); delete sess[seat];
      // Letzter Spieler weg -> Raum vollstaendig loeschen (v3: Raum-Cleanup).
      if (!Object.keys(players).length) { outcome = 'deleted'; return null; }
      outcome = 'left';
      const next = Object.assign({}, cur, {
        players,
        seatByUid: Object.keys(seatByUid).length ? seatByUid : null,
        p: Object.keys(p).length ? p : null,
        sess: Object.keys(sess).length ? sess : null,
      });
      // Host-Leave: Listing-Cleanup steht aus — server-owned Flag, damit ein
      // Abbruch zwischen Leave und Listing-Delete deterministisch reparierbar
      // bleibt (jeder weitere Leave-Aufruf raeumt nach).
      if (wasHost) next.cleanupPending = true;
      return next;
    });
    if (outcome === 'playing')
      throw new ArbiterError('failed', 'Leave im laufenden Match ist noch nicht unterstuetzt (Phase IV).');
    if (outcome === 'stale') throw new ArbiterError('failed', 'Rauminstanz veraltet (iid stimmt nicht).');
    if (outcome === 'session') throw new ArbiterError('permission', 'Session ungueltig oder veraltet.');
    if (outcome === 'inconsistent' || outcome === 'wrongv')
      throw new ArbiterError('failed', 'UID-/Seat-Zuordnung inkonsistent.');
    if (outcome === 'deleted' || wasHost || pendingSnap.val() === true)
      await cleanupListing(args.room, args.iid);
    return { status: outcome };
  }

  // ── roomStartV4 (Host, nur Lobby; 1v1/2v2 startet roomActivateV4) ──────────
  async function roomStartV4(args) {
    checkUid(args.uid);
    checkRoomCode(args.room);
    checkIidArg(args.iid);
    checkSessionArg(args.session);
    const info = await readV4(args.room);
    checkInstance(info.iid, args.iid);
    const meta = await readMeta(args.room);
    const seat = seatOfUid(meta, args.uid);
    if (seat < 0) throw new ArbiterError('permission', 'Kein eindeutiger Seat fuer diese UID.');
    if (seat !== 0) throw new ArbiterError('permission', 'Nur der Host darf starten.');
    checkActiveSession(meta, 0, args.session);
    if (info.state === 'playing') {
      // Idempotenter Retry/Parallelverlierer: bestehende Clock NIE anfassen;
      // fehlt sie, wird sie write-once nachgeholt (fail-safe).
      const roster = occupiedSeats(meta);
      if (roster == null) throw new ArbiterError('failed', 'UID-/Seat-Zuordnung inkonsistent.');
      const clock = await ensureAnchor(args.room, meta.gen, roster, args.iid);
      return { status: 'exists', gen: meta.gen, clock };
    }
    if (info.state !== 'lobby') throw new ArbiterError('failed', 'Raum ist nicht in der Lobby.');
    const ref = roomRef(args.room);
    let outcome = 'gone';
    const res = await cachedTransaction(ref, (cur) => {
      if (cur == null) return;                       // geloescht bleibt geloescht
      outcome = 'gone';
      if (cur.v !== 4) { outcome = 'wrongv'; return; }
      if (cur.iid !== args.iid) { outcome = 'stale'; return; }
      if (cur.provisional === true) { outcome = 'provisional'; return; }
      if (cur.state !== 'lobby') { outcome = 'already'; return; }
      const m = { players: cur.players || {}, seatByUid: cur.seatByUid || {} };
      if (seatOfUid(m, args.uid) !== 0) { outcome = 'notHost'; return; }
      const hostSess = cur.sess && cur.sess[0];
      if (!hostSess || hostSess.active !== args.session) { outcome = 'session'; return; }
      const roster = occupiedSeats(m);
      if (roster == null) { outcome = 'inconsistent'; return; }
      const fmt = cur.config && cur.config.fmt;
      const cap = FMT_CAPACITY[fmt];
      if (!cap) { outcome = 'corrupt'; return; }
      const n = roster.length;
      // v3-Startbedingungen: >=2; single/double/TEAM/TRIPLE exakte Besetzung;
      // Seats lueckenlos 0..n-1; ALLE gezaehlten Seats besitzen eine gueltige
      // AKTIVE Session mit passender Online-Presence (Transaction-Snapshot).
      if (n < 2) { outcome = 'few'; return; }
      if ((fmt === 'single' || fmt === 'double') && n !== 2) { outcome = 'few'; return; }
      if (fmt === 'triple_ffa' && n !== 3) { outcome = 'few'; return; }
      if (fmt === 'team_duel' && n !== 4) { outcome = 'few'; return; }
      for (let s = 0; s < n; s++) if (roster[s] !== s) { outcome = 'gap'; return; }
      for (const s of roster) {
        const pp = cur.p && cur.p[s], ss = cur.sess && cur.sess[s];
        if (!(ss && typeof ss.active === 'string' && pp && pp.on === true && pp.s === ss.active)) {
          outcome = 'offline'; return;
        }
      }
      const gen = cur.gen | 0;
      if (cur.g && cur.g[gen] && cur.g[gen].live) { outcome = 'already'; return; }
      const next = Object.assign({}, cur, { state: 'playing' });
      if (fmt === 'ffa' || fmt === 'triple_ffa' || fmt === 'team_duel') next.seats = n;
      next.g = Object.assign({}, cur.g);
      // Serverzeit IM Transaction-Lauf: Retries erben keine alte Deadline.
      next.g[gen] = Object.assign({}, next.g[gen], {
        live: { iid: cur.iid, clock: openingAnchor(gen, nowMs(), seatKey(roster)) },
      });
      outcome = 'started';
      return next;
    });
    if (outcome === 'started' && res.committed) {
      const room = res.snapshot.val();
      const gen = (room && room.gen) | 0;
      return { status: 'started', gen, clock: room.g[gen].live.clock };
    }
    if (outcome === 'already') {
      const roster = occupiedSeats(meta);
      if (roster == null) throw new ArbiterError('failed', 'UID-/Seat-Zuordnung inkonsistent.');
      const clock = await ensureAnchor(args.room, meta.gen, roster, args.iid);
      return { status: 'exists', gen: meta.gen, clock };
    }
    if (outcome === 'notHost') throw new ArbiterError('permission', 'Nur der Host darf starten.');
    if (outcome === 'session') throw new ArbiterError('permission', 'Session ungueltig oder veraltet.');
    if (outcome === 'stale') throw new ArbiterError('failed', 'Rauminstanz veraltet (iid stimmt nicht).');
    if (outcome === 'provisional') throw new ArbiterError('failed', 'Raum ist noch nicht fertig erstellt.');
    if (outcome === 'few') throw new ArbiterError('failed', 'Zu wenige Spieler fuer dieses Format.');
    if (outcome === 'gap') throw new ArbiterError('failed', 'Seats sind nicht lueckenlos besetzt.');
    if (outcome === 'offline') throw new ArbiterError('failed', 'Nicht alle Spieler sind aktiv verbunden.');
    if (outcome === 'inconsistent') throw new ArbiterError('failed', 'UID-/Seat-Zuordnung inkonsistent.');
    if (outcome === 'corrupt' || outcome === 'wrongv') throw new ArbiterError('failed', 'Raum unbrauchbar.');
    throw new ArbiterError('not-found', 'Raum existiert nicht.');
  }

  // ── roomRematchV4 — der EINZIGE legitime v4-Gen-Wechsel, NUR der Host ──────
  async function roomRematchV4(args) {
    checkUid(args.uid);
    checkRoomCode(args.room);
    checkIidArg(args.iid);
    checkSessionArg(args.session);
    if (!Number.isInteger(args.expectedGen) || args.expectedGen < 0 || args.expectedGen >= GEN_MAX)
      throw new ArbiterError('invalid', 'expectedGen fehlt oder ist ungueltig.');
    const info = await readV4(args.room);
    checkInstance(info.iid, args.iid);
    if (info.state !== 'playing') throw new ArbiterError('failed', 'Rematch nur nach einem gestarteten Match.');
    const meta = await readMeta(args.room);
    // NUR der Host: auth.uid muss ueber seatByUid UND players/0.uid eindeutig
    // auf Seat 0 aufloesen (seatOfUid ist fail-closed inkl. Duplikatpruefung),
    // und der Aufruf traegt dessen AKTIVE Session.
    if (seatOfUid(meta, args.uid) !== 0)
      throw new ArbiterError('permission', 'Nur der Host darf den Rematch ausloesen.');
    checkActiveSession(meta, 0, args.session);
    const roster = occupiedSeats(meta);
    if (roster == null || roster.length < 2)
      throw new ArbiterError('failed', 'UID-/Seat-Zuordnung inkonsistent.');
    const newGen = args.expectedGen + 1;
    // Identischer Retry/Parallelverlierer/Crash-Reparatur: die neue Generation
    // existiert schon -> Anker sicherstellen (write-once) und zurueckgeben.
    if (meta.gen === newGen) {
      const clock = await ensureAnchor(args.room, newGen, roster, args.iid);
      return { status: 'exists', gen: newGen, clock };
    }
    if (meta.gen !== args.expectedGen)
      throw new ArbiterError('failed', 'expectedGen ist veraltet.');
    // Terminal-Pruefung: die AKTUELLE Generation muss beendet sein (finished:
    // complete/desync/settlement_timeout) UND die eigene Instanz tragen.
    // Gezielter Read — nie die Historie.
    const curLive = (await liveRef(args.room, args.expectedGen).get()).val();
    if (!curLive || curLive.iid !== args.iid || !curLive.clock || curLive.clock.phase !== 'finished')
      throw new ArbiterError('failed', 'Match der aktuellen Generation ist nicht beendet.');
    // CAS auf dem gen-Zaehler: genau EIN Gewinner je expectedGen, kein Sprung,
    // kein Zuruecksetzen. Transaction-Scope = eine einzelne Zahl; die
    // Rauminstanz wird unmittelbar vor dem Schreiben erneut verifiziert.
    const curIid = (await roomRef(args.room).child('iid').get()).val();
    if (curIid !== args.iid) throw new ArbiterError('failed', 'Rauminstanz veraltet (iid stimmt nicht).');
    const genRef = roomRef(args.room).child('gen');
    let genOutcome = 'gone';
    const res = await cachedTransaction(genRef, (cur) => {
      if (cur == null) return;                       // geloescht bleibt geloescht
      genOutcome = 'gone';
      if (cur !== args.expectedGen) { genOutcome = 'raced'; return; }
      genOutcome = 'bumped';
      return newGen;
    });
    if (!(res.committed && genOutcome === 'bumped')) {
      if (genOutcome === 'gone') throw new ArbiterError('not-found', 'Raum existiert nicht.');
      const genNow = (await genRef.get()).val() | 0;
      if (genNow === newGen) {
        const clock = await ensureAnchor(args.room, newGen, roster, args.iid);
        return { status: 'exists', gen: newGen, clock };
      }
      throw new ArbiterError('failed', 'expectedGen ist veraltet.');
    }
    // Gewinner: frischen live-Anker der neuen Generation write-once anlegen
    // (iid-gebunden). Ein Absturz genau hier wird vom naechsten Rematch-/
    // clockStart-Aufruf repariert; die alte Generation bleibt byte-identisch.
    const clock = await ensureAnchor(args.room, newGen, roster, args.iid);
    return { status: 'rematched', gen: newGen, clock };
  }

  return { roomCreateV4, roomJoinV4, roomActivateV4, roomLeaveV4, roomStartV4, roomRematchV4 };
}

module.exports = {
  createRoomCore, sanitizeName, validateConfig, occupiedSeats, seatRecyclable,
  GEN_MAX, ROOM_TTL_MS, RESERVE_LEASE_MS, PROVISIONAL_TTL_MS, CODE_TRIES, FMT_CAPACITY,
};
