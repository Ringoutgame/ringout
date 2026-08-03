'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Cloud-Functions-Einstieg: duenner onCall-Mantel um den Action-Clock-
// Arbiter (clock-core.js). Hier passiert AUSSCHLIESSLICH:
//   1. Auth-Pflicht (Anonymous Auth genuegt — req.auth.uid ist die Identitaet,
//      Seat-Ownership prueft der Kern gegen players/<seat>/uid),
//   2. Durchreichen der Argumente,
//   3. Mapping der Arbiter-Fehler auf HttpsError-Codes.
// Region europe-west1 — identisch zur RTDB-Instanz.
// Deploy erst nach separater Freigabe (Blaze + Anonymous Auth in der Console).
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { createArbiter, ArbiterError } = require('./clock-core');
const { createRoomCore } = require('./room-core');

setGlobalOptions({ region: 'europe-west1' });
admin.initializeApp();
const arbiter = createArbiter({ db: admin.database() });
const rooms = createRoomCore({ db: admin.database() });

const ERR_MAP = {
  invalid: 'invalid-argument',
  permission: 'permission-denied',
  'not-found': 'not-found',
  'too-early': 'failed-precondition',
  failed: 'failed-precondition',
  unavailable: 'unavailable',
};

const wrap = (fn) => onCall(async (req) => {
  if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', 'Anmeldung erforderlich.');
  const data = req.data || {};
  try {
    // Nur allowlistete Felder erreichen die Kerne — der Client kann keine
    // server-owned Werte (Seat, Clock, Zeit, seatByUid, …) einschleusen.
    return await fn({
      room: data.room, phaseId: data.phaseId, hash: data.hash, next: data.next,
      gen: data.gen,
      requestId: data.requestId, config: data.config,
      name: data.name, pid: data.pid, tab: data.tab,
      expectedGen: data.expectedGen, iid: data.iid,
      session: data.session, token: data.token, leaseId: data.leaseId,
      uid: req.auth.uid,
    });
  } catch (e) {
    if (e instanceof ArbiterError) throw new HttpsError(ERR_MAP[e.code] || 'failed-precondition', e.message);
    console.error('[clock] interner Fehler:', e);
    throw new HttpsError('internal', 'Interner Fehler.');
  }
});

exports.clockStart = wrap(arbiter.clockStart);
exports.clockClose = wrap(arbiter.clockClose);
exports.clockSettle = wrap(arbiter.clockSettle);
exports.roomCreateV4 = wrap(rooms.roomCreateV4);
exports.roomJoinV4 = wrap(rooms.roomJoinV4);
exports.roomActivateV4 = wrap(rooms.roomActivateV4);
exports.roomLeaveV4 = wrap(rooms.roomLeaveV4);
exports.roomStartV4 = wrap(rooms.roomStartV4);
exports.roomRematchV4 = wrap(rooms.roomRematchV4);
